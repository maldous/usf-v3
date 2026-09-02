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
  assert.strictEqual(auditResult.operation, "register");
  assert.strictEqual(auditResult.outcome, "success");
  assert.ok(auditResult.timestamp.length > 0);

  const auditEvent: capability.AuditEvent = {
    kind: "AUDIT_BEFORE_CHANGE",
    resource: "test-service",
    operation: "register",
    actor: "tenant-123",
    timestamp: new Date().toISOString(),
  };
  const modelWithAudit = capability.applyAuditToState(capability.initialModel, auditEvent);
  assert.strictEqual(modelWithAudit.lastAuditEvent?.kind, "AUDIT_BEFORE_CHANGE");
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
  assert.ok(!capability.isTypedError(reg));
  if (capability.isTypedError(reg)) throw new Error("register failed unexpectedly");
  assert.strictEqual(reg.lastAuditEvent?.kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(reg.lastAuditEvent?.operation, "register");
  assert.strictEqual(reg.lastAuditEvent?.resource, "audit-svc");
  assert.ok(reg.lastAuditEvent?.actor !== undefined);
  assert.strictEqual(reg.auditEvidencePreserved, true);
  assert.strictEqual(reg.tenantBoundaryPreserved, true);
  assert.strictEqual(capability.isAuditEvidencePreserved(reg), true);
  assert.strictEqual(capability.isTenantBoundaryPreserved(reg), true);

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
    makeEntry({
      id: "rec-1",
      key: "rec-1",
      name: "RecService",
      category: "compute",
      visibility: "global_only",
      integrationDecision: "build",
      entitlementKey: "ent-rec",
      readiness: "READY",
      providerDetails: {},
      consoleAccessFlag: false,
    }),
  ];
  const recovery = capability.recoverPlatformServices(
    capability.initialModel,
    recoveryEntries,
    auditFn
  );
  assert.ok(!capability.isTypedError(recovery));
  if (!capability.isTypedError(recovery)) {
    assert.strictEqual(recovery.lastAuditEvent?.operation, "recover");
    assert.strictEqual(recovery.lastAuditEvent?.resource, "catalog:recovery");
    assert.strictEqual(recovery.lastAuditEvent?.actor, "recovery-agent");
    assert.strictEqual(recovery.auditEvidencePreserved, true);
    assert.strictEqual(recovery.tenantBoundaryPreserved, true);
  }

  const emptyRecovery = capability.recoverPlatformServices(
    capability.initialModel,
    [],
    auditFn
  );
  assert.ok(capability.isTypedError(emptyRecovery));
  if (capability.isTypedError(emptyRecovery)) {
    assert.strictEqual(emptyRecovery.kind, "POLICY_DENIED");
  }

  const reported = capability.reportObservabilityAdapterLoss(capability.initialModel, "adapters down");
  assert.strictEqual(capability.isAuditEvidencePreserved(reported), true);
  assert.strictEqual(capability.isTenantBoundaryPreserved(reported), true);
});

