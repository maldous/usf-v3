import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJsonSchemaValidator } from "../../src/schema/index.ts";
import { deriveCliTerminalAssessment, deriveCliTransitionContext, deriveCliTransitionCoverage, deriveCliRecordSpecifications, deriveCliSchemas, deriveCliRecord, verifyCliDescriptorSchema } from "../../src/graph/cli-transitions.ts";
import { transitionAdaptersForCoverage } from "../../src/commands/transition.ts";
import type { SemanticGraph } from "../../src/graph/index.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../../src/graph/nquads.ts";

const P = "urn:usf:predicate:", T = "urn:usf:type:";
const work = "urn:test:work", profile = "urn:test:profile:1", contract = "urn:test:contract:1";

function terminalFixture() {
  const quads = ["cli-transition-definition", "v3-convention"].flatMap(name =>
    parseStrictNQuads(readFileSync(new URL("../../graph/" + name + ".nq", import.meta.url), "utf8"), "urn:usf:graph:" + name));
  quads.push(...parseStrictNQuads(readFileSync(new URL("../../graph/check-execution-intent.nq", import.meta.url), "utf8"), "urn:usf:graph:check-execution-intent"));
  const graph = { quads } as SemanticGraph;
  const root = "urn:usf:work:cli-transition-definition", declaration = "urn:usf:cli-terminal-closure:cli-transition-definition:1";
  const artifact = "urn:usf:cli-contract:local-preparation-artifact:1";
  const add = (subject: string, field: string, object: string) => graph.quads.push({ subject, predicate: P + field, object, objectKind: "iri", graph: "urn:test:terminal", canonical: "" });
  return { graph, root, declaration, artifact, add, run: () => deriveCliTerminalAssessment(graph, root) };
}

test("terminal census exposes real completion and recovery obligations, not merely sinks", () => {
  const f = terminalFixture(), before = JSON.stringify(f.graph), result = f.run();
  for (const id of ["urn:usf:proof:cli-transition-definition:completion", "urn:usf:evidence-requirement:cli-transition-definition:completion", "urn:usf:validation:cli-transition-definition", "urn:usf:rule:local-preparation-replay:1"]) {
    assert(result.nodes.some(n => n.identity === id), id);
  }
  assert(result.edges.some(e => e.predicate === P + "requiresEvidence"));
  assert(result.edges.some(e => e.predicate === P + "recoveryObligation"));
  assert(result.reasonCodes.includes("TRANSITION_TERMINAL_ARTIFACT_DECLARATION_MISSING"));
  assert.equal(result.structuralComplete, false); assert.equal(result.satisfaction, "unverified");
  assert(result.nodes.every(n => n.state === "unverified"));
  assert.deepEqual(f.run(), result); assert.equal(JSON.stringify(f.graph), before);
  const canonical = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  const validator = createJsonSchemaValidator({ $schema: canonical.$schema, $id: "urn:test:terminal-assessment:1", $ref: canonical.$id + "#/$defs/terminalAssessment" }, { dependencySchemas: [canonical] });
  assert.equal(validator.validate(result).valid, true);
  assert.equal(validator.validate({ ...result, satisfaction: "accepted" }).valid, false);
  assert.equal(validator.validate({ ...result, fields: { completion: true } }).valid, false);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.nodes));
});

test("declared terminal artifact can complete structural census without authenticating satisfaction", () => {
  const f = terminalFixture(); f.add(f.declaration, "terminalArtifact", f.artifact);
  assert.equal(f.run().reasonCodes.includes("TRANSITION_TERMINAL_REQUIRED_EDGE_MISSING"), false);
  const result = f.run();
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.structuralComplete, true); assert.equal(result.satisfaction, "unverified");
  assert.deepEqual(result.terminalArtifacts, [f.artifact]);
  assert(result.nodes.every(n => n.state === "unverified"));
  const moved = structuredClone(f.graph);
  moved.quads.push({ subject: "urn:test:unrelated", predicate: P + "text", object: "new authority basis", objectKind: "literal", graph: "urn:test:terminal", canonical: "" });
  const next = deriveCliTerminalAssessment(moved, f.root);
  assert.notEqual(next.semanticBasis, result.semanticBasis);
  assert.deepEqual(next.nodes, result.nodes);
});

test("terminal census refuses missing declarations, hidden obligations, wrong scopes and dependency cycles", () => {
  const mutations: [string, (f: ReturnType<typeof terminalFixture>) => void][] = [
    ["TRANSITION_TERMINAL_DECLARATION_MISSING_OR_AMBIGUOUS", f => { f.graph.quads = f.graph.quads.filter(q => !(q.object === f.declaration && q.predicate === P + "requires")); }],
    ["TRANSITION_TERMINAL_REQUIRED_EDGE_MISSING", f => { f.graph.quads = f.graph.quads.filter(q => !(q.subject === "urn:usf:proof:cli-transition-definition:completion" && q.predicate === P + "requiresEvidence")); }],
    ["TRANSITION_TERMINAL_NODE_SCOPE_CONFLICT", f => f.add(f.artifact, "work", "urn:test:wrong-work")],
    ["TRANSITION_TERMINAL_NODE_MISSING_OR_WRONG_TYPE", f => { f.graph.quads = f.graph.quads.filter(q => !(q.subject === "urn:usf:rule:local-preparation-replay:1" && q.predicate === P + "type")); }],
    ["TRANSITION_TERMINAL_CYCLE", f => f.add("urn:usf:cli-transition:local-contribution-prepare:1", "requiresTransition", "urn:usf:cli-transition:local-contribution-prepare:1")],
    ["TRANSITION_TERMINAL_TRANSITION_DENOMINATOR_CONFLICT", f => f.add(f.declaration, "transition", "urn:test:hidden-transition")],
    ["TRANSITION_ARTIFACT_PRODUCER_CONFLICT", f => f.add(f.artifact, "producer", "urn:test:second-producer")],
    ["TRANSITION_ARTIFACT_PRODUCER_CONFLICT", f => { f.add(f.declaration, "terminalArtifact", f.artifact); f.graph.quads = f.graph.quads.filter(q => !(q.object === f.artifact && q.predicate === P + "produces")); }],
  ];
  for (const [reason, mutate] of mutations) {
    const f = terminalFixture(); mutate(f); const result = f.run();
    assert(result.reasonCodes.includes(reason), JSON.stringify({ reason, actual: result.reasonCodes }));
    assert.equal(result.structuralComplete, false); assert.equal(result.satisfaction, "unverified");
  }
});

test("seeded foreign artifacts and depth hidden by early discovery refuse", () => {
  const f = terminalFixture(), foreign = "urn:test:foreign-artifact";
  for (const q of f.graph.quads.filter(q => q.subject === f.artifact)) f.graph.quads.push({ ...q, subject: foreign, canonical: "" });
  f.graph.quads = f.graph.quads.filter(q => !(q.subject === foreign && q.predicate === P + "work"));
  f.add(foreign, "work", "urn:test:foreign-work"); f.add(f.declaration, "terminalArtifact", foreign);
  assert(f.run().reasonCodes.includes("TRANSITION_TERMINAL_NODE_SCOPE_CONFLICT"));
  const deep = terminalFixture(); deep.add(deep.declaration, "terminalArtifact", deep.artifact);
  const limit = deep.graph.quads.find(q => q.subject === "urn:usf:cli-terminal-policy:bounded-obligations:1" && q.predicate === P + "maximumDepth")!;
  limit.object = "1";
  assert(deep.run().reasonCodes.includes("TRANSITION_TERMINAL_BOUNDS_EXCEEDED"));
  const badRule = terminalFixture();
  badRule.graph.quads = badRule.graph.quads.filter(q => !(q.subject === "urn:usf:cli-terminal-edge:0:1" && q.predicate === P + "traversalPredicate"));
  assert.equal(badRule.run().structuralComplete, false);
});

test("context derivation is shared, immutable and refuses mixed-kind or ambiguous selectors", () => {
  const f = fixture([[]]), before = JSON.stringify(f.graph);
  const context = deriveCliTransitionContext(f.graph, work);
  assert.equal(context.work, work); assert.equal(context.contract, contract); assert.equal(context.profile, profile);
  assert.deepEqual(context.diagnostics, []); assert.equal(context.executionAuthority, "none");
  assert(Object.isFrozen(context)); assert(Object.isFrozen(context.profileCandidates));
  assert.equal(JSON.stringify(f.graph), before);
  for (const [subject, field, object, kind] of [
    [work, "contract", "urn:test:second-contract", "iri"],
    [work, "contract", contract, "literal"],
    [profile, "selectsContract", contract, "literal"],
    [work, "type", T + "WorkPacket", "literal"],
  ] as const) {
    const bad = fixture([[]]); bad.add(subject, field, object, kind);
    const selected = deriveCliTransitionContext(bad.graph, work), report = bad.run();
    assert(selected.diagnostics.length > 0);
    for (const diagnostic of selected.diagnostics) assert(report.diagnostics.some(d => JSON.stringify(d) === JSON.stringify(diagnostic)));
    assert.equal(report.executionAuthority, "none");
  }
  f.add("urn:test:other-profile", "type", T + "RealisationProfile");
  f.add("urn:test:other-profile", "selectsContract", contract);
  assert.equal(deriveCliTransitionContext(f.graph, work).profile, null);
});

