import { loadSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import { readFileSync } from "node:fs";
import { createJsonSchemaValidator } from "../schema/index.ts";
import { deriveCliTransitionContext, deriveCliRecordSpecifications, deriveCliSchemas, deriveCliRecord, deriveCliTransitionCoverage, verifyCliDescriptorSchema, type CliTransitionAdapter } from "../graph/cli-transitions.ts";
import { canonicalQuadDigest, canonicalQuadLine } from "../graph/nquads.ts";
import { deriveLinearBindingDeclaration, LinearBindingError } from "../graph/linear-binding.ts";
import { prepareLocalContribution, parseLocalContribution, LocalContributionError } from "../collaboration/local-contribution.ts";
import { parseCommandInput, readCommandInput } from "./command-input.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { commandRegistry, transitionInterrogationContract, transitionReadContracts, transitionSchemaContract } from "./help.ts";
import type { CommandRequest, CommandResult } from "./dispatcher.ts";

type ObservationObject = Readonly<Record<string, unknown>>;
function observationObject(value: unknown): ObservationObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Expected a closed semantic observation record.");
  }
  return value as ObservationObject;
}

// Compatibility fingerprints bind compiled interpretation, never execution permission.
const localObservationRules: Readonly<Record<string, string>> = Object.freeze({
  "urn:usf:rule:local-preparation-basis:1": "sha256:539008095c2d34f9bc63a8df28a6669d708c8cfbf5a758794e5c420b3f8bb3bd",
  "urn:usf:rule:local-preparation-boundary:1": "sha256:35a5b4b87f7b6f08a003ba31801d57d4463b1d3ec0a3522a88f2b0632c621cf1",
  "urn:usf:rule:local-preparation-digest:1": "sha256:a5a426dd786a0cf72ee3c620337b0a87e408f6e821df01d328b407dc7fc2c255",
  "urn:usf:rule:local-preparation-guard:1": "sha256:c2bd988a260fb7e684c4b92d74fc3c8aa3fde7ca5d46bd76fd7a7aa58881330a",
  "urn:usf:rule:local-preparation-input:1": "sha256:3870e48678830f7a3e375f9f006b59be4876807d859ca917394491ecd49f86ec",
  "urn:usf:rule:local-preparation-intent:1": "sha256:e05307a94132ed3ee0d18f7665df329281d9f452482e929c0eda0627aa388379",
  "urn:usf:rule:local-preparation-readback:1": "sha256:2c1c6bfb36d46b75bd0969b2591e6b1f757da68ea43eab6ee4b66a4f7bbb0778",
  "urn:usf:rule:local-preparation-replay:1": "sha256:036ed9d43505cd6cb54cee125961f4a35a8ea62224426a0a8702ac9dde5ea232",
  "urn:usf:rule:local-preparation-scope:1": "sha256:015d2d177c3a0367e6bd3a6817a04c67d8205b4b100effee313f0fcbfb065e8e",
  "urn:usf:rule:local-preparation-serial-safety:1": "sha256:ba4cc571ed145fcd4fcae2b08ed2af9f106ea9831922da04f8d0699e6c0f1d73",
  "urn:usf:rule:local-preparation-terminal:1": "sha256:28748d5c287c49c60426fbebefed8c4dda8ad5fd7cc3f4575a1ffc1b72c5000c"
});

const observationAdapters = new Map([[
  "resolve prepare-local", {
    id: "urn:usf:cli-adapter:local-contribution-prepare:1",
    command: "urn:usf:command:resolve-prepare-local:1",
    algorithm: "urn:usf:algorithm:local-contribution-preparation:1",
    outputSchema: "urn:usf:local-contribution:1",
    rules: localObservationRules,
    prepare: prepareLocalContribution,
  },
]]);

// These bindings describe compiled rule support, not permission or progression.
const localRuleRoles: Readonly<Record<string, string | readonly string[]>> = Object.freeze({
  "input.derivationRule": "input",
  "effect.guardRule": "guard",
  "effect.scopeRule": "scope",
  "effect.readbackRule": "readback",
  "effect.safetyRule": "serial-safety",
  "produces.0.basisRule": "basis",
  "produces.0.authenticationRule": "readback",
  "produces.0.digestRule": "digest",
  "recovery.intentRule": "intent",
  "recovery.boundaryRule": "boundary",
  "recovery.unknownOutcomeRule": "replay",
  "recovery.reconciliationRule": "replay",
  "recovery.terminalProofRule": "terminal",
  "recovery.obligations": ["readback", "replay"],
});

