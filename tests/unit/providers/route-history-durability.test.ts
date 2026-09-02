import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  applyOutputAdmissions,
  applyRouteOutcomes,
  readRouteDeferrals,
  routeProductivity,
  unproductiveAttemptCeiling,
  writeRouteDeferrals,
} from "../../../src/providers/route-deferral.ts";

/**
 * Route history has to survive the round trip through disk.
 *
 * It did not. The reader reconstructed each record field by field and omitted
 * attempts, successes and meanLatencyMs, so they were written correctly and
 * never read back. Every consequence of that was silent: routeProductivity
 * skips a route with zero attempts, so the map was always empty and ordering by
 * what a route has produced never happened; the attempt ceiling could not fire
 * because attempts never exceeded one; and a route that had succeeded looked
 * brand new on the next run.
 *
 * Nothing threw, no count went negative, and the on-disk file looked perfect.
 * That is why these assertions are about the round trip rather than about either
 * half of it.
 */
const canonicalRoot = resolve(import.meta.dirname, "../../..");

async function scratch(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(resolve(canonicalRoot, ".usf/tmp/route-history-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const route = "vercel-ai-sdk:openrouter:example/model:free";
const other = "vercel-ai-sdk:groq:example/other";

test("a success survives being written and read again", async () => {
  const { root, cleanup } = await scratch();
  try {
    const first = applyRouteOutcomes({}, [{ candidateId: route, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 4_000 }], 1_000);
    await writeRouteDeferrals(root, first);
    const readBack = await readRouteDeferrals(root);
    assert.equal(readBack[route]?.attempts, 1, "the attempt must survive the round trip");
    assert.equal(readBack[route]?.successes, 1, "the success must survive the round trip");
    assert.equal(readBack[route]?.meanLatencyMs, 4_000);
  } finally { await cleanup(); }
});

test("history accumulates across runs rather than restarting", async () => {
  const { root, cleanup } = await scratch();
  try {
    let records = applyRouteOutcomes({}, [{ candidateId: route, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 2_000 }], 1_000);
    await writeRouteDeferrals(root, records);
    // A second run reads what the first left behind, exactly as the dispatcher does.
    records = applyRouteOutcomes(await readRouteDeferrals(root),
      [{ candidateId: route, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 4_000 }], 2_000);
    await writeRouteDeferrals(root, records);
    const readBack = await readRouteDeferrals(root);
    assert.equal(readBack[route]?.attempts, 2, "a second run must not reset the count");
    assert.equal(readBack[route]?.successes, 2);
    assert.equal(readBack[route]?.meanLatencyMs, 3_000, "mean latency must fold both observations");
  } finally { await cleanup(); }
});

test("productivity is derivable from what was persisted, not only from memory", async () => {
  const { root, cleanup } = await scratch();
  try {
    const records = applyRouteOutcomes({}, [
      { candidateId: route, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 5_000 },
      { candidateId: other, outcome: "refused", reasonCode: "PROVIDER_TIMEOUT", latencyMs: 150_000 },
    ], 1_000);
    await writeRouteDeferrals(root, records);
    const productivity = routeProductivity(await readRouteDeferrals(root));
    assert.ok(productivity.size > 0, "an empty productivity map means ordering by history cannot happen");
    assert.equal(productivity.get(route)?.successes, 1);
    assert.equal(productivity.get(route)?.successRate, 1);
    assert.equal(productivity.get(other)?.successes, 0);
    assert.equal(productivity.get(other)?.attempts, 1);
  } finally { await cleanup(); }
});

test("a persistently useless route reaches its attempt ceiling across runs", async () => {
  const { root, cleanup } = await scratch();
  try {
    let records: Readonly<Record<string, unknown>> = {};
    // Each iteration is a separate run, so the ceiling can only be reached if
    // the count survives the round trip.
    for (let attempt = 1; attempt <= unproductiveAttemptCeiling; attempt += 1) {
      records = applyRouteOutcomes(await readRouteDeferrals(root),
        [{ candidateId: other, outcome: "refused", reasonCode: "PROVIDER_TIMEOUT", latencyMs: 1_000 }],
        attempt * 1_000);
      await writeRouteDeferrals(root, records as never);
    }
    const readBack = await readRouteDeferrals(root);
    assert.equal(readBack[other]?.attempts, unproductiveAttemptCeiling);
    assert.equal(readBack[other]?.successes, 0);
    assert.match(readBack[other]?.reasonCode ?? "", /^ROUTE_UNPRODUCTIVE:/u,
      "a route that spent its ceiling without succeeding must stand down");
    // A day, not a timeout's worth of minutes.
    assert.ok((readBack[other]?.deferUntilMs ?? 0) - unproductiveAttemptCeiling * 1_000 >= 24 * 60 * 60 * 1_000);
  } finally { await cleanup(); }
});

test("a malformed count is treated as absent rather than trusted", async () => {
  const { root, cleanup } = await scratch();
  try {
    await writeRouteDeferrals(root, applyRouteOutcomes({},
      [{ candidateId: route, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 }], 1_000));
    const path = resolve(root, ".usf/hermes/route-deferrals.json");
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      deferrals: Record<string, Record<string, unknown>>;
    };
    parsed.deferrals[route]!.attempts = -3;
    parsed.deferrals[route]!.successes = "many";
    parsed.deferrals[route]!.meanLatencyMs = Number.NaN;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(parsed), { mode: 0o600 });
    const readBack = await readRouteDeferrals(root);
    assert.equal(readBack[route]?.attempts, 0);
    assert.equal(readBack[route]?.successes, 0);
    assert.equal(readBack[route]?.meanLatencyMs, 0);
  } finally { await cleanup(); }
});

test("admission verdicts survive the round trip exactly as transport history does", async () => {
  const { root, cleanup } = await scratch();
  try {
    let records = applyRouteOutcomes({},
      [{ candidateId: route, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 1_000 }], 1_000);
    records = applyOutputAdmissions(records,
      [{ candidateId: route, admitted: true }, { candidateId: route, admitted: false }], 2_000);
    await writeRouteDeferrals(root, records);
    const readBack = await readRouteDeferrals(root);
    assert.equal(readBack[route]?.outputAcceptances, 1);
    assert.equal(readBack[route]?.outputRefusals, 1);
    // And a later transport fold must not erase them: rebuilding the record
    // with an explicit field list is how the last history was silently lost.
    const folded = applyRouteOutcomes(readBack,
      [{ candidateId: route, outcome: "ok", reasonCode: "INVOCATION_OK", latencyMs: 3_000 }], 3_000);
    assert.equal(folded[route]?.outputAcceptances, 1);
    assert.equal(folded[route]?.outputRefusals, 1);
    assert.equal(folded[route]?.attempts, 2);
  } finally { await cleanup(); }
});
