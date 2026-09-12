import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { chmod, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";

import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "../../src/commands/construction-authority.ts";
import { executeTransitionCommand, inspectTransition, transitionCommandHandler } from "../../src/commands/transition.ts";
import { admissionCheckHandler } from "../../src/commands/apply.ts";
import {
  completionAwareEvidenceCommandHandler,
  prepareCompletionEvidence,
  completionAwareProveCommandHandler,
  completionAwarePublishCommandHandler,
  prepareCompletionChecks,
  readCompletionValidationSeed,
  realiseCommandHandler,
  realiseNoChangeWork,
} from "../../src/commands/work-completion.ts";
import { loadSemanticGraph, objectValues } from "../../src/graph/index.ts";
import { canonicalQuadDigest, canonicalQuadLine, parseStrictNQuads } from "../../src/graph/nquads.ts";
import { deriveWork } from "../../src/graph/work.ts";
import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import {
  authenticateNoChangeWorkspace,
  currentCandidateWorkspace,
  currentCandidateWorkspaceForCheckRecovery,
  deriveNoChangeCandidateIdentity,
  withAuthenticatedNoChangeWorkspace,
  withAuthenticatedNoChangeWorkspaceForCheckRecovery,
  withCandidateLock,
} from "../../src/realisation/index.ts";
import { ensureGraphDerivedCheck, readGraphDerivedCheckReceipt, readGraphDerivedCheckReceiptForRecovery, type CheckedCandidateReceipt } from "../../src/commands/check.ts";
import {
  deriveNoChangeCompletionAuthority,
  completionPublicationIntentDigest,
  createWorkCompletionPublicationReceipt,
  workCompletionRecordLines,
  type NoChangeCompletionAuthority, type WorkCompletionPublicationMember,
  type CompletionEvidenceCandidate, type CompletionProofBundle, type WorkCompletionPublicationReceipt,
} from "../../src/realisation/work-completion.ts";
import { constructionReceiptPath, deriveConstructionAuthority, validateConstructionReceiptShape, type ConstructionAuthorityPublicationReceipt } from "../../src/realisation/construction-authority.ts";
import { freshCheckedCompletion } from "../fixtures/realisation/checked-completion.ts";

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
  // This helper represents a clean pre-completion repository. Construction
  // grants are publication output in the copied source tree, so retain no
  // historical grant rows that could make the fixture's fresh publication
  // appear partially applied.
  const constructionGrants = resolve(root, "graph/cli-transition-definition-grants.nq");
  if (existsSync(constructionGrants)) {
    const source = await readFile(constructionGrants, "utf8");
    await writeFile(constructionGrants, source.split("\n")
      .filter(line => !line.includes("<urn:usf:grant:construction-authority:"))
      .join("\n"));
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

test("fresh native check reuses an authenticated receipt for the same scoped fixture inputs", {
  skip: isConfinedFixtureProcess && "the authoritative direct lane runs outside mode-2 confinement",
}, async () => {
  const fixture = await checkedReceiptFixture();
  const isolated = await isolatedPrecompletionRepository();
  try {
    const fresh = await freshCheckedCompletion(isolated.root, { work, profile, manifestPath: manifest, validation,
      constructionObligation: "urn:usf:proof:repository-path-scope:construction-authority", name: "repository-path" });
    const readback = await readGraphDerivedCheckReceipt(isolated.root, fresh.candidateDigest, validation);
    assert.ok(readback, "the native check must retain a current receipt for its exact fresh candidate");
    assert.equal(readback.receiptPath, fresh.receiptPath);
    assert.deepEqual(readback.receipt, fresh.receipt);
    assert.deepEqual(await readFile(resolve(isolated.root, fresh.receiptPath)), Buffer.from(canonicalJson(fresh.receipt, { rejectAbsolutePaths: true })));
    const reused = await admissionCheckHandler({ command: "check", repositoryRoot: isolated.root,
      args: ["--candidate", fresh.candidateDigest, "--validation", validation] });
    assert.equal((reused.output as { status?: unknown }).status, "pass", JSON.stringify(reused.output));
    assert.deepEqual(await readGraphDerivedCheckReceipt(isolated.root, fresh.candidateDigest, validation), readback,
      "the same scoped candidate and validation must reuse its authenticated receipt");
    assert.equal(fixture.provenance.receiptDigest, fixture.receipt.receiptDigest, "historical fixture receipt remains integrity/provenance evidence only");
  } finally {
    await isolated.cleanup();
  }
});

test("retained real receipt is reauthenticated before no-change completion effects", {
  skip: isConfinedFixtureProcess && "the authoritative direct lane runs outside mode-2 confinement",
}, async () => {
  const isolated = await isolatedPrecompletionRepository();
  try {
    const fresh = await freshCheckedCompletion(isolated.root, { work, profile, manifestPath: manifest, validation,
      constructionObligation: "urn:usf:proof:repository-path-scope:construction-authority", name: "repository-path" });
    const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root, args: ["no-change", "--work", work, "--profile", profile, "--manifest", manifest] });
    const candidateDigest = fresh.candidateDigest;
    assert.equal((realised.output as { candidateDigest: string }).candidateDigest, candidateDigest, "replay must retain the fresh native candidate identity");
    const currentReceipt = await readGraphDerivedCheckReceipt(isolated.root, candidateDigest, validation);
    assert.ok(currentReceipt, "fresh native check receipt must be current before completion evidence");
    assert.deepEqual(currentReceipt.receipt, fresh.receipt);

    const workspacePath = resolve(isolated.root, fresh.workspacePath);
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
      await assert.rejects(replay, { code: "INVALID_WORKSPACE_MANIFEST", exitCode: 4 });
      assert.equal(await readFile(workspaceManifestPath, "utf8"), "invalid retained manifest");
      await unlink(workspaceManifestPath);
      await assert.rejects(replay, { code: "INVALID_WORKSPACE_MANIFEST", exitCode: 4 });
      assert.equal(existsSync(workspaceManifestPath), false, "partial workspace must not be silently reconstructed");
      assert.equal((await stat(workspacePath)).ino, original.ino);
      await writeFile(workspaceManifestPath, manifestBytes, { mode: 0o600 });
      const extraPath = resolve(workspacePath, "unexpected-replay-input.txt");
      await writeFile(extraPath, "preserve conflicting bytes", { mode: 0o600 });
      await assert.rejects(replay, { code: "CANDIDATE_BASIS_MISMATCH", exitCode: 4 });
      assert.equal(await readFile(extraPath, "utf8"), "preserve conflicting bytes");
      await unlink(extraPath);
      const retainedSourcePath = resolve(workspacePath, "src/core/scope.ts");
      const retainedSource = await readFile(retainedSourcePath);
      await writeFile(retainedSourcePath, "changed retained source");
      await assert.rejects(replay, { code: "CANDIDATE_BASIS_MISMATCH", exitCode: 4 });
      assert.equal(await readFile(retainedSourcePath, "utf8"), "changed retained source");
      await writeFile(retainedSourcePath, retainedSource);
      assert.deepEqual(await replay(), realised);
    } finally { await directory.close(); }

    const preparation = { work, profile, manifestPath: manifest, candidateDigest };
    const evidencePath = ".usf/candidates/work-completion/repository-path-evidence.json";
    const bundlePath = ".usf/candidates/work-completion/repository-path-bundle.json";
    const checkedReceiptPath = resolve(isolated.root, fresh.receiptPath);
    const freshReceiptBytes = await readFile(checkedReceiptPath);
    await unlink(checkedReceiptPath);
    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root,
        args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest] }),
      { code: "WORK_COMPLETION_CHECK_RECEIPT_MISSING", exitCode: 4 },
    );
    await assert.rejects(() => prepareCompletionEvidence(isolated.root, preparation),
      { code: "WORK_COMPLETION_CHECK_RECEIPT_MISSING", exitCode: 4 });
    await writeFile(checkedReceiptPath, freshReceiptBytes, { mode: 0o600 });

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
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root,
        args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", malformedEvidencePath] }),
    );
    assert.equal(existsSync(resolve(isolated.root, malformedEvidencePath)), false, "malformed receipt must refuse before evidence persistence");

    const tamperedEvidencePath = ".usf/candidates/work-completion/refused-integrity-tampered-receipt.json";
    const tamperedReceipt = { ...fresh.receipt, receiptDigest: `sha256:${"0".repeat(64)}` };
    await writeFile(checkedReceiptPath, canonicalJson(tamperedReceipt, { rejectAbsolutePaths: true }), { mode: 0o600 });
    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root,
        args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", tamperedEvidencePath] }),
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
      const changed = rehashedReceipt(fresh.receipt, substitution.key, substitution.value);
      await writeFile(checkedReceiptPath, canonicalJson(changed, { rejectAbsolutePaths: true }), { mode: 0o600 });
      const refusedPath = `.usf/candidates/work-completion/refused-${String(substitution.key)}.json`;
      await assert.rejects(async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root,
        args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", refusedPath] }));
      assert.equal(existsSync(resolve(isolated.root, refusedPath)), false, `${String(substitution.key)} must refuse before evidence persistence`);
    }
    await writeFile(checkedReceiptPath, freshReceiptBytes, { mode: 0o600 });

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
    const historicalReceipt = JSON.parse(await readFile(resolve(isolated.root, appliedOutput.publicationReceiptPath), "utf8")) as { schema?: unknown };
    assert.equal(historicalReceipt.schema, "urn:usf:work-completion-publication-receipt:1", "the retained integration fixture remains an unchanged v1 historical receipt");

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
    const historicalReceiptPath = resolve(isolated.root, appliedOutput.publicationReceiptPath);
    const historicalReceiptBytes = await readFile(historicalReceiptPath);
    const sourceBeforeToolCurrentness = await readFile(sourcePath);
    await writeFile(sourcePath, completedSource, "utf8");
    await writeFile(toolPath, Buffer.concat([toolBytes, Buffer.from("\n// scoped completion authority movement\n")]));
    assert.notEqual(packet(isolated.root).realisationStage?.stage, "verified-complete", "bound implementation movement must stale completion");
    await assert.rejects(
      async () => completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root,
        args: ["work-completion", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--verify"] }),
    );
    assert.deepEqual(await readFile(historicalReceiptPath), historicalReceiptBytes, "v1 history remains byte-identical after native currentness refusal");
    await writeFile(toolPath, toolBytes);
    await writeFile(sourcePath, sourceBeforeToolCurrentness, "utf8");
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

test("published transition authority readback retains predecessors and refuses stale or malformed reentry", async () => {
  const isolated = await isolatedPrecompletionRepository();
  try {
    const transitionManifest = "graph/manifests/self-host.json";
    const transitionProfile = "urn:usf:profile:v3-self-host:1";
    const dependentWork = "urn:usf:work:repository-path-scope";
    const derive = () => deriveWork(loadSemanticGraph(isolated.root, transitionManifest), {
      profile: transitionProfile, selector: dependentWork, maxItems: 1,
    });
    const accepted = () => {
      const result = derive();
      assert.equal(result.status, "ok", "published predecessor authority must derive the selected dependent work");
      assert.equal(result.items?.length, 1);
      assert.equal(result.items?.[0]?.id, dependentWork);
      assert.ok(result.items?.[0]?.realisationBasis, "readback must retain the published predecessor basis");
      return result;
    };
    const refused = (label: string) => {
      const result = derive();
      assert.equal(result.status, "ok", `${label} must retain unaffected queue/readback projection`);
      const affected = result.items?.[0];
      assert.equal(affected?.realisationStage?.stage, "blocked", `${label} must block the affected work without cached acceptance`);
      assert.ok(affected?.eligibility?.construction.reasonCodes.some(reason => /_PERMISSION_CURRENTNESS_UNVERIFIED:/u.test(reason)),
        `${label} must retain the exact permission-currentness refusal`);
    };
    const baseline = accepted();
    assert.deepEqual(accepted(), baseline, "reentry must reauthenticate the same published transition without cached acceptance");
    const receiptPath = resolve(isolated.root, "evidence/semantic-first-bootstrap-admission.json");
    const receiptBytes = await readFile(receiptPath);
    await writeFile(receiptPath, Buffer.concat([receiptBytes, Buffer.from("\n")]));
    refused("stale predecessor evidence bytes");
    await writeFile(receiptPath, receiptBytes);
    const transitionSourcePath = resolve(isolated.root, "graph/semantic-first.nq");
    const transitionSource = await readFile(transitionSourcePath, "utf8");
    await writeFile(transitionSourcePath, `${transitionSource}<urn:usf:test:stale-transition-predecessor> <urn:usf:predicate:type> <urn:usf:type:SemanticRecordType> <urn:usf:graph:semantic-first> .\n`, "utf8");
    refused("stale predecessor source bytes");
    await writeFile(transitionSourcePath, transitionSource, "utf8");
    const malformed = JSON.parse(receiptBytes.toString("utf8")) as { postState?: { members?: unknown[] } };
    assert.ok(Array.isArray(malformed.postState?.members) && malformed.postState.members.length > 1, "published transition fixture must retain a genuine sibling member");
    malformed.postState!.members![1] = { workId: 7 };
    await writeFile(receiptPath, `${canonicalJson(malformed, { rejectAbsolutePaths: true })}\n`);
    refused("malformed published sibling member");
    await writeFile(receiptPath, receiptBytes);
    assert.deepEqual(accepted(), baseline, "restored genuine authority must be independently reauthenticated after every refusal");
  } finally { await isolated.cleanup(); }
});

const canonicalNoChangeSelection = {
  rootIdentity: "urn:usf:work:cli-transition-definition",
  manifestPath: "graph/manifests/cli-transition-definition.json",
};
const canonicalNoChangeProfile = "urn:usf:profile:cli-transition-definition:1";
const canonicalNoChangeInput = ".usf/inputs/no-change-request.json";

interface V2PublicationReceiptMember {
  readonly ordinal: number;
  readonly workIri: string;
  readonly manifestPath: string;
  readonly manifestDigest: string;
}

interface V2PublicationReceipt {
  readonly schema: "urn:usf:work-completion-publication-receipt:2";
  readonly cohortManifestDigest: string;
  readonly memberCount: number;
  readonly members: readonly V2PublicationReceiptMember[];
}

function assertV2PublicationReceipt(value: unknown, expectedMemberCount: number): asserts value is V2PublicationReceipt {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "selected v2 publication must be an object");
  const receipt = value as Record<string, unknown>;
  assert.equal(receipt.schema, "urn:usf:work-completion-publication-receipt:2");
  assert.equal(Object.hasOwn(receipt, "manifestDigest"), false, "v2 replaces the v1 top-level manifest digest with the cohort digest");
  assert.equal(receipt.memberCount, expectedMemberCount);
  assert.ok(Array.isArray(receipt.members));
  assert.equal(receipt.members.length, expectedMemberCount);
  const members = receipt.members as V2PublicationReceiptMember[];
  const aggregate = canonicalDigest(members.map(({ ordinal, workIri, manifestPath, manifestDigest }) =>
    ({ ordinal, workIri, manifestPath, manifestDigest })), { rejectAbsolutePaths: true });
  assert.equal(receipt.cohortManifestDigest, aggregate, "v2 cohort digest must bind ordered member manifest identities");
  for (const [index, member] of members.entries()) {
    assert.equal(member.ordinal, index + 1, "v2 members retain native cohort ordinal order");
    assert.match(member.manifestPath, /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u);
    assert.match(member.manifestDigest, /^sha256:[0-9a-f]{64}$/u);
  }
}

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
    { cwd: root, encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024 })) as { candidateDigest: string; workspacePath: string; status: string };
}

