import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, sha256 } from "../core/canonical.ts";
import { exitCodes, UsfError, type ExitCode } from "../core/errors.ts";
import { linuxProcessInspector, type ProcessIdentity, type ProcessInspector } from "./lifecycle.ts";

const directoryMode = 0o700;
const fileMode = 0o600;
const maxRecordBytes = 16 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const agentPattern = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/u;

export const stewardshipReasonCodes = Object.freeze({
  SESSION_REQUIRED: "STEWARD_SESSION_REQUIRED",
  CLAIM_INVALID: "STEWARD_CLAIM_INVALID",
  AGENT_INVALID: "STEWARD_AGENT_INVALID",
  RECORD_UNSAFE: "STEWARD_RECORD_UNSAFE",
  RECORD_INVALID: "STEWARD_RECORD_INVALID",
  ACTIVITY_BUSY: "STEWARD_ACTIVITY_BUSY",
  PRIMARY_BUSY: "STEWARD_PRIMARY_MUTATION_BUSY",
  PENDING_TRANSACTION: "STEWARD_PENDING_TRANSACTION",
  OWNERSHIP_CONFLICT: "STEWARD_OWNERSHIP_CONFLICT",
  CLAIM_STALE: "STEWARD_CLAIM_STALE",
  RECOVERY_REQUIRED: "STEWARD_RECOVERY_REQUIRED",
  ACTION_UNKNOWN: "STEWARD_ACTION_UNKNOWN",
  SECONDS_INVALID: "STEWARD_SECONDS_INVALID",
  POLICY_INVALID: "STEWARD_POLICY_INVALID",
} as const);

type StewardshipState = "active" | "handoff" | "released";

export interface StewardshipRecord {
  readonly schema: "urn:usf:stewardship:1";
  readonly version: 1;
  readonly state: StewardshipState;
  readonly claimId: `sha256:${string}`;
  readonly generation: `sha256:${string}`;
  readonly sessionDigest: `sha256:${string}`;
  readonly agent: string;
  /** The durable controller parent, never the short-lived CLI wrapper. */
  readonly process: ProcessIdentity;
  readonly supervisor: ProcessIdentity | null;
  readonly renewedAtBootSeconds: number;
  readonly expiresAtBootSeconds: number;
}

export interface StewardshipClock { readonly monotonicSeconds: () => Promise<number>; }
export interface StewardshipDependencies {
  readonly inspector?: ProcessInspector;
  readonly clock?: StewardshipClock;
  readonly sessionId?: string;
  readonly supervisor?: ProcessIdentity | null;
  /** Tests supply an exact durable parent identity; production inspects ppid. */
  readonly controller?: ProcessIdentity;
  readonly adapters?: StewardshipAdapters;
}
export interface StewardshipAdapters {
  readonly renewalPolicy: () => Promise<RenewalPolicy>;
  readonly currentSupervisor: () => Promise<ProcessIdentity | null>;
  readonly pendingTransactions: () => Promise<readonly string[]>;
  readonly acquirePrimaryMutation: () => Promise<{ readonly release: () => Promise<void> }>;
}
export interface StewardshipLock { readonly held: () => boolean; readonly release: () => Promise<void>; }
export interface StewardshipStatus {
  readonly schema: "urn:usf:stewardship-status:1";
  readonly status: "absent" | "live" | "dead" | "expired" | "handoff-ready" | "released";
  readonly activeActivity: boolean | "absent" | "unknown";
  readonly primaryMutation: "absent" | "idle" | "active" | "unknown";
  readonly supervisor: "unbound" | "absent" | "live" | "stale";
  readonly currentSupervisor: "absent" | "live" | "stale";
  readonly record?: Omit<StewardshipRecord, "sessionDigest">;
}

