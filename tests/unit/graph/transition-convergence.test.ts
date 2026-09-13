import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deriveCliTransitionCoverage } from "../../../src/graph/cli-transitions.ts";
import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { transitionAdaptersForCoverage } from "../../../src/commands/transition.ts";

/**
 * USF-1192 requires that the parallel plan and the sequential semantic
 * transition interpreter converge on the same terminal required artifact set
 * for the same basis, and states plainly that any discrepancy is a correctness
 * failure.
 *
 * The wave projection is the parallel plan: Kahn layers over the artifact
 * dependency graph. The sequential interpreter is the same graph walked in
 * dependency order. They are derived by different code paths from the same
 * descriptors, so agreement is a real measurement rather than a tautology, and
 * disagreement would mean one of them is wrong about what the cohort produces.
 *
 * These assertions are also what stops parallel safety being inferred from
 * something it must never be inferred from. A wave membership is a topological
 * fact and nothing more; it is asserted here and denied everywhere else.
 */

const selection = {
  rootIdentity: "urn:usf:work:cli-transition-definition",
  manifestPath: "graph/manifests/cli-transition-definition.json",
};

function derive() {
  const graph = loadSemanticGraph(fileURLToPath(new URL("../../..", import.meta.url)), selection.manifestPath);
  return deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, transitionAdaptersForCoverage());
}

// The derivation is deterministic for one basis, which the last test proves by
// deriving twice. Every other test here asks a different question of the same
// result, so deriving it once is reuse rather than a cache: nothing between
// these tests can change the basis.
let memoized: ReturnType<typeof derive> | undefined;
const coverage = () => (memoized ??= derive());

/** Artifact identity as the descriptors carry it, on either side of a transition. */
function identityOf(entry: unknown): string {
  if (typeof entry === "string") return entry;
  const value = entry as { identity?: unknown };
  assert.equal(typeof value.identity, "string");
  return value.identity as string;
}

function sides(report: ReturnType<typeof coverage>) {
  const consumes = new Map<string, readonly string[]>();
  const produces = new Map<string, readonly string[]>();
  for (const descriptor of report.descriptors) {
    const identity = descriptor.identity as string;
    consumes.set(identity, ((descriptor.consumes ?? []) as readonly unknown[]).map(identityOf));
    produces.set(identity, ((descriptor.produces ?? []) as readonly unknown[]).map(identityOf));
  }
  return { consumes, produces };
}

test("the wave projection covers the required transition denominator exactly once", () => {
  const report = coverage();
  const flattened = report.waves.flat();
  const unique = new Set(flattened);
  assert.equal(flattened.length, unique.size, "a transition may not appear in two waves");
  const descriptors = new Set(report.descriptors.map(descriptor => descriptor.identity as string));
  assert.deepEqual([...unique].sort(), [...descriptors].sort(),
    "the parallel plan and the descriptor denominator must be the same set");
  const required = new Set(report.terminalClosure.assessment.requiredTransitions as readonly string[]);
  assert.deepEqual([...required].sort(), [...descriptors].sort(),
    "the required transition set and the derived descriptors must agree for this basis");
});

test("every wave member's consumed artifacts are produced strictly earlier", () => {
  const report = coverage();
  const { consumes, produces } = sides(report);
  const producedBefore = new Set<string>();
  const producedAnywhere = new Set([...produces.values()].flat());
  report.waves.forEach((wave, index) => {
    for (const transition of wave) {
      for (const artifact of consumes.get(transition) ?? []) {
        // An artifact nothing in this cohort produces is an external input and
        // constrains no ordering. One that is produced here must already exist.
        if (!producedAnywhere.has(artifact)) continue;
        assert.ok(producedBefore.has(artifact),
          `wave ${index} member ${transition} consumes ${artifact} before any earlier wave produces it`);
      }
    }
    for (const transition of wave) for (const artifact of produces.get(transition) ?? []) producedBefore.add(artifact);
  });
});

test("the parallel plan and the sequential interpreter derive the same terminal artifact set", () => {
  const report = coverage();
  const { consumes, produces } = sides(report);

  // Parallel plan: walk the waves and keep what is produced and never consumed.
  const parallelProduced = new Set<string>();
  const parallelConsumed = new Set<string>();
  for (const wave of report.waves) {
    for (const transition of wave) {
      for (const artifact of produces.get(transition) ?? []) parallelProduced.add(artifact);
      for (const artifact of consumes.get(transition) ?? []) parallelConsumed.add(artifact);
    }
  }
  const parallelTerminal = [...parallelProduced].filter(artifact => !parallelConsumed.has(artifact)).sort();

  // Sequential interpreter: the same question asked of the interpreter's own
  // derived closure rather than of the wave projection.
  const sequentialTerminal = [...report.terminalClosure.derived].sort();

  assert.deepEqual(parallelTerminal, sequentialTerminal,
    "a discrepancy between the parallel plan and the sequential interpreter is a correctness failure, not a scheduling detail");
  assert.ok(parallelTerminal.length > 0, "the cohort must terminate in at least one artifact");
});

test("the wave projection is topological only and never reports parallel safety", () => {
  const report = coverage();
  // The convergence proved above is a statement about artifacts, not about
  // concurrent execution. Nothing here may promote it into a safety claim.
  assert.equal(report.topologicalOnly, true);
  assert.equal(report.parallelSafety.state, "unproven");
  assert.equal(report.executionAuthority, "none");
  assert.ok((report.parallelSafety.missingObligations as readonly string[]).length > 0,
    "an unproven assessment must keep naming what is missing");
});

test("the derivation is deterministic for one basis", () => {
  const first = derive();
  const second = derive();
  assert.deepEqual(first.waves, second.waves);
  assert.deepEqual(first.terminalClosure.derived, second.terminalClosure.derived);
  assert.equal(first.digest, second.digest, "the same basis must derive the same interrogation digest");
});
