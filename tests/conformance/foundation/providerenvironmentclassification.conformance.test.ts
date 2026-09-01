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
      { provider: "p2", mode: "hermetic-mock", environment: "test" } as const,
    ],
    lastError: null,
  };

  const { readiness, error } = capability.checkReadiness(state);
  assert.strictEqual(readiness, "READY");
  assert.strictEqual(error, null);

  const matrixResult = capability.getClassificationMatrix(state);
  assert.deepStrictEqual(matrixResult.error, null);
  assert.deepStrictEqual(matrixResult.matrix["p1"], { mode: "production-live", environment: "live" });
  assert.deepStrictEqual(matrixResult.matrix["p2"], { mode: "hermetic-mock", environment: "test" });
});

test("providerenvironmentclassificationcontracts", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
      { provider: "p2", mode: "production-shaped", environment: "external" } as const,
    ],
    lastError: null,
  };

  const matrixResult = capability.getEnvironmentClassificationMatrix(state);
  assert.deepStrictEqual(matrixResult.error, null);
  assert.deepStrictEqual(matrixResult.matrix["p1"], { mode: "production-live", environment: "live" });
  assert.deepStrictEqual(matrixResult.matrix["p2"], { mode: "production-shaped", environment: "external" });

  const emptyState: capability.ProviderClassificationState = {
    classifications: [],
    lastError: null,
  };
  const emptyMatrixResult = capability.getEnvironmentClassificationMatrix(emptyState);
  assert.notStrictEqual(emptyMatrixResult.error, null);
  assert.strictEqual(emptyMatrixResult.error?.kind, "CONFIG_MISSING");
});

test("providerenvironmentclassificationerrormodel", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };

  const { readiness, error } = capability.checkReadiness(state);
  assert.strictEqual(readiness, "DEGRADED");
  assert.strictEqual(error?.kind, "VALIDATION_FAILED");
});

test("providerenvironmentclassificationpermissions", () => {
  const entry = { provider: "p1", mode: "hermetic-mock", environment: "live" } as const;
  const validationError = capability.validateClassificationEntry(entry);
  assert.notStrictEqual(validationError, null);
  assert.strictEqual(validationError?.kind, "VALIDATION_FAILED");

  const prodShapedLive = { provider: "p2", mode: "production-shaped", environment: "live" } as const;
  const prodShapedLiveError = capability.validateClassificationEntry(prodShapedLive);
  assert.notStrictEqual(prodShapedLiveError, null);
  assert.strictEqual(prodShapedLiveError?.kind, "VALIDATION_FAILED");

  const prodLiveNonLive = { provider: "p3", mode: "production-live", environment: "test" } as const;
  const prodLiveNonLiveError = capability.validateClassificationEntry(prodLiveNonLive);
  assert.notStrictEqual(prodLiveNonLiveError, null);
  assert.strictEqual(prodLiveNonLiveError?.kind, "VALIDATION_FAILED");
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

  const emptyState: capability.ProviderClassificationState = {
    classifications: [],
    lastError: null,
  };
  const emptyProof = capability.generateProof(emptyState);
  assert.strictEqual(emptyProof.status, "PENDING");
});

test("providerenvironmentclassificationreadinessmodel", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
    ],
    lastError: null,
  };

  const { readiness, error } = capability.checkReadiness(state);
  assert.strictEqual(readiness, "READY");
  assert.strictEqual(error, null);

  const invalidState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };
  const { readiness: invalidReadiness } = capability.checkReadiness(invalidState);
  assert.strictEqual(invalidReadiness, "DEGRADED");
});

test("providerenvironmentclassificationvalidation", () => {
  const validEntry = { provider: "p1", mode: "production-live", environment: "live" } as const;
  const validError = capability.validateClassificationEntry(validEntry);
  assert.strictEqual(validError, null);

  const invalidEntry = { provider: "p1", mode: "hermetic-mock", environment: "live" } as const;
  const invalidError = capability.validateClassificationEntry(invalidEntry);
  assert.notStrictEqual(invalidError, null);
  assert.strictEqual(invalidError?.kind, "VALIDATION_FAILED");

  const duplicateState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
      { provider: "p1", mode: "production-shaped", environment: "external" } as const,
    ],
    lastError: null,
  };
  const matrixError = capability.validateClassificationMatrix(duplicateState.classifications);
  assert.notStrictEqual(matrixError, null);
  assert.strictEqual(matrixError?.kind, "VALIDATION_FAILED");
});