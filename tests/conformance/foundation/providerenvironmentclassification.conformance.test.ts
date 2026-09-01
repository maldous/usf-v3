import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/foundation/providerenvironmentclassification.ts";

test("providerenvironmentclassificationauditmodel", () => {
  const auditFn = (event: capability.ClassificationAuditEvent): capability.ClassificationError | null => {
    assert.strictEqual(event.kind, "CLASSIFICATION_CHANGE");
    assert.strictEqual(event.provider, "test-provider");
    assert.strictEqual(event.mode, "hermetic-mock");
    assert.strictEqual(event.environment, "test");
    assert.ok(event.timestamp);
    return null;
  };

  const result = capability.auditClassificationChange(
    "test-provider",
    "hermetic-mock",
    "test",
    auditFn,
  );
  assert.strictEqual(result, null);

  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
      { provider: "p2", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };

  const { readiness, error } = capability.checkReadiness(state);
  assert.strictEqual(readiness, "DEGRADED");
  assert.strictEqual(error, capability.degradedError("test degraded"));

  const matrix = capability.getClassificationMatrix(state);
  assert.strictEqual(matrix.p1, { mode: "production-live", environment: "live" });
  assert.strictEqual(matrix.p2, { mode: "hermetic-mock", environment: "live" });
});

test("providerenvironmentclassificationpermissions", () => {
  // Test that hermetic-mock with live environment is rejected
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };

  const entry = { provider: "p1", mode: "hermetic-mock", environment: "live" } as const;
  const validationError = capability.validateClassificationEntry(entry);
  assert.notStrictEqual(validationError, null);
  assert.strictEqual(validationError?.kind, "VALIDATION_FAILED");

  // Test that production-shaped with live environment is rejected
  const stateWithProdShapedLive = capability.initialState;
  const prodShapedLive = { provider: "p2", mode: "production-shaped", environment: "live" } as const;
  const prodShapedLiveError = capability.validateClassificationEntry(prodShapedLive);
  assert.notStrictEqual(prodShapedLiveError, null);
  assert.strictEqual(prodShapedLiveError?.kind, "VALIDATION_FAILED");
});