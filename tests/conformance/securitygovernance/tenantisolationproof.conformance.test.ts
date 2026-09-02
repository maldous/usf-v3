import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/securitygovernance/tenantisolationproof.ts";

test("tenantisolationproofauditmodel", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [],
  };
  const boundState = capability.bindRequestContext(state, {
    headers: { 'x-forwarded-host': 'tenant1.anqr.io' },
  });

  const actor: capability.TenantActor = {
    actorId: 'user-1',
    organisationId: 'org-1',
    roles: ['member'],
  };

  const allowedGuard = capability.guardTenantMutation(boundState.activeContext, actor, 'org-1');
  assert.equal(allowedGuard.allowed, true);
  assert.equal(allowedGuard.error, null);

  let audited = false;
  const auditFn = (event: capability.TenantIsolationProofAuditEvent): capability.TenantIsolationProofError | null => {
    audited = true;
    assert.equal(event.kind, 'TENANT_MUTATION_AUDIT');
    assert.equal(event.organisationId, 'org-1');
    assert.equal(event.tenantSlug, 'tenant1');
    assert.equal(event.action, 'write');
    assert.equal(event.targetResource, 'document-1');
    return null;
  };

  let mutated = false;
  const successResult = capability.executeTenantMutation(
    boundState,
    actor,
    'org-1',
    'document-1',
    'write',
    () => {
      mutated = true;
      return 'saved';
    },
    auditFn
  );
  assert.equal(successResult.success, true);
  assert.equal(successResult.result, 'saved');
  assert.equal(successResult.error, null);
  assert.equal(audited, true);
  assert.equal(mutated, true);

  let crossAuditRan = false;
  let crossMutateRan = false;
  const deniedResult = capability.executeTenantMutation(
    boundState,
    actor,
    'org-2',
    'document-2',
    'write',
    () => {
      crossMutateRan = true;
      return 'cross-saved';
    },
    () => {
      crossAuditRan = true;
      return null;
    }
  );
  assert.equal(deniedResult.success, false);
  assert.equal(deniedResult.result, null);
  assert.equal(deniedResult.error?.kind, 'CROSS_TENANT_WRITE_PREVENTED');
  assert.equal(crossAuditRan, false);
  assert.equal(crossMutateRan, false);
});

test("tenantisolationproofcontracts", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [
      { organisationId: 'org-primary', slug: 'primary', active: true },
      { organisationId: 'org-fallback', slug: 'fallback', active: true },
    ],
  };

  const precedenceHeaders: capability.ForwardedHeaders = {
    'x-forwarded-host': 'primary.anqr.io',
    'x-original-host': 'fallback.anqr.io',
    host: 'fallback.anqr.io',
  };
  const extractedHost = capability.extractForwardedHost(precedenceHeaders);
  assert.equal(extractedHost, 'primary.anqr.io');

  const bound = capability.bindRequestContext(state, { headers: precedenceHeaders });
  assert.notEqual(bound.activeContext, null);
  assert.equal(bound.activeContext?.organisationId, 'org-primary');
  assert.equal(bound.activeContext?.slug, 'primary');
  assert.equal(bound.activeContext?.hostSource, 'SLUG_RESOLVED');
  assert.equal(bound.activeContext?.rlsTenantSetting, "app.current_tenant_id = 'org-primary'");
  assert.equal(bound.activeContext?.objectStoragePrefix, 'tenants/org-primary/');

  const storageValidation = capability.validateStoragePrefix(
    bound.activeContext,
    'tenants/org-primary/records/1'
  );
  assert.equal(storageValidation.valid, true);
  assert.equal(storageValidation.error, null);
});

