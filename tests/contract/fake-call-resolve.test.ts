import assert from "node:assert/strict";
import test from "node:test";
import { callAssignments } from "../../src/commands/call.ts";
import { UsfError } from "../../src/core/errors.ts";
import { resolveCommand } from "../../src/commands/resolve.ts";
import { fakeProviderRoutes } from "../../src/providers/fake.ts";
import type { CallAssignment } from "../../src/providers/types.ts";
import { proposalBasis, proposalPacket } from "../fixtures/proposal-packet.ts";

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
