import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { admissionCheckHandler } from "../../src/commands/apply.ts";
import {
  completionAwareEvidenceCommandHandler,
  completionAwareProveCommandHandler,
  completionAwarePublishCommandHandler,
  realiseCommandHandler,
} from "../../src/commands/work-completion.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import type { CheckedCandidateReceipt } from "../../src/commands/check.ts";
import type { CompletionEvidenceCandidate, CompletionProofBundle, WorkCompletionPublicationReceipt } from "../../src/realisation/work-completion.ts";

const canonicalRoot = resolve(import.meta.dirname, "../..");
const manifest = "graph/manifests/integration.json";
const profile = "urn:usf:profile:v3-self-host:1";
const work = "urn:usf:work:repository-path-scope";
const validation = "urn:usf:validation:repository-path-tests";
const obligation = "urn:usf:proof:repository-path-scope";
const checkedReceiptFixturePath = resolve(canonicalRoot, "tests/fixtures/work-completion/repository-path-checked-receipt.json");
const checkedReceiptProvenancePath = resolve(canonicalRoot, "tests/fixtures/work-completion/repository-path-checked-receipt.provenance.json");
const isConfinedFixtureProcess = process.env.USF_REPOSITORY_ROOT !== undefined;
const temporaryRoot = process.env.TMPDIR === undefined ? resolve(canonicalRoot, ".usf/tmp") : resolve(process.env.TMPDIR);

interface CheckedReceiptFixtureProvenance {
  readonly schema: "urn:usf:checked-candidate-receipt-fixture-provenance:1";
  readonly sourceManifestPath: string;
  readonly sourceProfileIri: string;
  readonly sourceWorkIri: string;
  readonly sourceValidationIri: string;
  readonly originalConstructionBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly candidateDigest: string;
  readonly workspaceIdentityDigest: string;
  readonly receiptPath: string;
  readonly receiptDigest: string;
  readonly receiptRawSha256: string;
  readonly fixtureSourceSet: Readonly<{
    canonicalHead: string;
    canonicalTree: string;
    excludedTopLevelEntries: readonly string[];
  }>;
  readonly fixtureSourceSetDigest: string;
  readonly generatorCommand: readonly string[];
  readonly generatorCommandDigest: string;
}

function rawDigest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function checkedReceiptFixture(): Promise<Readonly<{
  bytes: Buffer;
  receipt: CheckedCandidateReceipt;
  provenance: CheckedReceiptFixtureProvenance;
}>> {
  const bytes = await readFile(checkedReceiptFixturePath);
  const receipt = JSON.parse(bytes.toString("utf8")) as CheckedCandidateReceipt;
  const provenance = JSON.parse(await readFile(checkedReceiptProvenancePath, "utf8")) as CheckedReceiptFixtureProvenance;
  assert.deepEqual(Object.keys(provenance).sort(), [
    "candidateDigest", "fixtureSourceSet", "fixtureSourceSetDigest", "generatorCommand", "generatorCommandDigest",
    "originalConstructionBasisDigest", "receiptDigest", "receiptPath", "receiptRawSha256", "schema",
    "scopedDependencyDigest", "sourceManifestPath", "sourceProfileIri", "sourceValidationIri", "sourceWorkIri",
    "workspaceIdentityDigest",
  ]);
  assert.equal(provenance.schema, "urn:usf:checked-candidate-receipt-fixture-provenance:1");
  assert.equal(provenance.sourceManifestPath, manifest);
  assert.equal(provenance.sourceProfileIri, profile);
  assert.equal(provenance.sourceWorkIri, work);
  assert.equal(provenance.sourceValidationIri, validation);
  assert.equal(provenance.candidateDigest, receipt.candidateDigest);
  assert.equal(provenance.originalConstructionBasisDigest, receipt.originalConstructionBasisDigest);
  assert.equal(provenance.scopedDependencyDigest, receipt.scopedDependencyDigest);
  assert.equal(provenance.workspaceIdentityDigest, receipt.workspaceIdentityDigest);
  assert.equal(provenance.receiptDigest, receipt.receiptDigest);
  assert.equal(provenance.receiptRawSha256, rawDigest(bytes));
  assert.equal(provenance.fixtureSourceSetDigest, canonicalDigest(provenance.fixtureSourceSet));
  assert.equal(provenance.generatorCommandDigest, canonicalDigest(provenance.generatorCommand));
  assert.equal(bytes.toString("utf8"), canonicalJson(receipt, { rejectAbsolutePaths: true }));
  return Object.freeze({ bytes, receipt, provenance });
}

