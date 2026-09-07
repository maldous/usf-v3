import { readFileSync } from "node:fs";
import { canonicalDigest, canonicalJson } from "../core/canonical.ts";
import { exitCodes, UsfError } from "../core/errors.ts";
import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";

const eventSchema = JSON.parse(readFileSync(new URL("../../schemas/job-lifecycle-metric-event-v2.schema.json", import.meta.url), "utf8")) as unknown;
const reportSchema = JSON.parse(readFileSync(new URL("../../schemas/job-lifecycle-metrics-report.schema.json", import.meta.url), "utf8")) as unknown;
function compileLocalSchema(schema: unknown): ValidateFunction<unknown> {
  const ajv = new Ajv2020({ allErrors: true, coerceTypes: false, logger: false, messages: false, ownProperties: true, removeAdditional: false, strictNumbers: true, strictRequired: false, strictSchema: true, strictTuples: true, strictTypes: true });
  ajv.addFormat("date-time", true);
  return ajv.compile(schema as AnySchema);
}

function validateLocal<T>(validator: ValidateFunction<unknown>, value: unknown): { readonly valid: true; readonly value: T } | { readonly valid: false } {
  return validator(value) ? { valid: true, value: value as T } : { valid: false };
}

const validateEventSchema = compileLocalSchema(eventSchema);
const validateReportSchema = compileLocalSchema(reportSchema);
const MAX = Number.MAX_SAFE_INTEGER;
const keyFields = ["jobIdentity", "workIdentity", "attemptIdentity", "phaseIdentity", "eventKind"] as const;

type Event = Record<string, unknown>;
export type LifecycleSource = Readonly<{ status: "observed" | "not-observed"; kind: "stdin" | "repository-relative-jsonl"; path: string | null; eventLimit: number; eventsRead: number; bytesRead: number; truncated: boolean; digest: string | null; digestBasis: "raw-input-bytes" | "not-observed" }>;

function refuse(code: string): never { throw new UsfError(code, exitCodes.INVALID_INPUT, "Lifecycle metrics input was refused."); }
function asString(value: unknown): string | null { return typeof value === "string" ? value : null; }
function nullableId(value: unknown): string | null { return value === null || typeof value === "string" ? value : null; }
function natural(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function canonicalEvent(event: Event): string { return canonicalJson(event); }
function identity(event: Event): string | null {
  const fields = ["jobIdentity", "workIdentity", "attemptIdentity", "phaseIdentity"] as const;
  const values: Record<string, unknown> = {};
  for (const field of fields) values[field] = event[field];
  return typeof event.attemptIdentity === "string" && typeof event.workIdentity === "string" && typeof event.logicalAttemptIdentity === "string" && typeof event.sourceIdentity === "string" ? canonicalDigest(values) : null;
}
function same(a: Event, b: Event, fields: readonly string[]): boolean { return fields.every((field) => a[field] === b[field]); }
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : sorted[middle - 1]! + (sorted[middle]! - sorted[middle - 1]!) / 2;
}
function pushHeap(heap: number[], value: number): void { heap.push(value); for (let index = heap.length - 1; index > 0;) { const parent = Math.floor((index - 1) / 2); if (heap[parent]! <= heap[index]!) break; [heap[parent], heap[index]] = [heap[index]!, heap[parent]!]; index = parent; } }
function popHeap(heap: number[]): number | undefined { const first = heap[0]; const last = heap.pop(); if (heap.length > 0 && last !== undefined) { heap[0] = last; for (let index = 0;;) { const left = index * 2 + 1; const right = left + 1; let next = index; if (left < heap.length && heap[left]! < heap[next]!) next = left; if (right < heap.length && heap[right]! < heap[next]!) next = right; if (next === index) break; [heap[index], heap[next]] = [heap[next]!, heap[index]!]; index = next; } } return first; }
function sourceState(source: LifecycleSource): LifecycleSource { return Object.freeze(source); }
function actualInstant(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value); if (!Number.isFinite(parsed)) return false;
  const canonical = new Date(parsed).toISOString();
  return canonical === (value.includes(".") ? value : `${value.slice(0, -1)}.000Z`);
}
function missing(value: unknown): boolean { return value === null; }
function validateFact(fact: unknown): void {
  if (fact === null) return;
  if (typeof fact !== "object" || Array.isArray(fact)) refuse("JOB_LIFECYCLE_FACT_INVALID");
  const row = fact as Record<string, unknown>; const values = Object.entries(row).filter(([key]) => !["sourceIdentity", "evidenceIdentity", "missingnessReason", "currency", "costClass", "evidenceKind"].includes(key)).map(([, value]) => value);
  const source = asString(row.sourceIdentity); const evidence = asString(row.evidenceIdentity); const reason = asString(row.missingnessReason);
  if (values.some((value) => !missing(value)) && (source === null || evidence === null)) refuse("JOB_LIFECYCLE_FACT_PROVENANCE_INVALID");
  if (values.every(missing) && (reason === null || reason.length === 0)) refuse("JOB_LIFECYCLE_FACT_MISSINGNESS_INVALID");
}

