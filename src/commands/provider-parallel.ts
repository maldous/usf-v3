import { canonicalDigest } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import type { CommandHandler } from "./dispatcher.ts";

/**
 * Reusable no-contact parallel provider runtime, useful-overlap accounting and
 * the immutable baseline/candidate comparison protocol.
 *
 * urn:usf:provider-operation:live-parallel-run:1 records every run under
 * urn:usf:parallel-provider-run:1, and
 * urn:usf:provider-operation:parallel-token-comparison:1 derives
 * urn:usf:semantic-token-comparison:1 from two such records. Both registered
 * commands (`call parallel`, `call compare`) remain graph-registered
 * proofblocked target authority: this module implements the reusable runtime and
 * the operation-wide refusal, while the closed `call` dispatcher and its help
 * stay owned by the operator registry predecessor.
 */

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,191}$/u;
const reasonPattern = /^[A-Z][A-Z0-9_]{1,95}(?::[^\s]{1,192})?$/u;
const instantPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

export type ParallelRunOutcome = "accepted" | "rejected" | "failed";
export type ZeroPaidDisposition = "zero-paid" | "not-observed" | "refused";
export type RegressionDisposition = "no-regression" | "regression" | "not-observed";
export type BenefitDisposition = "SEMANTIC_TOKEN_REDUCTION" | "NO_BENEFIT_CLAIM";

export interface ModelIdentity {
  readonly family: string;
  readonly provider: string;
  readonly model: string;
}

export interface ActualModelIdentity extends ModelIdentity {
  readonly sdkProvider: string;
}

export interface ParallelRouteRun {
  readonly routeMemberDigest: string;
  readonly routeQualificationDigest: string;
  readonly runAuthorizationDigest: string;
  readonly requestedIdentity: Readonly<ModelIdentity>;
  readonly actualIdentity: Readonly<ActualModelIdentity>;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly usefulStartedAt: string | null;
  readonly usefulEndedAt: string | null;
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
  readonly latency: Readonly<{ milliseconds: number; usefulMilliseconds: number }>;
  readonly outcome: ParallelRunOutcome;
  readonly acceptedOutputDigest: string | null;
}

export interface ParallelProviderRun {
  readonly schema: "urn:usf:parallel-provider-run:1";
  readonly version: 1;
  readonly workloadDigest: string;
  readonly profileDigest: string;
  readonly semanticContextDigest: string;
  readonly eligibilitySnapshotDigest: string;
  readonly eligibleCandidateCount: number;
  readonly routeRuns: readonly ParallelRouteRun[];
  readonly excludedCandidates: readonly Readonly<{
    candidateMemberDigest: string; disposition: "excluded" | "deferred"; reasonCodes: readonly string[];
  }>[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly routeFamilyCount: number;
  readonly usefulOverlapMilliseconds: number;
  readonly concurrencyMetrics: Readonly<{
    hostConcurrencyCap: number; providerConcurrencyCap: number; targetConcurrency: number;
    observedConcurrency: number; launchedBeforeFirstSettlement: number; dispatchSerialised: false;
  }>;
  readonly tokenMetrics: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number; usefulTokens: number }>;
  readonly costMetrics: Readonly<{ costClass: "zero-paid" | "local"; observedCostUsd: "0"; paidCostCeiling: "0" }>;
  readonly acceptedOutputs: readonly Readonly<{ routeMemberDigest: string; outputDigest: string }>[];
  readonly failures: readonly Readonly<{ routeMemberDigest: string; reasonCodes: readonly string[] }>[];
  readonly zeroPaidDisposition: ZeroPaidDisposition;
}

export class ParallelRunError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "ParallelRunError";
    this.reasonCode = reasonCode;
  }
}

function invalid(detail: string): never {
  throw new ParallelRunError(`PARALLEL_RUN_RECORD_INVALID:${detail}`);
}

function record(value: unknown, detail: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(detail);
  return value as Record<string, unknown>;
}

/** Closed records admit no unknown member and no missing member. */
function exactKeys(value: Record<string, unknown>, keys: readonly string[], detail: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(detail);
}

function digest(value: unknown, detail: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) invalid(detail);
  return value;
}

function nullableDigest(value: unknown, detail: string): string | null {
  return value === null ? null : digest(value, detail);
}

function identifier(value: unknown, detail: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) invalid(detail);
  return value;
}

function instant(value: unknown, detail: string): string {
  if (typeof value !== "string" || !instantPattern.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(Date.parse(value)).toISOString() !== value) invalid(detail);
  return value;
}

function nullableInstant(value: unknown, detail: string): string | null {
  return value === null ? null : instant(value, detail);
}

function count(value: unknown, detail: string, maximum = 1_000_000_000, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(detail);
  return value as number;
}

function reasonCodes(value: unknown, detail: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) invalid(detail);
  const codes: string[] = [];
  for (const code of value) {
    if (typeof code !== "string" || !reasonPattern.test(code) || codes.includes(code)) invalid(detail);
    codes.push(code);
  }
  if (codes.some((code, index) => index > 0 && code <= codes[index - 1]!)) invalid(`${detail}:unsorted`);
  return Object.freeze(codes);
}

function modelIdentity(value: unknown, detail: string): Readonly<ModelIdentity> {
  const identity = record(value, detail);
  exactKeys(identity, ["family", "provider", "model"], detail);
  return Object.freeze({
    family: identifier(identity.family, `${detail}.family`),
    provider: identifier(identity.provider, `${detail}.provider`),
    model: identifier(identity.model, `${detail}.model`),
  });
}

function actualIdentity(value: unknown, detail: string): Readonly<ActualModelIdentity> {
  const identity = record(value, detail);
  exactKeys(identity, ["family", "provider", "model", "sdkProvider"], detail);
  return Object.freeze({
    family: identifier(identity.family, `${detail}.family`),
    provider: identifier(identity.provider, `${detail}.provider`),
    model: identifier(identity.model, `${detail}.model`),
    sdkProvider: identifier(identity.sdkProvider, `${detail}.sdkProvider`),
  });
}

const routeRunKeys = Object.freeze([
  "routeMemberDigest", "routeQualificationDigest", "runAuthorizationDigest", "requestedIdentity",
  "actualIdentity", "startedAt", "endedAt", "usefulStartedAt", "usefulEndedAt", "usage", "latency",
  "outcome", "acceptedOutputDigest",
]);

