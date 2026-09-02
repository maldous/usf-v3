import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/tenantidentityrecordandfqdn.ts";

test("tenantidentityrecordandfqdnauditmodel", () => {
  const operator: capability.OperatorContext = {
    operatorId: "op-1",
    permissions: ["tenant:create"],
  };

  const recordedAudits: capability.TenantIdentityRecordAndFqdnAuditLog[] = [];
  const auditFn = (event: capability.TenantIdentityRecordAndFqdnAuditLog): capability.TenantIdentityRecordAndFqdnError | null => {
    recordedAudits.push(event);
    return null;
  };

  const provResult = capability.provisionTenant(
    capability.initialState,
    operator,
    { organisationId: "org-audit", slug: "audit-tenant" },
    auditFn,
  );

  assert.strictEqual(provResult.success, true);
  assert.strictEqual(recordedAudits.length, 1);
  assert.strictEqual(recordedAudits[0]?.kind, "TENANT_PROVISIONED");
  assert.strictEqual(recordedAudits[0]?.organisationId, "org-audit");
  assert.strictEqual(recordedAudits[0]?.slug, "audit-tenant");
  assert.strictEqual(provResult.state.auditLogs.length, 1);

  const failingAuditFn = (_event: capability.TenantIdentityRecordAndFqdnAuditLog): capability.TenantIdentityRecordAndFqdnError => ({
    kind: "AUDIT_FAILURE",
    message: "Audit sink rejected event",
    statusCode: 403,
  });

  const failResult = capability.provisionTenant(
    capability.initialState,
    operator,
    { organisationId: "org-audit-fail", slug: "audit-fail-tenant" },
    failingAuditFn,
  );

  assert.strictEqual(failResult.success, false);
  assert.strictEqual(failResult.error?.kind, "AUDIT_FAILURE");
  assert.strictEqual(failResult.state.tenants.length, 0);

  const auditCountBeforeResolve = provResult.state.auditLogs.length;
  const resolveResult = capability.resolveHostIdentity(provResult.state, {
    host: "audit-tenant.anqr.internal",
  });
  assert.strictEqual(resolveResult.success, true);
  assert.strictEqual(provResult.state.auditLogs.length, auditCountBeforeResolve);

  const failedResolveResult = capability.resolveHostIdentity(provResult.state, {
    host: "unknown.anqr.internal",
  });
  assert.strictEqual(failedResolveResult.success, false);
  assert.strictEqual(failedResolveResult.tenant, null);
  assert.strictEqual(provResult.state.auditLogs.length, auditCountBeforeResolve);
});

test("tenantidentityrecordandfqdncontracts", () => {
  const operator: capability.OperatorContext = {
    operatorId: "op-contract",
    permissions: ["tenant:create"],
  };

  const provResult = capability.provisionTenant(capability.initialState, operator, {
    organisationId: "org-contract",
    slug: "contract-slug",
  });
  assert.strictEqual(provResult.success, true);

  const hostHeaderResult = capability.resolveHostIdentity(provResult.state, {
    host: "contract-slug.anqr.internal",
  });
  assert.strictEqual(hostHeaderResult.success, true);
  assert.notStrictEqual(hostHeaderResult.tenant, null);
  assert.strictEqual(hostHeaderResult.tenant?.organisationId, "org-contract");
  assert.strictEqual(hostHeaderResult.tenant?.slug, "contract-slug");
  assert.strictEqual(hostHeaderResult.tenant?.matchedFqdn, "contract-slug.anqr.internal");

  const forwardedResult = capability.resolveHostIdentity(provResult.state, {
    "x-forwarded-host": "contract-slug.anqr.internal, edge-proxy.internal",
    host: "untrusted-proxy.internal",
  });
  assert.strictEqual(forwardedResult.success, true);
  assert.notStrictEqual(forwardedResult.tenant, null);
  assert.strictEqual(forwardedResult.tenant?.slug, "contract-slug");

  const noTenantResult = capability.resolveHostIdentity(provResult.state, {
    host: "nonexistent.anqr.internal",
  });
  assert.strictEqual(noTenantResult.success, false);
  assert.strictEqual(noTenantResult.tenant, null);
  assert.strictEqual(noTenantResult.classification, "slug");
});

