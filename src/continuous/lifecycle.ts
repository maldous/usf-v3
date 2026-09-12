import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  constants,
  realpathSync,
} from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rmdir,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";

export type LifecycleThrough = "check" | "integrate" | "publish";

export interface LifecycleScopedDependency {
  readonly workId: string;
  readonly digest: `sha256:${string}`;
}

export interface LifecycleBindingInput {
  readonly profile: string;
  readonly manifest: string;
  readonly through: LifecycleThrough;
  readonly automationPolicyDigest: `sha256:${string}`;
  readonly lifecycleToolDigest: `sha256:${string}`;
  readonly graphSemanticDigest: `sha256:${string}`;
  readonly scopedDependencyDigests: readonly LifecycleScopedDependency[];
}

export interface LifecycleBinding extends LifecycleBindingInput {
  readonly schema: "urn:usf:lifecycle-binding:1";
  readonly version: 1;
  readonly bindingDigest: `sha256:${string}`;
}

/**
 * Stable lifecycle-control identity. Graph and per-work dependency digests are
 * observations used to rederive affected work; neither is a process-wide
 * invalidation key.
 */
export type LifecycleBindingMaterial = Omit<LifecycleBinding, "bindingDigest" | "graphSemanticDigest" | "scopedDependencyDigests">;

export interface ProcessIdentity {
  readonly pid: number;
  readonly uid: number;
  readonly bootId: string;
  readonly startTicks: string;
  readonly argvDigest: `sha256:${string}`;
  readonly executablePathDigest: `sha256:${string}`;
}

export interface ProcessInspector {
  readonly current: () => Promise<ProcessIdentity>;
  readonly inspect: (pid: number) => Promise<ProcessIdentity | null>;
}

export interface LifecycleCarrier {
  readonly commit: string;
  readonly tree: string;
}

export interface LifecycleRunRecord {
  readonly schema: "urn:usf:lifecycle-run:1";
  readonly version: 1;
  readonly instance: string;
  readonly runId: string;
  readonly nonce: string;
  readonly binding: LifecycleBinding;
  readonly process: ProcessIdentity;
  readonly initialCarrier: LifecycleCarrier;
  readonly timestamps: {
    readonly claimedAt: string;
  };
  readonly nonclaims: readonly string[];
}

export interface LifecycleReadyRecord {
  readonly schema: "urn:usf:lifecycle-ready:1";
  readonly version: 1;
  readonly instance: string;
  readonly runId: string;
  readonly nonce: string;
  readonly bindingDigest: `sha256:${string}`;
  readonly readyAt: string;
}

export interface StopIntent {
  readonly schema: "urn:usf:lifecycle-stop-intent:1";
  readonly version: 1;
  readonly instance: string;
  readonly runId: string;
  readonly nonce: string;
  readonly bindingDigest: `sha256:${string}`;
  readonly requestedAt: string;
  readonly source: "command" | "SIGINT" | "SIGTERM";
}

export interface LifecycleReceipt {
  readonly schema: "urn:usf:lifecycle-receipt:1";
  readonly version: 1;
  readonly instance: string;
  readonly runId: string;
  readonly bindingDigest: `sha256:${string}`;
  readonly status: "stopped" | "degraded";
  readonly reasonCode: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly nonclaims: readonly string[];
}

export const lifecycleNonclaims = Object.freeze([
  "lifecycle-ready-is-not-semantic-completion",
  "lifecycle-record-is-not-evidence-or-proof",
  "provider-pipeline-remains-unwired-and-fake-only",
  "no-exactly-once-guarantee",
  "no-production-bau-claim",
  "no-live-agent-proof",
] as const);

export const lifecycleReasonCodes = Object.freeze({
  INSTANCE_INVALID: "LIFECYCLE_INSTANCE_INVALID",
  PROFILE_INVALID: "LIFECYCLE_PROFILE_INVALID",
  MANIFEST_INVALID: "LIFECYCLE_MANIFEST_INVALID",
  BINDING_INVALID: "LIFECYCLE_BINDING_INVALID",
  RECORD_INVALID: "LIFECYCLE_RECORD_INVALID",
  RECORD_TOO_LARGE: "LIFECYCLE_RECORD_TOO_LARGE",
  PATH_UNSAFE: "LIFECYCLE_PATH_UNSAFE",
  ACTIVE_AMBIGUOUS: "LIFECYCLE_ACTIVE_AMBIGUOUS",
  BINDING_CONFLICT: "LIFECYCLE_BINDING_CONFLICT",
  IDENTITY_UNAVAILABLE: "LIFECYCLE_IDENTITY_UNAVAILABLE",
  CURRENTNESS_CHANGED: "LIFECYCLE_CURRENTNESS_CHANGED",
  CYCLE_FAILED: "LIFECYCLE_CYCLE_FAILED",
  STOP_TIMEOUT: "LIFECYCLE_STOP_TIMEOUT",
  CYCLE_TIMEOUT: "LIFECYCLE_CYCLE_TIMEOUT",
  INSTANCE_STOPPING: "LIFECYCLE_INSTANCE_STOPPING",
  INSTANCE_STARTING: "LIFECYCLE_INSTANCE_STARTING",
  LOCK_UNAVAILABLE: "LIFECYCLE_OWNER_LOCK_UNAVAILABLE",
  STALE_QUARANTINED: "LIFECYCLE_STALE_ACTIVE_QUARANTINED",
  HOST_UNSUPPORTED: "LIFECYCLE_HOST_UNSUPPORTED",
} as const);