test("root-derived completion checks derive no-effect identity and reconcile a genuine retained set", {
  skip: isConfinedFixtureProcess && "the direct lane owns the graph-derived check fixture",
}, async () => {
  const isolated = await canonicalNoChangeFixture();
  try {
    const request = {
      work: canonicalNoChangeSelection.rootIdentity,
      profile: canonicalNoChangeProfile,
      manifestPath: canonicalNoChangeSelection.manifestPath,
    };
    const graph = loadSemanticGraph(isolated.root, request.manifestPath);
    const selected = deriveWork(graph, { profile: request.profile, selector: request.work, maxItems: 1 });
    assert.equal(selected.status, "ok");
    const work = selected.items?.[0];
    assert.ok(work?.realisationBasis, "genuine fixture must derive a current no-change basis");
    const authority = deriveNoChangeCompletionAuthority(graph, request.work);
    const identity = await deriveNoChangeCandidateIdentity(isolated.root, work.realisationBasis, authority.policy);
    assert.equal(existsSync(resolve(isolated.root, ".usf/workspaces")), false, "identity derivation must not materialise a workspace");
    assert.equal(existsSync(resolve(isolated.root, ".usf/locks/candidates")), false, "identity derivation must not acquire a candidate lock");
    const stale = Object.entries(work.realisationBasis.scope.preimages).find(([, digest]) => digest !== null);
    assert.ok(stale, "genuine fixture must expose a concrete scoped preimage");
    const [stalePath] = stale;
    const staleBytes = await readFile(resolve(isolated.root, stalePath));
    await writeFile(resolve(isolated.root, stalePath), Buffer.concat([staleBytes, Buffer.from("\n")]), { mode: 0o600 });
    await assert.rejects(
      () => deriveNoChangeCandidateIdentity(isolated.root, work.realisationBasis!, authority.policy),
      { reasonCode: "STALE_REALISATION_BASIS" },
    );
    await writeFile(resolve(isolated.root, stalePath), staleBytes, { mode: 0o600 });
    assert.equal(await deriveNoChangeCandidateIdentity(isolated.root, work.realisationBasis, authority.policy), identity);

    const native = await realiseNoChangeWork(isolated.root, request);
    assert.equal(native.candidateDigest, identity, "identity must match the native no-change result");
    const workspaceIdentity = await withAuthenticatedNoChangeWorkspace(isolated.root, identity, async (workspace) => {
      assert.equal(workspace.candidateDigest, identity);
      await assert.rejects(
        () => withCandidateLock(isolated.root, identity, async () => undefined),
        { reasonCode: "CANDIDATE_BUSY" },
        "the authenticated callback retains the native candidate lock",
      );
      return workspace.workspaceIdentityDigest;
    });
    assert.equal(workspaceIdentity, (await authenticateNoChangeWorkspace(isolated.root, identity)).workspaceIdentityDigest);
    const workspace = (await currentCandidateWorkspace(isolated.root, identity)).workspace;
    const runtime = resolve(workspace, ".usf-check-tmp");
    await mkdir(runtime, { mode: 0o700 });
    await chmod(runtime, 0o700);
    await writeFile(resolve(runtime, "interrupted-check-state"), "pending", { mode: 0o600 });
    await assert.rejects(
      () => currentCandidateWorkspace(isolated.root, identity),
      { reasonCode: "CANDIDATE_BASIS_MISMATCH" },
      "ordinary candidate reads must not admit check runtime contents",
    );
    await assert.rejects(
      () => authenticateNoChangeWorkspace(isolated.root, identity),
      { reasonCode: "CANDIDATE_BASIS_MISMATCH" },
      "ordinary no-change authentication must remain strict",
    );
    assert.equal((await currentCandidateWorkspaceForCheckRecovery(isolated.root, identity)).workspace, workspace);
    const recoveryWorkspaceIdentity = await withAuthenticatedNoChangeWorkspaceForCheckRecovery(isolated.root, identity, async (authenticated) => {
      await assert.rejects(
        () => withCandidateLock(isolated.root, identity, async () => undefined),
        { reasonCode: "CANDIDATE_BUSY" },
        "the recovery callback retains the native candidate lock",
      );
      return authenticated.workspaceIdentityDigest;
    });
    assert.equal(recoveryWorkspaceIdentity, workspaceIdentity, "the owned runtime is excluded from the authenticated candidate tree");
    await rm(runtime, { recursive: true, force: true });

    await writeFile(runtime, "not a directory", { mode: 0o700 });
    await assert.rejects(
      () => currentCandidateWorkspaceForCheckRecovery(isolated.root, identity),
      { reasonCode: "CANDIDATE_BASIS_MISMATCH" },
      "check recovery rejects a non-directory runtime boundary",
    );
    await rm(runtime, { force: true });
    await mkdir(runtime, { mode: 0o700 });
    await chmod(runtime, 0o755);
    await assert.rejects(
      () => currentCandidateWorkspaceForCheckRecovery(isolated.root, identity),
      { reasonCode: "CANDIDATE_BASIS_MISMATCH" },
      "check recovery rejects a runtime boundary with non-private mode",
    );
    await rm(runtime, { recursive: true, force: true });
    const runtimeTarget = resolve(isolated.root, ".usf", "runtime-target");
    await mkdir(runtimeTarget, { recursive: true, mode: 0o700 });
    await chmod(runtimeTarget, 0o700);
    await symlink(runtimeTarget, runtime);
    await assert.rejects(
      () => currentCandidateWorkspaceForCheckRecovery(isolated.root, identity),
      { reasonCode: "CANDIDATE_BASIS_MISMATCH" },
      "check recovery rejects a symlinked runtime boundary",
    );
    await unlink(runtime);
    await rm(runtimeTarget, { recursive: true, force: true });
    await mkdir(runtime, { mode: 0o700 });
    await chmod(runtime, 0o700);
    await mkdir(resolve(workspace, ".usf-check-tmp-other"), { mode: 0o700 });
    await assert.rejects(
      () => currentCandidateWorkspaceForCheckRecovery(isolated.root, identity),
      { reasonCode: "CANDIDATE_BASIS_MISMATCH" },
      "check recovery does not admit extra workspace paths",
    );
    await rm(runtime, { recursive: true, force: true });
    await rm(resolve(workspace, ".usf-check-tmp-other"), { recursive: true, force: true });
    const expectedObligations = [...(work.realisationAuthority?.completionValidationObligations ?? [])].sort();
    assert.ok(expectedObligations.length > 1, "genuine fixture must have a partial-retention denominator");
    const retainedObligation = expectedObligations[0]!;
    const absentObligation = expectedObligations[1]!;
    const receiptPath = join(isolated.root, ".usf", "receipts", "check", identity.slice("sha256:".length), `${canonicalDigest(retainedObligation).slice("sha256:".length)}.json`);
    const pendingPath = `${receiptPath}.pending`;
    const interrupted = spawn(process.execPath, [resolve(canonicalRoot, "tests/fixtures/realisation/check-interruption.ts"),
      isolated.root, identity, retainedObligation, "pending-synced", pendingPath], {
      cwd: isolated.root, env: {}, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let launches = 0, successfulExits = 0, reached = false, stdout = "", stderr = "", childResult: unknown;
    interrupted.stdout!.on("data", chunk => { stdout += String(chunk); });
    interrupted.stderr!.on("data", chunk => { stderr += String(chunk); });
    interrupted.on("message", (message: unknown) => {
      if (message === null || typeof message !== "object") return;
      const event = message as Record<string, unknown>;
      if (event.kind === "validation-spawn") launches++;
      if (event.kind === "validation-exit" && event.code === 0 && event.signal === null) successfulExits++;
      if (event.kind === "unexpected-result" || event.kind === "result") childResult = event.result;
      if (event.kind === "boundary" && event.boundary === "pending-synced") {
        reached = true;
        interrupted.kill("SIGKILL");
      }
    });
    const timeout = setTimeout(() => interrupted.kill("SIGKILL"), 300_000);
    try {
      const ended = await new Promise<{ readonly signal: NodeJS.Signals | null }>((accept, reject) => {
        interrupted.once("error", reject);
        interrupted.once("close", (_code, signal) => accept({ signal }));
      });
      const diagnosticOutput = (childResult as { failureDiagnostic?: { stdoutCapturedBase64?: string } } | undefined)?.failureDiagnostic?.stdoutCapturedBase64;
      const decodedDiagnostic = diagnosticOutput === undefined ? undefined : Buffer.from(diagnosticOutput, "base64").toString("utf8");
      assert.equal(reached, true, stderr || stdout || decodedDiagnostic || JSON.stringify(childResult));
      assert.equal(ended.signal, "SIGKILL");
      assert.equal(stdout, "", stderr);
    } finally { clearTimeout(timeout); }
    assert.equal(launches, 1, "pending receipt is produced by one genuine native child");
    assert.equal(successfulExits, 1, "the retained pending receipt follows a genuine successful child exit");
    const retainedBytes = await readFile(pendingPath);
    const retainedIdentity = await lstat(pendingPath);
    const intentPath = receiptPath.replace(/\.json$/u, ".intent.json");
    assert.equal(JSON.parse(await readFile(intentPath, "utf8")).state, "STARTED");
    assert.equal(await readGraphDerivedCheckReceiptForRecovery(isolated.root, identity, retainedObligation), null, "pending publication is not a current receipt before native reconciliation");
    assert.equal(await readGraphDerivedCheckReceipt(isolated.root, identity, absentObligation), null, "only one genuine member is retained before preparation");

    const first = await prepareCompletionChecks(isolated.root, request);
    assert.equal(first.status, "current");
    assert.equal(first.workIri, request.work);
    assert.equal(first.profileIri, request.profile);
    assert.equal(first.candidateDigest, identity);
    assert.deepEqual(first.validationObligations, expectedObligations);
    const receipts = first.receipts as readonly { readonly obligationIri: string }[];
    assert.equal(receipts.length, expectedObligations.length, "only the graph-required receipt denominator is acknowledged");
    assert.deepEqual(receipts.map(receipt => receipt.obligationIri).sort(), expectedObligations);
    const retainedAfter = await readGraphDerivedCheckReceipt(isolated.root, identity, retainedObligation);
    assert.ok(retainedAfter, "the retained member is reconciled through the native primitive");
    assert.deepEqual(await readFile(resolve(isolated.root, retainedAfter.receiptPath)), retainedBytes, "retained current receipt is reconciled without replacement");
    assert.equal((await lstat(resolve(isolated.root, retainedAfter.receiptPath))).ino, retainedIdentity.ino, "reconciliation retains the genuine pending receipt identity without redispatch");
    await assert.rejects(() => lstat(pendingPath), { code: "ENOENT" });
    assert.equal(JSON.parse(await readFile(intentPath, "utf8")).state, "SETTLED");
    assert.ok(await readGraphDerivedCheckReceipt(isolated.root, identity, absentObligation), "the genuinely absent member is produced through the native primitive");
    const { receiptSetDigest, ...stableSet } = first;
    assert.equal(receiptSetDigest, canonicalDigest(stableSet, { rejectAbsolutePaths: true }));

    const seed = await readCompletionValidationSeed(isolated.root, request);
    assert.deepEqual(seed, first, "the persisted seed must be the authenticated complete receipt-set result");
    const missingSeedReceipt = resolve(isolated.root, retainedAfter!.receiptPath);
    const retainedSeedReceiptBytes = await readFile(missingSeedReceipt);
    await unlink(missingSeedReceipt);
    await assert.rejects(() => readCompletionValidationSeed(isolated.root, request), { code: "WORK_COMPLETION_SEED_NOT_CURRENT" });
    await writeFile(missingSeedReceipt, retainedSeedReceiptBytes, { mode: 0o600 });

    const replay = await prepareCompletionChecks(isolated.root, request);
    assert.deepEqual(replay, first, "a complete retained set has stable readback after native per-member reconciliation");
  } finally { await isolated.cleanup(); }
});

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
  const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
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

const legacyCohort = Object.freeze([
  Object.freeze({ work: "urn:usf:work:repository-path-scope", validation: "urn:usf:validation:repository-path-tests", obligation: "urn:usf:proof:repository-path-scope", constructionObligation: "urn:usf:proof:repository-path-scope:construction-authority", name: "repository-path" }),
  Object.freeze({ work: "urn:usf:work:file-asset-index", validation: "urn:usf:validation:file-asset-index-tests", obligation: "urn:usf:proof:file-asset-index", constructionObligation: "urn:usf:proof:file-asset-index:construction-authority", name: "file-asset-index" }),
]);

async function removeIsolatedConstructionAuthorityHistory(root: string): Promise<void> {
  const receiptDirectory = resolve(root, "evidence/construction-authority");
  if (!existsSync(receiptDirectory)) return;
  const sourcePath = "graph/integration.nq";
  const sourceAbsolute = resolve(root, sourcePath);
  const source = await readFile(sourceAbsolute, "utf8");
  const sourceLines = source.split("\n").filter(line => line.length > 0);
  const graph = loadSemanticGraph(root, manifest);
  const cohortWorks: ReadonlySet<string> = new Set(legacyCohort.map(member => member.work));
  const selected: Array<Readonly<{ path: string; receipt: ConstructionAuthorityPublicationReceipt }>> = [];
  const receiptBytes = new Map<string, Buffer>();
  for (const name of (await readdir(receiptDirectory)).sort()) {
    const path = resolve(receiptDirectory, name);
    const bytes = await readFile(path);
    receiptBytes.set(path, bytes);
    let receipt: ConstructionAuthorityPublicationReceipt;
    try { receipt = JSON.parse(bytes.toString("utf8")) as ConstructionAuthorityPublicationReceipt; }
    catch { continue; }
    const member = receipt.memberCount === 1 && receipt.members.length === 1 ? receipt.members[0] : undefined;
    if (receipt.manifestPath !== manifest || receipt.profileIri !== profile || receipt.semanticSourcePath !== sourcePath
      || member === undefined || !cohortWorks.has(member.workIri)) continue;
    const authority = deriveConstructionAuthority(graph, member.workIri);
    assert.equal(validateConstructionReceiptShape(root, receipt, authority), true, `selected construction receipt must satisfy its current closed schema: ${name}`);
    const { receiptDigest, ...draft } = receipt;
    assert.equal(receiptDigest, canonicalDigest(draft, { rejectAbsolutePaths: true }), `selected construction receipt must retain its canonical digest: ${name}`);
    assert.equal(receipt.deltaDigest, canonicalDigest(receipt.operations, { rejectAbsolutePaths: true }), `selected construction receipt must retain its exact operation digest: ${name}`);
    assert.equal(bytes.toString("utf8"), `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`, `selected construction receipt must retain canonical bytes: ${name}`);
    assert.equal(receipt.publicationReceiptPath, constructionReceiptPath(receipt.publicationIntentDigest, authority), `selected construction receipt must bind its exact receipt path: ${name}`);
    assert.equal(resolve(root, receipt.publicationReceiptPath), path, `selected construction receipt must be stored at its bound path: ${name}`);
    selected.push(Object.freeze({ path, receipt }));
  }
  assert.ok(selected.length > 0, "fixture must remove authenticated pre-existing construction history for the cohort");
  assert.deepEqual(new Set(selected.map(({ receipt }) => receipt.members[0]!.workIri)), cohortWorks, "fixture must reset both and only the actual cohort members' construction history");
  const removed = new Set<string>();
  for (const { receipt } of selected) {
    for (const operation of receipt.operations) {
      assert.equal(operation.kind, "add");
      assert.equal(operation.sourcePath, sourcePath, "selected construction operations must target only integration.nq");
      assert.equal(sourceLines.filter(line => line === operation.line).length, 1, "each selected construction operation must occur exactly once in integration.nq");
      assert.equal(removed.has(operation.line), false, "selected construction operation lines must not overlap");
      removed.add(operation.line);
    }
  }
  await writeFile(sourceAbsolute, `${sourceLines.filter(line => !removed.has(line)).join("\n")}\n`, "utf8");
  for (const { path } of selected) await unlink(path);
  const sourceAfter = (await readFile(sourceAbsolute, "utf8")).split("\n").filter(line => line.length > 0);
  assert.deepEqual(sourceAfter, sourceLines.filter(line => !removed.has(line)), "only authenticated selected construction operation lines may be removed");
  for (const [path, bytes] of receiptBytes) {
    if (!selected.some(candidate => candidate.path === path)) assert.deepEqual(await readFile(path), bytes, `unselected construction receipt must remain byte-identical: ${path}`);
  }
}

async function isolatedLegacyCohortVariant(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const isolated = await isolatedPrecompletionRepository();
  try {
    await removeIsolatedConstructionAuthorityHistory(isolated.root);
    const bootstrapPath = resolve(isolated.root, "graph/usf-bootstrap.nq");
    const originalBootstrap = await readFile(bootstrapPath, "utf8");
    const originalGraph = loadSemanticGraph(isolated.root, manifest);
    const dependencyRow = `<urn:usf:work:file-asset-index> <urn:usf:predicate:dependsOn> <urn:usf:work:repository-path-scope> <urn:usf:graph:usf-bootstrap> .`;
    assert.equal(originalBootstrap.split("\n").filter(line => line === dependencyRow).length, 1, "the original fixture must retain the native dependent-cohort refusal edge");
    assert.doesNotThrow(() => deriveConstructionAuthority(originalGraph, legacyCohort[0]!.work));
    assert.doesNotThrow(() => deriveConstructionAuthority(originalGraph, legacyCohort[1]!.work));
    await writeFile(bootstrapPath, removeExactNQuadRow(originalBootstrap, dependencyRow), "utf8");
    await adoptV2PublicationSchemaForIsolatedCohort(isolated.root);

    const variantGraph = loadSemanticGraph(isolated.root, manifest);
    for (const member of legacyCohort) {
      assert.doesNotThrow(() => deriveConstructionAuthority(variantGraph, member.work));
      assert.doesNotThrow(() => deriveNoChangeCompletionAuthority(variantGraph, member.work));
    }
    assert.equal(await readFile(bootstrapPath, "utf8").then(bytes => bytes.includes(dependencyRow)), false, "only the isolated bootstrap dependency edge is removed");
    return isolated;
  } catch (error) { await isolated.cleanup(); throw error; }
}

async function adoptV2PublicationSchemaForIsolatedCohort(root: string): Promise<void> {
  const sourcePath = resolve(root, "graph/integration.nq");
  const source = await readFile(sourcePath, "utf8");
  assert.equal(existsSync(resolve(root, "schemas/work-completion-publication-receipt-v2.schema.json")), true, "isolated repository copy must retain the tracked v2 receipt schema bytes");
  const cliSource = await readFile(resolve(canonicalRoot, "graph/cli-transition-definition.nq"), "utf8");
  const profileAuthoritySource = await readFile(resolve(canonicalRoot, "graph/profile-authority.nq"), "utf8");
  const graph = "urn:usf:graph:integration";
  const profileAuthorityGraph = "urn:usf:graph:profile-authority";
  const cliGraph = "urn:usf:graph:cli-transition-definition";
  const policy = "urn:usf:publication-policy:no-change-work-completion:1";
  const cliPolicy = "urn:usf:publication-policy:cli-transition-definition-no-change-completion:1";
  const algorithm = "urn:usf:algorithm:copy-on-write-work-completion-publication:1";
  const cliAlgorithm = "urn:usf:algorithm:cli-transition-definition-work-completion-publication:1";
  const subjects = new Set([
    "urn:usf:rule:completion-publication-reauthentication:1",
    "urn:usf:rule:completion-publication-snapshot-authentication:1",
    "urn:usf:rule:completion-publication-cohort-snapshot:1",
    "urn:usf:rule:completion-publication-member-manifests:2",
    "urn:usf:rule:completion-publication-member-basis:1",
    "urn:usf:rule:completion-publication-receipt-schema-selection:1",
    "urn:usf:schema-binding:completion-publication-receipt:1",
    "urn:usf:schema-binding:completion-publication-receipt:2",
    "urn:usf:type:CliFieldDerivationRule",
    "urn:usf:type:SemanticRecordSchemaBinding",
    "urn:usf:predicate:admittedBinding",
    "urn:usf:predicate:contextBinding",
    "urn:usf:predicate:dependencyConstraint",
    "urn:usf:predicate:manifestPathConstraint",
    "urn:usf:predicate:memberAuthentication",
    "urn:usf:predicate:memberAuthenticationRule",
    "urn:usf:predicate:otherSchemaVersion",
    "urn:usf:predicate:producedValue",
    "urn:usf:predicate:refusedInput",
    "urn:usf:predicate:requiredReadback",
    "urn:usf:predicate:schemaRole",
    "urn:usf:predicate:schemaSelectionRule",
  ]);
  const selected = cliSource.split("\n").filter(line => [...subjects].some(subject => line.startsWith(`<${subject}> `)))
    .map(line => line.replaceAll(`<${cliGraph}>`, `<${graph}>`).replaceAll(`<${cliPolicy}>`, `<${policy}>`).replaceAll(`<${cliAlgorithm}>`, `<${algorithm}>`));
  assert.ok(selected.length > 0, "fixture must import exact governed v2 selection and member-authentication declarations");
  const v2SchemaSubject = "urn:usf:schema:work-completion-publication-receipt:2";
  const v2SchemaRows = profileAuthoritySource.split("\n")
    .filter(line => line.startsWith(`<${v2SchemaSubject}> `))
    .map(line => line.replaceAll(`<${profileAuthorityGraph}>`, `<${graph}>`));
  assert.deepEqual(v2SchemaRows, [
    `<${v2SchemaSubject}> <urn:usf:predicate:type> <urn:usf:type:SemanticRecordSchema> <${graph}> .`,
    `<${v2SchemaSubject}> <urn:usf:predicate:version> "2" <${graph}> .`,
    `<${v2SchemaSubject}> <urn:usf:predicate:repositoryPath> "schemas/work-completion-publication-receipt-v2.schema.json" <${graph}> .`,
  ], "fixture must retain exactly the tracked v2 schema type, version and repository-path declarations");
  const v2DigestMembershipRows = cliSource.split("\n")
    .filter(line => line.startsWith(`<${v2SchemaSubject}> <urn:usf:predicate:digestMembership> `))
    .map(line => line.replaceAll(`<${cliGraph}>`, `<${graph}>`));
  assert.deepEqual(v2DigestMembershipRows, [
    `<${v2SchemaSubject}> <urn:usf:predicate:digestMembership> <urn:usf:rule:completion-publication-member-manifests:2> <${graph}> .`,
  ], "fixture must retain the governed v2 digest-membership declaration independently of the profile schema record");
  const v1Schema = `<${policy}> <urn:usf:predicate:publicationReceiptSchema> <urn:usf:schema:work-completion-publication-receipt:1> <${graph}> .`;
  const v1Path = `<${policy}> <urn:usf:predicate:schemaPath> "schemas/work-completion-publication-receipt.schema.json" <${graph}> .`;
  assert.equal(source.split(v1Schema).length - 1, 1, "isolated policy must have one v1 schema selection");
  assert.equal(source.split(v1Path).length - 1, 1, "isolated policy must have one v1 schema path");
  const v2Schema = `<${policy}> <urn:usf:predicate:publicationReceiptSchema> <urn:usf:schema:work-completion-publication-receipt:2> <${graph}> .`;
  const v2Path = `<${policy}> <urn:usf:predicate:schemaPath> "schemas/work-completion-publication-receipt-v2.schema.json" <${graph}> .`;
  const selectionRule = `<${policy}> <urn:usf:predicate:schemaSelectionRule> <urn:usf:rule:completion-publication-receipt-schema-selection:1> <${graph}> .`;
  const v2CarrierPath = `<urn:usf:carrier-intent:no-change-completion-cli:1> <urn:usf:predicate:allowedPath> "schemas/work-completion-publication-receipt-v2.schema.json" <${graph}> .`;
  const rows = source.slice(0, -1).split("\n").filter(line => line !== v1Schema && line !== v1Path);
  for (const row of [v2Schema, v2Path, selectionRule, v2CarrierPath, ...selected, ...v2SchemaRows, ...v2DigestMembershipRows]) if (!rows.includes(row)) rows.push(row);
  const adopted = `${rows.join("\n")}\n`;
  assert.doesNotThrow(() => parseStrictNQuads(adopted, graph));
  await writeFile(sourcePath, adopted, "utf8");
  const closure = loadSemanticGraph(root, manifest);
  assert.equal(closure.manifests.some(({ path }) => path === "graph/manifests/profile-authority.json"), false, "isolated selection must not broaden its manifest closure with profile-authority command declarations");
  assert.equal(closure.quads.some(quad => quad.subject === "urn:usf:schema:work-completion-publication-receipt:2"
    && quad.predicate === "urn:usf:predicate:repositoryPath" && quad.object === "schemas/work-completion-publication-receipt-v2.schema.json"), true,
  "isolated selection must bind the v2 receipt record path");
}

function removeExactNQuadRow(source: string, row: string): string {
  assert.equal(source.endsWith("\n"), true, "fixture semantic source must retain its canonical terminal newline");
  assert.equal(source.includes("\r"), false, "fixture semantic source must retain LF-only canonical bytes");
  const rows = source.slice(0, -1).split("\n");
  assert.equal(rows.filter((candidate) => candidate === row).length, 1, "fixture variant must remove one exact semantic row");
  return `${rows.filter((candidate) => candidate !== row).join("\n")}\n`;
}

test("isolated legacy cohort edge removal preserves strict N-Quads", async () => {
  const dependencyRow = `<urn:usf:work:file-asset-index> <urn:usf:predicate:dependsOn> <urn:usf:work:repository-path-scope> <urn:usf:graph:usf-bootstrap> .`;
  const source = await readFile(resolve(canonicalRoot, "graph/usf-bootstrap.nq"), "utf8");
  const variant = removeExactNQuadRow(source, dependencyRow);
  assert.equal(variant.split("\n").filter((row) => row === dependencyRow).length, 0, "variant must omit only the dependency row");
  assert.doesNotThrow(() => parseStrictNQuads(variant, "urn:usf:graph:usf-bootstrap"));
});

test("publication intent binds the native proof bundle digest beyond a work and manifest tuple", () => {
  const graph = loadSemanticGraph(canonicalRoot, canonicalNoChangeSelection.manifestPath);
  const authority = deriveNoChangeCompletionAuthority(graph, canonicalNoChangeSelection.rootIdentity);
  const packet = deriveWork(graph, { profile: canonicalNoChangeProfile, selector: canonicalNoChangeSelection.rootIdentity, maxItems: 1 }).items?.[0];
  assert.ok(packet?.realisationBasis, "intent probe must use the genuine selected manifest digest");
  const common = Object.freeze({
    evidence: Object.freeze({ workIri: canonicalNoChangeSelection.rootIdentity, manifestPath: canonicalNoChangeSelection.manifestPath, manifestDigest: packet.realisationBasis.selection.manifestDigest }),
  }) as unknown as CompletionProofBundle;
  const first = completionPublicationIntentDigest(
    [Object.freeze({ ...common, bundleDigest: `sha256:${"1".repeat(64)}` }) as CompletionProofBundle],
    canonicalNoChangeProfile, canonicalNoChangeSelection.manifestPath, authority,
  );
  const second = completionPublicationIntentDigest(
    [Object.freeze({ ...common, bundleDigest: `sha256:${"2".repeat(64)}` }) as CompletionProofBundle],
    canonicalNoChangeProfile, canonicalNoChangeSelection.manifestPath, authority,
  );
  assert.notEqual(first, second, "native publication intent must not collapse distinct proof bundles with the same work and manifest tuple");
});

async function genuineLegacyMember(root: string, member: typeof legacyCohort[number], freshConstruction = true) {
  const memberManifest = manifest;
  if (freshConstruction) {
    const constructionEvidencePath = `.usf/candidates/construction-authority/${member.name}-cohort-evidence.json`;
    const constructionBundlePath = `.usf/candidates/construction-authority/${member.name}-cohort-bundle.json`;
    await evidenceCommandHandler({ command: "evidence", repositoryRoot: root,
      args: ["construction", "--work", member.work, "--profile", profile, "--manifest", memberManifest, "--output", constructionEvidencePath] });
    await proveCommandHandler({ command: "prove", repositoryRoot: root,
      args: ["construction", "--obligation", member.constructionObligation, "--evidence", constructionEvidencePath, "--profile", profile, "--manifest", memberManifest, "--output", constructionBundlePath] });
    const construction = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root,
      args: ["construction-authority", "--bundle", constructionBundlePath, "--profile", profile, "--manifest", memberManifest, "--apply"] });
    assert.equal((construction.output as { status: string }).status, "ok", `${member.name} must receive fresh isolated construction authority`);
  }
  const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: root,
    args: ["no-change", "--work", member.work, "--profile", profile, "--manifest", memberManifest] });
  const candidateDigest = (realised.output as { candidateDigest: string }).candidateDigest;
  const checked = await admissionCheckHandler({ command: "check", repositoryRoot: root,
    args: ["--candidate", candidateDigest, "--validation", member.validation] });
  assert.equal((checked.output as { status: string }).status, "pass", `${member.name} must have one native checked receipt: ${JSON.stringify(checked.output)}`);
  const evidencePath = `.usf/candidates/work-completion/${member.name}-cohort-evidence.json`;
  const bundlePath = `.usf/candidates/work-completion/${member.name}-cohort-bundle.json`;
  const evidence = await completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: root,
    args: ["completion", "--candidate", candidateDigest, "--work", member.work, "--profile", profile, "--manifest", memberManifest, "--output", evidencePath] });
  const proof = await completionAwareProveCommandHandler({ command: "prove", repositoryRoot: root,
    args: ["completion", "--obligation", member.obligation, "--evidence", evidencePath, "--profile", profile, "--manifest", memberManifest, "--output", bundlePath] });
  const packet = deriveWork(loadSemanticGraph(root, memberManifest), { profile, selector: member.work, maxItems: 1 }).items?.[0];
  assert.ok(packet?.realisationBasis, `${member.name} must retain an independently derived original basis`);
  const bundle = proof.output as CompletionProofBundle;
  return Object.freeze({ bundlePath, member: Object.freeze({ work: member.work, manifestPath: bundle.evidence.manifestPath, manifestDigest: bundle.evidence.manifestDigest,
    originalBasisDigest: packet.realisationBasis.basisDigest, candidateDigest, proofBundleDigest: canonicalDigest(bundle, { rejectAbsolutePaths: true }) }) });
}

