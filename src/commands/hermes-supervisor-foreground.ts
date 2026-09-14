import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { linuxProcessInspector, type ProcessIdentity } from "../continuous/lifecycle.ts";
import { acquireStewardActivity, bindSupervisorToActiveClaimUnderActivity, withStewardedOperation, type StewardshipDependencies, type StewardshipLock } from "../continuous/stewardship.ts";

const supervisorRoot = ".usf/hermes/supervisor";
const supervisorRecord = `${supervisorRoot}/supervisor.json`;
const stopRequestRecord = `${supervisorRoot}/stop-request.json`;
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const maximumRuntimeRecordBytes = 64 * 1024;

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

function currentUid(): number {
  const uid = process.getuid?.();
  if (process.platform !== "linux" || uid === undefined || uid === 0) {
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime files require a non-root Linux owner.");
  }
  return uid;
}

async function privateDirectory(path: string, create: boolean): Promise<boolean> {
  if (create) await mkdir(path, { recursive: true, mode: privateDirectoryMode });
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (metadata === undefined) return false;
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid()
    || (metadata.mode & 0o777) !== privateDirectoryMode) {
    throw new UsfError("HERMES_RUNTIME_UNSAFE", exitCodes.CONTAINMENT_REFUSAL, "Hermes runtime directories must be owner-controlled real directories.");
  }
  return true;
}

async function secureRuntimeRoot(repositoryRoot: string, create: boolean): Promise<string | null> {
  const base = resolve(repositoryRoot, ".usf");
  if (!await privateDirectory(base, create)) return null;
  const hermes = resolve(base, "hermes");
  if (!await privateDirectory(hermes, create)) return null;
  const supervisor = resolve(hermes, "supervisor");
  if (!await privateDirectory(supervisor, create)) return null;
  return supervisor;
}

async function readJson<T>(repositoryRoot: string, path: string): Promise<T | null> {
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

function validProcessIdentity(value: unknown): value is ProcessIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Number.isSafeInteger(item.pid) && Number(item.pid) > 0 && Number.isSafeInteger(item.uid) && Number(item.uid) >= 0
    && typeof item.bootId === "string" && typeof item.startTicks === "string"
    && typeof item.argvDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.argvDigest)
    && typeof item.executablePathDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(item.executablePathDigest);
}

function validRecord(value: unknown): value is HermesSupervisorRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.schema === "urn:usf:hermes-supervisor:1" && item.version === 1
    && typeof item.supervisorId === "string" && typeof item.startedAt === "string"
    && typeof item.manifest === "string" && typeof item.envFile === "string"
    && typeof item.authorityIdentity === "string" && validProcessIdentity(item.process)
    && Number.isSafeInteger(item.usefulTokenTarget) && Number(item.usefulTokenTarget) >= 100_000
    && Number.isSafeInteger(item.pauseSeconds) && Number(item.pauseSeconds) > 0
    && Number.isSafeInteger(item.concurrency) && Number(item.concurrency) > 0
    && Number.isSafeInteger(item.dispatchLimit) && Number(item.dispatchLimit) > 0;
}

async function observeForegroundSupervisor(repositoryRoot: string): Promise<HermesSupervisorRecord | null> {
  const value = await readJson<unknown>(repositoryRoot, supervisorRecord);
  if (value === null) return null;
  if (!validRecord(value)) throw new UsfError("HERMES_RUNTIME_INVALID", exitCodes.CONTAINMENT_REFUSAL, "Hermes supervisor record is malformed.");
  const observed = await linuxProcessInspector.inspect(value.process.pid).catch(() => null);
  if (observed === null || canonicalDigest(observed) !== canonicalDigest(value.process)) return null;
  return value;
}

export async function registerForegroundSupervisor(repositoryRoot: string, input: {
  readonly lifetime: StewardshipLock;
  readonly process: ProcessIdentity;
  readonly claimId: string;
  readonly generation: string;
  readonly dependencies: StewardshipDependencies;
  readonly record: HermesSupervisorRecord;
}): Promise<HermesSupervisorRecord> {
  if (!input.lifetime.held() || !validProcessIdentity(input.process) || canonicalDigest(input.record.process) !== canonicalDigest(input.process)) {
    throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "Foreground admission requires held lifetime ownership and exact process identity.");
  }
  return withStewardedOperation(repositoryRoot, input.claimId, input.generation, async () => {
    if (await observeForegroundSupervisor(repositoryRoot) !== null) {
      throw new UsfError("HERMES_SUPERVISOR_ALREADY_ACTIVE", exitCodes.DOMAIN_FAILURE, "A live supervisor already owns this repository.");
    }
    const observed = await linuxProcessInspector.inspect(input.process.pid);
    if (observed === null || canonicalDigest(observed) !== canonicalDigest(input.process)) {
      throw new UsfError("HERMES_SUPERVISOR_ADMISSION_REQUIRED", exitCodes.CONTAINMENT_REFUSAL, "Foreground process identity moved.");
    }
    await bindSupervisorToActiveClaimUnderActivity(repositoryRoot, input.claimId, input.generation, input.process, input.dependencies);
    await writeJson(repositoryRoot, supervisorRecord, input.record);
    return input.record;
  }, input.dependencies);
}

export async function foregroundSupervisorStopRequested(repositoryRoot: string, record: HermesSupervisorRecord): Promise<boolean> {
  const request = await readJson<{ supervisorId?: unknown }>(repositoryRoot, stopRequestRecord);
  return request?.supervisorId === record.supervisorId;
}

export async function unregisterForegroundSupervisor(repositoryRoot: string, record: HermesSupervisorRecord): Promise<void> {
  const activity = await acquireStewardActivity(repositoryRoot);
  try {
    const current = await readJson<unknown>(repositoryRoot, supervisorRecord);
    if (!validRecord(current) || current.supervisorId !== record.supervisorId || canonicalDigest(current.process) !== canonicalDigest(record.process)) return;
    await writeJson(repositoryRoot, `${supervisorRoot}/foreground-${record.supervisorId}.json`, { record, stoppedAt: new Date().toISOString() });
    await rm(resolve(repositoryRoot, supervisorRecord));
    const request = await readJson<{ supervisorId?: unknown }>(repositoryRoot, stopRequestRecord);
    if (request?.supervisorId === record.supervisorId) await rm(resolve(repositoryRoot, stopRequestRecord), { force: true });
  } finally { await activity.release(); }
}
