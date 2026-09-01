import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/securitygovernance/tenantisolationproof.ts";

test("tenantisolationproofauditmodel", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [],
    activeContext: {
      organisationId: 'org-1',
      slug: 'tenant1',
      hostSource: 'SLUG_RESOLVED' as const,
      rlsTenantSetting: "app.current_tenant_id = 'org-1'",
      objectStoragePrefix: 'tenants/org-1/',
    },
    lastClassification: 'SLUG' as const,
    lastError: null,
    readiness: 'READY' as const,
    substrateProbes: [],
  };

  const actor: capability.TenantActor = {
    actorId: 'user-1',
    organisationId: 'org-1',
    roles: ['member'],
  };

  const guardResult = capability.guardTenantMutation(
    state.activeContext,
    actor,
    'org-1'
  );
  assert.deepEqual(guardResult, { allowed: true, error: null });

  const auditEvent: capability.TenantIsolationProofAuditEvent = {
    kind: 'TENANT_MUTATION_AUDIT',
    organisationId: 'org-1',
    tenantSlug: 'tenant1',
    action: 'update',
    targetResource: 'document',
    timestamp: new Date().toISOString(),
  };

  const auditFn = (event: capability.TenantIsolationProofAuditEvent): capability.TenantIsolationProofError | null => {
    if (event.organisationId !== 'org-1') {
      return { kind: 'AUDIT_FAILURE', message: 'Organisation mismatch', statusCode: 403 };
    }
    return null;
  };

  const result = capability.executeTenantMutation(
    state,
    actor,
    'org-1',
    'document',
    'update',
    () => 'success',
    auditFn
  );
  assert.deepEqual(result.success, true);
  assert.deepEqual(result.error, null);
});

test("tenantisolationproofcontracts", () => {
  const headers: capability.ForwardedHeaders = {
    'x-forwarded-host': 'tenant1.anqr.io',
  };
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [],
  };

  const boundState = capability.bindRequestContext(state, { headers });
  assert.notEqual(boundState.activeContext, null);
  assert.equal(boundState.activeContext?.organisationId, 'org-1');
  assert.equal(boundState.activeContext?.slug, 'tenant1');
  assert.equal(boundState.activeContext?.hostSource, 'SLUG_RESOLVED');
  assert.equal(boundState.lastClassification, 'SLUG');
});

test("tenantisolationprooferrormodel", () => {
  const headers: capability.ForwardedHeaders = {
    'x-forwarded-host': 'untrusted.example',
  };
  const state: capability.TenantIsolationProofState = capability.initialState;

  const { context, error } = capability.resolveTenantContext(headers, state);
  assert.equal(context, null);
  assert.equal(error?.kind, 'UNTRUSTED_HOST');
  assert.equal(error?.statusCode, 404);

  const customDomainHeaders: capability.ForwardedHeaders = {
    'x-forwarded-host': 'custom.example',
  };
  const stateWithCustomDomain: capability.TenantIsolationProofState = {
    ...capability.initialState,
    customDomains: [{ domain: 'custom.example', organisationId: 'org-1', slug: 'tenant1', status: 'PENDING' }],
  };
  const { error: customDomainError } = capability.resolveTenantContext(customDomainHeaders, stateWithCustomDomain);
  assert.equal(customDomainError?.kind, 'UNVERIFIED_CUSTOM_DOMAIN');
  assert.equal(customDomainError?.statusCode, 404);
});

test("tenantisolationprooflifecycle", () => {
  const headers: capability.ForwardedHeaders = {
    'x-forwarded-host': 'tenant1.anqr.io',
  };
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [],
  };

  const boundState = capability.bindRequestContext(state, { headers });
  assert.equal(boundState.activeContext?.organisationId, 'org-1');
  assert.equal(boundState.lastClassification, 'SLUG');

  const storageValidation = capability.validateStoragePrefix(
    boundState.activeContext,
    'tenants/org-1/data'
  );
  assert.equal(storageValidation.valid, true);

  const crossTenantStorageValidation = capability.validateStoragePrefix(
    boundState.activeContext,
    'tenants/org-2/data'
  );
  assert.equal(crossTenantStorageValidation.valid, false);
  assert.equal(crossTenantStorageValidation.error?.kind, 'CROSS_TENANT_READ_PREVENTED');

  const rows: capability.TenantRowRecord[] = [
    { id: '1', organisationId: 'org-1', payload: {} },
    { id: '2', organisationId: 'org-2', payload: {} },
  ];
  const filtered = capability.filterTenantRows(boundState.activeContext, rows);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].organisationId, 'org-1');
});

