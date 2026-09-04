import { canonicalDigest, canonicalJson, type JsonValue } from "../core/canonical.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import type { ProviderRouteConfig } from "./config.ts";
// ---------------------------------------------------------------------------
// Qualification observations
//
// These live here rather than in their own module for a reason that is about
// the repository rather than about taste. Several works declare
// src/providers/qualification.ts in their read scope or runtime closure, and a
// confined validation materialises exactly the files those declarations name.
// A new peer module would therefore have to be admitted into each of them --
// and two of the sources that would need amending, graph/semantic-first.nq and
// graph/usf-bootstrap.nq, are pinned by the immutable bootstrap admission and a
// historical carrier postimage. Editing them to widen a read scope broke that
// transition with TRANSITION_CURRENT_POSTSTATE_MISMATCH. The observation type
// is part of the qualification contract in any case, so keeping it in the
// module that owns that contract costs nothing and changes no other work's
// closure.
// ---------------------------------------------------------------------------


/**
 * The record of one real invocation that a qualification may rest on.
 *
 * Qualification previously took a probe result plus an array of answers. The
 * probe established that the route replied to one fixed probe prompt; the
 * answers were plain `{caseId, answer}` pairs, and nothing anywhere tied them
 * to an invocation. A caller could therefore supply the sixteen answers it
 * wanted graded, and the suite would grade them and mint a qualification for a
 * model that had never seen the questions.
 *
 * An observation closes that gap by making the invocation the unit of evidence
 * rather than the answer. Each observation says: this exact model was asked
 * this exact prompt, returned this exact text, and here is the digest of the
 * execution evidence record that happened in. One observation per graded case,
 * and a case with no observation is simply unanswered.
 *
 * What an observation deliberately does **not** carry is any commercial fact.
 * The old binding required `quota === "available"`, `health === "available"`
 * and an observed cost of zero -- none of which the qualification requirement
 * asks for, and all of which need an authenticated provider-console
 * observation. That is why no route had ever qualified: the evaluator was
 * gated on evidence its own contract never wanted. Whether a route may be
 * executed at all is an economics question, decided where execution is
 * authorised, and an observation is silent on it.
 */

export type QualificationObservationReason =
  | "OBSERVATION_INVALID"
  | "OBSERVATION_DIGEST_MISMATCH"
  | "OBSERVATION_ROUTE_MISMATCH"
  | "OBSERVATION_CASE_OUT_OF_SCOPE"
  | "OBSERVATION_DUPLICATE_CASE"
  | "OBSERVATION_ANSWER_DIGEST_MISMATCH"
  | "OBSERVATION_SET_EMPTY";

export class QualificationObservationError extends Error {
  readonly reasonCode: QualificationObservationReason;

  constructor(reasonCode: QualificationObservationReason) {
    super("A qualification observation was refused at its deterministic boundary.");
    this.name = "QualificationObservationError";
    this.reasonCode = reasonCode;
  }
}

export interface QualificationObservationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface QualificationObservation {
  readonly schema: "urn:usf:qualification-observation:1";
  /** The exact route this invocation reached. */
  readonly provider: string;
  readonly requestedModel: string;
  /** What the transport reported answering as; may differ from what was asked. */
  readonly actualModel: string;
  readonly transport: string;
  /** Null for a transport that resolves its own model and needs no adapter. */
  readonly adapterPackage: string | null;
  /**
   * The exact adapter build that carried the invocation. Adapter identity is
   * part of what a qualification is about: the same model reached through a
   * different adapter build is a different execution path, and a qualification
   * that did not bind this could be claimed under one build and relied on
   * under another. Null exactly when `adapterPackage` is null.
   */
  readonly adapterVersion: string | null;
  readonly adapterLockDigest: string | null;
  /** Which suite case this invocation answered. */
  readonly caseId: string;
  /** Digest of the exact prompt sent, so the question is bound as well as the answer. */
  readonly promptDigest: string;
  readonly answer: string;
  readonly answerDigest: string;
  /** Digest of the execution evidence record this observation projects. */
  readonly executionEvidenceDigest: string;
  readonly observedAt: string;
  readonly latencyMs: number;
  readonly usage: QualificationObservationUsage;
  /** Digest over every field above; recomputed on read and never trusted. */
  readonly observationDigest: string;
}

/**
 * An observation names a transport model identity, which is wider than a route
 * label: a CLI transport reports names like "Gemini 3.7 Flash (Low)".
 */
const observationIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+~ ()-]{0,191}$/u;
const maximumAnswerBytes = 64 * 1024;
const validObservationIdentifier = (value: unknown): value is string =>
  typeof value === "string" && observationIdentifierPattern.test(value);

/** Digest of an answer's exact bytes. The answer is text, so it is digested as text. */
export function answerDigest(answer: string): string {
  return canonicalDigest({ purpose: "qualification-answer", answer }, { rejectAbsolutePaths: true });
}

/** Digest of a prompt's exact bytes, binding the question a case actually asked. */
export function promptDigest(prompt: string): string {
  return canonicalDigest({ purpose: "qualification-prompt", prompt }, { rejectAbsolutePaths: true });
}

/**
 * The digest preimage. Every identity-bearing field is included and
 * `observationDigest` itself is excluded, so the digest is recomputable from
 * the record without knowing how it was built.
 */
function observationDigestInput(observation: QualificationObservation): unknown {
  return {
    schema: observation.schema,
    provider: observation.provider,
    requestedModel: observation.requestedModel,
    actualModel: observation.actualModel,
    transport: observation.transport,
    adapterPackage: observation.adapterPackage,
    adapterVersion: observation.adapterVersion,
    adapterLockDigest: observation.adapterLockDigest,
    caseId: observation.caseId,
    promptDigest: observation.promptDigest,
    answerDigest: observation.answerDigest,
    executionEvidenceDigest: observation.executionEvidenceDigest,
    observedAt: observation.observedAt,
    latencyMs: observation.latencyMs,
    usage: observation.usage,
  };
}

export function qualificationObservationDigest(observation: QualificationObservation): string {
  return canonicalDigest(observationDigestInput(observation), { rejectAbsolutePaths: true });
}

/**
 * One digest over the whole ordered set, so a qualification's identity moves if
 * any observation in it changes, is added or is removed. Ordered by case so the
 * digest does not depend on the order the invocations happened to complete in.
 */
export function observationSetDigest(observations: readonly QualificationObservation[]): string {
  const ordered = [...observations]
    .sort((left, right) => left.caseId.localeCompare(right.caseId))
    .map((observation) => observation.observationDigest);
  return canonicalDigest(
    { purpose: "qualification-observation-set", observations: ordered },
    { rejectAbsolutePaths: true },
  );
}

/** Build an observation and seal it with its own digest. */
export function sealQualificationObservation(
  draft: Omit<QualificationObservation, "observationDigest">,
): QualificationObservation {
  const sealed = { ...draft, observationDigest: "" } as QualificationObservation;
  const digest = qualificationObservationDigest(sealed);
  return Object.freeze({ ...draft, observationDigest: digest }) as QualificationObservation;
}

