import { canonicalDigest, sha256 } from "../core/canonical.ts";

/**
 * Pure, credential-free zero-paid economics qualification.
 *
 * This is the deliberately small V3 port of the V2 Factory gate. Provider
 * configuration and catalogue labels are discovery hints only; qualification
 * requires three independent, current facts and performs no network or state
 * access.
 */

export type EconomicsClass =
  | "FREE_RECURRING"
  | "FREE_DAILY_RESET"
  | "FREE_MONTHLY_RESET"
  | "FREE_RATE_LIMITED"
  | "FREE_TRIAL_ONE_TIME"
  | "FREE_CREDIT_RECURRING"
  | "FREE_CREDIT_ONE_TIME"
  | "PAID_ONLY"
  | "PAYMENT_METHOD_REQUIRED"
  | "UNKNOWN";

export type BillingBasis =
  | "ZERO_PRICED"
  | "NO_CHARGE_WITHIN_QUOTA"
  | "TRIAL_CREDIT"
  | "METERED_PAID"
  | "UNPRICED"
  | "UNKNOWN";

export type QuotaAvailability = "available" | "exhausted" | "unknown";

export interface EconomicsSource {
  readonly kind: "official-terms" | "official-model-documentation" | "authenticated-account-observation";
  readonly publisher: string;
  readonly pageTitle: string;
  readonly sourceUrl: string;
  readonly sourceDigest: string;
  readonly checkedAt: string;
  readonly expiresAt: string;
}

export interface EconomicsQuota {
  readonly requestsPerMinute: number | null;
  readonly requestsPerDay: number | null;
  readonly tokensPerMinute: number | null;
  readonly tokensPerDay: number | null;
  readonly remainingRequests: number | null;
  readonly remainingTokens: number | null;
  readonly resetAt: string | null;
  readonly resetCadence: string | null;
  readonly availability: QuotaAvailability;
}

export interface ProviderTermsEvidence {
  readonly providerId: string;
  readonly economicsClass: EconomicsClass;
  readonly modelSpecific: boolean;
  readonly paymentMethodRequired: boolean | null;
  readonly automaticOverageDefault: boolean | null;
  readonly source: EconomicsSource;
}

export interface ModelEconomicsEvidence {
  readonly providerId: string;
  readonly requestedModelId: string;
  readonly economicsClass: EconomicsClass;
  readonly billingBasis: BillingBasis;
  readonly officiallyListedFree: boolean;
  /** Canonical non-negative decimal strings; null means not stated. */
  readonly promptPriceUsdPerMtok: string | null;
  readonly outputPriceUsdPerMtok: string | null;
  readonly requestPriceUsd: string | null;
  readonly quota: EconomicsQuota;
  readonly source: EconomicsSource;
}

export interface AccountTierEvidence {
  readonly providerId: string;
  readonly accountReferenceDigest: string;
  readonly tierName: string;
  readonly economicsClass: EconomicsClass;
  readonly eligibleModelIds: readonly string[];
  readonly paidUsageEnabled: boolean | null;
  readonly automaticOverage: boolean | null;
  readonly hardSpendCap: boolean | null;
  readonly quota: EconomicsQuota;
  readonly remainingTrialCreditUsd: string | null;
  readonly trialExpiresAt: string | null;
  readonly source: EconomicsSource;
}

export interface ZeroPaidEconomicsEvidence {
  readonly terms: ProviderTermsEvidence;
  readonly model: ModelEconomicsEvidence;
  readonly account: AccountTierEvidence;
}

export interface ZeroPaidEconomicsInput {
  readonly providerId: string;
  readonly requestedModelId: string;
  /** Digest of the exact account identity selected by the caller. */
  readonly accountReferenceDigest: string;
  readonly evidence: unknown;
  readonly observedAt: string;
  readonly maximumPaidCostUsd?: number | string;
}

export type ZeroPaidEconomicsCode =
  | "ZERO_PAID_EVIDENCE_CURRENT"
  | "ZERO_PAID_PROVIDER_UNSUPPORTED"
  | "ZERO_PAID_EVIDENCE_REQUIRED"
  | "ZERO_PAID_EVIDENCE_INVALID"
  | "ZERO_PAID_NON_ZERO_BUDGET"
  | "ZERO_PAID_PROVIDER_MISMATCH"
  | "ZERO_PAID_MODEL_MISMATCH"
  | "ZERO_PAID_ACCOUNT_MISMATCH"
  | "ZERO_PAID_SOURCE_NOT_OFFICIAL"
  | "ZERO_PAID_SOURCE_DIGEST_INVALID"
  | "ZERO_PAID_EVIDENCE_TIME_INVALID"
  | "ZERO_PAID_EVIDENCE_STALE"
  | "ZERO_PAID_EVIDENCE_NOT_INDEPENDENT"
  | "ZERO_PAID_ECONOMIC_CLASS_NOT_FREE"
  | "ZERO_PAID_PROMOTIONAL_OR_TRIAL_INELIGIBLE"
  | "ZERO_PAID_MODEL_FREE_STATUS_UNPROVEN"
  | "ZERO_PAID_MODEL_PRICE_NOT_ZERO"
  | "ZERO_PAID_ACCOUNT_MODEL_ACCESS_UNPROVEN"
  | "ZERO_PAID_PAYMENT_METHOD_REQUIRED"
  | "ZERO_PAID_PAID_USAGE_ENABLED"
  | "ZERO_PAID_AUTOMATIC_OVERAGE"
  | "ZERO_PAID_HARD_CAP_UNPROVEN"
  | "ZERO_PAID_QUOTA_UNBOUNDED"
  | "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN"
  | "ZERO_PAID_QUOTA_EXHAUSTED";

export interface ZeroPaidEconomicsDecision {
  readonly allowed: boolean;
  readonly code: ZeroPaidEconomicsCode;
  readonly providerId: string;
  readonly requestedModelId: string;
  readonly accountReferenceDigest: string;
  readonly evidenceDigest: string | null;
  readonly quota: EconomicsQuota | null;
  readonly validUntil: string | null;
}

type EconomicsEvidencePiece = ProviderTermsEvidence | ModelEconomicsEvidence | AccountTierEvidence;

interface ProviderEconomicsRule {
  readonly providerId: string;
  readonly publisher: string;
  readonly officialHosts: readonly string[];
  readonly documentedClasses: readonly EconomicsClass[];
  readonly eligibleRecurringClasses: readonly EconomicsClass[];
  readonly recurrence: "recurring-quota" | "one-time-trial";
}

/**
 * Provider source/class routing metadata. These rules only constrain evidence;
 * they are not evidence and cannot qualify a provider, model, or account.
 */
