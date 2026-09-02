import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/tenanthostidentityresolution.ts";

test("tenanthostidentityresolutionauditmodel", () => {
  assert.equal(capability.HAS_MUTATION_AUDIT, false);
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [],
    true
  );
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };
  const result = capability.resolveHostIdentity({ host: 'tenant.example.com' }, registry, config);
  assert.equal(result.success, true);
  assert.equal(result.error, null);
});

test("tenanthostidentityresolutioncontracts", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [],
    true
  );
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };
  const request: capability.RequestContext = {
    host: 'internal.example.com',
    forwardedHost: 'tenant.example.com',
    headers: { 'x-forwarded-host': 'tenant.example.com' },
  };
  const result = capability.resolveHostIdentity(request, registry, config);
  assert.equal(result.classification, 'tenant_slug');
  assert.notEqual(result.tenant, null);
  if (result.tenant !== null) {
    assert.equal(result.tenant.organizationId, 'org1');
    assert.equal(result.tenant.slug, 'tenant');
    assert.equal(result.tenant.realmName, 'realm1');
    assert.equal(result.tenant.hostSource, 'tenant_slug');
  }
  assert.equal(typeof result.state.sanitizedHost, 'string');
  assert.equal(typeof result.state.apexDomain, 'string');
});

test("tenanthostidentityresolutionerrormodel", () => {
  const registry = capability.createInMemoryDomainRegistry([], [], false);
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };

  const apexRequest: capability.RequestContext = { host: 'example.com' };
  const apexResult = capability.resolveHostIdentity(apexRequest, registry, config);
  assert.equal(apexResult.tenant, null);
  assert.equal(apexResult.classification, 'apex');
  assert.equal(apexResult.success, true);

  const reservedRequest: capability.RequestContext = { host: 'admin.example.com' };
  const reservedResult = capability.resolveHostIdentity(reservedRequest, registry, config);
  assert.equal(reservedResult.tenant, null);
  assert.equal(reservedResult.classification, 'reserved_subdomain');

  const globalGuardReserved = capability.guardGlobalRoute('reserved_subdomain', 'admin.example.com');
  assert.equal(globalGuardReserved.rejected, true);
  if (globalGuardReserved.rejected) {
    assert.equal(globalGuardReserved.reason, 'APEX_SUBDOMAIN_REJECTED');
    assert.equal(globalGuardReserved.statusCode, 400);
    assert.notEqual(globalGuardReserved.detail, '');
  }
  const globalGuardInvalid = capability.guardGlobalRoute('invalid_subdomain', 'deep.nested.example.com');
  assert.equal(globalGuardInvalid.rejected, true);

  const slugRequest: capability.RequestContext = { host: 'tenant.example.com' };
  const slugResult = capability.resolveHostIdentity(slugRequest, registry, config);
  assert.equal(slugResult.success, false);
  if (!slugResult.success) {
    assert.equal(slugResult.error.kind, 'REGISTRY_DEGRADED');
    assert.equal(slugResult.error.statusCode, 503);
  }
  assert.equal(slugResult.tenant, null);

  const customRequest: capability.RequestContext = { host: 'unknown.example.org' };
  const customResult = capability.resolveHostIdentity(customRequest, registry, config);
  assert.equal(customResult.success, false);
  if (!customResult.success) {
    assert.equal(customResult.error.kind, 'REGISTRY_DEGRADED');
    assert.equal(customResult.error.statusCode, 503);
  }
  assert.equal(customResult.tenant, null);

  const unknownSlugRequest: capability.RequestContext = { host: 'ghost.example.com' };
  const goodRegistry = capability.createInMemoryDomainRegistry([], [], true);
  const unknownSlugResult = capability.resolveHostIdentity(unknownSlugRequest, goodRegistry, config);
  assert.equal(unknownSlugResult.tenant, null);
  assert.equal(unknownSlugResult.success, true);
});

