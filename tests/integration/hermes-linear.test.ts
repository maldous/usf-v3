import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compatibleLinearLanes, currentLinearBindingSelections, linearMutationLedgerSettled, runLinearLaneCycle, LinearMutations, parseHermesLinearArguments, loadLinearCredentials, hermesLinearCommand, type LinearLane } from "../../src/commands/hermes-linear.ts";
import { canonicalDigest } from "../../src/core/canonical.ts";
import { LinearStateStore } from "../../src/linear/state.ts";
import { acquireSupervisorLifetimeLock, claimStewardship, releaseStewardship, withSupervisorActivity } from "../../src/continuous/stewardship.ts";
import { linuxProcessInspector } from "../../src/continuous/lifecycle.ts";
import { observeSupervisor, registerForegroundSupervisor, unregisterForegroundSupervisor } from "../../src/commands/hermes-lifecycle.ts";
import { mergeHermesState } from "../../src/commands/hermes.ts";
import { parseStrictNQuads } from "../../src/graph/nquads.ts";

function lane(id: string, writes: string[], reads: string[] = []): LinearLane {
  return { selector: { repositoryRoot: "/unused", manifestPath: "graph/test.json", bindingIri: id },
    contextKey: id, binding: { authority: { locator: id }, unit: { packet: { id, writeSet: writes, readSet: reads, dependsOn: [] } } } } as unknown as LinearLane;
}

test("Linear lanes exclude write/read overlap and allow disjoint work", () => {
  assert.equal(compatibleLinearLanes(lane("a", ["src/a.ts"]), lane("b", ["src/b.ts"])), true);
  assert.equal(compatibleLinearLanes(lane("a", ["src/"]), lane("b", [], ["src/a.ts"])), false);
  assert.equal(compatibleLinearLanes(lane("a", ["src/a.ts"]), lane("b", ["src/a.ts"])), false);
  assert.equal(compatibleLinearLanes(lane("a", ["src/a.ts"]), lane("a", ["src/b.ts"])), false);
});

test("supersession is selected across manifests before any lane executes", () => {
  const graph = "urn:test:bindings";
  const type = (id: string) => `<urn:test:${id}> <urn:usf:predicate:type> <urn:usf:type:LinearIssueWorkBinding> <${graph}> .`;
  const sources = [{ manifestPath: "old.json", quads: parseStrictNQuads(type("old"), graph, 10) },
    { manifestPath: "new.json", quads: parseStrictNQuads(`${type("new")}\n<urn:test:new> <urn:usf:predicate:supersedesBinding> <urn:test:old> <${graph}> .`, graph, 10) }];
  assert.deepEqual(currentLinearBindingSelections(sources), [{ manifestPath: "new.json", bindingIri: "urn:test:new" }]);
  assert.deepEqual(currentLinearBindingSelections([...sources].reverse()), currentLinearBindingSelections(sources));
});

test("a prepared mutation survives restart and prevents terminal completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-linear-prepared-"));
  try {
    const store = await LinearStateStore.open(root);
    assert.equal(linearMutationLedgerSettled(store.summary()), true);
    await store.prepare({ bindingIri: "urn:test:binding", operation: "update", remoteOperationId: "urn:test:issue" }, canonicalDigest({ state: "started" }));
    assert.equal(linearMutationLedgerSettled((await LinearStateStore.open(root)).summary()), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blocked Linear work cannot stop independent lanes; active concurrency is bounded", async () => {
  let active = 0;
  let maximum = 0;
  const result = await runLinearLaneCycle([lane("a", ["a"]), lane("b", ["b"]), lane("c", ["c"])], 2, async (work) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((done) => setTimeout(done, 5));
    active -= 1;
    if (work.selector.bindingIri === "a") throw Object.assign(new Error("private provider detail"), { reasonCode: "NO_ELIGIBLE_ROUTE" });
    return { bindingIri: work.selector.bindingIri, status: "completed", evidence: ["fixture-only"] };
  });
  assert.equal(maximum, 2);
  assert.deepEqual(result.map((item) => item.status), ["blocked", "completed", "completed"]);
  assert.equal(JSON.stringify(result).includes("private provider detail"), false);
});

test("overlapping scopes serialize while independent scopes proceed", async () => {
  const active = new Set<string>();
  await runLinearLaneCycle([lane("a", ["same"]), lane("b", ["same"]), lane("c", ["other"])], 3, async (work) => {
    const id = work.selector.bindingIri;
    if (id === "a") assert.equal(active.has("b"), false);
    if (id === "b") assert.equal(active.has("a"), false);
    active.add(id);
    await new Promise((done) => setTimeout(done, 5));
    active.delete(id);
    return { bindingIri: id, status: "progress", evidence: [] };
  });
});

test("stop drains active work without starting pending lanes", async () => {
  let stop = false;
  const result = await runLinearLaneCycle([lane("a", ["a"]), lane("b", ["b"])], 1, async (work) => {
    stop = true;
    return { bindingIri: work.selector.bindingIri, status: "progress", evidence: [] };
  }, () => stop);
  assert.deepEqual(result.map((item) => item.bindingIri), ["a"]);
});

