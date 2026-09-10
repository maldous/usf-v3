import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  IntegrationError,
  inspectCandidateIntegrationRecovery,
} from "../../../src/realisation/transition.ts";

test("integration recovery inspection reports an absent intent without creating state", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-integration-inspection-"));
  try {
    const result = await inspectCandidateIntegrationRecovery(root, {
      candidateDigests: [`sha256:${"a".repeat(64)}`],
    });
    assert.equal(result.state, "absent");
    assert.equal(result.request, null);
    assert.equal(result.prepared, null);
    assert.equal(result.observation, null);
    assert.deepEqual(result.factDigests, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("integration recovery inspection rejects duplicate candidate locators", async () => {
  const root = await mkdtemp(join(tmpdir(), "usf-integration-inspection-"));
  const digest = `sha256:${"b".repeat(64)}`;
  try {
    await assert.rejects(
      inspectCandidateIntegrationRecovery(root, { candidateDigests: [digest, digest] }),
      (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_DUPLICATE_CANDIDATE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