test("tenantidentityrecordandfqdnerrormodel", () => {
  const operator: capability.OperatorContext = {
    operatorId: "op-err",
    permissions: ["tenant:create"],
  };

  const provResult = capability.provisionTenant(capability.initialState, operator, {
    organisationId: "org-err",
    slug: "err-slug",
  });
  assert.strictEqual(provResult.success, true);

  const stateWithPendingDomain = capability.registerCustomDomain(
    provResult.state,
    operator,
    "org-err",
    "custom.err.com",
    false,
    false,
  );
  assert.strictEqual(stateWithPendingDomain.success, true);

  const apexResult = capability.resolveHostIdentity(stateWithPendingDomain.state, {
    host: "anqr.internal",
  });
  assert.strictEqual(apexResult.success, false);
  assert.strictEqual(apexResult.tenant, null);
  assert.strictEqual(apexResult.classification, "apex");

  const reservedResult = capability.resolveHostIdentity(stateWithPendingDomain.state, {
    host: "admin.anqr.internal",
  });
  assert.strictEqual(reservedResult.success, false);
  assert.strictEqual(reservedResult.tenant, null);
  assert.strictEqual(reservedResult.classification, "reserved");

  const malformedResult = capability.resolveHostIdentity(stateWithPendingDomain.state, {
    host: "..invalid..",
  });
  assert.strictEqual(malformedResult.success, false);
  assert.strictEqual(malformedResult.tenant, null);
  assert.strictEqual(malformedResult.classification, "malformed");

  const unknownResult = capability.resolveHostIdentity(stateWithPendingDomain.state, {
    host: "unregistered-unknown-host",
  });
  assert.strictEqual(unknownResult.success, false);
  assert.strictEqual(unknownResult.tenant, null);
  assert.strictEqual(unknownResult.classification, "unknown");

  const pendingDomainResult = capability.resolveHostIdentity(stateWithPendingDomain.state, {
    host: "custom.err.com",
  });
  assert.strictEqual(pendingDomainResult.success, false);
  assert.strictEqual(pendingDomainResult.tenant, null);

  const degradedResolverState: capability.TenantIdentityRecordAndFqdnState = {
    ...stateWithPendingDomain.state,
    resolverAvailable: false,
  };
  const degradedResolverResult = capability.resolveHostIdentity(degradedResolverState, {
    host: "err-slug.anqr.internal",
  });
  assert.strictEqual(degradedResolverResult.success, false);
  assert.strictEqual(degradedResolverResult.tenant, null);
  assert.strictEqual(degradedResolverResult.error?.kind, "DEGRADED_PROVIDER");
  assert.strictEqual(degradedResolverResult.error?.statusCode, 503);

  const degradedRegistryState: capability.TenantIdentityRecordAndFqdnState = {
    ...stateWithPendingDomain.state,
    domainRegistryAvailable: false,
  };
  const degradedRegistryResult = capability.resolveHostIdentity(degradedRegistryState, {
    host: "custom.err.com",
  });
  assert.strictEqual(degradedRegistryResult.success, false);
  assert.strictEqual(degradedRegistryResult.tenant, null);
  assert.strictEqual(degradedRegistryResult.error?.kind, "DEGRADED_PROVIDER");
});

