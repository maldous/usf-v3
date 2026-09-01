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
  const auditFn = (
    _: capability.EntitlementEngineAuditEvent,
  ): capability.EntitlementEngineError | null => auditError;

  const grantResult = capability.grantEntitlement(
    state,
    "tenant1",
    "FEATURE_A",
    "op1",
    "test",
    {},
    auditFn,
  );
  assert.deepEqual(grantResult as capability.EntitlementEngineError, auditError);
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
  assert.deepEqual(revokeResult as capability.EntitlementEngineError, auditError);
  assert.equal(state.entitlements.length, 0);

  let capturedEvent: capability.EntitlementEngineAuditEvent | null = null;
  const goodAuditFn = (
    event: capability.EntitlementEngineAuditEvent,
  ): null => {
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
  assert.ok(
    typeof newState === "object" && "entitlements" in newState,
    "grantEntitlement should return a state",
  );
  if (typeof newState === "object" && "entitlements" in newState) {
    assert.notEqual(newState, state);
    assert.equal(capturedEvent?.kind, "ENTITLEMENT_GRANTED");
    assert.equal(capturedEvent?.newState, "GRANTED");

    const revokedState = capability.revokeEntitlement(
      newState,
      "tenant1",
      "FEATURE_A",
      "op1",
      "test",
      {},
      goodAuditFn,
    );
    assert.ok(
      typeof revokedState === "object" && "entitlements" in revokedState,
      "revokeEntitlement should return a state",
    );
    if (typeof revokedState === "object" && "entitlements" in revokedState) {
      assert.notEqual(revokedState, newState);
      assert.equal(capturedEvent?.kind, "ENTITLEMENT_REVOKED");
      assert.equal(capturedEvent?.newState, "REVOKED");
    }
  }

  // Verify read-side evaluation is not audited
  const decision = capability.evaluateEntitlement(state, "tenant1", "FEATURE_A");
  assert.equal(decision, "DENIED");
});

test("entitlementenginecontracts", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["KEY1", "KEY2"] as const,
  };
  const actorPermissions: readonly capability.EntitlementEnginePermission[] = [
    "TENANT_ENTITLEMENTS_READ",
    "PLATFORM_ENTITLEMENTS_WRITE",
  ];

  const tenantSelfReadResult = capability.tenantSelfReadEntitlements(
    state,
    "tenant1",
    actorPermissions,
  );
  assert.ok("result" in tenantSelfReadResult);
  if ("result" in tenantSelfReadReadResult) {
    const view = tenantSelfReadResult.result;
    assert.strictEqual(view.length, 2);
    assert.deepEqual(
      view.map((v) => v.entitlementKey),
      ["KEY1", "KEY2"],
    );
  }

  const operatorReadResult = capability.operatorReadEntitlements(
    state,
    "tenant1",
    actorPermissions,
  );
  assert.ok("result" in operatorReadResult);
  if ("result" in operatorReadResult) {
    assert.strictEqual(operatorReadResult.result.length, 2);
  }

  const writeResult = capability.operatorWriteEntitlement(
    state,
    "tenant1",
    "KEY1",
    "GRANT",
    "op1",
    "source",
    {},
    actorPermissions,
    (_): capability.EntitlementEngineError | null => null,
  );
  assert.ok(
    typeof writeResult === "object" && "entitlements" in writeResult,
    "operatorWriteEntitlement should return state",
  );

  const assertResult = capability.assertAccess(
    state,
    "tenant1",
    "KEY1",
    actorPermissions,
  );
  assert.strictEqual(assertResult, null);

  const evaluateResult = capability.evaluateAccess(
    state,
    "tenant1",
    "KEY1",
    actorPermissions,
  );
  assert.ok("decision" in evaluateResult);
  if ("decision" in evaluateResult) {
    assert.strictEqual(evaluateResult.decision, "DENIED");
  }

  const catalogRead = capability.serviceCatalogRead(state);
  assert.deepEqual(catalogRead.result, ["KEY1", "KEY2"]);
});