export function parseParallelRouteRun(value: unknown): ParallelRouteRun {
  const run = record(value, "routeRun");
  exactKeys(run, routeRunKeys, "routeRun");
  if (run.outcome !== "accepted" && run.outcome !== "rejected" && run.outcome !== "failed") invalid("routeRun.outcome");
  const outcome = run.outcome as ParallelRunOutcome;

  const startedAt = instant(run.startedAt, "routeRun.startedAt");
  const endedAt = instant(run.endedAt, "routeRun.endedAt");
  if (Date.parse(endedAt) < Date.parse(startedAt)) invalid("routeRun.interval");

  const usefulStartedAt = nullableInstant(run.usefulStartedAt, "routeRun.usefulStartedAt");
  const usefulEndedAt = nullableInstant(run.usefulEndedAt, "routeRun.usefulEndedAt");
  // Useful work is only meaningful for an accepted run, and its interval must sit
  // inside the observed attempt interval. A non-accepted run has no useful work.
  if ((usefulStartedAt === null) !== (usefulEndedAt === null)) invalid("routeRun.usefulInterval");
  if (outcome === "accepted" && usefulStartedAt === null) invalid("routeRun.usefulInterval:accepted-requires-useful");
  if (outcome !== "accepted" && usefulStartedAt !== null) invalid("routeRun.usefulInterval:only-accepted-has-useful");
  if (usefulStartedAt !== null && usefulEndedAt !== null) {
    if (Date.parse(usefulEndedAt) < Date.parse(usefulStartedAt)) invalid("routeRun.usefulInterval:reversed");
    if (Date.parse(usefulStartedAt) < Date.parse(startedAt) || Date.parse(usefulEndedAt) > Date.parse(endedAt)) {
      invalid("routeRun.usefulInterval:outside-attempt");
    }
  }

  const usage = record(run.usage, "routeRun.usage");
  exactKeys(usage, ["inputTokens", "outputTokens", "totalTokens"], "routeRun.usage");
  const inputTokens = count(usage.inputTokens, "routeRun.usage.inputTokens");
  const outputTokens = count(usage.outputTokens, "routeRun.usage.outputTokens");
  const totalTokens = count(usage.totalTokens, "routeRun.usage.totalTokens");
  if (totalTokens !== inputTokens + outputTokens) invalid("routeRun.usage.totalTokens:not-sum");

  const latency = record(run.latency, "routeRun.latency");
  exactKeys(latency, ["milliseconds", "usefulMilliseconds"], "routeRun.latency");
  const milliseconds = count(latency.milliseconds, "routeRun.latency.milliseconds");
  const usefulMilliseconds = count(latency.usefulMilliseconds, "routeRun.latency.usefulMilliseconds");
  if (usefulMilliseconds > milliseconds) invalid("routeRun.latency:useful-exceeds-total");
  if (milliseconds !== Date.parse(endedAt) - Date.parse(startedAt)) invalid("routeRun.latency:not-observed");
  const derivedUseful = usefulStartedAt === null || usefulEndedAt === null
    ? 0 : Date.parse(usefulEndedAt) - Date.parse(usefulStartedAt);
  if (usefulMilliseconds !== derivedUseful) invalid("routeRun.latency.usefulMilliseconds:not-observed");

  const acceptedOutputDigest = nullableDigest(run.acceptedOutputDigest, "routeRun.acceptedOutputDigest");
  if ((outcome === "accepted") !== (acceptedOutputDigest !== null)) invalid("routeRun.acceptedOutputDigest:outcome-mismatch");

  return Object.freeze({
    routeMemberDigest: digest(run.routeMemberDigest, "routeRun.routeMemberDigest"),
    routeQualificationDigest: digest(run.routeQualificationDigest, "routeRun.routeQualificationDigest"),
    runAuthorizationDigest: digest(run.runAuthorizationDigest, "routeRun.runAuthorizationDigest"),
    requestedIdentity: modelIdentity(run.requestedIdentity, "routeRun.requestedIdentity"),
    actualIdentity: actualIdentity(run.actualIdentity, "routeRun.actualIdentity"),
    startedAt, endedAt, usefulStartedAt, usefulEndedAt,
    usage: Object.freeze({ inputTokens, outputTokens, totalTokens }),
    latency: Object.freeze({ milliseconds, usefulMilliseconds }),
    outcome, acceptedOutputDigest,
  });
}

/**
 * Useful overlap per urn:usf:parallel-provider-run:1: the positive intersection
 * of accepted useful-work intervals from at least two distinct independently
 * qualified provider families.
 *
 * A sweep over interval endpoints accumulates only the milliseconds during which
 * two or more *distinct families* hold an accepted useful interval, so repeated
 * routes inside one family can never manufacture overlap.
 */
export function usefulOverlapMilliseconds(runs: readonly ParallelRouteRun[]): number {
  const intervals = runs
    .filter((run) => run.outcome === "accepted" && run.usefulStartedAt !== null && run.usefulEndedAt !== null)
    .map((run) => ({
      family: run.requestedIdentity.family,
      start: Date.parse(run.usefulStartedAt as string),
      end: Date.parse(run.usefulEndedAt as string),
    }))
    .filter((interval) => interval.end > interval.start);
  if (new Set(intervals.map((interval) => interval.family)).size < 2) return 0;

  const boundaries = [...new Set(intervals.flatMap((interval) => [interval.start, interval.end]))].sort((a, b) => a - b);
  let overlap = 0;
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const from = boundaries[index]!;
    const to = boundaries[index + 1]!;
    const families = new Set(intervals.filter((interval) => interval.start <= from && interval.end >= to).map((i) => i.family));
    if (families.size >= 2) overlap += to - from;
  }
  return overlap;
}

const runKeys = Object.freeze([
  "schema", "version", "workloadDigest", "profileDigest", "semanticContextDigest",
  "eligibilitySnapshotDigest", "eligibleCandidateCount", "routeRuns", "excludedCandidates",
  "startedAt", "endedAt", "routeFamilyCount", "usefulOverlapMilliseconds", "concurrencyMetrics",
  "tokenMetrics", "costMetrics", "acceptedOutputs", "failures", "zeroPaidDisposition",
]);

