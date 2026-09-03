import type { Quad } from "./nquads.ts";

/**
 * Runtime scopes the graph declares. The runtime reads authority; it does not
 * carry a second copy of it. Every value here is derived from the corpus, so a
 * scope change is a graph change rather than a code change.
 */
const transactionAuthorityIri = "urn:usf:transaction-authority:v3:1";
const integrityScopeIri = "urn:usf:integrity-scope:corpus:1";
const concurrencyConstraintIri = "urn:usf:concurrency-constraint:execution:1";
const P = "urn:usf:predicate:";

export interface RuntimeAuthority {
  readonly authorizedPathPrefixes: readonly string[];
  readonly conventionExemptGraphs: readonly string[];
  readonly stateReasonGraphs: readonly string[];
  readonly derivedOnlyTypes: readonly string[];
  readonly functionalPredicates: readonly string[];
  /**
   * Dispatch concurrency the corpus declares. Null when undeclared, so an
   * absent constraint is never confused with a declared value; a caller then
   * falls back to its compiled default deliberately rather than by accident.
   */
  readonly concurrencyDefault: number | null;
  readonly concurrencyCeiling: number | null;
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
  const functionalPredicates = values(quads, integrityScopeIri, "functionalPredicate");
  // A bound must be exactly one positive integer. Two declared values are a
  // contradiction rather than a range, and a caller resolving it by taking the
  // first would silently pick one.
  const bound = (predicate: string): number | null => {
    const declared = values(quads, concurrencyConstraintIri, predicate);
    if (declared.length !== 1) return null;
    return /^[1-9][0-9]{0,3}$/u.test(declared[0]!) ? Number(declared[0]) : null;
  };
  const concurrencyDefault = bound("defaultConcurrency");
  const concurrencyCeiling = bound("boundedCeiling");
  return Object.freeze({
    authorizedPathPrefixes,
    conventionExemptGraphs,
    stateReasonGraphs,
    derivedOnlyTypes,
    functionalPredicates,
    concurrencyDefault,
    concurrencyCeiling,
    declared: authorizedPathPrefixes.length > 0 && conventionExemptGraphs.length > 0,
  });
}
