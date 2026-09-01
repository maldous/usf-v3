import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/entitlementengine.ts";

const TENANT_READ_PERMISSION: capability.EntitlementEnginePermission = "TENANT_ENTITLEMENTS_READ";
const PLATFORM_READ_PERMISSION: capability.EntitlementEnginePermission = "PLATFORM_ENTITLEMENTS_READ";
const PLATFORM_WRITE_PERMISSION: capability.EntitlementEnginePermission = "PLATFORM_ENTITLEMENTS_WRITE";
const GRANTED_STATE: capability.EntitlementEngineEntitlementState = "GRANTED";
const REVOKED_STATE: capability.EntitlementEngineEntitlementState = "REVOKED";
const NOT_GRANTED_STATE: capability.EntitlementEngineEntitlementState = "NOT_GRANTED";
const ALLOWED_DECISION: capability.EntitlementEngineDecision = "ALLOWED";
const DENIED_DECISION: capability.EntitlementEngineDecision = "DENIED";

function isEntitlementError(
  value: capability.EntitlementEngineState | capability.EntitlementEngineError,
): value is capability.EntitlementEngineError {
  return "kind" in value;
}

function isTenantViewError(
  value:
    | { readonly result: readonly capability.TenantEntitlementView[] }
    | capability.EntitlementEngineError,
): value is capability.EntitlementEngineError {
  return "kind" in value;
}

function isAccessError(
  value:
    | { readonly decision: capability.EntitlementEngineDecision }
    | capability.EntitlementEngineError,
): value is capability.EntitlementEngineError {
  return "kind" in value;
}

test("entitlementengineauditmodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A"],
  };

  const events: capability.EntitlementEngineAuditEvent[] = [];
  const passingAudit: (
    event: capability.EntitlementEngineAuditEvent,
  ) => capability.EntitlementEngineError | null = (event) => {
    events.push(event);
    return null;
  };

  const grantResult = capability.grantEntitlement(
    state,
    "tenant-1",
    "FEATURE_A",
    "operator-1",
    "source-grant",
    { reason: "bootstrap" },
    passingAudit,
  );
  assert.equal(isEntitlementError(grantResult), false);
  if (isEntitlementError(grantResult)) {
    return;
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "ENTITLEMENT_GRANTED");
  assert.equal(events[0].newState, GRANTED_STATE);
  assert.equal(events[0].tenantId, "tenant-1");
  assert.equal(events[0].entitlementKey, "FEATURE_A");
  assert.equal(grantResult.entitlements.length, 1);

  const revokeResult = capability.revokeEntitlement(
    grantResult,
    "tenant-1",
    "FEATURE_A",
    "operator-2",
    "source-revoke",
    { reason: "deprovision" },
    passingAudit,
  );
  assert.equal(isEntitlementError(revokeResult), false);
  if (isEntitlementError(revokeResult)) {
    return;
  }

  assert.equal(events.length, 2);
  assert.equal(events[1].kind, "ENTITLEMENT_REVOKED");
  assert.equal(events[1].newState, REVOKED_STATE);
  assert.equal(revokeResult.entitlements[0].state, REVOKED_STATE);

  const auditFailure: capability.EntitlementEngineError = {
    kind: "AUDIT_FAILURE",
    message: "audit failed",
  };
  const failingAudit: (
    event: capability.EntitlementEngineAuditEvent,
  ) => capability.EntitlementEngineError | null = (event) => {
    events.push(event);
    return auditFailure;
  };
  const failedGrant = capability.grantEntitlement(
    state,
    "tenant-1",
    "FEATURE_A",
    "operator-3",
    "source-grant",
    {},
    failingAudit,
  );
  assert.equal(isEntitlementError(failedGrant), true);
  if (isEntitlementError(failedGrant)) {
    assert.equal(failedGrant.kind, "AUDIT_FAILURE");
  }

  assert.equal(state.entitlements.length, 0);

  const readAuditBaseline = events.length;
  const accessResult = capability.evaluateAccess(
    grantResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isAccessError(accessResult), false);
  if (isAccessError(accessResult)) {
    return;
  }
  assert.equal(accessResult.decision, ALLOWED_DECISION);

  const readViewResult = capability.tenantSelfReadEntitlements(
    grantResult,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(readViewResult), false);
  if (isTenantViewError(readViewResult)) {
    return;
  }
  assert.equal(readViewResult.result.length, 1);
  assert.equal(events.length, readAuditBaseline);
});

