import { canonicalDigest } from "../core/canonical.ts";
import { inspectCheckCommand } from "../core/check-command.ts";
import { loadSemanticGraph } from "../graph/index.ts";
import type { Quad } from "../graph/nquads.ts";
import { deriveWork } from "../graph/work.ts";
import { observeLinearBinding, type LinearBindingResult, type LinearBindingSelector, type PreparedLinearBinding } from "./linear-binding.ts";
import { readLinearRecord, writeLinearRecord, type LinearRecordValue, type LinearStateStore } from "./linear-state.ts";
import type { LinearPolicy } from "./linear-client.ts";

const P = "urn:usf:predicate:";
const TYPE = "urn:usf:type:HermesFailureRecoveryRule";
const FAMILY = "CHECK_COMMAND_CONTRACT_INVALID";
const NATIVE_PRE_EFFECT_REFUSAL = "LINEAR_BINDING_NATIVE_COMPLETION_STATE_INVALID";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTROLLER = "urn:usf:work:hermes-linear-autonomy";
const PROFILE = "urn:usf:profile:hermes-linear-autonomy:1";

export interface LinearLane {
  readonly selector: LinearBindingSelector;
  readonly binding: PreparedLinearBinding;
  readonly contextKey: string;
  readonly observedStatus?: Awaited<ReturnType<typeof observeLinearBinding>>["status"];
}

export interface LinearDeliveryEvidence {
  readonly bindingIri: string;
  /** Compatibility alias retained for the foreground controller. */
  readonly checkpointPath: string;
  readonly checkpointRecordKey: string;
  readonly preparedStatus: LinearBindingResult["status"];
  readonly settledStatus: LinearBindingResult["status"] | null;
  readonly candidateDigest: string | null;
  readonly checkReceiptPaths: readonly string[];
  readonly integration: unknown | null;
  readonly completion: unknown | null;
}

export type LinearDeliveryOutcome =
  | { readonly status: "completed"; readonly evidence: LinearDeliveryEvidence }
  | { readonly status: "refused"; readonly reasonCode: string; readonly evidence: LinearDeliveryEvidence; readonly failure?: LinearDeliveryFailure };

export interface LinearRecoveryRule {
  readonly iri: string;
  readonly forContract: string;
  readonly sourceWork: string;
  readonly failureClass: typeof FAMILY;
  readonly repairBinding: string;
  readonly repairProposal: string | null;
  readonly maximumRepairAttempts: number;
}

export interface LinearDeliveryFailure {
  readonly phase: "admission-validation" | "validation" | "completion-validation";
  readonly validationIri: string;
  readonly candidateDigest: string | null;
  readonly reasonCode: string;
  readonly resultDigest: string;
  readonly confinementFailure: string | null;
  readonly commandContract: Extract<ReturnType<typeof inspectCheckCommand>, { status: "invalid" }> | null;
}

export interface LinearRecoveryDisposition {
  readonly disposition: "escalated" | "awaiting-repair" | "repair-ready" | "resume-ready" | "completed";
  readonly reasonCode: string;
  readonly externalBoundary: "authority" | "investigation" | "remote-intent-reconciliation" | "budget" | "lineage" | "normal-supervisor" | "none";
  readonly intakeKey?: string;
  readonly repairBinding?: string;
}

export interface LinearMutationGuard {
  authenticate(intentId?: string): Promise<void>;
  current(intentId?: string): void;
}

type Observed = LinearBindingResult;
interface FailureRecord {
  schema: "urn:usf:linear-delivery-failure:1";
  bindingIri: string;
  basisDigest: string;
  attemptKey: string;
  authorityDigest: string;
  reasonCode: string;
  failure: LinearDeliveryFailure | null;
  evidenceDigest: string;
}
interface Intake {
  schema: "urn:usf:linear-failure-recovery:1";
  sourceBinding: string;
  failureDigest: string;
  ruleDigest: string;
  controllerBasis: string;
  sourceBasis: string;
  sourceAttempt: string;
  sourceAuthority: string;
  repairAuthority: string;
  repairBasis: string;
  repairAttempt: string;
  state: "queued" | "dispatched" | "resume-reserved" | "completed";
  attempts: number;
}
interface Route {
  source: LinearLane;
  repair: LinearLane;
  rule: LinearRecoveryRule;
  intake: Intake;
  intakeKey: string;
  snapshot: string;
  controllerBasis: string;
  sourceObserved: Observed;
  repairObserved: Observed;
}