function refuse(code: string, message: string, exitCode: ExitCode = exitCodes.CONTINUOUS_DEGRADED): UsfError {
  return new UsfError(code, exitCode, message);
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (process.platform !== "linux" || uid === undefined || uid === 0) {
    throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship requires a non-root Linux owner.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return uid;
}

const maxUidMapBytes = 256;
const uidMapRowPattern = /^[ \t]*([0-9]{1,10})[ \t]+([0-9]{1,10})[ \t]+([0-9]{1,10})[ \t]*(?:\r?\n)?(?![\s\S])/u;

export function isExactRootUidMap(raw: Uint8Array): boolean {
  if (raw.byteLength === 0 || raw.byteLength > maxUidMapBytes) return false;
  for (const byte of raw) if (byte > 0x7f) return false;
  const match = uidMapRowPattern.exec(Buffer.from(raw).toString("ascii"));
  if (match === null) return false;
  return Number(match[1]) === 1000 && Number(match[2]) === 0 && Number(match[3]) === 1;
}

async function trustedRootOwnedToolUid(uid: number): Promise<boolean> {
  if (uid === 0) return true;
  if (uid !== 65534 || currentUid() !== 1000) return false;
  const uidMap = await readFile("/proc/self/uid_map").catch(() => undefined);
  return uidMap !== undefined && isExactRootUidMap(uidMap);
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean { return canonicalJson(left) === canonicalJson(right); }

function isDigest(value: unknown): value is `sha256:${string}` { return typeof value === "string" && digestPattern.test(value); }

function publicRecord(record: StewardshipRecord): Omit<StewardshipRecord, "sessionDigest"> {
  const { sessionDigest: _sessionDigest, ...safe } = record;
  return safe;
}

async function systemMonotonicSeconds(): Promise<number> {
  const source = await readFile("/proc/uptime", "utf8").catch(() => {
    throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Linux boot-monotonic time is unavailable.");
  });
  const value = Number(source.trim().split(/\s+/u)[0]);
  if (!Number.isFinite(value) || value < 0) throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Linux boot-monotonic time is malformed.");
  return value;
}

const systemClock: StewardshipClock = Object.freeze({ monotonicSeconds: systemMonotonicSeconds });

function runtimePaths(repositoryRoot: string): { readonly root: string; readonly base: string; readonly record: string; readonly activity: string; readonly supervisorLifetime: string } {
  const root = realpathSync(resolve(repositoryRoot));
  const base = join(root, ".usf", "hermes", "stewardship");
  return Object.freeze({ root, base, record: join(base, "record.json"), activity: join(base, "activity.lock"), supervisorLifetime: join(root, ".usf", "hermes", "supervisor", "lifetime.lock") });
}

async function secureDirectory(path: string, create: boolean): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: directoryMode });
  const metadata = await lstat(path).catch(() => {
    throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "A stewardship runtime directory is unavailable.", exitCodes.CONTAINMENT_REFUSAL);
  });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid() || (metadata.mode & 0o777) !== directoryMode) {
    throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship runtime directories must be owner-private real directories.", exitCodes.CONTAINMENT_REFUSAL);
  }
}

async function ensureStewardshipDirectories(root: string): Promise<void> {
  await secureDirectory(join(root, ".usf"), true);
  await secureDirectory(join(root, ".usf", "hermes"), true);
  await secureDirectory(join(root, ".usf", "hermes", "stewardship"), true);
}

async function validateStewardshipParents(root: string): Promise<void> {
  await secureDirectory(join(root, ".usf"), false);
  for (const path of [join(root, ".usf", "hermes"), join(root, ".usf", "hermes", "stewardship")]) await secureDirectory(path, false);
}

/**
 * Absent-record observation guard.  A genuinely missing private runtime
 * subtree is ordinary absent state, but any stewardship ancestor that does
 * exist must already be an owner-private real directory; unsafe, shared, or
 * redirected ancestors fail closed without creating any runtime state.
 */
async function refuseUnsafeExistingStewardshipParents(root: string): Promise<void> {
  for (const path of [join(root, ".usf"), join(root, ".usf", "hermes"), join(root, ".usf", "hermes", "stewardship")]) {
    const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "A stewardship runtime directory is unavailable.", exitCodes.CONTAINMENT_REFUSAL);
    });
    if (metadata === undefined) return;
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid() || (metadata.mode & 0o777) !== directoryMode) {
      throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship runtime directories must be owner-private real directories.", exitCodes.CONTAINMENT_REFUSAL);
    }
  }
}

function validIdentity(value: unknown): value is ProcessIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join("|") === ["argvDigest", "bootId", "executablePathDigest", "pid", "startTicks", "uid"].join("|")
    && Number.isSafeInteger(item.pid) && Number(item.pid) > 0 && Number.isSafeInteger(item.uid) && Number(item.uid) >= 0
    && typeof item.bootId === "string" && typeof item.startTicks === "string" && isDigest(item.argvDigest) && isDigest(item.executablePathDigest);
}

