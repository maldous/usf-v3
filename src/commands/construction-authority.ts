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
  readSync,
  readFileSync,
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
import { loadSemanticGraph, objectValues, objectsFor, resourceDigest, type LoadedSemanticGraph, type SemanticGraph } from "../graph/index.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../graph/nquads.ts";
import { deriveWork, type WorkPacket } from "../graph/work.ts";
import {
  constructionAuthorityConstants,
  constructionAuthorityNonClaims,
  constructionGrantIri,
  constructionPublicationIntentDigest,
  constructionReceiptPath,
  createConstructionAuthorityReceipt,
  createConstructionEvidenceCandidate,
  createConstructionGrant,
  createConstructionProofBundle,
  constructionRecordLines,
  deriveConstructionAuthority,
  validateConstructionBundleShape,
  validateConstructionEvidenceShape,
  validateConstructionReceiptShape,
  type ConstructionAuthorityPublicationReceipt,
  type ConstructionAuthorityDescriptor,
  type ConstructionEvidenceCandidate,
  type ConstructionProofBundle,
  type ConstructionPublicationMemberInput,
} from "../realisation/construction-authority.ts";
import { acquirePrimaryMutationLock } from "../realisation/transition.ts";
import type { CommandHandler, CommandRequest, CommandResult } from "./dispatcher.ts";
import { publishCommandHandler } from "./publish.ts";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const iriPattern = /^urn:[^<>\s]+$/u;
const candidatePathPattern = /^\.usf\/candidates\/construction-authority\/[A-Za-z0-9._-]+\.json$/u;
const maxCandidateBytes = 4 * 1024 * 1024;
const typePredicate = "urn:usf:predicate:type";
const predicate = (name: string): string => `urn:usf:predicate:${name}`;

interface CommonSelection {
  readonly profile: string;
  readonly manifestPath: string;
  readonly output?: string;
}

interface EvidenceRequest extends CommonSelection { readonly work: string }
interface ProofRequest extends CommonSelection { readonly obligation: string; readonly evidencePath: string }
interface PublishConstructionRequest {
  readonly mode: "verify" | "apply";
  readonly bundlePaths: readonly string[];
  readonly profile: string;
  readonly manifestPath: string;
}

interface PreparedPublication {
  readonly graph: LoadedSemanticGraph;
  readonly receipt: ConstructionAuthorityPublicationReceipt;
  readonly receiptBytes: string;
  readonly sourceBefore: string;
  readonly sourceAfter: string;
  readonly recordLines: readonly string[];
  readonly state: "absent" | "matching";
  readonly affectedWorks: readonly string[];
}

function refuse(code: string, message: string, exitCode: ExitCode = exitCodes.INVALID_INPUT, details?: Record<string, unknown>): never {
  throw new UsfError(code, exitCode, message, details);
}

function asUsfError(error: unknown, fallback: string, exitCode: ExitCode = exitCodes.CURRENTNESS_FAILURE): never {
  if (error instanceof UsfError) throw error;
  const message = error instanceof Error ? error.message.slice(0, 256) : fallback;
  const reason = /^[A-Z0-9_:-]+$/u.test(message) ? message : fallback;
  throw new UsfError(reason.split(":", 1)[0] as string, exitCode, "Construction-authority validation refused.", { reason: message });
}

function optionMap(args: readonly string[], repeatable: ReadonlySet<string> = new Set()): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === undefined || value === undefined || !option.startsWith("--") || value.startsWith("--")) refuse("CONSTRUCTION_ARGUMENTS_INVALID", "Every construction option requires one explicit value.");
    const values = result.get(option) ?? [];
    if (values.length > 0 && !repeatable.has(option)) refuse("CONSTRUCTION_OPTION_DUPLICATE", "A non-repeatable construction option was repeated.", exitCodes.INVALID_INPUT, { option });
    values.push(value);
    result.set(option, values);
  }
  return result;
}

function exactlyOne(options: Map<string, string[]>, name: string): string {
  const values = options.get(name) ?? [];
  if (values.length !== 1) refuse("CONSTRUCTION_OPTION_REQUIRED", "A required construction option is missing.", exitCodes.INVALID_INPUT, { option: name });
  return values[0] as string;
}

function assertKnownOptions(options: Map<string, string[]>, allowed: readonly string[]): void {
  const known = new Set(allowed);
  const unknown = [...options.keys()].filter((name) => !known.has(name));
  if (unknown.length > 0) refuse("CONSTRUCTION_OPTION_UNKNOWN", "An unknown construction option was supplied.", exitCodes.INVALID_INPUT, { options: unknown.sort() });
}

function assertManifestPath(value: string): void {
  if (parseRepositoryPath(value, "file") === null || !/^graph\/manifests\/[A-Za-z0-9._-]+\.json$/u.test(value)) {
    refuse("CONSTRUCTION_MANIFEST_INVALID", "The manifest must be an explicit repository-local graph manifest.", exitCodes.CONTAINMENT_REFUSAL);
  }
}