test("entitlementengineerrormodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["KNOWN"] as const,
  };
  const actorPermissions: readonly capability.EntitlementEnginePermission[] = [];

  const invalidTenantError = capability.validateTenantId("");
  assert.ok(invalidTenantError);
  assert.strictEqual(invalidTenantError.kind, "INVALID_TENANT");

  const invalidKeyError = capability.validateEntitlementKey(
    "UNKNOWN",
    state.catalogKeys,
  );
  assert.ok(invalidKeyError);
  assert.strictEqual(invalidKeyError.kind, "INVALID_KEY");

  const forbiddenAssert = capability.assertAccess(
    state,
    "tenant1",
    "KNOWN",
    actorPermissions,
  );
  assert.ok(forbiddenAssert);
  assert.strictEqual(forbiddenAssert.kind, "FORBIDDEN");

  const forbiddenEval = capability.evaluateAccess(
    state,
    "tenant1",
    "KNOWN",
    actorPermissions,
  );
  assert.ok(forbiddenEval.kind);
  assert.strictEqual(forbiddenEval.kind, "FORBIDDEN");

  const degradedError: capability.EntitlementEngineError = {
    kind: "DEGRADED",
    message: "Provider failure",
  };
  const failingAudit = (_): capability.EntitlementEngineError | null => degradedError;
  const grantResult = capability.grantEntitlement(
    state,
    "tenant1",
    "KNOWN",
    "op1",
    "source",
    {},
    failingAudit,
  );
  assert.ok(grantResult);
  assert.strictEqual(grantResult.kind, "DEGRADED");
});

test("entitlementenginelifecycle", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["A", "B"] as const,
  };
  const actorPermissions: readonly capability.EntitlementEnginePermission[] = [
    "TENANT_ENTITLEMENTS_READ",
    "PLATFORM_ENTITLEMENTS_WRITE",
  ];

  const tenantView = capability.tenantSelfReadEntitlements(
    state,
    "t1",
    actorPermissions,
  ).result;
  assert.strictEqual(tenantView.length, 2);
  tenantView.forEach((v) => assert.strictEqual(v.state, "NOT_GRANTED"));

  const grantState = capability.operatorWriteEntitlement(
    state,
    "t1",
    "A",
    "GRANT",
    "op1",
    "src",
    {},
    actorPermissions,
    () => null,
  );
  assert.ok(grantState.entitlements);
  const grantView = capability.tenantSelfReadEntitlements(
    grantState,
    "t1",
    actorPermissions,
  ).result;
  const aEntry = grantView.find((v) => v.entitlementKey === "A");
  assert.ok(aEntry);
  assert.strictEqual(aEntry.state, "GRANTED");

  const revokeState = capability.operatorWriteEntitlement(
    grantState,
    "t1",
    "A",
    "REVOKE",
    "op2",
    "src2",
    {},
    actorPermissions,
    () => null,
  );
  const revokeView = capability.tenantSelfReadEntitlements(
    revokeState,
    "t1",
    actorPermissions,
  ).result;
  const aRevoked = revokeView.find((v) => v.entitlementKey === "A");
  assert.ok(aRevoked);
  assert.strictEqual(aRevoked.state, "REVOKED");

  const deniedView = capability.tenantSelfReadEntitlements(
    revokeState,
    "t2",
    actorPermissions,
  ).result;
  const bEntry = deniedView.find((v) => v.entitlementKey === "B");
  assert.ok(bEntry);
  assert.strictEqual(bEntry.state, "NOT_GRANTED");
});

test("entitlementenginepermissions", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["X"] as const,
  };
  const tenantOnly: readonly capability.EntitlementEnginePermission[] = [
    "TENANT_ENTITLEMENTS_READ",
  ];

  const tenantReadResult = capability.tenantSelfReadEntitlements(
    state,
    "t1",
    tenantOnly,
  );
  assert.ok("result" in tenantReadResult);

  const operatorReadResult = capability.operatorReadEntitlements(
    state,
    "t1",
    tenantOnly,
  );
  assert.ok(operatorReadResult.kind);
  assert.strictEqual(operatorReadResult.kind, "FORBIDDEN");

  const operatorWriteResult = capability.operatorWriteEntitlement(
    state,
    "t1",
    "X",
    "GRANT",
    "op1",
    "src",
    {},
    tenantOnly,
    () => null,
  );
  assert.ok(operatorWriteResult.kind);
  assert.strictEqual(operatorWriteResult.kind, "FORBIDDEN");

  const evalResult = capability.evaluateAccess(state, "t1", "X", tenantOnly);
  assert.ok(evalResult.kind);
  assert.strictEqual(evalResult.kind, "FORBIDDEN");

  const assertResult = capability.assertAccess(state, "t1", "X", tenantOnly);
  assert.ok(assertResult);
  assert.strictEqual(assertResult.kind, "FORBIDDEN");

  const platformOnly: readonly capability.EntitlementEnginePermission[] = [
    "PLATFORM_ENTITLEMENTS_READ",
    "PLATFORM_ENTITLEMENTS_WRITE",
  ];
  const opRead = capability.operatorReadEntitlements(state, "t1", platformOnly);
  assert.ok("result" in opRead);
});

