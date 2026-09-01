import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/entitlementengine.ts";

test("entitlementengineauditmodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A"] as const,
  };

  const auditError: capability.EntitlementEngineError = {
    kind: "AUDIT_FAILURE",
    message: "Audit failed",
  };
  const failingAudit = (
    _event: capability.EntitlementEngineAuditEvent,
  ): capability.EntitlementEngineError | null => auditError;

  const grantResult = capability.grantEntitlement(
    state,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    failingAudit,
  );
  assert.ok(!("entitlements" in grantResult));
  if (!("entitlements" in grantResult)) {
    assert.strictEqual(grantResult.kind, "AUDIT_FAILURE");
  }
  assert.strictEqual(state.entitlements.length, 0);

  const revokeResult = capability.revokeEntitlement(
    state,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    failingAudit,
  );
  assert.ok(!("entitlements" in revokeResult));
  if (!("entitlements" in revokeResult)) {
    assert.strictEqual(revokeResult.kind, "AUDIT_FAILURE");
  }
  assert.strictEqual(state.entitlements.length, 0);

  let capturedEvent: capability.EntitlementEngineAuditEvent | null = null;
  const goodAudit = (
    event: capability.EntitlementEngineAuditEvent,
  ): null => {
    capturedEvent = event;
    return null;
  };

  const newStateResult = capability.grantEntitlement(
    state,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    goodAudit,
  );
  assert.ok("entitlements" in newStateResult, "grantEntitlement must return a state on success");
  assert.notStrictEqual(capturedEvent, null);
  assert.strictEqual(capturedEvent?.kind, "ENTITLEMENT_GRANTED");
  assert.strictEqual(capturedEvent?.newState, "GRANTED");
  assert.strictEqual(capturedEvent?.tenantId, "tenant1");
  assert.strictEqual(capturedEvent?.entitlementKey, "FEATURE_A");

  const revokedResult = capability.revokeEntitlement(
    newStateResult,
    "tenant1",
    "FEATURE_A",
    "op2",
    "test",
    {},
    goodAudit,
  );
  assert.ok("entitlements" in revokedResult, "revokeEntitlement must return a state on success");
  assert.notStrictEqual(capturedEvent, null);
  assert.strictEqual(capturedEvent?.kind, "ENTITLEMENT_REVOKED");
  assert.strictEqual(capturedEvent?.newState, "REVOKED");

  const readDecision = capability.evaluateEntitlement(state, "tenant1", "FEATURE_A");
  assert.strictEqual(readDecision, "DENIED");
});