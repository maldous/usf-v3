import assert from "node:assert/strict";
import { test } from "node:test";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import { canonicalQuadLine, type Quad } from "../../../src/graph/nquads.ts";
import { evaluateFacets, type EvidenceIndex } from "../../../src/providers/facet-evaluation.ts";
import { parseSpecOutcomes } from "../../../src/providers/implementation-conformance.ts";
import {
  deriveCapabilityImplementationNeeds, deriveConformancePrompt, deriveImplementationPrompt,
  deriveImplementationWorkUnits, importSpecifierFor, maximumRepairRounds, readImplementationConvention,
  validateConformanceOutput, validateImplementationOutput,
} from "../../../src/providers/implementation-work.ts";

const G = "urn:usf:graph:v3-delivery";
const P = "urn:usf:predicate:";
function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal" = "literal"): Quad {
  const built = { subject, predicate, object, objectKind, graph: G, canonical: "" };
  built.canonical = canonicalQuadLine(built);
  return built;
}
function graphOf(quads: readonly Quad[]): SemanticGraph {
  return Object.freeze({ quads: Object.freeze([...quads]) }) as unknown as SemanticGraph;
}

function conventionQuads(): Quad[] {
  const convention = "urn:usf:capability-implementation-convention:v1:1";
  return [
    quad(convention, `${P}type`, "urn:usf:type:CapabilityImplementationConvention", "iri"),
    quad(convention, `${P}ownedByRepository`, "urn:usf:delivery-repository:foundation", "iri"),
    quad(convention, `${P}implementationPathRule`, "urn:usf:delivery-path-rule:capabilityimplementation", "iri"),
    quad(convention, `${P}conformancePathRule`, "urn:usf:delivery-path-rule:capabilityconformance", "iri"),
    quad(convention, `${P}outputRule`, "a self-contained module"),
    quad("urn:usf:delivery-repository:foundation", `${P}realisationRoot`, "apps/anqr"),
    quad("urn:usf:delivery-path-rule:capabilityimplementation", `${P}pathPattern`, "src/capabilities/{domain}/{capability}.ts"),
    quad("urn:usf:delivery-path-rule:capabilityconformance", `${P}pathPattern`, "tests/conformance/{domain}/{capability}.conformance.test.ts"),
  ];
}

function facet(name: string, contract: string, evidenceClass: string, applicability = "APPLICABLE"): Quad[] {
  const iri = `urn:usf:delivery-facet:${name}`;
  return [
    quad(iri, `${P}type`, "urn:usf:type:DeliveryFacet", "iri"),
    quad(iri, `${P}canonicalName`, name),
    quad(iri, `${P}admissibleEvidenceClass`, evidenceClass),
    quad(iri, `${P}facetApplicability`, applicability),
    quad(iri, `${P}facetStatement`, `${name} must hold`),
    quad(iri, `${P}requirementClass`, "behavioural-runtime"),
    quad(iri, `${P}facetKind`, "urn:usf:facet-kind:statemodel", "iri"),
    quad(contract, `${P}declaresFacet`, iri, "iri"),
  ];
}

function capabilityQuads(): Quad[] {
  const capability = "urn:usf:delivery-capability:policygate";
  const contract = "urn:usf:delivery-contract:policygate";
  return [
    quad(capability, `${P}type`, "urn:usf:type:DeliveryCapability", "iri"),
    quad(capability, `${P}canonicalName`, "policygate"),
    quad(capability, `${P}inDomain`, "urn:usf:delivery-domain:identityaccess", "iri"),
    quad(contract, `${P}definesCompletionFor`, capability, "iri"),
    ...facet("policygatebehaviour", contract, "implementation-conformance"),
    ...facet("policygateaudit", contract, "implementation-conformance"),
    ...facet("policygatecontract", contract, "realized-artefact"),
    ...facet("policygateui", contract, "implementation-conformance", "NOT_APPLICABLE"),
  ];
}

