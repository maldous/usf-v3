// Regenerate the checked-candidate receipt fixture through the governed path.
//
// The fixture under tests/fixtures/work-completion/ is a real receipt produced
// by the actual no-change realisation and graph-derived admission check, not an
// authored file. Its provenance names this script so a successor can reproduce
// it from tracked source: a generator that exists only in ignored state makes
// the fixture unreproducible from a fresh clone, which is the defect this
// replaces.
//
//   node scripts/generate-checked-receipt-fixture.mjs [--write]
//
// Without --write it produces the receipt and provenance and prints them,
// comparing against the committed fixture and exiting non-zero on drift.
// With --write it updates the committed fixture.
//
// Both lanes run here exactly as the contract separates them. The producer lane
// invokes the real network-isolated check. The consumer lane reconstructs the
// same pre-completion fixture, reproduces the exact candidate digest, installs
// only the retained receipt beneath the derived .usf receipt path at mode 0600
// and invokes the production completion evidence, proof and publication verify
// handlers without launching another check.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  completionAwareEvidenceCommandHandler,
  completionAwareProveCommandHandler,
  completionAwarePublishCommandHandler,
  realiseCommandHandler,
} from "../src/commands/work-completion.ts";
import { canonicalDigest, canonicalJson } from "../src/core/canonical.ts";
// The governed producer lane already exists as tracked source and is the same
// helper the direct test lane uses. Reuse it rather than restating construction
// publication, realisation and admission check here.
import { freshCheckedCompletion } from "../tests/fixtures/realisation/checked-completion.ts";
import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "../src/commands/construction-authority.ts";

const canonicalRoot = resolve(import.meta.dirname, "..");
const manifest = "graph/manifests/integration.json";
const profile = "urn:usf:profile:v3-self-host:1";
const work = "urn:usf:work:repository-path-scope";
const validation = "urn:usf:validation:repository-path-tests";
const obligation = "urn:usf:proof:repository-path-scope";
const constructionObligation = "urn:usf:proof:repository-path-scope:construction-authority";
const generatorCommand = ["node", "scripts/generate-checked-receipt-fixture.mjs"];
const fixtureDirectory = resolve(canonicalRoot, "tests/fixtures/work-completion");
const receiptFixturePath = resolve(fixtureDirectory, "repository-path-checked-receipt.json");
const provenanceFixturePath = resolve(fixtureDirectory, "repository-path-checked-receipt.provenance.json");
const write = process.argv.includes("--write");

const temporaryRoot = process.env.TMPDIR ?? resolve(canonicalRoot, ".usf/tmp");
await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
const outputRoot = await mkdtemp(resolve(temporaryRoot, "checked-receipt-fixture-"));

/** A clean pre-completion copy: no ignored state, no prior completion output. */
async function isolatedPrecompletionRepository(name) {
  const root = resolve(outputRoot, name);
  await mkdir(root, { mode: 0o700 });
  for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "artifacts"
      || entry.name.startsWith(".usf")) continue;
    await cp(resolve(canonicalRoot, entry.name), resolve(root, entry.name), { recursive: true });
  }
  const receiptDirectory = resolve(root, "evidence/work-completion");
  if (!existsSync(receiptDirectory)) return root;
  const removedBySource = new Map();
  for (const name of (await readdir(receiptDirectory)).sort()) {
    const receiptPath = resolve(receiptDirectory, name);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (receipt.manifestPath !== manifest || receipt.profileIri !== profile) continue;
    for (const operation of receipt.operations) {
      const removed = removedBySource.get(operation.sourcePath) ?? new Set();
      removed.add(operation.line);
      removedBySource.set(operation.sourcePath, removed);
    }
    await unlink(receiptPath);
  }
  for (const [relativeSourcePath, removed] of removedBySource) {
    const sourcePath = resolve(root, relativeSourcePath);
    const source = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, `${source.split("\n").filter(line => line.length > 0 && !removed.has(line)).join("\n")}\n`, "utf8");
  }
  return root;
}

/**
 * The consumer lane needs the same construction authority as the producer so it
 * can materialise the identical candidate, but it must never run the check.
 * This is the producer helper's construction half and nothing more.
 */
async function publishConstructionAuthority(root, name) {
  const evidencePath = `.usf/candidates/construction-authority/${name}-evidence.json`;
  const bundlePath = `.usf/candidates/construction-authority/${name}-bundle.json`;
  await evidenceCommandHandler({ command: "evidence", repositoryRoot: root,
    args: ["construction", "--work", work, "--profile", profile, "--manifest", manifest, "--output", evidencePath] });
  await proveCommandHandler({ command: "prove", repositoryRoot: root,
    args: ["construction", "--obligation", constructionObligation, "--evidence", evidencePath, "--profile", profile, "--manifest", manifest, "--output", bundlePath] });
  const published = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root,
    args: ["construction-authority", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--apply"] });
  assert.equal(published.output.status, "ok", "the consumer lane requires its own genuine construction authority");
}

async function materialise(root) {
  const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: root,
    args: ["no-change", "--work", work, "--profile", profile, "--manifest", manifest] });
  assert.equal(realised.exitCode ?? 0, 0);
  return realised.output;
}

