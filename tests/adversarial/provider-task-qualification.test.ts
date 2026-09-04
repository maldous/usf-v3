import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canonicalDigest } from "../../src/core/canonical.ts";
import {
  createQualificationPolicy, createQualificationSuite, qualifySemanticProfile,
  QualificationError, verifySemanticQualification,
  type QualificationAgentProfile, type SemanticQualificationInput,
} from "../../src/providers/qualification.ts";
import {
  answerDigest, assertObservationSet, observationSetDigest, promptDigest,
  qualificationObservationDigest, QualificationObservationError,
  sealQualificationObservation, type QualificationObservation,
} from "../../src/providers/qualification-observation.ts";

/**
 * Adversarial proof that a task-class qualification rests on observed
 * invocations and on nothing else.
 *
 * The previous contract could be satisfied without the model. It took a probe
 * result -- which established only that the route replied to one fixed probe
 * prompt -- and a plain array of `{caseId, answer}` pairs that nothing tied to
 * any invocation. A caller who wanted a qualification could write the answers
 * it wanted graded. The evaluator would grade them, mint a role, and bind the
 * result to a route whose model had never seen the questions.
 *
 * The same binding also demanded `quota === "available"`, `health ===
 * "available"` and an observed cost of zero. The qualification requirement asks
 * for none of those. They are facts about a commercial account, establishable
 * only from an authenticated provider console, and requiring them meant the
 * evaluator could never run at all: no route had ever qualified, and the reason
 * was that the gate wanted evidence its own contract never asked for.
 *
 * So the properties below are about provenance rather than scoring. Scoring is
 * covered by the unit suite; what is adversarial here is whether a qualification
 * can be obtained without the model having answered, whether one route's
 * evidence can qualify another, and whether qualification and economic
 * authorization can be made to stand in for each other.
 */

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const profile: QualificationAgentProfile = Object.freeze({
  schema: "urn:usf:agent-profile:1",
  provider: "cohere",
  requestedModel: "north-mini-code-1-0",
  adapter: "@ai-sdk/cohere",
  adapterVersion: "3.0.41",
  adapterLockDigest: digest("a"),
  authMode: "api_token",
  toolProfile: "qualification-no-tools",
  toolProfileDigest: digest("b"),
  promptVersion: "suite-declared-prompts",
  promptDigest: digest("c"),
  contextConfig: "suite-case-prompt-only",
  contextConfigDigest: digest("d"),
  outputConfig: "bounded-text",
  outputConfigDigest: digest("e"),
});

const suite = createQualificationSuite({
  suiteId: "boundary-suite",
  suiteVersion: "1.0.0",
  corpusId: "boundary-corpus",
  corpusVersion: "1.0.0",
  cases: [
    { caseId: "implement", taskClass: "typescript", dimension: "implementation", prompt: "Reply readonly.", grader: { kind: "exact", value: "readonly" }, holdout: false, weight: 1 },
    { caseId: "debug", taskClass: "typescript", dimension: "debugging", prompt: "Name both layers.", grader: { kind: "contains", all: ["runtime validation", "type checking"] }, holdout: false, weight: 1 },
  ],
});

const policy = createQualificationPolicy({
  policyId: "boundary-policy",
  policyVersion: "1.0.0",
  defaultRole: "UNQUALIFIED",
  validitySeconds: 900,
  thresholds: [{
    taskClass: "typescript",
    role: "PATCH_PRODUCER",
    minimumScores: [
      { dimension: "implementation", minimum: 1 },
      { dimension: "debugging", minimum: 1 },
    ],
  }],
});

const correct: Readonly<Record<string, string>> = Object.freeze({
  implement: "readonly",
  debug: "runtime validation and type checking",
});

