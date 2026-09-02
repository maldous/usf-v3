import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/tenanthostidentityresolution.ts";

test("tenanthostidentityresolutionauditmodel", () => {
  assert.equal(capability.HAS_MUTATION_AUDIT, false);
});

test("tenanthostidentityresolutioncontracts", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [],
    true
  );
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };
  const request: capability.RequestContext = { host: 'tenant.example.com' };
  const result = capability.resolveHostIdentity(request, registry, config);
  assert.equal(result.classification, 'tenant_slug');
  assert.notEqual(result.tenant, null);
  assert.equal(result.tenant?.slug, 'tenant');
});

test("tenanthostidentityresolutionerrormodel", () => {
  const registry = capability.createInMemoryDomainRegistry([], [], false);
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };

  const apexRequest: capability.RequestContext = { host: 'example.com' };
  const apexResult = capability.resolveHostIdentity(apexRequest, registry, config);
  assert.equal(apexResult.tenant, null);
  assert.equal(apexResult.classification, 'apex');

  const reservedRequest: capability.RequestContext = { host: 'admin.example.com' };
  const reservedResult = capability.resolveHostIdentity(reservedRequest, registry, config);
  assert.equal(reservedResult.tenant, null);
  assert.equal(reservedResult.classification, 'reserved_subdomain');

  const globalGuard = capability.guardGlobalRoute('reserved_subdomain', 'admin.example.com');
  assert.equal(globalGuard.rejected, true);
  assert.equal(globalGuard.reason, 'APEX_SUBDOMAIN_REJECTED');

  const degradedRequest: capability.RequestContext = { host: 'tenant.example.com' };
  const degradedResult = capability.resolveHostIdentity(degradedRequest, registry, config);
  assert.equal(degradedResult.success, false);
  assert.equal(degradedResult.error?.kind, 'REGISTRY_DEGRADED');
});

test("tenanthostidentityresolutionlifecycle", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [
      { domain: 'custom.example.com', organizationId: 'org2', slug: 'custom', realmName: 'realm2', status: 'active' },
      { domain: 'inactive.example.com', organizationId: 'org3', slug: 'inactive', realmName: 'realm3', status: 'inactive' }
    ],
    true
  );
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };

  const apexRequest: capability.RequestContext = { host: 'example.com' };
  const apexResult = capability.resolveHostIdentity(apexRequest, registry, config);
  assert.equal(apexResult.classification, 'apex');
  assert.equal(apexResult.tenant, null);

  const reservedRequest: capability.RequestContext = { host: 'admin.example.com' };
  const reservedResult = capability.resolveHostIdentity(reservedRequest, registry, config);
  assert.equal(reservedResult.classification, 'reserved_subdomain');
  assert.equal(reservedResult.tenant, null);

  const invalidRequest: capability.RequestContext = { host: 'invalid..host' };
  const invalidResult = capability.resolveHostIdentity(invalidRequest, registry, config);
  assert.equal(invalidResult.classification, 'malformed');
  assert.equal(invalidResult.tenant, null);

  const tenantSlugRequest: capability.RequestContext = { host: 'tenant.example.com' };
  const tenantSlugResult = capability.resolveHostIdentity(tenantSlugRequest, registry, config);
  assert.equal(tenantSlugResult.classification, 'tenant_slug');
  assert.notEqual(tenantSlugResult.tenant, null);

  const activeCustomRequest: capability.RequestContext = { host: 'custom.example.com' };
  const activeCustomResult = capability.resolveHostIdentity(activeCustomRequest, registry, config);
  assert.equal(activeCustomResult.classification, 'possible_custom_domain');
  assert.notEqual(activeCustomResult.tenant, null);

  const inactiveCustomRequest: capability.RequestContext = { host: 'inactive.example.com' };
  const inactiveCustomResult = capability.resolveHostIdentity(inactiveCustomRequest, registry, config);
  assert.equal(inactiveCustomResult.classification, 'possible_custom_domain');
  assert.equal(inactiveCustomResult.tenant, null);
});

