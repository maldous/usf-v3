import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicFakeProvider, fakeProviderRoutes } from "../../../src/providers/fake.ts";
import { candidateArtifactDigest, digest, type CallAssignment } from "../../../src/providers/types.ts";
import { resolveContributions } from "../../../src/collaboration/index.ts";
import { proposalBasis, proposalPacket } from "../../fixtures/proposal-packet.ts";
import { createLocalContribution } from "../../../src/collaboration/local-contribution.ts";
import { createRealisationBasis } from "../../../src/realisation/basis.ts";

const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
function contribution(path: string, basis = proposalBasis()) {
  const route = fakeProviderRoutes()[path.endsWith("a.ts") ? 0 : 1]!;
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

test("same resolver merges local and provider contributions without provider-shaped local facts", () => {
  const { basisDigest: _digest, ...draft } = proposalBasis();
  const requirements = ["urn:usf:contribution-source:local-authored:1", "urn:usf:algorithm:local-contribution-preparation:1"].map(id => ({ id, digest: "sha256:" + "c".repeat(64) }));
  const basis = createRealisationBasis({ ...draft,
    trace: { ...draft.trace, requirements: [...draft.trace.requirements, ...requirements] },
    work: { ...draft.work, dependencies: [...draft.work.dependencies, ...requirements.map(r => ({ kind: "semantic-resource" as const, key: r.id, digest: r.digest }))] },
    scope: { readSet: [], writeSet: ["src/a.ts", "src/b.ts"], preimages: { "src/a.ts": null, "src/b.ts": null } } });
  for (const content of ["/", "/** source comment */\nexport {};", "// line comment", "~/literal", "C:\\source\\literal"]) {
    const local = createLocalContribution(basis, [{ kind: "write", path: "src/b.ts", content }]);
    const result = resolveContributions([local]);
    assert.equal(result.status, "resolved", content);
    assert.equal(result.candidate?.payload.operations[0]?.content, content);
    assert.notEqual(result.candidate?.identity.artifactDigest, resolveContributions([createLocalContribution(basis, [{ kind: "write", path: "src/b.ts", content: content + "changed" }])]).candidate?.identity.artifactDigest);
  }
  const provider = contribution("src/a.ts", basis);
  const local = createLocalContribution(basis, [{ kind: "write", path: "src/b.ts", content: "local" }]);
  const left = resolveContributions([provider, local]), right = resolveContributions([local, provider]);
  assert.equal(left.status, "resolved"); assert.deepEqual(left, right);
  assert(left.candidate?.lineage.acceptedContributionDigests.includes(local.identity.artifactDigest));
  assert.deepEqual(resolveContributions([local]), resolveContributions([local]));
  assert.equal(resolveContributions([local, local]).status, "refused");
  assert.equal(resolveContributions([provider, createLocalContribution(basis, [{ kind: "write", path: "src/a.ts", content: "collision" }])]).status, "refused");
  const invalid = { ...local, identity: { ...local.identity, artifactDigest: "sha256:" + "0".repeat(64) } };
  assert.equal(resolveContributions([invalid]).rejected[0]?.reasonCode, "LOCAL_CONTRIBUTION_INTEGRITY_FAILURE");
  assert.throws(() => resolveContributions([contribution("src/a.ts"), local]));
});

test("overlaps and malformed operations are refused with stable lineage", () => {
  const one = contribution("src/a.ts"); const overlap = contribution("src/a.ts");
  const conflict = resolveContributions([one, overlap]);
  assert.equal(conflict.status, "refused"); assert.equal(conflict.rejected[0]?.reasonCode, "OVERLAPPING_FILE_OPERATION");
  const malformed = { ...one, payload: { operations: [{ kind: "write", path: "../escape.ts", content: "no" }] } };
  const invalid = resolveContributions([malformed as unknown as typeof one]);
  assert.equal(invalid.status, "refused"); assert.equal(invalid.rejected[0]?.reasonCode, "MALFORMED_FILE_OPERATION");
});

test("candidate digest preserves accepted identities and excludes only validated write content from path interpretation", () => {
  const identity = { basisDigest: "sha256:" + "a".repeat(64), operations: [{ kind: "write" as const, path: "src/a.ts", content: "export {};" }], acceptedContributionDigests: ["sha256:" + "b".repeat(64)] };
  assert.equal(candidateArtifactDigest(identity), digest(identity));
  const opaque = { ...identity, operations: [{ ...identity.operations[0]!, content: "/** opaque */" }] };
  assert.notEqual(candidateArtifactDigest(opaque), candidateArtifactDigest({ ...opaque, operations: [{ ...opaque.operations[0]!, content: "/** changed */" }] }));
  const undeclaredOperation = { ...identity.operations[0]!, undeclared: "/tmp/metadata" };
  assert.throws(() => candidateArtifactDigest({ ...identity, operations: [undeclaredOperation] }), { code: "ABSOLUTE_PATH_FORBIDDEN" });
  const deletion = { ...identity, operations: [{ kind: "delete" as const, path: "src/a.ts" }] };
  assert.equal(candidateArtifactDigest(deletion), digest(deletion));
  for (const path of ["/tmp/escape", "../escape", "C:\\escape"]) {
    assert.throws(() => candidateArtifactDigest({ ...identity, operations: [{ ...identity.operations[0]!, path }] }), { code: "MALFORMED_FILE_OPERATION" });
  }
  for (const extra of [{ basisDigest: "/tmp/basis" }, { acceptedContributionDigests: ["/tmp/contribution"] }, { undeclared: "/tmp/metadata" }]) {
    assert.throws(() => candidateArtifactDigest({ ...identity, ...extra }), { code: "ABSOLUTE_PATH_FORBIDDEN" });
  }
  assert.throws(() => candidateArtifactDigest({ ...identity, operations: [{ ...identity.operations[0]!, path: "~/escape" }] }), { code: "ABSOLUTE_PATH_FORBIDDEN" });
  assert.throws(() => candidateArtifactDigest({ ...identity, operations: [{ ...identity.operations[0]!, expectedDigest: "/tmp/preimage" }] }), { code: "ABSOLUTE_PATH_FORBIDDEN" });
  assert.throws(() => candidateArtifactDigest({ ...identity, operations: [{ ...identity.operations[0]!, encoding: "base64", content: "not-base64!" }] }), { code: "MALFORMED_FILE_OPERATION" });
});
