import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
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
  accountBasis: "trial", permittedCostClasses: Object.freeze(["priced", "zero-price"]),
  paidSpendPermitted: false,
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
    qualifiedTaskClassesByRoute: new Map<string, readonly string[]>(),
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

test("a catalogue price authorizes nothing, and permission is per authorized account", () => {
  const openrouterModels = [model("free-model", 0, 0), model("priced-model", 1.5, 6), model("unknown-model", null, null)];
  const openrouterSnapshot = snapshot([{
    providerRoute: "openrouter", name: "OpenRouter",
    adapter: { package: "@openrouter/ai-sdk-provider", installedVersion: "1" },
    credentialNames: ["OPENROUTER_API_KEY"],
    models: openrouterModels,
  }]);
  const base = {
    snapshot: openrouterSnapshot,
    installedAdapterPackages: ["@openrouter/ai-sdk-provider"],
    suppliedCredentialNames: ["OPENROUTER_API_KEY"],
  };

  // Undeclared. A zero catalogue price used to admit this provider on its own,
  // which is how 21 of 45 routable candidates came to belong to no declared
  // authorization at all. Price is a property of a model; permission is a
  // statement about an account, and it is now required.
  const undeclared = classifyCatalogue(input({ ...base, authorizations: [] }));
  const undeclaredByModel = new Map(undeclared.classifications.map((entry) => [entry.model, entry]));
  assert.equal(undeclaredByModel.get("free-model")?.state, "AUTHENTICATED");
  assert.equal(undeclaredByModel.get("free-model")?.reason, "ECONOMICS_AUTHORIZATION_ABSENT");
  assert.notEqual(undeclaredByModel.get("free-model")?.economicBasis, "catalogue-declared-zero-price");
  assert.equal(undeclaredByModel.get("priced-model")?.reason, "ECONOMICS_COST_CLASS_REFUSED");
  assert.equal(undeclaredByModel.get("unknown-model")?.reason, "ECONOMICS_COST_CLASS_REFUSED");

  // Declared, on a prepaid account permitted only for free routes. The three
  // models then separate on three different reasons, which is the whole point of
  // splitting authorization from spend permission.
  const prepaid: ExecutionEconomicAuthorization = Object.freeze({
    transport: "vercel-ai-sdk", provider: "openrouter", entitlement: "free-quota",
    basis: "operator-declared-prepaid-account", maximumPaidCostUsd: 0,
    evidence: "operator-declared prepaid balance, free routes only",
    sourceDocumentation: "https://example.invalid",
    accountBasis: "prepaid", permittedCostClasses: Object.freeze(["zero-price"]),
    paidSpendPermitted: false,
  });
  const declared = classifyCatalogue(input({ ...base, authorizations: [prepaid] }));
  const declaredByModel = new Map(declared.classifications.map((entry) => [entry.model, entry]));
  assert.equal(declaredByModel.get("free-model")?.state, "ROUTABLE");
  assert.equal(declaredByModel.get("free-model")?.economicBasis, "operator-declared-prepaid-account");
  // Authorized, but this account may not be used for a priced model.
  assert.equal(declaredByModel.get("priced-model")?.state, "AUTHENTICATED");
  assert.equal(declaredByModel.get("priced-model")?.reason, "ECONOMICS_COST_CLASS_NOT_PERMITTED");
  // An unknown price may be a paid one, so an account that may not spend may not
  // reach it, and that is a different refusal from a class it merely lacks.
  assert.equal(declaredByModel.get("unknown-model")?.state, "AUTHENTICATED");
  assert.equal(declaredByModel.get("unknown-model")?.reason, "ECONOMICS_PAID_SPEND_REFUSED");

  // Widening is an explicit declaration and nothing else changes to permit it.
  const widened = classifyCatalogue(input({
    ...base,
    authorizations: [Object.freeze({ ...prepaid, permittedCostClasses: Object.freeze(["priced", "zero-price"]) })],
  }));
  const widenedByModel = new Map(widened.classifications.map((entry) => [entry.model, entry]));
  assert.equal(widenedByModel.get("priced-model")?.state, "ROUTABLE");
  assert.equal(widenedByModel.get("unknown-model")?.reason, "ECONOMICS_PAID_SPEND_REFUSED");
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
    qualifiedTaskClassesByRoute: new Map<string, readonly string[]>(),
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
    accountBasis: "subscription", permittedCostClasses: Object.freeze(["subscription-included"]),
    paidSpendPermitted: false,
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
    // Authorized explicitly: the subject here is output modality, and a zero
    // catalogue price no longer stands in for permission.
    ...input({ snapshot: snapshot(providers), authorizations: [groqAuthorization] }),
    localAgentCapabilities: [],
    qualifiedTaskClassesByRoute: new Map<string, readonly string[]>(),
  });
  const models = universe.candidates.map((entry) => entry.model).sort();
  // An audio route is excluded; an undeclared modality is not a disqualification.
  assert.deepEqual(models, ["text-model", "undeclared-model"]);
});

