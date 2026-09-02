import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Bounded per-route availability memory.
 *
 * A refusal is an availability fact about one exact route, never about a
 * provider family and never permanent. Recording it stops unattended operation
 * from re-paying the same refusal every cycle -- an exhausted quota answers in
 * milliseconds, but a model that consumes its whole output budget and returns
 * nothing costs two minutes each time. Every deferral expires on its own, and a
 * success clears the record, so nothing here can disable a route for good.
 */
const deferralPath = ".usf/hermes/route-deferrals.json";
const maximumRecords = 512;

export interface RouteDeferral {
  readonly candidateId: string;
  readonly reasonCode: string;
  readonly consecutiveFailures: number;
  readonly observedAtMs: number;
  readonly deferUntilMs: number;
  /** Cumulative observations, used to order routes by what they actually do. */
  readonly attempts?: number;
  readonly successes?: number;
  readonly meanLatencyMs?: number;
  /**
   * What downstream admission made of the text this route returned.
   *
   * Transport success only means the route answered. Measured, one host route
   * answered 43 times for 1.77 million tokens while almost nothing it produced
   * survived admission -- and because ordering ranked transport success, the
   * most wasteful route in the pool was being preferred for it. These counters
   * let ordering rank what a route produced that was actually kept.
   */
  readonly outputAcceptances?: number;
  readonly outputRefusals?: number;
}

/**
 * Attempts a route may spend proving it produces nothing.
 *
 * Measured: nineteen routes consumed 451 attempts without a single success,
 * one of them 40 timeouts at over two minutes each. Class-based backoff never
 * catches this, because each individual refusal looks transient; only the
 * accumulated record shows the route is not productive at all.
 */
export const unproductiveAttemptCeiling = 12;

export interface RouteDeferralIndex {
  readonly schema: "urn:usf:route-deferral:1";
  readonly version: 1;
  readonly deferrals: Readonly<Record<string, RouteDeferral>>;
}

const minute = 60_000;
const hour = 60 * minute;

/**
 * How long one refusal class defers one route. The values are deliberately
 * coarse: this is a throughput heuristic over ignored local state, not an
 * entitlement or economics claim about the provider.
 */
export function deferralDurationMs(reasonCode: string, consecutiveFailures: number): number {
  const family = reasonCode.split(":", 1)[0]!;
  switch (family) {
    case "PROVIDER_QUOTA_EXHAUSTED_PAYMENT_REQUIRED": return 6 * hour;
    case "TRANSPORT_USAGE_LIMIT_EXCEEDED": return 6 * hour;
    case "PROVIDER_AUTHENTICATION_REFUSED": return 12 * hour;
    case "PROVIDER_MODEL_NOT_SERVED": return 24 * hour;
    case "PROVIDER_RATE_LIMITED": return 5 * minute;
    // A timeout is the most expensive refusal to discover, so it is the one
    // most worth not rediscovering.
    case "PROVIDER_TIMEOUT": return Math.min(2 * hour, 15 * minute * 2 ** Math.min(consecutiveFailures - 1, 3));
    // One empty answer can be the prompt; a second is the route.
    case "PROVIDER_EMPTY_RESULT": return consecutiveFailures < 2 ? 0 : 30 * minute;
    // Truncation is about this route's ceiling, not this prompt, so a repeat is
    // likely; one tolerance then step aside.
    case "PROVIDER_TRUNCATED_RESULT": return consecutiveFailures < 2 ? 0 : 20 * minute;
    case "CREDENTIAL_ABSENT": return 24 * hour;
    default: return Math.min(hour, 2 ** Math.min(consecutiveFailures, 6) * minute);
  }
}