async function genuineLegacyCohort(root: string, freshConstruction = true, requireDistinctManifestDigests = false) {
  const bundles: string[] = [];
  const members: Array<{ work: string; manifestPath: string; manifestDigest: string; originalBasisDigest: string; candidateDigest: string; proofBundleDigest: string }> = [];
  for (const member of legacyCohort) {
    const prepared = await genuineLegacyMember(root, member, freshConstruction);
    bundles.push(prepared.bundlePath);
    members.push(prepared.member);
  }
  assert.equal(new Set(members.map((member) => member.work)).size, 2, "genuine cohort members remain distinct");
  if (requireDistinctManifestDigests) assert.equal(new Set(members.map((member) => member.manifestDigest)).size, 2, "genuine v2 cohort members must retain distinct selected manifest digests before publication");
  assert.equal(new Set(members.map((member) => member.proofBundleDigest)).size, 2, "bundle digest remains distinct from native receipt identities");
  return Object.freeze({ bundles: Object.freeze(bundles), members: Object.freeze(members) });
}

test("legacy completion publication refuses the original genuine dependent cohort without effects", {
  skip: isConfinedFixtureProcess && "the direct lane owns native cohort publication",
}, async () => {
  const isolated = await isolatedPrecompletionRepository();
  try {
    const predecessor = await genuineLegacyMember(isolated.root, legacyCohort[0]!, true);
    const predecessorPublication = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root,
      args: ["work-completion", "--bundle", predecessor.bundlePath, "--profile", profile, "--manifest", manifest, "--apply"] });
    assert.equal((predecessorPublication.output as { publicationState: string }).publicationState, "created", "the predecessor must be genuinely accepted before the dependent member can be constructed");
    assert.equal(packet(isolated.root).realisationStage?.stage, "verified-complete", "the predecessor acceptance must be current before dependent construction");

    const dependent = await genuineLegacyMember(isolated.root, legacyCohort[1]!, true);
    // The dependent construction changes semantic authority; rederive the predecessor bundle instead of replaying stale proof bytes.
    const refreshedPredecessor = await genuineLegacyMember(isolated.root, legacyCohort[0]!, false);
    const cohort = Object.freeze({ bundles: Object.freeze([refreshedPredecessor.bundlePath, dependent.bundlePath]) });
    const sourceBefore = await readFile(resolve(isolated.root, "graph/integration.nq"));
    const receiptsBefore = await readdir(resolve(isolated.root, "evidence/work-completion"));
    const candidatesBefore = [...(await regularTree(resolve(isolated.root, ".usf/candidates/work-completion")))].map(([path, entry]) => [path, entry.mode, entry.digest]);
    const args = ["work-completion", ...cohort.bundles.flatMap((bundle) => ["--bundle", bundle]), "--profile", profile, "--manifest", manifest, "--verify"];
    await assert.rejects(
      async () => { await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args }); },
      { code: "WORK_COMPLETION_DEPENDENT_COHORT_REFUSED" },
    );
    assert.deepEqual(await readFile(resolve(isolated.root, "graph/integration.nq")), sourceBefore, "dependent cohort refusal must not mutate the semantic source");
    assert.deepEqual(await readdir(resolve(isolated.root, "evidence/work-completion")), receiptsBefore, "dependent cohort refusal must not create a publication receipt");
    assert.deepEqual(
      [...(await regularTree(resolve(isolated.root, ".usf/candidates/work-completion")))].map(([path, entry]) => [path, entry.mode, entry.digest]),
      candidatesBefore,
      "dependent cohort refusal must not persist a publication snapshot",
    );
  } finally { await isolated.cleanup(); }
});

