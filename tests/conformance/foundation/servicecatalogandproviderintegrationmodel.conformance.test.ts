import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/foundation/servicecatalogandproviderintegrationmodel.ts";

function makeEntry(overrides: Partial<capability.ServiceCatalogEntry> = {}): capability.ServiceCatalogEntry {
  return {
    id: "svc-default",
    key: "svc-default",
    name: "DefaultService",
    category: "compute",
    visibility: "tenant_scoped_safe",
    integrationDecision: "build",
    entitlementKey: "ent-default",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: false,
    ...overrides,
  };
}

function makeModel(entries: ReadonlyArray<capability.ServiceCatalogEntry>, degraded = false): capability.ServiceCatalogModel {
  const resources = new Map<string, capability.ServiceCatalogEntry>();
  for (const e of entries) resources.set(e.id, e);
  return {
    resources,
    lastAuditEvent: null,
    lastDecision: null,
    lastError: null,
    readiness: "NOT_READY",
    degraded,
  };
}

test("servicecatalogandproviderintegrationmodelauditmodel", () => {
  const auditEvent: capability.AuditEvent = {
    kind: "AUDIT_BEFORE_CHANGE",
    resource: "test-service",
    operation: "register",
    actor: "tenant-123",
    timestamp: new Date().toISOString(),
  };
  const updatedState = capability.applyAuditToState(capability.initialModel, auditEvent);
  assert.strictEqual(updatedState.lastAuditEvent?.kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(updatedState.lastAuditEvent?.resource, "test-service");
  assert.strictEqual(updatedState.lastAuditEvent?.actor, "tenant-123");

  const auditResult = capability.recordAuditBeforeMutation(
    "test-service",
    "register",
    "tenant-123",
    "success"
  );
  assert.strictEqual(auditResult.outcome, "success");
  assert.strictEqual(auditResult.kind, "AUDIT_BEFORE_CHANGE");

  const failingAudit = (_e: capability.AuditEvent): capability.TypedError | null =>
    capability.createAuditFailureError("audit failed");
  const regResult = capability.registerService(
    capability.initialModel,
    makeEntry({ id: "audit-svc", key: "audit-svc", name: "AuditService", category: "compute", visibility: "global_only", integrationDecision: "build", entitlementKey: "ent-audit", readiness: "READY", providerDetails: {}, consoleAccessFlag: false }),
    failingAudit
  );
  assert.ok(capability.isTypedError(regResult));
  if (capability.isTypedError(regResult)) {
    assert.strictEqual(regResult.kind, "AUDIT_FAILURE");
  }

  const degradedModel = makeModel([], true);
  const r = capability.registerService(degradedModel, makeEntry({ id: "x", key: "x", name: "X", category: "c", visibility: "global_only", integrationDecision: "build", entitlementKey: "e", readiness: "READY", providerDetails: {}, consoleAccessFlag: false }), () => null);
  assert.ok(capability.isTypedError(r));
  if (capability.isTypedError(r)) {
    assert.strictEqual(r.kind, "DEGRADED_FAILURE");
  }
});

test("servicecatalogandproviderintegrationmodelcontracts", () => {
  const model = makeModel([
    makeEntry({
      id: "svc-1",
      key: "svc-1",
      name: "TestService",
      category: "compute",
      visibility: "tenant_scoped_safe",
      integrationDecision: "build",
      entitlementKey: "ent-1",
      readiness: "READY",
      providerDetails: {},
      consoleAccessFlag: true,
    }),
  ]);

  const token: capability.TenantToken = {
    tenantId: "tenant-456",
    entitlements: ["ent-1"],
  };
  const filtered = capability.getPlatformServiceCatalog(model, token);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].name, "TestService");
  assert.strictEqual(filtered[0].visibility, "tenant_scoped_safe");
  assert.strictEqual(filtered[0].integrationDecision, "build");
  assert.strictEqual(filtered[0].entitlementKey, "ent-1");
  assert.strictEqual(filtered[0].readiness, "READY");

  const noTokenView = capability.getPlatformServiceCatalog(model, undefined);
  assert.strictEqual(noTokenView.length, 0);

  const catalog = capability.getCatalog(model);
  assert.strictEqual(catalog.length, 1);
  assert.strictEqual(catalog[0].key, "svc-1");
  assert.strictEqual(catalog[0].category, "compute");

  const readinessSurface = capability.getPlatformServicesReadiness(model);
  assert.strictEqual(typeof readinessSurface.status, "string");
  assert.strictEqual(readinessSurface.servicesCount, 1);
});

