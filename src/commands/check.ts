import { constants, existsSync, lstatSync, readdirSync, realpathSync, type Stats } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { candidateWorkspace, currentCandidateWorkspace, currentCandidateWorkspaceForCheckRecovery, maximumWorkspaceManifestBytes, RealisationError, stableReason, withCandidateLock } from "../realisation/index.ts";
import { assertSameBasis, type RealisationBasis } from "../realisation/basis.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes } from "../core/errors.ts";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { loadSemanticGraph, objectsFor, resourceDigest, validationRuntimeClosure, type LoadedSemanticGraph } from "../graph/index.ts";
import { deriveCurrentRealisationBasis } from "../graph/work.ts";
import { isOperation, type FileOperation } from "../providers/types.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";

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

interface CheckedCandidateExecutionIntent {
  readonly schema: "urn:usf:checked-candidate-execution-intent:1";
  readonly state: "PREPARED" | "STARTED" | "SETTLED" | "UNKNOWN";
  readonly intentDigest: string;
  readonly candidateDigest: string;
  readonly validationObligationIri: string;
  readonly workIri: string;
  readonly explicitProfileIri: string;
  readonly originalConstructionBasisDigest: string;
  readonly scopedDependencyDigest: string;
  readonly workspaceIdentityDigest: string;
  readonly candidateTreeDigest: string;
  readonly validationResourceDigest: string;
  readonly validationCommandDigest: string;
  readonly validationEnvironmentDigest: string;
  readonly validationExecutionModeDigest: string;
  readonly validationToolDependencyDigest: string;
  readonly validationSchemaDependencyDigest: string;
  readonly validationAuthorityDependencyDigest: string;
  readonly validationExecutionAuthorityResourceDigest: string;
  readonly executionInputDigest: string;
  readonly intentPath: string;
  readonly receiptPath: string;
  readonly receiptDigest: string | null;
}

export type CheckConfinementFailure =
  | "BASE_LAUNCH_UNAVAILABLE"
  | "MODE_POLICY_MISMATCH"
  | "FIXTURE_POLICY_MISSING"
  | "FIXTURE_POLICY_AUTHENTICATION_FAILED"
  | "EXECUTION_MODE_UNSUPPORTED"
  | "FIXTURE_LAUNCH_UNAVAILABLE"
  | "HOST_PROFILE_AUTHORITY_READ_FAILED"
  | "HOST_PROFILE_RECOVERY_FAILED"
  | "HOST_PROFILE_RECEIPT_READBACK_FAILED"
  | "HOST_PROFILE_POST_EXECUTION_FAILED"
  | "EXECUTION_VIEW_PATH_INVALID";

export type GraphDerivedCheckResult =
  | { readonly status: "pass"; readonly basis: RealisationBasis; readonly id: string; readonly exitCode: 0; readonly receiptPath: string; readonly receipt: CheckedCandidateReceipt }
  | { readonly status: "refused"; readonly basis?: RealisationBasis; readonly reasonCode: string; readonly id: string; readonly exitCode?: number; readonly confinementFailure?: CheckConfinementFailure;
    readonly validationExecutionAuthorityResourceDigest?: string; readonly validationWallTimeMilliseconds?: number;
    readonly validationTerminationGraceMilliseconds?: number; readonly validationTimedOut?: true;
    readonly validationTimeoutTerminationSignal?: "none" | "SIGTERM" | "SIGKILL"; readonly outputResultDigest?: string;
    readonly failureDiagnostic?: Readonly<Record<string, unknown>>;
    readonly diagnosticDetails?: Readonly<Record<string, unknown>> };

const bubblewrapExecutable = "/usr/bin/bwrap" as const;
const checkedCandidateSchemaIri = "urn:usf:schema:checked-candidate-receipt:1";
const checkedCandidateSchemaIdentity = "urn:usf:checked-candidate-receipt:1" as const;
const checkedCandidateExecutionIntentSchemaIdentity = "urn:usf:checked-candidate-execution-intent:1" as const;
const checkedCandidateExecutionIntentSchemaIri = "urn:usf:schema:checked-candidate-execution-intent:1";
const checkedCandidateExecutionIntentRuleIri = "urn:usf:rule:completion-check-receipts-execution-intent:1";
const checkedCandidateExecutionIntentRuleFingerprint = "sha256:d7d74d1382f6fff562bfb92f3c8117a0cb1b5d0de33300a7afb59a878364234a";
const validationExecutionAuthorityIri = "urn:usf:algorithm:work-integration-transition:2";
const integrationManifestPath = "graph/manifests/integration.json";
const checkReceiptRoot = ".usf/receipts/check";
const workspaceManifestName = ".usf-workspace.json";
// Authority closure files are bounded independently from candidate and output limits.
const maximumValidationAuthorityFileBytes = 5 * 1024 * 1024;
const maximumCandidateTreeEntries = 8_192;
const maximumCandidateTreeBytes = 64 * 1024 * 1024;
const maximumCheckOutputBytes = 256 * 1024;
const maximumReceiptBytes = 128 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

class CheckRefusal extends Error {
  readonly reasonCode: string;
  readonly confinementFailure?: CheckConfinementFailure;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(reasonCode: string, confinementFailure?: CheckConfinementFailure, details?: Readonly<Record<string, unknown>>) {
    super(reasonCode);
    this.name = "CheckRefusal";
    this.reasonCode = reasonCode;
    this.confinementFailure = confinementFailure;
    this.details = details;
  }
}

