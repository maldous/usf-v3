import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/tenanthostidentityresolution.ts";

test("tenanthostidentityresolutionauditmodel", () => {
  assert.equal(capability.HAS_MUTATION_AUDIT, false);

  const cleanAuditResult = capability.auditResolutionEvent("tenant.example.com", () => null);
  assert.equal(cleanAuditResult, null);

  const errorResult: capability.TenantHostIdentityResolutionError = {
    kind: "REGISTRY_DEGRADED",
    message: "audit deferred",
    statusCode: 503,
  };
  const forwardedAuditResult = capability.auditResolutionEvent("tenant.example.com", () => errorResult);
  assert.deepEqual(forwardedAuditResult, errorResult);

  const throwingAuditResult = capability.auditResolutionEvent("tenant.example.com", () => {
    throw new Error("boom");
  });
  assert.notEqual(throwingAuditResult, null);
  if (throwingAuditResult !== null) {
    assert.equal(throwingAuditResult.kind, "UNRESOLVED_HOST");
    assert.equal(throwingAuditResult.statusCode, 503);
  }
});

test("tenanthostidentityresolutioncontracts", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [
      {
        organizationId: "org1",
        slug: "tenant",
        realmName: "realm1",
        active: true,
      },
    ],
    [
      {
        domain: "shop.example.com",
        organizationId: "org2",
        slug: "shop",
        realmName: "realm2",
        status: "active",
      },
    ],
    true,
  );
  const config: capability.ResolverConfiguration = {
    apexDomain: "example.com",
    trustForwardedHost: true,
  };

  const request: capability.RequestContext = {
    host: "ignored.com",
    forwardedHost: "tenant.example.com",
    headers: { "x-forwarded-host": "shop.example.com" },
  };
  const result = capability.resolveHostIdentity(request, registry, config);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.classification, "tenant_slug");
    const tenant = result.tenant;
    assert.notEqual(tenant, null);
    if (tenant !== null) {
      assert.equal(tenant.organizationId, "org1");
      assert.equal(tenant.slug, "tenant");
      assert.equal(tenant.realmName, "realm1");
      assert.equal(tenant.hostSource, "tenant_slug");
    }
    const state = result.state;
    assert.equal(typeof state.sanitizedHost, "string");
    assert.equal(typeof state.apexDomain, "string");
    assert.equal(typeof state.rawHost, "string");
    assert.equal(state.lifecycleStage, "finalize");
    assert.equal(typeof state.isTrusted, "boolean");
  }
});

test("tenanthostidentityresolutionerrormodel", () => {
  const config: capability.ResolverConfiguration = { apexDomain: "example.com" };
  const registry = capability.createInMemoryDomainRegistry([], [], true);

  const guardApex = capability.guardGlobalRoute("apex", "example.com");
  assert.equal(guardApex.rejected, false);

  const guardReserved = capability.guardGlobalRoute("reserved_subdomain", "admin.example.com");
  assert.equal(guardReserved.rejected, true);
  if (guardReserved.rejected) {
    assert.equal(guardReserved.reason, "APEX_SUBDOMAIN_REJECTED");
    assert.equal(guardReserved.statusCode, 400);
    assert.notEqual(guardReserved.detail, "");
  }
  const guardInvalid = capability.guardGlobalRoute("invalid_subdomain", "deep.nested.example.com");
  assert.equal(guardInvalid.rejected, true);
  if (guardInvalid.rejected) {
    assert.equal(guardInvalid.reason, "APEX_SUBDOMAIN_REJECTED");
  }

  const degradedRegistry = capability.createInMemoryDomainRegistry([], [], false);
  const slugResult = capability.resolveHostIdentity(
    { host: "tenant.example.com" },
    degradedRegistry,
    config,
  );
  assert.equal(slugResult.success, false);
  if (!slugResult.success) {
    assert.equal(slugResult.error.kind, "REGISTRY_DEGRADED");
    assert.equal(slugResult.error.statusCode, 503);
  }

  const customResult = capability.resolveHostIdentity(
    { host: "unknown.example.org" },
    degradedRegistry,
    config,
  );
  assert.equal(customResult.success, false);
  if (!customResult.success) {
    assert.equal(customResult.error.kind, "REGISTRY_DEGRADED");
    assert.equal(customResult.error.statusCode, 503);
  }

  const unknownSlugResult = capability.resolveHostIdentity(
    { host: "ghost.example.com" },
    registry,
    config,
  );
  assert.equal(unknownSlugResult.success, true);
  if (unknownSlugResult.success) {
    assert.equal(unknownSlugResult.tenant, null);
    assert.ok(unknownSlugResult.warnings.some((w) => w.kind === "UNKNOWN_SLUG"));
  }

  const unknownCustomResult = capability.resolveHostIdentity(
    { host: "mystery.example.org" },
    registry,
    config,
  );
  assert.equal(unknownCustomResult.success, true);
  if (unknownCustomResult.success) {
    assert.equal(unknownCustomResult.tenant, null);
    assert.ok(unknownCustomResult.warnings.some((w) => w.kind === "UNKNOWN_CUSTOM_DOMAIN"));
  }
});