function assertShape(observation: unknown): asserts observation is QualificationObservation {
  if (typeof observation !== "object" || observation === null) {
    throw new QualificationObservationError("OBSERVATION_INVALID");
  }
  const value = observation as Partial<QualificationObservation>;
  if (
    value.schema !== "urn:usf:qualification-observation:1"
    || !validObservationIdentifier(value.provider)
    || !validObservationIdentifier(value.requestedModel)
    || !validObservationIdentifier(value.actualModel)
    || !validObservationIdentifier(value.transport)
    || !validObservationIdentifier(value.caseId)
    || (value.adapterPackage !== null && !adapterPattern.test(String(value.adapterPackage)))
    // An adapter is either fully identified or absent. A package with no
    // version, or a version with no package, is a half-recorded execution path.
    || (value.adapterPackage === null
      ? (value.adapterVersion !== null || value.adapterLockDigest !== null)
      : (!validObservationIdentifier(value.adapterVersion) || !validDigest(value.adapterLockDigest)))
    || !validDigest(value.promptDigest)
    || !validDigest(value.answerDigest)
    || !validDigest(value.executionEvidenceDigest)
    || !validDigest(value.observationDigest)
    || !validInstant(value.observedAt)
    || typeof value.answer !== "string"
    || Buffer.byteLength(value.answer, "utf8") > maximumAnswerBytes
    || typeof value.latencyMs !== "number" || !Number.isFinite(value.latencyMs) || value.latencyMs < 0
    || typeof value.usage !== "object" || value.usage === null
    || typeof value.usage.inputTokens !== "number"
    || typeof value.usage.outputTokens !== "number"
    || typeof value.usage.totalTokens !== "number"
  ) throw new QualificationObservationError("OBSERVATION_INVALID");
}

export interface ObservationSetExpectation {
  readonly provider: string;
  readonly requestedModel: string;
  /** The case identifiers of the task class being qualified. */
  readonly caseIds: readonly string[];
}

/**
 * Authenticate a set of observations against the route and task class they
 * claim to qualify.
 *
 * Every refusal here is a refusal of the whole set rather than of one member.
 * That is deliberate: an observation from another model, a case outside the
 * task class, a duplicate case or a digest that does not recompute all mean the
 * caller assembled the evidence wrongly, and grading the remainder would let
 * the caller choose which evidence counts. A *missing* case is different and is
 * not an error -- it scores zero, because the model genuinely did not answer it.
 */
export function assertObservationSet(
  observations: readonly QualificationObservation[],
  expectation: ObservationSetExpectation,
): void {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new QualificationObservationError("OBSERVATION_SET_EMPTY");
  }
  if (observations.length > expectation.caseIds.length) {
    throw new QualificationObservationError("OBSERVATION_INVALID");
  }
  const scope = new Set(expectation.caseIds);
  const seen = new Set<string>();
  for (const observation of observations) {
    assertShape(observation);
    // The digest is recomputed before anything else is believed, so a
    // hand-edited observation cannot pass by asserting its own integrity.
    if (observation.observationDigest !== qualificationObservationDigest(observation)) {
      throw new QualificationObservationError("OBSERVATION_DIGEST_MISMATCH");
    }
    if (observation.answerDigest !== answerDigest(observation.answer)) {
      throw new QualificationObservationError("OBSERVATION_ANSWER_DIGEST_MISMATCH");
    }
    // Qualification is held by one exact provider and model. An observation
    // naming another route cannot contribute to this one at any weight.
    if (observation.provider !== expectation.provider
      || observation.requestedModel !== expectation.requestedModel) {
      throw new QualificationObservationError("OBSERVATION_ROUTE_MISMATCH");
    }
    // A transport may answer as a different model than was asked. That is a
    // real fact about the invocation and it disqualifies the observation from
    // qualifying the requested identity, because the answer came from
    // something else.
    if (observation.actualModel !== expectation.requestedModel) {
      throw new QualificationObservationError("OBSERVATION_ROUTE_MISMATCH");
    }
    if (!scope.has(observation.caseId)) {
      throw new QualificationObservationError("OBSERVATION_CASE_OUT_OF_SCOPE");
    }
    if (seen.has(observation.caseId)) {
      throw new QualificationObservationError("OBSERVATION_DUPLICATE_CASE");
    }
    seen.add(observation.caseId);
  }
}

/** The answers a validated observation set carries, keyed by case. */
export function answersFromObservations(
  observations: readonly QualificationObservation[],
): ReadonlyMap<string, string> {
  const answers = new Map<string, string>();
  for (const observation of observations) answers.set(observation.caseId, observation.answer);
  return answers;
}

/** The earliest invocation in the set: when this evidence began to exist. */
export function earliestObservedAt(observations: readonly QualificationObservation[]): string {
  return [...observations]
    .map((observation) => observation.observedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0]!;
}

// ---------------------------------------------------------------------------


export const qualificationDimensions = Object.freeze([
  "semantic_planning",
  "rdf_owl_reasoning",
  "shacl_sparql",
  "repository_navigation",
  "implementation",
  "debugging",
  "tool_selection",
  "structured_output",
  "scope_discipline",
  "evidence_discipline",
  "uncertainty_handling",
  "review",
  "wave_integration",
  "latency",
  "cost",
  "false_completion",
  "later_regression",
] as const);

export type QualificationDimension = typeof qualificationDimensions[number];

export const qualificationRoles = Object.freeze([
  "UNQUALIFIED",
  "READ_ONLY_ANALYST",
  "PLANNER_CANDIDATE",
  "PATCH_PRODUCER",
  "REVIEWER",
  "INTEGRATOR",
  "ADJUDICATOR",
  "TRUSTED_COORDINATOR",
] as const);

export type QualificationRole = typeof qualificationRoles[number];
export type QualifiedRole = Exclude<QualificationRole, "UNQUALIFIED">;
export type QualificationAuthMode = "api_token" | "oidc_cli" | "local" | "none";

export interface QualificationAgentProfile {
  readonly schema: "urn:usf:agent-profile:1";
  readonly provider: string;
  readonly requestedModel: string;
  readonly adapter: string;
  readonly adapterVersion: string;
  readonly adapterLockDigest: string;
  readonly authMode: QualificationAuthMode;
  readonly toolProfile: string;
  readonly toolProfileDigest: string;
  readonly promptVersion: string;
  readonly promptDigest: string;
  readonly contextConfig: string;
  readonly contextConfigDigest: string;
  readonly outputConfig: string;
  readonly outputConfigDigest: string;
}

export type QualificationGrader =
  | Readonly<{ kind: "exact"; value: string }>
  | Readonly<{ kind: "contains"; all: readonly string[] }>
  | Readonly<{ kind: "not-contains"; any: readonly string[] }>
  | Readonly<{ kind: "regex"; pattern: string }>
  | Readonly<{ kind: "iri-exact"; iri: string }>
  | Readonly<{ kind: "choice"; value: string }>
  | Readonly<{ kind: "set-equal"; values: readonly string[] }>
  | Readonly<{ kind: "json-schema"; schema: JsonValue }>
  | Readonly<{ kind: "uncertainty" }>;

export interface QualificationCase {
  readonly caseId: string;
  readonly taskClass: string;
  readonly dimension: QualificationDimension;
  readonly prompt: string;
  readonly grader: QualificationGrader;
  readonly holdout: boolean;
  readonly weight: number;
}

export interface QualificationSuiteDefinition {
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly cases: readonly QualificationCase[];
}

export interface QualificationSuiteSnapshot {
  readonly schema: "urn:usf:qualification-suite:1";
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly corpus: Readonly<{
    readonly schema: "urn:usf:qualification-corpus:1";
    readonly corpusId: string;
    readonly corpusVersion: string;
    readonly cases: readonly QualificationCase[];
  }>;
  readonly corpusDigest: string;
  readonly suiteDigest: string;
}

export interface QualificationRoleThreshold {
  readonly taskClass: string;
  readonly role: QualifiedRole;
  readonly minimumScores: readonly Readonly<{
    dimension: QualificationDimension;
    minimum: number;
  }>[];
}

export interface QualificationPolicyDefinition {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly defaultRole: "UNQUALIFIED";
  readonly validitySeconds: number;
  readonly thresholds: readonly QualificationRoleThreshold[];
}

export interface QualificationPolicySnapshot extends QualificationPolicyDefinition {
  readonly schema: "urn:usf:qualification-policy:1";
  readonly policyDigest: string;
}

export interface QualificationAnswer {
  readonly caseId: string;
  readonly answer: string;
}

