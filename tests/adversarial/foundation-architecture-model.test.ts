import assert from "node:assert/strict";
import { test } from "node:test";
import { declarationDigest, readArchitectureDeclaration, type ArchitectureDeclaration, type DeclarationQuad } from "../../src/architecture/declaration.ts";
import type { ArchitectureObservation } from "../../src/architecture/observe.ts";
import { composeReleaseAssurance, conformanceDispositions, evaluateArchitectureConformance } from "../../src/architecture/conformance.ts";

/**
 * The confined lane, and deliberately the whole of it.
 *
 * This validation runs inside a candidate workspace, which materialises the
 * declared closure and nothing else. So it asserts nothing whatever about the
 * real tree: it proves the model instead, against synthetic corpora it builds
 * itself, and it proves the model by breaking it. Every adversarial
 * verification the graph declares is planted here, shown to produce the exact
 * disposition the graph says it must, and then discarded with the fixture.
 *
 * The fixtures are also where the vocabulary's expressiveness is demonstrated:
 * the foundation is not a ports-and-adapters architecture, so a hexagonal
 * dependency rule and a required port-to-adapter edge cannot be exercised
 * against it, and are exercised here.
 */

const P = (name: string): string => `urn:usf:predicate:${name}`;
const T = (name: string): string => `urn:usf:type:${name}`;

const iri = (subject: string, predicate: string, object: string): DeclarationQuad =>
  ({ subject, predicate: P(predicate), object, objectKind: "iri" });
const lit = (subject: string, predicate: string, object: string): DeclarationQuad =>
  ({ subject, predicate: P(predicate), object, objectKind: "literal" });

const ARCHITECTURE = "urn:fixture:architecture:1";
const SET = "urn:fixture:assurance-set:1";
const CLAIM = "urn:fixture:release-claim:1";
const CORPUS = "urn:usf:assurance-scope:corpus";
const CONFINED = "urn:usf:assurance-scope:candidate-confined";
const classification = (name: string): string => `urn:usf:implementation-classification:${name}`;
const criterion = (name: string): string => `urn:usf:classification-criterion:${name}`;
const procedure = (name: string): string => `urn:usf:conformance-procedure:${name}`;
const requirement = (name: string): string => `urn:fixture:requirement:${name}`;
const layer = (name: string): string => `urn:fixture:layer:${name}`;
const component = (name: string): string => `urn:fixture:component:${name}`;

/** The eight classifications the foundation admits, in the precedence it declares. */
const CLASSIFICATIONS: ReadonlyArray<readonly [string, string, string, string, string]> = [
  ["product-declared", "declared-by-disposition-decision", "10", "true", "true"],
  ["runtime-reachable", "reachable-from-runtime-entry-point", "20", "true", "false"],
  ["assurance-tooling", "named-by-enforcement-binding", "25", "true", "false"],
  ["declared-realisation-artefact", "named-as-work-write-path", "30", "true", "false"],
  ["validation-support", "named-in-validation-runtime-closure", "40", "true", "false"],
  ["generated", "within-generated-code-boundary", "60", "true", "false"],
  ["superseded-retained", "declared-by-disposition-decision", "70", "true", "false"],
  ["unexplained-orphan", "no-criterion-satisfied", "99", "false", "false"],
];

const REQUIREMENTS: ReadonlyArray<readonly [string, string]> = [
  ["accounting", "implementation-accounting"],
  ["reachability", "runtime-reachability"],
  ["entry-points", "entry-point-integrity"],
  ["imports", "import-resolution"],
  ["ownership", "component-ownership"],
  ["direction", "dependency-direction"],
  ["cycles", "cycle-boundary"],
  ["deferment", "product-deferment"],
  ["boundary", "module-boundary"],
];

/**
 * A small hexagonal corpus: a domain centre, an application layer, ports and
 * adapters, one forbidden direction and one required one. It is the shape the
 * foundation does not have, which is exactly why it is the shape worth proving
 * the vocabulary can carry.
 */