function parseRecord(value: unknown): StewardshipRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw refuse(stewardshipReasonCodes.RECORD_INVALID, "Stewardship record is malformed.", exitCodes.CONTAINMENT_REFUSAL);
  const item = value as Record<string, unknown>;
  const keys = ["agent", "claimId", "expiresAtBootSeconds", "generation", "process", "renewedAtBootSeconds", "schema", "sessionDigest", "state", "supervisor", "version"];
  if (Object.keys(item).sort().join("|") !== keys.sort().join("|") || item.schema !== "urn:usf:stewardship:1" || item.version !== 1
    || !["active", "handoff", "released"].includes(String(item.state)) || !isDigest(item.claimId) || !isDigest(item.generation) || !isDigest(item.sessionDigest)
    || typeof item.agent !== "string" || !agentPattern.test(item.agent) || !validIdentity(item.process) || !(item.supervisor === null || validIdentity(item.supervisor))
    || !Number.isFinite(item.renewedAtBootSeconds) || !Number.isFinite(item.expiresAtBootSeconds) || Number(item.expiresAtBootSeconds) < Number(item.renewedAtBootSeconds)) {
    throw refuse(stewardshipReasonCodes.RECORD_INVALID, "Stewardship record is malformed.", exitCodes.CONTAINMENT_REFUSAL);
  }
  return item as unknown as StewardshipRecord;
}

async function readRecord(root: string): Promise<StewardshipRecord | undefined> {
  const path = runtimePaths(root).record;
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (metadata === undefined) {
    await refuseUnsafeExistingStewardshipParents(runtimePaths(root).root);
    return undefined;
  }
  await validateStewardshipParents(runtimePaths(root).root);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== currentUid() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== fileMode || metadata.size < 2 || metadata.size > maxRecordBytes) {
    throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship record is unsafe.", exitCodes.CONTAINMENT_REFUSAL);
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => {
    throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship record cannot be opened safely.", exitCodes.CONTAINMENT_REFUSAL);
  });
  try {
    const opened = await handle.stat();
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.nlink !== 1) throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship record changed while read.", exitCodes.CONTAINMENT_REFUSAL);
    return parseRecord(JSON.parse((await handle.readFile()).toString("utf8")));
  } catch (error) {
    if (error instanceof UsfError) throw error;
    throw refuse(stewardshipReasonCodes.RECORD_INVALID, "Stewardship record is not valid JSON.", exitCodes.CONTAINMENT_REFUSAL);
  } finally { await handle.close(); }
}

async function writeRecord(root: string, record: StewardshipRecord): Promise<void> {
  const runtime = runtimePaths(root);
  await ensureStewardshipDirectories(runtime.root);
  const temporary = join(runtime.base, `.record.json.tmp-${randomBytes(16).toString("hex")}`);
  const bytes = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), fileMode);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    await rename(temporary, runtime.record);
    const directory = await open(runtime.base, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(() => undefined); }
  const actual = await readRecord(runtime.root);
  if (actual === undefined || canonicalJson(actual) !== canonicalJson(record)) throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship record write did not read back.", exitCodes.CONTAINMENT_REFUSAL);
}

async function acquireFlock(root: string, lockPath: string, create: boolean): Promise<StewardshipLock | undefined> {
  if (create) await secureDirectory(join(lockPath, ".."), true);
  else {
    const parent = await lstat(join(lockPath, "..")).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (parent === undefined) return undefined;
    await secureDirectory(join(lockPath, ".."), false);
  }
  let handle: FileHandle;
  try { handle = await open(lockPath, (create ? constants.O_CREAT : 0) | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), fileMode); }
  catch (error) { if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship lock cannot be opened safely.", exitCodes.CONTAINMENT_REFUSAL); }
  try {
    const opened = await handle.stat();
    const named = await lstat(lockPath);
    if (!opened.isFile() || named.isSymbolicLink() || !named.isFile() || opened.uid !== currentUid() || opened.nlink !== 1 || named.nlink !== 1 || (opened.mode & 0o777) !== fileMode || opened.dev !== named.dev || opened.ino !== named.ino) throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship lock is unsafe.", exitCodes.CONTAINMENT_REFUSAL);
    const flock = await lstat("/usr/bin/flock").catch(() => {
      throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "The trusted util-linux flock executable is unavailable.");
    });
    if (!flock.isFile() || flock.isSymbolicLink() || !await trustedRootOwnedToolUid(flock.uid) || (flock.mode & 0o022) !== 0 || (flock.mode & 0o111) === 0) {
      throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "The util-linux flock executable does not satisfy the host trust boundary.");
    }
    const code = await new Promise<number>((done) => { const child = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] }); child.once("error", () => done(127)); child.once("exit", (status) => done(status ?? 127)); });
    if (code === 75) { await handle.close(); return undefined; }
    if (code !== 0) throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "The trusted activity lock is unavailable.");
    const held = await handle.stat();
    const namedAfter = await lstat(lockPath);
    if (held.dev !== opened.dev || held.ino !== opened.ino || held.nlink !== 1 || namedAfter.dev !== held.dev || namedAfter.ino !== held.ino || namedAfter.nlink !== 1) throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "Stewardship lock changed while acquired.", exitCodes.CONTAINMENT_REFUSAL);
    let released = false;
    return Object.freeze({ held: () => !released, release: async () => { if (!released) { released = true; await handle.close(); } } });
  } catch (error) { await handle.close().catch(() => undefined); throw error; }
}

