import { readFileSync } from "node:fs";

import { DeterministicFakeProvider } from "../providers/fake.ts";
import { immutable, type CallAssignment, type CallBatchResult, type CallFailure, type Contribution, type ProviderIdentity } from "../providers/types.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { assertRealisationBasis, assertSameBasis, parseRealisationBasis } from "../realisation/basis.ts";
import { createJsonSchemaValidator } from "../schema/index.ts";
import { parseCommandInput, readCommandInput } from "./command-input.ts";
import { dispatchRegisteredGraphLeaf } from "./graph-leaf-dispatch.ts";

const callResultValidator = createJsonSchemaValidator<CallBatchResult>(JSON.parse(
  readFileSync(new URL("../../schemas/call-result.schema.json", import.meta.url), "utf8"),
) as unknown);

function isValidConcurrency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderIdentity(value: unknown): value is ProviderIdentity {
  return isRecord(value)
    && typeof value.family === "string" && value.family.length > 0
    && typeof value.provider === "string" && value.provider.length > 0
    && typeof value.model === "string" && value.model.length > 0;
}

function isCallAssignmentShape(value: unknown): value is CallAssignment {
  if (!isRecord(value) || !isRecord(value.route) || !isRecord(value.packet) || !isRecord(value.limits)) return false;
  const route = value.route;
  const packet = value.packet;
  const limits = value.limits;
  const costClasses = new Set(["local", "zero-price", "free-quota", "subscription", "paid", "unknown"]);
  return isProviderIdentity(route.requested)
    && isProviderIdentity(route.actual)
    && typeof route.costClass === "string" && costClasses.has(route.costClass)
    && (route.observedCost === null || (typeof route.observedCost === "number" && Number.isFinite(route.observedCost) && route.observedCost >= 0))
    && typeof route.concurrency === "number"
    && (route.failure === undefined || route.failure === "always" || route.failure === "once")
    && typeof packet.id === "string" && packet.id.length > 0
    && typeof packet.objective === "string"
    && Array.isArray(packet.permittedPaths)
    && Array.isArray(packet.proposedFileOperations)
    && typeof value.workPacketDigest === "string"
    && typeof value.promptTemplateDigest === "string"
    && typeof value.scopedDependencyDigest === "string"
    && (value.purpose === undefined || value.purpose === "proposal" || value.purpose === "independence" || value.purpose === "freshness")
    && ["maxTurns", "maxWallTimeMs", "maxInputTokens", "maxOutputTokens", "maxToolCalls", "maxRetries"]
      .every((name) => typeof limits[name] === "number" && Number.isSafeInteger(limits[name]) && (limits[name] as number) >= 0);
}

