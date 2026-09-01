import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogueCostClass, classifyCatalogue, readinessLadder,
  type ClassificationInput,
} from "../../../src/providers/classification.ts";
import type { EffectiveCostPolicy, ExecutionEconomicAuthorization } from "../../../src/providers/execution-economics.ts";
import { deriveRouteUniverse, diversifyCandidates } from "../../../src/providers/route-universe.ts";
import type { AuthenticatedTransportCapability } from "../../../src/providers/transports.ts";

const policy: EffectiveCostPolicy = Object.freeze({
  maximumPaidCost: 0,
  paidFallback: "prohibited",
  unknownPrice: "ineligible",
  acceptedCostClasses: Object.freeze(["local", "zero-price", "free-quota", "subscription-included"]),
});

const groqAuthorization: ExecutionEconomicAuthorization = Object.freeze({
  transport: "vercel-ai-sdk", provider: "groq", entitlement: "free-quota",
  basis: "operator-declared-free-tier", maximumPaidCostUsd: 0,
  evidence: "documented free tier", sourceDocumentation: "https://example.invalid",
});

function model(id: string, input: number | null, output: number | null, capabilities: readonly string[] = ["reasoning"]) {
  return {
    route: { provider: "p", model: id },
    underlying: { family: "f", model: id },
    capabilityNames: capabilities,
    cost: input === null ? {} : { input, output, currency: "USD", unit: "per-million-tokens" },
    limits: { context: 100_000, output: 8_000, input: null },
  };
}

function snapshot(providers: readonly unknown[]) {
  return {
    schema: "urn:usf:model-catalogue:1",
    source: "models.dev/api.json",
    rawDigest: `sha256:${"a".repeat(64)}`,
    normalizedDigest: `sha256:${"b".repeat(64)}`,
    providers,
    denominators: {},
    nonclaims: [],
  } as unknown as ClassificationInput["snapshot"];
}

function input(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    snapshot: snapshot([{
      providerRoute: "groq", name: "Groq",
      adapter: { package: "@ai-sdk/groq", installedVersion: "1" },
      credentialNames: ["GROQ_API_KEY"],
      models: [model("m-priced", 0.6, 3)],
    }]),
    installedAdapterPackages: ["@ai-sdk/groq"],
    suppliedCredentialNames: ["GROQ_API_KEY"],
    authorizations: [groqAuthorization],
    policy,
    requirement: { requiredCapabilities: [], minimumContextTokens: null, minimumOutputTokens: null },
    observedAvailableRouteIds: [],
    ...overrides,
  } as ClassificationInput;
}

test("the readiness ladder is ordered and fails closed at each boundary", () => {
  assert.deepEqual(readinessLadder, [
    "DISCOVERED", "TRANSPORT_SUPPORTED", "AUTHENTICATED",
    "ECONOMICALLY_ELIGIBLE", "ROUTABLE", "AVAILABLE",
  ]);
  // No installed adapter stops at DISCOVERED even though a credential exists.
  const noAdapter = classifyCatalogue(input({ installedAdapterPackages: [] }));
  assert.equal(noAdapter.classifications[0]?.state, "DISCOVERED");
  assert.equal(noAdapter.classifications[0]?.reason, "TRANSPORT_ADAPTER_NOT_INSTALLED");
  // No credential stops at TRANSPORT_SUPPORTED.
  const noCredential = classifyCatalogue(input({ suppliedCredentialNames: [] }));
  assert.equal(noCredential.classifications[0]?.state, "TRANSPORT_SUPPORTED");
  assert.equal(noCredential.classifications[0]?.reason, "CREDENTIAL_ABSENT");
  // No authorization for a priced model stops at AUTHENTICATED.
  const noAuthorization = classifyCatalogue(input({ authorizations: [] }));
  assert.equal(noAuthorization.classifications[0]?.state, "AUTHENTICATED");
  assert.equal(noAuthorization.classifications[0]?.reason, "ECONOMICS_COST_CLASS_REFUSED");
});

test("a priced model is eligible only under an explicit authorization", () => {
  const authorized = classifyCatalogue(input());
  assert.equal(authorized.classifications[0]?.state, "ROUTABLE");
  assert.equal(authorized.classifications[0]?.costClass, "priced");
  // The economic basis is recorded separately from the catalogue list price.
  assert.equal(authorized.classifications[0]?.economicBasis, "operator-declared-free-tier");
});