export async function acquireStewardActivity(root: string): Promise<StewardshipLock> {
  const runtime = runtimePaths(root);
  const lock = await acquireFlock(runtime.root, runtime.activity, true);
  if (lock === undefined) throw refuse(stewardshipReasonCodes.ACTIVITY_BUSY, "Another steward operation or supervisor cycle is active.");
  return lock;
}

/** A detached supervisor retains this for its lifetime; start admission holds it while creating its record. */
export async function acquireSupervisorLifetimeLock(root: string): Promise<StewardshipLock> {
  const runtime = runtimePaths(root);
  await secureDirectory(join(runtime.root, ".usf"), true);
  await secureDirectory(join(runtime.root, ".usf", "hermes"), true);
  await secureDirectory(join(runtime.root, ".usf", "hermes", "supervisor"), true);
  const lock = await acquireFlock(runtime.root, runtime.supervisorLifetime, true);
  if (lock === undefined) throw refuse(stewardshipReasonCodes.ACTIVITY_BUSY, "A Hermes supervisor is already live or starting.");
  return lock;
}

async function observeActivity(root: string): Promise<boolean | "absent" | "unknown"> {
  try {
    const runtime = runtimePaths(root);
    const lock = await acquireFlock(runtime.root, runtime.activity, false);
    if (lock === undefined) {
      const exists = await lstat(runtime.activity).then(() => true, () => false);
      return exists ? true : "absent";
    }
    await lock.release();
    return false;
  } catch { return "unknown"; }
}

interface RenewalPolicy { readonly defaultSeconds: number; readonly minimumSeconds: number; readonly maximumSeconds: number; }

function adapters(dependencies: StewardshipDependencies): StewardshipAdapters {
  if (dependencies.adapters === undefined) throw refuse("STEWARD_ADAPTER_UNAVAILABLE", "Stewardship execution adapters are required.", exitCodes.CONTINUOUS_DEGRADED);
  return dependencies.adapters;
}

async function renewalPolicy(dependencies: StewardshipDependencies): Promise<RenewalPolicy> {
  try {
    const policy = await adapters(dependencies).renewalPolicy();
    if (!Number.isInteger(policy.defaultSeconds) || !Number.isInteger(policy.minimumSeconds) || !Number.isInteger(policy.maximumSeconds)) throw new Error("integer");
    if (policy.minimumSeconds > policy.defaultSeconds || policy.defaultSeconds > policy.maximumSeconds) throw new Error("order");
    return policy;
  } catch { throw refuse(stewardshipReasonCodes.POLICY_INVALID, "The graph-selected stewardship renewal policy is absent or ambiguous."); }
}

async function renewalSeconds(dependencies: StewardshipDependencies, value: number | undefined): Promise<number> {
  const policy = await renewalPolicy(dependencies);
  const result = value ?? policy.defaultSeconds;
  if (!Number.isInteger(result) || result < policy.minimumSeconds || result > policy.maximumSeconds) throw refuse(stewardshipReasonCodes.SECONDS_INVALID, "Renewal seconds are outside the graph-selected stewardship policy.", exitCodes.INVALID_INPUT);
  return result;
}

function sessionDigest(dependencies: StewardshipDependencies): `sha256:${string}` {
  const value = dependencies.sessionId ?? process.env.USF_STEWARD_SESSION_ID;
  if (typeof value !== "string" || value.length < 16 || value.length > 1024) throw refuse(stewardshipReasonCodes.SESSION_REQUIRED, "USF_STEWARD_SESSION_ID is required and is never persisted directly.", exitCodes.INVALID_INPUT);
  return sha256(value);
}

async function controllerIdentity(dependencies: StewardshipDependencies, inspector: ProcessInspector): Promise<ProcessIdentity> {
  if (dependencies.controller !== undefined) return dependencies.controller;
  const parent = await inspector.inspect(process.ppid);
  if (parent === null || parent.uid !== currentUid()) throw refuse(stewardshipReasonCodes.RECORD_UNSAFE, "A durable same-owner controlling parent process is required.");
  return parent;
}

async function liveness(record: StewardshipRecord, inspector: ProcessInspector, clock: StewardshipClock): Promise<"live" | "dead" | "expired"> {
  const observed = await inspector.inspect(record.process.pid);
  if (observed === null || !sameIdentity(observed, record.process)) return "dead";
  return (await clock.monotonicSeconds()) >= record.expiresAtBootSeconds ? "expired" : "live";
}

