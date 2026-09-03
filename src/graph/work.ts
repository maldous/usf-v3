import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";
import { canonicalDigest, sha256 } from "../core/canonical.ts";
import { loadSemanticGraph, objectValues, objectsFor, resourceDigest, transitiveResourceIris, type LoadedSemanticGraph, type SemanticGraph } from "./index.ts";
import { contractNonClaims, contractWrites, type Dependency } from "./query.ts";
import { assertBasisMatchesPacket, assertRealisationBasis, createRealisationBasis, packetDigest, type BasisDraft, type RealisationBasis } from "../realisation/basis.ts";
import {
  assertTransitionCandidatePostBasisCurrentness,
  assertTransitionPostSemanticCurrentness,
  assertVerifiedTransitionCandidateCurrentness,
  verifyTransitionActivationCurrentness,
  type TransitionCurrentnessVerification,
  type VerifiedTransitionCandidateCurrentness,
} from "../realisation/transition.ts";
import { evaluateConstructionAuthorityGrant } from "../realisation/construction-authority.ts";
import { evaluateNoChangeCompletionRecords } from "../realisation/work-completion.ts";

const typePredicate = "urn:usf:predicate:type";
const workType = "urn:usf:type:WorkPacket";
const contractType = "urn:usf:type:SemanticContract";
const profileType = "urn:usf:type:RealisationProfile";
const productType = "urn:usf:type:ProductModel";
const foundationType = "urn:usf:type:SemanticFoundation";
const artifactRequirementType = "urn:usf:type:ArtifactRequirement";
const environmentApplicabilityType = "urn:usf:type:EnvironmentApplicability";
const semanticOrderPolicyType = "urn:usf:type:SemanticOrderPolicy";
const semanticStageType = "urn:usf:type:SemanticStage";
const realisationPermissionType = "urn:usf:type:RealisationPermission";
const constructionEvidenceRequirementType = "urn:usf:type:ConstructionEvidenceRequirement";
const constructionProofObligationType = "urn:usf:type:ConstructionProofObligation";
const completionEvidenceRequirementType = "urn:usf:type:CompletionEvidenceRequirement";
const completionProofObligationType = "urn:usf:type:CompletionProofObligation";
const completionImplementationProofblocked = "urn:usf:implementation-state:proofblocked";
const evidenceType = "urn:usf:type:Evidence";
const proofResultType = "urn:usf:type:ProofResult";
const constructionAuthorityPublicationPolicyType = "urn:usf:type:ConstructionAuthorityPublicationPolicy";
const admittedIntegrationReceiptType = "urn:usf:type:AdmittedIntegrationReceipt";
const bootstrapExceptionType = "urn:usf:type:BootstrapConstructionException";
const bootstrapAtomicAdmissionSetType = "urn:usf:type:BootstrapAtomicAdmissionSet";
const canonicalBootstrapException = "urn:usf:exception:semantic-first-bootstrap:1";
const canonicalBootstrapAdmissionWorkSet = "urn:usf:admission-work-set:semantic-first-bootstrap:1";
const canonicalBootstrapWorks = [
  "urn:usf:work:semantic-first-eligibility",
  "urn:usf:work:realisation-basis-chain",
  "urn:usf:work:semantic-first-lifecycle-admission",
] as const;
const semanticFirstContractShape = "urn:usf:contract-shape:semantic-first:1";
const proofblockedState = "urn:usf:contract-state:proofblocked";
const activeState = "urn:usf:contract-state:active";
const openExceptionState = "urn:usf:exception-state:open";
const predicate = (name: string) => `urn:usf:predicate:${name}`;
const applicabilityStates = ["required", "not-required", "conditional", "reserved", "unresolved"] as const;
const privacyClasses = ["public", "private-metadata", "private-source", "restricted"] as const;
const deliveryCeilings = ["work", "route", "call", "resolve", "apply", "check", "integrate", "publish", "runtime"] as const;

export type Applicability = typeof applicabilityStates[number];
export type PrivacyClassification = typeof privacyClasses[number];

export interface RequirementProjection {
  id: string;
  types: string[];
  fields: Array<{ predicate: string; value: string; valueKind: "iri" | "literal" }>;
}

export interface ArtifactProjection {
  id: string;
  artifactKind: string;
  mediaType: string;
  targetPath: string;
  modelCapabilities: string[];
}

export interface DecisionBoundary {
  kind: "unscoped" | "contract" | "work" | "realisation-profile";
  root: string | null;
  profileVersion?: string;
  product?: string;
  foundation?: string;
}

export interface SemanticTraceProjection {
  policy: string | null;
  complete: boolean;
  stages: Array<{ id: string; order: number }>;
  stopConditions: string[];
}

export interface RealisationAuthorityProjection {
  contractShape: string | null;
  constructionEvidenceRequirement: string | null;
  constructionProofObligation: string | null;
  completionEvidenceRequirement: string | null;
  completionValidationObligations: string[];
  completionProofObligation: string | null;
  permission: null | {
    id: string;
    activationState: string | null;
    maximumThrough: string | null;
    requiresPermissions: string[];
    activationCurrentness: string | null;
  };
}

export interface WorkEligibilityProjection {
  dependencyReady: boolean;
  dependencyAuthority: "no-dependencies" | "bootstrap-atomic-admission" | "bootstrap-transition-stage" | "verified-completion" | "none";
  authorityBasisDigest: string;
  construction: {
    eligible: boolean;
    authority: "active-permission" | "bootstrap-exception" | "none";
    maximumThrough: string | null;
    reasonCodes: string[];
  };
  activation: {
    eligible: boolean;
    reasonCodes: string[];
  };
}

export interface WorkRealisationStageProjection {
  stage: "construction-ready" | "checked-awaiting-integration" | "verified-complete" | "blocked" | "retired";
  actionable: boolean;
  stageAuthorityDigest: string;
  completion: {
    verified: boolean;
    integrationReceipt: string | null;
    evidence: string | null;
    proofResult: string | null;
    reasonCodes: string[];
  };
}

export interface WorkPacket {
  schema: "urn:usf:work-packet:1";
  id: string;
  contract: string;
  decisionBoundary: DecisionBoundary;
  /** Present on every graph-derived packet; optional only for typed legacy fixture construction. */
  semanticTrace?: SemanticTraceProjection;
  /** Present on every graph-derived packet; optional only for typed legacy fixture construction. */
  realisationAuthority?: RealisationAuthorityProjection;
  /** Present on every graph-derived packet; optional only for typed legacy fixture construction. */
  eligibility?: WorkEligibilityProjection;
  /** Dynamic graph-observed stage; excluded from the immutable construction packet digest. */
  realisationStage?: WorkRealisationStageProjection;
  objective: string;
  dependsOn: string[];
  semanticDependencies: Dependency[];
  readSet: string[];
  writeSet: string[];
  constraints: string[];
  requirements: RequirementProjection[];
  artifacts: ArtifactProjection[];
  acceptanceCriteria: Array<{ id: string; text: string }>;
  validationPlan: Array<{ id: string; command: string; environment: string; executionMode: string; applicability: Applicability }>;
  proofObligations: Array<{ id: string; text: string; environment: string; executionMode: string; applicability: Applicability }>;
  modelCapabilities: string[];
  constructionRouteConstraints: string[];
  targetRuntimeProvider: string;
  privacy: PrivacyClassification;
  environmentPosture: Array<{ binding?: string; environment: string; applicability: Applicability }>;
  outputSchema: string;
  stopConditions: string[];
  scopedDependencyDigest: string;
  realisationBasis?: import("../realisation/basis.ts").RealisationBasis;
}

export interface WorkOptions {
  selector?: string;
  profile?: string;
  ready?: boolean;
  stage?: "construct" | "integrate";
  maxItems?: number;
  shard?: string;
  stream?: boolean;
}
export interface WorkResult { schema: "urn:usf:work-result:1"; status: "ok" | "refused"; reasonCode?: string; semanticDigest?: string; outputMode?: "json" | "jsonl"; items?: WorkPacket[]; truncation?: { maxItems: number; returnedItems: number; truncated: boolean }; }

function refuse(reason: string): never { throw new Error(reason); }

function one(graph: SemanticGraph, subject: string, name: string): string {
  const values = objectValues(graph, subject, predicate(name));
  if (values.length !== 1) refuse(`WORK_PACKET_${name.toUpperCase()}_INVALID:${subject}`);
  return values[0];
}

function applicability(graph: SemanticGraph, subject: string): Applicability {
  const value = one(graph, subject, "applicability");
  if (!applicabilityStates.includes(value as Applicability)) refuse(`APPLICABILITY_INVALID:${subject}`);
  return value as Applicability;
}

function descriptions(graph: SemanticGraph, iris: string[], name: string): Array<{ id: string; text: string }> {
  return iris.map((id) => ({ id, text: one(graph, id, name) }));
}

function requirementProjections(graph: SemanticGraph, ids: string[]): RequirementProjection[] {
  return ids.map((id) => ({
    id,
    types: objectValues(graph, id, typePredicate),
    fields: objectsFor(graph, id)
      .map((quad) => ({ predicate: quad.predicate, value: quad.object, valueKind: quad.objectKind }))
      .sort((left, right) => `${left.predicate}|${left.valueKind}|${left.value}`.localeCompare(`${right.predicate}|${right.valueKind}|${right.value}`)),
  }));
}

function artifactProjections(graph: SemanticGraph, requirements: RequirementProjection[], writeSet: string[]): ArtifactProjection[] {
  return requirements.filter((requirement) => requirement.types.includes(artifactRequirementType)).map((requirement) => {
    const targetPath = repositoryPath(one(graph, requirement.id, "targetPath"), "ARTIFACT_TARGET");
    if (!writeSet.includes(targetPath)) refuse(`ARTIFACT_TARGET_NOT_IN_WRITE_SET:${requirement.id}:${targetPath}`);
    const modelCapabilities = objectValues(graph, requirement.id, predicate("modelCapability"));
    if (modelCapabilities.length === 0) refuse(`ARTIFACT_MODEL_CAPABILITY_REQUIRED:${requirement.id}`);
    return {
      id: requirement.id,
      artifactKind: one(graph, requirement.id, "artifactKind"),
      mediaType: one(graph, requirement.id, "mediaType"),
      targetPath,
      modelCapabilities,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
}

/** Concrete files and explicitly slash-terminated directories only; patterns are never pre-images. */
function repositoryPath(value: string, role: string): string {
  if (value.length === 0 || value === "." || value.includes("\\") || value.includes("\0") || value.startsWith("/") || value.startsWith("./") || /[*?\[\]{}!]/.test(value)) {
    return refuse(`WORK_${role}_PATH_INVALID:${value}`);
  }
  const directory = value.endsWith("/");
  const segments = value.slice(0, directory ? -1 : undefined).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return refuse(`WORK_${role}_PATH_INVALID:${value}`);
  if (posix.normalize(value) !== value) return refuse(`WORK_${role}_PATH_INVALID:${value}`);
  const first = segments[0];
  if (first === ".git" || first === ".usf" || first === ".env" || segments.some((segment) => segment === ".env")) return refuse(`WORK_${role}_PATH_PROHIBITED:${value}`);
  return value;
}

function directoryEntries(root: string, declaredPath: string): Array<{ path: string; digest: string }> {
  const walk = (directory: string): Array<{ path: string; digest: string }> => readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) return refuse(`WORK_DEPENDENCY_SYMLINK_REFUSED:${declaredPath}`);
      if (entry.isDirectory()) return walk(child);
      if (!entry.isFile()) return refuse(`WORK_DEPENDENCY_SPECIAL_FILE_REFUSED:${declaredPath}`);
      return [{ path: relative(root, child).split(sep).join("/"), digest: sha256(readFileSync(child)) }];
    });
  return walk(resolve(root, declaredPath));
}

function pathDigest(root: string, declaredPath: string, missingAllowed: boolean): string {
  const absolute = resolve(root, declaredPath);
  if (!isContained(root, absolute)) return refuse(`WORK_DEPENDENCY_PATH_ESCAPE:${declaredPath}`);
  if (!existsSync(absolute)) {
    if (!missingAllowed) return refuse(`WORK_DEPENDENCY_MISSING:${declaredPath}`);
    return sha256(`missing\u0000${declaredPath}`);
  }
  const real = realpathSync(absolute);
  if (!isContained(root, real)) return refuse(`WORK_DEPENDENCY_SYMLINK_ESCAPE:${declaredPath}`);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return refuse(`WORK_DEPENDENCY_SYMLINK_REFUSED:${declaredPath}`);
  if (declaredPath.endsWith("/") && !stat.isDirectory()) return refuse(`WORK_DIRECTORY_EXPECTED:${declaredPath}`);
  if (!declaredPath.endsWith("/") && stat.isDirectory()) return refuse(`WORK_FILE_EXPECTED:${declaredPath}`);
  if (stat.isDirectory()) return canonicalDigest(directoryEntries(root, declaredPath));
  if (!stat.isFile()) return refuse(`WORK_DEPENDENCY_SPECIAL_FILE_REFUSED:${declaredPath}`);
  return sha256(readFileSync(absolute));
}

function declaredPaths(graph: SemanticGraph, subjects: string[], name: "policyPath" | "schemaPath" | "toolPath"): string[] {
  return [...new Set(subjects.flatMap((subject) => objectValues(graph, subject, predicate(name))).map((path) => repositoryPath(path, name.toUpperCase())))].sort();
}

function fileDependency(graph: SemanticGraph, path: string, kind: Dependency["kind"], missingAllowed: boolean): Dependency {
  return { key: path, digest: pathDigest(graph.repositoryRoot, path, missingAllowed), kind };
}

function uniqueDependencies(dependencies: Dependency[]): Dependency[] {
  const byIdentity = new Map<string, Dependency>();
  for (const dependency of dependencies) {
    const identity = `${dependency.kind}|${dependency.key}`;
    const previous = byIdentity.get(identity);
    if (previous !== undefined && previous.digest !== dependency.digest) refuse(`WORK_DEPENDENCY_CONFLICT:${dependency.key}`);
    byIdentity.set(identity, dependency);
  }
  return [...byIdentity.values()].sort((left, right) => `${left.kind}|${left.key}`.localeCompare(`${right.kind}|${right.key}`));
}

function projectEnvironmentPosture(graph: SemanticGraph, contract: string): WorkPacket["environmentPosture"] {
  const bindings = iriList(graph, contract, "environmentApplicability");
  if (bindings.length === 0) return refuse(`CONTRACT_ENVIRONMENT_APPLICABILITY_REQUIRED:${contract}`);
  const environments = new Set<string>();
  return bindings.map((binding) => {
    const typed = objectsFor(graph, binding, typePredicate).some((quad) => quad.objectKind === "iri" && quad.object === environmentApplicabilityType);
    if (!typed) return refuse(`ENVIRONMENT_APPLICABILITY_TYPE_INVALID:${binding}`);
    const environment = oneIri(graph, binding, "environment");
    if (environments.has(environment)) return refuse(`ENVIRONMENT_APPLICABILITY_DUPLICATE:${contract}:${environment}`);
    environments.add(environment);
    return { binding, environment, applicability: applicability(graph, binding) };
  }).sort((left, right) => left.environment.localeCompare(right.environment));
}

function obligation(
  graph: SemanticGraph,
  id: string,
  textPredicate: "text" | "command",
  postures: WorkPacket["environmentPosture"],
): { id: string; environment: string; executionMode: string; applicability: Applicability; text?: string; command?: string } {
  const environment = oneIri(graph, id, "environment");
  if (!postures.some((posture) => posture.environment === environment)) refuse(`OBLIGATION_ENVIRONMENT_NOT_BOUND:${id}`);
  return { id, [textPredicate]: one(graph, id, textPredicate), environment, executionMode: oneIri(graph, id, "executionMode"), applicability: applicability(graph, id) };
}

function isPermittedWrite(write: string, permits: string[]): boolean {
  return permits.some((permission) => permission === write || (permission.endsWith("/") && write.startsWith(permission)));
}

function typedSubjects(graph: SemanticGraph, type: string): string[] {
  return [...new Set(graph.quads
    .filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri" && quad.object === type)
    .map((quad) => quad.subject))].sort();
}

function constructionPolicyForWork(graph: SemanticGraph, work: string): string | null {
  const policies = typedSubjects(graph, constructionAuthorityPublicationPolicyType)
    .filter((id) => objectsFor(graph, id, predicate("eligibleWork")).some((quad) => quad.objectKind === "iri" && quad.object === work));
  if (policies.length > 1) refuse(`CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS:${work}`);
  return policies[0] ?? null;
}

/** Follow the selected policy without importing another WorkPacket except through an explicit predecessor edge. */
function constructionPolicyResources(graph: SemanticGraph, policy: string | null, selectedWork: string, maximum = 1_000): string[] {
  if (policy === null) return [];
  try {
    return workDependencyResourceIris(graph, [policy, selectedWork], selectedWork, maximum);
  } catch (error) {
    if (error instanceof Error && error.message === "SEMANTIC_DEPENDENCY_LIMIT_EXCEEDED") {
      return refuse(`CONSTRUCTION_AUTHORITY_POLICY_CLOSURE_LIMIT:${selectedWork}`);
    }
    throw error;
  }
}
function hasType(graph: SemanticGraph, subject: string, type: string): boolean {
  return objectsFor(graph, subject, typePredicate).some((quad) => quad.objectKind === "iri" && quad.object === type);
}