test("servicecatalogandproviderintegrationmodelerrormodel", () => {
  const unavailableError = capability.handleProviderFailure("unavailable");
  assert.strictEqual(unavailableError.kind, "SERVER_UNAVAILABLE");
  assert.ok(unavailableError.message.includes("unavailable"));
  assert.strictEqual(unavailableError.isError, true);

  const timeoutError = capability.handleProviderFailure("timeout");
  assert.strictEqual(timeoutError.kind, "SERVER_UNAVAILABLE");

  const otherError = capability.handleProviderFailure("something-else");
  assert.strictEqual(otherError.kind, "DEGRADED_FAILURE");
  assert.ok(otherError.message.includes("something-else"));

  const auditFailure = capability.createAuditFailureError("audit denied");
  assert.strictEqual(auditFailure.kind, "AUDIT_FAILURE");
  assert.strictEqual(auditFailure.statusCode, 403);

  const isolationErr = capability.createTenantIsolationViolationError("isolation");
  assert.strictEqual(isolationErr.kind, "TENANT_ISOLATION_VIOLATION");

  const degradedModel = makeModel([], true);
  const updateResult = capability.updateServiceState(
    degradedModel,
    "anything",
    { name: "X" },
    () => null
  );
  assert.ok(capability.isTypedError(updateResult));
  if (capability.isTypedError(updateResult)) {
    assert.strictEqual(updateResult.kind, "DEGRADED_FAILURE");
  }
});

test("servicecatalogandproviderintegrationmodellifecycle", () => {
  const service: Omit<capability.ServiceCatalogEntry, "id"> = {
    key: "lifecycle-1",
    name: "LifecycleService",
    category: "storage",
    visibility: "global_only",
    integrationDecision: "compose",
    entitlementKey: "ent-lifecycle",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: false,
  };

  const auditFn = (_event: capability.AuditEvent): capability.TypedError | null => null;
  const reg = capability.registerService(capability.initialModel, service, auditFn);
  assert.ok(!capability.isTypedError(reg));
  if (!capability.isTypedError(reg)) {
    assert.strictEqual(reg.lastDecision, "GRANTED");
    assert.strictEqual(reg.resources.size, 1);
    assert.strictEqual(reg.lastAuditEvent?.operation, "register");
    const entry = reg.resources.get("lifecycle-1");
    assert.ok(entry);
    assert.strictEqual(entry?.name, "LifecycleService");
    assert.strictEqual(entry?.integrationDecision, "compose");
    assert.deepStrictEqual(entry?.proofReferences, [
      "proof:platform-services",
      "proof:service-clickthrough-policy",
      "proof:service-catalog-registry",
      "proof:entitlements-routes",
    ]);
  }

  const regResult = capability.registerService(capability.initialModel, service, auditFn);
  if (capability.isTypedError(regResult)) {
    throw new Error("register failed unexpectedly");
  }
  const updated = capability.updateServiceState(
    regResult,
    "lifecycle-1",
    { readiness: "DEGRADED" },
    auditFn
  );
  assert.ok(!capability.isTypedError(updated));
  if (!capability.isTypedError(updated)) {
    const entry = updated.resources.get("lifecycle-1");
    assert.strictEqual(entry?.readiness, "DEGRADED");
    assert.strictEqual(updated.lastAuditEvent?.operation, "update");
  }

  const toUnregister = capability.registerService(capability.initialModel, service, auditFn);
  if (capability.isTypedError(toUnregister)) {
    throw new Error("register failed unexpectedly");
  }
  const unreg = capability.unregisterService(toUnregister, "lifecycle-1", auditFn);
  assert.ok(!capability.isTypedError(unreg));
  if (!capability.isTypedError(unreg)) {
    assert.strictEqual(unreg.resources.size, 0);
    assert.strictEqual(unreg.lastAuditEvent?.operation, "unregister");
  }

  const toIntegrate = capability.registerService(capability.initialModel, service, auditFn);
  if (capability.isTypedError(toIntegrate)) {
    throw new Error("register failed unexpectedly");
  }
  const integrated = capability.updateIntegration(
    toIntegrate,
    "lifecycle-1",
    "adapter",
    "ent-new",
    auditFn
  );
  assert.ok(!capability.isTypedError(integrated));
  if (!capability.isTypedError(integrated)) {
    const entry = integrated.resources.get("lifecycle-1");
    assert.strictEqual(entry?.integrationDecision, "adapter");
    assert.strictEqual(entry?.entitlementKey, "ent-new");
  }

  const recovery = capability.recoverPlatformServices(
    capability.initialModel,
    [
      makeEntry({
        id: "svc-1",
        key: "svc-1",
        name: "LifecycleService",
        category: "storage",
        visibility: "global_only",
        integrationDecision: "compose",
        entitlementKey: "ent-lifecycle",
        readiness: "READY",
        providerDetails: {},
        consoleAccessFlag: false,
      }),
    ],
    auditFn
  );
  assert.ok(!capability.isTypedError(recovery));
  if (!capability.isTypedError(recovery)) {
    assert.strictEqual(recovery.resources.size, 1);
    assert.strictEqual(capability.verifyPromotionLineage(recovery), true);
  }

  const recoveryFails = capability.recoverPlatformServices(
    capability.initialModel,
    [],
    auditFn
  );
  assert.ok(capability.isTypedError(recoveryFails));
  if (capability.isTypedError(recoveryFails)) {
    assert.strictEqual(recoveryFails.kind, "POLICY_DENIED");
  }
});

