import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkIntegrity, derivedOnlyTypes, terminalIdentifierKinds } from "../../../src/graph/integrity.ts";
import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { readRuntimeAuthority } from "../../../src/graph/runtime-authority.ts";
import { canonicalQuadLine, type Quad } from "../../../src/graph/nquads.ts";

const graph = "urn:usf:graph:test";
const P = "urn:usf:predicate:", T = "urn:usf:type:";
function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "iri", g = graph): Quad {
  const built = { subject, predicate, object, objectKind, graph: g, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}
// The meta-type declares itself, exactly as the corpus vocabulary does; without
// it every fixture would trip undeclared-type on urn:usf:type:SemanticType.
const metaType = quad("urn:usf:type:SemanticType", "urn:usf:predicate:type", "urn:usf:type:SemanticType");
const declareType = (t: string) => quad(t, "urn:usf:predicate:type", "urn:usf:type:SemanticType");
const declarePredicate = (p: string) => quad(p, "urn:usf:predicate:type", "urn:usf:type:SemanticPredicate");
// A fixture that asserts conformance must declare the vocabulary it uses, for
// the same reason the corpus does: a predicate the corpus uses is a predicate
// the corpus defines. These three quads are the smallest self-describing
// vocabulary -- the predicate meta-type, and `type` declaring itself.
const vocabulary = [metaType, declareType("urn:usf:type:SemanticPredicate"), declarePredicate("urn:usf:predicate:type")];

test("selected production CLI record specifications satisfy complete graph integrity", () => {
  const selectedGraph = loadSemanticGraph(fileURLToPath(new URL("../../..", import.meta.url)), "graph/manifests/cli-transition-definition.json");
  const report = checkIntegrity(selectedGraph.quads);

  const recordSpecifications = new Set(selectedGraph.quads.filter(quad =>
    quad.predicate === P + "type" && quad.objectKind === "iri" && quad.object === T + "CliRecordSpecification").map(quad => quad.subject));
  const sourceTypeRows = selectedGraph.quads.filter(quad => recordSpecifications.has(quad.subject) && quad.predicate === P + "sourceType" && quad.objectKind === "iri");
  assert(sourceTypeRows.length > 0);
  const sourceTypes = new Set(sourceTypeRows.map(quad => quad.object));
  const operationalFields = new Set(selectedGraph.quads.filter(quad => quad.subject.startsWith("urn:usf:cli-field-specification:field-operational-support-")
    && quad.predicate === P + "type" && quad.objectKind === "iri" && quad.object === T + "CliFieldSpecification").map(quad => quad.subject));
  assert(operationalFields.size > 0);
  assert.deepEqual(report.violations.filter(violation => sourceTypes.has(violation.subject) || operationalFields.has(violation.subject)), []);

  const missingType = structuredClone(selectedGraph);
  const sourceType = missingType.quads.find(quad => quad.subject === sourceTypeRows[0]!.subject && quad.predicate === P + "sourceType");
  assert.ok(sourceType);
  missingType.quads.splice(missingType.quads.indexOf(sourceType), 1, { ...sourceType, object: "urn:usf:type:MissingOperationalSupport:1" });
  const missingTypeReport = checkIntegrity(missingType.quads);
  assert.equal(missingTypeReport.conforming, false);
  assert(missingTypeReport.violations.some(violation =>
    violation.code === "dangling-reference" && violation.subject === "urn:usf:type:MissingOperationalSupport:1"));

  const malformedIdentity = "urn:usf:cli-field-specification:field-integrity-badName:1";
  const selectedField = selectedGraph.quads.find(quad => operationalFields.has(quad.subject)
    && quad.predicate === P + "type" && quad.objectKind === "iri" && quad.object === T + "CliFieldSpecification");
  assert.ok(selectedField);
  const malformedField = structuredClone(selectedGraph);
  malformedField.quads = malformedField.quads.map(quad => ({
    ...quad,
    subject: quad.subject === selectedField.subject ? malformedIdentity : quad.subject,
    object: quad.objectKind === "iri" && quad.object === selectedField.subject ? malformedIdentity : quad.object,
  }));
  const malformedFieldReport = checkIntegrity(malformedField.quads);
  assert.equal(malformedFieldReport.conforming, false);
  assert(malformedFieldReport.violations.some(violation =>
    violation.code === "instance-local-name-style" && violation.subject === malformedIdentity));
});

test("a conforming corpus yields zero violations and says so explicitly", () => {
  const report = checkIntegrity([
    ...vocabulary,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
  ]);
  assert.equal(report.conforming, true);
  assert.deepEqual(report.violations, []);
  // An empty violation list must never be ambiguous with "not evaluated".
  assert.equal(report.evaluated, true);
  assert.equal(report.checkedCodes.length, 16);
});

test("a phantom type is refused: no typo may invent a class", () => {
  const report = checkIntegrity([
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Wigdet"),
  ]);
  assert.equal(report.conforming, false);
  assert.ok(report.violations.some((v) => v.code === "undeclared-type" && v.subject === "urn:usf:type:Wigdet"));
});

test("a dangling reference is refused, but a terminal runtime identifier is not", () => {
  const dangling = checkIntegrity([
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:dependsOn", "urn:usf:widget:missing"),
  ]);
  assert.ok(dangling.violations.some((v) => v.code === "dangling-reference" && v.subject === "urn:usf:widget:missing"));

  // An output-schema identifier denotes a runtime value and is intentionally terminal.
  assert.ok(terminalIdentifierKinds.includes("cli-error"));
  // Every command output schema is a wire identity of the same class. A new
  // registered command adds one, and forgetting it surfaces as a dangling
  // reference on the command declaration rather than silently passing.
  assert.ok(terminalIdentifierKinds.includes("lane-census-result"));
  const terminal = checkIntegrity([
    ...vocabulary,
    declarePredicate("urn:usf:predicate:errorSchema"),
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:errorSchema", "urn:usf:cli-error:1"),
  ]);
  assert.equal(terminal.conforming, true);
});

test("ownership is unambiguous: a resource declares its type in exactly one graph", () => {
  const report = checkIntegrity([
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget", "iri", "urn:usf:graph:one"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget", "iri", "urn:usf:graph:two"),
  ]);
  assert.ok(report.violations.some((v) => v.code === "multiple-type-declaration" && v.subject === "urn:usf:widget:alpha"));
});

