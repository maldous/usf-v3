import { canonicalDigest } from "../core/canonical.ts";
import type { ProviderRouteConfig } from "./config.ts";
import { evaluateZeroPaidEconomics, type ZeroPaidEconomicsInput } from "./economics.ts";

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const canonicalInstant = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const labelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,191}$/;
const maximumTimeoutMs = 30_000;
const maximumOutputTokens = 8;
const probePrompt = "Return exactly USF_PROBE_OK.";
const probePromptDigest = canonicalDigest({ purpose: "provider-capability-probe", prompt: probePrompt }, { rejectAbsolutePaths: true });

export type ProbeFailureReason =
  | "PROBE_ROUTE_UNSUPPORTED"
  | "PROBE_CREDENTIAL_MISSING"
  | "PROBE_INPUT_INVALID"
  | "PROBE_COST_CLASS_INELIGIBLE"
  | "PAID_FALLBACK_PROHIBITED"
  | "ENTITLEMENT_UNVERIFIED"
  | "ENTITLEMENT_EXPIRED"
  | "ENTITLEMENT_QUOTA_UNKNOWN"
  | "ENTITLEMENT_QUOTA_EXHAUSTED"
  | "PROBE_MARKER_MISMATCH"
  | "PROBE_ACTUAL_IDENTITY_MISMATCH"
  | "PROBE_TIMEOUT"
  | "PROBE_AUTHENTICATION_FAILED"
  | "PROBE_RATE_LIMITED"
  | "PROBE_PAYMENT_REQUIRED"
  | "PROBE_COST_NONZERO"
  | "PROBE_INVOCATION_FAILED";

export interface ProbeInvocationResult {
  /** The probe implementation checks text internally and returns only this boolean. */
  readonly markerMatched: boolean;
  readonly actualProvider: string | null;
  readonly actualModel: string | null;
  readonly sdkProvider: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly quota: "available" | "exhausted" | "unknown";
  readonly observedCost: number | null;
}

export interface ProbeInvocationRequest {
  readonly route: Pick<ProviderRouteConfig, "provider" | "model" | "adapterPackage">;
  readonly credential: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly prompt: string;
  readonly signal: AbortSignal;
  readonly fetch: typeof globalThis.fetch;
  readonly providerOptions: Readonly<Record<string, Readonly<{ readonly serviceTier: "on_demand" | "default" }>>>;
}

export type ProbeInvoker = (request: ProbeInvocationRequest) => Promise<ProbeInvocationResult>;

export interface ProviderProbeInput {
  readonly route: ProviderRouteConfig;
  /** Fresh local observation resolved immediately before the contact boundary. */
  readonly adapterObservation: Readonly<{
    readonly package: string;
    readonly version: string;
    readonly lockDigest: string;
  }>;
  /** Retrieved from an allowlisted CredentialEnvironment; never included in output. */
  readonly credential: string | undefined;
  readonly catalogue: Readonly<{ readonly rawDigest: string; readonly normalizedDigest: string }>;
  readonly policy: Readonly<{
    readonly digest: string;
    readonly maximumPaidCost: 0;
    readonly paidFallback: "prohibited";
    readonly unknownPrice: "ineligible";
    readonly acceptedCostClasses: readonly ("local" | "zero-price" | "free-quota")[];
  }>;
  readonly observedAt: string;
  readonly timeoutMs: number;
  /** Raw, untrusted economics facts; qualification is always recomputed here. */
  readonly entitlement?: ZeroPaidEconomicsInput;
  /** Injection point used by offline tests. The default is the direct SDK adapter only. */
  readonly invoke?: ProbeInvoker;
  /** Injection point for an origin-constrained network transport. */
  readonly fetch?: typeof globalThis.fetch;
  /** Monotonic clock injection for deterministic latency tests. */
  readonly monotonicNow?: () => number;
}

