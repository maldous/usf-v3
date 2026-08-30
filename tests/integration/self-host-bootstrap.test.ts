import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { executePathScopeSelfHost, pathScopeSource, pathScopeTests } from "../../recipes/self-host-path-scope.ts";
import { candidateWorkspace } from "../../src/realisation/index.ts";

const root = resolve(import.meta.dirname, "../..");
const targets = ["src/core/scope.ts", "tests/unit/core/scope.test.ts"] as const;

async function optionalBytes(path: string): Promise<string | null> {
  try { return await readFile(resolve(root, path), "utf8"); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

test("a graph-derived USF packet drives two fake families through the real isolated check", async () => {
  const before = await Promise.all(targets.map(optionalBytes));
  const result = await executePathScopeSelfHost(root);
  assert.equal(result.status, "checked");
  assert.equal(result.calls.metrics.succeeded, 2);
  assert.equal(result.calls.metrics.observedCost, 0);
  assert.deepEqual([...new Set(result.calls.contributions.map((item) => item.actual.family))].sort(), ["fake-harbor", "fake-orbit"]);
  assert.equal(result.check.id, "urn:usf:validation:repository-path-tests");
  assert.equal(result.check.status, "pass");
  assert.deepEqual(result.delta.map((item) => item.path), [...targets]);
  assert.deepEqual(await Promise.all(targets.map(optionalBytes)), before, "the primary checkout must remain byte-identical");

  const workspace = await candidateWorkspace(root, result.candidateDigest.replace(/^sha256:/, ""));
  assert.equal(await readFile(resolve(workspace, targets[0]), "utf8"), pathScopeSource);
  assert.equal(await readFile(resolve(workspace, targets[1]), "utf8"), pathScopeTests);
  assert.deepEqual(result.claims, ["candidate-materialised-outside-primary-tree", "focused-check-passed"]);
  assert.deepEqual(result.nonclaims, ["not-integrated", "not-semantic-authority", "fake-providers-only"]);
});
