import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createGateChildOwner } from "../../../scripts/full-gate-children.ts";
import { acquireFullGateLock } from "../../../scripts/full-gate-lock.ts";
import { runCompletionCohort } from "../../../scripts/completion-throughput.ts";

const repository = resolve(import.meta.dirname, "../../..");
interface Identity { pid: number; start: string }
function current(pid: number): (Identity & { state: string }) | null {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(") ") + 2).trim().split(/\s+/u);
    return { pid, start: fields[19]!, state: fields[0]! };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}
function alive(identity: Identity): boolean {
  const observed = current(identity.pid);
  return observed !== null && observed.start === identity.start && !["Z", "X"].includes(observed.state);
}
async function until(predicate: () => boolean | Promise<boolean>, bound = 5000) {
  const deadline = performance.now() + bound;
  while (!(await predicate())) {
    assert.ok(performance.now() < deadline, "owned process transition exceeded its bound");
    await new Promise(accept => setTimeout(accept, 10));
  }
}
function settled(child: ChildProcess) {
  return new Promise<void>(accept => child.once("close", () => accept()));
}
async function fixture() {
  await mkdir(resolve(repository, ".usf/tmp"), { recursive: true });
  const directory = await mkdtemp(resolve(repository, ".usf/tmp/process-tree-test-"));
  const sentinel = spawn(process.execPath, ["--eval", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const sentinelClosed = settled(sentinel);
  const sentinelIdentity = current(sentinel.pid!)!;
  let tree: Identity[] = [];
  return {
    directory, sentinelIdentity,
    async capture() {
      await until(async () => {
        try {
          tree = await Promise.all(["worker", "child", "grandchild"].map(async name =>
            JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8")) as Identity));
          return tree.every(alive);
        } catch { return false; }
      });
      return tree;
    },
    async readTree() {
      tree = await Promise.all(["worker", "child", "grandchild"].map(async name =>
        JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8")) as Identity));
      return tree;
    },
    async cleanup() {
      // Failure cleanup may target only these exact newly-created identities.
      for (const identity of tree) if (alive(identity)) {
        try { process.kill(identity.pid, "SIGKILL"); } catch { /* raced its own exit */ }
      }
      if (alive(sentinelIdentity)) sentinel.kill("SIGKILL");
      await sentinelClosed;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function treeProgram(directory: string, behaviour: "wait" | "fail" | "success"): string {
  const record = (name: string) => `const fs=require("fs");const raw=fs.readFileSync("/proc/"+process.pid+"/stat","utf8");fs.writeFileSync(${JSON.stringify(resolve(directory, name + ".json"))},JSON.stringify({pid:process.pid,start:raw.slice(raw.lastIndexOf(") ")+2).trim().split(/\\s+/)[19]}));`;
  const grandchild = record("grandchild") + 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);';
  const middle = record("child") + `require("child_process").spawn(process.execPath,["--eval",${JSON.stringify(grandchild)}],{detached:true,stdio:"ignore"}).unref();process.on("SIGTERM",()=>{});setInterval(()=>{},1000);`;
  return record("worker") + `
    require("child_process").spawn(process.execPath,["--eval",${JSON.stringify(middle)}],{detached:true,stdio:"ignore"}).unref();
    const poll=setInterval(()=>{if(fs.existsSync(${JSON.stringify(resolve(directory, "grandchild.json"))})){
      clearInterval(poll);${behaviour === "wait" ? "setInterval(()=>{},1000);" : `process.exit(${behaviour === "fail" ? 7 : 0});`}
    }},10);
    setTimeout(()=>process.exit(98),10000).unref();`;
}

for (const behaviour of ["fail", "success"] as const) {
  test(`worker ${behaviour} drains a detached child and detached grandchild without touching unrelated processes`, { timeout: 15_000 }, async () => {
    const f = await fixture();
    const owner = createGateChildOwner(100);
    try {
      await assert.rejects(() => runCompletionCohort({
        repositoryRoot: f.directory, childOwner: owner,
        resources: { cpuCount: 2, availableMemoryBytes: 32 * 1024 ** 3 },
        commandForStage: () => ({ executable: process.execPath, args: ["--eval", treeProgram(f.directory, behaviour)] }),
      }));
      assert.equal((await f.readTree()).some(alive), false, "a returned failure must leave no owned descendant executing");
      assert.equal(alive(f.sentinelIdentity), true);
    } finally { await owner.close(); await f.cleanup(); }
  });
}

for (const signal of ["SIGTERM", "SIGINT", "SIGKILL"] as const) {
  test(`controller ${signal} drains escaped sessions and retains the gate lock until descendants settle`, { timeout: 15_000 }, async () => {
    const f = await fixture();
    const imports = {
      owner: pathToFileURL(resolve(repository, "scripts/full-gate-children.ts")).href,
      cohort: pathToFileURL(resolve(repository, "scripts/completion-throughput.ts")).href,
      lock: pathToFileURL(resolve(repository, "scripts/full-gate-lock.ts")).href,
    };
    const program = `
      import {createGateChildOwner} from ${JSON.stringify(imports.owner)};
      import {runCompletionCohort} from ${JSON.stringify(imports.cohort)};
      import {acquireFullGateLock} from ${JSON.stringify(imports.lock)};
      const release=acquireFullGateLock(${JSON.stringify(f.directory)});
      const owner=createGateChildOwner(600);
      try { await runCompletionCohort({
        repositoryRoot:${JSON.stringify(f.directory)},childOwner:owner,lockDescriptor:release.descriptor,
        resources:{cpuCount:2,availableMemoryBytes:32*1024**3},
        commandForStage:()=>({executable:process.execPath,args:["--eval",${JSON.stringify(treeProgram(f.directory, "wait"))}]}),
      }); } catch {process.exitCode=1;} finally {try {await owner.close();release.confirmDrained();} finally {release();}}
    `;
    const controller = spawn(process.execPath, ["--input-type=module", "--eval", program], { stdio: "ignore" });
    const controllerClosed = settled(controller);
    try {
      const owned = await f.capture();
      assert.throws(() => acquireFullGateLock(f.directory), { code: "FULL_GATE_ALREADY_RUNNING" });
      controller.kill(signal);
      await controllerClosed;
      // SIGKILL skips JS finally; the live guardian must retain the descriptor.
      if (signal === "SIGKILL") {
        assert.ok(owned.some(alive), "fixture must observe the forced-termination grace window");
        assert.throws(() => acquireFullGateLock(f.directory), { code: "FULL_GATE_ALREADY_RUNNING" });
      }
      await until(() => !owned.some(alive));
      await until(() => {
        try {
          const release = acquireFullGateLock(f.directory);
          release.confirmDrained();
          release();
          assert.notEqual(signal, "SIGKILL", "controller death cannot supply a drain acknowledgement");
          return true;
        }
        catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "FULL_GATE_ALREADY_RUNNING") return false;
          assert.equal(signal, "SIGKILL");
          assert.equal(code, "FULL_GATE_DRAIN_UNCONFIRMED");
          return true;
        }
      });
      assert.equal(alive(f.sentinelIdentity), true, "unrelated process must survive all owned cleanup");
    } finally {
      if (controller.exitCode === null && controller.signalCode === null) controller.kill("SIGKILL");
      await controllerClosed;
      await f.cleanup();
    }
  });
}


test("actual guardian SIGKILL retains durable exclusion after worker death with detached descendants alive", { timeout: 10_000 }, async () => {
  const f = await fixture();
  const release = acquireFullGateLock(f.directory);
  const owner = createGateChildOwner(100);
  const guardian = owner.spawn(process.execPath, ["--eval", treeProgram(f.directory, "wait")], {
    stdio: ["ignore", "pipe", "pipe", release.descriptor],
  });
  const closed = settled(guardian);
  try {
    const owned = await f.capture();
    guardian.kill("SIGKILL");
    // The direct lane also exits; neither surviving detached descendant keeps
    // the inherited flock FD. This is guardian loss, not controller loss alone.
    process.kill(owned[0]!.pid, "SIGTERM");
    await closed;
    let drained = false;
    try { await owner.close(); drained = true; } catch { /* unresolved ownership must remain fenced */ }
    if (drained) (release as typeof release & { confirmDrained?: () => void }).confirmDrained?.();
    release();
    assert.ok(owned.slice(1).every(alive), "the exclusion witness requires two actual surviving descendants");
    assert.throws(() => acquireFullGateLock(f.directory), { code: "FULL_GATE_DRAIN_UNCONFIRMED" });
    assert.equal(drained, false, "a killed guardian is not a drain acknowledgement");
    assert.equal(alive(f.sentinelIdentity), true);
  } finally {
    if (guardian.exitCode === null && guardian.signalCode === null) guardian.kill("SIGKILL");
    await f.cleanup();
    await closed;
    try { await owner.close(); } catch { /* retained fence is intentional */ }
    release();
  }
});

function injectedGuardian(directory: string, sentinel: Identity, mode: "reuse" | "error" | "blocked") {
  // Inject the enumeration/open interleaving, not an invented process identity:
  // the stale descendant number now names the actual unrelated sentinel.
  return String.raw`
import importlib.util, json, os, signal, sys, time
spec = importlib.util.spec_from_file_location("gate_tree", ${JSON.stringify(resolve(repository, "scripts/full-gate-process-tree.py"))})
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
directory = ${JSON.stringify(directory)}
sentinel = ${sentinel.pid}
mode = ${JSON.stringify(mode)}
original_children = gate.children
original_descendants = getattr(gate, "descendants", None)
original_signal = signal.pidfd_send_signal
original_open = os.pidfd_open
def marker(name):
    with open(os.path.join(directory, name), "w") as stream:
        stream.write("observed")
def injected_children(pid):
    result = original_children(pid)
    if pid == os.getpid() and os.path.exists(os.path.join(directory, "inject")):
        if mode == "reuse":
            marker("enumerated-stale-pid")
            identity = gate.process_identity(sentinel)
            if identity is not None and identity[1] not in ("Z", "X"):
                result.add(sentinel)
        elif mode == "error" and not os.path.exists(os.path.join(directory, "error-injected")):
            marker("error-injected")
            raise OSError(5, "deterministic observation failure")
    return result
gate.children = injected_children
def opened(pid, flags=0):
    if pid == sentinel:
        marker("replacement-pidfd-opened")
    return original_open(pid, flags)
os.pidfd_open = opened
def signalled(fd, number, *args):
    if mode == "blocked" and number == signal.SIGKILL and not os.path.exists(os.path.join(directory, "unblock")):
        marker("kill-suppressed")
        # Keep the injected failure retryable until the fixture releases it;
        # never report successful delivery of a signal we suppressed.
        raise ProcessLookupError("injected SIGKILL suppression until fixture release")
    return original_signal(fd, number, *args)
signal.pidfd_send_signal = signalled
if mode in ("error", "blocked"):
    read_end, write_end = os.pipe()
    os.close(read_end)
    os.dup2(write_end, 2)
    os.close(write_end)
worker = ${JSON.stringify(treeProgram(directory, "wait"))}
sys.argv = ["gate_tree", "--parent-pid", str(os.getppid()), "--grace-ms", "100", "--", ${JSON.stringify(process.execPath)}, "--eval", worker]
try:
    sys.exit(gate.main())
except BaseException as error:
    if isinstance(error, SystemExit):
        raise
    marker("guardian-error-" + type(error).__name__)
    sys.exit(1)
`;
}

test("a deterministic descendant PID-reuse interleaving cannot signal the unrelated replacement", { timeout: 10_000 }, async () => {
  const f = await fixture();
  const guardian = spawn("/usr/bin/python3", ["-B", "-c", injectedGuardian(f.directory, f.sentinelIdentity, "reuse")],
    { stdio: "ignore", detached: true });
  const closed = settled(guardian);
  try {
    const owned = await f.capture();
    await import("node:fs/promises").then(fs => fs.writeFile(resolve(f.directory, "inject"), ""));
    guardian.kill("SIGTERM");
    await closed;
    assert.equal((await readFile(resolve(f.directory, "replacement-pidfd-opened"), "utf8")), "observed",
      "counterexample must reach pidfd_open after a stale numeric descendant enumeration");
    assert.equal(alive(f.sentinelIdentity), true, "the unrelated replacement must never receive a signal");
    assert.equal(owned.some(alive), false, "all genuine detached descendants must still drain");
  } finally {
    if (guardian.exitCode === null && guardian.signalCode === null) guardian.kill("SIGKILL");
    await closed;
    await f.cleanup();
  }
});

for (const mode of ["error", "blocked"] as const) {
  test("closed stderr cannot abandon the " + mode + " drain path or its inherited exclusion", { timeout: 10_000 }, async () => {
    const f = await fixture();
    const release = acquireFullGateLock(f.directory);
    const guardian = spawn("/usr/bin/python3", ["-B", "-c", injectedGuardian(f.directory, f.sentinelIdentity, mode)], {
      stdio: ["ignore", "ignore", "ignore", release.descriptor], detached: true,
    });
    const closed = settled(guardian);
    try {
      const owned = await f.capture();
      await import("node:fs/promises").then(fs => fs.writeFile(resolve(f.directory, "inject"), ""));
      if (mode === "blocked") {
        guardian.kill("SIGTERM");
        await until(async () => {
          try { return (await readFile(resolve(f.directory, "kill-suppressed"), "utf8")) === "observed"; }
          catch { return false; }
        });
        await new Promise(accept => setTimeout(accept, 1250));
        assert.equal(guardian.exitCode, null, "broken diagnostic output must not terminate a blocked guardian");
        assert.equal(guardian.signalCode, null);
        assert.ok(owned.some(alive), "the blocked branch must have a real survivor");
        release();
        assert.throws(() => acquireFullGateLock(f.directory), { code: "FULL_GATE_ALREADY_RUNNING" });
        await import("node:fs/promises").then(fs => fs.writeFile(resolve(f.directory, "unblock"), ""));
      }
      await closed;
      assert.equal(owned.some(alive), false, "diagnostic failure must not abandon an owned survivor");
      assert.equal(alive(f.sentinelIdentity), true);
    } finally {
      if (guardian.exitCode === null && guardian.signalCode === null) guardian.kill("SIGKILL");
      await closed;
      await f.cleanup();
      release();
    }
  });
}
