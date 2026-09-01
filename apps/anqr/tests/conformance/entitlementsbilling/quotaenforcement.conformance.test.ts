import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/entitlementsbilling/quotaenforcement.ts";

test("quotaenforcementauditmodel", () => {
  const quota: capability.QuotaRecord = {
    quotaKey: "test-quota",
    entitlementKey: "test-entitlement",
    meterKey: "test-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "test-operator",
  };
  const operator = "test-operator";
  let auditEvent: capability.QuotaEnforcementAuditEvent | null = null;
  const auditFn = (event: capability.QuotaEnforcementAuditEvent): capability.QuotaEnforcementError | null => {
    auditEvent = event;
    return null;
  };

  const result = capability.setQuota(capability.initialState, quota, operator, auditFn);
  assert.notEqual(auditEvent, null);
  assert.equal(auditEvent!.kind, "AUDIT_BEFORE_UPSERT");
  assert.equal(auditEvent!.resource, quota.quotaKey);
  assert.equal(auditEvent!.operator, operator);
  assert.deepEqual(auditEvent!.quota, quota);
  assert.ok(typeof auditEvent!.timestamp === "string");
});

test("quotaenforcementcontracts", () => {
  const quota: capability.QuotaRecord = {
    quotaKey: "test-quota",
    entitlementKey: "test-entitlement",
    meterKey: "test-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "test-operator",
  };
  const state = capability.setQuota(
    capability.initialState,
    quota,
    "test-operator",
    () => null
  ) as capability.QuotaEnforcementState;

  const retrievedQuota = capability.getQuota(state, "test-quota");
  assert.deepEqual(retrievedQuota, quota);

  const { evaluation, error } = capability.evaluateQuota(
    state,
    "test-quota",
    "test-entitlement",
    50
  );
  assert.equal(evaluation.decision, "WITHIN");
  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.projectedUsage, 50);
  assert.equal(error, null);
});

