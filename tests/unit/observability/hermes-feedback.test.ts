import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createHermesFeedback, type FeedbackEvent, type FeedbackPolicy } from "../../../src/observability/hermes-feedback.ts";

// Read only the admitted semantic assets; the helper itself receives values.
const schema = JSON.parse(readFileSync("schemas/hermes-feedback-event.schema.json", "utf8"));
const policy: FeedbackPolicy = JSON.parse(readFileSync("config/hermes-feedback.json", "utf8"));
const context = readFileSync("docs/context/usf-operator-context.md", "utf8");
const bytes = { [policy.contextAllowlist[0].identity]: context };
const helper = () => createHermesFeedback(schema, policy, bytes);
const digest = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
function event(n = 1, disposition: FeedbackEvent["semanticDisposition"] = "accepted"): FeedbackEvent {
  return {
    schema: "urn:usf:hermes-feedback-event:1", observationIdentity: `observation:${n}`,
    observedAt: "2026-09-07T00:00:00.000Z", sourceIdentity: "source:runtime", clockInstanceIdentity: `clock:${n}`,
    joins: { attemptIdentity: `attempt:${n}`, logicalAttemptIdentity: null, issueIdentity: "USF-1190", laneIdentity: "lane:one",
      workIdentity: "urn:usf:work:hermes-feedback", realisationBasisDigest: digest(0), routeIdentity: null,
      validationIdentity: null, mergeIdentity: null, comparableScopeIdentity: "scope:one" },
    phase: { identity: "review", clockDomainIdentity: "monotonic-observed-phase-wall", startOffsetNanoseconds: 10, endOffsetNanoseconds: 20 },
    measurement: { observedPhaseWallNanoseconds: 10, queue: { valueNanoseconds: null, provenance: null }, modelActive: { valueNanoseconds: null, provenance: null } },
    usage: { inputTokens: { value: null, provenance: null }, outputTokens: { value: null, provenance: null } },
    rawProviderOutcome: "succeeded", semanticDisposition: disposition,
    settledResultReference: disposition === "unknown" ? null : { identity: `result:${n}`, contentDigest: digest(n),
      verificationState: "independently-verified-by-consuming-runtime", settledAttemptIdentity: `attempt:${n}`,
      comparableScopeIdentity: "scope:one", semanticDisposition: disposition },
    context: structuredClone(policy.contextAllowlist),
  };
}
test("preserves full joins, unknowns and separates raw provider success from semantic failure", () => {
  const input = event(1, "failed-validation");
  const before = structuredClone(input);
  const observed = helper().observe(input);
  assert.deepEqual(JSON.parse(JSON.stringify(observed)), before);
  observed.joins.issueIdentity = "changed";
  assert.deepEqual(input, before);
  assert.equal(observed.rawProviderOutcome, "succeeded");
  assert.equal(observed.semanticDisposition, "failed-validation");
});
test("preserves known zero and positive provenance-bearing token and duration facts", () => {
  const input = event();
  const provenance = { identity: "usage:1", contentDigest: digest(7), producerIdentity: "provider:one" };
  input.usage.inputTokens = { value: 0, provenance };
  input.usage.outputTokens = { value: 100, provenance };
  input.measurement.queue = { valueNanoseconds: 0, provenance };
  input.measurement.modelActive = { valueNanoseconds: 3, provenance };
  assert.equal(helper().observe(input).usage.outputTokens.value, 100);
});
for (const disposition of ["accepted", "failed-validation", "provider-failure", "merge-failure"] as const) {
  test(`three comparable ${disposition} attempts produce advisory data only`, () => {
    const events = [1, 2, 3].map(n => event(n, disposition));
    const api = helper();
    const result = api.propose(events)!;
    assert.equal(result.kind, disposition === "accepted" ? "accepted-outcome-review" : "recurring-failure");
    assert.deepEqual(result, api.propose([...events].reverse()));
    assert.equal(result.acceptedProgressClaim, false);
    assert.equal(result.roiClaim, false);
    assert.equal(result.automaticSemanticActivation, false);
    assert.equal(result.automaticHostSkillUpdate, false);
    assert.match(result.authentication, /not-authenticated-by-helper/);
  });
}
for (const [name, mutate] of Object.entries({
  "missing join": (e: any) => { delete e.joins.mergeIdentity; },
  "extra field": (e: any) => { e.secret = "no"; },
  "negative token": (e: any) => { e.usage.inputTokens.value = -1; },
  "unprovenanced token": (e: any) => { e.usage.inputTokens.value = 5; },
  "unprovenanced queue": (e: any) => { e.measurement.queue.valueNanoseconds = 1; },
  "unsafe endpoint": (e: any) => { e.phase.endOffsetNanoseconds = Number.MAX_SAFE_INTEGER + 1; },
  "reversed endpoints": (e: any) => { e.phase.endOffsetNanoseconds = 0; },
  "false duration": (e: any) => { e.measurement.observedPhaseWallNanoseconds = 11; },
  "impossible date": (e: any) => { e.observedAt = "2026-02-30T00:00:00Z"; },
  "wrong result attempt": (e: any) => { e.settledResultReference.settledAttemptIdentity = "other"; },
  "wrong result scope": (e: any) => { e.settledResultReference.comparableScopeIdentity = "other"; },
  "wrong result disposition": (e: any) => { e.settledResultReference.semanticDisposition = "merge-failure"; },
  "altered context attribution": (e: any) => { e.context[0].sourceName = "other"; },
  "missing import version": (e: any) => { delete e.context[0].importVersion; },
  "duplicate context identity": (e: any) => { e.context.push({ ...e.context[0], sourceName: "other" }); },
})) test(`refuses ${name}`, () => { const e = event(); mutate(e); assert.throws(() => helper().observe(e), /HERMES_FEEDBACK_/); });

