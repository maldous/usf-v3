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

  const verifyResult = capability.verifyDnsOwnership(
    result,
    domain,
    tenant,
    result.domains[0].challengeTokens[0].token,
    auditFn
  );
  assert.ok(!("kind" in verifyResult));
  assert.strictEqual(auditEvents.length, 3);
  assert.strictEqual(auditEvents[2].kind, "VERIFICATION");

  const authClientPort = { activate: () => true, deactivate: () => true };
  const activateResult = capability.activateAuthClient(
    verifyResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in activateResult));
  assert.strictEqual(auditEvents.length, 4);
  assert.strictEqual(auditEvents[3].kind, "AUTH_CLIENT_ACTIVATED");

  const deactivateResult = capability.deactivateAuthClient(
    activateResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in deactivateResult));
  assert.strictEqual(auditEvents.length, 5);
  assert.strictEqual(auditEvents[4].kind, "AUTH_CLIENT_DEACTIVATED");

  const proveResult = capability.proveLocalRouting(
    activateResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in proveResult));
  assert.strictEqual(auditEvents.length, 6);
  assert.strictEqual(auditEvents[5].kind, "LOCAL_ROUTING_PROOF");

  const setCanonicalResult = capability.setCanonical(
    proveResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in setCanonicalResult));
  assert.strictEqual(auditEvents.length, 7);
  assert.strictEqual(auditEvents[6].kind, "CANONICAL_SET");

  const unsetCanonicalResult = capability.unsetCanonical(
    setCanonicalResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in unsetCanonicalResult));
  assert.strictEqual(auditEvents.length, 8);
  assert.strictEqual(auditEvents[7].kind, "CANONICAL_UNSET");
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

  const proveResult = capability.proveLocalRouting(
    activateResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in proveResult));

  const setCanonicalResult = capability.setCanonical(
    proveResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in setCanonicalResult));

  const unsetCanonicalResult = capability.unsetCanonical(
    setCanonicalResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in unsetCanonicalResult));

  const listResult = capability.listDomains(activateResult, tenant);
  assert.strictEqual(listResult.length, 1);

  const readinessResult = capability.getReadiness(activateResult, tenant);
  assert.ok(capability.CustomDomainDnsOwnershipTlsCanonicalReadiness.includes(readinessResult as capability.CustomDomainDnsOwnershipTlsCanonicalReadiness));

  const domainReadinessResult = capability.getDomainReadiness(activateResult, domain, tenant);
  assert.ok(
    typeof domainReadinessResult === "string" ||
    ("kind" in domainReadinessResult && capability.CustomDomainDnsOwnershipTlsCanonicalOutcome.includes(domainReadinessResult.kind as capability.CustomDomainDnsOwnershipTlsCanonicalOutcome))
  );
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

  const authClientPort = { activate: () => false, deactivate: () => false };
  const notVerifiedResult = capability.activateAuthClient(
    challengeResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok("kind" in notVerifiedResult);
  assert.strictEqual(notVerifiedResult.kind, "NOT_VERIFIED");

  const routingNotProvenResult = capability.setCanonical(
    alreadyVerifiedResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok("kind" in routingNotProvenResult);
  assert.strictEqual(routingNotProvenResult.kind, "ROUTING_NOT_PROVEN");

  const notActiveResult = capability.deactivateAuthClient(
    alreadyVerifiedResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok("kind" in notActiveResult);
  assert.strictEqual(notActiveResult.kind, "NOT_ACTIVE");
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

  const proveResult = capability.proveLocalRouting(
    activateResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in proveResult));
  assert.strictEqual(proveResult.domains[0].routingStatus, "LOCALLY_ACTIVE");

  const setCanonicalResult = capability.setCanonical(
    proveResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in setCanonicalResult));
  assert.strictEqual(setCanonicalResult.domains[0].canonical, true);

  const unsetCanonicalResult = capability.unsetCanonical(
    setCanonicalResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in unsetCanonicalResult));
  assert.strictEqual(unsetCanonicalResult.domains[0].canonical, false);

  const deactivateResult = capability.deactivateAuthClient(
    activateResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in deactivateResult));
  assert.strictEqual(deactivateResult.domains[0].authClientStatus, "INACTIVE");
  assert.strictEqual(deactivateResult.domains[0].canonical, false);
  assert.strictEqual(deactivateResult.domains[0].routingStatus, "UNKNOWN");

  const disableResult = capability.disableDomain(
    activateResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in disableResult));
  assert.strictEqual(disableResult.domains[0].disabled, true);
  assert.strictEqual(disableResult.domains[0].authClientStatus, "INACTIVE");
  assert.strictEqual(disableResult.domains[0].canonical, false);
  assert.strictEqual(disableResult.domains[0].routingStatus, "UNKNOWN");
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

  const authClientPort = { activate: () => true, deactivate: () => true };
  const activateResult = capability.activateAuthClient(
    challengeResult,
    domain,
    tenant2,
    authClientPort,
    auditFn
  );
  assert.ok("kind" in activateResult);
  assert.strictEqual(activateResult.kind, "NOT_VERIFIED");
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

  const authClientPort = { activate: () => true, deactivate: () => true };
  const activateResult = capability.activateAuthClient(
    verifyResult,
    domain,
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in activateResult));

  const proveResult = capability.proveLocalRouting(
    activateResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in proveResult));

  const setCanonicalResult = capability.setCanonical(
    proveResult,
    domain,
    tenant,
    auditFn
  );
  assert.ok(!("kind" in setCanonicalResult));
  assert.strictEqual(setCanonicalResult.domains[0].canonical, true);
});