const MAX_RECORD_BYTES = 64 * 1024;
const directoryMode = 0o700;
const recordMode = 0o600;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const runIdPattern = /^[0-9a-f]{32,64}$/;
const gitObjectPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const bootIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const versionedUrnPattern = /^urn:[a-z0-9][a-z0-9-]{1,31}:[A-Za-z0-9][A-Za-z0-9._~:/@!$&'()*+,;=-]*:[1-9][0-9]*$/;
const urnPattern = /^urn:[a-z0-9][a-z0-9-]{1,31}:[A-Za-z0-9][A-Za-z0-9._~:/@!$&'()*+,;=-]*$/;

function lifecycleError(code: string, exitCode: (typeof exitCodes)[keyof typeof exitCodes], message: string): UsfError {
  return new UsfError(code, exitCode, message);
}

function isErrno(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && codes.includes((error as NodeJS.ErrnoException).code ?? "");
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function currentUid(): number {
  if (process.platform !== "linux" || process.getuid === undefined) {
    throw lifecycleError(lifecycleReasonCodes.IDENTITY_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "Lifecycle process identity requires Linux procfs and a numeric UID.");
  }
  const uid = process.getuid();
  if (uid === 0) {
    throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle runtime state must not be created by UID 0.");
  }
  return uid;
}

export function validateInstanceSlug(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
    throw lifecycleError(lifecycleReasonCodes.INSTANCE_INVALID, exitCodes.INVALID_INPUT, "Lifecycle instances use a lowercase ASCII slug of at most 64 characters.");
  }
  return value;
}

export function validateVersionedProfile(value: string): string {
  if (!versionedUrnPattern.test(value) || value.includes("%") || value.includes("?") || value.includes("#")) {
    throw lifecycleError(lifecycleReasonCodes.PROFILE_INVALID, exitCodes.INVALID_INPUT, "A canonical, explicitly versioned profile URN is required.");
  }
  return value;
}

export function validateRepositoryManifest(value: string): string {
  if (!value.endsWith(".json") || value.length > 512 || value.includes("\0") || value.includes("\\") || value.startsWith("/") || value.startsWith("./")) {
    throw lifecycleError(lifecycleReasonCodes.MANIFEST_INVALID, exitCodes.INVALID_INPUT, "The lifecycle manifest must be a repository-relative JSON path.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") || segments[0] === ".git" || segments[0] === ".usf" || segments.some((segment) => segment === ".env")) {
    throw lifecycleError(lifecycleReasonCodes.MANIFEST_INVALID, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle manifest path is outside the permitted tracked repository scope.");
  }
  return segments.join("/");
}

function validateDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && digestPattern.test(value);
}

function validateScopedDependencies(value: unknown): value is LifecycleScopedDependency[] {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  const workIds = new Set<string>();
  let previous = "";
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
    const item = value[index];
    if (!isRecord(item) || !exactKeys(item, ["workId", "digest"]) || typeof item.workId !== "string" || !urnPattern.test(item.workId) || !validateDigest(item.digest)) return false;
    if (workIds.has(item.workId) || (index > 0 && item.workId.localeCompare(previous) <= 0)) return false;
    workIds.add(item.workId);
    previous = item.workId;
  }
  return true;
}

function bindingPayload(input: LifecycleBindingInput): Omit<LifecycleBinding, "bindingDigest"> {
  const scopedDependencyDigests = [...input.scopedDependencyDigests]
    .map((dependency) => Object.freeze({ workId: dependency.workId, digest: dependency.digest }))
    .sort((left, right) => left.workId.localeCompare(right.workId));
  if (!validateDigest(input.automationPolicyDigest) || !validateDigest(input.lifecycleToolDigest) || !validateDigest(input.graphSemanticDigest) || !validateScopedDependencies(scopedDependencyDigests)) {
    throw lifecycleError(lifecycleReasonCodes.BINDING_INVALID, exitCodes.INVALID_INPUT, "Lifecycle binding digests are malformed or ambiguous.");
  }
  if (!(["check", "integrate", "publish"] as const).includes(input.through)) {
    throw lifecycleError(lifecycleReasonCodes.BINDING_INVALID, exitCodes.INVALID_INPUT, "The lifecycle through boundary is invalid.");
  }
  return Object.freeze({
    schema: "urn:usf:lifecycle-binding:1",
    version: 1,
    profile: validateVersionedProfile(input.profile),
    manifest: validateRepositoryManifest(input.manifest),
    through: input.through,
    automationPolicyDigest: input.automationPolicyDigest,
    lifecycleToolDigest: input.lifecycleToolDigest,
    graphSemanticDigest: input.graphSemanticDigest,
    scopedDependencyDigests: Object.freeze(scopedDependencyDigests),
  });
}

export function createLifecycleBinding(input: LifecycleBindingInput): LifecycleBinding {
  const payload = bindingPayload(input);
  const { graphSemanticDigest: _observedGlobalDigest, scopedDependencyDigests: _observedScopedDigests, ...controlMaterial } = payload;
  return Object.freeze({ ...payload, bindingDigest: canonicalDigest(controlMaterial, { rejectAbsolutePaths: true }) });
}

export function lifecycleBindingMaterial(binding: LifecycleBinding): LifecycleBindingMaterial {
  if (!isLifecycleBinding(binding)) throw lifecycleError(lifecycleReasonCodes.BINDING_INVALID, exitCodes.INVALID_INPUT, "The lifecycle binding is malformed.");
  const { bindingDigest: _bindingDigest, graphSemanticDigest: _observedGlobalDigest, scopedDependencyDigests: _observedScopedDigests, ...material } = binding;
  return Object.freeze(material);
}

function isLifecycleBinding(value: unknown): value is LifecycleBinding {
  if (!isRecord(value) || !exactKeys(value, ["schema", "version", "profile", "manifest", "through", "automationPolicyDigest", "lifecycleToolDigest", "graphSemanticDigest", "scopedDependencyDigests", "bindingDigest"])) return false;
  try {
    if (!validateDigest(value.bindingDigest)) return false;
    const rebuilt = createLifecycleBinding(value as unknown as LifecycleBindingInput);
    return canonicalJson(rebuilt) === canonicalJson(value);
  } catch { return false; }
}

function isProcessIdentity(value: unknown): value is ProcessIdentity {
  return isRecord(value)
    && exactKeys(value, ["pid", "uid", "bootId", "startTicks", "argvDigest", "executablePathDigest"])
    && Number.isSafeInteger(value.pid) && Number(value.pid) > 0
    && Number.isSafeInteger(value.uid) && Number(value.uid) >= 0
    && typeof value.bootId === "string" && bootIdPattern.test(value.bootId)
    && typeof value.startTicks === "string" && /^(?:0|[1-9][0-9]*)$/.test(value.startTicks)
    && validateDigest(value.argvDigest)
    && validateDigest(value.executablePathDigest);
}

function isCarrier(value: unknown): value is LifecycleCarrier {
  return isRecord(value) && exactKeys(value, ["commit", "tree"])
    && typeof value.commit === "string" && gitObjectPattern.test(value.commit)
    && typeof value.tree === "string" && gitObjectPattern.test(value.tree);
}

function isNonclaims(value: unknown): value is readonly string[] {
  return Array.isArray(value) && canonicalJson(value) === canonicalJson(lifecycleNonclaims);
}

function validateRunRecord(value: unknown): LifecycleRunRecord {
  if (!isRecord(value) || !exactKeys(value, ["schema", "version", "instance", "runId", "nonce", "binding", "process", "initialCarrier", "timestamps", "nonclaims"])
    || value.schema !== "urn:usf:lifecycle-run:1" || value.version !== 1
    || typeof value.instance !== "string" || typeof value.runId !== "string" || typeof value.nonce !== "string"
    || !runIdPattern.test(value.runId) || !runIdPattern.test(value.nonce)
    || !isLifecycleBinding(value.binding) || !isProcessIdentity(value.process) || !isCarrier(value.initialCarrier)
    || !isRecord(value.timestamps) || !exactKeys(value.timestamps, ["claimedAt"])
    || !isIsoTimestamp(value.timestamps.claimedAt)
    || !isNonclaims(value.nonclaims)) {
    throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.CONTAINMENT_REFUSAL, "The active lifecycle record is malformed or ambiguous.");
  }
  validateInstanceSlug(value.instance);
  return value as unknown as LifecycleRunRecord;
}

function validateReadyRecord(value: unknown): LifecycleReadyRecord {
  if (!isRecord(value) || !exactKeys(value, ["schema", "version", "instance", "runId", "nonce", "bindingDigest", "readyAt"])
    || value.schema !== "urn:usf:lifecycle-ready:1" || value.version !== 1
    || typeof value.instance !== "string" || typeof value.runId !== "string" || typeof value.nonce !== "string"
    || !runIdPattern.test(value.runId) || !runIdPattern.test(value.nonce) || !validateDigest(value.bindingDigest)
    || !isIsoTimestamp(value.readyAt)) {
    throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle readiness record is malformed or ambiguous.");
  }
  validateInstanceSlug(value.instance);
  return value as unknown as LifecycleReadyRecord;
}

function validateStopIntent(value: unknown): StopIntent {
  if (!isRecord(value) || !exactKeys(value, ["schema", "version", "instance", "runId", "nonce", "bindingDigest", "requestedAt", "source"])
    || value.schema !== "urn:usf:lifecycle-stop-intent:1" || value.version !== 1
    || typeof value.instance !== "string" || typeof value.runId !== "string" || typeof value.nonce !== "string"
    || !runIdPattern.test(value.runId) || !runIdPattern.test(value.nonce) || !validateDigest(value.bindingDigest)
    || !isIsoTimestamp(value.requestedAt) || !["command", "SIGINT", "SIGTERM"].includes(String(value.source))) {
    throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle stop intent is malformed or ambiguous.");
  }
  validateInstanceSlug(value.instance);
  return value as unknown as StopIntent;
}

function validateReceipt(value: unknown): LifecycleReceipt {
  if (!isRecord(value) || !exactKeys(value, ["schema", "version", "instance", "runId", "bindingDigest", "status", "reasonCode", "startedAt", "completedAt", "nonclaims"])
    || value.schema !== "urn:usf:lifecycle-receipt:1" || value.version !== 1
    || typeof value.instance !== "string" || typeof value.runId !== "string" || !runIdPattern.test(value.runId)
    || !validateDigest(value.bindingDigest) || !["stopped", "degraded"].includes(String(value.status))
    || typeof value.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{2,127}$/.test(value.reasonCode)
    || !isIsoTimestamp(value.startedAt) || !isIsoTimestamp(value.completedAt) || !isNonclaims(value.nonclaims)) {
    throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle completion receipt is malformed or ambiguous.");
  }
  validateInstanceSlug(value.instance);
  return value as unknown as LifecycleReceipt;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if (isErrno(error, "ENOENT")) return false; throw error; }
}

