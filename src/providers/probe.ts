import { canonicalDigest, sha256 } from "../core/canonical.ts";
import type { ProviderRouteConfig } from "./config.ts";
import { evaluateZeroPaidEconomics, type ZeroPaidEconomicsInput } from "./economics.ts";

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const canonicalInstant = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const labelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,191}$/;
const maximumTimeoutMs = 30_000;
const maximumRunAuthorizationTimeoutMs = 300_000;
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

export interface ProviderRawResponseCapture {
  readonly digest: `sha256:${string}`;
  readonly byteLength: number;
  readonly status: number;
}

async function readBoundedResponseBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^[0-9]+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new Error("PROVIDER_RESPONSE_LIMIT_EXCEEDED");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("PROVIDER_RESPONSE_LIMIT_EXCEEDED");
        throw new Error("PROVIDER_RESPONSE_LIMIT_EXCEEDED");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Enforce the exact provider transport boundary and replace its body with one
 * bounded immutable copy. The callback receives only a digest and byte count;
 * raw provider bytes never leave the child transport.
 */
export function createBoundedProviderFetch(
  endpoint: URL,
  delegate: typeof globalThis.fetch,
  maximumResponseBytes: number,
  capture: (observation: ProviderRawResponseCapture) => void,
): typeof globalThis.fetch {
  if (endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== ""
    || endpoint.search !== "" || endpoint.hash !== "" || !endpoint.pathname.endsWith("/")
    || !Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1 || maximumResponseBytes > 1_048_576) {
    throw new Error("PROVIDER_CHILD_INPUT_INVALID");
  }
  const fixed = constrainedFetch(endpoint, delegate);
  return async (input, init) => {
    const response = await fixed(input, init);
    const bytes = await readBoundedResponseBytes(response, maximumResponseBytes);
    capture(Object.freeze({ digest: providerRawResponseDigest(bytes), byteLength: bytes.byteLength, status: response.status }));
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
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
  const secureFetch = createBoundedProviderFetch(endpoint, request.fetch, 1_048_576, () => undefined);
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

export interface AdapterPreflightReceipt {
  readonly schema: "urn:usf:adapter-preflight-receipt:1";
  readonly version: 1;
  readonly routeMemberDigest: string;
  readonly adapterPackage: string;
  readonly adapterVersion: string;
  readonly adapterIntegrity: "pnpm-lock-integrity-bound";
  readonly adapterArtifactDigest: string;
  readonly childProtocolDigest: string;
  readonly fixedOriginDigest: string;
  readonly selectedCredentialName: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly status: "available" | "refused";
  readonly failureCode: string | null;
}

export interface RunAuthorization {
  readonly schema: "urn:usf:run-authorization:1";
  readonly version: 1;
  readonly routeMemberDigest: string;
  readonly candidateMemberDigest: string;
  readonly requestedModelIdentity: Readonly<{ family: string; provider: string; model: string }>;
  readonly accountSourceUseAuthorizationDigest: string;
  readonly accountObservationDigest: string;
  readonly routeModelEconomicsBindingDigest: string;
  readonly credentialSourceIdentityDigest: string;
  readonly adapterPreflightDigest: string;
  readonly profileDigest: string;
  readonly effectivePolicyDigest: string;
  readonly privacyProjectionDigest: string;
  readonly taskDigest: string;
  readonly promptOnlyProjectionDigest: string;
  readonly maximumInputBytes: number;
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly fallbackProhibited: true;
  readonly paidCostCeiling: "0";
  readonly authorizationDisposition: "authorized";
}

export interface ProviderAnswerObservation {
  readonly schema: "urn:usf:provider-answer-observation:1";
  readonly version: 1;
  readonly routeMemberDigest: string;
  readonly candidateMemberDigest: string;
  readonly requestedIdentity: Readonly<{ family: string; provider: string; model: string }>;
  readonly actualIdentity: Readonly<{ family: string; provider: string; model: string; sdkProvider: string }>;
  readonly accountObservationDigest: string;
  readonly routeModelEconomicsBindingDigest: string;
  readonly credentialSourceIdentityDigest: string;
  readonly adapterPreflightDigest: string;
  readonly runAuthorizationDigest: string;
  readonly promptOnlyProjectionDigest: string;
  readonly rawProviderResponseDigest: string;
  readonly sanitizedAnswer: string;
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
  readonly economics: Readonly<{ costDisposition: "zero-paid"; observedCostUsd: "0"; quota: "available" | "unknown" }>;
  readonly latency: Readonly<{ milliseconds: number }>;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly failureCode: null;
}

export interface RunAuthorizationExpectedBindings {
  readonly routeMemberDigest: string;
  readonly candidateMemberDigest: string;
  readonly requestedModelIdentity: RunAuthorization["requestedModelIdentity"];
  readonly accountSourceUseAuthorizationDigest: string;
  readonly accountObservationDigest: string;
  readonly routeModelEconomicsBindingDigest: string;
  readonly credentialSourceIdentityDigest: string;
  readonly adapterPreflightDigest: string;
  readonly profileDigest: string;
  readonly effectivePolicyDigest: string;
  readonly privacyProjectionDigest: string;
  readonly taskDigest: string;
  readonly promptOnlyProjectionDigest: string;
  readonly maximumInputBytes: number;
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
}

export interface ProviderChildEnvironmentInput {
  readonly credentialName: string;
  readonly credentialValue: string;
  readonly fixedOrigin: string;
  readonly home: string;
  readonly temporary: string;
  readonly maximumInputBytes: number;
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
}

export interface ProviderChildLaunch {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

const strictDigestPattern = /^sha256:[0-9a-f]{64}$/u;
const strictCredentialPattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const strictTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+~-]{0,191}$/u;
const strictAdapterPattern = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,95}|[a-z0-9][a-z0-9._-]{0,95})$/u;
const reservedChildEnvironmentNames = new Set([
  "HOME", "LANG", "LC_ALL", "PATH", "TMPDIR",
  "USF_PROVIDER_CHILD", "USF_PROVIDER_FIXED_ORIGIN", "USF_PROVIDER_MAXIMUM_INPUT_BYTES",
  "USF_PROVIDER_MAXIMUM_OUTPUT_TOKENS", "USF_PROVIDER_PAID_COST_CEILING",
  "USF_PROVIDER_TIMEOUT_MILLISECONDS",
]);

function strictRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("PROVIDER_RECORD_INVALID");
  return value as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("PROVIDER_RECORD_INVALID");
}

function strictDigestValue(value: unknown): string {
  if (typeof value !== "string" || !strictDigestPattern.test(value)) throw new Error("PROVIDER_RECORD_INVALID");
  return value;
}

function strictToken(value: unknown): string {
  if (typeof value !== "string" || !strictTokenPattern.test(value)) throw new Error("PROVIDER_RECORD_INVALID");
  return value;
}

function strictInstant(value: unknown): string {
  if (typeof value !== "string" || !canonicalInstant.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(Date.parse(value)).toISOString() !== value) throw new Error("PROVIDER_RECORD_INVALID");
  return value;
}

function strictPositiveInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) throw new Error("PROVIDER_RECORD_INVALID");
  return value as number;
}

function strictNonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("PROVIDER_RECORD_INVALID");
  return value as number;
}

function strictIdentity(value: unknown): Readonly<{ family: string; provider: string; model: string }> {
  const identity = strictRecord(value);
  strictKeys(identity, ["family", "provider", "model"]);
  return Object.freeze({ family: strictToken(identity.family), provider: strictToken(identity.provider), model: strictToken(identity.model) });
}

export const providerChildProtocolDigest = canonicalDigest({
  schema: "urn:usf:provider-child-protocol:1",
  version: 1,
  environment: "empty-allowlist-selected-credential-only",
  launch: "absolute-node-no-shell-die-with-parent",
  transport: "https-exact-origin-path-redirect-error-bounded-response-no-retries",
  output: "closed-sanitized-provider-answer-observation",
}, { rejectAbsolutePaths: true });