function fixtureQuads(): DeclarationQuad[] {
  const quads: DeclarationQuad[] = [iri(ARCHITECTURE, "type", T("ArchitecturalStyle"))];

  for (const [name, ordinal] of [["domain", "0"], ["ports", "1"], ["application", "2"], ["adapters", "3"], ["delivery", "4"]] as const) {
    quads.push(iri(ARCHITECTURE, "hasLayer", layer(name)), iri(layer(name), "type", T("ArchitecturalLayer")), lit(layer(name), "canonicalName", name), lit(layer(name), "layerOrdinal", ordinal));
  }
  for (const [name, location, inLayer] of [
    ["codec", "src/domain/", "domain"],
    ["port-contracts", "src/ports/", "ports"],
    ["use-cases", "src/application/", "application"],
    ["render-adapters", "src/adapters/", "adapters"],
    ["web", "src/delivery/", "delivery"],
  ] as const) {
    quads.push(
      iri(ARCHITECTURE, "hasComponent", component(name)),
      iri(component(name), "type", T("ArchitecturalComponent")),
      lit(component(name), "canonicalName", name),
      lit(component(name), "componentLocation", location),
      iri(component(name), "inLayer", layer(inLayer)),
    );
  }

  // A hexagonal port with its adapter, so the model is shown to carry both.
  quads.push(
    iri("urn:fixture:port:image-source", "type", T("ArchitecturalPort")),
    iri("urn:fixture:port:image-source", "portDirection", "urn:usf:port-direction:outbound"),
    lit("urn:fixture:port:image-source", "portContractLocation", "src/ports/image-source.ts"),
    iri("urn:fixture:port:image-source", "servedByAdapter", "urn:fixture:adapter:png"),
    iri("urn:fixture:adapter:png", "type", T("ArchitecturalAdapter")),
    iri("urn:fixture:adapter:png", "adapterImplementsPort", "urn:fixture:port:image-source"),
    iri("urn:fixture:adapter:png", "inLayer", layer("adapters")),
  );

  const rule = (kind: string, from: string, to: string): void => {
    const subject = `urn:fixture:dependency-rule:${kind}-${from}-${to}`;
    quads.push(
      iri(subject, "type", T("DependencyDirectionRule")),
      iri(subject, "dependencyRuleKind", `urn:usf:dependency-rule-kind:${kind}`),
      iri(subject, "dependencyFrom", layer(from)),
      iri(subject, "dependencyTo", layer(to)),
    );
  };
  const layers = ["domain", "ports", "application", "adapters", "delivery"] as const;
  const permitted = new Set(["ports domain", "application domain", "application ports", "adapters ports", "adapters domain", "delivery application", "delivery ports", "delivery adapters"]);
  for (const from of layers) for (const to of layers) {
    if (from === to) continue;
    rule(permitted.has(`${from} ${to}`) ? "permits" : "forbids", from, to);
  }
  rule("requires", "adapters", "ports");

  quads.push(
    iri(ARCHITECTURE, "declaresEntryPoint", "urn:fixture:entry-point:web"),
    iri("urn:fixture:entry-point:web", "type", T("RuntimeEntryPoint")),
    lit("urn:fixture:entry-point:web", "entryPointModule", "src/delivery/web.ts"),
    iri("urn:fixture:entry-point:web", "entryPointSurface", "urn:usf:entry-point-surface:runtime-command"),
    lit("urn:usf:entry-point-surface:runtime-command", "contributesToRuntimeReachability", "true"),
    iri(ARCHITECTURE, "declaresPopulation", "urn:fixture:population:1"),
    lit("urn:fixture:population:1", "populationRoot", "src/"),
    lit("urn:fixture:population:1", "populationMemberSuffix", ".ts"),
    iri(ARCHITECTURE, "cyclePolicy", "urn:fixture:cycle-policy:1"),
    lit("urn:fixture:cycle-policy:1", "cyclesPermitted", "false"),
    iri("urn:fixture:module-boundary:1", "type", T("ModuleBoundaryRule")),
    iri("urn:fixture:module-boundary:1", "boundaryScope", ARCHITECTURE),
    lit("urn:fixture:module-boundary:1", "boundaryScope", "src/assurance/"),
    iri("urn:fixture:disposition:product", "type", T("ImplementationDispositionDecision")),
    iri("urn:fixture:disposition:product", "classifiesAs", classification("product-declared")),
    lit("urn:fixture:disposition:product", "dispositionRoot", "src/product/"),
    lit("urn:fixture:disposition:product", "dispositionOwner", "the product profile"),
    iri("urn:fixture:enforcement:1", "type", T("EnforcementBinding")),
    lit("urn:fixture:enforcement:1", "enforcementModule", "src/assurance/observe.ts"),
  );

  for (const [name, crit, precedence, conforming, defers] of CLASSIFICATIONS) {
    quads.push(
      iri(ARCHITECTURE, "permittedClassification", classification(name)),
      lit(classification(name), "canonicalName", name),
      iri(classification(name), "classificationCriterion", criterion(crit)),
      lit(classification(name), "classificationPrecedence", precedence),
      lit(classification(name), "classificationConforming", conforming),
      lit(classification(name), "defersArchitectureJudgement", defers),
    );
  }

  quads.push(iri(SET, "type", T("AssuranceSet")), iri(SET, "assuranceScope", CORPUS));
  for (const [name, rule2] of REQUIREMENTS) {
    quads.push(
      iri(SET, "assuranceMember", requirement(name)),
      lit(requirement(name), "canonicalName", name),
      iri(requirement(name), "conformanceProcedure", procedure(rule2)),
      iri(requirement(name), "assuranceScope", CORPUS),
      iri(requirement(name), "requirementSeverity", "urn:usf:requirement-severity:blocking"),
    );
  }

  quads.push(
    iri(CLAIM, "type", T("ReleaseAssuranceClaim")),
    iri(CLAIM, "dependsOnAssuranceSet", SET),
    iri(CLAIM, "absentEvidenceDisposition", "urn:usf:architecture-conformance-disposition:assurance-evidence-missing"),
  );
  return quads;
}

