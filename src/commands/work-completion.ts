import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
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
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { parseRepositoryPath } from "../core/scope.ts";
import { loadSemanticGraph, objectValues, type LoadedSemanticGraph } from "../graph/index.ts";
import { parseStrictNQuads } from "../graph/nquads.ts";
import { deriveWork, type WorkPacket } from "../graph/work.ts";
import {
  authenticateNoChangeWorkspace,
  materialiseNoChangeCandidate,
  deriveNoChangeCandidateIdentity,
  withAuthenticatedNoChangeWorkspaceForCheckRecovery,
  type AuthenticatedNoChangeWorkspace,
} from "../realisation/index.ts";
import {
  completionPublicationIntentDigest,
  createCompletionEvidenceCandidate,
  createCompletionProofBundle,
  createWorkCompletionPublicationReceipt,
  deriveNoChangeCompletionAuthority,
  validateCompletionBundleShape,
  validateCompletionEvidenceShape,
  validateWorkCompletionReceiptShape,
  workCompletionAuthorityDependencies,
  workCompletionNonClaims,
  workCompletionRecordLines,
  type CompletionEvidenceCandidate,
  type CompletionProofBundle,
  type CompletionValidationReference,
  type NoChangeCompletionAuthority,
  type WorkCompletionPublicationMember,
  type WorkCompletionPublicationOperation,
  type WorkCompletionPublicationReceipt,
} from "../realisation/work-completion.ts";
import { acquirePrimaryMutationLock } from "../realisation/transition.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import { readGraphDerivedCheckReceipt, readGraphDerivedCheckReceiptForRecovery, ensureGraphDerivedCheck, authenticateGraphDerivedCheckIntent, type CheckedCandidateReceipt } from "./check.ts";
import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "./construction-authority.ts";
import type { CommandHandler, CommandRequest, CommandResult } from "./dispatcher.ts";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const iriPattern = /^urn:[^<>\s]+$/u;
const candidatePathPattern = /^\.usf\/candidates\/work-completion\/[A-Za-z0-9._-]+\.json$/u;
const receiptPathPattern = /^evidence\/work-completion\/[0-9a-f]{64}\.json$/u;
const maximumInputBytes = 4 * 1024 * 1024;
const predicate = (name: string): string => `urn:usf:predicate:${name}`;

interface CommonSelection {
  readonly profile: string;
  readonly manifestPath: string;
  readonly output?: string;
}

interface RealiseRequest extends CommonSelection { readonly work: string }
interface EvidenceRequest extends RealiseRequest { readonly candidateDigest: string }
interface ProofRequest extends CommonSelection { readonly obligation: string; readonly evidencePath: string }
interface PublishRequest {
  readonly mode: "verify" | "apply";
  readonly bundlePaths: readonly string[];
  readonly profile: string;
  readonly manifestPath: string;
}

interface PreparedPublication {
  readonly graph: LoadedSemanticGraph;
  readonly receipt: WorkCompletionPublicationReceipt;
  readonly receiptBytes: string;
  readonly sourceBefore: string;
  readonly sourceAfter: string;
  readonly recordLines: readonly string[];
  readonly state: "absent" | "matching";
  readonly affectedWorks: readonly string[];
  readonly authority: NoChangeCompletionAuthority;
}

function refuse(code: string, message: string, exitCode: ExitCode = exitCodes.INVALID_INPUT, details?: Record<string, unknown>): never {
  throw new UsfError(code, exitCode, message, details);
}

function asUsfError(error: unknown, fallback: string, exitCode: ExitCode = exitCodes.CURRENTNESS_FAILURE): never {
  if (error instanceof UsfError) throw error;
  const message = error instanceof Error ? error.message.slice(0, 256) : fallback;
  const reason = /^[A-Z0-9_:-]+$/u.test(message) ? message : fallback;
  throw new UsfError(reason.split(":", 1)[0] as string, exitCode, "Work-completion validation refused.", { reason: message });
}

function optionMap(args: readonly string[], repeatable: ReadonlySet<string> = new Set()): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === undefined || value === undefined || !option.startsWith("--") || value.startsWith("--")) {
      refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Every work-completion option requires one explicit value.");
    }
    const values = result.get(option) ?? [];
    if (values.length > 0 && !repeatable.has(option)) {
      refuse("WORK_COMPLETION_OPTION_DUPLICATE", "A non-repeatable work-completion option was repeated.", exitCodes.INVALID_INPUT, { option });
    }
    values.push(value);
    result.set(option, values);
  }
  return result;
}

function exactlyOne(options: Map<string, string[]>, name: string): string {
  const values = options.get(name) ?? [];
  if (values.length !== 1) refuse("WORK_COMPLETION_OPTION_REQUIRED", "A required work-completion option is missing.", exitCodes.INVALID_INPUT, { option: name });
  return values[0] as string;
}

function assertKnownOptions(options: Map<string, string[]>, allowed: readonly string[]): void {
  const known = new Set(allowed);
  const unknown = [...options.keys()].filter((name) => !known.has(name));
  if (unknown.length > 0) refuse("WORK_COMPLETION_OPTION_UNKNOWN", "An unknown work-completion option was supplied.", exitCodes.INVALID_INPUT, { options: unknown.sort() });
}

function optionalOutput(options: Map<string, string[]>): Readonly<{ output?: string }> {
  if (!options.has("--output")) return Object.freeze({});
  const output = exactlyOne(options, "--output");
  if (output !== "-" && !candidatePathPattern.test(output)) {
    refuse("WORK_COMPLETION_OUTPUT_PATH_INVALID", "Candidate output must remain under the ignored work-completion candidate root.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return Object.freeze({ output });
}

function assertSelection(profile: string, manifestPath: string): void {
  if (!iriPattern.test(profile) || parseRepositoryPath(manifestPath, "file") === null
    || !/^graph\/manifests\/[A-Za-z0-9._-]+\.json$/u.test(manifestPath)) {
    refuse("WORK_COMPLETION_SELECTION_INVALID", "Work completion requires an exact versioned profile and explicit repository-local graph manifest.", exitCodes.CONTAINMENT_REFUSAL);
  }
}

function parseRealiseRequest(args: readonly string[]): unknown {
  if (args[0] !== "no-change") refuse("REALISE_TOPIC_INVALID", "Use the graph-registered realise no-change topic.");
  const options = optionMap(args.slice(1));
  assertKnownOptions(options, ["--work", "--profile", "--manifest"]);
  return {
    work: exactlyOne(options, "--work"),
    profile: exactlyOne(options, "--profile"),
    manifestPath: exactlyOne(options, "--manifest"),
  };
}

function parseNoChangeWorkRequest(value: unknown): RealiseRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3
    || !Object.hasOwn(value, "work") || !Object.hasOwn(value, "profile") || !Object.hasOwn(value, "manifestPath")) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "No-change materialisation requires exactly work, profile, and manifestPath.");
  }
  const request = Object.freeze({
    work: (value as { work: unknown }).work,
    profile: (value as { profile: unknown }).profile,
    manifestPath: (value as { manifestPath: unknown }).manifestPath,
  });
  if (typeof request.work !== "string" || typeof request.profile !== "string" || typeof request.manifestPath !== "string") {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "No-change materialisation requires string work, profile, and manifestPath.");
  }
  if (!iriPattern.test(request.work)) refuse("WORK_COMPLETION_IRI_INVALID", "Work must be an exact URN IRI.");
  assertSelection(request.profile, request.manifestPath);
  return Object.freeze({ work: request.work, profile: request.profile, manifestPath: request.manifestPath });
}

