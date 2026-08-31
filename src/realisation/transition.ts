import { chmodSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, realpath, rename, rm, rmdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { loadSemanticGraph, objectValues, objectsFor, resourceDigest, validationRuntimeClosure, type LoadedSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import { deriveCurrentRealisationBasis, deriveWork } from "../graph/work.ts";
import type { CheckedCandidateReceipt as DurableCheckedCandidateReceipt } from "../commands/check.ts";
import { canonicalQuadLine, parseStrictNQuads } from "../graph/nquads.ts";
import { assertRealisationBasis, parseRealisationBasis, type RealisationBasis } from "./basis.ts";
import type { AuthenticatedCandidateWorkspace, GitFileMode } from "./index.ts";

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

/* -------------------------------------------------------------------------- */
/* Ordinary checked-candidate integration observation                         */
/* -------------------------------------------------------------------------- */

const integrationManifestIdentity = "graph/manifests/integration.json";
const integrationAlgorithmIri = "urn:usf:algorithm:work-integration-transition:2";
const integrationCheckedSchemaIri = "urn:usf:schema:checked-candidate-receipt:1";
const integrationMemberSchemaIri = "urn:usf:schema:integration-cohort-member:1";
const integrationObservationSchemaIri = "urn:usf:schema:integration-observation:1";
const integrationRequestMembershipIri = "urn:usf:digest-membership:integration-request:1";
const integrationObservationMembershipIri = "urn:usf:digest-membership:integration-observation:1";
const integrationReceiptBoundaryIri = "urn:usf:receipt-boundary:core-completion:1";
const integrationSuccessOutcome = "urn:usf:outcome:integration-success";
const integrationRefusalOutcome = "urn:usf:outcome:integration-refused";
const primaryMutationLockIdentity = "urn:usf:lock:primary-mutation:1";
const integrationNonClaims = Object.freeze([
  "integration-observation-not-semantic-evidence",
  "integration-observation-not-proof-result",
  "integration-observation-not-completion",
  "no-push-github-provider-network-runtime-staging-or-production-effect",
]);

export type IntegrationReasonCode =
  | "INTEGRATION_CANDIDATE_COUNT_INVALID"
  | "INTEGRATION_DUPLICATE_CANDIDATE"
  | "INTEGRATION_DUPLICATE_RECEIPT"
  | "INTEGRATION_DUPLICATE_WORK"
  | "INTEGRATION_CALLER_ORDER_INVALID"
  | "INTEGRATION_OVERLAPPING_WRITE_SET"
  | "INTEGRATION_PROFILE_MISMATCH"
  | "INTEGRATION_AUTHORITY_INVALID"
  | "INTEGRATION_CHECK_RECEIPT_MISSING"
  | "INTEGRATION_CHECK_RECEIPT_INVALID"
  | "INTEGRATION_VALIDATION_INVALID"
  | "INTEGRATION_VALIDATION_FAILED"
  | "INTEGRATION_EMPTY_DELTA"
  | "INTEGRATION_PRIMARY_TOUCHED_PATH_DIRTY"
  | "INTEGRATION_PRIMARY_MOVED"
  | "INTEGRATION_STALE_PREIMAGE"
  | "INTEGRATION_SYMLINK_OR_NONREGULAR"
  | "INTEGRATION_FILTER_ATTRIBUTE"
  | "INTEGRATION_UNDECLARED_EFFECT"
  | "INTEGRATION_GIT_UNAVAILABLE"
  | "INTEGRATION_GIT_FAILED"
  | "INTEGRATION_LOCK_BUSY"
  | "INTEGRATION_LOCK_UNAVAILABLE"
  | "INTEGRATION_INTENT_MISMATCH"
  | "INTEGRATION_RECOVERY_QUARANTINED"
  | "INTEGRATION_POSTIMAGE_BASIS_INVALID"
  | "INTEGRATION_PRIVATE_STATE_UNSAFE"
  | "INTEGRATION_DETACHED_BASIS_MISMATCH"
  | "INTEGRATION_POSTIMAGE_MOVED"
  | "INTEGRATION_TEMP_REF_INVALID"
  | "INTEGRATION_DRY_RUN_PRIMARY_MUTATED"
  | "INTEGRATION_PRIMARY_MARKER_MISMATCH"
  | "INTEGRATION_VALIDATION_TIMEOUT";

export class IntegrationError extends Error {
  readonly reasonCode: IntegrationReasonCode;
  readonly validationExecution?: IntegrationValidationExecutionObservation;
  constructor(reasonCode: IntegrationReasonCode, message: string = reasonCode, validationExecution?: IntegrationValidationExecutionObservation) {
    super(message);
    this.name = "IntegrationError";
    this.reasonCode = reasonCode;
    this.validationExecution = validationExecution;
  }
}

export interface IntegrationValidationAuthority {
  readonly obligationIri: string;
  readonly command: string;
  readonly commandTokens: readonly string[];
  readonly validationResourceDigest: string;
  readonly environmentIri: string;
  readonly executionModeIri: string;
  readonly commandDigest: string;
  readonly environmentDigest: string;
  readonly executionModeDigest: string;
  readonly toolDependencies: readonly Readonly<{ kind: "basis-input" | "host-tool"; id: string; digest: string }>[];
  readonly toolDependencyDigest: string;
  readonly schemaDependencies: readonly Readonly<{ id: string; digest: string }>[];
  readonly schemaDependencyDigest: string;
  readonly executionAuthorityResourceDigest: string;
  readonly wallTimeMilliseconds: number;
  readonly terminationGraceMilliseconds: number;
  readonly terminationSignal: "SIGTERM";
  readonly forcedTerminationSignal: "SIGKILL";
  readonly maximumSettlementWallTimeMilliseconds: number;
}

export interface IntegrationVerifierInput {
  readonly phase: "candidate" | "postimage";
  readonly repositoryRoot: string;
  readonly candidateDigest: string;
  readonly workIri: string;
  readonly explicitProfileIri: string;
  readonly basis: RealisationBasis;
  readonly authority: IntegrationValidationAuthority;
  readonly expectedByteDeltaDigest: string;
  readonly expectedFileModeDigest: string;
  readonly expectedTreeDigest: string;
}

export interface IntegrationVerifierObservation {
  readonly outcome: "pass";
  readonly resultDigests: readonly string[];
  readonly timedOut?: false;
  readonly timeoutTerminationSignal?: "none";
  readonly outputResultDigest?: string;
}

export interface IntegrationValidationExecutionObservation {
  readonly timedOut: boolean;
  readonly timeoutTerminationSignal: "none" | "SIGTERM" | "SIGKILL";
  readonly outputResultDigest: string;
}

/** The callback observes execution only; all validation authority is supplied by the engine. */
export type IntegrationCandidateVerifier = (input: IntegrationVerifierInput) => Promise<IntegrationVerifierObservation>;

export type CheckedCandidateReceipt = DurableCheckedCandidateReceipt;

export interface IntegrationCohortMember {
  readonly ordinal: number;
  readonly candidateDigest: string;
  readonly checkedCandidateReceiptDigest: string;
  readonly workIri: string;
  readonly originalConstructionBasisDigest: string;
  readonly lineageDigest: string;
  readonly byteDeltaDigest: string;
  readonly fileModeDigest: string;
  readonly candidateTreeDigest: string;
  readonly writeSetDigest: string;
}

export interface IntegrationAuthorityBinding {
  readonly scopedIntegrationAuthorityDependencyDigest: string;
  readonly algorithmIri: string;
  readonly algorithmVersion: string;
  readonly algorithmResourceDigest: string;
  readonly integrationManifestIdentity: string;
  readonly integrationManifestDigest: string;
  readonly explicitProfileIri: string;
  readonly checkedCandidateSchemaDigest: string;
  readonly cohortMemberSchemaDigest: string;
  readonly integrationObservationSchemaDigest: string;
  readonly candidateValidationWallTimeMilliseconds: number;
  readonly postimageValidationWallTimeMilliseconds: number;
  readonly validationTerminationGraceMilliseconds: number;
}

export interface IntegrationRequest extends IntegrationAuthorityBinding {
  readonly candidateCount: number;
  readonly orderedCandidateSetDigest: string;
  readonly checkedCandidateSetDigest: string;
  readonly cohortMemberSetDigest: string;
  readonly startingCarrierCommit: string;
  readonly startingCarrierTree: string;
  readonly requestMemberSetDigest: string;
  readonly requestDigestMembershipResourceDigest: string;
  readonly requestDigest: string;
}

export interface AuthoritativeGitPathEffect {
  readonly path: string;
  readonly changeKind: "add" | "modify" | "delete";
  readonly beforeMode: GitFileMode | null;
  readonly afterMode: GitFileMode | null;
  readonly beforeGitObject: string | null;
  readonly afterGitObject: string | null;
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
}

export interface PostimageValidationResult {
  readonly workIri: string;
  readonly basisDigest: string;
  readonly validationObligationIri: string;
  readonly validationCommandDigest: string;
  readonly validationEnvironmentDigest: string;
  readonly validationExecutionModeDigest: string;
  readonly validationToolDependencyDigest: string;
  readonly validationSchemaDependencyDigest: string;
  readonly validationResultSetDigest: string;
  readonly timedOut: false;
  readonly timeoutTerminationSignal: "none";
  readonly outputResultDigest: string;
}

export interface PreparedCandidateIntegration {
  readonly schema: "urn:usf:prepared-candidate-integration:1";
  readonly request: IntegrationRequest;
  readonly checkedCandidateReceipts: readonly CheckedCandidateReceipt[];
  readonly cohortMembers: readonly IntegrationCohortMember[];
  readonly originalConstructionBases: readonly RealisationBasis[];
  readonly authoritativeGitDiff: readonly AuthoritativeGitPathEffect[];
  readonly workspaceIdentityDigest: string;
  readonly integratedTreeDigest: string;
  readonly preparedCarrierCommit: string;
  readonly preparedCarrierTree: string;
  readonly independentlyDerivedPostimageBases: readonly RealisationBasis[];
  readonly independentlyDerivedPostimageBasisDigest: string;
  readonly postimageValidationResults: readonly PostimageValidationResult[];
  readonly postimageValidationResultSetDigest: string;
  readonly intentPath: string;
  readonly recoveryState: "no-effect" | "prepared-commit";
  readonly nonClaims: readonly string[];
}

export interface IntegrationObservation extends IntegrationRequest {
  readonly schema: "urn:usf:integration-observation:1";
  readonly observationDigest: string;
  readonly observationMemberSetDigest: string;
  readonly observationDigestMembershipResourceDigest: string;
  readonly outcome: typeof integrationSuccessOutcome | typeof integrationRefusalOutcome;
  readonly workspaceIdentityDigest?: string;
  readonly primaryMutationLockIdentity?: string;
  readonly integratedTreeDigest?: string;
  readonly observedCarrierCommit?: string;
  readonly observedCarrierTree?: string;
  readonly independentlyDerivedPostimageBasisDigest?: string;
  readonly postimageValidationResultSetDigest?: string;
  readonly refusalReason?: IntegrationReasonCode;
  readonly postimageValidationTimedOut: boolean;
  readonly postimageValidationTimeoutTerminationSignal: "none" | "SIGTERM" | "SIGKILL";
  readonly postimageValidationOutputResultDigest: string;
  readonly cohortMembers: readonly IntegrationCohortMember[];
  readonly checkedCandidateReceipts: readonly CheckedCandidateReceipt[];
  readonly originalConstructionBases: readonly RealisationBasis[];
  readonly authoritativeGitDiff?: readonly AuthoritativeGitPathEffect[];
  readonly independentlyDerivedPostimageBases?: readonly RealisationBasis[];
  readonly postimageValidationResults?: readonly PostimageValidationResult[];
  readonly lockWaitMilliseconds: number;
  readonly lockHoldMilliseconds: number;
  readonly rollbackState: "not-required-no-effect" | "not-required-fast-forward" | "forbidden-mismatch";
  readonly recoveryState: "new-advancement" | "exact-primary-advancement" | "quarantined";
  readonly nonClaims: readonly string[];
}

export interface CandidateIntegrationOptions {
  readonly candidateDigests: readonly string[];
  /** Test seam only. Production callers omit this and use the confined graph-derived verifier. */
  readonly verifier?: IntegrationCandidateVerifier;
}

interface PreparedIntent {
  readonly schema: "urn:usf:integration-intent:1";
  readonly locatorSetDigest: string;
  readonly state: "prepared-commit" | "primary-advanced" | "quarantined";
  readonly prepared: PreparedCandidateIntegration;
  readonly observationPath: string | null;
  readonly intentDigest: string;
}

interface PrimaryAdvancedMarker {
  readonly schema: "urn:usf:primary-advanced-marker:1";
  readonly requestDigest: string;
  readonly scopedIntegrationAuthorityDependencyDigest: string;
  readonly startingCarrierCommit: string;
  readonly preparedCarrierCommit: string;
  readonly preparedCarrierTree: string;
  readonly primaryMutationLockIdentity: typeof primaryMutationLockIdentity;
  readonly state: "primary-advanced";
  readonly markerDigest: string;
}

const predicateIri = (name: string): string => `urn:usf:predicate:${name}`;
const expectedIntegrationRequestFields = bytewiseSorted([
  "scopedIntegrationAuthorityDependencyDigest", "algorithmIri", "algorithmVersion", "algorithmResourceDigest",
  "integrationManifestIdentity", "integrationManifestDigest", "explicitProfileIri", "checkedCandidateSchemaDigest",
  "cohortMemberSchemaDigest", "integrationObservationSchemaDigest", "candidateCount", "orderedCandidateSetDigest",
  "checkedCandidateSetDigest", "cohortMemberSetDigest", "startingCarrierCommit", "startingCarrierTree",
  "candidateValidationWallTimeMilliseconds", "postimageValidationWallTimeMilliseconds", "validationTerminationGraceMilliseconds",
  "requestMemberSetDigest", "requestDigestMembershipResourceDigest",
]);
const expectedIntegrationObservationBaseFields = bytewiseSorted([
  "requestDigest", "outcome", "observationMemberSetDigest", "observationDigestMembershipResourceDigest",
  "postimageValidationTimedOut", "postimageValidationTimeoutTerminationSignal", "postimageValidationOutputResultDigest",
]);
const expectedIntegrationObservationSuccessFields = bytewiseSorted([
  "workspaceIdentityDigest", "primaryMutationLockIdentity", "integratedTreeDigest", "observedCarrierCommit", "observedCarrierTree",
  "independentlyDerivedPostimageBasisDigest", "postimageValidationResultSetDigest",
]);
const expectedIntegrationObservationRefusalFields = ["refusalReason"];

function integrationOne(graph: SemanticGraph, subject: string, name: string, kind?: "iri" | "literal"): string {
  const values = objectsFor(graph, subject, predicateIri(name));
  if (values.length !== 1 || (kind !== undefined && values[0]?.objectKind !== kind)) {
    throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID", `Integration authority cardinality invalid: ${subject} ${name}`);
  }
  return values[0]!.object;
}

function bytewiseSorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
}

function exactDeclaredFields(graph: SemanticGraph, subject: string, predicateName: string): string[] {
  const values = objectValues(graph, subject, predicateIri(predicateName));
  if (values.length === 0 || new Set(values).size !== values.length
    || values.some((field) => !/^[A-Za-z][A-Za-z0-9]*$/u.test(field))) throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID");
  return bytewiseSorted(values);
}

function selectedFieldMap(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field)) throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID", `Required digest member missing: ${field}`);
    selected[field] = source[field];
  }
  return selected;
}