const HEALTHY_UNITS = [
  "src/adapters/png.ts",
  "src/application/produce.ts",
  "src/assurance/observe.ts",
  "src/delivery/web.ts",
  "src/domain/codec.ts",
  "src/ports/image-source.ts",
  "src/product/feature.ts",
];

const HEALTHY_IMPORTS = [
  { from: "src/adapters/png.ts", to: "src/domain/codec.ts" },
  { from: "src/adapters/png.ts", to: "src/ports/image-source.ts" },
  { from: "src/application/produce.ts", to: "src/domain/codec.ts" },
  { from: "src/application/produce.ts", to: "src/ports/image-source.ts" },
  { from: "src/delivery/web.ts", to: "src/adapters/png.ts" },
  { from: "src/delivery/web.ts", to: "src/application/produce.ts" },
  { from: "src/ports/image-source.ts", to: "src/domain/codec.ts" },
];

interface ObservationOverrides {
  readonly population?: readonly string[];
  readonly internalImports?: ReadonlyArray<{ from: string; to: string }>;
  readonly runtimeReachable?: readonly string[];
  readonly unresolvedImports?: ReadonlyArray<{ from: string; specifier: string }>;
  readonly absentEntryPointModules?: readonly string[];
  readonly cycleMembers?: readonly string[];
  readonly scope?: string;
  readonly populationDigest?: string;
  readonly producer?: string;
}

function observationFor(declaration: ArchitectureDeclaration, overrides: ObservationOverrides = {}): ArchitectureObservation {
  const population = overrides.population ?? HEALTHY_UNITS;
  const internalImports = overrides.internalImports ?? HEALTHY_IMPORTS;
  const reachable = overrides.runtimeReachable
    ?? HEALTHY_UNITS.filter((unit) => !unit.startsWith("src/product/") && !unit.startsWith("src/assurance/"));
  return {
    schema: "urn:usf:architecture-observation:1",
    scope: overrides.scope ?? CORPUS,
    producer: overrides.producer ?? "urn:fixture:observer:1",
    observedAt: "2026-09-04T00:00:00.000Z",
    declarationDigest: declarationDigest(declaration),
    populationDigest: overrides.populationDigest ?? "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    population: [...population].sort(),
    internalImports: [...internalImports],
    unresolvedImports: [...(overrides.unresolvedImports ?? [])],
    externalImports: [],
    absentEntryPointModules: [...(overrides.absentEntryPointModules ?? [])],
    runtimeReachable: [...reachable].sort(),
    cycleMembers: [...(overrides.cycleMembers ?? [])],
  };
}

function declarationOf(extra: readonly DeclarationQuad[] = [], remove: (quad: DeclarationQuad) => boolean = () => false): ArchitectureDeclaration {
  return readArchitectureDeclaration([...fixtureQuads().filter((quad) => !remove(quad)), ...extra], ARCHITECTURE);
}

function evaluate(declaration: ArchitectureDeclaration, observation: ArchitectureObservation, expectedPopulationDigest?: string) {
  return evaluateArchitectureConformance({ declaration, observation, assuranceSet: SET, expectedPopulationDigest });
}

function verdictFor(name: string, evaluated: ReturnType<typeof evaluate>) {
  const found = evaluated.requirements.find((each) => each.canonicalName === name);
  assert.ok(found !== undefined, `${name} was evaluated`);
  return found;
}