async function interruptLegacyPublication(root: string, sourcePath: string, bundles: readonly string[], boundary: "before-source" | "source-before-receipt" | "receipt-before-ack") {
  const child = spawn(process.execPath, [resolve(canonicalRoot, "tests/fixtures/realisation/completion-publication-interruption.ts"),
    root, canonicalRoot, "legacy", legacyCohort[0]!.work, profile, manifest, boundary, sourcePath, ...bundles], { cwd: root, env: {}, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let reached = false;
  let stderr = "";
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  child.on("message", (message: unknown) => {
    if (message !== null && typeof message === "object" && (message as { kind?: string }).kind === "boundary") {
      reached = true;
      child.kill("SIGKILL");
    }
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 300_000);
  try {
    const ended = await new Promise<{ signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (_code, signal) => accept({ signal }));
    });
    assert.equal(reached, true, stderr);
    assert.equal(ended.signal, "SIGKILL");
  } finally { clearTimeout(timeout); }
}

type CanonicalPublicationBoundary = "before-source" | "source-before-receipt" | "receipt-pending-before-link" | "receipt-linked-before-cleanup" | "receipt-before-ack";

async function interruptCanonicalPublication(root: string, sourcePath: string, boundary: CanonicalPublicationBoundary): Promise<Readonly<{ receiptPendingPath?: string; receiptPath?: string }>> {
  const child = spawn(process.execPath, [resolve(canonicalRoot, "tests/fixtures/realisation/completion-publication-interruption.ts"),
    root, canonicalRoot, "canonical", canonicalNoChangeSelection.rootIdentity, canonicalNoChangeProfile,
    canonicalNoChangeSelection.manifestPath, boundary, sourcePath], { cwd: root, env: {}, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let reached = false;
  let stderr = "";
  let observation: Readonly<{ receiptPendingPath?: string; receiptPath?: string }> = {};
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  child.on("message", (message: unknown) => {
    if (message !== null && typeof message === "object" && (message as { kind?: string }).kind === "boundary") {
      reached = true;
      observation = message as Readonly<{ receiptPendingPath?: string; receiptPath?: string }>;
      child.kill("SIGKILL");
    }
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 300_000);
  try {
    const ended = await new Promise<{ signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (_code, signal) => accept({ signal }));
    });
    assert.equal(reached, true, stderr);
    assert.equal(ended.signal, "SIGKILL");
    return observation;
  } finally { clearTimeout(timeout); }
}

async function prepareGenuineCanonicalPublicationRoot(root: string): Promise<void> {
  const request = Object.freeze({
    work: canonicalNoChangeSelection.rootIdentity,
    profile: canonicalNoChangeProfile,
    manifestPath: canonicalNoChangeSelection.manifestPath,
  });
  const realised = await realiseNoChangeWork(root, request);
  assert.equal(realised.status, "ready-for-validation", "canonical publication starts from a native no-change workspace");
  await prepareCompletionChecks(root, request);
}

interface RegularTreeEntry {
  readonly mode: number;
  readonly digest: string;
  readonly inode: number;
}

async function regularTree(root: string): Promise<ReadonlyMap<string, RegularTreeEntry>> {
  const entries = new Map<string, RegularTreeEntry>();
  const visit = async (relative: string): Promise<void> => {
    const directory = resolve(root, relative);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = relative.length === 0 ? entry.name : join(relative, entry.name);
      const child = resolve(root, childRelative);
      const metadata = await lstat(child);
      assert.equal(metadata.isSymbolicLink(), false, `seed copies admit no symbolic links: ${childRelative}`);
      if (metadata.isDirectory()) await visit(childRelative);
      else {
        assert.equal(metadata.isFile(), true, `seed copies admit only regular files: ${childRelative}`);
        entries.set(childRelative, Object.freeze({ mode: metadata.mode & 0o777, digest: rawDigest(await readFile(child)), inode: metadata.ino }));
      }
    }
  };
  await visit("");
  return entries;
}

async function assertNoCheckRuntimeResidue(root: string): Promise<void> {
  const tree = await regularTree(root);
  for (const path of tree.keys()) {
    assert.equal(path.endsWith(".pending"), false, `checked seed cannot retain pending state: ${path}`);
    assert.equal(path.includes(".usf-check-tmp/"), false, `checked seed cannot retain check scratch: ${path}`);
  }
  const locksRoot = resolve(root, ".usf/locks/candidates");
  if (!existsSync(locksRoot)) return;
  for (const name of (await readdir(locksRoot)).sort()) {
    assert.match(name, /^[0-9a-f]{64}\.lock$/u, `candidate lock inventory must remain exact: ${name}`);
    const candidateDigest = `sha256:${name.slice(0, -".lock".length)}`;
    const before = await lstat(resolve(locksRoot, name));
    await withCandidateLock(root, candidateDigest, async () => undefined);
    const after = await lstat(resolve(locksRoot, name));
    assert.equal(after.isFile(), true);
    assert.equal(after.isSymbolicLink(), false);
    assert.equal(after.dev, before.dev, `native lock acquisition must preserve retained lock device: ${name}`);
    assert.equal(after.ino, before.ino, `native lock acquisition must preserve retained lock inode: ${name}`);
    assert.equal(after.nlink, before.nlink, `native lock acquisition must preserve retained lock link count: ${name}`);
    assert.equal(after.mode & 0o777, before.mode & 0o777, `native lock acquisition must preserve retained lock mode: ${name}`);
  }
}

test("a retained unheld candidate lock is authenticated by native acquisition", async () => {
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(resolve(temporaryRoot, "retained-candidate-lock-"));
  const candidateDigest = `sha256:${"a".repeat(64)}`;
  try {
    await withCandidateLock(root, candidateDigest, async () => undefined);
    const lockPath = resolve(root, ".usf/locks/candidates", `${candidateDigest.slice("sha256:".length)}.lock`);
    const before = await lstat(lockPath);
    await assertNoCheckRuntimeResidue(root);
    const after = await lstat(lockPath);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode & 0o777, before.mode & 0o777);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const canonicalSeedRequest = Object.freeze({
  work: canonicalNoChangeSelection.rootIdentity,
  profile: canonicalNoChangeProfile,
  manifestPath: canonicalNoChangeSelection.manifestPath,
});

let checkedCanonicalPrepublicationSeed: Promise<{ root: string; cleanup: () => Promise<void> }> | undefined;

async function canonicalCheckedPrepublicationSeed(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  if (checkedCanonicalPrepublicationSeed === undefined) {
    checkedCanonicalPrepublicationSeed = (async () => {
      const seed = await canonicalNoChangeFixture();
      try {
        await prepareGenuineCanonicalPublicationRoot(seed.root);
        await assertSettledCompleteCheckSet(seed.root);
        await assertNoCheckRuntimeResidue(seed.root);
        return seed;
      } catch (error) { await seed.cleanup(); throw error; }
    })();
  }
  return checkedCanonicalPrepublicationSeed;
}

after(async () => {
  if (checkedCanonicalPrepublicationSeed !== undefined) await (await checkedCanonicalPrepublicationSeed).cleanup();
});

async function assertSettledCompleteCheckSet(root: string): Promise<Readonly<{ candidateDigest: string; obligations: readonly string[] }>> {
  const moduleUrl = pathToFileURL(resolve(canonicalRoot, "src/commands/work-completion.ts")).href;
  const program = `import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const originalSpawn = childProcess.spawn;
    let validationLaunches = 0;
    childProcess.spawn = ((...args) => {
      if (args[0] === "/usr/bin/bwrap") validationLaunches++;
      return originalSpawn(...args);
    });
    syncBuiltinESMExports();
    const native = await import(${JSON.stringify(moduleUrl)});
    const result = await native.prepareCompletionChecks(${JSON.stringify(root)}, ${JSON.stringify(canonicalSeedRequest)});
    process.stdout.write(JSON.stringify({ validationLaunches, result }));`;
  let observed: { validationLaunches?: unknown; result?: unknown };
  try {
    observed = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: root, encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024,
    })) as { validationLaunches?: unknown; result?: unknown };
  } catch (error: unknown) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    assert.fail(`instrumented public prepareCompletionChecks failed: ${detail}`);
  }
  assert.equal(observed!.validationLaunches, 0, "a complete copied receipt set must not launch validation during public preparation");
  const prepared = observed!.result as Record<string, unknown>;
  assert.equal(prepared.status, "current");
  const candidateDigest = prepared.candidateDigest as string;
  const obligations = prepared.validationObligations as readonly string[];
  assert.ok(candidateDigest.startsWith("sha256:"));
  assert.ok(obligations.length > 0);
  for (const obligation of obligations) {
    const receipt = await readGraphDerivedCheckReceipt(root, candidateDigest, obligation);
    assert.ok(receipt, `complete seed must retain a current receipt for ${obligation}`);
    const intentPath = resolve(root, receipt.receiptPath.replace(/\.json$/u, ".intent.json"));
    assert.equal(JSON.parse(await readFile(intentPath, "utf8")).state, "SETTLED", `complete seed must retain a settled intent for ${obligation}`);
  }
  return Object.freeze({ candidateDigest, obligations: Object.freeze([...obligations]) });
}