test("servicecatalogandproviderintegrationmodelcontracts", () => {
  const model = capability.initialModel;

  assert.strictEqual(capability.getContractSurface().endpoint, "GET /api/platform/service-catalog");
  assert.strictEqual(capability.getContractSurface().version, "catalog-v2");
  assert.ok(Array.from(capability.getContractSurface().configKeys).includes("providerAdapters"));
  assert.ok(Array.from(capability.getContractSurface().configKeys).includes("platformServicesRegistry"));
  assert.ok(Array.from(capability.getContractSurface().proofs).includes("proof:platform-services"));

  assert.throws(
    () => capability.readProviderConfig({}, "providerAdapters"),
    (err: unknown) => capability.isTypedError(err) && err.kind === "CONFIGURATION_INVALID"
  );

  assert.throws(
    () => capability.resolveProviderDetails({}, "missing"),
    (err: unknown) => capability.isTypedError(err) && err.kind === "CONFIGURATION_INVALID"
  );

  const emptyReadResult = capability.readPlatformServiceCatalog(model);
  assert.strictEqual(emptyReadResult.isError, true);
  if (emptyReadResult.isError) {
    assert.strictEqual(emptyReadResult.error.kind, "POLICY_DENIED");
  }

  const config: Record<string, unknown> = {
    providerAdapters: new Map<string, unknown>([["foo", { hello: "world" }]]),
  };
  const port = capability.makeProviderPort("primary", config);
  const resolved = capability.resolveThroughPort(port, "foo");
  assert.strictEqual((resolved as { hello: string }).hello, "world");

  assert.throws(
    () => capability.resolveThroughPort(port, "missing"),
    (err: unknown) => capability.isTypedError(err) && err.kind === "CONFIGURATION_INVALID"
  );
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

  const reported = capability.reportObservabilityAdapterLoss(capability.initialModel, "adapters down");
  assert.strictEqual(reported.observabilityAdaptersAvailable, false);
  assert.strictEqual(reported.degraded, true);
  assert.strictEqual(capability.canMutateInCurrentMode(reported), false);
  assert.strictEqual(reported.readiness, "DEGRADED");
  assert.strictEqual(reported.lifecycleReadiness, "DEGRADED");
  assert.ok(reported.lastError !== null);
  if (reported.lastError !== null) {
    assert.strictEqual(reported.lastError.kind, "DEGRADED_FAILURE");
  }

  const signalMissing: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    tenantIsolationSignal: false,
  };
  assert.strictEqual(capability.detectMissingTenantIsolationOrAuditSignal(signalMissing), true);
  const alert = capability.raiseTenantDataOrSecurityAlert(signalMissing);
  assert.strictEqual(alert.kind, "TENANT_ISOLATION_VIOLATION");

  const auditMissing: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    auditSignal: false,
  };
  assert.strictEqual(capability.detectMissingTenantIsolationOrAuditSignal(auditMissing), true);

  assert.strictEqual(capability.readReadinessSurface(reported).isError, false);
  assert.strictEqual(capability.readReadinessSurface(reported).readOnly, true);
});

