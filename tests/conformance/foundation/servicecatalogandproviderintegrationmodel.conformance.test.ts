import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/servicecatalogandproviderintegrationmodel.ts";

function makeEntry(
  overrides: Partial<capability.ServiceCatalogEntry> = {}
): capability.ServiceCatalogEntry {
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

function isModel(value: capability.ServiceCatalogModel | capability.TypedError): value is capability.ServiceCatalogModel {
  return !capability.isTypedError(value);
}

test("servicecatalogandproviderintegrationmodelauditmodel", () => {
  const auditFn = (_event: capability.AuditEvent): capability.TypedError | null => null;

  const auditResult = capability.recordAuditBeforeMutation(
    "test-service",
    "register",
    "tenant-123",
    "success"
  );
  assert.strictEqual(auditResult.kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditResult.resource, "test-service");
  assert.strictEqual(auditResult.actor, "tenant-123");
  assert.strictEqual(auditResult.outcome, "success");

  const auditEvent: capability.AuditEvent = {
    kind: "AUDIT_BEFORE_CHANGE",
    resource: "test-service",
    operation: "register",
    actor: "tenant-123",
    timestamp: new Date().toISOString(),
  };
  const modelWithAudit = capability.applyAuditToState(capability.initialModel, auditEvent);
  assert.strictEqual(modelWithAudit.auditEvidencePreserved, true);

  const service: Omit<capability.ServiceCatalogEntry, "id"> = {
    key: "audit-svc",
    name: "AuditService",
    category: "compute",
    visibility: "global_only",
    integrationDecision: "build",
    entitlementKey: "ent-audit",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: false,
  };

  const reg = capability.registerService(capability.initialModel, service, auditFn);
  assert.ok(isModel(reg));
  if (isModel(reg)) {
    assert.strictEqual(reg.lastAuditEvent?.kind, "AUDIT_BEFORE_CHANGE");
    assert.strictEqual(reg.auditEvidencePreserved, true);
    assert.strictEqual(reg.tenantBoundaryPreserved, true);
  }

  const failingAudit = (_e: capability.AuditEvent): capability.TypedError | null =>
    capability.createAuditFailureError("audit failed");
  const failResult = capability.registerService(
    capability.initialModel,
    service,
    failingAudit
  );
  assert.ok(capability.isTypedError(failResult));
  if (capability.isTypedError(failResult)) {
    assert.strictEqual(failResult.kind, "AUDIT_FAILURE");
  }

  const recoveryEntries: ReadonlyArray<capability.ServiceCatalogEntry> = [
    makeEntry({ id: "rec-1", key: "rec-1" }),
  ];
  const recovery = capability.recoverPlatformServices(
    capability.initialModel,
    recoveryEntries,
    auditFn
  );
  assert.ok(isModel(recovery));
  if (isModel(recovery)) {
    assert.strictEqual(recovery.lastAuditEvent?.operation, "recover");
    assert.strictEqual(recovery.auditEvidencePreserved, true);
    assert.strictEqual(recovery.tenantBoundaryPreserved, true);
  }

  const degraded = capability.reportObservabilityAdapterLoss(
    capability.initialModel,
    "adapters down"
  );
  assert.strictEqual(capability.isAuditEvidencePreserved(degraded), true);
  const surface = capability.readReadinessSurface(degraded);
  assert.strictEqual(surface.readOnly, true);
  assert.strictEqual(surface.auditEvidencePreserved, true);
  assert.strictEqual(surface.tenantBoundaryPreserved, true);
});

test("servicecatalogandproviderintegrationmodelcontracts", () => {
  const validEntry = makeEntry({
    id: "contract-1",
    key: "contract-1",
    visibility: "global_only",
  });
  const modelWithService: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map([["contract-1", validEntry]]),
  };

  const surface = capability.getContractSurface();
  assert.strictEqual(surface.endpoint, "GET /api/platform/service-catalog");
  assert.strictEqual(surface.version, "catalog-v2");
  assert.ok(surface.configKeys.includes("providerAdapters"));

  assert.throws(
    () => capability.readProviderConfig({}, "providerAdapters"),
    (err: unknown) => capability.isTypedError(err) && err.kind === "CONFIGURATION_INVALID"
  );

  assert.throws(
    () => capability.resolveProviderDetails({}, "missing"),
    (err: unknown) => capability.isTypedError(err) && err.kind === "CONFIGURATION_INVALID"
  );

  const readResult = capability.readPlatformServiceCatalog(modelWithService);
  assert.strictEqual(readResult.isError, false);
  if (!readResult.isError) {
    assert.strictEqual(readResult.entries.length, 1);
    assert.strictEqual(readResult.version, "catalog-v2");
  }

  const config: Record<string, unknown> = {
    providerAdapters: new Map<string, unknown>([["foo", { hello: "world" }]]),
  };
  const port = capability.makeProviderPort("primary", config);
  const resolved = capability.resolveThroughPort(port, "foo");
  assert.ok(typeof resolved === "object" && resolved !== null);
});

