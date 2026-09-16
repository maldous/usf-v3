import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { parseRepositoryPath } from "../core/scope.ts";
import { objectValues, objectsFor, resourceDigest, type SemanticGraph } from "../graph/index.ts";
import { canonicalQuadLine, parseStrictNQuads } from "../graph/nquads.ts";
import type { WorkPacket } from "../graph/work.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import type { RealisationBasis } from "./basis.ts";
import type { AuthenticatedNoChangeWorkspace, NoChangePolicyBinding } from "./index.ts";

const predicate = (name: string): string => `urn:usf:predicate:${name}`;
const typePredicate = predicate("type");
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const iriPattern = /^urn:[^<>\s]+$/u;

export const workCompletionConstants = Object.freeze({
  manifestPath: "graph/manifests/integration.json",
  policyIri: "urn:usf:publication-policy:no-change-work-completion:1",
  policyType: "urn:usf:type:NoChangeWorkCompletionPublicationPolicy",
  realisationAlgorithmIri: "urn:usf:algorithm:no-change-workspace-materialisation:1",
  evidenceAlgorithmIri: "urn:usf:algorithm:no-change-completion-evidence:1",
  proofAlgorithmIri: "urn:usf:proof-algorithm:semantic-no-change-completion:1",
  publicationAlgorithmIri: "urn:usf:algorithm:copy-on-write-work-completion-publication:1",
  completionRuleIri: "urn:usf:rule:copy-on-write-work-completion:1",
  realisationReceiptType: "urn:usf:type:AdmittedNoChangeRealisationReceipt",
  realisationReceiptSchemaIri: "urn:usf:schema:admitted-no-change-realisation-receipt:1",
  evidenceSchemaIri: "urn:usf:schema:completion-evidence-candidate:1",
  proofBundleSchemaIri: "urn:usf:schema:completion-proof-bundle:1",
  publicationReceiptSchemaIri: "urn:usf:schema:work-completion-publication-receipt:1",
  publicationResultSchemaIri: "urn:usf:schema:work-completion-publication-result:1",
  targetGraphIri: "urn:usf:graph:integration",
  sourcePath: "graph/integration.nq",
  receiptRoot: "evidence/work-completion/",
  candidateRoot: ".usf/candidates/work-completion/",
  primaryMutationLockPath: ".usf/locks/primary-mutation.lock",
  activeState: "urn:usf:contract-state:active",
  implementedState: "urn:usf:implementation-state:implemented",
  eligibleWorks: Object.freeze([
    "urn:usf:work:repository-path-scope",
    "urn:usf:work:file-asset-index",
  ]),
  commands: Object.freeze([
    "urn:usf:command:realise-no-change:1",
    "urn:usf:command:evidence-completion:1",
    "urn:usf:command:prove-completion:1",
    "urn:usf:command:publish-work-completion:1",
  ]),
  schemaPaths: Object.freeze([
    "schemas/completion-evidence-candidate.schema.json",
    "schemas/completion-proof-bundle.schema.json",
    "schemas/no-change-realisation-result.schema.json",
    "schemas/no-change-workspace-manifest.schema.json",
    "schemas/work-completion-publication-receipt.schema.json",
    "schemas/work-completion-publication-result.schema.json",
  ]),
  toolPaths: Object.freeze([
    "src/cli.ts",
    "src/commands/check.ts",
    "src/commands/help.ts",
    "src/commands/work-completion.ts",
    "src/graph/work.ts",
    "src/realisation/index.ts",
    "src/realisation/work-completion.ts",
  ]),
});

export const workCompletionNonClaims = Object.freeze([
  "No-change completion is not Git integration or provider contribution lineage.",
  "A zero delta, passing check or active construction permission alone is not completion.",
  "No provider, credential, network, runtime, staging, production, ANQR or terminal proof is claimed.",
]);

export interface CompletionPublicationStartObservation {
  readonly mode: "apply" | "verify";
  readonly source: "preimage" | "postimage" | "other";
  readonly sourceModeMatches: boolean;
  readonly receiptPending: "absent" | "pending" | "linked";
  readonly receiptExists: boolean;
  readonly sourcePendingExists: boolean;
}

export type CompletionPublicationStartDecision =
  | Readonly<{ action: "refuse"; reasonCode: "WORK_COMPLETION_PUBLICATION_PARTIAL_STATE" | "WORK_COMPLETION_PUBLICATION_RECONCILIATION_REQUIRED" }>
  | Readonly<{ action: "verify-absent" | "verify-current" | "apply-source" | "apply-receipt" }>;

/** Pure decision only. The caller must authenticate observations and recheck before effects. */
export function assessCompletionPublicationStart(input: CompletionPublicationStartObservation): CompletionPublicationStartDecision {
  if (input.source === "other" || !input.sourceModeMatches
    || (input.source === "preimage" && (input.receiptPending !== "absent" || input.receiptExists))) {
    return Object.freeze({ action: "refuse", reasonCode: "WORK_COMPLETION_PUBLICATION_PARTIAL_STATE" });
  }
  if (input.mode === "verify") {
    if (input.receiptPending !== "absent" || input.sourcePendingExists
      || (input.source === "postimage" && !input.receiptExists)) {
      return Object.freeze({ action: "refuse", reasonCode: "WORK_COMPLETION_PUBLICATION_RECONCILIATION_REQUIRED" });
    }
    return Object.freeze({ action: input.source === "preimage" ? "verify-absent" : "verify-current" });
  }
  if (input.source === "preimage") return Object.freeze({ action: "apply-source" });
  if (input.sourcePendingExists) {
    return Object.freeze({ action: "refuse", reasonCode: "WORK_COMPLETION_PUBLICATION_PARTIAL_STATE" });
  }
  return Object.freeze({ action: "apply-receipt" });
}

function completionDecisionSingleton(values: readonly string[] | undefined, expected: string): boolean {
  return Array.isArray(values) && values.length === 1 && values[0] === expected;
}

/** Compare authenticated graph projections; this does not authenticate bytes or grant authority. */
export function completionTerminalEvaluatorMatches(input: Readonly<{
  digest: string;
  algorithms: readonly string[];
  policies: readonly string[];
  expectedAlgorithm: string;
  expectedPolicy: string;
}>): boolean {
  return input.digest === "sha256:b9c8fd3a8e648ecb1ddb6e1bbdca0d4e536ebfeffdfd8f204a38287370b0ea3d"
    && completionDecisionSingleton(input.algorithms, input.expectedAlgorithm)
    && completionDecisionSingleton(input.policies, input.expectedPolicy);
}

/** Preserve the pinned complete resource, exact field denominator, and producer backlink. */
export function completionTerminalArtifactMatches(input: Readonly<{
  digest: string;
  declarations: readonly string[];
  values: Readonly<Record<string, readonly string[]>>;
  expected: Readonly<Record<string, string>>;
  producerArtifacts: readonly string[];
}>): boolean {
  const fields = ["type", "producer", "schema", "work", "profile", "proofObligation"] as const;
  if (input.digest !== "sha256:d09e7915796bd640dda4332327d2f26710358a0088fa742b085c4314786f5981"
    || input.declarations.length !== 1 || Object.keys(input.expected).length !== fields.length
    || fields.some(field => !Object.hasOwn(input.expected, field) || typeof input.expected[field] !== "string")) {
    return false;
  }
  return fields.every(field => completionDecisionSingleton(input.values[field], input.expected[field]!))
    && completionDecisionSingleton(input.producerArtifacts, input.declarations[0]!);
}

function exactValues(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string[] {
  const values = objectsFor(graph, subject, predicate(name));
  if (values.some((value) => value.objectKind !== kind)) throw new Error(`WORK_COMPLETION_${name.toUpperCase()}_KIND_INVALID`);
  const normalized = values.map((value) => value.object).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`WORK_COMPLETION_${name.toUpperCase()}_DUPLICATE`);
  return normalized;
}