function fail(reasonCode: string): never { throw Object.assign(new Error(reasonCode), { reasonCode }); }
function code(error: unknown): string {
  const value = error && typeof error === "object" && "reasonCode" in error ? error.reasonCode : null;
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value) ? value : "LINEAR_RECOVERY_DIAGNOSIS_FAILED";
}
function record(value: unknown): LinearRecordValue { return JSON.parse(JSON.stringify(value)) as LinearRecordValue; }
function same(left: unknown, right: unknown): boolean { return canonicalDigest(left) === canonicalDigest(right); }
function key(kind: string, bindingIri: string): string { return `recovery-${kind}-${canonicalDigest(bindingIri).slice(7)}`; }
function field(quads: readonly Quad[], iri: string, name: string, kind: "iri" | "literal", optional = false): string | null {
  const rows = quads.filter(q => q.subject === iri && q.predicate === P + name);
  if (optional && rows.length === 0) return null;
  if (rows.length !== 1 || rows[0]!.objectKind !== kind || !rows[0]!.object || rows[0]!.object.length > 512) fail("LINEAR_RECOVERY_POLICY_INVALID");
  return rows[0]!.object;
}

export function deriveLinearRecoveryRules(sources: readonly { quads: readonly Quad[] }[]): readonly LinearRecoveryRule[] {
  const rules = new Map<string, LinearRecoveryRule>();
  for (const { quads } of sources) {
    for (const iri of new Set(quads.filter(q => q.predicate === P + "type" && q.objectKind === "iri" && q.object === TYPE).map(q => q.subject))) {
      const maximum = field(quads, iri, "maximumRepairAttempts", "literal")!;
      if (!/^[1-4]$/u.test(maximum) || field(quads, iri, "failureClass", "literal") !== FAMILY) fail("LINEAR_RECOVERY_POLICY_INVALID");
      const rule: LinearRecoveryRule = {
        iri, forContract: field(quads, iri, "forContract", "iri")!,
        sourceWork: field(quads, iri, "sourceWork", "iri")!, failureClass: FAMILY,
        repairBinding: field(quads, iri, "repairBinding", "iri")!,
        repairProposal: field(quads, iri, "repairProposal", "iri", true),
        maximumRepairAttempts: Number(maximum),
      };
      if (rules.has(iri) && !same(rules.get(iri), rule)) fail("LINEAR_RECOVERY_POLICY_AMBIGUOUS");
      rules.set(iri, Object.freeze(rule));
      if (rules.size > 64) fail("LINEAR_RECOVERY_POLICY_INVALID");
    }
  }
  const targets = new Set<string>();
  for (const rule of rules.values()) {
    if (targets.has(rule.repairBinding)) fail("LINEAR_RECOVERY_LINEAGE_AMBIGUOUS");
    targets.add(rule.repairBinding);
  }
  return Object.freeze([...rules.values()].sort((a, b) => a.iri.localeCompare(b.iri)));
}

export function recoveryEscalation(reasonCode: string): LinearRecoveryDisposition {
  const externalBoundary = /UNKNOWN|STARTED|INTENT|INTERRUPTED/u.test(reasonCode) ? "remote-intent-reconciliation"
    : /BUDGET|EXHAUSTED/u.test(reasonCode) ? "budget"
    : /BASIS|LINEAGE|AMBIGUOUS|RECORD|ATTEMPT/u.test(reasonCode) ? "lineage"
    : /AUTHORITY|POLICY|RULE|BINDING_MISSING|PROPOSAL/u.test(reasonCode) ? "authority" : "investigation";
  return { disposition: "escalated", reasonCode, externalBoundary };
}

