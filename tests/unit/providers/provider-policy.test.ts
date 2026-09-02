import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { readFileSync } from "node:fs";
import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { buildProviderPolicyProposal, resolvePolicyMutation } from "../../../src/commands/provider-policy.ts";

/**
 * Toggling a reservation and promoting a transport are operator actions that
 * were done by hand-editing quads. As a command they must resolve the exact
 * line to set, replace it in place so a toggle never accumulates two values,
 * and name a transport rather than an internal policy IRI.
 */
const root = resolve(import.meta.dirname, "../../..");
const graph = loadSemanticGraph(root, "graph/manifests/v3-execution.json");
const parse = (action: string, transport: string) =>
  ({ action, transport }) as never;

test("promote and demote target the transport's own preference flag", () => {
  assert.deepEqual(resolvePolicyMutation(graph, parse("promote", "antigravity-cli")), {
    subject: "urn:usf:execution-transport:antigravity-cli",
    predicate: "operatorPreferredForDispatch", value: "true",
  });
  assert.equal(resolvePolicyMutation(graph, parse("demote", "antigravity-cli")).value, "false");
});

test("reserve and admit resolve the reservation policy for the named transport", () => {
  const reserved = resolvePolicyMutation(graph, parse("reserve", "claude-cli"));
  assert.match(reserved.subject, /provider-execution-policy:operator-reserved-claude-oauth/u);
  assert.equal(reserved.predicate, "policyActive");
  assert.equal(reserved.value, "true");
  assert.equal(resolvePolicyMutation(graph, parse("admit", "claude-cli")).value, "false");
});

test("an unknown transport and an unreserved transport are refused, not invented", () => {
  assert.throws(() => resolvePolicyMutation(graph, parse("promote", "no-such-cli")),
    (e: unknown) => (e as { code?: string }).code === "PROVIDER_POLICY_TRANSPORT_UNKNOWN");
  assert.throws(() => resolvePolicyMutation(graph, parse("reserve", "antigravity-cli")),
    (e: unknown) => (e as { code?: string }).code === "PROVIDER_POLICY_NO_RESERVATION");
});

test("a toggle replaces its line rather than accumulating two values", () => {
  const src = readFileSync(resolve(root, "graph/v3-execution.nq"), "utf8");
  // codex-cli is currently promoted (true); demote must leave exactly one flag line.
  const built = buildProviderPolicyProposal(graph, src, parse("demote", "codex-cli"));
  const prefix = "<urn:usf:execution-transport:codex-cli> <urn:usf:predicate:operatorPreferredForDispatch> ";
  const lines = built.content.split("\n").filter((l) => l.startsWith(prefix));
  assert.equal(lines.length, 1, "exactly one preference line after a toggle");
  assert.match(lines[0]!, /"false"/u);
});
