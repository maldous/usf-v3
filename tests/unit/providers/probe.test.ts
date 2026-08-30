import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalDigest } from "../../../src/core/canonical.ts";
import { classifyProbeQuotaHeaders, probeProvider } from "../../../src/providers/probe.ts";
import { parseZeroPaidEconomicsEvidence, zeroPaidEconomicsPieceDigest } from "../../../src/providers/economics.ts";
import type { ProviderRouteConfig } from "../../../src/providers/config.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";
import { availabilityExitCode } from "../../../src/commands/probe.ts";

const probeSchema = createJsonSchemaValidator(JSON.parse(readFileSync(new URL("../../../schemas/probe-result.schema.json", import.meta.url), "utf8")));

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const route: ProviderRouteConfig = { id: "groq-primary", family: "groq", provider: "groq", adapterPackage: "@ai-sdk/groq", credentialName: "GROQ_API_KEY", model: "qwen/qwen3.6-27b", capabilities: ["typescript"], privacy: ["public"], cost: "free-quota", entitlement: "free-quota", paidFallback: false, concurrency: 1, probeFreshnessSeconds: 900 };
const base = () => ({ route, adapterObservation: { package: route.adapterPackage, version: "4.0.34", lockDigest: digest("9") }, credential: "test-credential", catalogue: { rawDigest: digest("a"), normalizedDigest: digest("d") }, policy: { digest: digest("b"), maximumPaidCost: 0 as const, paidFallback: "prohibited" as const, unknownPrice: "ineligible" as const, acceptedCostClasses: ["local", "zero-price", "free-quota"] as const }, observedAt: "2026-08-30T00:00:00.000Z", timeoutMs: 500, entitlement: { providerId: "groq", requestedModelId: route.model, accountReferenceDigest: digest("f"), observedAt: "2026-08-30T00:00:00.000Z", evidence: economicsEvidence() }, monotonicNow: (() => { const values = [10, 11.25]; return () => values.shift() ?? 11.25; })() });
function economicsSource(kind: "official-terms" | "official-model-documentation" | "authenticated-account-observation", url: string) { return { kind, publisher: "Groq", pageTitle: "Groq official", sourceUrl: url, sourceDigest: digest("0"), checkedAt: "2026-08-29T23:55:00.000Z", expiresAt: "2026-08-30T00:30:00.000Z" }; }
function economicsQuota() { return { requestsPerMinute: 20, requestsPerDay: 1000, tokensPerMinute: 30000, tokensPerDay: null, remainingRequests: 19, remainingTokens: 25000, resetAt: "2026-08-30T00:01:00.000Z", resetCadence: "minute", availability: "available" }; }
function bindEconomics(value: unknown) {
  const normalized = structuredClone(parseZeroPaidEconomicsEvidence(value)) as Record<string, any>;
  for (const piece of [normalized.terms, normalized.model, normalized.account]) piece.source.sourceDigest = zeroPaidEconomicsPieceDigest(piece);
  return normalized;
}
function economicsEvidence() {
  const value = { terms: { providerId: "groq", economicsClass: "FREE_RATE_LIMITED", modelSpecific: false, paymentMethodRequired: false, automaticOverageDefault: false, source: economicsSource("official-terms", "https://console.groq.com/docs/rate-limits") }, model: { providerId: "groq", requestedModelId: route.model, economicsClass: "FREE_RATE_LIMITED", billingBasis: "NO_CHARGE_WITHIN_QUOTA", officiallyListedFree: true, promptPriceUsdPerMtok: null, outputPriceUsdPerMtok: null, requestPriceUsd: "0", quota: economicsQuota(), source: economicsSource("official-model-documentation", "https://console.groq.com/docs/models") }, account: { providerId: "groq", accountReferenceDigest: digest("f"), tierName: "Free", economicsClass: "FREE_RATE_LIMITED", eligibleModelIds: [route.model], paidUsageEnabled: false, automaticOverage: false, hardSpendCap: true, quota: economicsQuota(), remainingTrialCreditUsd: null, trialExpiresAt: null, source: economicsSource("authenticated-account-observation", "https://console.groq.com/account/export") } };
  return bindEconomics(value);
}
const accepted = async () => ({ markerMatched: true, actualProvider: "groq", actualModel: route.model, sdkProvider: "groq.chat", inputTokens: 4, outputTokens: 2, quota: "available" as const, observedCost: null });

test("probe is deterministic, bounded, and does not expose credential or completion", async () => {
  let options: unknown;
  const first = await probeProvider({ ...base(), invoke: async (request) => { options = request.providerOptions; return accepted(); } });
  const second = await probeProvider({ ...base(), invoke: accepted });
  assert.deepEqual(first, second);
  assert.equal(first.status, "ok");
  assert.equal(probeSchema.validate(first).valid, true);
  assert.equal(first.externalContact, true);
  assert.equal(first.cost.evidence, "entitlement");
  assert.equal(JSON.stringify(first).includes("test-credential"), false);
  assert.equal(first.limits.maxRetries, 0);
  assert.equal(first.limits.maxOutputTokens, 8);
  assert.equal(first.actual?.sdkProvider, "groq.chat");
  assert.equal(first.endpointOrigin, "https://api.groq.com");
  assert.equal(first.serviceTier, "on_demand");
  assert.deepEqual({ package: first.inputs.adapterPackage, version: first.inputs.adapterVersion, lockDigest: first.inputs.adapterLockDigest }, base().adapterObservation);
  assert.deepEqual(options, { groq: { serviceTier: "on_demand" } });
});

