import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/foundation/servicecatalogandproviderintegrationmodel.ts";

test("servicecatalogandproviderintegrationmodelauditmodel", () => {
  const initialState = capability.initialModel;
  const auditEvent: capability.AuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource: 'test-service',
    operation: 'register',
    actor: 'tenant-123',
    timestamp: new Date().toISOString(),
  };

  const updatedState = capability.applyAuditToState(initialState, auditEvent);
  assert.strictEqual(updatedState.lastAuditEvent?.kind, 'AUDIT_BEFORE_CHANGE');
  assert.strictEqual(updatedState.lastAuditEvent?.resource, 'test-service');
  assert.strictEqual(updatedState.lastAuditEvent?.actor, 'tenant-123');

  const auditResult = capability.recordAuditBeforeMutation(
    'test-service',
    'register',
    'tenant-123',
    'success'
  );
  assert.strictEqual(auditResult.outcome, 'success');
  assert.strictEqual(auditResult.kind, 'AUDIT_BEFORE_CHANGE');
});

test("servicecatalogandproviderintegrationmodelcontracts", () => {
  const model: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map([
      [
        'svc-1',
        {
          id: 'svc-1',
          name: 'TestService',
          category: 'compute',
          visibility: 'tenant_scoped_safe',
          integrationDecision: 'build',
          entitlementKey: 'ent-1',
          readiness: 'READY',
          providerDetails: {},
          consoleAccessFlag: true,
        } as capability.ServiceCatalogEntry,
      ],
    ]),
    readiness: 'READY',
  };

  const catalog = capability.getCatalog(model);
  assert.strictEqual(catalog.length, 1);
  assert.strictEqual(catalog[0].name, 'TestService');
  assert.strictEqual(catalog[0].visibility, 'tenant_scoped_safe');
  assert.strictEqual(catalog[0].integrationDecision, 'build');
  assert.strictEqual(catalog[0].entitlementKey, 'ent-1');
  assert.strictEqual(catalog[0].readiness, 'READY');
});

test("servicecatalogandproviderintegrationmodelerrormodel", () => {
  const unavailableError = capability.handleProviderFailure('unavailable');
  assert.strictEqual(unavailableError.kind, 'SERVER_UNAVAILABLE');
  assert.ok(unavailableError.message.includes('unavailable'));

  const timeoutError = capability.handleProviderFailure('timeout');
  assert.strictEqual(timeoutError.kind, 'SERVER_UNAVAILABLE');
  assert.ok(timeoutError.message.includes('timeout'));

  const otherError = capability.handleProviderFailure('invalid');
  assert.strictEqual(otherError.kind, 'POLICY_DENIED');
  assert.ok(otherError.message.includes('invalid'));
});

test("servicecatalogandproviderintegrationmodellifecycle", () => {
  const initialState = capability.initialModel;
  const service: Omit<capability.ServiceCatalogEntry, 'id'> = {
    name: 'LifecycleService',
    category: 'storage',
    visibility: 'global_only',
    integrationDecision: 'compose',
    entitlementKey: 'ent-lifecycle',
    readiness: 'READY',
    providerDetails: {},
    consoleAccessFlag: false,
  };

  const auditFn = (_event: capability.AuditEvent): capability.TypedError | null => null;
  const result = capability.registerService(initialState, service, auditFn);
  assert.ok(!capability.isTypedError(result as capability.TypedError | capability.ServiceCatalogModel));
  const modelResult = result as capability.ServiceCatalogModel;
  assert.strictEqual(modelResult.lastDecision, 'GRANTED');
  assert.strictEqual(modelResult.resources.size, 1);

  const entry = modelResult.resources.get(modelResult.resources.keys().next().value);
  assert.strictEqual(entry?.name, 'LifecycleService');
  assert.strictEqual(entry?.integrationDecision, 'compose');

  const proofsPass = capability.runAllProofs(modelResult);
  assert.strictEqual(proofsPass, true);
});

test("servicecatalogandproviderintegrationmodelpermissions", () => {
  const entry: capability.ServiceCatalogEntry = {
    id: 'perm-1',
    name: 'PermService',
    category: 'network',
    visibility: 'tenant_scoped_safe',
    integrationDecision: 'adapter',
    entitlementKey: 'ent-perm',
    readiness: 'READY',
    providerDetails: {},
    consoleAccessFlag: true,
  };

  const tenantToken: capability.TenantToken = {
    authLevel: 'admin',
    tenantId: 'tenant-456',
  };
  const hasPermission = capability.validatePermission('perm-1', 'admin', tenantToken);
  assert.strictEqual(hasPermission, true);

  const invalidToken = { authLevel: 'user', tenantId: 'tenant-789' };
  const noPermission = capability.validatePermission('perm-1', 'admin', invalidToken);
  assert.strictEqual(noPermission, false);

  const isolationCheck = capability.checkTenantIsolation(entry, 'tenant-456');
  assert.strictEqual(isolationCheck, true);
});

