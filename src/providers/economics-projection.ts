import { canonicalDigest } from "../core/canonical.ts";
import type { SemanticGraph } from "../graph/index.ts";
import type { ExecutionTransportId } from "./transports.ts";
import { objectsFor } from "../graph/index.ts";

/**
 * The graph is the semantic source for execution economics. This module derives
 * the runtime projection deterministically from graph authority, so the runtime
 * consumes an efficient JSON file without that file being a second, manually
 * maintained source of truth.
 */
const authorizationType = "urn:usf:type:OperatorEconomicAuthorization";
const policyIri = "urn:usf:economic-policy:zero-paid:1";
const typePredicate = "urn:usf:predicate:type";

export interface ProjectedEconomics {
  readonly $schema: "urn:usf:execution-economics:1";
  readonly version: 1;
  /** Deterministically derived; never hand-edited. */
  readonly generated: true;
  readonly derivedFrom: string;
  /** Digest of exactly the graph quads that produced this projection. */
  readonly sourceGraphDigest: string;
  /** The complete effective cost policy, derived from graph authority. */
  readonly costPolicy: Readonly<{
    maximumPaidCost: number;
    paidFallback: string;
    unknownPrice: string;
    acceptedCostClasses: readonly string[];
  }>;
  readonly authorizations: readonly Readonly<{
    transport: ExecutionTransportId;
    provider: string;
    entitlement: string;
    basis: string;
    maximumPaidCostUsd: number;
    evidence: string;
    sourceDocumentation: string;
  }>[];
  readonly nonClaims: readonly string[];
}

function one(graph: SemanticGraph, subject: string, predicate: string): string | null {
  const values = objectsFor(graph, subject, predicate).map((quad) => quad.object);
  return values.length === 1 ? values[0]! : null;
}
function many(graph: SemanticGraph, subject: string, predicate: string): readonly string[] {
  return Object.freeze([...new Set(objectsFor(graph, subject, predicate).map((quad) => quad.object))].sort());
}

/**
 * Derive the projection and the digest of exactly the quads that produced it.
 * The digest covers the economics closure only, so unrelated graph movement
 * does not invalidate the projection.
 */
function derivePolicy(graph: SemanticGraph): ProjectedEconomics["costPolicy"] {
  const maximum = one(graph, policyIri, "urn:usf:predicate:maximumPaidCostUsd");
  const paidFallback = one(graph, policyIri, "urn:usf:predicate:paidFallback");
  const unknownPrice = one(graph, policyIri, "urn:usf:predicate:unknownPrice");
  const acceptedCostClasses = many(graph, policyIri, "urn:usf:predicate:acceptedCostClass");
  if (maximum === null || paidFallback === null || unknownPrice === null || acceptedCostClasses.length === 0) {
    throw new Error("ECONOMICS_POLICY_INCOMPLETE");
  }
  const maximumPaidCost = Number(maximum);
  if (!Number.isFinite(maximumPaidCost)) throw new Error("ECONOMICS_POLICY_BUDGET_INVALID");
  return Object.freeze({ maximumPaidCost, paidFallback, unknownPrice, acceptedCostClasses });
}

