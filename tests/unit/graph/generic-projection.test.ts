import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { canonicalQuadDigest, parseStrictNQuads, sha256, type Quad } from "../../../src/graph/nquads.ts";
import { queryGraph } from "../../../src/graph/query.ts";
import { deriveWork, type WorkPacket } from "../../../src/graph/work.ts";
import { GraphLoadError, loadSemanticGraph, type GraphManifest, type SemanticGraph } from "../../../src/graph/index.ts";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const serviceGraph = "urn:fixture:graph:service";
const foundationGraph = "urn:fixture:graph:foundation";

function nq(subject: string, predicate: string, object: string, graph: string, literal = false): string {
  return `<${subject}> <urn:usf:predicate:${predicate}> ${literal ? JSON.stringify(object) : `<${object}>`} <${graph}> .`;
}

const serviceLines = [
  nq("urn:fixture:contract:health", "type", "urn:usf:type:SemanticContract", serviceGraph),
  nq("urn:fixture:contract:health", "privacy", "private-metadata", serviceGraph, true),
  nq("urn:fixture:contract:health", "targetRuntimeProvider", "urn:fixture:runtime:edge", serviceGraph, true),
  nq("urn:fixture:contract:health", "constructionRouteConstraint", "zero-cost structured output", serviceGraph, true),
  nq("urn:fixture:contract:health", "modelCapability", "json-schema", serviceGraph, true),
  nq("urn:fixture:contract:health", "environmentApplicability", "urn:fixture:binding:health-test", serviceGraph),
  nq("urn:fixture:contract:health", "requires", "urn:fixture:requirement:health", serviceGraph),
  nq("urn:fixture:contract:health", "permitsWrite", "src/graph/", serviceGraph, true),
  nq("urn:fixture:contract:health", "nonClaim", "No live deployment is claimed.", serviceGraph, true),
  nq("urn:fixture:contract:health", "policyPath", "config/privacy.json", serviceGraph, true),
  nq("urn:fixture:contract:health", "schemaPath", "schemas/contribution.schema.json", serviceGraph, true),
  nq("urn:fixture:contract:health", "toolPath", "package.json", serviceGraph, true),
  nq("urn:fixture:binding:health-test", "type", "urn:usf:type:EnvironmentApplicability", serviceGraph),
  nq("urn:fixture:binding:health-test", "environment", "urn:fixture:environment:test", serviceGraph),
  nq("urn:fixture:binding:health-test", "applicability", "required", serviceGraph, true),
  nq("urn:fixture:contract:other", "type", "urn:usf:type:SemanticContract", serviceGraph),
  nq("urn:fixture:contract:other", "environmentApplicability", "urn:fixture:binding:other-test", serviceGraph),
  nq("urn:fixture:binding:other-test", "type", "urn:usf:type:EnvironmentApplicability", serviceGraph),
  nq("urn:fixture:binding:other-test", "environment", "urn:fixture:environment:test", serviceGraph),
  nq("urn:fixture:binding:other-test", "applicability", "reserved", serviceGraph, true),
  nq("urn:fixture:requirement:health", "type", "urn:usf:type:Requirement", serviceGraph),
  nq("urn:fixture:requirement:health", "text", "Return a deterministic service-health snapshot.", serviceGraph, true),
  nq("urn:fixture:acceptance:health", "type", "urn:usf:type:AcceptanceCriterion", serviceGraph),
  nq("urn:fixture:acceptance:health", "text", "Identical inputs produce identical snapshots.", serviceGraph, true),
  nq("urn:fixture:validation:health", "type", "urn:usf:type:TestObligation", serviceGraph),
  nq("urn:fixture:validation:health", "command", "node --test tests/unit/graph/generic-projection.test.ts", serviceGraph, true),
  nq("urn:fixture:validation:health", "environment", "urn:fixture:environment:test", serviceGraph),
  nq("urn:fixture:validation:health", "executionMode", "urn:fixture:mode:deterministic", serviceGraph),
  nq("urn:fixture:validation:health", "applicability", "required", serviceGraph, true),
  nq("urn:fixture:proof:health", "type", "urn:usf:type:ProofObligation", serviceGraph),
  nq("urn:fixture:proof:health", "text", "Current deterministic validation is required.", serviceGraph, true),
  nq("urn:fixture:proof:health", "environment", "urn:fixture:environment:test", serviceGraph),
  nq("urn:fixture:proof:health", "executionMode", "urn:fixture:mode:deterministic", serviceGraph),
  nq("urn:fixture:proof:health", "applicability", "required", serviceGraph, true),
  nq("urn:fixture:work:health", "type", "urn:usf:type:WorkPacket", serviceGraph),
  nq("urn:fixture:work:health", "contract", "urn:fixture:contract:health", serviceGraph),
  nq("urn:fixture:work:health", "objective", "Implement the health snapshot evaluator.", serviceGraph, true),
  nq("urn:fixture:work:health", "readPath", "README.md", serviceGraph, true),
  nq("urn:fixture:work:health", "writePath", "src/graph/query.ts", serviceGraph, true),
  nq("urn:fixture:work:health", "acceptance", "urn:fixture:acceptance:health", serviceGraph),
  nq("urn:fixture:work:health", "validation", "urn:fixture:validation:health", serviceGraph),
  nq("urn:fixture:work:health", "proof", "urn:fixture:proof:health", serviceGraph),
  nq("urn:fixture:work:health", "modelCapability", "typescript", serviceGraph, true),
  nq("urn:fixture:work:health", "outputSchema", "urn:fixture:schema:health-contribution", serviceGraph, true),
];

