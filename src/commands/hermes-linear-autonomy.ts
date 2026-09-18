import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { loadSemanticGraph, objectValues } from "../graph/index.ts";
import type { Quad } from "../graph/nquads.ts";
import { deriveLinearBindingDeclaration } from "../graph/linear-binding.ts";
import { deriveWork } from "../graph/work.ts";
import { observeLinearBinding } from "./linear-binding.ts";
import { loadCredentialEnvFile, type CredentialEnvironment } from "../providers/config.ts";
import { LinearClient, readLinearPolicySource, type LinearIssue, type LinearPolicy, type LinearTeamPolicy, type LinearWorkspacePolicy } from "./linear-client.ts";
export { readLinearPolicySource } from "./linear-client.ts";
import { LinearStateStore, type LinearRecordValue } from "./linear-state.ts";
import { executeLinearDelivery } from "./linear-delivery.ts";
import { LinearFailureRecovery, recoveryEscalation, type LinearLane, type LinearRecoveryDisposition, type LinearMutationGuard } from "./linear-remediation.ts";
export type { LinearLane } from "./linear-remediation.ts";
const predicate = (name: string): string => `urn:usf:predicate:${name}`;
const bindingType = "urn:usf:type:LinearIssueWorkBinding";

export function linearReason(error: unknown): string {
  const code = typeof error === "object" && error !== null
    ? ("reasonCode" in error ? error.reasonCode : ("code" in error ? error.code : null))
    : null;
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


export interface LinearLaneDiscovery {
  readonly lanes: readonly LinearLane[];
  readonly blocked: readonly { bindingIri: string; reasonCode: string; detail?: string }[];
}

function linearBindingSelectionPlan(sources: readonly { manifestPath: string; quads: readonly Quad[] }[]) {
  const repairs = new Map<string, { manifestPath: string; authority: ReturnType<typeof deriveLinearBindingDeclaration> }>();
  for (const { manifestPath, quads } of sources) {
    for (const bindingIri of new Set(quads.filter(q => q.predicate === predicate("candidateRepair")).map(q => q.subject))) {
      const authority = deriveLinearBindingDeclaration({ quads } as ReturnType<typeof loadSemanticGraph>, bindingIri);
      if (authority.candidateRepair === undefined) refuse("LINEAR_BINDING_REPAIR_POLICY_INVALID");
      const previous = repairs.get(bindingIri);
      if (previous !== undefined && canonicalDigest(previous.authority) !== canonicalDigest(authority)) {
        refuse("LINEAR_BINDING_REPAIR_POLICY_INVALID");
      }
      if (previous === undefined) repairs.set(bindingIri, { manifestPath, authority });
    }
  }
  const conditional = new Set([...repairs.values()].filter(item => item.authority.candidateRepair!.round > 0)
    .map(item => item.authority.bindingIri));
  const bindings = new Set(sources.flatMap(({ quads }) => quads.filter(q => q.predicate === predicate("type") && q.object === bindingType).map(q => q.subject)));
  // A conditional repair cannot hide its predecessor before the kernel admits it.
  const superseded = new Set(sources.flatMap(({ quads }) => quads.filter(q => bindings.has(q.subject)
    && !conditional.has(q.subject) && q.predicate === predicate("supersedesBinding") && q.objectKind === "iri").map(q => q.object)));
  const seen = new Set<string>();
  const selections = sources.flatMap(({ manifestPath, quads }) => quads.flatMap(q => {
    if (q.predicate !== predicate("type") || q.object !== bindingType || superseded.has(q.subject)
      || conditional.has(q.subject) || seen.has(q.subject)) return [];
    seen.add(q.subject);
    return [{ manifestPath, bindingIri: q.subject }];
  }));
  return { selections, repairs };
}

export function currentLinearBindingSelections(sources: readonly { manifestPath: string; quads: readonly Quad[] }[]): { manifestPath: string; bindingIri: string }[] {
  return linearBindingSelectionPlan(sources).selections;
}

export function linearMutationLedgerSettled(summary: ReturnType<LinearStateStore["summary"]>): boolean {
  return summary.pendingUnknownIntentIds.length === 0 && summary.intents.sent === 0 && summary.intents.prepared === 0;
}

export async function discoverLinearLanes(root: string, manifests: readonly string[]): Promise<LinearLaneDiscovery> {
  const lanes: LinearLane[] = [];
  const blocked: { bindingIri: string; reasonCode: string; detail?: string }[] = [];
  const readSources = () => manifests.map(manifestPath => ({ manifestPath, quads: loadSemanticGraph(root, manifestPath).quads }));
  const sources = readSources();
  const snapshot = canonicalDigest(sources);
  const plan = linearBindingSelectionPlan(sources);
  for (const initial of plan.selections) {
    let selector = { repositoryRoot: root, ...initial };
    try {
      let observed = await observeLinearBinding(selector);
      const repairRoot = observed.binding.authority.candidateRepair?.rootBinding;
      while (observed.status === "SETTLED" && observed.binding.authority.candidateRepair !== undefined) {
        const policy = observed.binding.authority.candidateRepair;
        if (policy.round >= policy.maximumRounds) break;
        const successors = [...plan.repairs.values()].filter(({ authority }) =>
          authority.candidateRepair!.rootBinding === repairRoot
          && authority.candidateRepair!.round === policy.round + 1
          && authority.candidateRepair!.predecessorBinding === selector.bindingIri);
        if (successors.length !== 1) refuse("LINEAR_BINDING_REPAIR_POLICY_INVALID");
        const successor = successors[0]!;
        const next = { repositoryRoot: root, manifestPath: successor.manifestPath, bindingIri: successor.authority.bindingIri };
        try {
          const admitted = await observeLinearBinding(next);
          selector = next;
          observed = admitted;
        } catch (error) {
          // Only a positively authenticated, valid predecessor response keeps
          // its existing delivery lane. Uncertain admission never falls back.
          if (linearReason(error) === "LINEAR_BINDING_REPAIR_NOT_ADMITTED") break;
          selector = next;
          throw error;
        }
      }
      if (repairRoot !== undefined && canonicalDigest(readSources()) !== snapshot) refuse("LINEAR_BINDING_AUTHORITY_MISMATCH");
      const packet = observed.binding.unit.packet;
      lanes.push({ selector, binding: observed.binding, observedStatus: observed.status, contextKey: canonicalDigest({
        dependencies: packet.semanticDependencies.filter(dependency => packet.readSet.includes(dependency.key)), readSet: packet.readSet,
        capabilities: packet.modelCapabilities, privacy: packet.privacy,
      }) });
    } catch (error) { blocked.push({ bindingIri: selector.bindingIri, reasonCode: linearReason(error), detail: linearDetail(error) }); }
  }
  const duplicates = new Set(lanes.filter(lane => lanes.some(other => other !== lane
    && other.binding.authority.locator === lane.binding.authority.locator)).map(lane => lane.selector.bindingIri));
  for (const bindingIri of duplicates) blocked.push({ bindingIri, reasonCode: "LINEAR_BINDING_LOCATOR_AMBIGUOUS" });
  return { lanes: lanes.filter(lane => !duplicates.has(lane.selector.bindingIri))
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
  readonly recovery?: LinearRecoveryDisposition;
}

export interface LinearCommentReconciliation {
  readonly observed: number;
  readonly confirmed: readonly string[];
  readonly unresolved: readonly { intentId: string; reasonCode: string }[];
  readonly deferred: number;
}

const historicalCommentCursors = new Map<string, string>();

/** Observe retained effects independently of current runnable binding selection.
 * Only the supervisor-owned store may apply these positive observations.
 * One comment never discharges multiple distinct historical intents.
 */
export async function reconcileHistoricalLinearComments(
  root: string, policy: LinearPolicy, credentials: CredentialEnvironment,
  store: LinearStateStore, stopped: () => boolean = () => false,
): Promise<LinearCommentReconciliation> {
  const all = store.intents();
  const pending = all.filter(intent => intent.state === "sent" || intent.state === "unknown")
    .sort((a, b) => a.id.localeCompare(b.id));
  if (pending.length === 0 || stopped()) return { observed: 0, confirmed: [], unresolved: [], deferred: pending.length };
  const bound = Math.min(64, policy.pageSize * policy.maxPages);
  if (!Number.isSafeInteger(bound) || bound < 1) return {
    observed: 0, confirmed: [], unresolved: pending.map(intent => ({
      intentId: intent.id, reasonCode: "LINEAR_RECONCILIATION_POLICY_INVALID",
    })), deferred: 0,
  };
  const after = historicalCommentCursors.get(root);
  const next = after === undefined ? 0 : pending.findIndex(intent => intent.id > after);
  const start = next < 0 ? 0 : next;
  const selected = [...pending.slice(start), ...pending.slice(0, start)].slice(0, bound);
  if (!historicalCommentCursors.has(root) && historicalCommentCursors.size >= 64) {
    historicalCommentCursors.delete(historicalCommentCursors.keys().next().value!);
  }
  historicalCommentCursors.set(root, selected[selected.length - 1]!.id);
  const confirmed: string[] = [];
  const unresolved: { intentId: string; reasonCode: string }[] = [];
  const outcome = (intentId: string, reasonCode: string) => { unresolved.push({ intentId, reasonCode }); };
  const policyDigest = canonicalDigest(policy);
  const readSources = () => policy.bindingManifests.map(manifest => loadSemanticGraph(root, manifest));
  const snapshotDigest = (graphs: readonly ReturnType<typeof loadSemanticGraph>[]) => canonicalDigest(
    graphs.map((graph, index) => ({ manifest: policy.bindingManifests[index], quads: graph.quads })),
  );
  let sources: ReturnType<typeof loadSemanticGraph>[];
  try { sources = readSources(); }
  catch {
    return { observed: 0, confirmed, unresolved: selected.map(intent => ({
      intentId: intent.id, reasonCode: "LINEAR_RECONCILIATION_AUTHORITY_UNAVAILABLE",
    })), deferred: pending.length - selected.length };
  }
  const authoritySnapshotDigest = snapshotDigest(sources);
  type Retained = typeof selected[number];
  const groups = new Map<string, {
    workspace: LinearWorkspacePolicy; team: LinearTeamPolicy; issueId: string;
    members: { intent: Retained; bodyDigest: string; authorityDigest: string }[];
  }>();
  for (const intent of selected) {
    const operation = /^comment(?:-v[234])?-(sha256:[0-9a-f]{64})$/u.exec(intent.identity.operation);
    if (operation === null) { outcome(intent.id, "LINEAR_RECONCILIATION_OPERATION_UNSUPPORTED"); continue; }
    // Include settled intents in the cardinality check: an old unresolved send
    // cannot inherit another distinct intent's already-confirmed observation.
    const equivalent = all.filter(other => other.identity.remoteOperationId === intent.identity.remoteOperationId
      && other.requestDigest === intent.requestDigest);
    if (equivalent.length !== 1) { outcome(intent.id, "LINEAR_COMMENT_INTENT_IDENTITY_AMBIGUOUS"); continue; }
    try {
      const declarations = sources.filter(graph => graph.quads.some(quad => quad.subject === intent.identity.bindingIri
        && quad.predicate === predicate("type") && quad.objectKind === "iri" && quad.object === bindingType))
        .map(graph => deriveLinearBindingDeclaration(graph, intent.identity.bindingIri));
      if (declarations.length === 0
        || new Set(declarations.map(declaration => canonicalDigest(declaration))).size !== 1) {
        refuse("LINEAR_RECONCILIATION_BINDING_AUTHORITY_INVALID");
      }
      const authority = declarations[0]!;
      if (authority.issueUuid !== intent.identity.remoteOperationId) refuse("LINEAR_RECONCILIATION_REMOTE_IDENTITY_MISMATCH");
      const workspace = policy.workspaces.find(item => item.organizationUrlKey === authority.workspace);
      const teams = workspace?.teams.filter(item => item.owner === authority.owner) ?? [];
      if (!workspace || teams.length !== 1) refuse("LINEAR_RECONCILIATION_OWNER_AMBIGUOUS");
      const team = teams[0]!;
      const key = canonicalDigest({ workspace: workspace.key, teamId: team.id, issueId: authority.issueUuid });
      const group = groups.get(key) ?? { workspace, team, issueId: authority.issueUuid, members: [] };
      group.members.push({ intent, bodyDigest: operation[1]!, authorityDigest: canonicalDigest(authority) });
      groups.set(key, group);
    } catch (error) { outcome(intent.id, linearReason(error)); }
  }
  let observed = 0;
  const clients = new Map<string, LinearClient>();
  for (const group of groups.values()) {
    if (stopped()) {
      for (const { intent } of group.members) outcome(intent.id, "LINEAR_RECONCILIATION_STOPPED");
      continue;
    }
    try {
      const client = clients.get(group.workspace.key) ?? new LinearClient({
        policy, workspaceKey: group.workspace.key, credentials,
      });
      clients.set(group.workspace.key, client);
      const comments = await client.findCommentRequestMatches(group.issueId, group.team.id,
        group.members.map(({ intent, bodyDigest }) => ({ requestDigest: intent.requestDigest, bodyDigest })));
      observed += group.members.length;
      for (const { intent, bodyDigest, authorityDigest } of group.members) {
        const matches = comments.filter(comment => comment.issueId === group.issueId
          && canonicalDigest(comment.body) === bodyDigest
          && canonicalDigest({ issueId: comment.issueId, body: comment.body }) === intent.requestDigest);
        if (matches.length !== 1) {
          outcome(intent.id, matches.length === 0 ? "LINEAR_COMMENT_POSTCONDITION_UNOBSERVED" : "LINEAR_COMMENT_READBACK_AMBIGUOUS");
          continue;
        }
        if (stopped()) { outcome(intent.id, "LINEAR_RECONCILIATION_STOPPED"); continue; }
        const evidence = canonicalDigest({
          schema: "urn:usf:linear-comment-positive-readback:1",
          intentId: intent.id, requestDigest: intent.requestDigest,
          bindingAuthorityDigest: authorityDigest, authoritySnapshotDigest, policyDigest,
          workspace: group.workspace.organizationUrlKey,
          teamId: group.team.id, comment: matches[0]!,
        });
        const result = await store.reconcile({
          intentId: intent.id, remoteOperationId: intent.identity.remoteOperationId,
          requestDigest: intent.requestDigest, outcome: "confirmed", evidenceRefs: [evidence],
        }, undefined, (currentIntent, currentIntents) => {
          // This guard runs inside the store's serialized mutation, not before
          // joining its queue. The caller retains supervisor activity ownership.
          if (stopped()) refuse("LINEAR_RECONCILIATION_STOPPED");
          let fresh: ReturnType<typeof loadSemanticGraph>[];
          try { fresh = readSources(); }
          catch { refuse("LINEAR_RECONCILIATION_AUTHORITY_STALE"); }
          if (canonicalDigest(policy) !== policyDigest || snapshotDigest(fresh!) !== authoritySnapshotDigest) {
            refuse("LINEAR_RECONCILIATION_AUTHORITY_STALE");
          }
          const currentDeclarations = fresh!.filter(graph => graph.quads.some(quad =>
            quad.subject === intent.identity.bindingIri && quad.predicate === predicate("type")
            && quad.objectKind === "iri" && quad.object === bindingType))
            .map(graph => deriveLinearBindingDeclaration(graph, intent.identity.bindingIri));
          if (currentDeclarations.length === 0
            || currentDeclarations.some(declaration => canonicalDigest(declaration) !== authorityDigest)) {
            refuse("LINEAR_RECONCILIATION_AUTHORITY_STALE");
          }
          if (canonicalDigest(currentIntent) !== canonicalDigest(intent)) refuse("LINEAR_RECONCILIATION_INTENT_STALE");
          if (currentIntents.filter(other => other.identity.remoteOperationId === intent.identity.remoteOperationId
            && other.requestDigest === intent.requestDigest).length !== 1) {
            refuse("LINEAR_COMMENT_INTENT_IDENTITY_AMBIGUOUS");
          }
        });
        if (result.status === "reconciled" && result.intent.state === "confirmed") confirmed.push(intent.id);
        else outcome(intent.id, "LINEAR_RECONCILIATION_IDENTITY_CHANGED");
      }
    } catch (error) {
      for (const { intent } of group.members) if (!confirmed.includes(intent.id)
        && !unresolved.some(item => item.intentId === intent.id)) outcome(intent.id, linearReason(error));
    }
  }
  return { observed, confirmed: confirmed.sort(), unresolved: unresolved.sort((a, b) => a.intentId.localeCompare(b.intentId)),
    deferred: pending.length - selected.length };
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
        (error: unknown) => {
          const reasonCode = linearReason(error);
          outcomes.push({ bindingIri: lane.selector.bindingIri, status: "blocked", reasonCode,
            evidence: [], recovery: recoveryEscalation(reasonCode) });
        },
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
    readBack: (id: string) => Promise<T | null>, send: (id: string) => Promise<unknown>, guard?: LinearMutationGuard): Promise<T> {
    const operation = this.tail.then(async () => {
      await guard?.authenticate();
      guard?.current();
      const digest = canonicalDigest(request);
      const intent = await this.store.prepare(identity, digest);
      await guard?.authenticate(intent.id);
      guard?.current(intent.id);
      if (intent.state === "refused") refuse("LINEAR_MUTATION_REFUSED");
      if (intent.state !== "prepared") {
        const observed = await readBack(intent.id);
        await guard?.authenticate(intent.id);
        guard?.current(intent.id);
        if (observed !== null) {
          await this.store.reconcile({ intentId: intent.id, remoteOperationId: identity.remoteOperationId,
            requestDigest: digest, outcome: "confirmed", evidenceRefs: [canonicalDigest(observed)] }, undefined, () => guard?.current(intent.id));
          return observed;
        }
        refuse("LINEAR_MUTATION_OUTCOME_UNKNOWN");
      }
      await this.store.markSent(intent.id);
      // Any throw after sent is intentionally retained for positive reconciliation, never retransmission.
      try {
        await guard?.authenticate(intent.id);
        guard?.current(intent.id);
        await send(intent.id);
      }
      catch (error) { await this.store.markUnknown(intent.id); throw error; }
      await guard?.authenticate(intent.id);
      guard?.current(intent.id);
      const observed = await readBack(intent.id);
      await guard?.authenticate(intent.id);
      guard?.current(intent.id);
      if (observed === null) refuse("LINEAR_MUTATION_READBACK_MISMATCH");
      await this.store.reconcile({ intentId: intent.id, remoteOperationId: identity.remoteOperationId,
        requestDigest: digest, outcome: "confirmed", evidenceRefs: [canonicalDigest(observed)] }, undefined, () => guard?.current(intent.id));
      return observed;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}

async function commentRemoteEvidence(mutations: LinearMutations, lane: LinearLane, remote: RemoteLane,
  disposition: string, evidence: readonly string[], guard?: LinearMutationGuard): Promise<void> {
  const body = `Hermes CLI governed delivery\nBinding: ${lane.selector.bindingIri}\nWork: ${lane.binding.authority.workIri}\nBasis: ${lane.binding.basis.basisDigest}\nDisposition: ${disposition}\nEvidence:\n${evidence.join("\n")}\nProvider output alone is not completion.`;
  // Legacy v1/v2 comment intents used caller UUIDs as remote identities; keep their unknown outcomes visible and never replay them.
  await mutations.run({ bindingIri: lane.selector.bindingIri, operation: `comment-v4-${canonicalDigest(body)}`,
    remoteOperationId: remote.issue.id }, { issueId: remote.issue.id, body }, async (id) => {
    return remote.client.findComment(remote.issue.id, remote.team.id, body);
  }, (id) => remote.client.createComment({ id, issueId: remote.issue.id, teamId: remote.team.id, body }), guard);
}

async function updateRemoteState(mutations: LinearMutations, lane: LinearLane, remote: RemoteLane,
  target: "started" | "completed", evidence: readonly string[], guard?: LinearMutationGuard): Promise<void> {
  const states = await remote.client.workflowStates(remote.team.id);
  const explicit = target === "started" ? remote.team.startedStateId : remote.team.completedStateId;
  const matches = states.filter((state) => explicit === null ? state.type === target : state.id === explicit && state.type === target);
  if (matches.length !== 1) refuse("LINEAR_WORKFLOW_STATE_AMBIGUOUS");
  const stateId = matches[0]!.id;
  const assigneeId = remote.team.assigneeId;
  if (remote.issue.stateId === stateId && (assigneeId === null || remote.issue.assigneeId === assigneeId)) return;
  const request = { id: remote.issue.id, teamId: remote.team.id, stateId, ...(assigneeId === null ? {} : { assigneeId }) };
  await mutations.run({ bindingIri: lane.selector.bindingIri, operation: `issue-${target}-${canonicalDigest(evidence)}`,
    remoteOperationId: remote.issue.id }, request, async () => {
    const observed = await remote.client.getIssue(remote.issue.id, remote.team.id);
    return observed.stateId === stateId && (assigneeId === null || observed.assigneeId === assigneeId) ? observed : null;
  }, () => remote.client.updateIssue(request), guard);
}

export async function createDeclaredLinearIssues(root: string, policy: LinearPolicy, credentials: CredentialEnvironment,
  mutations: LinearMutations, recovery?: LinearFailureRecovery): Promise<readonly { proposalIri: string; issueId?: string; reasonCode?: string; detail?: string }[]> {
  const results: { proposalIri: string; issueId?: string; reasonCode?: string; detail?: string }[] = [];
  const seen = new Set<string>();
  for (const manifest of policy.bindingManifests) {
    const graph = loadSemanticGraph(root, manifest);
    const proposals = graph.quads.filter((q) => q.predicate === predicate("type") && q.object === "urn:usf:type:LinearIssueProposal").map((q) => q.subject);
    for (const proposalIri of [...new Set(proposals)].sort()) {
      if (seen.has(proposalIri)) continue;
      seen.add(proposalIri);
      if (recovery && !recovery.proposalAllowed(proposalIri)) {
        results.push({ proposalIri, reasonCode: "LINEAR_RECOVERY_PROPOSAL_DEFERRED" });
        continue;
      }
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
          }, () => client.createIssue(request), recovery?.guardFor(proposalIri));
        results.push({ proposalIri, issueId: observed.id });
      } catch (error) { results.push({ proposalIri, reasonCode: linearReason(error), detail: linearDetail(error) }); }
    }
  }
  return results;
}

export async function runHermesLinearCycle(root: string, policy: LinearPolicy, credentials: CredentialEnvironment,
  store: LinearStateStore, providerEnvFile: string, concurrency: number, stopped: () => boolean): Promise<unknown> {
  const mutations = new LinearMutations(store);
  const reconciliation = await reconcileHistoricalLinearComments(root, policy, credentials, store, stopped);
  const discovered = await discoverLinearLanes(root, policy.bindingManifests);
  const recovery = new LinearFailureRecovery(root, policy, store, stopped);
  await recovery.plan(discovered.lanes);
  const proposals = await createDeclaredLinearIssues(root, policy, credentials, mutations, recovery);
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
  // Completed/canceled issues are absent from intake but retain exact direct readback.
  for (const lane of discovered.lanes) {
    if (remote.has(lane.binding.authority.locator)) continue;
    const workspace = policy.workspaces.find(item => item.organizationUrlKey === lane.binding.authority.workspace);
    const team = workspace?.teams.find(item => item.owner === lane.binding.authority.owner);
    if (!workspace || !team) continue;
    const client = new LinearClient({ policy, workspaceKey: workspace.key, credentials });
    try {
      const issue = await client.getIssue(lane.binding.authority.issueUuid, team.id);
      remote.set(lane.binding.authority.locator, { client, workspace, team, issue });
    } catch (error) { discoveryErrors.push({ workspace: workspace.key, teamId: team.id, reasonCode: linearReason(error), detail: linearDetail(error) }); }
  }
  const previous = new Map(store.progress().map(item => [item.bindingIri, item]));
  const runnable = discovered.lanes.filter(lane => {
    const disposition = recovery.dispositions.get(lane.selector.bindingIri);
    if (disposition && !["repair-ready", "resume-ready", "completed"].includes(disposition.disposition)) return false;
    const prior = previous.get(lane.selector.bindingIri);
    if (prior?.stage === "completed" && prior.basisDigest === lane.binding.basis.basisDigest && lane.observedStatus === "COMPLETED") return false;
    if (disposition?.disposition === "repair-ready" || disposition?.disposition === "resume-ready"
      || lane.observedStatus === "COMPLETED") return true;
    return prior?.stage !== "blocked";
  });
  const runnableIds = new Set(runnable.map(lane => lane.selector.bindingIri));
  const ordered = [...runnable].sort((a, b) => {
    const priority = (lane: LinearLane): number => remote.get(lane.binding.authority.locator)?.issue.priority || 5;
    return priority(a) - priority(b)
      || (previous.get(a.selector.bindingIri)?.updatedAt ?? "").localeCompare(previous.get(b.selector.bindingIri)?.updatedAt ?? "")
      || a.contextKey.localeCompare(b.contextKey) || a.selector.bindingIri.localeCompare(b.selector.bindingIri);
  });
  const executedOutcomes = await runLinearLaneCycle(ordered, concurrency, async lane => {
    const match = remote.get(lane.binding.authority.locator);
    if (!match || match.team.owner !== lane.binding.authority.owner) refuse("LINEAR_BOUND_ISSUE_NOT_OBSERVED");
    const guard = recovery.guardFor(lane.selector.bindingIri);
    await guard?.authenticate();
    const before = await observeLinearBinding(lane.selector);
    let evidence: string[] = [];
    let settled = before;
    if (before.status !== "COMPLETED") {
      await updateRemoteState(mutations, lane, match, "started", [lane.binding.basis.basisDigest], guard);
      await recovery.beforeLane(lane);
      const delivered = await executeLinearDelivery(root, lane.selector, providerEnvFile);
      evidence = [delivered.evidence.checkpointPath, canonicalDigest(delivered.evidence)].filter(reference => reference.length > 0);
      if (delivered.status !== "completed") {
        const disposition = await recovery.retain(lane, delivered);
        if (disposition.intakeKey) evidence.push(disposition.intakeKey);
        return { bindingIri: lane.selector.bindingIri, status: "blocked", reasonCode: delivered.reasonCode, evidence, recovery: disposition };
      }
      settled = await observeLinearBinding(lane.selector);
    }
    if (settled.status !== "COMPLETED") refuse("LINEAR_COMPLETION_NOT_CURRENT");
    await guard?.authenticate();
    guard?.current();
    const acceptedEvidence = [...evidence, settled.integrationReceipt, settled.evidence, settled.proofResult];
    await commentRemoteEvidence(mutations, lane, match, "semantic completion verified", acceptedEvidence, guard);
    await updateRemoteState(mutations, lane, match, "completed", acceptedEvidence, guard);
    await guard?.authenticate();
    guard?.current();
    await store.recordProgress({ bindingIri: lane.selector.bindingIri, basisDigest: settled.binding.basis.basisDigest, stage: "completed", blocker: null, evidenceRefs: acceptedEvidence });
    return { bindingIri: lane.selector.bindingIri, status: "completed", evidence: acceptedEvidence,
      ...(recovery.dispositions.has(lane.selector.bindingIri) ? { recovery: recovery.dispositions.get(lane.selector.bindingIri) } : {}) };
  }, stopped);
  const executedIds = new Set(executedOutcomes.map(outcome => outcome.bindingIri));
  const deferredOutcomes: LinearCycleOutcome[] = discovered.lanes.filter(lane => !executedIds.has(lane.selector.bindingIri)).map(lane => {
    const prior = previous.get(lane.selector.bindingIri);
    const disposition = recovery.dispositions.get(lane.selector.bindingIri);
    const completed = prior?.stage === "completed" && lane.observedStatus === "COMPLETED"
      && (!disposition || disposition.disposition === "completed");
    return {
      bindingIri: lane.selector.bindingIri, status: completed ? "completed" : "blocked",
      ...(!completed ? { reasonCode: disposition?.reasonCode ?? (runnableIds.has(lane.selector.bindingIri) ? "LINEAR_RECOVERY_STOPPED" : prior?.blocker ?? "LINEAR_RECOVERY_FAILURE_UNKNOWN"),
        recovery: disposition ?? recoveryEscalation(prior?.blocker ?? "LINEAR_RECOVERY_STOPPED") } : {}),
      evidence: prior?.evidenceRefs ?? [],
    };
  });
  const outcomes = [...executedOutcomes, ...deferredOutcomes].sort((a, b) => a.bindingIri.localeCompare(b.bindingIri));
  const updateErrors: { bindingIri: string; reasonCode: string; detail?: string }[] = [];
  // Preserve blocked progress even when an uncertain lane cannot execute.
  // Withheld repair intake is not a failed repair attempt and must not consume its budget.
  for (const outcome of outcomes) {
    if (outcome.status !== "blocked") continue;
    if (!executedIds.has(outcome.bindingIri) && recovery.repairBindings.has(outcome.bindingIri)) continue;
    const lane = discovered.lanes.find(item => item.selector.bindingIri === outcome.bindingIri)!;
    const match = remote.get(lane.binding.authority.locator);
    try {
      await store.recordProgress({ bindingIri: outcome.bindingIri, basisDigest: lane.binding.basis.basisDigest, stage: "blocked", blocker: outcome.reasonCode ?? "HERMES_LINEAR_OPERATION_FAILED", evidenceRefs: outcome.evidence });
      const guard = recovery.guardFor(outcome.bindingIri);
      // Reporting a known refusal is not repair authority. Keep the existing
      // deduplicated comment, but never add effects for uncertain remote outcomes.
      if (match && executedIds.has(outcome.bindingIri)
        && outcome.recovery?.externalBoundary !== "remote-intent-reconciliation"
        && !/UNKNOWN|STARTED/u.test(outcome.reasonCode ?? "")) {
        await commentRemoteEvidence(mutations, lane, match, outcome.reasonCode ?? "HERMES_LINEAR_OPERATION_FAILED", outcome.evidence, guard);
      }
    } catch (error) { updateErrors.push({ bindingIri: outcome.bindingIri, reasonCode: linearReason(error), detail: linearDetail(error) }); }
  }
  const boundLocators = new Set(discovered.lanes.map(lane => lane.binding.authority.locator));
  const unbound = [...remote.entries()].filter(([locator]) => !boundLocators.has(locator)).map(([locator]) => locator).sort();
  return { schema: "urn:usf:hermes-linear-cycle:1", observedAt: new Date().toISOString(), policyDigest: canonicalDigest(policy),
    remoteIssueCount: remote.size, boundLaneCount: discovered.lanes.length, outcomes, discoveryErrors, updateErrors,
    authorityBlockers: discovered.blocked.map(blocker => ({ ...blocker, recovery: recoveryEscalation(blocker.reasonCode) })),
    proposals, reconciliation, unboundIssueLocators: unbound, state: store.summary(),
    terminal: discoveryErrors.length === 0 && updateErrors.length === 0 && discovered.blocked.length === 0 && unbound.length === 0
      && linearMutationLedgerSettled(store.summary())
      && proposals.every(proposal => proposal.reasonCode === undefined)
      && outcomes.length === discovered.lanes.length && outcomes.every(outcome => outcome.status === "completed"),
    nonclaims: ["Unbound Linear prose does not authorize semantic work.", "Recovery intake and repair completion confer no authority on the original work.", "Only current published semantic completion permits a remote completed state."] };
}