export async function readRouteDeferrals(repositoryRoot: string): Promise<Readonly<Record<string, RouteDeferral>>> {
  const bytes = await readFile(resolve(repositoryRoot, deferralPath), "utf8").catch(() => undefined);
  if (bytes === undefined) return Object.freeze({});
  try {
    const parsed = JSON.parse(bytes) as RouteDeferralIndex;
    if (parsed.schema !== "urn:usf:route-deferral:1") return Object.freeze({});
    const records: Record<string, RouteDeferral> = {};
    for (const [candidateId, record] of Object.entries(parsed.deferrals ?? {})) {
      if (typeof record?.deferUntilMs !== "number" || typeof record.reasonCode !== "string") continue;
      records[candidateId] = Object.freeze({
        candidateId,
        reasonCode: record.reasonCode,
        consecutiveFailures: Number.isInteger(record.consecutiveFailures) ? record.consecutiveFailures : 1,
        observedAtMs: typeof record.observedAtMs === "number" ? record.observedAtMs : 0,
        deferUntilMs: record.deferUntilMs,
        // Cumulative history must be read back, not only written. Reconstructing
        // the record field by field and omitting these three made the whole
        // productivity mechanism inert: routeProductivity skips any route with
        // zero attempts, so the map was always empty and ordering by what a
        // route has produced never happened. The attempt ceiling could not fire
        // either, because attempts never exceeded one.
        attempts: Number.isInteger(record.attempts) && (record.attempts ?? 0) >= 0 ? record.attempts! : 0,
        successes: Number.isInteger(record.successes) && (record.successes ?? 0) >= 0 ? record.successes! : 0,
        meanLatencyMs: typeof record.meanLatencyMs === "number" && Number.isFinite(record.meanLatencyMs)
          && record.meanLatencyMs >= 0 ? record.meanLatencyMs : 0,
        outputAcceptances: Number.isInteger(record.outputAcceptances) && (record.outputAcceptances ?? 0) >= 0
          ? record.outputAcceptances! : 0,
        outputRefusals: Number.isInteger(record.outputRefusals) && (record.outputRefusals ?? 0) >= 0
          ? record.outputRefusals! : 0,
      });
    }
    return Object.freeze(records);
  } catch { return Object.freeze({}); }
}

/** Candidate ids currently deferred at the supplied instant. */
export function deferredCandidateIds(
  records: Readonly<Record<string, RouteDeferral>>,
  nowMs: number,
): ReadonlySet<string> {
  return new Set(Object.values(records).filter((record) => record.deferUntilMs > nowMs).map((record) => record.candidateId));
}

export interface ObservedRouteOutcome {
  readonly candidateId: string;
  readonly outcome: "ok" | "refused";
  readonly reasonCode: string;
  readonly latencyMs?: number;
}

/** How productive a route has been, for ordering rather than admission. */
/** One admission verdict for text a route produced: kept, or refused downstream. */
export interface ObservedOutputAdmission {
  readonly candidateId: string;
  readonly admitted: boolean;
}

/**
 * Fold admission verdicts into the record.
 *
 * This is a second, later observation about the same invocation: the transport
 * fold said the route answered; this says whether what it answered with
 * survived admission. It therefore never touches attempts, successes or any
 * deferral produced by the transport layer -- counting it again would
 * double-count the invocation.
 *
 * The one exception is the stand-down: a route whose output has been refused at
 * the ceiling without a single acceptance is spending real budget producing
 * nothing usable, which is the transport-unproductive rule one layer up.
 * Measured before this existed, one route consumed 86 percent of a session's
 * tokens with zero admissions while ranking top of its provider.
 */
export function applyOutputAdmissions(
  records: Readonly<Record<string, RouteDeferral>>,
  admissions: readonly ObservedOutputAdmission[],
  nowMs: number,
): Readonly<Record<string, RouteDeferral>> {
  const next: Record<string, RouteDeferral> = { ...records };
  for (const admission of admissions) {
    const held = next[admission.candidateId];
    const outputAcceptances = (held?.outputAcceptances ?? 0) + (admission.admitted ? 1 : 0);
    const outputRefusals = (held?.outputRefusals ?? 0) + (admission.admitted ? 0 : 1);
    const base: RouteDeferral = held ?? Object.freeze({
      candidateId: admission.candidateId, reasonCode: "OUTPUT_OBSERVED",
      consecutiveFailures: 0, observedAtMs: nowMs, deferUntilMs: 0,
      attempts: 0, successes: 0, meanLatencyMs: 0,
    });
    const outputUnproductive = outputRefusals >= unproductiveAttemptCeiling && outputAcceptances === 0;
    next[admission.candidateId] = Object.freeze({
      ...base,
      observedAtMs: nowMs,
      outputAcceptances,
      outputRefusals,
      ...(outputUnproductive && base.deferUntilMs <= nowMs
        ? { reasonCode: `ROUTE_OUTPUT_UNPRODUCTIVE:${outputRefusals}`, deferUntilMs: nowMs + 24 * hour }
        : {}),
    });
  }
  return Object.freeze(next);
}

export interface RouteProductivity {
  readonly candidateId: string;
  readonly attempts: number;
  readonly successes: number;
  readonly successRate: number;
  readonly meanLatencyMs: number;
  readonly outputAcceptances: number;
  readonly outputRefusals: number;
}

export function routeProductivity(
  records: Readonly<Record<string, RouteDeferral>>,
): ReadonlyMap<string, RouteProductivity> {
  const productivity = new Map<string, RouteProductivity>();
  for (const [candidateId, record] of Object.entries(records)) {
    const attempts = record.attempts ?? 0;
    if (attempts === 0) continue;
    const successes = record.successes ?? 0;
    productivity.set(candidateId, Object.freeze({
      candidateId, attempts, successes,
      successRate: successes / attempts,
      meanLatencyMs: record.meanLatencyMs ?? 0,
      outputAcceptances: record.outputAcceptances ?? 0,
      outputRefusals: record.outputRefusals ?? 0,
    }));
  }
  return productivity;
}

