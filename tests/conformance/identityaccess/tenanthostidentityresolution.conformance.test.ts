import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/tenanthostidentityresolution.ts";

test("tenanthostidentityresolutionauditmodel", () => {
  const state: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map([['example.com', { organisationId: 'org1', slug: 'example', realmName: 'realm1', active: true }]]),
    readiness: 'READY',
  };
  const result = capability.resolveTenantContext(state, 'example.com', null);
  assert.ok(!('tenantContext' in result) || result.tenantContext !== null || 'kind' in result);
});

test("tenanthostidentityresolutioncontracts", () => {
  const state: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map([['tenant.example.com', { organisationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }]]),
    readiness: 'READY',
  };
  const result = capability.resolveTenantContext(state, 'tenant.example.com', null);
  assert.deepEqual(result, {
    classification: 'POSSIBLE_CUSTOM_DOMAIN',
    tenantContext: {
      organisationId: 'org1',
      slug: 'tenant',
      realmName: 'realm1',
      hostSource: 'custom_domain',
    },
  });
});

test("tenanthostidentityresolutionerrormodel", () => {
  const state: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    readiness: 'READY',
  };
  const apexResult = capability.resolveTenantContext(state, 'example.com', null);
  assert.deepEqual(apexResult, {
    kind: 'APEX_SUBDOMAIN_REJECTED',
    message: 'Apex subdomains are explicitly rejected',
  });

  const invalidResult = capability.resolveTenantContext(state, 'invalid@host', null);
  assert.deepEqual(invalidResult, {
    classification: 'MALFORMED',
    tenantContext: null,
  });
});

test("tenanthostidentityresolutionlifecycle", () => {
  const state: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map([
      ['tenant.localhost', { organisationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
      ['custom.example.com', { organisationId: 'org2', slug: 'custom', realmName: 'realm2', active: false }],
    ]),
    readiness: 'READY',
  };

  const apexResult = capability.classifyHost('example.com');
  assert.equal(apexResult, 'APEX');

  const reservedResult = capability.classifyHost('www.example.com');
  assert.equal(reservedResult, 'RESERVED_SUBDOMAIN');

  const tenantSlugResult = capability.resolveTenantContext(state, 'tenant.localhost', null);
  assert.deepEqual(tenantSlugResult, {
    classification: 'TENANT_SLUG',
    tenantContext: {
      organisationId: 'org1',
      slug: 'tenant',
      realmName: 'realm1',
      hostSource: 'slug',
    },
  });

  const inactiveCustomDomainResult = capability.resolveTenantContext(state, 'custom.example.com', null);
  assert.deepEqual(inactiveCustomDomainResult, {
    classification: 'POSSIBLE_CUSTOM_DOMAIN',
    tenantContext: null,
  });
});

test("tenanthostidentityresolutionproof", () => {
  const state: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map([['tenant.example.com', { organisationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }]]),
    readiness: 'READY',
  };

  const classification = capability.classifyHost('tenant.example.com');
  assert.equal(classification, 'POSSIBLE_CUSTOM_DOMAIN');

  const resolution = capability.resolveTenantContext(state, 'tenant.example.com', null);
  assert.deepEqual(resolution, {
    classification: 'POSSIBLE_CUSTOM_DOMAIN',
    tenantContext: {
      organisationId: 'org1',
      slug: 'tenant',
      realmName: 'realm1',
      hostSource: 'custom_domain',
    },
  });
});

test("tenanthostidentityresolutionreadinessmodel", () => {
  const emptyState: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map(),
    readiness: 'READY',
  };
  assert.equal(capability.checkReadiness(emptyState), 'DEGRADED');

  const readyState: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map([['example.com', { organisationId: 'org1', slug: 'example', realmName: 'realm1', active: true }]]),
    readiness: 'READY',
  };
  assert.equal(capability.checkReadiness(readyState), 'READY');
});

test("tenanthostidentityresolutionstatemodel", () => {
  const state: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map([['tenant.example.com', { organisationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }]]),
    readiness: 'READY',
  };

  const resolvedResult = capability.resolveTenantContext(state, 'tenant.example.com', null);
  assert.equal(resolvedResult.classification, 'POSSIBLE_CUSTOM_DOMAIN');
  assert.notEqual(resolvedResult.tenantContext, null);
  assert.equal(resolvedResult.tenantContext?.organisationId, 'org1');
  assert.equal(resolvedResult.tenantContext?.slug, 'tenant');
  assert.equal(resolvedResult.tenantContext?.realmName, 'realm1');
  assert.equal(resolvedResult.tenantContext?.hostSource, 'custom_domain');

  const untrustedResult = capability.resolveTenantContext(state, 'malformed', null);
  assert.equal(untrustedResult.classification, 'MALFORMED');
  assert.equal(untrustedResult.tenantContext, null);
});

test("tenanthostidentityresolutionvalidation", () => {
  const state: capability.TenantHostIdentityResolutionState = {
    ...capability.initialState,
    domainRegistry: new Map([['tenant.example.com', { organisationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }]]),
    readiness: 'READY',
  };

  assert.equal(capability.classifyHost('example.com:8080'), 'APEX');
  assert.equal(capability.classifyHost('www.example.com'), 'RESERVED_SUBDOMAIN');
  assert.equal(capability.classifyHost(''), 'MALFORMED');
  assert.equal(capability.classifyHost('tenant.localhost'), 'TENANT_SLUG');
  assert.equal(capability.classifyHost('unknown.example.com'), 'POSSIBLE_CUSTOM_DOMAIN');

  const forwardedHostResult = capability.resolveTenantContext(state, 'ignored.com', 'tenant.example.com');
  assert.deepEqual(forwardedHostResult, {
    classification: 'POSSIBLE_CUSTOM_DOMAIN',
    tenantContext: {
      organisationId: 'org1',
      slug: 'tenant',
      realmName: 'realm1',
      hostSource: 'custom_domain',
    },
  });

  const unknownSlugResult = capability.resolveTenantContext(state, 'unknown.localhost', null);
  assert.deepEqual(unknownSlugResult, {
    classification: 'TENANT_SLUG',
    tenantContext: null,
  });
});