export function parseParallelProviderRun(value: unknown): ParallelProviderRun {
  const run = record(value, "run");
  exactKeys(run, runKeys, "run");
  if (run.schema !== "urn:usf:parallel-provider-run:1" || run.version !== 1) invalid("run.identity");

  if (!Array.isArray(run.routeRuns) || run.routeRuns.length < 1 || run.routeRuns.length > 64) invalid("run.routeRuns");
  const routeRuns = run.routeRuns.map((entry) => parseParallelRouteRun(entry));
  const memberDigests = routeRuns.map((entry) => entry.routeMemberDigest);
  if (new Set(memberDigests).size !== memberDigests.length) invalid("run.routeRuns:duplicate-route");

  if (!Array.isArray(run.excludedCandidates) || run.excludedCandidates.length > 256) invalid("run.excludedCandidates");
  const excludedCandidates = run.excludedCandidates.map((entry) => {
    const excluded = record(entry, "run.excludedCandidates[]");
    exactKeys(excluded, ["candidateMemberDigest", "disposition", "reasonCodes"], "run.excludedCandidates[]");
    if (excluded.disposition !== "excluded" && excluded.disposition !== "deferred") invalid("run.excludedCandidates[].disposition");
    return Object.freeze({
      candidateMemberDigest: digest(excluded.candidateMemberDigest, "run.excludedCandidates[].candidateMemberDigest"),
      disposition: excluded.disposition as "excluded" | "deferred",
      reasonCodes: reasonCodes(excluded.reasonCodes, "run.excludedCandidates[].reasonCodes"),
    });
  });

  const startedAt = instant(run.startedAt, "run.startedAt");
  const endedAt = instant(run.endedAt, "run.endedAt");
  if (Date.parse(endedAt) < Date.parse(startedAt)) invalid("run.interval");
  for (const entry of routeRuns) {
    if (Date.parse(entry.startedAt) < Date.parse(startedAt) || Date.parse(entry.endedAt) > Date.parse(endedAt)) {
      invalid("run.routeRuns:outside-run-interval");
    }
  }

  const eligibleCandidateCount = count(run.eligibleCandidateCount, "run.eligibleCandidateCount");
  if (eligibleCandidateCount < routeRuns.length) invalid("run.eligibleCandidateCount:below-run-count");

  const declaredFamilies = new Set(routeRuns.map((entry) => entry.requestedIdentity.family));
  const routeFamilyCount = count(run.routeFamilyCount, "run.routeFamilyCount");
  if (routeFamilyCount !== declaredFamilies.size) invalid("run.routeFamilyCount:not-observed");

  // The overlap member is recomputed from the recorded intervals, so a caller
  // cannot assert parallelism the observed timestamps do not support.
  const overlap = count(run.usefulOverlapMilliseconds, "run.usefulOverlapMilliseconds");
  if (overlap !== usefulOverlapMilliseconds(routeRuns)) invalid("run.usefulOverlapMilliseconds:not-derived");

  const concurrency = record(run.concurrencyMetrics, "run.concurrencyMetrics");
  exactKeys(concurrency, ["hostConcurrencyCap", "providerConcurrencyCap", "targetConcurrency",
    "observedConcurrency", "launchedBeforeFirstSettlement", "dispatchSerialised"], "run.concurrencyMetrics");
  if (concurrency.dispatchSerialised !== false) invalid("run.concurrencyMetrics.dispatchSerialised");
  const hostConcurrencyCap = count(concurrency.hostConcurrencyCap, "run.concurrencyMetrics.hostConcurrencyCap", 1024, 1);
  const providerConcurrencyCap = count(concurrency.providerConcurrencyCap, "run.concurrencyMetrics.providerConcurrencyCap", 1024, 1);
  const targetConcurrency = count(concurrency.targetConcurrency, "run.concurrencyMetrics.targetConcurrency", 1024, 1);
  const observedConcurrency = count(concurrency.observedConcurrency, "run.concurrencyMetrics.observedConcurrency", 1024);
  const launchedBeforeFirstSettlement = count(concurrency.launchedBeforeFirstSettlement, "run.concurrencyMetrics.launchedBeforeFirstSettlement", 1024);
  if (targetConcurrency > hostConcurrencyCap || observedConcurrency > targetConcurrency
    || launchedBeforeFirstSettlement > observedConcurrency) invalid("run.concurrencyMetrics:bounds");

  const tokens = record(run.tokenMetrics, "run.tokenMetrics");
  exactKeys(tokens, ["inputTokens", "outputTokens", "totalTokens", "usefulTokens"], "run.tokenMetrics");
  const inputTokens = count(tokens.inputTokens, "run.tokenMetrics.inputTokens");
  const outputTokens = count(tokens.outputTokens, "run.tokenMetrics.outputTokens");
  const totalTokens = count(tokens.totalTokens, "run.tokenMetrics.totalTokens");
  const usefulTokens = count(tokens.usefulTokens, "run.tokenMetrics.usefulTokens");
  if (totalTokens !== inputTokens + outputTokens) invalid("run.tokenMetrics.totalTokens:not-sum");
  if (inputTokens !== routeRuns.reduce((sum, entry) => sum + entry.usage.inputTokens, 0)
    || outputTokens !== routeRuns.reduce((sum, entry) => sum + entry.usage.outputTokens, 0)) {
    invalid("run.tokenMetrics:not-observed");
  }
  const acceptedTokens = routeRuns.filter((entry) => entry.outcome === "accepted")
    .reduce((sum, entry) => sum + entry.usage.totalTokens, 0);
  if (usefulTokens !== acceptedTokens) invalid("run.tokenMetrics.usefulTokens:not-accepted-sum");

  const cost = record(run.costMetrics, "run.costMetrics");
  exactKeys(cost, ["costClass", "observedCostUsd", "paidCostCeiling"], "run.costMetrics");
  if ((cost.costClass !== "zero-paid" && cost.costClass !== "local")
    || cost.observedCostUsd !== "0" || cost.paidCostCeiling !== "0") invalid("run.costMetrics");

  if (!Array.isArray(run.acceptedOutputs) || run.acceptedOutputs.length > 64) invalid("run.acceptedOutputs");
  const acceptedOutputs = run.acceptedOutputs.map((entry) => {
    const output = record(entry, "run.acceptedOutputs[]");
    exactKeys(output, ["routeMemberDigest", "outputDigest"], "run.acceptedOutputs[]");
    return Object.freeze({
      routeMemberDigest: digest(output.routeMemberDigest, "run.acceptedOutputs[].routeMemberDigest"),
      outputDigest: digest(output.outputDigest, "run.acceptedOutputs[].outputDigest"),
    });
  });
  const acceptedRuns = routeRuns.filter((entry) => entry.outcome === "accepted");
  if (acceptedOutputs.length !== acceptedRuns.length) invalid("run.acceptedOutputs:count");
  for (const accepted of acceptedRuns) {
    const match = acceptedOutputs.find((output) => output.routeMemberDigest === accepted.routeMemberDigest);
    if (match === undefined || match.outputDigest !== accepted.acceptedOutputDigest) invalid("run.acceptedOutputs:mismatch");
  }

  if (!Array.isArray(run.failures) || run.failures.length > 64) invalid("run.failures");
  const failures = run.failures.map((entry) => {
    const failure = record(entry, "run.failures[]");
    exactKeys(failure, ["routeMemberDigest", "reasonCodes"], "run.failures[]");
    return Object.freeze({
      routeMemberDigest: digest(failure.routeMemberDigest, "run.failures[].routeMemberDigest"),
      reasonCodes: reasonCodes(failure.reasonCodes, "run.failures[].reasonCodes"),
    });
  });
  const failedRuns = routeRuns.filter((entry) => entry.outcome !== "accepted");
  if (failures.length !== failedRuns.length) invalid("run.failures:count");

  if (run.zeroPaidDisposition !== "zero-paid" && run.zeroPaidDisposition !== "not-observed"
    && run.zeroPaidDisposition !== "refused") invalid("run.zeroPaidDisposition");

  return Object.freeze({
    schema: "urn:usf:parallel-provider-run:1",
    version: 1,
    workloadDigest: digest(run.workloadDigest, "run.workloadDigest"),
    profileDigest: digest(run.profileDigest, "run.profileDigest"),
    semanticContextDigest: digest(run.semanticContextDigest, "run.semanticContextDigest"),
    eligibilitySnapshotDigest: digest(run.eligibilitySnapshotDigest, "run.eligibilitySnapshotDigest"),
    eligibleCandidateCount,
    routeRuns: Object.freeze(routeRuns),
    excludedCandidates: Object.freeze(excludedCandidates),
    startedAt, endedAt, routeFamilyCount,
    usefulOverlapMilliseconds: overlap,
    concurrencyMetrics: Object.freeze({
      hostConcurrencyCap, providerConcurrencyCap, targetConcurrency, observedConcurrency,
      launchedBeforeFirstSettlement, dispatchSerialised: false as const,
    }),
    tokenMetrics: Object.freeze({ inputTokens, outputTokens, totalTokens, usefulTokens }),
    costMetrics: Object.freeze({
      costClass: cost.costClass as "zero-paid" | "local", observedCostUsd: "0" as const, paidCostCeiling: "0" as const,
    }),
    acceptedOutputs: Object.freeze(acceptedOutputs),
    failures: Object.freeze(failures),
    zeroPaidDisposition: run.zeroPaidDisposition as ZeroPaidDisposition,
  });
}