function assertClaim(record: StewardshipRecord, claimId: string, session: string): void {
  if (!isDigest(claimId)) throw refuse(stewardshipReasonCodes.CLAIM_INVALID, "A canonical claim ID is required.", exitCodes.INVALID_INPUT);
  if (record.state !== "active" || record.claimId !== claimId || record.sessionDigest !== session) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "The stewardship claim is no longer current.", exitCodes.CURRENTNESS_FAILURE);
}

function assertGeneration(record: StewardshipRecord, generation: string): void {
  if (!isDigest(generation) || record.generation !== generation) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "The stewardship generation is no longer current.", exitCodes.CURRENTNESS_FAILURE);
}

async function assertCallerController(record: StewardshipRecord, dependencies: StewardshipDependencies, inspector: ProcessInspector): Promise<void> {
  const controller = await controllerIdentity(dependencies, inspector);
  if (!sameIdentity(record.process, controller)) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "The invoking controller does not own this stewardship claim.", exitCodes.CURRENTNESS_FAILURE);
}

async function observePrimaryMutation(root: string): Promise<StewardshipStatus["primaryMutation"]> {
  const canonical = runtimePaths(root).root;
  const locks = join(canonical, ".usf", "locks");
  const path = join(locks, "primary-mutation.lock");
  try { await secureDirectory(join(canonical, ".usf"), false); await secureDirectory(locks, false); } catch { return "unknown"; }
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (metadata === undefined) return "absent";
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== currentUid() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== fileMode) return "unknown";
  const handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0)).catch(() => undefined);
  if (handle === undefined) return "unknown";
  try {
    const opened = await handle.stat();
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.nlink !== 1) return "unknown";
    const flock = await lstat("/usr/bin/flock").catch(() => undefined);
    if (flock === undefined || !flock.isFile() || flock.isSymbolicLink() || !await trustedRootOwnedToolUid(flock.uid) || (flock.mode & 0o022) !== 0 || (flock.mode & 0o111) === 0) return "unknown";
    const code = await new Promise<number>((done) => { const child = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] }); child.once("error", () => done(127)); child.once("exit", (status) => done(status ?? 127)); });
    return code === 0 ? "idle" : code === 75 ? "active" : "unknown";
  } finally { await handle.close(); }
}

async function assertNoPendingTransaction(dependencies: StewardshipDependencies): Promise<void> {
  if ((await adapters(dependencies).pendingTransactions()).length > 0) {
    throw refuse(stewardshipReasonCodes.PENDING_TRANSACTION, "A durable transaction is pending; stewardship mutation must wait.", exitCodes.CURRENTNESS_FAILURE);
  }
}

async function withClaimTransition<T>(root: string, dependencies: StewardshipDependencies, action: () => Promise<T>): Promise<T> {
  const activity = await acquireStewardActivity(root);
  let primary: { readonly release: () => Promise<void> } | undefined;
  try {
    await assertNoPendingTransaction(dependencies);
    try { primary = await adapters(dependencies).acquirePrimaryMutation(); }
    catch { throw refuse(stewardshipReasonCodes.PRIMARY_BUSY, "Primary mutation is active or unavailable."); }
    return await action();
  } finally {
    await primary?.release();
    await activity.release();
  }
}

export async function observeStewardship(root: string, dependencies: StewardshipDependencies = {}): Promise<StewardshipStatus> {
  const record = await readRecord(root);
  const activeActivity = await observeActivity(root);
  const primaryMutation = await observePrimaryMutation(root);
  const actualSupervisor = await adapters(dependencies).currentSupervisor();
  const currentSupervisor = actualSupervisor === null ? "absent" : "live";
  if (record === undefined) return { schema: "urn:usf:stewardship-status:1", status: "absent", activeActivity, primaryMutation, supervisor: "unbound", currentSupervisor };
  const life = await liveness(record, dependencies.inspector ?? linuxProcessInspector, dependencies.clock ?? systemClock);
  const status: StewardshipStatus["status"] = record.state === "released" ? "released" : record.state === "handoff" && life === "live" ? "handoff-ready" : life;
  const supervisorObserved = record.supervisor === null ? null : await (dependencies.inspector ?? linuxProcessInspector).inspect(record.supervisor.pid);
  const supervisor = record.supervisor === null ? "unbound" : supervisorObserved !== null && sameIdentity(record.supervisor, supervisorObserved) ? "live" : "stale";
  return { schema: "urn:usf:stewardship-status:1", status, activeActivity, primaryMutation, supervisor, currentSupervisor, record: publicRecord(record) };
}

