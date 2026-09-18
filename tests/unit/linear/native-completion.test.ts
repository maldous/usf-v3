import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const sourceRoot = resolve(import.meta.dirname, "../../..");

function scenario(options: Record<string, unknown> = {}): { outcome: any; calls: string[] } {
  const script = `
    import { mock } from "node:test";
    import { pathToFileURL } from "node:url";
    import { resolve } from "node:path";
    const options = ${JSON.stringify(options)};
    const calls = [];
    const digest = "sha256:" + "a".repeat(64);
    const forbidden = name => async () => { calls.push(name); throw Object.assign(new Error(name), { reasonCode: "TEST_FORBIDDEN_" + name.toUpperCase() }); };
    const binding = {
      authority: { bindingIri: "urn:test:binding", workIri: "urn:test:work",
        profile: "urn:test:profile:1", targetManifest: "graph/manifests/test.json",
        ...(options.legacy ? {} : { realisationDisposition: "no-change" }) },
      basis: { basisDigest: digest },
      unit: {
        attemptKey: digest, basisDigest: digest,
        profile: "urn:test:profile:1", manifestPath: "graph/manifests/test.json", workIri: "urn:test:work",
        packet: { validationPlan: ["a", "b"].map(name => ({
          id: "urn:test:validation:" + name,
          command: "node --test --test-isolation=none tests/fixture-" + name + ".test.ts"
        })), realisationAuthority: {
          completionValidationObligations: options.noValidations ? [] : ["urn:test:validation:b", "urn:test:validation:a", "urn:test:validation:b"],
          completionProofObligation: options.noProof ? null : "urn:test:proof"
        }}
      }
    };
    const prepared = { status: options.preparedStatus ?? "PREPARED", binding };
    const register = (path, namedExports) => mock.module(pathToFileURL(resolve(path)).href, { namedExports });
    register("src/graph/index.ts", { loadSemanticGraph: () => ({ quads: binding.unit.packet.validationPlan.map(validation => ({
      subject: validation.id, predicate: "urn:usf:predicate:command",
      object: validation.command, objectKind: "literal"
    })) }) });
    register("src/graph/work.ts", { deriveWork: () => ({ status: "ok", items: [{
      ...binding.unit.packet, realisationBasis: binding.basis,
      eligibility: { construction: { eligible: true } }, realisationStage: { completion: { verified: false } }
    }] }) });
    register("src/commands/apply.ts", { apply: forbidden("apply-candidate"), integrateCommandHandler: forbidden("integrate") });
    register("src/commands/check.ts", { runGraphDerivedCheck: async (_root, candidate, validation) => {
      calls.push("check:" + validation);
      if (candidate !== digest) throw new Error("WRONG_CANDIDATE");
      if (options.checkFailure === validation) return { status: "refused", reasonCode: "CHECK_FIXTURE_REFUSAL" };
      return { status: "pass", receiptPath: ".usf/receipts/" + validation.split(":").at(-1) + ".json" };
    }});
    register("src/commands/construction-authority.ts", {
      constructionAwarePublishCommandHandler: forbidden("construction-publication"),
      evidenceCommandHandler: forbidden("construction-evidence"),
      proveCommandHandler: forbidden("construction-proof")
    });
    register("src/commands/hermes.ts", { hermesCommand: forbidden("provider") });
    register("src/commands/linear-binding.ts", {
      prepareLinearBinding: async () => { calls.push("prepare"); return prepared; },
      observeLinearBinding: async () => { calls.push("readback"); return { status: options.readbackStatus ?? "COMPLETED", binding }; },
      withNativeLinearCompletion: async (_selector, expectedAttemptKey, effect) => {
        calls.push("ownership");
        if (expectedAttemptKey !== digest) throw new Error("WRONG_ATTEMPT");
        if (options.ownershipFailure) throw Object.assign(new Error("busy"), { reasonCode: "LINEAR_BINDING_NATIVE_COMPLETION_BUSY" });
        const result = await effect(prepared);
        calls.push("settle-native");
        if (options.settlementFailure) throw Object.assign(new Error("unproven"), { reasonCode: "LINEAR_BINDING_NATIVE_COMPLETION_UNPROVEN" });
        return { result, binding: { status: "COMPLETED", binding } };
      }
    });
    register("src/commands/resolve.ts", { resolveCommand: forbidden("resolve") });
    register("src/commands/work-completion.ts", {
      realiseCommandHandler: async request => {
        calls.push("realise");
        if (!request.args.includes("urn:test:work") || !request.args.includes("graph/manifests/test.json")) throw new Error("WRONG_SELECTION");
        if (options.policyFailure) return { exitCode: 1, output: { schema: "urn:usf:cli-error:1", reasonCode: "WORK_COMPLETION_POLICY_INVALID" } };
        return { exitCode: options.realiseExitCode ?? 0, output: { schema: "urn:usf:no-change-realisation-result:1", candidateDigest: digest } };
      },
      completionAwareEvidenceCommandHandler: async request => {
        calls.push("evidence");
        if (!request.args.includes(digest)) throw new Error("WRONG_EVIDENCE_CANDIDATE");
        return { exitCode: options.evidenceExitCode ?? 0, output: { schema: options.badEvidence ? "wrong" : "urn:usf:completion-evidence-candidate:1" } };
      },
      completionAwareProveCommandHandler: async () => {
        calls.push("proof");
        return { exitCode: 0, output: { schema: options.badProof ? "wrong" : "urn:usf:completion-proof-bundle:1" } };
      },
      completionAwarePublishCommandHandler: async request => {
        const mode = request.args.includes("--verify") ? "verify" : "apply";
        calls.push(mode);
        return { exitCode: options.publicationFailure === mode ? 1 : 0, output: {
          status: options.publicationFailure === mode ? "refused" : "verified",
          mode, reasonCode: options.publicationFailure === mode ? "PUBLICATION_FIXTURE_REFUSAL" : undefined
        }};
      }
    });
    register("src/commands/linear-contribution.ts", { contributionFromSettledLinearResult: forbidden("contribution") });
    const records = new Map();
    register("src/commands/linear-state.ts", {
      readLinearRecord: async (_root, key) => records.get(key) ?? null,
      writeLinearRecord: async (_root, key, value) => { calls.push("checkpoint:" + value.phase); records.set(key, value); }
    });
    register("src/realisation/index.ts", { candidateScope: forbidden("candidate-scope"), deriveCandidatePreimages: forbidden("candidate-preimages") });
    const { executeLinearDelivery } = await import(pathToFileURL(resolve("src/commands/linear-delivery.ts")).href);
    const outcome = await executeLinearDelivery(process.cwd(), {
      repositoryRoot: process.cwd(), manifestPath: "graph/manifests/test-bindings.json", bindingIri: "urn:test:binding"
    }, ".usf/credentials/providers.env");
    process.stdout.write(JSON.stringify({ outcome, calls }));
  `;
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
    cwd: sourceRoot, encoding: "utf8", timeout: 10000, maxBuffer: 512 * 1024,
    env: {
      PATH: process.env.PATH ?? "/usr/bin",
      ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
    },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("native no-change completes all obligations without provider or integration dispatch", () => {
  const { outcome, calls } = scenario();
  assert.equal(outcome.status, "completed");
  assert.deepEqual(calls.filter(call => !call.startsWith("checkpoint:")), [
    "prepare", "ownership", "realise", "check:urn:test:validation:a", "check:urn:test:validation:b",
    "evidence", "proof", "verify", "apply", "settle-native", "readback",
  ]);
  assert.equal(outcome.evidence.settledStatus, "COMPLETED");
});

test("native no-change missing policy refuses before checks or publication", () => {
  const { outcome, calls } = scenario({ policyFailure: true });
  assert.equal(outcome.status, "refused");
  assert.equal(outcome.reasonCode, "WORK_COMPLETION_POLICY_INVALID");
  assert.deepEqual(calls.filter(call => !call.startsWith("checkpoint:")), ["prepare", "ownership", "realise"]);
});

test("native no-change preserves a failed obligation and never publishes a partial denominator", () => {
  const { outcome, calls } = scenario({ checkFailure: "urn:test:validation:b" });
  assert.equal(outcome.status, "refused");
  assert.equal(outcome.reasonCode, "CHECK_FIXTURE_REFUSAL");
  assert.deepEqual(calls.filter(call => call.startsWith("check:")), ["check:urn:test:validation:a", "check:urn:test:validation:b"]);
  assert.equal(calls.includes("evidence"), false);
  assert.equal(calls.includes("provider"), false);
});

test("native no-change requires nonempty validation and proof declarations", () => {
  for (const options of [{ noValidations: true }, { noProof: true }]) {
    const { outcome, calls } = scenario(options);
    assert.equal(outcome.status, "refused");
    assert.equal(calls.includes("apply"), false);
    assert.equal(calls.includes("provider"), false);
  }
});

test("native no-change checks command exit codes as well as output shapes", () => {
  for (const options of [{ realiseExitCode: 1 }, { evidenceExitCode: 1 }, { badEvidence: true }, { badProof: true }]) {
    const { outcome, calls } = scenario(options);
    assert.equal(outcome.status, "refused");
    assert.equal(calls.includes("apply"), false);
    assert.equal(calls.includes("provider"), false);
  }
});

test("native no-change verifies before apply and retains verification refusal", () => {
  const { outcome, calls } = scenario({ publicationFailure: "verify" });
  assert.equal(outcome.status, "refused");
  assert.equal(outcome.reasonCode, "PUBLICATION_FIXTURE_REFUSAL");
  assert.equal(calls.includes("verify"), true);
  assert.equal(calls.includes("apply"), false);
});

test("native no-change failed apply cannot become completed", () => {
  const { outcome, calls } = scenario({ publicationFailure: "apply" });
  assert.equal(outcome.status, "refused");
  assert.equal(calls.includes("verify"), true);
  assert.equal(calls.includes("readback"), false);
});

test("native no-change requires independent completed binding readback", () => {
  const { outcome, calls } = scenario({ readbackStatus: "PREPARED" });
  assert.equal(outcome.status, "refused");
  assert.equal(outcome.reasonCode, "LINEAR_DELIVERY_COMPLETION_READBACK_REFUSED");
  assert.equal(calls.includes("apply"), true);
  assert.equal(calls.includes("readback"), true);
});

test("native no-change cannot reinterpret unresolved provider attempts", () => {
  for (const preparedStatus of ["STARTED", "UNKNOWN", "SETTLED", "REFUSED"]) {
    const { outcome, calls } = scenario({ preparedStatus });
    assert.equal(outcome.status, "refused");
    assert.equal(calls.includes("provider"), false);
    assert.equal(calls.includes("realise"), false);
    assert.equal(calls.includes("apply"), false);
  }
});

test("native completed readback remains idempotent and legacy contribution dispatch remains distinct", () => {
  const completed = scenario({ preparedStatus: "COMPLETED" });
  assert.equal(completed.outcome.status, "completed");
  assert.deepEqual(completed.calls.filter(call => !call.startsWith("checkpoint:")), ["prepare"]);
  const legacy = scenario({ legacy: true });
  assert.equal(legacy.outcome.status, "refused");
  assert.equal(legacy.calls.includes("provider"), true);
  assert.equal(legacy.calls.includes("realise"), false);
});

test("native no-change refuses busy ownership and unproven settlement", () => {
  const busy = scenario({ ownershipFailure: true });
  assert.equal(busy.outcome.status, "refused");
  assert.equal(busy.calls.includes("realise"), false);
  assert.equal(busy.calls.includes("provider"), false);
  const unproven = scenario({ settlementFailure: true });
  assert.equal(unproven.outcome.status, "refused");
  assert.equal(unproven.outcome.reasonCode, "LINEAR_BINDING_NATIVE_COMPLETION_UNPROVEN");
  assert.equal(unproven.calls.includes("readback"), false);
});

test("native clone completion policy is disjoint and preserves the entire validation obligation", async () => {
  const { pathToFileURL } = await import("node:url");
  const { dispatchCliCommand } = await import(pathToFileURL(resolve(sourceRoot, "src/cli.ts")).href);
  const manifest = "graph/manifests/completion-clone-optimization.json";
  async function fields(iri: string): Promise<Array<{ predicate: string; value: string }>> {
    const result = await dispatchCliCommand(["query", "--iri", iri, "--manifest", manifest], sourceRoot);
    assert.equal(result.exitCode ?? 0, 0);
    const output = result.output as { status: string; items: Array<{ fields: Array<{ predicate: string; value: string }> }> };
    assert.equal(output.status, "ok");
    assert.equal(output.items.length, 1);
    return output.items[0]!.fields;
  }
  const policy = await fields("urn:usf:publication-policy:completion-clone-optimization-no-change-completion:1");
  const values = (name: string) => policy.filter(f => f.predicate === "urn:usf:predicate:" + name).map(f => f.value);
  assert.deepEqual(values("eligibleWork"), ["urn:usf:work:completion-clone-optimization"]);
  assert.deepEqual(values("requiredManifestPath"), [manifest]);
  assert.deepEqual(values("targetSemanticSourcePath"), ["graph/completion-clone-optimization-grants.nq"]);
  assert.deepEqual(values("proofAlgorithm"), ["urn:usf:proof-algorithm:semantic-no-change-completion:1"]);
  assert.deepEqual(values("type"), ["urn:usf:type:NoChangeWorkCompletionPublicationPolicy"]);
  const validation = await fields("urn:usf:validation:completion-clone-optimization");
  assert.deepEqual(validation.filter(f => f.predicate.endsWith(":command")).map(f => f.value), [
    "node --test --test-isolation=none tests/unit/realisation/completion-decisions.test.ts tests/integration/work-completion.test.ts",
  ]);
  assert.deepEqual(validation.filter(f => f.predicate.endsWith(":executionMode")).map(f => f.value), ["urn:usf:mode:confined-fixture-process:2"]);
});

function earlyRefusalCycle(modulePath: string): any {
  const script = `
    import { mock } from "node:test";
    import { mkdtemp, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import { resolve, join } from "node:path";
    import { pathToFileURL } from "node:url";
    import { canonicalDigest } from "./src/core/canonical.ts";
    import { LinearStateStore } from "./src/commands/linear-state.ts";
    const root = await mkdtemp(join(tmpdir(), "usf-early-refusal-"));
    const register = (path, namedExports) => mock.module(pathToFileURL(resolve(path)).href, { namedExports });
    const forbidden = () => { throw new Error("UNEXPECTED_EFFECT"); };
    const bindingIri = "urn:test:binding:early-refusal";
    const issue = { id: "123e4567-e89b-42d3-a456-426614174000", teamId: "fixture-team", stateId: "started", assigneeId: null, priority: 1 };
    const basisDigest = canonicalDigest("fixture basis");
    const binding = {
      authority: { locator: "fixture:" + issue.id, workspace: "fixture", owner: "usf", issueUuid: issue.id, workIri: "urn:test:work", bindingIri },
      basis: { basisDigest }, attempt: { state: "PREPARED" },
      unit: { packet: { id: "urn:test:work", readSet: [], writeSet: [], dependsOn: [], semanticDependencies: [], modelCapabilities: [], privacy: "public" } }
    };
    const evidence = { checkpointPath: "", phase: "prepare", bindingIri };
    const comments = new Map();
    let sends = 0;
    class LinearClient {
      async discoverTeamIssues() { return [issue]; }
      async workflowStates() { return [{ id: "started", type: "started" }]; }
      async createComment(comment) { sends += 1; comments.set(comment.id, comment); return comment; }
      async findComment(_issueId, _teamId, body) { return [...comments.values()].find(comment => comment.body === body) ?? null; }
      async getComment(id) { return comments.get(id); }
      async updateIssue() { forbidden(); }
    }
    register("src/graph/index.ts", { loadSemanticGraph: () => ({ quads: [
      { subject: bindingIri, predicate: "urn:usf:predicate:type", object: "urn:usf:type:LinearIssueWorkBinding", objectKind: "iri" }
    ] }), objectValues: () => [] });
    register("src/graph/work.ts", { deriveWork: forbidden });
    register("src/commands/linear-binding.ts", { observeLinearBinding: async () => ({ status: "PREPARED", binding }) });
    register("src/providers/config.ts", { loadCredentialEnvFile: forbidden });
    register("src/commands/linear-client.ts", { LinearClient, parseLinearPolicy: forbidden, readLinearPolicySource: forbidden });
    register("src/continuous/lifecycle.ts", { linuxProcessInspector: forbidden });
    register("src/continuous/stewardship.ts", {
      acquireSupervisorLifetimeLock: forbidden, claimStewardship: forbidden, releaseStewardship: forbidden, withSupervisorActivity: forbidden
    });
    register("src/commands/hermes-stewardship.ts", { currentStewardshipDependencies: forbidden });
    register("src/commands/hermes-supervisor-foreground.ts", {
      registerForegroundSupervisor: forbidden, unregisterForegroundSupervisor: forbidden, foregroundSupervisorStopRequested: forbidden
    });
    register("src/graph/runtime-authority.ts", { readRuntimeAuthority: forbidden });
    register("src/commands/linear-delivery.ts", { executeLinearDelivery: async () => ({
      status: "refused", reasonCode: "LINEAR_BINDING_NATIVE_COMPLETION_STATE_INVALID", evidence
    }) });
    try {
      const { runHermesLinearCycle } = await import(pathToFileURL(resolve(${JSON.stringify(modulePath)})).href);
      const policy = { bindingManifests: ["graph/manifests/fixture.json"], workspaces: [
        { key: "fixture", organizationUrlKey: "fixture", teams: [{ id: issue.teamId, owner: "usf", startedStateId: "started", completedStateId: "completed", assigneeId: null }] }
      ] };
      const store = await LinearStateStore.open(root);
      const first = await runHermesLinearCycle(root, policy, {}, store, ".usf/credentials/providers.env", 1, () => false);
      const reopened = await LinearStateStore.open(root);
      const persisted = reopened.progress();
      const second = await runHermesLinearCycle(root, policy, {}, reopened, ".usf/credentials/providers.env", 1, () => false);
      process.stdout.write(JSON.stringify({ first, second, persisted, sends, digest: canonicalDigest(evidence) }));
    } finally { await rm(root, { recursive: true, force: true }); }
  `;
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
    cwd: sourceRoot, encoding: "utf8", timeout: 15000, maxBuffer: 512 * 1024,
    env: {
      PATH: process.env.PATH ?? "/usr/bin",
      ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
    },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const modulePath of ["src/commands/hermes-linear-autonomy.ts", "src/commands/hermes-linear.ts"]) {
  test(modulePath + " preserves early refusal evidence in the durable progress ledger", () => {
    const result = earlyRefusalCycle(modulePath);
    for (const cycle of [result.first, result.second]) {
      assert.deepEqual(cycle.discoveryErrors, []);
      assert.deepEqual(cycle.authorityBlockers, []);
      assert.deepEqual(cycle.updateErrors, []);
      assert.equal(cycle.outcomes.length, 1);
      assert.equal(cycle.outcomes[0].status, "blocked");
      assert.equal(cycle.outcomes[0].reasonCode, "LINEAR_BINDING_NATIVE_COMPLETION_STATE_INVALID");
      assert.deepEqual(cycle.outcomes[0].evidence, [result.digest]);
      assert.equal(cycle.terminal, false);
    }
    assert.equal(result.persisted.length, 1);
    assert.equal(result.persisted[0].stage, "blocked");
    assert.equal(result.persisted[0].blocker, "LINEAR_BINDING_NATIVE_COMPLETION_STATE_INVALID");
    assert.deepEqual(result.persisted[0].evidenceRefs, [result.digest]);
    assert.equal(result.sends, 1, "repeated refusal must reconcile the existing comment, not send another");
  });
}

import { strict as continuationRecoveryAssert } from "node:assert";
import { spawnSync as continuationRecoverySpawnSync } from "node:child_process";
import {
  mkdtempSync as continuationRecoveryMkdtempSync,
  rmSync as continuationRecoveryRmSync,
  writeFileSync as continuationRecoveryWriteFileSync,
} from "node:fs";
import { tmpdir as continuationRecoveryTmpdir } from "node:os";
import { join as continuationRecoveryJoin, resolve as continuationRecoveryResolve } from "node:path";
import { pathToFileURL as continuationRecoveryPathToFileURL } from "node:url";
import { test as continuationRecoveryTest } from "node:test";

continuationRecoveryTest("metadata continuation resumes an applied checkpoint once and refuses changed authority", { timeout: 30_000 }, () => {
  const scratch = continuationRecoveryMkdtempSync(
    continuationRecoveryJoin(continuationRecoveryTmpdir(), "usf-linear-continuation-"),
  );
  const loaderPath = continuationRecoveryJoin(scratch, "continuation-loader.mjs");
  const stubPath = continuationRecoveryJoin(scratch, "continuation-stubs.mjs");
  const scenarioPath = continuationRecoveryJoin(scratch, "continuation-scenario.mjs");
  const root = process.cwd();
  const moduleUrl = continuationRecoveryPathToFileURL(
    continuationRecoveryResolve(root, "src/commands/linear-continuation.ts"),
  ).href;
  const canonicalUrl = continuationRecoveryPathToFileURL(
    continuationRecoveryResolve(root, "src/core/canonical.ts"),
  ).href;

  const loader = String.raw`
const target = process.env.USF_CONTINUATION_MODULE;
const stub = process.env.USF_CONTINUATION_STUB;
const intercepted = new Set([
  "../graph/index.ts",
  "../graph/linear-binding.ts",
  "../graph/work.ts",
  "../realisation/index.ts",
  "./linear-client.ts",
]);
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === target && intercepted.has(specifier)) {
    return { url: stub, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

  const stubs = String.raw`
function harness() {
  const value = globalThis.__linearContinuationHarness;
  if (!value) throw new Error("CONTINUATION_HARNESS_MISSING");
  return value;
}
export function loadSemanticGraph(_root, manifestPath) {
  return { fixtureManifestPath: manifestPath, sources: [], manifests: [] };
}
export function objectValues(_graph, _subject, predicate) {
  const name = predicate.slice("urn:usf:predicate:".length);
  return [...(harness().policyValues[name] ?? [])];
}
export function resourceDigest() {
  return harness().policyDigest;
}
export function deriveLinearBindingDeclaration() {
  return harness().bindingAuthority;
}
export function deriveWork(_graph, options) {
  return { status: "ok", items: [harness().packet(options.selector)] };
}
export async function authenticateCandidateWorkspace(_root, candidateDigest) {
  const fixture = harness();
  fixture.candidateAuthenticationCalls++;
  if (candidateDigest !== fixture.candidateDigest) throw new Error("CANDIDATE_DIGEST_MISMATCH");
  return fixture.candidate;
}
export async function inspectCandidateIntegrationRecovery() {
  const fixture = harness();
  fixture.recoveryInspectionCalls++;
  return fixture.integration;
}
export async function readLinearPolicySource() {
  harness().policyReadCalls++;
}
`;

  const scenario = String.raw`
const assert = (await import("node:assert")).strict;
const childProcess = await import("node:child_process");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const canonical = await import(process.env.USF_CANONICAL_MODULE);
const continuation = await import(process.env.USF_CONTINUATION_MODULE);

const selectedWork = "urn:usf:work:cli-provider-qualification-help";
const selectedProfile = "urn:usf:profile:cli-provider-qualification-help:1";
const selectedManifest = "graph/manifests/cli-provider-qualification-help.json";
const controllerWork = "urn:usf:work:hermes-linear-autonomy";
const controllerProfile = "urn:usf:profile:hermes-linear-autonomy:1";
const controllerManifest = "graph/manifests/hermes-linear-autonomy.json";
const changedPath = "src/commands/help.ts";
const acceptancePath = "tests/fixtures/cli-provider-qualification-help.acceptance.ts";
const publicationPath = "graph/continuation-publications.nq";
const linearIssueKey = canonical.canonicalDigest({ issue: selectedWork });
const canonicalAttemptKey = canonical.canonicalDigest({ attempt: "original", workIri: selectedWork });
const checkReceiptKey = canonical.canonicalDigest({ check: "native", workIri: selectedWork });
const attemptPath = ".usf/work/linear/" + linearIssueKey.slice(7) + "/" + canonicalAttemptKey.slice(7) + ".json";
const unitPath = ".usf/work/linear/" + linearIssueKey.slice(7) + "/" + canonicalAttemptKey.slice(7) + ".nq";
const checkPath = ".usf/receipts/check/" + checkReceiptKey.slice(7) + ".json";
const selectedBasisDigest = canonical.canonicalDigest({ basis: "selected" });
const freshSelectedBasisDigest = canonical.canonicalDigest({ basis: "selected-after-publication" });
const controllerBasisDigest = canonical.canonicalDigest({ basis: "controller" });

const beforeHelp = [
  'const probeQualifyTopic = topic(["probe", "qualify"], {',
  'purpose: "Qualify a probe.",',
  'synopsis: ["usf probe qualify --provider ID --model ID"],',
  'options: [{ syntax: "--provider ID", description: "Provider." }, envFileOption],',
  'outputSchema: { type: "object" },',
  '});',
  "",
].join("\n");
const afterHelp = [
  'const probeQualifyTopic = topic(["probe", "qualify"], {',
  'purpose: "Qualify a provider-backed probe.",',
  'synopsis: ["usf probe qualify --provider ID --model ID --task-class NAME --env-file PATH [--max-output-tokens N]"],',
  'options: [',
  '  { syntax: "--provider ID", description: "Provider identifier." },',
  '  { syntax: "--model ID", description: "Model identifier." },',
  '  { syntax: "--task-class NAME", description: "Task class." },',
  '  envFileOption,',
  '  { syntax: "--max-output-tokens N", description: "Optional output-token ceiling." },',
  '],',
  'outputSchema: { type: "object" },',
  '});',
  "",
].join("\n");

function put(root, repositoryPath, content) {
  const segments = path.dirname(repositoryPath).split("/").filter(segment => segment !== ".");
  const privatePath = segments[0] === ".usf";
  let parent = root;
  for (const segment of segments) {
    parent = path.join(parent, segment);
    fs.mkdirSync(parent, { recursive: true, mode: privatePath ? 0o700 : 0o755 });
    if (privatePath) fs.chmodSync(parent, 0o700);
  }
  const file = path.join(root, repositoryPath);
  fs.writeFileSync(file, content);
  fs.chmodSync(file, privatePath ? 0o600 : 0o644);
}
function git(root, args) {
  const result = childProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin",
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    },
  });
  assert.equal(result.status, 0, "git " + args.join(" ") + "\n" + result.stdout + result.stderr);
  return result.stdout.trim();
}
function policyValues(acceptanceDigest) {
  return {
    type: ["urn:usf:type:ConstructionContinuationPolicy"],
    version: ["1"],
    forContract: ["urn:usf:contract:hermes-linear-autonomy:1"],
    controllerWork: [controllerWork],
    controllerProfile: [controllerProfile],
    controllerManifest: [controllerManifest],
    controllerPolicy: ["urn:usf:policy:hermes-linear-transport:1"],
    eligibleWork: [selectedWork],
    selectedProfile: [selectedProfile],
    targetManifest: [selectedManifest],
    allowedChangedPath: [changedPath],
    residentDisposition: ["metadata-only"],
    acceptedIntegrationSchema: ["urn:usf:integration-observation:2"],
    acceptedRecoveryState: ["primary-advanced"],
    classifierSchema: ["urn:usf:probe-qualify-help-metadata-delta:1"],
    targetDeclaration: ["probeQualifyTopic"],
    targetFactory: ["topic"],
    targetTopicPath: ['["probe","qualify"]'],
    mutableLiteralField: ["options", "purpose", "synopsis"],
    requiredIdentityReference: ["envFileOption"],
    requiredIdentityCardinality: ["1"],
    immutableAcceptance: ["urn:usf:acceptance:cli-provider-qualification-help"],
    immutableAcceptanceDigest: [acceptanceDigest],
    selectedCompletionDisposition: ["resume-original-idempotent"],
    controllerCompletionDisposition: ["forbidden"],
    providerReplayDisposition: ["forbidden"],
    integrationReplayDisposition: ["forbidden"],
    derivedPublicationDisposition: ["authenticated-exact-append-idempotent"],
    algorithm: ["urn:usf:algorithm:linear-construction-continuation:1"],
    schema: ["urn:usf:linear-construction-continuation-intent:1"],
  };
}
function makePacket(fixture, workIri) {
  const publication = fs.readFileSync(path.join(fixture.root, publicationPath), "utf8");
  const constructed = publication.includes("construction:" + workIri + "\n");
  const completed = publication.includes("completion:" + workIri + "\n");
  const basisDigest = workIri === selectedWork
    ? (constructed ? freshSelectedBasisDigest : selectedBasisDigest)
    : controllerBasisDigest;
  const scopedPaths = workIri === selectedWork ? [changedPath, publicationPath] : [publicationPath];
  const constructionEligible = workIri === controllerWork
    ? (!fixture.integrationCommitted || constructed)
    : constructed;
  return {
    id: workIri,
    readSet: scopedPaths,
    writeSet: scopedPaths,
    realisationBasis: { basisDigest, work: { dependencies: [] } },
    realisationAuthority: {
      constructionProofObligation: "urn:usf:proof:" + (workIri === selectedWork ? "cli-provider-qualification-help" : "hermes-linear-autonomy") + ":construction-authority",
      completionProofObligation: workIri === selectedWork ? "urn:usf:proof:cli-provider-qualification-help" : null,
      completionValidationObligations: workIri === selectedWork
        ? ["urn:usf:validation:cli-provider-qualification-help"]
        : [],
    },
    eligibility: { construction: { eligible: constructionEligible } },
    realisationStage: { completion: { verified: completed } },
  };
}
function setup(name) {
  const root = fs.mkdtempSync(path.join(process.env.USF_CONTINUATION_SCRATCH, name + "-"));
  const acceptanceBytes = Buffer.from("immutable acceptance fixture\n");
  const acceptanceDigest = canonical.sha256(acceptanceBytes);
  const candidateDigest = canonical.canonicalDigest({ candidate: name });
  const checkReceipt = {
    candidateDigest,
    originalConstructionBasisDigest: selectedBasisDigest,
    validationAuthorityDependencies: [],
  };
  const attempt = { attemptKey: canonicalAttemptKey, status: "SETTLED" };
  put(root, ".gitignore", ".usf/\nevidence/\n");
  put(root, changedPath, beforeHelp);
  put(root, acceptancePath, acceptanceBytes);
  put(root, publicationPath, "base\n");
  put(root, attemptPath, JSON.stringify(attempt) + "\n");
  put(root, unitPath, "<urn:fixture:unit> <urn:fixture:work> <" + selectedWork + "> <urn:fixture:graph> .\n");
  put(root, checkPath, canonical.canonicalJson(checkReceipt) + "\n");
  put(root, "src/unrelated.ts", 'export const unrelated = "baseline";\n');
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "continuation@example.invalid"]);
  git(root, ["config", "user.name", "Continuation Fixture"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  const repositoryCommit = git(root, ["rev-parse", "HEAD"]);
  const bindingAuthority = {
    bindingIri: "urn:usf:linear-binding:cli-provider-qualification-help:1",
    canonicalIssueLocator: "maldous:fixture",
  };
  const fixture = {
    root,
    acceptanceDigest,
    candidateDigest,
    checkReceipt,
    attempt,
    repositoryCommit,
    bindingAuthority,
    policyValues: policyValues(acceptanceDigest),
    policyDigest: canonical.canonicalDigest({ policy: "v1" }),
    integrationCommitted: false,
    candidateAuthenticationCalls: 0,
    recoveryInspectionCalls: 0,
    policyReadCalls: 0,
    integration: null,
  };
  fixture.packet = workIri => makePacket(fixture, workIri);
  fixture.candidate = {
    constructionBasis: { basisDigest: selectedBasisDigest },
    actualOperationDelta: [{
      path: changedPath,
      before: Buffer.from(beforeHelp).toString("base64"),
      after: Buffer.from(afterHelp).toString("base64"),
      beforeDigest: canonical.sha256(Buffer.from(beforeHelp)),
      afterDigest: canonical.sha256(Buffer.from(afterHelp)),
      beforeMode: "100644",
      afterMode: "100644",
    }],
    workspaceIdentityDigest: canonical.canonicalDigest({ workspace: name }),
  };
  fixture.binding = {
    status: "SETTLED",
    binding: {
      authority: bindingAuthority,
      selector: { manifestPath: selectedManifest },
      attemptPath,
      attempt,
      unitPath,
      unit: {
        workIri: selectedWork,
        profile: selectedProfile,
        manifestPath: selectedManifest,
        basisDigest: selectedBasisDigest,
        attemptKey: attempt.attemptKey,
        packet: fixture.packet(selectedWork),
      },
    },
  };
  globalThis.__linearContinuationHarness = fixture;
  return fixture;
}
function installIntegration(fixture) {
  put(fixture.root, changedPath, afterHelp);
  git(fixture.root, ["add", changedPath]);
  git(fixture.root, ["commit", "-qm", "integrate help metadata"]);
  const observedCarrierCommit = git(fixture.root, ["rev-parse", "HEAD"]);
  assert.notEqual(observedCarrierCommit, fixture.repositoryCommit);
  fixture.integrationCommitted = true;
  const observationDigest = canonical.canonicalDigest({ observation: fixture.candidateDigest });
  const observationPath = ".usf/receipts/integration/" + observationDigest.slice(7) + ".json";
  const intentPath = ".usf/receipts/integration/intents/" + observationDigest.slice(7) + ".json";
  const observation = {
    schema: "urn:usf:integration-observation:2",
    outcome: "urn:usf:outcome:integration-success",
    observationDigest,
    startingCarrierCommit: fixture.repositoryCommit,
    observedCarrierCommit,
    workspaceIdentityDigest: fixture.candidate.workspaceIdentityDigest,
    originalConstructionBases: [{
      basisDigest: selectedBasisDigest,
      work: { id: selectedWork },
    }],
    authoritativeGitDiff: [{
      path: changedPath,
      beforeDigest: fixture.candidate.actualOperationDelta[0].beforeDigest,
      afterDigest: fixture.candidate.actualOperationDelta[0].afterDigest,
    }],
    checkedCandidateReceipts: [fixture.checkReceipt],
  };
  put(fixture.root, observationPath, canonical.canonicalJson(observation) + "\n");
  put(fixture.root, intentPath, JSON.stringify({ observationPath }) + "\n");
  fixture.integration = {
    state: "primary-advanced",
    observation,
    prepared: { intentPath },
  };
}
function publicationOperations(fixture, calls, interruptSelectedConstruction) {
  let interrupted = false;
  async function publish(kind, selected, identity, options) {
    const key = kind + ":" + selected.workIri;
    calls.push({ key, resume: options.resume });
    const sourceAbsolute = path.join(fixture.root, publicationPath);
    const beforeBytes = fs.readFileSync(sourceAbsolute);
    const afterBytes = Buffer.from(beforeBytes.toString("utf8") + kind + ":" + selected.workIri + "\n");
    const receiptValue = { identity, kind, workIri: selected.workIri };
    const receiptBytes = Buffer.from(canonical.canonicalJson(receiptValue) + "\n");
    const receiptDirectory = kind === "completion" ? "work-completion" : "construction-authority";
    const receiptPath = "evidence/" + receiptDirectory + "/" + identity.slice(7) + ".json";
    const proofPath = ".usf/candidates/" + receiptDirectory + "/" + identity.slice(7) + ".proof.json";
    const effect = {
      kind,
      workIris: [selected.workIri],
      sourcePath: publicationPath,
      beforeDigest: canonical.sha256(beforeBytes),
      afterDigest: canonical.sha256(afterBytes),
      receiptPath,
      receiptFileDigest: canonical.sha256(receiptBytes),
      receiptDigest: canonical.canonicalDigest(receiptValue),
    };
    put(fixture.root, proofPath, canonical.canonicalJson({ identity, kind, selected: selected.workIri }) + "\n");
    await options.checkpoint(effect);
    put(fixture.root, publicationPath, afterBytes);
    put(fixture.root, receiptPath, receiptBytes);
    if (interruptSelectedConstruction && !interrupted && kind === "construction" && selected.workIri === selectedWork) {
      interrupted = true;
      throw new Error("FIXTURE_INTERRUPT_AFTER_EFFECT");
    }
  }
  return {
    construct: (selected, identity, options) => publish("construction", selected, identity, options),
    complete: (selected, identity, options) => publish("completion", selected, identity, options),
  };
}
const forbiddenOperations = {
  construct: async () => { throw new Error("UNEXPECTED_CONSTRUCTION"); },
  complete: async () => { throw new Error("UNEXPECTED_COMPLETION"); },
};

{
  const fixture = setup("resume");
  assert.equal(await continuation.prepareLinearMetadataContinuation(
    fixture.root,
    fixture.binding,
    fixture.candidateDigest,
    [checkPath],
  ), true);
  assert.equal(fixture.packet(controllerWork).eligibility.construction.eligible, true);
  installIntegration(fixture);
  assert.equal(fixture.packet(controllerWork).eligibility.construction.eligible, false);
  const calls = [];
  await assert.rejects(
    continuation.resumeLinearMetadataContinuation(
      fixture.root,
      publicationOperations(fixture, calls, true),
    ),
    error => error instanceof Error && error.message === "FIXTURE_INTERRUPT_AFTER_EFFECT",
  );
  assert.deepEqual(calls, [{ key: "construction:" + selectedWork, resume: false }]);
  assert.equal(fixture.recoveryInspectionCalls, 1);

  const completed = await continuation.resumeLinearMetadataContinuation(
    fixture.root,
    publicationOperations(fixture, calls, false),
  );
  assert.deepEqual(completed, {
    status: "completed",
    bindingIri: fixture.bindingAuthority.bindingIri,
    attemptKey: canonicalAttemptKey,
    candidateDigest: fixture.candidateDigest,
  });
  assert.deepEqual(calls, [
    { key: "construction:" + selectedWork, resume: false },
    { key: "completion:" + selectedWork, resume: false },
    { key: "construction:" + controllerWork, resume: false },
  ]);
  assert.equal(calls.filter(call => call.key === "construction:" + selectedWork).length, 1);
  assert.equal(calls.filter(call => call.key === "completion:" + selectedWork).length, 1);
  assert.equal(calls.filter(call => call.key === "construction:" + controllerWork).length, 1);
  assert.equal(fixture.recoveryInspectionCalls, 1);
  assert.equal(fixture.candidateAuthenticationCalls, 1);
  assert.equal(fixture.packet(selectedWork).realisationBasis.basisDigest, freshSelectedBasisDigest);
  assert.notEqual(fixture.packet(selectedWork).realisationBasis.basisDigest, selectedBasisDigest);
  assert.equal(fixture.packet(controllerWork).eligibility.construction.eligible, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.root, attemptPath), "utf8")), fixture.attempt);
  assert.equal(await continuation.resumeLinearMetadataContinuation(fixture.root, forbiddenOperations), null);
}

