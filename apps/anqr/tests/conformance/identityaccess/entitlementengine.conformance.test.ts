import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/entitlementengine.ts";

test("entitlementengineauditmodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A" as const],
  };
  const auditError: capability.EntitlementEngineError = { kind: "AUDIT_FAILURE", message: "Audit failed" };
  const auditFn = (_: capability.EntitlementEngineAuditEvent): capability.EntitlementEngineError | null => auditError;

  const grantResult = capability.grantEntitlement(
    state,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    auditFn,
  );
  assert.deepEqual(grantResult, auditError);
  assert.equal(state.entitlements.length, 0);

  const revokeResult = capability.revokeEntitlement(
    state,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    auditFn,
  );
  assert.deepEqual(revokeResult, auditError);
  assert.equal(state.entitlements.length, 0);

  let capturedEvent: capability.EntitlementEngineAuditEvent | null = null;
  const goodAuditFn = (event: capability.EntitlementEngineAuditEvent): null => {
    capturedEvent = event;
    return null;
  };

  const newState = capability.grantEntitlement(
    state,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    goodAuditFn,
  );
  if ("entitlements" in newState) {
    assert.notEqual(newState, state);
    assert.equal(capturedEvent?.kind, "ENTITLEMENT_GRANTED");
    assert.equal(capturedEvent?.newState, "GRANTED");
  } else {
    assert.fail("Expected state, got error");
  }

  const revokedState = capability.revokeEntitlement(
    newState,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    goodAuditFn,
  );
  if ("entitlements" in revokedState) {
    assert.notEqual(revokedState, newState);
    assert.equal(capturedEvent?.kind, "ENTITLEMENT_REVOKED");
    assert.equal(capturedEvent?.newState, "REVOKED");
  } else {
    assert.fail("Expected state, got error");
  }
});