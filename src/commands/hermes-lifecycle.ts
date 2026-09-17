import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { linuxProcessInspector, type ProcessIdentity } from "../continuous/lifecycle.ts";
import { acquireStewardActivity, acquireSupervisorLifetimeLock, bindSupervisorToActiveClaimUnderActivity, withStewardedOperation, type StewardshipDependencies, type StewardshipLock } from "../continuous/stewardship.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import { readRuntimeAuthority } from "../graph/runtime-authority.ts";
import { assertHermesDispatchAccounting } from "../providers/dispatch-accounting.ts";
import type { CommandResult } from "./dispatcher.ts";
export interface HermesSupervisorRecord {
  readonly schema: "urn:usf:hermes-supervisor:1";
  readonly version: 1;
  readonly supervisorId: string;
  readonly startedAt: string;
  readonly process: ProcessIdentity;
  readonly manifest: string;
  readonly usefulTokenTarget: number;
  readonly envFile: string;
  readonly pauseSeconds: number;
  readonly concurrency: number;
  readonly dispatchLimit: number;
  readonly authorityIdentity: string;
}

/**
 * The supported operator interface for Hermes business-as-usual.
 *
 * The operator says start, status and stop. Process identity, duplicate-owner
 * refusal, orderly drain, runtime files and the shape of one operating cycle
 * are this command's problem, not theirs. Nothing here is semantic authority:
 * a supervisor record is ignored runtime state, and restarting the process
 * never resets the semantic state the cycles produced.
 */
const supervisorRoot = ".usf/hermes/supervisor";
const supervisorRecord = `${supervisorRoot}/supervisor.json`;
const stopRequestRecord = `${supervisorRoot}/stop-request.json`;
const cycleRecord = `${supervisorRoot}/cycle.json`;
const supervisorLog = `${supervisorRoot}/supervisor.log`;
const supervisorAdmission = `${supervisorRoot}/admission.json`;
const deliveryManifest = "graph/manifests/v3-delivery.json";
const linearAutonomyManifest = "graph/manifests/hermes-linear-autonomy.json";
const linearAutonomyPolicy = "urn:usf:policy:hermes-linear-transport:1";
const linearCredentialFile = ".usf/credentials/linear.env";
const startObservationTimeoutMs = 300_000;
const defaultStopWaitMs = 300_000;
const defaultPauseSeconds = 20;
const maximumPauseSeconds = 3_600;
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const maximumRuntimeRecordBytes = 64 * 1024;

interface SupervisorAdmission {
  readonly schema: "urn:usf:hermes-supervisor-admission:1";
  readonly version: 1;
  readonly state: "awaiting-binding" | "bound";
  readonly tokenDigest: string;
  readonly sessionDigest: string;
  readonly claimId: string;
  readonly generation: string;
  readonly starter: ProcessIdentity;
  readonly child: ProcessIdentity;
  readonly argumentsDigest: string;
  readonly createdAt: string;
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new UsfError("HERMES_LIFECYCLE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message, details);
}

export interface LifecycleArguments {
  readonly manifest: string;
  /** GOAL 25.7: frozen before the run, at least 100000, judged on kept tokens only. */
  readonly usefulTokenTarget: number;
  readonly envFile: string;
  readonly pauseSeconds: number;
  readonly concurrency: number;
  readonly dispatchLimit: number;
  readonly waitMs: number;
}

/**
 * Dispatch bounds used only when the corpus declares none. Graph authority is
 * the source: `urn:usf:concurrency-constraint:execution:1` states the default
 * and the ceiling, and the runtime reads them rather than carrying a second
 * copy. These values match that declaration and exist so the command is still
 * safe against a corpus that has not declared its constraint.
 */
export interface ConcurrencyBounds { readonly dispatchDefault: number; readonly dispatchCeiling: number; }
export const compiledConcurrencyBounds: ConcurrencyBounds = Object.freeze({ dispatchDefault: 4, dispatchCeiling: 16 });

export function parseLifecycleArguments(
  args: readonly string[],
  bounds: ConcurrencyBounds = compiledConcurrencyBounds,
): LifecycleArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--env-file", "--pause-seconds", "--concurrency", "--limit", "--wait-ms", "--manifest", "--useful-token-target"].includes(option) || values.has(option)) {
      invalid("Hermes lifecycle options must be unique and explicit.", { option });
    }
    const value = args[++index];
    if (value === undefined || value.length === 0 || value.startsWith("--")) invalid(`Missing value for ${option}.`);
    values.set(option, value);
  }
  const bounded = (name: string, fallback: number, maximum: number): number => {
    const text = values.get(name);
    if (text === undefined) return fallback;
    if (!/^[1-9][0-9]{0,6}$/u.test(text) || Number(text) > maximum) invalid(`${name} must be a positive integer of at most ${maximum}.`);
    return Number(text);
  };
  return Object.freeze({
    // Which profile the supervisor operates. USF's own delivery authority is
    // the default; selecting a product manifest makes every cycle that
    // profile's cycle, and USF's own capabilities are then left alone.
    manifest: values.get("--manifest") ?? deliveryManifest,
    // The acceptance boundary requires the target frozen before the run and at
    // least one hundred thousand; only tokens whose results were kept count
    // toward it, because a wasted token is not useful by definition.
    usefulTokenTarget: ((): number => {
      const target = bounded("--useful-token-target", 100_000, 100_000_000);
      if (target < 100_000) invalid("--useful-token-target must be at least 100000: the acceptance floor is part of the claim, and freezing a softer target would let the run pass a test it did not sit.");
      return target;
    })(),
    envFile: values.get("--env-file") ?? ".usf/credentials/providers.env",
    pauseSeconds: bounded("--pause-seconds", defaultPauseSeconds, maximumPauseSeconds),
    // Declared authority, not a compiled constant. An explicit value above the
    // declared ceiling refuses rather than clamping: silently reducing a
    // requested concurrency would make the run report a bound the operator did
    // not ask for and cannot see.
    concurrency: bounded("--concurrency", bounds.dispatchDefault, bounds.dispatchCeiling),
    dispatchLimit: bounded("--limit", 12, 64),
    waitMs: bounded("--wait-ms", defaultStopWaitMs, 900_000),
  });
}

/**
 * Resolve the dispatch bounds the corpus declares for the selected manifest.
 *
 * Arguments are parsed twice because the manifest that carries the declaration
 * is itself an argument: once against the compiled fallback to learn which
 * manifest is selected, then again against whatever that manifest declares. The
 * parse is pure and cheap, and the alternative -- reading one option out of the
 * raw argument list ahead of validation -- would duplicate the parser.
 */
function resolveConcurrencyBounds(repositoryRoot: string, manifest: string): ConcurrencyBounds {
  try {
    const declared = readRuntimeAuthority(loadSemanticGraph(repositoryRoot, manifest).quads);
    return Object.freeze({
      dispatchDefault: declared.concurrencyDefault ?? compiledConcurrencyBounds.dispatchDefault,
      dispatchCeiling: declared.concurrencyCeiling ?? compiledConcurrencyBounds.dispatchCeiling,
    });
  } catch {
    // An unreadable or undeclaring corpus falls back deliberately. It must not
    // make the command unusable, and it must not silently widen a bound.
    return compiledConcurrencyBounds;
  }
}

