import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/configuration/customdomainsdnsownershiptlscanonical.ts";

test("customdomainsdnsownershiptlscanonicalauditmodel", () => {
  const auditEvents: capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent[] = [];
  const auditFn = (event: capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => {
    auditEvents.push(event);
    return null;
  };

  const state = capability.initialState;
  const domain = "example.com";
  const tenant = "tenant1";
  const result = capability.createOwnershipChallenge(state, domain, tenant, auditFn);
  assert.ok(!("kind" in result));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "CHALLENGE_CREATED");
  assert.strictEqual(auditEvents[0].domain, domain);
  assert.strictEqual(auditEvents[0].tenant, tenant);
  assert.ok(!("token" in auditEvents[0]));

  const conflictResult = capability.createOwnershipChallenge(
    result,
    domain,
    "tenant2",
    auditFn
  );
  assert.ok("kind" in conflictResult);
  assert.strictEqual(conflictResult.kind, "DOMAIN_ALREADY_CLAIMED");
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[1].kind, "CONFLICT_REJECTED");
  assert.ok(!("token" in auditEvents[1]));
});

test("customdomainsdnsownershiptlscanonicalcontracts", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;
  const domain = "example.com";
  const tenant = "tenant1";

  const challengeResult = capability.createOwnershipChallenge(state, domain, tenant, auditFn);
  assert.ok(!("kind" in challengeResult));
  assert.strictEqual(challengeResult.domains.length, 1);

  const verifyResult = capability.verifyDnsOwnership(
    challengeResult,
    domain,
    tenant,
    challengeResult.domains[0].challengeTokens[0].token,
    auditFn
  );
  assert.ok(!("kind" in verifyResult));

  const authClientPort = {
    activate: () => true,
    deactivate: () => true,
  };
  const activateResult = capability.activateAuthClient(
    verifyResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in activateResult));

  const deactivateResult = capability.deactivateAuthClient(
    activateResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in deactivateResult));
});

test("customdomainsdnsownershiptlscanonicalerrormodel", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;

  const invalidDomainResult = capability.createOwnershipChallenge(
    state,
    "invalid..domain",
    "tenant1",
    auditFn
  );
  assert.ok("kind" in invalidDomainResult);
  assert.strictEqual(invalidDomainResult.kind, "INVALID_DOMAIN");

  const notFoundResult = capability.verifyDnsOwnership(
    state,
    "nonexistent.com",
    "tenant1",
    "token",
    auditFn
  );
  assert.ok("kind" in notFoundResult);
  assert.strictEqual(notFoundResult.kind, "NOT_FOUND");

  const domain = "example.com";
  const tenant = "tenant1";
  const challengeResult = capability.createOwnershipChallenge(state, domain, tenant, auditFn);
  assert.ok(!("kind" in challengeResult));

  const mismatchResult = capability.verifyDnsOwnership(
    challengeResult,
    domain,
    tenant,
    "wrong-token",
    auditFn
  );
  assert.ok("kind" in mismatchResult);
  assert.strictEqual(mismatchResult.kind, "DNS_MISMATCH");

  const alreadyVerifiedResult = capability.verifyDnsOwnership(
    challengeResult,
    domain,
    tenant,
    challengeResult.domains[0].challengeTokens[0].token,
    auditFn
  );
  assert.ok(!("kind" in alreadyVerifiedResult));

  const doubleVerifyResult = capability.verifyDnsOwnership(
    alreadyVerifiedResult,
    domain,
    tenant,
    alreadyVerifiedResult.domains[0].challengeTokens[0].token,
    auditFn
  );
  assert.ok("kind" in doubleVerifyResult);
  assert.strictEqual(doubleVerifyResult.kind, "ALREADY_VERIFIED");
});

test("customdomainsdnsownershiptlscanonicallifecycle", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;
  const domain = "example.com";
  const tenant = "tenant1";

  const challengeResult = capability.createOwnershipChallenge(state, domain, tenant, auditFn);
  assert.ok(!("kind" in challengeResult));
  assert.strictEqual(challengeResult.domains[0].ownershipStatus, "PENDING_DNS");

  const verifyResult = capability.verifyDnsOwnership(
    challengeResult,
    domain,
    tenant,
    challengeResult.domains[0].challengeTokens[0].token,
    auditFn
  );
  assert.ok(!("kind" in verifyResult));
  assert.strictEqual(verifyResult.domains[0].ownershipStatus, "VERIFIED");

  const authClientPort = { activate: () => true, deactivate: () => true };
  const activateResult = capability.activateAuthClient(
    verifyResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in activateResult));
  assert.strictEqual(activateResult.domains[0].authClientStatus, "ACTIVE");
});

