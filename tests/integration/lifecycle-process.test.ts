import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { admitEligibleLifecycleWork, composeLifecycleWork, deriveEligibleLifecycleWork, type LifecycleEligibleWork } from "../../src/commands/lifecycle.ts";
import { createLifecycleBinding } from "../../src/continuous/lifecycle.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { createRealisationBasis, packetDigest, type RealisationBasis } from "../../src/realisation/basis.ts";
import { verifyTransitionActivationCurrentness } from "../../src/realisation/transition.ts";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const profile = "urn:usf:profile:v3-self-host:1";
const manifest = "graph/manifests/self-host.json";
const gatePermission = "urn:usf:permission:semantic-first-order";
const gateCurrentness = "urn:usf:currentness:semantic-first-bootstrap-transition:1";
const postEligibleWorkIds = [
  "urn:usf:work:realisation-basis-chain",
  "urn:usf:work:semantic-first-eligibility",
  "urn:usf:work:semantic-first-lifecycle-admission",
] as const;

type Json = Record<string, unknown>;
const digest = (seed: string): `sha256:${string}` => `sha256:${seed.repeat(64).slice(0, 64)}`;

function canonicalSourceState(): "pre" | "post" {
  const currentGraph = loadSemanticGraph(repositoryRoot, manifest);
  const states = currentGraph.quads
    .filter((quad) => quad.subject === gatePermission && quad.predicate === "urn:usf:predicate:activationState" && quad.objectKind === "iri")
    .map((quad) => quad.object);
  assert.equal(states.length, 1, "the canonical gate permission state is exact");
  if (states[0] === "urn:usf:contract-state:proofblocked") return "pre";
  assert.equal(states[0], "urn:usf:contract-state:active", "the lifecycle suite accepts only the exact pre or verified post gate state");
  verifyTransitionActivationCurrentness(currentGraph, gateCurrentness, gatePermission, profile);
  return "post";
}

function instanceName(): string {
  return `lifecycle-it-${process.pid}-${Date.now().toString(36)}`;
}

function command(args: readonly string[], environment: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(resolve(repositoryRoot, "bin/usf"), args, {
    cwd: repositoryRoot,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function untilEvent(child: ChildProcess, predicate: (event: Json) => boolean, timeoutMs = 5_000): Promise<Json> {
  return new Promise((resolveEvent, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => finish(new Error(`timed out waiting for lifecycle event; stderr=${stderr}`)), timeoutMs);
    const finish = (error?: Error, event?: Json) => {
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      if (error) reject(error); else resolveEvent(event!);
    };
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      let newline: number;
      while ((newline = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        if (line.length === 0) continue;
        let event: unknown;
        try { event = JSON.parse(line); } catch { finish(new Error(`non-JSON lifecycle stdout: ${line}`)); return; }
        if (typeof event === "object" && event !== null && !Array.isArray(event) && predicate(event as Json)) {
          finish(undefined, event as Json);
          return;
        }
      }
    };
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString("utf8"); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(new Error(`lifecycle exited before expected event (${String(code)}, ${String(signal)}); stderr=${stderr}`));
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => reject(new Error("timed out waiting for lifecycle process exit")), timeoutMs);
    child.once("exit", (code, signal) => { clearTimeout(timeout); resolveExit({ code, signal }); });
  });
}

async function invoke(args: readonly string[]): Promise<{ readonly code: number; readonly output: Json }> {
  const child = command(args);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const { code } = await waitForExit(child);
  assert.equal(stderr, "", `unexpected stderr for ${args.join(" ")}`);
  assert.equal(code, 0, `unexpected exit for ${args.join(" ")}`);
  return { code: code!, output: JSON.parse(stdout.trim()) as Json };
}

function startArguments(instance: string): string[] {
  return ["start", "--profile", profile, "--manifest", manifest, "--through", "check", "--instance", instance];
}

function assertNoAbsolutePathsOrSecrets(value: unknown): void {
  if (typeof value === "string") {
    assert.equal(value.includes(repositoryRoot), false, "emitted lifecycle records must not disclose the repository path");
    assert.equal(/(?:token|secret|password|authorization)/i.test(value), false, "emitted lifecycle records must not disclose secrets");
  } else if (Array.isArray(value)) {
    for (const item of value) assertNoAbsolutePathsOrSecrets(item);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(/(?:token|secret|password|authorization)/i.test(key), false, "emitted lifecycle records must not carry secret-shaped keys");
      assertNoAbsolutePathsOrSecrets(item);
    }
  }
}

