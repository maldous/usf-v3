import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateZeroPaidEconomics,
  parseZeroPaidEconomicsEvidence,
  zeroPaidEconomicsEvidenceDigest,
  zeroPaidEconomicsPieceDigest,
} from "../../../src/providers/economics.ts";

const now = "2026-08-30T00:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const accountDigest = digest("f");

function source(provider: "groq" | "cerebras", kind: "official-terms" | "official-model-documentation" | "authenticated-account-observation", url?: string) {
  return {
    kind,
    publisher: provider === "groq" ? "Groq" : "Cerebras Systems",
    pageTitle: `${provider} official economics`,
    sourceUrl: url ?? (provider === "groq"
      ? "https://console.groq.com/docs/rate-limits"
      : "https://inference-docs.cerebras.ai/support/rate-limits"),
    sourceDigest: digest("0"),
    checkedAt: "2026-08-29T23:55:00.000Z",
    expiresAt: "2026-08-30T00:30:00.000Z",
  };
}

function bindSourceDigests(value: Record<string, any>): Record<string, any> {
  const normalized = structuredClone(parseZeroPaidEconomicsEvidence(value)) as Record<string, any>;
  for (const piece of [normalized.terms, normalized.model, normalized.account]) {
    piece.source.sourceDigest = zeroPaidEconomicsPieceDigest(piece);
  }
  return normalized;
}

function quota() {
  return {
    requestsPerMinute: 20,
    requestsPerDay: 1_000,
    tokensPerMinute: 30_000,
    tokensPerDay: null,
    remainingRequests: 19,
    remainingTokens: 25_000,
    resetAt: "2026-08-30T00:01:00.000Z",
    resetCadence: "minute",
    availability: "available",
  };
}

function groqEvidence(): Record<string, any> {
  return bindSourceDigests({
    terms: {
      providerId: "groq",
      economicsClass: "FREE_RATE_LIMITED",
      modelSpecific: false,
      paymentMethodRequired: false,
      automaticOverageDefault: false,
      source: source("groq", "official-terms", "https://console.groq.com/docs/billing-faqs"),
    },
    model: {
      providerId: "groq",
      requestedModelId: "qwen/qwen3.6-27b",
      economicsClass: "FREE_RATE_LIMITED",
      billingBasis: "NO_CHARGE_WITHIN_QUOTA",
      officiallyListedFree: true,
      promptPriceUsdPerMtok: null,
      outputPriceUsdPerMtok: null,
      requestPriceUsd: "0.000",
      quota: quota(),
      source: source("groq", "official-model-documentation"),
    },
    account: {
      providerId: "groq",
      accountReferenceDigest: accountDigest,
      tierName: "Free",
      economicsClass: "FREE_RATE_LIMITED",
      eligibleModelIds: ["qwen/qwen3.6-27b"],
      paidUsageEnabled: false,
      automaticOverage: false,
      hardSpendCap: true,
      quota: quota(),
      remainingTrialCreditUsd: null,
      trialExpiresAt: null,
      source: source("groq", "authenticated-account-observation", "https://console.groq.com/account/export"),
    },
  });
}

function cerebrasRecurringEvidence(): Record<string, any> {
  const evidence = groqEvidence();
  for (const piece of [evidence.terms, evidence.model, evidence.account]) {
    piece.providerId = "cerebras";
    piece.economicsClass = "FREE_RATE_LIMITED";
  }
  evidence.terms.source = source("cerebras", "official-terms", "https://www.cerebras.ai/pricing");
  evidence.model.requestedModelId = "gpt-oss-120b";
  evidence.model.billingBasis = "ZERO_PRICED";
  evidence.model.promptPriceUsdPerMtok = "0";
  evidence.model.outputPriceUsdPerMtok = "0";
  evidence.model.requestPriceUsd = "0";
  evidence.model.source = source("cerebras", "official-model-documentation");
  evidence.account.tierName = "Free";
  evidence.account.eligibleModelIds = ["gpt-oss-120b"];
  evidence.account.source = source("cerebras", "authenticated-account-observation", "https://cloud.cerebras.ai/account/export");
  return bindSourceDigests(evidence);
}

function decision(evidence: unknown, overrides: Record<string, unknown> = {}, rebind = true) {
  return evaluateZeroPaidEconomics({
    providerId: "groq",
    requestedModelId: "qwen/qwen3.6-27b",
    accountReferenceDigest: accountDigest,
    evidence: rebind && typeof evidence === "object" && evidence !== null ? bindSourceDigests(evidence as Record<string, any>) : evidence,
    observedAt: now,
    maximumPaidCostUsd: "0.00",
    ...overrides,
  });
}