/**
 * Fold this run's observations into the record. A success clears its route, an
 * expired deferral is dropped, and the whole index stays bounded.
 */
export function applyRouteOutcomes(
  records: Readonly<Record<string, RouteDeferral>>,
  outcomes: readonly ObservedRouteOutcome[],
  nowMs: number,
): Readonly<Record<string, RouteDeferral>> {
  const next: Record<string, RouteDeferral> = {};
  for (const [candidateId, record] of Object.entries(records)) {
    // An expired deferral is dropped, but the route's history is not: it is
    // what orders the pool next time.
    next[candidateId] = record.deferUntilMs > nowMs ? record
      : Object.freeze({ ...record, reasonCode: "EXPIRED", consecutiveFailures: 0, deferUntilMs: 0 });
  }
  // Cumulative history survives a cleared deferral: a route that succeeds is no
  // longer deferred, but what it has done is still how it earns its place in
  // the order.
  const history = (candidateId: string): Readonly<{
    attempts: number; successes: number; meanLatencyMs: number;
    outputAcceptances: number; outputRefusals: number;
  }> => {
    const held = records[candidateId];
    return {
      attempts: held?.attempts ?? 0, successes: held?.successes ?? 0, meanLatencyMs: held?.meanLatencyMs ?? 0,
      // Admission history rides along untouched: a transport observation says
      // nothing about admission, and rebuilding the record without these fields
      // is the same silent-omission defect the reader once had.
      outputAcceptances: held?.outputAcceptances ?? 0, outputRefusals: held?.outputRefusals ?? 0,
    };
  };
  const observed = (candidateId: string, ok: boolean, latencyMs: number) => {
    const prior = history(candidateId);
    const attempts = prior.attempts + 1;
    return {
      attempts,
      successes: prior.successes + (ok ? 1 : 0),
      meanLatencyMs: Math.round((prior.meanLatencyMs * prior.attempts + latencyMs) / attempts),
      outputAcceptances: prior.outputAcceptances,
      outputRefusals: prior.outputRefusals,
    };
  };
  for (const outcome of outcomes) {
    if (outcome.outcome === "ok") {
      const counted = observed(outcome.candidateId, true, outcome.latencyMs ?? 0);
      next[outcome.candidateId] = Object.freeze({
        candidateId: outcome.candidateId, reasonCode: "INVOCATION_OK",
        consecutiveFailures: 0, observedAtMs: nowMs, deferUntilMs: 0, ...counted,
      });
      continue;
    }
    const held = records[outcome.candidateId];
    const consecutive = held !== undefined && held.reasonCode.split(":", 1)[0] === outcome.reasonCode.split(":", 1)[0]
      ? held.consecutiveFailures + 1 : 1;
    const counted = observed(outcome.candidateId, false, outcome.latencyMs ?? 0);
    // A route that has spent its ceiling without ever succeeding is not having
    // a bad minute. Stand it down for a day whatever the refusal class says.
    const unproductive = counted.attempts >= unproductiveAttemptCeiling && counted.successes === 0;
    const duration = unproductive
      ? Math.max(24 * hour, deferralDurationMs(outcome.reasonCode, consecutive))
      : deferralDurationMs(outcome.reasonCode, consecutive);
    next[outcome.candidateId] = Object.freeze({
      candidateId: outcome.candidateId,
      reasonCode: unproductive ? `ROUTE_UNPRODUCTIVE:${outcome.reasonCode}` : outcome.reasonCode,
      consecutiveFailures: consecutive, observedAtMs: nowMs,
      deferUntilMs: duration === 0 ? 0 : nowMs + duration,
      ...counted,
    });
  }
  const bounded = Object.entries(next)
    .sort(([, left], [, right]) => right.observedAtMs - left.observedAtMs)
    .slice(0, maximumRecords);
  return Object.freeze(Object.fromEntries(bounded));
}

export async function writeRouteDeferrals(
  repositoryRoot: string,
  deferrals: Readonly<Record<string, RouteDeferral>>,
): Promise<void> {
  const directory = resolve(repositoryRoot, ".usf", "hermes");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = resolve(repositoryRoot, deferralPath);
  const transient = `${target}.tmp-${process.pid}`;
  const index: RouteDeferralIndex = Object.freeze({
    schema: "urn:usf:route-deferral:1" as const, version: 1 as const, deferrals,
  });
  await writeFile(transient, `${JSON.stringify(index, null, 1)}\n`, { mode: 0o600 });
  await rename(transient, target);
}
