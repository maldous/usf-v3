import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalDigest } from "../../../src/core/canonical.ts";
import { loadSemanticGraph } from "../../../src/graph/index.ts";
import {
  authenticateScopeDerivations, deriveTransitionScope, derivedPairOutcome, derivedScopesOverlap,
  scopeDerivationRules, type CliTransitionScopeDerivation, type DerivedScopeBasis,
} from "../../../src/graph/transition-scope-derivation.ts";


const CONTRACT = "urn:usf:contract:cli-transition-definition:1";
const LEFT = "urn:usf:cli-transition:ordinary-apply:1";
const RIGHT = "urn:usf:cli-transition:ordinary-check:1";
// The rule each transition actually declares; a derivation naming any other
// rule is rejected, so the fixture must use the real binding.
const RULE_OF: Readonly<Record<string, string>> = {
  [LEFT]: "urn:usf:rule:ordinary-boundary-input:1",
  [RIGHT]: "urn:usf:rule:ordinary-boundary-input:1",
};
const VERIFIER = "urn:usf:verifier:scope-derivation:1";
const D = (seed: string) => "sha256:" + seed.repeat(64).slice(0, 64);

function basisOf(readSet: string[], writeSet: string[], digest = D("a")): DerivedScopeBasis {
  return {
    basisDigest: digest,
    work: { scopedDependencyDigest: D("d") },
    scope: { readSet, writeSet, preimages: { "src/one.ts": D("e") } },
  };
}

function derivationOf(transition: string, readSet: string[], writeSet: string[], resources: string[] = [], overrides: Partial<CliTransitionScopeDerivation> = {}) {
  const base = deriveTransitionScope(transition, RULE_OF[transition]!, basisOf(readSet, writeSet), {
    candidateDigest: D("c"), schemaDigest: D("b"), resources, verifier: VERIFIER,
    evidence: ["urn:usf:evidence:scope-derivation:1"],
  });
  if (Object.keys(overrides).length === 0) return base;
  const { derivationDigest, ...body } = { ...base, ...overrides };
  return Object.freeze({ ...body, derivationDigest: overrides.derivationDigest ?? canonicalDigest(body) }) as CliTransitionScopeDerivation;
}

// Loaded on first use, never at module scope: a test file is imported in
// confined execution views that do not carry the corpus, and reading it on
// import fails the whole file before any test is selected.
let productionGraph: ReturnType<typeof loadSemanticGraph> | undefined;
const production = () => (productionGraph ??= loadSemanticGraph(
  fileURLToPath(new URL("../../..", import.meta.url)), "graph/manifests/cli-transition-definition.json"));

function selectionFor(members: readonly string[], digest = D("a")) {
  return { cohort: members, contract: CONTRACT, currentBasisDigest: new Map(members.map(m => [m, digest])) };
}

test("the production cohort declares exactly one scope derivation rule per member", () => {
  const members = production().quads
    .filter(q => q.predicate === "urn:usf:predicate:type" && q.objectKind === "iri" && q.object === "urn:usf:type:CliTransitionDescriptor")
    .map(q => q.subject);
  const rules = scopeDerivationRules(production(), members);
  assert.equal(rules.size, members.length, "every transition binds a scope rule");
  assert.equal([...rules.values()].filter(rule => rule === "").length, 0, "no member has an ambiguous rule");
});

test("a complete derivation bound to the current basis authenticates", () => {
  const derivation = derivationOf(LEFT, ["src/a.ts"], [".usf/workspaces/x"]);
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]), [derivation]);
  assert.deepEqual(result.refusals, []);
  assert.equal(result.authenticated.get(LEFT)?.derivationDigest, derivation.derivationDigest);
});

test("a member whose rule demands a derivation and has none is refused", () => {
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]), []);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_MISSING"));
  assert.equal(result.authenticated.size, 0);
});

test("two derivations for one transition are ambiguous, not a preference", () => {
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]),
    [derivationOf(LEFT, ["src/a.ts"], [".usf/workspaces/x"]), derivationOf(LEFT, ["src/b.ts"], [".usf/workspaces/y"])]);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_AMBIGUOUS"));
});