test("entitlementenginecontracts", () => {
  const initial: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A", "FEATURE_B"],
  };

  const catalog = capability.serviceCatalogRead(initial);
  assert.deepStrictEqual(catalog.result, ["FEATURE_A", "FEATURE_B"]);

  const tenantReadResult = capability.tenantSelfReadEntitlements(
    initial,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(tenantReadResult), false);
  if (isTenantViewError(tenantReadResult)) {
    return;
  }
  assert.equal(tenantReadResult.result.length, 2);

  const operatorReadResult = capability.operatorReadEntitlements(
    initial,
    "tenant-1",
    [PLATFORM_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(operatorReadResult), false);
  if (isTenantViewError(operatorReadResult)) {
    return;
  }
  assert.equal(operatorReadResult.result.length, 2);

  const events: capability.EntitlementEngineAuditEvent[] = [];
  const writeResult = capability.operatorWriteEntitlement(
    initial,
    "tenant-1",
    "FEATURE_A",
    "GRANT",
    "operator-1",
    "source",
    { request: "contracts" },
    [PLATFORM_WRITE_PERMISSION],
    (event) => {
      events.push(event);
      return null;
    },
  );
  assert.equal(isEntitlementError(writeResult), false);
  if (isEntitlementError(writeResult)) {
    return;
  }
  assert.equal(events.length, 1);

  const evaluateResult = capability.evaluateAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isAccessError(evaluateResult), false);
  if (isAccessError(evaluateResult)) {
    return;
  }
  assert.equal(evaluateResult.decision, ALLOWED_DECISION);

  const assertResult = capability.assertAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(assertResult, null);

  const denyDecision = capability.evaluateEntitlement(writeResult, "tenant-1", "FEATURE_B");
  assert.equal(denyDecision, DENIED_DECISION);
  const deniedAssert = capability.assertAccess(
    writeResult,
    "tenant-1",
    "FEATURE_B",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isEntitlementError(deniedAssert), true);
  if (isEntitlementError(deniedAssert)) {
    assert.equal(deniedAssert.kind, "FORBIDDEN");
  }
});

test("entitlementengineerrormodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A", "FEATURE_B"],
  };

  const forbiddenAssertion = capability.assertAccess(
    state,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isEntitlementError(forbiddenAssertion), true);
  if (isEntitlementError(forbiddenAssertion)) {
    assert.equal(forbiddenAssertion.kind, "FORBIDDEN");
  }

  const deniedByPermission = capability.evaluateAccess(
    state,
    "tenant-1",
    "FEATURE_A",
    [],
  );
  assert.equal(isAccessError(deniedByPermission), true);
  if (isAccessError(deniedByPermission)) {
    assert.equal(deniedByPermission.kind, "FORBIDDEN");
  }

  const deniedByEntitlement = capability.evaluateAccess(
    state,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isAccessError(deniedByEntitlement), false);
  if (isAccessError(deniedByEntitlement)) {
    return;
  }
  assert.equal(deniedByEntitlement.decision, DENIED_DECISION);

  const invalidTenant = capability.assertAccess(
    state,
    "",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isEntitlementError(invalidTenant), true);
  if (isEntitlementError(invalidTenant)) {
    assert.equal(invalidTenant.kind, "INVALID_TENANT");
  }

  const invalidKey = capability.assertAccess(
    state,
    "tenant-1",
    "UNKNOWN_FEATURE",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isEntitlementError(invalidKey), true);
  if (isEntitlementError(invalidKey)) {
    assert.equal(invalidKey.kind, "INVALID_KEY");
  }

  const degraded: capability.EntitlementEngineError = {
    kind: "AUDIT_FAILURE",
    message: "provider degraded",
  };
  const writeFailure = capability.operatorWriteEntitlement(
    state,
    "tenant-1",
    "FEATURE_A",
    "GRANT",
    "operator-1",
    "source",
    {},
    [PLATFORM_WRITE_PERMISSION],
    () => degraded,
  );
  assert.equal(isEntitlementError(writeFailure), true);
  if (isEntitlementError(writeFailure)) {
    assert.equal(writeFailure.kind, "AUDIT_FAILURE");
  }
  assert.equal(state.entitlements.length, 0);

  const defaultDenied = capability.evaluateEntitlement(state, "tenant-1", "FEATURE_A");
  assert.equal(defaultDenied, DENIED_DECISION);
});