async function canonicalCheckedPrepublicationClone(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const seed = await canonicalCheckedPrepublicationSeed();
  const parent = await mkdtemp(resolve(temporaryRoot, "completion-publication-seed-copy-"));
  const root = resolve(parent, "repository");
  try {
    await cp(seed.root, root, { recursive: true, force: false, errorOnExist: true });
    const seedTree = await regularTree(seed.root);
    const cloneTree = await regularTree(root);
    assert.deepEqual(
      [...cloneTree].map(([path, entry]) => [path, entry.mode, entry.digest]),
      [...seedTree].map(([path, entry]) => [path, entry.mode, entry.digest]),
      "each clone preserves exact checked seed bytes and modes",
    );
    for (const [path, seedEntry] of seedTree) {
      assert.notEqual(cloneTree.get(path)?.inode, seedEntry.inode, `each regular seed file is independently copied: ${path}`);
    }
    await assertNoCheckRuntimeResidue(root);
    const before = await regularTree(root);
    await assertSettledCompleteCheckSet(root);
    const afterPrepare = await regularTree(root);
    assert.deepEqual(
      [...afterPrepare].map(([path, entry]) => [path, entry.mode, entry.digest, entry.inode]),
      [...before].map(([path, entry]) => [path, entry.mode, entry.digest, entry.inode]),
      "complete-set authentication preserves copied receipt and intent provenance",
    );
    return { root, cleanup: async () => rm(parent, { recursive: true, force: true }) };
  } catch (error) { await rm(parent, { recursive: true, force: true }); throw error; }
}

