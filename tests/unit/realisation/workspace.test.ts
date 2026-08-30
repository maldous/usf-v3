import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyCandidateOperations, encodeBytes, materialiseCandidate, RealisationError } from "../../../src/realisation/index.ts";

const candidateDigest = "a".repeat(64);

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "usf-realisation-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "one.txt"), "before");
  await writeFile(join(root, "unrelated.txt"), "moving");
  return root;
}

function candidate() {
  return { digest: candidateDigest, scope: ["src/one.txt"], writeSet: ["src/one.txt"], preimages: { "src/one.txt": "6db7d803e74f1ffa7d8f5adc0bf95b3e15bf4c8373fffadf546227cc6c6742cb" } };
}

test("materialises copied scope, applies deterministic byte delta, and leaves primary unchanged", async () => {
  const root = await fixture();
  await materialiseCandidate(root, candidate());
  await writeFile(join(root, "unrelated.txt"), "moved without staling candidate");
  const delta = await applyCandidateOperations(root, candidateDigest, [{ kind: "write", path: "src/one.txt", bytes: encodeBytes("after") }]);
  assert.deepEqual(delta.map(({ path, before, after }) => ({ path, before, after })), [{ path: "src/one.txt", before: encodeBytes("before"), after: encodeBytes("after") }]);
  assert.equal(await readFile(join(root, "src", "one.txt"), "utf8"), "before");
  assert.equal(await readFile(join(root, ".usf", "workspaces", candidateDigest, "src", "one.txt"), "utf8"), "after");
});

test("rejects planted path, control, scope, stale, and symlink defects with stable reasons", async () => {
  const root = await fixture();
  for (const path of ["/tmp/out", "src/../one.txt", ".git/config", ".env", "src/.env.local"]) {
    await assert.rejects(() => materialiseCandidate(root, { ...candidate(), scope: [path] }), (error: unknown) => error instanceof RealisationError && ["ABSOLUTE_PATH", "PATH_TRAVERSAL", "CONTROL_PATH"].includes(error.reasonCode));
  }
  await symlink(join(root, "src", "one.txt"), join(root, "src", "link.txt"));
  await assert.rejects(() => materialiseCandidate(root, { ...candidate(), scope: ["src/link.txt"] }), (error: unknown) => error instanceof RealisationError && error.reasonCode === "SYMLINK_ESCAPE");
  await assert.rejects(() => materialiseCandidate(root, { ...candidate(), writeSet: ["src/other.txt"] }), (error: unknown) => error instanceof RealisationError && error.reasonCode === "UNDECLARED_WRITE");
  await writeFile(join(root, "src", "one.txt"), "changed");
  await assert.rejects(() => materialiseCandidate(root, candidate()), (error: unknown) => error instanceof RealisationError && error.reasonCode === "STALE_RELEVANT_PREIMAGE");
});

test("a relevant source move after materialisation refuses apply without touching primary", async () => {
  const root = await fixture();
  await materialiseCandidate(root, candidate());
  await writeFile(join(root, "src", "one.txt"), "new primary bytes");
  await assert.rejects(
    () => applyCandidateOperations(root, candidateDigest, [{ kind: "write", path: "src/one.txt", bytes: encodeBytes("candidate bytes") }]),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "STALE_RELEVANT_PREIMAGE",
  );
  assert.equal(await readFile(join(root, "src", "one.txt"), "utf8"), "new primary bytes");
});
