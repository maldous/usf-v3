import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import type { SemanticGraph } from "./index.ts";

/**
 * Concrete scopes derived from a runtime basis.
 *
 * A transition whose effect declares a `scopeDerivationRule` states its scope
 * as a rule, not as a path list. The static readScope/writeScope quads on such
 * an effect are a partial illustration, and `local-preparation-scope:1` says so
 * outright: "Empty static scope arrays do not assert that context-derived
 * scopes are empty; operational scope derivation remains mandatory." Comparing
 * those arrays for overlap therefore proves nothing, and an absent array is the
 * most dangerous input of all, because emptiness trivially never collides.
 *
 * This module is the missing evidence class. It carries the scopes the rule
 * actually produced, bound to every digest that produced them, so a later
 * pairwise conflict analysis is comparing observations rather than prose.
 */

const P = "urn:usf:predicate:";

/**
 * The part of a RealisationBasis this module reads. Declared structurally so
 * the graph layer does not import the realisation layer, which imports it back.
 */
export interface DerivedScopeBasis {
  readonly basisDigest: string;
  readonly work: Readonly<{ scopedDependencyDigest: string }>;
  readonly scope: Readonly<{
    readSet: readonly string[];
    writeSet: readonly string[];
    preimages: Readonly<Record<string, string>>;
  }>;
}

/** Repository-relative, no traversal, no scheme, no prose. Mirrors the basis path rule. */
const SCOPE_PATH = /^(?!\.git(?:\/|$))(?!\.env(?:\/|$))[A-Za-z0-9._<>-]+(?:\/[A-Za-z0-9._<>-]+)*\/?$/u;

export interface CliTransitionScopeDerivation {
  readonly transition: string;
  readonly scopeRule: string;
  readonly readSet: readonly string[];
  readonly writeSet: readonly string[];
  /** Non-file contended resources: shared authority, candidate locks, external mutation points. */
  readonly resources: readonly string[];
  readonly basisDigest: string;
  readonly candidateDigest: string;
  readonly schemaDigest: string;
  readonly dependencyDigest: string;
  readonly preimageDigest: string;
  readonly verifier: string;
  readonly evidence: readonly string[];
  readonly derivationDigest: string;
}

export interface ScopeDerivationSelection {
  readonly cohort: readonly string[];
  readonly contract: string | null;
  /** Current basis digest per transition; a derivation naming any other digest is stale. */
  readonly currentBasisDigest: ReadonlyMap<string, string>;
}

export interface ScopeDerivationAuthentication {
  readonly authenticated: ReadonlyMap<string, CliTransitionScopeDerivation>;
  readonly refusals: readonly string[];
}

/** The scope-derivation rules a cohort's effects declare. */
export function scopeDerivationRules(graph: SemanticGraph, members: readonly string[]): ReadonlyMap<string, string> {
  const values = (subject: string, field: string) =>
    graph.quads.filter(q => q.subject === subject && q.predicate === P + field && q.objectKind === "iri").map(q => q.object);
  const rules = new Map<string, string>();
  for (const member of members) {
    const declared = values(member, "effectContract").flatMap(effect => values(effect, "scopeDerivationRule"));
    // Exactly one rule, or the member's scope authority is ambiguous.
    if (declared.length === 1) rules.set(member, declared[0]!);
    else if (declared.length > 1) rules.set(member, "");
  }
  return rules;
}

/**
 * Project one transition's derived scope from the exact basis that produced it.
 * The basis already carries canonical read/write sets and file preimages; this
 * binds them to the identities a later reader must reauthenticate against.
 */
export function deriveTransitionScope(
  transition: string, scopeRule: string, basis: DerivedScopeBasis,
  binding: { readonly candidateDigest: string; readonly schemaDigest: string; readonly resources: readonly string[]; readonly verifier: string; readonly evidence: readonly string[] },
): CliTransitionScopeDerivation {
  const readSet = [...new Set(basis.scope.readSet)].sort();
  const writeSet = [...new Set(basis.scope.writeSet)].sort();
  const resources = [...new Set(binding.resources)].sort();
  const body = {
    transition, scopeRule, readSet, writeSet, resources,
    basisDigest: basis.basisDigest, candidateDigest: binding.candidateDigest,
    schemaDigest: binding.schemaDigest, dependencyDigest: basis.work.scopedDependencyDigest,
    preimageDigest: canonicalDigest(basis.scope.preimages),
    verifier: binding.verifier, evidence: [...new Set(binding.evidence)].sort(),
  };
  return Object.freeze({ ...body, derivationDigest: canonicalDigest(body) });
}

/**
 * Authenticate derived scopes for a cohort.
 *
 * Refuses, by exact reason code, every way a derivation can fail to mean what
 * it says: absent for a member whose rule demands one, ambiguous, stale against
 * the current basis, incomplete, self-verified, prose rather than paths, or
 * empty in both directions -- which is never a derivation result, only an
 * unperformed derivation.
 */