function parseLifecycleArgumentsAgainstAuthority(repositoryRoot: string, args: readonly string[]): LifecycleArguments {
  const provisional = parseLifecycleArguments(args);
  return parseLifecycleArguments(args, resolveConcurrencyBounds(repositoryRoot, provisional.manifest));
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (process.platform !== "linux" || uid === undefined || uid === 0) {
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime files require a non-root Linux owner.");
  }
  return uid;
}

async function privateDirectory(path: string, create: boolean, strictMode: boolean): Promise<boolean> {
  if (create) await mkdir(path, { recursive: true, mode: privateDirectoryMode });
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (metadata === undefined) return false;
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid()
    || (strictMode && (metadata.mode & 0o777) !== privateDirectoryMode)) {
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime directories must be owner-controlled real directories.");
  }
  return true;
}

/**
 * The complete Hermes runtime lineage is owner-private. Status calls this with
 * `create=false`, so observation never creates a runtime directory or record.
 */
async function secureRuntimeRoot(repositoryRoot: string, create: boolean): Promise<string | null> {
  const base = resolve(repositoryRoot, ".usf");
  if (!await privateDirectory(base, create, true)) return null;
  const hermes = resolve(base, "hermes");
  if (!await privateDirectory(hermes, create, true)) return null;
  const supervisor = resolve(hermes, "supervisor");
  if (!await privateDirectory(supervisor, create, true)) return null;
  return supervisor;
}

async function safeRuntimeJson<T>(repositoryRoot: string, path: string): Promise<T | null> {
  const runtime = await secureRuntimeRoot(repositoryRoot, false);
  if (runtime === null) return null;
  const target = resolve(repositoryRoot, path);
  if (dirname(target) !== runtime) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime path escaped its private directory.");
  const metadata = await lstat(target).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (metadata === undefined) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== currentUid() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== privateFileMode || metadata.size < 2 || metadata.size > maximumRuntimeRecordBytes) {
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A Hermes runtime record is unsafe.");
  }
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => {
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A Hermes runtime record cannot be opened safely.");
  });
  try {
    const opened = await handle.stat();
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.nlink !== 1) {
      throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "A Hermes runtime record changed while read.");
    }
    try { return JSON.parse((await handle.readFile()).toString("utf8")) as T; }
    catch { throw new UsfError("HERMES_RUNTIME_INVALID", exitCodes.CONTAINMENT_REFUSAL, "A Hermes runtime record is malformed."); }
  } finally { await handle.close(); }
}

/** Write through a private temporary inode so readers never observe a partial record. */
async function writeJson(repositoryRoot: string, path: string, value: unknown): Promise<void> {
  const runtime = await secureRuntimeRoot(repositoryRoot, true);
  if (runtime === null) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime directory is unavailable.");
  const target = resolve(repositoryRoot, path);
  if (dirname(target) !== runtime) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime path escaped its private directory.");
  const transient = resolve(runtime, `.${target.split("/").at(-1)!}.${randomBytes(16).toString("hex")}.tmp`);
  const handle = await open(transient, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), privateFileMode);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await rename(transient, target);
    const directory = await open(runtime, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(transient, { force: true }).catch(() => undefined); }
}

async function readJson<T>(repositoryRoot: string, path: string): Promise<T | null> {
  return safeRuntimeJson<T>(repositoryRoot, path);
}

function sameProcess(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return canonicalDigest(left) === canonicalDigest(right);
}

async function safeSupervisorLog(repositoryRoot: string): Promise<Awaited<ReturnType<typeof open>>> {
  const runtime = await secureRuntimeRoot(repositoryRoot, true);
  if (runtime === null) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime directory is unavailable.");
  const target = resolve(repositoryRoot, supervisorLog);
  if (dirname(target) !== runtime) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes log path escaped its private directory.");
  const prior = await lstat(target).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (prior !== undefined && (!prior.isFile() || prior.isSymbolicLink() || prior.uid !== currentUid() || prior.nlink !== 1 || (prior.mode & 0o777) !== privateFileMode)) {
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes supervisor log is unsafe.");
  }
  const handle = await open(target, constants.O_CREAT | constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0), privateFileMode);
  const opened = await handle.stat();
  const named = await lstat(target);
  if (!opened.isFile() || opened.uid !== currentUid() || opened.nlink !== 1 || (opened.mode & 0o777) !== privateFileMode
    || named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino || named.nlink !== 1) {
    await handle.close();
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes supervisor log changed while opened.");
  }
  return handle;
}

function admissionArgumentsDigest(args: readonly string[]): string { return canonicalDigest(args); }

function admissionSessionDigest(session: string): string { return canonicalDigest({ session }); }

function validProcessIdentity(value: unknown): value is ProcessIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join("|") === ["argvDigest", "bootId", "executablePathDigest", "pid", "startTicks", "uid"].join("|")
    && Number.isSafeInteger(item.pid) && Number(item.pid) > 0 && Number.isSafeInteger(item.uid) && Number(item.uid) >= 0
    && typeof item.bootId === "string" && typeof item.startTicks === "string"
    && typeof item.argvDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.argvDigest)
    && typeof item.executablePathDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.executablePathDigest);
}

function validAdmission(value: unknown): value is SupervisorAdmission {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.schema === "urn:usf:hermes-supervisor-admission:1" && item.version === 1
    && (item.state === "awaiting-binding" || item.state === "bound")
    && typeof item.tokenDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.tokenDigest)
    && typeof item.sessionDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.sessionDigest)
    && typeof item.claimId === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.claimId)
    && typeof item.generation === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.generation)
    && typeof item.argumentsDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.argumentsDigest)
    && typeof item.createdAt === "string" && validProcessIdentity(item.starter) && validProcessIdentity(item.child);
}

async function admissionOrRefuse(repositoryRoot: string): Promise<SupervisorAdmission> {
  const admission = await readJson<unknown>(repositoryRoot, supervisorAdmission);
  if (admission === null || !validAdmission(admission)) {
    throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "A supervisor may only start through a current authorised Hermes start admission.");
  }
  return admission;
}

function validSupervisorRecord(value: unknown): value is HermesSupervisorRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join("|") === ["authorityIdentity", "concurrency", "dispatchLimit", "envFile", "manifest", "pauseSeconds", "process", "schema", "startedAt", "supervisorId", "usefulTokenTarget", "version"].join("|")
    && item.schema === "urn:usf:hermes-supervisor:1" && item.version === 1
    // Preserve the established lifecycle identifier contract: the generator
    // retains the first 25 hexadecimal characters of its canonical digest.
    && typeof item.supervisorId === "string" && /^[0-9a-f]{25}$/u.test(item.supervisorId)
    && typeof item.startedAt === "string" && typeof item.manifest === "string" && typeof item.envFile === "string"
    && typeof item.authorityIdentity === "string" && validProcessIdentity(item.process)
    && Number.isSafeInteger(item.usefulTokenTarget) && Number(item.usefulTokenTarget) >= 100_000
    && Number.isSafeInteger(item.pauseSeconds) && Number(item.pauseSeconds) > 0
    && Number.isSafeInteger(item.concurrency) && Number(item.concurrency) > 0
    && Number.isSafeInteger(item.dispatchLimit) && Number(item.dispatchLimit) > 0;
}