async function secureDirectory(path: string, create: boolean): Promise<void> {
  if (create) {
    try { await mkdir(path, { mode: directoryMode }); } catch (error) { if (!isErrno(error, "EEXIST")) throw error; }
  }
  let metadata;
  try { metadata = await lstat(path); } catch {
    throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "A lifecycle runtime directory is unavailable.");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid() || (metadata.mode & 0o777) !== directoryMode) {
    throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle runtime directories must be owner-only real directories.");
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    await handle.sync();
  } catch (error) {
    if (!isErrno(error, "EINVAL", "ENOTSUP", "EISDIR")) throw error;
  } finally {
    await handle?.close();
  }
}

async function readSecureBytes(path: string, maxBytes = MAX_RECORD_BYTES): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== currentUid() || (metadata.mode & 0o777) !== recordMode) {
      throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle records must be owner-only regular files.");
    }
    if (metadata.size < 2 || metadata.size > maxBytes) {
      throw lifecycleError(lifecycleReasonCodes.RECORD_TOO_LARGE, exitCodes.CONTAINMENT_REFUSAL, "A lifecycle record is empty or exceeds its size bound.");
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof UsfError) throw error;
    if (isErrno(error, "ELOOP")) throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle record symlinks are forbidden.");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readSecureJson(path: string): Promise<unknown> {
  const bytes = await readSecureBytes(path);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.CONTAINMENT_REFUSAL, "A lifecycle record is not valid JSON."); }
}

/** Install a complete immutable record without replacing an existing target. */
async function atomicCreateJson(directory: string, filename: string, value: unknown, temporaryId: string): Promise<boolean> {
  await secureDirectory(directory, false);
  if (!/^[a-z0-9][a-z0-9.-]{0,127}\.json$/.test(filename) || !runIdPattern.test(temporaryId)) {
    throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "A generated lifecycle record path is invalid.");
  }
  const target = join(directory, filename);
  const temporary = join(directory, `.${filename}.tmp-${temporaryId}`);
  const bytes = Buffer.from(`${canonicalJson(value, { rejectAbsolutePaths: true })}\n`, "utf8");
  if (bytes.byteLength > MAX_RECORD_BYTES) throw lifecycleError(lifecycleReasonCodes.RECORD_TOO_LARGE, exitCodes.CONTAINMENT_REFUSAL, "A lifecycle record exceeds its size bound.");
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), recordMode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try { await link(temporary, target); }
    catch (error) {
      if (isErrno(error, "EEXIST")) return false;
      throw error;
    }
    await fsyncDirectory(directory);
    const readBack = await readSecureBytes(target);
    if (!readBack.equals(bytes)) throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle record read-back did not match the exact write.");
    return true;
  } finally {
    await handle?.close();
    try { await unlink(temporary); } catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
  }
}

export interface LifecycleRuntimePaths {
  readonly root: string;
  readonly instanceRoot: string;
  readonly active: string;
  readonly records: string;
  readonly completed: string;
  readonly stale: string;
  readonly lockFile: string;
}

export async function lifecycleRuntimePaths(repositoryRoot: string, instance: string, create = false): Promise<LifecycleRuntimePaths> {
  validateInstanceSlug(instance);
  const root = realpathSync(resolve(repositoryRoot));
  const paths = [join(root, ".usf"), join(root, ".usf", "runs"), join(root, ".usf", "runs", "watch")];
  if (create) for (const path of paths) await secureDirectory(path, true);
  else for (const path of paths) if (await exists(path)) await secureDirectory(path, false); else return {
    root, instanceRoot: join(paths[2]!, instance), active: join(paths[2]!, instance, "active"), records: join(paths[2]!, instance, "records"), completed: join(paths[2]!, instance, "completed"), stale: join(paths[2]!, instance, "stale"), lockFile: join(paths[2]!, instance, "owner.lock"),
  };
  const instanceRoot = join(paths[2]!, instance);
  const children = [join(instanceRoot, "active"), join(instanceRoot, "records"), join(instanceRoot, "completed"), join(instanceRoot, "stale")];
  if (create) {
    await secureDirectory(instanceRoot, true);
    for (const child of children) await secureDirectory(child, true);
  } else if (await exists(instanceRoot)) {
    await secureDirectory(instanceRoot, false);
    for (const child of children) if (await exists(child)) await secureDirectory(child, false);
  }
  return { root, instanceRoot, active: children[0]!, records: children[1]!, completed: children[2]!, stale: children[3]!, lockFile: join(instanceRoot, "owner.lock") };
}

const lifecycleLockBrand: unique symbol = Symbol("usf-lifecycle-instance-lock");

export interface LifecycleInstanceLock {
  readonly [lifecycleLockBrand]: true;
  readonly root: string;
  readonly instance: string;
  readonly lost: Promise<void>;
  readonly held: () => boolean;
  readonly release: () => Promise<void>;
}

type LifecycleLockAttempt =
  | { readonly status: "acquired"; readonly lock: LifecycleInstanceLock }
  | { readonly status: "busy" };

/**
 * Acquire flock on an inherited open-file description, then retain the parent
 * descriptor for the lifetime of the ownership claim. Linux releases the lock
 * automatically when the process dies or the descriptor is explicitly closed.
 */
async function acquireLifecycleInstanceLock(paths: LifecycleRuntimePaths, instance: string): Promise<LifecycleLockAttempt> {
  await secureDirectory(paths.instanceRoot, false);
  let handle: FileHandle | undefined;
  try {
    if (process.platform !== "linux") {
      throw lifecycleError(lifecycleReasonCodes.HOST_UNSUPPORTED, exitCodes.CONTINUOUS_DEGRADED, "Lifecycle ownership requires Linux procfs and util-linux flock.");
    }
    let flockMetadata;
    try { flockMetadata = await lstat("/usr/bin/flock"); }
    catch {
      throw lifecycleError(lifecycleReasonCodes.HOST_UNSUPPORTED, exitCodes.CONTINUOUS_DEGRADED, "Lifecycle ownership requires /usr/bin/flock from util-linux.");
    }
    if (!flockMetadata.isFile() || flockMetadata.isSymbolicLink() || flockMetadata.uid !== 0 || (flockMetadata.mode & 0o022) !== 0 || (flockMetadata.mode & 0o111) === 0) {
      throw lifecycleError(lifecycleReasonCodes.HOST_UNSUPPORTED, exitCodes.CONTINUOUS_DEGRADED, "The util-linux flock executable does not satisfy the trusted host boundary.");
    }
    handle = await open(paths.lockFile, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), recordMode);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== currentUid() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== recordMode) {
      throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle owner lock must be an owner-only regular file.");
    }
    const child = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "3"], {
      cwd: paths.root,
      stdio: ["ignore", "ignore", "pipe", handle.fd],
    });
    let stderr = "";
    const acquired = await new Promise<"acquired" | "busy">((complete, reject) => {
      let settled = false;
      const finish = (value: "acquired" | "busy", error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stderr?.off("data", onStderr);
        child.off("exit", onExit);
        child.off("error", onError);
        if (error !== undefined) reject(error); else complete(value);
      };
      const onStderr = (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(0, 1024); };
      const onExit = (code: number | null) => {
        if (code === 0) finish("acquired");
        else if (code === 1) finish("busy");
        else finish("busy", new Error(`flock-exited:${String(code)}:${stderr}`));
      };
      const onError = () => finish("busy", new Error("flock-unavailable"));
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish("busy", new Error("flock-timeout"));
      }, 2_000);
      child.stderr?.on("data", onStderr);
      child.once("exit", onExit);
      child.once("error", onError);
    });
    if (acquired === "busy") {
      await handle.close();
      handle = undefined;
      return { status: "busy" };
    }
    let released = false;
    let releasePromise: Promise<void> | undefined;
    let completeLoss: (() => void) | undefined;
    const lost = new Promise<void>((complete) => { completeLoss = complete; });
    const lock: LifecycleInstanceLock = Object.freeze({
      [lifecycleLockBrand]: true as const,
      root: paths.root,
      instance,
      lost,
      held: () => !released,
      release: () => {
        releasePromise ??= (async () => {
          await handle?.close();
          handle = undefined;
          released = true;
          completeLoss?.();
        })();
        return releasePromise;
      },
    });
    return { status: "acquired", lock };
  } catch (error) {
    await handle?.close();
    if (error instanceof UsfError) throw error;
    if (isErrno(error, "ELOOP")) throw lifecycleError(lifecycleReasonCodes.PATH_UNSAFE, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle owner lock symlinks are forbidden.");
    throw lifecycleError(lifecycleReasonCodes.LOCK_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "The repository-local lifecycle owner lock is unavailable.");
  }
}