function parseEvidenceRequest(args: readonly string[]): EvidenceRequest {
  if (args[0] !== "construction") refuse("EVIDENCE_TOPIC_INVALID", "Use the graph-registered evidence construction topic.");
  const options = optionMap(args.slice(1));
  assertKnownOptions(options, ["--work", "--profile", "--manifest", "--output"]);
  const request = { work: exactlyOne(options, "--work"), profile: exactlyOne(options, "--profile"), manifestPath: exactlyOne(options, "--manifest"), ...(options.has("--output") ? { output: exactlyOne(options, "--output") } : {}) };
  if (!iriPattern.test(request.work) || !iriPattern.test(request.profile)) refuse("CONSTRUCTION_IRI_INVALID", "Work and profile must be exact URN IRIs.");
  assertManifestPath(request.manifestPath);
  if (request.output !== undefined && request.output !== "-" && !candidatePathPattern.test(request.output)) refuse("CONSTRUCTION_OUTPUT_PATH_INVALID", "Candidate output must remain under the ignored construction-authority candidate root.", exitCodes.CONTAINMENT_REFUSAL);
  return Object.freeze(request);
}

function parseProofRequest(args: readonly string[]): ProofRequest {
  if (args[0] !== "construction") refuse("PROVE_TOPIC_INVALID", "Use the graph-registered prove construction topic.");
  const options = optionMap(args.slice(1));
  assertKnownOptions(options, ["--obligation", "--evidence", "--profile", "--manifest", "--output"]);
  const request = { obligation: exactlyOne(options, "--obligation"), evidencePath: exactlyOne(options, "--evidence"), profile: exactlyOne(options, "--profile"), manifestPath: exactlyOne(options, "--manifest"), ...(options.has("--output") ? { output: exactlyOne(options, "--output") } : {}) };
  if (!iriPattern.test(request.obligation) || !iriPattern.test(request.profile)) refuse("CONSTRUCTION_IRI_INVALID", "Obligation and profile must be exact URN IRIs.");
  assertManifestPath(request.manifestPath);
  if (request.evidencePath !== "-" && !candidatePathPattern.test(request.evidencePath)) refuse("CONSTRUCTION_EVIDENCE_PATH_INVALID", "Evidence input must be bounded stdin or an ignored construction-authority candidate.", exitCodes.CONTAINMENT_REFUSAL);
  if (request.output !== undefined && request.output !== "-" && !candidatePathPattern.test(request.output)) refuse("CONSTRUCTION_OUTPUT_PATH_INVALID", "Candidate output must remain under the ignored construction-authority candidate root.", exitCodes.CONTAINMENT_REFUSAL);
  return Object.freeze(request);
}

function parsePublishConstructionRequest(args: readonly string[]): PublishConstructionRequest {
  if (args[0] !== "construction-authority") refuse("PUBLISH_TOPIC_INVALID", "Use the graph-registered construction-authority publication topic.");
  const raw = args.slice(1);
  const modes = raw.filter((value) => value === "--verify" || value === "--apply");
  if (modes.length !== 1) refuse("CONSTRUCTION_PUBLICATION_MODE_INVALID", "Choose exactly one of --verify or --apply.");
  const mode = modes[0] === "--apply" ? "apply" as const : "verify" as const;
  const options = optionMap(raw.filter((value) => value !== "--verify" && value !== "--apply"), new Set(["--bundle"]));
  assertKnownOptions(options, ["--bundle", "--profile", "--manifest"]);
  const bundlePaths = options.get("--bundle") ?? [];
  if (bundlePaths.length < 1 || bundlePaths.length > 32 || new Set(bundlePaths).size !== bundlePaths.length || bundlePaths.filter((path) => path === "-").length > 1) refuse("CONSTRUCTION_BUNDLE_SET_INVALID", "Publication requires one through thirty-two distinct bundle inputs and at most one stdin input.");
  if (bundlePaths.some((path) => path !== "-" && !candidatePathPattern.test(path))) refuse("CONSTRUCTION_BUNDLE_PATH_INVALID", "Bundle input must be bounded stdin or an ignored construction-authority candidate.", exitCodes.CONTAINMENT_REFUSAL);
  const profile = exactlyOne(options, "--profile");
  const selectedManifestPath = exactlyOne(options, "--manifest");
  if (!iriPattern.test(profile)) refuse("CONSTRUCTION_PUBLICATION_SELECTION_INVALID", "Publication requires an exact versioned profile and explicit graph manifest.");
  assertManifestPath(selectedManifestPath);
  return Object.freeze({ mode, bundlePaths: Object.freeze(bundlePaths), profile, manifestPath: selectedManifestPath });
}

function processUid(fallback: number): number { return typeof process.getuid === "function" ? process.getuid() : fallback; }

function assertPrivateDirectory(root: string, repositoryPath: string, create: boolean): string {
  if (!repositoryPath.startsWith(".usf/") && repositoryPath !== ".usf") refuse("CONSTRUCTION_PRIVATE_PATH_INVALID", "Private state must remain under .usf.", exitCodes.CONTAINMENT_REFUSAL);
  let cursor = realpathSync(resolve(root));
  for (const segment of repositoryPath.split("/")) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      if (!create) refuse("CONSTRUCTION_PRIVATE_PATH_MISSING", "Required private state directory is absent.", exitCodes.CONTAINMENT_REFUSAL);
      mkdirSync(cursor, { mode: 0o700 });
      chmodSync(cursor, 0o700);
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== processUid(entry.uid) || (entry.mode & 0o077) !== 0 || realpathSync(cursor) !== cursor) refuse("CONSTRUCTION_PRIVATE_PATH_UNSAFE", "Private state ancestry is not owner-contained.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return cursor;
}

