import type { Quad } from "./nquads.ts";

/**
 * Runtime scopes the graph declares. The runtime reads authority; it does not
 * carry a second copy of it. Every value here is derived from the corpus, so a
 * scope change is a graph change rather than a code change.
 */
const transactionAuthorityIri = "urn:usf:transaction-authority:v3:1";
const integrityScopeIri = "urn:usf:integrity-scope:corpus:1";
const P = "urn:usf:predicate:";

export interface RuntimeAuthority {
  readonly authorizedPathPrefixes: readonly string[];
  readonly conventionExemptGraphs: readonly string[];
  readonly stateReasonGraphs: readonly string[];
  readonly derivedOnlyTypes: readonly string[];
  /** Explicit so an empty scope is never ambiguous with an absent declaration. */
  readonly declared: boolean;
}

function values(quads: readonly Quad[], subject: string, predicate: string): readonly string[] {
  return Object.freeze([...new Set(quads
    .filter((quad) => quad.subject === subject && quad.predicate === `${P}${predicate}`)
    .map((quad) => quad.object))].sort());
}

export function readRuntimeAuthority(quads: readonly Quad[]): RuntimeAuthority {
  const authorizedPathPrefixes = values(quads, transactionAuthorityIri, "authorizedPathPrefix");
  const conventionExemptGraphs = values(quads, integrityScopeIri, "conventionExemptGraph");
  const stateReasonGraphs = values(quads, integrityScopeIri, "stateReasonGraph");
  const derivedOnlyTypes = values(quads, integrityScopeIri, "derivedOnlyType");
  return Object.freeze({
    authorizedPathPrefixes,
    conventionExemptGraphs,
    stateReasonGraphs,
    derivedOnlyTypes,
    declared: authorizedPathPrefixes.length > 0 && conventionExemptGraphs.length > 0,
  });
}