function oneValue(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string {
  const values = exactValues(graph, subject, name, kind);
  if (values.length !== 1) throw new Error(`WORK_COMPLETION_${name.toUpperCase()}_INVALID`);
  return values[0] as string;
}

function hasExactType(graph: SemanticGraph, subject: string, type: string): boolean {
  return exactValues(graph, subject, "type", "iri").includes(type);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function assertDigest(value: string, reason: string): void {
  if (!digestPattern.test(value)) throw new Error(reason);
}

export interface NoChangeCompletionAuthority {
  readonly policy: NoChangePolicyBinding;
  readonly evidenceAlgorithmIri: string;
  readonly evidenceAlgorithmDigest: string;
  readonly proofAlgorithmIri: string;
  readonly proofAlgorithmDigest: string;
  readonly publicationAlgorithmIri: string;
  readonly publicationAlgorithmDigest: string;
  readonly completionRuleIri: string;
  readonly completionRuleDigest: string;
  readonly manifestPath: string;
  readonly sourcePath: string;
  readonly targetGraphIri: string;
  readonly receiptRoot: string;
  readonly candidateRoot: string;
  readonly primaryMutationLockPath: string;
  readonly schemaPaths: readonly string[];
  readonly toolPaths: readonly string[];
  readonly commands: readonly string[];
  readonly semanticDependencies: readonly string[];
  readonly workspaceSchemaIri: string;
  readonly workspaceSchemaPath: string;
  readonly realisationResultSchemaIri: string;
  readonly realisationResultSchemaPath: string;
  readonly realisationReceiptType: string;
  readonly realisationReceiptSchemaIri: string;
  readonly evidenceSchemaIri: string;
  readonly evidenceSchemaPath: string;
  readonly proofBundleSchemaIri: string;
  readonly proofBundleSchemaPath: string;
  readonly publicationReceiptSchemaIri: string;
  readonly publicationReceiptSchemaPath: string;
  readonly publicationReceiptRecordSchema: string;
  readonly publicationResultSchemaIri: string;
  readonly publicationResultSchemaPath: string;
  readonly publicationResultRecordSchema: string;
  readonly minimumBundleCount: number;
  readonly maximumBundleCount: number;
}

function completionSchemaBinding(graph: SemanticGraph, policy: string, name: string, schemaPaths: readonly string[]): Readonly<{ iri: string; path: string; recordSchema: string; version: string }> {
  const iri = oneValue(graph, policy, name, "iri");
  const version = oneValue(graph, iri, "version", "literal");
  if (!hasExactType(graph, iri, "urn:usf:type:SemanticRecordSchema")
    || (name === "publicationReceiptSchema" ? !["1", "2"].includes(version) : version !== "1")) {
    throw new Error(`WORK_COMPLETION_${name.toUpperCase()}_INVALID`);
  }
  const path = oneValue(graph, iri, "repositoryPath", "literal");
  if (parseRepositoryPath(path, "file") === null || !schemaPaths.includes(path)) throw new Error(`WORK_COMPLETION_${name.toUpperCase()}_PATH_INVALID`);
  let recordSchema: unknown;
  try { recordSchema = (JSON.parse(readFileSync(resolve(graph.repositoryRoot, path), "utf8")) as { $id?: unknown }).$id; }
  catch { throw new Error(`WORK_COMPLETION_${name.toUpperCase()}_SCHEMA_INVALID`); }
  if (typeof recordSchema !== "string" || !iriPattern.test(recordSchema)) throw new Error(`WORK_COMPLETION_${name.toUpperCase()}_SCHEMA_INVALID`);
  if (name === "publicationReceiptSchema") {
    const expected = version === "1"
      ? { iri: "urn:usf:schema:work-completion-publication-receipt:1", path: "schemas/work-completion-publication-receipt.schema.json", recordSchema: "urn:usf:work-completion-publication-receipt:1" }
      : { iri: "urn:usf:schema:work-completion-publication-receipt:2", path: "schemas/work-completion-publication-receipt-v2.schema.json", recordSchema: "urn:usf:work-completion-publication-receipt:2" };
    if (iri !== expected.iri || path !== expected.path || recordSchema !== expected.recordSchema) {
      throw new Error("WORK_COMPLETION_PUBLICATION_RECEIPT_SCHEMA_INVALID");
    }
  }
  return Object.freeze({ iri, path, recordSchema, version });
}

function assertPublicationReceiptSchemaSelection(
  graph: SemanticGraph,
  policy: string,
  schema: Readonly<{ iri: string; path: string; recordSchema: string; version: string }>,
): void {
  const selectionRules = exactValues(graph, policy, "schemaSelectionRule", "iri");
  if (schema.version === "1" && selectionRules.length === 0) return;
  if (selectionRules.length !== 1) throw new Error("WORK_COMPLETION_PUBLICATION_RECEIPT_SCHEMA_SELECTION_INVALID");
  const selectionRule = selectionRules[0] as string;
  if (!hasExactType(graph, selectionRule, "urn:usf:type:CliFieldDerivationRule")
    || oneValue(graph, selectionRule, "version", "literal") !== "1"
    || oneValue(graph, selectionRule, "schemaRole", "literal") !== "publicationReceiptSchema"
    || oneValue(graph, selectionRule, "otherSchemaVersion", "literal") !== "1") {
    throw new Error("WORK_COMPLETION_PUBLICATION_RECEIPT_SCHEMA_SELECTION_INVALID");
  }
  const bindings = exactValues(graph, selectionRule, "admittedBinding", "iri");
  const expectedBindings = [
    { schema: "urn:usf:schema:work-completion-publication-receipt:1", version: "1", path: "schemas/work-completion-publication-receipt.schema.json" },
    { schema: "urn:usf:schema:work-completion-publication-receipt:2", version: "2", path: "schemas/work-completion-publication-receipt-v2.schema.json" },
  ];
  if (bindings.length !== expectedBindings.length || expectedBindings.some((expected) => bindings.filter((binding) =>
    hasExactType(graph, binding, "urn:usf:type:SemanticRecordSchemaBinding")
    && oneValue(graph, binding, "schema", "iri") === expected.schema
    && oneValue(graph, binding, "version", "literal") === expected.version
    && oneValue(graph, binding, "repositoryPath", "literal") === expected.path).length !== 1)) {
    throw new Error("WORK_COMPLETION_PUBLICATION_RECEIPT_SCHEMA_BINDINGS_INVALID");
  }
  const selected = bindings.filter((binding) =>
    hasExactType(graph, binding, "urn:usf:type:SemanticRecordSchemaBinding")
    && oneValue(graph, binding, "schema", "iri") === schema.iri
    && oneValue(graph, binding, "version", "literal") === schema.version
    && oneValue(graph, binding, "repositoryPath", "literal") === schema.path);
  if (selected.length !== 1) throw new Error("WORK_COMPLETION_PUBLICATION_RECEIPT_SCHEMA_BINDING_INVALID");
  if (schema.version !== "2") return;
  const membership = oneValue(graph, schema.iri, "digestMembership", "iri");
  if (membership !== "urn:usf:rule:completion-publication-member-manifests:2"
    || !hasExactType(graph, membership, "urn:usf:type:CanonicalDigestMembership")
    || oneValue(graph, membership, "version", "literal") !== "2"
    || oneValue(graph, membership, "digestField", "literal") !== "cohortManifestDigest"
    || !sameSet(exactValues(graph, membership, "memberField", "literal"), ["ordinal", "workIri", "manifestPath", "manifestDigest"])
    || oneValue(graph, membership, "order", "literal") !== "ordinal-ascending"
    || oneValue(graph, membership, "canonicalizationRule", "literal") !== "canonical-json-array-sha256"
    || oneValue(graph, membership, "memberAuthentication", "literal") !== "all-current-members"
    || oneValue(graph, membership, "manifestPathConstraint", "literal") !== "selected-manifest"
    || oneValue(graph, membership, "dependencyConstraint", "literal") !== "no-intra-cohort-dependency"
    ) {
    throw new Error("WORK_COMPLETION_COHORT_MEMBERSHIP_RULE_INVALID");
  }
  const memberBasisRule = oneValue(graph, membership, "basisDerivationRule", "iri");
  if (memberBasisRule !== "urn:usf:rule:completion-publication-member-basis:1"
    || !hasExactType(graph, memberBasisRule, "urn:usf:type:CliFieldDerivationRule")
    || oneValue(graph, memberBasisRule, "version", "literal") !== "1"
    || oneValue(graph, memberBasisRule, "algorithm", "iri") !== oneValue(graph, policy, "publicationAlgorithm", "iri")
    || oneValue(graph, memberBasisRule, "publicationPolicy", "iri") !== policy
    || oneValue(graph, memberBasisRule, "implementationPath", "literal") !== "src/graph/work.ts"
    || !sameSet(exactValues(graph, memberBasisRule, "contextBinding", "literal"), ["graph", "realisation-profile", "manifest", "bounded-member-set", "invocation-derivation-context"])
    || !sameSet(exactValues(graph, memberBasisRule, "producedValue", "literal"), ["packet", "realisation-basis"])
    || !sameSet(exactValues(graph, memberBasisRule, "requiredReadback", "literal"), ["TRANSITION_LIVE", "REQUIRED_TRANSITION"])
    || !sameSet(exactValues(graph, memberBasisRule, "refusedInput", "literal"), ["recursive-member-completion", "caller-supplied-basis", "intra-cohort-dependency"])) {
    throw new Error("WORK_COMPLETION_COHORT_MEMBER_BASIS_RULE_INVALID");
  }
  const reauthenticationRule = "urn:usf:rule:completion-publication-reauthentication:1";
  const snapshotRule = "urn:usf:rule:completion-publication-snapshot-authentication:1";
  const cohortSnapshotRule = "urn:usf:rule:completion-publication-cohort-snapshot:1";
  if (oneValue(graph, reauthenticationRule, "memberAuthenticationRule", "iri") !== membership
    || oneValue(graph, snapshotRule, "memberAuthenticationRule", "iri") !== membership
    || oneValue(graph, cohortSnapshotRule, "memberAuthenticationRule", "iri") !== membership) {
    throw new Error("WORK_COMPLETION_COHORT_AUTHENTICATION_RULE_INVALID");
  }
}

export function deriveNoChangeCompletionAuthority(
  graph: SemanticGraph,
  workIri: string,
  selectedManifestPath = (graph as SemanticGraph & { manifestPath?: string }).manifestPath,
): NoChangeCompletionAuthority {
  const c = workCompletionConstants;
  const policies = typedSubjects(graph, c.policyType).filter((candidate) =>
    objectsFor(graph, candidate, predicate("eligibleWork")).some((quad) => quad.objectKind === "iri" && quad.object === workIri));
  if (policies.length !== 1) throw new Error(policies.length === 0 ? "WORK_COMPLETION_WORK_NOT_ELIGIBLE" : "WORK_COMPLETION_POLICY_AMBIGUOUS");
  const policyIri = policies[0] as string;
  const manifestPath = oneValue(graph, policyIri, "requiredManifestPath", "literal");
  const sourcePath = oneValue(graph, policyIri, "targetSemanticSourcePath", "literal");
  const targetGraphIri = oneValue(graph, policyIri, "targetNamedGraph", "iri");
  const receiptRoot = oneValue(graph, policyIri, "publicationReceiptRoot", "literal");
  const candidateRoot = oneValue(graph, policyIri, "ignoredCandidateRoot", "literal");
  const primaryMutationLockPath = oneValue(graph, policyIri, "primaryMutationLockPath", "literal");
  const minimumBundleCount = Number(oneValue(graph, policyIri, "minimumBundleCount", "literal"));
  const maximumBundleCount = Number(oneValue(graph, policyIri, "maximumBundleCount", "literal"));
  const commands = exactValues(graph, policyIri, "registeredCommand", "iri");
  const schemaPaths = exactValues(graph, policyIri, "schemaPath", "literal");
  const toolPaths = exactValues(graph, policyIri, "toolPath", "literal");
  if (oneValue(graph, policyIri, "version", "literal") !== "1"
    || oneValue(graph, policyIri, "implementationState", "iri") !== c.implementedState
    || selectedManifestPath === undefined || manifestPath !== selectedManifestPath
    || parseRepositoryPath(manifestPath, "file") === null || parseRepositoryPath(sourcePath, "file") === null
    || receiptRoot !== c.receiptRoot || candidateRoot !== c.candidateRoot || primaryMutationLockPath !== c.primaryMutationLockPath
    || minimumBundleCount !== 1 || maximumBundleCount !== 32 || commands.length !== 4
    || schemaPaths.length !== 6 || toolPaths.length === 0) throw new Error("WORK_COMPLETION_POLICY_INVALID");
  for (const path of [...schemaPaths, ...toolPaths]) if (parseRepositoryPath(path, "file") === null) throw new Error("WORK_COMPLETION_DEPENDENCY_PATH_INVALID");
  for (const command of commands) {
    if (!hasExactType(graph, command, "urn:usf:type:RegisteredCliCommand") || oneValue(graph, command, "version", "literal") !== "1"
      || oneValue(graph, command, "availability", "literal") !== "implemented") throw new Error("WORK_COMPLETION_COMMAND_INVALID");
  }
  const realisationAlgorithmIri = oneValue(graph, policyIri, "realisationAlgorithm", "iri");
  const evidenceAlgorithmIri = oneValue(graph, policyIri, "evidenceAlgorithm", "iri");
  const proofAlgorithmIri = oneValue(graph, policyIri, "proofAlgorithm", "iri");
  const publicationAlgorithmIri = oneValue(graph, policyIri, "publicationAlgorithm", "iri");
  const completionRuleIri = oneValue(graph, policyIri, "completionDerivationRule", "iri");
  const algorithms = [
    [realisationAlgorithmIri, "urn:usf:type:NoChangeRealisationAlgorithm"],
    [evidenceAlgorithmIri, "urn:usf:type:EvidenceNormalizationAlgorithm"],
    [proofAlgorithmIri, "urn:usf:type:ProofAlgorithm"],
    [publicationAlgorithmIri, "urn:usf:type:SemanticPublicationAlgorithm"],
  ] as const;
  for (const [algorithm, type] of algorithms) {
    if (!hasExactType(graph, algorithm, type) || oneValue(graph, algorithm, "version", "literal") !== "1"
      || oneValue(graph, algorithm, "implementationState", "iri") !== c.implementedState) throw new Error("WORK_COMPLETION_ALGORITHM_INVALID");
  }
  const realisationReceiptType = oneValue(graph, proofAlgorithmIri, "realisationRecordType", "iri");
  const realisationReceiptSchemaIri = oneValue(graph, proofAlgorithmIri, "realisationReceiptSchema", "iri");
  if (oneValue(graph, proofAlgorithmIri, "acceptedRealisationState", "literal") !== "accepted-no-change"
    || oneValue(graph, proofAlgorithmIri, "realisationVerifier", "iri") !== realisationAlgorithmIri
    || oneValue(graph, publicationAlgorithmIri, "publicationPolicy", "iri") !== policyIri
    || !hasExactType(graph, completionRuleIri, "urn:usf:type:CompletionDerivationRule")
    || oneValue(graph, completionRuleIri, "version", "literal") !== "1"
    || !hasExactType(graph, realisationReceiptType, "urn:usf:type:SemanticRecordType")
    || !hasExactType(graph, realisationReceiptSchemaIri, "urn:usf:type:SemanticRecordSchema")
    || oneValue(graph, realisationReceiptSchemaIri, "version", "literal") !== "1") throw new Error("WORK_COMPLETION_CHAIN_INVALID");
  const workspaceSchema = completionSchemaBinding(graph, policyIri, "workspaceSchema", schemaPaths);
  const realisationResultSchema = completionSchemaBinding(graph, policyIri, "realisationResultSchema", schemaPaths);
  const evidenceSchema = completionSchemaBinding(graph, policyIri, "evidenceSchema", schemaPaths);
  const proofBundleSchema = completionSchemaBinding(graph, policyIri, "proofBundleSchema", schemaPaths);
  const publicationReceiptSchema = completionSchemaBinding(graph, policyIri, "publicationReceiptSchema", schemaPaths);
  const publicationResultSchema = completionSchemaBinding(graph, policyIri, "publicationResultSchema", schemaPaths);
  assertPublicationReceiptSchemaSelection(graph, policyIri, publicationReceiptSchema);
  const semanticDependencies = exactValues(graph, workIri, "semanticDependency", "iri");
  return Object.freeze({
    policy: Object.freeze({
      iri: policyIri,
      resourceDigest: resourceDigest(graph, policyIri),
      algorithmIri: realisationAlgorithmIri,
      algorithmResourceDigest: resourceDigest(graph, realisationAlgorithmIri),
    }),
    evidenceAlgorithmIri,
    evidenceAlgorithmDigest: resourceDigest(graph, evidenceAlgorithmIri),
    proofAlgorithmIri,
    proofAlgorithmDigest: resourceDigest(graph, proofAlgorithmIri),
    publicationAlgorithmIri,
    publicationAlgorithmDigest: resourceDigest(graph, publicationAlgorithmIri),
    completionRuleIri,
    completionRuleDigest: resourceDigest(graph, completionRuleIri),
    manifestPath,
    sourcePath,
    targetGraphIri,
    receiptRoot,
    candidateRoot,
    primaryMutationLockPath,
    schemaPaths: Object.freeze(schemaPaths),
    toolPaths: Object.freeze(toolPaths),
    commands: Object.freeze(commands),
    semanticDependencies: Object.freeze(semanticDependencies),
    workspaceSchemaIri: workspaceSchema.iri,
    workspaceSchemaPath: workspaceSchema.path,
    realisationResultSchemaIri: realisationResultSchema.iri,
    realisationResultSchemaPath: realisationResultSchema.path,
    realisationReceiptType,
    realisationReceiptSchemaIri,
    evidenceSchemaIri: evidenceSchema.iri,
    evidenceSchemaPath: evidenceSchema.path,
    proofBundleSchemaIri: proofBundleSchema.iri,
    proofBundleSchemaPath: proofBundleSchema.path,
    publicationReceiptSchemaIri: publicationReceiptSchema.iri,
    publicationReceiptSchemaPath: publicationReceiptSchema.path,
    publicationReceiptRecordSchema: publicationReceiptSchema.recordSchema,
    publicationResultSchemaIri: publicationResultSchema.iri,
    publicationResultSchemaPath: publicationResultSchema.path,
    publicationResultRecordSchema: publicationResultSchema.recordSchema,
    minimumBundleCount: 1,
    maximumBundleCount: 32,
  });
}

export function workCompletionAuthorityDependencies(
  graph: SemanticGraph,
  authority: NoChangeCompletionAuthority,
): readonly WorkCompletionAuthorityDependency[] {
  const root = realpathSync(resolve(graph.repositoryRoot));
  const entries = [
    ...authority.schemaPaths.map((path) => ({ kind: "schema" as const, path })),
    ...authority.toolPaths.map((path) => ({ kind: "tool" as const, path })),
  ].sort((left, right) => `${left.kind}|${left.path}`.localeCompare(`${right.kind}|${right.path}`));
  if (new Set(entries.map((entry) => `${entry.kind}|${entry.path}`)).size !== entries.length) {
    throw new Error("WORK_COMPLETION_AUTHORITY_DEPENDENCY_DUPLICATE");
  }
  return Object.freeze(entries.map((entry) => {
    const absolute = resolve(root, entry.path);
    const relation = relative(root, absolute);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
      throw new Error("WORK_COMPLETION_AUTHORITY_DEPENDENCY_ESCAPE");
    }
    const status = lstatSync(absolute);
    if (status.isSymbolicLink() || !status.isFile() || realpathSync(absolute) !== absolute) {
      throw new Error("WORK_COMPLETION_AUTHORITY_DEPENDENCY_INVALID");
    }
    return Object.freeze({ ...entry, digest: sha256(readFileSync(absolute)) });
  }));
}

export interface CompletionValidationReference {
  readonly obligationIri: string;
  readonly receiptPath: string;
  readonly receiptDigest: string;
  readonly validationResultSetDigest: string;
}

export interface CompletionEvidenceCandidate {
  readonly schema: "urn:usf:completion-evidence-candidate:1";
  readonly status: "candidate";
  readonly stage: "completion-evidence";
  readonly disposition: "verified-no-change";
  readonly algorithmIri: string;
  readonly algorithmVersion: "1";
  readonly algorithmResourceDigest: string;
  readonly workIri: string;
  readonly contractIri: string;
  readonly profileIri: string;
  readonly profileVersion: string;
  readonly manifestPath: string;
  readonly manifestDigest: string;
  readonly evidenceIri: string;
  readonly evidenceRequirementIri: string;
  readonly evidenceRequirementDigest: string;
  readonly realisationBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly policyIri: string;
  readonly policyDigest: string;
  readonly realisationAlgorithmIri: string;
  readonly realisationAlgorithmDigest: string;
  readonly candidateDigest: string;
  readonly workspaceIdentityDigest: string;
  readonly candidateTreeDigest: string;
  readonly lineageDigest: string;
  readonly byteDeltaDigest: string;
  readonly fileModeDigest: string;
  readonly writeSetDigest: string;
  readonly validationResults: readonly CompletionValidationReference[];
  readonly validationResultDigest: string;
  readonly contentDigest: string;
}

export interface CompletionProofResult {
  readonly proofResultIri: string;
  readonly workIri: string;
  readonly obligationIri: string;
  readonly obligationDigest: string;
  readonly algorithmIri: string;
  readonly algorithmResourceDigest: string;
  readonly evidenceDigest: string;
  readonly realisationBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly candidateDigest: string;
  readonly validationResultDigest: string;
  readonly outcome: "pass";
  readonly contentDigest: string;
}

export interface CompletionProofBundle {
  readonly schema: "urn:usf:completion-proof-bundle:1";
  readonly status: "pass";
  readonly stage: "completion-proof";
  readonly disposition: "verified-no-change";
  readonly evidence: CompletionEvidenceCandidate;
  readonly proof: CompletionProofResult;
  readonly bundleDigest: string;
}

function completionEvidenceIri(workIri: string, requirementIri: string, basisDigest: string, candidateDigest: string, validationResultDigest: string): string {
  return `urn:usf:evidence:completion:${canonicalDigest({ workIri, requirementIri, basisDigest, candidateDigest, validationResultDigest }).slice("sha256:".length)}`;
}

function completionProofResultIri(workIri: string, obligationIri: string, evidenceDigest: string): string {
  return `urn:usf:proof-result:completion:${canonicalDigest({ workIri, obligationIri, evidenceDigest }).slice("sha256:".length)}`;
}

export function createCompletionEvidenceCandidate(
  graph: SemanticGraph,
  packet: WorkPacket,
  workspace: AuthenticatedNoChangeWorkspace,
  validationResults: readonly CompletionValidationReference[],
): CompletionEvidenceCandidate {
  const basis = packet.realisationBasis;
  const authority = packet.realisationAuthority;
  const requirement = authority?.completionEvidenceRequirement;
  if (basis === undefined || packet.decisionBoundary.kind !== "realisation-profile" || packet.decisionBoundary.root === null
    || packet.eligibility?.construction.eligible !== true || packet.eligibility.construction.authority !== "active-permission"
    || packet.eligibility.dependencyReady !== true || authority?.permission?.activationState !== workCompletionConstants.activeState
    || requirement === null || requirement === undefined) throw new Error("WORK_COMPLETION_EVIDENCE_PRECONDITION_INVALID");
  const selected = deriveNoChangeCompletionAuthority(graph, packet.id);
  if (workspace.constructionBasis.basisDigest !== basis.basisDigest
    || canonicalJson(workspace.policy) !== canonicalJson(selected.policy)
    || workspace.lineageDigest !== canonicalDigest({ acceptedContributionDigests: [], rejected: [] })
    || workspace.byteDeltaDigest !== canonicalDigest([]) || workspace.fileModeDigest !== canonicalDigest([])) {
    throw new Error("WORK_COMPLETION_WORKSPACE_INVALID");
  }
  const obligations = [...(authority?.completionValidationObligations ?? [])].sort();
  const normalized = validationResults.map((entry) => ({ ...entry })).sort((left, right) => left.obligationIri.localeCompare(right.obligationIri));
  if (obligations.length === 0 || !sameSet(normalized.map((entry) => entry.obligationIri), obligations)
    || normalized.length !== obligations.length || new Set(normalized.map((entry) => entry.obligationIri)).size !== normalized.length
    || normalized.some((entry) => !iriPattern.test(entry.obligationIri) || !/^\.usf\/receipts\/check\/[0-9a-f]{64}\/[0-9a-f]{64}\.json$/u.test(entry.receiptPath)
      || !digestPattern.test(entry.receiptDigest) || !digestPattern.test(entry.validationResultSetDigest))) {
    throw new Error("WORK_COMPLETION_VALIDATION_SET_INVALID");
  }
  const validationResultDigest = canonicalDigest(normalized, { rejectAbsolutePaths: true });
  const evidenceIri = completionEvidenceIri(packet.id, requirement, basis.basisDigest, workspace.candidateDigest, validationResultDigest);
  const draft: Omit<CompletionEvidenceCandidate, "contentDigest"> = {
    schema: "urn:usf:completion-evidence-candidate:1",
    status: "candidate",
    stage: "completion-evidence",
    disposition: "verified-no-change",
    algorithmIri: selected.evidenceAlgorithmIri,
    algorithmVersion: "1",
    algorithmResourceDigest: selected.evidenceAlgorithmDigest,
    workIri: packet.id,
    contractIri: packet.contract,
    profileIri: packet.decisionBoundary.root,
    profileVersion: packet.decisionBoundary.profileVersion ?? "",
    manifestPath: basis.selection.manifestPath,
    manifestDigest: basis.selection.manifestDigest,
    evidenceIri,
    evidenceRequirementIri: requirement,
    evidenceRequirementDigest: resourceDigest(graph, requirement),
    realisationBasisDigest: basis.basisDigest,
    scopedDependencyDigest: basis.work.scopedDependencyDigest,
    policyIri: selected.policy.iri,
    policyDigest: selected.policy.resourceDigest,
    realisationAlgorithmIri: selected.policy.algorithmIri,
    realisationAlgorithmDigest: selected.policy.algorithmResourceDigest,
    candidateDigest: workspace.candidateDigest,
    workspaceIdentityDigest: workspace.workspaceIdentityDigest,
    candidateTreeDigest: workspace.candidateTreeDigest,
    lineageDigest: workspace.lineageDigest,
    byteDeltaDigest: workspace.byteDeltaDigest,
    fileModeDigest: workspace.fileModeDigest,
    writeSetDigest: workspace.writeSetDigest,
    validationResults: Object.freeze(normalized),
    validationResultDigest,
  };
  return Object.freeze({ ...draft, contentDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) });
}