test("customdomainsdnsownershiptlscanonicalpermissions", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;
  const domain = "example.com";
  const tenant1 = "tenant1";
  const tenant2 = "tenant2";

  const challengeResult = capability.createOwnershipChallenge(state, domain, tenant1, auditFn);
  assert.ok(!("kind" in challengeResult));

  const conflictResult = capability.createOwnershipChallenge(
    challengeResult,
    domain,
    tenant2,
    auditFn
  );
  assert.ok("kind" in conflictResult);
  assert.strictEqual(conflictResult.kind, "DOMAIN_ALREADY_CLAIMED");

  const notFoundResult = capability.verifyDnsOwnership(
    challengeResult,
    domain,
    tenant2,
    "token",
    auditFn
  );
  assert.ok("kind" in notFoundResult);
  assert.strictEqual(notFoundResult.kind, "NOT_FOUND");
});

test("customdomainsdnsownershiptlscanonicalproof", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;
  const domain = "example.com";
  const tenant = "tenant1";

  const challengeResult = capability.createOwnershipChallenge(state, domain, tenant, auditFn);
  assert.ok(!("kind" in challengeResult));
  assert.strictEqual(challengeResult.domains[0].ownershipStatus, "PENDING_DNS");

  const verifyResult = capability.verifyDnsOwnership(
    challengeResult,
    domain,
    tenant,
    challengeResult.domains[0].challengeTokens[0].token,
    auditFn
  );
  assert.ok(!("kind" in verifyResult));
  assert.strictEqual(verifyResult.domains[0].ownershipStatus, "VERIFIED");
});

test("customdomainsdnsownershiptlscanonicalreadinessmodel", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;

  assert.strictEqual(
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes("NO_DOMAINS" as const),
    true
  );
  assert.strictEqual(
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes("PENDING_DNS" as const),
    true
  );
  assert.strictEqual(
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes("VERIFIED" as const),
    true
  );
  assert.strictEqual(
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes("INACTIVE_AUTH_CLIENT" as const),
    true
  );
  assert.strictEqual(
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes("LOCALLY_ROUTED" as const),
    true
  );
  assert.strictEqual(
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes("DEFERRED_PUBLIC_DNS_TLS" as const),
    true
  );
  assert.strictEqual(
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes("CANONICAL_REDIRECT_CUTOVER" as const),
    true
  );
});

test("customdomainsdnsownershiptlscanonicalstatemodel", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;
  const domain = "example.com";
  const tenant = "tenant1";

  const challengeResult = capability.createOwnershipChallenge(state, domain, tenant, auditFn);
  assert.ok(!("kind" in challengeResult));
  const record = challengeResult.domains[0];
  assert.strictEqual(record.ownershipStatus, "PENDING_DNS");
  assert.strictEqual(record.authClientStatus, "INACTIVE");
  assert.strictEqual(record.routingStatus, "UNKNOWN");
  assert.strictEqual(record.tlsStatus, "UNKNOWN");
  assert.strictEqual(record.canonical, false);
  assert.strictEqual(record.redirectPolicy, "NO_REDIRECT");
  assert.strictEqual(record.disabled, false);
  assert.strictEqual(record.challengeTokens.length, 1);
  assert.ok(record.createdAt);
  assert.strictEqual(record.verifiedAt, null);
  assert.strictEqual(record.activatedAt, null);
  assert.strictEqual(record.routedAt, null);
  assert.strictEqual(record.canonicalSetAt, null);
});

test("customdomainsdnsownershiptlscanonicalvalidation", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;

  const invalidDomainResult = capability.createOwnershipChallenge(
    state,
    "invalid..domain",
    "tenant1",
    auditFn
  );
  assert.ok("kind" in invalidDomainResult);
  assert.strictEqual(invalidDomainResult.kind, "INVALID_DOMAIN");

  const validDomain = "example.com";
  const tenant = "tenant1";
  const challengeResult = capability.createOwnershipChallenge(state, validDomain, tenant, auditFn);
  assert.ok(!("kind" in challengeResult));

  const mismatchResult = capability.verifyDnsOwnership(
    challengeResult,
    validDomain,
    tenant,
    "wrong-token",
    auditFn
  );
  assert.ok("kind" in mismatchResult);
  assert.strictEqual(mismatchResult.kind, "DNS_MISMATCH");

  const crossTenantResult = capability.createOwnershipChallenge(
    challengeResult,
    validDomain,
    "tenant2",
    auditFn
  );
  assert.ok("kind" in crossTenantResult);
  assert.strictEqual(crossTenantResult.kind, "DOMAIN_ALREADY_CLAIMED");
});