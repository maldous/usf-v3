import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { canonicalDigest } from "../core/canonical.ts";
import type { CatalogueModel, ModelCatalogueSnapshot } from "./catalogue.ts";

const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_AUTHORIZATION_TTL_MILLISECONDS = 5 * 60 * 1_000;
const HARD_MAX_TIMEOUT_MILLISECONDS = 60_000;
const HARD_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const HARD_MAX_AUTHORIZATION_TTL_MILLISECONDS = 15 * 60 * 1_000;
const MAX_TRUSTED_EXECUTABLE_BYTES = 256 * 1024 * 1024;
const BUBBLEWRAP_EXECUTABLE = "/usr/bin/bwrap" as const;
const CODEX_EXECUTABLE = "/usr/bin/codex" as const;
const CLAUDE_EXECUTABLE = "/usr/bin/claude" as const;
const SANDBOX_HOME = "/home/provider";
const CODEX_AUTH_RELATIVE_PATH = ".codex/auth.json";
const CLAUDE_AUTH_RELATIVE_PATH = ".claude/.credentials.json";
const CODEX_MODEL_REQUEST_ID = "usf-model-list";
const CODEX_INITIALIZE_REQUEST_ID = "usf-initialize";
const CODEX_APP_SERVER_INITIALIZE = `${JSON.stringify({ id: CODEX_INITIALIZE_REQUEST_ID, method: "initialize", params: { clientInfo: { name: "usf", title: "USF", version: "3" } } })}\n`;
const CODEX_APP_SERVER_AFTER_INITIALIZE = `${JSON.stringify({ method: "initialized" })}\n${JSON.stringify({ id: CODEX_MODEL_REQUEST_ID, method: "model/list", params: { includeHidden: true, limit: 4096 } })}\n`;

export const subscriptionHostEnvironmentPolicyDigest = canonicalDigest({
  schema: "urn:usf:subscription-host-environment-policy:1",
  executable: BUBBLEWRAP_EXECUTABLE,
  namespaces: ["user", "pid", "network"],
  root: "tmpfs",
  hostProjection: ["/usr", "/lib", "/lib64"],
  authProjection: [CODEX_AUTH_RELATIVE_PATH, CLAUDE_AUTH_RELATIVE_PATH],
  providerRootProjected: false,
  repositoryProjected: false,
  hostSocketsProjected: false,
  childEnvironment: "clearenv-fixed-metadata-only",
  scratch: "private-tmpfs",
  apiAndCloudCredentialEnvironmentForwarded: false,
  proxyEnvironmentForwarded: false,
});

export type SubscriptionHostTransport = "codex-cli-subscription" | "claude-cli-subscription";
export type CandidateDisposition = "ambiguous" | "unqualified";
export type HostFailureCode =
  | "AUTHENTICATION_NOT_CONFIRMED"
  | "COMMAND_FAILED"
  | "EXECUTABLE_NOT_FOUND"
  | "OUTPUT_BOUND_EXCEEDED"
  | "OUTPUT_INVALID"
  | "PROVIDER_AUTH_FILE_UNAVAILABLE"
  | "TIMEOUT"
  | "VERSION_INVALID";

export class SubscriptionHostContainmentError extends Error {
  readonly reasonCode: "PROVIDER_HOST_CONTAINMENT_DRIFT" | "PROVIDER_HOST_ROOT_INVALID";

  constructor(reasonCode: "PROVIDER_HOST_CONTAINMENT_DRIFT" | "PROVIDER_HOST_ROOT_INVALID") {
    super(reasonCode);
    this.name = "SubscriptionHostContainmentError";
    this.reasonCode = reasonCode;
  }
}

export class SubscriptionHostParseError extends Error {
  readonly reasonCode: "HOST_OUTPUT_INVALID" | "HOST_OUTPUT_TOO_LARGE";

  constructor(reasonCode: "HOST_OUTPUT_INVALID" | "HOST_OUTPUT_TOO_LARGE") {
    super(reasonCode);
    this.name = "SubscriptionHostParseError";
    this.reasonCode = reasonCode;
  }
}

export interface SanitizedCodexAuthentication {
  readonly authenticated: boolean;
  readonly authenticationMode: "chatgpt" | null;
  readonly subscriptionType: null;
  readonly failureCode: "AUTHENTICATION_NOT_CONFIRMED" | null;
  readonly accountIdentityRetained: false;
}

export interface SanitizedClaudeAuthentication {
  readonly authenticated: boolean;
  readonly authenticationMode: "claude.ai" | null;
  readonly apiProvider: "firstParty" | null;
  readonly subscriptionType: "present" | null;
  readonly failureCode: "AUTHENTICATION_NOT_CONFIRMED" | null;
  readonly accountIdentityRetained: false;
}

export interface CatalogueMetadataJoin {
  readonly source: "models.dev/api.json";
  readonly rawDigest: `sha256:${string}`;
  readonly normalizedDigest: `sha256:${string}`;
  readonly route: { readonly provider: string; readonly model: string };
  readonly model: CatalogueModel;
}

export interface SubscriptionHostModelCandidate {
  readonly kind: "alias" | "model";
  readonly transport: SubscriptionHostTransport;
  readonly provider: "claude-cli" | "codex-cli";
  readonly catalogueProvider: "anthropic" | "openai";
  readonly model: string;
  readonly hostRowIndex: number | null;
  readonly displayName: string | null;
  readonly visibility: "hidden" | "not-enumerated-by-host" | "visible";
  readonly source: "codex-app-server-model-list" | "claude-cli-help-alias" | "models.dev/api.json";
  readonly discoveryDisposition:
    | "hidden-unverified"
    | "unverified-non-exhaustive"
    | "visible-unverified";
  readonly disposition: CandidateDisposition;
  readonly availability: "unknown";
  readonly entitlement: "unknown";
  readonly qualification: "unqualified";
  readonly apiCompatibilityReportedByHost: boolean | null;
  readonly catalogueMatch: "exact" | "none";
  readonly catalogue: CatalogueMetadataJoin | null;
}

export interface ProviderHostAuthorization {
  readonly schema: "urn:usf:provider-host-authorization:1";
  readonly version: 1;
  readonly transport: SubscriptionHostTransport;
  readonly provider: "claude-cli" | "codex-cli";
  readonly catalogueProvider: "anthropic" | "openai";
  readonly executable: string;
  readonly executableVersion: string;
  readonly authenticationDigest: `sha256:${string}`;
  readonly modelSurfaceDigest: `sha256:${string}`;
  readonly modelSurfaceCompleteness:
    | "bounded-union-not-live-entitlement"
    | "frozen-catalogue-only-not-live-entitlement"
    | "non-exhaustive";
  readonly environmentPolicyDigest: `sha256:${string}`;
  readonly containmentDigest: `sha256:${string}`;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly scope: "host-status-and-model-census";
  readonly inferenceAuthorized: false;
  readonly fallbackProhibited: true;
  readonly apiAndCloudCredentialEnvironmentForwarded: false;
  readonly authorizationDisposition: "authorized";
  readonly digest: `sha256:${string}`;
}