export function createCompletionProofBundle(
  graph: SemanticGraph,
  packet: WorkPacket,
  evidence: CompletionEvidenceCandidate,
  obligationIri: string,
): CompletionProofBundle {
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  const completionAuthority = packet.realisationAuthority;
  if (packet.realisationBasis === undefined || completionAuthority?.completionProofObligation !== obligationIri
    || !hasExactType(graph, obligationIri, "urn:usf:type:CompletionProofObligation")
    || !exactValues(graph, obligationIri, "requiresEvidence", "iri").includes(evidence.evidenceRequirementIri)
    || evidence.workIri !== packet.id || evidence.contractIri !== packet.contract
    || evidence.realisationBasisDigest !== packet.realisationBasis.basisDigest
    || evidence.scopedDependencyDigest !== packet.realisationBasis.work.scopedDependencyDigest
    || evidence.policyIri !== authority.policy.iri || evidence.policyDigest !== authority.policy.resourceDigest
    || evidence.algorithmIri !== authority.evidenceAlgorithmIri || evidence.algorithmResourceDigest !== authority.evidenceAlgorithmDigest) {
    throw new Error("WORK_COMPLETION_PROOF_PRECONDITION_INVALID");
  }
  const { contentDigest: suppliedEvidenceDigest, ...evidenceDraft } = evidence;
  if (suppliedEvidenceDigest !== canonicalDigest(evidenceDraft, { rejectAbsolutePaths: true })) throw new Error("WORK_COMPLETION_EVIDENCE_DIGEST_INVALID");
  const proofDraft: Omit<CompletionProofResult, "contentDigest"> = {
    proofResultIri: completionProofResultIri(packet.id, obligationIri, evidence.contentDigest),
    workIri: packet.id,
    obligationIri,
    obligationDigest: resourceDigest(graph, obligationIri),
    algorithmIri: authority.proofAlgorithmIri,
    algorithmResourceDigest: authority.proofAlgorithmDigest,
    evidenceDigest: evidence.contentDigest,
    realisationBasisDigest: evidence.realisationBasisDigest,
    scopedDependencyDigest: evidence.scopedDependencyDigest,
    candidateDigest: evidence.candidateDigest,
    validationResultDigest: evidence.validationResultDigest,
    outcome: "pass",
  };
  const proof = Object.freeze({ ...proofDraft, contentDigest: canonicalDigest(proofDraft, { rejectAbsolutePaths: true }) });
  const bundleDraft = {
    schema: "urn:usf:completion-proof-bundle:1" as const,
    status: "pass" as const,
    stage: "completion-proof" as const,
    disposition: "verified-no-change" as const,
    evidence,
    proof,
  };
  return Object.freeze({ ...bundleDraft, bundleDigest: canonicalDigest(bundleDraft, { rejectAbsolutePaths: true }) });
}

