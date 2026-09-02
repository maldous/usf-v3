import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOutputAdmissions,
  applyRouteOutcomes,
  routeProductivity,
  unproductiveAttemptCeiling,
} from "../../../src/providers/route-deferral.ts";
import { diversifyCandidates } from "../../../src/providers/route-universe.ts";
import { looksTruncated, validateImplementationOutput } from "../../../src/providers/implementation-work.ts";

/**
 * A route is productive when what it produces is kept, not when it answers.
 *
 * Measured before this existed: one host route answered 43 times for 1.77
 * million tokens -- 86 percent of the session's spend -- while almost nothing it
 * produced survived admission, and its perfect transport record kept it ranked
 * first in its provider. Ordering must run on admission verdicts wherever they
 * exist, transport success remains only the prior, and a route that spends the
 * ceiling producing nothing admissible stands down exactly as a route that
 * cannot answer at all does.
 */
const chatty = "vercel-ai-sdk:example:chatty-but-useless";
const quiet = "vercel-ai-sdk:example:mediocre-but-useful";

const candidate = (candidateId: string) => ({
  candidateId,
  transport: "vercel-ai-sdk",
  provider: "example",
  model: candidateId.split(":").pop()!,
}) as never;

test("admission verdicts outrank a perfect transport record", () => {
  let records = applyRouteOutcomes({}, [
    { candidateId: chatty, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 },
    { candidateId: chatty, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 },
    { candidateId: quiet, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 },
    { candidateId: quiet, outcome: "refused", reasonCode: "PROVIDER_TIMEOUT", latencyMs: 9_000 },
  ], 1_000);
  records = applyOutputAdmissions(records, [
    { candidateId: chatty, admitted: false },
    { candidateId: chatty, admitted: false },
    { candidateId: quiet, admitted: true },
  ], 2_000);
  const ordered = diversifyCandidates([candidate(chatty), candidate(quiet)], 0, routeProductivity(records));
  assert.equal(ordered[0]!.candidateId, quiet,
    "the route whose output is kept must outrank the route that merely answers");
});

test("an admission fold never counts another transport attempt", () => {
  let records = applyRouteOutcomes({}, [
    { candidateId: chatty, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 },
  ], 1_000);
  records = applyOutputAdmissions(records, [{ candidateId: chatty, admitted: false }], 2_000);
  assert.equal(records[chatty]?.attempts, 1, "the invocation was already counted once");
  assert.equal(records[chatty]?.successes, 1);
  assert.equal(records[chatty]?.outputRefusals, 1);
});

test("a route that spends the ceiling producing nothing admissible stands down", () => {
  let records = applyRouteOutcomes({}, [
    { candidateId: chatty, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 },
  ], 1_000);
  for (let round = 1; round <= unproductiveAttemptCeiling; round += 1) {
    records = applyOutputAdmissions(records, [{ candidateId: chatty, admitted: false }], round * 1_000);
  }
  const record = records[chatty]!;
  assert.match(record.reasonCode, /^ROUTE_OUTPUT_UNPRODUCTIVE:/u);
  assert.ok(record.deferUntilMs >= unproductiveAttemptCeiling * 1_000 + 24 * 60 * 60 * 1_000 - 1_000);
  // One later acceptance ends the classification for good.
  const redeemed = applyOutputAdmissions(records, [{ candidateId: chatty, admitted: true }],
    record.deferUntilMs + 1);
  assert.equal(redeemed[chatty]?.outputAcceptances, 1);
});

test("truncated generations are named as truncation, not left to the compiler", () => {
  const truncated = [
    "export function negotiate(input: string): string {",
    "  const table = { a: 1, b: 2 };",
    "  if (input.length > 0) {",
    "    return `value ${tabl",
  ].join("\n");
  assert.equal(looksTruncated(truncated), true);
  const checked = validateImplementationOutput(truncated);
  assert.equal(checked.accepted, false);
  assert.equal(checked.code, "candidate-truncated");
  assert.match(checked.detail ?? "", /smaller module/u);
});

test("finished modules with brace-heavy strings are never called truncated", () => {
  const finished = [
    "// braces in strings and comments must not count: { { {",
    "const pattern = \"{ not a block }\";",
    "const template = `outer ${JSON.stringify({ inner: { deep: 1 } })} done`;",
    "export function example(): string {",
    "  /* { */ return pattern + template;",
    "}",
  ].join("\n");
  assert.equal(looksTruncated(finished), false);
  assert.equal(validateImplementationOutput(finished).accepted, true);
});

test("a module that legitimately ends without a closing brace is not flagged", () => {
  // Balanced depth, ends with a semicolon: the compound signal must not fire on
  // either half alone.
  const flat = "export const answer = 42;";
  assert.equal(looksTruncated(flat), false);
});

test("equal admission rates split on what a kept result costs", () => {
  // Measured twice in one day: subscription hosts spent 0.66 and 1.04 million
  // tokens per accepted unit while an API route accepted the same class of work
  // for seventeen thousand, and rate alone ranked them level.
  const expensive = "codex-cli:codex-cli:example-spark";
  const frugal = "vercel-ai-sdk:example:frugal-model";
  let records = applyRouteOutcomes({}, [
    { candidateId: expensive, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 },
    { candidateId: frugal, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 60_000 },
  ], 1_000);
  records = applyOutputAdmissions(records, [
    { candidateId: expensive, admitted: true, totalTokens: 1_039_410 },
    { candidateId: frugal, admitted: true, totalTokens: 17_000 },
  ], 2_000);
  const productivity = routeProductivity(records);
  assert.equal(productivity.get(expensive)?.tokensPerAcceptance, 1_039_410);
  assert.equal(productivity.get(frugal)?.tokensPerAcceptance, 17_000);
  const shared = (candidateId: string) => ({
    candidateId, transport: candidateId.split(":")[0]!, provider: "shared",
    model: candidateId.split(":").pop()!,
  }) as never;
  const ordered = diversifyCandidates([shared(expensive), shared(frugal)], 0, productivity);
  assert.equal(ordered[0]!.candidateId, frugal,
    "the frugal route must outrank the expensive one at equal admission rate, despite worse latency");
});

test("spend per acceptance survives the round trip and later folds", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { readRouteDeferrals, writeRouteDeferrals } = await import("../../../src/providers/route-deferral.ts");
  const root = await mkdtemp(resolve(import.meta.dirname, "../../..", ".usf/tmp/tokens-"));
  try {
    let records = applyOutputAdmissions(
      applyRouteOutcomes({}, [{ candidateId: quiet, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 }], 1_000),
      [{ candidateId: quiet, admitted: true, totalTokens: 20_000 }], 2_000);
    await writeRouteDeferrals(root, records);
    records = await readRouteDeferrals(root);
    assert.equal(records[quiet]?.outputTokensSpent, 20_000, "spend must survive the round trip");
    const folded = applyRouteOutcomes(records,
      [{ candidateId: quiet, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 }], 3_000);
    assert.equal(folded[quiet]?.outputTokensSpent, 20_000, "a transport fold must not erase spend");
  } finally { await rm(root, { recursive: true, force: true }); }
});
