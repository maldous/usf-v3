import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { exitCodes, type ExitCode, UsfError } from "../core/errors.ts";
import { loadSemanticGraph, objectValues, objectsFor, type SemanticGraph } from "../graph/index.ts";
import { canonicalQuadLine } from "../graph/nquads.ts";
import { deriveVerifiedTransitionPostBases, deriveWork, type WorkPacket } from "../graph/work.ts";
import { assertRealisationBasis, type RealisationBasis } from "../realisation/basis.ts";
import {
  applyTransitionOperations,
  assertTransitionPostBasisCurrentness,
  assertVerifiedTransitionReceipt,
  createAggregateAdmission,
  createTransitionStateFromBases,
  createVerifiedTransitionCandidateCurrentness,
  createVerifiedTransitionReceipt,
  parseTransitionQuad,
  reverseTransitionOperations,
  transitionDeltaDigest,
  transitionMemberFromBasis,
  type AggregateAdmission,
  type TransitionEvidenceRef,
  type TransitionOperation,
  type TransitionProofRef,
  type TransitionState,
  type TransitionValidationRef,
  type VerifiedTransitionReceipt,
} from "../realisation/transition.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { confinedNodeTestLaunch } from "./check.ts";

const bootstrapException = "urn:usf:exception:semantic-first-bootstrap:1";
const evidenceType = "urn:usf:type:Evidence";
const proofResultType = "urn:usf:type:ProofResult";
const typePredicate = "urn:usf:predicate:type";
const graphPredicate = (name: string): string => `urn:usf:predicate:${name}`;
const exactEvidenceByWork = Object.freeze({
  "urn:usf:work:semantic-first-eligibility": "urn:usf:evidence:semantic-first-eligibility:bootstrap",
  "urn:usf:work:realisation-basis-chain": "urn:usf:evidence:realisation-basis-chain:bootstrap",
  "urn:usf:work:semantic-first-lifecycle-admission": "urn:usf:evidence:semantic-first-lifecycle-admission:bootstrap",
} as const);
const exactWorkOrder = Object.freeze([
  "urn:usf:work:semantic-first-eligibility",
  "urn:usf:work:realisation-basis-chain",
  "urn:usf:work:semantic-first-lifecycle-admission",
] as const);
const expectedAdmissionPredicates = Object.freeze([
  "urn:usf:predicate:activationState",
  "urn:usf:predicate:algorithm",
  "urn:usf:predicate:contentDigest",
  "urn:usf:predicate:evidenceDigest",
  "urn:usf:predicate:forWork",
  "urn:usf:predicate:forObligation",
  "urn:usf:predicate:outcome",
  "urn:usf:predicate:realisationBasisDigest",
  "urn:usf:predicate:satisfiesEvidenceRequirement",
  "urn:usf:predicate:scopedDependencyDigest",
  "urn:usf:predicate:state",
  "urn:usf:predicate:type",
  "urn:usf:predicate:validationResultDigest",
  "urn:usf:predicate:admissionSetDigest",
] as const);

export interface PublishBootstrapTransitionRequest {
  readonly operation: "bootstrap-transition";
  readonly profile: string;
  readonly manifestPath: string;
  readonly receiptPath: string;
  readonly mode: "verify" | "apply";
}

interface BootstrapAuthority {
  readonly graph: string;
  readonly sourcePath: string;
  readonly receiptPath: string;
  readonly receiptSchemaPath: string;
  readonly authorityProfile: string;
  readonly authorityManifestPath: string;
  readonly algorithm: "urn:usf:algorithm:verified-transition-receipt:1";
  readonly transition: string;
  readonly preState: string;
  readonly postState: string;
  readonly admissionSet: string;
  readonly works: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly proofId: string;
  readonly resources: readonly string[];
  readonly validations: readonly string[];
  readonly proofObligation: string;
  readonly proofAlgorithm: string;
  readonly permission: string;
  readonly currentness: string;
  readonly permissionBefore: string;
  readonly permissionAfter: string;
  readonly exceptionBefore: string;
  readonly exceptionAfter: string;
}

interface DerivedMember {
  readonly packet: WorkPacket;
  readonly basis: RealisationBasis;
}

interface ShadowRepository { readonly root: string; readonly container: string; }
interface PreparedContainedParent { readonly absolute: string; readonly createdDirectories: readonly string[]; }

export interface PublishRecoveryJournal {
  readonly schema: "urn:usf:publish-recovery-journal:1";
  readonly status: "prepared";
  readonly profile: string;
  readonly manifestPath: string;
  readonly sourcePath: string;
  readonly receiptPath: string;
  readonly sourceBefore: string;
  readonly sourceBeforeDigest: string;
  readonly sourceAfter: string;
  readonly sourceAfterDigest: string;
  readonly receiptBytes: string;
  readonly receiptBytesDigest: string;
  readonly transactionDigest: string;
}

const recoveryJournalPath = ".usf/transactions/bootstrap-transition.json";

function refuse(code: string, message: string, exitCode: ExitCode = exitCodes.CURRENTNESS_FAILURE): never {
  throw new UsfError(code, exitCode, message);
}

function repositoryPath(value: string, reason: string): string {
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(value) || value.includes("\0") || value.includes("\\") || isAbsolute(value)
    || value.split("/").some((part) => part.length === 0 || part === "." || part === "..")) refuse(reason, "A repository-relative contained path is required.", exitCodes.CONTAINMENT_REFUSAL);
  return value;
}