test("entitlementenginelifecycle", () => {
  const base: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A", "FEATURE_B"],
  };

  const absentDecision = capability.evaluateEntitlement(base, "tenant-1", "FEATURE_A");
  assert.equal(absentDecision, DENIED_DECISION);

  const events: capability.EntitlementEngineAuditEvent[] = [];
  const passAudit: (
    event: capability.EntitlementEngineAuditEvent,
  ) => capability.EntitlementEngineError | null = (event) => {
    events.push(event);
    return null;
  };

  const grantedState = capability.operatorWriteEntitlement(
    base,
    "tenant-1",
    "FEATURE_A",
    "GRANT",
    "operator-1",
    "source",
    { channel: "lifecycle" },
    [PLATFORM_WRITE_PERMISSION],
    passAudit,
  );
  assert.equal(isEntitlementError(grantedState), false);
  if (isEntitlementError(grantedState)) {
    return;
  }

  const grantedAssert = capability.assertAccess(
    grantedState,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(grantedAssert, null);

  const grantView = capability.tenantSelfReadEntitlements(
    grantedState,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(grantView), false);
  if (isTenantViewError(grantView)) {
    return;
  }
  assert.deepStrictEqual(grantView.result, [
    { entitlementKey: "FEATURE_A", state: GRANTED_STATE },
    { entitlementKey: "FEATURE_B", state: NOT_GRANTED_STATE },
  ]);

  const revokedState = capability.operatorWriteEntitlement(
    grantedState,
    "tenant-1",
    "FEATURE_A",
    "REVOKE",
    "operator-1",
    "source",
    { channel: "lifecycle" },
    [PLATFORM_WRITE_PERMISSION],
    passAudit,
  );
  assert.equal(isEntitlementError(revokedState), false);
  if (isEntitlementError(revokedState)) {
    return;
  }

  const revokedDecision = capability.evaluateEntitlement(revokedState, "tenant-1", "FEATURE_A");
  assert.equal(revokedDecision, DENIED_DECISION);

  const revokedAccess = capability.assertAccess(
    revokedState,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isEntitlementError(revokedAccess), true);
  if (isEntitlementError(revokedAccess)) {
    assert.equal(revokedAccess.kind, "FORBIDDEN");
  }

  const absentAccess = capability.assertAccess(
    revokedState,
    "tenant-1",
    "FEATURE_B",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isEntitlementError(absentAccess), true);
  if (isEntitlementError(absentAccess)) {
    assert.equal(absentAccess.kind, "FORBIDDEN");
  }

  const evaluateAbsent = capability.evaluateAccess(
    revokedState,
    "tenant-1",
    "FEATURE_B",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isAccessError(evaluateAbsent), false);
  if (isAccessError(evaluateAbsent)) {
    return;
  }
  assert.equal(evaluateAbsent.decision, DENIED_DECISION);
});