export interface SubscriptionHostObservation {
  readonly schema: "urn:usf:subscription-host-observation:1";
  readonly version: 1;
  readonly transport: SubscriptionHostTransport;
  readonly provider: "claude-cli" | "codex-cli";
  readonly catalogueProvider: "anthropic" | "openai";
  readonly executable: string;
  readonly executableVersion: string | null;
  readonly observedAt: string;
  readonly status: "authenticated" | "unauthenticated" | "unavailable";
  readonly failureCode: HostFailureCode | null;
  readonly authentication: SanitizedCodexAuthentication | SanitizedClaudeAuthentication;
  readonly authorization: ProviderHostAuthorization | null;
  readonly candidateSurface: "bounded-union" | "frozen-catalogue-only" | "non-exhaustive";
  readonly candidates: readonly SubscriptionHostModelCandidate[];
  readonly apiAndCloudCredentialEnvironmentForwarded: false;
  readonly nonclaims: readonly string[];
  readonly digest: `sha256:${string}`;
}

export interface HostCommandResult {
  readonly stdout: string;
}

export interface HostCommandInput {
  readonly initial: string;
  readonly afterResponse: Readonly<{ responseId: string; input: string }> | null;
}

export type HostCommandRunner = (
  executable: typeof BUBBLEWRAP_EXECUTABLE,
  arguments_: readonly string[],
  options: Readonly<{ environment: Readonly<Record<string, never>>; timeoutMilliseconds: number; maxOutputBytes: number; stdin: HostCommandInput | null }>,
) => Promise<HostCommandResult>;

export interface SubscriptionHostObservationOptions {
  readonly catalogue: ModelCatalogueSnapshot;
  readonly providerRoot: string;
  readonly observedAt?: string;
  readonly timeoutMilliseconds?: number;
  readonly maxOutputBytes?: number;
  readonly authorizationTtlMilliseconds?: number;
  readonly runner?: HostCommandRunner;
  readonly systemIdentityObserver?: TrustedSystemIdentityObserver;
}

export interface SubscriptionHostCensusOptions {
  readonly providerRoot: string;
  readonly now?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly authorizationTtlMilliseconds?: number;
  readonly runner?: HostCommandRunner;
  readonly systemIdentityObserver?: TrustedSystemIdentityObserver;
}

