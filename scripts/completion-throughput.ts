import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createGateChildOwner, type GateChildOwner } from "./full-gate-children.ts";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { posix, resolve, relative } from "node:path";

export const completionTest = "tests/integration/work-completion.test.ts";
export const producerCase = "root-derived completion checks derive no-effect identity and reconcile a genuine retained set";
export const recoveryCases = Object.freeze([
  "before-source", "source-before-receipt", "receipt-pending-before-link",
  "receipt-linked-before-cleanup", "receipt-before-ack",
].map(boundary => `canonical completion publication resumes the exact retained intent at ${boundary}`).concat(
  "canonical terminal evaluation refuses altered evaluator and artifact lineage",
));
interface CompletionResources { cpuCount: number; availableMemoryBytes: number }
interface CompletionCommand { executable: string; args: readonly string[] }
export interface StageResult {
  role: string; pid?: number; exitCode: number; failure: string | null; passed: string[];
  startedAt: number; completedAt: number; elapsedMilliseconds?: number;
}
export interface CompletionCohortOptions {
  repositoryRoot: string;
  onOutput?: (channel: "stdout" | "stderr", bytes: Buffer) => void;
  onEvent?: (event: Record<string, unknown>) => void;
  resources?: CompletionResources;
  commandForStage?: (role: string, names: readonly string[]) => CompletionCommand;
  lockDescriptor?: number;
  childOwner?: GateChildOwner;
  telemetry?: GateTelemetry;
  /** With an external owner, invoke queued cleanup only AFTER owner.close() positively acknowledges drain. */
  deferCleanup?: (cleanup: () => Promise<void>) => void;
  recoveryWorkers?: number;
  ordinaryWorkers?: number;
  admissionObservation?: WorkerObservation;
  expectedSeedFingerprint?: string;
  expectedSourceIdentity?: string;
  resourceSnapshot?: () => ResourceSnapshot;
  sourceIdentity?: () => string;
}
const eventSchema = "urn:usf:test-completion-cohort-event:1";
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const GiB = 1024 ** 3;

export interface WorkerObservation {
  complete: boolean; ordinaryPeakBytes: number; recoveryPeakBytes: number; ordinaryWorkers?: number;
}
export interface ResourceSnapshot extends CompletionResources {
  complete: boolean; observedAt: number; hostAvailableMemoryBytes: number; pidHeadroom: number | null;
  memorySomeAvg10: number; memoryFullAvg10: number; cpuSomeAvg10: number; ioSomeAvg10: number;
  swapUsedBytes: number; swapInPages: number; swapOutPages: number; oomKills: number;
  ancestors: { path: string; cpu: string; memory: string; pids: string }[]; limitations: string[];
}
interface ResourceReader { readText?: (path: string) => string; cpuCount?: number }

function failure(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }
function workerInteger(value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw failure("COMPLETION_WORKER_COUNT_INVALID");
  return value;
}

export function partitionRecoveryCases(workers: number): readonly (readonly string[])[] {
  workerInteger(workers, recoveryCases.length);
  const groups = Array.from({ length: workers }, (_, group) => recoveryCases.filter((_, index) => index % workers === group));
  assert.ok(groups.every(group => group.length > 0) && exactNames(groups.flat(), recoveryCases), "COMPLETION_PARTITION_INVALID");
  return groups;
}