test("a derivation naming a basis other than the current one is stale", () => {
  const derivation = derivationOf(LEFT, ["src/a.ts"], [".usf/workspaces/x"]);
  const result = authenticateScopeDerivations(production(),
    { cohort: [LEFT], contract: CONTRACT, currentBasisDigest: new Map([[LEFT, D("f")]]) }, [derivation]);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_STALE"));
});

test("an empty derivation is an unperformed derivation, not an empty scope", () => {
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]), [derivationOf(LEFT, [], [])]);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_EMPTY"));
});

test("a prose scope description is refused as non-canonical", () => {
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]),
    [derivationOf(LEFT, ["Exact selected native candidate basis, schema and retained artifact dependencies"], [".usf/workspaces/x"])]);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_NOT_CANONICAL"));
});

test("a derivation with no evidence is unauthenticated", () => {
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]),
    [derivationOf(LEFT, ["src/a.ts"], [".usf/workspaces/x"], [], { evidence: [] })]);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_UNAUTHENTICATED"));
});

test("a transition cannot verify its own derived scope", () => {
  for (const verifier of [LEFT, CONTRACT, RIGHT]) {
    const result = authenticateScopeDerivations(production(), selectionFor([LEFT, RIGHT]),
      [derivationOf(LEFT, ["src/a.ts"], [".usf/workspaces/x"], [], { verifier }),
       derivationOf(RIGHT, ["src/b.ts"], [".usf/workspaces/y"])]);
    assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_VERIFIER_NOT_INDEPENDENT"), verifier);
  }
});

test("a tampered derivation digest is refused", () => {
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]),
    [derivationOf(LEFT, ["src/a.ts"], [".usf/workspaces/x"], [], { derivationDigest: D("9") })]);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_DIGEST_MISMATCH"));
});

test("a derivation for a transition outside the cohort is not admitted", () => {
  const result = authenticateScopeDerivations(production(), selectionFor([LEFT]),
    [derivationOf(LEFT, ["src/a.ts"], [".usf/workspaces/x"]), derivationOf(RIGHT, ["src/b.ts"], [".usf/workspaces/y"])]);
  assert.ok(result.refusals.includes("TRANSITION_SCOPE_DERIVATION_UNADMITTED"));
});

test("directory-prefix overlap is detected and sibling name prefixes are not", () => {
  assert.equal(derivedScopesOverlap(["a/b"], ["a/b/c"]), true);
  assert.equal(derivedScopesOverlap(["a/b/"], ["a/b"]), true);
  assert.equal(derivedScopesOverlap(["a/b"], ["a/bc"]), false);
});

test("pairwise outcome over derived scopes names its conflict kinds", () => {
  const left = derivationOf(LEFT, ["src/a.ts"], ["shared/state"], ["urn:usf:resource:lock"]);
  const right = derivationOf(RIGHT, ["src/b.ts"], ["shared/state/nested"], ["urn:usf:resource:lock"]);
  const outcome = derivedPairOutcome(left, right);
  assert.equal(outcome.outcome, "conflict");
  assert.deepEqual(outcome.reasons, ["path-overlap", "shared-authority"]);
});

test("genuinely disjoint derived scopes are compatible", () => {
  const left = derivationOf(LEFT, ["src/a.ts"], ["one/x"], ["urn:usf:resource:a"]);
  const right = derivationOf(RIGHT, ["src/b.ts"], ["two/y"], ["urn:usf:resource:b"]);
  assert.equal(derivedPairOutcome(left, right).outcome, "compatible");
});

test("a read/write meeting is a conflict in both directions", () => {
  const left = derivationOf(LEFT, ["shared/x"], ["one/y"]);
  const right = derivationOf(RIGHT, ["two/z"], ["shared/x"]);
  assert.equal(derivedPairOutcome(left, right).outcome, "conflict");
  assert.equal(derivedPairOutcome(right, left).outcome, "conflict");
});