const foundationLines = [
  nq("urn:fixture:environment:test", "type", "urn:usf:type:Environment", foundationGraph),
  nq("urn:fixture:mode:deterministic", "type", "urn:usf:type:ExecutionMode", foundationGraph),
  nq("urn:fixture:unrelated", "text", "Must not enter the health packet closure.", foundationGraph, true),
];

function fixtureGraph(transform: (quads: Quad[]) => Quad[] = (quads) => quads): SemanticGraph {
  const service = parseStrictNQuads(`${serviceLines.join("\n")}\n`, serviceGraph);
  const foundation = parseStrictNQuads(`${foundationLines.join("\n")}\n`, foundationGraph);
  const quads = transform([...service, ...foundation]);
  const manifest: GraphManifest = {
    schema: "urn:usf:graph-manifest:2",
    version: 2,
    imports: [],
    sources: [
      { path: "graph/service.nq", format: "application/n-quads", graph: serviceGraph, role: "contract", validationProfile: "bootstrap-nquads-v1" },
      { path: "graph/foundation.nq", format: "application/n-quads", graph: foundationGraph, role: "vocabulary", validationProfile: "bootstrap-nquads-v1" },
    ],
  };
  return {
    manifest,
    quads,
    semanticDigest: canonicalQuadDigest(quads),
    graphDigests: {
      [serviceGraph]: canonicalQuadDigest(quads.filter((quad) => quad.graph === serviceGraph)),
      [foundationGraph]: canonicalQuadDigest(quads.filter((quad) => quad.graph === foundationGraph)),
    },
    sourceDigests: { "graph/service.nq": sha256("service"), "graph/foundation.nq": sha256("foundation") },
    repositoryRoot: root,
  };
}

function onlyPacket(graph = fixtureGraph()): WorkPacket {
  const result = deriveWork(graph, { selector: "contract:urn:fixture:contract:health" });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.length, 1);
  return result.items?.[0] as WorkPacket;
}