test("anti-self-warrant: a derived-only type may not be authored", () => {
  assert.ok(derivedOnlyTypes.includes("urn:usf:type:ExecutionResult"));
  const authored = checkIntegrity([
    declareType("urn:usf:type:ExecutionResult"),
    quad("urn:usf:execution-result:x", "urn:usf:predicate:type", "urn:usf:type:ExecutionResult", "iri", "urn:usf:graph:authored"),
  ]);
  assert.ok(authored.violations.some((v) => v.code === "derived-type-authored"));
  // The same assertion inside a derivation output is legitimate.
  const derived = checkIntegrity([
    declareType("urn:usf:type:ExecutionResult"),
    quad("urn:usf:execution-result:x", "urn:usf:predicate:type", "urn:usf:type:ExecutionResult", "iri", "urn:usf:graph:demo:results"),
  ]);
  assert.equal(derived.violations.some((v) => v.code === "derived-type-authored"), false);
});

test("nothing depends on itself", () => {
  const report = checkIntegrity([
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:dependsOn", "urn:usf:widget:alpha"),
  ]);
  assert.ok(report.violations.some((v) => v.code === "self-dependency"));
});

test("one deterministic local-name form per kind, and the kind segment cannot be hidden", () => {
  const styles = checkIntegrity([
    declareType("urn:usf:type:notPascal"),
    quad("urn:usf:widget:NotKebab", "urn:usf:predicate:NotCamel", "urn:usf:type:notPascal"),
  ]);
  const codes = new Set(styles.violations.map((v) => v.code));
  assert.ok(codes.has("type-local-name-style"));
  assert.ok(codes.has("predicate-local-name-style"));
  assert.ok(codes.has("instance-local-name-style"));

  // An era prefix in the kind position hides the kind.
  const shape = checkIntegrity([
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:v3:widget:alpha:1", "urn:usf:predicate:type", "urn:usf:type:Widget"),
  ]);
  assert.ok(shape.violations.some((v) => v.code === "iri-segment-shape"));
});