export function parallelProviderRunDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseParallelProviderRun(value), { rejectAbsolutePaths: true });
}

// ---------------------------------------------------------------------------
// Bounded parallel dispatch.
//
// urn:usf:requirement:provider-pipeline-parallelism requires that, at one
// frozen eligibility snapshot, every candidate admitted by useful-work and
// bounded provider/host concurrency policy is *launched* before any result is
// awaited, that every excluded candidate keeps an explicit disposition, and
// that no single-composer serialization bottleneck exists.
//
// The launch loop below is deliberately synchronous: it calls each `launch`
// and retains the promise without awaiting, so no settlement can interleave
// while a wave is being dispatched. `launchedBeforeFirstSettlement` records how
// many launches actually preceded the first observed settlement, which is the
// only honest evidence that dispatch was independent rather than serial.
// ---------------------------------------------------------------------------

export interface ParallelDispatchOutcome {
  readonly outcome: ParallelRunOutcome;
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number }>;
  /** Observed useful-work interval; an accepted run must report one. */
  readonly usefulStartedAtMs: number | null;
  readonly usefulEndedAtMs: number | null;
  readonly acceptedOutputDigest: string | null;
  readonly reasonCodes?: readonly string[];
}

export interface ParallelDispatchCandidate {
  readonly candidateMemberDigest: string;
  readonly routeMemberDigest: string;
  readonly routeQualificationDigest: string;
  readonly runAuthorizationDigest: string;
  readonly requestedIdentity: Readonly<ModelIdentity>;
  readonly actualIdentity: Readonly<ActualModelIdentity>;
  readonly admitted: boolean;
  readonly exclusionReasonCodes?: readonly string[];
  readonly launch: () => Promise<ParallelDispatchOutcome>;
}

export interface ParallelDispatchInput {
  readonly candidates: readonly ParallelDispatchCandidate[];
  readonly hostConcurrencyCap: number;
  readonly providerConcurrencyCap: number;
  readonly now: () => number;
}

export interface ParallelDispatchObservation {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly routeRuns: readonly ParallelRouteRun[];
  readonly excludedCandidates: ParallelProviderRun["excludedCandidates"];
  readonly targetConcurrency: number;
  readonly observedConcurrency: number;
  readonly launchedBeforeFirstSettlement: number;
}

const isoInstant = (ms: number): string => new Date(ms).toISOString();

