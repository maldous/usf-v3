import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalDigest } from "../../../src/core/canonical.ts";
import { fileURLToPath } from "node:url";
import { authenticateCliParallelSafetyAssessment, cliTransitionScopeDerivationRules, deriveCliParallelSafety } from "../../../src/graph/cli-transitions.ts";
import { loadSemanticGraph, type SemanticGraph } from "../../../src/graph/index.ts";
import { canonicalQuadLine, type Quad } from "../../../src/graph/nquads.ts";

const RULE = "urn:usf:cli-field-specification:rule-parallel-assessment-boundary:1";
const BASIS = "sha256:" + "a".repeat(64);
const SUBJECT = "urn:usf:cli-parallel-safety-assessment:test:1";
const CONTRACT = "urn:usf:contract:cli-transition-definition:1";
const VERIFIER = "urn:usf:verifier:independent:1";
const LEFT = "urn:usf:cli-transition:ordinary-apply:1";
const RIGHT = "urn:usf:cli-transition:ordinary-check:1";
const THIRD = "urn:usf:cli-transition:ordinary-resolve:1";

/** The distinctive segment of a transition identity, so two members never collide. */
function name(identity: string) { return identity.split(":").slice(-2).join("-"); }

/** One pair carrying disjoint scopes and resources, so it is genuinely compatible. */
function pair(left: string, right: string, overrides: Record<string, unknown> = {}) {
  return {
    left, right, outcome: "compatible", conflicts: [],
    evidence: ["urn:usf:evidence:pair:1"],
    rule: "urn:usf:rule:parallel-conflict-analysis:1",
    leftRead: [`read/${name(left)}`], leftWrite: [`write/${name(left)}`],
    rightRead: [`read/${name(right)}`], rightWrite: [`write/${name(right)}`],
    leftResources: [`urn:usf:resource:${name(left)}`],
    rightResources: [`urn:usf:resource:${name(right)}`],
    ...overrides,
  };
}

/** A complete, internally consistent proved assessment over the given cohort. */
function proved(members: readonly string[], pairs: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  const scopeSource = pairs.map(p => ({ left: p.left, right: p.right, leftRead: p.leftRead, leftWrite: p.leftWrite, rightRead: p.rightRead, rightWrite: p.rightWrite }));
  const resourceSource = pairs.map(p => ({ left: p.left, right: p.right, leftResources: p.leftResources, rightResources: p.rightResources }));
  const required = (members.length * (members.length - 1)) / 2;
  return {
    state: "proved", members: [...members], semanticBasis: BASIS, assessmentRule: RULE, conflicts: [], pairs: [...pairs],
    basis: {
      assessedPairCount: pairs.length, requiredPairCount: required,
      currentnessRule: "urn:usf:rule:parallel-currentness:1",
      obligations: [RULE], realisationBasis: "urn:usf:realisation-basis:test:1",
      resourceDigest: canonicalDigest(resourceSource), scopeDigest: canonicalDigest(scopeSource),
      semanticDigest: BASIS, verificationEvidence: ["urn:usf:evidence:verification:1"], verifier: VERIFIER,
    },
    ...overrides,
  };
}

const authenticate = (value: Record<string, unknown>, members: readonly string[] = [LEFT, RIGHT]) =>
  authenticateCliParallelSafetyAssessment(value, { members, semanticBasis: BASIS, subject: SUBJECT, contract: CONTRACT });

test("a complete current independently verified assessment authenticates", () => {
  assert.deepEqual(authenticate(proved([LEFT, RIGHT], [pair(LEFT, RIGHT)])), []);
});

test("a proved tag over a stale semantic basis is refused", () => {
  const stale = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)], { semanticBasis: "sha256:" + "b".repeat(64) });
  assert(authenticate(stale).includes("TRANSITION_PARALLEL_SAFETY_BASIS_STALE"));
});

test("a basis whose semanticDigest has moved is refused even when the outer basis matches", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  (value.basis as Record<string, unknown>).semanticDigest = "sha256:" + "c".repeat(64);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_BASIS_STALE"));
});

test("a member denominator that is not the current cohort is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  assert(authenticate(value, [LEFT, RIGHT, THIRD]).includes("TRANSITION_PARALLEL_SAFETY_MEMBER_DENOMINATOR_MISMATCH"));
});

test("an impossible required pair count for the cohort size is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  // Two members admit exactly one unordered pair; three is unreachable.
  (value.basis as Record<string, unknown>).requiredPairCount = 3;
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_PAIR_DENOMINATOR_IMPOSSIBLE"));
});

