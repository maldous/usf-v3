import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { test } from "node:test";
import { linuxProcessInspector } from "../../src/continuous/lifecycle.ts";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(sourceRoot, "src/cli.ts");
const sessionA = "integration-session-codex-0001";
const sessionB = "integration-session-claude-0002";

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "usf-steward-cli-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
  await mkdir(join(root, ".usf"), { mode: 0o700 });
  await mkdir(join(root, "graph/manifests"), { recursive: true });
  const subject = "<urn:usf:operational-lifecycle:stewardship:1>";
  const graph = "<urn:usf:graph:operational-stewardship>";
  await writeFile(join(root, "graph/operational-stewardship.nq"), [
    `${subject} <urn:usf:predicate:defaultRenewalSeconds> "300" ${graph} .`,
    `${subject} <urn:usf:predicate:minimumRenewalSeconds> "30" ${graph} .`,
    `${subject} <urn:usf:predicate:maximumRenewalSeconds> "1800" ${graph} .`, "",
  ].join("\n"));
  await writeFile(join(root, "graph/manifests/operational-stewardship.json"), JSON.stringify({
    schema: "urn:usf:graph-manifest:2", version: 2, imports: [], sources: [{
      path: "graph/operational-stewardship.nq", format: "application/n-quads",
      graph: "urn:usf:graph:operational-stewardship", role: "contract", validationProfile: "bootstrap-nquads-v1",
    }],
  }));
  return root;
}

function environment(session: string): NodeJS.ProcessEnv {
  return { HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", USF_STEWARD_SESSION_ID: session };
}

async function invoke(root: string, session: string, args: string[]): Promise<{ code: number | null; output: any }> {
  const child = spawn(process.execPath, [cli, "hermes", "steward", ...args], { cwd: root, env: environment(session), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout!.setEncoding("utf8"); child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", chunk => { stdout += chunk; });
  child.stderr!.on("data", chunk => { stderr += chunk; });
  const [code] = await once(child, "exit");
  return { code, output: (() => { const value = JSON.parse((stdout || stderr).trim()); return value.result ?? value; })() };
}

async function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let output = ""; let stderr = "";
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`controller exited before checkpoint: ${code}; stderr=${JSON.stringify(stderr)}`)));
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.stdout!.on("data", chunk => {
      output += chunk;
      if (output.includes("\n")) resolveLine(output.split("\n")[0]!);
    });
  });
}

async function killFixtureChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
}

test("CLI claim survives its command process and replays only for the same controlling session", async (t) => {
  const root = await fixture(t);
  const first = await invoke(root, sessionA, ["claim", "--agent", "Codex"]);
  assert.equal(first.code, 0, JSON.stringify(first.output));
  assert.equal(first.output.record.process.pid, process.pid);
  const replay = await invoke(root, sessionA, ["claim", "--agent", "Codex"]);
  assert.equal(replay.code, 0, JSON.stringify(replay.output));
  assert.equal(replay.output.record.claimId, first.output.record.claimId);
  assert.equal(replay.output.record.generation, first.output.record.generation);
  assert.notEqual((await invoke(root, sessionB, ["claim", "--agent", "Claude"])).code, 0);
  const stored = await readFile(join(root, ".usf/hermes/stewardship/record.json"), "utf8");
  assert.equal(stored.includes(sessionA), false);
  assert.equal(JSON.stringify(first.output).includes(sessionA), false);
});

test("two concurrent CLI claims admit exactly one steward", async (t) => {
  const root = await fixture(t);
  const results = await Promise.all([
    invoke(root, sessionA, ["claim", "--agent", "Codex"]),
    invoke(root, sessionB, ["claim", "--agent", "Claude"]),
  ]);
  assert.equal(results.filter(r => r.code === 0).length, 1, JSON.stringify(results));
  const winner = results.find(r => r.code === 0)!;
  const stored = JSON.parse(await readFile(join(root, ".usf/hermes/stewardship/record.json"), "utf8"));
  assert.equal(stored.claimId, winner.output.record.claimId);
});

test("every registered call leaf checks stewardship before dispatch while generic call remains no-contact", async (t) => {
  const root = await fixture(t);
  const claimed = await invoke(root, sessionA, ["claim", "--agent", "Codex"]);
  assert.equal(claimed.code, 0, JSON.stringify(claimed.output));
  const authority = await readFile(join(sourceRoot, "graph/provider-pipeline.nq"), "utf8");
  const leaves = [...authority.matchAll(/<urn:usf:predicate:commandPath> "call ([a-z-]+)"/gu)].map(match => match[1]!);
  assert.ok(leaves.length > 0, "the corpus declares live-provider call leaves");
  for (const leaf of new Set([...leaves, "future-leaf"])) {
    const result = spawnSync(process.execPath, [cli, "call", leaf], { cwd: root, env: environment(sessionB), encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).reasonCode, "STEWARD_CLAIM_STALE", leaf);
  }
  const generic = spawnSync(process.execPath, [cli, "call", "--input", "-"], {
    cwd: root, env: environment(sessionB), input: "{}", encoding: "utf8",
  });
  assert.notEqual(generic.status, 0);
  assert.equal(JSON.parse(generic.stderr).reasonCode, "CALL_ASSIGNMENTS_REQUIRED");
});

