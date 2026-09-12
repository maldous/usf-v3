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
import { canonicalQuadDigest, parseStrictNQuads } from "../graph/nquads.ts";
import { deriveWork, evaluateCurrentNoChangeCompletion, type WorkPacket } from "../graph/work.ts";
import { deriveCliTerminalAssessment, deriveCliTransitionContext } from "../graph/cli-transitions.ts";
import { resolveContributions, type ResolvableContribution } from "../collaboration/resolve.ts";
import {
  authenticateNoChangeWorkspace,
  withAuthenticatedNoChangeWorkspace,
  inspectNoChangeWorkspace,
  inspectNoChangeWorkspaceState,
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
  type CompletionPublicationSnapshot,
  type NoChangeCompletionAuthority,
  type WorkCompletionPublicationMember,
  type WorkCompletionPublicationOperation,
  type WorkCompletionPublicationReceipt,
} from "../realisation/work-completion.ts";
import { acquirePrimaryMutationLock, inspectCandidateIntegrationRecovery, type CandidateIntegrationRecoveryInspection } from "../realisation/transition.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import { readGraphDerivedCheckReceipt, readGraphDerivedCheckReceiptAtAuthenticatedWorkspace, readGraphDerivedCheckReceiptForRecoveryAtAuthenticatedWorkspace, readGraphDerivedCheckFailureDiagnostic, ensureGraphDerivedCheck, executionIntentPresent, authenticateGraphDerivedCheckIntentAtAuthenticatedWorkspace, type CheckedCandidateReceipt } from "./check.ts";
import { parseCommandInput, readCommandInput } from "./command-input.ts";
import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "./construction-authority.ts";
import type { CommandHandler, CommandRequest, CommandResult } from "./dispatcher.ts";


const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const iriPattern = /^urn:[^<>\s]+$/u;
const candidatePathPattern = /^\.usf\/candidates\/work-completion\/[A-Za-z0-9._-]+\.json$/u;
const receiptPathPattern = /^evidence\/work-completion\/[0-9a-f]{64}\.json$/u;
const completionSeedPathPattern = /^\.usf\/receipts\/check\/[0-9a-f]{64}\/completion-validation-seed\.json$/u;
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

interface PublicationSnapshotBinding {
  readonly root: string;
  readonly schemaPath: string;
  readonly schemaPaths: readonly string[];
  readonly fragment: string;
}

interface PreparedPublicationSnapshot {
  readonly metadata: CompletionPublicationSnapshot;
  readonly bytes: ReadonlyMap<string, Buffer>;
}

// The key includes every graph-selected schema byte, so a changed dependency
// cannot reuse a validator compiled for an older authority closure.
const MAX_SNAPSHOT_VALIDATOR_CACHE_ENTRIES = 8;
const snapshotValidatorCache = new Map<string, ReturnType<typeof createJsonSchemaValidator>>();

export type NativePreflightFact = Readonly<{
  kind: "context" | "authority" | "basis" | "scope" | "candidate-identity" | "candidate-workspace" | "check-receipt" | "check-recovery" | "evidence" | "proof-bundle" | "publication-receipt" | "publication-snapshot" | "local-preimage" | "tool-source";
  identity: string;
  digest: string;
  current: true;
}>;

export type NativePreflightUnavailable = Readonly<{
  kind: NativePreflightFact["kind"];
  identity: string;
  state: "missing" | "stale" | "unsafe" | "mixed" | "recovery-required" | "unknown";
  reasonCode: string;
}>;

export type NativeOperationalPreflight = Readonly<{
  executionAuthority: "none";
  lockAvailability: "not-observed";
  operation: "no-change" | "checks" | "evidence" | "proof" | "publication";
  selection: Readonly<{ workIri: string; profileIri: string; manifestPath: string }> | null;
  facts: readonly NativePreflightFact[];
}> & (
  | Readonly<{ status: "authenticated"; unavailable: readonly [] }>
  | Readonly<{ status: "unavailable"; reasonCode: string; unavailable: readonly NativePreflightUnavailable[] }>
);

function refuse(code: string, message: string, exitCode: ExitCode = exitCodes.INVALID_INPUT, details?: Record<string, unknown>): never {
  throw new UsfError(code, exitCode, message, details);
}