test("tenantisolationprooferrormodel", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [
      { domain: 'pending.example.com', organisationId: 'org-1', slug: 'tenant1', status: 'PENDING' },
    ],
  };

  const untrustedOutcome = capability.resolveTenantContext(
    { 'x-forwarded-host': 'attacker.example.com' },
    state
  );
  assert.equal(untrustedOutcome.context, null);
  assert.equal(untrustedOutcome.error?.kind, 'UNTRUSTED_HOST');
  assert.equal(capability.mapErrorToStatusCode(untrustedOutcome.error!), 404);

  const unverifiedOutcome = capability.resolveTenantContext(
    { 'x-forwarded-host': 'pending.example.com' },
    state
  );
  assert.equal(unverifiedOutcome.context, null);
  assert.equal(unverifiedOutcome.error?.kind, 'UNVERIFIED_CUSTOM_DOMAIN');
  assert.equal(capability.mapErrorToStatusCode(unverifiedOutcome.error!), 404);

  const absentOutcome = capability.resolveTenantContext(
    { 'x-forwarded-host': 'absent.example.com' },
    { ...state, customDomains: [] }
  );
  assert.equal(absentOutcome.context, null);
  assert.equal(absentOutcome.error?.kind, 'UNTRUSTED_HOST');

  const bound = capability.bindRequestContext(state, {
    headers: { 'x-forwarded-host': 'tenant1.anqr.io' },
  });
  const foreignActor: capability.TenantActor = {
    actorId: 'attacker-1',
    organisationId: 'org-foreign',
    roles: ['member'],
  };
  const foreignAuth = capability.authorizeTenantActor(bound.activeContext, foreignActor);
  assert.equal(foreignAuth.authorized, false);
  assert.equal(foreignAuth.error?.kind, 'FOREIGN_TENANT_ACCESS_DENIED');
  assert.equal(capability.mapErrorToStatusCode(foreignAuth.error!), 403);

  const rows: capability.TenantRowRecord[] = [
    { id: '1', organisationId: 'org-1', payload: 'visible' },
    { id: '2', organisationId: 'org-2', payload: 'hidden' },
  ];
  const filtered = capability.filterTenantRows(bound.activeContext, rows);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].organisationId, 'org-1');

  const degradedReadiness = capability.evaluateReadiness([
    { probe: 'RESOLVER', healthy: true, latencyMs: 5 },
    { probe: 'ROW_LEVEL_SECURITY', healthy: false, latencyMs: 0 },
  ]);
  assert.equal(degradedReadiness, 'DEGRADED');
});

test("tenantisolationprooflifecycle", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
  };

  const bound = capability.bindRequestContext(state, {
    headers: { 'x-forwarded-host': 'tenant1.anqr.io' },
  });
  assert.equal(bound.lastClassification, 'SLUG');
  assert.notEqual(bound.activeContext, null);
  assert.equal(bound.activeContext?.organisationId, 'org-1');

  const validStorage = capability.validateStoragePrefix(bound.activeContext, 'tenants/org-1/assets/logo.png');
  assert.equal(validStorage.valid, true);

  const crossStorage = capability.validateStoragePrefix(bound.activeContext, 'tenants/org-2/assets/logo.png');
  assert.equal(crossStorage.valid, false);
  assert.equal(crossStorage.error?.kind, 'CROSS_TENANT_READ_PREVENTED');

  const rows: capability.TenantRowRecord[] = [
    { id: 'r1', organisationId: 'org-1', payload: 't1' },
    { id: 'r2', organisationId: 'org-2', payload: 't2' },
  ];
  const readResult = capability.filterTenantRows(bound.activeContext, rows);
  assert.equal(readResult.rows.length, 1);
  assert.equal(readResult.rows[0].id, 'r1');

  const actor: capability.TenantActor = { actorId: 'u1', organisationId: 'org-1', roles: ['user'] };
  const writeGuard = capability.guardTenantMutation(bound.activeContext, actor, 'org-2');
  assert.equal(writeGuard.allowed, false);
  assert.equal(writeGuard.error?.kind, 'CROSS_TENANT_WRITE_PREVENTED');

  const probes: capability.SubstrateProbeKind[] = [
    'ROW_LEVEL_SECURITY',
    'STORAGE_PREFIX',
    'METERING',
    'SEARCH',
    'OBSERVABILITY',
    'WEBHOOKS',
    'EVENTS',
    'SECRET_STORE',
  ];
  for (const probe of probes) {
    const proof = capability.runSubstrateProof(probe, bound.activeContext, () => ({
      healthy: true,
      latencyMs: 10,
      violations: 0,
    }));
    assert.equal(proof.verified, true);
    assert.equal(proof.crossTenantViolations, 0);
    assert.equal(proof.organisationId, 'org-1');
  }

  const untrustedBound = capability.bindRequestContext(state, {
    headers: { 'x-forwarded-host': 'evil.com' },
  });
  assert.equal(untrustedBound.activeContext, null);
});