export interface ProviderProbeResult {
  readonly schema: "urn:usf:probe-result:1";
  readonly status: "ok" | "failed";
  readonly reasonCode?: ProbeFailureReason;
  readonly routeId: string;
  readonly endpointOrigin: string | null;
  readonly serviceTier: "on_demand" | "default" | null;
  readonly requested: Readonly<{ family: string; provider: string; model: string }>;
  readonly actual?: Readonly<{ family: string; provider: string; model: string; sdkProvider: string | null }>;
  readonly inputs: Readonly<{
    routeDigest: string;
    adapterPackage: string;
    adapterVersion: string;
    adapterLockDigest: string;
    catalogueRawDigest: string;
    catalogueNormalizedDigest: string;
    policyDigest: string;
    entitlementEvidenceDigest: string | null;
    probePromptDigest: string;
  }>;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly capabilityEvaluations: readonly Readonly<{
    capability: "text-generation";
    status: "available" | "unavailable" | "unknown";
    reasonCode: ProbeFailureReason | null;
  }>[];
  readonly quota: "available" | "exhausted" | "unknown";
  readonly health: "available" | "unavailable" | "unknown";
  readonly cost: Readonly<{ observedCost: number | null; currency: "USD" | null; evidence: "provider-reported" | "entitlement" | "unavailable" }>;
  readonly usage: Readonly<{ inputTokens: number | null; outputTokens: number | null }>;
  readonly latencyMs: number | null;
  readonly limits: Readonly<{ timeoutMs: number; maxRetries: 0; maxOutputTokens: 8 }>;
  /** True only after the direct adapter invoker was entered. */
  readonly externalContact: boolean;
  readonly authorityEffect: "none";
  readonly nonclaims: readonly string[];
  readonly resultDigest: string;
}

function validInstant(value: string): boolean {
  return canonicalInstant.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

function safeNonnegativeInteger(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeIdentityValue(value: string | null, credential: string): string | null {
  return value !== null && labelPattern.test(value) && !value.includes(credential) ? value : null;
}

function expectedEndpoint(provider: string): URL | undefined {
  if (provider === "groq") return new URL("https://api.groq.com/openai/v1/");
  if (provider === "cerebras") return new URL("https://api.cerebras.ai/v1/");
  return undefined;
}

function serviceTier(provider: string): "on_demand" | "default" | null {
  return provider === "groq" ? "on_demand" : provider === "cerebras" ? "default" : null;
}

/** Refuse redirects and any transport target outside the direct provider's fixed HTTPS origin. */
function constrainedFetch(endpoint: URL, delegate: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.protocol !== "https:" || url.origin !== endpoint.origin || !url.pathname.startsWith(endpoint.pathname)) {
      throw new Error("PROBE_TRANSPORT_ORIGIN_REFUSED");
    }
    return delegate(input, { ...init, redirect: "error" });
  };
}

/** Classify only enough remaining quota to prove that one further bounded call fits. */
export function classifyProbeQuotaHeaders(headers: Readonly<Record<string, string | undefined>>): "available" | "exhausted" | "unknown" {
  const numeric = (values: readonly (string | undefined)[]): number[] => values
    .flatMap((value) => value === undefined || !/^[0-9]+$/u.test(value) ? [] : [Number(value)]);
  const remainingRequests = numeric([
    headers["x-ratelimit-remaining-requests"],
    headers["x-ratelimit-remaining-requests-day"],
  ]);
  const remainingTokens = numeric([
    headers["x-ratelimit-remaining-tokens"],
    headers["x-ratelimit-remaining-tokens-minute"],
  ]);
  const remaining = [...remainingRequests, ...remainingTokens];
  if (remaining.some((value) => value === 0)) return "exhausted";
  return remainingRequests.length > 0 && remainingTokens.length > 0
    && remaining.every((value) => Number.isSafeInteger(value) && value > 0)
    ? "available"
    : "unknown";
}