export const providerEconomicsRules: Readonly<Record<string, ProviderEconomicsRule>> = Object.freeze({
  groq: Object.freeze({
    providerId: "groq",
    publisher: "Groq",
    officialHosts: Object.freeze(["api.groq.com", "console.groq.com"]),
    documentedClasses: Object.freeze(["FREE_RATE_LIMITED"] as const),
    eligibleRecurringClasses: Object.freeze(["FREE_RATE_LIMITED"] as const),
    recurrence: "recurring-quota",
  }),
  cerebras: Object.freeze({
    providerId: "cerebras",
    publisher: "Cerebras Systems",
    officialHosts: Object.freeze([
      "api.cerebras.ai",
      "cerebras.ai",
      "cloud.cerebras.ai",
      "inference-docs.cerebras.ai",
      "www.cerebras.ai",
    ]),
    documentedClasses: Object.freeze(["FREE_RATE_LIMITED"] as const),
    eligibleRecurringClasses: Object.freeze(["FREE_RATE_LIMITED"] as const),
    recurrence: "recurring-quota",
  }),
});

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const zonedTimestampPattern = /T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const termsMaximumTtlMs = 7 * 24 * 60 * 60 * 1_000;
const modelMaximumTtlMs = 24 * 60 * 60 * 1_000;
const accountMaximumTtlMs = 60 * 60 * 1_000;
const recurringClasses = new Set<EconomicsClass>([
  "FREE_RECURRING",
  "FREE_DAILY_RESET",
  "FREE_MONTHLY_RESET",
  "FREE_RATE_LIMITED",
]);
const promotionalOrTrialClasses = new Set<EconomicsClass>([
  "FREE_TRIAL_ONE_TIME",
  "FREE_CREDIT_RECURRING",
  "FREE_CREDIT_ONE_TIME",
]);

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid record");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("unsupported schema");
  }
}

function nonEmptyString(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new Error("invalid string");
  }
  return value;
}

function nullableBoolean(value: unknown): boolean | null {
  if (value !== null && typeof value !== "boolean") throw new Error("invalid boolean");
  return value;
}

function member<T extends string>(value: unknown, values: ReadonlySet<T>): T {
  if (typeof value !== "string" || !values.has(value as T)) throw new Error("invalid enum");
  return value as T;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !zonedTimestampPattern.test(value)) throw new Error("invalid timestamp");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("invalid timestamp");
  return new Date(milliseconds).toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function decimal(value: unknown): string {
  if (typeof value !== "string" || !decimalPattern.test(value)) throw new Error("invalid decimal");
  const [integer, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction.length === 0 ? integer : `${integer}.${normalizedFraction}`;
}

function nullableDecimal(value: unknown): string | null {
  return value === null ? null : decimal(value);
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("invalid quota");
  return value as number;
}

function parseSource(value: unknown): EconomicsSource {
  const source = record(value);
  exactKeys(source, ["kind", "publisher", "pageTitle", "sourceUrl", "sourceDigest", "checkedAt", "expiresAt"]);
  const sourceDigest = nonEmptyString(source.sourceDigest, 128);
  return Object.freeze({
    kind: member(source.kind, new Set<EconomicsSource["kind"]>(["official-terms", "official-model-documentation", "authenticated-account-observation"])),
    publisher: nonEmptyString(source.publisher, 128),
    pageTitle: nonEmptyString(source.pageTitle, 512),
    sourceUrl: nonEmptyString(source.sourceUrl, 2_048),
    sourceDigest,
    checkedAt: timestamp(source.checkedAt),
    expiresAt: timestamp(source.expiresAt),
  });
}

function parseQuota(value: unknown): EconomicsQuota {
  const quota = record(value);
  exactKeys(quota, [
    "requestsPerMinute", "requestsPerDay", "tokensPerMinute", "tokensPerDay",
    "remainingRequests", "remainingTokens", "resetAt", "resetCadence", "availability",
  ]);
  const resetCadence = quota.resetCadence === null ? null : nonEmptyString(quota.resetCadence, 128);
  return Object.freeze({
    requestsPerMinute: nonNegativeIntegerOrNull(quota.requestsPerMinute),
    requestsPerDay: nonNegativeIntegerOrNull(quota.requestsPerDay),
    tokensPerMinute: nonNegativeIntegerOrNull(quota.tokensPerMinute),
    tokensPerDay: nonNegativeIntegerOrNull(quota.tokensPerDay),
    remainingRequests: nonNegativeIntegerOrNull(quota.remainingRequests),
    remainingTokens: nonNegativeIntegerOrNull(quota.remainingTokens),
    resetAt: nullableTimestamp(quota.resetAt),
    resetCadence,
    availability: member(quota.availability, new Set<QuotaAvailability>(["available", "exhausted", "unknown"])),
  });
}

const economicsClasses = new Set<EconomicsClass>([
  "FREE_RECURRING", "FREE_DAILY_RESET", "FREE_MONTHLY_RESET", "FREE_RATE_LIMITED",
  "FREE_TRIAL_ONE_TIME", "FREE_CREDIT_RECURRING", "FREE_CREDIT_ONE_TIME", "PAID_ONLY",
  "PAYMENT_METHOD_REQUIRED", "UNKNOWN",
]);
const billingBases = new Set<BillingBasis>([
  "ZERO_PRICED", "NO_CHARGE_WITHIN_QUOTA", "TRIAL_CREDIT", "METERED_PAID", "UNPRICED", "UNKNOWN",
]);

/** Parse, close, normalize and deeply freeze credential-free evidence. */
export function parseZeroPaidEconomicsEvidence(value: unknown): ZeroPaidEconomicsEvidence {
  const evidence = record(value);
  exactKeys(evidence, ["terms", "model", "account"]);
  const terms = record(evidence.terms);
  exactKeys(terms, ["providerId", "economicsClass", "modelSpecific", "paymentMethodRequired", "automaticOverageDefault", "source"]);
  if (typeof terms.modelSpecific !== "boolean") throw new Error("invalid terms evidence");

  const model = record(evidence.model);
  exactKeys(model, [
    "providerId", "requestedModelId", "economicsClass", "billingBasis", "officiallyListedFree",
    "promptPriceUsdPerMtok", "outputPriceUsdPerMtok", "requestPriceUsd", "quota", "source",
  ]);
  if (typeof model.officiallyListedFree !== "boolean") throw new Error("invalid model evidence");

  const account = record(evidence.account);
  exactKeys(account, [
    "providerId", "accountReferenceDigest", "tierName", "economicsClass", "eligibleModelIds",
    "paidUsageEnabled", "automaticOverage", "hardSpendCap", "quota", "remainingTrialCreditUsd",
    "trialExpiresAt", "source",
  ]);
  const accountReferenceDigest = nonEmptyString(account.accountReferenceDigest, 71);
  if (!digestPattern.test(accountReferenceDigest)) throw new Error("invalid account digest");
  if (!Array.isArray(account.eligibleModelIds) || account.eligibleModelIds.length === 0 || account.eligibleModelIds.length > 512) {
    throw new Error("invalid eligible models");
  }
  const eligibleModelIds = account.eligibleModelIds.map((item) => nonEmptyString(item, 512)).sort();
  if (new Set(eligibleModelIds).size !== eligibleModelIds.length) throw new Error("duplicate eligible model");

  return Object.freeze({
    terms: Object.freeze({
      providerId: nonEmptyString(terms.providerId, 128),
      economicsClass: member(terms.economicsClass, economicsClasses),
      modelSpecific: terms.modelSpecific,
      paymentMethodRequired: nullableBoolean(terms.paymentMethodRequired),
      automaticOverageDefault: nullableBoolean(terms.automaticOverageDefault),
      source: parseSource(terms.source),
    }),
    model: Object.freeze({
      providerId: nonEmptyString(model.providerId, 128),
      requestedModelId: nonEmptyString(model.requestedModelId, 512),
      economicsClass: member(model.economicsClass, economicsClasses),
      billingBasis: member(model.billingBasis, billingBases),
      officiallyListedFree: model.officiallyListedFree,
      promptPriceUsdPerMtok: nullableDecimal(model.promptPriceUsdPerMtok),
      outputPriceUsdPerMtok: nullableDecimal(model.outputPriceUsdPerMtok),
      requestPriceUsd: nullableDecimal(model.requestPriceUsd),
      quota: parseQuota(model.quota),
      source: parseSource(model.source),
    }),
    account: Object.freeze({
      providerId: nonEmptyString(account.providerId, 128),
      accountReferenceDigest,
      tierName: nonEmptyString(account.tierName, 256),
      economicsClass: member(account.economicsClass, economicsClasses),
      eligibleModelIds: Object.freeze(eligibleModelIds),
      paidUsageEnabled: nullableBoolean(account.paidUsageEnabled),
      automaticOverage: nullableBoolean(account.automaticOverage),
      hardSpendCap: nullableBoolean(account.hardSpendCap),
      quota: parseQuota(account.quota),
      remainingTrialCreditUsd: nullableDecimal(account.remainingTrialCreditUsd),
      trialExpiresAt: nullableTimestamp(account.trialExpiresAt),
      source: parseSource(account.source),
    }),
  });
}

/** Canonical, credential-free identity for the immutable three-fact record. */
export function zeroPaidEconomicsEvidenceDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseZeroPaidEconomicsEvidence(value), { rejectAbsolutePaths: true });
}