function containedCandidatePath(root: string, repositoryPath: string, createParent: boolean): string {
  if (!candidatePathPattern.test(repositoryPath)) refuse("CONSTRUCTION_CANDIDATE_PATH_INVALID", "Candidate path is outside the ignored bounded root.", exitCodes.CONTAINMENT_REFUSAL);
  assertPrivateDirectory(root, ".usf", createParent);
  assertPrivateDirectory(root, ".usf/candidates", createParent);
  assertPrivateDirectory(root, ".usf/candidates/construction-authority", createParent);
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, repositoryPath);
  const rootRelative = relative(canonicalRoot, absolute);
  if (rootRelative === "" || rootRelative === ".." || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) refuse("CONSTRUCTION_CANDIDATE_PATH_ESCAPE", "Candidate path escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  if (existsSync(absolute)) {
    const entry = lstatSync(absolute);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.uid !== processUid(entry.uid) || (entry.mode & 0o177) !== 0 || entry.size > maxCandidateBytes || realpathSync(absolute) !== absolute) refuse("CONSTRUCTION_CANDIDATE_FILE_UNSAFE", "Candidate input is not a bounded owner-private regular file.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return absolute;
}

function readBoundedInput(root: string, path: string, stdinState: { value?: Buffer }): Buffer {
  let bytes: Buffer;
  if (path === "-") {
    if (stdinState.value !== undefined) refuse("CONSTRUCTION_STDIN_REUSED", "Stdin may be consumed at most once.");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxCandidateBytes - total + 1));
      const count = readSync(0, chunk, 0, chunk.length, null);
      if (count === 0) break;
      total += count;
      if (total > maxCandidateBytes) refuse("CONSTRUCTION_INPUT_SIZE_INVALID", "Construction input must be non-empty and at most four MiB.");
      chunks.push(chunk.subarray(0, count));
    }
    bytes = Buffer.concat(chunks, total);
    stdinState.value = bytes;
  } else {
    const absolute = containedCandidatePath(root, path, false);
    const named = lstatSync(absolute);
    let descriptor: number;
    try { descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
    catch { return refuse("CONSTRUCTION_CANDIDATE_FILE_UNSAFE", "Candidate input could not be opened without following links.", exitCodes.CONTAINMENT_REFUSAL); }
    try {
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
        || opened.mode !== named.mode || opened.nlink !== 1 || opened.size !== named.size || opened.size > maxCandidateBytes) {
        refuse("CONSTRUCTION_CANDIDATE_FILE_UNSAFE", "Candidate input changed while it was opened.", exitCodes.CONTAINMENT_REFUSAL);
      }
      bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.uid !== opened.uid || after.mode !== opened.mode
        || after.nlink !== opened.nlink || after.size !== opened.size || bytes.byteLength !== opened.size) {
        refuse("CONSTRUCTION_CANDIDATE_FILE_UNSAFE", "Candidate input changed while it was read.", exitCodes.CONTAINMENT_REFUSAL);
      }
    } finally { closeSync(descriptor); }
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maxCandidateBytes) refuse("CONSTRUCTION_INPUT_SIZE_INVALID", "Construction input must be non-empty and at most four MiB.");
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { refuse("CONSTRUCTION_INPUT_UTF8_INVALID", "Construction input must be valid UTF-8."); }
  return bytes;
}

function parseJsonInput(root: string, path: string, stdinState: { value?: Buffer }): unknown {
  try { return JSON.parse(readBoundedInput(root, path, stdinState).toString("utf8")); }
  catch (error) {
    if (error instanceof UsfError) throw error;
    return refuse("CONSTRUCTION_INPUT_JSON_INVALID", "Construction input must be valid JSON.");
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
    if (count <= 0) refuse("CONSTRUCTION_TEMPORARY_WRITE_INCOMPLETE", "A construction publication temporary made no progress.", exitCodes.CONTAINMENT_REFUSAL);
    written += count;
  }
  fsyncSync(descriptor);
  const entry = fstatSync(descriptor);
  if (!entry.isFile() || entry.size !== expected.length) refuse("CONSTRUCTION_TEMPORARY_WRITE_MISMATCH", "A construction publication temporary has the wrong exact size.", exitCodes.CONTAINMENT_REFUSAL);
  const observed = Buffer.alloc(expected.length);
  let read = 0;
  while (read < observed.length) {
    const count = readSync(descriptor, observed, read, observed.length - read, read);
    if (count <= 0) refuse("CONSTRUCTION_TEMPORARY_WRITE_MISMATCH", "A construction publication temporary could not be read back exactly.", exitCodes.CONTAINMENT_REFUSAL);
    read += count;
  }
  if (!observed.equals(expected)) refuse("CONSTRUCTION_TEMPORARY_WRITE_MISMATCH", "A construction publication temporary does not match its intended bytes.", exitCodes.CONTAINMENT_REFUSAL);
}

let atomicWriteOrdinal = 0;
function temporaryPublicationPath(path: string): string {
  atomicWriteOrdinal += 1;
  return resolve(dirname(path), `.${basename(path)}.usf-construction-${process.pid}-${atomicWriteOrdinal}`);
}