function safeRepositoryPath(path: string): string {
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(path) || path.startsWith(".git/") || path === ".git"
    || path.startsWith(".usf/") || path === ".usf" || path.split("/").some((part) => part === ".." || part === ".")) {
    throw new IntegrationError("INTEGRATION_UNDECLARED_EFFECT", `Unsafe integration path: ${path}`);
  }
  return path;
}

function safeInternalIntegrationPath(path: string): string {
  if (!path.startsWith(".usf/receipts/integration/")
    || !/^[A-Za-z0-9._/-]+$/u.test(path)
    || path.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
  }
  return path;
}

function processUid(fallback: number): number { return typeof process.getuid === "function" ? process.getuid() : fallback; }

function assertCanonicalRoot(root: string): void {
  if (realpathSync(root) !== root) throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE", "Repository root is not canonical");
}

function assertPrivateUsfDirectorySync(root: string, repositoryPath: string, create: boolean): string {
  assertCanonicalRoot(root);
  if (!/^\.usf(?:\/[A-Za-z0-9._-]+)*$/u.test(repositoryPath)
    || repositoryPath.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE", "Private state path is invalid");
  }
  let cursor = root;
  for (const part of repositoryPath.split("/")) {
    cursor = resolve(cursor, part);
    try {
      lstatSync(cursor);
    } catch (error: unknown) {
      if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE", "Private state ancestry is unavailable");
      }
      try { mkdirSync(cursor, { mode: 0o700 }); }
      catch (mkdirError: unknown) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE");
      }
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o077) !== 0 || entry.nlink < 1 || realpathSync(cursor) !== cursor
      || relative(root, cursor).startsWith(`..${sep}`)) {
      throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE", `Unsafe private state ancestry: ${repositoryPath}`);
    }
  }
  return cursor;
}

function privateUsfDirectoryExistsSync(root: string, repositoryPath: string): boolean {
  assertCanonicalRoot(root);
  if (!/^\.usf(?:\/[A-Za-z0-9._-]+)*$/u.test(repositoryPath)) throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE");
  let cursor = root;
  for (const part of repositoryPath.split("/")) {
    cursor = resolve(cursor, part);
    let entry: ReturnType<typeof lstatSync>;
    try { entry = lstatSync(cursor); }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE");
    }
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o077) !== 0 || realpathSync(cursor) !== cursor) {
      throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE");
    }
  }
  return true;
}

function assertPrivateWorktreeRootSync(stateRoot: string, worktree: string, create = false): void {
  const repositoryPath = relative(stateRoot, worktree).split(sep).join("/");
  if (!/^\.usf\/integration-worktrees\/[a-f0-9]{64}$/u.test(repositoryPath)) {
    throw new IntegrationError("INTEGRATION_PRIVATE_STATE_UNSAFE", "Integration worktree identity is invalid");
  }
  assertPrivateUsfDirectorySync(stateRoot, ".usf", create);
  assertPrivateUsfDirectorySync(stateRoot, ".usf/integration-worktrees", create);
  assertPrivateUsfDirectorySync(stateRoot, repositoryPath, create);
}