test("tenanthostidentityresolutionlifecycle", () => {
  const apexDomain = "example.com";
  const registry = capability.createInMemoryDomainRegistry(
    [
      {
        organizationId: "org1",
        slug: "tenant",
        realmName: "realm1",
        active: true,
      },
    ],
    [
      {
        domain: "custom.example.com",
        organizationId: "org2",
        slug: "custom",
        realmName: "realm2",
        status: "active",
      },
      {
        domain: "pending.example.com",
        organizationId: "org3",
        slug: "pending",
        realmName: "realm3",
        status: "pending",
      },
      {
        domain: "inactive.example.com",
        organizationId: "org4",
        slug: "inactive",
        realmName: "realm4",
        status: "inactive",
      },
      {
        domain: "disabled.example.com",
        organizationId: "org5",
        slug: "disabled",
        realmName: "realm5",
        status: "disabled",
      },
    ],
    true,
  );
  const config: capability.ResolverConfiguration = { apexDomain };

  const apexResult = capability.resolveHostIdentity({ host: apexDomain }, registry, config);
  assert.equal(apexResult.success, true);
  if (apexResult.success) {
    assert.equal(apexResult.classification, "apex");
    assert.equal(apexResult.tenant, null);
    assert.equal(apexResult.state.lifecycleStage, "finalize");
    assert.equal(apexResult.state.proofStatus, "PENDING");
  }

  const reservedResult = capability.resolveHostIdentity({ host: "admin.example.com" }, registry, config);
  assert.equal(reservedResult.success, true);
  if (reservedResult.success) {
    assert.equal(reservedResult.classification, "reserved_subdomain");
    assert.equal(reservedResult.tenant, null);
    assert.ok(reservedResult.warnings.some((w) => w.kind === "RESERVED_SUBDOMAIN"));
  }

  const invalidSubResult = capability.resolveHostIdentity(
    { host: "deep.nested.example.com" },
    registry,
    config,
  );
  assert.equal(invalidSubResult.success, true);
  if (invalidSubResult.success) {
    assert.equal(invalidSubResult.classification, "invalid_subdomain");
    assert.equal(invalidSubResult.tenant, null);
    assert.ok(invalidSubResult.warnings.some((w) => w.kind === "INVALID_SUBDOMAIN"));
  }

  const malformedResult = capability.resolveHostIdentity({ host: "invalid..host" }, registry, config);
  assert.equal(malformedResult.success, true);
  if (malformedResult.success) {
    assert.equal(malformedResult.classification, "malformed");
    assert.equal(malformedResult.tenant, null);
    assert.ok(malformedResult.warnings.some((w) => w.kind === "MALFORMED_HOST"));
  }

  const slugResult = capability.resolveHostIdentity({ host: "tenant.example.com" }, registry, config);
  assert.equal(slugResult.success, true);
  if (slugResult.success) {
    assert.equal(slugResult.classification, "tenant_slug");
    const tenant = slugResult.tenant;
    assert.notEqual(tenant, null);
    if (tenant !== null) {
      assert.equal(tenant.organizationId, "org1");
      assert.equal(tenant.slug, "tenant");
      assert.equal(tenant.hostSource, "tenant_slug");
      assert.equal(slugResult.state.lifecycleStage, "finalize");
      assert.equal(slugResult.state.proofStatus, "VALIDATED");
    }
  }

  const activeResult = capability.resolveHostIdentity({ host: "custom.example.com" }, registry, config);
  assert.equal(activeResult.success, true);
  if (activeResult.success) {
    assert.equal(activeResult.classification, "possible_custom_domain");
    const tenant = activeResult.tenant;
    assert.notEqual(tenant, null);
    if (tenant !== null) {
      assert.equal(tenant.hostSource, "custom_domain");
    }
  }

  const pendingResult = capability.resolveHostIdentity({ host: "pending.example.com" }, registry, config);
  assert.equal(pendingResult.success, true);
  if (pendingResult.success) {
    assert.equal(pendingResult.classification, "possible_custom_domain");
    assert.equal(pendingResult.tenant, null);
    assert.ok(pendingResult.warnings.some((w) => w.kind === "PENDING_DOMAIN"));
  }

  const inactiveResult = capability.resolveHostIdentity({ host: "inactive.example.com" }, registry, config);
  assert.equal(inactiveResult.success, true);
  if (inactiveResult.success) {
    assert.equal(inactiveResult.classification, "possible_custom_domain");
    assert.equal(inactiveResult.tenant, null);
    assert.ok(inactiveResult.warnings.some((w) => w.kind === "INACTIVE_DOMAIN"));
  }

  const disabledResult = capability.resolveHostIdentity({ host: "disabled.example.com" }, registry, config);
  assert.equal(disabledResult.success, true);
  if (disabledResult.success) {
    assert.equal(disabledResult.classification, "possible_custom_domain");
    assert.equal(disabledResult.tenant, null);
    assert.ok(disabledResult.warnings.some((w) => w.kind === "DISABLED_DOMAIN"));
  }

  const lifecycleStages: readonly capability.TenantHostIdentityResolutionLifecycleStage[] =
    capability.TenantHostIdentityResolutionLifecycleStage;
  assert.deepEqual([...lifecycleStages], ["classify", "resolve", "finalize"]);
});