test("tenantisolationproofpermissions", () => {
  const headers: capability.ForwardedHeaders = {
    'x-forwarded-host': 'tenant1.anqr.io',
  };
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [],
  };
  const boundState = capability.bindRequestContext(state, { headers });

  const actor: capability.TenantActor = {
    actorId: 'user-1',
    organisationId: 'org-1',
    roles: ['member'],
  };
  const auth = capability.authorizeTenantActor(boundState.activeContext, actor);
  assert.equal(auth.authorized, true);

  const foreignActor: capability.TenantActor = {
    actorId: 'user-2',
    organisationId: 'org-2',
    roles: ['member'],
  };
  const foreignAuth = capability.authorizeTenantActor(boundState.activeContext, foreignActor);
  assert.equal(foreignAuth.authorized, false);
  assert.equal(foreignAuth.error?.kind, 'FOREIGN_TENANT_ACCESS_DENIED');

  const systemOperator: capability.TenantActor = {
    actorId: 'sys-1',
    organisationId: 'org-1',
    roles: ['system_operator'],
    isSystemOperator: true,
  };
  const systemAuth = capability.authorizeTenantActor(boundState.activeContext, systemOperator);
  assert.equal(systemAuth.authorized, true);
});

test("tenantisolationproofproof", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [],
    activeContext: {
      organisationId: 'org-1',
      slug: 'tenant1',
      hostSource: 'SLUG_RESOLVED' as const,
      rlsTenantSetting: "app.current_tenant_id = 'org-1'",
      objectStoragePrefix: 'tenants/org-1/',
    },
  };

  const resolverProof = capability.runSubstrateProof(
    'RESOLVER',
    state.activeContext,
    () => ({ healthy: true, latencyMs: 10, violations: 0 })
  );
  assert.equal(resolverProof.verified, true);
  assert.equal(resolverProof.crossTenantViolations, 0);

  const rlsProof = capability.runSubstrateProof(
    'ROW_LEVEL_SECURITY',
    state.activeContext,
    () => ({ healthy: true, latencyMs: 15, violations: 0 })
  );
  assert.equal(rlsProof.verified, true);

  const storageProof = capability.runSubstrateProof(
    'STORAGE_PREFIX',
    state.activeContext,
    () => ({ healthy: true, latencyMs: 5, violations: 0 })
  );
  assert.equal(storageProof.verified, true);

  const matrix = capability.verifyDomainIdentityMatrix(
    state,
    ['tenant1.anqr.io', 'admin.anqr.io', 'custom.example'],
    'anqr.io'
  );
  assert.equal(matrix[0].classification, 'SLUG');
  assert.equal(matrix[0].resolvedOrgId, 'org-1');
  assert.equal(matrix[1].classification, 'RESERVED');
  assert.equal(matrix[1].resolvedOrgId, null);
  assert.equal(matrix[2].classification, 'UNKNOWN');
  assert.equal(matrix[2].resolvedOrgId, null);
});

test("tenantisolationproofreadinessmodel", () => {
  const healthyProbes: capability.SubstrateProbeStatus[] = [
    { probe: 'RESOLVER', healthy: true, latencyMs: 10 },
    { probe: 'ROW_LEVEL_SECURITY', healthy: true, latencyMs: 15 },
    { probe: 'STORAGE_PREFIX', healthy: true, latencyMs: 5 },
  ];
  const readiness = capability.evaluateReadiness(healthyProbes);
  assert.equal(readiness, 'READY');

  const degradedProbes: capability.SubstrateProbeStatus[] = [
    { probe: 'RESOLVER', healthy: true, latencyMs: 10 },
    { probe: 'ROW_LEVEL_SECURITY', healthy: false, latencyMs: 0 },
  ];
  const degradedReadiness = capability.evaluateReadiness(degradedProbes);
  assert.equal(degradedReadiness, 'DEGRADED');

  const emptyProbes: capability.SubstrateProbeStatus[] = [];
  const emptyReadiness = capability.evaluateReadiness(emptyProbes);
  assert.equal(emptyReadiness, 'READY');
});

