import assert from "node:assert/strict";
import test from "node:test";
import { classifyDependencyImpact, dependencyDigest, dependencyFreshness } from "../../../src/core/dependencies.ts";

const a = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const b = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const c = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;

test("dependency digest is sorted and fresh scoped inputs remain fresh after unrelated movement", () => {
  const dependencies = [{ key: "graph:contract", digest: a, kind: "semantic" as const }, { key: "path:src/a.ts", digest: b, kind: "path" as const }];
  assert.equal(dependencyDigest(dependencies), dependencyDigest([...dependencies].reverse()));
  assert.deepEqual(dependencyFreshness(dependencies, { "graph:contract": a, "path:src/a.ts": b, "path:unrelated.ts": c }), { fresh: true, stale: [] });
});

test("relevant movement invalidates and missing dependency is stale", () => {
  const dependencies = [{ key: "path:src/a.ts", digest: b, kind: "path" as const }];
  assert.equal(dependencyFreshness(dependencies, { "path:src/a.ts": c }).fresh, false);
  assert.equal(dependencyFreshness(dependencies, {}).stale[0]?.key, "path:src/a.ts");
});

test("dependency impact classifies unrelated movement without weakening the closure", () => {
  const closure = [{ key: "path:src/a.ts", digest: a, kind: "path" as const }];
  const result = classifyDependencyImpact({
    changed: [{ key: "path:docs/note.md", digest: b, kind: "path" as const }],
    closure,
  });
  assert.equal(result.impact, "unaffected");
  assert.deepEqual(result.affectedKeys, []);
  assert.deepEqual(result.reasonCodes, []);
});

test("dependency impact marks closure movement affected and never calls it reusable", () => {
  const result = classifyDependencyImpact({
    changed: [{ key: "path:src/a.ts", digest: b, kind: "path" as const }],
    closure: [{ key: "path:src/a.ts", digest: a, kind: "path" as const }],
  });
  assert.equal(result.impact, "affected");
  assert.deepEqual(result.affectedKeys, ["path:src/a.ts"]);
  assert.deepEqual(result.reasonCodes, ["IMPACT_CLOSURE_INTERSECTION"]);
});

test("dependency impact fails closed for unknown and whole-gate inputs", () => {
  const result = classifyDependencyImpact({
    changed: [
      { key: "path:src/a.ts", digest: b, kind: "path" as const },
      { key: "workflow:test-full", digest: c, kind: "tool" as const },
    ],
    closure: [{ key: "path:src/a.ts", digest: a, kind: "path" as const }],
    unknownKeys: ["provider:environment"],
    fullGateKeys: ["workflow:test-full"],
  });
  assert.equal(result.impact, "full-gate");
  assert.deepEqual(result.reasonCodes, ["IMPACT_UNKNOWN_INPUT", "IMPACT_FULL_GATE_INPUT", "IMPACT_CLOSURE_INTERSECTION"]);
});
