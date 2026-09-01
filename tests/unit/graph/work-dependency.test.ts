import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalQuadLine, type Quad } from "../../../src/graph/nquads.ts";
import {
  deriveStates, readDependencyGraph, readyUnits, stateCounts,
} from "../../../src/graph/work-dependency.ts";

const graph = "urn:usf:graph:test";
function edge(from: string, to: string): Quad {
  const built = { subject: from, predicate: "urn:usf:predicate:dependsOn", object: to, objectKind: "iri" as const, graph, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}
const U = (name: string) => `urn:usf:workunit:${name}`;

/** A,B -> C -> E and D -> F: two independent chains of differing depth. */
function fixture() {
  const units = ["a", "b", "c", "d", "e", "f"].map(U);
  const quads = [edge(U("c"), U("a")), edge(U("c"), U("b")), edge(U("e"), U("c")), edge(U("f"), U("d"))];
  return { units, quads };
}

test("the dependency graph is read from edges alone and is acyclic", () => {
  const { units, quads } = fixture();
  const dag = readDependencyGraph(quads, units);
  assert.equal(dag.acyclic, true);
  assert.deepEqual(dag.defects, []);
  assert.deepEqual(dag.dependencies.get(U("c")), [U("a"), U("b")]);
  assert.deepEqual(dag.dependencies.get(U("a")), []);
});

test("readiness is derived: only units whose dependencies all succeeded are ready", () => {
  const { units, quads } = fixture();
  const dag = readDependencyGraph(quads, units);

  const initial = deriveStates(dag, { succeeded: new Set(), failed: new Set() });
  assert.deepEqual(readyUnits(initial), [U("a"), U("b"), U("d")]);
  assert.deepEqual(stateCounts(initial), { ready: 3, blocked: 3, unreachable: 0, succeeded: 0, failed: 0 });

  // A alone is not enough for C: it also depends on B.
  const partial = deriveStates(dag, { succeeded: new Set([U("a")]), failed: new Set() });
  assert.equal(partial.get(U("c")), "blocked");

  const roots = deriveStates(dag, { succeeded: new Set([U("a"), U("b"), U("d")]), failed: new Set() });
  assert.deepEqual(readyUnits(roots), [U("c"), U("f")]);
  assert.equal(roots.get(U("e")), "blocked");

  const nearly = deriveStates(dag, { succeeded: new Set([U("a"), U("b"), U("c"), U("d"), U("f")]), failed: new Set() });
  assert.deepEqual(readyUnits(nearly), [U("e")]);
});

test("a failed dependency makes dependent work unreachable, transitively", () => {
  const { units, quads } = fixture();
  const dag = readDependencyGraph(quads, units);
  const states = deriveStates(dag, { succeeded: new Set([U("b")]), failed: new Set([U("a")]) });
  assert.equal(states.get(U("a")), "failed");
  assert.equal(states.get(U("c")), "unreachable", "C depends on the failed A");
  assert.equal(states.get(U("e")), "unreachable", "E depends on C, transitively unreachable");
  // The independent chain is untouched.
  assert.equal(states.get(U("d")), "ready");
  assert.equal(readyUnits(states).includes(U("d")), true);
});

test("a cycle is a defect, not a schedule", () => {
  const units = [U("x"), U("y"), U("z")];
  const dag = readDependencyGraph([edge(U("x"), U("y")), edge(U("y"), U("z")), edge(U("z"), U("x"))], units);
  assert.equal(dag.acyclic, false);
  assert.ok(dag.defects.some((defect) => defect.defect === "dependency-cycle"));
});

test("self-dependency and unknown dependency are refused", () => {
  const selfDag = readDependencyGraph([edge(U("x"), U("x"))], [U("x")]);
  assert.ok(selfDag.defects.some((defect) => defect.defect === "self-dependency"));
  const unknownDag = readDependencyGraph([edge(U("x"), U("absent"))], [U("x")]);
  assert.ok(unknownDag.defects.some((defect) => defect.defect === "unknown-dependency"));
});

test("derivation is deterministic and independent of declaration order", () => {
  const { units, quads } = fixture();
  const forward = readDependencyGraph(quads, units);
  const reversed = readDependencyGraph([...quads].reverse(), [...units].reverse());
  const left = deriveStates(forward, { succeeded: new Set(), failed: new Set() });
  const right = deriveStates(reversed, { succeeded: new Set(), failed: new Set() });
  assert.deepEqual(readyUnits(left), readyUnits(right));
  assert.deepEqual(stateCounts(left), stateCounts(right));
});