function addSubjectIdentity(graph: SemanticGraph, record: string): string {
  const id = record + "-identity", b = "urn:usf:cli-field-specification:";
  const add = (s: string, p: string, object: string, objectKind: "iri" | "literal" = "iri") => graph.quads.push({ subject: s, predicate: P + p, object, objectKind, graph: "urn:test:graph", canonical: "" });
  add(record, "fieldSpecification", id); add(id, "type", T + "CliFieldSpecification");
  add(id, "sourceRecord", record); add(id, "derivationDependency", record);
  add(id, "valueKind", b + "kind-iri:1"); add(b + "kind-iri:1", "type", T + "CliFieldValueKind");
  add(id, "derivationRule", b + "rule-subject-identity:1"); add(b + "rule-subject-identity:1", "type", T + "CliFieldDerivationRule");
  for (const [p, v] of Object.entries({ version: "1", outputProperty: "identity", collection: "false", minimumCardinality: "1", maximumCardinality: "1", minimumLength: "1", maximumLength: "4096", text: "Exact subject, not asserted identity." })) add(id, p, v, "literal");
  return id;
}

test("subject identity binds real subject rows and rejects asserted sources and ambiguous rules", () => {
  const f = specificationsFixture(), id = addSubjectIdentity(f.graph, f.record), subject = "urn:test:actual";
  f.add(subject, "type", T + "Example"); f.add(subject, "example", "value", "literal");
  const before = JSON.stringify(f.graph), specs = f.specs();
  const result = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, specs);
  assert.equal(result.value?.identity, subject);
  const provenance = result.derivations.find(d => d.fieldIdentity === id)!;
  assert.equal(provenance.sourceKind, "subject"); assert.equal(provenance.sourcePredicate, null);
  assert.equal(provenance.sourceDigest, canonicalQuadDigest(f.graph.quads.filter(q => q.subject === subject)));
  assert.equal(JSON.stringify(f.graph), before);
  assert.equal(createJsonSchemaValidator(deriveCliSchemas(specs).descriptorSchema).validate(result.value).valid, true);
  for (const [predicate, object, objectKind] of [["sourcePredicate", P + "example", "iri"], ["derivationRule", f.b + "rule-predicate-values:1", "iri"], ["valueKind", f.b + "kind-text:1", "iri"], ["collection", "true", "literal"]] as const) {
    const altered = structuredClone(f.graph);
    altered.quads.push({ subject: id, predicate: P + predicate, object, objectKind, graph: "urn:test:graph", canonical: "" });
    assert.equal(deriveCliRecordSpecifications(altered, { contractIdentity: contract }).structuralComplete, false);
  }
  f.add(subject, "identity", "urn:test:forged", "iri");
  const override = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs());
  assert.equal(override.valid, false); assert(override.gaps.some(g => g.reasonCode === "CLI_RECORD_FIELD_UNKNOWN"));
});

test("coverage accepts empty literals but refuses empty IRI terms and selectors", () => {
  const f = fixture([]);
  f.add("urn:test:record", "schemaFragment", "", "literal");
  assert.doesNotThrow(f.run);
  for (const term of ["subject", "predicate", "graph", "object"] as const) {
    const bad = fixture([]);
    bad.graph.quads.push({ subject: "urn:test:s", predicate: P + "p", graph: "urn:test:g", object: "urn:test:o", objectKind: "iri", canonical: "", [term]: "" });
    assert.throws(bad.run, /TRANSITION_INPUT_BOUNDS_EXCEEDED/);
  }
  for (const selection of [{ rootIdentity: "", manifestPath: "graph/test.json" }, { rootIdentity: work, manifestPath: "" }]) {
    assert.throws(() => deriveCliTransitionCoverage(f.graph, selection, f.inventory, []), /TRANSITION_INPUT_BOUNDS_EXCEEDED/);
  }
});

function specificationsFixture() {
  const f = fixture([]), b = "urn:usf:cli-field-specification:";
  const record = "urn:test:record:1", field = "urn:test:field:1", amendment = "urn:test:amendment:1";
  f.add(contract, "type", T + "SemanticContract");
  f.add(contract, "requires", record);
  f.add(amendment, "type", T + "CliFieldSpecificationAmendment"); f.add(amendment, "forContract", contract); f.add(amendment, "recordSpecification", record);
  f.add(record, "type", T + "CliRecordSpecification"); f.add(record, "fieldSpecification", field);
  for (const [p, v] of Object.entries({ version: "1", unknownFieldPolicy: "refuse", schemaFragment: "" })) f.add(record, p, v, "literal");
  f.add(record, "schemaIdentity", "urn:test:generated:1"); f.add(record, "sourceType", T + "Example"); f.add(record, "schemaDerivationRule", b + "rule-generate-schema:1");
  for (const name of ["generate-schema", "predicate-values", "operational-rule-required", "allowed-values", "record-alternatives"]) f.add(b + "rule-" + name + ":1", "type", T + "CliFieldDerivationRule");
  f.add(b + "kind-text:1", "type", T + "CliFieldValueKind");
  f.add(field, "type", T + "CliFieldSpecification"); f.add(field, "sourceRecord", record); f.add(field, "sourcePredicate", P + "example");
  f.add(P + "example", "type", T + "SemanticPredicate");
  f.add(field, "valueKind", b + "kind-text:1"); f.add(field, "derivationRule", b + "rule-predicate-values:1"); f.add(field, "derivationDependency", record);
  for (const [p, v] of Object.entries({ version: "1", outputProperty: "example", collection: "false", minimumCardinality: "1", maximumCardinality: "1", minimumLength: "1", maximumLength: "24", text: "Graph supplied field explanation." })) f.add(field, p, v, "literal");
  return { ...f, record, field, b, specs: () => deriveCliRecordSpecifications(f.graph, { contractIdentity: contract }) };
}

function replaceSpecificationValue(f: ReturnType<typeof specificationsFixture>, subject: string, predicate: string, value: string) {
  f.graph.quads.splice(0, f.graph.quads.length, ...f.graph.quads.map(q => q.subject === subject && q.predicate === P + predicate ? { ...q, object: value } : q));
}

function alternativesFixture() {
  const f = specificationsFixture(), branches = ["urn:test:branch-a:1", "urn:test:branch-b:1"];
  const recordRows = f.graph.quads.filter(q => q.subject === f.record);
  const fieldRows = f.graph.quads.filter(q => q.subject === f.field);
  f.graph.quads.splice(0, f.graph.quads.length, ...f.graph.quads.filter(q => q.subject !== f.field && !(q.subject === f.record && q.predicate === P + "fieldSpecification")));
  f.add(f.record, "discriminatorProperty", "example", "literal");
  for (const [i, branch] of branches.entries()) {
    const field = branch + "-tag";
    f.add("urn:test:amendment:1", "recordSpecification", branch);
    f.add(f.record, "recordAlternative", branch);
    f.graph.quads.push(...recordRows.map(q => ({ ...q, subject: branch, object:
      q.predicate === P + "fieldSpecification" ? field : q.predicate === P + "schemaFragment" ? "/$defs/branch" + i
        : q.predicate === P + "sourceType" ? T + "Branch" + i : q.object })));
    f.graph.quads.push(...fieldRows.map(q => ({ ...q, subject: field, object: q.object === f.record ? branch : q.object })));
    f.add(field, "allowedValue", i === 0 ? "proved" : "unproven", "literal");
  }
  const subject = "urn:test:assessment";
  const read = () => deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs());
  return { ...f, branches, subject, read };
}

test("allowed values generate const or enum and constrain ordinary and subject readers", () => {
  for (const values of [["yes"], ["yes", "no"]]) {
    const f = specificationsFixture(), subject = "urn:test:allowed";
    for (const value of values) f.add(f.field, "allowedValue", value, "literal");
    const schema = deriveCliSchemas(f.specs()).descriptorSchema!;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    if (values.length === 1) assert.equal(properties.example!.const, "yes");
    else assert.deepEqual(properties.example!.enum, [...values].sort());
    f.add(subject, "type", T + "Example"); f.add(subject, "example", "yes", "literal");
    assert.equal(deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs()).valid, true);
    replaceSpecificationValue(f, subject, "example", "other");
    assert.equal(deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs()).valid, false);
    assert.equal(createJsonSchemaValidator(schema).validate({ example: "other" }).valid, false);
  }
  const f = specificationsFixture(), subject = "urn:test:allowed", identity = addSubjectIdentity(f.graph, f.record);
  f.add(identity, "allowedValue", subject, "literal");
  f.add(subject, "type", T + "Example"); f.add(subject, "example", "yes", "literal");
  const read = () => deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs());
  assert.equal(read().valid, true);
  assert.equal(createJsonSchemaValidator(deriveCliSchemas(f.specs()).descriptorSchema).validate(read().value).valid, true);
  replaceSpecificationValue(f, identity, "allowedValue", "urn:test:other");
  assert.equal(read().valid, false);
});

