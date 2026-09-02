import assert from "node:assert/strict";
import test from "node:test";

import { summariseTokenUsage } from "../../../src/commands/hermes-implement.ts";

/**
 * A cycle's token total has to include what it wasted.
 *
 * Usage was recorded only on the accepted branch, so a cycle that spent its
 * whole budget on candidates that did not compile would have reported spending
 * nothing. That understates cost exactly when cost matters most, which is why
 * the total is split rather than filtered.
 */
const usage = (totalTokens: number, inputTokens = 0, outputTokens = 0) =>
  ({ inputTokens, outputTokens, totalTokens });

test("accepted and refused results are both counted, and kept distinguishable", () => {
  const summary = summariseTokenUsage([
    { outcome: "accepted", usage: usage(1_000, 400, 600) },
    { outcome: "output-refused", usage: usage(2_500, 1_000, 1_500) },
    { outcome: "accepted", usage: usage(500, 200, 300) },
  ]);
  assert.equal(summary.totalTokens, 4_000, "the total must include the refused candidate");
  assert.equal(summary.acceptedTokens, 1_500);
  assert.equal(summary.refusedTokens, 2_500);
  assert.equal(summary.inputTokens, 1_600);
  assert.equal(summary.outputTokens, 2_400);
  assert.equal(summary.invocationsCounted, 3);
});

test("a cycle that produced nothing still reports what it spent", () => {
  const summary = summariseTokenUsage([
    { outcome: "output-refused", usage: usage(3_000) },
    { outcome: "output-refused", usage: usage(4_000) },
  ]);
  assert.equal(summary.totalTokens, 7_000);
  assert.equal(summary.acceptedTokens, 0);
  assert.equal(summary.refusedTokens, 7_000);
});

test("a result with no usage is absent rather than zero-counted", () => {
  // A cached result and a route that never answered both carry no usage. They
  // are not invocations and must not dilute the per-invocation count.
  const summary = summariseTokenUsage([
    { outcome: "accepted", usage: usage(900) },
    { outcome: "accepted" },
    { outcome: "refused", usage: null },
  ]);
  assert.equal(summary.totalTokens, 900);
  assert.equal(summary.invocationsCounted, 1);
});

test("a malformed or negative count is ignored rather than trusted", () => {
  const summary = summariseTokenUsage([
    { outcome: "accepted", usage: { inputTokens: -5, outputTokens: "many", totalTokens: Number.NaN } },
    { outcome: "accepted", usage: usage(100, 40, 60) },
  ]);
  assert.equal(summary.totalTokens, 100);
  assert.equal(summary.inputTokens, 40);
  assert.equal(summary.outputTokens, 60);
  // The malformed entry still counts as an invocation: it happened.
  assert.equal(summary.invocationsCounted, 2);
});

test("an empty cycle reports zero rather than nothing", () => {
  const summary = summariseTokenUsage([]);
  assert.equal(summary.totalTokens, 0);
  assert.equal(summary.invocationsCounted, 0);
});
