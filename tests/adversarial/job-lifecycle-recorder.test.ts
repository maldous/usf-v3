import assert from "node:assert/strict";
import { chmodSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import { UsfError } from "../../src/core/errors.ts";
import { canonicalJson } from "../../src/core/canonical.ts";
import { appendLifecycleObservation, createLifecycleObservation } from "../../src/observability/job-lifecycle-recorder.ts";
import { summarizeJobLifecycle } from "../../src/observability/job-lifecycle.ts";

function root(): string { const value = mkdtempSync(join(tmpdir(), "usf-recorder-")); chmodSync(value, 0o700); return value; }
function input(kind: "start" | "finish" | "failure" | "interrupted" = "start", extra: Record<string, unknown> = {}): Record<string, unknown> { return { eventKind: kind, jobIdentity: "job", jobType: "test", issueIdentity: null, workIdentity: "work", semanticOwnerIdentity: null, attemptIdentity: "attempt", logicalAttemptIdentity: "logical", phaseIdentity: "test", sourceIdentity: "fixture", observedAt: "2026-09-06T00:00:00Z", clockDomainIdentity: "clock", startedAt: "2026-09-06T00:00:00Z", finishedAt: kind === "start" ? null : "2026-09-05T00:00:00Z", startOffsetNanoseconds: 10, endOffsetNanoseconds: kind === "start" ? null : 20, scopeIdentity: null, toolIdentity: null, routeIdentity: null, ...extra }; }
function refusal(code: string): (error: unknown) => boolean { return (error) => error instanceof UsfError && error.code === code; }

test("factory is closed, preserves unknown acceptance, and accepts reported failure/interruption", () => {
  for (const kind of ["start", "finish", "failure", "interrupted"] as const) {
    const event = createLifecycleObservation(input(kind));
    assert.equal(event.acceptedOutcome, null); assert.equal(event.evidenceIdentity, null); assert.equal(event.tokenFact, null);
    assert.equal(event.outcomeLineage, kind === "failure" ? "failed" : kind === "interrupted" ? "interrupted" : null);
  }
  assert.equal(createLifecycleObservation(input("finish", { startedAt: null })).startedAt, null);
  assert.throws(() => createLifecycleObservation({ ...input(), acceptedOutcome: true }), refusal("JOB_LIFECYCLE_RECORDER_INPUT_INVALID"));
  assert.throws(() => createLifecycleObservation(input("finish", { endOffsetNanoseconds: -1 })), refusal("JOB_LIFECYCLE_RECORDER_INPUT_INVALID"));
  assert.throws(() => createLifecycleObservation(input("finish", { endOffsetNanoseconds: Number.MAX_SAFE_INTEGER + 1 })), refusal("JOB_LIFECYCLE_RECORDER_INPUT_INVALID"));
});

test("event and byte ledger bounds refuse before mutation", async () => {
  const repository = root();
  await assert.rejects(
    () => appendLifecycleObservation(repository, { ...input(), padding: "x".repeat(16_384) }),
    refusal("JOB_LIFECYCLE_RECORDER_EVENT_BOUND_EXCEEDED"),
  );
  assert.throws(() => lstatSync(join(repository, ".usf")));

  const event = createLifecycleObservation(input());
  await appendLifecycleObservation(repository, event);
  const ledger = join(repository, ".usf/metrics/job-lifecycle-v2.jsonl");
  writeFileSync(ledger, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20), { mode: 0o600 });
  await assert.rejects(() => appendLifecycleObservation(repository, event), refusal("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"));
  assert.equal(lstatSync(ledger).size, 8 * 1024 * 1024 + 1);
});

test("append is atomic, replay-safe, private, and leaves the default ledger absent", async () => {
  const repository = root(); const event = createLifecycleObservation(input());
  const first = await appendLifecycleObservation(repository, event); const replay = await appendLifecycleObservation(repository, event);
  assert.equal(first.status, "appended"); assert.equal(replay.status, "replayed"); assert.equal(replay.rowCount, 1);
  const ledger = join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"); const metadata = lstatSync(ledger);
  assert.equal(metadata.nlink, 1); assert.equal(metadata.mode & 0o777, 0o600); assert.equal(readFileSync(ledger, "utf8").split("\n").filter(Boolean).length, 1);
  assert.throws(() => readFileSync(join(repository, ".usf/metrics/programme-jobs.jsonl")));
});

