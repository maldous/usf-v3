import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runBootstrapLoop } from "../../src/bootstrap/loop.ts";
import type { WorkPacket } from "../../src/graph/work.ts";
import { fakeProviderRoutes } from "../../src/providers/index.ts";

const dependencyDigest = `sha256:${"a".repeat(64)}`;

function workPacket(): WorkPacket {
  return {
    schema: "urn:usf:work-packet:1",
    id: "urn:example:work:health-implementation",
    contract: "urn:example:contract:health",
    decisionBoundary: { kind: "work", root: "urn:example:work:health-implementation" },
    objective: "Implement and test a deterministic health response.",
    dependsOn: [],
    semanticDependencies: [{ key: "urn:example:contract:health", digest: dependencyDigest, kind: "semantic-resource" }],
    readSet: [],
    writeSet: ["src/health.ts", "tests/health.test.ts"],
    constraints: ["No network access."],
    requirements: [],
    artifacts: [],
    acceptanceCriteria: [{ id: "urn:example:acceptance:health", text: "Health is exactly ok." }],
    validationPlan: [{ id: "urn:example:validation:health", command: "node tests/health.test.ts", environment: "urn:usf:environment:hermetic", executionMode: "urn:usf:mode:deterministic-test-substitute", applicability: "required" }],
    proofObligations: [{ id: "urn:example:proof:health", text: "The focused check passes.", environment: "urn:usf:environment:hermetic", executionMode: "urn:usf:mode:deterministic-test-substitute", applicability: "required" }],
    modelCapabilities: ["typescript", "node-test"],
    constructionRouteConstraints: ["zero-paid-cost"],
    targetRuntimeProvider: "none",
    privacy: "public",
    environmentPosture: [{ environment: "urn:usf:environment:hermetic", applicability: "required" }],
    outputSchema: "urn:usf:contribution:1",
    stopConditions: ["Stop when the focused check passes."],
    scopedDependencyDigest: dependencyDigest,
  };
}

test("query-derived work can drive heterogeneous calls through an isolated focused check", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-bootstrap-loop-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  const [implementationRoute, testRoute] = fakeProviderRoutes();
  const result = await runBootstrapLoop({
    repositoryRoot: root,
    work: workPacket(),
    proposals: [
      {
        route: implementationRoute!,
        operations: [{ kind: "write", path: "src/health.ts", content: "export const health = () => ({ status: 'ok' as const });\n" }],
      },
      {
        route: testRoute!,
        operations: [{ kind: "write", path: "tests/health.test.ts", content: "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { health } from '../src/health.ts';\ntest('health', () => assert.deepEqual(health(), { status: 'ok' }));\n" }],
      },
    ],
    hostConcurrency: 2,
  });
  assert.equal(result.status, "checked");
  assert.equal(result.calls.metrics.succeeded, 2);
  assert.equal(result.contributionDigests.length, 2);
  assert.equal(result.check.status, "pass");
  await assert.rejects(() => readFile(join(root, "src", "health.ts")), { code: "ENOENT" });
});
