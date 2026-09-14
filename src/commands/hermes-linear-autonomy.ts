import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph, objectValues } from "../graph/index.ts";
import type { Quad } from "../graph/nquads.ts";
import { deriveWork } from "../graph/work.ts";
import type { PreparedLinearBinding, LinearBindingSelector } from "./linear-binding.ts";
import { observeLinearBinding } from "./linear-binding.ts";
import { loadCredentialEnvFile, type CredentialEnvironment } from "../providers/config.ts";
import { LinearClient, type LinearIssue, type LinearPolicy, type LinearTeamPolicy, type LinearWorkspacePolicy } from "./linear-client.ts";
import { LinearStateStore, type LinearRecordValue } from "./linear-state.ts";
import { executeLinearDelivery } from "./linear-delivery.ts";
const predicate = (name: string): string => `urn:usf:predicate:${name}`;
const bindingType = "urn:usf:type:LinearIssueWorkBinding";

export function linearReason(error: unknown): string {
  const code = typeof error === "object" && error !== null && "reasonCode" in error ? error.reasonCode : null;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(code) ? code : "HERMES_LINEAR_OPERATION_FAILED";
}

export function linearDetail(error: unknown): string | undefined {
  const detail = typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string" ? error.detail : null;
  const message = detail ?? (error instanceof Error ? error.message : typeof error === "string" ? error : null);
  if (!message) return undefined;
  const normalized = message.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return normalized.length > 512 ? `${normalized.slice(0, 509)}...` : normalized || undefined;
}

function refuse(code: string): never { throw new UsfError(code, exitCodes.CURRENTNESS_FAILURE, code); }

export interface HermesLinearArguments {
  readonly operation: "start" | "stop" | "status";
  readonly policyIri: string;
  readonly manifest: string;
  readonly envFile: string;
  readonly providerEnvFile: string;
  readonly maximumCycles: number | null;
}

export function parseHermesLinearArguments(args: readonly string[]): HermesLinearArguments {
  const operation = args[0];
  if (operation !== "start" && operation !== "stop" && operation !== "status") refuse("HERMES_LINEAR_ARGUMENTS_INVALID");
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1];
    if (!["--linear-policy", "--manifest", "--env-file", "--provider-env-file", "--maximum-cycles"].includes(option)
      || values.has(option) || !value || value.startsWith("--")) refuse("HERMES_LINEAR_ARGUMENTS_INVALID");
    values.set(option, value);
  }
  const policyIri = values.get("--linear-policy");
  const manifest = values.get("--manifest");
  const maximumCycles = values.get("--maximum-cycles");
  if (!policyIri?.startsWith("urn:") || !manifest
    || (maximumCycles !== undefined && (!/^[1-9][0-9]{0,5}$/u.test(maximumCycles) || operation !== "start"))) refuse("HERMES_LINEAR_ARGUMENTS_INVALID");
  return { operation, policyIri, manifest, envFile: values.get("--env-file") ?? ".usf/credentials/linear.env",
    providerEnvFile: values.get("--provider-env-file") ?? ".usf/credentials/providers.env",
    maximumCycles: maximumCycles === undefined ? null : Number(maximumCycles) };
}

