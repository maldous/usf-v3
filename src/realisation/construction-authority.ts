import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { parseRepositoryPath } from "../core/scope.ts";
import { objectValues, objectsFor, resourceDigest, type SemanticGraph } from "../graph/index.ts";
import { canonicalQuadLine, parseStrictNQuads, type Quad } from "../graph/nquads.ts";
import type { WorkPacket } from "../graph/work.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";

const predicate = (name: string): string => `urn:usf:predicate:${name}`;
const typePredicate = predicate("type");
const evidenceType = "urn:usf:type:Evidence";
const proofResultType = "urn:usf:type:ProofResult";
const grantType = "urn:usf:type:ConstructionAuthorityGrant";
const activeState = "urn:usf:contract-state:active";
const proofblockedState = "urn:usf:contract-state:proofblocked";
const policyIri = "urn:usf:publication-policy:construction-authority:1";
const derivationRuleIri = "urn:usf:rule:copy-on-write-construction-authority:1";
const evidenceAlgorithmIri = "urn:usf:algorithm:construction-evidence-normalization:1";
const proofAlgorithmIri = "urn:usf:proof-algorithm:semantic-construction-authority:1";
const publicationAlgorithmIri = "urn:usf:algorithm:copy-on-write-construction-authority-publication:1";
const targetGraphIri = "urn:usf:graph:integration";
const sourcePath = "graph/integration.nq";
const manifestPath = "graph/manifests/integration.json";
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export const constructionAuthorityConstants = Object.freeze({
  activeState,
  proofblockedState,
  policyIri,
  derivationRuleIri,
  evidenceAlgorithmIri,
  proofAlgorithmIri,
  publicationAlgorithmIri,
  targetGraphIri,
  sourcePath,
  manifestPath,
});

const policyType = "urn:usf:type:ConstructionAuthorityPublicationPolicy";

export interface ConstructionAuthorityDescriptor {
  readonly policyIri: string;
  readonly derivationRuleIri: string;
  readonly evidenceAlgorithmIri: string;
  readonly proofAlgorithmIri: string;
  readonly publicationAlgorithmIri: string;
  readonly targetGraphIri: string;
  readonly sourcePath: string;
  readonly manifestPath: string;
  readonly receiptRoot: string;
  readonly candidateRoot: string;
  readonly primaryMutationLockPath: string;
  readonly minimumBundleCount: number;
  readonly maximumBundleCount: number;
  readonly registeredCommands: readonly string[];
  readonly schemaPaths: readonly string[];
  readonly toolPaths: readonly string[];
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
}

const legacyConstructionAuthority: ConstructionAuthorityDescriptor = Object.freeze({
  policyIri,
  derivationRuleIri,
  evidenceAlgorithmIri,
  proofAlgorithmIri,
  publicationAlgorithmIri,
  targetGraphIri,
  sourcePath,
  manifestPath,
  receiptRoot: "evidence/construction-authority/",
  candidateRoot: ".usf/candidates/construction-authority/",
  primaryMutationLockPath: ".usf/locks/primary-mutation.lock",
  minimumBundleCount: 1,
  maximumBundleCount: 32,
  registeredCommands: Object.freeze([
    "urn:usf:command:evidence-construction:1",
    "urn:usf:command:prove-construction:1",
    "urn:usf:command:publish-construction-authority:1",
  ]),
  schemaPaths: Object.freeze([
    "schemas/construction-evidence-candidate.schema.json",
    "schemas/construction-proof-bundle.schema.json",
    "schemas/construction-authority-publication-receipt.schema.json",
    "schemas/construction-authority-publication-result.schema.json",
  ]),
  toolPaths: Object.freeze([]),
  evidenceSchemaIri: "urn:usf:schema:construction-evidence-candidate:1",
  evidenceSchemaPath: "schemas/construction-evidence-candidate.schema.json",
  proofBundleSchemaIri: "urn:usf:schema:construction-proof-bundle:1",
  proofBundleSchemaPath: "schemas/construction-proof-bundle.schema.json",
  publicationReceiptSchemaIri: "urn:usf:schema:construction-authority-publication-receipt:1",
  publicationReceiptSchemaPath: "schemas/construction-authority-publication-receipt.schema.json",
  publicationReceiptRecordSchema: "urn:usf:construction-authority-publication-receipt:1",
  publicationResultSchemaIri: "urn:usf:schema:construction-authority-publication-result:1",
  publicationResultSchemaPath: "schemas/construction-authority-publication-result.schema.json",
  publicationResultRecordSchema: "urn:usf:construction-authority-publication-result:1",
});

export interface ConstructionEvidenceCandidate {
  readonly schema: "urn:usf:construction-evidence-candidate:1";
  readonly status: "candidate";
  readonly stage: "construction-evidence";
  readonly algorithmIri: string;
  readonly algorithmVersion: "1";
  readonly algorithmResourceDigest: string;
  readonly workIri: string;
  readonly contractIri: string;
  readonly profileIri: string;
  readonly profileVersion: string;
  readonly manifestPath: string;
  readonly manifestDigest: string;
  readonly observedSemanticDigest: string;
  readonly evidenceIri: string;
  readonly evidenceRequirementIri: string;
  readonly evidenceRequirementDigest: string;
  readonly realisationBasisDigest: string;
  readonly packetCoreDigest: string;
  readonly scopedDependencyDigest: string;
  readonly observation: Readonly<{
    semanticTraceDigest: string;
    decisionBoundaryDigest: string;
    dependencySetDigest: string;
    scopeDigest: string;
    acceptanceDigest: string;
    constraintDigest: string;
    applicabilityDigest: string;
    stopConditionDigest: string;
  }>;
  readonly validation: Readonly<{ applicability: "required"; outcome: "pass"; resultDigest: string }>;
  readonly contentDigest: string;
}

export interface ConstructionProofResult {
  readonly proofResultIri: string;
  readonly workIri: string;
  readonly obligationIri: string;
  readonly obligationDigest: string;
  readonly algorithmIri: string;
  readonly algorithmResourceDigest: string;
  readonly evidenceDigest: string;
  readonly realisationBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly applicability: "required";
  readonly outcome: "pass";
  readonly reasonCodes: readonly [];
  readonly evaluationDigest: string;
  readonly contentDigest: string;
}

export interface ConstructionProofBundle {
  readonly schema: "urn:usf:construction-proof-bundle:1";
  readonly status: "candidate";
  readonly stage: "construction-proof";
  readonly evidence: ConstructionEvidenceCandidate;
  readonly proof: ConstructionProofResult;
  readonly bundleDigest: string;
}