export async function dispatchParallel(input: ParallelDispatchInput): Promise<ParallelDispatchObservation> {
  const hostCap = count(input.hostConcurrencyCap, "dispatch.hostConcurrencyCap", 1024, 1);
  const providerCap = count(input.providerConcurrencyCap, "dispatch.providerConcurrencyCap", 1024, 1);
  if (input.candidates.length < 1 || input.candidates.length > 64) invalid("dispatch.candidates");
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    if (seen.has(candidate.routeMemberDigest)) invalid("dispatch.candidates:duplicate-route");
    seen.add(candidate.routeMemberDigest);
  }

  const admitted = input.candidates.filter((candidate) => candidate.admitted);
  const excludedCandidates = input.candidates
    .filter((candidate) => !candidate.admitted)
    .map((candidate) => Object.freeze({
      candidateMemberDigest: digest(candidate.candidateMemberDigest, "dispatch.excluded.candidateMemberDigest"),
      disposition: "excluded" as const,
      reasonCodes: reasonCodes(candidate.exclusionReasonCodes ?? ["PARALLEL_CANDIDATE_NOT_ADMITTED"], "dispatch.excluded.reasonCodes"),
    }))
    .sort((left, right) => left.candidateMemberDigest.localeCompare(right.candidateMemberDigest));
  if (admitted.length < 1) invalid("dispatch.candidates:none-admitted");

  const startedAtMs = input.now();
  const targetConcurrency = Math.min(hostCap, admitted.length);

  const runs: ParallelRouteRun[] = [];
  const providerInFlight = new Map<string, number>();
  let inFlight = 0;
  let observedConcurrency = 0;
  let settlements = 0;
  let launched = 0;
  let launchedBeforeFirstSettlement = 0;
  let cursor = 0;
  const pending = new Map<number, Promise<void>>();

  const settle = (candidate: ParallelDispatchCandidate, promise: Promise<ParallelDispatchOutcome>, token: number): Promise<void> =>
    promise.then(
      (result) => ({ result }),
      // Failure isolation: one route's rejection never aborts a sibling.
      (error: unknown) => ({
        result: {
          outcome: "failed" as const,
          usage: { inputTokens: 0, outputTokens: 0 },
          usefulStartedAtMs: null, usefulEndedAtMs: null, acceptedOutputDigest: null,
          reasonCodes: [`PARALLEL_ROUTE_DISPATCH_FAILED:${error instanceof Error ? error.name : "UNKNOWN"}`],
        } satisfies ParallelDispatchOutcome,
      }),
    ).then(({ result }) => {
      if (settlements === 0) launchedBeforeFirstSettlement = launched;
      settlements += 1;
      inFlight -= 1;
      providerInFlight.set(candidate.requestedIdentity.provider, (providerInFlight.get(candidate.requestedIdentity.provider) ?? 1) - 1);
      const endedAtMs = input.now();
      const accepted = result.outcome === "accepted";
      const usefulStartedAtMs = accepted ? result.usefulStartedAtMs : null;
      const usefulEndedAtMs = accepted ? result.usefulEndedAtMs : null;
      if (accepted && (usefulStartedAtMs === null || usefulEndedAtMs === null)) invalid("dispatch.outcome:accepted-without-useful-interval");
      const startMs = launchTimes.get(token)!;
      runs.push(parseParallelRouteRun({
        routeMemberDigest: candidate.routeMemberDigest,
        routeQualificationDigest: candidate.routeQualificationDigest,
        runAuthorizationDigest: candidate.runAuthorizationDigest,
        requestedIdentity: candidate.requestedIdentity,
        actualIdentity: candidate.actualIdentity,
        startedAt: isoInstant(startMs),
        endedAt: isoInstant(endedAtMs),
        usefulStartedAt: usefulStartedAtMs === null ? null : isoInstant(usefulStartedAtMs),
        usefulEndedAt: usefulEndedAtMs === null ? null : isoInstant(usefulEndedAtMs),
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.inputTokens + result.usage.outputTokens,
        },
        latency: {
          milliseconds: endedAtMs - startMs,
          usefulMilliseconds: usefulStartedAtMs === null || usefulEndedAtMs === null ? 0 : usefulEndedAtMs - usefulStartedAtMs,
        },
        outcome: result.outcome,
        acceptedOutputDigest: accepted ? result.acceptedOutputDigest : null,
      }));
      pending.delete(token);
    });

  const launchTimes = new Map<number, number>();

  /** Launch every candidate the caps currently allow, without awaiting. */
  const fill = (): void => {
    while (cursor < admitted.length && inFlight < targetConcurrency) {
      const candidate = admitted[cursor]!;
      const provider = candidate.requestedIdentity.provider;
      if ((providerInFlight.get(provider) ?? 0) >= providerCap) break;
      cursor += 1;
      const token = launched;
      launched += 1;
      inFlight += 1;
      providerInFlight.set(provider, (providerInFlight.get(provider) ?? 0) + 1);
      if (inFlight > observedConcurrency) observedConcurrency = inFlight;
      launchTimes.set(token, input.now());
      pending.set(token, settle(candidate, candidate.launch(), token));
    }
  };

  fill();
  while (pending.size > 0) {
    await Promise.race([...pending.values()]);
    fill();
  }

  return Object.freeze({
    startedAtMs,
    endedAtMs: input.now(),
    routeRuns: Object.freeze([...runs].sort((left, right) => left.routeMemberDigest.localeCompare(right.routeMemberDigest))),
    excludedCandidates: Object.freeze(excludedCandidates),
    targetConcurrency,
    observedConcurrency,
    launchedBeforeFirstSettlement,
  });
}

export interface ParallelRunAssemblyInput {
  readonly workloadDigest: string;
  readonly profileDigest: string;
  readonly semanticContextDigest: string;
  readonly eligibilitySnapshotDigest: string;
  readonly eligibleCandidateCount: number;
  readonly hostConcurrencyCap: number;
  readonly providerConcurrencyCap: number;
  readonly costClass: "zero-paid" | "local";
  readonly zeroPaidDisposition: ZeroPaidDisposition;
  readonly observation: ParallelDispatchObservation;
}

/**
 * Assemble the closed run record from the observation. Every derived member is
 * computed from the recorded route runs and then re-validated by
 * `parseParallelProviderRun`, so the record cannot claim overlap, concurrency or
 * token totals the observation does not support.
 */