/**
 * Bind one normalized evidence fact-set to its capture metadata without
 * treating the digest as a provider signature or proof of authenticity.
 */
export function zeroPaidEconomicsPieceDigest(value: EconomicsEvidencePiece): `sha256:${string}` {
  const { source, ...facts } = value;
  const { sourceDigest: _ignored, ...capture } = source;
  return canonicalDigest({ capture, facts }, { rejectAbsolutePaths: true });
}

function deny(input: ZeroPaidEconomicsInput, code: ZeroPaidEconomicsCode): ZeroPaidEconomicsDecision {
  return Object.freeze({
    allowed: false,
    code,
    providerId: input.providerId,
    requestedModelId: input.requestedModelId,
    accountReferenceDigest: input.accountReferenceDigest,
    evidenceDigest: null,
    quota: null,
    validUntil: null,
  });
}

function validateSource(
  source: EconomicsSource,
  rule: ProviderEconomicsRule,
  observedAtMs: number,
  maximumTtlMs: number,
): ZeroPaidEconomicsCode | null {
  if (source.publisher !== rule.publisher) return "ZERO_PAID_SOURCE_NOT_OFFICIAL";
  let url: URL;
  try {
    url = new URL(source.sourceUrl);
  } catch {
    return "ZERO_PAID_SOURCE_NOT_OFFICIAL";
  }
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.port !== "" || !rule.officialHosts.includes(url.hostname.toLowerCase())
  ) return "ZERO_PAID_SOURCE_NOT_OFFICIAL";
  if (!digestPattern.test(source.sourceDigest)) return "ZERO_PAID_SOURCE_DIGEST_INVALID";
  const checkedAtMs = Date.parse(source.checkedAt);
  const expiresAtMs = Date.parse(source.expiresAt);
  if (
    !source.pageTitle.trim() || checkedAtMs > expiresAtMs || checkedAtMs > observedAtMs ||
    expiresAtMs - checkedAtMs > maximumTtlMs
  ) return "ZERO_PAID_EVIDENCE_TIME_INVALID";
  if (expiresAtMs <= observedAtMs) return "ZERO_PAID_EVIDENCE_STALE";
  return null;
}

function validateAccountSource(source: EconomicsSource, providerId: string): ZeroPaidEconomicsCode | null {
  if (source.kind !== "authenticated-account-observation") return "ZERO_PAID_SOURCE_NOT_OFFICIAL";
  const host = providerId === "groq" ? "console.groq.com" : "cloud.cerebras.ai";
  try {
    const url = new URL(source.sourceUrl);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== host || !url.pathname.includes("account")) return "ZERO_PAID_SOURCE_NOT_OFFICIAL";
  } catch { return "ZERO_PAID_SOURCE_NOT_OFFICIAL"; }
  return null;
}

function quotaDecision(quota: EconomicsQuota): ZeroPaidEconomicsCode | null {
  if (quota.availability === "unknown") return "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN";
  if (quota.availability === "exhausted") return "ZERO_PAID_QUOTA_EXHAUSTED";
  if (quota.remainingRequests === null || quota.remainingTokens === null) {
    return "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN";
  }
  if (quota.remainingRequests === 0 || quota.remainingTokens === 0) {
    return "ZERO_PAID_QUOTA_EXHAUSTED";
  }
  const requestBounded = [quota.requestsPerMinute, quota.requestsPerDay].some((value) => value !== null && value > 0);
  const tokenBounded = [quota.tokensPerMinute, quota.tokensPerDay].some((value) => value !== null && value > 0);
  if (!requestBounded || !tokenBounded) return "ZERO_PAID_QUOTA_UNBOUNDED";
  return null;
}

