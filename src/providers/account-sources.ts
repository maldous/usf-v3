import { canonicalDigest } from "../core/canonical.ts";

/**
 * The shared `accountSourceKeyDigest` domain and the strict runtime parsers for
 * the no-contact account-source records.
 *
 * Two boundaries are deliberate and load-bearing.
 *
 * The factual account-source key is **profile-independent**. It hashes only the
 * protocol, the selected mapping identity, the credential mode and name, and
 * the non-secret credential-source identity. One current factual observation is
 * therefore reusable across profiles without a second account call, and routine
 * profile, policy or privacy churn cannot rewrite factual state. Profile, policy
 * and privacy bind separately, in the use/acquisition authorization.
 *
 * Nothing here contacts a provider, reads a credential value, or admits a
 * caller-authored observation as evidence. Parsing proves shape and internal
 * consistency only; a live account fact requires a separately evidenced
 * acquisition that this module does not perform.
 *
 * These parsers are hand-written rather than schema-driven on purpose. This
 * module is a declared member of the provider-receipt
 * ProductionLeafRuntimeClosure, and a JSON schema read synchronously during
 * module evaluation would become a further closure member the graph does not
 * declare.
 */

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const instantPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,191}$/u;
const credentialNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const controlPlanePattern = /^https:\/\/[A-Za-z0-9.-]{1,255}(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{0,1024})?$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const claimPattern = /^[a-z0-9][a-z0-9-]{0,127}$/u;

export type AccountSourceKind = "api-key" | "subscription-host";
export type AccountSourceTransport = "direct-sdk" | "openrouter" | "codex-cli" | "claude-cli";
export type CredentialMode = "repository-env-file" | "host-authenticated";
export type AccountCostDisposition = "zero-paid" | "paid" | "unknown" | "refused";
export type AccountVerificationDisposition = "verified" | "stale" | "mismatch" | "untrusted" | "refused";
export type EntitlementDisposition = "entitled" | "not-entitled" | "not-observed" | "refused";
export type QuotaDisposition = "available" | "exhausted" | "not-observed" | "refused";
export type AttemptDisposition = "deferred" | "circuit-open" | "exhausted";
export type AttemptFailureClass =
  | "transport" | "timeout" | "authentication" | "authorization"
  | "rate-limit" | "response-invalid" | "response-oversize" | "persistence" | "unknown";

const sourceKinds = new Set<AccountSourceKind>(["api-key", "subscription-host"]);
const transports = new Set<AccountSourceTransport>(["direct-sdk", "openrouter", "codex-cli", "claude-cli"]);
const credentialModes = new Set<CredentialMode>(["repository-env-file", "host-authenticated"]);
const costDispositions = new Set<AccountCostDisposition>(["zero-paid", "paid", "unknown", "refused"]);
const verificationDispositions = new Set<AccountVerificationDisposition>(["verified", "stale", "mismatch", "untrusted", "refused"]);
const entitlementDispositions = new Set<EntitlementDisposition>(["entitled", "not-entitled", "not-observed", "refused"]);
const quotaDispositions = new Set<QuotaDisposition>(["available", "exhausted", "not-observed", "refused"]);
const attemptDispositions = new Set<AttemptDisposition>(["deferred", "circuit-open", "exhausted"]);
const failureClasses = new Set<AttemptFailureClass>([
  "transport", "timeout", "authentication", "authorization",
  "rate-limit", "response-invalid", "response-oversize", "persistence", "unknown",
]);

export type AccountSourceCode =
  | "ACCOUNT_SOURCE_RECORD_MALFORMED"
  | "ACCOUNT_SOURCE_KEY_MISMATCH"
  | "ACCOUNT_SOURCE_AUTHORIZATION_EXPIRED"
  | "ACCOUNT_SOURCE_AUTHORIZATION_NOT_YET_VALID"
  | "ACCOUNT_SOURCE_OBSERVATION_EXPIRED"
  | "ACCOUNT_SOURCE_OBSERVATION_NOT_YET_VALID"
  | "ACCOUNT_SOURCE_CREDENTIAL_IDENTITY_MOVED"
  | "ACCOUNT_SOURCE_ATTEMPT_DEFERRED";

export class AccountSourceError extends Error {
  readonly code: AccountSourceCode;
  constructor(code: AccountSourceCode, message: string) {
    super(message);
    this.name = "AccountSourceError";
    this.code = code;
  }
}

