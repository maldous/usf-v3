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
