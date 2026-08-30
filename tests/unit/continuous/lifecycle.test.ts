import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UsfError } from "../../../src/core/errors.ts";
import {
  claimLifecycleRun,
  createLifecycleBinding,
  lifecycleNonclaims,
  lifecycleReasonCodes,
  lifecycleRuntimePaths,
  observeLifecycleStatus,
  requestLifecycleStop,
  runForegroundLifecycle,
  type LifecycleBinding,
  type LifecycleClock,
  type LifecycleIdGenerator,
  type ProcessIdentity,
  type ProcessInspector,
} from "../../../src/continuous/lifecycle.ts";

const digest = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;
const identity: ProcessIdentity = Object.freeze({
  pid: 4242,
  uid: process.getuid?.() ?? 0,
  bootId: "01234567-89ab-cdef-0123-456789abcdef",
  startTicks: "12345",
  argvDigest: digest("a"),
  executablePathDigest: digest("b"),
});
const carrier = Object.freeze({ commit: "c".repeat(40), tree: "d".repeat(40) });

function binding(overrides: Partial<Parameters<typeof createLifecycleBinding>[0]> = {}): LifecycleBinding {
  return createLifecycleBinding({
    profile: "urn:usf:profile:v3-self-host:1",
    manifest: "graph/manifests/self-host.json",
    through: "check",
    automationPolicyDigest: digest("1"),
    lifecycleToolDigest: digest("9"),
    graphSemanticDigest: digest("2"),
    scopedDependencyDigests: [{ workId: "urn:usf:work:file-asset-index", digest: digest("3") }],
    ...overrides,
  });
}

function ids(seed = 0): LifecycleIdGenerator {
  let next = seed;
  const value = () => (++next).toString(16).padStart(32, "0");
  return { runId: value, nonce: value, temporaryId: value };
}

function clock(): LifecycleClock & { readonly advance: (milliseconds: number) => void } {
  let milliseconds = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, milliseconds));
  return { now, sleep: async (delay) => { milliseconds += delay; }, advance: (delay) => { milliseconds += delay; } };
}

function inspector(live = true): ProcessInspector {
  return { current: async () => identity, inspect: async () => live ? identity : null };
}

