import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { loadSemanticGraph, objectValues, objectsFor, resourceDigest, type LoadedSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import { canonicalQuadLine, parseStrictNQuads } from "../graph/nquads.ts";
import { assertRealisationBasis, type RealisationBasis } from "./basis.ts";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const iriPattern = /^urn:[^<>\s]+$/u;
const verifiedCandidateTokens = new WeakSet<object>();

export interface TransitionQuad {
  readonly line: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly objectKind: "iri" | "literal";
  readonly graph: string;
}

/** Each operation is one exact N-Quad line effect, even when paths repeat. */
export interface TransitionOperation {
  readonly ordinal: number;
  readonly kind: "add" | "replace";
  readonly path: string;
  readonly lineIndex: number;
  readonly before: TransitionQuad | null;
  readonly after: TransitionQuad;
}

export interface TransitionMember {
  readonly order: number;
  readonly workId: string;
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly workDigest: string;
}

export interface TransitionResourceProjection { readonly id: string; readonly digest: string; }

export interface TransitionState {
  readonly id: string;
  readonly stateDigest: string;
  readonly sourceDigest: string;
  readonly semanticDigest: string;
  readonly selection: Readonly<{
    manifestPath: string;
    manifestDigest: string;
    profile: string;
    profileVersion: string;
    profileDigest: string;
    product: string;
    productVersion: string;
    productDigest: string;
    foundation: string;
    foundationVersion: string;
    foundationDigest: string;
  }>;
  readonly directional: Readonly<{
    coreToProductDigest: string;
    productToCoreDigest: string;
    compositeDigest: string;
  }>;
  readonly members: readonly TransitionMember[];
  readonly scopedDependencyDigest: string;
  readonly resources: readonly TransitionResourceProjection[];
}

export interface TransitionValidationRef {
  readonly id: string;
  readonly command: string;
  readonly outcome: "pass";
  readonly resultDigest: string;
}

export interface TransitionEvidenceRef {
  readonly id: string;
  readonly workId: string;
  readonly requirementId: string;
  readonly validationId: string;
  readonly validationResultDigest: string;
  readonly basisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly contentDigest: string;
}

export interface TransitionProofRef {
  readonly id: string;
  readonly obligation: string;
  readonly algorithm: string;
  readonly evidenceDigest: string;
  readonly admissionSetDigest: string;
  readonly outcome: "pass";
  readonly contentDigest: string;
}

export interface AggregateAdmission {
  readonly admissionSet: string;
  readonly admissionSetDigest: string;
  readonly members: readonly TransitionMember[];
  readonly validations: readonly TransitionValidationRef[];
  readonly evidence: readonly TransitionEvidenceRef[];
  readonly proof: TransitionProofRef;
  readonly admissionDigest: string;
}

export interface VerifiedTransitionReceipt {
  readonly schema: "urn:usf:verified-transition-receipt:1";
  readonly algorithm: "urn:usf:algorithm:verified-transition-receipt:1";
  readonly transition: string;
  readonly status: "verified";
  readonly sourcePath: string;
  readonly receiptPath: string;
  readonly profile: string;
  readonly manifestPath: string;
  readonly preState: TransitionState;
  readonly operations: readonly TransitionOperation[];
  readonly deltaDigest: string;
  readonly postState: TransitionState;
  readonly admission: AggregateAdmission;
  readonly receiptDigest: string;
}

export type TransitionStateDraft = Omit<TransitionState, "stateDigest">;
export type AggregateAdmissionDraft = Omit<AggregateAdmission, "admissionDigest">;
export type VerifiedTransitionReceiptDraft = Omit<VerifiedTransitionReceipt, "receiptDigest">;
export interface TransitionSemanticProjection {
  readonly selection: TransitionState["selection"];
  readonly directional: TransitionState["directional"];
  readonly members: readonly Pick<TransitionMember, "order" | "workId" | "workDigest">[];
  readonly resources: readonly TransitionResourceProjection[];
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(value) && !value.startsWith("/") && !value.includes("\\")
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function assertDigest(value: unknown, reason = "TRANSITION_DIGEST_INVALID"): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(reason);
}

function assertIri(value: unknown, reason = "TRANSITION_IRI_INVALID"): asserts value is string {
  if (typeof value !== "string" || !iriPattern.test(value)) throw new Error(reason);
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string, reason: string): void {
  const keys = items.map(key);
  if (new Set(keys).size !== keys.length) throw new Error(reason);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function withoutStateDigest(state: TransitionState | TransitionStateDraft): TransitionStateDraft {
  const { stateDigest: _ignored, ...draft } = state as TransitionState;
  return draft;
}

export function transitionStateDigest(state: TransitionState | TransitionStateDraft): string {
  return canonicalDigest(withoutStateDigest(state));
}

/** Semantic currentness is scoped to the transition selection and exact semantic resources, never the global graph. */
export function transitionScopedSemanticDigest(state: TransitionSemanticProjection): string {
  return canonicalDigest({
    selection: state.selection,
    directional: state.directional,
    members: state.members.map(({ order, workId, workDigest }) => ({ order, workId, workDigest })),
    resources: state.resources,
  });
}

export function createTransitionState(draft: TransitionStateDraft): TransitionState {
  const state = { ...draft, stateDigest: transitionStateDigest(draft) };
  assertTransitionState(state);
  return deepFreeze(state);
}

export function transitionDeltaDigest(operations: readonly TransitionOperation[]): string {
  return canonicalDigest(operations.map((operation) => ({
    ...operation,
    before: operation.before === null ? null : { ...operation.before },
    after: { ...operation.after },
  })));
}

function withoutAdmissionDigest(admission: AggregateAdmission | AggregateAdmissionDraft): AggregateAdmissionDraft {
  const { admissionDigest: _ignored, ...draft } = admission as AggregateAdmission;
  return draft;
}

export function aggregateAdmissionDigest(admission: AggregateAdmission | AggregateAdmissionDraft): string {
  return canonicalDigest(withoutAdmissionDigest(admission));
}

export function createAggregateAdmission(draft: AggregateAdmissionDraft): AggregateAdmission {
  const admission = { ...draft, admissionDigest: aggregateAdmissionDigest(draft) };
  assertAggregateAdmission(admission);
  return deepFreeze(admission);
}

function withoutReceiptDigest(receipt: VerifiedTransitionReceipt | VerifiedTransitionReceiptDraft): VerifiedTransitionReceiptDraft {
  const { receiptDigest: _ignored, ...draft } = receipt as VerifiedTransitionReceipt;
  return draft;
}

export function verifiedTransitionReceiptDigest(receipt: VerifiedTransitionReceipt | VerifiedTransitionReceiptDraft): string {
  return canonicalDigest(withoutReceiptDigest(receipt), { rejectAbsolutePaths: true });
}

export function createVerifiedTransitionReceipt(draft: VerifiedTransitionReceiptDraft): VerifiedTransitionReceipt {
  const receipt = { ...draft, receiptDigest: verifiedTransitionReceiptDigest(draft) };
  assertVerifiedTransitionReceipt(receipt);
  return deepFreeze(receipt);
}

export function transitionMemberFromBasis(basis: RealisationBasis, order: number): TransitionMember {
  assertRealisationBasis(basis);
  if (!Number.isSafeInteger(order) || order < 1) throw new Error("TRANSITION_MEMBER_ORDER_INVALID");
  return deepFreeze({
    order,
    workId: basis.work.id,
    basisDigest: basis.basisDigest,
    scopedDependencyDigest: basis.work.scopedDependencyDigest,
    workDigest: basis.work.resourceDigest,
  });
}

export function createTransitionStateFromBases(
  id: string,
  source: string,
  graph: SemanticGraph,
  bases: readonly RealisationBasis[],
  resources: readonly string[],
): TransitionState {
  if (bases.length !== 3 || resources.length !== 6) throw new Error("TRANSITION_STATE_BASIS_SET_INVALID");
  const members = bases.map((basis, index) => transitionMemberFromBasis(basis, index + 1));
  const first = bases[0];
  if (!first) throw new Error("TRANSITION_STATE_BASIS_SET_INVALID");
  for (const basis of bases.slice(1)) {
    if (basis.selection.manifestPath !== first.selection.manifestPath || basis.selection.manifestDigest !== first.selection.manifestDigest
      || basis.selection.profile !== first.selection.profile || basis.selection.profileVersion !== first.selection.profileVersion
      || basis.selection.profileDigest !== first.selection.profileDigest || basis.selection.product !== first.selection.product
      || basis.selection.productVersion !== first.selection.productVersion || basis.selection.productDigest !== first.selection.productDigest
      || basis.selection.foundation !== first.selection.foundation || basis.selection.foundationVersion !== first.selection.foundationVersion
      || basis.selection.foundationDigest !== first.selection.foundationDigest || basis.selection.coreToProductDigest !== first.selection.coreToProductDigest
      || basis.selection.productToCoreDigest !== first.selection.productToCoreDigest || basis.selection.compositeDigest !== first.selection.compositeDigest) throw new Error("TRANSITION_STATE_BASIS_SELECTION_MIXED");
  }
  const selection = {
    manifestPath: first.selection.manifestPath, manifestDigest: first.selection.manifestDigest,
    profile: first.selection.profile, profileVersion: first.selection.profileVersion, profileDigest: first.selection.profileDigest,
    product: first.selection.product, productVersion: first.selection.productVersion, productDigest: first.selection.productDigest,
    foundation: first.selection.foundation, foundationVersion: first.selection.foundationVersion, foundationDigest: first.selection.foundationDigest,
  };
  const directional = {
    coreToProductDigest: first.selection.coreToProductDigest,
    productToCoreDigest: first.selection.productToCoreDigest,
    compositeDigest: first.selection.compositeDigest,
  };
  const resourceProjections = resources.map((resource) => ({ id: resource, digest: resourceDigest(graph, resource) }));
  const scopedDependencyDigest = canonicalDigest(members.map(({ order, workId, scopedDependencyDigest }) => ({ order, workId, scopedDependencyDigest })));
  return createTransitionState({
    id,
    sourceDigest: sha256(source),
    semanticDigest: transitionScopedSemanticDigest({ selection, directional, members, resources: resourceProjections }),
    selection,
    directional,
    members,
    scopedDependencyDigest,
    resources: resourceProjections,
  });
}

export function parseTransitionQuad(line: string, expectedGraph: string): TransitionQuad {
  const parsed = parseStrictNQuads(line, expectedGraph, 1);
  const quad = parsed[0];
  if (quad === undefined || quad.canonical !== line || canonicalQuadLine(quad) !== line) throw new Error("TRANSITION_QUAD_NON_CANONICAL");
  return deepFreeze({ line, subject: quad.subject, predicate: quad.predicate, object: quad.object, objectKind: quad.objectKind, graph: quad.graph });
}

function assertTransitionQuad(value: unknown): asserts value is TransitionQuad {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["line", "subject", "predicate", "object", "objectKind", "graph"])) throw new Error("TRANSITION_QUAD_SHAPE_INVALID");
  const quad = value as TransitionQuad;
  assertIri(quad.subject); assertIri(quad.predicate); assertIri(quad.graph);
  if (typeof quad.line !== "string" || typeof quad.object !== "string" || !["iri", "literal"].includes(quad.objectKind)) throw new Error("TRANSITION_QUAD_SHAPE_INVALID");
  const parsed = parseTransitionQuad(quad.line, quad.graph);
  if (canonicalDigest(parsed) !== canonicalDigest(quad)) throw new Error("TRANSITION_QUAD_MISMATCH");
}

