const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
const POLICY_SCHEMA = "urn:usf:hermes-linear-policy:1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const workspaceKeyPattern = /^[A-Z][A-Z0-9_]{1,31}$/u;
const organizationUrlKeyPattern = /^[a-z0-9][a-z0-9-]{1,63}$/u;
const credentialNamePattern = /^[A-Z][A-Z0-9_]{2,127}$/u;
const bindingManifestPattern = /^graph\/manifests\/[A-Za-z0-9._-]+\.json$/u;
const activeIssueFilter = Object.freeze({ state: Object.freeze({ type: Object.freeze({ nin: Object.freeze(["completed", "canceled"]) }) }) });

export interface LinearTeamPolicy {
  readonly id: string;
  readonly owner: "USF" | "UIF" | "UXF" | "ANQR";
  readonly assigneeId: string | null;
  readonly startedStateId: string | null;
  readonly completedStateId: string | null;
  readonly blockedStateId: string | null;
}

export interface LinearWorkspacePolicy {
  readonly key: string;
  readonly organizationUrlKey: string;
  readonly credentialName: string;
  readonly authScheme: "api-key" | "bearer";
  readonly teams: readonly LinearTeamPolicy[];
}

export interface LinearPolicy {
  readonly schema: "urn:usf:hermes-linear-policy:1";
  readonly endpoint: "https://api.linear.app/graphql";
  readonly bindingManifests: readonly string[];
  readonly pageSize: number;
  readonly maxPages: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maximumIssuesPerCycle: number;
  readonly pollSeconds: number;
  readonly allowCreate: boolean;
  readonly allowUpdate: boolean;
  readonly workspaces: readonly LinearWorkspacePolicy[];
}

export interface LinearCredentialSource {
  getCredential(name: string): string | undefined | Promise<string | undefined>;
}

export type LinearFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface LinearClientOptions {
  readonly policy: LinearPolicy;
  readonly workspaceKey: string;
  readonly credentials: LinearCredentialSource;
  readonly fetch?: LinearFetch;
}

export interface LinearIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly teamId: string;
  readonly stateId: string | null;
  readonly stateType: string | null;
  readonly assigneeId: string | null;
  /** Linear priority: 0 (none) through 4 (low). */
  readonly priority: number;
  readonly updatedAt: string;
}

export interface LinearWorkflowState {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface LinearComment {
  readonly id: string;
  readonly body: string;
  readonly issueId: string;
}

export interface LinearCreateIssueInput {
  /** Stable caller-generated UUID used as the remote issue identity. */
  readonly id: string;
  readonly teamId: string;
  readonly title: string;
  readonly description: string;
}

export interface LinearUpdateIssueInput {
  readonly id: string;
  readonly teamId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly stateId?: string | null;
  readonly assigneeId?: string | null;
}

export interface LinearCreateCommentInput {
  /** Stable caller-generated UUID used as the remote comment identity. */
  readonly id: string;
  readonly issueId: string;
  readonly teamId: string;
  readonly body: string;
}

export class LinearClientError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, detail?: string) {
    super(code);
    this.name = "LinearClientError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code: string, detail?: string): never {
  throw new LinearClientError(code, detail);
}

function linearResponseDetail(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const messages = value.flatMap((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
    const message = (item as Record<string, unknown>).message;
    return typeof message === "string" ? [message] : [];
  });
  const detail = messages.join("; ").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return detail.length > 512 ? `${detail.slice(0, 509)}...` : detail || undefined;
}

function object(value: unknown, code = "LINEAR_POLICY_INVALID"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code = "LINEAR_POLICY_INVALID"): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}

function string(value: unknown, pattern?: RegExp, code = "LINEAR_POLICY_INVALID"): string {
  if (typeof value !== "string" || (pattern !== undefined && !pattern.test(value))) fail(code);
  return value;
}

function nullableUuid(value: unknown): string | null {
  if (value === null) return null;
  return string(value, uuidPattern);
}