test("the convention is read from the graph and never defaulted", () => {
  const convention = readImplementationConvention(graphOf(conventionQuads()));
  assert.equal(convention.realisationRoot, "apps/anqr");
  assert.throws(() => readImplementationConvention(graphOf([])),
    (error: unknown) => (error as { code?: string }).code === "IMPLEMENTATION_CONVENTION_UNAVAILABLE");
});

test("outstanding implementation-conformance facets group into one need per capability", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const needs = deriveCapabilityImplementationNeeds(graph, readImplementationConvention(graph));
  assert.equal(needs.length, 1);
  const [need] = needs;
  // The artefact facet and the inapplicable facet are excluded; only the two
  // outstanding behavioural requirements form the work.
  assert.deepEqual(need!.requirements.map((entry) => entry.canonicalName), ["policygateaudit", "policygatebehaviour"]);
  assert.equal(need!.modulePath, "apps/anqr/src/capabilities/identityaccess/policygate.ts");
  assert.equal(need!.conformancePath, "apps/anqr/tests/conformance/identityaccess/policygate.conformance.test.ts");
});

test("implementation is ready immediately and conformance waits for the concrete module", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const needs = deriveCapabilityImplementationNeeds(graph, readImplementationConvention(graph));
  const empty = deriveImplementationWorkUnits(needs, new Set());
  assert.deepEqual(empty.map((unit) => [unit.stage, unit.ready]), [["implementation", true], ["conformance", false]]);
  const landed = deriveImplementationWorkUnits(needs, new Set([needs[0]!.modulePath]));
  assert.deepEqual(landed.map((unit) => [unit.stage, unit.ready]), [["conformance", true]]);
  const done = deriveImplementationWorkUnits(needs, new Set([needs[0]!.modulePath, needs[0]!.conformancePath]));
  assert.equal(done.length, 0);
});

test("the import specifier is derived from both graph paths", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const [need] = deriveCapabilityImplementationNeeds(graph, readImplementationConvention(graph));
  assert.equal(importSpecifierFor(need!), "../../../src/capabilities/identityaccess/policygate.ts");
});

test("a prompt carries every outstanding requirement and no path decision", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const convention = readImplementationConvention(graph);
  const [need] = deriveCapabilityImplementationNeeds(graph, convention);
  const prompt = deriveImplementationPrompt(need!, convention, Object.freeze({
    existingTarget: null, moduleSource: null, siblingModule: null,
  }));
  assert.match(prompt, /policygateaudit/u);
  assert.match(prompt, /policygatebehaviour/u);
  assert.doesNotMatch(prompt, /apps\/anqr/u);
  const conformance = deriveConformancePrompt(need!, "export const a = 1;", "../x.ts");
  assert.match(conformance, /import \* as capability from "\.\.\/x\.ts";/u);
});

test("module output is admitted structurally and refuses smuggled dependencies", () => {
  assert.equal(validateImplementationOutput("export const a = 1;\n").accepted, true);
  assert.equal(validateImplementationOutput("```ts\nexport const a = 1;\n```").content, "export const a = 1;");
  assert.equal(validateImplementationOutput("const a = 1;").code, "no-export");
  assert.equal(validateImplementationOutput('import x from "left-pad";\nexport const a = 1;').code, "external-import");
  assert.equal(validateImplementationOutput('import { readFile } from "node:fs";\nexport const a = 1;').accepted, true);
  // A builtin reached by its bare legacy name is still a builtin.
  assert.equal(validateImplementationOutput('import { createHash } from "crypto";\nexport const a = 1;').accepted, true);
  // An idiomatic docblock opening is not a path; an actual path-like opening is.
  assert.equal(validateImplementationOutput("/** doc */\nexport const a = 1;").accepted, true);
  assert.equal(validateImplementationOutput("/home/user/x.ts\nexport const a = 1;").code, "leading-slash");
  assert.equal(validateImplementationOutput("   ").code, "empty-output");
  assert.equal(validateImplementationOutput("export function f(x: any) { return x; }").code, "any-type");
  // Prose mentioning the word must not cost a whole dispatch.
  assert.equal(validateImplementationOutput("// never returns any, ever\nexport const a = 1;").accepted, true);
});

