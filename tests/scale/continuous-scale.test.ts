import test from "node:test";
import assert from "node:assert/strict";
import { createFakeProvider, runContinuous, type Route, type WorkPacket } from "../../src/continuous/index.ts";

const routes: Route[] = Array.from({ length: 64 }, (_, index) => ({
  id: `route-${String(index).padStart(2, "0")}`,
  provider: `provider-${String(index % 8).padStart(2, "0")}`,
  concurrency: 1,
  providerConcurrency: 4,
}));
const packets: WorkPacket[] = Array.from({ length: 256 }, (_, index) => ({
  id: `packet-${String(index).padStart(3, "0")}`,
  routes: routes.map((route) => route.id),
  cacheKey: `packet:${index}`,
  value: 1,
}));

test("deterministic scale harness accounts ten million tokens with fair bounded fanout", () => {
  const hostCap = Math.min(32, Number(process.env.USF_TEST_HOST_CAP ?? 32));
  const result = runContinuous({ packets, routes, hostConcurrency: hostCap, invoke: createFakeProvider({ inputTokens: 20_000, outputTokens: 20_000 }) });
  assert.equal(result.metrics.totalTokens, 10_240_000);
  assert.equal(result.metrics.usefulTokens, 10_240_000);
  assert.equal(result.metrics.targetConcurrency, hostCap);
  assert.equal(result.metrics.observedConcurrency, hostCap);
  assert.equal(result.metrics.accepted, 256);
  assert.equal(result.metrics.failed, 0);
  assert.equal(result.metrics.cacheReuses, 0);
  assert.ok(result.metrics.utilisation >= 0.9);
  assert.equal(Object.keys(result.metrics.providerStarts).length, 8);
  const starts = Object.values(result.metrics.providerStarts);
  assert.ok(Math.max(...starts) - Math.min(...starts) <= 1);
  assert.ok(result.metrics.batches >= 3, "continuous composition advances successive ready batches");
  assert.ok(result.integrations.length >= 3);
});

test("fixed-latency virtual work has stable k=1/2/4/8 speedup", () => {
  const elapsed = (workers: number) => runContinuous({ packets: packets.slice(0, 128), routes, hostConcurrency: workers, invoke: createFakeProvider({ durationMs: 10, inputTokens: 1, outputTokens: 1 }) }).metrics.elapsedMs;
  const base = elapsed(1);
  for (const workers of [1, 2, 4, 8]) assert.ok(base / elapsed(workers) >= 0.60 * workers, `speedup(${workers})`);
});

// ---------------------------------------------------------------------------
// provider-parallel-execution: the reusable no-contact parallel runtime,
// useful-overlap accounting and immutable baseline/candidate comparison.
//
// Overlap is never asserted from configuration or nominal concurrency: every
// case below launches real asynchronous work and the record recomputes overlap
// from the observed timestamps, so a claim the intervals do not support refuses.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalDigest } from "../../src/core/canonical.ts";
import {
  assembleParallelProviderRun,
  callCompareCommandHandler,
  callParallelCommandHandler,
  deriveSemanticTokenComparison,
  dispatchParallel,
  parallelProviderRunDigest,
  parseParallelProviderRun,
  parseSemanticTokenComparison,
  usefulOverlapMilliseconds,
  type ParallelDispatchCandidate,
  type ParallelProviderRun,
} from "../../src/commands/provider-parallel.ts";

const d = (seed: string) => canonicalDigest({ seed }, { rejectAbsolutePaths: true });
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function candidate(
  name: string,
  family: string,
  provider: string,
  behaviour: { readonly workMs: number; readonly outcome?: "accepted" | "rejected"; readonly throws?: boolean; readonly tokens?: number },
): ParallelDispatchCandidate {
  return {
    candidateMemberDigest: d(`candidate:${name}`),
    routeMemberDigest: d(`route:${name}`),
    routeQualificationDigest: d(`qualification:${name}`),
    runAuthorizationDigest: d(`authorization:${name}`),
    requestedIdentity: { family, provider, model: `${family}-model` },
    actualIdentity: { family, provider, model: `${family}-model`, sdkProvider: `${provider}.chat` },
    admitted: true,
    launch: async () => {
      // Useful work is measured around the awaited region, not around
      // preparation, so a serial caller cannot inflate it.
      const usefulStartedAtMs = Date.now();
      await sleep(behaviour.workMs);
      const usefulEndedAtMs = Date.now();
      if (behaviour.throws === true) throw new Error("INJECTED_ROUTE_FAILURE");
      const outcome = behaviour.outcome ?? "accepted";
      const tokens = behaviour.tokens ?? 10;
      return {
        outcome,
        usage: { inputTokens: tokens, outputTokens: tokens },
        usefulStartedAtMs: outcome === "accepted" ? usefulStartedAtMs : null,
        usefulEndedAtMs: outcome === "accepted" ? usefulEndedAtMs : null,
        acceptedOutputDigest: outcome === "accepted" ? d(`output:${name}`) : null,
      };
    },
  };
}