test("allowed values reject missing rule, nonliteral, empty, oversized and incompatible domains", () => {
  const cases: ((f: ReturnType<typeof specificationsFixture>) => void)[] = [
    f => { f.graph.quads = f.graph.quads.filter(q => q.subject !== f.b + "rule-allowed-values:1"); },
    f => { f.add(f.field, "allowedValue", "urn:test:iri", "iri"); },
    f => { replaceSpecificationValue(f, f.field, "minimumLength", "0"); f.add(f.field, "allowedValue", "", "literal"); },
    f => { for (let i = 0; i < 64; i++) f.add(f.field, "allowedValue", "v" + i, "literal"); },
    f => { f.add(f.field, "allowedValue", "x".repeat(25), "literal"); },
    f => { replaceSpecificationValue(f, f.field, "valueKind", f.b + "kind-iri:1"); f.add(f.b + "kind-iri:1", "type", T + "CliFieldValueKind"); },
    ...["integer", "boolean", "record"].map(kind => (f: ReturnType<typeof specificationsFixture>) => {
      replaceSpecificationValue(f, f.field, "valueKind", f.b + "kind-" + kind + ":1"); f.add(f.b + "kind-" + kind + ":1", "type", T + "CliFieldValueKind");
    }),
  ];
  for (const [i, mutate] of cases.entries()) {
    const f = specificationsFixture(); f.add(f.field, "allowedValue", "yes", "literal"); mutate(f);
    assert.equal(f.specs().structuralComplete, false, "case " + i);
    assert.equal(deriveCliSchemas(f.specs()).descriptorSchema, null, "case " + i);
  }
  const bounded = specificationsFixture();
  for (let i = 0; i < 64; i++) bounded.add(bounded.field, "allowedValue", "v" + i, "literal");
  assert.equal(bounded.specs().structuralComplete, true);
});

test("union projection uses closed ordinary alternatives and preserves derivations without authority", () => {
  const f = alternativesFixture();
  assert.equal(f.specs().structuralComplete, true, JSON.stringify(f.specs().gaps));
  const schema = deriveCliSchemas(f.specs()).descriptorSchema!;
  assert.deepEqual(schema.oneOf, [{ $ref: "#/$defs/branch0" }, { $ref: "#/$defs/branch1" }]);
  f.add(f.subject, "type", T + "Example"); f.add(f.subject, "type", T + "Branch0");
  f.add(f.subject, "example", "proved", "literal");
  const result = f.read();
  assert.equal(result.valid, true, JSON.stringify(result.gaps));
  assert.deepEqual(result.value, { example: "proved" });
  assert.equal(result.executionAuthority, "none");
  assert.equal(result.derivations[0]!.fieldIdentity, f.branches[0] + "-tag");
  assert.equal(result.derivations[0]!.sourcePredicate, P + "example");
  assert.equal(result.variantDerivations.length, 1);
  const variant = result.variantDerivations[0]!;
  assert.equal(variant.recordIdentity, f.record);
  assert.equal(variant.subjectIdentity, f.subject);
  assert.equal(variant.selectedRecordIdentity, f.branches[0]);
  assert.equal(variant.derivationRule, f.b + "rule-record-alternatives:1");
  assert.deepEqual(variant.sourceGraphs, ["urn:test:graph"]);
  assert.equal(variant.sourceDigest, canonicalQuadDigest(f.graph.quads.filter(q => q.subject === f.subject && q.predicate === P + "type")));
  assert.equal(createJsonSchemaValidator(schema).validate(result.value).valid, true);
  assert.equal(createJsonSchemaValidator(schema).validate({ example: "proved", authority: true }).valid, false);
  assert.equal(f.run().parallelSafety.state, "unproven");
});

test("union specification rejects ambiguous, missing, recursive and incompatible alternatives", () => {
  const cases: ((f: ReturnType<typeof alternativesFixture>) => void)[] = [
    f => { f.graph.quads = f.graph.quads.filter(q => q.subject !== f.b + "rule-record-alternatives:1"); },
    f => { f.graph.quads = f.graph.quads.filter(q => q.predicate !== P + "discriminatorProperty"); },
    f => { f.add(f.record, "discriminatorProperty", "other", "literal"); },
    f => { f.add(f.record, "fieldSpecification", f.branches[0] + "-tag"); },
    f => { f.add(f.record, "recordAlternative", "urn:test:missing"); },
    f => { f.graph.quads = f.graph.quads.filter(q => !(q.subject === f.record && q.predicate === P + "recordAlternative" && q.object === f.branches[1])); },
    f => { for (let i = 0; i < 15; i++) f.add(f.record, "recordAlternative", "urn:test:extra:" + i); },
    f => { f.add(f.branches[0]!, "recordAlternative", f.record); },
    f => { f.add(f.record, "recordAlternative", f.record); },
    f => { replaceSpecificationValue(f, f.branches[0]!, "sourceType", T + "Example"); },
    f => { replaceSpecificationValue(f, f.branches[1]!, "sourceType", T + "Branch0"); },
    f => { replaceSpecificationValue(f, f.branches[1]!, "schemaIdentity", "urn:test:other-schema"); },
    f => { replaceSpecificationValue(f, f.branches[1] + "-tag", "allowedValue", "proved"); },
    f => { f.add(f.branches[0] + "-tag", "allowedValue", "extra", "literal"); },
    f => { f.graph.quads = f.graph.quads.filter(q => !(q.subject === f.branches[0] + "-tag" && q.predicate === P + "allowedValue")); },
    ...[["outputProperty", "other"], ["minimumCardinality", "0"], ["collection", "true"], ["valueKind", "urn:usf:cli-field-specification:kind-iri:1"]].map(([p, v]) => (f: ReturnType<typeof alternativesFixture>) => { replaceSpecificationValue(f, f.branches[0] + "-tag", p!, v!); }),
  ];
  for (const [i, mutate] of cases.entries()) {
    const f = alternativesFixture(); mutate(f);
    assert.equal(f.specs().structuralComplete, false, "case " + i);
    assert.equal(deriveCliSchemas(f.specs()).descriptorSchema, null, "case " + i);
  }
});

test("union data rejects absent or ambiguous branch types, mismatched tags and extra fields", () => {
  for (const types of [[], [T + "Example"], [T + "Branch0"], [T + "Example", T + "Branch0", T + "Branch1"]]) {
    const f = alternativesFixture(); for (const type of types) f.add(f.subject, "type", type);
    f.add(f.subject, "example", "proved", "literal"); assert.equal(f.read().valid, false, JSON.stringify(types));
  }
  for (const tag of [null, "unproven", "unknown"]) {
    const f = alternativesFixture(); f.add(f.subject, "type", T + "Example"); f.add(f.subject, "type", T + "Branch0");
    if (tag !== null) f.add(f.subject, "example", tag, "literal");
    assert.equal(f.read().valid, false);
  }
  const f = alternativesFixture(); f.add(f.subject, "type", T + "Example"); f.add(f.subject, "type", T + "Branch0");
  f.add(f.subject, "example", "proved", "literal"); f.add(f.subject, "extra", "value", "literal");
  assert.equal(f.read().valid, false);
});

test("graph specifications generate deterministic properties and semantic changes change schemas", () => {
  const f = specificationsFixture(), specs = f.specs();
  assert.equal(specs.structuralComplete, true, JSON.stringify(specs.gaps));
  const generated = deriveCliSchemas(specs); assert(generated.descriptorSchema);
  assert.equal(generated.descriptorSchema.$id, "urn:test:generated:1");
  assert.deepEqual(generated.interrogationDescriptorReference, { $ref: "urn:test:generated:1" });
  f.graph.quads.reverse(); assert.equal(deriveCliSchemas(f.specs()).digest, generated.digest);
  f.graph.quads = f.graph.quads.map(q => q.subject === f.field && q.predicate === P + "outputProperty" ? { ...q, object: "renamed" } : q);
  assert.notEqual(deriveCliSchemas(f.specs()).digest, generated.digest);
});