function assertLifecycleInstanceLock(lock: LifecycleInstanceLock, paths: LifecycleRuntimePaths, instance: string): void {
  if (lock[lifecycleLockBrand] !== true || lock.root !== paths.root || lock.instance !== instance || !lock.held()) {
    throw lifecycleError(lifecycleReasonCodes.LOCK_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "Lifecycle ownership mutation requires the exact held instance lock.");
  }
}

function parseStartTicks(statLine: string): string {
  const end = statLine.lastIndexOf(")");
  if (end < 1) throw lifecycleError(lifecycleReasonCodes.IDENTITY_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "Linux process stat identity is malformed.");
  const fields = statLine.slice(end + 2).trim().split(/\s+/);
  const startTicks = fields[19];
  if (startTicks === undefined || !/^(?:0|[1-9][0-9]*)$/.test(startTicks)) {
    throw lifecycleError(lifecycleReasonCodes.IDENTITY_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "Linux process start identity is unavailable.");
  }
  return startTicks;
}

async function inspectLinuxProcess(pid: number): Promise<ProcessIdentity | null> {
  if (!Number.isSafeInteger(pid) || pid < 1 || process.platform !== "linux") {
    throw lifecycleError(lifecycleReasonCodes.IDENTITY_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "Linux process identity is unavailable.");
  }
  const processDirectory = `/proc/${pid}`;
  try {
    const [bootId, statLine, argv, executablePath, metadata] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`${processDirectory}/stat`, "utf8"),
      readFile(`${processDirectory}/cmdline`),
      import("node:fs/promises").then(({ realpath }) => realpath(`${processDirectory}/exe`)),
      stat(processDirectory),
    ]);
    const normalizedBootId = bootId.trim();
    if (!bootIdPattern.test(normalizedBootId)) throw lifecycleError(lifecycleReasonCodes.IDENTITY_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "Linux boot identity is malformed.");
    return Object.freeze({
      pid,
      uid: metadata.uid,
      bootId: normalizedBootId,
      startTicks: parseStartTicks(statLine),
      argvDigest: sha256(argv),
      executablePathDigest: sha256(executablePath),
    });
  } catch (error) {
    if (isErrno(error, "ENOENT", "ESRCH")) return null;
    throw error;
  }
}

export const linuxProcessInspector: ProcessInspector = Object.freeze({
  current: async () => {
    const identity = await inspectLinuxProcess(process.pid);
    if (identity === null || identity.uid !== currentUid()) throw lifecycleError(lifecycleReasonCodes.IDENTITY_UNAVAILABLE, exitCodes.CONTINUOUS_DEGRADED, "The current process identity could not be verified.");
    return identity;
  },
  inspect: inspectLinuxProcess,
});

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function runRecordDirectory(paths: LifecycleRuntimePaths, runId: string): string {
  if (!runIdPattern.test(runId)) throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.CONTAINMENT_REFUSAL, "A lifecycle run identifier is malformed.");
  return join(paths.records, runId);
}

async function readActiveRecord(paths: LifecycleRuntimePaths): Promise<LifecycleRunRecord> {
  await secureDirectory(paths.active, false);
  const entries = (await readdir(paths.active)).sort();
  const transientRecord = /^\.run\.json\.tmp-[0-9a-f]{32,64}$/;
  if (entries.length > 64 || !entries.includes("run.json") || entries.some((entry) => entry !== "run.json" && !transientRecord.test(entry))) {
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The active lifecycle directory contains ambiguous state.");
  }
  const ownerPath = join(paths.active, "run.json");
  const record = validateRunRecord(await readSecureJson(ownerPath));
  const directory = runRecordDirectory(paths, record.runId);
  await secureDirectory(directory, false);
  const durablePath = join(directory, "run.json");
  const [ownerMetadata, durableMetadata] = await Promise.all([lstat(ownerPath), lstat(durablePath)]);
  if (!ownerMetadata.isFile() || !durableMetadata.isFile() || ownerMetadata.dev !== durableMetadata.dev || ownerMetadata.ino !== durableMetadata.ino) {
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The active lifecycle owner is not linked to its exact durable run record.");
  }
  const durable = validateRunRecord(await readSecureJson(durablePath));
  if (canonicalJson(record) !== canonicalJson(durable)) {
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The active and durable lifecycle records disagree.");
  }
  return record;
}

async function activeRecordOrUndefined(paths: LifecycleRuntimePaths): Promise<LifecycleRunRecord | undefined> {
  await secureDirectory(paths.active, false);
  const entries = (await readdir(paths.active)).sort();
  const transientRecord = /^\.run\.json\.tmp-[0-9a-f]{32,64}$/;
  if (!entries.includes("run.json")) {
    if (entries.length <= 64 && entries.every((entry) => transientRecord.test(entry))) return undefined;
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The active lifecycle directory contains ownerless ambiguous state.");
  }
  try { return await readActiveRecord(paths); }
  catch (error) { if (isErrno(error, "ENOENT")) return undefined; throw error; }
}

async function activeLiveness(record: LifecycleRunRecord, inspector: ProcessInspector): Promise<"live" | "stale"> {
  const observed = await inspector.inspect(record.process.pid);
  return observed !== null && sameIdentity(observed, record.process) ? "live" : "stale";
}

async function cleanupOwnedClaim(directory: string): Promise<void> {
  try { await unlink(join(directory, "run.json")); } catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
  try { await rmdir(directory); } catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
}

async function installRecordLink(source: string, directory: string, filename: string): Promise<void> {
  await secureDirectory(directory, false);
  const target = join(directory, filename);
  try { await link(source, target); }
  catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
    const [sourceBytes, targetBytes] = await Promise.all([readSecureBytes(source), readSecureBytes(target)]);
    if (!sourceBytes.equals(targetBytes)) {
      throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "A lifecycle disposition marker already exists with different bytes.");
    }
    return;
  }
  await fsyncDirectory(directory);
}

async function releaseActiveOwner(paths: LifecycleRuntimePaths, record: LifecycleRunRecord, lock: LifecycleInstanceLock): Promise<boolean> {
  assertLifecycleInstanceLock(lock, paths, record.instance);
  const current = await activeRecordOrUndefined(paths);
  if (current === undefined) return false;
  if (current.runId !== record.runId || current.nonce !== record.nonce || current.binding.bindingDigest !== record.binding.bindingDigest) return false;
  try { await unlink(join(paths.active, "run.json")); }
  catch (error) { if (isErrno(error, "ENOENT")) return false; throw error; }
  await fsyncDirectory(paths.active);
  return true;
}

async function quarantineActive(paths: LifecycleRuntimePaths, record: LifecycleRunRecord, lock: LifecycleInstanceLock): Promise<boolean> {
  const source = join(runRecordDirectory(paths, record.runId), "run.json");
  await installRecordLink(source, paths.stale, `${record.runId}.json`);
  return releaseActiveOwner(paths, record, lock);
}

interface StaleRecovery {
  readonly moved: boolean;
  readonly receipt?: LifecycleReceipt;
}

