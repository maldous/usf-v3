import assert from "node:assert/strict";
import test from "node:test";
import { observationCommandHandler, parseTransitionInterrogation, validateLocalObservationRoles, inspectObservationTransition, observationTransitionAdapters, deriveTransitionSchemaResult, transitionCommandHandler } from "../../../src/commands/transition.ts";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import { parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { deriveCliTransitionCoverage } from "../../../src/graph/cli-transitions.ts";
import { findHelpTopic, transitionInterrogationContract, transitionSchemaContract } from "../../../src/commands/help.ts";
import { canonicalDigest } from "../../../src/core/canonical.ts";

function actualDescriptorGraph(): SemanticGraph {
  const quads = parseStrictNQuads(readFileSync(new URL("../../../graph/cli-transition-definition.nq", import.meta.url), "utf8"), "urn:usf:graph:cli-transition-definition");
  quads.push(...parseStrictNQuads(readFileSync(new URL("../../../graph/v3-convention.nq", import.meta.url), "utf8"), "urn:usf:graph:v3-convention"));
  return { quads, manifest: { schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [] }, semanticDigest: "untrusted", graphDigests: {}, sourceDigests: {}, repositoryRoot: "/unused" };
}

test("schema CLI uses the same selectors and emits current graph-derived schema without authority", () => {
  assert.equal(transitionSchemaContract.inputs, transitionInterrogationContract.inputs);
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  assert.deepEqual(parseTransitionInterrogation(["schema", "--root", selection.rootIdentity, "--manifest", selection.manifestPath]), selection);
  const topic = findHelpTopic(transitionSchemaContract.path)!;
  assert.equal(topic.outputSchema, "urn:usf:cli-schema-derivation:1");
  assert.equal(topic.externalContact, "none");
  const graph = actualDescriptorGraph(), before = JSON.stringify(graph);
  const result = deriveTransitionSchemaResult(graph, selection);
  const installed = JSON.parse(readFileSync(new URL("../../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(result.descriptorSchema, installed);
  assert.equal(result.schemaDigest, canonicalDigest(installed));
  assert.equal(result.executionAuthority, "none");
  assert(result.operationalGaps.length > 0);
  assert.deepEqual(deriveTransitionSchemaResult(graph, selection), result);
  assert.equal(JSON.stringify(graph), before);
  for (const flag of ["--profile", "--basis", "--output", "--apply"]) {
    assert.throws(() => parseTransitionInterrogation(["schema", "--root", selection.rootIdentity, flag, "value"]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
  }
});

test("schema derivation can describe governed schema drift but refuses invalid or unknown semantics", () => {
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const graph = actualDescriptorGraph(), old = deriveTransitionSchemaResult(graph, selection);
  const explanation = graph.quads.find(q => q.subject === "urn:usf:cli-field-specification:descriptor-explanation:1" && q.predicate === "urn:usf:predicate:text")!;
  explanation.object = "Updated semantic explanation for the governed schema candidate.";
  const changed = deriveTransitionSchemaResult(graph, selection);
  assert.notEqual(changed.schemaDigest, old.schemaDigest);
  assert.notEqual(changed.sourceBasis, old.sourceBasis);
  assert.equal(changed.executionAuthority, "none");
  graph.quads.find(q => q.subject === explanation.subject && q.predicate === "urn:usf:predicate:maximumCardinality")!.object = "0";
  assert.throws(() => deriveTransitionSchemaResult(graph, selection), { code: "CLI_SPECIFICATION_INCOMPLETE" });
  const unknown = actualDescriptorGraph();
  unknown.quads.find(q => q.subject === "urn:usf:command:transition-schema:1" && q.predicate === "urn:usf:predicate:algorithm")!.object = "urn:test:unknown-generator";
  assert.throws(() => deriveTransitionSchemaResult(unknown, selection), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
});

test("schema handler loads declared sources, emits a reproducible candidate and creates no runtime ledger", () => {
  const root = mkdtempSync(join(tmpdir(), "usf-schema-cli-"));
  try {
    mkdirSync(join(root, "graph"));
    const names = ["cli-transition-definition", "v3-convention"];
    for (const name of names) writeFileSync(join(root, "graph", name + ".nq"), readFileSync(new URL("../../../graph/" + name + ".nq", import.meta.url)));
    writeFileSync(join(root, "graph", "test.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: names.map(name => ({
      path: "graph/" + name + ".nq", format: "application/n-quads", graph: "urn:usf:graph:" + name, role: "contract", validationProfile: "bootstrap-nquads-v1",
    })) }));
    const request = { command: "transition" as const, repositoryRoot: root, args: ["schema", "--root", "urn:usf:work:cli-transition-definition", "--manifest", "graph/test.json"] };
    const first = transitionCommandHandler(request, []);
    assert.equal(first.exitCode, 0);
    assert.deepEqual(transitionCommandHandler(request, []), first);
    assert.equal((first.output as { executionAuthority: string }).executionAuthority, "none");
    assert.deepEqual(readdirSync(root), ["graph"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("schema bounds use the same typed CLI refusal as interrogation", () => {
  const graph = actualDescriptorGraph();
  graph.quads = [...graph.quads, ...Array.from({ length: 100001 }, () => graph.quads[0]!)];
  assert.throws(() => deriveTransitionSchemaResult(graph, { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/test.json" }), { code: "CLI_SPECIFICATION_BOUNDS", exitCode: 2 });
});

test("interrogation and preparation share actual graph-bound observation admission", () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const admitted = inspectObservationTransition(graph, selection, "resolve prepare-local");
  const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, observationTransitionAdapters());
  assert.deepEqual(report.descriptors[0], admitted.descriptor);
  assert.equal(report.diagnostics.some(d => d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"), false);
  assert.equal(report.executionAuthority, "none");
  assert.equal(report.complete, false);
  assert.equal(report.parallelSafety.state, "unproven");
  assert.equal(report.terminalClosure.equal, false);
  assert(report.diagnostics.some(d => d.reasonCode === "TRANSITION_EVALUATORS_UNAUTHENTICATED"));
  assert.equal(admitted.validator.validate({ ...selection, operations: [{ kind: "write", path: "src/a.ts", content: "proposal" }] }).valid, true);
  assert.equal(admitted.validator.validate({ ...selection, basis: "invented", operations: [] }).valid, false);
});

test("changed operational semantics refuse identically in shared inspection and preparation admission", () => {
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  for (const [subject, predicate, replacement] of [
    ["urn:usf:cli-contract:local-preparation-effect:1", "guardRule", "urn:usf:rule:local-preparation-readback:1"],
    ["urn:usf:cli-contract:local-preparation-artifact:1", "producer", "urn:test:other"],
    ["urn:usf:cli-contract:local-preparation-artifact:1", "schema", "urn:test:unsupported-schema"],
    ["urn:usf:cli-contract:local-preparation-artifact:1", "work", "urn:test:other-work"],
    ["urn:usf:cli-contract:local-preparation-artifact:1", "profile", "urn:test:other-profile"],
    ["urn:usf:command:resolve-prepare-local:1", "commandPath", "invented prepare"],
    ["urn:usf:rule:local-preparation-guard:1", "text", "changed operational meaning"],
  ]) {
    const graph = actualDescriptorGraph();
    const row = graph.quads.find(q => q.subject === subject && q.predicate === "urn:usf:predicate:" + predicate)!;
    row.object = replacement!;
    let refusal: string | undefined;
    assert.throws(() => inspectObservationTransition(graph, selection, "resolve prepare-local"), (error: unknown) => {
      refusal = (error as { code: string }).code; return typeof refusal === "string";
    });
    const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, observationTransitionAdapters());
    assert(report.diagnostics.some(d => d.reasonCode === refusal && d.field === "adapter"));
    assert.equal(report.executionAuthority, "none");
  }
});

test("adapter declarations, collisions and wrong effect classes cannot authenticate mapping", () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const [adapter] = observationTransitionAdapters();
  for (const adapters of [[{ id: adapter!.id, effectClass: "observation" }], [adapter!, adapter!], [{ ...adapter!, effectClass: "integration" }]]) {
    const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, adapters);
    assert(report.diagnostics.some(d => d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"));
    assert.equal(report.executionAuthority, "none");
  }
});

test("compiled observation admission binds each rule role and output producer", () => {
  const transition = "urn:usf:cli-transition:local-contribution-prepare:1";
  const rule = (name: string) => `urn:usf:rule:local-preparation-${name}:1`;
  const descriptor = {
    input: { derivationRule: rule("input") },
    effect: { guardRule: rule("guard"), scopeRule: rule("scope"), readbackRule: rule("readback"), safetyRule: rule("serial-safety") },
    produces: [{ producer: transition, basisRule: rule("basis"), authenticationRule: rule("readback"), digestRule: rule("digest") }],
    recovery: { intentRule: rule("intent"), boundaryRule: rule("boundary"), unknownOutcomeRule: rule("replay"), reconciliationRule: rule("replay"), terminalProofRule: rule("terminal"), obligations: [rule("readback"), rule("replay")] },
  };
  assert.doesNotThrow(() => validateLocalObservationRoles(descriptor, transition));
  const swapped = structuredClone(descriptor);
  const effect = swapped.effect as Record<string, unknown>;
  [effect.guardRule, effect.readbackRule] = [effect.readbackRule, effect.guardRule];
  assert.throws(() => validateLocalObservationRoles(swapped, transition), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  const lineage = structuredClone(descriptor);
  (lineage.produces as Array<Record<string, unknown>>)[0]!.producer = "urn:test:other-transition";
  assert.throws(() => validateLocalObservationRoles(lineage, transition), { code: "TRANSITION_SEMANTICS_INCOMPLETE" });
  const missing = structuredClone(descriptor);
  delete (missing.recovery as Record<string, unknown>).unknownOutcomeRule;
  assert.throws(() => validateLocalObservationRoles(missing, transition), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  const extended = structuredClone(descriptor);
  (extended.effect as Record<string, unknown>).additionalGuardRule = rule("guard");
  assert.throws(() => validateLocalObservationRoles(extended, transition), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
});

test("observation adapter refuses unknown commands and transport overrides before graph access", async () => {
  const request = { command: "resolve" as const, repositoryRoot: "/unavailable", args: [] as string[] };
  await assert.rejects(observationCommandHandler(request, "invented execute"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  for (const args of [["{}"], ["--profile", "urn:test:profile"], ["--input", "-", "--apply"], []]) {
    await assert.rejects(observationCommandHandler({ ...request, args }, "resolve prepare-local"), { code: "RESOLVE_ARGUMENTS_INVALID" });
  }
  const help = findHelpTopic(["resolve", "prepare-local"]);
  assert.equal(help?.outputSchema, "urn:usf:local-contribution:1");
  assert.equal(help?.externalContact, "none");
});

test("interrogation parser and help share the same external input contract", () => {
  const topic = findHelpTopic(transitionInterrogationContract.path)!;
  assert.deepEqual(topic.options.map((input) => input.syntax), transitionInterrogationContract.inputs.map((input) => `${input.flag} ${input.valueName}`));
  assert.deepEqual(parseTransitionInterrogation(["inspect", "--root", "urn:usf:work:example"]), {
    rootIdentity: "urn:usf:work:example", manifestPath: "graph/manifest.json",
  });
  assert.deepEqual(parseTransitionInterrogation(["inspect", "--manifest", "graph/manifests/example.json", "--root", "USF-1192"]), {
    rootIdentity: "USF-1192", manifestPath: "graph/manifests/example.json",
  });
});

test("derived overrides and guessed effectful operations refuse before graph loading", () => {
  for (const flag of ["--profile", "--work", "--binding", "--basis", "--candidate", "--apply", "--check-mode"]) {
    assert.throws(() => parseTransitionInterrogation(["inspect", "--root", "urn:test:work", flag, "value"]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
  }
  assert.throws(() => parseTransitionInterrogation(["execute", "--root", "urn:test:work"]), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  assert.throws(() => parseTransitionInterrogation(["inspect"]), { code: "CLI_TRANSITION_INPUT_REQUIRED" });
  assert.throws(() => parseTransitionInterrogation(["inspect", "--root", "urn:test:work", "--root", "urn:test:other"]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
});

test("every declared selector bound is enforced without hidden coercion", () => {
  for (const field of transitionInterrogationContract.inputs) {
    assert.throws(() => parseTransitionInterrogation(["inspect", field.flag, "x".repeat(field.maximumLength + 1)]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
  }
  for (const value of ["", "--manifest", "urn:invalid identity", "USF-0"]) {
    assert.throws(() => parseTransitionInterrogation(["inspect", "--root", value]), { code: "CLI_TRANSITION_ARGUMENTS_INVALID" });
  }
});
