import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/foundation/providerenvironmentclassification.ts";

test("providerenvironmentclassificationauditmodel", () => {
  const auditFn = (event: capability.ClassificationAuditEvent): capability.ClassificationError | null => {
    assert.strictEqual(event.kind, "CLASSIFICATION_CHANGE");
    assert.strictEqual(event.provider, "audit-test");
    assert.strictEqual(event.mode, "hermetic-mock");
    assert.strictEqual(event.environment, "test");
    assert.ok(event.timestamp);
    return null;
  };

  const auditResult = capability.auditClassificationChange(
    "audit-test",
    "hermetic-mock",
    "test",
    auditFn,
  );
  assert.strictEqual(auditResult, null);

  const degradedState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "pX", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };

  const { readiness, error } = capability.checkReadiness(degradedState);
  assert.strictEqual(readiness, "DEGRADED");
  assert.strictEqual(error?.kind, "VALIDATION_FAILED");
});

test("providerenvironmentclassificationcontracts", () => {
  const state: capability.ProviderClassificationState = {
    classifications: [
      { provider: "p1", mode: "production-live", environment: "live" } as const,
      { provider: "p2", mode: "production-shaped", environment: "external" } as const,
    ],
    lastError: null,
  };

  const result = capability.getEnvironmentClassificationMatrix(state);
  assert.deepStrictEqual(result.error, null);
  assert.deepStrictEqual(result.matrix["p1"], { mode: "production-live", environment: "live" });
  assert.deepStrictEqual(result.matrix["p2"], { mode: "production-shaped", environment: "external" });

  const emptyState: capability.ProviderClassificationState = {
    classifications: [],
    lastError: null,
  };
  const emptyResult = capability.getEnvironmentClassificationMatrix(emptyState);
  assert.notStrictEqual(emptyResult.error, null);
  assert.strictEqual(emptyResult.error?.kind, "CONFIG_MISSING");
});

test("providerenvironmentclassificationerrormodel", () => {
  const invalidState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "bad", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };

  const { readiness, error } = capability.checkReadiness(invalidState);
  assert.strictEqual(readiness, "DEGRADED");
  assert.strictEqual(error?.kind, "VALIDATION_FAILED");
});

test("providerenvironmentclassificationpermissions", () => {
  const illegalEntry = { provider: "p1", mode: "hermetic-mock", environment: "live" } as const;
  const err1 = capability.validateClassificationEntry(illegalEntry);
  assert.notStrictEqual(err1, null);
  assert.strictEqual(err1?.kind, "VALIDATION_FAILED");

  const prodShapedLive = { provider: "p2", mode: "production-shaped", environment: "live" } as const;
  const err2 = capability.validateClassificationEntry(prodShapedLive);
  assert.notStrictEqual(err2, null);
  assert.strictEqual(err2?.kind, "VALIDATION_FAILED");

  const prodLiveNonLive = { provider: "p3", mode: "production-live", environment: "test" } as const;
  const err3 = capability.validateClassificationEntry(prodLiveNonLive);
  assert.notStrictEqual(err3, null);
  assert.strictEqual(err3?.kind, "VALIDATION_FAILED");
});

test("providerenvironmentclassificationproof", () => {
  // Valid proof
  const goodState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "good", mode: "production-live", environment: "live" } as const,
    ],
    lastError: null,
  };
  const goodProof = capability.generateProof(goodState);
  assert.strictEqual(goodProof.status, "VALID");

  // Pending proof (no classifications)
  const emptyState: capability.ProviderClassificationState = {
    classifications: [],
    lastError: null,
  };
  const pendingProof = capability.generateProof(emptyState);
  assert.strictEqual(pendingProof.status, "PENDING");
  assert.ok(pendingProof.details?.includes("No classifications"));

  // Invalid proof (validation failure)
  const badState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "bad", mode: "hermetic-mock", environment: "live" } as const,
    ],
    lastError: null,
  };
  const invalidProof = capability.generateProof(badState);
  assert.strictEqual(invalidProof.status, "INVALID");
  assert.ok(invalidProof.details?.includes("Invalid classification"));
});

test("providerenvironmentclassificationreadinessmodel", () => {
  const readyState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "ready", mode: "production-live", environment: "live" } as const,
    ],
    lastError: null,
  };
  const ready = capability.checkReadiness(readyState);
  assert.strictEqual(ready.readiness, "READY");
  assert.strictEqual(ready.error, null);

  const missingState: capability.ProviderClassificationState = {
    classifications: [],
    lastError: null,
  };
  const missing = capability.checkReadiness(missingState);
  assert.strictEqual(missing.readiness, "DEGRADED");
  assert.strictEqual(missing.error?.kind, "CONFIG_MISSING");
});

test("providerenvironmentclassificationvalidation", () => {
  const validEntry: capability.ProviderClassification = {
    provider: "ok",
    mode: "production-live",
    environment: "live",
  } as const;
  const validError = capability.validateClassificationEntry(validEntry);
  assert.strictEqual(validError, null);

  const invalidEntry: capability.ProviderClassification = {
    provider: "ok",
    mode: "hermetic-mock",
    environment: "live",
  } as const;
  const invalidError = capability.validateClassificationEntry(invalidEntry);
  assert.notStrictEqual(invalidError, null);
  assert.strictEqual(invalidError?.kind, "VALIDATION_FAILED");

  const dupState: capability.ProviderClassificationState = {
    classifications: [
      { provider: "dup", mode: "production-live", environment: "live" } as const,
      { provider: "dup", mode: "production-shaped", environment: "external" } as const,
    ],
    lastError: null,
  };
  const dupError = capability.validateClassificationMatrix(dupState.classifications);
  assert.notStrictEqual(dupError, null);
  assert.strictEqual(dupError?.kind, "VALIDATION_FAILED");
});