function assertTransitionMember(value: unknown, expectedOrder?: number): asserts value is TransitionMember {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["order", "workId", "basisDigest", "scopedDependencyDigest", "workDigest"])) throw new Error("TRANSITION_MEMBER_SHAPE_INVALID");
  const member = value as TransitionMember;
  if (!Number.isSafeInteger(member.order) || member.order < 1 || (expectedOrder !== undefined && member.order !== expectedOrder)) throw new Error("TRANSITION_MEMBER_ORDER_INVALID");
  assertIri(member.workId); assertDigest(member.basisDigest); assertDigest(member.scopedDependencyDigest); assertDigest(member.workDigest);
}

export function assertTransitionState(value: unknown): asserts value is TransitionState {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["id", "stateDigest", "sourceDigest", "semanticDigest", "selection", "directional", "members", "scopedDependencyDigest", "resources"])) throw new Error("TRANSITION_STATE_SHAPE_INVALID");
  const state = value as TransitionState;
  assertIri(state.id); assertDigest(state.stateDigest); assertDigest(state.sourceDigest); assertDigest(state.semanticDigest); assertDigest(state.scopedDependencyDigest);
  const selectionKeys = ["manifestPath", "manifestDigest", "profile", "profileVersion", "profileDigest", "product", "productVersion", "productDigest", "foundation", "foundationVersion", "foundationDigest"];
  if (!state.selection || !exactKeys(state.selection, selectionKeys) || !validPath(state.selection.manifestPath)
    || !/^(0|[1-9][0-9]*)$/u.test(state.selection.profileVersion) || !/^(0|[1-9][0-9]*)$/u.test(state.selection.productVersion)
    || !/^(0|[1-9][0-9]*)$/u.test(state.selection.foundationVersion)) throw new Error("TRANSITION_SELECTION_INVALID");
  assertDigest(state.selection.manifestDigest); assertIri(state.selection.profile); assertDigest(state.selection.profileDigest);
  assertIri(state.selection.product); assertDigest(state.selection.productDigest); assertIri(state.selection.foundation); assertDigest(state.selection.foundationDigest);
  if (!state.directional || !exactKeys(state.directional, ["coreToProductDigest", "productToCoreDigest", "compositeDigest"])) throw new Error("TRANSITION_DIRECTIONAL_INVALID");
  assertDigest(state.directional.coreToProductDigest); assertDigest(state.directional.productToCoreDigest); assertDigest(state.directional.compositeDigest);
  if (!Array.isArray(state.members) || state.members.length !== 3) throw new Error("TRANSITION_MEMBER_SET_INVALID");
  state.members.forEach((member, index) => assertTransitionMember(member, index + 1));
  assertUnique(state.members, (member) => member.workId, "TRANSITION_MEMBER_SET_INVALID");
  const expectedScopedDigest = canonicalDigest(state.members.map(({ order, workId, scopedDependencyDigest }) => ({ order, workId, scopedDependencyDigest })));
  if (state.scopedDependencyDigest !== expectedScopedDigest) throw new Error("TRANSITION_SCOPED_DEPENDENCY_DIGEST_MISMATCH");
  if (!Array.isArray(state.resources) || state.resources.length !== 6) throw new Error("TRANSITION_RESOURCE_SET_INVALID");
  for (const resource of state.resources) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource) || !exactKeys(resource, ["id", "digest"])) throw new Error("TRANSITION_RESOURCE_SHAPE_INVALID");
    assertIri(resource.id); assertDigest(resource.digest);
  }
  assertUnique(state.resources, (resource) => resource.id, "TRANSITION_RESOURCE_SET_INVALID");
  if (transitionScopedSemanticDigest(state) !== state.semanticDigest) throw new Error("TRANSITION_SCOPED_SEMANTIC_DIGEST_MISMATCH");
  if (transitionStateDigest(state) !== state.stateDigest) throw new Error("TRANSITION_STATE_DIGEST_MISMATCH");
}

