import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { observeIntegrationValidationChild } from "../../../src/realisation/transition.ts";

const timing = { wallTimeMilliseconds: 1000, terminationGraceMilliseconds: 10, terminationSignal: "SIGTERM", forcedTerminationSignal: "SIGKILL" } as const;

class ControlledChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = undefined;
  readonly signals: string[] = [];
  readonly killResults: boolean[] = [];
  unrefs = 0;
  onSignal?: (signal: string) => void;
  kill(signal: string): boolean { this.signals.push(signal); this.onSignal?.(signal); return this.killResults.shift() ?? true; }
  unref(): void { this.unrefs++; }
  get child(): ChildProcess { return this as unknown as ChildProcess; }
}

test("integration process waits for normal stdio closure and settles once on success or refusal", async () => {
  for (const code of [0, 7]) {
    const fake = new ControlledChild();
    let settled = false;
    const result = observeIntegrationValidationChild(fake.child, timing).then(value => { settled = true; return value; });
    fake.emit("exit", code);
    await nextTurn();
    assert.equal(settled, false, "leader exit is not pipe closure");
    fake.emit("close", code);
    assert.deepEqual(await result, { exitCode: code, withinLimit: true, timedOut: false, timeoutTerminationSignal: "none" });
    fake.emit("error", new Error("late teardown error")); fake.emit("close", 0);
    assert.equal(fake.unrefs, 1); assert.deepEqual(fake.signals, []);
    assert(fake.stdout.destroyed && fake.stderr.destroyed);
    assert.equal(fake.stdout.listenerCount("data"), 0);
  }
});

test("timeout retains group escalation after leader exit, close and late error", async () => {
  const fake = new ControlledChild();
  fake.onSignal = signal => {
    if (signal === "SIGTERM") { fake.emit("exit", 0); fake.emit("close", 0); fake.emit("error", new Error("leader exited")); }
  };
  const result = await observeIntegrationValidationChild(fake.child, { ...timing, wallTimeMilliseconds: 5, terminationGraceMilliseconds: 5 });
  assert.deepEqual(result, { exitCode: 1, withinLimit: true, timedOut: true, timeoutTerminationSignal: "SIGKILL" });
  assert.deepEqual(fake.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(fake.unrefs, 1); assert(fake.stdout.destroyed && fake.stderr.destroyed);
  fake.emit("close", 0); fake.emit("error", new Error("after settlement"));
  assert.equal(fake.unrefs, 1);
});

test("spawn error and output overflow settle with closed owned handles without fabricated timeout", async () => {
  for (const mode of ["spawn-error", "overflow"] as const) {
    const fake = new ControlledChild(), result = observeIntegrationValidationChild(fake.child, timing);
    if (mode === "spawn-error") fake.emit("error", new Error("spawn failed"));
    else fake.stdout.write(Buffer.alloc(256 * 1024 + 1));
    assert.deepEqual(await result, { exitCode: 1, withinLimit: mode === "spawn-error", timedOut: false, timeoutTerminationSignal: "none" });
    assert.deepEqual(fake.signals, mode === "spawn-error" ? [] : ["SIGKILL"]);
    assert.equal(fake.unrefs, 1); assert(fake.stdout.destroyed && fake.stderr.destroyed);
  }
});

test("overflow during timeout retains the SIGKILL actually delivered even when grace finds no process", async () => {
  const fake = new ControlledChild();
  fake.killResults.push(true, true, false);
  fake.onSignal = signal => { if (signal === "SIGTERM") queueMicrotask(() => fake.stdout.write(Buffer.alloc(256 * 1024 + 1))); };
  const result = await observeIntegrationValidationChild(fake.child, { ...timing, wallTimeMilliseconds: 5, terminationGraceMilliseconds: 5 });
  assert.deepEqual(fake.signals, ["SIGTERM", "SIGKILL", "SIGKILL"]);
  assert.deepEqual(result, { exitCode: 1, withinLimit: false, timedOut: true, timeoutTerminationSignal: "SIGKILL" });
  assert(fake.stdout.destroyed && fake.stderr.destroyed); assert.equal(fake.unrefs, 1);
});

test("actual detached leader exit cannot leave descendant pipes holding validation open", { timeout: 8000 }, async context => {
  const descendant = `process.on("SIGTERM", () => {}); setTimeout(() => process.exit(9), 6000); process.send("ready");`;
  const leader = `const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:["ignore",1,2,"ipc"]}); child.once("message",()=>{process.stdout.write("ready"); process.exit(0);});`;
  const child = spawn(process.execPath, ["-e", leader], { env: {}, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const group = child.pid;
  context.after(() => {
    if (group !== undefined) { try { process.kill(-group, "SIGKILL"); } catch {} }
    child.stdout.destroy(); child.stderr.destroy(); child.unref();
  });
  let output = "", leaderExit: number | null | undefined;
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.once("exit", code => { leaderExit = code; });
  const started = performance.now();
  const result = await observeIntegrationValidationChild(child, { ...timing, wallTimeMilliseconds: 1500, terminationGraceMilliseconds: 25 });
  assert.equal(leaderExit, 0, "leader acknowledged descendant readiness before exiting");
  assert.equal(output, "ready");
  assert.equal(result.exitCode, 1); assert.equal(result.timedOut, true);
  assert.equal(result.timeoutTerminationSignal, "SIGKILL");
  assert.equal(result.withinLimit, true);
  assert(performance.now() - started < 5000, "bounded settlement precedes descendant failsafe");
  assert(child.stdout.destroyed && child.stderr.destroyed);
});