/** Recover the crash window after a disposition is durable but before ownership release. */
async function recoverStaleActive(paths: LifecycleRuntimePaths, record: LifecycleRunRecord, lock: LifecycleInstanceLock): Promise<StaleRecovery> {
  assertLifecycleInstanceLock(lock, paths, record.instance);
  const receiptPath = join(runRecordDirectory(paths, record.runId), "receipt.json");
  if (!(await exists(receiptPath))) return { moved: await quarantineActive(paths, record, lock) };
  const receipt = validateReceipt(await readSecureJson(receiptPath));
  if (receipt.instance !== record.instance || receipt.runId !== record.runId || receipt.bindingDigest !== record.binding.bindingDigest) {
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "A durable lifecycle receipt does not match its stale active run.");
  }
  await installRecordLink(receiptPath, paths.completed, `${record.runId}.json`);
  return { moved: await releaseActiveOwner(paths, record, lock), receipt };
}

export interface LifecycleIdGenerator {
  readonly runId: () => string;
  readonly nonce: () => string;
  readonly temporaryId: () => string;
}

export const randomLifecycleIds: LifecycleIdGenerator = Object.freeze({
  runId: () => randomBytes(32).toString("hex"),
  nonce: () => randomBytes(32).toString("hex"),
  temporaryId: () => randomBytes(32).toString("hex"),
});

export interface LifecycleClock {
  readonly now: () => Date;
  readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export const systemLifecycleClock: LifecycleClock = Object.freeze({
  now: () => new Date(),
  sleep: (milliseconds: number, signal?: AbortSignal) => new Promise<void>((complete) => {
    if (signal?.aborted) { complete(); return; }
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      complete();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  }),
});

export interface ClaimLifecycleRunInput {
  readonly repositoryRoot: string;
  readonly instance: string;
  readonly binding: LifecycleBinding;
  readonly initialCarrier: LifecycleCarrier;
  readonly processIdentity: ProcessIdentity;
  readonly clock?: LifecycleClock;
  readonly ids?: LifecycleIdGenerator;
  readonly processInspector?: ProcessInspector;
}

export type ClaimLifecycleRunResult =
  | { readonly status: "acquired"; readonly record: LifecycleRunRecord; readonly paths: LifecycleRuntimePaths; readonly lock: LifecycleInstanceLock }
  | { readonly status: "already-running"; readonly record: LifecycleRunRecord; readonly paths: LifecycleRuntimePaths };

export async function claimLifecycleRun(input: ClaimLifecycleRunInput): Promise<ClaimLifecycleRunResult> {
  const clock = input.clock ?? systemLifecycleClock;
  const ids = input.ids ?? randomLifecycleIds;
  const inspector = input.processInspector ?? linuxProcessInspector;
  const paths = await lifecycleRuntimePaths(input.repositoryRoot, input.instance, true);
  if (!isLifecycleBinding(input.binding) || !isCarrier(input.initialCarrier) || !isProcessIdentity(input.processIdentity)) {
    throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.INVALID_INPUT, "Lifecycle claim inputs are malformed.");
  }
  const lockAttempt = await acquireLifecycleInstanceLock(paths, input.instance);
  if (lockAttempt.status === "busy") {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const active = await activeRecordOrUndefined(paths);
      if (active === undefined) { await systemLifecycleClock.sleep(10); continue; }
      if (await activeLiveness(active, inspector) !== "live") {
        await systemLifecycleClock.sleep(10);
        continue;
      }
      if (await existingStopIntentForRecord(paths, active) !== undefined || await exists(join(runRecordDirectory(paths, active.runId), "receipt.json"))) {
        throw lifecycleError(lifecycleReasonCodes.INSTANCE_STOPPING, exitCodes.CONTINUOUS_DEGRADED, "The lifecycle instance is stopping under its owner lock.");
      }
      if (active.binding.bindingDigest === input.binding.bindingDigest) return { status: "already-running", record: active, paths };
      throw lifecycleError(lifecycleReasonCodes.BINDING_CONFLICT, exitCodes.CURRENTNESS_FAILURE, "A locked live lifecycle instance has a conflicting binding.");
    }
    throw lifecycleError(lifecycleReasonCodes.INSTANCE_STARTING, exitCodes.CONTINUOUS_DEGRADED, "The lifecycle instance owner lock is held before a readable run record is ready.");
  }
  const lock = lockAttempt.lock;
  let claimDirectory: string | undefined;
  try {
    assertLifecycleInstanceLock(lock, paths, input.instance);
    const runId = ids.runId();
    const nonce = ids.nonce();
    const temporaryId = ids.temporaryId();
    if (!runIdPattern.test(runId) || !runIdPattern.test(nonce) || !runIdPattern.test(temporaryId)) {
      throw lifecycleError(lifecycleReasonCodes.RECORD_INVALID, exitCodes.INVALID_INPUT, "Lifecycle ID generation returned an invalid value.");
    }
    const record: LifecycleRunRecord = Object.freeze({
      schema: "urn:usf:lifecycle-run:1",
      version: 1,
      instance: validateInstanceSlug(input.instance),
      runId,
      nonce,
      binding: input.binding,
      process: input.processIdentity,
      initialCarrier: input.initialCarrier,
      timestamps: Object.freeze({ claimedAt: clock.now().toISOString() }),
      nonclaims: lifecycleNonclaims,
    });
    validateRunRecord(record);
    claimDirectory = runRecordDirectory(paths, runId);
    try { await mkdir(claimDirectory, { mode: directoryMode }); }
    catch { throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "A generated lifecycle claim path already exists."); }
    await secureDirectory(claimDirectory, false);
    if (!(await atomicCreateJson(claimDirectory, "run.json", record, temporaryId))) {
      throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "A generated lifecycle run record already exists.");
    }

    const ownerPath = join(paths.active, "run.json");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await link(join(claimDirectory, "run.json"), ownerPath);
        await fsyncDirectory(paths.active);
        return { status: "acquired", record, paths, lock };
      } catch (error) { if (!isErrno(error, "EEXIST")) throw error; }
      let active: LifecycleRunRecord;
      try { active = await readActiveRecord(paths); }
      catch (error) { if (isErrno(error, "ENOENT")) continue; throw error; }
      const receiptPath = join(runRecordDirectory(paths, active.runId), "receipt.json");
      const liveness = await activeLiveness(active, inspector);
      if (await exists(receiptPath)) {
        if (liveness === "live") throw lifecycleError(lifecycleReasonCodes.INSTANCE_STOPPING, exitCodes.CONTINUOUS_DEGRADED, "The lifecycle instance is completing.");
        await recoverStaleActive(paths, active, lock);
        continue;
      }
      if (liveness === "live") {
        if (await existingStopIntentForRecord(paths, active) !== undefined) {
          throw lifecycleError(lifecycleReasonCodes.INSTANCE_STOPPING, exitCodes.CONTINUOUS_DEGRADED, "The lifecycle instance is already stopping.");
        }
        if (active.binding.bindingDigest === input.binding.bindingDigest) {
          await cleanupOwnedClaim(claimDirectory);
          claimDirectory = undefined;
          await lock.release();
          return { status: "already-running", record: active, paths };
        }
        throw lifecycleError(lifecycleReasonCodes.BINDING_CONFLICT, exitCodes.CURRENTNESS_FAILURE, "A live lifecycle instance has a conflicting binding.");
      }
      await recoverStaleActive(paths, active, lock);
    }
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle claims did not converge safely under the owner lock.");
  } catch (error) {
    if (claimDirectory !== undefined) await cleanupOwnedClaim(claimDirectory);
    await lock.release();
    throw error;
  }
}

async function existingStopIntentForRecord(paths: LifecycleRuntimePaths, record: LifecycleRunRecord): Promise<StopIntent | undefined> {
  const path = join(runRecordDirectory(paths, record.runId), "stop.json");
  if (!(await exists(path))) return undefined;
  return validateStopIntent(await readSecureJson(path));
}

