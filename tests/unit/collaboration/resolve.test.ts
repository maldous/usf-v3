import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicFakeProvider, fakeProviderRoutes } from "../../../src/providers/fake.ts";
import type { CallAssignment } from "../../../src/providers/types.ts";
import { resolveContributions } from "../../../src/collaboration/index.ts";
import { proposalBasis, proposalPacket } from "../../fixtures/proposal-packet.ts";

const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
function contribution(path: string) {
  const route = fakeProviderRoutes()[path.endsWith("a.ts") ? 0 : 1]!;
  const basis = proposalBasis();
  const assignment: CallAssignment = { route, basis, workPacketDigest: basis.work.packetCoreDigest, promptTemplateDigest: basis.inputs.policyDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest, limits, packet: proposalPacket(basis.work.id, path, [path], [{ kind: "write", path, content: path }]) };
  const value = new DeterministicFakeProvider(route).invoke(assignment);
  assert.ok("schema" in value);
  return value;
}

test("resolution deterministically merges disjoint operations and preserves lineage", () => {
  const first = contribution("src/a.ts"); const second = contribution("src/b.ts");
  const left = resolveContributions([first, second]); const right = resolveContributions([second, first]);
  assert.equal(left.status, "resolved"); assert.equal(right.status, "resolved");
  assert.equal(left.candidate?.identity.artifactDigest, right.candidate?.identity.artifactDigest);
  assert.deepEqual(left.candidate?.lineage.acceptedContributionDigests, left.acceptedContributionDigests);
  assert.equal(left.candidate?.nonclaims.includes("not-written-to-repository"), true);
});

test("overlaps and malformed operations are refused with stable lineage", () => {
  const one = contribution("src/a.ts"); const overlap = contribution("src/a.ts");
  const conflict = resolveContributions([one, overlap]);
  assert.equal(conflict.status, "refused"); assert.equal(conflict.rejected[0]?.reasonCode, "OVERLAPPING_FILE_OPERATION");
  const malformed = { ...one, payload: { operations: [{ kind: "write", path: "../escape.ts", content: "no" }] } };
  const invalid = resolveContributions([malformed as unknown as typeof one]);
  assert.equal(invalid.status, "refused"); assert.equal(invalid.rejected[0]?.reasonCode, "MALFORMED_FILE_OPERATION");
});
