import assert from "node:assert/strict";
import test from "node:test";
import { dependencyDigest, dependencyFreshness } from "../../../src/core/dependencies.ts";

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