export async function claimStewardship(root: string, input: { readonly agent: string; readonly seconds?: number; readonly claimId?: string; readonly recover?: boolean; readonly dependencies?: StewardshipDependencies }): Promise<{ readonly status: "claimed" | "replayed" | "recovered"; readonly record: Omit<StewardshipRecord, "sessionDigest"> }> {
  if (!agentPattern.test(input.agent)) throw refuse(stewardshipReasonCodes.AGENT_INVALID, "Agent label is invalid.", exitCodes.INVALID_INPUT);
  const dependencies = input.dependencies ?? {};
  const inspector = dependencies.inspector ?? linuxProcessInspector;
  const clock = dependencies.clock ?? systemClock;
  const session = sessionDigest(dependencies);
  const controller = await controllerIdentity(dependencies, inspector);
  return withClaimTransition(root, dependencies, async () => {
    const existing = await readRecord(root);
    if (existing !== undefined) {
      const life = await liveness(existing, inspector, clock);
      if (life === "live" && existing.state === "active" && existing.sessionDigest === session && sameIdentity(existing.process, controller)) {
        const supervisor = dependencies.supervisor ?? await adapters(dependencies).currentSupervisor();
        if (existing.agent !== input.agent || canonicalJson(existing.supervisor) !== canonicalJson(supervisor)) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Replay cannot relabel the steward or change its supervisor binding.", exitCodes.CURRENTNESS_FAILURE);
        if (input.seconds !== undefined && await renewalSeconds(dependencies, input.seconds) !== existing.expiresAtBootSeconds - existing.renewedAtBootSeconds) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Replay cannot silently change a live claim renewal policy.", exitCodes.CURRENTNESS_FAILURE);
        return { status: "replayed", record: publicRecord(existing) };
      }
      if (life === "live" && existing.state === "active") throw refuse(stewardshipReasonCodes.OWNERSHIP_CONFLICT, "Another live steward owns this repository.");
      if (existing.state !== "handoff" && existing.state !== "released" && !input.recover) throw refuse(stewardshipReasonCodes.RECOVERY_REQUIRED, "Dead or expired stewardship requires explicit recover.");
    }
    const claimId = input.claimId ?? sha256(randomBytes(32));
    if (!isDigest(claimId)) throw refuse(stewardshipReasonCodes.CLAIM_INVALID, "Claim ID must be a SHA-256 digest.", exitCodes.INVALID_INPUT);
    const recheckedController = await controllerIdentity(dependencies, inspector);
    if (!sameIdentity(controller, recheckedController)) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "The controlling parent changed before stewardship publication.", exitCodes.CURRENTNESS_FAILURE);
    const supervisor = dependencies.supervisor ?? await adapters(dependencies).currentSupervisor();
    const now = await clock.monotonicSeconds();
    const record: StewardshipRecord = Object.freeze({
      schema: "urn:usf:stewardship:1", version: 1, state: "active", claimId,
      generation: sha256(canonicalJson({ claimId, session, agent: input.agent, controller, supervisor, prior: existing?.generation ?? null })),
      sessionDigest: session, agent: input.agent, process: controller, supervisor,
      renewedAtBootSeconds: now, expiresAtBootSeconds: now + await renewalSeconds(dependencies, input.seconds),
    });
    await writeRecord(root, record);
    return { status: existing === undefined || existing.state === "handoff" || existing.state === "released" ? "claimed" : "recovered", record: publicRecord(record) };
  });
}

export async function renewStewardship(root: string, claimId: string, generation: string, seconds: number | undefined, dependencies: StewardshipDependencies = {}): Promise<Omit<StewardshipRecord, "sessionDigest">> {
  return withClaimTransition(root, dependencies, async () => {
    const record = await readRecord(root);
    if (record === undefined) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "No stewardship claim exists.");
    assertClaim(record, claimId, sessionDigest(dependencies));
    assertGeneration(record, generation);
    await assertCallerController(record, dependencies, dependencies.inspector ?? linuxProcessInspector);
    if (await liveness(record, dependencies.inspector ?? linuxProcessInspector, dependencies.clock ?? systemClock) !== "live") throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Expired or dead stewardship cannot renew itself.", exitCodes.CURRENTNESS_FAILURE);
    const now = await (dependencies.clock ?? systemClock).monotonicSeconds();
    const next: StewardshipRecord = Object.freeze({ ...record, renewedAtBootSeconds: now, expiresAtBootSeconds: now + await renewalSeconds(dependencies, seconds) });
    await writeRecord(root, next);
    return publicRecord(next);
  });
}

