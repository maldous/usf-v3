import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, open, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "../../src/commands/construction-authority.ts";
import { executeTransitionCommand, inspectTransition } from "../../src/commands/transition.ts";
import { admissionCheckHandler } from "../../src/commands/apply.ts";
import {
  completionAwareEvidenceCommandHandler,
  prepareCompletionEvidence,
  completionAwareProveCommandHandler,
  completionAwarePublishCommandHandler,
  realiseCommandHandler,
} from "../../src/commands/work-completion.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import type { CheckedCandidateReceipt } from "../../src/commands/check.ts";
import {
  deriveNoChangeCompletionAuthority,
  workCompletionRecordLines,
  type NoChangeCompletionAuthority,
  type CompletionEvidenceCandidate, type CompletionProofBundle, type WorkCompletionPublicationReceipt,
} from "../../src/realisation/work-completion.ts";

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

test("a completion record binds exact semantic dependency identities", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const productWork = "urn:usf:work:product-dependency-adoption-reader";
  const authority = {
    targetGraphIri: "urn:usf:graph:test-completion",
    realisationReceiptType: "urn:usf:type:NoChangeRealisationReceipt",
    realisationReceiptSchemaIri: "urn:usf:no-change-realisation-receipt:1",
    semanticDependencies: ["urn:usf:contract:exact-product-dependency-adoption:1"],
    policy: { iri: "urn:usf:policy:test-completion", resourceDigest: digest },
  } as unknown as NoChangeCompletionAuthority;
  const evidence = {
    evidenceIri: "urn:usf:evidence:test-product-dependency-completion",
    evidenceRequirementIri: "urn:usf:evidence-requirement:test-completion",
    workIri: productWork,
    profileIri: "urn:usf:profile:product-dependency-adoption-reader:1",
    manifestPath: "graph/manifests/product-dependency-adoption-reader.json",
    realisationBasisDigest: digest, scopedDependencyDigest: digest, candidateDigest: digest,
    workspaceIdentityDigest: digest, candidateTreeDigest: digest, lineageDigest: digest,
    byteDeltaDigest: digest, fileModeDigest: digest, writeSetDigest: digest,
    validationResultDigest: digest, validationResults: [{ obligationIri: "urn:usf:validation:test-completion" }],
    contentDigest: digest,
  } as unknown as CompletionProofBundle["evidence"];
  const proof = {
    proofResultIri: "urn:usf:proof-result:test-product-dependency-completion",
    workIri: productWork, obligationIri: "urn:usf:proof:test-completion",
    algorithmIri: "urn:usf:algorithm:test-completion", evidenceDigest: digest,
    realisationBasisDigest: digest, scopedDependencyDigest: digest, candidateDigest: digest,
    validationResultDigest: digest, contentDigest: digest,
  } as unknown as CompletionProofBundle["proof"];
  const record = workCompletionRecordLines({ evidence, proof } as CompletionProofBundle, authority, `sha256:${"b".repeat(64)}`);
  assert.ok(record.lines.some((line) => line.includes("<urn:usf:predicate:semanticDependency> <urn:usf:contract:exact-product-dependency-adoption:1>")));
  const withoutDependency = workCompletionRecordLines({ evidence, proof } as CompletionProofBundle,
    { ...authority, semanticDependencies: [] }, `sha256:${"b".repeat(64)}`);
  assert.notEqual(record.member.realisationDigest, withoutDependency.member.realisationDigest);
});

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