export interface ConstructionAuthorityGrant {
  readonly workIri: string;
  readonly permissionIri: string;
  readonly profileIri: string;
  readonly manifestPath: string;
  readonly publicationPolicyIri: string;
  readonly evidenceIri: string;
  readonly evidenceDigest: string;
  readonly proofResultIri: string;
  readonly proofDigest: string;
  readonly realisationBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly publicationIntentDigest: string;
  readonly activationState: typeof activeState;
  readonly maximumThrough: string;
}

export interface ConstructionAuthorityReceiptMember {
  readonly ordinal: number;
  readonly workIri: string;
  readonly permissionIri: string;
  readonly maximumThrough: string;
  readonly authorityBasisDigest: string;
  readonly evidenceIri: string;
  readonly evidenceDigest: string;
  readonly proofResultIri: string;
  readonly proofDigest: string;
  readonly grantIri: string;
  readonly grantDigest: string;
  readonly publicationIntentDigest: string;
}

export interface ConstructionAuthorityPublicationReceipt {
  readonly schema: string;
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
  readonly manifestDigest: string;
  readonly baseSourceDigest: string;
  readonly resultingSourceDigest: string;
  readonly baseSemanticDigest: string;
  readonly resultingSemanticDigest: string;
  readonly memberCount: number;
  readonly members: readonly ConstructionAuthorityReceiptMember[];
  readonly operations: readonly Readonly<{ ordinal: number; kind: "add"; sourcePath: string; line: string }>[];
  readonly deltaDigest: string;
  readonly validationResultDigest: string;
  readonly nonClaims: readonly string[];
  readonly receiptDigest: string;
}

export interface ConstructionPublicationMemberInput {
  readonly bundle: ConstructionProofBundle;
  readonly permissionIri: string;
  readonly maximumThrough: string;
}

export interface GrantProjectionInput {
  readonly workIri: string;
  readonly permissionIri: string;
  readonly profileIri: string;
  readonly manifestPath: string;
  readonly evidenceRequirementIri: string;
  readonly proofObligationIri: string;
  readonly proofAlgorithmIri: string;
  readonly authorityBasisDigest: string;
  readonly maximumThrough: string;
}

export interface GrantProjection {
  readonly applicable: boolean;
  readonly active: boolean;
  readonly grantIri: string | null;
  readonly evidenceIri: string | null;
  readonly proofResultIri: string | null;
  readonly reasonCodes: readonly string[];
  readonly dynamicResources: readonly string[];
  readonly receiptDependency?: Readonly<{ key: string; digest: string; kind: "file" }>;
}

function exactValues(graph: SemanticGraph, subject: string, name: string, kind?: "iri" | "literal"): string[] {
  return objectsFor(graph, subject, predicate(name))
    .filter((quad) => kind === undefined || quad.objectKind === kind)
    .map((quad) => quad.object)
    .sort();
}