test("foreground start/status/stop, signal shutdown, and stale restart are isolated and bounded", async (t) => {
  const sourceState = canonicalSourceState();
  const instance = instanceName();
  const runtimeRoot = resolve(repositoryRoot, ".usf/runs/watch", instance);
  const owned: ChildProcess[] = [];
  t.after(async () => {
    for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await Promise.all(owned.map((child) => waitForExit(child).catch(() => undefined)));
    await rm(runtimeRoot, { recursive: true, force: true });
  });

  const first = command(startArguments(instance));
  owned.push(first);
  const ready = await untilEvent(first, (event) => event.status === "ready");
  assert.equal(ready.command, "start");
  assert.equal(ready.profile, profile);
  assert.equal(ready.manifest, manifest);
  assert.equal(ready.through, "check");
  assertNoAbsolutePathsOrSecrets(ready);

  // Process readiness is an operational fact, not semantic admission. The
  // eligible set follows only the exact current pre/verified-post authority.
  const workObservation = await untilEvent(first, (event) => event.schema === "urn:usf:lifecycle-work-observation:1");
  assert.equal(workObservation.processReady, true);
  assert.deepEqual(workObservation.semanticEligibleWorkIds, sourceState === "post" ? postEligibleWorkIds : []);
  assert.equal(workObservation.semanticEligibilityIsNotProcessReadiness, true);

  const status = await invoke(["status", "--instance", instance]);
  assert.equal(status.output.status, "running");
  assert.equal(status.output.instance, instance);

  const duplicate = command(startArguments(instance));
  owned.push(duplicate);
  const duplicateEvent = await untilEvent(duplicate, (event) => event.status === "already-running");
  assert.equal(duplicateEvent.runId, ready.runId);
  assert.equal((await waitForExit(duplicate)).code, 0);

  const stop = await invoke(["stop", "--instance", instance, "--wait-ms", "3000"]);
  assert.equal(stop.output.status, "stopped");
  assert.equal((await waitForExit(first)).code, 0);
  const repeatedStop = await invoke(["stop", "--instance", instance, "--wait-ms", "0"]);
  assert.equal(repeatedStop.output.status, "already-stopped");

  const signalled = command(startArguments(instance));
  owned.push(signalled);
  const signalReady = await untilEvent(signalled, (event) => event.status === "ready");
  assert.equal(signalled.kill("SIGTERM"), true);
  assert.equal((await waitForExit(signalled)).code, 0);
  const signalReceipt = JSON.parse(await readFile(resolve(runtimeRoot, "completed", `${signalReady.runId as string}.json`), "utf8")) as Json;
  assert.equal(signalReceipt.status, "stopped");
  assert.equal(signalReceipt.reasonCode, "LIFECYCLE_STOP_REQUESTED");

  const interrupted = command(startArguments(instance));
  owned.push(interrupted);
  const interruptReady = await untilEvent(interrupted, (event) => event.status === "ready");
  assert.equal(interrupted.kill("SIGINT"), true);
  assert.equal((await waitForExit(interrupted)).code, 0);
  const interruptIntent = JSON.parse(await readFile(resolve(runtimeRoot, "records", interruptReady.runId as string, "stop.json"), "utf8")) as Json;
  assert.equal(interruptIntent.source, "SIGINT");

  const killed = command(startArguments(instance));
  owned.push(killed);
  await untilEvent(killed, (event) => event.status === "ready");
  assert.equal(killed.kill("SIGKILL"), true);
  assert.equal((await waitForExit(killed)).signal, "SIGKILL");
  const restarted = command(startArguments(instance));
  owned.push(restarted);
  const restartedReady = await untilEvent(restarted, (event) => event.status === "ready");
  assert.equal(restartedReady.instance, instance);
  const finalStop = await invoke(["stop", "--instance", instance, "--wait-ms", "3000"]);
  assert.equal(finalStop.output.status, "stopped");
  assert.equal((await waitForExit(restarted)).code, 0);
  // This test deliberately does not mutate the shared repository remote. The
  // command-side carrier observation is constrained to local Git plumbing.
  const commandSource = await readFile(resolve(repositoryRoot, "src/commands/lifecycle.ts"), "utf8");
  assert.match(commandSource, /execFileSync\("git", \["rev-parse", "HEAD\^\{commit\}"\]/);
  assert.doesNotMatch(commandSource, /"(?:fetch|push|pull|ls-remote|remote)"/);
});

test("concurrent real starts have one winner, and an unreachable configured GitHub remote is not contacted", async (t) => {
  const instance = instanceName();
  const runtimeRoot = resolve(repositoryRoot, ".usf/runs/watch", instance);
  const owned: ChildProcess[] = [];
  t.after(async () => {
    for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await Promise.all(owned.map((child) => waitForExit(child).catch(() => undefined)));
    await rm(runtimeRoot, { recursive: true, force: true });
  });

  const starts = Array.from({ length: 3 }, () => command(startArguments(instance)));
  owned.push(...starts);
  const events = await Promise.all(starts.map((child) => untilEvent(child, (event) => event.status === "ready" || event.status === "already-running")));
  const ready = events.filter((event) => event.status === "ready");
  const alreadyRunning = events.filter((event) => event.status === "already-running");
  assert.equal(ready.length, 1);
  assert.equal(alreadyRunning.length, 2);
  assert.equal(new Set(events.map((event) => event.runId)).size, 1);
  const winner = starts[events.findIndex((event) => event.status === "ready")]!;
  const stopped = await invoke(["stop", "--instance", instance, "--wait-ms", "3000"]);
  assert.equal(stopped.output.status, "stopped");
  assert.equal((await waitForExit(winner)).code, 0);
  await Promise.all(starts.filter((child) => child !== winner).map((child) => waitForExit(child).then((result) => assert.equal(result.code, 0))));

  const remoteInstance = instanceName();
  const remoteRuntimeRoot = resolve(repositoryRoot, ".usf/runs/watch", remoteInstance);
  t.after(async () => { await rm(remoteRuntimeRoot, { recursive: true, force: true }); });
  const unreachable = command(startArguments(remoteInstance), {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "remote.origin.url",
    GIT_CONFIG_VALUE_0: "https://127.0.0.1:1/usf-never-contact.git",
  });
  owned.push(unreachable);
  const remoteReady = await untilEvent(unreachable, (event) => event.status === "ready", 2_000);
  assert.equal(remoteReady.instance, remoteInstance);
  const remoteStopped = await invoke(["stop", "--instance", remoteInstance, "--wait-ms", "3000"]);
  assert.equal(remoteStopped.output.status, "stopped");
  assert.equal((await waitForExit(unreachable)).code, 0);
});

test("semantic-lifecycle-admission: readiness is not semantic eligibility and Hermes cannot serialize siblings", async () => {
  const sourceState = canonicalSourceState();
  const canonicalEligible = await deriveEligibleLifecycleWork({ repositoryRoot, profile, manifest, through: "check" });
  assert.deepEqual(
    canonicalEligible.map((entry) => entry.packet.id),
    sourceState === "post" ? postEligibleWorkIds : [],
    "ordinary lifecycle composition must follow only exact pre or verified-post authority",
  );

  const binding = createLifecycleBinding({
    profile, manifest, through: "check",
    automationPolicyDigest: `sha256:${"1".repeat(64)}`,
    lifecycleToolDigest: `sha256:${"2".repeat(64)}`,
    graphSemanticDigest: `sha256:${"3".repeat(64)}`,
    scopedDependencyDigests: [],
  });
  // The composer receives only work that has already passed graph eligibility;
  // proofblocked and stale siblings are intentionally absent from this set.
  const packet = (id: string, authority: "active-permission" | "none", maximumThrough: string | null): WorkPacketFixture => ({
    schema: "urn:usf:work-packet:1", id, contract: `urn:usf:contract:${id}:1`, decisionBoundary: { kind: "realisation-profile", root: profile },
    semanticDigest: digest("8"), scopedDependencyDigest: digest("9"),
    eligibility: { dependencyReady: true, dependencyAuthority: "no-dependencies", authorityBasisDigest: digest("4"), construction: { eligible: authority === "active-permission", authority, maximumThrough, reasonCodes: authority === "active-permission" ? [] : ["PROOFBLOCKED"] }, activation: { eligible: authority === "active-permission", reasonCodes: [] } },
  });
  const withBasis = (value: WorkPacketFixture): LifecycleEligibleWork => {
    const basis = createRealisationBasis({ selection: { manifestPath: manifest, manifestDigest: digest("1"), profile, profileVersion: "1", profileDigest: digest("2"), product: "urn:usf:product:v3", foundation: "urn:usf:foundation:v3", coreToProductDigest: digest("3"), productToCoreDigest: digest("4"), compositeDigest: digest("5") }, authority: { contract: value.contract, contractDigest: digest("6"), contractShape: "urn:usf:contract-shape:semantic-first:1", permission: `urn:usf:permission:${value.id}`, permissionDigest: digest("7"), permissionState: "active", maximumThrough: "integrate" }, work: { id: value.id, resourceDigest: digest("6"), packetCoreDigest: digest("7"), semanticDigest: digest("8"), scopedDependencyDigest: digest("9"), dependencies: [] }, semanticTrace: { policy: "urn:usf:policy:semantic-first:1", stages: [] }, scope: { readSet: [], writeSet: [], preimages: {} }, trace: { requirements: [], evidence: [], proof: [], validation: [] }, inputs: { policyDigest: digest("a"), schemaDigests: [], toolDigests: [] } } as never);
    return { packet: Object.freeze({ ...value, realisationBasis: basis }) as unknown as LifecycleEligibleWork["packet"], basis };
  };
  type WorkPacketFixture = { schema: "urn:usf:work-packet:1"; id: string; contract: string; decisionBoundary: { kind: "realisation-profile"; root: string }; semanticDigest: string; scopedDependencyDigest: string; eligibility: NonNullable<LifecycleEligibleWork["packet"]["eligibility"]> };
  const eligible = [withBasis(packet("active-a", "active-permission", "integrate")), withBasis(packet("active-b", "active-permission", "publish"))];
  const stale = withBasis(packet("stale-sibling", "active-permission", "publish"));
  const filtered = await admitEligibleLifecycleWork([...eligible.map((entry) => entry.packet), stale.packet, packet("proofblocked", "none", null)] as unknown as import("../../src/graph/work.ts").WorkPacket[], (basis) => {
    if (basis.work.id === "stale-sibling") throw new Error("scoped basis moved");
    return basis;
  }, "check");
  assert.deepEqual(filtered.map((entry) => entry.packet.id), ["active-a", "active-b"]);
  const ceilingFiltered = await admitEligibleLifecycleWork(eligible.map((entry) => entry.packet) as unknown as import("../../src/graph/work.ts").WorkPacket[], (basis) => basis, "publish");
  assert.deepEqual(ceilingFiltered.map((entry) => entry.packet.id), ["active-b"]);
  const cases: Array<{ name: string; ranker?: (ids: readonly string[]) => readonly string[] | Promise<readonly string[]>; expected: string[] }> = [
    { name: "absent", expected: ["active-a", "active-b"] },
    { name: "reverse", ranker: (ids) => [...ids].reverse(), expected: ["active-b", "active-a"] },
    { name: "malformed", ranker: () => ["stale-sibling"], expected: ["active-a", "active-b"] },
    { name: "refused", ranker: () => { throw new Error("ranker refused"); }, expected: ["active-a", "active-b"] },
  ];
  for (const item of cases) {
    let received: readonly string[] = [];
    const result = await composeLifecycleWork({ binding, eligibleWork: Object.freeze(eligible) }, async (input) => {
      received = input.eligibleWork.map((entry) => entry.packet.id);
      return { state: "idle", plannedWorkIds: received };
    }, item.ranker);
    assert.deepEqual(received, item.expected, item.name);
    assert.deepEqual(result.plannedWorkIds, item.expected, item.name);
    assert.equal(result.state, "idle");
    assert.equal(received.includes("stale-sibling"), false);
  }

  const scopedMovement = await composeLifecycleWork({ binding, eligibleWork: Object.freeze([eligible[0]!]) }, undefined);
  assert.deepEqual(scopedMovement.plannedWorkIds, ["active-a"], "scoped movement must only invalidate its affected sibling");
  assert.equal(scopedMovement.state, "idle", "planning alone cannot claim realisation progress");
});