test("schema equality rederives graph authority and catches hand edits and stale semantics", () => {
  const f = specificationsFixture();
  const schema = deriveCliSchemas(f.specs()).descriptorSchema!;
  const selection = { contractIdentity: contract };
  const verified = verifyCliDescriptorSchema(f.graph, selection, schema);
  assert.equal(verified.matches, true);
  assert.equal(verified.executionAuthority, "none");
  assert.equal(verifyCliDescriptorSchema(f.graph, selection, { ...schema, additionalProperties: true }).reasonCode, "CLI_DESCRIPTOR_SCHEMA_DRIFT");
  assert.equal(verifyCliDescriptorSchema(f.graph, selection, undefined).matches, false);
  f.graph.quads = f.graph.quads.map(q => q.subject === f.field && q.predicate === P + "maximumLength" ? { ...q, object: "12" } : q);
  const stale = verifyCliDescriptorSchema(f.graph, selection, schema);
  assert.equal(stale.reasonCode, "CLI_DESCRIPTOR_SCHEMA_DRIFT");
  assert.notEqual(stale.sourceBasis, verified.sourceBasis);
  f.graph.quads = f.graph.quads.filter(q => q.predicate !== P + "fieldSpecification");
  assert.equal(verifyCliDescriptorSchema(f.graph, selection, schema).reasonCode, "CLI_SPECIFICATION_INCOMPLETE");
});

test("specification defects refuse generation without silently normalizing bounds or rules", () => {
  for (const [predicate, value] of [["maximumCardinality", "0"], ["maximumLength", "-1"], ["valueKind", "urn:test:unknown"], ["derivationRule", "urn:test:unknown"]]) {
    const f = specificationsFixture();
    f.graph.quads = f.graph.quads.map(q => q.subject === f.field && q.predicate === P + predicate ? { ...q, object: value! } : q);
    assert.equal(f.specs().structuralComplete, false); assert.equal(deriveCliSchemas(f.specs()).descriptorSchema, null);
  }
  const cycle = specificationsFixture(); cycle.add(cycle.field, "derivationDependency", cycle.field);
  assert(cycle.specs().gaps.some(g => g.reasonCode === "CLI_SPECIFICATION_CYCLE"));
  const duplicate = specificationsFixture();
  const copy = duplicate.graph.quads.filter(q => q.subject === duplicate.field).map(q => ({ ...q, subject: "urn:test:duplicate:1" }));
  duplicate.graph.quads.push(...copy); duplicate.add(duplicate.record, "fieldSpecification", "urn:test:duplicate:1");
  assert(duplicate.specs().gaps.some(g => g.reasonCode === "CLI_SPECIFICATION_PROPERTY_CONFLICT"));
  const incomplete = specificationsFixture(); incomplete.graph.quads = incomplete.graph.quads.filter(q => q.predicate !== P + "text");
  assert.equal(incomplete.specs().structuralComplete, false);
});

test("operational rules remain unresolved independently of generated structural schema", () => {
  const f = specificationsFixture(); f.add(f.field, "semanticRuleRequirement", f.b + "rule-operational-rule-required:1");
  assert.equal(f.specs().structuralComplete, true);
  const generated = deriveCliSchemas(f.specs()); assert(generated.descriptorSchema);
  assert.equal(generated.operationalGaps.length, 1); assert.equal(generated.executionAuthority, "none");
});

test("generic record values validate against generated schema with source derivations", () => {
  const f = specificationsFixture(), subject = "urn:test:value:1";
  f.add(subject, "type", T + "Example"); f.add(subject, "example", "graph value", "literal");
  const specs = f.specs(), result = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, specs);
  assert.equal(result.valid, true, JSON.stringify(result.gaps));
  assert.equal(result.complete, true);
  assert.equal(result.executionAuthority, "none");
  assert.equal(result.value?.example, "graph value");
  assert.equal(createJsonSchemaValidator(deriveCliSchemas(specs).descriptorSchema).validate(result.value).valid, true);
  assert.equal(result.derivations[0]!.sourcePredicate, P + "example");
  assert.equal(result.derivations[0]!.explanation, "Graph supplied field explanation.");
  assert.deepEqual(result.derivations[0]!.dependencies, [f.record]);
  assert(Object.isFrozen(result.value));
  f.add(subject, "unexpected", "no", "literal");
  const invalid = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs());
  assert.equal(invalid.value, null); assert(invalid.gaps.some(g => g.reasonCode === "CLI_RECORD_FIELD_UNKNOWN"));
  assert.equal(deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, specs).valid, false);
});

test("coverage projects descriptors only through the graph-generated record contract", () => {
  const f = specificationsFixture(), subject = "urn:test:transition:1", ownerField = "urn:test:owner-field:1";
  const copy = f.graph.quads.filter(q => q.subject === f.field).map(q => ({ ...q, subject: ownerField,
    object: q.predicate === P + "sourcePredicate" ? P + "owner" : q.predicate === P + "outputProperty" ? "owner"
      : q.predicate === P + "valueKind" ? f.b + "kind-iri:1" : q.predicate === P + "maximumLength" ? "4096" : q.object }));
  f.graph.quads.push(...copy);
  f.add(f.record, "fieldSpecification", ownerField);
  f.add(f.b + "kind-iri:1", "type", T + "CliFieldValueKind");
  f.add(P + "owner", "type", T + "SemanticPredicate");
  f.add(work, "transition", subject);
  f.add(subject, "type", T + "CliTransitionDescriptor");
  f.add(subject, "owner", contract);
  f.add(subject, "example", "typed value", "literal");
  const sourceType = f.graph.quads.find(q => q.subject === f.record && q.predicate === P + "sourceType")!;
  f.graph.quads.splice(f.graph.quads.indexOf(sourceType), 1, { ...sourceType, object: T + "CliTransitionDescriptor" });
  const report = f.run();
  assert.equal(report.descriptors.length, 1, JSON.stringify(report.diagnostics));
  assert.equal(report.descriptors[0]!.example, "typed value");
  assert.equal(report.descriptors[0]!.owner, contract);
  assert.equal("fields" in report.descriptors[0]!, false);
  assert.equal(createJsonSchemaValidator(deriveCliSchemas(f.specs()).descriptorSchema).validate(report.descriptors[0]).valid, true);
  assert.equal(report.executionAuthority, "none");
  assert.equal(report.parallelSafety.state, "unproven");
  assert.equal(report.terminalClosure.equal, false);
  f.add(subject, "unregisteredInput", "do not interpret", "literal");
  assert.deepEqual(f.run().descriptors, []);
  assert(f.run().diagnostics.some(d => d.reasonCode === "CLI_RECORD_FIELD_UNKNOWN"));
});

test("record cardinality, kinds, bounds and operational rules fail closed", () => {
  for (const value of [null, "x".repeat(25), "urn:test:wrong-kind"]) {
    const f = specificationsFixture(), subject = "urn:test:value:1"; f.add(subject, "type", T + "Example");
    if (value !== null) f.add(subject, "example", value, value.startsWith("urn:") ? "iri" : "literal");
    const r = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs());
    assert.equal(r.valid, false); assert.equal(r.value, null);
  }
  const f = specificationsFixture(), subject = "urn:test:value:1";
  f.add(subject, "type", T + "Example"); f.add(subject, "example", "value", "literal");
  f.add(f.field, "semanticRuleRequirement", f.b + "rule-operational-rule-required:1");
  const result = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, f.specs());
  assert.equal(result.value?.example, "value");
  assert.equal(result.valid, true);
  assert.equal(result.complete, false);
  assert.equal(result.gaps.length, 0);
  assert(result.operationalGaps.some(g => g.reasonCode === "CLI_OPERATIONAL_RULE_UNRESOLVED"));
  assert.equal(result.executionAuthority, "none");
});

test("zero-minimum collections remain present while zero-minimum scalars are optional", () => {
  for (const collection of [true, false]) {
    const f = specificationsFixture(), subject = "urn:test:empty-value";
    replaceSpecificationValue(f, f.field, "minimumCardinality", "0");
    replaceSpecificationValue(f, f.field, "collection", String(collection));
    f.add(subject, "type", T + "Example");
    const specs = f.specs();
    assert.equal(specs.structuralComplete, true, JSON.stringify(specs.gaps));
    const result = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, specs);
    assert.equal(result.valid, true, JSON.stringify(result.gaps));
    assert.deepEqual(result.value, collection ? { example: [] } : {});
    assert.equal(result.executionAuthority, "none");
    const validator = createJsonSchemaValidator(deriveCliSchemas(specs).descriptorSchema);
    assert.equal(validator.validate(result.value).valid, true);
    assert.equal(validator.validate({}).valid, !collection);
  }
});

