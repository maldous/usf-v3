import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/foundation/buildversuscomposedecisionframework.ts";

test("buildversuscomposedecisionframeworkauditmodel", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Initial decision",
  };
  const record1 = capability.createDecisionRecord(
    "cap1",
    "BUILD" as const,
    justification,
    1,
  );
  const proof1 = capability.authorDecision(null, record1);
  assert.ok(!("kind" in proof1), "authorDecision should succeed for initial record");
  if ("kind" in proof1) throw new Error("Unexpected error");

  const record2 = capability.createDecisionRecord(
    "cap1",
    "COMPOSE" as const,
    { ...justification, rationale: "Revised decision" },
    2,
  );
  const proof2 = capability.authorDecision(proof1, record2);
  assert.ok(!("kind" in proof2), "authorDecision should succeed for versioned update");
  if ("kind" in proof2) throw new Error("Unexpected error");

  const decisionRecords = proof2.decisionRecords;
  assert.strictEqual(decisionRecords.length, 2, "Audit trail should contain both versions");
  assert.strictEqual(decisionRecords[0].version, 1, "First record should be version 1");
  assert.strictEqual(decisionRecords[1].version, 2, "Second record should be version 2");
  assert.strictEqual(decisionRecords[1].decision, "COMPOSE", "Latest decision should be COMPOSE");
});

test("buildversuscomposedecisionframeworkerrormodel", () => {
  const invalidRecord = { capabilityId: "cap1" } as unknown;
  const result = capability.validateDecision(invalidRecord);
  assert.ok("kind" in result, "validateDecision should return error for incomplete record");
  assert.strictEqual(
    result.kind,
    "DECISION_INCOMPLETE",
    "Error kind should be DECISION_INCOMPLETE",
  );

  const state: capability.BuildVersusComposeState = {
    readiness: "NOT_READY",
    proofDocument: null,
    lastError: null,
  };
  const action = {
    type: "REVISE" as const,
    capabilityId: "cap1",
    newDecision: "BUILD" as const,
    newJustification: {
      criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
      rationale: "test",
    },
  };
  const newState = capability.runBuildVersusComposeFramework(state, action, () => null);
  assert.ok(newState.lastError !== null, "Framework should fail closed with error");
  assert.strictEqual(
    newState.lastError?.kind,
    "DEPENDENCY_UNAVAILABLE",
    "Error kind should be DEPENDENCY_UNAVAILABLE",
  );
});

test("buildversuscomposedecisionframeworklifecycle", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Initial decision",
  };
  const record1 = capability.createDecisionRecord("cap1", "BUILD" as const, justification, 1);
  let proof = capability.authorDecision(null, record1);
  assert.ok(!("kind" in proof), "Initial author should succeed");
  if ("kind" in proof) throw new Error("Unexpected error");

  const revisedProof = capability.reviseDecision(
    proof,
    "cap1",
    "COMPOSE" as const,
    { ...justification, rationale: "Revised rationale" },
  );
  assert.ok(!("kind" in revisedProof), "Revise should succeed");
  if ("kind" in revisedProof) throw new Error("Unexpected error");
  assert.strictEqual(revisedProof.decisionRecords[0].decision, "COMPOSE", "Decision should be updated");

  const supersededRecord = capability.createDecisionRecord(
    "cap1",
    "ADAPTER" as const,
    { ...justification, rationale: "Superseded rationale" },
    2,
  );
  const supersededProof = capability.supersedeDecision(proof, "cap1", supersededRecord);
  assert.ok(!("kind" in supersededProof), "Supersede should succeed");
  if ("kind" in supersededProof) throw new Error("Unexpected error");
  assert.strictEqual(
    supersededProof.decisionRecords.find((r) => r.version === 2)?.decision,
    "ADAPTER",
    "Superseded decision should be ADAPTER",
  );

  const rollbackProof = capability.rollbackDecision(supersededProof, "cap1");
  assert.ok(!("kind" in rollbackProof), "Rollback should succeed");
  if ("kind" in rollbackProof) throw new Error("Unexpected error");
  assert.strictEqual(
    rollbackProof.decisionRecords.length,
    1,
    "Rollback should remove the superseded decision",
  );
});

test("buildversuscomposedecisionframeworkpermissions", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const record = capability.createDecisionRecord("cap1", "BUILD" as const, justification, 1);
  const proof = capability.authorDecision(null, record);
  assert.ok(!("kind" in proof), "Authoring should succeed without tenant-scoped permissions");
  if ("kind" in proof) throw new Error("Unexpected error");

  const authorityOrder = ["cap1", "cap2"] as const;
  const validatedProof = capability.validateProofDocument(proof, authorityOrder);
  assert.ok(!("kind" in validatedProof), "Validation should pass with correct authority order");
  if ("kind" in validatedProof) throw new Error("Unexpected error");

  const invalidAuthorityProof = capability.validateProofDocument(proof, ["cap2"]);
  assert.ok("kind" in invalidAuthorityProof, "Validation should fail with incorrect authority order");
  assert.strictEqual(
    invalidAuthorityProof.kind,
    "AUTHORITY_VIOLATION",
    "Error kind should be AUTHORITY_VIOLATION",
  );
});

