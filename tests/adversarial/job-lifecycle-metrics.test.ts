import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalDigest } from "../../src/core/canonical.ts";
import { UsfError } from "../../src/core/errors.ts";
import { metricsCommandHandler } from "../../src/commands/metrics.ts";
import { summarizeJobLifecycle } from "../../src/observability/job-lifecycle.ts";

const ids = ["jobIdentity", "workIdentity", "attemptIdentity", "phaseIdentity", "eventKind"] as const;
function event(kind: "start" | "finish" | "failure" | "interrupted", attempt: string, patch: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = { schema: "urn:usf:job-lifecycle-metric-event:2", eventKind: kind, jobIdentity: "job", jobType: "test", issueIdentity: "USF-1176", workIdentity: "work", semanticOwnerIdentity: "owner", attemptIdentity: attempt, logicalAttemptIdentity: `logical-${attempt}`, phaseIdentity: "test", sourceIdentity: "source", evidenceIdentity: null, contributionDigest: null, observedAt: "2026-09-06T00:00:00Z", clockIdentity: "monotonic-plus-utc-observation", durationUnit: "nanoseconds", startOffsetNanoseconds: kind === "start" ? 10 : 10, endOffsetNanoseconds: kind === "start" ? null : 20, durationNanoseconds: kind === "start" ? null : 10, parentAttemptIdentity: null, overlapDisposition: "none", scopeIdentity: "scope", toolIdentity: "tool", routeIdentity: "route", intervals: { queue: null, modelActive: null, command: null, validation: null, integration: null, total: kind === "start" ? null : 10 }, outcomeLineage: kind === "finish" ? null : kind === "failure" ? "failed" : kind === "interrupted" ? "interrupted" : null, acceptedOutcome: kind === "start" || kind === "finish" ? null : false, missingnessReason: null, tokenFact: null, cacheFact: null, costFact: null, clockDomainIdentity: "boot-1", startedAt: kind === "start" ? "2026-09-06T00:00:03Z" : null, finishedAt: kind === "start" ? null : "2026-09-06T00:00:01Z", ...patch };
  base.eventKey = canonicalDigest(Object.fromEntries(ids.map((id) => [id, base[id]])));
  return base;
}
async function fixture(rows: readonly unknown[]) { const root = await mkdtemp(join(tmpdir(), "usf-lifecycle-")); await chmod(root, 0o700); await mkdir(join(root, ".usf", "metrics"), { recursive: true, mode: 0o700 }); await chmod(join(root,".usf"),0o700); await chmod(join(root,".usf","metrics"),0o700); const path = join(root, ".usf", "metrics", "lifecycle.jsonl"); await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 }); return { root, path }; }
async function run(rows: readonly unknown[], args: readonly string[] = ["summary", "--input", ".usf/metrics/lifecycle.jsonl"]) { const f = await fixture(rows); try { return await metricsCommandHandler({ command: "metrics", args, repositoryRoot: f.root }); } finally { await rm(f.root, { recursive: true, force: true }); } }