function maximumCostIsZero(value: number | string | undefined): boolean {
  if (value === undefined || value === 0) return true;
  if (typeof value !== "string") return false;
  try {
    return decimal(value) === "0";
  } catch {
    return false;
  }
}

/** Evaluate one exact provider/model/account tuple. Unknown facts fail closed. */
export function evaluateZeroPaidEconomics(input: ZeroPaidEconomicsInput): ZeroPaidEconomicsDecision {
  const rule = Object.hasOwn(providerEconomicsRules, input.providerId)
    ? providerEconomicsRules[input.providerId]
    : undefined;
  if (rule === undefined) return deny(input, "ZERO_PAID_PROVIDER_UNSUPPORTED");
  if (!maximumCostIsZero(input.maximumPaidCostUsd)) return deny(input, "ZERO_PAID_NON_ZERO_BUDGET");
  if (input.evidence === null || input.evidence === undefined) return deny(input, "ZERO_PAID_EVIDENCE_REQUIRED");
  if (!digestPattern.test(input.accountReferenceDigest)) return deny(input, "ZERO_PAID_ACCOUNT_MISMATCH");

  let observedAt: string;
  let evidence: ZeroPaidEconomicsEvidence;
  try {
    observedAt = timestamp(input.observedAt);
    evidence = parseZeroPaidEconomicsEvidence(input.evidence);
  } catch {
    return deny(input, "ZERO_PAID_EVIDENCE_INVALID");
  }
  const observedAtMs = Date.parse(observedAt);
  if ([evidence.terms, evidence.model, evidence.account].some((piece) => piece.providerId !== input.providerId)) {
    return deny(input, "ZERO_PAID_PROVIDER_MISMATCH");
  }
  if (evidence.model.requestedModelId !== input.requestedModelId) return deny(input, "ZERO_PAID_MODEL_MISMATCH");
  if (evidence.account.accountReferenceDigest !== input.accountReferenceDigest) return deny(input, "ZERO_PAID_ACCOUNT_MISMATCH");
  if (!evidence.account.eligibleModelIds.includes(input.requestedModelId)) {
    return deny(input, "ZERO_PAID_ACCOUNT_MODEL_ACCESS_UNPROVEN");
  }

  for (const [source, maximumTtlMs] of [
    [evidence.terms.source, termsMaximumTtlMs],
    [evidence.model.source, modelMaximumTtlMs],
    [evidence.account.source, accountMaximumTtlMs],
  ] as const) {
    const code = validateSource(source, rule, observedAtMs, maximumTtlMs);
    if (code !== null) return deny(input, code);
  }
  if (evidence.terms.source.kind !== "official-terms" || evidence.model.source.kind !== "official-model-documentation") {
    return deny(input, "ZERO_PAID_SOURCE_NOT_OFFICIAL");
  }
  const accountSourceCode = validateAccountSource(evidence.account.source, input.providerId);
  if (accountSourceCode !== null) return deny(input, accountSourceCode);
  if ([evidence.terms, evidence.model, evidence.account].some(
    (piece) => piece.source.sourceDigest !== zeroPaidEconomicsPieceDigest(piece),
  )) return deny(input, "ZERO_PAID_SOURCE_DIGEST_INVALID");
  const sourceDigests = [evidence.terms.source.sourceDigest, evidence.model.source.sourceDigest, evidence.account.source.sourceDigest];
  if (new Set(sourceDigests).size !== sourceDigests.length) return deny(input, "ZERO_PAID_EVIDENCE_NOT_INDEPENDENT");

  const classes = [evidence.terms.economicsClass, evidence.model.economicsClass, evidence.account.economicsClass];
  if (classes.some((value) => promotionalOrTrialClasses.has(value)) || evidence.model.billingBasis === "TRIAL_CREDIT" ||
      evidence.account.remainingTrialCreditUsd !== null || evidence.account.trialExpiresAt !== null) {
    return deny(input, "ZERO_PAID_PROMOTIONAL_OR_TRIAL_INELIGIBLE");
  }
  if (
    new Set(classes).size !== 1 || classes.some((value) => !recurringClasses.has(value)) ||
    classes.some((value) => !rule.eligibleRecurringClasses.includes(value))
  ) return deny(input, "ZERO_PAID_ECONOMIC_CLASS_NOT_FREE");

  if (!evidence.model.officiallyListedFree || ["UNKNOWN", "UNPRICED", "METERED_PAID"].includes(evidence.model.billingBasis)) {
    return deny(input, "ZERO_PAID_MODEL_FREE_STATUS_UNPROVEN");
  }
  const prices = [evidence.model.promptPriceUsdPerMtok, evidence.model.outputPriceUsdPerMtok, evidence.model.requestPriceUsd];
  if (evidence.model.billingBasis === "ZERO_PRICED") {
    if (prices.some((price) => price !== "0")) return deny(input, "ZERO_PAID_MODEL_PRICE_NOT_ZERO");
  } else if (evidence.model.billingBasis === "NO_CHARGE_WITHIN_QUOTA") {
    if (prices.some((price) => price !== null && price !== "0")) return deny(input, "ZERO_PAID_MODEL_PRICE_NOT_ZERO");
  } else {
    return deny(input, "ZERO_PAID_MODEL_FREE_STATUS_UNPROVEN");
  }

  if (evidence.terms.paymentMethodRequired !== false) return deny(input, "ZERO_PAID_PAYMENT_METHOD_REQUIRED");
  if (evidence.account.paidUsageEnabled !== false) return deny(input, "ZERO_PAID_PAID_USAGE_ENABLED");
  if (evidence.terms.automaticOverageDefault !== false || evidence.account.automaticOverage !== false) {
    return deny(input, "ZERO_PAID_AUTOMATIC_OVERAGE");
  }
  if (evidence.account.hardSpendCap !== true) return deny(input, "ZERO_PAID_HARD_CAP_UNPROVEN");
  for (const quota of [evidence.model.quota, evidence.account.quota]) {
    const code = quotaDecision(quota);
    if (code !== null) return deny(input, code);
  }

  return Object.freeze({
    allowed: true,
    code: "ZERO_PAID_EVIDENCE_CURRENT",
    providerId: input.providerId,
    requestedModelId: input.requestedModelId,
    accountReferenceDigest: input.accountReferenceDigest,
    evidenceDigest: zeroPaidEconomicsEvidenceDigest(evidence),
    quota: evidence.account.quota,
    validUntil: [evidence.terms.source.expiresAt, evidence.model.source.expiresAt, evidence.account.source.expiresAt].sort()[0]!,
  });
}