{
  const fixture = setup("unknown-integration");
  assert.equal(await continuation.prepareLinearMetadataContinuation(
    fixture.root,
    fixture.binding,
    fixture.candidateDigest,
    [checkPath],
  ), true);
  installIntegration(fixture);
  fixture.integration = { ...fixture.integration, observation: null };
  await assert.rejects(
    continuation.resumeLinearMetadataContinuation(fixture.root, forbiddenOperations),
    error => error?.reasonCode === "LINEAR_CONTINUATION_INTEGRATION_UNAUTHENTICATED",
  );
}

{
  const fixture = setup("changed-attempt");
  assert.equal(await continuation.prepareLinearMetadataContinuation(
    fixture.root,
    fixture.binding,
    fixture.candidateDigest,
    [checkPath],
  ), true);
  installIntegration(fixture);
  put(fixture.root, attemptPath, JSON.stringify({ ...fixture.attempt, status: "CHANGED" }) + "\n");
  await assert.rejects(
    continuation.resumeLinearMetadataContinuation(fixture.root, forbiddenOperations),
    error => error?.reasonCode === "LINEAR_CONTINUATION_PROTECTED_INPUT_CHANGED",
  );
}

{
  const fixture = setup("unrelated");
  assert.equal(await continuation.prepareLinearMetadataContinuation(
    fixture.root,
    fixture.binding,
    fixture.candidateDigest,
    [checkPath],
  ), true);
  installIntegration(fixture);
  put(fixture.root, "src/unrelated.ts", 'export const unrelated = "changed";\n');
  await assert.rejects(
    continuation.resumeLinearMetadataContinuation(fixture.root, forbiddenOperations),
    error => error?.reasonCode === "LINEAR_CONTINUATION_UNRELATED_CHANGE",
  );
}