test("servicecatalogandproviderintegrationmodelpermissions", () => {
  const entry: capability.ServiceCatalogEntry = makeEntry({
    id: "perm-1",
    key: "perm-1",
    name: "PermService",
    category: "network",
    visibility: "tenant_scoped_safe",
    integrationDecision: "adapter",
    entitlementKey: "ent-perm",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: true,
  });

  const adminToken: capability.TenantToken = {
    authLevel: "admin",
    tenantId: "tenant-456",
    entitlements: ["ent-perm"],
    permissions: ["read"],
  };
  assert.strictEqual(capability.validatePermission("perm-1", "admin", adminToken), true);

  const permToken: capability.TenantToken = {
    permissions: ["admin"],
    tenantId: "tenant-456",
    entitlements: ["ent-perm"],
  };
  assert.strictEqual(capability.validatePermission("perm-1", "admin", permToken), true);

  const userToken: capability.TenantToken = {
    authLevel: "user",
    tenantId: "tenant-456",
    entitlements: ["ent-perm"],
  };
  assert.strictEqual(capability.validatePermission("perm-1", "admin", userToken), false);

  assert.strictEqual(capability.validatePermission("perm-1", "admin", null), false);
  assert.strictEqual(capability.validatePermission("perm-1", "admin", undefined), false);

  const isolatedEntry: capability.ServiceCatalogEntry = { ...entry, visibility: "not_exposed" };
  assert.strictEqual(capability.checkTenantIsolation(isolatedEntry, "tenant-456"), false);

  assert.strictEqual(capability.checkTenantIsolation({ ...entry, visibility: "global_only" }, ""), true);

  assert.strictEqual(capability.checkTenantIsolation({ ...entry, visibility: "tenant_scoped_safe" }, ""), false);
  assert.strictEqual(capability.checkTenantIsolation({ ...entry, visibility: "tenant_scoped_safe" }, "tenant-456"), true);

  const tenantToken: capability.TenantToken = {
    tenantId: "tenant-456",
    entitlements: ["ent-perm"],
  };
  assert.strictEqual(capability.checkTenantAccess(entry, tenantToken), true);

  const wrongEntitlementToken: capability.TenantToken = {
    tenantId: "tenant-456",
    entitlements: ["other"],
  };
  assert.strictEqual(capability.checkTenantAccess(entry, wrongEntitlementToken), false);

  const emptyTenantToken: capability.TenantToken = {
    tenantId: "",
    entitlements: ["ent-perm"],
  };
  assert.strictEqual(capability.checkTenantAccess(entry, emptyTenantToken), false);

  const notExposedEntry: capability.ServiceCatalogEntry = { ...entry, visibility: "not_exposed" };
  assert.strictEqual(capability.checkTenantAccess(notExposedEntry, tenantToken), false);
});