test("servicecatalogandproviderintegrationmodellifecycle", () => {
  const contract = capability.getLifecycleContract();
  assert.strictEqual(contract.capability, "servicecatalogandproviderintegrationmodel");
  assert.strictEqual(contract.contractVersion, "V1");
  assert.strictEqual(contract.catalogEndpoint, "GET /api/platform/service-catalog");
  assert.strictEqual(contract.catalogVersion, "catalog-v2");
  assert.strictEqual(contract.readinessEndpoint, "proof:platform-services");
  assert.strictEqual(contract.decision, "build");
  assert.strictEqual(contract.visibility, "global_only");
  assert.strictEqual(contract.touchesTenantData, true);
  assert.ok(contract.backedBy.includes("provider"));
  assert.ok(contract.backedBy.includes("database"));
  assert.strictEqual(contract.supportsBuildComposeAdapter, true);

  const proofs = capability.getRequiredProofsForPromotion();
  assert.ok(proofs.includes("proof:platform-services"));
  assert.ok(proofs.includes("proof:service-clickthrough-policy"));
  assert.ok(proofs.includes("proof:service-catalog-registry"));
  assert.ok(proofs.includes("proof:entitlements-routes"));
  assert.strictEqual(proofs.length, 4);

  const endpoints = capability.getLifecycleEndpoints();
  assert.ok(endpoints.includes("GET /api/platform/service-catalog"));
  assert.ok(endpoints.includes("catalog-v2"));

  assert.strictEqual(capability.getCatalogEndpoint(), "GET /api/platform/service-catalog");
  assert.strictEqual(capability.getCatalogVersion(), "catalog-v2");
  assert.strictEqual(capability.getReadinessEndpoint(), "proof:platform-services");
  assert.strictEqual(capability.listRequiredProofs().length, 4);

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
    consoleAccessFlag: false,
  };

  const reg = capability.registerService(capability.initialModel, service, auditFn);
  assert.ok(!capability.isTypedError(reg));
  if (capability.isTypedError(reg)) throw new Error("register failed unexpectedly");
  assert.strictEqual(reg.resources.size, 1);
  const entry = reg.resources.get("lifecycle-1");
  assert.ok(entry);
  assert.strictEqual(entry?.name, "LifecycleService");
  assert.strictEqual(entry?.integrationDecision, "compose");
  assert.strictEqual(reg.lifecycleContractUnchanged, true);

  const recoveryEntries: ReadonlyArray<capability.ServiceCatalogEntry> = [
    makeEntry({
      id: "svc-recover",
      key: "svc-recover",
      name: "LifecycleService",
      category: "storage",
      visibility: "global_only",
      integrationDecision: "compose",
      entitlementKey: "ent-lifecycle",
      readiness: "READY",
      providerDetails: {},
      consoleAccessFlag: false,
    }),
  ];

  const recovery = capability.recoverPlatformServices(
    capability.initialModel,
    recoveryEntries,
    auditFn
  );
  assert.ok(!capability.isTypedError(recovery));
  if (!capability.isTypedError(recovery)) {
    assert.strictEqual(recovery.resources.size, 1);
    assert.strictEqual(capability.verifyPromotionLineage(recovery), true);
    assert.strictEqual(capability.reRunPromotionProofs(recovery), true);
    assert.strictEqual(capability.mayContinuePromotion(recovery), true);
    assert.strictEqual(capability.isLifecycleContractUnchanged(recovery), true);
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

  assert.strictEqual(capability.checkTenantIsolation({ ...entry, visibility: "not_exposed" }, "tenant-456"), false);
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

  assert.strictEqual(capability.checkTenantAccess({ ...entry, visibility: "not_exposed" }, tenantToken), false);
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
  const resources = new Map<string, capability.ServiceCatalogEntry>([["proof-1", validEntry]]);
  const modelWithService: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources,
    readiness: "READY",
    lifecycleReadiness: "READY",
    lastAuditEvent: {
      kind: "AUDIT_BEFORE_CHANGE",
      resource: "proof-1",
      operation: "register",
      actor: "system",
      timestamp: new Date().toISOString(),
    },
    auditEvidencePreserved: true,
    tenantBoundaryPreserved: true,
  };

  assert.strictEqual(capability.provePlatformServices(modelWithService), true);
  assert.strictEqual(capability.proveServiceClickthroughPolicy(modelWithService), true);
  assert.strictEqual(capability.proveServiceCatalogRegistry(modelWithService), true);
  assert.strictEqual(capability.proveEntitlementsRoutes(modelWithService), true);
  assert.strictEqual(capability.runAllProofs(modelWithService), true);
  assert.strictEqual(capability.verifyPromotionLineage(modelWithService), true);
  assert.strictEqual(capability.mayContinuePromotion(modelWithService), true);

  assert.strictEqual(capability.provePlatformServices(capability.initialModel), false);
  assert.strictEqual(capability.proveServiceClickthroughPolicy(capability.initialModel), false);
  assert.strictEqual(capability.proveServiceCatalogRegistry(capability.initialModel), false);
  assert.strictEqual(capability.proveEntitlementsRoutes(capability.initialModel), false);
  assert.strictEqual(capability.runAllProofs(capability.initialModel), false);

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
  const badModel: capability.ServiceCatalogModel = {
    ...modelWithService,
    resources: new Map<string, capability.ServiceCatalogEntry>([
      ["proof-1", validEntry],
      ["bad-1", clickthroughViolatingEntry],
    ]),
  };
  assert.strictEqual(capability.proveServiceClickthroughPolicy(badModel), false);

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
  const noEntModel: capability.ServiceCatalogModel = {
    ...modelWithService,
    resources: new Map<string, capability.ServiceCatalogEntry>([["ne-1", noEntitlementEntry]]),
  };
  assert.strictEqual(capability.proveEntitlementsRoutes(noEntModel), false);

  assert.strictEqual(capability.reRunPromotionProofs(modelWithService), true);
  assert.strictEqual(capability.listRequiredProofs().length, 4);
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
  const resources = new Map<string, capability.ServiceCatalogEntry>([["ready-1", readyEntry]]);
  const readyModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources,
  };

  assert.strictEqual(capability.determineReadiness(readyModel), "READY");
  assert.strictEqual(capability.getReadiness(readyModel), "READY");

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
  const notReadyModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map<string, capability.ServiceCatalogEntry>([["not-ready-1", notReadyEntry]]),
  };
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
  const degradedOnlyModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map<string, capability.ServiceCatalogEntry>([["deg-1", degradedEntry]]),
  };
  assert.strictEqual(capability.determineReadiness(degradedOnlyModel), "DEGRADED");

  const providerUnresolved = makeEntry({
    id: "unresolved-1",
    key: "unresolved-1",
    name: "UnresolvedService",
    category: "compute",
    visibility: "global_only",
    integrationDecision: "build",
    entitlementKey: "ent-unresolved",
    readiness: "READY",
    providerDetails: { providerResolved: false },
    consoleAccessFlag: false,
  });
  const unresolvedModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map<string, capability.ServiceCatalogEntry>([["unresolved-1", providerUnresolved]]),
  };
  assert.strictEqual(capability.determineReadiness(unresolvedModel), "DEGRADED");

  const explicitDegraded: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources,
    degraded: true,
    readiness: "DEGRADED",
    lifecycleReadiness: "DEGRADED",
  };
  assert.strictEqual(capability.determineReadiness(explicitDegraded), "DEGRADED");

  assert.strictEqual(capability.determineReadiness(capability.initialModel), "NOT_READY");

  const surface = capability.getPlatformServicesReadiness(readyModel);
  assert.strictEqual(surface.status, "READY");
  assert.strictEqual(typeof surface.proofsPassed, "boolean");
  assert.strictEqual(surface.servicesCount, 1);
  assert.strictEqual(surface.proofsPassed, true);

  const stillVisible = capability.getPlatformServicesReadiness(explicitDegraded);
  assert.strictEqual(stillVisible.status, "DEGRADED");
  assert.strictEqual(capability.isReadOnlyReadyInDegradedMode(explicitDegraded), true);

  const blocked = capability.registerService(
    explicitDegraded,
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

  const lifecycleSurface = capability.readLifecycleReadinessSurface(readyModel);
  assert.strictEqual(lifecycleSurface.contractUnchanged, true);
  assert.strictEqual(lifecycleSurface.readOnly, false);

  const contractResult = capability.readPlatformServiceContract(readyModel);
  assert.strictEqual(contractResult.isError, false);
  if (!contractResult.isError) {
    assert.strictEqual(contractResult.status, "READY");
    assert.strictEqual(contractResult.proofsPassed, true);
    assert.strictEqual(contractResult.readOnly, false);
    assert.strictEqual(contractResult.requiredProofs.length, 4);
  }

  assert.strictEqual(capability.mayContinuePromotion(readyModel), true);
});