export async function loadLinearCredentials(root: string, path: string, names: readonly string[]): Promise<CredentialEnvironment | null> {
  if (!/^\.usf\/credentials\/[A-Za-z0-9._-]+$/u.test(path)) refuse("LINEAR_CREDENTIAL_PATH_INVALID");
  let parent = root;
  for (const part of path.split("/").slice(0, -1)) {
    parent = resolve(parent, part);
    try {
      const metadata = await lstat(parent);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
        || metadata.uid !== process.getuid?.()) refuse("LINEAR_CREDENTIAL_PATH_INVALID");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  try { return await loadCredentialEnvFile(resolve(root, path), names); }
  catch (error) {
    if (linearReason(error) === "CREDENTIAL_ENV_UNREADABLE") return null;
    throw error;
  }
}

export async function readLinearPolicySource(root: string, manifest: string, policyIri: string, runtime = false): Promise<unknown> {
  const graph = loadSemanticGraph(root, manifest);
  const paths = objectValues(graph, policyIri, predicate("repositoryPath"));
  const contracts = objectValues(graph, policyIri, predicate("forContract"));
  if (paths.length !== 1 || contracts.length !== 1) refuse("LINEAR_POLICY_AUTHORITY_MISSING");
  const result = deriveWork(graph, { profile: "urn:usf:profile:hermes-linear-autonomy:1", selector: "urn:usf:work:hermes-linear-autonomy" });
  const packet = result.items?.[0];
  if (result.status !== "ok" || packet?.contract !== contracts[0]
    || (packet.eligibility?.construction.eligible !== true && packet.realisationStage?.completion.verified !== true)) refuse("LINEAR_POLICY_AUTHORITY_INACTIVE");
  if (runtime && packet.realisationStage?.completion.verified !== true) refuse("LINEAR_POLICY_RUNTIME_UNPROVEN");
  const path = paths[0]!;
  if (!/^config\/[A-Za-z0-9._/-]+\.json$/u.test(path)) refuse("LINEAR_POLICY_PATH_INVALID");
  const absolute = resolve(root, path);
  const relation = relative(await realpath(root), await realpath(absolute));
  if (relation.startsWith(`..${sep}`) || relation === ".." || relation !== path) refuse("LINEAR_POLICY_PATH_INVALID");
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65536) refuse("LINEAR_POLICY_PATH_INVALID");
  return JSON.parse(await readFile(absolute, "utf8")) as unknown;
}

export interface LinearLane {
  readonly selector: LinearBindingSelector;
  readonly binding: PreparedLinearBinding;
  readonly contextKey: string;
}

export interface LinearLaneDiscovery {
  readonly lanes: readonly LinearLane[];
  readonly blocked: readonly { bindingIri: string; reasonCode: string; detail?: string }[];
}

export function currentLinearBindingSelections(sources: readonly { manifestPath: string; quads: readonly Quad[] }[]): { manifestPath: string; bindingIri: string }[] {
  const bindings = new Set(sources.flatMap(({ quads }) => quads.filter((q) => q.predicate === predicate("type") && q.object === bindingType).map((q) => q.subject)));
  const superseded = new Set(sources.flatMap(({ quads }) => quads.filter((q) => bindings.has(q.subject)
    && q.predicate === predicate("supersedesBinding") && q.objectKind === "iri").map((q) => q.object)));
  const seen = new Set<string>();
  return sources.flatMap(({ manifestPath, quads }) => quads.flatMap((q) => {
    if (q.predicate !== predicate("type") || q.object !== bindingType || superseded.has(q.subject) || seen.has(q.subject)) return [];
    seen.add(q.subject);
    return [{ manifestPath, bindingIri: q.subject }];
  }));
}

export function linearMutationLedgerSettled(summary: ReturnType<LinearStateStore["summary"]>): boolean {
  return summary.pendingUnknownIntentIds.length === 0 && summary.intents.sent === 0 && summary.intents.prepared === 0;
}

export async function discoverLinearLanes(root: string, manifests: readonly string[]): Promise<LinearLaneDiscovery> {
  const lanes: LinearLane[] = [];
  const blocked: { bindingIri: string; reasonCode: string; detail?: string }[] = [];
  const sources = manifests.map((manifestPath) => ({ manifestPath, quads: loadSemanticGraph(root, manifestPath).quads }));
  for (const { manifestPath, bindingIri } of currentLinearBindingSelections(sources)) {
      const selector = { repositoryRoot: root, manifestPath, bindingIri };
      try {
        const observed = await observeLinearBinding(selector);
        const packet = observed.binding.unit.packet;
        lanes.push({ selector, binding: observed.binding, contextKey: canonicalDigest({
          dependencies: packet.semanticDependencies.filter((dependency) => packet.readSet.includes(dependency.key)), readSet: packet.readSet,
          capabilities: packet.modelCapabilities, privacy: packet.privacy,
        }) });
      } catch (error) { blocked.push({ bindingIri, reasonCode: linearReason(error), detail: linearDetail(error) }); }
  }
  const duplicates = new Set(lanes.filter((lane) => lanes.some((other) => other !== lane
    && other.binding.authority.locator === lane.binding.authority.locator)).map((lane) => lane.selector.bindingIri));
  for (const bindingIri of duplicates) blocked.push({ bindingIri, reasonCode: "LINEAR_BINDING_LOCATOR_AMBIGUOUS" });
  return { lanes: lanes.filter((lane) => !duplicates.has(lane.selector.bindingIri))
    .sort((a, b) => a.contextKey.localeCompare(b.contextKey) || a.selector.bindingIri.localeCompare(b.selector.bindingIri)), blocked };
}

function pathOverlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right.replace(/\/$/u, "")}/`) || right.startsWith(`${left.replace(/\/$/u, "")}/`);
}

export function compatibleLinearLanes(left: LinearLane, right: LinearLane): boolean {
  const a = left.binding.unit.packet;
  const b = right.binding.unit.packet;
  return left.binding.authority.locator !== right.binding.authority.locator
    && a.id !== b.id && !a.dependsOn.includes(b.id) && !b.dependsOn.includes(a.id)
    && !a.writeSet.some((path) => [...b.readSet, ...b.writeSet].some((other) => pathOverlaps(path, other)))
    && !b.writeSet.some((path) => a.readSet.some((other) => pathOverlaps(path, other)));
}

export interface LinearCycleOutcome {
  readonly bindingIri: string;
  readonly status: "completed" | "blocked" | "progress";
  readonly reasonCode?: string;
  readonly detail?: string;
  readonly evidence: readonly string[];
}

/** Scope compatibility limits concurrency; provider calls retain their own graph-derived caps. */
export async function runLinearLaneCycle(
  lanes: readonly LinearLane[], concurrency: number,
  execute: (lane: LinearLane) => Promise<LinearCycleOutcome>,
  stopped: () => boolean = () => false,
): Promise<readonly LinearCycleOutcome[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64) refuse("LINEAR_CONCURRENCY_INVALID");
  const pending = [...lanes];
  const active = new Map<LinearLane, Promise<void>>();
  const outcomes: LinearCycleOutcome[] = [];
  while ((pending.length > 0 && !stopped()) || active.size > 0) {
    while (!stopped() && active.size < concurrency) {
      const index = pending.findIndex((lane) => [...active.keys()].every((other) => compatibleLinearLanes(lane, other)));
      if (index < 0) break;
      const lane = pending.splice(index, 1)[0]!;
      const promise = Promise.resolve().then(() => execute(lane)).then(
        (result) => { outcomes.push(result); },
        (error: unknown) => { outcomes.push({ bindingIri: lane.selector.bindingIri, status: "blocked", reasonCode: linearReason(error), detail: linearDetail(error), evidence: [] }); },
      ).finally(() => { active.delete(lane); });
      active.set(lane, promise);
    }
    if (active.size === 0) break;
    await Promise.race(active.values());
  }
  return outcomes.sort((a, b) => a.bindingIri.localeCompare(b.bindingIri));
}

function recordValue(value: unknown): LinearRecordValue {
  return JSON.parse(JSON.stringify(value)) as LinearRecordValue;
}

interface RemoteLane {
  readonly client: LinearClient;
  readonly workspace: LinearWorkspacePolicy;
  readonly team: LinearTeamPolicy;
  readonly issue: LinearIssue;
}

/** Durable remote intents are serialized; model/check work is not held behind this queue. */
export class LinearMutations {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly store: LinearStateStore;
  constructor(store: LinearStateStore) { this.store = store; }

  run<T>(identity: { bindingIri: string; operation: string; remoteOperationId: string }, request: unknown,
    readBack: (id: string) => Promise<T | null>, send: (id: string) => Promise<unknown>): Promise<T> {
    const operation = this.tail.then(async () => {
      const digest = canonicalDigest(request);
      const intent = await this.store.prepare(identity, digest);
      if (intent.state === "refused") refuse("LINEAR_MUTATION_REFUSED");
      if (intent.state !== "prepared") {
        const observed = await readBack(intent.id);
        if (observed !== null) {
          await this.store.reconcile({ intentId: intent.id, remoteOperationId: identity.remoteOperationId,
            requestDigest: digest, outcome: "confirmed", evidenceRefs: [canonicalDigest(observed)] });
          return observed;
        }
        refuse("LINEAR_MUTATION_OUTCOME_UNKNOWN");
      }
      await this.store.markSent(intent.id);
      // Any throw after sent is intentionally retained for positive reconciliation, never retransmission.
      try { await send(intent.id); }
      catch (error) { await this.store.markUnknown(intent.id); throw error; }
      const observed = await readBack(intent.id);
      if (observed === null) refuse("LINEAR_MUTATION_READBACK_MISMATCH");
      await this.store.reconcile({ intentId: intent.id, remoteOperationId: identity.remoteOperationId,
        requestDigest: digest, outcome: "confirmed", evidenceRefs: [canonicalDigest(observed)] });
      return observed;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}

async function commentRemoteEvidence(mutations: LinearMutations, lane: LinearLane, remote: RemoteLane,
  disposition: string, evidence: readonly string[]): Promise<void> {
  const body = `Hermes CLI governed delivery\nBinding: ${lane.selector.bindingIri}\nWork: ${lane.binding.authority.workIri}\nBasis: ${lane.binding.basis.basisDigest}\nDisposition: ${disposition}\nEvidence:\n${evidence.join("\n")}\nProvider output alone is not completion.`;
  // Legacy v1/v2 comment intents used caller UUIDs as remote identities; keep their unknown outcomes visible and never replay them.
  await mutations.run({ bindingIri: lane.selector.bindingIri, operation: `comment-v4-${canonicalDigest(body)}`,
    remoteOperationId: remote.issue.id }, { issueId: remote.issue.id, body }, async (id) => {
    return remote.client.findComment(remote.issue.id, remote.team.id, body);
  }, (id) => remote.client.createComment({ id, issueId: remote.issue.id, teamId: remote.team.id, body }));
}

async function updateRemoteState(mutations: LinearMutations, lane: LinearLane, remote: RemoteLane,
  target: "started" | "completed", evidence: readonly string[]): Promise<void> {
  const states = await remote.client.workflowStates(remote.team.id);
  const explicit = target === "started" ? remote.team.startedStateId : remote.team.completedStateId;
  const matches = states.filter((state) => explicit === null ? state.type === target : state.id === explicit && state.type === target);
  if (matches.length !== 1) refuse("LINEAR_WORKFLOW_STATE_AMBIGUOUS");
  const stateId = matches[0]!.id;
  const assigneeId = remote.team.assigneeId;
  const request = { id: remote.issue.id, teamId: remote.team.id, stateId, ...(assigneeId === null ? {} : { assigneeId }) };
  await mutations.run({ bindingIri: lane.selector.bindingIri, operation: `issue-${target}-${canonicalDigest(evidence)}`,
    remoteOperationId: remote.issue.id }, request, async () => {
    const observed = await remote.client.getIssue(remote.issue.id, remote.team.id);
    return observed.stateId === stateId && (assigneeId === null || observed.assigneeId === assigneeId) ? observed : null;
  }, () => remote.client.updateIssue(request));
}

export async function createDeclaredLinearIssues(root: string, policy: LinearPolicy, credentials: CredentialEnvironment,
  mutations: LinearMutations): Promise<readonly { proposalIri: string; issueId?: string; reasonCode?: string; detail?: string }[]> {
  const results: { proposalIri: string; issueId?: string; reasonCode?: string; detail?: string }[] = [];
  const seen = new Set<string>();
  for (const manifest of policy.bindingManifests) {
    const graph = loadSemanticGraph(root, manifest);
    const proposals = graph.quads.filter((q) => q.predicate === predicate("type") && q.object === "urn:usf:type:LinearIssueProposal").map((q) => q.subject);
    for (const proposalIri of [...new Set(proposals)].sort()) {
      if (seen.has(proposalIri)) continue;
      seen.add(proposalIri);
      try {
        const one = (name: string): string => {
          const values = objectValues(graph, proposalIri, predicate(name));
          if (values.length !== 1) refuse("LINEAR_ISSUE_PROPOSAL_INVALID");
          return values[0]!;
        };
        const workspace = policy.workspaces.find((item) => item.organizationUrlKey === one("issueWorkspace"));
        const team = workspace?.teams.find((item) => item.id === one("issueTeamUuid") && item.owner === one("owningModel"));
        if (!workspace || !team || !policy.allowCreate) refuse("LINEAR_ISSUE_PROPOSAL_NOT_ALLOWED");
        const work = deriveWork(loadSemanticGraph(root, one("targetManifest")), { selector: one("workIri"), profile: one("selectedProfile") });
        if (work.status !== "ok" || work.items?.length !== 1
          || (work.items[0]?.eligibility?.construction.eligible !== true && work.items[0]?.realisationStage?.completion.verified !== true)) refuse("LINEAR_ISSUE_PROPOSAL_WORK_INACTIVE");
        const request = { id: one("issueUuid"), teamId: team.id, title: one("title"), description: one("description") };
        const client = new LinearClient({ policy, workspaceKey: workspace.key, credentials });
        const observed = await mutations.run({ bindingIri: proposalIri, operation: "create-issue", remoteOperationId: request.id }, request,
          async () => {
            const issue = await client.getIssue(request.id, request.teamId);
            return issue.title === request.title && issue.description === request.description ? issue : null;
          }, () => client.createIssue(request));
        results.push({ proposalIri, issueId: observed.id });
      } catch (error) { results.push({ proposalIri, reasonCode: linearReason(error), detail: linearDetail(error) }); }
    }
  }
  return results;
}

export async function runHermesLinearCycle(root: string, policy: LinearPolicy, credentials: CredentialEnvironment,
  store: LinearStateStore, providerEnvFile: string, concurrency: number, stopped: () => boolean): Promise<unknown> {
  const mutations = new LinearMutations(store);
  const proposals = await createDeclaredLinearIssues(root, policy, credentials, mutations);
  const discovered = await discoverLinearLanes(root, policy.bindingManifests);
  const remote = new Map<string, RemoteLane>();
  const discoveryErrors: { workspace: string; teamId: string; reasonCode: string; detail?: string }[] = [];
  for (const workspace of policy.workspaces) {
    const client = new LinearClient({ policy, workspaceKey: workspace.key, credentials });
    for (const team of workspace.teams) {
      try {
        for (const issue of await client.discoverTeamIssues(team.id)) {
          remote.set(`${workspace.organizationUrlKey}:${issue.id}`, { workspace, team, issue, client });
        }
      } catch (error) { discoveryErrors.push({ workspace: workspace.key, teamId: team.id, reasonCode: linearReason(error), detail: linearDetail(error) }); }
    }
  }
  // Completed/canceled issues are absent from intake but exact graph bindings
  // still need direct readback before their semantic disposition is reported.
  for (const lane of discovered.lanes) {
    if (remote.has(lane.binding.authority.locator)) continue;
    const workspace = policy.workspaces.find((item) => item.organizationUrlKey === lane.binding.authority.workspace);
    const team = workspace?.teams.find((item) => item.owner === lane.binding.authority.owner);
    if (!workspace || !team) continue;
    const client = new LinearClient({ policy, workspaceKey: workspace.key, credentials });
    try {
      const issue = await client.getIssue(lane.binding.authority.issueUuid, team.id);
      remote.set(lane.binding.authority.locator, { client, workspace, team, issue });
    } catch (error) { discoveryErrors.push({ workspace: workspace.key, teamId: team.id, reasonCode: linearReason(error), detail: linearDetail(error) }); }
  }
  const previous = new Map(store.progress().map((item) => [item.bindingIri, item.updatedAt]));
  const ordered = [...discovered.lanes].sort((a, b) => {
    const priority = (lane: LinearLane): number => remote.get(lane.binding.authority.locator)?.issue.priority || 5;
    return priority(a) - priority(b)
      || (previous.get(a.selector.bindingIri) ?? "").localeCompare(previous.get(b.selector.bindingIri) ?? "")
      || a.contextKey.localeCompare(b.contextKey) || a.selector.bindingIri.localeCompare(b.selector.bindingIri);
  });
  const outcomes = await runLinearLaneCycle(ordered, concurrency, async (lane) => {
    const match = remote.get(lane.binding.authority.locator);
    if (!match || match.team.owner !== lane.binding.authority.owner) refuse("LINEAR_BOUND_ISSUE_NOT_OBSERVED");
    const before = await observeLinearBinding(lane.selector);
    if (before.status !== "COMPLETED") await updateRemoteState(mutations, lane, match, "started", [lane.binding.basis.basisDigest]);
    const delivered = await executeLinearDelivery(root, lane.selector, providerEnvFile);
    const evidence = [delivered.evidence.checkpointPath, canonicalDigest(delivered.evidence)];
    if (delivered.status !== "completed") {
      await store.recordProgress({ bindingIri: lane.selector.bindingIri, stage: "blocked", blocker: delivered.reasonCode, evidenceRefs: evidence });
      await commentRemoteEvidence(mutations, lane, match, delivered.reasonCode, evidence);
      return { bindingIri: lane.selector.bindingIri, status: "blocked", reasonCode: delivered.reasonCode, evidence };
    }
    const settled = await observeLinearBinding(lane.selector);
    if (settled.status !== "COMPLETED") refuse("LINEAR_COMPLETION_NOT_CURRENT");
    const acceptedEvidence = [...evidence, settled.integrationReceipt, settled.evidence, settled.proofResult];
    await commentRemoteEvidence(mutations, lane, match, "semantic completion verified", acceptedEvidence);
    await updateRemoteState(mutations, lane, match, "completed", acceptedEvidence);
    await store.recordProgress({ bindingIri: lane.selector.bindingIri, stage: "completed", blocker: null, evidenceRefs: acceptedEvidence });
    return { bindingIri: lane.selector.bindingIri, status: "completed", evidence: acceptedEvidence };
  }, stopped);
  const updateErrors: { bindingIri: string; reasonCode: string; detail?: string }[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== "blocked") continue;
    const lane = discovered.lanes.find((item) => item.selector.bindingIri === outcome.bindingIri)!;
    const match = remote.get(lane.binding.authority.locator);
    try {
      await store.recordProgress({ bindingIri: outcome.bindingIri, stage: "blocked", blocker: outcome.reasonCode ?? "HERMES_LINEAR_OPERATION_FAILED", evidenceRefs: outcome.evidence });
      if (match) await commentRemoteEvidence(mutations, lane, match, outcome.reasonCode ?? "HERMES_LINEAR_OPERATION_FAILED", outcome.evidence);
    } catch (error) { updateErrors.push({ bindingIri: outcome.bindingIri, reasonCode: linearReason(error), detail: linearDetail(error) }); }
  }
  const boundLocators = new Set(discovered.lanes.map((lane) => lane.binding.authority.locator));
  const unbound = [...remote.entries()].filter(([locator]) => !boundLocators.has(locator)).map(([locator]) => locator).sort();
  return { schema: "urn:usf:hermes-linear-cycle:1", observedAt: new Date().toISOString(), policyDigest: canonicalDigest(policy),
    remoteIssueCount: remote.size, boundLaneCount: discovered.lanes.length, outcomes, discoveryErrors, updateErrors,
    authorityBlockers: discovered.blocked, proposals, unboundIssueLocators: unbound, state: store.summary(),
    terminal: discoveryErrors.length === 0 && updateErrors.length === 0 && discovered.blocked.length === 0 && unbound.length === 0
      && linearMutationLedgerSettled(store.summary())
      && proposals.every((proposal) => proposal.reasonCode === undefined)
      && outcomes.length === discovered.lanes.length && outcomes.every((outcome) => outcome.status === "completed"),
    nonclaims: ["Unbound Linear prose does not authorize semantic work.", "Context grouping is not evidence of provider cache hits.", "Only current published semantic completion permits a remote completed state."] };
}