test("servicecatalogandproviderintegrationmodelproof", () => {
  const validEntry = makeEntry({
    id: "proof-1",
    key: "proof-1",
    name: "ProofService",
    category: "analytics",
    visibility: "global_only",
    integrationDecision: "build",
    entitlementKey: "ent-proof",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: true,
  });
  const modelWithService = makeModel([validEntry]);

  assert.strictEqual(capability.provePlatformServices(modelWithService), true);
  assert.strictEqual(capability.proveServiceClickthroughPolicy(modelWithService), true);
  assert.strictEqual(capability.proveServiceCatalogRegistry(modelWithService), true);
  assert.strictEqual(capability.proveEntitlementsRoutes(modelWithService), true);
  assert.strictEqual(capability.runAllProofs(modelWithService), true);
  assert.strictEqual(capability.verifyPromotionLineage(modelWithService), true);

  const emptyModel = capability.initialModel;
  assert.strictEqual(capability.provePlatformServices(emptyModel), false);
  assert.strictEqual(capability.proveServiceClickthroughPolicy(emptyModel), false);
  assert.strictEqual(capability.proveServiceCatalogRegistry(emptyModel), false);
  assert.strictEqual(capability.proveEntitlementsRoutes(emptyModel), false);
  assert.strictEqual(capability.runAllProofs(emptyModel), false);

  const clickthroughViolatingEntry = makeEntry({
    id: "bad-1",
    key: "bad-1",
    name: "BadService",
    category: "compute",
    visibility: "not_exposed",
    integrationDecision: "build",
    entitlementKey: "ent-bad",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: true,
  });
  const clickthroughBadModel = makeModel([validEntry, clickthroughViolatingEntry]);
  assert.strictEqual(capability.proveServiceClickthroughPolicy(clickthroughBadModel), false);

  const noEntitlementEntry = makeEntry({
    id: "ne-1",
    key: "ne-1",
    name: "NoEntService",
    category: "compute",
    visibility: "global_only",
    integrationDecision: "build",
    entitlementKey: "",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: false,
  });
  const noEntitlementModel = makeModel([noEntitlementEntry]);
  assert.strictEqual(capability.proveEntitlementsRoutes(noEntitlementModel), false);
});

test("servicecatalogandproviderintegrationmodelreadinessmodel", () => {
  const readyEntry = makeEntry({
    id: "ready-1",
    key: "ready-1",
    name: "ReadyService",
    category: "compute",
    visibility: "tenant_scoped_safe",
    integrationDecision: "build",
    entitlementKey: "ent-ready",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: false,
  });
  const readyModel = makeModel([readyEntry]);
  assert.strictEqual(capability.determineReadiness(readyModel), "READY");
  assert.strictEqual(capability.getReadiness(readyModel), readyModel.readiness);

  const notReadyEntry = makeEntry({
    id: "not-ready-1",
    key: "not-ready-1",
    name: "NotReadyService",
    category: "compute",
    visibility: "tenant_scoped_safe",
    integrationDecision: "build",
    entitlementKey: "ent-not-ready",
    readiness: "NOT_READY",
    providerDetails: {},
    consoleAccessFlag: false,
  });
  const notReadyModel = makeModel([notReadyEntry]);
  assert.strictEqual(capability.determineReadiness(notReadyModel), "NOT_READY");

  const degradedEntry = makeEntry({
    id: "deg-1",
    key: "deg-1",
    name: "DegradedService",
    category: "compute",
    visibility: "tenant_scoped_safe",
    integrationDecision: "build",
    entitlementKey: "ent-deg",
    readiness: "DEGRADED",
    providerDetails: {},
    consoleAccessFlag: false,
  });
  const degradedOnlyModel = makeModel([degradedEntry]);
  assert.strictEqual(capability.determineReadiness(degradedOnlyModel), "DEGRADED");

  const mixedModel = makeModel([readyEntry, degradedEntry]);
  assert.strictEqual(capability.determineReadiness(mixedModel), "DEGRADED");

  const emptyModel = makeModel([]);
  assert.strictEqual(capability.determineReadiness(emptyModel), "NOT_READY");

  const explicitDegraded = makeModel([readyEntry], true);
  assert.strictEqual(capability.determineReadiness(explicitDegraded), "DEGRADED");

  const surface = capability.getPlatformServicesReadiness(readyModel);
  assert.strictEqual(typeof surface.status, "string");
  assert.strictEqual(typeof surface.proofsPassed, "boolean");
  assert.strictEqual(surface.servicesCount, 1);
});

