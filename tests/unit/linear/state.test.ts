import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, test } from "node:test";
import { LinearStateError, LinearStateStore, readLinearRecord, writeLinearRecord } from "../../../src/linear/state.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function root(): Promise<string> {
  const value = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "usf-linear-state-"));
  roots.push(value);
  return value;
}
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const identity = Object.freeze({ bindingIri: "urn:usf:binding:one", operation: "issue-update", remoteOperationId: "0f567599-0a18-4a45-9f2d-a2b804047db5" });

test("persists deterministic intent, serializes mutations, and leaves sent state observable after restart", async () => {
  const repositoryRoot = await root();
  const first = await LinearStateStore.open(repositoryRoot);
  const prepared = await first.prepare(identity, digest("a"), "2026-09-07T00:00:00.000Z");
  assert.match(prepared.id, /^[0-9a-f-]{36}$/u);
  assert.equal((await first.prepare(identity, digest("a"), "2026-09-07T00:01:00.000Z")).id, prepared.id);
  await first.markSent(prepared.id, "2026-09-07T00:02:00.000Z");
  const restarted = await LinearStateStore.open(repositoryRoot);
  assert.equal(restarted.intents()[0]?.state, "sent");
  assert.equal((await restarted.prepare(identity, digest("a"))).id, prepared.id);
  await restarted.markUnknown(prepared.id, "2026-09-07T00:03:00.000Z");
  await assert.rejects(() => restarted.markSent(prepared.id), (error: unknown) => error instanceof LinearStateError && error.reasonCode === "LINEAR_STATE_TRANSITION_REFUSED");
  const bytes = JSON.parse(await readFile(join(repositoryRoot, ".usf/hermes/linear/state.json"), "utf8")) as { transitions: unknown[] };
  assert.equal(bytes.transitions.length, 3, "prepared, sent, and explicit unknown transitions are retained");
  assert.equal((await lstat(join(repositoryRoot, ".usf/hermes/linear/state.json"))).mode & 0o777, 0o600);
});

test("queues concurrent prepare, transition, and progress mutations without losing records", async () => {
  const store = await LinearStateStore.open(await root());
  const secondIdentity = { ...identity, bindingIri: "urn:usf:binding:two", remoteOperationId: "8eaab66a-b27d-49b7-bc3c-e131d4a7ccdb" };
  const [first, second] = await Promise.all([store.prepare(identity, digest("e")), store.prepare(secondIdentity, digest("f"))]);
  await Promise.all([
    store.markSent(first.id),
    store.markSent(second.id),
    store.recordProgress({ bindingIri: identity.bindingIri, stage: "sent", blocker: null, evidenceRefs: [] }),
    store.recordProgress({ bindingIri: secondIdentity.bindingIri, stage: "sent", blocker: null, evidenceRefs: [] }),
  ]);
  assert.equal(store.intents().length, 2);
  assert.deepEqual(store.intents().map((intent) => intent.state), ["sent", "sent"]);
  assert.equal(store.progress().length, 2);
});

test("reconciles only exact remote operation identity and immutable request evidence", async () => {
  const store = await LinearStateStore.open(await root());
  const intent = await store.prepare(identity, digest("b"));
  await store.markSent(intent.id);
  assert.equal((await store.reconcile({ intentId: intent.id, remoteOperationId: "different", requestDigest: digest("b"), outcome: "confirmed", evidenceRefs: ["urn:usf:evidence:no"] })).status, "ambiguous");
  assert.equal(store.intents()[0]?.state, "sent");
  assert.equal((await store.reconcile({ intentId: intent.id, remoteOperationId: identity.remoteOperationId, requestDigest: digest("c"), outcome: "confirmed", evidenceRefs: ["urn:usf:evidence:no"] })).status, "ambiguous");
  const result = await store.reconcile({ intentId: intent.id, remoteOperationId: identity.remoteOperationId, requestDigest: digest("b"), outcome: "confirmed", evidenceRefs: ["urn:usf:evidence:exact"] });
  assert.equal(result.status, "reconciled");
  assert.equal(result.intent.state, "confirmed");
});

test("retains binding progress, blockers, evidence references, and cycle summary", async () => {
  const store = await LinearStateStore.open(await root());
  await store.recordProgress({ bindingIri: identity.bindingIri, stage: "blocked", blocker: "LINEAR_TEAM_UNVERIFIED", evidenceRefs: ["urn:usf:evidence:team"] }, "2026-09-07T00:00:00.000Z");
  await store.recordProgress({ bindingIri: "urn:usf:binding:two", stage: "prepared", blocker: null, evidenceRefs: [] }, "2026-09-07T00:00:01.000Z");
  const summary = store.summary();
  assert.deepEqual(summary.blockedBindings, [identity.bindingIri]);
  assert.equal(summary.progress.blocked, 1);
  assert.equal(summary.progress.prepared, 1);
  assert.equal(store.progress()[0]?.evidenceRefs[0], "urn:usf:evidence:team");
});

test("fails closed on corrupt persisted state and symlinked control paths", async () => {
  const repositoryRoot = await root();
  await mkdir(join(repositoryRoot, ".usf/hermes/linear"), { recursive: true, mode: 0o700 });
  await writeFile(join(repositoryRoot, ".usf/hermes/linear/state.json"), "{not-json", { mode: 0o600 });
  await assert.rejects(() => LinearStateStore.open(repositoryRoot), (error: unknown) => error instanceof LinearStateError && error.reasonCode === "LINEAR_STATE_CORRUPT");

  const secondRoot = await root();
  await mkdir(join(secondRoot, ".usf"), { mode: 0o700 });
  await symlink(join(tmpdir(), "outside-linear-state"), join(secondRoot, ".usf/hermes"));
  await assert.rejects(() => LinearStateStore.open(secondRoot), (error: unknown) => error instanceof LinearStateError && error.reasonCode === "LINEAR_STATE_PATH_UNSAFE");
});

test("stores bounded owner-private control records without credentials or path escape", async () => {
  const repositoryRoot = await root();
  await writeLinearRecord(repositoryRoot, "owner", { processId: 42, policyDigest: digest("d"), stopRequested: false });
  assert.deepEqual(await readLinearRecord(repositoryRoot, "owner"), { processId: 42, policyDigest: digest("d"), stopRequested: false });
  assert.equal((await lstat(join(repositoryRoot, ".usf/hermes/linear/records/owner.json"))).mode & 0o777, 0o600);
  await assert.rejects(() => writeLinearRecord(repositoryRoot, "../escape", { ok: true }), (error: unknown) => error instanceof LinearStateError && error.reasonCode === "LINEAR_STATE_RECORD_KEY_INVALID");
  await assert.rejects(() => writeLinearRecord(repositoryRoot, "owner", { authorization: "never-persist" }), (error: unknown) => error instanceof LinearStateError && error.reasonCode === "LINEAR_STATE_RECORD_INVALID");
});