test("unknown and unverified observations remain observations, never proposals", () => {
  const api = helper();
  const unknown = event(1, "unknown");
  for (const key of Object.keys(unknown.joins)) (unknown.joins as any)[key] = null;
  assert.equal(api.observe(unknown).joins.attemptIdentity, null);
  assert.equal(api.propose([unknown]), null);
  const unverified = [1, 2, 3].map(n => event(n));
  unverified[0].settledResultReference!.verificationState = "unverified-supplied";
  assert.equal(api.propose(unverified), null);
});
test("insufficient, duplicate, conflicting and retry observations cannot inflate evidence", () => {
  const api = helper();
  assert.equal(api.propose([event(1), event(2)]), null);
  assert.equal(api.propose([event(1), event(1), event(2)]), null);
  const conflict = event(1); conflict.measurement.queue = { valueNanoseconds: 0, provenance: { identity: "p", contentDigest: digest(8), producerIdentity: "p" } };
  assert.throws(() => api.propose([event(1), conflict]), /OBSERVATION_CONFLICT/);
  const retries = [1, 2, 3].map(n => event(n));
  retries.forEach(e => { e.joins.logicalAttemptIdentity = "logical:one"; });
  assert.equal(api.propose(retries), null);
  const receipts = [1, 2, 3].map(n => event(n));
  receipts[1].settledResultReference!.contentDigest = digest(1);
  assert.equal(api.propose(receipts), null);
});
test("incomparable scopes, phases, bases and dispositions cannot produce proposals", () => {
  for (const mutate of [
    (e: FeedbackEvent) => { e.phase.identity = "other"; },
    (e: FeedbackEvent) => { e.joins.realisationBasisDigest = digest(8); },
    (e: FeedbackEvent) => { e.joins.comparableScopeIdentity = e.settledResultReference!.comparableScopeIdentity = "other"; },
    (e: FeedbackEvent) => { e.semanticDisposition = e.settledResultReference!.semanticDisposition = "merge-failure"; },
  ]) { const events = [1, 2, 3].map(n => event(n)); mutate(events[2]); assert.equal(helper().propose(events), null); }
});
test("pins bytes and thresholds without exposing ambient context", () => {
  assert.throws(() => createHermesFeedback(schema, policy, { ...bytes, private: "extra" }), /CONTEXT/);
  assert.throws(() => createHermesFeedback(schema, policy, { [policy.contextAllowlist[0].identity]: "wrong" }), /CONTEXT/);
  const lowered = structuredClone(policy); lowered.minimumDistinctSettledAttempts = 2;
  assert.throws(() => createHermesFeedback(schema, lowered, bytes), /POLICY/);
  const higher = structuredClone(policy); higher.minimumDistinctSettledAcceptedAttempts = 4;
  assert.equal(createHermesFeedback(schema, higher, bytes).propose([1, 2, 3].map(n => event(n))), null);
});
test("bounds cyclic, accessor, oversized cohort and non-JSON inputs", () => {
  const cyclic: any = {}; cyclic.self = cyclic;
  assert.throws(() => helper().observe(cyclic), /INPUT_BOUND/);
  let invoked = false;
  assert.throws(() => helper().observe({ get schema() { invoked = true; return "x"; } }), /NON_JSON/);
  assert.equal(invoked, false);
  assert.throws(() => helper().propose(Array(1001).fill(null)), /COHORT_BOUND/);
  assert.throws(() => helper().observe(new Date()), /NON_JSON/);
});
