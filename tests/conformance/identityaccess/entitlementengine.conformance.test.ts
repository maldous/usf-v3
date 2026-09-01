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

test("entitlementenginecontracts", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["KEY1", "KEY2"] as const,
  };
  const actorPermissions: readonly capability.EntitlementEnginePermission[] = [
    "TENANT_ENTITLEMENTS_READ",
    "PLATFORM_ENTITLEMENTS_READ",
    "PLATFORM_ENTITLEMENTS_WRITE",
  ];

  const tenantSelfReadResult = capability.tenantSelfReadEntitlements(
    state,
    "tenant1",
    actorPermissions,
  );
  assert.ok("result" in tenantSelfReadResult, "tenant self-read is a route");
  if ("result" in tenantSelfReadResult) {
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
  assert.ok("result" in operatorReadResult, "operator read is a route");

  const writeResult = capability.operatorWriteEntitlement(
    state,
    "tenant1",
    "KEY1",
    "GRANT",
    "op1",
    "source",
    {},
    actorPermissions,
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok(
    "entitlements" in writeResult,
    "operator write is a route that returns a state",
  );

  const evaluateResult = capability.evaluateAccess(
    state,
    "tenant1",
    "KEY1",
    actorPermissions,
  );
  assert.ok(
    "decision" in evaluateResult,
    "evaluate seam returns a decision object",
  );
  if ("decision" in evaluateResult) {
    assert.strictEqual(evaluateResult.decision, "DENIED");
  }

  const assertResult = capability.assertAccess(
    state,
    "tenant1",
    "KEY1",
    actorPermissions,
  );
  assert.strictEqual(assertResult, null);

  const catalogRead = capability.serviceCatalogRead(state);
  assert.deepEqual(catalogRead.result, ["KEY1", "KEY2"]);
});