/** Follow authored semantics, but import another WorkPacket content only through explicit predecessor edges. */
function workDependencyResourceIris(graph: SemanticGraph, seeds: Iterable<string>, selectedWork: string, maximum = 1_000): string[] {
  const initial = [...new Set(seeds)].sort();
  const ambiguousSeed = initial.find((resource) => resource !== selectedWork && hasType(graph, resource, workType));
  if (ambiguousSeed !== undefined) throw new Error("SEMANTIC_WORK_PACKET_SEED_INVALID:" + ambiguousSeed);
  const pending = [...initial];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const resource = pending.shift() as string;
    if (visited.has(resource)) continue;
    if (objectsFor(graph, resource).length === 0) throw new Error("SEMANTIC_RESOURCE_UNRESOLVED:" + resource);
    visited.add(resource);
    if (visited.size > maximum) throw new Error("SEMANTIC_DEPENDENCY_LIMIT_EXCEEDED");
    for (const quad of objectsFor(graph, resource)) {
      if (quad.objectKind !== "iri" || objectsFor(graph, quad.object).length === 0 || visited.has(quad.object)) continue;
      const targetIsWork = hasType(graph, quad.object, workType);
      const explicitPredecessor = quad.predicate === predicate("dependsOn") && hasType(graph, resource, workType);
      if (targetIsWork && quad.object !== selectedWork && !explicitPredecessor) continue;
      pending.push(quad.object);
    }
    pending.sort();
  }
  return [...visited].sort();
}

function iriValues(graph: SemanticGraph, subject: string, name: string, reason: string, reasons: string[]): string[] {
  const quads = objectsFor(graph, subject, predicate(name));
  if (quads.some((quad) => quad.objectKind !== "iri")) reasons.push(`${reason}_KIND_INVALID:${subject}`);
  return quads.map((quad) => quad.object).sort();
}

function iriAuthorityValue(graph: SemanticGraph, subject: string, name: string, reason: string, reasons: string[]): string | null {
  const values = iriValues(graph, subject, name, reason, reasons);
  if (values.length === 0) reasons.push(`${reason}_MISSING:${subject}`);
  else if (values.length > 1) reasons.push(`${reason}_AMBIGUOUS:${subject}`);
  return values.length === 1 ? values[0] : null;
}

function optionalIriAuthorityValue(graph: SemanticGraph, subject: string, name: string, reason: string, reasons: string[]): string | null {
  const values = iriValues(graph, subject, name, reason, reasons);
  if (values.length > 1) reasons.push(`${reason}_AMBIGUOUS:${subject}`);
  return values.length === 1 ? values[0] : null;
}

function oneIri(graph: SemanticGraph, subject: string, name: string): string {
  const quads = objectsFor(graph, subject, predicate(name));
  if (quads.length !== 1 || quads[0]?.objectKind !== "iri") refuse(`WORK_PACKET_${name.toUpperCase()}_IRI_INVALID:${subject}`);
  return quads[0].object;
}

function iriList(graph: SemanticGraph, subject: string, name: string): string[] {
  const quads = objectsFor(graph, subject, predicate(name));
  if (quads.some((quad) => quad.objectKind !== "iri")) refuse(`WORK_PACKET_${name.toUpperCase()}_IRI_INVALID:${subject}`);
  return quads.map((quad) => quad.object).sort();
}

function authorityValue(graph: SemanticGraph, subject: string, name: string, reason: string, reasons: string[]): string | null {
  const values = objectValues(graph, subject, predicate(name));
  if (values.length === 0) reasons.push(`${reason}_MISSING:${subject}`);
  else if (values.length > 1) reasons.push(`${reason}_AMBIGUOUS:${subject}`);
  return values.length === 1 ? values[0] : null;
}

function equalSets(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === left.length
    && normalizedRight.length === right.length
    && normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

interface TraceEvaluation {
  trace: SemanticTraceProjection;
  reasons: string[];
}

function projectSemanticTrace(graph: SemanticGraph, contract: string, boundary: DecisionBoundary): TraceEvaluation {
  const reasons: string[] = [];
  const policy = iriAuthorityValue(graph, contract, "semanticOrderPolicy", "SEMANTIC_ORDER_POLICY", reasons);
  if (boundary.kind === "realisation-profile" && boundary.root !== null) {
    const profilePolicy = iriAuthorityValue(graph, boundary.root, "semanticOrderPolicy", "REALISATION_PROFILE_SEMANTIC_ORDER_POLICY", reasons);
    if (policy !== null && profilePolicy !== null && profilePolicy !== policy) reasons.push(`REALISATION_PROFILE_SEMANTIC_ORDER_POLICY_MISMATCH:${boundary.root}`);
  }

  const stages: SemanticTraceProjection["stages"] = [];
  let stopConditions: string[] = [];
  if (policy !== null) {
    if (!hasType(graph, policy, semanticOrderPolicyType)) reasons.push(`SEMANTIC_ORDER_POLICY_TYPE_INVALID:${policy}`);
    const first = iriAuthorityValue(graph, policy, "firstStage", "SEMANTIC_ORDER_FIRST_STAGE", reasons);
    stopConditions = objectValues(graph, policy, predicate("defaultStopCondition"));
    if (stopConditions.length === 0) reasons.push(`SEMANTIC_ORDER_STOP_CONDITION_MISSING:${policy}`);
    else if (new Set(stopConditions).size !== stopConditions.length) reasons.push(`SEMANTIC_ORDER_STOP_CONDITION_DUPLICATE:${policy}`);

    const visited = new Set<string>();
    let current = first;
    for (let expectedOrder = 1; expectedOrder <= 7 && current !== null; expectedOrder += 1) {
      if (visited.has(current)) {
        reasons.push(`SEMANTIC_ORDER_STAGE_CYCLE:${current}`);
        break;
      }
      visited.add(current);
      if (!hasType(graph, current, semanticStageType)) reasons.push(`SEMANTIC_ORDER_STAGE_TYPE_INVALID:${current}`);
      const order = authorityValue(graph, current, "order", "SEMANTIC_ORDER_STAGE_ORDER", reasons);
      if (order !== String(expectedOrder)) reasons.push(`SEMANTIC_ORDER_STAGE_SEQUENCE_INVALID:${current}`);
      stages.push({ id: current, order: expectedOrder });
      const successors = iriValues(graph, current, "precedes", "SEMANTIC_ORDER_STAGE_SUCCESSOR", reasons);
      if (expectedOrder < 7) {
        if (successors.length !== 1) {
          reasons.push(`SEMANTIC_ORDER_STAGE_SUCCESSOR_INVALID:${current}`);
          current = null;
        } else current = successors[0];
      } else {
        if (successors.length !== 0) reasons.push(`SEMANTIC_ORDER_STAGE_TERMINUS_INVALID:${current}`);
        current = null;
      }
    }
    if (stages.length !== 7) reasons.push(`SEMANTIC_ORDER_STAGE_COUNT_INVALID:${policy}`);
    if (stages.length === 7) {
      const final = stages[6]?.id as string;
      if (!equalSets(iriValues(graph, final, "feeds", "SEMANTIC_ORDER_VALIDATION_FEEDBACK", reasons), [stages[2]?.id as string])) reasons.push(`SEMANTIC_ORDER_VALIDATION_FEEDBACK_INVALID:${final}`);
      if (!equalSets(iriValues(graph, final, "mayRefine", "SEMANTIC_ORDER_REMODEL_FEEDBACK", reasons), [stages[0]?.id as string])) reasons.push(`SEMANTIC_ORDER_REMODEL_FEEDBACK_INVALID:${final}`);
    }
  }
  return { trace: { policy, complete: reasons.length === 0, stages, stopConditions }, reasons: [...new Set(reasons)].sort() };
}

interface AuthorityEvaluation {
  authority: RealisationAuthorityProjection;
  reasons: string[];
  permission: string | null;
  evidenceRequirement: string | null;
  proofObligation: string | null;
  proofAlgorithm: string | null;
}

function projectAuthority(graph: SemanticGraph, contract: string): AuthorityEvaluation {
  const reasons: string[] = [];
  const contractShape = iriAuthorityValue(graph, contract, "contractShape", "CONTRACT_SHAPE", reasons);
  if (contractShape !== null && contractShape !== semanticFirstContractShape) reasons.push(`CONTRACT_SHAPE_UNSUPPORTED:${contract}`);
  const constructionEvidenceRequirement = iriAuthorityValue(graph, contract, "constructionEvidenceRequirement", "CONSTRUCTION_EVIDENCE_REQUIREMENT", reasons);
  const constructionProofObligation = iriAuthorityValue(graph, contract, "constructionProofObligation", "CONSTRUCTION_PROOF_OBLIGATION", reasons);
  if (!equalSets(iriValues(graph, contract, "evidenceRequirement", "CONTRACT_COMPAT_EVIDENCE_REQUIREMENT", reasons), constructionEvidenceRequirement === null ? [] : [constructionEvidenceRequirement])) reasons.push(`CONTRACT_COMPAT_EVIDENCE_REQUIREMENT_MISMATCH:${contract}`);
  if (!equalSets(iriValues(graph, contract, "mandatoryProofObligation", "CONTRACT_COMPAT_PROOF_OBLIGATION", reasons), constructionProofObligation === null ? [] : [constructionProofObligation])) reasons.push(`CONTRACT_COMPAT_PROOF_OBLIGATION_MISMATCH:${contract}`);
  const completionEvidenceRequirement = iriAuthorityValue(graph, contract, "completionEvidenceRequirement", "COMPLETION_EVIDENCE_REQUIREMENT", reasons);
  const completionValidationObligations = iriValues(graph, contract, "completionValidationObligation", "COMPLETION_VALIDATION_OBLIGATION", reasons);
  if (completionValidationObligations.length === 0) reasons.push(`COMPLETION_VALIDATION_OBLIGATION_MISSING:${contract}`);
  else if (new Set(completionValidationObligations).size !== completionValidationObligations.length) reasons.push(`COMPLETION_VALIDATION_OBLIGATION_AMBIGUOUS:${contract}`);
  const completionProofObligation = iriAuthorityValue(graph, contract, "completionProofObligation", "COMPLETION_PROOF_OBLIGATION", reasons);
  if (constructionEvidenceRequirement !== null && completionEvidenceRequirement === constructionEvidenceRequirement) reasons.push(`CONSTRUCTION_COMPLETION_EVIDENCE_NOT_SEPARATE:${contract}`);
  if (constructionProofObligation !== null && completionProofObligation === constructionProofObligation) reasons.push(`CONSTRUCTION_COMPLETION_PROOF_NOT_SEPARATE:${contract}`);

  if (constructionEvidenceRequirement !== null) {
    if (!hasType(graph, constructionEvidenceRequirement, constructionEvidenceRequirementType)) reasons.push(`CONSTRUCTION_EVIDENCE_REQUIREMENT_TYPE_INVALID:${constructionEvidenceRequirement}`);
    if (objectValues(graph, constructionEvidenceRequirement, predicate("applicability")).length !== 1 || objectValues(graph, constructionEvidenceRequirement, predicate("applicability"))[0] !== "required") reasons.push(`CONSTRUCTION_EVIDENCE_APPLICABILITY_NOT_REQUIRED:${constructionEvidenceRequirement}`);
  }
  let proofAlgorithm: string | null = null;
  if (constructionProofObligation !== null) {
    if (!hasType(graph, constructionProofObligation, constructionProofObligationType)) reasons.push(`CONSTRUCTION_PROOF_OBLIGATION_TYPE_INVALID:${constructionProofObligation}`);
    if (!equalSets(iriValues(graph, constructionProofObligation, "requiresEvidence", "CONSTRUCTION_PROOF_EVIDENCE", reasons), constructionEvidenceRequirement === null ? [] : [constructionEvidenceRequirement])) reasons.push(`CONSTRUCTION_PROOF_EVIDENCE_MISMATCH:${constructionProofObligation}`);
    proofAlgorithm = iriAuthorityValue(graph, constructionProofObligation, "algorithm", "CONSTRUCTION_PROOF_ALGORITHM", reasons);
    if (objectValues(graph, constructionProofObligation, predicate("applicability")).length !== 1 || objectValues(graph, constructionProofObligation, predicate("applicability"))[0] !== "required") reasons.push(`CONSTRUCTION_PROOF_APPLICABILITY_NOT_REQUIRED:${constructionProofObligation}`);
  }
  if (completionEvidenceRequirement !== null && !hasType(graph, completionEvidenceRequirement, completionEvidenceRequirementType)) reasons.push(`COMPLETION_EVIDENCE_REQUIREMENT_TYPE_INVALID:${completionEvidenceRequirement}`);
  if (completionProofObligation !== null && !hasType(graph, completionProofObligation, completionProofObligationType)) reasons.push(`COMPLETION_PROOF_OBLIGATION_TYPE_INVALID:${completionProofObligation}`);

  const permission = iriAuthorityValue(graph, contract, "realisationPermission", "REALISATION_PERMISSION", reasons);
  let permissionProjection: RealisationAuthorityProjection["permission"] = null;
  if (permission !== null) {
    if (!hasType(graph, permission, realisationPermissionType)) reasons.push(`REALISATION_PERMISSION_TYPE_INVALID:${permission}`);
    if (!equalSets(iriValues(graph, permission, "forContract", "REALISATION_PERMISSION_CONTRACT", reasons), [contract])) reasons.push(`REALISATION_PERMISSION_CONTRACT_MISMATCH:${permission}`);
    if (!equalSets(iriValues(graph, permission, "constructionEvidenceRequirement", "REALISATION_PERMISSION_EVIDENCE", reasons), constructionEvidenceRequirement === null ? [] : [constructionEvidenceRequirement])) reasons.push(`REALISATION_PERMISSION_EVIDENCE_MISMATCH:${permission}`);
    if (!equalSets(iriValues(graph, permission, "constructionProofObligation", "REALISATION_PERMISSION_PROOF", reasons), constructionProofObligation === null ? [] : [constructionProofObligation])) reasons.push(`REALISATION_PERMISSION_PROOF_MISMATCH:${permission}`);
    if (!equalSets(iriValues(graph, permission, "evidenceRequirement", "REALISATION_PERMISSION_COMPAT_EVIDENCE", reasons), constructionEvidenceRequirement === null ? [] : [constructionEvidenceRequirement])) reasons.push(`REALISATION_PERMISSION_COMPAT_EVIDENCE_MISMATCH:${permission}`);
    if (!equalSets(iriValues(graph, permission, "proofObligation", "REALISATION_PERMISSION_COMPAT_PROOF", reasons), constructionProofObligation === null ? [] : [constructionProofObligation])) reasons.push(`REALISATION_PERMISSION_COMPAT_PROOF_MISMATCH:${permission}`);
    if (!equalSets(iriValues(graph, permission, "completionValidationObligation", "REALISATION_PERMISSION_COMPLETION_VALIDATION", reasons), completionValidationObligations)) reasons.push(`REALISATION_PERMISSION_COMPLETION_VALIDATION_MISMATCH:${permission}`);
    if (iriValues(graph, permission, "validationObligation", "REALISATION_PERMISSION_POSTVALIDATION_AUTHORITY", reasons).length !== 0) reasons.push(`REALISATION_PERMISSION_POSTVALIDATION_AUTHORITY_INVALID:${permission}`);
    const activationState = iriAuthorityValue(graph, permission, "activationState", "REALISATION_PERMISSION_ACTIVATION_STATE", reasons);
    if (activationState !== null && activationState !== proofblockedState && activationState !== activeState) reasons.push(`REALISATION_PERMISSION_ACTIVATION_STATE_INVALID:${permission}`);
    const maximumThrough = authorityValue(graph, permission, "maximumThrough", "REALISATION_PERMISSION_MAXIMUM_THROUGH", reasons);
    if (maximumThrough !== null && !deliveryCeilings.includes(maximumThrough as typeof deliveryCeilings[number])) reasons.push(`REALISATION_PERMISSION_MAXIMUM_THROUGH_INVALID:${permission}`);
    const requiresPermissions = iriValues(graph, permission, "requiresPermission", "REALISATION_PERMISSION_DEPENDENCY", reasons);
    if (new Set(requiresPermissions).size !== requiresPermissions.length || requiresPermissions.includes(permission)) reasons.push(`REALISATION_PERMISSION_DEPENDENCY_INVALID:${permission}`);
    const semanticPolicies = iriValues(graph, contract, "semanticOrderPolicy", "REALISATION_PERMISSION_SEMANTIC_POLICY", reasons);
    const governingPermissions = semanticPolicies.length === 1
      ? iriValues(graph, semanticPolicies[0] as string, "governingPermission", "REALISATION_PERMISSION_GOVERNING", reasons)
      : [];
    if (semanticPolicies.length !== 1 || governingPermissions.length !== 1) reasons.push(`REALISATION_PERMISSION_GOVERNING_INVALID:${permission}`);
    const effectiveRequiresPermissions = governingPermissions.length === 1 && permission !== governingPermissions[0]
      ? [...new Set([...requiresPermissions, governingPermissions[0] as string])].sort()
      : requiresPermissions;
    const activationCurrentness = optionalIriAuthorityValue(graph, permission, "activationCurrentness", "REALISATION_PERMISSION_CURRENTNESS", reasons);
    permissionProjection = { id: permission, activationState, maximumThrough, requiresPermissions: effectiveRequiresPermissions, activationCurrentness };
  }

  return {
    authority: {
      contractShape,
      constructionEvidenceRequirement,
      constructionProofObligation,
      completionEvidenceRequirement,
      completionValidationObligations,
      completionProofObligation,
      permission: permissionProjection,
    },
    reasons: [...new Set(reasons)].sort(),
    permission,
    evidenceRequirement: constructionEvidenceRequirement,
    proofObligation: constructionProofObligation,
    proofAlgorithm,
  };
}

function digestValue(value: string | null, reason: string, subject: string, reasons: string[]): string | null {
  if (value !== null && !/^sha256:[0-9a-f]{64}$/u.test(value)) reasons.push(`${reason}_INVALID:${subject}`);
  return value;
}

function evidenceLeaves(graph: SemanticGraph, root: string, reasons: string[]): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const leaves = new Set<string>();
  const visit = (requirement: string): void => {
    if (visiting.has(requirement)) {
      reasons.push(`CONSTRUCTION_EVIDENCE_REQUIREMENT_CYCLE:${requirement}`);
      return;
    }
    if (visited.has(requirement)) return;
    visiting.add(requirement);
    visited.add(requirement);
    const applicabilityValues = objectValues(graph, requirement, predicate("applicability"));
    if (applicabilityValues.length !== 1 || applicabilityValues[0] !== "required") reasons.push(`CONSTRUCTION_EVIDENCE_APPLICABILITY_NOT_REQUIRED:${requirement}`);
    const children = iriValues(graph, requirement, "requiresEvidence", "CONSTRUCTION_EVIDENCE_REQUIREMENT", reasons);
    if (new Set(children).size !== children.length) reasons.push(`CONSTRUCTION_EVIDENCE_REQUIREMENT_AMBIGUOUS:${requirement}`);
    if (children.length === 0) leaves.add(requirement);
    else for (const child of children) {
      if (!graph.quads.some((quad) => quad.subject === child)) reasons.push(`CONSTRUCTION_EVIDENCE_REQUIREMENT_UNRESOLVED:${child}`);
      else visit(child);
    }
    visiting.delete(requirement);
  };
  visit(root);
  return [...leaves].sort();
}