export async function handoffStewardship(root: string, claimId: string, generation: string, dependencies: StewardshipDependencies = {}): Promise<Omit<StewardshipRecord, "sessionDigest">> {
  return withClaimTransition(root, dependencies, async () => {
    const record = await readRecord(root);
    if (record === undefined) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "No stewardship claim exists.");
    assertClaim(record, claimId, sessionDigest(dependencies));
    assertGeneration(record, generation);
    await assertCallerController(record, dependencies, dependencies.inspector ?? linuxProcessInspector);
    if (await liveness(record, dependencies.inspector ?? linuxProcessInspector, dependencies.clock ?? systemClock) !== "live") throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Dead or expired stewardship cannot hand off.", exitCodes.CURRENTNESS_FAILURE);
    const next: StewardshipRecord = Object.freeze({ ...record, state: "handoff" });
    await writeRecord(root, next);
    return publicRecord(next);
  });
}

export async function releaseStewardship(root: string, claimId: string, generation: string, dependencies: StewardshipDependencies = {}): Promise<Omit<StewardshipRecord, "sessionDigest">> {
  return withClaimTransition(root, dependencies, async () => {
    const record = await readRecord(root);
    if (record === undefined) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "No stewardship claim exists.");
    if (record.state === "released" && record.claimId === claimId && record.generation === generation && record.sessionDigest === sessionDigest(dependencies)) return publicRecord(record);
    assertClaim(record, claimId, sessionDigest(dependencies));
    assertGeneration(record, generation);
    await assertCallerController(record, dependencies, dependencies.inspector ?? linuxProcessInspector);
    if (await liveness(record, dependencies.inspector ?? linuxProcessInspector, dependencies.clock ?? systemClock) !== "live") throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Dead or expired stewardship cannot release itself.", exitCodes.CURRENTNESS_FAILURE);
    const next: StewardshipRecord = Object.freeze({ ...record, state: "released" });
    await writeRecord(root, next);
    return publicRecord(next);
  });
}

export async function withStewardedOperation<T>(root: string, claimId: string, generation: string, action: () => Promise<T>, dependencies: StewardshipDependencies = {}): Promise<T> {
  return withOperationalExclusion(root, claimId, generation, action, { requireClaim: true, dependencies });
}

/**
 * Serialises a manual operation with Hermes and validates a live claim if one
 * exists.  The absence decision and callback share the activity lock, so a
 * claim cannot appear between a legacy compatibility check and its mutation.
 */
export async function withOperationalExclusion<T>(root: string, claimId: string | undefined, generation: string | undefined, action: () => Promise<T>, options: { readonly requireClaim: boolean; readonly requireClaimWhenAbsent?: () => Promise<boolean>; readonly dependencies?: StewardshipDependencies }): Promise<T> {
  const activity = await acquireStewardActivity(root);
  try {
    await assertNoPendingTransaction(options.dependencies ?? {});
    const record = await readRecord(root);
    if (record === undefined) {
      if (options.requireClaim || await options.requireClaimWhenAbsent?.() === true) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "A live stewardship claim is required.", exitCodes.CURRENTNESS_FAILURE);
      return await action();
    }
    if (claimId === undefined) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "An existing stewardship record requires its current claim.", exitCodes.CURRENTNESS_FAILURE);
    const dependencies = options.dependencies ?? {};
    assertClaim(record, claimId, sessionDigest(dependencies));
    assertGeneration(record, generation ?? "");
    await assertCallerController(record, dependencies, dependencies.inspector ?? linuxProcessInspector);
    if (await liveness(record, dependencies.inspector ?? linuxProcessInspector, dependencies.clock ?? systemClock) !== "live") throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Stewardship is no longer live.", exitCodes.CURRENTNESS_FAILURE);
    return await action();
  } finally { await activity.release(); }
}

/**
 * Lifecycle admission uses this only while it already holds the activity lock.
 * It updates a current null supervisor binding to the exact newly admitted
 * process; it cannot create, transfer, renew, or release a stewardship claim.
 */
export async function bindSupervisorToActiveClaimUnderActivity(root: string, claimId: string, generation: string, supervisor: ProcessIdentity, dependencies: StewardshipDependencies = {}): Promise<Omit<StewardshipRecord, "sessionDigest">> {
  if (!validIdentity(supervisor)) throw refuse(stewardshipReasonCodes.RECORD_INVALID, "The admitted supervisor identity is malformed.", exitCodes.INVALID_INPUT);
  const record = await readRecord(root);
  if (record === undefined) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "No stewardship claim exists.");
  const inspector = dependencies.inspector ?? linuxProcessInspector;
  assertClaim(record, claimId, sessionDigest(dependencies));
  assertGeneration(record, generation);
  await assertCallerController(record, dependencies, inspector);
  if (await liveness(record, inspector, dependencies.clock ?? systemClock) !== "live") throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Stewardship is no longer live.", exitCodes.CURRENTNESS_FAILURE);
  const observed = await inspector.inspect(supervisor.pid);
  if (observed === null || !sameIdentity(observed, supervisor)) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "The admitted supervisor identity is not live.", exitCodes.CURRENTNESS_FAILURE);
  if (record.supervisor !== null && !sameIdentity(record.supervisor, supervisor)) {
    const prior = await inspector.inspect(record.supervisor.pid);
    if (prior !== null && sameIdentity(prior, record.supervisor)) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "The active claim is bound to another live supervisor.", exitCodes.CURRENTNESS_FAILURE);
  }
  const next: StewardshipRecord = Object.freeze({ ...record, supervisor });
  await writeRecord(root, next);
  return publicRecord(next);
}