function observation(
  caseId: string,
  overrides: Partial<Omit<QualificationObservation, "observationDigest">> = {},
): QualificationObservation {
  const answer = overrides.answer ?? correct[caseId]!;
  return sealQualificationObservation({
    schema: "urn:usf:qualification-observation:1",
    provider: profile.provider,
    requestedModel: profile.requestedModel,
    actualModel: profile.requestedModel,
    transport: "vercel-ai-sdk",
    adapterPackage: profile.adapter,
    adapterVersion: profile.adapterVersion,
    adapterLockDigest: profile.adapterLockDigest,
    caseId,
    promptDigest: promptDigest(`prompt-${caseId}`),
    answer,
    answerDigest: answerDigest(answer),
    executionEvidenceDigest: canonicalDigest({ caseId, answer }, { rejectAbsolutePaths: true }),
    observedAt: "2026-09-04T00:00:00.000Z",
    latencyMs: 40,
    usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
    ...overrides,
  });
}

function input(overrides: Partial<SemanticQualificationInput> = {}): SemanticQualificationInput {
  return {
    profile,
    taskClass: "typescript",
    suite,
    policy,
    effectivePolicyDigest: digest("f"),
    observations: [observation("implement"), observation("debug")],
    evaluatedAt: "2026-09-04T00:00:30.000Z",
    ...overrides,
  };
}

const refusal = (thunk: () => unknown): string | undefined => {
  try { thunk(); return undefined; }
  catch (error) {
    if (error instanceof QualificationError) return error.reasonCode;
    if (error instanceof QualificationObservationError) return error.reasonCode;
    return undefined;
  }
};

// ---- the positive path -------------------------------------------------------

test("a route that answered the suite correctly earns the task class", () => {
  const result = qualifySemanticProfile(input());
  assert.equal(result.status, "qualified");
  assert.deepEqual(result.derivedRoles, ["PATCH_PRODUCER"]);
  assert.equal(result.casesAnswered, 2);
  assert.equal(result.casesPassed, 2);
  // Bound to the exact route that answered, and to the invocations it answered in.
  assert.equal(result.profile.requested.provider, "cohere");
  assert.equal(result.profile.actual.model, "north-mini-code-1-0");
  assert.equal(result.inputs.observationSetDigest, observationSetDigest(input().observations));
});

test("the qualification identity binds the suite, the corpus and the policy", () => {
  // A task class means what its cases test, so a qualification earned under one
  // suite version is not a qualification under another.
  const result = qualifySemanticProfile(input());
  assert.equal(result.inputs.suiteDigest, suite.suiteDigest);
  assert.equal(result.inputs.corpusDigest, suite.corpusDigest);
  assert.equal(result.inputs.qualificationPolicyDigest, policy.policyDigest);
  const verified = verifySemanticQualification(result, {
    taskClass: result.taskClass,
    profileDigest: result.profile.profileDigest,
    suiteDigest: result.inputs.suiteDigest,
    corpusDigest: result.inputs.corpusDigest,
    qualificationPolicyDigest: result.inputs.qualificationPolicyDigest,
    effectivePolicyDigest: result.inputs.effectivePolicyDigest,
    observationSetDigest: result.inputs.observationSetDigest,
  }, "2026-09-04T00:01:00.000Z");
  assert.equal(verified.current, true);
});

test("expiry comes from the declared policy window and from nothing else", () => {
  // 900 seconds after evaluation, per config. It is deliberately not the
  // earlier of the policy window and some availability observation's expiry:
  // a qualification's lifetime is a qualification policy decision.
  const result = qualifySemanticProfile(input());
  assert.equal(result.validUntil, "2026-09-04T00:15:30.000Z");
});

// ---- a qualification cannot be obtained without the model --------------------

test("there is no way to submit an answer that no invocation produced", () => {
  // The structural property the rebind exists for. The input carries
  // observations and no answers array, so an answer can only reach the grader
  // by being inside an observation, and an observation carries the digest of
  // the invocation it came from.
  const keys = Object.keys(input());
  assert.equal(keys.includes("answers"), false, "no unbound answer channel");
  assert.equal(keys.includes("probe"), false, "no availability observation channel");
  assert.equal(keys.includes("route"), false, "no route configuration channel");
  assert.ok(keys.includes("observations"));
});