test("a conformance test that does not bind to the real module is refused before execution", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const [need] = deriveCapabilityImplementationNeeds(graph, readImplementationConvention(graph));
  const specifier = "../m.ts";
  const good = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import * as capability from "../m.ts";',
    'test("policygateaudit", () => { assert.ok(capability.audit()); });',
    'test("policygatebehaviour", () => { assert.ok(capability.decide()); });',
  ].join("\n");
  const accepted = validateConformanceOutput(good, need!, specifier);
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.coveredFacets, ["policygateaudit", "policygatebehaviour"]);

  const noImport = good.replace('import * as capability from "../m.ts";', "");
  assert.equal(validateConformanceOutput(noImport, need!, specifier).code, "module-not-imported");

  const stubbed = `${good}\nmock.module("../m.ts", {});`;
  assert.equal(validateConformanceOutput(stubbed, need!, specifier).code, "module-stubbed");

  const wrongNames = good.replaceAll("policygate", "somethingelse");
  assert.equal(validateConformanceOutput(wrongNames, need!, specifier).code, "no-facet-subtest");
});

test("the node spec reporter is parsed into per-name outcomes", () => {
  const parsed = parseSpecOutcomes([
    "✔ alpha (0.6ms)",
    "✖ beta (0.7ms)",
    "ℹ pass 1",
    "ℹ fail 1",
    "✖ failing tests:",
    "✖ beta (0.7ms)",
  ].join("\n"));
  assert.deepEqual([...parsed.passed], ["alpha"]);
  assert.deepEqual([...parsed.failed], ["beta"]);
  assert.equal(parsed.passCount, 1);
  assert.equal(parsed.failCount, 1);
});

function evidenceWith(entries: EvidenceIndex["conformanceOutcomes"]): EvidenceIndex {
  return Object.freeze({
    realizedArtefacts: new Map(), runtimeComposed: false,
    validatorOutcomes: Object.freeze([]), proofOutcomes: Object.freeze([]),
    conformanceOutcomes: entries,
  });
}

test("an implementation-conformance facet is satisfied only by an executed behavioural outcome", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const behaviour = "urn:usf:delivery-facet:policygatebehaviour";

  const none = evaluateFacets(graph, evidenceWith(new Map()));
  assert.equal(none.find((verdict) => verdict.facet === behaviour)!.state, "NOT_ASSESSED");

  // A realized artefact must never satisfy a behavioural requirement.
  const artefacts: EvidenceIndex = Object.freeze({
    ...evidenceWith(new Map()),
    realizedArtefacts: new Map([["apps/anqr/contracts/x.json", "sha256:aa"]]),
  });
  assert.equal(evaluateFacets(graph, artefacts).find((verdict) => verdict.facet === behaviour)!.state, "NOT_ASSESSED");

  const passing = evaluateFacets(graph, evidenceWith(new Map([[behaviour, Object.freeze({
    executed: true, passed: true, stale: false, blocked: false, evidence: "t.ts@sha256:bb subtest policygatebehaviour", detail: null,
  })]])));
  assert.equal(passing.find((verdict) => verdict.facet === behaviour)!.state, "SATISFIED");

  const failing = evaluateFacets(graph, evidenceWith(new Map([[behaviour, Object.freeze({
    executed: true, passed: false, stale: false, blocked: false, evidence: "t.ts@sha256:bb subtest policygatebehaviour", detail: null,
  })]])));
  assert.equal(failing.find((verdict) => verdict.facet === behaviour)!.state, "UNSATISFIED");

  const stale = evaluateFacets(graph, evidenceWith(new Map([[behaviour, Object.freeze({
    executed: true, passed: true, stale: true, blocked: false, evidence: "t.ts@sha256:cc subtest policygatebehaviour", detail: null,
  })]])));
  assert.equal(stale.find((verdict) => verdict.facet === behaviour)!.state, "STALE");

  // A check that could not execute observed nothing, so it satisfies nothing,
  // and its reason names what stopped it. It is BLOCKED, not never-assessed:
  // a check ran and something repairable stood in its way, and labelling that
  // as absence hid every blocked facet inside the never-assessed count for a
  // whole run.
  const blocked = evaluateFacets(graph, evidenceWith(new Map([[behaviour, Object.freeze({
    executed: false, passed: false, stale: false, blocked: true,
    evidence: "t.ts@sha256:dd subtest policygatebehaviour", detail: "the implementation does not typecheck",
  })]])));
  const verdict = blocked.find((entry) => entry.facet === behaviour)!;
  assert.equal(verdict.state, "BLOCKED");
  assert.match(verdict.reason, /does not typecheck/u);
});

