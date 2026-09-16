import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import * as throughput from "../../../scripts/completion-throughput.ts";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";

const GiB = 1024 ** 3;

// These fixtures are metadata-only. No host cgroup or service is changed.
function tuningResourceFixture(overrides: Record<string, string | Error> = {}) {
  const files: Record<string, string | Error> = {
    "/proc/self/cgroup": "0::/user.slice/app.slice/leaf.scope\n",
    "/proc/self/mountinfo": "29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/meminfo": "MemAvailable: 21390950 kB\nSwapTotal: 67108864 kB\nSwapFree: 21181235 kB\n",
    "/proc/pressure/memory": "some avg10=0.00 avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
    "/proc/pressure/cpu": "some avg10=2.24 avg60=2.24 avg300=2.24 total=1\n",
    "/proc/pressure/io": "some avg10=0.18 avg60=0.18 avg300=0.18 total=1\n",
    "/proc/vmstat": "pswpin 100\npswpout 200\n",
  };
  for (const suffix of ["", "/user.slice", "/user.slice/app.slice", "/user.slice/app.slice/leaf.scope"]) {
    const base = "/sys/fs/cgroup" + suffix;
    files[base + "/cgroup.controllers"] = suffix.endsWith("leaf.scope") ? "memory pids\n" : "cpu memory pids\n";
    files[base + "/cgroup.subtree_control"] = suffix.endsWith("app.slice") ? "memory pids\n" : "cpu memory pids\n";
    if (suffix === "") continue; // Root limit files are legitimately absent.
    if (!suffix.endsWith("leaf.scope")) files[base + "/cpu.max"] = "max 100000\n";
    files[base + "/memory.max"] = "max\n";
    files[base + "/memory.high"] = "max\n";
    files[base + "/memory.current"] = suffix.endsWith("leaf.scope") ? "9640000000\n" : "19340000000\n";
    files[base + "/memory.events"] = "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n";
    files[base + "/pids.max"] = "76279\n";
    files[base + "/pids.current"] = "100\n";
  }
  Object.assign(files, overrides);
  return {
    cpuCount: 16,
    readText(path: string): string {
      const value = files[path];
      if (value instanceof Error) throw value;
      if (value === undefined) throw Object.assign(new Error("missing fixture metadata"), { code: "ENOENT" });
      return value;
    },
  };
}



test("root preflight fractional cgroup CPU quotas produce a finite positive integer ordinary cap", async () => {
  const source = await readFile(resolve(root, "scripts/test-full.mjs"), "utf8");
  const body = source.match(/async function runOrdinaryTests\s*\([^)]*\)\s*\{[\s\S]*?^\}/mu)?.[0];
  assert.ok(body, "exercise the actual runner function, never the runner entry point");
  const { runInNewContext } = await import("node:vm");
  for (const resources of [
    ...[1.5, 0.5, 2.75, 16, NaN, Infinity].map(cpuCount => ({ complete: true, cpuCount })),
    { complete: false, cpuCount: 16 },
  ]) {
    const calls: { args: string[]; concurrency: number }[] = [];
    const sandbox = {
      completionTest: "tests/integration/work-completion.test.ts",
      actualOrdinaryWorkers: 0,
      readCompletionResources: () => resources,
      recoveryAdmission: () => ({ admitted: true }),
      progress: () => {},
      digest: (value: string) => "test:" + value,
      fail: (code: string) => { throw new Error(code); },
      runTestChild: (args: string[], _label: string, metadata: { concurrency: number }) => {
        calls.push({ args, concurrency: metadata.concurrency });
        return Promise.resolve({ exitCode: 0 });
      },
      runCompletionCohort: () => { throw new Error("native completion must not launch"); },
    };
    const run = runInNewContext("(" + body + ")", sandbox) as
      (paths: string[], options: { ordinaryWorkers: number; recoveryWorkers: number }, recommendation: null) => Promise<void>;
    await run(["tests/unit/synthetic-ordinary.test.ts"], { ordinaryWorkers: 4, recoveryWorkers: 2 }, null);
    assert.equal(calls.length, 1);
    const actual = calls[0]!.concurrency;
    assert.ok(Number.isFinite(actual) && Number.isInteger(actual) && actual > 0,
      "fractional effective CPU quota " + resources.cpuCount + " must not reach --test-concurrency as " + actual);
    const expected = resources.complete && Number.isFinite(resources.cpuCount)
      ? Math.max(1, Math.min(4, Math.floor(resources.cpuCount))) : 1;
    assert.equal(actual, expected);
    assert.ok(calls[0]!.args.includes("--test-concurrency=" + expected));
  }
});