test("tenanthostidentityresolutionproof", () => {
  const pendingConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [],
    seededDomains: [],
    substrateAvailable: false,
    registryAvailable: false,
  };
  const pendingProof = capability.validateRuntimeProof(pendingConfig, "example.com");
  assert.equal(pendingProof.status, "PENDING");
  assert.equal(pendingProof.lineage, "hermetic");
  assert.equal(pendingProof.matrixValidationPassed, false);

  const skippedConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [],
    seededDomains: [],
    substrateAvailable: true,
    registryAvailable: true,
  };
  const skippedProof = capability.validateRuntimeProof(skippedConfig, "example.com");
  assert.equal(skippedProof.status, "SKIPPED");
  assert.equal(skippedProof.lineage, "runtime");
  assert.equal(skippedProof.matrixValidationPassed, false);

  const seededOrgs: readonly capability.OrganizationRecord[] = [
    {
      organizationId: "org1",
      slug: "acme",
      realmName: "realm1",
      active: true,
    },
  ];
  const seededDomains: readonly capability.CustomDomainRecord[] = [
    {
      domain: "shop.example.com",
      organizationId: "org1",
      slug: "acme",
      realmName: "realm1",
      status: "active",
    },
  ];
  const validatedConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: seededOrgs,
    seededDomains: seededDomains,
    substrateAvailable: true,
    registryAvailable: true,
  };
  const validatedProof = capability.validateRuntimeProof(validatedConfig, "example.com");
  assert.equal(validatedProof.status, "VALIDATED");
  assert.equal(validatedProof.lineage, "runtime");
  assert.equal(validatedProof.matrixValidationPassed, true);
  assert.ok(validatedProof.details.length > 0);

  const matrixResult = capability.validateMatrixClassification(
    capability.createInMemoryDomainRegistry([], [], true),
    "example.com",
  );
  assert.equal(matrixResult.passed, true);
  assert.ok(matrixResult.matrix.length > 0);
  for (const row of matrixResult.matrix) {
    assert.equal(row.actual, row.expected);
  }

  const proofStatuses: readonly capability.TenantHostIdentityResolutionProofStatus[] =
    capability.TenantHostIdentityResolutionProofStatus;
  assert.deepEqual([...proofStatuses], ["VALIDATED", "PENDING", "SKIPPED"]);

  const lineageValues: readonly capability.TenantHostIdentityResolutionLineage[] =
    capability.TenantHostIdentityResolutionLineage;
  assert.deepEqual([...lineageValues], ["hermetic", "runtime"]);
});

