import assert from "node:assert/strict";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { metricsCommandHandler } from "../../src/commands/metrics.ts";
import { createJsonSchemaValidator } from "../../src/schema/index.ts";

const input = { eventKind: "failure", jobIdentity: "job", jobType: "test", issueIdentity: null, workIdentity: "work", semanticOwnerIdentity: null, attemptIdentity: "attempt", logicalAttemptIdentity: "logical", phaseIdentity: "test", sourceIdentity: "fixture", observedAt: "2026-09-06T00:00:00Z", clockDomainIdentity: "clock", startedAt: null, finishedAt: null, startOffsetNanoseconds: null, endOffsetNanoseconds: null, scopeIdentity: null, toolIdentity: null, routeIdentity: null };
const recordResultValidator = createJsonSchemaValidator(JSON.parse(readFileSync(new URL("../../schemas/job-lifecycle-record-result.schema.json", import.meta.url), "utf8")));
test("metrics record binds its authenticated root through the append boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "metrics-record-bound-root-"));
  chmodSync(root, 0o700);
  const inputs = join(root, ".usf/inputs");
  mkdirSync(inputs, { recursive: true, mode: 0o700 });
  const path = join(inputs, "event.json");
  writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
  const args = ["record", "--input", ".usf/inputs/event.json"];
  await metricsCommandHandler({ command: "metrics", args, repositoryRoot: root });
  const ledger = ".usf/metrics/job-lifecycle-v2.jsonl";
  const originalLedger = readFileSync(join(root, ledger), "utf8");
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as { readFile: () => Promise<Buffer> };
  const originalReadFile = prototype.readFile;
  await probe.close();
  let swapped = false;
  prototype.readFile = async function(this: { close: () => Promise<void> }): Promise<Buffer> {
    const bytes = await originalReadFile.call(this);
    const originalClose = this.close.bind(this);
    this.close = async () => {
      await originalClose();
      if (!swapped) {
        swapped = true;
        renameSync(root, `${root}-old`);
        mkdirSync(join(root, ".usf/inputs"), { recursive: true, mode: 0o700 });
      }
    };
    return bytes;
  };
  try {
    await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }), { code: "METRICS_INPUT_REFUSED" });
  } finally {
    prototype.readFile = originalReadFile;
  }
  assert.equal(swapped, true);
  assert.equal(readFileSync(join(`${root}-old`, ledger), "utf8"), originalLedger);
  assert.equal(existsSync(join(root, ".usf/metrics")), false);
});
test("metrics record authenticates one closed private input and preserves unknowns and replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "metrics-record-")); chmodSync(root, 0o700); const dir = join(root, ".usf/inputs"); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(join(root, ".usf"), 0o700); chmodSync(dir, 0o700); const path = join(dir, "event.json"); writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
  const args = ["record", "--input", ".usf/inputs/event.json"]; const first = await metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }); const replay = await metricsCommandHandler({ command: "metrics", args, repositoryRoot: root });
  assert.equal((first.output as { status: string }).status, "appended"); assert.equal((replay.output as { status: string }).status, "replayed"); assert.equal((first.output as { acceptedOutcome: null }).acceptedOutcome, null); assert.equal((first.output as { acceptanceStatus: string }).acceptanceStatus, "unverified"); assert.throws(() => readFileSync(join(root, ".usf/metrics/events.jsonl")));
  assert.equal(recordResultValidator.validate(first.output).valid, true); assert.equal(recordResultValidator.validate(replay.output).valid, true);
  assert.equal(recordResultValidator.validate({ ...(first.output as object), unknown: true }).valid, false); assert.equal(recordResultValidator.validate({ ...(first.output as object), eventKey: 1 }).valid, false); assert.equal(recordResultValidator.validate({ ...(first.output as object), byteCount: 8_388_609 }).valid, false); assert.equal(recordResultValidator.validate({ ...(first.output as object), rowCount: "1" }).valid, false);
  const ledger = join(root, ".usf/metrics/job-lifecycle-v2.jsonl"); const initialLedger = readFileSync(ledger, "utf8"); const persisted = JSON.parse(initialLedger) as Record<string, unknown>;
  for (const key of ["acceptedOutcome", "tokenFact", "cacheFact", "costFact", "evidenceIdentity", "contributionDigest"]) assert.equal(persisted[key], null);
  const assertRefusalWithoutMutation = async (value: string, code: string) => { writeFileSync(path, value, { mode: 0o600 }); await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }), { code }); assert.equal(readFileSync(ledger, "utf8"), initialLedger); };
  await assertRefusalWithoutMutation("{bad", "METRICS_INPUT_REFUSED");
  await assertRefusalWithoutMutation(JSON.stringify({ ...input, extra: "x" }), "JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
  await assertRefusalWithoutMutation("x".repeat(16_385), "METRICS_INPUT_REFUSED");
  await assertRefusalWithoutMutation(JSON.stringify({ ...input, acceptedOutcome: true }), "JOB_LIFECYCLE_RECORDER_INPUT_INVALID");
  writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
  for (const mode of [0o644, 0o400, 0o700]) { chmodSync(path, mode); await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }), { code: "METRICS_INPUT_REFUSED" }); assert.equal(readFileSync(ledger, "utf8"), initialLedger); }
  chmodSync(path, 0o600);
  const linked = join(dir, "linked.json"); linkSync(path, linked); await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args: ["record", "--input", ".usf/inputs/linked.json"], repositoryRoot: root }), { code: "METRICS_INPUT_REFUSED" }); assert.equal(readFileSync(ledger, "utf8"), initialLedger);
  const sym = join(dir, "sym.json"); symlinkSync(path, sym); await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args: ["record", "--input", ".usf/inputs/sym.json"], repositoryRoot: root }), { code: "METRICS_INPUT_REFUSED" }); assert.equal(readFileSync(ledger, "utf8"), initialLedger);
  await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args: ["record", "--input", "../x"], repositoryRoot: root }), { code: "METRICS_ARGUMENTS_INVALID" }); await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args: ["record"], repositoryRoot: root }), { code: "METRICS_ARGUMENTS_INVALID" });
});