test("the manifest loader composes more than one declared named graph", (context) => {
  const temporaryParent = process.env.TMPDIR ?? resolve(root, ".usf/tmp");
  mkdirSync(temporaryParent, { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(resolve(temporaryParent, "graph-manifest-"));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  mkdirSync(resolve(temporaryRoot, "graph"));
  const manifest: GraphManifest = {
    schema: "urn:usf:graph-manifest:2",
    version: 2,
    imports: [],
    sources: [
      { path: "graph/a.nq", format: "application/n-quads", graph: "urn:fixture:graph:a", role: "contract", validationProfile: "bootstrap-nquads-v1" },
      { path: "graph/b.nq", format: "application/n-quads", graph: "urn:fixture:graph:b", role: "vocabulary", validationProfile: "bootstrap-nquads-v1" },
    ],
  };
  writeFileSync(resolve(temporaryRoot, "graph/manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  writeFileSync(resolve(temporaryRoot, "graph/a.nq"), `${nq("urn:fixture:a", "text", "a", "urn:fixture:graph:a", true)}\n`, { mode: 0o600 });
  writeFileSync(resolve(temporaryRoot, "graph/b.nq"), `${nq("urn:fixture:b", "text", "b", "urn:fixture:graph:b", true)}\n`, { mode: 0o600 });
  const loaded = loadSemanticGraph(temporaryRoot);
  assert.equal(loaded.manifest.sources.length, 2);
  assert.deepEqual(Object.keys(loaded.graphDigests).sort(), ["urn:fixture:graph:a", "urn:fixture:graph:b"]);
  assert.equal(loaded.quads.length, 2);
});

test("v2 import expansion deduplicates diamonds and exact sources while bounding count, depth and aggregate bytes", (context) => {
  const temporaryParent = process.env.TMPDIR ?? resolve(root, ".usf/tmp");
  mkdirSync(temporaryParent, { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(resolve(temporaryParent, "graph-imports-"));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  mkdirSync(resolve(temporaryRoot, "graph"));
  const source = { path: "graph/source.nq", format: "application/n-quads" as const, graph: "urn:fixture:graph:diamond", role: "contract", validationProfile: "bootstrap-nquads-v1" as const };
  const manifest = (imports: string[], sources: typeof source[] = []): GraphManifest => ({ schema: "urn:usf:graph-manifest:2", version: 2, imports, sources });
  const writeManifest = (name: string, value: GraphManifest): number => {
    const content = `${JSON.stringify(value)}\n`;
    writeFileSync(resolve(temporaryRoot, `graph/${name}.json`), content, { mode: 0o600 });
    return Buffer.byteLength(content);
  };
  writeFileSync(resolve(temporaryRoot, source.path), `${nq("urn:fixture:diamond", "text", "one", source.graph, true)}\n`, { mode: 0o600 });
  writeManifest("leaf", manifest([], [source]));
  writeManifest("left", manifest(["graph/leaf.json"]));
  writeManifest("right", manifest(["graph/leaf.json"]));
  const rootBytes = writeManifest("manifest", manifest(["graph/left.json", "graph/right.json"], [source]));

  const loaded = loadSemanticGraph(temporaryRoot);
  const loadedAtSourceBound = loadSemanticGraph(temporaryRoot, "graph/manifest.json", { maxSourceCount: 1 });
  assert.deepEqual(loaded.manifests.map((entry) => entry.path), ["graph/leaf.json", "graph/left.json", "graph/right.json", "graph/manifest.json"]);
  assert.equal(loaded.sources.length, 1);
  assert.equal(loaded.quads.length, 1);
  assert.equal(loadedAtSourceBound.sources.length, 1, "an exact repeated declaration is one source at the configured bound");
  assert.throws(() => loadSemanticGraph(temporaryRoot, "graph/manifest.json", { maxManifestCount: 3 }), (error) => error instanceof GraphLoadError && error.reasonCode === "MANIFEST_LIMIT_EXCEEDED");
  assert.throws(() => loadSemanticGraph(temporaryRoot, "graph/manifest.json", { maxManifestDepth: 2 }), (error) => error instanceof GraphLoadError && error.reasonCode === "MANIFEST_IMPORT_DEPTH_EXCEEDED");
  assert.throws(() => loadSemanticGraph(temporaryRoot, "graph/manifest.json", { maxTotalManifestBytes: rootBytes + 1 }), (error) => error instanceof GraphLoadError && error.reasonCode === "MANIFEST_TOTAL_BYTES_EXCEEDED");

  writeFileSync(resolve(temporaryRoot, "graph/other.nq"), `${nq("urn:fixture:other", "text", "other", source.graph, true)}\n`, { mode: 0o600 });
  writeManifest("manifest", manifest([], [{ ...source, path: "graph/source.nq" }, { ...source, path: "graph/other.nq" }]));
  assert.throws(() => loadSemanticGraph(temporaryRoot), (error) => error instanceof GraphLoadError && error.reasonCode === "MANIFEST_DUPLICATE_SOURCE_OR_GRAPH");
});

test("self, direct and indirect import cycles plus manifest symlinks fail closed", (context) => {
  const temporaryParent = process.env.TMPDIR ?? resolve(root, ".usf/tmp");
  mkdirSync(temporaryParent, { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(resolve(temporaryParent, "graph-cycles-"));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  mkdirSync(resolve(temporaryRoot, "graph"));
  const manifest = (imports: string[]): GraphManifest => ({ schema: "urn:usf:graph-manifest:2", version: 2, imports, sources: [] });
  const writeManifest = (name: string, imports: string[]): void => writeFileSync(resolve(temporaryRoot, `graph/${name}.json`), `${JSON.stringify(manifest(imports))}\n`, { mode: 0o600 });
  const cycles = [
    { root: ["graph/manifest.json"], a: [], b: [] },
    { root: ["graph/a.json"], a: ["graph/manifest.json"], b: [] },
    { root: ["graph/a.json"], a: ["graph/b.json"], b: ["graph/manifest.json"] },
  ];
  for (const cycle of cycles) {
    writeManifest("manifest", cycle.root);
    writeManifest("a", cycle.a);
    writeManifest("b", cycle.b);
    assert.throws(() => loadSemanticGraph(temporaryRoot), (error) => error instanceof GraphLoadError && error.reasonCode === "MANIFEST_IMPORT_CYCLE");
  }

  writeManifest("target", []);
  symlinkSync("target.json", resolve(temporaryRoot, "graph/alias.json"));
  assert.throws(() => loadSemanticGraph(temporaryRoot, "graph/alias.json"), (error) => error instanceof GraphLoadError && error.reasonCode === "MANIFEST_PATH_ESCAPE");
});

test("one graph-generic projection derives a non-product contract across two manifest graphs", () => {
  const graph = fixtureGraph();
  const packet = onlyPacket(graph);
  assert.equal(JSON.stringify(packet).includes("anqr"), false);
  assert.equal(packet.privacy, "private-metadata");
  assert.equal(packet.targetRuntimeProvider, "urn:fixture:runtime:edge");
  assert.deepEqual(packet.modelCapabilities, ["json-schema", "typescript"]);
  assert.deepEqual(packet.constructionRouteConstraints, ["zero-cost structured output"]);
  assert.deepEqual(packet.environmentPosture, [{ binding: "urn:fixture:binding:health-test", environment: "urn:fixture:environment:test", applicability: "required" }]);
  assert.equal(packet.validationPlan[0]?.applicability, "required");
  assert.equal(packet.proofObligations[0]?.applicability, "required");
  assert.equal(packet.outputSchema, "urn:fixture:schema:health-contribution");

  const dependencies = new Map(packet.semanticDependencies.map((entry) => [`${entry.kind}|${entry.key}`, entry.digest]));
  for (const resource of [
    "urn:fixture:requirement:health",
    "urn:fixture:acceptance:health",
    "urn:fixture:validation:health",
    "urn:fixture:proof:health",
    "urn:fixture:binding:health-test",
    "urn:fixture:environment:test",
    "urn:fixture:mode:deterministic",
  ]) assert.ok(dependencies.has(`semantic-resource|${resource}`), resource);
  assert.equal([...dependencies.keys()].some((key) => key.startsWith("manifest|")), false);
  assert.ok(dependencies.has("policy|config/privacy.json"));
  assert.ok(dependencies.has("schema|schemas/contribution.schema.json"));
  assert.ok(dependencies.has("tool|package.json"));
  assert.equal([...dependencies.keys()].some((key) => key.includes("urn:fixture:unrelated")), false);

  const enumerated = queryGraph(graph, { selector: "contracts" });
  assert.equal(enumerated.dependencyManifest?.filter((entry) => entry.kind === "semantic-graph").length, 2);
  const exact = queryGraph(graph, { contract: "urn:fixture:contract:health" });
  assert.equal(exact.dependencyManifest?.some((entry) => entry.kind === "semantic-graph"), false);
});

test("per-contract environment bindings permit different postures for the same environment", () => {
  const graph = fixtureGraph();
  const health = graph.quads.find((quad) => quad.subject === "urn:fixture:binding:health-test" && quad.predicate.endsWith(":applicability"));
  const other = graph.quads.find((quad) => quad.subject === "urn:fixture:binding:other-test" && quad.predicate.endsWith(":applicability"));
  assert.equal(health?.object, "required");
  assert.equal(other?.object, "reserved");
  assert.equal(onlyPacket(graph).environmentPosture[0]?.applicability, "required");
});

test("transitive semantic movement invalidates while an unrelated resource does not", () => {
  const baseline = onlyPacket();
  const acceptanceMoved = onlyPacket(fixtureGraph((quads) => quads.map((quad) => quad.subject === "urn:fixture:acceptance:health" && quad.predicate.endsWith(":text") ? {
    ...quad,
    object: "Changed accepted behavior.",
    canonical: nq("urn:fixture:acceptance:health", "text", "Changed accepted behavior.", serviceGraph, true),
  } : quad)));
  const unrelatedMoved = onlyPacket(fixtureGraph((quads) => quads.map((quad) => quad.subject === "urn:fixture:unrelated" ? {
    ...quad,
    object: "Unrelated movement.",
    canonical: nq("urn:fixture:unrelated", "text", "Unrelated movement.", foundationGraph, true),
  } : quad)));
  assert.notEqual(acceptanceMoved.scopedDependencyDigest, baseline.scopedDependencyDigest);
  assert.equal(unrelatedMoved.scopedDependencyDigest, baseline.scopedDependencyDigest);
});

test("planted unauthorized and magic write declarations fail for stable reasons", () => {
  const unauthorized = fixtureGraph((quads) => quads.map((quad) => quad.subject === "urn:fixture:work:health" && quad.predicate.endsWith(":writePath") ? { ...quad, object: "apps/other.ts" } : quad));
  assert.throws(() => deriveWork(unauthorized), /WORK_WRITE_NOT_PERMITTED:urn:fixture:work:health:apps\/other\.ts/);
  const magic = fixtureGraph((quads) => quads.map((quad) => quad.subject === "urn:fixture:work:health" && quad.predicate.endsWith(":writePath") ? { ...quad, object: "src\/graph\/**" } : quad));
  assert.throws(() => deriveWork(magic), /WORK_WRITE_PATH_INVALID:src\/graph\/\*\*/);
});

test("a planted semantic work cycle is refused rather than scheduled", () => {
  const graph = fixtureGraph((quads) => [
    ...quads,
    {
      subject: "urn:fixture:work:health",
      predicate: "urn:usf:predicate:dependsOn",
      object: "urn:fixture:work:health",
      objectKind: "iri" as const,
      graph: serviceGraph,
      canonical: "planted-self-cycle",
    },
  ]);
  assert.throws(() => deriveWork(graph), /WORK_DEPENDENCY_CYCLE:urn:fixture:work:health->urn:fixture:work:health/);
});

test("global environment status cannot substitute for a contract applicability binding", () => {
  const graph = fixtureGraph((quads) => [
    ...quads.filter((quad) => !(quad.subject === "urn:fixture:contract:health" && quad.predicate.endsWith(":environmentApplicability"))),
    {
      subject: "urn:fixture:environment:test",
      predicate: "urn:usf:predicate:applicability",
      object: "required",
      objectKind: "literal" as const,
      graph: foundationGraph,
      canonical: "planted-global-applicability",
    },
  ]);
  assert.throws(() => deriveWork(graph, { selector: "contract:urn:fixture:contract:health" }), /CONTRACT_ENVIRONMENT_APPLICABILITY_REQUIRED/);
});


test("explicit no-task-class work keeps validation obligations and scoped identity", () => {
  const graph = fixtureGraph((quads) => [
    ...quads.filter((quad) => quad.predicate !== "urn:usf:predicate:modelCapability"),
    ...parseStrictNQuads(nq("urn:fixture:work:health", "taskClassRequirement", "none", serviceGraph, true) + "\n", serviceGraph),
  ]);
  const packet = onlyPacket(graph);
  const original = onlyPacket();
  assert.deepEqual(packet.modelCapabilities, []);
  assert.deepEqual(packet.validationPlan, original.validationPlan);
  assert.deepEqual(packet.acceptanceCriteria, original.acceptanceCriteria);
  assert.notEqual(packet.scopedDependencyDigest, original.scopedDependencyDigest);
  assert.ok(packet.semanticDependencies.some((entry) => entry.key === "urn:fixture:work:health"));
});

test("missing task-class authoring stays distinct from explicit none", () => {
  const omitted = fixtureGraph((quads) => quads.filter((quad) => quad.predicate !== "urn:usf:predicate:modelCapability"));
  assert.throws(() => deriveWork(omitted), /MODEL_CAPABILITY_REQUIRED:urn:fixture:work:health/);
  const contractOnly = fixtureGraph((quads) => [
    ...quads.filter((quad) => quad.predicate !== "urn:usf:predicate:modelCapability"),
    ...parseStrictNQuads(nq("urn:fixture:contract:health", "taskClassRequirement", "none", serviceGraph, true) + "\n", serviceGraph),
  ]);
  assert.throws(() => deriveWork(contractOnly), /MODEL_CAPABILITY_REQUIRED:urn:fixture:work:health/);
});

test("malformed or multiple task-class dispositions refuse", () => {
  for (const lines of [
    [nq("urn:fixture:work:health", "taskClassRequirement", "optional", serviceGraph, true)],
    [nq("urn:fixture:work:health", "taskClassRequirement", "urn:fixture:none", serviceGraph)],
    [nq("urn:fixture:work:health", "taskClassRequirement", "none", serviceGraph, true), nq("urn:fixture:work:health", "taskClassRequirement", "optional", serviceGraph, true)],
  ]) {
    const graph = fixtureGraph((quads) => [
      ...quads.filter((quad) => quad.predicate !== "urn:usf:predicate:modelCapability"),
      ...parseStrictNQuads(lines.join("\n") + "\n", serviceGraph),
    ]);
    assert.throws(() => deriveWork(graph), /TASK_CLASS_REQUIREMENT_INVALID:urn:fixture:work:health/);
  }
});

test("explicit none cannot erase work or contract capability requirements", () => {
  for (const subject of ["urn:fixture:work:health", "urn:fixture:contract:health"]) {
    const graph = fixtureGraph((quads) => [
      ...quads.filter((quad) => quad.predicate !== "urn:usf:predicate:modelCapability" || quad.subject === subject),
      ...parseStrictNQuads(nq("urn:fixture:work:health", "taskClassRequirement", "none", serviceGraph, true) + "\n", serviceGraph),
    ]);
    assert.throws(() => deriveWork(graph), /TASK_CLASS_REQUIREMENT_CONFLICT:urn:fixture:work:health/);
  }
  assert.deepEqual(onlyPacket().modelCapabilities, ["json-schema", "typescript"]);
});