/** This is a read-only reproduction, never an inference from provider prose or a confinement label. */
export function diagnoseLinearFailure(root: string, binding: PreparedLinearBinding, failure: FailureRecord) {
  if (failure.reasonCode !== FAMILY && failure.reasonCode !== "CHECK_CONFINEMENT_UNAVAILABLE") {
    fail("LINEAR_RECOVERY_FAILURE_UNKNOWN");
  }
  const graph = loadSemanticGraph(root, binding.unit.manifestPath);
  const selected = binding.unit.packet.validationPlan.filter(item =>
    failure.failure === null || item.id === failure.failure.validationIri);
  const invalid = selected.flatMap(validation => {
    const command = field(graph.quads, validation.id, "command", "literal")!;
    if (command !== validation.command) fail("LINEAR_RECOVERY_SOURCE_BASIS_CHANGED");
    const inspected = inspectCheckCommand(command.split(" "));
    return inspected.status === "invalid" ? [{
      validationIri: validation.id, commandDigest: canonicalDigest(command),
      reasonCode: inspected.reasonCode, detail: inspected.detail,
    }] : [];
  });
  if (invalid.length !== 1) fail(invalid.length === 0 ? "LINEAR_RECOVERY_FAILURE_NOT_REPRODUCED" : "LINEAR_RECOVERY_LINEAGE_AMBIGUOUS");
  return invalid[0]!;
}

/**
 * One supervisor-cycle coordinator. Private records are operational intake, NOT
 * authority or a second network ledger. Remote creation stays in LinearMutations.
 * Each declared repair binding can consume at most one native attempt; the rule
 * bound is an upper limit, never permission to fabricate successor bindings.
 */
export class LinearFailureRecovery {
  readonly dispositions = new Map<string, LinearRecoveryDisposition>();
  readonly repairBindings = new Set<string>();
  readonly repairProposals = new Set<string>();
  private readonly routes = new Map<string, Route>();
  private readonly rules: readonly LinearRecoveryRule[];
  private readonly policyDigest: string;
  private readonly root: string;
  private readonly policy: LinearPolicy;
  private readonly store: LinearStateStore;
  private readonly stopped: () => boolean;
  private readonly policyError: string | null;
  private lanes: readonly LinearLane[] = [];

  constructor(root: string, policy: LinearPolicy, store: LinearStateStore, stopped: () => boolean = () => false) {
    this.root = root; this.policy = policy; this.store = store; this.stopped = stopped;
    this.policyDigest = canonicalDigest(policy);
    let rules: readonly LinearRecoveryRule[] = [], policyError: string | null = null;
    try {
      const sources = this.sources();
      for (const graph of sources) {
        const subjects = new Set(graph.quads.filter(q => q.predicate === P + "type" && q.object === TYPE).map(q => q.subject));
        for (const q of graph.quads) {
          if (!subjects.has(q.subject) || q.objectKind !== "iri") continue;
          if (q.predicate === P + "repairBinding") this.repairBindings.add(q.object);
          if (q.predicate === P + "repairProposal") this.repairProposals.add(q.object);
        }
      }
      rules = deriveLinearRecoveryRules(sources);
    } catch (error) { policyError = code(error); }
    this.rules = rules; this.policyError = policyError;
  }