function malformed(what: string): never {
  throw new AccountSourceError("ACCOUNT_SOURCE_RECORD_MALFORMED", `The account-source record is malformed: ${what}.`);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) malformed(what);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) malformed(`${what} field set`);
}

function matching(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== "string" || !pattern.test(value)) malformed(what);
  return value;
}

function member<T extends string>(value: unknown, values: ReadonlySet<T>, what: string): T {
  if (typeof value !== "string" || !values.has(value as T)) malformed(what);
  return value as T;
}

function nullable<T>(value: unknown, parse: (inner: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) malformed(what);
  return value as number;
}

function boundedArray<T>(value: unknown, maximum: number, parse: (inner: unknown) => T, what: string): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum) malformed(what);
  return Object.freeze(value.map(parse));
}

function claims(value: unknown): readonly string[] {
  return boundedArray(value, 64, (inner) => matching(inner, claimPattern, "non-claim"), "non-claims");
}

/** The nine profile-independent members of the factual account-source key. */
export interface AccountSourceKey {
  readonly sourceKind: AccountSourceKind;
  readonly transport: AccountSourceTransport;
  readonly provider: string;
  readonly controlPlaneIdentity: string;
  readonly responseMappingDigest: string;
  readonly credentialMode: CredentialMode;
  readonly credentialName: string;
  readonly credentialSourceIdentityDigest: string;
  readonly accountSourceProtocolDigest: string;
}

const accountSourceKeyFields = Object.freeze([
  "sourceKind", "transport", "provider", "controlPlaneIdentity", "responseMappingDigest",
  "credentialMode", "credentialName", "credentialSourceIdentityDigest", "accountSourceProtocolDigest",
] as const);

export function parseAccountSourceKey(value: unknown): AccountSourceKey {
  const source = record(value, "account source key");
  exactKeys(source, accountSourceKeyFields, "account source key");
  const key: AccountSourceKey = Object.freeze({
    sourceKind: member(source.sourceKind, sourceKinds, "source kind"),
    transport: member(source.transport, transports, "transport"),
    provider: matching(source.provider, identifierPattern, "provider"),
    controlPlaneIdentity: matching(source.controlPlaneIdentity, controlPlanePattern, "control plane identity"),
    responseMappingDigest: matching(source.responseMappingDigest, digestPattern, "response mapping digest"),
    credentialMode: member(source.credentialMode, credentialModes, "credential mode"),
    credentialName: matching(source.credentialName, credentialNamePattern, "credential name"),
    credentialSourceIdentityDigest: matching(source.credentialSourceIdentityDigest, digestPattern, "credential source identity digest"),
    accountSourceProtocolDigest: matching(source.accountSourceProtocolDigest, digestPattern, "account source protocol digest"),
  });
  // A subscription host is authenticated by the host, never by a repository
  // credential file, and the reverse for an API key. Admitting the crossed
  // combination would let one source kind borrow the other's evidence.
  if ((key.sourceKind === "subscription-host") !== (key.credentialMode === "host-authenticated")) {
    malformed("source kind and credential mode disagree");
  }
  return key;
}

/**
 * The factual source key digest. Deliberately free of profile, policy, privacy
 * and time, so one observation serves every profile and authorization churn
 * never rewrites a fact.
 */
export function accountSourceKeyDigest(key: AccountSourceKey): `sha256:${string}` {
  return canonicalDigest({ ...key });
}

export interface AccountSourceAuthorizationV2 extends AccountSourceKey {
  readonly schema: "urn:usf:account-source-authorization:2";
  readonly version: 1;
  readonly accountSourceKeyDigest: string;
  readonly profileDigest: string;
  readonly effectivePolicyDigest: string;
  readonly privacyProjectionDigest: string;
  readonly operationalActivationDigest: string;
  readonly authorizationFreshnessPolicyDigest: string;
  readonly maximumResponseBytes: number;
  readonly timeoutMilliseconds: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly inferenceProhibited: true;
  readonly fallbackProhibited: true;
}

const authorizationFields = Object.freeze([
  "schema", "version", "accountSourceKeyDigest", ...accountSourceKeyFields,
  "profileDigest", "effectivePolicyDigest", "privacyProjectionDigest",
  "operationalActivationDigest", "authorizationFreshnessPolicyDigest",
  "maximumResponseBytes", "timeoutMilliseconds", "issuedAt", "expiresAt",
  "inferenceProhibited", "fallbackProhibited",
] as const);

