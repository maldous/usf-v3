import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { exitCodes, type ExitCode, UsfError } from "../core/errors.ts";
import { loadSemanticGraph, objectsFor, resourceDigest, resourceExists, type LoadedSemanticGraph } from "../graph/index.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import { acquirePrimaryMutationLock, assertVerifiedTransitionReceipt, IntegrationError } from "./transition.ts";

export type BootstrapCarrierMode = "verify" | "adopt";

export interface BootstrapCarrierRequest {
  readonly mode: BootstrapCarrierMode;
  readonly adoptionIri: string;
  readonly profileIri: string;
  readonly manifestPath: "graph/manifests/integration.json";
}

export interface BootstrapCarrierResult {
  readonly schema: "urn:usf:bootstrap-carrier-result:1";
  readonly status: "ok";
  readonly operation: "bootstrap-carrier";
  readonly mode: BootstrapCarrierMode;
  readonly carrierAdoptionIri: string;
  readonly authorityProfileIri: string;
  readonly authorityManifestPath: "graph/manifests/integration.json";
  readonly localPreparationReceiptPath: string;
  readonly trackedReceiptPath: string;
  readonly trackedReceiptState: "absent" | "created" | "matching";
  readonly receiptDigest: string;
  readonly historicalObservedCurrentnessDisposition: CurrentnessDisposition;
  readonly liveCurrentnessBasisCommit: string;
  readonly liveCurrentnessBasisTree: string;
  readonly liveCurrentnessDisposition: CurrentnessDisposition;
  readonly authorityEffect: string;
  readonly nonClaims: readonly string[];
  readonly completionState: "not-observed";
  readonly evidenceState: "not-admitted";
  readonly proofState: "not-evaluated";
  readonly ordinaryPermissionState: "unchanged";
  readonly runtimeState: "unchanged";
}

type CurrentnessDisposition = "current" | "reconstructable";
type PerPathCurrentness = "exact-present" | "exact-absent" | "missing" | "divergent" | "unexpected-present";
type GitFileMode = "100644" | "100755";
type ChangeKind = "added" | "deleted" | "modified" | "type-changed";
type PathDisposition = "included" | "excluded";

interface GitFileEntry {
  readonly path: string;
  readonly mode: GitFileMode;
  readonly objectId: string;
  readonly contentDigest: string;
  readonly bytes: Buffer;
}

interface GitTreeInventory {
  readonly treeId: string;
  readonly files: ReadonlyMap<string, GitFileEntry>;
  readonly contentDigest: string;
}

interface GitDiffEffect {
  readonly repositoryPath: string;
  readonly changeKind: ChangeKind;
  readonly before: GitFileEntry | null;
  readonly after: GitFileEntry | null;
}

interface DeclaredPathEffect {
  readonly repositoryPath: string;
  readonly disposition: PathDisposition;
  readonly changeKind: ChangeKind;
}

export interface BootstrapCarrierPathEffect {
  readonly repositoryPath: string;
  readonly disposition: PathDisposition;
  readonly changeKind: ChangeKind;
  readonly carrierPreimageState: "present" | "absent";
  readonly carrierPreimageDigest?: string;
  readonly carrierPreimageMode?: GitFileMode;
  readonly carrierPostimageState: "present" | "absent";
  readonly carrierPostimageDigest?: string;
  readonly carrierPostimageMode?: GitFileMode;
  readonly observedCurrentPostimageState: "present" | "absent";
  readonly observedCurrentPostimageDigest?: string;
  readonly observedCurrentPostimageMode?: GitFileMode;
  readonly observedCurrentnessDisposition: PerPathCurrentness;
}

interface AdoptedSubject {
  readonly kind: "work" | "carrier-intent";
  readonly iri: string;
  readonly subjectResourceDigest: string;
}

interface ValidationDependencyMember {
  readonly kind: "carrier-tree" | "carrier-file" | "package" | "host-tool" | "authority-resource" | "confinement-policy";
  readonly identity: string;
  readonly contentDigest: string;
  readonly fileMode?: GitFileMode;
  readonly version?: string;
  readonly lockIntegrity?: string;
  readonly packageLinkTopologyDigest?: string;
}

interface BootstrapCarrierValidationResult {
  readonly validationIri: string;
  readonly validationResourceDigest: string;
  readonly carrierCommit: string;
  readonly carrierTree: string;
  readonly commandDigest: string;
  readonly commandTokens: readonly string[];
  readonly environmentDigest: string;
  readonly executionModeDigest: string;
  readonly dependencyDigest: string;
  readonly dependencyMembers: readonly ValidationDependencyMember[];
  readonly wallTimeLimitMilliseconds: 120000;
  readonly terminationGraceMilliseconds: 5000;
  readonly timedOut: false;
  readonly lastTerminationSignal: "not-used";
  readonly exitCode: 0;
  readonly outcome: "pass";
  readonly failureIdentities: readonly [];
  readonly failureSetDigest: string;
  readonly normalizedResultDigest: string;
}

interface BootstrapCarrierReceipt {
  readonly schema: "urn:usf:bootstrap-carrier-adoption-receipt:1";
  readonly authorityClass: "HistoricalCarrierObservation";
  readonly genericEvidenceEligibility: "forbidden";
  readonly algorithmIri: string;
  readonly algorithmVersion: string;
  readonly algorithmResourceDigest: string;
  readonly authorityGraphIri: "urn:usf:graph:integration";
  readonly observedAuthorityGraphDigest: string;
  readonly authorityManifestPath: "graph/manifests/integration.json";
  readonly authorityManifestDigest: string;
  readonly scopedAuthorityDependencyDigest: string;
  readonly authorityProfileIri: string;
  readonly authorityProfileVersion: string;
  readonly currentnessAuthorityIri: string;
  readonly currentnessAuthorityResourceDigest: string;
  readonly commandIri: string;
  readonly commandResourceDigest: string;
  readonly receiptSchemaIri: string;
  readonly receiptSchemaResourceDigest: string;
  readonly pathEffectSchemaIri: string;
  readonly pathEffectSchemaResourceDigest: string;
  readonly adoptedSubjectSchemaIri: string;
  readonly adoptedSubjectSchemaResourceDigest: string;
  readonly validationResultSchemaIri: string;
  readonly validationResultSchemaResourceDigest: string;
  readonly publicationPermissionIri: string;
  readonly publicationPermissionResourceDigest: string;
  readonly adoptionStateRuleIri: string;
  readonly adoptionStateRuleResourceDigest: string;
  readonly carrierAdoptionIri: string;
  readonly carrierAdoptionResourceDigest: string;
  readonly lineageMode: string;
  readonly parentCommit: string;
  readonly commit: string;
  readonly tree: string;
  readonly pathEffectSetResourceDigest: string;
  readonly coverageMode: "complete-carrier-diff" | "exact-selected-path-subdiff";
  readonly carrierTotalPathEffectCount: number;
  readonly selectedPathEffectCount: number;
  readonly scopedPathEffectSetDigest: string;
  readonly includedPathEffectSetDigest: string;
  readonly excludedPathEffectSetDigest: string;
  readonly pathEffects: readonly BootstrapCarrierPathEffect[];
  readonly adoptedSubjects: readonly AdoptedSubject[];
  readonly adoptedSubjectSetDigest: string;
  readonly admissionReceiptApplicability: "required" | "not-applicable";
  readonly existingAdmissionReceiptPath?: string;
  readonly existingAdmissionReceiptContentDigest?: string;
  readonly existingAdmissionReceiptCanonicalDigest?: string;
  readonly carrierPostimageSetDigest: string;
  readonly currentObservationBasisCommit: string;
  readonly currentObservationBasisTree: string;
  readonly observedCurrentPostimageSetDigest: string;
  readonly reachabilityBasisCommit: string;
  readonly reachabilityBasisTree: string;
  readonly carrierReachability: "reachable-from-current-head";
  readonly validationResultSetDigest: string;
  readonly validationResults: readonly BootstrapCarrierValidationResult[];
  readonly nonClaimSetDigest: string;
  readonly nonClaims: readonly string[];
  readonly observedCurrentnessDisposition: CurrentnessDisposition;
  readonly completionState: "not-observed";
  readonly evidenceState: "not-admitted";
  readonly proofState: "not-evaluated";
  readonly ordinaryPermissionState: "unchanged";
  readonly runtimeState: "unchanged";
  readonly localPreparationReceiptPath: string;
  readonly trackedReceiptPath: string;
  readonly outcome: "verified";
  readonly receiptDigest: string;
}

interface CarrierAuthority {
  readonly graph: LoadedSemanticGraph;
  readonly adoptionIri: string;
  readonly profileIri: string;
  readonly profileVersion: string;
  readonly currentnessAuthorityIri: string;
  readonly lineageIri: string;
  readonly lineageMode: string;
  readonly algorithmIri: string;
  readonly commandIri: string;
  readonly permissionIri: string;
  readonly adoptionStateRuleIri: string;
  readonly receiptBoundaryIri: string;
  readonly receiptSchemaIri: string;
  readonly resultSchemaIri: string;
  readonly pathEffectSchemaIri: string;
  readonly adoptedSubjectSchemaIri: string;
  readonly validationResultSchemaIri: string;
  readonly validationDependencySchemaIri: string;
  readonly validationDependencyRuleIri: string;
  readonly pathEffectSetIri: string;
  readonly parentCommit: string;
  readonly commit: string;
  readonly tree: string;
  readonly coverageMode: "complete-carrier-diff" | "exact-selected-path-subdiff";
  readonly carrierTotalPathEffectCount: number;
  readonly selectedPathEffectCount: number;
  readonly declaredPathEffects: readonly DeclaredPathEffect[];
  readonly localPreparationReceiptPath: string;
  readonly trackedReceiptPath: string;
  readonly validationIris: readonly string[];
  readonly adoptedSubjects: readonly AdoptedSubject[];
  readonly nonClaims: readonly string[];
  readonly admissionReceiptIri?: string;
  readonly authorityManifestDigest: string;
  readonly scopedAuthorityDependencyDigest: string;
  readonly wallTimeMilliseconds: 120000;
  readonly terminationGraceMilliseconds: 5000;
}

interface PackageInstance {
  readonly locator: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly sourceDirectory: string;
  readonly contentDigest: string;
  readonly linkTopologyDigest: string;
  readonly links: readonly Readonly<{ path: string; target: string }>[];
}

interface LockedPackageInstance {
  readonly locator: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

const integrationManifestPath = "graph/manifests/integration.json" as const;
const integrationGraphIri = "urn:usf:graph:integration" as const;
const algorithmIri = "urn:usf:algorithm:bootstrap-carrier-adoption-transition:1";
const commandIri = "urn:usf:command:bootstrap-carrier:1";
const permissionIri = "urn:usf:permission:bootstrap-carrier-receipt-publication:1";
const receiptBoundaryIri = "urn:usf:receipt-boundary:core-completion:1";
const receiptSchemaIri = "urn:usf:schema:bootstrap-carrier-adoption-receipt:1";
const resultSchemaIri = "urn:usf:schema:bootstrap-carrier-result:1";
const pathEffectSchemaIri = "urn:usf:schema:bootstrap-carrier-path-effect:1";
const adoptedSubjectSchemaIri = "urn:usf:schema:bootstrap-carrier-adopted-subject:1";
const validationResultSchemaIri = "urn:usf:schema:bootstrap-carrier-validation-result:1";
const validationDependencySchemaIri = "urn:usf:schema:bootstrap-carrier-validation-dependency:1";
const validationDependencyRuleIri = "urn:usf:rule:bootstrap-carrier-validation-dependencies:1";
const scopedAuthorityMembershipIri = "urn:usf:digest-membership:bootstrap-carrier-scoped-authority:1";
const noNetworkEnvironmentIri = "urn:usf:environment:bootstrap-carrier-no-network";
const deterministicExecutionModeIri = "urn:usf:mode:deterministic-test-substitute";
const bootstrapReceiptSchemaPath = "schemas/bootstrap-carrier-adoption-receipt.schema.json";
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}$/u;
const maximumGitObjectBytes = 128 * 1024 * 1024;
const maximumTreeEntries = 20_000;
const maximumHistoryCommits = 20_000;
const maximumReceiptBytes = 4 * 1024 * 1024;
const maximumValidationOutputBytes = 256 * 1024;

function predicate(name: string): string { return `urn:usf:predicate:${name}`; }

function refuse(code: string, exitCode: ExitCode, message: string, details?: Record<string, unknown>): never {
  throw new UsfError(code, exitCode, message, details);
}

function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function byteSorted(values: readonly string[]): string[] { return [...values].sort(byteCompare); }

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function one(graph: LoadedSemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string {
  const values = objectsFor(graph, subject, predicate(name));
  if (values.length !== 1 || values[0]?.objectKind !== kind) {
    return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, `Authority field ${name} is missing or ambiguous.`, { subject });
  }
  return values[0].object;
}

function optionalOne(graph: LoadedSemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string | undefined {
  const values = objectsFor(graph, subject, predicate(name));
  if (values.length === 0) return undefined;
  if (values.length !== 1 || values[0]?.objectKind !== kind) {
    return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, `Optional authority field ${name} is ambiguous.`, { subject });
  }
  return values[0].object;
}

function many(graph: LoadedSemanticGraph, subject: string, name: string, kind: "iri" | "literal"): string[] {
  const values = objectsFor(graph, subject, predicate(name));
  if (values.some((value) => value.objectKind !== kind)) {
    return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, `Authority field ${name} has an invalid kind.`, { subject });
  }
  const result = values.map((value) => value.object).sort(byteCompare);
  if (new Set(result).size !== result.length) return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, `Authority field ${name} is duplicated.`, { subject });
  return result;
}

function positiveInteger(graph: LoadedSemanticGraph, subject: string, name: string): number {
  const value = one(graph, subject, name, "literal");
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, `${name} is not a positive integer.`);
  return Number(value);
}

function assertType(graph: LoadedSemanticGraph, subject: string, type: string): void {
  if (!objectsFor(graph, subject, predicate("type")).some((quad) => quad.objectKind === "iri" && quad.object === type)) {
    refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "An authority resource has the wrong type.", { subject, type });
  }
}

function safeRepositoryPath(path: string, allowPrivate = false): string {
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(path)
    || path.split("/").some((segment) => segment === "." || segment === "..")
    || path === ".git" || path.startsWith(".git/")
    || (!allowPrivate && (path === ".usf" || path.startsWith(".usf/")))) {
    return refuse("BOOTSTRAP_CARRIER_PATH_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "A repository path is outside the admitted boundary.", { path });
  }
  return path;
}