export function validateLocalObservationRoles(descriptor: ObservationObject, transitionIdentity: string): void {
  const actualRoles = new Set<string>();
  function collect(value: unknown, path: string, key: string): void {
    if (key.endsWith("Rule") || key === "obligations") { actualRoles.add(path); return; }
    if (value !== null && typeof value === "object") {
      for (const [name, child] of Object.entries(value)) collect(child, path ? `${path}.${name}` : name, name);
    }
  }
  collect(descriptor, "", "");
  if (actualRoles.size !== Object.keys(localRuleRoles).length || [...actualRoles].some(path => !Object.hasOwn(localRuleRoles, path))) {
    throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "The descriptor declares unsupported operational rule roles.");
  }
  for (const [path, supported] of Object.entries(localRuleRoles)) {
    let value: unknown = descriptor;
    for (const key of path.split(".")) {
      value = value !== null && typeof value === "object" ? (value as ObservationObject)[key] : undefined;
    }
    const expected = (typeof supported === "string" ? [supported] : supported)
      .map(name => `urn:usf:rule:local-preparation-${name}:1`);
    const actual = typeof value === "string" ? [value] : value;
    if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
      throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "Compiled rule role does not match the semantic descriptor.", { path });
    }
  }
  const outputs = descriptor.produces;
  if (!Array.isArray(outputs) || outputs.length !== 1 || observationObject(outputs[0]).producer !== transitionIdentity) {
    throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Produced artifact has inconsistent transition lineage.");
  }
}

export function inspectObservationTransition(graph: SemanticGraph, selection: { readonly rootIdentity: string; readonly manifestPath: string }, commandPath: string) {
  const implementation = observationAdapters.get(commandPath);
  if (implementation === undefined) throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "No compiled observation adapter exists.");
  const context = deriveCliTransitionContext(graph, selection.rootIdentity);
  if (context.diagnostics.length > 0 || context.contract === null || context.profile === null) {
    throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Selected context is not uniquely interpretable.", { diagnostics: context.diagnostics });
  }
  const P = "urn:usf:predicate:";
  const values = (subject: string, predicate: string, kind: "iri" | "literal" = "iri") => {
    const rows = graph.quads.filter(q => q.subject === subject && q.predicate === P + predicate);
    if (rows.some(q => q.objectKind !== kind)) throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Semantic binding has mixed value kinds.");
    return [...new Set(rows.map(q => q.object))].sort();
  };
  const exact = (subject: string, predicate: string, expected: string, kind: "iri" | "literal" = "iri") => {
    const found = values(subject, predicate, kind);
    if (found.length !== 1 || found[0] !== expected) throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "Compiled observation binding does not match semantic authority.", { subject, predicate });
  };
  if (context.work !== selection.rootIdentity) {
    throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "Binding-root execution is not admitted by this observation adapter.");
  }
  const { id: adapter, command } = implementation;
  if (!values(context.contract, "admitsObservationAdapter").includes(adapter)) {
    throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "The selected contract does not admit this observation adapter.");
  }
  exact(command, "commandPath", commandPath, "literal");
  exact(command, "adapterIdentity", adapter);
  exact(command, "forContract", context.contract);
  exact(command, "externalContact", "none", "literal");
  exact(adapter, "registeredCommand", command);
  exact(adapter, "algorithm", implementation.algorithm);
  const transitions = values(selection.rootIdentity, "transition").filter(id => values(id, "command").includes(command));
  if (transitions.length !== 1) throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "One exact local observation transition is required.");
  const specifications = deriveCliRecordSpecifications(graph, { contractIdentity: context.contract });
  const rootRecord = specifications.records.find(record => record.fragment === "");
  const schema = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  if (!verifyCliDescriptorSchema(graph, { contractIdentity: context.contract }, schema).matches || rootRecord === undefined) {
    throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Canonical descriptor schema is not current.");
  }
  const projected = deriveCliRecord(graph, { recordIdentity: rootRecord.id, subjectIdentity: transitions[0]! }, specifications);
  if (!projected.valid || projected.value === null) throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Observation descriptor is incomplete.", { diagnostics: projected.gaps });
  const descriptor = projected.value;
  validateLocalObservationRoles(descriptor, transitions[0]!);
  const declaredOutputs = descriptor.produces;
  if (!Array.isArray(declaredOutputs) || declaredOutputs.length !== 1
    || observationObject(declaredOutputs[0]).schema !== implementation.outputSchema
    || observationObject(declaredOutputs[0]).work !== selection.rootIdentity
    || observationObject(declaredOutputs[0]).profile !== context.profile) {
    throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Declared output does not match the compiled observation work/profile/schema.");
  }
  const effect = observationObject(descriptor.effect), declaredInput = observationObject(descriptor.input);
  if (descriptor.owner !== context.contract || effect.effectClass !== "observation" || effect.contact !== "none"
    || !Array.isArray(descriptor.prerequisites) || descriptor.prerequisites.length !== 0
    || !Array.isArray(descriptor.consumes) || descriptor.consumes.length !== 0) {
    throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "This compiled adapter admits only a prerequisite-free no-effect observation; current construction guards still apply.");
  }
  const rules = new Set<string>();
  function collectRules(value: unknown, key = ""): void {
    if (typeof value === "string" && (key.endsWith("Rule") || key === "obligations")) rules.add(value);
    else if (Array.isArray(value)) for (const child of value) collectRules(child, key);
    else if (value !== null && typeof value === "object") for (const [name, child] of Object.entries(value)) collectRules(child, name);
  }
  collectRules(descriptor);
  if (rules.size !== Object.keys(implementation.rules).length || [...rules].some(id => implementation.rules[id] !== canonicalQuadDigest(graph.quads.filter(q => q.subject === id)))) {
    throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "Operational rule interpretation is unknown or has changed.");
  }
  if (typeof declaredInput.schema !== "string") throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Input schema identity is missing.");
  const recordIds = values(declaredInput.schema, "recordSpecification");
  const record = recordIds.length === 1 ? specifications.records.find(r => r.id === recordIds[0]) : undefined;
  if (record === undefined) throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Input record is outside the canonical schema closure.");
  const validator = createJsonSchemaValidator({ $schema: schema.$schema, $id: "urn:usf:cli-observation-input-validation:1", $ref: record.schemaIdentity + "#" + record.fragment }, { dependencySchemas: [schema] });
  return { implementation, context, descriptor, validator, transitionIdentity: transitions[0]! };
}

