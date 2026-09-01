import type { ModelCatalogueSnapshot } from "./catalogue.ts";
import {
  catalogueCostClass, classifyCatalogue,
  type ClassificationSummary, type RoutingRequirement,
} from "./classification.ts";
import {
  evaluateExecutionEconomics,
  type EffectiveCostPolicy, type ExecutionEconomicAuthorization,
} from "./execution-economics.ts";
import type { AuthenticatedTransportCapability, ExecutionTransportId } from "./transports.ts";

/**
 * One executable candidate, whatever transport carries it. An AI SDK candidate
 * names an exact catalogue model; a local agent CLI candidate names the
 * transport and lets it resolve its own model, because each CLI has its own
 * model set, capabilities and quota that this repository does not own.
 */
export interface ExecutionCandidate {
  readonly candidateId: string;
  readonly transport: ExecutionTransportId;
  readonly provider: string;
  /** Exact model identity, or null when the transport selects its own. */
  readonly model: string | null;
  readonly adapterPackage: string | null;
  readonly credentialName: string | null;
  /** Catalogue list-price class: zero-price, priced or unknown. */
  readonly costClass: string;
  /** How eligibility was established, e.g. an operator free-quota authorization. */
  readonly economicBasis: string | null;
  readonly capabilityNames: readonly string[];
  readonly contextLimit: number | null;
  readonly outputLimit: number | null;
  readonly state: "ROUTABLE" | "AVAILABLE";
}

/**
 * Capabilities a local agent CLI transport offers. These are transport-level
 * facts, deliberately not derived from the models.dev catalogue: an agent CLI
 * exposes a different surface from a raw model endpoint, and its quota is
 * separate from any provider API quota.
 */
export const localAgentTransportProfiles = Object.freeze({
  "claude-cli": Object.freeze({
    provider: "claude-cli",
    capabilityNames: Object.freeze(["reasoning", "tool-call", "structured-output", "temperature"]),
    contextLimit: 200_000,
    outputLimit: 32_000,
    quotaScope: "operator-subscription",
  }),
  "codex-cli": Object.freeze({
    provider: "codex-cli",
    capabilityNames: Object.freeze(["reasoning", "tool-call", "structured-output"]),
    contextLimit: 272_000,
    outputLimit: 100_000,
    quotaScope: "operator-subscription",
  }),
} as const);

export type LocalAgentTransportId = keyof typeof localAgentTransportProfiles;

export interface RouteUniverseInput {
  readonly snapshot: ModelCatalogueSnapshot;
  readonly installedAdapterPackages: readonly string[];
  readonly suppliedCredentialNames: readonly string[];
  readonly authorizations: readonly ExecutionEconomicAuthorization[];
  readonly policy: EffectiveCostPolicy;
  readonly requirement: RoutingRequirement;
  readonly observedAvailableRouteIds: readonly string[];
  /** Live capability observations for the local agent CLI transports. */
  readonly localAgentCapabilities: readonly AuthenticatedTransportCapability[];
}

export interface RouteUniverse {
  readonly candidates: readonly ExecutionCandidate[];
  readonly catalogueSummary: ClassificationSummary;
  readonly localAgentDispositions: readonly Readonly<{
    transport: ExecutionTransportId;
    admitted: boolean;
    reason: string;
  }>[];
}

/**
 * Derive the complete candidate universe for one routing requirement: every
 * catalogue model that survives classification, plus every local agent CLI
 * transport that is authenticated, economically authorized and capable.
 */