export interface AccountSourceAuthorization {
  readonly schema: "urn:usf:account-source-authorization:1";
  readonly version: 1;
  readonly routeMemberDigest: string;
  readonly profileDigest: string;
  readonly effectivePolicyDigest: string;
  readonly privacyProjectionDigest: string;
  readonly accountSourceProtocolDigest: string;
  readonly endpointIdentity: string;
  readonly method: "GET";
  readonly credentialName: string;
  readonly maximumResponseBytes: number;
  readonly timeoutMilliseconds: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly inferenceProhibited: true;
  readonly fallbackProhibited: true;
}

export interface AccountTierReceiptUsage {
  readonly total: string;
  readonly daily: string;
  readonly weekly: string;
  readonly monthly: string;
  readonly byokTotal: string;
  readonly byokDaily: string;
  readonly byokWeekly: string;
  readonly byokMonthly: string;
  readonly byokIncludedInLimit: boolean;
  readonly paidCreditHistoryIndicator: boolean;
  readonly managementKey: boolean;
  readonly provisioningKey: boolean;
  readonly keyExpiresAt: string | null;
}

export type AccountCostDisposition = "zero-paid" | "paid" | "unknown" | "refused";
export type AccountVerificationDisposition = "verified" | "stale" | "mismatch" | "untrusted" | "refused";

export interface AccountTierReceipt {
  readonly schema: "urn:usf:account-tier-receipt:1";
  readonly version: 1;
  readonly routeMemberDigest: string;
  readonly accountSourceAuthorizationDigest: string;
  readonly accountSourceProtocolDigest: string;
  readonly endpointIdentity: string;
  readonly rawProviderResponseDigest: string;
  readonly authenticatedAccountIdentityDigest: string;
  readonly responseMappingDigest: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly tier: string;
  readonly paidUsageEnabled: boolean | null;
  readonly automaticOverageEnabled: boolean | null;
  readonly limit: string | null;
  readonly limitRemaining: string | null;
  readonly limitReset: string | null;
  readonly usage: AccountTierReceiptUsage;
  readonly costDisposition: AccountCostDisposition;
  readonly verificationDisposition: AccountVerificationDisposition;
  readonly nonClaims: readonly string[];
}

export type AccountTierReceiptCode =
  | "ACCOUNT_TIER_RECEIPT_CURRENT"
  | "ACCOUNT_TIER_RECEIPT_INVALID"
  | "ACCOUNT_TIER_AUTHORIZATION_DIGEST_MISMATCH"
  | "ACCOUNT_TIER_RAW_RESPONSE_DIGEST_MISMATCH"
  | "ACCOUNT_TIER_RAW_RESPONSE_INVALID"
  | "ACCOUNT_TIER_SOURCE_PROJECTION_MISMATCH"
  | "ACCOUNT_TIER_BINDING_MISMATCH"
  | "ACCOUNT_TIER_NOT_CURRENT"
  | "ACCOUNT_TIER_MAPPING_INSUFFICIENT"
  | "ACCOUNT_TIER_PAID_USAGE_ENABLED"
  | "ACCOUNT_TIER_AUTOMATIC_OVERAGE_ENABLED"
  | "ACCOUNT_TIER_COST_NOT_ZERO_PAID"
  | "ACCOUNT_TIER_VERIFICATION_UNTRUSTED"
  | "ACCOUNT_TIER_QUOTA_UNKNOWN"
  | "ACCOUNT_TIER_QUOTA_EXHAUSTED"
  | "ACCOUNT_TIER_PROMOTIONAL_INELIGIBLE";

export interface AccountTierReceiptVerificationInput {
  readonly authorization: unknown;
  readonly receipt: unknown;
  readonly rawProviderResponse: Uint8Array;
  readonly expectedRouteMemberDigest: string;
  readonly expectedProfileDigest: string;
  readonly expectedEffectivePolicyDigest: string;
  readonly expectedPrivacyProjectionDigest: string;
  readonly expectedAccountSourceProtocolDigest: string;
  readonly expectedEndpointIdentity: string;
  readonly expectedCredentialName: string;
  readonly expectedMaximumResponseBytes: number;
  readonly expectedTimeoutMilliseconds: number;
  /** Trusted graph-derived binding; it is authority only for mapping identity, never for account facts. */
  readonly trustedResponseMapping: unknown;
  readonly observedAt: string;
}

export interface AccountSourceMappingBinding {
  readonly iri: "urn:usf:provider-operation:account-source:openrouter-current-key:1";
  readonly digest: string;
  readonly disposition: "insufficient-alone-for-zero-paid-account-receipt";
}

export interface AccountTierReceiptDecision {
  readonly allowed: boolean;
  readonly code: AccountTierReceiptCode;
  readonly routeMemberDigest: string;
  readonly authorizationDigest: string | null;
  readonly receiptDigest: string | null;
  readonly authenticatedAccountIdentityDigest: string | null;
  readonly validUntil: string | null;
}

const accountCostDispositions = new Set<AccountCostDisposition>(["zero-paid", "paid", "unknown", "refused"]);
const accountVerificationDispositions = new Set<AccountVerificationDisposition>(["verified", "stale", "mismatch", "untrusted", "refused"]);
const credentialNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const tierPattern = /^[A-Za-z0-9][A-Za-z0-9 ._+:/-]{0,127}$/u;
const openRouterMappingIri = "urn:usf:provider-operation:account-source:openrouter-current-key:1";
const openRouterMappingDisposition = "insufficient-alone-for-zero-paid-account-receipt";
const openRouterEndpoint = "https://openrouter.ai/api/v1/key";
const openRouterCredentialName = "OPENROUTER_API_KEY";
const openRouterUnprovenTier = "UNPROVEN_FROM_OPENROUTER_CURRENT_KEY";
const openRouterNonClaims = Object.freeze([
  "Authenticated key metadata does not establish zero-paid inference authority.",
]);

function strictDigest(value: unknown): string {
  const candidate = nonEmptyString(value, 71);
  if (!digestPattern.test(candidate)) throw new Error("invalid digest");
  return candidate;
}

function strictTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)) {
    throw new Error("invalid timestamp");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error("invalid timestamp");
  return value;
}

function strictEndpoint(value: unknown): string {
  const candidate = nonEmptyString(value, 2_048);
  let url: URL;
  try { url = new URL(candidate); }
  catch { throw new Error("invalid endpoint"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "" || url.toString() !== candidate) {
    throw new Error("invalid endpoint");
  }
  return candidate;
}

function boundedPositiveInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) throw new Error("invalid bound");
  return value as number;
}