test("retained real receipt is reauthenticated before no-change completion effects", {
  skip: isConfinedFixtureProcess && "the authoritative direct lane runs outside mode-2 confinement",
}, async () => {
  const fixture = await checkedReceiptFixture();
  const isolated = await isolatedPrecompletionRepository();
  try {
    assert.equal(packet(isolated.root).eligibility?.construction.authority, "active-permission");
    const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root, args: ["no-change", "--work", work, "--profile", profile, "--manifest", manifest] });
    const candidateDigest = (realised.output as { candidateDigest: string }).candidateDigest;
    assert.equal(candidateDigest, fixture.provenance.candidateDigest);

    const workspacePath = resolve(isolated.root, (realised.output as { workspacePath: string }).workspacePath);
    const workspaceManifestPath = resolve(workspacePath, ".usf-workspace.json");
    const manifestBytes = await readFile(workspaceManifestPath);
    const directory = await open(workspacePath, "r");
    try {
      const original = await directory.stat();
      const replay = async () => realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root, args: ["no-change", "--work", work, "--profile", profile, "--manifest", manifest] });
      for (let index = 0; index < 2; index += 1) {
        assert.deepEqual(await replay(), realised);
        assert.equal((await stat(workspacePath)).ino, original.ino, "replay must retain the existing directory, not rebuild it");
        assert.deepEqual(await readFile(workspaceManifestPath), manifestBytes);
      }
      await writeFile(workspaceManifestPath, "invalid retained manifest", { mode: 0o600 });
      await assert.rejects(replay, { code: "WORK_COMPLETION_REALISATION_REFUSED", exitCode: 4 });
      assert.equal(await readFile(workspaceManifestPath, "utf8"), "invalid retained manifest");
      await unlink(workspaceManifestPath);
      await assert.rejects(replay, { code: "WORK_COMPLETION_REALISATION_REFUSED", exitCode: 4 });
      assert.equal(existsSync(workspaceManifestPath), false, "partial workspace must not be silently reconstructed");
      assert.equal((await stat(workspacePath)).ino, original.ino);
      await writeFile(workspaceManifestPath, manifestBytes, { mode: 0o600 });
      const extraPath = resolve(workspacePath, "unexpected-replay-input.txt");
      await writeFile(extraPath, "preserve conflicting bytes", { mode: 0o600 });
      await assert.rejects(replay, { code: "WORK_COMPLETION_REALISATION_REFUSED", exitCode: 4 });
      assert.equal(await readFile(extraPath, "utf8"), "preserve conflicting bytes");
      await unlink(extraPath);
      const retainedSourcePath = resolve(workspacePath, "src/core/scope.ts");
      const retainedSource = await readFile(retainedSourcePath);
      await writeFile(retainedSourcePath, "changed retained source");
      await assert.rejects(replay, { code: "WORK_COMPLETION_REALISATION_REFUSED", exitCode: 4 });
      assert.equal(await readFile(retainedSourcePath, "utf8"), "changed retained source");
      await writeFile(retainedSourcePath, retainedSource);
      assert.deepEqual(await replay(), realised);
    } finally { await directory.close(); }

    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest] }),
      { code: "WORK_COMPLETION_CHECK_RECEIPT_MISSING", exitCode: 4 },
    );

    const preparation = { work, profile, manifestPath: manifest, candidateDigest };
    await assert.rejects(() => prepareCompletionEvidence(isolated.root, preparation), { code: "WORK_COMPLETION_CHECK_RECEIPT_MISSING", exitCode: 4 });
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

    const filesBefore = await readdir(isolated.root, { recursive: true });
    const receiptBefore = await readFile(checkedReceiptPath, "utf8");
    const graphBefore = loadSemanticGraph(isolated.root, manifest).semanticDigest;
    const direct = await prepareCompletionEvidence(isolated.root, preparation);
    assert.deepEqual(await prepareCompletionEvidence(isolated.root, preparation), direct);
    const noOutput = await completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest] });
    assert.deepEqual(noOutput.output, direct);
    assert.deepEqual(await readdir(isolated.root, { recursive: true }), filesBefore);
    assert.equal(await readFile(checkedReceiptPath, "utf8"), receiptBefore);
    assert.equal(loadSemanticGraph(isolated.root, manifest).semanticDigest, graphBefore);
    assert.equal(existsSync(resolve(isolated.root, evidencePath)), false);
    assert.notEqual(packet(isolated.root).realisationStage?.completion.verified, true);
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

test("completion evidence preparation refuses nonclosed inputs before repository access", async () => {
  const valid = { work, profile, manifestPath: manifest, candidateDigest: "sha256:" + "a".repeat(64) };
  for (const key of ["output", "graph", "packet", "basis"]) {
    await assert.rejects(() => prepareCompletionEvidence("/missing", { ...valid, [key]: {} }), { code: "WORK_COMPLETION_ARGUMENTS_INVALID" });
  }
  for (const value of [null, [], {}, { ...valid, work: 1 }, { ...valid, profile: "x".repeat(4097) }]) {
    await assert.rejects(() => prepareCompletionEvidence("/missing", value as never), { code: "WORK_COMPLETION_ARGUMENTS_INVALID" });
  }
  await assert.rejects(() => prepareCompletionEvidence("/missing", { ...valid, candidateDigest: "sha256:bad" }), { code: "WORK_COMPLETION_IDENTITY_INVALID" });
  await assert.rejects(() => prepareCompletionEvidence("/missing", { ...valid, manifestPath: "../outside.json" }), { code: "WORK_COMPLETION_SELECTION_INVALID" });
});