test("tenantidentityrecordandfqdnlifecycle", () => {
  const operator: capability.OperatorContext = {
    operatorId: "op-life",
    permissions: ["tenant:create"],
  };

  const prov = capability.provisionTenant(capability.initialState, operator, {
    organisationId: "org-life-1",
    slug: "tenant-life",
  });
  assert.strictEqual(prov.success, true);
  assert.notStrictEqual(prov.tenant, null);
  assert.strictEqual(prov.tenant?.realm, "tenant-org-life-1");

  const slugResolve = capability.resolveHostIdentity(prov.state, {
    host: "tenant-life.anqr.internal",
  });
  assert.strictEqual(slugResolve.success, true);
  assert.strictEqual(slugResolve.tenant?.hostSource, "slug");
  assert.strictEqual(slugResolve.tenant?.slug, "tenant-life");

  const regDomain = capability.registerCustomDomain(
    prov.state,
    operator,
    "org-life-1",
    "app.customer.com",
    true,
    true,
  );
  assert.strictEqual(regDomain.success, true);

  const customResolve = capability.resolveHostIdentity(regDomain.state, {
    host: "app.customer.com",
  });
  assert.strictEqual(customResolve.success, true);
  assert.strictEqual(customResolve.tenant?.hostSource, "custom_domain");
  assert.strictEqual(customResolve.tenant?.organisationId, "org-life-1");

  const apexResolve = capability.resolveHostIdentity(regDomain.state, { host: "anqr.internal" });
  assert.strictEqual(apexResolve.tenant, null);

  const reservedResolve = capability.resolveHostIdentity(regDomain.state, { host: "api.anqr.internal" });
  assert.strictEqual(reservedResolve.tenant, null);

  const malformedResolve = capability.resolveHostIdentity(regDomain.state, { host: ".malformed.anqr.internal" });
  assert.strictEqual(malformedResolve.tenant, null);
});

test("tenantidentityrecordandfqdnpermissions", () => {
  const unauthorizedOperator: capability.OperatorContext = {
    operatorId: "op-unauth",
    permissions: [],
  };

  const deniedProv = capability.provisionTenant(capability.initialState, unauthorizedOperator, {
    organisationId: "org-perm",
    slug: "perm-tenant",
  });
  assert.strictEqual(deniedProv.success, false);
  assert.strictEqual(deniedProv.error?.kind, "PERMISSION_DENIED");
  assert.strictEqual(deniedProv.error?.statusCode, 403);
  assert.strictEqual(deniedProv.tenant, null);

  const deniedDomain = capability.registerCustomDomain(
    capability.initialState,
    unauthorizedOperator,
    "org-perm",
    "domain.com",
  );
  assert.strictEqual(deniedDomain.success, false);
  assert.strictEqual(deniedDomain.error?.kind, "PERMISSION_DENIED");

  const authorizedOperator: capability.OperatorContext = {
    operatorId: "op-auth",
    permissions: ["tenant:create"],
  };
  const allowedProv = capability.provisionTenant(capability.initialState, authorizedOperator, {
    organisationId: "org-perm",
    slug: "perm-tenant",
  });
  assert.strictEqual(allowedProv.success, true);
  assert.notStrictEqual(allowedProv.tenant, null);

  const unresolvable = capability.resolveHostIdentity(allowedProv.state, {
    host: "unmatched-tenant.anqr.internal",
  });
  assert.strictEqual(unresolvable.success, false);
  assert.strictEqual(unresolvable.tenant, null);
});

test("tenantidentityrecordandfqdnproof", () => {
  const matrixProof = capability.runDomainIdentityMatrixProof(capability.initialState);
  assert.strictEqual(matrixProof.proofName, "DomainIdentityMatrixProof");
  assert.strictEqual(matrixProof.status, "PASSED");
  assert.strictEqual(matrixProof.lineage, "hermes.runtime.identityaccess.domain_identity_matrix_proof.v1");
  assert.strictEqual(matrixProof.casesTested, 8);

  const emptyStateProof = capability.runCustomDomainResolutionProof(capability.initialState);
  assert.strictEqual(emptyStateProof.proofName, "CustomDomainResolutionProof");
  assert.strictEqual(emptyStateProof.status, "SKIPPED");
  assert.strictEqual(emptyStateProof.lineage, "hermes.runtime.identityaccess.custom_domain_resolution_proof.v1");

  const operator: capability.OperatorContext = {
    operatorId: "op-proof",
    permissions: ["tenant:create"],
  };
  const seededState = capability.provisionTenant(capability.initialState, operator, {
    organisationId: "org-proof-seed",
    slug: "proof-seed",
  });
  assert.strictEqual(seededState.success, true);

  const liveProof = capability.runCustomDomainResolutionProof(seededState.state);
  assert.strictEqual(liveProof.proofName, "CustomDomainResolutionProof");
  assert.strictEqual(liveProof.status, "PASSED");
  assert.strictEqual(liveProof.lineage, "hermes.runtime.identityaccess.custom_domain_resolution_proof.v1");
});