export function assertAggregateAdmission(value: unknown): asserts value is AggregateAdmission {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["admissionSet", "admissionSetDigest", "members", "validations", "evidence", "proof", "admissionDigest"])) throw new Error("TRANSITION_ADMISSION_SHAPE_INVALID");
  const admission = value as AggregateAdmission;
  assertIri(admission.admissionSet); assertDigest(admission.admissionSetDigest); assertDigest(admission.admissionDigest);
  if (!Array.isArray(admission.members) || admission.members.length !== 3) throw new Error("TRANSITION_MEMBER_SET_INVALID");
  admission.members.forEach((member, index) => assertTransitionMember(member, index + 1));
  if (!Array.isArray(admission.validations) || admission.validations.length !== 3 || !Array.isArray(admission.evidence) || admission.evidence.length !== 3) throw new Error("TRANSITION_ADMISSION_CARDINALITY_INVALID");
  for (let index = 0; index < 3; index += 1) {
    const validation = admission.validations[index];
    const evidence = admission.evidence[index];
    const member = admission.members[index];
    if (!validation || !exactKeys(validation, ["id", "command", "outcome", "resultDigest"]) || typeof validation.command !== "string" || validation.command.length === 0 || validation.outcome !== "pass") throw new Error("TRANSITION_VALIDATION_REF_INVALID");
    assertIri(validation.id); assertDigest(validation.resultDigest);
    if (!evidence || !exactKeys(evidence, ["id", "workId", "requirementId", "validationId", "validationResultDigest", "basisDigest", "scopedDependencyDigest", "contentDigest"])) throw new Error("TRANSITION_EVIDENCE_REF_INVALID");
    assertIri(evidence.id); assertIri(evidence.workId); assertIri(evidence.requirementId); assertIri(evidence.validationId);
    assertDigest(evidence.validationResultDigest); assertDigest(evidence.basisDigest); assertDigest(evidence.scopedDependencyDigest); assertDigest(evidence.contentDigest);
    if (!member || evidence.workId !== member.workId || evidence.basisDigest !== member.basisDigest || evidence.scopedDependencyDigest !== member.scopedDependencyDigest
      || evidence.validationId !== validation.id || evidence.validationResultDigest !== validation.resultDigest) throw new Error("TRANSITION_EVIDENCE_MEMBER_BINDING_INVALID");
    const { contentDigest: _ignoredEvidenceDigest, ...evidenceDraft } = evidence;
    if (canonicalDigest(evidenceDraft) !== evidence.contentDigest) throw new Error("TRANSITION_EVIDENCE_CONTENT_DIGEST_MISMATCH");
  }
  assertUnique(admission.members, (member) => member.workId, "TRANSITION_MEMBER_SET_INVALID");
  assertUnique(admission.validations, (validation) => validation.id, "TRANSITION_VALIDATION_SET_INVALID");
  assertUnique(admission.evidence, (evidence) => evidence.id, "TRANSITION_EVIDENCE_SET_INVALID");
  const proof = admission.proof;
  if (!proof || !exactKeys(proof, ["id", "obligation", "algorithm", "evidenceDigest", "admissionSetDigest", "outcome", "contentDigest"]) || proof.outcome !== "pass") throw new Error("TRANSITION_PROOF_REF_INVALID");
  assertIri(proof.id); assertIri(proof.obligation); assertIri(proof.algorithm); assertDigest(proof.evidenceDigest); assertDigest(proof.admissionSetDigest); assertDigest(proof.contentDigest);
  if (proof.admissionSetDigest !== admission.admissionSetDigest) throw new Error("TRANSITION_PROOF_MEMBER_BINDING_INVALID");
  if (canonicalDigest({ admissionSet: admission.admissionSet, members: admission.members }) !== admission.admissionSetDigest) throw new Error("TRANSITION_ADMISSION_SET_DIGEST_MISMATCH");
  const expectedEvidenceDigest = canonicalDigest([...admission.evidence]
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
    .map(({ requirementId, contentDigest }) => ({ requirement: requirementId, contentDigest })));
  if (proof.evidenceDigest !== expectedEvidenceDigest) throw new Error("TRANSITION_PROOF_EVIDENCE_DIGEST_MISMATCH");
  const { contentDigest: _ignoredProofDigest, ...proofDraft } = proof;
  if (canonicalDigest(proofDraft) !== proof.contentDigest) throw new Error("TRANSITION_PROOF_CONTENT_DIGEST_MISMATCH");
  if (aggregateAdmissionDigest(admission) !== admission.admissionDigest) throw new Error("TRANSITION_ADMISSION_DIGEST_MISMATCH");
}

export function assertVerifiedTransitionReceipt(value: unknown): asserts value is VerifiedTransitionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["schema", "algorithm", "transition", "status", "sourcePath", "receiptPath", "profile", "manifestPath", "preState", "operations", "deltaDigest", "postState", "admission", "receiptDigest"])) throw new Error("TRANSITION_RECEIPT_SHAPE_INVALID");
  const receipt = value as VerifiedTransitionReceipt;
  if (receipt.schema !== "urn:usf:verified-transition-receipt:1" || receipt.algorithm !== "urn:usf:algorithm:verified-transition-receipt:1" || receipt.status !== "verified") throw new Error("TRANSITION_RECEIPT_IDENTITY_INVALID");
  assertIri(receipt.transition); assertIri(receipt.profile);
  if (!validPath(receipt.sourcePath) || !validPath(receipt.receiptPath) || !validPath(receipt.manifestPath) || receipt.sourcePath === receipt.receiptPath) throw new Error("TRANSITION_PATH_INVALID");
  assertTransitionState(receipt.preState); assertTransitionState(receipt.postState); assertAggregateAdmission(receipt.admission);
  if (receipt.preState.id === receipt.postState.id || receipt.preState.selection.profile !== receipt.profile || receipt.postState.selection.profile !== receipt.profile
    || receipt.preState.selection.manifestPath !== receipt.manifestPath || receipt.postState.selection.manifestPath !== receipt.manifestPath) throw new Error("TRANSITION_STATE_IDENTITY_INVALID");
  const stableSelectionKeys = ["manifestPath", "manifestDigest", "profile", "profileVersion", "profileDigest", "product", "productVersion", "productDigest", "foundation", "foundationVersion", "foundationDigest"] as const;
  if (stableSelectionKeys.some((key) => receipt.preState.selection[key] !== receipt.postState.selection[key])
    || receipt.preState.members.some((member, index) => receipt.postState.members[index]?.workId !== member.workId)
    || receipt.preState.resources.some((resource, index) => receipt.postState.resources[index]?.id !== resource.id)) throw new Error("TRANSITION_POSTSTATE_SCOPE_INVALID");
  if (canonicalDigest(receipt.preState.members) !== canonicalDigest(receipt.admission.members)) throw new Error("TRANSITION_MEMBER_BASIS_MISMATCH");
  if (!Array.isArray(receipt.operations) || receipt.operations.length < 3) throw new Error("TRANSITION_OPERATION_SET_INVALID");
  let replacements = false;
  for (let index = 0; index < receipt.operations.length; index += 1) {
    const operation = receipt.operations[index];
    if (!operation || !exactKeys(operation, ["ordinal", "kind", "path", "lineIndex", "before", "after"]) || operation.ordinal !== index + 1
      || !Number.isSafeInteger(operation.lineIndex) || operation.lineIndex < 0 || operation.path !== receipt.sourcePath) throw new Error("TRANSITION_OPERATION_INVALID");
    if (operation.kind === "add") {
      if (replacements || operation.before !== null) throw new Error("TRANSITION_OPERATION_ORDER_INVALID");
    } else if (operation.kind === "replace") {
      replacements = true;
      if (operation.before === null) throw new Error("TRANSITION_OPERATION_INVALID");
      assertTransitionQuad(operation.before);
    } else throw new Error("TRANSITION_OPERATION_INVALID");
    assertTransitionQuad(operation.after);
    if (operation.before !== null && (operation.before.subject !== operation.after.subject || operation.before.predicate !== operation.after.predicate || operation.before.graph !== operation.after.graph)) throw new Error("TRANSITION_REPLACEMENT_SCOPE_INVALID");
  }
  if (receipt.operations.filter((operation) => operation.kind === "replace").length !== 2) throw new Error("TRANSITION_REPLACEMENT_SET_INVALID");
  assertDigest(receipt.deltaDigest); assertDigest(receipt.receiptDigest);
  if (transitionDeltaDigest(receipt.operations) !== receipt.deltaDigest) throw new Error("TRANSITION_DELTA_MISMATCH");
  if (verifiedTransitionReceiptDigest(receipt) !== receipt.receiptDigest) throw new Error("TRANSITION_RECEIPT_DIGEST_MISMATCH");
}