test("entitlementenginepermissions", () => {
  const base: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A", "FEATURE_B"],
  };

  const missingTenantRead = capability.tenantSelfReadEntitlements(
    base,
    "tenant-1",
    [],
  );
  assert.equal(isTenantViewError(missingTenantRead), true);
  if (isTenantViewError(missingTenantRead)) {
    assert.equal(missingTenantRead.kind, "FORBIDDEN");
  }

  const missingPlatformRead = capability.operatorReadEntitlements(
    base,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(missingPlatformRead), true);
  if (isTenantViewError(missingPlatformRead)) {
    assert.equal(missingPlatformRead.kind, "FORBIDDEN");
  }

  const missingPlatformWrite = capability.operatorWriteEntitlement(
    base,
    "tenant-1",
    "FEATURE_A",
    "GRANT",
    "operator-1",
    "source",
    {},
    [],
    () => null,
  );
  assert.equal(isEntitlementError(missingPlatformWrite), true);
  if (isEntitlementError(missingPlatformWrite)) {
    assert.equal(missingPlatformWrite.kind, "FORBIDDEN");
  }

  const grantedState = capability.operatorWriteEntitlement(
    base,
    "tenant-1",
    "FEATURE_A",
    "GRANT",
    "operator-1",
    "source",
    { permission: "policy-chain" },
    [PLATFORM_WRITE_PERMISSION],
    () => null,
  );
  assert.equal(isEntitlementError(grantedState), false);
  if (isEntitlementError(grantedState)) {
    return;
  }

  const deniedBeforeEntitlement = capability.evaluateAccess(
    grantedState,
    "tenant-1",
    "FEATURE_A",
    [],
  );
  assert.equal(isAccessError(deniedBeforeEntitlement), true);
  if (isAccessError(deniedBeforeEntitlement)) {
    assert.equal(deniedBeforeEntitlement.kind, "FORBIDDEN");
  }

  const tenant2View = capability.tenantSelfReadEntitlements(
    grantedState,
    "tenant-2",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(tenant2View), false);
  if (isTenantViewError(tenant2View)) {
    return;
  }
  assert.deepStrictEqual(tenant2View.result, [
    { entitlementKey: "FEATURE_A", state: NOT_GRANTED_STATE },
    { entitlementKey: "FEATURE_B", state: NOT_GRANTED_STATE },
  ]);
});

test("entitlementengineproof", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A", "FEATURE_B", "FEATURE_C"],
  };

  const denyByDefault = capability.evaluateEntitlement(state, "tenant-1", "FEATURE_A");
  assert.equal(denyByDefault, DENIED_DECISION);

  const writeResult = capability.operatorWriteEntitlement(
    state,
    "tenant-1",
    "FEATURE_A",
    "GRANT",
    "operator-1",
    "source",
    { proof: "runtime" },
    [PLATFORM_WRITE_PERMISSION],
    () => null,
  );
  assert.equal(isEntitlementError(writeResult), false);
  if (isEntitlementError(writeResult)) {
    return;
  }

  const evaluateDecision = capability.evaluateAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isAccessError(evaluateDecision), false);
  if (isAccessError(evaluateDecision)) {
    return;
  }
  assert.equal(evaluateDecision.decision, ALLOWED_DECISION);

  const assertDecision = capability.assertAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(assertDecision, null);

  const denyDecision = capability.evaluateEntitlement(writeResult, "tenant-1", "FEATURE_B");
  assert.equal(denyDecision, DENIED_DECISION);

  const missingPermission = capability.evaluateAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [],
  );
  assert.equal(isAccessError(missingPermission), true);
  if (isAccessError(missingPermission)) {
    assert.equal(missingPermission.kind, "FORBIDDEN");
  }

  const catalog1 = capability.serviceCatalogRead(writeResult);
  const catalog2 = capability.serviceCatalogRead(writeResult);
  assert.deepStrictEqual(catalog1.result, catalog2.result);
  assert.notStrictEqual(catalog1.result, catalog2.result);

  const operatorRead = capability.operatorReadEntitlements(
    writeResult,
    "tenant-1",
    [PLATFORM_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(operatorRead), false);
  if (isTenantViewError(operatorRead)) {
    return;
  }
  assert.equal(operatorRead.result[0].entitlementKey, "FEATURE_A");
});