test("quota headers require positive request and token headroom", () => {
  assert.equal(classifyProbeQuotaHeaders({ "x-ratelimit-remaining-requests": "2", "x-ratelimit-remaining-tokens": "9" }), "available");
  assert.equal(classifyProbeQuotaHeaders({ "x-ratelimit-remaining-requests": "0", "x-ratelimit-remaining-tokens": "9" }), "exhausted");
  assert.equal(classifyProbeQuotaHeaders({ "x-ratelimit-remaining-requests-day": "2" }), "unknown");
  assert.equal(classifyProbeQuotaHeaders({ "x-ratelimit-remaining-tokens-minute": "9" }), "unknown");
});

test("zero-paid qualification fails closed before invoker on entitlement gaps", async () => {
  for (const [label, mutate, expected] of [
    ["missing", (value: ReturnType<typeof base>) => ({ ...value, entitlement: undefined }), "ENTITLEMENT_UNVERIFIED"],
    ["unknown", (value: ReturnType<typeof base>) => ({ ...value, entitlement: { ...value.entitlement, evidence: bindEconomics({ ...value.entitlement.evidence, account: { ...value.entitlement.evidence.account, quota: { ...value.entitlement.evidence.account.quota, availability: "unknown" as const } } }) } }), "ENTITLEMENT_QUOTA_UNKNOWN"],
    ["expired", (value: ReturnType<typeof base>) => ({ ...value, entitlement: { ...value.entitlement, evidence: { ...value.entitlement.evidence, account: { ...value.entitlement.evidence.account, source: { ...value.entitlement.evidence.account.source, expiresAt: "2026-08-29T23:59:00.000Z" } } } } }), "ENTITLEMENT_EXPIRED"],
  ] as const) {
    let called = false;
    const result = await probeProvider({ ...mutate(base()), invoke: async () => { called = true; return accepted(); } });
    assert.equal(result.reasonCode, expected, label);
    assert.equal(probeSchema.validate(result).valid, true, label);
    assert.equal(called, false, label);
    assert.equal(result.externalContact, false, label);
  }
});

test("identity and marker failures are sanitized while retaining requested and actual identities", async () => {
  const mismatch = await probeProvider({ ...base(), invoke: async () => ({ ...(await accepted()), actualModel: "other/model" }) });
  assert.equal(mismatch.reasonCode, "PROBE_ACTUAL_IDENTITY_MISMATCH");
  assert.equal(mismatch.actual?.model, "other/model");
  const marker = await probeProvider({ ...base(), invoke: async () => ({ ...(await accepted()), markerMatched: false }) });
  assert.equal(marker.reasonCode, "PROBE_MARKER_MISMATCH");
  const absent = await probeProvider({ ...base(), invoke: async () => ({ ...(await accepted()), actualModel: null }) });
  assert.equal(absent.reasonCode, "PROBE_ACTUAL_IDENTITY_MISMATCH");
  assert.equal(absent.actual, undefined);
});

test("invalid routes, paid fallback, and credentials cannot contact an invoker", async () => {
  for (const [value, expected] of [
    [{ ...base(), route: { ...route, paidFallback: true } }, "PAID_FALLBACK_PROHIBITED"],
    [{ ...base(), route: { ...route, cost: "paid" as const, entitlement: "paid" as const } }, "PROBE_COST_CLASS_INELIGIBLE"],
    [{ ...base(), credential: undefined }, "PROBE_CREDENTIAL_MISSING"],
    [{ ...base(), route: { ...route, provider: "router", adapterPackage: "router-sdk" }, adapterObservation: { ...base().adapterObservation, package: "router-sdk" } }, "PROBE_ROUTE_UNSUPPORTED"],
    [{ ...base(), route: { ...route, adapterPackage: "@ai-sdk/cerebras" }, adapterObservation: { ...base().adapterObservation, package: "@ai-sdk/cerebras" } }, "PROBE_ROUTE_UNSUPPORTED"],
    [{ ...base(), adapterObservation: { ...base().adapterObservation, package: "@ai-sdk/cerebras" } }, "PROBE_INPUT_INVALID"],
  ] as const) {
    let called = false;
    const result = await probeProvider({ ...value, invoke: async () => { called = true; return accepted(); } });
    assert.equal(result.reasonCode, expected);
    assert.equal(called, false);
  }
});

test("entitlement identity and observed nonzero cost fail closed", async () => {
  let called = false;
  const repointed = await probeProvider({
    ...base(),
    entitlement: { ...base().entitlement, requestedModelId: "other/model" },
    invoke: async () => { called = true; return accepted(); },
  });
  assert.equal(repointed.reasonCode, "ENTITLEMENT_UNVERIFIED");
  assert.equal(called, false);

  const charged = await probeProvider({
    ...base(),
    invoke: async () => ({ ...(await accepted()), observedCost: 0.01 }),
  });
  assert.equal(charged.reasonCode, "PROBE_COST_NONZERO");
  assert.equal(charged.cost.observedCost, 0.01);
});

test("availability reason classes map deterministically to stable exits", async () => {
  const noEligible = await probeProvider({ ...base(), route: { ...route, paidFallback: true }, invoke: accepted });
  const currentness = await probeProvider({ ...base(), entitlement: undefined, invoke: accepted });
  const external = await probeProvider({ ...base(), invoke: async () => ({ ...(await accepted()), markerMatched: false }) });
  assert.equal(availabilityExitCode(noEligible), 6);
  assert.equal(availabilityExitCode(currentness), 4);
  assert.equal(availabilityExitCode(external), 3);
});