test("explicit v2 summary is order independent, deduplicates replay, and never authenticates acceptance", async () => {
  const start = event("start", "a"); const finish = event("finish", "a", { acceptedOutcome: true, outcomeLineage: "accepted-review", evidenceIdentity: "evidence", contributionDigest: "sha256:" + "a".repeat(64) });
  const result = await run([finish, start, start]); const output = result.output as Record<string, any>;
  assert.equal(output.schema, "urn:usf:job-lifecycle-metrics-report:2"); assert.equal(output.acceptedOutcome, null); assert.equal(output.acceptanceStatus, "unverified"); assert.equal(output.coverage.duplicateRecords, 1); assert.equal(output.coverage.pairedAttempts, 1); assert.equal(output.items[0].claimedAccepted, 1); assert.equal(output.items[0].duration.medianNanoseconds, 10);
});
test("conflicting replay, cross-domain pairs, invalid arithmetic, and v2 filters refuse", async () => {
  const start = event("start", "a"); const changed = event("start", "a", { sourceIdentity: "other" }); changed.eventKey = start.eventKey;
  await assert.rejects(() => run([start, changed]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_EVENT_CONFLICT");
  await assert.rejects(() => run([start, event("finish", "a", { clockDomainIdentity: "boot-2" })]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_ATTEMPT_CONFLICT");
  await assert.rejects(() => run([start, event("finish", "a", { durationNanoseconds: 9 })]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_DURATION_INVALID");
  await assert.rejects(() => run([start], ["summary", "--input", ".usf/metrics/lifecycle.jsonl", "--run", "x"]), (error: unknown) => error instanceof UsfError && error.code === "METRICS_ARGUMENTS_INVALID");
});
test("many same-domain intervals remain bounded and endpoint touching is not falsely paired", async () => {
  const rows: unknown[] = []; for (let index = 0; index < 500; index += 1) { const attempt = `a${index}`; rows.push(event("start", attempt, { startOffsetNanoseconds: index })); rows.push(event("finish", attempt, { startOffsetNanoseconds: index, endOffsetNanoseconds: index + 1, durationNanoseconds: 1, intervals: { queue:null,modelActive:null,command:null,validation:null,integration:null,total:1 } })); }
  const output = (await run(rows)).output as Record<string, any>; assert.equal(output.coverage.pairedAttempts, 500); assert.equal(output.coverage.overlapPairs, 0);
});
test("v1 default remains v1", async () => { const f = await fixture([]); try { const result = await metricsCommandHandler({ command:"metrics",args:[],repositoryRoot:f.root }); assert.equal((result.output as Record<string,unknown>).schema,"urn:usf:metrics-report:1"); } finally { await rm(f.root,{recursive:true,force:true}); } });
function rekey(row: Record<string, unknown>) { row.eventKey = canonicalDigest(Object.fromEntries(ids.map((id) => [id, row[id]]))); return row; }

test("null identities, terminal conflict, logical reuse, UTC and provenance invariants refuse or remain explicitly incomplete", async () => {
  const nullLogical = event("start", "a", { logicalAttemptIdentity: null });
  const incomplete = (await run([nullLogical])).output as Record<string, any>;
  assert.equal(incomplete.status, "incomplete"); assert.equal(incomplete.items[0].duration.unknown, 1);
  await assert.rejects(() => run([event("start", "a"), event("finish", "a"), event("failure", "a")]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_TERMINAL_CONFLICT");
  const a = event("start", "a"); const b = event("start", "b", { logicalAttemptIdentity: "logical-a" });
  await assert.rejects(() => run([a, b]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_LOGICAL_ATTEMPT_CONFLICT");
  await assert.rejects(() => run([event("start", "a", { observedAt: "not-a-time" })]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_UTC_INVALID");
  await assert.rejects(() => run([event("start", "a", { tokenFact: { sourceIdentity: null, evidenceIdentity: null, missingnessReason: null, inputTokens: 1, outputTokens: null, providerCachedTokens: null, semanticCacheHit: null } })]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_FACT_PROVENANCE_INVALID");
});
test("cycles, parent disposition, genuine overlaps and zero-duration containment are handled safely", async () => {
  const aStart = event("start", "a", { startOffsetNanoseconds: 0 }); const aEnd = event("finish", "a", { startOffsetNanoseconds: 0, endOffsetNanoseconds: 10, durationNanoseconds: 10, intervals:{queue:null,modelActive:null,command:null,validation:null,integration:null,total:10} });
  const bStart = event("start", "b", { startOffsetNanoseconds: 2 }); const bEnd = event("finish", "b", { startOffsetNanoseconds: 2, endOffsetNanoseconds: 8, durationNanoseconds: 6, parentAttemptIdentity:"a", overlapDisposition:"nonadditive-parent-child", intervals:{queue:null,modelActive:null,command:null,validation:null,integration:null,total:6} });
  const output = (await run([aStart,aEnd,bStart,bEnd])).output as Record<string,any>; assert.equal(output.coverage.overlapPairs,1);
  const zeroStart = event("start", "z", { startOffsetNanoseconds: 5 }); const zeroEnd = event("finish", "z", { startOffsetNanoseconds:5,endOffsetNanoseconds:5,durationNanoseconds:0,intervals:{queue:null,modelActive:null,command:null,validation:null,integration:null,total:0} });
  const zero = (await run([aStart,aEnd,zeroStart,zeroEnd])).output as Record<string,any>; assert.equal(zero.coverage.overlapPairs,0);
  const cStart = event("start", "c"); const cEnd = event("finish", "c", { parentAttemptIdentity:"d", overlapDisposition:"nonadditive-parent-child" }); const dStart = event("start", "d"); const dEnd = event("finish", "d", { parentAttemptIdentity:"c", overlapDisposition:"nonadditive-parent-child" });
  await assert.rejects(() => run([cStart,cEnd,dStart,dEnd]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_PARENT_CYCLE");
  await assert.rejects(() => run([aStart,aEnd,event("start","b",{startOffsetNanoseconds:2}),event("finish","b",{startOffsetNanoseconds:2,endOffsetNanoseconds:8,durationNanoseconds:6,parentAttemptIdentity:"a",intervals:{queue:null,modelActive:null,command:null,validation:null,integration:null,total:6}})]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_PARENT_DISPOSITION_INVALID");
});
test("mixed v1 input and unsupported lifecycle views refuse", async () => {
  await assert.rejects(() => run([event("start", "a"), { schema:"urn:usf:metric-event:1" }]), (error: unknown) => error instanceof UsfError && error.code === "METRICS_ARGUMENTS_INVALID");
  await assert.rejects(() => run([event("start", "a")], ["providers", "--input", ".usf/metrics/lifecycle.jsonl"]), (error: unknown) => error instanceof UsfError && error.code === "METRICS_ARGUMENTS_INVALID");
});
test("bounded input truncation is explicit and the heap sweep counts many overlaps without materializing pairs", async () => {
  const truncated = (await run([event("start", "a"), event("start", "b")], ["summary", "--input", ".usf/metrics/lifecycle.jsonl", "--max-events", "1"])).output as Record<string, any>;
  assert.equal(truncated.status, "incomplete"); assert.equal(truncated.coverage.sourceTruncated, true); assert.equal(truncated.source.truncated, true);
  const rows: unknown[] = []; for (let index = 0; index < 250; index += 1) { const attempt = `overlap-${index}`; rows.push(event("start", attempt, { startOffsetNanoseconds: 0 })); rows.push(event("finish", attempt, { startOffsetNanoseconds: 0, endOffsetNanoseconds: 10, durationNanoseconds: 10, intervals:{queue:null,modelActive:null,command:null,validation:null,integration:null,total:10} })); }
  const output = (await run(rows)).output as Record<string,any>; assert.equal(output.coverage.overlapPairs, 31125);
});
test("calendar-valid UTC rejects impossible dates and preserves leap-day observations", async () => {
  await assert.rejects(() => run([event("start", "bad-date", { observedAt: "2026-02-30T00:00:00Z" })]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_UTC_INVALID");
  await assert.rejects(() => run([event("start", "non-leap", { observedAt: "2025-02-29T00:00:00Z" })]), (error: unknown) => error instanceof UsfError && error.code === "JOB_LIFECYCLE_UTC_INVALID");
  const leap = (await run([event("start", "leap", { observedAt: "2024-02-29T00:00:00Z" })])).output as Record<string, unknown>;
  assert.equal(leap.status, "incomplete");
});
test("long acyclic parent chains remain bounded", async () => {
  const rows: unknown[] = []; for (let index = 0; index < 500; index += 1) { const attempt = `chain-${index}`; rows.push(event("start", attempt, { startOffsetNanoseconds: index })); rows.push(event("finish", attempt, { startOffsetNanoseconds:index, endOffsetNanoseconds:index + 2, durationNanoseconds:2, parentAttemptIdentity:index === 0 ? null : `chain-${index - 1}`, overlapDisposition:index === 0 ? "none" : "nonadditive-parent-child", intervals:{queue:null,modelActive:null,command:null,validation:null,integration:null,total:2} })); }
  const output = (await run(rows)).output as Record<string, any>; assert.equal(output.coverage.pairedAttempts, 500);
});

test("iterative parent traversal handles the 100000-record pure-reducer ceiling without stack recursion", () => {
  const rows: unknown[] = []; for (let index = 0; index < 50_000; index += 1) { const attempt = `long-${index}`; rows.push(event("start", attempt, { startOffsetNanoseconds:index })); rows.push(event("finish", attempt, { startOffsetNanoseconds:index, endOffsetNanoseconds:index + 2, durationNanoseconds:2, parentAttemptIdentity:index === 0 ? null : `long-${index - 1}`, overlapDisposition:index === 0 ? "none" : "nonadditive-parent-child", intervals:{queue:null,modelActive:null,command:null,validation:null,integration:null,total:2} })); }
  const report = summarizeJobLifecycle(rows, { maxItems: 1, source: { status:"observed",kind:"stdin",path:null,eventLimit:100000,eventsRead:100000,bytesRead:0,truncated:false,digest:"sha256:" + "0".repeat(64),digestBasis:"raw-input-bytes" } }) as Record<string, any>;
  assert.equal(report.coverage.pairedAttempts, 50_000); assert.equal(report.coverage.overlapPairs, 49_999);
});
