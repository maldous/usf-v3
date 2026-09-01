import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/foundation/environmentspecificvssharedservicemodel.ts";

test("environmentspecificvssharedservicemodelauditmodel", () => {
  const auditFn = (event: capability.EnvironmentServiceClassificationAuditEvent): null => null;
  let state = capability.initialState;
  
  state = capability.classifyService(state, "svc1", "ENVIRONMENT_SPECIFIC", auditFn) as capability.EnvironmentServiceClassificationState;
  state = capability.classifyService(state, "svc1", "SHARED", auditFn) as capability.EnvironmentServiceClassificationState;

  const events = capability.getAuditEvents(state);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "CLASSIFICATION_CHANGE");
  assert.strictEqual(events[0].service, "svc1");
  assert.strictEqual(events[0].previousClassification, "ENVIRONMENT_SPECIFIC");
  assert.strictEqual(events[0].newClassification, "SHARED");

  assert.strictEqual(state.readiness, "NOT_READY");
  assert.strictEqual(capability.getReadiness(state), "NOT_READY");
});

test("environmentspecificvssharedservicemodelcontracts", () => {
  const missing = capability.readClassification(capability.initialState, "svc1");
  if ("kind" in missing) {
    assert.strictEqual(missing.kind, "MISSING_CLASSIFICATION");
    assert.strictEqual(missing.service, "svc1");
  } else {
    assert.fail("Expected error for missing classification");
  }

  const invalid = capability.classifyService(capability.initialState, "svc1", "INVALID" as capability.EnvironmentServiceClassification, () => null);
  if ("kind" in invalid) {
    assert.strictEqual(invalid.kind, "INVALID_CLASSIFICATION");
    assert.strictEqual(invalid.service, "svc1");
  } else {
    assert.fail("Expected error for invalid classification");
  }

  const classifiedState = capability.classifyService(capability.initialState, "svc1", "SHARED", () => null) as capability.EnvironmentServiceClassificationState;
  const found = capability.readClassification(classifiedState, "svc1");
  if ("classification" in found) {
    assert.strictEqual(found.service, "svc1");
    assert.strictEqual(found.classification, "SHARED");
  } else {
    assert.fail("Expected ServiceClassification");
  }
});

test("environmentspecificvssharedservicemodelerrormodel", () => {
  const providerFailureError: capability.EnvironmentServiceClassificationError = {
    kind: 'PROVIDER_FAILURE',
    message: 'Provider rejected classification',
    service: 'svc1'
  };

  const auditFn = (event: capability.EnvironmentServiceClassificationAuditEvent) => providerFailureError;

  let state = capability.initialState;
  const result = capability.classifyService(state, "svc1", "SHARED", auditFn);

  if ("kind" in result) {
    assert.strictEqual(result.kind, 'PROVIDER_FAILURE');
    assert.strictEqual(result.service, 'svc1');
  } else {
    assert.fail("Expected provider failure error");
  }

  assert.strictEqual(state.classifications.length, 0);
  assert.strictEqual(state.lastAuditEvent, null);
  assert.strictEqual(state.lastError, null);

  assert.strictEqual(capability.getReadiness(state), 'NOT_READY');
  assert.deepStrictEqual(capability.getAuditEvents(state), []);

  const inconsistentState: capability.EnvironmentServiceClassificationState = {
    classifications: [
      { service: "svc1", classification: "SHARED" },
      { service: "svc1", classification: "ENVIRONMENT_SPECIFIC" }
    ],
    lastAuditEvent: null,
    lastError: null,
    readiness: "NOT_READY",
  };
  const validationError = capability.validateClassifications(inconsistentState);
  assert(validationError !== null);
  assert.strictEqual(validationError.kind, 'INCONSISTENT_CLASSIFICATION');
});