export function assembleParallelProviderRun(input: ParallelRunAssemblyInput): ParallelProviderRun {
  const runs = input.observation.routeRuns;
  const accepted = runs.filter((run) => run.outcome === "accepted");
  return parseParallelProviderRun({
    schema: "urn:usf:parallel-provider-run:1",
    version: 1,
    workloadDigest: input.workloadDigest,
    profileDigest: input.profileDigest,
    semanticContextDigest: input.semanticContextDigest,
    eligibilitySnapshotDigest: input.eligibilitySnapshotDigest,
    eligibleCandidateCount: input.eligibleCandidateCount,
    routeRuns: runs,
    excludedCandidates: input.observation.excludedCandidates,
    startedAt: isoInstant(input.observation.startedAtMs),
    endedAt: isoInstant(input.observation.endedAtMs),
    routeFamilyCount: new Set(runs.map((run) => run.requestedIdentity.family)).size,
    usefulOverlapMilliseconds: usefulOverlapMilliseconds(runs),
    concurrencyMetrics: {
      hostConcurrencyCap: input.hostConcurrencyCap,
      providerConcurrencyCap: input.providerConcurrencyCap,
      targetConcurrency: input.observation.targetConcurrency,
      observedConcurrency: input.observation.observedConcurrency,
      launchedBeforeFirstSettlement: input.observation.launchedBeforeFirstSettlement,
      dispatchSerialised: false,
    },
    tokenMetrics: {
      inputTokens: runs.reduce((sum, run) => sum + run.usage.inputTokens, 0),
      outputTokens: runs.reduce((sum, run) => sum + run.usage.outputTokens, 0),
      totalTokens: runs.reduce((sum, run) => sum + run.usage.totalTokens, 0),
      usefulTokens: accepted.reduce((sum, run) => sum + run.usage.totalTokens, 0),
    },
    costMetrics: { costClass: input.costClass, observedCostUsd: "0", paidCostCeiling: "0" },
    acceptedOutputs: accepted.map((run) => ({
      routeMemberDigest: run.routeMemberDigest, outputDigest: run.acceptedOutputDigest as string,
    })),
    failures: runs.filter((run) => run.outcome !== "accepted").map((run) => ({
      routeMemberDigest: run.routeMemberDigest,
      reasonCodes: [run.outcome === "rejected" ? "PARALLEL_ROUTE_REJECTED" : "PARALLEL_ROUTE_FAILED"],
    })),
    zeroPaidDisposition: input.zeroPaidDisposition,
  });
}

// ---------------------------------------------------------------------------
// Immutable baseline / candidate comparison.
// urn:usf:provider-operation:baseline-run-receipt:1 is write-once
// content-addressed and its candidate counterpart declares
// baselineMutation "prohibited": the candidate binds the baseline's exact
// content digest and can never rewrite it. Missing usage, cache or equivalence
// evidence yields NO_BENEFIT_CLAIM rather than an optimistic reduction claim.
// ---------------------------------------------------------------------------

export interface SemanticTokenComparison {
  readonly schema: "urn:usf:semantic-token-comparison:1";
  readonly version: 1;
  readonly workloadDigest: string;
  readonly equivalenceDigest: string;
  readonly baselineRunDigest: string;
  readonly candidateRunDigest: string;
  readonly semanticCacheKeyDigest: string;
  readonly baselineMetrics: Readonly<Record<string, number | string>>;
  readonly candidateMetrics: Readonly<Record<string, number | string>>;
  readonly grossTokens: number;
  readonly usefulTokens: number;
  readonly cachedTokens: number;
  readonly avoidedTokens: number;
  readonly cacheReuse: number;
  readonly yield: number;
  readonly elapsedThroughput: Readonly<Record<string, number>>;
  readonly correctnessDisposition: RegressionDisposition;
  readonly privacyDisposition: RegressionDisposition;
  readonly authorityDisposition: RegressionDisposition;
  readonly throughputDisposition: RegressionDisposition;
  readonly zeroPaidDisposition: ZeroPaidDisposition;
  readonly benefitDisposition: BenefitDisposition;
}

const comparisonKeys = Object.freeze([
  "schema", "version", "workloadDigest", "equivalenceDigest", "baselineRunDigest", "candidateRunDigest",
  "semanticCacheKeyDigest", "baselineMetrics", "candidateMetrics", "grossTokens", "usefulTokens",
  "cachedTokens", "avoidedTokens", "cacheReuse", "yield", "elapsedThroughput", "correctnessDisposition",
  "privacyDisposition", "authorityDisposition", "throughputDisposition", "zeroPaidDisposition",
  "benefitDisposition",
]);

const metricsKeys = Object.freeze([
  "runDigest", "inputTokens", "outputTokens", "totalTokens", "usefulTokens",
  "elapsedMilliseconds", "acceptedOutputCount", "semanticCacheReuseTokens",
]);

const regression = (value: unknown, detail: string): RegressionDisposition => {
  if (value !== "no-regression" && value !== "regression" && value !== "not-observed") invalid(detail);
  return value;
};