function exactNames(actual: unknown, expected: readonly string[]) {
  return Array.isArray(actual) && actual.length === expected.length
    && new Set(actual).size === actual.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

export function completionPattern(names: readonly string[]) {
  assert.ok(names.length > 0 && new Set(names).size === names.length);
  return `^(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})$`;
}

export function completionWorkerCount(resources: CompletionResources) {
  // Budget two 2 GiB process trees plus 8 GiB for other host workloads.
  // Unknown resource availability reduces concurrency; it never drops cases.
  return resources.cpuCount >= 2 && resources.availableMemoryBytes >= 12 * 1024 ** 3 ? 2 : 1;
}


export function completionCommands(role: string, names: readonly string[], purpose: "certification" | "benchmark" = "certification") {
  const selector = role === "producer"
    ? purpose === "benchmark" ? "--test-name-pattern=" + completionPattern([producerCase])
      : "--test-skip-pattern=" + completionPattern(recoveryCases)
    : "--test-name-pattern=" + completionPattern(names);
  return { executable: process.execPath, args: ["--test", "--test-isolation=none", selector, completionTest] };
}

export function parseFullGateOptions(args: readonly string[]) {
  let mode = "--all", explicitMode = false, ordinaryWorkers = 4, recoveryWorkers = 2;
  let budgetMilliseconds = 3_600_000, benchmarkReport: string | undefined;
  const seen = new Set<string>();
  const bad = (): never => { throw failure("FULL_GATE_ARGUMENTS_INVALID"); };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (seen.has(arg)) bad();
    seen.add(arg);
    if (["--all", "--plan", "--fixtures-only", "--benchmark-workers", "--help"].includes(arg)) {
      if (explicitMode) bad();
      mode = arg; explicitMode = true;
    } else if (["--ordinary-workers", "--recovery-workers", "--budget-ms", "--benchmark-report"].includes(arg)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) bad();
      if (arg === "--benchmark-report") { benchmarkReport = value; continue; }
      if (!/^[1-9][0-9]*$/u.test(value)) bad();
      const number = Number(value);
      if (!Number.isSafeInteger(number)) bad();
      if (arg === "--ordinary-workers") { if (number > 8) bad(); ordinaryWorkers = number; }
      if (arg === "--recovery-workers") { if (number > 6) bad(); recoveryWorkers = number; }
      if (arg === "--budget-ms") { if (number < 1000 || number > 5_400_000) bad(); budgetMilliseconds = number; }
    } else bad();
  }
  if (mode === "--help" && args.length !== 1) bad();
  if (seen.has("--budget-ms") && mode !== "--benchmark-workers") bad();
  if (mode === "--benchmark-workers" && (seen.has("--recovery-workers") || benchmarkReport !== undefined)) bad();
  if (mode === "--fixtures-only" && (seen.has("--ordinary-workers") || seen.has("--recovery-workers") || benchmarkReport !== undefined)) bad();
  return { mode, ordinaryWorkers, recoveryWorkers, budgetMilliseconds, benchmarkReport };
}
export function fullGateHelp(): string {
  return [
    "Usage: node scripts/test-full.mjs [--all|--plan|--fixtures-only|--benchmark-workers|--help]",
    "  --ordinary-workers N  Ordinary file cap 1..8 (default 4).",
    "  --recovery-workers N  Certification recovery cap 1..6 (default request 2; constrained resources select 1).",
    "  --benchmark-report PATH  Current measured recommendation required for certification caps above 4/2.",
    "  --benchmark-workers   non-certifying: one genuine witness-only producer, baseline 2 then conditional 3.",
    "  --budget-ms N         Benchmark only: 1000..5400000 ms, default 3600000. Individual test timeouts are unchanged.",
    "  --help                Local text only: no subprocess, repository discovery, file creation or admission fence.",
    "Both benchmark rounds use the complete ordinary inventory at four workers and all six recovery cases; recovery uses baseline two, then conditional three.",
    "Upward tuning needs complete cgroup/host and sampled descendant telemetry, current source and resource headroom.",
    "Memory admission: 8 GiB reserve + max(4 GiB,1.5x ordinary peak) + N*max(2 GiB,1.5x recovery peak) + 2 GiB burst.",
    "Existing lock/guardian/drain-ACK ownership is unchanged. An unknown drain retains the admission fence.",
    "Reports: .usf/logs/full-gate/ for certification; .usf/logs/full-gate-benchmarks/ for observations.",
    "A benchmark grants no authority, certifies no subset, replaces no confined validation and proves no global optimum.",
    "",
  ].join("\n");
}
/** Read the actual v2 membership and all visible ancestors, not guessed root limits. */
export function readCompletionResources({ readText = path => readFileSync(path, "utf8"), cpuCount = availableParallelism() }: ResourceReader = {}): ResourceSnapshot {
  const limitations: string[] = [];
  const result: ResourceSnapshot = {
    complete: true, observedAt: Date.now(), cpuCount, availableMemoryBytes: 0, hostAvailableMemoryBytes: 0,
    pidHeadroom: null, memorySomeAvg10: 0, memoryFullAvg10: 0, cpuSomeAvg10: 0, ioSomeAvg10: 0,
    swapUsedBytes: 0, swapInPages: 0, swapOutPages: 0, oomKills: 0, ancestors: [], limitations,
  };
  const issue = (path: string) => { limitations.push(path); result.complete = false; };
  const read = (path: string): string | undefined => {
    try { return readText(path).trim(); } catch { issue(path); return undefined; }
  };
  const number = (value: string | undefined, label: string): number | undefined => {
    if (value === undefined) return undefined;
    if (!/^[0-9]+$/u.test(value) || !Number.isSafeInteger(Number(value))) { issue(label); return undefined; }
    return Number(value);
  };
  const pressure = (path: string, kind: string): number => {
    const text = read(path), match = text?.split("\n").find(line => line.startsWith(kind + " "))?.match(/\bavg10=([0-9]+(?:\.[0-9]+)?)\b/u);
    if (!match) { issue(path + ":" + kind); return 0; }
    return Number(match[1]);
  };
  const mem = read("/proc/meminfo");
  const memoryValue = (key: string) => {
    const match = mem?.match(new RegExp("^" + key + ":\\s+([0-9]+) kB$", "mu"));
    if (!match) { issue("/proc/meminfo:" + key); return 0; }
    return Number(match[1]) * 1024;
  };
  result.availableMemoryBytes = result.hostAvailableMemoryBytes = memoryValue("MemAvailable");
  result.swapUsedBytes = Math.max(0, memoryValue("SwapTotal") - memoryValue("SwapFree"));
  result.memorySomeAvg10 = pressure("/proc/pressure/memory", "some");
  result.memoryFullAvg10 = pressure("/proc/pressure/memory", "full");
  result.cpuSomeAvg10 = pressure("/proc/pressure/cpu", "some");
  result.ioSomeAvg10 = pressure("/proc/pressure/io", "some");
  const vm = read("/proc/vmstat");
  for (const [key, field] of [["pswpin", "swapInPages"], ["pswpout", "swapOutPages"]] as const) {
    const value = vm?.match(new RegExp("^" + key + " ([0-9]+)$", "mu"))?.[1];
    if (value === undefined) issue("/proc/vmstat:" + key);
    result[field] = number(value, key) ?? 0;
  }
  const membershipLines = read("/proc/self/cgroup")?.split("\n").filter(line => line.startsWith("0::"));
  const membership = membershipLines?.length === 1 ? membershipLines[0]!.slice(3) : undefined;
  const unescape = (value: string) => value.replace(/\\(040|011|012|134)/gu, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
  const mounts = (read("/proc/self/mountinfo")?.split("\n") ?? []).flatMap(line => {
    const parts = line.split(" - "), left = parts[0]?.split(" "), right = parts[1]?.split(" ");
    if (right?.[0] !== "cgroup2" || !left?.[3] || !left[4]) return [];
    return [{ root: unescape(left[3]), mount: unescape(left[4]) }];
  }).filter(entry => membership !== undefined && (entry.root === "/" || membership === entry.root || membership.startsWith(entry.root + "/")))
    .sort((a, b) => b.root.length - a.root.length);
  const mount = mounts[0];
  if (membership === undefined || !membership.startsWith("/") || membership.split("/").some(part => part === "." || part === "..") || !mount) {
    issue("CGROUP_MEMBERSHIP_UNRESOLVED"); return result;
  }
  if (mount.root !== "/") issue("CGROUP_ANCESTORS_NOT_VISIBLE");
  const leaf = posix.join(mount.mount, membership.slice(mount.root === "/" ? 1 : mount.root.length));
  let current = leaf, depth = 0;
  while (true) {
    if (++depth > 64 || !(current === mount.mount || current.startsWith(mount.mount + "/"))) { issue("CGROUP_ANCESTOR_BOUND"); break; }
    const root = current === mount.mount, controllersText = read(current + "/cgroup.controllers");
    const controllers = new Set(controllersText?.split(/\s+/u) ?? []);
    const limit = (name: string, controller: string): { value?: string; state: string } => {
      const path = current + "/" + name;
      try { return { value: readText(path).trim(), state: "observed" }; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { issue(path); return { state: "unreadable" }; }
        if (root) return { state: "root-not-applicable" };
        const parentControls = read(posix.dirname(current) + "/cgroup.subtree_control");
        if (controllersText !== undefined && parentControls !== undefined && !controllers.has(controller)
          && !parentControls.split(/\s+/u).map(word => word.replace(/^\+/u, "")).includes(controller)) return { state: "disabled" };
        issue(path); return { state: "missing-enabled-controller" };
      }
    };
    const cpu = limit("cpu.max", "cpu");
    if (cpu.value !== undefined) {
      const match = cpu.value.match(/^(max|[0-9]+) ([0-9]+)$/u);
      if (!match || Number(match[2]) <= 0) issue(current + "/cpu.max");
      else if (match[1] !== "max") result.cpuCount = Math.min(result.cpuCount, Number(match[1]) / Number(match[2]));
    }
    const maximum = limit("memory.max", "memory"), high = limit("memory.high", "memory");
    if (maximum.value !== undefined || high.value !== undefined) {
      const used = number(read(current + "/memory.current"), current + "/memory.current");
      for (const boundary of [maximum, high]) if (boundary.value !== undefined && boundary.value !== "max") {
        const bytes = number(boundary.value, current + "/memory.limit");
        if (bytes !== undefined && used !== undefined) result.availableMemoryBytes = Math.min(result.availableMemoryBytes, Math.max(0, bytes - used));
      }
      const kills = read(current + "/memory.events")?.match(/^oom_kill ([0-9]+)$/mu)?.[1];
      if (kills === undefined) issue(current + "/memory.events:oom_kill");
      else result.oomKills += Number(kills); // Indicator only; ancestor counters can overlap.
    }
    const pids = limit("pids.max", "pids");
    if (pids.value !== undefined && pids.value !== "max") {
      const cap = number(pids.value, current + "/pids.max"), used = number(read(current + "/pids.current"), current + "/pids.current");
      if (cap !== undefined && used !== undefined) result.pidHeadroom = Math.min(result.pidHeadroom ?? Infinity, Math.max(0, cap - used));
    }
    result.ancestors.push({ path: current, cpu: cpu.state, memory: maximum.state, pids: pids.state });
    if (root) break;
    current = posix.dirname(current);
  }
  if (!Number.isFinite(result.cpuCount) || result.cpuCount <= 0) issue("CPU_CAPACITY_INVALID");
  return result;
}
export function recoveryAdmission(snapshot: ResourceSnapshot, workers: number, ordinaryWorkers: number, observation?: WorkerObservation) {
  workerInteger(workers, 6); workerInteger(ordinaryWorkers, 8);
  const reasons: string[] = [];
  if (!snapshot.complete) reasons.push("RESOURCE_TELEMETRY_INCOMPLETE");
  if (workers > 2 && (!observation?.complete || !Number.isFinite(observation.ordinaryPeakBytes)
    || !Number.isFinite(observation.recoveryPeakBytes) || observation.ordinaryPeakBytes <= 0 || observation.recoveryPeakBytes <= 0))
    reasons.push("DESCENDANT_TELEMETRY_INCOMPLETE");
  const scale = Math.max(1, ordinaryWorkers / (observation?.ordinaryWorkers ?? ordinaryWorkers));
  const ordinaryAllowanceBytes = Math.max(4 * GiB, 1.5 * (observation?.ordinaryPeakBytes ?? 0) * scale);
  const recoveryAllowanceBytes = Math.max(2 * GiB, 1.5 * (observation?.recoveryPeakBytes ?? 0));
  const requiredAvailableBytes = 10 * GiB + ordinaryAllowanceBytes + workers * recoveryAllowanceBytes;
  if (snapshot.availableMemoryBytes < requiredAvailableBytes) reasons.push("MEMORY_HEADROOM_INSUFFICIENT");
  if (snapshot.cpuCount < workers + ordinaryWorkers) reasons.push("CPU_HEADROOM_INSUFFICIENT");
  if (snapshot.pidHeadroom !== null && snapshot.pidHeadroom < 64 * (workers + ordinaryWorkers + 1)) reasons.push("PID_HEADROOM_INSUFFICIENT");
  if (snapshot.memoryFullAvg10 > 0 || snapshot.memorySomeAvg10 >= 1) reasons.push("MEMORY_PRESSURE");
  return { admitted: reasons.length === 0, workers, ordinaryWorkers, requiredAvailableBytes,
    ordinaryAllowanceBytes, recoveryAllowanceBytes, snapshot, reasons };
}

interface ProcessIdentity { pid: number; start: string; parent: number; state: string }
function processIdentity(pid: number): ProcessIdentity {
  const text = readFileSync("/proc/" + pid + "/stat", "utf8");
  const fields = text.slice(text.lastIndexOf(") ") + 2).trim().split(/\s+/u);
  if (!/^[0-9]+$/u.test(fields[19] ?? "") || !/^[0-9]+$/u.test(fields[1] ?? ""))
    throw failure("PROCESS_IDENTITY_INVALID");
  return { pid, start: fields[19]!, parent: Number(fields[1]), state: fields[0]! };
}
interface TreeSample { bytes: number; processes: number; complete: boolean; departures: number; errors: number; cpuTicks: number }
/** Observational identities only. Neither this sampler nor its caller signals numeric PIDs. */
function sampleTree(root: ProcessIdentity, deadline: number): TreeSample {
  const result: TreeSample = { bytes: 0, processes: 0, complete: true, departures: 0, errors: 0, cpuTicks: 0 };
  const seen = new Set<number>();
  const queue: { identity: ProcessIdentity; parent?: ProcessIdentity }[] = [{ identity: root }];
  for (let index = 0; index < queue.length; index++) {
    if (seen.size >= 2048 || performance.now() > deadline) { result.complete = false; result.errors++; break; }
    const { identity, parent } = queue[index]!;
    if (seen.has(identity.pid)) continue;
    seen.add(identity.pid);
    try {
      const before = processIdentity(identity.pid);
      if (before.start !== identity.start || (parent && before.parent !== parent.pid)) {
        result.complete = false; result.errors++; continue;
      }
      if (["Z", "X"].includes(before.state)) { result.departures++; continue; }
      const status = readFileSync("/proc/" + identity.pid + "/status", "utf8");
      const rss = status.match(/^VmRSS:\s+([0-9]+) kB$/mu);
      const stat = readFileSync("/proc/" + identity.pid + "/stat", "utf8");
      const fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/u);
      const after = processIdentity(identity.pid);
      if (!rss || after.start !== before.start || after.parent !== before.parent
        || (parent && processIdentity(parent.pid).start !== parent.start)) {
        result.complete = false; result.errors++; continue;
      }
      result.bytes += Number(rss[1]) * 1024;
      result.cpuTicks += Number(fields[11] ?? 0) + Number(fields[12] ?? 0);
      result.processes++;
      const tasks = readdirSync("/proc/" + identity.pid + "/task");
      if (tasks.length > 512) { result.complete = false; result.errors++; continue; }
      for (const task of tasks) {
        const children = readFileSync("/proc/" + identity.pid + "/task/" + task + "/children", "utf8").trim();
        for (const value of children.split(/\s+/u).filter(Boolean)) {
          const child = processIdentity(Number(value));
          if (child.parent === identity.pid) queue.push({ identity: child, parent: before });
          else { result.complete = false; result.errors++; }
        }
      }
    } catch (error) {
      result.complete = false;
      if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) result.departures++;
      else result.errors++;
    }
  }
  return result;
}
interface TreeRecord {
  label: string; pid: number; identity?: ProcessIdentity; closed: boolean; peakBytes: number;
  completeSamples: number; departures: number; errors: number; peakProcesses: number; lastObservedCpuTicks: number;
}
export interface GateTelemetry {
  track(child: ChildProcess, label: string): void;
  observation(prefix: string, ordinaryWorkers: number): WorkerObservation;
  report(): Record<string, unknown>;
  stop(): void;
}
export function createGateTelemetry(options: {
  resourceSnapshot?: () => ResourceSnapshot; intervalMilliseconds?: number;
} = {}): GateTelemetry {
  const intervalMilliseconds = options.intervalMilliseconds ?? 500;
  if (!Number.isInteger(intervalMilliseconds) || intervalMilliseconds < 100 || intervalMilliseconds > 5000)
    throw failure("TELEMETRY_INTERVAL_INVALID");
  const records: TreeRecord[] = [];
  let aggregatePeakBytes = 0, aggregatePeakProcesses = 0, sampleCount = 0;
  let latestResource: ResourceSnapshot | undefined, resourceFailures = 0;
  const sample = () => {
    let bytes = 0, count = 0;
    const deadline = performance.now() + 75;
    for (const record of records) if (!record.closed && record.identity) {
      const result = sampleTree(record.identity, deadline);
      record.peakBytes = Math.max(record.peakBytes, result.bytes);
      record.peakProcesses = Math.max(record.peakProcesses, result.processes);
      record.completeSamples += result.complete ? 1 : 0;
      record.departures += result.departures; record.errors += result.errors;
      record.lastObservedCpuTicks = result.cpuTicks;
      bytes += result.bytes; count += result.processes;
    }
    aggregatePeakBytes = Math.max(aggregatePeakBytes, bytes);
    aggregatePeakProcesses = Math.max(aggregatePeakProcesses, count);
    sampleCount++;
    try {
      latestResource = (options.resourceSnapshot ?? readCompletionResources)();
      if (!latestResource.complete) resourceFailures++;
    } catch { resourceFailures++; }
  };
  const interval = setInterval(sample, intervalMilliseconds);
  interval.unref();
  return {
    track(child, label) {
      const record: TreeRecord = { label, pid: child.pid ?? -1, closed: false, peakBytes: 0,
        completeSamples: 0, departures: 0, errors: 0, peakProcesses: 0, lastObservedCpuTicks: 0 };
      try {
        record.identity = processIdentity(record.pid);
        if (record.identity.parent !== process.pid) { record.identity = undefined; record.errors++; }
      } catch { record.errors++; }
      records.push(record);
      child.once("close", () => { record.closed = true; });
    },
    observation(prefix, ordinaryWorkers) {
      const selected = records.filter(record => record.label.startsWith(prefix + "/"));
      const ordinary = selected.filter(record => record.label.endsWith("/ordinary"));
      const recovery = selected.filter(record => /\/recovery-[0-5]$/u.test(record.label));
      return {
        complete: ordinary.length === 1 && recovery.length > 0
          && selected.every(record => record.completeSamples >= 2 && record.errors === 0)
          && resourceFailures === 0 && latestResource?.complete === true,
        ordinaryPeakBytes: Math.max(0, ...ordinary.map(record => record.peakBytes)),
        recoveryPeakBytes: Math.max(0, ...recovery.map(record => record.peakBytes)),
        ordinaryWorkers,
      };
    },
    report() {
      return { kind: "sampled-descendant-resources", sampleCount, aggregatePeakBytes, aggregatePeakProcesses,
        resourceFailures, latestResource, trees: records.map(({ identity: _identity, ...record }) => ({ ...record })),
        limitations: [
          "sampled RSS sum, not an exact lifetime or unique-page peak",
          "short-lived descendants between samples can be missed; departures are recorded",
          "PID identity and ancestry are observations only, never signalling authority",
          "cgroup counters include other members; swap occupancy alone is not active paging",
          "tree peaks are not simultaneous; aggregate peak is a bounded traversal, not an atomic snapshot",
          "CPU ticks are last-observed live-tree counters, not cumulative exited-descendant CPU",
        ] };
    },
    stop() { clearInterval(interval); },
  };
}
/** Runner/ordinary-source binding supplements, rather than replaces, the native seed fingerprint. */
export function completionSourceIdentity(repositoryRoot: string, additionalPaths: readonly string[] = []): string {
  const paths = [...new Set([
    "scripts/test-full.mjs", "scripts/completion-throughput.ts", "scripts/full-gate-lock.ts",
    "scripts/full-gate-children.ts", "scripts/full-gate-process-tree.py",
    completionTest, "tests/unit/commands/completion-throughput.test.ts", ...additionalPaths,
  ])].sort();
  const hash = createHash("sha256");
  hash.update(process.version + "\0");
  for (const path of paths) {
    if (path.startsWith("/") || path.split("/").includes("..")) throw failure("BENCHMARK_SOURCE_PATH_INVALID");
    const absolute = resolve(repositoryRoot, path), metadata = lstatSync(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw failure("BENCHMARK_SOURCE_TYPE_INVALID");
    hash.update(path + "\0" + (metadata.mode & 0o777) + "\0");
    hash.update(readFileSync(absolute)); hash.update("\0");
  }
  return "sha256:" + hash.digest("hex");
}
export interface OrdinaryRoundResult { exitCode: number; elapsedMilliseconds?: number; [key: string]: unknown }
export interface CompletionBenchmarkOptions extends CompletionCohortOptions {
  budgetMilliseconds?: number;
  runOrdinaryRound?: (workers: number, label: string) => Promise<OrdinaryRoundResult>;
  /** Synthetic orchestration-test seam; the CLI must never supply this. */
  measureRound?: (label: string) => WorkerObservation;
}
export interface RecoveryRound {
  workers: number; ordinaryWorkers: number; results: StageResult[]; ordinary?: OrdinaryRoundResult;
  elapsedMilliseconds: number; processOverlapMilliseconds: number;
}
export interface CompletionBenchmarkResult {
  certification: false; producerSelection: "genuine-witness-only"; seed: Record<string, unknown>;
  sourceIdentity: string; results: StageResult[]; rounds: RecoveryRound[]; observation: WorkerObservation;
  finalistAdmission: ReturnType<typeof recoveryAdmission>; ordinaryInventoryIncluded: boolean;
  finalistObservation: WorkerObservation | null;
  finalistRecommendationAdmission: ReturnType<typeof recoveryAdmission> | null;
  recommendedRecoveryWorkers: number; recommendedOrdinaryWorkers: number; elapsedMilliseconds: number;
  telemetry: Record<string, unknown>; nonClaims: string[];
}
async function completionSession(options: CompletionCohortOptions, purpose: "certification" | "benchmark") {
  const { repositoryRoot, onOutput = () => {}, onEvent = () => {} } = options;
  const sourceIdentity = options.sourceIdentity ?? (purpose === "benchmark" || options.expectedSourceIdentity !== undefined
    ? () => completionSourceIdentity(repositoryRoot) : undefined);
  const initialSource = sourceIdentity?.();
  if (options.expectedSourceIdentity !== undefined && initialSource !== options.expectedSourceIdentity)
    throw failure("BENCHMARK_SOURCE_CHANGED");
  const temporaryRoot = resolve(repositoryRoot, ".usf/tmp");
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const runDirectory = await mkdtemp(resolve(temporaryRoot, "completion-cohort-"));
  const owner = options.childOwner ?? createGateChildOwner();
  const telemetry = options.telemetry ?? createGateTelemetry({ resourceSnapshot: options.resourceSnapshot });
  const allResults: StageResult[] = [];
  let seed: Record<string, unknown> | undefined;
  const current = () => {
    if (sourceIdentity && sourceIdentity() !== initialSource) throw failure("BENCHMARK_SOURCE_CHANGED");
  };
  async function stage(role: string, names: readonly string[], label: string): Promise<StageResult> {
    const command = options.commandForStage?.(role, names) ?? completionCommands(role, names, purpose);
    const start = performance.now(), startedAt = Date.now(), expected = role === "producer" ? [producerCase] : names;
    const active = new Set<string>(), passed = new Set<string>();
    let inventoryCount = 0, seedCount = 0, problem: string | null = null;
    const refuse = (reason: string) => { problem ??= reason; owner.abort(reason); };
    let child: ChildProcess;
    try {
      child = owner.spawn(command.executable, command.args, {
        cwd: repositoryRoot,
        env: { ...process.env, USF_COMPLETION_COHORT_DIRECTORY: runDirectory, USF_COMPLETION_COHORT_ROLE: role },
        stdio: ["ignore", "pipe", "pipe", "ipc", ...(options.lockDescriptor === undefined ? [] : [options.lockDescriptor])],
      });
    } catch (error) {
      const result: StageResult = { role, exitCode: 1, failure: String(error), passed: [], startedAt, completedAt: Date.now() };
      allResults.push(result); return result;
    }
    telemetry.track(child, label + "/" + role);
    onEvent({ phase: "completion-child", status: "started", role, label, pid: child.pid, startedAt, expectedCases: expected });
    child.stdout!.on("data", bytes => onOutput("stdout", bytes));
    child.stderr!.on("data", bytes => onOutput("stderr", bytes));
    child.on("message", (message: any) => {
      if (!message || message.schema !== eventSchema || message.role !== role) { refuse("COMPLETION_WORKER_EVENT_INVALID"); return; }
      if (message.kind === "inventory") {
        if (++inventoryCount !== 1 || !exactNames(message.cases, recoveryCases)) refuse("COMPLETION_INVENTORY_MISMATCH");
      } else if (message.kind === "case-started") {
        if (!expected.includes(message.name) || active.has(message.name) || passed.has(message.name)) refuse("COMPLETION_CASE_DUPLICATE_OR_UNEXPECTED");
        active.add(message.name);
      } else if (message.kind === "case-passed") {
        if (!expected.includes(message.name) || !active.delete(message.name) || passed.has(message.name)) refuse("COMPLETION_CASE_DUPLICATE_OR_UNEXPECTED");
        passed.add(message.name);
      } else if (message.kind === "seed-ready") {
        if (role !== "producer" || ++seedCount !== 1 || !message.seed
          || message.seed.schema !== "urn:usf:test-completion-shared-seed:1"
          || !digestPattern.test(message.seed.candidateDigest) || !digestPattern.test(message.seed.receiptSetDigest)
          || !digestPattern.test(message.seed.treeDigest) || !/^[0-9a-f]{64}$/u.test(message.seed.sourceFingerprint))
          refuse("COMPLETION_SHARED_SEED_INVALID");
        else seed = message.seed;
      } else if (!["resources", "phase"].includes(message.kind)) refuse("COMPLETION_WORKER_EVENT_INVALID");
      onEvent({ phase: "completion-worker-event", role, label, pid: child.pid, observedAt: Date.now(), event: message });
    });
    const exitCode = await new Promise<number>(accept => {
      child.once("error", (error: NodeJS.ErrnoException) => refuse("COMPLETION_WORKER_LAUNCH_FAILED:" + (error.code ?? error.name)));
      child.once("close", (code, signal) => {
        if (signal !== null) refuse("COMPLETION_WORKER_SIGNAL:" + signal);
        accept(code ?? 1);
      });
    });
    if (inventoryCount !== 1 || !exactNames([...passed], expected) || active.size !== 0) refuse("COMPLETION_CASE_COVERAGE_INCOMPLETE");
    if (role === "producer" && seedCount !== 1) refuse("COMPLETION_SHARED_SEED_MISSING");
    const result: StageResult = { role, pid: child.pid, exitCode, failure: problem, passed: [...passed],
      startedAt, completedAt: Date.now(), elapsedMilliseconds: Math.round(performance.now() - start) };
    allResults.push(result);
    onEvent({ phase: "completion-child", status: exitCode === 0 && problem === null ? "passed" : "failed", label, ...result });
    return result;
  }
  return {
    owner, telemetry, allResults, initialSource,
    get seed() { return seed; },
    async prepare() {
      current();
      const result = await stage("producer", [], "producer");
      if (result.exitCode !== 0 || result.failure !== null) throw failure("COMPLETION_PRODUCER_FAILED");
      current();
      if (options.expectedSeedFingerprint !== undefined && seed?.sourceFingerprint !== options.expectedSeedFingerprint)
        throw failure("BENCHMARK_SEED_CURRENTNESS_MISMATCH");
    },
    async round(requestedWorkers: number, ordinaryWorkers: number, label: string,
      runOrdinary?: (workers: number, label: string) => Promise<OrdinaryRoundResult>,
      admitWorkers?: () => number): Promise<RecoveryRound> {
      current();
      // Admission follows potentially expensive source authentication and is
      // immediately adjacent to partitioning/spawn, not a pre-producer promise.
      const workers = admitWorkers ? admitWorkers() : requestedWorkers;
      const groups = partitionRecoveryCases(workers), started = performance.now();
      const jobs: Promise<unknown>[] = groups.map((group, index) => stage("recovery-" + index, group, label));
      if (runOrdinary) jobs.push(Promise.resolve().then(() => runOrdinary(ordinaryWorkers, label + "/ordinary")).catch(error => {
        owner.abort("BENCHMARK_ORDINARY_FAILED"); throw error;
      }));
      const settled = await Promise.allSettled(jobs);
      const results: StageResult[] = settled.slice(0, groups.length).map(result => result.status === "fulfilled" ? result.value as StageResult
        : { role: "recovery", exitCode: 1, failure: String(result.reason), passed: [], startedAt: 0, completedAt: 0 });
      const ordinaryResult = settled[groups.length];
      const ordinary = ordinaryResult?.status === "fulfilled" ? ordinaryResult.value as OrdinaryRoundResult : undefined;
      if (settled.some(result => result.status === "rejected") || (runOrdinary && (!ordinary || ordinary.exitCode !== 0))
        || results.some(result => result.exitCode !== 0 || result.failure !== null)
        || !exactNames(results.flatMap(result => result.passed), recoveryCases)) throw failure("COMPLETION_RECOVERY_FAILED");
      current();
      const overlap = results.length < 2 ? 0 : Math.max(0,
        Math.min(...results.map(result => result.completedAt)) - Math.max(...results.map(result => result.startedAt)));
      const result: RecoveryRound = { workers, ordinaryWorkers, results, ordinary,
        elapsedMilliseconds: Math.round(performance.now() - started), processOverlapMilliseconds: overlap };
      onEvent({ phase: "completion-round", status: "passed", label, ...result });
      return result;
    },
    async finish(success: boolean) {
      if (!success) owner.abort("COMPLETION_SESSION_FAILED");
      try {
        if (options.childOwner === undefined) await owner.close();
        if (success) {
          const cleanup = () => rm(runDirectory, { recursive: true, force: true });
          if (options.childOwner === undefined) await cleanup();
          else if (options.deferCleanup) options.deferCleanup(cleanup);
          else onEvent({ phase: "completion-seed-retained", reason: "external-owner-drain-required",
            retainedDirectory: relative(repositoryRoot, runDirectory) });
        } else onEvent({ phase: "completion-seed-retained", reason: "failed-session",
          retainedDirectory: relative(repositoryRoot, runDirectory) });
      } finally { if (options.telemetry === undefined) telemetry.stop(); }
    },
  };
}

/** Normal certification retains the complete producer inventory and all six real recovery cases. */
export async function runCompletionCohort(options: CompletionCohortOptions) {
  const requested = workerInteger(options.recoveryWorkers ?? 2, 6);
  const admit = (when: string): number => {
    if (requested > 2) {
      const admission = recoveryAdmission((options.resourceSnapshot ?? readCompletionResources)(),
        requested, options.ordinaryWorkers ?? 4, options.admissionObservation);
      const admitted = admission.admitted && options.expectedSeedFingerprint !== undefined
        && options.expectedSourceIdentity !== undefined;
      options.onEvent?.({ phase: "completion-round-admission", when, ...admission,
        admitted, requestedWorkers: requested, admittedWorkers: admitted ? requested : 0 });
      if (!admitted) throw failure("COMPLETION_WORKER_ADMISSION_REFUSED");
      return requested;
    }
    const resources = options.resources ?? (options.resourceSnapshot ?? readCompletionResources)();
    const constrained = "complete" in resources && resources.complete !== true
      ? { ...resources, availableMemoryBytes: 0 } : resources;
    const admittedWorkers = Math.min(requested, completionWorkerCount(constrained));
    options.onEvent?.({ phase: "completion-round-admission", when, requestedWorkers: requested,
      admittedWorkers, resources, reason: admittedWorkers < requested ? "RESOURCE_SERIAL_FALLBACK" : null });
    return admittedWorkers;
  };
  const plannedWorkers = admit("before-producer");
  const session = await completionSession(options, "certification"), started = performance.now();
  let success = false;
  try {
    options.onEvent?.({ phase: "completion-cohort", status: "started", requestedWorkers: requested, plannedWorkers, recoveryCases });
    await session.prepare();
    const round = await session.round(plannedWorkers, options.ordinaryWorkers ?? 4, "certification", undefined,
      () => admit("after-producer-before-recovery"));
    success = true;
    const result = { label: "completion", exitCode: 0, requestedWorkers: requested, workers: round.workers, seed: session.seed,
      results: session.allResults, processOverlapMilliseconds: round.processOverlapMilliseconds,
      elapsedMilliseconds: Math.round(performance.now() - started) };
    options.onEvent?.({ phase: "completion-cohort", status: "passed", ...result });
    return result;
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { results: session.allResults, seed: session.seed });
  } finally { await session.finish(success); }
}