function parseEvidenceRequest(args: readonly string[]): EvidenceRequest {
  if (args[0] !== "completion") refuse("EVIDENCE_TOPIC_INVALID", "Use evidence construction or evidence completion.");
  const options = optionMap(args.slice(1));
  assertKnownOptions(options, ["--candidate", "--work", "--profile", "--manifest", "--output"]);
  const candidateDigest = exactlyOne(options, "--candidate");
  const work = exactlyOne(options, "--work");
  const profile = exactlyOne(options, "--profile");
  const manifestPath = exactlyOne(options, "--manifest");
  if (!digestPattern.test(candidateDigest) || !iriPattern.test(work)) refuse("WORK_COMPLETION_IDENTITY_INVALID", "Candidate and work identities are invalid.");
  assertSelection(profile, manifestPath);
  return Object.freeze({ candidateDigest, work, profile, manifestPath, ...optionalOutput(options) });
}

function parseProofRequest(args: readonly string[]): ProofRequest {
  if (args[0] !== "completion") refuse("PROVE_TOPIC_INVALID", "Use prove construction or prove completion.");
  const options = optionMap(args.slice(1));
  assertKnownOptions(options, ["--obligation", "--evidence", "--profile", "--manifest", "--output"]);
  const obligation = exactlyOne(options, "--obligation");
  const evidencePath = exactlyOne(options, "--evidence");
  const profile = exactlyOne(options, "--profile");
  const manifestPath = exactlyOne(options, "--manifest");
  if (!iriPattern.test(obligation)) refuse("WORK_COMPLETION_IRI_INVALID", "Obligation must be an exact URN IRI.");
  if (evidencePath !== "-" && !candidatePathPattern.test(evidencePath)) refuse("WORK_COMPLETION_EVIDENCE_PATH_INVALID", "Evidence input must be bounded stdin or an ignored work-completion candidate.", exitCodes.CONTAINMENT_REFUSAL);
  assertSelection(profile, manifestPath);
  return Object.freeze({ obligation, evidencePath, profile, manifestPath, ...optionalOutput(options) });
}

function parsePublishRequest(args: readonly string[]): PublishRequest {
  if (args[0] !== "work-completion") refuse("PUBLISH_TOPIC_INVALID", "Use the graph-registered publish work-completion topic.");
  const raw = args.slice(1);
  const modes = raw.filter((value) => value === "--verify" || value === "--apply");
  if (modes.length !== 1) refuse("WORK_COMPLETION_PUBLICATION_MODE_INVALID", "Choose exactly one of --verify or --apply.");
  const mode = modes[0] === "--apply" ? "apply" as const : "verify" as const;
  const options = optionMap(raw.filter((value) => value !== "--verify" && value !== "--apply"), new Set(["--bundle"]));
  assertKnownOptions(options, ["--bundle", "--profile", "--manifest"]);
  const bundlePaths = options.get("--bundle") ?? [];
  if (bundlePaths.length < 1 || bundlePaths.length > 32 || new Set(bundlePaths).size !== bundlePaths.length
    || bundlePaths.filter((path) => path === "-").length > 1
    || bundlePaths.some((path) => path !== "-" && !candidatePathPattern.test(path))) {
    refuse("WORK_COMPLETION_BUNDLE_SET_INVALID", "Publication requires one through thirty-two distinct bounded bundle inputs and at most one stdin input.", exitCodes.CONTAINMENT_REFUSAL);
  }
  const profile = exactlyOne(options, "--profile");
  const manifestPath = exactlyOne(options, "--manifest");
  assertSelection(profile, manifestPath);
  return Object.freeze({ mode, bundlePaths: Object.freeze(bundlePaths), profile, manifestPath });
}

function processUid(fallback: number): number { return typeof process.getuid === "function" ? process.getuid() : fallback; }

function assertPrivateDirectory(root: string, repositoryPath: string, create: boolean): string {
  if (!repositoryPath.startsWith(".usf/") && repositoryPath !== ".usf") refuse("WORK_COMPLETION_PRIVATE_PATH_INVALID", "Private state must remain under .usf.", exitCodes.CONTAINMENT_REFUSAL);
  let cursor = realpathSync(resolve(root));
  for (const segment of repositoryPath.split("/")) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      if (!create) refuse("WORK_COMPLETION_PRIVATE_PATH_MISSING", "Required private state directory is absent.", exitCodes.CONTAINMENT_REFUSAL);
      mkdirSync(cursor, { mode: 0o700 });
      chmodSync(cursor, 0o700);
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o077) !== 0 || realpathSync(cursor) !== cursor) {
      refuse("WORK_COMPLETION_PRIVATE_PATH_UNSAFE", "Private state ancestry is not owner-contained.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
  return cursor;
}

function containedCandidatePath(root: string, repositoryPath: string, createParent: boolean): string {
  if (!candidatePathPattern.test(repositoryPath)) refuse("WORK_COMPLETION_CANDIDATE_PATH_INVALID", "Candidate path is outside the ignored bounded root.", exitCodes.CONTAINMENT_REFUSAL);
  assertPrivateDirectory(root, ".usf", createParent);
  assertPrivateDirectory(root, ".usf/candidates", createParent);
  assertPrivateDirectory(root, ".usf/candidates/work-completion", createParent);
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, repositoryPath);
  const relation = relative(canonicalRoot, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("WORK_COMPLETION_CANDIDATE_PATH_ESCAPE", "Candidate path escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  if (existsSync(absolute)) {
    const entry = lstatSync(absolute);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o177) !== 0 || entry.size > maximumInputBytes || realpathSync(absolute) !== absolute) {
      refuse("WORK_COMPLETION_CANDIDATE_FILE_UNSAFE", "Candidate input is not a bounded owner-private regular file.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
  return absolute;
}

function readBoundedInput(root: string, path: string, stdinState: { value?: Buffer }): Buffer {
  let bytes: Buffer;
  if (path === "-") {
    if (stdinState.value !== undefined) refuse("WORK_COMPLETION_STDIN_REUSED", "Stdin may be consumed at most once.");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumInputBytes - total + 1));
      const count = readSync(0, chunk, 0, chunk.length, null);
      if (count === 0) break;
      total += count;
      if (total > maximumInputBytes) refuse("WORK_COMPLETION_INPUT_SIZE_INVALID", "Input must be non-empty and at most four MiB.");
      chunks.push(chunk.subarray(0, count));
    }
    bytes = Buffer.concat(chunks, total);
    stdinState.value = bytes;
  } else {
    const absolute = containedCandidatePath(root, path, false);
    const named = lstatSync(absolute);
    let descriptor: number;
    try { descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
    catch { return refuse("WORK_COMPLETION_CANDIDATE_FILE_UNSAFE", "Candidate input could not be opened without following links.", exitCodes.CONTAINMENT_REFUSAL); }
    try {
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
        || opened.mode !== named.mode || opened.nlink !== 1 || opened.size !== named.size || opened.size > maximumInputBytes) {
        refuse("WORK_COMPLETION_CANDIDATE_FILE_UNSAFE", "Candidate input changed while it was opened.", exitCodes.CONTAINMENT_REFUSAL);
      }
      bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.uid !== opened.uid || after.mode !== opened.mode
        || after.nlink !== opened.nlink || after.size !== opened.size || bytes.byteLength !== opened.size) {
        refuse("WORK_COMPLETION_CANDIDATE_FILE_UNSAFE", "Candidate input changed while it was read.", exitCodes.CONTAINMENT_REFUSAL);
      }
    } finally { closeSync(descriptor); }
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maximumInputBytes) refuse("WORK_COMPLETION_INPUT_SIZE_INVALID", "Input must be non-empty and at most four MiB.");
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { refuse("WORK_COMPLETION_INPUT_UTF8_INVALID", "Input must be valid UTF-8."); }
  return bytes;
}