test("tenanthostidentityresolutionreadinessmodel", () => {
  const readyRegistry = capability.createInMemoryDomainRegistry([], [], true);
  assert.equal(capability.checkReadiness(readyRegistry), "READY");

  const degradedRegistry = capability.createInMemoryDomainRegistry([], [], false);
  assert.equal(capability.checkReadiness(degradedRegistry), "DEGRADED");

  assert.equal(capability.checkReadiness(null), "NOT_READY");
  assert.equal(capability.checkReadiness(undefined), "NOT_READY");

  const degradedConfig: capability.ResolverConfiguration = { apexDomain: "example.com" };
  const degradedSlug = capability.resolveHostIdentity(
    { host: "tenant.example.com" },
    degradedRegistry,
    degradedConfig,
  );
  assert.equal(degradedSlug.success, false);
  if (!degradedSlug.success) {
    assert.equal(degradedSlug.error.statusCode, 503);
  }

  const degradedCustom = capability.resolveHostIdentity(
    { host: "mystery.example.org" },
    degradedRegistry,
    degradedConfig,
  );
  assert.equal(degradedCustom.success, false);
  if (!degradedCustom.success) {
    assert.equal(degradedCustom.error.statusCode, 503);
  }

  const readyConfig: capability.ResolverConfiguration = { apexDomain: "example.com" };
  const readyApex = capability.resolveHostIdentity(
    { host: "example.com" },
    readyRegistry,
    readyConfig,
  );
  assert.equal(readyApex.success, true);
  if (readyApex.success) {
    assert.equal(readyApex.classification, "apex");
    assert.equal(readyApex.tenant, null);
  }

  const skippedConfig: capability.HermeticSubstrateProofConfig = {
    seededOrganizations: [],
    seededDomains: [],
    substrateAvailable: true,
    registryAvailable: true,
  };
  const skippedProof = capability.validateRuntimeProof(skippedConfig, "example.com");
  assert.equal(skippedProof.status, "SKIPPED");
  assert.equal(skippedProof.lineage, "runtime");
  assert.equal(skippedProof.matrixValidationPassed, false);

  const readinessValues: readonly capability.TenantHostIdentityResolutionReadiness[] =
    capability.TenantHostIdentityResolutionReadiness;
  assert.deepEqual([...readinessValues], ["READY", "DEGRADED", "NOT_READY"]);
});