export function parseAdapterPreflightReceipt(value: unknown): AdapterPreflightReceipt {
  const receipt = strictRecord(value);
  strictKeys(receipt, [
    "schema", "version", "routeMemberDigest", "adapterPackage", "adapterVersion", "adapterIntegrity",
    "adapterArtifactDigest", "childProtocolDigest", "fixedOriginDigest", "selectedCredentialName",
    "observedAt", "expiresAt", "status", "failureCode",
  ]);
  if (receipt.schema !== "urn:usf:adapter-preflight-receipt:1" || receipt.version !== 1
    || receipt.adapterIntegrity !== "pnpm-lock-integrity-bound"
    || (receipt.status !== "available" && receipt.status !== "refused")) throw new Error("PROVIDER_RECORD_INVALID");
  const adapterPackage = typeof receipt.adapterPackage === "string" && strictAdapterPattern.test(receipt.adapterPackage)
    ? receipt.adapterPackage : (() => { throw new Error("PROVIDER_RECORD_INVALID"); })();
  const selectedCredentialName = typeof receipt.selectedCredentialName === "string" && strictCredentialPattern.test(receipt.selectedCredentialName)
    ? receipt.selectedCredentialName : (() => { throw new Error("PROVIDER_RECORD_INVALID"); })();
  const failureCode = receipt.failureCode === null ? null : strictToken(receipt.failureCode);
  if ((receipt.status === "available") !== (failureCode === null)) throw new Error("PROVIDER_RECORD_INVALID");
  const observedAt = strictInstant(receipt.observedAt);
  const expiresAt = strictInstant(receipt.expiresAt);
  if (Date.parse(observedAt) >= Date.parse(expiresAt)) throw new Error("PROVIDER_RECORD_INVALID");
  return Object.freeze({
    schema: "urn:usf:adapter-preflight-receipt:1", version: 1,
    routeMemberDigest: strictDigestValue(receipt.routeMemberDigest), adapterPackage,
    adapterVersion: strictToken(receipt.adapterVersion), adapterIntegrity: "pnpm-lock-integrity-bound",
    adapterArtifactDigest: strictDigestValue(receipt.adapterArtifactDigest),
    childProtocolDigest: strictDigestValue(receipt.childProtocolDigest),
    fixedOriginDigest: strictDigestValue(receipt.fixedOriginDigest), selectedCredentialName,
    observedAt, expiresAt, status: receipt.status, failureCode,
  });
}

export function adapterPreflightReceiptDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseAdapterPreflightReceipt(value), { rejectAbsolutePaths: true });
}

export function parseRunAuthorization(value: unknown): RunAuthorization {
  const authorization = strictRecord(value);
  strictKeys(authorization, [
    "schema", "version", "routeMemberDigest", "candidateMemberDigest", "requestedModelIdentity",
    "accountSourceUseAuthorizationDigest", "accountObservationDigest", "routeModelEconomicsBindingDigest",
    "credentialSourceIdentityDigest", "adapterPreflightDigest", "profileDigest", "effectivePolicyDigest",
    "privacyProjectionDigest", "taskDigest", "promptOnlyProjectionDigest", "maximumInputBytes",
    "maximumOutputTokens", "timeoutMilliseconds", "issuedAt", "expiresAt", "fallbackProhibited",
    "paidCostCeiling", "authorizationDisposition",
  ]);
  if (authorization.schema !== "urn:usf:run-authorization:1" || authorization.version !== 1
    || authorization.fallbackProhibited !== true || authorization.paidCostCeiling !== "0"
    || authorization.authorizationDisposition !== "authorized") throw new Error("PROVIDER_RECORD_INVALID");
  const issuedAt = strictInstant(authorization.issuedAt);
  const expiresAt = strictInstant(authorization.expiresAt);
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) throw new Error("PROVIDER_RECORD_INVALID");
  return Object.freeze({
    schema: "urn:usf:run-authorization:1", version: 1,
    routeMemberDigest: strictDigestValue(authorization.routeMemberDigest),
    candidateMemberDigest: strictDigestValue(authorization.candidateMemberDigest),
    requestedModelIdentity: strictIdentity(authorization.requestedModelIdentity),
    accountSourceUseAuthorizationDigest: strictDigestValue(authorization.accountSourceUseAuthorizationDigest),
    accountObservationDigest: strictDigestValue(authorization.accountObservationDigest),
    routeModelEconomicsBindingDigest: strictDigestValue(authorization.routeModelEconomicsBindingDigest),
    credentialSourceIdentityDigest: strictDigestValue(authorization.credentialSourceIdentityDigest),
    adapterPreflightDigest: strictDigestValue(authorization.adapterPreflightDigest),
    profileDigest: strictDigestValue(authorization.profileDigest),
    effectivePolicyDigest: strictDigestValue(authorization.effectivePolicyDigest),
    privacyProjectionDigest: strictDigestValue(authorization.privacyProjectionDigest),
    taskDigest: strictDigestValue(authorization.taskDigest),
    promptOnlyProjectionDigest: strictDigestValue(authorization.promptOnlyProjectionDigest),
    maximumInputBytes: strictPositiveInteger(authorization.maximumInputBytes, 1_048_576),
    maximumOutputTokens: strictPositiveInteger(authorization.maximumOutputTokens, 4_096),
    timeoutMilliseconds: strictPositiveInteger(authorization.timeoutMilliseconds, maximumRunAuthorizationTimeoutMs),
    issuedAt, expiresAt, fallbackProhibited: true, paidCostCeiling: "0", authorizationDisposition: "authorized",
  });
}

export function runAuthorizationDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseRunAuthorization(value), { rejectAbsolutePaths: true });
}