const assemble = (observation: Awaited<ReturnType<typeof dispatchParallel>>, eligible: number): ParallelProviderRun =>
  assembleParallelProviderRun({
    workloadDigest: d("workload"),
    profileDigest: d("profile"),
    semanticContextDigest: d("semantic-context"),
    eligibilitySnapshotDigest: d("eligibility-snapshot"),
    eligibleCandidateCount: eligible,
    hostConcurrencyCap: 8,
    providerConcurrencyCap: 4,
    costClass: "local",
    zeroPaidDisposition: "zero-paid",
    observation,
  });

test("two provider families genuinely overlap useful work under bounded concurrency", async () => {
  const candidates = [
    candidate("groq-a", "qwen", "groq", { workMs: 80 }),
    candidate("cerebras-a", "gpt-oss", "cerebras", { workMs: 80 }),
  ];
  const observation = await dispatchParallel({
    candidates, hostConcurrencyCap: 8, providerConcurrencyCap: 4, now: () => Date.now(),
  });
  const run = assemble(observation, 2);

  // Dispatch independence: both launches preceded the first settlement.
  assert.equal(run.concurrencyMetrics.launchedBeforeFirstSettlement, 2);
  assert.equal(run.concurrencyMetrics.observedConcurrency, 2);
  assert.equal(run.concurrencyMetrics.dispatchSerialised, false);
  assert.equal(run.routeFamilyCount, 2);
  // Real overlap, recomputed from the observed intervals rather than declared.
  assert.ok(run.usefulOverlapMilliseconds > 0, "useful work genuinely overlapped");
  assert.equal(run.usefulOverlapMilliseconds, usefulOverlapMilliseconds(run.routeRuns));
  // Wall clock is close to one unit of work, not two, because they truly ran together.
  const elapsed = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  assert.ok(elapsed < 160, `elapsed ${elapsed}ms is below the serial sum`);
  assert.equal(run.tokenMetrics.usefulTokens, 40);
  assert.equal(run.acceptedOutputs.length, 2);
  assert.equal(run.failures.length, 0);
});

test("serial execution and single-family repetition both yield zero overlap", async () => {
  // Awaiting each launch in turn produces disjoint useful intervals.
  const serial = [candidate("s1", "qwen", "groq", { workMs: 30 }), candidate("s2", "gpt-oss", "cerebras", { workMs: 30 })];
  const serialRuns = [];
  for (const entry of serial) {
    const observation = await dispatchParallel({
      candidates: [entry], hostConcurrencyCap: 1, providerConcurrencyCap: 1, now: () => Date.now(),
    });
    serialRuns.push(...observation.routeRuns);
  }
  assert.equal(usefulOverlapMilliseconds(serialRuns), 0, "disjoint intervals cannot overlap");

  // Two concurrent routes inside one family overlap in time but are not two
  // independently qualified families, so overlap stays zero by definition.
  const sameFamily = await dispatchParallel({
    candidates: [
      candidate("f1", "qwen", "groq", { workMs: 60 }),
      candidate("f2", "qwen", "groq", { workMs: 60 }),
    ],
    hostConcurrencyCap: 8, providerConcurrencyCap: 4, now: () => Date.now(),
  });
  assert.equal(sameFamily.launchedBeforeFirstSettlement, 2, "they did run concurrently");
  assert.equal(usefulOverlapMilliseconds(sameFamily.routeRuns), 0, "one family is not two families");
  assert.equal(assemble(sameFamily, 2).usefulOverlapMilliseconds, 0);
});