export function parseAccountSourceAuthorizationV2(value: unknown): AccountSourceAuthorizationV2 {
  const source = record(value, "account source authorization");
  exactKeys(source, authorizationFields, "account source authorization");
  if (source.schema !== "urn:usf:account-source-authorization:2" || source.version !== 1) malformed("authorization identity");
  if (source.inferenceProhibited !== true || source.fallbackProhibited !== true) malformed("authorization prohibitions");
  const key = parseAccountSourceKey(Object.fromEntries(accountSourceKeyFields.map((field) => [field, source[field]])));
  const declared = matching(source.accountSourceKeyDigest, digestPattern, "account source key digest");
  // The caller does not get to name the key: it is reconstructed from the
  // authorization's own members and compared.
  if (declared !== accountSourceKeyDigest(key)) {
    throw new AccountSourceError("ACCOUNT_SOURCE_KEY_MISMATCH", "The declared account-source key digest does not match its own members.");
  }
  const issuedAt = matching(source.issuedAt, instantPattern, "issuedAt");
  const expiresAt = matching(source.expiresAt, instantPattern, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) malformed("authorization validity window");
  return Object.freeze({
    schema: "urn:usf:account-source-authorization:2" as const,
    version: 1 as const,
    accountSourceKeyDigest: declared,
    ...key,
    profileDigest: matching(source.profileDigest, digestPattern, "profile digest"),
    effectivePolicyDigest: matching(source.effectivePolicyDigest, digestPattern, "effective policy digest"),
    privacyProjectionDigest: matching(source.privacyProjectionDigest, digestPattern, "privacy projection digest"),
    operationalActivationDigest: matching(source.operationalActivationDigest, digestPattern, "operational activation digest"),
    authorizationFreshnessPolicyDigest: matching(source.authorizationFreshnessPolicyDigest, digestPattern, "authorization freshness policy digest"),
    maximumResponseBytes: boundedInteger(source.maximumResponseBytes, 1, 1_048_576, "maximum response bytes"),
    timeoutMilliseconds: boundedInteger(source.timeoutMilliseconds, 1, 60_000, "timeout milliseconds"),
    issuedAt,
    expiresAt,
    inferenceProhibited: true as const,
    fallbackProhibited: true as const,
  });
}

export function accountSourceAuthorizationV2Digest(value: AccountSourceAuthorizationV2): `sha256:${string}` {
  return canonicalDigest({ ...value });
}

export interface AccountQuota {
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetAt: string | null;
  readonly availability: QuotaDisposition;
}

export interface AccountUsage {
  readonly amount: string | null;
  readonly currency: string | null;
  readonly periodStartedAt: string | null;
  readonly periodEndsAt: string | null;
}

export interface AccountSpendCap {
  readonly amount: string | null;
  readonly currency: string | null;
  readonly enforced: boolean;
}

function parseQuota(value: unknown): AccountQuota {
  const source = record(value, "quota");
  exactKeys(source, ["limit", "remaining", "resetAt", "availability"], "quota");
  return Object.freeze({
    limit: nullable(source.limit, (inner) => boundedInteger(inner, 0, 1_000_000_000, "quota limit")),
    remaining: nullable(source.remaining, (inner) => boundedInteger(inner, 0, 1_000_000_000, "quota remaining")),
    resetAt: nullable(source.resetAt, (inner) => matching(inner, instantPattern, "quota resetAt")),
    availability: member(source.availability, quotaDispositions, "quota availability"),
  });
}

function parseUsage(value: unknown): AccountUsage {
  const source = record(value, "usage");
  exactKeys(source, ["amount", "currency", "periodStartedAt", "periodEndsAt"], "usage");
  return Object.freeze({
    amount: nullable(source.amount, (inner) => matching(inner, decimalPattern, "usage amount")),
    currency: nullable(source.currency, (inner) => matching(inner, identifierPattern, "usage currency")),
    periodStartedAt: nullable(source.periodStartedAt, (inner) => matching(inner, instantPattern, "usage period start")),
    periodEndsAt: nullable(source.periodEndsAt, (inner) => matching(inner, instantPattern, "usage period end")),
  });
}

function parseSpendCap(value: unknown): AccountSpendCap {
  const source = record(value, "spend cap");
  exactKeys(source, ["amount", "currency", "enforced"], "spend cap");
  if (typeof source.enforced !== "boolean") malformed("spend cap enforcement");
  return Object.freeze({
    amount: nullable(source.amount, (inner) => matching(inner, decimalPattern, "spend cap amount")),
    currency: nullable(source.currency, (inner) => matching(inner, identifierPattern, "spend cap currency")),
    enforced: source.enforced,
  });
}