function sourceLines(source: string): string[] {
  if (!source.endsWith("\n") || source.includes("\r")) throw new Error("TRANSITION_SOURCE_NON_CANONICAL");
  const lines = source.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) throw new Error("TRANSITION_SOURCE_NON_CANONICAL");
  return lines;
}

function renderSource(lines: readonly string[]): string { return `${lines.join("\n")}\n`; }

export function applyTransitionOperations(source: string, operations: readonly TransitionOperation[]): string {
  const lines = sourceLines(source);
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (!operation || operation.ordinal !== index + 1) throw new Error("TRANSITION_OPERATION_ORDER_INVALID");
    if (operation.kind === "add") {
      if (operation.before !== null || operation.lineIndex !== lines.length || lines.includes(operation.after.line)) throw new Error("TRANSITION_PREIMAGE_MISMATCH");
      lines.splice(operation.lineIndex, 0, operation.after.line);
    } else {
      if (operation.before === null || lines[operation.lineIndex] !== operation.before.line || lines.includes(operation.after.line)) throw new Error("TRANSITION_PREIMAGE_MISMATCH");
      lines[operation.lineIndex] = operation.after.line;
    }
  }
  return renderSource(lines);
}

export function reverseTransitionOperations(source: string, operations: readonly TransitionOperation[]): string {
  const lines = sourceLines(source);
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index];
    if (!operation) throw new Error("TRANSITION_OPERATION_INVALID");
    if (lines[operation.lineIndex] !== operation.after.line) throw new Error("TRANSITION_POSTIMAGE_MISMATCH");
    if (operation.kind === "add") lines.splice(operation.lineIndex, 1);
    else {
      if (operation.before === null || lines.includes(operation.before.line)) throw new Error("TRANSITION_POSTIMAGE_MISMATCH");
      lines[operation.lineIndex] = operation.before.line;
    }
  }
  return renderSource(lines);
}

export interface TransitionCurrentnessVerification {
  readonly receipt: VerifiedTransitionReceipt;
  /** The receipt creation is normalized to this graph-declared missing preimage. */
  readonly normalizedReceiptDependency: Readonly<{ path: string; digest: string }>;
}

export interface TransitionCandidateMember {
  readonly order: number;
  readonly workId: string;
  readonly scopedDependencyDigest: string;
  readonly workDigest: string;
}

export interface VerifiedTransitionCandidateCurrentness {
  readonly schema: "urn:usf:verified-transition-candidate-currentness:1";
  readonly currentness: string;
  readonly algorithm: "urn:usf:algorithm:verified-transition-receipt:1";
  readonly transition: string;
  readonly permission: string;
  readonly exception: "urn:usf:exception:semantic-first-bootstrap:1";
  readonly profile: string;
  readonly manifestPath: string;
  readonly sourceGraph: string;
  readonly sourcePath: string;
  readonly receiptPath: string;
  readonly preState: string;
  readonly postState: string;
  readonly workOrder: readonly string[];
  readonly sourceBeforeDigest: string;
  readonly sourceAfterDigest: string;
  readonly deltaDigest: string;
  readonly admissionDigest: string;
  readonly normalizedReceiptDependency: Readonly<{ path: string; digest: string }>;
  readonly postProjection: Readonly<{
    selection: TransitionState["selection"];
    directional: TransitionState["directional"];
    semanticDigest: string;
    members: readonly TransitionCandidateMember[];
    scopedDependencyDigest: string;
    resources: readonly TransitionResourceProjection[];
  }>;
  readonly candidateDigest: string;
}

export interface VerifiedTransitionCandidateInput {
  readonly currentness: string;
  readonly permission: string;
  readonly profile: string;
  readonly sourceBefore: string;
  readonly sourceAfter: string;
  readonly operations: readonly TransitionOperation[];
  readonly admission: AggregateAdmission;
  readonly preBases: readonly RealisationBasis[];
  readonly postBases: readonly RealisationBasis[];
}

/**
 * Compare the receipt post-state with bases independently rederived by the
 * caller. Keeping derivation outside this module avoids a transition/work
 * import cycle while making member, directional and scoped currentness exact.
 */
export function assertTransitionPostBasisCurrentness(receipt: VerifiedTransitionReceipt, bases: readonly RealisationBasis[]): void {
  assertVerifiedTransitionReceipt(receipt);
  if (bases.length !== receipt.postState.members.length) throw new Error("TRANSITION_POST_BASIS_SET_INVALID");
  const members = bases.map((basis, index) => transitionMemberFromBasis(basis, index + 1));
  if (canonicalJson(members) !== canonicalJson(receipt.postState.members)) throw new Error("TRANSITION_POST_MEMBER_CURRENTNESS_MISMATCH");
  const first = bases[0];
  if (!first) throw new Error("TRANSITION_POST_BASIS_SET_INVALID");
  for (const basis of bases) {
    const selection = basis.selection;
    const stateSelection = receipt.postState.selection;
    if (selection.manifestPath !== stateSelection.manifestPath || selection.manifestDigest !== stateSelection.manifestDigest
      || selection.profile !== stateSelection.profile || selection.profileVersion !== stateSelection.profileVersion || selection.profileDigest !== stateSelection.profileDigest
      || selection.product !== stateSelection.product || selection.productVersion !== stateSelection.productVersion || selection.productDigest !== stateSelection.productDigest
      || selection.foundation !== stateSelection.foundation || selection.foundationVersion !== stateSelection.foundationVersion || selection.foundationDigest !== stateSelection.foundationDigest
      || selection.coreToProductDigest !== receipt.postState.directional.coreToProductDigest
      || selection.productToCoreDigest !== receipt.postState.directional.productToCoreDigest
      || selection.compositeDigest !== receipt.postState.directional.compositeDigest) throw new Error("TRANSITION_POST_DIRECTIONAL_CURRENTNESS_MISMATCH");
  }
  const scopedDependencyDigest = canonicalDigest(members.map(({ order, workId, scopedDependencyDigest }) => ({ order, workId, scopedDependencyDigest })));
  if (scopedDependencyDigest !== receipt.postState.scopedDependencyDigest) throw new Error("TRANSITION_POST_SCOPED_CURRENTNESS_MISMATCH");
}

/**
 * Ongoing activation currentness is semantic, not perpetual reproof of the
 * immutable admission bases. Publication still uses the stricter basis check
 * above; this projection deliberately excludes basis and scoped file digests.
 */
export function assertTransitionPostSemanticCurrentness(receipt: VerifiedTransitionReceipt, bases: readonly RealisationBasis[]): void {
  assertVerifiedTransitionReceipt(receipt);
  if (bases.length !== receipt.postState.members.length) throw new Error("TRANSITION_POST_SEMANTIC_SET_INVALID");
  const members = bases.map((basis, index) => {
    assertRealisationBasis(basis);
    return { order: index + 1, workId: basis.work.id, workDigest: basis.work.resourceDigest };
  });
  const expectedMembers = receipt.postState.members.map(({ order, workId, workDigest }) => ({ order, workId, workDigest }));
  if (canonicalJson(members) !== canonicalJson(expectedMembers)) throw new Error("TRANSITION_POST_SEMANTIC_MEMBER_MISMATCH");
  const first = bases[0];
  if (!first) throw new Error("TRANSITION_POST_SEMANTIC_SET_INVALID");
  const selection = {
    manifestPath: first.selection.manifestPath, manifestDigest: first.selection.manifestDigest,
    profile: first.selection.profile, profileVersion: first.selection.profileVersion, profileDigest: first.selection.profileDigest,
    product: first.selection.product, productVersion: first.selection.productVersion, productDigest: first.selection.productDigest,
    foundation: first.selection.foundation, foundationVersion: first.selection.foundationVersion, foundationDigest: first.selection.foundationDigest,
  };
  const directional = {
    coreToProductDigest: first.selection.coreToProductDigest,
    productToCoreDigest: first.selection.productToCoreDigest,
    compositeDigest: first.selection.compositeDigest,
  };
  for (const basis of bases.slice(1)) {
    if (canonicalJson({
      manifestPath: basis.selection.manifestPath, manifestDigest: basis.selection.manifestDigest,
      profile: basis.selection.profile, profileVersion: basis.selection.profileVersion, profileDigest: basis.selection.profileDigest,
      product: basis.selection.product, productVersion: basis.selection.productVersion, productDigest: basis.selection.productDigest,
      foundation: basis.selection.foundation, foundationVersion: basis.selection.foundationVersion, foundationDigest: basis.selection.foundationDigest,
    }) !== canonicalJson(selection) || canonicalJson({
      coreToProductDigest: basis.selection.coreToProductDigest,
      productToCoreDigest: basis.selection.productToCoreDigest,
      compositeDigest: basis.selection.compositeDigest,
    }) !== canonicalJson(directional)) throw new Error("TRANSITION_POST_SEMANTIC_SELECTION_MIXED");
  }
  const projection = { selection, directional, members, resources: receipt.postState.resources };
  if (canonicalJson(selection) !== canonicalJson(receipt.postState.selection)
    || canonicalJson(directional) !== canonicalJson(receipt.postState.directional)
    || transitionScopedSemanticDigest(projection) !== receipt.postState.semanticDigest) throw new Error("TRANSITION_POST_SEMANTIC_CURRENTNESS_MISMATCH");
}

