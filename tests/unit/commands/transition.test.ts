import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommandHandler } from "../../../src/commands/resolve.ts";
import { inspectTransition, transitionAdaptersForCoverage, loadTransitionContextGraph, observationCommandHandler, parseTransitionInterrogation, validateLocalObservationRoles, inspectObservationTransition, observationTransitionAdapters, deriveTransitionSchemaResult, transitionCommandHandler } from "../../../src/commands/transition.ts";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, symlinkSync, lstatSync, readlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SemanticGraph } from "../../../src/graph/index.ts";
import { canonicalQuadLine, parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { deriveCliTransitionContext, deriveCliTransitionCoverage } from "../../../src/graph/cli-transitions.ts";
import { findHelpTopic, transitionInterrogationContract, transitionSchemaContract } from "../../../src/commands/help.ts";
import { canonicalDigest } from "../../../src/core/canonical.ts";
import { executeTransitionCommand } from "../../../src/commands/transition.ts";
import { prepareCanonicalCompletionProof, runCanonicalCompletionPublication } from "../../../src/commands/work-completion.ts";

test("binding proof and publication dispatch derive native work and target without authorising missing evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "usf-binding-proof-dispatch-"));
  try {
    mkdirSync(join(root, "graph"));
    mkdirSync(join(root, "schemas"));
    mkdirSync(join(root, ".usf"), { mode: 0o700 });
    mkdirSync(join(root, ".usf/inputs"), { mode: 0o700 });
    const source = actualDescriptorGraph();
    const sources = [...new Set(source.quads.map(q => q.graph))].map((graph, i) => {
      const path = `graph/source-${i}.nq`;
      writeFileSync(join(root, path), source.quads.filter(q => q.graph === graph).map(canonicalQuadLine).join("\n") + "\n");
      return { path, graph, format: "application/n-quads", role: "contract", validationProfile: "bootstrap-nquads-v1" };
    });
    writeFileSync(join(root, "graph/target.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources }));
    const originalBinding = bindingRows().map(canonicalQuadLine).join("\n") + "\n";
    writeFileSync(join(root, "graph/bindings.nq"), originalBinding);
    writeFileSync(join(root, "graph/bindings.json"), JSON.stringify({ schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{
      path: "graph/bindings.nq", graph: "urn:test:bindings", format: "application/n-quads", role: "contract", validationProfile: "bootstrap-nquads-v1",
    }] }));
    for (const name of ["cli-transition-descriptor", "completion-proof-bundle", "work-completion-publication-result"]) {
      writeFileSync(join(root, "schemas", name + ".schema.json"), readFileSync(new URL("../../../schemas/" + name + ".schema.json", import.meta.url)));
    }
    const selection = { rootIdentity: "urn:test:binding", manifestPath: "graph/bindings.json" };
    const nativeSelection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/target.json" };
    const refusal = async (operation: () => Promise<unknown>) => {
      try { await operation(); }
      catch (error) {
        assert(error instanceof Error);
        assert("code" in error && typeof error.code === "string");
        return { code: error.code, message: error.message };
      }
      assert.fail("The fixture has no authenticated completion evidence.");
    };
    for (const [command, mode] of [["prove completion", undefined], ["publish work-completion", "verify"]] as const) {
      const input = mode === undefined ? selection : { ...selection, mode };
      const inspected = inspectTransition(loadTransitionContextGraph(root, selection), selection, command);
      assert.equal(inspected.context.work, nativeSelection.rootIdentity);
      assert.equal(inspected.context.binding?.targetManifest, nativeSelection.manifestPath);
      assert.equal(inspected.validator.validate(input).valid, true);
      const baseline = await refusal(() => mode === undefined
        ? prepareCanonicalCompletionProof(root, nativeSelection)
        : runCanonicalCompletionPublication(root, { ...nativeSelection, mode }));
      assert.notEqual(baseline.code, "WORK_COMPLETION_ARGUMENTS_INVALID", "native work selection must succeed before the genuine evidence refusal");
      writeFileSync(join(root, ".usf/inputs/input.json"), JSON.stringify(input), { mode: 0o600 });
      const dispatch = () => executeTransitionCommand({ command: mode === undefined ? "prove" : "publish",
        repositoryRoot: root, args: ["--input", ".usf/inputs/input.json"] }, command);
      assert.deepEqual(await refusal(dispatch), baseline, "dispatch must reach the same native guard as the derived work/target");
      for (const key of ["work", "profile", "targetManifest", "candidateDigest", "basis"]) {
        writeFileSync(join(root, ".usf/inputs/input.json"), JSON.stringify({ ...input, [key]: "caller override" }), { mode: 0o600 });
        assert.equal((await refusal(dispatch)).code, "CLI_TRANSITION_INPUT_INVALID", key);
      }
      writeFileSync(join(root, ".usf/inputs/input.json"), JSON.stringify(input), { mode: 0o600 });
      writeFileSync(join(root, "graph/bindings.nq"), bindingRows("graph/missing.json").map(canonicalQuadLine).join("\n") + "\n");
      await assert.rejects(dispatch, /MANIFEST_UNREADABLE/u, "changed binding target must not reuse the prior derived selection");
      writeFileSync(join(root, "graph/bindings.nq"), originalBinding);
    }
    assert.deepEqual(readdirSync(root).sort(), [".usf", "graph", "schemas"]);
    assert.deepEqual(readdirSync(join(root, ".usf")), ["inputs"]);
    assert.deepEqual(readdirSync(join(root, ".usf/inputs")), ["input.json"]);
    assert.equal(readFileSync(join(root, "graph/bindings.nq"), "utf8"), originalBinding);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function actualDescriptorGraph(): SemanticGraph {
  const quads = ["cli-transition-definition","cli-transition-record-specifications","cli-transition-field-specifications","cli-transition-completion-field-specifications"].flatMap(name => parseStrictNQuads(readFileSync(new URL("../../../graph/" + name + ".nq", import.meta.url), "utf8"), "urn:usf:graph:" + name));
  quads.push(...parseStrictNQuads(readFileSync(new URL("../../../graph/check-execution-intent.nq", import.meta.url), "utf8"), "urn:usf:graph:check-execution-intent"));
  quads.push(...parseStrictNQuads(readFileSync(new URL("../../../graph/v3-convention.nq", import.meta.url), "utf8"), "urn:usf:graph:v3-convention"));
  const selected = new Set(["urn:usf:schema:no-change-realisation-result:1", "urn:usf:schema:completion-evidence-candidate:1", "urn:usf:command:realise-no-change:1", "urn:usf:schema:completion-proof-bundle:1", "urn:usf:schema:work-completion-publication-result:1", "urn:usf:schema:work-completion-publication-receipt:1", "urn:usf:command:prove-completion:1", "urn:usf:command:publish-work-completion:1"]);
  quads.push(...parseStrictNQuads(readFileSync(new URL("../../../graph/profile-authority.nq", import.meta.url), "utf8"), "urn:usf:graph:profile-authority").filter(q => selected.has(q.subject)));
  return { quads, manifest: { schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [] }, semanticDigest: "untrusted", graphDigests: {}, sourceDigests: {}, repositoryRoot: fileURLToPath(new URL("../../../", import.meta.url)) };
}

test("proof and publication map exact root-derived contracts without satisfying prerequisites by declaration", () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  for (const [command, stage, prerequisite] of [["prove completion", "proof", "evidence"], ["publish work-completion", "publication", "proof"]] as const) {
    const inspected = inspectTransition(graph, selection, command);
    const identity = `urn:usf:cli-transition:completion-${stage}:1`;
    assert.equal(inspected.transitionIdentity, identity);
    assert.deepEqual(inspected.descriptor.prerequisites, [`urn:usf:cli-transition:completion-${prerequisite}:1`]);
    const consumed = inspected.descriptor.consumes as readonly { identity: string; producer: string }[];
    assert.deepEqual(consumed.map(a => a.identity), [`urn:usf:cli-contract:completion-${prerequisite}-artifact:1`]);
    assert.equal(consumed[0]!.producer, `urn:usf:cli-transition:completion-${prerequisite}:1`);
    const inputs = stage === "proof" ? [selection] : ["verify", "apply"].map(mode => ({ ...selection, mode }));
    for (const input of inputs) {
      assert.equal(inspected.validator.validate(input).valid, true);
      for (const key of ["candidateDigest", "bundle", "evidence", "obligation", "profile", "work", "basis", "snapshot", "output", "fields", "executionAuthority"]) {
        assert.equal(inspected.validator.validate({ ...input, [key]: "caller override" }).valid, false, `${command}: ${key}`);
      }
      for (const key of ["rootIdentity", "manifestPath"]) {
        const missing: Record<string, unknown> = { ...input }; delete missing[key];
        assert.equal(inspected.validator.validate(missing).valid, false);
        assert.equal(inspected.validator.validate({ ...input, [key]: "" }).valid, false);
      }
    }
    if (stage === "publication") {
      assert.equal(inspected.validator.validate(selection).valid, false);
      assert.equal(inspected.validator.validate({ ...selection, mode: "repair" }).valid, false);
      assert.throws(() => inspectObservationTransition(graph, selection, command), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
    }
    const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, transitionAdaptersForCoverage());
    assert.equal(report.diagnostics.some(d => d.subject === identity && d.field === "adapter"), false);
    assert.equal(report.executionAuthority, "none"); assert.equal(report.complete, false);
    assert.equal(report.parallelSafety.state, "unproven"); assert.equal(report.terminalClosure.assessment.satisfaction, "unverified");
    const help = findHelpTopic(command.split(" "));
    assert.ok(help); assert(help.synopsis.some(line => line.includes("--input")), command);
  }
});

test("proof publication mappings refuse changed prerequisites rule roles schema and ownership before effects", () => {
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  for (const [command, stage, prerequisite] of [["prove completion", "proof", "evidence"], ["publish work-completion", "publication", "proof"]] as const) {
    const identity = `urn:usf:cli-transition:completion-${stage}:1`;
    const mutations: ((graph: SemanticGraph) => void)[] = [
      g => { g.quads = g.quads.filter(q => !(q.subject === identity && q.predicate === "urn:usf:predicate:requiresTransition")); },
      g => { g.quads = g.quads.filter(q => !(q.subject === `urn:usf:cli-transition:completion-${prerequisite}:1` && q.predicate === "urn:usf:predicate:produces")); },
      g => { g.quads = g.quads.filter(q => !(q.subject === identity && q.predicate === "urn:usf:predicate:publicationPolicy")); },
      g => { const row = g.quads.find(q => q.subject === identity && q.predicate === "urn:usf:predicate:resultSchema")!; row.object = "urn:usf:schema:completion-evidence-candidate:1"; },
      g => { const row = g.quads.find(q => q.subject === `urn:usf:rule:completion-${stage}-input:1` && q.predicate === "urn:usf:predicate:text")!; row.object += " Changed operational meaning."; },
      g => { const row = g.quads.find(q => q.subject === `urn:usf:cli-contract:completion-${prerequisite}-artifact:1` && q.predicate === "urn:usf:predicate:work")!; row.object = "urn:test:foreign-work"; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const graph = actualDescriptorGraph(); mutate(graph);
      assert.throws(() => inspectTransition(graph, selection, command), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
      const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, transitionAdaptersForCoverage());
      assert(report.diagnostics.some(d => d.subject === identity && d.field === "adapter" && d.reasonCode === "CLI_TRANSITION_UNIMPLEMENTED"), JSON.stringify({ command, mutation: index, diagnostics: report.diagnostics.filter(d => d.subject === identity || d.subject.includes("completion-")) }));
      assert.equal(report.executionAuthority, "none"); assert.equal(report.parallelSafety.state, "unproven");
    }
  }
});

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
    const names = ["cli-transition-definition","cli-transition-record-specifications","cli-transition-field-specifications","cli-transition-completion-field-specifications","v3-convention"];
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
    await assert.rejects(async () => resolveCommandHandler({ ...request, args: ["prepare-local", ...args] }), { code: "RESOLVE_ARGUMENTS_INVALID" });
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

test("completion lineage remains visible without granting execution or terminal satisfaction", () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, transitionAdaptersForCoverage());
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
    assert(!report.diagnostics.some(d => d.subject === transition && d.field === "adapter"), transition);
  }
  assert.equal(assessment.satisfaction, "unverified");
  assert(assessment.terminalArtifacts.includes("urn:usf:cli-contract:completion-publication-artifact:1"));
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
  assert.deepEqual((consumed as readonly { schema?: string }[]).map(value => value.schema), ["urn:usf:schema:completion-check-receipt-set-result:1", "urn:usf:schema:no-change-workspace-manifest:1"]);
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
    const names = ["urn:usf:graph:cli-transition-definition","urn:usf:graph:cli-transition-record-specifications","urn:usf:graph:cli-transition-field-specifications","urn:usf:graph:cli-transition-completion-field-specifications","urn:usf:graph:v3-convention"];
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

test("no-change producer describes derived identity and retained-state recovery without execution admission", async () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const id = "urn:usf:cli-transition:no-change-workspace:1";
  const inspect = (value: SemanticGraph) => deriveCliTransitionCoverage(value, selection, { complete: false, leaves: [] }, observationTransitionAdapters());
  const report = inspect(graph);
  const descriptor = report.descriptors.find(value => value.identity === id)!;
  assert(descriptor);
  const effect = descriptor.effect as Record<string, unknown>;
  const input = descriptor.input as Record<string, unknown>;
  const recovery = descriptor.recovery as Record<string, unknown>;
  const cases = recovery.cases as readonly Record<string, unknown>[];
  assert.equal(effect.effectClass, "candidate-workspace");
  assert.equal(effect.contact, "none");
  assert.equal(input.schema, "urn:usf:schema:no-change-request:1");
  assert.deepEqual(cases.map(value => value.whenState).sort(), ["absent", "busy", "complete-current", "conflicting", "partial", "stale", "unknown"]);
  for (const value of cases) {
    const creates = value.whenState === "absent";
    const reuses = value.whenState === "complete-current";
    assert.equal(value.action, creates ? "create" : reuses ? "reuse" : "refuse");
    assert.equal(value.mayMutateWorkspace, creates);
    assert.deepEqual(value.nextTransitions, creates || reuses ? ["urn:usf:cli-transition:completion-check-receipts:1"] : []);
    assert.deepEqual(value.refusalCodes, [], "do not manufacture an exhaustive native refusal classification");
    assert.equal("fields" in value, false);
  }
  assert.match(String(cases.find(value => value.whenState === "partial")!.condition), /retained before this invocation/);
  assert.equal(report.complete, false);
  assert.equal(report.executionAuthority, "none");
  assert.equal(report.parallelSafety.state, "unproven");
  assert.equal(report.terminalClosure.assessment.satisfaction, "unverified");
  assert(report.diagnostics.some(value => value.subject === id && value.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"));
  await assert.rejects(() => observationCommandHandler({ command: "realise", args: ["--input", "-"], repositoryRoot: "/unused" }, "realise no-change"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });

  const changed = structuredClone(graph);
  changed.quads = changed.quads.map(q => q.subject === "urn:usf:cli-recovery-case:no-change-partial:1" && q.predicate === "urn:usf:predicate:recoveryCaseAction" ? { ...q, object: "create" } : q);
  const altered = inspect(changed);
  assert.notEqual(altered.digest, report.digest);
  assert.equal(altered.executionAuthority, "none");
  assert.equal(altered.complete, false);
  assert(altered.diagnostics.some(value => value.subject === id && value.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"), "a changed graph declaration is not compiled recovery support");

  const missing = structuredClone(graph);
  missing.quads = missing.quads.filter(q => !(q.subject === "urn:usf:cli-recovery-case:no-change-partial:1" && q.predicate === "urn:usf:predicate:recoveryCaseMayMutate"));
  const incomplete = inspect(missing);
  assert(incomplete.diagnostics.some(value => value.reasonCode === "CLI_RECORD_CARDINALITY" && value.subject === "urn:usf:cli-recovery-case:no-change-partial:1"));
});

test("generated no-change request and recovery cases reject opaque or caller-derived overrides", async () => {
  const { createJsonSchemaValidator } = await import("../../../src/schema/index.ts");
  const canonical = deriveTransitionSchemaResult(actualDescriptorGraph(), { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" }).descriptorSchema!;
  const validator = (fragment: string) => createJsonSchemaValidator({ $schema: canonical.$schema, $id: "urn:test:no-change-contract:" + fragment, $ref: String(canonical.$id) + "#/$defs/" + fragment }, { dependencySchemas: [canonical] });
  const input = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  assert.equal(validator("noChangeRequest").validate(input).valid, true);
  for (const key of ["candidateDigest", "profile", "work", "basis", "policy", "workspacePath", "output", "fields", "executionAuthority"]) {
    assert.equal(validator("noChangeRequest").validate({ ...input, [key]: "invented" }).valid, false, key);
  }
  const branch = { whenState: "partial", action: "refuse", mayMutateWorkspace: false, condition: "Retained before invocation", nextTransitions: [], refusalCodes: [], explanation: "No partial repair" };
  assert.equal(validator("recoveryCase").validate(branch).valid, true);
  for (const extra of [{ fields: {} }, { action: "repair" }, { whenState: "completed" }, { mayMutateWorkspace: "false" }, { nextTransitions: "execute" }]) {
    assert.equal(validator("recoveryCase").validate({ ...branch, ...extra }).valid, false);
  }
});

test("generic no-change admission separates result and artifact while observation callers refuse", async () => {
  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const admitted = inspectTransition(graph, selection, "realise no-change");
  assert.equal(admitted.descriptor.resultSchema, "urn:usf:schema:no-change-realisation-result:1");
  assert.equal((admitted.descriptor.produces as Record<string, unknown>[])[0]!.schema, "urn:usf:schema:no-change-workspace-manifest:1");
  assert.equal(admitted.validator.validate(selection).valid, true);
  assert.equal(admitted.resultValidator.validate({ schema: "urn:usf:no-change-workspace-manifest:1" }).valid, false);
  for (const key of ["candidateDigest", "profile", "work", "basis", "policy", "workspacePath", "output", "executionAuthority"]) {
    assert.equal(admitted.validator.validate({ ...selection, [key]: "invented" }).valid, false, key);
  }
  assert.throws(() => inspectObservationTransition(graph, selection, "realise no-change"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  await assert.rejects(() => observationCommandHandler({ command: "realise", repositoryRoot: "/unavailable", args: ["--input", "-"] }, "realise no-change"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
  const adapter = transitionAdaptersForCoverage().find(a => a.id === admitted.implementation.id)!;
  assert.equal(adapter.effectClass, "candidate-workspace");
  assert.equal(observationTransitionAdapters().some(a => a.id === adapter.id), false);
  const report = deriveCliTransitionCoverage(graph, selection, { complete: false, leaves: [] }, transitionAdaptersForCoverage());
  assert.equal(report.diagnostics.some(d => d.subject === admitted.transitionIdentity && d.reasonCode === "TRANSITION_ADAPTER_UNMAPPED"), false);
  assert.equal(report.executionAuthority, "none");
  assert.equal(report.parallelSafety.state, "unproven");
  assert.equal(report.complete, false);
});

test("result schema admission refuses unsafe files and malformed schemas without workspace effects", () => {
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  const parent = mkdtempSync(join(tmpdir(), "usf-result-schema-boundaries-"));
  const root = join(parent, "repository");
  const original = readFileSync(new URL("../../../schemas/no-change-realisation-result.schema.json", import.meta.url));
  try {
    mkdirSync(join(root, "schemas"), { recursive: true });
    const path = join(root, "schemas/no-change-realisation-result.schema.json");
    const graph = { ...actualDescriptorGraph(), repositoryRoot: root };
    const inspect = () => inspectTransition(graph, selection, "realise no-change");
    writeFileSync(path, original);
    assert.doesNotThrow(inspect, "valid file must reach admission in the same fixture");
    rmSync(path);
    const outside = join(parent, "outside-schema.json");
    writeFileSync(outside, original);
    symlinkSync(outside, path);
    assert.throws(inspect, { code: "CLI_TRANSITION_UNIMPLEMENTED" });
    assert.equal(lstatSync(path).isSymbolicLink(), true);
    assert.equal(readlinkSync(path), outside);
    assert.deepEqual(readFileSync(outside), original);
    rmSync(path);
    const schema = JSON.parse(original.toString("utf8"));
    const cases: readonly [string, Buffer][] = [
      ["oversized otherwise valid JSON", Buffer.concat([original, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20)])],
      ["malformed JSON", Buffer.from("{not-json")],
      ["invalid UTF-8", Buffer.concat([original, Buffer.from([0xff])])],
      ["unsupported keyword", Buffer.from(JSON.stringify({ ...schema, patternProperties: { ".*": {} } }))],
      ["unresolved external reference", Buffer.from(JSON.stringify({ ...schema, $ref: "urn:test:unavailable-schema" }))],
    ];
    for (const [label, bytes] of cases) {
      writeFileSync(path, bytes);
      assert.throws(inspect, { code: "CLI_TRANSITION_UNIMPLEMENTED" }, label);
      assert.deepEqual(readFileSync(path), bytes, label + " must remain untouched");
      assert.deepEqual(readdirSync(root), ["schemas"], label + " must not create operational state");
    }
    writeFileSync(path, original);
    assert.doesNotThrow(inspect);
    assert.deepEqual(readdirSync(root), ["schemas"]);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("selective check input is root-only and admits the exact shared native-intent closure", async () => {
  const { createJsonSchemaValidator } = await import("../../../src/schema/index.ts");
  const canonical = deriveTransitionSchemaResult(actualDescriptorGraph(), { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" }).descriptorSchema!;
  const validator = createJsonSchemaValidator({ $schema: canonical.$schema, $id: "urn:test:selective-check-input:1", $ref: String(canonical.$id) + "#/$defs/noChangeRequest" }, { dependencySchemas: [canonical] });
  const input = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  assert.equal(validator.validate(input).valid, true);
  for (const key of ["candidateDigest", "validationObligations", "receipts", "profile", "basis", "output", "force", "executionAuthority"]) {
    assert.equal(validator.validate({ ...input, [key]: "caller-override" }).valid, false, key);
  }

  const graph = actualDescriptorGraph();
  const selection = { rootIdentity: input.rootIdentity, manifestPath: input.manifestPath };
  const admitted = inspectTransition(graph, selection, "check");
  assert.equal(admitted.implementation.effectClass, "check-receipt-persistence");
  assert.equal(admitted.validator.validate(input).valid, true);
  assert.deepEqual(admitted.readResultSchema(), {
    $schema: canonical.$schema,
    $id: "urn:usf:schema:completion-check-receipt-set-result:1",
    $ref: String(canonical.$id) + "#/$defs/completionCheckReceiptSet",
  });

  const admissionRemoved = structuredClone(graph);
  admissionRemoved.quads = admissionRemoved.quads.filter(q => !(q.subject === "urn:usf:contract:cli-transition-definition:1"
    && q.predicate === "urn:usf:predicate:admitsEffectAdapter" && q.object === "urn:usf:cli-adapter:completion-check-receipts:1"));
  assert.throws(() => inspectTransition(admissionRemoved, selection, "check"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });

  const movedIntent = structuredClone(graph);
  const intent = movedIntent.quads.find(q => q.subject === "urn:usf:rule:completion-check-receipts-execution-intent:1" && q.predicate === "urn:usf:predicate:text")!;
  intent.object += " changed";
  assert.throws(() => inspectTransition(movedIntent, selection, "check"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });

});

test("completion receipt-set result uses the canonical generated fragment and carries no authority claim", async () => {
  const { createJsonSchemaValidator } = await import("../../../src/schema/index.ts");
  const canonical = deriveTransitionSchemaResult(actualDescriptorGraph(), { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" }).descriptorSchema!;
  const schema = "urn:usf:schema:completion-check-receipt-set-result:1";
  const validator = createJsonSchemaValidator({ $schema: canonical.$schema, $id: schema, $ref: String(canonical.$id) + "#/$defs/completionCheckReceiptSet" }, { dependencySchemas: [canonical] });
  const members = ["urn:test:validation:a", "urn:test:validation:b"].map((obligationIri, index) => ({
    obligationIri, receiptPath: `.usf/receipts/check/sha256:${"a".repeat(64)}/${index}.json`,
    receiptDigest: "sha256:" + (index ? "b" : "a").repeat(64), validationResultSetDigest: "sha256:" + (index ? "d" : "c").repeat(64),
  }));
  const result = {
    schema, status: "current", workIri: "urn:usf:work:cli-transition-definition", profileIri: "urn:usf:profile:cli-transition-definition:1",
    candidateDigest: "sha256:" + "a".repeat(64), constructionBasisDigest: "sha256:" + "b".repeat(64),
    validationObligations: members.map(member => member.obligationIri), receipts: members,
    receiptSetDigest: "sha256:" + "e".repeat(64), nonClaims: ["completion", "parallel-safety", "partial-set-recovery", "terminal-closure"],
  };
  assert.equal(validator.validate(result).valid, true, "the denominator is a dynamic collection, not a fixed receipt total");
  assert.equal(validator.validate({ ...result, parallelSafety: { state: "proved" } }).valid, false);
  assert.equal(validator.validate({ ...result, receipts: [members[0]] }).valid, true, "cardinality is structurally bounded; exact denominator equality remains native current authentication");
});

test("no-change compatibility refuses changed effect recovery and result bindings without invoking producer", () => {
  const selection = { rootIdentity: "urn:usf:work:cli-transition-definition", manifestPath: "graph/manifests/cli-transition-definition.json" };
  for (const [subject, predicate, object] of [
    ["urn:usf:cli-contract:no-change-workspace-effect:1", "effectClass", "observation"],
    ["urn:usf:cli-recovery-case:no-change-partial:1", "recoveryCaseAction", "create"],
    ["urn:usf:cli-transition:no-change-workspace:1", "resultSchema", "urn:test:other-result"],
    ["urn:usf:schema:no-change-realisation-result:1", "repositoryPath", "schemas/completion-evidence-candidate.schema.json"],
    ["urn:usf:schema:no-change-realisation-result:1", "version", "2"],
    ["urn:usf:schema:no-change-realisation-result:1", "type", "urn:test:OtherSchema"],
  ]) {
    const graph = actualDescriptorGraph();
    const rows = graph.quads.filter(q => q.subject === subject && q.predicate === "urn:usf:predicate:" + predicate);
    assert(rows.length > 0, subject + "/" + predicate);
    for (const row of rows) row.object = object!;
    assert.throws(() => inspectTransition(graph, selection, "realise no-change"), { code: "CLI_TRANSITION_UNIMPLEMENTED" }, subject + "/" + predicate);
  }
  const root = mkdtempSync(join(tmpdir(), "usf-no-change-result-schema-"));
  try {
    mkdirSync(join(root, "schemas"));
    const path = join(root, "schemas/no-change-realisation-result.schema.json");
    const original = JSON.parse(readFileSync(new URL("../../../schemas/no-change-realisation-result.schema.json", import.meta.url), "utf8"));
    writeFileSync(path, JSON.stringify({ ...original, $id: "urn:test:wrong-result" }));
    const graph = { ...actualDescriptorGraph(), repositoryRoot: root };
    assert.throws(() => inspectTransition(graph, selection, "realise no-change"), { code: "CLI_TRANSITION_UNIMPLEMENTED" });
    assert.deepEqual(readdirSync(root), ["schemas"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
