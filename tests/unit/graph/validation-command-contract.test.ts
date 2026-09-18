import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { inspectCheckCommand } from "../../../src/core/check-command.ts";
import {
  loadSemanticGraph, objectsFor, objectValues, validationRuntimeClosure, type SemanticGraph,
} from "../../../src/graph/index.ts";

const predicate = (name: string) => `urn:usf:predicate:${name}`;
const root = resolve(import.meta.dirname, "../../..");
const qualificationWork = "urn:usf:work:cli-provider-qualification-help";
const qualificationValidation = "urn:usf:validation:cli-provider-qualification-help";
const qualificationManifest = "graph/manifests/cli-provider-qualification-help.json";
const wrapperPath = "tests/fixtures/cli-provider-qualification-help.test.ts";
const acceptancePath = "tests/fixtures/cli-provider-qualification-help.acceptance.ts";

function exactValue(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string {
  const rows = objectsFor(graph, subject, predicate(name));
  assert.equal(rows.length, 1, `${subject}: expected one ${name}`);
  assert.equal(rows[0]!.objectKind, kind, `${subject}: ${name} must be ${kind}`);
  return rows[0]!.object;
}

function selectedValidations() {
  const bindings = loadSemanticGraph(root, "graph/manifests/linear-issue-bindings.json");
  const workSelections = new Map<string, { manifest: string; work: string }>();
  const include = (manifest: string, work: string) => workSelections.set(
    JSON.stringify([manifest, work]), { manifest, work },
  );
  include("graph/manifests/cli-transition-definition.json", "urn:usf:work:cli-transition-definition");
  const bindingIds = bindings.quads.filter(quad => quad.predicate === predicate("type")
    && quad.objectKind === "iri" && quad.object === "urn:usf:type:LinearIssueWorkBinding").map(quad => quad.subject);
  assert.ok(bindingIds.length > 0, "the graph binding registry must not be empty");
  for (const binding of bindingIds) {
    include(exactValue(bindings, binding, "targetManifest", "literal"),
      exactValue(bindings, binding, "workIri", "iri"));
  }
  const rows: { manifest: string; work: string; validation: string; graph: SemanticGraph }[] = [];
  for (const { manifest, work } of workSelections.values()) {
    const graph = loadSemanticGraph(root, manifest);
    assert.equal(exactValue(graph, work, "type", "iri"), "urn:usf:type:WorkPacket");
    const contract = exactValue(graph, work, "contract", "iri");
    const selections = [
      ...objectsFor(graph, work, predicate("validation")),
      ...objectsFor(graph, contract, predicate("completionValidationObligation")),
    ];
    assert.ok(selections.length > 0, `${work}: no validation obligations selected`);
    for (const selection of selections) assert.equal(selection.objectKind, "iri", `${work}: validation selector must be an IRI`);
    for (const validation of [...new Set(selections.map(selection => selection.object))].sort()) {
      assert.equal(exactValue(graph, validation, "type", "iri"), "urn:usf:type:TestObligation");
      rows.push({ manifest, work, validation, graph });
    }
  }
  assert.ok(rows.some(row => row.work === qualificationWork && row.validation === qualificationValidation),
    "the actual qualification work must remain in the selected operator frontier");
  return rows;
}
const nativeCheckModes = new Set([
  "urn:usf:mode:deterministic-test-substitute",
  "urn:usf:mode:confined-fixture-process:1",
  "urn:usf:mode:confined-fixture-process:2",
]);

function commandFailures(rows: ReturnType<typeof selectedValidations>) {
  const failures: { validation: string; mode: string; command: string; inspection: ReturnType<typeof inspectCheckCommand> }[] = [];
  const directHost: string[] = [];
  for (const row of rows) {
    const mode = exactValue(row.graph, row.validation, "executionMode", "iri");
    if (mode === "urn:usf:mode:full-gate-direct-host-operator:1") {
      directHost.push(row.validation);
      continue;
    }
    assert.ok(nativeCheckModes.has(mode), `${row.validation}: undeclared command-family applicability ${mode}`);
    assert.equal(exactValue(row.graph, row.validation, "environment", "iri"), "urn:usf:environment:hermetic");
    assert.equal(exactValue(row.graph, row.validation, "applicability", "literal"), "required");
    const command = exactValue(row.graph, row.validation, "command", "literal");
    const inspection = inspectCheckCommand(command.split(" "));
    if (inspection.status !== "valid") failures.push({ validation: row.validation, mode, command, inspection });
  }
  return { failures, directHost };
}

const frontier = selectedValidations();

function assertQualificationPolicyAssets(graph: SemanticGraph): void {
  const mode = exactValue(graph, qualificationValidation, "executionMode", "iri");
  const viewPaths = new Set([
    ...objectValues(graph, qualificationWork, predicate("readPath")),
    ...objectValues(graph, qualificationWork, predicate("writePath")),
    ...validationRuntimeClosure(graph, qualificationValidation).repositoryReadFiles,
  ]);
  for (const field of ["fixtureProfileAssetPath", "fixtureLauncherPath"]) {
    const path = exactValue(graph, mode, field, "literal");
    assert.ok(viewPaths.has(path), `required fixture policy asset missing from the execution view: ${path}`);
  }
}

test("graph-selected operator frontier validations use the native command contract", context => {
  const result = commandFailures(frontier);
  assert.deepEqual(result.failures, [], "selected declarations must use the same grammar as native confinement");
  context.diagnostic(`${frontier.length} graph-selected obligations; ${result.directHost.length} explicit direct-host obligations outside check`);
});

test("qualification validation keeps its compatible entry point and immutable acceptance read-only", () => {
  const graph = frontier.find(row => row.validation === qualificationValidation)!.graph;
  const command = exactValue(graph, qualificationValidation, "command", "literal");
  const inspected = inspectCheckCommand(command.split(" "));
  assert.equal(inspected.status, "valid");
  if (inspected.status !== "valid") assert.fail("qualification command is invalid");
  assert.deepEqual(inspected.testPaths, [wrapperPath]);
  assert.equal(readFileSync(resolve(root, wrapperPath), "utf8"),
    'import "./cli-provider-qualification-help.acceptance.ts";\n');
  assert.equal(createHash("sha256").update(readFileSync(resolve(root, acceptancePath))).digest("hex"),
    "0420c2dd2a40ccecb3e0d9cb2402530714399c4db4eb6b535c9bead2872acb6e",
    "the original immutable acceptance bytes must not change");
  const readPaths = objectValues(graph, qualificationWork, predicate("readPath"));
  assert.ok(readPaths.includes(wrapperPath), "the native candidate must carry the wrapper");
  assert.ok(readPaths.includes(acceptancePath), "the native candidate must carry the immutable imported fixture");
  const closure = validationRuntimeClosure(graph, qualificationValidation);
  assert.ok(closure.repositoryReadFiles.includes(wrapperPath), "the selected supplemental closure must name the wrapper");
  assert.ok(closure.repositoryReadFiles.length <= 128);
  assertQualificationPolicyAssets(graph);
  assert.deepEqual(objectValues(graph, qualificationWork, predicate("writePath")), ["src/commands/help.ts"]);
  const contract = exactValue(graph, qualificationWork, "contract", "iri");
  assert.deepEqual(objectValues(graph, contract, predicate("permitsWrite")), ["src/commands/help.ts"]);
});

function replaceSelectedValue(row: (typeof frontier)[number], name: string, value: string) {
  let replaced = 0;
  const graph: SemanticGraph = {
    ...row.graph,
    quads: row.graph.quads.map(quad => {
      if (quad.subject !== row.validation || quad.predicate !== predicate(name)) return quad;
      replaced += 1;
      return { ...quad, object: value };
    }),
  };
  assert.equal(replaced, 1, "negative control must change exactly one actual graph declaration");
  return { ...row, graph };
}

test("qualification closure rejects either missing execution-policy asset without running a fixture", () => {
  const graph = frontier.find(row => row.validation === qualificationValidation)!.graph;
  assertQualificationPolicyAssets(graph);
  const closure = validationRuntimeClosure(graph, qualificationValidation);
  const mode = exactValue(graph, qualificationValidation, "executionMode", "iri");
  for (const field of ["fixtureProfileAssetPath", "fixtureLauncherPath"]) {
    const path = exactValue(graph, mode, field, "literal");
    let removed = 0;
    const withoutAsset: SemanticGraph = {
      ...graph,
      quads: graph.quads.filter(quad => {
        const selected = quad.subject === closure.id && quad.predicate === predicate("repositoryReadFile")
          && quad.objectKind === "literal" && quad.object === path;
        if (selected) removed += 1;
        return !selected;
      }),
    };
    assert.equal(removed, 1, "negative control must remove exactly one selected runtime asset");
    assert.throws(() => assertQualificationPolicyAssets(withoutAsset),
      { message: `required fixture policy asset missing from the execution view: ${path}` });
  }
});

test("the graph guard rejects the original declaration in memory and fails closed on unknown modes", () => {
  const selected = frontier.find(row => row.validation === qualificationValidation)!;
  assert.deepEqual(commandFailures([selected]).failures, [], "negative control starts from the valid current declaration");
  const command = exactValue(selected.graph, selected.validation, "command", "literal");
  assert.ok(command.includes(wrapperPath));
  const original = replaceSelectedValue(selected, "command", command.replace(wrapperPath, acceptancePath));
  assert.deepEqual(commandFailures([original]).failures.map(failure => failure.inspection), [{
    status: "invalid",
    reasonCode: "CHECK_COMMAND_CONTRACT_INVALID",
    detail: "TEST_PATH_INVALID",
    invalidPaths: [acceptancePath],
  }]);
  assert.throws(() => commandFailures([replaceSelectedValue(original, "executionMode",
    "urn:usf:mode:unrecognised-check-mode")]), /undeclared command-family applicability/u);
  const directHost = replaceSelectedValue(original, "executionMode", "urn:usf:mode:full-gate-direct-host-operator:1");
  assert.deepEqual(commandFailures([directHost]), { failures: [], directHost: [qualificationValidation] },
    "the explicit operator full gate is not a native check command");
});