test("v2 completion publication retains a genuine two-member independent cohort and refuses member tampering", {
  skip: isConfinedFixtureProcess && "the direct lane owns native cohort publication",
}, async () => {
  const isolated = await isolatedLegacyCohortVariant();
  try {
    const cohort = await genuineLegacyCohort(isolated.root, true, true);
    const args = ["work-completion", ...cohort.bundles.flatMap((bundle) => ["--bundle", bundle]), "--profile", profile, "--manifest", manifest];
    const verified = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: [...args, "--verify"] });
    assert.equal((verified.output as { publicationState: string; memberCount: number }).publicationState, "absent");
    assert.equal((verified.output as { memberCount: number }).memberCount, 2);
    const applied = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: [...args, "--apply"] });
    const output = applied.output as { publicationState: string; publicationReceiptPath: string; memberCount: number; works: readonly string[] };
    assert.equal(output.publicationState, "created");
    assert.equal(output.memberCount, 2);
    assert.deepEqual([...output.works].sort(), cohort.members.map((member) => member.work).sort());
    const receiptPath = resolve(isolated.root, output.publicationReceiptPath);
    const receiptBytes = await readFile(receiptPath);
    const receipt: unknown = JSON.parse(receiptBytes.toString("utf8"));
    assertV2PublicationReceipt(receipt, 2);
    const authentic = receipt as V2PublicationReceipt & Record<string, unknown>;
    assert.deepEqual(authentic.members.map((member) => member.workIri).sort(), cohort.members.map((member) => member.work).sort());
    assert.deepEqual(
      authentic.members.map(({ workIri, manifestPath, manifestDigest }) => ({ workIri, manifestPath, manifestDigest })),
      [...cohort.members].sort((left, right) => left.work.localeCompare(right.work)).map(({ work, manifestPath, manifestDigest }) => ({ workIri: work, manifestPath, manifestDigest })),
      "v2 receipt must retain each genuine member manifest identity",
    );
    assert.equal(new Set(authentic.members.map((member) => member.manifestDigest)).size, 2, "v2 receipt must preserve the distinct pre-publication member manifest digests");
    const sourcePath = resolve(isolated.root, "graph/integration.nq");
    const refuseReceiptMutation = async (label: string, mutated: Record<string, unknown>): Promise<void> => {
      const sourceBefore = await readFile(sourcePath);
      await writeFile(receiptPath, `${canonicalJson(mutated, { rejectAbsolutePaths: true })}\n`, { mode: 0o644 });
      try {
        await assert.rejects(
          async () => completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: [...args, "--verify"] }),
        );
        assert.deepEqual(await readFile(sourcePath), sourceBefore, `${label} must not mutate the integration source`);
      } finally { await writeFile(receiptPath, receiptBytes, { mode: 0o644 }); }
    };
    const authenticReceipt = receipt as WorkCompletionPublicationReceipt;
    const authority = deriveNoChangeCompletionAuthority(loadSemanticGraph(isolated.root, manifest), legacyCohort[0]!.work);
    const rehash = (members: readonly Record<string, unknown>[], aggregateOverride?: string): Record<string, unknown> => {
      const native = createWorkCompletionPublicationReceipt({
        authority,
        publicationIntentDigest: authenticReceipt.publicationIntentDigest,
        profileIri: authenticReceipt.profileIri,
        profileVersion: authenticReceipt.profileVersion,
        manifestPath: authenticReceipt.manifestPath,
        manifestDigest: authentic.members[0]!.manifestDigest,
        authorityDependencies: authenticReceipt.authorityDependencies,
        baseSourceDigest: authenticReceipt.baseSourceDigest,
        resultingSourceDigest: authenticReceipt.resultingSourceDigest,
        baseSemanticDigest: authenticReceipt.baseSemanticDigest,
        resultingSemanticDigest: authenticReceipt.resultingSemanticDigest,
        members: members as unknown as readonly WorkCompletionPublicationMember[],
        operations: authenticReceipt.operations,
      });
      const { receiptDigest: _ignored, ...body } = native;
      const validationResultDigest = aggregateOverride === undefined ? native.validationResultDigest : canonicalDigest({
        members: members.map(({ workIri, realisationDigest, evidenceDigest, proofDigest }) => ({ workIri, realisationDigest, evidenceDigest, proofDigest })),
        cohortManifestDigest: aggregateOverride,
        operationCount: native.operations.length,
        authorityDependencyDigest: native.authorityDependencyDigest,
        resultingSemanticDigest: native.resultingSemanticDigest,
      }, { rejectAbsolutePaths: true });
      const mutated = aggregateOverride === undefined ? body : { ...body, cohortManifestDigest: aggregateOverride, validationResultDigest };
      return { ...mutated, receiptDigest: canonicalDigest(mutated, { rejectAbsolutePaths: true }) };
    };
    const copiedMembers = () => authentic.members.map(member => ({ ...member })) as Record<string, unknown>[];
    const swapped = copiedMembers();
    [swapped[0]!.manifestDigest, swapped[1]!.manifestDigest] = [swapped[1]!.manifestDigest, swapped[0]!.manifestDigest];
    await refuseReceiptMutation("swapped per-member manifest digests", rehash(swapped));
    await refuseReceiptMutation("altered cohort manifest aggregate", rehash(copiedMembers(), `sha256:${"0".repeat(64)}`));
    const staleSibling = copiedMembers();
    staleSibling[1]!.manifestDigest = staleSibling[0]!.manifestDigest;
    await refuseReceiptMutation("stale sibling manifest identity", rehash(staleSibling));
    const assetIndexPath = resolve(isolated.root, "src/core/asset-index.ts");
    const assetIndexBytes = await readFile(assetIndexPath);
    const assetIndexMode = (await stat(assetIndexPath)).mode & 0o777;
    const deriveMember = (member: typeof legacyCohort[number]) => {
      const result = deriveWork(loadSemanticGraph(isolated.root, manifest), { profile, selector: member.work, maxItems: 1 });
      assert.equal(result.status, "ok", `${member.name} must remain graph-derivable during sibling currentness readback`);
      assert.equal(result.items?.length, 1);
      return result.items![0]!;
    };
    const repositoryPathBefore = deriveMember(legacyCohort[0]!);
    assert.equal(repositoryPathBefore.readSet.includes("src/core/asset-index.ts"), false, "repository-path-scope must not bind the file-asset-index scoped source");
    const repositoryPathBasis = repositoryPathBefore.realisationBasis?.basisDigest;
    assert.ok(repositoryPathBasis, "repository-path-scope must retain its independent genuine basis");
    const fileAssetBefore = deriveMember(legacyCohort[1]!);
    const fileAssetBasis = fileAssetBefore.realisationBasis?.basisDigest;
    assert.ok(fileAssetBasis, "file-asset-index must retain its independently derived genuine basis");
    try {
      await writeFile(assetIndexPath, Buffer.concat([assetIndexBytes, Buffer.from("\n")]), { mode: assetIndexMode });
      for (const order of [legacyCohort, [...legacyCohort].reverse()] as const) {
        for (const member of order) {
          const packet = deriveMember(member);
          assert.equal(packet.realisationStage?.completion.verified, false, `${member.name} must not retain completion after the genuine sibling-source mutation`);
          if (member.work === legacyCohort[0]!.work) assert.equal(packet.realisationBasis?.basisDigest, repositoryPathBasis, "unscoped sibling source mutation must not alter repository-path-scope's own basis");
          if (member.work === legacyCohort[1]!.work) assert.notEqual(packet.realisationBasis?.basisDigest, fileAssetBasis, "file-asset-index scoped source mutation must alter its own basis");
        }
      }
    } finally {
      await writeFile(assetIndexPath, assetIndexBytes, { mode: assetIndexMode });
      await chmod(assetIndexPath, assetIndexMode);
    }
    const replay = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: [...args, "--apply"] });
    assert.equal((replay.output as { publicationState: string; memberCount: number }).publicationState, "matching");
    assert.equal((replay.output as { memberCount: number }).memberCount, 2);
  } finally { await isolated.cleanup(); }
});

