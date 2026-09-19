import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

test("bounded recovery uses durable normal-lane intake and authenticates original completion", () => {
  const script = String.raw`
import assert from "node:assert/strict";
import { mock } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalDigest } from "./src/core/canonical.ts";
import { LinearStateStore, readLinearRecord, writeLinearRecord } from "./src/commands/linear-state.ts";
const register = (path, namedExports) => mock.module(pathToFileURL(resolve(path)).href, { namedExports });
const forbidden = () => { throw new Error("UNEXPECTED_EXTERNAL_EFFECT"); };
const source = "urn:test:binding:source", repair = "urn:test:binding:repair";
const sourceWork = "urn:test:work:source", repairWork = "urn:test:work:repair";
const sourceProfile = "urn:test:profile:source", repairProfile = "urn:test:profile:repair";
const rule = "urn:test:recovery:rule", proposal = "urn:test:proposal:repair";
const contract = "urn:test:contract:controller";
const controller = "urn:usf:work:hermes-linear-autonomy";
const manifest = "graph/manifests/recovery-fixture.json";
const sourceIssue = "123e4567-e89b-42d3-a456-426614174001", repairIssue = "123e4567-e89b-42d3-a456-426614174002";
const teamId = "123e4567-e89b-42d3-a456-426614174003";
const invalidCommand = "node --test --test-isolation=none tests/fixture.acceptance.ts";
const validCommand = "node --test --test-isolation=none tests/fixture.test.ts";
const sourceValidation = "urn:test:validation:source", repairValidation = "urn:test:validation:repair";
const q = (subject, name, object, objectKind = "literal") => ({
  subject, predicate: "urn:usf:predicate:" + name, object, objectKind, graph: "urn:test:graph:recovery", canonical: ""
});
let current;
function reset(options = {}) {
  current = {
    options, sourceState: options.nativeSuccessor ? "PREPARED" : "SETTLED", repairState: "PREPARED",
    sourceBasis: canonicalDigest("source basis"), repairBasis: canonicalDigest("repair basis"),
    controllerBasis: canonicalDigest("controller basis"), controllerActive: true,
    command: invalidCommand, sourceDispatches: 0, repairDispatches: 0, creations: 0, comments: [],
    completions: 0, observeHook: null, authorityVersion: 1,
    issues: new Map([[sourceIssue, { id: sourceIssue, teamId, stateId: "started", assigneeId: null, priority: 1, title: "Source", description: "Source" }]]),
  };
  current.quads = [source, repair].flatMap((binding, index) => [
    q(binding, "type", "urn:usf:type:LinearIssueWorkBinding", "iri"),
    q(binding, "issueWorkspace", "fixture"), q(binding, "issueUuid", index ? repairIssue : sourceIssue),
    q(binding, "owningModel", "USF"), q(binding, "selectedProfile", index ? repairProfile : sourceProfile, "iri"),
    q(binding, "targetManifest", manifest), q(binding, "workIri", index ? repairWork : sourceWork, "iri"),
    q(binding, "fixedPrompt", "Only the explicitly authorised fixture repair."),
    q(binding, "maximumPromptTokens", "10000"),
  ]);
  if (!options.noRule) current.quads.push(
    q(rule, "type", "urn:usf:type:HermesFailureRecoveryRule", "iri"),
    q(rule, "forContract", options.wrongContract ? "urn:test:contract:unrelated" : contract, "iri"),
    q(rule, "sourceWork", sourceWork, "iri"), q(rule, "failureClass", "CHECK_COMMAND_CONTRACT_INVALID"),
    q(rule, "repairBinding", options.selfRoute ? source : repair, "iri"),
    q(rule, "maximumRepairAttempts", String(options.budget ?? 1)),
    q(rule, "repairProposal", proposal, "iri"),
  );
  current.quads.push(
    q(proposal, "type", "urn:usf:type:LinearIssueProposal", "iri"),
    q(proposal, "issueWorkspace", "fixture"), q(proposal, "issueTeamUuid", teamId),
    q(proposal, "owningModel", "USF"), q(proposal, "issueUuid", repairIssue),
    q(proposal, "title", "Repair declared validation contract"), q(proposal, "description", "Only the authorised fixture repair."),
    q(proposal, "targetManifest", manifest), q(proposal, "workIri", repairWork, "iri"), q(proposal, "selectedProfile", repairProfile, "iri"),
    q(sourceValidation, "command", invalidCommand), q(repairValidation, "command", validCommand),
  );
}
function graph() { return { quads: current.quads }; }
function packet(work) {
  if (work === controller) return {
    id: controller, contract, realisationBasis: { basisDigest: current.controllerBasis },
    eligibility: { construction: { eligible: current.controllerActive } },
realisationStage: { completion: { verified: current.controllerActive && !current.options.constructionOnly } },
  };
  const isRepair = work === repairWork, basis = isRepair ? current.repairBasis : current.sourceBasis;
  const state = isRepair ? current.repairState : current.sourceState;
  return {
    id: work, realisationBasis: { basisDigest: basis }, contract: "urn:test:contract:" + (isRepair ? "repair" : "source"),
    eligibility: { construction: { eligible: true } }, realisationStage: { completion: { verified: state === "COMPLETED" } },
    readSet: [], writeSet: [isRepair ? "graph/fixture.nq" : "src/help.ts"], dependsOn: [],
    semanticDependencies: [], modelCapabilities: [], privacy: "public",
    validationPlan: [{ id: isRepair ? repairValidation : sourceValidation, command: isRepair ? validCommand : current.command }],
  };
}
function observed(bindingIri) {
  const isRepair = bindingIri === repair, work = isRepair ? repairWork : sourceWork;
  const basis = isRepair ? current.repairBasis : current.sourceBasis, status = isRepair ? current.repairState : current.sourceState;
  const authority = {
    bindingIri, workIri: work, targetManifest: manifest, profile: isRepair ? repairProfile : sourceProfile,
    locator: "fixture:" + (isRepair ? repairIssue : sourceIssue), workspace: "fixture",
    owner: "USF", issueUuid: isRepair ? repairIssue : sourceIssue, fixedPrompt: "Authority " + current.authorityVersion,
    ...(current.options.nativeSuccessor && !isRepair ? {
      realisationDisposition: "no-change", supersedes: "urn:test:binding:source:predecessor",
    } : {}),
  };
  return {
    status, binding: {
      selector: { repositoryRoot: "/unused", manifestPath: manifest, bindingIri }, authority,
      basis: { basisDigest: basis }, attempt: { state: status === "COMPLETED" ? "SETTLED" : status },
      unit: { attemptKey: canonicalDigest([bindingIri, basis]), intentKey: canonicalDigest(bindingIri), basisDigest: basis,
        manifestPath: manifest, workIri: work, profile: authority.profile, packet: packet(work) },
    },
    ...(status === "COMPLETED" ? { integrationReceipt: "urn:test:integration:" + bindingIri,
      evidence: "urn:test:evidence:" + bindingIri, proofResult: "urn:test:proof:" + bindingIri } : {}),
  };
}
function failure() {
  return { status: "refused", reasonCode: "CHECK_COMMAND_CONTRACT_INVALID", evidence: { checkpointPath: "fixture-checkpoint" },
    failure: { phase: "validation", validationIri: sourceValidation, candidateDigest: canonicalDigest("candidate"),
      reasonCode: "CHECK_COMMAND_CONTRACT_INVALID", resultDigest: canonicalDigest("typed native refusal"),
      confinementFailure: null, commandContract: { status: "invalid", reasonCode: "CHECK_COMMAND_CONTRACT_INVALID",
        detail: "TEST_PATH_INVALID", invalidPaths: ["tests/fixture.acceptance.ts"] } } };
}
function changeCommand(command) {
  current.command = command;
  current.quads.find(row => row.subject === sourceValidation && row.predicate.endsWith(":command")).object = command;
}
const policy = {
  schema: "urn:usf:hermes-linear-policy:1", endpoint: "https://api.linear.app/graphql",
  bindingManifests: [manifest], pageSize: 50, maxPages: 2, maximumIssuesPerCycle: 100,
  allowCreate: true, allowUpdate: true, timeoutMs: 1000, maxResponseBytes: 4096, pollSeconds: 1,
  workspaces: [{ key: "USF", organizationUrlKey: "fixture", credentialName: "USF_LINEAR_API_KEY", authScheme: "api-key",
    teams: [{ id: teamId, owner: "USF", assigneeId: null, startedStateId: "started", completedStateId: "completed", blockedStateId: null }] }],
};
register("src/graph/index.ts", { loadSemanticGraph: graph,
  objectValues: (g, subject, predicate) => g.quads.filter(row => row.subject === subject && row.predicate === predicate).map(row => row.object) });
register("src/graph/work.ts", { deriveWork: (_graph, selection) => ({ status: "ok", items: [packet(selection.selector)] }) });
register("src/commands/linear-binding.ts", { observeLinearBinding: async selector => {
  const result = observed(selector.bindingIri);
  if (current.observeHook) { const hook = current.observeHook; current.observeHook = null; await hook(); }
  return result;
} });
register("src/commands/linear-delivery.ts", { executeLinearDelivery: async (_root, selector) => {
  if (selector.bindingIri === source) {
    current.sourceDispatches++;
    if (current.options.nativeRetryCompletes) {
      current.sourceState = "COMPLETED";
      return { status: "completed", evidence: { checkpointPath: "native-successor-completion" } };
    }
    return failure();
  }
  assert.equal(selector.bindingIri, repair);
  current.repairDispatches++;
  current.repairState = "COMPLETED";
  if (current.options.repairCompletesSource) {
    changeCommand(validCommand);
    current.sourceBasis = canonicalDigest("independently authenticated current source completion");
    current.sourceState = "COMPLETED";
  }
  return { status: "completed", evidence: { checkpointPath: "repair-completion" } };
} });
register("src/providers/config.ts", { loadCredentialEnvFile: forbidden });
register("src/commands/linear-client.ts", { readLinearPolicySource: forbidden, parseLinearPolicy: forbidden,
  LinearClient: class {
    async discoverTeamIssues() { return [...current.issues.values()].filter(issue => issue.stateId !== "completed"); }
    async getIssue(id) { return current.issues.get(id) ?? null; }
    async workflowStates() { return [{ id: "started", type: "started" }, { id: "completed", type: "completed" }]; }
    async createIssue(input) {
      current.creations++;
      assert.equal(current.creations, 1, "repair intake must not create twice across restart");
      current.issues.set(input.id, { ...input, stateId: "started", assigneeId: null, priority: 1 });
    }
    async findComment(_issue, _team, body) { return current.comments.find(comment => comment.body === body) ?? null; }
    async createComment(input) { current.comments.push({ id: "comment-" + current.comments.length, ...input }); }
    async findCommentRequestMatches() { return []; }
    async updateIssue(input) {
      if (input.stateId === "completed") current.completions++;
      current.issues.set(input.id, { ...current.issues.get(input.id), ...input });
    }
  },
});
register("src/continuous/lifecycle.ts", { linuxProcessInspector: forbidden });
register("src/continuous/stewardship.ts", { acquireSupervisorLifetimeLock: forbidden, claimStewardship: forbidden,
  releaseStewardship: forbidden, withSupervisorActivity: forbidden });
register("src/commands/hermes-stewardship.ts", { currentStewardshipDependencies: forbidden });
register("src/commands/hermes-supervisor-foreground.ts", { registerForegroundSupervisor: forbidden,
  unregisterForegroundSupervisor: forbidden, foregroundSupervisorStopRequested: forbidden });
register("src/graph/runtime-authority.ts", { readRuntimeAuthority: forbidden });
const autonomy = await import("./src/commands/hermes-linear-autonomy.ts");
const foreground = await import("./src/commands/hermes-linear.ts");
const roots = [];
async function fresh(options = {}) {
  reset(options);
  const root = await mkdtemp(join(tmpdir(), "usf-failure-recovery-"));
  roots.push(root);
  return { root, store: await LinearStateStore.open(root) };
}
async function cycle(root, store, runtime = autonomy) { return runtime.runHermesLinearCycle(root, policy, {}, store, ".usf/credentials/providers.env", 2, () => false); }
let checked = 0;
try {
  // This assertion also serves as the external red-before-green control against the old cycle.
  const firstFixture = await fresh({ repairCompletesSource: true });
  const first = await cycle(firstFixture.root, firstFixture.store);
  assert.equal(current.repairDispatches, 0, "repair must be gated until an authenticated failure intake exists");
  assert.equal(first.outcomes.find(item => item.bindingIri === source)?.recovery?.disposition, "awaiting-repair");
  assert.equal(current.creations, 0, "repair proposal cannot run before intake");
  assert.equal(current.sourceDispatches, 1);
  checked++;
  assert.equal(foreground.runHermesLinearCycle, autonomy.runHermesLinearCycle, "both runtimes must share cycle implementation");
  assert.equal(foreground.LinearMutations, autonomy.LinearMutations);
  checked++;
  const second = await cycle(firstFixture.root, await LinearStateStore.open(firstFixture.root), foreground);
  assert.equal(current.creations, 1);
  assert.equal(current.repairDispatches, 1, "normal supervisor scheduler executes the declared repair");
  assert.equal(current.sourceDispatches, 1, "blocked source must not replay");
  assert.equal(second.outcomes.find(item => item.bindingIri === repair)?.recovery?.externalBoundary, "authority",
    "an in-cycle graph change cannot inherit the old currentness observation");
  checked++;
  const third = await cycle(firstFixture.root, await LinearStateStore.open(firstFixture.root));
  assert.equal(third.outcomes.find(item => item.bindingIri === source)?.status, "completed", JSON.stringify(third));
  assert.equal(third.outcomes.find(item => item.bindingIri === source)?.recovery?.disposition, "completed");
  assert.equal(current.completions, 2, "original and repair remote states use current native completion");
  const counts = [current.sourceDispatches, current.repairDispatches, current.creations, current.comments.length, current.completions];
  const unrelatedIssue = "123e4567-e89b-42d3-a456-426614174099";
  current.issues.set(unrelatedIssue, { id: unrelatedIssue, teamId, stateId: "started", assigneeId: null, priority: 5,
    title: "Unrelated coordination issue", description: "Not graph-authored work." });
  const fourth = await cycle(firstFixture.root, await LinearStateStore.open(firstFixture.root), foreground);
  assert.deepEqual([current.sourceDispatches, current.repairDispatches, current.creations, current.comments.length, current.completions], counts);
  assert.deepEqual(fourth.unboundIssueLocators, ["fixture:" + unrelatedIssue]);
  assert.equal(fourth.terminal, true, JSON.stringify(fourth));
  checked += 2;
  const { LinearFailureRecovery, deriveLinearRecoveryRules } = await import("./src/commands/linear-remediation.ts");
  async function setup(options = {}) {
    const fixture = await fresh(options);
    const discovered = await autonomy.discoverLinearLanes(fixture.root, policy.bindingManifests);
    const lanes = options.noRepairLane ? discovered.lanes.filter(lane => lane.selector.bindingIri === source) : discovered.lanes;
    const sourceLane = lanes.find(lane => lane.selector.bindingIri === source);
    const coordinator = new LinearFailureRecovery(fixture.root, policy, fixture.store);
    await coordinator.plan(lanes);
    return { ...fixture, lanes, sourceLane, coordinator };
  }
  async function retained(options = {}) {
    const fixture = await setup(options);
    const outcome = await fixture.coordinator.retain(fixture.sourceLane, failure());
    return { ...fixture, outcome };
  }
  const errors = [
    [{ noRule: true }, "LINEAR_RECOVERY_RULE_AUTHORITY_MISSING"],
    [{ wrongContract: true }, "LINEAR_RECOVERY_CONTROLLER_AUTHORITY_MISSING"],
    [{ noRepairLane: true }, "LINEAR_RECOVERY_REPAIR_BINDING_MISSING"],
    [{ selfRoute: true }, "LINEAR_RECOVERY_LINEAGE_AMBIGUOUS"],
    [{ budget: 0 }, "LINEAR_RECOVERY_POLICY_INVALID"],
    [{ budget: 5 }, "LINEAR_RECOVERY_POLICY_INVALID"],
  ];
  for (const [options, expected] of errors) {
    const fixture = await retained(options);
    assert.equal(fixture.outcome.disposition, "escalated");
    assert.equal(fixture.outcome.reasonCode, expected, JSON.stringify(options));
    assert.equal(current.repairDispatches + current.creations, 0);
    checked++;
  }
  {
    const fixture = await retained({ constructionOnly: true });
    assert.equal(fixture.outcome.disposition, "awaiting-repair", "ordinary construction authority admits bounded recovery");
    const lane = fixture.lanes.find(item => item.selector.bindingIri === repair);
    await fixture.coordinator.beforeLane(lane);
    assert.equal((await readLinearRecord(fixture.root, fixture.outcome.intakeKey)).attempts, 1);
    assert.equal(current.repairDispatches + current.creations, 0, "admission is not direct dispatch");
    checked++;
  }
  {
    const fixture = await setup();
    current.controllerActive = false;
    const result = await fixture.coordinator.retain(fixture.sourceLane, failure());
    assert.equal(result.reasonCode, "LINEAR_RECOVERY_CONTROLLER_AUTHORITY_MISSING");
    checked++;
  }
  for (const state of ["STARTED", "UNKNOWN"]) {
    const fixture = await setup();
    current.repairState = state;
    const result = await fixture.coordinator.retain(fixture.sourceLane, failure());
    assert.equal(result.reasonCode, "LINEAR_RECOVERY_ATTEMPT_UNKNOWN");
    checked++;
  }
  for (const bindingIri of [source, repair, proposal]) {
    const fixture = await setup();
    const intent = await fixture.store.prepare({ bindingIri, operation: "create-issue", remoteOperationId: repairIssue }, canonicalDigest("uncertain remote request"));
    await fixture.store.markSent(intent.id); await fixture.store.markUnknown(intent.id);
    const result = await fixture.coordinator.retain(fixture.sourceLane, failure());
    assert.equal(result.reasonCode, "LINEAR_RECOVERY_REMOTE_INTENT_UNKNOWN");
    assert.deepEqual(fixture.store.summary().pendingUnknownIntentIds, [intent.id]);
    checked++;
  }
  {
    const fixture = await setup({ nativeSuccessor: true });
    const outcome = await fixture.coordinator.retain(fixture.sourceLane, {
      status: "refused", reasonCode: "LINEAR_BINDING_NATIVE_COMPLETION_STATE_INVALID",
      evidence: { checkpointPath: "native-pre-effect-checkpoint" }, failure: null,
    });
    assert.deepEqual(outcome, {
      disposition: "resume-ready", reasonCode: "LINEAR_RECOVERY_NATIVE_PRE_EFFECT_RETRY_ADMITTED",
      externalBoundary: "normal-supervisor",
    }, "an exact current PREPARED no-change successor may cross the repaired pre-effect boundary once");
    checked++;
  }
  {
    const fixture = await setup({ nativeSuccessor: true });
    await fixture.coordinator.retain(fixture.sourceLane, {
      status: "refused", reasonCode: "LINEAR_BINDING_NATIVE_COMPLETION_STATE_INVALID",
      evidence: { checkpointPath: "old-kernel-pre-effect-refusal" }, failure: null,
    });
    current.options.nativeRetryCompletes = true;
    const resumed = await cycle(fixture.root, await LinearStateStore.open(fixture.root));
    assert.equal(resumed.outcomes.find(item => item.bindingIri === source)?.status, "completed", JSON.stringify(resumed));
    assert.equal(current.sourceDispatches, 1, "the ordinary scheduler must invoke the repaired native successor");
    const effects = [current.sourceDispatches, current.completions, current.comments.length];
    const retained = await cycle(fixture.root, await LinearStateStore.open(fixture.root), foreground);
    assert.equal(retained.outcomes.find(item => item.bindingIri === source)?.status, "completed", JSON.stringify(retained));
    assert.deepEqual([current.sourceDispatches, current.completions, current.comments.length], effects,
      "a later normal cycle must retain completion without redispatching or repeating remote effects");
    checked++;
  }
  {
    const fixture = await setup();
    const outcome = await fixture.coordinator.retain(fixture.sourceLane, {
      status: "refused", reasonCode: "LINEAR_BINDING_NATIVE_COMPLETION_STATE_INVALID",
      evidence: { checkpointPath: "non-native-checkpoint" }, failure: null,
    });
    assert.equal(outcome.reasonCode, "LINEAR_RECOVERY_NATIVE_PRE_EFFECT_UNPROVEN",
      "ordinary or non-PREPARED work cannot inherit native retry admission");
    checked++;
  }
  {
    const fixture = await setup();
    const value = failure(); value.reasonCode = "CHECK_TIMEOUT"; value.failure.reasonCode = "CHECK_TIMEOUT";
    assert.equal((await fixture.coordinator.retain(fixture.sourceLane, value)).reasonCode, "LINEAR_RECOVERY_FAILURE_UNKNOWN");
    checked++;
  }
  {
    const fixture = await setup();
    changeCommand(validCommand);
    const value = failure(); value.reasonCode = "CHECK_CONFINEMENT_UNAVAILABLE"; value.failure = null;
    const lanes = (await autonomy.discoverLinearLanes(fixture.root, policy.bindingManifests)).lanes;
    await fixture.coordinator.plan(lanes);
    assert.equal((await fixture.coordinator.retain(lanes.find(lane => lane.selector.bindingIri === source), value)).reasonCode,
      "LINEAR_RECOVERY_FAILURE_NOT_REPRODUCED", "generic confinement/prose is not a reproduced command defect");
    checked++;
  }
  for (const mode of ["basis-moved", "defect-remains", "marker-only", "dispatch-interrupted", "budget-exhausted", "rule-changed", "tampered-intake"]) {
    const fixture = await retained();
    assert.equal(fixture.outcome.disposition, "awaiting-repair");
    const intakeKey = fixture.outcome.intakeKey;
    const original = await readLinearRecord(fixture.root, intakeKey);
    if (mode === "basis-moved") { current.sourceBasis = canonicalDigest("changed source basis"); current.repairState = "COMPLETED"; changeCommand(validCommand); }
    if (mode === "defect-remains") current.repairState = "COMPLETED";
    if (mode === "marker-only") await fixture.store.recordProgress({ bindingIri: repair, basisDigest: current.repairBasis, stage: "completed", blocker: null, evidenceRefs: ["urn:test:untrusted-progress"] });
    if (mode === "dispatch-interrupted" || mode === "budget-exhausted") {
      await fixture.coordinator.beforeLane(fixture.lanes.find(lane => lane.selector.bindingIri === repair));
      if (mode === "budget-exhausted") {
        current.repairState = "SETTLED";
        await fixture.store.recordProgress({ bindingIri: repair, basisDigest: current.repairBasis, stage: "blocked", blocker: "CHECK_FAILED", evidenceRefs: [] });
      }
    }
    if (mode === "rule-changed") current.quads.find(row => row.subject === rule && row.predicate.endsWith(":maximumRepairAttempts")).object = "2";
    if (mode === "tampered-intake") await writeLinearRecord(fixture.root, intakeKey, { ...original, attempts: 2 });
    const reopened = await LinearStateStore.open(fixture.root);
    const coordinator = new LinearFailureRecovery(fixture.root, policy, reopened);
    await coordinator.plan((await autonomy.discoverLinearLanes(fixture.root, policy.bindingManifests)).lanes);
    const disposition = coordinator.dispositions.get(source);
    const expected = {
      "basis-moved": "LINEAR_RECOVERY_SOURCE_BASIS_CHANGED",
      "defect-remains": "LINEAR_RECOVERY_REPAIR_POSTCONDITION_UNMET",
      "marker-only": "LINEAR_RECOVERY_QUEUED",
      "dispatch-interrupted": "LINEAR_RECOVERY_DISPATCH_INTERRUPTED",
      "budget-exhausted": "LINEAR_RECOVERY_REPAIR_BUDGET_EXHAUSTED",
      "rule-changed": "LINEAR_RECOVERY_INTAKE_AUTHORITY_CHANGED",
      "tampered-intake": "LINEAR_RECOVERY_INTAKE_AUTHORITY_CHANGED",
    }[mode];
    assert.equal(disposition?.reasonCode, expected, mode);
    assert.equal(current.sourceDispatches + current.repairDispatches, 0);
    if (mode === "marker-only") assert.equal(disposition.disposition, "awaiting-repair", "progress cannot authenticate completion");
    checked++;
  }
  {
    const fixture = await retained();
    const firstIntake = await readLinearRecord(fixture.root, fixture.outcome.intakeKey);
    const reopened = new LinearFailureRecovery(fixture.root, policy, await LinearStateStore.open(fixture.root));
    await reopened.plan(fixture.lanes);
    assert.deepEqual(await readLinearRecord(fixture.root, fixture.outcome.intakeKey), firstIntake, "restart must retain exact intake and budget");
    assert.equal(reopened.dispositions.get(source)?.intakeKey, fixture.outcome.intakeKey);
    checked++;
  }
  for (const mutation of ["rule", "controller", "binding", "source-basis"]) {
    const fixture = await retained();
    const mutations = new autonomy.LinearMutations(fixture.store);
    const guard = fixture.coordinator.guardFor(proposal);
    let sends = 0;
    await assert.rejects(mutations.run({ bindingIri: proposal, operation: "fixture-race", remoteOperationId: repairIssue },
      { id: repairIssue }, async () => {
        if (mutation === "rule") current.quads.find(row => row.subject === rule && row.predicate.endsWith(":maximumRepairAttempts")).object = "2";
        if (mutation === "controller") current.controllerActive = false;
        if (mutation === "binding") current.authorityVersion++;
        if (mutation === "source-basis") current.sourceBasis = canonicalDigest("changed after readback");
        return { id: repairIssue };
      }, async () => { sends++; }, guard), error => /LINEAR_RECOVERY_/u.test(error.reasonCode));
    assert.equal(sends, 1);
    assert.equal(fixture.store.summary().intents.confirmed, 0, "post-await drift cannot confirm the remote intent");
    assert.equal(fixture.store.summary().intents.sent, 1, "retain the exact uncertain effect for reconciliation");
    checked++;
  }
  {
    const fixture = await retained();
    current.observeHook = async () => { current.controllerActive = false; };
    await assert.rejects(fixture.coordinator.beforeLane(fixture.lanes.find(lane => lane.selector.bindingIri === repair)),
      error => error.reasonCode === "LINEAR_RECOVERY_CONTROLLER_AUTHORITY_MISSING");
    assert.equal((await readLinearRecord(fixture.root, fixture.outcome.intakeKey)).attempts, 0);
    checked++;
  }
  {
    await fresh();
    const duplicate = current.quads.filter(row => row.subject === rule).map(row => ({ ...row, subject: rule + ":duplicate" }));
    assert.throws(() => deriveLinearRecoveryRules([{ quads: [...current.quads, ...duplicate] }]),
      error => error.reasonCode === "LINEAR_RECOVERY_LINEAGE_AMBIGUOUS");
    checked++;
  }
  console.log(JSON.stringify({ checked, sharedCycle: true, nativeAuthenticationMocked: true, liveEffects: 0 }));
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
`;
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
    cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.checked, 37);
  assert.equal(report.sharedCycle, true);
  assert.equal(report.nativeAuthenticationMocked, true);
  assert.equal(report.liveEffects, 0);
});