export async function observationCommandHandler(request: CommandRequest, commandPath: string): Promise<CommandResult> {
  if (!observationAdapters.has(commandPath)) throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "No compiled observation adapter exists.");
  const transport = parseCommandInput(request.args, "RESOLVE");
  if (transport.mode !== "source") throw new UsfError("RESOLVE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Local preparation requires the registered --input transport.");
  const input = observationObject(await readCommandInput(request.repositoryRoot, transport, "RESOLVE"));
  if (typeof input.rootIdentity !== "string" || typeof input.manifestPath !== "string") {
    throw new UsfError("CLI_TRANSITION_INPUT_REQUIRED", exitCodes.INVALID_INPUT, "External rootIdentity and manifestPath are required.");
  }
  const selection = { rootIdentity: input.rootIdentity, manifestPath: input.manifestPath };
  const graph = loadSemanticGraph(request.repositoryRoot, selection.manifestPath);
  const { implementation, context, validator } = inspectObservationTransition(graph, selection, commandPath);
  if (!validator.validate(input).valid) throw new UsfError("CLI_TRANSITION_INPUT_INVALID", exitCodes.INVALID_INPUT, "Input violates the graph-generated request schema.");
  try {
    const output = parseLocalContribution(await implementation.prepare(request.repositoryRoot, selection, input.operations));
    if (output.schema !== implementation.outputSchema || output.basis.work.id !== selection.rootIdentity
      || output.basis.selection.profile !== context.profile) {
      throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Produced artifact is not the declared work/profile/schema.");
    }
    const current = loadSemanticGraph(request.repositoryRoot, selection.manifestPath);
    if (canonicalQuadDigest(current.quads) !== canonicalQuadDigest(graph.quads)) {
      throw new UsfError("CLI_TRANSITION_STALE", exitCodes.CURRENTNESS_FAILURE, "Observation semantics moved before output.");
    }
    return { output, exitCode: exitCodes.SUCCESS };
  } catch (error) {
    if (error instanceof LocalContributionError) throw new UsfError(error.reasonCode, exitCodes.DOMAIN_FAILURE, "Current local preparation guards refused.");
    throw error;
  }
}

export function observationTransitionAdapters(): readonly CliTransitionAdapter[] {
  return [...observationAdapters].map(([commandPath, implementation]) => ({
    id: implementation.id, effectClass: "observation",
    inspect(graph, selection, transitionIdentity) {
      try {
        const admitted = inspectObservationTransition(graph, selection, commandPath);
        if (admitted.transitionIdentity !== transitionIdentity) {
          return [{ reasonCode: "TRANSITION_ADAPTER_UNMAPPED", subject: transitionIdentity, field: "adapter" }];
        }
        return [];
      } catch (error) {
        if (!(error instanceof UsfError)) throw error;
        return [{ reasonCode: error.code, subject: transitionIdentity, field: "adapter" }];
      }
    },
  }));
}