test("entitlementenginereadinessmodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [
      {
        organisationId: "tenant-1",
        entitlementKey: "FEATURE_A",
        state: GRANTED_STATE,
        source: "seed",
        metadata: { origin: "readiness" },
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "system",
      },
      {
        organisationId: "tenant-2",
        entitlementKey: "FEATURE_B",
        state: REVOKED_STATE,
        source: "seed",
        metadata: { origin: "readiness" },
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "system",
      },
    ],
    catalogKeys: ["FEATURE_A", "FEATURE_B", "FEATURE_C"],
  };

  const tenant1View1 = capability.projectTenantView(state, "tenant-1");
  const tenant1View2 = capability.projectTenantView(state, "tenant-1");
  assert.deepStrictEqual(tenant1View1, tenant1View2);

  const catalogResult1 = capability.serviceCatalogRead(state);
  const catalogResult2 = capability.serviceCatalogRead(state);
  assert.deepStrictEqual(catalogResult1.result, catalogResult2.result);
  assert.notStrictEqual(catalogResult1.result, catalogResult2.result);

  const tenant1Read = capability.tenantSelfReadEntitlements(state, "tenant-1", [TENANT_READ_PERMISSION]);
  assert.equal(isTenantViewError(tenant1Read), false);
  if (isTenantViewError(tenant1Read)) {
    return;
  }
  const tenant1FeatureA = tenant1Read.result.find((entry) => entry.entitlementKey === "FEATURE_A");
  const tenant1FeatureB = tenant1Read.result.find((entry) => entry.entitlementKey === "FEATURE_B");
  const tenant1FeatureC = tenant1Read.result.find((entry) => entry.entitlementKey === "FEATURE_C");
  assert.ok(tenant1FeatureA);
  assert.ok(tenant1FeatureB);
  assert.ok(tenant1FeatureC);
  if (!tenant1FeatureA || !tenant1FeatureB || !tenant1FeatureC) {
    return;
  }
  assert.equal(tenant1FeatureA.state, GRANTED_STATE);
  assert.equal(tenant1FeatureB.state, NOT_GRANTED_STATE);
  assert.equal(tenant1FeatureC.state, NOT_GRANTED_STATE);

  const tenant1ViewObject = tenant1Read.result[0];
  assert.equal(Object.prototype.hasOwnProperty.call(tenant1ViewObject, "entitlementKey"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(tenant1ViewObject, "state"), true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      tenant1ViewObject as unknown as Record<string, unknown>,
      "organisationId",
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      tenant1ViewObject as unknown as Record<string, unknown>,
      "updatedBy",
    ),
    false,
  );

  const operatorBypass = capability.operatorReadEntitlements(
    state,
    "tenant-2",
    [PLATFORM_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(operatorBypass), false);
  if (isTenantViewError(operatorBypass)) {
    return;
  }
  const operatorFeatureB = operatorBypass.result.find((entry) => entry.entitlementKey === "FEATURE_B");
  const operatorFeatureA = operatorBypass.result.find((entry) => entry.entitlementKey === "FEATURE_A");
  assert.ok(operatorFeatureB);
  assert.ok(operatorFeatureA);
  if (!operatorFeatureB || !operatorFeatureA) {
    return;
  }
  assert.equal(operatorFeatureB.state, REVOKED_STATE);
  assert.equal(operatorFeatureA.state, NOT_GRANTED_STATE);

  const tenant2Read = capability.tenantSelfReadEntitlements(
    state,
    "tenant-2",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(tenant2Read), false);
  if (isTenantViewError(tenant2Read)) {
    return;
  }
  const tenant2FeatureA = tenant2Read.result.find((entry) => entry.entitlementKey === "FEATURE_A");
  assert.ok(tenant2FeatureA);
  if (!tenant2FeatureA) {
    return;
  }
  assert.equal(tenant2FeatureA.state, NOT_GRANTED_STATE);

  const readinessAudit: capability.EntitlementEngineAuditEvent[] = [];
  const readinessGranted = capability.operatorWriteEntitlement(
    state,
    "tenant-1",
    "FEATURE_C",
    "GRANT",
    "operator-readiness",
    "source",
    { reason: "readiness-grant" },
    [PLATFORM_WRITE_PERMISSION],
    (event) => {
      readinessAudit.push(event);
      return null;
    },
  );
  assert.equal(isEntitlementError(readinessGranted), false);
  if (isEntitlementError(readinessGranted)) {
    return;
  }
  assert.equal(readinessAudit.length, 1);
  assert.equal(readinessAudit[0].kind, "ENTITLEMENT_GRANTED");

  const readinessRevoked = capability.operatorWriteEntitlement(
    readinessGranted,
    "tenant-1",
    "FEATURE_C",
    "REVOKE",
    "operator-readiness",
    "source",
    { reason: "readiness-revoke" },
    [PLATFORM_WRITE_PERMISSION],
    (event) => {
      readinessAudit.push(event);
      return null;
    },
  );
  assert.equal(isEntitlementError(readinessRevoked), false);
  if (isEntitlementError(readinessRevoked)) {
    return;
  }
  assert.equal(readinessAudit.length, 2);
  assert.equal(readinessAudit[1].kind, "ENTITLEMENT_REVOKED");
  const readinessView = capability.projectTenantView(readinessRevoked, "tenant-1");
  const readinessFeatureC = readinessView.find((entry) => entry.entitlementKey === "FEATURE_C");
  assert.ok(readinessFeatureC);
  if (!readinessFeatureC) {
    return;
  }
  assert.equal(readinessFeatureC.state, REVOKED_STATE);

  const degradedAudit: capability.EntitlementEngineAuditEvent[] = [];
  const degradedResult = capability.operatorWriteEntitlement(
    state,
    "tenant-1",
    "FEATURE_C",
    "GRANT",
    "operator-readiness",
    "source",
    { reason: "degraded-mode" },
    [PLATFORM_WRITE_PERMISSION],
    (event) => {
      degradedAudit.push(event);
      return {
        kind: "DEGRADED",
        message: "forced degraded mode",
      };
    },
  );
  assert.equal(isEntitlementError(degradedResult), true);
  if (isEntitlementError(degradedResult)) {
    assert.equal(degradedResult.kind, "DEGRADED");
  }
  assert.equal(degradedAudit.length, 1);

  const degradedRead = capability.tenantSelfReadEntitlements(
    state,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(degradedRead), false);
  if (isTenantViewError(degradedRead)) {
    return;
  }
  assert.equal(degradedRead.result.length, 3);
});

