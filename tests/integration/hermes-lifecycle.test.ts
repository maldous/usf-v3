import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { linuxProcessInspector } from "../../src/continuous/lifecycle.ts";
import { hermesStopCommand, observeSupervisor } from "../../src/commands/hermes-lifecycle.ts";

const roots: string[] = [];
async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "usf-hermes-lifecycle-"));
  await mkdir(resolve(root, ".usf", "hermes", "supervisor"), { recursive: true, mode: 0o700 });
  roots.push(root);
  return root;
}
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function writeRecord(root: string, record: unknown): Promise<void> {
  await writeFile(resolve(root, ".usf/hermes/supervisor/supervisor.json"), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function recordFor(process_: Awaited<ReturnType<typeof linuxProcessInspector.current>>): unknown {
  return {
    schema: "urn:usf:hermes-supervisor:1", version: 1, supervisorId: "test", startedAt: "2026-01-01T00:00:00.000Z",
    process: process_, envFile: ".usf/credentials/providers.env",
    pauseSeconds: 20, concurrency: 6, dispatchLimit: 12, authorityIdentity: "sha256:00",
  };
}

test("supervisor liveness is derived from durable process identity, not a bare pid", async () => {
  const root = await repository();
  assert.equal((await observeSupervisor(root)).liveness, "absent");

  const current = await linuxProcessInspector.current();
  await writeRecord(root, recordFor(current));
  assert.equal((await observeSupervisor(root)).liveness, "live");

  // The same live pid with any different identity component is not the
  // supervisor: a recycled pid must never be mistaken for the owner.
  await writeRecord(root, recordFor({ ...current, startTicks: current.startTicks + 1 }));
  assert.equal((await observeSupervisor(root)).liveness, "stale");
  await writeRecord(root, recordFor({ ...current, argvDigest: "sha256:0000" }));
  assert.equal((await observeSupervisor(root)).liveness, "stale");
  await writeRecord(root, recordFor({ ...current, bootId: "00000000-0000-0000-0000-000000000000" }));
  assert.equal((await observeSupervisor(root)).liveness, "stale");
});

test("stop is idempotent and reclaims a stale record without signalling anything", async () => {
  const root = await repository();
  const absent = await hermesStopCommand(root, []);
  assert.equal(absent.exitCode, 0);
  assert.equal((absent.output as { outcome: string }).outcome, "already-stopped");
  assert.equal((absent.output as { running: boolean }).running, false);

  const current = await linuxProcessInspector.current();
  await writeRecord(root, recordFor({ ...current, startTicks: current.startTicks + 7 }));
  const stale = await hermesStopCommand(root, []);
  assert.equal(stale.exitCode, 0);
  assert.equal((stale.output as { outcome: string }).outcome, "stale-record-reclaimed");
  assert.equal(await readFile(resolve(root, ".usf/hermes/supervisor/supervisor.json"), "utf8").then(() => true, () => false), false);

  // Issuing it again is still a success, which is what idempotent means.
  assert.equal(((await hermesStopCommand(root, [])).output as { outcome: string }).outcome, "already-stopped");
});