test("tenanthostidentityresolutionlifecycle", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [
      { domain: 'custom.example.com', organizationId: 'org2', slug: 'custom', realmName: 'realm2', status: 'active' },
      { domain: 'pending.example.com', organizationId: 'org3', slug: 'pending', realmName: 'realm3', status: 'pending' },
      { domain: 'inactive.example.com', organizationId: 'org4', slug: 'inactive', realmName: 'realm4', status: 'inactive' },
      { domain: 'disabled.example.com', organizationId: 'org5', slug: 'disabled', realmName: 'realm5', status: 'disabled' },
    ],
    true
  );
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };

  const apexResult = capability.resolveHostIdentity({ host: 'example.com' }, registry, config);
  assert.equal(apexResult.classification, 'apex');
  assert.equal(apexResult.tenant, null);

  const reservedResult = capability.resolveHostIdentity({ host: 'admin.example.com' }, registry, config);
  assert.equal(reservedResult.classification, 'reserved_subdomain');
  assert.equal(reservedResult.tenant, null);

  const malformedResult = capability.resolveHostIdentity({ host: 'invalid..host' }, registry, config);
  assert.equal(malformedResult.classification, 'malformed');
  assert.equal(malformedResult.tenant, null);

  const invalidSubResult = capability.resolveHostIdentity({ host: 'deep.nested.example.com' }, registry, config);
  assert.equal(invalidSubResult.classification, 'invalid_subdomain');
  assert.equal(invalidSubResult.tenant, null);

  const slugResult = capability.resolveHostIdentity({ host: 'tenant.example.com' }, registry, config);
  assert.equal(slugResult.classification, 'tenant_slug');
  assert.notEqual(slugResult.tenant, null);

  const activeResult = capability.resolveHostIdentity({ host: 'custom.example.com' }, registry, config);
  assert.equal(activeResult.classification, 'possible_custom_domain');
  assert.notEqual(activeResult.tenant, null);

  const pendingResult = capability.resolveHostIdentity({ host: 'pending.example.com' }, registry, config);
  assert.equal(pendingResult.classification, 'possible_custom_domain');
  assert.equal(pendingResult.tenant, null);

  const inactiveResult = capability.resolveHostIdentity({ host: 'inactive.example.com' }, registry, config);
  assert.equal(inactiveResult.classification, 'possible_custom_domain');
  assert.equal(inactiveResult.tenant, null);

  const disabledResult = capability.resolveHostIdentity({ host: 'disabled.example.com' }, registry, config);
  assert.equal(disabledResult.classification, 'possible_custom_domain');
  assert.equal(disabledResult.tenant, null);
});

test("tenanthostidentityresolutionproof", () => {
  const proofConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    seededDomains: [
      { domain: 'custom.example.com', organizationId: 'org1', slug: 'tenant', realmName: 'realm1', status: 'active' },
      { domain: 'inactive.example.com', organizationId: 'org2', slug: 'inactive', realmName: 'realm2', status: 'inactive' },
    ],
    substrateAvailable: true,
    registryAvailable: true,
  };
  const proof = capability.validateRuntimeProof(proofConfig, 'example.com');
  assert.equal(proof.status, 'VALIDATED');
  assert.equal(proof.lineage, 'hermetic');
  assert.equal(proof.matrixValidationPassed, true);

  const pendingConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    seededDomains: [],
    substrateAvailable: false,
    registryAvailable: false,
  };
  const pendingProof = capability.validateRuntimeProof(pendingConfig, 'example.com');
  assert.equal(pendingProof.status, 'PENDING');
  assert.equal(pendingProof.lineage, 'runtime');
  assert.equal(pendingProof.matrixValidationPassed, false);

  const skippedConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [],
    seededDomains: [],
    substrateAvailable: true,
    registryAvailable: true,
  };
  const skippedProof = capability.validateRuntimeProof(skippedConfig, 'example.com');
  assert.equal(skippedProof.status, 'SKIPPED');
});

test("tenanthostidentityresolutionreadinessmodel", () => {
  const readyRegistry = capability.createInMemoryDomainRegistry([], [], true);
  assert.equal(capability.checkReadiness(readyRegistry), 'READY');

  const degradedRegistry = capability.createInMemoryDomainRegistry([], [], false);
  assert.equal(capability.checkReadiness(degradedRegistry), 'DEGRADED');

  assert.equal(capability.checkReadiness(null), 'NOT_READY');
  assert.equal(capability.checkReadiness(undefined), 'NOT_READY');

  const degradedConfig: capability.ResolverConfiguration = { apexDomain: 'example.com' };
  const degradedResolver = capability.resolveHostIdentity(
    { host: 'tenant.example.com' },
    capability.createInMemoryDomainRegistry([], [], false),
    degradedConfig,
  );
  assert.equal(degradedResolver.success, false);
  if (!degradedResolver.success) {
    assert.equal(degradedResolver.error.statusCode, 503);
  }

  const skippedConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [],
    seededDomains: [],
    substrateAvailable: true,
    registryAvailable: true,
  };
  const skippedProof = capability.validateRuntimeProof(skippedConfig, 'example.com');
  assert.equal(skippedProof.status, 'SKIPPED');
  assert.equal(skippedProof.lineage, 'runtime');
});