test("a failing behavioural check produces bounded alternating repair work, then stops", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const needs = deriveCapabilityImplementationNeeds(graph, readImplementationConvention(graph));
  const need = needs[0]!;
  const landed = new Set([need.modulePath, need.conformancePath]);
  const failing = Object.freeze([Object.freeze({ facetName: "policygateaudit", detail: "the subtest failed" })]);

  // Nothing outstanding while everything passes.
  assert.equal(deriveImplementationWorkUnits(needs, landed, new Map()).length, 0);

  const round = (n: number) => deriveImplementationWorkUnits(needs, landed,
    new Map([[need.capability, Object.freeze({ failing, round: n })]]));
  assert.deepEqual(round(1).map((unit) => unit.stage), ["implementation"]);
  assert.deepEqual(round(2).map((unit) => unit.stage), ["conformance"]);
  assert.deepEqual(round(3).map((unit) => unit.stage), ["implementation"]);
  assert.equal(round(1)[0]!.unit, "urn:usf:workunit:implementation-policygate-repair-1");
  assert.deepEqual(round(1)[0]!.repairs, failing);

  // Where the evidence already names the wrong artefact, that side goes first.
  const preferring = (n: number) => deriveImplementationWorkUnits(needs, landed,
    new Map([[need.capability, Object.freeze({ failing, round: n, preferredStage: "conformance" as const })]]));
  // Named evidence holds for every round; alternation is only for the case
  // where nothing says which artefact is wrong.
  assert.deepEqual(preferring(1).map((unit) => unit.stage), ["conformance"]);
  assert.deepEqual(preferring(2).map((unit) => unit.stage), ["conformance"]);

  // Past the bound the capability stops consuming provider budget.
  assert.equal(round(maximumRepairRounds).length, 1);
  assert.equal(round(maximumRepairRounds + 1).length, 0);
});

test("a repair prompt names the observed failures and nothing else changes", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const convention = readImplementationConvention(graph);
  const [need] = deriveCapabilityImplementationNeeds(graph, convention);
  const failing = [{ facetName: "policygateaudit", detail: "audit ran after the mutation" }];
  const prompt = deriveImplementationPrompt(need!, convention,
    { existingTarget: "export const a = 1;", moduleSource: null, siblingModule: null }, failing);
  assert.match(prompt, /audit ran after the mutation/u);
  assert.match(prompt, /did not hold/u);
  const conformance = deriveConformancePrompt(need!, "export const a = 1;", "../m.ts", failing);
  assert.match(conformance, /the requirement does not state/u);
});

