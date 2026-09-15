import assert from "node:assert/strict";
import test from "node:test";
import {
  LinearClient, LinearClientError, parseLinearPolicy, type LinearFetch, type LinearPolicy,
} from "../../../src/commands/linear-client.ts";

const teamId = "77f0a87a-f966-460f-b744-98e75634f128";
const otherTeamId = "53f584e7-70a1-4b1e-b982-b815210e47d4";
const issueId = "11111111-1111-4111-8111-111111111111";
const commentId = "22222222-2222-4222-8222-222222222222";

function policy(overrides: Record<string, unknown> = {}): LinearPolicy {
  return parseLinearPolicy({
    $schema: "../schemas/hermes-linear-policy.schema.json", schema: "urn:usf:hermes-linear-policy:1", endpoint: "https://api.linear.app/graphql",
    bindingManifests: ["graph/manifests/linear-issue-bindings.json"], pageSize: 2, maxPages: 2, timeoutMs: 1_000, maxResponseBytes: 1_024,
    maximumIssuesPerCycle: 3, pollSeconds: 30, allowCreate: true, allowUpdate: true,
    workspaces: [{ key: "USF", organizationUrlKey: "usf", credentialName: "USF_LINEAR_API_KEY", authScheme: "api-key", teams: [{ id: teamId, owner: "USF", assigneeId: null, startedStateId: null, completedStateId: null, blockedStateId: null }] }],
    ...overrides,
  });
}

function response(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
function identity(): Response { return response({ data: { viewer: { organization: { urlKey: "usf" }, teams: { nodes: [{ id: teamId }] } } } }); }
function remoteIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: issueId, identifier: "USF-1", title: "Title", description: "Description", priority: 2, updatedAt: "2026-09-07T00:00:00.000Z", team: { id: teamId }, state: { id: "66666666-6666-4666-8666-666666666666", type: "started" }, assignee: null, ...overrides };
}
function queued(...responses: Response[]): LinearFetch {
  return async () => responses.shift() ?? (() => { throw new Error("unexpected fetch"); })();
}
function client(fetch: LinearFetch, selected = policy()): LinearClient {
  return new LinearClient({ policy: selected, workspaceKey: "USF", credentials: { getCredential: () => "private-secret" }, fetch });
}
async function rejectsCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof LinearClientError && error.code === code && error.message === code);
}

test("discovery authorizes identity then requests bounded pages with fixed endpoint and raw API key", async () => {
  const calls: RequestInit[] = [];
  const found = await client(async (url, init) => {
    assert.equal(url, "https://api.linear.app/graphql"); calls.push(init!);
    return calls.length === 1 ? identity() : calls.length === 2
      ? response({ data: { team: { issues: { nodes: [remoteIssue()], pageInfo: { hasNextPage: true, endCursor: "next" } } } } })
      : response({ data: { team: { issues: { nodes: [remoteIssue({ id: "33333333-3333-4333-8333-333333333333" })], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  }).discoverTeamIssues(teamId);
  assert.equal(found.length, 2);
  assert.equal(calls[0]?.redirect, "error");
  assert.equal((calls[0]?.headers as Record<string, string>).authorization, "private-secret");
  const second = JSON.parse(String(calls[1]?.body)) as { variables: { after: null } };
  const third = JSON.parse(String(calls[2]?.body)) as { variables: { after: string; filter: { state: { type: { nin: string[] } } } } };
  assert.equal(second.variables.after, null); assert.equal(third.variables.after, "next");
  assert.deepEqual(third.variables.filter, { state: { type: { nin: ["completed", "canceled"] } } });
});

test("identity refuses the wrong organization or absent allowed team before issue discovery", async () => {
  await rejectsCode(() => client(queued(response({ data: { viewer: { organization: { urlKey: "other" }, teams: { nodes: [{ id: teamId }] } } } }))).discoverTeamIssues(teamId), "LINEAR_IDENTITY_INVALID");
  await rejectsCode(() => client(queued(response({ data: { viewer: { organization: { urlKey: "usf" }, teams: { nodes: [] } } } }))).discoverTeamIssues(teamId), "LINEAR_IDENTITY_INVALID");
  await rejectsCode(() => client(queued()).discoverTeamIssues(otherTeamId), "LINEAR_TEAM_NOT_ALLOWED");
});

test("discovery refuses incomplete pagination, repeated cursors, and the per-cycle issue limit", async () => {
  await rejectsCode(() => client(queued(identity(), response({ data: { team: { issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "a" } } } } }), response({ data: { team: { issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "b" } } } } }))).discoverTeamIssues(teamId), "LINEAR_DISCOVERY_INCOMPLETE");
  await rejectsCode(() => client(queued(identity(), response({ data: { team: { issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "a" } } } } }), response({ data: { team: { issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "a" } } } } }))).discoverTeamIssues(teamId), "LINEAR_PAGINATION_INVALID");
  await rejectsCode(() => client(queued(identity(), response({ data: { team: { issues: { nodes: [remoteIssue(), remoteIssue({ id: "33333333-3333-4333-8333-333333333333" })], pageInfo: { hasNextPage: true, endCursor: "a" } } } } }), response({ data: { team: { issues: { nodes: [remoteIssue({ id: "44444444-4444-4444-8444-444444444444" }), remoteIssue({ id: "55555555-5555-4555-8555-555555555555" })], pageInfo: { hasNextPage: false, endCursor: null } } } } }))).discoverTeamIssues(teamId), "LINEAR_DISCOVERY_LIMIT");
});

