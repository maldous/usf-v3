import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  completionCommands, completionPattern, completionWorkerCount,
  producerCase, recoveryCases, runCompletionCohort,
} from "../../../scripts/completion-throughput.ts";

const root = resolve(import.meta.dirname, "../../..");
const resources = { cpuCount: 4, availableMemoryBytes: 32 * 1024 ** 3 };

async function fixture() {
  await mkdir(resolve(root, ".usf/tmp"), { recursive: true });
  const directory = await mkdtemp(resolve(root, ".usf/tmp/completion-scheduler-test-"));
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function fakeCommand(scenario: string) {
  return (role: string, names: readonly string[]) => ({
    executable: process.execPath,
    args: ["--input-type=module", "--eval", `
      import { existsSync, writeFileSync, copyFileSync, readFileSync, statSync } from "node:fs";
      import { join } from "node:path";
      const dir = process.env.USF_COMPLETION_COHORT_DIRECTORY;
      const role = process.env.USF_COMPLETION_COHORT_ROLE;
      const scenario = ${JSON.stringify(scenario)};
      const names = ${JSON.stringify(role === "producer" ? [producerCase] : names)};
      const cases = ${JSON.stringify(recoveryCases)};
      const send = event => new Promise((resolve, reject) => process.send({
        schema: "urn:usf:test-completion-cohort-event:1", role, ...event,
      }, error => error ? reject(error) : resolve()));
      const guard = setTimeout(() => process.exit(91), 5000);
      await send({ kind: "inventory", cases: scenario === "inventory" ? cases.slice(1) : cases });
      if (role === "producer") {
        writeFileSync(join(dir, "test-seed"), "immutable", { flag: "wx" });
        for (const name of names) await send({ kind: "case-started", name });
        if (scenario !== "no-seed") await send({ kind: "seed-ready", seed: {
          schema: "urn:usf:test-completion-shared-seed:1",
          candidateDigest: "sha256:" + "a".repeat(64), receiptSetDigest: "sha256:" + "b".repeat(64),
          treeDigest: "sha256:" + "c".repeat(64), sourceFingerprint: "d".repeat(64),
        }});
        for (const name of names) await send({ kind: "case-passed", name });
      } else {
        if (!existsSync(join(dir, "test-seed"))) process.exit(92);
        const mine = join(dir, role);
        copyFileSync(join(dir, "test-seed"), mine);
        const source = statSync(join(dir, "test-seed")), copy = statSync(mine);
        if (source.dev === copy.dev && source.ino === copy.ino) process.exit(93);
        writeFileSync(mine, role);
        // A barrier forces two actual child processes to coexist. Serial
        // scheduling fails the bounded guard rather than producing a false
        // overlap measurement from two mocked promises.
        const peer = join(dir, role === "recovery-0" ? "recovery-1" : "recovery-0");
        if (scenario !== "serial") while (!existsSync(peer)) await new Promise(r => setTimeout(r, 10));
        if (readFileSync(join(dir, "test-seed"), "utf8") !== "immutable") process.exit(94);
        for (const name of names) {
          if (scenario === "missing-case" && name === names[0]) continue;
          await send({ kind: "case-started", name });
          await send({ kind: "case-passed", name });
          if (scenario === "duplicate") await send({ kind: "case-passed", name });
        }
        if (scenario === "exit-failure" && role === "recovery-0") process.exitCode = 7;
      }
      clearTimeout(guard);
      process.disconnect();
    `],
  });
}

test("completion commands partition every recovery and lineage case with anchored selectors", () => {
  assert.equal(recoveryCases.length, 6);
  const skip = new RegExp(completionPattern(recoveryCases));
  assert.equal(skip.test(producerCase), false);
  for (const name of recoveryCases) {
    assert.equal(skip.test(name), true);
    assert.equal(skip.test(name + " accidentally added"), false);
  }
  const escaped = new RegExp(completionPattern(["a.b (c) [d]"]));
  assert.equal(escaped.test("a.b (c) [d]"), true);
  assert.equal(escaped.test("axb c d"), false);
  const producer = completionCommands("producer", []);
  assert.ok(producer.args.some((arg: string) => arg.startsWith("--test-skip-pattern=")));
  assert.equal(producer.args.some((arg: string) => arg.startsWith("--test-concurrency=")), false);
});

test("unknown or constrained resources serialize workers without reducing the case denominator", () => {
  assert.equal(completionWorkerCount(resources), 2);
  assert.equal(completionWorkerCount({ ...resources, cpuCount: 1 }), 1);
  assert.equal(completionWorkerCount({ ...resources, availableMemoryBytes: 0 }), 1);
});

test("one producer precedes two overlapping real processes with independent mutable copies", { timeout: 15_000 }, async () => {
  const f = await fixture();
  const events: Record<string, any>[] = [];
  try {
    const result = await runCompletionCohort({ repositoryRoot: f.directory, resources,
      commandForStage: fakeCommand("pass"), onEvent: (event: Record<string, any>) => events.push(event) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.results.length, 3);
    assert.equal(new Set(result.results.map((item: any) => item.pid)).size, 3);
    assert.ok(result.processOverlapMilliseconds > 0);
    assert.equal(result.results[1].startedAt >= result.results[0].completedAt, true);
    assert.equal(result.results[2].startedAt >= result.results[0].completedAt, true);
    assert.deepEqual(result.results.slice(1).flatMap((item: any) => item.passed).sort(), [...recoveryCases].sort());
    assert.equal(events.filter(event => event.event?.kind === "seed-ready").length, 1);
  } finally { await f.cleanup(); }
});

test("resource fallback still executes both complete recovery groups", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const result = await runCompletionCohort({ repositoryRoot: f.directory,
      resources: { ...resources, cpuCount: 1 }, commandForStage: fakeCommand("serial") });
    assert.equal(result.workers, 1);
    assert.equal(result.processOverlapMilliseconds, 0);
    assert.deepEqual(result.results.slice(1).flatMap((item: any) => item.passed).sort(), [...recoveryCases].sort());
  } finally { await f.cleanup(); }
});

for (const scenario of ["no-seed", "inventory", "missing-case", "duplicate", "exit-failure"]) {
  test(`completion scheduling fails closed on ${scenario} and drains launched workers`, { timeout: 15_000 }, async () => {
    const f = await fixture();
    const events: Record<string, any>[] = [];
    try {
      await assert.rejects(() => runCompletionCohort({ repositoryRoot: f.directory, resources,
        commandForStage: fakeCommand(scenario), onEvent: (event: Record<string, any>) => events.push(event) }));
      const started = events.filter(event => event.phase === "completion-child" && event.status === "started");
      const ended = events.filter(event => event.phase === "completion-child" && event.status !== "started");
      assert.equal(ended.length, started.length, "all child handles must close before rejection and lock release");
      if (["no-seed", "inventory"].includes(scenario)) assert.equal(started.length, 1);
    } finally { await f.cleanup(); }
  });
}

test("a missing worker executable refuses without launching recovery", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => runCompletionCohort({ repositoryRoot: f.directory, resources,
      commandForStage: () => ({ executable: resolve(f.directory, "missing"), args: [] }) }),
      /COMPLETION_PRODUCER_FAILED/u);
  } finally { await f.cleanup(); }
});
