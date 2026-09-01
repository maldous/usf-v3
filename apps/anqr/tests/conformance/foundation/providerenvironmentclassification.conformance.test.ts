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
});

test("providerenvironmentclassificationcontracts", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
    ],
    lastError: null,
  };
  const { matrix, error } = capability.getClassificationMatrix(state);
  assert.strictEqual(error, null);
  assert.deepStrictEqual(matrix, {
    p1: { mode: "production-live", environment: "live" },
  });

  const emptyState = capability.initialState;
  const { error: emptyError } = capability.getClassificationMatrix(emptyState);
  assert.notStrictEqual(emptyError, null);
  assert.strictEqual(emptyError?.kind, "CONFIG_MISSING");
});

test("providerenvironmentclassificationerrormodel", () => {
  const error = capability.degradedError("test degraded");
  assert.strictEqual(error.kind, "DEGRADED");
  assert.strictEqual(error.message, "test degraded");

  const state: capability.ProviderClassificationState = {
    classifications: [],
    lastError: error,
  };
  const { ready, error: readinessError } = capability.checkReadiness(state);
  assert.strictEqual(ready, false);
  assert.deepStrictEqual(readinessError, error);
});

test("providerenvironmentclassificationpermissions", () => {
  const state = capability.initialState;
  const { ready } = capability.checkReadiness(state);
  assert.strictEqual(ready, false);
  const { error } = capability.getClassificationMatrix(state);
  assert.strictEqual(error?.kind, "CONFIG_MISSING");
});

test("providerenvironmentclassificationproof", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
    ],
    lastError: null,
  };
  const proof = capability.generateProof(state);
  assert.strictEqual(proof.status, "VALID");

  const emptyState = capability.initialState;
  const pendingProof = capability.generateProof(emptyState);
  assert.strictEqual(pendingProof.status, "PENDING");
});

test("providerenvironmentclassificationreadinessmodel", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
    ],
    lastError: null,
  };
  const { ready, error } = capability.checkReadiness(state);
  assert.strictEqual(ready, true);
  assert.strictEqual(error, null);

  const invalidState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };
  const { ready: invalidReady } = capability.checkReadiness(invalidState);
  assert.strictEqual(invalidReady, false);
});

test("providerenvironmentclassificationvalidation", () => {
  const validEntry: capability.ProviderClassification = {
    provider: "p1",
    mode: "production-live",
    environment: "live",
  } as const;
  const validError = capability.validateClassificationEntry(validEntry);
  assert.strictEqual(validError, null);

  const invalidHermeticLive: capability.ProviderClassification = {
    provider: "p1",
    mode: "hermetic-mock",
    environment: "live",
  } as const;
  const invalidHermeticError = capability.validateClassificationEntry(invalidHermeticLive);
  assert.notStrictEqual(invalidHermeticError, null);
  assert.strictEqual(invalidHermeticError?.kind, "VALIDATION_FAILED");

  const invalidProductionShapedLive: capability.ProviderClassification = {
    provider: "p1",
    mode: "production-shaped",
    environment: "live",
  } as const;
  const invalidProductionShapedError = capability.validateClassificationEntry(invalidProductionShapedLive);
  assert.notStrictEqual(invalidProductionShapedError, null);
  assert.strictEqual(invalidProductionShapedError?.kind, "VALIDATION_FAILED");
});