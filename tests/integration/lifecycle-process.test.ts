import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const profile = "urn:usf:profile:v3-self-host:1";
const manifest = "graph/manifests/self-host.json";

type Json = Record<string, unknown>;

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