test("convention exemption covers style only, never a structural invariant", () => {
  const quads = [
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:NotKebab", "urn:usf:predicate:type", "urn:usf:type:Widget", "iri", "urn:usf:graph:legacy"),
    quad("urn:usf:widget:NotKebab", "urn:usf:predicate:dependsOn", "urn:usf:widget:NotKebab", "iri", "urn:usf:graph:legacy"),
  ];
  const exempt = checkIntegrity(quads, { conventionExemptGraphs: ["urn:usf:graph:legacy"] });
  const codes = new Set(exempt.violations.map((v) => v.code));
  assert.equal(codes.has("instance-local-name-style"), false, "style is exempt");
  assert.ok(codes.has("self-dependency"), "structure is never exempt");
  assert.deepEqual(exempt.exemptGraphs, ["urn:usf:graph:legacy"]);
});

test("a superseded resource may not be referenced as current", () => {
  const report = checkIntegrity([
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:new", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:old", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:new", "urn:usf:predicate:supersedes", "urn:usf:widget:old"),
    quad("urn:usf:widget:new", "urn:usf:predicate:activeAuthority", "urn:usf:widget:old"),
  ]);
  assert.ok(report.violations.some((v) => v.code === "superseded-still-referenced-as-current"));
});

test("the corpus states each fact once", () => {
  const one = quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget");
  const report = checkIntegrity([declareType("urn:usf:type:Widget"), one, one]);
  assert.ok(report.violations.some((v) => v.code === "duplicate-quad"));
});

test("a functional predicate may not carry two values", () => {
  // Two values is a contradiction, not extra information: a reader that resolves
  // it by taking the first or by defaulting silently does the wrong thing.
  const report = checkIntegrity([
    metaType,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:realizationMechanism", "DETERMINISTIC_GENERATOR", "literal"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:realizationMechanism", "EXTERNAL_TOOL", "literal"),
  ]);
  const conflict = report.violations.find((v) => v.code === "functional-predicate-conflict");
  assert.ok(conflict, "two values for a functional predicate must be refused");
  assert.match(conflict!.detail, /2 conflicting values/u);
  // One value is fine.
  const single = checkIntegrity([
    metaType,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:realizationMechanism", "EXTERNAL_TOOL", "literal"),
  ]);
  assert.equal(single.violations.some((v) => v.code === "functional-predicate-conflict"), false);
});

test("the declared functional-predicate set narrows the compiled fallback", () => {
  // The corpus states which predicates carry the single-value constraint. A
  // predicate whose several values are the intended state -- a transport's
  // selectedModel, one candidate per model so one exhausted quota cannot remove
  // the whole subscription -- is excluded there, and declaring the set must
  // actually stop the gate constraining it. Both directions are asserted,
  // because a reader that ignored the option would still pass the first.
  const twoModels = [
    metaType,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:selectedModel", "model-a", "literal"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:selectedModel", "model-b", "literal"),
  ];
  const conflictCode = (report: { violations: readonly { code: string }[] }): boolean =>
    report.violations.some((v) => v.code === "functional-predicate-conflict");

  // Declared set omits selectedModel: several values are authority, not a defect.
  assert.equal(conflictCode(checkIntegrity(twoModels, {
    functionalPredicates: ["urn:usf:predicate:realizationMechanism"],
  })), false);
  // No declaration: the compiled fallback still constrains it.
  assert.equal(conflictCode(checkIntegrity(twoModels)), true);
  // A predicate that is in the declared set is still constrained.
  assert.equal(conflictCode(checkIntegrity([
    metaType,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:beta", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:beta", "urn:usf:predicate:realizationMechanism", "A", "literal"),
    quad("urn:usf:widget:beta", "urn:usf:predicate:realizationMechanism", "B", "literal"),
  ], { functionalPredicates: ["urn:usf:predicate:realizationMechanism"] })), true);
  // An empty declared set is not an absent one and constrains nothing.
  assert.equal(conflictCode(checkIntegrity(twoModels, { functionalPredicates: [] })), false);
});