test("customdomainsdnsownershiptlscanonicalreadinessmodel", () => {
  const auditFn = (): capability.CustomDomainDnsOwnershipTlsCanonicalError | null => null;
  const state = capability.initialState;
  const tenant = "tenant1";

  const noDomainsReadiness = capability.getReadiness(state, tenant);
  assert.strictEqual(noDomainsReadiness, "NO_DOMAINS");

  const challengeResult = capability.createOwnershipChallenge(state, "example.com", tenant, auditFn);
  assert.ok(!("kind" in challengeResult));
  const pendingDnsReadiness = capability.getReadiness(challengeResult, tenant);
  assert.strictEqual(pendingDnsReadiness, "PENDING_DNS");

  const verifyResult = capability.verifyDnsOwnership(
    challengeResult,
    "example.com",
    tenant,
    challengeResult.domains[0].challengeTokens[0].token,
    auditFn
  );
  assert.ok(!("kind" in verifyResult));
  const verifiedReadiness = capability.getReadiness(verifyResult, tenant);
  assert.strictEqual(verifiedReadiness, "VERIFIED");

  const authClientPort = { activate: () => true, deactivate: () => true };
  const activateResult = capability.activateAuthClient(
    verifyResult,
    "example.com",
    tenant,
    authClientPort,
    auditFn
  );
  assert.ok(!("kind" in activateResult));
  const inactiveAuthClientReadiness = capability.getReadiness(activateResult, tenant);
  assert.strictEqual(inactiveAuthClientReadiness, "INACTIVE_AUTH_CLIENT");

  const proveResult = capability.proveLocalRouting(
    activateResult,
    "example.com",
    tenant,
    auditFn
  );
  assert.ok(!("kind" in proveResult));
  const locallyRoutedReadiness = capability.getReadiness(proveResult, tenant);
  assert.strictEqual(locallyRoutedReadiness, "LOCALLY_ROUTED");

  const setCanonicalResult = capability.setCanonical(
    proveResult,
    "example.com",
    tenant,
    auditFn
  );
  assert.ok(!("kind" in setCanonicalResult));
  const canonicalRedirectCutoverReadiness = capability.getReadiness(setCanonicalResult, tenant);
  assert.strictEqual(canonicalRedirectCutoverReadiness, "CANONICAL_REDIRECT_CUTOVER");

  const domainReadiness = capability.getDomainReadiness(
    setCanonicalResult,
    "example.com",
    tenant
  );
  assert.strictEqual(domainReadiness, "CANONICAL_REDIRECT_CUTOVER");
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

  const authClientPort = { activate: () => true, deactivate: () => true };
  const routingNotProvenResult = capability.setCanonical(
    challengeResult,
    validDomain,
    tenant,
    auditFn
  );
  assert.ok("kind" in routingNotProvenResult);
  assert.strictEqual(routingNotProvenResult.kind, "ROUTING_NOT_PROVEN");
});