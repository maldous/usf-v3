import assert from "node:assert/strict";
import test from "node:test";
import { loadTransitionContextGraph, observationCommandHandler, parseTransitionInterrogation, validateLocalObservationRoles, inspectObservationTransition, observationTransitionAdapters, deriveTransitionSchemaResult, transitionCommandHandler } from "../../../src/commands/transition.ts";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import { canonicalQuadLine, parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { deriveCliTransitionContext, deriveCliTransitionCoverage } from "../../../src/graph/cli-transitions.ts";
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

test("binding prompt allowance does not widen unrelated graph literal bounds", () => {
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/test.json" };
  for (const length of [4097, 16385]) {
    const graph = actualDescriptorGraph();
    graph.quads.push({ ...graph.quads[0]!, subject: "urn:test:unrelated", predicate: "urn:usf:predicate:fixedPrompt", objectKind: "literal", object: "x".repeat(length) });
    assert.throws(() => deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, []), /TRANSITION_INPUT_BOUNDS_EXCEEDED/);
    if (length > 16384) assert.throws(() => deriveTransitionSchemaResult(graph, selection), { code: "CLI_SPECIFICATION_BOUNDS", exitCode: 2 });
  }
});

test("interrogation and preparation share actual graph-bound observation admission", () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const admitted = inspectObservationTransition(graph, selection, "resolve prepare-local");
  const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, observationTransitionAdapters());
  assert.deepEqual(report.descriptors.find(d => d.identity === admitted.descriptor.identity), admitted.descriptor);
  assert.equal(report.diagnostics.some(d => d.subject === admitted.descriptor.identity && d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"), false);
  for (const stage of ["proof", "publication"]) {
    const identity = `urn:usf:cli-transition:completion-${stage}:1`;
    assert(report.diagnostics.some(d => d.subject === identity && d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"), identity);
  }
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

test("completion lineage remains visible without admitting unmapped execution or terminal satisfaction", () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, observationTransitionAdapters());
  const assessment = report.terminalClosure.assessment;
  const stages = ["evidence", "proof", "publication"];
  for (const [index, stage] of stages.entries()) {
    const transition = `urn:usf:cli-transition:completion-${stage}:1`;
    const artifact = `urn:usf:cli-contract:completion-${stage}-artifact:1`;
    const recovery = `urn:usf:cli-contract:completion-${stage}-recovery:1`;
    for (const identity of [transition, artifact, recovery]) assert(assessment.nodes.some(n => n.identity === identity && n.state === "unverified"), identity);
    assert(assessment.edges.some(e => e.source === transition && e.predicate === "urn:usf:predicate:produces" && e.target === artifact));
    assert(assessment.edges.some(e => e.source === artifact && e.predicate === "urn:usf:predicate:producer" && e.target === transition));
    assert(assessment.edges.some(e => e.source === transition && e.predicate === "urn:usf:predicate:recoveryContract" && e.target === recovery));
    if (index > 0) assert(assessment.edges.some(e => e.source === transition && e.predicate === "urn:usf:predicate:consumes" && e.target === `urn:usf:cli-contract:completion-${stages[index - 1]}-artifact:1`));
    if (stage !== "evidence") assert(report.diagnostics.some(d => d.subject === transition && d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"));
    else assert(!report.diagnostics.some(d => d.subject === transition && d.field === "adapter"));
  }
  assert.equal(assessment.structuralComplete, false);
  assert.equal(assessment.satisfaction, "unverified");
  assert(assessment.reasonCodes.includes("TRANSITION_TERMINAL_ARTIFACT_DECLARATION_MISSING"));
  assert.equal(report.complete, false);
  assert.equal(report.executionAuthority, "none");
  assert.equal(report.parallelSafety.state, "unproven");
});

test("completion preparation exposes required consumed artifacts and typed canonical input without execution authority", () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const inspected = inspectObservationTransition(graph, selection, "evidence completion");
  const request = { ...selection, candidateDigest: "sha256:" + "0".repeat(64) };
  assert.equal(inspected.validator.validate(request).valid, true);
  for (const key of ["profile", "work", "basis", "graph", "receipts", "output", "executionAuthority", "fields"]) {
    assert.equal(inspected.validator.validate({ ...request, [key]: "invented" }).valid, false, key);
  }
  assert.equal(inspected.validator.validate(selection).valid, false);
  const consumed = inspected.descriptor.consumes as readonly { identity: string; producer: string }[];
  assert.deepEqual(consumed.map(value => value.identity), ["urn:usf:cli-contract:completion-check-receipts-artifact:1", "urn:usf:cli-contract:no-change-workspace-artifact:1"]);
  assert(consumed.every(value => graph.quads.some(q => q.subject === value.producer && q.predicate === "urn:usf:predicate:produces" && q.object === value.identity)));
  const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, observationTransitionAdapters());
  assert.equal(report.executionAuthority, "none");
  assert.equal(report.complete, false);
  assert.equal(report.parallelSafety.state, "unproven");
  const moved = structuredClone(graph);
  moved.quads.push({ ...moved.quads[0]!, subject: "urn:usf:rule:completion-evidence-reauthentication:1", predicate: "urn:usf:predicate:text", objectKind: "literal", object: "unimplemented replacement semantics" });
  assert.throws(() => inspectObservationTransition(moved, selection, "evidence completion"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  const override = structuredClone(graph);
  override.quads = override.quads.filter(q => !(q.subject === inspected.transitionIdentity && q.predicate === "urn:usf:predicate:publicationPolicy"));
  assert.throws(() => inspectObservationTransition(override, selection, "evidence completion"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  const multipleOwners = structuredClone(graph);
  multipleOwners.quads.push({ ...multipleOwners.quads[0]!, subject: consumed[0]!.producer, predicate: "urn:usf:predicate:owner", objectKind: "iri", object: "urn:test:other-owner" });
  assert.throws(() => inspectObservationTransition(multipleOwners, selection, "evidence completion"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  const competingProducer = structuredClone(graph);
  for (const [subject, predicate, object] of [
    [selection.rootIdentity, "transition", "urn:test:competing-producer"],
    ["urn:test:competing-producer", "produces", consumed[0]!.identity],
  ]) competingProducer.quads.push({ ...competingProducer.quads[0]!, subject, predicate: "urn:usf:predicate:" + predicate, objectKind: "iri", object });
  assert.throws(() => inspectObservationTransition(competingProducer, selection, "evidence completion"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
});

function bindingRows(targetManifest = "graph/target.json") {
  const id = "urn:test:binding", graph = "urn:test:bindings";
  const fields = [
    ["type", "urn:usf:type:LinearIssueWorkBinding", "iri"],
    ["issueWorkspace", "maldous", "literal"],
    ["issueUuid", "11111111-1111-4111-8111-111111111111", "literal"],
    ["owningModel", "USF", "literal"],
    ["selectedProfile", "urn:usf:profile:cli-transition-definition:1", "iri"],
    ["targetManifest", targetManifest, "literal"],
    ["workIri", "urn:usf:work:cli-transition-definition", "iri"],
    ["fixedPrompt", "Bounded retained context ".repeat(1000), "literal"],
    ["maximumPromptTokens", "10000", "literal"],
  ] as const;
  return fields.map(([field, object, objectKind]) => ({ subject: id, predicate: "urn:usf:predicate:" + field, object, objectKind, graph, canonical: "" }));
}

test("binding context uses the declared profile and never admits observation execution", () => {
  const graph = actualDescriptorGraph();
  graph.quads.push(...bindingRows());
  graph.quads.push(
    { subject: "urn:test:other-profile", predicate: "urn:usf:predicate:type", object: "urn:usf:type:RealisationProfile", objectKind: "iri", graph: "urn:test:g", canonical: "" },
    { subject: "urn:test:other-profile", predicate: "urn:usf:predicate:selectsContract", object: "urn:usf:contract:cli-transition-definition:1", objectKind: "iri", graph: "urn:test:g", canonical: "" },
  );
  const context = deriveCliTransitionContext(graph, "urn:test:binding");
  assert.equal(context.work, "urn:usf:work:cli-transition-definition");
  assert.equal(context.profile, "urn:usf:profile:cli-transition-definition:1");
  assert.deepEqual(context.diagnostics, []);
  assert.equal(context.binding?.targetManifest, "graph/target.json");
  assert.equal(context.executionAuthority, "none");
  assert.equal(deriveCliTransitionContext(graph, context.work!).profile, null);
  assert.throws(() => inspectObservationTransition(graph, { rootIdentity: "urn:test:binding", manifestPath: "graph/bindings.json" }, "resolve prepare-local"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  for (const [field, object, objectKind] of [
    ["type", "urn:usf:type:WorkPacket", "iri"],
    ["selectedProfile", "urn:test:other-profile", "iri"],
    ["workIri", "urn:test:other-work", "literal"],
  ] as const) {
    const bad = structuredClone(graph);
    bad.quads.push({ subject: "urn:test:binding", predicate: "urn:usf:predicate:" + field, object, objectKind, graph: "urn:test:g", canonical: "" });
    const refused = deriveCliTransitionContext(bad, "urn:test:binding");
    assert(refused.diagnostics.length > 0);
    assert.equal(refused.executionAuthority, "none");
  }
  const absent = structuredClone(graph);
  absent.quads = absent.quads.filter(q => q.subject !== context.work);
  assert(deriveCliTransitionContext(absent, "urn:test:binding").diagnostics.some(d => d.reasonCode === "TRANSITION_BOUND_WORK_MISSING"));
  const wrongProfile = structuredClone(graph);
  wrongProfile.quads.find(q => q.subject === "urn:test:binding" && q.predicate === "urn:usf:predicate:selectedProfile")!.object = "urn:test:absent-profile";
  assert(deriveCliTransitionContext(wrongProfile, "urn:test:binding").diagnostics.some(d => d.reasonCode === "TRANSITION_BINDING_PROFILE_MISMATCH"));
});

test("CLI binding reads follow only the selected target manifest without runtime effects", () => {
  const root = mkdtempSync(join(tmpdir(), "usf-binding-context-"));
  try {
    mkdirSync(join(root, "graph"));
    const source = actualDescriptorGraph();
    const names = ["urn:usf:graph:cli-transition-definition", "urn:usf:graph:v3-convention"];
    const sources = names.map((graph, i) => {
      const path = `graph/source-${i}.nq`;
      writeFileSync(join(root, path), source.quads.filter(q => q.graph === graph).map(canonicalQuadLine).join("\n") + "\n");
      return { path, graph, format: "application/n-quads", role: "contract", validationProfile: "bootstrap-nquads-v1" };
    });
    writeFileSync(join(root, "graph/target.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources }));
    writeFileSync(join(root, "graph/bindings.nq"), bindingRows().map(canonicalQuadLine).join("\n") + "\n");
    writeFileSync(join(root, "graph/bindings.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{ path: "graph/bindings.nq", graph: "urn:test:bindings", format: "application/n-quads", role: "contract", validationProfile: "bootstrap-nquads-v1" }] }));
    const selection = { rootIdentity: "urn:test:binding", manifestPath: "graph/bindings.json" };
    const closure = loadTransitionContextGraph(root, selection);
    assert.equal(closure.quads.filter(q => q.subject === selection.rootIdentity).length, bindingRows().length);
    const request = { command: "transition" as const, repositoryRoot: root, args: ["inspect", "--root", selection.rootIdentity, "--manifest", selection.manifestPath] };
    const result = transitionCommandHandler(request, []);
    const output = result.output as { rootIdentity: string; manifestPath: string; work: string; complete: boolean; executionAuthority: string; parallelSafety: { state: string } };
    assert.equal(output.rootIdentity, selection.rootIdentity);
    assert.equal(output.manifestPath, selection.manifestPath);
    assert.equal(output.work, "urn:usf:work:cli-transition-definition");
    assert.equal(output.complete, false);
    assert.equal(output.executionAuthority, "none");
    assert.equal(output.parallelSafety.state, "unproven");
    assert.deepEqual(transitionCommandHandler(request, []), result);
    assert.equal(transitionCommandHandler({ ...request, args: ["schema", ...request.args.slice(1)] }, []).exitCode, 0);
    assert.deepEqual(readdirSync(root), ["graph"]);
    for (const target of ["../outside.json", "/outside.json", "graph/missing.json"]) {
      writeFileSync(join(root, "graph/bindings.nq"), bindingRows(target).map(canonicalQuadLine).join("\n") + "\n");
      assert.throws(() => loadTransitionContextGraph(root, selection), target);
    }
    assert.deepEqual(readdirSync(root), ["graph"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