export type SupervisorLiveness = "live" | "stale" | "absent";

/**
 * Durable identity, not a bare PID. A recycled PID belonging to another process
 * has a different boot identity, start tick, argv digest or executable digest,
 * so it can never be mistaken for the supervisor.
 */
export async function observeSupervisor(repositoryRoot: string): Promise<Readonly<{
  liveness: SupervisorLiveness; record: HermesSupervisorRecord | null;
}>> {
  const value = await readJson<unknown>(repositoryRoot, supervisorRecord);
  if (value === null) {
    return Object.freeze({ liveness: "absent" as const, record: null });
  }
  if (!validSupervisorRecord(value)) throw new UsfError("HERMES_RUNTIME_INVALID", exitCodes.CONTAINMENT_REFUSAL, "Hermes supervisor record is malformed.");
  const record = value;
  const observed = await linuxProcessInspector.inspect(record.process.pid).catch(() => null);
  const same = observed !== null
    && observed.bootId === record.process.bootId
    && observed.startTicks === record.process.startTicks
    && observed.uid === record.process.uid
    && observed.argvDigest === record.process.argvDigest
    && observed.executablePathDigest === record.process.executablePathDigest;
  return Object.freeze({ liveness: same ? "live" as const : "stale" as const, record });
}

/** Foreground lanes share canonical lifecycle discovery with detached Hermes. */
export async function registerForegroundSupervisor(repositoryRoot: string, input: {
  readonly lifetime: StewardshipLock;
  readonly process: ProcessIdentity;
  readonly claimId: string;
  readonly generation: string;
  readonly dependencies: StewardshipDependencies;
  readonly args: readonly string[];
}): Promise<HermesSupervisorRecord> {
  if (!input.lifetime.held() || !validProcessIdentity(input.process)) {
    throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "Foreground admission requires held lifetime ownership and exact process identity.");
  }
  return withStewardedOperation(repositoryRoot, input.claimId, input.generation, async () => {
    const existing = await observeSupervisor(repositoryRoot);
    if (existing.liveness === "live") throw new UsfError("HERMES_SUPERVISOR_ALREADY_ACTIVE", exitCodes.DOMAIN_FAILURE, "A live supervisor already owns this repository.");
    const parsed = parseLifecycleArgumentsAgainstAuthority(repositoryRoot, input.args);
    const observed = await linuxProcessInspector.inspect(input.process.pid);
    if (observed === null || !sameProcess(observed, input.process)) throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "Foreground process identity moved.");
    const startedAt = new Date().toISOString();
    const record: HermesSupervisorRecord = { schema: "urn:usf:hermes-supervisor:1", version: 1,
      supervisorId: canonicalDigest({ process: input.process, startedAt }).slice(7, 32), startedAt, process: input.process,
      manifest: parsed.manifest, usefulTokenTarget: parsed.usefulTokenTarget, envFile: parsed.envFile,
      pauseSeconds: parsed.pauseSeconds, concurrency: parsed.concurrency, dispatchLimit: parsed.dispatchLimit,
      authorityIdentity: authorityIdentity(repositoryRoot, parsed.manifest) };
    await bindSupervisorToActiveClaimUnderActivity(repositoryRoot, input.claimId, input.generation, input.process, input.dependencies);
    await writeJson(repositoryRoot, supervisorRecord, record);
    return record;
  }, input.dependencies);
}

export async function foregroundSupervisorStopRequested(repositoryRoot: string, record: HermesSupervisorRecord): Promise<boolean> {
  const request = await readJson<{ supervisorId?: unknown }>(repositoryRoot, stopRequestRecord);
  return request?.supervisorId === record.supervisorId;
}

export async function unregisterForegroundSupervisor(repositoryRoot: string, record: HermesSupervisorRecord): Promise<void> {
  const activity = await acquireStewardActivity(repositoryRoot);
  try {
    const current = await observeSupervisor(repositoryRoot);
    if (current.record?.supervisorId !== record.supervisorId || !sameProcess(current.record.process, record.process)) return;
    await writeJson(repositoryRoot, `${supervisorRoot}/foreground-${record.supervisorId}.json`, { record, stoppedAt: new Date().toISOString() });
    await rm(resolve(repositoryRoot, supervisorRecord));
    const request = await readJson<{ supervisorId?: unknown }>(repositoryRoot, stopRequestRecord);
    if (request?.supervisorId === record.supervisorId) await rm(resolve(repositoryRoot, stopRequestRecord), { force: true });
  } finally { await activity.release(); }
}

