import { canonicalDigest } from "../core/canonical.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isPathWithinPermission } from "../core/scope.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../graph/nquads.ts";
import { assertRealisationBasis, type RealisationBasis } from "../realisation/basis.ts";
import { contributionDigest, immutable, isOperation, type Contribution, type CostClass, type FileOperation } from "../providers/types.ts";

const digest = /^sha256:[0-9a-f]{64}$/u;

export class LinearContributionError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) { super(reasonCode); this.reasonCode = reasonCode; }
}

function refuse(reasonCode: string): never { throw new LinearContributionError(reasonCode); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function knownTokens(value: unknown): value is { inputTokens: number; outputTokens: number; totalTokens: number } {
  return record(value) && [value.inputTokens, value.outputTokens, value.totalTokens]
    .every((token) => typeof token === "number" && Number.isSafeInteger(token) && token >= 0);
}
function knownNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function knownLimits(value: unknown): value is Contribution["limits"] {
  return record(value) && knownNonNegative(value.maxTurns) && knownNonNegative(value.maxWallTimeMs)
    && knownNonNegative(value.maxInputTokens) && knownNonNegative(value.maxOutputTokens)
    && knownNonNegative(value.maxToolCalls) && knownNonNegative(value.maxRetries);
}

/** Structural view of the prepared binding, kept independent of its command owner. */
export interface PreparedContributionBinding {
  readonly basis: RealisationBasis;
  readonly unit: Readonly<{
    readonly unitIri: string;
    readonly workIri: string;
    readonly basisDigest: string;
    readonly scopedDependencyDigest: string;
    readonly prompt: string;
    readonly modelCapabilities: readonly string[];
  }>;
}

export interface PersistedGraphExecutionResult {
  readonly evidence: unknown;
  readonly evidenceDigest: string;
}

export interface SettledLinearContributionInput {
  readonly root: string;
  readonly selector: Readonly<{ readonly repositoryRoot: string; readonly manifestPath: string; readonly bindingIri: string }>;
  readonly binding: Readonly<{
    readonly status: "PREPARED" | "STARTED" | "SETTLED" | "UNKNOWN" | "COMPLETED";
    readonly binding: PreparedContributionBinding & Readonly<{
      readonly selector: Readonly<{ readonly repositoryRoot: string; readonly manifestPath: string; readonly bindingIri: string }>;
      readonly unitPath: string;
      readonly attempt: Readonly<{ readonly executionResultIri: string | null; readonly executionResultDigest: string | null }>;
      readonly unit: PreparedContributionBinding["unit"] & Readonly<{ readonly attemptKey: string }>;
    }>;
  }>;
}

/**
 * Convert one settled graph-execution result into the existing Contribution
 * envelope. Historical graph results stay readable by their old consumers, but
 * cannot enter this bridge because they lack retained qualification receipts.
 */
export function contributionFromGraphExecution(
  prepared: PreparedContributionBinding,
  persisted: PersistedGraphExecutionResult,
  boundSourceAssertionDigest: string,
): Contribution {
  try { assertRealisationBasis(prepared.basis); } catch { refuse("LINEAR_CONTRIBUTION_BASIS_INVALID"); }
  if (prepared.unit.basisDigest !== prepared.basis.basisDigest
    || prepared.unit.workIri !== prepared.basis.work.id
    || prepared.unit.scopedDependencyDigest !== prepared.basis.work.scopedDependencyDigest) {
    refuse("LINEAR_CONTRIBUTION_BINDING_MISMATCH");
  }
  if (!digest.test(persisted.evidenceDigest) || !record(persisted.evidence)
    || canonicalDigest(persisted.evidence) !== persisted.evidenceDigest) refuse("LINEAR_CONTRIBUTION_RESULT_UNPROVEN");
  const evidence = persisted.evidence;
  if (evidence.schema !== "urn:usf:graph-execution-evidence:1" || evidence.status !== "ok"
    || !Array.isArray(evidence.units) || evidence.units.length !== 1 || !record(evidence.qualificationSnapshot)) {
    refuse("LINEAR_CONTRIBUTION_RESULT_UNPROVEN");
  }
  const unit = evidence.units[0];
  if (!record(unit) || unit.unit !== prepared.unit.unitIri || typeof unit.sourceAssertionDigest !== "string"
    || unit.sourceAssertionDigest !== boundSourceAssertionDigest || !digest.test(unit.sourceAssertionDigest)
    || typeof unit.promptDigest !== "string" || unit.promptDigest !== canonicalDigest(prepared.unit.prompt)
    || unit.status !== "ok" || typeof unit.resultDigest !== "string"
    || !digest.test(unit.resultDigest) || typeof unit.resultText !== "string"
    || canonicalDigest(unit.resultText) !== unit.resultDigest) refuse("LINEAR_CONTRIBUTION_RESULT_MISMATCH");
  if (typeof unit.transport !== "string" || typeof unit.provider !== "string"
    || typeof unit.requestedModel !== "string" || typeof unit.actualModel !== "string"
    || unit.transport.length === 0 || unit.provider.length === 0 || unit.requestedModel.length === 0 || unit.actualModel.length === 0) {
    refuse("LINEAR_CONTRIBUTION_PROVIDER_UNKNOWN");
  }
  if (!knownTokens(unit.usage)) refuse("LINEAR_CONTRIBUTION_USAGE_UNKNOWN");
  if (!knownNonNegative(unit.toolCalls) || !knownLimits(unit.limits)) refuse("LINEAR_CONTRIBUTION_LIMITS_UNKNOWN");
  if (!Array.isArray(prepared.unit.modelCapabilities) || !prepared.unit.modelCapabilities.every((item) => typeof item === "string")) {
    refuse("LINEAR_CONTRIBUTION_QUALIFICATION_UNKNOWN");
  }
  const snapshot = evidence.qualificationSnapshot;
  if (!Array.isArray(snapshot.routes)) refuse("LINEAR_CONTRIBUTION_QUALIFICATION_UNKNOWN");
  const route = snapshot.routes.find((item) => record(item)
    && item.routeId === `${unit.provider}:${unit.requestedModel}`);
  if (!record(route) || !Array.isArray(route.taskClasses) || !Array.isArray(route.receipts)
    || route.receipts.length === 0) {
    refuse("LINEAR_CONTRIBUTION_QUALIFICATION_UNKNOWN");
  }
  const taskClasses = route.taskClasses as unknown[];
  const receipts = route.receipts as unknown[];
  if (prepared.unit.modelCapabilities.length === 0 || taskClasses.length === 0 || !prepared.unit.modelCapabilities.every((required) => taskClasses.includes(required)
      && receipts.some((receipt: unknown) => record(receipt) && receipt.taskClass === required
        && typeof receipt.qualificationDigest === "string" && digest.test(receipt.qualificationDigest)
        && typeof receipt.observationSetDigest === "string" && digest.test(receipt.observationSetDigest)))) {
    refuse("LINEAR_CONTRIBUTION_QUALIFICATION_UNKNOWN");
  }
  let decoded: unknown;
  try { decoded = JSON.parse(unit.resultText) as unknown; } catch { refuse("LINEAR_CONTRIBUTION_OPERATIONS_INVALID"); }
  const operations = Array.isArray(decoded) ? decoded : record(decoded) ? decoded.operations : undefined;
  if (!Array.isArray(operations) || operations.length === 0 || !operations.every(isOperation)
    || operations.some((operation) => !prepared.basis.scope.writeSet.some((scope) => isPathWithinPermission(operation.path, scope)))) {
    refuse("LINEAR_CONTRIBUTION_SCOPE_REFUSED");
  }
  const fileOperations = operations as FileOperation[];
  const costClass: CostClass = typeof unit.costClass === "string"
    && ["local", "zero-price", "free-quota", "subscription", "paid", "unknown"].includes(unit.costClass)
    ? unit.costClass as CostClass : "unknown";
  const assignment = Object.freeze({
    basisDigest: prepared.basis.basisDigest,
    workPacketDigest: prepared.basis.work.packetCoreDigest,
    // Legacy envelope naming: resolve binds this field to policy authority,
    // while the actual invocation prompt digest stays in execution evidence.
    promptTemplateDigest: prepared.basis.inputs.policyDigest,
    scopedDependencyDigest: prepared.basis.work.scopedDependencyDigest,
    purpose: "proposal" as const,
  });
  const contribution = {
    schema: "urn:usf:contribution:1" as const, kind: "contribution" as const, basis: prepared.basis,
    assignment,
    requested: Object.freeze({ family: unit.transport, provider: unit.provider, model: unit.requestedModel }),
    actual: Object.freeze({ family: unit.transport, provider: unit.provider, model: unit.actualModel }),
    cost: Object.freeze({ costClass, observedCost: null, evidence: persisted.evidenceDigest }),
    usage: Object.freeze({ inputTokens: unit.usage.inputTokens, outputTokens: unit.usage.outputTokens, toolCalls: unit.toolCalls, retries: unit.limits.maxRetries }),
    limits: Object.freeze({ ...unit.limits }),
    payload: Object.freeze({ operations: Object.freeze(fileOperations.map((operation) => Object.freeze({ ...operation }))) }),
    claims: Object.freeze([`graph-execution-evidence:${persisted.evidenceDigest}`, `graph-result:${unit.resultDigest}`, `invocation-prompt-digest:${unit.promptDigest}`]),
    nonclaims: Object.freeze(["assignment-prompt-template-digest-is-policy-authority-not-invocation-prompt", "graph-execution-is-not-acceptance-or-completion"]),
  };
  return immutable({ ...contribution, identity: Object.freeze({ artifactDigest: contributionDigest(contribution), basisDigest: prepared.basis.basisDigest }) });
}

/**
 * The Linear owner calls this only after its durable attempt is SETTLED.  The
 * evidence path is derived from that persisted identity, never searched or
 * reconstructed from a convenient newer graph result.
 */
export async function contributionFromSettledLinearResult(
  input: SettledLinearContributionInput,
): Promise<Contribution> {
  const settled = input.binding;
  if (settled.status !== "SETTLED"
    || input.root !== input.selector.repositoryRoot
    || settled.binding.selector.repositoryRoot !== input.selector.repositoryRoot
    || settled.binding.selector.manifestPath !== input.selector.manifestPath
    || settled.binding.selector.bindingIri !== input.selector.bindingIri
    || settled.binding.attempt.executionResultIri === null
    || settled.binding.attempt.executionResultDigest === null) refuse("LINEAR_CONTRIBUTION_SETTLEMENT_INVALID");
  const prefix = "urn:usf:graph-execution-evidence:";
  const evidenceDigest = settled.binding.attempt.executionResultIri.startsWith(prefix)
    ? settled.binding.attempt.executionResultIri.slice(prefix.length) : "";
  if (!digest.test(evidenceDigest)) refuse("LINEAR_CONTRIBUTION_SETTLEMENT_INVALID");
  let evidence: unknown;
  try { evidence = JSON.parse(await readFile(resolve(input.root, ".usf", "graph-executions", `${evidenceDigest.slice(7)}.json`), "utf8")) as unknown; }
  catch { refuse("LINEAR_CONTRIBUTION_RESULT_UNREADABLE"); }
  if (!record(evidence) || !Array.isArray(evidence.units) || evidence.units.length !== 1
    || !record(evidence.units[0]) || evidence.units[0].resultDigest !== settled.binding.attempt.executionResultDigest) {
    refuse("LINEAR_CONTRIBUTION_SETTLEMENT_MISMATCH");
  }
  let boundSourceAssertionDigest: string;
  try {
    const graph = `urn:usf:graph:hermes-input:${settled.binding.unit.attemptKey}`;
    const quads = parseStrictNQuads(await readFile(resolve(input.root, settled.binding.unitPath), "utf8"), graph);
    boundSourceAssertionDigest = canonicalQuadDigest(quads.filter((quad) => quad.subject === settled.binding.unit.unitIri));
  } catch { refuse("LINEAR_CONTRIBUTION_BOUND_WORK_UNREADABLE"); }
  if (!digest.test(boundSourceAssertionDigest)) refuse("LINEAR_CONTRIBUTION_BOUND_WORK_UNREADABLE");
  return contributionFromGraphExecution(settled.binding, { evidence, evidenceDigest }, boundSourceAssertionDigest);
}