function atomicWrite(path: string, bytes: string | Buffer, mode: number): void {
  const temporary = temporaryPublicationPath(path);
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
  const temporary = temporaryPublicationPath(path);
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

function publicationReceiptPath(root: string, repositoryPath: string, createParent: boolean): string {
  if (!/^evidence\/construction-authority\/[0-9a-f]{64}\.json$/u.test(repositoryPath)) refuse("CONSTRUCTION_RECEIPT_PATH_INVALID", "Construction receipts must use the exact tracked publication root.", exitCodes.CONTAINMENT_REFUSAL);
  const canonicalRoot = realpathSync(resolve(root));
  const absolute = resolve(canonicalRoot, repositoryPath);
  const relation = relative(canonicalRoot, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("CONSTRUCTION_RECEIPT_PATH_ESCAPE", "Construction receipt path escapes the repository.", exitCodes.CONTAINMENT_REFUSAL);
  let cursor = canonicalRoot;
  for (const segment of dirname(repositoryPath).split("/")) {
    const parent = cursor;
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      if (!createParent) break;
      mkdirSync(cursor, { mode: 0o755 });
      chmodSync(cursor, 0o755);
      fsyncDirectory(parent);
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== processUid(entry.uid) || (entry.mode & 0o002) !== 0 || realpathSync(cursor) !== cursor) refuse("CONSTRUCTION_RECEIPT_PATH_UNSAFE", "Construction receipt ancestry is not owner-contained.", exitCodes.CONTAINMENT_REFUSAL);
  }
  if (existsSync(absolute)) {
    const entry = lstatSync(absolute);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.uid !== processUid(entry.uid)
      || (entry.mode & 0o777) !== 0o644 || entry.size > maxCandidateBytes || realpathSync(absolute) !== absolute) {
      refuse("CONSTRUCTION_RECEIPT_FILE_UNSAFE", "Construction receipt is not an exact owner-contained regular file.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
  return absolute;
}

function persistCandidate(root: string, path: string | undefined, value: unknown): void {
  if (path === undefined || path === "-") return;
  const absolute = containedCandidatePath(root, path, true);
  atomicWrite(absolute, `${canonicalJson(value, { rejectAbsolutePaths: true })}\n`, 0o600);
  containedCandidatePath(root, path, false);
}

function dynamicSubjectsForWork(graph: SemanticGraph, workIri: string): Set<string> {
  const dynamicTypes = new Set(["urn:usf:type:Evidence", "urn:usf:type:ProofResult", "urn:usf:type:ConstructionAuthorityGrant"]);
  const typed = new Set(graph.quads.filter((quad) => quad.predicate === typePredicate && quad.objectKind === "iri" && dynamicTypes.has(quad.object)).map((quad) => quad.subject));
  return new Set([...typed].filter((subject) => objectsFor(graph, subject, predicate("forWork")).some((quad) => quad.objectKind === "iri" && quad.object === workIri)));
}

function staticGraphForWork(graph: LoadedSemanticGraph, workIri: string): LoadedSemanticGraph {
  const removed = dynamicSubjectsForWork(graph, workIri);
  if (removed.size === 0) return graph;
  const quads = graph.quads.filter((quad) => !removed.has(quad.subject));
  const graphDigests = Object.fromEntries(Object.keys(graph.graphDigests).sort().map((graphIri) => [graphIri, canonicalQuadDigest(quads.filter((quad) => quad.graph === graphIri))]));
  return { ...graph, quads, semanticDigest: canonicalQuadDigest(quads), graphDigests };
}

function exactStaticPacket(graph: LoadedSemanticGraph, profile: string, workIri: string): WorkPacket {
  const staticGraph = staticGraphForWork(graph, workIri);
  const result = deriveWork(staticGraph, { profile, selector: workIri, maxItems: 1 });
  if (result.status !== "ok" || result.items?.length !== 1 || result.items[0]?.id !== workIri || result.items[0].realisationBasis === undefined) refuse("CONSTRUCTION_WORK_PROJECTION_INVALID", "The exact current static work projection could not be derived.", exitCodes.CURRENTNESS_FAILURE, { reasonCode: result.reasonCode, workIri });
  return result.items[0];
}

function selectedProfileVersion(packet: WorkPacket): string {
  if (packet.decisionBoundary.kind !== "realisation-profile" || packet.decisionBoundary.profileVersion === undefined) refuse("CONSTRUCTION_PROFILE_INVALID", "The selected work is not bound to an explicit versioned profile.", exitCodes.CURRENTNESS_FAILURE);
  return packet.decisionBoundary.profileVersion;
}

function deriveEvidence(root: string, request: EvidenceRequest): ConstructionEvidenceCandidate {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const packet = exactStaticPacket(graph, request.profile, request.work);
  const authority = deriveConstructionAuthority(graph, packet.id, request.manifestPath);
  const evidence = createConstructionEvidenceCandidate(graph, packet, request.manifestPath);
  if (!validateConstructionEvidenceShape(root, evidence, authority)) refuse("CONSTRUCTION_EVIDENCE_SCHEMA_INVALID", "Derived construction evidence failed its graph-selected closed schema.", exitCodes.CURRENTNESS_FAILURE);
  return evidence;
}

function authenticateEvidence(root: string, graph: LoadedSemanticGraph, profile: string, selectedManifestPath: string, value: unknown): { evidence: ConstructionEvidenceCandidate; packet: WorkPacket; authority: ConstructionAuthorityDescriptor } {
  const workIri = typeof value === "object" && value !== null && "workIri" in value && typeof value.workIri === "string" ? value.workIri : "";
  if (!iriPattern.test(workIri)) refuse("CONSTRUCTION_EVIDENCE_SCHEMA_INVALID", "Construction evidence does not identify one exact work.");
  const packet = exactStaticPacket(graph, profile, workIri);
  const authority = deriveConstructionAuthority(graph, packet.id, selectedManifestPath);
  if (!validateConstructionEvidenceShape(root, value, authority)) refuse("CONSTRUCTION_EVIDENCE_SCHEMA_INVALID", "Construction evidence does not satisfy the closed graph-selected schema.");
  const evidence = value as ConstructionEvidenceCandidate;
  if (canonicalDigest(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "contentDigest")), { rejectAbsolutePaths: true }) !== evidence.contentDigest) refuse("CONSTRUCTION_EVIDENCE_DIGEST_INVALID", "Construction evidence content digest is invalid.", exitCodes.CURRENTNESS_FAILURE);
  const expected = createConstructionEvidenceCandidate(graph, packet, selectedManifestPath, evidence.observedSemanticDigest);
  if (canonicalJson(expected, { rejectAbsolutePaths: true }) !== canonicalJson(evidence, { rejectAbsolutePaths: true })) refuse("CONSTRUCTION_EVIDENCE_NOT_CURRENT", "Construction evidence no longer matches its scoped authority basis.", exitCodes.CURRENTNESS_FAILURE);
  return { evidence, packet, authority };
}

function deriveProof(root: string, request: ProofRequest, value: unknown): ConstructionProofBundle {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const { evidence, packet, authority } = authenticateEvidence(root, graph, request.profile, request.manifestPath, value);
  const bundle = createConstructionProofBundle(graph, packet, evidence, request.obligation, request.manifestPath);
  if (!validateConstructionBundleShape(root, bundle, authority)) refuse("CONSTRUCTION_PROOF_SCHEMA_INVALID", "Derived construction proof failed its graph-selected closed schema.", exitCodes.CURRENTNESS_FAILURE);
  return bundle;
}

function authenticateBundle(root: string, graph: LoadedSemanticGraph, profile: string, selectedManifestPath: string, value: unknown): { bundle: ConstructionProofBundle; packet: WorkPacket; authority: ConstructionAuthorityDescriptor } {
  const evidenceValue = typeof value === "object" && value !== null && "evidence" in value ? value.evidence : undefined;
  const authenticatedEvidence = authenticateEvidence(root, graph, profile, selectedManifestPath, evidenceValue);
  if (!validateConstructionBundleShape(root, value, authenticatedEvidence.authority)) refuse("CONSTRUCTION_BUNDLE_SCHEMA_INVALID", "Construction proof bundle does not satisfy the closed graph-selected schema.");
  const bundle = value as ConstructionProofBundle;
  const { evidence, packet, authority } = authenticatedEvidence;
  const expected = createConstructionProofBundle(graph, packet, evidence, bundle.proof.obligationIri, selectedManifestPath);
  if (canonicalJson(expected, { rejectAbsolutePaths: true }) !== canonicalJson(bundle, { rejectAbsolutePaths: true })) refuse("CONSTRUCTION_BUNDLE_NOT_CURRENT", "Construction proof bundle no longer matches its scoped authority basis.", exitCodes.CURRENTNESS_FAILURE);
  if (!digestPattern.test(bundle.bundleDigest)) refuse("CONSTRUCTION_BUNDLE_DIGEST_INVALID", "Construction bundle digest is invalid.", exitCodes.CURRENTNESS_FAILURE);
  return { bundle, packet, authority };
}

function utf8Compare(left: string, right: string): number { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }

function sourcePostimage(sourceBefore: string, lines: readonly string[]): string {
  if (!sourceBefore.endsWith("\n") || sourceBefore.includes("\r")) refuse("CONSTRUCTION_SOURCE_NONCANONICAL", "The semantic source preimage is not canonical.", exitCodes.CURRENTNESS_FAILURE);
  return `${sourceBefore}${lines.join("\n")}\n`;
}

function copyCandidateRepository(root: string): string {
  assertPrivateDirectory(root, ".usf", true);
  const temporaryRoot = assertPrivateDirectory(root, ".usf/tmp", true);
  const candidate = mkdtempSync(resolve(temporaryRoot, "construction-authority-"));
  chmodSync(candidate, 0o700);
  const canonicalRoot = realpathSync(resolve(root));
  const copyTree = (source: string, target: string, depth: number): void => {
    for (const entryName of readdirSync(source).sort()) {
      if (depth === 0 && [".git", ".usf", "node_modules"].includes(entryName)) continue;
      const sourceEntry = resolve(source, entryName);
      const targetEntry = resolve(target, entryName);
      const status = lstatSync(sourceEntry);
      if (status.isSymbolicLink()) refuse("CONSTRUCTION_CANDIDATE_COPY_SYMLINK", "Candidate validation refuses repository symlinks.", exitCodes.CONTAINMENT_REFUSAL);
      if (status.isDirectory()) {
        mkdirSync(targetEntry, { mode: status.mode & 0o777 });
        copyTree(sourceEntry, targetEntry, depth + 1);
      } else if (status.isFile()) {
        copyFileSync(sourceEntry, targetEntry);
        chmodSync(targetEntry, status.mode & 0o777);
      } else refuse("CONSTRUCTION_CANDIDATE_COPY_SPECIAL_FILE", "Candidate validation refuses special files.", exitCodes.CONTAINMENT_REFUSAL);
    }
  };
  copyTree(canonicalRoot, candidate, 0);
  return candidate;
}

function validateCandidateRepository(
  root: string,
  sourceAfter: string,
  receipt: ConstructionAuthorityPublicationReceipt,
  affectedWorks: readonly string[],
  profile: string,
  authority: ConstructionAuthorityDescriptor,
): string {
  const candidate = copyCandidateRepository(root);
  try {
    atomicWrite(resolve(candidate, authority.sourcePath), sourceAfter, statSync(resolve(candidate, authority.sourcePath)).mode & 0o777);
    const receiptAbsolute = publicationReceiptPath(candidate, receipt.publicationReceiptPath, true);
    atomicCreate(receiptAbsolute, `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`, 0o644);
    const candidateGraph = loadSemanticGraph(candidate, authority.manifestPath);
    const full = deriveWork(candidateGraph, { profile, maxItems: 100 });
    if (full.status !== "ok") refuse("CONSTRUCTION_CANDIDATE_GRAPH_INVALID", "The complete candidate graph projection refused.", exitCodes.CURRENTNESS_FAILURE, { reasonCode: full.reasonCode });
    for (const workIri of affectedWorks) {
      const result = deriveWork(candidateGraph, { profile, selector: workIri, maxItems: 1 });
      const packet = result.status === "ok" ? result.items?.[0] : undefined;
      if (packet?.realisationAuthority?.permission?.activationState !== constructionAuthorityConstants.activeState
        || packet.eligibility?.activation.eligible !== true || packet.eligibility.construction.eligible !== true
        || packet.eligibility.construction.authority !== "active-permission") refuse("CONSTRUCTION_CANDIDATE_READBACK_INVALID", "The candidate grant did not establish exact effective construction authority.", exitCodes.CURRENTNESS_FAILURE, {
        workIri,
        activationState: packet?.realisationAuthority?.permission?.activationState,
        activationEligible: packet?.eligibility?.activation.eligible,
        construction: packet?.eligibility?.construction,
        reasonCodes: packet?.eligibility?.activation.reasonCodes,
      });
    }
    return candidateGraph.semanticDigest;
  } finally {
    rmSync(candidate, { recursive: true, force: true });
  }
}

function receiptWithoutDigest(receipt: ConstructionAuthorityPublicationReceipt): Record<string, unknown> {
  const { receiptDigest: _ignored, ...draft } = receipt;
  return draft;
}

function authenticateExistingReceipt(
  root: string,
  path: string,
  expectedIntent: string,
  expectedLines: readonly string[],
  authority: ConstructionAuthorityDescriptor,
): ConstructionAuthorityPublicationReceipt {
  let value: unknown;
  let bytes: Buffer;
  const absolute = publicationReceiptPath(root, path, false);
  let descriptor: number | undefined;
  try {
    const named = lstatSync(absolute);
    descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
      || opened.mode !== named.mode || opened.nlink !== 1 || opened.size !== named.size || opened.size > maxCandidateBytes) {
      refuse("CONSTRUCTION_RECEIPT_FILE_UNSAFE", "Existing construction receipt changed while it was opened.", exitCodes.CONTAINMENT_REFUSAL);
    }
    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.uid !== opened.uid || after.mode !== opened.mode
      || after.nlink !== opened.nlink || after.size !== opened.size || bytes.byteLength !== opened.size) {
      refuse("CONSTRUCTION_RECEIPT_FILE_UNSAFE", "Existing construction receipt changed while it was read.", exitCodes.CONTAINMENT_REFUSAL);
    }
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  catch (error) {
    if (error instanceof UsfError) throw error;
    return refuse("CONSTRUCTION_RECEIPT_INVALID", "Existing construction receipt is unreadable or invalid JSON.", exitCodes.CURRENTNESS_FAILURE);
  }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
  if (!validateConstructionReceiptShape(root, value, authority)) refuse("CONSTRUCTION_RECEIPT_SCHEMA_INVALID", "Existing construction receipt failed its closed schema.", exitCodes.CURRENTNESS_FAILURE);
  const receipt = value as ConstructionAuthorityPublicationReceipt;
  if (`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n` !== bytes.toString("utf8")
    || canonicalDigest(receiptWithoutDigest(receipt), { rejectAbsolutePaths: true }) !== receipt.receiptDigest
    || receipt.publicationIntentDigest !== expectedIntent || receipt.publicationReceiptPath !== path
    || canonicalJson(receipt.operations.map(({ line }) => line).sort()) !== canonicalJson([...expectedLines].sort())) refuse("CONSTRUCTION_RECEIPT_MISMATCH", "Existing construction receipt does not authenticate the exact requested publication.", exitCodes.INTEGRATION_CONFLICT);
  return receipt;
}

