import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { candidateWorkspace, currentCandidateWorkspace, RealisationError, stableReason, withCandidateLock } from "../realisation/index.ts";
import type { RealisationBasis } from "../realisation/basis.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes } from "../core/errors.ts";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { loadSemanticGraph, objectsFor, resourceDigest, validationRuntimeClosure, type LoadedSemanticGraph } from "../graph/index.ts";
import { isOperation, type FileOperation } from "../providers/types.ts";

export interface FocusedCheck { readonly id: string; readonly command: readonly string[]; }
export type FocusedCheckResult =
  | { readonly status: "pass"; readonly basis: RealisationBasis; readonly id: string; readonly exitCode: number }
  | { readonly status: "refused"; readonly basis?: RealisationBasis; readonly reasonCode: string; readonly id: string; readonly exitCode?: number };

export type PreparedFocusedCheck =
  | FocusedCheckResult
  | { readonly status: "ready"; readonly basis: RealisationBasis; readonly id: string; readonly workspace: string; readonly executable: "/usr/bin/bwrap"; readonly arguments: readonly string[] };

export interface ConfinedNodeTestLaunch {
  readonly executable: "/usr/bin/bwrap";
  readonly arguments: readonly string[];
}

export interface CheckedCandidateReceipt {
  readonly schema: "urn:usf:checked-candidate-receipt:1";
  readonly workIri: string;
  readonly explicitProfileIri: string;
  readonly originalConstructionBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly candidateDigest: string;
  readonly workspaceIdentityDigest: string;
  readonly lineageDigest: string;
  readonly byteDeltaDigest: string;
  readonly fileModeDigest: string;
  readonly candidateTreeDigest: string;
  readonly writeSetDigest: string;
  readonly validationObligationIri: string;
  readonly validationResourceDigest: string;
  readonly validationCommandTokens: readonly string[];
  readonly validationCommandDigest: string;
  readonly validationEnvironmentIri: string;
  readonly validationEnvironmentDigest: string;
  readonly validationExecutionModeIri: string;
  readonly validationExecutionModeDigest: string;
  readonly validationToolDependencies: readonly Readonly<{ kind: "basis-input" | "host-tool"; id: string; digest: string }>[];
  readonly validationToolDependencyDigest: string;
  readonly validationSchemaDependencies: readonly Readonly<{ id: string; digest: string }>[];
  readonly validationSchemaDependencyDigest: string;
  readonly validationAuthorityDependencies: readonly Readonly<{ path: string; digest: string }>[];
  readonly validationAuthorityDependencyDigest: string;
  readonly checkedCandidateSchemaDigest: string;
  readonly validationExecutionAuthorityResourceDigest: string;
  readonly validationWallTimeMilliseconds: number;
  readonly validationTerminationGraceMilliseconds: number;
  readonly validationTimedOut: false;
  readonly validationTimeoutTerminationSignal: "none";
  readonly exitCode: 0;
  readonly outputResultDigest: string;
  readonly validationResultSetDigest: string;
  readonly receiptDigest: string;
}

export type GraphDerivedCheckResult =
  | { readonly status: "pass"; readonly basis: RealisationBasis; readonly id: string; readonly exitCode: 0; readonly receiptPath: string; readonly receipt: CheckedCandidateReceipt }
  | { readonly status: "refused"; readonly basis?: RealisationBasis; readonly reasonCode: string; readonly id: string; readonly exitCode?: number;
    readonly validationExecutionAuthorityResourceDigest?: string; readonly validationWallTimeMilliseconds?: number;
    readonly validationTerminationGraceMilliseconds?: number; readonly validationTimedOut?: true;
    readonly validationTimeoutTerminationSignal?: "none" | "SIGTERM" | "SIGKILL"; readonly outputResultDigest?: string };

const bubblewrapExecutable = "/usr/bin/bwrap" as const;
const checkedCandidateSchemaIri = "urn:usf:schema:checked-candidate-receipt:1";
const checkedCandidateSchemaIdentity = "urn:usf:checked-candidate-receipt:1" as const;
const validationExecutionAuthorityIri = "urn:usf:algorithm:work-integration-transition:2";
const integrationManifestPath = "graph/manifests/integration.json";
const checkReceiptRoot = ".usf/receipts/check";
const workspaceManifestName = ".usf-workspace.json";
const maximumWorkspaceManifestBytes = 512 * 1024;
const maximumCandidateTreeEntries = 8_192;
const maximumCandidateTreeBytes = 64 * 1024 * 1024;
const maximumCheckOutputBytes = 256 * 1024;
const maximumReceiptBytes = 128 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

class CheckRefusal extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "CheckRefusal";
    this.reasonCode = reasonCode;
  }
}

function refuse(reasonCode: string): never { throw new CheckRefusal(reasonCode); }

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function exactGraphValue(graph: LoadedSemanticGraph, subject: string, predicate: string, kind: "iri" | "literal", reason: string): string {
  const values = objectsFor(graph, subject, predicate);
  if (values.length !== 1 || values[0]?.objectKind !== kind) return refuse(reason);
  return values[0].object;
}

function exactGraphType(graph: LoadedSemanticGraph, subject: string, type: string, reason: string): void {
  const values = objectsFor(graph, subject, "urn:usf:predicate:type");
  if (values.length !== 1 || values[0]?.objectKind !== "iri" || values[0].object !== type) refuse(reason);
}

interface ValidationExecutionAuthority {
  readonly schemaDigest: string;
  readonly resourceDigest: string;
  readonly wallTimeMilliseconds: number;
  readonly terminationSignal: "SIGTERM";
  readonly terminationGraceMilliseconds: number;
  readonly forcedTerminationSignal: "SIGKILL";
  readonly maximumSettlementWallTimeMilliseconds: number;
  readonly timeoutReasonCode: "CHECK_TIMEOUT";
}

function exactGraphPositiveInteger(graph: LoadedSemanticGraph, subject: string, predicate: string): number {
  const value = exactGraphValue(graph, subject, predicate, "literal", "CHECK_RECEIPT_AUTHORITY_INVALID");
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) refuse("CHECK_RECEIPT_AUTHORITY_INVALID");
  const integer = Number(value);
  if (!Number.isSafeInteger(integer)) refuse("CHECK_RECEIPT_AUTHORITY_INVALID");
  return integer;
}

function checkedReceiptExecutionAuthority(root: string): ValidationExecutionAuthority {
  let graph: LoadedSemanticGraph;
  try { graph = loadSemanticGraph(root, integrationManifestPath); } catch { return refuse("CHECK_RECEIPT_AUTHORITY_INVALID"); }
  exactGraphType(graph, checkedCandidateSchemaIri, "urn:usf:type:SemanticRecordSchema", "CHECK_RECEIPT_AUTHORITY_INVALID");
  if (exactGraphValue(graph, checkedCandidateSchemaIri, "urn:usf:predicate:version", "literal", "CHECK_RECEIPT_AUTHORITY_INVALID") !== "1"
    || exactGraphValue(graph, checkedCandidateSchemaIri, "urn:usf:predicate:schemaIdentity", "iri", "CHECK_RECEIPT_AUTHORITY_INVALID") !== checkedCandidateSchemaIdentity
    || exactGraphValue(graph, checkedCandidateSchemaIri, "urn:usf:predicate:recordType", "iri", "CHECK_RECEIPT_AUTHORITY_INVALID") !== "urn:usf:type:CheckedCandidateReceipt"
    || exactGraphValue(graph, checkedCandidateSchemaIri, "urn:usf:predicate:validationExecutionAuthority", "iri", "CHECK_RECEIPT_AUTHORITY_INVALID") !== validationExecutionAuthorityIri) {
    refuse("CHECK_RECEIPT_AUTHORITY_INVALID");
  }
  const required = objectsFor(graph, checkedCandidateSchemaIri, "urn:usf:predicate:requiredField");
  const expected = [
    "workIri", "explicitProfileIri", "originalConstructionBasisDigest", "scopedDependencyDigest", "candidateDigest",
    "lineageDigest", "byteDeltaDigest", "fileModeDigest", "candidateTreeDigest", "writeSetDigest",
    "validationObligationIri", "validationCommandDigest", "validationEnvironmentDigest", "validationExecutionModeDigest",
    "validationToolDependencyDigest", "validationSchemaDependencyDigest", "validationExecutionAuthorityResourceDigest",
    "validationWallTimeMilliseconds", "validationTerminationGraceMilliseconds", "validationTimedOut",
    "validationTimeoutTerminationSignal", "outputResultDigest", "validationResultSetDigest",
  ].sort();
  const actual = required.map((quad) => quad.objectKind === "literal" ? quad.object : "").sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) refuse("CHECK_RECEIPT_AUTHORITY_INVALID");
  if (exactGraphValue(graph, "urn:usf:receipt-boundary:core-completion:1", "urn:usf:predicate:ignoredCheckReceiptRoot", "literal", "CHECK_RECEIPT_AUTHORITY_INVALID") !== `${checkReceiptRoot}/`) {
    refuse("CHECK_RECEIPT_AUTHORITY_INVALID");
  }
  const wallTimeMilliseconds = exactGraphPositiveInteger(graph, validationExecutionAuthorityIri, "urn:usf:predicate:candidateValidationWallTimeMilliseconds");
  const terminationGraceMilliseconds = exactGraphPositiveInteger(graph, validationExecutionAuthorityIri, "urn:usf:predicate:validationTerminationGraceMilliseconds");
  const maximumSettlementWallTimeMilliseconds = exactGraphPositiveInteger(graph, validationExecutionAuthorityIri, "urn:usf:predicate:validationMaximumSettlementWallTimeMilliseconds");
  const terminationSignal = exactGraphValue(graph, validationExecutionAuthorityIri, "urn:usf:predicate:validationTerminationSignal", "literal", "CHECK_RECEIPT_AUTHORITY_INVALID");
  const forcedTerminationSignal = exactGraphValue(graph, validationExecutionAuthorityIri, "urn:usf:predicate:validationForcedTerminationSignal", "literal", "CHECK_RECEIPT_AUTHORITY_INVALID");
  const timeoutReasonCode = exactGraphValue(graph, validationExecutionAuthorityIri, "urn:usf:predicate:candidateValidationTimeoutReasonCode", "literal", "CHECK_RECEIPT_AUTHORITY_INVALID");
  if (terminationSignal !== "SIGTERM" || forcedTerminationSignal !== "SIGKILL" || timeoutReasonCode !== "CHECK_TIMEOUT"
    || maximumSettlementWallTimeMilliseconds !== wallTimeMilliseconds + terminationGraceMilliseconds) {
    refuse("CHECK_RECEIPT_AUTHORITY_INVALID");
  }
  return Object.freeze({
    schemaDigest: resourceDigest(graph, checkedCandidateSchemaIri),
    resourceDigest: resourceDigest(graph, validationExecutionAuthorityIri),
    wallTimeMilliseconds,
    terminationSignal,
    terminationGraceMilliseconds,
    forcedTerminationSignal,
    maximumSettlementWallTimeMilliseconds,
    timeoutReasonCode,
  });
}