{
  const fixture = setup("policy");
  assert.equal(await continuation.prepareLinearMetadataContinuation(
    fixture.root,
    fixture.binding,
    fixture.candidateDigest,
    [checkPath],
  ), true);
  installIntegration(fixture);
  fixture.policyDigest = canonical.canonicalDigest({ policy: "v2" });
  await assert.rejects(
    continuation.resumeLinearMetadataContinuation(fixture.root, forbiddenOperations),
    error => error?.reasonCode === "LINEAR_CONTINUATION_AUTHORITY_CHANGED",
  );
}
`;

  continuationRecoveryWriteFileSync(loaderPath, loader);
  continuationRecoveryWriteFileSync(stubPath, stubs);
  continuationRecoveryWriteFileSync(scenarioPath, scenario);

  try {
    const result = continuationRecoverySpawnSync(
      process.execPath,
      ["--experimental-loader", loaderPath, scenarioPath],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 25_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          PATH: process.env.PATH ?? "/usr/bin",
          ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
          NODE_NO_WARNINGS: "1",
          USF_CANONICAL_MODULE: canonicalUrl,
          USF_CONTINUATION_MODULE: moduleUrl,
          USF_CONTINUATION_SCRATCH: scratch,
          USF_CONTINUATION_STUB: continuationRecoveryPathToFileURL(stubPath).href,
        },
      },
    );
    continuationRecoveryAssert.equal(
      result.status,
      0,
      [
        "continuation recovery subprocess failed",
        result.error ? String(result.error) : "",
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n"),
    );
  } finally {
    continuationRecoveryRmSync(scratch, { recursive: true, force: true });
  }
});