test("the runtime reads the functional-predicate set from graph authority", () => {
  // The scope is a graph fact the runtime reads; it does not carry a second copy.
  const declared = readRuntimeAuthority([
    quad("urn:usf:integrity-scope:corpus:1", "urn:usf:predicate:functionalPredicate", "urn:usf:predicate:pathPattern"),
    quad("urn:usf:integrity-scope:corpus:1", "urn:usf:predicate:functionalPredicate", "urn:usf:predicate:artefactKind"),
    quad("urn:usf:integrity-scope:other:1", "urn:usf:predicate:functionalPredicate", "urn:usf:predicate:ignored"),
  ]);
  assert.deepEqual(declared.functionalPredicates,
    ["urn:usf:predicate:artefactKind", "urn:usf:predicate:pathPattern"]);
  // Absent is distinguishable from empty, so a caller can fall back deliberately.
  assert.deepEqual(readRuntimeAuthority([]).functionalPredicates, []);
});

test("vocabulary the corpus uses is vocabulary the corpus declares", () => {
  // 126 predicates were in use without a declaration when this check landed.
  const report = checkIntegrity([
    ...vocabulary,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:undeclaredProbe", "x", "literal"),
  ]);
  assert.equal(report.conforming, false);
  assert.ok(report.violations.some((v) =>
    v.code === "undeclared-predicate" && v.subject === "urn:usf:predicate:undeclaredProbe"));
  // One violation per predicate, not one per use.
  const second = checkIntegrity([
    ...vocabulary,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:undeclaredProbe", "x", "literal"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:undeclaredProbe", "y", "literal"),
  ]);
  assert.equal(second.violations.filter((v) => v.code === "undeclared-predicate").length, 1);
});

test("every subject states what it is, and an isolated subject is refused", () => {
  // Four definition-only subjects sat in the corpus untyped and unreachable:
  // documentation shaped like authority. An untyped literal-only subject is
  // both untyped and its own component, so the two codes appear together.
  const report = checkIntegrity([
    ...vocabulary,
    declarePredicate("urn:usf:predicate:definition"),
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:stub:orphan", "urn:usf:predicate:definition", "a definition and nothing else", "literal"),
  ]);
  assert.equal(report.conforming, false);
  assert.ok(report.violations.some((v) => v.code === "untyped-subject" && v.subject === "urn:usf:stub:orphan"));
  assert.ok(report.violations.some((v) => v.code === "disconnected-graph" && v.subject === "urn:usf:stub:orphan"));
});