interface WorkCompletionPublicationMemberCore {
  readonly ordinal: number;
  readonly workIri: string;
  readonly realisationReceiptIri: string;
  readonly realisationDigest: string;
  readonly evidenceIri: string;
  readonly evidenceDigest: string;
  readonly proofResultIri: string;
  readonly proofDigest: string;
  readonly realisationBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly candidateDigest: string;
  readonly policyDigest: string;
  readonly publicationIntentDigest: string;
}

export interface WorkCompletionPublicationMemberV1 extends WorkCompletionPublicationMemberCore {}

export interface WorkCompletionPublicationMemberV2 extends WorkCompletionPublicationMemberCore {
  readonly manifestPath: string;
  readonly manifestDigest: string;
}

export type WorkCompletionPublicationMember = WorkCompletionPublicationMemberV1 | WorkCompletionPublicationMemberV2;

export interface WorkCompletionPublicationOperation {
  readonly ordinal: number;
  readonly kind: "add";
  readonly sourcePath: string;
  readonly line: string;
}

export interface WorkCompletionAuthorityDependency {
  readonly kind: "schema" | "tool";
  readonly path: string;
  readonly digest: string;
}

export interface CompletionPublicationSnapshotMember {
  readonly work: string;
  readonly originalBasisDigest: string;
  readonly candidateDigest: string;
  readonly proofBundleDigest: string;
}

export interface CompletionPublicationSnapshot {
  readonly schema: "urn:usf:completion-publication-snapshot:1";
  readonly profile: string;
  readonly manifestPath: string;
  readonly publicationIntentDigest: string;
  readonly authorityDependencyDigest: string;
  readonly sourcePath: string;
  readonly receiptPath: string;
  readonly receiptDigest: string;
  readonly members: readonly CompletionPublicationSnapshotMember[];
  readonly files: readonly Readonly<{
    path: string;
    digest: string;
    byteLength: number;
    sourcePath?: string;
    sourceMode?: number;
    role: "authority-input" | "expected-receipt" | "proof-bundle" | "source-postimage" | "source-preimage";
  }>[];
}


interface WorkCompletionPublicationReceiptCore {
  readonly status: "verified";
  readonly algorithmIri: string;
  readonly algorithmVersion: "1";
  readonly algorithmResourceDigest: string;
  readonly publicationPolicyIri: string;
  readonly publicationPolicyDigest: string;
  readonly publicationIntentDigest: string;
  readonly targetGraphIri: string;
  readonly semanticSourcePath: string;
  readonly publicationReceiptPath: string;
  readonly profileIri: string;
  readonly profileVersion: string;
  readonly manifestPath: string;
  readonly authorityDependencies: readonly WorkCompletionAuthorityDependency[];
  readonly authorityDependencyDigest: string;
  readonly baseSourceDigest: string;
  readonly resultingSourceDigest: string;
  readonly baseSemanticDigest: string;
  readonly resultingSemanticDigest: string;
  readonly memberCount: number;
  readonly members: readonly WorkCompletionPublicationMember[];
  readonly operations: readonly WorkCompletionPublicationOperation[];
  readonly deltaDigest: string;
  readonly validationResultDigest: string;
  readonly nonClaims: readonly string[];
  readonly receiptDigest: string;
}

export interface WorkCompletionPublicationReceiptV1 extends WorkCompletionPublicationReceiptCore {
  readonly schema: "urn:usf:work-completion-publication-receipt:1";
  readonly manifestDigest: string;
  readonly members: readonly WorkCompletionPublicationMemberV1[];
}

export interface WorkCompletionPublicationReceiptV2 extends WorkCompletionPublicationReceiptCore {
  readonly schema: "urn:usf:work-completion-publication-receipt:2";
  readonly cohortManifestDigest: string;
  readonly members: readonly WorkCompletionPublicationMemberV2[];
}

export type WorkCompletionPublicationReceipt = WorkCompletionPublicationReceiptV1 | WorkCompletionPublicationReceiptV2;

export interface CompletionMemberBasis {
  readonly packet: WorkPacket;
  readonly basis: RealisationBasis;
}

export type ReadCompletionMemberBasis = (workIri: string) => CompletionMemberBasis;

function isV2PublicationReceiptSchema(authority: NoChangeCompletionAuthority): boolean {
  return authority.publicationReceiptSchemaIri === "urn:usf:schema:work-completion-publication-receipt:2";
}

function isV2PublicationReceipt(receipt: WorkCompletionPublicationReceipt): receipt is WorkCompletionPublicationReceiptV2 {
  return receipt.schema === "urn:usf:work-completion-publication-receipt:2";
}

function memberManifestTuples(members: readonly WorkCompletionPublicationMemberV2[]): readonly Readonly<{
  ordinal: number;
  workIri: string;
  manifestPath: string;
  manifestDigest: string;
}>[] {
  return Object.freeze(members.map(({ ordinal, workIri, manifestPath, manifestDigest }) =>
    Object.freeze({ ordinal, workIri, manifestPath, manifestDigest })));
}

function cohortManifestDigest(members: readonly WorkCompletionPublicationMemberV2[]): string {
  return canonicalDigest(memberManifestTuples(members), { rejectAbsolutePaths: true });
}

export function createWorkCompletionPublicationReceipt(input: Readonly<{
  authority: NoChangeCompletionAuthority;
  publicationIntentDigest: string;
  profileIri: string;
  profileVersion: string;
  manifestPath: string;
  manifestDigest: string;
  authorityDependencies: readonly WorkCompletionAuthorityDependency[];
  baseSourceDigest: string;
  resultingSourceDigest: string;
  baseSemanticDigest: string;
  resultingSemanticDigest: string;
  members: readonly WorkCompletionPublicationMember[];
  operations: readonly WorkCompletionPublicationOperation[];
}>): WorkCompletionPublicationReceipt {
  const v2 = isV2PublicationReceiptSchema(input.authority);
  if ((v2 && input.authority.publicationReceiptRecordSchema !== "urn:usf:work-completion-publication-receipt:2")
    || (!v2 && input.authority.publicationReceiptRecordSchema !== "urn:usf:work-completion-publication-receipt:1")) {
    throw new Error("WORK_COMPLETION_PUBLICATION_RECEIPT_SCHEMA_INVALID");
  }
  const v2Members = v2 ? input.members.map((member) => {
    if (!("manifestPath" in member) || !("manifestDigest" in member)
      || parseRepositoryPath(member.manifestPath, "file") === null || !digestPattern.test(member.manifestDigest)) {
      throw new Error("WORK_COMPLETION_COHORT_MEMBER_MANIFEST_INVALID");
    }
    return Object.freeze({ ...member }) as WorkCompletionPublicationMemberV2;
  }) : undefined;
  if (v2 && (new Set(v2Members!.map((member) => member.workIri)).size !== v2Members!.length
    || canonicalJson(v2Members!.map((member) => member.ordinal)) !== canonicalJson(v2Members!.map((_, index) => index + 1)))) {
    throw new Error("WORK_COMPLETION_COHORT_MEMBER_ORDER_INVALID");
  }
  const draft: Omit<WorkCompletionPublicationReceiptCore, "receiptDigest" | "members"> & { readonly members: readonly WorkCompletionPublicationMember[] } = {
    status: "verified",
    algorithmIri: input.authority.publicationAlgorithmIri,
    algorithmVersion: "1",
    algorithmResourceDigest: input.authority.publicationAlgorithmDigest,
    publicationPolicyIri: input.authority.policy.iri,
    publicationPolicyDigest: input.authority.policy.resourceDigest,
    publicationIntentDigest: input.publicationIntentDigest,
    targetGraphIri: input.authority.targetGraphIri,
    semanticSourcePath: input.authority.sourcePath,
    publicationReceiptPath: `${input.authority.receiptRoot}${input.publicationIntentDigest.slice("sha256:".length)}.json`,
    profileIri: input.profileIri,
    profileVersion: input.profileVersion,
    manifestPath: input.manifestPath,
    authorityDependencies: Object.freeze(input.authorityDependencies.map((dependency) => Object.freeze({ ...dependency }))),
    authorityDependencyDigest: canonicalDigest(input.authorityDependencies, { rejectAbsolutePaths: true }),
    baseSourceDigest: input.baseSourceDigest,
    resultingSourceDigest: input.resultingSourceDigest,
    baseSemanticDigest: input.baseSemanticDigest,
    resultingSemanticDigest: input.resultingSemanticDigest,
    memberCount: input.members.length,
    members: Object.freeze(input.members.map((member) => Object.freeze({ ...member }))),
    operations: Object.freeze(input.operations.map((operation) => Object.freeze({ ...operation }))),
    deltaDigest: canonicalDigest(input.operations, { rejectAbsolutePaths: true }),
    validationResultDigest: canonicalDigest({
      members: input.members.map(({ workIri, realisationDigest, evidenceDigest, proofDigest }) => ({ workIri, realisationDigest, evidenceDigest, proofDigest })),
      ...(v2 ? { cohortManifestDigest: cohortManifestDigest(v2Members!) } : {}),
      operationCount: input.operations.length,
      authorityDependencyDigest: canonicalDigest(input.authorityDependencies, { rejectAbsolutePaths: true }),
      resultingSemanticDigest: input.resultingSemanticDigest,
    }, { rejectAbsolutePaths: true }),
    nonClaims: workCompletionNonClaims,
  };
  if (v2) {
    const v2Draft: Omit<WorkCompletionPublicationReceiptV2, "receiptDigest"> = {
      ...draft,
      schema: "urn:usf:work-completion-publication-receipt:2",
      cohortManifestDigest: cohortManifestDigest(v2Members!),
      members: Object.freeze(v2Members!),
    };
    return Object.freeze({ ...v2Draft, receiptDigest: canonicalDigest(v2Draft, { rejectAbsolutePaths: true }) });
  }
  const v1Draft: Omit<WorkCompletionPublicationReceiptV1, "receiptDigest"> = {
    ...draft,
    schema: "urn:usf:work-completion-publication-receipt:1",
    manifestDigest: input.manifestDigest,
    members: Object.freeze(input.members.map((member) => Object.freeze({ ...member }) as WorkCompletionPublicationMemberV1)),
  };
  return Object.freeze({ ...v1Draft, receiptDigest: canonicalDigest(v1Draft, { rejectAbsolutePaths: true }) });
}