test("create and update require successful remote mutation plus exact issue readback", async () => {
  const created = await client(queued(identity(), response({ data: { issueCreate: { success: true, issue: { id: issueId } } } }), response({ data: { issue: remoteIssue() } }))).createIssue({ id: issueId, teamId, title: "Title", description: "Description" });
  assert.equal(created.id, issueId);
  const updated = await client(queued(identity(), response({ data: { issue: remoteIssue() } }), response({ data: { issueUpdate: { success: true, issue: { id: issueId } } } }), response({ data: { issue: remoteIssue({ title: "Updated" }) } }))).updateIssue({ id: issueId, teamId, title: "Updated" });
  assert.equal(updated.title, "Updated");
  await rejectsCode(() => client(queued(identity(), response({ data: { issueCreate: { success: true, issue: { id: issueId } } } }), response({ data: { issue: remoteIssue({ title: "Different" }) } }))).createIssue({ id: issueId, teamId, title: "Title", description: "Description" }), "LINEAR_READBACK_MISMATCH");
});

test("issue-bound mutations reject wrong teams and substituted UUIDs before mutation", async () => {
  for (const overrides of [{ team: { id: otherTeamId } }, { id: commentId }]) {
    for (const operation of ["update", "comment"]) {
      const calls: string[] = [];
      const api = client(async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        calls.push(request.operationName);
        if (request.operationName === "ViewerIdentity") return identity();
        assert.equal(request.variables.id, issueId);
        return response({ data: { issue: remoteIssue(overrides) } });
      });
      await rejectsCode(() => operation === "update"
        ? api.updateIssue({ id: issueId, teamId, title: "Updated" })
        : api.createComment({ id: commentId, issueId, teamId, body: "Body" }),
      "team" in overrides ? "LINEAR_TEAM_NOT_ALLOWED" : "LINEAR_READBACK_MISMATCH");
      assert.deepEqual(calls, ["ViewerIdentity", "IssueReadback"]);
    }
  }
});

test("comment creation uses the server UUID and verifies issue and comment readback", async () => {
  const calls: { operationName: string; variables: Record<string, unknown> }[] = [];
  const created = await client(async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)) as { operationName: string; variables: Record<string, unknown> });
    return [identity(), response({ data: { issue: remoteIssue() } }), response({ data: { commentCreate: { success: true, comment: { id: commentId } } } }), response({ data: { comment: { id: commentId, body: "Body", issue: { id: issueId } } } })][calls.length - 1]!;
  }).createComment({ id: commentId, issueId, teamId, body: "Body" });
  assert.deepEqual(calls.map((call) => call.operationName), ["ViewerIdentity", "IssueReadback", "CommentCreate", "CommentReadback"]);
  assert.deepEqual(calls[2]?.variables.input, { issueId, body: "Body" });
  assert.equal(created.id, commentId);
});