export function projectEconomics(graph: SemanticGraph): ProjectedEconomics {
  const subjects = Object.freeze(graph.quads
    .filter((quad) => quad.predicate === typePredicate && quad.object === authorizationType)
    .map((quad) => quad.subject)
    .sort());

  const authorizations = subjects.map((subject) => {
    const transportIri = one(graph, subject, "urn:usf:predicate:authorizesTransport");
    const transportName = transportIri === null ? null : transportIri.split(":").at(-1) ?? null;
    // A transport the runtime does not implement fails closed rather than
    // projecting an authorization nothing can honour.
    const transport = transportName === "vercel-ai-sdk" || transportName === "claude-cli"
      || transportName === "codex-cli" || transportName === "antigravity-cli"
      ? transportName
      : null;
    if (transportName !== null && transport === null) {
      throw new Error(`ECONOMICS_TRANSPORT_UNKNOWN:${transportName}`);
    }
    const provider = one(graph, subject, "urn:usf:predicate:authorizesProvider");
    const entitlement = one(graph, subject, "urn:usf:predicate:entitlement");
    const basis = one(graph, subject, "urn:usf:predicate:basis");
    const maximum = one(graph, subject, "urn:usf:predicate:maximumPaidCostUsd");
    const evidence = one(graph, subject, "urn:usf:predicate:evidence");
    const sourceDocumentation = one(graph, subject, "urn:usf:predicate:sourceDocumentation");
    if (transport === null || provider === null || entitlement === null || basis === null
      || maximum === null || evidence === null || sourceDocumentation === null) {
      throw new Error(`ECONOMICS_AUTHORIZATION_INCOMPLETE:${subject}`);
    }
    const maximumPaidCostUsd = Number(maximum);
    if (!Number.isFinite(maximumPaidCostUsd)) throw new Error(`ECONOMICS_BUDGET_INVALID:${subject}`);
    return Object.freeze({ transport, provider, entitlement, basis, maximumPaidCostUsd, evidence, sourceDocumentation });
  }).sort((left, right) =>
    left.transport.localeCompare(right.transport) || left.provider.localeCompare(right.provider));

  // The closure is exactly the authorization subjects plus the policy subject.
  const closureSubjects = new Set([...subjects, policyIri]);
  const closureQuads = Object.freeze(graph.quads
    .filter((quad) => closureSubjects.has(quad.subject))
    .map((quad) => quad.canonical)
    .sort());

  return Object.freeze({
    $schema: "urn:usf:execution-economics:1" as const,
    version: 1 as const,
    generated: true as const,
    derivedFrom: "graph/v3-execution.nq via urn:usf:economic-policy:zero-paid:1",
    sourceGraphDigest: canonicalDigest(closureQuads),
    costPolicy: derivePolicy(graph),
    authorizations: Object.freeze(authorizations),
    nonClaims: many(graph, policyIri, "urn:usf:predicate:nonClaim"),
  });
}

/** Recompute the closure digest so a projection can be checked against the graph. */
export function economicsClosureDigest(graph: SemanticGraph): string {
  return projectEconomics(graph).sourceGraphDigest;
}

/**
 * Read the runtime projection and prove it still corresponds to current graph
 * authority. The runtime may consume the efficient JSON file, but only while it
 * demonstrably derives from the graph: a mismatch fails closed rather than
 * silently executing against a stale duplicate.
 */
export interface VerifiedEconomics {
  readonly projection: ProjectedEconomics;
  readonly graphClosureDigest: string;
  readonly verified: true;
}

export function verifyEconomicsProjection(
  projectionValue: unknown,
  graph: SemanticGraph,
): VerifiedEconomics {
  if (typeof projectionValue !== "object" || projectionValue === null || Array.isArray(projectionValue)) {
    throw new Error("ECONOMICS_PROJECTION_INVALID");
  }
  const record = projectionValue as Record<string, unknown>;
  if (record.generated !== true || typeof record.sourceGraphDigest !== "string") {
    throw new Error("ECONOMICS_PROJECTION_NOT_DERIVED");
  }
  const expected = projectEconomics(graph);
  if (record.sourceGraphDigest !== expected.sourceGraphDigest) {
    throw new Error("ECONOMICS_PROJECTION_STALE");
  }
  // The projection must also equal what the graph produces, not merely quote a
  // matching digest, so a hand-edited body cannot ride a correct digest.
  if (canonicalDigest(record.authorizations) !== canonicalDigest(expected.authorizations)
    || canonicalDigest(record.costPolicy) !== canonicalDigest(expected.costPolicy)) {
    throw new Error("ECONOMICS_PROJECTION_DIVERGED");
  }
  return Object.freeze({ projection: expected, graphClosureDigest: expected.sourceGraphDigest, verified: true as const });
}

/**
 * The single accessor for graph-derived execution economics. Every V3 execution
 * surface reads the policy and authorizations here, so no surface can decide
 * against a different copy.
 */
export interface GraphDerivedEconomics {
  readonly policy: Readonly<{
    maximumPaidCost: number;
    paidFallback: string;
    unknownPrice: string;
    acceptedCostClasses: readonly string[];
  }>;
  readonly authorizations: ProjectedEconomics["authorizations"];
  readonly closureDigest: string;
}

export function readGraphDerivedEconomics(
  projectionValue: unknown,
  graph: SemanticGraph,
): GraphDerivedEconomics {
  const verified = verifyEconomicsProjection(projectionValue, graph);
  return Object.freeze({
    policy: verified.projection.costPolicy,
    authorizations: verified.projection.authorizations,
    closureDigest: verified.graphClosureDigest,
  });
}