test("tenanthostidentityresolutionstatemodel", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [
      {
        organizationId: "org1",
        slug: "tenant",
        realmName: "realm1",
        active: true,
      },
    ],
    [
      {
        domain: "shop.example.com",
        organizationId: "org2",
        slug: "shop",
        realmName: "realm2",
        status: "active",
      },
    ],
    true,
  );
  const config: capability.ResolverConfiguration = { apexDomain: "example.com" };

  const slugResult = capability.resolveHostIdentity({ host: "tenant.example.com" }, registry, config);
  assert.equal(slugResult.success, true);
  if (slugResult.success) {
    const state = slugResult.state;
    assert.equal(state.classification, "tenant_slug");
    const tenant = state.tenant;
    assert.notEqual(tenant, null);
    if (tenant !== null) {
      assert.equal(state.isTrusted, true);
      assert.equal(tenant.organizationId, "org1");
      assert.equal(tenant.slug, "tenant");
      assert.equal(tenant.realmName, "realm1");
      assert.equal(tenant.hostSource, "tenant_slug");
    }
  }

  const customResult = capability.resolveHostIdentity({ host: "shop.example.com" }, registry, config);
  assert.equal(customResult.success, true);
  if (customResult.success) {
    const state = customResult.state;
    assert.equal(state.classification, "possible_custom_domain");
    const tenant = state.tenant;
    assert.notEqual(tenant, null);
    if (tenant !== null) {
      assert.equal(state.isTrusted, true);
      assert.equal(tenant.hostSource, "custom_domain");
      assert.equal(tenant.organizationId, "org2");
    }
  }

  const apexState = capability.resolveHostIdentity({ host: "example.com" }, registry, config);
  assert.equal(apexState.success, true);
  if (apexState.success) {
    const state = apexState.state;
    assert.equal(state.classification, "apex");
    assert.equal(state.tenant, null);
    assert.equal(state.isTrusted, false);
  }

  const reservedState = capability.resolveHostIdentity({ host: "admin.example.com" }, registry, config);
  assert.equal(reservedState.success, true);
  if (reservedState.success) {
    const state = reservedState.state;
    assert.equal(state.classification, "reserved_subdomain");
    assert.equal(state.tenant, null);
    assert.equal(state.isTrusted, false);
  }

  const invalidState = capability.resolveHostIdentity(
    { host: "deep.nested.example.com" },
    registry,
    config,
  );
  assert.equal(invalidState.success, true);
  if (invalidState.success) {
    const state = invalidState.state;
    assert.equal(state.classification, "invalid_subdomain");
    assert.equal(state.tenant, null);
    assert.equal(state.isTrusted, false);
  }

  const malformedState = capability.resolveHostIdentity({ host: "invalid..host" }, registry, config);
  assert.equal(malformedState.success, true);
  if (malformedState.success) {
    const state = malformedState.state;
    assert.equal(state.classification, "malformed");
    assert.equal(state.tenant, null);
    assert.equal(state.isTrusted, false);
  }

  const unknownCustomState = capability.resolveHostIdentity(
    { host: "mystery.example.org" },
    registry,
    config,
  );
  assert.equal(unknownCustomState.success, true);
  if (unknownCustomState.success) {
    const state = unknownCustomState.state;
    assert.equal(state.classification, "possible_custom_domain");
    assert.equal(state.tenant, null);
    assert.equal(state.isTrusted, false);
  }

  const initial = capability.createInitialState();
  assert.equal(initial.classification, "malformed");
  assert.equal(initial.tenant, null);
  assert.equal(initial.isTrusted, false);
  assert.equal(initial.lifecycleStage, "classify");
  assert.equal(initial.proofStatus, "PENDING");

  const kinds: readonly capability.TenantHostClassificationKind[] =
    capability.TenantHostClassificationKind;
  assert.deepEqual(
    [...kinds],
    ["apex", "tenant_slug", "reserved_subdomain", "invalid_subdomain", "possible_custom_domain", "malformed"],
  );
});