export function verifyRunAuthorization(value: unknown, expected: RunAuthorizationExpectedBindings, at: string): RunAuthorization {
  const authorization = parseRunAuthorization(value);
  const expectedAuthorization = parseRunAuthorization({
    ...authorization,
    routeMemberDigest: expected.routeMemberDigest,
    candidateMemberDigest: expected.candidateMemberDigest,
    requestedModelIdentity: expected.requestedModelIdentity,
    accountSourceUseAuthorizationDigest: expected.accountSourceUseAuthorizationDigest,
    accountObservationDigest: expected.accountObservationDigest,
    routeModelEconomicsBindingDigest: expected.routeModelEconomicsBindingDigest,
    credentialSourceIdentityDigest: expected.credentialSourceIdentityDigest,
    adapterPreflightDigest: expected.adapterPreflightDigest,
    profileDigest: expected.profileDigest,
    effectivePolicyDigest: expected.effectivePolicyDigest,
    privacyProjectionDigest: expected.privacyProjectionDigest,
    taskDigest: expected.taskDigest,
    promptOnlyProjectionDigest: expected.promptOnlyProjectionDigest,
    maximumInputBytes: expected.maximumInputBytes,
    maximumOutputTokens: expected.maximumOutputTokens,
    timeoutMilliseconds: expected.timeoutMilliseconds,
  });
  if (canonicalDigest(authorization) !== canonicalDigest(expectedAuthorization)) throw new Error("RUN_AUTHORIZATION_BINDING_MISMATCH");
  const observedAt = strictInstant(at);
  if (Date.parse(authorization.issuedAt) > Date.parse(observedAt) || Date.parse(observedAt) >= Date.parse(authorization.expiresAt)) {
    throw new Error("RUN_AUTHORIZATION_STALE");
  }
  return authorization;
}

export function parseProviderAnswerObservation(value: unknown): ProviderAnswerObservation {
  const observation = strictRecord(value);
  strictKeys(observation, [
    "schema", "version", "routeMemberDigest", "candidateMemberDigest", "requestedIdentity", "actualIdentity",
    "accountObservationDigest", "routeModelEconomicsBindingDigest", "credentialSourceIdentityDigest",
    "adapterPreflightDigest", "runAuthorizationDigest", "promptOnlyProjectionDigest", "rawProviderResponseDigest",
    "sanitizedAnswer", "usage", "economics", "latency", "acquiredAt", "expiresAt", "failureCode",
  ]);
  if (observation.schema !== "urn:usf:provider-answer-observation:1" || observation.version !== 1 || observation.failureCode !== null) {
    throw new Error("PROVIDER_RECORD_INVALID");
  }
  const requestedIdentity = strictIdentity(observation.requestedIdentity);
  const actualValue = strictRecord(observation.actualIdentity);
  strictKeys(actualValue, ["family", "provider", "model", "sdkProvider"]);
  const actualIdentity = Object.freeze({
    family: strictToken(actualValue.family),
    provider: strictToken(actualValue.provider),
    model: strictToken(actualValue.model),
    sdkProvider: strictToken(actualValue.sdkProvider),
  });
  const usageValue = strictRecord(observation.usage);
  strictKeys(usageValue, ["inputTokens", "outputTokens", "totalTokens"]);
  const usage = Object.freeze({
    inputTokens: strictNonnegativeInteger(usageValue.inputTokens),
    outputTokens: strictNonnegativeInteger(usageValue.outputTokens),
    totalTokens: strictNonnegativeInteger(usageValue.totalTokens),
  });
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) throw new Error("PROVIDER_RECORD_INVALID");
  const economicsValue = strictRecord(observation.economics);
  strictKeys(economicsValue, ["costDisposition", "observedCostUsd", "quota"]);
  if (economicsValue.costDisposition !== "zero-paid" || economicsValue.observedCostUsd !== "0"
    || (economicsValue.quota !== "available" && economicsValue.quota !== "unknown")) throw new Error("PROVIDER_RECORD_INVALID");
  const latencyValue = strictRecord(observation.latency);
  strictKeys(latencyValue, ["milliseconds"]);
  if (typeof latencyValue.milliseconds !== "number" || !Number.isFinite(latencyValue.milliseconds) || latencyValue.milliseconds < 0) {
    throw new Error("PROVIDER_RECORD_INVALID");
  }
  if (typeof observation.sanitizedAnswer !== "string" || observation.sanitizedAnswer.length < 1
    || Buffer.byteLength(observation.sanitizedAnswer, "utf8") > 1_048_576 || observation.sanitizedAnswer.includes("\u0000")) {
    throw new Error("PROVIDER_RECORD_INVALID");
  }
  const acquiredAt = strictInstant(observation.acquiredAt);
  const expiresAt = strictInstant(observation.expiresAt);
  if (Date.parse(acquiredAt) >= Date.parse(expiresAt)) throw new Error("PROVIDER_RECORD_INVALID");
  return Object.freeze({
    schema: "urn:usf:provider-answer-observation:1", version: 1,
    routeMemberDigest: strictDigestValue(observation.routeMemberDigest),
    candidateMemberDigest: strictDigestValue(observation.candidateMemberDigest),
    requestedIdentity, actualIdentity,
    accountObservationDigest: strictDigestValue(observation.accountObservationDigest),
    routeModelEconomicsBindingDigest: strictDigestValue(observation.routeModelEconomicsBindingDigest),
    credentialSourceIdentityDigest: strictDigestValue(observation.credentialSourceIdentityDigest),
    adapterPreflightDigest: strictDigestValue(observation.adapterPreflightDigest),
    runAuthorizationDigest: strictDigestValue(observation.runAuthorizationDigest),
    promptOnlyProjectionDigest: strictDigestValue(observation.promptOnlyProjectionDigest),
    rawProviderResponseDigest: strictDigestValue(observation.rawProviderResponseDigest),
    sanitizedAnswer: observation.sanitizedAnswer, usage,
    economics: Object.freeze({ costDisposition: "zero-paid", observedCostUsd: "0", quota: economicsValue.quota }),
    latency: Object.freeze({ milliseconds: latencyValue.milliseconds }), acquiredAt, expiresAt, failureCode: null,
  });
}