export interface AccountObservation {
  readonly schema: "urn:usf:account-observation:1";
  readonly version: 1;
  readonly accountSourceKeyDigest: string;
  readonly acquisitionAuthorizationDigest: string;
  readonly credentialSourceIdentityDigest: string;
  readonly accountSourceProtocolDigest: string;
  readonly responseMappingDigest: string;
  readonly observationFreshnessPolicyDigest: string;
  readonly rawProviderResponseDigest: string;
  readonly authenticatedAccountIdentityDigest: string;
  readonly transport: AccountSourceTransport;
  readonly provider: string;
  readonly controlPlaneIdentity: string;
  readonly acquiredAt: string;
  readonly providerCredentialExpiresAt: string | null;
  readonly expiresAt: string;
  readonly serviceTier: string | null;
  readonly entitlementDisposition: EntitlementDisposition;
  readonly paidUsageEnabled: boolean | null;
  readonly automaticOverageEnabled: boolean | null;
  readonly automaticTopUpEnabled: boolean | null;
  readonly spendCap: AccountSpendCap | null;
  readonly quota: AccountQuota;
  readonly usage: AccountUsage;
  readonly costDisposition: AccountCostDisposition;
  readonly verificationDisposition: AccountVerificationDisposition;
  readonly nonClaims: readonly string[];
}

const observationFields = Object.freeze([
  "schema", "version", "accountSourceKeyDigest", "acquisitionAuthorizationDigest",
  "credentialSourceIdentityDigest", "accountSourceProtocolDigest", "responseMappingDigest",
  "observationFreshnessPolicyDigest", "rawProviderResponseDigest", "authenticatedAccountIdentityDigest",
  "transport", "provider", "controlPlaneIdentity", "acquiredAt", "providerCredentialExpiresAt",
  "expiresAt", "serviceTier", "entitlementDisposition", "paidUsageEnabled", "automaticOverageEnabled",
  "automaticTopUpEnabled", "spendCap", "quota", "usage", "costDisposition", "verificationDisposition", "nonClaims",
] as const);

export function parseAccountObservation(value: unknown): AccountObservation {
  const source = record(value, "account observation");
  exactKeys(source, observationFields, "account observation");
  if (source.schema !== "urn:usf:account-observation:1" || source.version !== 1) malformed("observation identity");
  const acquiredAt = matching(source.acquiredAt, instantPattern, "acquiredAt");
  const expiresAt = matching(source.expiresAt, instantPattern, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(acquiredAt)) malformed("observation validity window");
  const providerCredentialExpiresAt = nullable(source.providerCredentialExpiresAt, (inner) => matching(inner, instantPattern, "provider credential expiry"));
  // Provider-owned credential expiry caps observation expiry; an observation
  // may never outlive the credential that produced it.
  if (providerCredentialExpiresAt !== null && Date.parse(expiresAt) > Date.parse(providerCredentialExpiresAt)) {
    malformed("observation expiry exceeds provider credential expiry");
  }
  return Object.freeze({
    schema: "urn:usf:account-observation:1" as const,
    version: 1 as const,
    accountSourceKeyDigest: matching(source.accountSourceKeyDigest, digestPattern, "account source key digest"),
    acquisitionAuthorizationDigest: matching(source.acquisitionAuthorizationDigest, digestPattern, "acquisition authorization digest"),
    credentialSourceIdentityDigest: matching(source.credentialSourceIdentityDigest, digestPattern, "credential source identity digest"),
    accountSourceProtocolDigest: matching(source.accountSourceProtocolDigest, digestPattern, "account source protocol digest"),
    responseMappingDigest: matching(source.responseMappingDigest, digestPattern, "response mapping digest"),
    observationFreshnessPolicyDigest: matching(source.observationFreshnessPolicyDigest, digestPattern, "observation freshness policy digest"),
    rawProviderResponseDigest: matching(source.rawProviderResponseDigest, digestPattern, "raw provider response digest"),
    authenticatedAccountIdentityDigest: matching(source.authenticatedAccountIdentityDigest, digestPattern, "authenticated account identity digest"),
    transport: member(source.transport, transports, "transport"),
    provider: matching(source.provider, identifierPattern, "provider"),
    controlPlaneIdentity: matching(source.controlPlaneIdentity, controlPlanePattern, "control plane identity"),
    acquiredAt,
    providerCredentialExpiresAt,
    expiresAt,
    serviceTier: nullable(source.serviceTier, (inner) => matching(inner, identifierPattern, "service tier")),
    entitlementDisposition: member(source.entitlementDisposition, entitlementDispositions, "entitlement disposition"),
    paidUsageEnabled: nullable(source.paidUsageEnabled, (inner) => { if (typeof inner !== "boolean") malformed("paid usage"); return inner; }),
    automaticOverageEnabled: nullable(source.automaticOverageEnabled, (inner) => { if (typeof inner !== "boolean") malformed("automatic overage"); return inner; }),
    automaticTopUpEnabled: nullable(source.automaticTopUpEnabled, (inner) => { if (typeof inner !== "boolean") malformed("automatic top-up"); return inner; }),
    spendCap: nullable(source.spendCap, parseSpendCap),
    quota: parseQuota(source.quota),
    usage: parseUsage(source.usage),
    costDisposition: member(source.costDisposition, costDispositions, "cost disposition"),
    verificationDisposition: member(source.verificationDisposition, verificationDispositions, "verification disposition"),
    nonClaims: claims(source.nonClaims),
  });
}