test("comment lookup tolerates a bounded eventual-consistency gap", async () => {
  let commentQueries = 0;
  const found = await client(async (_url, init) => {
    const operationName = (JSON.parse(String(init?.body)) as { operationName: string }).operationName;
    if (operationName === "ViewerIdentity") return identity();
    if (operationName === "IssueReadback") return response({ data: { issue: remoteIssue() } });
    assert.equal(operationName, "IssueComments");
    commentQueries += 1;
    return response({ data: { issue: { comments: { nodes: commentQueries === 1 ? [] : [{ id: commentId, body: "Body", issue: { id: issueId } }] } } } });
  }).findComment(issueId, teamId, "Body");
  assert.equal(found?.id, commentId);
  assert.equal(commentQueries, 2);
});

test("an exact issue read remains available for a completed bound issue", async () => {
  const completed = remoteIssue({ state: { id: "77777777-7777-4777-8777-777777777777", type: "completed" }, priority: 1, updatedAt: "2026-09-07T01:00:00.000Z" });
  const found = await client(queued(identity(), response({ data: { issue: completed } }))).getIssue(issueId, teamId);
  assert.equal(found.stateType, "completed");
  assert.equal(found.priority, 1);
  assert.equal(found.updatedAt, "2026-09-07T01:00:00.000Z");
});

test("missing credentials fail before fetch and GraphQL or transport errors never leak secrets or remote prose", async () => {
  let contacted = false;
  const missing = new LinearClient({ policy: policy(), workspaceKey: "USF", credentials: { getCredential: () => undefined }, fetch: async () => { contacted = true; return identity(); } });
  await rejectsCode(() => missing.discoverTeamIssues(teamId), "LINEAR_CREDENTIAL_MISSING"); assert.equal(contacted, false);
  const secret = "private-secret";
  for (const fetch of [queued(response({ errors: [{ message: `remote detail ${secret}` }] })), async () => { throw new Error(`network detail ${secret}`); }]) {
    try { await client(fetch).discoverTeamIssues(teamId); assert.fail("expected refusal"); } catch (error) { assert.ok(error instanceof LinearClientError); assert.equal(error.message.includes(secret), false); assert.equal(error.message.includes("remote detail"), false); }
  }
});

test("policy parser is strict and bearer policy uses Bearer authorization", async () => {
  assert.throws(() => parseLinearPolicy({}), (error: unknown) => error instanceof LinearClientError && error.code === "LINEAR_POLICY_INVALID");
  const bearer = policy({ workspaces: [{ key: "USF", organizationUrlKey: "usf", credentialName: "USF_LINEAR_API_KEY", authScheme: "bearer", teams: [{ id: teamId, owner: "USF", assigneeId: null, startedStateId: null, completedStateId: null, blockedStateId: null }] }] });
  let authorization = "";
  let calls = 0;
  await new LinearClient({ policy: bearer, workspaceKey: "USF", credentials: { getCredential: () => "private-secret" }, fetch: async (_url, init) => {
    authorization = (init?.headers as Record<string, string>).authorization;
    calls += 1;
    return calls === 1 ? identity() : response({ data: { team: { states: { nodes: [] } } } });
  } }).workflowStates(teamId);
  assert.equal(authorization, "Bearer private-secret");
});

test("response byte limits are enforced while streaming", async () => {
  await rejectsCode(() => client(queued(identity(), response({ data: { team: { issues: { nodes: [remoteIssue({ description: "x".repeat(2_000) })], pageInfo: { hasNextPage: false, endCursor: null } } } } }))).discoverTeamIssues(teamId), "LINEAR_RESPONSE_TOO_LARGE");
});