test("servicecatalogandproviderintegrationmodelerrormodel", () => {
  const unavailableError = capability.handleProviderFailure("unavailable");
  assert.strictEqual(unavailableError.kind, "SERVER_UNAVAILABLE");
  assert.strictEqual(unavailableError.statusCode, 503);

  const timeoutError = capability.handleProviderFailure("timeout");
  assert.strictEqual(timeoutError.kind, "SERVER_UNAVAILABLE");

  const otherError = capability.handleProviderFailure("something-else");
  assert.strictEqual(otherError.kind, "DEGRADED_FAILURE");

  const updated = capability.updateServiceState(
    capability.initialModel,
    "anything",
    { name: "X" },
    () => null
  );
  assert.ok(capability.isTypedError(updated));
  if (capability.isTypedError(updated)) {
    assert.strictEqual(updated.kind, "POLICY_DENIED");
  }

  const reported = capability.reportObservabilityAdapterLoss(
    capability.initialModel,
    "adapters down"
  );
  assert.strictEqual(reported.observabilityAdaptersAvailable, false);
  assert.strictEqual(reported.degraded, true);
  assert.strictEqual(capability.canMutateInCurrentMode(reported), false);
  assert.strictEqual(reported.readiness, "DEGRADED");

  const signalMissing: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    tenantIsolationSignal: false,
  };
  assert.strictEqual(capability.detectMissingTenantIsolationOrAuditSignal(signalMissing), true);
  const alert = capability.raiseTenantDataOrSecurityAlert(signalMissing);
  assert.strictEqual(alert.kind, "TENANT_ISOLATION_VIOLATION");

  assert.strictEqual(capability.readReadinessSurface(reported).isError, false);
  assert.strictEqual(capability.readReadinessSurface(reported).readOnly, true);
});

test("servicecatalogandproviderintegrationmodellifecycle", () => {
  const contract = capability.getLifecycleContract();
  assert.strictEqual(contract.capability, "servicecatalogandproviderintegrationmodel");
  assert.strictEqual(contract.contractVersion, "V1");
  assert.strictEqual(contract.catalogEndpoint, "GET /api/platform/service-catalog");
  assert.strictEqual(contract.catalogVersion, "catalog-v2");
  assert.strictEqual(contract.touchesTenantData, true);
  assert.ok(contract.backedBy.includes("provider"));
  assert.ok(contract.backedBy.includes("database"));

  const proofs = capability.getRequiredProofsForPromotion();
  assert.ok(proofs.includes("proof:platform-services"));
  assert.ok(proofs.includes("proof:service-clickthrough-policy"));
  assert.ok(proofs.includes("proof:service-catalog-registry"));
  assert.ok(proofs.includes("proof:entitlements-routes"));

  const endpoints = capability.getLifecycleEndpoints();
  assert.ok(endpoints.includes("GET /api/platform/service-catalog"));

  const auditFn = (_event: capability.AuditEvent): capability.TypedError | null => null;

  const service: Omit<capability.ServiceCatalogEntry, "id"> = {
    key: "lifecycle-1",
    name: "LifecycleService",
    category: "storage",
    visibility: "global_only",
    integrationDecision: "compose",
    entitlementKey: "ent-lifecycle",
    readiness: "READY",
    providerDetails: {},
    consoleAccessFlag: true,
  };

  const reg = capability.registerService(capability.initialModel, service, auditFn);
  assert.ok(isModel(reg));
  if (isModel(reg)) {
    assert.strictEqual(reg.resources.size, 1);
    assert.strictEqual(reg.lifecycleContractUnchanged, true);
  }

  const recoveryEntries: ReadonlyArray<capability.ServiceCatalogEntry> = [
    makeEntry({ id: "svc-recover", key: "svc-recover" }),
  ];

  const recovery = capability.recoverPlatformServices(
    capability.initialModel,
    recoveryEntries,
    auditFn
  );
  assert.ok(isModel(recovery));
  if (isModel(recovery)) {
    assert.strictEqual(capability.verifyPromotionLineage(recovery), true);
    assert.strictEqual(capability.reRunPromotionProofs(recovery), true);
    assert.strictEqual(capability.mayContinuePromotion(recovery), true);
  }
});