  private sources() { return this.policy.bindingManifests.map(manifest => loadSemanticGraph(this.root, manifest)); }
  private snapshot(): string { return canonicalDigest(this.sources().map((graph, index) => ({ manifest: this.policy.bindingManifests[index], quads: graph.quads }))); }
  private controller(rule: LinearRecoveryRule): string {
    const packets = [loadSemanticGraph(this.root, "graph/manifests/hermes-linear-autonomy.json")]
      .map(graph => deriveWork(graph, { selector: CONTROLLER, profile: PROFILE }))
      .filter(result => result.status === "ok" && result.items?.length === 1).map(result => result.items![0]!)
.filter(packet => packet.contract === rule.forContract
        && (packet.eligibility?.construction.eligible === true || packet.realisationStage?.completion.verified === true));
    const bases = new Set(packets.map(packet => packet.realisationBasis?.basisDigest));
    if (bases.size !== 1 || packets.length === 0 || ![...bases][0] || !DIGEST.test([...bases][0]!)) fail("LINEAR_RECOVERY_CONTROLLER_AUTHORITY_MISSING");
    return [...bases][0]!;
  }
  private uncertain(bindings: readonly string[], intentId?: string): void {
    if (this.store.intents().some(intent => intent.id !== intentId && bindings.includes(intent.identity.bindingIri)
      && (intent.state === "sent" || intent.state === "unknown"))) fail("LINEAR_RECOVERY_REMOTE_INTENT_UNKNOWN");
  }
  private currentBinding(observed: Observed): void {
    const { authority, unit, basis } = observed.binding;
    const work = deriveWork(loadSemanticGraph(this.root, authority.targetManifest), { selector: authority.workIri, profile: authority.profile });
    const packet = work.items?.[0];
    if (work.status !== "ok" || work.items?.length !== 1 || packet?.realisationBasis?.basisDigest !== basis.basisDigest
      || unit.basisDigest !== basis.basisDigest
      || (packet.eligibility?.construction.eligible !== true && packet.realisationStage?.completion.verified !== true)) {
      fail("LINEAR_RECOVERY_BINDING_AUTHORITY_CHANGED");
    }
  }
  private assertCurrent(route: Route, intentId?: string): void {
    if (this.stopped()) fail("LINEAR_RECOVERY_STOPPED");
    if (canonicalDigest(this.policy) !== this.policyDigest || this.snapshot() !== route.snapshot
      || this.controller(route.rule) !== route.controllerBasis) fail("LINEAR_RECOVERY_POLICY_AUTHORITY_CHANGED");
    this.uncertain([route.source.selector.bindingIri, route.repair.selector.bindingIri, ...(route.rule.repairProposal ? [route.rule.repairProposal] : [])], intentId);
    this.currentBinding(route.sourceObserved);
    this.currentBinding(route.repairObserved);
  }
  private async authenticate(route: Route, intentId?: string): Promise<void> {
    const source = await observeLinearBinding(route.source.selector);
    if (this.snapshot() !== route.snapshot || this.controller(route.rule) !== route.controllerBasis) fail("LINEAR_RECOVERY_POLICY_AUTHORITY_CHANGED");
    const repair = await observeLinearBinding(route.repair.selector);
    if (this.snapshot() !== route.snapshot || this.controller(route.rule) !== route.controllerBasis) fail("LINEAR_RECOVERY_POLICY_AUTHORITY_CHANGED");
    for (const [now, prior] of [[source, route.sourceObserved], [repair, route.repairObserved]] as const) {
      if (!same(now.binding.authority, prior.binding.authority)
        || (now.status !== "COMPLETED" && (now.binding.unit.attemptKey !== prior.binding.unit.attemptKey
          || now.binding.basis.basisDigest !== prior.binding.basis.basisDigest
          || now.status !== prior.status))) fail("LINEAR_RECOVERY_BINDING_AUTHORITY_CHANGED");
      if (now.status === "UNKNOWN" || now.status === "STARTED") fail("LINEAR_RECOVERY_ATTEMPT_UNKNOWN");
    }
    route.sourceObserved = source;
    route.repairObserved = repair;
    this.assertCurrent(route, intentId);
  }
  private async save(route: Route): Promise<void> {
    await this.authenticate(route);
    this.assertCurrent(route);
    await writeLinearRecord(this.root, route.intakeKey, record(route.intake));
    this.assertCurrent(route);
  }
  private failure(lane: LinearLane, outcome: Extract<LinearDeliveryOutcome, { status: "refused" }>): FailureRecord {
    const { binding } = lane;
    if (!DIGEST.test(binding.basis.basisDigest) || !DIGEST.test(binding.unit.attemptKey)) fail("LINEAR_RECOVERY_SOURCE_AUTHORITY_MISSING");
    return {
      schema: "urn:usf:linear-delivery-failure:1", bindingIri: lane.selector.bindingIri,
      basisDigest: binding.basis.basisDigest, attemptKey: binding.unit.attemptKey,
      authorityDigest: canonicalDigest(binding.authority), reasonCode: outcome.reasonCode,
      failure: outcome.failure ?? null, evidenceDigest: canonicalDigest(outcome.evidence),
    };
  }

