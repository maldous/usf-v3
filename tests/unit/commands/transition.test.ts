import assert from "node:assert/strict";
import test from "node:test";
import { observationCommandHandler, parseTransitionInterrogation, validateLocalObservationRoles, inspectObservationTransition, observationTransitionAdapters } from "../../../src/commands/transition.ts";
import { readFileSync } from "node:fs";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import { parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { deriveCliTransitionCoverage } from "../../../src/graph/cli-transitions.ts";
import { findHelpTopic, transitionInterrogationContract } from "../../../src/commands/help.ts";

function actualDescriptorGraph(): SemanticGraph {
  const quads = parseStrictNQuads(readFileSync(new URL("../../../graph/cli-transition-definition.nq", import.meta.url), "utf8"), "urn:usf:graph:cli-transition-definition");
  quads.push(...parseStrictNQuads(readFileSync(new URL("../../../graph/v3-convention.nq", import.meta.url), "utf8"), "urn:usf:graph:v3-convention"));
  return { quads, manifest: { schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [] }, semanticDigest: "untrusted", graphDigests: {}, sourceDigests: {}, repositoryRoot: "/unused" };
}

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
