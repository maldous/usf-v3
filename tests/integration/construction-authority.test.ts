import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { constructionAwarePublishCommandHandler, evidenceCommandHandler, proveCommandHandler } from "../../src/commands/construction-authority.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import type { ConstructionAuthorityPublicationReceipt, ConstructionEvidenceCandidate, ConstructionProofBundle } from "../../src/realisation/construction-authority.ts";

const canonicalRoot = resolve(import.meta.dirname, "../..");
const manifest = "graph/manifests/integration.json";
const profile = "urn:usf:profile:v3-self-host:1";
const work = "urn:usf:work:repository-path-scope";
const obligation = "urn:usf:proof:repository-path-scope:construction-authority";

async function isolatedPrepublicationRepository(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  await mkdir(resolve(canonicalRoot, ".usf/tmp"), { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(resolve(canonicalRoot, ".usf/tmp/construction-authority-test-"));
  const root = resolve(parent, "repository");
  await mkdir(root, { mode: 0o700 });
  for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")) continue;
    await cp(resolve(canonicalRoot, entry.name), resolve(root, entry.name), { recursive: true });
  }

  const receiptDirectory = resolve(root, "evidence/construction-authority");
  if (existsSync(receiptDirectory)) {
    const sourcePath = resolve(root, "graph/integration.nq");
    const removed = new Set<string>();
    for (const name of (await readdir(receiptDirectory)).sort()) {
      const receipt = JSON.parse(await readFile(resolve(receiptDirectory, name), "utf8")) as ConstructionAuthorityPublicationReceipt;
      for (const operation of receipt.operations) removed.add(operation.line);
    }
    const source = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, `${source.split("\n").filter((line) => line.length > 0 && !removed.has(line)).join("\n")}\n`, "utf8");
    await rm(receiptDirectory, { recursive: true, force: true });
  }
  return { root, cleanup: async () => rm(parent, { recursive: true, force: true }) };
}