function integer(value: unknown, minimum: number, maximum: number, code = "LINEAR_POLICY_INVALID"): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < minimum || value > maximum) fail(code);
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") fail("LINEAR_POLICY_INVALID");
  return value;
}

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail("LINEAR_POLICY_INVALID");
}

/** Strict runtime equivalent of the copied hermes-linear-policy JSON schema. */
export function parseLinearPolicy(value: unknown): LinearPolicy {
  const root = object(value);
  exactKeys(root, ["$schema", "schema", "endpoint", "bindingManifests", "pageSize", "maxPages", "timeoutMs", "maxResponseBytes", "maximumIssuesPerCycle", "pollSeconds", "allowCreate", "allowUpdate", "workspaces"]);
  if (root.schema !== POLICY_SCHEMA || root.endpoint !== LINEAR_ENDPOINT || typeof root.$schema !== "string") fail("LINEAR_POLICY_INVALID");
  if (!Array.isArray(root.bindingManifests) || root.bindingManifests.length === 0) fail("LINEAR_POLICY_INVALID");
  const bindingManifests = root.bindingManifests.map((entry) => string(entry, bindingManifestPattern));
  unique(bindingManifests);
  if (!Array.isArray(root.workspaces) || root.workspaces.length === 0) fail("LINEAR_POLICY_INVALID");
  const workspaces = root.workspaces.map((entry) => {
    const workspace = object(entry);
    exactKeys(workspace, ["key", "organizationUrlKey", "credentialName", "authScheme", "teams"]);
    if (!Array.isArray(workspace.teams) || workspace.teams.length === 0) fail("LINEAR_POLICY_INVALID");
    const teams = workspace.teams.map((candidate) => {
      const team = object(candidate);
      exactKeys(team, ["id", "owner", "assigneeId", "startedStateId", "completedStateId", "blockedStateId"]);
      const owner = string(team.owner);
      if (owner !== "USF" && owner !== "UIF" && owner !== "UXF" && owner !== "ANQR") fail("LINEAR_POLICY_INVALID");
      return Object.freeze({ id: string(team.id, uuidPattern), owner, assigneeId: nullableUuid(team.assigneeId), startedStateId: nullableUuid(team.startedStateId), completedStateId: nullableUuid(team.completedStateId), blockedStateId: nullableUuid(team.blockedStateId) });
    });
    unique(teams.map((team) => team.id));
    const authScheme = string(workspace.authScheme);
    if (authScheme !== "api-key" && authScheme !== "bearer") fail("LINEAR_POLICY_INVALID");
    return Object.freeze({ key: string(workspace.key, workspaceKeyPattern), organizationUrlKey: string(workspace.organizationUrlKey, organizationUrlKeyPattern), credentialName: string(workspace.credentialName, credentialNamePattern), authScheme, teams: Object.freeze(teams) });
  });
  unique(workspaces.map((workspace) => workspace.key));
  unique(workspaces.map((workspace) => workspace.organizationUrlKey));
  unique(workspaces.flatMap((workspace) => workspace.teams.map((team) => team.id)));
  return Object.freeze({
    schema: POLICY_SCHEMA,
    endpoint: LINEAR_ENDPOINT,
    bindingManifests: Object.freeze(bindingManifests),
    pageSize: integer(root.pageSize, 1, 50), maxPages: integer(root.maxPages, 1, 20), timeoutMs: integer(root.timeoutMs, 1_000, 30_000),
    maxResponseBytes: integer(root.maxResponseBytes, 1_024, 4_194_304), maximumIssuesPerCycle: integer(root.maximumIssuesPerCycle, 1, 100), pollSeconds: integer(root.pollSeconds, 5, 3_600),
    allowCreate: bool(root.allowCreate), allowUpdate: bool(root.allowUpdate), workspaces: Object.freeze(workspaces),
  });
}