export function completionPublicationIntentDigest(
  bundles: readonly CompletionProofBundle[],
  profileIri: string,
  manifestPath: string,
  authority: NoChangeCompletionAuthority,
): string {
  if (isV2PublicationReceiptSchema(authority)) {
    const members = bundles.map((bundle, index) => Object.freeze({
      ordinal: index + 1,
      workIri: bundle.evidence.workIri,
      manifestPath: bundle.evidence.manifestPath,
      manifestDigest: bundle.evidence.manifestDigest,
    }));
    if (new Set(members.map((member) => member.workIri)).size !== members.length
      || members.some((member) => parseRepositoryPath(member.manifestPath, "file") === null || !digestPattern.test(member.manifestDigest))) {
      throw new Error("WORK_COMPLETION_COHORT_INTENT_MEMBERS_INVALID");
    }
    return canonicalDigest({
      schema: "urn:usf:work-completion-publication-receipt:2",
      members,
      cohortManifestDigest: canonicalDigest(members, { rejectAbsolutePaths: true }),
      bundles: bundles.map((bundle) => ({ workIri: bundle.evidence.workIri, bundleDigest: bundle.bundleDigest })),
      profileIri,
      manifestPath,
      publicationPolicyIri: authority.policy.iri,
      publicationPolicyDigest: authority.policy.resourceDigest,
      targetGraphIri: authority.targetGraphIri,
      semanticSourcePath: authority.sourcePath,
    }, { rejectAbsolutePaths: true });
  }
  return canonicalDigest({
    bundles: bundles.map((bundle) => ({ workIri: bundle.evidence.workIri, bundleDigest: bundle.bundleDigest })),
    profileIri,
    manifestPath,
    publicationPolicyIri: authority.policy.iri,
    publicationPolicyDigest: authority.policy.resourceDigest,
    targetGraphIri: authority.targetGraphIri,
    semanticSourcePath: authority.sourcePath,
  }, { rejectAbsolutePaths: true });
}

export function workCompletionRecordLines(
  bundle: CompletionProofBundle,
  authority: NoChangeCompletionAuthority,
  publicationIntentDigest: string,
): { readonly lines: readonly string[]; readonly member: Omit<WorkCompletionPublicationMember, "ordinal"> } {
  const quad = (subject: string, name: string, object: string, objectKind: "iri" | "literal"): string =>
    canonicalQuadLine({ subject, predicate: predicate(name), object, objectKind, graph: authority.targetGraphIri, canonical: "" });
  const evidence = bundle.evidence;
  const proof = bundle.proof;
  const realisationSeed = canonicalDigest({
    workIri: evidence.workIri,
    realisationBasisDigest: evidence.realisationBasisDigest,
    scopedDependencyDigest: evidence.scopedDependencyDigest,
    candidateDigest: evidence.candidateDigest,
    validationResultDigest: evidence.validationResultDigest,
    publicationIntentDigest,
  });
  const realisationReceiptIri = `urn:usf:receipt:no-change-realisation:${realisationSeed.slice("sha256:".length)}`;
  const realisationDraft = {
    schema: authority.realisationReceiptSchemaIri,
    state: "accepted-no-change",
    disposition: "verified-no-change",
    workIri: evidence.workIri,
    profileIri: evidence.profileIri,
    manifestPath: evidence.manifestPath,
    realisationBasisDigest: evidence.realisationBasisDigest,
    scopedDependencyDigest: evidence.scopedDependencyDigest,
    candidateDigest: evidence.candidateDigest,
    workspaceIdentityDigest: evidence.workspaceIdentityDigest,
    candidateTreeDigest: evidence.candidateTreeDigest,
    lineageDigest: evidence.lineageDigest,
    byteDeltaDigest: evidence.byteDeltaDigest,
    fileModeDigest: evidence.fileModeDigest,
    writeSetDigest: evidence.writeSetDigest,
    validationResultDigest: evidence.validationResultDigest,
    publicationPolicyIri: authority.policy.iri,
    publicationPolicyDigest: authority.policy.resourceDigest,
    publicationIntentDigest,
    ...(authority.semanticDependencies.length === 0
      ? {} : { semanticDependencies: authority.semanticDependencies }),
  };
  const realisationDigest = canonicalDigest(realisationDraft, { rejectAbsolutePaths: true });
  const lines = [
    quad(realisationReceiptIri, "type", authority.realisationReceiptType, "iri"),
    quad(realisationReceiptIri, "schema", authority.realisationReceiptSchemaIri, "iri"),
    quad(realisationReceiptIri, "state", "accepted-no-change", "literal"),
    quad(realisationReceiptIri, "disposition", "verified-no-change", "literal"),
    quad(realisationReceiptIri, "forWork", evidence.workIri, "iri"),
    quad(realisationReceiptIri, "authorityProfile", evidence.profileIri, "iri"),
    quad(realisationReceiptIri, "authorityManifestPath", evidence.manifestPath, "literal"),
    quad(realisationReceiptIri, "realisationBasisDigest", evidence.realisationBasisDigest, "literal"),
    quad(realisationReceiptIri, "scopedDependencyDigest", evidence.scopedDependencyDigest, "literal"),
    quad(realisationReceiptIri, "candidateDigest", evidence.candidateDigest, "literal"),
    quad(realisationReceiptIri, "workspaceIdentityDigest", evidence.workspaceIdentityDigest, "literal"),
    quad(realisationReceiptIri, "candidateTreeDigest", evidence.candidateTreeDigest, "literal"),
    quad(realisationReceiptIri, "lineageDigest", evidence.lineageDigest, "literal"),
    quad(realisationReceiptIri, "byteDeltaDigest", evidence.byteDeltaDigest, "literal"),
    quad(realisationReceiptIri, "fileModeDigest", evidence.fileModeDigest, "literal"),
    quad(realisationReceiptIri, "writeSetDigest", evidence.writeSetDigest, "literal"),
    quad(realisationReceiptIri, "validationResultDigest", evidence.validationResultDigest, "literal"),
    quad(realisationReceiptIri, "publicationPolicy", authority.policy.iri, "iri"),
    quad(realisationReceiptIri, "publicationPolicyDigest", authority.policy.resourceDigest, "literal"),
    quad(realisationReceiptIri, "publicationIntentDigest", publicationIntentDigest, "literal"),
    ...authority.semanticDependencies.map((dependency) =>
      quad(realisationReceiptIri, "semanticDependency", dependency, "iri")),
    quad(realisationReceiptIri, "contentDigest", realisationDigest, "literal"),
    quad(evidence.evidenceIri, "type", "urn:usf:type:Evidence", "iri"),
    quad(evidence.evidenceIri, "forWork", evidence.workIri, "iri"),
    quad(evidence.evidenceIri, "satisfiesEvidenceRequirement", evidence.evidenceRequirementIri, "iri"),
    ...evidence.validationResults.map((validation) => quad(evidence.evidenceIri, "validationObligation", validation.obligationIri, "iri")),
    quad(evidence.evidenceIri, "noChangeRealisationReceipt", realisationReceiptIri, "iri"),
    quad(evidence.evidenceIri, "realisationDigest", realisationDigest, "literal"),
    quad(evidence.evidenceIri, "realisationBasisDigest", evidence.realisationBasisDigest, "literal"),
    quad(evidence.evidenceIri, "scopedDependencyDigest", evidence.scopedDependencyDigest, "literal"),
    quad(evidence.evidenceIri, "candidateDigest", evidence.candidateDigest, "literal"),
    quad(evidence.evidenceIri, "validationResultDigest", evidence.validationResultDigest, "literal"),
    quad(evidence.evidenceIri, "publicationPolicy", authority.policy.iri, "iri"),
    quad(evidence.evidenceIri, "contentDigest", evidence.contentDigest, "literal"),
    quad(proof.proofResultIri, "type", "urn:usf:type:ProofResult", "iri"),
    quad(proof.proofResultIri, "forWork", proof.workIri, "iri"),
    quad(proof.proofResultIri, "forObligation", proof.obligationIri, "iri"),
    quad(proof.proofResultIri, "algorithm", proof.algorithmIri, "iri"),
    quad(proof.proofResultIri, "evidence", evidence.evidenceIri, "iri"),
    quad(proof.proofResultIri, "evidenceDigest", proof.evidenceDigest, "literal"),
    quad(proof.proofResultIri, "noChangeRealisationReceipt", realisationReceiptIri, "iri"),
    quad(proof.proofResultIri, "realisationDigest", realisationDigest, "literal"),
    quad(proof.proofResultIri, "realisationBasisDigest", proof.realisationBasisDigest, "literal"),
    quad(proof.proofResultIri, "scopedDependencyDigest", proof.scopedDependencyDigest, "literal"),
    quad(proof.proofResultIri, "candidateDigest", proof.candidateDigest, "literal"),
    quad(proof.proofResultIri, "validationResultDigest", proof.validationResultDigest, "literal"),
    quad(proof.proofResultIri, "outcome", "pass", "literal"),
    quad(proof.proofResultIri, "contentDigest", proof.contentDigest, "literal"),
  ].sort();
  return Object.freeze({
    lines: Object.freeze(lines),
    member: Object.freeze({
      workIri: evidence.workIri,
      realisationReceiptIri,
      realisationDigest,
      evidenceIri: evidence.evidenceIri,
      evidenceDigest: evidence.contentDigest,
      proofResultIri: proof.proofResultIri,
      proofDigest: proof.contentDigest,
      realisationBasisDigest: evidence.realisationBasisDigest,
      scopedDependencyDigest: evidence.scopedDependencyDigest,
      candidateDigest: evidence.candidateDigest,
      policyDigest: authority.policy.resourceDigest,
      publicationIntentDigest,
      ...(isV2PublicationReceiptSchema(authority)
        ? { manifestPath: evidence.manifestPath, manifestDigest: evidence.manifestDigest }
        : {}),
    }),
  });
}