export function authenticateScopeDerivations(
  graph: SemanticGraph, selection: ScopeDerivationSelection, derivations: readonly CliTransitionScopeDerivation[],
): ScopeDerivationAuthentication {
  const refusals: string[] = [];
  const authenticated = new Map<string, CliTransitionScopeDerivation>();
  const rules = scopeDerivationRules(graph, selection.cohort);
  const cohort = new Set(selection.cohort);
  const byTransition = new Map<string, CliTransitionScopeDerivation[]>();
  for (const derivation of derivations) {
    if (!cohort.has(derivation.transition)) { refusals.push("TRANSITION_SCOPE_DERIVATION_UNADMITTED"); continue; }
    byTransition.set(derivation.transition, [...(byTransition.get(derivation.transition) ?? []), derivation]);
  }
  for (const [member, rule] of rules) {
    const found = byTransition.get(member) ?? [];
    if (rule === "") { refusals.push("TRANSITION_SCOPE_RULE_AMBIGUOUS"); continue; }
    if (found.length === 0) { refusals.push("TRANSITION_SCOPE_DERIVATION_MISSING"); continue; }
    if (found.length > 1) { refusals.push("TRANSITION_SCOPE_DERIVATION_AMBIGUOUS"); continue; }
    const derivation = found[0]!;
    let rejected = false;
    const refuse = (code: string) => { refusals.push(code); rejected = true; };
    if (derivation.scopeRule !== rule) refuse("TRANSITION_SCOPE_DERIVATION_RULE_MISMATCH");
    const current = selection.currentBasisDigest.get(member);
    if (current === undefined || derivation.basisDigest !== current) refuse("TRANSITION_SCOPE_DERIVATION_STALE");
    for (const field of [derivation.basisDigest, derivation.candidateDigest, derivation.schemaDigest,
      derivation.dependencyDigest, derivation.preimageDigest]) {
      if (!/^sha256:[0-9a-f]{64}$/u.test(field)) refuse("TRANSITION_SCOPE_DERIVATION_INCOMPLETE");
    }
    if (derivation.evidence.length === 0) refuse("TRANSITION_SCOPE_DERIVATION_UNAUTHENTICATED");
    // A member, the contract, or the transition itself cannot verify its own scope.
    if (derivation.verifier.length === 0 || derivation.verifier === member
      || derivation.verifier === selection.contract || cohort.has(derivation.verifier)) {
      refuse("TRANSITION_SCOPE_DERIVATION_VERIFIER_NOT_INDEPENDENT");
    }
    const paths = [...derivation.readSet, ...derivation.writeSet];
    if (paths.some(path => !SCOPE_PATH.test(path) || path.includes(".."))) refuse("TRANSITION_SCOPE_DERIVATION_NOT_CANONICAL");
    // An operational derivation that produced nothing did not run. The rule
    // text is explicit that empty arrays assert nothing about derived scope.
    if (paths.length === 0) refuse("TRANSITION_SCOPE_DERIVATION_EMPTY");
    const { derivationDigest, ...body } = derivation;
    if (canonicalDigest(body) !== derivationDigest) refuse("TRANSITION_SCOPE_DERIVATION_DIGEST_MISMATCH");
    if (!rejected) authenticated.set(member, derivation);
  }
  return { authenticated, refusals: [...new Set(refusals)].sort() };
}

/** Directory-prefix overlap over canonical derived paths. */
export function derivedScopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  const trim = (value: string) => value.endsWith("/") ? value.slice(0, -1) : value;
  return left.some(one => right.some(other => {
    const a = trim(one), b = trim(other);
    return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
  }));
}

/** Pairwise conflict analysis over authenticated derived scopes only. */
export function derivedPairOutcome(
  left: CliTransitionScopeDerivation, right: CliTransitionScopeDerivation,
): { readonly outcome: "compatible" | "conflict"; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  if (derivedScopesOverlap(left.writeSet, right.writeSet)) reasons.push("path-overlap");
  if (derivedScopesOverlap(left.writeSet, right.readSet)) reasons.push("path-overlap");
  if (derivedScopesOverlap(right.writeSet, left.readSet)) reasons.push("path-overlap");
  if (left.resources.some(resource => right.resources.includes(resource))) reasons.push("shared-authority");
  const unique = [...new Set(reasons)].sort();
  return { outcome: unique.length === 0 ? "compatible" : "conflict", reasons: unique };
}

export function scopeDerivationCohortDigest(derivations: readonly CliTransitionScopeDerivation[]): string {
  return canonicalDigest([...derivations].map(d => d.derivationDigest).sort());
}

export const scopeDerivationNonClaims: readonly string[] = Object.freeze([
  "An authenticated derived scope is an observation of what one basis produced. It is not a grant to perform the effect.",
  "Empty static readScope/writeScope quads assert nothing about derived scope; an empty derivation is refused, not believed.",
  "A canonical path set proves comparability, not compatibility. Only the pairwise evaluator decides that.",
  canonicalJson({ module: "transition-scope-derivation", executionAuthority: "none" }),
]);