test("record scalar conversions preserve integer and boolean semantics", () => {
  for (const [kind, literal, expected] of [["integer", "12", 12], ["boolean", "false", false]] as const) {
    const f = specificationsFixture(), subject = "urn:test:value:1";
    f.add(f.b + "kind-" + kind + ":1", "type", T + "CliFieldValueKind");
    if (kind === "integer") { f.add(f.field, "minimumValue", "0", "literal"); f.add(f.field, "maximumValue", "24", "literal"); }
    f.add(subject, "type", T + "Example"); f.add(subject, "example", literal, "literal");
    f.graph.quads = f.graph.quads.map(q => q.subject === f.field && q.predicate === P + "valueKind" ? { ...q, object: f.b + "kind-" + kind + ":1" } : q);
    const specs = f.specs(), result = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: subject }, specs);
    assert.equal(result.value?.example, expected);
    assert.equal(createJsonSchemaValidator(deriveCliSchemas(specs).descriptorSchema).validate(result.value).valid, true);
    f.graph.quads = f.graph.quads.map(q => q.subject === f.field && q.predicate === P + "maximumLength" ? { ...q, object: kind === "boolean" ? "3" : "1" } : q);
    const incompatible = f.specs();
    assert.equal(incompatible.structuralComplete, false);
    assert(incompatible.gaps.some(g => g.reasonCode === "CLI_SPECIFICATION_LEXICAL_BOUNDS_INCOMPATIBLE"));
    assert.equal(deriveCliSchemas(incompatible).descriptorSchema, null);
  }
});

test("graph record references generate subrecord definitions and reject recursive records", () => {
  const f = specificationsFixture(), nested = "urn:test:nested-record:1", nestedField = "urn:test:nested-field:1";
  const copy = f.graph.quads.filter(q => q.subject === f.record || q.subject === f.field).map(q => ({ ...q,
    subject: q.subject === f.record ? nested : nestedField,
    object: q.object === f.record ? nested : q.object === f.field ? nestedField : q.object,
  }));
  f.graph.quads.push(...copy); f.add("urn:test:amendment:1", "recordSpecification", nested);
  f.add(f.b + "kind-record:1", "type", T + "CliFieldValueKind");
  f.add(f.field, "recordSpecification", nested);
  f.graph.quads = f.graph.quads.map(q => q.subject === nested && q.predicate === P + "schemaFragment" ? { ...q, object: "/$defs/nested" }
    : q.subject === f.field && q.predicate === P + "valueKind" ? { ...q, object: f.b + "kind-record:1" } : q);
  const s = f.specs(); assert.equal(s.structuralComplete, true, JSON.stringify(s.gaps));
  const generated = deriveCliSchemas(s).descriptorSchema!;
  assert.deepEqual((generated.properties as Record<string, unknown>).example, { $ref: "#/$defs/nested", description: "Graph supplied field explanation." });
  assert((generated.$defs as Record<string, unknown>).nested);
  for (const [subject, predicate, object, objectKind] of [
    ["urn:test:parent", P + "type", T + "Example", "iri"],
    ["urn:test:parent", P + "example", "urn:test:child", "iri"],
    ["urn:test:child", P + "type", T + "Example", "iri"],
    ["urn:test:child", P + "example", "nested value", "literal"],
  ] as const) f.graph.quads.push({ subject, predicate, object, objectKind, graph: "urn:test:graph", canonical: "" });
  const nestedResult = deriveCliRecord(f.graph, { recordIdentity: f.record, subjectIdentity: "urn:test:parent" }, f.specs());
  assert.equal(nestedResult.valid, true, JSON.stringify(nestedResult.gaps));
  assert.equal(createJsonSchemaValidator(generated).validate(nestedResult.value).valid, true);
  assert.deepEqual(nestedResult.derivations.map(d => d.outputPath), [["example"], ["example", "example"]]);
  const collectionGraph = structuredClone(f.graph);
  collectionGraph.quads = collectionGraph.quads.map(q => q.subject === f.field && q.predicate === P + "collection" ? { ...q, object: "true" }
    : q.subject === f.field && q.predicate === P + "maximumCardinality" ? { ...q, object: "2" } : q);
  for (const [subject, predicate, object, objectKind] of [
    ["urn:test:parent", P + "example", "urn:test:other-child", "iri"],
    ["urn:test:other-child", P + "type", T + "Example", "iri"],
    ["urn:test:other-child", P + "example", "nested value", "literal"],
  ] as const) collectionGraph.quads.push({ subject, predicate, object, objectKind, graph: "urn:test:graph", canonical: "" });
  const collectionSpecs = deriveCliRecordSpecifications(collectionGraph, { contractIdentity: contract });
  const collision = deriveCliRecord(collectionGraph, { recordIdentity: f.record, subjectIdentity: "urn:test:parent" }, collectionSpecs);
  assert.equal(collision.valid, false);
  assert.equal(collision.value, null);
  assert(collision.gaps.some(g => g.reasonCode === "CLI_RECORD_PROJECTION_COLLISION"));
  assert.deepEqual([...new Set(collision.derivations.map(d => d.subjectIdentity))].sort(), ["urn:test:child", "urn:test:other-child", "urn:test:parent"]);
  addSubjectIdentity(collectionGraph, f.record); addSubjectIdentity(collectionGraph, nested);
  const identifiedSpecs = deriveCliRecordSpecifications(collectionGraph, { contractIdentity: contract });
  const identified = deriveCliRecord(collectionGraph, { recordIdentity: f.record, subjectIdentity: "urn:test:parent" }, identifiedSpecs);
  assert.equal(identified.valid, true, JSON.stringify(identified.gaps));
  assert.equal(identified.value?.identity, "urn:test:parent");
  const children = identified.value?.example as readonly { readonly identity: string }[];
  assert.deepEqual(children.map(c => c.identity), ["urn:test:child", "urn:test:other-child"]);
  assert.equal(createJsonSchemaValidator(deriveCliSchemas(identifiedSpecs).descriptorSchema).validate(identified.value).valid, true);
  f.graph.quads.push({ subject: nestedField, predicate: P + "recordSpecification", object: f.record, objectKind: "iri", graph: "urn:test:graph", canonical: "" });
  f.graph.quads = f.graph.quads.map(q => q.subject === nestedField && q.predicate === P + "valueKind" ? { ...q, object: f.b + "kind-record:1" } : q);
  assert(f.specs().gaps.some(g => g.reasonCode === "CLI_SPECIFICATION_CYCLE"));
});

test("record discovery cannot substitute reverse amendments or foreign contracts for required closure", () => {
  for (const foreign of [false, true]) {
    const f = specificationsFixture();
    f.graph.quads = f.graph.quads.filter(q => !(q.subject === contract && q.predicate === P + "requires" && q.object === f.record));
    if (foreign) f.graph.quads.push({ subject: "urn:test:foreign-contract", predicate: P + "requires", object: f.record, objectKind: "iri", graph: "urn:test:graph", canonical: "" });
    const specs = f.specs();
    assert.equal(specs.structuralComplete, false);
    assert(specs.gaps.some(g => g.reasonCode === "CLI_SPECIFICATION_OUTSIDE_REQUIRED_CLOSURE"));
    assert.equal(deriveCliSchemas(specs).descriptorSchema, null);
  }
  assert.equal(alternativesFixture().specs().structuralComplete, true);
});