test("tenantisolationproofpermissions", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
  };

  const unresolvedAuth = capability.authorizeTenantActor(null, {
    actorId: 'u1',
    organisationId: 'org-1',
    roles: ['member'],
  });
  assert.equal(unresolvedAuth.authorized, false);
  assert.equal(unresolvedAuth.error?.kind, 'UNTRUSTED_HOST');

  const apexOutcome = capability.resolveTenantContext({ 'x-forwarded-host': 'anqr.io' }, state);
  assert.equal(apexOutcome.context, null);
  assert.equal(apexOutcome.error?.kind, 'APEX_HOST_DENIED');

  const reservedOutcome = capability.resolveTenantContext({ 'x-forwarded-host': 'admin.anqr.io' }, state);
  assert.equal(reservedOutcome.context, null);
  assert.equal(reservedOutcome.error?.kind, 'RESERVED_HOST_DENIED');

  const bound = capability.bindRequestContext(state, {
    headers: { 'x-forwarded-host': 'tenant1.anqr.io' },
  });

  const memberActor: capability.TenantActor = {
    actorId: 'u1',
    organisationId: 'org-1',
    roles: ['member'],
  };
  const memberAuth = capability.authorizeTenantActor(bound.activeContext, memberActor);
  assert.equal(memberAuth.authorized, true);

  const foreignActor: capability.TenantActor = {
    actorId: 'u2',
    organisationId: 'org-2',
    roles: ['member'],
  };
  const foreignAuth = capability.authorizeTenantActor(bound.activeContext, foreignActor);
  assert.equal(foreignAuth.authorized, false);
  assert.equal(foreignAuth.error?.kind, 'FOREIGN_TENANT_ACCESS_DENIED');

  const systemOperator: capability.TenantActor = {
    actorId: 'sys-admin',
    organisationId: 'sys-org',
    roles: ['system_operator'],
    isSystemOperator: true,
  };
  const systemAuth = capability.authorizeTenantActor(bound.activeContext, systemOperator);
  assert.equal(systemAuth.authorized, true);

  const rows: capability.TenantRowRecord[] = [
    { id: '1', organisationId: 'org-1', payload: 'a' },
    { id: '2', organisationId: 'org-2', payload: 'b' },
  ];
  const operatorFiltered = capability.filterTenantRows(bound.activeContext, rows, systemOperator);
  assert.equal(operatorFiltered.rows.length, 2);
});

test("tenantisolationproofproof", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [
      { domain: 'app.custom.com', organisationId: 'org-1', slug: 'tenant1', status: 'ACTIVE' },
    ],
  };

  const matrix = capability.verifyDomainIdentityMatrix(
    state,
    ['tenant1.anqr.io', 'app.custom.com', 'admin.anqr.io', 'anqr.io', 'untrusted.com']
  );
  assert.equal(matrix[0].classification, 'SLUG');
  assert.equal(matrix[0].resolvedOrgId, 'org-1');
  assert.equal(matrix[1].classification, 'CUSTOM_DOMAIN');
  assert.equal(matrix[1].resolvedOrgId, 'org-1');
  assert.equal(matrix[2].classification, 'RESERVED');
  assert.equal(matrix[2].resolvedOrgId, null);
  assert.equal(matrix[3].classification, 'APEX');
  assert.equal(matrix[3].resolvedOrgId, null);
  assert.equal(matrix[4].classification, 'UNKNOWN');
  assert.equal(matrix[4].resolvedOrgId, null);

  const bound = capability.bindRequestContext(state, {
    headers: { 'x-forwarded-host': 'tenant1.anqr.io' },
  });

  const probes: capability.SubstrateProbeKind[] = [
    'METERING',
    'SEARCH',
    'OBSERVABILITY',
    'WEBHOOKS',
    'EVENTS',
    'SECRET_STORE',
    'ROW_LEVEL_SECURITY',
    'STORAGE_PREFIX',
  ];
  for (const probe of probes) {
    const proof = capability.runSubstrateProof(probe, bound.activeContext, () => ({
      healthy: true,
      latencyMs: 12,
      violations: 0,
    }));
    assert.equal(proof.verified, true);
    assert.equal(proof.proofType, probe);
    assert.equal(proof.crossTenantViolations, 0);
  }

  const pendingProof = capability.runSubstrateProof('RESOLVER', null, () => ({
    healthy: true,
    latencyMs: 5,
  }));
  assert.equal(pendingProof.verified, false);
  assert.equal(pendingProof.organisationId, 'unresolved');
  assert.match(pendingProof.details, /Proof pending/);
});

