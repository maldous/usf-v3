import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../../src/core/canonical.ts";
import {
  AccountSourceError,
  accountSourceKeyDigest,
  authorizationUseDisposition,
  observationUseDisposition,
  parseAccountObservation,
  parseAccountSourceAuthorizationV2,
  parseAccountSourceKey,
} from "../../../src/providers/account-sources.ts";
import { credentialSourceIdentityDigest, HostSourceIdentityError } from "../../../src/providers/host-source-identities.ts";
import {
  candidateDisposition,
  candidatePrefix,
  economicsBuckets,
  economicsListCursor,
  economicsListCursorMatches,
  projectCandidateDispositions,
  reduceCandidateSource,
} from "../../../src/providers/disposition.ts";
import {
  accountSourceAuthorizationDigest,
  accountTierReceiptDigest,
  evaluateZeroPaidEconomics,
  parseAccountSourceAuthorization,
  parseAccountTierReceipt,
  parseZeroPaidEconomicsEvidence,
  verifyAccountTierReceipt,
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

test("OpenRouter account receipt verification derives source facts but refuses the insufficient mapping", () => {
  const rawPayload = {
    data: {
      byok_usage: 17.38,
      byok_usage_daily: 1.25,
      byok_usage_monthly: 17.38,
      byok_usage_weekly: 8.5,
      creator_user_id: "user_fixture_000000000000000000000000",
      expires_at: "2027-12-31T23:59:59Z",
      include_byok_in_limit: false,
      is_free_tier: false,
      is_management_key: false,
      is_provisioning_key: false,
      label: "sk-or-v1-fixture...000",
      limit: 100,
      limit_remaining: 74.5,
      limit_reset: "monthly",
      rate_limit: { interval: "1h", note: "This field is deprecated and safe to ignore.", requests: 1_000 },
      usage: 25.5,
      usage_daily: 2.5,
      usage_monthly: 25.5,
      usage_weekly: 10.25,
    },
  };
  const raw = Buffer.from(JSON.stringify(rawPayload), "utf8");
  const identityDigest = sha256('{"creatorUserId":"user_fixture_000000000000000000000000","label":"sk-or-v1-fixture...000"}');
  const authorization = {
    schema: "urn:usf:account-source-authorization:1",
    version: 1,
    routeMemberDigest: digest("1"),
    profileDigest: digest("2"),
    effectivePolicyDigest: digest("3"),
    privacyProjectionDigest: digest("4"),
    accountSourceProtocolDigest: digest("5"),
    endpointIdentity: "https://openrouter.ai/api/v1/key",
    method: "GET",
    credentialName: "OPENROUTER_API_KEY",
    maximumResponseBytes: 65_536,
    timeoutMilliseconds: 10_000,
    issuedAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2026-08-30T01:00:00.000Z",
    inferenceProhibited: true,
    fallbackProhibited: true,
  };
  const receipt = {
    schema: "urn:usf:account-tier-receipt:1",
    version: 1,
    routeMemberDigest: digest("1"),
    accountSourceAuthorizationDigest: accountSourceAuthorizationDigest(authorization),
    accountSourceProtocolDigest: digest("5"),
    endpointIdentity: "https://openrouter.ai/api/v1/key",
    rawProviderResponseDigest: sha256(raw),
    authenticatedAccountIdentityDigest: identityDigest,
    responseMappingDigest: digest("7"),
    acquiredAt: "2026-08-30T00:01:00.000Z",
    expiresAt: "2026-08-30T00:30:00.000Z",
    tier: "UNPROVEN_FROM_OPENROUTER_CURRENT_KEY",
    paidUsageEnabled: null,
    automaticOverageEnabled: null,
    limit: "100",
    limitRemaining: "74.5",
    limitReset: "monthly",
    usage: {
      total: "25.5",
      daily: "2.5",
      weekly: "10.25",
      monthly: "25.5",
      byokTotal: "17.38",
      byokDaily: "1.25",
      byokWeekly: "8.5",
      byokMonthly: "17.38",
      byokIncludedInLimit: false,
      paidCreditHistoryIndicator: false,
      managementKey: false,
      provisioningKey: false,
      keyExpiresAt: "2027-12-31T23:59:59.000Z",
    },
    costDisposition: "unknown",
    verificationDisposition: "verified",
    nonClaims: ["Authenticated key metadata does not establish zero-paid inference authority."],
  };
  const verify = (authorizationValue: unknown, receiptValue: unknown, overrides: Record<string, unknown> = {}) => verifyAccountTierReceipt({
    authorization: authorizationValue,
    receipt: receiptValue,
    rawProviderResponse: raw,
    expectedRouteMemberDigest: digest("1"),
    expectedProfileDigest: digest("2"),
    expectedEffectivePolicyDigest: digest("3"),
    expectedPrivacyProjectionDigest: digest("4"),
    expectedAccountSourceProtocolDigest: digest("5"),
    expectedEndpointIdentity: "https://openrouter.ai/api/v1/key",
    expectedCredentialName: "OPENROUTER_API_KEY",
    expectedMaximumResponseBytes: 65_536,
    expectedTimeoutMilliseconds: 10_000,
    trustedResponseMapping: {
      iri: "urn:usf:provider-operation:account-source:openrouter-current-key:1",
      digest: digest("7"),
      disposition: "insufficient-alone-for-zero-paid-account-receipt",
    },
    observedAt: "2026-08-30T00:02:00.000Z",
    ...overrides,
  });

  const parsedAuthorization = parseAccountSourceAuthorization(authorization);
  const parsedReceipt = parseAccountTierReceipt(receipt);
  const sourceVerified = verify(parsedAuthorization, parsedReceipt);
  assert.equal(sourceVerified.allowed, false);
  assert.equal(sourceVerified.code, "ACCOUNT_TIER_MAPPING_INSUFFICIENT");
  assert.equal(sourceVerified.authenticatedAccountIdentityDigest, identityDigest);
  assert.equal(sourceVerified.receiptDigest, accountTierReceiptDigest(receipt));
  assert.equal(Object.isFrozen(parsedAuthorization), true);
  assert.equal(Object.isFrozen(parsedReceipt.usage), true);

  const cases: readonly [string, (auth: Record<string, any>, record: Record<string, any>, payload: Record<string, any>) => void, Record<string, unknown>, string][] = [
    ["closed authorization", (auth) => { auth.credentialValue = "forbidden"; }, {}, "ACCOUNT_TIER_RECEIPT_INVALID"],
    ["raw mutation", () => {}, { rawProviderResponse: Buffer.from("tampered") }, "ACCOUNT_TIER_RAW_RESPONSE_DIGEST_MISMATCH"],
    ["invalid official shape", (_auth, record, payload) => {
      delete payload.data.usage_weekly;
      const changedRaw = Buffer.from(JSON.stringify(payload));
      record.rawProviderResponseDigest = sha256(changedRaw);
    }, { rawProviderResponse: null }, "ACCOUNT_TIER_RAW_RESPONSE_INVALID"],
    ["self-consistent forged receipt projection", (_auth, record) => {
      record.authenticatedAccountIdentityDigest = digest("6");
      record.paidUsageEnabled = false;
      record.automaticOverageEnabled = false;
      record.costDisposition = "zero-paid";
    }, {}, "ACCOUNT_TIER_SOURCE_PROJECTION_MISMATCH"],
    ["route binding", () => {}, { expectedRouteMemberDigest: digest("8") }, "ACCOUNT_TIER_BINDING_MISMATCH"],
    ["profile binding", () => {}, { expectedProfileDigest: digest("8") }, "ACCOUNT_TIER_BINDING_MISMATCH"],
    ["expiry", () => {}, { observedAt: "2026-08-30T00:30:00.000Z" }, "ACCOUNT_TIER_NOT_CURRENT"],
  ];
  for (const [label, mutate, overrides, expected] of cases) {
    const auth = structuredClone(authorization) as Record<string, any>;
    const record = structuredClone(receipt) as Record<string, any>;
    const payload = structuredClone(rawPayload) as Record<string, any>;
    mutate(auth, record, payload);
    const effectiveOverrides = overrides.rawProviderResponse === null
      ? { ...overrides, rawProviderResponse: Buffer.from(JSON.stringify(payload)) }
      : overrides;
    assert.equal(verify(auth, record, effectiveOverrides).code, expected, label);
  }
});

// Receipt v2 no-contact source domain. Each case below is one rule family with
// planted defects, not a provider matrix: the modules under test perform no
// contact, so the interesting behaviour is entirely in what they refuse.

const d = (seed: string): string => sha256(seed);
const instant = (iso: string): string => iso;

const apiKey = {
  sourceKind: "api-key" as const,
  transport: "openrouter" as const,
  provider: "openrouter",
  controlPlaneIdentity: "https://openrouter.ai/api/v1/key",
  responseMappingDigest: d("mapping"),
  credentialMode: "repository-env-file" as const,
  credentialName: "OPENROUTER_API_KEY",
  credentialSourceIdentityDigest: d("credential-source"),
  accountSourceProtocolDigest: d("protocol"),
};

test("the factual account-source key is profile-independent and rejects crossed source kinds", () => {
  const key = parseAccountSourceKey(apiKey);
  const digest = accountSourceKeyDigest(key);

  // Profile, policy and privacy bind in the authorization, never in the key, so
  // one factual observation is reusable across profiles without a second call.
  assert.equal(accountSourceKeyDigest(parseAccountSourceKey({ ...apiKey })), digest);
  // Any member of the key does move it.
  assert.notEqual(accountSourceKeyDigest(parseAccountSourceKey({ ...apiKey, credentialSourceIdentityDigest: d("rotated") })), digest);

  // A host-authenticated API key, or a repository-env-file subscription host,
  // would let one source kind borrow the other's evidence.
  for (const crossed of [
    { ...apiKey, credentialMode: "host-authenticated" as const },
    { ...apiKey, sourceKind: "subscription-host" as const },
  ]) {
    assert.throws(() => parseAccountSourceKey(crossed), (error: unknown) => error instanceof AccountSourceError && error.code === "ACCOUNT_SOURCE_RECORD_MALFORMED");
  }
});

test("authorization and observation reconstruct their own identities and honour explicit instants", () => {
  const key = parseAccountSourceKey(apiKey);
  const authorization = {
    schema: "urn:usf:account-source-authorization:2", version: 1,
    accountSourceKeyDigest: accountSourceKeyDigest(key), ...apiKey,
    profileDigest: d("profile"), effectivePolicyDigest: d("policy"), privacyProjectionDigest: d("privacy"),
    operationalActivationDigest: d("activation"), authorizationFreshnessPolicyDigest: d("freshness"),
    maximumResponseBytes: 65536, timeoutMilliseconds: 10000,
    issuedAt: instant("2026-09-01T00:00:00.000Z"), expiresAt: instant("2026-09-01T01:00:00.000Z"),
    inferenceProhibited: true, fallbackProhibited: true,
  };
  const parsed = parseAccountSourceAuthorizationV2(authorization);
  assert.equal(parsed.accountSourceKeyDigest, accountSourceKeyDigest(key));

  // The caller does not get to name the key: a declared digest that does not
  // reconstruct from the record's own members is refused.
  assert.throws(
    () => parseAccountSourceAuthorizationV2({ ...authorization, accountSourceKeyDigest: d("claimed") }),
    (error: unknown) => error instanceof AccountSourceError && error.code === "ACCOUNT_SOURCE_KEY_MISMATCH",
  );

  // The evaluation instant is supplied, never read from the clock, so a
  // projection and the decision it informs cannot disagree about "now".
  assert.equal(authorizationUseDisposition(parsed, "2026-09-01T00:30:00.000Z", apiKey.credentialSourceIdentityDigest), "current");
  assert.equal(authorizationUseDisposition(parsed, "2026-08-31T23:00:00.000Z", apiKey.credentialSourceIdentityDigest), "not-yet-valid");
  assert.equal(authorizationUseDisposition(parsed, "2026-09-01T01:00:00.000Z", apiKey.credentialSourceIdentityDigest), "expired");
  // Credential rotation immediately invalidates stale economics authority.
  assert.equal(authorizationUseDisposition(parsed, "2026-09-01T00:30:00.000Z", d("rotated")), "credential-identity-moved");

  const observation = {
    schema: "urn:usf:account-observation:1", version: 1,
    accountSourceKeyDigest: accountSourceKeyDigest(key), acquisitionAuthorizationDigest: d("auth"),
    credentialSourceIdentityDigest: apiKey.credentialSourceIdentityDigest,
    accountSourceProtocolDigest: d("protocol"), responseMappingDigest: d("mapping"),
    observationFreshnessPolicyDigest: d("obs-freshness"), rawProviderResponseDigest: d("raw"),
    authenticatedAccountIdentityDigest: d("account"), transport: "openrouter", provider: "openrouter",
    controlPlaneIdentity: "https://openrouter.ai/api/v1/key",
    acquiredAt: instant("2026-09-01T00:00:00.000Z"), providerCredentialExpiresAt: null,
    expiresAt: instant("2026-09-01T01:00:00.000Z"), serviceTier: "free",
    entitlementDisposition: "entitled", paidUsageEnabled: false, automaticOverageEnabled: false,
    automaticTopUpEnabled: false, spendCap: null,
    quota: { limit: 100, remaining: 100, resetAt: null, availability: "available" },
    usage: { amount: null, currency: null, periodStartedAt: null, periodEndsAt: null },
    costDisposition: "zero-paid", verificationDisposition: "verified", nonClaims: [],
  };
  assert.equal(observationUseDisposition(parseAccountObservation(observation), "2026-09-01T00:30:00.000Z"), "current");

  // Provider-owned credential expiry caps observation expiry: an observation may
  // never outlive the credential that produced it.
  assert.throws(
    () => parseAccountObservation({ ...observation, providerCredentialExpiresAt: instant("2026-09-01T00:30:00.000Z") }),
    (error: unknown) => error instanceof AccountSourceError && error.code === "ACCOUNT_SOURCE_RECORD_MALFORMED",
  );
});

test("a host source without a stable identity stays ineligible rather than keying on an expiring authorization", () => {
  const stable = {
    transport: "codex-cli" as const, provider: "openai", mappingDigest: d("host-mapping"),
    credentialFileIdentityDigest: d("credential-file"), executableIdentityDigest: d("executable"),
    authenticationModeDigest: d("auth-mode"),
  };
  const identity = credentialSourceIdentityDigest(stable);
  // Routine host re-authentication must not move the source key, so nothing
  // time-varying participates in it.
  assert.equal(credentialSourceIdentityDigest({ ...stable }), identity);
  // A substituted credential file or executable does move it.
  assert.notEqual(credentialSourceIdentityDigest({ ...stable, credentialFileIdentityDigest: d("other-file") }), identity);
  assert.notEqual(credentialSourceIdentityDigest({ ...stable, executableIdentityDigest: d("other-exe") }), identity);

  assert.throws(
    () => credentialSourceIdentityDigest({ ...stable, credentialFileIdentityDigest: null, executableIdentityDigest: null }),
    (error: unknown) => error instanceof HostSourceIdentityError && error.code === "HOST_SOURCE_IDENTITY_UNSTABLE",
  );
});

test("candidate reduction never chooses implicitly and the projection stays total", () => {
  const at = "2026-09-01T00:30:00.000Z";
  const candidate = {
    candidateMemberDigest: d("candidate"), sourceKind: "models-dev-route" as const,
    provider: "openrouter", model: "some-model", transport: "openrouter" as const,
    configuredRouteMemberDigest: null, adapterPackage: "@openrouter/ai-sdk-provider",
    adapterInstalled: true, conditionalPricing: false, unsupportedPriceMembers: [],
    cataloguePriceZero: true,
  };
  const source = (credentialSeed: string) => ({
    key: parseAccountSourceKey({ ...apiKey, credentialSourceIdentityDigest: d(credentialSeed) }),
    observation: null, hostIdentity: null, attempt: null, useAuthorization: null,
  });

  // Zero applicable sources is not-observed, never an optimistic default.
  const none = reduceCandidateSource(candidate, [], at);
  assert.equal(none.accountDisposition, "not-observed");
  assert.deepEqual(none.reasonCodes, ["ACCOUNT_SOURCE_NOT_OBSERVED"]);

  // Two competing applicable sources must refuse rather than pick by array
  // order, latency, price or provider preference.
  const conflicted = reduceCandidateSource(candidate, [source("one"), source("two")], at);
  assert.equal(conflicted.accountDisposition, "conflict-ineligible");
  assert.equal(conflicted.sourceConflictDisposition, "conflict-ineligible");
  assert.equal(conflicted.selected, null);

  // A mapping applies only when provider and transport both match; provider
  // alone would let an OpenRouter account speak for a direct-SDK route.
  const otherTransport = { ...candidate, transport: "direct-sdk" as const };
  assert.equal(reduceCandidateSource(otherTransport, [source("one")], at).applicableCount, 0);

  // Totality: every candidate receives exactly one disposition, in canonical
  // candidate order.
  const many = [candidate, { ...candidate, candidateMemberDigest: d("candidate-2") }, { ...candidate, candidateMemberDigest: d("candidate-3") }];
  const projected = projectCandidateDispositions(many, [], at);
  assert.equal(projected.length, many.length);
  assert.deepEqual([...projected].map((row) => row.candidateMemberDigest), [...many].map((row) => row.candidateMemberDigest).sort());
  for (const row of projected) assert.equal(row.economicsDisposition, "not-observed");
});

test("zero-paid requires every control to be explicitly disabled and every price member represented", () => {
  const at = "2026-09-01T00:30:00.000Z";
  const key = parseAccountSourceKey(apiKey);
  const observationOf = (overrides: Record<string, unknown>) => parseAccountObservation({
    schema: "urn:usf:account-observation:1", version: 1,
    accountSourceKeyDigest: accountSourceKeyDigest(key), acquisitionAuthorizationDigest: d("auth"),
    credentialSourceIdentityDigest: apiKey.credentialSourceIdentityDigest,
    accountSourceProtocolDigest: d("protocol"), responseMappingDigest: d("mapping"),
    observationFreshnessPolicyDigest: d("obs-freshness"), rawProviderResponseDigest: d("raw"),
    authenticatedAccountIdentityDigest: d("account"), transport: "openrouter", provider: "openrouter",
    controlPlaneIdentity: "https://openrouter.ai/api/v1/key",
    acquiredAt: "2026-09-01T00:00:00.000Z", providerCredentialExpiresAt: null,
    expiresAt: "2026-09-01T01:00:00.000Z", serviceTier: "free",
    entitlementDisposition: "entitled", paidUsageEnabled: false, automaticOverageEnabled: false,
    automaticTopUpEnabled: false, spendCap: null,
    quota: { limit: 100, remaining: 100, resetAt: null, availability: "available" },
    usage: { amount: null, currency: null, periodStartedAt: null, periodEndsAt: null },
    costDisposition: "zero-paid", verificationDisposition: "verified", nonClaims: [],
    ...overrides,
  });
  const candidate = {
    candidateMemberDigest: d("candidate"), sourceKind: "models-dev-route" as const,
    provider: "openrouter", model: "some-model", transport: "openrouter" as const,
    configuredRouteMemberDigest: null, adapterPackage: "@openrouter/ai-sdk-provider",
    adapterInstalled: true, conditionalPricing: false, unsupportedPriceMembers: [] as readonly string[],
    cataloguePriceZero: true,
  };
  const dispositionFor = (candidateOverrides: Record<string, unknown>, observation: unknown) => {
    const merged = { ...candidate, ...candidateOverrides };
    const sources = [{ key, observation, hostIdentity: null, attempt: null, useAuthorization: null }];
    return candidateDisposition(merged as never, reduceCandidateSource(merged as never, sources as never, at), at);
  };

  assert.equal(dispositionFor({}, observationOf({})).economicsDisposition, "zero-paid");

  const cases: readonly [string, Record<string, unknown>, Record<string, unknown>, string, string][] = [
    ["paid usage enabled", {}, { paidUsageEnabled: true }, "paid", "ACCOUNT_PAID_CONTROLS_ENABLED"],
    ["automatic overage enabled", {}, { automaticOverageEnabled: true }, "paid", "ACCOUNT_PAID_CONTROLS_ENABLED"],
    ["automatic top-up enabled", {}, { automaticTopUpEnabled: true }, "paid", "ACCOUNT_PAID_CONTROLS_ENABLED"],
    ["an unknown control", {}, { automaticTopUpEnabled: null }, "not-observed", "ACCOUNT_PAID_CONTROLS_UNKNOWN"],
    ["a conditional price", { conditionalPricing: true }, {}, "not-observed", "CATALOGUE_PRICE_COMPLETENESS_UNKNOWN"],
    ["an unrepresented price member", { unsupportedPriceMembers: ["cache_read"] }, {}, "not-observed", "CATALOGUE_PRICE_COMPLETENESS_UNKNOWN"],
    ["a non-zero catalogue price", { cataloguePriceZero: false }, {}, "not-observed", "CATALOGUE_PRICE_NOT_ZERO"],
    ["no entitlement", {}, { entitlementDisposition: "not-observed" }, "not-observed", "ACCOUNT_NOT_ENTITLED"],
    ["exhausted quota", {}, { quota: { limit: 100, remaining: 0, resetAt: null, availability: "exhausted" } }, "not-observed", "ACCOUNT_QUOTA_UNAVAILABLE"],
  ];
  for (const [label, candidateOverrides, observationOverrides, expected, reason] of cases) {
    const result = dispositionFor(candidateOverrides, observationOf(observationOverrides));
    assert.equal(result.economicsDisposition, expected, label);
    assert.ok(result.reasonCodes.includes(reason), `${label}: expected ${reason}, saw ${result.reasonCodes.join(",")}`);
    assert.notEqual(result.economicsDisposition, "zero-paid", label);
  }

  // An expired observation is not current evidence, whatever it says.
  assert.equal(dispositionFor({}, observationOf({})).economicsDisposition, "zero-paid");
  const expired = candidateDisposition(candidate as never, reduceCandidateSource(candidate as never, [{ key, observation: observationOf({}), hostIdentity: null, attempt: null, useAuthorization: null }] as never, "2026-09-01T02:00:00.000Z"), "2026-09-01T02:00:00.000Z");
  assert.equal(expired.economicsDisposition, "not-observed");
  assert.ok(expired.reasonCodes.includes("ACCOUNT_OBSERVATION_EXPIRED"));
});

test("economics buckets and list cursors bind their exact context", () => {
  const members = [d("a"), d("b"), d("c")];
  const buckets = economicsBuckets("route-model-economics-binding", members);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.memberCount, 0), members.length);
  for (const bucket of buckets) {
    assert.match(bucket.prefix, /^[0-9a-f]{2}$/u);
    for (const digest of bucket.members) assert.equal(candidatePrefix(digest), bucket.prefix);
  }

  const context = {
    projectionDigest: d("projection"), recordKind: "route-model-economics-binding" as const,
    aggregateRootDigest: d("root"), providerFilter: null, modelFilter: null,
    lastCandidateMemberDigest: d("last"),
  };
  const cursor = economicsListCursor(context);
  assert.equal(economicsListCursorMatches(cursor, context), true);
  // Any context movement must refuse the cursor rather than silently paginate
  // across two different denominators.
  for (const moved of [
    { ...context, projectionDigest: d("moved") },
    { ...context, aggregateRootDigest: d("moved") },
    { ...context, recordKind: "provider-route-disposition" as const },
    { ...context, providerFilter: "groq" },
  ]) assert.equal(economicsListCursorMatches(cursor, moved), false);
});