function issue(value: unknown): LinearIssue {
  const record = object(value, "LINEAR_RESPONSE_INVALID");
  const issueState = record.state === null || record.state === undefined ? null : object(record.state, "LINEAR_RESPONSE_INVALID");
  const priority = integer(record.priority, 0, 4, "LINEAR_RESPONSE_INVALID");
  const updatedAt = string(record.updatedAt, undefined, "LINEAR_RESPONSE_INVALID");
  if (!Number.isFinite(Date.parse(updatedAt))) fail("LINEAR_RESPONSE_INVALID");
  return Object.freeze({ id: string(record.id, uuidPattern, "LINEAR_RESPONSE_INVALID"), identifier: string(record.identifier, undefined, "LINEAR_RESPONSE_INVALID"), title: string(record.title, undefined, "LINEAR_RESPONSE_INVALID"), description: record.description === null ? null : string(record.description, undefined, "LINEAR_RESPONSE_INVALID"), teamId: string(object(record.team, "LINEAR_RESPONSE_INVALID").id, uuidPattern, "LINEAR_RESPONSE_INVALID"), stateId: issueState === null ? null : string(issueState.id, uuidPattern, "LINEAR_RESPONSE_INVALID"), stateType: issueState === null ? null : string(issueState.type, undefined, "LINEAR_RESPONSE_INVALID"), assigneeId: record.assignee === null || record.assignee === undefined ? null : string(object(record.assignee, "LINEAR_RESPONSE_INVALID").id, uuidPattern, "LINEAR_RESPONSE_INVALID"), priority, updatedAt });
}

function state(value: unknown): LinearWorkflowState {
  const record = object(value, "LINEAR_RESPONSE_INVALID");
  return Object.freeze({ id: string(record.id, uuidPattern, "LINEAR_RESPONSE_INVALID"), name: string(record.name, undefined, "LINEAR_RESPONSE_INVALID"), type: string(record.type, undefined, "LINEAR_RESPONSE_INVALID") });
}

function comment(value: unknown): LinearComment {
  const record = object(value, "LINEAR_RESPONSE_INVALID");
  return Object.freeze({ id: string(record.id, uuidPattern, "LINEAR_RESPONSE_INVALID"), body: string(record.body, undefined, "LINEAR_RESPONSE_INVALID"), issueId: string(object(record.issue, "LINEAR_RESPONSE_INVALID").id, uuidPattern, "LINEAR_RESPONSE_INVALID") });
}

function nonEmpty(value: string, code = "LINEAR_INPUT_INVALID"): string {
  if (value.length === 0 || value.length > 100_000 || value.includes("\u0000")) fail(code);
  return value;
}

export class LinearClient {
  readonly #policy: LinearPolicy;
  readonly #workspace: LinearWorkspacePolicy;
  readonly #credentials: LinearCredentialSource;
  readonly #fetch: LinearFetch;
  #identity: Promise<void> | undefined;