test("environmentspecificvssharedservicemodelpermissions", () => {
  const invalid = capability.classifyService(capability.initialState, "svc1", "INVALID" as capability.EnvironmentServiceClassification, () => null);
  if ("kind" in invalid) {
    assert.strictEqual(invalid.kind, 'INVALID_CLASSIFICATION');
  } else {
    assert.fail("Expected error");
  }

  const state1 = capability.classifyService(capability.initialState, "svc1", "SHARED", () => null) as capability.EnvironmentServiceClassificationState;
  const state2 = capability.classifyService(state1, "svc2", "ENVIRONMENT_SPECIFIC", () => null) as capability.EnvironmentServiceClassificationState;

  const found1 = capability.readClassification(state2, "svc1");
  if ("classification" in found1) {
    assert.strictEqual(found1.classification, "SHARED");
  } else {
    assert.fail("Expected ServiceClassification");
  }
  const found2 = capability.readClassification(state2, "svc2");
  if ("classification" in found2) {
    assert.strictEqual(found2.classification, "ENVIRONMENT_SPECIFIC");
  } else {
    assert.fail("Expected ServiceClassification");
  }

  const duplicateState: capability.EnvironmentServiceClassificationState = {
    classifications: [
      { service: "svc1", classification: "SHARED" },
      { service: "svc1", classification: "ENVIRONMENT_SPECIFIC" }
    ],
    lastAuditEvent: null,
    lastError: null,
    readiness: "NOT_READY",
  };
  const error = capability.validateClassifications(duplicateState);
  if (error) {
    assert.strictEqual(error.kind, 'INCONSISTENT_CLASSIFICATION');
  } else {
    assert.fail("Expected error");
  }
});

test("environmentspecificvssharedservicemodelproof", () => {
  const state = capability.classifyService(capability.initialState, "svc1", "SHARED", () => null) as capability.EnvironmentServiceClassificationState;
  const proof = capability.generateProof(state);
  if ("document" in proof) {
    assert.deepStrictEqual(proof.document, [{ service: "svc1", classification: "SHARED" }]);
    assert.deepStrictEqual(proof.checks, [
      'all-classifications-valid',
      'no-duplicate-services',
      'no-missing-classifications',
    ]);
  } else {
    assert.fail("Expected proof document");
  }

  const state2 = capability.classifyService(state, "svc2", "ENVIRONMENT_SPECIFIC", () => null) as capability.EnvironmentServiceClassificationState;
  const proof2 = capability.generateProof(state2);
  if ("document" in proof2) {
    assert.strictEqual(proof2.document.length, 2);
  } else {
    assert.fail("Expected proof for valid state");
  }
});

test("environmentspecificvssharedservicemodelreadinessmodel", () => {
  const validState = capability.classifyService(capability.initialState, "svc1", "SHARED", () => null) as capability.EnvironmentServiceClassificationState;
  assert.strictEqual(capability.checkReadiness(validState), "READY");

  assert.strictEqual(capability.checkReadiness(capability.initialState), "NOT_READY");

  const inconsistentState: capability.EnvironmentServiceClassificationState = {
    classifications: [
      { service: "svc1", classification: "SHARED" },
      { service: "svc1", classification: "ENVIRONMENT_SPECIFIC" }
    ],
    lastAuditEvent: null,
    lastError: null,
    readiness: "NOT_READY",
  };
  assert.strictEqual(capability.checkReadiness(inconsistentState), "NOT_READY");
});

test("environmentspecificvssharedservicemodelvalidation", () => {
  const validState = capability.classifyService(capability.initialState, "svc1", "SHARED", () => null) as capability.EnvironmentServiceClassificationState;
  assert.strictEqual(capability.validateClassifications(validState), null);

  const invalidState: capability.EnvironmentServiceClassificationState = {
    classifications: [
      { service: "svc1", classification: "INVALID" as capability.EnvironmentServiceClassification }
    ],
    lastAuditEvent: null,
    lastError: null,
    readiness: "NOT_READY",
  };
  const invalidError = capability.validateClassifications(invalidState);
  if (invalidError) {
    assert.strictEqual(invalidError.kind, 'INVALID_CLASSIFICATION');
    assert.strictEqual(invalidError.service, 'svc1');
  } else {
    assert.fail("Expected validation error for invalid classification");
  }

  const duplicateState: capability.EnvironmentServiceClassificationState = {
    classifications: [
      { service: "svc1", classification: "SHARED" },
      { service: "svc1", classification: "ENVIRONMENT_SPECIFIC" }
    ],
    lastAuditEvent: null,
    lastError: null,
    readiness: "NOT_READY",
  };
  const duplicateError = capability.validateClassifications(duplicateState);
  if (duplicateError) {
    assert.strictEqual(duplicateError.kind, 'INCONSISTENT_CLASSIFICATION');
    assert.strictEqual(duplicateError.service, 'svc1');
  } else {
    assert.fail("Expected validation error for duplicate service");
  }
});