function authorityIdentity(repositoryRoot: string, manifest: string = deliveryManifest): string {
  try {
    const graph = loadSemanticGraph(repositoryRoot, manifest);
    return canonicalDigest(graph.graphDigests ?? {});
  } catch {
    return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/**
 * The arguments the supervisor child is started with.
 *
 * The supervisor runs in a detached child, so every selection the operator made
 * has to reach it explicitly. Omitting one does not fail: it silently starts a
 * supervisor operating a different profile from the one that was reported back,
 * which is why this is a named function with a test rather than an inline list.
 */
export function superviseArguments(parsed: LifecycleArguments): readonly string[] {
  return Object.freeze([
    "--manifest", parsed.manifest,
    "--useful-token-target", String(parsed.usefulTokenTarget),
    "--env-file", parsed.envFile,
    "--pause-seconds", String(parsed.pauseSeconds),
    "--concurrency", String(parsed.concurrency),
    "--limit", String(parsed.dispatchLimit),
  ]);
}

export async function hermesStartCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parseLifecycleArgumentsAgainstAuthority(repositoryRoot, args);
  if (!await secureRuntimeRoot(repositoryRoot, true)) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime directory is unavailable.");
  const claimId = process.env.USF_STEWARD_CLAIM_ID;
  const generation = process.env.USF_STEWARD_GENERATION;
  const session = process.env.USF_STEWARD_SESSION_ID;
  if (claimId === undefined || generation === undefined || session === undefined) {
    throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "Hermes start requires the current steward claim, generation and session.");
  }
  const observed = await observeSupervisor(repositoryRoot);
  if (observed.liveness === "live") {
    throw new UsfError("HERMES_SUPERVISOR_ALREADY_ACTIVE", exitCodes.DOMAIN_FAILURE,
      "A Hermes supervisor is already running for this repository; stop it before starting another.",
      { supervisorId: observed.record!.supervisorId, pid: observed.record!.process.pid, startedAt: observed.record!.startedAt });
  }
  const envPath = resolve(repositoryRoot, parsed.envFile);
  const credential = await stat(envPath).catch(() => null);
  if (credential === null || !credential.isFile() || (credential.mode & 0o077) !== 0) {
    throw new UsfError("HERMES_CREDENTIAL_FILE_UNSAFE", exitCodes.CONTAINMENT_REFUSAL,
      "Hermes requires one existing owner-only mode-0600 credential file.", { envFile: parsed.envFile });
  }
  // A stale record is reclaimed, never repaired: the previous process is gone
  // and its semantic results are already durable elsewhere.
  const reclaimed = observed.liveness === "stale";
  // The admitted child owns record replacement under its lifetime lock. A
  // competing starter must never delete a record another child just created.

  const starter = await linuxProcessInspector.current();
  const token = randomBytes(32).toString("hex");
  // The child is not trusted merely because it inherits an environment. The
  // admission binds its exact process identity, its immediate start parent,
  // the selected arguments and the current steward epoch before it can cycle.
  const log = await safeSupervisorLog(repositoryRoot);
  const child = spawn(process.execPath, [
    resolve(import.meta.dirname, "..", "cli.ts"), "hermes", "supervise",
    ...superviseArguments(parsed),
  ], {
    cwd: repositoryRoot,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: {
      HOME: process.env.HOME ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", NO_COLOR: "1", PATH: process.env.PATH ?? "",
      USF_STEWARD_SESSION_ID: session, USF_STEWARD_CLAIM_ID: claimId, USF_STEWARD_GENERATION: generation,
      USF_HERMES_START_TOKEN: token,
    },
  });
  const childIdentity = child.pid === undefined ? null : await linuxProcessInspector.inspect(child.pid);
  if (childIdentity === null) {
    await log.close();
    throw new UsfError("HERMES_SUPERVISOR_DID_NOT_START", exitCodes.CONTINUOUS_DEGRADED, "The admitted supervisor child did not establish a durable process identity.");
  }
  const admission: SupervisorAdmission = Object.freeze({
    schema: "urn:usf:hermes-supervisor-admission:1", version: 1, state: "awaiting-binding",
    tokenDigest: canonicalDigest({ token }), sessionDigest: admissionSessionDigest(session), claimId, generation,
    starter, child: childIdentity, argumentsDigest: admissionArgumentsDigest(superviseArguments(parsed)), createdAt: new Date().toISOString(),
  });
  await writeJson(repositoryRoot, supervisorAdmission, admission);
  child.unref();
  await log.close();

  // The supervisor owns its own record, so start waits to observe the record
  // the child wrote rather than asserting a state it did not establish.
  const deadline = Date.now() + startObservationTimeoutMs;
  let current = await observeSupervisor(repositoryRoot);
  while (current.liveness !== "live" && Date.now() < deadline) {
    await new Promise((complete) => setTimeout(complete, 250));
    current = await observeSupervisor(repositoryRoot);
  }
  if (current.liveness !== "live") {
    throw new UsfError("HERMES_SUPERVISOR_DID_NOT_START", exitCodes.CONTINUOUS_DEGRADED,
      "The supervisor process did not establish its lifecycle record.",
      { logPath: supervisorLog, spawnedPid: child.pid ?? null });
  }
  if (!sameProcess(current.record!.process, childIdentity)) {
    throw new UsfError("HERMES_SUPERVISOR_ADMISSION_STALE", exitCodes.CURRENTNESS_FAILURE,
      "The observed supervisor is not the exact child admitted by this start request.");
  }
  const { bindSupervisorToActiveClaimUnderActivity } = await import("../continuous/stewardship.ts");
  await bindSupervisorToActiveClaimUnderActivity(repositoryRoot, claimId, generation, current.record!.process);
  await writeJson(repositoryRoot, supervisorAdmission, Object.freeze({ ...admission, state: "bound" as const }));
  return {
    output: Object.freeze({
      schema: "urn:usf:hermes-lifecycle:1" as const,
      version: 1 as const,
      operation: "start" as const,
      running: true,
      reclaimedStaleRecord: reclaimed,
      supervisorId: current.record!.supervisorId,
      pid: current.record!.process.pid,
      startedAt: current.record!.startedAt,
      envFile: current.record!.envFile,
      pauseSeconds: current.record!.pauseSeconds,
      concurrency: current.record!.concurrency,
      dispatchLimit: current.record!.dispatchLimit,
      authorityIdentity: current.record!.authorityIdentity,
      logPath: supervisorLog,
      nonClaims: Object.freeze([
        "This record states that a supervisor process exists and owns this repository's Hermes lifecycle. It is ignored runtime state and carries no semantic, construction or publication authority.",
        "Starting a supervisor does not reset semantic state: the semantic cache, conformance evidence and landed implementation are unchanged by process lifecycle.",
      ]),
    }),
    exitCode: exitCodes.SUCCESS,
  };
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

export async function hermesStopCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parseLifecycleArgumentsAgainstAuthority(repositoryRoot, args);
  if (!await secureRuntimeRoot(repositoryRoot, true)) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime directory is unavailable.");
  const observed = await observeSupervisor(repositoryRoot);
  const idle = (outcome: string, reclaimed: boolean): CommandResult => ({
    output: Object.freeze({
      schema: "urn:usf:hermes-lifecycle:1" as const, version: 1 as const, operation: "stop" as const,
      running: false, outcome, reclaimedStaleRecord: reclaimed, drained: true,
      terminationSignal: null, waitedMs: 0,
      nonClaims: Object.freeze(["Stop is idempotent: requesting cessation of a supervisor that is not running is a success, not a refusal."]),
    }),
    exitCode: exitCodes.SUCCESS,
  });
  if (observed.liveness === "absent") return idle("already-stopped", false);
  if (observed.liveness === "stale") {
    await rm(resolve(repositoryRoot, supervisorRecord), { force: true });
    await rm(resolve(repositoryRoot, stopRequestRecord), { force: true });
    return idle("stale-record-reclaimed", true);
  }

  const record = observed.record!;
  await writeJson(repositoryRoot, stopRequestRecord, Object.freeze({
    schema: "urn:usf:hermes-stop-request:1", version: 1,
    supervisorId: record.supervisorId, requestedAt: new Date().toISOString(),
    reason: "operator requested orderly cessation",
  }));

  // Orderly drain first: the supervisor observes the request at a cycle
  // boundary, so no transaction is interrupted part-way.
  const started = Date.now();
  let live = true;
  while (Date.now() - started < parsed.waitMs) {
    await new Promise((complete) => setTimeout(complete, 500));
    const current = await observeSupervisor(repositoryRoot);
    if (current.liveness !== "live") { live = false; break; }
  }
  if (live) {
    throw new UsfError("HERMES_DRAIN_PENDING", exitCodes.CONTINUOUS_DEGRADED,
      "The orderly stop request remains pending. Preserve the supervisor and its transaction; observe again before takeover.",
      { supervisorId: record.supervisorId, pid: record.process.pid });
  }
  // The supervisor removes its own identity. Preserve a replacement process's
  // records if a different, authorised start occurred after this one drained.
  const remaining = await observeSupervisor(repositoryRoot);
  if (remaining.record?.supervisorId === record.supervisorId) {
    await rm(resolve(repositoryRoot, supervisorRecord), { force: true });
  }
  const request = await readJson<{ supervisorId: string }>(repositoryRoot, stopRequestRecord);
  if (request?.supervisorId === record.supervisorId) await rm(resolve(repositoryRoot, stopRequestRecord), { force: true });
  return {
    output: Object.freeze({
      schema: "urn:usf:hermes-lifecycle:1" as const, version: 1 as const, operation: "stop" as const,
      running: false, outcome: "drained",
      reclaimedStaleRecord: false, drained: true, terminationSignal: null,
      waitedMs: Date.now() - started, supervisorId: record.supervisorId,
      nonClaims: Object.freeze([
        "Completed semantic and evidence state is untouched by stopping: results already written remain exactly as the cycles left them.",
        "Stop is idempotent and may be issued again safely.",
      ]),
    }),
    exitCode: exitCodes.SUCCESS,
  };
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function hermesLifecycleStatusCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const observed = await observeSupervisor(repositoryRoot);
  const lastCycle = await readJson<Record<string, unknown>>(repositoryRoot, cycleRecord);
  // A cycle record belongs to the supervisor that wrote it. The record is a
  // single unscoped file, so a previous supervisor's projection outlives it and
  // would otherwise be reported beside the current supervisor's manifest --
  // pairing one profile's identity with another profile's facet counts. Only a
  // projection from the observed supervisor is current enough to report.
  const cycle = observed.record !== null && lastCycle !== null
    && lastCycle.supervisorId === observed.record.supervisorId ? lastCycle : null;
  const supersededCycle = lastCycle !== null && cycle === null
    ? Object.freeze({
      supervisorId: lastCycle.supervisorId ?? null,
      manifest: lastCycle.manifest ?? null,
      observedAt: lastCycle.observedAt ?? null,
    }) : null;
  const stopRequest = await readJson<Record<string, unknown>>(repositoryRoot, stopRequestRecord);

  // Status contacts nothing. Both projections below are derived from current
  // repository state, so the operator sees the same frontier the supervisor
  // would derive on its next cycle rather than a cached summary.
  const { hermesCommand } = await import("./hermes.ts");
  const { implementCommand } = await import("./hermes-implement.ts");
  const authority = await hermesCommand(repositoryRoot, ["status", ...args])
    .then((result) => result.output as Record<string, unknown>, () => null);
  // Status must describe the profile the supervisor is actually operating. Read
  // back its recorded manifest rather than defaulting to the foundation, or a
  // product supervisor would be reported against work it never selected.
  const selectedManifest = observed.record?.manifest ?? deliveryManifest;
  const work = await implementCommand(repositoryRoot, ["--manifest", selectedManifest])
    .then((result) => result.output as Record<string, unknown>, () => null);
  const evidence = await latestConformanceEvidence(repositoryRoot);

  return {
    output: Object.freeze({
      schema: "urn:usf:hermes-lifecycle-status:1" as const,
      version: 1 as const,
      running: observed.liveness === "live",
      liveness: observed.liveness,
      supervisorId: observed.record?.supervisorId ?? null,
      pid: observed.liveness === "live" ? observed.record!.process.pid : null,
      startedAt: observed.record?.startedAt ?? null,
      stopRequested: stopRequest !== null,
      manifest: selectedManifest,
      // Present so a projection from an earlier supervisor is visible as
      // history rather than silently discarded or silently reported as current.
      supersededCycle,
      authorityIdentity: observed.record?.authorityIdentity ?? authorityIdentity(repositoryRoot, selectedManifest),
      currentCycle: cycle === null ? null : cycle.cycle ?? null,
      tokenUsage: cycle === null ? null : cycle.tokenUsage ?? null,
      cumulativeTokens: cycle === null ? null : cycle.cumulativeTokens ?? null,
      usefulTokens: cycle === null ? null : cycle.usefulTokens ?? null,
      usefulTokenTarget: observed.record?.usefulTokenTarget ?? null,
      usefulTokenTargetAchieved: cycle === null ? null : cycle.usefulTokenTargetAchieved ?? null,
      dispatchConcurrency: cycle === null ? null : cycle.dispatchConcurrency ?? null,
      lastObservedAt: cycle === null ? null : cycle.observedAt ?? null,
      lastReason: cycle === null ? "no cycle has run under a supervisor yet"
        : observed.liveness === "live" ? cycle.lastReason ?? null
        : cycle.terminalReason ?? cycle.lastReason ?? null,
      work: work === null ? null : Object.freeze({
        capabilities: work.capabilityCount,
        requirements: work.requirementCount,
        ready: work.readyFrontier,
        blockedOnPredecessor: work.blockedOnPredecessor,
        modulesLanded: work.modulesLanded,
        conformanceTestsLanded: work.conformanceTestsLanded,
        awaitingConformanceCheck: work.awaitingConformanceCheck,
      }),
      providerActivity: cycle === null ? Object.freeze([]) : cycle.providerActivity ?? Object.freeze([]),
      transactions: cycle === null ? Object.freeze([]) : cycle.transactions ?? Object.freeze([]),
      blockers: cycle === null ? Object.freeze([]) : cycle.blockers ?? Object.freeze([]),
      linear: cycle === null ? null : cycle.linear ?? null,
      latestEvidence: evidence,
      facets: cycle === null ? null : cycle.facets ?? null,
      authority: authority === null ? null : Object.freeze({
        v3Authority: authority.authority ?? null,
        workGraphs: authority.workGraphs ?? null,
        dependency: authority.dependency ?? null,
        completedUnitCount: authority.completedUnitCount ?? null,
        readyUnitCount: authority.readyUnitCount ?? null,
      }),
      logPath: supervisorLog,
      nonClaims: Object.freeze([
        "A cycle projection is the supervisor's own last observation. It is ignored runtime state and is not semantic authority.",
        "Facet counts are derived by the facet evaluator from the evidence that existed when they were computed; status reads them, it does not assert them.",
        "Status contacts no provider and mutates nothing.",
      ]),
    }),
    exitCode: exitCodes.SUCCESS,
  };
}

