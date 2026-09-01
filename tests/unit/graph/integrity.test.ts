import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIntegrity, derivedOnlyTypes, terminalIdentifierKinds } from "../../../src/graph/integrity.ts";
import { canonicalQuadLine, type Quad } from "../../../src/graph/nquads.ts";

const graph = "urn:usf:graph:test";
function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "iri", g = graph): Quad {
  const built = { subject, predicate, object, objectKind, graph: g, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}
// The meta-type declares itself, exactly as the corpus vocabulary does; without
// it every fixture would trip undeclared-type on urn:usf:type:SemanticType.
const metaType = quad("urn:usf:type:SemanticType", "urn:usf:predicate:type", "urn:usf:type:SemanticType");
const declareType = (t: string) => quad(t, "urn:usf:predicate:type", "urn:usf:type:SemanticType");

test("a conforming corpus yields zero violations and says so explicitly", () => {
  const report = checkIntegrity([
    metaType,
    declareType("urn:usf:type:Widget"),
    quad("urn:usf:widget:alpha", "urn:usf:predicate:type", "urn:usf:type:Widget"),
  ]);
  assert.equal(report.conforming, true);
  assert.deepEqual(report.violations, []);
  // An empty violation list must never be ambiguous with "not evaluated".
  assert.equal(report.evaluated, true);
  assert.equal(report.checkedCodes.length, 12);
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
  const terminal = checkIntegrity([
    metaType,
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

test("violations are deterministically ordered so two runs agree", () => {
  const quads = [
    quad("urn:usf:widget:b", "urn:usf:predicate:type", "urn:usf:type:Missing"),
    quad("urn:usf:widget:a", "urn:usf:predicate:type", "urn:usf:type:AlsoMissing"),
  ];
  const first = checkIntegrity(quads);
  const second = checkIntegrity([...quads].reverse());
  assert.deepEqual(first.violations.map((v) => `${v.code}:${v.subject}`), second.violations.map((v) => `${v.code}:${v.subject}`));
});
