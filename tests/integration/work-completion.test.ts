import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { admissionCheckHandler } from "../../src/commands/apply.ts";
import {
  constructionAwarePublishCommandHandler,
  evidenceCommandHandler as constructionEvidenceCommandHandler,
  proveCommandHandler as constructionProveCommandHandler,
} from "../../src/commands/construction-authority.ts";
import {
  completionAwareEvidenceCommandHandler,
  completionAwareProveCommandHandler,
  completionAwarePublishCommandHandler,
  realiseCommandHandler,
} from "../../src/commands/work-completion.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import type { CompletionEvidenceCandidate, CompletionProofBundle, WorkCompletionPublicationReceipt } from "../../src/realisation/work-completion.ts";

const canonicalRoot = resolve(import.meta.dirname, "../..");
const manifest = "graph/manifests/integration.json";
const profile = "urn:usf:profile:v3-self-host:1";
const work = "urn:usf:work:repository-path-scope";
const validation = "urn:usf:validation:repository-path-tests";
const obligation = "urn:usf:proof:repository-path-scope";
const constructionObligation = "urn:usf:proof:repository-path-scope:construction-authority";

async function isolatedPrecompletionRepository(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  await mkdir(resolve(canonicalRoot, ".usf/tmp"), { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(resolve(canonicalRoot, ".usf/tmp/work-completion-test-"));
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
  const constructionEvidencePath = ".usf/candidates/construction-authority/work-completion-fixture-evidence.json";
  const constructionBundlePath = ".usf/candidates/construction-authority/work-completion-fixture-bundle.json";
  await constructionEvidenceCommandHandler({ command: "evidence", repositoryRoot: root, args: ["construction", "--work", work, "--profile", profile, "--manifest", manifest, "--output", constructionEvidencePath] });
  await constructionProveCommandHandler({ command: "prove", repositoryRoot: root, args: ["construction", "--obligation", constructionObligation, "--evidence", constructionEvidencePath, "--profile", profile, "--manifest", manifest, "--output", constructionBundlePath] });
  await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root, args: ["construction-authority", "--bundle", constructionBundlePath, "--profile", profile, "--manifest", manifest, "--apply"] });
  return { root, cleanup: async () => rm(parent, { recursive: true, force: true }) };
}

function packet(root: string) {
  const result = deriveWork(loadSemanticGraph(root, manifest), { profile, selector: work, maxItems: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.length, 1);
  return result.items![0]!;
}

test("no-change completion is checked, copy-on-write, scoped-current and idempotent", async () => {
  const isolated = await isolatedPrecompletionRepository();
  try {
    assert.equal(packet(isolated.root).eligibility?.construction.authority, "active-permission");
    const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root, args: ["no-change", "--work", work, "--profile", profile, "--manifest", manifest] });
    const candidateDigest = (realised.output as { candidateDigest: string }).candidateDigest;
    assert.match(candidateDigest, /^sha256:[0-9a-f]{64}$/u);

    await assert.rejects(
      async () => completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest] }),
      { code: "WORK_COMPLETION_CHECK_RECEIPT_MISSING", exitCode: 4 },
    );

    const checked = await admissionCheckHandler({ command: "check", repositoryRoot: isolated.root, args: ["--candidate", candidateDigest, "--validation", validation] });
    assert.equal((checked.output as { status: string }).status, "pass");

    const evidencePath = ".usf/candidates/work-completion/repository-path-evidence.json";
    const bundlePath = ".usf/candidates/work-completion/repository-path-bundle.json";
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