function relativeContained(root: string, absolute: string): boolean {
  const relation = relative(root, absolute);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function processUid(fallback: number): number { return typeof process.getuid === "function" ? process.getuid() : fallback; }

function ensurePrivateDirectory(root: string, repositoryPath: string): string {
  safeRepositoryPath(repositoryPath, true);
  let cursor = root;
  for (const segment of repositoryPath.split("/")) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      try { mkdirSync(cursor, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") refuse("BOOTSTRAP_CARRIER_PRIVATE_STATE_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Private state could not be created."); }
    }
    const entry = lstatSync(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== processUid(entry.uid) || (entry.mode & 0o077) !== 0
      || realpathSync(cursor) !== cursor || !relativeContained(root, cursor)) {
      refuse("BOOTSTRAP_CARRIER_PRIVATE_STATE_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Private state ancestry is unsafe.", { repositoryPath });
    }
  }
  return cursor;
}

function trustedExecutable(path: string, expectedOwner = 0): string {
  let entry: ReturnType<typeof lstatSync>;
  try { entry = lstatSync(path); } catch { return refuse("BOOTSTRAP_CARRIER_TOOL_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "A required host tool is unavailable.", { tool: path }); }
  if (entry.isSymbolicLink() || !entry.isFile() || entry.uid !== expectedOwner || (entry.mode & 0o022) !== 0 || (entry.mode & 0o111) === 0 || realpathSync(path) !== path) {
    return refuse("BOOTSTRAP_CARRIER_TOOL_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "A required host tool is not trusted.", { tool: path });
  }
  return path;
}

function gitEnvironment(root: string): NodeJS.ProcessEnv {
  ensurePrivateDirectory(root, ".usf");
  ensurePrivateDirectory(root, ".usf/home");
  ensurePrivateDirectory(root, ".usf/tmp");
  return {
    PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: resolve(root, ".usf/home"), TMPDIR: resolve(root, ".usf/tmp"),
    XDG_CONFIG_HOME: resolve(root, ".usf/home/.config"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", SSH_ASKPASS: "/bin/false", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
  };
}

function gitResult(root: string, args: readonly string[], maximumBytes = maximumGitObjectBytes): { status: number; stdout: Buffer; stderr: Buffer } {
  trustedExecutable("/usr/bin/git");
  const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "core.askPass=", "-c", "core.fsmonitor=false", "-c", "maintenance.auto=false", "-c", "gc.auto=0", "-c", "protocol.allow=never", "-C", root, ...args], {
    env: gitEnvironment(root), encoding: "buffer", maxBuffer: maximumBytes, stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: result.status ?? 127, stdout: Buffer.from(result.stdout ?? ""), stderr: Buffer.from(result.stderr ?? "") };
}

function git(root: string, args: readonly string[], maximumBytes = maximumGitObjectBytes): Buffer {
  const result = gitResult(root, args, maximumBytes);
  if (result.status !== 0) return refuse("BOOTSTRAP_CARRIER_GIT_FAILED", exitCodes.EXTERNAL_UNAVAILABLE, "A scrubbed local Git operation failed.", { command: args[0], detail: result.stderr.toString("utf8").slice(0, 256) });
  return result.stdout;
}

function gitText(root: string, args: readonly string[]): string { return git(root, args).toString("utf8").trim(); }

function assertScrubbedRepository(root: string): void {
  if (realpathSync(root) !== root || gitText(root, ["rev-parse", "--show-toplevel"]) !== root) refuse("BOOTSTRAP_CARRIER_GIT_ROOT_INVALID", exitCodes.CONTAINMENT_REFUSAL, "The Git repository root is not canonical.");
  const gitDirectory = resolve(root, ".git");
  const entry = lstatSync(gitDirectory);
  if (entry.isSymbolicLink() || !entry.isDirectory() || realpathSync(gitDirectory) !== gitDirectory) refuse("BOOTSTRAP_CARRIER_GIT_ROOT_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A separate or symlinked Git directory is not admitted.");
  if (gitText(root, ["rev-parse", "--show-object-format"]) !== "sha1") refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_FORMAT", exitCodes.CURRENTNESS_FAILURE, "These declared carriers require SHA-1 Git object identity.");
  for (const path of ["info/grafts", "shallow", "objects/info/alternates"]) if (existsSync(resolve(gitDirectory, path))) refuse("BOOTSTRAP_CARRIER_GIT_REPLACEMENT_REFUSED", exitCodes.CURRENTNESS_FAILURE, "Git graft, shallow or alternate state is forbidden.", { path });
  const replaceRoot = resolve(gitDirectory, "refs/replace");
  if (existsSync(replaceRoot) && readdirSync(replaceRoot, { recursive: true }).length > 0) refuse("BOOTSTRAP_CARRIER_GIT_REPLACEMENT_REFUSED", exitCodes.CURRENTNESS_FAILURE, "Replacement refs are forbidden.");
  const packRoot = resolve(gitDirectory, "objects/pack");
  if (existsSync(packRoot) && readdirSync(packRoot).some((name) => name.endsWith(".promisor"))) refuse("BOOTSTRAP_CARRIER_GIT_PROMISOR_REFUSED", exitCodes.CURRENTNESS_FAILURE, "Promisor packs are forbidden.");
  const partial = gitResult(root, ["config", "--local", "--get-regexp", "^(extensions\\.partialClone|remote\\..*\\.(promisor|partialCloneFilter))$"]);
  if (partial.status === 0 && partial.stdout.byteLength > 0) refuse("BOOTSTRAP_CARRIER_GIT_PROMISOR_REFUSED", exitCodes.CURRENTNESS_FAILURE, "Partial clone or promisor configuration is forbidden.");
  if (partial.status !== 0 && partial.status !== 1) refuse("BOOTSTRAP_CARRIER_GIT_FAILED", exitCodes.EXTERNAL_UNAVAILABLE, "Git configuration could not be authenticated.");
}

function objectId(type: "blob" | "tree" | "commit", bytes: Buffer): string {
  return createHash("sha1").update(`${type} ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function rawObject(root: string, type: "blob" | "tree" | "commit", id: string): Buffer {
  if (!gitObjectPattern.test(id)) return refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A Git object identity is invalid.");
  const bytes = git(root, ["cat-file", type, id]);
  if (objectId(type, bytes) !== id) return refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A raw Git object failed identity revalidation.", { id, type });
  return bytes;
}

function commitHeaders(root: string, id: string): { readonly tree: string; readonly parents: readonly string[] } {
  const bytes = rawObject(root, "commit", id);
  const end = bytes.indexOf(Buffer.from("\n\n"));
  if (end < 0) return refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A commit has no header terminator.");
  const lines = bytes.subarray(0, end).toString("utf8").split("\n");
  const trees = lines.filter((line) => line.startsWith("tree ")).map((line) => line.slice(5));
  const parents = lines.filter((line) => line.startsWith("parent ")).map((line) => line.slice(7));
  if (trees.length !== 1 || !gitObjectPattern.test(trees[0]!) || parents.some((parent) => !gitObjectPattern.test(parent))) return refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_INVALID", exitCodes.CURRENTNESS_FAILURE, "Commit headers are not canonical.");
  return { tree: trees[0]!, parents };
}

function decodeGitPath(bytes: Buffer): string {
  let value: string;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return refuse("BOOTSTRAP_CARRIER_GIT_PATH_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A Git path is not valid UTF-8."); }
  return safeRepositoryPath(value);
}

function treeInventory(root: string, treeId: string): GitTreeInventory {
  const files = new Map<string, GitFileEntry>();
  const paths = new Set<string>();
  const digestEntries: Array<Record<string, string>> = [];
  let observedEntries = 0;
  const visit = (id: string, prefix: string): void => {
    const bytes = rawObject(root, "tree", id);
    let offset = 0;
    while (offset < bytes.length) {
      const space = bytes.indexOf(0x20, offset);
      const nul = space < 0 ? -1 : bytes.indexOf(0x00, space + 1);
      if (space < 0 || nul < 0 || nul + 21 > bytes.length) return refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A raw tree entry is malformed.");
      const rawMode = bytes.subarray(offset, space).toString("ascii");
      const name = decodeGitPath(bytes.subarray(space + 1, nul));
      if (name.includes("/")) return refuse("BOOTSTRAP_CARRIER_GIT_PATH_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A raw tree segment contains a separator.");
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (paths.has(path)) return refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A raw tree contains a duplicate path.", { path });
      paths.add(path);
      const child = bytes.subarray(nul + 1, nul + 21).toString("hex");
      offset = nul + 21;
      observedEntries += 1;
      if (observedEntries > maximumTreeEntries) return refuse("BOOTSTRAP_CARRIER_GIT_TREE_LIMIT", exitCodes.CURRENTNESS_FAILURE, "The carrier tree exceeds its bounded entry limit.");
      if (rawMode === "40000" || rawMode === "040000") { digestEntries.push({ path, mode: "040000", treeObject: child }); visit(child, path); continue; }
      if (rawMode !== "100644" && rawMode !== "100755") return refuse("BOOTSTRAP_CARRIER_GIT_MODE_REFUSED", exitCodes.CONTAINMENT_REFUSAL, "Symlink, Git-link and nonregular carrier entries are refused.", { path, mode: rawMode });
      const blob = rawObject(root, "blob", child);
      const contentDigest = sha256(blob);
      const file: GitFileEntry = { path, mode: rawMode, objectId: child, contentDigest, bytes: blob };
      files.set(path, file);
      digestEntries.push({ path, mode: rawMode, contentDigest });
    }
  };
  visit(treeId, "");
  digestEntries.sort((left, right) => byteCompare(left.path!, right.path!));
  return { treeId, files, contentDigest: canonicalDigest(digestEntries) };
}

function diffTrees(parent: GitTreeInventory, carrier: GitTreeInventory): GitDiffEffect[] {
  const paths = byteSorted([...new Set([...parent.files.keys(), ...carrier.files.keys()])]);
  const effects: GitDiffEffect[] = [];
  for (const repositoryPath of paths) {
    const before = parent.files.get(repositoryPath) ?? null;
    const after = carrier.files.get(repositoryPath) ?? null;
    if (before !== null && after !== null && before.mode === after.mode && before.contentDigest === after.contentDigest) continue;
    const changeKind: ChangeKind = before === null ? "added" : after === null ? "deleted" : before.mode === after.mode ? "modified" : "type-changed";
    effects.push({ repositoryPath, changeKind, before, after });
  }
  return effects;
}

function assertReachable(root: string, head: string, target: string): void {
  const pending = [head];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    if (candidate === target) return;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    if (visited.size > maximumHistoryCommits) return refuse("BOOTSTRAP_CARRIER_HISTORY_LIMIT", exitCodes.CURRENTNESS_FAILURE, "The bounded raw history walk exceeded its limit.");
    pending.push(...commitHeaders(root, candidate).parents);
  }
  refuse("BOOTSTRAP_CARRIER_NOT_REACHABLE", exitCodes.CURRENTNESS_FAILURE, "The declared carrier is not reachable from current HEAD by raw parent edges.");
}

function cleanHeadBasis(root: string, relevantPaths: readonly string[]): { readonly commit: string; readonly tree: GitTreeInventory } {
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...relevantPaths]);
  if (status.byteLength !== 0) return refuse("BOOTSTRAP_CARRIER_RELEVANT_WORKTREE_DIRTY", exitCodes.CURRENTNESS_FAILURE, "Relevant current paths are not clean at HEAD.");
  const commit = gitText(root, ["rev-parse", "--verify", "HEAD"]);
  if (!gitObjectPattern.test(commit)) return refuse("BOOTSTRAP_CARRIER_GIT_OBJECT_INVALID", exitCodes.CURRENTNESS_FAILURE, "HEAD is invalid.");
  return { commit, tree: treeInventory(root, commitHeaders(root, commit).tree) };
}

function declaredEffects(graph: LoadedSemanticGraph, setIri: string): DeclaredPathEffect[] {
  const pattern = /^urn:usf:predicate:(included|excluded)(Added|Deleted|Modified|TypeChanged)Path$/u;
  const kinds: Record<string, ChangeKind> = { Added: "added", Deleted: "deleted", Modified: "modified", TypeChanged: "type-changed" };
  const values = objectsFor(graph, setIri).flatMap((quad) => {
    const match = pattern.exec(quad.predicate);
    if (!match) return [];
    if (quad.objectKind !== "literal") return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A path declaration is not literal.");
    return [{ repositoryPath: safeRepositoryPath(quad.object), disposition: match[1] as PathDisposition, changeKind: kinds[match[2]!]! }];
  }).sort((left, right) => byteCompare(left.repositoryPath, right.repositoryPath));
  if (new Set(values.map((value) => value.repositoryPath)).size !== values.length) return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A selected path is declared more than once.");
  return values;
}

function scopedAuthorityDigest(graph: LoadedSemanticGraph, adoptionIri: string): string {
  type Role = "self" | "algorithm" | "command" | "permission" | "boundary" | "adoption" | "schema" | "digest" | "validation" | "leaf";
  const fixedRoots = [scopedAuthorityMembershipIri, algorithmIri, commandIri, permissionIri, receiptBoundaryIri];
  const closureNames = [
    "registeredCommand", "resultSchema", "outputSchema", "topic", "forAlgorithm", "receiptBoundary", "receiptSchema",
    "bootstrapCarrierReceiptSchema", "receiptDigestMembership", "digestMembership", "derivedSetDigestMembership", "pathEffectSchema",
    "adoptedSubjectSchema", "validationResultSchema", "dependencyMemberSchema", "validationDependencyDerivationRule", "dependencyDerivationRule",
    "canonicalization", "memberDigest", "aggregateRule", "adoptionStateRule", "requires", "publicationPermission", "transitionAlgorithm",
    "authorityProfile", "currentnessAuthority", "lineage", "pathEffectScope", "admissionReceipt", "validation",
    "validationConfinementEnvironment", "environment", "executionMode", "hostToolDependency",
  ];
  if (canonicalJson(many(graph, scopedAuthorityMembershipIri, "fixedClosureRoot", "iri")) !== canonicalJson(byteSorted(fixedRoots))
    || one(graph, scopedAuthorityMembershipIri, "selectedClosureRoot", "literal") !== "exact selected eligibleCarrierAdoption IRI"
    || canonicalJson(many(graph, scopedAuthorityMembershipIri, "closurePredicate", "iri")) !== canonicalJson(byteSorted(closureNames.map(predicate)))) {
    return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The finite scoped-authority closure declaration differs from the implemented version.");
  }
  const selected = new Set<string>();
  const pending: Array<{ iri: string; role: Role }> = [
    { iri: scopedAuthorityMembershipIri, role: "self" }, { iri: algorithmIri, role: "algorithm" }, { iri: commandIri, role: "command" },
    { iri: permissionIri, role: "permission" }, { iri: receiptBoundaryIri, role: "boundary" }, { iri: adoptionIri, role: "adoption" },
  ];
  const rules: Record<Role, readonly string[]> = {
    algorithm: ["registeredCommand", "resultSchema", "receiptBoundary", "receiptSchema", "receiptDigestMembership", "derivedSetDigestMembership", "pathEffectSchema", "validationResultSchema", "validationDependencyDerivationRule", "publicationPermission", "adoptionStateRule", "validationConfinementEnvironment", "requires"],
    command: ["topic", "outputSchema"], permission: ["forAlgorithm", "registeredCommand"], boundary: ["bootstrapCarrierReceiptSchema"],
    adoption: ["transitionAlgorithm", "adoptionStateRule", "authorityProfile", "currentnessAuthority", "lineage", "pathEffectScope", "admissionReceipt", "validation"],
    schema: ["digestMembership", "derivedSetDigestMembership", "pathEffectSchema", "adoptedSubjectSchema", "validationResultSchema", "dependencyMemberSchema", "dependencyDerivationRule"],
    digest: ["canonicalization", "memberDigest", "aggregateRule"], validation: ["environment", "executionMode", "hostToolDependency"], self: [], leaf: [],
  };
  const schemaPredicates = new Set(["resultSchema", "receiptSchema", "outputSchema", "bootstrapCarrierReceiptSchema", "pathEffectSchema", "adoptedSubjectSchema", "validationResultSchema", "dependencyMemberSchema"]);
  const digestPredicates = new Set(["receiptDigestMembership", "derivedSetDigestMembership", "digestMembership", "memberDigest"]);
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (selected.has(current.iri)) continue;
    if (!resourceExists(graph, current.iri)) return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A scoped authority member is unresolved.", { iri: current.iri });
    selected.add(current.iri);
    for (const name of rules[current.role]) for (const quad of objectsFor(graph, current.iri, predicate(name))) {
      if (quad.objectKind !== "iri") return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A scoped authority edge has an invalid kind.");
      const role: Role = schemaPredicates.has(name) ? "schema" : digestPredicates.has(name) ? "digest" : name === "validation" ? "validation" : "leaf";
      pending.push({ iri: quad.object, role });
    }
  }
  return canonicalDigest([...selected].sort(byteCompare).map((iri) => ({ iri, resourceDigest: resourceDigest(graph, iri) })));
}

function extractAuthority(root: string, request: BootstrapCarrierRequest): CarrierAuthority {
  let graph: LoadedSemanticGraph;
  try { graph = loadSemanticGraph(root, request.manifestPath); }
  catch (error) { return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The integration authority manifest could not be loaded.", { reason: error instanceof Error ? error.message : "unknown" }); }
  assertType(graph, request.adoptionIri, "urn:usf:type:BootstrapCarrierAdoption");
  assertType(graph, algorithmIri, "urn:usf:type:TransitionVerificationAlgorithm");
  assertType(graph, commandIri, "urn:usf:type:RegisteredCliCommand");
  assertType(graph, permissionIri, "urn:usf:type:BootstrapCarrierObservationPublicationPermission");
  if (!many(graph, algorithmIri, "eligibleCarrierAdoption", "iri").includes(request.adoptionIri)
    || one(graph, algorithmIri, "registeredCommand", "iri") !== commandIri || one(graph, algorithmIri, "publicationPermission", "iri") !== permissionIri
    || one(graph, algorithmIri, "resultSchema", "iri") !== resultSchemaIri
    || one(graph, algorithmIri, "receiptSchema", "iri") !== receiptSchemaIri || one(graph, algorithmIri, "pathEffectSchema", "iri") !== pathEffectSchemaIri
    || one(graph, algorithmIri, "validationResultSchema", "iri") !== validationResultSchemaIri
    || one(graph, commandIri, "outputSchema", "iri") !== resultSchemaIri
    || one(graph, permissionIri, "forAlgorithm", "iri") !== algorithmIri || one(graph, permissionIri, "registeredCommand", "iri") !== commandIri
    || one(graph, receiptBoundaryIri, "bootstrapCarrierReceiptSchema", "iri") !== receiptSchemaIri
    || one(graph, receiptSchemaIri, "adoptedSubjectSchema", "iri") !== adoptedSubjectSchemaIri
    || one(graph, receiptSchemaIri, "validationResultSchema", "iri") !== validationResultSchemaIri
    || one(graph, validationResultSchemaIri, "dependencyMemberSchema", "iri") !== validationDependencySchemaIri
    || one(graph, commandIri, "availability", "literal") !== "implemented" || one(graph, commandIri, "requiredManifestPath", "literal") !== integrationManifestPath
    || one(graph, permissionIri, "activationState", "iri") !== "urn:usf:contract-state:active") {
    refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The carrier command is not currently active and implemented.");
  }
  const profileIri = one(graph, request.adoptionIri, "authorityProfile", "iri");
  if (profileIri !== request.profileIri) refuse("BOOTSTRAP_CARRIER_PROFILE_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The selected profile does not match the carrier adoption.");
  const profileVersion = one(graph, profileIri, "version", "literal");
  if (!/^[1-9][0-9]*$/u.test(profileVersion) || !request.profileIri.endsWith(`:${profileVersion}`)) refuse("BOOTSTRAP_CARRIER_PROFILE_INVALID", exitCodes.CURRENTNESS_FAILURE, "The authority profile is not explicitly versioned.");
  const pathEffectSetIri = one(graph, request.adoptionIri, "pathEffectScope", "iri");
  const declaredPathEffects = declaredEffects(graph, pathEffectSetIri);
  const selectedPathEffectCount = positiveInteger(graph, pathEffectSetIri, "selectedPathCount");
  const carrierTotalPathEffectCount = positiveInteger(graph, pathEffectSetIri, "carrierTotalChangedPathCount");
  const coverageMode = one(graph, pathEffectSetIri, "coverageMode", "literal");
  if ((coverageMode !== "complete-carrier-diff" && coverageMode !== "exact-selected-path-subdiff") || declaredPathEffects.length !== selectedPathEffectCount
    || declaredPathEffects.filter((effect) => effect.disposition === "included").length !== positiveInteger(graph, pathEffectSetIri, "includedPathCount")
    || declaredPathEffects.filter((effect) => effect.disposition === "excluded").length !== Number(one(graph, pathEffectSetIri, "excludedSelectedPathCount", "literal"))) {
    refuse("BOOTSTRAP_CARRIER_PATH_SET_INVALID", exitCodes.CURRENTNESS_FAILURE, "The carrier path-effect denominator is inconsistent.");
  }
  const parentCommit = one(graph, request.adoptionIri, "carrierParentCommit", "literal");
  const commit = one(graph, request.adoptionIri, "carrierCommit", "literal");
  const tree = one(graph, request.adoptionIri, "carrierTree", "literal");
  if (![parentCommit, commit, tree].every((value) => gitObjectPattern.test(value))) refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A declared carrier identity is invalid.");
  const validationIris = many(graph, request.adoptionIri, "validation", "iri");
  if (validationIris.length !== positiveInteger(graph, request.adoptionIri, "validationCount")) refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The validation denominator is inconsistent.");
  for (const validationIri of validationIris) assertType(graph, validationIri, "urn:usf:type:TestObligation");
  const adoptedSubjects = [
    ...many(graph, request.adoptionIri, "adoptedWork", "iri").map((iri) => ({ kind: "work" as const, iri, subjectResourceDigest: resourceDigest(graph, iri) })),
    ...many(graph, request.adoptionIri, "adoptedCarrierIntent", "iri").map((iri) => ({ kind: "carrier-intent" as const, iri, subjectResourceDigest: resourceDigest(graph, iri) })),
  ].sort((left, right) => byteCompare(left.kind, right.kind) || byteCompare(left.iri, right.iri));
  if (adoptedSubjects.length !== positiveInteger(graph, request.adoptionIri, "adoptedSubjectCount")) refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The adopted-subject denominator is inconsistent.");
  const lineageIri = one(graph, request.adoptionIri, "lineage", "iri");
  const manifest = graph.manifests.find((entry) => entry.path === request.manifestPath);
  if (manifest === undefined) refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The selected manifest identity is missing.");
  const trackedReceiptPath = safeRepositoryPath(one(graph, request.adoptionIri, "trackedReceiptPath", "literal"));
  const localPreparationReceiptPath = safeRepositoryPath(one(graph, request.adoptionIri, "localPreparationReceiptPath", "literal"), true);
  if (!many(graph, permissionIri, "allowedPath", "literal").includes(trackedReceiptPath)
    || one(graph, algorithmIri, "localPreparationRoot", "literal") !== ".usf/receipts/bootstrap-carrier/"
    || one(graph, algorithmIri, "trackedReceiptRoot", "literal") !== "evidence/historical-carriers/"
    || !localPreparationReceiptPath.startsWith(".usf/receipts/bootstrap-carrier/")
    || !trackedReceiptPath.startsWith("evidence/historical-carriers/")) {
    refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The carrier receipt paths are outside their finite permission roots.");
  }
  const currentnessAuthorityIri = one(graph, request.adoptionIri, "currentnessAuthority", "iri");
  const adoptionStateRuleIri = one(graph, request.adoptionIri, "adoptionStateRule", "iri");
  if (one(graph, request.adoptionIri, "transitionAlgorithm", "iri") !== algorithmIri
    || adoptionStateRuleIri !== one(graph, algorithmIri, "adoptionStateRule", "iri")
    || one(graph, lineageIri, "parentCommit", "literal") !== parentCommit
    || one(graph, lineageIri, "commit", "literal") !== commit
    || one(graph, lineageIri, "tree", "literal") !== tree
    || one(graph, pathEffectSetIri, "carrierParentCommit", "literal") !== parentCommit
    || one(graph, pathEffectSetIri, "carrierCommit", "literal") !== commit
    || one(graph, pathEffectSetIri, "carrierTree", "literal") !== tree
    || one(graph, algorithmIri, "validationDependencyDerivationRule", "iri") !== validationDependencyRuleIri) {
    refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The carrier, lineage, path-effect and transition authority bindings are inconsistent.");
  }
  const wallTimeMilliseconds = positiveInteger(graph, algorithmIri, "validationWallTimeMilliseconds");
  const terminationGraceMilliseconds = positiveInteger(graph, algorithmIri, "validationTerminationGraceMilliseconds");
  if (wallTimeMilliseconds !== 120000 || terminationGraceMilliseconds !== 5000 || positiveInteger(graph, algorithmIri, "validationMaximumSettlementWallTimeMilliseconds") !== 125000
    || one(graph, algorithmIri, "validationTerminationSignal", "literal") !== "SIGTERM" || one(graph, algorithmIri, "validationForcedTerminationSignal", "literal") !== "SIGKILL"
    || one(graph, algorithmIri, "validationTimeoutReasonCode", "literal") !== "BOOTSTRAP_CARRIER_VALIDATION_TIMEOUT") refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The validation timeout authority is invalid.");
  return Object.freeze({
    graph, adoptionIri: request.adoptionIri, profileIri, profileVersion, currentnessAuthorityIri, lineageIri,
    lineageMode: one(graph, lineageIri, "lineageMode", "literal"), algorithmIri, commandIri, permissionIri, adoptionStateRuleIri,
    receiptBoundaryIri, receiptSchemaIri, resultSchemaIri, pathEffectSchemaIri, adoptedSubjectSchemaIri, validationResultSchemaIri,
    validationDependencySchemaIri, validationDependencyRuleIri, pathEffectSetIri, parentCommit, commit, tree,
    coverageMode, carrierTotalPathEffectCount, selectedPathEffectCount, declaredPathEffects,
    localPreparationReceiptPath,
    trackedReceiptPath, validationIris, adoptedSubjects, nonClaims: many(graph, request.adoptionIri, "nonClaim", "literal"),
    admissionReceiptIri: optionalOne(graph, request.adoptionIri, "admissionReceipt", "iri"), authorityManifestDigest: manifest.digest,
    scopedAuthorityDependencyDigest: scopedAuthorityDigest(graph, request.adoptionIri), wallTimeMilliseconds, terminationGraceMilliseconds,
  });
}

function derivePathEffects(authority: CarrierAuthority, parent: GitTreeInventory, carrier: GitTreeInventory, current: GitTreeInventory): BootstrapCarrierPathEffect[] {
  const actual = diffTrees(parent, carrier);
  if (actual.length !== authority.carrierTotalPathEffectCount) refuse("BOOTSTRAP_CARRIER_PATH_COUNT_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The raw carrier path denominator does not match authority.");
  const byPath = new Map(actual.map((effect) => [effect.repositoryPath, effect]));
  if (authority.coverageMode === "complete-carrier-diff" && (actual.length !== authority.declaredPathEffects.length || actual.some((effect) => !authority.declaredPathEffects.some((declared) => declared.repositoryPath === effect.repositoryPath)))) refuse("BOOTSTRAP_CARRIER_PATH_SET_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "A complete carrier declaration is not an exact partition.");
  return authority.declaredPathEffects.map((declared) => {
    const effect = byPath.get(declared.repositoryPath);
    if (effect === undefined || effect.changeKind !== declared.changeKind) refuse("BOOTSTRAP_CARRIER_PATH_SET_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "A selected path effect is missing or has the wrong change kind.", { path: declared.repositoryPath });
    const observed = current.files.get(declared.repositoryPath) ?? null;
    const currentness: PerPathCurrentness = effect.after === null ? observed === null ? "exact-absent" : "unexpected-present"
      : observed === null ? "missing" : observed.mode === effect.after.mode && observed.contentDigest === effect.after.contentDigest ? "exact-present" : "divergent";
    return Object.freeze({
      repositoryPath: declared.repositoryPath, disposition: declared.disposition, changeKind: declared.changeKind,
      carrierPreimageState: effect.before === null ? "absent" : "present", ...(effect.before === null ? {} : { carrierPreimageDigest: effect.before.contentDigest, carrierPreimageMode: effect.before.mode }),
      carrierPostimageState: effect.after === null ? "absent" : "present", ...(effect.after === null ? {} : { carrierPostimageDigest: effect.after.contentDigest, carrierPostimageMode: effect.after.mode }),
      observedCurrentPostimageState: observed === null ? "absent" : "present", ...(observed === null ? {} : { observedCurrentPostimageDigest: observed.contentDigest, observedCurrentPostimageMode: observed.mode }),
      observedCurrentnessDisposition: currentness,
    });
  }).sort((left, right) => byteCompare(left.repositoryPath, right.repositoryPath));
}

function aggregateCurrentness(pathEffects: readonly BootstrapCarrierPathEffect[]): CurrentnessDisposition {
  const included = pathEffects.filter((effect) => effect.disposition === "included");
  return included.length > 0 && included.every((effect) => effect.observedCurrentnessDisposition === "exact-present" || effect.observedCurrentnessDisposition === "exact-absent") ? "current" : "reconstructable";
}

function record(value: unknown, reason = "BOOTSTRAP_CARRIER_DEPENDENCY_INVALID"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse(reason, exitCodes.CURRENTNESS_FAILURE, "A dependency record is invalid.");
  return value as Record<string, unknown>;
}

function stringMap(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const input = record(value);
  const result: Record<string, string> = {};
  for (const [name, reference] of Object.entries(input)) {
    if (typeof reference !== "string" || name.length === 0) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A lock dependency reference is invalid.");
    result[name] = reference;
  }
  return result;
}

function packageLocator(name: string, reference: unknown): string {
  const value = typeof reference === "string" ? reference : typeof record(reference).version === "string" ? record(reference).version as string : "";
  if (value.length === 0 || /^(?:file|link|workspace|https?|git|github|patch):/u.test(value)
    || value.includes("\\") || value.startsWith("/") || value.startsWith(".") || /\s/u.test(value)
    || (!value.startsWith("npm:") && value.includes(":"))) {
    return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A non-registry or malformed package reference is not admitted.", { name });
  }
  const locator = value.startsWith("npm:") ? value.slice(4) : `${name}@${value}`;
  locatorIdentity(locator);
  return locator;
}

function locatorIdentity(locator: string): { readonly name: string; readonly version: string; readonly base: string } {
  const base = locator.replace(/\(.+$/u, "");
  const separator = base.lastIndexOf("@");
  if (separator <= 0 || separator === base.length - 1) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A package locator cannot be normalized.", { locator });
  return { name: base.slice(0, separator), version: base.slice(separator + 1), base };
}

function encodedLocator(locator: string): string {
  return locator.replaceAll("/", "+").replaceAll("(", "_").replaceAll(")", "");
}

function packageSourceDirectory(root: string, locator: string): string {
  const identity = locatorIdentity(locator);
  const stores = [resolve(root, "node_modules/.pnpm"), resolve(root, ".usf/cache/pnpm-virtual-store")];
  const candidates: string[] = [];
  for (const store of stores) {
    if (!existsSync(store)) continue;
    const exact = resolve(store, encodedLocator(locator), "node_modules", ...identity.name.split("/"));
    if (existsSync(exact)) candidates.push(exact);
    for (const entry of readdirSync(store, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || !entry.name.startsWith(encodedLocator(`${identity.name}@${identity.version}`))) continue;
      const candidate = resolve(store, entry.name, "node_modules", ...identity.name.split("/"));
      if (!existsSync(candidate)) continue;
      try {
        const manifest = JSON.parse(readFileSync(resolve(candidate, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
        if (manifest.name === identity.name && manifest.version === identity.version) candidates.push(candidate);
      } catch { /* rejected below when no unique authenticated candidate remains */ }
    }
  }
  const canonical = [...new Set(candidates.map((candidate) => realpathSync(candidate)))];
  const exactMatch = canonical.find((candidate) => candidate.includes(`${sep}${encodedLocator(locator)}${sep}node_modules${sep}`));
  const selected = exactMatch ?? (canonical.length === 1 ? canonical[0] : undefined);
  if (selected === undefined) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "An exact lock package instance is unavailable in the repository-local installation.", { locator });
  const entry = lstatSync(selected);
  if (entry.isSymbolicLink() || !entry.isDirectory() || !relativeContained(root, selected)) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A package instance is unsafe.", { locator });
  return selected;
}

function scanPackageDirectory(directory: string): { readonly contentDigest: string; readonly entries: readonly Readonly<{ path: string; digest: string; mode: "executable" | "nonexecutable" }>[] } {
  const entries: Array<{ path: string; digest: string; mode: "executable" | "nonexecutable" }> = [];
  let totalBytes = 0;
  const visit = (current: string, prefix: string): void => {
    const names = readdirSync(current, { withFileTypes: true }).sort((left, right) => byteCompare(left.name, right.name));
    for (const named of names) {
      const absolute = resolve(current, named.name);
      const path = prefix === "" ? named.name : `${prefix}/${named.name}`;
      const status = lstatSync(absolute);
      if (status.isSymbolicLink() || (!status.isDirectory() && !status.isFile())) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CONTAINMENT_REFUSAL, "Package content contains an unsupported link or nonregular entry.", { path });
      if (status.isDirectory()) { visit(absolute, path); continue; }
      const bytes = readFileSync(absolute);
      totalBytes += bytes.byteLength;
      if (entries.length >= 100_000 || totalBytes > 512 * 1024 * 1024) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_LIMIT", exitCodes.CURRENTNESS_FAILURE, "Package content exceeds the bounded closure.");
      entries.push({ path, digest: sha256(bytes), mode: (status.mode & 0o111) === 0 ? "nonexecutable" : "executable" });
    }
  };
  visit(directory, "");
  return { contentDigest: canonicalDigest(entries), entries };
}

function lockedPackageClosure(carrier: GitTreeInventory): { readonly lockDigest: string; readonly directLocators: Readonly<Record<string, string>>; readonly instances: readonly LockedPackageInstance[] } {
  const packageJson = carrier.files.get("package.json");
  const lockFile = carrier.files.get("pnpm-lock.yaml");
  if (packageJson === undefined || lockFile === undefined) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The carrier package importer or lock is missing.");
  let packageManifest: Record<string, unknown>;
  let lock: Record<string, unknown>;
  try { packageManifest = record(JSON.parse(packageJson.bytes.toString("utf8"))); lock = record(parseYaml(lockFile.bytes.toString("utf8"))); }
  catch { return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The carrier package importer or lock cannot be parsed."); }
  if (String(lock.lockfileVersion) !== "9.0") return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "Only the authenticated pnpm lock v9 closure is supported.");
  const importer = record(record(lock.importers)["."]);
  const roots = { ...record(importer.dependencies ?? {}), ...record(importer.optionalDependencies ?? {}), ...record(importer.devDependencies ?? {}) };
  const declaredNames = new Set([
    ...Object.keys(record(packageManifest.dependencies ?? {})), ...Object.keys(record(packageManifest.optionalDependencies ?? {})), ...Object.keys(record(packageManifest.devDependencies ?? {})),
  ]);
  if (declaredNames.size !== Object.keys(roots).length || Object.keys(roots).some((name) => !declaredNames.has(name))) {
    return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The package importer and lock root dependency sets differ.");
  }
  const directLocators = Object.fromEntries(Object.entries(roots).map(([name, reference]) => [name, packageLocator(name, reference)]));
  const packages = record(lock.packages);
  const snapshots = record(lock.snapshots);
  const pending = Object.values(directLocators).sort(byteCompare);
  const selected = new Map<string, LockedPackageInstance>();
  while (pending.length > 0) {
    const locator = pending.shift()!;
    if (selected.has(locator)) continue;
    const identity = locatorIdentity(locator);
    const packageEntry = record(packages[identity.base]);
    const snapshot = record(snapshots[locator]);
    const resolution = record(packageEntry.resolution);
    const integrity = resolution.integrity;
    if (typeof integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A package lock integrity is missing or invalid.", { locator });
    const dependencies = { ...stringMap(snapshot.dependencies), ...stringMap(snapshot.optionalDependencies) };
    const normalizedDependencies = Object.fromEntries(Object.entries(dependencies).map(([name, reference]) => [name, packageLocator(name, reference)]));
    pending.push(...Object.values(normalizedDependencies));
    pending.sort(byteCompare);
    selected.set(locator, { locator, name: identity.name, version: identity.version, integrity, dependencies: normalizedDependencies });
  }
  return { lockDigest: sha256(lockFile.bytes), directLocators, instances: [...selected.values()].sort((left, right) => byteCompare(left.locator, right.locator)) };
}

function packageClosure(root: string, carrier: GitTreeInventory): { readonly lockDigest: string; readonly directLocators: Readonly<Record<string, string>>; readonly instances: readonly PackageInstance[] } {
  const locked = lockedPackageClosure(carrier);
  const selected = new Map<string, PackageInstance>();
  for (const instance of locked.instances) {
    const sourceDirectory = packageSourceDirectory(root, instance.locator);
    const scanned = scanPackageDirectory(sourceDirectory);
    selected.set(instance.locator, { ...instance, sourceDirectory, contentDigest: scanned.contentDigest, linkTopologyDigest: "", links: [] });
  }
  const complete = [...selected.values()].map((instance) => {
    const links = Object.entries(instance.dependencies).sort(([left], [right]) => byteCompare(left, right)).map(([name, target]) => {
      const destination = selected.get(target);
      if (destination === undefined) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A package dependency escaped the lock closure.");
      const linkPath = `node_modules/${name}`;
      const linkDirectory = dirname(`.pnpm/${packageCacheKey(instance.locator)}/${linkPath}`);
      const targetPath = `.pnpm/${packageCacheKey(destination.locator)}/node_modules/${destination.name}`;
      const targetRelative = relative(linkDirectory, targetPath).split(sep).join("/");
      if (!targetRelative.startsWith("../") || resolve("/mount", linkDirectory, targetRelative) !== resolve("/mount", targetPath)) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A package link target escaped the closure.", { locator: instance.locator, linkPath });
      return { path: linkPath, target: targetRelative };
    });
    return { ...instance, links, linkTopologyDigest: canonicalDigest(links) };
  }).sort((left, right) => byteCompare(left.locator, right.locator));
  return { lockDigest: locked.lockDigest, directLocators: locked.directLocators, instances: complete };
}

function copyPackageContent(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = resolve(source, entry.name);
    const to = resolve(destination, entry.name);
    const status = lstatSync(from);
    if (status.isSymbolicLink() || (!status.isDirectory() && !status.isFile())) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A package cache source contains an unsupported entry.");
    if (status.isDirectory()) copyPackageContent(from, to);
    else {
      copyFileSync(from, to);
      const mode = (status.mode & 0o111) === 0 ? 0o600 : 0o700;
      try { chmodSync(to, mode); } catch { return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "A package cache file could not be normalized."); }
    }
  }
}

function packageCacheKey(locator: string): string { return `${encodedLocator(locator).replace(/[^A-Za-z0-9+@._-]/gu, "_")}-${canonicalDigest(locator).slice(7, 23)}`; }

function buildPackageView(root: string, closure: ReturnType<typeof packageClosure>): string {
  ensurePrivateDirectory(root, ".usf/cache");
  ensurePrivateDirectory(root, ".usf/cache/bootstrap-carrier-packages");
  const identity = canonicalDigest({ lockDigest: closure.lockDigest, packages: closure.instances.map((item) => ({ locator: item.locator, contentDigest: item.contentDigest, linkTopologyDigest: item.linkTopologyDigest })) }).slice(7);
  const parent = resolve(root, ".usf/cache/bootstrap-carrier-packages");
  const final = resolve(parent, identity);
  const view = resolve(final, "view/node_modules");
  const metadataPath = resolve(final, "metadata.json");
  const metadata = {
    schema: "urn:usf:bootstrap-carrier-package-cache:1", lockDigest: closure.lockDigest,
    packages: closure.instances.map((item) => ({ locator: item.locator, contentDigest: item.contentDigest, linkTopologyDigest: item.linkTopologyDigest })),
    directLocators: closure.directLocators,
  };
  if (!existsSync(final)) {
    const temporary = resolve(parent, `.${identity}.${process.pid}.tmp`);
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(resolve(temporary, "view/node_modules/.pnpm"), { recursive: true, mode: 0o700 });
    for (const instance of closure.instances) {
      const packageRoot = resolve(temporary, "view/node_modules/.pnpm", packageCacheKey(instance.locator), "node_modules");
      const destination = resolve(packageRoot, ...instance.name.split("/"));
      copyPackageContent(instance.sourceDirectory, destination);
    }
    const byLocator = new Map(closure.instances.map((instance) => [instance.locator, instance]));
    for (const instance of closure.instances) {
      const packageRoot = resolve(temporary, "view/node_modules/.pnpm", packageCacheKey(instance.locator), "node_modules");
      for (const [name, targetLocator] of Object.entries(instance.dependencies)) {
        const target = byLocator.get(targetLocator)!;
        const linkPath = resolve(packageRoot, ...name.split("/"));
        mkdirSync(dirname(linkPath), { recursive: true, mode: 0o700 });
        const targetPath = resolve(temporary, "view/node_modules/.pnpm", packageCacheKey(target.locator), "node_modules", ...target.name.split("/"));
        symlinkSync(relative(dirname(linkPath), targetPath), linkPath);
      }
    }
    for (const [name, locator] of Object.entries(closure.directLocators)) {
      const instance = byLocator.get(locator)!;
      const linkPath = resolve(temporary, "view/node_modules", ...name.split("/"));
      mkdirSync(dirname(linkPath), { recursive: true, mode: 0o700 });
      const targetPath = resolve(temporary, "view/node_modules/.pnpm", packageCacheKey(instance.locator), "node_modules", ...instance.name.split("/"));
      symlinkSync(relative(dirname(linkPath), targetPath), linkPath);
    }
    writeFileSync(resolve(temporary, "metadata.json"), `${canonicalJson(metadata)}\n`, { mode: 0o600 });
    try { renameSync(temporary, final); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The authenticated package cache could not be published."); rmSync(temporary, { recursive: true, force: true }); }
  }
  const rootEntry = lstatSync(final);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory() || rootEntry.uid !== processUid(rootEntry.uid) || (rootEntry.mode & 0o077) !== 0 || realpathSync(final) !== final
    || readFileSync(metadataPath, "utf8") !== `${canonicalJson(metadata)}\n`) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CONTAINMENT_REFUSAL, "The package cache identity is invalid.");
  for (const instance of closure.instances) {
    const directory = resolve(view, ".pnpm", packageCacheKey(instance.locator), "node_modules", ...instance.name.split("/"));
    if (scanPackageDirectory(directory).contentDigest !== instance.contentDigest) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A cached package instance changed.", { locator: instance.locator });
  }
  authenticatePackageView(view, closure);
  return realpathSync(view);
}

function authenticatePackageView(view: string, closure: ReturnType<typeof packageClosure>): void {
  const byLocator = new Map(closure.instances.map((instance) => [instance.locator, instance]));
  for (const instance of closure.instances) {
    const packageRoot = resolve(view, ".pnpm", packageCacheKey(instance.locator), "node_modules");
    const observed: Array<{ path: string; target: string }> = [];
    for (const [name, targetLocator] of Object.entries(instance.dependencies).sort(([left], [right]) => byteCompare(left, right))) {
      const target = byLocator.get(targetLocator);
      if (target === undefined) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A cached package link target is outside the lock closure.");
      const linkPath = resolve(packageRoot, ...name.split("/"));
      const expectedTarget = relative(dirname(linkPath), resolve(view, ".pnpm", packageCacheKey(target.locator), "node_modules", ...target.name.split("/")));
      const status = lstatSync(linkPath);
      const actualTarget = readlinkSync(linkPath);
      if (!status.isSymbolicLink() || isAbsolute(actualTarget) || actualTarget !== expectedTarget
        || realpathSync(linkPath) !== realpathSync(resolve(dirname(linkPath), actualTarget))) {
        return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A cached package dependency link is unsafe or changed.", { locator: instance.locator, name });
      }
      observed.push({ path: `node_modules/${name}`, target: actualTarget.split(sep).join("/") });
    }
    if (canonicalDigest(observed) !== instance.linkTopologyDigest) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A cached package link topology changed.", { locator: instance.locator });
  }
  for (const [name, locator] of Object.entries(closure.directLocators).sort(([left], [right]) => byteCompare(left, right))) {
    const instance = byLocator.get(locator);
    if (instance === undefined) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A direct package link escaped the lock closure.");
    const linkPath = resolve(view, ...name.split("/"));
    const expectedTarget = relative(dirname(linkPath), resolve(view, ".pnpm", packageCacheKey(instance.locator), "node_modules", ...instance.name.split("/")));
    const status = lstatSync(linkPath);
    const actualTarget = readlinkSync(linkPath);
    if (!status.isSymbolicLink() || isAbsolute(actualTarget) || actualTarget !== expectedTarget
      || realpathSync(linkPath) !== realpathSync(resolve(dirname(linkPath), actualTarget))) {
      return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A direct cached package link is unsafe or changed.", { name });
    }
  }
}

function strictValidationCommand(command: string): { readonly tokens: readonly string[]; readonly tests: readonly string[] } {
  const tokens = command.split(" ");
  if (tokens.join(" ") !== command || tokens.length < 4 || tokens.length > 16 || tokens[0] !== "node" || tokens[1] !== "--test") {
    return refuse("BOOTSTRAP_CARRIER_VALIDATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation command is outside the closed Node test form.");
  }
  let index = 2;
  if (tokens[index] === "--test-isolation=none") index += 1;
  if (tokens[index]?.startsWith("--test-name-pattern=") === true) {
    if (!/^--test-name-pattern=[A-Za-z0-9._-]+$/u.test(tokens[index]!)) return refuse("BOOTSTRAP_CARRIER_VALIDATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A test-name pattern is invalid.");
    index += 1;
  }
  const tests = tokens.slice(index);
  if (tests.length === 0 || tests.length > 8 || new Set(tests).size !== tests.length
    || tests.some((path) => !path.endsWith(".test.ts") || safeRepositoryPath(path) !== path)
    || tokens.slice(2, index).some((token) => token !== "--test-isolation=none" && !token.startsWith("--test-name-pattern="))) {
    return refuse("BOOTSTRAP_CARRIER_VALIDATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation command contains an unsupported argument.");
  }
  return { tokens, tests };
}

function hostToolMember(identity: "git" | "node" | "bwrap", executable: string, versionArguments: readonly string[], versionPattern: RegExp): ValidationDependencyMember {
  trustedExecutable(executable);
  const result = spawnSync(executable, [...versionArguments], { env: {}, encoding: "utf8", maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const output = result.stdout.trim();
  const match = versionPattern.exec(output);
  if (result.status !== 0 || match?.[1] === undefined) return refuse("BOOTSTRAP_CARRIER_TOOL_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "A required host tool version cannot be authenticated.", { identity });
  const bytes = readFileSync(executable);
  if (bytes.byteLength > 128 * 1024 * 1024) return refuse("BOOTSTRAP_CARRIER_TOOL_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "A required host tool exceeds its byte bound.", { identity });
  return { kind: "host-tool", identity, version: match[1], contentDigest: sha256(bytes) };
}

function validationDependencyMembers(
  authority: CarrierAuthority,
  carrier: GitTreeInventory,
  validationIri: string,
  command: ReturnType<typeof strictValidationCommand>,
  packages: ReturnType<typeof packageClosure>,
): ValidationDependencyMember[] {
  const graph = authority.graph;
  const carrierPaths = validationCarrierPaths(authority, carrier, validationIri, command);
  const members: ValidationDependencyMember[] = [{ kind: "carrier-tree", identity: `${authority.commit}:${authority.tree}`, contentDigest: carrier.contentDigest }];
  for (const path of [...carrierPaths].sort(byteCompare)) {
    const entry = carrier.files.get(path);
    if (entry === undefined) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A validation carrier-file dependency is absent.", { path });
    members.push({ kind: "carrier-file", identity: path, contentDigest: entry.contentDigest, fileMode: entry.mode });
  }
  for (const instance of packages.instances) members.push({
    kind: "package", identity: instance.locator, version: instance.version, lockIntegrity: instance.integrity,
    contentDigest: instance.contentDigest, packageLinkTopologyDigest: instance.linkTopologyDigest,
  });
  const validationEnvironmentIri = one(graph, validationIri, "environment", "iri");
  const confinementPolicies = [...new Set([validationEnvironmentIri, noNetworkEnvironmentIri])].sort(byteCompare);
  members.push(
    hostToolMember("git", "/usr/bin/git", ["--version"], /^git version ([^\s]+)$/u),
    hostToolMember("node", realpathSync(process.execPath), ["--version"], /^v([^\s]+)$/u),
    hostToolMember("bwrap", "/usr/bin/bwrap", ["--version"], /^bubblewrap ([^\s]+)$/u),
    { kind: "authority-resource", identity: validationIri, contentDigest: resourceDigest(graph, validationIri) },
    { kind: "authority-resource", identity: deterministicExecutionModeIri, contentDigest: resourceDigest(graph, deterministicExecutionModeIri) },
    { kind: "authority-resource", identity: algorithmIri, contentDigest: resourceDigest(graph, algorithmIri) },
    ...confinementPolicies.map((identity) => ({ kind: "confinement-policy" as const, identity, contentDigest: resourceDigest(graph, identity) })),
  );
  members.sort((left, right) => byteCompare(left.kind, right.kind) || byteCompare(left.identity, right.identity));
  const identities = members.map((member) => `${member.kind}\0${member.identity}`);
  if (new Set(identities).size !== identities.length) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The validation dependency set contains duplicates.");
  return members;
}

function validationCarrierPaths(
  authority: CarrierAuthority,
  carrier: GitTreeInventory,
  validationIri: string,
  command: ReturnType<typeof strictValidationCommand>,
): Set<string> {
  const graph = authority.graph;
  const paths = new Set<string>(["package.json", "pnpm-lock.yaml", ...command.tests, ...many(graph, validationIri, "carrierBasisTestPath", "literal")]);
  if (authority.admissionReceiptIri !== undefined) {
    paths.add(one(graph, authority.admissionReceiptIri, "repositoryPath", "literal"));
    paths.add(one(graph, authority.admissionReceiptIri, "schemaPath", "literal"));
  }
  return paths;
}

function authenticateWorktree(worktree: string, carrier: GitTreeInventory): void {
  const rootEntry = lstatSync(worktree);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory() || rootEntry.uid !== processUid(rootEntry.uid) || (rootEntry.mode & 0o077) !== 0 || realpathSync(worktree) !== worktree) {
    refuse("BOOTSTRAP_CARRIER_WORKTREE_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "The detached carrier worktree is unsafe.");
  }
  for (const file of carrier.files.values()) {
    const absolute = resolve(worktree, file.path);
    let status: ReturnType<typeof lstatSync>;
    try { status = lstatSync(absolute); }
    catch { return refuse("BOOTSTRAP_CARRIER_WORKTREE_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "A detached carrier file is missing.", { path: file.path }); }
    const mode: GitFileMode = (status.mode & 0o111) === 0 ? "100644" : "100755";
    if (status.isSymbolicLink() || !status.isFile() || realpathSync(absolute) !== absolute || mode !== file.mode || !readFileSync(absolute).equals(file.bytes)) {
      return refuse("BOOTSTRAP_CARRIER_WORKTREE_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "A detached carrier file differs from its authenticated raw blob.", { path: file.path });
    }
  }
}

async function withDetachedCarrierWorktree<T>(root: string, authority: CarrierAuthority, carrier: GitTreeInventory, operation: (worktree: string) => Promise<T>): Promise<T> {
  ensurePrivateDirectory(root, ".usf/integration-worktrees");
  ensurePrivateDirectory(root, ".usf/integration-worktrees/bootstrap-carrier");
  const identity = canonicalDigest(authority.adoptionIri).slice(7);
  const worktree = resolve(root, ".usf/integration-worktrees/bootstrap-carrier", identity);
  if (existsSync(worktree)) {
    const existing = lstatSync(worktree);
    if (existing.isSymbolicLink() || !existing.isDirectory() || !relativeContained(root, worktree)) refuse("BOOTSTRAP_CARRIER_WORKTREE_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A prior detached carrier path is unsafe.");
    const removed = gitResult(root, ["worktree", "remove", "--force", worktree]);
    if (removed.status !== 0) refuse("BOOTSTRAP_CARRIER_WORKTREE_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A prior detached carrier worktree cannot be authenticated and removed.");
    rmSync(worktree, { recursive: true, force: true });
  }
  const added = gitResult(root, ["worktree", "add", "--detach", worktree, authority.commit]);
  if (added.status !== 0) refuse("BOOTSTRAP_CARRIER_GIT_FAILED", exitCodes.EXTERNAL_UNAVAILABLE, "The detached carrier worktree could not be created.");
  await chmod(worktree, 0o700);
  try {
    authenticateWorktree(worktree, carrier);
    if (git(root, ["-C", worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all"]).byteLength !== 0) {
      refuse("BOOTSTRAP_CARRIER_WORKTREE_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The detached carrier worktree is not clean.");
    }
    for (const mountPath of ["node_modules", ".usf"] as const) {
      const absoluteMount = resolve(worktree, mountPath);
      if (existsSync(absoluteMount) || [...carrier.files.keys()].some((path) => path === mountPath || path.startsWith(`${mountPath}/`))) {
        refuse("BOOTSTRAP_CARRIER_WORKTREE_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The detached carrier worktree already contains a synthetic validation mount path.", { mountPath });
      }
      mkdirSync(absoluteMount, { mode: 0o700 });
    }
    return await operation(worktree);
  } finally {
    const removed = gitResult(root, ["worktree", "remove", "--force", worktree]);
    if (removed.status !== 0) rmSync(worktree, { recursive: true, force: true });
  }
}

interface ValidationExecutionObservation {
  readonly exitCode: number;
  readonly outputWithinLimit: boolean;
  readonly timedOut: boolean;
  readonly lastTerminationSignal: "not-used" | "SIGTERM" | "SIGKILL";
}

async function executeValidation(worktree: string, scratch: string, packageView: string, command: readonly string[], authority: CarrierAuthority): Promise<ValidationExecutionObservation> {
  trustedExecutable("/usr/bin/bwrap");
  trustedExecutable(realpathSync(process.execPath));
  if (!process.allowedNodeEnvironmentFlags.has("--permission")) return refuse("BOOTSTRAP_CARRIER_VALIDATION_DEPENDENCY_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The exact Node permission boundary is unavailable.");
  const systemRoots = ["/usr", "/lib", "/lib64"].filter((path) => existsSync(path));
  const arguments_ = [
    "--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent", "--tmpfs", "/",
    ...systemRoots.flatMap((path) => ["--ro-bind", path, path]),
    "--ro-bind", worktree, "/workspace", "--ro-bind", packageView, "/workspace/node_modules",
    "--proc", "/proc", "--dev", "/dev", "--bind", scratch, "/usf-scratch", "--bind", resolve(scratch, "workspace-state"), "/workspace/.usf", "--chdir", "/workspace", "--clearenv",
    "--setenv", "LANG", "C.UTF-8", "--setenv", "LC_ALL", "C.UTF-8", "--setenv", "TZ", "UTC",
    "--setenv", "HOME", "/usf-scratch/home", "--setenv", "TMPDIR", "/usf-scratch/tmp",
    "--setenv", "XDG_CACHE_HOME", "/usf-scratch/xdg/cache", "--setenv", "XDG_CONFIG_HOME", "/usf-scratch/xdg/config",
    "--setenv", "XDG_DATA_HOME", "/usf-scratch/xdg/data", "--setenv", "XDG_STATE_HOME", "/usf-scratch/xdg/state",
    "--", realpathSync(process.execPath), "--permission", "--allow-fs-read=/workspace", "--allow-fs-read=/usf-scratch", "--allow-fs-write=/usf-scratch", "--allow-fs-write=/workspace/.usf", ...command.slice(1),
  ];
  return new Promise((finish, reject) => {
    const child = spawn("/usr/bin/bwrap", arguments_, { cwd: worktree, env: {}, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let outputBytes = 0;
    let outputWithinLimit = true;
    let timedOut = false;
    let lastTerminationSignal: ValidationExecutionObservation["lastTerminationSignal"] = "not-used";
    let settled = false;
    let wallTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const terminate = (signal: "SIGTERM" | "SIGKILL"): void => {
      try { if (child.pid !== undefined) process.kill(-child.pid, signal); else child.kill(signal); }
      catch { try { child.kill(signal); } catch { /* already exited */ } }
      lastTerminationSignal = signal;
    };
    const settle = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      if (wallTimer !== undefined) clearTimeout(wallTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      finish({ exitCode, outputWithinLimit, timedOut, lastTerminationSignal });
    };
    const observe = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumValidationOutputBytes && outputWithinLimit) { outputWithinLimit = false; terminate("SIGKILL"); }
    };
    child.stdout?.on("data", observe);
    child.stderr?.on("data", observe);
    child.once("error", (error) => { if (!settled) { settled = true; reject(new UsfError("BOOTSTRAP_CARRIER_VALIDATION_DEPENDENCY_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "The confined validation child could not start.", { code: (error as NodeJS.ErrnoException).code })); } });
    child.once("exit", (code) => settle(code ?? 1));
    wallTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      terminate("SIGTERM");
      graceTimer = setTimeout(() => { if (!settled) { terminate("SIGKILL"); settle(1); } }, authority.terminationGraceMilliseconds);
    }, authority.wallTimeMilliseconds);
  });
}

async function runHistoricalValidations(root: string, authority: CarrierAuthority, carrier: GitTreeInventory): Promise<BootstrapCarrierValidationResult[]> {
  const packages = packageClosure(root, carrier);
  const packageView = buildPackageView(root, packages);
  return withDetachedCarrierWorktree(root, authority, carrier, async (worktree) => {
    const results: BootstrapCarrierValidationResult[] = [];
    for (const validationIri of authority.validationIris) {
      const graph = authority.graph;
      const command = strictValidationCommand(one(graph, validationIri, "command", "literal"));
      const validationEnvironmentIri = one(graph, validationIri, "environment", "iri");
      if (validationEnvironmentIri !== "urn:usf:environment:hermetic" && validationEnvironmentIri !== noNetworkEnvironmentIri) {
        refuse("BOOTSTRAP_CARRIER_VALIDATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A carrier validation environment is not an admitted hermetic environment.");
      }
      if (one(graph, validationIri, "executionMode", "iri") !== deterministicExecutionModeIri
        || one(graph, validationIri, "applicability", "literal") !== "required") {
        refuse("BOOTSTRAP_CARRIER_VALIDATION_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A carrier validation does not bind the required confinement and execution mode.");
      }
      for (const testPath of command.tests) if (!carrier.files.has(testPath)) refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A declared historical test is absent from the carrier.", { testPath });
      const dependencies = validationDependencyMembers(authority, carrier, validationIri, command, packages);
      const validationKey = canonicalDigest(validationIri).slice(7);
      const scratchPath = `.usf/tmp/bootstrap-carrier/${canonicalDigest(authority.adoptionIri).slice(7)}/${validationKey}`;
      const scratch = resolve(root, scratchPath);
      rmSync(scratch, { recursive: true, force: true });
      ensurePrivateDirectory(root, ".usf/tmp/bootstrap-carrier");
      ensurePrivateDirectory(root, `.usf/tmp/bootstrap-carrier/${canonicalDigest(authority.adoptionIri).slice(7)}`);
      ensurePrivateDirectory(root, scratchPath);
      for (const child of ["home", "tmp", "workspace-state", "xdg", "xdg/cache", "xdg/config", "xdg/data", "xdg/state"]) ensurePrivateDirectory(root, `${scratchPath}/${child}`);
      let observation: ValidationExecutionObservation;
      try { observation = await executeValidation(worktree, scratch, packageView, command.tokens, authority); }
      finally { rmSync(scratch, { recursive: true, force: true }); }
      if (observation.timedOut) refuse("BOOTSTRAP_CARRIER_VALIDATION_TIMEOUT", exitCodes.DOMAIN_FAILURE, "A historical carrier validation exceeded its graph wall-time limit.", { validationIri });
      if (!observation.outputWithinLimit || observation.exitCode !== 0) refuse("BOOTSTRAP_CARRIER_VALIDATION_FAILED", exitCodes.DOMAIN_FAILURE, "A historical carrier validation failed.", { validationIri, exitCode: observation.exitCode, outputWithinLimit: observation.outputWithinLimit });
      const draft = {
        validationIri, validationResourceDigest: resourceDigest(graph, validationIri), carrierCommit: authority.commit, carrierTree: authority.tree,
        commandDigest: canonicalDigest(command.tokens), commandTokens: command.tokens,
        environmentDigest: resourceDigest(graph, validationEnvironmentIri), executionModeDigest: resourceDigest(graph, deterministicExecutionModeIri),
        dependencyDigest: canonicalDigest(dependencies), dependencyMembers: dependencies, wallTimeLimitMilliseconds: 120000 as const,
        terminationGraceMilliseconds: 5000 as const, timedOut: false as const, lastTerminationSignal: "not-used" as const,
        exitCode: 0 as const, outcome: "pass" as const, failureIdentities: [] as const, failureSetDigest: canonicalDigest([]),
      };
      results.push(Object.freeze({ ...draft, normalizedResultDigest: canonicalDigest(draft) }));
    }
    return results.sort((left, right) => byteCompare(left.validationIri, right.validationIri));
  });
}

type AdmissionReceiptBinding = Pick<BootstrapCarrierReceipt,
  "admissionReceiptApplicability" | "existingAdmissionReceiptPath" | "existingAdmissionReceiptContentDigest" | "existingAdmissionReceiptCanonicalDigest">;

function carrierPostimageProjection(pathEffects: readonly BootstrapCarrierPathEffect[]): readonly Record<string, unknown>[] {
  return pathEffects.map((effect) => ({
    repositoryPath: effect.repositoryPath,
    disposition: effect.disposition,
    carrierPostimageState: effect.carrierPostimageState,
    ...(effect.carrierPostimageState === "present" ? { carrierPostimageDigest: effect.carrierPostimageDigest, carrierPostimageMode: effect.carrierPostimageMode } : {}),
  }));
}

function currentPostimageProjection(pathEffects: readonly BootstrapCarrierPathEffect[]): readonly Record<string, unknown>[] {
  return pathEffects.map((effect) => ({
    repositoryPath: effect.repositoryPath,
    disposition: effect.disposition,
    observedCurrentPostimageState: effect.observedCurrentPostimageState,
    ...(effect.observedCurrentPostimageState === "present" ? { observedCurrentPostimageDigest: effect.observedCurrentPostimageDigest, observedCurrentPostimageMode: effect.observedCurrentPostimageMode } : {}),
    observedCurrentnessDisposition: effect.observedCurrentnessDisposition,
  }));
}

function deriveAdmissionReceiptBinding(authority: CarrierAuthority, carrier: GitTreeInventory): AdmissionReceiptBinding {
  if (authority.admissionReceiptIri === undefined) return Object.freeze({ admissionReceiptApplicability: "not-applicable" });
  const graph = authority.graph;
  const receiptPath = safeRepositoryPath(one(graph, authority.admissionReceiptIri, "repositoryPath", "literal"));
  const schemaPath = safeRepositoryPath(one(graph, authority.admissionReceiptIri, "schemaPath", "literal"));
  const receiptEntry = carrier.files.get(receiptPath);
  const schemaEntry = carrier.files.get(schemaPath);
  if (receiptEntry === undefined || schemaEntry === undefined) return refuse("BOOTSTRAP_CARRIER_ADMISSION_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The declared admission receipt or schema is absent from the carrier.");
  if (receiptEntry.contentDigest !== one(graph, authority.admissionReceiptIri, "contentDigest", "literal")) return refuse("BOOTSTRAP_CARRIER_ADMISSION_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The admission receipt content digest differs from authority.");
  let schema: unknown;
  let receipt: unknown;
  try {
    schema = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(schemaEntry.bytes));
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receiptEntry.bytes));
    if (!createJsonSchemaValidator(schema).validate(receipt).valid) throw new Error("schema");
    assertVerifiedTransitionReceipt(receipt);
  } catch {
    return refuse("BOOTSTRAP_CARRIER_ADMISSION_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The declared admission receipt failed its exact schema or digest validation.");
  }
  const verified = receipt as { readonly algorithm: string; readonly transition: string; readonly receiptDigest: string };
  if (`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n` !== receiptEntry.bytes.toString("utf8")
    || verified.receiptDigest !== one(graph, authority.admissionReceiptIri, "receiptDigest", "literal")
    || verified.algorithm !== one(graph, authority.admissionReceiptIri, "algorithm", "iri")
    || verified.transition !== one(graph, authority.admissionReceiptIri, "transition", "iri")) {
    return refuse("BOOTSTRAP_CARRIER_ADMISSION_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The declared admission receipt binding is not exact.");
  }
  return Object.freeze({
    admissionReceiptApplicability: "required",
    existingAdmissionReceiptPath: receiptPath,
    existingAdmissionReceiptContentDigest: receiptEntry.contentDigest,
    existingAdmissionReceiptCanonicalDigest: verified.receiptDigest,
  });
}

function receiptDraft(
  authority: CarrierAuthority,
  pathEffects: readonly BootstrapCarrierPathEffect[],
  currentBasis: { readonly commit: string; readonly tree: GitTreeInventory },
  validationResults: readonly BootstrapCarrierValidationResult[],
  admission: AdmissionReceiptBinding,
  observedAuthorityGraphDigest = authority.graph.graphDigests[integrationGraphIri],
): Omit<BootstrapCarrierReceipt, "receiptDigest"> {
  if (observedAuthorityGraphDigest === undefined || !digestPattern.test(observedAuthorityGraphDigest)) return refuse("BOOTSTRAP_CARRIER_AUTHORITY_INVALID", exitCodes.CURRENTNESS_FAILURE, "The integration named-graph digest is unavailable.");
  const included = pathEffects.filter((effect) => effect.disposition === "included");
  const excluded = pathEffects.filter((effect) => effect.disposition === "excluded");
  return Object.freeze({
    schema: "urn:usf:bootstrap-carrier-adoption-receipt:1",
    authorityClass: "HistoricalCarrierObservation",
    genericEvidenceEligibility: "forbidden",
    algorithmIri,
    algorithmVersion: one(authority.graph, algorithmIri, "version", "literal"),
    algorithmResourceDigest: resourceDigest(authority.graph, algorithmIri),
    authorityGraphIri: integrationGraphIri,
    observedAuthorityGraphDigest,
    authorityManifestPath: integrationManifestPath,
    authorityManifestDigest: authority.authorityManifestDigest,
    scopedAuthorityDependencyDigest: authority.scopedAuthorityDependencyDigest,
    authorityProfileIri: authority.profileIri,
    authorityProfileVersion: authority.profileVersion,
    currentnessAuthorityIri: authority.currentnessAuthorityIri,
    currentnessAuthorityResourceDigest: resourceDigest(authority.graph, authority.currentnessAuthorityIri),
    commandIri,
    commandResourceDigest: resourceDigest(authority.graph, commandIri),
    receiptSchemaIri,
    receiptSchemaResourceDigest: resourceDigest(authority.graph, receiptSchemaIri),
    pathEffectSchemaIri,
    pathEffectSchemaResourceDigest: resourceDigest(authority.graph, pathEffectSchemaIri),
    adoptedSubjectSchemaIri,
    adoptedSubjectSchemaResourceDigest: resourceDigest(authority.graph, adoptedSubjectSchemaIri),
    validationResultSchemaIri,
    validationResultSchemaResourceDigest: resourceDigest(authority.graph, validationResultSchemaIri),
    publicationPermissionIri: permissionIri,
    publicationPermissionResourceDigest: resourceDigest(authority.graph, permissionIri),
    adoptionStateRuleIri: authority.adoptionStateRuleIri,
    adoptionStateRuleResourceDigest: resourceDigest(authority.graph, authority.adoptionStateRuleIri),
    carrierAdoptionIri: authority.adoptionIri,
    carrierAdoptionResourceDigest: resourceDigest(authority.graph, authority.adoptionIri),
    lineageMode: authority.lineageMode,
    parentCommit: authority.parentCommit,
    commit: authority.commit,
    tree: authority.tree,
    pathEffectSetResourceDigest: resourceDigest(authority.graph, authority.pathEffectSetIri),
    coverageMode: authority.coverageMode,
    carrierTotalPathEffectCount: authority.carrierTotalPathEffectCount,
    selectedPathEffectCount: authority.selectedPathEffectCount,
    scopedPathEffectSetDigest: canonicalDigest(pathEffects),
    includedPathEffectSetDigest: canonicalDigest(included),
    excludedPathEffectSetDigest: canonicalDigest(excluded),
    pathEffects,
    adoptedSubjects: authority.adoptedSubjects,
    adoptedSubjectSetDigest: canonicalDigest(authority.adoptedSubjects),
    ...admission,
    carrierPostimageSetDigest: canonicalDigest(carrierPostimageProjection(pathEffects)),
    currentObservationBasisCommit: currentBasis.commit,
    currentObservationBasisTree: currentBasis.tree.treeId,
    observedCurrentPostimageSetDigest: canonicalDigest(currentPostimageProjection(pathEffects)),
    reachabilityBasisCommit: currentBasis.commit,
    reachabilityBasisTree: currentBasis.tree.treeId,
    carrierReachability: "reachable-from-current-head",
    validationResultSetDigest: canonicalDigest(validationResults),
    validationResults,
    nonClaimSetDigest: canonicalDigest(authority.nonClaims),
    nonClaims: authority.nonClaims,
    observedCurrentnessDisposition: aggregateCurrentness(pathEffects),
    completionState: "not-observed",
    evidenceState: "not-admitted",
    proofState: "not-evaluated",
    ordinaryPermissionState: "unchanged",
    runtimeState: "unchanged",
    localPreparationReceiptPath: authority.localPreparationReceiptPath,
    trackedReceiptPath: authority.trackedReceiptPath,
    outcome: "verified",
  });
}

function buildReceipt(
  authority: CarrierAuthority,
  pathEffects: readonly BootstrapCarrierPathEffect[],
  currentBasis: { readonly commit: string; readonly tree: GitTreeInventory },
  validationResults: readonly BootstrapCarrierValidationResult[],
  admission: AdmissionReceiptBinding,
): BootstrapCarrierReceipt {
  const draft = receiptDraft(authority, pathEffects, currentBasis, validationResults, admission);
  return Object.freeze({ ...draft, receiptDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) });
}

function lockedPackageLinkTopologyDigest(closure: ReturnType<typeof lockedPackageClosure>, instance: LockedPackageInstance): string {
  const byLocator = new Map(closure.instances.map((candidate) => [candidate.locator, candidate]));
  const links = Object.entries(instance.dependencies).sort(([left], [right]) => byteCompare(left, right)).map(([name, targetLocator]) => {
    const target = byLocator.get(targetLocator);
    if (target === undefined) return refuse("BOOTSTRAP_CARRIER_DEPENDENCY_INVALID", exitCodes.CURRENTNESS_FAILURE, "A recorded package dependency escaped the carrier lock closure.");
    const linkPath = `node_modules/${name}`;
    const linkDirectory = dirname(`.pnpm/${packageCacheKey(instance.locator)}/${linkPath}`);
    const targetPath = `.pnpm/${packageCacheKey(target.locator)}/node_modules/${target.name}`;
    return { path: linkPath, target: relative(linkDirectory, targetPath).split(sep).join("/") };
  });
  return canonicalDigest(links);
}

function assertValidationDependencyMember(member: ValidationDependencyMember): void {
  const common = ["kind", "identity", "contentDigest"];
  const expected = member.kind === "carrier-file" ? [...common, "fileMode"]
    : member.kind === "package" ? [...common, "version", "lockIntegrity", "packageLinkTopologyDigest"]
      : member.kind === "host-tool" ? [...common, "version"] : common;
  if (!exactKeys(member, expected) || typeof member.identity !== "string" || member.identity.length === 0 || !digestPattern.test(member.contentDigest)) {
    refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation dependency member has an invalid closed shape.");
  }
  if (member.kind === "carrier-file" && member.fileMode !== "100644" && member.fileMode !== "100755") refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical carrier-file mode is invalid.");
  if ((member.kind === "package" || member.kind === "host-tool") && (typeof member.version !== "string" || member.version.length === 0)) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical dependency version is invalid.");
  if (member.kind === "package" && (typeof member.lockIntegrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(member.lockIntegrity)
    || typeof member.packageLinkTopologyDigest !== "string" || !digestPattern.test(member.packageLinkTopologyDigest))) {
    refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical package dependency binding is invalid.");
  }
}

function assertHistoricalValidationResults(
  authority: CarrierAuthority,
  carrier: GitTreeInventory,
  results: readonly BootstrapCarrierValidationResult[],
): void {
  if (results.length !== authority.validationIris.length
    || results.some((result, index) => result.validationIri !== authority.validationIris[index])) {
    refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The historical validation-result set differs from authority.");
  }
  const locked = lockedPackageClosure(carrier);
  const lockedByLocator = new Map(locked.instances.map((instance) => [instance.locator, instance]));
  const resultKeys = [
    "validationIri", "validationResourceDigest", "carrierCommit", "carrierTree", "commandDigest", "commandTokens",
    "environmentDigest", "executionModeDigest", "dependencyDigest", "dependencyMembers", "wallTimeLimitMilliseconds",
    "terminationGraceMilliseconds", "timedOut", "lastTerminationSignal", "exitCode", "outcome", "failureIdentities",
    "failureSetDigest", "normalizedResultDigest",
  ];
  for (const result of results) {
    if (!exactKeys(result, resultKeys) || !authority.validationIris.includes(result.validationIri)) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation result has an invalid closed shape.");
    const command = strictValidationCommand(one(authority.graph, result.validationIri, "command", "literal"));
    const environmentIri = one(authority.graph, result.validationIri, "environment", "iri");
    if (result.validationResourceDigest !== resourceDigest(authority.graph, result.validationIri)
      || result.carrierCommit !== authority.commit || result.carrierTree !== authority.tree
      || canonicalJson(result.commandTokens) !== canonicalJson(command.tokens) || result.commandDigest !== canonicalDigest(command.tokens)
      || result.environmentDigest !== resourceDigest(authority.graph, environmentIri)
      || result.executionModeDigest !== resourceDigest(authority.graph, deterministicExecutionModeIri)
      || result.wallTimeLimitMilliseconds !== authority.wallTimeMilliseconds
      || result.terminationGraceMilliseconds !== authority.terminationGraceMilliseconds
      || result.timedOut !== false || result.lastTerminationSignal !== "not-used" || result.exitCode !== 0 || result.outcome !== "pass"
      || !Array.isArray(result.failureIdentities) || result.failureIdentities.length !== 0 || result.failureSetDigest !== canonicalDigest([])) {
      refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation result differs from its graph-derived passing form.");
    }
    if (!Array.isArray(result.dependencyMembers)) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical dependency set is absent.");
    const members = result.dependencyMembers;
    members.forEach(assertValidationDependencyMember);
    if (members.some((member, index) => index > 0 && (byteCompare(members[index - 1]!.kind, member.kind) > 0
      || (members[index - 1]!.kind === member.kind && byteCompare(members[index - 1]!.identity, member.identity) >= 0)))) {
      refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical dependency set is not strictly ordered and unique.");
    }
    const byIdentity = new Map(members.map((member) => [`${member.kind}\0${member.identity}`, member]));
    const expectedStatic: ValidationDependencyMember[] = [{ kind: "carrier-tree", identity: `${authority.commit}:${authority.tree}`, contentDigest: carrier.contentDigest }];
    for (const path of [...validationCarrierPaths(authority, carrier, result.validationIri, command)].sort(byteCompare)) {
      const entry = carrier.files.get(path);
      if (entry === undefined) return refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation carrier dependency is absent.", { path });
      expectedStatic.push({ kind: "carrier-file", identity: path, contentDigest: entry.contentDigest, fileMode: entry.mode });
    }
    expectedStatic.push(
      { kind: "authority-resource", identity: result.validationIri, contentDigest: resourceDigest(authority.graph, result.validationIri) },
      { kind: "authority-resource", identity: deterministicExecutionModeIri, contentDigest: resourceDigest(authority.graph, deterministicExecutionModeIri) },
      { kind: "authority-resource", identity: algorithmIri, contentDigest: resourceDigest(authority.graph, algorithmIri) },
      ...[...new Set([environmentIri, noNetworkEnvironmentIri])].sort(byteCompare)
        .map((identity) => ({ kind: "confinement-policy" as const, identity, contentDigest: resourceDigest(authority.graph, identity) })),
    );
    for (const expected of expectedStatic) {
      const observed = byIdentity.get(`${expected.kind}\0${expected.identity}`);
      if (observed === undefined || canonicalJson(observed) !== canonicalJson(expected)) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation static dependency differs from authority.", { identity: expected.identity });
    }
    const tools = members.filter((member) => member.kind === "host-tool");
    if (canonicalJson(tools.map((member) => member.identity)) !== canonicalJson(["bwrap", "git", "node"])) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The historical host-tool dependency set is incomplete.");
    const packages = members.filter((member) => member.kind === "package");
    if (packages.length !== locked.instances.length) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The historical package dependency denominator differs from the carrier lock.");
    for (const member of packages) {
      const expected = lockedByLocator.get(member.identity);
      if (expected === undefined || member.version !== expected.version || member.lockIntegrity !== expected.integrity
        || member.packageLinkTopologyDigest !== lockedPackageLinkTopologyDigest(locked, expected)) {
        refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical package dependency differs from the carrier lock.", { locator: member.identity });
      }
    }
    if (members.length !== expectedStatic.length + tools.length + packages.length || result.dependencyDigest !== canonicalDigest(members)) {
      refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The historical dependency set contains an extra member or wrong digest.");
    }
    const { normalizedResultDigest, ...normalizedDraft } = result;
    if (normalizedResultDigest !== canonicalDigest(normalizedDraft)) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical validation normalized-result digest is invalid.");
  }
}

function validateBootstrapReceiptSchema(root: string, value: unknown): void {
  const absolute = resolve(root, bootstrapReceiptSchemaPath);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile() || realpathSync(absolute) !== absolute || status.size > 1024 * 1024) refuse("BOOTSTRAP_CARRIER_RECEIPT_SCHEMA_INVALID", exitCodes.CURRENTNESS_FAILURE, "The bootstrap carrier receipt schema file is unsafe.");
  let validator: ReturnType<typeof createJsonSchemaValidator<BootstrapCarrierReceipt>>;
  try {
    const schema = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
    validator = createJsonSchemaValidator<BootstrapCarrierReceipt>(schema);
  } catch {
    return refuse("BOOTSTRAP_CARRIER_RECEIPT_SCHEMA_INVALID", exitCodes.CURRENTNESS_FAILURE, "The bootstrap carrier receipt schema could not be compiled.");
  }
  const result = validator.validate(value);
  if (!result.valid) {
    refuse("BOOTSTRAP_CARRIER_RECEIPT_SCHEMA_INVALID", exitCodes.CURRENTNESS_FAILURE, "The bootstrap carrier receipt failed its closed JSON schema.", {
      errors: result.errors,
      truncatedErrors: result.truncatedErrors,
    });
  }
}

function authenticateHistoricalReceipt(
  root: string,
  authority: CarrierAuthority,
  parent: GitTreeInventory,
  carrier: GitTreeInventory,
  receipt: BootstrapCarrierReceipt,
): BootstrapCarrierReceipt {
  validateBootstrapReceiptSchema(root, receipt);
  if (!digestPattern.test(receipt.observedAuthorityGraphDigest)) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The historical authority-graph observation digest is invalid.");
  assertHistoricalValidationResults(authority, carrier, receipt.validationResults);
  const currentHeaders = commitHeaders(root, receipt.currentObservationBasisCommit);
  const reachabilityHeaders = commitHeaders(root, receipt.reachabilityBasisCommit);
  if (currentHeaders.tree !== receipt.currentObservationBasisTree || reachabilityHeaders.tree !== receipt.reachabilityBasisTree) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A historical observation basis tree is invalid.");
  assertReachable(root, receipt.reachabilityBasisCommit, authority.commit);
  const recordedBasis = { commit: receipt.currentObservationBasisCommit, tree: treeInventory(root, receipt.currentObservationBasisTree) };
  const pathEffects = derivePathEffects(authority, parent, carrier, recordedBasis.tree);
  const admission = deriveAdmissionReceiptBinding(authority, carrier);
  const expectedDraft = receiptDraft(authority, pathEffects, recordedBasis, receipt.validationResults, admission, receipt.observedAuthorityGraphDigest);
  const { receiptDigest, ...observedDraft } = receipt;
  if (receiptDigest !== canonicalDigest(observedDraft, { rejectAbsolutePaths: true })
    || canonicalJson(observedDraft, { rejectAbsolutePaths: true }) !== canonicalJson(expectedDraft, { rejectAbsolutePaths: true })) {
    refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The historical carrier receipt differs from its immutable authority and recorded observation basis.");
  }
  return receipt;
}

interface AuthenticatedFile {
  readonly bytes: Buffer;
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly mode: number;
  readonly nlink: number;
}

function authenticateDirectoryChain(root: string, repositoryDirectory: string, privateDirectory: boolean, missingAllowed = false): boolean {
  if (repositoryDirectory === "") return true;
  safeRepositoryPath(repositoryDirectory, privateDirectory);
  let cursor = root;
  for (const segment of repositoryDirectory.split("/")) {
    cursor = resolve(cursor, segment);
    let status: ReturnType<typeof lstatSync>;
    try { status = lstatSync(cursor); }
    catch (error) {
      if (missingAllowed && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
      return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A receipt ancestor is missing or unsafe.", { repositoryDirectory });
    }
    if (status.isSymbolicLink() || !status.isDirectory() || status.uid !== processUid(status.uid) || (status.mode & 0o7000) !== 0 || (status.mode & 0o002) !== 0
      || (privateDirectory && (status.mode & 0o777) !== 0o700) || realpathSync(cursor) !== cursor || !relativeContained(root, cursor)) {
      return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A receipt ancestor is not owner-controlled and contained.", { repositoryDirectory });
    }
  }
  return true;
}

async function authenticatedFile(
  root: string,
  repositoryPath: string,
  options: { readonly privateFile: boolean; readonly allowedLinks: readonly number[]; readonly maximumBytes: number },
): Promise<AuthenticatedFile | null> {
  safeRepositoryPath(repositoryPath, options.privateFile);
  const parent = dirname(repositoryPath) === "." ? "" : dirname(repositoryPath);
  if (!authenticateDirectoryChain(root, parent, options.privateFile, true)) return null;
  const absolute = resolve(root, repositoryPath);
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A receipt file could not be opened without following links.", { repositoryPath });
  }
  try {
    const before = await handle.stat();
    const named = await lstat(absolute).catch(() => refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A receipt file changed during authentication."));
    const permittedMode = options.privateFile ? (before.mode & 0o777) === 0o600 && (before.mode & 0o7000) === 0
      : (before.mode & 0o7133) === 0;
    if (!before.isFile() || named.isSymbolicLink() || !named.isFile() || before.uid !== processUid(before.uid)
      || !permittedMode || !options.allowedLinks.includes(before.nlink) || before.size > options.maximumBytes
      || before.dev !== named.dev || before.ino !== named.ino || realpathSync(absolute) !== absolute) {
      return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A receipt file failed owner, mode, link or containment authentication.", { repositoryPath });
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.byteLength !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || !options.allowedLinks.includes(after.nlink)) {
      return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A receipt file moved while it was read.", { repositoryPath });
    }
    return Object.freeze({ bytes, dev: after.dev, ino: after.ino, uid: after.uid, mode: after.mode, nlink: after.nlink });
  } finally { await handle.close(); }
}

function parseBootstrapReceiptBytes(root: string, bytes: Buffer): BootstrapCarrierReceipt {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A tracked carrier receipt is not valid UTF-8 JSON."); }
  validateBootstrapReceiptSchema(root, parsed);
  if (`${canonicalJson(parsed, { rejectAbsolutePaths: true })}\n` !== bytes.toString("utf8")) refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "A tracked carrier receipt is not canonical JSON plus one newline.");
  return parsed as BootstrapCarrierReceipt;
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    .catch(() => refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A publication directory could not be opened safely."));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function unlinkAuthenticated(root: string, repositoryPath: string, expected: AuthenticatedFile, privateFile: boolean): Promise<void> {
  const absolute = resolve(root, repositoryPath);
  authenticateDirectoryChain(root, dirname(repositoryPath), privateFile);
  const named = await lstat(absolute).catch(() => refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A transient receipt vanished before cleanup."));
  if (named.isSymbolicLink() || named.dev !== expected.dev || named.ino !== expected.ino || named.uid !== expected.uid || named.mode !== expected.mode) {
    refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A transient receipt changed before cleanup.");
  }
  await unlink(absolute).catch(() => refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A transient receipt could not be removed safely."));
  await fsyncDirectory(dirname(absolute));
}

async function flockDescriptor(handle: Awaited<ReturnType<typeof open>>): Promise<number> {
  trustedExecutable("/usr/bin/flock");
  return new Promise((finish) => {
    const child = spawn("/usr/bin/flock", ["--nonblock", "--conflict-exit-code", "75", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] });
    child.once("error", () => finish(127));
    child.once("exit", (code) => finish(code ?? 127));
  });
}

interface AdoptionLock { readonly handle: Awaited<ReturnType<typeof open>>; readonly path: string; readonly dev: number; readonly ino: number }

async function acquireAdoptionLock(root: string, adoptionIri: string): Promise<AdoptionLock> {
  ensurePrivateDirectory(root, ".usf/locks");
  ensurePrivateDirectory(root, ".usf/locks/bootstrap-carrier");
  const path = resolve(root, `.usf/locks/bootstrap-carrier/${canonicalDigest(adoptionIri).slice(7)}.lock`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>>;
    let created = false;
    let retained = false;
    try { handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); created = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The per-adoption lock could not be created.");
      handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        .catch(() => refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The existing per-adoption lock is unsafe."));
    }
    try {
      const opened = await handle.stat();
      const named = await lstat(path).catch(() => refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The per-adoption lock moved."));
      if (!opened.isFile() || named.isSymbolicLink() || !named.isFile() || opened.uid !== processUid(opened.uid) || opened.nlink !== 1
        || opened.size !== 0 || (opened.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino || realpathSync(path) !== path) {
        return refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The per-adoption lock is unsafe.");
      }
      const code = await flockDescriptor(handle);
      if (code === 75) return refuse("BOOTSTRAP_CARRIER_LOCK_BUSY", exitCodes.INTEGRATION_CONFLICT, "The selected carrier adoption is already being processed.");
      if (code !== 0) return refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The per-adoption lock primitive is unavailable.");
      if (created) {
        retained = true;
        return Object.freeze({ handle, path, dev: opened.dev, ino: opened.ino });
      }
      const current = await lstat(path).catch(() => null);
      if (current === null || current.dev !== opened.dev || current.ino !== opened.ino) return refuse("BOOTSTRAP_CARRIER_LOCK_BUSY", exitCodes.INTEGRATION_CONFLICT, "The stale per-adoption lock was replaced concurrently.");
      await unlink(path);
      await fsyncDirectory(dirname(path));
    } finally {
      if (!retained) await handle.close().catch(() => undefined);
    }
  }
  return refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The stale per-adoption lock could not be replaced safely.");
}

async function releaseAdoptionLock(lock: AdoptionLock): Promise<void> {
  try {
    const current = await lstat(lock.path).catch(() => refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The per-adoption lock vanished before release."));
    if (current.isSymbolicLink() || current.dev !== lock.dev || current.ino !== lock.ino) refuse("BOOTSTRAP_CARRIER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The per-adoption lock changed before release.");
    await unlink(lock.path);
    await fsyncDirectory(dirname(lock.path));
  } finally { await lock.handle.close(); }
}

function authenticateCarrierObjects(root: string, authority: CarrierAuthority): { readonly parent: GitTreeInventory; readonly carrier: GitTreeInventory } {
  const headers = commitHeaders(root, authority.commit);
  if (headers.tree !== authority.tree || headers.parents.length !== 1 || headers.parents[0] !== authority.parentCommit) {
    return refuse("BOOTSTRAP_CARRIER_GIT_IDENTITY_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The raw carrier commit does not have the exact declared tree and single parent.");
  }
  const parentHeaders = commitHeaders(root, authority.parentCommit);
  return Object.freeze({ parent: treeInventory(root, parentHeaders.tree), carrier: treeInventory(root, authority.tree) });
}

async function readTrackedReceipt(root: string, authority: CarrierAuthority, allowedLinks: readonly number[] = [1]): Promise<{ readonly file: AuthenticatedFile; readonly receipt: BootstrapCarrierReceipt } | null> {
  const file = await authenticatedFile(root, authority.trackedReceiptPath, { privateFile: false, allowedLinks, maximumBytes: maximumReceiptBytes });
  return file === null ? null : Object.freeze({ file, receipt: parseBootstrapReceiptBytes(root, file.bytes) });
}

async function clearPreparationReceipt(root: string, authority: CarrierAuthority): Promise<void> {
  ensurePrivateDirectory(root, ".usf/receipts");
  ensurePrivateDirectory(root, ".usf/receipts/bootstrap-carrier");
  const prepared = await authenticatedFile(root, authority.localPreparationReceiptPath, { privateFile: true, allowedLinks: [1, 2], maximumBytes: maximumReceiptBytes });
  if (prepared === null) return;
  if (prepared.nlink === 2) {
    const target = await readTrackedReceipt(root, authority, [2]);
    if (target === null || target.file.dev !== prepared.dev || target.file.ino !== prepared.ino || !target.file.bytes.equals(prepared.bytes)) {
      return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A linked interrupted preparation does not match its exact tracked target.");
    }
  }
  await unlinkAuthenticated(root, authority.localPreparationReceiptPath, prepared, true);
}

async function stageReceipt(root: string, authority: CarrierAuthority, receipt: BootstrapCarrierReceipt): Promise<{ readonly file: AuthenticatedFile; readonly bytes: Buffer }> {
  const bytes = Buffer.from(`${canonicalJson(receipt, { rejectAbsolutePaths: true })}\n`, "utf8");
  if (bytes.byteLength > maximumReceiptBytes) return refuse("BOOTSTRAP_CARRIER_RECEIPT_INVALID", exitCodes.CURRENTNESS_FAILURE, "The carrier receipt exceeds its byte bound.");
  const absolute = resolve(root, authority.localPreparationReceiptPath);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(absolute, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      .catch(() => refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "The transient carrier receipt could not be created exclusively."));
    await handle.writeFile(bytes);
    await handle.sync();
    const written = await handle.stat();
    if (!written.isFile() || written.uid !== processUid(written.uid) || written.nlink !== 1 || (written.mode & 0o777) !== 0o600 || written.size !== bytes.byteLength) {
      return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "The transient carrier receipt file is unsafe.");
    }
    await handle.close();
    handle = null;
    await fsyncDirectory(dirname(absolute));
    const readback = await authenticatedFile(root, authority.localPreparationReceiptPath, { privateFile: true, allowedLinks: [1], maximumBytes: maximumReceiptBytes });
    if (readback === null || !readback.bytes.equals(bytes) || parseBootstrapReceiptBytes(root, readback.bytes).receiptDigest !== receipt.receiptDigest) {
      return refuse("BOOTSTRAP_CARRIER_RECEIPT_READBACK_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The transient carrier receipt failed exact readback.");
    }
    return Object.freeze({ file: readback, bytes });
  } finally { if (handle !== null) await handle.close().catch(() => undefined); }
}

async function ensureTrackedReceiptDirectory(root: string, authority: CarrierAuthority): Promise<string> {
  const directoryPath = dirname(authority.trackedReceiptPath);
  const parentPath = dirname(directoryPath);
  authenticateDirectoryChain(root, parentPath, false);
  const directory = resolve(root, directoryPath);
  if (!existsSync(directory)) {
    try { await mkdir(directory, { mode: 0o755 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "The tracked carrier receipt directory could not be created."); }
    await fsyncDirectory(dirname(directory));
  }
  authenticateDirectoryChain(root, directoryPath, false);
  return directory;
}

async function publishStagedReceipt(
  root: string,
  authority: CarrierAuthority,
  staged: { readonly file: AuthenticatedFile; readonly bytes: Buffer },
): Promise<"created" | "matching"> {
  const directory = await ensureTrackedReceiptDirectory(root, authority);
  const target = resolve(root, authority.trackedReceiptPath);
  let linked = false;
  try {
    try { await link(resolve(root, authority.localPreparationReceiptPath), target); linked = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse("BOOTSTRAP_CARRIER_PATH_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "The tracked carrier receipt could not be placed with no replacement.");
      const raced = await readTrackedReceipt(root, authority);
      if (raced === null || !raced.file.bytes.equals(staged.bytes)) return refuse("BOOTSTRAP_CARRIER_RECEIPT_CONFLICT", exitCodes.INTEGRATION_CONFLICT, "A different tracked carrier receipt appeared concurrently.");
      await unlinkAuthenticated(root, authority.localPreparationReceiptPath, staged.file, true);
      return "matching";
    }
    await fsyncDirectory(directory);
    const linkedPreparation = await authenticatedFile(root, authority.localPreparationReceiptPath, { privateFile: true, allowedLinks: [2], maximumBytes: maximumReceiptBytes });
    const linkedTarget = await readTrackedReceipt(root, authority, [2]);
    if (linkedPreparation === null || linkedTarget === null || !linkedPreparation.bytes.equals(staged.bytes) || !linkedTarget.file.bytes.equals(staged.bytes)
      || linkedPreparation.dev !== linkedTarget.file.dev || linkedPreparation.ino !== linkedTarget.file.ino) {
      return refuse("BOOTSTRAP_CARRIER_RECEIPT_READBACK_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The no-replace tracked receipt link failed exact readback.");
    }
    await unlinkAuthenticated(root, authority.localPreparationReceiptPath, linkedPreparation, true);
    const final = await readTrackedReceipt(root, authority);
    if (final === null || !final.file.bytes.equals(staged.bytes)) return refuse("BOOTSTRAP_CARRIER_RECEIPT_READBACK_MISMATCH", exitCodes.CURRENTNESS_FAILURE, "The tracked carrier receipt failed final readback.");
    return "created";
  } catch (error) {
    if (linked) {
      const named = await lstat(target).catch(() => null);
      if (named !== null && !named.isSymbolicLink() && named.dev === staged.file.dev && named.ino === staged.file.ino) {
        await unlink(target).catch(() => undefined);
        await fsyncDirectory(directory).catch(() => undefined);
      }
    }
    throw error;
  }
}

function authorityCurrentnessProjection(authority: CarrierAuthority): Record<string, unknown> {
  return {
    adoptionIri: authority.adoptionIri,
    profileIri: authority.profileIri,
    profileVersion: authority.profileVersion,
    currentnessAuthorityIri: authority.currentnessAuthorityIri,
    lineageIri: authority.lineageIri,
    lineageMode: authority.lineageMode,
    parentCommit: authority.parentCommit,
    commit: authority.commit,
    tree: authority.tree,
    coverageMode: authority.coverageMode,
    carrierTotalPathEffectCount: authority.carrierTotalPathEffectCount,
    selectedPathEffectCount: authority.selectedPathEffectCount,
    declaredPathEffects: authority.declaredPathEffects,
    localPreparationReceiptPath: authority.localPreparationReceiptPath,
    trackedReceiptPath: authority.trackedReceiptPath,
    validationIris: authority.validationIris,
    adoptedSubjects: authority.adoptedSubjects,
    nonClaims: authority.nonClaims,
    admissionReceiptIri: authority.admissionReceiptIri ?? null,
    authorityManifestDigest: authority.authorityManifestDigest,
    scopedAuthorityDependencyDigest: authority.scopedAuthorityDependencyDigest,
  };
}

function bootstrapResult(
  request: BootstrapCarrierRequest,
  authority: CarrierAuthority,
  receipt: BootstrapCarrierReceipt,
  trackedReceiptState: BootstrapCarrierResult["trackedReceiptState"],
  liveBasis: { readonly commit: string; readonly tree: GitTreeInventory },
  livePathEffects: readonly BootstrapCarrierPathEffect[],
): BootstrapCarrierResult {
  const authorityEffect = trackedReceiptState === "created" ? "historical-carrier-observation-created"
    : trackedReceiptState === "matching" ? "existing-historical-carrier-observation-authenticated" : "verified-without-publication";
  return Object.freeze({
    schema: "urn:usf:bootstrap-carrier-result:1",
    status: "ok",
    operation: "bootstrap-carrier",
    mode: request.mode,
    carrierAdoptionIri: authority.adoptionIri,
    authorityProfileIri: authority.profileIri,
    authorityManifestPath: integrationManifestPath,
    localPreparationReceiptPath: authority.localPreparationReceiptPath,
    trackedReceiptPath: authority.trackedReceiptPath,
    trackedReceiptState,
    receiptDigest: receipt.receiptDigest,
    historicalObservedCurrentnessDisposition: receipt.observedCurrentnessDisposition,
    liveCurrentnessBasisCommit: liveBasis.commit,
    liveCurrentnessBasisTree: liveBasis.tree.treeId,
    liveCurrentnessDisposition: aggregateCurrentness(livePathEffects),
    authorityEffect,
    nonClaims: authority.nonClaims,
    completionState: "not-observed",
    evidenceState: "not-admitted",
    proofState: "not-evaluated",
    ordinaryPermissionState: "unchanged",
    runtimeState: "unchanged",
  });
}

export async function bootstrapCarrier(root: string, request: BootstrapCarrierRequest): Promise<BootstrapCarrierResult> {
  const canonicalRoot = await realpath(resolve(root)).catch(() => refuse("BOOTSTRAP_CARRIER_GIT_ROOT_INVALID", exitCodes.CONTAINMENT_REFUSAL, "The repository root is unreadable."));
  assertScrubbedRepository(canonicalRoot);
  const authority = extractAuthority(canonicalRoot, request);
  const carrierBasis = authenticateCarrierObjects(canonicalRoot, authority);
  const adoptionLock = await acquireAdoptionLock(canonicalRoot, authority.adoptionIri);
  const scratchIdentityPath = `.usf/tmp/bootstrap-carrier/${canonicalDigest(authority.adoptionIri).slice(7)}`;
  try {
    await clearPreparationReceipt(canonicalRoot, authority);
    const existing = await readTrackedReceipt(canonicalRoot, authority);
    if (existing !== null) {
      const receipt = authenticateHistoricalReceipt(canonicalRoot, authority, carrierBasis.parent, carrierBasis.carrier, existing.receipt);
      const liveBasis = cleanHeadBasis(canonicalRoot, authority.declaredPathEffects.map((effect) => effect.repositoryPath));
      assertReachable(canonicalRoot, liveBasis.commit, authority.commit);
      const livePathEffects = derivePathEffects(authority, carrierBasis.parent, carrierBasis.carrier, liveBasis.tree);
      return bootstrapResult(request, authority, receipt, "matching", liveBasis, livePathEffects);
    }

    const observedBasis = cleanHeadBasis(canonicalRoot, authority.declaredPathEffects.map((effect) => effect.repositoryPath));
    assertReachable(canonicalRoot, observedBasis.commit, authority.commit);
    const pathEffects = derivePathEffects(authority, carrierBasis.parent, carrierBasis.carrier, observedBasis.tree);
    const admission = deriveAdmissionReceiptBinding(authority, carrierBasis.carrier);
    const validationResults = await runHistoricalValidations(canonicalRoot, authority, carrierBasis.carrier);
    const receipt = buildReceipt(authority, pathEffects, observedBasis, validationResults, admission);
    validateBootstrapReceiptSchema(canonicalRoot, receipt);
    authenticateHistoricalReceipt(canonicalRoot, authority, carrierBasis.parent, carrierBasis.carrier, receipt);
    const staged = await stageReceipt(canonicalRoot, authority, receipt);
    if (request.mode === "verify") {
      await unlinkAuthenticated(canonicalRoot, authority.localPreparationReceiptPath, staged.file, true);
      const liveBasis = cleanHeadBasis(canonicalRoot, authority.declaredPathEffects.map((effect) => effect.repositoryPath));
      assertReachable(canonicalRoot, liveBasis.commit, authority.commit);
      const liveEffects = derivePathEffects(authority, carrierBasis.parent, carrierBasis.carrier, liveBasis.tree);
      return bootstrapResult(request, authority, receipt, "absent", liveBasis, liveEffects);
    }

    ensurePrivateDirectory(canonicalRoot, ".usf/locks");
    let primary: Awaited<ReturnType<typeof acquirePrimaryMutationLock>>;
    try { primary = await acquirePrimaryMutationLock(canonicalRoot); }
    catch (error) {
      if (error instanceof IntegrationError && error.reasonCode === "INTEGRATION_LOCK_BUSY") return refuse("BOOTSTRAP_CARRIER_PRIMARY_LOCK_BUSY", exitCodes.INTEGRATION_CONFLICT, "The primary mutation boundary is busy.");
      return refuse("BOOTSTRAP_CARRIER_PRIMARY_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "The primary mutation boundary is unavailable.");
    }
    let trackedReceiptState: "created" | "matching";
    let liveBasis: { readonly commit: string; readonly tree: GitTreeInventory };
    let liveEffects: readonly BootstrapCarrierPathEffect[];
    try {
      const currentAuthority = extractAuthority(canonicalRoot, request);
      if (canonicalJson(authorityCurrentnessProjection(currentAuthority)) !== canonicalJson(authorityCurrentnessProjection(authority))) {
        return refuse("BOOTSTRAP_CARRIER_AUTHORITY_MOVED", exitCodes.CURRENTNESS_FAILURE, "The scoped carrier authority moved before publication.");
      }
      const prior = await readTrackedReceipt(canonicalRoot, authority);
      if (prior !== null) {
        if (!prior.file.bytes.equals(staged.bytes)) return refuse("BOOTSTRAP_CARRIER_RECEIPT_CONFLICT", exitCodes.INTEGRATION_CONFLICT, "A different valid receipt appeared before publication.");
        await unlinkAuthenticated(canonicalRoot, authority.localPreparationReceiptPath, staged.file, true);
        trackedReceiptState = "matching";
      } else {
        liveBasis = cleanHeadBasis(canonicalRoot, authority.declaredPathEffects.map((effect) => effect.repositoryPath));
        liveEffects = derivePathEffects(authority, carrierBasis.parent, carrierBasis.carrier, liveBasis.tree);
        if (canonicalJson(currentPostimageProjection(liveEffects)) !== canonicalJson(currentPostimageProjection(pathEffects))) {
          return refuse("BOOTSTRAP_CARRIER_CURRENTNESS_MOVED", exitCodes.CURRENTNESS_FAILURE, "A selected current postimage moved before publication.");
        }
        trackedReceiptState = await publishStagedReceipt(canonicalRoot, authority, staged);
      }
      liveBasis ??= cleanHeadBasis(canonicalRoot, authority.declaredPathEffects.map((effect) => effect.repositoryPath));
      liveEffects ??= derivePathEffects(authority, carrierBasis.parent, carrierBasis.carrier, liveBasis.tree);
    } finally {
      await primary.handle.close();
    }
    return bootstrapResult(request, authority, receipt, trackedReceiptState, liveBasis, liveEffects);
  } finally {
    const remainingPreparation = await authenticatedFile(canonicalRoot, authority.localPreparationReceiptPath, { privateFile: true, allowedLinks: [1], maximumBytes: maximumReceiptBytes }).catch(() => null);
    if (remainingPreparation !== null) await unlinkAuthenticated(canonicalRoot, authority.localPreparationReceiptPath, remainingPreparation, true);
    rmSync(resolve(canonicalRoot, scratchIdentityPath), { recursive: true, force: true });
    await releaseAdoptionLock(adoptionLock);
  }
}