test("entitlementenginestatemodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A", "FEATURE_B"],
  };

  const granted = capability.grantEntitlement(
    state,
    "tenant-1",
    "FEATURE_A",
    "operator-1",
    "source-grant",
    { reason: "provision" },
    () => null,
  );
  assert.equal(isEntitlementError(granted), false);
  if (isEntitlementError(granted)) {
    return;
  }

  const grantedRecord = granted.entitlements[0];
  assert.equal(grantedRecord.organisationId, "tenant-1");
  assert.equal(grantedRecord.entitlementKey, "FEATURE_A");
  assert.equal(grantedRecord.state, GRANTED_STATE);
  assert.equal(grantedRecord.source, "source-grant");
  assert.deepStrictEqual(grantedRecord.metadata, { reason: "provision" });
  assert.equal(typeof grantedRecord.updatedAt, "string");
  assert.equal(grantedRecord.updatedBy, "operator-1");

  const revoked = capability.revokeEntitlement(
    granted,
    "tenant-1",
    "FEATURE_A",
    "operator-2",
    "source-revoke",
    { reason: "deprovision" },
    () => null,
  );
  assert.equal(isEntitlementError(revoked), false);
  if (isEntitlementError(revoked)) {
    return;
  }

  const revokedRecord = revoked.entitlements[0];
  assert.equal(revokedRecord.organisationId, "tenant-1");
  assert.equal(revokedRecord.state, REVOKED_STATE);
  assert.equal(revokedRecord.source, "source-revoke");
  assert.deepStrictEqual(revokedRecord.metadata, { reason: "deprovision" });
  assert.equal(revokedRecord.updatedBy, "operator-2");
  assert.equal(typeof revokedRecord.updatedAt, "string");

  const tenantView = capability.tenantSelfReadEntitlements(
    revoked,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(tenantView), false);
  if (isTenantViewError(tenantView)) {
    return;
  }
  assert.deepStrictEqual(tenantView.result, [
    { entitlementKey: "FEATURE_A", state: REVOKED_STATE },
    { entitlementKey: "FEATURE_B", state: NOT_GRANTED_STATE },
  ]);

  const unknownKey = capability.validateEntitlementKey("UNKNOWN_FEATURE", revoked.catalogKeys);
  assert.equal(unknownKey?.kind, "INVALID_KEY");
});