export function validateCompletionEvidenceShape(value: unknown): asserts value is CompletionEvidenceCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORK_COMPLETION_EVIDENCE_SHAPE_INVALID");
  const evidence = value as CompletionEvidenceCandidate;
  const expected = ["schema", "status", "stage", "disposition", "algorithmIri", "algorithmVersion", "algorithmResourceDigest", "workIri", "contractIri", "profileIri", "profileVersion", "manifestPath", "manifestDigest", "evidenceIri", "evidenceRequirementIri", "evidenceRequirementDigest", "realisationBasisDigest", "scopedDependencyDigest", "policyIri", "policyDigest", "realisationAlgorithmIri", "realisationAlgorithmDigest", "candidateDigest", "workspaceIdentityDigest", "candidateTreeDigest", "lineageDigest", "byteDeltaDigest", "fileModeDigest", "writeSetDigest", "validationResults", "validationResultDigest", "contentDigest"].sort();
  if (canonicalJson(Object.keys(evidence).sort()) !== canonicalJson(expected) || evidence.schema !== "urn:usf:completion-evidence-candidate:1"
    || evidence.status !== "candidate" || evidence.stage !== "completion-evidence" || evidence.disposition !== "verified-no-change"
    || !Array.isArray(evidence.validationResults) || evidence.validationResults.length < 1) throw new Error("WORK_COMPLETION_EVIDENCE_SHAPE_INVALID");
  for (const digest of [evidence.algorithmResourceDigest, evidence.manifestDigest, evidence.evidenceRequirementDigest, evidence.realisationBasisDigest, evidence.scopedDependencyDigest, evidence.policyDigest, evidence.realisationAlgorithmDigest, evidence.candidateDigest, evidence.workspaceIdentityDigest, evidence.candidateTreeDigest, evidence.lineageDigest, evidence.byteDeltaDigest, evidence.fileModeDigest, evidence.writeSetDigest, evidence.validationResultDigest, evidence.contentDigest]) assertDigest(digest, "WORK_COMPLETION_EVIDENCE_DIGEST_INVALID");
  const { contentDigest, ...draft } = evidence;
  if (contentDigest !== canonicalDigest(draft, { rejectAbsolutePaths: true })) throw new Error("WORK_COMPLETION_EVIDENCE_DIGEST_INVALID");
}

export function validateCompletionBundleShape(value: unknown): asserts value is CompletionProofBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORK_COMPLETION_BUNDLE_SHAPE_INVALID");
  const bundle = value as CompletionProofBundle;
  if (canonicalJson(Object.keys(bundle).sort()) !== canonicalJson(["schema", "status", "stage", "disposition", "evidence", "proof", "bundleDigest"].sort())
    || bundle.schema !== "urn:usf:completion-proof-bundle:1" || bundle.status !== "pass" || bundle.stage !== "completion-proof"
    || bundle.disposition !== "verified-no-change" || !bundle.proof || typeof bundle.proof !== "object" || Array.isArray(bundle.proof)) throw new Error("WORK_COMPLETION_BUNDLE_SHAPE_INVALID");
  validateCompletionEvidenceShape(bundle.evidence);
  const proofKeys = ["proofResultIri", "workIri", "obligationIri", "obligationDigest", "algorithmIri", "algorithmResourceDigest", "evidenceDigest", "realisationBasisDigest", "scopedDependencyDigest", "candidateDigest", "validationResultDigest", "outcome", "contentDigest"].sort();
  if (canonicalJson(Object.keys(bundle.proof).sort()) !== canonicalJson(proofKeys) || bundle.proof.outcome !== "pass") throw new Error("WORK_COMPLETION_PROOF_SHAPE_INVALID");
  const { contentDigest, ...proofDraft } = bundle.proof;
  if (contentDigest !== canonicalDigest(proofDraft, { rejectAbsolutePaths: true })) throw new Error("WORK_COMPLETION_PROOF_DIGEST_INVALID");
  const { bundleDigest, ...bundleDraft } = bundle;
  if (!digestPattern.test(bundleDigest) || bundleDigest !== canonicalDigest(bundleDraft, { rejectAbsolutePaths: true })) throw new Error("WORK_COMPLETION_BUNDLE_DIGEST_INVALID");
}

export function validateWorkCompletionReceiptShape(root: string, value: unknown, authority?: NoChangeCompletionAuthority): value is WorkCompletionPublicationReceipt {
  try {
    const schema = JSON.parse(readFileSync(resolve(root, authority?.publicationReceiptSchemaPath ?? "schemas/work-completion-publication-receipt.schema.json"), "utf8")) as unknown;
    return createJsonSchemaValidator<WorkCompletionPublicationReceipt>(schema).validate(value).valid;
  } catch {
    return false;
  }
}

export interface NoChangeCompletionRecordEvaluation {
  readonly verified: boolean;
  readonly realisationReceipt: string | null;
  readonly evidence: string | null;
  readonly proofResult: string | null;
  readonly reasonCodes: readonly string[];
  readonly dynamicResources: readonly string[];
  readonly authorityResources: readonly string[];
  readonly authoritySchemaPaths: readonly string[];
  readonly authorityToolPaths: readonly string[];
  readonly cohortMemberEvidence?: readonly Readonly<{
    workIri: string;
    realisationBasisDigest: string;
    scopedDependencyDigest: string;
    dynamicResources: readonly string[];
  }>[];
  readonly receiptDependency?: Readonly<{ key: string; digest: string; kind: "file" }>;
  readonly authenticatedPublication?: Readonly<{
    originalBasisDigest: string;
    publicationIntentDigest: string;
    receiptDigest: string;
    authorityDependencyDigest: string;
    sourceDigest: string;
  }>;
}

function typedSubjects(graph: SemanticGraph, type: string): string[] {
  return [...new Set(graph.quads
    .filter((entry) => entry.predicate === typePredicate && entry.objectKind === "iri" && entry.object === type)
    .map((entry) => entry.subject))].sort();
}

function exactRecordValue(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string | null {
  const values = objectsFor(graph, subject, predicate(name));
  return values.length === 1 && values[0]?.objectKind === kind ? values[0].object : null;
}

function exactRecordValues(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string[] | null {
  const values = objectsFor(graph, subject, predicate(name));
  if (values.some((entry) => entry.objectKind !== kind)) return null;
  const result = values.map((entry) => entry.object).sort();
  return new Set(result).size === result.length ? result : null;
}

function recordMatches(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal", value: string): boolean {
  return exactRecordValue(graph, subject, name, kind) === value;
}

function containedCompletionReceiptBytes(root: string, repositoryPath: string): Buffer {
  if (!/^evidence\/work-completion\/[0-9a-f]{64}\.json$/u.test(repositoryPath)) throw new Error("WORK_COMPLETION_RECEIPT_PATH_INVALID");
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, repositoryPath);
  const relation = relative(canonicalRoot, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new Error("WORK_COMPLETION_RECEIPT_PATH_ESCAPE");
  let cursor = canonicalRoot;
  for (const segment of repositoryPath.split("/")) {
    cursor = resolve(cursor, segment);
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink()) throw new Error("WORK_COMPLETION_RECEIPT_SYMLINK_REFUSED");
    if (cursor === absolute && (!entry.isFile() || entry.nlink !== 1 || entry.size > 4 * 1024 * 1024)) throw new Error("WORK_COMPLETION_RECEIPT_FILE_INVALID");
  }
  if (realpathSync(absolute) !== absolute) throw new Error("WORK_COMPLETION_RECEIPT_PATH_ESCAPE");
  const named = lstatSync(absolute);
  let descriptor: number;
  try { descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
  catch { throw new Error("WORK_COMPLETION_RECEIPT_FILE_INVALID"); }
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
      || opened.mode !== named.mode || opened.nlink !== 1 || opened.size !== named.size || opened.size > 4 * 1024 * 1024) {
      throw new Error("WORK_COMPLETION_RECEIPT_FILE_INVALID");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.uid !== opened.uid || after.mode !== opened.mode
      || after.nlink !== opened.nlink || after.size !== opened.size || bytes.byteLength !== opened.size) {
      throw new Error("WORK_COMPLETION_RECEIPT_FILE_INVALID");
    }
    return bytes;
  } finally { closeSync(descriptor); }
}

function withoutReceiptDigest(receipt: WorkCompletionPublicationReceipt): Record<string, unknown> {
  const { receiptDigest: _ignored, ...draft } = receipt;
  return draft;
}

function graphResourceLines(graph: SemanticGraph, subjects: readonly string[]): string[] {
  const selected = new Set(subjects);
  return graph.quads.filter((entry) => selected.has(entry.subject)).map(canonicalQuadLine).sort();
}

function readCompletionReceipt(
  graph: SemanticGraph,
  intentDigest: string,
  authority: NoChangeCompletionAuthority,
): { receipt: WorkCompletionPublicationReceipt; path: string; bytes: Buffer } {
  const path = `${authority.receiptRoot}${intentDigest.slice("sha256:".length)}.json`;
  const bytes = containedCompletionReceiptBytes(graph.repositoryRoot, path);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("WORK_COMPLETION_RECEIPT_JSON_INVALID"); }
  if (!validateWorkCompletionReceiptShape(graph.repositoryRoot, value, authority)) throw new Error("WORK_COMPLETION_RECEIPT_SCHEMA_INVALID");
  const receipt = value as WorkCompletionPublicationReceipt;
  const v2 = isV2PublicationReceipt(receipt);
  if ((isV2PublicationReceiptSchema(authority) !== v2)
    || receipt.schema !== authority.publicationReceiptRecordSchema) {
    throw new Error("WORK_COMPLETION_RECEIPT_SCHEMA_INVALID");
  }
  if (`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n` !== bytes.toString("utf8")
    || canonicalDigest(withoutReceiptDigest(receipt), { rejectAbsolutePaths: true }) !== receipt.receiptDigest
    || receipt.publicationIntentDigest !== intentDigest || receipt.publicationReceiptPath !== path
    || receipt.memberCount !== receipt.members.length
    || receipt.members.some((member, index) => member.ordinal !== index + 1 || member.publicationIntentDigest !== intentDigest)
    || receipt.operations.some((operation, index) => operation.ordinal !== index + 1 || operation.sourcePath !== authority.sourcePath)
    || canonicalDigest(receipt.authorityDependencies, { rejectAbsolutePaths: true }) !== receipt.authorityDependencyDigest
    || canonicalDigest(receipt.operations, { rejectAbsolutePaths: true }) !== receipt.deltaDigest
    || canonicalDigest({
      members: receipt.members.map(({ workIri, realisationDigest, evidenceDigest, proofDigest }) => ({ workIri, realisationDigest, evidenceDigest, proofDigest })),
      ...(v2 ? { cohortManifestDigest: receipt.cohortManifestDigest } : {}),
      operationCount: receipt.operations.length,
      authorityDependencyDigest: receipt.authorityDependencyDigest,
      resultingSemanticDigest: receipt.resultingSemanticDigest,
    }, { rejectAbsolutePaths: true }) !== receipt.validationResultDigest
    || (v2 && (new Set(receipt.members.map((member) => member.workIri)).size !== receipt.members.length
      || receipt.members.some((member) => parseRepositoryPath(member.manifestPath, "file") === null || !digestPattern.test(member.manifestDigest))
      || cohortManifestDigest(receipt.members) !== receipt.cohortManifestDigest))) {
    throw new Error("WORK_COMPLETION_RECEIPT_DIGEST_INVALID");
  }
  const operationLines = receipt.operations.map(({ line }) => line);
  const parsed = parseStrictNQuads(`${operationLines.join("\n")}\n`, authority.targetGraphIri, 4_096);
  if (parsed.some((entry, index) => canonicalQuadLine(entry) !== operationLines[index]) || new Set(operationLines).size !== operationLines.length) {
    throw new Error("WORK_COMPLETION_RECEIPT_OPERATION_INVALID");
  }
  const source = readFileSync(resolve(graph.repositoryRoot, authority.sourcePath), "utf8");
  const currentLines = new Set(source.split("\n").filter((line) => line.length > 0));
  if (operationLines.some((line) => !currentLines.has(line))) throw new Error("WORK_COMPLETION_RECEIPT_OPERATION_MISSING");
  return { receipt, path, bytes };
}