test("failure isolation keeps sibling routes accepted and dispositions explicit", async () => {
  const candidates = [
    candidate("ok-a", "qwen", "groq", { workMs: 20 }),
    candidate("boom", "gpt-oss", "cerebras", { workMs: 20, throws: true }),
    candidate("reject", "llama", "groq", { workMs: 20, outcome: "rejected" }),
    { ...candidate("excluded", "mistral", "groq", { workMs: 1 }), admitted: false, exclusionReasonCodes: ["PARALLEL_CANDIDATE_QUOTA_EXHAUSTED"] },
  ];
  const observation = await dispatchParallel({
    candidates, hostConcurrencyCap: 8, providerConcurrencyCap: 4, now: () => Date.now(),
  });
  const run = assemble(observation, 4);
  assert.equal(run.routeRuns.length, 3, "the excluded candidate never launched");
  assert.equal(run.acceptedOutputs.length, 1);
  assert.equal(run.failures.length, 2, "the thrown and the rejected route both keep a failure row");
  assert.equal(run.excludedCandidates.length, 1);
  assert.deepEqual(run.excludedCandidates[0]!.reasonCodes, ["PARALLEL_CANDIDATE_QUOTA_EXHAUSTED"]);
  assert.equal(run.usefulOverlapMilliseconds, 0, "only one route was accepted");
  // A non-accepted run carries no useful interval and no accepted output.
  for (const entry of run.routeRuns.filter((r) => r.outcome !== "accepted")) {
    assert.equal(entry.usefulStartedAt, null);
    assert.equal(entry.acceptedOutputDigest, null);
  }
});

test("bounded concurrency respects the host and per-provider caps", async () => {
  const candidates = Array.from({ length: 6 }, (_, index) =>
    candidate(`b${index}`, `family-${index % 3}`, `provider-${index % 2}`, { workMs: 25 }));
  const observation = await dispatchParallel({
    candidates, hostConcurrencyCap: 3, providerConcurrencyCap: 1, now: () => Date.now(),
  });
  assert.equal(observation.targetConcurrency, 3);
  assert.ok(observation.observedConcurrency <= 3, "host cap holds");
  // Only one route per provider may be in flight, and there are two providers.
  assert.ok(observation.observedConcurrency <= 2, `per-provider cap holds, observed ${observation.observedConcurrency}`);
  assert.equal(observation.routeRuns.length, 6, "every admitted candidate still ran");
});

test("the run record is closed, derived and refuses unsupported claims", async () => {
  const observation = await dispatchParallel({
    candidates: [candidate("c1", "qwen", "groq", { workMs: 40 }), candidate("c2", "gpt-oss", "cerebras", { workMs: 40 })],
    hostConcurrencyCap: 8, providerConcurrencyCap: 4, now: () => Date.now(),
  });
  const run = assemble(observation, 2);
  const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../schemas/parallel-provider-run.schema.json", import.meta.url)), "utf8")) as {
    required: readonly string[]; $defs: { routeRun: { required: readonly string[] } };
  };
  assert.deepEqual([...schema.required].sort(), Object.keys(run).sort());
  assert.deepEqual([...schema.$defs.routeRun.required].sort(), Object.keys(run.routeRuns[0]!).sort());
  assert.deepEqual(parseParallelProviderRun(run), run);
  assert.equal(parallelProviderRunDigest(run), parallelProviderRunDigest(structuredClone(run)));

  for (const field of schema.required) {
    const { [field]: removed, ...incomplete } = run as unknown as Record<string, unknown>;
    assert.throws(() => parseParallelProviderRun(incomplete), /PARALLEL_RUN_RECORD_INVALID/u, field);
  }
  const planted: readonly (readonly [string, unknown])[] = [
    ["unknown member", { ...run, extra: true }],
    ["overlap the intervals do not support", { ...run, usefulOverlapMilliseconds: run.usefulOverlapMilliseconds + 5 }],
    ["family count that is not observed", { ...run, routeFamilyCount: 7 }],
    ["token totals that are not observed", { ...run, tokenMetrics: { ...run.tokenMetrics, inputTokens: 999, totalTokens: 999 + run.tokenMetrics.outputTokens } }],
    ["a serialised dispatch claiming otherwise", { ...run, concurrencyMetrics: { ...run.concurrencyMetrics, dispatchSerialised: true } }],
    ["launches exceeding observed concurrency", { ...run, concurrencyMetrics: { ...run.concurrencyMetrics, launchedBeforeFirstSettlement: 99 } }],
    ["eligible count below the run count", { ...run, eligibleCandidateCount: 1 }],
    ["a nonzero observed cost", { ...run, costMetrics: { ...run.costMetrics, observedCostUsd: "1" } }],
  ];
  for (const [label, value] of planted) {
    assert.throws(() => parseParallelProviderRun(value), /PARALLEL_RUN_RECORD_INVALID/u, label);
  }
});

