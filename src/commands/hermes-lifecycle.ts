import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { linuxProcessInspector, type ProcessIdentity } from "../continuous/lifecycle.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import type { CommandResult } from "./dispatcher.ts";

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
const deliveryManifest = "graph/manifests/v3-delivery.json";
const startObservationTimeoutMs = 60_000;
const defaultStopWaitMs = 180_000;
// SIGTERM is honoured at the next cycle boundary rather than immediately, so a
// transaction in flight completes. The grace is sized for that, and SIGKILL
// remains the deterministic backstop the operator is promised.
const terminationGraceMs = 60_000;
const defaultPauseSeconds = 20;
const maximumPauseSeconds = 3_600;

export interface HermesSupervisorRecord {
  readonly schema: "urn:usf:hermes-supervisor:1";
  readonly version: 1;
  readonly supervisorId: string;
  readonly startedAt: string;
  readonly process: ProcessIdentity;
  readonly envFile: string;
  readonly pauseSeconds: number;
  readonly concurrency: number;
  readonly dispatchLimit: number;
  /** Which V3 authority this supervisor started against. */
  readonly authorityIdentity: string;
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new UsfError("HERMES_LIFECYCLE_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT, message, details);
}

interface LifecycleArguments {
  readonly envFile: string;
  readonly pauseSeconds: number;
  readonly concurrency: number;
  readonly dispatchLimit: number;
  readonly waitMs: number;
}

function parse(args: readonly string[]): LifecycleArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--env-file", "--pause-seconds", "--concurrency", "--limit", "--wait-ms"].includes(option) || values.has(option)) {
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
    envFile: values.get("--env-file") ?? ".usf/credentials/providers.env",
    pauseSeconds: bounded("--pause-seconds", defaultPauseSeconds, maximumPauseSeconds),
    concurrency: bounded("--concurrency", 6, 16),
    dispatchLimit: bounded("--limit", 12, 64),
    waitMs: bounded("--wait-ms", defaultStopWaitMs, 900_000),
  });
}