test("an assessed pair count that disagrees with the pairs presented is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  (value.basis as Record<string, unknown>).assessedPairCount = 2;
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_PAIR_DENOMINATOR_MISMATCH"));
});

test("a self-pair is refused and never counts toward coverage", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, LEFT)]);
  const failures = authenticate(value);
  assert(failures.includes("TRANSITION_PARALLEL_SAFETY_PAIR_SELF"));
  assert(failures.includes("TRANSITION_PARALLEL_SAFETY_PAIR_COVERAGE_INCOMPLETE"));
});

test("a duplicated pair is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT), pair(LEFT, RIGHT)]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_PAIR_DUPLICATE"));
});

test("a reversed pair is the same unordered pair and cannot inflate the denominator", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT), pair(RIGHT, LEFT)]);
  const failures = authenticate(value);
  assert(failures.includes("TRANSITION_PARALLEL_SAFETY_PAIR_DUPLICATE"));
});

test("a three-member cohort assessed over two pairs leaves the denominator uncovered", () => {
  const members = [LEFT, RIGHT, THIRD];
  const value = proved(members, [pair(LEFT, RIGHT), pair(LEFT, THIRD)]);
  assert(authenticate(value, members).includes("TRANSITION_PARALLEL_SAFETY_PAIR_COVERAGE_INCOMPLETE"));
});

test("a three-member cohort covering all three pairs authenticates", () => {
  const members = [LEFT, RIGHT, THIRD];
  const value = proved(members, [pair(LEFT, RIGHT), pair(LEFT, THIRD), pair(RIGHT, THIRD)]);
  assert.deepEqual(authenticate(value, members), []);
});

test("a pair naming a transition outside the cohort is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, "urn:usf:cli-transition:absent:1")]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_PAIR_UNADMITTED"));
});

test("a compatible pair whose write scopes overlap is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, { leftWrite: ["shared/state"], rightWrite: ["shared/state"] })]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_SCOPE_OVERLAP_UNDECLARED"));
});

test("a write scope containing the other side's read scope by directory prefix is an overlap", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, { leftWrite: ["shared"], rightRead: ["shared/nested/file"] })]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_SCOPE_OVERLAP_UNDECLARED"));
});

test("sibling paths that merely share a name prefix are not an overlap", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, { leftWrite: ["shared"], rightWrite: ["sharedother"] })]);
  assert.deepEqual(authenticate(value), []);
});

test("a prose description of a dependency closure is not a comparable scope", () => {
  // Four production transitions declare exactly this shape. Accepting it would
  // let an unanalysable scope read as disjoint from every real path.
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, {
    leftRead: ["Exact selected native candidate basis, schema and retained artifact dependencies"] })]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_SCOPE_UNCANONICAL"));
});

test("a scope that cannot be stated canonically is refused rather than read as disjoint", () => {
  for (const bad of [["/absolute/path"], ["../escape"], [""], ["has space"], ["a,b"], ["mixed path/with words"]]) {
    const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, { leftWrite: bad })]);
    assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_SCOPE_UNCANONICAL"), `expected refusal for ${JSON.stringify(bad)}`);
  }
});

test("a compatible pair sharing a non-file resource is refused", () => {
  const shared = ["urn:usf:resource:shared-authority"];
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, { leftResources: shared, rightResources: shared })]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_RESOURCE_CONTENTION_UNDECLARED"));
});

test("a pair declaring a conflict outcome cannot appear in a proved assessment", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, { outcome: "conflict" })]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_CONFLICT_PRESENT"));
});

test("a compatible pair carrying conflict entries is refused", () => {
  const conflict = { kind: "shared-authority", left: LEFT, right: RIGHT, resource: "urn:usf:resource:x",
    rule: "urn:usf:rule:parallel-conflict-analysis:1", evidence: ["urn:usf:evidence:conflict:1"] };
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT, { conflicts: [conflict] })]);
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_CONFLICT_PRESENT"));
});

test("a scope digest not derived from the pairs presented is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  (value.basis as Record<string, unknown>).scopeDigest = canonicalDigest("unrelated");
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_SCOPE_DIGEST_MISMATCH"));
});

test("a resource digest not derived from the pairs presented is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  (value.basis as Record<string, unknown>).resourceDigest = canonicalDigest("unrelated");
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_RESOURCE_DIGEST_MISMATCH"));
});

test("a verifier that is a cohort member, the contract or the assessment itself is not independent", () => {
  for (const verifier of [LEFT, CONTRACT, SUBJECT]) {
    const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
    (value.basis as Record<string, unknown>).verifier = verifier;
    assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_VERIFIER_NOT_INDEPENDENT"), `expected refusal for ${verifier}`);
  }
});