function asUsfError(error: unknown, fallback: string, exitCode: ExitCode = exitCodes.CURRENTNESS_FAILURE): never {
  if (error instanceof UsfError) throw error;
  if (error !== null && typeof error === "object") {
    const candidate = error as { reasonCode?: unknown; details?: unknown };
    if (typeof candidate.reasonCode === "string" && /^[A-Z0-9_:-]+$/u.test(candidate.reasonCode)) {
      const details = candidate.details !== null && typeof candidate.details === "object" && !Array.isArray(candidate.details)
        ? candidate.details as Record<string, unknown> : { reason: candidate.reasonCode };
      throw new UsfError(candidate.reasonCode.split(":", 1)[0] as string, exitCode, "Work-completion validation refused.", details);
    }
  }
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

function atomicCreate(path: string, bytes: string | Buffer, mode: number): void {
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

function completionValidationSeedPath(root: string, candidateDigest: string, createParent: boolean): string {
  if (!digestPattern.test(candidateDigest)) {
    refuse("WORK_COMPLETION_SEED_IDENTITY_INVALID", "The validation seed candidate identity is invalid.", exitCodes.CURRENTNESS_FAILURE);
  }
  const repositoryPath = `.usf/receipts/check/${candidateDigest.slice("sha256:".length)}/completion-validation-seed.json`;
  if (!completionSeedPathPattern.test(repositoryPath)) {
    refuse("WORK_COMPLETION_SEED_PATH_INVALID", "The validation seed path is not the derived private path.", exitCodes.CONTAINMENT_REFUSAL);
  }
  assertPrivateDirectory(root, dirname(repositoryPath), createParent);
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, repositoryPath);
  const relation = relative(canonicalRoot, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    refuse("WORK_COMPLETION_SEED_PATH_ESCAPE", "The validation seed path escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  }
  if (existsSync(absolute)) {
    const entry = lstatSync(absolute);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o177) !== 0 || entry.size > maximumInputBytes || realpathSync(absolute) !== absolute) {
      refuse("WORK_COMPLETION_SEED_FILE_UNSAFE", "The validation seed is not an owner-private regular file.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
  return absolute;
}

function completionValidationSeedExists(root: string, candidateDigest: string): boolean {
  if (!digestPattern.test(candidateDigest)) return false;
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, `.usf/receipts/check/${candidateDigest.slice("sha256:".length)}/completion-validation-seed.json`);
  const relation = relative(canonicalRoot, absolute);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation) && existsSync(absolute);
}

function readCompletionValidationSeedFile(root: string, candidateDigest: string): unknown {
  const absolute = completionValidationSeedPath(root, candidateDigest, false);
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    if (error instanceof UsfError) throw error;
    refuse("WORK_COMPLETION_SEED_INVALID", "The validation seed is missing or malformed.", exitCodes.CURRENTNESS_FAILURE);
  }
}

function persistCompletionValidationSeed(root: string, candidateDigest: string, value: Record<string, unknown>): string {
  const absolute = completionValidationSeedPath(root, candidateDigest, true);
  const bytes = `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`;
  if (existsSync(absolute)) {
    const existing = readCompletionValidationSeedFile(root, candidateDigest);
    if (canonicalJson(existing, { rejectAbsolutePaths: true }) !== canonicalJson(value, { rejectAbsolutePaths: true })) {
      refuse("WORK_COMPLETION_SEED_CONFLICT", "A different validation seed already exists for the derived candidate.", exitCodes.INTEGRATION_CONFLICT);
    }
    return absolute;
  }
  try { atomicCreate(absolute, bytes, 0o600); }
  catch (error) {
    if (error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = readCompletionValidationSeedFile(root, candidateDigest);
      if (canonicalJson(existing, { rejectAbsolutePaths: true }) !== canonicalJson(value, { rejectAbsolutePaths: true })) {
        refuse("WORK_COMPLETION_SEED_CONFLICT", "Concurrent validation seed production produced conflicting bytes.", exitCodes.INTEGRATION_CONFLICT);
      }
      return absolute;
    }
    throw error;
  }
  readCompletionValidationSeedFile(root, candidateDigest);
  return absolute;
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
  readReceipt: typeof readGraphDerivedCheckReceipt = readGraphDerivedCheckReceipt,
): Promise<readonly CompletionValidationReference[]> {
  const state = await validationReceiptState(root, packet, workspace, readReceipt);
  if (state.missing.length !== 0) refuse("WORK_COMPLETION_CHECK_RECEIPT_MISSING", "A required graph-derived check receipt is absent.", exitCodes.CURRENTNESS_FAILURE, { obligationIri: state.missing[0] });
  return state.references;
}

async function deriveEvidence(
  root: string,
  graph: LoadedSemanticGraph,
  packet: WorkPacket,
  candidateDigest: string,
  readOnly = false,
  validationSeed?: Record<string, unknown>,
): Promise<CompletionEvidenceCandidate> {
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  if (readOnly) {
    const workspace = await inspectNoChangeWorkspace(root, candidateDigest);
    if (workspace.constructionBasis.basisDigest !== packet.realisationBasis?.basisDigest
      || canonicalJson(workspace.policy) !== canonicalJson(authority.policy)) {
      refuse("WORK_COMPLETION_WORKSPACE_STALE", "The no-change workspace no longer matches current scoped authority.", exitCodes.CURRENTNESS_FAILURE);
    }
    const references = validationSeed === undefined
      ? await validationReferences(root, packet, workspace)
      : validationSeed.receipts as readonly CompletionValidationReference[];
    const evidence = createCompletionEvidenceCandidate(graph, packet, workspace, references);
    validateCompletionEvidenceShape(evidence);
    if (!validateSchema<CompletionEvidenceCandidate>(root, authority.evidenceSchemaPath, evidence)) {
      refuse("WORK_COMPLETION_EVIDENCE_SCHEMA_INVALID", "Derived completion evidence failed its closed graph-selected schema.", exitCodes.CURRENTNESS_FAILURE);
    }
    return evidence;
  }
  return withAuthenticatedNoChangeWorkspace(root, candidateDigest, async (workspace) => {
    if (workspace.constructionBasis.basisDigest !== packet.realisationBasis?.basisDigest
      || canonicalJson(workspace.policy) !== canonicalJson(authority.policy)) {
      refuse("WORK_COMPLETION_WORKSPACE_STALE", "The no-change workspace no longer matches current scoped authority.", exitCodes.CURRENTNESS_FAILURE);
    }
    const readReceipt = (receiptRoot: string, digest: string, validationId: string) =>
      readGraphDerivedCheckReceiptAtAuthenticatedWorkspace(receiptRoot, digest, validationId, {
        workspace: workspace.workspace,
        basis: workspace.constructionBasis,
      });
    const references = await validationReferences(root, packet, workspace, readReceipt);
    const evidence = createCompletionEvidenceCandidate(graph, packet, workspace, references);
    validateCompletionEvidenceShape(evidence);
    if (!validateSchema<CompletionEvidenceCandidate>(root, authority.evidenceSchemaPath, evidence)) {
      refuse("WORK_COMPLETION_EVIDENCE_SCHEMA_INVALID", "Derived completion evidence failed its closed graph-selected schema.", exitCodes.CURRENTNESS_FAILURE);
    }
    return evidence;
  });
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

function prepareNoChangeContextFromGraph(graph: LoadedSemanticGraph, request: RealiseRequest) {
  const packet = exactPacket(graph, request.profile, request.work);
  const basis = packet.realisationBasis;
  if (basis === undefined) refuse("WORK_COMPLETION_BASIS_MISSING", "The selected work has no realisation basis.", exitCodes.CURRENTNESS_FAILURE);
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  return Object.freeze({ graph, packet, basis, authority });
}

async function prepareNoChangeContext(root: string, request: RealiseRequest) {
  return prepareNoChangeContextFromGraph(loadSemanticGraph(root, request.manifestPath), request);
}

async function realiseNoChange(root: string, request: RealiseRequest): Promise<Record<string, unknown>> {
  const { packet, basis, authority } = await prepareNoChangeContext(root, request);
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


async function prepareChecksSelectionContext(root: string, request: unknown, readOnly = false) {
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
    const withWorkspace = readOnly
      ? async <T>(operation: (workspace: AuthenticatedNoChangeWorkspace) => Promise<T>) => {
        const before = await inspectNoChangeWorkspace(repositoryRoot, candidateDigest, "check-recovery");
        const result = await operation(before);
        const after = await inspectNoChangeWorkspace(repositoryRoot, candidateDigest, "check-recovery");
        if (canonicalJson(before) !== canonicalJson(after)) {
          refuse("WORK_COMPLETION_WORKSPACE_STALE", "The no-change workspace changed during read-only check-set authentication.", exitCodes.CURRENTNESS_FAILURE);
        }
        return result;
      }
      : async <T>(operation: (workspace: AuthenticatedNoChangeWorkspace) => Promise<T>) => withAuthenticatedNoChangeWorkspaceForCheckRecovery(repositoryRoot, candidateDigest, operation);
    const withState = <T>(operation: (state: Awaited<ReturnType<typeof validationReceiptState>> & { readonly reconciliations: readonly string[] }) => Promise<T> | T) => withWorkspace(async (workspace) => {
      assertCurrent();
      if (workspace.constructionBasis.basisDigest !== basis.basisDigest
        || canonicalJson(workspace.policy) !== canonicalJson(initial.authority.policy)) {
        refuse("WORK_COMPLETION_WORKSPACE_STALE", "The no-change workspace no longer matches current scoped authority.", exitCodes.CURRENTNESS_FAILURE);
      }
      const authenticated = Object.freeze({ workspace: workspace.workspace, basis: workspace.constructionBasis });
      const readReceipt = (receiptRoot: string, digest: string, validationId: string) =>
        readGraphDerivedCheckReceiptForRecoveryAtAuthenticatedWorkspace(receiptRoot, digest, validationId, authenticated);
      const state = await validationReceiptState(repositoryRoot, initial.packet, workspace, readReceipt);
      const reconciliations: string[] = [];
      for (const obligationIri of state.obligations) {
        // An absent intent is the common case. Probe its authenticated path
        // before rebuilding the full candidate/workspace binding.
        if (await executionIntentPresent(repositoryRoot, candidateDigest, obligationIri)
          && await authenticateGraphDerivedCheckIntentAtAuthenticatedWorkspace(repositoryRoot, candidateDigest, obligationIri, authenticated) === "STARTED") {
          reconciliations.push(obligationIri);
        }
      }
      assertCurrent();
      return operation(Object.freeze({ ...state, reconciliations: Object.freeze(reconciliations) }));
    });
    const readState = () => withState(state => state);
    return { selected, repositoryRoot, initial, basis, candidateDigest, readState, withState, assertCurrent };
}

async function prepareChecksContext(root: string, request: unknown, readOnly = false) {
  const context = await prepareChecksSelectionContext(root, request, readOnly);
  return { ...context, before: await context.readState() };
}

function completionReceiptSetResult(
  workIri: string,
  profileIri: string,
  candidateDigest: string,
  constructionBasisDigest: string,
  state: { readonly obligations: readonly string[]; readonly references: readonly CompletionValidationReference[] },
): Record<string, unknown> {
  const draft = {
    schema: "urn:usf:schema:completion-check-receipt-set-result:1" as const,
    status: "current" as const,
    workIri,
    profileIri,
    candidateDigest,
    constructionBasisDigest,
    validationObligations: state.obligations,
    receipts: state.references,
    nonClaims: Object.freeze(["completion", "parallel-safety", "partial-set-recovery", "terminal-closure"]),
  };
  return Object.freeze({ ...draft, receiptSetDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) });
}

/** Derive and authenticate the complete graph-required receipt set without accepting completion. */
export async function prepareCompletionChecks(root: string, request: unknown): Promise<Record<string, unknown>> {
  try {
    const { selected, repositoryRoot, initial, basis, candidateDigest, readState, before } = await prepareChecksContext(root, request);
    const ensureMember = async (obligationIri: string) => {
      // Authenticate the entire retained denominator before requesting any effect.
      await readState();
      const checked = await ensureGraphDerivedCheck(repositoryRoot, candidateDigest, obligationIri);
      if (checked.status !== "pass") {
        // The child may have atomically published a current receipt and then
        // lost its acknowledgement while the parent was observing it. A
        // current authenticated receipt is sufficient reconciliation; stale,
        // partial, or absent state remains a typed refusal.
        const reconciled = await readGraphDerivedCheckReceipt(repositoryRoot, candidateDigest, obligationIri);
        if (reconciled !== null) return;
        refuse(checked.reasonCode, "A required graph-derived check refused; no complete set is acknowledged.", exitCodes.CURRENTNESS_FAILURE, {
          obligationIri,
          ...(checked.confinementFailure === undefined ? {} : { confinementFailure: checked.confinementFailure }),
          ...(checked.failureDiagnostic === undefined ? {} : { failureDiagnostic: checked.failureDiagnostic }),
        });
      }
      await readState();
    };
    for (const obligationIri of before.reconciliations) await ensureMember(obligationIri);
    for (const obligationIri of (await readState()).missing) await ensureMember(obligationIri);
    const after = await readState();
    if (after.reconciliations.length !== 0) refuse("WORK_COMPLETION_CHECK_SET_STALE", "Required intent state changed and still needs reconciliation; no complete set is acknowledged.", exitCodes.CURRENTNESS_FAILURE);
    if (after.missing.length !== 0) refuse("WORK_COMPLETION_CHECK_RECEIPT_MISSING", "The required check receipt set is incomplete.", exitCodes.CURRENTNESS_FAILURE, { obligationIri: after.missing[0] });
    const result = completionReceiptSetResult(initial.packet.id, selected.profile, candidateDigest, basis.basisDigest, after);
    persistCompletionValidationSeed(repositoryRoot, candidateDigest, result);
    return result;
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_CHECK_SET_REFUSED"); }
}

/**
 * Reauthenticate the explicit producer artifact without entering the native
 * check runner. A missing seed is a bounded refusal, never an implicit rebuild.
 */
export async function readCompletionValidationSeed(root: string, request: unknown): Promise<Record<string, unknown>> {
  try {
    const context = await prepareChecksSelectionContext(root, request, true);
    return await context.withState(state => {
      if (state.reconciliations.length !== 0 || state.missing.length !== 0) {
        refuse("WORK_COMPLETION_SEED_NOT_CURRENT", "The complete current receipt set is not available for seed consumption.", exitCodes.CURRENTNESS_FAILURE, {
          missing: state.missing,
          reconciliations: state.reconciliations,
        });
      }
      const expected = completionReceiptSetResult(context.initial.packet.id, context.selected.profile, context.candidateDigest, context.basis.basisDigest, state);
      const actual = readCompletionValidationSeedFile(context.repositoryRoot, context.candidateDigest);
      if (canonicalJson(actual, { rejectAbsolutePaths: true }) !== canonicalJson(expected, { rejectAbsolutePaths: true })) {
        refuse("WORK_COMPLETION_SEED_STALE", "The persisted validation seed does not match the current authenticated receipt set.", exitCodes.CURRENTNESS_FAILURE, {
          candidateDigest: context.candidateDigest,
          expectedSeedDigest: expected.receiptSetDigest,
        });
      }
      return expected;
    });
  } catch (error) {
    // A settled intent whose receipt path is missing or inconsistent is a
    // non-current seed, not a generic containment failure at this boundary.
    // Preserve the native path refusal for producer/recovery callers.
    const nativeCode = error instanceof UsfError ? error.code
      : error !== null && typeof error === "object" && typeof (error as { reasonCode?: unknown }).reasonCode === "string"
        ? (error as { reasonCode: string }).reasonCode : undefined;
    if (nativeCode === "CHECK_RECEIPT_PATH_UNSAFE") {
      return asUsfError(new UsfError("WORK_COMPLETION_SEED_NOT_CURRENT", exitCodes.CURRENTNESS_FAILURE,
        "The complete current receipt set is not available for seed consumption.", { cause: nativeCode }), "WORK_COMPLETION_SEED_NOT_CURRENT");
    }
    return asUsfError(error, "WORK_COMPLETION_SEED_REFUSED");
  }
}

/** Read-only diagnosis of the current check denominator; it never runs or repairs a check. */
export async function prepareCompletionDiagnosis(root: string, request: unknown): Promise<Record<string, unknown>> {
  const initial = await prepareRootInspectionContext(root, request);
  const context = await prepareChecksSelectionContext(root, initial.nativeRequest, true);
  const state = await context.readState();
  const current = new Set(state.references.map(reference => reference.obligationIri));
  const recovering = new Set(state.reconciliations);
  const members = await Promise.all(state.obligations.map(async validationObligationIri => {
    const outcomeState = current.has(validationObligationIri) ? "current-receipt" as const
      : recovering.has(validationObligationIri) ? "unknown" as const : "absent" as const;
    // A successful receipt never inherits an older failure. Unknown/absent
    // outcomes may expose only a current, digest-authenticated diagnostic.
    if (outcomeState === "current-receipt") return Object.freeze({ validationObligationIri, outcomeState, diagnosticAvailability: "unavailable" as const });
    const diagnostic = await readGraphDerivedCheckFailureDiagnostic(context.repositoryRoot, context.candidateDigest, validationObligationIri);
    if (diagnostic.status === "available") return Object.freeze({ validationObligationIri, outcomeState, diagnosticAvailability: "available" as const, diagnostic: diagnostic.diagnostic });
    if (diagnostic.status === "refused") return Object.freeze({ validationObligationIri, outcomeState, diagnosticAvailability: "refused" as const, reasonCode: diagnostic.reasonCode });
    return Object.freeze({ validationObligationIri, outcomeState, diagnosticAvailability: "unavailable" as const });
  }));
  return Object.freeze({
    schema: "urn:usf:check-result:1" as const,
    topic: "diagnose" as const,
    workIri: initial.nativeRequest.work,
    explicitProfileIri: initial.nativeRequest.profile,
    candidateDigest: context.candidateDigest,
    executionAuthority: "none" as const,
    complete: false as const,
    members: Object.freeze(members),
  });
}

export interface CompletionEvidencePreparationRequest {
  readonly work: string;
  readonly profile: string;
  readonly manifestPath: string;
  readonly candidateDigest: string;
}

/** Authenticate a current evidence candidate without persisting or publishing it. */
async function prepareEvidenceContext(root: string, request: CompletionEvidencePreparationRequest, readOnly = false) {
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
    const evidence = await deriveEvidence(repositoryRoot, graph, packet, selected.candidateDigest, readOnly);
    // Awaited workspace/check authentication must not carry a stale selection into output.
    const currentGraph = loadSemanticGraph(repositoryRoot, selected.manifestPath);
    const currentPacket = exactPacket(currentGraph, selected.profile, selected.work);
    const currentAuthority = deriveNoChangeCompletionAuthority(currentGraph, currentPacket.id);
    if (canonicalJson(packet.realisationBasis) !== canonicalJson(currentPacket.realisationBasis)
      || canonicalJson(authority) !== canonicalJson(currentAuthority)
      || canonicalJson(dependencies) !== canonicalJson(workCompletionAuthorityDependencies(currentGraph, currentAuthority))) {
      refuse("WORK_COMPLETION_EVIDENCE_NOT_CURRENT", "Evidence preparation authority changed during authentication.", exitCodes.CURRENTNESS_FAILURE);
    }
    return { evidence, packet, authority, selected };
  } catch (error) {
    if (readOnly) throw error;
    return asUsfError(error, "WORK_COMPLETION_EVIDENCE_REFUSED");
  }
}

export async function prepareCompletionEvidence(root: string, request: CompletionEvidencePreparationRequest): Promise<CompletionEvidenceCandidate> {
  return (await prepareEvidenceContext(root, request)).evidence;
}

async function produceCompletionProof(root: string, graph: LoadedSemanticGraph, packet: WorkPacket, evidence: CompletionEvidenceCandidate, obligation: string): Promise<CompletionProofBundle> {
  const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
  const bundle = createCompletionProofBundle(graph, packet, evidence, obligation);
  validateCompletionBundleShape(bundle);
  if (!validateSchema<CompletionProofBundle>(root, authority.proofBundleSchemaPath, bundle)) {
    refuse("WORK_COMPLETION_PROOF_SCHEMA_INVALID", "Derived completion proof failed its closed graph-selected schema.", exitCodes.CURRENTNESS_FAILURE);
  }
  return bundle;
}

async function produceProof(root: string, request: ProofRequest, value: unknown): Promise<CompletionProofBundle> {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const { evidence, packet } = await authenticateEvidence(root, graph, request.profile, value);
  return produceCompletionProof(root, graph, packet, evidence, request.obligation);
}

export interface CanonicalCompletionProofRequest {
  readonly rootIdentity: string;
  readonly manifestPath: string;
}

function parseCanonicalCompletionProofRequest(value: unknown): Readonly<CanonicalCompletionProofRequest> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getOwnPropertySymbols(value).length !== 0) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Canonical proof preparation requires only rootIdentity and manifestPath.");
  }
  const keys = Object.getOwnPropertyNames(value).sort();
  if (canonicalJson(keys) !== canonicalJson(["manifestPath", "rootIdentity"])) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Canonical proof preparation requires only rootIdentity and manifestPath.");
  }
  const manifest = Object.getOwnPropertyDescriptor(value, "manifestPath");
  const root = Object.getOwnPropertyDescriptor(value, "rootIdentity");
  if (manifest === undefined || root === undefined || !("value" in manifest) || !("value" in root)
    || typeof manifest.value !== "string" || parseRepositoryPath(manifest.value, "file") === null
    || typeof root.value !== "string" || !iriPattern.test(root.value)) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Canonical proof preparation requires own data rootIdentity and manifestPath.");
  }
  return Object.freeze({ rootIdentity: root.value, manifestPath: manifest.value });
}