test("typed safety schema represents assessments without authenticating proof or granting execution", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-interrogation.schema.json", import.meta.url), "utf8"));
  const descriptor = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.parallelSafety.$ref, descriptor.$id + "#/$defs/parallelSafety");
  assert.equal(schema.properties.topologicalOnly.type, "boolean");
  const validator = createJsonSchemaValidator(schema, { dependencySchemas: [descriptor] });
  const report = fixture([[], []]).run();
  assert.equal(report.parallelSafety.state, "unproven");
  assert.equal(report.topologicalOnly, true);
  const members = ["urn:test:left", "urn:test:right"];
  const basis = { assessedPairCount: 1, requiredPairCount: 1, currentnessRule: "urn:test:currentness",
    obligations: ["urn:test:obligation"], realisationBasis: "urn:test:basis", resourceDigest: "sha256:fixture-resource",
    scopeDigest: "sha256:fixture-scope", semanticDigest: "sha256:fixture-semantic",
    verificationEvidence: ["urn:test:unverified-evidence"], verifier: "urn:test:unverified-verifier" };
  const pair = { left: members[0], right: members[1], outcome: "compatible", rule: "urn:test:pair-rule",
    evidence: ["urn:test:unverified-evidence"], leftRead: [], leftWrite: ["src/left.ts"], rightRead: [],
    rightWrite: ["src/right.ts"], leftResources: [], rightResources: [], conflicts: [] };
  // These are deliberately unauthenticated shape fixtures, not proof receipts.
  const proved = { state: "proved", members, semanticBasis: basis.semanticDigest,
    assessmentRule: "urn:test:assessment", basis, pairs: [pair], conflicts: [] };
  const shaped = { ...report, parallelSafety: proved };
  assert.equal(validator.validate(shaped).valid, true);
  assert.equal(shaped.executionAuthority, "none");
  assert.equal(validator.validate({ ...shaped, executionAuthority: "execute" }).valid, false);
  for (const key of ["basis", "assessmentRule", "members", "semanticBasis", "pairs", "conflicts"] as const) {
    const incomplete: Record<string, unknown> = { ...proved }; delete incomplete[key];
    assert.equal(validator.validate({ ...report, parallelSafety: incomplete }).valid, false, key);
  }
  for (const key of Object.keys(basis)) {
    const incomplete: Record<string, unknown> = { ...basis }; delete incomplete[key];
    assert.equal(validator.validate({ ...report, parallelSafety: { ...proved, basis: incomplete } }).valid, false, key);
  }
  const conflict = { left: members[0], right: members[1], kind: "path-overlap", resource: "src/shared.ts",
    rule: "urn:test:conflict-rule", evidence: ["urn:test:observation"] };
  const blocked = { state: "blocked", members, semanticBasis: basis.semanticDigest, assessmentRule: proved.assessmentRule,
    reasonCodes: ["PATH_CONFLICT"], conflicts: [conflict], evidence: [], missingObligations: [] };
  assert.equal(validator.validate({ ...report, parallelSafety: blocked }).valid, true);
  assert.equal(validator.validate({ ...report, parallelSafety: { ...proved, conflicts: [conflict] } }).valid, false);
  for (const safety of [
    { ...proved, fields: {} }, { ...proved, basis: { ...basis, fields: {} } },
    { ...proved, pairs: [{ ...pair, fields: {} }] }, { ...blocked, conflicts: [{ ...conflict, fields: {} }] },
    { ...report.parallelSafety, fields: {} }, { ...proved, pairs: [{ ...pair, outcome: "unknown" }] },
  ]) assert.equal(validator.validate({ ...report, parallelSafety: safety }).valid, false);
});

test("canonical local request rejects caller-authored authority and operational escape fields", () => {
  const descriptor = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  const validator = createJsonSchemaValidator({ $schema: descriptor.$schema, $id: "urn:test:local-request-validation:1", $ref: descriptor.$id + "#/$defs/localPreparationRequest" }, { dependencySchemas: [descriptor] });
  const request = { rootIdentity: "urn:test:work", manifestPath: "graph/test.json", operations: [{ kind: "write", path: "src/example.ts", content: "" }] };
  assert.equal(validator.validate(request).valid, true);
  assert.equal(validator.validate({ ...request, operations: [{ kind: "delete", path: "src/example.ts" }] }).valid, true);
  for (const key of ["basis", "profile", "executionAuthority", "parallelSafety", "fields", "provider", "expectedDigest"]) {
    assert.equal(validator.validate({ ...request, [key]: "caller-supplied" }).valid, false, key);
  }
  for (const operation of [
    { ...request.operations[0], expectedDigest: "sha256:forged" },
    { ...request.operations[0], fields: {} },
    { kind: "delete", path: "src/example.ts", content: "undeclared" },
    { kind: "execute", path: "src/example.ts" },
  ]) assert.equal(validator.validate({ ...request, operations: [operation] }).valid, false);
  assert.equal(validator.validate({ ...request, operations: [] }).valid, false);
  assert.equal(validator.validate({ ...request, operations: Array.from({ length: 65 }, () => request.operations[0]) }).valid, false);
  // Schema validation does not prove path permission, preimages, or construction currentness.
});

test("schema separates semantic completeness from authority without admitting parallel claims", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-interrogation.schema.json", import.meta.url), "utf8"));
  const descriptor = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  const validator = createJsonSchemaValidator(schema, { dependencySchemas: [descriptor] });
  assert.equal(schema.properties.descriptors.items.$ref, descriptor.$id);
  assert.equal(schema.$defs.descriptor, undefined);
  const report = fixture([[]]).run();
  const legacyDescriptor = { id: "urn:test:legacy", fields: { mode: "inspect" } };
  assert.equal(validator.validate({ ...report, descriptors: [legacyDescriptor] }).valid, false);
  assert.equal(createJsonSchemaValidator(descriptor).validate(legacyDescriptor).valid, false);
  assert.deepEqual(report.descriptors, []);
  assert.equal(validator.validate(report).valid, true);
  // Shape representability is not authentication of the hypothetical completed report.
  assert.equal(validator.validate({ ...report, complete: true, reasonCode: "TRANSITION_COVERAGE_COMPLETE" }).valid, true);
  assert.equal(validator.validate({ ...report, executionAuthority: "execute" }).valid, false);
  assert.equal(validator.validate({ ...report, parallelSafety: "proved" }).valid, false);
  assert.equal(validator.validate({ ...report, undocumentedNextAction: "execute" }).valid, false);
  assert.throws(() => createJsonSchemaValidator(schema), { reasonCode: "SCHEMA_REF_EXTERNAL" });
});
function fixture(edges: readonly (readonly number[])[]) {
  const quads: SemanticGraph["quads"] = [];
  const add = (subject: string, field: string, object: string, objectKind: "iri" | "literal" = "iri") => quads.push({ subject, predicate: P + field, object, objectKind, graph: "urn:test:graph", canonical: "" });
  add(work, "type", T + "WorkPacket"); add(work, "contract", contract);
  add(profile, "type", T + "RealisationProfile"); add(profile, "selectsContract", contract);
  add(contract, "requires", "urn:test:requirement");
  const id = (i: number) => `urn:test:node:${i}`;
  const artifact = (i: number) => `urn:test:artifact:${i}`;
  edges.forEach((parents, i) => {
    const node = id(i), effect = node + ":effect", input = node + ":input", recovery = node + ":recovery";
    add(work, "transition", node); add(node, "type", T + "CliTransitionDescriptor");
    for (const [field, value] of Object.entries({ owner: contract, command: node + ":command", inputContract: input, effectContract: effect, recoveryContract: recovery })) add(node, field, value);
    for (const [field, value] of Object.entries({ version: "1", commandPath: JSON.stringify(["arbitrary", "nested", String(i)]), mode: "inspect", adapter: "inspect", preconditionEvaluator: "pre", currentnessEvaluator: "current", postconditionEvaluator: "post" })) add(node, field, value, "literal");
    add(input, "type", T + "CliInputContract"); add(input, "schema", "urn:test:schema:1");
    add(effect, "type", T + "CliEffectContract");
    for (const [field, value] of Object.entries({ effectClass: "observation", contact: "none", guard: "none", claimPolicy: "none", readbackEvaluator: "read", scopePolicy: "explicit" })) add(effect, field, value, "literal");
    add(recovery, "type", T + "CliRecoveryContract");
    for (const field of ["recoveryReader", "intentIdentity", "irreversibleBoundary", "unknownOutcome"]) add(recovery, field, "observation-only", "literal");
    add(node, "produces", artifact(i)); add(artifact(i), "type", T + "CliArtifactContract");
    for (const [field, value] of Object.entries({ schema: "urn:test:artifact-schema:1", producer: node, work, profile })) add(artifact(i), field, value);
    for (const [field, value] of Object.entries({ version: "1", basisIdentity: "test-basis", digestDomain: "canonical-json", authenticatingReader: "fixture-reader" })) add(artifact(i), field, value, "literal");
    for (const parent of parents) { add(node, "requiresTransition", id(parent)); add(node, "consumes", artifact(parent)); }
    if (!edges.some(other => other.includes(i))) add(work, "terminalArtifact", artifact(i));
  });
  const graph: SemanticGraph = { quads, manifest: { schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [] }, semanticDigest: "untrusted", graphDigests: {}, sourceDigests: {}, repositoryRoot: "/unused" };
  const inventory = { complete: true, leaves: edges.map((_, i) => ({ path: ["arbitrary", "nested", String(i)], owner: contract, parserOwner: "fixture-parser" })) };
  const run = () => deriveCliTransitionCoverage(graph, { rootIdentity: work, manifestPath: "graph/test.json" }, inventory, [{ id: "inspect", effectClass: "observation" }]);
  return { graph, inventory, add, run };
}

