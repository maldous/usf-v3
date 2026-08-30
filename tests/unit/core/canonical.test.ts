import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDigest, canonicalJson, sha256 } from "../../../src/core/canonical.ts";

test("canonical JSON sorts object keys and has stable SHA-256", () => {
  assert.equal(canonicalJson({ z: [3, { b: true, a: null }], a: "x" }), '{"a":"x","z":[3,{"a":null,"b":true}]}');
  assert.equal(canonicalDigest({ b: 2, a: 1 }), sha256('{"a":1,"b":2}'));
});

test("canonical identity material can exclude runtime metadata", () => {
  assert.equal(canonicalDigest({ payload: { x: 1 }, createdAt: "2026-01-01T00:00:00Z" }, { excludeIdentityFields: true }), canonicalDigest({ createdAt: "later", payload: { x: 1 } }, { excludeIdentityFields: true }));
  assert.throws(() => canonicalJson({ output: "/tmp/out" }, { rejectAbsolutePaths: true }), { code: "ABSOLUTE_PATH_FORBIDDEN" });
});