test("root preflight FIFO replacement race uses nonblocking nofollow open and closes without reading", async () => {
  const source = await readFile(resolve(root, "scripts/test-full.mjs"), "utf8");
  const body = source.match(/(?:async\s+)?function readPrivateBenchmarkFile\s*\([^)]*\)\s*\{[\s\S]*?^\}/mu)?.[0];
  assert.ok(body, "exercise the production private-file reader with a deterministic replacement race");
  const { runInNewContext } = await import("node:vm");
  const { constants } = await import("node:fs");
  const { dirname } = await import("node:path");
  const repositoryRoot = "/synthetic-private-repository";
  const path = resolve(repositoryRoot, ".usf/logs/full-gate-benchmarks/report.json");
  const descriptor = 73;
  const regular = {
    uid: process.getuid?.(), mode: 0o100600, nlink: 1, size: 2, dev: 10, ino: 20,
    isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
  };
  let leafChecks = 0;
  let flags: number | undefined;
  let descriptorChecks = 0;
  let reads = 0;
  const closed: number[] = [];
  const reader = runInNewContext("(" + body + ")", {
    repositoryRoot, resolve, dirname, constants, process, maxBuffer: 16 * 1024 * 1024,
    fail: (code: string) => { throw Object.assign(new Error(code), { code }); },
    lstatSync: (target: string) => {
      if (target === path) { leafChecks++; return regular; }
      return { ...regular, mode: 0o40700, isDirectory: () => true, isFile: () => false };
    },
    openSync: (target: string, value: number) => { assert.equal(target, path); flags = value; return descriptor; },
    fstatSync: (handle: number) => {
      assert.equal(handle, descriptor);
      descriptorChecks++;
      return { ...regular, mode: 0o010600, ino: 21, isFile: () => false };
    },
    readFileSync: () => { reads++; throw new Error("must not read the replacement FIFO"); },
    closeSync: (handle: number) => { closed.push(handle); },
  }) as (path: string) => unknown;
  assert.throws(() => reader(path), { code: "FULL_GATE_BENCHMARK_FILE_UNTRUSTED" });
  assert.notEqual(flags, undefined);
  assert.ok((flags! & constants.O_NONBLOCK) !== 0, "leaf can become a FIFO after lstat; open must never wait for a writer");
  assert.ok((flags! & constants.O_NOFOLLOW) !== 0, "replacement symlinks must remain refused");
  assert.equal(leafChecks, 1);
  assert.equal(descriptorChecks, 1);
  assert.equal(reads, 0);
  assert.deepEqual(closed, [descriptor]);
});

