import type { ModelCatalogueSnapshot } from "./catalogue.ts";
import {
  catalogueCostClass, classifyCatalogue,
  type ClassificationSummary, type RoutingRequirement,
} from "./classification.ts";
import {
  evaluateExecutionEconomics,
  type EffectiveCostPolicy, type ExecutionEconomicAuthorization,
} from "./execution-economics.ts";
import { permitsExecution, type ProviderExecutionPolicy } from "./provider-policy.ts";
import { unmetCapabilities, type RouteCapabilityEvidence } from "./capabilities.ts";
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
  /** Endpoint the adapter needs, from graph authority; null when it needs none. */
  readonly baseUrl: string | null;
  /** Catalogue list-price class: zero-price, priced or unknown. */
  readonly costClass: string;
  /** How eligibility was established, e.g. an operator free-quota authorization. */
  readonly economicBasis: string | null;
  /**
   * Catalogue-observed model features, or the transport's own for a local agent.
   * What the endpoint can do, known before anyone calls it.
   */
  readonly capabilityNames: readonly string[];
  /**
   * Task classes this route has earned through qualification. Optional because
   * absent and empty mean the same thing and must: a task class is held only
   * when a stored record says so, so "no field" and "no records" are one state,
   * and encoding them differently would invite a caller to treat absence as
   * unknown and then guess.
   */
  readonly qualifiedTaskClasses?: readonly string[];
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
  "antigravity-cli": Object.freeze({
    provider: "antigravity-cli",
    capabilityNames: Object.freeze(["reasoning", "tool-call", "structured-output"]),
    contextLimit: 200_000,
    outputLimit: 64_000,
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
  readonly credentialAliases?: ReadonlyMap<string, readonly string[]>;
  readonly providerEndpoints?: ReadonlyMap<string, string>;
  /** Model a local agent transport should request, from graph authority. */
  readonly transportSelectedModel?: ReadonlyMap<string, readonly string[]>;
  readonly executionPolicy?: ProviderExecutionPolicy;
  /** Live capability observations for the local agent CLI transports. */
  readonly localAgentCapabilities: readonly AuthenticatedTransportCapability[];
  /**
   * Task classes each route has earned, keyed `provider:model`, and `provider`
   * alone for a transport that selects its own model. An empty map means none.
   *
   * Required, not optional. It was optional, and the one command Hermes
   * dispatches through simply did not pass it -- so every candidate was derived
   * with an empty earned-task-class set and a qualification model that holds
   * thirteen adversarial properties constrained nothing at all. A caller that
   * has no qualifications to supply passes an empty map and says so.
   */
  readonly qualifiedTaskClassesByRoute: ReadonlyMap<string, readonly string[]>;
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
    credentialAliases: input.credentialAliases,
    providerEndpoints: input.providerEndpoints,
    executionPolicy: input.executionPolicy,
    qualifiedTaskClassesByRoute: input.qualifiedTaskClassesByRoute,
  });

  const candidates: ExecutionCandidate[] = [];
  for (const entry of classifications) {
    if (entry.state !== "ROUTABLE" && entry.state !== "AVAILABLE") continue;
    const provider = input.snapshot.providers.find((item) => item.providerRoute === entry.provider);
    const model = provider?.models.find((item) => item.route.model === entry.model);
    // A generative model must emit text and nothing else to answer a text work
    // unit. Requiring only that text be *among* its outputs is not enough: a
    // music model declares ["audio", "text"], was selected for a code unit, and
    // returned song lyrics with timestamps -- which then failed admission as
    // "no export", spending both a dispatch and a diagnosis. An undeclared
    // modality is still not a disqualification.
    const outputModalities = model?.modalities?.output ?? null;
    if (outputModalities !== null && outputModalities.length > 0
      && outputModalities.some((modality) => modality !== "text")) continue;
    candidates.push(Object.freeze({
      candidateId: `${entry.transport ?? "unknown"}:${entry.provider}:${entry.model}`,
      transport: entry.transport ?? "vercel-ai-sdk",
      provider: entry.provider,
      model: entry.model,
      adapterPackage: entry.adapterPackage,
      credentialName: entry.credentialName,
      baseUrl: entry.baseUrl,
      costClass: entry.costClass,
      economicBasis: entry.economicBasis,
      capabilityNames: Object.freeze([...((model?.capabilityNames ?? []) as readonly string[])]),
      qualifiedTaskClasses: entry.qualifiedTaskClasses,
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
    // Reservation is decided before usability, so a reserved transport that is
    // authenticated reports the policy, not a credential state.
    if (input.executionPolicy !== undefined) {
      // Reservation is decided per declared model as well as per transport, so
      // a reserved model family cannot enter the pool through a transport that
      // is otherwise permitted.
      const policy = input.executionPolicy;
      const declared = input.transportSelectedModel?.get(transport) ?? [];
      const decide = (model: string | null) =>
        permitsExecution(policy, { transport, provider: profile.provider, model });
      const decision = declared.length === 0
        ? decide(null)
        : declared.map((model) => decide(model)).find((entry) => !entry.permitted) ?? decide(null);
      if (!decision.permitted) {
        dispositions.push(Object.freeze({
          transport, admitted: false,
          reason: decision.disposition === "DISABLED_BY_POLICY" ? "POLICY_DISABLED" : "POLICY_OPERATOR_RESERVED",
        }));
        continue;
      }
    }
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
      // A host agent carries no catalogue model, so its cost class is the
      // subscription itself rather than anything models.dev prices.
      catalogueCostClass: "subscription-included",
      policy: input.policy,
      authorizations: input.authorizations,
    });
    if (!economics.eligible) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: economics.code }));
      continue;
    }
    // A local agent is matched the same way a catalogue model is: its own
    // transport features against model-feature requirements, and its stored
    // qualification records against task-class ones. A CLI that has never sat
    // the suite holds no task class, however capable its underlying model is.
    const agentEvidence: RouteCapabilityEvidence = {
      modelFeatures: profile.capabilityNames as readonly string[],
      qualifiedTaskClasses: input.qualifiedTaskClassesByRoute.get(profile.provider) ?? [],
    };
    const agentUnmet = unmetCapabilities(input.requirement.requiredCapabilities, agentEvidence);
    if (agentUnmet.missingModelFeatures.length > 0) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: "CAPABILITY_MISSING" }));
      continue;
    }
    if (agentUnmet.unqualifiedTaskClasses.length > 0) {
      dispositions.push(Object.freeze({ transport, admitted: false, reason: "CAPABILITY_UNQUALIFIED" }));
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
    // One candidate per declared model. Each carries its own quota, so an
    // exhausted model defers itself and leaves the rest of the subscription
    // reachable instead of taking the whole transport down with it.
    const declaredModels = input.transportSelectedModel?.get(transport) ?? [];
    const modelsForTransport: readonly (string | null)[] =
      declaredModels.length === 0 ? Object.freeze([null]) : declaredModels;
    for (const selected of modelsForTransport) candidates.push(Object.freeze({
      candidateId: selected === null ? `${transport}:${profile.provider}` : `${transport}:${profile.provider}:${selected}`,
      transport,
      provider: profile.provider,
      model: selected,
      adapterPackage: null,
      credentialName: null,
      baseUrl: null,
      costClass: "subscription-included",
      economicBasis: economics.basis,
      capabilityNames: profile.capabilityNames,
      qualifiedTaskClasses: Object.freeze([
        ...(input.qualifiedTaskClassesByRoute.get(
          selected === null ? profile.provider : `${profile.provider}:${selected}`,
        ) ?? agentEvidence.qualifiedTaskClasses),
      ]),
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
export interface RouteOrderingObservation {
  readonly attempts: number;
  readonly successes: number;
  readonly successRate: number;
  readonly meanLatencyMs: number;
  /** Downstream admission verdicts on what the route produced, when observed. */
  readonly outputAcceptances?: number;
  readonly outputRefusals?: number;
  readonly tokensPerAcceptance?: number | null;
}

/**
 * Rank within a provider by what a route has actually produced.
 *
 * A route with no history sits above one measured as unproductive and below one
 * measured as productive: unknown is worth trying, repeatedly-useless is not.
 * Measured, this matters -- a route observed at 16 successes from 16 attempts
 * was reached only 16 times because ordering was alphabetical, while one at 9%
 * across 289 attempts sat ahead of it purely by provider name.
 */
function routeRank(
  candidate: ExecutionCandidate,
  observed: ReadonlyMap<string, RouteOrderingObservation> | undefined,
): readonly [number, number, number] {
  const record = observed?.get(candidate.candidateId);
  if (record === undefined) return [0.5, 0, 0];
  // Admission outranks transport. A route that answers every time while nothing
  // it produces survives admission is not productive, it is expensive -- one
  // such route absorbed 86 percent of a session's tokens with zero admissions
  // while its perfect transport record kept it at the top of its provider.
  // Admission verdicts are rarer than transport observations, so they are used
  // whenever they exist and transport success remains the prior until then.
  const verdicts = (record.outputAcceptances ?? 0) + (record.outputRefusals ?? 0);
  if (verdicts > 0) {
    // Equal admission rates split on what a kept result costs. Measured twice
    // in one day: subscription hosts spending 0.66 and 1.04 million tokens per
    // accepted unit ranked level with an API route accepting the same class of
    // work for seventeen thousand, because rate is blind to spend. Latency
    // remains the final tiebreak.
    return [(record.outputAcceptances ?? 0) / verdicts,
      record.tokensPerAcceptance ?? 0, record.meanLatencyMs];
  }
  if (record.attempts === 0) return [0.5, 0, 0];
  return [record.successRate, 0, record.meanLatencyMs];
}

/**
 * Which rotation group a unit belongs to.
 *
 * Rotating the provider order per unit maximised spread and destroyed prompt
 * cache locality: consecutive units never revisited a model inside its cache
 * TTL, so the byte-identical stage preamble was re-tokenised at full price
 * every time. Rotating per small group keeps the spread -- a quota failure
 * still cannot absorb more than one group's worth of consecutive work -- while
 * giving each model a burst of same-prefix requests close enough together to
 * hit its cache.
 */
export const dispatchBurstSize = 4;
export function rotationGroup(ordinal: number, burstSize: number = dispatchBurstSize): number {
  return Math.floor(Math.max(0, ordinal) / Math.max(1, burstSize));
}

export function diversifyCandidates(
  candidates: readonly ExecutionCandidate[],
  offset: number,
  observed?: ReadonlyMap<string, RouteOrderingObservation>,
): readonly ExecutionCandidate[] {
  const byProvider = new Map<string, ExecutionCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byProvider.get(candidate.provider) ?? [];
    bucket.push(candidate);
    byProvider.set(candidate.provider, bucket);
  }
  // Provider round-robin is preserved so no single provider is hammered; only
  // the order within each provider changes.
  for (const bucket of byProvider.values()) {
    bucket.sort((left, right) => {
      const [leftRate, leftTokens, leftMs] = routeRank(left, observed);
      const [rightRate, rightTokens, rightMs] = routeRank(right, observed);
      if (leftRate !== rightRate) return rightRate - leftRate;
      if (leftTokens !== rightTokens) return leftTokens - rightTokens;
      if (leftMs !== rightMs) return leftMs - rightMs;
      return left.candidateId.localeCompare(right.candidateId);
    });
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
