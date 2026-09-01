import { canonicalDigest } from "../core/canonical.ts";
import type { ModelCatalogueSnapshot } from "./catalogue.ts";
import {
  evaluateExecutionEconomics,
  type EconomicEligibilityCode, type EffectiveCostPolicy, type ExecutionEconomicAuthorization,
} from "./execution-economics.ts";
import { permitsExecution as policyDecision } from "./provider-policy.ts";
import type { ExecutionTransportId } from "./transports.ts";

/**
 * A model's presence in the catalogue never implies USF can execute it. Every
 * discovered model is classified deterministically through an ordered ladder,
 * failing closed at each boundary and recording exactly where it stopped.
 */
export const readinessLadder = Object.freeze([
  "DISCOVERED",
  "TRANSPORT_SUPPORTED",
  "AUTHENTICATED",
  "ECONOMICALLY_ELIGIBLE",
  "ROUTABLE",
  "AVAILABLE",
] as const);

export type ReadinessState = (typeof readinessLadder)[number];

export type ClassificationReason =
  | "TRANSPORT_UNKNOWN_ADAPTER"
  | "TRANSPORT_ADAPTER_NOT_INSTALLED"
  | "PROVIDER_ENDPOINT_UNDECLARED"
  | "POLICY_OPERATOR_RESERVED"
  | "POLICY_DISABLED"
  | "CREDENTIAL_NAME_UNDECLARED"
  | "CREDENTIAL_ABSENT"
  | "SESSION_UNAUTHENTICATED"
  | EconomicEligibilityCode
  | "CAPABILITY_MISSING"
  | "CONTEXT_LIMIT_INSUFFICIENT"
  | "OUTPUT_LIMIT_INSUFFICIENT"
  | "NO_OBSERVED_SUCCESSFUL_INVOCATION"
  | "CLASSIFIED_AVAILABLE";

/** Cost class derived from catalogue pricing metadata alone. */
export type CatalogueCostClass = "zero-price" | "priced" | "unknown";

export interface RoutingRequirement {
  readonly requiredCapabilities: readonly string[];
  readonly minimumContextTokens: number | null;
  readonly minimumOutputTokens: number | null;
}

export interface ClassificationInput {
  readonly snapshot: ModelCatalogueSnapshot;
  readonly installedAdapterPackages: readonly string[];
  readonly suppliedCredentialNames: readonly string[];
  readonly authorizations: readonly ExecutionEconomicAuthorization[];
  readonly policy: EffectiveCostPolicy;
  readonly requirement: RoutingRequirement;
  /** Route identifiers with a durable successful invocation record. */
  readonly observedAvailableRouteIds: readonly string[];
  /** Extra credential names that also supply a provider, from graph authority. */
  readonly credentialAliases?: ReadonlyMap<string, readonly string[]>;
  /** Endpoints an OpenAI-compatible adapter needs, from graph authority. */
  readonly providerEndpoints?: ReadonlyMap<string, string>;
  /** Execution policy from graph authority; reserved families are not routable. */
  readonly executionPolicy?: import("./provider-policy.ts").ProviderExecutionPolicy;
}

export interface ModelClassification {
  readonly provider: string;
  readonly model: string;
  readonly adapterPackage: string | null;
  readonly transport: ExecutionTransportId | null;
  readonly credentialName: string | null;
  /** Endpoint required to reach this provider, when the adapter needs one. */
  readonly baseUrl: string | null;
  readonly costClass: CatalogueCostClass;
  /** How eligibility was established, distinct from the catalogue list price. */
  readonly economicBasis: string | null;
  readonly economicCode: EconomicEligibilityCode | null;
  readonly state: ReadinessState;
  readonly reason: ClassificationReason;
}

export interface ClassificationSummary {
  readonly schema: "urn:usf:catalogue-classification:1";
  readonly version: 1;
  readonly catalogueRawDigest: string;
  readonly catalogueNormalizedDigest: string;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly stateCounts: Readonly<Record<ReadinessState, number>>;
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly classificationDigest: string;
  readonly nonClaims: readonly string[];
}

/** Every catalogue adapter package is an AI SDK provider carried by one transport. */
export function transportForAdapterPackage(adapterPackage: string | null): ExecutionTransportId | null {
  if (adapterPackage === null || adapterPackage.length === 0) return null;
  return "vercel-ai-sdk";
}