test("root preflight FIFO benchmark reports refuse promptly without admission or native launch", { timeout: 10_000 }, async () => {
  const f = await fixture();
  try {
    const source = await readFile(resolve(root, "scripts/test-full.mjs"), "utf8");
    const reader = source.match(/(?:async\s+)?function readPrivateBenchmarkFile\s*\([^)]*\)\s*\{[\s\S]*?^\}/mu)?.[0];
    assert.ok(reader, "extract only the actual private report reader, never execute the root entry point");
    const directory = resolve(f.directory, ".usf/logs/full-gate-benchmarks");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const fifo = resolve(directory, "20260916T000000000Z-1.json");
    const made = spawnSync("mkfifo", ["-m", "600", fifo], { encoding: "utf8", timeout: 2000 });
    assert.equal(made.status, 0, made.stderr || String(made.error ?? ""));
    const program = [
      'const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");',
      'class GateError extends Error { constructor(code, details = {}) { super(code); this.code = code; this.details = details; } }',
      'const forbidden = name => () => { const error = new Error("forbidden preflight effect: " + name); error.forbidden = true; throw error; };',
      'const sandbox = { ...fs, ...path, process, Buffer, GateError, repositoryRoot: process.argv[3], maxBuffer: 16 * 1024 * 1024,',
      '  fail: (code, details) => { throw new GateError(code, details); },',
      '  acquireFullGateLock: forbidden("fence"), createGateChildOwner: forbidden("owner"),',
      '  spawn: forbidden("spawn"), spawnSync: forbidden("spawnSync"),',
      '  mkdirSync: forbidden("mkdir"), writeFileSync: forbidden("write"), renameSync: forbidden("rename") };',
      'const reader = vm.runInNewContext("(" + process.argv[1] + ")", sandbox);',
      'Promise.resolve().then(() => reader(process.argv[2])).then(() => { process.stderr.write("FIFO was accepted"); process.exitCode = 90; }, error => {',
      '  if (error?.forbidden || error?.name === "ReferenceError" || error?.name === "TypeError") { process.stderr.write(String(error)); process.exitCode = 91; return; }',
      '  process.stdout.write(JSON.stringify({ rejected: true, code: error?.code ?? null, name: error?.name }));',
      '});',
    ].join("\n");
    const observed = spawnSync(process.execPath, ["--eval", program, reader, fifo, f.directory], {
      cwd: f.directory, encoding: "utf8", timeout: 1000, killSignal: "SIGKILL",
    });
    assert.equal(observed.error, undefined, "private reader must reject a FIFO without waiting for a writer: " + String(observed.error ?? ""));
    assert.equal(observed.signal, null);
    assert.equal(observed.status, 0, observed.stderr);
    assert.equal(JSON.parse(observed.stdout).rejected, true);
    assert.deepEqual((await readdir(directory)).sort(), ["20260916T000000000Z-1.json"]);
    assert.deepEqual((await readdir(resolve(f.directory, ".usf/logs"))).sort(), ["full-gate-benchmarks"]);
  } finally { await f.cleanup(); }
});
const safetyObservation = { complete: true, ordinaryPeakBytes: GiB, recoveryPeakBytes: GiB, ordinaryWorkers: 4 };

test("worker tuning safety refuses a raised normal recovery launch when resources fall during producer", { timeout: 15_000 }, async () => {
  const f = await fixture();
  let live = (throughput as any).readCompletionResources(tuningResourceFixture());
  const events: Record<string, any>[] = [];
  try {
    await assert.rejects(() => runCompletionCohort({
      repositoryRoot: f.directory, recoveryWorkers: 3, ordinaryWorkers: 4,
      resourceSnapshot: () => live, admissionObservation: safetyObservation,
      sourceIdentity: () => "same-synthetic-cohort", expectedSourceIdentity: "same-synthetic-cohort",
      expectedSeedFingerprint: "d".repeat(64), commandForStage: fakeCommand("serial"),
      onEvent(event: Record<string, any>) {
        events.push(event);
        if (event.phase === "completion-child" && event.role === "producer" && event.status === "passed")
          live = { ...live, availableMemoryBytes: 19 * GiB };
      },
    }), /COMPLETION_WORKER_ADMISSION_REFUSED/u);
    assert.equal(events.filter(event => event.phase === "completion-child" && event.status === "started"
      && event.role.startsWith("recovery-")).length, 0);
  } finally { await f.cleanup(); }
});

test("worker tuning safety rechecks benchmark baseline admission after producer instead of trusting initial headroom", { timeout: 15_000 }, async () => {
  const f = await fixture();
  let live = (throughput as any).readCompletionResources(tuningResourceFixture());
  const events: Record<string, any>[] = [];
  try {
    await assert.rejects(() => (throughput as any).runCompletionBenchmark({
      repositoryRoot: f.directory, ordinaryWorkers: 4, budgetMilliseconds: 10_000,
      resourceSnapshot: () => live, sourceIdentity: () => "same-synthetic-cohort",
      commandForStage: fakeCommand("serial"), measureRound: () => safetyObservation,
      onEvent(event: Record<string, any>) {
        events.push(event);
        if (event.phase === "completion-child" && event.role === "producer" && event.status === "passed")
          live = { ...live, availableMemoryBytes: 17 * GiB };
      },
    }), /BENCHMARK_BASELINE_ADMISSION_REFUSED/u);
    assert.equal(events.filter(event => event.phase === "completion-child" && event.status === "started"
      && event.role.startsWith("recovery-")).length, 0);
  } finally { await f.cleanup(); }
});

