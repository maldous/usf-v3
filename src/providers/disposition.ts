import { canonicalDigest } from "../core/canonical.ts";
import {
  accountSourceKeyDigest,
  observationUseDisposition,
  type AccountObservation,
  type AccountSourceAttempt,
  type AccountSourceAuthorizationV2,
  type AccountSourceKey,
  type AccountSourceTransport,
  type EntitlementDisposition,
  type QuotaDisposition,
} from "./account-sources.ts";
import type { HostSourceIdentity } from "./host-source-identities.ts";

/**
 * The pure, snapshot-bound projection from account evidence to one terminal
 * disposition per candidate.
 *
 * Three properties are the reason this is a separate module rather than logic
 * inside the receipt command.
 *
 * It is *total*: every candidate in the frozen denominator receives exactly one
 * disposition, including the uninteresting ones. Silence is not a disposition.
 *
 * It *never chooses implicitly*. Zero applicable sources is `not-observed`;
 * more than one competing applicable source is `conflict-ineligible`. It does
 * not break ties by array order, latency, price or provider preference, because
 * any of those would silently prefer one account's economics over another's.
 *
 * It is *pure and lock-free*: no contact, no clock read, no provider, Git or
 * global mutation lock. The evaluation instant is supplied by the caller so a
 * projection and the decision it informs cannot disagree about "now".
 */

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const instantPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const prefixPattern = /^[0-9a-f]{2}$/u;

export type EconomicsDisposition = "zero-paid" | "paid" | "conflict-ineligible" | "not-observed" | "refused";
export type ServiceTierDisposition = "observed" | "not-observed" | "conflict-ineligible" | "refused";
export type SourceConflictDisposition = "single-source" | "conflict-ineligible" | "not-observed";
export type AccountDisposition = "observed" | "not-observed" | "deferred" | "conflict-ineligible" | "refused";
export type AvailabilityDisposition = "available" | "unavailable" | "not-observed";
export type QualificationDisposition = "qualified" | "unqualified" | "not-observed";
export type AllocationDisposition = "allocatable" | "not-allocatable" | "not-observed";
export type ConfigurationDisposition = "configured" | "unconfigured" | "ambiguous";
export type AdapterDisposition = "installed" | "absent" | "unmapped";
export type CredentialDisposition = "present" | "absent" | "unverified" | "refused";
export type EconomicsRecordKind = "route-model-economics-binding" | "provider-route-disposition";

export class DispositionError extends Error {
  readonly code: "DISPOSITION_INPUT_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "DispositionError";
    this.code = "DISPOSITION_INPUT_INVALID";
  }
}

function require_(condition: boolean, what: string): void {
  if (!condition) throw new DispositionError(`The disposition input is invalid: ${what}.`);
}

function digest(value: string, what: string): string {
  require_(digestPattern.test(value), what);
  return value;
}

/** One candidate in the frozen denominator. */
export interface EconomicsCandidate {
  readonly candidateMemberDigest: string;
  readonly sourceKind: "models-dev-route" | "subscription-host";
  readonly provider: string;
  readonly model: string;
  readonly transport: AccountSourceTransport;
  readonly configuredRouteMemberDigest: string | null;
  readonly adapterPackage: string | null;
  readonly adapterInstalled: boolean;
  /** True when any raw catalogue price member is outside the supported projection. */
  readonly conditionalPricing: boolean;
  readonly unsupportedPriceMembers: readonly string[];
  readonly cataloguePriceZero: boolean | null;
}

/** One factual source, already parsed and authenticated by its own module. */
export interface FactualSource {
  readonly key: AccountSourceKey;
  readonly observation: AccountObservation | null;
  readonly hostIdentity: HostSourceIdentity | null;
  readonly attempt: AccountSourceAttempt | null;
  readonly useAuthorization: AccountSourceAuthorizationV2 | null;
}

/**
 * A provider-HTTP account mapping applies to a catalogue route only when the
 * candidate's provider *and* transport both equal the mapping's. Matching on
 * provider alone would let one provider's OpenRouter account speak for its
 * direct-SDK route, which is a different account with different economics.
 */
export function sourceApplies(candidate: EconomicsCandidate, source: FactualSource): boolean {
  if (source.key.sourceKind === "subscription-host") {
    return candidate.sourceKind === "subscription-host"
      && candidate.transport === source.key.transport
      && candidate.provider === source.key.provider;
  }
  return candidate.sourceKind === "models-dev-route"
    && candidate.transport === source.key.transport
    && candidate.provider === source.key.provider;
}

