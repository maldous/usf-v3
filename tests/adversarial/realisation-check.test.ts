import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { materialiseCandidate } from "../../src/realisation/index.ts";
import { runFocusedCheck } from "../../src/commands/check.ts";

const digest = "b".repeat(64);
const shaBefore = "6db7d803e74f1ffa7d8f5adc0bf95b3e15bf4c8373fffadf546227cc6c6742cb";

test("focused checks execute only an allowlisted Node command under permission confinement", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-focused-check-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "one.txt"), "before");
  await materialiseCandidate(root, { digest, scope: ["src/one.txt"], writeSet: ["src/one.txt"], preimages: { "src/one.txt": shaBefore } });
  const refused = await runFocusedCheck(root, digest, [], "anything");
  assert.equal(refused.reasonCode, "CHECK_NOT_ALLOWLISTED");
  const attack = await runFocusedCheck(root, digest, [{ id: "read-outside", command: ["node", "--eval", "import('node:fs').then((fs) => fs.readFileSync('/etc/passwd'))"] }], "read-outside");
  assert.equal(attack.status, "refused");
  assert.equal(attack.reasonCode, "CHECK_FAILED");
});