  /**
   * A native successor can be retried only when the retained refusal proves the
   * old kernel stopped at its state-admission boundary.  The exact current
   * no-change binding must still be PREPARED and must match the retained basis,
   * attempt and authority.  Any reservation or later effect changes that
   * observation and remains fail-closed in the native completion kernel.
   */
  private admitNativePreEffectResume(lane: LinearLane, failure: FailureRecord): boolean {
    if (failure.reasonCode !== NATIVE_PRE_EFFECT_REFUSAL) return false;
    const { authority, basis, attempt, unit } = lane.binding;
    if (failure.failure !== null
      || lane.observedStatus !== "PREPARED" || attempt.state !== "PREPARED"
      || authority.realisationDisposition !== "no-change" || typeof authority.supersedes !== "string"
      || failure.basisDigest !== basis.basisDigest || failure.attemptKey !== unit.attemptKey
      || failure.authorityDigest !== canonicalDigest(authority)) fail("LINEAR_RECOVERY_NATIVE_PRE_EFFECT_UNPROVEN");
    this.currentBinding({ status: "PREPARED", binding: lane.binding });
    this.dispositions.set(authority.bindingIri, {
      disposition: "resume-ready", reasonCode: "LINEAR_RECOVERY_NATIVE_PRE_EFFECT_RETRY_ADMITTED",
      externalBoundary: "normal-supervisor",
    });
    return true;
  }

  async plan(lanes: readonly LinearLane[]): Promise<void> {
    this.lanes = lanes;
    for (const lane of lanes) {
      const prior = this.store.progress().find(item => item.bindingIri === lane.selector.bindingIri);
      try {
        if (this.policyError) fail(this.policyError);
        this.uncertain([lane.selector.bindingIri]);
        if (lane.binding.attempt.state === "STARTED" || lane.binding.attempt.state === "UNKNOWN") fail("LINEAR_RECOVERY_ATTEMPT_UNKNOWN");
        const retained = await readLinearRecord(this.root, key("failure", lane.selector.bindingIri));
        if (retained !== null) await this.reconcile(lane, retained);
        else if (prior?.stage === "blocked" && lane.observedStatus !== "COMPLETED") this.dispositions.set(lane.selector.bindingIri, recoveryEscalation(prior.blocker ?? "LINEAR_RECOVERY_FAILURE_UNKNOWN"));
        else if (prior?.stage === "completed" && lane.observedStatus !== "COMPLETED") fail("LINEAR_RECOVERY_COMPLETION_NOT_CURRENT");
      } catch (error) { this.dispositions.set(lane.selector.bindingIri, recoveryEscalation(code(error))); }
    }
    for (const bindingIri of this.repairBindings) {
      if (this.dispositions.has(bindingIri)) continue;
      const completed = [...this.routes.values()].find(route => route.rule.repairBinding === bindingIri && route.intake.state === "completed");
      this.dispositions.set(bindingIri, completed
        ? { disposition: "completed", reasonCode: "LINEAR_RECOVERY_CURRENT_COMPLETION_VERIFIED", externalBoundary: "none", intakeKey: completed.intakeKey, repairBinding: bindingIri }
        : recoveryEscalation("LINEAR_RECOVERY_INTAKE_NOT_ADMITTED"));
    }
  }

  async retain(lane: LinearLane, outcome: Extract<LinearDeliveryOutcome, { status: "refused" }>): Promise<LinearRecoveryDisposition> {
    try {
      const failure = this.failure(lane, outcome);
      const failureKey = key("failure", lane.selector.bindingIri);
      const prior = await readLinearRecord(this.root, failureKey);
      // Preserve the original failure and its budget across restarts and later bases.
      if (prior === null) {
        const observed = await observeLinearBinding(lane.selector);
        if (!same(observed.binding.authority, lane.binding.authority)
          || observed.binding.unit.attemptKey !== lane.binding.unit.attemptKey) fail("LINEAR_RECOVERY_SOURCE_BASIS_CHANGED");
        this.currentBinding(observed);
        await writeLinearRecord(this.root, failureKey, record(failure));
        this.currentBinding(observed);
      }
      await this.reconcile(lane, prior ?? record(failure));
    } catch (error) { this.dispositions.set(lane.selector.bindingIri, recoveryEscalation(code(error))); }
    return this.dispositions.get(lane.selector.bindingIri) ?? recoveryEscalation("LINEAR_RECOVERY_FAILURE_UNKNOWN");
  }