export function parseTransitionInterrogation(args: readonly string[]): { rootIdentity: string; manifestPath: string } {
  const contract = transitionReadContracts.find(contract => contract.path[1] === args[0]);
  if (contract === undefined) {
    throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.INVALID_INPUT, "Only registered no-effect transition reads are implemented.");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]!;
    const input = contract.inputs.find((field) => field.flag === flag);
    const value = args[index + 1];
    if (!input || values.has(flag) || value === undefined || value.length > input.maximumLength
      || !new RegExp(input.pattern, "u").test(value)) {
      throw new UsfError("CLI_TRANSITION_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Inputs must match the canonical interrogation contract.");
    }
    values.set(flag, value);
  }
  for (const input of contract.inputs) {
    if (!values.has(input.flag)) {
      if (input.required) throw new UsfError("CLI_TRANSITION_INPUT_REQUIRED", exitCodes.INVALID_INPUT, "A required external selector is missing.", { input: input.flag });
      if (input.defaultValue !== null) values.set(input.flag, input.defaultValue);
    }
  }
  return { rootIdentity: values.get("--root")!, manifestPath: values.get("--manifest")! };
}

function boundedTransitionRead<T>(read: () => T): T {
  try { return read(); }
  catch (error) {
    if (error instanceof RangeError && ["TRANSITION_INPUT_BOUNDS_EXCEEDED", "TRANSITION_DESCRIPTOR_BOUNDS_EXCEEDED", "CLI_SPECIFICATION_BOUNDS", "CLI_RECORD_BOUNDS"].includes(error.message)) {
      throw new UsfError(error.message, exitCodes.INVALID_INPUT, "Selected transition data exceeds the bounded interrogation contract.");
    }
    throw error;
  }
}

export function deriveTransitionSchemaResult(graph: SemanticGraph, selection: { readonly rootIdentity: string; readonly manifestPath: string }) {
  return boundedTransitionRead(() => {
  const context = deriveCliTransitionContext(graph, selection.rootIdentity);
  if (context.diagnostics.length > 0 || context.work === null || context.contract === null || context.profile === null) {
    throw new UsfError("TRANSITION_SEMANTICS_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Schema derivation requires one exact work/contract/profile context.", { diagnostics: context.diagnostics });
  }
  const command = "urn:usf:command:transition-schema:1", predicate = "urn:usf:predicate:";
  for (const [field, value, kind] of [
    ["type", "urn:usf:type:RegisteredCliCommand", "iri"], ["version", "1", "literal"],
    ["commandPath", transitionSchemaContract.path.join(" "), "literal"], ["forContract", context.contract, "iri"],
    ["algorithm", "urn:usf:cli-field-specification:rule-generate-schema:1", "iri"],
    ["outputSchema", transitionSchemaContract.outputSchema, "iri"], ["externalContact", "none", "literal"],
  ]) {
    const rows = graph.quads.filter(q => q.subject === command && q.predicate === predicate + field);
    if (rows.length !== 1 || rows[0]!.objectKind !== kind || rows[0]!.object !== value) {
      throw new UsfError("CLI_TRANSITION_UNIMPLEMENTED", exitCodes.DOMAIN_FAILURE, "Schema derivation command binding does not match current semantic authority.", { field });
    }
  }
  const generated = deriveCliSchemas(deriveCliRecordSpecifications(graph, { contractIdentity: context.contract }));
  if (generated.descriptorSchema === null || generated.digest === null) {
    throw new UsfError("CLI_SPECIFICATION_INCOMPLETE", exitCodes.DOMAIN_FAILURE, "Structural specifications do not define a canonical schema.", { gaps: generated.gaps });
  }
  const output = { schema: transitionSchemaContract.outputSchema, ...selection, work: context.work, contract: context.contract,
    profile: context.profile, sourceBasis: generated.sourceBasis, schemaDigest: generated.digest,
    descriptorSchema: generated.descriptorSchema, operationalGaps: generated.operationalGaps, executionAuthority: "none" as const };
  const wire = JSON.parse(readFileSync(new URL("../../schemas/cli-schema-derivation.schema.json", import.meta.url), "utf8"));
  const validation = createJsonSchemaValidator(wire).validate(output);
  if (!validation.valid) throw new UsfError("CLI_TRANSITION_OUTPUT_INVALID", exitCodes.DOMAIN_FAILURE, "Generated schema result violates its declared envelope.", { errors: validation.errors });
  return output;
  });
}