/**
 * Read-only child-side admission check.  Lifecycle admission validates a
 * one-shot private admission record and token together with the exact child
 * and starter identities; the controller-authenticated bind above always
 * precedes this child-side verification.
 */
export async function verifyAdmittedSupervisorBinding(root: string, claimId: string, generation: string, supervisor: ProcessIdentity, starter: ProcessIdentity, dependencies: StewardshipDependencies = {}): Promise<void> {
  const record = await readRecord(root);
  if (record === undefined) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "No stewardship claim exists.");
  const inspector = dependencies.inspector ?? linuxProcessInspector;
  assertClaim(record, claimId, sessionDigest(dependencies));
  assertGeneration(record, generation);
  if (await liveness(record, inspector, dependencies.clock ?? systemClock) !== "live") throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Stewardship is no longer live.", exitCodes.CURRENTNESS_FAILURE);
  const actualSupervisor = await inspector.inspect(supervisor.pid);
  if (actualSupervisor === null || !sameIdentity(actualSupervisor, supervisor) || record.supervisor === null || !sameIdentity(record.supervisor, supervisor)) {
    throw refuse(stewardshipReasonCodes.CLAIM_STALE, "The admitted supervisor binding is not exact and live.", exitCodes.CURRENTNESS_FAILURE);
  }
  // Lifecycle admission validates a one-shot private admission record and
  // token against the exact child and starter identities; it is not an
  // inherited file-descriptor protocol. The controller-authenticated bind
  // precedes this verification, and the short-lived starter may already have
  // exited once the parent completed binding, so it is not re-inspected here.
  void starter;
}

/**
 * The sole pending-transaction exception.  It serialises the exact transaction
 * recovery handler while leaving its primary-mutation barrier to the recovery
 * implementation.  It never creates a claim or makes ordinary operations
 * available while pending state exists.
 */
export async function withTransactionRecoveryExclusion<T>(root: string, claimId: string | undefined, generation: string | undefined, action: () => Promise<T>, dependencies: StewardshipDependencies = {}): Promise<T> {
  const activity = await acquireStewardActivity(root);
  try {
    const record = await readRecord(root);
    if (record === undefined) return await action();
    const inspector = dependencies.inspector ?? linuxProcessInspector;
    const clock = dependencies.clock ?? systemClock;
    const life = await liveness(record, inspector, clock);
    if (life === "live" && record.state === "active") {
      if (claimId === undefined) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "A live stewardship claim must authorize transaction recovery.", exitCodes.CURRENTNESS_FAILURE);
      assertClaim(record, claimId, sessionDigest(dependencies));
      assertGeneration(record, generation ?? "");
      await assertCallerController(record, dependencies, inspector);
      return await action();
    }
    // A handoff or release deliberately leaves no active controlling claim.
    // The fixed transaction recovery path may therefore restore its exact
    // pending record before a successor can claim; it cannot run arbitrary
    // ordinary work through this exception.
    if (life === "live" && (record.state === "handoff" || record.state === "released")) return await action();
    if (life === "live") throw refuse(stewardshipReasonCodes.OWNERSHIP_CONFLICT, "A live steward has not released transaction recovery.", exitCodes.CURRENTNESS_FAILURE);
    return await action();
  } finally { await activity.release(); }
}

export async function withSupervisorActivity<T>(root: string, supervisor: ProcessIdentity, action: () => Promise<T>, dependencies: StewardshipDependencies = {}): Promise<T> {
  const activity = await acquireStewardActivity(root);
  try {
    const observed = await (dependencies.inspector ?? linuxProcessInspector).inspect(supervisor.pid);
    if (observed === null || !sameIdentity(observed, supervisor)) throw refuse(stewardshipReasonCodes.CLAIM_STALE, "Supervisor identity is not live.", exitCodes.CURRENTNESS_FAILURE);
    return await action();
  } finally { await activity.release(); }
}