const canonicalNoChangeSelection = {
  rootIdentity: "urn:usf:work:cli-transition-definition",
  manifestPath: "graph/manifests/cli-transition-definition.json",
};
const canonicalNoChangeProfile = "urn:usf:profile:cli-transition-definition:1";
const canonicalNoChangeInput = ".usf/inputs/no-change-request.json";

async function canonicalNoChangeFixture() {
  const isolated = await isolatedPrecompletionRepository();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: isolated.root });
    const common = ["--profile", canonicalNoChangeProfile, "--manifest", canonicalNoChangeSelection.manifestPath];
    const evidence = ".usf/candidates/construction-authority/no-change-test-evidence.json";
    const proof = ".usf/candidates/construction-authority/no-change-test-proof.json";
    await evidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root,
      args: ["construction", "--work", canonicalNoChangeSelection.rootIdentity, ...common, "--output", evidence] });
    await proveCommandHandler({ command: "prove", repositoryRoot: isolated.root,
      args: ["construction", "--obligation", "urn:usf:proof:cli-transition-definition:construction", "--evidence", evidence, ...common, "--output", proof] });
    const publication = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root,
      args: ["construction-authority", "--bundle", proof, ...common, "--apply"] });
    assert.equal((publication.output as { status: string }).status, "ok");
    await mkdir(resolve(isolated.root, ".usf/inputs"), { recursive: true, mode: 0o700 });
    await writeFile(resolve(isolated.root, canonicalNoChangeInput), JSON.stringify(canonicalNoChangeSelection), { mode: 0o600 });
    return isolated;
  } catch (error) { await isolated.cleanup(); throw error; }
}

function runNoChangeCli(root: string) {
  return JSON.parse(execFileSync(process.execPath, [resolve(root, "src/cli.ts"), "realise", "no-change", "--input", canonicalNoChangeInput],
    { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })) as { candidateDigest: string; workspacePath: string; status: string };
}

// Test-only fault boundary: kill after the native effect returns but before stdout acknowledgement.
async function interruptNoChange(root: string, boundary: "before" | "after"): Promise<void> {
  const moduleUrl = pathToFileURL(resolve(root, "src/commands/transition.ts")).href;
  const request = { command: "realise", repositoryRoot: root, args: ["--input", canonicalNoChangeInput] };
  const program = `import {executeTransitionCommand} from ${JSON.stringify(moduleUrl)};
    ${boundary === "after" ? `await executeTransitionCommand(${JSON.stringify(request)}, "realise no-change");` : ""}
    process.stderr.write("FAULT_BOUNDARY_REACHED\\n");
    await new Promise(() => { setInterval(() => {}, 1000); });`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", program], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", reached = false;
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => {
    stderr += String(chunk);
    if (!reached && stderr.includes("FAULT_BOUNDARY_REACHED")) { reached = true; child.kill("SIGTERM"); }
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  try {
    await new Promise<void>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("close", (_code, signal) => {
        try { assert.equal(reached, true, stderr); assert.equal(signal, "SIGTERM"); assert.equal(stdout, ""); resolvePromise(); }
        catch (error) { reject(error); }
      });
    });
  } finally { clearTimeout(timer); }
}

test("canonical no-change CLI restarts around acknowledgement loss and reuses exact retained workspace", {
  skip: isConfinedFixtureProcess && "the direct lane owns subprocess interruption",
}, async () => {
  const isolated = await canonicalNoChangeFixture();
  try {
    await interruptNoChange(isolated.root, "before");
    assert.equal(existsSync(resolve(isolated.root, ".usf/workspaces")), false);
    await interruptNoChange(isolated.root, "after");
    const retained = await readdir(resolve(isolated.root, ".usf/workspaces"));
    assert.equal(retained.length, 1);
    const workspace = resolve(isolated.root, ".usf/workspaces", retained[0]!);
    const manifestPath = resolve(workspace, ".usf-workspace.json");
    const bytes = await readFile(manifestPath);
    const directory = await open(workspace, "r");
    try {
      const before = await directory.stat();
      const result = runNoChangeCli(isolated.root);
      assert.equal(result.status, "ready-for-validation");
      assert.equal(resolve(isolated.root, result.workspacePath), workspace);
      assert.equal((await stat(workspace)).ino, before.ino);
      assert.deepEqual(await readFile(manifestPath), bytes);
      assert.deepEqual(runNoChangeCli(isolated.root), result);
      const legacy = await realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root,
        args: ["no-change", "--work", canonicalNoChangeSelection.rootIdentity, "--profile", canonicalNoChangeProfile,
          "--manifest", canonicalNoChangeSelection.manifestPath] });
      assert.deepEqual(legacy.output, result);
      assert.equal((await stat(workspace)).ino, before.ino);
      assert.deepEqual(await readFile(manifestPath), bytes);
      assert.deepEqual(await readdir(resolve(isolated.root, ".usf/workspaces")), retained);
    } finally { await directory.close(); }
  } finally { await isolated.cleanup(); }
});