test("an observation whose digest does not recompute is refused", () => {
  // Editing any identity-bearing field and leaving the digest alone must not
  // pass, or the evidence would be advisory rather than binding. The answer
  // itself is covered separately: the observation digest binds the answer's
  // digest rather than its bytes, so a rewritten answer is caught by the answer
  // digest and a rewritten anything-else by this one.
  const tampered = { ...observation("implement"), latencyMs: 9_999 } as QualificationObservation;
  assert.notEqual(tampered.observationDigest, qualificationObservationDigest(tampered));
  assert.equal(
    refusal(() => qualifySemanticProfile(input({ observations: [tampered, observation("debug")] }))),
    "QUALIFICATION_OBSERVATION_REFUSED",
  );
});

test("a rewritten answer is refused even though the observation digest still recomputes", () => {
  // The digest binds answerDigest, not the answer bytes, so this pair is what
  // actually closes the gap: rewrite the answer and the answer digest catches
  // it; reseal to fix that and the observation digest catches the reseal.
  const rewritten = { ...observation("implement"), answer: "mutable" } as QualificationObservation;
  assert.equal(rewritten.observationDigest, qualificationObservationDigest(rewritten));
  assert.equal(
    refusal(() => qualifySemanticProfile(input({ observations: [rewritten, observation("debug")] }))),
    "QUALIFICATION_OBSERVATION_REFUSED",
  );
});

test("an observation whose answer digest does not match its answer is refused", () => {
  // Resealing after an edit defeats the observation digest, so the answer is
  // digested independently and checked as well.
  const forged = sealQualificationObservation({
    ...observation("implement"),
    answer: "readonly",
    answerDigest: answerDigest("something else"),
  });
  assert.equal(
    refusal(() => assertObservationSet([forged], {
      provider: profile.provider, requestedModel: profile.requestedModel, caseIds: ["implement"],
    })),
    "OBSERVATION_ANSWER_DIGEST_MISMATCH",
  );
});

test("an empty observation set is refused rather than reported as unqualified", () => {
  // With no invocation there is nothing to grade. Reporting the route as
  // unqualified would claim an assessment that was never made.
  assert.equal(refusal(() => qualifySemanticProfile(input({ observations: [] }))),
    "QUALIFICATION_OBSERVATION_REFUSED");
});

// ---- qualification cannot leak between routes --------------------------------

test("one model's observations cannot qualify another model", () => {
  const other = [
    observation("implement", { requestedModel: "other-model", actualModel: "other-model" }),
    observation("debug", { requestedModel: "other-model", actualModel: "other-model" }),
  ];
  assert.equal(refusal(() => qualifySemanticProfile(input({ observations: other }))),
    "QUALIFICATION_OBSERVATION_REFUSED");
});

test("one provider's observations cannot qualify another provider", () => {
  const other = [
    observation("implement", { provider: "groq" }),
    observation("debug", { provider: "groq" }),
  ];
  assert.equal(refusal(() => qualifySemanticProfile(input({ observations: other }))),
    "QUALIFICATION_OBSERVATION_REFUSED");
});

test("a mixed observation set is refused rather than partially credited", () => {
  // Grading the members that do match would let the caller choose which
  // evidence counts, which is the same defect as accepting unbound answers.
  const mixed = [observation("implement"), observation("debug", { provider: "groq" })];
  assert.equal(refusal(() => qualifySemanticProfile(input({ observations: mixed }))),
    "QUALIFICATION_OBSERVATION_REFUSED");
});

test("a transport that answered as a different model has not qualified the requested one", () => {
  const rerouted = [
    observation("implement", { actualModel: "north-mini-code-1-0-build-42" }),
    observation("debug", { actualModel: "north-mini-code-1-0-build-42" }),
  ];
  assert.equal(refusal(() => qualifySemanticProfile(input({ observations: rerouted }))),
    "QUALIFICATION_OBSERVATION_REFUSED");
});

