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
  readonly sourcePath: string;
  readonly targetGraphIri: string;
  readonly receiptRoot: string;
  readonly candidateRoot: string;
  readonly primaryMutationLockPath: string;
  readonly schemaPaths: readonly string[];
  readonly toolPaths: readonly string[];
  readonly minimumBundleCount: 1;
  readonly maximumBundleCount: 32;
}

export function deriveNoChangeCompletionAuthority(graph: SemanticGraph, workIri: string): NoChangeCompletionAuthority {
  const c = workCompletionConstants;
  if (!c.eligibleWorks.includes(workIri)) throw new Error("WORK_COMPLETION_WORK_NOT_ELIGIBLE");
  if (!hasExactType(graph, c.policyIri, c.policyType) || oneValue(graph, c.policyIri, "version", "literal") !== "1"
    || oneValue(graph, c.policyIri, "implementationState", "iri") !== c.implementedState
    || !sameSet(exactValues(graph, c.policyIri, "eligibleWork", "iri"), c.eligibleWorks)
    || oneValue(graph, c.policyIri, "requiredManifestPath", "literal") !== c.manifestPath
    || oneValue(graph, c.policyIri, "targetSemanticSourcePath", "literal") !== c.sourcePath
    || oneValue(graph, c.policyIri, "targetNamedGraph", "iri") !== c.targetGraphIri
    || oneValue(graph, c.policyIri, "publicationReceiptRoot", "literal") !== c.receiptRoot
    || oneValue(graph, c.policyIri, "ignoredCandidateRoot", "literal") !== c.candidateRoot
    || oneValue(graph, c.policyIri, "primaryMutationLockPath", "literal") !== c.primaryMutationLockPath
    || oneValue(graph, c.policyIri, "minimumBundleCount", "literal") !== "1"
    || oneValue(graph, c.policyIri, "maximumBundleCount", "literal") !== "32"
    || !sameSet(exactValues(graph, c.policyIri, "registeredCommand", "iri"), c.commands)
    || !sameSet(exactValues(graph, c.policyIri, "schemaPath", "literal"), c.schemaPaths)
    || !sameSet(exactValues(graph, c.policyIri, "toolPath", "literal"), c.toolPaths)) {
    throw new Error("WORK_COMPLETION_POLICY_INVALID");
  }
  for (const command of c.commands) {
    if (!hasExactType(graph, command, "urn:usf:type:RegisteredCliCommand") || oneValue(graph, command, "version", "literal") !== "1"
      || oneValue(graph, command, "availability", "literal") !== "implemented") throw new Error("WORK_COMPLETION_COMMAND_INVALID");
  }
  const algorithms = [
    [c.realisationAlgorithmIri, "urn:usf:type:NoChangeRealisationAlgorithm"],
    [c.evidenceAlgorithmIri, "urn:usf:type:EvidenceNormalizationAlgorithm"],
    [c.proofAlgorithmIri, "urn:usf:type:ProofAlgorithm"],
    [c.publicationAlgorithmIri, "urn:usf:type:SemanticPublicationAlgorithm"],
  ] as const;
  for (const [algorithm, type] of algorithms) {
    if (!hasExactType(graph, algorithm, type) || oneValue(graph, algorithm, "version", "literal") !== "1"
      || oneValue(graph, algorithm, "implementationState", "iri") !== c.implementedState) throw new Error("WORK_COMPLETION_ALGORITHM_INVALID");
  }
  if (oneValue(graph, c.policyIri, "realisationAlgorithm", "iri") !== c.realisationAlgorithmIri
    || oneValue(graph, c.policyIri, "evidenceAlgorithm", "iri") !== c.evidenceAlgorithmIri
    || oneValue(graph, c.policyIri, "proofAlgorithm", "iri") !== c.proofAlgorithmIri
    || oneValue(graph, c.policyIri, "publicationAlgorithm", "iri") !== c.publicationAlgorithmIri
    || oneValue(graph, c.policyIri, "completionDerivationRule", "iri") !== c.completionRuleIri
    || oneValue(graph, c.proofAlgorithmIri, "realisationRecordType", "iri") !== c.realisationReceiptType
    || oneValue(graph, c.proofAlgorithmIri, "realisationReceiptSchema", "iri") !== c.realisationReceiptSchemaIri
    || oneValue(graph, c.proofAlgorithmIri, "acceptedRealisationState", "literal") !== "accepted-no-change"
    || oneValue(graph, c.proofAlgorithmIri, "realisationVerifier", "iri") !== c.realisationAlgorithmIri
    || oneValue(graph, c.publicationAlgorithmIri, "publicationPolicy", "iri") !== c.policyIri
    || !hasExactType(graph, c.completionRuleIri, "urn:usf:type:CompletionDerivationRule")
    || oneValue(graph, c.completionRuleIri, "version", "literal") !== "1") throw new Error("WORK_COMPLETION_CHAIN_INVALID");
  const schemaIris = [
    "urn:usf:schema:no-change-workspace-manifest:1",
    "urn:usf:schema:no-change-realisation-result:1",
    c.evidenceSchemaIri,
    c.proofBundleSchemaIri,
    c.publicationReceiptSchemaIri,
    c.publicationResultSchemaIri,
  ];
  for (const schemaIri of schemaIris) {
    if (!hasExactType(graph, schemaIri, "urn:usf:type:SemanticRecordSchema") || oneValue(graph, schemaIri, "version", "literal") !== "1") {
      throw new Error("WORK_COMPLETION_SCHEMA_INVALID");
    }
  }
  if (!hasExactType(graph, c.realisationReceiptSchemaIri, "urn:usf:type:SemanticRecordSchema")
    || oneValue(graph, c.realisationReceiptSchemaIri, "version", "literal") !== "1") throw new Error("WORK_COMPLETION_REALISATION_SCHEMA_INVALID");
  return Object.freeze({
    policy: Object.freeze({
      iri: c.policyIri,
      resourceDigest: resourceDigest(graph, c.policyIri),
      algorithmIri: c.realisationAlgorithmIri,
      algorithmResourceDigest: resourceDigest(graph, c.realisationAlgorithmIri),
    }),
    evidenceAlgorithmIri: c.evidenceAlgorithmIri,
    evidenceAlgorithmDigest: resourceDigest(graph, c.evidenceAlgorithmIri),
    proofAlgorithmIri: c.proofAlgorithmIri,
    proofAlgorithmDigest: resourceDigest(graph, c.proofAlgorithmIri),
    publicationAlgorithmIri: c.publicationAlgorithmIri,
    publicationAlgorithmDigest: resourceDigest(graph, c.publicationAlgorithmIri),
    completionRuleIri: c.completionRuleIri,
    completionRuleDigest: resourceDigest(graph, c.completionRuleIri),
    sourcePath: c.sourcePath,
    targetGraphIri: c.targetGraphIri,
    receiptRoot: c.receiptRoot,
    candidateRoot: c.candidateRoot,
    primaryMutationLockPath: c.primaryMutationLockPath,
    schemaPaths: c.schemaPaths,
    toolPaths: c.toolPaths,
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

export interface WorkCompletionPublicationMember {
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

export interface WorkCompletionPublicationReceipt {
  readonly schema: "urn:usf:work-completion-publication-receipt:1";
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
  const draft: Omit<WorkCompletionPublicationReceipt, "receiptDigest"> = {
    schema: "urn:usf:work-completion-publication-receipt:1",
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
    manifestDigest: input.manifestDigest,
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
      operationCount: input.operations.length,
      authorityDependencyDigest: canonicalDigest(input.authorityDependencies, { rejectAbsolutePaths: true }),
      resultingSemanticDigest: input.resultingSemanticDigest,
    }, { rejectAbsolutePaths: true }),
    nonClaims: workCompletionNonClaims,
  };
  return Object.freeze({ ...draft, receiptDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) });
}

export function completionPublicationIntentDigest(
  bundles: readonly CompletionProofBundle[],
  profileIri: string,
  manifestPath: string,
  authority: NoChangeCompletionAuthority,
): string {
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

function quad(subject: string, name: string, object: string, objectKind: "iri" | "literal"): string {
  return canonicalQuadLine({ subject, predicate: predicate(name), object, objectKind, graph: workCompletionConstants.targetGraphIri, canonical: "" });
}

export function workCompletionRecordLines(
  bundle: CompletionProofBundle,
  authority: NoChangeCompletionAuthority,
  publicationIntentDigest: string,
): { readonly lines: readonly string[]; readonly member: Omit<WorkCompletionPublicationMember, "ordinal"> } {
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
    schema: workCompletionConstants.realisationReceiptSchemaIri,
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
  };
  const realisationDigest = canonicalDigest(realisationDraft, { rejectAbsolutePaths: true });
  const lines = [
    quad(realisationReceiptIri, "type", workCompletionConstants.realisationReceiptType, "iri"),
    quad(realisationReceiptIri, "schema", workCompletionConstants.realisationReceiptSchemaIri, "iri"),
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

export function validateWorkCompletionReceiptShape(root: string, value: unknown): value is WorkCompletionPublicationReceipt {
  try {
    const schema = JSON.parse(readFileSync(resolve(root, "schemas/work-completion-publication-receipt.schema.json"), "utf8")) as unknown;
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
  readonly receiptDependency?: Readonly<{ key: string; digest: string; kind: "file" }>;
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
): { receipt: WorkCompletionPublicationReceipt; path: string; bytes: Buffer } {
  const path = `${workCompletionConstants.receiptRoot}${intentDigest.slice("sha256:".length)}.json`;
  const bytes = containedCompletionReceiptBytes(graph.repositoryRoot, path);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("WORK_COMPLETION_RECEIPT_JSON_INVALID"); }
  if (!validateWorkCompletionReceiptShape(graph.repositoryRoot, value)) throw new Error("WORK_COMPLETION_RECEIPT_SCHEMA_INVALID");
  const receipt = value as WorkCompletionPublicationReceipt;
  if (`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n` !== bytes.toString("utf8")
    || canonicalDigest(withoutReceiptDigest(receipt), { rejectAbsolutePaths: true }) !== receipt.receiptDigest
    || receipt.publicationIntentDigest !== intentDigest || receipt.publicationReceiptPath !== path
    || receipt.memberCount !== receipt.members.length
    || receipt.members.some((member, index) => member.ordinal !== index + 1 || member.publicationIntentDigest !== intentDigest)
    || receipt.operations.some((operation, index) => operation.ordinal !== index + 1 || operation.sourcePath !== workCompletionConstants.sourcePath)
    || canonicalDigest(receipt.authorityDependencies, { rejectAbsolutePaths: true }) !== receipt.authorityDependencyDigest
    || canonicalDigest(receipt.operations, { rejectAbsolutePaths: true }) !== receipt.deltaDigest
    || canonicalDigest({
      members: receipt.members.map(({ workIri, realisationDigest, evidenceDigest, proofDigest }) => ({ workIri, realisationDigest, evidenceDigest, proofDigest })),
      operationCount: receipt.operations.length,
      authorityDependencyDigest: receipt.authorityDependencyDigest,
      resultingSemanticDigest: receipt.resultingSemanticDigest,
    }, { rejectAbsolutePaths: true }) !== receipt.validationResultDigest) {
    throw new Error("WORK_COMPLETION_RECEIPT_DIGEST_INVALID");
  }
  const operationLines = receipt.operations.map(({ line }) => line);
  const parsed = parseStrictNQuads(`${operationLines.join("\n")}\n`, workCompletionConstants.targetGraphIri, 4_096);
  if (parsed.some((entry, index) => canonicalQuadLine(entry) !== operationLines[index]) || new Set(operationLines).size !== operationLines.length) {
    throw new Error("WORK_COMPLETION_RECEIPT_OPERATION_INVALID");
  }
  const source = readFileSync(resolve(graph.repositoryRoot, workCompletionConstants.sourcePath), "utf8");
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
    ...workCompletionConstants.commands,
    "urn:usf:schema:no-change-workspace-manifest:1",
    "urn:usf:schema:no-change-realisation-result:1",
    workCompletionConstants.realisationReceiptSchemaIri,
    workCompletionConstants.evidenceSchemaIri,
    workCompletionConstants.proofBundleSchemaIri,
    workCompletionConstants.publicationReceiptSchemaIri,
    workCompletionConstants.publicationResultSchemaIri,
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
    });
  };
  if (basis === undefined || packet.decisionBoundary.kind !== "realisation-profile" || profileIri === null || profileVersion === undefined
    || requirement === null || requirement === undefined || obligation === null || obligation === undefined || validations.length === 0) {
    reasons.push(`WORK_COMPLETION_AUTHORITY_INCOMPLETE:${packet.id}`);
    return finish();
  }

  const receiptCandidates = typedSubjects(graph, workCompletionConstants.realisationReceiptType).filter((subject) =>
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
  };
  const realisationDigest = exactRecordValue(graph, realisationReceipt, "contentDigest", "literal");
  const requiredRealisationValues = Object.values(realisationFields);
  if (requiredRealisationValues.some((value) => value === null) || realisationDigest === null
    || realisationFields.schema !== workCompletionConstants.realisationReceiptSchemaIri
    || realisationFields.state !== "accepted-no-change" || realisationFields.disposition !== "verified-no-change"
    || realisationFields.workIri !== packet.id || realisationFields.profileIri !== profileIri
    || realisationFields.manifestPath !== basis.selection.manifestPath
    || realisationFields.realisationBasisDigest !== basis.basisDigest
    || realisationFields.scopedDependencyDigest !== basis.work.scopedDependencyDigest
    || realisationFields.publicationPolicyIri !== authority.policy.iri
    || realisationFields.publicationPolicyDigest !== authority.policy.resourceDigest
    || !requiredRealisationValues.filter((value): value is string => value !== null)
      .filter((value) => value.startsWith("sha256:")).every((value) => digestPattern.test(value))
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
    const { receipt, path, bytes } = readCompletionReceipt(graph, publicationIntentDigest);
    if (receipt.profileIri !== profileIri || receipt.profileVersion !== profileVersion
      || receipt.manifestPath !== basis.selection.manifestPath || receipt.manifestDigest !== basis.selection.manifestDigest
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
    });
  } catch {
    reasons.push(`WORK_COMPLETION_PUBLICATION_RECEIPT_INVALID:${realisationReceipt}`);
    return finish({ realisationReceipt, evidence, proofResult });
  }
}