async function installCheckedReceipt(root: string, fixture: Awaited<ReturnType<typeof checkedReceiptFixture>>): Promise<string> {
  assert.match(fixture.provenance.receiptPath, /^\.usf\/receipts\/check\/[a-z0-9/.-]+\.json$/u);
  const path = resolve(root, fixture.provenance.receiptPath);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, fixture.bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function rehashedReceipt(receipt: CheckedCandidateReceipt, key: keyof CheckedCandidateReceipt, value: unknown): CheckedCandidateReceipt {
  const { receiptDigest: _ignored, ...originalDraft } = receipt;
  const draft = { ...originalDraft, [key]: value };
  return { ...draft, receiptDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) } as CheckedCandidateReceipt;
}

async function isolatedPrecompletionRepository(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(resolve(temporaryRoot, "work-completion-test-"));
  const root = resolve(parent, "repository");
  await mkdir(root, { mode: 0o700 });
  for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")) continue;
    await cp(resolve(canonicalRoot, entry.name), resolve(root, entry.name), { recursive: true });
  }
  const receiptDirectory = resolve(root, "evidence/work-completion");
  if (existsSync(receiptDirectory)) {
    const removedBySource = new Map<string, Set<string>>();
    for (const name of (await readdir(receiptDirectory)).sort()) {
      const receiptPath = resolve(receiptDirectory, name);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as WorkCompletionPublicationReceipt;
      if (receipt.manifestPath !== manifest || receipt.profileIri !== profile) continue;
      for (const operation of receipt.operations) {
        const removed = removedBySource.get(operation.sourcePath) ?? new Set<string>();
        removed.add(operation.line);
        removedBySource.set(operation.sourcePath, removed);
      }
      await unlink(receiptPath);
    }
    for (const [relativeSourcePath, removed] of removedBySource) {
      const sourcePath = resolve(root, relativeSourcePath);
      const source = await readFile(sourcePath, "utf8");
      await writeFile(sourcePath, `${source.split("\n").filter((line) => line.length > 0 && !removed.has(line)).join("\n")}\n`, "utf8");
    }
  }
  return { root, cleanup: async () => rm(parent, { recursive: true, force: true }) };
}

function packet(root: string) {
  const result = deriveWork(loadSemanticGraph(root, manifest), { profile, selector: work, maxItems: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.length, 1);
  return result.items![0]!;
}

test("direct outer fixture regeneration reproduces the retained real checked receipt", {
  skip: isConfinedFixtureProcess && "the authoritative direct lane runs outside mode-2 confinement",
}, async () => {
  const fixture = await checkedReceiptFixture();
  const isolated = await isolatedPrecompletionRepository();
  try {
    const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root, args: ["no-change", "--work", work, "--profile", profile, "--manifest", manifest] });
    const candidateDigest = (realised.output as { candidateDigest: string }).candidateDigest;
    assert.equal(candidateDigest, fixture.provenance.candidateDigest);
    const checked = await admissionCheckHandler({ command: "check", repositoryRoot: isolated.root, args: ["--candidate", candidateDigest, "--validation", validation] });
    assert.equal((checked.output as { status: string }).status, "pass", JSON.stringify(checked.output));
    const regeneratedPath = (checked.output as { receiptPath: string }).receiptPath;
    assert.equal(regeneratedPath, fixture.provenance.receiptPath);
    assert.deepEqual(await readFile(resolve(isolated.root, regeneratedPath)), fixture.bytes);
  } finally {
    await isolated.cleanup();
  }
});