export interface SubscriptionHostCensus {
  readonly schema: "urn:usf:subscription-host-census:1";
  readonly version: 1;
  readonly source: {
    readonly modelsDevRawDigest: `sha256:${string}`;
    readonly modelsDevNormalizedDigest: `sha256:${string}`;
    readonly codexModelSurface:
      | "frozen-modelsdev-only-app-server-unavailable"
      | "no-network-app-server-complete-page-union-frozen-modelsdev-not-live-entitlement"
      | "no-network-app-server-partial-union-frozen-modelsdev-not-live-entitlement";
    readonly claudeModelSurface:
      | "frozen-modelsdev-only-cli-help-unavailable"
      | "no-network-installed-cli-help-aliases-union-frozen-modelsdev-non-exhaustive";
  };
  readonly hosts: readonly SubscriptionHostObservation[];
  readonly candidates: readonly SubscriptionHostModelCandidate[];
  readonly authorizations: readonly ProviderHostAuthorization[];
  readonly denominators: {
    readonly hostTransports: number;
    readonly authenticatedHosts: number;
    readonly candidateRecords: number;
    readonly modelCandidates: number;
    readonly aliasCandidates: number;
    readonly hostEnumeratedCandidates: number;
    readonly catalogueOnlyCandidates: number;
    readonly exactCatalogueMatches: number;
    readonly unmatchedCandidates: number;
    readonly authorizations: number;
  };
  readonly nonclaims: readonly string[];
  readonly digest: `sha256:${string}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedRaw(raw: string, maximum: number): string {
  if (Buffer.byteLength(raw, "utf8") > maximum) throw new SubscriptionHostParseError("HOST_OUTPUT_TOO_LARGE");
  return raw;
}

function token(value: unknown, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\s\\\u0000-\u001f\u007f]/u.test(value)) {
    throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  }
  return value;
}

function safeText(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  }
  return value;
}

function strictInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(value).toISOString() !== value) {
    throw new Error("HOST_OBSERVATION_TIME_INVALID");
  }
  return value;
}

function positiveBound(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) throw new Error(`${name}_INVALID`);
  return resolved;
}

interface FileIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

interface ProviderStateBoundary {
  readonly root: FileIdentity;
  readonly codexAuthParent: FileIdentity | null;
  readonly codexAuth: FileIdentity | null;
  readonly claudeAuthParent: FileIdentity | null;
  readonly claudeAuth: FileIdentity | null;
  readonly membershipSources: readonly FileIdentity[];
}

interface ConfinedMetadataCommand {
  readonly executable: typeof CODEX_EXECUTABLE | typeof CLAUDE_EXECUTABLE;
  readonly arguments: readonly string[];
  readonly stdin: HostCommandInput | null;
  readonly auth: "codex" | "claude";
}

const confinedEnvironment = Object.freeze({
    CLAUDE_CONFIG_DIR: `${SANDBOX_HOME}/.claude`,
    CODEX_HOME: `${SANDBOX_HOME}/.codex`,
    HOME: SANDBOX_HOME,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    PATH: "/usr/bin",
    TERM: "dumb",
    TMPDIR: "/tmp",
  });

export function scrubbedSubscriptionHostEnvironment(): NodeJS.ProcessEnv {
  return confinedEnvironment;
}

function currentIds(): { readonly uid: number; readonly gid: number } {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  return { uid: process.getuid(), gid: process.getgid() };
}

function identity(path: string, entry: Stats): FileIdentity {
  return Object.freeze({ path, dev: entry.dev, ino: entry.ino, uid: entry.uid, gid: entry.gid, mode: entry.mode,
    nlink: entry.nlink, size: entry.size, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs });
}

function exclusiveCurrentPrimaryGroupSources(): readonly FileIdentity[] {
  const paths = ["/etc/passwd", "/etc/group"] as const;
  const before = paths.map((path) => {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.uid !== 0 || entry.gid !== 0 || (entry.mode & 0o022) !== 0) {
      throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
    }
    return identity(path, entry);
  });
  const passwd = readFileSync(paths[0], "utf8");
  const group = readFileSync(paths[1], "utf8");
  if (before.some((source) => !sameIdentity(source))) throw new SubscriptionHostContainmentError("PROVIDER_HOST_CONTAINMENT_DRIFT");
  const { uid, gid } = currentIds();
  const users = passwd.split("\n").filter(Boolean).map((line) => line.split(":"));
  const currentUsers = users.filter((fields) => Number(fields[2]) === uid && Number(fields[3]) === gid);
  const primaryUsers = users.filter((fields) => Number(fields[3]) === gid);
  const groups = group.split("\n").filter(Boolean).map((line) => line.split(":"))
    .filter((fields) => Number(fields[2]) === gid);
  const currentName = currentUsers[0]?.[0];
  const explicitMembers = (groups[0]?.[3] ?? "").split(",").filter(Boolean);
  if (currentUsers.length !== 1 || primaryUsers.length !== 1 || groups.length !== 1 || currentName === undefined
    || explicitMembers.some((member) => member !== currentName)) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  return Object.freeze(before);
}

function exactOwnerControlledDirectory(path: string, required: boolean, groupIsExclusive: boolean): FileIdentity | null {
  let entry: Stats;
  try { entry = lstatSync(path); }
  catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  const ids = currentIds();
  const permissions = entry.mode & 0o7777;
  if (entry.isSymbolicLink() || !entry.isDirectory() || entry.uid !== ids.uid || entry.gid !== ids.gid
    || entry.nlink < 2 || (permissions & 0o700) !== 0o700 || (permissions & 0o002) !== 0
    || ((permissions & 0o020) !== 0 && !groupIsExclusive) || (permissions & 0o7000) !== 0
    || realpathSync(path) !== path) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  return identity(path, entry);
}

function exactPrivateAuthFile(root: string, relativePath: string, groupIsExclusive: boolean): Readonly<{ parent: FileIdentity; auth: FileIdentity }> | null {
  const path = resolve(root, relativePath);
  const parent = resolve(path, "..");
  const parentIdentity = exactOwnerControlledDirectory(parent, false, groupIsExclusive);
  if (parentIdentity === null) return null;
  let entry: Stats;
  try { entry = lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  const ids = currentIds();
  if (entry.isSymbolicLink() || !entry.isFile() || entry.uid !== ids.uid || entry.gid !== ids.gid
    || entry.nlink !== 1 || (entry.mode & 0o7777) !== 0o600 || realpathSync(path) !== path) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  return Object.freeze({ parent: parentIdentity, auth: identity(path, entry) });
}

function directoryHasGroupWrite(path: string): boolean {
  try {
    const entry = lstatSync(path);
    return !entry.isSymbolicLink() && entry.isDirectory() && (entry.mode & 0o020) !== 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
}

function authenticateProviderStateRoot(providerRoot: string): ProviderStateBoundary {
  if (!isAbsolute(providerRoot) || providerRoot === "/" || providerRoot.endsWith("/") || providerRoot.length > 4_096
    || /(?:^|\/)\.\.?(?:\/|$)|[\u0000-\u001f\u007f]/u.test(providerRoot)) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  const authParents = [resolve(providerRoot, CODEX_AUTH_RELATIVE_PATH, ".."), resolve(providerRoot, CLAUDE_AUTH_RELATIVE_PATH, "..")];
  const groupProofRequired = [providerRoot, ...authParents].some(directoryHasGroupWrite);
  const membershipSources = groupProofRequired ? exclusiveCurrentPrimaryGroupSources() : Object.freeze([]);
  const root = exactOwnerControlledDirectory(providerRoot, true, groupProofRequired);
  if (root === null) throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  const codex = exactPrivateAuthFile(providerRoot, CODEX_AUTH_RELATIVE_PATH, groupProofRequired);
  const claude = exactPrivateAuthFile(providerRoot, CLAUDE_AUTH_RELATIVE_PATH, groupProofRequired);
  return Object.freeze({
    root,
    codexAuthParent: codex?.parent ?? null,
    codexAuth: codex?.auth ?? null,
    claudeAuthParent: claude?.parent ?? null,
    claudeAuth: claude?.auth ?? null,
    membershipSources,
  });
}

function sameIdentity(expected: FileIdentity): boolean {
  try {
    const current = lstatSync(expected.path);
    return !current.isSymbolicLink() && realpathSync(expected.path) === expected.path
      && current.dev === expected.dev && current.ino === expected.ino && current.uid === expected.uid && current.gid === expected.gid
      && current.mode === expected.mode && current.nlink === expected.nlink && current.size === expected.size
      && current.mtimeMs === expected.mtimeMs && current.ctimeMs === expected.ctimeMs;
  } catch { return false; }
}

function assertBoundaryCurrent(boundary: ProviderStateBoundary, auth: FileIdentity): void {
  const parent = auth.path.endsWith(CODEX_AUTH_RELATIVE_PATH) ? boundary.codexAuthParent : boundary.claudeAuthParent;
  if (!sameIdentity(boundary.root) || parent === null || !sameIdentity(parent) || !sameIdentity(auth)
    || boundary.membershipSources.some((source) => !sameIdentity(source))) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_CONTAINMENT_DRIFT");
  }
}

function metadataIdentity(value: FileIdentity): Readonly<Record<string, number>> {
  return Object.freeze({ dev: value.dev, ino: value.ino, uid: value.uid, gid: value.gid, mode: value.mode,
    nlink: value.nlink, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs });
}

export type TrustedSystemIdentityMode = "executable" | "projection" | "regular";
export interface TrustedSystemIdentity {
  readonly currentness: Readonly<Record<string, unknown>>;
  readonly bytesDigest: `sha256:${string}` | null;
}
export type TrustedSystemIdentityObserver = (
  path: string,
  mode: TrustedSystemIdentityMode,
  includeBytes: boolean,
) => TrustedSystemIdentity;

function boundedExecutableDigest(path: string, expected: Stats): `sha256:${string}` {
  if (!expected.isFile() || expected.size < 1 || expected.size > MAX_TRUSTED_EXECUTABLE_BYTES) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  const descriptor = openSync(path, "r");
  try {
    const before = fstatSync(descriptor);
    if (before.dev !== expected.dev || before.ino !== expected.ino || before.size !== expected.size
      || before.mtimeMs !== expected.mtimeMs || before.ctimeMs !== expected.ctimeMs) {
      throw new SubscriptionHostContainmentError("PROVIDER_HOST_CONTAINMENT_DRIFT");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > MAX_TRUSTED_EXECUTABLE_BYTES) throw new SubscriptionHostContainmentError("PROVIDER_HOST_CONTAINMENT_DRIFT");
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    if (total !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new SubscriptionHostContainmentError("PROVIDER_HOST_CONTAINMENT_DRIFT");
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    closeSync(descriptor);
  }
}

const trustedSystemIdentity: TrustedSystemIdentityObserver = (path, mode, includeBytes) => {
  try {
    const link = lstatSync(path);
    const realPath = realpathSync(path);
    const target = lstatSync(realPath);
    if (link.uid !== 0 || link.gid !== 0 || target.uid !== 0 || target.gid !== 0 || (target.mode & 0o022) !== 0
      || (mode === "regular" && (!target.isFile() || link.isSymbolicLink()))
      || (mode === "executable" && !target.isFile())
      || (mode === "projection" && !target.isFile() && !target.isDirectory())
      || (!link.isSymbolicLink() && (link.mode & 0o022) !== 0)) {
      throw new Error("untrusted");
    }
    return Object.freeze({
      currentness: Object.freeze({ path, realPath, link: metadataIdentity(identity(path, link)), target: metadataIdentity(identity(realPath, target)) }),
      bytesDigest: includeBytes && target.isFile()
        // This is one bounded census-time capture per host executable, never an
        // inference-path operation, so it cannot serialize provider execution.
        ? boundedExecutableDigest(realPath, target)
        : null,
    });
  } catch {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
};

interface TrustedSystemClosure {
  readonly bubblewrap: TrustedSystemIdentity;
  readonly executable: TrustedSystemIdentity;
  readonly projections: readonly TrustedSystemIdentity[];
}

function observeSystemClosure(
  executable: typeof CODEX_EXECUTABLE | typeof CLAUDE_EXECUTABLE,
  observer: TrustedSystemIdentityObserver,
  includeBytes: boolean,
): TrustedSystemClosure {
  return deepFreeze({
    bubblewrap: observer(BUBBLEWRAP_EXECUTABLE, "regular", includeBytes),
    executable: observer(executable, "executable", includeBytes),
    projections: ["/usr", "/lib", "/lib64"].map((path) => observer(path, "projection", false)),
  });
}

function systemClosureCurrentnessDigest(closure: TrustedSystemClosure): `sha256:${string}` {
  return canonicalDigest({
    bubblewrap: closure.bubblewrap.currentness,
    executable: closure.executable.currentness,
    projections: closure.projections.map((identity) => identity.currentness),
  });
}

function assertSystemClosureCurrent(
  expected: TrustedSystemClosure,
  executable: typeof CODEX_EXECUTABLE | typeof CLAUDE_EXECUTABLE,
  observer: TrustedSystemIdentityObserver,
): void {
  if (systemClosureCurrentnessDigest(observeSystemClosure(executable, observer, false)) !== systemClosureCurrentnessDigest(expected)) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_CONTAINMENT_DRIFT");
  }
}

export interface ConfinedSubscriptionHostLaunch {
  readonly executable: typeof BUBBLEWRAP_EXECUTABLE;
  readonly arguments: readonly string[];
  readonly stdin: HostCommandInput | null;
}

function authFor(boundary: ProviderStateBoundary, auth: "codex" | "claude"): FileIdentity | null {
  return auth === "codex" ? boundary.codexAuth : boundary.claudeAuth;
}

export function confinedSubscriptionHostLaunch(
  boundary: ProviderStateBoundary,
  command: ConfinedMetadataCommand,
  systemIdentityObserver: TrustedSystemIdentityObserver = trustedSystemIdentity,
): ConfinedSubscriptionHostLaunch {
  observeSystemClosure(command.executable, systemIdentityObserver, true);
  return buildConfinedSubscriptionHostLaunch(boundary, command);
}

function buildConfinedSubscriptionHostLaunch(
  boundary: ProviderStateBoundary,
  command: ConfinedMetadataCommand,
): ConfinedSubscriptionHostLaunch {
  const auth = authFor(boundary, command.auth);
  if (auth === null) throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  assertBoundaryCurrent(boundary, auth);
  const destination = command.auth === "codex"
    ? `${SANDBOX_HOME}/${CODEX_AUTH_RELATIVE_PATH}` : `${SANDBOX_HOME}/${CLAUDE_AUTH_RELATIVE_PATH}`;
  const arguments_ = Object.freeze([
    "--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent",
    "--tmpfs", "/",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--proc", "/proc", "--dev", "/dev",
    "--dir", "/home", "--dir", SANDBOX_HOME,
    "--dir", `${SANDBOX_HOME}/.codex`, "--dir", `${SANDBOX_HOME}/.claude`,
    "--ro-bind", auth.path, destination,
    "--tmpfs", "/tmp", "--chdir", "/tmp", "--clearenv",
    ...Object.entries(confinedEnvironment).sort(([left], [right]) => compareCodeUnits(left, right))
      .flatMap(([name, value]) => ["--setenv", name, value]),
    "--", command.executable, ...command.arguments,
  ]);
  return Object.freeze({ executable: BUBBLEWRAP_EXECUTABLE, arguments: arguments_, stdin: command.stdin });
}

function hostContainmentDigest(
  boundary: ProviderStateBoundary,
  commands: readonly ConfinedMetadataCommand[],
  systemClosure: TrustedSystemClosure,
): `sha256:${string}` {
  const auth = authFor(boundary, commands[0]!.auth);
  if (auth === null || commands.some((command) => command.auth !== commands[0]!.auth)) {
    throw new SubscriptionHostContainmentError("PROVIDER_HOST_ROOT_INVALID");
  }
  const launches = commands.map((command) => buildConfinedSubscriptionHostLaunch(boundary, command));
  return canonicalDigest({
    providerRootPathDigest: canonicalDigest(boundary.root.path),
    providerRootIdentity: metadataIdentity(boundary.root),
    authParentIdentity: metadataIdentity(commands[0]!.auth === "codex" ? boundary.codexAuthParent! : boundary.claudeAuthParent!),
    authFileIdentity: metadataIdentity(auth),
    authFileRelativePath: commands[0]!.auth === "codex" ? CODEX_AUTH_RELATIVE_PATH : CLAUDE_AUTH_RELATIVE_PATH,
    bubblewrapIdentity: systemClosure.bubblewrap,
    executableIdentity: systemClosure.executable,
    systemProjectionIdentities: systemClosure.projections,
    membershipSourceIdentities: boundary.membershipSources.map(metadataIdentity),
    commandClosure: launches.map((launch) => ({ argumentsDigest: canonicalDigest(launch.arguments), stdinProtocolDigest: launch.stdin === null ? null : canonicalDigest(launch.stdin) })),
    environmentPolicyDigest: subscriptionHostEnvironmentPolicyDigest,
  });
}

export function parseCodexLoginStatus(raw: string): SanitizedCodexAuthentication {
  const authenticated = boundedRaw(raw, 4_096).trim() === "Logged in using ChatGPT";
  return deepFreeze({
    authenticated,
    authenticationMode: authenticated ? "chatgpt" : null,
    subscriptionType: null,
    failureCode: authenticated ? null : "AUTHENTICATION_NOT_CONFIRMED",
    accountIdentityRetained: false,
  });
}

export function parseClaudeAuthStatus(raw: string): SanitizedClaudeAuthentication {
  let parsed: unknown;
  try {
    parsed = JSON.parse(boundedRaw(raw, 64 * 1024));
  } catch (error) {
    if (error instanceof SubscriptionHostParseError) throw error;
    throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  }
  if (!isRecord(parsed)) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  const subscriptionPresent = typeof parsed.subscriptionType === "string" && /^[A-Za-z0-9._-]{1,64}$/u.test(parsed.subscriptionType);
  const authenticated = parsed.loggedIn === true
    && parsed.authMethod === "claude.ai"
    && parsed.apiProvider === "firstParty"
    && subscriptionPresent;
  return deepFreeze({
    authenticated,
    authenticationMode: authenticated ? "claude.ai" : null,
    apiProvider: authenticated ? "firstParty" : null,
    subscriptionType: authenticated ? "present" : null,
    failureCode: authenticated ? null : "AUTHENTICATION_NOT_CONFIRMED",
    accountIdentityRetained: false,
  });
}

export function parseCodexVersion(raw: string): string {
  const value = boundedRaw(raw, 4_096).trim();
  if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(value)) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  return value;
}

export function parseClaudeVersion(raw: string): string {
  const value = boundedRaw(raw, 4_096).trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)? \(Claude Code\)$/u.test(value)) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  return value;
}

function exactCatalogueJoin(snapshot: ModelCatalogueSnapshot, provider: string, model: string): CatalogueMetadataJoin | null {
  const providerEntry = snapshot.providers.find((entry) => entry.providerRoute === provider);
  const modelEntry = providerEntry?.models.find((entry) => entry.route.provider === provider && entry.route.model === model);
  if (modelEntry === undefined) return null;
  return deepFreeze({
    source: "models.dev/api.json",
    rawDigest: snapshot.rawDigest,
    normalizedDigest: snapshot.normalizedDigest,
    route: { provider, model },
    model: modelEntry,
  });
}

export interface ParsedCodexAppServerModelSurface {
  readonly candidates: readonly SubscriptionHostModelCandidate[];
  readonly complete: boolean;
}

export function parseCodexAppServerModelSurface(
  raw: string,
  snapshot: ModelCatalogueSnapshot,
  maximumBytes = DEFAULT_MAX_OUTPUT_BYTES,
): ParsedCodexAppServerModelSurface {
  const lines = boundedRaw(raw, maximumBytes).split("\n").filter((line) => line.length > 0);
  if (lines.length === 0 || lines.length > 4_096) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  const documents = lines.map((line) => {
    try { return JSON.parse(line) as unknown; }
    catch { throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID"); }
  });
  const responses = documents.filter((entry): entry is Record<string, unknown> => isRecord(entry) && entry.id === CODEX_MODEL_REQUEST_ID);
  if (responses.length !== 1) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  const resultValue = responses[0]!["result"];
  if (!isRecord(resultValue)) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  const result = resultValue;
  if (!Array.isArray(result.data)) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  const complete = result.nextCursor === null || result.nextCursor === undefined;
  if (!complete) token(result.nextCursor);
  if (result.data.length > 4_096) throw new SubscriptionHostParseError("HOST_OUTPUT_TOO_LARGE");
  const rows = result.data.map((entry, index) => {
    if (!isRecord(entry)) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
    const model = token(entry.model);
    token(entry.id);
    const displayName = safeText(entry.displayName);
    if (typeof entry.hidden !== "boolean") throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
    return { index, model, displayName, hidden: entry.hidden } as const;
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.model, (counts.get(row.model) ?? 0) + 1);
  const hostCandidates = [...new Map(rows.map((row) => [row.model, row] as const)).values()].map((row) => {
    const catalogue = exactCatalogueJoin(snapshot, "openai", row.model);
    return {
      kind: "model" as const,
      transport: "codex-cli-subscription" as const,
      provider: "codex-cli" as const,
      catalogueProvider: "openai" as const,
      model: row.model,
      hostRowIndex: row.index,
      displayName: row.displayName,
      visibility: row.hidden ? "hidden" as const : "visible" as const,
      source: "codex-app-server-model-list" as const,
      discoveryDisposition: row.hidden ? "hidden-unverified" as const : "visible-unverified" as const,
      disposition: counts.get(row.model) === 1 ? "unqualified" as const : "ambiguous" as const,
      availability: "unknown" as const,
      entitlement: "unknown" as const,
      qualification: "unqualified" as const,
      apiCompatibilityReportedByHost: null,
      catalogueMatch: catalogue === null ? "none" as const : "exact" as const,
      catalogue,
    };
  });
  const hostModelIds = new Set(hostCandidates.map((candidate) => candidate.model));
  const catalogueOnly = codexCatalogueCandidates(snapshot)
    .filter((candidate) => !hostModelIds.has(candidate.model));
  return deepFreeze({
    candidates: [...hostCandidates, ...catalogueOnly].sort((left, right) => compareCodeUnits(left.model, right.model)),
    complete,
  });
}

export function parseCodexAppServerModels(
  raw: string,
  snapshot: ModelCatalogueSnapshot,
  maximumBytes = DEFAULT_MAX_OUTPUT_BYTES,
): readonly SubscriptionHostModelCandidate[] {
  return parseCodexAppServerModelSurface(raw, snapshot, maximumBytes).candidates;
}

function codexCatalogueCandidates(snapshot: ModelCatalogueSnapshot): readonly SubscriptionHostModelCandidate[] {
  const candidates = (snapshot.providers.find((entry) => entry.providerRoute === "openai")?.models ?? [])
    .map((model): SubscriptionHostModelCandidate => ({
      kind: "model",
      transport: "codex-cli-subscription",
      provider: "codex-cli",
      catalogueProvider: "openai",
      model: model.route.model,
      hostRowIndex: null,
      displayName: model.name,
      visibility: "not-enumerated-by-host",
      source: "models.dev/api.json",
      discoveryDisposition: "unverified-non-exhaustive",
      disposition: "unqualified",
      availability: "unknown",
      entitlement: "unknown",
      qualification: "unqualified",
      apiCompatibilityReportedByHost: null,
      catalogueMatch: "exact",
      catalogue: exactCatalogueJoin(snapshot, "openai", model.route.model),
    }));
  return deepFreeze(candidates.sort((left, right) => compareCodeUnits(left.model, right.model)));
}

export function parseClaudeHelpAliases(raw: string): readonly string[] {
  const normalized = boundedRaw(raw, 256 * 1024).replaceAll("\r\n", "\n");
  const modelOption = normalized.indexOf("--model <model>");
  if (modelOption < 0 || normalized.indexOf("--model <model>", modelOption + 1) >= 0) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  const fullName = normalized.indexOf("or a\n", modelOption);
  const fullNameContinuation = fullName < 0 ? -1 : normalized.indexOf("model's full name", fullName);
  if (fullName < 0 || fullNameContinuation < 0 || fullNameContinuation - modelOption > 2_048) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  const aliasText = normalized.slice(modelOption, fullName);
  const aliases = [...aliasText.matchAll(/'([a-z][a-z0-9-]{0,63})'/gu)].map((match) => match[1]!);
  if (aliases.length === 0 || aliases.length > 16 || new Set(aliases).size !== aliases.length) throw new SubscriptionHostParseError("HOST_OUTPUT_INVALID");
  return Object.freeze(aliases.sort(compareCodeUnits));
}

export function claudeSubscriptionCandidates(snapshot: ModelCatalogueSnapshot, aliases: readonly string[] = []): readonly SubscriptionHostModelCandidate[] {
  const provider = snapshot.providers.find((entry) => entry.providerRoute === "anthropic");
  const models = (provider?.models ?? []).map((model): SubscriptionHostModelCandidate => ({
    kind: "model",
    transport: "claude-cli-subscription",
    provider: "claude-cli",
    catalogueProvider: "anthropic",
    model: model.route.model,
    hostRowIndex: null,
    displayName: model.name,
    visibility: "not-enumerated-by-host",
    source: "models.dev/api.json",
    discoveryDisposition: "unverified-non-exhaustive",
    disposition: "unqualified",
    availability: "unknown",
    entitlement: "unknown",
    qualification: "unqualified",
    apiCompatibilityReportedByHost: null,
    catalogueMatch: "exact",
    catalogue: exactCatalogueJoin(snapshot, "anthropic", model.route.model),
  }));
  const aliasCandidates = aliases.map((model): SubscriptionHostModelCandidate => ({
    kind: "alias",
    transport: "claude-cli-subscription",
    provider: "claude-cli",
    catalogueProvider: "anthropic",
    model,
    hostRowIndex: null,
    displayName: null,
    visibility: "not-enumerated-by-host",
    source: "claude-cli-help-alias",
    discoveryDisposition: "unverified-non-exhaustive",
    disposition: "unqualified",
    availability: "unknown",
    entitlement: "unknown",
    qualification: "unqualified",
    apiCompatibilityReportedByHost: null,
    catalogueMatch: "none",
    catalogue: null,
  }));
  return deepFreeze([...models, ...aliasCandidates].sort((left, right) =>
    compareCodeUnits(left.kind, right.kind) || compareCodeUnits(left.model, right.model),
  ));
}

function authorization(
  transport: SubscriptionHostTransport,
  provider: "claude-cli" | "codex-cli",
  catalogueProvider: "anthropic" | "openai",
  executable: string,
  executableVersion: string,
  authentication: SanitizedCodexAuthentication | SanitizedClaudeAuthentication,
  candidateSurface: "bounded-union" | "frozen-catalogue-only" | "non-exhaustive",
  candidates: readonly SubscriptionHostModelCandidate[],
  containmentDigest: `sha256:${string}`,
  observedAt: string,
  ttlMilliseconds: number,
): ProviderHostAuthorization | null {
  if (!authentication.authenticated) return null;
  const basis = deepFreeze({
    schema: "urn:usf:provider-host-authorization:1" as const,
    version: 1 as const,
    transport,
    provider,
    catalogueProvider,
    executable,
    executableVersion,
    authenticationDigest: canonicalDigest(authentication),
    modelSurfaceDigest: canonicalDigest({ candidateSurface, candidates }),
    modelSurfaceCompleteness: candidateSurface === "bounded-union"
      ? "bounded-union-not-live-entitlement" as const
      : candidateSurface === "frozen-catalogue-only"
        ? "frozen-catalogue-only-not-live-entitlement" as const
        : "non-exhaustive" as const,
    environmentPolicyDigest: subscriptionHostEnvironmentPolicyDigest,
    containmentDigest,
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + ttlMilliseconds).toISOString(),
    scope: "host-status-and-model-census" as const,
    inferenceAuthorized: false as const,
    fallbackProhibited: true as const,
    apiAndCloudCredentialEnvironmentForwarded: false as const,
    authorizationDisposition: "authorized" as const,
  });
  return deepFreeze({ ...basis, digest: canonicalDigest(basis) });
}

function classifyCommandFailure(error: unknown): HostFailureCode {
  const candidate = error as { code?: unknown; killed?: unknown; signal?: unknown; message?: unknown };
  if (candidate.code === "ENOENT") return "EXECUTABLE_NOT_FOUND";
  if (candidate.code === "EAUTHFILE") return "PROVIDER_AUTH_FILE_UNAVAILABLE";
  if (candidate.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || String(candidate.message ?? "").includes("maxBuffer")) return "OUTPUT_BOUND_EXCEEDED";
  if (candidate.killed === true || candidate.signal === "SIGTERM" || candidate.signal === "SIGKILL") return "TIMEOUT";
  return "COMMAND_FAILED";
}

const defaultRunner: HostCommandRunner = (executable, arguments_, options) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...arguments_], { env: options.environment, stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  let outputBytes = 0;
  let settled = false;
  let protocolBuffer = "";
  const followUp = options.stdin?.afterResponse ?? null;
  let followUpSent = followUp === null;
  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error !== undefined) reject(error);
    else resolve({ stdout: Buffer.concat(stdout).toString("utf8") });
  };
  const observeProtocol = (chunk: Buffer): void => {
    if (followUpSent || followUp === null) return;
    protocolBuffer += chunk.toString("utf8");
    for (;;) {
      const lineEnd = protocolBuffer.indexOf("\n");
      if (lineEnd < 0) break;
      const line = protocolBuffer.slice(0, lineEnd);
      protocolBuffer = protocolBuffer.slice(lineEnd + 1);
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (isRecord(parsed) && parsed.id === followUp.responseId) {
        if (!isRecord(parsed.result) || parsed.error !== undefined) {
          child.kill("SIGKILL");
          finish(new SubscriptionHostParseError("HOST_OUTPUT_INVALID"));
          return;
        }
        followUpSent = true;
        child.stdin.end(followUp.input);
        return;
      }
    }
  };
  const bounded = (chunk: Buffer, retain: boolean): void => {
    outputBytes += chunk.length;
    if (outputBytes > options.maxOutputBytes) {
      child.kill("SIGKILL");
      finish(Object.assign(new Error("bounded provider-host output exceeded"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));
    } else if (retain) {
      stdout.push(chunk);
      observeProtocol(chunk);
    }
  };
  child.stdout.on("data", (chunk: Buffer) => bounded(chunk, true));
  child.stderr.on("data", (chunk: Buffer) => bounded(chunk, false));
  child.stdin.on("error", (error) => {
    child.kill("SIGKILL");
    finish(error);
  });
  child.once("error", (error) => finish(error));
  child.once("close", (code, signal) => {
    if (settled) return;
    if (!followUpSent) finish(new SubscriptionHostParseError("HOST_OUTPUT_INVALID"));
    else if (code === 0 && signal === null) finish();
    else finish(Object.assign(new Error("confined provider-host command failed"), { code, signal }));
  });
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish(Object.assign(new Error("confined provider-host command timed out"), { killed: true, signal: "SIGKILL" }));
  }, options.timeoutMilliseconds);
  if (options.stdin === null) child.stdin.end();
  else if (options.stdin.afterResponse === null) child.stdin.end(options.stdin.initial);
  else child.stdin.write(options.stdin.initial);
});

async function runConfinedMetadataCommand(
  boundary: ProviderStateBoundary,
  command: ConfinedMetadataCommand,
  runner: HostCommandRunner,
  timeoutMilliseconds: number,
  maxOutputBytes: number,
  systemIdentityObserver: TrustedSystemIdentityObserver,
  systemClosure: TrustedSystemClosure,
): Promise<HostCommandResult> {
  const auth = authFor(boundary, command.auth);
  if (auth === null) throw Object.assign(new Error("recognized provider auth file unavailable"), { code: "EAUTHFILE" });
  assertBoundaryCurrent(boundary, auth);
  assertSystemClosureCurrent(systemClosure, command.executable, systemIdentityObserver);
  const launch = buildConfinedSubscriptionHostLaunch(boundary, command);
  const result = await runner(launch.executable, launch.arguments, {
    environment: Object.freeze({}), timeoutMilliseconds, maxOutputBytes, stdin: launch.stdin,
  });
  assertBoundaryCurrent(boundary, auth);
  assertSystemClosureCurrent(systemClosure, command.executable, systemIdentityObserver);
  return result;
}

function observation<T extends Omit<SubscriptionHostObservation, "digest">>(basis: T): SubscriptionHostObservation {
  return deepFreeze({ ...basis, digest: canonicalDigest(basis) });
}

async function observeCodex(options: SubscriptionHostObservationOptions): Promise<SubscriptionHostObservation> {
  return observeHost(options, "codex-cli-subscription", "codex-cli", "openai", CODEX_EXECUTABLE);
}

async function observeClaude(options: SubscriptionHostObservationOptions): Promise<SubscriptionHostObservation> {
  return observeHost(options, "claude-cli-subscription", "claude-cli", "anthropic", CLAUDE_EXECUTABLE);
}

async function observeHost(
  options: SubscriptionHostObservationOptions,
  transport: SubscriptionHostTransport,
  provider: "claude-cli" | "codex-cli",
  catalogueProvider: "anthropic" | "openai",
  executable: typeof CODEX_EXECUTABLE | typeof CLAUDE_EXECUTABLE,
): Promise<SubscriptionHostObservation> {
  const timeoutMilliseconds = positiveBound(options.timeoutMilliseconds, DEFAULT_TIMEOUT_MILLISECONDS, HARD_MAX_TIMEOUT_MILLISECONDS, "HOST_TIMEOUT");
  const maxOutputBytes = positiveBound(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, HARD_MAX_OUTPUT_BYTES, "HOST_OUTPUT_BOUND");
  const ttlMilliseconds = positiveBound(options.authorizationTtlMilliseconds, DEFAULT_AUTHORIZATION_TTL_MILLISECONDS, HARD_MAX_AUTHORIZATION_TTL_MILLISECONDS, "HOST_AUTHORIZATION_TTL");
  const observedAt = strictInstant(options.observedAt ?? new Date().toISOString());
  const runner = options.runner ?? defaultRunner;
  const systemIdentityObserver = options.systemIdentityObserver ?? trustedSystemIdentity;
  const boundary = authenticateProviderStateRoot(options.providerRoot);
  const authKind = transport === "codex-cli-subscription" ? "codex" as const : "claude" as const;
  const versionCommand: ConfinedMetadataCommand = { executable, arguments: ["--version"], stdin: null, auth: authKind };
  const authCommand: ConfinedMetadataCommand = transport === "codex-cli-subscription"
    ? { executable: CODEX_EXECUTABLE, arguments: ["login", "status"], stdin: null, auth: "codex" }
    : { executable: CLAUDE_EXECUTABLE, arguments: ["auth", "status", "--json"], stdin: null, auth: "claude" };
  const discoveryCommand: ConfinedMetadataCommand = transport === "codex-cli-subscription"
    ? {
        executable: CODEX_EXECUTABLE,
        arguments: ["app-server", "--stdio"],
        stdin: {
          initial: CODEX_APP_SERVER_INITIALIZE,
          afterResponse: { responseId: CODEX_INITIALIZE_REQUEST_ID, input: CODEX_APP_SERVER_AFTER_INITIALIZE },
        },
        auth: "codex",
      }
    : { executable: CLAUDE_EXECUTABLE, arguments: ["--help"], stdin: null, auth: "claude" };
  const commandClosure = Object.freeze([versionCommand, authCommand, discoveryCommand]);
  const emptyAuth: SanitizedCodexAuthentication | SanitizedClaudeAuthentication = transport === "codex-cli-subscription"
    ? parseCodexLoginStatus("") : deepFreeze({ authenticated: false, authenticationMode: null, apiProvider: null, subscriptionType: null, failureCode: "AUTHENTICATION_NOT_CONFIRMED", accountIdentityRetained: false });
  const candidates = transport === "claude-cli-subscription"
    ? claudeSubscriptionCandidates(options.catalogue)
    : codexCatalogueCandidates(options.catalogue);
  const fallbackCandidateSurface = transport === "codex-cli-subscription"
    ? "frozen-catalogue-only" as const
    : "non-exhaustive" as const;
  if (authFor(boundary, authKind) === null) {
    return observation({
      schema: "urn:usf:subscription-host-observation:1", version: 1, transport, provider, catalogueProvider, executable,
      executableVersion: null, observedAt, status: "unavailable", failureCode: "PROVIDER_AUTH_FILE_UNAVAILABLE",
      authentication: emptyAuth, authorization: null, candidateSurface: fallbackCandidateSurface,
      candidates, apiAndCloudCredentialEnvironmentForwarded: false,
      nonclaims: ["recognized-auth-file-unavailable", "candidate-membership-is-not-semantic-qualification"],
    });
  }
  const systemClosure = observeSystemClosure(executable, systemIdentityObserver, true);
  const containmentDigest = hostContainmentDigest(boundary, commandClosure, systemClosure);
  let version: string;
  try {
    const result = await runConfinedMetadataCommand(boundary, versionCommand, runner, timeoutMilliseconds, maxOutputBytes, systemIdentityObserver, systemClosure);
    version = transport === "codex-cli-subscription" ? parseCodexVersion(result.stdout) : parseClaudeVersion(result.stdout);
  } catch (error) {
    if (error instanceof SubscriptionHostContainmentError) throw error;
    const failureCode = error instanceof SubscriptionHostParseError ? "VERSION_INVALID" : classifyCommandFailure(error);
    return observation({
      schema: "urn:usf:subscription-host-observation:1", version: 1, transport, provider, catalogueProvider, executable,
      executableVersion: null, observedAt, status: "unavailable", failureCode, authentication: emptyAuth,
      authorization: null, candidateSurface: fallbackCandidateSurface,
      candidates, apiAndCloudCredentialEnvironmentForwarded: false,
      nonclaims: [
        "host-authentication-is-not-model-entitlement",
        "candidate-membership-is-not-semantic-qualification",
        "host-version-failure-preserves-frozen-catalogue-denominator-only",
      ],
    });
  }
  let authentication: SanitizedCodexAuthentication | SanitizedClaudeAuthentication;
  try {
    const authResult = await runConfinedMetadataCommand(boundary, authCommand, runner, timeoutMilliseconds, maxOutputBytes, systemIdentityObserver, systemClosure);
    authentication = transport === "codex-cli-subscription"
      ? parseCodexLoginStatus(authResult.stdout) : parseClaudeAuthStatus(authResult.stdout);
  } catch (error) {
    if (error instanceof SubscriptionHostContainmentError) throw error;
    const failureCode = error instanceof SubscriptionHostParseError ? "OUTPUT_INVALID" : classifyCommandFailure(error);
    return observation({
      schema: "urn:usf:subscription-host-observation:1", version: 1, transport, provider, catalogueProvider, executable,
      executableVersion: version, observedAt, status: "unavailable", failureCode, authentication: emptyAuth,
      authorization: null, candidateSurface: fallbackCandidateSurface,
      candidates, apiAndCloudCredentialEnvironmentForwarded: false,
      nonclaims: [
        "host-authentication-is-not-model-entitlement",
        "candidate-membership-is-not-semantic-qualification",
        "host-authentication-failure-preserves-frozen-catalogue-denominator-only",
      ],
    });
  }
  let resolvedCandidates = candidates;
  let candidateSurface: SubscriptionHostObservation["candidateSurface"] = fallbackCandidateSurface;
  let discoveryFailure: HostFailureCode | null = null;
  try {
    const discoveryResult = await runConfinedMetadataCommand(boundary, discoveryCommand, runner, timeoutMilliseconds, maxOutputBytes, systemIdentityObserver, systemClosure);
    if (transport === "codex-cli-subscription") {
      const parsedSurface = parseCodexAppServerModelSurface(discoveryResult.stdout, options.catalogue, maxOutputBytes);
      resolvedCandidates = parsedSurface.candidates;
      candidateSurface = parsedSurface.complete ? "bounded-union" : "non-exhaustive";
    } else {
      resolvedCandidates = claudeSubscriptionCandidates(options.catalogue, parseClaudeHelpAliases(discoveryResult.stdout));
    }
  } catch (error) {
    if (error instanceof SubscriptionHostContainmentError) throw error;
    discoveryFailure = error instanceof SubscriptionHostParseError ? "OUTPUT_INVALID" : classifyCommandFailure(error);
  }
  const hostAuthorization = authorization(
    transport, provider, catalogueProvider, executable, version, authentication,
    candidateSurface, resolvedCandidates, containmentDigest, observedAt, ttlMilliseconds,
  );
  return observation({
    schema: "urn:usf:subscription-host-observation:1", version: 1, transport, provider, catalogueProvider, executable,
    executableVersion: version, observedAt, status: authentication.authenticated ? "authenticated" : "unauthenticated",
    failureCode: authentication.authenticated ? discoveryFailure : "AUTHENTICATION_NOT_CONFIRMED", authentication,
    authorization: hostAuthorization, candidateSurface,
    candidates: resolvedCandidates, apiAndCloudCredentialEnvironmentForwarded: false,
    nonclaims: [
      "host-authentication-is-not-model-entitlement",
      "candidate-membership-is-not-semantic-qualification",
      "host-census-does-not-authorize-inference",
      ...(discoveryFailure === null ? [] : [transport === "codex-cli-subscription"
        ? "codex-no-network-app-server-discovery-failed-frozen-catalogue-denominator-only"
        : "claude-no-network-help-alias-discovery-failed-frozen-catalogue-denominator-only"]),
    ],
  });
}

export async function observeSubscriptionHosts(
  snapshot: ModelCatalogueSnapshot,
  options: SubscriptionHostCensusOptions,
): Promise<SubscriptionHostCensus> {
  const observedAt = strictInstant(options.now ?? new Date().toISOString());
  const observationOptions: SubscriptionHostObservationOptions = {
    catalogue: snapshot,
    providerRoot: options.providerRoot,
    observedAt,
    timeoutMilliseconds: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    authorizationTtlMilliseconds: options.authorizationTtlMilliseconds,
    runner: options.runner,
    systemIdentityObserver: options.systemIdentityObserver,
  };
  const hosts = deepFreeze((await Promise.all([observeCodex(observationOptions), observeClaude(observationOptions)]))
    .sort((left, right) => compareCodeUnits(left.transport, right.transport)));
  const candidates = deepFreeze(hosts.flatMap((host) => host.candidates).sort((left, right) =>
    compareCodeUnits(left.transport, right.transport)
      || compareCodeUnits(left.kind, right.kind)
      || compareCodeUnits(left.model, right.model)
      || (left.hostRowIndex ?? -1) - (right.hostRowIndex ?? -1),
  ));
  const authorizations = deepFreeze(hosts.flatMap((host) => host.authorization === null ? [] : [host.authorization]));
  const codex = hosts.find((host) => host.transport === "codex-cli-subscription")!;
  const claude = hosts.find((host) => host.transport === "claude-cli-subscription")!;
  const basis = deepFreeze({
    schema: "urn:usf:subscription-host-census:1" as const,
    version: 1 as const,
    source: {
      modelsDevRawDigest: snapshot.rawDigest,
      modelsDevNormalizedDigest: snapshot.normalizedDigest,
      codexModelSurface: codex.candidateSurface === "bounded-union"
        ? "no-network-app-server-complete-page-union-frozen-modelsdev-not-live-entitlement" as const
        : codex.candidateSurface === "non-exhaustive"
          ? "no-network-app-server-partial-union-frozen-modelsdev-not-live-entitlement" as const
          : "frozen-modelsdev-only-app-server-unavailable" as const,
      claudeModelSurface: claude.candidates.some((candidate) => candidate.source === "claude-cli-help-alias")
        ? "no-network-installed-cli-help-aliases-union-frozen-modelsdev-non-exhaustive" as const
        : "frozen-modelsdev-only-cli-help-unavailable" as const,
    },
    hosts,
    candidates,
    authorizations,
    denominators: {
      hostTransports: hosts.length,
      authenticatedHosts: hosts.filter((host) => host.authentication.authenticated).length,
      candidateRecords: candidates.length,
      modelCandidates: candidates.filter((candidate) => candidate.kind === "model").length,
      aliasCandidates: candidates.filter((candidate) => candidate.kind === "alias").length,
      hostEnumeratedCandidates: candidates.filter((candidate) => candidate.source === "codex-app-server-model-list").length,
      catalogueOnlyCandidates: candidates.filter((candidate) => candidate.source === "models.dev/api.json").length,
      exactCatalogueMatches: candidates.filter((candidate) => candidate.catalogueMatch === "exact").length,
      unmatchedCandidates: candidates.filter((candidate) => candidate.catalogueMatch === "none").length,
      authorizations: authorizations.length,
    },
    nonclaims: [
      "host-authentication-is-not-model-entitlement",
      "candidate-membership-is-not-semantic-qualification",
      "codex-no-network-app-server-model-list-is-not-a-live-entitlement-list",
      "claude-host-model-denominator-is-non-exhaustive",
      "host-census-does-not-authorize-inference",
    ],
  });
  return deepFreeze({ ...basis, digest: canonicalDigest(basis) });
}

export { observeClaude as observeClaudeSubscriptionHost, observeCodex as observeCodexSubscriptionHost };