  private async reconcile(lane: LinearLane, retained: LinearRecordValue): Promise<void> {
    const sourceId = lane.selector.bindingIri;
    if (!retained || typeof retained !== "object" || Array.isArray(retained)) fail("LINEAR_RECOVERY_RECORD_INVALID");
    const failure = retained as unknown as FailureRecord;
    if (failure.schema !== "urn:usf:linear-delivery-failure:1" || failure.bindingIri !== sourceId
      || !DIGEST.test(failure.basisDigest) || !DIGEST.test(failure.attemptKey)
      || !DIGEST.test(failure.authorityDigest) || !DIGEST.test(failure.evidenceDigest)
      || typeof failure.reasonCode !== "string" || failure.failure === undefined) fail("LINEAR_RECOVERY_RECORD_INVALID");
    if (this.policyError) fail(this.policyError);
    if (this.admitNativePreEffectResume(lane, failure)) return;
    if (failure.reasonCode !== FAMILY && failure.reasonCode !== "CHECK_CONFINEMENT_UNAVAILABLE") fail("LINEAR_RECOVERY_FAILURE_UNKNOWN");
    if (failure.failure !== null && (!["admission-validation", "validation", "completion-validation"].includes(failure.failure.phase)
      || typeof failure.failure.validationIri !== "string" || !failure.failure.validationIri.startsWith("urn:")
      || (failure.failure.candidateDigest === null ? failure.failure.phase !== "admission-validation" : !DIGEST.test(failure.failure.candidateDigest))
      || !DIGEST.test(failure.failure.resultDigest)
      || failure.failure.reasonCode !== failure.reasonCode)) fail("LINEAR_RECOVERY_RECORD_INVALID");
    const matching = this.rules.filter(rule => rule.sourceWork === lane.binding.authority.workIri);
    if (matching.length !== 1) fail(matching.length === 0 ? "LINEAR_RECOVERY_RULE_AUTHORITY_MISSING" : "LINEAR_RECOVERY_RULE_AMBIGUOUS");
    const rule = matching[0]!;
    const repair = this.lanes.find(item => item.selector.bindingIri === rule.repairBinding);
    if (!repair) fail("LINEAR_RECOVERY_REPAIR_BINDING_MISSING");
    if (repair.selector.bindingIri === sourceId || repair.binding.authority.workIri === rule.sourceWork
      || this.rules.some(other => other.sourceWork === repair.binding.authority.workIri)
      || repair.binding.authority.candidateRepair !== undefined) fail("LINEAR_RECOVERY_LINEAGE_AMBIGUOUS");
    if (rule.repairProposal !== null) this.assertProposal(rule, repair);
    const snapshot = this.snapshot(), controllerBasis = this.controller(rule);
    const sourceObserved = await observeLinearBinding(lane.selector);
    if (this.snapshot() !== snapshot) fail("LINEAR_RECOVERY_POLICY_AUTHORITY_CHANGED");
    const repairObserved = await observeLinearBinding(repair.selector);
    const intakeKey = key("intake", sourceId);
    const previous = await readLinearRecord(this.root, intakeKey);
    const intake = previous as unknown as Intake | null;
    const route: Route = { source: lane, repair, rule, intake: intake!, intakeKey, snapshot, controllerBasis, sourceObserved, repairObserved };
    this.assertCurrent(route);
    this.uncertain([sourceId, rule.repairBinding, ...(rule.repairProposal ? [rule.repairProposal] : [])]);
    if (!same(sourceObserved.binding.authority, lane.binding.authority) || failure.authorityDigest !== canonicalDigest(sourceObserved.binding.authority)) fail("LINEAR_RECOVERY_SOURCE_AUTHORITY_CHANGED");
    if (sourceObserved.status === "STARTED" || sourceObserved.status === "UNKNOWN"
      || repairObserved.status === "STARTED" || repairObserved.status === "UNKNOWN") fail("LINEAR_RECOVERY_ATTEMPT_UNKNOWN");
    if (intake !== null) {
      if (intake.schema !== "urn:usf:linear-failure-recovery:1" || intake.sourceBinding !== sourceId
        || intake.failureDigest !== canonicalDigest(failure) || intake.ruleDigest !== canonicalDigest(rule)
        || intake.controllerBasis !== controllerBasis || intake.sourceBasis !== failure.basisDigest
        || intake.sourceAttempt !== failure.attemptKey || intake.sourceAuthority !== failure.authorityDigest
        || intake.repairAuthority !== canonicalDigest(repairObserved.binding.authority)
        || !DIGEST.test(intake.repairBasis) || !DIGEST.test(intake.repairAttempt)
        || !["queued", "dispatched", "resume-reserved", "completed"].includes(intake.state)
        || !Number.isSafeInteger(intake.attempts) || intake.attempts < 0 || intake.attempts > rule.maximumRepairAttempts
        || (intake.state === "queued" && intake.attempts !== 0)
        || (intake.state === "dispatched" && intake.attempts !== 1)) fail("LINEAR_RECOVERY_INTAKE_AUTHORITY_CHANGED");
      if (repairObserved.status === "COMPLETED") {
        if (sourceObserved.status === "COMPLETED") {
          route.intake = { ...intake, state: "completed" };
          if (intake.state !== "completed") await this.save(route);
          this.routes.set(sourceId, route);
          this.dispositions.set(sourceId, { disposition: "completed", reasonCode: "LINEAR_RECOVERY_CURRENT_COMPLETION_VERIFIED", externalBoundary: "none", intakeKey, repairBinding: rule.repairBinding });
          return;
        }
        if (sourceObserved.binding.basis.basisDigest !== intake.sourceBasis
          || sourceObserved.binding.unit.attemptKey !== intake.sourceAttempt) fail("LINEAR_RECOVERY_SOURCE_BASIS_CHANGED");
        if (intake.state === "resume-reserved" || intake.state === "completed") fail("LINEAR_RECOVERY_RESUMPTION_EXHAUSTED");
        // A repair's completion is not proof that the original validation contract now holds.
        const graph = loadSemanticGraph(this.root, sourceObserved.binding.unit.manifestPath);
        if (sourceObserved.binding.unit.packet.validationPlan.some(validation =>
          inspectCheckCommand(field(graph.quads, validation.id, "command", "literal")!.split(" ")).status !== "valid")) fail("LINEAR_RECOVERY_REPAIR_POSTCONDITION_UNMET");
        this.routes.set(sourceId, route);
        this.dispositions.set(sourceId, { disposition: "resume-ready", reasonCode: "LINEAR_RECOVERY_SAME_BASIS_RESUMPTION", externalBoundary: "none", intakeKey, repairBinding: rule.repairBinding });
        return;
      }
      if (intake.state !== "queued" && intake.state !== "dispatched") fail("LINEAR_RECOVERY_LINEAGE_AMBIGUOUS");
      if (intake.repairBasis !== repairObserved.binding.basis.basisDigest || intake.repairAttempt !== repairObserved.binding.unit.attemptKey) fail("LINEAR_RECOVERY_REPAIR_BASIS_CHANGED");
      if (intake.state === "dispatched" && repairObserved.status !== "SETTLED") fail("LINEAR_RECOVERY_DISPATCH_INTERRUPTED");
      const repairProgress = this.store.progress().find(item => item.bindingIri === rule.repairBinding);
      if (repairProgress?.stage === "blocked") fail("LINEAR_RECOVERY_REPAIR_BUDGET_EXHAUSTED");
    } else {
      if (sourceObserved.binding.basis.basisDigest !== failure.basisDigest
        || sourceObserved.binding.unit.attemptKey !== failure.attemptKey) fail("LINEAR_RECOVERY_SOURCE_BASIS_CHANGED");
      diagnoseLinearFailure(this.root, sourceObserved.binding, failure);
      if (repairObserved.status !== "PREPARED") fail("LINEAR_RECOVERY_REPAIR_ATTEMPT_NOT_FRESH");
      route.intake = {
        schema: "urn:usf:linear-failure-recovery:1", sourceBinding: sourceId, failureDigest: canonicalDigest(failure),
        ruleDigest: canonicalDigest(rule), controllerBasis, sourceBasis: failure.basisDigest,
        sourceAttempt: failure.attemptKey, sourceAuthority: failure.authorityDigest,
        repairAuthority: canonicalDigest(repairObserved.binding.authority), repairBasis: repairObserved.binding.basis.basisDigest,
        repairAttempt: repairObserved.binding.unit.attemptKey, state: "queued", attempts: 0,
      };
      await this.save(route);
    }
    if (sourceObserved.binding.basis.basisDigest !== failure.basisDigest || sourceObserved.binding.unit.attemptKey !== failure.attemptKey) fail("LINEAR_RECOVERY_SOURCE_BASIS_CHANGED");
    if ([...this.routes.values()].some(other => other.source.selector.bindingIri !== sourceId && other.rule.repairBinding === rule.repairBinding)) fail("LINEAR_RECOVERY_LINEAGE_AMBIGUOUS");
    this.routes.set(sourceId, route);
    this.dispositions.set(sourceId, { disposition: "awaiting-repair", reasonCode: "LINEAR_RECOVERY_QUEUED", externalBoundary: "normal-supervisor", intakeKey, repairBinding: rule.repairBinding });
    this.dispositions.set(rule.repairBinding, { disposition: "repair-ready", reasonCode: "LINEAR_RECOVERY_REPAIR_ADMITTED", externalBoundary: "none", intakeKey, repairBinding: rule.repairBinding });
  }