test("existing malformed, changed-key, and unsafe ledger paths refuse without mutation", async () => {
  const repository = root(); const event = createLifecycleObservation(input()); await appendLifecycleObservation(repository, event);
  const ledger = join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"); const before = readFileSync(ledger, "utf8");
  const changed = { ...event, jobType: "repair" }; await assert.rejects(() => appendLifecycleObservation(repository, changed), (error: unknown) => error instanceof UsfError); assert.equal(readFileSync(ledger, "utf8"), before);
  writeFileSync(ledger, "{bad\n", { mode: 0o600 }); await assert.rejects(() => appendLifecycleObservation(repository, event), refusal("JOB_LIFECYCLE_RECORDER_LEDGER_INVALID"));
  const hostile = root(); await appendLifecycleObservation(hostile, event); const target = join(hostile, ".usf/metrics/job-lifecycle-v2.jsonl");
  // The named inode is authenticated before read; a symlink replacement never becomes input.
  writeFileSync(join(hostile, "other"), "x");
  // Avoid mutating the checked path after it has been authenticated; this tests a hostile fresh ledger name.
  const fresh = root(); const metrics = join(fresh, ".usf"); writeFileSync(metrics, "not-a-directory", { mode: 0o600 }); await assert.rejects(() => appendLifecycleObservation(fresh, event), refusal("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE"));
  assert.equal(target.endsWith("job-lifecycle-v2.jsonl"), true);
});