test("candidate order prefers what a route has produced, keeping provider spread", () => {
  const candidate = (provider: string, model: string) => ({
    candidateId: `vercel-ai-sdk:${provider}:${model}`, transport: "vercel-ai-sdk" as const,
    provider, model, adapterPackage: "@ai-sdk/x", credentialName: "K", baseUrl: null,
    costClass: "zero-price", economicBasis: null, capabilityNames: [] as readonly string[],
    contextLimit: 100_000, outputLimit: 8_000, state: "ROUTABLE" as const,
  });
  const pool = [candidate("groq", "a-useless"), candidate("groq", "z-perfect"), candidate("mistral", "m")];
  const observed = new Map([
    // Measured: a perfect route sat behind a 9% one purely on name order.
    ["vercel-ai-sdk:groq:a-useless", { attempts: 289, successes: 27, successRate: 27 / 289, meanLatencyMs: 327 }],
    ["vercel-ai-sdk:groq:z-perfect", { attempts: 16, successes: 16, successRate: 1, meanLatencyMs: 27_000 }],
  ]);

  const ordered = diversifyCandidates(pool, 0, observed).map((entry) => entry.candidateId);
  // Within groq the productive route now leads despite sorting last by name.
  assert.ok(ordered.indexOf("vercel-ai-sdk:groq:z-perfect") < ordered.indexOf("vercel-ai-sdk:groq:a-useless"));
  // Provider round-robin still holds: mistral is not pushed behind both groqs.
  assert.equal(ordered[1], "vercel-ai-sdk:mistral:m");

  // With no history at all the order is stable and name-based, so a fresh pool
  // is not implicitly ranked by anything.
  const fresh = diversifyCandidates(pool, 0, new Map()).map((entry) => entry.candidateId);
  assert.equal(fresh[0], "vercel-ai-sdk:groq:a-useless");
});

test("a reserved model cannot enter the pool through a permitted host-agent transport", async () => {
  const { readProviderExecutionPolicy, permitsExecution } =
    await import("../../../src/providers/provider-policy.ts");
  const { loadSemanticGraph } = await import("../../../src/graph/index.ts");
  const root = resolve(import.meta.dirname, "..", "..", "..");
  const policy = readProviderExecutionPolicy(loadSemanticGraph(root, "graph/manifests/v3-execution.json"));

  // The antigravity subscription serves Claude models alongside its own. The
  // transport is permitted, so reservation has to hold at the model, in both
  // the CLI's identifier form and its display form.
  for (const model of ["claude-sonnet-4-6", "claude-opus-4-6-thinking", "Claude Sonnet 4.6 (Thinking)"]) {
    const decision = permitsExecution(policy, { transport: "antigravity-cli", provider: "antigravity-cli", model });
    assert.equal(decision.permitted, false, `${model} must be refused`);
    assert.equal(decision.matchedOn, "model");
  }
  // Its non-Claude models remain usable, so the reservation is not a blanket ban.
  for (const model of ["gemini-3.7-flash-low", "gpt-oss-120b-medium"]) {
    assert.equal(permitsExecution(policy, { transport: "antigravity-cli", provider: "antigravity-cli", model }).permitted, true);
  }
  // And every declared model of that transport is one the policy permits.
  const { readProviderBindings } = await import("../../../src/providers/provider-bindings.ts");
  const declared = readProviderBindings(loadSemanticGraph(root, "graph/manifests/v3-execution.json"))
    .transportSelectedModel.get("antigravity-cli") ?? [];
  assert.ok(declared.length > 1, "several models are declared so one exhausted quota is not the whole subscription");
  for (const model of declared) {
    assert.equal(permitsExecution(policy, { transport: "antigravity-cli", provider: "antigravity-cli", model }).permitted,
      true, `declared model ${model} must be permitted`);
  }
});

test("the operator's own Claude session is toggleable; paid Claude routes are not", async () => {
  const { readProviderExecutionPolicy, permitsExecution } =
    await import("../../../src/providers/provider-policy.ts");
  const { canonicalQuadLine } = await import("../../../src/graph/nquads.ts");
  const E = "urn:usf:graph:v3-execution";
  const P = "urn:usf:predicate:";
  const graphOf = (quads: readonly unknown[]) =>
    Object.freeze({ quads: Object.freeze([...quads]) }) as never;
  const q = (subject: string, predicate: string, object: string, kind: "iri" | "literal" = "literal") => {
    const built = { subject, predicate, object, objectKind: kind, graph: E, canonical: "" };
    built.canonical = canonicalQuadLine(built);
    return built;
  };
  const oauth = "urn:usf:provider-execution-policy:operator-reserved-claude-oauth:1";
  const paid = "urn:usf:provider-execution-policy:operator-reserved-claude-api:1";
  const build = (active: string | null) => graphOf([
    q(oauth, `${P}type`, "urn:usf:type:ProviderExecutionPolicy", "iri"),
    q(oauth, `${P}reservedTransport`, "urn:usf:execution-transport:claude-cli", "iri"),
    ...(active === null ? [] : [q(oauth, `${P}policyActive`, active)]),
    q(paid, `${P}type`, "urn:usf:type:ProviderExecutionPolicy", "iri"),
    q(paid, `${P}reservedProvider`, "anthropic"),
    q(paid, `${P}reservedModelPrefix`, "anthropic/"),
  ]);
  const check = (active: string | null) => {
    const policy = readProviderExecutionPolicy(build(active));
    return {
      session: permitsExecution(policy, { transport: "claude-cli", provider: "claude-cli", model: null }).permitted,
      api: permitsExecution(policy, { transport: "vercel-ai-sdk", provider: "anthropic", model: "claude-opus-4" }).permitted,
      market: permitsExecution(policy, { transport: "vercel-ai-sdk", provider: "openrouter", model: "anthropic/claude-sonnet-4" }).permitted,
    };
  };

  // Default and explicit-true both reserve everything.
  assert.deepEqual(check(null), { session: false, api: false, market: false });
  assert.deepEqual(check("true"), { session: false, api: false, market: false });

  // Toggling admits only the operator's own session. The paid routes carry cost
  // this repository has not authorised, so they are not part of the switch.
  assert.deepEqual(check("false"), { session: true, api: false, market: false });

  // Fail safe: anything that is not exactly "false" keeps the reservation, so a
  // malformed or half-written value can never quietly admit the supervisor.
  for (const malformed of ["FALSE", "no", "0", "", "disabled"]) {
    assert.equal(check(malformed).session, false, `${malformed} must not lift the reservation`);
  }
});