/** Root-selected, no-persistence proof preparation for the transition adapter. */
async function prepareProofContext(root: string, request: CanonicalCompletionProofRequest, readOnly = false) {
  try {
    const selected = parseCanonicalCompletionProofRequest(request);
    const repositoryRoot = realpathSync(resolve(root));
    const graph = loadSemanticGraph(repositoryRoot, selected.manifestPath);
    const context = deriveCliTransitionContext(graph, selected.rootIdentity);
    if (context.diagnostics.length !== 0 || context.profile === null || context.work !== selected.rootIdentity) {
      refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Canonical proof requires one admitted work context.");
    }
    const packet = exactPacket(graph, context.profile, selected.rootIdentity);
    const basis = packet.realisationBasis;
    const obligation = packet.realisationAuthority?.completionProofObligation;
    if (basis === undefined || typeof obligation !== "string") refuse("WORK_COMPLETION_PROOF_OBLIGATION_INVALID", "Canonical proof preparation requires one graph-selected completion proof obligation.", exitCodes.CURRENTNESS_FAILURE);
    const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
    const candidateDigest = await deriveNoChangeCandidateIdentity(repositoryRoot, basis, authority.policy);
    const seedRequest = { work: selected.rootIdentity, profile: context.profile, manifestPath: selected.manifestPath };
    // Read-only inspection may describe an authenticated legacy receipt set
    // before a seed has been produced. Effectful proof preparation remains
    // seed-only; a present seed is always reauthenticated rather than bypassed.
    const validationSeed = !readOnly || completionValidationSeedExists(repositoryRoot, candidateDigest)
      ? await readCompletionValidationSeed(repositoryRoot, seedRequest)
      : undefined;
    const evidence = await deriveEvidence(repositoryRoot, graph, packet, candidateDigest, readOnly, validationSeed);
    const bundle = await produceCompletionProof(repositoryRoot, graph, packet, evidence, obligation);
    const currentGraph = loadSemanticGraph(repositoryRoot, selected.manifestPath);
    const currentContext = deriveCliTransitionContext(currentGraph, selected.rootIdentity);
    if (currentContext.diagnostics.length !== 0 || currentContext.profile === null || currentContext.work !== selected.rootIdentity) {
      refuse("WORK_COMPLETION_BUNDLE_NOT_CURRENT", "Canonical completion context changed during preparation.", exitCodes.CURRENTNESS_FAILURE);
    }
    const currentPacket = exactPacket(currentGraph, currentContext.profile, selected.rootIdentity);
    const currentAuthority = deriveNoChangeCompletionAuthority(currentGraph, currentPacket.id);
    if (context.profile !== currentContext.profile || canonicalJson(packet.realisationBasis) !== canonicalJson(currentPacket.realisationBasis)
      || canonicalJson(authority) !== canonicalJson(currentAuthority)) {
      refuse("WORK_COMPLETION_BUNDLE_NOT_CURRENT", "Canonical completion proof authority changed during preparation.", exitCodes.CURRENTNESS_FAILURE);
    }
    return { bundle, packet, authority, selected };
  } catch (error) {
    if (readOnly) throw error;
    return asUsfError(error, "WORK_COMPLETION_PROOF_REFUSED");
  }
}

export async function prepareCanonicalCompletionProof(root: string, request: CanonicalCompletionProofRequest): Promise<CompletionProofBundle> {
  return (await prepareProofContext(root, request)).bundle;
}

export interface CanonicalCompletionPublicationRequest extends CanonicalCompletionProofRequest {
  readonly mode: "verify" | "apply";
}

/** Read-only projection of the existing native evaluator, never graph assertions. */
export function evaluateCanonicalCompletionTerminal(root: string, request: CanonicalCompletionProofRequest) {
  const selection = parseCanonicalCompletionProofRequest(request);
  const repository = realpathSync(root);
  const evaluator = "urn:usf:rule:completion-terminal-native-evaluation:1";
  const read = () => {
    const graph = loadSemanticGraph(repository, selection.manifestPath);
    const context = deriveCliTransitionContext(graph, selection.rootIdentity);
    if (context.diagnostics.length !== 0 || context.profile === null || context.work !== selection.rootIdentity) {
      refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Terminal evaluation requires one admitted work context.");
    }
    const packet = exactPacket(graph, context.profile, selection.rootIdentity);
    const basis = packet.realisationBasis;
    if (basis === undefined) refuse("WORK_COMPLETION_AUTHORITY_INCOMPLETE", "Terminal evaluation requires a current basis.", exitCodes.CURRENTNESS_FAILURE);
    const authority = deriveNoChangeCompletionAuthority(graph, packet.id);
    const rule = graph.quads.filter(q => q.subject === evaluator);
    const ruleValues = (name: string) => rule.filter(q => q.predicate === predicate(name) && q.objectKind === "iri").map(q => q.object);
    if (canonicalQuadDigest(rule) !== "sha256:b9c8fd3a8e648ecb1ddb6e1bbdca0d4e536ebfeffdfd8f204a38287370b0ea3d"
      || canonicalJson(ruleValues("algorithm")) !== canonicalJson([authority.publicationAlgorithmIri])
      || canonicalJson(ruleValues("publicationPolicy")) !== canonicalJson([authority.policy.iri])) {
      refuse("WORK_COMPLETION_TERMINAL_EVALUATOR_INVALID", "Terminal evaluator does not select the native publication authority.", exitCodes.CURRENTNESS_FAILURE);
    }
    const result = evaluateCurrentNoChangeCompletion(graph, { workIri: packet.id, profileIri: context.profile });
    const artifacts: Record<string, unknown>[] = [];
    if (packet.realisationStage?.stage === "verified-complete" && packet.realisationStage.completion.verified
      && result.verified && result.authenticatedPublication !== undefined && result.receiptDependency !== undefined
      && result.realisationReceipt !== null && result.evidence !== null && result.proofResult !== null) {
      const source = readPublicationFile(repository, authority.sourcePath);
      const receipt = readPublicationFile(repository, result.receiptDependency.key);
      if (sha256(receipt.bytes) !== result.receiptDependency.digest) {
        refuse("WORK_COMPLETION_TERMINAL_STALE", "Publication receipt changed during native evaluation.", exitCodes.CURRENTNESS_FAILURE);
      }
      if (sha256(source.bytes) !== result.authenticatedPublication.sourceDigest) {
        refuse("WORK_COMPLETION_TERMINAL_STALE", "Current source is not the receipt-authenticated publication postimage.", exitCodes.CURRENTNESS_FAILURE);
      }
      const declarations = graph.quads.filter(q => q.predicate === predicate("authenticationRule")
        && q.objectKind === "iri" && q.object === evaluator).map(q => q.subject);
      if (declarations.length !== 1) refuse("WORK_COMPLETION_TERMINAL_ARTIFACT_INVALID", "Native publication requires exactly one admitted artifact contract.", exitCodes.CURRENTNESS_FAILURE);
      const artifactRows = graph.quads.filter(q => q.subject === declarations[0]);
      const expected: Record<string, string> = { type: "urn:usf:type:CliArtifactContract",
        producer: "urn:usf:cli-transition:completion-publication:1", schema: authority.publicationReceiptSchemaIri,
        work: packet.id, profile: context.profile, proofObligation: packet.realisationAuthority!.completionProofObligation! };
      if (canonicalQuadDigest(artifactRows) !== "sha256:d09e7915796bd640dda4332327d2f26710358a0088fa742b085c4314786f5981"
        || Object.entries(expected).some(([name, value]) => canonicalJson(artifactRows.filter(q => q.predicate === predicate(name) && q.objectKind === "iri").map(q => q.object)) !== canonicalJson([value]))
        || canonicalJson(graph.quads.filter(q => q.subject === expected.producer && q.predicate === predicate("produces") && q.objectKind === "iri").map(q => q.object)) !== canonicalJson(declarations)) {
        refuse("WORK_COMPLETION_TERMINAL_ARTIFACT_INVALID", "Artifact contract or native producer lineage differs from the compiled semantic boundary.", exitCodes.CURRENTNESS_FAILURE);
      }
      for (const artifact of [...new Set(declarations)].sort()) artifacts.push(Object.freeze({
        artifact, state: "accepted", work: packet.id, profile: context.profile, manifestPath: selection.manifestPath,
        evaluator, evaluatorDigest: canonicalQuadDigest(rule), currentBasisDigest: basis.basisDigest,
        ...result.authenticatedPublication,
        receiptPath: result.receiptDependency.key, realisationReceipt: result.realisationReceipt,
        evidence: result.evidence, proofResult: result.proofResult,
      }));
    }
    return { graphDigest: canonicalQuadDigest(graph.quads), basisDigest: basis.basisDigest,
      result: { authenticatedArtifacts: Object.freeze(artifacts), evaluator, evaluatorDigest: canonicalQuadDigest(rule),
        manifestPath: selection.manifestPath, profile: context.profile, work: packet.id } };
  };
  const before = read();
  const after = read();
  if (canonicalJson(before) !== canonicalJson(after)) {
    refuse("WORK_COMPLETION_TERMINAL_STALE", "Terminal source, receipt or authority changed during readback.", exitCodes.CURRENTNESS_FAILURE);
  }
  return Object.freeze(after.result);
}

export interface CanonicalTerminalBranchExternal {
  readonly contributions: readonly unknown[];
}

/**
 * Authenticate the declared terminal branches through their native readers.
 * This is an observation only: it never creates candidates, checks, intents,
 * receipts, locks, or publication state.
 */