function parseJsonInput(root: string, path: string, stdinState: { value?: Buffer }): unknown {
  try { return JSON.parse(readBoundedInput(root, path, stdinState).toString("utf8")); }
  catch (error) {
    if (error instanceof UsfError) throw error;
    return refuse("WORK_COMPLETION_INPUT_JSON_INVALID", "Input must be valid JSON.");
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function writeAllAndVerify(descriptor: number, bytes: string | Buffer): void {
  const expected = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  let written = 0;
  while (written < expected.length) {
    const count = writeSync(descriptor, expected, written, expected.length - written, null);
    if (count <= 0) refuse("WORK_COMPLETION_WRITE_INCOMPLETE", "A temporary publication made no write progress.", exitCodes.CONTAINMENT_REFUSAL);
    written += count;
  }
  fsyncSync(descriptor);
  const observed = Buffer.alloc(expected.length);
  let read = 0;
  while (read < observed.length) {
    const count = readSync(descriptor, observed, read, observed.length - read, read);
    if (count <= 0) refuse("WORK_COMPLETION_WRITE_MISMATCH", "A temporary publication could not be read back exactly.", exitCodes.CONTAINMENT_REFUSAL);
    read += count;
  }
  if (!observed.equals(expected)) refuse("WORK_COMPLETION_WRITE_MISMATCH", "A temporary publication failed exact readback.", exitCodes.CONTAINMENT_REFUSAL);
}

let atomicOrdinal = 0;
function temporaryPath(path: string): string {
  atomicOrdinal += 1;
  return resolve(dirname(path), `.${basename(path)}.usf-work-completion-${process.pid}-${atomicOrdinal}`);
}

function atomicWrite(path: string, bytes: string | Buffer, mode: number): void {
  const temporary = temporaryPath(path);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, mode);
    writeAllAndVerify(descriptor, bytes);
    closeSync(descriptor); descriptor = undefined;
    chmodSync(temporary, mode);
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) { unlinkSync(temporary); fsyncDirectory(dirname(path)); }
  }
}

function atomicCreate(path: string, bytes: string, mode: number): void {
  const temporary = temporaryPath(path);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, mode);
    writeAllAndVerify(descriptor, bytes);
    closeSync(descriptor); descriptor = undefined;
    chmodSync(temporary, mode);
    linkSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) { unlinkSync(temporary); fsyncDirectory(dirname(path)); }
  }
}

function persistCandidate(root: string, path: string | undefined, value: unknown): void {
  if (path === undefined || path === "-") return;
  const absolute = containedCandidatePath(root, path, true);
  atomicWrite(absolute, `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`, 0o600);
  containedCandidatePath(root, path, false);
}

function validateSchema<T>(root: string, repositoryPath: string, value: unknown): value is T {
  try {
    const schema = JSON.parse(readFileSync(resolve(root, repositoryPath), "utf8")) as unknown;
    return createJsonSchemaValidator<T>(schema).validate(value).valid;
  } catch {
    return false;
  }
}

function exactPacket(graph: LoadedSemanticGraph, profile: string, workIri: string): WorkPacket {
  const result = deriveWork(graph, { profile, selector: workIri, maxItems: 1 });
  if (result.status !== "ok" || result.items?.length !== 1 || result.items[0]?.id !== workIri
    || result.items[0].realisationBasis === undefined) {
    refuse("WORK_COMPLETION_WORK_PROJECTION_INVALID", "The exact current work projection could not be derived.", exitCodes.CURRENTNESS_FAILURE, { reasonCode: result.reasonCode, workIri });
  }
  return result.items[0];
}

function selectedProfileVersion(packet: WorkPacket): string {
  if (packet.decisionBoundary.kind !== "realisation-profile" || packet.decisionBoundary.profileVersion === undefined) {
    refuse("WORK_COMPLETION_PROFILE_INVALID", "The selected work is not bound to an explicit versioned profile.", exitCodes.CURRENTNESS_FAILURE);
  }
  return packet.decisionBoundary.profileVersion;
}

async function validationReceiptState(
  root: string,
  packet: WorkPacket,
  workspace: AuthenticatedNoChangeWorkspace,
  readReceipt: typeof readGraphDerivedCheckReceipt = readGraphDerivedCheckReceipt,
): Promise<{ readonly obligations: readonly string[]; readonly references: readonly CompletionValidationReference[]; readonly missing: readonly string[] }> {
  const obligations = [...(packet.realisationAuthority?.completionValidationObligations ?? [])].sort();
  if (obligations.length === 0) refuse("WORK_COMPLETION_VALIDATIONS_MISSING", "The selected work has no completion validation obligations.", exitCodes.CURRENTNESS_FAILURE);
  const references: CompletionValidationReference[] = [];
  const missing: string[] = [];
  for (const obligationIri of obligations) {
    const loaded = await readReceipt(root, workspace.candidateDigest, obligationIri);
    if (loaded === null) {
      missing.push(obligationIri);
      continue;
    }
    const receipt: CheckedCandidateReceipt = loaded.receipt;
    if (receipt.workIri !== packet.id || receipt.explicitProfileIri !== packet.decisionBoundary.root
      || receipt.originalConstructionBasisDigest !== workspace.constructionBasis.basisDigest
      || receipt.scopedDependencyDigest !== workspace.constructionBasis.work.scopedDependencyDigest
      || receipt.candidateDigest !== workspace.candidateDigest
      || receipt.workspaceIdentityDigest !== workspace.workspaceIdentityDigest
      || receipt.lineageDigest !== workspace.lineageDigest
      || receipt.byteDeltaDigest !== workspace.byteDeltaDigest
      || receipt.fileModeDigest !== workspace.fileModeDigest
      || receipt.candidateTreeDigest !== workspace.candidateTreeDigest
      || receipt.writeSetDigest !== workspace.writeSetDigest
      || receipt.validationObligationIri !== obligationIri) {
      refuse("WORK_COMPLETION_CHECK_RECEIPT_STALE", "A required check receipt does not bind the exact current no-change workspace.", exitCodes.CURRENTNESS_FAILURE, { obligationIri });
    }
    references.push(Object.freeze({
      obligationIri,
      receiptPath: loaded.receiptPath,
      receiptDigest: receipt.receiptDigest,
      validationResultSetDigest: receipt.validationResultSetDigest,
    }));
  }
  return Object.freeze({ obligations: Object.freeze(obligations), references: Object.freeze(references), missing: Object.freeze(missing) });
}