test("canonical no-change refuses derived overrides and preserves partial or conflicting retained state", {
  skip: isConfinedFixtureProcess && "the direct lane owns the complete isolated repository",
}, async (t) => {
  const isolated = await canonicalNoChangeFixture();
  const execute = () => executeTransitionCommand({ command: "realise", repositoryRoot: isolated.root,
    args: ["--input", canonicalNoChangeInput] }, "realise no-change");
  try {
    await writeFile(resolve(isolated.root, canonicalNoChangeInput), JSON.stringify({ ...canonicalNoChangeSelection, profile: canonicalNoChangeProfile }), { mode: 0o600 });
    await assert.rejects(execute, { code: "CLI_TRANSITION_INPUT_INVALID" });
    assert.equal(existsSync(resolve(isolated.root, ".usf/workspaces")), false);
    await writeFile(resolve(isolated.root, canonicalNoChangeInput), JSON.stringify(canonicalNoChangeSelection), { mode: 0o600 });
    const sourcePath = resolve(isolated.root, "graph/cli-transition-definition.nq");
    const source = await readFile(sourcePath);
    const admitted = inspectTransition(loadSemanticGraph(isolated.root, canonicalNoChangeSelection.manifestPath), canonicalNoChangeSelection, "realise no-change");
    const nativePrepare = admitted.implementation.prepare;
    let effected: { workspacePath: string } | undefined;
    const injected = t.mock.method(admitted.implementation, "prepare", async (...args: Parameters<typeof nativePrepare>) => {
      const output = await nativePrepare(...args);
      effected = output as { workspacePath: string };
      await writeFile(sourcePath, source.toString("utf8") + '<urn:test:post-effect-drift> <urn:usf:predicate:text> "test-only acknowledgement drift" <urn:usf:graph:cli-transition-definition> .\n');
      return output;
    });
    try { await assert.rejects(execute, { code: "CLI_TRANSITION_STALE" }); }
    finally { injected.mock.restore(); await writeFile(sourcePath, source); }
    assert(effected);
    const effectedWorkspace = resolve(isolated.root, effected.workspacePath);
    const effectedInode = (await stat(effectedWorkspace)).ino;
    const effectedManifest = await readFile(resolve(effectedWorkspace, ".usf-workspace.json"));
    const result = (await execute()).output as { workspacePath: string };
    const workspace = resolve(isolated.root, result.workspacePath);
    assert.equal(workspace, effectedWorkspace);
    assert.equal((await stat(workspace)).ino, effectedInode);
    assert.deepEqual(await readFile(resolve(workspace, ".usf-workspace.json")), effectedManifest);
    const manifestPath = resolve(workspace, ".usf-workspace.json");
    const bytes = await readFile(manifestPath);
    const directory = await open(workspace, "r");
    try {
      const before = await directory.stat();
      await unlink(manifestPath);
      await assert.rejects(execute);
      assert.equal(existsSync(manifestPath), false);
      assert.equal((await stat(workspace)).ino, before.ino);
      await writeFile(manifestPath, "conflicting retained manifest", { mode: 0o600 });
      await assert.rejects(execute);
      assert.equal(await readFile(manifestPath, "utf8"), "conflicting retained manifest");
      assert.equal((await stat(workspace)).ino, before.ino);
      await writeFile(manifestPath, bytes, { mode: 0o600 });
      assert.deepEqual((await execute()).output, result);
    } finally { await directory.close(); }
  } finally { await isolated.cleanup(); }
});