test("tenantisolationproofreadinessmodel", () => {
  const healthyProbes: capability.SubstrateProbeStatus[] = [
    { probe: 'RESOLVER', healthy: true, latencyMs: 5 },
    { probe: 'ROW_LEVEL_SECURITY', healthy: true, latencyMs: 12 },
    { probe: 'STORAGE_PREFIX', healthy: true, latencyMs: 8 },
  ];
  assert.equal(capability.evaluateReadiness(healthyProbes), 'READY');

  const degradedProbes: capability.SubstrateProbeStatus[] = [
    { probe: 'RESOLVER', healthy: true, latencyMs: 5 },
    { probe: 'ROW_LEVEL_SECURITY', healthy: false, latencyMs: 0, details: 'Database connection failed' },
  ];
  assert.equal(capability.evaluateReadiness(degradedProbes), 'DEGRADED');

  assert.equal(capability.evaluateReadiness([]), 'READY');
});

test("tenantisolationproofstatemodel", () => {
  const baseState: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-alpha', slug: 'alpha', active: true }],
    customDomains: [
      { domain: 'alpha.corp.com', organisationId: 'org-alpha', slug: 'alpha', status: 'ACTIVE' },
    ],
  };

  const slugBound = capability.bindRequestContext(baseState, {
    headers: { 'x-forwarded-host': 'alpha.anqr.io' },
  });
  assert.equal(slugBound.lastClassification, 'SLUG');
  assert.equal(slugBound.activeContext?.organisationId, 'org-alpha');
  assert.equal(slugBound.activeContext?.slug, 'alpha');
  assert.equal(slugBound.activeContext?.hostSource, 'SLUG_RESOLVED');
  assert.equal(slugBound.activeContext?.rlsTenantSetting, "app.current_tenant_id = 'org-alpha'");
  assert.equal(slugBound.activeContext?.objectStoragePrefix, 'tenants/org-alpha/');

  const customBound = capability.bindRequestContext(baseState, {
    headers: { 'x-forwarded-host': 'alpha.corp.com' },
  });
  assert.equal(customBound.lastClassification, 'CUSTOM_DOMAIN');
  assert.equal(customBound.activeContext?.organisationId, 'org-alpha');
  assert.equal(customBound.activeContext?.slug, 'alpha');
  assert.equal(customBound.activeContext?.hostSource, 'CUSTOM_DOMAIN_VERIFIED');
  assert.equal(customBound.activeContext?.rlsTenantSetting, "app.current_tenant_id = 'org-alpha'");
  assert.equal(customBound.activeContext?.objectStoragePrefix, 'tenants/org-alpha/');

  const untrustedBound = capability.bindRequestContext(baseState, {
    headers: { 'x-forwarded-host': 'unknown.host.net' },
  });
  assert.equal(untrustedBound.activeContext, null);
  assert.equal(untrustedBound.lastClassification, 'UNKNOWN');

  const apexBound = capability.bindRequestContext(baseState, {
    headers: { 'x-forwarded-host': 'anqr.io' },
  });
  assert.equal(apexBound.activeContext, null);
  assert.equal(apexBound.lastClassification, 'APEX');

  const reservedBound = capability.bindRequestContext(baseState, {
    headers: { 'x-forwarded-host': 'internal.anqr.io' },
  });
  assert.equal(reservedBound.activeContext, null);
  assert.equal(reservedBound.lastClassification, 'RESERVED');

  const malformedBound = capability.bindRequestContext(baseState, {
    headers: { 'x-forwarded-host': 'bad/host' },
  });
  assert.equal(malformedBound.activeContext, null);
  assert.equal(malformedBound.lastClassification, 'MALFORMED');
});