function noChangeAuthorityResources(authority: NoChangeCompletionAuthority): string[] {
  return [...new Set([
    authority.policy.iri,
    authority.policy.algorithmIri,
    authority.evidenceAlgorithmIri,
    authority.proofAlgorithmIri,
    authority.publicationAlgorithmIri,
    authority.completionRuleIri,
    ...authority.commands,
    authority.workspaceSchemaIri,
    authority.realisationResultSchemaIri,
    authority.realisationReceiptSchemaIri,
    authority.evidenceSchemaIri,
    authority.proofBundleSchemaIri,
    authority.publicationReceiptSchemaIri,
    authority.publicationResultSchemaIri,
  ])].sort();
}

/**
 * Evaluate only the copy-on-write no-change completion protocol. Historical
 * records for another basis, profile, policy or validation result are retained
 * in the graph but deliberately excluded from current candidate selection.
 */
export function evaluateNoChangeCompletionRecords(
  graph: SemanticGraph,
  packet: WorkPacket,
  basis: RealisationBasis,
  readMember?: ReadCompletionMemberBasis,
): NoChangeCompletionRecordEvaluation {
  return evaluateNoChangeCompletionRecordsLocal(graph, packet, basis, readMember, true);
}

function evaluateNoChangeCompletionRecordsLocal(
  graph: SemanticGraph,
  packet: WorkPacket,
  basis: RealisationBasis,
  readMember: ReadCompletionMemberBasis | undefined,
  authenticateCohort: boolean,
): NoChangeCompletionRecordEvaluation {
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  const profileIri = packet.decisionBoundary.root;
  const profileVersion = packet.decisionBoundary.profileVersion;
  const completionAuthority = packet.realisationAuthority;
  const requirement = completionAuthority?.completionEvidenceRequirement;
  const obligation = completionAuthority?.completionProofObligation;
  const validations = [...(completionAuthority?.completionValidationObligations ?? [])].sort();
  const authorityResources = noChangeAuthorityResources(authority);
  const reasons: string[] = [];
  const resources: string[] = [];
  const finish = (input: Readonly<{
    realisationReceipt?: string | null;
    evidence?: string | null;
    proofResult?: string | null;
    receiptDependency?: Readonly<{ key: string; digest: string; kind: "file" }>;
    authenticatedPublication?: NoChangeCompletionRecordEvaluation["authenticatedPublication"];
    cohortMemberEvidence?: NoChangeCompletionRecordEvaluation["cohortMemberEvidence"];
  }> = {}): NoChangeCompletionRecordEvaluation => {
    const reasonCodes = [...new Set(reasons)].sort();
    return Object.freeze({
      verified: reasonCodes.length === 0,
      realisationReceipt: input.realisationReceipt ?? null,
      evidence: input.evidence ?? null,
      proofResult: input.proofResult ?? null,
      reasonCodes: Object.freeze(reasonCodes),
      dynamicResources: Object.freeze([...new Set(resources)].sort()),
      authorityResources: Object.freeze(authorityResources),
      authoritySchemaPaths: authority.schemaPaths,
      authorityToolPaths: authority.toolPaths,
      ...(input.receiptDependency === undefined ? {} : { receiptDependency: input.receiptDependency }),
      ...(input.authenticatedPublication === undefined ? {} : { authenticatedPublication: input.authenticatedPublication }),
      ...(input.cohortMemberEvidence === undefined ? {} : { cohortMemberEvidence: input.cohortMemberEvidence }),
    });
  };
  if (basis === undefined || packet.decisionBoundary.kind !== "realisation-profile" || profileIri === null || profileVersion === undefined
    || requirement === null || requirement === undefined || obligation === null || obligation === undefined || validations.length === 0) {
    reasons.push(`WORK_COMPLETION_AUTHORITY_INCOMPLETE:${packet.id}`);
    return finish();
  }

  const receiptCandidates = typedSubjects(graph, authority.realisationReceiptType).filter((subject) =>
    recordMatches(graph, subject, "forWork", "iri", packet.id)
    && recordMatches(graph, subject, "authorityProfile", "iri", profileIri)
    && recordMatches(graph, subject, "authorityManifestPath", "literal", basis.selection.manifestPath)
    && recordMatches(graph, subject, "realisationBasisDigest", "literal", basis.basisDigest)
    && recordMatches(graph, subject, "scopedDependencyDigest", "literal", basis.work.scopedDependencyDigest)
    && recordMatches(graph, subject, "publicationPolicy", "iri", authority.policy.iri)
    && recordMatches(graph, subject, "publicationPolicyDigest", "literal", authority.policy.resourceDigest));
  if (receiptCandidates.length === 0) {
    reasons.push(`WORK_COMPLETION_NO_CHANGE_RECEIPT_MISSING:${packet.id}`);
    return finish();
  }
  if (receiptCandidates.length > 1) {
    resources.push(...receiptCandidates);
    reasons.push(`WORK_COMPLETION_NO_CHANGE_RECEIPT_AMBIGUOUS:${packet.id}`);
    return finish();
  }
  const realisationReceipt = receiptCandidates[0] as string;
  resources.push(realisationReceipt);
  const realisationFields = {
    schema: exactRecordValue(graph, realisationReceipt, "schema", "iri"),
    state: exactRecordValue(graph, realisationReceipt, "state", "literal"),
    disposition: exactRecordValue(graph, realisationReceipt, "disposition", "literal"),
    workIri: exactRecordValue(graph, realisationReceipt, "forWork", "iri"),
    profileIri: exactRecordValue(graph, realisationReceipt, "authorityProfile", "iri"),
    manifestPath: exactRecordValue(graph, realisationReceipt, "authorityManifestPath", "literal"),
    realisationBasisDigest: exactRecordValue(graph, realisationReceipt, "realisationBasisDigest", "literal"),
    scopedDependencyDigest: exactRecordValue(graph, realisationReceipt, "scopedDependencyDigest", "literal"),
    candidateDigest: exactRecordValue(graph, realisationReceipt, "candidateDigest", "literal"),
    workspaceIdentityDigest: exactRecordValue(graph, realisationReceipt, "workspaceIdentityDigest", "literal"),
    candidateTreeDigest: exactRecordValue(graph, realisationReceipt, "candidateTreeDigest", "literal"),
    lineageDigest: exactRecordValue(graph, realisationReceipt, "lineageDigest", "literal"),
    byteDeltaDigest: exactRecordValue(graph, realisationReceipt, "byteDeltaDigest", "literal"),
    fileModeDigest: exactRecordValue(graph, realisationReceipt, "fileModeDigest", "literal"),
    writeSetDigest: exactRecordValue(graph, realisationReceipt, "writeSetDigest", "literal"),
    validationResultDigest: exactRecordValue(graph, realisationReceipt, "validationResultDigest", "literal"),
    publicationPolicyIri: exactRecordValue(graph, realisationReceipt, "publicationPolicy", "iri"),
    publicationPolicyDigest: exactRecordValue(graph, realisationReceipt, "publicationPolicyDigest", "literal"),
    publicationIntentDigest: exactRecordValue(graph, realisationReceipt, "publicationIntentDigest", "literal"),
    ...(authority.semanticDependencies.length === 0
      ? {} : { semanticDependencies: exactRecordValues(graph, realisationReceipt, "semanticDependency", "iri") }),
  };
  const realisationDigest = exactRecordValue(graph, realisationReceipt, "contentDigest", "literal");
  const requiredRealisationValues = Object.values(realisationFields);
  const scalarRealisationValues = requiredRealisationValues.filter((value): value is string => typeof value === "string");
  if (requiredRealisationValues.some((value) => value === null) || realisationDigest === null
    || realisationFields.schema !== authority.realisationReceiptSchemaIri
    || realisationFields.state !== "accepted-no-change" || realisationFields.disposition !== "verified-no-change"
    || realisationFields.workIri !== packet.id || realisationFields.profileIri !== profileIri
    || realisationFields.manifestPath !== basis.selection.manifestPath
    || realisationFields.realisationBasisDigest !== basis.basisDigest
    || realisationFields.scopedDependencyDigest !== basis.work.scopedDependencyDigest
    || realisationFields.publicationPolicyIri !== authority.policy.iri
    || realisationFields.publicationPolicyDigest !== authority.policy.resourceDigest
    || (authority.semanticDependencies.length > 0
      && !sameSet(realisationFields.semanticDependencies ?? [], authority.semanticDependencies))
    || !scalarRealisationValues.filter((value) => value.startsWith("sha256:"))
      .every((value) => digestPattern.test(value))
    || !digestPattern.test(realisationDigest)
    || canonicalDigest(realisationFields, { rejectAbsolutePaths: true }) !== realisationDigest) {
    reasons.push(`WORK_COMPLETION_NO_CHANGE_RECEIPT_INVALID:${realisationReceipt}`);
    return finish({ realisationReceipt });
  }

  const evidenceCandidates = typedSubjects(graph, "urn:usf:type:Evidence").filter((subject) =>
    recordMatches(graph, subject, "forWork", "iri", packet.id)
    && recordMatches(graph, subject, "satisfiesEvidenceRequirement", "iri", requirement)
    && recordMatches(graph, subject, "noChangeRealisationReceipt", "iri", realisationReceipt)
    && recordMatches(graph, subject, "realisationDigest", "literal", realisationDigest)
    && recordMatches(graph, subject, "realisationBasisDigest", "literal", basis.basisDigest)
    && recordMatches(graph, subject, "scopedDependencyDigest", "literal", basis.work.scopedDependencyDigest)
    && recordMatches(graph, subject, "candidateDigest", "literal", realisationFields.candidateDigest as string)
    && recordMatches(graph, subject, "validationResultDigest", "literal", realisationFields.validationResultDigest as string)
    && recordMatches(graph, subject, "publicationPolicy", "iri", authority.policy.iri));
  if (evidenceCandidates.length !== 1) {
    resources.push(...evidenceCandidates);
    reasons.push(evidenceCandidates.length === 0
      ? `WORK_COMPLETION_EVIDENCE_MISSING:${packet.id}`
      : `WORK_COMPLETION_EVIDENCE_AMBIGUOUS:${packet.id}`);
    return finish({ realisationReceipt });
  }
  const evidence = evidenceCandidates[0] as string;
  resources.push(evidence);
  const evidenceValidations = exactRecordValues(graph, evidence, "validationObligation", "iri");
  const evidenceDigest = exactRecordValue(graph, evidence, "contentDigest", "literal");
  if (evidenceValidations === null || !sameSet(evidenceValidations, validations) || evidenceDigest === null || !digestPattern.test(evidenceDigest)) {
    reasons.push(`WORK_COMPLETION_EVIDENCE_INVALID:${evidence}`);
    return finish({ realisationReceipt, evidence });
  }

  const proofCandidates = typedSubjects(graph, "urn:usf:type:ProofResult").filter((subject) =>
    recordMatches(graph, subject, "forWork", "iri", packet.id)
    && recordMatches(graph, subject, "forObligation", "iri", obligation)
    && recordMatches(graph, subject, "algorithm", "iri", authority.proofAlgorithmIri)
    && recordMatches(graph, subject, "evidence", "iri", evidence)
    && recordMatches(graph, subject, "evidenceDigest", "literal", evidenceDigest)
    && recordMatches(graph, subject, "noChangeRealisationReceipt", "iri", realisationReceipt)
    && recordMatches(graph, subject, "realisationDigest", "literal", realisationDigest)
    && recordMatches(graph, subject, "realisationBasisDigest", "literal", basis.basisDigest)
    && recordMatches(graph, subject, "scopedDependencyDigest", "literal", basis.work.scopedDependencyDigest)
    && recordMatches(graph, subject, "candidateDigest", "literal", realisationFields.candidateDigest as string)
    && recordMatches(graph, subject, "validationResultDigest", "literal", realisationFields.validationResultDigest as string)
    && recordMatches(graph, subject, "outcome", "literal", "pass"));
  if (proofCandidates.length !== 1) {
    resources.push(...proofCandidates);
    reasons.push(proofCandidates.length === 0
      ? `WORK_COMPLETION_PROOF_RESULT_MISSING:${packet.id}`
      : `WORK_COMPLETION_PROOF_RESULT_AMBIGUOUS:${packet.id}`);
    return finish({ realisationReceipt, evidence });
  }
  const proofResult = proofCandidates[0] as string;
  resources.push(proofResult);
  const proofDigest = exactRecordValue(graph, proofResult, "contentDigest", "literal");
  if (proofDigest === null || !digestPattern.test(proofDigest)) {
    reasons.push(`WORK_COMPLETION_PROOF_RESULT_INVALID:${proofResult}`);
    return finish({ realisationReceipt, evidence, proofResult });
  }

  try {
    const publicationIntentDigest = realisationFields.publicationIntentDigest as string;
    if (!digestPattern.test(publicationIntentDigest)) throw new Error("WORK_COMPLETION_INTENT_INVALID");
    const { receipt, path, bytes } = readCompletionReceipt(graph, publicationIntentDigest, authority);
    if (receipt.profileIri !== profileIri || receipt.profileVersion !== profileVersion
      || receipt.manifestPath !== basis.selection.manifestPath
      || (!isV2PublicationReceipt(receipt) && receipt.manifestDigest !== basis.selection.manifestDigest)
      || receipt.publicationPolicyIri !== authority.policy.iri || receipt.publicationPolicyDigest !== authority.policy.resourceDigest
      || receipt.algorithmIri !== authority.publicationAlgorithmIri || receipt.algorithmResourceDigest !== authority.publicationAlgorithmDigest
      || receipt.targetGraphIri !== authority.targetGraphIri || receipt.semanticSourcePath !== authority.sourcePath) {
      throw new Error("WORK_COMPLETION_RECEIPT_AUTHORITY_MISMATCH");
    }
    const currentAuthorityDependencies = workCompletionAuthorityDependencies(graph, authority);
    if (canonicalJson(receipt.authorityDependencies) !== canonicalJson(currentAuthorityDependencies)
      || receipt.authorityDependencyDigest !== canonicalDigest(currentAuthorityDependencies, { rejectAbsolutePaths: true })) {
      throw new Error("WORK_COMPLETION_RECEIPT_AUTHORITY_DEPENDENCY_STALE");
    }
    const matching = receipt.members.filter((member) => member.realisationReceiptIri === realisationReceipt);
    if (matching.length !== 1) throw new Error("WORK_COMPLETION_RECEIPT_MEMBER_INVALID");
    const member = matching[0] as WorkCompletionPublicationMember;
    if (member.workIri !== packet.id || member.realisationDigest !== realisationDigest
      || member.evidenceIri !== evidence || member.evidenceDigest !== evidenceDigest
      || member.proofResultIri !== proofResult || member.proofDigest !== proofDigest
      || member.realisationBasisDigest !== basis.basisDigest
      || member.scopedDependencyDigest !== basis.work.scopedDependencyDigest
      || member.candidateDigest !== realisationFields.candidateDigest
      || member.policyDigest !== authority.policy.resourceDigest
      || member.publicationIntentDigest !== publicationIntentDigest) {
      throw new Error("WORK_COMPLETION_RECEIPT_MEMBER_MISMATCH");
    }
    let cohortMemberEvidence: NoChangeCompletionRecordEvaluation["cohortMemberEvidence"];
    if (isV2PublicationReceipt(receipt) && authenticateCohort) {
      if (readMember === undefined) throw new Error("WORK_COMPLETION_COHORT_MEMBER_READER_REQUIRED");
      const cohortWorks = new Set(receipt.members.map((entry) => entry.workIri));
      if (receipt.members.some((entry) => objectValues(graph, entry.workIri, predicate("dependsOn")).some((dependency) => cohortWorks.has(dependency)))) {
        throw new Error("WORK_COMPLETION_COHORT_DEPENDENCY_INVALID");
      }
      const selfMember = receipt.members.find((entry) => entry.realisationReceiptIri === realisationReceipt);
      if (selfMember === undefined) throw new Error("WORK_COMPLETION_COHORT_SELF_MEMBER_INVALID");
      const cohortEvidence: Array<Readonly<{
        workIri: string;
        realisationBasisDigest: string;
        scopedDependencyDigest: string;
        dynamicResources: readonly string[];
      }>> = [];
      for (const expectedMember of receipt.members) {
        if (expectedMember.manifestPath !== basis.selection.manifestPath) {
          throw new Error("WORK_COMPLETION_COHORT_MANIFEST_SELECTION_INVALID");
        }
        if (expectedMember.workIri === packet.id) {
          if (expectedMember !== selfMember || expectedMember.realisationBasisDigest !== basis.basisDigest
            || expectedMember.scopedDependencyDigest !== basis.work.scopedDependencyDigest
            || expectedMember.manifestDigest !== basis.selection.manifestDigest
            || packet.eligibility?.activation.eligible !== true || packet.eligibility.dependencyReady !== true
            || packet.eligibility.construction.eligible !== true || packet.eligibility.construction.authority !== "active-permission"
            || packet.realisationAuthority?.permission?.activationState !== "urn:usf:contract-state:active") {
            throw new Error("WORK_COMPLETION_COHORT_SELF_MEMBER_MISMATCH");
          }
          cohortEvidence.push(Object.freeze({
            workIri: packet.id,
            realisationBasisDigest: basis.basisDigest,
            scopedDependencyDigest: basis.work.scopedDependencyDigest,
            dynamicResources: Object.freeze([realisationReceipt, evidence, proofResult].sort()),
          }));
          continue;
        }
        const sibling = readMember(expectedMember.workIri);
        if (sibling.packet.id !== expectedMember.workIri || sibling.packet.decisionBoundary.kind !== "realisation-profile"
          || sibling.packet.decisionBoundary.root !== profileIri || sibling.packet.decisionBoundary.profileVersion !== profileVersion
          || sibling.basis.selection.manifestPath !== basis.selection.manifestPath
          || sibling.basis.selection.manifestPath !== expectedMember.manifestPath
          || sibling.basis.selection.manifestDigest !== expectedMember.manifestDigest
          || sibling.packet.eligibility?.activation.eligible !== true || sibling.packet.eligibility.dependencyReady !== true
          || sibling.packet.eligibility.construction.eligible !== true || sibling.packet.eligibility.construction.authority !== "active-permission"
          || sibling.packet.realisationAuthority?.permission?.activationState !== "urn:usf:contract-state:active") {
          throw new Error("WORK_COMPLETION_COHORT_MEMBER_CONTEXT_INVALID");
        }
        const siblingEvaluation = evaluateNoChangeCompletionRecordsLocal(graph, sibling.packet, sibling.basis, readMember, false);
        const siblingPublication = siblingEvaluation.authenticatedPublication;
        if (!siblingEvaluation.verified || siblingEvaluation.realisationReceipt !== expectedMember.realisationReceiptIri
          || siblingPublication === undefined || siblingPublication.publicationIntentDigest !== receipt.publicationIntentDigest
          || siblingPublication.receiptDigest !== receipt.receiptDigest
          || siblingPublication.authorityDependencyDigest !== receipt.authorityDependencyDigest
          || sibling.basis.basisDigest !== expectedMember.realisationBasisDigest
          || sibling.basis.work.scopedDependencyDigest !== expectedMember.scopedDependencyDigest) {
          throw new Error("WORK_COMPLETION_COHORT_MEMBER_AUTHENTICATION_INVALID");
        }
        resources.push(...siblingEvaluation.dynamicResources);
        cohortEvidence.push(Object.freeze({
          workIri: expectedMember.workIri,
          realisationBasisDigest: sibling.basis.basisDigest,
          scopedDependencyDigest: sibling.basis.work.scopedDependencyDigest,
          dynamicResources: siblingEvaluation.dynamicResources,
        }));
      }
      cohortMemberEvidence = Object.freeze(cohortEvidence);
    }
    const subjectLines = receipt.operations.map(({ line }) => line).filter((line) => {
      const parsed = parseStrictNQuads(`${line}\n`, authority.targetGraphIri, 1)[0];
      return parsed !== undefined && [realisationReceipt, evidence, proofResult].includes(parsed.subject);
    }).sort();
    if (canonicalJson(subjectLines) !== canonicalJson(graphResourceLines(graph, [realisationReceipt, evidence, proofResult]))) {
      throw new Error("WORK_COMPLETION_RECEIPT_RESOURCE_MISMATCH");
    }
    return finish({
      realisationReceipt,
      evidence,
      proofResult,
      receiptDependency: Object.freeze({ key: path, digest: sha256(bytes), kind: "file" as const }),
      authenticatedPublication: Object.freeze({
        originalBasisDigest: member.realisationBasisDigest,
        publicationIntentDigest: receipt.publicationIntentDigest,
        receiptDigest: receipt.receiptDigest,
        authorityDependencyDigest: receipt.authorityDependencyDigest,
        sourceDigest: receipt.resultingSourceDigest,
      }),
      ...(cohortMemberEvidence === undefined ? {} : { cohortMemberEvidence }),
    });
  } catch {
    reasons.push(`WORK_COMPLETION_PUBLICATION_RECEIPT_INVALID:${realisationReceipt}`);
    return finish({ realisationReceipt, evidence, proofResult });
  }
}
