import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicFakeProvider, fakeProviderRoutes, type CallAssignment, type FakeRoute } from "../../../src/providers/index.ts";
import { callAssignments } from "../../../src/commands/call.ts";
import { proposalPacket } from "../../fixtures/proposal-packet.ts";

const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
const assignment = (route: FakeRoute, path = "src/example.ts"): CallAssignment => ({ route, workPacketDigest: "sha256:work", promptTemplateDigest: "sha256:prompt", scopedDependencyDigest: "sha256:scope", limits, packet: proposalPacket("packet", "write a small source file", [path], [{ kind: "write", path, content: "export {};\n" }]) });

test("two deterministic fake families retain distinct requested and actual identities", () => {
  const [orbit, harbor] = fakeProviderRoutes();
  assert.notEqual(orbit.requested.provider, orbit.actual.provider);
  assert.notEqual(orbit.requested.model, orbit.actual.model);
  assert.notEqual(orbit.requested.family, harbor.requested.family);
  const one = new DeterministicFakeProvider(orbit).invoke(assignment(orbit));
  const two = new DeterministicFakeProvider(orbit).invoke(assignment(orbit));
  assert.ok("schema" in one && "schema" in two);
  assert.equal(one.identity.artifactDigest, two.identity.artifactDigest);
  assert.throws(() => { ((one as unknown as { payload: { operations: { path: string }[] } }).payload.operations[0]!).path = "changed.ts"; }, TypeError);
});

test("paid and unknown routes are refused before a provider call", () => {
  const [base] = fakeProviderRoutes();
  for (const costClass of ["paid", "unknown"] as const) {
    const result = new DeterministicFakeProvider({ ...base, costClass, observedCost: costClass === "paid" ? 1 : null }).invoke(assignment({ ...base, costClass, observedCost: costClass === "paid" ? 1 : null }));
    assert.equal("schema" in result, false);
    if (!("schema" in result)) assert.equal(result.reasonCode, "ZERO_COST_POLICY_REFUSAL");
  }
});

test("one injected provider failure leaves another family contribution available", async () => {
  const [orbit, harbor] = fakeProviderRoutes();
  const output = await callAssignments([assignment({ ...orbit, failure: "always" }), assignment(harbor, "src/other.ts")], 2);
  assert.equal(output.status, "partial");
  assert.equal(output.contributions.length, 1);
  assert.equal(output.failures[0]?.reasonCode, "FAKE_PROVIDER_INJECTED_FAILURE");
});

test("a retryable injected failure consumes only the declared retry budget", async () => {
  const [orbit] = fakeProviderRoutes();
  const output = await callAssignments([{ ...assignment({ ...orbit, failure: "once" }), limits: { ...limits, maxRetries: 1 } }]);
  assert.equal(output.status, "ok");
  assert.equal(output.contributions[0]?.usage.retries, 1);
});