test("entitlementenginevalidation", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A"],
  };

  let unknownAuditCount = 0;
  const unknownGrant = capability.grantEntitlement(
    state,
    "tenant-1",
    "UNKNOWN_FEATURE",
    "operator-1",
    "source",
    {},
    () => {
      unknownAuditCount += 1;
      return null;
    },
  );
  assert.equal(isEntitlementError(unknownGrant), true);
  if (isEntitlementError(unknownGrant)) {
    assert.equal(unknownGrant.kind, "INVALID_KEY");
  }
  assert.equal(unknownAuditCount, 0);
  assert.equal(state.entitlements.length, 0);

  let tenantAuditCount = 0;
  const invalidTenant = capability.revokeEntitlement(
    state,
    "",
    "FEATURE_A",
    "operator-1",
    "source",
    {},
    () => {
      tenantAuditCount += 1;
      return null;
    },
  );
  assert.equal(isEntitlementError(invalidTenant), true);
  if (isEntitlementError(invalidTenant)) {
    assert.equal(invalidTenant.kind, "INVALID_TENANT");
  }
  assert.equal(tenantAuditCount, 0);
  assert.equal(state.entitlements.length, 0);

  const writeState = capability.operatorWriteEntitlement(
    state,
    "tenant-1",
    "FEATURE_A",
    "GRANT",
    "operator-1",
    "source",
    {},
    [PLATFORM_WRITE_PERMISSION],
    () => null,
  );
  assert.equal(isEntitlementError(writeState), false);
  if (isEntitlementError(writeState)) {
    return;
  }

  const tenant2View = capability.tenantSelfReadEntitlements(
    writeState,
    "tenant-2",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isTenantViewError(tenant2View), false);
  if (isTenantViewError(tenant2View)) {
    return;
  }
  assert.deepStrictEqual(tenant2View.result, [{ entitlementKey: "FEATURE_A", state: NOT_GRANTED_STATE }]);

  const unknownEvaluation = capability.evaluateAccess(
    state,
    "tenant-1",
    "UNKNOWN_FEATURE",
    [TENANT_READ_PERMISSION],
  );
  assert.equal(isAccessError(unknownEvaluation), true);
  if (isAccessError(unknownEvaluation)) {
    assert.equal(unknownEvaluation.kind, "INVALID_KEY");
  }

  const unchangedRead = capability.tenantSelfReadEntitlements(state, "tenant-1", [TENANT_READ_PERMISSION]);
  assert.equal(isTenantViewError(unchangedRead), false);
  if (isTenantViewError(unchangedRead)) {
    return;
  }
  assert.equal(unchangedRead.result.length, 1);
});