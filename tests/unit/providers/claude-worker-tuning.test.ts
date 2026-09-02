import assert from "node:assert/strict";
import test from "node:test";

import { claudeCliArguments, codexModelSelection } from "../../../src/providers/cli-transports.ts";

/**
 * The Claude CLI worker invocation, tuned with knowledge of the CLI itself.
 *
 * Both recorded failures of this route came from one omission: without --model
 * the CLI inherits the operator's interactive default, which is a heavyweight
 * reasoning configuration -- the supervisor's own -- so worker units drew the
 * wrong model and died at the timeout. And without --max-turns the print mode
 * may run an agentic session where one bounded generation was wanted.
 */
test("a worker turn pins its model and carries only flags the binary supports", () => {
  // --max-turns was here once, from stale knowledge of a different build; the
  // installed CLI rejects it, which fails the whole route as a usage error.
  // Every flag in this list is verified against the binary's own help.
  const argv = claudeCliArguments("write the module", "claude-haiku-4-5-20251001");
  assert.deepEqual([...argv], [
    "-p", "write the module",
    "--output-format", "json",
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

test("codex effort is declared per candidate and never inherited", () => {
  // The operator's config sets xhigh for their own use; a worker turn that
  // inherits it burns a million tokens of internal reasoning on one module.
  assert.deepEqual(codexModelSelection("gpt-5.3-codex-spark"), { model: "gpt-5.3-codex-spark", effort: "low" });
  assert.deepEqual(codexModelSelection("gpt-5.3-codex-spark@medium"), { model: "gpt-5.3-codex-spark", effort: "medium" });
  assert.deepEqual(codexModelSelection("gpt-5.6-sol@xhigh"), { model: "gpt-5.6-sol", effort: "xhigh" });
  // Malformed suffixes fall back to low rather than passing garbage to the CLI.
  assert.deepEqual(codexModelSelection("model@turbo"), { model: "model", effort: "low" });
  assert.deepEqual(codexModelSelection(null), { model: null, effort: "low" });
  assert.deepEqual(codexModelSelection("@medium"), { model: "@medium", effort: "low" });
});