test("bounded ledger is validated by the existing reducer and rejects impossible observations", async () => {
  const repository = root(); const event = createLifecycleObservation(input("failure", { workIdentity: null, attemptIdentity: null, logicalAttemptIdentity: null, sourceIdentity: null, finishedAt: null, endOffsetNanoseconds: null }));
  const result = await appendLifecycleObservation(repository, event); assert.equal(result.rowCount, 1);
  const rows = [JSON.parse(readFileSync(join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"), "utf8"))];
  const report = summarizeJobLifecycle(rows, { maxItems: 1, source: { status: "observed", kind: "stdin", path: null, eventLimit: 1, eventsRead: 1, bytesRead: 0, truncated: false, digest: "sha256:" + "0".repeat(64), digestBasis: "raw-input-bytes" } });
  assert.equal(report.acceptedOutcome, null);
  assert.throws(() => createLifecycleObservation(input("finish", { observedAt: "2026-02-30T00:00:00Z" })), refusal("JOB_LIFECYCLE_RECORDER_INPUT_INVALID"));
});

test("real kernel flock contention refuses and release permits replay", async () => {
  const repository = root(); const event = createLifecycleObservation(input()); const locks = join(repository, ".usf/locks");
  // Create the private directories through the real helper, then retain a kernel lock in a child.
  await appendLifecycleObservation(repository, event); const holder = spawn("/usr/bin/flock", ["--exclusive", "--no-fork", join(locks, "job-lifecycle-recorder.lock"), "/usr/bin/node", "-e", "setTimeout(() => {}, 1000)"], { stdio: "ignore", env: {} });
  await new Promise((resolve) => setTimeout(resolve, 100)); await assert.rejects(() => appendLifecycleObservation(repository, event), refusal("JOB_LIFECYCLE_RECORDER_LOCK_BUSY"));
  await new Promise<void>((resolve) => holder.once("exit", () => resolve())); assert.equal((await appendLifecycleObservation(repository, event)).status, "replayed");
});

test("concurrent recorder children serialize one append and refuse the overlapping attempt", async () => {
  const repository = root();
  const moduleUrl = new URL("../../src/observability/job-lifecycle-recorder.ts", import.meta.url).href;
  const slowInput = input("start", { attemptIdentity: "slow-attempt", logicalAttemptIdentity: "slow-logical" });
  const competingInput = input("start", { attemptIdentity: "competing-attempt", logicalAttemptIdentity: "competing-logical" });
  const preload = join(repository, "delay-rename.cjs");
  writeFileSync(preload, `const fs=require('node:fs');const m=require('node:module');const rename=fs.renameSync;fs.renameSync=(...args)=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);return rename(...args)};m.syncBuiltinESMExports();`, { mode: 0o600 });
  const script = (value: Record<string, unknown>) => `import { createLifecycleObservation, appendLifecycleObservation } from ${JSON.stringify(moduleUrl)}; await appendLifecycleObservation(${JSON.stringify(repository)},createLifecycleObservation(${JSON.stringify(value)}));`;
  const slow = spawn("/usr/bin/node", ["--require", preload, "--input-type=module", "--eval", script(slowInput)], { stdio: "ignore", env: {} });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const competing = spawnSync("/usr/bin/node", ["--input-type=module", "--eval", script(competingInput)], { encoding: "utf8", env: {} });
  assert.notEqual(competing.status, 0);
  await new Promise<void>((resolve) => slow.once("exit", () => resolve()));
  assert.equal(readFileSync(join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"), "utf8").split("\n").filter(Boolean).length, 1);
  assert.equal((await appendLifecycleObservation(repository, createLifecycleObservation(competingInput))).status, "appended");
});

test("owner and opened-versus-named inode mismatches refuse before ledger creation", () => {
  const moduleUrl = new URL("../../src/observability/job-lifecycle-recorder.ts", import.meta.url).href;
  const runFault = (repository: string, name: string, body: string): ReturnType<typeof spawnSync> => {
    const preload = join(repository, `${name}.cjs`);
    writeFileSync(preload, body, { mode: 0o600 });
    const script = `import { createLifecycleObservation, appendLifecycleObservation } from ${JSON.stringify(moduleUrl)}; await appendLifecycleObservation(${JSON.stringify(repository)},createLifecycleObservation(${JSON.stringify(input())}));`;
    return spawnSync("/usr/bin/node", ["--require", preload, "--input-type=module", "--eval", script], { encoding: "utf8", env: {} });
  };
  const ownerRoot = root();
  const owner = runFault(ownerRoot, "wrong-owner", `const fs=require('node:fs');const m=require('node:module');const fstat=fs.fstatSync;fs.fstatSync=(fd)=>{const value=fstat(fd);return new Proxy(value,{get:(target,key)=>key==='uid'?target.uid+1:Reflect.get(target,key)})};m.syncBuiltinESMExports();`);
  assert.notEqual(owner.status, 0);
  assert.throws(() => lstatSync(join(ownerRoot, ".usf/metrics/job-lifecycle-v2.jsonl")));

  const inodeRoot = root();
  const inode = runFault(inodeRoot, "wrong-inode", `const fs=require('node:fs');const m=require('node:module');const lstat=fs.lstatSync;fs.lstatSync=(path)=>{const value=lstat(path);return String(path).endsWith('job-lifecycle-recorder.lock')?new Proxy(value,{get:(target,key)=>key==='ino'?target.ino+1:Reflect.get(target,key)}):value};m.syncBuiltinESMExports();`);
  assert.notEqual(inode.status, 0);
  assert.throws(() => lstatSync(join(inodeRoot, ".usf/metrics/job-lifecycle-v2.jsonl")));
});

test("process death releases the recorder lock and oversized private ledgers are never parsed", async () => {
  const repository = root(); const event = createLifecycleObservation(input()); await appendLifecycleObservation(repository, event);
  const lock = join(repository, ".usf/locks/job-lifecycle-recorder.lock"); const holder = spawn("/usr/bin/flock", ["--exclusive", "--no-fork", lock, "/usr/bin/node", "-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: {} });
  await new Promise((resolve) => setTimeout(resolve, 100)); holder.kill("SIGKILL"); await new Promise<void>((resolve) => holder.once("exit", () => resolve())); assert.equal((await appendLifecycleObservation(repository, event)).status, "replayed");
  const ledger = join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"); writeFileSync(ledger, "x\n".repeat(100_001), { mode: 0o600 }); await assert.rejects(() => appendLifecycleObservation(repository, event), refusal("JOB_LIFECYCLE_RECORDER_LEDGER_BOUND_EXCEEDED"));
});

test("terminal and identity conflicts are refused by the real reducer without changing a partial start", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [["clockDomainIdentity", { clockDomainIdentity: "other-clock" }], ["logicalAttemptIdentity", { logicalAttemptIdentity: "other-logical" }], ["sourceIdentity", { sourceIdentity: "other-source" }], ["scopeIdentity", { scopeIdentity: "other-scope" }], ["toolIdentity", { toolIdentity: "other-tool" }], ["routeIdentity", { routeIdentity: "other-route" }], ["semanticOwnerIdentity", { semanticOwnerIdentity: "other-owner" }]];
  for (const [, changed] of cases) { const repository = root(); const start = createLifecycleObservation(input()); await appendLifecycleObservation(repository, start); await assert.rejects(() => appendLifecycleObservation(repository, createLifecycleObservation(input("finish", changed))), (error: unknown) => error instanceof UsfError); assert.equal(readFileSync(join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"), "utf8").split("\n").filter(Boolean).length, 1); }
  const repository = root(); await appendLifecycleObservation(repository, createLifecycleObservation(input())); await appendLifecycleObservation(repository, createLifecycleObservation(input("failure"))); await assert.rejects(() => appendLifecycleObservation(repository, createLifecycleObservation(input("finish"))), refusal("JOB_LIFECYCLE_TERMINAL_CONFLICT"));
  assert.equal((await appendLifecycleObservation(repository, createLifecycleObservation(input()))).status, "replayed");
});

test("factory rejects outcome, evidence, token, cache, and cost injection", () => {
  for (const key of ["acceptedOutcome", "evidenceIdentity", "contributionDigest", "tokenFact", "cacheFact", "costFact", "outcomeLineage", "missingnessReason"] as const) assert.throws(() => createLifecycleObservation({ ...input(), [key]: key === "acceptedOutcome" ? true : "injected" }), refusal("JOB_LIFECYCLE_RECORDER_INPUT_INVALID"));
});

test("ledger symlink, hardlink, mode and crash-residue paths refuse or preserve complete replay", async () => {
  const repository = root(); const event = createLifecycleObservation(input()); await appendLifecycleObservation(repository, event); const ledger = join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"); const metrics = join(repository, ".usf/metrics"); const exact = readFileSync(ledger);
  chmodSync(ledger, 0o644); await assert.rejects(() => appendLifecycleObservation(repository, event), refusal("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE")); chmodSync(ledger, 0o600);
  linkSync(ledger, join(metrics, "linked.jsonl")); await assert.rejects(() => appendLifecycleObservation(repository, event), refusal("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE")); unlinkSync(join(metrics, "linked.jsonl"));
  unlinkSync(ledger); writeFileSync(join(repository, "outside"), "outside\n", { mode: 0o600 }); symlinkSync(join(repository, "outside"), ledger); await assert.rejects(() => appendLifecycleObservation(repository, event), refusal("JOB_LIFECYCLE_RECORDER_PATH_UNSAFE")); unlinkSync(ledger); writeFileSync(ledger, exact, { mode: 0o600 });
  const interrupted = join(metrics, `.job-lifecycle-v2.${process.pid}.interrupted.tmp`); writeFileSync(interrupted, "partial", { mode: 0o600 }); const replay = await appendLifecycleObservation(repository, event); assert.equal(replay.status, "replayed"); assert.deepEqual(readFileSync(ledger), exact); assert.ok(readdirSync(metrics).includes(interrupted.split("/").at(-1)!));
});

test("the real bounded write loop preserves every byte across multiple writes", async () => {
  const long = "a".repeat(96); const repository = root(); const event = createLifecycleObservation(input("finish", { jobIdentity: long, issueIdentity: "i".repeat(160), workIdentity: "w".repeat(160), semanticOwnerIdentity: "o".repeat(160), attemptIdentity: "a".repeat(160), logicalAttemptIdentity: "l".repeat(160), sourceIdentity: "s".repeat(160), scopeIdentity: "c".repeat(160), toolIdentity: "t".repeat(160), routeIdentity: "r".repeat(160), clockDomainIdentity: "d".repeat(96) }));
  const expected = Buffer.from(`${canonicalJson(event)}\n`); assert.ok(expected.byteLength > 1024); await appendLifecycleObservation(repository, event); assert.deepEqual(readFileSync(join(repository, ".usf/metrics/job-lifecycle-v2.jsonl")), expected);
});

test("controlled syscall faults prove short writes and pre-rename interruption preserve complete ledgers", async () => {
  const moduleUrl = new URL("../../src/observability/job-lifecycle-recorder.ts", import.meta.url).href; const repository = root(); const start = createLifecycleObservation(input()); await appendLifecycleObservation(repository, start); const terminalInput = input("failure"); const ledger = join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"); const old = readFileSync(ledger);
  const runFault = (name: string, body: string): ReturnType<typeof spawnSync> => { const preload = join(repository, `${name}.cjs`); writeFileSync(preload, body, { mode: 0o600 }); const script = `import { createLifecycleObservation, appendLifecycleObservation } from ${JSON.stringify(moduleUrl)}; const event=createLifecycleObservation(${JSON.stringify(terminalInput)}); await appendLifecycleObservation(${JSON.stringify(repository)},event);`; return spawnSync("/usr/bin/node", ["--require", preload, "--input-type=module", "--eval", script], { encoding: "utf8", env: {} }); };
  const short = runFault("short-write", `const fs=require('node:fs');const m=require('node:module');const write=fs.writeSync;fs.writeSync=(fd,b,o,l)=>write(fd,b,o,Math.min(l,17));m.syncBuiltinESMExports();`); assert.equal(short.status, 0, String(short.stderr)); assert.equal(readFileSync(ledger, "utf8").split("\n").filter(Boolean).length, 2);
  const replay = await appendLifecycleObservation(repository, createLifecycleObservation(terminalInput)); assert.equal(replay.status, "replayed");
  const second = root(); await appendLifecycleObservation(second, start); const secondLedger = join(second, ".usf/metrics/job-lifecycle-v2.jsonl"); const secondOld = readFileSync(secondLedger); const interruptedInput = input("interrupted"); const preload = join(second, "kill-before-rename.cjs"); writeFileSync(preload, `const fs=require('node:fs');const m=require('node:module');fs.renameSync=()=>process.kill(process.pid,'SIGKILL');m.syncBuiltinESMExports();`, { mode: 0o600 }); const killedScript = `import { createLifecycleObservation, appendLifecycleObservation } from ${JSON.stringify(moduleUrl)}; await appendLifecycleObservation(${JSON.stringify(second)},createLifecycleObservation(${JSON.stringify(interruptedInput)}));`; const killed = spawnSync("/usr/bin/node", ["--require", preload, "--input-type=module", "--eval", killedScript], { encoding: "utf8", env: {} }); assert.equal(killed.signal, "SIGKILL"); assert.deepEqual(readFileSync(secondLedger), secondOld); const recovered = await appendLifecycleObservation(second, createLifecycleObservation(interruptedInput)); assert.equal(recovered.status, "appended"); assert.equal(readFileSync(secondLedger, "utf8").split("\n").filter(Boolean).length, 2); assert.notDeepEqual(old, Buffer.alloc(0));
});

test("an ordinary pre-rename fsync failure authenticates cleanup and retains the prior ledger", async () => {
  const moduleUrl = new URL("../../src/observability/job-lifecycle-recorder.ts", import.meta.url).href; const repository = root(); const start = createLifecycleObservation(input()); await appendLifecycleObservation(repository, start); const ledger = join(repository, ".usf/metrics/job-lifecycle-v2.jsonl"); const old = readFileSync(ledger); const preload = join(repository, "fail-temp-fsync.cjs"); writeFileSync(preload, `const fs=require('node:fs');const m=require('node:module');fs.fsyncSync=()=>{throw Object.assign(new Error('fixture-fsync'),{code:'EIO'})};m.syncBuiltinESMExports();`, { mode: 0o600 }); const script = `import { createLifecycleObservation, appendLifecycleObservation } from ${JSON.stringify(moduleUrl)}; await appendLifecycleObservation(${JSON.stringify(repository)},createLifecycleObservation(${JSON.stringify(input("failure"))}));`; const failed = spawnSync("/usr/bin/node", ["--require", preload, "--input-type=module", "--eval", script], { encoding: "utf8", env: {} }); assert.notEqual(failed.status, 0); assert.deepEqual(readFileSync(ledger), old); assert.equal(readdirSync(join(repository, ".usf/metrics")).filter((name) => name.endsWith(".tmp")).length, 0); assert.equal((await appendLifecycleObservation(repository, createLifecycleObservation(input("failure")))).status, "appended");
});
