import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/e2econfidenceladderstageaware.ts";

test("e2econfidenceladderstageawareauditmodel", () => {
  const config: capability.E2eConfidenceLadderConfig = {
    stages: [{ name: "HERMETIC", confidenceThreshold: 1 }],
  };
  const state: capability.E2eConfidenceLadderState = {
    ...capability.initialState,
    config,
    stageResults: [],
    aggregatedVerdict: null,
  };
  const newState = capability.recordAudit(
    state,
    "HERMETIC",
    "PASSED",
    "PASSED",
  );
  assert.strictEqual(newState.auditRecords.length, 1);
  assert.strictEqual(newState.auditRecords[0].stage, "HERMETIC");
  assert.strictEqual(newState.auditRecords[0].verdict, "PASSED");
  assert.strictEqual(newState.auditRecords[0].aggregatedVerdict, "PASSED");
});

test("e2econfidenceladderstageawarecontracts", () => {
  const validConfig: capability.E2eConfidenceLadderConfig = {
    stages: [{ name: "HERMETIC", confidenceThreshold: 1 }],
  };
  const result = capability.validateConfig(validConfig);
  assert.deepStrictEqual(result, validConfig);

  const invalidConfig = { stages: [] };
  const error = capability.validateConfig(invalidConfig);
  if ("kind" in error) {
    assert.strictEqual(error.kind, "INVALID_CONFIGURATION");
  } else {
    assert.fail("Should have returned an error for empty stages");
  }
});

test("e2econfidenceladderstageawareerrormodel", () => {
  const state: capability.E2eConfidenceLadderState = {
    ...capability.initialState,
    config: null,
  };
  const result = capability.verifyLadder(state);
  if ("kind" in result) {
    assert.strictEqual(result.kind, "INVALID_CONFIGURATION");
  } else {
    assert.fail("Should have returned error due to missing config");
  }
});

test("e2econfidenceladderstageawarelifecycle", () => {
  const config: capability.E2eConfidenceLadderConfig = {
    stages: [
      { name: "HERMETIC", confidenceThreshold: 1 },
      { name: "INTEGRATION", confidenceThreshold: 1 },
    ],
  };
  const state: capability.E2eConfidenceLadderState = {
    ...capability.initialState,
    config,
    stageResults: [{ stage: "HERMETIC", verdict: "PASSED", timestamp: "2024-01-01T00:00:00Z" }],
  };
  const result = capability.verifyLadder(state);
  if ("kind" in result) {
    assert.strictEqual(result.kind, "MISSING_STAGE_EVIDENCE");
    assert.strictEqual(result.stage, "INTEGRATION");
  } else {
    assert.fail("Should have failed as INTEGRATION evidence is missing");
  }
});

test("e2econfidenceladderstageawarepermissions", () => {
  const config: capability.E2eConfidenceLadderConfig = {
    stages: [{ name: "HERMETIC", confidenceThreshold: 1 }],
  };
  const state: capability.E2eConfidenceLadderState = {
    ...capability.initialState,
    config,
    stageResults: [{ stage: "HERMETIC", verdict: "PASSED", timestamp: "2024-01-01T00:00:00Z" }],
  };
  const result = capability.checkPromotionReadiness(state, "HERMETIC");
  if (!("kind" in result)) {
    assert.strictEqual(result.ready, true);
    assert.strictEqual(result.verdict, "PASSED");
  } else {
    assert.fail("Promotion should be ready");
  }
});

test("e2econfidenceladderstageawareproof", () => {
  const config: capability.E2eConfidenceLadderConfig = {
    stages: [{ name: "HERMETIC", confidenceThreshold: 1 }],
  };
  const passedResults: readonly capability.E2eConfidenceLadderStageResult[] = [
    { stage: "HERMETIC", verdict: "PASSED", timestamp: "2024-01-01T00:00:00Z" },
  ];
  assert.strictEqual(capability.aggregateConfidence(passedResults, config), "PASSED");

  const failedResults: readonly capability.E2eConfidenceLadderStageResult[] = [
    { stage: "HERMETIC", verdict: "FAILED", timestamp: "2024-01-01T00:00:00Z" },
  ];
  assert.strictEqual(capability.aggregateConfidence(failedResults, config), "FAILED");
});

test("e2econfidenceladderstageawarereadinessmodel", () => {
  const config: capability.E2eConfidenceLadderConfig = {
    stages: [{ name: "HERMETIC", confidenceThreshold: 1 }],
  };
  const state: capability.E2eConfidenceLadderState = {
    ...capability.initialState,
    config,
    stageResults: [{ stage: "HERMETIC", verdict: "UNKNOWN", timestamp: "2024-01-01T00:00:00Z" }],
  };
  const result = capability.verifyLadder(state);
  if ("kind" in result) {
    assert.strictEqual(result.kind, "STALE_STAGE_EVIDENCE");
  } else {
    assert.fail("Readiness must fail closed on UNKNOWN evidence");
  }
});

test("e2econfidenceladderstageawarevalidation", () => {
  const config: capability.E2eConfidenceLadderConfig = {
    stages: [{ name: "HERMETIC", confidenceThreshold: 1 }],
  };
  const result: capability.E2eConfidenceLadderStageResult = {
    stage: "HERMETIC",
    verdict: "PASSED",
    timestamp: "2024-01-01T00:00:00Z",
  };
  assert.strictEqual(capability.verifyStageResult("HERMETIC", result, config), true);

  const wrongStage: capability.E2eConfidenceLadderStageResult = {
    ...result,
    stage: "INTEGRATION",
  };
  assert.strictEqual(capability.verifyStageResult("HERMETIC", wrongStage, config), false);
});