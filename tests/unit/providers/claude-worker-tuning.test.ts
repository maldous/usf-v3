import assert from "node:assert/strict";
import test from "node:test";

import { claudeCliArguments } from "../../../src/providers/cli-transports.ts";

/**
 * The Claude CLI worker invocation, tuned with knowledge of the CLI itself.
 *
 * Both recorded failures of this route came from one omission: without --model
 * the CLI inherits the operator's interactive default, which is a heavyweight
 * reasoning configuration -- the supervisor's own -- so worker units drew the
 * wrong model and died at the timeout. And without --max-turns the print mode
 * may run an agentic session where one bounded generation was wanted.
 */
test("a worker turn pins its model and is bounded to one turn", () => {
  const argv = claudeCliArguments("write the module", "claude-haiku-4-5-20251001");
  assert.deepEqual([...argv], [
    "-p", "write the module",
    "--output-format", "json",
    "--max-turns", "1",
    "--model", "claude-haiku-4-5-20251001",
  ]);
});

test("without a declared model no --model flag is passed, never an empty one", () => {
  // An empty --model value would be a CLI usage error dressed as a transport
  // failure; inheriting the default is at least well-formed.
  for (const absent of [null, ""]) {
    const argv = claudeCliArguments("prompt", absent as never);
    assert.ok(!argv.includes("--model"));
  }
});