try {
  // Producer lane: the real check runs here and nowhere else.
  const producerRoot = await isolatedPrecompletionRepository("producer");
  const produced = await freshCheckedCompletion(producerRoot,
    { work, profile, manifestPath: manifest, validation, constructionObligation, name: "repository-path" });
  const receiptPath = produced.receiptPath;
  const receiptBytes = await readFile(resolve(producerRoot, receiptPath));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));

  // Consumer lane: same candidate, retained receipt, no second check.
  const consumerRoot = await isolatedPrecompletionRepository("consumer");
  await publishConstructionAuthority(consumerRoot, "repository-path-consumer");
  const consumed = await materialise(consumerRoot);
  assert.equal(consumed.candidateDigest, produced.candidateDigest, "fixture candidate identity must reproduce exactly");
  const consumerReceiptPath = resolve(consumerRoot, receiptPath);
  await mkdir(dirname(consumerReceiptPath), { recursive: true, mode: 0o700 });
  await writeFile(consumerReceiptPath, receiptBytes, { flag: "wx", mode: 0o600 });
  await chmod(consumerReceiptPath, 0o600);

  const evidencePath = ".usf/candidates/work-completion/fixture-receipt-evidence.json";
  const bundlePath = ".usf/candidates/work-completion/fixture-receipt-bundle.json";
  const evidence = await completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: consumerRoot,
    args: ["completion", "--candidate", consumed.candidateDigest, "--work", work, "--profile", profile, "--manifest", manifest, "--output", evidencePath] });
  assert.equal(evidence.exitCode ?? 0, 0);
  const proof = await completionAwareProveCommandHandler({ command: "prove", repositoryRoot: consumerRoot,
    args: ["completion", "--obligation", obligation, "--evidence", evidencePath, "--profile", profile, "--manifest", manifest, "--output", bundlePath] });
  assert.equal(proof.exitCode ?? 0, 0);
  const verified = await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: consumerRoot,
    args: ["work-completion", "--bundle", bundlePath, "--profile", profile, "--manifest", manifest, "--verify"] });
  assert.equal(verified.exitCode ?? 0, 0);

  // Same shape the committed provenance already uses: the exact canonical
  // carrier the isolated copies were taken from, and what was left out of them.
  const fixtureSourceSet = {
    canonicalHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: canonicalRoot, encoding: "utf8" }).trim(),
    canonicalTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: canonicalRoot, encoding: "utf8" }).trim(),
    excludedTopLevelEntries: [".git", ".usf", "artifacts", "node_modules"],
  };
  const provenance = {
    candidateDigest: produced.candidateDigest,
    fixtureSourceSet,
    fixtureSourceSetDigest: canonicalDigest(fixtureSourceSet),
    generatorCommand,
    generatorCommandDigest: canonicalDigest(generatorCommand),
    originalConstructionBasisDigest: receipt.originalConstructionBasisDigest,
    receiptDigest: receipt.receiptDigest,
    receiptPath,
    receiptRawSha256: `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`,
    schema: "urn:usf:checked-candidate-receipt-fixture-provenance:1",
    scopedDependencyDigest: receipt.scopedDependencyDigest,
    sourceManifestPath: manifest,
    sourceProfileIri: profile,
    sourceValidationIri: validation,
    sourceWorkIri: work,
    workspaceIdentityDigest: receipt.workspaceIdentityDigest,
  };
  const receiptOut = canonicalJson(receipt, { rejectAbsolutePaths: true });
  // Key order is stable by construction. JSON.stringify's second argument is a
  // property allowlist, not a sort: passing top-level keys there silently drops
  // every nested property, which is how fixtureSourceSet first serialised as {}.
  const orderedProvenance = Object.fromEntries(Object.entries(provenance).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const provenanceOut = `${JSON.stringify(orderedProvenance, null, 2)}\n`;
  if (write) {
    await writeFile(receiptFixturePath, receiptOut);
    await writeFile(provenanceFixturePath, provenanceOut);
    process.stdout.write(`${JSON.stringify({ status: "written", candidateDigest: produced.candidateDigest, receiptPath })}\n`);
  } else {
    const committedReceipt = await readFile(receiptFixturePath, "utf8");
    const drift = committedReceipt !== receiptOut;
    process.stdout.write(`${JSON.stringify({ status: drift ? "drift" : "matching", candidateDigest: produced.candidateDigest, receiptPath })}\n`);
    if (drift) process.exitCode = 1;
  }
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}
