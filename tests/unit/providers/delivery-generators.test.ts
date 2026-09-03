import assert from "node:assert/strict";
import test from "node:test";
import { deterministicGenerators } from "../../../src/providers/delivery-generators.ts";
import { canonicalQuadLine } from "../../../src/graph/nquads.ts";

const P = "urn:usf:predicate:";
const graphIri = "urn:fixture:graph";

function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "literal") {
  const built = { subject, predicate: `${P}${predicate}`, object, objectKind, graph: graphIri, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}

const soa = "urn:usf:statement-of-applicability:fixture:1";
function decision(name: string, status: string, control: string): ReturnType<typeof quad>[] {
  const d = `urn:usf:applicability-decision:${name}`;
  const c = `urn:usf:framework-control:${name}`;
  return [
    quad(soa, "hasApplicabilityDecision", d, "iri"),
    quad(d, "decisionForControl", c, "iri"),
    quad(d, "applicabilityStatus", status),
    quad(d, "applicabilityRationale", `rationale for ${control}`),
    quad(c, "frameworkReference", control),
  ];
}

function graphOf(quads: readonly ReturnType<typeof quad>[]) {
  return {
    manifest: { schema: "urn:usf:graph-manifest:2" as const, version: 2 as const, imports: [], sources: [] },
    quads: [...quads], semanticDigest: `sha256:${"0".repeat(64)}`,
    graphDigests: {}, sourceDigests: {}, repositoryRoot: "/nonexistent-fixture-root",
  } as never;
}

const input = (graph: never) => ({
  graph, canonicalName: "statementofapplicability",
  artefactKind: "urn:usf:artefact-kind:report",
  canonicalPath: "apps/platform/assurance/statement-of-applicability.json",
  realizedPaths: [] as readonly string[],
});

test("the statement of applicability counts an undecided control as pending, never as excluded", () => {
  // The distinction is the whole point of the artefact. A control nobody
  // assessed is not the same as one deliberately excluded, and a statement that
  // cannot tell them apart is the compliance artefact the original refusal
  // existed to prevent.
  const graph = graphOf([
    quad(soa, "type", "urn:usf:type:StatementOfApplicability", "iri"),
    quad(soa, "approvalState", "prepared-not-certified"),
    ...decision("a51", "applicable", "A.5.1"),
    ...decision("a52", "not-applicable", "A.5.2"),
    ...decision("a53", "pending-assessment", "A.5.3"),
  ]);
  const produced = deterministicGenerators.assurance!(input(graph));
  assert.equal(produced.blocker, null);
  const document = JSON.parse(produced.content) as {
    completeness: Record<string, number>;
    controls: { control: string; applicability: string }[];
  };
  assert.deepEqual(document.completeness, {
    declared: 3, decided: 2, pending: 1, applicable: 1, notApplicable: 1,
  });
  // Pending is neither applicable nor not-applicable, and is not silently dropped.
  assert.equal(document.controls.length, 3);
  assert.equal(document.controls.find((row) => row.control === "A.5.3")!.applicability, "pending-assessment");
  // Controls are ordered by reference so two runs of the same authority agree.
  assert.deepEqual(document.controls.map((row) => row.control), ["A.5.1", "A.5.2", "A.5.3"]);
});

test("the statement of applicability is deterministic, which is what drift detection rests on", () => {
  // A realized artefact is re-derived and compared against the file to decide
  // whether authority has moved under it. If the generator were not byte-stable
  // for identical authority, every plan would report false drift and re-realize
  // the artefact forever.
  const quads = [
    quad(soa, "type", "urn:usf:type:StatementOfApplicability", "iri"),
    ...decision("a51", "applicable", "A.5.1"),
    ...decision("a834", "pending-assessment", "A.8.34"),
  ];
  const first = deterministicGenerators.assurance!(input(graphOf(quads)));
  // Same authority, different quad order: the projection must not depend on it.
  const second = deterministicGenerators.assurance!(input(graphOf([...quads].reverse())));
  assert.equal(first.content, second.content);
});

test("a corpus that states no control set refuses rather than projecting an empty statement", () => {
  // An empty statement of applicability would read as "no controls apply",
  // which is a far worse claim than declining to produce one.
  const produced = deterministicGenerators.assurance!(input(graphOf([])));
  assert.equal(produced.blocker, "CONTROL_SET_NOT_STATED");
  assert.equal(produced.content, "");
  const twoStatements = deterministicGenerators.assurance!(input(graphOf([
    quad(soa, "type", "urn:usf:type:StatementOfApplicability", "iri"),
    quad(`${soa}:other`, "type", "urn:usf:type:StatementOfApplicability", "iri"),
  ])));
  assert.equal(twoStatements.blocker, "CONTROL_SET_NOT_STATED");
});
