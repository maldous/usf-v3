import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRouteOutcomes, deferralDurationMs, deferredCandidateIds,
} from "../../../src/providers/route-deferral.ts";

const now = 1_700_000_000_000;
const minute = 60_000;

test("a refusal class maps to a bounded, self-expiring deferral", () => {
  assert.equal(deferralDurationMs("PROVIDER_QUOTA_EXHAUSTED_PAYMENT_REQUIRED", 1), 6 * 60 * minute);
  assert.equal(deferralDurationMs("PROVIDER_RATE_LIMITED", 1), 5 * minute);
  // One empty answer can be the prompt; the second is the route.
  assert.equal(deferralDurationMs("PROVIDER_EMPTY_RESULT:length", 1), 0);
  assert.equal(deferralDurationMs("PROVIDER_EMPTY_RESULT:length", 2), 30 * minute);
  // A timeout is the most expensive refusal to discover, so it defers longest.
  assert.equal(deferralDurationMs("PROVIDER_TIMEOUT", 1), 15 * minute);
  assert.equal(deferralDurationMs("PROVIDER_TIMEOUT", 4), 120 * minute);
  assert.equal(deferralDurationMs("PROVIDER_TIMEOUT", 9), 120 * minute);
  // An unclassified failure backs off and stays capped.
  assert.equal(deferralDurationMs("PROVIDER_INVOCATION_FAILED", 1), 2 * minute);
  assert.equal(deferralDurationMs("PROVIDER_INVOCATION_FAILED", 20), 60 * minute);
});

test("deferral is per exact route, and a success clears it", () => {
  const first = applyRouteOutcomes({}, [
    { candidateId: "vercel-ai-sdk:groq:a", outcome: "refused", reasonCode: "PROVIDER_RATE_LIMITED" },
    { candidateId: "vercel-ai-sdk:groq:b", outcome: "ok", reasonCode: "INVOCATION_OK" },
  ], now);
  // One route of a family is deferred; its sibling is untouched.
  assert.deepEqual([...deferredCandidateIds(first, now)], ["vercel-ai-sdk:groq:a"]);
  assert.equal(first["vercel-ai-sdk:groq:b"], undefined);

  const cleared = applyRouteOutcomes(first, [
    { candidateId: "vercel-ai-sdk:groq:a", outcome: "ok", reasonCode: "INVOCATION_OK" },
  ], now + minute);
  assert.equal(deferredCandidateIds(cleared, now + minute).size, 0);
});

test("consecutive failures of the same class escalate, and expiry drops the record", () => {
  const one = applyRouteOutcomes({}, [
    { candidateId: "r", outcome: "refused", reasonCode: "PROVIDER_EMPTY_RESULT:length" },
  ], now);
  assert.equal(deferredCandidateIds(one, now).size, 0);
  const two = applyRouteOutcomes(one, [
    { candidateId: "r", outcome: "refused", reasonCode: "PROVIDER_EMPTY_RESULT:length" },
  ], now);
  assert.equal(two.r!.consecutiveFailures, 2);
  assert.deepEqual([...deferredCandidateIds(two, now)], ["r"]);
  // The deferral expires on its own; nothing has to clear it.
  assert.equal(deferredCandidateIds(two, now + 31 * minute).size, 0);
  assert.equal(applyRouteOutcomes(two, [], now + 31 * minute).r, undefined);
});
