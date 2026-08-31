import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { runQuery } from "../../src/commands/query.ts";
import { runWork } from "../../src/commands/work.ts";

const root = resolve(import.meta.dirname, "../..");
const manifest = "graph/products/anqr/manifest.json";

test("query and work command projections are JSON, bounded, and fail closed", () => {
  const query = JSON.parse(runQuery(root, { contract: "urn:usf:contract:anqr-decoded-payload:1" }, manifest));
  assert.equal(query.status, "ok");
  assert.equal(query.dependencyManifest.some((entry: { key: string }) => entry.key === "urn:usf:contract:anqr-decoded-payload:1"), true);
  assert.equal(JSON.parse(runQuery(root, { selector: "unknown" }, manifest)).reasonCode, "QUERY_SELECTOR_UNKNOWN");
  const work = JSON.parse(runWork(root, { maxItems: 1 }, manifest));
  assert.equal(work.status, "ok");
  assert.equal(work.truncation.truncated, true);
  assert.equal(work.items[0].privacy, "public");
  assert.deepEqual(work.items[0].modelCapabilities, ["node-test", "typescript"]);
  assert.equal(work.items[0].targetRuntimeProvider, "none");
  assert.equal(work.items[0].environmentPosture.every((entry: { binding?: string }) => entry.binding?.startsWith("urn:usf:environment-applicability:") === true), true);
  assert.equal(work.items[0].semanticDependencies.some((entry: { kind: string }) => entry.kind === "policy"), true);
  assert.equal(work.items[0].writeSet.some((path: string) => /[*?\[\]{}]/.test(path)), false);
  assert.ok(work.items[0].scopedDependencyDigest.startsWith("sha256:"));
});

test("ordinary construction authority binds its registered policy and tools without admitting candidates", () => {
  const result = JSON.parse(runWork(root, {
    profile: "urn:usf:profile:v3-self-host:1",
    selector: "urn:usf:work:repository-path-scope",
    maxItems: 1,
  }, "graph/manifests/integration.json"));
  assert.equal(result.status, "ok");
  const packet = result.items[0];
  assert.equal(packet.realisationAuthority.permission.activationState, "urn:usf:contract-state:proofblocked");
  assert.ok(packet.eligibility.authorityBasisDigest.startsWith("sha256:"));
  assert.ok(packet.semanticDependencies.some((entry: { kind: string; key: string }) => entry.kind === "semantic-resource" && entry.key === "urn:usf:publication-policy:construction-authority:1"));
  for (const path of ["src/cli.ts", "src/commands/construction-authority.ts", "src/commands/help.ts", "src/graph/work.ts", "src/realisation/construction-authority.ts"]) {
    assert.ok(packet.semanticDependencies.some((entry: { kind: string; key: string }) => entry.kind === "tool" && entry.key === path), path);
  }
  assert.deepEqual(packet.eligibility.activation.reasonCodes, [
    "CONSTRUCTION_EVIDENCE_MISSING:urn:usf:evidence-requirement:repository-path-scope",
    "CONSTRUCTION_PROOF_RESULT_MISSING:urn:usf:proof:repository-path-scope:construction-authority",
  ]);
});
