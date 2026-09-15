import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { acquireFullGateLock } from "../../../scripts/full-gate-lock.ts";

const temporary = resolve(".usf/tmp");
const moduleUrl = new URL("../../../scripts/full-gate-lock.ts", import.meta.url).href;

function fixture() {
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  return mkdtempSync(resolve(temporary, "gate-lock-test-"));
}

function attempt(root: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { acquireFullGateLock } from ${JSON.stringify(moduleUrl)};
    try { const release = acquireFullGateLock(process.argv[1]); release.confirmDrained(); release(); }
    catch (error) {
      process.stderr.write(error.code ?? 'FULL_GATE_PROBE_ERROR');
      process.exitCode = Number.isInteger(error.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
    }
  `, root], { encoding: "utf8", timeout: 5000 });
}

test("full-gate lock rejects an independent process until its owner releases", () => {
  const root = fixture();
  let release: ReturnType<typeof acquireFullGateLock> | undefined;
  try {
    release = acquireFullGateLock(root);
    const conflict = attempt(root);
    assert.equal(conflict.status, 75, conflict.stderr);
    assert.equal(conflict.stderr, "FULL_GATE_ALREADY_RUNNING");
    release.confirmDrained();
    release();
    release();
    assert.equal(attempt(root).status, 0);
  } finally { release?.(); rmSync(root, { recursive: true, force: true }); }
});

test("a killed gate owner leaves durable admission fenced after its kernel lock releases", { timeout: 10000 }, async () => {
  const root = fixture();
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { acquireFullGateLock } from ${JSON.stringify(moduleUrl)};
    acquireFullGateLock(process.argv[1]);
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `, root], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  try {
    const ready = await Promise.race([
      once(child.stdout!, "data"),
      exited.then(() => { throw new Error("gate lock child exited before admission"); }),
    ]);
    assert.equal(String(ready[0]), "ready");
    const path = resolve(root, ".usf/logs/full-gate/execution.lock");
    const before = statSync(path);
    assert.equal(attempt(root).status, 75);
    child.kill("SIGKILL");
    await exited;
    const unresolved = attempt(root);
    assert.equal(unresolved.status, 75);
    assert.equal(unresolved.stderr, "FULL_GATE_DRAIN_UNCONFIRMED");
    const after = statSync(path);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await exited; }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("full-gate execution lock scopes exclusion to one repository", () => {
  const first = fixture();
  const second = fixture();
  let release: ReturnType<typeof acquireFullGateLock> | undefined;
  try {
    release = acquireFullGateLock(first);
    assert.equal(attempt(second).status, 0);
    release.confirmDrained();
  } finally { release?.(); rmSync(first, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); }
});

test("an inherited descriptor excludes live duplicates and unconfirmed drain stays fenced after lane exit", { timeout: 10000 }, async () => {
  const root = fixture();
  const release = acquireFullGateLock(root);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "ignore", "ignore", release.descriptor],
  });
  const exited = once(child, "exit");
  try {
    release();
    assert.equal(attempt(root).status, 75, "lane must keep exclusion after its wrapper releases");
    child.kill("SIGTERM");
    await exited;
    const unresolved = attempt(root);
    assert.equal(unresolved.status, 75);
    assert.equal(unresolved.stderr, "FULL_GATE_DRAIN_UNCONFIRMED");
  } finally {
    release();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await exited; }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("redirected full-gate runtime paths refuse before locking another root", () => {
  const root = fixture();
  const outside = fixture();
  try {
    symlinkSync(outside, resolve(root, ".usf"), "dir");
    assert.throws(() => acquireFullGateLock(root), { code: "FULL_GATE_LOCK_UNAVAILABLE" });
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("unconfirmed release and repeated admission probes never clear or rewrite the durable fence", () => {
  const root = fixture();
  const release = acquireFullGateLock(root);
  try {
    const path = resolve(root, ".usf/logs/full-gate/execution.pending.json");
    const before = readFileSync(path, "utf8");
    release();
    release();
    for (let index = 0; index < 2; index += 1) {
      const result = attempt(root);
      assert.equal(result.status, 75);
      assert.equal(result.stderr, "FULL_GATE_DRAIN_UNCONFIRMED");
      assert.equal(readFileSync(path, "utf8"), before);
    }
  } finally { release(); rmSync(root, { recursive: true, force: true }); }
});