test("retained real receipt is reauthenticated before no-change completion effects", async () => {
  const fixture = await checkedReceiptFixture();
  const isolated = await isolatedPrecompletionRepository();
  try {
    assert.equal(packet(isolated.root).eligibility?.construction.authority, "active-permission");
    const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root, args: ["no-change", "--work", work, "--profile", profile, "--manifest", manifest] });
    const candidateDigest = (realised.output as { candidateDigest: string }).candidateDigest;
    assert.equal(candidateDigest, fixture.provenance.candidateDigest);

    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest] }),
      { code: "WORK_COMPLETION_CHECK_RECEIPT_MISSING", exitCode: 4 },
    );

    const evidencePath = ".usf/candidates/work-completion/repository-path-evidence.json";
    const bundlePath = ".usf/candidates/work-completion/repository-path-bundle.json";
    const checkedReceiptPath = await installCheckedReceipt(isolated.root, fixture);
    await chmod(checkedReceiptPath, 0o644);
    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", evidencePath] }),
      { code: "CHECK_RECEIPT_PATH_UNSAFE" },
    );
    assert.equal(existsSync(resolve(isolated.root, evidencePath)), false);
    await chmod(checkedReceiptPath, 0o600);

    const malformedEvidencePath = ".usf/candidates/work-completion/refused-malformed-receipt.json";
    await writeFile(checkedReceiptPath, "{not-json\n", { mode: 0o600 });
    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", malformedEvidencePath] }),
    );
    assert.equal(existsSync(resolve(isolated.root, malformedEvidencePath)), false, "malformed receipt must refuse before evidence persistence");

    const tamperedEvidencePath = ".usf/candidates/work-completion/refused-integrity-tampered-receipt.json";
    const tamperedReceipt = { ...fixture.receipt, receiptDigest: `sha256:${"0".repeat(64)}` };
    await writeFile(checkedReceiptPath, canonicalJson(tamperedReceipt, { rejectAbsolutePaths: true }), { mode: 0o600 });
    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", tamperedEvidencePath] }),
    );
    assert.equal(existsSync(resolve(isolated.root, tamperedEvidencePath)), false, "integrity-tampered receipt must refuse before evidence persistence");

    const substitutions: readonly Readonly<{ key: keyof CheckedCandidateReceipt; value: string }>[] = [
      { key: "workIri", value: "urn:usf:work:wrong" },
      { key: "explicitProfileIri", value: "urn:usf:profile:wrong:1" },
      { key: "originalConstructionBasisDigest", value: `sha256:${"1".repeat(64)}` },
      { key: "scopedDependencyDigest", value: `sha256:${"2".repeat(64)}` },
      { key: "candidateDigest", value: `sha256:${"3".repeat(64)}` },
      { key: "workspaceIdentityDigest", value: `sha256:${"4".repeat(64)}` },
      { key: "validationObligationIri", value: "urn:usf:validation:wrong" },
    ];
    for (const substitution of substitutions) {
      const changed = rehashedReceipt(fixture.receipt, substitution.key, substitution.value);
      await writeFile(checkedReceiptPath, canonicalJson(changed, { rejectAbsolutePaths: true }), { mode: 0o600 });
      const refusedPath = `.usf/candidates/work-completion/refused-${String(substitution.key)}.json`;
      await assert.rejects(async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", refusedPath] }));
      assert.equal(existsSync(resolve(isolated.root, refusedPath)), false, `${String(substitution.key)} must refuse before evidence persistence`);
    }
    await writeFile(checkedReceiptPath, fixture.bytes, { mode: 0o600 });

    const evidenceResult = await completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", evidencePath] });
    const evidence = evidenceResult.output as CompletionEvidenceCandidate;
    assert.equal(evidence.disposition, "verified-no-change");
    assert.equal(evidence.validationResults.length, 1);

    const proofResult = await completionAwareProveCommandHandler({ command: "prove", repositoryRoot: isolated.root, args: ["completion", "--obligation", obligation, "--evidence", evidencePath, "--profile", profile, "--manifest", manifest, "--output", bundlePath] });
    const bundle = proofResult.output as CompletionProofBundle;
    assert.equal(bundle.proof.outcome, "pass");

    const verify = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["work-completion", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--verify"] });
    assert.equal((verify.output as { publicationState: string }).publicationState, "absent");
    assert.notEqual(packet(isolated.root).realisationStage?.stage, "verified-complete");

    const applied = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["work-completion", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--apply"] });
    const appliedOutput = applied.output as { publicationState: string; publicationReceiptPath: string };
    assert.equal(appliedOutput.publicationState, "created");
    assert.equal(packet(isolated.root).realisationStage?.stage, "verified-complete");

    const matching = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["work-completion", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--apply"] });
    assert.equal((matching.output as { publicationState: string }).publicationState, "matching");

    const sourcePath = resolve(isolated.root, "graph/integration.nq");
    const completedSource = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, `${completedSource}<urn:usf:test:unrelated-completion-currentness> <urn:usf:predicate:type> <urn:usf:type:SemanticRecordType> <urn:usf:graph:integration> .\n`, "utf8");
    assert.equal(packet(isolated.root).realisationStage?.stage, "verified-complete", "unrelated semantic movement cannot stale scoped completion");

    for (const relativePath of ["src/cli.ts", "src/commands/help.ts", "package.json", "pnpm-lock.yaml"]) {
      const path = resolve(isolated.root, relativePath);
      const bytes = await readFile(path);
      await writeFile(path, Buffer.concat([bytes, Buffer.from("\n")]));
      assert.equal(packet(isolated.root).realisationStage?.stage, "verified-complete", `${relativePath} is not a completion dependency`);
      await writeFile(path, bytes);
    }

    const toolPath = resolve(isolated.root, "src/commands/work-completion.ts");
    const toolBytes = await readFile(toolPath);
    await writeFile(toolPath, Buffer.concat([toolBytes, Buffer.from("\n// scoped completion authority movement\n")]));
    assert.notEqual(packet(isolated.root).realisationStage?.stage, "verified-complete", "bound implementation movement must stale completion");
    await writeFile(toolPath, toolBytes);
    assert.equal(packet(isolated.root).realisationStage?.stage, "verified-complete");

    const receiptPath = resolve(isolated.root, appliedOutput.publicationReceiptPath);
    const receiptBytes = await readFile(receiptPath);
    await unlink(receiptPath);
    await assert.rejects(
      async () => completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["work-completion", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--apply"] }),
      { code: "WORK_COMPLETION_PUBLICATION_PARTIAL_STATE", exitCode: 7 },
    );
    await writeFile(receiptPath, receiptBytes, { mode: 0o644 });

    const scopedPath = resolve(isolated.root, "src/core/scope.ts");
    await writeFile(scopedPath, `${await readFile(scopedPath, "utf8")}\n// relevant scoped movement\n`, "utf8");
    const stale = packet(isolated.root);
    assert.notEqual(stale.realisationStage?.stage, "verified-complete");
    assert.ok(stale.realisationStage?.completion.reasonCodes.includes(`WORK_COMPLETION_NO_CHANGE_RECEIPT_MISSING:${work}`));
    assert.equal(stale.realisationStage?.completion.reasonCodes.some((reason) => reason.includes("AMBIGUOUS")), false, "historical records are ignored rather than made ambiguous");
    assert.match(await readFile(sourcePath, "utf8"), /AdmittedNoChangeRealisationReceipt/u, "historical copy-on-write records remain present");
  } finally {
    await isolated.cleanup();
  }
});