test("servicecatalogandproviderintegrationmodelstatemodel", () => {
  const service: Omit<capability.ServiceCatalogEntry, "id"> & { readonly id?: string } = {
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
  if (capability.isTypedError(reg)) throw new Error("register failed unexpectedly");
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

  assert.strictEqual(capability.initialModel.lastAuditEvent, null);
  assert.strictEqual(capability.initialModel.lastDecision, null);
  assert.strictEqual(capability.initialModel.lastError, null);
  assert.strictEqual(capability.initialModel.readiness, "NOT_READY");
  assert.strictEqual(capability.initialModel.degraded, false);
  assert.strictEqual(capability.initialModel.observabilityAdaptersAvailable, true);
  assert.strictEqual(capability.initialModel.tenantIsolationSignal, true);
  assert.strictEqual(capability.initialModel.auditSignal, true);
  assert.strictEqual(capability.initialModel.lifecycleContractUnchanged, true);

  assert.strictEqual(capability.initialModel, capability.initialState);
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
  if (badVisibilityErr !== null) {
    assert.strictEqual(badVisibilityErr.kind, "CONFIGURATION_INVALID");
  }

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
  if (capability.isTypedError(invalidReg)) {
    assert.strictEqual(invalidReg.kind, "TENANT_ISOLATION_VIOLATION");
  }

  assert.throws(
    () => capability.resolveProviderDetails({}, "missing-provider"),
    (err: unknown) => capability.isTypedError(err) && err.kind === "CONFIGURATION_INVALID"
  );

  assert.strictEqual(capability.validateConfigPlane({ providerAdapters: new Map() }), true);
  assert.strictEqual(capability.validateConfigPlane({ unknownKey: new Map() }), false);
});