async function validationReferences(
  root: string,
  packet: WorkPacket,
  workspace: AuthenticatedNoChangeWorkspace,
): Promise<readonly CompletionValidationReference[]> {
  const state = await validationReceiptState(root, packet, workspace);
  if (state.missing.length !== 0) refuse("WORK_COMPLETION_CHECK_RECEIPT_MISSING", "A required graph-derived check receipt is absent.", exitCodes.CURRENTNESS_FAILURE, { obligationIri: state.missing[0] });
  return state.references;
}

async function deriveEvidence(
  root: string,
  graph: LoadedSemanticGraph,
  packet: WorkPacket,
  candidateDigest: string,
): Promise<CompletionEvidenceCandidate> {
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  const workspace = await authenticateNoChangeWorkspace(root, candidateDigest);
  if (workspace.constructionBasis.basisDigest !== packet.realisationBasis?.basisDigest
    || canonicalJson(workspace.policy) !== canonicalJson(authority.policy)) {
    refuse("WORK_COMPLETION_WORKSPACE_STALE", "The no-change workspace no longer matches current scoped authority.", exitCodes.CURRENTNESS_FAILURE);
  }
  const references = await validationReferences(root, packet, workspace);
  const evidence = createCompletionEvidenceCandidate(graph, packet, workspace, references);
  validateCompletionEvidenceShape(evidence);
  if (!validateSchema<CompletionEvidenceCandidate>(root, authority.evidenceSchemaPath, evidence)) {
    refuse("WORK_COMPLETION_EVIDENCE_SCHEMA_INVALID", "Derived completion evidence failed its closed graph-selected schema.", exitCodes.CURRENTNESS_FAILURE);
  }
  return evidence;
}

async function authenticateEvidence(
  root: string,
  graph: LoadedSemanticGraph,
  profile: string,
  value: unknown,
): Promise<{ evidence: CompletionEvidenceCandidate; packet: WorkPacket }> {
  validateCompletionEvidenceShape(value);
  const evidence = value as CompletionEvidenceCandidate;
  const packet = exactPacket(graph, profile, evidence.workIri);
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  if (!validateSchema<CompletionEvidenceCandidate>(root, authority.evidenceSchemaPath, value)) {
    refuse("WORK_COMPLETION_EVIDENCE_SCHEMA_INVALID", "Completion evidence does not satisfy the closed graph-selected schema.");
  }
  const expected = await deriveEvidence(root, graph, packet, evidence.candidateDigest);
  if (canonicalJson(expected, { rejectAbsolutePaths: true }) !== canonicalJson(evidence, { rejectAbsolutePaths: true })) {
    refuse("WORK_COMPLETION_EVIDENCE_NOT_CURRENT", "Completion evidence no longer matches its scoped authority basis.", exitCodes.CURRENTNESS_FAILURE);
  }
  return { evidence, packet };
}

async function authenticateBundle(
  root: string,
  graph: LoadedSemanticGraph,
  profile: string,
  value: unknown,
): Promise<{ bundle: CompletionProofBundle; packet: WorkPacket }> {
  validateCompletionBundleShape(value);
  const bundle = value as CompletionProofBundle;
  const { evidence, packet } = await authenticateEvidence(root, graph, profile, bundle.evidence);
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  if (!validateSchema<CompletionProofBundle>(root, authority.proofBundleSchemaPath, value)) {
    refuse("WORK_COMPLETION_BUNDLE_SCHEMA_INVALID", "Completion proof bundle does not satisfy the closed graph-selected schema.");
  }
  const expected = createCompletionProofBundle(graph, packet, evidence, bundle.proof.obligationIri);
  if (canonicalJson(expected, { rejectAbsolutePaths: true }) !== canonicalJson(bundle, { rejectAbsolutePaths: true })) {
    refuse("WORK_COMPLETION_BUNDLE_NOT_CURRENT", "Completion proof bundle no longer matches its scoped authority basis.", exitCodes.CURRENTNESS_FAILURE);
  }
  return { bundle, packet };
}

async function realiseNoChange(root: string, request: RealiseRequest): Promise<Record<string, unknown>> {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const packet = exactPacket(graph, request.profile, request.work);
  const basis = packet.realisationBasis;
  if (basis === undefined) refuse("WORK_COMPLETION_BASIS_MISSING", "The selected work has no realisation basis.", exitCodes.CURRENTNESS_FAILURE);
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  const candidate = await materialiseNoChangeCandidate(root, basis, authority.policy);
  const result = Object.freeze({
    schema: "urn:usf:no-change-realisation-result:1" as const,
    status: "ready-for-validation" as const,
    stage: "realisation" as const,
    disposition: "no-change-candidate" as const,
    workIri: packet.id,
    profileIri: request.profile,
    manifestPath: request.manifestPath,
    realisationBasisDigest: basis.basisDigest,
    scopedDependencyDigest: basis.work.scopedDependencyDigest,
    candidateDigest: candidate.candidateDigest,
    workspacePath: candidate.workspacePath,
    policyIri: authority.policy.iri,
    policyDigest: authority.policy.resourceDigest,
    algorithmIri: authority.policy.algorithmIri,
    algorithmDigest: authority.policy.algorithmResourceDigest,
    validationObligations: Object.freeze([...(packet.realisationAuthority?.completionValidationObligations ?? [])].sort()),
    nonClaims: workCompletionNonClaims,
  });
  if (!validateSchema(root, authority.realisationResultSchemaPath, result)) {
    refuse("WORK_COMPLETION_REALISATION_RESULT_INVALID", "No-change realisation result failed its closed schema.", exitCodes.CURRENTNESS_FAILURE);
  }
  return result;
}

export async function realiseNoChangeWork(root: string, request: unknown): Promise<Record<string, unknown>> {
  try { return await realiseNoChange(root, parseNoChangeWorkRequest(request)); }
  catch (error) { return asUsfError(error, "WORK_COMPLETION_REALISATION_REFUSED"); }
}


