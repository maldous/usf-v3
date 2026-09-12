import { canonicalJson, sha256 } from "../core/canonical.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";

type Disposition = "unknown" | "accepted" | "failed-validation" | "provider-failure" | "merge-failure";
type Provenance = { identity: string; contentDigest: string; producerIdentity: string };
type Tokens = { value: number | null; provenance: Provenance | null };
type Duration = { valueNanoseconds: number | null; provenance: Provenance | null };
const MAX_FEEDBACK_INPUT_CHARACTERS = 5_000_000;
export interface FeedbackContext {
  identity: string; contentDigest: string; contentClass: string; provenanceIdentity: string;
  sourceName: string; sourceDigest: string; importVersion: string;
}
export interface FeedbackEvent {
  schema: string; observationIdentity: string; observedAt: string; sourceIdentity: string; clockInstanceIdentity: string;
  joins: { attemptIdentity: string | null; logicalAttemptIdentity: string | null; issueIdentity: string | null;
    laneIdentity: string | null; workIdentity: string | null; realisationBasisDigest: string | null;
    routeIdentity: string | null; validationIdentity: string | null; mergeIdentity: string | null; comparableScopeIdentity: string | null };
  phase: { identity: string; clockDomainIdentity: string; startOffsetNanoseconds: number; endOffsetNanoseconds: number };
  measurement: { observedPhaseWallNanoseconds: number; queue: Duration; modelActive: Duration };
  usage: { inputTokens: Tokens; outputTokens: Tokens };
  rawProviderOutcome: string; semanticDisposition: Disposition;
  settledResultReference: null | { identity: string; contentDigest: string; verificationState: string;
    settledAttemptIdentity: string; comparableScopeIdentity: string; semanticDisposition: Exclude<Disposition, "unknown"> };
  context: FeedbackContext[];
}
export interface FeedbackPolicy {
  schema: string; version: number; mode: string;
  minimumDistinctSettledAttempts: number; minimumDistinctSettledAcceptedAttempts: number;
  measurement: { acceptedClockDomain: string; queue: string; modelActive: string; tokens: string };
  acceptance: { requiredVerificationState: string; requiredDisposition: string; requireExactAttemptAndComparableScopeJoin: boolean };
  recurringFailure: { eligibleSemanticDispositions: string[]; requireExactAttemptScopeAndDispositionJoin: boolean; acceptedProgressOrRoiClaim: boolean };
  guidance: { providerNeutral: boolean; proposalOnly: boolean; automaticSemanticActivation: boolean; automaticHostSkillUpdate: boolean; allowPrivateCodexRuntime: boolean };
  contextAllowlist: FeedbackContext[];
}

function refuse(reason: string): never { throw new Error(`HERMES_FEEDBACK_${reason}`); }

// Snapshot plain JSON without invoking getters or toJSON; bounds apply before
// schema validation and canonicalization, including cyclic caller values.
function snapshot<T>(input: T): T {
  let nodes = 0;
  let characters = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 24) refuse("INPUT_BOUND");
    if (typeof value === "string") {
      characters += value.length;
      if (characters > MAX_FEEDBACK_INPUT_CHARACTERS) refuse("INPUT_BOUND");
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (typeof value !== "object") refuse("NON_JSON");
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) refuse("NON_JSON");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(key => typeof key !== "string")) refuse("NON_JSON");
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (!descriptor.enumerable || !("value" in descriptor)) refuse("NON_JSON");
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (!array) return result;
    if (Object.keys(result).length !== value.length) refuse("NON_JSON");
    return Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(result, String(index))) refuse("NON_JSON");
      return result[String(index)];
    });
  };
  return visit(input, 0) as T;
}

function validUtc(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.getUTCFullYear() === +match[1] && date.getUTCMonth() + 1 === +match[2]
    && date.getUTCDate() === +match[3] && date.getUTCHours() === +match[4] && date.getUTCMinutes() === +match[5] && date.getUTCSeconds() === +match[6];
}