test("a catalogue zero price is eligible with no authorization, unknown price never is", () => {
  const zero = classifyCatalogue(input({
    authorizations: [],
    snapshot: snapshot([{
      providerRoute: "openrouter", name: "OpenRouter",
      adapter: { package: "@openrouter/ai-sdk-provider", installedVersion: "1" },
      credentialNames: ["OPENROUTER_API_KEY"],
      models: [model("free-model", 0, 0), model("priced-model", 1.5, 6), model("unknown-model", null, null)],
    }]),
    installedAdapterPackages: ["@openrouter/ai-sdk-provider"],
    suppliedCredentialNames: ["OPENROUTER_API_KEY"],
  }));
  const byModel = new Map(zero.classifications.map((entry) => [entry.model, entry]));
  assert.equal(byModel.get("free-model")?.state, "ROUTABLE");
  assert.equal(byModel.get("free-model")?.economicBasis, "catalogue-declared-zero-price");
  // OpenRouter's paid-credit economics are refused, never generalized away.
  assert.equal(byModel.get("priced-model")?.state, "AUTHENTICATED");
  assert.equal(byModel.get("priced-model")?.reason, "ECONOMICS_COST_CLASS_REFUSED");
  assert.equal(byModel.get("unknown-model")?.state, "AUTHENTICATED");
  assert.equal(byModel.get("unknown-model")?.reason, "ECONOMICS_COST_CLASS_REFUSED");
});

test("catalogue cost classification treats absent or partial pricing as unknown", () => {
  assert.equal(catalogueCostClass({ input: 0, output: 0 }), "zero-price");
  assert.equal(catalogueCostClass({ input: 1, output: 0 }), "priced");
  assert.equal(catalogueCostClass({ input: 0 }), "unknown");
  assert.equal(catalogueCostClass({}), "unknown");
  assert.equal(catalogueCostClass(null), "unknown");
});

test("capability and limit requirements gate ROUTABLE without touching economics", () => {
  const missing = classifyCatalogue(input({
    requirement: { requiredCapabilities: ["vision"], minimumContextTokens: null, minimumOutputTokens: null },
  }));
  assert.equal(missing.classifications[0]?.state, "ECONOMICALLY_ELIGIBLE");
  assert.equal(missing.classifications[0]?.reason, "CAPABILITY_MISSING");
  const context = classifyCatalogue(input({
    requirement: { requiredCapabilities: [], minimumContextTokens: 1_000_000, minimumOutputTokens: null },
  }));
  assert.equal(context.classifications[0]?.reason, "CONTEXT_LIMIT_INSUFFICIENT");
  const output = classifyCatalogue(input({
    requirement: { requiredCapabilities: [], minimumContextTokens: null, minimumOutputTokens: 100_000 },
  }));
  assert.equal(output.classifications[0]?.reason, "OUTPUT_LIMIT_INSUFFICIENT");
});

test("classification is deterministic and independent of catalogue order", () => {
  const providers = [
    { providerRoute: "zeta", name: "Z", adapter: { package: "@ai-sdk/groq", installedVersion: "1" }, credentialNames: ["GROQ_API_KEY"], models: [model("b", 0, 0)] },
    { providerRoute: "alpha", name: "A", adapter: { package: "@ai-sdk/groq", installedVersion: "1" }, credentialNames: ["GROQ_API_KEY"], models: [model("a", 0, 0)] },
  ];
  const forward = classifyCatalogue(input({ snapshot: snapshot(providers), authorizations: [] }));
  const reversed = classifyCatalogue(input({ snapshot: snapshot([...providers].reverse()), authorizations: [] }));
  assert.equal(forward.summary.classificationDigest, reversed.summary.classificationDigest);
  assert.deepEqual(forward.classifications.map((entry) => entry.provider), ["alpha", "zeta"]);
});

test("AVAILABLE requires a durable successful invocation record", () => {
  const routable = classifyCatalogue(input());
  assert.equal(routable.classifications[0]?.state, "ROUTABLE");
  const available = classifyCatalogue(input({ observedAvailableRouteIds: ["groq:m-priced"] }));
  assert.equal(available.classifications[0]?.state, "AVAILABLE");
});