test("a rewrite prompt shows the whole artefact, not a truncated one", async () => {
  const { inspectRepositoryFile, maximumRewriteBytes } =
    await import("../../../src/providers/implementation-work.ts");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const root = await mkdtemp(resolve(tmpdir(), "usf-rewrite-"));
  try {
    // A module larger than the bounded inspection read used for context.
    const source = `export const a = 1;\n${"// filler\n".repeat(3_000)}export const z = 2;\n`;
    await writeFile(resolve(root, "big.ts"), source, { mode: 0o600 });
    const inspected = await inspectRepositoryFile(root, "big.ts");
    const whole = await inspectRepositoryFile(root, "big.ts", maximumRewriteBytes);
    assert.ok(source.length > 12_000);
    assert.match(inspected!, /truncated for inspection/u);
    // Asking for the complete updated content of a file shown in part is not a
    // task any model can perform.
    assert.equal(whole, source);
    assert.doesNotMatch(whole!, /truncated for inspection/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a subtest that asserts shape without invoking the module is not evidence", async () => {
  const { subtestsInvokingModule } = await import("../../../src/providers/implementation-work.ts");
  const source = [
    'import * as capability from "../m.ts";',
    // Exercises behaviour: admissible.
    'test("alphabehaviour", () => { assert.equal(capability.decide(true), "granted"); });',
    // Asserts the shape of an exported constant: the type system already says
    // this, and it observes nothing about behaviour.
    'test("betastatemodel", () => { assert.deepEqual(["A","B"], ["A","B"]); });',
    // Names the module but only reads a constant, never calls it.
    'test("gammacontracts", () => { assert.equal(capability.KINDS.length, 2); });',
  ].join("\n");
  const invoking = subtestsInvokingModule(source, ["alphabehaviour", "betastatemodel", "gammacontracts"]);
  assert.deepEqual([...invoking].sort(), ["alphabehaviour"]);
});

test("admission requires each covered facet to invoke the module", () => {
  const graph = graphOf([...conventionQuads(), ...capabilityQuads()]);
  const [need] = deriveCapabilityImplementationNeeds(graph, readImplementationConvention(graph));
  const shapeOnly = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import * as capability from "../m.ts";',
    'test("policygateaudit", () => { assert.equal(1, 1); });',
    'test("policygatebehaviour", () => { assert.ok(capability.decide()); });',
  ].join("\n");
  const checked = validateConformanceOutput(shapeOnly, need!, "../m.ts");
  assert.equal(checked.accepted, true);
  // Only the subtest that exercises the module counts as covered.
  assert.deepEqual(checked.coveredFacets, ["policygatebehaviour"]);
});

test("a fenced block is taken wherever it sits in the output", () => {
  const body = 'export const decide = (): string => "granted";';
  // Fence wrapping the whole output.
  assert.equal(validateImplementationOutput("```ts\n" + body + "\n```").content, body);
  // Fence followed by a closing sentence: requiring the fence to wrap the whole
  // output shipped the fence into the file, where the compiler reported it as a
  // module declaration on line 1 and the generation was discarded.
  assert.equal(
    validateImplementationOutput("```typescript\n" + body + "\n```\n\nThis implements the requirement.").content,
    body);
  // Prose before the fence too.
  assert.equal(validateImplementationOutput("Here is the module:\n\n```ts\n" + body + "\n```").content, body);
});

test("dispatch interleaves stages so none is starved by frontier order", () => {
  // Reproduces the observed shape: many conformance units sorting ahead of a
  // few implementation units, with a dispatch budget smaller than the frontier.
  const lane = (stage: string, repairs: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      unit: `u-${stage}-${repairs}-${index}`, stage,
      repairs: Array.from({ length: repairs }, () => ({ facetName: "f", detail: null })),
    }));
  const ready = [...lane("conformance", 0, 19), ...lane("implementation", 0, 5), ...lane("implementation", 1, 8)];

  const lanes = [
    ready.filter((u) => u.stage === "implementation" && u.repairs.length === 0),
    ready.filter((u) => u.stage === "conformance" && u.repairs.length === 0),
    ready.filter((u) => u.repairs.length > 0),
  ];
  const selected: typeof ready = [];
  for (let depth = 0; selected.length < 12; depth += 1) {
    const before = selected.length;
    for (const l of lanes) {
      const unit = l[depth];
      if (unit !== undefined && selected.length < 12) selected.push(unit);
    }
    if (selected.length === before) break;
  }

  const greenfield = selected.filter((u) => u.stage === "implementation" && u.repairs.length === 0).length;
  const conformance = selected.filter((u) => u.stage === "conformance" && u.repairs.length === 0).length;
  const repair = selected.filter((u) => u.repairs.length > 0).length;
  assert.equal(selected.length, 12);
  // Naive slicing would have taken 12 conformance units and no module work.
  assert.ok(greenfield > 0, "implementation work must not be starved");
  assert.ok(conformance > 0 && repair > 0, "every stage keeps moving");
  assert.deepEqual([greenfield, conformance, repair], [4, 4, 4]);
});