async function directInvoke(request: ProbeInvocationRequest): Promise<ProbeInvocationResult> {
  const endpoint = expectedEndpoint(request.route.provider);
  if (endpoint === undefined) throw new Error("PROBE_ROUTE_UNSUPPORTED");
  // Adapter/runtime code is loaded only after the caller has completed every
  // local currentness, containment and zero-paid preflight.
  const { generateText } = await import("ai");
  const secureFetch = constrainedFetch(endpoint, request.fetch);
  const provider = request.route.provider === "groq"
    ? (await import("@ai-sdk/groq")).createGroq({ apiKey: request.credential, baseURL: endpoint.href.slice(0, -1), fetch: secureFetch })
    : (await import("@ai-sdk/cerebras")).createCerebras({ apiKey: request.credential, baseURL: endpoint.href.slice(0, -1), fetch: secureFetch });
  const model = provider(request.route.model);
  const response = await generateText({
    model,
    prompt: request.prompt,
    maxOutputTokens: request.maxOutputTokens,
    maxRetries: 0,
    providerOptions: request.providerOptions,
    abortSignal: request.signal,
    timeout: request.timeoutMs,
    telemetry: { isEnabled: false },
  });
  // Deliberately inspect and discard raw text; it must never reach a result, log or persistence path.
  const markerMatched = response.text.trim() === "USF_PROBE_OK";
  const usage = response.usage;
  const headers = response.response.headers ?? {};
  const quota = classifyProbeQuotaHeaders(headers);
  return {
    markerMatched,
    actualProvider: request.route.provider,
    // Requested identity is never substituted for an absent provider-reported
    // actual model.  The caller must fail closed when the response omits it.
    actualModel: response.response.modelId ?? null,
    sdkProvider: model.provider,
    inputTokens: safeNonnegativeInteger(usage.inputTokens ?? null),
    outputTokens: safeNonnegativeInteger(usage.outputTokens ?? null),
    quota,
    observedCost: null,
  };
}

function failureFrom(error: unknown): ProbeFailureReason {
  if (error instanceof DOMException && error.name === "AbortError") return "PROBE_TIMEOUT";
  if (typeof error === "object" && error !== null) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (status === 401 || status === 403) return "PROBE_AUTHENTICATION_FAILED";
    if (status === 402) return "PROBE_PAYMENT_REQUIRED";
    if (status === 429) return "PROBE_RATE_LIMITED";
  }
  return "PROBE_INVOCATION_FAILED";
}

function expiry(observedAt: string, seconds: number): string {
  return new Date(Date.parse(observedAt) + seconds * 1000).toISOString();
}

function buildResult(value: Omit<ProviderProbeResult, "resultDigest">): ProviderProbeResult {
  return Object.freeze({ ...value, resultDigest: canonicalDigest(value, { rejectAbsolutePaths: true }) });
}

function failed(input: ProviderProbeInput, reasonCode: ProbeFailureReason, entitlementDigest: string | null, expiresAt: string, externalContact = false, actual?: ProviderProbeResult["actual"], usage: ProviderProbeResult["usage"] = { inputTokens: null, outputTokens: null }, latencyMs: number | null = null, observedCost: number | null = null): ProviderProbeResult {
  // Even an invalid invocation must not produce a result that violates the
  // public result schema.  The sentinel says only that no valid observation
  // instant was accepted; the input digests still bind the refusal.
  const observedAt = validInstant(input.observedAt) ? input.observedAt : "1970-01-01T00:00:00.000Z";
  const safeExpiresAt = validInstant(expiresAt) ? expiresAt : observedAt;
  return buildResult({
    schema: "urn:usf:probe-result:1", status: "failed", reasonCode, routeId: input.route.id,
    endpointOrigin: expectedEndpoint(input.route.provider)?.origin ?? null, serviceTier: serviceTier(input.route.provider),
    requested: { family: input.route.family, provider: input.route.provider, model: input.route.model }, actual,
    inputs: {
      routeDigest: canonicalDigest(input.route, { rejectAbsolutePaths: true }),
      adapterPackage: input.adapterObservation.package,
      adapterVersion: input.adapterObservation.version,
      adapterLockDigest: input.adapterObservation.lockDigest,
      catalogueRawDigest: input.catalogue.rawDigest,
      catalogueNormalizedDigest: input.catalogue.normalizedDigest,
      policyDigest: input.policy.digest,
      entitlementEvidenceDigest: entitlementDigest,
      probePromptDigest,
    },
    observedAt, expiresAt: safeExpiresAt,
    capabilityEvaluations: Object.freeze([{ capability: "text-generation", status: externalContact ? "unavailable" : "unknown", reasonCode }]),
    quota: "unknown", health: "unavailable",
    cost: { observedCost, currency: observedCost === null ? null : "USD", evidence: observedCost === null ? "unavailable" : "provider-reported" }, usage, latencyMs,
    limits: { timeoutMs: input.timeoutMs, maxRetries: 0, maxOutputTokens: maximumOutputTokens }, externalContact, authorityEffect: "none",
    nonclaims: Object.freeze(["No raw prompt, completion, credential, provider error, pricing, quota balance, semantic authority, acceptance, proof, staging or production claim is emitted."]),
  });
}