test("all forward DAGs of four arbitrary nodes agree with a serial terminal oracle", () => {
  const possible = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] as const;
  for (let mask = 0; mask < 64; mask++) {
    const edges: number[][] = [[], [], [], []];
    possible.forEach(([from, to], bit) => { if (mask & (1 << bit)) edges[to]!.push(from); });
    const f = fixture(edges), report = f.run();
    assert.equal(report.complete, false);
    assert(report.diagnostics.some(d => d.reasonCode === "TRANSITION_EVALUATORS_UNAUTHENTICATED"));
    assert.equal(report.topologicalOnly, true);
    assert.equal(report.parallelSafety.state, "unproven");
    const serial = new Set<string>();
    for (let i = 0; i < 4; i++) { for (const p of edges[i]!) assert(serial.has(`urn:test:node:${p}`)); serial.add(`urn:test:node:${i}`); }
    assert.deepEqual([...new Set(report.waves.flat())].sort(), [...serial].sort());
    const expectedTerminal = edges.map((_, i) => i).filter(i => !edges.some(parents => parents.includes(i))).map(i => `urn:test:artifact:${i}`);
    assert.deepEqual(report.terminalClosure.derived, expectedTerminal);
    assert.equal(report.terminalClosure.equal, false);
    assert(report.diagnostics.some(d => d.reasonCode === "TRANSITION_TERMINAL_OBLIGATIONS_UNAUTHENTICATED"));
    const before = JSON.stringify(f.graph);
    assert.equal(f.run().digest, report.digest); assert.equal(JSON.stringify(f.graph), before);
    f.graph.quads.reverse(); assert.equal(f.run().digest, report.digest);
    assert(Object.isFrozen(report.descriptors));
    assert.deepEqual(report.descriptors, []);
  }
});

test("orphan and cycle topology refuse; legacy recovery and scope never substitute for specifications", () => {
  const orphan = fixture([[], [7]]); assert.equal(orphan.run().complete, false);
  const cycle = fixture([[1], [0]]); assert(cycle.run().diagnostics.some(d => d.reasonCode === "TRANSITION_DAG_BLOCKED"));
  const missing = fixture([[]]); missing.graph.quads = missing.graph.quads.filter(q => q.predicate !== P + "recoveryReader");
  assert(missing.run().diagnostics.some(d => d.reasonCode === "CLI_SPECIFICATION_INCOMPLETE"));
  assert.equal(missing.run().complete, false);
  const scope = fixture([[]]); scope.add("urn:test:node:0:effect", "readScope", "../escape", "literal");
  assert(scope.run().diagnostics.some(d => d.reasonCode === "CLI_SPECIFICATION_INCOMPLETE"));
  assert.equal(scope.run().parallelSafety.state, "unproven");
  assert.equal(scope.run().executionAuthority, "none");
});

test("missing real-work semantics, ambiguous profiles and bindings never become empty complete", () => {
  const f = fixture([]); assert.equal(f.run().reasonCode, "TRANSITION_SEMANTICS_INCOMPLETE");
  assert(f.run().requiredGraphRefs.includes("urn:test:requirement"));
  f.add("urn:test:other-profile:1", "type", T + "RealisationProfile"); f.add("urn:test:other-profile:1", "selectsContract", contract);
  assert.equal(f.run().profile, null);
  const binding = deriveCliTransitionCoverage(f.graph, { rootIdentity: "urn:test:binding", manifestPath: "graph/test.json" }, f.inventory, []);
  assert.equal(binding.complete, false); assert.equal(binding.work, null);
});