/** All inputs are caller-supplied values. Verification labels are not authenticated here. */
export function createHermesFeedback(schema: unknown, policyInput: FeedbackPolicy, contextBytes: Readonly<Record<string, string>>) {
  const policy = snapshot(policyInput);
  const bytes = snapshot(contextBytes);
  const validator = createJsonSchemaValidator<FeedbackEvent>(snapshot(schema));
  if (validator.schemaId !== "urn:usf:hermes-feedback-event:1") refuse("SCHEMA");
  const thresholds = [policy.minimumDistinctSettledAttempts, policy.minimumDistinctSettledAcceptedAttempts];
  if (thresholds.some(n => !Number.isSafeInteger(n) || n < 3 || n > 1000)
    || policy.schema !== "urn:usf:hermes-feedback-config:1" || policy.version !== 1 || policy.mode !== "advisory-only-runtime"
    || canonicalJson(policy.guidance) !== canonicalJson({ providerNeutral: true, proposalOnly: true, automaticSemanticActivation: false, automaticHostSkillUpdate: false, allowPrivateCodexRuntime: false })
    || canonicalJson(policy.acceptance) !== canonicalJson({ requiredVerificationState: "independently-verified-by-consuming-runtime", requiredDisposition: "accepted", requireExactAttemptAndComparableScopeJoin: true })
    || canonicalJson(policy.measurement) !== canonicalJson({ acceptedClockDomain: "monotonic-observed-phase-wall", queue: "unknown-unless-independently-measured", modelActive: "unknown-unless-independently-measured", tokens: "unknown-unless-independently-reported" })
    || policy.recurringFailure.requireExactAttemptScopeAndDispositionJoin !== true || policy.recurringFailure.acceptedProgressOrRoiClaim !== false
    || canonicalJson([...policy.recurringFailure.eligibleSemanticDispositions].sort()) !== canonicalJson(["failed-validation", "merge-failure", "provider-failure"])) refuse("POLICY");
  if (!Array.isArray(policy.contextAllowlist) || policy.contextAllowlist.length < 1 || policy.contextAllowlist.length > 16) refuse("CONTEXT");
  const allowed = new Map<string, string>();
  for (const item of policy.contextAllowlist) {
    if (allowed.has(item.identity) || typeof bytes[item.identity] !== "string" || sha256(bytes[item.identity]) !== item.contentDigest) refuse("CONTEXT");
    allowed.set(item.identity, canonicalJson(item));
  }
  if (Object.keys(bytes).some(id => !allowed.has(id))) refuse("CONTEXT");

  function observe(input: unknown): FeedbackEvent {
    const event = snapshot(input);
    const checked = validator.validate(event);
    if (!checked.valid) refuse("EVENT_SCHEMA");
    const value = checked.value;
    if (!validUtc(value.observedAt)) refuse("UTC");
    const elapsed = value.phase.endOffsetNanoseconds - value.phase.startOffsetNanoseconds;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed !== value.measurement.observedPhaseWallNanoseconds) refuse("PHASE_INTERVAL");
    const seen = new Set<string>();
    for (const item of value.context) {
      if (seen.has(item.identity) || allowed.get(item.identity) !== canonicalJson(item)) refuse("CONTEXT");
      seen.add(item.identity);
    }
    value.context.sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
    const result = value.settledResultReference;
    if (result && (result.settledAttemptIdentity !== value.joins.attemptIdentity
      || result.comparableScopeIdentity !== value.joins.comparableScopeIdentity
      || result.semanticDisposition !== value.semanticDisposition)) refuse("RESULT_JOIN");
    return value;
  }

  function propose(inputs: readonly unknown[]) {
    if (!Array.isArray(inputs) || inputs.length > 1000) refuse("COHORT_BOUND");
    const events = inputs.map(observe);
    const observations = new Map<string, string>();
    const attempts = new Map<string, string>();
    const logical = new Set<string>();
    const results = new Set<string>();
    const distinct: FeedbackEvent[] = [];
    for (const event of events) {
      const encoded = canonicalJson(event);
      const prior = observations.get(event.observationIdentity);
      if (prior !== undefined) { if (prior !== encoded) refuse("OBSERVATION_CONFLICT"); continue; }
      observations.set(event.observationIdentity, encoded);
      const result = event.settledResultReference;
      if (!result || result.verificationState !== policy.acceptance.requiredVerificationState
        || event.joins.attemptIdentity === null || event.joins.comparableScopeIdentity === null) return null;
      // A single attempt, logical retry lineage or settled receipt never adds
      // another sample merely because it was observed again.
      const attempt = event.joins.attemptIdentity;
      if (attempts.has(attempt)) return null;
      attempts.set(attempt, encoded);
      const lineage = event.joins.logicalAttemptIdentity ?? attempt;
      if (logical.has(lineage) || results.has(result.identity) || results.has(result.contentDigest)) return null;
      logical.add(lineage); results.add(result.identity); results.add(result.contentDigest);
      distinct.push(event);
    }
    const first = distinct[0];
    if (!first) return null;
    const comparison = (e: FeedbackEvent) => canonicalJson({ scope: e.joins.comparableScopeIdentity,
      issue: e.joins.issueIdentity, lane: e.joins.laneIdentity, work: e.joins.workIdentity, basis: e.joins.realisationBasisDigest,
      route: e.joins.routeIdentity, phase: e.phase.identity, domain: e.phase.clockDomainIdentity,
      disposition: e.semanticDisposition, context: e.context });
    if (distinct.some(e => comparison(e) !== comparison(first))) return null;
    const accepted = first.semanticDisposition === "accepted";
    if (!accepted && !policy.recurringFailure.eligibleSemanticDispositions.includes(first.semanticDisposition)) return null;
    if (distinct.length < (accepted ? policy.minimumDistinctSettledAcceptedAttempts : policy.minimumDistinctSettledAttempts)) return null;
    return {
      mode: "advisory-only-runtime" as const,
      kind: accepted ? "accepted-outcome-review" as const : "recurring-failure" as const,
      comparableScopeIdentity: first.joins.comparableScopeIdentity,
      semanticDisposition: first.semanticDisposition,
      attemptIdentities: distinct.map(e => e.joins.attemptIdentity!).sort(),
      observations: distinct.sort((a, b) => a.observationIdentity < b.observationIdentity ? -1 : 1),
      authentication: "supplied-runtime-verification-not-authenticated-by-helper" as const,
      acceptedProgressClaim: false, roiClaim: false, automaticSemanticActivation: false, automaticHostSkillUpdate: false,
    };
  }
  return Object.freeze({ observe, propose });
}