/** Derive and authenticate the complete graph-required receipt set without accepting completion. */
export async function prepareCompletionChecks(root: string, request: unknown): Promise<Record<string, unknown>> {
  try {
    const selected = parseNoChangeWorkRequest(request);
    const repositoryRoot = realpathSync(resolve(root));
    const selection = () => {
      const graph = loadSemanticGraph(repositoryRoot, selected.manifestPath);
      const packet = exactPacket(graph, selected.profile, selected.work);
      const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
      const dependencies = workCompletionAuthorityDependencies(graph, authority);
      return { packet, authority, dependencies };
    };
    const initial = selection();
    const basis = initial.packet.realisationBasis;
    if (basis === undefined) refuse("WORK_COMPLETION_BASIS_MISSING", "The selected work has no realisation basis.", exitCodes.CURRENTNESS_FAILURE);
    const candidateDigest = await deriveNoChangeCandidateIdentity(repositoryRoot, basis, initial.authority.policy);
    const assertCurrent = () => {
      const current = selection();
      if (canonicalJson(current.packet.realisationBasis) !== canonicalJson(initial.packet.realisationBasis)
        || canonicalJson(current.authority) !== canonicalJson(initial.authority)
        || canonicalJson(current.dependencies) !== canonicalJson(initial.dependencies)
        || canonicalJson(current.packet.realisationAuthority?.completionValidationObligations)
          !== canonicalJson(initial.packet.realisationAuthority?.completionValidationObligations)) {
        refuse("WORK_COMPLETION_CHECK_SET_STALE", "Selected check-set authority changed during authentication.", exitCodes.CURRENTNESS_FAILURE);
      }
    };
    const readState = () => withAuthenticatedNoChangeWorkspaceForCheckRecovery(repositoryRoot, candidateDigest, async (workspace) => {
      assertCurrent();
      if (workspace.constructionBasis.basisDigest !== basis.basisDigest
        || canonicalJson(workspace.policy) !== canonicalJson(initial.authority.policy)) {
        refuse("WORK_COMPLETION_WORKSPACE_STALE", "The no-change workspace no longer matches current scoped authority.", exitCodes.CURRENTNESS_FAILURE);
      }
      const state = await validationReceiptState(repositoryRoot, initial.packet, workspace, readGraphDerivedCheckReceiptForRecovery);
      const reconciliations: string[] = [];
      for (const obligationIri of state.obligations) {
        if (await authenticateGraphDerivedCheckIntent(repositoryRoot, candidateDigest, obligationIri) === "STARTED") reconciliations.push(obligationIri);
      }
      assertCurrent();
      return Object.freeze({ ...state, reconciliations: Object.freeze(reconciliations) });
    });
    const before = await readState();
    const ensureMember = async (obligationIri: string) => {
      // Authenticate the entire retained denominator before requesting any effect.
      await readState();
      const checked = await ensureGraphDerivedCheck(repositoryRoot, candidateDigest, obligationIri);
      if (checked.status !== "pass") {
        refuse(checked.reasonCode, "A required graph-derived check refused; no complete set is acknowledged.", exitCodes.CURRENTNESS_FAILURE, { obligationIri });
      }
      await readState();
    };
    for (const obligationIri of before.reconciliations) await ensureMember(obligationIri);
    for (const obligationIri of (await readState()).missing) await ensureMember(obligationIri);
    const after = await readState();
    if (after.reconciliations.length !== 0) refuse("WORK_COMPLETION_CHECK_SET_STALE", "Required intent state changed and still needs reconciliation; no complete set is acknowledged.", exitCodes.CURRENTNESS_FAILURE);
    if (after.missing.length !== 0) refuse("WORK_COMPLETION_CHECK_RECEIPT_MISSING", "The required check receipt set is incomplete.", exitCodes.CURRENTNESS_FAILURE, { obligationIri: after.missing[0] });
    const draft = {
      schema: "urn:usf:schema:completion-check-receipt-set-result:1" as const,
      status: "current" as const,
      workIri: initial.packet.id,
      profileIri: selected.profile,
      candidateDigest,
      constructionBasisDigest: basis.basisDigest,
      validationObligations: after.obligations,
      receipts: after.references,
      nonClaims: Object.freeze(["completion", "parallel-safety", "partial-set-recovery", "terminal-closure"]),
    };
    return Object.freeze({ ...draft, receiptSetDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) });
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_CHECK_SET_REFUSED"); }
}

export interface CompletionEvidencePreparationRequest {
  readonly work: string;
  readonly profile: string;
  readonly manifestPath: string;
  readonly candidateDigest: string;
}