export function providerAnswerObservationDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseProviderAnswerObservation(value), { rejectAbsolutePaths: true });
}

export function providerRawResponseDigest(value: Uint8Array): `sha256:${string}` {
  if (value.byteLength > 1_048_576) throw new Error("PROVIDER_RESPONSE_LIMIT_EXCEEDED");
  return sha256(value);
}

function exactHttpsOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("PROVIDER_CHILD_INPUT_INVALID"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/"
    || url.search !== "" || url.hash !== "" || url.origin + "/" !== value) throw new Error("PROVIDER_CHILD_INPUT_INVALID");
  return url.origin;
}

export function buildProviderChildEnvironment(input: ProviderChildEnvironmentInput): Readonly<Record<string, string>> {
  if (!strictCredentialPattern.test(input.credentialName) || reservedChildEnvironmentNames.has(input.credentialName)
    || input.credentialValue.length < 1 || input.credentialValue.length > 8_192
    || input.credentialValue.includes("\u0000") || !input.home.startsWith("/") || !input.temporary.startsWith("/")
    || input.home.includes("\u0000") || input.temporary.includes("\u0000")) throw new Error("PROVIDER_CHILD_INPUT_INVALID");
  const fixedOrigin = exactHttpsOrigin(input.fixedOrigin);
  const maximumInput = strictPositiveInteger(input.maximumInputBytes, 1_048_576);
  const maximumOutput = strictPositiveInteger(input.maximumOutputTokens, 4_096);
  const timeout = strictPositiveInteger(input.timeoutMilliseconds, maximumRunAuthorizationTimeoutMs);
  return Object.freeze({
    [input.credentialName]: input.credentialValue,
    HOME: input.home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "",
    TMPDIR: input.temporary,
    USF_PROVIDER_CHILD: "1",
    USF_PROVIDER_FIXED_ORIGIN: fixedOrigin,
    USF_PROVIDER_MAXIMUM_INPUT_BYTES: String(maximumInput),
    USF_PROVIDER_MAXIMUM_OUTPUT_TOKENS: String(maximumOutput),
    USF_PROVIDER_PAID_COST_CEILING: "0",
    USF_PROVIDER_TIMEOUT_MILLISECONDS: String(timeout),
  });
}

export function buildProviderChildLaunch(
  nodeExecutable: string,
  childEntrypoint: string,
  environmentInput: ProviderChildEnvironmentInput,
): ProviderChildLaunch {
  if (!nodeExecutable.startsWith("/") || !childEntrypoint.startsWith("/") || nodeExecutable.includes("\u0000") || childEntrypoint.includes("\u0000")) {
    throw new Error("PROVIDER_CHILD_INPUT_INVALID");
  }
  return Object.freeze({
    executable: nodeExecutable,
    arguments: Object.freeze(["--permission", `--allow-fs-read=${childEntrypoint}`, "--", childEntrypoint, "--usf-provider-child-v1"]),
    environment: buildProviderChildEnvironment(environmentInput),
  });
}