test("tenanthostidentityresolutionproof", () => {
  const proofConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    seededDomains: [
      { domain: 'custom.example.com', organizationId: 'org1', slug: 'tenant', realmName: 'realm1', status: 'active' }
    ],
    substrateAvailable: true,
    registryAvailable: true
  };
  const proof = capability.validateRuntimeProof(proofConfig);
  assert.equal(proof.status, 'VALIDATED');
  assert.equal(proof.lineage, 'hermetic');
  assert.equal(proof.matrixValidationPassed, true);

  const pendingConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [],
    seededDomains: [],
    substrateAvailable: false,
    registryAvailable: false
  };
  const pendingProof = capability.validateRuntimeProof(pendingConfig);
  assert.equal(pendingProof.status, 'PENDING');
  assert.equal(pendingProof.lineage, 'runtime');
});

test("tenanthostidentityresolutionreadinessmodel", () => {
  const registry = capability.createInMemoryDomainRegistry([], [], true);
  const ready = capability.checkReadiness(registry);
  assert.equal(ready, 'READY');

  const degradedRegistry = capability.createInMemoryDomainRegistry([], [], false);
  const degraded = capability.checkReadiness(degradedRegistry);
  assert.equal(degraded, 'DEGRADED');

  const nullRegistry = capability.checkReadiness(null);
  assert.equal(nullRegistry, 'NOT_READY');

  const proofConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [],
    seededDomains: [],
    substrateAvailable: true,
    registryAvailable: true
  };
  const skippedProof = capability.validateRuntimeProof(proofConfig);
  assert.equal(skippedProof.status, 'SKIPPED');
});

test("tenanthostidentityresolutionstatemodel", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [],
    true
  );
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };

  const resolvedRequest: capability.RequestContext = { host: 'tenant.example.com' };
  const resolvedResult = capability.resolveHostIdentity(resolvedRequest, registry, config);
  assert.equal(resolvedResult.classification, 'tenant_slug');
  assert.notEqual(resolvedResult.tenant, null);
  assert.equal(resolvedResult.tenant?.organizationId, 'org1');
  assert.equal(resolvedResult.tenant?.slug, 'tenant');
  assert.equal(resolvedResult.tenant?.realmName, 'realm1');
  assert.equal(resolvedResult.tenant?.hostSource, 'tenant_slug');

  const untrustedRequest: capability.RequestContext = { host: 'malformed' };
  const untrustedResult = capability.resolveHostIdentity(untrustedRequest, registry, config);
  assert.equal(untrustedResult.classification, 'malformed');
  assert.equal(untrustedResult.tenant, null);
});

test("tenanthostidentityresolutionvalidation", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [],
    true
  );
  const config: capability.ResolverConfiguration = {
    apexDomain: 'example.com',
    trustForwardedHost: true,
    reservedSubdomains: ['admin', 'api']
  };

  assert.equal(capability.classifyHost('example.com:8080', 'example.com'), 'apex');
  assert.equal(capability.classifyHost('admin.example.com', 'example.com'), 'reserved_subdomain');
  assert.equal(capability.classifyHost('', 'example.com'), 'malformed');
  assert.equal(capability.classifyHost('tenant.example.com', 'example.com'), 'tenant_slug');
  assert.equal(capability.classifyHost('unknown.example.com', 'example.com'), 'possible_custom_domain');

  const forwardedRequest: capability.RequestContext = {
    host: 'ignored.com',
    forwardedHost: 'tenant.example.com'
  };
  const forwardedResult = capability.resolveHostIdentity(forwardedRequest, registry, config);
  assert.equal(forwardedResult.classification, 'tenant_slug');
  assert.notEqual(forwardedResult.tenant, null);

  const unknownSlugRequest: capability.RequestContext = { host: 'unknown.example.com' };
  const unknownSlugResult = capability.resolveHostIdentity(unknownSlugRequest, registry, config);
  assert.equal(unknownSlugResult.classification, 'possible_custom_domain');
  assert.equal(unknownSlugResult.tenant, null);
});