test("buildversuscomposedecisionframeworkproof", () => {
  const justification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Test decision",
  };
  const record1 = capability.createDecisionRecord("cap1", "BUILD" as const, justification, 1);
  const record2 = capability.createDecisionRecord("cap2", "COMPOSE" as const, justification, 1);
  const proof1 = capability.authorDecision(null, record1);
  assert.ok(!("kind" in proof1), "First author should succeed");
  if ("kind" in proof1) throw new Error("Unexpected error");

  const proof = capability.authorDecision(proof1, record2);
  assert.ok(!("kind" in proof), "Proof document should be created");
  if ("kind" in proof) throw new Error("Unexpected error");

  const consistency = capability.checkConsistency(proof);
  assert.strictEqual(consistency, true, "Proof should be consistent");

  const state: capability.BuildVersusComposeState = {
    readiness: "NOT_READY",
    proofDocument: proof,
    lastError: null,
  };
  const readiness = capability.computeReadiness(state);
  assert.strictEqual(readiness, "READY", "Readiness should be READY with consistent proof");
});

test("buildversuscomposedecisionframeworkreadinessmodel", () => {
  const stateReady: capability.BuildVersusComposeState = {
    readiness: "READY",
    proofDocument: {
      decisionRecords: [],
      consistencyCheck: true,
      authorityOrder: [],
    },
    lastError: null,
  };
  const readinessReady = capability.computeReadiness(stateReady);
  assert.strictEqual(readinessReady, "READY", "Readiness should be READY with consistent proof and no error");

  const stateNotReady: capability.BuildVersusComposeState = {
    readiness: "NOT_READY",
    proofDocument: null,
    lastError: null,
  };
  const readinessNotReady = capability.computeReadiness(stateNotReady);
  assert.strictEqual(readinessNotReady, "NOT_READY", "Readiness should be NOT_READY without proof");

  const stateError: capability.BuildVersusComposeState = {
    readiness: "NOT_READY",
    proofDocument: {
      decisionRecords: [],
      consistencyCheck: true,
      authorityOrder: [],
    },
    lastError: { kind: "PROOF_INCONSISTENT", message: "Test error" },
  };
  const readinessError = capability.computeReadiness(stateError);
  assert.strictEqual(readinessError, "NOT_READY", "Readiness should be NOT_READY with error");
});

test("buildversuscomposedecisionframeworkvalidation", () => {
  const validJustification: capability.DecisionJustification = {
    criteria: { COST: "low", CONTROL: "high", READINESS: "immediate" },
    rationale: "Valid decision",
  };
  const validRecord = capability.createDecisionRecord("cap1", "BUILD" as const, validJustification, 1);
  const validatedRecord = capability.validateDecision(validRecord);
  assert.ok(!("kind" in validatedRecord), "Valid decision should pass validation");
  if ("kind" in validatedRecord) throw new Error("Unexpected error");

  const invalidJustification = {
    criteria: { COST: "low", CONTROL: "high" } as const,
    rationale: "Missing READINESS",
  };
  const invalidRecord = { ...validRecord, justification: invalidJustification };
  const validatedInvalidRecord = capability.validateDecision(invalidRecord);
  assert.ok("kind" in validatedInvalidRecord, "Invalid decision should fail validation");
  assert.strictEqual(
    validatedInvalidRecord.kind,
    "JUSTIFICATION_MISSING",
    "Error kind should be JUSTIFICATION_MISSING",
  );

  const proof: capability.ProofDocument = {
    decisionRecords: [validRecord],
    consistencyCheck: true,
    authorityOrder: ["cap1"],
  };
  const validatedProof = capability.validateProofDocument(proof, ["cap1"]);
  assert.ok(!("kind" in validatedProof), "Valid proof document should pass validation");
  if ("kind" in validatedProof) throw new Error("Unexpected error");

  const invalidProof = { ...proof, authorityOrder: ["cap2"] };
  const validatedInvalidProof = capability.validateProofDocument(invalidProof, ["cap1"]);
  assert.ok("kind" in validatedInvalidProof, "Invalid proof document should fail validation");
  assert.strictEqual(
    validatedInvalidProof.kind,
    "AUTHORITY_VIOLATION",
    "Error kind should be AUTHORITY_VIOLATION",
  );
});