function oneValue(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string | null {
  const quads = objectsFor(graph, subject, predicate(name));
  if (quads.length !== 1 || quads[0]?.objectKind !== kind) return null;
  return quads[0].object;
}

function hasType(graph: SemanticGraph, subject: string, type: string): boolean {
  const quads = objectsFor(graph, subject, typePredicate);
  return quads.length === 1 && quads[0]?.objectKind === "iri" && quads[0].object === type;
}

function typedSubjects(graph: SemanticGraph, type: string): string[] {
  return [...new Set(graph.quads
    .filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri" && quad.object === type)
    .map((quad) => quad.subject))].sort();
}

function requiredValue(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string {
  const values = objectsFor(graph, subject, predicate(name));
  if (values.length !== 1 || values[0]?.objectKind !== kind) throw new Error(`CONSTRUCTION_AUTHORITY_${name.toUpperCase()}_INVALID`);
  return values[0].object;
}

function schemaBinding(graph: SemanticGraph, policy: string, name: string, schemaPaths: readonly string[]): Readonly<{ iri: string; path: string; recordSchema: string }> {
  const iri = requiredValue(graph, policy, name, "iri");
  if (!hasType(graph, iri, "urn:usf:type:SemanticRecordSchema") || requiredValue(graph, iri, "version", "literal") !== "1") {
    throw new Error(`CONSTRUCTION_AUTHORITY_${name.toUpperCase()}_INVALID`);
  }
  const path = requiredValue(graph, iri, "repositoryPath", "literal");
  if (parseRepositoryPath(path, "file") === null || !schemaPaths.includes(path)) {
    throw new Error(`CONSTRUCTION_AUTHORITY_${name.toUpperCase()}_PATH_INVALID`);
  }
  let recordSchema: unknown;
  try { recordSchema = (JSON.parse(readFileSync(resolve(graph.repositoryRoot, path), "utf8")) as { $id?: unknown }).$id; }
  catch { throw new Error(`CONSTRUCTION_AUTHORITY_${name.toUpperCase()}_SCHEMA_INVALID`); }
  if (typeof recordSchema !== "string" || !/^urn:[^<>\s]+$/u.test(recordSchema)) throw new Error(`CONSTRUCTION_AUTHORITY_${name.toUpperCase()}_SCHEMA_INVALID`);
  return Object.freeze({ iri, path, recordSchema });
}

export function deriveConstructionAuthority(
  graph: SemanticGraph,
  workIri: string,
  selectedManifestPath = (graph as SemanticGraph & { manifestPath?: string }).manifestPath,
): ConstructionAuthorityDescriptor {
  const policies = typedSubjects(graph, policyType).filter((candidate) =>
    objectsFor(graph, candidate, predicate("eligibleWork")).some((quad) => quad.objectKind === "iri" && quad.object === workIri));
  if (policies.length !== 1) throw new Error(policies.length === 0 ? "CONSTRUCTION_WORK_NOT_ELIGIBLE" : "CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS");
  const selectedPolicy = policies[0] as string;
  const requiredManifestPath = requiredValue(graph, selectedPolicy, "requiredManifestPath", "literal");
  const selectedSourcePath = requiredValue(graph, selectedPolicy, "targetSemanticSourcePath", "literal");
  const selectedTargetGraphIri = requiredValue(graph, selectedPolicy, "targetNamedGraph", "iri");
  const receiptRoot = requiredValue(graph, selectedPolicy, "publicationReceiptRoot", "literal");
  const candidateRoot = requiredValue(graph, selectedPolicy, "ignoredCandidateRoot", "literal");
  const primaryMutationLockPath = requiredValue(graph, selectedPolicy, "primaryMutationLockPath", "literal");
  const minimumBundleCount = Number(requiredValue(graph, selectedPolicy, "minimumBundleCount", "literal"));
  const maximumBundleCount = Number(requiredValue(graph, selectedPolicy, "maximumBundleCount", "literal"));
  const registeredCommands = exactValues(graph, selectedPolicy, "registeredCommand", "iri");
  const schemaPaths = exactValues(graph, selectedPolicy, "schemaPath", "literal");
  const toolPaths = exactValues(graph, selectedPolicy, "toolPath", "literal");
  if (requiredValue(graph, selectedPolicy, "version", "literal") !== "1"
    || selectedManifestPath === undefined || requiredManifestPath !== selectedManifestPath
    || parseRepositoryPath(requiredManifestPath, "file") === null || parseRepositoryPath(selectedSourcePath, "file") === null
    || receiptRoot !== "evidence/construction-authority/" || candidateRoot !== ".usf/candidates/construction-authority/"
    || primaryMutationLockPath !== ".usf/locks/primary-mutation.lock"
    || minimumBundleCount !== 1 || maximumBundleCount !== 32
    || registeredCommands.length !== 3 || schemaPaths.length !== 4 || toolPaths.length === 0) {
    throw new Error("CONSTRUCTION_AUTHORITY_POLICY_INVALID");
  }
  for (const command of registeredCommands) {
    if (!hasType(graph, command, "urn:usf:type:RegisteredCliCommand")
      || requiredValue(graph, command, "version", "literal") !== "1"
      || requiredValue(graph, command, "availability", "literal") !== "implemented") {
      throw new Error("CONSTRUCTION_AUTHORITY_COMMAND_INVALID");
    }
  }
  for (const path of [...schemaPaths, ...toolPaths]) if (parseRepositoryPath(path, "file") === null) throw new Error("CONSTRUCTION_AUTHORITY_DEPENDENCY_PATH_INVALID");
  const selectedEvidenceAlgorithm = requiredValue(graph, selectedPolicy, "evidenceAlgorithm", "iri");
  const selectedProofAlgorithm = requiredValue(graph, selectedPolicy, "proofAlgorithm", "iri");
  const selectedPublicationAlgorithm = requiredValue(graph, selectedPolicy, "publicationAlgorithm", "iri");
  const selectedDerivationRule = requiredValue(graph, selectedPolicy, "activationDerivationRule", "iri");
  for (const [iri, type] of [
    [selectedEvidenceAlgorithm, "urn:usf:type:EvidenceNormalizationAlgorithm"],
    [selectedProofAlgorithm, "urn:usf:type:ProofAlgorithm"],
    [selectedPublicationAlgorithm, "urn:usf:type:SemanticPublicationAlgorithm"],
    [selectedDerivationRule, "urn:usf:type:PermissionActivationDerivationRule"],
  ] as const) {
    if (!hasType(graph, iri, type) || requiredValue(graph, iri, "version", "literal") !== "1") throw new Error("CONSTRUCTION_AUTHORITY_ALGORITHM_INVALID");
  }
  if (requiredValue(graph, selectedPublicationAlgorithm, "publicationPolicy", "iri") !== selectedPolicy) {
    throw new Error("CONSTRUCTION_AUTHORITY_PUBLICATION_CHAIN_INVALID");
  }
  const evidenceSchema = schemaBinding(graph, selectedPolicy, "evidenceSchema", schemaPaths);
  const proofBundleSchema = schemaBinding(graph, selectedPolicy, "proofBundleSchema", schemaPaths);
  const publicationReceiptSchema = schemaBinding(graph, selectedPolicy, "publicationReceiptSchema", schemaPaths);
  const publicationResultSchema = schemaBinding(graph, selectedPolicy, "publicationResultSchema", schemaPaths);
  return Object.freeze({
    policyIri: selectedPolicy,
    derivationRuleIri: selectedDerivationRule,
    evidenceAlgorithmIri: selectedEvidenceAlgorithm,
    proofAlgorithmIri: selectedProofAlgorithm,
    publicationAlgorithmIri: selectedPublicationAlgorithm,
    targetGraphIri: selectedTargetGraphIri,
    sourcePath: selectedSourcePath,
    manifestPath: requiredManifestPath,
    receiptRoot,
    candidateRoot,
    primaryMutationLockPath,
    minimumBundleCount,
    maximumBundleCount,
    registeredCommands: Object.freeze(registeredCommands),
    schemaPaths: Object.freeze(schemaPaths),
    toolPaths: Object.freeze(toolPaths),
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
  });
}

function withoutField<T extends Record<string, unknown>>(value: T, field: keyof T): Record<string, unknown> {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function digestIri(prefix: string, value: unknown): string {
  return `${prefix}${canonicalDigest(value).slice("sha256:".length)}`;
}

export function constructionEvidenceIri(workIri: string, evidenceRequirementIri: string, scopedDependencyDigest: string): string {
  return digestIri("urn:usf:evidence:construction:", { evidenceRequirementIri, scopedDependencyDigest, workIri });
}

export function constructionProofResultIri(workIri: string, obligationIri: string, evidenceDigest: string, scopedDependencyDigest: string): string {
  return digestIri("urn:usf:proof-result:construction:", { evidenceDigest, obligationIri, scopedDependencyDigest, workIri });
}

export function constructionGrantIri(workIri: string, permissionIri: string, scopedDependencyDigest: string): string {
  return digestIri("urn:usf:grant:construction-authority:", { permissionIri, scopedDependencyDigest, workIri });
}

export function constructionReceiptPath(publicationIntentDigest: string, authority: ConstructionAuthorityDescriptor = legacyConstructionAuthority): string {
  if (!digestPattern.test(publicationIntentDigest)) throw new Error("CONSTRUCTION_PUBLICATION_INTENT_DIGEST_INVALID");
  return `${authority.receiptRoot}${publicationIntentDigest.slice("sha256:".length)}.json`;
}

export function constructionPublicationIntentDigest(
  bundleDigests: readonly string[],
  profileIri: string,
  selectedManifestPath: string,
  authority: ConstructionAuthorityDescriptor = legacyConstructionAuthority,
): string {
  return canonicalDigest({
    bundleDigests,
    manifestPath: selectedManifestPath,
    profileIri,
    publicationPolicyIri: authority.policyIri,
    semanticSourcePath: authority.sourcePath,
    targetGraphIri: authority.targetGraphIri,
  }, { rejectAbsolutePaths: true });
}

export function createConstructionGrant(
  member: ConstructionPublicationMemberInput,
  profileIri: string,
  selectedManifestPath: string,
  publicationIntentDigest: string,
  authority: ConstructionAuthorityDescriptor = legacyConstructionAuthority,
): Readonly<{ grantIri: string; grant: ConstructionAuthorityGrant; grantDigest: string }> {
  const { evidence, proof } = member.bundle;
  const grant: ConstructionAuthorityGrant = Object.freeze({
    workIri: evidence.workIri,
    permissionIri: member.permissionIri,
    profileIri,
    manifestPath: selectedManifestPath,
    publicationPolicyIri: authority.policyIri,
    evidenceIri: evidence.evidenceIri,
    evidenceDigest: evidence.contentDigest,
    proofResultIri: proof.proofResultIri,
    proofDigest: proof.contentDigest,
    realisationBasisDigest: evidence.realisationBasisDigest,
    scopedDependencyDigest: evidence.scopedDependencyDigest,
    publicationIntentDigest,
    activationState: activeState,
    maximumThrough: member.maximumThrough,
  });
  return Object.freeze({
    grantIri: constructionGrantIri(evidence.workIri, member.permissionIri, evidence.scopedDependencyDigest),
    grant,
    grantDigest: canonicalDigest(grant, { rejectAbsolutePaths: true }),
  });
}

export function createConstructionAuthorityReceipt(input: Readonly<{
  graph: SemanticGraph;
  authority?: ConstructionAuthorityDescriptor;
  profileIri: string;
  profileVersion: string;
  selectedManifestPath: string;
  manifestDigest: string;
  publicationIntentDigest: string;
  members: readonly ConstructionPublicationMemberInput[];
  baseSource: string;
  resultingSource: string;
  resultingSemanticDigest: string;
}>): ConstructionAuthorityPublicationReceipt {
  const authority = input.authority ?? legacyConstructionAuthority;
  if (input.selectedManifestPath !== authority.manifestPath
    || input.members.length < authority.minimumBundleCount || input.members.length > authority.maximumBundleCount) throw new Error("CONSTRUCTION_PUBLICATION_INPUT_INVALID");
  const receiptMembers: ConstructionAuthorityReceiptMember[] = [];
  const lines: string[] = [];
  input.members.forEach((member, index) => {
    const { grantIri, grant, grantDigest } = createConstructionGrant(member, input.profileIri, input.selectedManifestPath, input.publicationIntentDigest, authority);
    receiptMembers.push(Object.freeze({
      ordinal: index + 1,
      workIri: member.bundle.evidence.workIri,
      permissionIri: member.permissionIri,
      maximumThrough: member.maximumThrough,
      authorityBasisDigest: member.bundle.evidence.scopedDependencyDigest,
      evidenceIri: member.bundle.evidence.evidenceIri,
      evidenceDigest: member.bundle.evidence.contentDigest,
      proofResultIri: member.bundle.proof.proofResultIri,
      proofDigest: member.bundle.proof.contentDigest,
      grantIri,
      grantDigest,
      publicationIntentDigest: input.publicationIntentDigest,
    }));
    lines.push(...constructionRecordLines(member.bundle, grantIri, grant, authority));
  });
  const sortedLines = [...new Set(lines)].sort();
  if (sortedLines.length !== lines.length) throw new Error("CONSTRUCTION_PUBLICATION_DUPLICATE_RECORD");
  const operations = Object.freeze(sortedLines.map((line, index) => Object.freeze({ ordinal: index + 1, kind: "add" as const, sourcePath: authority.sourcePath, line })));
  const nonClaims = constructionAuthorityNonClaims();
  const draft: Omit<ConstructionAuthorityPublicationReceipt, "receiptDigest"> = {
    schema: authority.publicationReceiptRecordSchema,
    status: "verified" as const,
    algorithmIri: authority.publicationAlgorithmIri,
    algorithmVersion: "1" as const,
    algorithmResourceDigest: resourceDigest(input.graph, authority.publicationAlgorithmIri),
    publicationPolicyIri: authority.policyIri,
    publicationPolicyDigest: resourceDigest(input.graph, authority.policyIri),
    publicationIntentDigest: input.publicationIntentDigest,
    targetGraphIri: authority.targetGraphIri,
    semanticSourcePath: authority.sourcePath,
    publicationReceiptPath: constructionReceiptPath(input.publicationIntentDigest, authority),
    profileIri: input.profileIri,
    profileVersion: input.profileVersion,
    manifestPath: authority.manifestPath,
    manifestDigest: input.manifestDigest,
    baseSourceDigest: sha256(input.baseSource),
    resultingSourceDigest: sha256(input.resultingSource),
    baseSemanticDigest: input.graph.semanticDigest,
    resultingSemanticDigest: input.resultingSemanticDigest,
    memberCount: receiptMembers.length,
    members: Object.freeze(receiptMembers),
    operations,
    deltaDigest: canonicalDigest(operations, { rejectAbsolutePaths: true }),
    validationResultDigest: canonicalDigest({
      memberCount: receiptMembers.length,
      members: receiptMembers.map(({ workIri, authorityBasisDigest, grantDigest }) => ({ authorityBasisDigest, grantDigest, workIri })),
      operationCount: operations.length,
      resultingSemanticDigest: input.resultingSemanticDigest,
    }, { rejectAbsolutePaths: true }),
    nonClaims,
  };
  return Object.freeze({ ...draft, receiptDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) });
}

function expectedActivationReasons(packet: WorkPacket, evidenceRequirementIri: string, proofObligationIri: string): boolean {
  const expected = [
    `CONSTRUCTION_EVIDENCE_MISSING:${evidenceRequirementIri}`,
    `CONSTRUCTION_PROOF_RESULT_MISSING:${proofObligationIri}`,
  ].sort();
  return canonicalJson(packet.eligibility?.activation.reasonCodes ?? []) === canonicalJson(expected);
}

export function createConstructionEvidenceCandidate(
  graph: SemanticGraph,
  packet: WorkPacket,
  selectedManifestPath: string,
  observedSemanticDigest = graph.semanticDigest,
): ConstructionEvidenceCandidate {
  const selectedAuthority = deriveConstructionAuthority(graph, packet.id, selectedManifestPath);
  const authority = packet.realisationAuthority;
  const basis = packet.realisationBasis;
  const eligibility = packet.eligibility;
  const profileIri = packet.decisionBoundary.root;
  const profileVersion = packet.decisionBoundary.profileVersion;
  const evidenceRequirementIri = authority?.constructionEvidenceRequirement;
  const proofObligationIri = authority?.constructionProofObligation;
  if (selectedManifestPath !== selectedAuthority.manifestPath) throw new Error("CONSTRUCTION_MANIFEST_INVALID");
  if (packet.decisionBoundary.kind !== "realisation-profile" || profileIri === null || profileVersion === undefined) throw new Error("CONSTRUCTION_PROFILE_REQUIRED");
  if (!packet.semanticTrace?.complete || packet.semanticTrace.stages.length !== 7) throw new Error("CONSTRUCTION_SEMANTIC_TRACE_INCOMPLETE");
  if (!eligibility?.dependencyReady) throw new Error("CONSTRUCTION_DEPENDENCY_NOT_READY");
  if (authority?.permission?.activationState !== proofblockedState || authority.permission.maximumThrough === null) throw new Error("CONSTRUCTION_PERMISSION_PRESTATE_INVALID");
  if (evidenceRequirementIri === null || evidenceRequirementIri === undefined || proofObligationIri === null || proofObligationIri === undefined) throw new Error("CONSTRUCTION_AUTHORITY_INCOMPLETE");
  if (!expectedActivationReasons(packet, evidenceRequirementIri, proofObligationIri)) throw new Error("CONSTRUCTION_ACTIVATION_PRECONDITION_INVALID");
  if (basis === undefined || eligibility.authorityBasisDigest.length === 0) throw new Error("CONSTRUCTION_BASIS_MISSING");
  if (!exactValues(graph, selectedAuthority.policyIri, "eligibleWork", "iri").includes(packet.id)) throw new Error("CONSTRUCTION_WORK_NOT_ELIGIBLE");
  if (oneValue(graph, selectedAuthority.evidenceAlgorithmIri, "version", "literal") !== "1") throw new Error("CONSTRUCTION_EVIDENCE_ALGORITHM_INVALID");
  const observation = Object.freeze({
    semanticTraceDigest: canonicalDigest(packet.semanticTrace),
    decisionBoundaryDigest: canonicalDigest(packet.decisionBoundary),
    dependencySetDigest: canonicalDigest(packet.semanticDependencies),
    scopeDigest: canonicalDigest({ readSet: packet.readSet, writeSet: packet.writeSet }),
    acceptanceDigest: canonicalDigest(packet.acceptanceCriteria),
    constraintDigest: canonicalDigest(packet.constraints),
    applicabilityDigest: canonicalDigest({ environmentPosture: packet.environmentPosture, validationPlan: packet.validationPlan, proofObligations: packet.proofObligations }),
    stopConditionDigest: canonicalDigest(packet.stopConditions),
  });
  const validation = Object.freeze({
    applicability: "required" as const,
    outcome: "pass" as const,
    resultDigest: canonicalDigest({ applicability: "required", observation, outcome: "pass" }),
  });
  const draft: Omit<ConstructionEvidenceCandidate, "contentDigest"> = {
    schema: "urn:usf:construction-evidence-candidate:1" as const,
    status: "candidate" as const,
    stage: "construction-evidence" as const,
    algorithmIri: selectedAuthority.evidenceAlgorithmIri,
    algorithmVersion: "1" as const,
    algorithmResourceDigest: resourceDigest(graph, selectedAuthority.evidenceAlgorithmIri),
    workIri: packet.id,
    contractIri: packet.contract,
    profileIri,
    profileVersion,
    manifestPath: selectedManifestPath,
    manifestDigest: basis.selection.manifestDigest,
    observedSemanticDigest,
    evidenceIri: constructionEvidenceIri(packet.id, evidenceRequirementIri, eligibility.authorityBasisDigest),
    evidenceRequirementIri,
    evidenceRequirementDigest: resourceDigest(graph, evidenceRequirementIri),
    realisationBasisDigest: basis.basisDigest,
    packetCoreDigest: basis.work.packetCoreDigest,
    scopedDependencyDigest: eligibility.authorityBasisDigest,
    observation,
    validation,
  };
  return Object.freeze({ ...draft, contentDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) });
}

export function createConstructionProofBundle(
  graph: SemanticGraph,
  packet: WorkPacket,
  evidence: ConstructionEvidenceCandidate,
  obligationIri: string,
  selectedManifestPath: string,
): ConstructionProofBundle {
  const selectedAuthority = deriveConstructionAuthority(graph, packet.id, selectedManifestPath);
  const expectedEvidence = createConstructionEvidenceCandidate(graph, packet, selectedManifestPath, evidence.observedSemanticDigest);
  if (canonicalJson(expectedEvidence, { rejectAbsolutePaths: true }) !== canonicalJson(evidence, { rejectAbsolutePaths: true })) throw new Error("CONSTRUCTION_EVIDENCE_NOT_CURRENT");
  if (packet.realisationAuthority?.constructionProofObligation !== obligationIri) throw new Error("CONSTRUCTION_OBLIGATION_MISMATCH");
  if (oneValue(graph, obligationIri, "algorithm", "iri") !== selectedAuthority.proofAlgorithmIri || oneValue(graph, obligationIri, "applicability", "literal") !== "required") throw new Error("CONSTRUCTION_OBLIGATION_INVALID");
  const proofDraft: Omit<ConstructionProofResult, "contentDigest"> = {
    proofResultIri: constructionProofResultIri(packet.id, obligationIri, evidence.contentDigest, evidence.scopedDependencyDigest),
    workIri: packet.id,
    obligationIri,
    obligationDigest: resourceDigest(graph, obligationIri),
    algorithmIri: selectedAuthority.proofAlgorithmIri,
    algorithmResourceDigest: resourceDigest(graph, selectedAuthority.proofAlgorithmIri),
    evidenceDigest: evidence.contentDigest,
    realisationBasisDigest: evidence.realisationBasisDigest,
    scopedDependencyDigest: evidence.scopedDependencyDigest,
    applicability: "required" as const,
    outcome: "pass" as const,
    reasonCodes: Object.freeze([]) as readonly [],
    evaluationDigest: canonicalDigest({
      algorithmIri: selectedAuthority.proofAlgorithmIri,
      algorithmResourceDigest: resourceDigest(graph, selectedAuthority.proofAlgorithmIri),
      applicability: "required",
      evidenceDigest: evidence.contentDigest,
      obligationDigest: resourceDigest(graph, obligationIri),
      obligationIri,
      outcome: "pass",
      reasonCodes: [],
      realisationBasisDigest: evidence.realisationBasisDigest,
      scopedDependencyDigest: evidence.scopedDependencyDigest,
      workIri: packet.id,
    }),
  };
  const proof = Object.freeze({ ...proofDraft, contentDigest: canonicalDigest(proofDraft, { rejectAbsolutePaths: true }) });
  const bundleDraft = { schema: "urn:usf:construction-proof-bundle:1" as const, status: "candidate" as const, stage: "construction-proof" as const, evidence, proof };
  return Object.freeze({ ...bundleDraft, bundleDigest: canonicalDigest(bundleDraft, { rejectAbsolutePaths: true }) });
}

export function validateConstructionEvidenceShape(root: string, value: unknown, authority: ConstructionAuthorityDescriptor = legacyConstructionAuthority): value is ConstructionEvidenceCandidate {
  return validateSchema<ConstructionEvidenceCandidate>(root, authority.evidenceSchemaPath, value);
}

export function validateConstructionBundleShape(root: string, value: unknown, authority: ConstructionAuthorityDescriptor = legacyConstructionAuthority): value is ConstructionProofBundle {
  return validateSchema<ConstructionProofBundle>(root, authority.proofBundleSchemaPath, value);
}

function validateSchema<T>(root: string, path: string, value: unknown): value is T {
  try {
    const schema = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    return createJsonSchemaValidator<T>(schema).validate(value).valid;
  } catch {
    return false;
  }
}

function quad(subject: string, name: string, object: string, objectKind: "iri" | "literal", authority: ConstructionAuthorityDescriptor): Quad {
  const value: Quad = { subject, predicate: predicate(name), object, objectKind, graph: authority.targetGraphIri, canonical: "" };
  value.canonical = canonicalQuadLine(value);
  return value;
}

export function constructionRecordLines(
  bundle: ConstructionProofBundle,
  grantIri: string,
  grant: ConstructionAuthorityGrant,
  authority: ConstructionAuthorityDescriptor = legacyConstructionAuthority,
): string[] {
  const evidence = bundle.evidence;
  const proof = bundle.proof;
  const lines = [
    quad(evidence.evidenceIri, "type", evidenceType, "iri", authority),
    quad(evidence.evidenceIri, "forWork", evidence.workIri, "iri", authority),
    quad(evidence.evidenceIri, "satisfiesEvidenceRequirement", evidence.evidenceRequirementIri, "iri", authority),
    quad(evidence.evidenceIri, "validationResultDigest", evidence.validation.resultDigest, "literal", authority),
    quad(evidence.evidenceIri, "realisationBasisDigest", evidence.realisationBasisDigest, "literal", authority),
    quad(evidence.evidenceIri, "scopedDependencyDigest", evidence.scopedDependencyDigest, "literal", authority),
    quad(evidence.evidenceIri, "contentDigest", evidence.contentDigest, "literal", authority),
    quad(proof.proofResultIri, "type", proofResultType, "iri", authority),
    quad(proof.proofResultIri, "forWork", proof.workIri, "iri", authority),
    quad(proof.proofResultIri, "forObligation", proof.obligationIri, "iri", authority),
    quad(proof.proofResultIri, "algorithm", proof.algorithmIri, "iri", authority),
    quad(proof.proofResultIri, "evidenceDigest", proof.evidenceDigest, "literal", authority),
    quad(proof.proofResultIri, "realisationBasisDigest", proof.realisationBasisDigest, "literal", authority),
    quad(proof.proofResultIri, "scopedDependencyDigest", proof.scopedDependencyDigest, "literal", authority),
    quad(proof.proofResultIri, "outcome", proof.outcome, "literal", authority),
    quad(proof.proofResultIri, "contentDigest", proof.contentDigest, "literal", authority),
    quad(grantIri, "type", grantType, "iri", authority),
    quad(grantIri, "forWork", grant.workIri, "iri", authority),
    quad(grantIri, "forPermission", grant.permissionIri, "iri", authority),
    quad(grantIri, "authorityProfile", grant.profileIri, "iri", authority),
    quad(grantIri, "authorityManifestPath", grant.manifestPath, "literal", authority),
    quad(grantIri, "publicationPolicy", grant.publicationPolicyIri, "iri", authority),
    quad(grantIri, "evidence", grant.evidenceIri, "iri", authority),
    quad(grantIri, "evidenceDigest", grant.evidenceDigest, "literal", authority),
    quad(grantIri, "proofResult", grant.proofResultIri, "iri", authority),
    quad(grantIri, "proofDigest", grant.proofDigest, "literal", authority),
    quad(grantIri, "realisationBasisDigest", grant.realisationBasisDigest, "literal", authority),
    quad(grantIri, "scopedDependencyDigest", grant.scopedDependencyDigest, "literal", authority),
    quad(grantIri, "publicationIntentDigest", grant.publicationIntentDigest, "literal", authority),
    quad(grantIri, "activationState", grant.activationState, "iri", authority),
    quad(grantIri, "maximumThrough", grant.maximumThrough, "literal", authority),
    quad(grantIri, "contentDigest", canonicalDigest(grant, { rejectAbsolutePaths: true }), "literal", authority),
  ].map(canonicalQuadLine).sort();
  if (new Set(lines).size !== lines.length) throw new Error("CONSTRUCTION_RECORD_DUPLICATE_LINE");
  return lines;
}

function containedReceiptBytes(root: string, repositoryPath: string): Buffer {
  if (parseRepositoryPath(repositoryPath, "file") === null || !/^evidence\/construction-authority\/[0-9a-f]{64}\.json$/u.test(repositoryPath)) throw new Error("CONSTRUCTION_RECEIPT_PATH_INVALID");
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, repositoryPath);
  const rootRelative = relative(canonicalRoot, absolute);
  if (rootRelative === "" || rootRelative === ".." || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) throw new Error("CONSTRUCTION_RECEIPT_PATH_ESCAPE");
  let cursor = canonicalRoot;
  for (const segment of repositoryPath.split("/")) {
    cursor = resolve(cursor, segment);
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink()) throw new Error("CONSTRUCTION_RECEIPT_SYMLINK_REFUSED");
    if (cursor === absolute && (!entry.isFile() || entry.nlink !== 1 || entry.size > 4 * 1024 * 1024)) throw new Error("CONSTRUCTION_RECEIPT_FILE_INVALID");
  }
  if (realpathSync(absolute) !== absolute) throw new Error("CONSTRUCTION_RECEIPT_PATH_ESCAPE");
  const named = lstatSync(absolute);
  let descriptor: number;
  try { descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
  catch { throw new Error("CONSTRUCTION_RECEIPT_FILE_INVALID"); }
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
      || opened.mode !== named.mode || opened.nlink !== 1 || opened.size !== named.size || opened.size > 4 * 1024 * 1024) {
      throw new Error("CONSTRUCTION_RECEIPT_FILE_INVALID");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.uid !== opened.uid || after.mode !== opened.mode
      || after.nlink !== opened.nlink || after.size !== opened.size || bytes.byteLength !== opened.size) {
      throw new Error("CONSTRUCTION_RECEIPT_FILE_INVALID");
    }
    return bytes;
  } finally { closeSync(descriptor); }
}

