import assert from "node:assert/strict";
import test from "node:test";
import { callAssignments } from "../../src/commands/call.ts";
import { UsfError } from "../../src/core/errors.ts";
import { resolveCommand, resolveCommandHandler } from "../../src/commands/resolve.ts";
import { createLocalContribution } from "../../src/collaboration/local-contribution.ts";
import { createRealisationBasis } from "../../src/realisation/basis.ts";
import { fakeProviderRoutes } from "../../src/providers/fake.ts";
import type { CallAssignment } from "../../src/providers/types.ts";
import { proposalBasis, proposalPacket } from "../fixtures/proposal-packet.ts";

test("resolve CLI preserves local lineage without creating provider success observations", async () => {
  const { basisDigest: _digest, ...draft } = proposalBasis();
  const requirements = ["urn:usf:contribution-source:local-authored:1", "urn:usf:algorithm:local-contribution-preparation:1"].map(id => ({ id, digest: "sha256:" + "c".repeat(64) }));
  const basis = createRealisationBasis({ ...draft,
    trace: { ...draft.trace, requirements: [...draft.trace.requirements, ...requirements] },
    work: { ...draft.work, dependencies: [...draft.work.dependencies, ...requirements.map(r => ({ kind: "semantic-resource" as const, key: r.id, digest: r.digest }))] },
    scope: { readSet: [], writeSet: ["src/local.ts", "src/provider.ts"], preimages: { "src/local.ts": null, "src/provider.ts": null } } });
  const local = createLocalContribution(basis, [{ kind: "write", path: "src/local.ts", content: "export {};\n" }]);
  const invoke = async (value: unknown) => resolveCommandHandler({ command: "resolve", repositoryRoot: "/unused", args: [JSON.stringify(value)] });
  const first = await invoke(local), replay = await invoke(local);
  assert.equal(first.exitCode, 0);
  assert.deepEqual(first, replay);
  const result = first.output as ReturnType<typeof resolveCommand>;
  assert.deepEqual(result.acceptedContributionDigests, [local.identity.artifactDigest]);
  assert.equal("metrics" in result, false);
  assert.equal(local.provenance.model, null);
  assert.equal(local.provenance.tokens, null);
  assert.equal(local.provenance.cost, null);

  const route = fakeProviderRoutes()[0]!;
  const batch = await callAssignments([{ route, basis, workPacketDigest: basis.work.packetCoreDigest,
    promptTemplateDigest: basis.inputs.policyDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest,
    limits: { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 },
    packet: proposalPacket(basis.work.id, "fixture", ["src/provider.ts"], [{ kind: "write", path: "src/provider.ts", content: "export {};\n" }]),
  }]);
  const mixed = await invoke([local, ...batch.contributions]);
  assert.equal(mixed.exitCode, 0);
  assert.equal((mixed.output as ReturnType<typeof resolveCommand>).candidate?.payload.operations.length, 2);
  await assert.rejects(() => invoke({ ...batch, contributions: [local] }), { code: "RESOLVE_CALL_RESULT_INCOMPLETE" });
  await assert.rejects(() => invoke({ ...local, provenance: { ...local.provenance, reviewIndependence: "proven" } }), { code: "LOCAL_PROVENANCE_INVALID" });
  await assert.rejects(() => invoke({ ...local, providerSuccess: true }), { code: "LOCAL_CONTRIBUTION_INPUT_INVALID" });
});

test("fake call and resolve form a deterministic no-write bootstrap chain", async () => {
  const routes = fakeProviderRoutes();
  const basis = proposalBasis();
  const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
  const assignments: CallAssignment[] = routes.map((route, index) => ({ route, basis, workPacketDigest: basis.work.packetCoreDigest, promptTemplateDigest: basis.inputs.policyDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest, limits, packet: proposalPacket(basis.work.id, "bootstrap", [`src/boot-${index}.ts`], [{ kind: "write", path: `src/boot-${index}.ts`, content: "export {};\n" }]) }));
  const first = await callAssignments(assignments, 2); const second = await callAssignments(assignments, 2);
  assert.deepEqual(first, second);
  const resolution = resolveCommand(first.contributions);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.candidate?.payload.operations.length, 2);
});

test("fake call refuses malformed host concurrency before provider contact", async () => {
  const route = fakeProviderRoutes()[0]!;
  const basis = proposalBasis();
  const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
  const packet = proposalPacket(basis.work.id, "bootstrap", ["src/boot.ts"], [{ kind: "write", path: "src/boot.ts", content: "export {};\n" }]);
  Object.defineProperty(packet, "proposedFileOperations", { get: () => { throw new Error("provider contacted"); } });
  const assignment: CallAssignment = { route, basis, workPacketDigest: basis.work.packetCoreDigest, promptTemplateDigest: basis.inputs.policyDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest, limits, packet };

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => callAssignments([assignment], value),
      (error: unknown) => error instanceof UsfError && error.code === "CALL_HOST_CONCURRENCY_INVALID",
    );
  }
});

test("fake call refuses malformed route concurrency before provider contact", async () => {
  const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
  const basis = proposalBasis();
  const packet = proposalPacket(basis.work.id, "bootstrap", ["src/boot.ts"], [{ kind: "write", path: "src/boot.ts", content: "export {};\n" }]);
  Object.defineProperty(packet, "proposedFileOperations", { get: () => { throw new Error("provider contacted"); } });

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const route = { ...fakeProviderRoutes()[0]!, concurrency: value };
    const assignment: CallAssignment = { route, basis, workPacketDigest: basis.work.packetCoreDigest, promptTemplateDigest: basis.inputs.policyDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest, limits, packet };
    await assert.rejects(
      () => callAssignments([assignment]),
      (error: unknown) => error instanceof UsfError && error.code === "CALL_ROUTE_CONCURRENCY_INVALID",
    );
  }
});
