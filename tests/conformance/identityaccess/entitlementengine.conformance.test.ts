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
  value: unknown,
): value is capability.EntitlementEngineError {
  return typeof value === "object" && value !== null && "kind" in value;
}

function isTenantViewError(
  value: unknown,
): value is capability.EntitlementEngineError {
  return typeof value === "object" && value !== null && "kind" in value;
}

function isAccessError(
  value: unknown,
): value is capability.EntitlementEngineError {
  return typeof value === "object" && value !== null && "kind" in value;
}

function isEntitlementState(
  value: unknown,
): value is capability.EntitlementEngineState {
  return typeof value === "object" && value !== null && "entitlements" in value;
}

test("entitlementengineauditmodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A"],
  };

  const events: capability.EntitlementEngineAuditEvent[] = [];
  const passingAudit = (event: capability.EntitlementEngineAuditEvent): capability.EntitlementEngineError | null => {
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
  assert.ok(!isEntitlementError(grantResult));
  assert.ok(isEntitlementState(grantResult));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "ENTITLEMENT_GRANTED");
  assert.strictEqual(events[0].newState, GRANTED_STATE);
  assert.strictEqual(events[0].tenantId, "tenant-1");
  assert.strictEqual(events[0].entitlementKey, "FEATURE_A");
  assert.strictEqual(grantResult.entitlements.length, 1);

  const revokeResult = capability.revokeEntitlement(
    grantResult,
    "tenant-1",
    "FEATURE_A",
    "operator-2",
    "source-revoke",
    { reason: "deprovision" },
    passingAudit,
  );
  assert.ok(!isEntitlementError(revokeResult));
  assert.ok(isEntitlementState(revokeResult));
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].kind, "ENTITLEMENT_REVOKED");
  assert.strictEqual(events[1].newState, REVOKED_STATE);
  assert.strictEqual(revokeResult.entitlements[0].state, "REVOKED");

  const auditFailure: capability.EntitlementEngineError = {
    kind: "AUDIT_FAILURE",
    message: "audit failed",
  };
  const failingAudit = (event: capability.EntitlementEngineAuditEvent): capability.EntitlementEngineError | null => {
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
  assert.ok(isEntitlementError(failedGrant));
  assert.strictEqual(failedGrant.kind, "AUDIT_FAILURE");
  assert.strictEqual(state.entitlements.length, 0);

  const readAuditBaseline = events.length;
  const accessResult = capability.evaluateAccess(
    grantResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isAccessError(accessResult));
  assert.strictEqual(accessResult.decision, ALLOWED_DECISION);

  const readViewResult = capability.tenantSelfReadEntitlements(
    grantResult,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(readViewResult));
  assert.strictEqual(readViewResult.result.length, 1);
  assert.strictEqual(events.length, readAuditBaseline);
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
  assert.ok(!isTenantViewError(tenantReadResult));
  assert.strictEqual(tenantReadResult.result.length, 2);

  const operatorReadResult = capability.operatorReadEntitlements(
    initial,
    "tenant-1",
    [PLATFORM_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(operatorReadResult));
  assert.strictEqual(operatorReadResult.result.length, 2);

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
  assert.ok(!isEntitlementError(writeResult));
  assert.ok(isEntitlementState(writeResult));
  assert.strictEqual(events.length, 1);

  const evaluateResult = capability.evaluateAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isAccessError(evaluateResult));
  assert.strictEqual(evaluateResult.decision, ALLOWED_DECISION);

  const assertResult = capability.assertAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.strictEqual(assertResult, null);

  const denyDecision = capability.evaluateEntitlement(writeResult, "tenant-1", "FEATURE_B");
  assert.strictEqual(denyDecision, DENIED_DECISION);
  const deniedAssert = capability.assertAccess(
    writeResult,
    "tenant-1",
    "FEATURE_B",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(isEntitlementError(deniedAssert));
  assert.strictEqual(deniedAssert.kind, "FORBIDDEN");
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
  assert.ok(isEntitlementError(forbiddenAssertion));
  assert.strictEqual(forbiddenAssertion.kind, "FORBIDDEN");

  const deniedByPermission = capability.evaluateAccess(
    state,
    "tenant-1",
    "FEATURE_A",
    [],
  );
  assert.ok(isAccessError(deniedByPermission));
  assert.strictEqual(deniedByPermission.kind, "FORBIDDEN");

  const deniedByEntitlement = capability.evaluateAccess(
    state,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isAccessError(deniedByEntitlement));
  assert.strictEqual(deniedByEntitlement.decision, DENIED_DECISION);

  const invalidTenant = capability.assertAccess(
    state,
    "",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(isEntitlementError(invalidTenant));
  assert.strictEqual(invalidTenant.kind, "INVALID_TENANT");

  const invalidKey = capability.assertAccess(
    state,
    "tenant-1",
    "UNKNOWN_FEATURE",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(isEntitlementError(invalidKey));
  assert.strictEqual(invalidKey.kind, "INVALID_KEY");

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
  assert.ok(isEntitlementError(writeFailure));
  assert.strictEqual(writeFailure.kind, "AUDIT_FAILURE");
  assert.strictEqual(state.entitlements.length, 0);

  const defaultDenied = capability.evaluateEntitlement(state, "tenant-1", "FEATURE_A");
  assert.strictEqual(defaultDenied, DENIED_DECISION);
});

test("entitlementenginelifecycle", () => {
  const base: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["FEATURE_A", "FEATURE_B"],
  };

  const absentDecision = capability.evaluateEntitlement(base, "tenant-1", "FEATURE_A");
  assert.strictEqual(absentDecision, DENIED_DECISION);

  const events: capability.EntitlementEngineAuditEvent[] = [];
  const passAudit = (event: capability.EntitlementEngineAuditEvent): capability.EntitlementEngineError | null => {
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
  assert.ok(!isEntitlementError(grantedState));
  assert.ok(isEntitlementState(grantedState));

  const grantedAssert = capability.assertAccess(
    grantedState,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.strictEqual(grantedAssert, null);

  const grantView = capability.tenantSelfReadEntitlements(
    grantedState,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(grantView));
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
  assert.ok(!isEntitlementError(revokedState));
  assert.ok(isEntitlementState(revokedState));

  const revokedDecision = capability.evaluateEntitlement(revokedState, "tenant-1", "FEATURE_A");
  assert.strictEqual(revokedDecision, DENIED_DECISION);

  const revokedAccess = capability.assertAccess(
    revokedState,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(isEntitlementError(revokedAccess));
  assert.strictEqual(revokedAccess.kind, "FORBIDDEN");

  const absentAccess = capability.assertAccess(
    revokedState,
    "tenant-1",
    "FEATURE_B",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(isEntitlementError(absentAccess));
  assert.strictEqual(absentAccess.kind, "FORBIDDEN");

  const evaluateAbsent = capability.evaluateAccess(
    revokedState,
    "tenant-1",
    "FEATURE_B",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isAccessError(evaluateAbsent));
  assert.strictEqual(evaluateAbsent.decision, DENIED_DECISION);
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
  assert.ok(isTenantViewError(missingTenantRead));
  assert.strictEqual(missingTenantRead.kind, "FORBIDDEN");

  const missingPlatformRead = capability.operatorReadEntitlements(
    base,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(isTenantViewError(missingPlatformRead));
  assert.strictEqual(missingPlatformRead.kind, "FORBIDDEN");

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
  assert.ok(isEntitlementError(missingPlatformWrite));
  assert.strictEqual(missingPlatformWrite.kind, "FORBIDDEN");

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
  assert.ok(!isEntitlementError(grantedState));
  assert.ok(isEntitlementState(grantedState));

  const deniedBeforeEntitlement = capability.evaluateAccess(
    grantedState,
    "tenant-1",
    "FEATURE_A",
    [],
  );
  assert.ok(isAccessError(deniedBeforeEntitlement));
  assert.strictEqual(deniedBeforeEntitlement.kind, "FORBIDDEN");

  const tenant2View = capability.tenantSelfReadEntitlements(
    grantedState,
    "tenant-2",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(tenant2View));
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
  assert.strictEqual(denyByDefault, DENIED_DECISION);

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
  assert.ok(!isEntitlementError(writeResult));
  assert.ok(isEntitlementState(writeResult));

  const evaluateDecision = capability.evaluateAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isAccessError(evaluateDecision));
  assert.strictEqual(evaluateDecision.decision, ALLOWED_DECISION);

  const assertDecision = capability.assertAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [TENANT_READ_PERMISSION],
  );
  assert.strictEqual(assertDecision, null);

  const denyDecision = capability.evaluateEntitlement(writeResult, "tenant-1", "FEATURE_B");
  assert.strictEqual(denyDecision, DENIED_DECISION);

  const missingPermission = capability.evaluateAccess(
    writeResult,
    "tenant-1",
    "FEATURE_A",
    [],
  );
  assert.ok(isAccessError(missingPermission));
  assert.strictEqual(missingPermission.kind, "FORBIDDEN");

  const catalog1 = capability.serviceCatalogRead(writeResult);
  const catalog2 = capability.serviceCatalogRead(writeResult);
  assert.deepStrictEqual(catalog1.result, catalog2.result);
  assert.notStrictEqual(catalog1.result, catalog2.result);

  const operatorRead = capability.operatorReadEntitlements(
    writeResult,
    "tenant-1",
    [PLATFORM_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(operatorRead));
  assert.strictEqual(operatorRead.result[0].entitlementKey, "FEATURE_A");
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
  assert.ok(!isTenantViewError(tenant1Read));
  const tenant1FeatureA = tenant1Read.result.find((entry) => entry.entitlementKey === "FEATURE_A");
  const tenant1FeatureB = tenant1Read.result.find((entry) => entry.entitlementKey === "FEATURE_B");
  const tenant1FeatureC = tenant1Read.result.find((entry) => entry.entitlementKey === "FEATURE_C");
  assert.ok(tenant1FeatureA);
  assert.ok(tenant1FeatureB);
  assert.ok(tenant1FeatureC);
  assert.strictEqual(tenant1FeatureA.state, GRANTED_STATE);
  assert.strictEqual(tenant1FeatureB.state, NOT_GRANTED_STATE);
  assert.strictEqual(tenant1FeatureC.state, NOT_GRANTED_STATE);

  const tenant1ViewObject = tenant1Read.result[0];
  assert.strictEqual(Object.prototype.hasOwnProperty.call(tenant1ViewObject, "entitlementKey"), true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(tenant1ViewObject, "state"), true);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      tenant1ViewObject as unknown as Record<string, unknown>,
      "organisationId",
    ),
    false,
  );
  assert.strictEqual(
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
  assert.ok(!isTenantViewError(operatorBypass));
  const operatorFeatureB = operatorBypass.result.find((entry) => entry.entitlementKey === "FEATURE_B");
  const operatorFeatureA = operatorBypass.result.find((entry) => entry.entitlementKey === "FEATURE_A");
  assert.ok(operatorFeatureB);
  assert.ok(operatorFeatureA);
  assert.strictEqual(operatorFeatureB.state, REVOKED_STATE);
  assert.strictEqual(operatorFeatureA.state, NOT_GRANTED_STATE);

  const tenant2Read = capability.tenantSelfReadEntitlements(
    state,
    "tenant-2",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(tenant2Read));
  const tenant2FeatureA = tenant2Read.result.find((entry) => entry.entitlementKey === "FEATURE_A");
  assert.ok(tenant2FeatureA);
  assert.strictEqual(tenant2FeatureA.state, NOT_GRANTED_STATE);

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
  assert.ok(!isEntitlementError(readinessGranted));
  assert.ok(isEntitlementState(readinessGranted));
  assert.strictEqual(readinessAudit.length, 1);
  assert.strictEqual(readinessAudit[0].kind, "ENTITLEMENT_GRANTED");

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
  assert.ok(!isEntitlementError(readinessRevoked));
  assert.ok(isEntitlementState(readinessRevoked));
  assert.strictEqual(readinessAudit.length, 2);
  assert.strictEqual(readinessAudit[1].kind, "ENTITLEMENT_REVOKED");
  const readinessView = capability.projectTenantView(readinessRevoked, "tenant-1");
  const readinessFeatureC = readinessView.find((entry) => entry.entitlementKey === "FEATURE_C");
  assert.ok(readinessFeatureC);
  assert.strictEqual(readinessFeatureC.state, REVOKED_STATE);

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
  assert.ok(isEntitlementError(degradedResult));
  assert.strictEqual(degradedResult.kind, "DEGRADED");
  assert.strictEqual(degradedAudit.length, 1);

  const degradedRead = capability.tenantSelfReadEntitlements(
    state,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(degradedRead));
  assert.strictEqual(degradedRead.result.length, 3);
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
  assert.ok(!isEntitlementError(granted));
  assert.ok(isEntitlementState(granted));

  const grantedRecord = granted.entitlements[0];
  assert.strictEqual(grantedRecord.organisationId, "tenant-1");
  assert.strictEqual(grantedRecord.entitlementKey, "FEATURE_A");
  assert.strictEqual(grantedRecord.state, GRANTED_STATE);
  assert.strictEqual(grantedRecord.source, "source-grant");
  assert.deepStrictEqual(grantedRecord.metadata, { reason: "provision" });
  assert.strictEqual(typeof grantedRecord.updatedAt, "string");
  assert.strictEqual(grantedRecord.updatedBy, "operator-1");

  const revoked = capability.revokeEntitlement(
    granted,
    "tenant-1",
    "FEATURE_A",
    "operator-2",
    "source-revoke",
    { reason: "deprovision" },
    () => null,
  );
  assert.ok(!isEntitlementError(revoked));
  assert.ok(isEntitlementState(revoked));

  const revokedRecord = revoked.entitlements[0];
  assert.strictEqual(revokedRecord.organisationId, "tenant-1");
  assert.strictEqual(revokedRecord.state, REVOKED_STATE);
  assert.strictEqual(revokedRecord.source, "source-revoke");
  assert.deepStrictEqual(revokedRecord.metadata, { reason: "deprovision" });
  assert.strictEqual(revokedRecord.updatedBy, "operator-2");
  assert.strictEqual(typeof revokedRecord.updatedAt, "string");

  const tenantView = capability.tenantSelfReadEntitlements(
    revoked,
    "tenant-1",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(tenantView));
  assert.deepStrictEqual(tenantView.result, [
    { entitlementKey: "FEATURE_A", state: REVOKED_STATE },
    { entitlementKey: "FEATURE_B", state: NOT_GRANTED_STATE },
  ]);

  const unknownKey = capability.validateEntitlementKey("UNKNOWN_FEATURE", revoked.catalogKeys);
  assert.ok(unknownKey !== null);
  assert.strictEqual(unknownKey.kind, "INVALID_KEY");
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
  assert.ok(isEntitlementError(unknownGrant));
  assert.strictEqual(unknownGrant.kind, "INVALID_KEY");
  assert.strictEqual(unknownAuditCount, 0);
  assert.strictEqual(state.entitlements.length, 0);

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
  assert.ok(isEntitlementError(invalidTenant));
  assert.strictEqual(invalidTenant.kind, "INVALID_TENANT");
  assert.strictEqual(tenantAuditCount, 0);
  assert.strictEqual(state.entitlements.length, 0);

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
  assert.ok(!isEntitlementError(writeState));
  assert.ok(isEntitlementState(writeState));

  const tenant2View = capability.tenantSelfReadEntitlements(
    writeState,
    "tenant-2",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(!isTenantViewError(tenant2View));
  assert.deepStrictEqual(tenant2View.result, [{ entitlementKey: "FEATURE_A", state: NOT_GRANTED_STATE }]);

  const unknownEvaluation = capability.evaluateAccess(
    state,
    "tenant-1",
    "UNKNOWN_FEATURE",
    [TENANT_READ_PERMISSION],
  );
  assert.ok(isAccessError(unknownEvaluation));
  assert.strictEqual(unknownEvaluation.kind, "INVALID_KEY");

  const unchangedRead = capability.tenantSelfReadEntitlements(state, "tenant-1", [TENANT_READ_PERMISSION]);
  assert.ok(!isTenantViewError(unchangedRead));
  assert.strictEqual(unchangedRead.result.length, 1);
});