export function catalogueCostClass(cost: unknown): CatalogueCostClass {
  if (typeof cost !== "object" || cost === null) return "unknown";
  const record = cost as Record<string, unknown>;
  const input = record.input;
  const output = record.output;
  if (typeof input !== "number" || typeof output !== "number") return "unknown";
  if (input === 0 && output === 0) return "zero-price";
  return "priced";
}

/**
 * Map a catalogue cost class onto the declared route cost vocabulary the
 * economic policy understands. A provider the operator explicitly authorized
 * for a free quota is presented as free-quota; otherwise the catalogue's own
 * pricing decides, and unknown pricing stays unknown so it fails closed.
 */
function declaredCostFor(
  provider: string,
  transport: ExecutionTransportId,
  costClass: CatalogueCostClass,
  authorizations: readonly ExecutionEconomicAuthorization[],
): Readonly<{ cost: string; entitlement: string }> {
  const authorized = authorizations.find(
    (entry) => entry.provider === provider && entry.transport === transport,
  );
  if (authorized !== undefined) {
    return Object.freeze({ cost: "free-quota", entitlement: authorized.entitlement });
  }
  if (costClass === "zero-price") return Object.freeze({ cost: "zero-price", entitlement: "zero-price" });
  if (costClass === "priced") return Object.freeze({ cost: "paid", entitlement: "paid" });
  return Object.freeze({ cost: "unknown", entitlement: "unknown" });
}

