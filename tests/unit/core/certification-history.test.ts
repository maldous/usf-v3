import assert from "node:assert/strict";
import test from "node:test";
import { summarizeGateHistory } from "../../../scripts/certification-history.ts";

function run(id: string, start: number, stop: number) {
  return { runId: id, startedAt: new Date(start).toISOString(), completedAt: new Date(stop).toISOString(),
    elapsedMilliseconds: stop - start, status: "passed", mode: "--all", phase: "complete", realisationBasisDigest: "fixture-only" };
}

test("certification accounting separates aggregate execution, overlapping wall time, and unknown gaps", () => {
  const result = summarizeGateHistory([run("b", 50, 150), run("a", 0, 100), run("c", 200, 300)]);
  assert.equal(result.summedRunMilliseconds, 300);
  assert.equal(result.occupiedMilliseconds, 250);
  assert.equal(result.windowMilliseconds, 300);
  assert.equal(result.unobservedBetweenRunsMilliseconds, 50);
  assert.equal(result.repeatedFixtureBasisGroups[0]?.exactCohortEquivalence, "unproven");
});

test("empty retained history creates no duration or certification claim", () => {
  const result = summarizeGateHistory([]);
  assert.equal(result.runCount, 0);
  assert.equal(result.windowMilliseconds, 0);
  assert.deepEqual(result.repeatedFixtureBasisGroups, []);
});