export interface LifecycleOptions { readonly source: LifecycleSource; readonly maxItems: number; }

/** Pure bounded reducer. It never treats claimed outcomes or schema validity as acceptance evidence. */
export function summarizeJobLifecycle(input: readonly unknown[], options: LifecycleOptions): Record<string, unknown> {
  if (input.length > 100_000) refuse("JOB_LIFECYCLE_INPUT_BOUND_EXCEEDED");
  const events: Event[] = [];
  const keys = new Map<string, string>();
  let duplicates = 0;
  for (const value of input) {
    const result = validateLocal<Record<string, unknown>>(validateEventSchema, value);
    if (!result.valid) refuse("JOB_LIFECYCLE_EVENT_INVALID");
    const event = result.value;
    if (!actualInstant(event.observedAt) || (event.startedAt !== null && !actualInstant(event.startedAt)) || (event.finishedAt !== null && !actualInstant(event.finishedAt))) refuse("JOB_LIFECYCLE_UTC_INVALID");
    if (event.eventKind !== "start" && (event.endOffsetNanoseconds === null || event.durationNanoseconds === null)) { const reason = asString(event.missingnessReason); if (reason === null || reason.length === 0) refuse("JOB_LIFECYCLE_MISSINGNESS_INVALID"); }
    validateFact(event.tokenFact); validateFact(event.cacheFact); validateFact(event.costFact);
    const expected = canonicalDigest(Object.fromEntries(keyFields.map((field) => [field, event[field]])));
    if (event.eventKey !== expected) refuse("JOB_LIFECYCLE_EVENT_KEY_INVALID");
    const serialized = canonicalEvent(event);
    const previous = keys.get(expected);
    if (previous !== undefined) { if (previous !== serialized) refuse("JOB_LIFECYCLE_EVENT_CONFLICT"); duplicates += 1; continue; }
    keys.set(expected, serialized); events.push(event);
  }
  const attempts = new Map<string, Event[]>(); const incompleteEvents: Event[] = []; const logicals = new Map<string, string>(); let incomplete = 0;
  for (const event of events) {
    const id = identity(event); if (id === null) { incomplete += 1; incompleteEvents.push(event); continue; }
    const logical = event.logicalAttemptIdentity as string; const prior = logicals.get(logical);
    if (prior !== undefined && prior !== id) refuse("JOB_LIFECYCLE_LOGICAL_ATTEMPT_CONFLICT");
    logicals.set(logical, id); const rows = attempts.get(id) ?? []; rows.push(event); attempts.set(id, rows);
  }
  const samples: Array<{ event: Event; duration: number }> = [];
  const intervals: Array<{ start: number; end: number; domain: string; attempt: string; parent: string | null; disposition: unknown }> = [];
  let paired = 0; let reportedFinishes = 0; let reportedFailures = 0; let reportedInterruptions = 0; let claimedAccepted = 0;
  for (const rows of attempts.values()) {
    const starts = rows.filter((row) => row.eventKind === "start"); const terminals = rows.filter((row) => row.eventKind !== "start");
    if (new Set(terminals.map((row) => row.eventKind)).size > 1) refuse("JOB_LIFECYCLE_TERMINAL_CONFLICT");
    if (starts.length !== 1 || terminals.length !== 1) { incomplete += 1; incompleteEvents.push(rows[0]!); continue; }
    const start = starts[0]!; const terminal = terminals[0]!;
    if (!same(start, terminal, ["clockDomainIdentity", "jobIdentity", "workIdentity", "attemptIdentity", "phaseIdentity", "sourceIdentity", "scopeIdentity", "toolIdentity", "routeIdentity", "semanticOwnerIdentity", "logicalAttemptIdentity"])) refuse("JOB_LIFECYCLE_ATTEMPT_CONFLICT");
    const begin = natural(start.startOffsetNanoseconds); const terminalStart = natural(terminal.startOffsetNanoseconds); const end = natural(terminal.endOffsetNanoseconds); const duration = natural(terminal.durationNanoseconds);
    if (begin === null || terminalStart === null || end === null || duration === null) { incomplete += 1; incompleteEvents.push(terminal); continue; }
    if (terminalStart !== begin || end < begin || end - begin !== duration || duration > MAX) refuse("JOB_LIFECYCLE_DURATION_INVALID");
    const total = natural((terminal.intervals as Record<string, unknown>).total);
    if (total !== null && total !== duration) refuse("JOB_LIFECYCLE_INTERVAL_INVALID");
    for (const value of Object.values(terminal.intervals as Record<string, unknown>)) { const interval = natural(value); if (interval !== null && interval > duration) refuse("JOB_LIFECYCLE_INTERVAL_INVALID"); }
    paired += 1; samples.push({ event: terminal, duration });
    intervals.push({ start: begin, end, domain: asString(terminal.clockDomainIdentity) ?? "", attempt: asString(terminal.attemptIdentity) ?? "", parent: nullableId(terminal.parentAttemptIdentity), disposition: terminal.overlapDisposition });
    if (terminal.eventKind === "finish") reportedFinishes += 1;
    if (terminal.eventKind === "failure") reportedFailures += 1;
    if (terminal.eventKind === "interrupted") reportedInterruptions += 1;
    if (terminal.acceptedOutcome === true) claimedAccepted += 1;
  }
  let overlapPairs = 0;
  const byDomain = new Map<string, typeof intervals>();
  for (const interval of intervals) { const rows = byDomain.get(interval.domain) ?? []; rows.push(interval); byDomain.set(interval.domain, rows); }
  for (const rows of byDomain.values()) {
    const active: number[] = [];
    for (const row of rows.sort((a, b) => a.start - b.start || a.end - b.end)) {
      while (active[0] !== undefined && active[0]! <= row.start) popHeap(active);
      if (row.end > row.start) { overlapPairs += active.length; pushHeap(active, row.end); }
    }
  }
  const parentByAttempt = new Map(intervals.map((row) => [row.attempt, row.parent]));
  for (const row of intervals) if (row.parent !== null && !parentByAttempt.has(row.parent)) incomplete += 1;
  const colour = new Map<string, 0 | 1 | 2>();
  for (const root of parentByAttempt.keys()) {
    if ((colour.get(root) ?? 0) === 2) continue;
    const stack: Array<{ attempt: string; leave: boolean }> = [{ attempt: root, leave: false }];
    while (stack.length > 0) {
      const frame = stack.pop()!; const state = colour.get(frame.attempt) ?? 0;
      if (frame.leave) { colour.set(frame.attempt, 2); continue; }
      if (state === 1) refuse("JOB_LIFECYCLE_PARENT_CYCLE"); if (state === 2) continue;
      colour.set(frame.attempt, 1); stack.push({ attempt: frame.attempt, leave: true });
      const parent = parentByAttempt.get(frame.attempt);
      if (parent !== null && parent !== undefined && parentByAttempt.has(parent)) stack.push({ attempt: parent, leave: false });
    }
  }
  const intervalByAttempt = new Map(intervals.map((row) => [row.attempt, row]));
  for (const row of intervals) if (row.parent !== null && parentByAttempt.has(row.parent)) {
    const parent = intervalByAttempt.get(row.parent)!;
    if (row.disposition !== "nonadditive-parent-child" || row.domain !== parent.domain || row.start >= parent.end || parent.start >= row.end) refuse("JOB_LIFECYCLE_PARENT_DISPOSITION_INVALID");
  }
  const groups = new Map<string, { exemplar: Event; durations: number[]; attempts: number; finishes: number; failures: number; interruptions: number; claimed: number; unknown: number }>();
  const addGroup = (event: Event, duration: number | null) => {
    const values = [event.jobType, event.phaseIdentity, event.sourceIdentity, event.scopeIdentity, event.toolIdentity, event.routeIdentity] as const;
    const key = JSON.stringify(values); const row = groups.get(key) ?? { exemplar: event, durations: [], attempts: 0, finishes: 0, failures: 0, interruptions: 0, claimed: 0, unknown: 0 };
    row.attempts += 1; if (duration === null) row.unknown += 1; else row.durations.push(duration);
    row.finishes += event.eventKind === "finish" ? 1 : 0; row.failures += event.eventKind === "failure" ? 1 : 0; row.interruptions += event.eventKind === "interrupted" ? 1 : 0; row.claimed += event.acceptedOutcome === true ? 1 : 0; groups.set(key, row);
  };
  for (const { event, duration } of samples) addGroup(event, duration);
  for (const event of incompleteEvents) addGroup(event, null);
  const ordered = [...groups.values()].sort((a,b) => JSON.stringify([a.exemplar.jobType,a.exemplar.phaseIdentity,a.exemplar.sourceIdentity,a.exemplar.scopeIdentity,a.exemplar.toolIdentity,a.exemplar.routeIdentity]).localeCompare(JSON.stringify([b.exemplar.jobType,b.exemplar.phaseIdentity,b.exemplar.sourceIdentity,b.exemplar.scopeIdentity,b.exemplar.toolIdentity,b.exemplar.routeIdentity])));
  const omitted = Math.max(0, ordered.length - options.maxItems);
  const items = ordered.slice(0, options.maxItems).map((row) => {
    const sorted = [...row.durations].sort((a,b) => a-b); const min = sorted[0] ?? null; const max = sorted.at(-1) ?? null;
    return Object.freeze({ jobType: row.exemplar.jobType, phaseIdentity: nullableId(row.exemplar.phaseIdentity), sourceIdentity: nullableId(row.exemplar.sourceIdentity), scopeIdentity: nullableId(row.exemplar.scopeIdentity), toolIdentity: nullableId(row.exemplar.toolIdentity), routeIdentity: nullableId(row.exemplar.routeIdentity), attempts: row.attempts, reportedFinishes: row.finishes, reportedFailures: row.failures, reportedInterruptions: row.interruptions, claimedAccepted: row.claimed, acceptedOutcome: null, duration: Object.freeze({ samples: sorted.length, unknown: row.unknown, minNanoseconds: min, maxNanoseconds: max, medianNanoseconds: median(sorted) }) });
  });
  const report = Object.freeze({ schema: "urn:usf:job-lifecycle-metrics-report:2", status: events.length === 0 ? "not-observed" : incomplete > 0 || options.source.truncated || omitted > 0 ? "incomplete" : "ok", view: "summary", acceptanceStatus: "unverified", acceptedOutcome: null, coverage: Object.freeze({ inputRecords: input.length, validRecords: events.length, duplicateRecords: duplicates, refusedRecords: 0, incompleteAttempts: incomplete, pairedAttempts: paired, overlapPairs, incomparableClockDomains: byDomain.size > 1 ? byDomain.size - 1 : 0, omittedGroups: omitted, sourceTruncated: options.source.truncated }), source: sourceState(options.source), refusals: Object.freeze([]), items: Object.freeze(items), nonclaims: Object.freeze(["Claimed outcomes are unverified and are not authenticated acceptance.", "Durations use only paired monotonic offsets in one clock domain."]) });
  if (!validateLocal<Record<string, unknown>>(validateReportSchema, report).valid) refuse("JOB_LIFECYCLE_REPORT_INVALID");
  return report;
}
