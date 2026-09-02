import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { permitsExecution, readProviderExecutionPolicy } from "../../../src/providers/provider-policy.ts";

/**
 * Lifting the claude-cli transport reservation must actually admit Claude on
 * that transport. It did not: a separate, still-active model-prefix reservation
 * -- built to block Claude reached through marketplace transports and the API --
 * caught claude-cli's own declared models and refused the whole transport,
 * silently overruling the operator's explicit admission. The claude-cli
 * transport, the family's sanctioned home, is now exempt from that prefix
 * reservation while every other route stays blocked.
 */
const policy = readProviderExecutionPolicy(
  loadSemanticGraph(resolve(import.meta.dirname, "../../.."), "graph/manifests/v3-execution.json"),
);
const permits = (transport: string, provider: string, model: string) =>
  permitsExecution(policy, { transport, provider, model }).permitted;

test("Claude runs on its own CLI session once its reservation is lifted", () => {
  assert.equal(permits("claude-cli", "claude-cli", "claude-haiku-4-5-20251001"), true);
  assert.equal(permits("claude-cli", "claude-cli", "claude-fable-5"), true);
  assert.equal(permits("claude-cli", "claude-cli", "claude-sonnet-5"), true);
});

test("Claude reached through any other route stays reserved", () => {
  // The marketplace transport and the API are exactly what the prefix
  // reservation exists to block; the exemption is claude-cli only.
  assert.equal(permits("antigravity-cli", "antigravity-cli", "claude-sonnet-5"), false);
  assert.equal(permits("vercel-ai-sdk", "anthropic", "anthropic/claude-sonnet"), false);
});

test("the exemption is transport-scoped, not a blanket prefix removal", () => {
  assert.ok(policy.modelPrefixExemptTransports.size > 0, "the exemption must be declared, not assumed");
  for (const [, transports] of policy.modelPrefixExemptTransports) {
    assert.ok(transports.has("claude-cli"));
    assert.equal(transports.has("antigravity-cli"), false);
  }
});