export interface ReducedCandidateSource {
  readonly candidateMemberDigest: string;
  readonly selected: FactualSource | null;
  readonly applicableCount: number;
  readonly accountDisposition: AccountDisposition;
  readonly sourceConflictDisposition: SourceConflictDisposition;
  readonly candidateSourceSetDigest: string;
  readonly reasonCodes: readonly string[];
}

/**
 * Reduce the current source set to at most one applicable source per candidate.
 *
 * `candidateSourceSetDigest` hashes only the sources that actually apply to this
 * candidate, so an unrelated provider acquiring or failing does not move this
 * candidate's currentness. A global digest here would make every candidate
 * sensitive to every source and turn the whole projection into one reproof
 * bottleneck.
 */
export function reduceCandidateSource(
  candidate: EconomicsCandidate,
  sources: readonly FactualSource[],
  atInstant: string,
): ReducedCandidateSource {
  require_(instantPattern.test(atInstant), "evaluation instant");
  digest(candidate.candidateMemberDigest, "candidate member digest");
  const applicable = sources.filter((source) => sourceApplies(candidate, source));
  const candidateSourceSetDigest = canonicalDigest({
    kind: "candidate-source-set",
    members: applicable
      .map((source) => ({
        accountSourceKeyDigest: accountSourceKeyDigest(source.key),
        credentialSourceIdentityDigest: source.key.credentialSourceIdentityDigest,
        evidenceDigest: source.observation === null
          ? source.hostIdentity === null ? null : source.hostIdentity.credentialSourceIdentityDigest
          : source.observation.rawProviderResponseDigest,
      }))
      .sort((left, right) => left.accountSourceKeyDigest.localeCompare(right.accountSourceKeyDigest)),
  });
  const reasonCodes: string[] = [];
  if (applicable.length === 0) {
    return Object.freeze({
      candidateMemberDigest: candidate.candidateMemberDigest, selected: null, applicableCount: 0,
      accountDisposition: "not-observed" as const, sourceConflictDisposition: "not-observed" as const,
      candidateSourceSetDigest, reasonCodes: Object.freeze(["ACCOUNT_SOURCE_NOT_OBSERVED"]),
    });
  }
  if (applicable.length > 1) {
    // Never choose implicitly between competing accounts.
    return Object.freeze({
      candidateMemberDigest: candidate.candidateMemberDigest, selected: null, applicableCount: applicable.length,
      accountDisposition: "conflict-ineligible" as const, sourceConflictDisposition: "conflict-ineligible" as const,
      candidateSourceSetDigest, reasonCodes: Object.freeze(["ACCOUNT_SOURCE_CONFLICT_INELIGIBLE"]),
    });
  }
  const source = applicable[0]!;
  let accountDisposition: AccountDisposition = "not-observed";
  if (source.observation !== null) {
    const use = observationUseDisposition(source.observation, atInstant);
    if (use === "current") accountDisposition = "observed";
    else { accountDisposition = "not-observed"; reasonCodes.push(`ACCOUNT_OBSERVATION_${use === "expired" ? "EXPIRED" : "NOT_YET_VALID"}`); }
  } else if (source.hostIdentity !== null) {
    accountDisposition = source.hostIdentity.disposition === "stable" ? "observed" : "not-observed";
    if (source.hostIdentity.disposition !== "stable") reasonCodes.push("HOST_SOURCE_IDENTITY_UNSTABLE");
  }
  // A current failed attempt defers only this source; it does not refuse it.
  if (accountDisposition !== "observed" && source.attempt !== null && Date.parse(atInstant) < Date.parse(source.attempt.retryAfter)) {
    accountDisposition = "deferred";
    reasonCodes.push("ACCOUNT_SOURCE_ATTEMPT_DEFERRED");
  }
  return Object.freeze({
    candidateMemberDigest: candidate.candidateMemberDigest, selected: source, applicableCount: 1,
    accountDisposition, sourceConflictDisposition: "single-source" as const,
    candidateSourceSetDigest, reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
  });
}

