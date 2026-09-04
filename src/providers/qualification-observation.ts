import { canonicalDigest } from "../core/canonical.ts";

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

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+~ ()-]{0,191}$/u;
const adapterPattern = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,95}$/u;
const maximumAnswerBytes = 64 * 1024;

const validDigest = (value: unknown): value is string =>
  typeof value === "string" && digestPattern.test(value);
const validIdentifier = (value: unknown): value is string =>
  typeof value === "string" && identifierPattern.test(value);
const validInstant = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

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
    || !validIdentifier(value.provider)
    || !validIdentifier(value.requestedModel)
    || !validIdentifier(value.actualModel)
    || !validIdentifier(value.transport)
    || !validIdentifier(value.caseId)
    || (value.adapterPackage !== null && !adapterPattern.test(String(value.adapterPackage)))
    // An adapter is either fully identified or absent. A package with no
    // version, or a version with no package, is a half-recorded execution path.
    || (value.adapterPackage === null
      ? (value.adapterVersion !== null || value.adapterLockDigest !== null)
      : (!validIdentifier(value.adapterVersion) || !validDigest(value.adapterLockDigest)))
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
