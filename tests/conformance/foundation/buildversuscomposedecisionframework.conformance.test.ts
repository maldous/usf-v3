import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/foundation/buildversuscomposedecisionframework.ts";

test("buildversuscomposedecisionframeworkauditmodel", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Initial decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const state0 = capability.initialState;

  const result1 = capability.initializeFramework(state0, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  if (result1.kind !== "SUCCESS") throw new Error("initializeFramework should succeed");
  const state1 = result1.state;

  const result2 = capability.createDecision(
    state1,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  if (result2.kind !== "SUCCESS") throw new Error("createDecision should succeed");
  const state2 = result2.state;
  assert.strictEqual(state2.auditTrail.length, 2, "Audit trail should contain init and creation events");
  assert.strictEqual(state2.auditTrail[0].kind, "DECISION_CREATED", "First event kind should be DECISION_CREATED");
  assert.strictEqual(state2.auditTrail[1].kind, "DECISION_CREATED", "Second event kind should be DECISION_CREATED");
  assert.strictEqual(state2.proofDocument?.proofRun, true, "Proof should be re-run after creation");

  const result3 = capability.reviseDecision(
    state2,
    "cap1",
    capability.BuildVersusComposeDecision[1],
    { ...justification, rationale: "Revised decision" },
    "architect",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  if (result3.kind !== "SUCCESS") throw new Error("reviseDecision should succeed");
  const state3 = result3.state;
  assert.strictEqual(state3.auditTrail.length, 3, "Audit trail should contain three events");
  assert.strictEqual(state3.auditTrail[2].kind, "DECISION_REVISED", "Third event kind should be DECISION_REVISED");
  assert.strictEqual(state3.proofDocument?.proofRun, true, "Proof should be re-run after revision");
  assert.strictEqual(capability.getAuditTrail(state3).length, 3, "getAuditTrail should return the audit trail");

  const result4 = capability.supersedeDecision(state3, "cap1", "architect", auditFn, "2023-01-01T00:03:00Z");
  if (result4.kind !== "SUCCESS") throw new Error("supersedeDecision should succeed");
  const state4 = result4.state;
  assert.strictEqual(state4.auditTrail.length, 4, "Audit trail should contain four events");
  assert.strictEqual(state4.auditTrail[3].kind, "DECISION_SUPERSEDED", "Fourth event kind should be DECISION_SUPERSEDED");
  assert.strictEqual(state4.proofDocument?.proofRun, true, "Proof should be re-run after supersede");

  const result5 = capability.rollbackDecision(state4, "cap1", "architect", auditFn, "2023-01-01T00:04:00Z");
  if (result5.kind !== "SUCCESS") throw new Error("rollbackDecision should succeed");
  const state5 = result5.state;
  assert.strictEqual(state5.auditTrail.length, 5, "Audit trail should contain five events");
  assert.strictEqual(state5.auditTrail[4].kind, "DECISION_ROLLED_BACK", "Fifth event kind should be DECISION_ROLLED_BACK");
  assert.strictEqual(state5.proofDocument?.proofRun, true, "Proof should be re-run after rollback");
});

test("buildversuscomposedecisionframeworkerrormodel", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const initResult = capability.initializeFramework(capability.initialState, ["cap1"], ["architect"], () => null, "2023-01-01T00:00:00Z");
  if (initResult.kind !== "SUCCESS") throw new Error("initializeFramework should succeed");
  const state0 = initResult.state;

  const error1 = capability.createDecision(
    state0,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    { criteria: { COST: "", CONTROL: "high", READINESS: "immediate" }, rationale: "Invalid" },
    "architect",
    () => null,
    "2023-01-01T00:00:00Z"
  );
  assert.notStrictEqual(error1.kind, "SUCCESS", "Invalid justification should return error");
  if (error1.kind === "SUCCESS") throw new Error("Expected error");
  assert.strictEqual(error1.kind, "JUSTIFICATION_MISSING", "Error kind should be JUSTIFICATION_MISSING");

  const create1 = capability.createDecision(state0, "cap1", capability.BuildVersusComposeDecision[0], justification, "architect", () => null, "2023-01-01T00:00:00Z");
  if (create1.kind !== "SUCCESS") throw new Error("Valid decision should succeed");
  const state1 = create1.state;

  const error2 = capability.createDecision(
    state1,
    "cap1",
    capability.BuildVersusComposeDecision[1],
    justification,
    "architect",
    () => null,
    "2023-01-01T00:01:00Z"
  );
  assert.notStrictEqual(error2.kind, "SUCCESS", "Duplicate active decision should return error");
  if (error2.kind === "SUCCESS") throw new Error("Expected error");
  assert.strictEqual(error2.kind, "CONTRADICTION_DETECTED", "Error kind should be CONTRADICTION_DETECTED");

  const failingAudit: capability.BuildVersusComposeError = { kind: "DEPENDENCY_UNAVAILABLE", message: "audit down" };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => failingAudit;
  const error3 = capability.createDecision(
    state0,
    "cap2",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  assert.notStrictEqual(error3.kind, "SUCCESS", "Failing audit dependency should return error");
  if (error3.kind === "SUCCESS") throw new Error("Expected error");
  assert.strictEqual(error3.kind, "DEPENDENCY_UNAVAILABLE", "Error kind should be DEPENDENCY_UNAVAILABLE");

  const initResult2 = capability.initializeFramework(capability.initialState, ["cap1", "cap2"], ["architect"], () => null, "2023-01-01T00:00:00Z");
  if (initResult2.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state2 = initResult2.state;
  const error4 = capability.validateFramework(state2);
  assert.ok(error4 !== null, "Validation should fail without decisions");
  if (error4 === null) throw new Error("Expected error");
  assert.strictEqual(error4.kind, "SEMANTIC_DRIFT", "Error kind should be SEMANTIC_DRIFT");
});

test("buildversuscomposedecisionframeworklifecycle", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Initial decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const initResult = capability.initializeFramework(capability.initialState, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  if (initResult.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state1 = initResult.state;

  const result2 = capability.createDecision(
    state1,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  if (result2.kind !== "SUCCESS") throw new Error("Create decision should succeed");
  const state2 = result2.state;
  assert.strictEqual(state2.decisionRecords.length, 1, "Should have one decision record");
  assert.strictEqual(state2.decisionRecords[0].decision, "BUILD", "Decision should be BUILD");
  assert.strictEqual(state2.proofDocument?.proofRun, true, "Proof should be run after creation");

  const result3 = capability.reviseDecision(
    state2,
    "cap1",
    capability.BuildVersusComposeDecision[1],
    { ...justification, rationale: "Revised rationale" },
    "architect",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  if (result3.kind !== "SUCCESS") throw new Error("Revise decision should succeed");
  const state3 = result3.state;
  assert.strictEqual(state3.decisionRecords.length, 2, "Should have two decision records after revision");
  const activeAfterRevise = state3.decisionRecords.find(r => r.supersededBy === null);
  assert.ok(activeAfterRevise !== undefined, "Should have an active decision");
  assert.strictEqual(activeAfterRevise!.decision, "COMPOSE", "Active decision should be COMPOSE");
  assert.strictEqual(state3.proofDocument?.proofRun, true, "Proof should be re-run after revision");

  const result4 = capability.supersedeDecision(state3, "cap1", "architect", auditFn, "2023-01-01T00:03:00Z");
  if (result4.kind !== "SUCCESS") throw new Error("Supersede decision should succeed");
  const state4 = result4.state;
  assert.strictEqual(state4.decisionRecords.length, 3, "Should have three decision records after supersede");
  assert.strictEqual(state4.proofDocument?.proofRun, true, "Proof should be re-run after supersede");

  const result5 = capability.rollbackDecision(state4, "cap1", "architect", auditFn, "2023-01-01T00:04:00Z");
  if (result5.kind !== "SUCCESS") throw new Error("Rollback decision should succeed");
  const state5 = result5.state;
  assert.strictEqual(
    state5.decisionRecords.filter(r => r.supersededBy === null).length,
    1,
    "Should have one active decision after rollback"
  );
  const activeAfterRollback = state5.decisionRecords.find(r => r.supersededBy === null);
  assert.ok(activeAfterRollback !== undefined, "Should have an active decision");
  assert.strictEqual(activeAfterRollback!.decision, "COMPOSE", "Active decision should be COMPOSE after rollback");
  assert.strictEqual(state5.proofDocument?.proofRun, true, "Proof should be re-run after rollback");
});

test("buildversuscomposedecisionframeworkpermissions", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const initResult = capability.initializeFramework(capability.initialState, ["cap1"], ["architect", "reviewer"], auditFn, "2023-01-01T00:00:00Z");
  if (initResult.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state1 = initResult.state;

  const result2 = capability.createDecision(
    state1,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  if (result2.kind !== "SUCCESS") throw new Error("Create decision with valid authority should succeed");

  const error = capability.createDecision(
    state1,
    "cap2",
    capability.BuildVersusComposeDecision[1],
    justification,
    "invalid-authority",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  assert.notStrictEqual(error.kind, "SUCCESS", "Create decision with invalid authority should fail");
  if (error.kind === "SUCCESS") throw new Error("Expected error");
  assert.strictEqual(error.kind, "AUTHORITY_VIOLATION", "Error kind should be AUTHORITY_VIOLATION");
});

test("buildversuscomposedecisionframeworkproof", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const initResult = capability.initializeFramework(capability.initialState, ["cap1", "cap2"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  if (initResult.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state1 = initResult.state;

  const result2 = capability.createDecision(
    state1,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  if (result2.kind !== "SUCCESS") throw new Error("Create decision should succeed");
  const state2 = result2.state;

  const result3 = capability.createDecision(
    state2,
    "cap2",
    capability.BuildVersusComposeDecision[1],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  if (result3.kind !== "SUCCESS") throw new Error("Create second decision should succeed");
  const state3 = result3.state;
  const proof = capability.getProofDocument(state3);
  assert.ok(proof !== null, "Proof document should exist");
  if (proof === null) throw new Error("Proof document should exist");
  assert.strictEqual(proof.consistencyCheck, true, "Consistency check should pass");
  assert.strictEqual(proof.decisionRecords.length, 2, "Proof should contain both decisions");
  assert.strictEqual(proof.authorityOrder.length, 1, "Proof should contain authority order");
  assert.strictEqual(proof.proofRun, true, "Proof should be marked as run");
});

test("buildversuscomposedecisionframeworkreadinessmodel", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  assert.strictEqual(capability.getReadiness(capability.initialState), "NOT_READY", "Initial state should be NOT_READY");

  const result1 = capability.initializeFramework(capability.initialState, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  if (result1.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state1 = result1.state;
  assert.strictEqual(capability.getReadiness(state1), "NOT_READY", "State without decisions should be NOT_READY");

  const result2 = capability.createDecision(
    state1,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  if (result2.kind !== "SUCCESS") throw new Error("Create decision should succeed");
  const state2 = result2.state;
  assert.strictEqual(capability.getReadiness(state2), "READY", "State with all capabilities decided should be READY");

  const result3 = capability.initializeFramework(capability.initialState, ["cap1", "cap2"], ["architect"], auditFn, "2023-01-01T00:02:00Z");
  if (result3.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state3 = result3.state;
  const result4 = capability.createDecision(
    state3,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:03:00Z"
  );
  if (result4.kind !== "SUCCESS") throw new Error("Create decision should succeed");
  const state4 = result4.state;
  assert.strictEqual(capability.getReadiness(state4), "NOT_READY", "State with missing capability decision should be NOT_READY");
});

test("buildversuscomposedecisionframeworkvalidation", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Valid decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const result1 = capability.initializeFramework(capability.initialState, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  if (result1.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state1 = result1.state;

  const result2 = capability.createDecision(
    state1,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  if (result2.kind !== "SUCCESS") throw new Error("Create decision should succeed");
  const state2 = result2.state;
  const validation1 = capability.validateFramework(state2);
  assert.strictEqual(validation1, null, "Valid framework should pass validation");

  const result3 = capability.initializeFramework(capability.initialState, ["cap1", "cap2"], ["architect"], auditFn, "2023-01-01T00:02:00Z");
  if (result3.kind !== "SUCCESS") throw new Error("Initialization should succeed");
  const state3 = result3.state;
  const result4 = capability.createDecision(
    state3,
    "cap1",
    capability.BuildVersusComposeDecision[0],
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:03:00Z"
  );
  if (result4.kind !== "SUCCESS") throw new Error("Create decision should succeed");
  const state4 = result4.state;
  const validation2 = capability.validateFramework(state4);
  assert.ok(validation2 !== null, "Framework with missing capability should fail validation");
  if (validation2 === null) throw new Error("Expected error");
  assert.strictEqual(validation2.kind, "SEMANTIC_DRIFT", "Error kind should be SEMANTIC_DRIFT");

  const error = capability.createDecision(
    state1,
    "cap2",
    capability.BuildVersusComposeDecision[1],
    { criteria: { COST: "low", CONTROL: "high", READINESS: "" }, rationale: "Invalid" },
    "architect",
    auditFn,
    "2023-01-01T00:04:00Z"
  );
  assert.notStrictEqual(error.kind, "SUCCESS", "Invalid justification should return error");
  if (error.kind === "SUCCESS") throw new Error("Expected error");
  assert.strictEqual(error.kind, "JUSTIFICATION_MISSING", "Error kind should be JUSTIFICATION_MISSING");
});