test("the model carries a hexagonal architecture: layers, ports, adapters and a required edge", () => {
  const declaration = declarationOf();
  assert.equal(declaration.layers.length, 5);
  assert.equal(declaration.components.length, 5);
  assert.equal(declaration.dependencyRules.filter((each) => each.kind === "forbids").length, 12);
  assert.equal(declaration.dependencyRules.filter((each) => each.kind === "permits").length, 8);
  assert.equal(declaration.dependencyRules.filter((each) => each.kind === "requires").length, 1);
  const evaluated = evaluate(declaration, observationFor(declaration));
  assert.equal(evaluated.disposition, conformanceDispositions.conforming);
  assert.equal(evaluated.denominator.unaccounted.length, 0);
  assert.equal(evaluated.denominator.population, HEALTHY_UNITS.length);
});

test("planted forbidden import: the domain reaching an adapter fails dependency direction", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, {
    internalImports: [...HEALTHY_IMPORTS, { from: "src/domain/codec.ts", to: "src/adapters/png.ts" }],
  }));
  const direction = verdictFor("direction", evaluated);
  assert.equal(direction.disposition, conformanceDispositions.failed);
  assert.match(direction.findings.join("\n"), /forbidden dependency: src\/domain\/codec\.ts to src\/adapters\/png\.ts/u);
  assert.equal(evaluated.disposition, conformanceDispositions.failed);
});

test("planted absent required edge: an adapter that implements no port fails dependency direction", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, {
    internalImports: HEALTHY_IMPORTS.filter((each) => !(each.from === "src/adapters/png.ts" && each.to === "src/ports/image-source.ts")),
  }));
  const direction = verdictFor("direction", evaluated);
  assert.equal(direction.disposition, conformanceDispositions.failed);
  assert.match(direction.findings.join("\n"), /required dependency is absent/u);
});

test("planted unreachable implementation: a unit no root reaches and nothing explains is an orphan", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, {
    population: [...HEALTHY_UNITS, "src/application/abandoned.ts"],
  }));
  const reachability = verdictFor("reachability", evaluated);
  assert.equal(reachability.disposition, conformanceDispositions.failed);
  assert.deepEqual(evaluated.denominator.nonConforming, ["src/application/abandoned.ts"]);
  assert.match(reachability.findings.join("\n"), /src\/application\/abandoned\.ts/u);
});

test("an unreachable unit an explicit decision retains is classified rather than reported", () => {
  const declaration = declarationOf([
    iri("urn:fixture:disposition:retained", "type", T("ImplementationDispositionDecision")),
    iri("urn:fixture:disposition:retained", "classifiesAs", classification("superseded-retained")),
    lit("urn:fixture:disposition:retained", "dispositionUnit", "src/application/abandoned.ts"),
    lit("urn:fixture:disposition:retained", "dispositionReason", "kept as historical evidence"),
  ]);
  const evaluated = evaluate(declaration, observationFor(declaration, {
    population: [...HEALTHY_UNITS, "src/application/abandoned.ts"],
  }));
  assert.equal(evaluated.disposition, conformanceDispositions.conforming);
  assert.equal(evaluated.classifications.find((each) => each.unit === "src/application/abandoned.ts")?.classification, classification("superseded-retained"));
});

test("planted unimplemented criterion: accounting reports it rather than letting a unit fall through", () => {
  const declaration = declarationOf([
    iri(ARCHITECTURE, "permittedClassification", "urn:fixture:classification:invented"),
    lit("urn:fixture:classification:invented", "canonicalName", "invented"),
    iri("urn:fixture:classification:invented", "classificationCriterion", "urn:fixture:criterion:unimplemented"),
    lit("urn:fixture:classification:invented", "classificationPrecedence", "5"),
  ]);
  const evaluated = evaluate(declaration, observationFor(declaration));
  const accounting = verdictFor("accounting", evaluated);
  assert.equal(accounting.disposition, conformanceDispositions.failed);
  assert.match(accounting.findings.join("\n"), /no implemented decision procedure: urn:fixture:criterion:unimplemented/u);
});

test("planted coverage gap: a unit beneath no component and no boundary fails ownership", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, {
    population: [...HEALTHY_UNITS, "src/stray/thing.ts"],
    runtimeReachable: [...HEALTHY_UNITS.filter((unit) => !unit.startsWith("src/product/") && !unit.startsWith("src/assurance/")), "src/stray/thing.ts"],
  }));
  const ownership = verdictFor("ownership", evaluated);
  assert.equal(ownership.disposition, conformanceDispositions.failed);
  assert.match(ownership.findings.join("\n"), /src\/stray\/thing\.ts/u);
});