/** Authenticate a current evidence candidate without persisting or publishing it. */
export async function prepareCompletionEvidence(root: string, request: CompletionEvidencePreparationRequest): Promise<CompletionEvidenceCandidate> {
  try {
    const keys = ["candidateDigest", "manifestPath", "profile", "work"];
    if (request === null || typeof request !== "object" || Array.isArray(request)
      || Reflect.ownKeys(request).length !== keys.length
      || keys.some(key => {
        const property = Object.getOwnPropertyDescriptor(request, key);
        return property === undefined || !("value" in property) || typeof property.value !== "string"
          || property.value.length === 0 || property.value.length > 4096;
      })) {
      refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Evidence preparation requires only work, profile, manifestPath and candidateDigest.");
    }
    const selected = Object.freeze({ work: request.work, profile: request.profile, manifestPath: request.manifestPath, candidateDigest: request.candidateDigest });
    if (!digestPattern.test(selected.candidateDigest) || !iriPattern.test(selected.work)) {
      refuse("WORK_COMPLETION_IDENTITY_INVALID", "Candidate and work identities are invalid.");
    }
    assertSelection(selected.profile, selected.manifestPath);
    const repositoryRoot = realpathSync(resolve(root));
    const graph = loadSemanticGraph(repositoryRoot, selected.manifestPath);
    const packet = exactPacket(graph, selected.profile, selected.work);
    const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
    const dependencies = workCompletionAuthorityDependencies(graph, authority);
    const evidence = await deriveEvidence(repositoryRoot, graph, packet, selected.candidateDigest);
    // Awaited workspace/check authentication must not carry a stale selection into output.
    const currentGraph = loadSemanticGraph(repositoryRoot, selected.manifestPath);
    const currentPacket = exactPacket(currentGraph, selected.profile, selected.work);
    const currentAuthority = deriveNoChangeCompletionAuthority(currentGraph, currentPacket.id);
    if (canonicalJson(packet.realisationBasis) !== canonicalJson(currentPacket.realisationBasis)
      || canonicalJson(authority) !== canonicalJson(currentAuthority)
      || canonicalJson(dependencies) !== canonicalJson(workCompletionAuthorityDependencies(currentGraph, currentAuthority))) {
      refuse("WORK_COMPLETION_EVIDENCE_NOT_CURRENT", "Evidence preparation authority changed during authentication.", exitCodes.CURRENTNESS_FAILURE);
    }
    return evidence;
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_EVIDENCE_REFUSED"); }
}

async function produceProof(root: string, request: ProofRequest, value: unknown): Promise<CompletionProofBundle> {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const { evidence, packet } = await authenticateEvidence(root, graph, request.profile, value);
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  const bundle = createCompletionProofBundle(graph, packet, evidence, request.obligation);
  validateCompletionBundleShape(bundle);
  if (!validateSchema<CompletionProofBundle>(root, authority.proofBundleSchemaPath, bundle)) {
    refuse("WORK_COMPLETION_PROOF_SCHEMA_INVALID", "Derived completion proof failed its closed graph-selected schema.", exitCodes.CURRENTNESS_FAILURE);
  }
  return bundle;
}

function publicationReceiptPath(root: string, repositoryPath: string, createParent: boolean): string {
  if (!receiptPathPattern.test(repositoryPath)) refuse("WORK_COMPLETION_RECEIPT_PATH_INVALID", "Completion receipts must use the exact tracked publication root.", exitCodes.CONTAINMENT_REFUSAL);
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, repositoryPath);
  const relation = relative(canonicalRoot, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("WORK_COMPLETION_RECEIPT_PATH_ESCAPE", "Completion receipt path escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  let cursor = canonicalRoot;
  for (const segment of dirname(repositoryPath).split("/")) {
    const parent = cursor;
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      if (!createParent) return absolute;
      mkdirSync(cursor, { mode: 0o755 });
      chmodSync(cursor, 0o755);
      fsyncDirectory(parent);
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o002) !== 0 || realpathSync(cursor) !== cursor) {
      refuse("WORK_COMPLETION_RECEIPT_PATH_UNSAFE", "Completion receipt ancestry is not owner-contained.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
  if (existsSync(absolute)) {
    const entry = lstatSync(absolute);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o777) !== 0o644 || entry.size > maximumInputBytes || realpathSync(absolute) !== absolute) {
      refuse("WORK_COMPLETION_RECEIPT_FILE_UNSAFE", "Completion receipt is not an exact owner-contained regular file.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
  return absolute;
}

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sourcePostimage(sourceBefore: string, lines: readonly string[]): string {
  if (!sourceBefore.endsWith("\n") || sourceBefore.includes("\r")) {
    refuse("WORK_COMPLETION_SOURCE_NONCANONICAL", "The semantic source preimage is not canonical.", exitCodes.CURRENTNESS_FAILURE);
  }
  return `${sourceBefore}${lines.join("\n")}\n`;
}

function copyCandidateRepository(root: string): string {
  assertPrivateDirectory(root, ".usf", true);
  const temporaryRoot = assertPrivateDirectory(root, ".usf/tmp", true);
  const candidate = mkdtempSync(resolve(temporaryRoot, "work-completion-"));
  chmodSync(candidate, 0o700);
  const canonicalRoot = realpathSync(resolve(root));
  const copyTree = (source: string, target: string, depth: number): void => {
    for (const entryName of readdirSync(source).sort()) {
      if (depth === 0 && [".git", ".usf", "node_modules"].includes(entryName)) continue;
      const sourceEntry = resolve(source, entryName);
      const targetEntry = resolve(target, entryName);
      const status = lstatSync(sourceEntry);
      if (status.isSymbolicLink()) refuse("WORK_COMPLETION_CANDIDATE_COPY_SYMLINK", "Candidate validation refuses repository symlinks.", exitCodes.CONTAINMENT_REFUSAL);
      if (status.isDirectory()) {
        mkdirSync(targetEntry, { mode: status.mode & 0o777 });
        copyTree(sourceEntry, targetEntry, depth + 1);
      } else if (status.isFile()) {
        copyFileSync(sourceEntry, targetEntry);
        chmodSync(targetEntry, status.mode & 0o777);
      } else {
        refuse("WORK_COMPLETION_CANDIDATE_COPY_SPECIAL_FILE", "Candidate validation refuses special files.", exitCodes.CONTAINMENT_REFUSAL);
      }
    }
  };
  copyTree(canonicalRoot, candidate, 0);
  return candidate;
}

function receiptWithoutDigest(receipt: WorkCompletionPublicationReceipt): Record<string, unknown> {
  const { receiptDigest: _ignored, ...draft } = receipt;
  return draft;
}

function authenticateExistingReceipt(
  root: string,
  path: string,
  expectedIntent: string,
  expectedMembers: readonly WorkCompletionPublicationMember[],
  expectedOperations: readonly WorkCompletionPublicationOperation[],
  authority: NoChangeCompletionAuthority,
): WorkCompletionPublicationReceipt {
  const absolute = publicationReceiptPath(root, path, false);
  let bytes: Buffer;
  let value: unknown;
  let descriptor: number | undefined;
  try {
    const named = lstatSync(absolute);
    descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
      || opened.mode !== named.mode || opened.nlink !== 1 || opened.size !== named.size || opened.size > maximumInputBytes) {
      refuse("WORK_COMPLETION_RECEIPT_FILE_UNSAFE", "Existing completion receipt changed while it was opened.", exitCodes.CONTAINMENT_REFUSAL);
    }
    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.uid !== opened.uid || after.mode !== opened.mode
      || after.nlink !== opened.nlink || after.size !== opened.size || bytes.byteLength !== opened.size) {
      refuse("WORK_COMPLETION_RECEIPT_FILE_UNSAFE", "Existing completion receipt changed while it was read.", exitCodes.CONTAINMENT_REFUSAL);
    }
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof UsfError) throw error;
    return refuse("WORK_COMPLETION_RECEIPT_INVALID", "Existing completion receipt is unreadable or invalid JSON.", exitCodes.CURRENTNESS_FAILURE);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
  if (!validateWorkCompletionReceiptShape(root, value, authority)) refuse("WORK_COMPLETION_RECEIPT_SCHEMA_INVALID", "Existing completion receipt failed its closed schema.", exitCodes.CURRENTNESS_FAILURE);
  const receipt = value as WorkCompletionPublicationReceipt;
  const expectedValidationDigest = canonicalDigest({
    members: receipt.members.map(({ workIri, realisationDigest, evidenceDigest, proofDigest }) => ({ workIri, realisationDigest, evidenceDigest, proofDigest })),
    operationCount: receipt.operations.length,
    authorityDependencyDigest: receipt.authorityDependencyDigest,
    resultingSemanticDigest: receipt.resultingSemanticDigest,
  }, { rejectAbsolutePaths: true });
  if (`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n` !== bytes.toString("utf8")
    || canonicalDigest(receiptWithoutDigest(receipt), { rejectAbsolutePaths: true }) !== receipt.receiptDigest
    || receipt.publicationIntentDigest !== expectedIntent || receipt.publicationReceiptPath !== path
    || receipt.memberCount !== receipt.members.length
    || canonicalJson(receipt.members) !== canonicalJson(expectedMembers)
    || canonicalJson(receipt.operations) !== canonicalJson(expectedOperations)
    || canonicalDigest(receipt.authorityDependencies, { rejectAbsolutePaths: true }) !== receipt.authorityDependencyDigest
    || canonicalDigest(receipt.operations, { rejectAbsolutePaths: true }) !== receipt.deltaDigest
    || receipt.validationResultDigest !== expectedValidationDigest) {
    refuse("WORK_COMPLETION_RECEIPT_MISMATCH", "Existing completion receipt does not authenticate the exact requested publication.", exitCodes.INTEGRATION_CONFLICT);
  }
  return receipt;
}

function validateCandidateRepository(
  root: string,
  sourceAfter: string,
  receipt: WorkCompletionPublicationReceipt,
  affectedWorks: readonly string[],
  profile: string,
  authority: NoChangeCompletionAuthority,
): string {
  const candidate = copyCandidateRepository(root);
  try {
    const sourceAbsolute = resolve(candidate, authority.sourcePath);
    atomicWrite(sourceAbsolute, sourceAfter, statSync(sourceAbsolute).mode & 0o777);
    const receiptAbsolute = publicationReceiptPath(candidate, receipt.publicationReceiptPath, true);
    atomicCreate(receiptAbsolute, `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`, 0o644);
    const graph = loadSemanticGraph(candidate, authority.manifestPath);
    const full = deriveWork(graph, { profile, maxItems: 100 });
    if (full.status !== "ok") refuse("WORK_COMPLETION_CANDIDATE_GRAPH_INVALID", "The complete candidate graph projection refused.", exitCodes.CURRENTNESS_FAILURE, { reasonCode: full.reasonCode });
    for (const workIri of affectedWorks) {
      const result = deriveWork(graph, { profile, selector: workIri, maxItems: 1 });
      const packet = result.status === "ok" ? result.items?.[0] : undefined;
      if (packet?.realisationStage?.stage !== "verified-complete" || packet.realisationStage.completion.verified !== true) {
        refuse("WORK_COMPLETION_CANDIDATE_READBACK_INVALID", "The candidate publication did not establish exact current completion.", exitCodes.CURRENTNESS_FAILURE, { workIri, reasonCodes: packet?.realisationStage?.completion.reasonCodes });
      }
    }
    return graph.semanticDigest;
  } finally {
    rmSync(candidate, { recursive: true, force: true });
  }
}

async function preparePublication(
  root: string,
  request: PublishRequest,
  values: readonly unknown[],
  candidateValidation: boolean,
): Promise<PreparedPublication> {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const authenticated = (await Promise.all(values.map((value) => authenticateBundle(root, graph, request.profile, value))))
    .sort((left, right) => utf8Compare(left.bundle.evidence.workIri, right.bundle.evidence.workIri));
  if (new Set(authenticated.map(({ bundle }) => bundle.evidence.workIri)).size !== authenticated.length) {
    refuse("WORK_COMPLETION_BUNDLE_WORK_DUPLICATE", "A completion batch cannot repeat a work.");
  }
  const profileVersions = new Set(authenticated.map(({ packet }) => selectedProfileVersion(packet)));
  if (profileVersions.size !== 1) refuse("WORK_COMPLETION_PROFILE_VERSION_MIXED", "A completion batch must bind one profile version.", exitCodes.CURRENTNESS_FAILURE);
  const workSet = new Set(authenticated.map(({ bundle }) => bundle.evidence.workIri));
  for (const workIri of workSet) {
    const dependencies = objectValues(graph, workIri, predicate("dependsOn"));
    if (dependencies.some((dependency) => workSet.has(dependency))) {
      refuse("WORK_COMPLETION_DEPENDENT_COHORT_REFUSED", "A completion batch cannot contain a semantic dependency edge between members.", exitCodes.CURRENTNESS_FAILURE);
    }
  }
  const authorities = authenticated.map(({ packet }) => deriveNoChangeCompletionAuthority(graph, packet.id));
  if (authorities.length === 0 || authorities.some((authority) => canonicalJson(authority) !== canonicalJson(authorities[0]))) {
    refuse("WORK_COMPLETION_AUTHORITY_MIXED", "A completion batch must share one exact publication authority.", exitCodes.CURRENTNESS_FAILURE);
  }
  const authority = authorities[0] as NoChangeCompletionAuthority;
  const bundles = authenticated.map(({ bundle }) => bundle);
  const intentDigest = completionPublicationIntentDigest(bundles, request.profile, request.manifestPath, authority);
  const records = bundles.map((bundle) => workCompletionRecordLines(bundle, authority, intentDigest));
  const members: WorkCompletionPublicationMember[] = records.map(({ member }, index) => Object.freeze({ ordinal: index + 1, ...member }));
  const identitySets = [
    members.map(({ realisationReceiptIri }) => realisationReceiptIri),
    members.map(({ evidenceIri }) => evidenceIri),
    members.map(({ proofResultIri }) => proofResultIri),
  ];
  if (identitySets.some((identities) => new Set(identities).size !== identities.length)) {
    refuse("WORK_COMPLETION_PUBLICATION_IDENTITY_DUPLICATE", "A completion batch contains duplicate semantic identities.");
  }
  const recordLines = records.flatMap(({ lines }) => lines).sort();
  if (new Set(recordLines).size !== recordLines.length) refuse("WORK_COMPLETION_PUBLICATION_LINE_DUPLICATE", "A completion batch produced duplicate graph lines.");
  parseStrictNQuads(`${recordLines.join("\n")}\n`, authority.targetGraphIri, 4_096);
  const operations: WorkCompletionPublicationOperation[] = recordLines.map((line, index) => Object.freeze({ ordinal: index + 1, kind: "add" as const, sourcePath: authority.sourcePath, line }));
  const sourceAbsolute = resolve(root, authority.sourcePath);
  const sourceBefore = readFileSync(sourceAbsolute, "utf8");
  const currentLines = new Set(sourceBefore.split("\n").filter((line) => line.length > 0));
  const present = recordLines.filter((line) => currentLines.has(line)).length;
  const receiptPath = `${authority.receiptRoot}${intentDigest.slice("sha256:".length)}.json`;
  const receiptExists = existsSync(publicationReceiptPath(root, receiptPath, false));
  if ((present > 0 && present < recordLines.length) || (present === 0 && receiptExists) || (present === recordLines.length && !receiptExists)) {
    refuse("WORK_COMPLETION_PUBLICATION_PARTIAL_STATE", "Completion publication state is partial or conflicting.", exitCodes.INTEGRATION_CONFLICT);
  }
  if (present === recordLines.length) {
    const receipt = authenticateExistingReceipt(root, receiptPath, intentDigest, members, operations, authority);
    for (const { bundle } of authenticated) {
      const result = deriveWork(graph, { profile: request.profile, selector: bundle.evidence.workIri, maxItems: 1 });
      const packet = result.status === "ok" ? result.items?.[0] : undefined;
      if (packet?.realisationStage?.stage !== "verified-complete" || packet.realisationStage.completion.verified !== true) {
        refuse("WORK_COMPLETION_PUBLICATION_MATCHING_READBACK_INVALID", "Existing completion authority did not authenticate on readback.", exitCodes.CURRENTNESS_FAILURE);
      }
    }
    return Object.freeze({ graph, authority, receipt, receiptBytes: `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`, sourceBefore, sourceAfter: sourceBefore, recordLines: Object.freeze(recordLines), state: "matching" as const, affectedWorks: Object.freeze([...workSet]) });
  }

  const sourceAfter = sourcePostimage(sourceBefore, recordLines);
  const temporary = copyCandidateRepository(root);
  let resultingSemanticDigest: string;
  try {
    const candidateSource = resolve(temporary, authority.sourcePath);
    atomicWrite(candidateSource, sourceAfter, statSync(candidateSource).mode & 0o777);
    resultingSemanticDigest = loadSemanticGraph(temporary, request.manifestPath).semanticDigest;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  const firstPacket = authenticated[0]?.packet;
  if (firstPacket?.realisationBasis === undefined) refuse("WORK_COMPLETION_BASIS_MISSING", "Publication basis is absent.", exitCodes.CURRENTNESS_FAILURE);
  const receipt = createWorkCompletionPublicationReceipt({
    authority,
    publicationIntentDigest: intentDigest,
    profileIri: request.profile,
    profileVersion: selectedProfileVersion(firstPacket),
    manifestPath: request.manifestPath,
    manifestDigest: firstPacket.realisationBasis.selection.manifestDigest,
    authorityDependencies: workCompletionAuthorityDependencies(graph, authority),
    baseSourceDigest: sha256(Buffer.from(sourceBefore, "utf8")),
    resultingSourceDigest: sha256(Buffer.from(sourceAfter, "utf8")),
    baseSemanticDigest: graph.semanticDigest,
    resultingSemanticDigest,
    members,
    operations,
  });
  if (!validateWorkCompletionReceiptShape(root, receipt, authority)) refuse("WORK_COMPLETION_RECEIPT_SCHEMA_INVALID", "Prepared completion receipt failed its closed schema.", exitCodes.CURRENTNESS_FAILURE);
  const receiptBytes = `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`;
  if (candidateValidation) {
    const validatedDigest = validateCandidateRepository(root, sourceAfter, receipt, [...workSet], request.profile, authority);
    if (validatedDigest !== resultingSemanticDigest) refuse("WORK_COMPLETION_CANDIDATE_SEMANTIC_DIGEST_MISMATCH", "Candidate semantic digest changed during validation.", exitCodes.CURRENTNESS_FAILURE);
  }
  return Object.freeze({ graph, authority, receipt, receiptBytes, sourceBefore, sourceAfter, recordLines: Object.freeze(recordLines), state: "absent" as const, affectedWorks: Object.freeze([...workSet]) });
}

function publicationResult(
  root: string,
  mode: "verify" | "apply",
  state: "absent" | "matching" | "created",
  receipt: WorkCompletionPublicationReceipt,
  authority: NoChangeCompletionAuthority,
): Record<string, unknown> {
  const result = Object.freeze({
    schema: authority.publicationResultRecordSchema,
    status: "verified" as const,
    mode,
    publicationState: state,
    profileIri: receipt.profileIri,
    manifestPath: receipt.manifestPath,
    memberCount: receipt.memberCount,
    works: Object.freeze(receipt.members.map(({ workIri }) => workIri)),
    publicationIntentDigest: receipt.publicationIntentDigest,
    publicationReceiptPath: receipt.publicationReceiptPath,
    receiptDigest: receipt.receiptDigest,
    resultingSemanticDigest: receipt.resultingSemanticDigest,
    nonClaims: workCompletionNonClaims,
  });
  if (!validateSchema(root, authority.publicationResultSchemaPath, result)) {
    refuse("WORK_COMPLETION_PUBLICATION_RESULT_INVALID", "Completion publication result failed its closed schema.", exitCodes.CURRENTNESS_FAILURE);
  }
  return result;
}

async function publishCompletion(root: string, request: PublishRequest, values: readonly unknown[]): Promise<Record<string, unknown>> {
  const prepared = await preparePublication(root, request, values, true);
  if (request.mode === "verify") return publicationResult(root, "verify", prepared.state, prepared.receipt, prepared.authority);
  const lock = await acquirePrimaryMutationLock(root);
  try {
    const locked = await preparePublication(root, request, values, false);
    if (locked.state === "matching") return publicationResult(root, "apply", "matching", locked.receipt, locked.authority);
    if (locked.receipt.receiptDigest !== prepared.receipt.receiptDigest
      || locked.sourceBefore !== prepared.sourceBefore || locked.sourceAfter !== prepared.sourceAfter) {
      refuse("WORK_COMPLETION_PUBLICATION_CURRENTNESS_CHANGED", "Completion publication currentness changed while waiting for the mutation lock.", exitCodes.INTEGRATION_CONFLICT);
    }
    const sourceAbsolute = resolve(root, locked.authority.sourcePath);
    const receiptAbsolute = publicationReceiptPath(root, locked.receipt.publicationReceiptPath, true);
    if (readFileSync(sourceAbsolute, "utf8") !== locked.sourceBefore || existsSync(receiptAbsolute)) {
      refuse("WORK_COMPLETION_PUBLICATION_PREIMAGE_CHANGED", "Completion publication preimage changed under lock.", exitCodes.INTEGRATION_CONFLICT);
    }
    const sourceMode = statSync(sourceAbsolute).mode & 0o777;
    let receiptCreated = false;
    try {
      atomicWrite(sourceAbsolute, locked.sourceAfter, sourceMode);
      atomicCreate(receiptAbsolute, locked.receiptBytes, 0o644);
      receiptCreated = true;
      const readback = await preparePublication(root, request, values, false);
      if (readback.state !== "matching" || readback.receipt.receiptDigest !== locked.receipt.receiptDigest) {
        refuse("WORK_COMPLETION_PUBLICATION_READBACK_INVALID", "Completion publication readback failed.", exitCodes.CURRENTNESS_FAILURE);
      }
      return publicationResult(root, "apply", "created", locked.receipt, locked.authority);
    } catch (error) {
      atomicWrite(sourceAbsolute, locked.sourceBefore, sourceMode);
      if (receiptCreated && existsSync(receiptAbsolute)) {
        unlinkSync(receiptAbsolute);
        fsyncDirectory(dirname(receiptAbsolute));
      }
      throw error;
    }
  } finally {
    await lock.handle.close();
  }
}

export const realiseCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  try {
    return { output: await realiseNoChangeWork(repositoryRoot, parseRealiseRequest(args)) };
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_REALISATION_REFUSED"); }
};

export const completionAwareEvidenceCommandHandler: CommandHandler = async (command): Promise<CommandResult> => {
  if (command.args[0] !== "completion") return evidenceCommandHandler(command);
  try {
    const request = parseEvidenceRequest(command.args);
    const evidence = await prepareCompletionEvidence(command.repositoryRoot, { work: request.work, profile: request.profile, manifestPath: request.manifestPath, candidateDigest: request.candidateDigest });
    persistCandidate(command.repositoryRoot, request.output, evidence);
    return { output: evidence };
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_EVIDENCE_REFUSED"); }
};

export const completionAwareProveCommandHandler: CommandHandler = async (command): Promise<CommandResult> => {
  if (command.args[0] !== "completion") return proveCommandHandler(command);
  try {
    const request = parseProofRequest(command.args);
    const evidence = parseJsonInput(command.repositoryRoot, request.evidencePath, {});
    const bundle = await produceProof(command.repositoryRoot, request, evidence);
    persistCandidate(command.repositoryRoot, request.output, bundle);
    return { output: bundle };
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_PROOF_REFUSED"); }
};

export const completionAwarePublishCommandHandler: CommandHandler = async (command: CommandRequest): Promise<CommandResult> => {
  if (command.args[0] !== "work-completion") return constructionAwarePublishCommandHandler(command);
  try {
    const request = parsePublishRequest(command.args);
    const stdinState: { value?: Buffer } = {};
    const values = request.bundlePaths.map((path) => parseJsonInput(command.repositoryRoot, path, stdinState));
    return { output: await publishCompletion(command.repositoryRoot, request, values) };
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_PUBLICATION_REFUSED"); }
};