interface ProofEvaluation {
  reasons: string[];
  dynamicResources: string[];
}

function evaluateProof(
  graph: SemanticGraph,
  authority: AuthorityEvaluation,
  authorityBasisDigest: string,
  workId: string,
): ProofEvaluation {
  const reasons = [...authority.reasons];
  const dynamicResources: string[] = [];
  if (authority.evidenceRequirement === null || authority.proofObligation === null || authority.proofAlgorithm === null) {
    return { reasons: [...new Set(reasons)].sort(), dynamicResources };
  }
  const aggregate = authority.proofObligation === "urn:usf:proof:semantic-first-order:construction-authority";

  const evidenceRows: Array<{ id: string; requirement: string; contentDigest: string; basisDigest: string; workId: string | null; scopedDependencyDigest: string | null }> = [];
  const leaves = evidenceLeaves(graph, authority.evidenceRequirement, reasons);
  const allEvidence = typedSubjects(graph, evidenceType);
  for (const requirement of leaves) {
    const matchingCandidates = allEvidence.filter((id) => {
      const requirements = objectsFor(graph, id, predicate("satisfiesEvidenceRequirement"));
      const works = objectsFor(graph, id, predicate("forWork"));
      return requirements.some((quad) => quad.objectKind === "iri" && quad.object === requirement)
        && (aggregate
          ? works.some((quad) => quad.objectKind === "iri" && canonicalBootstrapWorks.includes(quad.object as typeof canonicalBootstrapWorks[number]))
          : works.some((quad) => quad.objectKind === "iri" && quad.object === workId));
    });
    const candidates = aggregate ? matchingCandidates : matchingCandidates.filter((id) => {
      const scoped = objectsFor(graph, id, predicate("scopedDependencyDigest"));
      if (scoped.length !== 1 || scoped[0]?.objectKind !== "literal" || !/^sha256:[0-9a-f]{64}$/u.test(scoped[0].object)) {
        reasons.push(`CONSTRUCTION_EVIDENCE_SCOPED_DIGEST_INVALID:${id}`);
        dynamicResources.push(id);
        return false;
      }
      return scoped[0].object === authorityBasisDigest;
    });
    if (candidates.length === 0) {
      reasons.push(`CONSTRUCTION_EVIDENCE_MISSING:${requirement}`);
      continue;
    }
    if (candidates.length > 1) {
      reasons.push(`CONSTRUCTION_EVIDENCE_AMBIGUOUS:${requirement}`);
      dynamicResources.push(...candidates);
      continue;
    }
    const evidence = candidates[0] as string;
    dynamicResources.push(evidence);
    if (!equalSets(iriValues(graph, evidence, "satisfiesEvidenceRequirement", "CONSTRUCTION_EVIDENCE_REQUIREMENT", reasons), [requirement])) reasons.push(`CONSTRUCTION_EVIDENCE_REQUIREMENT_MISMATCH:${evidence}`);
    const validationDigest = digestValue(authorityValue(graph, evidence, "validationResultDigest", "CONSTRUCTION_EVIDENCE_VALIDATION_DIGEST", reasons), "CONSTRUCTION_EVIDENCE_VALIDATION_DIGEST", evidence, reasons);
    const basisDigest = digestValue(authorityValue(graph, evidence, "realisationBasisDigest", "CONSTRUCTION_EVIDENCE_BASIS_DIGEST", reasons), "CONSTRUCTION_EVIDENCE_BASIS_DIGEST", evidence, reasons);
    const scopedDigest = digestValue(authorityValue(graph, evidence, "scopedDependencyDigest", "CONSTRUCTION_EVIDENCE_SCOPED_DIGEST", reasons), "CONSTRUCTION_EVIDENCE_SCOPED_DIGEST", evidence, reasons);
    const evidenceWorkId = optionalIriAuthorityValue(graph, evidence, "forWork", "CONSTRUCTION_EVIDENCE_WORK", reasons);
    const contentDigest = digestValue(authorityValue(graph, evidence, "contentDigest", "CONSTRUCTION_EVIDENCE_CONTENT_DIGEST", reasons), "CONSTRUCTION_EVIDENCE_CONTENT_DIGEST", evidence, reasons);
    if (validationDigest !== null && basisDigest !== null && contentDigest !== null) evidenceRows.push({ id: evidence, requirement, contentDigest, basisDigest, workId: evidenceWorkId, scopedDependencyDigest: scopedDigest });
  }

  const matchingProofCandidates = typedSubjects(graph, proofResultType)
    .filter((id) => objectsFor(graph, id, predicate("forObligation")).some((quad) => quad.objectKind === "iri" && quad.object === authority.proofObligation)
      && (aggregate || objectsFor(graph, id, predicate("forWork")).some((quad) => quad.objectKind === "iri" && quad.object === workId)));
  const proofCandidates = aggregate ? matchingProofCandidates : matchingProofCandidates.filter((id) => {
    const scoped = objectsFor(graph, id, predicate("scopedDependencyDigest"));
    if (scoped.length !== 1 || scoped[0]?.objectKind !== "literal" || !/^sha256:[0-9a-f]{64}$/u.test(scoped[0].object)) {
      reasons.push(`CONSTRUCTION_PROOF_RESULT_SCOPED_DIGEST_INVALID:${id}`);
      dynamicResources.push(id);
      return false;
    }
    return scoped[0].object === authorityBasisDigest;
  });
  if (proofCandidates.length === 0) reasons.push(`CONSTRUCTION_PROOF_RESULT_MISSING:${authority.proofObligation}`);
  else if (proofCandidates.length > 1) {
    reasons.push(`CONSTRUCTION_PROOF_RESULT_AMBIGUOUS:${authority.proofObligation}`);
    dynamicResources.push(...proofCandidates);
  } else {
    const proof = proofCandidates[0] as string;
    dynamicResources.push(proof);
    if (!equalSets(iriValues(graph, proof, "forObligation", "CONSTRUCTION_PROOF_RESULT_OBLIGATION", reasons), [authority.proofObligation])) reasons.push(`CONSTRUCTION_PROOF_RESULT_OBLIGATION_MISMATCH:${proof}`);
    const algorithm = iriAuthorityValue(graph, proof, "algorithm", "CONSTRUCTION_PROOF_RESULT_ALGORITHM", reasons);
    if (algorithm !== null && algorithm !== authority.proofAlgorithm) reasons.push(`CONSTRUCTION_PROOF_RESULT_ALGORITHM_MISMATCH:${proof}`);
    const evidenceDigest = digestValue(authorityValue(graph, proof, "evidenceDigest", "CONSTRUCTION_PROOF_RESULT_EVIDENCE_DIGEST", reasons), "CONSTRUCTION_PROOF_RESULT_EVIDENCE_DIGEST", proof, reasons);
    const basisDigest = aggregate ? null : digestValue(authorityValue(graph, proof, "realisationBasisDigest", "CONSTRUCTION_PROOF_RESULT_BASIS_DIGEST", reasons), "CONSTRUCTION_PROOF_RESULT_BASIS_DIGEST", proof, reasons);
    const scopedDigest = aggregate ? null : digestValue(authorityValue(graph, proof, "scopedDependencyDigest", "CONSTRUCTION_PROOF_RESULT_SCOPED_DIGEST", reasons), "CONSTRUCTION_PROOF_RESULT_SCOPED_DIGEST", proof, reasons);
    const outcome = authorityValue(graph, proof, "outcome", "CONSTRUCTION_PROOF_RESULT_OUTCOME", reasons);
    if (outcome !== null && outcome !== "pass") reasons.push(`CONSTRUCTION_PROOF_RESULT_FAILED:${proof}`);
    const evidenceBasisDigests = [...new Set(evidenceRows.map((row) => row.basisDigest))];
    if (aggregate) {
      const admissionSets = iriValues(graph, canonicalBootstrapException, "admissionWorkSet", "CONSTRUCTION_PROOF_RESULT_ADMISSION_SET", reasons);
      const admissionSet = admissionSets.length === 1 ? admissionSets[0] as string : null;
      const declaredWorks = iriValues(graph, canonicalBootstrapException, "forWork", "CONSTRUCTION_PROOF_RESULT_AGGREGATE_WORK", reasons);
      const declaredMembers = admissionSet === null ? [] : iriValues(graph, admissionSet, "member", "CONSTRUCTION_PROOF_RESULT_AGGREGATE_MEMBER", reasons);
      const orderedWorks = declaredWorks.map((workId) => {
        const orderValues = objectsFor(graph, workId, predicate("bootstrapOrder"));
        const order = orderValues.length === 1 && orderValues[0]?.objectKind === "literal" && /^[1-3]$/u.test(orderValues[0].object)
          ? Number(orderValues[0].object)
          : 0;
        return { workId, order };
      }).sort((left, right) => left.order - right.order || left.workId.localeCompare(right.workId));
      const evidenceWorkIds = evidenceRows.map((row) => row.workId).filter((workId): workId is string => workId !== null);
      if (admissionSet === null || admissionSet !== canonicalBootstrapAdmissionWorkSet
        || declaredWorks.length !== 3 || new Set(declaredWorks).size !== 3 || !equalSets(declaredWorks, declaredMembers)
        || orderedWorks.some(({ order }) => order < 1) || !equalSets(orderedWorks.map(({ order }) => String(order)), ["1", "2", "3"])
        || evidenceRows.length !== 3 || evidenceWorkIds.length !== 3 || new Set(evidenceWorkIds).size !== 3
        || !equalSets(evidenceWorkIds, declaredWorks)) reasons.push(`CONSTRUCTION_PROOF_RESULT_AGGREGATE_MEMBERS_INVALID:${proof}`);
      const bootstrapOrder = new Map(orderedWorks.map(({ workId, order }) => [workId, order]));
      const memberRows = evidenceRows.map((row) => ({ order: row.workId === null ? 0 : bootstrapOrder.get(row.workId) ?? 0, workId: row.workId, basisDigest: row.basisDigest, scopedDependencyDigest: row.scopedDependencyDigest, workDigest: row.workId === null ? null : resourceDigest(graph, row.workId) })).sort((a, b) => a.order - b.order || String(a.workId).localeCompare(String(b.workId)));
      const admissionSetDigest = digestValue(authorityValue(graph, proof, "admissionSetDigest", "CONSTRUCTION_PROOF_RESULT_ADMISSION_SET_DIGEST", reasons), "CONSTRUCTION_PROOF_RESULT_ADMISSION_SET_DIGEST", proof, reasons);
      if (admissionSetDigest !== null && admissionSet !== null && admissionSetDigest !== canonicalDigest({ admissionSet, members: memberRows })) reasons.push(`CONSTRUCTION_PROOF_RESULT_ADMISSION_SET_MISMATCH:${proof}`);
      if (basisDigest !== null) reasons.push(`CONSTRUCTION_PROOF_RESULT_AGGREGATE_SINGLE_BASIS_FORBIDDEN:${proof}`);
    } else if (evidenceBasisDigests.length !== 1 || (basisDigest !== null && evidenceBasisDigests[0] !== basisDigest)) reasons.push(`CONSTRUCTION_PROOF_RESULT_BASIS_MISMATCH:${proof}`);
    const expectedEvidenceDigest = evidenceRows.length === 1
      ? evidenceRows[0]?.contentDigest
      : evidenceRows.length > 1
        ? canonicalDigest(evidenceRows.map(({ requirement, contentDigest }) => ({ requirement, contentDigest })))
        : null;
    if (evidenceDigest !== null && expectedEvidenceDigest !== evidenceDigest) reasons.push(`CONSTRUCTION_PROOF_RESULT_EVIDENCE_MISMATCH:${proof}`);
  }
  return { reasons: [...new Set(reasons)].sort(), dynamicResources: [...new Set(dynamicResources)].sort() };
}

interface CompletionEvaluation {
  readonly verified: boolean;
  readonly integrationReceipt: string | null;
  readonly evidence: string | null;
  readonly proofResult: string | null;
  readonly reasonCodes: string[];
  readonly dynamicResources: string[];
  readonly basisDependencies: Dependency[];
  readonly authorityDigest: string;
}