test("planted cycle outside the exception fails the cycle boundary, and inside it does not", () => {
  const declaration = declarationOf();
  const failing = evaluate(declaration, observationFor(declaration, { cycleMembers: ["src/application/produce.ts", "src/domain/codec.ts"] }));
  assert.equal(verdictFor("cycles", failing).disposition, conformanceDispositions.failed);
  const excepted = declarationOf([
    lit("urn:fixture:cycle-policy:1", "permittedCycleMember", "src/application/produce.ts"),
    lit("urn:fixture:cycle-policy:1", "permittedCycleMember", "src/domain/codec.ts"),
  ]);
  const passing = evaluate(excepted, observationFor(excepted, { cycleMembers: ["src/application/produce.ts", "src/domain/codec.ts"] }));
  assert.equal(verdictFor("cycles", passing).disposition, conformanceDispositions.conforming);
});

test("planted product boundary breach: judged implementation depending on deferred implementation fails", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, {
    internalImports: [...HEALTHY_IMPORTS, { from: "src/application/produce.ts", to: "src/product/feature.ts" }],
  }));
  const deferment = verdictFor("deferment", evaluated);
  assert.equal(deferment.disposition, conformanceDispositions.failed);
  assert.match(deferment.findings.join("\n"), /depends on deferred product implementation/u);
});

test("deferred product implementation is counted and is judged by no other requirement", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration));
  assert.deepEqual(evaluated.denominator.deferred, ["src/product/feature.ts"]);
  assert.equal(evaluated.disposition, conformanceDispositions.conforming);
  for (const each of evaluated.requirements) assert.equal(each.findings.join("").includes("src/product/feature.ts"), false);
});

test("planted deferment without an owner fails, because deferment without an owner is abandonment", () => {
  const declaration = declarationOf([], (quad) => quad.subject === "urn:fixture:disposition:product" && quad.predicate === P("dispositionOwner"));
  const evaluated = evaluate(declaration, observationFor(declaration));
  const deferment = verdictFor("deferment", evaluated);
  assert.equal(deferment.disposition, conformanceDispositions.failed);
  assert.match(deferment.findings.join("\n"), /names no owner/u);
});

test("planted assurance inversion: a component importing the observer fails the module boundary", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, {
    internalImports: [...HEALTHY_IMPORTS, { from: "src/delivery/web.ts", to: "src/assurance/observe.ts" }],
  }));
  const boundary = verdictFor("boundary", evaluated);
  assert.equal(boundary.disposition, conformanceDispositions.failed);
  assert.match(boundary.findings.join("\n"), /module boundary crossed/u);
});

test("planted stale root: an entry point resolving to nothing fails entry point integrity", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, { absentEntryPointModules: ["src/delivery/web.ts"] }));
  assert.equal(verdictFor("entry-points", evaluated).disposition, conformanceDispositions.failed);
});

test("planted unresolved import fails import resolution", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, { unresolvedImports: [{ from: "src/delivery/web.ts", specifier: "./gone.ts" }] }));
  assert.equal(verdictFor("imports", evaluated).disposition, conformanceDispositions.failed);
});