function readPrivateIntegrationFile(root: string, repositoryPath: string, maximumBytes = 4 * 1024 * 1024): string {
  const safePath = safeInternalIntegrationPath(repositoryPath);
  const directoryPath = relative(root, dirname(resolve(root, safePath))).split(sep).join("/");
  assertPrivateUsfDirectorySync(root, directoryPath, false);
  const absolute = resolve(root, safePath);
  let descriptor: number;
  try { descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
  catch { throw new IntegrationError("INTEGRATION_INTENT_MISMATCH"); }
  try {
    const opened = fstatSync(descriptor);
    const named = lstatSync(absolute);
    if (!opened.isFile() || named.isSymbolicLink() || !named.isFile() || opened.uid !== processUid(opened.uid)
      || opened.nlink !== 1 || named.nlink !== 1 || (opened.mode & 0o177) !== 0 || opened.size > maximumBytes
      || opened.dev !== named.dev || opened.ino !== named.ino || realpathSync(absolute) !== absolute) {
      throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength !== opened.size || bytes.byteLength > maximumBytes) throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
    return bytes.toString("utf8");
  } finally { closeSync(descriptor); }
}

function mkdirSyncCompat(path: string): void {
  try { mkdirSync(path, { recursive: true, mode: 0o700 }); }
  catch { throw new IntegrationError("INTEGRATION_GIT_FAILED", "Private integration directory cannot be created"); }
}

function chmodSyncCompat(path: string, mode: number): void {
  try { chmodSync(path, mode); }
  catch { throw new IntegrationError("INTEGRATION_GIT_FAILED", "Private integration directory mode cannot be set"); }
}

function assertTrustedGit(): void {
  let entry: ReturnType<typeof lstatSync>;
  try { entry = lstatSync("/usr/bin/git"); } catch { throw new IntegrationError("INTEGRATION_GIT_UNAVAILABLE"); }
  if (entry.isSymbolicLink() || !entry.isFile() || entry.uid !== 0 || (entry.mode & 0o022) !== 0 || (entry.mode & 0o111) === 0
    || realpathSync("/usr/bin/git") !== "/usr/bin/git") {
    throw new IntegrationError("INTEGRATION_GIT_UNAVAILABLE", "Git executable is not a trusted root-owned host dependency");
  }
}

const allowedGitCommands = new Set([
  "rev-parse", "symbolic-ref", "status", "check-attr", "worktree", "add", "commit", "diff", "ls-files", "ls-tree", "cat-file", "update-ref", "merge", "merge-base",
]);

function gitResult(root: string, command: string, args: readonly string[] = [], input?: Uint8Array): { status: number; stdout: Buffer; stderr: Buffer } {
  assertTrustedGit();
  if (!allowedGitCommands.has(command)) throw new IntegrationError("INTEGRATION_GIT_FAILED", `Forbidden Git command: ${command}`);
  const worktreeMarker = `${sep}.usf${sep}integration-worktrees${sep}`;
  const markerIndex = root.indexOf(worktreeMarker);
  const stateRoot = markerIndex < 0 ? root : root.slice(0, markerIndex);
  assertCanonicalRoot(stateRoot);
  if (markerIndex >= 0) assertPrivateWorktreeRootSync(stateRoot, root);
  const privateHome = resolve(stateRoot, ".usf", "home", "git-integration");
  assertPrivateUsfDirectorySync(stateRoot, ".usf", true);
  assertPrivateUsfDirectorySync(stateRoot, ".usf/home", true);
  assertPrivateUsfDirectorySync(stateRoot, ".usf/home/git-integration", true);
  const result = spawnSync("/usr/bin/git", [
    "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgSign=false",
    "-c", "tag.gpgSign=false",
    "-c", "credential.helper=",
    "-c", "core.askPass=",
    "-c", "core.fsmonitor=false",
    "-c", "core.autocrlf=false",
    "-c", "core.safecrlf=true",
    "-c", "maintenance.auto=false",
    "-c", "gc.auto=0",
    "-c", "protocol.allow=never",
    "-c", "user.name=USF Integration",
    "-c", "user.email=integration@invalid.local",
    "-C", root,
    command,
    ...args,
  ], {
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      HOME: privateHome,
      XDG_CONFIG_HOME: privateHome,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false",
      SSH_ASKPASS: "/bin/false",
      GIT_EDITOR: "/bin/false",
      GIT_SEQUENCE_EDITOR: "/bin/false",
      GIT_PAGER: "cat",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  });
  return { status: result.status ?? 127, stdout: Buffer.from(result.stdout ?? ""), stderr: Buffer.from(result.stderr ?? "") };
}

function git(root: string, command: string, args: readonly string[] = [], input?: Uint8Array): Buffer {
  const result = gitResult(root, command, args, input);
  if (result.status !== 0) {
    const message = result.stderr.toString("utf8").slice(0, 512);
    throw new IntegrationError("INTEGRATION_GIT_FAILED", `${command} failed: ${message}`);
  }
  return result.stdout;
}

function gitText(root: string, command: string, args: readonly string[] = []): string {
  return git(root, command, args).toString("utf8").trim();
}

function assertGitRoot(root: string): void {
  const observed = realpathSync(gitText(root, "rev-parse", ["--show-toplevel"]));
  if (observed !== realpathSync(root)) throw new IntegrationError("INTEGRATION_GIT_FAILED", "Repository root mismatch");
}

function gitHead(root: string): string {
  const value = gitText(root, "rev-parse", ["--verify", "HEAD"]);
  if (!/^[0-9a-f]{40,64}$/u.test(value)) throw new IntegrationError("INTEGRATION_GIT_FAILED");
  return value;
}

function gitTree(root: string, revision: string): string {
  const value = gitText(root, "rev-parse", [`${revision}^{tree}`]);
  if (!/^[0-9a-f]{40,64}$/u.test(value)) throw new IntegrationError("INTEGRATION_GIT_FAILED");
  return value;
}

function nulFields(bytes: Buffer): string[] {
  const fields = bytes.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}

function assertNoFilterAttributes(root: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  const attributes = ["filter", "working-tree-encoding", "ident", "text", "eol"];
  for (let offset = 0; offset < paths.length; offset += 256) {
    const chunk = paths.slice(offset, offset + 256);
    const fields = nulFields(git(root, "check-attr", ["-z", ...attributes, "--", ...chunk]));
    if (fields.length !== chunk.length * attributes.length * 3) throw new IntegrationError("INTEGRATION_FILTER_ATTRIBUTE");
    for (let index = 0; index < fields.length; index += 3) {
      if (fields[index + 2] !== "unspecified") throw new IntegrationError("INTEGRATION_FILTER_ATTRIBUTE", `Git attribute transforms bytes: ${fields[index]} ${fields[index + 1]}`);
    }
  }
}

function assertTouchedPrimaryClean(root: string, paths: readonly string[]): void {
  if (git(root, "status", ["--porcelain=v1", "-z", "--untracked-files=all", "--", ...paths]).byteLength !== 0) {
    throw new IntegrationError("INTEGRATION_PRIMARY_TOUCHED_PATH_DIRTY");
  }
}

function fileModeAt(root: string, repositoryPath: string): GitFileMode | null {
  const path = safeRepositoryPath(repositoryPath);
  let cursor = root;
  for (const part of path.split("/")) {
    cursor = resolve(cursor, part);
    try {
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new IntegrationError("INTEGRATION_SYMLINK_OR_NONREGULAR");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  const entry = lstatSync(cursor);
  if (!entry.isFile()) throw new IntegrationError("INTEGRATION_SYMLINK_OR_NONREGULAR");
  return (entry.mode & 0o111) === 0 ? "100644" : "100755";
}

function bytesAtIntegrationPath(root: string, repositoryPath: string): Buffer | null {
  const mode = fileModeAt(root, repositoryPath);
  return mode === null ? null : readFileSync(resolve(root, repositoryPath));
}

function validationAuthority(root: string, basis: RealisationBasis, phase: "candidate" | "postimage" = "postimage"): IntegrationValidationAuthority {
  if (basis.trace.validation.length !== 1) throw new IntegrationError("INTEGRATION_VALIDATION_INVALID", "Exactly one graph validation obligation is required");
  const reference = basis.trace.validation[0]!;
  const graph = loadSemanticGraph(root, basis.selection.manifestPath);
  const integrationGraph = loadSemanticGraph(root, integrationManifestIdentity);
  const validationTypes = objectsFor(graph, reference.id, predicateIri("type"));
  if (validationTypes.length !== 1 || validationTypes[0]?.objectKind !== "iri" || validationTypes[0].object !== "urn:usf:type:TestObligation"
    || resourceDigest(graph, reference.id) !== reference.digest
    || integrationOne(graph, reference.id, "applicability", "literal") !== "required") throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
  const command = integrationOne(graph, reference.id, "command", "literal");
  const commandTokens = command.split(" ");
  if (commandTokens.join(" ") !== command || commandTokens.some((token) => token.length === 0)) throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
  const environmentIri = integrationOne(graph, reference.id, "environment", "iri");
  const executionModeIri = integrationOne(graph, reference.id, "executionMode", "iri");
  if (environmentIri !== "urn:usf:environment:hermetic" || executionModeIri !== "urn:usf:mode:deterministic-test-substitute") {
    throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
  }
  const hostTools = objectsFor(graph, reference.id, predicateIri("hostToolDependency"));
  if (hostTools.length !== 1 || hostTools[0]?.objectKind !== "iri" || hostTools[0].object !== "urn:usf:host-tool:bwrap:0.9.0") {
    throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
  }
  const hostTool = hostTools[0].object;
  const toolDependencies = [
    ...basis.inputs.toolDigests.map((dependency) => ({ kind: "basis-input" as const, ...dependency })),
    { kind: "host-tool" as const, id: hostTool, digest: resourceDigest(graph, hostTool) },
  ];
  const schemaDependencies = basis.inputs.schemaDigests.map((dependency) => ({ ...dependency }));
  const wallTimeMilliseconds = Number(integrationOne(
    integrationGraph,
    integrationAlgorithmIri,
    phase === "candidate" ? "candidateValidationWallTimeMilliseconds" : "postimageValidationWallTimeMilliseconds",
    "literal",
  ));
  const terminationGraceMilliseconds = Number(integrationOne(integrationGraph, integrationAlgorithmIri, "validationTerminationGraceMilliseconds", "literal"));
  const maximumSettlementWallTimeMilliseconds = Number(integrationOne(integrationGraph, integrationAlgorithmIri, "validationMaximumSettlementWallTimeMilliseconds", "literal"));
  if (wallTimeMilliseconds !== 120_000 || terminationGraceMilliseconds !== 5_000 || maximumSettlementWallTimeMilliseconds !== 125_000
    || integrationOne(integrationGraph, integrationAlgorithmIri, "validationTerminationSignal", "literal") !== "SIGTERM"
    || integrationOne(integrationGraph, integrationAlgorithmIri, "validationForcedTerminationSignal", "literal") !== "SIGKILL") {
    throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
  }
  return deepFreeze({
    obligationIri: reference.id,
    command,
    commandTokens,
    validationResourceDigest: resourceDigest(graph, reference.id),
    environmentIri,
    executionModeIri,
    commandDigest: canonicalDigest(commandTokens),
    environmentDigest: resourceDigest(graph, environmentIri),
    executionModeDigest: resourceDigest(graph, executionModeIri),
    toolDependencies,
    toolDependencyDigest: canonicalDigest(toolDependencies, { rejectAbsolutePaths: true }),
    schemaDependencies,
    schemaDependencyDigest: canonicalDigest(schemaDependencies, { rejectAbsolutePaths: true }),
    executionAuthorityResourceDigest: resourceDigest(integrationGraph, integrationAlgorithmIri),
    wallTimeMilliseconds,
    terminationGraceMilliseconds,
    terminationSignal: "SIGTERM" as const,
    forcedTerminationSignal: "SIGKILL" as const,
    maximumSettlementWallTimeMilliseconds,
  });
}

function assertVerifierObservation(observation: IntegrationVerifierObservation, authority: IntegrationValidationAuthority): IntegrationValidationExecutionObservation {
  if (!observation || Object.keys(observation).sort().join(",") !== "outcome,resultDigests" || observation.outcome !== "pass"
    || !Array.isArray(observation.resultDigests) || observation.resultDigests.length === 0
    || observation.resultDigests.some((entry) => !digestPattern.test(entry)) || new Set(observation.resultDigests).size !== observation.resultDigests.length
    || [...observation.resultDigests].sort().some((entry, index) => entry !== observation.resultDigests[index])) {
    throw new IntegrationError("INTEGRATION_VALIDATION_FAILED");
  }
  return {
    timedOut: false,
    timeoutTerminationSignal: "none",
    outputResultDigest: canonicalDigest({
      executionAuthorityResourceDigest: authority.executionAuthorityResourceDigest,
      wallTimeMilliseconds: authority.wallTimeMilliseconds,
      terminationGraceMilliseconds: authority.terminationGraceMilliseconds,
      timedOut: false,
      timeoutTerminationSignal: "none",
      resultDigests: observation.resultDigests,
    }),
  };
}

async function integrationDependencyRoots(): Promise<readonly string[]> {
  let candidate = resolve(import.meta.dirname, "../..");
  for (;;) {
    let roots: readonly string[];
    try {
      roots = await Promise.all([
        realpath(resolve(candidate, "node_modules")),
        realpath(resolve(candidate, ".usf/cache")),
      ]);
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
      candidate = parent;
      continue;
    }
    const canonicalCandidate = realpathSync(candidate);
    if (canonicalCandidate !== candidate || roots[1] !== resolve(candidate, ".usf", "cache")) {
      throw new IntegrationError("INTEGRATION_VALIDATION_INVALID", "Integration cache identity is not canonical");
    }
    assertPrivateUsfDirectorySync(canonicalCandidate, ".usf/cache", false);
    const dependencyRoot = lstatSync(roots[0]!);
    if (dependencyRoot.isSymbolicLink() || !dependencyRoot.isDirectory() || realpathSync(roots[0]!) !== roots[0]) {
      throw new IntegrationError("INTEGRATION_VALIDATION_INVALID", "Integration dependency root is unsafe");
    }
    return roots;
  }
}

/** Production postimage verifier: exact graph command, private network namespace, bounded output. */
export async function runIntegrationValidation(input: IntegrationVerifierInput): Promise<IntegrationVerifierObservation> {
  if (input.phase !== "postimage") throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
  const scratch = resolve(input.repositoryRoot, ".usf", "integration-validation");
  const localNodeModules = resolve(input.repositoryRoot, "node_modules");
  const localCache = resolve(input.repositoryRoot, ".usf", "cache");
  let localNodeModulesCreated = false;
  let localCacheCreated = false;
  assertPrivateWorktreeRootSync(input.repositoryRoot.slice(0, input.repositoryRoot.indexOf(`${sep}.usf${sep}integration-worktrees${sep}`)), input.repositoryRoot);
  if (privateUsfDirectoryExistsSync(input.repositoryRoot, ".usf/integration-validation")) {
    await rm(scratch, { recursive: true, force: true });
  }
  assertPrivateUsfDirectorySync(input.repositoryRoot, ".usf", true);
  assertPrivateUsfDirectorySync(input.repositoryRoot, ".usf/integration-validation", true);
  try {
    try {
      await mkdir(localNodeModules, { mode: 0o700 });
      localNodeModulesCreated = true;
    } catch (error: unknown) {
      throw new IntegrationError("INTEGRATION_VALIDATION_INVALID", `Workspace dependency mount is unavailable: ${(error as NodeJS.ErrnoException).code ?? "UNKNOWN"}`);
    }
    if (privateUsfDirectoryExistsSync(input.repositoryRoot, ".usf/cache")) {
      throw new IntegrationError("INTEGRATION_VALIDATION_INVALID", "Workspace cache mount must be freshly prepared");
    }
    assertPrivateUsfDirectorySync(input.repositoryRoot, ".usf/cache", true);
    localCacheCreated = true;
    const { confinedNodeTestLaunch } = await import("../commands/check.ts");
    const dependencyRoots = await integrationDependencyRoots();
    // Re-authenticate the repository-local optional cache immediately before
    // its path is handed to the bwrap bind construction.
    const cacheRoot = dependencyRoots[1]!;
    const dependencyRepository = resolve(cacheRoot, "../..");
    assertPrivateUsfDirectorySync(realpathSync(dependencyRepository), ".usf/cache", false);
    const launch = confinedNodeTestLaunch(input.repositoryRoot, scratch, dependencyRoots, input.authority.commandTokens);
    if (launch === null) throw new IntegrationError("INTEGRATION_VALIDATION_INVALID");
    const observed = await new Promise<{ exitCode: number; withinLimit: boolean; timedOut: boolean; timeoutTerminationSignal: "none" | "SIGTERM" | "SIGKILL" }>((finish) => {
      const child = spawn(launch.executable, launch.arguments, {
        cwd: input.repositoryRoot,
        env: {},
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let bytes = 0;
      let withinLimit = true;
      let timedOut = false;
      let timeoutTerminationSignal: "none" | "SIGTERM" | "SIGKILL" = "none";
      let settled = false;
      let graceTimer: NodeJS.Timeout | undefined;
      let wallTimer: NodeJS.Timeout | undefined;
      const settle = (exitCode: number): void => {
        if (settled) return;
        settled = true;
        if (wallTimer !== undefined) clearTimeout(wallTimer);
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        finish({ exitCode, withinLimit, timedOut, timeoutTerminationSignal });
      };
      const terminateTree = (signal: "SIGTERM" | "SIGKILL"): boolean => {
        try {
          if (child.pid === undefined) return child.kill(signal);
          process.kill(-child.pid, signal);
          return true;
        } catch {
          try { return child.kill(signal); } catch { return false; }
        }
      };
      const observe = (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 256 * 1024 && withinLimit) { withinLimit = false; terminateTree("SIGKILL"); }
      };
      child.stdout?.on("data", observe);
      child.stderr?.on("data", observe);
      wallTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        if (terminateTree(input.authority.terminationSignal)) timeoutTerminationSignal = input.authority.terminationSignal;
        graceTimer = setTimeout(() => {
          if (settled) return;
          if (terminateTree(input.authority.forcedTerminationSignal)) timeoutTerminationSignal = input.authority.forcedTerminationSignal;
          settle(1);
        }, input.authority.terminationGraceMilliseconds);
      }, input.authority.wallTimeMilliseconds);
      child.once("error", () => settle(1));
      child.once("exit", (code) => settle(code ?? 1));
    });
    const deterministicResult = canonicalDigest({
      exitCode: observed.exitCode,
      outputWithinLimit: observed.withinLimit,
      outputLimitBytes: 256 * 1024,
      network: "isolated",
      validationObligationIri: input.authority.obligationIri,
      validationCommandDigest: input.authority.commandDigest,
      validationEnvironmentDigest: input.authority.environmentDigest,
      validationExecutionModeDigest: input.authority.executionModeDigest,
      validationToolDependencyDigest: input.authority.toolDependencyDigest,
      validationSchemaDependencyDigest: input.authority.schemaDependencyDigest,
    });
    const validationExecution: IntegrationValidationExecutionObservation = {
      timedOut: observed.timedOut,
      timeoutTerminationSignal: observed.timeoutTerminationSignal,
      outputResultDigest: canonicalDigest({
        executionAuthorityResourceDigest: input.authority.executionAuthorityResourceDigest,
        wallTimeMilliseconds: input.authority.wallTimeMilliseconds,
        terminationGraceMilliseconds: input.authority.terminationGraceMilliseconds,
        timedOut: observed.timedOut,
        timeoutTerminationSignal: observed.timeoutTerminationSignal,
        resultDigests: [deterministicResult],
      }),
    };
    if (observed.timedOut) throw new IntegrationError(
      "INTEGRATION_VALIDATION_TIMEOUT",
      `Postimage validation exceeded ${input.authority.wallTimeMilliseconds}ms`,
      validationExecution,
    );
    if (!observed.withinLimit || observed.exitCode !== 0) throw new IntegrationError(
      "INTEGRATION_VALIDATION_FAILED",
      `Postimage validation failed with bounded exit code ${observed.exitCode}`,
      validationExecution,
    );
    return deepFreeze({
      outcome: "pass" as const,
      resultDigests: [deterministicResult],
    });
  } finally {
    if (privateUsfDirectoryExistsSync(input.repositoryRoot, ".usf/integration-validation")) {
      await rm(scratch, { recursive: true, force: true });
    }
    if (localCacheCreated) await rmdir(localCache);
    if (localNodeModulesCreated) await rmdir(localNodeModules);
  }
}

const checkedReceiptFields = [
  "schema", "workIri", "explicitProfileIri", "originalConstructionBasisDigest", "scopedDependencyDigest", "candidateDigest",
  "workspaceIdentityDigest", "lineageDigest", "byteDeltaDigest", "fileModeDigest", "candidateTreeDigest", "writeSetDigest",
  "validationObligationIri", "validationResourceDigest", "validationCommandTokens", "validationCommandDigest",
  "validationEnvironmentIri", "validationEnvironmentDigest", "validationExecutionModeIri", "validationExecutionModeDigest",
  "validationToolDependencies", "validationToolDependencyDigest", "validationSchemaDependencies", "validationSchemaDependencyDigest",
  "validationAuthorityDependencies", "validationAuthorityDependencyDigest", "checkedCandidateSchemaDigest", "exitCode", "outputResultDigest",
  "validationExecutionAuthorityResourceDigest", "validationWallTimeMilliseconds", "validationTerminationGraceMilliseconds",
  "validationTimedOut", "validationTimeoutTerminationSignal", "validationResultSetDigest", "receiptDigest",
] as const;

async function authenticatedCheckedReceipt(
  authorityRoot: string,
  authenticated: AuthenticatedCandidateWorkspace,
  expectedSchemaDigest: string,
): Promise<CheckedCandidateReceipt> {
  const basis = authenticated.constructionBasis;
  const authority = validationAuthority(authorityRoot, basis, "candidate");
  const { readGraphDerivedCheckReceipt } = await import("../commands/check.ts");
  const loaded = await readGraphDerivedCheckReceipt(authorityRoot, authenticated.candidateDigest, authority.obligationIri)
    .catch(() => { throw new IntegrationError("INTEGRATION_CHECK_RECEIPT_INVALID"); });
  if (loaded === null) throw new IntegrationError("INTEGRATION_CHECK_RECEIPT_MISSING");
  const receipt = loaded.receipt;
  const actualFields = Object.keys(receipt).sort();
  const expectedFields = [...checkedReceiptFields].sort();
  const { receiptDigest: suppliedDigest, ...receiptDraft } = receipt;
  if (actualFields.length !== expectedFields.length || actualFields.some((field, index) => field !== expectedFields[index])
    || suppliedDigest !== canonicalDigest(receiptDraft, { rejectAbsolutePaths: true })
    || receipt.schema !== "urn:usf:checked-candidate-receipt:1"
    || receipt.workIri !== basis.work.id || receipt.explicitProfileIri !== basis.selection.profile
    || receipt.originalConstructionBasisDigest !== basis.basisDigest || receipt.scopedDependencyDigest !== basis.work.scopedDependencyDigest
    || receipt.candidateDigest !== authenticated.candidateDigest || receipt.workspaceIdentityDigest !== authenticated.workspaceIdentityDigest
    || receipt.lineageDigest !== authenticated.lineageDigest || receipt.byteDeltaDigest !== authenticated.byteDeltaDigest
    || receipt.fileModeDigest !== authenticated.fileModeDigest || receipt.candidateTreeDigest !== authenticated.candidateTreeDigest
    || receipt.writeSetDigest !== authenticated.writeSetDigest || receipt.validationObligationIri !== authority.obligationIri
    || receipt.validationResourceDigest !== authority.validationResourceDigest
    || canonicalJson(receipt.validationCommandTokens) !== canonicalJson(authority.commandTokens)
    || receipt.validationCommandDigest !== authority.commandDigest || receipt.validationEnvironmentIri !== authority.environmentIri
    || receipt.validationEnvironmentDigest !== authority.environmentDigest || receipt.validationExecutionModeIri !== authority.executionModeIri
    || receipt.validationExecutionModeDigest !== authority.executionModeDigest
    || canonicalJson(receipt.validationToolDependencies) !== canonicalJson(authority.toolDependencies)
    || receipt.validationToolDependencyDigest !== authority.toolDependencyDigest
    || canonicalJson(receipt.validationSchemaDependencies) !== canonicalJson(authority.schemaDependencies)
    || receipt.validationSchemaDependencyDigest !== authority.schemaDependencyDigest
    || receipt.validationAuthorityDependencyDigest !== canonicalDigest(receipt.validationAuthorityDependencies, { rejectAbsolutePaths: true })
    || receipt.checkedCandidateSchemaDigest !== expectedSchemaDigest || receipt.exitCode !== 0
    || receipt.validationExecutionAuthorityResourceDigest !== authority.executionAuthorityResourceDigest
    || receipt.validationWallTimeMilliseconds !== authority.wallTimeMilliseconds
    || receipt.validationTerminationGraceMilliseconds !== authority.terminationGraceMilliseconds
    || receipt.validationTimedOut !== false || receipt.validationTimeoutTerminationSignal !== "none"
    || receipt.validationResultSetDigest !== canonicalDigest({ validationObligationIri: authority.obligationIri, outcome: "pass", outputResultDigest: receipt.outputResultDigest })) {
    throw new IntegrationError("INTEGRATION_CHECK_RECEIPT_INVALID");
  }
  let expectedAuthorityPaths: string[];
  try {
    const currentGraph = loadSemanticGraph(authorityRoot, basis.selection.manifestPath);
    const closurePaths = validationRuntimeClosure(currentGraph, authority.obligationIri).repositoryReadFiles.map(safeRepositoryPath);
    const currentnessValues = objectsFor(currentGraph, basis.authority.permission, predicateIri("activationCurrentness"));
    if (currentnessValues.length > 1 || currentnessValues.some((quad) => quad.objectKind !== "iri")) throw new Error("CURRENTNESS_INVALID");
    const receiptPaths = currentnessValues.length === 0
      ? []
      : [safeRepositoryPath(integrationOne(currentGraph, currentnessValues[0]!.object, "receiptPath", "literal"))];
    const candidatePaths = new Set(authenticated.scopedTree.map((entry) => entry.path));
    expectedAuthorityPaths = [...new Set([...closurePaths, ...receiptPaths])]
      .filter((path) => !candidatePaths.has(path))
      .sort();
  } catch {
    throw new IntegrationError("INTEGRATION_CHECK_RECEIPT_INVALID");
  }
  const receiptAuthorityPaths = receipt.validationAuthorityDependencies.map((dependency) => dependency.path).sort();
  if (canonicalJson(receiptAuthorityPaths) !== canonicalJson(expectedAuthorityPaths)) {
    throw new IntegrationError("INTEGRATION_CHECK_RECEIPT_INVALID");
  }
  for (const dependency of receipt.validationAuthorityDependencies) {
    const path = safeRepositoryPath(dependency.path);
    const bytes = bytesAtIntegrationPath(authorityRoot, path);
    if (bytes === null || sha256(bytes) !== dependency.digest) throw new IntegrationError("INTEGRATION_CHECK_RECEIPT_INVALID");
  }
  return deepFreeze(receipt);
}

function integrationAuthority(root: string, explicitProfileIri: string): { graph: LoadedSemanticGraph; binding: IntegrationAuthorityBinding; requestFields: string[]; observationBaseFields: string[]; observationSuccessFields: string[]; observationRefusalFields: string[] } {
  const graph = loadSemanticGraph(root, integrationManifestIdentity);
  const algorithmVersion = integrationOne(graph, integrationAlgorithmIri, "version", "literal");
  if (algorithmVersion !== "2"
    || integrationOne(graph, integrationAlgorithmIri, "checkedCandidateSchema", "iri") !== integrationCheckedSchemaIri
    || integrationOne(graph, integrationAlgorithmIri, "cohortMemberSchema", "iri") !== integrationMemberSchemaIri
    || integrationOne(graph, integrationAlgorithmIri, "integrationObservationSchema", "iri") !== integrationObservationSchemaIri
    || integrationOne(graph, integrationAlgorithmIri, "requestDigestMembership", "iri") !== integrationRequestMembershipIri
    || integrationOne(graph, integrationAlgorithmIri, "observationDigestMembership", "iri") !== integrationObservationMembershipIri
    || integrationOne(graph, integrationAlgorithmIri, "receiptBoundary", "iri") !== integrationReceiptBoundaryIri) {
    throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID");
  }
  const dependencyIris = [
    integrationAlgorithmIri,
    integrationCheckedSchemaIri,
    integrationMemberSchemaIri,
    integrationObservationSchemaIri,
    integrationRequestMembershipIri,
    integrationObservationMembershipIri,
    integrationReceiptBoundaryIri,
    ...objectValues(graph, integrationAlgorithmIri, predicateIri("requires")),
  ].sort();
  const integrationManifestDigest = sha256(readFileSync(resolve(root, integrationManifestIdentity)));
  const candidateValidationWallTimeMilliseconds = Number(integrationOne(graph, integrationAlgorithmIri, "candidateValidationWallTimeMilliseconds", "literal"));
  const postimageValidationWallTimeMilliseconds = Number(integrationOne(graph, integrationAlgorithmIri, "postimageValidationWallTimeMilliseconds", "literal"));
  const validationTerminationGraceMilliseconds = Number(integrationOne(graph, integrationAlgorithmIri, "validationTerminationGraceMilliseconds", "literal"));
  if (candidateValidationWallTimeMilliseconds !== 120_000 || postimageValidationWallTimeMilliseconds !== 120_000
    || validationTerminationGraceMilliseconds !== 5_000
    || integrationOne(graph, integrationAlgorithmIri, "validationTerminationSignal", "literal") !== "SIGTERM"
    || integrationOne(graph, integrationAlgorithmIri, "validationForcedTerminationSignal", "literal") !== "SIGKILL"
    || integrationOne(graph, integrationAlgorithmIri, "validationMaximumSettlementWallTimeMilliseconds", "literal") !== "125000"
    || integrationOne(graph, integrationAlgorithmIri, "postimageValidationTimeoutReasonCode", "literal") !== "INTEGRATION_VALIDATION_TIMEOUT") {
    throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID");
  }
  const binding: IntegrationAuthorityBinding = {
    scopedIntegrationAuthorityDependencyDigest: canonicalDigest({
      manifest: { identity: integrationManifestIdentity, digest: integrationManifestDigest },
      resources: dependencyIris.map((iri) => ({ iri, digest: resourceDigest(graph, iri) })),
    }),
    algorithmIri: integrationAlgorithmIri,
    algorithmVersion,
    algorithmResourceDigest: resourceDigest(graph, integrationAlgorithmIri),
    integrationManifestIdentity,
    integrationManifestDigest,
    explicitProfileIri,
    checkedCandidateSchemaDigest: resourceDigest(graph, integrationCheckedSchemaIri),
    cohortMemberSchemaDigest: resourceDigest(graph, integrationMemberSchemaIri),
    integrationObservationSchemaDigest: resourceDigest(graph, integrationObservationSchemaIri),
    candidateValidationWallTimeMilliseconds,
    postimageValidationWallTimeMilliseconds,
    validationTerminationGraceMilliseconds,
  };
  const requestFields = exactDeclaredFields(graph, integrationRequestMembershipIri, "memberField");
  const observationBaseFields = exactDeclaredFields(graph, integrationObservationMembershipIri, "memberField");
  const observationSuccessFields = exactDeclaredFields(graph, integrationObservationMembershipIri, "successMemberField");
  const observationRefusalFields = exactDeclaredFields(graph, integrationObservationMembershipIri, "refusalMemberField");
  if (canonicalJson(requestFields) !== canonicalJson(expectedIntegrationRequestFields)
    || canonicalJson(observationBaseFields) !== canonicalJson(expectedIntegrationObservationBaseFields)
    || canonicalJson(observationSuccessFields) !== canonicalJson(expectedIntegrationObservationSuccessFields)
    || canonicalJson(observationRefusalFields) !== canonicalJson(expectedIntegrationObservationRefusalFields)) {
    throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID", "Digest membership declarations do not match the closed engine grammar");
  }
  return { graph, binding: deepFreeze(binding), requestFields, observationBaseFields, observationSuccessFields, observationRefusalFields };
}

function canonicalCohortOrder(graph: SemanticGraph, records: readonly { authenticated: AuthenticatedCandidateWorkspace; receipt: CheckedCandidateReceipt }[]): typeof records[number][] {
  const byWork = new Map(records.map((record) => [record.receipt.workIri, record]));
  const remaining = new Set(byWork.keys());
  const ordered: typeof records[number][] = [];
  while (remaining.size > 0) {
    const available = [...remaining].filter((work) => objectValues(graph, work, predicateIri("dependsOn")).every((dependency) => !remaining.has(dependency)));
    if (available.length === 0) throw new IntegrationError("INTEGRATION_CALLER_ORDER_INVALID", "Candidate work dependency cycle");
    available.sort((left, right) => {
      const leftRecord = byWork.get(left)!;
      const rightRecord = byWork.get(right)!;
      return left.localeCompare(right)
        || leftRecord.receipt.receiptDigest.localeCompare(rightRecord.receipt.receiptDigest)
        || leftRecord.receipt.candidateDigest.localeCompare(rightRecord.receipt.candidateDigest);
    });
    for (const work of available) {
      ordered.push(byWork.get(work)!);
      remaining.delete(work);
    }
  }
  return ordered;
}

function cohortMembers(records: readonly { authenticated: AuthenticatedCandidateWorkspace; receipt: CheckedCandidateReceipt }[]): IntegrationCohortMember[] {
  return records.map(({ authenticated, receipt }, index) => ({
    ordinal: index + 1,
    candidateDigest: receipt.candidateDigest,
    checkedCandidateReceiptDigest: receipt.receiptDigest,
    workIri: receipt.workIri,
    originalConstructionBasisDigest: receipt.originalConstructionBasisDigest,
    lineageDigest: authenticated.lineageDigest,
    byteDeltaDigest: authenticated.byteDeltaDigest,
    fileModeDigest: authenticated.fileModeDigest,
    candidateTreeDigest: authenticated.candidateTreeDigest,
    writeSetDigest: authenticated.writeSetDigest,
  }));
}

function parseRawGitDiff(root: string, base: string, paths: readonly string[], cached = true): AuthoritativeGitPathEffect[] {
  const fields = nulFields(git(root, "diff", [...(cached ? ["--cached"] : []), "--raw", "--no-abbrev", "--no-renames", "-z", base, "--", ...paths]));
  if (fields.length % 2 !== 0) throw new IntegrationError("INTEGRATION_UNDECLARED_EFFECT");
  const effects: AuthoritativeGitPathEffect[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([AMD])$/u.exec(fields[index]!);
    const path = fields[index + 1];
    if (!match || path === undefined) throw new IntegrationError("INTEGRATION_UNDECLARED_EFFECT");
    safeRepositoryPath(path);
    const beforeMode = match[1] === "000000" ? null : match[1] as GitFileMode;
    const afterMode = match[2] === "000000" ? null : match[2] as GitFileMode;
    if ((beforeMode !== null && beforeMode !== "100644" && beforeMode !== "100755") || (afterMode !== null && afterMode !== "100644" && afterMode !== "100755")) {
      throw new IntegrationError("INTEGRATION_SYMLINK_OR_NONREGULAR");
    }
    const beforeGitObject = beforeMode === null ? null : match[3]!;
    const afterGitObject = afterMode === null ? null : match[4]!;
    const beforeBytes = beforeGitObject === null ? null : git(root, "cat-file", ["blob", beforeGitObject]);
    const afterBytes = afterGitObject === null ? null : git(root, "cat-file", ["blob", afterGitObject]);
    effects.push({
      path,
      changeKind: match[5] === "A" ? "add" : match[5] === "D" ? "delete" : "modify",
      beforeMode,
      afterMode,
      beforeGitObject,
      afterGitObject,
      beforeDigest: beforeBytes === null ? null : sha256(beforeBytes),
      afterDigest: afterBytes === null ? null : sha256(afterBytes),
    });
  }
  return effects.sort((left, right) => left.path.localeCompare(right.path));
}

function writeIntegrationPath(root: string, repositoryPath: string, bytes: Buffer | null, mode: GitFileMode | null): void {
  const path = safeRepositoryPath(repositoryPath);
  const target = resolve(root, path);
  let cursor = root;
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    cursor = resolve(cursor, part);
    try {
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new IntegrationError("INTEGRATION_SYMLINK_OR_NONREGULAR");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSyncCompat(cursor);
    }
  }
  if (bytes === null) {
    rmSync(target, { force: true });
    return;
  }
  writeFileSyncCompat(target, bytes, mode === "100755" ? 0o755 : 0o644);
}

function writeFileSyncCompat(target: string, bytes: Buffer, mode: number): void {
  try { writeFileSync(target, bytes, { mode }); chmodSync(target, mode); }
  catch { throw new IntegrationError("INTEGRATION_GIT_FAILED"); }
}

async function atomicCanonicalWrite(root: string, repositoryPath: string, value: unknown): Promise<void> {
  const path = safeInternalIntegrationPath(repositoryPath);
  const target = resolve(root, path);
  const directory = dirname(target);
  const directoryPath = relative(root, directory).split(sep).join("/");
  assertPrivateUsfDirectorySync(root, directoryPath, true);
  try {
    const existing = await lstat(target);
    const uid = processUid(existing.uid);
    if (existing.isSymbolicLink() || !existing.isFile() || existing.uid !== uid || existing.nlink !== 1
      || (existing.mode & 0o177) !== 0 || await realpath(target) !== target) throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const bytes = `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`;
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  let temporaryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    temporaryHandle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await temporaryHandle.writeFile(bytes);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    await rename(temporary, target);
    await chmod(target, 0o600);
    const directoryHandle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    if (readPrivateIntegrationFile(root, path) !== bytes) throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
  } finally {
    if (temporaryHandle !== null) await temporaryHandle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function publishCanonicalImmutable(
  root: string,
  repositoryPath: string,
  value: unknown,
  mismatchReason: IntegrationReasonCode,
): Promise<void> {
  const path = safeInternalIntegrationPath(repositoryPath);
  const target = resolve(root, path);
  const directory = dirname(target);
  assertPrivateUsfDirectorySync(root, relative(root, directory).split(sep).join("/"), true);
  const bytes = `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`;
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.publish`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const written = await handle.stat();
    if (!written.isFile() || written.uid !== processUid(written.uid) || written.nlink !== 1 || (written.mode & 0o777) !== 0o600
      || written.size !== Buffer.byteLength(bytes)) throw new IntegrationError(mismatchReason);
    await handle.close();
    handle = null;
    try { await link(temporary, target); }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new IntegrationError(mismatchReason);
      const existing = readPrivateIntegrationFile(root, path);
      if (existing !== bytes) throw new IntegrationError(mismatchReason);
      return;
    }
    await rm(temporary);
    const directoryHandle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    if (readPrivateIntegrationFile(root, path) !== bytes) throw new IntegrationError(mismatchReason);
  } finally {
    if (handle !== null) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function intentDraft(intent: PreparedIntent): Omit<PreparedIntent, "intentDigest"> {
  const { intentDigest: _ignored, ...draft } = intent;
  return draft;
}

function intentPathFor(candidateDigests: readonly string[]): { locatorSetDigest: string; path: string } {
  const locatorSetDigest = canonicalDigest(candidateDigests);
  return { locatorSetDigest, path: `.usf/receipts/integration/intents/${locatorSetDigest.slice("sha256:".length)}.json` };
}

async function persistIntent(root: string, draft: Omit<PreparedIntent, "intentDigest">): Promise<PreparedIntent> {
  const intent = deepFreeze({ ...draft, intentDigest: canonicalDigest(draft) });
  await atomicCanonicalWrite(root, draft.prepared.intentPath, intent);
  return intent;
}

function markerPathFor(prepared: PreparedCandidateIntegration): string {
  return `.usf/receipts/integration/markers/${prepared.request.requestDigest.slice("sha256:".length)}.json`;
}

function markerDraft(prepared: PreparedCandidateIntegration): Omit<PrimaryAdvancedMarker, "markerDigest"> {
  return {
    schema: "urn:usf:primary-advanced-marker:1",
    requestDigest: prepared.request.requestDigest,
    scopedIntegrationAuthorityDependencyDigest: prepared.request.scopedIntegrationAuthorityDependencyDigest,
    startingCarrierCommit: prepared.request.startingCarrierCommit,
    preparedCarrierCommit: prepared.preparedCarrierCommit,
    preparedCarrierTree: prepared.preparedCarrierTree,
    primaryMutationLockIdentity,
    state: "primary-advanced",
  };
}

function readPrimaryAdvancedMarker(root: string, prepared: PreparedCandidateIntegration): PrimaryAdvancedMarker | null {
  const path = markerPathFor(prepared);
  const absolute = resolve(root, path);
  if (!privateUsfDirectoryExistsSync(root, ".usf/receipts/integration/markers")) return null;
  if (!existsSync(absolute)) return null;
  let bytes: string;
  let marker: PrimaryAdvancedMarker;
  try {
    bytes = readPrivateIntegrationFile(root, path, 64 * 1024);
    marker = JSON.parse(bytes) as PrimaryAdvancedMarker;
  } catch { throw new IntegrationError("INTEGRATION_PRIMARY_MARKER_MISMATCH"); }
  const expectedDraft = markerDraft(prepared);
  const { markerDigest, ...observedDraft } = marker;
  if (Object.keys(marker).sort().join(",") !== "markerDigest,preparedCarrierCommit,preparedCarrierTree,primaryMutationLockIdentity,requestDigest,schema,scopedIntegrationAuthorityDependencyDigest,startingCarrierCommit,state"
    || canonicalJson(marker, { rejectAbsolutePaths: true }) + "\n" !== bytes
    || markerDigest !== canonicalDigest(expectedDraft)
    || canonicalJson(observedDraft) !== canonicalJson(expectedDraft)) {
    throw new IntegrationError("INTEGRATION_PRIMARY_MARKER_MISMATCH");
  }
  return marker;
}

async function persistPrimaryAdvancedMarker(root: string, prepared: PreparedCandidateIntegration): Promise<PrimaryAdvancedMarker> {
  const draft = markerDraft(prepared);
  const marker: PrimaryAdvancedMarker = deepFreeze({ ...draft, markerDigest: canonicalDigest(draft) });
  const existing = readPrimaryAdvancedMarker(root, prepared);
  if (existing !== null) return existing;
  await publishCanonicalImmutable(root, markerPathFor(prepared), marker, "INTEGRATION_PRIMARY_MARKER_MISMATCH");
  const observed = readPrimaryAdvancedMarker(root, prepared);
  if (observed === null || observed.markerDigest !== marker.markerDigest) throw new IntegrationError("INTEGRATION_PRIMARY_MARKER_MISMATCH");
  return observed;
}

function readIntent(root: string, candidateDigests: readonly string[]): PreparedIntent | null {
  const identity = intentPathFor(candidateDigests);
  const absolute = resolve(root, identity.path);
  if (!privateUsfDirectoryExistsSync(root, relative(root, dirname(absolute)).split(sep).join("/"))) return null;
  if (!existsSync(absolute)) return null;
  let value: PreparedIntent;
  let bytes: string;
  try {
    bytes = readPrivateIntegrationFile(root, identity.path);
    value = JSON.parse(bytes) as PreparedIntent;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
  }
  if (!value || value.schema !== "urn:usf:integration-intent:1" || value.locatorSetDigest !== identity.locatorSetDigest
    || !["prepared-commit", "primary-advanced", "quarantined"].includes(value.state)
    || Object.keys(value).sort().join(",") !== "intentDigest,locatorSetDigest,observationPath,prepared,schema,state"
    || value.prepared?.intentPath !== identity.path || value.intentDigest !== canonicalDigest(intentDraft(value))
    || bytes !== `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`) {
    throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
  }
  try {
    return deepFreeze({
      ...value,
      prepared: {
        ...value.prepared,
        originalConstructionBases: value.prepared.originalConstructionBases.map(parseRealisationBasis),
        independentlyDerivedPostimageBases: value.prepared.independentlyDerivedPostimageBases.map(parseRealisationBasis),
      },
    });
  } catch { throw new IntegrationError("INTEGRATION_INTENT_MISMATCH"); }
}

async function quarantineIntent(root: string, intent: PreparedIntent, reason: IntegrationReasonCode): Promise<void> {
  const quarantined = await persistIntent(root, { ...intentDraft(intent), state: "quarantined", observationPath: null });
  const path = `.usf/receipts/integration/quarantine/${intent.locatorSetDigest.slice("sha256:".length)}-${canonicalDigest(reason).slice("sha256:".length, 16)}.json`;
  await atomicCanonicalWrite(root, path, { ...quarantined, quarantineReason: reason });
}

export async function acquirePrimaryMutationLock(root: string): Promise<{ handle: Awaited<ReturnType<typeof open>>; waitMilliseconds: number }> {
  const started = performance.now();
  const locks = resolve(root, ".usf", "locks");
  assertPrivateUsfDirectorySync(root, ".usf", true);
  assertPrivateUsfDirectorySync(root, ".usf/locks", true);
  const lockPath = resolve(locks, "primary-mutation.lock");
  let created = false;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK, 0o600);
    created = true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new IntegrationError("INTEGRATION_LOCK_UNAVAILABLE");
    handle = await open(lockPath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
      .catch(() => { throw new IntegrationError("INTEGRATION_LOCK_UNAVAILABLE"); });
  }
  try {
    if (created) await handle.chmod(0o600);
    const opened = await handle.stat();
    const named = await lstat(lockPath);
    if (!opened.isFile() || named.isSymbolicLink() || !named.isFile() || opened.uid !== processUid(opened.uid)
      || opened.nlink !== 1 || named.nlink !== 1 || (opened.mode & 0o777) !== 0o600 || (named.mode & 0o777) !== 0o600
      || opened.dev !== named.dev || opened.ino !== named.ino || await realpath(lockPath) !== lockPath) {
      throw new IntegrationError("INTEGRATION_LOCK_UNAVAILABLE");
    }
    const code = await new Promise<number>((finish) => {
      const child = spawn("/usr/bin/flock", ["--nonblock", "--conflict-exit-code", "75", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] });
      child.once("error", () => finish(127));
      child.once("exit", (value) => finish(value ?? 127));
    });
    if (code === 75) throw new IntegrationError("INTEGRATION_LOCK_BUSY");
    if (code !== 0) throw new IntegrationError("INTEGRATION_LOCK_UNAVAILABLE");
    const held = await handle.stat();
    if (held.dev !== opened.dev || held.ino !== opened.ino || held.nlink !== 1 || (held.mode & 0o777) !== 0o600) {
      throw new IntegrationError("INTEGRATION_LOCK_UNAVAILABLE");
    }
    return { handle, waitMilliseconds: Math.max(0, performance.now() - started) };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function buildObservation(
  authority: ReturnType<typeof integrationAuthority>,
  prepared: PreparedCandidateIntegration,
  recoveryState: IntegrationObservation["recoveryState"],
  metrics: { wait: number; hold: number },
  refusalReason?: IntegrationReasonCode,
  observedCarrier?: { readonly commit: string; readonly tree: string },
): IntegrationObservation {
  const success = refusalReason === undefined;
  const outcome = success ? integrationSuccessOutcome : integrationRefusalOutcome;
  const observationMemberSet = [
    ...authority.observationBaseFields,
    ...(success ? authority.observationSuccessFields : authority.observationRefusalFields),
  ];
  const canonicalObservationMemberSet = bytewiseSorted(observationMemberSet);
  const execution: IntegrationValidationExecutionObservation = prepared.postimageValidationResults.length === 0
    ? notExecutedValidationObservation(authority)
    : {
      timedOut: prepared.postimageValidationResults.some((result) => result.timedOut),
      timeoutTerminationSignal: prepared.postimageValidationResults.find((result) => result.timeoutTerminationSignal !== "none")?.timeoutTerminationSignal ?? "none",
      outputResultDigest: canonicalDigest(prepared.postimageValidationResults.map((result) => result.outputResultDigest)),
    };
  const digestFields: Record<string, unknown> = {
    requestDigest: prepared.request.requestDigest,
    outcome,
    observationMemberSetDigest: canonicalDigest(canonicalObservationMemberSet),
    observationDigestMembershipResourceDigest: resourceDigest(authority.graph, integrationObservationMembershipIri),
    postimageValidationTimedOut: execution.timedOut,
    postimageValidationTimeoutTerminationSignal: execution.timeoutTerminationSignal,
    postimageValidationOutputResultDigest: execution.outputResultDigest,
    ...(success ? {
      workspaceIdentityDigest: prepared.workspaceIdentityDigest,
      primaryMutationLockIdentity,
      integratedTreeDigest: prepared.integratedTreeDigest,
      observedCarrierCommit: observedCarrier?.commit ?? prepared.preparedCarrierCommit,
      observedCarrierTree: observedCarrier?.tree ?? prepared.preparedCarrierTree,
      independentlyDerivedPostimageBasisDigest: prepared.independentlyDerivedPostimageBasisDigest,
      postimageValidationResultSetDigest: prepared.postimageValidationResultSetDigest,
    } : { refusalReason }),
  };
  const observationDigest = canonicalDigest(selectedFieldMap(digestFields, canonicalObservationMemberSet));
  return deepFreeze({
    schema: "urn:usf:integration-observation:1" as const,
    ...prepared.request,
    ...digestFields,
    observationDigest,
    cohortMembers: prepared.cohortMembers,
    checkedCandidateReceipts: prepared.checkedCandidateReceipts,
    originalConstructionBases: prepared.originalConstructionBases,
    ...(success ? {
      authoritativeGitDiff: prepared.authoritativeGitDiff,
      independentlyDerivedPostimageBases: prepared.independentlyDerivedPostimageBases,
      postimageValidationResults: prepared.postimageValidationResults,
    } : {}),
    lockWaitMilliseconds: Math.round(metrics.wait * 1000) / 1000,
    lockHoldMilliseconds: Math.round(metrics.hold * 1000) / 1000,
    rollbackState: success ? "not-required-fast-forward" as const : "forbidden-mismatch" as const,
    recoveryState,
    nonClaims: integrationNonClaims,
  }) as IntegrationObservation;
}

function buildPreparationRefusalObservation(
  authority: ReturnType<typeof integrationAuthority>,
  request: IntegrationRequest,
  cohort: readonly IntegrationCohortMember[],
  receipts: readonly CheckedCandidateReceipt[],
  bases: readonly RealisationBasis[],
  refusalReason: IntegrationReasonCode,
  execution?: IntegrationValidationExecutionObservation,
): IntegrationObservation {
  const fields = bytewiseSorted([...authority.observationBaseFields, ...authority.observationRefusalFields]);
  const factualExecution = execution ?? notExecutedValidationObservation(authority);
  const members: Record<string, unknown> = {
    requestDigest: request.requestDigest,
    outcome: integrationRefusalOutcome,
    observationMemberSetDigest: canonicalDigest(fields),
    observationDigestMembershipResourceDigest: resourceDigest(authority.graph, integrationObservationMembershipIri),
    postimageValidationTimedOut: factualExecution.timedOut,
    postimageValidationTimeoutTerminationSignal: factualExecution.timeoutTerminationSignal,
    postimageValidationOutputResultDigest: factualExecution.outputResultDigest,
    refusalReason,
  };
  return deepFreeze({
    schema: "urn:usf:integration-observation:1" as const,
    ...request,
    ...members,
    observationDigest: canonicalDigest(selectedFieldMap(members, fields)),
    cohortMembers: cohort,
    checkedCandidateReceipts: receipts,
    originalConstructionBases: bases,
    lockWaitMilliseconds: 0,
    lockHoldMilliseconds: 0,
    rollbackState: "not-required-no-effect" as const,
    recoveryState: "quarantined" as const,
    nonClaims: integrationNonClaims,
  }) as IntegrationObservation;
}

function notExecutedValidationObservation(authority: ReturnType<typeof integrationAuthority>): IntegrationValidationExecutionObservation {
  return {
    timedOut: false,
    timeoutTerminationSignal: "none",
    outputResultDigest: canonicalDigest({
      state: "not-executed",
      executionAuthorityResourceDigest: authority.binding.algorithmResourceDigest,
      wallTimeMilliseconds: authority.binding.postimageValidationWallTimeMilliseconds,
      terminationGraceMilliseconds: authority.binding.validationTerminationGraceMilliseconds,
      timedOut: false,
      timeoutTerminationSignal: "none",
    }),
  };
}

function assertRequestAuthorityCurrent(authority: ReturnType<typeof integrationAuthority>, request: IntegrationRequest): void {
  for (const [field, value] of Object.entries(authority.binding)) {
    if ((request as unknown as Record<string, unknown>)[field] !== value) throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID");
  }
  if (request.requestDigestMembershipResourceDigest !== resourceDigest(authority.graph, integrationRequestMembershipIri)
    || request.requestMemberSetDigest !== canonicalDigest(authority.requestFields)
    || request.requestDigest !== canonicalDigest(selectedFieldMap(request as unknown as Record<string, unknown>, authority.requestFields))) {
    throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID");
  }
}

async function readIntegrationObservation(
  root: string,
  repositoryPath: string,
  authority: ReturnType<typeof integrationAuthority>,
  prepared: PreparedCandidateIntegration,
): Promise<IntegrationObservation> {
  if (!/^\.usf\/receipts\/integration\/[a-f0-9]{64}\.json$/u.test(repositoryPath)) throw new IntegrationError("INTEGRATION_RECOVERY_QUARANTINED");
  let bytes: string;
  try { bytes = readPrivateIntegrationFile(root, repositoryPath); }
  catch { throw new IntegrationError("INTEGRATION_RECOVERY_QUARANTINED"); }
  let observation: IntegrationObservation;
  try { observation = JSON.parse(bytes) as IntegrationObservation; } catch { throw new IntegrationError("INTEGRATION_RECOVERY_QUARANTINED"); }
  const fields = bytewiseSorted([...authority.observationBaseFields, ...authority.observationSuccessFields]);
  const expectedKeys = bytewiseSorted([
    ...Object.keys(prepared.request), "schema", "observationDigest", "observationMemberSetDigest",
    "observationDigestMembershipResourceDigest", "outcome", "postimageValidationTimedOut",
    "postimageValidationTimeoutTerminationSignal", "postimageValidationOutputResultDigest", "workspaceIdentityDigest",
    "primaryMutationLockIdentity", "integratedTreeDigest", "observedCarrierCommit", "observedCarrierTree",
    "independentlyDerivedPostimageBasisDigest", "postimageValidationResultSetDigest", "cohortMembers",
    "checkedCandidateReceipts", "originalConstructionBases", "authoritativeGitDiff", "independentlyDerivedPostimageBases",
    "postimageValidationResults", "lockWaitMilliseconds", "lockHoldMilliseconds", "rollbackState", "recoveryState", "nonClaims",
  ]);
  const exactMetric = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0
    && Math.round(value * 1000) / 1000 === value;
  const requestMatches = Object.entries(prepared.request).every(([field, value]) => canonicalJson(
    (observation as unknown as Record<string, unknown>)[field],
  ) === canonicalJson(value));
  const payloadMatches = canonicalJson(observation.cohortMembers) === canonicalJson(prepared.cohortMembers)
    && canonicalJson(observation.checkedCandidateReceipts) === canonicalJson(prepared.checkedCandidateReceipts)
    && canonicalJson(observation.originalConstructionBases) === canonicalJson(prepared.originalConstructionBases)
    && canonicalJson(observation.authoritativeGitDiff) === canonicalJson(prepared.authoritativeGitDiff)
    && canonicalJson(observation.independentlyDerivedPostimageBases) === canonicalJson(prepared.independentlyDerivedPostimageBases)
    && canonicalJson(observation.postimageValidationResults) === canonicalJson(prepared.postimageValidationResults)
    && canonicalJson(observation.nonClaims) === canonicalJson(integrationNonClaims);
  let observedCarrierValid = false;
  if (/^[0-9a-f]{40,64}$/u.test(observation.observedCarrierCommit ?? "") && /^[0-9a-f]{40,64}$/u.test(observation.observedCarrierTree ?? "")) {
    try {
      observedCarrierValid = commitIsAncestor(root, prepared.preparedCarrierCommit, observation.observedCarrierCommit!)
        && gitTree(root, observation.observedCarrierCommit!) === observation.observedCarrierTree;
    } catch { observedCarrierValid = false; }
  }
  if (bytes !== `${canonicalJson(observation, { rejectAbsolutePaths: true })}\n`
    || canonicalJson(bytewiseSorted(Object.keys(observation))) !== canonicalJson(expectedKeys)
    || observation.schema !== "urn:usf:integration-observation:1" || observation.outcome !== integrationSuccessOutcome
    || !requestMatches || !payloadMatches || !observedCarrierValid
    || observation.workspaceIdentityDigest !== prepared.workspaceIdentityDigest
    || observation.primaryMutationLockIdentity !== primaryMutationLockIdentity
    || observation.integratedTreeDigest !== prepared.integratedTreeDigest
    || observation.independentlyDerivedPostimageBasisDigest !== prepared.independentlyDerivedPostimageBasisDigest
    || observation.postimageValidationResultSetDigest !== prepared.postimageValidationResultSetDigest
    || !exactMetric(observation.lockWaitMilliseconds) || !exactMetric(observation.lockHoldMilliseconds)
    || observation.rollbackState !== "not-required-fast-forward"
    || !["new-advancement", "exact-primary-advancement"].includes(observation.recoveryState)
    || observation.observationMemberSetDigest !== canonicalDigest(fields)
    || observation.observationDigestMembershipResourceDigest !== resourceDigest(authority.graph, integrationObservationMembershipIri)
    || observation.observationDigest !== canonicalDigest(selectedFieldMap(observation as unknown as Record<string, unknown>, fields))) {
    throw new IntegrationError("INTEGRATION_RECOVERY_QUARANTINED");
  }
  return observation;
}

async function persistObservation(root: string, observation: IntegrationObservation): Promise<string> {
  const path = `.usf/receipts/integration/${observation.observationDigest.slice("sha256:".length)}.json`;
  await publishCanonicalImmutable(root, path, observation, "INTEGRATION_RECOVERY_QUARANTINED");
  return path;
}

async function assertPreparedCurrent(root: string, prepared: PreparedCandidateIntegration): Promise<void> {
  if (gitHead(root) !== prepared.request.startingCarrierCommit || gitTree(root, "HEAD") !== prepared.request.startingCarrierTree) {
    throw new IntegrationError("INTEGRATION_PRIMARY_MOVED");
  }
  const paths = prepared.authoritativeGitDiff.map((effect) => effect.path);
  assertTouchedPrimaryClean(root, paths);
  assertNoFilterAttributes(root, paths);
  for (const effect of prepared.authoritativeGitDiff) {
    const bytes = bytesAtIntegrationPath(root, effect.path);
    const mode = fileModeAt(root, effect.path);
    if ((bytes === null ? null : sha256(bytes)) !== effect.beforeDigest || mode !== effect.beforeMode) {
      throw new IntegrationError("INTEGRATION_STALE_PREIMAGE");
    }
  }
  for (const original of prepared.originalConstructionBases) {
    let current: RealisationBasis;
    try { current = await deriveCurrentRealisationBasis(root, original); }
    catch (error) { throw new IntegrationError("INTEGRATION_STALE_PREIMAGE", `Construction basis is no longer current: ${original.work.id}:${(error as Error).message}`); }
    if (current.basisDigest !== original.basisDigest) throw new IntegrationError("INTEGRATION_STALE_PREIMAGE");
  }
}

function commitIsAncestor(root: string, ancestor: string, descendant: string): boolean {
  try { return gitText(root, "merge-base", [ancestor, descendant]) === ancestor; }
  catch { return false; }
}

async function assertPrimaryPostimageCurrent(root: string, prepared: PreparedCandidateIntegration): Promise<{ commit: string; tree: string }> {
  const current = gitHead(root);
  if (!commitIsAncestor(root, prepared.preparedCarrierCommit, current)) throw new IntegrationError("INTEGRATION_POSTIMAGE_MOVED");
  if (gitTree(root, prepared.preparedCarrierCommit) !== prepared.preparedCarrierTree) throw new IntegrationError("INTEGRATION_POSTIMAGE_MOVED");
  const paths = prepared.authoritativeGitDiff.map((effect) => effect.path);
  assertTouchedPrimaryClean(root, paths);
  assertNoFilterAttributes(root, paths);
  if (git(root, "diff", ["--cached", "--name-only", "-z", "HEAD", "--", ...paths]).byteLength !== 0
    || git(root, "diff", ["--name-only", "-z", "HEAD", "--", ...paths]).byteLength !== 0) {
    throw new IntegrationError("INTEGRATION_POSTIMAGE_MOVED");
  }
  for (const effect of prepared.authoritativeGitDiff) {
    const bytes = bytesAtIntegrationPath(root, effect.path);
    const mode = fileModeAt(root, effect.path);
    if ((bytes === null ? null : sha256(bytes)) !== effect.afterDigest || mode !== effect.afterMode) {
      throw new IntegrationError("INTEGRATION_POSTIMAGE_MOVED");
    }
  }
  const rederived = prepared.independentlyDerivedPostimageBases.map((basis) => deriveBasisAt(root, basis, "INTEGRATION_POSTIMAGE_MOVED"));
  if (canonicalJson(rederived) !== canonicalJson(prepared.independentlyDerivedPostimageBases)
    || canonicalDigest(rederived.map((basis) => ({ workIri: basis.work.id, basisDigest: basis.basisDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest })))
      !== prepared.independentlyDerivedPostimageBasisDigest) {
    throw new IntegrationError("INTEGRATION_POSTIMAGE_MOVED", "Primary scoped postimage basis is no longer current");
  }
  return { commit: current, tree: gitTree(root, current) };
}

interface PrimaryDryRunSnapshot {
  readonly head: string;
  readonly tree: string;
  readonly branch: string | null;
  readonly index: string;
  readonly touchedStatus: string;
  readonly touchedState: readonly Readonly<{ path: string; mode: GitFileMode | null; bytes: string | null }>[];
}

function primaryDryRunSnapshot(root: string, paths: readonly string[]): PrimaryDryRunSnapshot {
  const branchResult = gitResult(root, "symbolic-ref", ["-q", "HEAD"]);
  if (branchResult.status !== 0 && branchResult.status !== 1) throw new IntegrationError("INTEGRATION_GIT_FAILED");
  return {
    head: gitHead(root),
    tree: gitTree(root, "HEAD"),
    branch: branchResult.status === 0 ? branchResult.stdout.toString("utf8").trim() : null,
    index: git(root, "ls-files", ["--stage", "-z"]).toString("base64"),
    touchedStatus: git(root, "status", ["--porcelain=v1", "-z", "--untracked-files=all", "--", ...paths]).toString("base64"),
    touchedState: paths.map((path) => ({
      path,
      mode: fileModeAt(root, path),
      bytes: bytesAtIntegrationPath(root, path)?.toString("base64") ?? null,
    })),
  };
}

function assertPrimaryDryRunUnchanged(root: string, paths: readonly string[], before: PrimaryDryRunSnapshot): void {
  const after = primaryDryRunSnapshot(root, paths);
  if (canonicalJson(after) !== canonicalJson(before)) {
    throw new IntegrationError("INTEGRATION_DRY_RUN_PRIMARY_MUTATED", "Preparation changed primary HEAD, branch, tree, index, status, modes, or touched bytes");
  }
}

function deriveBasisAt(root: string, original: RealisationBasis, reason: IntegrationReasonCode): RealisationBasis {
  const result = deriveWork(loadSemanticGraph(root, original.selection.manifestPath), {
    profile: original.selection.profile,
    selector: original.work.id,
    maxItems: 1,
  });
  const basis = result.status === "ok" ? result.items?.[0]?.realisationBasis : undefined;
  if (basis === undefined) throw new IntegrationError(reason);
  try { assertRealisationBasis(basis); } catch { throw new IntegrationError(reason); }
  return basis;
}

/**
 * Dry-run preparation. It authenticates and validates outside the primary
 * mutation lock, creates a deterministic local commit in a disposable
 * worktree, and leaves only an owner-private ignored intent and local ref.
 */
export async function prepareCandidateIntegration(root: string, options: CandidateIntegrationOptions): Promise<PreparedCandidateIntegration> {
  const canonicalRoot = realpathSync(root);
  assertGitRoot(canonicalRoot);
  if (!Array.isArray(options.candidateDigests) || options.candidateDigests.length < 1 || options.candidateDigests.length > 32
    || options.candidateDigests.some((entry) => !digestPattern.test(entry))) throw new IntegrationError("INTEGRATION_CANDIDATE_COUNT_INVALID");
  if (new Set(options.candidateDigests).size !== options.candidateDigests.length) throw new IntegrationError("INTEGRATION_DUPLICATE_CANDIDATE");
  const startingCarrierCommit = gitHead(canonicalRoot);
  const startingCarrierTree = gitTree(canonicalRoot, startingCarrierCommit);
  const { authenticateCandidateWorkspace } = await import("./index.ts");
  const authenticated = await Promise.all(options.candidateDigests.map((candidateDigest) => authenticateCandidateWorkspace(canonicalRoot, candidateDigest)));
  if (authenticated.some((candidate) => candidate.actualOperationDelta.length === 0
    || candidate.actualOperationDelta.every((delta) => delta.beforeDigest === delta.afterDigest && delta.beforeMode === delta.afterMode))) {
    throw new IntegrationError("INTEGRATION_EMPTY_DELTA");
  }
  const profiles = [...new Set(authenticated.map((candidate) => candidate.constructionBasis.selection.profile))];
  const manifests = [...new Set(authenticated.map((candidate) => candidate.constructionBasis.selection.manifestPath))];
  if (profiles.length !== 1 || manifests.length !== 1) throw new IntegrationError("INTEGRATION_PROFILE_MISMATCH");
  const authority = integrationAuthority(canonicalRoot, profiles[0]!);
  const receipts = await Promise.all(authenticated.map((candidate) => authenticatedCheckedReceipt(
    canonicalRoot,
    candidate,
    authority.binding.checkedCandidateSchemaDigest,
  )));
  if (new Set(receipts.map((receipt) => receipt.receiptDigest)).size !== receipts.length) throw new IntegrationError("INTEGRATION_DUPLICATE_RECEIPT");
  if (new Set(receipts.map((receipt) => receipt.workIri)).size !== receipts.length) throw new IntegrationError("INTEGRATION_DUPLICATE_WORK");
  const workGraph = loadSemanticGraph(canonicalRoot, manifests[0]!);
  const inputRecords = authenticated.map((candidate, index) => ({ authenticated: candidate, receipt: receipts[index]! }));
  const orderedRecords = canonicalCohortOrder(workGraph, inputRecords);
  if (orderedRecords.some((record, index) => record.authenticated.candidateDigest !== options.candidateDigests[index])) {
    throw new IntegrationError("INTEGRATION_CALLER_ORDER_INVALID");
  }
  const touched = new Set<string>();
  for (const record of orderedRecords) for (const path of record.authenticated.writeSet) {
    if (touched.has(path)) throw new IntegrationError("INTEGRATION_OVERLAPPING_WRITE_SET");
    touched.add(path);
  }
  const touchedPaths = bytewiseSorted([...touched]);
  if (touchedPaths.some((path) => path === ".gitattributes" || path.endsWith("/.gitattributes"))) {
    throw new IntegrationError("INTEGRATION_FILTER_ATTRIBUTE", "Candidate-controlled Git attributes are not merge authority");
  }
  if (touched.has(integrationManifestIdentity) || touched.has("graph/integration.nq")) {
    throw new IntegrationError("INTEGRATION_AUTHORITY_INVALID", "Ordinary integration cannot replace its own selected authority");
  }
  const members = cohortMembers(orderedRecords);
  const checkedCandidateSetDigest = canonicalDigest(bytewiseSorted(orderedRecords.map((record) => record.receipt.receiptDigest)));
  const requestMemberSetDigest = canonicalDigest(authority.requestFields);
  const requestDraft: Record<string, unknown> = {
    ...authority.binding,
    candidateCount: members.length,
    orderedCandidateSetDigest: canonicalDigest(orderedRecords.map((record) => record.authenticated.candidateDigest)),
    checkedCandidateSetDigest,
    cohortMemberSetDigest: canonicalDigest(members),
    startingCarrierCommit,
    startingCarrierTree,
    requestMemberSetDigest,
    requestDigestMembershipResourceDigest: resourceDigest(authority.graph, integrationRequestMembershipIri),
  };
  const request: IntegrationRequest = deepFreeze({
    ...requestDraft,
    requestDigest: canonicalDigest(selectedFieldMap(requestDraft, authority.requestFields)),
  }) as unknown as IntegrationRequest;
  const intentIdentity = intentPathFor(options.candidateDigests);
  const worktreesRoot = resolve(canonicalRoot, ".usf", "integration-worktrees");
  const worktree = resolve(worktreesRoot, request.requestDigest.slice("sha256:".length));
  const primarySnapshot = primaryDryRunSnapshot(canonicalRoot, touchedPaths);
  let prepared: PreparedCandidateIntegration | undefined;
  try {
    assertTouchedPrimaryClean(canonicalRoot, touchedPaths);
    const trackedPaths = nulFields(git(canonicalRoot, "ls-files", ["-z"]));
    assertNoFilterAttributes(canonicalRoot, trackedPaths);
    for (const path of touchedPaths) fileModeAt(canonicalRoot, path);
    assertPrivateUsfDirectorySync(canonicalRoot, ".usf", true);
    assertPrivateUsfDirectorySync(canonicalRoot, ".usf/integration-worktrees", true);
    if (privateUsfDirectoryExistsSync(canonicalRoot, relative(canonicalRoot, worktree).split(sep).join("/"))) {
      assertPrivateWorktreeRootSync(canonicalRoot, worktree);
      await rm(worktree, { recursive: true, force: true });
    }
    git(canonicalRoot, "worktree", ["add", "--detach", worktree, startingCarrierCommit]);
    chmodSyncCompat(worktree, 0o700);
    assertPrivateWorktreeRootSync(canonicalRoot, worktree);
    if (realpathSync(gitText(worktree, "rev-parse", ["--show-toplevel"])) !== realpathSync(worktree)) throw new IntegrationError("INTEGRATION_GIT_FAILED");
    git(worktree, "worktree", ["list", "--porcelain"]);
    for (const record of orderedRecords) {
      const detachedBasis = deriveBasisAt(worktree, record.authenticated.constructionBasis, "INTEGRATION_DETACHED_BASIS_MISMATCH");
      if (canonicalJson(detachedBasis) !== canonicalJson(record.authenticated.constructionBasis)) {
        throw new IntegrationError("INTEGRATION_DETACHED_BASIS_MISMATCH", "Candidate construction basis is not represented by the detached starting carrier");
      }
    }
    for (const record of orderedRecords) for (const delta of record.authenticated.actualOperationDelta) {
      const currentBytes = bytesAtIntegrationPath(worktree, delta.path);
      const currentMode = fileModeAt(worktree, delta.path);
      if ((currentBytes === null ? null : sha256(currentBytes)) !== delta.beforeDigest || currentMode !== delta.beforeMode) {
        throw new IntegrationError("INTEGRATION_STALE_PREIMAGE");
      }
      writeIntegrationPath(worktree, delta.path, delta.after === null ? null : Buffer.from(delta.after, "base64"), delta.afterMode);
    }
    git(worktree, "add", ["--all", "--", ...touchedPaths]);
    git(worktree, "diff", ["--cached", "--check", "--", ...touchedPaths]);
    const effects = parseRawGitDiff(worktree, startingCarrierCommit, touchedPaths);
    if (canonicalJson(effects.map((effect) => effect.path)) !== canonicalJson(touchedPaths)) throw new IntegrationError("INTEGRATION_UNDECLARED_EFFECT");
    for (const effect of effects) {
      const expected = orderedRecords.flatMap((record) => record.authenticated.actualOperationDelta).find((delta) => delta.path === effect.path);
      if (!expected || expected.beforeDigest !== effect.beforeDigest || expected.afterDigest !== effect.afterDigest
        || expected.beforeMode !== effect.beforeMode || expected.afterMode !== effect.afterMode) throw new IntegrationError("INTEGRATION_UNDECLARED_EFFECT");
    }
    const undeclared = nulFields(git(worktree, "diff", ["--cached", "--name-only", "-z", startingCarrierCommit]));
    if (canonicalJson(bytewiseSorted(undeclared)) !== canonicalJson(touchedPaths)) throw new IntegrationError("INTEGRATION_UNDECLARED_EFFECT");
    git(worktree, "commit", ["--no-verify", "--no-gpg-sign", "-m", `USF integration ${request.requestDigest}`]);
    const preparedCarrierCommit = gitHead(worktree);
    const preparedCarrierTree = gitTree(worktree, preparedCarrierCommit);
    const postimageBases = orderedRecords.map((record) => deriveBasisAt(worktree, record.authenticated.constructionBasis, "INTEGRATION_POSTIMAGE_BASIS_INVALID"));
    const postimageValidationResults = [];
    for (let index = 0; index < orderedRecords.length; index += 1) {
      const record = orderedRecords[index]!;
      const basis = postimageBases[index]!;
      const validation = validationAuthority(worktree, basis);
      const observation = await (options.verifier ?? runIntegrationValidation)({
        phase: "postimage",
        repositoryRoot: worktree,
        candidateDigest: record.authenticated.candidateDigest,
        workIri: basis.work.id,
        explicitProfileIri: basis.selection.profile,
        basis,
        authority: validation,
        expectedByteDeltaDigest: record.authenticated.byteDeltaDigest,
        expectedFileModeDigest: record.authenticated.fileModeDigest,
        expectedTreeDigest: canonicalDigest(effects),
      });
      const execution = assertVerifierObservation(observation, validation);
      postimageValidationResults.push({
        workIri: basis.work.id,
        basisDigest: basis.basisDigest,
        validationObligationIri: validation.obligationIri,
        validationCommandDigest: validation.commandDigest,
        validationEnvironmentDigest: validation.environmentDigest,
        validationExecutionModeDigest: validation.executionModeDigest,
        validationToolDependencyDigest: validation.toolDependencyDigest,
        validationSchemaDependencyDigest: validation.schemaDependencyDigest,
        validationResultSetDigest: canonicalDigest(observation.resultDigests),
        timedOut: false as const,
        timeoutTerminationSignal: "none" as const,
        outputResultDigest: execution.outputResultDigest,
      });
    }
    if (git(worktree, "status", ["--porcelain=v1", "-z", "--untracked-files=all"]).byteLength !== 0
      || gitHead(worktree) !== preparedCarrierCommit || gitTree(worktree, "HEAD") !== preparedCarrierTree
      || canonicalJson(parseRawGitDiff(worktree, startingCarrierCommit, touchedPaths, false)) !== canonicalJson(effects)) {
      throw new IntegrationError("INTEGRATION_UNDECLARED_EFFECT", "Postimage validation altered the prepared carrier");
    }
    const completedPreparation: PreparedCandidateIntegration = deepFreeze({
      schema: "urn:usf:prepared-candidate-integration:1" as const,
      request,
      checkedCandidateReceipts: orderedRecords.map((record) => record.receipt),
      cohortMembers: members,
      originalConstructionBases: orderedRecords.map((record) => record.authenticated.constructionBasis),
      authoritativeGitDiff: effects,
      workspaceIdentityDigest: canonicalDigest(orderedRecords.map((record) => record.authenticated.workspaceIdentityDigest)),
      integratedTreeDigest: canonicalDigest(effects),
      preparedCarrierCommit,
      preparedCarrierTree,
      independentlyDerivedPostimageBases: postimageBases,
      independentlyDerivedPostimageBasisDigest: canonicalDigest(postimageBases.map((basis) => ({ workIri: basis.work.id, basisDigest: basis.basisDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest }))),
      postimageValidationResults,
      postimageValidationResultSetDigest: canonicalDigest(postimageValidationResults),
      intentPath: intentIdentity.path,
      recoveryState: "prepared-commit" as const,
      nonClaims: integrationNonClaims,
    });
    prepared = completedPreparation;
    const localRef = `refs/usf/integration/${request.requestDigest.slice("sha256:".length)}`;
    git(canonicalRoot, "update-ref", ["--no-deref", localRef, completedPreparation.preparedCarrierCommit]);
    const symbolic = gitResult(canonicalRoot, "symbolic-ref", ["-q", localRef]);
    if (gitText(canonicalRoot, "rev-parse", ["--verify", localRef]) !== completedPreparation.preparedCarrierCommit || symbolic.status !== 1) {
      throw new IntegrationError("INTEGRATION_TEMP_REF_INVALID", "Prepared carrier ref is not an exact direct ref");
    }
    await persistIntent(canonicalRoot, {
      schema: "urn:usf:integration-intent:1",
      locatorSetDigest: intentIdentity.locatorSetDigest,
      state: "prepared-commit",
      prepared: completedPreparation,
      observationPath: null,
    });
    return completedPreparation;
  } catch (error) {
    if (error instanceof IntegrationError) {
      await persistObservation(canonicalRoot, buildPreparationRefusalObservation(
        authority,
        request,
        members,
        orderedRecords.map((record) => record.receipt),
        orderedRecords.map((record) => record.authenticated.constructionBasis),
        error.reasonCode,
        error.validationExecution,
      ));
    }
    throw error;
  } finally {
    if (privateUsfDirectoryExistsSync(canonicalRoot, relative(canonicalRoot, worktree).split(sep).join("/"))) {
      assertPrivateWorktreeRootSync(canonicalRoot, worktree);
      try { git(canonicalRoot, "worktree", ["remove", "--force", worktree]); } catch { /* Exact ignored root is re-authenticated before bounded cleanup. */ }
    }
    if (privateUsfDirectoryExistsSync(canonicalRoot, relative(canonicalRoot, worktree).split(sep).join("/"))) {
      assertPrivateWorktreeRootSync(canonicalRoot, worktree);
      await rm(worktree, { recursive: true, force: true });
    }
    assertPrimaryDryRunUnchanged(canonicalRoot, touchedPaths, primarySnapshot);
  }
}

/** Fast-forward the prepared local carrier under the one narrow mutation lock. */
export async function integrateCandidates(root: string, options: CandidateIntegrationOptions): Promise<IntegrationObservation> {
  const canonicalRoot = realpathSync(root);
  assertGitRoot(canonicalRoot);
  let existing = readIntent(canonicalRoot, options.candidateDigests);
  if (existing?.state === "quarantined") throw new IntegrationError("INTEGRATION_RECOVERY_QUARANTINED");
  if (existing?.state === "primary-advanced" || (existing?.state === "prepared-commit"
    && commitIsAncestor(canonicalRoot, existing.prepared.preparedCarrierCommit, gitHead(canonicalRoot)))) {
    const authority = integrationAuthority(canonicalRoot, existing.prepared.request.explicitProfileIri);
    assertRequestAuthorityCurrent(authority, existing.prepared.request);
    let observed = await assertPrimaryPostimageCurrent(canonicalRoot, existing.prepared);
    if (readPrimaryAdvancedMarker(canonicalRoot, existing.prepared) === null) {
      const recoveryLock = await acquirePrimaryMutationLock(canonicalRoot);
      try {
        observed = await assertPrimaryPostimageCurrent(canonicalRoot, existing.prepared);
        await persistPrimaryAdvancedMarker(canonicalRoot, existing.prepared);
      } finally { await recoveryLock.handle.close(); }
    }
    if (existing.observationPath !== null) {
      return readIntegrationObservation(canonicalRoot, existing.observationPath, authority, existing.prepared);
    }
    const observation = buildObservation(authority, existing.prepared, "exact-primary-advancement", { wait: 0, hold: 0 }, undefined, observed);
    const observationPath = await persistObservation(canonicalRoot, observation);
    await persistIntent(canonicalRoot, { ...intentDraft(existing), state: "primary-advanced", observationPath });
    return observation;
  }
  let prepared: PreparedCandidateIntegration;
  if (existing?.state === "prepared-commit") {
    const current = gitHead(canonicalRoot);
    if (current === existing.prepared.request.startingCarrierCommit
      && gitTree(canonicalRoot, existing.prepared.preparedCarrierCommit) === existing.prepared.preparedCarrierTree) prepared = existing.prepared;
    else {
      prepared = await prepareCandidateIntegration(canonicalRoot, options);
      existing = readIntent(canonicalRoot, options.candidateDigests);
    }
  } else {
    prepared = await prepareCandidateIntegration(canonicalRoot, options);
    existing = readIntent(canonicalRoot, options.candidateDigests);
  }
  const authority = integrationAuthority(canonicalRoot, prepared.request.explicitProfileIri);
  assertRequestAuthorityCurrent(authority, prepared.request);
  const lock = await acquirePrimaryMutationLock(canonicalRoot);
  const heldAt = performance.now();
  let failure: unknown;
  let hold = 0;
  let observed: { commit: string; tree: string } | undefined;
  try {
    await assertPreparedCurrent(canonicalRoot, prepared);
    for (const basis of prepared.cohortMembers.map((member) => prepared.checkedCandidateReceipts.find((receipt) => receipt.candidateDigest === member.candidateDigest)!
      ).map((receipt) => prepared.independentlyDerivedPostimageBases.find((basis) => basis.work.id === receipt.workIri)!)) {
      if (basis === undefined) throw new IntegrationError("INTEGRATION_POSTIMAGE_BASIS_INVALID");
    }
    git(canonicalRoot, "merge", ["--ff-only", "--no-edit", prepared.preparedCarrierCommit]);
    if (gitHead(canonicalRoot) !== prepared.preparedCarrierCommit || gitTree(canonicalRoot, "HEAD") !== prepared.preparedCarrierTree) {
      throw new IntegrationError("INTEGRATION_PRIMARY_MOVED");
    }
    observed = await assertPrimaryPostimageCurrent(canonicalRoot, prepared);
    await persistPrimaryAdvancedMarker(canonicalRoot, prepared);
  } catch (error) {
    failure = error;
  } finally {
    hold = performance.now() - heldAt;
    await lock.handle.close();
  }
  if (failure !== undefined) {
    try {
      observed = await assertPrimaryPostimageCurrent(canonicalRoot, prepared);
      const recoveryLock = await acquirePrimaryMutationLock(canonicalRoot);
      try {
        observed = await assertPrimaryPostimageCurrent(canonicalRoot, prepared);
        await persistPrimaryAdvancedMarker(canonicalRoot, prepared);
      } finally { await recoveryLock.handle.close(); }
      const recovered = buildObservation(authority, prepared, "exact-primary-advancement", { wait: lock.waitMilliseconds, hold }, undefined, observed);
      const observationPath = await persistObservation(canonicalRoot, recovered);
      const currentIntent = readIntent(canonicalRoot, options.candidateDigests);
      if (currentIntent === null) throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
      await persistIntent(canonicalRoot, { ...intentDraft(currentIntent), state: "primary-advanced", observationPath });
      return recovered;
    } catch (recoveryError) {
      if (recoveryError instanceof IntegrationError && recoveryError.reasonCode === "INTEGRATION_POSTIMAGE_MOVED") throw recoveryError;
    }
    if (failure instanceof IntegrationError) {
      const refusal = buildObservation(authority, prepared, "quarantined", { wait: lock.waitMilliseconds, hold }, failure.reasonCode);
      await persistObservation(canonicalRoot, refusal);
    }
    throw failure;
  }
  if (observed === undefined) throw new IntegrationError("INTEGRATION_POSTIMAGE_MOVED");
  const advancedIntent = readIntent(canonicalRoot, options.candidateDigests);
  if (advancedIntent === null) throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
  await persistIntent(canonicalRoot, { ...intentDraft(advancedIntent), state: "primary-advanced", observationPath: null });
  observed = await assertPrimaryPostimageCurrent(canonicalRoot, prepared);
  const observation = buildObservation(authority, prepared, "new-advancement", { wait: lock.waitMilliseconds, hold }, undefined, observed);
  const observationPath = await persistObservation(canonicalRoot, observation);
  const currentIntent = readIntent(canonicalRoot, options.candidateDigests);
  if (currentIntent === null || currentIntent.state !== "primary-advanced") throw new IntegrationError("INTEGRATION_INTENT_MISMATCH");
  await persistIntent(canonicalRoot, { ...intentDraft(currentIntent), observationPath });
  return observation;
}