test("tenanthostidentityresolutionvalidation", () => {
  const registry = capability.createInMemoryDomainRegistry(
    [
      {
        organizationId: "org1",
        slug: "tenant",
        realmName: "realm1",
        active: true,
      },
    ],
    [
      {
        domain: "shop.example.com",
        organizationId: "org2",
        slug: "shop",
        realmName: "realm2",
        status: "active",
      },
    ],
    true,
  );

  assert.equal(capability.stripPort("Example.COM:8080"), "example.com");
  assert.equal(capability.stripPort("tenant.example.com"), "tenant.example.com");
  assert.equal(capability.stripPort("[2001:db8::1]:443"), "[2001:db8::1]");
  assert.equal(capability.stripPort("  Mixed.Case.Example.COM  "), "mixed.case.example.com");

  assert.equal(capability.classifyHost("example.com:8443", "example.com"), "apex");
  assert.equal(capability.classifyHost("admin.example.com", "example.com"), "reserved_subdomain");
  assert.equal(capability.classifyHost("deep.nested.example.com", "example.com"), "invalid_subdomain");
  assert.equal(capability.classifyHost("invalid..host", "example.com"), "malformed");
  assert.equal(capability.classifyHost("tenant.example.com", "example.com"), "tenant_slug");
  assert.equal(capability.classifyHost("unknown.example.com", "example.com"), "possible_custom_domain");
  assert.equal(capability.classifyHost("", "example.com"), "malformed");
  assert.equal(capability.classifyHost("bad_underscore.example.com", "example.com"), "malformed");
  assert.equal(capability.classifyHost("-leading.example.com", "example.com"), "malformed");
  assert.equal(capability.classifyHost("trailing-.example.com", "example.com"), "malformed");

  assert.equal(capability.isValidHostSyntax("tenant.example.com"), true);
  assert.equal(capability.isValidHostSyntax("invalid..host"), false);
  assert.equal(capability.isValidHostSyntax(""), false);
  assert.equal(capability.isValidSubdomainSlug("tenant"), true);
  assert.equal(capability.isValidSubdomainSlug("-bad"), false);
  assert.equal(capability.isValidSubdomainSlug("bad-"), false);

  const config: capability.ResolverConfiguration = {
    apexDomain: "example.com",
    trustForwardedHost: true,
    reservedSubdomains: ["admin", "api"],
  };

  const forwardedResult = capability.resolveHostIdentity(
    { host: "ignored.com", forwardedHost: "tenant.example.com" },
    registry,
    config,
  );
  assert.equal(forwardedResult.success, true);
  if (forwardedResult.success) {
    assert.equal(forwardedResult.classification, "tenant_slug");
    assert.notEqual(forwardedResult.tenant, null);
  }

  const headerResult = capability.resolveHostIdentity(
    {
      host: "ignored.com",
      headers: { "x-forwarded-host": "shop.example.com" },
    },
    registry,
    config,
  );
  assert.equal(headerResult.success, true);
  if (headerResult.success) {
    assert.equal(headerResult.classification, "possible_custom_domain");
    assert.notEqual(headerResult.tenant, null);
  }

  const noTrustResult = capability.resolveHostIdentity(
    { host: "ignored.com", forwardedHost: "tenant.example.com" },
    registry,
    { apexDomain: "example.com", trustForwardedHost: false },
  );
  assert.equal(noTrustResult.success, true);
  if (noTrustResult.success) {
    assert.equal(noTrustResult.classification, "possible_custom_domain");
    assert.equal(noTrustResult.tenant, null);
  }

  const customResult = capability.resolveHostIdentity(
    { host: "shop.example.com:8443" },
    registry,
    config,
  );
  assert.equal(customResult.success, true);
  if (customResult.success) {
    assert.equal(customResult.classification, "possible_custom_domain");
    assert.notEqual(customResult.tenant, null);
    assert.equal(customResult.state.sanitizedHost, "shop.example.com");
  }

  const reservedCustomResult = capability.resolveHostIdentity(
    { host: "admin.example.com" },
    registry,
    config,
  );
  assert.equal(reservedCustomResult.success, true);
  if (reservedCustomResult.success) {
    assert.equal(reservedCustomResult.classification, "reserved_subdomain");
    assert.equal(reservedCustomResult.tenant, null);
  }

  const unknownCustomResult = capability.resolveHostIdentity(
    { host: "mystery.example.org" },
    registry,
    config,
  );
  assert.equal(unknownCustomResult.success, true);
  if (unknownCustomResult.success) {
    assert.equal(unknownCustomResult.classification, "possible_custom_domain");
    assert.equal(unknownCustomResult.tenant, null);
    assert.ok(unknownCustomResult.warnings.some((w) => w.kind === "UNKNOWN_CUSTOM_DOMAIN"));
  }

  const unknownSlugResult = capability.resolveHostIdentity(
    { host: "ghost.example.com" },
    registry,
    config,
  );
  assert.equal(unknownSlugResult.success, true);
  if (unknownSlugResult.success) {
    assert.equal(unknownSlugResult.classification, "tenant_slug");
    assert.equal(unknownSlugResult.tenant, null);
    assert.ok(unknownSlugResult.warnings.some((w) => w.kind === "UNKNOWN_SLUG"));
  }
});