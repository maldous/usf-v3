import assert from "node:assert/strict";
import test from "node:test";
import { dispatchCommand, parseCommand } from "../../src/commands/dispatcher.ts";

test("CLI command parsing returns stable invalid-input codes", () => {
  assert.throws(() => parseCommand(["unknown"]), { code: "COMMAND_UNKNOWN", exitCode: 2 });
  assert.throws(() => parseCommand([]), { code: "COMMAND_REQUIRED", exitCode: 2 });
});

test("dispatcher calls a typed handler without hidden lifecycle state", async () => {
  const result = await dispatchCommand(["query", "--selector", "urn:usf:test"], "/repo", {
    query: (request) => ({ output: { command: request.command, args: request.args, root: request.repositoryRoot } }),
  });
  assert.deepEqual(result.output, { command: "query", args: ["--selector", "urn:usf:test"], root: "/repo" });
});