function strictDecimalOrNull(value: unknown): string | null {
  if (value === null) return null;
  const candidate = nonEmptyString(value, 128);
  if (!decimalPattern.test(candidate) || decimal(candidate) !== candidate) throw new Error("invalid decimal");
  return candidate;
}

function strictDecimal(value: unknown): string {
  const candidate = strictDecimalOrNull(value);
  if (candidate === null) throw new Error("invalid decimal");
  return candidate;
}

function strictLimitReset(value: unknown): string | null {
  if (value === null) return null;
  const candidate = nonEmptyString(value, 64);
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(candidate)) throw new Error("invalid limit reset");
  return candidate;
}

function parseAccountReceiptUsage(value: unknown): AccountTierReceiptUsage {
  const usage = record(value);
  exactKeys(usage, [
    "total", "daily", "weekly", "monthly", "byokTotal", "byokDaily", "byokWeekly",
    "byokMonthly", "byokIncludedInLimit", "paidCreditHistoryIndicator", "managementKey",
    "provisioningKey", "keyExpiresAt",
  ]);
  for (const value of [
    usage.byokIncludedInLimit,
    usage.paidCreditHistoryIndicator,
    usage.managementKey,
    usage.provisioningKey,
  ]) if (typeof value !== "boolean") throw new Error("invalid source boolean");
  return Object.freeze({
    total: strictDecimal(usage.total),
    daily: strictDecimal(usage.daily),
    weekly: strictDecimal(usage.weekly),
    monthly: strictDecimal(usage.monthly),
    byokTotal: strictDecimal(usage.byokTotal),
    byokDaily: strictDecimal(usage.byokDaily),
    byokWeekly: strictDecimal(usage.byokWeekly),
    byokMonthly: strictDecimal(usage.byokMonthly),
    byokIncludedInLimit: usage.byokIncludedInLimit as boolean,
    paidCreditHistoryIndicator: usage.paidCreditHistoryIndicator as boolean,
    managementKey: usage.managementKey as boolean,
    provisioningKey: usage.provisioningKey as boolean,
    keyExpiresAt: usage.keyExpiresAt === null ? null : strictTimestamp(usage.keyExpiresAt),
  });
}

/** Parse and freeze one closed, credential-name-only pre-contact authorization. */
export function parseAccountSourceAuthorization(value: unknown): AccountSourceAuthorization {
  const authorization = record(value);
  exactKeys(authorization, [
    "schema", "version", "routeMemberDigest", "profileDigest", "effectivePolicyDigest",
    "privacyProjectionDigest", "accountSourceProtocolDigest", "endpointIdentity", "method",
    "credentialName", "maximumResponseBytes", "timeoutMilliseconds", "issuedAt", "expiresAt",
    "inferenceProhibited", "fallbackProhibited",
  ]);
  if (authorization.schema !== "urn:usf:account-source-authorization:1" || authorization.version !== 1
    || authorization.method !== "GET" || authorization.inferenceProhibited !== true || authorization.fallbackProhibited !== true) {
    throw new Error("invalid authorization");
  }
  const credentialName = nonEmptyString(authorization.credentialName, 128);
  if (!credentialNamePattern.test(credentialName)) throw new Error("invalid credential name");
  const result: AccountSourceAuthorization = {
    schema: "urn:usf:account-source-authorization:1",
    version: 1,
    routeMemberDigest: strictDigest(authorization.routeMemberDigest),
    profileDigest: strictDigest(authorization.profileDigest),
    effectivePolicyDigest: strictDigest(authorization.effectivePolicyDigest),
    privacyProjectionDigest: strictDigest(authorization.privacyProjectionDigest),
    accountSourceProtocolDigest: strictDigest(authorization.accountSourceProtocolDigest),
    endpointIdentity: strictEndpoint(authorization.endpointIdentity),
    method: "GET",
    credentialName,
    maximumResponseBytes: boundedPositiveInteger(authorization.maximumResponseBytes, 1_048_576),
    timeoutMilliseconds: boundedPositiveInteger(authorization.timeoutMilliseconds, 60_000),
    issuedAt: strictTimestamp(authorization.issuedAt),
    expiresAt: strictTimestamp(authorization.expiresAt),
    inferenceProhibited: true,
    fallbackProhibited: true,
  };
  if (Date.parse(result.issuedAt) >= Date.parse(result.expiresAt)) throw new Error("invalid authorization time");
  return Object.freeze(result);
}

export function accountSourceAuthorizationDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseAccountSourceAuthorization(value), { rejectAbsolutePaths: true });
}

/** Parse and freeze one closed sanitized provider-owned account observation. */
export function parseAccountTierReceipt(value: unknown): AccountTierReceipt {
  const receipt = record(value);
  exactKeys(receipt, [
    "schema", "version", "routeMemberDigest", "accountSourceAuthorizationDigest",
    "accountSourceProtocolDigest", "endpointIdentity", "rawProviderResponseDigest",
    "authenticatedAccountIdentityDigest", "responseMappingDigest", "acquiredAt", "expiresAt",
    "tier", "paidUsageEnabled", "automaticOverageEnabled", "limit", "limitRemaining",
    "limitReset", "usage", "costDisposition", "verificationDisposition", "nonClaims",
  ]);
  if (receipt.schema !== "urn:usf:account-tier-receipt:1" || receipt.version !== 1) throw new Error("invalid receipt");
  const tier = nonEmptyString(receipt.tier, 128);
  if (!tierPattern.test(tier)) throw new Error("invalid tier");
  if (!Array.isArray(receipt.nonClaims) || receipt.nonClaims.length < 1 || receipt.nonClaims.length > 32) throw new Error("invalid nonclaims");
  const nonClaims = receipt.nonClaims.map((claim) => nonEmptyString(claim, 512));
  if (new Set(nonClaims).size !== nonClaims.length || [...nonClaims].sort().some((claim, index) => claim !== nonClaims[index])) {
    throw new Error("invalid nonclaims");
  }
  const result: AccountTierReceipt = {
    schema: "urn:usf:account-tier-receipt:1",
    version: 1,
    routeMemberDigest: strictDigest(receipt.routeMemberDigest),
    accountSourceAuthorizationDigest: strictDigest(receipt.accountSourceAuthorizationDigest),
    accountSourceProtocolDigest: strictDigest(receipt.accountSourceProtocolDigest),
    endpointIdentity: strictEndpoint(receipt.endpointIdentity),
    rawProviderResponseDigest: strictDigest(receipt.rawProviderResponseDigest),
    authenticatedAccountIdentityDigest: strictDigest(receipt.authenticatedAccountIdentityDigest),
    responseMappingDigest: strictDigest(receipt.responseMappingDigest),
    acquiredAt: strictTimestamp(receipt.acquiredAt),
    expiresAt: strictTimestamp(receipt.expiresAt),
    tier,
    paidUsageEnabled: nullableBoolean(receipt.paidUsageEnabled),
    automaticOverageEnabled: nullableBoolean(receipt.automaticOverageEnabled),
    limit: strictDecimalOrNull(receipt.limit),
    limitRemaining: strictDecimalOrNull(receipt.limitRemaining),
    limitReset: strictLimitReset(receipt.limitReset),
    usage: parseAccountReceiptUsage(receipt.usage),
    costDisposition: member(receipt.costDisposition, accountCostDispositions),
    verificationDisposition: member(receipt.verificationDisposition, accountVerificationDispositions),
    nonClaims: Object.freeze(nonClaims),
  };
  if (Date.parse(result.acquiredAt) >= Date.parse(result.expiresAt)) throw new Error("invalid receipt time");
  return Object.freeze(result);
}

