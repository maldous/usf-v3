import { DeterministicFakeProvider, type CallAssignment, type CallBatchResult, type CallFailure, type Contribution } from "../providers/index.ts";
import type { CommandHandler } from "./dispatcher.ts";
import { exitCodes, UsfError } from "../core/errors.ts";

function isValidConcurrency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

export async function callAssignments(assignments: readonly CallAssignment[], hostConcurrency = 8): Promise<CallBatchResult> {
  if (!isValidConcurrency(hostConcurrency)) {
    throw new UsfError("CALL_HOST_CONCURRENCY_INVALID", exitCodes.INVALID_INPUT, "Call host concurrency must be a positive finite safe integer.");
  }
  for (const assignment of assignments) {
    if (!isValidConcurrency(assignment.route.concurrency)) {
      throw new UsfError("CALL_ROUTE_CONCURRENCY_INVALID", exitCodes.INVALID_INPUT, "Every call route concurrency must be a positive finite safe integer.");
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
      const key = `${assignment.route.requested.family}:${assignment.route.requested.provider}`;
      const active = activeByProvider.get(key) ?? 0;
      if (active < assignment.route.concurrency) { batch.push(assignment); pending.splice(index, 1); activeByProvider.set(key, active + 1); } else index += 1;
    }
    if (batch.length === 0) {
      throw new UsfError("CALL_SCHEDULER_NO_PROGRESS", exitCodes.DOMAIN_FAILURE, "The call scheduler refused a pending set that could not make progress.");
    }
    const results = await Promise.all(batch.map(async (assignment) => {
      const key = `${assignment.route.requested.family}:${assignment.route.requested.provider}`;
      let provider = providers.get(key);
      if (!provider) { provider = new DeterministicFakeProvider(assignment.route); providers.set(key, provider); }
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
  return Object.freeze({ schema: "urn:usf:call-result:1", status: failures.length === 0 ? "ok" : contributions.length > 0 ? "partial" : "refused", contributions: Object.freeze(contributions), failures: Object.freeze(failures), metrics: { requested: assignments.length, succeeded: contributions.length, failed: failures.length, observedCost } });
}

/** Bootstrap CLI format: a single canonical JSON argument containing assignments and optional hostConcurrency. */
export const callCommandHandler: CommandHandler = async ({ args }) => {
  if (args.length !== 1) throw new UsfError("CALL_INPUT_REQUIRED", exitCodes.INVALID_INPUT, "usf call requires one JSON input argument.");
  let input: { assignments?: CallAssignment[]; hostConcurrency?: number };
  try { input = JSON.parse(args[0]!) as { assignments?: CallAssignment[]; hostConcurrency?: number }; }
  catch { throw new UsfError("CALL_INPUT_INVALID", exitCodes.INVALID_INPUT, "usf call input must be JSON."); }
  if (!Array.isArray(input.assignments)) throw new UsfError("CALL_ASSIGNMENTS_REQUIRED", exitCodes.INVALID_INPUT, "usf call input requires assignments.");
  const output = await callAssignments(input.assignments, input.hostConcurrency);
  return { output, exitCode: output.status === "refused" ? exitCodes.DOMAIN_FAILURE : exitCodes.SUCCESS };
};
