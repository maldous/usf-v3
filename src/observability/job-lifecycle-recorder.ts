import { closeSync, constants, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { canonicalDigest, canonicalJson, sha256 } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { summarizeJobLifecycle } from "./job-lifecycle.ts";

const EVENT_BYTES = 16_384;
const LEDGER_BYTES = 8 * 1024 * 1024;
const LEDGER_ROWS = 100_000;
const PRIVATE = 0o600;
const DIRECTORY = 0o700;
const eventKeys = ["eventKind", "jobIdentity", "jobType", "issueIdentity", "workIdentity", "semanticOwnerIdentity", "attemptIdentity", "logicalAttemptIdentity", "phaseIdentity", "sourceIdentity", "observedAt", "clockDomainIdentity", "startedAt", "finishedAt", "startOffsetNanoseconds", "endOffsetNanoseconds", "scopeIdentity", "toolIdentity", "routeIdentity"] as const;
const identityPattern = /^[A-Za-z0-9._:-]{1,160}$/u;
const jobPattern = /^[A-Za-z0-9._:-]{1,96}$/u;
const phases = new Set(["discovery", "semantic-authoring", "routing", "qualification", "implementation", "test", "review", "repair", "integration", "environment-observation"]);
const jobTypes = new Set(["discovery", "semantic-authoring", "routing-qualification", "implementation", "test", "review", "repair", "integration", "environment-observation"]);

export type LifecycleObservationInput = Readonly<Record<(typeof eventKeys)[number], unknown>>;
export type LifecycleAppendResult = Readonly<{ status: "appended" | "replayed"; eventKey: string; ledgerDigest: `sha256:${string}`; byteCount: number; rowCount: number }>;

function refuse(code: string): never { throw new UsfError(code, exitCodes.CONTAINMENT_REFUSAL, "Lifecycle observation was refused."); }
function own(stat: Stats, mode: number): void { if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o777) !== mode) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"); }
function directory(path: string): void {
  const metadata = lstatSync(path); if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== DIRECTORY) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE");
}
function privateDirectory(path: string): void { try { directory(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; mkdirSync(path, { mode: DIRECTORY }); directory(path); } }
function utc(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value)) return false; const milliseconds = Date.parse(value); return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === (value.includes(".") ? value : `${value.slice(0, -1)}.000Z`); }
function nullableIdentity(value: unknown, pattern = identityPattern): value is string | null { return value === null || (typeof value === "string" && pattern.test(value)); }
function offset(value: unknown): number | null { if (value === null) return null; return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function assertFactoryInput(input: unknown): asserts input is LifecycleObservationInput {
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) refuse("JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
  const row = input as Record<string, unknown>; if (Object.keys(row).length !== eventKeys.length || eventKeys.some((key) => !Object.hasOwn(row, key)) || Object.keys(row).some((key) => !eventKeys.includes(key as (typeof eventKeys)[number]))) refuse("JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
  if (typeof row.eventKind !== "string" || !["start", "finish", "failure", "interrupted"].includes(row.eventKind) || typeof row.jobIdentity !== "string" || !jobPattern.test(row.jobIdentity) || typeof row.jobType !== "string" || !jobTypes.has(row.jobType) || typeof row.phaseIdentity !== "string" || !phases.has(row.phaseIdentity) || !utc(row.observedAt) || typeof row.clockDomainIdentity !== "string" || !jobPattern.test(row.clockDomainIdentity) || (row.startedAt !== null && !utc(row.startedAt)) || (row.finishedAt !== null && !utc(row.finishedAt))) refuse("JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
  for (const key of ["issueIdentity", "workIdentity", "semanticOwnerIdentity", "attemptIdentity", "logicalAttemptIdentity", "sourceIdentity", "scopeIdentity", "toolIdentity", "routeIdentity"] as const) if (!nullableIdentity(row[key])) refuse("JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
  if ((row.startOffsetNanoseconds !== null && offset(row.startOffsetNanoseconds) === null) || (row.endOffsetNanoseconds !== null && offset(row.endOffsetNanoseconds) === null)) refuse("JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
  if (row.eventKind === "start" && (row.finishedAt !== null || row.endOffsetNanoseconds !== null)) refuse("JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
}

export function createLifecycleObservation(input: unknown): Readonly<Record<string, unknown>> {
  assertFactoryInput(input); const row = input as Record<string, unknown>; const end = offset(row.endOffsetNanoseconds); const start = offset(row.startOffsetNanoseconds);
  const duration = row.eventKind === "start" || start === null || end === null || end < start ? null : end - start;
  const missingnessReason = duration === null ? "Reported duration and acceptance are unknown." : "Reported acceptance and resource facts are unknown.";
  const event = Object.freeze({ schema: "urn:usf:job-lifecycle-metric-event:2", eventKind: row.eventKind, eventKey: canonicalDigest({ jobIdentity: row.jobIdentity, workIdentity: row.workIdentity, attemptIdentity: row.attemptIdentity, phaseIdentity: row.phaseIdentity, eventKind: row.eventKind }), jobIdentity: row.jobIdentity, jobType: row.jobType, issueIdentity: row.issueIdentity, workIdentity: row.workIdentity, semanticOwnerIdentity: row.semanticOwnerIdentity, attemptIdentity: row.attemptIdentity, logicalAttemptIdentity: row.logicalAttemptIdentity, phaseIdentity: row.phaseIdentity, sourceIdentity: row.sourceIdentity, evidenceIdentity: null, contributionDigest: null, observedAt: row.observedAt, clockIdentity: "monotonic-plus-utc-observation", durationUnit: "nanoseconds", startOffsetNanoseconds: start, endOffsetNanoseconds: row.eventKind === "start" ? null : end, durationNanoseconds: duration, parentAttemptIdentity: null, overlapDisposition: "unknown", scopeIdentity: row.scopeIdentity, toolIdentity: row.toolIdentity, routeIdentity: row.routeIdentity, intervals: Object.freeze({ queue: null, modelActive: null, command: null, validation: null, integration: null, total: duration }), outcomeLineage: row.eventKind === "failure" ? "failed" : row.eventKind === "interrupted" ? "interrupted" : null, acceptedOutcome: null, missingnessReason, tokenFact: null, cacheFact: null, costFact: null, clockDomainIdentity: row.clockDomainIdentity, startedAt: row.startedAt, finishedAt: row.eventKind === "start" ? null : row.finishedAt });
  summarizeJobLifecycle([event], { maxItems: 1, source: { status: "observed", kind: "stdin", path: null, eventLimit: 1, eventsRead: 1, bytesRead: 0, truncated: false, digest: sha256(canonicalJson(event)), digestBasis: "raw-input-bytes" } });
  return event;
}

function lock(handle: number): Promise<void> { return new Promise((done, reject) => { const child = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"], { env: {}, stdio: ["ignore", "ignore", "ignore", handle] }); child.once("error", () => reject(new UsfError("JOB_LIFECYCLE_RECORDER_LOCK_UNAVAILABLE", exitCodes.EXTERNAL_UNAVAILABLE, "Lifecycle lock is unavailable."))); child.once("exit", (code) => code === 0 ? done() : reject(new UsfError(code === 75 ? "JOB_LIFECYCLE_RECORDER_LOCK_BUSY" : "JOB_LIFECYCLE_RECORDER_LOCK_UNAVAILABLE", exitCodes.INTEGRATION_CONFLICT, "Lifecycle lock is unavailable."))); }); }
function fsyncDirectory(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function safeRoot(root: string): string { if (!resolve(root).startsWith("/") || resolve(root) !== root) refuse("JOB_LIFECYCLE_RECORDER_ROOT_INVALID"); const metadata = lstatSync(root); if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o022) !== 0) refuse("JOB_LIFECYCLE_RECORDER_ROOT_INVALID"); return root; }
// In mode2 the authenticated launcher has already proved the exact namespace
// mapping; host-root tools appear to the permitted Node child as overflow uid.
function admittedFlockOwner(uid: number): boolean { return uid === 0 || uid === 65_534; }
function existingLedger(path: string): Buffer { try { const stat = lstatSync(path); if (stat.isSymbolicLink()) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"); own(stat, PRIVATE); const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const opened = fstatSync(fd); own(opened, PRIVATE); if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > LEDGER_BYTES) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"); const bytes = readFileSync(fd); const after = fstatSync(fd); if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"); return bytes; } finally { closeSync(fd); } } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0); throw error; } }
function writeExactly(fd: number, bytes: Buffer): void { let offset = 0; while (offset < bytes.byteLength) { const remaining = bytes.byteLength - offset; const written = writeSync(fd, bytes, offset, Math.min(remaining, 1024)); if (!Number.isSafeInteger(written) || written <= 0 || written > remaining) refuse("JOB_LIFECYCLE_RECORDER_WRITE_FAILED"); offset += written; } }
function temporaryPath(metrics: string): string { return join(metrics, `.job-lifecycle-v2.${process.pid}.${process.hrtime.bigint().toString()}.tmp`); }
function removeOwnedTemporary(path: string, stat: Stats): void { const named = lstatSync(path); if (named.isSymbolicLink() || named.dev !== stat.dev || named.ino !== stat.ino) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"); own(named, PRIVATE); unlinkSync(path); fsyncDirectory(dirname(path)); }

export async function appendLifecycleObservation(repositoryRoot: string, event: unknown): Promise<LifecycleAppendResult> {
  const root = safeRoot(repositoryRoot); const canonical = canonicalJson(event); const line = Buffer.from(`${canonical}\n`, "utf8"); if (line.byteLength > EVENT_BYTES) refuse("JOB_LIFECYCLE_RECORDER_EVENT_BOUND_EXCEEDED");
  const expected = createLifecycleObservation(Object.fromEntries(eventKeys.map((key) => [key, (event as Record<string, unknown>)[key]])));
  if (canonicalJson(expected) !== canonical) refuse("JOB_LIFECYCLE_RECORDER_EVENT_INVALID");
  const usf = join(root, ".usf"); privateDirectory(usf); const metrics = join(usf, "metrics"); const locks = join(usf, "locks"); privateDirectory(metrics); privateDirectory(locks);
  const lockPath = join(locks, "job-lifecycle-recorder.lock"); const lockFd = openSync(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, PRIVATE); try {
    own(fstatSync(lockFd), PRIVATE); const named = lstatSync(lockPath); if (named.isSymbolicLink() || named.dev !== fstatSync(lockFd).dev || named.ino !== fstatSync(lockFd).ino) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE");
    const flock = lstatSync("/usr/bin/flock"); if (!flock.isFile() || flock.isSymbolicLink() || !admittedFlockOwner(flock.uid) || (flock.mode & 0o022) !== 0 || (flock.mode & 0o111) === 0) refuse("JOB_LIFECYCLE_RECORDER_LOCK_UNAVAILABLE"); await lock(lockFd);
    const path = join(metrics, "job-lifecycle-v2.jsonl"); const old = existingLedger(path); if (old.byteLength > LEDGER_BYTES) refuse("JOB_LIFECYCLE_RECORDER_LEDGER_BOUND_EXCEEDED"); const text = old.toString("utf8"); if (Buffer.from(text, "utf8").compare(old) !== 0 || (old.byteLength > 0 && !text.endsWith("\n"))) refuse("JOB_LIFECYCLE_RECORDER_LEDGER_INVALID"); const rows = text === "" ? [] : text.slice(0, -1).split("\n"); if (rows.length > LEDGER_ROWS) refuse("JOB_LIFECYCLE_RECORDER_LEDGER_BOUND_EXCEEDED");
    const parsed = rows.map((row) => { try { const value = JSON.parse(row); if (canonicalJson(value) !== row) refuse("JOB_LIFECYCLE_RECORDER_LEDGER_INVALID"); return value; } catch (error) { if (error instanceof UsfError) throw error; return refuse("JOB_LIFECYCLE_RECORDER_LEDGER_INVALID"); } }); summarizeJobLifecycle(parsed, { maxItems: 1, source: { status: "observed", kind: "repository-relative-jsonl", path: ".usf/metrics/job-lifecycle-v2.jsonl", eventLimit: LEDGER_ROWS, eventsRead: parsed.length, bytesRead: old.byteLength, truncated: false, digest: sha256(old), digestBasis: "raw-input-bytes" } });
    const duplicate = rows.includes(canonical); if (duplicate) return Object.freeze({ status: "replayed", eventKey: expected.eventKey as string, ledgerDigest: sha256(old), byteCount: old.byteLength, rowCount: rows.length }); if (rows.length >= LEDGER_ROWS || old.byteLength + line.byteLength > LEDGER_BYTES) refuse("JOB_LIFECYCLE_RECORDER_LEDGER_BOUND_EXCEEDED");
    const next = Buffer.concat([old, line]); const proposed = [...parsed, event]; summarizeJobLifecycle(proposed, { maxItems: 1, source: { status: "observed", kind: "stdin", path: null, eventLimit: LEDGER_ROWS, eventsRead: proposed.length, bytesRead: next.byteLength, truncated: false, digest: sha256(next), digestBasis: "raw-input-bytes" } }); const temporary = temporaryPath(metrics); let temporaryStat: Stats | undefined; let renamed = false;
    try { const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, PRIVATE); try { temporaryStat = fstatSync(fd); own(temporaryStat, PRIVATE); writeExactly(fd, next); fsyncSync(fd); } finally { closeSync(fd); } const named = lstatSync(temporary); if (named.isSymbolicLink() || named.dev !== temporaryStat.dev || named.ino !== temporaryStat.ino) refuse("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"); own(named, PRIVATE); renameSync(temporary, path); renamed = true; fsyncDirectory(metrics); if (!existingLedger(path).equals(next)) refuse("JOB_LIFECYCLE_RECORDER_READBACK_MISMATCH"); return Object.freeze({ status: "appended", eventKey: expected.eventKey as string, ledgerDigest: sha256(next), byteCount: next.byteLength, rowCount: proposed.length });
    } finally { if (!renamed && temporaryStat !== undefined) removeOwnedTemporary(temporary, temporaryStat); }
  } finally { closeSync(lockFd); }
}