export async function evaluateCanonicalTerminalBranches(
  root: string,
  request: CanonicalCompletionProofRequest,
  external?: CanonicalTerminalBranchExternal,
) {
  const selected = parseCanonicalCompletionProofRequest(request);
  const repository = realpathSync(root);
  const graph = loadSemanticGraph(repository, selected.manifestPath);
  const context = deriveCliTransitionContext(graph, selected.rootIdentity);
  if (context.diagnostics.length !== 0 || context.profile === null || context.work !== selected.rootIdentity) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Terminal branch evaluation requires one admitted work context.");
  }
  const structural = deriveCliTerminalAssessment(graph, selected.rootIdentity);
  const evaluator = "urn:usf:rule:ordinary-terminal-branch-evaluation:1";
  const evaluatorDigest = canonicalQuadDigest(graph.quads.filter((quad) => quad.subject === evaluator));
  const branchRows: Readonly<Record<string, unknown>>[] = (structural.branchAssessments ?? [])
    .filter((value) => value !== null && typeof value === "object" && !Array.isArray(value))
    .map((value) => value as Readonly<Record<string, unknown>>);
  const reasonSet = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)].sort());
  const nativeFacts = (values: readonly string[]): readonly string[] => Object.freeze([...new Set([evaluatorDigest, ...values])].sort());
  const update = (
    branch: Readonly<Record<string, unknown>>,
    outcome: "accepted" | "missing" | "refused" | "stale" | "unknown",
    reasons: readonly string[],
    facts: readonly string[],
  ): Readonly<Record<string, unknown>> => {
    const obligations = Array.isArray(branch.obligations) ? branch.obligations.map((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const obligation = value as Readonly<Record<string, unknown>>;
      return Object.freeze({ ...obligation, outcome, reasonCodes: reasonSet(reasons),
        ...(outcome === "accepted" && typeof obligation.artifactIdentity === "string" ? { artifactDigest: facts.at(-1) } : {}) });
    }) : [];
    return Object.freeze({ ...branch, applicability: outcome === "accepted" ? "applicable" : branch.applicability,
      outcome, obligations: Object.freeze(obligations), nativeFactDigests: nativeFacts(facts), reasonCodes: reasonSet(reasons) });
  };
  const assessed: Readonly<Record<string, unknown>>[] = [];
  for (const branch of branchRows) {
    const branchIdentity = branch.branchIdentity;
    if (typeof branchIdentity !== "string") continue;
    if (branchIdentity === "urn:usf:cli-branch:ordinary-completion:1") {
      try {
        const completion = evaluateCanonicalCompletionTerminal(repository, selected) as Readonly<Record<string, unknown>>;
        const artifacts = Array.isArray(completion.authenticatedArtifacts) ? completion.authenticatedArtifacts : [];
        if (artifacts.length > 0) {
          assessed.push(update(branch, "accepted", [], artifacts.map((artifact) => canonicalDigest(artifact))));
        } else {
          assessed.push(update(branch, "missing", ["TERMINAL_BRANCH_ARTIFACT_MISSING", "TERMINAL_BRANCH_PROOF_MISSING"], []));
        }
      } catch {
        assessed.push(update(branch, "unknown", ["TERMINAL_BRANCH_EVALUATOR_UNAVAILABLE"], []));
      }
      continue;
    }
    if (branchIdentity === "urn:usf:cli-branch:ordinary-construction:1") {
      const contributions = external?.contributions;
      if (!Array.isArray(contributions) || contributions.length === 0 || contributions.length > 32) {
        assessed.push(update(branch, "unknown", ["TERMINAL_BRANCH_INPUT_MISSING"], []));
        continue;
      }
      try {
        const resolution = resolveContributions(contributions as ResolvableContribution[]);
        const candidate = resolution.candidate;
        if (resolution.status !== "resolved" || candidate === null || candidate.basis.work.id !== context.work
          || candidate.basis.selection.profile !== context.profile || candidate.basis.selection.manifestPath !== selected.manifestPath) {
          assessed.push(update(branch, "refused", ["TERMINAL_BRANCH_SCOPE_CONFLICT"], []));
          continue;
        }
        const inspection: CandidateIntegrationRecoveryInspection = await inspectCandidateIntegrationRecovery(repository, {
          candidateDigests: [candidate.identity.artifactDigest],
        });
        const facts = inspection.factDigests;
        if (inspection.state === "primary-advanced" && inspection.observation?.outcome === "urn:usf:outcome:integration-success") {
          assessed.push(update(branch, "accepted", [], facts));
        } else if (inspection.state === "stale") {
          assessed.push(update(branch, "stale", ["TERMINAL_BRANCH_CURRENTNESS_STALE", inspection.reasonCode ?? "INTEGRATION_POSTIMAGE_MOVED"], facts));
        } else if (inspection.state === "quarantined") {
          assessed.push(update(branch, "refused", ["TERMINAL_BRANCH_RECOVERY_UNRESOLVED", inspection.reasonCode ?? "INTEGRATION_RECOVERY_QUARANTINED"], facts));
        } else if (inspection.state === "absent" || inspection.state === "prepared-commit") {
          assessed.push(update(branch, "missing", ["TERMINAL_BRANCH_ARTIFACT_MISSING"], facts));
        } else {
          assessed.push(update(branch, "unknown", ["TERMINAL_BRANCH_RECOVERY_UNRESOLVED", inspection.reasonCode ?? "INTEGRATION_INTENT_MISMATCH"], facts));
        }
      } catch {
        assessed.push(update(branch, "unknown", ["TERMINAL_BRANCH_EVALUATOR_UNAVAILABLE"], []));
      }
      continue;
    }
    assessed.push(update(branch, "unknown", ["TERMINAL_BRANCH_EVALUATOR_UNAVAILABLE"], []));
  }
  const currentGraph = loadSemanticGraph(repository, selected.manifestPath);
  if (canonicalQuadDigest(currentGraph.quads) !== canonicalQuadDigest(graph.quads)) {
    refuse("WORK_COMPLETION_TERMINAL_STALE", "Terminal branch authority changed during native evaluation.", exitCodes.CURRENTNESS_FAILURE);
  }
  return Object.freeze({ branchAssessments: Object.freeze(assessed), evaluator, evaluatorDigest,
    manifestPath: selected.manifestPath, profile: context.profile, work: context.work });
}

function parseCanonicalCompletionPublicationRequest(value: unknown): Readonly<CanonicalCompletionPublicationRequest> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getOwnPropertySymbols(value).length !== 0
    || canonicalJson(Object.getOwnPropertyNames(value).sort()) !== canonicalJson(["manifestPath", "mode", "rootIdentity"])) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Canonical publication requires only rootIdentity, manifestPath and mode.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (["rootIdentity", "manifestPath", "mode"].some(key => !("value" in descriptors[key]!))
    || (descriptors.mode!.value !== "verify" && descriptors.mode!.value !== "apply")) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Canonical publication requires own data properties and an explicit verify/apply mode.");
  }
  const selection = parseCanonicalCompletionProofRequest({
    rootIdentity: descriptors.rootIdentity!.value,
    manifestPath: descriptors.manifestPath!.value,
  });
  return Object.freeze({ ...selection, mode: descriptors.mode!.value as "verify" | "apply" });
}

/** Both CLI surfaces delegate to the same native publisher and receipt domain. */
function preparePublicationSelection(root: string, selected: CanonicalCompletionProofRequest) {
    const repositoryRoot = realpathSync(resolve(root));
    const graph = loadSemanticGraph(repositoryRoot, selected.manifestPath);
    const context = deriveCliTransitionContext(graph, selected.rootIdentity);
    if (context.diagnostics.length !== 0 || context.profile === null || context.work !== selected.rootIdentity) {
      refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Canonical publication requires one admitted work context.");
    }
    const authority = deriveNoChangeCompletionAuthority(graph, selected.rootIdentity);
    return { repositoryRoot, graph, context: { ...context, profile: context.profile }, authority };
}

async function preparePublicationContext(root: string, request: CanonicalCompletionPublicationRequest, readOnly = false) {
  try {
    const selected = parseCanonicalCompletionPublicationRequest(request);
    const { repositoryRoot, graph, context, authority } = preparePublicationSelection(root, selected);
    const binding = publicationSnapshotBinding(graph, authority);
    const group = binding === null ? null : publicationSnapshotGroup(binding, context.profile, selected.manifestPath, [selected.rootIdentity]);
    if (binding !== null && group !== null && existsSync(resolve(repositoryRoot, group))) {
      assertPrivateDirectory(repositoryRoot, group, false);
      const entries = readdirSync(resolve(repositoryRoot, group)).sort();
      if (entries.length > 32 || entries.some(name => !/^[0-9a-f]{64}$/.test(name))) {
        refuse("WORK_COMPLETION_SNAPSHOT_INVENTORY_INVALID", "Snapshot discovery exceeds its bounded intent inventory.", exitCodes.CONTAINMENT_REFUSAL);
      }
      const matches = entries.map(name => readPublicationSnapshot(repositoryRoot, binding, `${group}${name}`))
        .filter(snapshot => snapshot.metadata.profile === context.profile && snapshot.metadata.manifestPath === selected.manifestPath
          && snapshot.metadata.members.some(member => member.work === selected.rootIdentity));
      if (matches.length > 1 || (matches[0] !== undefined && matches[0].metadata.members.length !== 1)) {
        refuse("WORK_COMPLETION_SNAPSHOT_AMBIGUOUS", "Root-only publication requires one exact single-work retained intent; historical cohorts are not silently selected.", exitCodes.INTEGRATION_CONFLICT);
      }
      if (matches[0] !== undefined) {
        const snapshot = matches[0];
        const bundles = snapshot.metadata.files.filter(file => file.role === "proof-bundle").map(file =>
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes.get(file.path)!)) as CompletionProofBundle);
        return { repositoryRoot, selected, profile: context.profile, authority, bundles, snapshot };
      }
    }
    const proof = await prepareProofContext(repositoryRoot, {
      rootIdentity: selected.rootIdentity, manifestPath: selected.manifestPath,
    }, readOnly);
    if (canonicalJson(authority) !== canonicalJson(proof.authority)) {
      refuse("WORK_COMPLETION_BUNDLE_NOT_CURRENT", "Publication authority changed during proof preparation.", exitCodes.CURRENTNESS_FAILURE);
    }
    return { repositoryRoot, selected, profile: proof.bundle.evidence.profileIri, authority, bundles: [proof.bundle], snapshot: null, packet: proof.packet };
  } catch (error) {
    if (readOnly) throw error;
    return asUsfError(error, "WORK_COMPLETION_PUBLICATION_REFUSED");
  }
}