async function runtimeRoot(repositoryRoot: string): Promise<string> {
  const root = resolve(repositoryRoot, supervisorRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

async function readJson<T>(repositoryRoot: string, path: string): Promise<T | null> {
  const bytes = await readFile(resolve(repositoryRoot, path), "utf8").catch(() => undefined);
  if (bytes === undefined) return null;
  try { return JSON.parse(bytes) as T; } catch { return null; }
}

/** Write through a temporary name so a reader never observes a partial record. */
async function writeJson(repositoryRoot: string, path: string, value: unknown): Promise<void> {
  const target = resolve(repositoryRoot, path);
  const transient = `${target}.tmp-${process.pid}`;
  await writeFile(transient, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
  await rename(transient, target);
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
  const record = await readJson<HermesSupervisorRecord>(repositoryRoot, supervisorRecord);
  if (record === null || record.schema !== "urn:usf:hermes-supervisor:1") {
    return Object.freeze({ liveness: "absent" as const, record: null });
  }
  const observed = await linuxProcessInspector.inspect(record.process.pid).catch(() => null);
  const same = observed !== null
    && observed.bootId === record.process.bootId
    && observed.startTicks === record.process.startTicks
    && observed.uid === record.process.uid
    && observed.argvDigest === record.process.argvDigest
    && observed.executablePathDigest === record.process.executablePathDigest;
  return Object.freeze({ liveness: same ? "live" as const : "stale" as const, record });
}

function authorityIdentity(repositoryRoot: string): string {
  try {
    const graph = loadSemanticGraph(repositoryRoot, deliveryManifest);
    return canonicalDigest(graph.graphDigests ?? {});
  } catch {
    return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

export async function hermesStartCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parse(args);
  await runtimeRoot(repositoryRoot);
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
  await rm(resolve(repositoryRoot, supervisorRecord), { force: true });
  await rm(resolve(repositoryRoot, stopRequestRecord), { force: true });

  const log = await open(resolve(repositoryRoot, supervisorLog), constants.O_CREAT | constants.O_WRONLY | constants.O_APPEND, 0o600);
  const child = spawn(process.execPath, [
    resolve(import.meta.dirname, "..", "cli.ts"), "hermes", "supervise",
    "--env-file", parsed.envFile,
    "--pause-seconds", String(parsed.pauseSeconds),
    "--concurrency", String(parsed.concurrency),
    "--limit", String(parsed.dispatchLimit),
  ], {
    cwd: repositoryRoot,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: { HOME: process.env.HOME ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", NO_COLOR: "1", PATH: process.env.PATH ?? "" },
  });
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
  const parsed = parse(args);
  await runtimeRoot(repositoryRoot);
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
  let signal: string | null = null;
  let live = true;
  while (Date.now() - started < parsed.waitMs) {
    await new Promise((complete) => setTimeout(complete, 500));
    const current = await observeSupervisor(repositoryRoot);
    if (current.liveness !== "live") { live = false; break; }
  }
  if (live) {
    // Drain did not complete inside the operator's bound. Terminate
    // deterministically rather than leaving an owner nobody can replace.
    try { process.kill(record.process.pid, "SIGTERM"); signal = "SIGTERM"; } catch { signal = null; }
    const graceDeadline = Date.now() + terminationGraceMs;
    while (Date.now() < graceDeadline) {
      await new Promise((complete) => setTimeout(complete, 250));
      const current = await observeSupervisor(repositoryRoot);
      if (current.liveness !== "live") { live = false; break; }
    }
    if (live) {
      try { process.kill(record.process.pid, "SIGKILL"); signal = "SIGKILL"; } catch { /* already gone */ }
      const killDeadline = Date.now() + terminationGraceMs;
      while (Date.now() < killDeadline) {
        await new Promise((complete) => setTimeout(complete, 250));
        const current = await observeSupervisor(repositoryRoot);
        if (current.liveness !== "live") { live = false; break; }
      }
    }
  }
  await rm(resolve(repositoryRoot, supervisorRecord), { force: true });
  await rm(resolve(repositoryRoot, stopRequestRecord), { force: true });
  if (live) {
    throw new UsfError("HERMES_SUPERVISOR_NOT_TERMINATED", exitCodes.CONTINUOUS_DEGRADED,
      "The supervisor did not terminate after an orderly request and both signals.",
      { supervisorId: record.supervisorId, pid: record.process.pid });
  }
  return {
    output: Object.freeze({
      schema: "urn:usf:hermes-lifecycle:1" as const, version: 1 as const, operation: "stop" as const,
      running: false, outcome: signal === null ? "drained" : "terminated",
      reclaimedStaleRecord: false, drained: signal === null, terminationSignal: signal,
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
  const cycle = await readJson<Record<string, unknown>>(repositoryRoot, cycleRecord);
  const stopRequest = await readJson<Record<string, unknown>>(repositoryRoot, stopRequestRecord);

  // Status contacts nothing. Both projections below are derived from current
  // repository state, so the operator sees the same frontier the supervisor
  // would derive on its next cycle rather than a cached summary.
  const { hermesCommand } = await import("./hermes.ts");
  const { implementCommand } = await import("./hermes-implement.ts");
  const authority = await hermesCommand(repositoryRoot, ["status", ...args])
    .then((result) => result.output as Record<string, unknown>, () => null);
  const work = await implementCommand(repositoryRoot, [])
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
      authorityIdentity: observed.record?.authorityIdentity ?? authorityIdentity(repositoryRoot),
      currentCycle: cycle === null ? null : cycle.cycle ?? null,
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
  readonly artefact: Record<string, unknown> | null;
  readonly transactions: readonly Record<string, unknown>[];
  readonly facets: Record<string, unknown> | null;
  readonly blockers: readonly Record<string, unknown>[];
  readonly providerActivity: readonly Record<string, unknown>[];
  readonly lastReason: string;
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

export async function hermesSuperviseCommand(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const parsed = parse(args);
  await runtimeRoot(repositoryRoot);
  const existing = await observeSupervisor(repositoryRoot);
  if (existing.liveness === "live") {
    throw new UsfError("HERMES_SUPERVISOR_ALREADY_ACTIVE", exitCodes.DOMAIN_FAILURE,
      "Another Hermes supervisor already owns this repository.", { supervisorId: existing.record!.supervisorId });
  }
  const identity = await linuxProcessInspector.current();
  const record: HermesSupervisorRecord = Object.freeze({
    schema: "urn:usf:hermes-supervisor:1" as const,
    version: 1 as const,
    supervisorId: canonicalDigest({ process: identity, startedAt: new Date().toISOString() }).slice("sha256:".length, 32),
    startedAt: new Date().toISOString(),
    process: identity,
    envFile: parsed.envFile,
    pauseSeconds: parsed.pauseSeconds,
    concurrency: parsed.concurrency,
    dispatchLimit: parsed.dispatchLimit,
    authorityIdentity: authorityIdentity(repositoryRoot),
  });
  await writeJson(repositoryRoot, supervisorRecord, record);

  const { implementCommand } = await import("./hermes-implement.ts");
  const { realisePlanCommand } = await import("./hermes-realise.ts");
  const { transactCommand } = await import("./transact.ts");

  // A signal is a request, not an interruption: it is recorded and observed at
  // the next boundary, so no transaction is torn in half by it.
  let signalled: string | null = null;
  const onSignal = (name: string) => () => { signalled = signalled ?? name; };
  const terminate = onSignal("SIGTERM");
  const interrupt = onSignal("SIGINT");
  process.on("SIGTERM", terminate);
  process.on("SIGINT", interrupt);

  let cycle = 0;
  let reason = "running";
  try {
    for (;;) {
      if (signalled !== null) { reason = `signalled-${signalled}`; break; }
      if (await stopRequested(repositoryRoot, record.supervisorId)) { reason = "stop-requested"; break; }
      cycle += 1;
      const transactions: Record<string, unknown>[] = [];
      const blockers: Record<string, unknown>[] = [];

      // Product implementation first: it is the work the phase exists for.
      const implementation = await implementCommand(repositoryRoot, [
        "--apply", "--env-file", parsed.envFile,
        "--limit", String(parsed.dispatchLimit), "--concurrency", String(parsed.concurrency),
      ]).then((result) => result.output as Record<string, unknown>,
        (error: unknown) => {
          blockers.push(Object.freeze({ lane: "implementation", reason: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
          return null;
        });
      const implementationProposal = implementation?.proposalPath;
      if (typeof implementationProposal === "string") {
        // A transaction is never interrupted by a stop request: it is atomic and
        // completing it is cheaper and safer than abandoning it.
        transactions.push(await transactCommand(repositoryRoot, ["--proposal", implementationProposal])
          .then((result) => Object.freeze({ lane: "implementation", ...(result.output as Record<string, unknown>) }),
            (error: unknown) => Object.freeze({ lane: "implementation", refused: error instanceof Error ? error.message.slice(0, 300) : "unknown" })));
      }

      // The artefact lane continues to run: it is independent, and one lane
      // making no progress must not stop the other.
      const artefact = await realisePlanCommand(repositoryRoot, ["--apply", "--env-file", parsed.envFile])
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

      const outcomes = Array.isArray(implementation?.outcomes) ? implementation.outcomes as Record<string, unknown>[] : [];
      for (const outcome of outcomes) {
        if (outcome.outcome === "refused" || outcome.outcome === "output-refused") {
          blockers.push(Object.freeze({
            lane: "implementation", unit: outcome.unit, capability: outcome.capability,
            reason: outcome.reason ?? outcome.code, detail: outcome.detail ?? null,
          }));
        }
      }
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
          dispatchedUnits: implementation.dispatchedUnits,
          modelInvocations: implementation.modelInvocations,
          cacheHits: implementation.cacheHits,
          acceptedResults: implementation.acceptedResults,
          conformanceRuns: implementation.conformanceRuns,
        }),
        artefact: artefact === null ? null : Object.freeze({
          readyFrontier: artefact.readyFrontier,
          realizedCount: artefact.realizedCount,
          alreadySatisfiedCount: artefact.alreadySatisfiedCount,
        }),
        transactions: Object.freeze(transactions.map((entry) => Object.freeze({
          lane: entry.lane, applied: entry.applied ?? false,
          transactionDigest: entry.transactionDigest ?? null,
          pathCount: Array.isArray(entry.derivedAffectedPaths) ? entry.derivedAffectedPaths.length : 0,
          refused: entry.refused ?? null,
        }))),
        facets: (artefact?.facets ?? null) as Record<string, unknown> | null,
        blockers: Object.freeze(blockers.slice(0, 24)),
        providerActivity: Object.freeze(outcomes
          .filter((outcome) => outcome.outcome === "accepted")
          .map((outcome) => Object.freeze({ capability: outcome.capability, transport: outcome.transport, model: outcome.actualModel }))
          .slice(0, 24)),
        lastReason: implementation === null ? "implementation lane refused"
          : Number(implementation.readyFrontier ?? 0) === 0 ? "no ready implementation work remains"
          : Number(implementation.acceptedResults ?? 0) === 0 ? "the ready frontier produced no accepted result this cycle"
          : "progress",
      });
      await writeJson(repositoryRoot, cycleRecord, projection);
      if (signalled !== null) { reason = `signalled-${signalled}`; break; }
      if (await pause(repositoryRoot, record.supervisorId, parsed.pauseSeconds)) { reason = "stop-requested"; break; }
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
    await rm(resolve(repositoryRoot, supervisorRecord), { force: true });
  }
  return {
    output: Object.freeze({
      schema: "urn:usf:hermes-lifecycle:1" as const, version: 1 as const, operation: "supervise" as const,
      running: false, supervisorId: record.supervisorId, cyclesCompleted: cycle, terminalReason: reason,
    }),
    exitCode: exitCodes.SUCCESS,
  };
}