test("worker tuning safety rechecks finalist admission at launch after an earlier admissible observation", { timeout: 15_000 }, async () => {
  const f = await fixture();
  let live = (throughput as any).readCompletionResources(tuningResourceFixture());
  const events: Record<string, any>[] = [];
  try {
    await assert.rejects(() => (throughput as any).runCompletionBenchmark({
      repositoryRoot: f.directory, ordinaryWorkers: 4, budgetMilliseconds: 10_000,
      resourceSnapshot: () => live, sourceIdentity: () => "same-synthetic-cohort",
      commandForStage: fakeCommand("serial"), measureRound: () => safetyObservation,
      onEvent(event: Record<string, any>) {
        events.push(event);
        if (event.phase === "benchmark-finalist-admission" && event.admitted === true)
          live = { ...live, availableMemoryBytes: 19 * GiB };
      },
    }), /BENCHMARK_FINALIST_ADMISSION_REFUSED/u);
    assert.equal(events.filter(event => event.phase === "completion-child" && event.status === "started"
      && event.label === "finalist").length, 0);
  } finally { await f.cleanup(); }
});

test("worker tuning safety never recommends a faster finalist whose own descendant telemetry is incomplete", { timeout: 15_000 }, async () => {
  const f = await fixture();
  const observedLabels: string[] = [];
  let recoveryLaunches = 0;
  try {
    const result = await (throughput as any).runCompletionBenchmark({
      repositoryRoot: f.directory, ordinaryWorkers: 4, budgetMilliseconds: 10_000,
      resourceSnapshot: () => (throughput as any).readCompletionResources(tuningResourceFixture()),
      sourceIdentity: () => "same-synthetic-cohort",
      commandForStage(role: string, names: readonly string[]) {
        const command = fakeCommand("serial")(role, names);
        const baseline = role !== "producer" && recoveryLaunches++ < 2;
        return { ...command, args: command.args.map((arg, index) => index !== command.args.length - 1 ? arg
          : arg.replace("clearTimeout(guard);", (baseline
            ? "await new Promise(accept => setTimeout(accept, 800));" : "") + "clearTimeout(guard);")) };
      },
      measureRound(label: string) {
        observedLabels.push(label);
        return { ...safetyObservation, complete: label === "baseline" };
      },
    });
    assert.equal(result.rounds.length, 2);
    assert.ok(result.rounds[1].elapsedMilliseconds < result.rounds[0].elapsedMilliseconds * 0.95,
      "counterexample must include a genuinely faster completed finalist");
    assert.equal(result.recommendedRecoveryWorkers, 2,
      "complete baseline telemetry cannot stand in for missing finalist telemetry");
    assert.deepEqual(observedLabels, ["baseline", "finalist"]);
    assert.equal(result.finalistObservation.complete, false);
    assert.equal(result.finalistRecommendationAdmission.admitted, false);
  } finally { await f.cleanup(); }
});
test("worker tuning partitions 1..6 without dropping or duplicating an exact case", () => {
  const partition = (throughput as any).partitionRecoveryCases;
  assert.equal(typeof partition, "function");
  for (let cap = 1; cap <= 6; cap++) {
    const groups = partition(cap) as string[][];
    assert.equal(groups.length, cap);
    assert.ok(groups.every(group => group.length > 0));
    assert.deepEqual(groups.flat().sort(), [...recoveryCases].sort());
  }
  for (const cap of [0, 7, 1.5, NaN]) assert.throws(() => partition(cap), /WORKER/u);
});

test("worker tuning resolves actual cgroup ancestors and distinguishes disabled CPU from unreadable limits", () => {
  const inspect = (throughput as any).readCompletionResources;
  assert.equal(typeof inspect, "function");
  const observed = inspect(tuningResourceFixture());
  assert.equal(observed.complete, true);
  assert.equal(observed.cpuCount, 16);
  assert.ok(observed.availableMemoryBytes > 20 * GiB);
  assert.ok(observed.ancestors.some((entry: any) => entry.cpu === "disabled"));
  const limited = inspect(tuningResourceFixture({
    "/sys/fs/cgroup/user.slice/cpu.max": "200000 100000\n",
    "/sys/fs/cgroup/user.slice/memory.max": String(20 * GiB),
    "/sys/fs/cgroup/user.slice/memory.current": String(16 * GiB),
  }));
  assert.equal(limited.cpuCount, 2);
  assert.equal(limited.availableMemoryBytes, 4 * GiB);
  const unreadable = inspect(tuningResourceFixture({
    "/sys/fs/cgroup/user.slice/memory.max": Object.assign(new Error("denied"), { code: "EACCES" }),
  }));
  assert.equal(unreadable.complete, false);
});