test("entitlementengineproof", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["Z"] as const,
  };
  const actorPermissions: readonly capability.EntitlementEnginePermission[] = [
    "TENANT_ENTITLEMENTS_READ",
    "PLATFORM_ENTITLEMENTS_WRITE",
  ];

  const initialView = capability.tenantSelfReadEntitlements(
    state,
    "t0",
    actorPermissions,
  ).result;
  assert.strictEqual(initialView.length, 1);
  assert.strictEqual(initialView[0].state, "NOT_GRANTED");

  const grantState = capability.operatorWriteEntitlement(
    state,
    "t0",
    "Z",
    "GRANT",
    "opA",
    "src",
    {},
    actorPermissions,
    () => null,
  );
  const grantedView = capability.tenantSelfReadEntitlements(
    grantState,
    "t0",
    actorPermissions,
  ).result;
  assert.strictEqual(
    grantedView.find((v) => v.entitlementKey === "Z")?.state,
    "GRANTED",
  );

  const otherView = capability.tenantSelfReadEntitlements(
    grantState,
    "t1",
    actorPermissions,
  ).result;
  assert.strictEqual(
    otherView.find((v) => v.entitlementKey === "Z")?.state,
    "NOT_GRANTED",
  );

  const catalog = capability.serviceCatalogRead(grantState);
  assert.deepEqual(catalog.result, ["Z"]);
});

test("entitlementenginereadinessmodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["READ"] as const,
  };
  const actorPermissions: readonly capability.EntitlementEnginePermission[] = [
    "TENANT_ENTITLEMENTS_READ",
  ];

  const view = capability.tenantSelfReadEntitlements(
    state,
    "tenantX",
    actorPermissions,
  ).result;
  assert.strictEqual(view.length, 1);
  assert.strictEqual(view[0].entitlementKey, "READ");
  assert.strictEqual(view[0].state, "NOT_GRANTED");

  const auditError: capability.EntitlementEngineError = {
    kind: "AUDIT_FAILURE",
    message: "failure",
  };
  const failingAudit = (_): capability.EntitlementEngineError | null => auditError;

  const grantResult = capability.grantEntitlement(
    state,
    "tenantX",
    "READ",
    "op",
    "src",
    {},
    failingAudit,
  );
  assert.ok(grantResult);
  assert.strictEqual(grantResult.kind, "AUDIT_FAILURE");
  assert.strictEqual(state.entitlements.length, 0);
});

test("entitlementenginestatemodel", () => {
  const record: capability.EntitlementRecord = {
    organisationId: "org1",
    entitlementKey: "key1",
    state: "GRANTED",
    source: "src",
    metadata: { foo: "bar" },
    updatedAt: new Date().toISOString(),
    updatedBy: "user1",
  };
  const state: capability.EntitlementEngineState = {
    entitlements: [record],
    catalogKeys: ["key1"] as const,
  };

  const view = capability.projectTenantView(state, "org1");
  assert.strictEqual(view.length, 1);
  assert.strictEqual(view[0].entitlementKey, "key1");
  assert.strictEqual(view[0].state, "GRANTED");

  const missingView = capability.projectTenantView(state, "org2");
  assert.strictEqual(missingView.length, 1);
  assert.strictEqual(missingView[0].state, "NOT_GRANTED");
});

test("entitlementenginevalidation", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["ALLOWED"] as const,
  };
  const actorPermissions: readonly capability.EntitlementEnginePermission[] = [
    "PLATFORM_ENTITLEMENTS_WRITE",
  ];

  const emptyTenantError = capability.validateTenantId("");
  assert.ok(emptyTenantError);
  assert.strictEqual(emptyTenantError.kind, "INVALID_TENANT");

  const emptyKeyError = capability.validateEntitlementKey("", state.catalogKeys);
  assert.ok(emptyKeyError);
  assert.strictEqual(emptyKeyError.kind, "INVALID_KEY");

  const unknownKeyError = capability.validateEntitlementKey(
    "UNKNOWN",
    state.catalogKeys,
  );
  assert.ok(unknownKeyError);
  assert.strictEqual(unknownKeyError.kind, "INVALID_KEY");

  const noAuditState = capability.grantEntitlement(
    state,
    "tenant1",
    "ALLOWED",
    "op1",
    "src",
    {},
    (_): capability.EntitlementEngineError | null => null,
  );
  assert.ok("entitlements" in noAuditState);
  assert.strictEqual(noAuditState.entitlements.length, 1);
});