test("servicecatalogandproviderintegrationmodelpermissions", () => {
  const entry: capability.ServiceCatalogEntry = makeEntry({
    id: "perm-1",
    key: "perm-1",
    visibility: "tenant_scoped_safe",
    integrationDecision: "adapter",
  });

  const adminToken: capability.TenantToken = {
    authLevel: "admin",
    tenantId: "tenant-456",
    entitlements: ["ent-perm"],
    permissions: ["read"],
  };
  assert.strictEqual(capability.validatePermission("perm-1", "admin", adminToken), true);

  const userToken: capability.TenantToken = {
    authLevel: "user",
    tenantId: "tenant-456",
    entitlements: ["ent-default"],
  };
  assert.strictEqual(capability.validatePermission("perm-1", "admin", userToken), false);

  assert.strictEqual(
    capability.checkTenantIsolation({ ...entry, visibility: "not_exposed" }, "tenant-456"),
    false
  );
  assert.strictEqual(
    capability.checkTenantIsolation({ ...entry, visibility: "global_only" }, ""),
    true
  );
  assert.strictEqual(
    capability.checkTenantIsolation({ ...entry, visibility: "tenant_scoped_safe" }, ""),
    false
  );

  const tenantToken: capability.TenantToken = {
    tenantId: "tenant-456",
    entitlements: ["ent-default"],
  };
  assert.strictEqual(capability.checkTenantAccess(entry, tenantToken), true);

  const wrongEntitlementToken: capability.TenantToken = {
    tenantId: "tenant-456",
    entitlements: ["other"],
  };
  assert.strictEqual(capability.checkTenantAccess(entry, wrongEntitlementToken), false);

  const auditFn = (_e: capability.AuditEvent): capability.TypedError | null => null;
  const regOnUnknown = capability.updateServiceState(
    capability.initialModel,
    "missing-service",
    { name: "X" },
    auditFn
  );
  assert.ok(capability.isTypedError(regOnUnknown));
});

test("servicecatalogandproviderintegrationmodelproof", () => {
  const validEntry = makeEntry({
    id: "proof-1",
    key: "proof-1",
    visibility: "global_only",
  });
  const resources = new Map<string, capability.ServiceCatalogEntry>([["proof-1", validEntry]]);
  const modelWithService: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources,
  };

  assert.strictEqual(capability.provePlatformServices(modelWithService), true);
  assert.strictEqual(capability.proveServiceClickthroughPolicy(modelWithService), true);
  assert.strictEqual(capability.proveServiceCatalogRegistry(modelWithService), true);
  assert.strictEqual(capability.proveEntitlementsRoutes(modelWithService), true);
  assert.strictEqual(capability.runAllProofs(modelWithService), true);

  const clickthroughViolatingEntry = makeEntry({
    id: "bad-1",
    key: "bad-1",
    visibility: "not_exposed",
    consoleAccessFlag: true,
  });
  const badModel: capability.ServiceCatalogModel = {
    ...modelWithService,
    resources: new Map<string, capability.ServiceCatalogEntry>([
      ["proof-1", validEntry],
      ["bad-1", clickthroughViolatingEntry],
    ]),
  };
  assert.strictEqual(capability.proveServiceClickthroughPolicy(badModel), false);

  assert.strictEqual(capability.reRunPromotionProofs(modelWithService), true);
  assert.strictEqual(capability.listRequiredProofs().length, 4);
});

test("servicecatalogandproviderintegrationmodelreadinessmodel", () => {
  const readyEntry = makeEntry({
    id: "ready-1",
    key: "ready-1",
    visibility: "tenant_scoped_safe",
  });
  const resources = new Map<string, capability.ServiceCatalogEntry>([["ready-1", readyEntry]]);
  const readyModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources,
  };

  assert.strictEqual(capability.determineReadiness(readyModel), "READY");
  assert.strictEqual(capability.getReadiness(readyModel), "READY");
  assert.strictEqual(capability.evaluateReadinessSurface(readyModel), "READY");
  assert.strictEqual(capability.readPlatformServicesReadiness(readyModel), "READY");
  assert.strictEqual(capability.isReadinessCoherent(readyModel), true);

  const providerUnresolved = makeEntry({
    id: "unresolved-1",
    key: "unresolved-1",
    visibility: "global_only",
    readiness: "READY",
    providerDetails: { providerResolved: false },
  });
  const unresolvedModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map<string, capability.ServiceCatalogEntry>([["unresolved-1", providerUnresolved]]),
  };
  assert.strictEqual(capability.determineReadiness(unresolvedModel), "DEGRADED");

  const surface = capability.getPlatformServicesReadiness(readyModel);
  assert.strictEqual(surface.status, "READY");
  assert.strictEqual(surface.proofsPassed, true);
  assert.strictEqual(surface.servicesCount, 1);

  const degradedWithEntry: capability.ServiceCatalogModel = {
    ...readyModel,
    degraded: true,
    observabilityAdaptersAvailable: false,
    readiness: "DEGRADED",
  };
  assert.strictEqual(capability.isReadOnlyReadyInDegradedMode(degradedWithEntry), true);

  const blocked = capability.registerService(
    degradedWithEntry,
    {
      key: "ready-2",
      name: "BlockedService",
      category: "compute",
      visibility: "global_only",
      integrationDecision: "build",
      entitlementKey: "ent-blocked",
      readiness: "READY",
      providerDetails: {},
      consoleAccessFlag: false,
    },
    () => null
  );
  assert.ok(capability.isTypedError(blocked));
  if (capability.isTypedError(blocked)) {
    assert.strictEqual(blocked.kind, "DEGRADED_FAILURE");
  }
});