test("worker tuning admits measured three but refuses four and missing tree telemetry at current headroom", () => {
  const inspect = (throughput as any).readCompletionResources;
  const admit = (throughput as any).recoveryAdmission;
  assert.equal(typeof admit, "function");
  const snapshot = inspect(tuningResourceFixture());
  const observation = { complete: true, ordinaryPeakBytes: 2 * GiB, recoveryPeakBytes: GiB };
  assert.equal(admit(snapshot, 3, 4, observation).admitted, true);
  assert.equal(admit(snapshot, 4, 4, observation).admitted, false);
  assert.equal(admit(snapshot, 3, 4, { ...observation, complete: false }).admitted, false);
  assert.equal(admit({ ...snapshot, memoryFullAvg10: 1 }, 3, 4, observation).admitted, false);
});

test("worker tuning benchmark producer selects only the real witness while normal inventory stays unchanged", () => {
  const benchmark = (throughput as any).completionCommands("producer", [], "benchmark");
  const selectors = benchmark.args.filter((arg: string) => arg.startsWith("--test-name-pattern="));
  assert.equal(selectors.length, 1);
  const selected = new RegExp(selectors[0].slice("--test-name-pattern=".length));
  assert.equal(selected.test(producerCase), true);
  for (const name of recoveryCases) assert.equal(selected.test(name), false);
  assert.ok(completionCommands("producer", []).args.some(arg => arg.startsWith("--test-skip-pattern=")));
});