export interface CandidateDisposition {
  readonly candidateMemberDigest: string;
  readonly provider: string;
  readonly model: string;
  readonly transport: AccountSourceTransport;
  readonly configuredRouteMemberDigest: string | null;
  readonly candidateSourceSetDigest: string;
  readonly configurationDisposition: ConfigurationDisposition;
  readonly adapterDisposition: AdapterDisposition;
  readonly credentialDisposition: CredentialDisposition;
  readonly accountDisposition: AccountDisposition;
  readonly sourceConflictDisposition: SourceConflictDisposition;
  readonly economicsDisposition: EconomicsDisposition;
  readonly serviceTierDisposition: ServiceTierDisposition;
  readonly availabilityDisposition: AvailabilityDisposition;
  readonly qualificationDisposition: QualificationDisposition;
  readonly allocationDisposition: AllocationDisposition;
  readonly entitlementDisposition: EntitlementDisposition;
  readonly quotaDisposition: QuotaDisposition;
  readonly reasonCodes: readonly string[];
}

/**
 * One terminal disposition for one candidate.
 *
 * Zero-paid is deliberately hard to reach: it needs a current observation, a
 * complete catalogue price with no conditional members, an entitled account
 * with available quota, and paid usage, automatic overage and automatic top-up
 * all explicitly disabled. Any unknown leaves the candidate not-observed rather
 * than optimistically zero-paid, because an unpriced route that turns out to
 * bill is the failure this projection exists to prevent.
 */
export function candidateDisposition(
  candidate: EconomicsCandidate,
  reduced: ReducedCandidateSource,
  atInstant: string,
): CandidateDisposition {
  require_(instantPattern.test(atInstant), "evaluation instant");
  const reasonCodes = [...reduced.reasonCodes];
  const observation = reduced.selected?.observation ?? null;
  const hostIdentity = reduced.selected?.hostIdentity ?? null;

  const configurationDisposition: ConfigurationDisposition = candidate.configuredRouteMemberDigest === null ? "unconfigured" : "configured";
  const adapterDisposition: AdapterDisposition = candidate.adapterPackage === null
    ? "unmapped" : candidate.adapterInstalled ? "installed" : "absent";
  const credentialDisposition: CredentialDisposition = reduced.selected === null
    ? "absent" : reduced.accountDisposition === "observed" ? "present" : "unverified";

  const entitlementDisposition: EntitlementDisposition = observation?.entitlementDisposition
    ?? (hostIdentity !== null && reduced.accountDisposition === "observed" ? "not-observed" : "not-observed");
  const quotaDisposition: QuotaDisposition = observation?.quota.availability ?? "not-observed";

  let serviceTierDisposition: ServiceTierDisposition = "not-observed";
  if (reduced.sourceConflictDisposition === "conflict-ineligible") serviceTierDisposition = "conflict-ineligible";
  else if (observation?.serviceTier != null && reduced.accountDisposition === "observed") serviceTierDisposition = "observed";

  let economicsDisposition: EconomicsDisposition;
  if (reduced.sourceConflictDisposition === "conflict-ineligible") {
    economicsDisposition = "conflict-ineligible";
  } else if (candidate.conditionalPricing || candidate.unsupportedPriceMembers.length > 0) {
    // An unrepresented price member makes completeness unknown even when the
    // base fields read as zero.
    economicsDisposition = "not-observed";
    reasonCodes.push("CATALOGUE_PRICE_COMPLETENESS_UNKNOWN");
  } else if (reduced.accountDisposition !== "observed" || observation === null) {
    economicsDisposition = "not-observed";
  } else if (observation.paidUsageEnabled === true || observation.automaticOverageEnabled === true || observation.automaticTopUpEnabled === true) {
    economicsDisposition = "paid";
    reasonCodes.push("ACCOUNT_PAID_CONTROLS_ENABLED");
  } else if (observation.paidUsageEnabled === null || observation.automaticOverageEnabled === null || observation.automaticTopUpEnabled === null) {
    economicsDisposition = "not-observed";
    reasonCodes.push("ACCOUNT_PAID_CONTROLS_UNKNOWN");
  } else if (candidate.cataloguePriceZero !== true) {
    economicsDisposition = observation.costDisposition === "zero-paid" ? "not-observed" : "paid";
    reasonCodes.push("CATALOGUE_PRICE_NOT_ZERO");
  } else if (entitlementDisposition !== "entitled") {
    economicsDisposition = "not-observed";
    reasonCodes.push("ACCOUNT_NOT_ENTITLED");
  } else if (quotaDisposition !== "available") {
    economicsDisposition = "not-observed";
    reasonCodes.push("ACCOUNT_QUOTA_UNAVAILABLE");
  } else {
    economicsDisposition = "zero-paid";
  }

  const availabilityDisposition: AvailabilityDisposition = adapterDisposition === "installed" && reduced.accountDisposition === "observed"
    ? "available" : reduced.accountDisposition === "not-observed" ? "not-observed" : "unavailable";
  // Qualification and allocation are downstream contracts. This projection is
  // never their evidence, so it reports them as unobserved rather than guessing.
  const qualificationDisposition: QualificationDisposition = "not-observed";
  const allocationDisposition: AllocationDisposition = economicsDisposition === "zero-paid" && availabilityDisposition === "available"
    ? "allocatable" : economicsDisposition === "paid" ? "not-allocatable" : "not-observed";

  return Object.freeze({
    candidateMemberDigest: candidate.candidateMemberDigest,
    provider: candidate.provider, model: candidate.model, transport: candidate.transport,
    configuredRouteMemberDigest: candidate.configuredRouteMemberDigest,
    candidateSourceSetDigest: reduced.candidateSourceSetDigest,
    configurationDisposition, adapterDisposition, credentialDisposition,
    accountDisposition: reduced.accountDisposition,
    sourceConflictDisposition: reduced.sourceConflictDisposition,
    economicsDisposition, serviceTierDisposition, availabilityDisposition,
    qualificationDisposition, allocationDisposition,
    entitlementDisposition, quotaDisposition,
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
  });
}

