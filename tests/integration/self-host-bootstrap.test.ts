import assert from "node:assert/strict";
import test from "node:test";
import { executePathScopeSelfHost } from "../../recipes/self-host-path-scope.ts";

test("a graph-derived profile basis does not bypass proofblocked construction authority", async () => {
  await assert.rejects(
    () => executePathScopeSelfHost(),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "BOOTSTRAP_PROFILE_BASIS_REQUIRED",
  );
});