export function classifyCatalogue(input: ClassificationInput): Readonly<{
  classifications: readonly ModelClassification[];
  summary: ClassificationSummary;
}> {
  const installed = new Set(input.installedAdapterPackages);
  const supplied = new Set(input.suppliedCredentialNames);
  const observed = new Set(input.observedAvailableRouteIds);
  const classifications: ModelClassification[] = [];

  for (const provider of input.snapshot.providers) {
    const adapterPackage = provider.adapter.package ?? null;
    const transport = transportForAdapterPackage(adapterPackage);
    const declaredNames = provider.credentialNames ?? [];
    const credentialNames = Object.freeze([...new Set([
      ...declaredNames,
      ...(input.credentialAliases?.get(provider.providerRoute) ?? []),
    ])].sort());
    const baseUrl = input.providerEndpoints?.get(provider.providerRoute) ?? null;
    for (const model of provider.models) {
      const costClass = catalogueCostClass(model.cost);
      const base = {
        provider: provider.providerRoute,
        model: model.route.model,
        adapterPackage,
        transport,
        baseUrl,
        costClass,
      } as const;

      // Execution authorization is checked before anything else, so a reserved
      // family never reaches a credential or economics conclusion that could be
      // mistaken for the reason it was not selected.
      if (input.executionPolicy !== undefined) {
        const decision = policyDecision(input.executionPolicy, {
          transport, provider: provider.providerRoute, model: model.route.model,
        });
        if (!decision.permitted) {
          classifications.push(Object.freeze({
            ...base, credentialName: null, economicBasis: null, economicCode: null,
            state: "DISCOVERED",
            reason: decision.disposition === "DISABLED_BY_POLICY" ? "POLICY_DISABLED" : "POLICY_OPERATOR_RESERVED",
          }));
          continue;
        }
      }
      if (transport === null) {
        classifications.push(Object.freeze({ ...base, credentialName: null, economicBasis: null, economicCode: null, state: "DISCOVERED", reason: "TRANSPORT_UNKNOWN_ADAPTER" }));
        continue;
      }
      if (adapterPackage === null || !installed.has(adapterPackage)) {
        classifications.push(Object.freeze({ ...base, credentialName: null, economicBasis: null, economicCode: null, state: "DISCOVERED", reason: "TRANSPORT_ADAPTER_NOT_INSTALLED" }));
        continue;
      }
      if (adapterPackage === "@ai-sdk/openai-compatible" && baseUrl === null) {
        classifications.push(Object.freeze({ ...base, credentialName: null, economicBasis: null, economicCode: null, state: "DISCOVERED", reason: "PROVIDER_ENDPOINT_UNDECLARED" }));
        continue;
      }
      if (credentialNames.length === 0) {
        classifications.push(Object.freeze({ ...base, credentialName: null, economicBasis: null, economicCode: null, state: "TRANSPORT_SUPPORTED", reason: "CREDENTIAL_NAME_UNDECLARED" }));
        continue;
      }
      const credentialName = credentialNames.find((name) => supplied.has(name)) ?? null;
      if (credentialName === null) {
        classifications.push(Object.freeze({
          ...base, credentialName: credentialNames[0] ?? null,
          economicBasis: null, economicCode: null,
          state: "TRANSPORT_SUPPORTED", reason: "CREDENTIAL_ABSENT",
        }));
        continue;
      }

      const declared = declaredCostFor(provider.providerRoute, transport, costClass, input.authorizations);
      const economics = evaluateExecutionEconomics({
        transport,
        provider: provider.providerRoute,
        routeCost: declared.cost,
        routeEntitlement: declared.entitlement,
        routePaidFallback: false,
        policy: input.policy,
        authorizations: input.authorizations,
      });
      if (!economics.eligible) {
        classifications.push(Object.freeze({ ...base, credentialName, economicBasis: economics.basis, economicCode: economics.code, state: "AUTHENTICATED", reason: economics.code }));
        continue;
      }

      const capabilityNames = (model.capabilityNames ?? []) as readonly string[];
      const missing = input.requirement.requiredCapabilities.filter((name) => !capabilityNames.includes(name));
      if (missing.length > 0) {
        classifications.push(Object.freeze({ ...base, credentialName, economicBasis: economics.basis, economicCode: economics.code, state: "ECONOMICALLY_ELIGIBLE", reason: "CAPABILITY_MISSING" }));
        continue;
      }
      const contextLimit = model.limits.context;
      if (input.requirement.minimumContextTokens !== null
        && (typeof contextLimit !== "number" || contextLimit < input.requirement.minimumContextTokens)) {
        classifications.push(Object.freeze({ ...base, credentialName, economicBasis: economics.basis, economicCode: economics.code, state: "ECONOMICALLY_ELIGIBLE", reason: "CONTEXT_LIMIT_INSUFFICIENT" }));
        continue;
      }
      const outputLimit = model.limits.output;
      if (input.requirement.minimumOutputTokens !== null
        && (typeof outputLimit !== "number" || outputLimit < input.requirement.minimumOutputTokens)) {
        classifications.push(Object.freeze({ ...base, credentialName, economicBasis: economics.basis, economicCode: economics.code, state: "ECONOMICALLY_ELIGIBLE", reason: "OUTPUT_LIMIT_INSUFFICIENT" }));
        continue;
      }

      const routeId = `${provider.providerRoute}:${model.route.model}`;
      if (!observed.has(routeId)) {
        classifications.push(Object.freeze({ ...base, credentialName, economicBasis: economics.basis, economicCode: economics.code, state: "ROUTABLE", reason: "NO_OBSERVED_SUCCESSFUL_INVOCATION" }));
        continue;
      }
      classifications.push(Object.freeze({ ...base, credentialName, economicBasis: economics.basis, economicCode: economics.code, state: "AVAILABLE", reason: "CLASSIFIED_AVAILABLE" }));
    }
  }

  // Deterministic order independent of catalogue iteration order.
  const ordered = Object.freeze([...classifications].sort((left, right) => {
    const provider = left.provider.localeCompare(right.provider);
    return provider !== 0 ? provider : left.model.localeCompare(right.model);
  }));

  const stateCounts = Object.fromEntries(readinessLadder.map((state) => [state, 0])) as Record<ReadinessState, number>;
  const reasonCounts: Record<string, number> = {};
  for (const entry of ordered) {
    stateCounts[entry.state] += 1;
    reasonCounts[entry.reason] = (reasonCounts[entry.reason] ?? 0) + 1;
  }

  const summary: ClassificationSummary = Object.freeze({
    schema: "urn:usf:catalogue-classification:1" as const,
    version: 1 as const,
    catalogueRawDigest: input.snapshot.rawDigest,
    catalogueNormalizedDigest: input.snapshot.normalizedDigest,
    providerCount: input.snapshot.providers.length,
    modelCount: ordered.length,
    stateCounts: Object.freeze(stateCounts),
    reasonCounts: Object.freeze(Object.fromEntries(Object.entries(reasonCounts).sort())),
    classificationDigest: canonicalDigest(ordered),
    nonClaims: Object.freeze([
      "Classification is a deterministic projection of catalogue metadata, installed adapters, supplied credential names, explicit operator economic authorization and the stated routing requirement. It contacts no provider.",
      "AVAILABLE means a durable successful invocation record exists for that route. Every other state is a static classification, not an availability claim.",
      "Catalogue pricing describes provider list rates. Unknown pricing fails closed rather than being treated as free.",
    ]),
  });

  return Object.freeze({ classifications: ordered, summary });
}
