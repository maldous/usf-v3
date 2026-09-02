import type { SemanticGraph } from "../graph/index.ts";

/**
 * Execution authorization is a separate fact from authentication availability.
 * A transport may hold a valid local session and still be unroutable because
 * policy reserves it. This module reads those reservations from graph authority
 * so a disabled family appears in routing evidence as an intentional decision,
 * never as a missing credential.
 */
const P = "urn:usf:predicate:";
const policyType = "urn:usf:type:ProviderExecutionPolicy";

export type PolicyDisposition = "OPERATOR_RESERVED" | "DISABLED_BY_POLICY";

export interface ProviderExecutionPolicy {
  /** Transport identities that may not be selected. */
  readonly reservedTransports: ReadonlyMap<string, PolicyDisposition>;
  /** Catalogue provider routes that may not be selected. */
  readonly reservedProviders: ReadonlyMap<string, PolicyDisposition>;
  /**
   * Model-identity prefixes that may not be selected regardless of which
   * provider serves them. A reserved family reached through a third-party
   * marketplace is still the reserved family.
   */
  readonly reservedModelPrefixes: ReadonlyMap<string, PolicyDisposition>;
  readonly reasons: ReadonlyMap<string, string>;
  readonly declared: boolean;
}

function values(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return Object.freeze(graph.quads
    .filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object).sort());
}

export function readProviderExecutionPolicy(graph: SemanticGraph): ProviderExecutionPolicy {
  const subjects = graph.quads
    .filter((quad) => quad.predicate === `${P}type` && quad.object === policyType)
    .map((quad) => quad.subject).sort();
  const reservedTransports = new Map<string, PolicyDisposition>();
  const reservedProviders = new Map<string, PolicyDisposition>();
  const reservedModelPrefixes = new Map<string, PolicyDisposition>();
  const reasons = new Map<string, string>();
  for (const subject of subjects) {
    // A policy is active unless it explicitly says otherwise. Absent, malformed
    // or unrecognised values keep the reservation standing, so the only way to
    // lift one is a deliberate, exact declaration -- never an omission.
    if (values(graph, subject, "policyActive")[0] === "false") continue;
    const dispositionValue = values(graph, subject, "policyDisposition")[0];
    const disposition: PolicyDisposition = dispositionValue === "DISABLED_BY_POLICY"
      ? "DISABLED_BY_POLICY" : "OPERATOR_RESERVED";
    const reason = values(graph, subject, "policyReason")[0] ?? "reserved by operator policy";
    for (const transport of values(graph, subject, "reservedTransport")) {
      const name = transport.split(":").pop()!;
      reservedTransports.set(name, disposition);
      reasons.set(`transport:${name}`, reason);
    }
    for (const provider of values(graph, subject, "reservedProvider")) {
      reservedProviders.set(provider, disposition);
      reasons.set(`provider:${provider}`, reason);
    }
    for (const prefix of values(graph, subject, "reservedModelPrefix")) {
      reservedModelPrefixes.set(prefix.toLowerCase(), disposition);
      reasons.set(`model:${prefix.toLowerCase()}`, reason);
    }
  }
  return Object.freeze({
    reservedTransports, reservedProviders, reservedModelPrefixes, reasons,
    declared: subjects.length > 0,
  });
}

export interface PolicyDecision {
  readonly permitted: boolean;
  readonly disposition: PolicyDisposition | null;
  readonly matchedOn: "transport" | "provider" | "model" | null;
  readonly reason: string | null;
}

const permitted: PolicyDecision = Object.freeze({
  permitted: true, disposition: null, matchedOn: null, reason: null,
});

/**
 * Decide whether one candidate may execute. Every dimension is checked, because
 * a reserved family can be reached by transport, by provider route, or by model
 * identity through an unrelated provider.
 */
export function permitsExecution(
  policy: ProviderExecutionPolicy,
  candidate: Readonly<{ transport: string | null; provider: string | null; model: string | null }>,
): PolicyDecision {
  const transport = candidate.transport;
  if (transport !== null && policy.reservedTransports.has(transport)) {
    return Object.freeze({
      permitted: false, disposition: policy.reservedTransports.get(transport)!,
      matchedOn: "transport" as const, reason: policy.reasons.get(`transport:${transport}`) ?? null,
    });
  }
  const provider = candidate.provider;
  if (provider !== null && policy.reservedProviders.has(provider)) {
    return Object.freeze({
      permitted: false, disposition: policy.reservedProviders.get(provider)!,
      matchedOn: "provider" as const, reason: policy.reasons.get(`provider:${provider}`) ?? null,
    });
  }
  const model = candidate.model?.toLowerCase() ?? null;
  if (model !== null) {
    for (const [prefix, disposition] of policy.reservedModelPrefixes) {
      // Substring rather than prefix: a marketplace namespaces the family, as in
      // "anthropic/claude-sonnet", and a bare identity may carry it anywhere.
      if (!model.includes(prefix)) continue;
      return Object.freeze({
        permitted: false, disposition,
        matchedOn: "model" as const, reason: policy.reasons.get(`model:${prefix}`) ?? null,
      });
    }
  }
  return permitted;
}