export async function runCanonicalCompletionPublication(root: string, request: CanonicalCompletionPublicationRequest): Promise<Record<string, unknown>> {
  const context = await preparePublicationContext(root, request);
  try {
    return await publishCompletion(context.repositoryRoot, { profile: context.profile, manifestPath: context.selected.manifestPath,
      mode: context.selected.mode, bundlePaths: [] }, context.bundles);
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_PUBLICATION_REFUSED"); }
}

function preflightFact(kind: NativePreflightFact["kind"], identity: string, digest: string): NativePreflightFact {
  if (!digestPattern.test(digest)) refuse("WORK_COMPLETION_PREFLIGHT_FACT_INVALID", "Native fact has no canonical digest.");
  return Object.freeze({ kind, identity, digest, current: true as const });
}

function packetPreflightFacts(packet: WorkPacket, authority: NoChangeCompletionAuthority): readonly NativePreflightFact[] {
  const basis = packet.realisationBasis;
  if (basis === undefined) refuse("WORK_COMPLETION_BASIS_MISSING", "Native preflight has no current basis.");
  return Object.freeze([
    preflightFact("basis", packet.id, basis.basisDigest),
    preflightFact("scope", packet.id, canonicalDigest(basis.scope)),
    preflightFact("authority", authority.policy.iri, authority.policy.resourceDigest),
  ]);
}

async function inspectNativeContext(
  operation: NativeOperationalPreflight["operation"],
  read: () => Promise<{ packet: WorkPacket; manifestPath: string; facts: readonly NativePreflightFact[]; unavailable?: readonly NativePreflightUnavailable[] }>,
): Promise<NativeOperationalPreflight> {
    const context = await read();
    const basis = context.packet.realisationBasis;
    if (basis === undefined) refuse("WORK_COMPLETION_BASIS_MISSING", "Native preflight has no current basis.");
    if (basis.work.id !== context.packet.id || context.packet.decisionBoundary.root !== basis.selection.profile
      || basis.selection.manifestPath !== context.manifestPath) {
      refuse("WORK_COMPLETION_PREFLIGHT_STALE", "Native selection disagrees with its authenticated basis.", exitCodes.CURRENTNESS_FAILURE);
    }
    const selection = Object.freeze({ workIri: basis.work.id, profileIri: basis.selection.profile, manifestPath: basis.selection.manifestPath });
    const unavailable = Object.freeze([...(context.unavailable ?? [])]);
    const common = { operation, selection, facts: Object.freeze([...context.facts]), executionAuthority: "none" as const, lockAvailability: "not-observed" as const };
    return unavailable.length === 0
      ? Object.freeze({ ...common, status: "authenticated" as const, unavailable: Object.freeze([]) as readonly [] })
      : Object.freeze({ ...common, status: "unavailable" as const, reasonCode: unavailable[0]!.reasonCode, unavailable });
}

async function prepareRootInspectionContext(root: string, request: unknown) {
  const selected = parseCanonicalCompletionProofRequest(request);
  const graph = loadSemanticGraph(root, selected.manifestPath);
  const context = deriveCliTransitionContext(graph, selected.rootIdentity);
  if (context.diagnostics.length !== 0 || context.profile === null || context.work !== selected.rootIdentity) {
    refuse("WORK_COMPLETION_ARGUMENTS_INVALID", "Native inspection requires one admitted work context.");
  }
  const nativeRequest = Object.freeze({ work: selected.rootIdentity, profile: context.profile, manifestPath: selected.manifestPath });
  return { selected, nativeRequest, ...prepareNoChangeContextFromGraph(graph, nativeRequest) };
}

/** Observational facts only. No workspaces, checks, locks or publication are created. */
export async function inspectNoChangeWork(root: string, request: unknown): Promise<NativeOperationalPreflight> {
  return inspectNativeContext("no-change", async () => {
    const initial = await prepareRootInspectionContext(root, request);
    const selected = initial.nativeRequest;
    const dependencies = workCompletionAuthorityDependencies(initial.graph, initial.authority);
    const candidateDigest = await deriveNoChangeCandidateIdentity(root, initial.basis, initial.authority.policy);
    const current = await prepareNoChangeContext(root, selected);
    if (canonicalJson(initial.basis) !== canonicalJson(current.basis) || canonicalJson(initial.authority) !== canonicalJson(current.authority)
      || canonicalJson(dependencies) !== canonicalJson(workCompletionAuthorityDependencies(current.graph, current.authority))) {
      refuse("WORK_COMPLETION_PREFLIGHT_STALE", "No-change authority changed during observation.", exitCodes.CURRENTNESS_FAILURE);
    }
    return { packet: current.packet, manifestPath: selected.manifestPath, facts: [...packetPreflightFacts(current.packet, current.authority),
      preflightFact("candidate-identity", candidateDigest, candidateDigest)] };
  });
}

async function prepareCompletionInspectionContextUncached(root: string, request: unknown) {
    const initial = await prepareRootInspectionContext(root, request);
    const context = await prepareChecksSelectionContext(root, initial.nativeRequest, true);
    const facts = [...packetPreflightFacts(context.initial.packet, context.initial.authority),
      preflightFact("candidate-identity", context.candidateDigest, context.candidateDigest)];
    const observed = await inspectNoChangeWorkspaceState(context.repositoryRoot, context.candidateDigest, "check-recovery");
    context.assertCurrent();
    if (observed.status === "missing") {
      return { packet: context.initial.packet, manifestPath: context.selected.manifestPath, facts,
        unavailable: [Object.freeze({ kind: "candidate-workspace" as const, identity: context.candidateDigest,
          state: "missing" as const, reasonCode: "WORK_COMPLETION_WORKSPACE_MISSING" })] };
    }
    const before = await context.readState();
    facts.push(preflightFact("candidate-workspace", context.candidateDigest, observed.workspace.workspaceIdentityDigest),
      ...before.references.map(receipt => preflightFact("check-receipt", receipt.obligationIri, receipt.receiptDigest)));
    const unavailable: NativePreflightUnavailable[] = [
      ...before.missing.map(identity => Object.freeze({ kind: "check-receipt" as const, identity, state: "missing" as const, reasonCode: "WORK_COMPLETION_CHECK_RECEIPT_MISSING" })),
      ...before.reconciliations.map(identity => Object.freeze({ kind: "check-recovery" as const, identity, state: "recovery-required" as const, reasonCode: "WORK_COMPLETION_CHECK_RECOVERY_REQUIRED" })),
    ];
    return { packet: context.initial.packet, manifestPath: context.selected.manifestPath, facts, unavailable };
}

type CompletionInspectionContext = Awaited<ReturnType<typeof prepareCompletionInspectionContextUncached>>;
let completionInspectionMemo: Map<string, Promise<CompletionInspectionContext>> | undefined;

/** Share one exact read-only check context during a single frontier interrogation. */
export async function withCompletionInspectionMemo<T>(operation: () => Promise<T>): Promise<T> {
  const previous = completionInspectionMemo;
  completionInspectionMemo = new Map();
  try { return await operation(); }
  finally { completionInspectionMemo = previous; }
}

async function prepareCompletionInspectionContext(root: string, request: unknown): Promise<CompletionInspectionContext> {
  if (completionInspectionMemo === undefined) return prepareCompletionInspectionContextUncached(root, request);
  const key = canonicalJson([realpathSync(resolve(root)), request]);
  const existing = completionInspectionMemo.get(key);
  if (existing !== undefined) return existing;
  const pending = prepareCompletionInspectionContextUncached(root, request);
  completionInspectionMemo.set(key, pending);
  return pending;
}

export async function inspectCompletionChecks(root: string, request: unknown): Promise<NativeOperationalPreflight> {
  return inspectNativeContext("checks", () => prepareCompletionInspectionContext(root, request));
}

export async function inspectCompletionEvidence(root: string, request: CanonicalCompletionProofRequest): Promise<NativeOperationalPreflight> {
  return inspectNativeContext("evidence", async () => {
    const prerequisites = await prepareCompletionInspectionContext(root, request);
    if (prerequisites.unavailable.length !== 0) return prerequisites;
    const initial = await prepareRootInspectionContext(root, request);
    const candidateDigest = await deriveNoChangeCandidateIdentity(root, initial.basis, initial.authority.policy);
    const context = await prepareEvidenceContext(root, { ...initial.nativeRequest, candidateDigest }, true);
    if (canonicalJson(initial.basis) !== canonicalJson(context.packet.realisationBasis)) {
      refuse("WORK_COMPLETION_PREFLIGHT_STALE", "Evidence basis changed during root-derived inspection.", exitCodes.CURRENTNESS_FAILURE);
    }
    return { packet: context.packet, manifestPath: context.selected.manifestPath,
      facts: [...packetPreflightFacts(context.packet, context.authority),
        preflightFact("candidate-workspace", context.evidence.candidateDigest, context.evidence.workspaceIdentityDigest),
        ...context.evidence.validationResults.map(receipt => preflightFact("check-receipt", receipt.obligationIri, receipt.receiptDigest)),
        preflightFact("evidence", context.evidence.evidenceIri, context.evidence.contentDigest)] };
  });
}

export async function inspectCanonicalCompletionProof(root: string, request: CanonicalCompletionProofRequest): Promise<NativeOperationalPreflight> {
  return inspectNativeContext("proof", async () => {
    const prerequisites = await prepareCompletionInspectionContext(root, request);
    if (prerequisites.unavailable.length !== 0) return prerequisites;
    const context = await prepareProofContext(root, request, true);
    return { packet: context.packet, manifestPath: context.selected.manifestPath,
      facts: [...packetPreflightFacts(context.packet, context.authority),
        preflightFact("evidence", context.bundle.evidence.evidenceIri, context.bundle.evidence.contentDigest),
        preflightFact("proof-bundle", context.bundle.proof.proofResultIri, context.bundle.bundleDigest)] };
  });
}

export async function inspectCanonicalCompletionPublication(root: string, request: CanonicalCompletionProofRequest | CanonicalCompletionPublicationRequest): Promise<NativeOperationalPreflight> {
  return inspectNativeContext("publication", async () => {
    if (request !== null && typeof request === "object" && !Object.hasOwn(request, "mode")) {
      const selected = parseCanonicalCompletionProofRequest(request);
      preparePublicationSelection(root, selected);
      const prerequisites = await prepareCompletionInspectionContext(root, selected);
      return { ...prerequisites,
        unavailable: [Object.freeze({ kind: "context" as const, identity: "mode", state: "missing" as const, reasonCode: "WORK_COMPLETION_PUBLICATION_MODE_MISSING" }), ...prerequisites.unavailable] };
    }
    const selected = parseCanonicalCompletionPublicationRequest(request);
    const prerequisites = await prepareCompletionInspectionContext(root, { rootIdentity: selected.rootIdentity, manifestPath: selected.manifestPath });
    if (prerequisites.unavailable.length !== 0) return prerequisites;
    const context = await preparePublicationContext(root, selected, true);
    // Retained recovery reauthentication currently requires native scratch. Never run it in an observer.
    if (context.snapshot !== null || context.packet === undefined) {
      refuse("WORK_COMPLETION_SNAPSHOT_REAUTHENTICATION_REQUIRED", "Retained publication requires native recovery; observation cannot create reconstruction scratch.", exitCodes.CURRENTNESS_FAILURE);
    }
    return { packet: context.packet, manifestPath: context.selected.manifestPath,
      facts: [...packetPreflightFacts(context.packet, context.authority),
        ...context.bundles.map(bundle => preflightFact("proof-bundle", bundle.proof.proofResultIri, bundle.bundleDigest))] };
  });
}

function publicationReceiptPath(root: string, repositoryPath: string, createParent: boolean, pendingIdentity?: { dev: number; ino: number }): string {
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
    const ownedPendingLink = pendingIdentity !== undefined && entry.nlink === 2
      && entry.dev === pendingIdentity.dev && entry.ino === pendingIdentity.ino;
    if (entry.isSymbolicLink() || !entry.isFile() || (entry.nlink !== 1 && !ownedPendingLink) || entry.uid !== processUid(entry.uid)
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
  const expectedValidationDigest = createWorkCompletionPublicationReceipt({
    ...receipt,
    authority,
    manifestDigest: receipt.schema === "urn:usf:work-completion-publication-receipt:1"
      ? receipt.manifestDigest : receipt.members[0]!.manifestDigest,
  }).validationResultDigest;
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

function publicationSnapshotBinding(graph: LoadedSemanticGraph, authority: NoChangeCompletionAuthority): PublicationSnapshotBinding | null {
  const selected = (subject: string, property: string, kind: "iri" | "literal"): string => {
    const rows = graph.quads.filter(q => q.subject === subject && q.predicate === predicate(property));
    const values = [...new Set(rows.map(q => q.object))];
    if (rows.some(q => q.objectKind !== kind) || values.length !== 1) {
      refuse("WORK_COMPLETION_SNAPSHOT_AUTHORITY_INVALID", "Snapshot authority must be uniquely graph-selected.", exitCodes.CURRENTNESS_FAILURE, { subject, property });
    }
    return values[0]!;
  };
  const hasRoot = graph.quads.some(q => q.subject === authority.policy.iri && q.predicate === predicate("publicationSnapshotRoot"));
  const hasSchema = graph.quads.some(q => q.subject === authority.policy.iri && q.predicate === predicate("publicationSnapshotSchema"));
  if (!hasRoot && !hasSchema) return null;
  const snapshotRoot = selected(authority.policy.iri, "publicationSnapshotRoot", "literal");
  const schema = selected(authority.policy.iri, "publicationSnapshotSchema", "iri");
  const schemaPath = selected(schema, "repositoryPath", "literal");
  const record = selected(schema, "recordSpecification", "iri");
  const fragment = selected(record, "schemaFragment", "literal");
  if (!snapshotRoot.startsWith(authority.candidateRoot) || !snapshotRoot.endsWith("/")
    || snapshotRoot.split("/").some((part, index, parts) => part === ".." || part === "." || (part === "" && index !== parts.length - 1))
    || parseRepositoryPath(schemaPath, "file") === null || !/^\/\$defs\/[A-Za-z][A-Za-z0-9]*$/.test(fragment)) {
    refuse("WORK_COMPLETION_SNAPSHOT_AUTHORITY_INVALID", "Snapshot paths or record selection escape the admitted policy.", exitCodes.CONTAINMENT_REFUSAL);
  }
  const identities = new Set<string>();
  const pending = [schemaPath];
  const collectRefs = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) collectRefs(item); return; }
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string" && item.startsWith("urn:usf:")) identities.add(item.split("#", 1)[0]!);
      else collectRefs(item);
    }
  };
  const paths = new Set<string>([schemaPath]);
  const identityPaths = new Map<string, string>();
  const visited = new Set<string>();
  while (pending.length !== 0) {
    const path = pending.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);
    let document: unknown;
    try { document = JSON.parse(readFileSync(resolve(graph.repositoryRoot, path), "utf8")); }
    catch { refuse("WORK_COMPLETION_SNAPSHOT_AUTHORITY_INVALID", "Snapshot schema dependency bytes are unavailable.", exitCodes.CURRENTNESS_FAILURE, { path }); }
    collectRefs(document);
    for (const identity of [...identities]) {
      if (identityPaths.has(identity)) continue;
      const schemaRows = graph.quads.filter(q => q.predicate === predicate("schemaIdentity") && q.objectKind === "iri" && q.object === identity);
      const subjects = [...new Set(schemaRows.map(q => q.subject))];
      const repositoryPaths = [...new Set(subjects.flatMap(subject => graph.quads
        .filter(q => q.subject === subject && q.predicate === predicate("repositoryPath") && q.objectKind === "literal")
        .map(q => q.object)))];
      if (subjects.length !== 1 || repositoryPaths.length !== 1 || parseRepositoryPath(repositoryPaths[0]!, "file") === null) {
        refuse("WORK_COMPLETION_SNAPSHOT_AUTHORITY_INVALID", "Snapshot schema dependency identity is not uniquely graph-bound.", exitCodes.CURRENTNESS_FAILURE, { identity });
      }
      paths.add(repositoryPaths[0]!);
      identityPaths.set(identity, repositoryPaths[0]!);
      pending.push(repositoryPaths[0]!);
    }
  }
  return Object.freeze({ root: snapshotRoot, schemaPath, schemaPaths: Object.freeze([...paths].sort(utf8Compare)), fragment });
}