function oneGraphValue(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string {
  const values = objectsFor(graph, subject, `urn:usf:predicate:${name}`);
  if (values.length !== 1 || values[0]?.objectKind !== kind) throw new Error(`TRANSITION_CURRENTNESS_${name.toUpperCase()}_INVALID`);
  return values[0].object;
}

function currentnessFile(root: string, repositoryPath: string): string {
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(repositoryPath) || repositoryPath.includes("\0") || repositoryPath.includes("\\") || isAbsolute(repositoryPath)
    || repositoryPath.split("/").some((part) => part.length === 0 || part === "." || part === "..")) throw new Error("TRANSITION_CURRENTNESS_PATH_INVALID");
  const absolute = resolve(root, repositoryPath);
  const relation = relative(root, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation) || !existsSync(absolute)
    || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()) throw new Error("TRANSITION_CURRENTNESS_PATH_INVALID");
  const realRelation = relative(root, realpathSync(absolute));
  if (realRelation === "" || realRelation === ".." || realRelation.startsWith(`..${sep}`) || isAbsolute(realRelation)) throw new Error("TRANSITION_CURRENTNESS_PATH_INVALID");
  return absolute;
}

function expectedAdditionLines(receipt: VerifiedTransitionReceipt, graphIri: string): string[] {
  const line = (subject: string, predicate: string, object: string, objectKind: "iri" | "literal"): string => canonicalQuadLine({ subject, predicate, object, objectKind, graph: graphIri, canonical: "" });
  const evidenceLines = receipt.admission.evidence.flatMap((evidence) => [
    line(evidence.id, "urn:usf:predicate:type", "urn:usf:type:Evidence", "iri"),
    line(evidence.id, "urn:usf:predicate:forWork", evidence.workId, "iri"),
    line(evidence.id, "urn:usf:predicate:satisfiesEvidenceRequirement", evidence.requirementId, "iri"),
    line(evidence.id, "urn:usf:predicate:validationResultDigest", evidence.validationResultDigest, "literal"),
    line(evidence.id, "urn:usf:predicate:realisationBasisDigest", evidence.basisDigest, "literal"),
    line(evidence.id, "urn:usf:predicate:scopedDependencyDigest", evidence.scopedDependencyDigest, "literal"),
    line(evidence.id, "urn:usf:predicate:contentDigest", evidence.contentDigest, "literal"),
  ].sort());
  const proof = receipt.admission.proof;
  const proofLines = [
    line(proof.id, "urn:usf:predicate:type", "urn:usf:type:ProofResult", "iri"),
    line(proof.id, "urn:usf:predicate:forObligation", proof.obligation, "iri"),
    line(proof.id, "urn:usf:predicate:algorithm", proof.algorithm, "iri"),
    line(proof.id, "urn:usf:predicate:evidenceDigest", proof.evidenceDigest, "literal"),
    line(proof.id, "urn:usf:predicate:admissionSetDigest", proof.admissionSetDigest, "literal"),
    line(proof.id, "urn:usf:predicate:outcome", proof.outcome, "literal"),
    line(proof.id, "urn:usf:predicate:contentDigest", proof.contentDigest, "literal"),
  ].sort();
  return [...evidenceLines, ...proofLines];
}

const exactBootstrapWorkOrder = Object.freeze([
  "urn:usf:work:semantic-first-eligibility",
  "urn:usf:work:realisation-basis-chain",
  "urn:usf:work:semantic-first-lifecycle-admission",
]);
const exactBootstrapEvidenceOrder = Object.freeze([
  "urn:usf:evidence:semantic-first-eligibility:bootstrap",
  "urn:usf:evidence:realisation-basis-chain:bootstrap",
  "urn:usf:evidence:semantic-first-lifecycle-admission:bootstrap",
]);
const exactAdmissionPredicates = Object.freeze([
  "urn:usf:predicate:activationState", "urn:usf:predicate:admissionSetDigest", "urn:usf:predicate:algorithm",
  "urn:usf:predicate:contentDigest", "urn:usf:predicate:evidenceDigest", "urn:usf:predicate:forObligation",
  "urn:usf:predicate:forWork", "urn:usf:predicate:outcome", "urn:usf:predicate:realisationBasisDigest",
  "urn:usf:predicate:satisfiesEvidenceRequirement", "urn:usf:predicate:scopedDependencyDigest", "urn:usf:predicate:state",
  "urn:usf:predicate:type", "urn:usf:predicate:validationResultDigest",
].sort());