test("three independent current Groq facts qualify one exact zero-paid account/model tuple", () => {
  const evidence = groqEvidence();
  const result = decision(evidence);
  assert.equal(result.allowed, true);
  assert.equal(result.code, "ZERO_PAID_EVIDENCE_CURRENT");
  assert.match(result.evidenceDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.quota?.availability, "available");
  assert.equal(result.validUntil, "2026-08-30T00:30:00.000Z");
});

test("evidence is closed, normalized, deeply frozen, and canonically order-stable", () => {
  const first = parseZeroPaidEconomicsEvidence(groqEvidence());
  const reordered = groqEvidence();
  reordered.account.eligibleModelIds = ["z-model", "qwen/qwen3.6-27b"];
  const differentlyOrdered = structuredClone(reordered);
  differentlyOrdered.account.eligibleModelIds.reverse();
  assert.equal(zeroPaidEconomicsEvidenceDigest(reordered), zeroPaidEconomicsEvidenceDigest(differentlyOrdered));
  assert.equal(first.model.requestPriceUsd, "0");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.account.eligibleModelIds), true);
  assert.throws(() => { (first.account.eligibleModelIds as string[]).push("other"); }, TypeError);

  const withCredential = groqEvidence();
  withCredential.account.credential = "forbidden";
  assert.equal(decision(withCredential, {}, false).code, "ZERO_PAID_EVIDENCE_INVALID");
});

test("exact provider, model, and account bindings fail closed", () => {
  const cases: readonly [string, (value: Record<string, any>) => void, Record<string, unknown>, string][] = [
    ["provider", (value) => { value.model.providerId = "cerebras"; }, {}, "ZERO_PAID_PROVIDER_MISMATCH"],
    ["model", () => {}, { requestedModelId: "other/model" }, "ZERO_PAID_MODEL_MISMATCH"],
    ["account", () => {}, { accountReferenceDigest: digest("e") }, "ZERO_PAID_ACCOUNT_MISMATCH"],
    ["eligible model", (value) => { value.account.eligibleModelIds = ["other/model"]; }, {}, "ZERO_PAID_ACCOUNT_MODEL_ACCESS_UNPROVEN"],
  ];
  for (const [label, mutate, overrides, expected] of cases) {
    const evidence = groqEvidence();
    mutate(evidence);
    assert.equal(decision(evidence, overrides).code, expected, label);
  }
  assert.equal(decision(groqEvidence(), { providerId: "toString" }).code, "ZERO_PAID_PROVIDER_UNSUPPORTED");
});

test("official source kinds, content-bound digests, and three freshness ceilings are enforced", () => {
  const cases: readonly [string, (value: Record<string, any>) => void, string][] = [
    ["unofficial", (value) => { value.model.source.sourceUrl = "https://example.com/free"; }, "ZERO_PAID_SOURCE_NOT_OFFICIAL"],
    ["invalid digest", (value) => { value.model.source.sourceDigest = "sha256:not-valid"; }, "ZERO_PAID_SOURCE_DIGEST_INVALID"],
    ["wrong account kind", (value) => { value.account.source.kind = "official-model-documentation"; }, "ZERO_PAID_SOURCE_NOT_OFFICIAL"],
    ["public account endpoint", (value) => { value.account.source.sourceUrl = "https://api.groq.com/openai/v1/models"; }, "ZERO_PAID_SOURCE_NOT_OFFICIAL"],
    ["stale model", (value) => { value.model.source.expiresAt = now; }, "ZERO_PAID_EVIDENCE_STALE"],
    ["terms over 7d", (value) => { value.terms.source.checkedAt = "2026-08-22T23:59:59.000Z"; }, "ZERO_PAID_EVIDENCE_TIME_INVALID"],
    ["model over 1d", (value) => { value.model.source.checkedAt = "2026-08-28T23:59:59.000Z"; }, "ZERO_PAID_EVIDENCE_TIME_INVALID"],
    ["account over 1h", (value) => { value.account.source.checkedAt = "2026-08-29T23:00:00.000Z"; }, "ZERO_PAID_EVIDENCE_TIME_INVALID"],
  ];
  for (const [label, mutate, expected] of cases) {
    const evidence = groqEvidence();
    mutate(evidence);
    const preserveTamper = label === "invalid digest";
    assert.equal(decision(evidence, {}, !preserveTamper).code, expected, label);
  }

  const tampered = groqEvidence();
  tampered.account.paidUsageEnabled = true;
  assert.equal(decision(tampered, {}, false).code, "ZERO_PAID_SOURCE_DIGEST_INVALID");
});