/** The most recent behavioural observations, newest first. */
async function latestConformanceEvidence(repositoryRoot: string): Promise<readonly Record<string, unknown>[]> {
  const { readdir } = await import("node:fs/promises");
  const directory = resolve(repositoryRoot, ".usf", "conformance-evidence");
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
  const records: Array<Readonly<Record<string, unknown>>> = [];
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name), "utf8").catch(() => undefined);
    if (bytes === undefined) continue;
    try {
      const record = JSON.parse(bytes) as {
        capability?: unknown; executed?: unknown; refusal?: unknown;
        outcomes?: Array<{ passed?: unknown; executed?: unknown }>;
      };
      records.push(Object.freeze({
        capability: record.capability ?? null,
        executed: record.executed === true,
        refusal: record.refusal ?? null,
        passed: (record.outcomes ?? []).filter((outcome) => outcome.passed === true).length,
        failed: (record.outcomes ?? []).filter((outcome) => outcome.executed === true && outcome.passed !== true).length,
      }));
    } catch { continue; }
  }
  return Object.freeze(records.slice(-16).reverse());
}

// ---------------------------------------------------------------------------
// supervise: the foreground loop start owns and stop drains
// ---------------------------------------------------------------------------

interface CycleProjection {
  readonly schema: "urn:usf:hermes-cycle-projection:1";
  readonly version: 1;
  readonly supervisorId: string;
  readonly cycle: number;
  readonly observedAt: string;
  readonly implementation: Record<string, unknown> | null;
  /** The profile manifest this cycle selected work from. */
  readonly manifest: string;
  /** Whether the foundation artefact lane applies to the selected profile. */
  readonly artefactLane: string;
  readonly artefact: Record<string, unknown> | null;
  readonly transactions: readonly Record<string, unknown>[];
  /** What this cycle spent, split by whether the result was kept. */
  readonly tokenUsage: Record<string, number> | null;
  /** Cumulative across this supervisor's life; it resets when the supervisor does. */
  readonly cumulativeTokens: number;
  readonly usefulTokens: number;
  readonly usefulTokenTarget: number;
  readonly usefulTokenTargetAchieved: boolean;
  /** GOAL 14.3: observed, target and utilisation for the cycle's dispatch. */
  readonly dispatchConcurrency: Record<string, unknown> | null;
  /** Autonomous Linear discovery, delivery and reconciliation for this cycle. */
  readonly linear: Record<string, unknown> | null;
  readonly facets: Record<string, unknown> | null;
  readonly blockers: readonly Record<string, unknown>[];
  readonly providerActivity: readonly Record<string, unknown>[];
  readonly idleCycles: number;
  readonly lastReason: string;
}

