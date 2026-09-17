import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

if (process.env.USF_HERMES_ADMISSION_CHILD === "1") {
  const workspace = "maldous";
  const teamId = "77f0a87a-f966-460f-b744-98e75634f128";
  const issueUuid = "6b7b4c5d-8e9f-4012-a3b4-c5d6e7f8091a";
  const unknownIssueUuid = "7c8c5d6e-9f01-4123-b4c5-d6e7f8091a2b";
  const proposalIri = "urn:usf:linear-issue-proposal:admission-fixture";
  const bindingIri = "urn:usf:linear-binding:admission-fixture";
  const unknownBindingIri = "urn:usf:linear-binding:historical-unknown-fixture";
  const workIri = "urn:usf:work:fixture-admission";
  const profileIri = "urn:usf:profile:fixture-admission:1";
  const targetManifest = "graph/manifests/fixture-admission.json";
  const bindingManifest = "graph/manifests/linear-issue-bindings.json";
  const graphIri = "urn:usf:graph:linear-issue-bindings";
  const locator = (id: string) => `${workspace}:${id}`;
  const quad = (subject: string, name: string, object: string, objectKind: "iri" | "literal" = "literal") => ({ subject, predicate: `urn:usf:predicate:${name}`, object, objectKind, graph: graphIri });

  test("normal Hermes admission creates and completes once without starving historical unknown work", async () => {
    let remoteIssue: Record<string, unknown> | null = null;
    let activeStore: { summary: () => { intents: { sent: number }; pendingUnknownIntentIds: readonly string[] } } | null = null;
    let createCount = 0;
    let dispatchCount = 0;
    let completionCommentCount = 0;
    let completionUpdateCount = 0;
    let legitimateConsumed = false;
    let sawSentCreateIntent = false;

    const bindingGraph = { quads: [
      quad(proposalIri, "type", "urn:usf:type:LinearIssueProposal", "iri"), quad(proposalIri, "issueWorkspace", workspace), quad(proposalIri, "issueTeamUuid", teamId), quad(proposalIri, "owningModel", "USF"), quad(proposalIri, "issueUuid", issueUuid), quad(proposalIri, "title", "Admission fixture"), quad(proposalIri, "description", "Graph-authorised admission fixture."), quad(proposalIri, "targetManifest", targetManifest), quad(proposalIri, "workIri", workIri, "iri"), quad(proposalIri, "selectedProfile", profileIri, "iri"),
      quad(bindingIri, "type", "urn:usf:type:LinearIssueWorkBinding", "iri"), quad(bindingIri, "canonicalIssueLocator", locator(issueUuid)), quad(bindingIri, "issueWorkspace", workspace), quad(bindingIri, "issueUuid", issueUuid), quad(bindingIri, "owningModel", "USF"), quad(bindingIri, "maximumPromptTokens", "32000"), quad(bindingIri, "selectedProfile", profileIri, "iri"), quad(bindingIri, "targetManifest", targetManifest), quad(bindingIri, "workIri", workIri, "iri"), quad(bindingIri, "fixedPrompt", "Use only the graph-authorised fixture work."),
      quad(unknownBindingIri, "type", "urn:usf:type:LinearIssueWorkBinding", "iri"), quad(unknownBindingIri, "canonicalIssueLocator", locator(unknownIssueUuid)), quad(unknownBindingIri, "issueWorkspace", workspace), quad(unknownBindingIri, "issueUuid", unknownIssueUuid), quad(unknownBindingIri, "owningModel", "USF"), quad(unknownBindingIri, "maximumPromptTokens", "32000"), quad(unknownBindingIri, "selectedProfile", profileIri, "iri"), quad(unknownBindingIri, "targetManifest", targetManifest), quad(unknownBindingIri, "workIri", workIri, "iri"), quad(unknownBindingIri, "fixedPrompt", "Use only the graph-authorised fixture work."),
    ] };

    const graphMock = mock.module("../../src/graph/index.ts", { namedExports: { loadSemanticGraph: () => bindingGraph, objectValues: (graph: typeof bindingGraph, subject: string, predicate: string) => graph.quads.filter((item) => item.subject === subject && item.predicate === predicate).map((item) => item.object) } });
    const workMock = mock.module("../../src/graph/work.ts", { namedExports: { deriveWork: () => ({ status: "ok", items: [{ eligibility: { construction: { eligible: true } }, realisationStage: { completion: { verified: false } } }] }) } });
    const bindingMock = mock.module("../../src/commands/linear-binding.ts", { namedExports: { observeLinearBinding: async ({ bindingIri: selected }: { bindingIri: string }) => {
      const unknown = selected === unknownBindingIri;
      const complete = selected === bindingIri && legitimateConsumed;
      return { status: complete ? "COMPLETED" : "PREPARED", integrationReceipt: complete ? "fixture-integration" : undefined, evidence: complete ? "fixture-evidence" : undefined, proofResult: complete ? "fixture-proof" : undefined, binding: { authority: { bindingIri: selected, locator: locator(unknown ? unknownIssueUuid : issueUuid), owner: "USF" }, basis: { basisDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, attempt: { state: complete ? "COMPLETED" : "PREPARED" }, unit: { packet: { writeSet: [], readSet: [], dependsOn: [], semanticDependencies: [], modelCapabilities: [], privacy: "public" }, attempt: { state: complete ? "COMPLETED" : "PREPARED" } } } };
    } } });
    const deliveryMock = mock.module("../../src/commands/linear-delivery.ts", { namedExports: { executeLinearDelivery: async (_root: string, selector: { bindingIri: string }) => {
      if (selector.bindingIri === unknownBindingIri) throw Object.assign(new Error("historical effect is unknown"), { reasonCode: "LINEAR_BINDING_OUTCOME_UNKNOWN" });
      dispatchCount += 1;
      if (legitimateConsumed) throw new Error("duplicate legitimate dispatch");
      legitimateConsumed = true;
      return { status: "completed", evidence: { checkpointPath: "fixture", digest: "fixture" } };
    } } });
    const clientMock = mock.module("../../src/commands/linear-client.ts", { namedExports: { readLinearPolicySource: () => { throw new Error("UNEXPECTED_POLICY_READ_IN_SUPPLIED_POLICY_CYCLE"); }, LinearClient: class {
      async discoverTeamIssues() { return remoteIssue ? [remoteIssue, { id: unknownIssueUuid, teamId, title: "Historical unknown", description: "retained", priority: 1, stateId: "started", assigneeId: null }] : []; }
      async getIssue(id: string) { return id === issueUuid ? remoteIssue : { id, teamId, title: "Historical unknown", description: "retained", priority: 1, stateId: "started", assigneeId: null }; }
      async workflowStates() { return [{ id: "started", type: "started" }, { id: "completed", type: "completed" }]; }
      async createIssue(input: Record<string, unknown>) { assert.equal(activeStore?.summary().intents.sent, 1); sawSentCreateIntent = true; createCount += 1; remoteIssue = { ...input, id: input.id, teamId, title: input.title, description: input.description, priority: 1, stateId: "started", assigneeId: null }; return remoteIssue; }
      async updateIssue(input: Record<string, unknown>) { if (input.stateId === "completed") completionUpdateCount += 1; remoteIssue = { ...(remoteIssue ?? {}), ...input }; return remoteIssue; }
      async findComment(_issueId: string, _teamId: string, body: string) { return body.includes("semantic completion verified") && completionCommentCount > 0 ? { id: "comment" } : null; }
      async createComment(input: Record<string, unknown>) { if (String(input.body).includes("semantic completion verified")) completionCommentCount += 1; return { id: "comment", ...input }; }
    } } });

    try {
      const { runHermesLinearCycle, LinearMutations } = await import("../../src/commands/hermes-linear-autonomy.ts");
      const { LinearStateStore } = await import("../../src/commands/linear-state.ts");
      const root = await (await import("node:fs/promises")).mkdtemp(join((await import("node:os")).tmpdir(), "usf-hermes-admission-"));
      try {
        const policy = { bindingManifests: [bindingManifest], pageSize: 50, maxPages: 2, maximumIssuesPerCycle: 100, allowCreate: true, allowUpdate: true, workspaces: [{ key: "MALDOUS", organizationUrlKey: workspace, credentialName: "USF_LINEAR_API_KEY", authScheme: "api-key", teams: [{ id: teamId, owner: "USF", assigneeId: null, startedStateId: "started", completedStateId: "completed", blockedStateId: null }] }] } as never;
        const credentials = { hasCredential: () => true } as never;
        const store = await LinearStateStore.open(root); activeStore = store;
        const unknown = new LinearMutations(store);
        const seeded = await store.prepare({ bindingIri: unknownBindingIri, operation: "create-issue", remoteOperationId: unknownIssueUuid }, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        await store.markSent(seeded.id); await store.markUnknown(seeded.id);
        const first = await runHermesLinearCycle(root, policy, credentials, store, ".env", 2, () => false) as { proposals: readonly { issueId?: string }[]; outcomes: readonly { bindingIri: string; status: string }[]; state: { progress: { blocked: number; completed: number }; pendingUnknownIntentIds: readonly string[] } };
        assert.equal(sawSentCreateIntent, true); assert.equal(createCount, 1); assert.equal(first.proposals[0]?.issueId, issueUuid); assert.equal(first.outcomes.find((item) => item.bindingIri === bindingIri)?.status, "completed"); assert.equal(first.outcomes.find((item) => item.bindingIri === unknownBindingIri)?.status, "blocked"); assert.equal(first.state.progress.completed, 1); assert.equal(first.state.progress.blocked, 1); assert.equal(first.state.pendingUnknownIntentIds.length, 1);
        const second = await runHermesLinearCycle(root, policy, credentials, await LinearStateStore.open(root), ".env", 2, () => false) as { proposals: readonly { issueId?: string }[]; state: { progress: { blocked: number; completed: number }; pendingUnknownIntentIds: readonly string[] } };
        assert.equal(createCount, 1); assert.equal(dispatchCount, 1); assert.equal(completionCommentCount, 1); assert.equal(completionUpdateCount, 1); assert.equal(second.proposals[0]?.issueId, issueUuid); assert.equal(second.state.progress.blocked, 1); assert.equal(second.state.progress.completed, 1); assert.equal(second.state.pendingUnknownIntentIds.length, 1);
      } finally { await (await import("node:fs/promises")).rm(root, { recursive: true, force: true }); }
    } finally { graphMock.restore(); workMock.restore(); bindingMock.restore(); deliveryMock.restore(); clientMock.restore(); }
  });
} else {
  test("Hermes admission fixture runs module mocks in an isolated child", async () => {
    const child = spawn(process.execPath, ["--experimental-test-module-mocks", "--test", "--test-isolation=none", fileURLToPath(import.meta.url)], { env: { ...process.env, USF_HERMES_ADMISSION_CHILD: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    const result = await new Promise<{ code: number | null }>((resolve) => child.once("close", (code) => resolve({ code })));
    assert.equal(result.code, 0, `${stdout}\n${stderr}`);
    assert.match(stdout, /pass 1/);
  });
}