async function temporaryRepository(t: test.TestContext): Promise<string> {
  // The authoritative checker supplies TMPDIR.  Preserve the same confinement
  // for direct `node --test` invocation rather than falling back per-call.
  const base = process.env.TMPDIR ?? tmpdir();
  process.env.TMPDIR ??= base;
  const root = await mkdtemp(join(base, "usf-lifecycle-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

function refusal(code: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof UsfError);
    assert.equal(error.code, code);
    return true;
  };
}

async function releaseClaim(result: Awaited<ReturnType<typeof claimLifecycleRun>>): Promise<void> {
  if (result.status === "acquired") await result.lock.release();
}

test("binding currentness is profile-scoped, not globally semantic", () => {
  const original = binding();
  const globalOnly = binding({ graphSemanticDigest: digest("4") });
  assert.equal(original.bindingDigest, globalOnly.bindingDigest);
  assert.notEqual(original.graphSemanticDigest, globalOnly.graphSemanticDigest);
  assert.notEqual(original.bindingDigest, binding({ profile: "urn:usf:profile:other:1" }).bindingDigest);
  assert.notEqual(original.bindingDigest, binding({ through: "integrate" }).bindingDigest);
  assert.notEqual(original.bindingDigest, binding({ automationPolicyDigest: digest("5") }).bindingDigest);
  assert.equal(original.bindingDigest, binding({ scopedDependencyDigests: [{ workId: "urn:usf:work:file-asset-index", digest: digest("6") }] }).bindingDigest);
});

test("claim is atomic and concurrent identical claims converge to one active run", async (t) => {
  const root = await temporaryRepository(t);
  const sharedIds = ids();
  const results = await Promise.all(Array.from({ length: 20 }, () => claimLifecycleRun({
    repositoryRoot: root, instance: "atomic", binding: binding(), initialCarrier: carrier,
    processIdentity: identity, ids: sharedIds, clock: clock(), processInspector: inspector(),
  })));
  assert.equal(results.filter((result) => result.status === "acquired").length, 1);
  assert.equal(results.filter((result) => result.status === "already-running").length, 19);
  assert.equal(new Set(results.map((result) => result.record.runId)).size, 1);
  const winner = results.find((result) => result.status === "acquired");
  assert.ok(winner?.status === "acquired");
  const lockMetadata = await lstat(winner.paths.lockFile);
  assert.equal(lockMetadata.isFile(), true);
  assert.equal(lockMetadata.isSymbolicLink(), false);
  assert.equal(lockMetadata.mode & 0o777, 0o600);
  assert.equal(lockMetadata.nlink, 1);
  await Promise.all(results.map(releaseClaim));
});

test("a live conflicting binding refuses without replacing the active owner", async (t) => {
  const root = await temporaryRepository(t);
  const claimed = await claimLifecycleRun({ repositoryRoot: root, instance: "conflict", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: clock(), processInspector: inspector() });
  assert.equal(claimed.status, "acquired");
  await assert.rejects(
    claimLifecycleRun({ repositoryRoot: root, instance: "conflict", binding: binding({ through: "integrate" }), initialCarrier: carrier, processIdentity: identity, ids: ids(10), clock: clock(), processInspector: inspector() }),
    refusal(lifecycleReasonCodes.BINDING_CONFLICT),
  );
  assert.equal((await observeLifecycleStatus(root, "conflict", inspector())).runId, claimed.record.runId);
  await releaseClaim(claimed);
});

test("a claimed run is starting until ready, and a second start refuses once bounded stop is requested", async (t) => {
  const root = await temporaryRepository(t);
  const claimed = await claimLifecycleRun({ repositoryRoot: root, instance: "transition", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: clock(), processInspector: inspector() });
  assert.equal(claimed.status, "acquired");
  assert.equal((await observeLifecycleStatus(root, "transition", inspector())).status, "starting");
  await requestLifecycleStop({ repositoryRoot: root, instance: "transition", waitMs: 0, ids: ids(), clock: clock(), processInspector: inspector() });
  assert.equal((await observeLifecycleStatus(root, "transition", inspector())).status, "stopping");
  await assert.rejects(
    claimLifecycleRun({ repositoryRoot: root, instance: "transition", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(100), clock: clock(), processInspector: inspector() }),
    refusal(lifecycleReasonCodes.INSTANCE_STOPPING),
  );
  await releaseClaim(claimed);
});

test("runtime state is owner-only, and malformed, oversized, symlinked, or insecure active state fails closed", async (t) => {
  const root = await temporaryRepository(t);
  const paths = await lifecycleRuntimePaths(root, "unsafe", true);
  for (const path of [join(root, ".usf"), join(root, ".usf", "runs"), join(root, ".usf", "runs", "watch"), paths.instanceRoot, paths.active, paths.records, paths.completed, paths.stale]) {
    assert.equal((await lstat(path)).mode & 0o777, 0o700);
  }
  await writeFile(join(paths.active, "run.json"), "{}", { mode: 0o600 });
  assert.equal((await lstat(join(paths.active, "run.json"))).mode & 0o777, 0o600);
  await assert.rejects(claimLifecycleRun({ repositoryRoot: root, instance: "unsafe", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: clock(), processInspector: inspector() }), refusal(lifecycleReasonCodes.RECORD_INVALID));
  await rm(paths.active, { recursive: true, force: true });
  await symlink(paths.completed, paths.active);
  await assert.rejects(observeLifecycleStatus(root, "unsafe", inspector()), refusal(lifecycleReasonCodes.PATH_UNSAFE));
  await rm(paths.active, { force: true });
  await mkdir(paths.active, { mode: 0o700 });
  await writeFile(join(paths.active, "run.json"), "x".repeat(65 * 1024), { mode: 0o600 });
  await assert.rejects(claimLifecycleRun({ repositoryRoot: root, instance: "unsafe", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: clock(), processInspector: inspector() }), refusal(lifecycleReasonCodes.RECORD_TOO_LARGE));
  await rm(paths.active, { recursive: true, force: true });
  await mkdir(paths.active, { mode: 0o700 });
  await chmod(paths.active, 0o755);
  await assert.rejects(claimLifecycleRun({ repositoryRoot: root, instance: "unsafe", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: clock(), processInspector: inspector() }), refusal(lifecycleReasonCodes.PATH_UNSAFE));

  const lockPaths = await lifecycleRuntimePaths(root, "unsafe-lock", true);
  await symlink(lockPaths.completed, lockPaths.lockFile);
  await assert.rejects(claimLifecycleRun({ repositoryRoot: root, instance: "unsafe-lock", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: clock(), processInspector: inspector() }), refusal(lifecycleReasonCodes.PATH_UNSAFE));
});

test("stop intent is idempotent, times out deterministically, and stale identity is quarantined without signalling", async (t) => {
  const root = await temporaryRepository(t);
  const runClock = clock();
  const claimed = await claimLifecycleRun({ repositoryRoot: root, instance: "stop", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: runClock, processInspector: inspector() });
  assert.equal(claimed.status, "acquired");
  const first = await requestLifecycleStop({ repositoryRoot: root, instance: "stop", waitMs: 0, ids: ids(), clock: runClock, processInspector: inspector() });
  const second = await requestLifecycleStop({ repositoryRoot: root, instance: "stop", waitMs: 0, ids: ids(), clock: runClock, processInspector: inspector() });
  assert.equal(first.reasonCode, lifecycleReasonCodes.STOP_TIMEOUT);
  assert.equal(second.reasonCode, lifecycleReasonCodes.STOP_TIMEOUT);
  const stopJson = await lstat(join(claimed.paths.records, claimed.record.runId, "stop.json"));
  assert.equal(stopJson.mode & 0o777, 0o600);
  await releaseClaim(claimed);

  const stale = await claimLifecycleRun({ repositoryRoot: root, instance: "stale", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(), clock: clock(), processInspector: inspector() });
  assert.equal(stale.status, "acquired");
  await releaseClaim(stale);
  const stopped = await requestLifecycleStop({ repositoryRoot: root, instance: "stale", waitMs: 0, ids: ids(), clock: clock(), processInspector: inspector(false) });
  assert.equal(stopped.status, "degraded");
  assert.equal(stopped.reasonCode, lifecycleReasonCodes.STALE_QUARANTINED);
  assert.equal((await lstat(join(stale.paths.stale, `${stale.record.runId}.json`))).isFile(), true);
});

test("global and scoped semantic movement emit observations and continue without process-wide reproof", async (t) => {
  const root = await temporaryRepository(t);
  const events: Readonly<Record<string, unknown>>[] = [];
  const stable = binding();
  const globalMoved = binding({ graphSemanticDigest: digest("7") });
  let calls = 0;
  const result = await runForegroundLifecycle({
    command: "start", repositoryRoot: root, instance: "observe", binding: stable, initialCarrier: carrier,
    processInspector: inspector(), clock: clock(), ids: ids(), installSignalHandlers: false,
    emit: async (event) => { events.push(event); },
    cycle: async () => {
      calls += 1;
      if (calls === 1) return { state: "progress", binding: globalMoved };
      return { state: "stop", binding: globalMoved, reasonCode: "LIFECYCLE_TEST_STOP" };
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(events.filter((event) => event.status === "observation").length, 1);
  assert.deepEqual(events.at(-1)?.nonclaims, lifecycleNonclaims);

  const scopedEvents: Readonly<Record<string, unknown>>[] = [];
  const scopedMoved = binding({ scopedDependencyDigests: [{ workId: "urn:usf:work:file-asset-index", digest: digest("8") }] });
  let scopedCalls = 0;
  const changed = await runForegroundLifecycle({
    command: "start", repositoryRoot: root, instance: "scoped", binding: stable, initialCarrier: carrier,
    processInspector: inspector(), clock: clock(), ids: ids(), installSignalHandlers: false, emit: async (event) => { scopedEvents.push(event); },
    cycle: async () => {
      scopedCalls += 1;
      if (scopedCalls === 1) return { state: "progress", binding: scopedMoved };
      return { state: "stop", binding: scopedMoved, reasonCode: "LIFECYCLE_TEST_STOP" };
    },
  });
  assert.equal(changed.status, "stopped");
  assert.equal(scopedEvents.filter((event) => event.status === "observation").length, 1);
  assert.deepEqual(scopedEvents.find((event) => event.status === "observation")?.changedWorkIds, ["urn:usf:work:file-asset-index"]);
});

test("an in-flight cycle observes the injected AbortSignal and drains before the bounded stop result", async (t) => {
  const root = await temporaryRepository(t);
  const lifecycleClock = clock();
  let entered: (() => void) | undefined;
  const enteredCycle = new Promise<void>((complete) => { entered = complete; });
  let aborted = false;
  const foreground = runForegroundLifecycle({
    command: "start", repositoryRoot: root, instance: "drain", binding: binding(), initialCarrier: carrier,
    processInspector: inspector(), clock: lifecycleClock, ids: ids(), installSignalHandlers: false,
    cycleTimeoutMs: 100, drainTimeoutMs: 100, stopPollMs: 10, emit: async () => {},
    cycle: ({ signal }) => new Promise((complete) => {
      entered?.();
      signal.addEventListener("abort", () => { aborted = true; complete({ state: "stop", binding: binding(), reasonCode: "LIFECYCLE_TEST_DRAINED" }); }, { once: true });
    }),
  });
  await enteredCycle;
  const requested = await requestLifecycleStop({ repositoryRoot: root, instance: "drain", waitMs: 0, ids: ids(), clock: lifecycleClock, processInspector: inspector() });
  assert.equal(requested.reasonCode, lifecycleReasonCodes.STOP_TIMEOUT);
  const result = await foreground;
  assert.equal(aborted, true);
  assert.equal(result.status, "stopped");
  assert.equal(result.reasonCode, "LIFECYCLE_STOP_REQUESTED");
});

test("a non-cooperative cycle retains the kernel owner lock past drain timeout until it settles", async (t) => {
  const root = await temporaryRepository(t);
  const lifecycleClock = clock();
  let entered: (() => void) | undefined;
  const enteredCycle = new Promise<void>((complete) => { entered = complete; });
  let abortObserved: (() => void) | undefined;
  const aborted = new Promise<void>((complete) => { abortObserved = complete; });
  let settle: (() => void) | undefined;
  const cycleSettled = new Promise<void>((complete) => { settle = complete; });
  const foreground = runForegroundLifecycle({
    command: "start", repositoryRoot: root, instance: "noncooperative", binding: binding(), initialCarrier: carrier,
    processInspector: inspector(), clock: lifecycleClock, ids: ids(), installSignalHandlers: false,
    cycleTimeoutMs: 100, drainTimeoutMs: 100, stopPollMs: 10, emit: async () => {},
    cycle: ({ signal }) => new Promise((complete) => {
      entered?.();
      signal.addEventListener("abort", () => { abortObserved?.(); }, { once: true });
      void cycleSettled.then(() => complete({ state: "stop", binding: binding(), reasonCode: "LIFECYCLE_TEST_LATE_DRAIN" }));
    }),
  });
  await enteredCycle;
  await requestLifecycleStop({ repositoryRoot: root, instance: "noncooperative", waitMs: 0, ids: ids(), clock: lifecycleClock, processInspector: inspector() });
  await aborted;
  await new Promise<void>((complete) => setTimeout(complete, 150));
  await assert.rejects(
    claimLifecycleRun({ repositoryRoot: root, instance: "noncooperative", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(200), clock: lifecycleClock, processInspector: inspector() }),
    refusal(lifecycleReasonCodes.INSTANCE_STOPPING),
  );
  settle?.();
  const result = await foreground;
  assert.equal(result.status, "degraded");
  assert.equal(result.reasonCode, lifecycleReasonCodes.STOP_TIMEOUT);
  const replacement = await claimLifecycleRun({ repositoryRoot: root, instance: "noncooperative", binding: binding(), initialCarrier: carrier, processIdentity: identity, ids: ids(300), clock: lifecycleClock, processInspector: inspector() });
  assert.equal(replacement.status, "acquired");
  await releaseClaim(replacement);
});