function evaluateLegacyCompletion(graph: SemanticGraph, packet: WorkPacket, basis: RealisationBasis): CompletionEvaluation {
  const reasons: string[] = [];
  const dynamicResources: string[] = [];
  const authority = packet.realisationAuthority;
  const requirement = authority?.completionEvidenceRequirement ?? null;
  const obligation = authority?.completionProofObligation ?? null;
  const validations = authority?.completionValidationObligations ?? [];
  if (requirement === null) reasons.push(`COMPLETION_EVIDENCE_REQUIREMENT_MISSING:${packet.contract}`);
  if (obligation === null) reasons.push(`COMPLETION_PROOF_OBLIGATION_MISSING:${packet.contract}`);
  if (packet.eligibility?.activation.eligible !== true || authority?.permission?.activationState !== activeState) reasons.push(`COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT:${packet.id}`);
  if (packet.eligibility?.dependencyReady !== true) reasons.push(`COMPLETION_PREDECESSOR_NOT_COMPLETE:${packet.id}`);

  const directAlgorithms = obligation === null ? [] : iriValues(graph, obligation, "algorithm", "COMPLETION_PROOF_ALGORITHM", reasons);
  const completionPolicies = iriValues(graph, packet.contract, "semanticOrderPolicy", "COMPLETION_SEMANTIC_POLICY", reasons);
  const policyAlgorithms = completionPolicies.length === 1
    ? iriValues(graph, completionPolicies[0] as string, "completionProofAlgorithm", "COMPLETION_POLICY_ALGORITHM", reasons)
    : [];
  const algorithmValues = [...new Set([...directAlgorithms, ...policyAlgorithms])].sort();
  const algorithm = algorithmValues.length === 1 ? algorithmValues[0] as string : null;
  if (obligation !== null && algorithmValues.length !== 1) reasons.push(`COMPLETION_PROOF_ALGORITHM_INVALID:${obligation}`);
  if (algorithm !== null && !hasType(graph, algorithm, "urn:usf:type:ProofAlgorithm")) reasons.push(`COMPLETION_PROOF_ALGORITHM_TYPE_INVALID:${algorithm}`);
  const verifierValues = algorithm === null ? [] : iriValues(graph, algorithm, "integrationTransitionVerifier", "COMPLETION_TRANSITION_VERIFIER", reasons);
  const verifier = verifierValues.length === 1 ? verifierValues[0] as string : null;
  if (algorithm !== null && (verifierValues.length !== 1 || verifier === null || !hasType(graph, verifier, "urn:usf:type:TransitionVerificationAlgorithm"))) reasons.push(`COMPLETION_TRANSITION_VERIFIER_INVALID:${algorithm}`);
  const implementationStates = verifier === null ? [] : iriValues(graph, verifier, "implementationState", "COMPLETION_IMPLEMENTATION_STATE", reasons);
  if (verifier !== null && !equalSets(implementationStates, [completionImplementationProofblocked])) reasons.push(`COMPLETION_IMPLEMENTATION_STATE_INVALID:${verifier}`);
  if (verifier !== null && implementationStates.includes(completionImplementationProofblocked)) reasons.push(`COMPLETION_POSTIMAGE_VERIFIER_PROOFBLOCKED:${verifier}`);

  const receiptTypeValues = algorithm === null ? [] : iriValues(graph, algorithm, "integrationRecordType", "COMPLETION_INTEGRATION_RECORD_TYPE", reasons);
  const receiptType = receiptTypeValues.length === 1 ? receiptTypeValues[0] as string : null;
  if (algorithm !== null && (receiptTypeValues.length !== 1 || receiptType !== admittedIntegrationReceiptType || !hasType(graph, receiptType, "urn:usf:type:SemanticRecordType"))) reasons.push(`COMPLETION_INTEGRATION_RECORD_TYPE_INVALID:${algorithm}`);
  const receiptSchemaValues = algorithm === null ? [] : iriValues(graph, algorithm, "integrationReceiptSchema", "COMPLETION_INTEGRATION_SCHEMA", reasons);
  const receiptSchema = receiptSchemaValues.length === 1 ? receiptSchemaValues[0] as string : null;
  if (algorithm !== null && (receiptSchemaValues.length !== 1 || receiptSchema === null || !hasType(graph, receiptSchema, "urn:usf:type:SemanticRecordSchema"))) reasons.push(`COMPLETION_INTEGRATION_SCHEMA_INVALID:${algorithm}`);
  const acceptedStates = algorithm === null ? [] : objectValues(graph, algorithm, predicate("acceptedIntegrationState"));
  const acceptedState = acceptedStates.length === 1 ? acceptedStates[0] as string : null;
  if (algorithm !== null && (acceptedStates.length !== 1 || acceptedState !== "accepted")) reasons.push(`COMPLETION_INTEGRATION_STATE_AUTHORITY_INVALID:${algorithm}`);

  let integrationReceipt: string | null = null;
  let integrationDigest: string | null = null;
  if (receiptType !== null) {
    const candidates = typedSubjects(graph, receiptType).filter((id) =>
      objectsFor(graph, id, predicate("forWork")).some((quad) => quad.objectKind === "iri" && quad.object === packet.id));
    dynamicResources.push(...candidates);
    if (candidates.length === 0) reasons.push(`COMPLETION_INTEGRATION_RECEIPT_MISSING:${packet.id}`);
    else if (candidates.length > 1) reasons.push(`COMPLETION_INTEGRATION_RECEIPT_AMBIGUOUS:${packet.id}`);
    else {
      integrationReceipt = candidates[0] as string;
      if (!equalSets(iriValues(graph, integrationReceipt, "forWork", "COMPLETION_INTEGRATION_WORK", reasons), [packet.id])) reasons.push(`COMPLETION_INTEGRATION_WORK_MISMATCH:${integrationReceipt}`);
      if (!equalSets(iriValues(graph, integrationReceipt, "schema", "COMPLETION_INTEGRATION_SCHEMA", reasons), receiptSchema === null ? [] : [receiptSchema])) reasons.push(`COMPLETION_INTEGRATION_SCHEMA_MISMATCH:${integrationReceipt}`);
      const state = authorityValue(graph, integrationReceipt, "state", "COMPLETION_INTEGRATION_STATE", reasons);
      const basisDigest = digestValue(authorityValue(graph, integrationReceipt, "realisationBasisDigest", "COMPLETION_INTEGRATION_BASIS_DIGEST", reasons), "COMPLETION_INTEGRATION_BASIS_DIGEST", integrationReceipt, reasons);
      const scopedDigest = digestValue(authorityValue(graph, integrationReceipt, "scopedDependencyDigest", "COMPLETION_INTEGRATION_SCOPED_DIGEST", reasons), "COMPLETION_INTEGRATION_SCOPED_DIGEST", integrationReceipt, reasons);
      const candidateDigest = digestValue(authorityValue(graph, integrationReceipt, "candidateDigest", "COMPLETION_INTEGRATION_CANDIDATE_DIGEST", reasons), "COMPLETION_INTEGRATION_CANDIDATE_DIGEST", integrationReceipt, reasons);
      const treeDigest = digestValue(authorityValue(graph, integrationReceipt, "integratedTreeDigest", "COMPLETION_INTEGRATION_TREE_DIGEST", reasons), "COMPLETION_INTEGRATION_TREE_DIGEST", integrationReceipt, reasons);
      const lineageDigest = digestValue(authorityValue(graph, integrationReceipt, "lineageDigest", "COMPLETION_INTEGRATION_LINEAGE_DIGEST", reasons), "COMPLETION_INTEGRATION_LINEAGE_DIGEST", integrationReceipt, reasons);
      integrationDigest = digestValue(authorityValue(graph, integrationReceipt, "integrationDigest", "COMPLETION_INTEGRATION_DIGEST", reasons), "COMPLETION_INTEGRATION_DIGEST", integrationReceipt, reasons);
      if (state !== acceptedState) reasons.push(`COMPLETION_INTEGRATION_NOT_ACCEPTED:${integrationReceipt}`);
      if (basisDigest !== null && basisDigest !== basis.basisDigest) reasons.push(`COMPLETION_INTEGRATION_BASIS_STALE:${integrationReceipt}`);
      if (scopedDigest !== null && scopedDigest !== basis.work.scopedDependencyDigest) reasons.push(`COMPLETION_INTEGRATION_SCOPED_STALE:${integrationReceipt}`);
      if (receiptSchema !== null && basisDigest !== null && scopedDigest !== null && candidateDigest !== null && treeDigest !== null && lineageDigest !== null
        && integrationDigest !== canonicalDigest({ schema: receiptSchema, work: packet.id, state, basisDigest, scopedDependencyDigest: scopedDigest, candidateDigest, integratedTreeDigest: treeDigest, lineageDigest })) reasons.push(`COMPLETION_INTEGRATION_DIGEST_MISMATCH:${integrationReceipt}`);
    }
  }

  let evidence: string | null = null;
  let evidenceContentDigest: string | null = null;
  if (requirement !== null) {
    const candidates = typedSubjects(graph, evidenceType).filter((id) =>
      objectsFor(graph, id, predicate("forWork")).some((quad) => quad.objectKind === "iri" && quad.object === packet.id)
      && objectsFor(graph, id, predicate("satisfiesEvidenceRequirement")).some((quad) => quad.objectKind === "iri" && quad.object === requirement));
    dynamicResources.push(...candidates);
    if (candidates.length === 0) reasons.push(`COMPLETION_EVIDENCE_MISSING:${packet.id}`);
    else if (candidates.length > 1) reasons.push(`COMPLETION_EVIDENCE_AMBIGUOUS:${packet.id}`);
    else {
      evidence = candidates[0] as string;
      if (!equalSets(iriValues(graph, evidence, "forWork", "COMPLETION_EVIDENCE_WORK", reasons), [packet.id])) reasons.push(`COMPLETION_EVIDENCE_WORK_MISMATCH:${evidence}`);
      if (!equalSets(iriValues(graph, evidence, "satisfiesEvidenceRequirement", "COMPLETION_EVIDENCE_REQUIREMENT", reasons), [requirement])) reasons.push(`COMPLETION_EVIDENCE_REQUIREMENT_MISMATCH:${evidence}`);
      if (!equalSets(iriValues(graph, evidence, "validationObligation", "COMPLETION_EVIDENCE_VALIDATION", reasons), validations)) reasons.push(`COMPLETION_EVIDENCE_VALIDATION_MISMATCH:${evidence}`);
      if (!equalSets(iriValues(graph, evidence, "integrationReceipt", "COMPLETION_EVIDENCE_INTEGRATION_RECEIPT", reasons), integrationReceipt === null ? [] : [integrationReceipt])) reasons.push(`COMPLETION_EVIDENCE_INTEGRATION_RECEIPT_MISMATCH:${evidence}`);
      const boundIntegrationDigest = digestValue(authorityValue(graph, evidence, "integrationDigest", "COMPLETION_EVIDENCE_INTEGRATION_DIGEST", reasons), "COMPLETION_EVIDENCE_INTEGRATION_DIGEST", evidence, reasons);
      if (boundIntegrationDigest !== integrationDigest) reasons.push(`COMPLETION_EVIDENCE_INTEGRATION_DIGEST_MISMATCH:${evidence}`);
      const validationDigest = digestValue(authorityValue(graph, evidence, "validationResultDigest", "COMPLETION_EVIDENCE_VALIDATION_DIGEST", reasons), "COMPLETION_EVIDENCE_VALIDATION_DIGEST", evidence, reasons);
      const basisDigest = digestValue(authorityValue(graph, evidence, "realisationBasisDigest", "COMPLETION_EVIDENCE_BASIS_DIGEST", reasons), "COMPLETION_EVIDENCE_BASIS_DIGEST", evidence, reasons);
      const scopedDigest = digestValue(authorityValue(graph, evidence, "scopedDependencyDigest", "COMPLETION_EVIDENCE_SCOPED_DIGEST", reasons), "COMPLETION_EVIDENCE_SCOPED_DIGEST", evidence, reasons);
      evidenceContentDigest = digestValue(authorityValue(graph, evidence, "contentDigest", "COMPLETION_EVIDENCE_CONTENT_DIGEST", reasons), "COMPLETION_EVIDENCE_CONTENT_DIGEST", evidence, reasons);
      if (basisDigest !== null && basisDigest !== basis.basisDigest) reasons.push(`COMPLETION_EVIDENCE_BASIS_STALE:${evidence}`);
      if (scopedDigest !== null && scopedDigest !== basis.work.scopedDependencyDigest) reasons.push(`COMPLETION_EVIDENCE_SCOPED_STALE:${evidence}`);
      if (validationDigest === null) reasons.push(`COMPLETION_EVIDENCE_VALIDATION_MISSING:${evidence}`);
    }
  }

  let proofResult: string | null = null;
  if (obligation !== null) {
    const candidates = typedSubjects(graph, proofResultType).filter((id) =>
      objectsFor(graph, id, predicate("forWork")).some((quad) => quad.objectKind === "iri" && quad.object === packet.id)
      && objectsFor(graph, id, predicate("forObligation")).some((quad) => quad.objectKind === "iri" && quad.object === obligation));
    dynamicResources.push(...candidates);
    if (candidates.length === 0) reasons.push(`COMPLETION_PROOF_RESULT_MISSING:${packet.id}`);
    else if (candidates.length > 1) reasons.push(`COMPLETION_PROOF_RESULT_AMBIGUOUS:${packet.id}`);
    else {
      proofResult = candidates[0] as string;
      if (!equalSets(iriValues(graph, proofResult, "forWork", "COMPLETION_PROOF_RESULT_WORK", reasons), [packet.id])) reasons.push(`COMPLETION_PROOF_RESULT_WORK_MISMATCH:${proofResult}`);
      if (!equalSets(iriValues(graph, proofResult, "forObligation", "COMPLETION_PROOF_RESULT_OBLIGATION", reasons), [obligation])) reasons.push(`COMPLETION_PROOF_RESULT_OBLIGATION_MISMATCH:${proofResult}`);
      if (!equalSets(iriValues(graph, proofResult, "algorithm", "COMPLETION_PROOF_RESULT_ALGORITHM", reasons), algorithm === null ? [] : [algorithm])) reasons.push(`COMPLETION_PROOF_RESULT_ALGORITHM_MISMATCH:${proofResult}`);
      if (!equalSets(iriValues(graph, proofResult, "integrationReceipt", "COMPLETION_PROOF_RESULT_INTEGRATION_RECEIPT", reasons), integrationReceipt === null ? [] : [integrationReceipt])) reasons.push(`COMPLETION_PROOF_RESULT_INTEGRATION_RECEIPT_MISMATCH:${proofResult}`);
      const boundIntegrationDigest = digestValue(authorityValue(graph, proofResult, "integrationDigest", "COMPLETION_PROOF_RESULT_INTEGRATION_DIGEST", reasons), "COMPLETION_PROOF_RESULT_INTEGRATION_DIGEST", proofResult, reasons);
      if (boundIntegrationDigest !== integrationDigest) reasons.push(`COMPLETION_PROOF_RESULT_INTEGRATION_DIGEST_MISMATCH:${proofResult}`);
      const basisDigest = digestValue(authorityValue(graph, proofResult, "realisationBasisDigest", "COMPLETION_PROOF_RESULT_BASIS_DIGEST", reasons), "COMPLETION_PROOF_RESULT_BASIS_DIGEST", proofResult, reasons);
      const scopedDigest = digestValue(authorityValue(graph, proofResult, "scopedDependencyDigest", "COMPLETION_PROOF_RESULT_SCOPED_DIGEST", reasons), "COMPLETION_PROOF_RESULT_SCOPED_DIGEST", proofResult, reasons);
      const evidenceDigest = digestValue(authorityValue(graph, proofResult, "evidenceDigest", "COMPLETION_PROOF_RESULT_EVIDENCE_DIGEST", reasons), "COMPLETION_PROOF_RESULT_EVIDENCE_DIGEST", proofResult, reasons);
      const outcome = authorityValue(graph, proofResult, "outcome", "COMPLETION_PROOF_RESULT_OUTCOME", reasons);
      if (basisDigest !== null && basisDigest !== basis.basisDigest) reasons.push(`COMPLETION_PROOF_RESULT_BASIS_STALE:${proofResult}`);
      if (scopedDigest !== null && scopedDigest !== basis.work.scopedDependencyDigest) reasons.push(`COMPLETION_PROOF_RESULT_SCOPED_STALE:${proofResult}`);
      if (evidenceDigest !== null && evidenceDigest !== evidenceContentDigest) reasons.push(`COMPLETION_PROOF_RESULT_EVIDENCE_MISMATCH:${proofResult}`);
      if (outcome !== "pass") reasons.push(`COMPLETION_PROOF_RESULT_FAILED:${proofResult}`);
    }
  }
  const reasonCodes = [...new Set(reasons)].sort();
  const resources = [...new Set(dynamicResources)].sort();
  return {
    verified: reasonCodes.length === 0,
    integrationReceipt,
    evidence,
    proofResult,
    reasonCodes,
    dynamicResources: resources,
    basisDependencies: basis.work.dependencies.map((dependency) => ({ ...dependency })),
    authorityDigest: canonicalDigest({ work: packet.id, basis: basis.basisDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest, requirement, obligation, validations, algorithm, verifier, integrationReceipt, integrationDigest, evidence, proofResult, resources: resources.map((id) => ({ id, digest: resourceDigest(graph, id) })), reasons: reasonCodes }),
  };
}

function evaluateCompletion(graph: SemanticGraph, packet: WorkPacket, basis: RealisationBasis): CompletionEvaluation {
  const completionPolicies = typedSubjects(graph, "urn:usf:type:NoChangeWorkCompletionPublicationPolicy").filter((policy) =>
    objectsFor(graph, policy, predicate("eligibleWork")).some((entry) => entry.objectKind === "iri" && entry.object === packet.id));
  if (completionPolicies.length === 0) return evaluateLegacyCompletion(graph, packet, basis);

  try {
    const projection = evaluateNoChangeCompletionRecords(graph, packet, basis);
    const reasons = [...projection.reasonCodes];
    if (packet.eligibility?.activation.eligible !== true
      || packet.realisationAuthority?.permission?.activationState !== activeState) {
      reasons.push(`COMPLETION_CONSTRUCTION_AUTHORITY_NOT_CURRENT:${packet.id}`);
    }
    if (packet.eligibility?.dependencyReady !== true) reasons.push(`COMPLETION_PREDECESSOR_NOT_COMPLETE:${packet.id}`);
    const reasonCodes = [...new Set(reasons)].sort();
    const resources = [...new Set([...projection.authorityResources, ...projection.dynamicResources])].sort();
    const basisDependencies = uniqueDependencies([
      ...basis.work.dependencies.map((dependency) => ({ ...dependency })),
      ...projection.authoritySchemaPaths.map((path) => fileDependency(graph, path, "schema", false)),
      ...projection.authorityToolPaths.map((path) => fileDependency(graph, path, "tool", false)),
      ...(projection.receiptDependency === undefined ? [] : [projection.receiptDependency]),
    ]);
    return {
      verified: reasonCodes.length === 0,
      integrationReceipt: projection.realisationReceipt,
      evidence: projection.evidence,
      proofResult: projection.proofResult,
      reasonCodes,
      dynamicResources: resources,
      basisDependencies,
      authorityDigest: canonicalDigest({
        work: packet.id,
        basis: basis.basisDigest,
        scopedDependencyDigest: basis.work.scopedDependencyDigest,
        receipt: projection.realisationReceipt,
        evidence: projection.evidence,
        proofResult: projection.proofResult,
        resources: resources.map((id) => ({ id, digest: resourceDigest(graph, id) })),
        dependencies: basisDependencies,
        reasons: reasonCodes,
      }),
    };
  } catch {
    const reasonCodes = [`WORK_COMPLETION_NO_CHANGE_AUTHORITY_INVALID:${packet.id}`];
    return {
      verified: false,
      integrationReceipt: null,
      evidence: null,
      proofResult: null,
      reasonCodes,
      dynamicResources: completionPolicies,
      basisDependencies: basis.work.dependencies.map((dependency) => ({ ...dependency })),
      authorityDigest: canonicalDigest({
        work: packet.id,
        basis: basis.basisDigest,
        scopedDependencyDigest: basis.work.scopedDependencyDigest,
        policies: completionPolicies,
        reasons: reasonCodes,
      }),
    };
  }
}

interface ExceptionEvaluation {
  id: string | null;
  maximumThrough: string | null;
  works: string[];
  reasons: string[];
}

const requiredBootstrapProhibitions = [
  "credential-access",
  "historical-source-mutation",
  "integration",
  "live-provider-contact",
  "runtime-activation",
  "semantic-publication-except-exact-self-closing-authority-admission",
] as const;
const requiredAdmissionPredicates = [
  "urn:usf:predicate:activationState",
  "urn:usf:predicate:algorithm",
  "urn:usf:predicate:contentDigest",
  "urn:usf:predicate:evidenceDigest",
  "urn:usf:predicate:forWork",
  "urn:usf:predicate:forObligation",
  "urn:usf:predicate:outcome",
  "urn:usf:predicate:admissionSetDigest",
  "urn:usf:predicate:realisationBasisDigest",
  "urn:usf:predicate:satisfiesEvidenceRequirement",
  "urn:usf:predicate:scopedDependencyDigest",
  "urn:usf:predicate:state",
  "urn:usf:predicate:type",
  "urn:usf:predicate:validationResultDigest",
] as const;