export interface SemanticQualificationInput {
  readonly profile: QualificationAgentProfile;
  readonly taskClass: string;
  readonly suite: QualificationSuiteSnapshot;
  readonly policy: QualificationPolicySnapshot;
  readonly effectivePolicyDigest: string;
  /**
   * One observation per graded case, each recording a real invocation of the
   * exact model being qualified. There is deliberately no separate answers
   * array and no route configuration here: an answer that is not carried by an
   * observation has no established origin, and the route's declared cost and
   * entitlement are economics, which qualification must not bind into its
   * identity or depend upon.
   */
  readonly observations: readonly QualificationObservation[];
  /** Explicit clock input; the pure core never reads wall time. */
  readonly evaluatedAt: string;
}

export interface QualificationCaseEvaluation {
  readonly caseId: string;
  readonly taskClass: string;
  readonly dimension: QualificationDimension;
  readonly answerPresent: boolean;
  readonly score: number;
  readonly weight: number;
  readonly passed: boolean;
}

export interface QualificationDimensionEvaluation {
  readonly taskClass: string;
  readonly dimension: QualificationDimension;
  readonly score: number;
  readonly answered: number;
  readonly passed: number;
  readonly total: number;
}

export interface SemanticQualificationResult {
  readonly schema: "urn:usf:semantic-qualification-result:1";
  readonly status: "qualified" | "unqualified";
  readonly taskClass: string;
  readonly profile: Readonly<{
    readonly profileDigest: string;
    readonly requested: Readonly<{
      readonly provider: string;
      readonly model: string;
      readonly adapter: string;
      readonly adapterVersion: string;
      readonly adapterLockDigest: string;
      readonly authMode: QualificationAuthMode;
      readonly toolProfile: string;
      readonly toolProfileDigest: string;
      readonly promptVersion: string;
      readonly promptDigest: string;
      readonly contextConfig: string;
      readonly contextConfigDigest: string;
      readonly outputConfig: string;
      readonly outputConfigDigest: string;
    }>;
    readonly actual: Readonly<{
      readonly provider: string;
      readonly model: string;
      readonly transport: string;
    }>;
  }>;
  readonly inputs: Readonly<{
    readonly suiteDigest: string;
    readonly corpusDigest: string;
    readonly qualificationPolicyDigest: string;
    readonly effectivePolicyDigest: string;
    readonly observationSetDigest: string;
  }>;
  readonly caseEvaluations: readonly QualificationCaseEvaluation[];
  readonly dimensionEvaluations: readonly QualificationDimensionEvaluation[];
  readonly taskScore: number;
  readonly casesAnswered: number;
  readonly casesPassed: number;
  readonly casesTotal: number;
  /** Explanatory labels only; they grant no routing, write, or semantic authority. */
  readonly derivedRoles: readonly QualificationRole[];
  readonly observedAt: string;
  readonly evaluatedAt: string;
  readonly validUntil: string;
  readonly externalContact: false;
  readonly authorityEffect: "none";
  readonly nonclaims: readonly string[];
  readonly qualificationDigest: string;
}

export interface QualificationExpectedBindings {
  readonly taskClass: string;
  readonly profileDigest: string;
  readonly suiteDigest: string;
  readonly corpusDigest: string;
  readonly qualificationPolicyDigest: string;
  readonly effectivePolicyDigest: string;
  readonly observationSetDigest: string;
}

export interface VerifiedSemanticQualification {
  readonly current: true;
  readonly status: SemanticQualificationResult["status"];
  readonly taskClass: string;
  readonly qualificationDigest: string;
  readonly validUntil: string;
  readonly derivedRoles: readonly QualificationRole[];
}

/** One ephemeral prompt projection. Graders, holdout labels and expected answers are excluded. */
export interface HiddenPromptProjection {
  readonly schema: "urn:usf:hidden-prompt-projection:1";
  readonly suiteDigest: string;
  readonly corpusDigest: string;
  readonly taskClass: string;
  readonly caseId: string;
  readonly prompt: string;
  readonly projectionDigest: string;
}

export interface HiddenProviderAnswerObservation {
  readonly caseId: string;
  readonly promptProjectionDigest: string;
  readonly routeMemberDigest: string;
  readonly taskProfileDigest: string;
  readonly providerAnswerDigest: string;
  readonly answer: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface HiddenEvaluationInput {
  readonly suite: QualificationSuiteSnapshot;
  readonly taskClass: string;
  readonly routeMemberDigest: string;
  readonly taskProfileDigest: string;
  readonly answers: readonly HiddenProviderAnswerObservation[];
  readonly evaluatedAt: string;
  readonly validitySeconds: number;
}

export interface HiddenEvaluationScore {
  readonly caseId: string;
  readonly dimension: QualificationDimension;
  readonly answerPresent: boolean;
  readonly score: number;
  readonly passed: boolean;
}

export interface HiddenEvaluationReceipt {
  readonly schema: "urn:usf:hidden-evaluation-receipt:1";
  readonly version: 1;
  readonly routeMemberDigest: string;
  readonly providerAnswerDigest: string;
  readonly taskProfileDigest: string;
  readonly suiteDigest: string;
  readonly corpusDigest: string;
  readonly graderPolicyDigest: string;
  readonly thresholdDigest: string;
  readonly evaluatorDigest: string;
  readonly producerSeparationDigest: string;
  readonly scores: readonly HiddenEvaluationScore[];
  readonly unmatchedCount: number;
  readonly disposition: "qualified" | "unqualified";
  readonly evaluatedAt: string;
  readonly expiresAt: string;
}

export interface VerifiedHiddenEvaluation {
  readonly current: true;
  readonly disposition: HiddenEvaluationReceipt["disposition"];
  readonly receiptDigest: string;
  readonly expiresAt: string;
}

export type QualificationReason =
  | "QUALIFICATION_INPUT_INVALID"
  | "QUALIFICATION_SUITE_DIGEST_MISMATCH"
  | "QUALIFICATION_POLICY_DIGEST_MISMATCH"
  | "QUALIFICATION_BINDING_MISMATCH"
  | "QUALIFICATION_OBSERVATION_REFUSED"
  | "QUALIFICATION_ANSWER_DUPLICATE"
  | "QUALIFICATION_ANSWER_OUT_OF_SCOPE"
  | "QUALIFICATION_RESULT_DIGEST_MISMATCH"
  | "QUALIFICATION_RESULT_BINDING_MISMATCH"
  | "QUALIFICATION_RESULT_STALE"
  | "HIDDEN_EVALUATION_INPUT_INVALID"
  | "HIDDEN_EVALUATION_RESULT_DIGEST_MISMATCH"
  | "HIDDEN_EVALUATION_BINDING_MISMATCH"
  | "HIDDEN_EVALUATION_STALE";

export class QualificationError extends Error {
  readonly reasonCode: QualificationReason;