test("an adapter build the profile does not name is refused", () => {
  // The same model reached through a different adapter build is a different
  // execution path, so a qualification claimed under one build cannot be
  // relied on under another.
  const otherBuild = [
    observation("implement", { adapterVersion: "3.0.42" }),
    observation("debug", { adapterVersion: "3.0.42" }),
  ];
  assert.equal(refusal(() => qualifySemanticProfile(input({ observations: otherBuild }))),
    "QUALIFICATION_BINDING_MISMATCH");
});

test("a case outside the task class cannot contribute", () => {
  assert.equal(
    refusal(() => assertObservationSet([observation("implement")], {
      provider: profile.provider, requestedModel: profile.requestedModel, caseIds: ["debug"],
    })),
    "OBSERVATION_CASE_OUT_OF_SCOPE",
  );
});

test("the same case answered twice is refused rather than best-of-two", () => {
  const twice = [observation("implement"), observation("implement", { answer: "readonly" })];
  assert.equal(
    refusal(() => assertObservationSet(twice, {
      provider: profile.provider, requestedModel: profile.requestedModel, caseIds: ["implement", "debug"],
    })),
    "OBSERVATION_DUPLICATE_CASE",
  );
});

// ---- a suite failure stays a failure ----------------------------------------

test("a wrong answer leaves the route unqualified", () => {
  const wrong = [observation("implement", { answer: "mutable" }), observation("debug")];
  const result = qualifySemanticProfile(input({ observations: wrong }));
  assert.equal(result.status, "unqualified");
  assert.deepEqual(result.derivedRoles, ["UNQUALIFIED"]);
  assert.equal(result.casesPassed, 1);
});

test("an unanswered required dimension leaves the route unqualified", () => {
  // A missing case is a legitimate zero: the model did not answer it. That is
  // different from an unbound answer, which is not evidence at all.
  const result = qualifySemanticProfile(input({ observations: [observation("implement")] }));
  assert.equal(result.status, "unqualified");
  assert.equal(result.casesAnswered, 1);
  assert.equal(result.casesTotal, 2);
});

// ---- no commercial claim, in either direction --------------------------------

test("no input to a qualification records a commercial fact", () => {
  const serialized = JSON.stringify(input()).toLowerCase();
  for (const forbidden of [
    "quota", "entitlement", "accountreference", "accounttier", "billing",
    "paidfallback", "costclass", "observedcost", "servicetier", "console",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("no field of a qualification records a commercial fact", () => {
  // Scoped to the structural record. The non-claims deliberately name these
  // concepts in order to disclaim them, and a check that forbade the words
  // outright would forbid saying "this asserts nothing about quota".
  const { nonclaims, ...structural } = qualifySemanticProfile(input());
  const serialized = JSON.stringify(structural).toLowerCase();
  for (const forbidden of [
    "quota", "entitlement", "accountreference", "accounttier", "billing",
    "paidfallback", "observedcost", "servicetier", "console", "probe",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  // And the non-claims must actually make the disclaimer, not merely omit it.
  assert.ok(nonclaims.some((claim) => /no economic authorization/i.test(claim)));
});

test("a qualification carries no economic permission and says so", () => {
  const result = qualifySemanticProfile(input());
  assert.equal(result.authorityEffect, "none");
  assert.equal(result.externalContact, false);
  // The role labels are explanatory. Nothing in the record is an authorization
  // to execute, and the record states that itself.
  assert.ok(result.nonclaims.some((claim) => /grant/i.test(claim)));
});

test("the economics policy is untouched by qualification and is what admits execution", () => {
  // Read as data rather than imported, so this stays a statement about the
  // declared policy rather than about a particular reader of it.
  const economics = JSON.parse(
    readFileSync(new URL("../../config/execution-economics.json", import.meta.url), "utf8"),
  ) as { readonly authorizations: readonly unknown[]; readonly nonClaims: readonly string[] };
  assert.ok(economics.authorizations.length > 0, "economic admission is declared by the operator");
  // Eligibility is never inferred: a qualification cannot create it.
  assert.ok(economics.nonClaims.some((claim) => /never inferred/i.test(String(claim))));
});