function graphResourceLines(graph: SemanticGraph, subjects: readonly string[]): string[] {
  const selected = new Set(subjects);
  return graph.quads.filter((quad) => selected.has(quad.subject)).map(canonicalQuadLine).sort();
}

function readReceipt(graph: SemanticGraph, intentDigest: string, authority: ConstructionAuthorityDescriptor): { receipt: ConstructionAuthorityPublicationReceipt; path: string; bytes: Buffer } {
  const path = constructionReceiptPath(intentDigest, authority);
  const bytes = containedReceiptBytes(graph.repositoryRoot, path);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("CONSTRUCTION_RECEIPT_JSON_INVALID"); }
  if (!validateSchema<ConstructionAuthorityPublicationReceipt>(graph.repositoryRoot, authority.publicationReceiptSchemaPath, value)) throw new Error("CONSTRUCTION_RECEIPT_SCHEMA_INVALID");
  const receipt = value as ConstructionAuthorityPublicationReceipt;
  if (`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n` !== bytes.toString("utf8")) throw new Error("CONSTRUCTION_RECEIPT_NONCANONICAL");
  if (canonicalDigest(withoutField(receipt as unknown as Record<string, unknown>, "receiptDigest"), { rejectAbsolutePaths: true }) !== receipt.receiptDigest) throw new Error("CONSTRUCTION_RECEIPT_DIGEST_INVALID");
  if (receipt.publicationIntentDigest !== intentDigest || receipt.publicationReceiptPath !== path || receipt.memberCount !== receipt.members.length) throw new Error("CONSTRUCTION_RECEIPT_IDENTITY_INVALID");
  if (canonicalDigest(receipt.operations, { rejectAbsolutePaths: true }) !== receipt.deltaDigest) throw new Error("CONSTRUCTION_RECEIPT_DELTA_INVALID");
  const operationLines = receipt.operations.map(({ line }) => line);
  const parsed = parseStrictNQuads(`${operationLines.join("\n")}\n`, authority.targetGraphIri, 1_024);
  if (parsed.some((entry, index) => canonicalQuadLine(entry) !== operationLines[index]) || new Set(operationLines).size !== operationLines.length) throw new Error("CONSTRUCTION_RECEIPT_OPERATION_INVALID");
  const source = readFileSync(resolve(graph.repositoryRoot, authority.sourcePath), "utf8");
  const currentLines = new Set(source.split("\n").filter((line) => line.length > 0));
  if (operationLines.some((line) => !currentLines.has(line))) throw new Error("CONSTRUCTION_RECEIPT_OPERATION_MISSING");
  return { receipt, path, bytes };
}