function exactContainedPath(root: string, path: string, mustExist: boolean): string {
  const repositoryRelative = repositoryPath(path, "PUBLISH_PATH_INVALID");
  const absolute = resolve(root, repositoryRelative);
  const relation = relative(root, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("PUBLISH_PATH_ESCAPE", "The selected path escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  let cursor = root;
  const segments = repositoryRelative.split("/");
  for (let index = 0; index < segments.length - 1; index += 1) {
    cursor = resolve(cursor, segments[index] as string);
    if (!existsSync(cursor)) {
      if (mustExist) refuse("PUBLISH_PATH_UNREADABLE", "A required transition path ancestor is missing.", exitCodes.CONTAINMENT_REFUSAL);
      continue;
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink()) refuse("PUBLISH_PATH_SYMLINK_REFUSED", "Symlinked transition paths are not permitted.", exitCodes.CONTAINMENT_REFUSAL);
    if (!entry.isDirectory()) refuse("PUBLISH_PATH_PARENT_NOT_DIRECTORY", "Every transition path ancestor must be a real directory.", exitCodes.CONTAINMENT_REFUSAL);
    const resolved = realpathSync(cursor);
    const resolvedRelation = relative(realpathSync(root), resolved);
    if (resolvedRelation === ".." || resolvedRelation.startsWith(`..${sep}`) || isAbsolute(resolvedRelation)) refuse("PUBLISH_PATH_ESCAPE", "A transition path ancestor escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  }
  if (mustExist && (!existsSync(absolute) || !lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink())) refuse("PUBLISH_PATH_UNREADABLE", "A required regular file is missing.", exitCodes.CONTAINMENT_REFUSAL);
  if (!mustExist && existsSync(absolute) && (!lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink())) refuse("PUBLISH_PATH_SYMLINK_REFUSED", "The optional transition path must be a regular non-symlink file.", exitCodes.CONTAINMENT_REFUSAL);
  if (mustExist && relative(root, realpathSync(absolute)).startsWith("..")) refuse("PUBLISH_PATH_ESCAPE", "The selected path escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  return absolute;
}

function removeCreatedDirectories(directories: readonly string[]): void {
  for (const directory of [...directories].reverse()) {
    try {
      rmdirSync(directory);
      fsyncDirectory(dirname(directory));
    }
    catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
}

function prepareContainedParent(root: string, path: string): PreparedContainedParent {
  const repositoryRelative = repositoryPath(path, "PUBLISH_PATH_INVALID");
  const absolute = resolve(root, repositoryRelative);
  const createdDirectories: string[] = [];
  let cursor = root;
  try {
    for (const segment of repositoryRelative.split("/").slice(0, -1)) {
      cursor = resolve(cursor, segment);
      if (!existsSync(cursor)) {
        try {
          mkdirSync(cursor, { mode: 0o755 });
          createdDirectories.push(cursor);
          fsyncDirectory(dirname(cursor));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") refuse("PUBLISH_PATH_PARENT_CREATE_FAILED", "A missing contained transition parent could not be created.", exitCodes.CONTAINMENT_REFUSAL);
        }
      }
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink()) refuse("PUBLISH_PATH_SYMLINK_REFUSED", "Symlinked transition paths are not permitted.", exitCodes.CONTAINMENT_REFUSAL);
      if (!entry.isDirectory()) refuse("PUBLISH_PATH_PARENT_NOT_DIRECTORY", "Every transition path ancestor must be a real directory.", exitCodes.CONTAINMENT_REFUSAL);
      const resolved = realpathSync(cursor);
      const relation = relative(realpathSync(root), resolved);
      if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("PUBLISH_PATH_ESCAPE", "A transition path ancestor escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
    }
    if (exactContainedPath(root, repositoryRelative, false) !== absolute) refuse("PUBLISH_PATH_ESCAPE", "The prepared transition path changed identity.", exitCodes.CONTAINMENT_REFUSAL);
    return Object.freeze({ absolute, createdDirectories: Object.freeze(createdDirectories) });
  } catch (error) {
    removeCreatedDirectories(createdDirectories);
    throw error;
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function assertOwnerPrivate(entry: { readonly uid: number; readonly mode: number }, reason: string): void {
  if (typeof process.getuid === "function" && entry.uid !== process.getuid()) refuse(reason, "A publication runtime path is not owned by the current user.", exitCodes.CONTAINMENT_REFUSAL);
  if ((entry.mode & 0o077) !== 0) refuse(reason, "A publication runtime path is not owner-only.", exitCodes.CONTAINMENT_REFUSAL);
}

function preparePrivateRuntimeDirectory(root: string, path: string): string {
  const repositoryRelative = repositoryPath(path, "PUBLISH_RUNTIME_PATH_INVALID");
  if (repositoryRelative !== ".usf" && !repositoryRelative.startsWith(".usf/")) refuse("PUBLISH_RUNTIME_PATH_INVALID", "Publication runtime state must remain beneath .usf.", exitCodes.CONTAINMENT_REFUSAL);
  let cursor = root;
  for (const segment of repositoryRelative.split("/")) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      try {
        mkdirSync(cursor, { mode: 0o700 });
        fsyncDirectory(dirname(cursor));
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") refuse("PUBLISH_RUNTIME_DIRECTORY_CREATE_FAILED", "An owner-only publication runtime directory could not be created.", exitCodes.CONTAINMENT_REFUSAL);
      }
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink()) refuse("PUBLISH_RUNTIME_SYMLINK_REFUSED", "Publication runtime directories may not be symlinks.", exitCodes.CONTAINMENT_REFUSAL);
    if (!entry.isDirectory()) refuse("PUBLISH_RUNTIME_NOT_DIRECTORY", "Publication runtime ancestors must be directories.", exitCodes.CONTAINMENT_REFUSAL);
    assertOwnerPrivate(entry, "PUBLISH_RUNTIME_OWNERSHIP_INVALID");
    const relation = relative(realpathSync(root), realpathSync(cursor));
    if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("PUBLISH_RUNTIME_PATH_ESCAPE", "Publication runtime state escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return cursor;
}

function parseFlag(args: readonly string[], name: string): string | undefined {
  const indexes = args.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) refuse("PUBLISH_ARGUMENTS_INVALID", `Duplicate ${name}.`, exitCodes.INVALID_INPUT);
  const index = indexes[0];
  if (index === undefined) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) refuse("PUBLISH_ARGUMENTS_INVALID", `${name} requires a value.`, exitCodes.INVALID_INPUT);
  return value;
}

export function parsePublishArguments(args: readonly string[]): PublishBootstrapTransitionRequest {
  if (args[0] !== "bootstrap-transition") refuse("PUBLISH_ARGUMENTS_INVALID", "publish requires the bootstrap-transition subcommand.", exitCodes.INVALID_INPUT);
  const profile = parseFlag(args, "--profile");
  const manifestPath = parseFlag(args, "--manifest");
  const receiptPath = parseFlag(args, "--receipt");
  const verifyCount = args.filter((value) => value === "--verify").length;
  const applyCount = args.filter((value) => value === "--apply").length;
  const permitted = new Set(["bootstrap-transition", "--profile", profile, "--manifest", manifestPath, "--receipt", receiptPath, "--verify", "--apply"]);
  if (!profile || !manifestPath || !receiptPath || verifyCount + applyCount !== 1 || verifyCount > 1 || applyCount > 1
    || args.some((value) => !permitted.has(value))) refuse("PUBLISH_ARGUMENTS_INVALID", "Exact profile, manifest, receipt and one of --verify or --apply are required.", exitCodes.INVALID_INPUT);
  if (!/^urn:[^<>\s]+$/u.test(profile)) refuse("PUBLISH_PROFILE_INVALID", "The profile must be one exact versioned IRI.", exitCodes.INVALID_INPUT);
  return Object.freeze({
    operation: "bootstrap-transition",
    profile,
    manifestPath: repositoryPath(manifestPath, "PUBLISH_MANIFEST_PATH_INVALID"),
    receiptPath: repositoryPath(receiptPath, "PUBLISH_RECEIPT_PATH_INVALID"),
    mode: verifyCount === 1 ? "verify" : "apply",
  });
}

function one(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string {
  const values = objectsFor(graph, subject, graphPredicate(name));
  if (values.length !== 1 || values[0]?.objectKind !== kind) refuse(`PUBLISH_AUTHORITY_${name.toUpperCase()}_INVALID`, "The bootstrap transition authority is incomplete or ambiguous.");
  return values[0].object;
}

function many(graph: SemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string[] {
  const values = objectsFor(graph, subject, graphPredicate(name));
  if (values.some((quad) => quad.objectKind !== kind)) refuse(`PUBLISH_AUTHORITY_${name.toUpperCase()}_INVALID`, "The bootstrap transition authority has an invalid value kind.");
  const objects = values.map((quad) => quad.object).sort();
  if (new Set(objects).size !== objects.length) refuse(`PUBLISH_AUTHORITY_${name.toUpperCase()}_DUPLICATE`, "The bootstrap transition authority contains duplicate values.");
  return objects;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort(); const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function extractAuthority(graph: SemanticGraph, request: PublishBootstrapTransitionRequest, expectedState: "pre" | "post"): BootstrapAuthority {
  if (!objectsFor(graph, bootstrapException, typePredicate).some((quad) => quad.objectKind === "iri" && quad.object === "urn:usf:type:BootstrapConstructionException")) refuse("PUBLISH_BOOTSTRAP_EXCEPTION_INVALID", "The typed bootstrap exception is absent.");
  const exceptionState = one(graph, bootstrapException, "state", "iri");
  const sourcePath = repositoryPath(one(graph, bootstrapException, "admissionWritePath", "literal"), "PUBLISH_AUTHORITY_SOURCE_PATH_INVALID");
  const receiptPath = repositoryPath(one(graph, bootstrapException, "admissionReceiptPath", "literal"), "PUBLISH_AUTHORITY_RECEIPT_PATH_INVALID");
  const receiptSchemaPath = repositoryPath(one(graph, bootstrapException, "admissionReceiptSchemaPath", "literal"), "PUBLISH_AUTHORITY_SCHEMA_PATH_INVALID");
  const algorithm = one(graph, bootstrapException, "admissionTransitionAlgorithm", "iri");
  if (algorithm !== "urn:usf:algorithm:verified-transition-receipt:1") refuse("PUBLISH_ALGORITHM_INVALID", "The transition algorithm is not supported.");
  const transition = one(graph, bootstrapException, "admissionTransitionReceipt", "iri");
  const preState = one(graph, bootstrapException, "admissionPreState", "iri");
  const postState = one(graph, bootstrapException, "admissionPostState", "iri");
  const graphIri = one(graph, bootstrapException, "admissionGraph", "iri");
  const admissionSet = one(graph, bootstrapException, "admissionWorkSet", "iri");
  const works = many(graph, admissionSet, "member", "iri").map((work) => ({ work, order: Number(one(graph, work, "bootstrapOrder", "literal")) }))
    .sort((left, right) => left.order - right.order || left.work.localeCompare(right.work));
  if (works.length !== exactWorkOrder.length || works.some((item, index) => item.order !== index + 1 || item.work !== exactWorkOrder[index])) refuse("PUBLISH_WORK_SET_INVALID", "The bootstrap admission set is not the exact eligibility, basis, lifecycle order.");
  const evidenceIds = works.map(({ work }) => exactEvidenceByWork[work as keyof typeof exactEvidenceByWork]);
  if (evidenceIds.some((value) => value === undefined) || !sameSet(evidenceIds as string[], many(graph, bootstrapException, "admissionEvidence", "iri"))) refuse("PUBLISH_EVIDENCE_SET_INVALID", "The graph-declared evidence set does not match the ordered bootstrap work set.");
  const proofResults = many(graph, bootstrapException, "admissionProofResult", "iri");
  const validations = many(graph, bootstrapException, "admissionValidation", "iri");
  if (proofResults.length !== 1 || validations.length !== 3) refuse("PUBLISH_ADMISSION_SET_INVALID", "The graph-declared proof or validation set is not exact.");
  const orderedValidations = works.map(({ work }) => {
    const selected = many(graph, work, "validation", "iri").filter((id) => validations.includes(id));
    if (selected.length !== 1) refuse("PUBLISH_VALIDATION_BINDING_INVALID", "Each bootstrap work must bind one exact focused validation.");
    return selected[0] as string;
  });
  const contract = one(graph, works[0]!.work, "contract", "iri");
  if (works.some(({ work }) => one(graph, work, "contract", "iri") !== contract)) refuse("PUBLISH_CONTRACT_SET_INVALID", "Bootstrap work crosses contract authority.");
  const evidenceRoot = one(graph, contract, "constructionEvidenceRequirement", "iri");
  const leaves = many(graph, evidenceRoot, "requiresEvidence", "iri");
  const leafValidations = leaves.map((leaf) => one(graph, leaf, "validationObligation", "iri"));
  if (!sameSet(orderedValidations, leafValidations)) refuse("PUBLISH_EVIDENCE_REQUIREMENT_INVALID", "Focused validations do not close the construction evidence leaves.");
  const proofObligation = one(graph, bootstrapException, "admissionProofObligation", "iri");
  const proofAlgorithm = one(graph, proofObligation, "algorithm", "iri");
  const permission = one(graph, bootstrapException, "requiresActivePermissionAfterClosure", "iri");
  const currentness = one(graph, permission, "activationCurrentness", "iri");
  const authorityProfile = one(graph, currentness, "authorityProfile", "iri");
  const authorityManifestPath = repositoryPath(one(graph, currentness, "authorityManifestPath", "literal"), "PUBLISH_AUTHORITY_MANIFEST_PATH_INVALID");
  const permissionBefore = one(graph, preState, "permissionState", "iri");
  const permissionAfter = one(graph, postState, "permissionState", "iri");
  const exceptionBefore = one(graph, preState, "exceptionState", "iri");
  const exceptionAfter = one(graph, postState, "exceptionState", "iri");
  if ((expectedState === "pre" && (exceptionState !== exceptionBefore || one(graph, permission, "activationState", "iri") !== permissionBefore))
    || (expectedState === "post" && (exceptionState !== exceptionAfter || one(graph, permission, "activationState", "iri") !== permissionAfter))) refuse("PUBLISH_AUTHORITY_STATE_MISMATCH", "The current graph is not the required transition state.");
  // Profile existence and exact version closure are checked by deriveWork below.
  if (request.profile !== authorityProfile || request.receiptPath !== receiptPath || request.manifestPath !== authorityManifestPath
    || request.manifestPath !== (graph as SemanticGraph & { manifestPath?: string }).manifestPath) refuse("PUBLISH_SELECTION_MISMATCH", "CLI selection does not match the graph-declared authority profile, manifest and receipt.", exitCodes.INVALID_INPUT);
  const resources = [...(evidenceIds as string[]), proofResults[0] as string, permission, bootstrapException];
  if (!sameSet(resources, many(graph, bootstrapException, "admissionResource", "iri"))) refuse("PUBLISH_RESOURCE_SET_INVALID", "The exact six-resource transition set is not declared.");
  if (!sameSet(expectedAdmissionPredicates, many(graph, bootstrapException, "admissionPredicate", "iri"))) refuse("PUBLISH_PREDICATE_SET_INVALID", "The transition predicate allowlist is not exact.");
  return Object.freeze({
    graph: graphIri, sourcePath, receiptPath, receiptSchemaPath, authorityProfile, authorityManifestPath,
    algorithm: algorithm as BootstrapAuthority["algorithm"], transition, preState, postState, admissionSet,
    works: Object.freeze(works.map(({ work }) => work)), evidenceIds: Object.freeze(evidenceIds as string[]), proofId: proofResults[0] as string,
    resources: Object.freeze(resources), validations: Object.freeze(orderedValidations), proofObligation, proofAlgorithm, permission, currentness,
    permissionBefore, permissionAfter, exceptionBefore, exceptionAfter,
  });
}

function deriveMembers(root: string, request: PublishBootstrapTransitionRequest, authority: BootstrapAuthority, requireBootstrapAuthority: boolean): DerivedMember[] {
  return authority.works.map((workId) => {
    const graph = loadSemanticGraph(root, authority.authorityManifestPath);
    const result = deriveWork(graph, { profile: authority.authorityProfile, selector: workId, maxItems: 1 });
    if (result.status !== "ok" || result.truncation?.truncated || result.items?.length !== 1) refuse("PUBLISH_PROFILE_DERIVATION_FAILED", "A selected bootstrap member did not independently produce one exact profile-bound work packet.");
    const packet = result.items[0];
    if (!packet?.realisationBasis) refuse("PUBLISH_MEMBER_BASIS_MISSING", "A bootstrap member has no profile-bound basis.");
    assertRealisationBasis(packet.realisationBasis);
    if (requireBootstrapAuthority && (packet.eligibility?.construction.eligible !== true || packet.eligibility.construction.authority !== "bootstrap-exception" || packet.eligibility.construction.maximumThrough !== "check")) refuse("PUBLISH_MEMBER_NOT_CONSTRUCTION_ELIGIBLE", "Every pre-state member must be eligible under the exact bootstrap exception.");
    return Object.freeze({ packet, basis: packet.realisationBasis });
  });
}

function shadowDirectoryLeaves(root: string, declaredPath: string): Array<{ path: string; digest: string }> {
  if (!declaredPath.endsWith("/")) refuse("PUBLISH_SHADOW_INPUT_PATH_INVALID", "A slash-terminated repository directory is required.", exitCodes.CONTAINMENT_REFUSAL);
  const directoryPath = repositoryPath(declaredPath.slice(0, -1), "PUBLISH_SHADOW_INPUT_PATH_INVALID");
  const canonicalRoot = realpathSync(root);
  const directory = resolve(canonicalRoot, directoryPath);
  const relation = relative(canonicalRoot, directory);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("PUBLISH_SHADOW_PATH_ESCAPE", "A selected proof directory escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  if (!existsSync(directory)) refuse("PUBLISH_SHADOW_DIRECTORY_MISSING", "A selected proof directory is missing.", exitCodes.CONTAINMENT_REFUSAL);

  const walk = (current: string): Array<{ path: string; digest: string }> => {
    const currentEntry = lstatSync(current);
    if (currentEntry.isSymbolicLink()) refuse("PUBLISH_SHADOW_SYMLINK_REFUSED", "The isolated proof repository may not contain symlinks.", exitCodes.CONTAINMENT_REFUSAL);
    if (!currentEntry.isDirectory()) refuse("PUBLISH_SHADOW_DIRECTORY_EXPECTED", "A slash-terminated proof input must be a real directory.", exitCodes.CONTAINMENT_REFUSAL);
    const currentRelation = relative(canonicalRoot, realpathSync(current));
    if (currentRelation === ".." || currentRelation.startsWith(`..${sep}`) || isAbsolute(currentRelation)) refuse("PUBLISH_SHADOW_PATH_ESCAPE", "A selected proof directory escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
    return readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => {
        const child = resolve(current, entry.name);
        const childEntry = lstatSync(child);
        if (childEntry.isSymbolicLink()) refuse("PUBLISH_SHADOW_SYMLINK_REFUSED", "The isolated proof repository may not contain symlinks.", exitCodes.CONTAINMENT_REFUSAL);
        if (childEntry.isDirectory()) return walk(child);
        if (!childEntry.isFile()) refuse("PUBLISH_SHADOW_INPUT_NOT_FILE", "Every selected isolated proof leaf must be a regular file.", exitCodes.CONTAINMENT_REFUSAL);
        const path = repositoryPath(relative(canonicalRoot, child).split(sep).join("/"), "PUBLISH_SHADOW_INPUT_PATH_INVALID");
        exactContainedPath(canonicalRoot, path, true);
        return [{ path, digest: sha256(readFileSync(child)) }];
      });
  };
  return walk(directory);
}

function selectedShadowPaths(root: string, members: readonly DerivedMember[]): string[] {
  const tracked = spawnSync("git", ["ls-files", "--cached", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (tracked.error || tracked.status !== 0 || tracked.signal !== null) refuse("PUBLISH_SHADOW_TRACKED_INPUTS_UNAVAILABLE", "The isolated proof input set could not be derived from Git.", exitCodes.CONTAINMENT_REFUSAL);
  const trackedPaths = tracked.stdout.split("\0").filter((path) => path.length > 0);
  const packetPaths = members.flatMap(({ packet }) => [
    ...packet.readSet,
    ...packet.writeSet,
    ...packet.semanticDependencies.filter((dependency) => ["file", "policy", "schema", "tool"].includes(dependency.kind)).map((dependency) => dependency.key),
  ]);
  const selectedPaths = new Set(trackedPaths.map((path) => repositoryPath(path, "PUBLISH_SHADOW_INPUT_PATH_INVALID")));
  for (const declaredPath of [...new Set(packetPaths)].sort()) {
    if (!declaredPath.endsWith("/")) {
      selectedPaths.add(repositoryPath(declaredPath, "PUBLISH_SHADOW_INPUT_PATH_INVALID"));
      continue;
    }
    const leaves = shadowDirectoryLeaves(root, declaredPath);
    const aggregate = canonicalDigest(leaves);
    const dependencies = members.flatMap(({ basis }) => basis.work.dependencies)
      .filter((dependency) => dependency.kind === "file" && dependency.key === declaredPath);
    if (dependencies.length === 0 || dependencies.some((dependency) => dependency.digest !== aggregate)) {
      refuse("PUBLISH_SHADOW_DIRECTORY_AGGREGATE_MISMATCH", "A selected proof directory does not match every packet-authorized aggregate.", exitCodes.CONTAINMENT_REFUSAL);
    }
    for (const leaf of leaves) selectedPaths.add(leaf.path);
  }
  const selected = [...selectedPaths].sort();
  for (const path of selected) {
    const name = basename(path);
    if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) refuse("PUBLISH_SHADOW_SECRET_PATH_REFUSED", "Environment and credential files may not enter the isolated proof repository.", exitCodes.CONTAINMENT_REFUSAL);
  }
  if (selected.length > 0) {
    const ignored = spawnSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
      cwd: root,
      input: `${selected.join("\0")}\0`,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (ignored.error || ignored.signal !== null || ![0, 1].includes(ignored.status ?? -1)) refuse("PUBLISH_SHADOW_IGNORE_CHECK_FAILED", "The isolated proof input ignore boundary could not be verified.", exitCodes.CONTAINMENT_REFUSAL);
    const ignoredPaths = ignored.stdout.split("\0").filter((path) => path.length > 0);
    if (ignoredPaths.length > 0) refuse("PUBLISH_SHADOW_IGNORED_PATH_REFUSED", "Ignored paths may not enter the isolated proof repository.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return selected;
}

function createShadowRepository(root: string, members: readonly DerivedMember[]): ShadowRepository {
  const tempParent = resolve(root, ".usf/tmp");
  mkdirSync(tempParent, { recursive: true, mode: 0o700 });
  const container = mkdtempSync(resolve(tempParent, "bootstrap-transition-"));
  const shadow = resolve(container, "repository");
  mkdirSync(shadow, { mode: 0o700 });
  for (const path of selectedShadowPaths(root, members)) {
    const source = resolve(root, path);
    if (!existsSync(source)) continue;
    const sourceEntry = lstatSync(source);
    if (sourceEntry.isSymbolicLink()) refuse("PUBLISH_SHADOW_SYMLINK_REFUSED", "The isolated proof repository may not contain symlinks.", exitCodes.CONTAINMENT_REFUSAL);
    if (!sourceEntry.isFile()) refuse("PUBLISH_SHADOW_INPUT_NOT_FILE", "Every selected isolated proof input must be a regular file.", exitCodes.CONTAINMENT_REFUSAL);
    exactContainedPath(root, path, true);
    const destination = resolve(shadow, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
    cpSync(source, destination, { preserveTimestamps: false, verbatimSymlinks: false });
  }
  mkdirSync(resolve(shadow, ".usf/tmp"), { recursive: true, mode: 0o700 });
  // These empty local roots let non-authoritative preparation discover its
  // confined dependency boundaries without walking above the shadow. Package
  // bytes remain in the separately allowlisted, read-only root dependency.
  mkdirSync(resolve(shadow, ".usf/cache"), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(shadow, ".usf/provider-home"), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(shadow, "node_modules"), { mode: 0o700 });
  const environment = scrubbedTestEnvironment(root, shadow);
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd: shadow, env: environment, encoding: "utf8" });
  const resolved = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: shadow, env: environment, encoding: "utf8" });
  if (initialized.error || initialized.status !== 0 || resolved.error || resolved.status !== 0
    || realpathSync(resolved.stdout.trim()) !== realpathSync(shadow) || realpathSync(shadow) === realpathSync(root)) {
    refuse("PUBLISH_SHADOW_ROOT_INVALID", "The isolated proof repository did not establish its own exact repository boundary.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return Object.freeze({ root: shadow, container });
}

function assertReceiptMissingPreimage(members: readonly DerivedMember[], receiptPath: string): void {
  const owners = members.filter(({ basis }) => basis.scope.writeSet.includes(receiptPath));
  if (owners.length !== 1) refuse("PUBLISH_RECEIPT_PREIMAGE_SCOPE_INVALID", "Exactly one ordered member must own the external receipt path.");
  const owner = owners[0]!.basis;
  if (!Object.hasOwn(owner.scope.preimages, receiptPath) || owner.scope.preimages[receiptPath] !== null) refuse("PUBLISH_RECEIPT_PREIMAGE_NOT_NULL", "The external receipt must have the exact null absent-file preimage.");
  const dependencies = owner.work.dependencies.filter((dependency) => dependency.kind === "file" && dependency.key === receiptPath);
  if (dependencies.length !== 1 || dependencies[0]?.digest !== sha256(`missing\u0000${receiptPath}`)) refuse("PUBLISH_RECEIPT_DEPENDENCY_NOT_MISSING", "The receipt dependency must bind the exact missing-file marker.");
}

function scrubbedTestEnvironment(root: string, shadow: string): NodeJS.ProcessEnv {
  return {
    HOME: resolve(shadow, ".usf/provider-home"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: resolve(shadow, ".usf/tmp"),
    USF_PROVIDER_HOME: resolve(shadow, ".usf/provider-home"),
    USF_REPOSITORY_ROOT: shadow,
    NODE_PATH: resolve(root, "node_modules"),
  };
}

function runFocusedValidations(root: string, shadow: string, graph: SemanticGraph, authority: BootstrapAuthority): TransitionValidationRef[] {
  const scratch = mkdtempSync(resolve(shadow, ".usf/validation-"));
  try {
    return authority.validations.map((id) => {
      const command = one(graph, id, "command", "literal");
      const commandTokens = command.split(" ");
      const optionalNamePattern = commandTokens[3]?.startsWith("--test-name-pattern=") === true ? commandTokens[3] : undefined;
      const testTokens = commandTokens.slice(optionalNamePattern === undefined ? 3 : 4);
      if (commandTokens.length > 12 || commandTokens.some((token) => token.length === 0) || commandTokens[0] !== "node" || commandTokens[1] !== "--test" || commandTokens[2] !== "--test-isolation=none"
        || (optionalNamePattern !== undefined && !/^--test-name-pattern=[A-Za-z0-9._-]+$/u.test(optionalNamePattern))
        || testTokens.length < 1 || testTokens.length > 8 || new Set(testTokens).size !== testTokens.length
        || testTokens.some((token) => !token.endsWith(".test.ts"))) refuse("PUBLISH_VALIDATION_COMMAND_REFUSED", "Focused validation commands must use the exact bounded confined Node test form.", exitCodes.CONTAINMENT_REFUSAL);
      for (const testToken of testTokens) exactContainedPath(shadow, repositoryPath(testToken, "PUBLISH_VALIDATION_PATH_INVALID"), true);
      const launch = confinedNodeTestLaunch(shadow, scratch, [resolve(root, "node_modules"), resolve(root, ".usf/cache")], commandTokens);
      if (launch === null) refuse("PUBLISH_VALIDATION_COMMAND_REFUSED", "Focused validation confinement is unavailable for the exact graph command.", exitCodes.CONTAINMENT_REFUSAL);
      const result = spawnSync(launch.executable, launch.arguments, { cwd: shadow, env: {}, encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
      if (result.error || result.status !== 0 || result.signal !== null) refuse("PUBLISH_FOCUSED_VALIDATION_FAILED", `Graph-declared focused validation ${id} did not pass.`);
      const resultDigest = canonicalDigest({ id, command, outcome: "pass" });
      return Object.freeze({ id, command, outcome: "pass" as const, resultDigest });
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function evidenceRequirementForValidation(graph: SemanticGraph, validationId: string): string {
  const candidates = [...new Set(graph.quads.filter((quad) => quad.predicate === graphPredicate("validationObligation") && quad.objectKind === "iri" && quad.object === validationId).map((quad) => quad.subject))];
  if (candidates.length !== 1) refuse("PUBLISH_EVIDENCE_REQUIREMENT_BINDING_INVALID", "Each focused validation must bind one exact evidence requirement.");
  return candidates[0] as string;
}

function createAdmission(graph: SemanticGraph, authority: BootstrapAuthority, members: readonly DerivedMember[], validations: readonly TransitionValidationRef[]): AggregateAdmission {
  const memberRefs = members.map(({ basis }, index) => transitionMemberFromBasis(basis, index + 1));
  const admissionSetDigest = canonicalDigest({ admissionSet: authority.admissionSet, members: memberRefs });
  const evidence: TransitionEvidenceRef[] = members.map(({ basis }, index) => {
    const id = authority.evidenceIds[index] as string;
    const validation = validations[index] as TransitionValidationRef;
    const draft = {
      id,
      workId: basis.work.id,
      requirementId: evidenceRequirementForValidation(graph, validation.id),
      validationId: validation.id,
      validationResultDigest: validation.resultDigest,
      basisDigest: basis.basisDigest,
      scopedDependencyDigest: basis.work.scopedDependencyDigest,
    };
    return Object.freeze({ ...draft, contentDigest: canonicalDigest(draft) });
  });
  const evidenceDigest = canonicalDigest([...evidence]
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
    .map(({ requirementId, contentDigest }) => ({ requirement: requirementId, contentDigest })));
  const proofDraft = {
    id: authority.proofId,
    obligation: authority.proofObligation,
    algorithm: authority.proofAlgorithm,
    evidenceDigest,
    admissionSetDigest,
    outcome: "pass" as const,
  };
  const proof: TransitionProofRef = Object.freeze({ ...proofDraft, contentDigest: canonicalDigest(proofDraft) });
  return createAggregateAdmission({ admissionSet: authority.admissionSet, admissionSetDigest, members: memberRefs, validations, evidence, proof });
}

function quad(subject: string, predicate: string, object: string, objectKind: "iri" | "literal", graph: string) {
  const line = canonicalQuadLine({ subject, predicate, object, objectKind, graph, canonical: "" });
  return parseTransitionQuad(line, graph);
}

function resourceAdditionQuads(admission: AggregateAdmission, authority: BootstrapAuthority) {
  const evidenceQuads = admission.evidence.flatMap((evidence) => [
    quad(evidence.id, typePredicate, evidenceType, "iri", authority.graph),
    quad(evidence.id, graphPredicate("forWork"), evidence.workId, "iri", authority.graph),
    quad(evidence.id, graphPredicate("satisfiesEvidenceRequirement"), evidence.requirementId, "iri", authority.graph),
    quad(evidence.id, graphPredicate("validationResultDigest"), evidence.validationResultDigest, "literal", authority.graph),
    quad(evidence.id, graphPredicate("realisationBasisDigest"), evidence.basisDigest, "literal", authority.graph),
    quad(evidence.id, graphPredicate("scopedDependencyDigest"), evidence.scopedDependencyDigest, "literal", authority.graph),
    quad(evidence.id, graphPredicate("contentDigest"), evidence.contentDigest, "literal", authority.graph),
  ].sort((left, right) => left.line.localeCompare(right.line)));
  const proof = admission.proof;
  const proofQuads = [
    quad(proof.id, typePredicate, proofResultType, "iri", authority.graph),
    quad(proof.id, graphPredicate("forObligation"), proof.obligation, "iri", authority.graph),
    quad(proof.id, graphPredicate("algorithm"), proof.algorithm, "iri", authority.graph),
    quad(proof.id, graphPredicate("evidenceDigest"), proof.evidenceDigest, "literal", authority.graph),
    quad(proof.id, graphPredicate("admissionSetDigest"), proof.admissionSetDigest, "literal", authority.graph),
    quad(proof.id, graphPredicate("outcome"), proof.outcome, "literal", authority.graph),
    quad(proof.id, graphPredicate("contentDigest"), proof.contentDigest, "literal", authority.graph),
  ].sort((left, right) => left.line.localeCompare(right.line));
  return [...evidenceQuads, ...proofQuads];
}

function createOperations(source: string, admission: AggregateAdmission, authority: BootstrapAuthority): TransitionOperation[] {
  if (!source.endsWith("\n") || source.includes("\r")) refuse("PUBLISH_SOURCE_NON_CANONICAL", "The authority source must use canonical LF-terminated N-Quad lines.");
  const lines = source.slice(0, -1).split("\n");
  const operations: TransitionOperation[] = [];
  for (const addition of resourceAdditionQuads(admission, authority)) {
    if (lines.includes(addition.line)) refuse("PUBLISH_ADMISSION_RESOURCE_ALREADY_EXISTS", "An admission resource already exists in the pre-state.");
    operations.push(Object.freeze({ ordinal: operations.length + 1, kind: "add" as const, path: authority.sourcePath, lineIndex: lines.length + operations.length, before: null, after: addition }));
  }
  const replacements = [
    { subject: authority.permission, predicate: graphPredicate("activationState"), before: authority.permissionBefore, after: authority.permissionAfter },
    { subject: bootstrapException, predicate: graphPredicate("state"), before: authority.exceptionBefore, after: authority.exceptionAfter },
  ];
  for (const replacement of replacements) {
    const before = quad(replacement.subject, replacement.predicate, replacement.before, "iri", authority.graph);
    const after = quad(replacement.subject, replacement.predicate, replacement.after, "iri", authority.graph);
    const lineIndex = lines.indexOf(before.line);
    if (lineIndex < 0 || lines.lastIndexOf(before.line) !== lineIndex || lines.includes(after.line)) refuse("PUBLISH_REPLACEMENT_PREIMAGE_INVALID", "An exact authority-state replacement preimage is absent or ambiguous.");
    operations.push(Object.freeze({ ordinal: operations.length + 1, kind: "replace" as const, path: authority.sourcePath, lineIndex, before, after }));
  }
  return Object.freeze(operations) as TransitionOperation[];
}

function createState(id: string, source: string, graph: SemanticGraph, bases: readonly RealisationBasis[], authority: BootstrapAuthority): TransitionState {
  return createTransitionStateFromBases(id, source, graph, bases, authority.resources);
}

function validateReceiptSchema(root: string, schemaPath: string, receipt: unknown): void {
  const absolute = exactContainedPath(root, schemaPath, true);
  let schema: unknown;
  try { schema = JSON.parse(readFileSync(absolute, "utf8")); } catch { return refuse("PUBLISH_RECEIPT_SCHEMA_INVALID", "The receipt schema is not readable canonical JSON."); }
  let valid = false;
  try { valid = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema as AnySchema)(receipt) as boolean; } catch { return refuse("PUBLISH_RECEIPT_SCHEMA_INVALID", "The receipt schema could not be compiled."); }
  if (!valid) refuse("PUBLISH_RECEIPT_SCHEMA_REFUSED", "The transition receipt does not satisfy its closed schema.");
}

function exactReceiptBytes(receipt: VerifiedTransitionReceipt): string { return `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`; }

function sameCanonical(left: unknown, right: unknown): boolean { return canonicalJson(left, { rejectAbsolutePaths: true }) === canonicalJson(right, { rejectAbsolutePaths: true }); }

function writeAllAndVerify(descriptor: number, bytes: string | Buffer): void {
  const expected = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  let written = 0;
  while (written < expected.length) {
    const count = writeSync(descriptor, expected, written, expected.length - written, null);
    if (count <= 0) refuse("PUBLISH_TEMPORARY_WRITE_INCOMPLETE", "A publication temporary write made no progress.", exitCodes.CONTAINMENT_REFUSAL);
    written += count;
  }
  fsyncSync(descriptor);
  const entry = fstatSync(descriptor);
  if (!entry.isFile() || entry.size !== expected.length) refuse("PUBLISH_TEMPORARY_WRITE_MISMATCH", "A publication temporary has the wrong exact size.", exitCodes.CONTAINMENT_REFUSAL);
  const observed = Buffer.alloc(expected.length);
  let read = 0;
  while (read < observed.length) {
    const count = readSync(descriptor, observed, read, observed.length - read, read);
    if (count <= 0) refuse("PUBLISH_TEMPORARY_WRITE_MISMATCH", "A publication temporary could not be read back exactly.", exitCodes.CONTAINMENT_REFUSAL);
    read += count;
  }
  if (!observed.equals(expected) || sha256(observed) !== sha256(expected)) refuse("PUBLISH_TEMPORARY_WRITE_MISMATCH", "A publication temporary digest does not match its exact intended bytes.", exitCodes.CONTAINMENT_REFUSAL);
}

function atomicWrite(path: string, bytes: string | Buffer, mode: number): void {
  const temporary = resolve(dirname(path), `.${basename(path)}.usf-transition-${process.pid}`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, mode);
    writeAllAndVerify(descriptor, bytes);
    closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function atomicCreate(path: string, bytes: string | Buffer, mode: number): void {
  const temporary = resolve(dirname(path), `.${basename(path)}.usf-transition-${process.pid}`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, mode);
    writeAllAndVerify(descriptor, bytes);
    closeSync(descriptor); descriptor = undefined;
    // Same-directory hard-link creation is atomic and refuses an existing target.
    linkSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) {
      unlinkSync(temporary);
      fsyncDirectory(dirname(path));
    }
  }
}

export function createPublishRecoveryJournal(input: {
  readonly profile: string;
  readonly manifestPath: string;
  readonly sourcePath: string;
  readonly receiptPath: string;
  readonly sourceBefore: string;
  readonly sourceAfter: string;
  readonly receiptBytes: string;
}): PublishRecoveryJournal {
  let receipt: VerifiedTransitionReceipt;
  try {
    receipt = JSON.parse(input.receiptBytes) as VerifiedTransitionReceipt;
    assertVerifiedTransitionReceipt(receipt);
  } catch {
    return refuse("PUBLISH_RECOVERY_RECEIPT_INVALID", "Recovery state requires one valid exact transition receipt.", exitCodes.CONTAINMENT_REFUSAL);
  }
  const manifestPath = repositoryPath(input.manifestPath, "PUBLISH_RECOVERY_MANIFEST_PATH_INVALID");
  const sourcePath = repositoryPath(input.sourcePath, "PUBLISH_RECOVERY_SOURCE_PATH_INVALID");
  const receiptPath = repositoryPath(input.receiptPath, "PUBLISH_RECOVERY_RECEIPT_PATH_INVALID");
  if (receipt.profile !== input.profile || receipt.manifestPath !== manifestPath || receipt.sourcePath !== sourcePath || receipt.receiptPath !== receiptPath
    || sha256(input.sourceBefore) !== receipt.preState.sourceDigest || sha256(input.sourceAfter) !== receipt.postState.sourceDigest
    || exactReceiptBytes(receipt) !== input.receiptBytes) refuse("PUBLISH_RECOVERY_BINDING_INVALID", "Recovery state does not bind the exact verified transition bytes.", exitCodes.CONTAINMENT_REFUSAL);
  const draft = Object.freeze({
    schema: "urn:usf:publish-recovery-journal:1" as const,
    status: "prepared" as const,
    profile: input.profile,
    manifestPath,
    sourcePath,
    receiptPath,
    sourceBefore: input.sourceBefore,
    sourceBeforeDigest: sha256(input.sourceBefore),
    sourceAfter: input.sourceAfter,
    sourceAfterDigest: sha256(input.sourceAfter),
    receiptBytes: input.receiptBytes,
    receiptBytesDigest: sha256(input.receiptBytes),
  });
  return Object.freeze({ ...draft, transactionDigest: canonicalDigest(draft) });
}

function parsePublishRecoveryJournal(value: unknown): PublishRecoveryJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse("PUBLISH_RECOVERY_JOURNAL_INVALID", "The recovery journal is not a closed object.", exitCodes.CONTAINMENT_REFUSAL);
  const candidate = value as Record<string, unknown>;
  const exactKeys = [
    "manifestPath", "profile", "receiptBytes", "receiptBytesDigest", "receiptPath", "schema", "sourceAfter", "sourceAfterDigest",
    "sourceBefore", "sourceBeforeDigest", "sourcePath", "status", "transactionDigest",
  ].sort();
  if (Object.keys(candidate).sort().some((key, index) => key !== exactKeys[index]) || Object.keys(candidate).length !== exactKeys.length
    || exactKeys.some((key) => typeof candidate[key] !== "string")) refuse("PUBLISH_RECOVERY_JOURNAL_INVALID", "The recovery journal shape is not exact.", exitCodes.CONTAINMENT_REFUSAL);
  const rebuilt = createPublishRecoveryJournal({
    profile: candidate.profile as string,
    manifestPath: candidate.manifestPath as string,
    sourcePath: candidate.sourcePath as string,
    receiptPath: candidate.receiptPath as string,
    sourceBefore: candidate.sourceBefore as string,
    sourceAfter: candidate.sourceAfter as string,
    receiptBytes: candidate.receiptBytes as string,
  });
  if (!sameCanonical(rebuilt, candidate)) refuse("PUBLISH_RECOVERY_JOURNAL_INVALID", "The recovery journal bytes or digests do not reproduce exactly.", exitCodes.CONTAINMENT_REFUSAL);
  return rebuilt;
}

function recoveryJournalBytes(journal: PublishRecoveryJournal): string { return `${canonicalJson(journal, { rejectAbsolutePaths: true })}\n`; }

function assertRuntimeFile(path: string, reason: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) refuse(reason, "A publication runtime file is not a regular non-symlink file.", exitCodes.CONTAINMENT_REFUSAL);
  assertOwnerPrivate(entry, reason);
  if (entry.size > 8 * 1024 * 1024) refuse(reason, "A publication runtime file exceeds its bounded size.", exitCodes.CONTAINMENT_REFUSAL);
}

function readOwnerPrivateRuntimeFile(path: string, reason: string): string {
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { return refuse(reason, "A publication runtime file is unsafe or unreadable.", exitCodes.CONTAINMENT_REFUSAL); }
  try {
    const entry = fstatSync(descriptor);
    if (!entry.isFile()) refuse(reason, "A publication runtime file is not regular.", exitCodes.CONTAINMENT_REFUSAL);
    assertOwnerPrivate(entry, reason);
    if (entry.size > 8 * 1024 * 1024) refuse(reason, "A publication runtime file exceeds its bounded size.", exitCodes.CONTAINMENT_REFUSAL);
    return readFileSync(descriptor, "utf8");
  } finally { closeSync(descriptor); }
}

function cleanupAbandonedJournalTemporaries(root: string, directory: string, target: string): void {
  const prefix = `.${basename(target)}.usf-transition-`;
  const targetBytes = existsSync(target) ? readOwnerPrivateRuntimeFile(target, "PUBLISH_RECOVERY_JOURNAL_UNSAFE") : undefined;
  for (const name of readdirSync(directory).filter((entry) => entry.startsWith(prefix)).sort()) {
    const temporary = resolve(directory, name);
    assertRuntimeFile(temporary, "PUBLISH_RECOVERY_TEMPORARY_INVALID");
    const bytes = readOwnerPrivateRuntimeFile(temporary, "PUBLISH_RECOVERY_TEMPORARY_INVALID");
    let value: unknown;
    try { value = JSON.parse(bytes); }
    catch { return refuse("PUBLISH_RECOVERY_TEMPORARY_INVALID", "A recovery temporary is not valid JSON.", exitCodes.CONTAINMENT_REFUSAL); }
    const journal = parsePublishRecoveryJournal(value);
    if (bytes !== recoveryJournalBytes(journal)) refuse("PUBLISH_RECOVERY_TEMPORARY_INVALID", "A recovery temporary is not exact canonical journal bytes.", exitCodes.CONTAINMENT_REFUSAL);
    if (targetBytes !== undefined) {
      if (bytes !== targetBytes) refuse("PUBLISH_RECOVERY_TEMPORARY_MISMATCH", "A recovery temporary conflicts with the installed journal.", exitCodes.CONTAINMENT_REFUSAL);
    } else {
      const source = exactContainedPath(root, journal.sourcePath, true);
      const receipt = exactContainedPath(root, journal.receiptPath, false);
      if (readFileSync(source, "utf8") !== journal.sourceBefore || existsSync(receipt)) refuse("PUBLISH_RECOVERY_TEMPORARY_MISMATCH", "An uninstalled journal temporary does not precede authority mutation.", exitCodes.CONTAINMENT_REFUSAL);
    }
    unlinkSync(temporary);
    fsyncDirectory(directory);
  }
}

function readPublishRecoveryJournal(root: string): PublishRecoveryJournal | undefined {
  const directory = preparePrivateRuntimeDirectory(root, dirname(recoveryJournalPath));
  const absolute = resolve(root, recoveryJournalPath);
  cleanupAbandonedJournalTemporaries(root, directory, absolute);
  if (!existsSync(absolute)) return undefined;
  assertRuntimeFile(absolute, "PUBLISH_RECOVERY_JOURNAL_UNSAFE");
  let value: unknown;
  try { value = JSON.parse(readOwnerPrivateRuntimeFile(absolute, "PUBLISH_RECOVERY_JOURNAL_UNSAFE")); }
  catch { return refuse("PUBLISH_RECOVERY_JOURNAL_INVALID", "The recovery journal is not valid JSON.", exitCodes.CONTAINMENT_REFUSAL); }
  const journal = parsePublishRecoveryJournal(value);
  if (readOwnerPrivateRuntimeFile(absolute, "PUBLISH_RECOVERY_JOURNAL_UNSAFE") !== recoveryJournalBytes(journal)) refuse("PUBLISH_RECOVERY_JOURNAL_INVALID", "The recovery journal is not exact canonical bytes.", exitCodes.CONTAINMENT_REFUSAL);
  return journal;
}

function persistPublishRecoveryJournal(root: string, journal: PublishRecoveryJournal): void {
  preparePrivateRuntimeDirectory(root, dirname(recoveryJournalPath));
  const absolute = resolve(root, recoveryJournalPath);
  if (existsSync(absolute)) refuse("PUBLISH_RECOVERY_JOURNAL_PRESENT", "An earlier publication transaction must recover first.", exitCodes.INTEGRATION_CONFLICT);
  atomicCreate(absolute, recoveryJournalBytes(journal), 0o600);
  assertRuntimeFile(absolute, "PUBLISH_RECOVERY_JOURNAL_UNSAFE");
  if (readOwnerPrivateRuntimeFile(absolute, "PUBLISH_RECOVERY_JOURNAL_UNSAFE") !== recoveryJournalBytes(journal)) refuse("PUBLISH_RECOVERY_JOURNAL_READBACK_MISMATCH", "The fsynced recovery journal did not read back exactly.", exitCodes.CONTAINMENT_REFUSAL);
}

function clearPublishRecoveryJournal(root: string): void {
  const absolute = resolve(root, recoveryJournalPath);
  if (!existsSync(absolute)) return;
  assertRuntimeFile(absolute, "PUBLISH_RECOVERY_JOURNAL_UNSAFE");
  unlinkSync(absolute);
  fsyncDirectory(dirname(absolute));
}

function cleanupMutationTemporaries(path: string, permittedBytes: readonly string[]): void {
  const directory = dirname(path);
  const prefix = `.${basename(path)}.usf-transition-`;
  for (const name of readdirSync(directory).filter((entry) => entry.startsWith(prefix)).sort()) {
    const temporary = resolve(directory, name);
    const entry = lstatSync(temporary);
    if (entry.isSymbolicLink() || !entry.isFile() || (typeof process.getuid === "function" && entry.uid !== process.getuid())) refuse("PUBLISH_RECOVERY_TEMPORARY_INVALID", "A transaction temporary is not an owned regular file.", exitCodes.CONTAINMENT_REFUSAL);
    const bytes = readFileSync(temporary, "utf8");
    if (!permittedBytes.includes(bytes)) refuse("PUBLISH_RECOVERY_TEMPORARY_MISMATCH", "A transaction temporary does not contain an exact journal-bound image.", exitCodes.CONTAINMENT_REFUSAL);
    unlinkSync(temporary);
    fsyncDirectory(directory);
  }
}

function recoverInterruptedPublishTransition(root: string, preferRollback = false): "none" | "rolled-back" | "completed" {
  const journal = readPublishRecoveryJournal(root);
  if (!journal) return "none";
  const source = exactContainedPath(root, journal.sourcePath, true);
  const receipt = exactContainedPath(root, journal.receiptPath, false);
  cleanupMutationTemporaries(source, [journal.sourceBefore, journal.sourceAfter]);
  if (existsSync(dirname(receipt))) cleanupMutationTemporaries(receipt, [journal.receiptBytes]);
  const sourceBytes = readFileSync(source, "utf8");
  const receiptBytes = existsSync(receipt) ? readFileSync(exactContainedPath(root, journal.receiptPath, true), "utf8") : undefined;
  const before = sourceBytes === journal.sourceBefore && sha256(sourceBytes) === journal.sourceBeforeDigest;
  const after = sourceBytes === journal.sourceAfter && sha256(sourceBytes) === journal.sourceAfterDigest;
  const receiptMissing = receiptBytes === undefined;
  const receiptExact = receiptBytes === journal.receiptBytes && sha256(receiptBytes) === journal.receiptBytesDigest;
  if (before && receiptMissing) {
    clearPublishRecoveryJournal(root);
    return "rolled-back";
  }
  if (after && receiptMissing) {
    atomicWrite(source, journal.sourceBefore, statSync(source).mode);
    if (readFileSync(source, "utf8") !== journal.sourceBefore) refuse("PUBLISH_RECOVERY_ROLLBACK_MISMATCH", "Interrupted publication source rollback did not read back exactly.", exitCodes.CONTAINMENT_REFUSAL);
    clearPublishRecoveryJournal(root);
    return "rolled-back";
  }
  if (after && receiptExact) {
    if (preferRollback) {
      unlinkSync(receipt);
      fsyncDirectory(dirname(receipt));
      atomicWrite(source, journal.sourceBefore, statSync(source).mode);
      if (readFileSync(source, "utf8") !== journal.sourceBefore || existsSync(receipt)) refuse("PUBLISH_RECOVERY_ROLLBACK_MISMATCH", "Interrupted publication rollback did not restore exact pre-state.", exitCodes.CONTAINMENT_REFUSAL);
      clearPublishRecoveryJournal(root);
      return "rolled-back";
    }
    clearPublishRecoveryJournal(root);
    return "completed";
  }
  refuse("PUBLISH_RECOVERY_STATE_MISMATCH", "Current source or receipt bytes do not match any journal-bound crash state.", exitCodes.CONTAINMENT_REFUSAL);
}

export function recoverPublishTransition(root: string): "none" | "rolled-back" | "completed" {
  return withPublishTransitionLock(root, () => recoverInterruptedPublishTransition(root));
}

export function withPublishTransitionLock<T>(root: string, operation: () => T): T {
  const lockDirectory = preparePrivateRuntimeDirectory(root, ".usf/locks");
  const lockPath = resolve(lockDirectory, "bootstrap-transition.lock");
  let descriptor: number;
  try { descriptor = openSync(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); }
  catch { return refuse("PUBLISH_TRANSITION_LOCK_INVALID", "The narrow publication lock file is unsafe or unavailable.", exitCodes.CONTAINMENT_REFUSAL); }
  const lockEntry = fstatSync(descriptor);
  if (!lockEntry.isFile()) {
    closeSync(descriptor);
    return refuse("PUBLISH_TRANSITION_LOCK_INVALID", "The narrow publication lock is not a regular file.", exitCodes.CONTAINMENT_REFUSAL);
  }
  try { assertOwnerPrivate(lockEntry, "PUBLISH_TRANSITION_LOCK_INVALID"); }
  catch (error) { closeSync(descriptor); throw error; }
  const acquired = spawnSync("flock", ["--exclusive", "--nonblock", "3"], {
    env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe", descriptor],
  });
  if (acquired.error || acquired.signal !== null || ![0, 1].includes(acquired.status ?? -1)) {
    closeSync(descriptor);
    return refuse("PUBLISH_TRANSITION_LOCK_UNAVAILABLE", "The OS-released publication lock could not be acquired safely.", exitCodes.CONTAINMENT_REFUSAL);
  }
  if (acquired.status === 1) {
    closeSync(descriptor);
    return refuse("PUBLISH_TRANSITION_LOCKED", "Another bootstrap transition operation owns the narrow publication lock.", exitCodes.INTEGRATION_CONFLICT);
  }
  try { return operation(); }
  finally { closeSync(descriptor); }
}

function verifyOrConstruct(
  root: string,
  request: PublishBootstrapTransitionRequest,
): { receipt: VerifiedTransitionReceipt; sourceBefore: string; sourceAfter: string; sourceAbsolute: string; receiptAbsolute: string } {
  const sourceGraph = loadSemanticGraph(root, request.manifestPath);
  const initialAuthority = extractAuthority(sourceGraph, request, request.mode === "apply" ? "pre" : "post");
  const sourceAbsolute = exactContainedPath(root, initialAuthority.sourcePath, true);
  const receiptAbsolute = exactContainedPath(root, initialAuthority.receiptPath, false);
  if (request.mode === "apply" && existsSync(receiptAbsolute)) refuse("PUBLISH_RECEIPT_PREIMAGE_NOT_MISSING", "Apply requires the exact missing receipt preimage.");
  if (request.mode === "verify" && !existsSync(receiptAbsolute)) refuse("PUBLISH_RECEIPT_MISSING", "Verify requires the external transition receipt.");
  const currentSource = readFileSync(sourceAbsolute, "utf8");
  let suppliedReceipt: VerifiedTransitionReceipt | undefined;
  let sourceBefore = currentSource;
  if (request.mode === "verify") {
    try { suppliedReceipt = JSON.parse(readFileSync(receiptAbsolute, "utf8")) as VerifiedTransitionReceipt; } catch { return refuse("PUBLISH_RECEIPT_INVALID_JSON", "The transition receipt is not valid JSON."); }
    assertVerifiedTransitionReceipt(suppliedReceipt);
    validateReceiptSchema(root, initialAuthority.receiptSchemaPath, suppliedReceipt);
    if (suppliedReceipt.profile !== initialAuthority.authorityProfile || suppliedReceipt.manifestPath !== initialAuthority.authorityManifestPath || suppliedReceipt.receiptPath !== initialAuthority.receiptPath
      || suppliedReceipt.sourcePath !== initialAuthority.sourcePath || suppliedReceipt.transition !== initialAuthority.transition || suppliedReceipt.algorithm !== initialAuthority.algorithm) refuse("PUBLISH_RECEIPT_SELECTION_MISMATCH", "The receipt does not bind the exact selected authority.");
    sourceBefore = reverseTransitionOperations(currentSource, suppliedReceipt.operations);
    if (sha256(sourceBefore) !== suppliedReceipt.preState.sourceDigest) refuse("PUBLISH_RECEIPT_PREIMAGE_MISMATCH", "The receipt does not reconstruct its exact pre-state source.");
  }

  const selectionMembers = deriveMembers(root, request, initialAuthority, request.mode === "apply");
  const isolated = createShadowRepository(root, selectionMembers);
  const shadow = isolated.root;
  try {
    const shadowSource = exactContainedPath(shadow, initialAuthority.sourcePath, true);
    writeFileSync(shadowSource, sourceBefore, { encoding: "utf8", mode: statSync(shadowSource).mode });
    const shadowReceipt = exactContainedPath(shadow, initialAuthority.receiptPath, false);
    if (existsSync(shadowReceipt)) unlinkSync(shadowReceipt);
    const preGraph = loadSemanticGraph(shadow, request.manifestPath);
    const authority = extractAuthority(preGraph, request, "pre");
    if (!sameCanonical(authority, { ...initialAuthority, permissionBefore: authority.permissionBefore, exceptionBefore: authority.exceptionBefore })) {
      // Initial post-state authority necessarily differs only in current state, which is not carried in this projection.
      if (authority.transition !== initialAuthority.transition || authority.sourcePath !== initialAuthority.sourcePath || authority.receiptPath !== initialAuthority.receiptPath) refuse("PUBLISH_RECONSTRUCTED_AUTHORITY_MISMATCH", "Reconstructed pre-state authority does not match the current transition identity.");
    }
    const preMembers = deriveMembers(shadow, request, authority, true);
    assertReceiptMissingPreimage(preMembers, authority.receiptPath);
    const validations = runFocusedValidations(root, shadow, preGraph, authority);
    const admission = createAdmission(preGraph, authority, preMembers, validations);
    const operations = createOperations(sourceBefore, admission, authority);
    const sourceAfter = applyTransitionOperations(sourceBefore, operations);
    writeFileSync(shadowSource, sourceAfter, { encoding: "utf8", mode: statSync(shadowSource).mode });
    const postGraph = loadSemanticGraph(shadow, request.manifestPath);
    extractAuthority(postGraph, request, "post");
    // The receipt is intentionally absent while the post-state projection is
    // first derived. A branded candidate then authorizes exactly one in-memory
    // normalization of that graph-declared creation dependency.
    const provisionalPostMembers = deriveMembers(shadow, request, authority, false);
    const candidate = createVerifiedTransitionCandidateCurrentness(preGraph, postGraph, {
      currentness: authority.currentness,
      permission: authority.permission,
      profile: authority.authorityProfile,
      sourceBefore,
      sourceAfter,
      operations,
      admission,
      preBases: preMembers.map(({ basis }) => basis),
      postBases: provisionalPostMembers.map(({ basis }) => basis),
    });
    const candidatePostBases = deriveVerifiedTransitionPostBases(postGraph, candidate);
    const preState = createState(authority.preState, sourceBefore, preGraph, preMembers.map(({ basis }) => basis), authority);
    const postState = createState(authority.postState, sourceAfter, postGraph, candidatePostBases, authority);
    const receipt = createVerifiedTransitionReceipt({
      schema: "urn:usf:verified-transition-receipt:1",
      algorithm: authority.algorithm,
      transition: authority.transition,
      status: "verified",
      sourcePath: authority.sourcePath,
      receiptPath: authority.receiptPath,
      profile: authority.authorityProfile,
      manifestPath: authority.authorityManifestPath,
      preState,
      operations,
      deltaDigest: transitionDeltaDigest(operations),
      postState,
      admission,
    });
    assertTransitionPostBasisCurrentness(receipt, candidatePostBases);
    validateReceiptSchema(root, authority.receiptSchemaPath, receipt);
    const receiptBytes = exactReceiptBytes(receipt);
    prepareContainedParent(shadow, authority.receiptPath);
    atomicCreate(shadowReceipt, receiptBytes, 0o644);
    if (readFileSync(shadowReceipt, "utf8") !== receiptBytes) refuse("PUBLISH_SHADOW_RECEIPT_READBACK_MISMATCH", "The isolated receipt did not match its exact canonical bytes.");
    const livePostGraph = loadSemanticGraph(shadow, request.manifestPath);
    extractAuthority(livePostGraph, request, "post");
    const livePostMembers = deriveMembers(shadow, request, authority, false);
    const livePostBases = livePostMembers.map(({ basis }) => basis);
    assertTransitionPostBasisCurrentness(receipt, livePostBases);
    if (livePostBases.some((basis, index) => basis.basisDigest !== candidatePostBases[index]?.basisDigest)) refuse("PUBLISH_CANDIDATE_LIVE_BASIS_MISMATCH", "Live receipt currentness did not reproduce the branded candidate bases.");
    if (request.mode === "verify") {
      if (!suppliedReceipt || !sameCanonical(receipt, suppliedReceipt) || exactReceiptBytes(receipt) !== readFileSync(receiptAbsolute, "utf8")) refuse("PUBLISH_RECEIPT_CURRENTNESS_MISMATCH", "The receipt does not exactly reproduce current proof, delta and post-state.");
      if (sourceAfter !== currentSource || sha256(currentSource) !== receipt.postState.sourceDigest) refuse("PUBLISH_CURRENT_POSTSTATE_MISMATCH", "Current source differs from the independently replayed post-state.");
    }
    return { receipt, sourceBefore, sourceAfter, sourceAbsolute, receiptAbsolute };
  } finally {
    rmSync(isolated.container, { recursive: true, force: true });
  }
}

export const publishCommandHandler: CommandHandler = ({ args, repositoryRoot }) => {
  const request = parsePublishArguments(args);
  const execute = (recovered: "none" | "rolled-back" | "completed") => {
    const recoveredCompletedApply = request.mode === "apply" && recovered === "completed";
    const result = verifyOrConstruct(repositoryRoot, recoveredCompletedApply ? { ...request, mode: "verify" } : request);
    if (request.mode === "apply" && !recoveredCompletedApply) {
      const sourceMode = statSync(result.sourceAbsolute).mode;
      let createdReceiptDirectories: readonly string[] = [];
      try {
        const preparedReceipt = prepareContainedParent(repositoryRoot, request.receiptPath);
        if (preparedReceipt.absolute !== result.receiptAbsolute) refuse("PUBLISH_PATH_ESCAPE", "The prepared receipt path changed identity.", exitCodes.CONTAINMENT_REFUSAL);
        createdReceiptDirectories = preparedReceipt.createdDirectories;
        if (readFileSync(result.sourceAbsolute, "utf8") !== result.sourceBefore || existsSync(result.receiptAbsolute)) refuse("PUBLISH_APPLY_PREIMAGE_CHANGED", "The exact source or receipt preimage changed before publication.", exitCodes.INTEGRATION_CONFLICT);
        exactContainedPath(repositoryRoot, result.receipt.receiptPath, false);
        const receiptBytes = exactReceiptBytes(result.receipt);
        persistPublishRecoveryJournal(repositoryRoot, createPublishRecoveryJournal({
          profile: request.profile,
          manifestPath: request.manifestPath,
          sourcePath: result.receipt.sourcePath,
          receiptPath: result.receipt.receiptPath,
          sourceBefore: result.sourceBefore,
          sourceAfter: result.sourceAfter,
          receiptBytes,
        }));
        atomicWrite(result.sourceAbsolute, result.sourceAfter, sourceMode);
        if (readFileSync(result.sourceAbsolute, "utf8") !== result.sourceAfter) refuse("PUBLISH_APPLY_SOURCE_READBACK_MISMATCH", "The published source did not match the verified postimage.");
        try { atomicCreate(result.receiptAbsolute, receiptBytes, 0o644); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") refuse("PUBLISH_APPLY_PREIMAGE_CHANGED", "The receipt preimage changed during publication.", exitCodes.INTEGRATION_CONFLICT);
          throw error;
        }
        const verified = verifyOrConstruct(repositoryRoot, { ...request, mode: "verify" });
        if (!sameCanonical(verified.receipt, result.receipt)) refuse("PUBLISH_APPLY_READBACK_MISMATCH", "Atomic apply did not reproduce the verified receipt.");
        clearPublishRecoveryJournal(repositoryRoot);
      } catch (error) {
        if (existsSync(resolve(repositoryRoot, recoveryJournalPath))) recoverInterruptedPublishTransition(repositoryRoot, true);
        removeCreatedDirectories(createdReceiptDirectories);
        throw error;
      }
    }
    return {
      output: Object.freeze({
        schema: "urn:usf:publish-bootstrap-transition-result:1",
        status: "ok",
        mode: request.mode,
        transition: result.receipt.transition,
        receiptDigest: result.receipt.receiptDigest,
        preStateDigest: result.receipt.preState.stateDigest,
        deltaDigest: result.receipt.deltaDigest,
        postStateDigest: result.receipt.postState.stateDigest,
        validationDigests: result.receipt.admission.validations.map(({ id, resultDigest }) => ({ id, resultDigest })),
        effects: request.mode === "apply" ? [result.receipt.sourcePath, result.receipt.receiptPath] : [],
      }),
    };
  };
  return withPublishTransitionLock(repositoryRoot, () => execute(recoverInterruptedPublishTransition(repositoryRoot)));
};