function snapshotSchema(root: string, binding: PublicationSnapshotBinding, value: unknown): asserts value is CompletionPublicationSnapshot {
  const schema = JSON.parse(readFileSync(resolve(root, binding.schemaPath), "utf8")) as { $schema?: string; $defs?: Record<string, unknown> };
  const dependencies = binding.schemaPaths
    .filter((path) => path !== binding.schemaPath)
    .map((path) => JSON.parse(readFileSync(resolve(root, path), "utf8")));
  const rootSchema = {
    $schema: schema.$schema,
    $id: "urn:usf:completion-publication-snapshot-validation:1",
    $defs: schema.$defs,
    $ref: `#${binding.fragment}`,
  };
  const cacheKey = sha256(canonicalJson({ rootSchema, dependencies }, { rejectAbsolutePaths: true }));
  let validator = snapshotValidatorCache.get(cacheKey);
  if (validator === undefined) {
    validator = createJsonSchemaValidator(rootSchema, { dependencySchemas: dependencies });
    if (snapshotValidatorCache.size >= MAX_SNAPSHOT_VALIDATOR_CACHE_ENTRIES) {
      const oldest = snapshotValidatorCache.keys().next().value;
      if (typeof oldest === "string") snapshotValidatorCache.delete(oldest);
    }
    snapshotValidatorCache.set(cacheKey, validator);
  }
  const result = validator.validate(value);
  if (!result.valid) refuse("WORK_COMPLETION_SNAPSHOT_SCHEMA_INVALID", "Snapshot failed its graph-selected generated record schema.", exitCodes.CURRENTNESS_FAILURE);
}

function publicationInputPath(path: string): boolean {
  if (parseRepositoryPath(path, "file") !== null) return true;
  if (/^\.usf\/receipts\/check\/[0-9a-f]{64}\/[0-9a-f]{64}(?:\.intent)?\.json(?:\.pending)?$/.test(path)) return true;
  if (/^\.usf\/receipts\/check\/[0-9a-f]{64}\/completion-validation-seed\.json$/.test(path)) return true;
  const workspace = /^\.usf\/workspaces\/[0-9a-f]{64}\/(.+)$/.exec(path);
  return workspace !== null && parseRepositoryPath(workspace[1]!, "file") !== null;
}

function readPublicationFile(root: string, path: string, privateFile = false, snapshotRoot?: string): { bytes: Buffer; mode: number } {
  const snapshotFile = snapshotRoot !== undefined && path.startsWith(snapshotRoot)
    && /^[0-9a-f]{64}\/[0-9a-f]{64}\/(?:snapshot\.json|source\.pending|files\/[0-9]{4}\.bin)$/.test(path.slice(snapshotRoot.length));
  if (!publicationInputPath(path) && !snapshotFile) refuse("WORK_COMPLETION_SNAPSHOT_PATH_INVALID", "Snapshot input requires one contained file path.", exitCodes.CONTAINMENT_REFUSAL, { path });
  const absolute = resolve(root, path);
  let cursor = realpathSync(root);
  for (const segment of dirname(path).split("/")) {
    if (segment === ".") continue;
    cursor = resolve(cursor, segment);
    const entry = lstatSync(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(cursor) !== cursor || entry.uid !== processUid(entry.uid)) {
      refuse("WORK_COMPLETION_SNAPSHOT_PATH_UNSAFE", "Snapshot input ancestry is unsafe.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
  const named = lstatSync(absolute);
  const fd = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== processUid(before.uid)
      || before.dev !== named.dev || before.ino !== named.ino || before.mode !== named.mode
      || before.size > 16 * 1024 * 1024 || (privateFile && (before.mode & 0o777) !== 0o600)) {
      refuse("WORK_COMPLETION_SNAPSHOT_FILE_UNSAFE", "Snapshot input is not one bounded authenticated regular file.", exitCodes.CONTAINMENT_REFUSAL);
    }
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const finalName = lstatSync(absolute);
    if (after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode || after.nlink !== 1
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || finalName.dev !== before.dev || finalName.ino !== before.ino || bytes.length !== before.size) {
      refuse("WORK_COMPLETION_SNAPSHOT_INPUT_CHANGED", "Snapshot input changed while read.", exitCodes.CURRENTNESS_FAILURE);
    }
    return { bytes, mode: before.mode & 0o777 };
  } finally { closeSync(fd); }
}

function buildPublicationSnapshot(root: string, prepared: PreparedPublication, bundles: readonly CompletionProofBundle[], binding: PublicationSnapshotBinding): PreparedPublicationSnapshot {
  const paths = new Set<string>([
    ...prepared.graph.sources.map(source => source.path),
    ...prepared.graph.manifests.map(manifest => manifest.path),
    ...prepared.authority.schemaPaths, ...prepared.authority.toolPaths, ...binding.schemaPaths,
  ]);
  const addTree = (path: string, depth = 0): void => {
    if (depth > 32 || paths.size > 1024) refuse("WORK_COMPLETION_SNAPSHOT_BOUNDS", "Snapshot input closure exceeds its bound.", exitCodes.CONTAINMENT_REFUSAL);
    const info = lstatSync(resolve(root, path));
    if (info.isSymbolicLink()) refuse("WORK_COMPLETION_SNAPSHOT_PATH_UNSAFE", "Snapshot refuses linked input trees.", exitCodes.CONTAINMENT_REFUSAL);
    if (info.isDirectory()) for (const name of readdirSync(resolve(root, path)).sort()) addTree(`${path}/${name}`, depth + 1);
    else if (info.isFile()) paths.add(path);
    else refuse("WORK_COMPLETION_SNAPSHOT_PATH_UNSAFE", "Snapshot refuses special input files.", exitCodes.CONTAINMENT_REFUSAL);
  };
  const ordered = [...bundles].sort((a, b) => utf8Compare(a.evidence.workIri, b.evidence.workIri));
  for (const bundle of ordered) {
    const packet = exactPacket(prepared.graph, prepared.receipt.profileIri, bundle.evidence.workIri);
    for (const dependency of packet.realisationBasis!.work.dependencies) {
      if (dependency.kind !== "semantic-resource" && dependency.kind !== "semantic-graph" && existsSync(resolve(root, dependency.key))) paths.add(dependency.key);
    }
    addTree(`.usf/workspaces/${bundle.evidence.candidateDigest.slice(7)}`);
    for (const reference of bundle.evidence.validationResults) {
      paths.add(reference.receiptPath);
      const checked = JSON.parse(readPublicationFile(root, reference.receiptPath).bytes.toString("utf8")) as CheckedCandidateReceipt;
      for (const dependency of checked.validationAuthorityDependencies) paths.add(dependency.path);
      for (const suffix of [".intent.json", ".intent.json.pending", ".json.pending"]) {
        const path = reference.receiptPath.replace(/\.json$/, suffix);
        if (existsSync(resolve(root, path))) paths.add(path);
      }
    }
  }
  paths.delete(prepared.authority.sourcePath);
  const files: CompletionPublicationSnapshot["files"][number][] = [];
  const payloads = new Map<string, Buffer>();
  let totalBytes = 0;
  const add = (role: CompletionPublicationSnapshot["files"][number]["role"], bytes: Buffer, sourcePath?: string, sourceMode?: number): void => {
    totalBytes += bytes.length;
    if (files.length >= 1024 || bytes.length > 16 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) {
      refuse("WORK_COMPLETION_SNAPSHOT_BOUNDS", "Snapshot exceeds the declared file or aggregate bound.", exitCodes.CONTAINMENT_REFUSAL);
    }
    const path = `files/${String(files.length).padStart(4, "0")}.bin`;
    files.push(Object.freeze({ path, role, digest: sha256(bytes), byteLength: bytes.length,
      ...(sourcePath === undefined ? {} : { sourcePath, sourceMode: sourceMode! }) }));
    payloads.set(path, bytes);
  };
  for (const path of [...paths].sort(utf8Compare)) {
    const value = readPublicationFile(root, path);
    add("authority-input", value.bytes, path, value.mode);
  }
  const sourceMode = readPublicationFile(root, prepared.authority.sourcePath).mode;
  add("source-preimage", Buffer.from(prepared.sourceBefore), prepared.authority.sourcePath, sourceMode);
  add("source-postimage", Buffer.from(prepared.sourceAfter), prepared.authority.sourcePath, sourceMode);
  add("expected-receipt", Buffer.from(prepared.receiptBytes));
  for (const bundle of ordered) add("proof-bundle", Buffer.from(`${canonicalJson(bundle, { rejectAbsolutePaths: true })}\n`));
  const metadata: CompletionPublicationSnapshot = Object.freeze({
    schema: "urn:usf:completion-publication-snapshot:1", profile: prepared.receipt.profileIri,
    manifestPath: prepared.receipt.manifestPath, publicationIntentDigest: prepared.receipt.publicationIntentDigest,
    authorityDependencyDigest: prepared.receipt.authorityDependencyDigest,
    sourcePath: prepared.authority.sourcePath, receiptPath: prepared.receipt.publicationReceiptPath,
    receiptDigest: prepared.receipt.receiptDigest,
    members: Object.freeze(ordered.map(bundle => Object.freeze({ work: bundle.evidence.workIri,
      originalBasisDigest: bundle.evidence.realisationBasisDigest, candidateDigest: bundle.evidence.candidateDigest,
      proofBundleDigest: bundle.bundleDigest }))), files: Object.freeze(files),
  });
  snapshotSchema(root, binding, metadata);
  return { metadata, bytes: payloads };
}

function publicationSnapshotGroup(binding: PublicationSnapshotBinding, profile: string, manifestPath: string, works: readonly string[]): string {
  const identity = canonicalDigest({ profile, manifestPath, works: [...works].sort(utf8Compare) }, { rejectAbsolutePaths: true });
  return `${binding.root}${identity.slice(7)}/`;
}

function publicationSnapshotDirectory(binding: PublicationSnapshotBinding, intent: string, profile: string, manifestPath: string, works: readonly string[]): string {
  if (!digestPattern.test(intent)) refuse("WORK_COMPLETION_SNAPSHOT_INTENT_INVALID", "Snapshot intent must be native and content-addressed.");
  return `${publicationSnapshotGroup(binding, profile, manifestPath, works)}${intent.slice(7)}`;
}

function readPublicationSnapshot(root: string, binding: PublicationSnapshotBinding, directory: string): PreparedPublicationSnapshot {
  if (!directory.startsWith(binding.root) || !/^[0-9a-f]{64}\/[0-9a-f]{64}$/.test(directory.slice(binding.root.length))) {
    refuse("WORK_COMPLETION_SNAPSHOT_PATH_INVALID", "Snapshot directory is not an exact policy-derived intent.", exitCodes.CONTAINMENT_REFUSAL);
  }
  assertPrivateDirectory(root, directory, false);
  const metadataBytes = readPublicationFile(root, `${directory}/snapshot.json`, true, binding.root).bytes;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes)); }
  catch { return refuse("WORK_COMPLETION_SNAPSHOT_INVALID", "Snapshot metadata is not strict UTF-8 JSON.", exitCodes.CURRENTNESS_FAILURE); }
  snapshotSchema(root, binding, value);
  const metadata = value;
  if (publicationSnapshotDirectory(binding, metadata.publicationIntentDigest, metadata.profile, metadata.manifestPath, metadata.members.map(member => member.work)) !== directory
    || `${canonicalJson(metadata, { rejectAbsolutePaths: true })}\n` !== metadataBytes.toString("utf8")
    || !receiptPathPattern.test(metadata.receiptPath)) {
    refuse("WORK_COMPLETION_SNAPSHOT_IDENTITY_INVALID", "Snapshot metadata does not bind its exact canonical intent.", exitCodes.CURRENTNESS_FAILURE);
  }
  const paths = new Set<string>();
  const originals = new Set<string>();
  const payloads = new Map<string, Buffer>();
  const roleCounts = new Map<string, number>();
  let total = 0;
  for (const file of metadata.files) {
    if (!/^files\/[0-9]{4}\.bin$/.test(file.path) || paths.has(file.path)) {
      refuse("WORK_COMPLETION_SNAPSHOT_INVENTORY_INVALID", "Snapshot file inventory is duplicate or outside its bounded payload directory.", exitCodes.CONTAINMENT_REFUSAL);
    }
    const sourceBacked = ["authority-input", "source-preimage", "source-postimage"].includes(file.role);
    if (sourceBacked ? file.sourcePath === undefined || file.sourceMode === undefined
      : file.sourcePath !== undefined || file.sourceMode !== undefined) {
      refuse("WORK_COMPLETION_SNAPSHOT_INVENTORY_INVALID", "Snapshot source provenance does not match its typed role.", exitCodes.CURRENTNESS_FAILURE);
    }
    if (sourceBacked && !publicationInputPath(file.sourcePath!)) {
      refuse("WORK_COMPLETION_SNAPSHOT_PATH_INVALID", "Snapshot source provenance is not contained.", exitCodes.CONTAINMENT_REFUSAL);
    }
    if (file.role === "authority-input") {
      if (originals.has(file.sourcePath!) || file.sourcePath === metadata.sourcePath || file.sourcePath === metadata.receiptPath) {
        refuse("WORK_COMPLETION_SNAPSHOT_INVENTORY_INVALID", "Authority inventory repeats a source or includes the planned publication effect.", exitCodes.CURRENTNESS_FAILURE);
      }
      originals.add(file.sourcePath!);
    } else if ((file.role === "source-preimage" || file.role === "source-postimage") && file.sourcePath !== metadata.sourcePath) {
      refuse("WORK_COMPLETION_SNAPSHOT_INVENTORY_INVALID", "Source images do not bind the declared publication path.", exitCodes.CURRENTNESS_FAILURE);
    }
    const read = readPublicationFile(root, `${directory}/${file.path}`, true, binding.root);
    total += read.bytes.length;
    if (read.bytes.length !== file.byteLength || sha256(read.bytes) !== file.digest || total > 64 * 1024 * 1024) {
      refuse("WORK_COMPLETION_SNAPSHOT_CONTENT_INVALID", "Snapshot bytes, size or aggregate bound do not authenticate.", exitCodes.CURRENTNESS_FAILURE);
    }
    paths.add(file.path); payloads.set(file.path, read.bytes);
    roleCounts.set(file.role, (roleCounts.get(file.role) ?? 0) + 1);
  }
  if (["source-preimage", "source-postimage", "expected-receipt"].some(role => roleCounts.get(role) !== 1)
    || roleCounts.get("proof-bundle") !== metadata.members.length
    || new Set(metadata.members.map(member => member.work)).size !== metadata.members.length
    || new Set(metadata.members.map(member => member.proofBundleDigest)).size !== metadata.members.length) {
    refuse("WORK_COMPLETION_SNAPSHOT_MEMBER_INVALID", "Snapshot does not preserve the exact source/receipt/cohort denominator.", exitCodes.CURRENTNESS_FAILURE);
  }
  const bundles = metadata.files.filter(file => file.role === "proof-bundle").map(file => {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloads.get(file.path)!));
    validateCompletionBundleShape(parsed);
    return parsed as CompletionProofBundle;
  });
  for (const member of metadata.members) {
    const matching = bundles.filter(bundle => bundle.bundleDigest === member.proofBundleDigest);
    if (matching.length !== 1 || matching[0]!.evidence.workIri !== member.work
      || matching[0]!.evidence.realisationBasisDigest !== member.originalBasisDigest
      || matching[0]!.evidence.candidateDigest !== member.candidateDigest) {
      refuse("WORK_COMPLETION_SNAPSHOT_MEMBER_INVALID", "Snapshot bundle identities do not match member provenance.", exitCodes.CURRENTNESS_FAILURE);
    }
  }
  const entries = readdirSync(resolve(root, directory)).sort();
  if (entries.some(name => !["files", "snapshot.json", "source.pending", "receipt.pending"].includes(name))
    || canonicalJson(readdirSync(resolve(root, directory, "files")).sort())
      !== canonicalJson([...paths].map(path => path.slice("files/".length)).sort())) {
    refuse("WORK_COMPLETION_SNAPSHOT_INVENTORY_INVALID", "Snapshot contains undeclared runtime entries.", exitCodes.CONTAINMENT_REFUSAL);
  }
  // This authenticates storage and lineage shape only. Reproof against the
  // original semantic preimage is mandatory before any publication effect.
  return { metadata, bytes: payloads };
}