test("servicecatalogandproviderintegrationmodelstatemodel", () => {
  const service: Omit<capability.ServiceCatalogEntry, "id"> = {
    key: "state-svc",
    name: "StateService",
    category: "database",
    visibility: "not_exposed",
    integrationDecision: "defer",
    entitlementKey: "ent-state",
    readiness: "NOT_READY",
    providerDetails: { config: "value" },
    consoleAccessFlag: false,
    environmentModel: "v1",
  };
  const auditFn = (_e: capability.AuditEvent): capability.TypedError | null => null;
  const reg = capability.registerService(capability.initialModel, service, auditFn);
  assert.ok(!capability.isTypedError(reg));
  if (!capability.isTypedError(reg)) {
    const entry = reg.resources.get("state-svc");
    assert.ok(entry);
    if (!entry) throw new Error("entry missing");
    assert.strictEqual(entry.id, "state-svc");
    assert.strictEqual(entry.key, "state-svc");
    assert.strictEqual(entry.name, "StateService");
    assert.strictEqual(entry.category, "database");
    assert.strictEqual(entry.environmentModel, "v1");
    assert.strictEqual(entry.visibility, "not_exposed");
    assert.strictEqual(entry.integrationDecision, "defer");
    assert.strictEqual(entry.entitlementKey, "ent-state");
    assert.strictEqual(entry.readiness, "NOT_READY");
    assert.deepStrictEqual(entry.providerDetails, { config: "value" });
    assert.strictEqual(entry.consoleAccessFlag, false);
    assert.ok(Array.isArray(entry.proofReferences));
  }

  assert.strictEqual(capability.initialModel.lastAuditEvent, null);
  assert.strictEqual(capability.initialModel.lastDecision, null);
  assert.strictEqual(capability.initialModel.lastError, null);
  assert.strictEqual(capability.initialModel.readiness, "NOT_READY");
  assert.strictEqual(capability.initialModel.degraded, false);
});

test("servicecatalogandproviderintegrationmodelvalidation", () => {
  const validService: Omit<capability.ServiceCatalogEntry, "id"> = {
    key: "valid-1",
    name: "ValidService",
    category: "storage",
    visibility: "global_only",
    integrationDecision: "reject",
    entitlementKey: "ent-valid",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: true,
  };
  assert.strictEqual(capability.validateCatalogEntry(validService), null);

  const emptyName: Omit<capability.ServiceCatalogEntry, "id"> = {
    ...validService,
    name: "",
  };
  const emptyNameErr = capability.validateCatalogEntry(emptyName);
  assert.ok(emptyNameErr !== null);
  if (emptyNameErr !== null) {
    assert.strictEqual(emptyNameErr.kind, "CONFIGURATION_INVALID");
  }

  const badVisibility = {
    ...validService,
    visibility: "bogus" as capability.Visibility,
  };
  const badVisibilityErr = capability.validateCatalogEntry(badVisibility);
  assert.ok(badVisibilityErr !== null);
  if (badVisibilityErr !== null) {
    assert.strictEqual(badVisibilityErr.kind, "CONFIGURATION_INVALID");
  }

  const unexposedWithConsole = {
    ...validService,
    visibility: "not_exposed" as const,
    consoleAccessFlag: true,
  };
  const isolationErr = capability.validateCatalogEntry(unexposedWithConsole);
  assert.ok(isolationErr !== null);
  if (isolationErr !== null) {
    assert.strictEqual(isolationErr.kind, "TENANT_ISOLATION_VIOLATION");
  }

  const auditFn = (_e: capability.AuditEvent): capability.TypedError | null => null;
  const invalidReg = capability.registerService(
    capability.initialModel,
    { ...validService, visibility: "not_exposed" as const, consoleAccessFlag: true },
    auditFn
  );
  assert.ok(capability.isTypedError(invalidReg));
  if (capability.isTypedError(invalidReg)) {
    assert.strictEqual(invalidReg.kind, "TENANT_ISOLATION_VIOLATION");
  }
});