export function accountObservationDigest(value: AccountObservation): `sha256:${string}` {
  return canonicalDigest({ ...value });
}

export interface AccountSourceAttempt {
  readonly schema: "urn:usf:account-source-attempt:1";
  readonly version: 1;
  readonly accountSourceKeyDigest: string;
  readonly acquisitionAuthorizationDigest: string;
  readonly credentialSourceIdentityDigest: string;
  readonly accountSourceProtocolDigest: string;
  readonly responseMappingDigest: string;
  readonly retryPolicyDigest: string;
  readonly previousAttemptDigests: readonly string[];
  readonly attemptedAt: string;
  readonly windowStartedAt: string;
  readonly windowExpiresAt: string;
  readonly retryAfter: string;
  readonly delayMilliseconds: number;
  readonly failureClass: AttemptFailureClass;
  readonly failureDigest: string;
  readonly attemptOrdinal: number;
  readonly attemptWindowDigest: string;
  readonly maximumAttemptsInWindow: number;
  readonly disposition: AttemptDisposition;
  readonly nonClaims: readonly string[];
}

const attemptFields = Object.freeze([
  "schema", "version", "accountSourceKeyDigest", "acquisitionAuthorizationDigest",
  "credentialSourceIdentityDigest", "accountSourceProtocolDigest", "responseMappingDigest",
  "retryPolicyDigest", "previousAttemptDigests", "attemptedAt", "windowStartedAt", "windowExpiresAt",
  "retryAfter", "delayMilliseconds", "failureClass", "failureDigest", "attemptOrdinal",
  "attemptWindowDigest", "maximumAttemptsInWindow", "disposition", "nonClaims",
] as const);

