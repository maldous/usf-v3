import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const sourceRoot = resolve(import.meta.dirname, "../../..");

function retainedCommentCycle(modulePath: string, race: "none" | "authority" | "intent" | "equivalent" = "none"): any {
  const script = `
    import { mock } from "node:test";
    import { mkdtemp, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import { resolve, join } from "node:path";
    import { pathToFileURL } from "node:url";
    import { canonicalDigest } from "./src/core/canonical.ts";
    import { LinearStateStore } from "./src/commands/linear-state.ts";
    const root = await mkdtemp(join(tmpdir(), "usf-retained-comment-"));
    const register = (path, namedExports) => mock.module(pathToFileURL(resolve(path)).href, { namedExports });
    const forbidden = () => { throw new Error("UNEXPECTED_MUTATION"); };
    const old = "urn:test:binding:retained-old", current = "urn:test:binding:retained-current";
    const issueId = "123e4567-e89b-42d3-a456-426614174000";
    const otherIssue = "123e4567-e89b-42d3-a456-426614174001";
    const teamId = "123e4567-e89b-42d3-a456-426614174002";
    const basisDigest = canonicalDigest("current fixture basis");
    const quad = (subject, name, object, objectKind = "literal") => ({
      subject, predicate: "urn:usf:predicate:" + name, object, objectKind, graph: "urn:test:graph"
    });
    const declarations = [old, current].flatMap(subject => [
      quad(subject, "type", "urn:usf:type:LinearIssueWorkBinding", "iri"),
      quad(subject, "issueWorkspace", "fixture"),
      quad(subject, "issueUuid", issueId),
      quad(subject, "owningModel", "USF"),
      quad(subject, "selectedProfile", "urn:test:profile:1", "iri"),
      quad(subject, "targetManifest", "graph/manifests/fixture.json"),
      quad(subject, "workIri", "urn:test:work", "iri"),
      quad(subject, "fixedPrompt", "Perform only the exact governed fixture work."),
      quad(subject, "maximumPromptTokens", "10000")
    ]);
    declarations.push(quad(current, "supersedesBinding", old, "iri"));
    const issue = { id: issueId, teamId, stateId: "completed", assigneeId: null, priority: 1 };
    const binding = {
      authority: { locator: "fixture:" + issueId, workspace: "fixture", owner: "USF", issueUuid: issueId, workIri: "urn:test:work", bindingIri: current },
      basis: { basisDigest }, attempt: { state: "SETTLED" },
      unit: { packet: { id: "urn:test:work", readSet: [], writeSet: [], dependsOn: [], semanticDependencies: [], modelCapabilities: [], privacy: "public" } }
    };
    const queries = [];
    const race = ${JSON.stringify(race)};
    let activeStore;
    let raced = false;
    class LinearClient {
      async discoverTeamIssues() { return []; }
      async getIssue(id, team) { if (id !== issueId || team !== teamId) forbidden(); return issue; }
      async findCommentRequestMatches(id, team, expected) {
        if (id !== issueId || team !== teamId) forbidden();
        queries.push(expected);
        if (!raced && race !== "none") {
          raced = true;
          if (race === "authority") {
            declarations.find(q => q.subject === old && q.predicate.endsWith(":fixedPrompt")).object = "Changed binding authority during readback.";
          } else if (race === "intent") {
            const pending = activeStore.intents().find(i => i.requestDigest === canonicalDigest({ issueId, body: "Unique retained body" }));
            void activeStore.markUnknown(pending.id);
          } else {
            const extra = await activeStore.prepare({ bindingIri: old,
              operation: "comment-v4-" + canonicalDigest("Unique retained body"), remoteOperationId: issueId
            }, canonicalDigest({ issueId, body: "Unique retained body" }));
            await activeStore.markSent(extra.id);
            await activeStore.markUnknown(extra.id);
          }
        }
        return [
          { id: "123e4567-e89b-42d3-a456-426614174003", issueId, body: "Unique retained body" },
          { id: "123e4567-e89b-42d3-a456-426614174004", issueId, body: "Shared retained body" },
          { id: "123e4567-e89b-42d3-a456-426614174005", issueId: otherIssue, body: "Missing retained body" }
        ];
      }
      async createComment() { forbidden(); }
      async createIssue() { forbidden(); }
      async updateIssue() { forbidden(); }
      async workflowStates() { forbidden(); }
    }
    register("src/graph/index.ts", { loadSemanticGraph: () => ({ quads: declarations }), objectValues: () => [] });
    register("src/graph/work.ts", { deriveWork: forbidden });
    register("src/commands/linear-binding.ts", { observeLinearBinding: async selector => {
      if (selector.bindingIri !== current) forbidden();
      throw Object.assign(new Error("LINEAR_BINDING_WORK_INACTIVE"), { reasonCode: "LINEAR_BINDING_WORK_INACTIVE" });
    } });
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
    register("src/commands/linear-delivery.ts", { executeLinearDelivery: forbidden });
    try {
      const { runHermesLinearCycle } = await import(pathToFileURL(resolve(${JSON.stringify(modulePath)})).href);
      const policy = { bindingManifests: ["graph/manifests/fixture.json"], pageSize: 50, maxPages: 2, workspaces: [
        { key: "USF", organizationUrlKey: "fixture", teams: [{ id: teamId, owner: "USF", startedStateId: "started", completedStateId: "completed", assigneeId: null }] }
      ] };
      const store = await LinearStateStore.open(root);
      activeStore = store;
      const ids = {};
      async function retain(key, body, prefix, unknown = true, remoteOperationId = issueId) {
        const requestDigest = canonicalDigest({ issueId: remoteOperationId, body });
        const prepared = await store.prepare({ bindingIri: old, operation: prefix + canonicalDigest(body), remoteOperationId }, requestDigest);
        await store.markSent(prepared.id);
        if (unknown) await store.markUnknown(prepared.id);
        ids[key] = prepared.id;
      }
      await retain("unique", "Unique retained body", "comment-", false);
      await retain("shared1", "Shared retained body", "comment-");
      await retain("shared2", "Shared retained body", "comment-v2-");
      await retain("missing", "Missing retained body", "comment-");
      await retain("wrongIssue", "Wrong issue body", "comment-", false, otherIssue);
      await retain("unsupported", "Unsupported body", "issue-started-");
      await store.recordProgress({ bindingIri: current, basisDigest, stage: "completed", blocker: null, evidenceRefs: ["urn:test:published-completion"] });
      const first = await runHermesLinearCycle(root, policy, {}, store, ".usf/credentials/providers.env", 1, () => false);
      const reopened = await LinearStateStore.open(root);
      activeStore = reopened;
      const second = race === "none"
        ? await runHermesLinearCycle(root, policy, {}, reopened, ".usf/credentials/providers.env", 1, () => false)
        : null;
      process.stdout.write(JSON.stringify({ ids, first, second, queries, intents: reopened.intents() }));
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
  test(modulePath + " reconciles unique historical comments without replaying superseded work", () => {
    const result = retainedCommentCycle(modulePath);
    assert.deepEqual(result.first.reconciliation.confirmed, [result.ids.unique]);
    assert.deepEqual(result.second.reconciliation.confirmed, [], "retained positive settlement is idempotent");
    assert.equal(result.queries.length, 2, "one bounded read per issue per cycle, not per intent");
    assert.deepEqual(result.queries.map((items: unknown[]) => items.length), [2, 1]);
    const states = Object.fromEntries(result.intents.map((intent: any) => [intent.id, intent.state]));
    assert.equal(states[result.ids.unique], "confirmed");
    for (const key of ["shared1", "shared2", "missing", "unsupported"]) assert.equal(states[result.ids[key]], "unknown");
    assert.equal(states[result.ids.wrongIssue], "sent");
    for (const cycle of [result.first, result.second]) {
      assert.equal(cycle.boundLaneCount, 0, "neither the superseded nor inactive successor may dispatch");
      assert.deepEqual(cycle.outcomes, []);
      assert.equal(cycle.authorityBlockers.length, 1, "only the inactive successor is observed");
      assert.equal(cycle.authorityBlockers[0].reasonCode, "LINEAR_BINDING_WORK_INACTIVE");
      assert.equal(cycle.terminal, false, "unknown effects still prevent whole-scope completion");
      assert.equal(cycle.state.intents.confirmed, 1);
      assert.equal(cycle.state.intents.unknown, 4);
      assert.equal(cycle.state.intents.sent, 1);
      const reasons = Object.fromEntries(cycle.reconciliation.unresolved.map((item: any) => [item.intentId, item.reasonCode]));
      assert.equal(reasons[result.ids.shared1], "LINEAR_COMMENT_INTENT_IDENTITY_AMBIGUOUS");
      assert.equal(reasons[result.ids.shared2], "LINEAR_COMMENT_INTENT_IDENTITY_AMBIGUOUS");
      assert.equal(reasons[result.ids.missing], "LINEAR_COMMENT_POSTCONDITION_UNOBSERVED");
      assert.equal(reasons[result.ids.wrongIssue], "LINEAR_RECONCILIATION_REMOTE_IDENTITY_MISMATCH");
      assert.equal(reasons[result.ids.unsupported], "LINEAR_RECONCILIATION_OPERATION_UNSUPPORTED");
    }
  });
}

for (const modulePath of ["src/commands/hermes-linear-autonomy.ts", "src/commands/hermes-linear.ts"]) {
  for (const [race, reasonCode] of [
    ["authority", "LINEAR_RECONCILIATION_AUTHORITY_STALE"],
    ["intent", "LINEAR_RECONCILIATION_INTENT_STALE"],
    ["equivalent", "LINEAR_COMMENT_INTENT_IDENTITY_AMBIGUOUS"],
  ] as const) {
    test(modulePath + " preserves historical intents when " + race + " changes during readback", () => {
      const result = retainedCommentCycle(modulePath, race);
      assert.deepEqual(result.first.reconciliation.confirmed, []);
      assert.equal(result.queries.length, 1);
      assert.equal(result.first.reconciliation.unresolved.find((item: any) =>
        item.intentId === result.ids.unique)?.reasonCode, reasonCode);
      const retained = result.intents.find((intent: any) => intent.id === result.ids.unique);
      assert.equal(retained.state, race === "intent" ? "unknown" : "sent");
      assert.equal(result.first.state.intents.confirmed, 0);
      assert.equal(result.first.terminal, false);
      assert.deepEqual(result.first.outcomes, [], "no effect callback or remote mutation is permitted");
    });
  }
}