test("delivery authenticates graph command preflight before providers and preserves later typed failures", () => {
  const script = String.raw`
import assert from "node:assert/strict";
import { mock } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalDigest } from "./src/core/canonical.ts";
const register = (path, namedExports) => mock.module(pathToFileURL(resolve(path)).href, { namedExports });
const forbidden = () => { throw new Error("UNEXPECTED_EFFECT"); };
const basisDigest = canonicalDigest("source basis"), candidateDigest = canonicalDigest("candidate");
const validation = "urn:test:validation:preflight";
let command = "node --test --test-isolation=none tests/fixture.acceptance.ts", stale = false, providerCalls = 0, checkCalls = 0;
let settled = false, reachCheck = false;
const authority = { bindingIri: "urn:test:binding:preflight", workIri: "urn:test:work:preflight",
  profile: "urn:test:profile:preflight", targetManifest: "graph/manifests/preflight.json" };
const selector = { repositoryRoot: "/fixture", bindingIri: authority.bindingIri, manifestPath: "graph/manifests/bindings.json" };
function packet() { return { id: authority.workIri, realisationBasis: { basisDigest: stale ? canonicalDigest("stale") : basisDigest },
  eligibility: { construction: { eligible: true } }, realisationStage: { completion: { verified: false } },
  validationPlan: [{ id: validation, command }] }; }
function observed() { return { status: settled ? "SETTLED" : "PREPARED", binding: { authority, basis: { basisDigest },
  attempt: { executionResultDigest: canonicalDigest("result") },
  unit: { attemptKey: canonicalDigest("attempt"), basisDigest, manifestPath: authority.targetManifest, packet: packet() } } }; }
const contract = { status: "invalid", reasonCode: "CHECK_COMMAND_CONTRACT_INVALID", detail: "TEST_PATH_INVALID", invalidPaths: ["tests/fixture.acceptance.ts"] };
register("src/graph/index.ts", { loadSemanticGraph: () => ({ quads: [
  { subject: validation, predicate: "urn:usf:predicate:command", object: command, objectKind: "literal" },
] }) });
register("src/graph/work.ts", { deriveWork: () => ({ status: "ok", items: [packet()] }) });
register("src/commands/apply.ts", { apply: async () => ({ status: "applied" }), integrateCommandHandler: forbidden });
register("src/commands/check.ts", { runGraphDerivedCheck: async () => {
  checkCalls++; return { status: "refused", reasonCode: contract.reasonCode, id: validation, commandContract: contract };
} });
register("src/commands/construction-authority.ts", { constructionAwarePublishCommandHandler: forbidden, evidenceCommandHandler: forbidden, proveCommandHandler: forbidden });
register("src/commands/hermes.ts", { hermesCommand: async () => {
  providerCalls++;
  if (!reachCheck) throw Object.assign(new Error("PROVIDER_SENTINEL"), { reasonCode: "PROVIDER_SENTINEL" });
  settled = true;
} });
register("src/commands/linear-binding.ts", { observeLinearBinding: async () => observed(), prepareLinearBinding: async () => observed(), withNativeLinearCompletion: forbidden });
register("src/commands/resolve.ts", { resolveCommand: () => ({ status: "resolved", candidate: {
  identity: { artifactDigest: candidateDigest }, payload: { operations: [] }, basis: { basisDigest }, lineage: [],
} }) });
register("src/commands/work-completion.ts", { completionAwareEvidenceCommandHandler: forbidden, completionAwareProveCommandHandler: forbidden,
  completionAwarePublishCommandHandler: forbidden, realiseCommandHandler: forbidden });
register("src/commands/linear-contribution.ts", { contributionFromSettledLinearResult: async () => ({}) });
register("src/commands/linear-state.ts", { readLinearRecord: async () => null, writeLinearRecord: async () => {} });
register("src/realisation/index.ts", { candidateScope: () => ({}), deriveCandidatePreimages: async () => ({}) });
const { executeLinearDelivery } = await import("./src/commands/linear-delivery.ts");
const invalid = await executeLinearDelivery("/fixture", selector, ".usf/credentials/providers.env");
assert.equal(invalid.status, "refused");
assert.equal(invalid.reasonCode, "CHECK_COMMAND_CONTRACT_INVALID");
assert.equal(invalid.failure?.phase, "admission-validation");
assert.equal(invalid.failure?.candidateDigest, null);
assert.deepEqual(invalid.failure?.commandContract, contract);
assert.equal(providerCalls + checkCalls, 0, "invalid graph command must fail before provider/host work");
stale = true;
assert.equal((await executeLinearDelivery("/fixture", selector, ".usf/credentials/providers.env")).reasonCode, "LINEAR_BINDING_BASIS_NONCURRENT");
assert.equal(providerCalls, 0, "a changed basis cannot establish command admission");
stale = false; command = "node --test --test-isolation=none tests/fixture.test.ts";
assert.equal((await executeLinearDelivery("/fixture", selector, ".usf/credentials/providers.env")).reasonCode, "PROVIDER_SENTINEL");
assert.equal(providerCalls, 1, "valid current commands must reach the existing provider boundary");
reachCheck = true;
const late = await executeLinearDelivery("/fixture", selector, ".usf/credentials/providers.env");
assert.equal(late.reasonCode, "CHECK_COMMAND_CONTRACT_INVALID");
assert.equal(late.failure?.phase, "validation");
assert.equal(late.failure?.candidateDigest, candidateDigest);
assert.deepEqual(late.failure?.commandContract, contract);
assert.equal(checkCalls, 1);
console.log(JSON.stringify({ checked: 4, providerCalls, checkCalls, liveEffects: 0 }));
`;
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
    cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8", timeout: 15000, maxBuffer: 256 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { checked: 4, providerCalls: 2, checkCalls: 1, liveEffects: 0 });
});