export function accountTierReceiptDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseAccountTierReceipt(value), { rejectAbsolutePaths: true });
}

function parseAccountSourceMappingBinding(value: unknown): AccountSourceMappingBinding {
  const binding = record(value);
  exactKeys(binding, ["iri", "digest", "disposition"]);
  if (binding.iri !== openRouterMappingIri || binding.disposition !== openRouterMappingDisposition) {
    throw new Error("unsupported account source mapping");
  }
  return Object.freeze({
    iri: openRouterMappingIri,
    digest: strictDigest(binding.digest),
    disposition: openRouterMappingDisposition,
  });
}

function sanitizedIdentityField(value: unknown): string {
  const candidate = nonEmptyString(value, 256);
  const normalized = candidate.normalize("NFC");
  if (normalized.trim() !== normalized || normalized.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new Error("invalid identity field");
  }
  return normalized;
}

function sourceDecimal(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || Object.is(value, -0)) {
    throw new Error("invalid source number");
  }
  const text = String(value);
  if (!/[eE]/u.test(text)) return decimal(text);
  const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u.exec(text);
  if (match === null) throw new Error("invalid source number");
  const integer = match[1]!;
  const fraction = match[2] ?? "";
  const exponent = Number.parseInt(match[3]!, 10);
  const digits = `${integer}${fraction}`;
  const point = integer.length + exponent;
  const expanded = point <= 0
    ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length
      ? `${digits}${"0".repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return decimal(expanded);
}

function sourceDecimalOrNull(value: unknown): string | null {
  return value === null ? null : sourceDecimal(value);
}

interface OpenRouterCurrentKeyProjection {
  readonly authenticatedAccountIdentityDigest: string;
  readonly tier: string;
  readonly paidUsageEnabled: null;
  readonly automaticOverageEnabled: null;
  readonly limit: string | null;
  readonly limitRemaining: string | null;
  readonly limitReset: string | null;
  readonly usage: AccountTierReceiptUsage;
  readonly costDisposition: "unknown";
  readonly verificationDisposition: "verified";
  readonly nonClaims: readonly string[];
}

function parseOpenRouterCurrentKeyResponse(raw: Uint8Array, maximumBytes: number): OpenRouterCurrentKeyProjection {
  if (!(raw instanceof Uint8Array) || raw.byteLength < 2 || raw.byteLength > maximumBytes) throw new Error("invalid raw size");
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    if (text.startsWith("\uFEFF")) throw new Error("byte order mark refused");
    value = JSON.parse(text);
  } catch {
    throw new Error("invalid raw JSON");
  }
  const root = record(value);
  exactKeys(root, ["data"]);
  const data = record(root.data);
  exactKeys(data, [
    "byok_usage", "byok_usage_daily", "byok_usage_monthly", "byok_usage_weekly",
    "creator_user_id", "expires_at", "include_byok_in_limit", "is_free_tier",
    "is_management_key", "is_provisioning_key", "label", "limit", "limit_remaining",
    "limit_reset", "rate_limit", "usage", "usage_daily", "usage_monthly", "usage_weekly",
  ]);
  for (const flag of [data.include_byok_in_limit, data.is_free_tier, data.is_management_key, data.is_provisioning_key]) {
    if (typeof flag !== "boolean") throw new Error("invalid source boolean");
  }
  const deprecatedRateLimit = record(data.rate_limit);
  exactKeys(deprecatedRateLimit, ["interval", "note", "requests"]);
  nonEmptyString(deprecatedRateLimit.interval, 64);
  nonEmptyString(deprecatedRateLimit.note, 256);
  nonNegativeIntegerOrNull(deprecatedRateLimit.requests);
  const label = sanitizedIdentityField(data.label);
  const creatorUserId = sanitizedIdentityField(data.creator_user_id);
  const keyExpiresAt = data.expires_at === null ? null : timestamp(data.expires_at);
  const usage = Object.freeze({
    total: sourceDecimal(data.usage),
    daily: sourceDecimal(data.usage_daily),
    weekly: sourceDecimal(data.usage_weekly),
    monthly: sourceDecimal(data.usage_monthly),
    byokTotal: sourceDecimal(data.byok_usage),
    byokDaily: sourceDecimal(data.byok_usage_daily),
    byokWeekly: sourceDecimal(data.byok_usage_weekly),
    byokMonthly: sourceDecimal(data.byok_usage_monthly),
    byokIncludedInLimit: data.include_byok_in_limit as boolean,
    paidCreditHistoryIndicator: data.is_free_tier as boolean,
    managementKey: data.is_management_key as boolean,
    provisioningKey: data.is_provisioning_key as boolean,
    keyExpiresAt,
  });
  return Object.freeze({
    authenticatedAccountIdentityDigest: canonicalDigest({ creatorUserId, label }),
    tier: openRouterUnprovenTier,
    paidUsageEnabled: null,
    automaticOverageEnabled: null,
    limit: sourceDecimalOrNull(data.limit),
    limitRemaining: sourceDecimalOrNull(data.limit_remaining),
    limitReset: strictLimitReset(data.limit_reset),
    usage,
    costDisposition: "unknown",
    verificationDisposition: "verified",
    nonClaims: openRouterNonClaims,
  });
}

function deniedAccountReceipt(
  input: AccountTierReceiptVerificationInput,
  code: AccountTierReceiptCode,
  authorizationDigest: string | null = null,
  receiptDigest: string | null = null,
  accountDigest: string | null = null,
): AccountTierReceiptDecision {
  return Object.freeze({
    allowed: false,
    code,
    routeMemberDigest: input.expectedRouteMemberDigest,
    authorizationDigest,
    receiptDigest,
    authenticatedAccountIdentityDigest: accountDigest,
    validUntil: null,
  });
}

/**
 * Reauthenticate a retained raw response and its closed route-local receipt.
 * The current graph mapping verifies content but cannot establish zero-paid use.
 */
export function verifyAccountTierReceipt(input: AccountTierReceiptVerificationInput): AccountTierReceiptDecision {
  let authorization: AccountSourceAuthorization;
  let receipt: AccountTierReceipt;
  let mapping: AccountSourceMappingBinding;
  let observedAt: string;
  try {
    authorization = parseAccountSourceAuthorization(input.authorization);
    receipt = parseAccountTierReceipt(input.receipt);
    mapping = parseAccountSourceMappingBinding(input.trustedResponseMapping);
    observedAt = strictTimestamp(input.observedAt);
    for (const expected of [
      input.expectedRouteMemberDigest,
      input.expectedProfileDigest,
      input.expectedEffectivePolicyDigest,
      input.expectedPrivacyProjectionDigest,
      input.expectedAccountSourceProtocolDigest,
    ]) strictDigest(expected);
    strictEndpoint(input.expectedEndpointIdentity);
    if (!credentialNamePattern.test(input.expectedCredentialName)) throw new Error("invalid credential name");
    boundedPositiveInteger(input.expectedMaximumResponseBytes, 1_048_576);
    boundedPositiveInteger(input.expectedTimeoutMilliseconds, 60_000);
  } catch {
    return deniedAccountReceipt(input, "ACCOUNT_TIER_RECEIPT_INVALID");
  }
  const authorizationDigest = accountSourceAuthorizationDigest(authorization);
  const receiptDigest = accountTierReceiptDigest(receipt);
  if (receipt.accountSourceAuthorizationDigest !== authorizationDigest) {
    return deniedAccountReceipt(input, "ACCOUNT_TIER_AUTHORIZATION_DIGEST_MISMATCH", authorizationDigest, receiptDigest, receipt.authenticatedAccountIdentityDigest);
  }
  if (sha256(input.rawProviderResponse) !== receipt.rawProviderResponseDigest) {
    return deniedAccountReceipt(input, "ACCOUNT_TIER_RAW_RESPONSE_DIGEST_MISMATCH", authorizationDigest, receiptDigest, receipt.authenticatedAccountIdentityDigest);
  }
  if (authorization.routeMemberDigest !== input.expectedRouteMemberDigest
    || receipt.routeMemberDigest !== input.expectedRouteMemberDigest
    || authorization.profileDigest !== input.expectedProfileDigest
    || authorization.effectivePolicyDigest !== input.expectedEffectivePolicyDigest
    || authorization.privacyProjectionDigest !== input.expectedPrivacyProjectionDigest
    || authorization.accountSourceProtocolDigest !== input.expectedAccountSourceProtocolDigest
    || receipt.accountSourceProtocolDigest !== input.expectedAccountSourceProtocolDigest
    || authorization.endpointIdentity !== input.expectedEndpointIdentity
    || receipt.endpointIdentity !== input.expectedEndpointIdentity
    || authorization.credentialName !== input.expectedCredentialName
    || authorization.maximumResponseBytes !== input.expectedMaximumResponseBytes
    || authorization.timeoutMilliseconds !== input.expectedTimeoutMilliseconds
    || input.expectedEndpointIdentity !== openRouterEndpoint
    || input.expectedCredentialName !== openRouterCredentialName
    || receipt.responseMappingDigest !== mapping.digest) {
    return deniedAccountReceipt(input, "ACCOUNT_TIER_BINDING_MISMATCH", authorizationDigest, receiptDigest, receipt.authenticatedAccountIdentityDigest);
  }
  let projection: OpenRouterCurrentKeyProjection;
  try { projection = parseOpenRouterCurrentKeyResponse(input.rawProviderResponse, authorization.maximumResponseBytes); }
  catch {
    return deniedAccountReceipt(input, "ACCOUNT_TIER_RAW_RESPONSE_INVALID", authorizationDigest, receiptDigest, receipt.authenticatedAccountIdentityDigest);
  }
  const expectedProjection = {
    authenticatedAccountIdentityDigest: projection.authenticatedAccountIdentityDigest,
    tier: projection.tier,
    paidUsageEnabled: projection.paidUsageEnabled,
    automaticOverageEnabled: projection.automaticOverageEnabled,
    limit: projection.limit,
    limitRemaining: projection.limitRemaining,
    limitReset: projection.limitReset,
    usage: projection.usage,
    costDisposition: projection.costDisposition,
    verificationDisposition: projection.verificationDisposition,
    nonClaims: projection.nonClaims,
  };
  const receiptProjection = {
    authenticatedAccountIdentityDigest: receipt.authenticatedAccountIdentityDigest,
    tier: receipt.tier,
    paidUsageEnabled: receipt.paidUsageEnabled,
    automaticOverageEnabled: receipt.automaticOverageEnabled,
    limit: receipt.limit,
    limitRemaining: receipt.limitRemaining,
    limitReset: receipt.limitReset,
    usage: receipt.usage,
    costDisposition: receipt.costDisposition,
    verificationDisposition: receipt.verificationDisposition,
    nonClaims: receipt.nonClaims,
  };
  if (canonicalDigest(receiptProjection) !== canonicalDigest(expectedProjection)) {
    return deniedAccountReceipt(input, "ACCOUNT_TIER_SOURCE_PROJECTION_MISMATCH", authorizationDigest, receiptDigest, projection.authenticatedAccountIdentityDigest);
  }
  const observed = Date.parse(observedAt);
  if (Date.parse(authorization.issuedAt) > Date.parse(receipt.acquiredAt)
    || Date.parse(receipt.acquiredAt) > observed
    || observed >= Date.parse(receipt.expiresAt)
    || observed >= Date.parse(authorization.expiresAt)
    || Date.parse(receipt.expiresAt) > Date.parse(authorization.expiresAt)
    || (projection.usage.keyExpiresAt !== null && (observed >= Date.parse(projection.usage.keyExpiresAt)
      || Date.parse(receipt.expiresAt) > Date.parse(projection.usage.keyExpiresAt)))) {
    return deniedAccountReceipt(input, "ACCOUNT_TIER_NOT_CURRENT", authorizationDigest, receiptDigest, receipt.authenticatedAccountIdentityDigest);
  }
  return deniedAccountReceipt(input, "ACCOUNT_TIER_MAPPING_INSUFFICIENT", authorizationDigest, receiptDigest, projection.authenticatedAccountIdentityDigest);
}