test("terminal omissions, adapter conflicts and inventory gaps remain explicit", () => {
  const f = fixture([[], []]);
  f.graph.quads = f.graph.quads.filter(q => !(q.predicate === P + "terminalArtifact" && q.object === "urn:test:artifact:1"));
  assert.equal(f.run().terminalClosure.equal, false);
  const report = deriveCliTransitionCoverage(f.graph, { rootIdentity: work, manifestPath: "graph/test.json" }, { ...f.inventory, complete: false }, []);
  assert(report.diagnostics.some(d => d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"));
  assert(report.diagnostics.some(d => d.reasonCode === "TRANSITION_INVENTORY_INCOMPLETE"));
  assert.equal(report.executionAuthority, "none");
});

test("artifact semantics alter digest and unspecified descriptors are not projected", () => {
  const f = fixture([[]]), digest = f.run().digest;
  f.add("urn:test:artifact:0", "basisIdentity", "changed", "literal");
  assert.notEqual(f.run().digest, digest); assert.equal(f.run().complete, false);
  f.add("urn:test:node:0", "modulePath", "file:///untrusted.ts", "literal");
  assert(f.run().diagnostics.some(d => d.reasonCode === "CLI_SPECIFICATION_INCOMPLETE"));
  assert.deepEqual(f.run().descriptors, []);
});

test("hidden downstream prerequisites are traversed and bounds are enforced", () => {
  const f = fixture([[], [0]]);
  f.add("urn:test:node:1", "requiresTransition", "urn:test:hidden");
  f.graph.quads = f.graph.quads.filter(q => !(q.subject === work && q.predicate === P + "transition" && q.object === "urn:test:node:1"));
  assert(f.run().waves.flat().includes("urn:test:hidden"));
  assert(f.run().diagnostics.some(d => d.subject === "urn:test:hidden"));
  assert.throws(() => deriveCliTransitionCoverage(f.graph, { rootIdentity: "x".repeat(4097), manifestPath: "graph/test.json" }, f.inventory, []), /TRANSITION_INPUT_BOUNDS_EXCEEDED/);
});

test("downstream discovery excludes other contracts without hiding explicit prerequisites", () => {
  const f = fixture([[]]);
  const foreign = "urn:test:foreign-transition";
  f.add(foreign, "type", T + "CliTransitionDescriptor");
  f.add(foreign, "owner", "urn:test:foreign-contract");
  f.add(foreign, "requiresTransition", "urn:test:node:0");
  assert.equal(f.run().waves.flat().includes(foreign), false);
  f.add("urn:test:node:0", "requiresTransition", foreign);
  const explicit = f.run();
  assert(explicit.diagnostics.some(d => d.subject === foreign));
  assert(explicit.diagnostics.some(d => d.subject === foreign && d.reasonCode === "TRANSITION_OWNER_CONFLICT"));
  assert.equal(explicit.executionAuthority, "none");
});

test("terminal diagnostics bind an omitted native-intent rule without inventing a target", () => {
  const f = terminalFixture();
  const subject = "urn:usf:rule:completion-check-receipts-execution-intent:1", rule = "urn:usf:cli-terminal-edge:13:1";
  f.graph.quads = f.graph.quads.filter(q => q.subject !== subject);
  const result = f.run();
  const diagnostic = result.diagnostics.find(d => d.reasonCode === "TRANSITION_TERMINAL_NODE_MISSING_OR_WRONG_TYPE" && d.subject === subject && d.predicate === P + "type");
  assert.deepEqual(diagnostic, {
    reasonCode: "TRANSITION_TERMINAL_NODE_MISSING_OR_WRONG_TYPE", subject, predicate: P + "type",
    rule, expectedType: T + "CliFieldDerivationRule", observedTargets: [],
    sourceDigest: canonicalQuadDigest(f.graph.quads.filter(q => q.subject === subject)),
    ruleDigest: canonicalQuadDigest(f.graph.quads.filter(q => q.subject === rule)),
  });
  assert.deepEqual(result.reasonCodes, [...new Set(result.diagnostics.map(d => d.reasonCode))].sort());
  assert.equal(result.satisfaction, "unverified");
  assert(Object.isFrozen(result.diagnostics));
  assert(Object.isFrozen(diagnostic!.observedTargets));
  const absent = result.diagnostics.find(d => d.reasonCode === "TRANSITION_TERMINAL_ARTIFACT_DECLARATION_MISSING")!;
  assert.equal(absent.subject, f.declaration);
  assert.equal(absent.predicate, P + "terminalArtifact");
  assert.deepEqual(absent.observedTargets, []);
  assert.equal(absent.sourceDigest, canonicalQuadDigest(f.graph.quads.filter(q => q.subject === f.declaration)));
});

test("terminal diagnostics preserve same-code nodes and bind source and rule movement deterministically", () => {
  const f = terminalFixture();
  const subjects = ["urn:usf:cli-transition:no-change-workspace:1", "urn:usf:cli-transition:completion-check-receipts:1"];
  f.graph.quads = f.graph.quads.filter(q => !(subjects.includes(q.subject) && q.predicate === P + "recoveryContract"));
  const before = f.run();
  const selected = before.diagnostics.filter(d => subjects.includes(d.subject) && d.predicate === P + "recoveryContract" && d.reasonCode === "TRANSITION_TERMINAL_REQUIRED_EDGE_MISSING");
  assert.deepEqual(selected.map(d => d.subject).sort(), [...subjects].sort());
  const reordered = { ...f.graph, quads: [...f.graph.quads].reverse() };
  assert.deepEqual(deriveCliTerminalAssessment(reordered, f.root), before);
  const duplicated = { ...f.graph, quads: [...f.graph.quads, ...f.graph.quads].reverse() };
  const repeated = deriveCliTerminalAssessment(duplicated, f.root);
  assert.notEqual(repeated.semanticBasis, before.semanticBasis);
  const descriptions = (items: typeof repeated.diagnostics) => items.map(({ sourceDigest: _source, ruleDigest: _rule, ...description }) => JSON.stringify(description)).sort();
  assert.deepEqual(descriptions(repeated.diagnostics), descriptions(before.diagnostics));
  for (const item of repeated.diagnostics) {
    assert.equal(item.sourceDigest, canonicalQuadDigest(duplicated.quads.filter(q => q.subject === item.subject)));
    if (item.rule !== undefined) assert.equal(item.ruleDigest, canonicalQuadDigest(duplicated.quads.filter(q => q.subject === item.rule)));
  }
  const source = subjects[0]!, rule = selected[0]!.rule!;
  f.graph.quads.push({ subject: source, predicate: P + "text", object: "changed subject explanation", objectKind: "literal", graph: "urn:test:terminal", canonical: "" });
  const changedSource = f.run().diagnostics.find(d => d.subject === source && d.predicate === P + "recoveryContract" && d.reasonCode === "TRANSITION_TERMINAL_REQUIRED_EDGE_MISSING")!;
  assert.notEqual(changedSource.sourceDigest, selected.find(d => d.subject === source)!.sourceDigest);
  assert.equal(changedSource.ruleDigest, selected[0]!.ruleDigest);
  const row = f.graph.quads.find(q => q.subject === rule && q.predicate === P + "text")!;
  row.object += " Additional rule explanation.";
  const changedRule = f.run().diagnostics.find(d => d.subject === source && d.predicate === P + "recoveryContract" && d.reasonCode === "TRANSITION_TERMINAL_REQUIRED_EDGE_MISSING")!;
  assert.equal(changedRule.sourceDigest, changedSource.sourceDigest);
  assert.notEqual(changedRule.ruleDigest, changedSource.ruleDigest);
  assert.equal(changedRule.ruleDigest, canonicalQuadDigest(f.graph.quads.filter(q => q.subject === rule)));
});

test("terminal diagnostics locate missing declaration wrong types scopes and malformed policy", () => {
  const missing = terminalFixture();
  missing.graph.quads = missing.graph.quads.filter(q => !(q.predicate === P + "requires" && q.object === missing.declaration));
  const diagnostic = missing.run().diagnostics.find(d => d.reasonCode === "TRANSITION_TERMINAL_DECLARATION_MISSING_OR_AMBIGUOUS")!;
  assert.equal(diagnostic.subject, "urn:usf:contract:cli-transition-definition:1");
  assert.equal(diagnostic.predicate, P + "requires");
  assert.equal(diagnostic.expectedType, T + "CliTerminalClosureDeclaration");
  assert.deepEqual(diagnostic.observedTargets, []);
  const wrong = terminalFixture(), target = "urn:test:wrong-recovery";
  wrong.add("urn:usf:cli-transition:completion-check-receipts:1", "recoveryContract", target);
  wrong.add(target, "type", T + "Requirement");
  const wrongType = wrong.run().diagnostics.find(d => d.subject === target && d.reasonCode === "TRANSITION_TERMINAL_NODE_MISSING_OR_WRONG_TYPE")!;
  assert.equal(wrongType.expectedType, T + "CliRecoveryContract");
  assert.deepEqual(wrongType.observedTargets, [T + "Requirement"]);
  assert.equal(wrongType.sourceDigest, canonicalQuadDigest(wrong.graph.quads.filter(q => q.subject === target)));
  const scoped = terminalFixture();
  scoped.add(scoped.artifact, "work", "urn:test:foreign");
  assert(scoped.run().diagnostics.some(d => d.subject === scoped.artifact && d.reasonCode === "TRANSITION_TERMINAL_NODE_SCOPE_CONFLICT" && d.scope === "work-profile"));
  const malformed = terminalFixture(), policy = "urn:usf:cli-terminal-policy:bounded-obligations:1";
  malformed.graph.quads = malformed.graph.quads.filter(q => !(q.subject === policy && q.predicate === P + "maximumDepth"));
  const policyDiagnostic = malformed.run().diagnostics.find(d => d.subject === policy && d.reasonCode === "TRANSITION_TERMINAL_POLICY_INVALID")!;
  assert.equal(policyDiagnostic.sourceDigest, canonicalQuadDigest(malformed.graph.quads.filter(q => q.subject === policy)));
});

test("terminal diagnostic schema rejects opaque authority and invented target properties", () => {
  const f = terminalFixture(), result = f.run();
  const canonical = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  const validator = createJsonSchemaValidator({ $schema: canonical.$schema, $id: "urn:test:terminal-diagnostics:1", $ref: canonical.$id + "#/$defs/terminalAssessment" }, { dependencySchemas: [canonical] });
  assert.equal(validator.validate(result).valid, true);
  const item = result.diagnostics[0]!;
  for (const extra of [{ fields: {} }, { executionAuthority: "execute" }, { target: "urn:test:invented" }, { assertedTarget: "urn:test:invented" }]) {
    assert.equal(validator.validate({ ...result, diagnostics: [{ ...item, ...extra }] }).valid, false);
  }
  for (const key of ["reasonCode", "subject", "sourceDigest", "observedTargets"]) {
    const incomplete: Record<string, unknown> = { ...item }; delete incomplete[key];
    assert.equal(validator.validate({ ...result, diagnostics: [incomplete] }).valid, false, key);
  }
});

test("terminal diagnostics refuse record and observed-target overflow instead of truncating", () => {
  for (const mode of ["records", "targets"]) {
    const f = terminalFixture(), owner = "urn:usf:contract:cli-transition-definition:1";
    for (let i = 0; i < 1025; i++) {
      const id = "urn:test:diagnostic-overflow:" + i;
      f.add(owner, "requires", id);
      if (mode === "targets") f.add(id, "type", T + "CliTerminalClosureDeclaration");
      else f.graph.quads.push({ subject: id, predicate: P + "type", object: "not-an-iri", objectKind: "literal", graph: "urn:test:terminal", canonical: "" });
    }
    assert.throws(() => f.run(), { name: "RangeError", message: "TRANSITION_INPUT_BOUNDS_EXCEEDED" }, mode);
  }
});

test("selective receipt adapter maps the complete native recovery closure without authority", () => {
  const graph = { quads: [
    ...parseStrictNQuads(readFileSync(new URL("../../graph/cli-transition-definition.nq", import.meta.url), "utf8"), "urn:usf:graph:cli-transition-definition"),
    ...parseStrictNQuads(readFileSync(new URL("../../graph/v3-convention.nq", import.meta.url), "utf8"), "urn:usf:graph:v3-convention"),
    ...parseStrictNQuads(readFileSync(new URL("../../graph/check-execution-intent.nq", import.meta.url), "utf8"), "urn:usf:graph:check-execution-intent"),
  ] } as SemanticGraph;
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, transitionAdaptersForCoverage());
  const id = "urn:usf:cli-transition:completion-check-receipts:1";
  assert(report.waves.flat().includes(id));
  assert(report.descriptors.some(d => d.identity === id), "shared native-intent semantics permit descriptor projection");
  assert.equal(report.diagnostics.some(d => d.subject === id && d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"), false);
  assert.equal(report.executionAuthority, "none");
  assert.equal(report.parallelSafety.state, "unproven");
  assert.equal(report.complete, false, "a declared complete-current recovery branch is not execution permission");
});

test("receipt-set generated schema accepts bounded dynamic denominators and rejects authority extensions", () => {
  const descriptor = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  const validator = createJsonSchemaValidator({ $schema: descriptor.$schema, $id: "urn:usf:schema:completion-check-receipt-set-result:1", $ref: descriptor.$id + "#/$defs/completionCheckReceiptSet" }, { dependencySchemas: [descriptor] });
  const obligation = (name: string) => `urn:test:validation:${name}`;
  const receipt = (name: string) => ({ obligationIri: obligation(name), receiptPath: `.usf/receipts/check/sha256:${"a".repeat(64)}/${name}.json`, receiptDigest: "sha256:" + name.repeat(64).slice(0, 64), validationResultSetDigest: "sha256:" + (name + "f").repeat(64).slice(0, 64) });
  const receipts = [receipt("a"), receipt("b"), receipt("c")];
  const result = { schema: "urn:usf:schema:completion-check-receipt-set-result:1", status: "current", workIri: "urn:test:work", profileIri: "urn:test:profile:1", candidateDigest: "sha256:" + "a".repeat(64), constructionBasisDigest: "sha256:" + "b".repeat(64), validationObligations: receipts.map(item => item.obligationIri), receipts, receiptSetDigest: "sha256:" + "c".repeat(64), nonClaims: ["completion", "parallel-safety", "partial-set-recovery", "terminal-closure"] };
  assert.equal(validator.validate(result).valid, true);
  assert.equal(validator.validate({ ...result, provider: "invented" }).valid, false);
  assert.equal(validator.validate({ ...result, executionAuthority: "execute" }).valid, false);
  assert.equal(validator.validate({ ...result, parallelSafety: { state: "proved" } }).valid, false);
});