/**
 * Project the complete frozen denominator. Totality is the contract: the result
 * carries exactly one disposition per candidate, in canonical candidate order.
 */
export function projectCandidateDispositions(
  candidates: readonly EconomicsCandidate[],
  sources: readonly FactualSource[],
  atInstant: string,
): readonly CandidateDisposition[] {
  const ordered = [...candidates].sort((left, right) => left.candidateMemberDigest.localeCompare(right.candidateMemberDigest));
  const seen = new Set<string>();
  for (const candidate of ordered) {
    require_(!seen.has(candidate.candidateMemberDigest), "duplicate candidate member digest");
    seen.add(candidate.candidateMemberDigest);
  }
  return Object.freeze(ordered.map((candidate) => candidateDisposition(candidate, reduceCandidateSource(candidate, sources, atInstant), atInstant)));
}

/** The fixed 256-way bucket prefix: the digest's first two hex octets. */
export function candidatePrefix(candidateMemberDigest: string): string {
  digest(candidateMemberDigest, "candidate member digest");
  const prefix = candidateMemberDigest.slice("sha256:".length, "sha256:".length + 2);
  require_(prefixPattern.test(prefix), "candidate prefix");
  return prefix;
}

export interface EconomicsBucket {
  readonly recordKind: EconomicsRecordKind;
  readonly prefix: string;
  readonly members: readonly string[];
  readonly memberSetDigest: string;
  readonly memberCount: number;
}

/** Partition one record kind into its fixed buckets, in canonical order. */
export function economicsBuckets(recordKind: EconomicsRecordKind, memberDigests: readonly string[]): readonly EconomicsBucket[] {
  const byPrefix = new Map<string, string[]>();
  for (const member of memberDigests) {
    const prefix = candidatePrefix(member);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), member]);
  }
  return Object.freeze([...byPrefix.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([prefix, members]) => {
      const sorted = Object.freeze([...members].sort());
      return Object.freeze({
        recordKind, prefix, members: sorted,
        memberSetDigest: canonicalDigest({ kind: "economics-bucket", recordKind, prefix, members: sorted }),
        memberCount: sorted.length,
      });
    }));
}

export interface EconomicsListCursorContext {
  readonly projectionDigest: string;
  readonly recordKind: EconomicsRecordKind;
  readonly aggregateRootDigest: string;
  readonly providerFilter: string | null;
  readonly modelFilter: string | null;
  readonly lastCandidateMemberDigest: string;
}

/**
 * A page cursor commits its whole context. Any movement in the projection, the
 * selected aggregate root, the record kind or the filters must refuse the
 * cursor rather than silently paginate across two different denominators.
 */
export function economicsListCursor(context: EconomicsListCursorContext): string {
  digest(context.projectionDigest, "projection digest");
  digest(context.aggregateRootDigest, "aggregate root digest");
  digest(context.lastCandidateMemberDigest, "last candidate member digest");
  return Buffer.from(canonicalDigest({ ...context }).slice("sha256:".length), "hex").toString("base64url");
}

export function economicsListCursorMatches(cursor: string, context: EconomicsListCursorContext): boolean {
  return cursor === economicsListCursor(context);
}