test("metrics record refuses an ancestor swap after the file has been opened", async () => {
  const root = mkdtempSync(join(tmpdir(), "metrics-record-swap-")); chmodSync(root, 0o700); const inputs = join(root, ".usf/inputs"); mkdirSync(inputs, { recursive: true, mode: 0o700 }); chmodSync(join(root, ".usf"), 0o700); chmodSync(inputs, 0o700);
  const path = join(inputs, "event.json"); writeFileSync(path, JSON.stringify(input), { mode: 0o600 }); const args = ["record", "--input", ".usf/inputs/event.json"];
  await metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }); const oldLedger = readFileSync(join(root, ".usf/metrics/job-lifecycle-v2.jsonl"), "utf8");
  const probe = await open(path, "r"); const prototype = Object.getPrototypeOf(probe) as { readFile: () => Promise<Buffer> }; const originalReadFile = prototype.readFile; await probe.close(); let swapped = false;
  prototype.readFile = async function(this: unknown): Promise<Buffer> { const bytes = await originalReadFile.call(this); if (!swapped) { swapped = true; const oldRoot = `${root}-old`; renameSync(root, oldRoot); mkdirSync(join(root, ".usf/inputs"), { recursive: true, mode: 0o700 }); chmodSync(root, 0o700); chmodSync(join(root, ".usf"), 0o700); chmodSync(join(root, ".usf/inputs"), 0o700); renameSync(join(oldRoot, ".usf/inputs/event.json"), path); } return bytes; };
  try { await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }), { code: "METRICS_INPUT_REFUSED" }); } finally { prototype.readFile = originalReadFile; }
  assert.equal(swapped, true); assert.equal(readFileSync(join(`${root}-old`, ".usf/metrics/job-lifecycle-v2.jsonl"), "utf8"), oldLedger);
});

test("metrics record classifies deletion after an open read as containment refusal", async () => {
  const root = mkdtempSync(join(tmpdir(), "metrics-record-delete-")); chmodSync(root, 0o700); const inputs = join(root, ".usf/inputs"); mkdirSync(inputs, { recursive: true, mode: 0o700 }); chmodSync(join(root, ".usf"), 0o700); chmodSync(inputs, 0o700);
  const path = join(inputs, "event.json"); writeFileSync(path, JSON.stringify(input), { mode: 0o600 }); const args = ["record", "--input", ".usf/inputs/event.json"];
  await metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }); const ledger = join(root, ".usf/metrics/job-lifecycle-v2.jsonl"); const oldLedger = readFileSync(ledger, "utf8"); writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
  const probe = await open(path, "r"); const prototype = Object.getPrototypeOf(probe) as { readFile: () => Promise<Buffer> }; const originalReadFile = prototype.readFile; await probe.close(); let deleted = false;
  prototype.readFile = async function(this: unknown): Promise<Buffer> { const bytes = await originalReadFile.call(this); if (!deleted) { deleted = true; unlinkSync(path); } return bytes; };
  try { await assert.rejects(async () => metricsCommandHandler({ command: "metrics", args, repositoryRoot: root }), { code: "METRICS_INPUT_REFUSED" }); } finally { prototype.readFile = originalReadFile; }
  assert.equal(deleted, true); assert.equal(readFileSync(ledger, "utf8"), oldLedger);
});
