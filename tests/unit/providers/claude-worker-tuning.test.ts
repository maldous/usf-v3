import assert from "node:assert/strict";
import test from "node:test";

import {
  antigravityQuotaResetInstant,
  claudeCliArguments,
  claudeUsageLimitSignature,
  classifyAntigravityFailureDetail,
  codexModelSelection,
} from "../../../src/providers/cli-transports.ts";

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

/**
 * A refused host turn is classified from the CLI's own words, never from the
 * bare exit code. Twelve subscription-limit refusals once read as
 * TRANSPORT_INVOCATION_FAILED and stood Sonnet and Fable down for a day at the
 * unproductive-attempt ceiling; the Gemini tiers went the same way while their
 * envelope named a quota with its own reset instant.
 */
test("a failed antigravity envelope classifies from its own error text", () => {
  const cases: readonly [string, ReturnType<typeof classifyAntigravityFailureDetail>][] = [
    // Measured against the installed build, 2026-09-02.
    ["Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 137h51m25s.",
      "TRANSPORT_USAGE_LIMIT_EXCEEDED"],
    ["invalid model selection (--model \"gemini-3.1-pro-medium\" --effort \"\"): model gemini-3.1-pro-medium is not recognized as a known model or custom model in settings",
      "TRANSPORT_MODEL_NOT_ACCEPTED"],
    ["please sign in to continue", "TRANSPORT_SESSION_UNAUTHENTICATED"],
    // A planted unrelated failure must stay a turn failure, not a limit.
    ["the model produced no plan", "TRANSPORT_TURN_FAILED"],
  ];
  for (const [detail, expected] of cases) {
    assert.equal(classifyAntigravityFailureDetail(detail), expected, detail.slice(0, 60));
  }
});

test("a quota refusal's relative reset becomes an absolute instant, or null", () => {
  const observedAt = Date.parse("2026-09-02T20:00:00.000Z");
  assert.equal(
    antigravityQuotaResetInstant("Individual quota reached. Resets in 137h51m25s.", observedAt),
    new Date(observedAt + ((137 * 3600 + 51 * 60 + 25) * 1000)).toISOString(),
  );
  assert.equal(antigravityQuotaResetInstant("Resets in 5m", observedAt),
    new Date(observedAt + 5 * 60 * 1000).toISOString());
  // No stated duration, malformed duration, and zero all fall back to the
  // deferral class default rather than inventing an instant.
  assert.equal(antigravityQuotaResetInstant("Individual quota reached.", observedAt), null);
  assert.equal(antigravityQuotaResetInstant("Resets in soon", observedAt), null);
  assert.equal(antigravityQuotaResetInstant("Resets in 0s", observedAt), null);
});

test("a claude failure report is a usage limit only when the CLI says so", () => {
  // The signature is a family match on the CLI's report, not a verified exact
  // message; an unmatched failure keeps the defect classification and its
  // detail travels on the attempt record for the next diagnosis.
  assert.ok(claudeUsageLimitSignature("Claude usage limit reached|1788400000"));
  assert.ok(claudeUsageLimitSignature("5-hour limit reached ∙ resets 6pm"));
  assert.ok(!claudeUsageLimitSignature("Command failed: claude -p ... ENOENT"));
  assert.ok(!claudeUsageLimitSignature("model did not answer"));
});
