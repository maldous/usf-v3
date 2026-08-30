import test from "node:test";
import assert from "node:assert/strict";
import { createFakeProvider, runContinuous, type Route, type WorkPacket } from "../../src/continuous/index.ts";

const routes: Route[] = ["a", "b", "c", "d"].map((id) => ({ id, provider: id, concurrency: 1 }));

test("restart rescans completion, drops transient claims, and isolates provider failure and rejection", () => {
  const first: WorkPacket[] = [
    { id: "done", routes: ["a"] }, { id: "fail", routes: ["b"] }, { id: "reject", routes: ["c"] }, { id: "independent", routes: ["d"] },
  ];
  const initial = runContinuous({ packets: first, routes, hostConcurrency: 4, invoke: createFakeProvider({ failPackets: new Set(["fail"]), rejectPackets: new Set(["reject"]) }) });
  assert.equal(initial.states.done, "accepted");
  assert.equal(initial.states.independent, "accepted");
  assert.equal(initial.states.fail, "failed");
  assert.equal(initial.states.reject, "rejected");
  assert.equal(initial.metrics.failed, 1);
  assert.equal(initial.metrics.rejected, 1);
  const restarted = runContinuous({
    packets: [...first, { id: "after-restart", dependsOn: ["done"], routes: ["a"], cacheKey: "restart" }],
    routes, hostConcurrency: 2,
    checkpoint: { ...initial.checkpoint, claims: ["interrupted:a"] },
    invoke: createFakeProvider(),
  });
  assert.equal(restarted.states["after-restart"], "accepted");
  assert.deepEqual(restarted.checkpoint.claims, []);
  assert.ok(restarted.integrations.some((batch) => batch.includes("after-restart")));
});

test("cache reuse avoids a repeated deterministic call", () => {
  const result = runContinuous({
    packets: [{ id: "one", routes: ["a"], cacheKey: "same" }, { id: "two", dependsOn: ["one"], routes: ["a"], cacheKey: "same" }],
    routes, hostConcurrency: 1, invoke: createFakeProvider({ inputTokens: 3, outputTokens: 7 }),
  });
  assert.equal(result.states.two, "cached");
  assert.equal(result.metrics.cacheReuses, 1);
  assert.equal(result.metrics.totalTokens, 10);
});