function preparePublication(root: string, request: PublishConstructionRequest, values: readonly unknown[], candidateValidation: boolean): PreparedPublication {
  const graph = loadSemanticGraph(root, request.manifestPath);
  const authenticated = values.map((value) => authenticateBundle(root, graph, request.profile, request.manifestPath, value))
    .sort((left, right) => utf8Compare(left.bundle.evidence.workIri, right.bundle.evidence.workIri));
  const authority = authenticated[0]?.authority;
  if (authority === undefined || authenticated.length < authority.minimumBundleCount || authenticated.length > authority.maximumBundleCount
    || authenticated.some((entry) => canonicalJson(entry.authority) !== canonicalJson(authority))) {
    refuse("CONSTRUCTION_PUBLICATION_AUTHORITY_MIXED", "A publication batch must bind one exact graph-selected authority policy.", exitCodes.CURRENTNESS_FAILURE);
  }
  if (new Set(authenticated.map(({ bundle }) => bundle.evidence.workIri)).size !== authenticated.length) refuse("CONSTRUCTION_BUNDLE_WORK_DUPLICATE", "A publication batch cannot repeat a work.");
  const profileVersions = new Set(authenticated.map(({ packet }) => selectedProfileVersion(packet)));
  if (profileVersions.size !== 1) refuse("CONSTRUCTION_PROFILE_VERSION_MIXED", "A publication batch must bind one profile version.", exitCodes.CURRENTNESS_FAILURE);
  const members: ConstructionPublicationMemberInput[] = authenticated.map(({ bundle, packet }) => {
    const permission = packet.realisationAuthority?.permission;
    if (permission === null || permission === undefined || permission.maximumThrough === null) refuse("CONSTRUCTION_PERMISSION_INVALID", "The selected work lacks one exact construction permission.", exitCodes.CURRENTNESS_FAILURE);
    return Object.freeze({ bundle, permissionIri: permission.id, maximumThrough: permission.maximumThrough });
  });
  const identitySets = [
    members.map(({ permissionIri }) => permissionIri), members.map(({ bundle }) => bundle.evidence.evidenceIri), members.map(({ bundle }) => bundle.proof.proofResultIri),
    members.map((member) => constructionGrantIri(member.bundle.evidence.workIri, member.permissionIri, member.bundle.evidence.scopedDependencyDigest)),
  ];
  if (identitySets.some((values) => new Set(values).size !== values.length)) refuse("CONSTRUCTION_PUBLICATION_IDENTITY_DUPLICATE", "A publication batch contains duplicate semantic identities.");
  const intentDigest = constructionPublicationIntentDigest(members.map(({ bundle }) => bundle.bundleDigest), request.profile, request.manifestPath, authority);
  const recordLines = members.flatMap((member) => {
    const { grantIri, grant } = createConstructionGrant(member, request.profile, request.manifestPath, intentDigest, authority);
    return constructionRecordLines(member.bundle, grantIri, grant, authority);
  }).sort();
  if (new Set(recordLines).size !== recordLines.length) refuse("CONSTRUCTION_PUBLICATION_LINE_DUPLICATE", "The publication batch produced duplicate graph lines.");
  parseStrictNQuads(`${recordLines.join("\n")}\n`, authority.targetGraphIri, 1_024);
  const sourceAbsolute = resolve(root, authority.sourcePath);
  const sourceBefore = readFileSync(sourceAbsolute, "utf8");
  const currentLines = new Set(sourceBefore.split("\n").filter((line) => line.length > 0));
  const present = recordLines.filter((line) => currentLines.has(line)).length;
  const receiptPath = constructionReceiptPath(intentDigest, authority);
  const receiptExists = existsSync(publicationReceiptPath(root, receiptPath, false));
  if ((present > 0 && present < recordLines.length) || (present === 0 && receiptExists) || (present === recordLines.length && !receiptExists)) refuse("CONSTRUCTION_PUBLICATION_PARTIAL_STATE", "Construction publication state is partial or conflicting.", exitCodes.INTEGRATION_CONFLICT);
  if (present === recordLines.length) {
    const receipt = authenticateExistingReceipt(root, receiptPath, intentDigest, recordLines, authority);
    for (const { bundle } of authenticated) {
      const result = deriveWork(graph, { profile: request.profile, selector: bundle.evidence.workIri, maxItems: 1 });
      const packet = result.status === "ok" ? result.items?.[0] : undefined;
      if (packet?.realisationAuthority?.permission?.activationState !== constructionAuthorityConstants.activeState || packet.eligibility?.activation.eligible !== true) refuse("CONSTRUCTION_PUBLICATION_MATCHING_READBACK_INVALID", "Existing construction authority did not authenticate on readback.", exitCodes.CURRENTNESS_FAILURE);
    }
    return Object.freeze({ graph, receipt, receiptBytes: `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`, sourceBefore, sourceAfter: sourceBefore, recordLines: Object.freeze(recordLines), state: "matching" as const, affectedWorks: Object.freeze(authenticated.map(({ bundle }) => bundle.evidence.workIri)) });
  }
  const sourceAfter = sourcePostimage(sourceBefore, recordLines);
  const temporary = copyCandidateRepository(root);
  let resultingSemanticDigest: string;
  try {
    atomicWrite(resolve(temporary, authority.sourcePath), sourceAfter, statSync(resolve(temporary, authority.sourcePath)).mode & 0o777);
    resultingSemanticDigest = loadSemanticGraph(temporary, request.manifestPath).semanticDigest;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  const firstPacket = authenticated[0]?.packet;
  if (firstPacket?.realisationBasis === undefined) refuse("CONSTRUCTION_BASIS_MISSING", "Publication basis is absent.", exitCodes.CURRENTNESS_FAILURE);
  const receipt = createConstructionAuthorityReceipt({
    graph,
    authority,
    profileIri: request.profile,
    profileVersion: selectedProfileVersion(firstPacket),
    selectedManifestPath: request.manifestPath,
    manifestDigest: firstPacket.realisationBasis.selection.manifestDigest,
    publicationIntentDigest: intentDigest,
    members,
    baseSource: sourceBefore,
    resultingSource: sourceAfter,
    resultingSemanticDigest,
  });
  if (!validateConstructionReceiptShape(root, receipt, authority)) refuse("CONSTRUCTION_RECEIPT_SCHEMA_INVALID", "Prepared construction receipt failed its closed schema.", exitCodes.CURRENTNESS_FAILURE);
  const receiptBytes = `${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`;
  if (candidateValidation) {
    const validatedDigest = validateCandidateRepository(root, sourceAfter, receipt, authenticated.map(({ bundle }) => bundle.evidence.workIri), request.profile, authority);
    if (validatedDigest !== resultingSemanticDigest) refuse("CONSTRUCTION_CANDIDATE_SEMANTIC_DIGEST_MISMATCH", "Candidate semantic digest changed during validation.", exitCodes.CURRENTNESS_FAILURE);
  }
  return Object.freeze({ graph, receipt, receiptBytes, sourceBefore, sourceAfter, recordLines: Object.freeze(recordLines), state: "absent" as const, affectedWorks: Object.freeze(authenticated.map(({ bundle }) => bundle.evidence.workIri)) });
}

function publicationResult(mode: "verify" | "apply", state: "verified-without-publication" | "created" | "matching", receipt: ConstructionAuthorityPublicationReceipt): Record<string, unknown> {
  return Object.freeze({
    schema: "urn:usf:construction-authority-publication-result:1",
    status: "ok",
    operation: "construction-authority",
    mode,
    publicationState: state,
    publicationReceiptPath: receipt.publicationReceiptPath,
    receiptDigest: receipt.receiptDigest,
    baseSemanticDigest: receipt.baseSemanticDigest,
    resultingSemanticDigest: receipt.resultingSemanticDigest,
    memberCount: receipt.memberCount,
    authorityEffect: state === "created" ? "copy-on-write-construction-authority-created" : state === "matching" ? "existing-copy-on-write-construction-authority-authenticated" : "verified-without-publication",
    nonClaims: constructionAuthorityNonClaims(),
  });
}

async function publishConstruction(root: string, request: PublishConstructionRequest, values: readonly unknown[]): Promise<Record<string, unknown>> {
  const prepared = preparePublication(root, request, values, true);
  if (request.mode === "verify") return publicationResult("verify", "verified-without-publication", prepared.receipt);
  const lock = await acquirePrimaryMutationLock(root);
  try {
    const locked = preparePublication(root, request, values, false);
    if (locked.state === "matching") return publicationResult("apply", "matching", locked.receipt);
    if (locked.receipt.receiptDigest !== prepared.receipt.receiptDigest || locked.sourceBefore !== prepared.sourceBefore || locked.sourceAfter !== prepared.sourceAfter) refuse("CONSTRUCTION_PUBLICATION_CURRENTNESS_CHANGED", "Construction publication currentness changed while waiting for the mutation lock.", exitCodes.INTEGRATION_CONFLICT);
    const sourceAbsolute = resolve(root, locked.receipt.semanticSourcePath);
    const receiptAbsolute = publicationReceiptPath(root, locked.receipt.publicationReceiptPath, true);
    if (readFileSync(sourceAbsolute, "utf8") !== locked.sourceBefore || existsSync(receiptAbsolute)) refuse("CONSTRUCTION_PUBLICATION_PREIMAGE_CHANGED", "Construction publication preimage changed under lock.", exitCodes.INTEGRATION_CONFLICT);
    const sourceMode = statSync(sourceAbsolute).mode & 0o777;
    let receiptCreated = false;
    try {
      atomicWrite(sourceAbsolute, locked.sourceAfter, sourceMode);
      atomicCreate(receiptAbsolute, locked.receiptBytes, 0o644); receiptCreated = true;
      const readback = preparePublication(root, request, values, false);
      if (readback.state !== "matching" || readback.receipt.receiptDigest !== locked.receipt.receiptDigest) refuse("CONSTRUCTION_PUBLICATION_READBACK_INVALID", "Construction publication readback failed.", exitCodes.CURRENTNESS_FAILURE);
      return publicationResult("apply", "created", locked.receipt);
    } catch (error) {
      atomicWrite(sourceAbsolute, locked.sourceBefore, sourceMode);
      if (receiptCreated && existsSync(receiptAbsolute)) { unlinkSync(receiptAbsolute); fsyncDirectory(dirname(receiptAbsolute)); }
      throw error;
    }
  } finally {
    await lock.handle.close();
  }
}

export const evidenceCommandHandler: CommandHandler = ({ args, repositoryRoot }) => {
  try {
    const request = parseEvidenceRequest(args);
    const evidence = deriveEvidence(repositoryRoot, request);
    persistCandidate(repositoryRoot, request.output, evidence);
    return { output: evidence };
  } catch (error) { return asUsfError(error, "CONSTRUCTION_EVIDENCE_REFUSED"); }
};

export const proveCommandHandler: CommandHandler = ({ args, repositoryRoot }) => {
  try {
    const request = parseProofRequest(args);
    const evidence = parseJsonInput(repositoryRoot, request.evidencePath, {});
    const bundle = deriveProof(repositoryRoot, request, evidence);
    persistCandidate(repositoryRoot, request.output, bundle);
    return { output: bundle };
  } catch (error) { return asUsfError(error, "CONSTRUCTION_PROOF_REFUSED"); }
};

export const constructionAwarePublishCommandHandler: CommandHandler = async (command: CommandRequest): Promise<CommandResult> => {
  if (command.args[0] !== "construction-authority") return publishCommandHandler(command);
  try {
    const request = parsePublishConstructionRequest(command.args);
    const stdinState: { value?: Buffer } = {};
    const values = request.bundlePaths.map((path) => parseJsonInput(command.repositoryRoot, path, stdinState));
    return { output: await publishConstruction(command.repositoryRoot, request, values) };
  } catch (error) { return asUsfError(error, "CONSTRUCTION_PUBLICATION_REFUSED"); }
};