/** One owned experimental seed; at most baseline two and one admitted three-worker finalist. */
export async function runCompletionBenchmark(options: CompletionBenchmarkOptions): Promise<CompletionBenchmarkResult> {
  const ordinaryWorkers = workerInteger(options.ordinaryWorkers ?? 4, 8);
  const budget = options.budgetMilliseconds ?? 3_600_000;
  if (!Number.isInteger(budget) || budget < 1 || budget > 5_400_000) throw failure("BENCHMARK_BUDGET_INVALID");
  const snapshot = options.resourceSnapshot ?? readCompletionResources;
  const initial = snapshot(), initialAdmission = recoveryAdmission(initial, 2, 4);
  options.onEvent?.({ phase: "benchmark-admission", certification: false, ...initialAdmission });
  if (!initialAdmission.admitted) throw failure("BENCHMARK_BASELINE_ADMISSION_REFUSED");
  const session = await completionSession(options, "benchmark"), started = performance.now();
  let success = false, stopReason: string | undefined;
  const abort = (reason: string) => { stopReason ??= reason; session.owner.abort(reason); };
  const checkStop = () => {
    if (performance.now() - started >= budget) abort("BENCHMARK_BUDGET_EXCEEDED");
    if (session.owner.interrupted) abort("BENCHMARK_INTERRUPTED");
    if (stopReason) throw failure(stopReason);
  };
  const admitRound = (workers: number, ordinary: number, observation: WorkerObservation | undefined, refusal: string) => {
    checkStop();
    const admission = recoveryAdmission(snapshot(), workers, ordinary, observation);
    if (workers > 2 && (admission.snapshot.swapInPages !== initial.swapInPages
      || admission.snapshot.swapOutPages !== initial.swapOutPages)) {
      admission.admitted = false;
      admission.reasons.push("PAGING_ACTIVITY_DURING_BASELINE");
    }
    options.onEvent?.({ phase: "benchmark-round-admission", certification: false, ...admission,
      requestedWorkers: workers, admittedWorkers: admission.admitted ? workers : 0 });
    if (!admission.admitted) throw failure(refusal);
    return admission;
  };
  const deadline = setTimeout(() => abort("BENCHMARK_BUDGET_EXCEEDED"), budget);
  const monitor = setInterval(() => {
    try {
      const resource = snapshot();
      if (!resource.complete) abort("BENCHMARK_RESOURCE_OBSERVATION_LOST");
      else if (resource.availableMemoryBytes < 10 * GiB || resource.memoryFullAvg10 >= 1
        || resource.memorySomeAvg10 >= 5 || resource.oomKills > initial.oomKills) abort("BENCHMARK_RESOURCE_PRESSURE");
    } catch { abort("BENCHMARK_RESOURCE_OBSERVATION_LOST"); }
  }, 1000);
  deadline.unref(); monitor.unref();
  const rounds: RecoveryRound[] = [];
  try {
    await session.prepare();
    checkStop();
    const baseline = await session.round(2, 4, "baseline", options.runOrdinaryRound,
      () => admitRound(2, 4, undefined, "BENCHMARK_BASELINE_ADMISSION_REFUSED").workers);
    rounds.push(baseline);
    checkStop();
    const observation = options.measureRound?.("baseline") ?? session.telemetry.observation("baseline", 4);
    let admission = recoveryAdmission(snapshot(), 3, ordinaryWorkers, observation);
    const pagingChanged = admission.snapshot.swapInPages !== initial.swapInPages || admission.snapshot.swapOutPages !== initial.swapOutPages;
    if (pagingChanged) { admission.admitted = false; admission.reasons.push("PAGING_ACTIVITY_DURING_BASELINE"); }
    if (budget - (performance.now() - started) < baseline.elapsedMilliseconds * 1.25) {
      admission.admitted = false; admission.reasons.push("BENCHMARK_REMAINING_BUDGET");
    }
    options.onEvent?.({ phase: "benchmark-finalist-admission", certification: false, ...admission });
    if (admission.admitted) rounds.push(await session.round(3, ordinaryWorkers, "finalist", options.runOrdinaryRound, () => {
      admission = admitRound(3, ordinaryWorkers, observation, "BENCHMARK_FINALIST_ADMISSION_REFUSED");
      return admission.workers;
    }));
    checkStop();
    const finalist = rounds[1];
    const finalistObservation = finalist
      ? options.measureRound?.("finalist") ?? session.telemetry.observation("finalist", ordinaryWorkers)
      : null;
    const finalistRecommendationAdmission = finalistObservation === null ? null
      : recoveryAdmission(snapshot(), 3, ordinaryWorkers, finalistObservation);
    options.onEvent?.({ phase: "benchmark-recommendation-observation", certification: false,
      finalistObservation, finalistRecommendationAdmission });
    const chosen = finalist && finalistRecommendationAdmission?.admitted === true
      && finalist.elapsedMilliseconds < baseline.elapsedMilliseconds * 0.95 ? finalist : baseline;
    assert.ok(session.seed);
    assert.equal(typeof session.initialSource, "string");
    success = true;
    return {
      certification: false, producerSelection: "genuine-witness-only", seed: session.seed,
      sourceIdentity: session.initialSource!, results: session.allResults, rounds, observation,
      finalistAdmission: admission, ordinaryInventoryIncluded: options.runOrdinaryRound !== undefined,
      finalistObservation, finalistRecommendationAdmission,
      recommendedRecoveryWorkers: chosen.workers, recommendedOrdinaryWorkers: chosen.ordinaryWorkers,
      elapsedMilliseconds: Math.round(performance.now() - started), telemetry: session.telemetry.report(),
      nonClaims: ["full-gate-certification", "semantic-authority", "global-optimum", "confined-validation-equivalence"],
    };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      results: session.allResults, rounds, seed: session.seed, stopReason,
    });
  } finally {
    clearTimeout(deadline); clearInterval(monitor);
    await session.finish(success);
  }
}