function persistPublicationSnapshot(root: string, binding: PublicationSnapshotBinding, prepared: PreparedPublicationSnapshot): string {
  const directory = publicationSnapshotDirectory(binding, prepared.metadata.publicationIntentDigest,
    prepared.metadata.profile, prepared.metadata.manifestPath, prepared.metadata.members.map(member => member.work));
  if (existsSync(resolve(root, directory))) {
    const retained = readPublicationSnapshot(root, binding, directory);
    if (canonicalJson(retained.metadata) !== canonicalJson(prepared.metadata)) {
      refuse("WORK_COMPLETION_SNAPSHOT_CONFLICT", "Retained snapshot conflicts with independently prepared publication.", exitCodes.INTEGRATION_CONFLICT);
    }
    return directory;
  }
  assertPrivateDirectory(root, `${directory}/files`, true);
  for (const file of prepared.metadata.files) {
    atomicCreate(resolve(root, directory, file.path), prepared.bytes.get(file.path)!, 0o600);
  }
  atomicCreate(resolve(root, directory, "snapshot.json"), `${canonicalJson(prepared.metadata, { rejectAbsolutePaths: true })}\n`, 0o600);
  fsyncDirectory(resolve(root, directory, "files"));
  // Persist every newly created ancestor before the primary source can change.
  const repository = realpathSync(root);
  for (let current = resolve(root, directory); ; current = dirname(current)) {
    fsyncDirectory(current);
    if (current === repository) break;
    if (dirname(current) === current) refuse("WORK_COMPLETION_SNAPSHOT_PATH_UNSAFE", "Snapshot durability path escaped the repository.", exitCodes.CONTAINMENT_REFUSAL);
  }
  const retained = readPublicationSnapshot(root, binding, directory);
  if (canonicalJson(retained.metadata) !== canonicalJson(prepared.metadata)) {
    refuse("WORK_COMPLETION_SNAPSHOT_CONFLICT", "Durable snapshot readback changed before publication.", exitCodes.CURRENTNESS_FAILURE);
  }
  return directory;
}

async function reauthenticatePublicationSnapshot(
  root: string, request: PublishRequest, authority: NoChangeCompletionAuthority,
  binding: PublicationSnapshotBinding, retained: PreparedPublicationSnapshot,
): Promise<{ prepared: Omit<PreparedPublication, "graph">; bundles: readonly CompletionProofBundle[] }> {
  const metadata = retained.metadata;
  if (metadata.profile !== request.profile || metadata.manifestPath !== request.manifestPath
    || metadata.sourcePath !== authority.sourcePath
    || metadata.receiptPath !== `${authority.receiptRoot}${metadata.publicationIntentDigest.slice(7)}.json`) {
    refuse("WORK_COMPLETION_SNAPSHOT_AUTHORITY_MISMATCH", "Retained snapshot does not select the current publication authority.", exitCodes.CURRENTNESS_FAILURE);
  }
  const fileFor = (role: string) => metadata.files.find(file => file.role === role)!;
  const beforeFile = fileFor("source-preimage");
  const afterFile = fileFor("source-postimage");
  const before = retained.bytes.get(beforeFile.path)!;
  const after = retained.bytes.get(afterFile.path)!;
  const source = readPublicationFile(root, authority.sourcePath);
  if ((!source.bytes.equals(before) && !source.bytes.equals(after)) || source.mode !== beforeFile.sourceMode
    || afterFile.sourceMode !== beforeFile.sourceMode) {
    refuse("WORK_COMPLETION_PUBLICATION_PARTIAL_STATE", "Current source is neither the exact retained preimage nor postimage.", exitCodes.INTEGRATION_CONFLICT);
  }
  const bundles = metadata.files.filter(file => file.role === "proof-bundle").map(file =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(retained.bytes.get(file.path)!)) as CompletionProofBundle);
  const view = copyCandidateRepository(root);
  try {
    // The original graph is reconstructed only in native validation scratch.
    // Primary bytes are never rolled back to make old evidence appear current.
    atomicWrite(resolve(view, authority.sourcePath), before, beforeFile.sourceMode!);
    const copiedReceipt = resolve(view, metadata.receiptPath);
    if (existsSync(copiedReceipt)) unlinkSync(copiedReceipt);
    const originalGraph = loadSemanticGraph(view, request.manifestPath);
    let copiedFiles = 0;
    let copiedBytes = 0;
    const copyRuntimeTree = (path: string, depth = 0): void => {
      if (depth > 32 || copiedFiles > 1024 || copiedBytes > 64 * 1024 * 1024) {
        refuse("WORK_COMPLETION_SNAPSHOT_BOUNDS", "Original runtime reconstruction exceeds the admitted bound.", exitCodes.CONTAINMENT_REFUSAL);
      }
      const info = lstatSync(resolve(root, path));
      if (info.isSymbolicLink() || info.uid !== processUid(info.uid)) refuse("WORK_COMPLETION_SNAPSHOT_PATH_UNSAFE", "Original runtime input is linked or foreign-owned.", exitCodes.CONTAINMENT_REFUSAL);
      const destination = resolve(view, path);
      if (info.isDirectory()) {
        if (!existsSync(destination)) mkdirSync(destination, { recursive: true, mode: info.mode & 0o777 });
        for (const name of readdirSync(resolve(root, path)).sort()) copyRuntimeTree(`${path}/${name}`, depth + 1);
      } else {
        const input = readPublicationFile(root, path);
        copiedFiles += 1; copiedBytes += input.bytes.length;
        if (copiedFiles > 1024 || copiedBytes > 64 * 1024 * 1024) refuse("WORK_COMPLETION_SNAPSHOT_BOUNDS", "Original runtime input exceeds the admitted bound.", exitCodes.CONTAINMENT_REFUSAL);
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        atomicCreate(destination, input.bytes, input.mode);
      }
    };
    assertPrivateDirectory(view, ".usf", true);
    for (const member of metadata.members) {
      const packet = exactPacket(originalGraph, request.profile, member.work);
      const selectedAuthority = deriveNoChangeCompletionAuthority(originalGraph, member.work);
      if (packet.realisationBasis === undefined || packet.realisationBasis.basisDigest !== member.originalBasisDigest
        || await deriveNoChangeCandidateIdentity(view, packet.realisationBasis, selectedAuthority.policy) !== member.candidateDigest) {
        refuse("WORK_COMPLETION_SNAPSHOT_MEMBER_INVALID", "Original graph does not independently derive the retained member basis and candidate.", exitCodes.CURRENTNESS_FAILURE);
      }
      copyRuntimeTree(`.usf/workspaces/${member.candidateDigest.slice(7)}`);
      const checks = `.usf/receipts/check/${member.candidateDigest.slice(7)}`;
      if (existsSync(resolve(root, checks))) copyRuntimeTree(checks);
    }
    const prepared = await preparePublication(view, request, bundles, true);
    const expectedBinding = publicationSnapshotBinding(prepared.graph, prepared.authority);
    if (expectedBinding === null || canonicalJson(expectedBinding) !== canonicalJson(binding)
      || prepared.state !== "absent" || prepared.receiptBytes !== retained.bytes.get(fileFor("expected-receipt").path)!.toString("utf8")
      || !Buffer.from(prepared.sourceAfter).equals(after)) {
      refuse("WORK_COMPLETION_SNAPSHOT_REPROOF_FAILED", "Retained bytes do not reproduce the native original publication.", exitCodes.CURRENTNESS_FAILURE);
    }
    const expected = buildPublicationSnapshot(view, prepared, bundles, binding);
    if (canonicalJson(expected.metadata) !== canonicalJson(metadata)) {
      refuse("WORK_COMPLETION_SNAPSHOT_REPROOF_FAILED", "Retained snapshot differs from the complete independently rederived input denominator.", exitCodes.CURRENTNESS_FAILURE);
    }
    for (const file of metadata.files.filter(file => file.role === "authority-input")) {
      const current = readPublicationFile(root, file.sourcePath!);
      if (current.mode !== file.sourceMode || !current.bytes.equals(retained.bytes.get(file.path)!)) {
        refuse("WORK_COMPLETION_SNAPSHOT_STALE", "An original authority or runtime input changed outside the publication effect.", exitCodes.CURRENTNESS_FAILURE);
      }
    }
    const { graph: _validationGraph, ...effect } = prepared;
    return { prepared: effect, bundles };
  } finally { rmSync(view, { recursive: true, force: true }); }
}