function evaluateException(graph: SemanticGraph, work: string, contract: string, authority: AuthorityEvaluation): ExceptionEvaluation {
  const reasons: string[] = [];
  const references = iriValues(graph, work, "constructionException", "BOOTSTRAP_EXCEPTION_REFERENCE", reasons);
  if (references.length === 0) return { id: null, maximumThrough: null, works: [], reasons: ["BOOTSTRAP_EXCEPTION_NOT_DECLARED"] };
  if (references.length > 1) return { id: null, maximumThrough: null, works: [], reasons: [...reasons, `BOOTSTRAP_EXCEPTION_AMBIGUOUS:${work}`].sort() };
  if (reasons.length > 0) return { id: null, maximumThrough: null, works: [], reasons: [...new Set(reasons)].sort() };
  const exception = references[0] as string;
  if (exception !== canonicalBootstrapException) reasons.push(`BOOTSTRAP_EXCEPTION_IDENTITY_INVALID:${exception}`);
  if (!hasType(graph, exception, bootstrapExceptionType)) reasons.push(`BOOTSTRAP_EXCEPTION_TYPE_INVALID:${exception}`);
  const state = iriAuthorityValue(graph, exception, "state", "BOOTSTRAP_EXCEPTION_STATE", reasons);
  if (state !== null && state !== openExceptionState) reasons.push(`BOOTSTRAP_EXCEPTION_NOT_OPEN:${exception}`);
  if (!equalSets(iriValues(graph, exception, "forContract", "BOOTSTRAP_EXCEPTION_CONTRACT", reasons), [contract])) reasons.push(`BOOTSTRAP_EXCEPTION_CONTRACT_MISMATCH:${exception}`);
  const works = iriValues(graph, exception, "forWork", "BOOTSTRAP_EXCEPTION_WORK_SET", reasons);
  if (works.length !== 3 || new Set(works).size !== 3 || !works.includes(work)) reasons.push(`BOOTSTRAP_EXCEPTION_WORK_SET_INVALID:${exception}`);
  if (!equalSets(works, canonicalBootstrapWorks)) reasons.push(`BOOTSTRAP_EXCEPTION_CANONICAL_WORK_SET_INVALID:${exception}`);
  const workSet = new Set(works);
  for (const declaredWork of works) {
    if (!hasType(graph, declaredWork, workType)
      || !equalSets(iriValues(graph, declaredWork, "contract", "BOOTSTRAP_EXCEPTION_WORK_CONTRACT", reasons), [contract])
      || !equalSets(iriValues(graph, declaredWork, "constructionException", "BOOTSTRAP_EXCEPTION_WORK_REFERENCE", reasons), [exception])) reasons.push(`BOOTSTRAP_EXCEPTION_WORK_INVALID:${declaredWork}`);
    const dependencies = iriValues(graph, declaredWork, "dependsOn", "BOOTSTRAP_EXCEPTION_DEPENDENCY_GRAPH", reasons);
    if (new Set(dependencies).size !== dependencies.length || dependencies.some((dependency) => !workSet.has(dependency))) reasons.push(`BOOTSTRAP_EXCEPTION_DEPENDENCY_GRAPH_OPEN:${declaredWork}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (declaredWork: string): void => {
    if (visiting.has(declaredWork)) {
      reasons.push(`BOOTSTRAP_EXCEPTION_DEPENDENCY_CYCLE:${declaredWork}`);
      return;
    }
    if (visited.has(declaredWork)) return;
    visiting.add(declaredWork);
    for (const dependency of iriValues(graph, declaredWork, "dependsOn", "BOOTSTRAP_EXCEPTION_DEPENDENCY_GRAPH", reasons)) if (workSet.has(dependency)) visit(dependency);
    visiting.delete(declaredWork);
    visited.add(declaredWork);
  };
  for (const declaredWork of works) visit(declaredWork);
  const admissionWorkSets = iriValues(graph, exception, "admissionWorkSet", "BOOTSTRAP_EXCEPTION_ADMISSION_WORK_SET", reasons);
  if (admissionWorkSets.length !== 1) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_WORK_SET_INVALID:${exception}`);
  const admissionWorkSet = admissionWorkSets[0] ?? null;
  let orderedWorks: string[] = [];
  if (admissionWorkSet !== null) {
    if (admissionWorkSet !== canonicalBootstrapAdmissionWorkSet) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_WORK_SET_IDENTITY_INVALID:${admissionWorkSet}`);
    if (!hasType(graph, admissionWorkSet, bootstrapAtomicAdmissionSetType)) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_WORK_SET_TYPE_INVALID:${admissionWorkSet}`);
    if (!equalSets(iriValues(graph, admissionWorkSet, "member", "BOOTSTRAP_EXCEPTION_ADMISSION_WORK_SET_MEMBERS", reasons), works)) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_WORK_SET_MEMBERS_INVALID:${admissionWorkSet}`);
    const exactSetFields: Array<[string, string, string]> = [
      ["memberCount", "3", "BOOTSTRAP_EXCEPTION_ADMISSION_WORK_SET_COUNT_INVALID"],
      ["dependencyPolicy", "atomic-construction-set-topological-execution", "BOOTSTRAP_EXCEPTION_ADMISSION_DEPENDENCY_POLICY_INVALID"],
      ["closurePolicy", "aggregate-after-all-focused-validations", "BOOTSTRAP_EXCEPTION_ADMISSION_CLOSURE_POLICY_INVALID"],
      ["memberCompletionAuthority", "none", "BOOTSTRAP_EXCEPTION_ADMISSION_MEMBER_AUTHORITY_INVALID"],
      ["postClosureMemberStage", "checked-awaiting-integration", "BOOTSTRAP_EXCEPTION_POST_CLOSURE_STAGE_INVALID"],
    ];
    for (const [name, expected, reason] of exactSetFields) {
      const value = authorityValue(graph, admissionWorkSet, name, reason, reasons);
      if (value !== null && value !== expected) reasons.push(`${reason}:${admissionWorkSet}`);
    }
    if (!equalSets(iriValues(graph, admissionWorkSet, "postClosureStageAuthority", "BOOTSTRAP_EXCEPTION_POST_CLOSURE_AUTHORITY", reasons), ["urn:usf:currentness:semantic-first-bootstrap-transition:1"])) reasons.push(`BOOTSTRAP_EXCEPTION_POST_CLOSURE_AUTHORITY_INVALID:${admissionWorkSet}`);
    const ordered = works.map((declaredWork) => {
      const values = objectsFor(graph, declaredWork, predicate("bootstrapOrder"));
      if (values.length !== 1 || values[0]?.objectKind !== "literal" || !/^[1-3]$/u.test(values[0]?.object ?? "")) {
        reasons.push(`BOOTSTRAP_EXCEPTION_WORK_ORDER_INVALID:${declaredWork}`);
        return { work: declaredWork, order: 0 };
      }
      return { work: declaredWork, order: Number(values[0]?.object) };
    }).sort((left, right) => left.order - right.order || left.work.localeCompare(right.work));
    if (!equalSets(ordered.map(({ order }) => String(order)), ["1", "2", "3"])) reasons.push(`BOOTSTRAP_EXCEPTION_WORK_ORDER_SET_INVALID:${admissionWorkSet}`);
    orderedWorks = ordered.map(({ work: declaredWork }) => declaredWork);
    for (let index = 0; index < orderedWorks.length; index += 1) {
      const expectedDependencies = index === 0 ? [] : [orderedWorks[index - 1] as string];
      if (!equalSets(iriValues(graph, orderedWorks[index] as string, "dependsOn", "BOOTSTRAP_EXCEPTION_WORK_ORDER_DEPENDENCY", reasons), expectedDependencies)) reasons.push(`BOOTSTRAP_EXCEPTION_WORK_ORDER_DEPENDENCY_INVALID:${orderedWorks[index]}`);
    }
  }
  const maximumThrough = authorityValue(graph, exception, "maximumThrough", "BOOTSTRAP_EXCEPTION_MAXIMUM_THROUGH", reasons);
  if (maximumThrough !== null && maximumThrough !== "check") reasons.push(`BOOTSTRAP_EXCEPTION_CEILING_INVALID:${exception}`);
  const exactResourceFields: Array<[string, string, string]> = [
    ["environment", "urn:usf:environment:hermetic", "BOOTSTRAP_EXCEPTION_ENVIRONMENT_INVALID"],
    ["executionMode", "urn:usf:mode:deterministic-test-substitute", "BOOTSTRAP_EXCEPTION_EXECUTION_MODE_INVALID"],
  ];
  for (const [name, expected, reason] of exactResourceFields) {
    const value = iriAuthorityValue(graph, exception, name, reason, reasons);
    if (value !== null && value !== expected) reasons.push(`${reason}:${exception}`);
  }
  const exactLiteralFields: Array<[string, string, string]> = [
    ["requiresIsolatedWriteSet", "true", "BOOTSTRAP_EXCEPTION_ISOLATION_INVALID"],
    ["providerRoutePolicy", "deterministic-fixture-only", "BOOTSTRAP_EXCEPTION_ROUTE_POLICY_INVALID"],
    ["permittedEffect", "exact-self-closing-authority-admission", "BOOTSTRAP_EXCEPTION_EFFECT_INVALID"],
  ];
  for (const [name, expected, reason] of exactLiteralFields) {
    const value = authorityValue(graph, exception, name, reason, reasons);
    if (value !== null && value !== expected) reasons.push(`${reason}:${exception}`);
  }
  if (!equalSets(objectValues(graph, exception, predicate("prohibitedEffect")), requiredBootstrapProhibitions)) reasons.push(`BOOTSTRAP_EXCEPTION_PROHIBITIONS_INVALID:${exception}`);
  if (!equalSets(iriValues(graph, exception, "closesWhen", "BOOTSTRAP_EXCEPTION_CLOSURE_PROOF", reasons), authority.proofObligation === null ? [] : [authority.proofObligation])) reasons.push(`BOOTSTRAP_EXCEPTION_CLOSURE_PROOF_INVALID:${exception}`);
  if (!equalSets(iriValues(graph, exception, "requiresActivePermissionAfterClosure", "BOOTSTRAP_EXCEPTION_CLOSURE_PERMISSION", reasons), authority.permission === null ? [] : [authority.permission])) reasons.push(`BOOTSTRAP_EXCEPTION_CLOSURE_PERMISSION_INVALID:${exception}`);
  if (authority.authority.permission?.activationState !== proofblockedState) reasons.push(`BOOTSTRAP_EXCEPTION_PERMISSION_STATE_INVALID:${exception}`);
  const admissionWritePath = authorityValue(graph, exception, "admissionWritePath", "BOOTSTRAP_EXCEPTION_ADMISSION_WRITE_PATH", reasons);
  const admissionReceiptPath = authorityValue(graph, exception, "admissionReceiptPath", "BOOTSTRAP_EXCEPTION_ADMISSION_RECEIPT_PATH", reasons);
  const admissionReceiptSchemaPath = authorityValue(graph, exception, "admissionReceiptSchemaPath", "BOOTSTRAP_EXCEPTION_ADMISSION_RECEIPT_SCHEMA_PATH", reasons);
  const admissionTransitionAlgorithm = iriAuthorityValue(graph, exception, "admissionTransitionAlgorithm", "BOOTSTRAP_EXCEPTION_ADMISSION_TRANSITION_ALGORITHM", reasons);
  const admissionGraph = iriAuthorityValue(graph, exception, "admissionGraph", "BOOTSTRAP_EXCEPTION_ADMISSION_GRAPH", reasons);
  const admissionProofObligation = iriAuthorityValue(graph, exception, "admissionProofObligation", "BOOTSTRAP_EXCEPTION_ADMISSION_PROOF_OBLIGATION", reasons);
  for (const name of ["admissionTransitionReceipt", "admissionPreState", "admissionPostState"]) iriAuthorityValue(graph, exception, name, `BOOTSTRAP_EXCEPTION_${name.toUpperCase()}`, reasons);
  for (const name of ["admissionMutationRule", "admissionReceiptRule", "closureCondition"]) authorityValue(graph, exception, name, `BOOTSTRAP_EXCEPTION_${name.toUpperCase()}`, reasons);
  const permittedWrites = contractWrites(graph, contract);
  for (const [path, reason] of [
    [admissionWritePath, "BOOTSTRAP_EXCEPTION_ADMISSION_WRITE_PATH_INVALID"],
    [admissionReceiptPath, "BOOTSTRAP_EXCEPTION_ADMISSION_RECEIPT_PATH_INVALID"],
    [admissionReceiptSchemaPath, "BOOTSTRAP_EXCEPTION_ADMISSION_RECEIPT_SCHEMA_PATH_INVALID"],
  ] as const) if (path !== null && !permittedWrites.includes(path)) reasons.push(`${reason}:${exception}`);
  if (admissionWritePath !== null && graph.sourceDigests[admissionWritePath] === undefined) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_SOURCE_NOT_SELECTED:${exception}`);
  if (admissionReceiptPath !== null && graph.sourceDigests[admissionReceiptPath] !== undefined) reasons.push(`BOOTSTRAP_EXCEPTION_RECEIPT_IN_SEMANTIC_MANIFEST:${exception}`);
  if (admissionTransitionAlgorithm !== null && !hasType(graph, admissionTransitionAlgorithm, "urn:usf:type:TransitionVerificationAlgorithm")) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_ALGORITHM_TYPE_INVALID:${exception}`);
  const resourceGraphs = [...new Set(objectsFor(graph, exception).map((quad) => quad.graph))];
  if (admissionGraph !== null && !equalSets(resourceGraphs, [admissionGraph])) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_GRAPH_MISMATCH:${exception}`);
  if (admissionProofObligation !== null && admissionProofObligation !== authority.proofObligation) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_PROOF_MISMATCH:${exception}`);
  const admissionResources = iriValues(graph, exception, "admissionResource", "BOOTSTRAP_EXCEPTION_ADMISSION_RESOURCES", reasons);
  const admissionEvidence = iriValues(graph, exception, "admissionEvidence", "BOOTSTRAP_EXCEPTION_ADMISSION_EVIDENCE", reasons);
  const admissionProofResults = iriValues(graph, exception, "admissionProofResult", "BOOTSTRAP_EXCEPTION_ADMISSION_PROOF_RESULT", reasons);
  const declaredAdmissionResources = authority.permission === null
    ? []
    : [...admissionEvidence, ...admissionProofResults, authority.permission, exception];
  if (admissionEvidence.length !== 3 || new Set(admissionEvidence).size !== 3) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_EVIDENCE_INVALID:${exception}`);
  if (admissionProofResults.length !== 1) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_PROOF_RESULT_INVALID:${exception}`);
  if (!equalSets(admissionResources, declaredAdmissionResources)) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_RESOURCES_INVALID:${exception}`);
  const admissionValidations = iriValues(graph, exception, "admissionValidation", "BOOTSTRAP_EXCEPTION_ADMISSION_VALIDATIONS", reasons);
  if (admissionValidations.length !== 3 || new Set(admissionValidations).size !== 3) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_VALIDATIONS_INVALID:${exception}`);
  const assignedValidations: string[] = [];
  for (const declaredWork of works) {
    const admitted = iriValues(graph, declaredWork, "validation", "BOOTSTRAP_EXCEPTION_WORK_VALIDATION", reasons).filter((validation) => admissionValidations.includes(validation));
    if (admitted.length !== 1) reasons.push(`BOOTSTRAP_EXCEPTION_WORK_VALIDATION_INVALID:${declaredWork}`);
    else assignedValidations.push(admitted[0] as string);
  }
  if (!equalSets(assignedValidations, admissionValidations)) reasons.push(`BOOTSTRAP_EXCEPTION_WORK_VALIDATION_SET_INVALID:${exception}`);
  if (authority.evidenceRequirement !== null) {
    const leaves = evidenceLeaves(graph, authority.evidenceRequirement, reasons);
    const leafValidations = leaves.flatMap((leaf) => iriValues(graph, leaf, "validationObligation", "BOOTSTRAP_EXCEPTION_EVIDENCE_VALIDATION", reasons));
    if (leaves.length !== 3 || !equalSets(leafValidations, admissionValidations)) reasons.push(`BOOTSTRAP_EXCEPTION_EVIDENCE_VALIDATION_SET_INVALID:${exception}`);
  }
  if (!equalSets(iriValues(graph, exception, "admissionPredicate", "BOOTSTRAP_EXCEPTION_ADMISSION_PREDICATES", reasons), requiredAdmissionPredicates)) reasons.push(`BOOTSTRAP_EXCEPTION_ADMISSION_PREDICATES_INVALID:${exception}`);
  return { id: exception, maximumThrough, works: orderedWorks.length === works.length ? orderedWorks : works, reasons: [...new Set(reasons)].sort() };
}

interface RequiredPermissionEvaluation {
  readonly reasons: string[];
  readonly resources: string[];
  readonly dependencies: Dependency[];
  readonly transitionVerifications: TransitionCurrentnessVerification[];
}

function evaluateRequiredPermissions(graph: SemanticGraph, authority: AuthorityEvaluation): RequiredPermissionEvaluation {
  const reasons: string[] = [];
  const resources: string[] = [];
  const dependencies: Dependency[] = [];
  const transitionVerifications: TransitionCurrentnessVerification[] = [];
  for (const requiredPermission of authority.authority.permission?.requiresPermissions ?? []) {
    resources.push(requiredPermission);
    if (!hasType(graph, requiredPermission, realisationPermissionType)) {
      reasons.push(`REQUIRED_PERMISSION_TYPE_INVALID:${requiredPermission}`);
      continue;
    }
    const states = iriValues(graph, requiredPermission, "activationState", "REQUIRED_PERMISSION_STATE", reasons);
    if (!equalSets(states, [activeState])) reasons.push(`REQUIRED_PERMISSION_NOT_ACTIVE:${requiredPermission}`);
    const obligations = iriValues(graph, requiredPermission, "constructionProofObligation", "REQUIRED_PERMISSION_PROOF_OBLIGATION", reasons);
    if (obligations.length !== 1) {
      reasons.push(`REQUIRED_PERMISSION_PROOF_OBLIGATION_INVALID:${requiredPermission}`);
      continue;
    }
    resources.push(obligations[0] as string);
    const results = typedSubjects(graph, proofResultType)
      .filter((id) => objectsFor(graph, id, predicate("forObligation")).some((quad) => quad.objectKind === "iri" && quad.object === obligations[0]));
    if (results.length !== 1 || objectValues(graph, results[0] as string, predicate("outcome")).length !== 1 || objectValues(graph, results[0] as string, predicate("outcome"))[0] !== "pass") reasons.push(`REQUIRED_PERMISSION_PROOF_NOT_PASSING:${requiredPermission}`);
    else resources.push(results[0] as string);
    const currentness = iriValues(graph, requiredPermission, "activationCurrentness", "REQUIRED_PERMISSION_CURRENTNESS", reasons);
    if (currentness.length > 1) reasons.push(`REQUIRED_PERMISSION_CURRENTNESS_AMBIGUOUS:${requiredPermission}`);
    else if (currentness.length === 1 && states.length === 1 && states[0] === activeState) {
      resources.push(currentness[0] as string);
      try {
        const verified = verifyTransitionActivationCurrentness(graph, currentness[0] as string, requiredPermission, requiredPermission);
        dependencies.push({ kind: "file", key: verified.normalizedReceiptDependency.path, digest: verified.normalizedReceiptDependency.digest });
        transitionVerifications.push(verified);
      }
      catch { reasons.push(`REQUIRED_PERMISSION_CURRENTNESS_UNVERIFIED:${requiredPermission}`); }
    }
  }
  return {
    reasons: [...new Set(reasons)].sort(),
    resources: [...new Set(resources)].sort(),
    dependencies: uniqueDependencies(dependencies),
    transitionVerifications,
  };
}

/** Generic kernel projection: work packets are discovered solely by typed graph data. */
export function semanticWorkPackets(graph: SemanticGraph): string[] {
  return [...new Set(graph.quads.filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri" && quad.object === workType).map((quad) => quad.subject))].sort();
}

interface PacketDerivationContext {
  readonly transitionCandidate?: VerifiedTransitionCandidateCurrentness;
  readonly completionMemo?: Map<string, CompletionEvaluation>;
  readonly completionStack?: Set<string>;
}

type NormalizedReceiptDependency = Readonly<{ path: string; digest: string }>;

interface PacketDerivation {
  readonly packet: WorkPacket;
  readonly transitionVerification?: TransitionCurrentnessVerification;
  readonly requiredTransitionVerifications: readonly TransitionCurrentnessVerification[];
  readonly normalizedReceiptDependency?: NormalizedReceiptDependency;
  readonly completion?: CompletionEvaluation;
}

function normalizeReceiptDependency(
  dependencies: readonly Dependency[],
  normalized: NormalizedReceiptDependency | undefined,
): Dependency[] {
  if (normalized === undefined) return [...dependencies];
  const matches = dependencies.filter((dependency) => dependency.kind === "file" && dependency.key === normalized.path);
  if (matches.length > 1) throw new Error("TRANSITION_RECEIPT_DEPENDENCY_AMBIGUOUS");
  if (matches.length === 0) return [...dependencies];
  return dependencies.map((dependency) => dependency.kind === "file" && dependency.key === normalized.path
    ? { ...dependency, digest: normalized.digest }
    : dependency);
}

function completionForWork(
  graph: SemanticGraph,
  workId: string,
  decisionBoundary: DecisionBoundary,
  manifestPath: string,
  context: PacketDerivationContext,
): CompletionEvaluation {
  const memo = context.completionMemo;
  const stack = context.completionStack;
  if (memo === undefined || stack === undefined) throw new Error("WORK_COMPLETION_CONTEXT_MISSING");
  const prior = memo.get(workId);
  if (prior !== undefined) return prior;
  if (stack.has(workId)) throw new Error(`WORK_DEPENDENCY_CYCLE:${workId}`);
  stack.add(workId);
  try {
    const derivation = materializePacket(graph, workId, decisionBoundary, manifestPath, context);
    if (derivation.completion === undefined) throw new Error(`WORK_COMPLETION_EVALUATION_MISSING:${workId}`);
    memo.set(workId, derivation.completion);
    return derivation.completion;
  } finally {
    stack.delete(workId);
  }
}

function packetFor(graph: SemanticGraph, id: string, decisionBoundary: DecisionBoundary, context: PacketDerivationContext = {}): PacketDerivation {
  const contract = oneIri(graph, id, "contract");
  const readSet = objectValues(graph, id, predicate("readPath")).map((path) => repositoryPath(path, "READ")).sort();
  const writeSet = objectValues(graph, id, predicate("writePath")).map((path) => repositoryPath(path, "WRITE")).sort();
  const permits = contractWrites(graph, contract).map((path) => repositoryPath(path, "PERMITTED_WRITE"));
  for (const write of writeSet) if (!isPermittedWrite(write, permits)) refuse(`WORK_WRITE_NOT_PERMITTED:${id}:${write}`);

  const acceptanceIds = iriList(graph, id, "acceptance");
  const validationIds = iriList(graph, id, "validation");
  const proofIds = iriList(graph, id, "proof");
  const requirementIds = iriList(graph, contract, "requires");
  const requirements = requirementProjections(graph, requirementIds);
  const artifacts = artifactProjections(graph, requirements, writeSet);
  const postures = projectEnvironmentPosture(graph, contract);
  const constructionPolicy = constructionPolicyForWork(graph, id);
  const pathSubjects = constructionPolicy === null ? [contract, id] : [contract, id, constructionPolicy];
  const policyPaths = declaredPaths(graph, pathSubjects, "policyPath");
  const schemaPaths = declaredPaths(graph, pathSubjects, "schemaPath");
  const toolPaths = declaredPaths(graph, pathSubjects, "toolPath");
  const resourceSeeds = [id, contract, ...requirementIds, ...acceptanceIds, ...validationIds, ...proofIds, ...postures.flatMap((posture) => posture.binding === undefined ? [posture.environment] : [posture.binding, posture.environment])];
  const resources = [...new Set([
    ...workDependencyResourceIris(graph, resourceSeeds, id),
    ...constructionPolicyResources(graph, constructionPolicy, id),
  ])];
  // A profile digest binds its exact selection policy, but its other selected
  // contracts are sibling roots rather than dependencies of this packet.
  if (decisionBoundary.kind === "realisation-profile" && decisionBoundary.root !== null) {
    resources.push(decisionBoundary.root, ...objectValues(graph, decisionBoundary.root, predicate("product")));
  }
  resources.sort();
  const rawStaticDependencies = uniqueDependencies([
    ...resources.map((key): Dependency => ({ key, digest: resourceDigest(graph, key), kind: "semantic-resource" })),
    ...readSet.map((path) => fileDependency(graph, path, "file", false)),
    ...writeSet.map((path) => fileDependency(graph, path, "file", true)),
    ...policyPaths.map((path) => fileDependency(graph, path, "policy", false)),
    ...schemaPaths.map((path) => fileDependency(graph, path, "schema", false)),
    ...toolPaths.map((path) => fileDependency(graph, path, "tool", false)),
  ]);
  const trace = projectSemanticTrace(graph, contract, decisionBoundary);
  const authority = projectAuthority(graph, contract);
  let transitionVerification: TransitionCurrentnessVerification | undefined;
  let normalizedReceiptDependency: NormalizedReceiptDependency | undefined;
  let currentnessReason: string | undefined;
  if (authority.authority.permission?.activationCurrentness !== null && authority.authority.permission?.activationCurrentness !== undefined) {
    try {
      if (authority.permission === null || decisionBoundary.root === null) throw new Error("TRANSITION_SELECTION_MISSING");
      if (context.transitionCandidate === undefined) {
        transitionVerification = verifyTransitionActivationCurrentness(graph, authority.authority.permission.activationCurrentness, authority.permission, decisionBoundary.root);
        normalizedReceiptDependency = transitionVerification.normalizedReceiptDependency;
      } else {
        assertVerifiedTransitionCandidateCurrentness(
          graph,
          authority.authority.permission.activationCurrentness,
          authority.permission,
          decisionBoundary.root,
          context.transitionCandidate,
        );
        normalizedReceiptDependency = context.transitionCandidate.normalizedReceiptDependency;
      }
    } catch {
      currentnessReason = `REALISATION_PERMISSION_CURRENTNESS_UNVERIFIED:${authority.permission}`;
    }
  }
  const requiredPermissions = evaluateRequiredPermissions(graph, authority);
  const staticDependencies = uniqueDependencies([
    ...normalizeReceiptDependency(rawStaticDependencies, currentnessReason === undefined ? normalizedReceiptDependency : undefined),
    ...requiredPermissions.resources.map((key): Dependency => ({ key, digest: resourceDigest(graph, key), kind: "semantic-resource" })),
    ...requiredPermissions.dependencies,
  ]);
  const authorityBasisDigest = canonicalDigest(staticDependencies);
  const proof = evaluateProof(graph, authority, authorityBasisDigest, id);
  const grant = authority.permission !== null
      && authority.evidenceRequirement !== null
      && authority.proofObligation !== null
      && authority.proofAlgorithm !== null
      && authority.authority.permission?.maximumThrough !== null
      && authority.authority.permission?.maximumThrough !== undefined
      && decisionBoundary.kind === "realisation-profile"
      && decisionBoundary.root !== null
    ? evaluateConstructionAuthorityGrant(graph, {
        workIri: id,
        permissionIri: authority.permission,
        profileIri: decisionBoundary.root,
        manifestPath: (graph as SemanticGraph & { manifestPath?: string }).manifestPath ?? "graph/manifest.json",
        evidenceRequirementIri: authority.evidenceRequirement,
        proofObligationIri: authority.proofObligation,
        proofAlgorithmIri: authority.proofAlgorithm,
        authorityBasisDigest,
        maximumThrough: authority.authority.permission.maximumThrough,
      })
    : { applicable: false, active: false, grantIri: null, evidenceIri: null, proofResultIri: null, reasonCodes: [], dynamicResources: [] };
  if (grant.active && proof.reasons.length === 0 && authority.authority.permission !== null) {
    authority.authority.permission = { ...authority.authority.permission, activationState: activeState };
  }
  const activationReasons = [...new Set([...trace.reasons, ...proof.reasons, ...grant.reasonCodes, ...requiredPermissions.reasons, ...(currentnessReason === undefined ? [] : [currentnessReason])])].sort();
  const activationEligible = activationReasons.length === 0;
  const permissionActive = authority.authority.permission?.activationState === activeState;
  const exception = evaluateException(graph, id, contract, authority);
  const dependsOn = workDependencies(graph, id);
  const manifestPath = (graph as SemanticGraph & { manifestPath?: string }).manifestPath ?? "graph/manifest.json";
  // Unscoped/work/contract selectors are inspection-only and cannot establish
  // current completion authority because they do not bind a versioned profile.
  const predecessorCompletions = decisionBoundary.kind === "realisation-profile"
    ? dependsOn.map((dependency) => completionForWork(graph, dependency, decisionBoundary, manifestPath, context))
    : [];
  const atomicExceptionDependencyReady = exception.id !== null
    && exception.reasons.length === 0
    && exception.works.includes(id)
    && dependsOn.every((dependency) => exception.works.includes(dependency));
  const transitionProjectionAvailable = transitionVerification !== undefined || context.transitionCandidate !== undefined;
  const transitionedAdmissionSet = !transitionProjectionAvailable
    ? null
    : objectValues(graph, canonicalBootstrapException, predicate("admissionWorkSet"))[0] ?? null;
  const transitionedMembers = transitionedAdmissionSet === null ? [] : iriValues(graph, transitionedAdmissionSet, "member", "BOOTSTRAP_TRANSITION_STAGE_MEMBER", []);
  const transitionStageDependencyReady = transitionProjectionAvailable
    && transitionedAdmissionSet === canonicalBootstrapAdmissionWorkSet
    && objectValues(graph, transitionedAdmissionSet, predicate("memberCompletionAuthority")).length === 1
    && objectValues(graph, transitionedAdmissionSet, predicate("memberCompletionAuthority"))[0] === "none"
    && objectValues(graph, transitionedAdmissionSet, predicate("postClosureMemberStage")).length === 1
    && objectValues(graph, transitionedAdmissionSet, predicate("postClosureMemberStage"))[0] === "checked-awaiting-integration"
    && equalSets(iriValues(graph, transitionedAdmissionSet, "postClosureStageAuthority", "BOOTSTRAP_TRANSITION_STAGE_AUTHORITY", []), [authority.authority.permission?.activationCurrentness ?? ""])
    && transitionedMembers.includes(id)
    && dependsOn.every((dependency) => transitionedMembers.includes(dependency));
  // Active construction permission and the bootstrap transition are not
  // completion. Ordinary dependencies unlock only when every direct
  // predecessor has exact current per-work completion authority.
  const verifiedCompletionDependencyReady = dependsOn.length > 0
    && predecessorCompletions.length === dependsOn.length
    && predecessorCompletions.every((completion) => completion.verified);
  const dependencyReady = dependsOn.length === 0 || atomicExceptionDependencyReady || transitionStageDependencyReady || verifiedCompletionDependencyReady;
  const dependencyAuthority: WorkEligibilityProjection["dependencyAuthority"] = atomicExceptionDependencyReady
    ? "bootstrap-atomic-admission"
    : transitionStageDependencyReady
      ? "bootstrap-transition-stage"
    : verifiedCompletionDependencyReady
      ? "verified-completion"
      : dependsOn.length === 0
      ? "no-dependencies"
      : "none";
  const profileBound = decisionBoundary.kind === "realisation-profile";
  const activeConstructionReasons = [...activationReasons];
  if (!dependencyReady) activeConstructionReasons.push(`WORK_DEPENDENCY_NOT_READY:${id}`);
  if (!profileBound) activeConstructionReasons.push("REALISATION_PROFILE_REQUIRED");
  if (!permissionActive) activeConstructionReasons.push(`REALISATION_PERMISSION_NOT_ACTIVE:${authority.permission ?? contract}`);
  const exceptionConstructionReasons = [...new Set([...trace.reasons, ...authority.reasons, ...exception.reasons])];
  if (!dependencyReady) exceptionConstructionReasons.push(`WORK_DEPENDENCY_NOT_READY:${id}`);
  if (!profileBound) exceptionConstructionReasons.push("REALISATION_PROFILE_REQUIRED");
  const activeConstructionEligible = activationEligible && permissionActive && dependencyReady && profileBound;
  const exceptionConstructionEligible = exception.id !== null && exceptionConstructionReasons.length === 0 && dependencyReady && profileBound;
  const construction = activeConstructionEligible
    ? { eligible: true, authority: "active-permission" as const, maximumThrough: authority.authority.permission?.maximumThrough ?? null, reasonCodes: [] }
    : exceptionConstructionEligible
      ? { eligible: true, authority: "bootstrap-exception" as const, maximumThrough: exception.maximumThrough, reasonCodes: [] }
      : {
          eligible: false,
          authority: "none" as const,
          maximumThrough: null,
          reasonCodes: [...new Set([...activeConstructionReasons, ...exceptionConstructionReasons])].sort(),
        };
  const dependencies = uniqueDependencies([
    ...staticDependencies,
    ...proof.dynamicResources.map((key): Dependency => ({ key, digest: resourceDigest(graph, key), kind: "semantic-resource" })),
    ...grant.dynamicResources.map((key): Dependency => ({ key, digest: resourceDigest(graph, key), kind: "semantic-resource" })),
    ...(grant.receiptDependency === undefined ? [] : [grant.receiptDependency]),
    ...predecessorCompletions.flatMap((completion) => completion.basisDependencies),
    ...predecessorCompletions.flatMap((completion) => completion.dynamicResources).map((key): Dependency => ({ key, digest: resourceDigest(graph, key), kind: "semantic-resource" })),
  ]);

  const modelCapabilities = [...new Set([
    ...objectValues(graph, contract, predicate("modelCapability")),
    ...objectValues(graph, id, predicate("modelCapability")),
    ...artifacts.flatMap((artifact) => artifact.modelCapabilities),
  ])].sort();
  if (modelCapabilities.length === 0) refuse(`MODEL_CAPABILITY_REQUIRED:${id}`);
  const privacy = one(graph, contract, "privacy");
  if (!privacyClasses.includes(privacy as PrivacyClassification)) refuse(`PRIVACY_CLASSIFICATION_INVALID:${contract}`);

  const validationPlan = validationIds.map((validationId) => obligation(graph, validationId, "command", postures)) as WorkPacket["validationPlan"];
  const proofObligations = proofIds.map((proofId) => obligation(graph, proofId, "text", postures)) as WorkPacket["proofObligations"];
  const packet: WorkPacket = {
    schema: "urn:usf:work-packet:1",
    id,
    contract,
    decisionBoundary,
    semanticTrace: trace.trace,
    realisationAuthority: authority.authority,
    eligibility: {
      dependencyReady,
      dependencyAuthority,
      authorityBasisDigest,
      construction,
      activation: { eligible: activationEligible, reasonCodes: activationReasons },
    },
    objective: one(graph, id, "objective"),
    dependsOn,
    semanticDependencies: dependencies,
    readSet,
    writeSet,
    constraints: contractNonClaims(graph, contract),
    requirements,
    artifacts,
    acceptanceCriteria: descriptions(graph, acceptanceIds, "text"),
    validationPlan,
    proofObligations,
    modelCapabilities,
    constructionRouteConstraints: [...new Set([...objectValues(graph, contract, predicate("constructionRouteConstraint")), ...objectValues(graph, id, predicate("constructionRouteConstraint"))])].sort(),
    targetRuntimeProvider: one(graph, contract, "targetRuntimeProvider"),
    privacy: privacy as PrivacyClassification,
    environmentPosture: postures,
    outputSchema: one(graph, id, "outputSchema"),
    stopConditions: trace.trace.stopConditions,
    scopedDependencyDigest: canonicalDigest(dependencies),
  };
  return {
    packet,
    requiredTransitionVerifications: requiredPermissions.transitionVerifications,
    ...(transitionVerification === undefined ? {} : { transitionVerification }),
    ...(currentnessReason !== undefined || normalizedReceiptDependency === undefined ? {} : { normalizedReceiptDependency }),
  };
}

interface SelectedSourceTopologyInput {
  profile: string;
  profileVersion: string;
  product: string;
  productVersion: string;
  foundation: string;
  foundationVersion: string;
  contract: string;
  work: string;
}

/**
 * Bind a basis to only the selected semantic source/import topology. The
 * selected root path and unrelated expanded overlays are carriers, not
 * currentness dependencies.
 */
function selectedSourceTopology(
  graph: SemanticGraph,
  selection: SelectedSourceTopologyInput,
): { manifestDigest: string; selectedClosure: string[] } {
  const loaded = graph as Partial<LoadedSemanticGraph>;
  if (!Array.isArray(loaded.sources) || !Array.isArray(loaded.manifests)) throw new Error("BASIS_MANIFEST_SELECTION_INVALID");
  // The profile resource itself binds exact membership and version. Traversing
  // every selectsContract edge would incorrectly turn sibling contract content
  // into a dependency of this work. The selected contract and explicit work
  // dependency edges already provide the exact relevant outbound closure.
  const selectedClosure = [...new Set([
    selection.profile,
    ...transitiveResourceIris(graph, [
    selection.product,
    selection.foundation,
    selection.contract,
    selection.work,
    ]),
  ])].sort();
  const selectedGraphs = new Set(graph.quads
    .filter((quad) => selectedClosure.includes(quad.subject))
    .map((quad) => quad.graph));
  const selectedSources = loaded.sources
    .filter((source) => selectedGraphs.has(source.graph))
    .map((source) => ({
      path: source.path,
      format: source.format,
      graph: source.graph,
      role: source.role,
      validationProfile: source.validationProfile,
      declaredBy: loaded.manifests!
        .filter(({ manifest }) => manifest.sources.some((declared) => declared.path === source.path
          && declared.format === source.format && declared.graph === source.graph && declared.role === source.role
          && declared.validationProfile === source.validationProfile))
        .map(({ path }) => path)
        .sort(),
    }))
    .sort((left, right) => left.graph.localeCompare(right.graph) || left.path.localeCompare(right.path));
  if (selectedSources.length === 0 || selectedSources.some(({ declaredBy }) => declaredBy.length === 0)) throw new Error("BASIS_MANIFEST_SELECTION_INVALID");
  return {
    selectedClosure,
    manifestDigest: canonicalDigest({
      schema: "urn:usf:manifest-selection:1",
      root: { schema: graph.manifest.schema, version: graph.manifest.version },
      selection: {
        profile: selection.profile,
        profileVersion: selection.profileVersion,
        product: selection.product,
        productVersion: selection.productVersion,
        foundation: selection.foundation,
        foundationVersion: selection.foundationVersion,
        contract: selection.contract,
      },
      selectedSources,
    }),
  };
}

function profileBasis(
  graph: SemanticGraph,
  packet: WorkPacket,
  manifestPath: string,
  normalizedReceiptDependency?: NormalizedReceiptDependency,
): import("../realisation/basis.ts").RealisationBasis {
  if (packet.decisionBoundary.kind !== "realisation-profile" || packet.decisionBoundary.root === null) throw new Error("REALISATION_PROFILE_REQUIRED");
  const profile = packet.decisionBoundary.root;
  const product = packet.decisionBoundary.product ?? oneIri(graph, profile, "product");
  const foundation = packet.decisionBoundary.foundation ?? oneIri(graph, product, "buildsUpon");
  const profileVersion = packet.decisionBoundary.profileVersion ?? one(graph, profile, "version");
  const versionPattern = /^(0|[1-9][0-9]*)$/u;
  if (!versionPattern.test(profileVersion)) throw new Error("BASIS_PROFILE_VERSION_INVALID");
  const productVersions = objectValues(graph, product, predicate("version"));
  if (productVersions.length !== 1 || !versionPattern.test(productVersions[0]!)) throw new Error("BASIS_PRODUCT_VERSION_INVALID");
  const productVersion = productVersions[0]!;
  const foundationVersions = objectValues(graph, foundation, predicate("version"));
  if (foundationVersions.length !== 1 || !versionPattern.test(foundationVersions[0]!)) throw new Error("BASIS_FOUNDATION_VERSION_INVALID");
  const foundationVersion = foundationVersions[0]!;
  const directionalPolicies = objectValues(graph, profile, predicate("directionalCurrentnessPolicy"));
  if (directionalPolicies.length !== 1 || directionalPolicies[0] !== "urn:usf:policy:directional-currentness:1" || !hasType(graph, directionalPolicies[0], "urn:usf:type:DirectionalCurrentnessPolicy")) throw new Error("BASIS_DIRECTIONAL_POLICY_INVALID");
  const algorithms = objectValues(graph, directionalPolicies[0], predicate("algorithm"));
  if (algorithms.length !== 1 || algorithms[0] !== "urn:usf:algorithm:directional-profile-closure:1" || !hasType(graph, algorithms[0], "urn:usf:type:DirectionalDigestAlgorithm")) throw new Error("BASIS_DIRECTIONAL_ALGORITHM_INVALID");
  for (const [name, expected] of [
    ["version", "1"],
    ["coreScopePolicy", "selected-profile-closure-resources-classified-core"],
    ["productScopePolicy", "selected-profile-closure-resources-classified-product"],
    ["productManifestRolePrefix", "product-"],
    ["scopePartitionPolicy", "exactly-once-by-expanded-manifest-role-with-profile-product-foundation-boundaries"],
    ["boundaryIdentityPolicy", "opposite-identity-and-version-without-opposite-content"],
    ["productVersionPolicy", "selected-product-must-have-exactly-one-explicit-nonnegative-integer-version"],
  ] as const) if (objectValues(graph, directionalPolicies[0], predicate(name)).length !== 1 || objectValues(graph, directionalPolicies[0], predicate(name))[0] !== expected) throw new Error(`BASIS_DIRECTIONAL_POLICY_${name.toUpperCase()}_INVALID`);
  const algorithm = "urn:usf:algorithm:directional-profile-closure:1";
  const policy = "urn:usf:policy:directional-currentness:1";
  const algorithmVersions = objectValues(graph, algorithm, predicate("version"));
  if (algorithmVersions.length !== 1 || algorithmVersions[0] !== "1") throw new Error("BASIS_DIRECTIONAL_ALGORITHM_VERSION_INVALID");
  const loaded = graph as LoadedSemanticGraph;
  const profileDigest = resourceDigest(graph, profile);
  const productDigest = resourceDigest(graph, product);
  const foundationDigest = resourceDigest(graph, foundation);
  const sourceRoles = new Map((loaded.sources ?? graph.manifest.sources ?? []).map((source) => [source.graph, source.role]));
  const definingRoles = new Map<string, Set<string>>();
  for (const quad of graph.quads) {
    const roles = definingRoles.get(quad.subject) ?? new Set<string>();
    roles.add(sourceRoles.get(quad.graph) ?? ""); definingRoles.set(quad.subject, roles);
  }
  const isProductResource = (id: string): boolean => {
    const roles = definingRoles.get(id) ?? new Set<string>();
    if ([...roles].some((role) => role.startsWith("product-")) && [...roles].some((role) => role !== "" && !role.startsWith("product-"))) throw new Error(`BASIS_LAYER_AMBIGUOUS:${id}`);
    if (roles.size === 0 || [...roles].some((role) => role === "")) throw new Error(`BASIS_LAYER_ROLE_MISSING:${id}`);
    return [...roles].some((role) => role.startsWith("product-"));
  };
  const { manifestDigest, selectedClosure } = selectedSourceTopology(graph, {
    profile,
    profileVersion,
    product,
    productVersion,
    foundation,
    foundationVersion,
    contract: packet.contract,
    work: packet.id,
  });
  const productResources: string[] = [];
  const coreResources: string[] = [];
  for (const id of selectedClosure) {
    if (id === profile || id === product) productResources.push(id);
    else if (id === foundation) coreResources.push(id);
    else if (isProductResource(id)) productResources.push(id);
    else coreResources.push(id);
  }
  if (new Set([...productResources, ...coreResources]).size !== selectedClosure.length
    || productResources.some((id) => coreResources.includes(id))) throw new Error("BASIS_SCOPE_PARTITION_INVALID");
  const productScope = productResources.map((id) => ({ id, digest: resourceDigest(graph, id) })).sort((a, b) => a.id.localeCompare(b.id));
  const coreScope = coreResources.map((id) => ({ id, digest: resourceDigest(graph, id) })).sort((a, b) => a.id.localeCompare(b.id));
  const algorithmDigest = resourceDigest(graph, algorithm);
  const policyDigest = resourceDigest(graph, policy);
  const coreToProductDigest = canonicalDigest({ algorithm, algorithmDigest, policy, policyDigest, coreScope, opposite: { product, productVersion, profile, profileVersion } });
  const productToCoreDigest = canonicalDigest({ algorithm, algorithmDigest, policy, policyDigest, productScope, opposite: { foundation, foundationVersion } });
  const compositeDigest = canonicalDigest({ profile, profileVersion, product, productVersion, productDigest, foundation, foundationVersion, coreToProductDigest, productToCoreDigest });
  const authority = packet.realisationAuthority!;
  const permission = authority.permission!;
  const scopePaths = [...new Set([...packet.readSet, ...packet.writeSet])].filter((path) => !path.endsWith("/"));
  if (normalizedReceiptDependency !== undefined) {
    const normalizedPath = repositoryPath(normalizedReceiptDependency.path, "TRANSITION_RECEIPT");
    if (normalizedPath !== normalizedReceiptDependency.path || normalizedReceiptDependency.digest !== sha256(`missing\u0000${normalizedPath}`)) throw new Error("TRANSITION_RECEIPT_NORMALIZATION_INVALID");
    const dependencies = packet.semanticDependencies.filter((dependency) => dependency.kind === "file" && dependency.key === normalizedPath);
    if (scopePaths.includes(normalizedPath) && (dependencies.length !== 1 || dependencies[0]?.digest !== normalizedReceiptDependency.digest)) throw new Error("TRANSITION_RECEIPT_NORMALIZATION_NOT_CONSUMED");
    if (!scopePaths.includes(normalizedPath) && dependencies.length !== 0) throw new Error("TRANSITION_RECEIPT_NORMALIZATION_SCOPE_MISMATCH");
  }
  const preimages = Object.fromEntries(scopePaths.map((path) => {
    if (path === normalizedReceiptDependency?.path) return [path, null];
    const absolute = resolve(graph.repositoryRoot, path);
    if (!isContained(graph.repositoryRoot, absolute)) throw new Error("BASIS_SCOPE_ESCAPE");
    if (!existsSync(absolute)) return [path, null];
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`BASIS_SCOPE_FILE_INVALID:${path}`);
    return [path, sha256(readFileSync(absolute))];
  }));
  const draft: BasisDraft = {
    schema: "urn:usf:realisation-basis:1" as const,
    selection: { manifestPath, manifestDigest, profile, profileVersion, profileDigest, product, productVersion, productDigest, foundation, foundationVersion, foundationDigest, coreToProductDigest, productToCoreDigest, compositeDigest },
    authority: { contract: packet.contract, contractDigest: resourceDigest(graph, packet.contract), contractShape: authority.contractShape ?? "", permission: permission.id, permissionDigest: resourceDigest(graph, permission.id), permissionState: permission.activationState ?? "", maximumThrough: permission.maximumThrough ?? "", effectiveAuthority: packet.eligibility?.construction.authority ?? "none", effectiveMaximumThrough: packet.eligibility?.construction.maximumThrough ?? "" },
    work: { id: packet.id, resourceDigest: resourceDigest(graph, packet.id), packetCoreDigest: packetDigest(packet), semanticDigest: canonicalDigest(packet.semanticDependencies.filter((d) => d.kind === "semantic-resource")), scopedDependencyDigest: packet.scopedDependencyDigest, dependencies: packet.semanticDependencies },
    semanticTrace: { policy: packet.semanticTrace?.policy ?? null, stages: packet.semanticTrace?.stages ?? [] },
    scope: { readSet: packet.readSet, writeSet: packet.writeSet, preimages },
    trace: { requirements: packet.requirements.map((r) => ({ id: r.id, digest: resourceDigest(graph, r.id) })), evidence: packet.realisationAuthority?.constructionEvidenceRequirement ? [{ id: packet.realisationAuthority.constructionEvidenceRequirement, digest: resourceDigest(graph, packet.realisationAuthority.constructionEvidenceRequirement) }] : [], proof: packet.proofObligations.map((p) => ({ id: p.id, digest: resourceDigest(graph, p.id) })), validation: packet.validationPlan.map((v) => ({ id: v.id, digest: resourceDigest(graph, v.id) })) },
    inputs: { policyDigest: resourceDigest(graph, packet.semanticTrace?.policy ?? policy), schemaDigests: packet.semanticDependencies.filter((d) => d.kind === "schema").map((d) => ({ id: d.key, digest: d.digest })), toolDigests: packet.semanticDependencies.filter((d) => d.kind === "tool").map((d) => ({ id: d.key, digest: d.digest })) },
  };
  return createRealisationBasis(draft);
}

function assertNormalizedReceiptBasis(
  bases: readonly RealisationBasis[],
  normalized: NormalizedReceiptDependency,
): void {
  const owners = bases.filter((basis) => basis.scope.readSet.includes(normalized.path) || basis.scope.writeSet.includes(normalized.path));
  if (owners.length !== 1 || owners[0]?.scope.preimages[normalized.path] !== null) throw new Error("TRANSITION_RECEIPT_NORMALIZATION_SCOPE_INVALID");
  const dependencies = owners[0].work.dependencies.filter((dependency) => dependency.kind === "file" && dependency.key === normalized.path);
  if (dependencies.length !== 1 || dependencies[0]?.digest !== normalized.digest) throw new Error("TRANSITION_RECEIPT_NORMALIZATION_NOT_CONSUMED");
}

function validLimit(value: number | undefined): number | undefined { return value === undefined ? 20 : Number.isSafeInteger(value) && value > 0 && value <= 100 ? value : undefined; }

interface WorkSelection { ids: string[]; decisionBoundary: DecisionBoundary; profileContracts?: string[]; }
interface WorkSelectionRefusal { reasonCode: string; }

function profileSelection(graph: SemanticGraph, profile: string): WorkSelection | WorkSelectionRefusal {
  if (!/^urn:[^<>\s]+$/u.test(profile)) return { reasonCode: "REALISATION_PROFILE_SELECTOR_MALFORMED" };
  const typed = hasType(graph, profile, profileType);
  if (!typed) return { reasonCode: "REALISATION_PROFILE_UNKNOWN" };
  const terminalVersion = /:([0-9]+)$/u.exec(profile)?.[1];
  const versionQuads = objectsFor(graph, profile, predicate("version"));
  if (terminalVersion === undefined || versionQuads.length !== 1 || versionQuads[0]?.objectKind !== "literal" || !/^(0|[1-9][0-9]*)$/u.test(versionQuads[0]?.object ?? "")) return { reasonCode: "REALISATION_PROFILE_VERSION_INVALID" };
  const profileVersion = versionQuads[0]?.object as string;
  if (profileVersion !== terminalVersion) return { reasonCode: "REALISATION_PROFILE_VERSION_MISMATCH" };
  const productQuads = objectsFor(graph, profile, predicate("product"));
  if (productQuads.length !== 1 || productQuads[0]?.objectKind !== "iri") return { reasonCode: "REALISATION_PROFILE_PRODUCT_INVALID" };
  const product = productQuads[0]?.object as string;
  if (!hasType(graph, product, productType)) return { reasonCode: "REALISATION_PROFILE_PRODUCT_TYPE_INVALID" };
  const productFoundationQuads = objectsFor(graph, product, predicate("buildsUpon"));
  if (productFoundationQuads.length !== 1 || productFoundationQuads[0]?.objectKind !== "iri") return { reasonCode: "REALISATION_PROFILE_PRODUCT_FOUNDATION_INVALID" };
  const foundation = productFoundationQuads[0]?.object as string;
  if (!hasType(graph, foundation, foundationType)) return { reasonCode: "REALISATION_PROFILE_FOUNDATION_TYPE_INVALID" };
  const contractQuads = objectsFor(graph, profile, predicate("selectsContract"));
  const contracts = contractQuads.map((quad) => quad.object).sort();
  if (contracts.length === 0 || contractQuads.some((quad) => quad.objectKind !== "iri") || new Set(contracts).size !== contracts.length) return { reasonCode: "REALISATION_PROFILE_INVALID" };
  const adoptionPolicies = objectValues(graph, profile, predicate("adoptionPolicy"));
  const reconstructionPolicies = objectValues(graph, profile, predicate("reconstructionPolicy"));
  if (!equalSets(adoptionPolicies, ["explicit-semantic-delta"]) || !equalSets(reconstructionPolicies, ["exact-closure-or-block"])) return { reasonCode: "REALISATION_PROFILE_POLICY_INVALID" };
  const semanticPolicyQuads = objectsFor(graph, profile, predicate("semanticOrderPolicy"));
  if (semanticPolicyQuads.length !== 1 || semanticPolicyQuads[0]?.objectKind !== "iri") return { reasonCode: "REALISATION_PROFILE_SEMANTIC_ORDER_POLICY_INVALID" };
  const excludedQuads = objectsFor(graph, profile, predicate("excludesContract"));
  if (excludedQuads.some((quad) => quad.objectKind !== "iri")) return { reasonCode: "REALISATION_PROFILE_EXCLUSION_INVALID" };
  const excluded = new Set(excludedQuads.map((quad) => quad.object));
  if (contracts.some((contract) => excluded.has(contract))) return { reasonCode: "REALISATION_PROFILE_CONTRADICTION" };
  for (const contract of contracts) {
    if (!hasType(graph, contract, contractType)) return { reasonCode: `REALISATION_PROFILE_CONTRACT_UNKNOWN:${profile}:${contract}` };
    const foundations = objectsFor(graph, contract, predicate("buildsUpon"));
    if (foundations.length !== 1 || foundations[0]?.objectKind !== "iri") return { reasonCode: `REALISATION_PROFILE_CONTRACT_FOUNDATION_INVALID:${profile}:${contract}` };
    if (foundations[0]?.object !== foundation) return { reasonCode: `REALISATION_PROFILE_CONTRACT_FOUNDATION_MISMATCH:${profile}:${contract}` };
  }
  const ids = semanticWorkPackets(graph).filter((id) => objectsFor(graph, id, predicate("contract")).some((quad) => quad.objectKind === "iri" && contracts.includes(quad.object)));
  const selectedIds = new Set(ids);
  for (const id of ids) {
    const dependencyQuads = objectsFor(graph, id, predicate("dependsOn"));
    if (dependencyQuads.some((quad) => quad.objectKind !== "iri")) return { reasonCode: `REALISATION_PROFILE_DEPENDENCY_KIND_INVALID:${profile}:${id}` };
    for (const dependency of dependencyQuads.map((quad) => quad.object)) {
      if (!selectedIds.has(dependency)) return { reasonCode: `REALISATION_PROFILE_DEPENDENCY_NOT_SELECTED:${profile}:${id}:${dependency}` };
    }
  }
  return {
    ids,
    decisionBoundary: { kind: "realisation-profile", root: profile, profileVersion, product, foundation },
    profileContracts: contracts,
  };
}

function inspectionSelection(graph: SemanticGraph, selector?: string): WorkSelection | WorkSelectionRefusal {
  if (selector === undefined || selector === "all") return { ids: semanticWorkPackets(graph), decisionBoundary: { kind: "unscoped", root: null } };
  if (selector.startsWith("contract:")) {
    const contract = selector.slice("contract:".length);
    const exists = hasType(graph, contract, contractType);
    return exists ? { ids: semanticWorkPackets(graph).filter((id) => objectsFor(graph, id, predicate("contract")).some((quad) => quad.objectKind === "iri" && quad.object === contract)), decisionBoundary: { kind: "contract", root: contract } } : { reasonCode: "WORK_SELECTOR_UNKNOWN" };
  }
  if (selector.startsWith("profile:")) {
    const profile = selector.slice("profile:".length);
    return profileSelection(graph, profile);
  }
  const isProfile = hasType(graph, selector, profileType);
  const isWork = semanticWorkPackets(graph).includes(selector);
  if (isProfile && isWork) return { reasonCode: "WORK_SELECTOR_AMBIGUOUS" };
  if (isProfile) return profileSelection(graph, selector);
  return isWork ? { ids: [selector], decisionBoundary: { kind: "work", root: selector } } : { reasonCode: "WORK_SELECTOR_UNKNOWN" };
}

function select(graph: SemanticGraph, options: WorkOptions): WorkSelection | WorkSelectionRefusal {
  const selector = options.selector;
  const selectorIsProfileCompatibility = selector?.startsWith("profile:") === true;
  const selectorIsExactProfile = selector !== undefined && hasType(graph, selector, profileType);
  if (options.profile !== undefined && (selectorIsProfileCompatibility || selectorIsExactProfile)) return { reasonCode: "REALISATION_PROFILE_SELECTOR_CONFLICT" };

  if (options.profile === undefined) {
    const selected = inspectionSelection(graph, selector);
    if ("reasonCode" in selected) return selected;
    if (options.ready && selected.decisionBoundary.kind !== "realisation-profile") return { reasonCode: "REALISATION_PROFILE_REQUIRED" };
    return selected;
  }

  const profiled = profileSelection(graph, options.profile);
  if ("reasonCode" in profiled) return profiled;
  if (selector === undefined || selector === "all") return profiled;
  if (selector.startsWith("contract:")) {
    const contract = selector.slice("contract:".length);
    if (!profiled.profileContracts?.includes(contract)) return { reasonCode: "REALISATION_PROFILE_SCOPE_MISMATCH" };
    return { ...profiled, ids: profiled.ids.filter((id) => objectsFor(graph, id, predicate("contract")).some((quad) => quad.objectKind === "iri" && quad.object === contract)) };
  }
  if (semanticWorkPackets(graph).includes(selector)) {
    if (!profiled.ids.includes(selector)) return { reasonCode: "REALISATION_PROFILE_SCOPE_MISMATCH" };
    return { ...profiled, ids: [selector] };
  }
  return { reasonCode: "WORK_SELECTOR_UNKNOWN" };
}

function shardIds(ids: string[], shard: string | undefined): string[] | undefined {
  if (shard === undefined) return ids;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  if (!match) return undefined;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total < 1 || index < 1 || index > total) return undefined;
  return ids.filter((_, position) => position % total === index - 1);
}

function workDependencies(graph: SemanticGraph, id: string): string[] {
  const quads = objectsFor(graph, id, predicate("dependsOn"));
  if (quads.some((quad) => quad.objectKind !== "iri")) refuse(`WORK_DEPENDENCY_KIND_INVALID:${id}`);
  return quads.map((quad) => quad.object).sort();
}

function validateWorkDag(graph: SemanticGraph, selectedIds: string[]): void {
  const all = new Set(semanticWorkPackets(graph));
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const cycleStart = visiting.indexOf(id);
    if (cycleStart >= 0) refuse(`WORK_DEPENDENCY_CYCLE:${[...visiting.slice(cycleStart), id].join("->")}`);
    if (!all.has(id)) refuse(`WORK_DEPENDENCY_UNRESOLVED:${id}`);
    visiting.push(id);
    for (const dependency of workDependencies(graph, id)) visit(dependency);
    visiting.pop();
    visited.add(id);
  };
  for (const id of selectedIds) visit(id);
}

function topologicalWorkOrder(graph: SemanticGraph, ids: string[]): string[] {
  const selected = new Set(ids);
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    for (const dependency of workDependencies(graph, id).filter((candidate) => selected.has(candidate))) visit(dependency);
    visited.add(id);
    ordered.push(id);
  };
  for (const id of [...ids].sort()) visit(id);
  return ordered;
}

function readyBootstrapPrefix(graph: SemanticGraph, selection: WorkSelection, ready: boolean | undefined): WorkSelection {
  if (!ready || selection.decisionBoundary.kind !== "realisation-profile" || !selection.ids.some((id) => canonicalBootstrapWorks.includes(id as typeof canonicalBootstrapWorks[number]))) return selection;
  const selected = new Set(selection.ids);
  const addPredecessors = (id: string): void => {
    for (const dependency of workDependencies(graph, id)) {
      if (!canonicalBootstrapWorks.includes(dependency as typeof canonicalBootstrapWorks[number]) || selected.has(dependency)) continue;
      selected.add(dependency);
      addPredecessors(dependency);
    }
  };
  for (const id of [...selected]) if (canonicalBootstrapWorks.includes(id as typeof canonicalBootstrapWorks[number])) addPredecessors(id);
  return { ...selection, ids: [...selected] };
}

function splitsBootstrapAdmission(selection: WorkSelection, ready: boolean | undefined, shard: string | undefined): boolean {
  if (!ready || shard === undefined || !selection.ids.some((id) => canonicalBootstrapWorks.includes(id as typeof canonicalBootstrapWorks[number]))) return false;
  const match = /^(\d+)\/(\d+)$/u.exec(shard);
  return match !== null && Number(match[2]) > 1;
}

function materializePacket(
  graph: SemanticGraph,
  id: string,
  decisionBoundary: DecisionBoundary,
  manifestPath: string,
  context: PacketDerivationContext = {},
): PacketDerivation {
  const sharedContext: PacketDerivationContext = context.completionMemo !== undefined && context.completionStack !== undefined
    ? context
    : { ...context, completionMemo: new Map<string, CompletionEvaluation>(), completionStack: new Set<string>() };
  const derivation = packetFor(graph, id, decisionBoundary, sharedContext);
  if (decisionBoundary.kind !== "realisation-profile") return derivation;
  const basis = profileBasis(graph, derivation.packet, manifestPath, derivation.normalizedReceiptDependency);
  const completion = evaluateCompletion(graph, derivation.packet, basis);
  sharedContext.completionMemo?.set(id, completion);
  const receiptMember = derivation.transitionVerification?.receipt.postState.members.find((member) => member.workId === id);
  const checkedCurrent = receiptMember !== undefined
    && receiptMember.basisDigest === basis.basisDigest
    && receiptMember.scopedDependencyDigest === basis.work.scopedDependencyDigest
    && receiptMember.workDigest === basis.work.resourceDigest;
  // A work the corpus has retired must not project as blocked. Blocked means
  // "cannot proceed yet"; retired means "will not proceed, and that is the
  // decision". Reporting the second as the first reads as a backlog, which is
  // exactly the misreading the capture-remainder work existed to remove.
  // Retirement only displaces blocked: a retired work that is somehow
  // actionable or complete keeps that stage, so an inconsistency surfaces
  // rather than being hidden by the label.
  const retired = graph.quads.some((quad) =>
    quad.subject === id && quad.predicate === predicate("retirementDisposition"));
  let stage: WorkRealisationStageProjection["stage"] = completion.verified
    ? "verified-complete"
    : checkedCurrent
      ? "checked-awaiting-integration"
      : derivation.packet.eligibility?.construction.eligible === true
        ? "construction-ready"
        : retired
          ? "retired"
          : "blocked";
  if (stage === "construction-ready" && derivation.packet.eligibility?.construction.eligible !== true) stage = "blocked";
  const realisationStage: WorkRealisationStageProjection = {
    stage,
    actionable: stage === "construction-ready" || stage === "checked-awaiting-integration",
    stageAuthorityDigest: canonicalDigest({
      work: id,
      stage,
      basis: basis.basisDigest,
      completion: completion.authorityDigest,
      transitionReceipt: derivation.transitionVerification?.receipt.receiptDigest ?? null,
      transitionMemberBasis: receiptMember?.basisDigest ?? null,
    }),
    completion: {
      verified: completion.verified,
      integrationReceipt: completion.integrationReceipt,
      evidence: completion.evidence,
      proofResult: completion.proofResult,
      reasonCodes: completion.reasonCodes,
    },
  };
  const packet = Object.freeze({
    ...derivation.packet,
    realisationStage,
    realisationBasis: basis,
  });
  assertBasisMatchesPacket(basis, packet);
  return {
    ...derivation,
    completion,
    packet,
  };
}

/**
 * Direct and required-permission consumers verify the receipt under the exact
 * graph-declared authority selection that minted it. A broader consumer
 * profile may consume that result, but cannot remint the member bases under its
 * own manifest, product selection or directional digests.
 */
function assertTransitionAuthorityReadback(
  graph: SemanticGraph,
  verifications: readonly TransitionCurrentnessVerification[],
  reasonPrefix: "TRANSITION_LIVE" | "REQUIRED_TRANSITION",
): void {
  const receipts = new Map(verifications.map((verification) => [verification.receipt.receiptDigest, verification]));
  for (const verification of receipts.values()) {
    const receipt = verification.receipt;
    if (receipt.postState.selection.manifestPath !== receipt.manifestPath) throw new Error(`${reasonPrefix}_RECEIPT_SELECTION_MISMATCH`);
    const authorityGraph = loadSemanticGraph(graph.repositoryRoot, receipt.manifestPath);
    const selection = profileSelection(authorityGraph, receipt.profile);
    if ("reasonCode" in selection || selection.decisionBoundary.kind !== "realisation-profile" || selection.decisionBoundary.root !== receipt.profile) {
      throw new Error(`${reasonPrefix}_AUTHORITY_PROFILE_INVALID`);
    }
    const selected = new Set(selection.ids);
    if (receipt.postState.members.some((member) => !selected.has(member.workId))) throw new Error(`${reasonPrefix}_MEMBER_NOT_SELECTED`);
    const context: PacketDerivationContext = { completionMemo: new Map(), completionStack: new Set() };
    const live = receipt.postState.members.map((member) => materializePacket(
      authorityGraph,
      member.workId,
      selection.decisionBoundary,
      receipt.manifestPath,
      context,
    ));
    if (live.some((derivation) => derivation.transitionVerification?.receipt.receiptDigest !== receipt.receiptDigest)) {
      throw new Error(`${reasonPrefix}_RECEIPT_READBACK_MISMATCH`);
    }
    const bases = live.map(({ packet }) => {
      if (!packet.realisationBasis) throw new Error(`${reasonPrefix}_BASIS_MISSING`);
      return packet.realisationBasis;
    });
    assertNormalizedReceiptBasis(bases, verification.normalizedReceiptDependency);
    assertTransitionPostSemanticCurrentness(receipt, bases);
  }
}

/** Derive only declared work; no inferred or ticket-backed work is fabricated. */
export function deriveWork(graph: SemanticGraph, options: WorkOptions = {}): WorkResult {
  const maxItems = validLimit(options.maxItems);
  if (maxItems === undefined) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "WORK_MAX_ITEMS_INVALID" };
  if (options.stage !== undefined && options.ready !== true) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "WORK_STAGE_REQUIRES_READY" };
  const selected = select(graph, options);
  if ("reasonCode" in selected) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: selected.reasonCode };
  const selection = readyBootstrapPrefix(graph, selected, options.ready);
  validateWorkDag(graph, selection.ids);
  const sharded = shardIds(topologicalWorkOrder(graph, selection.ids), options.shard);
  if (sharded === undefined) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "WORK_SHARD_INVALID" };
  if (splitsBootstrapAdmission(selection, options.ready, options.shard)) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "BOOTSTRAP_ATOMIC_ADMISSION_SHARD_REFUSED" };
  const manifestPath = (graph as SemanticGraph & { manifestPath?: string }).manifestPath ?? "graph/manifest.json";
  const context: PacketDerivationContext = { completionMemo: new Map(), completionStack: new Set() };
  const derivations = sharded.map((id) => materializePacket(graph, id, selection.decisionBoundary, manifestPath, context));
  assertTransitionAuthorityReadback(graph, derivations.flatMap(({ transitionVerification }) => transitionVerification === undefined ? [] : [transitionVerification]), "TRANSITION_LIVE");
  assertTransitionAuthorityReadback(graph, derivations.flatMap(({ requiredTransitionVerifications }) => requiredTransitionVerifications), "REQUIRED_TRANSITION");
  const packets = derivations.map(({ packet }) => packet);
  const requestedStage = options.stage ?? "construct";
  const eligible = options.ready
    ? packets.filter((packet) => packet.realisationStage?.stage === (requestedStage === "construct" ? "construction-ready" : "checked-awaiting-integration"))
    : packets;
  const actionableBootstrapCount = eligible.filter((packet) => canonicalBootstrapWorks.includes(packet.id as typeof canonicalBootstrapWorks[number])
    && (packet.eligibility?.construction.authority === "bootstrap-exception" || packet.realisationStage?.stage === "checked-awaiting-integration")).length;
  if (options.ready && actionableBootstrapCount > 0 && eligible.length > maxItems) return { schema: "urn:usf:work-result:1", status: "refused", reasonCode: "BOOTSTRAP_ATOMIC_ADMISSION_MAX_ITEMS_REFUSED" };
  const items = eligible.slice(0, maxItems);
  return { schema: "urn:usf:work-result:1", status: "ok", semanticDigest: graph.semanticDigest, outputMode: options.stream ? "jsonl" : "json", items, truncation: { maxItems, returnedItems: items.length, truncated: eligible.length > items.length } };
}

/**
 * Derive the exact graph-ordered post-state bases under an in-memory branded
 * transition candidate. The candidate is created only after reverse/replay and
 * graph-authority verification; serialized caller data cannot authorize this path.
 */
export function deriveVerifiedTransitionPostBases(
  graph: SemanticGraph,
  candidate: VerifiedTransitionCandidateCurrentness,
): readonly RealisationBasis[] {
  const selected = profileSelection(graph, candidate.profile);
  if ("reasonCode" in selected || selected.decisionBoundary.kind !== "realisation-profile" || selected.decisionBoundary.root === null) throw new Error("TRANSITION_CANDIDATE_PROFILE_INVALID");
  if (candidate.workOrder.some((workId) => !selected.ids.includes(workId))) throw new Error("TRANSITION_CANDIDATE_WORK_NOT_SELECTED");
  const manifestPath = (graph as SemanticGraph & { manifestPath?: string }).manifestPath ?? "graph/manifest.json";
  const derivations = candidate.workOrder.map((workId) => materializePacket(
    graph,
    workId,
    selected.decisionBoundary,
    manifestPath,
    { transitionCandidate: candidate },
  ));
  if (derivations.some(({ packet, normalizedReceiptDependency }) => normalizedReceiptDependency === undefined
    || packet.eligibility?.activation.eligible !== true || packet.realisationAuthority?.permission?.activationState !== activeState)) throw new Error("TRANSITION_CANDIDATE_POST_AUTHORITY_INVALID");
  const bases = derivations.map(({ packet }) => {
    if (!packet.realisationBasis) throw new Error("TRANSITION_CANDIDATE_POST_BASIS_MISSING");
    return packet.realisationBasis;
  });
  assertNormalizedReceiptBasis(bases, candidate.normalizedReceiptDependency);
  assertTransitionCandidatePostBasisCurrentness(candidate, bases);
  return Object.freeze([...bases]);
}

export function isWorkPacketFresh(packet: WorkPacket, current: Iterable<Dependency>): boolean {
  const digestByKey = new Map([...current].map((dependency) => [`${dependency.kind}|${dependency.key}`, dependency.digest]));
  return packet.semanticDependencies.every((dependency) => digestByKey.get(`${dependency.kind}|${dependency.key}`) === dependency.digest);
}

/** Only required applicability is satisfiable; silence and every other state fail closed. */
export function canSatisfyEnvironment(packet: WorkPacket, environment: string): boolean {
  return packet.environmentPosture.some((posture) => posture.environment === environment && posture.applicability === "required");
}

export function contractPermittedWrites(graph: SemanticGraph, contract: string): string[] { return contractWrites(graph, contract); }

/** Re-read the selected graph/profile and reject a persisted basis on any scoped movement. */
export async function deriveCurrentRealisationBasis(repositoryRoot: string, persistedBasis: RealisationBasis): Promise<RealisationBasis> {
  assertRealisationBasis(persistedBasis);
  const selection = persistedBasis.selection;
  const graph = loadSemanticGraph(repositoryRoot, selection.manifestPath);
  const result = deriveWork(graph, { profile: selection.profile, selector: persistedBasis.work.id, maxItems: 1 });
  if (result.status !== "ok") throw new Error("BASIS_PROFILE_MISMATCH");
  const packet = result.items?.find((item) => item.id === persistedBasis.work.id);
  const scopedSemanticDigest = canonicalDigest(packet?.semanticDependencies?.filter((d) => d.kind === "semantic-resource") ?? []);
  if (!packet?.realisationBasis) throw new Error("BASIS_WORK_STALE");
  const currentSelection = packet.realisationBasis.selection;
  const currentManifestDigest = selectedSourceTopology(graph, {
    profile: currentSelection.profile,
    profileVersion: currentSelection.profileVersion,
    product: currentSelection.product,
    productVersion: currentSelection.productVersion,
    foundation: currentSelection.foundation,
    foundationVersion: currentSelection.foundationVersion,
    contract: packet.contract,
    work: packet.id,
  }).manifestDigest;
  if (currentManifestDigest !== currentSelection.manifestDigest || currentManifestDigest !== selection.manifestDigest) throw new Error("BASIS_MANIFEST_MISMATCH");
  if (packetDigest(packet) !== persistedBasis.work.packetCoreDigest || scopedSemanticDigest !== persistedBasis.work.semanticDigest
    || packet.scopedDependencyDigest !== persistedBasis.work.scopedDependencyDigest) throw new Error("BASIS_WORK_STALE");
  assertRealisationBasis(packet.realisationBasis);
  if (canonicalDigest(packet.realisationBasis, { rejectAbsolutePaths: true }) !== canonicalDigest(persistedBasis, { rejectAbsolutePaths: true })) throw new Error("BASIS_CURRENTNESS_MISMATCH");
  return packet.realisationBasis;
}
