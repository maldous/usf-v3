import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { createGateChildOwner, type GateChildOwner } from "./full-gate-children.ts";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve, relative } from "node:path";

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
interface StageResult {
  role: string; pid?: number; exitCode: number; failure: string | null; passed: string[];
  startedAt: number; completedAt: number; elapsedMilliseconds?: number;
}
interface CompletionCohortOptions {
  repositoryRoot: string;
  onOutput?: (channel: "stdout" | "stderr", bytes: Buffer) => void;
  onEvent?: (event: Record<string, unknown>) => void;
  resources?: CompletionResources;
  commandForStage?: (role: string, names: readonly string[]) => CompletionCommand;
  lockDescriptor?: number;
  childOwner?: GateChildOwner;
}
const eventSchema = "urn:usf:test-completion-cohort-event:1";
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

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

function hostResources() {
  let availableMemoryBytes = 0;
  try {
    const match = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB$/mu);
    if (match) availableMemoryBytes = Number(match[1]) * 1024;
  } catch { /* Unknown memory headroom selects the serial fallback. */ }
  return { cpuCount: availableParallelism(), availableMemoryBytes };
}

export function completionCommands(role: string, names: readonly string[]) {
  const selector = role === "producer"
    ? `--test-skip-pattern=${completionPattern(recoveryCases)}`
    : `--test-name-pattern=${completionPattern(names)}`;
  return { executable: process.execPath, args: ["--test", "--test-isolation=none", selector, completionTest] };
}

/**
 * Test scheduling only. Native fixture readers authenticate all shared seed
 * bytes and every private clone. These messages confer no semantic authority.
 * The producer completes before any consumer starts. All child handles settle
 * before this function returns or throws, including launch/protocol failures.
 */