test("tenantidentityrecordandfqdnreadinessmodel", () => {
  assert.strictEqual(capability.getReadiness(capability.initialState), "READY");

  const degradedState: capability.TenantIdentityRecordAndFqdnState = {
    ...capability.initialState,
    domainRegistryAvailable: false,
  };
  assert.strictEqual(capability.getReadiness(degradedState), "DEGRADED");

  const notReadyState: capability.TenantIdentityRecordAndFqdnState = {
    ...capability.initialState,
    resolverAvailable: false,
  };
  assert.strictEqual(capability.getReadiness(notReadyState), "NOT_READY");

  const operator: capability.OperatorContext = {
    operatorId: "op-ready",
    permissions: ["tenant:create"],
  };

  const regAttempt = capability.registerCustomDomain(
    degradedState,
    operator,
    "org-test",
    "custom.domain.com",
  );
  assert.strictEqual(regAttempt.success, false);
  assert.strictEqual(regAttempt.error?.kind, "DEGRADED_PROVIDER");
  assert.strictEqual(regAttempt.error?.statusCode, 503);

  const updateAttempt = capability.updateCustomDomainStatus(
    degradedState,
    operator,
    "custom.domain.com",
    "ACTIVE",
  );
  assert.strictEqual(updateAttempt.success, false);
  assert.strictEqual(updateAttempt.error?.kind, "DEGRADED_PROVIDER");

  const emptyProof = capability.runCustomDomainResolutionProof(capability.initialState);
  assert.strictEqual(emptyProof.status, "SKIPPED");
});

test("tenantidentityrecordandfqdnstatemodel", () => {
  assert.strictEqual(capability.deriveRealm("12345"), "tenant-12345");

  const operator: capability.OperatorContext = {
    operatorId: "op-state",
    permissions: ["tenant:create"],
  };

  const prov = capability.provisionTenant(capability.initialState, operator, {
    organisationId: "state-org",
    slug: "state-slug",
    hostSource: "slug",
  });
  assert.strictEqual(prov.success, true);
  assert.strictEqual(prov.tenant?.realm, "tenant-state-org");
  assert.strictEqual(prov.tenant?.hostSource, "slug");

  const regDomain = capability.registerCustomDomain(
    prov.state,
    operator,
    "state-org",
    "mycustom.example.org",
    false,
    false,
  );
  assert.strictEqual(regDomain.success, true);
  assert.strictEqual(regDomain.state.domainRegistry[0]?.status, "PENDING");

  const unverifiedResolve = capability.resolveHostIdentity(regDomain.state, {
    host: "mycustom.example.org",
  });
  assert.strictEqual(unverifiedResolve.success, false);
  assert.strictEqual(unverifiedResolve.tenant, null);

  const updatedDomain = capability.updateCustomDomainStatus(
    regDomain.state,
    operator,
    "mycustom.example.org",
    "ACTIVE",
  );
  assert.strictEqual(updatedDomain.success, true);
  assert.strictEqual(updatedDomain.state.domainRegistry[0]?.status, "ACTIVE");
  assert.strictEqual(updatedDomain.state.domainRegistry[0]?.verified, true);
  assert.strictEqual(updatedDomain.state.domainRegistry[0]?.active, true);

  const verifiedResolve = capability.resolveHostIdentity(updatedDomain.state, {
    host: "mycustom.example.org",
  });
  assert.strictEqual(verifiedResolve.success, true);
  assert.strictEqual(verifiedResolve.tenant?.organisationId, "state-org");
  assert.strictEqual(verifiedResolve.tenant?.realm, "tenant-state-org");
  assert.strictEqual(verifiedResolve.tenant?.hostSource, "custom_domain");

  const fixtureTenant: capability.TenantRecord = {
    organisationId: "fixture-org",
    slug: "localdev",
    realm: capability.deriveRealm("fixture-org"),
    hostSource: "fixture",
    createdAt: new Date().toISOString(),
  };
  const fixtureState: capability.TenantIdentityRecordAndFqdnState = {
    ...updatedDomain.state,
    fixtureTenants: [fixtureTenant],
  };

  const fixtureResolve = capability.resolveHostIdentity(fixtureState, {
    host: "localdev.localhost",
  });
  assert.strictEqual(fixtureResolve.success, true);
  assert.strictEqual(fixtureResolve.tenant?.hostSource, "fixture");
  assert.strictEqual(fixtureResolve.tenant?.organisationId, "fixture-org");
});