function capability(transport: "claude-cli" | "codex-cli", usable: boolean): AuthenticatedTransportCapability {
  return Object.freeze({
    schema: "urn:usf:authenticated-transport-capability:1",
    transport, authenticationKind: "local-agent-session",
    usable, reason: usable ? null : "SESSION_MATERIAL_ABSENT",
    credentialName: null, executablePath: usable ? "/usr/bin/x" : null, executableVersion: null,
    observedAt: new Date().toISOString(), nonClaims: [],
  }) as AuthenticatedTransportCapability;
}

test("a local agent transport is admitted only when authenticated and authorized", () => {
  const base = {
    ...input({ authorizations: [] }),
    localAgentCapabilities: [capability("claude-cli", true)],
  };
  // Authenticated but with no operator authorization: refused.
  const unauthorized = deriveRouteUniverse(base);
  assert.equal(unauthorized.localAgentDispositions[0]?.admitted, false);
  assert.equal(unauthorized.localAgentDispositions[0]?.reason, "ECONOMICS_AUTHORIZATION_ABSENT");
  assert.equal(unauthorized.candidates.some((entry) => entry.transport === "claude-cli"), false);

  const subscription: ExecutionEconomicAuthorization = Object.freeze({
    transport: "claude-cli", provider: "claude-cli", entitlement: "subscription-included",
    basis: "operator-declared-subscription", maximumPaidCostUsd: 0,
    evidence: "operator subscription", sourceDocumentation: "https://example.invalid",
  });
  const authorized = deriveRouteUniverse({ ...base, authorizations: [subscription] });
  assert.equal(authorized.localAgentDispositions[0]?.admitted, true);
  const candidate = authorized.candidates.find((entry) => entry.transport === "claude-cli");
  assert.equal(candidate?.costClass, "subscription-included");
  // A local agent transport resolves its own model; none is asserted for it.
  assert.equal(candidate?.model, null);

  // Unauthenticated session is refused even with the authorization present.
  const unauthenticated = deriveRouteUniverse({
    ...base, authorizations: [subscription], localAgentCapabilities: [capability("claude-cli", false)],
  });
  assert.equal(unauthenticated.localAgentDispositions[0]?.admitted, false);
  assert.equal(unauthenticated.localAgentDispositions[0]?.reason, "TRANSPORT_SESSION_MATERIAL_ABSENT");
});

test("diversification interleaves providers so one quota cannot absorb every unit", () => {
  const candidates = [
    { candidateId: "a1", provider: "alpha" }, { candidateId: "a2", provider: "alpha" },
    { candidateId: "b1", provider: "beta" }, { candidateId: "c1", provider: "gamma" },
  ] as unknown as Parameters<typeof diversifyCandidates>[0];
  const first = diversifyCandidates(candidates, 0).map((entry) => entry.provider);
  assert.deepEqual(first, ["alpha", "beta", "gamma", "alpha"]);
  // A different unit ordinal starts on a different provider.
  const second = diversifyCandidates(candidates, 1).map((entry) => entry.provider);
  assert.equal(second[0], "beta");
  assert.equal(diversifyCandidates([], 0).length, 0);
});

test("a model that cannot emit text is not a candidate for text work", () => {
  const withModalities = (id: string, output: readonly string[] | null) => ({
    ...model(id, 0, 0),
    ...(output === null ? {} : { modalities: { input: ["text"], output } }),
  });
  const providers = [{
    providerRoute: "groq", name: "G", adapter: { package: "@ai-sdk/groq", installedVersion: "1" },
    credentialNames: ["GROQ_API_KEY"],
    models: [withModalities("text-model", ["text"]), withModalities("audio-model", ["audio"]),
      // A music model declares text among its outputs and returns lyrics.
      withModalities("song-model", ["audio", "text"]), withModalities("undeclared-model", null)],
  }];
  const universe = deriveRouteUniverse({
    ...input({ snapshot: snapshot(providers), authorizations: [] }),
    localAgentCapabilities: [],
  });
  const models = universe.candidates.map((entry) => entry.model).sort();
  // An audio route is excluded; an undeclared modality is not a disqualification.
  assert.deepEqual(models, ["text-model", "undeclared-model"]);
});