test("handoff and idempotent release preserve the exact live supervisor record", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, ".usf/hermes/supervisor"), { recursive: true, mode: 0o700 });
  const supervisorPath = join(root, ".usf/hermes/supervisor/supervisor.json");
  const bytes = JSON.stringify({ schema: "urn:usf:hermes-supervisor:1", version: 1,
    supervisorId: "a".repeat(25), startedAt: "2026-09-05T00:00:00Z",
    process: await linuxProcessInspector.current(), manifest: "graph/manifests/operational-stewardship.json",
    envFile: ".usf/credentials/fixture.env", pauseSeconds: 20, concurrency: 1, dispatchLimit: 1,
    usefulTokenTarget: 100000, authorityIdentity: `sha256:${"a".repeat(64)}` });
  await writeFile(supervisorPath, bytes, { mode: 0o600 });
  const first = await invoke(root, sessionA, ["claim", "--agent", "Codex"]);
  assert.equal(first.code, 0, JSON.stringify(first.output));
  const handoff = await invoke(root, sessionA, ["handoff", "--claim", first.output.record.claimId, "--generation", first.output.record.generation]);
  assert.equal(handoff.code, 0, JSON.stringify(handoff.output));
  const second = await invoke(root, sessionB, ["claim", "--agent", "Claude"]);
  assert.equal(second.code, 0, JSON.stringify(second.output));
  assert.notEqual(second.output.record.generation, first.output.record.generation);
  assert.notEqual((await invoke(root, sessionA, ["renew", "--claim", first.output.record.claimId, "--generation", first.output.record.generation])).code, 0);
  assert.equal((await invoke(root, sessionB, ["release", "--claim", second.output.record.claimId, "--generation", second.output.record.generation])).code, 0);
  assert.equal((await invoke(root, sessionB, ["release", "--claim", second.output.record.claimId, "--generation", second.output.record.generation])).code, 0);
  assert.equal(await readFile(supervisorPath, "utf8"), bytes);
});

test("a killed controller is recovered from durable CLI state without its chat or scratchpad", async (t) => {
  const root = await fixture(t);
  const script = `import { spawnSync } from 'node:child_process';
    const r = spawnSync(process.execPath, [${JSON.stringify(cli)}, 'hermes', 'steward', 'claim', '--agent', 'Codex'], {cwd:${JSON.stringify(root)},env:process.env,encoding:'utf8'});
    if(r.status !== 0) { process.stderr.write(r.stderr); process.exit(r.status ?? 1); }
    process.stdout.write(r.stdout); setInterval(()=>{},1000);`;
  const controller = spawn(process.execPath, ["--input-type=module", "--eval", script], { env: environment(sessionA), stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => killFixtureChild(controller));
  const claimed = JSON.parse(await firstLine(controller)).result;
  assert.equal(claimed.record.process.pid, controller.pid);
  assert.notEqual((await invoke(root, sessionB, ["recover", "--agent", "Claude"])).code, 0);
  await killFixtureChild(controller);
  assert.equal((await invoke(root, sessionB, ["status"])).output.status, "dead");
  const recovered = await invoke(root, sessionB, ["recover", "--agent", "Claude"]);
  assert.equal(recovered.code, 0, JSON.stringify(recovered.output));
  assert.equal(recovered.output.status, "recovered");
  assert.notEqual(recovered.output.record.generation, claimed.record.generation);
});

test("supervisor admission refuses another process while its kernel lifetime lock is held", async (t) => {
  const root = await fixture(t);
  const module = new URL(`file://${join(sourceRoot, "src/continuous/stewardship.ts")}`).href;
  const script = `import { acquireSupervisorLifetimeLock } from ${JSON.stringify(module)};
    await acquireSupervisorLifetimeLock(${JSON.stringify(root)}); process.stdout.write('held\\n'); setInterval(()=>{},1000);`;
  const holder = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => killFixtureChild(holder));
  assert.equal(await firstLine(holder), "held");
  const blocked = spawnSync(process.execPath, [cli, "hermes", "supervise"], { cwd: root, env: environment(sessionB), encoding: "utf8" });
  assert.notEqual(blocked.status, 0);
  assert.equal(JSON.parse(blocked.stderr).reasonCode, "STEWARD_ACTIVITY_BUSY");
  await killFixtureChild(holder);
});