test("the candidate comparison binds an immutable baseline and refuses unsupported benefit", async () => {
  const baselineObservation = await dispatchParallel({
    candidates: [candidate("base-a", "qwen", "groq", { workMs: 40, tokens: 40 }), candidate("base-b", "gpt-oss", "cerebras", { workMs: 40, tokens: 40 })],
    hostConcurrencyCap: 8, providerConcurrencyCap: 4, now: () => Date.now(),
  });
  const baseline = assemble(baselineObservation, 2);
  const frozenBaselineDigest = parallelProviderRunDigest(baseline);

  const candidateObservation = await dispatchParallel({
    candidates: [candidate("base-a", "qwen", "groq", { workMs: 10, tokens: 10 }), candidate("base-b", "gpt-oss", "cerebras", { workMs: 10, tokens: 10 })],
    hostConcurrencyCap: 8, providerConcurrencyCap: 4, now: () => Date.now(),
  });
  const candidateRun = assemble(candidateObservation, 2);

  const comparison = deriveSemanticTokenComparison({
    baseline, candidate: candidateRun, semanticCacheKeyDigest: d("cache-key"), candidateCacheReuseTokens: 20,
  });
  // The baseline object was only read: its digest is unchanged after derivation.
  assert.equal(parallelProviderRunDigest(baseline), frozenBaselineDigest);
  assert.equal(comparison.baselineRunDigest, frozenBaselineDigest);
  assert.equal(comparison.avoidedTokens, 120, "160 baseline tokens against 40 candidate tokens");
  assert.equal(comparison.benefitDisposition, "SEMANTIC_TOKEN_REDUCTION");
  assert.deepEqual(parseSemanticTokenComparison(comparison), comparison);

  const comparisonSchema = JSON.parse(readFileSync(fileURLToPath(new URL("../../schemas/semantic-token-comparison.schema.json", import.meta.url)), "utf8")) as { required: readonly string[] };
  assert.deepEqual([...comparisonSchema.required].sort(), Object.keys(comparison).sort());

  // A candidate whose workload differs is not equivalent, so no benefit is claimed.
  const differentWorkload = parseParallelProviderRun({ ...candidateRun, workloadDigest: d("other-workload") });
  const refused = deriveSemanticTokenComparison({
    baseline, candidate: differentWorkload, semanticCacheKeyDigest: d("cache-key"), candidateCacheReuseTokens: 0,
  });
  assert.equal(refused.authorityDisposition, "regression");
  assert.equal(refused.benefitDisposition, "NO_BENEFIT_CLAIM");

  // A hand-written record cannot promote itself to a reduction claim.
  assert.throws(
    () => parseSemanticTokenComparison({ ...refused, benefitDisposition: "SEMANTIC_TOKEN_REDUCTION" }),
    /PARALLEL_RUN_RECORD_INVALID/u,
  );
  // Comparing a run with itself refuses rather than reporting a free win.
  assert.throws(() => deriveSemanticTokenComparison({
    baseline, candidate: baseline, semanticCacheKeyDigest: d("cache-key"), candidateCacheReuseTokens: 0,
  }), /PARALLEL_RUN_RECORD_INVALID/u);
});

test("both registered parallel commands refuse operation-wide before any lookup", () => {
  const scope = ["--profile", "urn:usf:profile:v3-self-host:3", "--manifest", "graph/manifests/self-host-provider-v3.json", "--input", "-"];
  for (const handler of [callParallelCommandHandler, callCompareCommandHandler]) {
    // Missing explicit scope refuses as invalid input, never as a proofblock.
    assert.throws(() => handler({ args: [], repositoryRoot: process.cwd() } as never),
      (error: unknown) => (error as { code?: string }).code === "PROVIDER_PARALLEL_ARGUMENTS_INVALID");
    // A syntactically complete request still refuses before route or config lookup.
    assert.throws(() => handler({ args: scope, repositoryRoot: process.cwd() } as never),
      (error: unknown) => (error as { code?: string }).code === "PROVIDER_PARALLEL_PROOFBLOCKED");
    // A named route cannot become a hidden prerequisite for the refusal.
    assert.throws(() => handler({ args: [...scope, "--route", "groq-qwen3.6-27b"], repositoryRoot: process.cwd() } as never),
      (error: unknown) => (error as { code?: string }).code === "PROVIDER_PARALLEL_PROOFBLOCKED");
  }
});