test("entitlementengineerrormodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ["KNOWN"] as const,
  };
  const noPermissions: readonly capability.EntitlementEnginePermission[] = [];

  const invalidTenantError = capability.validateTenantId("");
  assert.ok(invalidTenantError !== null);
  assert.strictEqual(invalidTenantError?.kind, "INVALID_TENANT");

  const invalidKeyError = capability.validateEntitlementKey(
    "UNKNOWN",
    state.catalogKeys,
  );
  assert.ok(invalidKeyError !== null);
  assert.strictEqual(invalidKeyError?.kind, "INVALID_KEY");

  const forbiddenAssert = capability.assertAccess(
    state,
    "tenant1",
    "KNOWN",
    noPermissions,
  );
  assert.ok(forbiddenAssert !== null);
  assert.strictEqual(forbiddenAssert?.kind, "FORBIDDEN");

  const forbiddenEval = capability.evaluateAccess(
    state,
    "tenant1",
    "KNOWN",
    noPermissions,
  );
  assert.ok("kind" in forbiddenEval, "missing permission returns a typed error");
  if ("kind" in forbiddenEval) {
    assert.strictEqual(forbiddenEval.kind, "FORBIDDEN");
  }

  const tenantDeniedDecision = capability.evaluateAccess(
    state,
    "tenant1",
    "KNOWN",
    ["TENANT_ENTITLEMENTS_READ"] as const,
  );
  assert.ok("decision" in tenantDeniedDecision);
  if ("decision" in tenantDeniedDecision) {
    assert.strictEqual(tenantDeniedDecision.decision, "DENIED");
  }

  const degradedError: capability.EntitlementEngineError = {
    kind: "DEGRADED",
    message: "Provider failure",
  };
  const failingAudit = (
    _event: capability.EntitlementEngineAuditEvent,
  ): capability.EntitlementEngineError | null => degradedError;

  const grantResult = capability.grantEntitlement(
    state,
    "tenant1",
    "KNOWN",
    "op1",
    "source",
    {},
    failingAudit,
  );
  assert.ok("kind" in grantResult, "provider-fail audit returns a typed error");
  if ("kind" in grantResult) {
    assert.strictEqual(grantResult.kind, "DEGRADED");
  }

  const absentDecision = capability.evaluateEntitlement(state, "missing", "KNOWN");
  assert.strictEqual(absentDecision, "DENIED");
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

  const initialViewResult = capability.tenantSelfReadEntitlements(
    state,
    "t1",
    actorPermissions,
  );
  assert.ok("result" in initialViewResult);
  if ("result" in initialViewResult) {
    const view = initialViewResult.result;
    assert.strictEqual(view.length, 2);
    for (const v of view) {
      assert.strictEqual(v.state, "NOT_GRANTED");
    }
  }

  const absentDecision = capability.evaluateEntitlement(state, "t1", "A");
  assert.strictEqual(absentDecision, "DENIED");

  const grantResult = capability.operatorWriteEntitlement(
    state,
    "t1",
    "A",
    "GRANT",
    "op1",
    "src",
    {},
    actorPermissions,
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok("entitlements" in grantResult);
  if (!("entitlements" in grantResult)) return;

  const grantedViewResult = capability.tenantSelfReadEntitlements(
    grantResult,
    "t1",
    actorPermissions,
  );
  assert.ok("result" in grantedViewResult);
  if ("result" in grantedViewResult) {
    const view = grantedViewResult.result;
    const aEntry = view.find((v) => v.entitlementKey === "A");
    assert.ok(aEntry);
    assert.strictEqual(aEntry?.state, "GRANTED");
    const bEntry = view.find((v) => v.entitlementKey === "B");
    assert.ok(bEntry);
    assert.strictEqual(bEntry?.state, "NOT_GRANTED");
  }

  const revokeResult = capability.operatorWriteEntitlement(
    grantResult,
    "t1",
    "A",
    "REVOKE",
    "op2",
    "src2",
    {},
    actorPermissions,
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok("entitlements" in revokeResult);
  if (!("entitlements" in revokeResult)) return;

  const revokedViewResult = capability.tenantSelfReadEntitlements(
    revokeResult,
    "t1",
    actorPermissions,
  );
  assert.ok("result" in revokedViewResult);
  if ("result" in revokedViewResult) {
    const view = revokedViewResult.result;
    const aEntry = view.find((v) => v.entitlementKey === "A");
    assert.ok(aEntry);
    assert.strictEqual(aEntry?.state, "REVOKED");
  }

  const revokedAccessDecision = capability.evaluateEntitlement(revokeResult, "t1", "A");
  assert.strictEqual(revokedAccessDecision, "DENIED");

  const absentAccessDecision = capability.evaluateEntitlement(revokeResult, "t1", "B");
  assert.strictEqual(absentAccessDecision, "DENIED");

  const crossTenantView = capability.tenantSelfReadEntitlements(
    revokeResult,
    "t2",
    actorPermissions,
  );
  assert.ok("result" in crossTenantView);
  if ("result" in crossTenantView) {
    const view = crossTenantView.result;
    for (const v of view) {
      assert.strictEqual(v.state, "NOT_GRANTED");
    }
  }
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
  assert.ok("result" in tenantReadResult, "tenant read is allowed with TENANT_ENTITLEMENTS_READ");

  const operatorReadResult = capability.operatorReadEntitlements(
    state,
    "t1",
    tenantOnly,
  );
  assert.ok(
    "kind" in operatorReadResult,
    "operator read requires PLATFORM_ENTITLEMENTS_READ",
  );
  if ("kind" in operatorReadResult) {
    assert.strictEqual(operatorReadResult.kind, "FORBIDDEN");
  }

  const operatorWriteResult = capability.operatorWriteEntitlement(
    state,
    "t1",
    "X",
    "GRANT",
    "op1",
    "src",
    {},
    tenantOnly,
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok(
    "kind" in operatorWriteResult,
    "operator write requires PLATFORM_ENTITLEMENTS_WRITE",
  );
  if ("kind" in operatorWriteResult) {
    assert.strictEqual(operatorWriteResult.kind, "FORBIDDEN");
  }

  const evalBeforePerm = capability.evaluateAccess(state, "t1", "X", []);
  assert.ok("kind" in evalBeforePerm, "permission check fires before entitlement evaluation");
  if ("kind" in evalBeforePerm) {
    assert.strictEqual(evalBeforePerm.kind, "FORBIDDEN");
  }

  const assertBeforePerm = capability.assertAccess(state, "t1", "X", []);
  assert.ok(assertBeforePerm !== null);
  assert.strictEqual(assertBeforePerm?.kind, "FORBIDDEN");

  const platformOnly: readonly capability.EntitlementEnginePermission[] = [
    "PLATFORM_ENTITLEMENTS_READ",
    "PLATFORM_ENTITLEMENTS_WRITE",
  ];
  const opRead = capability.operatorReadEntitlements(state, "t1", platformOnly);
  assert.ok("result" in opRead, "platform permission grants operator read");

  const grantState = capability.operatorWriteEntitlement(
    state,
    "t1",
    "X",
    "GRANT",
    "op1",
    "src",
    {},
    platformOnly,
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok("entitlements" in grantState);
  if (!("entitlements" in grantState)) return;

  const crossView = capability.tenantSelfReadEntitlements(
    grantState,
    "t2",
    ["TENANT_ENTITLEMENTS_READ"] as const,
  );
  assert.ok("result" in crossView);
  if ("result" in crossView) {
    const view = crossView.result;
    const xEntry = view.find((v) => v.entitlementKey === "X");
    assert.ok(xEntry);
    assert.strictEqual(xEntry?.state, "NOT_GRANTED");
  }

  const operatorCrossView = capability.operatorReadEntitlements(
    grantState,
    "t2",
    platformOnly,
  );
  assert.ok("result" in operatorCrossView);
  if ("result" in operatorCrossView) {
    const view = operatorCrossView.result;
    const xEntry = view.find((v) => v.entitlementKey === "X");
    assert.ok(xEntry);
    assert.strictEqual(xEntry?.state, "NOT_GRANTED");
  }
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

  const denyByDefaultView = capability.tenantSelfReadEntitlements(
    state,
    "t0",
    actorPermissions,
  );
  assert.ok("result" in denyByDefaultView);
  if ("result" in denyByDefaultView) {
    const view = denyByDefaultView.result;
    assert.strictEqual(view.length, 1);
    assert.strictEqual(view[0].state, "NOT_GRANTED");
  }
  const denyByDefaultDecision = capability.evaluateEntitlement(state, "t0", "Z");
  assert.strictEqual(denyByDefaultDecision, "DENIED");

  const grantResult = capability.operatorWriteEntitlement(
    state,
    "t0",
    "Z",
    "GRANT",
    "opA",
    "src",
    {},
    actorPermissions,
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok("entitlements" in grantResult);
  if (!("entitlements" in grantResult)) return;

  const grantedView = capability.tenantSelfReadEntitlements(
    grantResult,
    "t0",
    actorPermissions,
  );
  assert.ok("result" in grantedView);
  if ("result" in grantedView) {
    const view = grantedView.result;
    assert.strictEqual(
      view.find((v) => v.entitlementKey === "Z")?.state,
      "GRANTED",
    );
  }

  const evaluateAfterGrant = capability.evaluateAccess(
    grantResult,
    "t0",
    "Z",
    actorPermissions,
  );
  assert.ok("decision" in evaluateAfterGrant);
  if ("decision" in evaluateAfterGrant) {
    assert.strictEqual(evaluateAfterGrant.decision, "ALLOWED");
  }

  const assertAfterGrant = capability.assertAccess(
    grantResult,
    "t0",
    "Z",
    actorPermissions,
  );
  assert.strictEqual(assertAfterGrant, null);

  const otherView = capability.tenantSelfReadEntitlements(
    grantResult,
    "t1",
    actorPermissions,
  );
  assert.ok("result" in otherView);
  if ("result" in otherView) {
    const view = otherView.result;
    assert.strictEqual(
      view.find((v) => v.entitlementKey === "Z")?.state,
      "NOT_GRANTED",
    );
  }

  const catalog = capability.serviceCatalogRead(grantResult);
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

  const viewBefore = capability.tenantSelfReadEntitlements(
    state,
    "tenantX",
    actorPermissions,
  );
  assert.ok("result" in viewBefore);
  if ("result" in viewBefore) {
    const view = viewBefore.result;
    assert.strictEqual(view.length, 1);
    assert.strictEqual(view[0].entitlementKey, "READ");
    assert.strictEqual(view[0].state, "NOT_GRANTED");
  }

  const auditError: capability.EntitlementEngineError = {
    kind: "AUDIT_FAILURE",
    message: "failure",
  };
  const failingAudit = (
    _event: capability.EntitlementEngineAuditEvent,
  ): capability.EntitlementEngineError | null => auditError;

  const failedGrant = capability.grantEntitlement(
    state,
    "tenantX",
    "READ",
    "op",
    "src",
    {},
    failingAudit,
  );
  assert.ok("kind" in failedGrant);
  if ("kind" in failedGrant) {
    assert.strictEqual(failedGrant.kind, "AUDIT_FAILURE");
  }
  assert.strictEqual(state.entitlements.length, 0);

  const successfulGrant = capability.grantEntitlement(
    state,
    "tenantX",
    "READ",
    "op",
    "src",
    {},
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok("entitlements" in successfulGrant);
  if (!("entitlements" in successfulGrant)) return;

  const viewAfter = capability.tenantSelfReadEntitlements(
    successfulGrant,
    "tenantX",
    actorPermissions,
  );
  assert.ok("result" in viewAfter);
  if ("result" in viewAfter) {
    const view = viewAfter.result;
    const entry = view.find((v) => v.entitlementKey === "READ");
    assert.ok(entry);
    assert.strictEqual(entry?.state, "GRANTED");
  }

  const repeatedView = capability.tenantSelfReadEntitlements(
    successfulGrant,
    "tenantX",
    actorPermissions,
  );
  assert.ok("result" in repeatedView);
  if ("result" in viewAfter && "result" in repeatedView) {
    assert.deepEqual(repeatedView.result, viewAfter.result);
  }
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

  assert.strictEqual(record.organisationId, "org1");
  assert.strictEqual(record.entitlementKey, "key1");
  assert.strictEqual(record.state, "GRANTED");
  assert.strictEqual(record.source, "src");
  assert.strictEqual(record.metadata.foo, "bar");
  assert.strictEqual(record.updatedBy, "user1");

  const view = capability.projectTenantView(state, "org1");
  assert.strictEqual(view.length, 1);
  assert.strictEqual(view[0].entitlementKey, "key1");
  assert.strictEqual(view[0].state, "GRANTED");

  const missingView = capability.projectTenantView(state, "org2");
  assert.strictEqual(missingView.length, 1);
  assert.strictEqual(missingView[0].state, "NOT_GRANTED");

  const revokedRecord: capability.EntitlementRecord = {
    organisationId: "org1",
    entitlementKey: "key1",
    state: "REVOKED",
    source: "src",
    metadata: {},
    updatedAt: new Date().toISOString(),
    updatedBy: "user2",
  };
  const revokedState: capability.EntitlementEngineState = {
    entitlements: [revokedRecord],
    catalogKeys: ["key1"] as const,
  };
  const revokedView = capability.projectTenantView(revokedState, "org1");
  assert.strictEqual(revokedView[0].state, "REVOKED");
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
  assert.ok(emptyTenantError !== null);
  assert.strictEqual(emptyTenantError?.kind, "INVALID_TENANT");

  const emptyKeyError = capability.validateEntitlementKey("", state.catalogKeys);
  assert.ok(emptyKeyError !== null);
  assert.strictEqual(emptyKeyError?.kind, "INVALID_KEY");

  const unknownKeyError = capability.validateEntitlementKey(
    "UNKNOWN",
    state.catalogKeys,
  );
  assert.ok(unknownKeyError !== null);
  assert.strictEqual(unknownKeyError?.kind, "INVALID_KEY");

  const originalLength = state.entitlements.length;
  const invalidGrant = capability.grantEntitlement(
    state,
    "",
    "ALLOWED",
    "op1",
    "src",
    {},
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok("kind" in invalidGrant, "invalid tenant does not change state");
  if ("kind" in invalidGrant) {
    assert.strictEqual(invalidGrant.kind, "INVALID_TENANT");
  }
  assert.strictEqual(state.entitlements.length, originalLength);

  const unknownKeyGrant = capability.grantEntitlement(
    state,
    "tenant1",
    "UNKNOWN",
    "op1",
    "src",
    {},
    (_event: capability.EntitlementEngineAuditEvent): null => null,
  );
  assert.ok("kind" in unknownKeyGrant, "unknown key does not change state");
  if ("kind" in unknownKeyGrant) {
    assert.strictEqual(unknownKeyGrant.kind, "INVALID_KEY");
  }
  assert.strictEqual(state.entitlements.length, originalLength);

  let auditCalled = false;
  const spyAudit = (
    _event: capability.EntitlementEngineAuditEvent,
  ): null => {
    auditCalled = true;
    return null;
  };
  const unknownWithSpy = capability.grantEntitlement(
    state,
    "tenant1",
    "UNKNOWN",
    "op1",
    "src",
    {},
    spyAudit,
  );
  assert.ok("kind" in unknownWithSpy);
  if ("kind" in unknownWithSpy) {
    assert.strictEqual(unknownWithSpy.kind, "INVALID_KEY");
  }
  assert.strictEqual(auditCalled, false, "unknown keys are rejected without audit");

  const successfulGrant = capability.grantEntitlement(
    state,
    "tenant1",
    "ALLOWED",
    "op1",
    "src",
    {},
    spyAudit,
  );
  assert.ok("entitlements" in successfulGrant);
  if (!("entitlements" in successfulGrant)) return;

  const crossView = capability.tenantSelfReadEntitlements(
    successfulGrant,
    "tenant2",
    ["TENANT_ENTITLEMENTS_READ"] as const,
  );
  assert.ok("result" in crossView);
  if ("result" in crossView) {
    const view = crossView.result;
    const entry = view.find((v) => v.entitlementKey === "ALLOWED");
    assert.ok(entry);
    assert.strictEqual(entry?.state, "NOT_GRANTED");
  }
});