test("tenanthostidentityresolutionstatemodel", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [
      { domain: 'shop.example.com', organizationId: 'org2', slug: 'shop', realmName: 'realm2', status: 'active' },
    ],
    true,
  );
  const config: capability.ResolverConfiguration = { apexDomain: 'example.com' };

  const slugResult = capability.resolveHostIdentity({ host: 'tenant.example.com' }, registry, config);
  assert.equal(slugResult.state.classification, 'tenant_slug');
  assert.equal(slugResult.state.tenant !== null, true);
  assert.equal(slugResult.state.isTrusted, true);
  if (slugResult.state.tenant !== null) {
    assert.equal(slugResult.state.tenant.organizationId, 'org1');
    assert.equal(slugResult.state.tenant.slug, 'tenant');
    assert.equal(slugResult.state.tenant.realmName, 'realm1');
    assert.equal(slugResult.state.tenant.hostSource, 'tenant_slug');
  }

  const customResult = capability.resolveHostIdentity({ host: 'shop.example.com' }, registry, config);
  assert.equal(customResult.state.classification, 'possible_custom_domain');
  assert.equal(customResult.state.tenant !== null, true);
  assert.equal(customResult.state.isTrusted, true);
  if (customResult.state.tenant !== null) {
    assert.equal(customResult.state.tenant.hostSource, 'custom_domain');
    assert.equal(customResult.state.tenant.organizationId, 'org2');
  }

  const apexState = capability.resolveHostIdentity({ host: 'example.com' }, registry, config);
  assert.equal(apexState.state.classification, 'apex');
  assert.equal(apexState.state.tenant, null);
  assert.equal(apexState.state.isTrusted, false);

  const reservedState = capability.resolveHostIdentity({ host: 'admin.example.com' }, registry, config);
  assert.equal(reservedState.state.classification, 'reserved_subdomain');
  assert.equal(reservedState.state.tenant, null);
  assert.equal(reservedState.state.isTrusted, false);

  const invalidState = capability.resolveHostIdentity({ host: 'deep.nested.example.com' }, registry, config);
  assert.equal(invalidState.state.classification, 'invalid_subdomain');
  assert.equal(invalidState.state.tenant, null);
  assert.equal(invalidState.state.isTrusted, false);

  const malformedState = capability.resolveHostIdentity({ host: 'invalid..host' }, registry, config);
  assert.equal(malformedState.state.classification, 'malformed');
  assert.equal(malformedState.state.tenant, null);
  assert.equal(malformedState.state.isTrusted, false);
});

test("tenanthostidentityresolutionvalidation", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [{ organizationId: 'org1', slug: 'tenant', realmName: 'realm1', active: true }],
    [
      { domain: 'shop.example.com', organizationId: 'org2', slug: 'shop', realmName: 'realm2', status: 'active' },
    ],
    true,
  );

  assert.equal(capability.stripPort('Example.COM:8080'), 'example.com');
  assert.equal(capability.stripPort('tenant.example.com'), 'tenant.example.com');
  assert.equal(capability.stripPort('[2001:db8::1]:443'), '[2001:db8::1]');

  assert.equal(capability.classifyHost('example.com:8443', 'example.com'), 'apex');
  assert.equal(capability.classifyHost('admin.example.com', 'example.com'), 'reserved_subdomain');
  assert.equal(capability.classifyHost('deep.nested.example.com', 'example.com'), 'invalid_subdomain');
  assert.equal(capability.classifyHost('invalid..host', 'example.com'), 'malformed');
  assert.equal(capability.classifyHost('tenant.example.com', 'example.com'), 'tenant_slug');
  assert.equal(capability.classifyHost('unknown.example.com', 'example.com'), 'possible_custom_domain');
  assert.equal(capability.classifyHost('', 'example.com'), 'malformed');
  assert.equal(capability.classifyHost('bad-underscore.example.com', 'example.com'), 'malformed');

  const config: capability.ResolverConfiguration = {
    apexDomain: 'example.com',
    trustForwardedHost: true,
    reservedSubdomains: ['admin', 'api'],
  };

  const forwardedResult = capability.resolveHostIdentity(
    { host: 'ignored.com', forwardedHost: 'tenant.example.com' },
    registry,
    config,
  );
  assert.equal(forwardedResult.classification, 'tenant_slug');
  assert.notEqual(forwardedResult.tenant, null);

  const headerResult = capability.resolveHostIdentity(
    {
      host: 'ignored.com',
      headers: { 'x-forwarded-host': 'shop.example.com' },
    },
    registry,
    config,
  );
  assert.equal(headerResult.classification, 'possible_custom_domain');
  assert.notEqual(headerResult.tenant, null);

  const noTrustResult = capability.resolveHostIdentity(
    { host: 'ignored.com', forwardedHost: 'tenant.example.com' },
    registry,
    { apexDomain: 'example.com', trustForwardedHost: false },
  );
  assert.equal(noTrustResult.classification, 'possible_custom_domain');
  assert.equal(noTrustResult.tenant, null);

  const unknownCustomResult = capability.resolveHostIdentity(
    { host: 'mystery.example.org' },
    registry,
    config,
  );
  assert.equal(unknownCustomResult.classification, 'possible_custom_domain');
  assert.equal(unknownCustomResult.tenant, null);

  const unknownSlugResult = capability.resolveHostIdentity(
    { host: 'ghost.example.com' },
    registry,
    config,
  );
  assert.equal(unknownSlugResult.classification, 'tenant_slug');
  assert.equal(unknownSlugResult.tenant, null);
});