const canonicalPublicationRecoveryBoundaries = ["before-source", "source-before-receipt", "receipt-pending-before-link", "receipt-linked-before-cleanup", "receipt-before-ack"] as const;

for (const boundary of canonicalPublicationRecoveryBoundaries) {
  test(`canonical completion publication resumes the exact retained intent at ${boundary}`, async () => {
    const native: typeof import("../../src/commands/work-completion.ts") =
      await import(pathToFileURL(resolve(canonicalRoot, "src/commands/work-completion.ts")).href);
    const request = Object.freeze({ rootIdentity: canonicalNoChangeSelection.rootIdentity, manifestPath: canonicalNoChangeSelection.manifestPath });
    const isolated = await canonicalCheckedPrepublicationClone();
    try {
      const authority = deriveNoChangeCompletionAuthority(
        loadSemanticGraph(isolated.root, canonicalNoChangeSelection.manifestPath), canonicalNoChangeSelection.rootIdentity,
      );
      const interrupted = await interruptCanonicalPublication(isolated.root, authority.sourcePath, boundary);
      let retained: Readonly<{ readonly path: string; readonly bytes: Buffer; readonly inode: number }> | null = null;
      if (boundary === "receipt-pending-before-link") {
        assert.ok(interrupted.receiptPendingPath?.startsWith(`${isolated.root}/`), "fixture must report the actual contained pending receipt");
        const entry = await lstat(interrupted.receiptPendingPath!);
        assert.equal(entry.isFile(), true);
        assert.equal(entry.nlink, 1, "durable pending receipt must precede the hard link");
        retained = Object.freeze({ path: interrupted.receiptPendingPath!, bytes: await readFile(interrupted.receiptPendingPath!), inode: entry.ino });
      } else if (boundary === "receipt-linked-before-cleanup") {
        assert.ok(interrupted.receiptPendingPath?.startsWith(`${isolated.root}/`), "fixture must report the actual linked pending receipt");
        assert.ok(interrupted.receiptPath?.startsWith(`${isolated.root}/`), "fixture must report the actual linked final receipt");
        const pending = await lstat(interrupted.receiptPendingPath!);
        const final = await lstat(interrupted.receiptPath!);
        assert.equal(pending.isFile(), true);
        assert.equal(pending.nlink, 2, "linked receipt must retain the durable pending inode before cleanup");
        assert.equal(final.ino, pending.ino);
        retained = Object.freeze({ path: interrupted.receiptPendingPath!, bytes: await readFile(interrupted.receiptPendingPath!), inode: pending.ino });
      }
      const resumed = await native.runCanonicalCompletionPublication(isolated.root, Object.freeze({ ...request, mode: "apply" }));
      const replay = await native.runCanonicalCompletionPublication(isolated.root, Object.freeze({ ...request, mode: "apply" }));
      const verified = await native.runCanonicalCompletionPublication(isolated.root, Object.freeze({ ...request, mode: "verify" }));
      assert.equal((resumed as { memberCount: number }).memberCount, 1, `${boundary} recovery must retain the exact singleton cohort`);
      assert.equal((replay as { publicationState: string }).publicationState, "matching", `${boundary} replay must not publish a second receipt`);
      assert.equal((verified as { publicationState: string }).publicationState, "matching", `${boundary} verify must read the recovered native receipt`);
      const receipt = JSON.parse(await readFile(resolve(isolated.root, (resumed as { publicationReceiptPath: string }).publicationReceiptPath), "utf8"));
      assertV2PublicationReceipt(receipt, 1);
      if (retained !== null) {
        const receiptPath = resolve(isolated.root, (resumed as { publicationReceiptPath: string }).publicationReceiptPath);
        const final = await lstat(receiptPath);
        assert.equal(final.ino, retained.inode, `${boundary} recovery must retain the original durable receipt inode`);
        assert.deepEqual(await readFile(receiptPath), retained.bytes, `${boundary} recovery must retain the original durable receipt bytes`);
        await assert.rejects(() => lstat(retained.path), { code: "ENOENT" });
        assert.equal((await lstat(receiptPath)).ino, final.ino, `${boundary} replay must not replace the recovered receipt`);
      }
    } finally { await isolated.cleanup(); }
  });
}

