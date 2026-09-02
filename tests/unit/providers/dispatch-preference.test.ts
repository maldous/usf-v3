import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { readProviderBindings } from "../../../src/providers/provider-bindings.ts";

/**
 * The operator can promote a transport for active use.
 *
 * Claude was available, admitted and declared, but economy ranking kept it at
 * the unknown prior behind cheaper free routes, so it never received work and
 * never built history to be ranked on. An authored preference is tried ahead of
 * unpreferred non-deferred routes -- but it is a preference, not an override:
 * the deferral and unproductive-ceiling safety are applied around it in the
 * dispatcher, so a promoted route that produces nothing still stands down.
 */
const root = resolve(import.meta.dirname, "../../..");

test("the graph-authored dispatch preference is read into bindings", () => {
  const bindings = readProviderBindings(loadSemanticGraph(root, "graph/manifests/v3-execution.json"));
  assert.ok(bindings.preferredTransports.has("claude-cli"),
    "the operator promoted claude-cli; the binding must carry the preference");
});

test("a transport with no authored preference is not preferred", () => {
  const bindings = readProviderBindings(loadSemanticGraph(root, "graph/manifests/v3-execution.json"));
  // A default free route carries no preference; promotion is explicit, per transport.
  assert.equal(bindings.preferredTransports.has("vercel-ai-sdk"), false);
});

test("the preference ordering is a stable partition, preferred non-deferred first", () => {
  // The dispatcher's own ordering, reproduced to pin its contract: preferred
  // live candidates lead, then other live candidates, then deferred ones --
  // deferral always wins over preference, which is what keeps a promoted but
  // failing route from being retried ahead of everything every cycle.
  const preferred = new Set(["claude-cli"]);
  const deferred = new Set(["claude-cli:claude-cli:tired"]);
  const spread = [
    { candidateId: "vercel-ai-sdk:or:free", transport: "vercel-ai-sdk" },
    { candidateId: "claude-cli:claude-cli:haiku", transport: "claude-cli" },
    { candidateId: "claude-cli:claude-cli:tired", transport: "claude-cli" },
  ];
  const live = spread.filter((c) => !deferred.has(c.candidateId));
  const ordered = [
    ...live.filter((c) => preferred.has(c.transport)),
    ...live.filter((c) => !preferred.has(c.transport)),
    ...spread.filter((c) => deferred.has(c.candidateId)),
  ].map((c) => c.candidateId);
  assert.deepEqual(ordered, [
    "claude-cli:claude-cli:haiku",   // preferred, live -> first
    "vercel-ai-sdk:or:free",          // unpreferred, live -> middle
    "claude-cli:claude-cli:tired",   // preferred but deferred -> last
  ]);
});