test("direct supervisor entry without a current start admission refuses before creating a supervisor", async (t) => {
  const root = await fixture(t);
  const result = spawnSync(process.execPath, [cli, "hermes", "supervise"], {
    cwd: root, env: environment(sessionA), encoding: "utf8", timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).reasonCode, "HERMES_SUPERVISOR_ADMISSION_REQUIRED");
  await assert.rejects(readFile(join(root, ".usf/hermes/supervisor/supervisor.json")), { code: "ENOENT" });
});

test("supervisor observation refuses malformed records and a redirected runtime directory", async (t) => {
  const root = await fixture(t);
  const runtime = join(root, ".usf/hermes/supervisor");
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const record = join(runtime, "supervisor.json");
  for (const contents of ["{", "{}", JSON.stringify({ schema: "urn:usf:hermes-supervisor:1", version: 1 })]) {
    await writeFile(record, contents, { mode: 0o600 });
    const result = spawnSync(process.execPath, [cli, "hermes", "status"], { cwd: root, env: environment(sessionA), encoding: "utf8" });
    assert.notEqual(result.status, 0, contents);
    assert.match(JSON.parse(result.stderr).reasonCode, /^HERMES_RUNTIME_(INVALID|UNSAFE)$/u);
  }
  await rm(runtime, { recursive: true });
  const target = join(root, "unrelated-fixture-directory");
  await mkdir(target, { mode: 0o700 });
  await symlink(target, runtime);
  const result = spawnSync(process.execPath, [cli, "hermes", "status"], { cwd: root, env: environment(sessionA), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).reasonCode, "HERMES_RUNTIME_UNSAFE");
  await assert.rejects(readFile(join(target, "supervisor.log")), { code: "ENOENT" });
});

test("an authorised real fixture supervisor starts, survives handoff, drains and restarts under its steward", { timeout: 60_000 }, async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, ".usf/credentials"), { mode: 0o700 });
  await writeFile(join(root, ".usf/credentials/fixture.env"), "", { mode: 0o600 });
  // The isolated manifest contains only stewardship policy: there is no
  // admitted provider route, product repository or implementation work.
  const args = ["--manifest", "graph/manifests/operational-stewardship.json",
    "--env-file", ".usf/credentials/fixture.env", "--pause-seconds", "1", "--concurrency", "1", "--limit", "1"];
  const lifecycle = (session: string, claim: any, action: string, tail: string[] = []) => {
    const result = spawnSync(process.execPath, [cli, "hermes", action, ...tail], {
      cwd: root, env: { ...environment(session), USF_STEWARD_CLAIM_ID: claim.claimId,
        USF_STEWARD_GENERATION: claim.generation }, encoding: "utf8", timeout: 15_000,
    });
    return { code: result.status, output: JSON.parse((result.stdout || result.stderr || "{}").trim()) };
  };
  t.after(async () => {
    const record = await readFile(join(root, ".usf/hermes/supervisor/supervisor.json"), "utf8").then(JSON.parse, () => null);
    if (record?.process) {
      const current = await linuxProcessInspector.inspect(record.process.pid);
      if (current && JSON.stringify(current) === JSON.stringify(record.process)) process.kill(current.pid, "SIGKILL");
    }
  });
  const first = await invoke(root, sessionA, ["claim", "--agent", "Codex"]);
  assert.equal(first.code, 0, JSON.stringify(first.output));
  const started = lifecycle(sessionA, first.output.record, "start", args);
  assert.equal(started.code, 0, JSON.stringify(started.output));
  assert.match(started.output.supervisorId, /^[0-9a-f]{25}$/u);
  const replay = await invoke(root, sessionA, ["claim", "--agent", "Codex"]);
  assert.equal(replay.code, 0, JSON.stringify(replay.output));
  assert.equal(replay.output.record.supervisor.pid, started.output.pid);
  const handed = await invoke(root, sessionA, ["handoff", "--claim", first.output.record.claimId, "--generation", first.output.record.generation]);
  assert.equal(handed.code, 0, JSON.stringify(handed.output));
  const next = await invoke(root, sessionB, ["claim", "--agent", "Claude"]);
  assert.equal(next.code, 0, JSON.stringify(next.output));
  assert.equal(next.output.record.supervisor.pid, started.output.pid);
  const stopped = lifecycle(sessionB, next.output.record, "stop", ["--wait-ms", "5000"]);
  assert.equal(stopped.code, 0, JSON.stringify(stopped.output));
  assert.equal(stopped.output.drained, true);
  const restarted = lifecycle(sessionB, next.output.record, "start", args);
  assert.equal(restarted.code, 0, JSON.stringify(restarted.output));
  assert.notEqual(restarted.output.supervisorId, started.output.supervisorId);
  assert.equal(lifecycle(sessionB, next.output.record, "stop", ["--wait-ms", "5000"]).code, 0);
});