function permissionAffectingNodeArgument(argument: string): boolean {
  if (!argument.startsWith("--") || !process.allowedNodeEnvironmentFlags.has(argument)) return false;
  const normalized = argument.split("=", 1)[0]!.replaceAll("_", "-");
  return normalized === "--permission" || normalized === "--no-permission"
    || normalized.startsWith("--allow-") || normalized.startsWith("--no-allow-");
}

function strictNodeTestPaths(command: readonly string[]): readonly string[] | null {
  if (command.length < 4 || command.length > 12 || command.some((argument) => argument.length === 0)
    || command[0] !== "node" || command[1] !== "--test" || command[2] !== "--test-isolation=none"
    || command.some(permissionAffectingNodeArgument)) return null;
  const optionalNamePattern = command[3]?.startsWith("--test-name-pattern=") === true ? command[3] : undefined;
  if (optionalNamePattern !== undefined && !/^--test-name-pattern=[A-Za-z0-9._-]+$/u.test(optionalNamePattern)) return null;
  const tests = command.slice(optionalNamePattern === undefined ? 3 : 4);
  if (tests.length < 1 || tests.length > 8 || new Set(tests).size !== tests.length
    || tests.some((path) => !path.endsWith(".test.ts") || path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/u.test(segment)))) return null;
  return tests;
}

function trustedBubblewrap(): boolean {
  try {
    const entry = lstatSync(bubblewrapExecutable);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.uid !== 0 || (entry.mode & 0o6022) !== 0
      || realpathSync(bubblewrapExecutable) !== bubblewrapExecutable) return false;
    const version = spawnSync(bubblewrapExecutable, ["--version"], { encoding: "utf8", env: {} });
    return version.error === undefined && version.status === 0 && version.signal === null && version.stdout.trim() === "bubblewrap 0.9.0";
  } catch {
    return false;
  }
}

export function confinedNodeTestLaunch(
  workspace: string,
  scratch: string,
  dependencyRoots: readonly string[],
  command: readonly string[],
): ConfinedNodeTestLaunch | null {
  const tests = strictNodeTestPaths(command);
  if (tests === null || !trustedBubblewrap()) return null;
  // The permission model is our safety proof: no network or child-process
  // allowance is granted, and read/write access is restricted to the copy.
  if (!process.allowedNodeEnvironmentFlags.has("--permission")) return null;
  const canonicalWorkspace = realpathSync(workspace);
  const authenticatedDependencyRoots = authenticatedConfiguredToolDependencyRoots(canonicalWorkspace, dependencyRoots);
  if (canonicalWorkspace !== workspace || !authenticatedOwnerDirectory(canonicalWorkspace, false) || authenticatedDependencyRoots === null) return null;
  for (const path of tests) {
    const target = resolve(canonicalWorkspace, path);
    const relation = relative(canonicalWorkspace, target);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) return null;
    try {
      const entry = lstatSync(target);
      if (entry.isSymbolicLink() || !entry.isFile()) return null;
      const realRelation = relative(canonicalWorkspace, realpathSync(target));
      if (realRelation === "" || realRelation === ".." || realRelation.startsWith(`..${sep}`) || isAbsolute(realRelation)) return null;
    } catch {
      return null;
    }
  }
  const scratchRelation = relative(canonicalWorkspace, resolve(scratch));
  if (scratchRelation === "" || scratchRelation === ".." || scratchRelation.startsWith(`..${sep}`) || isAbsolute(scratchRelation)) return null;
  const nodeArguments = [
    "--permission",
    `--allow-fs-read=${canonicalWorkspace}`,
    ...authenticatedDependencyRoots.map((root) => `--allow-fs-read=${root}`),
    "--allow-fs-read=/etc/passwd",
    "--allow-fs-read=/proc/net/route",
    `--allow-fs-write=${resolve(scratch)}`,
    ...command.slice(1),
  ];
  const environment = [
    ["HOME", resolve(canonicalWorkspace, ".usf-empty-home")],
    ["LANG", "C.UTF-8"],
    ["LC_ALL", "C.UTF-8"],
    ["NODE_PATH", authenticatedDependencyRoots[0]],
    ["PATH", ""],
    ["TMPDIR", resolve(scratch)],
    ["USF_BWRAP_NETWORK", "isolated"],
    ["USF_PROVIDER_HOME", resolve(canonicalWorkspace, ".usf/provider-home")],
    ["USF_REPOSITORY_ROOT", canonicalWorkspace],
  ] as const;
  return Object.freeze({
    executable: bubblewrapExecutable,
    arguments: Object.freeze([
      "--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent",
      "--tmpfs", "/",
      ...["/usr", "/lib", "/lib64", canonicalWorkspace, ...authenticatedDependencyRoots]
        .flatMap((path) => ["--ro-bind", path, path]),
      "--proc", "/proc", "--dev", "/dev",
      "--bind", resolve(scratch), resolve(scratch),
      "--chdir", canonicalWorkspace, "--clearenv",
      ...environment.flatMap(([name, value]) => ["--setenv", name, value]),
      "--", process.execPath, ...nodeArguments,
    ]),
  });
}

function authenticatedOwnerDirectory(path: string, privateDirectory: boolean): boolean {
  try {
    const entry = lstatSync(path);
    const uid = typeof process.getuid === "function" ? process.getuid() : entry.uid;
    const gid = typeof process.getgid === "function" ? process.getgid() : entry.gid;
    return !entry.isSymbolicLink() && entry.isDirectory() && entry.uid === uid && entry.gid === gid && entry.nlink >= 2
      && (entry.mode & 0o7000) === 0 && (entry.mode & 0o700) === 0o700 && (entry.mode & 0o002) === 0
      && (!privateDirectory || (entry.mode & 0o777) === 0o700)
      && realpathSync(path) === path;
  } catch {
    return false;
  }
}

function authorityRepositoryContainsWorkspace(toolRoot: string, workspace: string): boolean {
  const relation = relative(toolRoot, workspace);
  const parts = relation.split(sep);
  if (relation === "" || isAbsolute(relation) || parts[0] !== ".usf" || parts.length < 2 || parts.some((part) => part.length === 0 || part === "." || part === "..")
    || !authenticatedOwnerDirectory(resolve(toolRoot, ".git"), false)) return false;
  let cursor = toolRoot;
  for (const part of parts) {
    cursor = resolve(cursor, part);
    if (!authenticatedOwnerDirectory(cursor, false)) return false;
  }
  return cursor === workspace;
}