export function parseSemanticTokenComparison(value: unknown): SemanticTokenComparison {
  const comparison = record(value, "comparison");
  exactKeys(comparison, comparisonKeys, "comparison");
  if (comparison.schema !== "urn:usf:semantic-token-comparison:1" || comparison.version !== 1) invalid("comparison.identity");

  const metrics = (raw: unknown, detail: string): Readonly<Record<string, number | string>> => {
    const entry = record(raw, detail);
    exactKeys(entry, metricsKeys, detail);
    const inputTokens = count(entry.inputTokens, `${detail}.inputTokens`);
    const outputTokens = count(entry.outputTokens, `${detail}.outputTokens`);
    const totalTokens = count(entry.totalTokens, `${detail}.totalTokens`);
    if (totalTokens !== inputTokens + outputTokens) invalid(`${detail}.totalTokens:not-sum`);
    const usefulTokens = count(entry.usefulTokens, `${detail}.usefulTokens`);
    if (usefulTokens > totalTokens) invalid(`${detail}.usefulTokens:exceeds-total`);
    return Object.freeze({
      runDigest: digest(entry.runDigest, `${detail}.runDigest`),
      inputTokens, outputTokens, totalTokens, usefulTokens,
      elapsedMilliseconds: count(entry.elapsedMilliseconds, `${detail}.elapsedMilliseconds`),
      acceptedOutputCount: count(entry.acceptedOutputCount, `${detail}.acceptedOutputCount`),
      semanticCacheReuseTokens: count(entry.semanticCacheReuseTokens, `${detail}.semanticCacheReuseTokens`),
    });
  };

  const baselineRunDigest = digest(comparison.baselineRunDigest, "comparison.baselineRunDigest");
  const candidateRunDigest = digest(comparison.candidateRunDigest, "comparison.candidateRunDigest");
  const baselineMetrics = metrics(comparison.baselineMetrics, "comparison.baselineMetrics");
  const candidateMetrics = metrics(comparison.candidateMetrics, "comparison.candidateMetrics");
  // The metrics blocks must bind their own run digests, so a comparison can
  // never quietly attribute one run's telemetry to the other.
  if (baselineMetrics.runDigest !== baselineRunDigest) invalid("comparison.baselineMetrics.runDigest:not-bound");
  if (candidateMetrics.runDigest !== candidateRunDigest) invalid("comparison.candidateMetrics.runDigest:not-bound");
  if (baselineRunDigest === candidateRunDigest) invalid("comparison.runDigests:identical");

  const grossTokens = count(comparison.grossTokens, "comparison.grossTokens");
  const usefulTokens = count(comparison.usefulTokens, "comparison.usefulTokens");
  const cachedTokens = count(comparison.cachedTokens, "comparison.cachedTokens");
  if (!Number.isSafeInteger(comparison.avoidedTokens)) invalid("comparison.avoidedTokens");
  const avoidedTokens = comparison.avoidedTokens as number;
  if (avoidedTokens !== (baselineMetrics.totalTokens as number) - (candidateMetrics.totalTokens as number)) {
    invalid("comparison.avoidedTokens:not-derived");
  }
  if (grossTokens !== (candidateMetrics.totalTokens as number)) invalid("comparison.grossTokens:not-derived");
  if (usefulTokens !== (candidateMetrics.usefulTokens as number)) invalid("comparison.usefulTokens:not-derived");
  if (cachedTokens !== (candidateMetrics.semanticCacheReuseTokens as number)) invalid("comparison.cachedTokens:not-derived");

  const ratio = (raw: unknown, detail: string): number => {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) invalid(detail);
    return raw;
  };
  const cacheReuse = ratio(comparison.cacheReuse, "comparison.cacheReuse");
  const yieldRatio = ratio(comparison.yield, "comparison.yield");

  const throughput = record(comparison.elapsedThroughput, "comparison.elapsedThroughput");
  exactKeys(throughput, ["baselineElapsedMilliseconds", "candidateElapsedMilliseconds",
    "baselineTokensPerSecond", "candidateTokensPerSecond"], "comparison.elapsedThroughput");
  for (const key of ["baselineTokensPerSecond", "candidateTokensPerSecond"]) {
    const raw = throughput[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) invalid(`comparison.elapsedThroughput.${key}`);
  }
  const elapsedThroughput = Object.freeze({
    baselineElapsedMilliseconds: count(throughput.baselineElapsedMilliseconds, "comparison.elapsedThroughput.baselineElapsedMilliseconds"),
    candidateElapsedMilliseconds: count(throughput.candidateElapsedMilliseconds, "comparison.elapsedThroughput.candidateElapsedMilliseconds"),
    baselineTokensPerSecond: throughput.baselineTokensPerSecond as number,
    candidateTokensPerSecond: throughput.candidateTokensPerSecond as number,
  });

  const correctnessDisposition = regression(comparison.correctnessDisposition, "comparison.correctnessDisposition");
  const privacyDisposition = regression(comparison.privacyDisposition, "comparison.privacyDisposition");
  const authorityDisposition = regression(comparison.authorityDisposition, "comparison.authorityDisposition");
  const throughputDisposition = regression(comparison.throughputDisposition, "comparison.throughputDisposition");
  if (comparison.zeroPaidDisposition !== "zero-paid" && comparison.zeroPaidDisposition !== "not-observed"
    && comparison.zeroPaidDisposition !== "refused") invalid("comparison.zeroPaidDisposition");
  if (comparison.benefitDisposition !== "SEMANTIC_TOKEN_REDUCTION" && comparison.benefitDisposition !== "NO_BENEFIT_CLAIM") {
    invalid("comparison.benefitDisposition");
  }

  // A reduction claim requires every no-regression disposition, zero-paid cost,
  // genuinely fewer candidate tokens and equal accepted output counts.
  const claimable = correctnessDisposition === "no-regression" && privacyDisposition === "no-regression"
    && authorityDisposition === "no-regression" && throughputDisposition === "no-regression"
    && comparison.zeroPaidDisposition === "zero-paid" && avoidedTokens > 0
    && baselineMetrics.acceptedOutputCount === candidateMetrics.acceptedOutputCount;
  if (comparison.benefitDisposition === "SEMANTIC_TOKEN_REDUCTION" && !claimable) {
    invalid("comparison.benefitDisposition:unsupported-claim");
  }

  return Object.freeze({
    schema: "urn:usf:semantic-token-comparison:1",
    version: 1,
    workloadDigest: digest(comparison.workloadDigest, "comparison.workloadDigest"),
    equivalenceDigest: digest(comparison.equivalenceDigest, "comparison.equivalenceDigest"),
    baselineRunDigest, candidateRunDigest,
    semanticCacheKeyDigest: digest(comparison.semanticCacheKeyDigest, "comparison.semanticCacheKeyDigest"),
    baselineMetrics, candidateMetrics,
    grossTokens, usefulTokens, cachedTokens, avoidedTokens,
    cacheReuse, yield: yieldRatio, elapsedThroughput,
    correctnessDisposition, privacyDisposition, authorityDisposition, throughputDisposition,
    zeroPaidDisposition: comparison.zeroPaidDisposition as ZeroPaidDisposition,
    benefitDisposition: comparison.benefitDisposition as BenefitDisposition,
  });
}

export function semanticTokenComparisonDigest(value: unknown): `sha256:${string}` {
  return canonicalDigest(parseSemanticTokenComparison(value), { rejectAbsolutePaths: true });
}

const runMetrics = (run: ParallelProviderRun, cacheReuseTokens: number): Record<string, number | string> => ({
  runDigest: parallelProviderRunDigest(run),
  inputTokens: run.tokenMetrics.inputTokens,
  outputTokens: run.tokenMetrics.outputTokens,
  totalTokens: run.tokenMetrics.totalTokens,
  usefulTokens: run.tokenMetrics.usefulTokens,
  elapsedMilliseconds: Date.parse(run.endedAt) - Date.parse(run.startedAt),
  acceptedOutputCount: run.acceptedOutputs.length,
  semanticCacheReuseTokens: cacheReuseTokens,
});

/**
 * Derive the comparison from two immutable run records. The baseline object is
 * only read: its content digest is recomputed and bound, never rewritten. Any
 * missing equivalence, differing accepted outputs or absent cache evidence falls
 * to NO_BENEFIT_CLAIM.
 */