function packet(root: string) {
  const graph = loadSemanticGraph(root, manifest);
  const result = deriveWork(graph, { profile, selector: work, maxItems: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.length, 1);
  return result.items![0]!;
}

test("construction authority is composable, copy-on-write, scoped-current and idempotent", async () => {
  const isolated = await isolatedPrepublicationRepository();
  try {
    const evidencePath = ".usf/candidates/construction-authority/repository-path-evidence.json";
    const bundlePath = ".usf/candidates/construction-authority/repository-path-bundle.json";
    const evidenceResult = await evidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["construction", "--work", work, "--profile", profile, "--manifest", manifest, "--output", evidencePath] });
    const evidence = evidenceResult.output as ConstructionEvidenceCandidate;
    assert.equal(evidence.workIri, work);
    assert.equal(evidence.status, "candidate");

    const proofResult = await proveCommandHandler({ command: "prove", repositoryRoot: isolated.root, args: ["construction", "--obligation", obligation, "--evidence", evidencePath, "--profile", profile, "--manifest", manifest, "--output", bundlePath] });
    const bundle = proofResult.output as ConstructionProofBundle;
    assert.equal(bundle.proof.outcome, "pass");
    assert.equal(bundle.proof.evidenceDigest, evidence.contentDigest);

    const verify = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["construction-authority", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--verify"] });
    assert.equal((verify.output as { publicationState: string }).publicationState, "verified-without-publication");
    assert.equal(packet(isolated.root).realisationAuthority!.permission!.activationState, "urn:usf:contract-state:proofblocked");

    const applied = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["construction-authority", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--apply"] });
    const appliedOutput = applied.output as { publicationState: string; publicationReceiptPath: string };
    assert.equal(appliedOutput.publicationState, "created");
    assert.ok(existsSync(resolve(isolated.root, appliedOutput.publicationReceiptPath)));
    const active = packet(isolated.root);
    assert.equal(active.realisationAuthority!.permission!.activationState, "urn:usf:contract-state:active");
    assert.equal(active.eligibility!.activation.eligible, true);
    assert.equal(active.eligibility!.construction.authority, "active-permission");
    assert.match(await readFile(resolve(isolated.root, "graph/usf-bootstrap.nq"), "utf8"), /<urn:usf:permission:repository-path-scope> <urn:usf:predicate:activationState> <urn:usf:contract-state:proofblocked>/u);

    const matching = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["construction-authority", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--apply"] });
    assert.equal((matching.output as { publicationState: string }).publicationState, "matching");

    const sourcePath = resolve(isolated.root, "graph/integration.nq");
    const sourceWithGrant = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, `${sourceWithGrant}<urn:usf:test:unrelated-currentness> <urn:usf:predicate:type> <urn:usf:type:SemanticRecordType> <urn:usf:graph:integration> .\n`, "utf8");
    assert.equal(packet(isolated.root).realisationAuthority!.permission!.activationState, "urn:usf:contract-state:active", "unrelated graph movement cannot stale scoped authority");

    for (const relativePath of ["src/cli.ts", "src/commands/help.ts", "package.json", "pnpm-lock.yaml"]) {
      const path = resolve(isolated.root, relativePath);
      const bytes = await readFile(path);
      await writeFile(path, Buffer.concat([bytes, Buffer.from("\n")]));
      assert.equal(packet(isolated.root).realisationAuthority!.permission!.activationState, "urn:usf:contract-state:active", `${relativePath} is not a construction dependency`);
      await writeFile(path, bytes);
    }

    const receipt = JSON.parse(await readFile(resolve(isolated.root, appliedOutput.publicationReceiptPath), "utf8")) as ConstructionAuthorityPublicationReceipt;
    const grantIri = receipt.members[0]!.grantIri;
    const duplicateIri = "urn:usf:test:duplicate-current-construction-grant";
    const duplicateLines = receipt.operations.map(({ line }) => line).filter((line) => line.startsWith(`<${grantIri}> `)).map((line) => line.replace(`<${grantIri}>`, `<${duplicateIri}>`));
    const sourceWithUnrelated = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, `${sourceWithUnrelated}${duplicateLines.join("\n")}\n`, "utf8");
    const ambiguous = packet(isolated.root);
    assert.equal(ambiguous.realisationAuthority!.permission!.activationState, "urn:usf:contract-state:proofblocked");
    assert.ok(ambiguous.eligibility!.activation.reasonCodes.includes(`CONSTRUCTION_AUTHORITY_GRANT_AMBIGUOUS:${work}`));

    await writeFile(sourcePath, sourceWithUnrelated, "utf8");
    await writeFile(resolve(isolated.root, "src/core/scope.ts"), `${await readFile(resolve(isolated.root, "src/core/scope.ts"), "utf8")}\n// relevant scoped movement\n`, "utf8");
    const stale = packet(isolated.root);
    assert.equal(stale.realisationAuthority!.permission!.activationState, "urn:usf:contract-state:proofblocked");
    assert.ok(stale.eligibility!.activation.reasonCodes.includes(`CONSTRUCTION_EVIDENCE_MISSING:urn:usf:evidence-requirement:repository-path-scope`));
    assert.ok(stale.eligibility!.activation.reasonCodes.includes(`CONSTRUCTION_PROOF_RESULT_MISSING:${obligation}`));
    assert.equal(stale.eligibility!.activation.reasonCodes.some((reason) => reason.includes("AMBIGUOUS")), false, "stale historical records are ignored rather than ambiguous");

    await writeFile(resolve(isolated.root, evidencePath), "{}\n", { mode: 0o600 });
    assert.throws(() => proveCommandHandler({ command: "prove", repositoryRoot: isolated.root, args: ["construction", "--obligation", obligation, "--evidence", evidencePath, "--profile", profile, "--manifest", manifest] }), { code: "CONSTRUCTION_EVIDENCE_SCHEMA_INVALID", exitCode: 2 });
  } finally {
    await isolated.cleanup();
  }
});