function writePublicationPending(path: string, bytes: Buffer, mode: number): void {
  const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, mode);
  try { writeAllAndVerify(fd, bytes); }
  finally { closeSync(fd); }
  fsyncDirectory(dirname(path));
}

function authenticateReceiptPending(root: string, pendingPath: string, finalPath: string, expected: Buffer): "absent" | "pending" | "linked" {
  const pendingAbsolute = resolve(root, pendingPath);
  if (!existsSync(pendingAbsolute)) return "absent";
  assertPrivateDirectory(root, dirname(pendingPath), false);
  const named = lstatSync(pendingAbsolute);
  const fd = openSync(pendingAbsolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    const finalAbsolute = publicationReceiptPath(root, finalPath, false, before);
    const final = existsSync(finalAbsolute) ? lstatSync(finalAbsolute) : undefined;
    const linked = final !== undefined && final.dev === before.dev && final.ino === before.ino;
    if (!before.isFile() || before.uid !== processUid(before.uid) || before.dev !== named.dev || before.ino !== named.ino
      || (before.mode & 0o777) !== 0o644 || before.size !== expected.length
      || before.nlink !== (linked ? 2 : 1) || (final !== undefined && !linked)
      || !readFileSync(fd).equals(expected)) {
      refuse("WORK_COMPLETION_RECEIPT_PENDING_CONFLICT", "Pending receipt does not authenticate the exact original publication.", exitCodes.INTEGRATION_CONFLICT);
    }
    const after = fstatSync(fd);
    if (after.ino !== before.ino || after.dev !== before.dev || after.nlink !== before.nlink || after.mode !== before.mode
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      refuse("WORK_COMPLETION_RECEIPT_PENDING_CONFLICT", "Pending receipt changed during authentication.", exitCodes.INTEGRATION_CONFLICT);
    }
    return linked ? "linked" : "pending";
  } finally { closeSync(fd); }
}

async function applyPublicationSnapshot(
  root: string, request: PublishRequest, binding: PublicationSnapshotBinding, directory: string,
  retained: PreparedPublicationSnapshot,
): Promise<Record<string, unknown>> {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const authority = deriveNoChangeCompletionAuthority(graph, retained.metadata.members[0]!.work);
  const { prepared, bundles } = await reauthenticatePublicationSnapshot(root, request, authority, binding, retained);
  const sourceBefore = Buffer.from(prepared.sourceBefore);
  const sourceAfter = Buffer.from(prepared.sourceAfter);
  const receiptBytes = Buffer.from(prepared.receiptBytes);
  const sourceMode = retained.metadata.files.find(file => file.role === "source-preimage")!.sourceMode!;
  const sourcePending = `${directory}/source.pending`;
  const receiptPending = `${directory}/receipt.pending`;
  let source = readPublicationFile(root, authority.sourcePath);
  let pending = authenticateReceiptPending(root, receiptPending, prepared.receipt.publicationReceiptPath, receiptBytes);
  const finalReceipt = pending === "linked"
    ? resolve(root, prepared.receipt.publicationReceiptPath)
    : publicationReceiptPath(root, prepared.receipt.publicationReceiptPath, false);
  if (source.bytes.equals(sourceBefore) && (pending !== "absent" || existsSync(finalReceipt))) {
    refuse("WORK_COMPLETION_PUBLICATION_PARTIAL_STATE", "Receipt state exists before its source publication.", exitCodes.INTEGRATION_CONFLICT);
  }
  if (request.mode === "verify") {
    if (pending !== "absent" || existsSync(resolve(root, sourcePending)) || (source.bytes.equals(sourceAfter) && !existsSync(finalReceipt))) {
      refuse("WORK_COMPLETION_PUBLICATION_RECONCILIATION_REQUIRED", "The exact retained publication requires apply-mode reconciliation.", exitCodes.CURRENTNESS_FAILURE,
        { publicationIntentDigest: prepared.receipt.publicationIntentDigest });
    }
    if (source.bytes.equals(sourceBefore)) return publicationResult(root, "verify", "absent", prepared.receipt, authority);
    const verified = await preparePublication(root, request, bundles, false);
    return publicationResult(root, "verify", verified.state, verified.receipt, verified.authority);
  }
  let changed = false;
  if (source.bytes.equals(sourceBefore)) {
    if (existsSync(resolve(root, sourcePending))) {
      const retainedPending = readPublicationFile(root, sourcePending, false, binding.root);
      if (retainedPending.mode !== sourceMode || !retainedPending.bytes.equals(sourceAfter)) {
        refuse("WORK_COMPLETION_SOURCE_PENDING_CONFLICT", "Retained source write is not the exact authenticated postimage.", exitCodes.INTEGRATION_CONFLICT);
      }
    } else writePublicationPending(resolve(root, sourcePending), sourceAfter, sourceMode);
    source = readPublicationFile(root, authority.sourcePath);
    if (source.mode !== sourceMode || !source.bytes.equals(sourceBefore)) {
      refuse("WORK_COMPLETION_PUBLICATION_PREIMAGE_CHANGED", "Source changed before the irreversible rename.", exitCodes.INTEGRATION_CONFLICT);
    }
    const finalPending = readPublicationFile(root, sourcePending, false, binding.root);
    if (finalPending.mode !== sourceMode || !finalPending.bytes.equals(sourceAfter)) {
      refuse("WORK_COMPLETION_SOURCE_PENDING_CONFLICT", "Pending source changed before publication.", exitCodes.INTEGRATION_CONFLICT);
    }
    renameSync(resolve(root, sourcePending), resolve(root, authority.sourcePath));
    fsyncDirectory(dirname(resolve(root, authority.sourcePath)));
    fsyncDirectory(resolve(root, directory));
    const written = readPublicationFile(root, authority.sourcePath);
    if (written.mode !== sourceMode || !written.bytes.equals(sourceAfter)) {
      refuse("WORK_COMPLETION_PUBLICATION_READBACK_INVALID", "Source rename did not preserve the authenticated postimage; receipt publication refused.", exitCodes.CURRENTNESS_FAILURE);
    }
    changed = true;
  } else if (!source.bytes.equals(sourceAfter) || source.mode !== sourceMode || existsSync(resolve(root, sourcePending))) {
    refuse("WORK_COMPLETION_PUBLICATION_PARTIAL_STATE", "Postimage source has conflicting pending state.", exitCodes.INTEGRATION_CONFLICT);
  }
  if (!existsSync(finalReceipt)) {
    if (pending === "absent") {
      writePublicationPending(resolve(root, receiptPending), receiptBytes, 0o644);
      pending = "pending";
    }
    if (authenticateReceiptPending(root, receiptPending, prepared.receipt.publicationReceiptPath, receiptBytes) !== "pending") {
      refuse("WORK_COMPLETION_RECEIPT_PENDING_CONFLICT", "Receipt publication is not an exact pending singleton.", exitCodes.INTEGRATION_CONFLICT);
    }
    const destination = publicationReceiptPath(root, prepared.receipt.publicationReceiptPath, true);
    linkSync(resolve(root, receiptPending), destination);
    fsyncDirectory(dirname(destination));
    changed = true;
  }
  pending = authenticateReceiptPending(root, receiptPending, prepared.receipt.publicationReceiptPath, receiptBytes);
  if (pending === "linked") {
    unlinkSync(resolve(root, receiptPending));
    fsyncDirectory(resolve(root, directory));
    fsyncDirectory(dirname(finalReceipt));
    changed = true;
  } else if (pending !== "absent") {
    refuse("WORK_COMPLETION_RECEIPT_PENDING_CONFLICT", "Final receipt is not the authenticated pending hardlink.", exitCodes.INTEGRATION_CONFLICT);
  }
  const readback = await preparePublication(root, request, bundles, false);
  if (readback.state !== "matching" || readback.receipt.receiptDigest !== prepared.receipt.receiptDigest) {
    refuse("WORK_COMPLETION_PUBLICATION_READBACK_INVALID", "Published effects did not authenticate on native readback.", exitCodes.CURRENTNESS_FAILURE);
  }
  return publicationResult(root, "apply", changed ? "created" : "matching", readback.receipt, readback.authority);
}

async function publishCompletion(root: string, request: PublishRequest, values: readonly unknown[]): Promise<Record<string, unknown>> {
  for (const value of values) validateCompletionBundleShape(value);
  const bundles = values as readonly CompletionProofBundle[];
  if (bundles.length === 0) refuse("WORK_COMPLETION_BUNDLE_COUNT_INVALID", "Publication requires a bounded native cohort.");
  const graph = loadSemanticGraph(root, request.manifestPath);
  const authority = deriveNoChangeCompletionAuthority(graph, bundles[0]!.evidence.workIri);
  const binding = publicationSnapshotBinding(graph, authority);
  if (binding !== null) {
    const intent = completionPublicationIntentDigest(bundles, request.profile, request.manifestPath, authority);
    const directory = publicationSnapshotDirectory(binding, intent, request.profile, request.manifestPath, bundles.map(bundle => bundle.evidence.workIri));
    const runRetained = async (): Promise<Record<string, unknown>> => {
      const retained = readPublicationSnapshot(root, binding, directory);
      const expected = [...bundles].map(bundle => bundle.bundleDigest).sort();
      if (canonicalJson(expected) !== canonicalJson(retained.metadata.members.map(member => member.proofBundleDigest).sort())) {
        refuse("WORK_COMPLETION_SNAPSHOT_MEMBER_INVALID", "Requested cohort does not match retained publication lineage.", exitCodes.CURRENTNESS_FAILURE);
      }
      return applyPublicationSnapshot(root, request, binding, directory, retained);
    };
    if (existsSync(resolve(root, directory))) {
      if (request.mode === "verify") return runRetained();
      const lock = await acquirePrimaryMutationLock(root);
      try { return await runRetained(); } finally { await lock.handle.close(); }
    }
    const initial = await preparePublication(root, request, values, true);
    if (request.mode === "verify" || initial.state === "matching") {
      return publicationResult(root, request.mode, initial.state, initial.receipt, initial.authority);
    }
    const lock = await acquirePrimaryMutationLock(root);
    try {
      if (existsSync(resolve(root, directory))) return await runRetained();
      const prepared = await preparePublication(root, request, values, false);
      if (prepared.state !== "absent" || prepared.receipt.receiptDigest !== initial.receipt.receiptDigest) {
        refuse("WORK_COMPLETION_PUBLICATION_CURRENTNESS_CHANGED", "Publication changed while awaiting its mutation lock.", exitCodes.INTEGRATION_CONFLICT);
      }
      const snapshot = buildPublicationSnapshot(root, prepared, bundles, binding);
      persistPublicationSnapshot(root, binding, snapshot);
      return await applyPublicationSnapshot(root, request, binding, directory, readPublicationSnapshot(root, binding, directory));
    } finally { await lock.handle.close(); }
  }
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

export const completionDiagnosisCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  try {
    const input = parseCommandInput(args, "RESOLVE");
    if (input.mode !== "source") throw new UsfError("RESOLVE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, "Check diagnosis requires the registered --input transport.");
    return { output: await prepareCompletionDiagnosis(repositoryRoot, await readCommandInput(repositoryRoot, input, "RESOLVE")) };
  } catch (error) { return asUsfError(error, "WORK_COMPLETION_DIAGNOSIS_REFUSED"); }
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