test("servicecatalogandproviderintegrationmodelstatemodel", () => {
  const service: Omit<capability.ServiceCatalogEntry, "id"> & { readonly id?: string } = {
    key: "state-svc",
    name: "StateService",
    category: "database",
    visibility: "not_exposed",
    integrationDecision: "defer",
    entitlementKey: "",
    readiness: "NOT_READY",
    providerDetails: { config: "value" },
    consoleAccessFlag: false,
    environmentModel: "v1",
  };
  const auditFn = (_e: capability.AuditEvent): capability.TypedError | null => null;
  const reg = capability.registerService(capability.initialModel, service, auditFn);
  assert.ok(isModel(reg));
  if (isModel(reg)) {
    const entry = reg.resources.get("state-svc");
    assert.ok(entry);
    if (entry) {
      assert.strictEqual(entry.id, "state-svc");
      assert.strictEqual(entry.key, "state-svc");
      assert.strictEqual(entry.name, "StateService");
      assert.strictEqual(entry.category, "database");
      assert.strictEqual(entry.environmentModel, "v1");
      assert.strictEqual(entry.visibility, "not_exposed");
      assert.strictEqual(entry.integrationDecision, "defer");
      assert.strictEqual(entry.entitlementKey, "");
      assert.strictEqual(entry.readiness, "NOT_READY");
      assert.ok(entry.proofReferences === undefined || Array.isArray(entry.proofReferences));
    }
  }

  assert.strictEqual(capability.initialModel.lastAuditEvent, null);
  assert.strictEqual(capability.initialModel.lastDecision, null);
  assert.strictEqual(capability.initialModel.lastError, null);
  assert.strictEqual(capability.initialModel.readiness, "READY");
  assert.strictEqual(capability.initialModel.observabilityAdaptersAvailable, true);
  assert.strictEqual(capability.initialModel.auditSignal, true);
  assert.strictEqual(capability.initialModel, capability.initialState);

  const goodLineage = capability.applyMigration(
    capability.initialModel,
    ["m1", "m2"],
    ["m1", "m2"]
  );
  assert.ok(isModel(goodLineage));
  if (isModel(goodLineage)) {
    assert.strictEqual(goodLineage.migrationLineageVerified, true);
  }

  const badLineage = capability.applyMigration(
    capability.initialModel,
    ["m1", "m2"],
    ["m1", "m3"]
  );
  assert.ok(capability.isTypedError(badLineage));

  const exportResult = capability.exportTenantData(capability.initialModel, [makeEntry()]);
  assert.ok(isModel(exportResult));
  if (isModel(exportResult)) {
    assert.strictEqual(exportResult.auditEvidencePreserved, true);
    assert.strictEqual(exportResult.tenantBoundaryPreserved, true);
  }

  assert.strictEqual(capability.isStateShapeValid(capability.initialModel), true);
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

  const badVisibility: Omit<capability.ServiceCatalogEntry, "id"> = {
    ...validService,
    visibility: "bogus" as capability.Visibility,
  };
  const badVisibilityErr = capability.validateCatalogEntry(badVisibility);
  assert.ok(badVisibilityErr !== null);

  const unexposedWithConsole: Omit<capability.ServiceCatalogEntry, "id"> = {
    ...validService,
    visibility: "not_exposed",
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
    {
      ...validService,
      visibility: "not_exposed",
      consoleAccessFlag: true,
    },
    auditFn
  );
  assert.ok(capability.isTypedError(invalidReg));

  assert.throws(
    () => capability.resolveProviderDetails({}, "missing-provider"),
    (err: unknown) => capability.isTypedError(err) && err.kind === "CONFIGURATION_INVALID"
  );

  assert.strictEqual(capability.validateConfigPlane({ providerAdapters: new Map() }), true);
  assert.strictEqual(capability.validateConfigPlane({ unknownKey: new Map() }), false);
});