test("an assessment with no verification evidence is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  (value.basis as Record<string, unknown>).verificationEvidence = [];
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_VERIFICATION_EVIDENCE_MISSING"));
});

test("an obligation set omitting the assessment rule is incomplete", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  (value.basis as Record<string, unknown>).obligations = ["urn:usf:rule:unrelated:1"];
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_OBLIGATIONS_INCOMPLETE"));
});

test("an assessment naming a rule other than the graph-owned boundary is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)], { assessmentRule: "urn:usf:rule:caller-selected:1" });
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_RULE_UNADMITTED"));
});

test("a proved assessment with no basis at all is refused", () => {
  const value = proved([LEFT, RIGHT], [pair(LEFT, RIGHT)]);
  delete (value as Record<string, unknown>).basis;
  assert(authenticate(value).includes("TRANSITION_PARALLEL_SAFETY_BASIS_MISSING"));
});

test("an empty conflict list and empty pair list never authenticate a multi-member cohort", () => {
  const value = proved([LEFT, RIGHT], []);
  const failures = authenticate(value);
  assert(failures.includes("TRANSITION_PARALLEL_SAFETY_PAIR_COVERAGE_INCOMPLETE"));
  assert.notDeepEqual(failures, []);
});

// --- the graph-facing derivation, where scope-derivation rules are detected ---

const P = "urn:usf:predicate:", T = "urn:usf:type:";
function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "iri"): Quad {
  const built = { subject, predicate, object, objectKind, graph: "urn:usf:graph:test", canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}
function graphOf(quads: Quad[]): SemanticGraph {
  return { manifest: { } as SemanticGraph["manifest"], quads, semanticDigest: BASIS,
    graphDigests: {}, sourceDigests: {}, repositoryRoot: "/nonexistent" };
}

test("with no assessment admitted the verdict is unproven and names its missing obligation", () => {
  const result = deriveCliParallelSafety(graphOf([]), CONTRACT, [LEFT, RIGHT], BASIS);
  assert.equal(result.assessment.state, "unproven");
  assert.deepEqual(result.assessment.missingObligations, [RULE]);
  assert.deepEqual(result.assessment.reasonCodes, ["TRANSITION_PARALLEL_SAFETY_UNAUTHENTICATED"]);
  assert.deepEqual(result.diagnostics, []);
});

test("two assessments for one contract is an ownership ambiguity, not a preference", () => {
  const quads = ["urn:usf:a:1", "urn:usf:a:2"].flatMap(id => [
    quad(id, P + "type", T + "CliParallelSafetyAssessment"), quad(id, P + "forContract", CONTRACT)]);
  const result = deriveCliParallelSafety(graphOf(quads), CONTRACT, [LEFT, RIGHT], BASIS);
  assert.equal(result.assessment.state, "blocked");
  assert.deepEqual(result.assessment.reasonCodes, ["TRANSITION_PARALLEL_SAFETY_ASSESSMENT_AMBIGUOUS"]);
});

test("an assessment for a different contract is not admitted for this one", () => {
  const quads = [quad("urn:usf:a:1", P + "type", T + "CliParallelSafetyAssessment"),
    quad("urn:usf:a:1", P + "forContract", "urn:usf:contract:other:1")];
  assert.equal(deriveCliParallelSafety(graphOf(quads), CONTRACT, [LEFT, RIGHT], BASIS).assessment.state, "unproven");
});

test("every production CLI transition derives its scope by rule, so no static assessment can prove the cohort", () => {
  const production = loadSemanticGraph(fileURLToPath(new URL("../../..", import.meta.url)), "graph/manifests/cli-transition-definition.json");
  const members = production.quads
    .filter(q => q.predicate === P + "type" && q.objectKind === "iri" && q.object === T + "CliTransitionDescriptor")
    .map(q => q.subject);
  assert.ok(members.length > 0, "the production manifest declares transition descriptors");
  const rules = cliTransitionScopeDerivationRules(production, members);
  // This is the substantive blocker behind `unproven`: not missing machinery,
  // but that a scope produced by a rule cannot be compared as an authored path
  // list. A proved assessment needs scopes carrying their own derivation
  // evidence, which is a different evidence class from anything authored here.
  assert.ok(rules.length > 0, "at least one member's scope is rule-derived");
  const withoutRule = members.filter(member => cliTransitionScopeDerivationRules(production, [member]).length === 0);
  assert.deepEqual(withoutRule, [], "no production transition declares a statically complete scope");
});