function fieldMap(graph: SemanticGraph, subject: string, fields: readonly Readonly<{ name: string; kind: "iri" | "literal" }>[]): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = oneValue(graph, subject, field.name, field.kind);
    if (value === null) return null;
    result[field.name] = value;
  }
  return result;
}

function invalidProjection(reasonCodes: string[], dynamicResources: string[] = []): GrantProjection {
  return Object.freeze({ applicable: true, active: false, grantIri: null, evidenceIri: null, proofResultIri: null, reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()), dynamicResources: Object.freeze([...new Set(dynamicResources)].sort()) });
}

export function evaluateConstructionAuthorityGrant(graph: SemanticGraph, input: GrantProjectionInput): GrantProjection {
  const derivationRules = exactValues(graph, input.permissionIri, "activationDerivationRule", "iri");
  if (derivationRules.length === 0) return Object.freeze({ applicable: false, active: false, grantIri: null, evidenceIri: null, proofResultIri: null, reasonCodes: Object.freeze([]), dynamicResources: Object.freeze([]) });
  let authority: ConstructionAuthorityDescriptor;
  try { authority = deriveConstructionAuthority(graph, input.workIri, input.manifestPath); }
  catch (error) {
    if (error instanceof Error && error.message === "CONSTRUCTION_WORK_NOT_ELIGIBLE") {
      return Object.freeze({ applicable: true, active: false, grantIri: null, evidenceIri: null, proofResultIri: null, reasonCodes: Object.freeze([]), dynamicResources: Object.freeze([]) });
    }
    return invalidProjection([`CONSTRUCTION_AUTHORITY_POLICY_INVALID:${input.workIri}`]);
  }
  if (derivationRules.length !== 1 || derivationRules[0] !== authority.derivationRuleIri || !hasType(graph, authority.derivationRuleIri, "urn:usf:type:PermissionActivationDerivationRule")) return invalidProjection([`CONSTRUCTION_AUTHORITY_DERIVATION_RULE_INVALID:${input.permissionIri}`]);
  const candidates = typedSubjects(graph, grantType).filter((id) =>
    oneValue(graph, id, "forWork", "iri") === input.workIri
    && oneValue(graph, id, "forPermission", "iri") === input.permissionIri
    && oneValue(graph, id, "authorityProfile", "iri") === input.profileIri
    && oneValue(graph, id, "authorityManifestPath", "literal") === input.manifestPath
    && oneValue(graph, id, "scopedDependencyDigest", "literal") === input.authorityBasisDigest);
  if (candidates.length === 0) return Object.freeze({ applicable: true, active: false, grantIri: null, evidenceIri: null, proofResultIri: null, reasonCodes: Object.freeze([]), dynamicResources: Object.freeze([]) });
  if (candidates.length > 1) return invalidProjection([`CONSTRUCTION_AUTHORITY_GRANT_AMBIGUOUS:${input.workIri}`], candidates);
  const grantIri = candidates[0] as string;
  const grantFields = fieldMap(graph, grantIri, [
    { name: "forWork", kind: "iri" }, { name: "forPermission", kind: "iri" }, { name: "authorityProfile", kind: "iri" },
    { name: "authorityManifestPath", kind: "literal" }, { name: "publicationPolicy", kind: "iri" }, { name: "evidence", kind: "iri" },
    { name: "evidenceDigest", kind: "literal" }, { name: "proofResult", kind: "iri" }, { name: "proofDigest", kind: "literal" },
    { name: "realisationBasisDigest", kind: "literal" }, { name: "scopedDependencyDigest", kind: "literal" },
    { name: "publicationIntentDigest", kind: "literal" }, { name: "activationState", kind: "iri" }, { name: "maximumThrough", kind: "literal" },
    { name: "contentDigest", kind: "literal" },
  ]);
  if (grantFields === null) return invalidProjection([`CONSTRUCTION_AUTHORITY_GRANT_INVALID:${grantIri}`], [grantIri]);
  const expectedGrantIri = constructionGrantIri(input.workIri, input.permissionIri, input.authorityBasisDigest);
  const grant: ConstructionAuthorityGrant = {
    workIri: grantFields.forWork as string,
    permissionIri: grantFields.forPermission as string,
    profileIri: grantFields.authorityProfile as string,
    manifestPath: grantFields.authorityManifestPath as string,
    publicationPolicyIri: grantFields.publicationPolicy as string,
    evidenceIri: grantFields.evidence as string,
    evidenceDigest: grantFields.evidenceDigest as string,
    proofResultIri: grantFields.proofResult as string,
    proofDigest: grantFields.proofDigest as string,
    realisationBasisDigest: grantFields.realisationBasisDigest as string,
    scopedDependencyDigest: grantFields.scopedDependencyDigest as string,
    publicationIntentDigest: grantFields.publicationIntentDigest as string,
    activationState: grantFields.activationState as typeof activeState,
    maximumThrough: grantFields.maximumThrough as string,
  };
  if (grantIri !== expectedGrantIri || grant.publicationPolicyIri !== authority.policyIri || grant.activationState !== activeState
    || grant.maximumThrough !== input.maximumThrough || !digestPattern.test(grant.evidenceDigest) || !digestPattern.test(grant.proofDigest)
    || !digestPattern.test(grant.realisationBasisDigest) || !digestPattern.test(grant.publicationIntentDigest)
    || canonicalDigest(grant, { rejectAbsolutePaths: true }) !== grantFields.contentDigest) return invalidProjection([`CONSTRUCTION_AUTHORITY_GRANT_INVALID:${grantIri}`], [grantIri]);
  const evidenceIri = grant.evidenceIri;
  const evidenceFields = fieldMap(graph, evidenceIri, [
    { name: "forWork", kind: "iri" }, { name: "satisfiesEvidenceRequirement", kind: "iri" }, { name: "validationResultDigest", kind: "literal" },
    { name: "realisationBasisDigest", kind: "literal" }, { name: "scopedDependencyDigest", kind: "literal" }, { name: "contentDigest", kind: "literal" },
  ]);
  if (!hasType(graph, evidenceIri, evidenceType) || evidenceFields === null
    || evidenceIri !== constructionEvidenceIri(input.workIri, input.evidenceRequirementIri, input.authorityBasisDigest)
    || evidenceFields.forWork !== input.workIri || evidenceFields.satisfiesEvidenceRequirement !== input.evidenceRequirementIri
    || evidenceFields.realisationBasisDigest !== grant.realisationBasisDigest || evidenceFields.scopedDependencyDigest !== input.authorityBasisDigest
    || evidenceFields.contentDigest !== grant.evidenceDigest || !digestPattern.test(evidenceFields.validationResultDigest as string)) {
    return invalidProjection([`CONSTRUCTION_AUTHORITY_EVIDENCE_INVALID:${evidenceIri}`], [grantIri, evidenceIri]);
  }
  const proofResultIri = grant.proofResultIri;
  const proofFields = fieldMap(graph, proofResultIri, [
    { name: "forWork", kind: "iri" }, { name: "forObligation", kind: "iri" }, { name: "algorithm", kind: "iri" }, { name: "evidenceDigest", kind: "literal" },
    { name: "realisationBasisDigest", kind: "literal" }, { name: "scopedDependencyDigest", kind: "literal" }, { name: "outcome", kind: "literal" }, { name: "contentDigest", kind: "literal" },
  ]);
  if (!hasType(graph, proofResultIri, proofResultType) || proofFields === null
    || proofResultIri !== constructionProofResultIri(input.workIri, input.proofObligationIri, grant.evidenceDigest, input.authorityBasisDigest)
    || proofFields.forWork !== input.workIri || proofFields.forObligation !== input.proofObligationIri || proofFields.algorithm !== input.proofAlgorithmIri
    || proofFields.evidenceDigest !== grant.evidenceDigest || proofFields.realisationBasisDigest !== grant.realisationBasisDigest
    || proofFields.scopedDependencyDigest !== input.authorityBasisDigest || proofFields.outcome !== "pass" || proofFields.contentDigest !== grant.proofDigest) {
    return invalidProjection([`CONSTRUCTION_AUTHORITY_PROOF_INVALID:${proofResultIri}`], [grantIri, evidenceIri, proofResultIri]);
  }
  try {
    const { receipt, path, bytes } = readReceipt(graph, grant.publicationIntentDigest, authority);
    if (receipt.profileIri !== input.profileIri || receipt.manifestPath !== input.manifestPath || receipt.publicationPolicyIri !== authority.policyIri
      || receipt.semanticSourcePath !== authority.sourcePath || receipt.targetGraphIri !== authority.targetGraphIri
      || receipt.algorithmIri !== authority.publicationAlgorithmIri
      || receipt.schema !== authority.publicationReceiptRecordSchema
      || receipt.algorithmResourceDigest !== resourceDigest(graph, authority.publicationAlgorithmIri)
      || receipt.publicationPolicyDigest !== resourceDigest(graph, authority.policyIri)) throw new Error("CONSTRUCTION_RECEIPT_AUTHORITY_MISMATCH");
    const matchingMembers = receipt.members.filter((member) => member.grantIri === grantIri);
    if (matchingMembers.length !== 1) throw new Error("CONSTRUCTION_RECEIPT_MEMBER_INVALID");
    const member = matchingMembers[0] as ConstructionAuthorityReceiptMember;
    if (member.workIri !== input.workIri || member.permissionIri !== input.permissionIri || member.maximumThrough !== input.maximumThrough
      || member.authorityBasisDigest !== input.authorityBasisDigest || member.evidenceIri !== evidenceIri || member.evidenceDigest !== grant.evidenceDigest
      || member.proofResultIri !== proofResultIri || member.proofDigest !== grant.proofDigest || member.grantDigest !== grantFields.contentDigest
      || member.publicationIntentDigest !== grant.publicationIntentDigest) throw new Error("CONSTRUCTION_RECEIPT_MEMBER_MISMATCH");
    const receiptSubjectLines = receipt.operations.map(({ line }) => line).filter((line) => {
      const parsed = parseStrictNQuads(`${line}\n`, authority.targetGraphIri, 1)[0];
      return parsed !== undefined && [evidenceIri, proofResultIri, grantIri].includes(parsed.subject);
    }).sort();
    if (canonicalJson(receiptSubjectLines) !== canonicalJson(graphResourceLines(graph, [evidenceIri, proofResultIri, grantIri]))) throw new Error("CONSTRUCTION_RECEIPT_RESOURCE_MISMATCH");
    return Object.freeze({
      applicable: true,
      active: true,
      grantIri,
      evidenceIri,
      proofResultIri,
      reasonCodes: Object.freeze([]),
      dynamicResources: Object.freeze([evidenceIri, proofResultIri, grantIri].sort()),
      receiptDependency: Object.freeze({ key: path, digest: sha256(bytes), kind: "file" as const }),
    });
  } catch {
    return invalidProjection([`CONSTRUCTION_AUTHORITY_RECEIPT_INVALID:${grantIri}`], [grantIri, evidenceIri, proofResultIri]);
  }
}

export function constructionAuthorityNonClaims(): readonly string[] {
  return Object.freeze([
    "Construction authority is not work completion, integration acceptance or terminal proof.",
    "No provider, credential, network, Git, GitHub, runtime, staging, production or ANQR authority is claimed.",
    "Only declared scoped dependency movement invalidates a grant; unrelated semantic and carrier movement does not.",
  ]);
}

export function validateConstructionReceiptShape(root: string, value: unknown, authority: ConstructionAuthorityDescriptor = legacyConstructionAuthority): value is ConstructionAuthorityPublicationReceipt {
  return validateSchema<ConstructionAuthorityPublicationReceipt>(root, authority.publicationReceiptSchemaPath, value);
}