test("a declared type connects its instances, so only untyped subjects can island", () => {
  // Type-declaration edges make the corpus connected by construction: an
  // instance reaches its type, its type reaches the meta-type, and the
  // meta-type is in the vocabulary. A typed subject therefore cannot be an
  // island however little else references it, which is worth asserting because
  // it bounds what disconnected-graph can ever mean.
  const connected = checkIntegrity([
    ...vocabulary,
    declarePredicate("urn:usf:predicate:dependsOn"),
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:remote:a", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:remote:a", "urn:usf:predicate:dependsOn", "urn:usf:remote:b"),
    quad("urn:usf:remote:b", "urn:usf:predicate:type", "urn:usf:type:Widget"),
  ]);
  assert.equal(connected.componentCount, 1);
  assert.equal(connected.violations.filter((v) => v.code === "disconnected-graph").length, 0);

  // Two untyped subjects linked only to each other are one island, reported
  // once by their smallest member rather than once per member.
  const island = checkIntegrity([
    ...vocabulary,
    declarePredicate("urn:usf:predicate:dependsOn"),
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
    quad("urn:usf:island:b", "urn:usf:predicate:dependsOn", "urn:usf:island:a"),
    quad("urn:usf:island:a", "urn:usf:predicate:dependsOn", "urn:usf:island:b"),
  ]);
  const reported = island.violations.filter((v) => v.code === "disconnected-graph");
  assert.equal(reported.length, 1, "one violation per extra component, not per member");
  assert.equal(reported[0]!.subject, "urn:usf:island:a");
  assert.equal(island.componentCount, 2);
  assert.equal(island.violations.filter((v) => v.code === "untyped-subject").length, 2);
});

test("component reporting is a total order, so equal-sized islands never swap", () => {
  const quads = [
    quad("urn:usf:widget:b", "urn:usf:predicate:type", "urn:usf:type:Missing"),
    quad("urn:usf:widget:a", "urn:usf:predicate:type", "urn:usf:type:AlsoMissing"),
  ];
  const first = checkIntegrity(quads).violations.filter((v) => v.code === "disconnected-graph");
  const second = checkIntegrity([...quads].reverse()).violations.filter((v) => v.code === "disconnected-graph");
  assert.deepEqual(first.map((v) => v.subject), second.map((v) => v.subject));
});

test("violations are deterministically ordered so two runs agree", () => {
  const quads = [
    quad("urn:usf:widget:b", "urn:usf:predicate:type", "urn:usf:type:Missing"),
    quad("urn:usf:widget:a", "urn:usf:predicate:type", "urn:usf:type:AlsoMissing"),
  ];
  const first = checkIntegrity(quads);
  const second = checkIntegrity([...quads].reverse());
  assert.deepEqual(first.violations.map((v) => `${v.code}:${v.subject}`), second.violations.map((v) => `${v.code}:${v.subject}`));
});

test("the runtime reads declared dispatch bounds and distinguishes absent from invalid", () => {
  // The corpus states the default and the ceiling; the runtime reads them
  // rather than carrying a second copy. Before this was wired, the graph
  // declared 4 while the supervisor defaulted to 6 -- the runtime contradicted
  // its own authority, and nothing detected it.
  const constraint = "urn:usf:concurrency-constraint:execution:1";
  const declared = readRuntimeAuthority([
    quad(constraint, "urn:usf:predicate:defaultConcurrency", "5"),
    quad(constraint, "urn:usf:predicate:boundedCeiling", "16"),
  ]);
  assert.equal(declared.concurrencyDefault, 5);
  assert.equal(declared.concurrencyCeiling, 16);

  // Absent is null so a caller falls back deliberately, not by accident.
  const absent = readRuntimeAuthority([]);
  assert.equal(absent.concurrencyDefault, null);
  assert.equal(absent.concurrencyCeiling, null);

  // Two declared values are a contradiction, not a range. Taking the first
  // would silently pick one, so the bound reads as undeclared instead.
  const conflicting = readRuntimeAuthority([
    quad(constraint, "urn:usf:predicate:defaultConcurrency", "5"),
    quad(constraint, "urn:usf:predicate:defaultConcurrency", "9"),
  ]);
  assert.equal(conflicting.concurrencyDefault, null);

  // A non-numeric or out-of-range bound is not a bound.
  for (const bad of ["0", "-1", "many", "99999"]) {
    assert.equal(readRuntimeAuthority([quad(constraint, "urn:usf:predicate:defaultConcurrency", bad)]).concurrencyDefault, null, bad);
  }
});