async function writeStopIntent(paths: LifecycleRuntimePaths, record: LifecycleRunRecord, source: StopIntent["source"], clock: LifecycleClock, ids: LifecycleIdGenerator): Promise<StopIntent> {
  const existing = await existingStopIntentForRecord(paths, record);
  if (existing !== undefined) {
    if (existing.instance !== record.instance || existing.runId !== record.runId || existing.nonce !== record.nonce || existing.bindingDigest !== record.binding.bindingDigest) {
      throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The active stop intent is bound to different lifecycle state.");
    }
    return existing;
  }
  const intent: StopIntent = Object.freeze({
    schema: "urn:usf:lifecycle-stop-intent:1",
    version: 1,
    instance: record.instance,
    runId: record.runId,
    nonce: record.nonce,
    bindingDigest: record.binding.bindingDigest,
    requestedAt: clock.now().toISOString(),
    source,
  });
  const directory = runRecordDirectory(paths, record.runId);
  if (!(await atomicCreateJson(directory, "stop.json", intent, ids.temporaryId()))) {
    const raced = validateStopIntent(await readSecureJson(join(directory, "stop.json")));
    if (raced.instance !== record.instance || raced.runId !== record.runId || raced.nonce !== record.nonce || raced.bindingDigest !== record.binding.bindingDigest) {
      throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "A concurrent lifecycle stop intent names different state.");
    }
    return raced;
  }
  return validateStopIntent(await readSecureJson(join(directory, "stop.json")));
}

async function stopRequested(paths: LifecycleRuntimePaths, record: LifecycleRunRecord): Promise<boolean> {
  const intent = await existingStopIntentForRecord(paths, record);
  if (intent === undefined) return false;
  if (intent.instance !== record.instance || intent.runId !== record.runId || intent.nonce !== record.nonce || intent.bindingDigest !== record.binding.bindingDigest) {
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle stop intent does not match the active run.");
  }
  return true;
}

export interface LifecycleCycleContext {
  readonly binding: LifecycleBinding;
  readonly instance: string;
  readonly runId: string;
  readonly stopRequested: () => Promise<boolean>;
  readonly signal: AbortSignal;
}

export interface LifecycleCycleResult {
  readonly state: "idle" | "progress" | "stop";
  /** Current control identity plus dynamic graph/work observations. */
  readonly binding: LifecycleBinding;
  readonly reasonCode?: string;
}

export type LifecycleCycle = (context: LifecycleCycleContext) => LifecycleCycleResult | Promise<LifecycleCycleResult>;
export type LifecycleEventEmitter = (event: Readonly<Record<string, unknown>>) => void | Promise<void>;

export function lifecycleProfileObservationDigest(binding: LifecycleBinding): `sha256:${string}` {
  if (!isLifecycleBinding(binding)) throw lifecycleError(lifecycleReasonCodes.BINDING_INVALID, exitCodes.INVALID_INPUT, "The lifecycle observation binding is malformed.");
  return canonicalDigest({ graphSemanticDigest: binding.graphSemanticDigest, scopedDependencyDigests: binding.scopedDependencyDigests }, { rejectAbsolutePaths: true });
}

function changedWorkIds(previous: LifecycleBinding, current: LifecycleBinding): readonly string[] {
  const before = new Map(previous.scopedDependencyDigests.map((entry) => [entry.workId, entry.digest]));
  const after = new Map(current.scopedDependencyDigests.map((entry) => [entry.workId, entry.digest]));
  return Object.freeze([...new Set([...before.keys(), ...after.keys()])]
    .filter((workId) => before.get(workId) !== after.get(workId))
    .sort((left, right) => left.localeCompare(right)));
}

async function settlesWithin<T>(promise: Promise<T>, milliseconds: number): Promise<boolean> {
  return new Promise<boolean>((complete) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      complete(value);
    };
    const timer = setTimeout(() => finish(false), milliseconds);
    void promise.then(() => finish(true), () => finish(true));
  });
}

async function markReady(paths: LifecycleRuntimePaths, record: LifecycleRunRecord, clock: LifecycleClock, ids: LifecycleIdGenerator): Promise<LifecycleReadyRecord> {
  const ready: LifecycleReadyRecord = Object.freeze({
    schema: "urn:usf:lifecycle-ready:1",
    version: 1,
    instance: record.instance,
    runId: record.runId,
    nonce: record.nonce,
    bindingDigest: record.binding.bindingDigest,
    readyAt: clock.now().toISOString(),
  });
  validateReadyRecord(ready);
  const directory = runRecordDirectory(paths, record.runId);
  if (!(await atomicCreateJson(directory, "ready.json", ready, ids.temporaryId()))) {
    const existing = validateReadyRecord(await readSecureJson(join(directory, "ready.json")));
    if (canonicalJson(existing) !== canonicalJson(ready)) {
      throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "A readiness record already exists with different bytes.");
    }
    return existing;
  }
  return validateReadyRecord(await readSecureJson(join(directory, "ready.json")));
}

async function readReady(paths: LifecycleRuntimePaths, record: LifecycleRunRecord): Promise<LifecycleReadyRecord | undefined> {
  const path = join(runRecordDirectory(paths, record.runId), "ready.json");
  if (!(await exists(path))) return undefined;
  const ready = validateReadyRecord(await readSecureJson(path));
  if (ready.instance !== record.instance || ready.runId !== record.runId || ready.nonce !== record.nonce || ready.bindingDigest !== record.binding.bindingDigest) {
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The readiness record does not match its run.");
  }
  return ready;
}

async function completeRun(paths: LifecycleRuntimePaths, record: LifecycleRunRecord, lock: LifecycleInstanceLock, status: LifecycleReceipt["status"], reasonCode: string, clock: LifecycleClock, ids: LifecycleIdGenerator): Promise<LifecycleReceipt> {
  const receipt: LifecycleReceipt = Object.freeze({
    schema: "urn:usf:lifecycle-receipt:1",
    version: 1,
    instance: record.instance,
    runId: record.runId,
    bindingDigest: record.binding.bindingDigest,
    status,
    reasonCode,
    startedAt: record.timestamps.claimedAt,
    completedAt: clock.now().toISOString(),
    nonclaims: lifecycleNonclaims,
  });
  validateReceipt(receipt);
  const directory = runRecordDirectory(paths, record.runId);
  const receiptPath = join(directory, "receipt.json");
  if (!(await atomicCreateJson(directory, "receipt.json", receipt, ids.temporaryId()))) {
    const existing = validateReceipt(await readSecureJson(receiptPath));
    if (canonicalJson(existing) !== canonicalJson(receipt)) {
      throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "A lifecycle receipt already exists with different bytes.");
    }
  }
  const durable = validateReceipt(await readSecureJson(receiptPath));
  await installRecordLink(receiptPath, paths.completed, `${record.runId}.json`);
  if (!(await releaseActiveOwner(paths, record, lock))) {
    throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle owner changed before completion was released.");
  }
  return durable;
}

export interface RunForegroundLifecycleInput {
  readonly command: "start" | "watch";
  readonly repositoryRoot: string;
  readonly instance: string;
  readonly binding: LifecycleBinding;
  readonly initialCarrier: LifecycleCarrier;
  readonly cycle: LifecycleCycle;
  readonly emit: LifecycleEventEmitter;
  readonly processInspector?: ProcessInspector;
  readonly clock?: LifecycleClock;
  readonly ids?: LifecycleIdGenerator;
  readonly idleBackoff?: { readonly minimumMs: number; readonly maximumMs: number };
  readonly cycleTimeoutMs?: number;
  readonly drainTimeoutMs?: number;
  readonly stopPollMs?: number;
  readonly installSignalHandlers?: boolean;
}

export type ForegroundLifecycleResult =
  | { readonly schema: "urn:usf:lifecycle-result:1"; readonly status: "already-running"; readonly instance: string; readonly runId: string; readonly bindingDigest: string; readonly nonclaims: readonly string[] }
  | { readonly schema: "urn:usf:lifecycle-result:1"; readonly status: "stopped" | "degraded"; readonly instance: string; readonly runId: string; readonly bindingDigest: string; readonly reasonCode: string; readonly nonclaims: readonly string[] };

function lifecycleEvent(
  record: LifecycleRunRecord,
  command: "start" | "watch",
  status: "ready" | "already-running" | "observation" | "stopped" | "degraded",
  reasonCode?: string,
  binding: LifecycleBinding = record.binding,
  changedWork: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: "urn:usf:lifecycle-event:1",
    version: 1,
    command,
    status,
    instance: record.instance,
    runId: record.runId,
    profile: binding.profile,
    manifest: binding.manifest,
    through: binding.through,
    bindingDigest: binding.bindingDigest,
    graphSemanticDigest: binding.graphSemanticDigest,
    profileObservationDigest: lifecycleProfileObservationDigest(binding),
    scopedDependencyDigests: binding.scopedDependencyDigests,
    initialCarrier: record.initialCarrier,
    ...(changedWork.length === 0 ? {} : { changedWorkIds: changedWork }),
    ...(reasonCode === undefined ? {} : { reasonCode }),
    nonclaims: lifecycleNonclaims,
  });
}

