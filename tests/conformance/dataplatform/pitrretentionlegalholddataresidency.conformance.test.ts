import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/pitrretentionlegalholddataresidency.ts";

test("pitrretentionlegalholddataresidencyauditmodel", () => {
  const auditEvents: capability.AuditEvent[] = [];
  const auditFn: capability.AuditFn = (event) => {
    auditEvents.push(event);
    return null;
  };

  const state = capability.initialState;
  const res1 = capability.createLegalHold(state, "t1", "r1", "reason", "actor1", auditFn);
  if (!res1.success) throw new Error("Setup failed");
  
  const res2 = capability.releaseLegalHold(res1.newState, "t1", "r1", "actor2", auditFn);
  if (!res2.success) throw new Error("Setup failed");

  assert(auditEvents.some(e => e.kind === 'LEGAL_HOLD_SET' && e.tenantId === 't1'));
  assert(auditEvents.some(e => e.kind === 'LEGAL_HOLD_RELEASED' && e.tenantId === 't1'));
  assert(res2.hold.releasedBy === "actor2");
});

test("pitrretentionlegalholddataresidencycontracts", () => {
  const auditFn: capability.AuditFn = () => null;
  const state: capability.SystemState = {
    ...capability.initialState,
    retentionPolicies: [{ tenantId: 't1', resourceClass: 'c1', timeToLiveMillis: 100, applyFilter: 'ALL', enabled: true }],
    legalHolds: [],
    candidates: [{ tenantId: 't1', resource: 'r1', policyId: 'p1', currentOutcome: 'PENDING', evaluatedAt: new Date(Date.now() - 1000).toISOString() }]
  };

  // Contract: Legal hold blocks deletion
  const holdRes = capability.createLegalHold(state, 't1', 'r1', 'hold', 'admin', auditFn);
  if (!holdRes.success) throw new Error("Setup failed");
  
  const workerRes = capability.runRetentionWorker(holdRes.newState, { isPrivileged: true, sourceDataAvailable: true }, auditFn);
  if (!workerRes.success) throw new Error("Worker failed");
  assert(workerRes.state.candidates[0].currentOutcome === 'HELD');

  // Contract: Residency rejects non-home region
  const resTagRes = capability.setResidencyTag(state, 't1', 'region-a', auditFn);
  if (!resTagRes.success) throw new Error("Setup failed");
  assert(capability.validateResidencyWrite(resTagRes.newState, 't1', 'region-b') === false);
});

test("pitrretentionlegalholddataresidencyerrormodel", () => {
  const auditFn: capability.AuditFn = () => null;
  const state = capability.initialState;

  // Fail-closed: Privileges missing
  const res1 = capability.runRetentionWorker(state, { isPrivileged: false, sourceDataAvailable: true }, auditFn);
  assert(res1.success === false);
  assert(res1.kind === 'VALIDATION_FAILURE');
  assert(res1.incidentClass === 'TENANT_DATA_OR_SECURITY');

  // Fail-closed: Source data unavailable
  const res2 = capability.runRetentionWorker(state, { isPrivileged: true, sourceDataAvailable: false }, auditFn);
  assert(res2.success === false);
  assert(res2.kind === 'CONFIG_UNAVAILABLE');
});

test("pitrretentionlegalholddataresidencylifecycle", () => {
  const auditFn: capability.AuditFn = () => null;
  const state: capability.SystemState = {
    ...capability.initialState,
    retentionPolicies: [{ tenantId: 't1', resourceClass: 'c1', timeToLiveMillis: 100, applyFilter: 'ALL', enabled: true }],
    candidates: [{ tenantId: 't1', resource: 'r1', policyId: 'p1', currentOutcome: 'PENDING', evaluatedAt: new Date(Date.now() - 1000).toISOString() }]
  };

  const workerRes = capability.runRetentionWorker(state, { isPrivileged: true, sourceDataAvailable: true }, auditFn);
  if (!workerRes.success) throw new Error("Worker failed");
  assert(workerRes.state.candidates[0].currentOutcome === 'DELETED');
});

test("pitrretentionlegalholddataresidencypermissions", () => {
  const auditFn: capability.AuditFn = () => null;
  const state = capability.initialState;

  // Worker must be privileged
  const res = capability.runRetentionWorker(state, { isPrivileged: false, sourceDataAvailable: true }, auditFn);
  assert(res.success === false);
  assert(res.kind === 'VALIDATION_FAILURE');
});

test("pitrretentionlegalholddataresidencyproof", () => {
  const auditFn: capability.AuditFn = () => null;
  const state = capability.initialState;
  
  const drillRes = capability.performRestoreDrill(state, 't1', '2023-01-01T00:00:00Z', auditFn);
  assert(drillRes.success === true);
  assert(drillRes.tenantIdsRestored.includes('t1'));
});

test("pitrretentionlegalholddataresidencyreadinessmodel", () => {
  const state = capability.initialState;
  
  const degraded = capability.checkReadiness(state, false, true, true, true);
  assert(degraded.ready === false);
  assert(degraded.kind === 'READINESS_DEGRADED');

  const ready = capability.checkReadiness(state, true, true, true, true);
  assert(ready.ready === true);
});

test("pitrretentionlegalholddataresidencystatemodel", () => {
  const auditFn: capability.AuditFn = () => null;
  const state = capability.initialState;
  
  const res = capability.setResidencyTag(state, 't1', 'us-east-1', auditFn);
  if (!res.success) throw new Error("Setup failed");
  assert(res.tag.homeRegion === 'us-east-1');
  assert(res.newState.residencyTags.some(t => t.tenantId === 't1' && t.homeRegion === 'us-east-1'));
});

test("pitrretentionlegalholddataresidencyvalidation", () => {
  const auditFn: capability.AuditFn = () => null;
  const state = capability.initialState;

  const badActor = capability.createLegalHold(state, 't1', 'r1', 'reason', '', auditFn);
  assert(badActor.success === false);
  assert(badActor.kind === 'INVALID_ACTOR');

  const badReason = capability.createLegalHold(state, 't1', 'r1', '', 'actor', auditFn);
  assert(badReason.success === false);
  assert(badReason.kind === 'INVALID_REASON');

  const badRegion = capability.setResidencyTag(state, 't1', '', auditFn);
  assert(badRegion.success === false);
  assert(badRegion.kind === 'INVALID_REGION');
});