export async function callAssignments(assignments: readonly CallAssignment[], hostConcurrency = 8): Promise<CallBatchResult> {
  if (assignments.length === 0) throw new UsfError("CALL_ASSIGNMENTS_REQUIRED", exitCodes.INVALID_INPUT, "Call requires at least one basis-bound assignment.");
  if (!isValidConcurrency(hostConcurrency)) {
    throw new UsfError("CALL_HOST_CONCURRENCY_INVALID", exitCodes.INVALID_INPUT, "Call host concurrency must be a positive finite safe integer.");
  }
  for (const assignment of assignments) {
    if (!isRecord(assignment) || !isRecord(assignment.route)) throw new UsfError("CALL_ASSIGNMENT_INVALID", exitCodes.INVALID_INPUT, "Every call assignment requires one complete bounded fake-provider route, packet and limit set.");
    if (!isValidConcurrency(assignment.route.concurrency)) throw new UsfError("CALL_ROUTE_CONCURRENCY_INVALID", exitCodes.INVALID_INPUT, "Every call route concurrency must be a positive finite safe integer.");
    try { assertRealisationBasis(assignment.basis); } catch { throw new UsfError("CALL_BASIS_INVALID", exitCodes.INVALID_INPUT, "Every call assignment requires a valid immutable realisation basis."); }
    if (!isCallAssignmentShape(assignment)) throw new UsfError("CALL_ASSIGNMENT_INVALID", exitCodes.INVALID_INPUT, "Every call assignment requires one complete bounded fake-provider route, packet and limit set.");
    if (assignment.workPacketDigest !== assignment.basis.work.packetCoreDigest
      || assignment.scopedDependencyDigest !== assignment.basis.work.scopedDependencyDigest
      || assignment.promptTemplateDigest !== assignment.basis.inputs.policyDigest
      || assignment.packet.id !== assignment.basis.work.id) throw new UsfError("CALL_BASIS_BINDING_MISMATCH", exitCodes.INVALID_INPUT, "Call assignment lineage does not match its realisation basis.");
  }
  if (assignments.length > 1) {
    for (const assignment of assignments.slice(1)) {
      try { assertSameBasis(assignments[0]!.basis, assignment.basis); } catch { throw new UsfError("CALL_BASIS_MIXED", exitCodes.INVALID_INPUT, "Call assignments must use one realisation basis."); }
    }
  }
  const capped = hostConcurrency;
  const providers = new Map<string, DeterministicFakeProvider>();
  const activeByProvider = new Map<string, number>();
  const pending = [...assignments];
  const contributions: Contribution[] = [];
  const failures: CallFailure[] = [];
  while (pending.length > 0) {
    const batch: CallAssignment[] = [];
    for (let index = 0; index < pending.length && batch.length < capped;) {
      const assignment = pending[index]!;
      const key = JSON.stringify([assignment.route.requested.family, assignment.route.requested.provider]);
      const active = activeByProvider.get(key) ?? 0;
      if (active < assignment.route.concurrency) { batch.push(assignment); pending.splice(index, 1); activeByProvider.set(key, active + 1); } else index += 1;
    }
    if (batch.length === 0) {
      throw new UsfError("CALL_SCHEDULER_NO_PROGRESS", exitCodes.DOMAIN_FAILURE, "The call scheduler refused a pending set that could not make progress.");
    }
    const results = await Promise.all(batch.map(async (assignment) => {
      const key = JSON.stringify([assignment.route.requested.family, assignment.route.requested.provider]);
      const routeKey = JSON.stringify(assignment.route);
      let provider = providers.get(routeKey);
      if (!provider) { provider = new DeterministicFakeProvider(assignment.route); providers.set(routeKey, provider); }
      const values = Object.values(assignment.limits);
      let result: Contribution | CallFailure = values.some((value) => !Number.isInteger(value) || value < 0) || assignment.limits.maxTurns < 1 || assignment.limits.maxWallTimeMs < 1
        ? { route: assignment.route.requested, reasonCode: "CALL_LIMITS_INVALID", retryable: false }
        : provider.invoke(assignment);
      for (let retry = 1; "retryable" in result && result.retryable && retry <= assignment.limits.maxRetries; retry += 1) {
        // A fake route has no wall-clock delay, but this explicit retry point is where a live adapter honours Retry-After.
        result = provider.invoke(assignment, retry);
      }
      activeByProvider.set(key, (activeByProvider.get(key) ?? 1) - 1);
      return result;
    }));
    for (const result of results) "schema" in result ? contributions.push(result) : failures.push(result);
  }
  contributions.sort((a, b) => a.identity.artifactDigest.localeCompare(b.identity.artifactDigest));
  failures.sort((a, b) => `${a.route.family}:${a.route.provider}`.localeCompare(`${b.route.family}:${b.route.provider}`));
  const observedCost = contributions.reduce((sum, contribution) => sum + (contribution.cost.observedCost ?? 0), 0);
  return immutable({ schema: "urn:usf:call-result:1", basis: assignments[0]!.basis, status: failures.length === 0 ? "ok" : contributions.length > 0 ? "partial" : "refused", contributions, failures, metrics: { requested: assignments.length, succeeded: contributions.length, failed: failures.length, observedCost } });
}

/** Generic no-contact call plus graph-gated reserved provider leaves. */
export const callCommandHandler: CommandHandler = async ({ args, repositoryRoot }) => {
  const leafResult = await dispatchRegisteredGraphLeaf(args, repositoryRoot);
  if (leafResult !== null) return leafResult;
  const value = await readCommandInput(repositoryRoot, parseCommandInput(args, "CALL"), "CALL");
  let input: { assignments?: CallAssignment[]; hostConcurrency?: number };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsfError("CALL_INPUT_INVALID", exitCodes.INVALID_INPUT, "usf call input must be an object.");
  if (Object.keys(value).some((key) => key !== "assignments" && key !== "hostConcurrency")) throw new UsfError("CALL_INPUT_INVALID", exitCodes.INVALID_INPUT, "usf call input contains an unsupported field.");
  input = value as { assignments?: CallAssignment[]; hostConcurrency?: number };
  if (!Array.isArray(input.assignments)) throw new UsfError("CALL_ASSIGNMENTS_REQUIRED", exitCodes.INVALID_INPUT, "usf call input requires assignments.");
  try { input.assignments = input.assignments.map((assignment) => ({ ...assignment, basis: parseRealisationBasis(assignment.basis) })); }
  catch { throw new UsfError("CALL_BASIS_INVALID", exitCodes.INVALID_INPUT, "Every call assignment requires a valid immutable wire realisation basis."); }
  const output = await callAssignments(input.assignments, input.hostConcurrency);
  if (!callResultValidator.validate(output).valid) throw new UsfError("CALL_RESULT_INVALID", exitCodes.DOMAIN_FAILURE, "The generic call result does not satisfy its closed result schema.");
  return { output, exitCode: output.status === "refused" ? exitCodes.DOMAIN_FAILURE : exitCodes.SUCCESS };
};