  constructor(reasonCode: QualificationReason) {
    super("Semantic qualification was refused at its deterministic boundary.");
    this.name = "QualificationError";
    this.reasonCode = reasonCode;
  }
}

const dimensionSet = new Set<string>(qualificationDimensions);
const roleSet = new Set<string>(qualificationRoles);
const qualifiedRoleSet = new Set<string>(qualificationRoles.slice(1));
const authModes = new Set<QualificationAuthMode>(["api_token", "oidc_cli", "local", "none"]);
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const canonicalInstant = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+~-]{0,191}$/u;
const adapterPattern = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,95}$/u;
const maximumCases = 10_000;
const maximumCaseText = 1_000_000;
const maximumWeight = 1_000;
const maximumValiditySeconds = 366 * 24 * 60 * 60;
const passThreshold = 0.5;
const uncertaintyMarkers = Object.freeze([
  "i don't know",
  "i do not know",
  "cannot",
  "unknown",
  "uncertain",
  "insufficient",
  "not enough",
]);
const nonclaims = Object.freeze([
  "Derived roles are task-scoped explanatory labels and grant no write, routing, roster, evidence, proof, or semantic authority.",
  "Qualification is a time-bounded evaluation of observed answers, not a future availability guarantee or SLA.",
  "Only the task class evaluated here is established. Every other task class, and every capability the suite does not test, remains unknown rather than absent.",
  "Each graded answer is bound to the invocation that produced it. This result authenticates that those invocations occurred and what they returned; it does not authenticate anything the model asserted inside an answer.",
  "Tracked cases marked holdout are visible in the tracked suite and are not confidential hidden holdouts.",
  "A model response does not establish truth, acceptance, evidence, proof, or completion.",
  "Qualification grants no economic authorization and asserts nothing about account tier, quota, billing or provider-console state.",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

function validInstant(value: unknown): value is string {
  return typeof value === "string"
    && canonicalInstant.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function validBoundedString(value: unknown, maximum = maximumCaseText): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validMinimumScore(value: unknown): value is number {
  return validScore(value) && value > 0;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value, { rejectAbsolutePaths: true })) as T;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function exactDigest(value: unknown): string {
  return canonicalDigest(value, { rejectAbsolutePaths: true });
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function extractJson(value: string): unknown {
  let text = value.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[A-Za-z]*\n?/u, "").replace(/\n?```$/u, "");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const match = /[\[{][\s\S]*[\]}]/u.exec(text);
    if (match === null) return undefined;
    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return undefined;
    }
  }
}

function validStringArray(value: unknown, allowEmpty = false): value is readonly string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.length <= maximumCases
    && value.every((entry) => validBoundedString(entry) && entry.length > 0);
}

function validateGrader(grader: unknown): grader is QualificationGrader {
  if (!isRecord(grader) || typeof grader.kind !== "string") return false;
  switch (grader.kind) {
    case "exact":
    case "choice": return hasExactKeys(grader, ["kind", "value"])
      && validBoundedString(grader.value) && grader.value.length > 0;
    case "contains": return hasExactKeys(grader, ["kind", "all"]) && validStringArray(grader.all);
    case "not-contains": return hasExactKeys(grader, ["kind", "any"]) && validStringArray(grader.any);
    case "regex": {
      if (!hasExactKeys(grader, ["kind", "pattern"]) || !validBoundedString(grader.pattern, 1_024) || grader.pattern.length === 0) return false;
      try {
        void new RegExp(grader.pattern, "isu");
        return true;
      } catch {
        return false;
      }
    }
    case "iri-exact": return hasExactKeys(grader, ["kind", "iri"])
      && validBoundedString(grader.iri) && grader.iri.length > 0;
    case "set-equal": return hasExactKeys(grader, ["kind", "values"])
      && validStringArray(grader.values, true)
      && new Set(grader.values.map(normalized)).size === grader.values.length;
    case "json-schema": {
      if (!hasExactKeys(grader, ["kind", "schema"])) return false;
      try {
        createJsonSchemaValidator(grader.schema);
        return true;
      } catch {
        return false;
      }
    }
    case "uncertainty": return Object.keys(grader).length === 1;
    default: return false;
  }
}

function validateCase(value: unknown): value is QualificationCase {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ["caseId", "taskClass", "dimension", "prompt", "grader", "holdout", "weight"])
    && validIdentifier(value.caseId)
    && validIdentifier(value.taskClass)
    && typeof value.dimension === "string"
    && dimensionSet.has(value.dimension)
    && validBoundedString(value.prompt)
    && value.prompt.length > 0
    && validateGrader(value.grader)
    && typeof value.holdout === "boolean"
    && typeof value.weight === "number"
    && Number.isFinite(value.weight)
    && value.weight > 0
    && value.weight <= maximumWeight;
}

function validateProfile(value: QualificationAgentProfile): void {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["schema", "provider", "requestedModel", "adapter", "adapterVersion", "adapterLockDigest", "authMode", "toolProfile", "toolProfileDigest", "promptVersion", "promptDigest", "contextConfig", "contextConfigDigest", "outputConfig", "outputConfigDigest"])
    || value.schema !== "urn:usf:agent-profile:1"
    || !validIdentifier(value.provider)
    || !validIdentifier(value.requestedModel)
    || !adapterPattern.test(value.adapter)
    || !validIdentifier(value.adapterVersion)
    || !validDigest(value.adapterLockDigest)
    || !authModes.has(value.authMode)
    || !validIdentifier(value.toolProfile)
    || !validDigest(value.toolProfileDigest)
    || !validIdentifier(value.promptVersion)
    || !validDigest(value.promptDigest)
    || !validIdentifier(value.contextConfig)
    || !validDigest(value.contextConfigDigest)
    || !validIdentifier(value.outputConfig)
    || !validDigest(value.outputConfigDigest)
  ) throw new QualificationError("QUALIFICATION_INPUT_INVALID");
}

function validateSuiteContent(definition: QualificationSuiteDefinition): void {
  if (
    !isRecord(definition)
    || !hasExactKeys(definition, ["suiteId", "suiteVersion", "corpusId", "corpusVersion", "cases"])
    || !validIdentifier(definition.suiteId)
    || !validIdentifier(definition.suiteVersion)
    || !validIdentifier(definition.corpusId)
    || !validIdentifier(definition.corpusVersion)
    || !Array.isArray(definition.cases)
    || definition.cases.length === 0
    || definition.cases.length > maximumCases
    || definition.cases.some((entry) => !validateCase(entry))
    || new Set(definition.cases.map((entry) => entry.caseId)).size !== definition.cases.length
  ) throw new QualificationError("QUALIFICATION_INPUT_INVALID");
}

function validatePolicyContent(definition: QualificationPolicyDefinition): void {
  if (
    !isRecord(definition)
    || !hasExactKeys(definition, ["policyId", "policyVersion", "defaultRole", "validitySeconds", "thresholds"])
    || !validIdentifier(definition.policyId)
    || !validIdentifier(definition.policyVersion)
    || definition.defaultRole !== "UNQUALIFIED"
    || !Number.isSafeInteger(definition.validitySeconds)
    || definition.validitySeconds < 1
    || definition.validitySeconds > maximumValiditySeconds
    || !Array.isArray(definition.thresholds)
    || definition.thresholds.length > qualificationRoles.length * 256
  ) throw new QualificationError("QUALIFICATION_INPUT_INVALID");

  const keys = new Set<string>();
  for (const threshold of definition.thresholds) {
    if (
      !isRecord(threshold)
      || !hasExactKeys(threshold, ["taskClass", "role", "minimumScores"])
      || !validIdentifier(threshold.taskClass)
      || typeof threshold.role !== "string"
      || !qualifiedRoleSet.has(threshold.role)
      || !Array.isArray(threshold.minimumScores)
      || threshold.minimumScores.length === 0
      || threshold.minimumScores.length > qualificationDimensions.length
    ) throw new QualificationError("QUALIFICATION_INPUT_INVALID");
    const key = `${threshold.taskClass}\u0000${threshold.role}`;
    if (keys.has(key)) throw new QualificationError("QUALIFICATION_INPUT_INVALID");
    keys.add(key);
    const dimensions = new Set<string>();
    for (const minimum of threshold.minimumScores) {
      if (
        !isRecord(minimum)
        || !hasExactKeys(minimum, ["dimension", "minimum"])
        || typeof minimum.dimension !== "string"
        || !dimensionSet.has(minimum.dimension)
        || !validMinimumScore(minimum.minimum)
        || dimensions.has(minimum.dimension)
      ) {
        throw new QualificationError("QUALIFICATION_INPUT_INVALID");
      }
      dimensions.add(minimum.dimension);
    }
  }
}

function suiteDigestInput(snapshot: Omit<QualificationSuiteSnapshot, "suiteDigest">): unknown {
  return snapshot;
}

function policyDigestInput(snapshot: Omit<QualificationPolicySnapshot, "policyDigest">): unknown {
  return snapshot;
}

function assertSuiteSnapshot(snapshot: QualificationSuiteSnapshot): void {
  if (
    !isRecord(snapshot)
    || !hasExactKeys(snapshot, ["schema", "suiteId", "suiteVersion", "corpus", "corpusDigest", "suiteDigest"])
    || !isRecord(snapshot.corpus)
    || !hasExactKeys(snapshot.corpus, ["schema", "corpusId", "corpusVersion", "cases"])
    || snapshot.schema !== "urn:usf:qualification-suite:1"
    || snapshot.corpus.schema !== "urn:usf:qualification-corpus:1"
  ) throw new QualificationError("QUALIFICATION_INPUT_INVALID");
  validateSuiteContent({
    suiteId: snapshot.suiteId,
    suiteVersion: snapshot.suiteVersion,
    corpusId: snapshot.corpus.corpusId,
    corpusVersion: snapshot.corpus.corpusVersion,
    cases: snapshot.corpus.cases,
  });
  const corpusDigest = exactDigest(snapshot.corpus);
  if (snapshot.corpusDigest !== corpusDigest) {
    throw new QualificationError("QUALIFICATION_SUITE_DIGEST_MISMATCH");
  }
  const { suiteDigest: _ignored, ...withoutDigest } = snapshot;
  if (snapshot.suiteDigest !== exactDigest(suiteDigestInput(withoutDigest))) {
    throw new QualificationError("QUALIFICATION_SUITE_DIGEST_MISMATCH");
  }
}

function assertPolicySnapshot(snapshot: QualificationPolicySnapshot): void {
  if (
    !isRecord(snapshot)
    || !hasExactKeys(snapshot, ["schema", "policyId", "policyVersion", "defaultRole", "validitySeconds", "thresholds", "policyDigest"])
    || snapshot.schema !== "urn:usf:qualification-policy:1"
  ) {
    throw new QualificationError("QUALIFICATION_INPUT_INVALID");
  }
  validatePolicyContent({
    policyId: snapshot.policyId,
    policyVersion: snapshot.policyVersion,
    defaultRole: snapshot.defaultRole,
    validitySeconds: snapshot.validitySeconds,
    thresholds: snapshot.thresholds,
  });
  const { policyDigest: _ignored, ...withoutDigest } = snapshot;
  if (snapshot.policyDigest !== exactDigest(policyDigestInput(withoutDigest))) {
    throw new QualificationError("QUALIFICATION_POLICY_DIGEST_MISMATCH");
  }
}

function gradeCase(item: QualificationCase, answer: string): number {
  const grader = item.grader;
  switch (grader.kind) {
    case "exact": return normalized(answer) === normalized(grader.value) ? 1 : 0;
    case "contains": {
      const candidate = normalized(answer);
      return grader.all.every((value) => candidate.includes(normalized(value))) ? 1 : 0;
    }
    case "not-contains": {
      const candidate = normalized(answer);
      return grader.any.some((value) => candidate.includes(normalized(value))) ? 0 : 1;
    }
    case "regex": return new RegExp(grader.pattern, "isu").test(answer) ? 1 : 0;
    case "iri-exact": return answer.includes(grader.iri) ? 1 : 0;
    case "choice": {
      const wanted = normalized(grader.value);
      const tokens = normalized(answer).split(/[^\p{L}\p{N}_:+./~-]+/u);
      return tokens.includes(wanted) ? 1 : 0;
    }
    case "set-equal": {
      const wanted = new Set(grader.values.map(normalized));
      const actual = new Set(answer.split(/[,;\n]+/u).map(normalized).filter(Boolean));
      return wanted.size === actual.size && [...wanted].every((value) => actual.has(value)) ? 1 : 0;
    }
    case "json-schema": {
      const value = extractJson(answer);
      return value !== undefined && createJsonSchemaValidator(grader.schema).validate(value).valid ? 1 : 0;
    }
    case "uncertainty": {
      const candidate = normalized(answer);
      return uncertaintyMarkers.some((marker) => candidate.includes(marker)) ? 1 : 0;
    }
  }
}


/**
 * Authenticate the observation set against the profile and task class it claims
 * to qualify.
 *
 * The identity checks kept from the previous binding are the ones that are
 * about the invocation: which model was asked, which model answered, and which
 * adapter carried it. The ones dropped are the ones that were about the
 * account -- quota availability, service health and an observed cost of zero.
 * The qualification requirement never asked for those; only an authenticated
 * provider-console observation could establish them; and requiring them meant
 * the evaluator could never run. Whether this route may be executed at all is
 * decided by the operator's economic authorization, at the point where
 * execution is authorised, and it is not re-decided here.
 */
function assertObservationBinding(
  input: SemanticQualificationInput,
  caseIds: readonly string[],
): void {
  try {
    assertObservationSet(input.observations, {
      provider: input.profile.provider,
      requestedModel: input.profile.requestedModel,
      caseIds,
    });
  } catch (error) {
    if (error instanceof QualificationObservationError) {
      throw new QualificationError("QUALIFICATION_OBSERVATION_REFUSED");
    }
    throw error;
  }
  for (const observation of input.observations) {
    // The adapter that carried the invocation must be the adapter the profile
    // is qualifying. A transport that resolves its own model carries no
    // adapter, and the profile must say so rather than naming one.
    const profileAdapter = input.profile.adapter === "" ? null : input.profile.adapter;
    if (observation.adapterPackage !== profileAdapter
      || (profileAdapter !== null
        && (observation.adapterVersion !== input.profile.adapterVersion
          || observation.adapterLockDigest !== input.profile.adapterLockDigest))) {
      throw new QualificationError("QUALIFICATION_BINDING_MISMATCH");
    }
    // An invocation cannot have happened after the moment it is being graded.
    if (Date.parse(observation.observedAt) > Date.parse(input.evaluatedAt)) {
      throw new QualificationError("QUALIFICATION_OBSERVATION_REFUSED");
    }
  }
}

function scoreCases(
  cases: readonly QualificationCase[],
  answers: ReadonlyMap<string, string>,
  taskClass: string,
): Readonly<{
  caseEvaluations: readonly QualificationCaseEvaluation[];
  dimensionEvaluations: readonly QualificationDimensionEvaluation[];
  taskScore: number;
  casesAnswered: number;
  casesPassed: number;
  casesTotal: number;
}> {
  const caseEvaluations = cases.map((item) => {
    const answer = answers.get(item.caseId);
    const score = answer === undefined ? 0 : gradeCase(item, answer);
    return {
      caseId: item.caseId,
      taskClass,
      dimension: item.dimension,
      answerPresent: answer !== undefined,
      score,
      weight: item.weight,
      passed: score >= passThreshold,
    } satisfies QualificationCaseEvaluation;
  });

  const dimensionEvaluations = qualificationDimensions.map((dimension) => {
    const rows = caseEvaluations.filter((item) => item.dimension === dimension);
    const weight = rows.reduce((total, item) => total + item.weight, 0);
    const score = weight === 0
      ? 0
      : roundScore(rows.reduce((total, item) => total + item.score * item.weight, 0) / weight);
    return {
      taskClass,
      dimension,
      score,
      answered: rows.filter((item) => item.answerPresent).length,
      passed: rows.filter((item) => item.passed).length,
      total: rows.length,
    } satisfies QualificationDimensionEvaluation;
  });

  const totalWeight = caseEvaluations.reduce((total, item) => total + item.weight, 0);
  return {
    caseEvaluations,
    dimensionEvaluations,
    taskScore: totalWeight === 0 ? 0 : roundScore(
      caseEvaluations.reduce((total, item) => total + item.score * item.weight, 0) / totalWeight,
    ),
    casesAnswered: caseEvaluations.filter((item) => item.answerPresent).length,
    casesPassed: caseEvaluations.filter((item) => item.passed).length,
    casesTotal: caseEvaluations.length,
  };
}

function deriveRoles(
  taskClass: string,
  evaluations: readonly QualificationDimensionEvaluation[],
  policy: QualificationPolicySnapshot,
): readonly QualificationRole[] {
  const scores = new Map(evaluations.map((item) => [item.dimension, item.score]));
  const admitted = policy.thresholds
    .filter((threshold) => threshold.taskClass === taskClass)
    .filter((threshold) => threshold.minimumScores.every(
      (minimum) => (scores.get(minimum.dimension) ?? 0) >= minimum.minimum,
    ))
    .map((threshold) => threshold.role)
    .sort((left, right) => qualificationRoles.indexOf(left) - qualificationRoles.indexOf(right));
  return admitted.length === 0 ? [policy.defaultRole] : admitted;
}

export function createQualificationSuite(definition: QualificationSuiteDefinition): QualificationSuiteSnapshot {
  validateSuiteContent(definition);
  const cases = [...definition.cases]
    .sort((left, right) => left.taskClass.localeCompare(right.taskClass)
      || qualificationDimensions.indexOf(left.dimension) - qualificationDimensions.indexOf(right.dimension)
      || left.caseId.localeCompare(right.caseId))
    .map((item) => jsonClone(item));
  const corpus = {
    schema: "urn:usf:qualification-corpus:1" as const,
    corpusId: definition.corpusId,
    corpusVersion: definition.corpusVersion,
    cases,
  };
  const corpusDigest = exactDigest(corpus);
  const withoutDigest = {
    schema: "urn:usf:qualification-suite:1" as const,
    suiteId: definition.suiteId,
    suiteVersion: definition.suiteVersion,
    corpus,
    corpusDigest,
  };
  return deepFreeze({ ...withoutDigest, suiteDigest: exactDigest(suiteDigestInput(withoutDigest)) }) as QualificationSuiteSnapshot;
}

export function createQualificationPolicy(definition: QualificationPolicyDefinition): QualificationPolicySnapshot {
  validatePolicyContent(definition);
  const thresholds = [...definition.thresholds]
    .sort((left, right) => left.taskClass.localeCompare(right.taskClass)
      || qualificationRoles.indexOf(left.role) - qualificationRoles.indexOf(right.role))
    .map((threshold) => ({
      taskClass: threshold.taskClass,
      role: threshold.role,
      minimumScores: [...threshold.minimumScores]
        .sort((left, right) => qualificationDimensions.indexOf(left.dimension) - qualificationDimensions.indexOf(right.dimension))
        .map((minimum) => ({ ...minimum })),
    }));
  const withoutDigest = {
    schema: "urn:usf:qualification-policy:1" as const,
    policyId: definition.policyId,
    policyVersion: definition.policyVersion,
    defaultRole: definition.defaultRole,
    validitySeconds: definition.validitySeconds,
    thresholds,
  };
  return deepFreeze({ ...withoutDigest, policyDigest: exactDigest(policyDigestInput(withoutDigest)) }) as QualificationPolicySnapshot;
}

/**
 * Deterministically evaluate one full agent-profile tuple for one task class.
 *
 * It consumes stored observations of invocations that already happened, and
 * performs no provider contact, filesystem access or external operation of any
 * kind. The invocations are made elsewhere, under the economic authorization
 * that governs execution; this only grades what they returned.
 */
export function qualifySemanticProfile(input: SemanticQualificationInput): SemanticQualificationResult {
  validateProfile(input.profile);
  assertSuiteSnapshot(input.suite);
  assertPolicySnapshot(input.policy);
  if (
    !validIdentifier(input.taskClass)
    || !validInstant(input.evaluatedAt)
    || !validDigest(input.effectivePolicyDigest)
  ) throw new QualificationError("QUALIFICATION_BINDING_MISMATCH");

  const taskCases = input.suite.corpus.cases.filter((item) => item.taskClass === input.taskClass);
  if (taskCases.length === 0) throw new QualificationError("QUALIFICATION_INPUT_INVALID");
  assertObservationBinding(input, taskCases.map((item) => item.caseId));

  // The answers are read off the authenticated observations rather than taken
  // from the caller, so every graded answer is one a recorded invocation
  // actually returned. A case with no observation is unanswered and scores
  // zero; an answer with no observation cannot reach the grader at all.
  const answers = answersFromObservations(input.observations);
  const score = scoreCases(taskCases, answers, input.taskClass);
  const derivedRoles = deriveRoles(input.taskClass, score.dimensionEvaluations, input.policy);
  const profileDigest = exactDigest(input.profile);
  // Expiry comes from the declared qualification policy and from nothing else.
  // Previously it was the earlier of the policy window and the probe's own
  // expiry, which made a qualification's lifetime depend on an availability
  // observation; the policy already declares the window it wants.
  const validUntil = new Date(
    Date.parse(input.evaluatedAt) + input.policy.validitySeconds * 1_000,
  ).toISOString();
  const withoutDigest = {
    schema: "urn:usf:semantic-qualification-result:1" as const,
    status: derivedRoles[0] === "UNQUALIFIED" ? "unqualified" as const : "qualified" as const,
    taskClass: input.taskClass,
    profile: {
      profileDigest,
      requested: {
        provider: input.profile.provider,
        model: input.profile.requestedModel,
        adapter: input.profile.adapter,
        adapterVersion: input.profile.adapterVersion,
        adapterLockDigest: input.profile.adapterLockDigest,
        authMode: input.profile.authMode,
        toolProfile: input.profile.toolProfile,
        toolProfileDigest: input.profile.toolProfileDigest,
        promptVersion: input.profile.promptVersion,
        promptDigest: input.profile.promptDigest,
        contextConfig: input.profile.contextConfig,
        contextConfigDigest: input.profile.contextConfigDigest,
        outputConfig: input.profile.outputConfig,
        outputConfigDigest: input.profile.outputConfigDigest,
      },
      // The identity that actually answered, taken from the observations. They
      // are authenticated to agree with each other and with the requested
      // model, so the first carries the set's answer.
      actual: {
        provider: input.observations[0]!.provider,
        model: input.observations[0]!.actualModel,
        transport: input.observations[0]!.transport,
      },
    },
    inputs: {
      suiteDigest: input.suite.suiteDigest,
      corpusDigest: input.suite.corpusDigest,
      qualificationPolicyDigest: input.policy.policyDigest,
      effectivePolicyDigest: input.effectivePolicyDigest,
      observationSetDigest: observationSetDigest(input.observations),
    },
    ...score,
    derivedRoles,
    observedAt: earliestObservedAt(input.observations),
    evaluatedAt: input.evaluatedAt,
    validUntil,
    externalContact: false as const,
    authorityEffect: "none" as const,
    nonclaims,
  };
  return deepFreeze({
    ...withoutDigest,
    qualificationDigest: exactDigest(withoutDigest),
  }) as SemanticQualificationResult;
}

/** Verify immutable result identity, exact task/binding scope, and currentness. */
export function verifySemanticQualification(
  result: SemanticQualificationResult,
  expected: QualificationExpectedBindings,
  at: string,
): VerifiedSemanticQualification {
  if (
    !validInstant(at)
    || result.schema !== "urn:usf:semantic-qualification-result:1"
    || !validIdentifier(expected.taskClass)
    || !validDigest(expected.profileDigest)
    || !validDigest(expected.suiteDigest)
    || !validDigest(expected.corpusDigest)
    || !validDigest(expected.qualificationPolicyDigest)
    || !validDigest(expected.effectivePolicyDigest)
    || !validDigest(expected.observationSetDigest)
  ) {
    throw new QualificationError("QUALIFICATION_INPUT_INVALID");
  }
  const { qualificationDigest: _ignored, ...withoutDigest } = result;
  if (result.qualificationDigest !== exactDigest(withoutDigest)) {
    throw new QualificationError("QUALIFICATION_RESULT_DIGEST_MISMATCH");
  }
  const requested = result.profile.requested;
  if (
    !isRecord(requested)
    || !validIdentifier(requested.provider)
    || !validIdentifier(requested.model)
    || !adapterPattern.test(requested.adapter)
    || !validIdentifier(requested.adapterVersion)
    || !validDigest(requested.adapterLockDigest)
    || !authModes.has(requested.authMode)
    || !validIdentifier(requested.toolProfile)
    || !validDigest(requested.toolProfileDigest)
    || !validIdentifier(requested.promptVersion)
    || !validDigest(requested.promptDigest)
    || !validIdentifier(requested.contextConfig)
    || !validDigest(requested.contextConfigDigest)
    || !validIdentifier(requested.outputConfig)
    || !validDigest(requested.outputConfigDigest)
    || result.profile.profileDigest !== exactDigest({
      schema: "urn:usf:agent-profile:1",
      provider: requested.provider,
      requestedModel: requested.model,
      adapter: requested.adapter,
      adapterVersion: requested.adapterVersion,
      adapterLockDigest: requested.adapterLockDigest,
      authMode: requested.authMode,
      toolProfile: requested.toolProfile,
      toolProfileDigest: requested.toolProfileDigest,
      promptVersion: requested.promptVersion,
      promptDigest: requested.promptDigest,
      contextConfig: requested.contextConfig,
      contextConfigDigest: requested.contextConfigDigest,
      outputConfig: requested.outputConfig,
      outputConfigDigest: requested.outputConfigDigest,
    })
  ) throw new QualificationError("QUALIFICATION_RESULT_BINDING_MISMATCH");
  const actualBindings: QualificationExpectedBindings = {
    taskClass: result.taskClass,
    profileDigest: result.profile.profileDigest,
    suiteDigest: result.inputs.suiteDigest,
    corpusDigest: result.inputs.corpusDigest,
    qualificationPolicyDigest: result.inputs.qualificationPolicyDigest,
    effectivePolicyDigest: result.inputs.effectivePolicyDigest,
    observationSetDigest: result.inputs.observationSetDigest,
  };
  if (canonicalJson(actualBindings) !== canonicalJson(expected)) {
    throw new QualificationError("QUALIFICATION_RESULT_BINDING_MISMATCH");
  }
  if (
    !validInstant(result.observedAt)
    || !validInstant(result.evaluatedAt)
    || !validInstant(result.validUntil)
    || Date.parse(result.observedAt) > Date.parse(at)
    || Date.parse(at) >= Date.parse(result.validUntil)
  ) throw new QualificationError("QUALIFICATION_RESULT_STALE");
  if (
    (result.status !== "qualified" && result.status !== "unqualified")
    ||
    !Array.isArray(result.derivedRoles)
    || result.derivedRoles.length === 0
    || result.derivedRoles.some((role) => !roleSet.has(role))
    || new Set(result.derivedRoles).size !== result.derivedRoles.length
    || (result.status === "qualified" && result.derivedRoles.includes("UNQUALIFIED"))
    || (result.status === "unqualified") !== (result.derivedRoles.length === 1 && result.derivedRoles[0] === "UNQUALIFIED")
  ) throw new QualificationError("QUALIFICATION_RESULT_BINDING_MISMATCH");
  return deepFreeze({
    current: true as const,
    status: result.status,
    taskClass: result.taskClass,
    qualificationDigest: result.qualificationDigest,
    validUntil: result.validUntil,
    derivedRoles: [...result.derivedRoles],
  }) as VerifiedSemanticQualification;
}

function hiddenProjectionWithoutDigest(item: QualificationCase, suite: QualificationSuiteSnapshot): Omit<HiddenPromptProjection, "projectionDigest"> {
  return {
    schema: "urn:usf:hidden-prompt-projection:1",
    suiteDigest: suite.suiteDigest,
    corpusDigest: suite.corpusDigest,
    taskClass: item.taskClass,
    caseId: item.caseId,
    prompt: item.prompt,
  };
}

/**
 * Build per-case prompt-only projections for the hidden evaluator. The route
 * receives no suite topology, grader, holdout label, dimension, weight or
 * expected answer and cannot enumerate sibling cases from one projection.
 */
export function createHiddenPromptProjections(
  suite: QualificationSuiteSnapshot,
  taskClass: string,
): readonly HiddenPromptProjection[] {
  assertSuiteSnapshot(suite);
  if (!validIdentifier(taskClass)) throw new QualificationError("HIDDEN_EVALUATION_INPUT_INVALID");
  const cases = suite.corpus.cases
    .filter((item) => item.taskClass === taskClass && item.holdout)
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (cases.length === 0) throw new QualificationError("HIDDEN_EVALUATION_INPUT_INVALID");
  return deepFreeze(cases.map((item) => {
    const withoutDigest = hiddenProjectionWithoutDigest(item, suite);
    return { ...withoutDigest, projectionDigest: exactDigest(withoutDigest) };
  })) as readonly HiddenPromptProjection[];
}

function validHiddenAnswer(value: unknown): value is HiddenProviderAnswerObservation {
  return isRecord(value)
    && hasExactKeys(value, [
      "caseId", "promptProjectionDigest", "routeMemberDigest", "taskProfileDigest",
      "providerAnswerDigest", "answer", "acquiredAt", "expiresAt",
    ])
    && validIdentifier(value.caseId)
    && validDigest(value.promptProjectionDigest)
    && validDigest(value.routeMemberDigest)
    && validDigest(value.taskProfileDigest)
    && validDigest(value.providerAnswerDigest)
    && validBoundedString(value.answer)
    && validInstant(value.acquiredAt)
    && validInstant(value.expiresAt)
    && Date.parse(value.acquiredAt) < Date.parse(value.expiresAt)
    && value.providerAnswerDigest === hiddenProviderAnswerObservationDigest(
      value as unknown as Omit<HiddenProviderAnswerObservation, "providerAnswerDigest">,
    );
}

/**
 * Bind the exact answer bytes and every evaluator-visible provenance field.
 * Provider provenance itself is established by the separate invocation-stage
 * verifier; this digest prevents the evaluator from grading different bytes
 * than that verifier admitted.
 */
export function hiddenProviderAnswerObservationDigest(
  value: Omit<HiddenProviderAnswerObservation, "providerAnswerDigest">,
): string {
  return exactDigest({
    caseId: value.caseId,
    promptProjectionDigest: value.promptProjectionDigest,
    routeMemberDigest: value.routeMemberDigest,
    taskProfileDigest: value.taskProfileDigest,
    answer: value.answer,
    acquiredAt: value.acquiredAt,
    expiresAt: value.expiresAt,
  });
}

function hiddenAnswerSetDigest(answers: readonly HiddenProviderAnswerObservation[]): string {
  return exactDigest([...answers]
    .sort((left, right) => left.caseId.localeCompare(right.caseId))
    .map((answer) => ({
      caseId: answer.caseId,
      promptProjectionDigest: answer.promptProjectionDigest,
      providerAnswerDigest: answer.providerAnswerDigest,
      routeMemberDigest: answer.routeMemberDigest,
      taskProfileDigest: answer.taskProfileDigest,
      answer: answer.answer,
      acquiredAt: answer.acquiredAt,
      expiresAt: answer.expiresAt,
    })));
}

/**
 * Evaluate only genuine hidden cases from the evaluator-owned suite. Missing,
 * stale, replayed or basis-mismatched answers score zero and keep the route
 * unqualified. This pure capability performs no provider or filesystem access.
 */
export function evaluateHiddenHoldout(input: HiddenEvaluationInput): HiddenEvaluationReceipt {
  assertSuiteSnapshot(input.suite);
  if (!validIdentifier(input.taskClass) || !validDigest(input.routeMemberDigest) || !validDigest(input.taskProfileDigest)
    || !validInstant(input.evaluatedAt) || !Number.isSafeInteger(input.validitySeconds)
    || input.validitySeconds < 1 || input.validitySeconds > maximumValiditySeconds || !Array.isArray(input.answers)) {
    throw new QualificationError("HIDDEN_EVALUATION_INPUT_INVALID");
  }
  const projections = createHiddenPromptProjections(input.suite, input.taskClass);
  if (input.answers.length > projections.length || input.answers.some((answer) => !validHiddenAnswer(answer))) {
    throw new QualificationError("HIDDEN_EVALUATION_INPUT_INVALID");
  }
  const projectionByCase = new Map(projections.map((projection) => [projection.caseId, projection]));
  const answerByCase = new Map<string, HiddenProviderAnswerObservation>();
  for (const answer of input.answers) {
    if (!projectionByCase.has(answer.caseId)) throw new QualificationError("QUALIFICATION_ANSWER_OUT_OF_SCOPE");
    if (answerByCase.has(answer.caseId)) throw new QualificationError("QUALIFICATION_ANSWER_DUPLICATE");
    answerByCase.set(answer.caseId, answer);
  }
  const casesById = new Map(input.suite.corpus.cases.map((item) => [item.caseId, item]));
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  let unmatchedCount = 0;
  const scores: HiddenEvaluationScore[] = [];
  const matchedAnswerExpiries: string[] = [];
  for (const projection of projections) {
    const item = casesById.get(projection.caseId)!;
    const answer = answerByCase.get(projection.caseId);
    const matched = answer !== undefined
      && answer.promptProjectionDigest === projection.projectionDigest
      && answer.routeMemberDigest === input.routeMemberDigest
      && answer.taskProfileDigest === input.taskProfileDigest
      && Date.parse(answer.acquiredAt) <= evaluatedAtMs
      && evaluatedAtMs < Date.parse(answer.expiresAt);
    if (!matched) unmatchedCount += 1;
    else matchedAnswerExpiries.push(answer.expiresAt);
    const score = matched ? gradeCase(item, answer.answer) : 0;
    scores.push(Object.freeze({
      caseId: item.caseId,
      dimension: item.dimension,
      answerPresent: matched,
      score,
      passed: score === 1,
    }));
  }
  const evaluatorExpiry = new Date(evaluatedAtMs + input.validitySeconds * 1_000).toISOString();
  const expiresAt = [...matchedAnswerExpiries, evaluatorExpiry].sort()[0]!;
  const graderPolicyDigest = exactDigest({
    suiteDigest: input.suite.suiteDigest,
    cases: projections.map((projection) => {
      const item = casesById.get(projection.caseId)!;
      return { caseId: item.caseId, grader: item.grader };
    }),
  });
  const thresholdDigest = exactDigest({ rule: "all-hidden-cases-must-pass", passingScore: 1 });
  const evaluatorDigest = exactDigest({ algorithm: "urn:usf:algorithm:hidden-holdout-evaluator:1", version: 1 });
  const producerSeparationDigest = exactDigest({
    mode: "one-prompt-projection-per-answer",
    projectionDigests: projections.map((projection) => projection.projectionDigest),
    excludedFields: ["dimension", "expected-answer", "grader", "holdout", "suite-cases", "weight"],
  });
  return deepFreeze({
    schema: "urn:usf:hidden-evaluation-receipt:1" as const,
    version: 1 as const,
    routeMemberDigest: input.routeMemberDigest,
    providerAnswerDigest: hiddenAnswerSetDigest(input.answers),
    taskProfileDigest: input.taskProfileDigest,
    suiteDigest: input.suite.suiteDigest,
    corpusDigest: input.suite.corpusDigest,
    graderPolicyDigest,
    thresholdDigest,
    evaluatorDigest,
    producerSeparationDigest,
    scores,
    unmatchedCount,
    disposition: unmatchedCount === 0 && scores.every((score) => score.passed) ? "qualified" as const : "unqualified" as const,
    evaluatedAt: input.evaluatedAt,
    expiresAt,
  }) as HiddenEvaluationReceipt;
}

export function parseHiddenEvaluationReceipt(value: unknown): HiddenEvaluationReceipt {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "schema", "version", "routeMemberDigest", "providerAnswerDigest", "taskProfileDigest",
      "suiteDigest", "corpusDigest", "graderPolicyDigest", "thresholdDigest", "evaluatorDigest",
      "producerSeparationDigest", "scores", "unmatchedCount", "disposition", "evaluatedAt", "expiresAt",
    ])
    || value.schema !== "urn:usf:hidden-evaluation-receipt:1" || value.version !== 1
    || !validDigest(value.routeMemberDigest) || !validDigest(value.providerAnswerDigest)
    || !validDigest(value.taskProfileDigest) || !validDigest(value.suiteDigest) || !validDigest(value.corpusDigest)
    || !validDigest(value.graderPolicyDigest) || !validDigest(value.thresholdDigest) || !validDigest(value.evaluatorDigest)
    || !validDigest(value.producerSeparationDigest) || !Array.isArray(value.scores) || value.scores.length < 1
    || value.scores.length > maximumCases || typeof value.unmatchedCount !== "number" || !Number.isSafeInteger(value.unmatchedCount) || value.unmatchedCount < 0
    || value.unmatchedCount > value.scores.length || (value.disposition !== "qualified" && value.disposition !== "unqualified")
    || !validInstant(value.evaluatedAt) || !validInstant(value.expiresAt)
    || Date.parse(value.evaluatedAt) >= Date.parse(value.expiresAt)) {
    throw new QualificationError("HIDDEN_EVALUATION_INPUT_INVALID");
  }
  const scores: HiddenEvaluationScore[] = [];
  for (const score of value.scores) {
    if (!isRecord(score) || !hasExactKeys(score, ["caseId", "dimension", "answerPresent", "score", "passed"])
      || !validIdentifier(score.caseId) || typeof score.dimension !== "string" || !dimensionSet.has(score.dimension)
      || typeof score.answerPresent !== "boolean" || !validScore(score.score) || typeof score.passed !== "boolean"
      || score.passed !== (score.score === 1) || (!score.answerPresent && score.score !== 0)) {
      throw new QualificationError("HIDDEN_EVALUATION_INPUT_INVALID");
    }
    scores.push(Object.freeze({
      caseId: score.caseId,
      dimension: score.dimension as QualificationDimension,
      answerPresent: score.answerPresent,
      score: score.score,
      passed: score.passed,
    }));
  }
  if (new Set(scores.map((score) => score.caseId)).size !== scores.length
    || [...scores].sort((left, right) => left.caseId.localeCompare(right.caseId)).some((score, index) => score.caseId !== scores[index]!.caseId)
    || (value.disposition === "qualified") !== (value.unmatchedCount === 0 && scores.every((score) => score.passed))) {
    throw new QualificationError("HIDDEN_EVALUATION_INPUT_INVALID");
  }
  return deepFreeze({ ...value, scores }) as unknown as HiddenEvaluationReceipt;
}

export function hiddenEvaluationReceiptDigest(value: unknown): string {
  return exactDigest(parseHiddenEvaluationReceipt(value));
}

export function verifyHiddenEvaluationReceipt(
  value: unknown,
  input: HiddenEvaluationInput,
  at: string,
): VerifiedHiddenEvaluation {
  const receipt = parseHiddenEvaluationReceipt(value);
  if (!validInstant(at)) throw new QualificationError("HIDDEN_EVALUATION_BINDING_MISMATCH");
  const expected = evaluateHiddenHoldout(input);
  const receiptDigest = hiddenEvaluationReceiptDigest(receipt);
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    throw new QualificationError("HIDDEN_EVALUATION_RESULT_DIGEST_MISMATCH");
  }
  if (Date.parse(receipt.evaluatedAt) > Date.parse(at) || Date.parse(at) >= Date.parse(receipt.expiresAt)) {
    throw new QualificationError("HIDDEN_EVALUATION_STALE");
  }
  return deepFreeze({ current: true, disposition: receipt.disposition, receiptDigest, expiresAt: receipt.expiresAt }) as VerifiedHiddenEvaluation;
}
