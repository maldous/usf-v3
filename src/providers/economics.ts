import { canonicalDigest } from "../core/canonical.ts";

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