export async function runCompletionCohort({
  repositoryRoot,
  onOutput = () => {},
  onEvent = () => {},
  resources = hostResources(),
  commandForStage = completionCommands,
  lockDescriptor,
  childOwner,
}: CompletionCohortOptions) {
  const temporaryRoot = resolve(repositoryRoot, ".usf/tmp");
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const runDirectory = await mkdtemp(resolve(temporaryRoot, "completion-cohort-"));
  const owner = childOwner ?? createGateChildOwner();
  const workers = completionWorkerCount(resources);
  const groups = [recoveryCases.filter((_, i) => i % 2 === 0), recoveryCases.filter((_, i) => i % 2 === 1)];
  assert.ok(exactNames(groups.flat(), recoveryCases), "completion partition must cover the exact denominator");
  const started = performance.now();
  let seed: Record<string, unknown> | undefined;
  let completed = false;
  const results: StageResult[] = [];
  onEvent({ phase: "completion-cohort", status: "started", workers, resources,
    runDirectory: relative(repositoryRoot, runDirectory), recoveryCases });

  async function runStage(role: string, names: readonly string[]): Promise<StageResult> {
    const command = commandForStage(role, names);
    const start = performance.now();
    const startedAt = Date.now();
    const expected = role === "producer" ? [producerCase] : names;
    const active = new Set<string>(), passed = new Set<string>();
    let inventoryCount = 0, seedCount = 0;
    let failure: string | null = null;
    const refuse = (message: string) => { failure ??= message; owner.abort(message); };
    let child: ChildProcess;
    try {
      child = owner.spawn(command.executable, command.args, {
        cwd: repositoryRoot,
        env: { ...process.env, USF_COMPLETION_COHORT_DIRECTORY: runDirectory, USF_COMPLETION_COHORT_ROLE: role },
        stdio: ["ignore", "pipe", "pipe", "ipc", ...(lockDescriptor === undefined ? [] : [lockDescriptor])],
      });
    } catch (error) {
      return { role, exitCode: 1, failure: String(error), passed: [], startedAt, completedAt: Date.now() };
    }
    onEvent({ phase: "completion-child", status: "started", role, pid: child.pid, startedAt, expectedCases: expected });
    child.stdout!.on("data", bytes => onOutput("stdout", bytes));
    child.stderr!.on("data", bytes => onOutput("stderr", bytes));
    child.on("message", (message: any) => {
      if (!message || message.schema !== eventSchema || message.role !== role) {
        refuse("COMPLETION_WORKER_EVENT_INVALID"); return;
      }
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
          || !digestPattern.test(message.seed.candidateDigest)
          || !digestPattern.test(message.seed.receiptSetDigest)
          || !digestPattern.test(message.seed.treeDigest)
          || !/^[0-9a-f]{64}$/u.test(message.seed.sourceFingerprint)) refuse("COMPLETION_SHARED_SEED_INVALID");
        else seed = message.seed;
      } else if (!["resources", "phase"].includes(message.kind)) refuse("COMPLETION_WORKER_EVENT_INVALID");
      onEvent({ phase: "completion-worker-event", role, pid: child.pid, observedAt: Date.now(), event: message });
    });
    const exitCode = await new Promise<number>(accept => {
      child.once("error", (error: NodeJS.ErrnoException) => refuse(`COMPLETION_WORKER_LAUNCH_FAILED:${error.code ?? error.name}`));
      child.once("close", (code, signal) => {
        if (signal !== null) refuse(`COMPLETION_WORKER_SIGNAL:${signal}`);
        accept(code ?? 1);
      });
    });
    if (inventoryCount !== 1 || !exactNames([...passed], expected) || active.size !== 0) refuse("COMPLETION_CASE_COVERAGE_INCOMPLETE");
    if (role === "producer" && seedCount !== 1) refuse("COMPLETION_SHARED_SEED_MISSING");
    const result = { role, pid: child.pid, exitCode, failure, passed: [...passed],
      startedAt, completedAt: Date.now(), elapsedMilliseconds: Math.round(performance.now() - start) };
    onEvent({ phase: "completion-child", status: exitCode === 0 && failure === null ? "passed" : "failed", ...result });
    return result;
  }

  try {
    const producer = await runStage("producer", []);
    results.push(producer);
    if (producer.exitCode !== 0 || producer.failure !== null) throw new Error("COMPLETION_PRODUCER_FAILED");
    if (workers === 2) {
      const settled = await Promise.allSettled(groups.map((group, i) => runStage(`recovery-${i}`, group)));
      for (const result of settled) {
        if (result.status === "fulfilled") results.push(result.value);
        else results.push({ role: "recovery", exitCode: 1, failure: String(result.reason), passed: [], startedAt: 0, completedAt: 0 });
      }
    } else {
      for (const [i, group] of groups.entries()) results.push(await runStage(`recovery-${i}`, group));
    }
    if (results.some(result => result.exitCode !== 0 || result.failure !== null)
      || !exactNames(results.slice(1).flatMap(result => result.passed), recoveryCases)) {
      throw new Error("COMPLETION_RECOVERY_FAILED");
    }
    const recovery = results.slice(1);
    const processOverlapMilliseconds = Math.max(0,
      Math.min(...recovery.map(result => result.completedAt)) - Math.max(...recovery.map(result => result.startedAt)));
    completed = true;
    const result = { label: "completion", exitCode: 0, workers, seed, results, processOverlapMilliseconds,
      elapsedMilliseconds: Math.round(performance.now() - started) };
    onEvent({ phase: "completion-cohort", status: "passed", ...result });
    return result;
  } catch (error) {
    onEvent({ phase: "completion-cohort", status: "failed", results,
      elapsedMilliseconds: Math.round(performance.now() - started),
      retainedDirectory: relative(repositoryRoot, runDirectory), reason: String(error) });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { results, seed });
  } finally {
    if (childOwner === undefined) await owner.close();
    // Never remove a directory while a worker can still be reading it.
    if (completed) await rm(runDirectory, { recursive: true, force: true });
  }
}