const implementationAccountingNames = Object.freeze([
  "plannedUnits", "eligibleUnits", "attemptedUnits", "contactedUnits", "contactedAttempts",
  "successfulUnits", "structurallyAcceptedUnits", "refusedUnits", "reusedUnits",
  "dispatchedUnits", "modelInvocations", "cacheHits", "acceptedResults",
] as const);

/** Copy current counters without recomputing them; retain the legacy-only shape for old records. */
export function projectImplementationDispatchAccounting(
  implementation: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (implementation.accounting === undefined) {
    return Object.freeze(Object.fromEntries([
      "dispatchedUnits", "modelInvocations", "cacheHits", "acceptedResults",
    ].map((name) => [name, implementation[name]])));
  }
  const accounting = assertHermesDispatchAccounting(implementation.accounting);
  for (const name of implementationAccountingNames) {
    if (implementation[name] !== accounting[name]) {
      throw new UsfError("HERMES_CYCLE_ACCOUNTING_INVALID", exitCodes.DOMAIN_FAILURE,
        "The implementation result's top-level accounting aliases disagree with its sealed accounting.", { counter: name });
    }
  }
  return Object.freeze({ accounting, ...accounting });
}

async function stopRequested(repositoryRoot: string, supervisorId: string): Promise<boolean> {
  const request = await readJson<{ supervisorId?: unknown }>(repositoryRoot, stopRequestRecord);
  return request !== null && (request.supervisorId === supervisorId || request.supervisorId === undefined);
}

/** Sleep in short slices so a stop request is observed promptly. */
async function pause(repositoryRoot: string, supervisorId: string, seconds: number): Promise<boolean> {
  const deadline = Date.now() + seconds * 1_000;
  while (Date.now() < deadline) {
    if (await stopRequested(repositoryRoot, supervisorId)) return true;
    await new Promise((complete) => setTimeout(complete, Math.min(500, Math.max(50, deadline - Date.now()))));
  }
  return stopRequested(repositoryRoot, supervisorId);
}

async function awaitAdmissionBinding(repositoryRoot: string, admission: SupervisorAdmission, identity: ProcessIdentity): Promise<void> {
  const deadline = Date.now() + startObservationTimeoutMs;
  while (Date.now() < deadline) {
    const current = await admissionOrRefuse(repositoryRoot);
    if (current.tokenDigest !== admission.tokenDigest || !sameProcess(current.child, identity)
      || current.claimId !== admission.claimId || current.generation !== admission.generation) {
      throw new UsfError("HERMES_SUPERVISOR_ADMISSION_STALE", exitCodes.CURRENTNESS_FAILURE, "The supervisor admission changed before stewardship binding.");
    }
    if (current.state === "bound") {
      const { verifyAdmittedSupervisorBinding } = await import("../continuous/stewardship.ts");
      await verifyAdmittedSupervisorBinding(repositoryRoot, admission.claimId, admission.generation, identity, admission.starter);
      return;
    }
    await new Promise((complete) => setTimeout(complete, 25));
  }
  throw new UsfError("HERMES_SUPERVISOR_ADMISSION_TIMEOUT", exitCodes.CONTINUOUS_DEGRADED, "The authorised start did not bind the supervisor to its stewardship claim.");
}

async function validateChildAdmission(repositoryRoot: string, args: readonly string[], identity: ProcessIdentity): Promise<SupervisorAdmission> {
  const token = process.env.USF_HERMES_START_TOKEN;
  const claimId = process.env.USF_STEWARD_CLAIM_ID;
  const generation = process.env.USF_STEWARD_GENERATION;
  const session = process.env.USF_STEWARD_SESSION_ID;
  if (token === undefined || claimId === undefined || generation === undefined || session === undefined) {
    throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "Direct Hermes supervise is refused; use an authorised Hermes start.");
  }
  const deadline = Date.now() + 5_000;
  let admission: SupervisorAdmission | null = null;
  while (Date.now() < deadline && admission === null) {
    admission = await readJson<unknown>(repositoryRoot, supervisorAdmission).then((value) => value !== null && validAdmission(value) ? value : null);
    if (admission === null) await new Promise((complete) => setTimeout(complete, 10));
  }
  if (admission === null || admission.state !== "awaiting-binding") throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "No current authorised Hermes start admission exists.");
  const parent = await linuxProcessInspector.inspect(process.ppid);
  if (parent === null || !sameProcess(parent, admission.starter) || !sameProcess(identity, admission.child)
    || admission.tokenDigest !== canonicalDigest({ token }) || admission.sessionDigest !== admissionSessionDigest(session)
    || admission.claimId !== claimId || admission.generation !== generation || admission.argumentsDigest !== admissionArgumentsDigest(args)) {
    throw new UsfError("HERMES_SUPERVISOR_ADMISSION_STALE", exitCodes.CURRENTNESS_FAILURE, "The Hermes start admission does not match this child, parent, steward epoch and arguments.");
  }
  return admission;
}

export async function hermesSuperviseCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const lifetime = await acquireSupervisorLifetimeLock(repositoryRoot);
  try {
    return await runAdmittedSupervisor(repositoryRoot, args);
  } finally {
    await lifetime.release();
  }
}