  constructor(options: LinearClientOptions) {
    this.#policy = options.policy;
    this.#workspace = options.policy.workspaces.find((workspace) => workspace.key === options.workspaceKey) ?? fail("LINEAR_WORKSPACE_NOT_ALLOWED");
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async discoverTeamIssues(teamId: string): Promise<readonly LinearIssue[]> {
    await this.#authorizedTeam(teamId);
    const issues: LinearIssue[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < this.#policy.maxPages; page += 1) {
      const data = await this.#request("TeamIssues", "query TeamIssues($teamId: String!, $first: Int!, $after: String, $filter: IssueFilter) { team(id: $teamId) { issues(first: $first, after: $after, filter: $filter) { nodes { id identifier title description priority updatedAt team { id } state { id type } assignee { id } } pageInfo { hasNextPage endCursor } } } }", { teamId, first: this.#policy.pageSize, after: cursor, filter: activeIssueFilter });
      const connection = object(object(data).team, "LINEAR_RESPONSE_INVALID").issues;
      const result = object(connection, "LINEAR_RESPONSE_INVALID");
      if (!Array.isArray(result.nodes)) fail("LINEAR_RESPONSE_INVALID");
      for (const node of result.nodes) {
        const parsed = issue(node);
        if (parsed.teamId !== teamId) fail("LINEAR_TEAM_NOT_ALLOWED");
        if (issues.length >= this.#policy.maximumIssuesPerCycle) fail("LINEAR_DISCOVERY_LIMIT");
        issues.push(parsed);
      }
      const pageInfo = object(result.pageInfo, "LINEAR_RESPONSE_INVALID");
      if (typeof pageInfo.hasNextPage !== "boolean") fail("LINEAR_RESPONSE_INVALID");
      if (!pageInfo.hasNextPage) return Object.freeze(issues);
      const next = string(pageInfo.endCursor, undefined, "LINEAR_RESPONSE_INVALID");
      if (cursors.has(next)) fail("LINEAR_PAGINATION_INVALID");
      cursors.add(next);
      cursor = next;
    }
    fail("LINEAR_DISCOVERY_INCOMPLETE");
  }

  async getIssue(id: string, teamId: string): Promise<LinearIssue> {
    await this.#authorizedTeam(teamId);
    return this.#readIssue(id, teamId);
  }

  async workflowStates(teamId: string): Promise<readonly LinearWorkflowState[]> {
    await this.#authorizedTeam(teamId);
    const data = await this.#request("WorkflowStates", "query WorkflowStates($teamId: String!) { team(id: $teamId) { states { nodes { id name type } } } }", { teamId });
    const nodes = object(object(object(data).team, "LINEAR_RESPONSE_INVALID").states, "LINEAR_RESPONSE_INVALID").nodes;
    if (!Array.isArray(nodes)) fail("LINEAR_RESPONSE_INVALID");
    return Object.freeze(nodes.map(state));
  }

  async getComment(id: string, issueId: string, teamId: string): Promise<LinearComment> {
    await this.#authorizedTeam(teamId);
    await this.#readIssue(issueId, teamId);
    return this.#readComment(id, issueId);
  }

  async findComment(issueId: string, teamId: string, body: string): Promise<LinearComment | null> {
    if (!uuidPattern.test(issueId)) fail("LINEAR_INPUT_INVALID");
    nonEmpty(body);
    await this.#authorizedTeam(teamId);
    await this.#readIssue(issueId, teamId);
    const data = await this.#request("IssueComments", "query IssueComments($id: String!) { issue(id: $id) { comments { nodes { id body issue { id } } } } }", { id: issueId });
    const comments = object(object(object(data).issue, "LINEAR_RESPONSE_INVALID").comments, "LINEAR_RESPONSE_INVALID").nodes;
    if (!Array.isArray(comments)) fail("LINEAR_RESPONSE_INVALID");
    const matches = comments.map(comment).filter((item) => item.body === body);
    if (matches.length > 1) fail("LINEAR_COMMENT_READBACK_AMBIGUOUS");
    return matches[0] ?? null;
  }

  async createIssue(input: LinearCreateIssueInput): Promise<LinearIssue> {
    if (!this.#policy.allowCreate) fail("LINEAR_CREATE_NOT_ALLOWED");
    this.#validateCreateIssue(input);
    await this.#authorizedTeam(input.teamId);
    const data = await this.#request("IssueCreate", "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id } } }", { input });
    const created = object(object(data).issueCreate, "LINEAR_RESPONSE_INVALID");
    if (created.success !== true || string(object(created.issue, "LINEAR_RESPONSE_INVALID").id, uuidPattern, "LINEAR_RESPONSE_INVALID") !== input.id) fail("LINEAR_MUTATION_UNCONFIRMED");
    const readback = await this.#readIssue(input.id, input.teamId);
    if (readback.title !== input.title || readback.description !== input.description) fail("LINEAR_READBACK_MISMATCH");
    return readback;
  }

  async updateIssue(input: LinearUpdateIssueInput): Promise<LinearIssue> {
    if (!this.#policy.allowUpdate) fail("LINEAR_UPDATE_NOT_ALLOWED");
    this.#validateUpdateIssue(input);
    await this.getIssue(input.id, input.teamId);
    const patch: Record<string, string | null> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.stateId !== undefined) patch.stateId = input.stateId;
    if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
    const data = await this.#request("IssueUpdate", "mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id } } }", { id: input.id, input: patch });
    const updated = object(object(data).issueUpdate, "LINEAR_RESPONSE_INVALID");
    if (updated.success !== true || string(object(updated.issue, "LINEAR_RESPONSE_INVALID").id, uuidPattern, "LINEAR_RESPONSE_INVALID") !== input.id) fail("LINEAR_MUTATION_UNCONFIRMED");
    const readback = await this.#readIssue(input.id, input.teamId);
    if ((input.title !== undefined && readback.title !== input.title) || (input.description !== undefined && readback.description !== input.description) || (input.stateId !== undefined && readback.stateId !== input.stateId) || (input.assigneeId !== undefined && readback.assigneeId !== input.assigneeId)) fail("LINEAR_READBACK_MISMATCH");
    return readback;
  }

  async createComment(input: LinearCreateCommentInput): Promise<LinearComment> {
    this.#validateComment(input);
    await this.#authorizedTeam(input.teamId);
    await this.#readIssue(input.issueId, input.teamId);
    const data = await this.#request("CommentCreate", "mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }", { input: { issueId: input.issueId, body: input.body } });
    const created = object(object(data).commentCreate, "LINEAR_RESPONSE_INVALID");
    if (created.success !== true) fail("LINEAR_MUTATION_UNCONFIRMED");
    const createdId = string(object(created.comment, "LINEAR_RESPONSE_INVALID").id, uuidPattern, "LINEAR_RESPONSE_INVALID");
    const readback = await this.#readComment(createdId, input.issueId);
    if (readback.body !== input.body) fail("LINEAR_READBACK_MISMATCH");
    return readback;
  }

  async #authorizedTeam(teamId: string): Promise<void> {
    if (!uuidPattern.test(teamId) || !this.#workspace.teams.some((team) => team.id === teamId)) fail("LINEAR_TEAM_NOT_ALLOWED");
    await (this.#identity ??= this.#verifyIdentity());
  }

  async #verifyIdentity(): Promise<void> {
    const data = await this.#request("ViewerIdentity", "query ViewerIdentity { viewer { organization { urlKey } teams { nodes { id } } } }");
    const viewer = object(object(data).viewer, "LINEAR_IDENTITY_INVALID");
    if (string(object(viewer.organization, "LINEAR_IDENTITY_INVALID").urlKey, undefined, "LINEAR_IDENTITY_INVALID") !== this.#workspace.organizationUrlKey) fail("LINEAR_IDENTITY_INVALID");
    const nodes = object(viewer.teams, "LINEAR_IDENTITY_INVALID").nodes;
    if (!Array.isArray(nodes)) fail("LINEAR_IDENTITY_INVALID");
    const actual = new Set(nodes.map((entry) => string(object(entry, "LINEAR_IDENTITY_INVALID").id, uuidPattern, "LINEAR_IDENTITY_INVALID")));
    if (this.#workspace.teams.some((team) => !actual.has(team.id))) fail("LINEAR_IDENTITY_INVALID");
  }

  async #readIssue(id: string, expectedTeamId: string): Promise<LinearIssue> {
    if (!uuidPattern.test(id)) fail("LINEAR_INPUT_INVALID");
    const data = await this.#request("IssueReadback", "query IssueReadback($id: String!) { issue(id: $id) { id identifier title description priority updatedAt team { id } state { id type } assignee { id } } }", { id });
    const result = issue(object(data).issue);
    if (result.id !== id) fail("LINEAR_READBACK_MISMATCH");
    if (result.teamId !== expectedTeamId) fail("LINEAR_TEAM_NOT_ALLOWED");
    return result;
  }

  async #readComment(id: string, expectedIssueId: string): Promise<LinearComment> {
    if (!uuidPattern.test(id)) fail("LINEAR_INPUT_INVALID");
    const data = await this.#request("CommentReadback", "query CommentReadback($id: String!) { comment(id: $id) { id body issue { id } } }", { id });
    const result = comment(object(data).comment);
    if (result.issueId !== expectedIssueId) fail("LINEAR_READBACK_MISMATCH");
    return result;
  }

  #validateCreateIssue(input: LinearCreateIssueInput): void {
    if (!uuidPattern.test(input.id) || !uuidPattern.test(input.teamId)) fail("LINEAR_INPUT_INVALID");
    nonEmpty(input.title); nonEmpty(input.description);
  }

  #validateUpdateIssue(input: LinearUpdateIssueInput): void {
    if (!uuidPattern.test(input.id) || !uuidPattern.test(input.teamId)) fail("LINEAR_INPUT_INVALID");
    if (input.title === undefined && input.description === undefined && input.stateId === undefined && input.assigneeId === undefined) fail("LINEAR_INPUT_INVALID");
    if (input.title !== undefined) nonEmpty(input.title);
    if (input.description !== undefined && input.description !== null) nonEmpty(input.description);
    if (input.stateId !== undefined && input.stateId !== null && !uuidPattern.test(input.stateId)) fail("LINEAR_INPUT_INVALID");
    if (input.assigneeId !== undefined && input.assigneeId !== null && !uuidPattern.test(input.assigneeId)) fail("LINEAR_INPUT_INVALID");
  }

  #validateComment(input: LinearCreateCommentInput): void {
    if (!uuidPattern.test(input.id) || !uuidPattern.test(input.issueId) || !uuidPattern.test(input.teamId)) fail("LINEAR_INPUT_INVALID");
    nonEmpty(input.body);
  }