/**
 * Execute one explicit, bounded direct-provider capability probe. This is not a
 * router and cannot make a route eligible without separate current entitlement evidence.
 */
export async function probeProvider(input: ProviderProbeInput): Promise<ProviderProbeResult> {
  const economics = input.entitlement === undefined ? null : evaluateZeroPaidEconomics(input.entitlement);
  const entitlementDigest = economics?.evidenceDigest ?? null;
  const routeDigest = canonicalDigest(input.route, { rejectAbsolutePaths: true });
  const routeEconomicsMismatch = input.entitlement !== undefined && (input.entitlement.providerId !== input.route.provider || input.entitlement.requestedModelId !== input.route.model);
  const probeExpiresAt = validInstant(input.observedAt) && Number.isSafeInteger(input.route.probeFreshnessSeconds) && input.route.probeFreshnessSeconds > 0
    ? expiry(input.observedAt, input.route.probeFreshnessSeconds)
    : input.observedAt;
  // The evaluator deliberately returns only a verified digest, not raw source
  // timestamps. Probe freshness remains bounded by the route configuration.
  const expiresAt = economics?.allowed && economics.validUntil !== null && validInstant(probeExpiresAt)
    ? new Date(Math.min(Date.parse(probeExpiresAt), Date.parse(economics.validUntil))).toISOString()
    : probeExpiresAt;
  if (!validInstant(input.observedAt) || !digestPattern.test(input.catalogue.rawDigest)
    || !digestPattern.test(input.catalogue.normalizedDigest) || !digestPattern.test(input.policy.digest)
    || input.adapterObservation.package !== input.route.adapterPackage
    || !labelPattern.test(input.adapterObservation.version)
    || !digestPattern.test(input.adapterObservation.lockDigest)
    || input.timeoutMs <= 0 || input.timeoutMs > maximumTimeoutMs || !Number.isSafeInteger(input.timeoutMs)) {
    return failed(input, "PROBE_INPUT_INVALID", entitlementDigest, expiresAt);
  }
  if (input.route.paidFallback) return failed(input, "PAID_FALLBACK_PROHIBITED", entitlementDigest, expiresAt);
  // The currently implemented direct adapters are quota-backed services. A
  // future exact-zero-price route needs its own catalogue-price preflight
  // facts rather than reusing a free-quota assertion.
  if (input.route.cost !== "free-quota" || input.route.entitlement !== "free-quota") return failed(input, "PROBE_COST_CLASS_INELIGIBLE", entitlementDigest, expiresAt);
  const acceptedCostClasses = input.policy.acceptedCostClasses;
  if (input.policy.maximumPaidCost !== 0 || input.policy.paidFallback !== "prohibited"
    || input.policy.unknownPrice !== "ineligible" || !Array.isArray(acceptedCostClasses)
    || new Set(acceptedCostClasses).size !== acceptedCostClasses.length
    || acceptedCostClasses.some((value) => !["local", "zero-price", "free-quota"].includes(value))
    || !acceptedCostClasses.includes(input.route.cost)) {
    return failed(input, "PROBE_INPUT_INVALID", entitlementDigest, expiresAt);
  }
  const exactAdapter = (input.route.provider === "groq" && input.route.adapterPackage === "@ai-sdk/groq")
    || (input.route.provider === "cerebras" && input.route.adapterPackage === "@ai-sdk/cerebras");
  if (expectedEndpoint(input.route.provider) === undefined || !exactAdapter) {
    return failed(input, "PROBE_ROUTE_UNSUPPORTED", entitlementDigest, expiresAt);
  }
  if (input.credential === undefined || input.credential.length === 0 || input.credential.length > 8192 || input.credential.includes("\u0000")) {
    return failed(input, "PROBE_CREDENTIAL_MISSING", entitlementDigest, expiresAt);
  }
  // No observation means no zero-paid conclusion. This deliberately applies to every remote route.
  if (routeEconomicsMismatch || economics === null || !economics.allowed) {
    const code = economics?.code;
    const mapped = code === "ZERO_PAID_EVIDENCE_STALE" ? "ENTITLEMENT_EXPIRED"
      : code === "ZERO_PAID_QUOTA_AVAILABILITY_UNKNOWN" || code === "ZERO_PAID_QUOTA_UNBOUNDED" ? "ENTITLEMENT_QUOTA_UNKNOWN"
      : code === "ZERO_PAID_QUOTA_EXHAUSTED" ? "ENTITLEMENT_QUOTA_EXHAUSTED" : "ENTITLEMENT_UNVERIFIED";
    return failed(input, mapped, entitlementDigest, expiresAt);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const started = monotonicNow();
  try {
    const invocation = await (input.invoke ?? directInvoke)({
      route: input.route, credential: input.credential, timeoutMs: input.timeoutMs, maxOutputTokens: maximumOutputTokens,
      prompt: probePrompt, signal: controller.signal, fetch: input.fetch ?? globalThis.fetch,
      providerOptions: input.route.provider === "groq"
        ? { groq: { serviceTier: "on_demand" } }
        : { cerebras: { serviceTier: "default" } },
    });
    const actualProvider = safeIdentityValue(invocation.actualProvider, input.credential);
    const actualModel = safeIdentityValue(invocation.actualModel, input.credential);
    const sdkProvider = safeIdentityValue(invocation.sdkProvider, input.credential);
    const actual = actualProvider !== null && actualModel !== null
      ? Object.freeze({ family: input.route.family, provider: actualProvider, model: actualModel, sdkProvider })
      : undefined;
    const usage = Object.freeze({ inputTokens: safeNonnegativeInteger(invocation.inputTokens), outputTokens: safeNonnegativeInteger(invocation.outputTokens) });
    const ended = monotonicNow();
    const latencyMs = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : null;
    const observedCost = typeof invocation.observedCost === "number" && Number.isFinite(invocation.observedCost) && invocation.observedCost >= 0 ? invocation.observedCost : null;
    if (observedCost !== null && observedCost !== 0) return failed(input, "PROBE_COST_NONZERO", entitlementDigest, expiresAt, true, actual, usage, latencyMs, observedCost);
    if (!invocation.markerMatched) return failed(input, "PROBE_MARKER_MISMATCH", entitlementDigest, expiresAt, true, actual, usage, latencyMs, observedCost);
    if (actual === undefined || actual.provider !== input.route.provider || actual.model !== input.route.model) return failed(input, "PROBE_ACTUAL_IDENTITY_MISMATCH", entitlementDigest, expiresAt, true, actual, usage, latencyMs, observedCost);
    if (invocation.quota !== "available") return failed(input, invocation.quota === "exhausted" ? "ENTITLEMENT_QUOTA_EXHAUSTED" : "ENTITLEMENT_QUOTA_UNKNOWN", entitlementDigest, expiresAt, true, actual, usage, latencyMs, observedCost);
    return buildResult({
      schema: "urn:usf:probe-result:1", status: "ok", routeId: input.route.id,
      endpointOrigin: expectedEndpoint(input.route.provider)?.origin ?? null, serviceTier: serviceTier(input.route.provider),
      requested: { family: input.route.family, provider: input.route.provider, model: input.route.model }, actual,
      inputs: {
        routeDigest: canonicalDigest(input.route, { rejectAbsolutePaths: true }),
        adapterPackage: input.adapterObservation.package,
        adapterVersion: input.adapterObservation.version,
        adapterLockDigest: input.adapterObservation.lockDigest,
        catalogueRawDigest: input.catalogue.rawDigest,
        catalogueNormalizedDigest: input.catalogue.normalizedDigest,
        policyDigest: input.policy.digest,
        entitlementEvidenceDigest: entitlementDigest,
        probePromptDigest,
      },
      observedAt: input.observedAt, expiresAt,
      capabilityEvaluations: Object.freeze([{ capability: "text-generation", status: "available", reasonCode: null }]),
      quota: "available", health: "available",
      cost: { observedCost, currency: observedCost === null ? null : "USD", evidence: observedCost === null ? "entitlement" : "provider-reported" }, usage, latencyMs,
      limits: { timeoutMs: input.timeoutMs, maxRetries: 0, maxOutputTokens: maximumOutputTokens }, externalContact: true, authorityEffect: "none",
      nonclaims: Object.freeze(["A bounded direct probe is not a token-reduction, parallelism, ANQR, staging, production, acceptance or terminal-proof claim." ]),
    });
  } catch (error) {
    return failed(input, failureFrom(error), entitlementDigest, expiresAt, true);
  } finally {
    clearTimeout(timeout);
  }
}

export { probePromptDigest };