  private assertProposal(rule: LinearRecoveryRule, repair: LinearLane): void {
    const candidates = this.sources().filter(graph => graph.quads.some(q => q.subject === rule.repairProposal && q.predicate === P + "type" && q.object === "urn:usf:type:LinearIssueProposal"));
    if (candidates.length === 0) fail("LINEAR_RECOVERY_PROPOSAL_AUTHORITY_MISSING");
    for (const graph of candidates) {
      const iri = rule.repairProposal!, authority = repair.binding.authority;
      for (const [name, expected, kind] of [
        ["workIri", authority.workIri, "iri"], ["selectedProfile", authority.profile, "iri"],
        ["targetManifest", authority.targetManifest, "literal"], ["issueUuid", authority.issueUuid, "literal"],
        ["issueWorkspace", authority.workspace, "literal"], ["owningModel", authority.owner, "literal"],
      ] as const) if (field(graph.quads, iri, name, kind) !== expected) fail("LINEAR_RECOVERY_PROPOSAL_LINEAGE_AMBIGUOUS");
    }
  }

  proposalAllowed(iri: string): boolean {
    return !this.repairProposals.has(iri) || [...this.routes.values()].some(route => route.rule.repairProposal === iri
      && (this.dispositions.get(route.repair.selector.bindingIri)?.disposition === "repair-ready"
        || (route.intake.state === "completed" && this.store.intents().some(intent =>
          intent.identity.bindingIri === iri && intent.identity.operation === "create-issue" && intent.state === "confirmed"))));
  }
  guardFor(iri: string): LinearMutationGuard | undefined {
    const route = [...this.routes.values()].find(item => item.source.selector.bindingIri === iri || item.repair.selector.bindingIri === iri || item.rule.repairProposal === iri);
    return route === undefined ? undefined : {
      authenticate: intentId => this.authenticate(route, intentId),
      current: intentId => this.assertCurrent(route, intentId),
    };
  }
  async beforeLane(lane: LinearLane): Promise<void> {
    const disposition = this.dispositions.get(lane.selector.bindingIri);
    if (!disposition) return;
    if (!["repair-ready", "resume-ready", "completed"].includes(disposition.disposition)) fail(disposition.reasonCode);
    const route = [...this.routes.values()].find(item => item.source.selector.bindingIri === lane.selector.bindingIri || item.repair.selector.bindingIri === lane.selector.bindingIri);
    if (!route) fail("LINEAR_RECOVERY_INTAKE_NOT_ADMITTED");
    await this.authenticate(route);
    if (disposition.disposition === "repair-ready" && route.intake.state === "queued") {
      if (route.intake.attempts >= route.rule.maximumRepairAttempts) fail("LINEAR_RECOVERY_REPAIR_BUDGET_EXHAUSTED");
      route.intake = { ...route.intake, state: "dispatched", attempts: route.intake.attempts + 1 };
      await this.save(route);
    } else if (disposition.disposition === "resume-ready") {
      route.intake = { ...route.intake, state: "resume-reserved" };
      await this.save(route);
    }
    this.assertCurrent(route);
  }
}
