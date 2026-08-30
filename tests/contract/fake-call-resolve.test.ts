import assert from "node:assert/strict";
import test from "node:test";
import { callAssignments } from "../../src/commands/call.ts";
import { resolveCommand } from "../../src/commands/resolve.ts";
import { fakeProviderRoutes, type CallAssignment } from "../../src/providers/index.ts";
import { proposalPacket } from "../fixtures/proposal-packet.ts";

test("fake call and resolve form a deterministic no-write bootstrap chain", async () => {
  const routes = fakeProviderRoutes();
  const limits = { maxTurns: 1, maxWallTimeMs: 100, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 0, maxRetries: 0 };
  const assignments: CallAssignment[] = routes.map((route, index) => ({ route, workPacketDigest: `sha256:work-${index}`, promptTemplateDigest: "sha256:prompt", scopedDependencyDigest: "sha256:scope", limits, packet: proposalPacket(`p-${index}`, "bootstrap", [`src/boot-${index}.ts`], [{ kind: "write", path: `src/boot-${index}.ts`, content: "export {};\n" }]) }));
  const first = await callAssignments(assignments, 2); const second = await callAssignments(assignments, 2);
  assert.deepEqual(first, second);
  const resolution = resolveCommand(first.contributions);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.candidate?.payload.operations.length, 2);
});