test("stale evidence from another tree is rejected, not believed", () => {
  const declaration = declarationOf();
  const observation = observationFor(declaration, { populationDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222" });
  const evaluated = evaluate(declaration, observation, "sha256:1111111111111111111111111111111111111111111111111111111111111111");
  assert.equal(evaluated.disposition, conformanceDispositions.evidenceStale);
  assert.ok(evaluated.requirements.every((each) => each.disposition === conformanceDispositions.evidenceStale));
  assert.match(evaluated.requirements[0]?.reason ?? "", /different implementation tree/u);
});

test("evidence taken against a different declaration is rejected as stale", () => {
  const declaration = declarationOf();
  const observation = observationFor(declaration);
  const moved = declarationOf([iri(ARCHITECTURE, "hasLayer", layer("infrastructure")), lit(layer("infrastructure"), "canonicalName", "infrastructure")]);
  const evaluated = evaluate(moved, observation);
  assert.equal(evaluated.disposition, conformanceDispositions.evidenceStale);
  assert.match(evaluated.requirements[0]?.reason ?? "", /different architecture declaration/u);
});

test("a requirement whose procedure has no implementation is missing evidence, not a pass", () => {
  const declaration = declarationOf([
    iri(SET, "assuranceMember", requirement("invented")),
    lit(requirement("invented"), "canonicalName", "invented"),
    iri(requirement("invented"), "conformanceProcedure", "urn:usf:conformance-procedure:not-implemented"),
    iri(requirement("invented"), "assuranceScope", CORPUS),
  ]);
  const evaluated = evaluate(declaration, observationFor(declaration));
  const invented = verdictFor("invented", evaluated);
  assert.equal(invented.disposition, conformanceDispositions.evidenceMissing);
  assert.equal(evaluated.disposition, conformanceDispositions.evidenceMissing);
  assert.notEqual(evaluated.disposition, conformanceDispositions.conforming);
  assert.notEqual(evaluated.disposition, conformanceDispositions.failed);
});

test("a requirement declaring no procedure at all is missing evidence", () => {
  const declaration = declarationOf([
    iri(SET, "assuranceMember", requirement("undecidable")),
    lit(requirement("undecidable"), "canonicalName", "undecidable"),
    iri(requirement("undecidable"), "assuranceScope", CORPUS),
  ]);
  const evaluated = evaluate(declaration, observationFor(declaration));
  assert.equal(verdictFor("undecidable", evaluated).disposition, conformanceDispositions.evidenceMissing);
});

test("a corpus requirement judged against a confined observation is unsatisfied scope, not a pass", () => {
  const declaration = declarationOf();
  const evaluated = evaluate(declaration, observationFor(declaration, { scope: CONFINED }));
  assert.equal(evaluated.disposition, conformanceDispositions.scopeUnsatisfied);
  assert.ok(evaluated.requirements.every((each) => each.disposition === conformanceDispositions.scopeUnsatisfied));
  assert.notEqual(evaluated.disposition, conformanceDispositions.conforming);
  assert.notEqual(evaluated.disposition, conformanceDispositions.failed);
  assert.match(evaluated.requirements[0]?.reason ?? "", /candidate-confined/u);
});

test("a release claim fails closed when a required assurance set produced no verdict", () => {
  const declaration = declarationOf();
  const composed = composeReleaseAssurance(declaration, CLAIM, []);
  assert.deepEqual(composed.missing, [SET]);
  assert.deepEqual(composed.failed, []);
  assert.equal(composed.disposition, conformanceDispositions.evidenceMissing);
});

test("a release claim distinguishes missing evidence from failed evidence", () => {
  const declaration = declarationOf();
  const failing = evaluate(declaration, observationFor(declaration, {
    internalImports: [...HEALTHY_IMPORTS, { from: "src/domain/codec.ts", to: "src/adapters/png.ts" }],
  }));
  const composed = composeReleaseAssurance(declaration, CLAIM, [failing]);
  assert.deepEqual(composed.failed, [SET]);
  assert.deepEqual(composed.missing, []);
  assert.equal(composed.disposition, conformanceDispositions.failed);
  assert.notEqual(composed.disposition, conformanceDispositions.evidenceMissing);
});

test("an unknown release claim cannot be satisfied by an empty dependency list", () => {
  const declaration = declarationOf();
  const composed = composeReleaseAssurance(declaration, "urn:fixture:release-claim:absent", []);
  assert.deepEqual(composed.required, []);
  assert.equal(composed.disposition, conformanceDispositions.evidenceMissing);
});

test("replacing the observer leaves the verdict identical", () => {
  const declaration = declarationOf();
  const first = evaluate(declaration, observationFor(declaration, { producer: "urn:fixture:observer:textual" }));
  const second = evaluate(declaration, observationFor(declaration, { producer: "urn:fixture:observer:compiler-backed" }));
  assert.notEqual(first.producer, second.producer);
  assert.deepEqual({ ...first, producer: null }, { ...second, producer: null });
});

test("classification precedence is what the declaration says, not what the evaluator prefers", () => {
  const withoutPrecedence = declarationOf();
  assert.deepEqual(
    withoutPrecedence.classifications.map((each) => each.canonicalName),
    ["product-declared", "runtime-reachable", "assurance-tooling", "declared-realisation-artefact", "validation-support", "generated", "superseded-retained", "unexplained-orphan"],
  );
  // Reversing one precedence in the graph reverses the assignment, with no code change.
  const reordered = declarationOf(
    [lit(classification("superseded-retained"), "classificationPrecedence", "1")],
    (quad) => quad.subject === classification("superseded-retained") && quad.predicate === P("classificationPrecedence"),
  );
  assert.equal(reordered.classifications[0]?.canonicalName, "superseded-retained");
});