test("CLI linear lane requires exact selectors and defaults to its own governed credential file", () => {
  const args = parseHermesLinearArguments(["start", "--linear-policy", "urn:test:policy", "--manifest", "graph/test.json"]);
  assert.equal(args.envFile, ".usf/credentials/linear.env");
  assert.equal(args.maximumCycles, null);
  assert.throws(() => parseHermesLinearArguments(["start", "--linear-policy", "urn:test:policy"]));
  assert.throws(() => parseHermesLinearArguments(["start", "--linear-policy", "urn:test:policy", "--manifest", "graph/test.json", "--maximum-cycles", "0"]));
});

test("missing Linear credentials are observable without fetching or inheriting ambient credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-linear-missing-"));
  try { assert.equal(await loadLinearCredentials(root, ".usf/credentials/linear.env", ["USF_LINEAR_API_KEY"]), null); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("remote mutation restart reconciles exact readback without duplicate writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-linear-intent-"));
  let writes = 0;
  let remote: { id: string } | null = null;
  const identity = { bindingIri: "urn:test:binding", operation: "create-comment", remoteOperationId: "urn:test:issue" };
  try {
    const mutations = new LinearMutations(await LinearStateStore.open(root));
    await assert.rejects(mutations.run(identity, { body: "fixture" }, async () => remote, async (id) => {
      writes += 1;
      remote = { id };
      throw new Error("response lost");
    }));
    const restarted = new LinearMutations(await LinearStateStore.open(root));
    const result = await restarted.run(identity, { body: "fixture" }, async () => remote, async () => { writes += 1; });
    assert.deepEqual(result, remote);
    assert.equal(writes, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown remote mutation with no positive evidence never retransmits", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-linear-unknown-"));
  let writes = 0;
  const identity = { bindingIri: "urn:test:binding", operation: "update", remoteOperationId: "urn:test:issue" };
  try {
    const mutations = new LinearMutations(await LinearStateStore.open(root));
    await assert.rejects(mutations.run(identity, { state: "started" }, async () => null, async () => { writes += 1; throw new Error("timeout"); }));
    const restarted = new LinearMutations(await LinearStateStore.open(root));
    await assert.rejects(restarted.run(identity, { state: "started" }, async () => null, async () => { writes += 1; }));
    assert.equal(writes, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status and absent stop remain observational even if the policy graph moved or is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-linear-status-"));
  const selector = ["--linear-policy", "urn:test:policy", "--manifest", "graph/absent.json"];
  try {
    const status = await hermesLinearCommand(root, ["status", ...selector]);
    assert.equal((status.output as { running: boolean }).running, false);
    const stopped = await hermesLinearCommand(root, ["stop", ...selector]);
    assert.equal((stopped.output as { status: string }).status, "not-running");
    await assert.rejects(lstat(join(root, ".usf")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("foreground admission is canonically discoverable and retains lifetime exclusion after releasing its lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-linear-owner-"));
  const identity = await linuxProcessInspector.current();
  const dependencies = { controller: identity, sessionId: "linear-foreground-fixture", adapters: {
    renewalPolicy: async () => ({ defaultSeconds: 30, minimumSeconds: 30, maximumSeconds: 1800 }),
    currentSupervisor: async () => (await observeSupervisor(root)).record?.process ?? null,
    pendingTransactions: async () => [],
    acquirePrimaryMutation: async () => ({ release: async () => undefined }),
  } };
  const lifetime = await acquireSupervisorLifetimeLock(root);
  try {
    const claim = await claimStewardship(root, { agent: "linear-fixture", dependencies });
    const record = await registerForegroundSupervisor(root, { lifetime, process: identity,
      claimId: claim.record.claimId, generation: claim.record.generation, dependencies, args: [] });
    await releaseStewardship(root, claim.record.claimId, claim.record.generation, dependencies);
    assert.equal((await observeSupervisor(root)).liveness, "live");
    assert.deepEqual(await dependencies.adapters.currentSupervisor(), identity);
    await assert.rejects(acquireSupervisorLifetimeLock(root));
    let ran = false;
    await withSupervisorActivity(root, identity, async () => { ran = true; }, dependencies);
    assert.equal(ran, true);
    await unregisterForegroundSupervisor(root, record);
    assert.equal((await observeSupervisor(root)).liveness, "absent");
  } finally { await lifetime.release(); await rm(root, { recursive: true, force: true }); }
});

test("concurrent Hermes state merge retains independent results and monotonic counters without replay inflation", () => {
  const graph = "urn:usf:graph:hermes-state";
  const state = (unit: string, count: number) => parseStrictNQuads([
    `<urn:test:${unit}> <urn:usf:predicate:hermesAttemptCount> "${count}" <${graph}> .`,
    `<urn:test:${unit}> <urn:usf:predicate:executionResult> <urn:test:result-${unit}> <${graph}> .`,
    `<urn:test:result-${unit}> <urn:usf:predicate:derivedFrom> <urn:test:${unit}> <${graph}> .`,
  ].join("\n"), graph, 100);
  const first = state("a", 2);
  const staleSibling = state("b", 1);
  const merged = mergeHermesState(first, staleSibling, ["urn:test:b"]);
  assert.equal(merged.filter((quad) => quad.predicate === "urn:usf:predicate:executionResult").length, 2);
  const replay = mergeHermesState(merged, state("a", 1), ["urn:test:a"]);
  assert.deepEqual(replay, merged);
  assert.equal(replay.find((quad) => quad.subject === "urn:test:a" && quad.predicate === "urn:usf:predicate:hermesAttemptCount")?.object, "2");
});