export function parseAccountSourceAttempt(value: unknown): AccountSourceAttempt {
  const source = record(value, "account source attempt");
  exactKeys(source, attemptFields, "account source attempt");
  if (source.schema !== "urn:usf:account-source-attempt:1" || source.version !== 1) malformed("attempt identity");
  const attemptedAt = matching(source.attemptedAt, instantPattern, "attemptedAt");
  const windowStartedAt = matching(source.windowStartedAt, instantPattern, "windowStartedAt");
  const windowExpiresAt = matching(source.windowExpiresAt, instantPattern, "windowExpiresAt");
  const retryAfter = matching(source.retryAfter, instantPattern, "retryAfter");
  if (Date.parse(windowExpiresAt) <= Date.parse(windowStartedAt)) malformed("attempt window");
  if (Date.parse(attemptedAt) < Date.parse(windowStartedAt) || Date.parse(attemptedAt) > Date.parse(windowExpiresAt)) malformed("attempt outside its window");
  if (Date.parse(retryAfter) < Date.parse(attemptedAt)) malformed("retryAfter precedes its attempt");
  const attemptOrdinal = boundedInteger(source.attemptOrdinal, 1, 1024, "attempt ordinal");
  const maximumAttemptsInWindow = boundedInteger(source.maximumAttemptsInWindow, 1, 1024, "maximum attempts in window");
  if (attemptOrdinal > maximumAttemptsInWindow) malformed("attempt ordinal exceeds its window ceiling");
  const previousAttemptDigests = boundedArray(source.previousAttemptDigests, 32, (inner) => matching(inner, digestPattern, "previous attempt digest"), "previous attempt digests");
  if (new Set(previousAttemptDigests).size !== previousAttemptDigests.length) malformed("duplicate previous attempt digests");
  const disposition = member(source.disposition, attemptDispositions, "attempt disposition");
  // The ceiling and the disposition must agree: an attempt at the ceiling has
  // exhausted its window and cannot also be an ordinary deferral.
  if ((attemptOrdinal === maximumAttemptsInWindow) !== (disposition !== "deferred")) malformed("attempt disposition disagrees with its ordinal");
  return Object.freeze({
    schema: "urn:usf:account-source-attempt:1" as const,
    version: 1 as const,
    accountSourceKeyDigest: matching(source.accountSourceKeyDigest, digestPattern, "account source key digest"),
    acquisitionAuthorizationDigest: matching(source.acquisitionAuthorizationDigest, digestPattern, "acquisition authorization digest"),
    credentialSourceIdentityDigest: matching(source.credentialSourceIdentityDigest, digestPattern, "credential source identity digest"),
    accountSourceProtocolDigest: matching(source.accountSourceProtocolDigest, digestPattern, "account source protocol digest"),
    responseMappingDigest: matching(source.responseMappingDigest, digestPattern, "response mapping digest"),
    retryPolicyDigest: matching(source.retryPolicyDigest, digestPattern, "retry policy digest"),
    previousAttemptDigests,
    attemptedAt, windowStartedAt, windowExpiresAt, retryAfter,
    delayMilliseconds: boundedInteger(source.delayMilliseconds, 0, 86_400_000, "delay milliseconds"),
    failureClass: member(source.failureClass, failureClasses, "failure class"),
    failureDigest: matching(source.failureDigest, digestPattern, "failure digest"),
    attemptOrdinal, attemptWindowDigest: matching(source.attemptWindowDigest, digestPattern, "attempt window digest"),
    maximumAttemptsInWindow, disposition,
    nonClaims: claims(source.nonClaims),
  });
}

export function accountSourceAttemptDigest(value: AccountSourceAttempt): `sha256:${string}` {
  return canonicalDigest({ ...value });
}

export type AuthorizationUseDisposition = "current" | "expired" | "not-yet-valid" | "credential-identity-moved";

/**
 * Decide whether one stored authorization may still be used at an explicit
 * instant against an explicit current credential-source identity.
 *
 * The instant is a parameter, never a wall-clock read: the caller owns the
 * mode-defined instant so that a projection and the contact it authorizes
 * cannot disagree. Credential rotation moves the identity digest and
 * immediately makes stale economics authority unusable.
 */
export function authorizationUseDisposition(
  authorization: AccountSourceAuthorizationV2,
  atInstant: string,
  currentCredentialSourceIdentityDigest: string,
): AuthorizationUseDisposition {
  matching(atInstant, instantPattern, "evaluation instant");
  matching(currentCredentialSourceIdentityDigest, digestPattern, "current credential source identity digest");
  if (authorization.credentialSourceIdentityDigest !== currentCredentialSourceIdentityDigest) return "credential-identity-moved";
  const instant = Date.parse(atInstant);
  if (instant < Date.parse(authorization.issuedAt)) return "not-yet-valid";
  if (instant >= Date.parse(authorization.expiresAt)) return "expired";
  return "current";
}

export type ObservationUseDisposition = "current" | "expired" | "not-yet-valid";

/** The same explicit-instant rule for a factual observation. */
export function observationUseDisposition(observation: AccountObservation, atInstant: string): ObservationUseDisposition {
  matching(atInstant, instantPattern, "evaluation instant");
  const instant = Date.parse(atInstant);
  if (instant < Date.parse(observation.acquiredAt)) return "not-yet-valid";
  if (instant >= Date.parse(observation.expiresAt)) return "expired";
  return "current";
}

/**
 * A persisted failed attempt defers only its own source key until retryAfter.
 * Unrelated source keys stay eligible, so one failing provider cannot stall
 * unattended operation across every other source.
 */
export function attemptDefersSource(attempt: AccountSourceAttempt, atInstant: string): boolean {
  matching(atInstant, instantPattern, "evaluation instant");
  if (attempt.disposition !== "deferred") return true;
  return Date.parse(atInstant) < Date.parse(attempt.retryAfter);
}