test("transition inspection refuses an unsupported selected publication receipt schema without effects", async () => {
  const isolated = await isolatedPrecompletionRepository();
  try {
    const sourcePath = resolve(isolated.root, "graph/cli-transition-definition.nq");
    const source = await readFile(sourcePath, "utf8");
    const evaluator = "urn:usf:rule:completion-terminal-native-evaluation:1";
    const evaluatorSourceDigest = canonicalQuadDigest(
      loadSemanticGraph(isolated.root, canonicalNoChangeSelection.manifestPath).quads.filter(quad => quad.subject === evaluator),
    );
    const selectedBinding = '<urn:usf:schema-binding:completion-publication-receipt:2> <urn:usf:predicate:version> "2" <urn:usf:graph:cli-transition-definition> .';
    assert.equal(source.split(selectedBinding).length - 1, 1, "fixture must mutate the one selected v2 schema binding");
    await writeFile(sourcePath, source.replace(selectedBinding, selectedBinding.replace('"2"', '"3"')));
    const graphBefore = await readFile(sourcePath);
    const receiptDirectory = resolve(isolated.root, "evidence/work-completion");
    const receiptsBefore = existsSync(receiptDirectory)
      ? await Promise.all((await readdir(receiptDirectory)).sort().map(async name => Object.freeze([name, await readFile(resolve(receiptDirectory, name))] as const)))
      : [];
    const result = await transitionCommandHandler({ command: "transition", repositoryRoot: isolated.root,
      args: ["inspect", "--root", canonicalNoChangeSelection.rootIdentity, "--manifest", canonicalNoChangeSelection.manifestPath] }, []);
    const output = result.output as {
      readonly complete: boolean;
      readonly executionAuthority: string;
      readonly terminalClosure: { readonly assessment: {
        readonly authenticatedArtifacts: readonly unknown[];
        readonly reasonCodes: readonly string[];
        readonly diagnostics: readonly { readonly reasonCode: string; readonly subject: string; readonly sourceDigest: string; readonly observedTargets: readonly string[] }[];
      } };
      readonly diagnostics: readonly { readonly reasonCode: string; readonly subject: string; readonly field: string }[];
    };
    assert.equal(output.complete, false);
    assert.equal(output.executionAuthority, "none");
    assert.deepEqual(output.terminalClosure.assessment.authenticatedArtifacts, []);
    const expectedDiagnostic = Object.freeze({ reasonCode: "TRANSITION_TERMINAL_EVALUATION_REFUSED", subject: evaluator,
      sourceDigest: evaluatorSourceDigest, observedTargets: Object.freeze([] as string[]) });
    assert.equal(output.terminalClosure.assessment.reasonCodes.filter(reason => reason === expectedDiagnostic.reasonCode).length, 1);
    assert.deepEqual(output.diagnostics.filter(diagnostic => diagnostic.reasonCode === expectedDiagnostic.reasonCode), [{
      reasonCode: expectedDiagnostic.reasonCode, subject: evaluator, field: "publicationReceiptSchema",
    }],
      "unsupported selected schema must surface one exact top-level evaluator refusal");
    assert.deepEqual(output.terminalClosure.assessment.diagnostics.filter(diagnostic => diagnostic.reasonCode === expectedDiagnostic.reasonCode), [expectedDiagnostic],
      "unsupported selected schema must surface one exact nested evaluator refusal");
    assert.deepEqual(await readFile(sourcePath), graphBefore, "inspection must not mutate the unsupported schema binding");
    const receiptsAfter = existsSync(receiptDirectory)
      ? await Promise.all((await readdir(receiptDirectory)).sort().map(async name => Object.freeze([name, await readFile(resolve(receiptDirectory, name))] as const)))
      : [];
    assert.deepEqual(receiptsAfter, receiptsBefore, "inspection must not create or rewrite completion receipts");
  } finally { await isolated.cleanup(); }
});

test("canonical terminal evaluation refuses altered evaluator and artifact lineage", async () => {
  const isolated = await canonicalCheckedPrepublicationClone();
  try {
    const native: typeof import("../../src/commands/work-completion.ts") =
      await import(pathToFileURL(resolve(canonicalRoot, "src/commands/work-completion.ts")).href);
    const request = Object.freeze({ rootIdentity: canonicalNoChangeSelection.rootIdentity, manifestPath: canonicalNoChangeSelection.manifestPath });
    const publication = await native.runCanonicalCompletionPublication(isolated.root, Object.freeze({ ...request, mode: "apply" }));
    assert.equal((publication as { publicationState: string }).publicationState, "created");
    assert.equal(native.evaluateCanonicalCompletionTerminal(isolated.root, request).authenticatedArtifacts.length, 1);
    const sourcePath = resolve(isolated.root, "graph/cli-transition-definition.nq");
    const source = await readFile(sourcePath, "utf8");
    const replaceExactly = (from: string, to: string): string => {
      assert.equal(source.split(from).length - 1, 1, `expected one current graph artifact field: ${from}`);
      return source.replace(from, to);
    };
    const refuseOrEmpty = async (mutated: string) => {
      await writeFile(sourcePath, mutated);
      try {
        assert.deepEqual(native.evaluateCanonicalCompletionTerminal(isolated.root, request).authenticatedArtifacts, []);
      } catch (error: unknown) {
        const code = error !== null && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        assert.ok(code === "WORK_COMPLETION_TERMINAL_ARTIFACT_INVALID" || code === "WORK_COMPLETION_TERMINAL_STALE",
          `lineage mutation must refuse or produce no accepted artifacts: ${detail}`);
      }
    };
    try {
      await writeFile(sourcePath, replaceExactly("Accept only a fresh native evaluateNoChangeCompletionRecords", "Mutated evaluator text"));
      assert.throws(() => native.evaluateCanonicalCompletionTerminal(isolated.root, request), { code: "WORK_COMPLETION_TERMINAL_EVALUATOR_INVALID" });
      await refuseOrEmpty(`${source}<urn:usf:test:arbitrary-terminal-artifact> <urn:usf:predicate:authenticationRule> <urn:usf:rule:completion-terminal-native-evaluation:1> <urn:usf:graph:cli-transition-definition> .\n`);
      await refuseOrEmpty(replaceExactly(
        "<urn:usf:cli-contract:completion-publication-artifact:1> <urn:usf:predicate:producer> <urn:usf:cli-transition:completion-publication:1>",
        "<urn:usf:cli-contract:completion-publication-artifact:1> <urn:usf:predicate:producer> <urn:usf:cli-transition:wrong-producer:1>",
      ));
      await refuseOrEmpty(replaceExactly(
        "<urn:usf:cli-contract:completion-publication-artifact:1> <urn:usf:predicate:work> <urn:usf:work:cli-transition-definition>",
        "<urn:usf:cli-contract:completion-publication-artifact:1> <urn:usf:predicate:work> <urn:usf:work:wrong-work>",
      ));
      await refuseOrEmpty(replaceExactly(
        "<urn:usf:cli-contract:completion-publication-artifact:1> <urn:usf:predicate:profile> <urn:usf:profile:cli-transition-definition:1>",
        "<urn:usf:cli-contract:completion-publication-artifact:1> <urn:usf:predicate:profile> <urn:usf:profile:wrong-profile:1>",
      ));
      const artifact = "urn:usf:cli-contract:completion-publication-artifact:1";
      const schemaPredicate = "urn:usf:predicate:schema";
      const selectedSchemas = objectValues(loadSemanticGraph(isolated.root, canonicalNoChangeSelection.manifestPath), artifact, schemaPredicate);
      assert.equal(selectedSchemas.length, 1, "terminal artifact must select exactly one current schema field");
      const [artifactSchema] = parseStrictNQuads(source, "urn:usf:graph:cli-transition-definition")
        .filter(quad => quad.subject === artifact && quad.predicate === schemaPredicate && quad.object === selectedSchemas[0]);
      assert.ok(artifactSchema, "selected artifact schema must have one canonical source quad");
      await refuseOrEmpty(replaceExactly(artifactSchema.canonical, canonicalQuadLine({ ...artifactSchema, object: "urn:usf:schema:wrong-publication-receipt:1" })));
    } finally { await writeFile(sourcePath, source); }
  } finally { await isolated.cleanup(); }
});