function authenticatedConfiguredToolDependencyRoots(workspace?: string, supplied?: readonly string[]): readonly [string, string] | null {
  const moduleToolRoot = resolve(import.meta.dirname, "../..");
  const toolRoot = supplied === undefined ? moduleToolRoot : dirname(supplied[0] ?? "");
  const expected = [resolve(toolRoot, "node_modules"), resolve(toolRoot, ".usf/cache")] as const;
  const allowedRoot = toolRoot === moduleToolRoot || (workspace !== undefined && authorityRepositoryContainsWorkspace(toolRoot, workspace));
  if (!allowedRoot || !authenticatedOwnerDirectory(toolRoot, false)
    || !authenticatedOwnerDirectory(expected[0], false) || !authenticatedOwnerDirectory(expected[1], true)
    || (supplied !== undefined && (supplied.length !== expected.length || supplied.some((path, index) => path !== expected[index])))) {
    return null;
  }
  return Object.freeze(expected);
}

async function toolDependencyRoots(): Promise<readonly string[]> {
  const roots = authenticatedConfiguredToolDependencyRoots();
  if (roots === null) throw new Error("TOOL_DEPENDENCY_ROOT_UNAVAILABLE");
  return roots;
}

interface AuthenticatedWorkspaceManifest {
  readonly schema: "urn:usf:workspace-manifest:1";
  readonly digest: string;
  readonly basis: RealisationBasis;
  readonly operations: readonly FileOperation[];
  readonly lineage: Readonly<{ readonly acceptedContributionDigests: readonly string[]; readonly rejected: readonly unknown[] }>;
  readonly scope: readonly string[];
  readonly writeSet: readonly string[];
  readonly preimages: Readonly<Record<string, string | null>>;
}

interface CandidateTreeEntry { readonly path: string; readonly digest: string; readonly mode: "100644" | "100755"; }

interface GraphValidation {
  readonly commandTokens: readonly string[];
  readonly resourceDigest: string;
  readonly environmentIri: string;
  readonly environmentDigest: string;
  readonly executionModeIri: string;
  readonly executionModeDigest: string;
  readonly toolDependencies: readonly Readonly<{ kind: "basis-input" | "host-tool"; id: string; digest: string }>[];
  readonly schemaDependencies: readonly Readonly<{ id: string; digest: string }>[];
  readonly repositoryReadFiles: readonly string[];
}

async function authenticatedWorkspaceManifest(workspace: string, candidateDigest: string, basis: RealisationBasis): Promise<AuthenticatedWorkspaceManifest> {
  const path = resolve(workspace, workspaceManifestName);
  let value: unknown;
  try {
    const { bytes } = await authenticatedContentFile(path, maximumWorkspaceManifestBytes, "INVALID_WORKSPACE_MANIFEST");
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof CheckRefusal) throw error;
    return refuse("INVALID_WORKSPACE_MANIFEST");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["schema", "digest", "basis", "operations", "lineage", "scope", "writeSet", "preimages"])) {
    refuse("INVALID_WORKSPACE_MANIFEST");
  }
  const manifest = value as AuthenticatedWorkspaceManifest;
  if (manifest.schema !== "urn:usf:workspace-manifest:1" || manifest.digest !== candidateDigest
    || manifest.basis.basisDigest !== basis.basisDigest || !Array.isArray(manifest.operations) || !manifest.operations.every(isOperation)
    || !manifest.lineage || typeof manifest.lineage !== "object" || Array.isArray(manifest.lineage)
    || !exactKeys(manifest.lineage, ["acceptedContributionDigests", "rejected"])
    || !Array.isArray(manifest.scope) || !Array.isArray(manifest.writeSet)
    || !manifest.preimages || typeof manifest.preimages !== "object" || Array.isArray(manifest.preimages)) {
    refuse("INVALID_WORKSPACE_MANIFEST");
  }
  return manifest;
}

function repositoryMode(mode: number): "100644" | "100755" { return (mode & 0o111) === 0 ? "100644" : "100755"; }

async function candidateTree(workspace: string): Promise<readonly CandidateTreeEntry[]> {
  const entries: CandidateTreeEntry[] = [];
  let totalBytes = 0;
  const inventory = async (repositoryPath = ""): Promise<void> => {
    const target = repositoryPath === "" ? workspace : resolve(workspace, repositoryPath);
    const entry = await lstat(target);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) refuse("CANDIDATE_BASIS_MISMATCH");
    if (entry.isDirectory()) {
      if (repositoryPath === ".usf-check-tmp") return;
      const children = (await readdir(target)).sort((left, right) => left.localeCompare(right));
      for (const child of children) await inventory(repositoryPath === "" ? child : `${repositoryPath}/${child}`);
      return;
    }
    if (repositoryPath === workspaceManifestName) return;
    if (entries.length >= maximumCandidateTreeEntries) refuse("CHECK_CANDIDATE_TREE_LIMIT_EXCEEDED");
    const { bytes, entry: authenticatedEntry } = await authenticatedContentFile(target, maximumCandidateTreeBytes - totalBytes, "CHECK_CANDIDATE_TREE_LIMIT_EXCEEDED");
    totalBytes += bytes.byteLength;
    entries.push({ path: repositoryPath, digest: sha256(bytes), mode: repositoryMode(authenticatedEntry.mode) });
  };
  await inventory();
  return Object.freeze(entries);
}

