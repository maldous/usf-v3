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
  const state1 = capability.createDecision(
    state0,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:00:00Z"
  );
  assert.ok(!("kind" in state1), "createDecision should succeed");
  if ("kind" in state1) throw new Error("Unexpected error");
  assert.strictEqual(state1.auditTrail.length, 1, "Audit trail should contain creation event");
  assert.strictEqual(state1.auditTrail[0].kind, "DECISION_CREATED", "Event kind should be DECISION_CREATED");
  assert.strictEqual(state1.proofDocument?.proofRun, true, "Proof should be re-run after creation");

  const state2 = capability.reviseDecision(
    state1,
    "cap1",
    "COMPOSE",
    { ...justification, rationale: "Revised decision" },
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  assert.ok(!("kind" in state2), "reviseDecision should succeed");
  if ("kind" in state2) throw new Error("Unexpected error");
  assert.strictEqual(state2.auditTrail.length, 2, "Audit trail should contain both events");
  assert.strictEqual(state2.auditTrail[1].kind, "DECISION_REVISED", "Second event kind should be DECISION_REVISED");
  assert.strictEqual(state2.proofDocument?.proofRun, true, "Proof should be re-run after revision");
});

test("buildversuscomposedecisionframeworkerrormodel", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const state0 = capability.initialState;
  const error1 = capability.createDecision(
    state0,
    "cap1",
    "BUILD",
    { criteria: { COST: "", CONTROL: "high", READINESS: "immediate" }, rationale: "Invalid" } as capability.DecisionJustification,
    "architect",
    auditFn,
    "2023-01-01T00:00:00Z"
  );
  assert.ok("kind" in error1, "Invalid justification should return error");
  assert.strictEqual(error1.kind, "JUSTIFICATION_MISSING", "Error kind should be JUSTIFICATION_MISSING");

  const state1 = capability.createDecision(state0, "cap1", "BUILD", justification, "architect", auditFn, "2023-01-01T00:00:00Z");
  assert.ok(!("kind" in state1), "Valid decision should succeed");
  if ("kind" in state1) throw new Error("Unexpected error");
  const error2 = capability.createDecision(
    state1,
    "cap1",
    "COMPOSE",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  assert.ok("kind" in error2, "Duplicate active decision should return error");
  assert.strictEqual(error2.kind, "CONTRADICTION_DETECTED", "Error kind should be CONTRADICTION_DETECTED");

  const state2 = capability.initializeFramework(state0, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  assert.ok(!("kind" in state2), "Initialization should succeed");
  if ("kind" in state2) throw new Error("Unexpected error");
  const error3 = capability.validateFramework(state2);
  assert.ok(error3 !== null, "Validation should fail without decisions");
  assert.strictEqual(error3?.kind, "SEMANTIC_DRIFT", "Error kind should be SEMANTIC_DRIFT");
});

test("buildversuscomposedecisionframeworklifecycle", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Initial decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const state0 = capability.initialState;
  const state1 = capability.initializeFramework(state0, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  assert.ok(!("kind" in state1), "Initialization should succeed");
  if ("kind" in state1) throw new Error("Unexpected error");

  const state2 = capability.createDecision(
    state1,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  assert.ok(!("kind" in state2), "Create decision should succeed");
  if ("kind" in state2) throw new Error("Unexpected error");
  assert.strictEqual(state2.decisionRecords.length, 1, "Should have one decision record");
  assert.strictEqual(state2.decisionRecords[0].decision, "BUILD", "Decision should be BUILD");
  assert.strictEqual(state2.proofDocument?.proofRun, true, "Proof should be run after creation");

  const state3 = capability.reviseDecision(
    state2,
    "cap1",
    "COMPOSE",
    { ...justification, rationale: "Revised rationale" },
    "architect",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  assert.ok(!("kind" in state3), "Revise decision should succeed");
  if ("kind" in state3) throw new Error("Unexpected error");
  assert.strictEqual(state3.decisionRecords.length, 2, "Should have two decision records after revision");
  assert.strictEqual(
    state3.decisionRecords.find(r => r.supersededBy === null)?.decision,
    "COMPOSE",
    "Active decision should be COMPOSE"
  );
  assert.strictEqual(state3.proofDocument?.proofRun, true, "Proof should be re-run after revision");

  const state4 = capability.supersedeDecision(state3, "cap1", "architect", auditFn, "2023-01-01T00:03:00Z");
  assert.ok(!("kind" in state4), "Supersede decision should succeed");
  if ("kind" in state4) throw new Error("Unexpected error");
  assert.strictEqual(state4.decisionRecords.length, 3, "Should have three decision records after supersede");
  assert.strictEqual(state4.proofDocument?.proofRun, true, "Proof should be re-run after supersede");

  const state5 = capability.rollbackDecision(state4, "cap1", "architect", auditFn, "2023-01-01T00:04:00Z");
  assert.ok(!("kind" in state5), "Rollback decision should succeed");
  if ("kind" in state5) throw new Error("Unexpected error");
  assert.strictEqual(
    state5.decisionRecords.filter(r => r.supersededBy === null).length,
    1,
    "Should have one active decision after rollback"
  );
  assert.strictEqual(
    state5.decisionRecords.find(r => r.supersededBy === null)?.decision,
    "COMPOSE",
    "Active decision should be COMPOSE after rollback"
  );
  assert.strictEqual(state5.proofDocument?.proofRun, true, "Proof should be re-run after rollback");
});

test("buildversuscomposedecisionframeworkpermissions", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const state0 = capability.initialState;
  const state1 = capability.initializeFramework(state0, ["cap1"], ["architect", "reviewer"], auditFn, "2023-01-01T00:00:00Z");
  assert.ok(!("kind" in state1), "Initialization should succeed");
  if ("kind" in state1) throw new Error("Unexpected error");

  const state2 = capability.createDecision(
    state1,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  assert.ok(!("kind" in state2), "Create decision with valid authority should succeed");
  if ("kind" in state2) throw new Error("Unexpected error");

  const error = capability.createDecision(
    state2,
    "cap2",
    "COMPOSE",
    justification,
    "invalid-authority",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  assert.ok("kind" in error, "Create decision with invalid authority should fail");
  assert.strictEqual(error.kind, "AUTHORITY_VIOLATION", "Error kind should be AUTHORITY_VIOLATION");
});

test("buildversuscomposedecisionframeworkproof", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const state0 = capability.initialState;
  const state1 = capability.initializeFramework(state0, ["cap1", "cap2"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  assert.ok(!("kind" in state1), "Initialization should succeed");
  if ("kind" in state1) throw new Error("Unexpected error");

  const state2 = capability.createDecision(
    state1,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  assert.ok(!("kind" in state2), "Create decision should succeed");
  if ("kind" in state2) throw new Error("Unexpected error");

  const state3 = capability.createDecision(
    state2,
    "cap2",
    "COMPOSE",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:02:00Z"
  );
  assert.ok(!("kind" in state3), "Create second decision should succeed");
  if ("kind" in state3) throw new Error("Unexpected error");
  assert.ok(state3.proofDocument !== null, "Proof document should exist");
  assert.strictEqual(state3.proofDocument?.consistencyCheck, true, "Consistency check should pass");
  assert.strictEqual(state3.proofDocument?.decisionRecords.length, 2, "Proof should contain both decisions");
});

test("buildversuscomposedecisionframeworkreadinessmodel", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const state0 = capability.initialState;
  assert.strictEqual(capability.getReadiness(state0), "NOT_READY", "Initial state should be NOT_READY");

  const state1 = capability.initializeFramework(state0, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  assert.ok(!("kind" in state1), "Initialization should succeed");
  if ("kind" in state1) throw new Error("Unexpected error");
  assert.strictEqual(capability.getReadiness(state1), "NOT_READY", "State without decisions should be NOT_READY");

  const state2 = capability.createDecision(
    state1,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  assert.ok(!("kind" in state2), "Create decision should succeed");
  if ("kind" in state2) throw new Error("Unexpected error");
  assert.strictEqual(capability.getReadiness(state2), "READY", "State with all capabilities decided should be READY");

  const state3 = capability.initializeFramework(state0, ["cap1", "cap2"], ["architect"], auditFn, "2023-01-01T00:02:00Z");
  assert.ok(!("kind" in state3), "Initialization should succeed");
  if ("kind" in state3) throw new Error("Unexpected error");
  const state4 = capability.createDecision(
    state3,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:03:00Z"
  );
  assert.ok(!("kind" in state4), "Create decision should succeed");
  if ("kind" in state4) throw new Error("Unexpected error");
  assert.strictEqual(capability.getReadiness(state4), "NOT_READY", "State with missing capability decision should be NOT_READY");
});

test("buildversuscomposedecisionframeworkvalidation", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Valid decision",
  };
  const auditFn = (_event: capability.BuildVersusComposeAuditEvent): capability.BuildVersusComposeError | null => null;
  const state0 = capability.initialState;
  const state1 = capability.initializeFramework(state0, ["cap1"], ["architect"], auditFn, "2023-01-01T00:00:00Z");
  assert.ok(!("kind" in state1), "Initialization should succeed");
  if ("kind" in state1) throw new Error("Unexpected error");

  const state2 = capability.createDecision(
    state1,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:01:00Z"
  );
  assert.ok(!("kind" in state2), "Create decision should succeed");
  if ("kind" in state2) throw new Error("Unexpected error");
  const validation1 = capability.validateFramework(state2);
  assert.strictEqual(validation1, null, "Valid framework should pass validation");

  const state3 = capability.initializeFramework(state0, ["cap1", "cap2"], ["architect"], auditFn, "2023-01-01T00:02:00Z");
  assert.ok(!("kind" in state3), "Initialization should succeed");
  if ("kind" in state3) throw new Error("Unexpected error");
  const state4 = capability.createDecision(
    state3,
    "cap1",
    "BUILD",
    justification,
    "architect",
    auditFn,
    "2023-01-01T00:03:00Z"
  );
  assert.ok(!("kind" in state4), "Create decision should succeed");
  if ("kind" in state4) throw new Error("Unexpected error");
  const validation2 = capability.validateFramework(state4);
  assert.ok(validation2 !== null, "Framework with missing capability should fail validation");
  assert.strictEqual(validation2?.kind, "SEMANTIC_DRIFT", "Error kind should be SEMANTIC_DRIFT");

  const invalidJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "" },
    rationale: "Invalid",
  } as capability.DecisionJustification;
  const error = capability.createDecision(
    state1,
    "cap2",
    "COMPOSE",
    invalidJustification,
    "architect",
    auditFn,
    "2023-01-01T00:04:00Z"
  );
  assert.ok("kind" in error, "Invalid justification should return error");
  assert.strictEqual(error.kind, "JUSTIFICATION_MISSING", "Error kind should be JUSTIFICATION_MISSING");
});