test("tenantidentityrecordandfqdnvalidation", () => {
  assert.strictEqual(capability.classifyHost("anqr.internal", "anqr.internal"), "apex");
  assert.strictEqual(capability.classifyHost("alpha.anqr.internal", "anqr.internal"), "slug");
  assert.strictEqual(capability.classifyHost("alpha.localhost", "anqr.internal"), "local_slug");
  assert.strictEqual(capability.classifyHost("admin.anqr.internal", "anqr.internal"), "reserved");
  assert.strictEqual(capability.classifyHost("alpha.anqr.internal:8080", "anqr.internal"), "host_with_port");
  assert.strictEqual(capability.classifyHost("tenant.acme.com", "anqr.internal"), "possible_custom_domain");
  assert.strictEqual(capability.classifyHost("plainhost", "anqr.internal"), "unknown");
  assert.strictEqual(capability.classifyHost("..bad..host..", "anqr.internal"), "malformed");

  const headerFwd = capability.extractHostFromHeaders({
    "x-forwarded-host": "forwarded.anqr.internal, direct.anqr.internal",
    host: "direct.anqr.internal",
  });
  assert.strictEqual(headerFwd, "forwarded.anqr.internal");

  const headerDirect = capability.extractHostFromHeaders({
    host: "direct.anqr.internal",
  });
  assert.strictEqual(headerDirect, "direct.anqr.internal");

  const operator: capability.OperatorContext = {
    operatorId: "op-val",
    permissions: ["tenant:create"],
  };

  const prov = capability.provisionTenant(capability.initialState, operator, {
    organisationId: "val-org",
    slug: "val-slug",
  });
  assert.strictEqual(prov.success, true);

  const inactiveDomainState = capability.registerCustomDomain(
    prov.state,
    operator,
    "val-org",
    "inactive.domain.com",
    true,
    false,
  );
  assert.strictEqual(inactiveDomainState.success, true);
  assert.strictEqual(inactiveDomainState.state.domainRegistry[0]?.status, "INACTIVE");

  const inactiveResolve = capability.resolveHostIdentity(inactiveDomainState.state, {
    host: "inactive.domain.com",
  });
  assert.strictEqual(inactiveResolve.success, false);
  assert.strictEqual(inactiveResolve.tenant, null);

  const activeDomainState = capability.updateCustomDomainStatus(
    inactiveDomainState.state,
    operator,
    "inactive.domain.com",
    "ACTIVE",
  );
  assert.strictEqual(activeDomainState.success, true);

  const activeResolve = capability.resolveHostIdentity(activeDomainState.state, {
    host: "inactive.domain.com",
  });
  assert.strictEqual(activeResolve.success, true);
  assert.strictEqual(activeResolve.tenant?.organisationId, "val-org");
});