test("tenantisolationproofvalidation", () => {
  const state: capability.TenantIsolationProofState = {
    ...capability.initialState,
    tenants: [{ organisationId: 'org-1', slug: 'tenant1', active: true }],
    customDomains: [
      { domain: 'active.com', organisationId: 'org-1', slug: 'tenant1', status: 'ACTIVE' },
      { domain: 'inactive.com', organisationId: 'org-1', slug: 'tenant1', status: 'INACTIVE' },
      { domain: 'pending.com', organisationId: 'org-1', slug: 'tenant1', status: 'PENDING' },
      { domain: 'disabled.com', organisationId: 'org-1', slug: 'tenant1', status: 'DISABLED' },
    ],
  };

  const slugRes = capability.resolveTenantContext({ 'x-forwarded-host': 'tenant1.anqr.io' }, state);
  assert.equal(slugRes.classification, 'SLUG');
  assert.equal(slugRes.context?.organisationId, 'org-1');

  const activeRes = capability.resolveTenantContext({ 'x-forwarded-host': 'active.com' }, state);
  assert.equal(activeRes.classification, 'CUSTOM_DOMAIN');
  assert.equal(activeRes.context?.organisationId, 'org-1');

  for (const domain of ['inactive.com', 'pending.com', 'disabled.com']) {
    const rejectedRes = capability.resolveTenantContext({ 'x-forwarded-host': domain }, state);
    assert.equal(rejectedRes.context, null);
    assert.equal(rejectedRes.error?.kind, 'UNVERIFIED_CUSTOM_DOMAIN');
  }

  const precedence = capability.extractForwardedHost({
    'x-forwarded-host': 'first.anqr.io',
    'x-original-host': 'second.anqr.io',
    host: 'third.anqr.io',
  });
  assert.equal(precedence, 'first.anqr.io');

  assert.equal(capability.resolveTenantContext({ 'x-forwarded-host': 'anqr.io' }, state).context, null);
  assert.equal(capability.resolveTenantContext({ 'x-forwarded-host': 'admin.anqr.io' }, state).context, null);
  assert.equal(capability.resolveTenantContext({ 'x-forwarded-host': 'unknown.com' }, state).context, null);
  assert.equal(capability.resolveTenantContext({ 'x-forwarded-host': '' }, state).context, null);

  const bound = capability.bindRequestContext(state, {
    headers: { 'x-forwarded-host': 'tenant1.anqr.io' },
  });
  assert.equal(capability.validateStoragePrefix(bound.activeContext, 'tenants/org-1/docs/1').valid, true);
  assert.equal(capability.validateStoragePrefix(bound.activeContext, 'tenants/org-2/docs/1').valid, false);

  const filtered = capability.filterTenantRows(bound.activeContext, [
    { id: '1', organisationId: 'org-1', payload: {} },
    { id: '2', organisationId: 'org-2', payload: {} },
  ]);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].organisationId, 'org-1');

  const violationProof = capability.runSubstrateProof('ROW_LEVEL_SECURITY', bound.activeContext, () => ({
    healthy: true,
    latencyMs: 10,
    violations: 2,
  }));
  assert.equal(violationProof.verified, false);
  assert.equal(violationProof.crossTenantViolations, 2);

  const zeroViolationProof = capability.runSubstrateProof('ROW_LEVEL_SECURITY', bound.activeContext, () => ({
    healthy: true,
    latencyMs: 10,
    violations: 0,
  }));
  assert.equal(zeroViolationProof.verified, true);
  assert.equal(zeroViolationProof.crossTenantViolations, 0);
});