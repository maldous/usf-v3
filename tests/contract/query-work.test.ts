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