export async function runForegroundLifecycle(input: RunForegroundLifecycleInput): Promise<ForegroundLifecycleResult> {
  const inspector = input.processInspector ?? linuxProcessInspector;
  const clock = input.clock ?? systemLifecycleClock;
  const ids = input.ids ?? randomLifecycleIds;
  const minimumMs = input.idleBackoff?.minimumMs ?? 100;
  const maximumMs = input.idleBackoff?.maximumMs ?? 1_000;
  const cycleTimeoutMs = input.cycleTimeoutMs ?? 600_000;
  const drainTimeoutMs = input.drainTimeoutMs ?? 300_000;
  const stopPollMs = input.stopPollMs ?? 25;
  if (!Number.isSafeInteger(minimumMs) || !Number.isSafeInteger(maximumMs) || minimumMs < 10 || maximumMs < minimumMs || maximumMs > 60_000) {
    throw lifecycleError("LIFECYCLE_BACKOFF_INVALID", exitCodes.INVALID_INPUT, "Lifecycle idle backoff is outside its bounded range.");
  }
  if (!Number.isSafeInteger(cycleTimeoutMs) || cycleTimeoutMs < 100 || cycleTimeoutMs > 3_600_000
    || !Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 0 || drainTimeoutMs > 600_000
    || !Number.isSafeInteger(stopPollMs) || stopPollMs < 10 || stopPollMs > 1_000) {
    throw lifecycleError("LIFECYCLE_TIMEOUT_INVALID", exitCodes.INVALID_INPUT, "Lifecycle cycle, drain, or stop-poll bounds are invalid.");
  }
  const processIdentity = await inspector.current();
  const claim = await claimLifecycleRun({
    repositoryRoot: input.repositoryRoot,
    instance: input.instance,
    binding: input.binding,
    initialCarrier: input.initialCarrier,
    processIdentity,
    clock,
    ids,
    processInspector: inspector,
  });
  if (claim.status === "already-running") {
    await input.emit(lifecycleEvent(claim.record, input.command, "already-running"));
    return { schema: "urn:usf:lifecycle-result:1", status: "already-running", instance: claim.record.instance, runId: claim.record.runId, bindingDigest: claim.record.binding.bindingDigest, nonclaims: lifecycleNonclaims };
  }
  const { record, paths, lock } = claim;
  let signal: "SIGINT" | "SIGTERM" | undefined;
  const stopping = new AbortController();
  const onSigint = () => { signal = "SIGINT"; stopping.abort(); };
  const onSigterm = () => { signal = "SIGTERM"; stopping.abort(); };
  if (input.installSignalHandlers !== false) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  }
  let finalStatus: "stopped" | "degraded" = "stopped";
  let reasonCode = "LIFECYCLE_STOP_REQUESTED";
  let backoffMs = minimumMs;
  let currentBinding = record.binding;
  try {
    await markReady(paths, record, clock, ids);
    await input.emit(lifecycleEvent(record, input.command, "ready", undefined, currentBinding));
    while (true) {
      if (signal !== undefined) await writeStopIntent(paths, record, signal, clock, ids);
      if (await stopRequested(paths, record)) break;
      const monitorCancellation = new AbortController();
      const cyclePromise = Promise.resolve(input.cycle({
        binding: currentBinding,
        instance: record.instance,
        runId: record.runId,
        stopRequested: () => stopRequested(paths, record),
        signal: stopping.signal,
      })).then(
        (value) => ({ kind: "cycle" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
      const stopPromise = new Promise<{ readonly kind: "stop" }>((complete) => {
        if (stopping.signal.aborted) { complete({ kind: "stop" }); return; }
        stopping.signal.addEventListener("abort", () => complete({ kind: "stop" }), { once: true });
      });
      const stopMonitor = (async (): Promise<void> => {
        while (!monitorCancellation.signal.aborted && !stopping.signal.aborted) {
          if (await stopRequested(paths, record)) { stopping.abort(); return; }
          await clock.sleep(stopPollMs, monitorCancellation.signal);
        }
      })();
      let cycleTimer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<{ readonly kind: "timeout" }>((complete) => {
        cycleTimer = setTimeout(() => { stopping.abort(); complete({ kind: "timeout" }); }, cycleTimeoutMs);
      });
      const outcome = await Promise.race([cyclePromise, stopPromise, timeoutPromise]);
      if (cycleTimer !== undefined) clearTimeout(cycleTimer);
      monitorCancellation.abort();
      await stopMonitor;
      if (outcome.kind === "stop" || outcome.kind === "timeout") {
        if (signal !== undefined) await writeStopIntent(paths, record, signal, clock, ids);
        const drain = await settlesWithin(cyclePromise, drainTimeoutMs);
        if (!drain) {
          finalStatus = "degraded";
          reasonCode = lifecycleReasonCodes.STOP_TIMEOUT;
          // AbortSignal is advisory. Retain both the filesystem owner and the
          // kernel lock until admitted work actually settles. A commodity
          // supervisor may force-kill the process; process death releases flock.
          await cyclePromise;
        } else if (outcome.kind === "timeout") {
          finalStatus = "degraded";
          reasonCode = lifecycleReasonCodes.CYCLE_TIMEOUT;
        }
        break;
      }
      if (outcome.kind === "error") {
        finalStatus = "degraded";
        reasonCode = outcome.error instanceof UsfError ? outcome.error.code : lifecycleReasonCodes.CYCLE_FAILED;
        break;
      }
      const cycleResult = outcome.value;
      if (!isRecord(cycleResult) || !["idle", "progress", "stop"].includes(String(cycleResult.state)) || !isLifecycleBinding(cycleResult.binding)
        || cycleResult.binding.bindingDigest !== record.binding.bindingDigest) {
        finalStatus = "degraded";
        reasonCode = lifecycleReasonCodes.CURRENTNESS_CHANGED;
        break;
      }
      const previousObservation = lifecycleProfileObservationDigest(currentBinding);
      const nextObservation = lifecycleProfileObservationDigest(cycleResult.binding);
      if (nextObservation !== previousObservation) {
        const changed = changedWorkIds(currentBinding, cycleResult.binding);
        currentBinding = cycleResult.binding;
        await input.emit(lifecycleEvent(record, input.command, "observation", "LIFECYCLE_PROFILE_OBSERVATION_CHANGED", currentBinding, changed));
      } else {
        currentBinding = cycleResult.binding;
      }
      if (cycleResult.state === "stop") {
        reasonCode = cycleResult.reasonCode ?? "LIFECYCLE_CYCLE_STOP_REQUESTED";
        if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(reasonCode)) {
          finalStatus = "degraded";
          reasonCode = lifecycleReasonCodes.CYCLE_FAILED;
        }
        break;
      }
      if (cycleResult.state === "idle") {
        await clock.sleep(backoffMs, stopping.signal);
        backoffMs = Math.min(maximumMs, backoffMs * 2);
      } else if (cycleResult.state === "progress") {
        backoffMs = minimumMs;
      } else {
        finalStatus = "degraded";
        reasonCode = lifecycleReasonCodes.CYCLE_FAILED;
        break;
      }
    }
  } catch (error) {
    finalStatus = "degraded";
    reasonCode = error instanceof UsfError ? error.code : lifecycleReasonCodes.CYCLE_FAILED;
  } finally {
    if (input.installSignalHandlers !== false) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
  }
  try {
    const receipt = await completeRun(paths, record, lock, finalStatus, reasonCode, clock, ids);
    await input.emit(lifecycleEvent(record, input.command, receipt.status, receipt.reasonCode, currentBinding));
    return { schema: "urn:usf:lifecycle-result:1", status: receipt.status, instance: record.instance, runId: record.runId, bindingDigest: record.binding.bindingDigest, reasonCode: receipt.reasonCode, nonclaims: lifecycleNonclaims };
  } finally {
    await lock.release();
  }
}

export interface RequestLifecycleStopInput {
  readonly repositoryRoot: string;
  readonly instance: string;
  readonly waitMs: number;
  readonly processInspector?: ProcessInspector;
  readonly clock?: LifecycleClock;
  readonly ids?: LifecycleIdGenerator;
}

export type StopLifecycleResult = Readonly<{
  schema: "urn:usf:lifecycle-stop-result:1";
  status: "stopped" | "already-stopped" | "degraded";
  instance: string;
  runId?: string;
  bindingDigest?: string;
  reasonCode: string;
  nonclaims: readonly string[];
}>;

export async function requestLifecycleStop(input: RequestLifecycleStopInput): Promise<StopLifecycleResult> {
  if (!Number.isSafeInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > 600_000) {
    throw lifecycleError("LIFECYCLE_WAIT_INVALID", exitCodes.INVALID_INPUT, "Lifecycle stop wait must be an integer from 0 through 600000 milliseconds.");
  }
  const inspector = input.processInspector ?? linuxProcessInspector;
  const clock = input.clock ?? systemLifecycleClock;
  const ids = input.ids ?? randomLifecycleIds;
  const paths = await lifecycleRuntimePaths(input.repositoryRoot, input.instance, false);
  if (!(await exists(paths.active))) return { schema: "urn:usf:lifecycle-stop-result:1", status: "already-stopped", instance: input.instance, reasonCode: "LIFECYCLE_NOT_RUNNING", nonclaims: lifecycleNonclaims };
  const record = await activeRecordOrUndefined(paths);
  if (record === undefined) return { schema: "urn:usf:lifecycle-stop-result:1", status: "already-stopped", instance: input.instance, reasonCode: "LIFECYCLE_NOT_RUNNING", nonclaims: lifecycleNonclaims };
  if (record.instance !== input.instance) throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The active record names a different lifecycle instance.");
  if (await activeLiveness(record, inspector) === "stale") {
    const lockAttempt = await acquireLifecycleInstanceLock(paths, input.instance);
    if (lockAttempt.status === "busy") {
      return { schema: "urn:usf:lifecycle-stop-result:1", status: "degraded", instance: record.instance, runId: record.runId, bindingDigest: record.binding.bindingDigest, reasonCode: lifecycleReasonCodes.LOCK_UNAVAILABLE, nonclaims: lifecycleNonclaims };
    }
    try {
      const current = await activeRecordOrUndefined(paths);
      if (current === undefined) {
        return { schema: "urn:usf:lifecycle-stop-result:1", status: "already-stopped", instance: input.instance, reasonCode: "LIFECYCLE_NOT_RUNNING", nonclaims: lifecycleNonclaims };
      }
      if (await activeLiveness(current, inspector) === "live") {
        return { schema: "urn:usf:lifecycle-stop-result:1", status: "degraded", instance: current.instance, runId: current.runId, bindingDigest: current.binding.bindingDigest, reasonCode: lifecycleReasonCodes.LOCK_UNAVAILABLE, nonclaims: lifecycleNonclaims };
      }
      const recovered = await recoverStaleActive(paths, current, lockAttempt.lock);
      if (!recovered.moved && recovered.receipt === undefined) {
        return { schema: "urn:usf:lifecycle-stop-result:1", status: "already-stopped", instance: current.instance, runId: current.runId, bindingDigest: current.binding.bindingDigest, reasonCode: "LIFECYCLE_NOT_RUNNING", nonclaims: lifecycleNonclaims };
      }
      if (recovered.receipt !== undefined) {
        return {
          schema: "urn:usf:lifecycle-stop-result:1",
          status: recovered.receipt.status,
          instance: recovered.receipt.instance,
          runId: recovered.receipt.runId,
          bindingDigest: recovered.receipt.bindingDigest,
          reasonCode: recovered.receipt.reasonCode,
          nonclaims: lifecycleNonclaims,
        };
      }
      return { schema: "urn:usf:lifecycle-stop-result:1", status: "degraded", instance: current.instance, runId: current.runId, bindingDigest: current.binding.bindingDigest, reasonCode: lifecycleReasonCodes.STALE_QUARANTINED, nonclaims: lifecycleNonclaims };
    } finally {
      await lockAttempt.lock.release();
    }
  }
  await writeStopIntent(paths, record, "command", clock, ids);
  const started = clock.now().getTime();
  let delay = 10;
  while (clock.now().getTime() - started <= input.waitMs) {
    const receiptPath = join(paths.completed, `${record.runId}.json`);
    if (await exists(receiptPath)) {
      const receipt = validateReceipt(await readSecureJson(receiptPath));
      if (receipt.instance !== record.instance || receipt.runId !== record.runId || receipt.bindingDigest !== record.binding.bindingDigest) {
        throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The lifecycle receipt does not match the requested stop.");
      }
      return { schema: "urn:usf:lifecycle-stop-result:1", status: receipt.status, instance: receipt.instance, runId: receipt.runId, bindingDigest: receipt.bindingDigest, reasonCode: receipt.reasonCode, nonclaims: lifecycleNonclaims };
    }
    if (clock.now().getTime() - started >= input.waitMs) break;
    await clock.sleep(Math.min(delay, input.waitMs - (clock.now().getTime() - started)));
    delay = Math.min(250, delay * 2);
  }
  return { schema: "urn:usf:lifecycle-stop-result:1", status: "degraded", instance: record.instance, runId: record.runId, bindingDigest: record.binding.bindingDigest, reasonCode: lifecycleReasonCodes.STOP_TIMEOUT, nonclaims: lifecycleNonclaims };
}

export type LifecycleStatusResult = Readonly<{
  schema: "urn:usf:lifecycle-status-result:1";
  status: "starting" | "running" | "stopping" | "stopped" | "stale";
  instance: string;
  runId?: string;
  bindingDigest?: string;
  profile?: string;
  manifest?: string;
  through?: LifecycleThrough;
  reasonCode: string;
  nonclaims: readonly string[];
}>;

export async function observeLifecycleStatus(repositoryRoot: string, instance: string, inspector: ProcessInspector = linuxProcessInspector): Promise<LifecycleStatusResult> {
  const paths = await lifecycleRuntimePaths(repositoryRoot, instance, false);
  if (!(await exists(paths.active))) return { schema: "urn:usf:lifecycle-status-result:1", status: "stopped", instance, reasonCode: "LIFECYCLE_NOT_RUNNING", nonclaims: lifecycleNonclaims };
  const record = await activeRecordOrUndefined(paths);
  if (record === undefined) return { schema: "urn:usf:lifecycle-status-result:1", status: "stopped", instance, reasonCode: "LIFECYCLE_NOT_RUNNING", nonclaims: lifecycleNonclaims };
  if (record.instance !== instance) throw lifecycleError(lifecycleReasonCodes.ACTIVE_AMBIGUOUS, exitCodes.CONTAINMENT_REFUSAL, "The active record names a different lifecycle instance.");
  let status: LifecycleStatusResult["status"];
  let reasonCode: string;
  if (await activeLiveness(record, inspector) === "stale") {
    status = "stale";
    reasonCode = "LIFECYCLE_STALE_OBSERVED";
  } else if (await exists(join(runRecordDirectory(paths, record.runId), "receipt.json")) || await stopRequested(paths, record)) {
    status = "stopping";
    reasonCode = "LIFECYCLE_STOPPING";
  } else if (await readReady(paths, record) !== undefined) {
    status = "running";
    reasonCode = "LIFECYCLE_RUNNING";
  } else {
    status = "starting";
    reasonCode = "LIFECYCLE_STARTING";
  }
  return {
    schema: "urn:usf:lifecycle-status-result:1",
    status,
    instance,
    runId: record.runId,
    bindingDigest: record.binding.bindingDigest,
    profile: record.binding.profile,
    manifest: record.binding.manifest,
    through: record.binding.through,
    reasonCode,
    nonclaims: lifecycleNonclaims,
  };
}