function refuse(reasonCode: string, confinementFailure?: CheckConfinementFailure, details?: Readonly<Record<string, unknown>>): never {
  throw new CheckRefusal(reasonCode, confinementFailure, details);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function exactGraphValue(graph: LoadedSemanticGraph, subject: string, predicate: string, kind: "iri" | "literal", reason: string): string {
  const values = objectsFor(graph, subject, predicate);
  if (values.length !== 1 || values[0]?.objectKind !== kind) return refuse(reason, undefined, { subject, predicate, expectedKind: kind, actualCount: values.length });
  return values[0].object;
}

function exactGraphType(graph: LoadedSemanticGraph, subject: string, type: string, reason: string): void {
  const values = objectsFor(graph, subject, "urn:usf:predicate:type");
  if (values.length !== 1 || values[0]?.objectKind !== "iri" || values[0].object !== type) refuse(reason, undefined, {
    subject, predicate: "urn:usf:predicate:type", expectedType: type, actual: values.map(value => value.object),
  });
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
  const localDependencyMounts = [resolve(canonicalWorkspace, "node_modules"), resolve(canonicalWorkspace, ".usf/cache")] as const;
  const dependencyAliases = localDependencyMounts.every(authenticatedEmptyOwnerDirectory)
    && localDependencyMounts.every((path, index) => path !== authenticatedDependencyRoots[index])
    ? authenticatedDependencyRoots.map((path, index) => [path, localDependencyMounts[index]!] as const)
    : [];
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
      ...dependencyAliases.flatMap(([source, target]) => ["--ro-bind", source, target]),
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

function authenticatedEmptyOwnerDirectory(path: string): boolean {
  try {
    return authenticatedOwnerDirectory(path, true) && readdirSync(path).length === 0;
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

interface AuthenticatedChangeWorkspaceManifest {
  readonly schema: "urn:usf:workspace-manifest:1";
  readonly digest: string;
  readonly basis: RealisationBasis;
  readonly operations: readonly FileOperation[];
  readonly lineage: Readonly<{ readonly acceptedContributionDigests: readonly string[]; readonly rejected: readonly unknown[] }>;
  readonly scope: readonly string[];
  readonly writeSet: readonly string[];
  readonly preimages: Readonly<Record<string, string | null>>;
}

interface AuthenticatedNoChangeWorkspaceManifest {
  readonly schema: "urn:usf:no-change-workspace-manifest:1";
  readonly digest: string;
  readonly basis: RealisationBasis;
  readonly disposition: "no-change-candidate";
  readonly policy: Readonly<{ readonly iri: string; readonly resourceDigest: string; readonly algorithmIri: string; readonly algorithmResourceDigest: string }>;
  readonly operations: readonly [];
  readonly lineage: Readonly<{ readonly acceptedContributionDigests: readonly []; readonly rejected: readonly [] }>;
  readonly scope: readonly string[];
  readonly writeSet: readonly string[];
  readonly preimages: Readonly<Record<string, string | null>>;
}

type AuthenticatedWorkspaceManifest = AuthenticatedChangeWorkspaceManifest | AuthenticatedNoChangeWorkspaceManifest;

interface CandidateTreeEntry { readonly path: string; readonly digest: string; readonly mode: "100644" | "100755"; }

interface GraphValidation {
  readonly commandTokens: readonly string[];
  readonly resourceDigest: string;
  readonly environmentIri: string;
  readonly environmentDigest: string;
  readonly executionModeIri: string;
  readonly executionModeDigest: string;
  readonly toolDependencies: readonly Readonly<{ kind: "basis-input" | "host-tool"; id: string; digest: string }>[];
  readonly fixtureProcessPolicy: FixtureProcessPolicy | null;
  readonly schemaDependencies: readonly Readonly<{ id: string; digest: string }>[];
  readonly repositoryReadFiles: readonly string[];
  readonly authorityDependencyPaths: readonly string[];
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuse("INVALID_WORKSPACE_MANIFEST");
  }
  const noChange = (value as { schema?: unknown }).schema === "urn:usf:no-change-workspace-manifest:1";
  if (!exactKeys(value, noChange
    ? ["schema", "digest", "basis", "disposition", "policy", "operations", "lineage", "scope", "writeSet", "preimages"]
    : ["schema", "digest", "basis", "operations", "lineage", "scope", "writeSet", "preimages"])) refuse("INVALID_WORKSPACE_MANIFEST");
  const manifest = value as AuthenticatedWorkspaceManifest;
  if ((manifest.schema !== "urn:usf:workspace-manifest:1" && manifest.schema !== "urn:usf:no-change-workspace-manifest:1")
    || manifest.digest !== candidateDigest || manifest.basis.basisDigest !== basis.basisDigest
    || !Array.isArray(manifest.operations)
    || !manifest.lineage || typeof manifest.lineage !== "object" || Array.isArray(manifest.lineage)
    || !exactKeys(manifest.lineage, ["acceptedContributionDigests", "rejected"])
    || !Array.isArray(manifest.scope) || !Array.isArray(manifest.writeSet)
    || !manifest.preimages || typeof manifest.preimages !== "object" || Array.isArray(manifest.preimages)) {
    refuse("INVALID_WORKSPACE_MANIFEST");
  }
  if (manifest.schema === "urn:usf:workspace-manifest:1") {
    if (manifest.operations.length === 0 || !manifest.operations.every(isOperation)) refuse("INVALID_WORKSPACE_MANIFEST");
  } else if (manifest.disposition !== "no-change-candidate" || manifest.operations.length !== 0
    || manifest.lineage.acceptedContributionDigests.length !== 0 || manifest.lineage.rejected.length !== 0
    || !manifest.policy || typeof manifest.policy !== "object" || Array.isArray(manifest.policy)
    || !exactKeys(manifest.policy, ["iri", "resourceDigest", "algorithmIri", "algorithmResourceDigest"])
    || !/^urn:[^<>\s]+$/u.test(manifest.policy.iri) || !/^urn:[^<>\s]+$/u.test(manifest.policy.algorithmIri)
    || !digestPattern.test(manifest.policy.resourceDigest) || !digestPattern.test(manifest.policy.algorithmResourceDigest)) {
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
      if (repositoryPath === ".usf-check-tmp") {
        const uid = typeof process.getuid === "function" ? process.getuid() : entry.uid;
        if (entry.uid !== uid || entry.nlink < 2 || (entry.mode & 0o777) !== 0o700 || await realpath(target) !== target) {
          refuse("CANDIDATE_BASIS_MISMATCH");
        }
        return;
      }
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
    refuse("CHECK_VALIDATION_AUTHORITY_INVALID", undefined, { invalidRepositoryPath: value });
  }
  return value;
}

import { authenticateFixtureProcessHostProfile, authenticateFixtureProcessPolicy, readFixtureProcessPolicy, confinedFixtureProcessLaunch, type FixtureProcessPolicy } from "../realisation/fixture-process.ts";

function graphValidation(root: string, basis: RealisationBasis, validationId: string): GraphValidation {
  const invalid = (detail: string): never => refuse("CHECK_VALIDATION_AUTHORITY_INVALID", undefined, { detail });
  let graph: LoadedSemanticGraph;
  try { graph = loadSemanticGraph(root, basis.selection.manifestPath); } catch { return invalid("selected semantic manifest could not be loaded"); }
  const selectedManifest = graph.manifests.filter((manifest) => manifest.path === basis.selection.manifestPath);
  if (graph.manifestPath !== basis.selection.manifestPath || selectedManifest.length !== 1
    || resourceDigest(graph, basis.selection.profile) !== basis.selection.profileDigest
    || exactGraphValue(graph, basis.selection.profile, "urn:usf:predicate:version", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID") !== basis.selection.profileVersion) {
    return invalid("selected manifest or profile currentness differs from the realisation basis");
  }
  const selected = basis.trace.validation.filter((validation) => validation.id === validationId);
  if (selected.length !== 1) refuse("CHECK_VALIDATION_NOT_BOUND");
  exactGraphType(graph, validationId, "urn:usf:type:TestObligation", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const validationResourceDigest = resourceDigest(graph, validationId);
  if (validationResourceDigest !== selected[0]?.digest) return invalid("validation obligation digest differs from the realisation basis");
  const command = exactGraphValue(graph, validationId, "urn:usf:predicate:command", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const commandTokens = command.split(" ");
  if (commandTokens.join(" ") !== command || commandTokens.some((token) => token.length === 0)) refuse("CHECK_VALIDATION_COMMAND_UNSUPPORTED");
  const environmentIri = exactGraphValue(graph, validationId, "urn:usf:predicate:environment", "iri", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const executionModeIri = exactGraphValue(graph, validationId, "urn:usf:predicate:executionMode", "iri", "CHECK_VALIDATION_AUTHORITY_INVALID");
  const confinedFixtureProcessMode = executionModeIri === "urn:usf:mode:confined-fixture-process:1"
    || executionModeIri === "urn:usf:mode:confined-fixture-process:2";
  if (exactGraphValue(graph, validationId, "urn:usf:predicate:applicability", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID") !== "required"
    || environmentIri !== "urn:usf:environment:hermetic"
    || (executionModeIri !== "urn:usf:mode:deterministic-test-substitute" && !confinedFixtureProcessMode)) {
    refuse("CHECK_VALIDATION_MODE_UNSUPPORTED");
  }
  let fixtureProcessPolicy: FixtureProcessPolicy | null = null;
  if (confinedFixtureProcessMode) {
    fixtureProcessPolicy = readFixtureProcessPolicy(graph, executionModeIri);
    if (fixtureProcessPolicy === null) refuse("CHECK_VALIDATION_MODE_UNSUPPORTED");
    if (!authenticateFixtureProcessHostProfile(fixtureProcessPolicy)) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "HOST_PROFILE_AUTHORITY_READ_FAILED");
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
  if (currentnessValues.length > 1 || currentnessValues.some((quad) => quad.objectKind !== "iri")) return invalid("activation-currentness authority is ambiguous");
  let declaredReadFiles: string[];
  try { declaredReadFiles = validationRuntimeClosure(graph, validationId).repositoryReadFiles.map(graphRepositoryPath); }
  catch { return invalid("validation runtime closure could not be derived"); }
  const repositoryReadFiles = [...new Set([
    ...declaredReadFiles,
    ...(currentnessValues.length === 0 ? [] : [graphRepositoryPath(exactGraphValue(graph, currentnessValues[0]!.object, "urn:usf:predicate:receiptPath", "literal", "CHECK_VALIDATION_AUTHORITY_INVALID"))]),
  ])].sort();
  const completionValidationObligations = objectsFor(graph, basis.authority.contract, "urn:usf:predicate:completionValidationObligation")
    .filter((quad) => quad.objectKind === "iri").map((quad) => quad.object);
  const publicationTargetPaths = [...new Set(graph.quads
    .filter((quad) => quad.predicate === "urn:usf:predicate:eligibleWork" && quad.objectKind === "iri" && quad.object === basis.work.id)
    .map((quad) => quad.subject)
    .flatMap((policy) => graph.quads
      .filter((quad) => quad.subject === policy && quad.predicate === "urn:usf:predicate:targetSemanticSourcePath" && quad.objectKind === "literal")
      .map((quad) => graphRepositoryPath(quad.object))))];
  const authorityDependencyPaths = completionValidationObligations.includes(validationId) && publicationTargetPaths.length === 1
    ? repositoryReadFiles.filter((path) => path !== publicationTargetPaths[0])
    : repositoryReadFiles;
  return Object.freeze({
    commandTokens: Object.freeze(commandTokens),
    resourceDigest: validationResourceDigest,
    environmentIri,
    environmentDigest: resourceDigest(graph, environmentIri),
    executionModeIri,
    executionModeDigest: resourceDigest(graph, executionModeIri),
    toolDependencies: Object.freeze([
      ...basisTools,
      { kind: "host-tool" as const, id: hostTool, digest: resourceDigest(graph, hostTool) },
      ...(fixtureProcessPolicy === null ? [] : fixtureProcessPolicy.toolDependencies.map((dependency) => ({ ...dependency }))),
    ]),
    fixtureProcessPolicy,
    schemaDependencies: Object.freeze(schemaDependencies),
    repositoryReadFiles: Object.freeze(repositoryReadFiles),
    authorityDependencyPaths: Object.freeze(authorityDependencyPaths),
  });
}

function validationReceiptClaims(validation: GraphValidation) {
  return Object.freeze({
    validationResourceDigest: validation.resourceDigest,
    validationCommandTokens: validation.commandTokens,
    validationCommandDigest: canonicalDigest(validation.commandTokens),
    validationEnvironmentIri: validation.environmentIri,
    validationEnvironmentDigest: validation.environmentDigest,
    validationExecutionModeIri: validation.executionModeIri,
    validationExecutionModeDigest: validation.executionModeDigest,
    validationToolDependencies: validation.toolDependencies,
    validationToolDependencyDigest: canonicalDigest(validation.toolDependencies, { rejectAbsolutePaths: true }),
    validationSchemaDependencies: validation.schemaDependencies,
    validationSchemaDependencyDigest: canonicalDigest(validation.schemaDependencies, { rejectAbsolutePaths: true }),
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
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "EXECUTION_VIEW_PATH_INVALID");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: mode === "100755" ? 0o700 : 0o600 });
  await chmod(target, mode === "100755" ? 0o700 : 0o600);
}

async function* validationAuthorityFiles(root: string, tree: readonly CandidateTreeEntry[], repositoryReadFiles: readonly string[]) {
  for (const repositoryPath of repositoryReadFiles) {
    const source = resolve(root, repositoryPath);
    const relation = relative(root, source);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) refuse("CHECK_VALIDATION_AUTHORITY_INVALID", undefined, { path: repositoryPath, failure: "path-outside-root" });
    let content: { readonly bytes: Buffer; readonly entry: Stats };
    try {
      content = await authenticatedContentFile(source, maximumValidationAuthorityFileBytes, "CHECK_VALIDATION_AUTHORITY_INVALID");
    } catch (error) {
      if (error instanceof CheckRefusal && error.reasonCode === "CHECK_VALIDATION_AUTHORITY_INVALID") {
        return refuse(error.reasonCode, undefined, { path: repositoryPath, failure: "authority-file-authentication" });
      }
      throw error;
    }
    if (realpathSync(source) !== source) refuse("CHECK_VALIDATION_AUTHORITY_INVALID", undefined, { path: repositoryPath, failure: "path-realisation-changed" });
    const { bytes, entry } = content;
    yield { path: repositoryPath, bytes, mode: repositoryMode(entry.mode) };
  }
}

async function validationAuthorityDependencies(root: string, workspace: string, repositoryReadFiles: readonly string[]) {
  const dependencies: Array<{ path: string; digest: string }> = [];
  for await (const file of validationAuthorityFiles(root, await candidateTree(workspace), repositoryReadFiles)) {
    dependencies.push({ path: file.path, digest: sha256(file.bytes) });
  }
  return dependencies.sort((left, right) => left.path.localeCompare(right.path));
}

function authorityDependencyMismatches(
  actual: readonly Readonly<{ path: string; digest: string }>[],
  expected: readonly Readonly<{ path: string; digest: string }>[],
): readonly Readonly<{ path: string; actual: string | null; expected: string | null }>[] {
  const actualByPath = new Map(actual.map((dependency) => [dependency.path, dependency.digest] as const));
  const expectedByPath = new Map(expected.map((dependency) => [dependency.path, dependency.digest] as const));
  return [...new Set([...actualByPath.keys(), ...expectedByPath.keys()])]
    .sort()
    .filter((path) => actualByPath.get(path) !== expectedByPath.get(path))
    .slice(0, 64)
    .map((path) => ({ path, actual: actualByPath.get(path) ?? null, expected: expectedByPath.get(path) ?? null }));
}

async function prepareCheckExecutionView(
  root: string,
  workspace: string,
  temporary: string,
  repositoryReadFiles: readonly string[],
  authorityDependencyPaths: readonly string[] = repositoryReadFiles,
): Promise<{
  readonly view: string;
  readonly runtime: string;
  readonly authorityDependencies: readonly Readonly<{ path: string; digest: string }>[];
}> {
  const view = resolve(temporary, "execution-view");
  await mkdir(view, { mode: 0o700 });
  const tree = await candidateTree(workspace);
  const authorityPaths = new Set(repositoryReadFiles);
  for (const item of tree) {
    if (authorityPaths.has(item.path)) continue;
    const source = resolve(workspace, item.path);
    const { bytes } = await authenticatedContentFile(source, maximumCandidateTreeBytes, "CANDIDATE_BASIS_MISMATCH");
    if (sha256(bytes) !== item.digest) refuse("CANDIDATE_BASIS_MISMATCH");
    await writeExecutionViewFile(view, item.path, bytes, item.mode);
  }
  const authorityDependencies: Array<{ path: string; digest: string }> = [];
  for await (const file of validationAuthorityFiles(root, tree, repositoryReadFiles)) {
    await writeExecutionViewFile(view, file.path, file.bytes, file.mode);
  }
  for await (const file of validationAuthorityFiles(root, tree, authorityDependencyPaths)) {
    authorityDependencies.push({ path: file.path, digest: sha256(file.bytes) });
  }
  authorityDependencies.sort((left, right) => left.path.localeCompare(right.path));
  await mkdir(resolve(view, "node_modules"), { mode: 0o700 });
  await mkdir(resolve(view, ".usf/cache"), { recursive: true, mode: 0o700 });
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

function intentLocation(root: string, candidateDigest: string, validationId: string): { readonly repositoryPath: string; readonly path: string } {
  const receipt = receiptLocation(root, candidateDigest, validationId);
  const repositoryPath = receipt.repositoryPath.replace(/\.json$/u, ".intent.json");
  return { repositoryPath, path: resolve(root, repositoryPath) };
}

function intentTemporaryPath(finalPath: string): string {
  return `${finalPath}.pending`;
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
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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

async function fsyncReceiptAncestry(root: string, candidateDigest: string): Promise<void> {
  if (await authenticatedDirectory(root, false) === null) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  const paths = [root, ...receiptDirectories(root, candidateDigest)];
  for (const [index, path] of paths.entries()) {
    if (await authenticatedDirectory(path, index !== 0) === null) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch(() => refuse("CHECK_RECEIPT_PATH_UNSAFE"));
    try { await handle.sync(); } finally { await handle.close(); }
  }
}

async function authenticatedReceiptFile(path: string, allowedLinks: readonly number[]): Promise<{ readonly bytes: Buffer; readonly entry: Stats } | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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

const checkedCandidateExecutionIntentFields = Object.freeze([
  "schema", "state", "intentDigest", "candidateDigest", "validationObligationIri", "workIri", "explicitProfileIri",
  "originalConstructionBasisDigest", "scopedDependencyDigest", "workspaceIdentityDigest", "candidateTreeDigest",
  "validationResourceDigest", "validationCommandDigest", "validationEnvironmentDigest", "validationExecutionModeDigest",
  "validationToolDependencyDigest", "validationSchemaDependencyDigest", "validationAuthorityDependencyDigest",
  "validationExecutionAuthorityResourceDigest", "executionInputDigest", "intentPath", "receiptPath", "receiptDigest",
] as const);
const checkedCandidateExecutionIntentStates = Object.freeze(["PREPARED", "STARTED", "SETTLED", "UNKNOWN"] as const);

function intentDigest(intent: Omit<CheckedCandidateExecutionIntent, "state" | "intentDigest" | "receiptDigest">): string {
  return canonicalDigest(intent, { rejectAbsolutePaths: true });
}

function parseExecutionIntent(bytes: Buffer, validate: (value: unknown) => boolean): CheckedCandidateExecutionIntent {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return refuse("CHECK_EXECUTION_INTENT_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !validate(parsed) || !exactKeys(parsed, checkedCandidateExecutionIntentFields)) refuse("CHECK_EXECUTION_INTENT_INVALID");
  const intent = parsed as CheckedCandidateExecutionIntent;
  if (canonicalJson(intent, { rejectAbsolutePaths: true }) !== bytes.toString("utf8")
    || intent.schema !== checkedCandidateExecutionIntentSchemaIdentity
    || !checkedCandidateExecutionIntentStates.includes(intent.state)
    || !digestPattern.test(intent.intentDigest) || !digestPattern.test(intent.candidateDigest)
    || !digestPattern.test(intent.originalConstructionBasisDigest) || !digestPattern.test(intent.scopedDependencyDigest)
    || !digestPattern.test(intent.workspaceIdentityDigest) || !digestPattern.test(intent.candidateTreeDigest)
    || !digestPattern.test(intent.validationResourceDigest) || !digestPattern.test(intent.validationCommandDigest)
    || !digestPattern.test(intent.validationEnvironmentDigest) || !digestPattern.test(intent.validationExecutionModeDigest)
    || !digestPattern.test(intent.validationToolDependencyDigest) || !digestPattern.test(intent.validationSchemaDependencyDigest)
    || !digestPattern.test(intent.validationAuthorityDependencyDigest)
    || !digestPattern.test(intent.validationExecutionAuthorityResourceDigest) || !digestPattern.test(intent.executionInputDigest)
    || typeof intent.validationObligationIri !== "string" || typeof intent.workIri !== "string" || typeof intent.explicitProfileIri !== "string"
    || typeof intent.intentPath !== "string" || typeof intent.receiptPath !== "string"
    || (intent.receiptDigest !== null && !digestPattern.test(intent.receiptDigest))) refuse("CHECK_EXECUTION_INTENT_INVALID");
  const { state: _state, intentDigest: suppliedDigest, receiptDigest: _receiptDigest, ...bound } = intent;
  if (suppliedDigest !== intentDigest(bound) || (intent.state === "SETTLED") !== (intent.receiptDigest !== null)) refuse("CHECK_EXECUTION_INTENT_INVALID");
  return Object.freeze(intent);
}

interface ExecutionIntentAuthority {
  readonly schemaDigest: string;
  readonly ruleDigest: string;
  readonly validate: (value: unknown) => boolean;
}

async function executionIntentAuthority(root: string): Promise<ExecutionIntentAuthority> {
  const canonicalRoot = await realpath(root).catch(() => refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID"));
  if (canonicalRoot !== root) refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  let graph: LoadedSemanticGraph;
  try { graph = loadSemanticGraph(root, integrationManifestPath); } catch { return refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID"); }
  exactGraphType(graph, checkedCandidateExecutionIntentSchemaIri, "urn:usf:type:SemanticRecordSchema", "CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  if (exactGraphValue(graph, checkedCandidateExecutionIntentSchemaIri, "urn:usf:predicate:schemaIdentity", "iri", "CHECK_EXECUTION_INTENT_AUTHORITY_INVALID") !== checkedCandidateExecutionIntentSchemaIdentity
    || exactGraphValue(graph, checkedCandidateExecutionIntentSchemaIri, "urn:usf:predicate:repositoryPath", "literal", "CHECK_EXECUTION_INTENT_AUTHORITY_INVALID") !== "schemas/checked-candidate-execution-intent.schema.json") {
    refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  }
  const graphFields = objectsFor(graph, checkedCandidateExecutionIntentSchemaIri, "urn:usf:predicate:requiredField");
  const graphStates = objectsFor(graph, checkedCandidateExecutionIntentSchemaIri, "urn:usf:predicate:allowedState");
  if (graphFields.some((quad) => quad.objectKind !== "literal") || graphStates.some((quad) => quad.objectKind !== "literal")
    || canonicalJson(graphFields.map((quad) => quad.object).sort()) !== canonicalJson([...checkedCandidateExecutionIntentFields].sort())
    || canonicalJson(graphStates.map((quad) => quad.object).sort()) !== canonicalJson([...checkedCandidateExecutionIntentStates].sort())) {
    refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  }
  const schemaPath = resolve(root, "schemas/checked-candidate-execution-intent.schema.json");
  const schemaFile = await authenticatedContentFile(schemaPath, maximumReceiptBytes, "CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  let schema: unknown;
  try { schema = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(schemaFile.bytes)); } catch { return refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID"); }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  const candidate = schema as { $id?: unknown; required?: unknown; properties?: { state?: { enum?: unknown } } };
  if (candidate.$id !== checkedCandidateExecutionIntentSchemaIdentity || !Array.isArray(candidate.required)
    || canonicalJson([...candidate.required].sort()) !== canonicalJson([...checkedCandidateExecutionIntentFields].sort())
    || !Array.isArray(candidate.properties?.state?.enum)
    || canonicalJson([...candidate.properties.state.enum].sort()) !== canonicalJson([...checkedCandidateExecutionIntentStates].sort())) {
    refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  }
  exactGraphType(graph, checkedCandidateExecutionIntentRuleIri, "urn:usf:type:CliFieldDerivationRule", "CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  if (exactGraphValue(graph, checkedCandidateExecutionIntentRuleIri, "urn:usf:predicate:version", "literal", "CHECK_EXECUTION_INTENT_AUTHORITY_INVALID") !== "1"
    || exactGraphValue(graph, checkedCandidateExecutionIntentRuleIri, "urn:usf:predicate:text", "literal", "CHECK_EXECUTION_INTENT_AUTHORITY_INVALID").length === 0) {
    refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  }
  const ruleDigest = resourceDigest(graph, checkedCandidateExecutionIntentRuleIri);
  if (ruleDigest !== checkedCandidateExecutionIntentRuleFingerprint) refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID");
  let validator: ReturnType<typeof createJsonSchemaValidator<CheckedCandidateExecutionIntent>>;
  try { validator = createJsonSchemaValidator<CheckedCandidateExecutionIntent>(schema); }
  catch { return refuse("CHECK_EXECUTION_INTENT_AUTHORITY_INVALID"); }
  return Object.freeze({
    schemaDigest: canonicalDigest(schema, { rejectAbsolutePaths: true }),
    ruleDigest,
    validate: (value: unknown) => validator.validate(value).valid,
  });
}

async function deriveExecutionIntent(
  root: string,
  candidateDigest: string,
  validationId: string,
  current: Awaited<ReturnType<typeof currentCandidateWorkspace>>,
  validation: GraphValidation,
  authority: ValidationExecutionAuthority,
): Promise<Omit<CheckedCandidateExecutionIntent, "state" | "intentDigest" | "receiptDigest">> {
  const facts = await candidateReceiptFacts(root, current.workspace, candidateDigest, current.basis);
  const authorityDependencies = await validationAuthorityDependencies(root, current.workspace, validation.authorityDependencyPaths);
  const claims = validationReceiptClaims(validation);
  const receipt = receiptLocation(root, candidateDigest, validationId);
  const intent = intentLocation(root, candidateDigest, validationId);
  const binding = {
    candidateDigest,
    validationObligationIri: validationId,
    workIri: current.basis.work.id,
    explicitProfileIri: current.basis.selection.profile,
    originalConstructionBasisDigest: current.basis.basisDigest,
    scopedDependencyDigest: current.basis.work.scopedDependencyDigest,
    workspaceIdentityDigest: facts.workspaceIdentityDigest,
    candidateTreeDigest: facts.candidateTreeDigest,
    validationResourceDigest: claims.validationResourceDigest,
    validationCommandDigest: claims.validationCommandDigest,
    validationEnvironmentDigest: claims.validationEnvironmentDigest,
    validationExecutionModeDigest: claims.validationExecutionModeDigest,
    validationToolDependencyDigest: claims.validationToolDependencyDigest,
    validationSchemaDependencyDigest: claims.validationSchemaDependencyDigest,
    validationAuthorityDependencyDigest: canonicalDigest(authorityDependencies, { rejectAbsolutePaths: true }),
    validationExecutionAuthorityResourceDigest: authority.resourceDigest,
  };
  const intentAuthority = await executionIntentAuthority(root);
  return Object.freeze({
    schema: checkedCandidateExecutionIntentSchemaIdentity,
    ...binding,
    executionInputDigest: canonicalDigest({
      ...binding,
      ruleDigest: intentAuthority.ruleDigest,
      intentSchemaDigest: intentAuthority.schemaDigest,
      checkedCandidateSchemaDigest: authority.schemaDigest,
    }, { rejectAbsolutePaths: true }),
    intentPath: intent.repositoryPath,
    receiptPath: receipt.repositoryPath,
  });
}

async function readExecutionIntent(
  root: string,
  candidateDigest: string,
  validationId: string,
  expected: Omit<CheckedCandidateExecutionIntent, "state" | "intentDigest" | "receiptDigest">,
): Promise<CheckedCandidateExecutionIntent | null> {
  if (!await authenticateReceiptAncestry(root, candidateDigest, false)) return null;
  const location = intentLocation(root, candidateDigest, validationId);
  if (await authenticatedReceiptFile(intentTemporaryPath(location.path), [1]) !== null) refuse("CHECK_EXECUTION_INTENT_PENDING");
  const file = await authenticatedReceiptFile(location.path, [1]);
  if (file === null) return null;
  const authority = await executionIntentAuthority(root);
  const intent = parseExecutionIntent(file.bytes, authority.validate);
  const { state: _state, intentDigest: _digest, receiptDigest: _receiptDigest, ...bound } = intent;
  if (canonicalJson(bound, { rejectAbsolutePaths: true }) !== canonicalJson(expected, { rejectAbsolutePaths: true })) refuse("CHECK_EXECUTION_INTENT_INVALID");
  return intent;
}

/** Cheap authenticated presence probe used before full candidate reauthentication. */
export async function executionIntentPresent(root: string, candidateDigest: string, validationId: string): Promise<boolean> {
  if (!await authenticateReceiptAncestry(root, candidateDigest, false)) return false;
  const location = intentLocation(root, candidateDigest, validationId);
  if (await authenticatedReceiptFile(intentTemporaryPath(location.path), [1]) !== null) refuse("CHECK_EXECUTION_INTENT_PENDING");
  return await authenticatedReceiptFile(location.path, [1]) !== null;
}

async function persistExecutionIntent(
  root: string,
  candidateDigest: string,
  validationId: string,
  bound: Omit<CheckedCandidateExecutionIntent, "state" | "intentDigest" | "receiptDigest">,
  state: CheckedCandidateExecutionIntent["state"],
  receiptDigestValue: string | null,
  predecessor: CheckedCandidateExecutionIntent | null,
): Promise<CheckedCandidateExecutionIntent> {
  await ensureReceiptDirectories(root, candidateDigest);
  const current = await readExecutionIntent(root, candidateDigest, validationId, bound);
  if (canonicalJson(current, { rejectAbsolutePaths: true }) !== canonicalJson(predecessor, { rejectAbsolutePaths: true })) {
    refuse("CHECK_EXECUTION_INTENT_INVALID");
  }
  const location = intentLocation(root, candidateDigest, validationId);
  const temporary = intentTemporaryPath(location.path);
  if (await authenticatedReceiptFile(temporary, [1]) !== null) refuse("CHECK_EXECUTION_INTENT_PENDING");
  const draft = { ...bound, state, receiptDigest: receiptDigestValue };
  const intent = Object.freeze({ ...draft, intentDigest: intentDigest(bound) });
  const bytes = Buffer.from(canonicalJson(intent, { rejectAbsolutePaths: true }));
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const written = await handle.stat();
    const uid = typeof process.getuid === "function" ? process.getuid() : written.uid;
    if (!written.isFile() || written.uid !== uid || written.nlink !== 1 || (written.mode & 0o777) !== 0o600 || written.size !== bytes.byteLength) refuse("CHECK_EXECUTION_INTENT_INVALID");
    await handle.close();
    handle = null;
    const pending = await authenticatedReceiptFile(temporary, [1]);
    if (pending === null || !pending.bytes.equals(bytes)) refuse("CHECK_EXECUTION_INTENT_INVALID");
    await authenticateReceiptAncestry(root, candidateDigest, false);
    const beforeRename = await authenticatedReceiptFile(location.path, [1]);
    const authority = await executionIntentAuthority(root);
    const immediatePredecessor = beforeRename === null ? null : parseExecutionIntent(beforeRename.bytes, authority.validate);
    if (canonicalJson(immediatePredecessor, { rejectAbsolutePaths: true }) !== canonicalJson(predecessor, { rejectAbsolutePaths: true })) {
      refuse("CHECK_EXECUTION_INTENT_INVALID");
    }
    await rename(temporary, location.path).catch(() => refuse("CHECK_EXECUTION_INTENT_INVALID"));
    await fsyncReceiptDirectory(root, candidateDigest);
  } finally {
    if (handle !== null) await handle.close().catch(() => undefined);
  }
  const readback = await authenticatedReceiptFile(location.path, [1]);
  if (readback === null || !readback.bytes.equals(bytes)) refuse("CHECK_EXECUTION_INTENT_INVALID");
  const authority = await executionIntentAuthority(root);
  return parseExecutionIntent(readback.bytes, authority.validate);
}

type ExecutionIntentDisposition = "ABSENT" | "PREPARED" | "RECONCILE" | "UNKNOWN";
export type AuthenticatedGraphDerivedCheckIntentState = "ABSENT" | "PREPARED" | "STARTED" | "SETTLED";

function executionIntentDisposition(intent: CheckedCandidateExecutionIntent | null, receipt: CheckedCandidateReceipt | null): ExecutionIntentDisposition {
  if (intent === null) return "ABSENT";
  if (intent.state === "UNKNOWN") return "UNKNOWN";
  if (intent.state === "PREPARED") {
    if (receipt !== null) refuse("CHECK_EXECUTION_INTENT_INVALID");
    return "PREPARED";
  }
  if (intent.state === "STARTED") return receipt === null ? "UNKNOWN" : "RECONCILE";
  if (receipt === null || intent.receiptDigest !== receipt.receiptDigest) refuse("CHECK_EXECUTION_INTENT_INVALID");
  return "RECONCILE";
}

/**
 * Lock-free intent preflight for a caller already holding the candidate lock.
 * It never repairs pending publication, writes a state, or dispatches a child.
 */
async function authenticateGraphDerivedCheckIntentAtCurrent(
  root: string,
  candidateDigest: string,
  validationId: string,
  current: { readonly workspace: string; readonly basis: RealisationBasis },
): Promise<AuthenticatedGraphDerivedCheckIntentState> {
  const validation = graphValidation(root, current.basis, validationId);
  const authority = checkedReceiptExecutionAuthority(root);
  const bound = await deriveExecutionIntent(root, candidateDigest, validationId, current, validation, authority);
  const intent = await readExecutionIntent(root, candidateDigest, validationId, bound);
  const snapshot = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, async () => current);
  if (intent?.state === "SETTLED" && snapshot.kind !== "FINAL") refuse("CHECK_RECEIPT_PATH_UNSAFE");
  const disposition = executionIntentDisposition(intent, snapshot.receipt);
  if (disposition === "UNKNOWN") refuse("CHECK_EXECUTION_OUTCOME_UNKNOWN");
  if (disposition === "RECONCILE") {
    if (intent === null || (intent.state !== "STARTED" && intent.state !== "SETTLED")) refuse("CHECK_EXECUTION_INTENT_INVALID");
    return intent.state;
  }
  return disposition;
}

export async function authenticateGraphDerivedCheckIntent(
  root: string,
  candidateDigest: string,
  validationId: string,
): Promise<AuthenticatedGraphDerivedCheckIntentState> {
  return authenticateGraphDerivedCheckIntentAtCurrent(
    root,
    candidateDigest,
    validationId,
    await currentCandidateWorkspaceForCheckRecovery(root, candidateDigest),
  );
}

/** Authenticate one intent against a workspace already authenticated by its caller. */
export async function authenticateGraphDerivedCheckIntentAtAuthenticatedWorkspace(
  root: string,
  candidateDigest: string,
  validationId: string,
  authenticated: { readonly workspace: string; readonly basis: RealisationBasis },
): Promise<AuthenticatedGraphDerivedCheckIntentState> {
  return authenticateGraphDerivedCheckIntentAtCurrent(root, candidateDigest, validationId, authenticated);
}

async function ensureReceiptDirectories(root: string, candidateDigest: string): Promise<void> {
  await authenticateReceiptAncestry(root, candidateDigest, true);
  await fsyncReceiptAncestry(root, candidateDigest);
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

type AuthenticatedReceiptFile = Readonly<{ bytes: Buffer; entry: Stats }>;
type ReceiptPublicationKind = "ABSENT" | "FINAL" | "PENDING" | "LINKED";
interface ReceiptPublicationSnapshot {
  readonly kind: ReceiptPublicationKind;
  readonly final: AuthenticatedReceiptFile | null;
  readonly temporary: AuthenticatedReceiptFile | null;
  readonly receipt: CheckedCandidateReceipt | null;
  readonly identity: string;
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
  const authorityMismatches = [
    receipt.checkedCandidateSchemaDigest === authority.schemaDigest ? null : "checkedCandidateSchemaDigest",
    receipt.validationExecutionAuthorityResourceDigest === authority.resourceDigest ? null : "validationExecutionAuthorityResourceDigest",
    receipt.validationWallTimeMilliseconds === authority.wallTimeMilliseconds ? null : "validationWallTimeMilliseconds",
    receipt.validationTerminationGraceMilliseconds === authority.terminationGraceMilliseconds ? null : "validationTerminationGraceMilliseconds",
  ].filter((claim): claim is string => claim !== null);
  if (authorityMismatches.length !== 0) refuse("CHECK_RECEIPT_INVALID", undefined, { mismatchedClaims: authorityMismatches });
  if (expectedBytes !== undefined && !file.bytes.equals(expectedBytes)) refuse("CHECK_RECEIPT_CONFLICT");
  return receipt;
}

function receiptPublicationIdentity(
  kind: ReceiptPublicationKind,
  final: AuthenticatedReceiptFile | null,
  temporary: AuthenticatedReceiptFile | null,
): string {
  const identity = (file: AuthenticatedReceiptFile | null) => file === null ? null : ({
    bytesDigest: sha256(file.bytes),
    dev: file.entry.dev,
    ino: file.entry.ino,
    uid: file.entry.uid,
    mode: file.entry.mode,
    nlink: file.entry.nlink,
    size: file.entry.size,
    mtimeMs: file.entry.mtimeMs,
    ctimeMs: file.entry.ctimeMs,
  });
  return canonicalDigest({ kind, final: identity(final), temporary: identity(temporary) });
}

async function receiptPublicationSnapshot(
  root: string,
  candidateDigest: string,
  validationId: string,
  expectedBytes?: Buffer,
): Promise<ReceiptPublicationSnapshot> {
  if (!await authenticateReceiptAncestry(root, candidateDigest, false)) {
    return Object.freeze({ kind: "ABSENT", final: null, temporary: null, receipt: null, identity: receiptPublicationIdentity("ABSENT", null, null) });
  }
  const { path } = receiptLocation(root, candidateDigest, validationId);
  const final = await authenticatedReceiptFile(path, [1, 2]);
  const temporary = await authenticatedReceiptFile(receiptTemporaryPath(path), [1, 2]);
  let kind: ReceiptPublicationKind;
  let source: AuthenticatedReceiptFile | null;
  if (final === null && temporary === null) {
    kind = "ABSENT";
    source = null;
  } else if (final !== null && temporary === null) {
    if (final.entry.nlink !== 1) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    kind = "FINAL";
    source = final;
  } else if (final === null && temporary !== null) {
    if (temporary.entry.nlink !== 1) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    kind = "PENDING";
    source = temporary;
  } else {
    if (final === null || temporary === null || final.entry.nlink !== 2 || temporary.entry.nlink !== 2
      || final.entry.dev !== temporary.entry.dev || final.entry.ino !== temporary.entry.ino
      || final.entry.uid !== temporary.entry.uid || final.entry.mode !== temporary.entry.mode
      || !final.bytes.equals(temporary.bytes)) {
      refuse("CHECK_RECEIPT_PATH_UNSAFE");
    }
    kind = "LINKED";
    source = final;
  }
  const receipt = source === null ? null : authenticateReceiptBytes(root, source, candidateDigest, validationId, expectedBytes);
  return Object.freeze({ kind, final, temporary, receipt, identity: receiptPublicationIdentity(kind, final, temporary) });
}

async function assertSameReceiptPublicationSnapshot(
  root: string,
  candidateDigest: string,
  validationId: string,
  expected: ReceiptPublicationSnapshot,
  expectedBytes?: Buffer,
): Promise<ReceiptPublicationSnapshot> {
  const current = await receiptPublicationSnapshot(root, candidateDigest, validationId, expectedBytes);
  if (current.identity !== expected.identity) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  return current;
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
  fixtureProcessPolicy: FixtureProcessPolicy | null,
  snapshot: ReceiptPublicationSnapshot,
  expectedBytes?: Buffer,
): Promise<CheckedCandidateReceipt | null> {
  if (fixtureProcessPolicy !== null && !authenticateFixtureProcessHostProfile(fixtureProcessPolicy)) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "HOST_PROFILE_RECOVERY_FAILED");
  const { path } = receiptLocation(root, candidateDigest, validationId);
  const temporaryPath = receiptTemporaryPath(path);
  const current = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspaceForCheckRecovery, expectedBytes);
  if (current.identity !== snapshot.identity) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  if (current.kind === "ABSENT") return null;
  if (current.kind === "FINAL") return current.receipt;
  if (current.receipt === null || current.temporary === null) refuse("CHECK_RECEIPT_PATH_UNSAFE");

  if (current.kind === "PENDING") {
    await assertSameReceiptPublicationSnapshot(root, candidateDigest, validationId, current, expectedBytes);
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
    const recovered = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspaceForCheckRecovery, expectedBytes);
    if (recovered.kind !== "FINAL" || recovered.final === null || !recovered.final.bytes.equals(current.temporary.bytes)) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
    return current.receipt;
  }
  if (current.kind !== "LINKED" || current.final === null) refuse("CHECK_RECEIPT_PATH_UNSAFE");
  await assertSameReceiptPublicationSnapshot(root, candidateDigest, validationId, current, expectedBytes);
  await unlinkAuthenticatedReceiptFile(root, candidateDigest, temporaryPath, current.temporary);
  const recovered = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspaceForCheckRecovery, expectedBytes);
  if (recovered.kind !== "FINAL" || recovered.final === null || !recovered.final.bytes.equals(current.final.bytes)) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
  return current.receipt;
}

async function readExistingReceipt(root: string, candidateDigest: string, validationId: string): Promise<CheckedCandidateReceipt | null> {
  const snapshot = await receiptPublicationSnapshot(root, candidateDigest, validationId);
  if (snapshot.kind === "PENDING" || snapshot.kind === "LINKED") refuse("CHECK_RECEIPT_PATH_UNSAFE");
  return snapshot.receipt;
}

type CandidateCurrentReader = (root: string, candidateDigest: string) => Promise<{ readonly workspace: string; readonly basis: RealisationBasis }>;
type GraphDerivedCheckReceiptRead = { readonly receiptPath: string; readonly receipt: CheckedCandidateReceipt } | null;

async function readFullyCurrentReceiptPublicationSnapshot(
  root: string,
  candidateDigest: string,
  validationId: string,
  readCurrent: CandidateCurrentReader,
  expectedBytes?: Buffer,
): Promise<ReceiptPublicationSnapshot> {
  const canonicalRoot = await realpath(root);
  const snapshot = await receiptPublicationSnapshot(canonicalRoot, candidateDigest, validationId, expectedBytes);
  if (snapshot.receipt === null) return snapshot;
  const receipt = snapshot.receipt;
  const current = await readCurrent(canonicalRoot, candidateDigest);
  const validation = graphValidation(canonicalRoot, current.basis, validationId);
  const facts = await candidateReceiptFacts(canonicalRoot, current.workspace, candidateDigest, current.basis);
  const authorityDependencies = await validationAuthorityDependencies(canonicalRoot, current.workspace, validation.authorityDependencyPaths);
  const expected = {
    workIri: current.basis.work.id,
    explicitProfileIri: current.basis.selection.profile,
    originalConstructionBasisDigest: current.basis.basisDigest,
    scopedDependencyDigest: current.basis.work.scopedDependencyDigest,
    ...facts,
    ...validationReceiptClaims(validation),
    validationAuthorityDependencies: authorityDependencies,
    validationAuthorityDependencyDigest: canonicalDigest(authorityDependencies, { rejectAbsolutePaths: true }),
  };
  const mismatchedClaims = Object.entries(expected)
    .filter(([key, value]) => canonicalJson(receipt[key as keyof CheckedCandidateReceipt]) !== canonicalJson(value))
    .map(([key]) => key)
    .sort();
  if (mismatchedClaims.length !== 0) {
    const details: Record<string, unknown> = { mismatchedClaims };
    if (mismatchedClaims.includes("validationAuthorityDependencies") || mismatchedClaims.includes("validationAuthorityDependencyDigest")) {
      const dependencyMismatches = authorityDependencyMismatches(receipt.validationAuthorityDependencies, authorityDependencies);
      details.authorityDependencyMismatches = dependencyMismatches;
      details.authorityDependencyMismatchPaths = dependencyMismatches.map((dependency) => dependency.path);
      details.authorityDependencyMismatchDigests = dependencyMismatches.map((dependency) =>
        `${dependency.path}|receipt=${dependency.actual ?? "absent"}|current=${dependency.expected ?? "absent"}`);
      details.receiptAuthorityDependencyCount = receipt.validationAuthorityDependencies.length;
      details.currentAuthorityDependencyCount = authorityDependencies.length;
    }
    refuse("CHECK_RECEIPT_INVALID", undefined, details);
  }
  // Async reads must not carry an earlier basis, validation or receipt into reuse.
  const after = await readCurrent(canonicalRoot, candidateDigest);
  const validationAfter = graphValidation(canonicalRoot, after.basis, validationId);
  if (canonicalJson(current.basis) !== canonicalJson(after.basis)
    || canonicalJson(validationReceiptClaims(validation)) !== canonicalJson(validationReceiptClaims(validationAfter))
    || canonicalJson(validation.repositoryReadFiles) !== canonicalJson(validationAfter.repositoryReadFiles)
    || canonicalJson(authorityDependencies) !== canonicalJson(await validationAuthorityDependencies(canonicalRoot, after.workspace, validationAfter.authorityDependencyPaths))
    || canonicalJson(facts) !== canonicalJson(await candidateReceiptFacts(canonicalRoot, after.workspace, candidateDigest, after.basis))
    || (await assertSameReceiptPublicationSnapshot(canonicalRoot, candidateDigest, validationId, snapshot, expectedBytes)).identity !== snapshot.identity) {
    refuse("CHECK_RECEIPT_INVALID");
  }
  if (validation.fixtureProcessPolicy != null && !authenticateFixtureProcessHostProfile(validation.fixtureProcessPolicy)) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "HOST_PROFILE_RECEIPT_READBACK_FAILED");
  return snapshot;
}

async function readGraphDerivedCheckReceiptCurrent(
  root: string,
  candidateDigest: string,
  validationId: string,
  readCurrent: CandidateCurrentReader,
  recovery: boolean,
): Promise<GraphDerivedCheckReceiptRead> {
  const snapshot = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, readCurrent);
  if (snapshot.kind === "ABSENT") return null;
  if (snapshot.kind !== "FINAL") {
    if (recovery) return null;
    refuse("CHECK_RECEIPT_PATH_UNSAFE");
  }
  if (snapshot.receipt === null) refuse("CHECK_RECEIPT_INVALID");
  return Object.freeze({ receiptPath: receiptLocation(await realpath(root), candidateDigest, validationId).repositoryPath, receipt: snapshot.receipt });
}

/** Read-only strict receipt accessor; retained focused-check scratch is not admitted. */
export async function readGraphDerivedCheckReceipt(
  root: string,
  candidateDigest: string,
  validationId: string,
): Promise<GraphDerivedCheckReceiptRead> {
  return readGraphDerivedCheckReceiptCurrent(root, candidateDigest, validationId, currentCandidateWorkspace, false);
}

/** Read one receipt against a workspace already authenticated under its owner lock. */
export async function readGraphDerivedCheckReceiptAtAuthenticatedWorkspace(
  root: string,
  candidateDigest: string,
  validationId: string,
  authenticated: { readonly workspace: string; readonly basis: RealisationBasis },
): Promise<GraphDerivedCheckReceiptRead> {
  const readCurrent: CandidateCurrentReader = async () => authenticated;
  return readGraphDerivedCheckReceiptCurrent(root, candidateDigest, validationId, readCurrent, false);
}

/** Read-only recovery receipt accessor for canonical retained-intent authentication. */
export async function readGraphDerivedCheckReceiptForRecovery(
  root: string,
  candidateDigest: string,
  validationId: string,
): Promise<GraphDerivedCheckReceiptRead> {
  return readGraphDerivedCheckReceiptCurrent(root, candidateDigest, validationId, currentCandidateWorkspaceForCheckRecovery, true);
}

/** Recovery receipt accessor for a caller already bracketing workspace currentness. */
export async function readGraphDerivedCheckReceiptForRecoveryAtAuthenticatedWorkspace(
  root: string,
  candidateDigest: string,
  validationId: string,
  authenticated: { readonly workspace: string; readonly basis: RealisationBasis },
): Promise<GraphDerivedCheckReceiptRead> {
  const readCurrent: CandidateCurrentReader = async () => authenticated;
  return readGraphDerivedCheckReceiptCurrent(root, candidateDigest, validationId, readCurrent, true);
}

async function persistReceipt(root: string, candidateDigest: string, validationId: string, receipt: CheckedCandidateReceipt): Promise<string> {
  const current = await currentCandidateWorkspace(root, candidateDigest);
  const validation = graphValidation(root, current.basis, validationId);
  const fixtureProcessPolicy = validation.fixtureProcessPolicy;
  await ensureReceiptDirectories(root, candidateDigest);
  const location = receiptLocation(root, candidateDigest, validationId);
  const bytes = Buffer.from(canonicalJson(receipt, { rejectAbsolutePaths: true }));
  if (bytes.byteLength > maximumReceiptBytes) refuse("CHECK_RECEIPT_INVALID");
  const existingSnapshot = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspace);
  const existing = await recoverReceiptPublication(root, candidateDigest, validationId, fixtureProcessPolicy, existingSnapshot, bytes);
  if (existing !== null) {
    if (canonicalJson(existing, { rejectAbsolutePaths: true }) !== bytes.toString("utf8")) refuse("CHECK_RECEIPT_CONFLICT");
    return location.repositoryPath;
  }
  const temporary = receiptTemporaryPath(location.path);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const beforePendingPublication = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspace);
    if (beforePendingPublication.identity !== existingSnapshot.identity) refuse("CHECK_RECEIPT_PATH_UNSAFE");
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
    const pendingSnapshot = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspace, bytes);
    if (pendingSnapshot.kind !== "PENDING") refuse("CHECK_RECEIPT_PATH_UNSAFE");
    const beforeFinalPublication = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspace, bytes);
    if (beforeFinalPublication.identity !== pendingSnapshot.identity) refuse("CHECK_RECEIPT_PATH_UNSAFE");
    try { await link(temporary, location.path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return refuse("CHECK_RECEIPT_PATH_UNSAFE");
      const racedSnapshot = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspace);
      const raced = await recoverReceiptPublication(root, candidateDigest, validationId, fixtureProcessPolicy, racedSnapshot, bytes);
      if (raced === null || canonicalJson(raced, { rejectAbsolutePaths: true }) !== bytes.toString("utf8")) refuse("CHECK_RECEIPT_CONFLICT");
      return location.repositoryPath;
    }
    await fsyncReceiptDirectory(root, candidateDigest);
  } finally {
    if (handle !== null) await handle.close().catch(() => undefined);
  }
  const publishedSnapshot = await readFullyCurrentReceiptPublicationSnapshot(root, candidateDigest, validationId, currentCandidateWorkspace);
  const recovered = await recoverReceiptPublication(root, candidateDigest, validationId, fixtureProcessPolicy, publishedSnapshot, bytes);
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
  readonly stdoutObservedBytes: number;
  readonly stderrObservedBytes: number;
  readonly stdoutCaptured: Buffer;
  readonly stderrCaptured: Buffer;
  readonly outputTruncated: boolean;
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
    let stdoutObservedBytes = 0;
    let stderrObservedBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputWithinLimit = true;
    let outputTruncated = false;
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
      finish({ exitCode, outputWithinLimit, timedOut, timeoutTerminationSignal, stdoutObservedBytes, stderrObservedBytes,
        stdoutCaptured: Buffer.concat(stdoutChunks), stderrCaptured: Buffer.concat(stderrChunks), outputTruncated });
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
    const observe = (chunk: Buffer, stream: "stdout" | "stderr") => {
      outputBytes += chunk.byteLength;
      if (stream === "stdout") stdoutObservedBytes += chunk.byteLength;
      else stderrObservedBytes += chunk.byteLength;
      const retained = Math.max(0, maximumCheckOutputBytes - (stdoutChunks.reduce((sum, item) => sum + item.byteLength, 0)
        + stderrChunks.reduce((sum, item) => sum + item.byteLength, 0)));
      if (retained > 0) (stream === "stdout" ? stdoutChunks : stderrChunks).push(chunk.subarray(0, retained));
      if (chunk.byteLength > retained) outputTruncated = true;
      if (outputBytes <= maximumCheckOutputBytes || !outputWithinLimit) return;
      outputWithinLimit = false;
      terminateTree("SIGKILL");
    };
    child.stdout?.on("data", (chunk: Buffer) => observe(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => observe(chunk, "stderr"));
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

async function persistFailureDiagnostic(
  root: string,
  candidateDigest: string,
  validationId: string,
  validation: GraphValidation,
  intent: CheckedCandidateExecutionIntent,
  observation: ValidationExecutionObservation,
): Promise<{ readonly diagnosticPath: string; readonly diagnosticDigest: string; readonly record: Readonly<Record<string, unknown>> }> {
  const validationHash = canonicalDigest(validationId).slice("sha256:".length);
  const candidateHash = candidateDigest.slice("sha256:".length);
  const directory = resolve(root, ".usf/diagnostics/check", candidateHash, validationHash);
  const diagnosticPath = resolve(directory, `${canonicalDigest({ intentDigest: intent.intentDigest, executionInputDigest: intent.executionInputDigest,
    exitCode: observation.exitCode, timedOut: observation.timedOut, stdout: sha256(observation.stdoutCaptured), stderr: sha256(observation.stderrCaptured) }).slice("sha256:".length)}.json`);
  const record = {
    intentDigest: intent.intentDigest,
    executionInputDigest: intent.executionInputDigest,
    candidateDigest,
    validationObligationIri: validationId,
    workIri: intent.workIri,
    explicitProfileIri: intent.explicitProfileIri,
    originalConstructionBasisDigest: intent.originalConstructionBasisDigest,
    scopedDependencyDigest: intent.scopedDependencyDigest,
    validationResourceDigest: validation.resourceDigest,
    validationCommandDigest: intent.validationCommandDigest,
    validationEnvironmentDigest: validation.environmentDigest,
    validationExecutionModeDigest: validation.executionModeDigest,
    validationExecutionAuthorityResourceDigest: intent.validationExecutionAuthorityResourceDigest,
    exitCode: observation.exitCode,
    timedOut: observation.timedOut,
    timeoutTerminationSignal: observation.timeoutTerminationSignal,
    outputLimitBytes: maximumCheckOutputBytes,
    outputWithinLimit: observation.outputWithinLimit,
    stdoutObservedBytes: observation.stdoutObservedBytes,
    stderrObservedBytes: observation.stderrObservedBytes,
    stdoutCapturedBase64: observation.stdoutCaptured.toString("base64"),
    stderrCapturedBase64: observation.stderrCaptured.toString("base64"),
    outputTruncated: observation.outputTruncated,
    diagnosticPath: relative(root, diagnosticPath).replaceAll(sep, "/"),
  };
  const diagnosticDigest = canonicalDigest(record, { rejectAbsolutePaths: true });
  const value = Object.freeze({ diagnosticDigest, ...record });
  const bytes = Buffer.from(canonicalJson(value, { rejectAbsolutePaths: true }));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(diagnosticPath, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await import("node:fs/promises").then(fs => fs.readFile(diagnosticPath));
    if (!existing.equals(bytes)) throw new Error("CHECK_DIAGNOSTIC_CONFLICT");
  }
  return Object.freeze({ diagnosticPath: value.diagnosticPath, diagnosticDigest, record: value });
}

type GraphDerivedCheckFailureDiagnosticRead =
  | { readonly status: "available"; readonly diagnosticPath: string; readonly diagnostic: Readonly<Record<string, unknown>> }
  | { readonly status: "absent" }
  | { readonly status: "refused"; readonly reasonCode: string };

/** Read only the current diagnostic bound to the authenticated candidate and obligation. */
export async function readGraphDerivedCheckFailureDiagnostic(
  root: string,
  candidateDigest: string,
  validationId: string,
): Promise<GraphDerivedCheckFailureDiagnosticRead> {
  try {
    const current = await currentCandidateWorkspaceForCheckRecovery(root, candidateDigest);
    const candidateHash = candidateDigest.slice("sha256:".length);
    const validationHash = canonicalDigest(validationId).slice("sha256:".length);
    const directory = resolve(root, ".usf/diagnostics/check", candidateHash, validationHash);
    let names: string[];
    try { names = (await readdir(directory)).filter(name => /^[0-9a-f]{64}\.json$/u.test(name)).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" }; throw error; }
    if (names.length === 0) return { status: "absent" };
    if (names.length > 32) return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" };
    const matches: Readonly<Record<string, unknown>>[] = [];
    for (const name of names) {
      const path = resolve(directory, name);
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.mode !== 0o100600) return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_PATH_UNSAFE" };
      const bytes = await import("node:fs/promises").then(fs => fs.readFile(path));
      if (bytes.byteLength > 1024 * 1024) return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" };
      const value = JSON.parse(bytes.toString("utf8")) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" };
      const record = value as Readonly<Record<string, unknown>>;
      const digest = record.diagnosticDigest;
      const withoutDigest = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "diagnosticDigest"));
      if (typeof digest !== "string" || digest !== canonicalDigest(withoutDigest, { rejectAbsolutePaths: true })
        || record.diagnosticPath !== `.usf/diagnostics/check/${candidateHash}/${validationHash}/${name}`
        || record.candidateDigest !== candidateDigest || record.validationObligationIri !== validationId
        || record.workIri !== current.basis.work.id || record.explicitProfileIri !== current.basis.selection.profile
        || record.originalConstructionBasisDigest !== current.basis.basisDigest
        || record.scopedDependencyDigest !== current.basis.work.scopedDependencyDigest) {
        return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" };
      }
      const expectedName = canonicalDigest({
        intentDigest: record.intentDigest, executionInputDigest: record.executionInputDigest,
        exitCode: record.exitCode, timedOut: record.timedOut,
        stdout: sha256(Buffer.from(String(record.stdoutCapturedBase64), "base64")),
        stderr: sha256(Buffer.from(String(record.stderrCapturedBase64), "base64")),
      }).slice("sha256:".length) + ".json";
      if (name !== expectedName) return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" };
      matches.push(record);
    }
    if (matches.length !== 1) return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_CONFLICT" };
    return { status: "available", diagnosticPath: String(matches[0]!.diagnosticPath), diagnostic: matches[0]! };
  } catch (error) {
    if (error instanceof RealisationError) return { status: "refused", reasonCode: error.reasonCode };
    return { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" };
  }
}

/**
 * Graph-authoritative candidate check for the canonical CLI. The caller may
 * select only a validation already bound by the authenticated construction
 * basis; command, environment, mode and dependencies are never caller input.
 */
export async function runGraphDerivedCheck(root: string, candidateDigest: string, validationId: string): Promise<GraphDerivedCheckResult> {
  return graphDerivedCheck(root, candidateDigest, validationId, false);
}

/** Reuse a current receipt or execute an absent member under the native candidate lock. */
export async function ensureGraphDerivedCheck(root: string, candidateDigest: string, validationId: string): Promise<GraphDerivedCheckResult> {
  return graphDerivedCheck(root, candidateDigest, validationId, true);
}

async function graphDerivedCheck(root: string, candidateDigest: string, validationId: string, reuseCurrent: boolean): Promise<GraphDerivedCheckResult> {
  let basis: RealisationBasis | undefined;
  try {
    return await withCandidateLock(root, candidateDigest, async (canonicalRoot) => {
      const retainedIntentPresent = await executionIntentPresent(canonicalRoot, candidateDigest, validationId);
      const intentEnabled = reuseCurrent || retainedIntentPresent;
      let intentBound: Omit<CheckedCandidateExecutionIntent, "state" | "intentDigest" | "receiptDigest"> | null = null;
      let retainedIntent: CheckedCandidateExecutionIntent | null = null;
      let retainedReceipt: Awaited<ReturnType<typeof readGraphDerivedCheckReceiptForRecovery>> = null;
      if (retainedIntentPresent) {
        const initial = await currentCandidateWorkspaceForCheckRecovery(canonicalRoot, candidateDigest);
        basis = initial.basis;
        const initialValidation = graphValidation(canonicalRoot, basis, validationId);
        const initialAuthority = checkedReceiptExecutionAuthority(canonicalRoot);
        intentBound = await deriveExecutionIntent(canonicalRoot, candidateDigest, validationId, initial, initialValidation, initialAuthority);
        retainedIntent = await readExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound);
        const retainedSnapshot = await readFullyCurrentReceiptPublicationSnapshot(canonicalRoot, candidateDigest, validationId, currentCandidateWorkspaceForCheckRecovery);
        if (retainedIntent?.state === "SETTLED" && retainedSnapshot.kind !== "FINAL") refuse("CHECK_RECEIPT_PATH_UNSAFE");
        const disposition = executionIntentDisposition(retainedIntent, retainedSnapshot.receipt);
        if (disposition === "RECONCILE") {
          if (retainedIntent === null || retainedSnapshot.receipt === null) refuse("CHECK_EXECUTION_INTENT_INVALID");
          if (retainedIntent.state === "STARTED") {
            const recovered = await recoverReceiptPublication(canonicalRoot, candidateDigest, validationId, initialValidation.fixtureProcessPolicy, retainedSnapshot);
            if (recovered === null || canonicalJson(recovered) !== canonicalJson(retainedSnapshot.receipt)) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
            retainedReceipt = await readGraphDerivedCheckReceiptForRecovery(canonicalRoot, candidateDigest, validationId);
            if (retainedReceipt === null) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
            const settled = await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "SETTLED", retainedReceipt.receipt.receiptDigest, retainedIntent);
            if (settled.receiptDigest !== retainedReceipt.receipt.receiptDigest) refuse("CHECK_EXECUTION_INTENT_INVALID");
          } else {
            retainedReceipt = await readGraphDerivedCheckReceiptForRecovery(canonicalRoot, candidateDigest, validationId);
            if (retainedReceipt === null) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
          }
          await resetFocusedCheckTemporary(initial.workspace);
          const strictReadback = await readGraphDerivedCheckReceipt(canonicalRoot, candidateDigest, validationId);
          if (strictReadback === null || strictReadback.receiptPath !== retainedReceipt.receiptPath
            || canonicalJson(strictReadback.receipt) !== canonicalJson(retainedReceipt.receipt)) {
            refuse("CHECK_RECEIPT_READBACK_MISMATCH");
          }
          return { status: "pass", basis, id: validationId, exitCode: 0, ...strictReadback };
        }
        if (disposition === "UNKNOWN") {
          if (retainedIntent?.state === "STARTED") await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "UNKNOWN", null, retainedIntent);
          refuse("CHECK_EXECUTION_OUTCOME_UNKNOWN");
        }
      }
      if (reuseCurrent && !retainedIntentPresent) {
        const existing = await readGraphDerivedCheckReceipt(canonicalRoot, candidateDigest, validationId);
        if (existing !== null) {
          const current = await currentCandidateWorkspace(canonicalRoot, candidateDigest);
          basis = current.basis;
          return { status: "pass", basis, id: validationId, exitCode: 0, ...existing };
        }
        const strictInitial = await currentCandidateWorkspace(canonicalRoot, candidateDigest);
        basis = strictInitial.basis;
      }
      const workspaceBeforeAuthentication = await candidateWorkspace(canonicalRoot, candidateDigest);
      await resetFocusedCheckTemporary(workspaceBeforeAuthentication);
      const current = await currentCandidateWorkspace(canonicalRoot, candidateDigest);
      basis = current.basis;
      const { workspace } = current;
      const validation = graphValidation(canonicalRoot, basis, validationId);
      const executionAuthority = checkedReceiptExecutionAuthority(canonicalRoot);
      if (intentEnabled && intentBound === null) {
        intentBound = await deriveExecutionIntent(canonicalRoot, candidateDigest, validationId, current, validation, executionAuthority);
      }
      const publicationSnapshot = await readFullyCurrentReceiptPublicationSnapshot(canonicalRoot, candidateDigest, validationId, currentCandidateWorkspace);
      const existingReceipt = await recoverReceiptPublication(canonicalRoot, candidateDigest, validationId, validation.fixtureProcessPolicy, publicationSnapshot);
      const workspaceManifestPath = resolve(workspace, workspaceManifestName);
      const workspaceManifestBefore = await authenticatedContentFile(workspaceManifestPath, maximumWorkspaceManifestBytes, "CANDIDATE_BASIS_MISMATCH");
      const before = await candidateReceiptFacts(canonicalRoot, workspace, candidateDigest, basis);
      if (!(await authenticatedContentFile(workspaceManifestPath, maximumWorkspaceManifestBytes, "CANDIDATE_BASIS_MISMATCH")).bytes.equals(workspaceManifestBefore.bytes)) {
        refuse("CANDIDATE_BASIS_MISMATCH");
      }
      const dependencyRoots = await toolDependencyRoots();
      const temporary = resolve(workspace, ".usf-check-tmp");
      const execution = await prepareCheckExecutionView(canonicalRoot, workspace, temporary, validation.repositoryReadFiles, validation.authorityDependencyPaths);
      const baseLaunch = confinedNodeTestLaunch(execution.view, execution.runtime, dependencyRoots, validation.commandTokens);
      if (baseLaunch === null) {
        throw new CheckRefusal("CHECK_CONFINEMENT_UNAVAILABLE", "BASE_LAUNCH_UNAVAILABLE", {
          strictCommand: strictNodeTestPaths(validation.commandTokens),
          bubblewrap: trustedBubblewrap(),
          permissionFlag: process.allowedNodeEnvironmentFlags.has("--permission"),
          workspace: authenticatedOwnerDirectory(execution.view, false),
          dependencies: authenticatedConfiguredToolDependencyRoots(execution.view, dependencyRoots),
          tests: strictNodeTestPaths(validation.commandTokens)?.map(path => ({ path, exists: existsSync(resolve(execution.view, path)) })),
        });
      }
      let launch;
      if (validation.executionModeIri === "urn:usf:mode:deterministic-test-substitute") {
        if (validation.fixtureProcessPolicy !== null) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "MODE_POLICY_MISMATCH");
        launch = baseLaunch;
      } else if (validation.executionModeIri === "urn:usf:mode:confined-fixture-process:1"
        || validation.executionModeIri === "urn:usf:mode:confined-fixture-process:2") {
        if (validation.fixtureProcessPolicy === null) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "FIXTURE_POLICY_MISSING");
        if (!authenticateFixtureProcessPolicy(validation.fixtureProcessPolicy, execution.view)) {
          refuse("CHECK_CONFINEMENT_UNAVAILABLE", "FIXTURE_POLICY_AUTHENTICATION_FAILED");
        }
        launch = confinedFixtureProcessLaunch(baseLaunch, validation.fixtureProcessPolicy, execution.view);
      } else {
        refuse("CHECK_CONFINEMENT_UNAVAILABLE", "EXECUTION_MODE_UNSUPPORTED");
      }
      if (launch === null) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "FIXTURE_LAUNCH_UNAVAILABLE");
      let startedIntent: CheckedCandidateExecutionIntent | null = null;
      if (intentEnabled) {
        if (intentBound === null) refuse("CHECK_EXECUTION_INTENT_INVALID");
        let preSpawnBasis = basis;
        try {
          preSpawnBasis = await deriveCurrentRealisationBasis(canonicalRoot, basis);
          assertSameBasis(basis, preSpawnBasis);
        } catch {
          refuse("CANDIDATE_BASIS_MISMATCH");
        }
        const preSpawnManifest = await authenticatedContentFile(workspaceManifestPath, maximumWorkspaceManifestBytes, "CANDIDATE_BASIS_MISMATCH");
        if (!preSpawnManifest.bytes.equals(workspaceManifestBefore.bytes)) refuse("CANDIDATE_BASIS_MISMATCH");
        const preSpawnFacts = await candidateReceiptFacts(canonicalRoot, workspace, candidateDigest, preSpawnBasis);
        if (canonicalDigest(before) !== canonicalDigest(preSpawnFacts)) refuse("CANDIDATE_BASIS_MISMATCH");
        if (!(await authenticatedContentFile(workspaceManifestPath, maximumWorkspaceManifestBytes, "CANDIDATE_BASIS_MISMATCH")).bytes.equals(preSpawnManifest.bytes)) {
          refuse("CANDIDATE_BASIS_MISMATCH");
        }
        const preSpawnCurrent = Object.freeze({ workspace, basis: preSpawnBasis });
        const preSpawnValidation = graphValidation(canonicalRoot, preSpawnCurrent.basis, validationId);
        const preSpawnAuthority = checkedReceiptExecutionAuthority(canonicalRoot);
        const refreshedBound = await deriveExecutionIntent(canonicalRoot, candidateDigest, validationId, preSpawnCurrent, preSpawnValidation, preSpawnAuthority);
        if (canonicalJson(refreshedBound, { rejectAbsolutePaths: true }) !== canonicalJson(intentBound, { rejectAbsolutePaths: true })) {
          refuse("CHECK_EXECUTION_INTENT_INVALID");
        }
        const preparedIntent = await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "PREPARED", null, retainedIntent);
        startedIntent = await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "STARTED", null, preparedIntent);
      }
      let observation: ValidationExecutionObservation;
      try {
        observation = await executeBoundedCheck(launch.executable, launch.arguments, execution.view, executionAuthority);
        if (validation.fixtureProcessPolicy !== null && !authenticateFixtureProcessHostProfile(validation.fixtureProcessPolicy)) refuse("CHECK_CONFINEMENT_UNAVAILABLE", "HOST_PROFILE_POST_EXECUTION_FAILED");
      } catch (error) {
        if (intentBound !== null && startedIntent !== null) await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "UNKNOWN", null, startedIntent);
        throw error;
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
      const failureDiagnostic = startedIntent !== null && (observation.timedOut || !observation.outputWithinLimit || observation.exitCode !== 0)
        ? await persistFailureDiagnostic(canonicalRoot, candidateDigest, validationId, validation, startedIntent, observation)
        : null;
      // A persisted diagnostic is bound to a started execution intent, so a
      // failure observed without one used to return an exit code and nothing
      // else. That is not enough to act on: the operator cannot see whether the
      // child said anything, and the refusal is indistinguishable from every
      // other CHECK_FAILED. Carry the bounded observation itself so a failure
      // can always be read, without inventing an intent it does not have.
      const observedFailure = failureDiagnostic !== null
        || !(observation.timedOut || !observation.outputWithinLimit || observation.exitCode !== 0)
        ? null
        : Object.freeze({
            exitCode: observation.exitCode,
            timedOut: observation.timedOut,
            timeoutTerminationSignal: observation.timeoutTerminationSignal,
            outputWithinLimit: observation.outputWithinLimit,
            outputTruncated: observation.outputTruncated,
            stdoutObservedBytes: observation.stdoutObservedBytes,
            stderrObservedBytes: observation.stderrObservedBytes,
            stdoutCapturedBase64: observation.stdoutCaptured.toString("base64"),
            stderrCapturedBase64: observation.stderrCaptured.toString("base64"),
            executionIntentStarted: false,
          });
      const failureDetail = failureDiagnostic === null
        ? (observedFailure === null ? {} : { observedFailure })
        : { failureDiagnostic: failureDiagnostic.record };
      if (observation.timedOut) {
        if (intentBound !== null && startedIntent !== null) await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "UNKNOWN", null, startedIntent);
        return {
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
          ...failureDetail,
        };
      }
      if (!observation.outputWithinLimit) {
        if (intentBound !== null && startedIntent !== null) await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "UNKNOWN", null, startedIntent);
        return { status: "refused", basis, reasonCode: "CHECK_OUTPUT_LIMIT_EXCEEDED", id: validationId, exitCode: observation.exitCode,
          ...failureDetail };
      }
      if (observation.exitCode !== 0) {
        if (intentBound !== null && startedIntent !== null) await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "UNKNOWN", null, startedIntent);
        return { status: "refused", basis, reasonCode: "CHECK_FAILED", id: validationId, exitCode: observation.exitCode,
          ...failureDetail };
      }
      const authenticatedAfter = await currentCandidateWorkspace(canonicalRoot, candidateDigest);
      if (authenticatedAfter.basis.basisDigest !== basis.basisDigest) refuse("CANDIDATE_BASIS_MISMATCH");
      const after = await candidateReceiptFacts(canonicalRoot, workspace, candidateDigest, basis);
      if (canonicalDigest(before) !== canonicalDigest(after)) refuse("CANDIDATE_BASIS_MISMATCH");
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
        ...validationReceiptClaims(validation),
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
      if (intentBound !== null && startedIntent !== null) {
        const retained = await readGraphDerivedCheckReceipt(canonicalRoot, candidateDigest, validationId);
        if (retained === null || retained.receiptPath !== receiptPath
          || canonicalJson(retained.receipt) !== canonicalJson(receipt)) refuse("CHECK_RECEIPT_READBACK_MISMATCH");
        const settledCurrent = await currentCandidateWorkspace(canonicalRoot, candidateDigest);
        const settledValidation = graphValidation(canonicalRoot, settledCurrent.basis, validationId);
        const settledAuthority = checkedReceiptExecutionAuthority(canonicalRoot);
        const settledBound = await deriveExecutionIntent(canonicalRoot, candidateDigest, validationId, settledCurrent, settledValidation, settledAuthority);
        if (canonicalJson(settledBound, { rejectAbsolutePaths: true }) !== canonicalJson(intentBound, { rejectAbsolutePaths: true })) refuse("CHECK_EXECUTION_INTENT_INVALID");
        await persistExecutionIntent(canonicalRoot, candidateDigest, validationId, intentBound, "SETTLED", retained.receipt.receiptDigest, startedIntent);
      }
      return { status: "pass", basis, id: validationId, exitCode: 0, receiptPath, receipt };
    });
  } catch (error) {
    const reasonCode = error instanceof CheckRefusal ? error.reasonCode : stableReason(error) ?? "CHECK_CONFINEMENT_UNAVAILABLE";
    return { status: "refused", ...(basis === undefined ? {} : { basis }), reasonCode, id: validationId,
      ...(error instanceof CheckRefusal && error.confinementFailure !== undefined ? { confinementFailure: error.confinementFailure } : {}),
      ...(error instanceof CheckRefusal && error.details !== undefined ? { diagnosticDetails: error.details } : {}) };
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