test("worker tuning local help performs no repository discovery, spawn or admission fencing", async () => {
  const f = await fixture();
  try {
    const result = spawnSync(process.execPath, [resolve(root, "scripts/test-full.mjs"), "--help"], {
      cwd: f.directory, encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--benchmark-workers/u);
    assert.match(result.stdout, /--ordinary-workers/u);
    assert.match(result.stdout, /non-certifying/u);
    assert.deepEqual(await readdir(f.directory), []);
  } finally { await f.cleanup(); }
});

test("worker tuning arguments reject ambiguous modes and unbounded values before execution", () => {
  const parse = (throughput as any).parseFullGateOptions;
  assert.equal(typeof parse, "function");
  assert.equal(parse([]).recoveryWorkers, 2);
  assert.equal(parse(["--all", "--ordinary-workers", "3", "--recovery-workers", "6"]).recoveryWorkers, 6);
  for (const args of [
    ["--all", "--benchmark-workers"], ["--ordinary-workers", "9"],
    ["--recovery-workers", "0"], ["--budget-ms", "1"],
    ["--benchmark-workers", "--budget-ms", "5400001"], ["--help", "--all"],
  ]) assert.throws(() => parse(args), /FULL_GATE_ARGUMENTS_INVALID/u);
});

test("worker tuning one benchmark seed feeds at most two complete non-certifying finalists", { timeout: 15_000 }, async () => {
  const f = await fixture();
  const events: Record<string, any>[] = [];
  try {
    const run = (throughput as any).runCompletionBenchmark;
    assert.equal(typeof run, "function");
    const snapshot = (throughput as any).readCompletionResources(tuningResourceFixture());
    const result = await run({
      repositoryRoot: f.directory, ordinaryWorkers: 4, budgetMilliseconds: 10_000,
      commandForStage: fakeCommand("serial"),
      resourceSnapshot: () => snapshot,
      sourceIdentity: () => "same-synthetic-cohort",
      measureRound: () => ({ complete: true, ordinaryPeakBytes: GiB, recoveryPeakBytes: GiB }),
      onEvent: (event: Record<string, any>) => events.push(event),
    });
    assert.equal(result.certification, false);
    assert.equal(result.rounds.length, 2);
    assert.deepEqual(result.rounds.map((round: any) => round.workers), [2, 3]);
    for (const round of result.rounds)
      assert.deepEqual(round.results.flatMap((child: any) => child.passed).sort(), [...recoveryCases].sort());
    assert.equal(events.filter(event => event.event?.kind === "seed-ready").length, 1);
    assert.equal(result.results.filter((child: any) => child.role === "producer").length, 1);
  } finally { await f.cleanup(); }
});

test("worker tuning a skipped or missing genuine benchmark witness cannot release recovery", { timeout: 15_000 }, async () => {
  const f = await fixture();
  const events: Record<string, any>[] = [];
  try {
    const run = (throughput as any).runCompletionBenchmark;
    assert.equal(typeof run, "function");
    await assert.rejects(() => run({
      repositoryRoot: f.directory, ordinaryWorkers: 4, budgetMilliseconds: 10_000,
      commandForStage: fakeCommand("no-seed"),
      resourceSnapshot: () => (throughput as any).readCompletionResources(tuningResourceFixture()),
      sourceIdentity: () => "same-synthetic-cohort",
      onEvent: (event: Record<string, any>) => events.push(event),
    }));
    assert.equal(events.filter(event => event.phase === "completion-child" && event.status === "started").length, 1);
  } finally { await f.cleanup(); }
});
import {
  completionCommands, completionPattern, completionWorkerCount,
  producerCase, recoveryCases, runCompletionCohort,
} from "../../../scripts/completion-throughput.ts";

const root = resolve(import.meta.dirname, "../../..");
const resources = { cpuCount: 4, availableMemoryBytes: 32 * 1024 ** 3 };

async function fixture() {
  await mkdir(resolve(root, ".usf/tmp"), { recursive: true });
  const directory = await mkdtemp(resolve(root, ".usf/tmp/completion-scheduler-test-"));
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function fakeCommand(scenario: string) {
  return (role: string, names: readonly string[]) => ({
    executable: process.execPath,
    args: ["--input-type=module", "--eval", `
      import { existsSync, writeFileSync, copyFileSync, readFileSync, statSync } from "node:fs";
      import { join } from "node:path";
      const dir = process.env.USF_COMPLETION_COHORT_DIRECTORY;
      const role = process.env.USF_COMPLETION_COHORT_ROLE;
      const scenario = ${JSON.stringify(scenario)};
      const names = ${JSON.stringify(role === "producer" ? [producerCase] : names)};
      const cases = ${JSON.stringify(recoveryCases)};
      const send = event => new Promise((resolve, reject) => process.send({
        schema: "urn:usf:test-completion-cohort-event:1", role, ...event,
      }, error => error ? reject(error) : resolve()));
      const guard = setTimeout(() => process.exit(91), 5000);
      await send({ kind: "inventory", cases: scenario === "inventory" ? cases.slice(1) : cases });
      if (role === "producer") {
        writeFileSync(join(dir, "test-seed"), "immutable", { flag: "wx" });
        for (const name of names) await send({ kind: "case-started", name });
        if (scenario !== "no-seed") await send({ kind: "seed-ready", seed: {
          schema: "urn:usf:test-completion-shared-seed:1",
          candidateDigest: "sha256:" + "a".repeat(64), receiptSetDigest: "sha256:" + "b".repeat(64),
          treeDigest: "sha256:" + "c".repeat(64), sourceFingerprint: "d".repeat(64),
        }});
        for (const name of names) await send({ kind: "case-passed", name });
      } else {
        if (!existsSync(join(dir, "test-seed"))) process.exit(92);
        const mine = join(dir, role);
        copyFileSync(join(dir, "test-seed"), mine);
        const source = statSync(join(dir, "test-seed")), copy = statSync(mine);
        if (source.dev === copy.dev && source.ino === copy.ino) process.exit(93);
        writeFileSync(mine, role);
        // A barrier forces two actual child processes to coexist. Serial
        // scheduling fails the bounded guard rather than producing a false
        // overlap measurement from two mocked promises.
        const peer = join(dir, role === "recovery-0" ? "recovery-1" : "recovery-0");
        if (scenario !== "serial") while (!existsSync(peer)) await new Promise(r => setTimeout(r, 10));
        if (readFileSync(join(dir, "test-seed"), "utf8") !== "immutable") process.exit(94);
        for (const name of names) {
          if (scenario === "missing-case" && name === names[0]) continue;
          await send({ kind: "case-started", name });
          await send({ kind: "case-passed", name });
          if (scenario === "duplicate") await send({ kind: "case-passed", name });
        }
        if (scenario === "exit-failure" && role === "recovery-0") process.exitCode = 7;
      }
      clearTimeout(guard);
      process.disconnect();
    `],
  });
}

test("completion commands partition every recovery and lineage case with anchored selectors", () => {
  assert.equal(recoveryCases.length, 6);
  const skip = new RegExp(completionPattern(recoveryCases));
  assert.equal(skip.test(producerCase), false);
  for (const name of recoveryCases) {
    assert.equal(skip.test(name), true);
    assert.equal(skip.test(name + " accidentally added"), false);
  }
  const escaped = new RegExp(completionPattern(["a.b (c) [d]"]));
  assert.equal(escaped.test("a.b (c) [d]"), true);
  assert.equal(escaped.test("axb c d"), false);
  const producer = completionCommands("producer", []);
  assert.ok(producer.args.some((arg: string) => arg.startsWith("--test-skip-pattern=")));
  assert.equal(producer.args.some((arg: string) => arg.startsWith("--test-concurrency=")), false);
});

test("unknown or constrained resources serialize workers without reducing the case denominator", () => {
  assert.equal(completionWorkerCount(resources), 2);
  assert.equal(completionWorkerCount({ ...resources, cpuCount: 1 }), 1);
  assert.equal(completionWorkerCount({ ...resources, availableMemoryBytes: 0 }), 1);
});

test("one producer precedes two overlapping real processes with independent mutable copies", { timeout: 15_000 }, async () => {
  const f = await fixture();
  const events: Record<string, any>[] = [];
  try {
    const result = await runCompletionCohort({ repositoryRoot: f.directory, resources,
      commandForStage: fakeCommand("pass"), onEvent: (event: Record<string, any>) => events.push(event) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.results.length, 3);
    assert.equal(new Set(result.results.map((item: any) => item.pid)).size, 3);
    assert.ok(result.processOverlapMilliseconds > 0);
    assert.equal(result.results[1].startedAt >= result.results[0].completedAt, true);
    assert.equal(result.results[2].startedAt >= result.results[0].completedAt, true);
    assert.deepEqual(result.results.slice(1).flatMap((item: any) => item.passed).sort(), [...recoveryCases].sort());
    assert.equal(events.filter(event => event.event?.kind === "seed-ready").length, 1);
  } finally { await f.cleanup(); }
});

test("resource fallback still executes the complete recovery denominator", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const result = await runCompletionCohort({ repositoryRoot: f.directory,
      resources: { ...resources, cpuCount: 1 }, commandForStage: fakeCommand("serial") });
    assert.equal(result.workers, 1);
    assert.equal(result.processOverlapMilliseconds, 0);
    assert.deepEqual(result.results.slice(1).flatMap((item: any) => item.passed).sort(), [...recoveryCases].sort());
  } finally { await f.cleanup(); }
});

for (const scenario of ["no-seed", "inventory", "missing-case", "duplicate", "exit-failure"]) {
  test(`completion scheduling fails closed on ${scenario} and drains launched workers`, { timeout: 15_000 }, async () => {
    const f = await fixture();
    const events: Record<string, any>[] = [];
    try {
      await assert.rejects(() => runCompletionCohort({ repositoryRoot: f.directory, resources,
        commandForStage: fakeCommand(scenario), onEvent: (event: Record<string, any>) => events.push(event) }));
      const started = events.filter(event => event.phase === "completion-child" && event.status === "started");
      const ended = events.filter(event => event.phase === "completion-child" && event.status !== "started");
      assert.equal(ended.length, started.length, "all child handles must close before rejection and lock release");
      if (["no-seed", "inventory"].includes(scenario)) assert.equal(started.length, 1);
    } finally { await f.cleanup(); }
  });
}

test("a missing worker executable refuses without launching recovery", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => runCompletionCohort({ repositoryRoot: f.directory, resources,
      commandForStage: () => ({ executable: resolve(f.directory, "missing"), args: [] }) }),
      /COMPLETION_PRODUCER_FAILED/u);
  } finally { await f.cleanup(); }
});