async function repositoryFileMode(root: string, repositoryPath: string): Promise<"100644" | "100755" | null> {
  const target = resolve(root, repositoryPath);
  const relation = relative(root, target);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("CANDIDATE_BASIS_MISMATCH");
  try {
    const entry = await lstat(target);
    if (entry.isSymbolicLink() || !entry.isFile()) refuse("CANDIDATE_BASIS_MISMATCH");
    return repositoryMode(entry.mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sortedDigestRefs(refs: readonly Readonly<{ id: string; digest: string }>[], reason: string): Array<{ id: string; digest: string }> {
  if (refs.some((ref) => !ref || typeof ref.id !== "string" || ref.id.length === 0 || !digestPattern.test(ref.digest))) refuse(reason);
  const sorted = refs.map((ref) => ({ id: ref.id, digest: ref.digest })).sort((left, right) => left.id.localeCompare(right.id) || left.digest.localeCompare(right.digest));
  if (new Set(sorted.map((ref) => ref.id)).size !== sorted.length) refuse(reason);
  return sorted;
}

function graphRepositoryPath(value: string): string {
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(value) || value.includes("\\") || isAbsolute(value)
    || value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    || [".git", ".usf", ".env"].includes(value.split("/")[0] ?? "")) {
    refuse("CHECK_VALIDATION_AUTHORITY_INVALID");
  }
  return value;
}

function graphValidation(root: string, basis: RealisationBasis, validationId: string): GraphValidation {
  let graph: LoadedSemanticGraph;
  try { graph = loadSemanticGraph(root, basis.selection.manifestPath); } catch { return refuse("CHECK_VALIDATION_AUTHORITY_INVALID"); }
  const selectedManifest = graph.manifests.filter((manifest) => manifest.path === basis.selection.manifestPath);
  if (graph.manifestPath !== basis.selection.manifestPath || selectedManifest.length !== 1
    || resourceDigest(graph, basis.selection.profile) !== basis.selection.profileDigest
    || exactGraphValue(graph, basis.selection.profile, "urn:usf:predicate:version", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID") !== basis.selection.profileVersion) {
    refuse("CHECK_VALIDATION_AUTHORITY_INVALID");
  }
  const selected = basis.trace.validation.filter((validation) => validation.id === validationId);
  if (selected.length !== 1) refuse("CHECK_VALIDATION_NOT_BOUND");
  exactGraphType(graph, validationId, "urn:usf:type:TestObligation", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const validationResourceDigest = resourceDigest(graph, validationId);
  if (validationResourceDigest !== selected[0]?.digest) refuse("CHECK_VALIDATION_AUTHORITY_INVALID");
  const command = exactGraphValue(graph, validationId, "urn:usf:predicate:command", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const commandTokens = command.split(" ");
  if (commandTokens.join(" ") !== command || commandTokens.some((token) => token.length === 0)) refuse("CHECK_VALIDATION_COMMAND_UNSUPPORTED");
  const environmentIri = exactGraphValue(graph, validationId, "urn:usf:predicate:environment", "iri", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const executionModeIri = exactGraphValue(graph, validationId, "urn:usf:predicate:executionMode", "iri", "CHECK_VALIDATION_AUTHORITY_INVALID");
  if (exactGraphValue(graph, validationId, "urn:usf:predicate:applicability", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID") !== "required"
    || environmentIri !== "urn:usf:environment:hermetic"
    || executionModeIri !== "urn:usf:mode:deterministic-test-substitute") {
    refuse("CHECK_VALIDATION_MODE_UNSUPPORTED");
  }
  exactGraphType(graph, environmentIri, "urn:usf:type:Environment", "CHECK_VALIDATION_AUTHORITY_INVALID");
  exactGraphType(graph, executionModeIri, "urn:usf:type:ExecutionMode", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const hostToolQuads = objectsFor(graph, validationId, "urn:usf:predicate:hostToolDependency");
  if (hostToolQuads.length !== 1 || hostToolQuads[0]?.objectKind !== "iri") refuse("CHECK_VALIDATION_TOOL_UNSUPPORTED");
  const hostTool = hostToolQuads[0].object;
  exactGraphType(graph, hostTool, "urn:usf:type:HostToolDependency", "CHECK_VALIDATION_TOOL_UNSUPPORTED");
  if (hostTool !== "urn:usf:host-tool:bwrap:0.9.0"
    || exactGraphValue(graph, hostTool, "urn:usf:predicate:executablePath", "literal", "CHECK_VALIDATION_TOOL_UNSUPPORTED") !== bubblewrapExecutable
    || exactGraphValue(graph, hostTool, "urn:usf:predicate:version", "literal", "CHECK_VALIDATION_TOOL_UNSUPPORTED") !== "0.9.0") {
    refuse("CHECK_VALIDATION_TOOL_UNSUPPORTED");
  }
  const basisTools = sortedDigestRefs(basis.inputs.toolDigests, "CHECK_VALIDATION_TOOL_INVALID")
    .map((dependency) => ({ kind: "basis-input" as const, ...dependency }));
  const schemaDependencies = sortedDigestRefs(basis.inputs.schemaDigests, "CHECK_VALIDATION_SCHEMA_INVALID");
  const currentnessValues = objectsFor(graph, basis.authority.permission, "urn:usf:predicate:activationCurrentness");
  if (currentnessValues.length > 1 || currentnessValues.some((quad) => quad.objectKind !== "iri")) refuse("CHECK_VALIDATION_AUTHORITY_INVALID");
  let declaredReadFiles: string[];
  try { declaredReadFiles = validationRuntimeClosure(graph, validationId).repositoryReadFiles.map(graphRepositoryPath); }
  catch { return refuse("CHECK_VALIDATION_AUTHORITY_INVALID"); }
  const repositoryReadFiles = [...new Set([
    ...declaredReadFiles,
    ...(currentnessValues.length === 0 ? [] : [graphRepositoryPath(exactGraphValue(graph, currentnessValues[0]!.object, "urn:usf:predicate:receiptPath", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID"))]),
  ])].sort();
  return Object.freeze({
    commandTokens: Object.freeze(commandTokens),
    resourceDigest: validationResourceDigest,
    environmentIri,
    environmentDigest: resourceDigest(graph, environmentIri),
    executionModeIri,
    executionModeDigest: resourceDigest(graph, executionModeIri),
    toolDependencies: Object.freeze([...basisTools, { kind: "host-tool" as const, id: hostTool, digest: resourceDigest(graph, hostTool) }]),
    schemaDependencies: Object.freeze(schemaDependencies),
    repositoryReadFiles: Object.freeze(repositoryReadFiles),
  });
}

async function candidateReceiptFacts(root: string, workspace: string, candidateDigest: string, basis: RealisationBasis): Promise<{
  readonly workspaceIdentityDigest: string;
  readonly lineageDigest: string;
  readonly byteDeltaDigest: string;
  readonly fileModeDigest: string;
  readonly candidateTreeDigest: string;
  readonly writeSetDigest: string;
}> {
  const manifest = await authenticatedWorkspaceManifest(workspace, candidateDigest, basis);
  const tree = await candidateTree(workspace);
  const treeByPath = new Map(tree.map((entry) => [entry.path, entry]));
  const byteDeltas: Array<{ kind: "write" | "delete"; path: string; beforeDigest: string | null; afterDigest: string | null }> = [];
  const fileModes: Array<{ path: string; beforeMode: "100644" | "100755" | null; afterMode: "100644" | "100755" | null }> = [];
  for (const operation of manifest.operations) {
    const beforeDigest = manifest.preimages[operation.path];
    if (beforeDigest === undefined || (beforeDigest !== null && !digestPattern.test(beforeDigest))) refuse("CANDIDATE_BASIS_MISMATCH");
    const after = treeByPath.get(operation.path) ?? null;
    if ((operation.kind === "write" && after === null) || (operation.kind === "delete" && after !== null)) refuse("CANDIDATE_BASIS_MISMATCH");
    byteDeltas.push({ kind: operation.kind, path: operation.path, beforeDigest, afterDigest: after?.digest ?? null });
    fileModes.push({ path: operation.path, beforeMode: await repositoryFileMode(root, operation.path), afterMode: after?.mode ?? null });
  }
  const candidateTreeDigest = canonicalDigest(tree, { rejectAbsolutePaths: true });
  return Object.freeze({
    workspaceIdentityDigest: canonicalDigest({ candidateDigest, originalConstructionBasisDigest: basis.basisDigest, scope: manifest.scope, candidateTreeDigest }, { rejectAbsolutePaths: true }),
    lineageDigest: canonicalDigest(manifest.lineage, { rejectAbsolutePaths: true }),
    byteDeltaDigest: canonicalDigest(byteDeltas, { rejectAbsolutePaths: true }),
    fileModeDigest: canonicalDigest(fileModes, { rejectAbsolutePaths: true }),
    candidateTreeDigest,
    writeSetDigest: canonicalDigest(manifest.writeSet, { rejectAbsolutePaths: true }),
  });
}

async function writeExecutionViewFile(view: string, repositoryPath: string, bytes: Buffer, mode: "100644" | "100755"): Promise<void> {
  const target = resolve(view, repositoryPath);
  const relation = relative(view, target);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("CHECK_CONFINEMENT_UNAVAILABLE");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: mode === "100755" ? 0o700 : 0o600 });
  await chmod(target, mode === "100755" ? 0o700 : 0o600);
}

async function prepareCheckExecutionView(
  root: string,
  workspace: string,
  temporary: string,
  repositoryReadFiles: readonly string[],
): Promise<{
  readonly view: string;
  readonly runtime: string;
  readonly authorityDependencies: readonly Readonly<{ path: string; digest: string }>[];
}> {
  const view = resolve(temporary, "execution-view");
  await mkdir(view, { mode: 0o700 });
  const tree = await candidateTree(workspace);
  for (const item of tree) {
    const source = resolve(workspace, item.path);
    const { bytes } = await authenticatedContentFile(source, maximumCandidateTreeBytes, "CANDIDATE_BASIS_MISMATCH");
    if (sha256(bytes) !== item.digest) refuse("CANDIDATE_BASIS_MISMATCH");
    await writeExecutionViewFile(view, item.path, bytes, item.mode);
  }
  const candidatePaths = new Set(tree.map((item) => item.path));
  const authorityDependencies: Array<{ path: string; digest: string }> = [];
  for (const repositoryPath of repositoryReadFiles) {
    if (candidatePaths.has(repositoryPath)) continue;
    const source = resolve(root, repositoryPath);
    const relation = relative(root, source);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("CHECK_VALIDATION_AUTHORITY_INVALID");
    const { bytes, entry } = await authenticatedContentFile(source, maximumWorkspaceManifestBytes, "CHECK_VALIDATION_AUTHORITY_INVALID");
    if (realpathSync(source) !== source) refuse("CHECK_VALIDATION_AUTHORITY_INVALID");
    await writeExecutionViewFile(view, repositoryPath, bytes, repositoryMode(entry.mode));
    authorityDependencies.push({ path: repositoryPath, digest: sha256(bytes) });
  }
  authorityDependencies.sort((left, right) => left.path.localeCompare(right.path));
  const runtime = resolve(view, ".usf-check-runtime");
  await mkdir(runtime, { mode: 0o700 });
  return Object.freeze({ view: await realpath(view), runtime: await realpath(runtime), authorityDependencies: Object.freeze(authorityDependencies) });
}

/** Pure admission boundary for tests and callers that must not spawn a nested process. */
async function prepareFocusedCheckCurrent(root: string, candidateDigest: string, allowlist: readonly FocusedCheck[], id: string): Promise<PreparedFocusedCheck> {
  const current = await currentCandidateWorkspace(root, candidateDigest);
  const { workspace, basis } = current;
  const selected = allowlist.find((entry) => entry.id === id);
  if (!selected) return { status: "refused", basis, reasonCode: "CHECK_NOT_ALLOWLISTED", id };
  const dependencyRoots = await toolDependencyRoots();
  const launch = confinedNodeTestLaunch(workspace, resolve(workspace, ".usf-check-tmp"), dependencyRoots, selected.command);
  if (!launch) return { status: "refused", basis, reasonCode: "CHECK_CONFINEMENT_UNAVAILABLE", id };
  return { status: "ready", basis, id, workspace, executable: launch.executable, arguments: launch.arguments };
}

/** Pure readiness boundary: it performs no child execution and holds no execution lock. */
export async function prepareFocusedCheck(root: string, candidateDigest: string, allowlist: readonly FocusedCheck[], id: string): Promise<PreparedFocusedCheck> {
  try {
    return await prepareFocusedCheckCurrent(await realpath(root), candidateDigest, allowlist, id);
  } catch (error) {
    return { status: "refused", reasonCode: stableReason(error) ?? "CHECK_CONFINEMENT_UNAVAILABLE", id };
  }
}

async function resetFocusedCheckTemporary(workspace: string): Promise<string> {
  const temporary = resolve(workspace, ".usf-check-tmp");
  try {
    const entry = await lstat(temporary);
    const uid = typeof process.getuid === "function" ? process.getuid() : entry.uid;
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== uid || entry.nlink < 2
      || (entry.mode & 0o777) !== 0o700 || await realpath(temporary) !== temporary) {
      throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Focused-check temporary path is not a controlled directory");
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { mode: 0o700 });
  const created = await lstat(temporary);
  const uid = typeof process.getuid === "function" ? process.getuid() : created.uid;
  if (!created.isDirectory() || created.isSymbolicLink() || created.uid !== uid || created.nlink < 2 || (created.mode & 0o777) !== 0o700) {
    throw new RealisationError("CANDIDATE_BASIS_MISMATCH", "Focused-check temporary directory could not be authenticated");
  }
  return temporary;
}

function receiptLocation(root: string, candidateDigest: string, validationId: string): { readonly repositoryPath: string; readonly path: string } {
  if (!digestPattern.test(candidateDigest)) refuse("INVALID_CANDIDATE_DIGEST");
  const validationDigest = canonicalDigest(validationId).slice("sha256:".length);
  const repositoryPath = `${checkReceiptRoot}/${candidateDigest.slice("sha256:".length)}/${validationDigest}.json`;
  return { repositoryPath, path: resolve(root, repositoryPath) };
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.mode === right.mode
    && left.nlink === right.nlink && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function authenticatedContentFile(
  path: string,
  maximumBytes: number,
  reasonCode: string,
): Promise<{ readonly bytes: Buffer; readonly entry: Stats }> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return refuse(reasonCode);
  }
  try {
    const before = await handle.stat();
    const uid = typeof process.getuid === "function" ? process.getuid() : before.uid;
    const canonicalPath = await realpath(path).catch(() => refuse(reasonCode));
    if (!before.isFile() || before.uid !== uid || before.nlink !== 1 || before.size > maximumBytes
      || canonicalPath !== path) {
      refuse(reasonCode);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(before, after) || bytes.byteLength !== before.size || bytes.byteLength > maximumBytes) refuse(reasonCode);
    return Object.freeze({ bytes, entry: after });
  } finally {
    await handle.close();
  }
}

function receiptDirectories(root: string, candidateDigest: string): readonly string[] {
  if (!digestPattern.test(candidateDigest)) refuse("INVALID_CANDIDATE_DIGEST");
  return Object.freeze([
    resolve(root, ".usf"),
    resolve(root, ".usf", "receipts"),
    resolve(root, checkReceiptRoot),
    resolve(root, checkReceiptRoot, candidateDigest.slice("sha256:".length)),
  ]);
}

async function authenticatedDirectory(path: string, privateDirectory: boolean): Promise<Stats | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return refuse("CHECK_RECEIPT_PATH_UNSAFE");
  }
  try {
    const before = await handle.stat();
    const uid = typeof process.getuid === "function" ? process.getuid() : before.uid;
    const canonicalPath = await realpath(path).catch(() => refuse("CHECK_RECEIPT_PATH_UNSAFE"));
    if (!before.isDirectory() || before.uid !== uid || before.nlink < 1
      || (privateDirectory && (before.mode & 0o777) !== 0o700)
      || canonicalPath !== path) {
      refuse("CHECK_RECEIPT_PATH_UNSAFE");
    }
    const after = await handle.stat();
    if (!sameFileIdentity(before, after)) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    return after;
  } finally {
    await handle.close();
  }
}

async function authenticateReceiptAncestry(root: string, candidateDigest: string, create: boolean): Promise<boolean> {
  const canonicalRoot = await realpath(root).catch(() => refuse("CHECK_RECEIPT_PATH_UNSAFE"));
  if (canonicalRoot !== root || await authenticatedDirectory(root, false) === null) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  for (const path of receiptDirectories(root, candidateDigest)) {
    let entry = await authenticatedDirectory(path, true);
    if (entry === null) {
      if (!create) return false;
      try { await mkdir(path, { mode: 0o700 }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse("CHECK_RECEIPT_PATH_UNSAFE");
      }
      entry = await authenticatedDirectory(path, true);
      if (entry === null) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    }
  }
  return true;
}

async function fsyncReceiptDirectory(root: string, candidateDigest: string): Promise<void> {
  await authenticateReceiptAncestry(root, candidateDigest, false);
  const directory = receiptDirectories(root, candidateDigest).at(-1)!;
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch(() => refuse("CHECK_RECEIPT_PATH_UNSAFE"));
  try {
    const before = await handle.stat();
    const uid = typeof process.getuid === "function" ? process.getuid() : before.uid;
    if (!before.isDirectory() || before.uid !== uid || before.nlink < 1 || (before.mode & 0o777) !== 0o700) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    await handle.sync();
    const after = await handle.stat();
    if (!sameFileIdentity(before, after)) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  } finally {
    await handle.close();
  }
}

async function authenticatedReceiptFile(path: string, allowedLinks: readonly number[]): Promise<{ readonly bytes: Buffer; readonly entry: Stats } | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return refuse("CHECK_RECEIPT_PATH_UNSAFE");
  }
  try {
    const before = await handle.stat();
    const uid = typeof process.getuid === "function" ? process.getuid() : before.uid;
    if (!before.isFile() || before.uid !== uid || !allowedLinks.includes(before.nlink)
      || (before.mode & 0o777) !== 0o600 || before.size > maximumReceiptBytes) {
      refuse("CHECK_RECEIPT_PATH_UNSAFE");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(before, after) || bytes.byteLength !== before.size || bytes.byteLength > maximumReceiptBytes) {
      refuse("CHECK_RECEIPT_INVALID");
    }
    return Object.freeze({ bytes, entry: after });
  } finally {
    await handle.close();
  }
}

async function ensureReceiptDirectories(root: string, candidateDigest: string): Promise<void> {
  await authenticateReceiptAncestry(root, candidateDigest, true);
}

function receiptDigest(receipt: Omit<CheckedCandidateReceipt, "receiptDigest">): string {
  return canonicalDigest(receipt, { rejectAbsolutePaths: true });
}

function parseCheckedReceipt(bytes: Buffer): CheckedCandidateReceipt {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return refuse("CHECK_RECEIPT_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) refuse("CHECK_RECEIPT_INVALID");
  const receipt = parsed as CheckedCandidateReceipt;
  const expectedKeys = [
    "schema", "workIri", "explicitProfileIri", "originalConstructionBasisDigest", "scopedDependencyDigest", "candidateDigest",
    "workspaceIdentityDigest", "lineageDigest", "byteDeltaDigest", "fileModeDigest", "candidateTreeDigest", "writeSetDigest",
    "validationObligationIri", "validationResourceDigest", "validationCommandTokens", "validationCommandDigest",
    "validationEnvironmentIri", "validationEnvironmentDigest", "validationExecutionModeIri", "validationExecutionModeDigest",
    "validationToolDependencies", "validationToolDependencyDigest", "validationSchemaDependencies", "validationSchemaDependencyDigest",
    "validationAuthorityDependencies", "validationAuthorityDependencyDigest", "checkedCandidateSchemaDigest", "exitCode", "outputResultDigest",
    "validationExecutionAuthorityResourceDigest", "validationWallTimeMilliseconds", "validationTerminationGraceMilliseconds",
    "validationTimedOut", "validationTimeoutTerminationSignal", "validationResultSetDigest", "receiptDigest",
  ];
  if (!exactKeys(receipt, expectedKeys)) refuse("CHECK_RECEIPT_INVALID");
  const digestFields = [
    receipt.originalConstructionBasisDigest, receipt.scopedDependencyDigest, receipt.candidateDigest, receipt.workspaceIdentityDigest,
    receipt.lineageDigest, receipt.byteDeltaDigest, receipt.fileModeDigest, receipt.candidateTreeDigest, receipt.writeSetDigest,
    receipt.validationResourceDigest, receipt.validationCommandDigest, receipt.validationEnvironmentDigest, receipt.validationExecutionModeDigest,
    receipt.validationToolDependencyDigest, receipt.validationSchemaDependencyDigest, receipt.validationAuthorityDependencyDigest,
    receipt.checkedCandidateSchemaDigest, receipt.validationExecutionAuthorityResourceDigest, receipt.outputResultDigest,
    receipt.validationResultSetDigest, receipt.receiptDigest,
  ];
  const iriFields = [receipt.workIri, receipt.explicitProfileIri, receipt.validationObligationIri, receipt.validationEnvironmentIri, receipt.validationExecutionModeIri];
  const validRef = (value: unknown): value is Readonly<{ id: string; digest: string }> => !!value && typeof value === "object" && !Array.isArray(value)
    && exactKeys(value, ["id", "digest"])
    && typeof (value as { id?: unknown }).id === "string" && (value as { id: string }).id.length > 0
    && typeof (value as { digest?: unknown }).digest === "string" && digestPattern.test((value as { digest: string }).digest);
  const validToolRef = (value: unknown): value is Readonly<{ kind: "basis-input" | "host-tool"; id: string; digest: string }> => !!value && typeof value === "object" && !Array.isArray(value)
    && exactKeys(value, ["kind", "id", "digest"])
    && ((value as { kind?: unknown }).kind === "basis-input" || (value as { kind?: unknown }).kind === "host-tool")
    && typeof (value as { id?: unknown }).id === "string" && (value as { id: string }).id.length > 0
    && typeof (value as { digest?: unknown }).digest === "string" && digestPattern.test((value as { digest: string }).digest);
  const validAuthorityRef = (value: unknown): value is Readonly<{ path: string; digest: string }> => !!value && typeof value === "object" && !Array.isArray(value)
    && exactKeys(value, ["path", "digest"])
    && typeof (value as { path?: unknown }).path === "string"
    && /^(?!\.git(?:\/|$))(?!\.usf(?:\/|$))(?!\.env(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test((value as { path: string }).path)
    && typeof (value as { digest?: unknown }).digest === "string" && digestPattern.test((value as { digest: string }).digest);
  if (receipt.schema !== checkedCandidateSchemaIdentity || receipt.exitCode !== 0
    || digestFields.some((digest) => typeof digest !== "string" || !digestPattern.test(digest))
    || iriFields.some((iri) => typeof iri !== "string" || !/^urn:[^<>\s]+$/u.test(iri))
    || !Array.isArray(receipt.validationCommandTokens) || receipt.validationCommandTokens.some((token) => typeof token !== "string" || token.length === 0)
    || strictNodeTestPaths(receipt.validationCommandTokens) === null
    || !Array.isArray(receipt.validationToolDependencies) || !receipt.validationToolDependencies.every(validToolRef)
    || !Array.isArray(receipt.validationSchemaDependencies) || !receipt.validationSchemaDependencies.every(validRef)
    || !Array.isArray(receipt.validationAuthorityDependencies) || !receipt.validationAuthorityDependencies.every(validAuthorityRef)
    || new Set(receipt.validationToolDependencies.map((dependency) => `${dependency.kind}|${dependency.id}`)).size !== receipt.validationToolDependencies.length
    || new Set(receipt.validationSchemaDependencies.map((dependency) => dependency.id)).size !== receipt.validationSchemaDependencies.length
    || new Set(receipt.validationAuthorityDependencies.map((dependency) => dependency.path)).size !== receipt.validationAuthorityDependencies.length
    || receipt.validationCommandDigest !== canonicalDigest(receipt.validationCommandTokens)
    || receipt.validationToolDependencyDigest !== canonicalDigest(receipt.validationToolDependencies, { rejectAbsolutePaths: true })
    || receipt.validationSchemaDependencyDigest !== canonicalDigest(receipt.validationSchemaDependencies, { rejectAbsolutePaths: true })
    || receipt.validationAuthorityDependencyDigest !== canonicalDigest(receipt.validationAuthorityDependencies, { rejectAbsolutePaths: true })
    || !Number.isSafeInteger(receipt.validationWallTimeMilliseconds) || receipt.validationWallTimeMilliseconds < 1
    || !Number.isSafeInteger(receipt.validationTerminationGraceMilliseconds) || receipt.validationTerminationGraceMilliseconds < 1
    || receipt.validationTimedOut !== false || receipt.validationTimeoutTerminationSignal !== "none") {
    refuse("CHECK_RECEIPT_INVALID");
  }
  const expectedOutputResultDigest = canonicalDigest({
    exitCode: 0,
    outputLimitBytes: maximumCheckOutputBytes,
    outputWithinLimit: true,
    validationExecutionAuthorityResourceDigest: receipt.validationExecutionAuthorityResourceDigest,
    validationWallTimeMilliseconds: receipt.validationWallTimeMilliseconds,
    validationTerminationGraceMilliseconds: receipt.validationTerminationGraceMilliseconds,
    validationTimedOut: false,
    validationTimeoutTerminationSignal: "none",
  });
  if (receipt.outputResultDigest !== expectedOutputResultDigest
    || receipt.validationResultSetDigest !== canonicalDigest({ validationObligationIri: receipt.validationObligationIri, outcome: "pass", outputResultDigest: expectedOutputResultDigest })) {
    refuse("CHECK_RECEIPT_INVALID");
  }
  const { receiptDigest: suppliedDigest, ...draft } = receipt;
  if (suppliedDigest !== receiptDigest(draft)
    || canonicalJson(receipt, { rejectAbsolutePaths: true }) !== bytes.toString("utf8")) {
    refuse("CHECK_RECEIPT_INVALID");
  }
  return receipt;
}

function receiptTemporaryPath(finalPath: string): string {
  return `${finalPath}.pending`;
}

function authenticateReceiptBinding(receipt: CheckedCandidateReceipt, candidateDigest: string, validationId: string): void {
  if (receipt.candidateDigest !== candidateDigest || receipt.validationObligationIri !== validationId) refuse("CHECK_RECEIPT_CONFLICT");
}

function authenticateReceiptBytes(
  root: string,
  file: { readonly bytes: Buffer; readonly entry: Stats },
  candidateDigest: string,
  validationId: string,
  expectedBytes?: Buffer,
): CheckedCandidateReceipt {
  const receipt = parseCheckedReceipt(file.bytes);
  authenticateReceiptBinding(receipt, candidateDigest, validationId);
  const authority = checkedReceiptExecutionAuthority(root);
  if (receipt.checkedCandidateSchemaDigest !== authority.schemaDigest
    || receipt.validationExecutionAuthorityResourceDigest !== authority.resourceDigest
    || receipt.validationWallTimeMilliseconds !== authority.wallTimeMilliseconds
    || receipt.validationTerminationGraceMilliseconds !== authority.terminationGraceMilliseconds) {
    refuse("CHECK_RECEIPT_INVALID");
  }
  if (expectedBytes !== undefined && !file.bytes.equals(expectedBytes)) refuse("CHECK_RECEIPT_CONFLICT");
  return receipt;
}

async function unlinkAuthenticatedReceiptFile(
  root: string,
  candidateDigest: string,
  path: string,
  expected: { readonly bytes: Buffer; readonly entry: Stats },
): Promise<void> {
  await authenticateReceiptAncestry(root, candidateDigest, false);
  const current = await authenticatedReceiptFile(path, [expected.entry.nlink]);
  if (current === null || !current.bytes.equals(expected.bytes)
    || current.entry.dev !== expected.entry.dev || current.entry.ino !== expected.entry.ino
    || current.entry.uid !== expected.entry.uid || current.entry.mode !== expected.entry.mode) {
    refuse("CHECK_RECEIPT_PATH_UNSAFE");
  }
  const pathEntry = await lstat(path).catch(() => refuse("CHECK_RECEIPT_PATH_UNSAFE"));
  if (pathEntry.isSymbolicLink() || pathEntry.dev !== expected.entry.dev || pathEntry.ino !== expected.entry.ino) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  await unlink(path).catch(() => refuse("CHECK_RECEIPT_PATH_UNSAFE"));
  await fsyncReceiptDirectory(root, candidateDigest);
}

async function recoverReceiptPublication(
  root: string,
  candidateDigest: string,
  validationId: string,
  expectedBytes?: Buffer,
): Promise<CheckedCandidateReceipt | null> {
  if (!await authenticateReceiptAncestry(root, candidateDigest, false)) return null;
  const { path } = receiptLocation(root, candidateDigest, validationId);
  const temporaryPath = receiptTemporaryPath(path);
  const final = await authenticatedReceiptFile(path, [1, 2]);
  const temporary = await authenticatedReceiptFile(temporaryPath, [1, 2]);
  if (final === null && temporary === null) return null;

  if (final !== null && temporary === null) {
    if (final.entry.nlink !== 1) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    return authenticateReceiptBytes(root, final, candidateDigest, validationId, expectedBytes);
  }

  if (final === null && temporary !== null) {
    if (temporary.entry.nlink !== 1) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    const receipt = authenticateReceiptBytes(root, temporary, candidateDigest, validationId, expectedBytes);
    await authenticateReceiptAncestry(root, candidateDigest, false);
    try { await link(temporaryPath, path); } catch { return refuse("CHECK_RECEIPT_PATH_UNSAFE"); }
    await fsyncReceiptDirectory(root, candidateDigest);
    const linkedFinal = await authenticatedReceiptFile(path, [2]);
    const linkedTemporary = await authenticatedReceiptFile(temporaryPath, [2]);
    if (linkedFinal === null || linkedTemporary === null || !linkedFinal.bytes.equals(linkedTemporary.bytes)
      || linkedFinal.entry.dev !== linkedTemporary.entry.dev || linkedFinal.entry.ino !== linkedTemporary.entry.ino
      || linkedFinal.entry.uid !== linkedTemporary.entry.uid || linkedFinal.entry.mode !== linkedTemporary.entry.mode) {
      refuse("CHECK_RECEIPT_PATH_UNSAFE");
    }
    await unlinkAuthenticatedReceiptFile(root, candidateDigest, temporaryPath, linkedTemporary);
    const recovered = await authenticatedReceiptFile(path, [1]);
    if (recovered === null || !recovered.bytes.equals(temporary.bytes)) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
    return receipt;
  }

  if (final === null || temporary === null || final.entry.nlink !== 2 || temporary.entry.nlink !== 2
    || final.entry.dev !== temporary.entry.dev || final.entry.ino !== temporary.entry.ino
    || final.entry.uid !== temporary.entry.uid || final.entry.mode !== temporary.entry.mode
    || !final.bytes.equals(temporary.bytes)) {
    refuse("CHECK_RECEIPT_PATH_UNSAFE");
  }
  const receipt = authenticateReceiptBytes(root, final, candidateDigest, validationId, expectedBytes);
  await unlinkAuthenticatedReceiptFile(root, candidateDigest, temporaryPath, temporary);
  const recovered = await authenticatedReceiptFile(path, [1]);
  if (recovered === null || !recovered.bytes.equals(final.bytes)) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
  return receipt;
}

async function readExistingReceipt(root: string, candidateDigest: string, validationId: string): Promise<CheckedCandidateReceipt | null> {
  if (!await authenticateReceiptAncestry(root, candidateDigest, false)) return null;
  const { path } = receiptLocation(root, candidateDigest, validationId);
  if (await authenticatedReceiptFile(receiptTemporaryPath(path), [1, 2]) !== null) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  const final = await authenticatedReceiptFile(path, [1]);
  if (final === null) return null;
  const receipt = parseCheckedReceipt(final.bytes);
  authenticateReceiptBinding(receipt, candidateDigest, validationId);
  const authority = checkedReceiptExecutionAuthority(root);
  if (receipt.checkedCandidateSchemaDigest !== authority.schemaDigest
    || receipt.validationExecutionAuthorityResourceDigest !== authority.resourceDigest
    || receipt.validationWallTimeMilliseconds !== authority.wallTimeMilliseconds
    || receipt.validationTerminationGraceMilliseconds !== authority.terminationGraceMilliseconds) {
    refuse("CHECK_RECEIPT_INVALID");
  }
  return receipt;
}

/** Read-only canonical receipt accessor; absence is null and unsafe/tampered state refuses. */
export async function readGraphDerivedCheckReceipt(
  root: string,
  candidateDigest: string,
  validationId: string,
): Promise<{ readonly receiptPath: string; readonly receipt: CheckedCandidateReceipt } | null> {
  const canonicalRoot = await realpath(root);
  const receipt = await readExistingReceipt(canonicalRoot, candidateDigest, validationId);
  return receipt === null ? null : Object.freeze({ receiptPath: receiptLocation(canonicalRoot, candidateDigest, validationId).repositoryPath, receipt });
}

async function persistReceipt(root: string, candidateDigest: string, validationId: string, receipt: CheckedCandidateReceipt): Promise<string> {
  await ensureReceiptDirectories(root, candidateDigest);
  const location = receiptLocation(root, candidateDigest, validationId);
  const bytes = Buffer.from(canonicalJson(receipt, { rejectAbsolutePaths: true }));
  if (bytes.byteLength > maximumReceiptBytes) refuse("CHECK_RECEIPT_INVALID");
  const existing = await recoverReceiptPublication(root, candidateDigest, validationId, bytes);
  if (existing !== null) {
    if (canonicalJson(existing, { rejectAbsolutePaths: true }) !== bytes.toString("utf8")) refuse("CHECK_RECEIPT_CONFLICT");
    return location.repositoryPath;
  }
  const temporary = receiptTemporaryPath(location.path);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const written = await handle.stat();
    const uid = typeof process.getuid === "function" ? process.getuid() : written.uid;
    if (!written.isFile() || written.uid !== uid || written.nlink !== 1 || (written.mode & 0o777) !== 0o600 || written.size !== bytes.byteLength) {
      refuse("CHECK_RECEIPT_PATH_UNSAFE");
    }
    await handle.close();
    handle = null;
    const authenticatedTemporary = await authenticatedReceiptFile(temporary, [1]);
    if (authenticatedTemporary === null || !authenticatedTemporary.bytes.equals(bytes)) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
    await authenticateReceiptAncestry(root, candidateDigest, false);
    try { await link(temporary, location.path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse("CHECK_RECEIPT_PATH_UNSAFE");
      const raced = await recoverReceiptPublication(root, candidateDigest, validationId, bytes);
      if (raced === null || canonicalJson(raced, { rejectAbsolutePaths: true }) !== bytes.toString("utf8")) refuse("CHECK_RECEIPT_CONFLICT");
      return location.repositoryPath;
    }
    await fsyncReceiptDirectory(root, candidateDigest);
  } finally {
    if (handle !== null) await handle.close().catch(() => undefined);
  }
  const recovered = await recoverReceiptPublication(root, candidateDigest, validationId, bytes);
  if (recovered === null) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
  const readback = await readExistingReceipt(root, candidateDigest, validationId);
  if (readback === null || canonicalJson(readback, { rejectAbsolutePaths: true }) !== bytes.toString("utf8")) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
  return location.repositoryPath;
}

interface ValidationExecutionObservation {
  readonly exitCode: number;
  readonly outputWithinLimit: boolean;
  readonly timedOut: boolean;
  readonly timeoutTerminationSignal: "none" | "SIGTERM" | "SIGKILL";
}

async function executeBoundedCheck(
  executable: string,
  arguments_: readonly string[],
  workspace: string,
  authority: ValidationExecutionAuthority,
): Promise<ValidationExecutionObservation> {
  return new Promise((finish) => {
    const child = spawn(executable, arguments_, { cwd: workspace, env: {}, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let outputBytes = 0;
    let outputWithinLimit = true;
    let settled = false;
    let timedOut = false;
    let timeoutTerminationSignal: "none" | "SIGTERM" | "SIGKILL" = "none";
    let graceTimer: NodeJS.Timeout | undefined;
    let wallTimer: NodeJS.Timeout | undefined;
    const settle = (exitCode: number) => {
      if (settled) return;
      settled = true;
      if (wallTimer !== undefined) clearTimeout(wallTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      finish({ exitCode, outputWithinLimit, timedOut, timeoutTerminationSignal });
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
      outputBytes += chunk.byteLength;
      if (outputBytes <= maximumCheckOutputBytes || !outputWithinLimit) return;
      outputWithinLimit = false;
      terminateTree("SIGKILL");
    };
    child.stdout?.on("data", observe);
    child.stderr?.on("data", observe);
    child.once("error", () => settle(1));
    child.once("exit", (code) => settle(code ?? 1));
    wallTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      if (terminateTree(authority.terminationSignal)) timeoutTerminationSignal = authority.terminationSignal;
      graceTimer = setTimeout(() => {
        if (settled) return;
        if (terminateTree(authority.forcedTerminationSignal)) timeoutTerminationSignal = authority.forcedTerminationSignal;
        settle(1);
      }, authority.terminationGraceMilliseconds);
    }, authority.wallTimeMilliseconds);
  });
}

/**
 * Graph-authoritative candidate check for the canonical CLI. The caller may
 * select only a validation already bound by the authenticated construction
 * basis; command, environment, mode and dependencies are never caller input.
 */
export async function runGraphDerivedCheck(root: string, candidateDigest: string, validationId: string): Promise<GraphDerivedCheckResult> {
  let basis: RealisationBasis | undefined;
  try {
    return await withCandidateLock(root, candidateDigest, async (canonicalRoot) => {
      const workspaceBeforeAuthentication = await candidateWorkspace(canonicalRoot, candidateDigest);
      await resetFocusedCheckTemporary(workspaceBeforeAuthentication);
      const current = await currentCandidateWorkspace(canonicalRoot, candidateDigest);
      basis = current.basis;
      const { workspace } = current;
      const validation = graphValidation(canonicalRoot, basis, validationId);
      const executionAuthority = checkedReceiptExecutionAuthority(canonicalRoot);
      const existingReceipt = await recoverReceiptPublication(canonicalRoot, candidateDigest, validationId);
      const before = await candidateReceiptFacts(canonicalRoot, workspace, candidateDigest, basis);
      const dependencyRoots = await toolDependencyRoots();
      const temporary = resolve(workspace, ".usf-check-tmp");
      const execution = await prepareCheckExecutionView(canonicalRoot, workspace, temporary, validation.repositoryReadFiles);
      const launch = confinedNodeTestLaunch(execution.view, execution.runtime, dependencyRoots, validation.commandTokens);
      if (launch === null) refuse("CHECK_CONFINEMENT_UNAVAILABLE");
      let observation: ValidationExecutionObservation;
      try {
        observation = await executeBoundedCheck(launch.executable, launch.arguments, execution.view, executionAuthority);
      } finally {
        await resetFocusedCheckTemporary(workspace);
      }
      const observedOutputResult = {
        exitCode: observation.exitCode,
        outputLimitBytes: maximumCheckOutputBytes,
        outputWithinLimit: observation.outputWithinLimit,
        validationExecutionAuthorityResourceDigest: executionAuthority.resourceDigest,
        validationWallTimeMilliseconds: executionAuthority.wallTimeMilliseconds,
        validationTerminationGraceMilliseconds: executionAuthority.terminationGraceMilliseconds,
        validationTimedOut: observation.timedOut,
        validationTimeoutTerminationSignal: observation.timeoutTerminationSignal,
      };
      const observedOutputResultDigest = canonicalDigest(observedOutputResult);
      if (observation.timedOut) return {
        status: "refused",
        basis,
        reasonCode: executionAuthority.timeoutReasonCode,
        id: validationId,
        exitCode: observation.exitCode,
        validationExecutionAuthorityResourceDigest: executionAuthority.resourceDigest,
        validationWallTimeMilliseconds: executionAuthority.wallTimeMilliseconds,
        validationTerminationGraceMilliseconds: executionAuthority.terminationGraceMilliseconds,
        validationTimedOut: true,
        validationTimeoutTerminationSignal: observation.timeoutTerminationSignal,
        outputResultDigest: observedOutputResultDigest,
      };
      if (!observation.outputWithinLimit) return { status: "refused", basis, reasonCode: "CHECK_OUTPUT_LIMIT_EXCEEDED", id: validationId, exitCode: observation.exitCode };
      if (observation.exitCode !== 0) return { status: "refused", basis, reasonCode: "CHECK_FAILED", id: validationId, exitCode: observation.exitCode };
      const authenticatedAfter = await currentCandidateWorkspace(canonicalRoot, candidateDigest);
      if (authenticatedAfter.basis.basisDigest !== basis.basisDigest) refuse("CANDIDATE_BASIS_MISMATCH");
      const after = await candidateReceiptFacts(canonicalRoot, workspace, candidateDigest, basis);
      if (canonicalDigest(before) !== canonicalDigest(after)) refuse("CANDIDATE_BASIS_MISMATCH");
      const validationToolDependencyDigest = canonicalDigest(validation.toolDependencies, { rejectAbsolutePaths: true });
      const validationSchemaDependencyDigest = canonicalDigest(validation.schemaDependencies, { rejectAbsolutePaths: true });
      const outputResultDigest = observedOutputResultDigest;
      const validationResultSetDigest = canonicalDigest({ validationObligationIri: validationId, outcome: "pass", outputResultDigest });
      const draft: Omit<CheckedCandidateReceipt, "receiptDigest"> = {
        schema: checkedCandidateSchemaIdentity,
        workIri: basis.work.id,
        explicitProfileIri: basis.selection.profile,
        originalConstructionBasisDigest: basis.basisDigest,
        scopedDependencyDigest: basis.work.scopedDependencyDigest,
        candidateDigest,
        ...after,
        validationObligationIri: validationId,
        validationResourceDigest: validation.resourceDigest,
        validationCommandTokens: validation.commandTokens,
        validationCommandDigest: canonicalDigest(validation.commandTokens),
        validationEnvironmentIri: validation.environmentIri,
        validationEnvironmentDigest: validation.environmentDigest,
        validationExecutionModeIri: validation.executionModeIri,
        validationExecutionModeDigest: validation.executionModeDigest,
        validationToolDependencies: validation.toolDependencies,
        validationToolDependencyDigest,
        validationSchemaDependencies: validation.schemaDependencies,
        validationSchemaDependencyDigest,
        validationAuthorityDependencies: execution.authorityDependencies,
        validationAuthorityDependencyDigest: canonicalDigest(execution.authorityDependencies, { rejectAbsolutePaths: true }),
        checkedCandidateSchemaDigest: executionAuthority.schemaDigest,
        validationExecutionAuthorityResourceDigest: executionAuthority.resourceDigest,
        validationWallTimeMilliseconds: executionAuthority.wallTimeMilliseconds,
        validationTerminationGraceMilliseconds: executionAuthority.terminationGraceMilliseconds,
        validationTimedOut: false,
        validationTimeoutTerminationSignal: "none",
        exitCode: 0,
        outputResultDigest,
        validationResultSetDigest,
      };
      const receipt: CheckedCandidateReceipt = Object.freeze({ ...draft, receiptDigest: receiptDigest(draft) });
      if (existingReceipt !== null && canonicalJson(existingReceipt, { rejectAbsolutePaths: true }) !== canonicalJson(receipt, { rejectAbsolutePaths: true })) {
        refuse("CHECK_RECEIPT_CONFLICT");
      }
      const receiptPath = await persistReceipt(canonicalRoot, candidateDigest, validationId, receipt);
      return { status: "pass", basis, id: validationId, exitCode: 0, receiptPath, receipt };
    });
  } catch (error) {
    const reasonCode = error instanceof CheckRefusal ? error.reasonCode : stableReason(error) ?? "CHECK_CONFINEMENT_UNAVAILABLE";
    return { status: "refused", ...(basis === undefined ? {} : { basis }), reasonCode, id: validationId };
  }
}

export async function runFocusedCheck(root: string, candidateDigest: string, allowlist: readonly FocusedCheck[], id: string): Promise<FocusedCheckResult> {
  try {
    return await withCandidateLock(root, candidateDigest, async (canonicalRoot) => {
      const workspaceBeforeAuthentication = await candidateWorkspace(canonicalRoot, candidateDigest);
      await resetFocusedCheckTemporary(workspaceBeforeAuthentication);
      const prepared = await prepareFocusedCheckCurrent(canonicalRoot, candidateDigest, allowlist, id);
      if (prepared.status !== "ready") return prepared;
      const { workspace, basis, executable, arguments: arguments_ } = prepared;
      const temporary = resolve(workspace, ".usf-check-tmp");
      try {
        const exitCode = await new Promise<number>((finish) => {
          const child = spawn(executable, arguments_, {
            cwd: workspace,
            env: {},
            stdio: "ignore",
          });
          child.once("error", () => finish(1));
          child.once("exit", (code) => finish(code ?? 1));
        });
        return exitCode === 0 ? { status: "pass", basis, id, exitCode } : { status: "refused", basis, reasonCode: "CHECK_FAILED", id, exitCode };
      } finally {
        await resetFocusedCheckTemporary(workspace);
      }
    });
  } catch (error) {
    return { status: "refused", reasonCode: stableReason(error) ?? "CHECK_CONFINEMENT_UNAVAILABLE", id };
  }
}

/** `usf check <digest> <allowlist-json> <check-id>` with no ambient commands. */
export const checkHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  if (args.length !== 3) return { output: { schema: "urn:usf:check-result:1", status: "refused", reasonCode: "INVALID_OPERATION" }, exitCode: exitCodes.INVALID_INPUT };
  try {
    const result = await runFocusedCheck(repositoryRoot, args[0]!, JSON.parse(args[1]!) as FocusedCheck[], args[2]!);
    return { output: { schema: "urn:usf:check-result:1", ...result }, exitCode: result.status === "pass" ? exitCodes.SUCCESS : exitCodes.CONTAINMENT_REFUSAL };
  } catch {
    return { output: { schema: "urn:usf:check-result:1", status: "refused", reasonCode: "INVALID_OPERATION" }, exitCode: exitCodes.INVALID_INPUT };
  }
};

export { RealisationError };