  async #request(operationName: string, query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const credential = await this.#credentials.getCredential(this.#workspace.credentialName);
    if (credential === undefined || credential.length === 0 || credential.length > 8_192 || credential.includes("\u0000")) fail("LINEAR_CREDENTIAL_MISSING");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.#policy.timeoutMs);
    try {
      const response = await Promise.race([
        this.#fetch(LINEAR_ENDPOINT, { method: "POST", redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", authorization: this.#workspace.authScheme === "bearer" ? `Bearer ${credential}` : credential }, body: JSON.stringify({ operationName, query, variables: variables ?? {} }) }),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new LinearClientError("LINEAR_TIMEOUT")), this.#policy.timeoutMs)),
      ]).catch((error: unknown) => { if (error instanceof LinearClientError) throw error; fail(timedOut ? "LINEAR_TIMEOUT" : "LINEAR_TRANSPORT_FAILED"); });
      const bytes = await Promise.race([
        this.#readBoundedBody(response),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new LinearClientError("LINEAR_TIMEOUT")), this.#policy.timeoutMs)),
      ]);
      if (!response.ok) fail("LINEAR_HTTP_ERROR");
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail("LINEAR_RESPONSE_INVALID"); }
      const envelope = object(parsed, "LINEAR_RESPONSE_INVALID");
      if (Array.isArray(envelope.errors) && envelope.errors.length > 0) fail("LINEAR_GRAPHQL_ERROR", linearResponseDetail(envelope.errors));
      return object(envelope.data, "LINEAR_RESPONSE_INVALID");
    } catch (error) {
      if (error instanceof LinearClientError) throw error;
      fail(timedOut ? "LINEAR_TIMEOUT" : "LINEAR_TRANSPORT_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  }

  async #readBoundedBody(response: Response): Promise<Uint8Array> {
    if (response.body === null) fail("LINEAR_RESPONSE_INVALID");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > this.#policy.maxResponseBytes) {
          await reader.cancel();
          fail("LINEAR_RESPONSE_TOO_LARGE");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  }
}