export function deriveSemanticTokenComparison(input: {
  readonly baseline: ParallelProviderRun;
  readonly candidate: ParallelProviderRun;
  readonly semanticCacheKeyDigest: string;
  readonly candidateCacheReuseTokens: number;
}): SemanticTokenComparison {
  const baseline = parseParallelProviderRun(input.baseline);
  const candidate = parseParallelProviderRun(input.candidate);
  const baselineRunDigest = parallelProviderRunDigest(baseline);
  const candidateRunDigest = parallelProviderRunDigest(candidate);
  if (baselineRunDigest === candidateRunDigest) invalid("comparison.runDigests:identical");

  // exact-workload-equivalence and accepted-output-equivalence, per
  // urn:usf:provider-operation:parallel-token-comparison:1.
  const sameWorkload = baseline.workloadDigest === candidate.workloadDigest
    && baseline.profileDigest === candidate.profileDigest
    && baseline.semanticContextDigest === candidate.semanticContextDigest;
  const baselineOutputs = [...baseline.acceptedOutputs].map((o) => o.outputDigest).sort();
  const candidateOutputs = [...candidate.acceptedOutputs].map((o) => o.outputDigest).sort();
  const sameOutputs = baselineOutputs.length === candidateOutputs.length
    && baselineOutputs.every((value, index) => value === candidateOutputs[index]);
  const zeroPaid = baseline.zeroPaidDisposition === "zero-paid" && candidate.zeroPaidDisposition === "zero-paid"
    ? "zero-paid" as const : "not-observed" as const;

  const baselineMetrics = runMetrics(baseline, 0);
  const candidateMetrics = runMetrics(candidate, count(input.candidateCacheReuseTokens, "comparison.candidateCacheReuseTokens"));
  const avoided = (baselineMetrics.totalTokens as number) - (candidateMetrics.totalTokens as number);
  const baselineElapsed = baselineMetrics.elapsedMilliseconds as number;
  const candidateElapsed = candidateMetrics.elapsedMilliseconds as number;
  const perSecond = (tokens: number, ms: number): number => (ms > 0 ? Number(((tokens * 1000) / ms).toFixed(6)) : 0);
  const throughputDisposition: RegressionDisposition = baselineElapsed === 0 || candidateElapsed === 0
    ? "not-observed"
    : (candidateElapsed <= baselineElapsed ? "no-regression" : "regression");

  const correctnessDisposition: RegressionDisposition = sameOutputs ? "no-regression" : "regression";
  const authorityDisposition: RegressionDisposition = sameWorkload ? "no-regression" : "regression";
  const privacyDisposition: RegressionDisposition = "no-regression";
  const claimable = sameWorkload && sameOutputs && zeroPaid === "zero-paid" && avoided > 0
    && throughputDisposition === "no-regression"
    && baselineMetrics.acceptedOutputCount === candidateMetrics.acceptedOutputCount;

  return parseSemanticTokenComparison({
    schema: "urn:usf:semantic-token-comparison:1",
    version: 1,
    workloadDigest: candidate.workloadDigest,
    equivalenceDigest: canonicalDigest({
      workloadDigest: candidate.workloadDigest, profileDigest: candidate.profileDigest,
      semanticContextDigest: candidate.semanticContextDigest, acceptedOutputs: candidateOutputs,
    }, { rejectAbsolutePaths: true }),
    baselineRunDigest, candidateRunDigest,
    semanticCacheKeyDigest: input.semanticCacheKeyDigest,
    baselineMetrics, candidateMetrics,
    grossTokens: candidateMetrics.totalTokens,
    usefulTokens: candidateMetrics.usefulTokens,
    cachedTokens: candidateMetrics.semanticCacheReuseTokens,
    avoidedTokens: avoided,
    cacheReuse: (candidateMetrics.totalTokens as number) > 0
      ? Number(((candidateMetrics.semanticCacheReuseTokens as number) / (candidateMetrics.totalTokens as number)).toFixed(6)) : 0,
    yield: (candidateMetrics.totalTokens as number) > 0
      ? Number(((candidateMetrics.usefulTokens as number) / (candidateMetrics.totalTokens as number)).toFixed(6)) : 0,
    elapsedThroughput: {
      baselineElapsedMilliseconds: baselineElapsed,
      candidateElapsedMilliseconds: candidateElapsed,
      baselineTokensPerSecond: perSecond(baselineMetrics.totalTokens as number, baselineElapsed),
      candidateTokensPerSecond: perSecond(candidateMetrics.totalTokens as number, candidateElapsed),
    },
    correctnessDisposition, privacyDisposition, authorityDisposition, throughputDisposition,
    zeroPaidDisposition: zeroPaid,
    benefitDisposition: claimable ? "SEMANTIC_TOKEN_REDUCTION" : "NO_BENEFIT_CLAIM",
  });
}

// ---------------------------------------------------------------------------
// Registered command boundary.
//
// urn:usf:command:call-parallel:1 and urn:usf:command:call-compare:1 are
// registered with implementationState proofblocked and
// postQualificationAvailabilityTarget "implemented". The refusal is
// operation-wide: it is returned after argument and explicit semantic-scope
// validation but before any route, credential or provider-configuration lookup,
// so a syntactically valid route name can never become a hidden prerequisite for
// proving that no contact is authorized.
// ---------------------------------------------------------------------------

function requireScope(args: readonly string[], command: string): void {
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
  };
  const profile = value("--profile");
  const manifest = value("--manifest");
  const input = value("--input");
  if (profile === undefined || manifest === undefined || input === undefined
    || !profile.startsWith("urn:usf:profile:")) {
    throw new UsfError("PROVIDER_PARALLEL_ARGUMENTS_INVALID", exitCodes.INVALID_INPUT,
      `${command} requires an explicit --profile VERSIONED_IRI, --manifest PATH and --input PATH|-; authority scope never comes from the input payload.`);
  }
}

function proofblocked(command: string): never {
  throw new UsfError("PROVIDER_PARALLEL_PROOFBLOCKED", exitCodes.DOMAIN_FAILURE,
    `${command} remains proofblocked: the reusable runtime is implemented and fixture-validated, but live multi-provider dispatch requires separately current route qualification and run authorization. No provider was contacted.`);
}

export const callParallelCommandHandler: CommandHandler = ({ args }) => {
  requireScope(args, "usf call parallel");
  proofblocked("usf call parallel");
};

export const callCompareCommandHandler: CommandHandler = ({ args }) => {
  requireScope(args, "usf call compare");
  proofblocked("usf call compare");
};