test("quotaenforcementerrormodel", () => {
  const quota: capability.QuotaRecord = {
    quotaKey: "test-quota",
    entitlementKey: "test-entitlement",
    meterKey: "test-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "test-operator",
  };
  const state = capability.setQuota(
    capability.initialState,
    quota,
    "test-operator",
    () => null
  ) as capability.QuotaEnforcementState;

  const { evaluation: noQuotaEval } = capability.evaluateQuota(
    state,
    "non-existent-quota",
    "test-entitlement",
    50
  );
  assert.equal(noQuotaEval.decision, "NO_QUOTA");
  assert.equal(noQuotaEval.allowed, true);

  const { evaluation: noEntitlementEval, error: noEntitlementError } = capability.evaluateQuota(
    state,
    "test-quota",
    "wrong-entitlement",
    50
  );
  assert.equal(noEntitlementEval.decision, "NO_ENTITLEMENT");
  assert.equal(noEntitlementEval.allowed, false);
  assert.equal(noEntitlementError!.kind, "NO_ENTITLEMENT");

  const { evaluation: exceededEval, error: exceededError } = capability.evaluateQuota(
    capability.updateUsage(state, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal(exceededEval.decision, "EXCEEDED");
  assert.equal(exceededEval.allowed, false);
  assert.equal(exceededError!.kind, "QUOTA_EXCEEDED");

  const assertResult = capability.assertQuota(
    capability.updateUsage(state, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal((assertResult as capability.QuotaEnforcementError).kind, "QUOTA_EXCEEDED");
});

test("quotaenforcementlifecycle", () => {
  const state = capability.initialState;
  const { evaluation: noQuotaEval } = capability.evaluateQuota(
    state,
    "non-existent-quota",
    "test-entitlement",
    50
  );
  assert.equal(noQuotaEval.decision, "NO_QUOTA");
  assert.equal(noQuotaEval.allowed, true);

  const quota: capability.QuotaRecord = {
    quotaKey: "test-quota",
    entitlementKey: "test-entitlement",
    meterKey: "test-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "test-operator",
  };
  const newState = capability.setQuota(state, quota, "test-operator", () => null) as capability.QuotaEnforcementState;
  assert.deepEqual(newState.quotas, [quota]);

  const { evaluation: withinEval } = capability.evaluateQuota(
    newState,
    "test-quota",
    "test-entitlement",
    50
  );
  assert.equal(withinEval.decision, "WITHIN");
  assert.equal(withinEval.allowed, true);
  assert.equal(withinEval.projectedUsage, 50);

  const { evaluation: exceededEval } = capability.evaluateQuota(
    capability.updateUsage(newState, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal(exceededEval.decision, "EXCEEDED");
  assert.equal(exceededEval.allowed, false);

  const assertResult = capability.assertQuota(
    capability.updateUsage(newState, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal((assertResult as capability.QuotaEnforcementError).kind, "QUOTA_EXCEEDED");
});

test("quotaenforcementpermissions", () => {
  const quota: capability.QuotaRecord = {
    quotaKey: "tenant1-quota",
    entitlementKey: "tenant1-entitlement",
    meterKey: "tenant1-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "tenant1-operator",
  };
  const state = capability.setQuota(
    capability.initialState,
    quota,
    "tenant1-operator",
    () => null
  ) as capability.QuotaEnforcementState;

  const crossTenantQuota = capability.getQuota(state, "tenant2-quota");
  assert.equal(crossTenantQuota, null);

  const { evaluation: noEntitlementEval } = capability.evaluateQuota(
    state,
    "tenant1-quota",
    "tenant2-entitlement",
    50
  );
  assert.equal(noEntitlementEval.decision, "NO_ENTITLEMENT");
  assert.equal(noEntitlementEval.allowed, false);
});

test("quotaenforcementproof", () => {
  const quota: capability.QuotaRecord = {
    quotaKey: "test-quota",
    entitlementKey: "test-entitlement",
    meterKey: "test-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "test-operator",
  };
  const state = capability.setQuota(
    capability.initialState,
    quota,
    "test-operator",
    () => null
  ) as capability.QuotaEnforcementState;

  const { evaluation: entitlementBeforeQuota } = capability.evaluateQuota(
    state,
    "test-quota",
    "wrong-entitlement",
    50
  );
  assert.equal(entitlementBeforeQuota.decision, "NO_ENTITLEMENT");

  const { evaluation: exceededEval } = capability.evaluateQuota(
    capability.updateUsage(state, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal(exceededEval.decision, "EXCEEDED");

  const assertResult = capability.assertQuota(
    capability.updateUsage(state, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal((assertResult as capability.QuotaEnforcementError).kind, "QUOTA_EXCEEDED");

  const { evaluation: noQuotaEval } = capability.evaluateQuota(
    capability.initialState,
    "non-existent-quota",
    "test-entitlement",
    50
  );
  assert.equal(noQuotaEval.decision, "NO_QUOTA");
  assert.equal(noQuotaEval.allowed, true);
});

test("quotaenforcementreadinessmodel", () => {
  const state = capability.initialState;
  const degradedState = capability.checkReadiness(state, false);
  assert.equal(degradedState.readiness, "DEGRADED");

  const readyState = capability.checkReadiness(state, true);
  assert.equal(readyState.readiness, "READY");

  const quota: capability.QuotaRecord = {
    quotaKey: "test-quota",
    entitlementKey: "test-entitlement",
    meterKey: "test-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "test-operator",
  };
  const stateWithQuota = capability.setQuota(
    readyState,
    quota,
    "test-operator",
    () => null
  ) as capability.QuotaEnforcementState;
  assert.equal(stateWithQuota.readiness, "READY");

  const { evaluation: withinEval } = capability.evaluateQuota(
    stateWithQuota,
    "test-quota",
    "test-entitlement",
    50
  );
  assert.equal(withinEval.decision, "WITHIN");

  const { evaluation: exceededEval } = capability.evaluateQuota(
    capability.updateUsage(stateWithQuota, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal(exceededEval.decision, "EXCEEDED");

  const assertResult = capability.assertQuota(
    capability.updateUsage(stateWithQuota, "test-meter", 90),
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal((assertResult as capability.QuotaEnforcementError).kind, "QUOTA_EXCEEDED");

  const { evaluation: noQuotaEval } = capability.evaluateQuota(
    capability.initialState,
    "non-existent-quota",
    "test-entitlement",
    50
  );
  assert.equal(noQuotaEval.decision, "NO_QUOTA");
  assert.equal(noQuotaEval.allowed, true);
});

test("quotaenforcementstatemodel", () => {
  const quota: capability.QuotaRecord = {
    quotaKey: "test-quota",
    entitlementKey: "test-entitlement",
    meterKey: "test-meter",
    limit: 100,
    window: "hour",
    denyAction: true,
    updatedAt: "2023-01-01T00:00:00Z",
    updatedBy: "test-operator",
  };
  const state = capability.setQuota(
    capability.initialState,
    quota,
    "test-operator",
    () => null
  ) as capability.QuotaEnforcementState;

  assert.deepEqual(state.quotas, [quota]);
  assert.deepEqual(state.currentUsage, []);

  const updatedState = capability.updateUsage(state, "test-meter", 30);
  assert.deepEqual(updatedState.currentUsage, [{ meterKey: "test-meter", value: 30 }]);

  const { evaluation } = capability.evaluateQuota(
    updatedState,
    "test-quota",
    "test-entitlement",
    20
  );
  assert.equal(evaluation.decision, "WITHIN");
  assert.equal(evaluation.currentUsage, 30);
  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.projectedUsage, 50);
});