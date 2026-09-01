import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/foundation/environmentspecificvssharedservicemodel.ts";

test("environmentspecificvssharedservicemodelauditmodel", () => {
  const auditEvents: capability.EnvironmentServiceClassificationAuditEvent[] = [];
  const auditFn = (event: capability.EnvironmentServiceClassificationAuditEvent): capability.EnvironmentServiceClassificationError | null => {
    auditEvents.push(event);
    return null;
  };

  let state = capability.initialState;
  state = capability.classifyService(state, "svc1", "ENVIRONMENT_SPECIFIC", auditFn) as capability.EnvironmentServiceClassificationState;
  state = capability.classifyService(state, "svc1", "SHARED", auditFn) as capability.EnvironmentServiceClassificationState;

  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[0].kind, "CLASSIFICATION_CHANGE");
  assert.strictEqual(auditEvents[0].service, "svc1");
  assert.strictEqual(auditEvents[0].previousClassification, null);
  assert.strictEqual(auditEvents[0].newClassification, "ENVIRONMENT_SPECIFIC");

  assert.strictEqual(auditEvents[1].kind, "CLASSIFICATION_CHANGE");
  assert.strictEqual(auditEvents[1].service, "svc1");
  assert.strictEqual(auditEvents[1].previousClassification, "ENVIRONMENT_SPECIFIC");
  assert.strictEqual(auditEvents[1].newClassification, "SHARED");

  state = capability.providerFailure(state, "Simulated failure");
  const readiness = capability.checkReadiness(state);
  assert.strictEqual(readiness.readiness, "DEGRADED");
  assert.strictEqual(state.lastAuditEvent?.kind, "CLASSIFICATION_CHANGE");
});

test("environmentspecificvssharedservicemodelcontracts", () => {
  const state = capability.initialState;
  const result = capability.getClassification(state, "unknown");
  assert.strictEqual(result.kind, "MISSING_CLASSIFICATION");
  assert.strictEqual(result.service, "unknown");

  const classifiedState = capability.classifyService(
    state,
    "svc1",
    "SHARED",
    () => null
  ) as capability.EnvironmentServiceClassificationState;
  const found = capability.getClassification(classifiedState, "svc1");
  assert.strictEqual(found.kind, "FOUND");
  assert.strictEqual(found.classification, "SHARED");
});

test("environmentspecificvssharedservicemodelerrormodel", () => {
  const state = capability.initialState;
  const degradedState = capability.providerFailure(state, "Provider down");
  assert.strictEqual(degradedState.readiness, "DEGRADED");
  assert.strictEqual(degradedState.lastError?.kind, "PROVIDER_FAILURE");
  assert.strictEqual(degradedState.lastError?.message, "Provider down");

  const readiness = capability.checkReadiness(degradedState);
  assert.strictEqual(readiness.readiness, "DEGRADED");
  assert.strictEqual(readiness.error?.kind, "PROVIDER_FAILURE");

  const proof = capability.pendingProof(degradedState, () => null);
  assert.strictEqual(proof.pending, true);
  assert.strictEqual(proof.error?.kind, "PROVIDER_FAILURE");
});

test("environmentspecificvssharedservicemodelpermissions", () => {
  const state = capability.initialState;
  const classifiedState = capability.classifyService(
    state,
    "svc1",
    "ENVIRONMENT_SPECIFIC",
    () => null
  ) as capability.EnvironmentServiceClassificationState;

  const classification = capability.getClassification(classifiedState, "svc1");
  assert.strictEqual(classification.kind, "FOUND");
  assert.strictEqual(classification.classification, "ENVIRONMENT_SPECIFIC");

  const validationError = capability.validateClassifications(classifiedState);
  assert.strictEqual(validationError, null);
});

test("environmentspecificvssharedservicemodelproof", () => {
  const auditEvents: capability.EnvironmentServiceClassificationAuditEvent[] = [];
  const auditFn = (event: capability.EnvironmentServiceClassificationAuditEvent): capability.EnvironmentServiceClassificationError | null => {
    auditEvents.push(event);
    return null;
  };

  let state = capability.initialState;
  state = capability.classifyService(state, "svc1", "SHARED", () => null) as capability.EnvironmentServiceClassificationState;

  const proofResult = capability.generateProof(state, auditFn);
  assert.deepStrictEqual(proofResult.proof, [{ service: "svc1", classification: "SHARED" }]);
  assert.strictEqual(proofResult.error, null);
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "PROOF_GENERATED");

  const pendingResult = capability.pendingProof(state, auditFn);
  assert.deepStrictEqual(pendingResult.proof, [{ service: "svc1", classification: "SHARED" }]);
  assert.strictEqual(pendingResult.pending, true);
  assert.strictEqual(pendingResult.error, null);
});

test("environmentspecificvssharedservicemodelreadinessmodel", () => {
  const state = capability.initialState;
  const readiness = capability.checkReadiness(state);
  assert.strictEqual(readiness.readiness, "NOT_READY");
  assert.strictEqual(readiness.error?.kind, "MISSING_CLASSIFICATION");

  const classifiedState = capability.classifyService(
    state,
    "svc1",
    "ENVIRONMENT_SPECIFIC",
    () => null
  ) as capability.EnvironmentServiceClassificationState;
  const readyReadiness = capability.checkReadiness(classifiedState);
  assert.strictEqual(readyReadiness.readiness, "READY");
  assert.strictEqual(readyReadiness.error, null);
});

test("environmentspecificvssharedservicemodelvalidation", () => {
  const state = capability.initialState;
  const classifiedState = capability.classifyService(
    state,
    "svc1",
    "SHARED",
    () => null
  ) as capability.EnvironmentServiceClassificationState;

  const validationError = capability.validateClassifications(classifiedState);
  assert.strictEqual(validationError, null);

  const invalidState: capability.EnvironmentServiceClassificationState = {
    ...classifiedState,
    classifications: [
      { service: "svc1", classification: "SHARED" },
      { service: "svc1", classification: "ENVIRONMENT_SPECIFIC" }
    ],
    lastAuditEvent: null,
    lastError: null,
    readiness: "NOT_READY",
  };
  const duplicateError = capability.validateClassifications(invalidState);
  assert.strictEqual(duplicateError?.kind, "INCONSISTENT_CLASSIFICATION");
  assert.strictEqual(duplicateError?.service, "svc1");

  const badClassificationState: capability.EnvironmentServiceClassificationState = {
    ...classifiedState,
    classifications: [
      { service: "svc1", classification: "INVALID" as capability.EnvironmentServiceClassification }
    ],
    lastAuditEvent: null,
    lastError: null,
    readiness: "NOT_READY",
  };
  const invalidClassificationError = capability.validateClassifications(badClassificationState);
  assert.strictEqual(invalidClassificationError?.kind, "INVALID_CLASSIFICATION");
});