export function deriveRouteUniverse(input: RouteUniverseInput): RouteUniverse {
  const { classifications, summary } = classifyCatalogue({
    snapshot: input.snapshot,
    installedAdapterPackages: input.installedAdapterPackages,
    suppliedCredentialNames: input.suppliedCredentialNames,
    authorizations: input.authorizations,
    policy: input.policy,
    requirement: input.requirement,
    observedAvailableRouteIds: input.observedAvailableRouteIds,
  });

  const candidates: ExecutionCandidate[] = [];
  for (const entry of classifications) {
    if (entry.state !== "ROUTABLE" && entry.state !== "AVAILABLE") continue;
    const provider = input.snapshot.providers.find((item) => item.providerRoute === entry.provider);
    const model = provider?.models.find((item) => item.route.model === entry.model);
    candidates.push(Object.freeze({
      candidateId: `${entry.transport ?? "unknown"}:${entry.provider}:${entry.model}`,
      transport: entry.transport ?? "vercel-ai-sdk",
      provider: entry.provider,
      model: entry.model,
      adapterPackage: entry.adapterPackage,
      credentialName: entry.credentialName,
      costClass: entry.costClass,
      economicBasis: entry.economicBasis,
      capabilityNames: Object.freeze([...((model?.capabilityNames ?? []) as readonly string[])]),
      contextLimit: model?.limits.context ?? null,
      outputLimit: model?.limits.output ?? null,
      state: entry.state,
    }));
  }

  const dispositions: Array<Readonly<{ transport: ExecutionTransportId; admitted: boolean; reason: string }>> = [];
  for (const capability of input.localAgentCapabilities) {
    const transport = capability.transport;
    if (!Object.hasOwn(localAgentTransportProfiles, transport)) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: "TRANSPORT_NOT_A_LOCAL_AGENT" }));
      continue;
    }
    const profile = localAgentTransportProfiles[transport as LocalAgentTransportId];
    if (!capability.usable) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: `TRANSPORT_${capability.reason ?? "UNUSABLE"}` }));
      continue;
    }
    const economics = evaluateExecutionEconomics({
      transport,
      provider: profile.provider,
      routeCost: "subscription-included",
      routeEntitlement: "subscription-included",
      routePaidFallback: false,
      policy: input.policy,
      authorizations: input.authorizations,
    });
    if (!economics.eligible) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: economics.code }));
      continue;
    }
    const missing = input.requirement.requiredCapabilities.filter(
      (name) => !(profile.capabilityNames as readonly string[]).includes(name),
    );
    if (missing.length > 0) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: "CAPABILITY_MISSING" }));
      continue;
    }
    if (input.requirement.minimumContextTokens !== null && profile.contextLimit < input.requirement.minimumContextTokens) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: "CONTEXT_LIMIT_INSUFFICIENT" }));
      continue;
    }
    if (input.requirement.minimumOutputTokens !== null && profile.outputLimit < input.requirement.minimumOutputTokens) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: "OUTPUT_LIMIT_INSUFFICIENT" }));
      continue;
    }
    dispositions.push(Object.freeze({ transport, admitted: true, reason: "ADMITTED" }));
    candidates.push(Object.freeze({
      candidateId: `${transport}:${profile.provider}`,
      transport,
      provider: profile.provider,
      model: null,
      adapterPackage: null,
      credentialName: null,
      costClass: "subscription-included",
      economicBasis: economics.basis,
      capabilityNames: profile.capabilityNames,
      contextLimit: profile.contextLimit,
      outputLimit: profile.outputLimit,
      state: "ROUTABLE" as const,
    }));
  }

  const ordered = Object.freeze([...candidates].sort((left, right) => {
    if (left.state !== right.state) return left.state === "AVAILABLE" ? -1 : 1;
    return left.candidateId.localeCompare(right.candidateId);
  }));

  return Object.freeze({
    candidates: ordered,
    catalogueSummary: summary,
    localAgentDispositions: Object.freeze(dispositions),
  });
}

/**
 * Spread selected candidates across distinct transports and providers so
 * independent work does not pile onto one quota. A failure on one provider then
 * cannot collapse unrelated work that had an alternative.
 */
export function diversifyCandidates(
  candidates: readonly ExecutionCandidate[],
  offset: number,
): readonly ExecutionCandidate[] {
  const byProvider = new Map<string, ExecutionCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byProvider.get(candidate.provider) ?? [];
    bucket.push(candidate);
    byProvider.set(candidate.provider, bucket);
  }
  const providers = [...byProvider.keys()].sort();
  if (providers.length === 0) return Object.freeze([]);
  const rotated = [...providers.slice(offset % providers.length), ...providers.slice(0, offset % providers.length)];
  const interleaved: ExecutionCandidate[] = [];
  let depth = 0;
  let added = true;
  while (added) {
    added = false;
    for (const provider of rotated) {
      const bucket = byProvider.get(provider)!;
      const candidate = bucket[depth];
      if (candidate !== undefined) { interleaved.push(candidate); added = true; }
    }
    depth += 1;
  }
  return Object.freeze(interleaved);
}