test("tenantisolationproofstatemodel", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [{ domain: 'custom.example', organisationId: 'org-1', slug: 'tenant1', status: 'ACTIVE' }],
    activeContext: {
      organisationId: 'org-1',
      slug: 'tenant1',
      hostSource: 'CUSTOM_DOMAIN_VERIFIED' as const,
      rlsTenantSetting: "app.current_tenant_id = 'org-1'",
      objectStoragePrefix: 'tenants/org-1/',
    },
    lastClassification: 'CUSTOM_DOMAIN' as const,
    lastError: null,
    readiness: 'READY' as const,
    substrateProbes: [],
  };

  assert.deepEqual(state.activeContext?.organisationId, 'org-1');
  assert.deepEqual(state.activeContext?.slug, 'tenant1');
  assert.deepEqual(state.activeContext?.hostSource, 'CUSTOM_DOMAIN_VERIFIED');
  assert.deepEqual(state.activeContext?.rlsTenantSetting, "app.current_tenant_id = 'org-1'");
  assert.deepEqual(state.activeContext?.objectStoragePrefix, 'tenants/org-1/');
  assert.deepEqual(state.lastClassification, 'CUSTOM_DOMAIN');

  const nullContextState: capability.TenantIsolationProofState = {
    ...capability.initialState,
    activeContext: null,
    lastClassification: 'UNKNOWN' as const,
  };
  assert.equal(nullContextState.activeContext, null);
  assert.equal(nullContextState.lastClassification, 'UNKNOWN');
});

test("tenantisolationproofvalidation", () => {
  const headers: capability.ForwardedHeaders = {
    'x-forwarded-host': 'tenant1.anqr.io',
  };
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [],
  };

  const { classification, identifier } = capability.classifyHost('tenant1.anqr.io', state);
  assert.equal(classification, 'SLUG');
  assert.equal(identifier, 'tenant1');

  const { classification: apexClassification } = capability.classifyHost('anqr.io', state);
  assert.equal(apexClassification, 'APEX');

  const { classification: reservedClassification } = capability.classifyHost('admin', state);
  assert.equal(reservedClassification, 'RESERVED');

  const { classification: malformedClassification } = capability.classifyHost('', state);
  assert.equal(malformedClassification, 'MALFORMED');

  const { classification: unknownClassification } = capability.classifyHost('unknown.example', state);
  assert.equal(unknownClassification, 'UNKNOWN');

  const customDomainState: capability.TenantIsolationProofState = {
    ...capability.initialState,
    customDomains: [{ domain: 'custom.example', organisationId: 'org-1', slug: 'tenant1', status: 'ACTIVE' }],
  };
  const { classification: customDomainClassification } = capability.classifyHost('custom.example', customDomainState);
  assert.equal(customDomainClassification, 'CUSTOM_DOMAIN');

  const inactiveCustomDomainState: capability.TenantIsolationProofState = {
    ...capability.initialState,
    customDomains: [{ domain: 'inactive.example', organisationId: 'org-1', slug: 'tenant1', status: 'INACTIVE' }],
  };
  const { error: inactiveError } = capability.resolveTenantContext(
    { 'x-forwarded-host': 'inactive.example' },
    inactiveCustomDomainState
  );
  assert.equal(inactiveError?.kind, 'UNVERIFIED_CUSTOM_DOMAIN');

  const storageValidation = capability.validateStoragePrefix(
    state.activeContext,
    'tenants/org-1/data'
  );
  assert.equal(storageValidation.valid, true);

  const crossTenantStorageValidation = capability.validateStoragePrefix(
    state.activeContext,
    'tenants/org-2/data'
  );
  assert.equal(crossTenantStorageValidation.valid, false);
});