test("servicecatalogandproviderintegrationmodelproof", () => {
  const modelWithService: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map([
      [
        'proof-1',
        {
          id: 'proof-1',
          name: 'ProofService',
          category: 'analytics',
          visibility: 'global_only',
          integrationDecision: 'build',
          entitlementKey: 'ent-proof',
          readiness: 'READY',
          providerDetails: {},
          consoleAccessFlag: true,
        } as capability.ServiceCatalogEntry,
      ],
    ]),
    readiness: 'READY',
  };

  assert.strictEqual(capability.provePlatformServices(modelWithService), true);
  assert.strictEqual(capability.proveServiceClickthroughPolicy(modelWithService), true);
  assert.strictEqual(capability.proveServiceCatalogRegistry(modelWithService), true);
  assert.strictEqual(capability.proveEntitlementsRoutes(modelWithService), true);

  const emptyModel = capability.initialModel;
  assert.strictEqual(capability.provePlatformServices(emptyModel), false);
  assert.strictEqual(capability.proveServiceCatalogRegistry(emptyModel), false);
});

test("servicecatalogandproviderintegrationmodelreadinessmodel", () => {
  const readyModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map([
      [
        'ready-1',
        {
          id: 'ready-1',
          name: 'ReadyService',
          category: 'compute',
          visibility: 'tenant_scoped_safe',
          integrationDecision: 'build',
          entitlementKey: 'ent-ready',
          readiness: 'READY',
          providerDetails: {},
          consoleAccessFlag: false,
        } as capability.ServiceCatalogEntry,
      ],
    ]),
    readiness: 'READY',
  };
  assert.strictEqual(capability.determineReadiness(readyModel), 'READY');
  assert.strictEqual(capability.getReadiness(readyModel), 'READY');

  const notReadyModel: capability.ServiceCatalogModel = {
    ...capability.initialModel,
    resources: new Map([
      [
        'not-ready-1',
        {
          id: 'not-ready-1',
          name: 'NotReadyService',
          category: 'compute',
          visibility: 'tenant_scoped_safe',
          integrationDecision: 'build',
          entitlementKey: 'ent-not-ready',
          readiness: 'NOT_READY',
          providerDetails: {},
          consoleAccessFlag: false,
        } as capability.ServiceCatalogEntry,
      ],
    ]),
    readiness: 'NOT_READY',
  };
  assert.strictEqual(capability.determineReadiness(notReadyModel), 'NOT_READY');
});

test("servicecatalogandproviderintegrationmodelstatemodel", () => {
  const entry: capability.ServiceCatalogEntry = {
    id: 'state-1',
    name: 'StateService',
    category: 'database',
    visibility: 'not_exposed',
    integrationDecision: 'defer',
    entitlementKey: 'ent-state',
    readiness: 'NOT_READY',
    providerDetails: { config: 'value' },
    consoleAccessFlag: false,
  };

  assert.strictEqual(entry.id, 'state-1');
  assert.strictEqual(entry.name, 'StateService');
  assert.strictEqual(entry.category, 'database');
  assert.strictEqual(entry.visibility, 'not_exposed');
  assert.strictEqual(entry.integrationDecision, 'defer');
  assert.strictEqual(entry.entitlementKey, 'ent-state');
  assert.strictEqual(entry.readiness, 'NOT_READY');
  assert.deepStrictEqual(entry.providerDetails, { config: 'value' });
  assert.strictEqual(entry.consoleAccessFlag, false);
});

test("servicecatalogandproviderintegrationmodelvalidation", () => {
  const validService: Omit<capability.ServiceCatalogEntry, 'id'> = {
    name: 'ValidService',
    category: 'storage',
    visibility: 'global_only',
    integrationDecision: 'reject',
    entitlementKey: 'ent-valid',
    readiness: 'READY',
    providerDetails: {},
    consoleAccessFlag: true,
  };
  const validationResult = capability.validateCatalogEntry(validService);
  assert.strictEqual(validationResult, null);

  const invalidService: Omit<capability.ServiceCatalogEntry, 'id'> = {
    name: '',
    category: '',
    visibility: 'invalid' as capability.Visibility,
    integrationDecision: 'invalid' as capability.IntegrationDecision,
    entitlementKey: '' as capability.EntitlementKey,
    readiness: 'invalid' as capability.Readiness,
    providerDetails: {} as Record<string, unknown>,
    consoleAccessFlag: false,
  };
  const invalidResult = capability.validateCatalogEntry(invalidService);
  assert.notStrictEqual(invalidResult, null);
  if (invalidResult !== null) {
    assert.strictEqual(invalidResult.kind, 'POLICY_DENIED');
  }
});