async function runAdmittedSupervisor(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parseLifecycleArgumentsAgainstAuthority(repositoryRoot, args);
  if (!await secureRuntimeRoot(repositoryRoot, true)) throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime directory is unavailable.");
  const existing = await observeSupervisor(repositoryRoot);
  if (existing.liveness === "live") {
    throw new UsfError("HERMES_SUPERVISOR_ALREADY_ACTIVE", exitCodes.DOMAIN_FAILURE,
      "Another Hermes supervisor already owns this repository.", { supervisorId: existing.record!.supervisorId });
  }
  const identity = await linuxProcessInspector.current();
  const admission = await validateChildAdmission(repositoryRoot, args, identity);
  await rm(resolve(repositoryRoot, stopRequestRecord), { force: true });
  const record: HermesSupervisorRecord = Object.freeze({
    schema: "urn:usf:hermes-supervisor:1" as const,
    version: 1 as const,
    supervisorId: canonicalDigest({ process: identity, startedAt: new Date().toISOString() }).slice("sha256:".length, 32),
    startedAt: new Date().toISOString(),
    process: identity,
    manifest: parsed.manifest,
    usefulTokenTarget: parsed.usefulTokenTarget,
    envFile: parsed.envFile,
    pauseSeconds: parsed.pauseSeconds,
    concurrency: parsed.concurrency,
    dispatchLimit: parsed.dispatchLimit,
    authorityIdentity: authorityIdentity(repositoryRoot, parsed.manifest),
  });
  await writeJson(repositoryRoot, supervisorRecord, record);
  // `start` still owns the activity lock while it binds this exact process to
  // the current steward record. Until then the child holds only its lifetime
  // lock and cannot enter a cycle or dispatch work.
  await awaitAdmissionBinding(repositoryRoot, admission, identity);

  const { implementCommand } = await import("./hermes-implement.ts");
  const { realisePlanCommand } = await import("./hermes-realise.ts");
  const { transactCommand, listPendingTransactions } = await import("./transact.ts");
  // The Linear lane is loaded dynamically because hermes-linear uses this
  // lifecycle module for its foreground registration. Keeping the import here
  // preserves one supervisor lifetime lock and one steward activity owner.
  const { loadLinearCredentials, readLinearPolicySource, runHermesLinearCycle } = await import("./hermes-linear-autonomy.ts");
  const { parseLinearPolicy } = await import("./linear-client.ts");
  const { LinearStateStore } = await import("./linear-state.ts");
  const linearStore = await LinearStateStore.open(repositoryRoot);

  // A signal is a request, not an interruption: it is recorded and observed at
  // the next boundary, so no transaction is torn in half by it.
  let signalled: string | null = null;
  const onSignal = (name: string) => () => { signalled = signalled ?? name; };
  const terminate = onSignal("SIGTERM");
  const interrupt = onSignal("SIGINT");
  process.on("SIGTERM", terminate);
  process.on("SIGINT", interrupt);

  let cycle = 0;
  let idleCycles = 0;
  // Cumulative across this supervisor's life. It resets when the supervisor
  // does, which is honest: a new process has spent nothing yet, and the ignored
  // cycle record is not an accounting ledger.
  let spentTokens = 0;
  let usefulTokens = 0;
  let reason = "running";
  try {
    for (;;) {
      if (signalled !== null) { reason = `signalled-${signalled}`; break; }
      if (await stopRequested(repositoryRoot, record.supervisorId)) { reason = "stop-requested"; break; }
      let activity;
      try {
        activity = await acquireStewardActivity(repositoryRoot);
      } catch (error) {
        if (!(error instanceof UsfError) || error.code !== "STEWARD_ACTIVITY_BUSY") throw error;
        if (await pause(repositoryRoot, record.supervisorId, parsed.pauseSeconds)) { reason = "stop-requested"; break; }
        continue;
      }
      let waitSeconds = parsed.pauseSeconds;
      try {
      const pending = await listPendingTransactions(repositoryRoot);
      if (pending.length > 0) {
        const previous = await readJson<Record<string, unknown>>(repositoryRoot, cycleRecord);
        await writeJson(repositoryRoot, cycleRecord, {
          ...(previous?.supervisorId === record.supervisorId ? previous : {}),
          schema: "urn:usf:hermes-cycle-projection:1", version: 1,
          supervisorId: record.supervisorId, manifest: parsed.manifest,
          observedAt: new Date().toISOString(), cycle,
          lastReason: "pending transaction requires explicit recovery",
          blockers: [{ lane: "transaction", reason: "TRANSACT_RECOVERY_REQUIRED", transactions: pending }],
        });
      } else {
      cycle += 1;
      const transactions: Record<string, unknown>[] = [];
      const blockers: Record<string, unknown>[] = [];

      // A retained authenticated continuation precedes every ordinary lane.
      // Its failure must not allow another lane to move the protected inputs.
      let continuationBlocker: string | null = null;
      if (parsed.manifest === deliveryManifest) {
        try {
          const { resumeLinearDeliveryContinuation } = await import("./linear-delivery.ts");
          await resumeLinearDeliveryContinuation(repositoryRoot);
        } catch (error) {
          continuationBlocker = error instanceof Error ? error.message.slice(0, 300) : "LINEAR_CONTINUATION_UNKNOWN";
          blockers.push(Object.freeze({ lane: "linear-continuation", reason: continuationBlocker }));
        }
      }

      // Product implementation first: it is the work the phase exists for.
      const implementation = continuationBlocker !== null ? null : await implementCommand(repositoryRoot, [
        "--apply", "--env-file", parsed.envFile, "--manifest", parsed.manifest,
        "--limit", String(parsed.dispatchLimit), "--concurrency", String(parsed.concurrency),
      ]).then((result) => result.output as Record<string, unknown>,
        (error: unknown) => {
          blockers.push(Object.freeze({ lane: "implementation", reason: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
          return null;
        });
      // One transaction per owning repository. A composed selection realises
      // into more than one, and a transaction targets exactly one, so the
      // results are landed as a set of transactions rather than assumed to
      // share a destination. Results are relative to whichever repository owns
      // them; without saying which, a product's paths would be written into USF
      // itself, which is the confusion the profile boundary exists to prevent.
      const implementationProposals = (implementation?.proposals ?? []) as ReadonlyArray<
        Readonly<{ repository: string | null; path: string }>
      >;
      for (const entry of implementationProposals) {
        const repositoryArguments = entry.repository === null ? []
          : ["--repository", entry.repository, "--manifest", parsed.manifest];
        // A transaction is never interrupted by a stop request: it is atomic and
        // completing it is cheaper and safer than abandoning it.
        transactions.push(await transactCommand(repositoryRoot, ["--proposal", entry.path, ...repositoryArguments])
          .then((result) => Object.freeze({
            lane: "implementation", repository: entry.repository, ...(result.output as Record<string, unknown>),
          }),
            (error: unknown) => Object.freeze({
              lane: "implementation", repository: entry.repository,
              refused: error instanceof Error ? error.message.slice(0, 300) : "unknown",
            })));
      }

      // The artefact lane realises USF's own delivery artefacts, and only those.
      // A supervisor operating a product profile must not run it: doing so would
      // spend the cycle realising foundation capabilities merely because they
      // are available, which is the opposite of selecting a profile. The lane is
      // recorded as deliberately not applicable rather than silently skipped.
      const artefactLaneApplies = parsed.manifest === deliveryManifest;
      const artefact = continuationBlocker !== null || !artefactLaneApplies ? null
        : await realisePlanCommand(repositoryRoot, ["--apply", "--env-file", parsed.envFile])
        .then((result) => result.output as Record<string, unknown>,
          (error: unknown) => {
            blockers.push(Object.freeze({ lane: "artefact", reason: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
            return null;
          });
      const artefactProposal = artefact?.proposalPath;
      if (typeof artefactProposal === "string") {
        transactions.push(await transactCommand(repositoryRoot, ["--proposal", artefactProposal])
          .then((result) => Object.freeze({ lane: "artefact", ...(result.output as Record<string, unknown>) }),
            (error: unknown) => Object.freeze({ lane: "artefact", refused: error instanceof Error ? error.message.slice(0, 300) : "unknown" })));
      }

      // Linear is part of the normal BAU cycle, not a separately started
      // controller. It discovers and creates issues from the governed policy,
      // then dispatches each current binding through the same activity held by
      // this supervisor. A Linear refusal is recorded as a lane blocker while
      // allowing the product lane to remain healthy and observable.
      const linear = await (async (): Promise<Record<string, unknown>> => {
        try {
          if (continuationBlocker !== null) throw new Error(continuationBlocker);
          const policy = parseLinearPolicy(await readLinearPolicySource(
            repositoryRoot, linearAutonomyManifest, linearAutonomyPolicy));
          const credentials = await loadLinearCredentials(
            repositoryRoot, linearCredentialFile, policy.workspaces.map((workspace) => workspace.credentialName));
          if (credentials === null) {
            const result = { schema: "urn:usf:hermes-linear-cycle:1", status: "blocked",
              reasonCode: "LINEAR_CREDENTIALS_UNAVAILABLE", terminal: false };
            blockers.push(Object.freeze({ lane: "linear", reason: result.reasonCode }));
            return result;
          }
          const result = await runHermesLinearCycle(repositoryRoot, policy, credentials, linearStore,
            parsed.envFile, parsed.concurrency, () => signalled !== null);
          return result as Record<string, unknown>;
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 300) : "unknown";
          blockers.push(Object.freeze({ lane: "linear", reason }));
          return { schema: "urn:usf:hermes-linear-cycle:1", status: "blocked", reasonCode: reason, terminal: false };
        }
      })();

      const outcomes = Array.isArray(implementation?.outcomes) ? implementation.outcomes as Record<string, unknown>[] : [];
      for (const outcome of outcomes) {
        if (outcome.outcome === "refused" || outcome.outcome === "output-refused") {
          blockers.push(Object.freeze({
            lane: "implementation", unit: outcome.unit, capability: outcome.capability,
            reason: outcome.reason ?? outcome.code, detail: outcome.detail ?? null,
          }));
        }
      }
      const cycleTokens = (implementation?.tokenUsage ?? null) as Record<string, number> | null;
      spentTokens += cycleTokens?.totalTokens ?? 0;
      usefulTokens += cycleTokens?.acceptedTokens ?? 0;
      const projection: CycleProjection = Object.freeze({
        schema: "urn:usf:hermes-cycle-projection:1" as const,
        version: 1 as const,
        supervisorId: record.supervisorId,
        cycle,
        observedAt: new Date().toISOString(),
        implementation: implementation === null ? null : Object.freeze({
          capabilityCount: implementation.capabilityCount,
          requirementCount: implementation.requirementCount,
          readyFrontier: implementation.readyFrontier,
          blockedOnPredecessor: implementation.blockedOnPredecessor,
          modulesLanded: implementation.modulesLanded,
          conformanceTestsLanded: implementation.conformanceTestsLanded,
          awaitingConformanceCheck: implementation.awaitingConformanceCheck,
          ...projectImplementationDispatchAccounting(implementation),
          conformanceRuns: implementation.conformanceRuns,
        }),
        manifest: parsed.manifest,
        artefactLane: artefactLaneApplies ? "applicable" : "not-applicable-under-a-product-profile",
        artefact: artefact === null ? null : Object.freeze({
          readyFrontier: artefact.readyFrontier,
          realizedCount: artefact.realizedCount,
          alreadySatisfiedCount: artefact.alreadySatisfiedCount,
        }),
        transactions: Object.freeze(transactions.map((entry) => Object.freeze({
          // Which repository the landing targeted. Omitting it made a correctly
          // routed product transaction indistinguishable from a foundation one
          // in every projection built on this record.
          repository: entry.repository ?? null,
          lane: entry.lane, applied: entry.applied ?? false,
          transactionDigest: entry.transactionDigest ?? null,
          pathCount: Array.isArray(entry.derivedAffectedPaths) ? entry.derivedAffectedPaths.length : 0,
          refused: entry.refused ?? null,
        }))),
        // The implementation lane derives facet satisfaction from the selected
        // profile, so it is the truthful source whether or not the artefact
        // lane ran at all.
        facets: (implementation?.facets ?? artefact?.facets ?? null) as Record<string, unknown> | null,
        blockers: Object.freeze(blockers.slice(0, 24)),
        // What the cycle spent, and what it spent it on. Usage rides along with
        // each unit so a costly model that produces nothing is visible per
        // capability rather than only in the total.
        tokenUsage: cycleTokens,
        cumulativeTokens: spentTokens,
        // The frozen target and progress against it, judged on kept tokens.
        usefulTokens,
        usefulTokenTarget: parsed.usefulTokenTarget,
        usefulTokenTargetAchieved: usefulTokens >= parsed.usefulTokenTarget,
        dispatchConcurrency: (implementation?.dispatchConcurrency ?? null) as Record<string, unknown> | null,
        linear,
        providerActivity: Object.freeze(outcomes
          .filter((outcome) => outcome.outcome === "accepted")
          .map((outcome) => Object.freeze({
            capability: outcome.capability, transport: outcome.transport, model: outcome.actualModel,
            totalTokens: ((outcome.usage as Record<string, unknown> | null | undefined)?.totalTokens as number | undefined) ?? null,
          }))
          .slice(0, 24)),
        idleCycles,
        lastReason: linear.terminal !== true ? "linear lane requires attention"
          : implementation === null ? "implementation lane refused"
          : Number(implementation.readyFrontier ?? 0) === 0 ? "no ready implementation work remains"
          : Number(implementation.acceptedResults ?? 0) === 0 ? "the ready frontier produced no accepted result this cycle"
          : "progress",
      });
      await writeJson(repositoryRoot, cycleRecord, projection);
      if (signalled !== null) { reason = `signalled-${signalled}`; break; }
      // A cycle that changed nothing usually means every eligible route is
      // deferred or the frontier is empty. Backing off keeps the supervisor
      // ready without spinning; any progress returns it to the operator's pace.
      const progressed = Number(implementation?.acceptedResults ?? 0) > 0
        || transactions.length > 0
        || (Array.isArray(implementation?.conformanceRuns) && implementation.conformanceRuns.length > 0)
        || (Array.isArray(linear.outcomes) && linear.outcomes.some((outcome) =>
          typeof outcome === "object" && outcome !== null && "status" in outcome && outcome.status === "completed"))
        || (Array.isArray(linear.proposals) && linear.proposals.length > 0);
      idleCycles = progressed ? 0 : Math.min(idleCycles + 1, 3);
      waitSeconds = Math.min(maximumPauseSeconds, parsed.pauseSeconds * 2 ** idleCycles);
      }
      } finally {
        await activity.release();
      }
      if (await pause(repositoryRoot, record.supervisorId, waitSeconds)) { reason = "stop-requested"; break; }
    }
  } catch (error) {
    reason = `failed:${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`;
    throw error;
  } finally {
    process.off("SIGTERM", terminate);
    process.off("SIGINT", interrupt);
    // The last reason survives the process, so status can explain why a
    // supervisor that is no longer running stopped.
    const last = await readJson<Record<string, unknown>>(repositoryRoot, cycleRecord);
    await writeJson(repositoryRoot, cycleRecord, Object.freeze({
      ...(last ?? {}), supervisorId: record.supervisorId, cyclesCompleted: cycle,
      terminalReason: reason, terminatedAt: new Date().toISOString(),
    }));
    const current = await observeSupervisor(repositoryRoot);
    if (current.record?.supervisorId === record.supervisorId) {
      await rm(resolve(repositoryRoot, supervisorRecord), { force: true });
    }
  }
  return {
    output: Object.freeze({
      schema: "urn:usf:hermes-lifecycle:1" as const, version: 1 as const, operation: "supervise" as const,
      running: false, supervisorId: record.supervisorId, cyclesCompleted: cycle, terminalReason: reason,
    }),
    exitCode: exitCodes.SUCCESS,
  };
}