function graphValues(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string[] {
  const values = objectsFor(graph, subject, `urn:usf:predicate:${name}`);
  if (values.some((value) => value.objectKind !== kind)) throw new Error(`TRANSITION_CURRENTNESS_${name.toUpperCase()}_INVALID`);
  const objects = values.map((value) => value.object).sort();
  if (new Set(objects).size !== objects.length) throw new Error(`TRANSITION_CURRENTNESS_${name.toUpperCase()}_INVALID`);
  return objects;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort(); const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assertGraphDeclaredAdmissionCurrentness(graph: SemanticGraph, receipt: VerifiedTransitionReceipt, sourceGraph: string, permission: string): void {
  const exception = "urn:usf:exception:semantic-first-bootstrap:1";
  if (!objectsFor(graph, exception, "urn:usf:predicate:type").some((quad) => quad.objectKind === "iri" && quad.object === "urn:usf:type:BootstrapConstructionException")
    || oneGraphValue(graph, exception, "admissionTransitionReceipt", "iri") !== receipt.transition
    || oneGraphValue(graph, exception, "admissionTransitionAlgorithm", "iri") !== receipt.algorithm
    || oneGraphValue(graph, exception, "admissionGraph", "iri") !== sourceGraph
    || oneGraphValue(graph, exception, "admissionWritePath", "literal") !== receipt.sourcePath
    || oneGraphValue(graph, exception, "admissionReceiptPath", "literal") !== receipt.receiptPath
    || oneGraphValue(graph, exception, "admissionPreState", "iri") !== receipt.preState.id
    || oneGraphValue(graph, exception, "admissionPostState", "iri") !== receipt.postState.id
    || oneGraphValue(graph, exception, "requiresActivePermissionAfterClosure", "iri") !== permission) throw new Error("TRANSITION_GRAPH_AUTHORITY_MISMATCH");
  const admissionSet = oneGraphValue(graph, exception, "admissionWorkSet", "iri");
  if (receipt.admission.admissionSet !== admissionSet) throw new Error("TRANSITION_ADMISSION_SET_CURRENTNESS_MISMATCH");
  const orderedWorks = graphValues(graph, admissionSet, "member", "iri")
    .map((workId) => ({ workId, order: Number(oneGraphValue(graph, workId, "bootstrapOrder", "literal")) }))
    .sort((left, right) => left.order - right.order || left.workId.localeCompare(right.workId));
  if (orderedWorks.length !== exactBootstrapWorkOrder.length
    || orderedWorks.some((member, index) => member.order !== index + 1 || member.workId !== exactBootstrapWorkOrder[index])) throw new Error("TRANSITION_WORK_ORDER_CURRENTNESS_MISMATCH");
  if (!sameStringSet(graphValues(graph, exception, "admissionEvidence", "iri"), exactBootstrapEvidenceOrder)
    || !sameStringSet(graphValues(graph, exception, "admissionPredicate", "iri"), exactAdmissionPredicates)) throw new Error("TRANSITION_ADMISSION_AUTHORITY_SET_MISMATCH");
  const validationSet = graphValues(graph, exception, "admissionValidation", "iri");
  const validationIds = orderedWorks.map(({ workId }) => {
    const candidates = graphValues(graph, workId, "validation", "iri").filter((id) => validationSet.includes(id));
    if (candidates.length !== 1) throw new Error("TRANSITION_VALIDATION_BINDING_CURRENTNESS_MISMATCH");
    return candidates[0] as string;
  });
  const expectedValidations = validationIds.map((id) => {
    const command = oneGraphValue(graph, id, "command", "literal");
    return { id, command, outcome: "pass" as const, resultDigest: canonicalDigest({ id, command, outcome: "pass" }) };
  });
  if (canonicalJson(expectedValidations) !== canonicalJson(receipt.admission.validations)) throw new Error("TRANSITION_VALIDATION_CURRENTNESS_MISMATCH");
  const requirements = validationIds.map((validationId) => {
    const candidates = [...new Set(graph.quads.filter((quad) => quad.predicate === "urn:usf:predicate:validationObligation"
      && quad.objectKind === "iri" && quad.object === validationId).map((quad) => quad.subject))];
    if (candidates.length !== 1) throw new Error("TRANSITION_EVIDENCE_REQUIREMENT_CURRENTNESS_MISMATCH");
    return candidates[0] as string;
  });
  for (let index = 0; index < exactBootstrapWorkOrder.length; index += 1) {
    const evidence = receipt.admission.evidence[index];
    const validation = expectedValidations[index];
    if (!evidence || !validation || evidence.id !== exactBootstrapEvidenceOrder[index] || evidence.workId !== exactBootstrapWorkOrder[index]
      || evidence.requirementId !== requirements[index] || evidence.validationId !== validation.id
      || evidence.validationResultDigest !== validation.resultDigest) throw new Error("TRANSITION_EVIDENCE_CURRENTNESS_MISMATCH");
  }
  const proofId = oneGraphValue(graph, exception, "admissionProofResult", "iri");
  const obligation = oneGraphValue(graph, exception, "admissionProofObligation", "iri");
  const proofAlgorithm = oneGraphValue(graph, obligation, "algorithm", "iri");
  if (receipt.admission.proof.id !== proofId || receipt.admission.proof.obligation !== obligation
    || receipt.admission.proof.algorithm !== proofAlgorithm || receipt.admission.proof.outcome !== "pass") throw new Error("TRANSITION_PROOF_CURRENTNESS_MISMATCH");
  const resources = [...exactBootstrapEvidenceOrder, proofId, permission, exception];
  if (!sameStringSet(graphValues(graph, exception, "admissionResource", "iri"), resources)) throw new Error("TRANSITION_RESOURCE_AUTHORITY_SET_MISMATCH");
}

function candidateDigest(value: Omit<VerifiedTransitionCandidateCurrentness, "candidateDigest">): string {
  return canonicalDigest(value, { rejectAbsolutePaths: true });
}

function candidateWorkOrder(graph: SemanticGraph, admissionSet: string): string[] {
  const ordered = graphValues(graph, admissionSet, "member", "iri")
    .map((workId) => ({ workId, order: Number(oneGraphValue(graph, workId, "bootstrapOrder", "literal")) }))
    .sort((left, right) => left.order - right.order || left.workId.localeCompare(right.workId));
  if (ordered.length !== exactBootstrapWorkOrder.length
    || ordered.some((member, index) => member.order !== index + 1 || member.workId !== exactBootstrapWorkOrder[index])) throw new Error("TRANSITION_WORK_ORDER_CURRENTNESS_MISMATCH");
  return ordered.map(({ workId }) => workId);
}

export function createVerifiedTransitionCandidateCurrentness(
  preGraph: SemanticGraph,
  postGraph: SemanticGraph,
  input: VerifiedTransitionCandidateInput,
): VerifiedTransitionCandidateCurrentness {
  assertIri(input.currentness); assertIri(input.permission); assertIri(input.profile);
  assertAggregateAdmission(input.admission);
  const exception = "urn:usf:exception:semantic-first-bootstrap:1" as const;
  if (!objectsFor(postGraph, input.currentness, "urn:usf:predicate:type").some((quad) => quad.objectKind === "iri" && quad.object === "urn:usf:type:ActivationCurrentnessRule")) throw new Error("TRANSITION_CANDIDATE_CURRENTNESS_TYPE_INVALID");
  const algorithm = oneGraphValue(postGraph, input.currentness, "algorithm", "iri");
  const sourceGraph = oneGraphValue(postGraph, input.currentness, "sourceGraph", "iri");
  const sourcePath = oneGraphValue(postGraph, input.currentness, "sourcePath", "literal");
  const receiptPath = oneGraphValue(postGraph, input.currentness, "receiptPath", "literal");
  const manifestPath = (postGraph as SemanticGraph & { manifestPath?: string }).manifestPath;
  const permissionCurrentness = graphValues(postGraph, input.permission, "activationCurrentness", "iri");
  if (algorithm !== "urn:usf:algorithm:verified-transition-receipt:1" || manifestPath === undefined || !validPath(manifestPath)
    || permissionCurrentness.length !== 1 || permissionCurrentness[0] !== input.currentness || !validPath(sourcePath) || !validPath(receiptPath)
    || postGraph.sourceDigests[sourcePath] === undefined || postGraph.sourceDigests[receiptPath] !== undefined
    || existsSync(resolve(postGraph.repositoryRoot, receiptPath))) throw new Error("TRANSITION_CANDIDATE_AUTHORITY_INVALID");
  const transition = oneGraphValue(postGraph, exception, "admissionTransitionReceipt", "iri");
  const preStateId = oneGraphValue(postGraph, exception, "admissionPreState", "iri");
  const postStateId = oneGraphValue(postGraph, exception, "admissionPostState", "iri");
  const admissionSet = oneGraphValue(postGraph, exception, "admissionWorkSet", "iri");
  const workOrder = candidateWorkOrder(postGraph, admissionSet);
  if (input.preBases.length !== workOrder.length || input.postBases.length !== workOrder.length
    || input.preBases.some((basis, index) => basis.work.id !== workOrder[index])
    || input.postBases.some((basis, index) => basis.work.id !== workOrder[index])) throw new Error("TRANSITION_CANDIDATE_BASIS_ORDER_INVALID");
  const proofId = oneGraphValue(postGraph, exception, "admissionProofResult", "iri");
  const resources = [...exactBootstrapEvidenceOrder, proofId, input.permission, exception];
  if (preGraph.sourceDigests[sourcePath] !== sha256(input.sourceBefore) || postGraph.sourceDigests[sourcePath] !== sha256(input.sourceAfter)
    || applyTransitionOperations(input.sourceBefore, input.operations) !== input.sourceAfter
    || reverseTransitionOperations(input.sourceAfter, input.operations) !== input.sourceBefore) throw new Error("TRANSITION_CANDIDATE_REPLAY_MISMATCH");
  const preState = createTransitionStateFromBases(preStateId, input.sourceBefore, preGraph, input.preBases, resources);
  const postState = createTransitionStateFromBases(postStateId, input.sourceAfter, postGraph, input.postBases, resources);
  if (canonicalJson(preState.members) !== canonicalJson(input.admission.members)) throw new Error("TRANSITION_CANDIDATE_ADMISSION_BASIS_MISMATCH");
  const receipt = createVerifiedTransitionReceipt({
    schema: "urn:usf:verified-transition-receipt:1",
    algorithm,
    transition,
    status: "verified",
    sourcePath,
    receiptPath,
    profile: input.profile,
    manifestPath,
    preState,
    operations: input.operations,
    deltaDigest: transitionDeltaDigest(input.operations),
    postState,
    admission: input.admission,
  });
  assertGraphDeclaredAdmissionCurrentness(postGraph, receipt, sourceGraph, input.permission);
  const expectedAdditions = expectedAdditionLines(receipt, sourceGraph);
  const additions = input.operations.filter((operation) => operation.kind === "add").map((operation) => operation.after.line);
  const replacements = input.operations.filter((operation) => operation.kind === "replace");
  if (canonicalJson(additions) !== canonicalJson(expectedAdditions)
    || replacements[0]?.after.subject !== input.permission || replacements[0]?.after.predicate !== "urn:usf:predicate:activationState"
    || replacements[0]?.before?.object !== "urn:usf:contract-state:proofblocked" || replacements[0]?.after.object !== "urn:usf:contract-state:active"
    || replacements[1]?.after.subject !== exception || replacements[1]?.after.predicate !== "urn:usf:predicate:state"
    || replacements[1]?.before?.object !== "urn:usf:exception-state:open" || replacements[1]?.after.object !== "urn:usf:exception-state:closed") throw new Error("TRANSITION_CANDIDATE_OPERATION_SET_INVALID");
  if (oneGraphValue(preGraph, input.permission, "activationState", "iri") !== "urn:usf:contract-state:proofblocked"
    || oneGraphValue(preGraph, exception, "state", "iri") !== "urn:usf:exception-state:open"
    || oneGraphValue(postGraph, input.permission, "activationState", "iri") !== "urn:usf:contract-state:active"
    || oneGraphValue(postGraph, exception, "state", "iri") !== "urn:usf:exception-state:closed") throw new Error("TRANSITION_CANDIDATE_STATE_INVALID");
  const members = postState.members.map(({ order, workId, scopedDependencyDigest, workDigest }) => ({ order, workId, scopedDependencyDigest, workDigest }));
  const postProjection = deepFreeze({
    selection: postState.selection,
    directional: postState.directional,
    semanticDigest: postState.semanticDigest,
    members,
    scopedDependencyDigest: postState.scopedDependencyDigest,
    resources: postState.resources,
  });
  const draft: Omit<VerifiedTransitionCandidateCurrentness, "candidateDigest"> = {
    schema: "urn:usf:verified-transition-candidate-currentness:1",
    currentness: input.currentness,
    algorithm,
    transition,
    permission: input.permission,
    exception,
    profile: input.profile,
    manifestPath,
    sourceGraph,
    sourcePath,
    receiptPath,
    preState: preStateId,
    postState: postStateId,
    workOrder,
    sourceBeforeDigest: preState.sourceDigest,
    sourceAfterDigest: postState.sourceDigest,
    deltaDigest: receipt.deltaDigest,
    admissionDigest: input.admission.admissionDigest,
    normalizedReceiptDependency: { path: receiptPath, digest: sha256(`missing\u0000${receiptPath}`) },
    postProjection,
  };
  const candidate = deepFreeze({ ...draft, candidateDigest: candidateDigest(draft) });
  verifiedCandidateTokens.add(candidate);
  return candidate;
}

export function assertVerifiedTransitionCandidateCurrentness(
  graph: SemanticGraph,
  currentness: string,
  permission: string,
  profile: string,
  candidate: VerifiedTransitionCandidateCurrentness,
): void {
  if (!verifiedCandidateTokens.has(candidate) || !Object.isFrozen(candidate) || candidate.schema !== "urn:usf:verified-transition-candidate-currentness:1") throw new Error("TRANSITION_CANDIDATE_UNVERIFIED");
  const { candidateDigest: suppliedDigest, ...draft } = candidate;
  if (candidateDigest(draft) !== suppliedDigest || candidate.currentness !== currentness || candidate.permission !== permission || candidate.profile !== profile) throw new Error("TRANSITION_CANDIDATE_SELECTION_MISMATCH");
  if (oneGraphValue(graph, currentness, "algorithm", "iri") !== candidate.algorithm
    || oneGraphValue(graph, currentness, "sourceGraph", "iri") !== candidate.sourceGraph
    || oneGraphValue(graph, currentness, "sourcePath", "literal") !== candidate.sourcePath
    || oneGraphValue(graph, currentness, "receiptPath", "literal") !== candidate.receiptPath
    || oneGraphValue(graph, candidate.exception, "admissionTransitionReceipt", "iri") !== candidate.transition
    || oneGraphValue(graph, candidate.exception, "requiresActivePermissionAfterClosure", "iri") !== permission
    || (graph as SemanticGraph & { manifestPath?: string }).manifestPath !== candidate.manifestPath
    || graph.sourceDigests[candidate.sourcePath] !== candidate.sourceAfterDigest || graph.sourceDigests[candidate.receiptPath] !== undefined
    || existsSync(resolve(graph.repositoryRoot, candidate.receiptPath))) throw new Error("TRANSITION_CANDIDATE_GRAPH_MISMATCH");
  const admissionSet = oneGraphValue(graph, candidate.exception, "admissionWorkSet", "iri");
  if (canonicalJson(candidateWorkOrder(graph, admissionSet)) !== canonicalJson(candidate.workOrder)) throw new Error("TRANSITION_CANDIDATE_WORK_ORDER_MISMATCH");
  if (oneGraphValue(graph, permission, "activationState", "iri") !== "urn:usf:contract-state:active"
    || oneGraphValue(graph, candidate.exception, "state", "iri") !== "urn:usf:exception-state:closed") throw new Error("TRANSITION_CANDIDATE_STATE_INVALID");
  const projection = candidate.postProjection;
  if (projection.selection.profile !== profile || resourceDigest(graph, profile) !== projection.selection.profileDigest
    || resourceDigest(graph, projection.selection.product) !== projection.selection.productDigest
    || resourceDigest(graph, projection.selection.foundation) !== projection.selection.foundationDigest
    || transitionScopedSemanticDigest(projection) !== projection.semanticDigest
    || canonicalDigest(projection.members.map(({ order, workId, scopedDependencyDigest }) => ({ order, workId, scopedDependencyDigest }))) !== projection.scopedDependencyDigest
    || projection.resources.some((resource) => resourceDigest(graph, resource.id) !== resource.digest)
    || candidate.normalizedReceiptDependency.path !== candidate.receiptPath
    || candidate.normalizedReceiptDependency.digest !== sha256(`missing\u0000${candidate.receiptPath}`)) throw new Error("TRANSITION_CANDIDATE_PROJECTION_MISMATCH");
}

export function assertTransitionCandidatePostBasisCurrentness(
  candidate: VerifiedTransitionCandidateCurrentness,
  bases: readonly RealisationBasis[],
): void {
  if (!verifiedCandidateTokens.has(candidate) || bases.length !== candidate.workOrder.length) throw new Error("TRANSITION_CANDIDATE_UNVERIFIED");
  const members = bases.map((basis, index) => {
    assertRealisationBasis(basis);
    return { order: index + 1, workId: basis.work.id, scopedDependencyDigest: basis.work.scopedDependencyDigest, workDigest: basis.work.resourceDigest };
  });
  if (canonicalJson(members) !== canonicalJson(candidate.postProjection.members)) throw new Error("TRANSITION_CANDIDATE_POST_MEMBER_MISMATCH");
  for (const basis of bases) {
    const selection = basis.selection;
    const expected = candidate.postProjection;
    if (selection.manifestPath !== expected.selection.manifestPath || selection.manifestDigest !== expected.selection.manifestDigest
      || selection.profile !== expected.selection.profile || selection.profileVersion !== expected.selection.profileVersion || selection.profileDigest !== expected.selection.profileDigest
      || selection.product !== expected.selection.product || selection.productVersion !== expected.selection.productVersion || selection.productDigest !== expected.selection.productDigest
      || selection.foundation !== expected.selection.foundation || selection.foundationVersion !== expected.selection.foundationVersion || selection.foundationDigest !== expected.selection.foundationDigest
      || selection.coreToProductDigest !== expected.directional.coreToProductDigest || selection.productToCoreDigest !== expected.directional.productToCoreDigest
      || selection.compositeDigest !== expected.directional.compositeDigest) throw new Error("TRANSITION_CANDIDATE_POST_DIRECTIONAL_MISMATCH");
  }
  const scoped = canonicalDigest(members.map(({ order, workId, scopedDependencyDigest }) => ({ order, workId, scopedDependencyDigest })));
  if (scoped !== candidate.postProjection.scopedDependencyDigest) throw new Error("TRANSITION_CANDIDATE_POST_SCOPED_MISMATCH");
}

/**
 * Synchronous, non-circular currentness readback for graph/work projection.
 * It does not execute tests or derive work; it verifies the already admitted
 * closed receipt, reversible source delta and exact current semantic resources.
 */
export function verifyTransitionActivationCurrentness(
  graph: SemanticGraph,
  currentness: string,
  permission: string,
  _consumerProfile: string,
): TransitionCurrentnessVerification {
  if (!objectsFor(graph, currentness, "urn:usf:predicate:type").some((quad) => quad.objectKind === "iri" && quad.object === "urn:usf:type:ActivationCurrentnessRule")) throw new Error("TRANSITION_CURRENTNESS_TYPE_INVALID");
  const authorityProfile = oneGraphValue(graph, currentness, "authorityProfile", "iri");
  const authorityManifestPath = oneGraphValue(graph, currentness, "authorityManifestPath", "literal");
  const authorityGraph = loadSemanticGraph(graph.repositoryRoot, authorityManifestPath);
  if (authorityGraph.manifestPath !== authorityManifestPath
    || resourceDigest(authorityGraph, currentness) !== resourceDigest(graph, currentness)
    || resourceDigest(authorityGraph, permission) !== resourceDigest(graph, permission)) throw new Error("TRANSITION_CURRENTNESS_AUTHORITY_SELECTION_MISMATCH");
  return verifyTransitionAuthorityGraphCurrentness(authorityGraph, currentness, permission, authorityProfile, authorityManifestPath);
}

function verifyTransitionAuthorityGraphCurrentness(
  graph: LoadedSemanticGraph,
  currentness: string,
  permission: string,
  profile: string,
  authorityManifestPath: string,
): TransitionCurrentnessVerification {
  const algorithm = oneGraphValue(graph, currentness, "algorithm", "iri");
  const sourceGraph = oneGraphValue(graph, currentness, "sourceGraph", "iri");
  const sourcePath = oneGraphValue(graph, currentness, "sourcePath", "literal");
  const receiptPath = oneGraphValue(graph, currentness, "receiptPath", "literal");
  if (algorithm !== "urn:usf:algorithm:verified-transition-receipt:1" || sourcePath.length === 0 || receiptPath.length === 0
    || graph.sourceDigests[sourcePath] === undefined || graph.sourceDigests[receiptPath] !== undefined) throw new Error("TRANSITION_CURRENTNESS_AUTHORITY_INVALID");
  const sourceAbsolute = currentnessFile(graph.repositoryRoot, sourcePath);
  const receiptAbsolute = currentnessFile(graph.repositoryRoot, receiptPath);
  let receipt: VerifiedTransitionReceipt;
  const receiptBytes = readFileSync(receiptAbsolute, "utf8");
  try { receipt = JSON.parse(receiptBytes) as VerifiedTransitionReceipt; } catch { throw new Error("TRANSITION_RECEIPT_INVALID_JSON"); }
  assertVerifiedTransitionReceipt(receipt);
  if (`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n` !== receiptBytes) throw new Error("TRANSITION_RECEIPT_NON_CANONICAL");
  const manifestPath = graph.manifestPath;
  if (receipt.algorithm !== algorithm || receipt.sourcePath !== sourcePath || receipt.receiptPath !== receiptPath || receipt.profile !== profile
    || manifestPath !== authorityManifestPath || receipt.manifestPath !== manifestPath) throw new Error("TRANSITION_RECEIPT_SELECTION_MISMATCH");
  assertGraphDeclaredAdmissionCurrentness(graph, receipt, sourceGraph, permission);
  const source = readFileSync(sourceAbsolute, "utf8");
  if (sha256(source) !== receipt.postState.sourceDigest || graph.sourceDigests[sourcePath] !== receipt.postState.sourceDigest) throw new Error("TRANSITION_CURRENT_POSTSTATE_MISMATCH");
  const preSource = reverseTransitionOperations(source, receipt.operations);
  if (sha256(preSource) !== receipt.preState.sourceDigest || applyTransitionOperations(preSource, receipt.operations) !== source) throw new Error("TRANSITION_CURRENTNESS_REPLAY_MISMATCH");
  const selection = receipt.postState.selection;
  if (selection.profile !== profile || resourceDigest(graph, profile) !== selection.profileDigest
    || resourceDigest(graph, selection.product) !== selection.productDigest || resourceDigest(graph, selection.foundation) !== selection.foundationDigest) throw new Error("TRANSITION_CURRENTNESS_SELECTION_STALE");
  const admissionSet = oneGraphValue(graph, "urn:usf:exception:semantic-first-bootstrap:1", "admissionWorkSet", "iri");
  const workOrder = candidateWorkOrder(graph, admissionSet);
  if (receipt.postState.members.length !== workOrder.length || receipt.postState.members.some((member, index) => member.order !== index + 1
    || member.workId !== workOrder[index] || member.workDigest !== resourceDigest(graph, member.workId))) throw new Error("TRANSITION_CURRENTNESS_WORK_STALE");
  for (const resource of receipt.postState.resources) if (resourceDigest(graph, resource.id) !== resource.digest) throw new Error("TRANSITION_CURRENTNESS_RESOURCE_STALE");
  const evidenceIds = receipt.admission.evidence.map((evidence) => evidence.id);
  const additionSubjects = [...new Set(receipt.operations.filter((operation) => operation.kind === "add").map((operation) => operation.after.subject))];
  if (JSON.stringify(additionSubjects) !== JSON.stringify([...evidenceIds, receipt.admission.proof.id])) throw new Error("TRANSITION_ADDITION_RESOURCE_SET_INVALID");
  const expectedLines = expectedAdditionLines(receipt, sourceGraph);
  const actualLines = receipt.operations.filter((operation) => operation.kind === "add").map((operation) => operation.after.line);
  if (JSON.stringify(actualLines) !== JSON.stringify(expectedLines)) throw new Error("TRANSITION_ADDITION_SET_INVALID");
  const replacements = receipt.operations.filter((operation) => operation.kind === "replace");
  const exception = replacements[1]?.after.subject;
  if (replacements[0]?.after.subject !== permission || replacements[0]?.after.predicate !== "urn:usf:predicate:activationState"
    || replacements[0]?.after.object !== "urn:usf:contract-state:active" || replacements[0]?.before?.object !== "urn:usf:contract-state:proofblocked"
    || exception === undefined || replacements[1]?.after.predicate !== "urn:usf:predicate:state" || replacements[1]?.after.object !== "urn:usf:exception-state:closed"
    || replacements[1]?.before?.object !== "urn:usf:exception-state:open") throw new Error("TRANSITION_REPLACEMENT_SET_INVALID");
  if (oneGraphValue(graph, permission, "activationState", "iri") !== "urn:usf:contract-state:active"
    || oneGraphValue(graph, exception, "state", "iri") !== "urn:usf:exception-state:closed") throw new Error("TRANSITION_CURRENTNESS_STATE_INVALID");
  const currentResources = [...receipt.admission.evidence.map((evidence) => evidence.id), receipt.admission.proof.id, permission, exception];
  if (JSON.stringify(receipt.postState.resources.map((resource) => resource.id)) !== JSON.stringify(currentResources)) throw new Error("TRANSITION_RESOURCE_ORDER_INVALID");
  return deepFreeze({ receipt, normalizedReceiptDependency: { path: receiptPath, digest: sha256(`missing\u0000${receiptPath}`) } });
}