/** Follow only the selected binding's declared target; retain actual source rows, never synthetic authority. */
export function loadTransitionContextGraph(repositoryRoot: string, selection: { readonly rootIdentity: string; readonly manifestPath: string }): SemanticGraph {
  const discovery = loadSemanticGraph(repositoryRoot, selection.manifestPath);
  const selectedRows = discovery.quads.filter(q => q.subject === selection.rootIdentity);
  if (!selectedRows.some(q => q.predicate === "urn:usf:predicate:type" && q.objectKind === "iri" && q.object === "urn:usf:type:LinearIssueWorkBinding")) return discovery;
  let binding;
  try { binding = deriveLinearBindingDeclaration(discovery, selection.rootIdentity); }
  catch (error) {
    if (!(error instanceof LinearBindingError)) throw error;
    throw new UsfError(error.reasonCode, exitCodes.DOMAIN_FAILURE, "Selected binding declaration is invalid.");
  }
  if (binding.targetManifest === selection.manifestPath) return discovery;
  const target = loadSemanticGraph(repositoryRoot, binding.targetManifest);
  const currentRows = loadSemanticGraph(repositoryRoot, selection.manifestPath).quads.filter(q => q.subject === selection.rootIdentity);
  if (canonicalQuadDigest(currentRows) !== canonicalQuadDigest(selectedRows)) {
    throw new UsfError("CLI_TRANSITION_STALE", exitCodes.CURRENTNESS_FAILURE, "Selected binding changed while deriving its target closure.");
  }
  const quads = [...new Map([...target.quads, ...selectedRows].map(q => [canonicalQuadLine(q), q])).values()];
  if (quads.length > 100000) throw new UsfError("TRANSITION_INPUT_BOUNDS_EXCEEDED", exitCodes.INVALID_INPUT, "Selected binding closure exceeds the graph bound.");
  const graphs = [...new Set(quads.map(q => q.graph))];
  return { ...target, quads, semanticDigest: canonicalQuadDigest(quads),
    graphDigests: Object.fromEntries(graphs.map(id => [id, canonicalQuadDigest(quads.filter(q => q.graph === id))])),
    sourceDigests: { ...discovery.sourceDigests, ...target.sourceDigests } };
}

export function transitionCommandHandler(request: CommandRequest, installedCommands: readonly string[]): CommandResult {
  const selection = parseTransitionInterrogation(request.args);
  const graph = loadTransitionContextGraph(request.repositoryRoot, selection);
  if (request.args[0] === transitionSchemaContract.path[1]) {
    return { output: deriveTransitionSchemaResult(graph, selection), exitCode: exitCodes.SUCCESS };
  }
  const paths = new Map<string, readonly string[]>();
  for (const command of commandRegistry) {
    paths.set(command.path.join(" "), command.path);
    if ("topics" in command) for (const topic of command.topics ?? []) paths.set(topic.path.join(" "), topic.path);
  }
  for (const command of installedCommands) paths.set(command, [command]);
  // Legacy handlers still own nested and option-selected parsers. This bounded
  // projection cannot attest an exhaustive inventory until they are migrated.
  const inventory = {
    complete: false,
    leaves: [...paths.values()].map((path) => ({ path,
      owner: path.join(" ") === transitionInterrogationContract.path.join(" ") ? "urn:usf:contract:cli-transition-definition:1" : null,
      parserOwner: path.join(" ") === transitionInterrogationContract.path.join(" ") ? "src/commands/help.ts#transitionInterrogationContract" : null,
    })),
  };
  const output = boundedTransitionRead(() => deriveCliTransitionCoverage(graph, selection, inventory, observationTransitionAdapters()));
  const schema = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-interrogation.schema.json", import.meta.url), "utf8"));
  const descriptor = JSON.parse(readFileSync(new URL("../../schemas/cli-transition-descriptor.schema.json", import.meta.url), "utf8"));
  if ("contract" in output && typeof output.contract === "string") {
    const agreement = verifyCliDescriptorSchema(graph, { contractIdentity: output.contract }, descriptor);
    if (!agreement.matches) {
      throw new UsfError(agreement.reasonCode, exitCodes.DOMAIN_FAILURE, "Descriptor schema must match the selected semantic field specifications.", { ...agreement });
    }
  }
  const validation = createJsonSchemaValidator(schema, { dependencySchemas: [descriptor] }).validate(output);
  if (!validation.valid) {
    throw new UsfError("CLI_TRANSITION_OUTPUT_INVALID", exitCodes.DOMAIN_FAILURE, "Transition output does not match its canonical schema.", { errors: validation.errors });
  }
  return { output, exitCode: exitCodes.DOMAIN_FAILURE };
}
