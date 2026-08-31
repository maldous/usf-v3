import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { admissionCheckHandler } from "../../src/commands/apply.ts";
import { constructionAwarePublishCommandHandler, evidenceCommandHandler, proveCommandHandler } from "../../src/commands/construction-authority.ts";
import {
  completionAwareEvidenceCommandHandler,
  completionAwareProveCommandHandler,
  completionAwarePublishCommandHandler,
  realiseCommandHandler,
} from "../../src/commands/work-completion.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";

const canonicalRoot = resolve(import.meta.dirname, "../..");
const manifest = "graph/manifests/self-host-provider.json";
const profile = "urn:usf:profile:v3-self-host:2";
const operatorWork = "urn:usf:work:operator-observability";
const providerWork = "urn:usf:work:provider-semantic-qualification";
const constructionObligation = "urn:usf:proof:operator-observability:construction-authority";
const completionObligation = "urn:usf:proof:operator-observability";
const validation = "urn:usf:validation:operator-observability-tests";

async function isolatedPreauthorityRepository(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  await mkdir(resolve(canonicalRoot, ".usf/tmp"), { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(resolve(canonicalRoot, ".usf/tmp/profile-authority-test-"));
  const root = resolve(parent, "repository");
  await mkdir(root, { mode: 0o700 });
  for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")) continue;
    await cp(resolve(canonicalRoot, entry.name), resolve(root, entry.name), { recursive: true });
  }
  const removals = new Map<string, Set<string>>();
  for (const receiptRoot of ["evidence/construction-authority", "evidence/work-completion"]) {
    const directory = resolve(root, receiptRoot);
    if (!existsSync(directory)) continue;
    for (const name of (await readdir(directory)).sort()) {
      const path = resolve(directory, name);
      const receipt = JSON.parse(await readFile(path, "utf8")) as { manifestPath?: string; operations?: Array<{ sourcePath: string; line: string }> };
      if (receipt.manifestPath !== manifest || !Array.isArray(receipt.operations)) continue;
      for (const operation of receipt.operations) {
        const lines = removals.get(operation.sourcePath) ?? new Set<string>();
        lines.add(operation.line);
        removals.set(operation.sourcePath, lines);
      }
      await unlink(path);
    }
  }
  for (const [sourcePath, removed] of removals) {
    const path = resolve(root, sourcePath);
    const source = await readFile(path, "utf8");
    await writeFile(path, `${source.split("\n").filter((line) => line.length > 0 && !removed.has(line)).join("\n")}\n`, "utf8");
  }
  return { root, cleanup: async () => rm(parent, { recursive: true, force: true }) };
}

function packet(root: string, work: string) {
  const result = deriveWork(loadSemanticGraph(root, manifest), { profile, selector: work, maxItems: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.length, 1);
  return result.items![0]!;
}

test("provider profile closes its predecessor through graph-selected construction and completion authority", async () => {
  const isolated = await isolatedPreauthorityRepository();
  try {
    const operator = packet(isolated.root, operatorWork);
    const providerBeforeAuthority = packet(isolated.root, providerWork);
    for (const projected of [operator, providerBeforeAuthority]) {
      assert.equal(projected.readSet.includes("docs/handover.md"), false);
      assert.equal(projected.writeSet.includes("docs/handover.md"), false);
      assert.equal(projected.writeSet.includes("docs/bottleneck-register.md"), false);
    }
    assert.equal(operator.writeSet.includes("tests/contract/cli.test.ts"), false);
    assert.equal(operator.writeSet.includes("tests/unit/graph/product-overlays.test.ts"), false);
    assert.equal(providerBeforeAuthority.writeSet.includes("tests/contract/fake-call-resolve.test.ts"), false);
    assert.equal(operator.realisationAuthority?.permission?.activationState, "urn:usf:contract-state:proofblocked");
    const constructionEvidence = ".usf/candidates/construction-authority/operator-evidence.json";
    const constructionBundle = ".usf/candidates/construction-authority/operator-bundle.json";
    await evidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["construction", "--work", operatorWork, "--profile", profile, "--manifest", manifest, "--output", constructionEvidence] });
    await proveCommandHandler({ command: "prove", repositoryRoot: isolated.root, args: ["construction", "--obligation", constructionObligation, "--evidence", constructionEvidence, "--profile", profile, "--manifest", manifest, "--output", constructionBundle] });
    await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["construction-authority", "--bundle", constructionBundle, "--profile", profile, "--manifest", manifest, "--apply"] });
    assert.equal(packet(isolated.root, operatorWork).eligibility?.construction.authority, "active-permission");

    const realised = await realiseCommandHandler({ command: "realise", repositoryRoot: isolated.root, args: ["no-change", "--work", operatorWork, "--profile", profile, "--manifest", manifest] });
    const candidateDigest = (realised.output as { candidateDigest: string }).candidateDigest;
    const checked = await admissionCheckHandler({ command: "check", repositoryRoot: isolated.root, args: ["--candidate", candidateDigest, "--validation", validation] });
    assert.equal((checked.output as { status: string }).status, "pass", JSON.stringify(checked.output));
    const completionEvidence = ".usf/candidates/work-completion/operator-evidence.json";
    const completionBundle = ".usf/candidates/work-completion/operator-bundle.json";
    await completionAwareEvidenceCommandHandler({ command: "evidence", repositoryRoot: isolated.root, args: ["completion", "--candidate", candidateDigest, "--work", operatorWork, "--profile", profile, "--manifest", manifest, "--output", completionEvidence] });
    await completionAwareProveCommandHandler({ command: "prove", repositoryRoot: isolated.root, args: ["completion", "--obligation", completionObligation, "--evidence", completionEvidence, "--profile", profile, "--manifest", manifest, "--output", completionBundle] });
    await completionAwarePublishCommandHandler({ command: "publish", repositoryRoot: isolated.root, args: ["work-completion", "--bundle", completionBundle, "--profile", profile, "--manifest", manifest, "--apply"] });

    assert.equal(packet(isolated.root, operatorWork).realisationStage?.stage, "verified-complete");
    const provider = packet(isolated.root, providerWork);
    assert.equal(provider.eligibility?.dependencyReady, true);
    assert.equal(provider.eligibility?.dependencyAuthority, "verified-completion");
  } finally {
    await isolated.cleanup();
  }
});