test("paid paths and every unknown zero-paid control are denied", () => {
  const cases: readonly [string, (value: Record<string, any>) => void, string][] = [
    ["payment method", (value) => { value.terms.paymentMethodRequired = null; }, "ZERO_PAID_PAYMENT_METHOD_REQUIRED"],
    ["paid usage", (value) => { value.account.paidUsageEnabled = null; }, "ZERO_PAID_PAID_USAGE_ENABLED"],
    ["terms overage", (value) => { value.terms.automaticOverageDefault = true; }, "ZERO_PAID_AUTOMATIC_OVERAGE"],
    ["account overage", (value) => { value.account.automaticOverage = null; }, "ZERO_PAID_AUTOMATIC_OVERAGE"],
    ["hard cap", (value) => { value.account.hardSpendCap = null; }, "ZERO_PAID_HARD_CAP_UNPROVEN"],
    ["price", (value) => { value.model.promptPriceUsdPerMtok = "0.01"; }, "ZERO_PAID_MODEL_PRICE_NOT_ZERO"],
    ["unknown billing", (value) => { value.model.billingBasis = "UNKNOWN"; }, "ZERO_PAID_MODEL_FREE_STATUS_UNPROVEN"],
  ];
  for (const [label, mutate, expected] of cases) {
    const evidence = groqEvidence();
    mutate(evidence);
    assert.equal(decision(evidence).code, expected, label);
  }
  assert.equal(decision(groqEvidence(), { maximumPaidCostUsd: "0.01" }).code, "ZERO_PAID_NON_ZERO_BUDGET");
});

test("quota must be bounded, explicitly available, and non-exhausted for model and account", () => {
  const cases: readonly [string, (value: Record<string, any>) => void, string][] = [
    ["unbounded model", (value) => {
      Object.assign(value.model.quota, { requestsPerMinute: null, requestsPerDay: null, tokensPerMinute: null, tokensPerDay: null });
    }, "ZERO_PAID_QUOTA_UNBOUNDED"],
    ["unknown account", (value) => { value.account.quota.availability = "unknown"; }, "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN"],
    ["unknown model requests", (value) => { value.model.quota.remainingRequests = null; }, "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN"],
    ["unknown model tokens", (value) => { value.model.quota.remainingTokens = null; }, "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN"],
    ["unknown account requests", (value) => { value.account.quota.remainingRequests = null; }, "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN"],
    ["unknown account tokens", (value) => { value.account.quota.remainingTokens = null; }, "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN"],
    ["exhausted account", (value) => { value.account.quota.availability = "exhausted"; }, "ZERO_PAID_QUOTA_EXHAUSTED"],
    ["zero remaining", (value) => { value.account.quota.remainingRequests = 0; value.account.quota.remainingTokens = 0; }, "ZERO_PAID_QUOTA_EXHAUSTED"],
  ];
  for (const [label, mutate, expected] of cases) {
    const evidence = groqEvidence();
    mutate(evidence);
    assert.equal(decision(evidence).code, expected, label);
  }
});

test("current recurring Cerebras Free evidence can qualify only the exact account and model", () => {
  const evidence = cerebrasRecurringEvidence();
  const input = {
    providerId: "cerebras",
    requestedModelId: "gpt-oss-120b",
    accountReferenceDigest: accountDigest,
    evidence,
    observedAt: now,
  } as const;
  assert.equal(evaluateZeroPaidEconomics(input).code, "ZERO_PAID_EVIDENCE_CURRENT");
  assert.equal(evaluateZeroPaidEconomics({ ...input, accountReferenceDigest: digest("e") }).code, "ZERO_PAID_ACCOUNT_MISMATCH");
});

test("Cerebras one-time trial and promotional credit remain explicitly ineligible in V3", () => {
  const evidence = cerebrasRecurringEvidence();
  for (const piece of [evidence.terms, evidence.model, evidence.account]) {
    piece.economicsClass = "FREE_TRIAL_ONE_TIME";
  }
  evidence.model.billingBasis = "TRIAL_CREDIT";
  evidence.account.remainingTrialCreditUsd = "5";
  evidence.account.trialExpiresAt = "2026-08-31T00:00:00.000Z";
  assert.equal(evaluateZeroPaidEconomics({
    providerId: "cerebras",
    requestedModelId: "gpt-oss-120b",
    accountReferenceDigest: accountDigest,
    evidence: bindSourceDigests(evidence),
    observedAt: now,
  }).code, "ZERO_PAID_PROMOTIONAL_OR_TRIAL_INELIGIBLE");
});
