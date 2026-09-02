import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/configuration/customdomainsdnsownershiptlscanonical.ts";

type AuditFn = capability.CustomDomainDnsOwnershipTlsCanonicalAuditFn;
type State = capability.CustomDomainDnsOwnershipTlsCanonicalState;
type ErrorResult = capability.CustomDomainDnsOwnershipTlsCanonicalError;
type DomainRecord = capability.CustomDomainDnsOwnershipTlsCanonicalDomainRecord;
type Readiness = capability.CustomDomainDnsOwnershipTlsCanonicalReadiness;
type Outcome = capability.CustomDomainDnsOwnershipTlsCanonicalOutcome;
type AuthClientPort = capability.CustomDomainDnsOwnershipTlsCanonicalAuthClientPort;
type DnsPort = capability.CustomDomainDnsOwnershipTlsCanonicalDnsChallengePort;
type ProbePort = capability.CustomDomainDnsOwnershipTlsCanonicalRoutingProbePort;
type TenantDomainPort = capability.CustomDomainDnsOwnershipTlsCanonicalTenantDomainPort;

const noopAudit: AuditFn = () => null;

function grantedState(state: State, tenant: string): State {
  let next = capability.grantTenantPermission(state, tenant, "DOMAIN_READ" as const);
  next = capability.grantTenantPermission(next, tenant, "DOMAIN_WRITE" as const);
  return next;
}

function isErrorResult(value: unknown): value is ErrorResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.outcome === "string" && typeof v.message === "string";
}

function expectState(value: State | ErrorResult): State {
  assert.ok(
    !isErrorResult(value),
    `expected state but received error: ${JSON.stringify(value)}`,
  );
  return value as State;
}

function expectError(value: unknown, expectedOutcome: Outcome): ErrorResult {
  assert.ok(
    isErrorResult(value),
    `expected error outcome ${expectedOutcome} but received: ${JSON.stringify(value)}`,
  );
  assert.strictEqual((value as ErrorResult).outcome, expectedOutcome);
  return value as ErrorResult;
}

function getDomainRecord(state: State, domain: string, tenant: string): DomainRecord {
  const record = state.domains.find(
    (item) => item.domain === domain && item.tenant === tenant,
  );
  assert.ok(record !== undefined, `expected domain record ${domain}/${tenant}`);
  return record as DomainRecord;
}

function getChallengeToken(record: DomainRecord): string {
  assert.ok(record.challengeTokens.length > 0, "expected at least one challenge token");
  const first = record.challengeTokens[0];
  assert.ok(first !== undefined);
  return first.token;
}

function createAuthClientPort(
  config: { activate?: boolean; deactivate?: boolean } = {},
): AuthClientPort {
  return {
    activate: (_domain: string, _tenant: string) => config.activate ?? true,
    deactivate: (_domain: string, _tenant: string) => config.deactivate ?? true,
  };
}

function createDnsPort(values: readonly string[]): DnsPort {
  return { lookupTxt: (_domain: string) => values };
}

function createProbePort(success: boolean): ProbePort {
  return { probe: (_domain: string, _tenant: string) => success };
}

test("customdomainsdnsownershiptlscanonicalauditmodel", () => {
  const auditEvents: capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent[] = [];
  const captureAudit: AuditFn = (event) => {
    auditEvents.push(event);
    return null;
  };

  const tenantA = "tenant-audit";
  const tenantB = "tenant-b";
  const domain = "audit.example.com";
  let state: State = grantedState(capability.initialState, tenantA);
  state = grantedState(state, tenantB);

  state = expectState(
    capability.createOwnershipChallenge(state, domain, tenantA, captureAudit),
  );
  assert.strictEqual(auditEvents.length, 1);
  const createdEvent = auditEvents[0] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(createdEvent.kind, "CHALLENGE_CREATED");
  assert.strictEqual(createdEvent.domain, domain);
  assert.strictEqual(createdEvent.tenant, tenantA);
  assert.strictEqual("token" in createdEvent.metadata, false);
  assert.strictEqual(JSON.stringify(createdEvent).includes("token"), false);

  const crossTenantError = expectError(
    capability.createOwnershipChallenge(state, domain, tenantB, captureAudit),
    "DOMAIN_ALREADY_CLAIMED",
  );
  assert.strictEqual("token" in crossTenantError, false);
  assert.strictEqual(JSON.stringify(crossTenantError).includes("token"), false);
  assert.strictEqual(auditEvents.length, 2);
  const conflictEvent = auditEvents[1] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(conflictEvent.kind, "CONFLICT_REJECTED");
  assert.strictEqual("token" in conflictEvent.metadata, false);
  assert.strictEqual(JSON.stringify(conflictEvent).includes("token"), false);

  const pendingRecord = getDomainRecord(state, domain, tenantA);
  state = expectState(
    capability.verifyDnsOwnership(
      state,
      domain,
      tenantA,
      getChallengeToken(pendingRecord),
      captureAudit,
    ),
  );
  assert.strictEqual(auditEvents.length, 3);
  const verifyEvent = auditEvents[2] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(verifyEvent.kind, "VERIFICATION");

  const authPort = createAuthClientPort();
  state = expectState(
    capability.activateAuthClient(state, domain, tenantA, authPort, captureAudit),
  );
  assert.strictEqual(auditEvents.length, 4);
  const activatedEvent = auditEvents[3] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(activatedEvent.kind, "AUTH_CLIENT_ACTIVATED");

  state = expectState(
    capability.deactivateAuthClient(state, domain, tenantA, authPort, captureAudit),
  );
  assert.strictEqual(auditEvents.length, 5);
  const deactivatedEvent = auditEvents[4] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(deactivatedEvent.kind, "AUTH_CLIENT_DEACTIVATED");

  state = expectState(
    capability.activateAuthClient(state, domain, tenantA, authPort, captureAudit),
  );
  assert.strictEqual(auditEvents.length, 6);

  state = expectState(
    capability.proveLocalRouting(state, domain, tenantA, captureAudit),
  );
  assert.strictEqual(auditEvents.length, 7);
  const routingEvent = auditEvents[6] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(routingEvent.kind, "LOCAL_ROUTING_PROOF");

  state = expectState(capability.setCanonical(state, domain, tenantA, captureAudit));
  assert.strictEqual(auditEvents.length, 8);
  const canonicalEvent = auditEvents[7] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(canonicalEvent.kind, "CANONICAL_SET");

  state = expectState(capability.unsetCanonical(state, domain, tenantA, captureAudit));
  assert.strictEqual(auditEvents.length, 9);
  const unsetEvent = auditEvents[8] as capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent;
  assert.strictEqual(unsetEvent.kind, "CANONICAL_UNSET");

  for (const event of auditEvents) {
    assert.strictEqual("token" in event.metadata, false);
    assert.strictEqual("challengeTokens" in event, false);
    assert.strictEqual(JSON.stringify(event).includes("token"), false);
  }
});

test("customdomainsdnsownershiptlscanonicalcontracts", () => {
  const port: TenantDomainPort = capability.buildTenantDomainPort();
  const requiredMethods: Array<keyof TenantDomainPort> = [
    "createChallenge",
    "verifyDns",
    "verifyDnsWithLookup",
    "activateAuthClient",
    "deactivateAuthClient",
    "proveLocalRouting",
    "proveLocalRoutingWithProbe",
    "setCanonical",
    "unsetCanonical",
    "disableDomain",
    "deactivateDomain",
    "listDomains",
    "getReadiness",
  ];
  for (const method of requiredMethods) {
    assert.strictEqual(typeof port[method], "function");
  }

  const tenant = "tenant-contract";
  const domain = "contracts.example.com";
  let state: State = grantedState(capability.initialState, tenant);
  state = expectState(port.createChallenge(state, domain, tenant, noopAudit));
  state = expectState(
    port.verifyDns(
      state,
      domain,
      tenant,
      getChallengeToken(getDomainRecord(state, domain, tenant)),
      noopAudit,
    ),
  );

  const authPort = createAuthClientPort();
  state = expectState(
    port.activateAuthClient(state, domain, tenant, authPort, noopAudit),
  );
  state = expectState(port.proveLocalRouting(state, domain, tenant, noopAudit));
  state = expectState(port.setCanonical(state, domain, tenant, noopAudit));
  state = expectState(port.unsetCanonical(state, domain, tenant, noopAudit));
  state = expectState(
    port.deactivateAuthClient(state, domain, tenant, authPort, noopAudit),
  );
  state = expectState(
    port.deactivateDomain(state, domain, tenant, authPort, noopAudit),
  );
  state = expectState(port.disableDomain(state, domain, tenant, noopAudit));

  const listed = port.listDomains(state, tenant, noopAudit);
  assert.ok(Array.isArray(listed));

  const readiness = port.getReadiness(state, tenant, noopAudit);
  assert.ok(
    !isErrorResult(readiness),
    `expected readiness but got error: ${JSON.stringify(readiness)}`,
  );
  const allowedReadiness: readonly Readiness[] = capability.CustomDomainDnsOwnershipTlsCanonicalReadiness;
  assert.ok(
    (allowedReadiness as readonly string[]).includes(readiness as string),
    `readiness ${String(readiness)} not exported`,
  );
});

test("customdomainsdnsownershiptlscanonicalerrormodel", () => {
  const tenant = "tenant-error";
  const domain = "error.example.com";

  const invalidError = expectError(
    capability.createOwnershipChallenge(
      capability.initialState,
      "not a domain",
      tenant,
      noopAudit,
    ),
    "INVALID_DOMAIN",
  );
  assert.strictEqual(invalidError.outcome, "INVALID_DOMAIN");
  assert.strictEqual("token" in invalidError, false);
  assert.strictEqual(JSON.stringify(invalidError).includes("token"), false);

  const notFoundError = expectError(
    capability.verifyDnsOwnership(
      grantedState(capability.initialState, tenant),
      "absent.example.com",
      tenant,
      "any-token",
      noopAudit,
    ),
    "NOT_FOUND",
  );
  assert.strictEqual(JSON.stringify(notFoundError).includes("token"), false);

  let pendingState = grantedState(capability.initialState, tenant);
  pendingState = expectState(
    capability.createOwnershipChallenge(pendingState, domain, tenant, noopAudit),
  );
  const token = getChallengeToken(getDomainRecord(pendingState, domain, tenant));

  const mismatchError = expectError(
    capability.verifyDnsOwnership(pendingState, domain, tenant, "wrong-token", noopAudit),
    "DNS_MISMATCH",
  );
  assert.strictEqual("token" in mismatchError, false);

  const emptyMismatchError = expectError(
    capability.verifyDnsOwnership(pendingState, domain, tenant, "", noopAudit),
    "DNS_MISMATCH",
  );
  assert.strictEqual("token" in emptyMismatchError, false);

  const wrongTxtPort: DnsPort = createDnsPort(["wrong-txt"]);
  expectError(
    capability.verifyDnsOwnershipWithLookup(
      pendingState,
      domain,
      tenant,
      wrongTxtPort,
      noopAudit,
    ),
    "DNS_MISMATCH",
  );

  const verifiedState = expectState(
    capability.verifyDnsOwnership(pendingState, domain, tenant, token, noopAudit),
  );
  expectError(
    capability.verifyDnsOwnership(verifiedState, domain, tenant, token, noopAudit),
    "ALREADY_VERIFIED",
  );

  const failingAuth: AuthClientPort = createAuthClientPort({ activate: false });
  expectError(
    capability.activateAuthClient(verifiedState, domain, tenant, failingAuth, noopAudit),
    "AUTH_CLIENT_INACTIVE",
  );

  const successAuth: AuthClientPort = createAuthClientPort();
  const activeState = expectState(
    capability.activateAuthClient(verifiedState, domain, tenant, successAuth, noopAudit),
  );

  expectError(
    capability.setCanonical(activeState, domain, tenant, noopAudit),
    "ROUTING_NOT_PROVEN",
  );
  expectError(
    capability.deactivateAuthClient(verifiedState, domain, tenant, successAuth, noopAudit),
    "NOT_ACTIVE",
  );

  const stateWithOther = grantedState(activeState, "tenant-other");
  expectError(
    capability.createOwnershipChallenge(
      stateWithOther,
      domain,
      "tenant-other",
      noopAudit,
    ),
    "DOMAIN_ALREADY_CLAIMED",
  );

  const outcomes = capability.CustomDomainDnsOwnershipTlsCanonicalOutcome;
  assert.ok(outcomes.includes("SUCCESS"));
  const requiredOutcomes: Outcome[] = [
    "INVALID_DOMAIN",
    "DOMAIN_ALREADY_CLAIMED",
    "NOT_FOUND",
    "EXPIRED",
    "ALREADY_VERIFIED",
    "DNS_NOT_FOUND",
    "DNS_MISMATCH",
    "NOT_VERIFIED",
    "AUTH_CLIENT_INACTIVE",
    "ROUTING_NOT_PROVEN",
    "NOT_ACTIVE",
  ];
  for (const required of requiredOutcomes) {
    assert.ok(outcomes.includes(required), `outcome ${required} should be exported`);
  }
});

test("customdomainsdnsownershiptlscanonicallifecycle", () => {
  const tenant = "tenant-lifecycle";
  const domain = "lifecycle.example.com";
  let state: State = grantedState(capability.initialState, tenant);

  state = expectState(
    capability.createOwnershipChallenge(state, domain, tenant, noopAudit),
  );
  const pendingRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(pendingRecord.ownershipStatus, "PENDING_DNS");
  assert.strictEqual(pendingRecord.authClientStatus, "INACTIVE");
  assert.strictEqual(pendingRecord.routingStatus, "UNKNOWN");

  state = expectState(
    capability.verifyDnsOwnership(
      state,
      domain,
      tenant,
      getChallengeToken(pendingRecord),
      noopAudit,
    ),
  );
  const verifiedRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(verifiedRecord.ownershipStatus, "VERIFIED");
  assert.notStrictEqual(verifiedRecord.verifiedAt, null);

  const auth = createAuthClientPort();
  state = expectState(
    capability.activateAuthClient(state, domain, tenant, auth, noopAudit),
  );
  const activeRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(activeRecord.authClientStatus, "ACTIVE");
  assert.notStrictEqual(activeRecord.activatedAt, null);

  state = expectState(capability.proveLocalRouting(state, domain, tenant, noopAudit));
  const routedRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(routedRecord.routingStatus, "LOCALLY_ACTIVE");
  assert.strictEqual(routedRecord.tlsStatus, "DEFERRED");
  assert.notStrictEqual(routedRecord.routedAt, null);

  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));
  const canonicalRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(canonicalRecord.canonical, true);
  assert.strictEqual(canonicalRecord.redirectPolicy, "REDIRECT_SLUG_TO_CANONICAL");

  state = expectState(capability.unsetCanonical(state, domain, tenant, noopAudit));
  const uncanonicalRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(uncanonicalRecord.canonical, false);
  assert.strictEqual(uncanonicalRecord.redirectPolicy, "NO_REDIRECT");
  assert.strictEqual(uncanonicalRecord.canonicalSetAt, null);

  state = expectState(
    capability.deactivateDomain(state, domain, tenant, auth, noopAudit),
  );
  const deactivatedRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(deactivatedRecord.authClientStatus, "INACTIVE");
  assert.strictEqual(deactivatedRecord.activatedAt, null);
  assert.strictEqual(deactivatedRecord.canonical, false);
  assert.strictEqual(deactivatedRecord.canonicalSetAt, null);
  assert.strictEqual(deactivatedRecord.routingStatus, "UNKNOWN");
  assert.strictEqual(deactivatedRecord.routedAt, null);

  const disabledState = expectState(
    capability.disableDomain(state, domain, tenant, noopAudit),
  );
  const disabledRecord = getDomainRecord(disabledState, domain, tenant);
  assert.strictEqual(disabledRecord.disabled, true);
  assert.strictEqual(disabledRecord.canonical, false);
  assert.strictEqual(disabledRecord.authClientStatus, "INACTIVE");

  const reopenedState = expectState(
    capability.createOwnershipChallenge(disabledState, domain, tenant, noopAudit),
  );
  const liveRecord = reopenedState.domains.find(
    (item) => item.domain === domain && item.tenant === tenant && !item.disabled,
  );
  assert.ok(liveRecord !== undefined);
  assert.strictEqual(liveRecord!.ownershipStatus, "PENDING_DNS");
  assert.strictEqual(reopenedState.domains.length, disabledState.domains.length);
});

test("customdomainsdnsownershiptlscanonicalpermissions", () => {
  const tenant1 = "tenant-perm-1";
  const tenant2 = "tenant-perm-2";
  const domain = "permission.example.com";

  const unpermittedState = capability.initialState;
  const permittedState = grantedState(unpermittedState, tenant1);

  const unpermittedError = expectError(
    capability.createOwnershipChallenge(unpermittedState, domain, tenant1, noopAudit),
    "PERMISSION_DENIED",
  );
  assert.strictEqual(unpermittedError.outcome, "PERMISSION_DENIED");

  const stateA: State = expectState(
    capability.createOwnershipChallenge(
      permittedState,
      domain,
      tenant1,
      noopAudit,
    ),
  );

  const stateWithT2 = grantedState(stateA, tenant2);
  const crossTenantError = expectError(
    capability.createOwnershipChallenge(stateWithT2, domain, tenant2, noopAudit),
    "DOMAIN_ALREADY_CLAIMED",
  );
  assert.strictEqual("token" in crossTenantError, false);
  assert.strictEqual(JSON.stringify(crossTenantError).includes("token"), false);

  const tenant2List = capability.listDomains(stateWithT2, tenant2, noopAudit);
  assert.ok(Array.isArray(tenant2List));
  assert.strictEqual((tenant2List as readonly DomainRecord[]).length, 0);

  expectError(
    capability.verifyDnsOwnership(stateWithT2, domain, tenant2, "any-token", noopAudit),
    "NOT_FOUND",
  );

  const auth = createAuthClientPort();
  expectError(
    capability.activateAuthClient(stateWithT2, domain, tenant2, auth, noopAudit),
    "NOT_FOUND",
  );

  const verifiedState = expectState(
    capability.verifyDnsOwnership(
      stateA,
      domain,
      tenant1,
      getChallengeToken(getDomainRecord(stateA, domain, tenant1)),
      noopAudit,
    ),
  );
  const activatedState = expectState(
    capability.activateAuthClient(verifiedState, domain, tenant1, auth, noopAudit),
  );
  assert.strictEqual(
    getDomainRecord(activatedState, domain, tenant1).authClientStatus,
    "ACTIVE",
  );

  const tenant1List = capability.listDomains(activatedState, tenant1, noopAudit);
  assert.ok(Array.isArray(tenant1List));
  const tenant1Records = tenant1List as readonly DomainRecord[];
  assert.strictEqual(tenant1Records.length, 1);
  assert.strictEqual(tenant1Records[0]?.tenant, tenant1);

  // The facet scopes every domain operation through read/write permissions, so
  // a tenant without DOMAIN_READ is denied fail-closed (asserted below for the
  // unprivileged tenant), and isolation is proven on a *granted* tenant: with
  // DOMAIN_READ it lists successfully and still sees none of tenant1's domains.
  const tenant2Granted = grantedState(activatedState, tenant2);
  const tenant2List2 = capability.listDomains(tenant2Granted, tenant2, noopAudit);
  assert.ok(Array.isArray(tenant2List2));
  assert.strictEqual((tenant2List2 as readonly DomainRecord[]).length, 0);

  const unprivilegedTenant = "tenant-perm-none";
  const permissionDenied = expectError(
    capability.createOwnershipChallenge(activatedState, domain, unprivilegedTenant, noopAudit),
    "PERMISSION_DENIED",
  );
  assert.strictEqual(permissionDenied.outcome, "PERMISSION_DENIED");

  const readPermissionDenied = expectError(
    capability.listDomains(activatedState, unprivilegedTenant, noopAudit),
    "PERMISSION_DENIED",
  );
  assert.strictEqual(readPermissionDenied.outcome, "PERMISSION_DENIED");
});

test("customdomainsdnsownershiptlscanonicalproof", () => {
  const tenant = "tenant-proof";
  const otherTenant = "tenant-other";
  const domain = "proof.example.com";
  const secondary = "proof-two.example.com";

  const auth = createAuthClientPort();
  const probe = createProbePort(true);

  let state: State = grantedState(capability.initialState, tenant);
  state = grantedState(state, otherTenant);

  state = expectState(
    capability.createOwnershipChallenge(state, domain, tenant, noopAudit),
  );
  const primaryToken = getChallengeToken(getDomainRecord(state, domain, tenant));
  state = expectState(
    capability.verifyDnsOwnership(state, domain, tenant, primaryToken, noopAudit),
  );
  state = expectState(
    capability.activateAuthClient(state, domain, tenant, auth, noopAudit),
  );
  state = expectState(
    capability.proveLocalRoutingWithProbe(state, domain, tenant, probe, noopAudit),
  );
  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));

  const resolved = capability.resolveCustomDomain(state, domain, tenant, noopAudit);
  assert.ok(!isErrorResult(resolved));
  const resolvedRecord = resolved as DomainRecord;
  assert.strictEqual(resolvedRecord.canonical, true);

  const authOrigin = capability.resolveCustomDomainAuthOrigin(
    state,
    domain,
    tenant,
    noopAudit,
  );
  assert.ok(!isErrorResult(authOrigin));
  assert.strictEqual((authOrigin as DomainRecord).authClientStatus, "ACTIVE");

  const crossLookup = capability.resolveCustomDomain(
    state,
    domain,
    otherTenant,
    noopAudit,
  );
  assert.ok(isErrorResult(crossLookup));

  state = expectState(
    capability.createOwnershipChallenge(state, secondary, tenant, noopAudit),
  );
  const secondaryRecord = getDomainRecord(state, secondary, tenant);
  state = expectState(
    capability.verifyDnsOwnership(
      state,
      secondary,
      tenant,
      getChallengeToken(secondaryRecord),
      noopAudit,
    ),
  );
  const secondaryReadiness = capability.getDomainReadiness(state, secondary, tenant, noopAudit);
  assert.ok(!isErrorResult(secondaryReadiness));
  assert.strictEqual(secondaryReadiness as Readiness, "INACTIVE_AUTH_CLIENT");

  const unresolved = capability.resolveCustomDomain(state, secondary, tenant, noopAudit);
  assert.ok(isErrorResult(unresolved));
  assert.strictEqual((unresolved as ErrorResult).outcome, "ROUTING_NOT_PROVEN");

  const disabledState = expectState(
    capability.disableDomain(state, domain, tenant, noopAudit),
  );
  const disabledLookup = capability.resolveCustomDomain(
    disabledState,
    domain,
    tenant,
    noopAudit,
  );
  assert.ok(isErrorResult(disabledLookup));

  const activatedSecondary = expectState(
    capability.activateAuthClient(state, secondary, tenant, auth, noopAudit),
  );
  const probedSecondary = expectState(
    capability.proveLocalRoutingWithProbe(
      activatedSecondary,
      secondary,
      tenant,
      probe,
      noopAudit,
    ),
  );
  const secondaryResolved = capability.resolveCustomDomain(
    probedSecondary,
    secondary,
    tenant,
    noopAudit,
  );
  assert.ok(!isErrorResult(secondaryResolved));
  assert.strictEqual(
    (secondaryResolved as DomainRecord).routingStatus,
    "LOCALLY_ACTIVE",
  );
});

test("customdomainsdnsownershiptlscanonicalreadinessmodel", () => {
  const tenant = "tenant-ready";
  const domain = "readiness.example.com";

  const readinessValues = capability.CustomDomainDnsOwnershipTlsCanonicalReadiness;
  const expected: Readiness[] = [
    "NO_DOMAINS",
    "PENDING_DNS",
    "VERIFIED",
    "INACTIVE_AUTH_CLIENT",
    "LOCALLY_ROUTED",
    "DEFERRED_PUBLIC_DNS_TLS",
    "CANONICAL_REDIRECT_CUTOVER",
  ];
  for (const value of expected) {
    assert.ok(readinessValues.includes(value));
  }

  let state: State = grantedState(capability.initialState, tenant);
  assert.strictEqual(capability.getReadiness(state, tenant, noopAudit), "NO_DOMAINS");

  state = expectState(
    capability.createOwnershipChallenge(state, domain, tenant, noopAudit),
  );
  assert.strictEqual(capability.getReadiness(state, tenant, noopAudit), "PENDING_DNS");

  state = expectState(
    capability.verifyDnsOwnership(
      state,
      domain,
      tenant,
      getChallengeToken(getDomainRecord(state, domain, tenant)),
      noopAudit,
    ),
  );
  assert.strictEqual(
    capability.getReadiness(state, tenant, noopAudit),
    "INACTIVE_AUTH_CLIENT",
  );

  const authPort = createAuthClientPort();
  state = expectState(
    capability.activateAuthClient(state, domain, tenant, authPort, noopAudit),
  );
  assert.strictEqual(
    capability.getReadiness(state, tenant, noopAudit),
    "LOCALLY_ROUTED",
  );

  state = expectState(capability.proveLocalRouting(state, domain, tenant, noopAudit));
  assert.strictEqual(
    capability.getReadiness(state, tenant, noopAudit),
    "LOCALLY_ROUTED",
  );
  assert.strictEqual(state.publicDnsVerified, false);
  assert.strictEqual(state.tlsProvisioned, false);

  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));
  assert.strictEqual(
    capability.getReadiness(state, tenant, noopAudit),
    "CANONICAL_REDIRECT_CUTOVER",
  );

  const domainReadiness = capability.getDomainReadiness(state, domain, tenant, noopAudit);
  assert.ok(!isErrorResult(domainReadiness));
  assert.strictEqual(domainReadiness as Readiness, "CANONICAL_REDIRECT_CUTOVER");

  const disabledState = expectState(
    capability.disableDomain(state, domain, tenant, noopAudit),
  );
  assert.strictEqual(
    capability.getReadiness(disabledState, tenant, noopAudit),
    "DEFERRED_PUBLIC_DNS_TLS",
  );

  const localOnlyTenant = "tenant-ready-local-only";
  const localOnlyDomain = "local-only.example.com";
  let localOnlyState: State = grantedState(capability.initialState, localOnlyTenant);
  localOnlyState = expectState(
    capability.createOwnershipChallenge(
      localOnlyState,
      localOnlyDomain,
      localOnlyTenant,
      noopAudit,
    ),
  );
  localOnlyState = expectState(
    capability.verifyDnsOwnership(
      localOnlyState,
      localOnlyDomain,
      localOnlyTenant,
      getChallengeToken(getDomainRecord(localOnlyState, localOnlyDomain, localOnlyTenant)),
      noopAudit,
    ),
  );
  localOnlyState = expectState(
    capability.activateAuthClient(
      localOnlyState,
      localOnlyDomain,
      localOnlyTenant,
      authPort,
      noopAudit,
    ),
  );
  localOnlyState = expectState(
    capability.proveLocalRouting(localOnlyState, localOnlyDomain, localOnlyTenant, noopAudit),
  );
  assert.strictEqual(
    capability.getReadiness(localOnlyState, localOnlyTenant, noopAudit),
    "LOCALLY_ROUTED",
  );
  assert.strictEqual(localOnlyState.publicDnsVerified, false);
  assert.strictEqual(localOnlyState.tlsProvisioned, false);
  assert.strictEqual(
    getDomainRecord(localOnlyState, localOnlyDomain, localOnlyTenant).tlsStatus,
    "DEFERRED",
  );
});

test("customdomainsdnsownershiptlscanonicalstatemodel", () => {
  const tenant = "tenant-state";
  const domain = "state.example.com";
  let state: State = grantedState(capability.initialState, tenant);

  state = expectState(
    capability.createOwnershipChallenge(state, domain, tenant, noopAudit),
  );
  const pendingRecord = getDomainRecord(state, domain, tenant);

  assert.strictEqual(pendingRecord.ownershipStatus, "PENDING_DNS");
  assert.strictEqual(pendingRecord.authClientStatus, "INACTIVE");
  assert.strictEqual(pendingRecord.routingStatus, "UNKNOWN");
  assert.strictEqual(pendingRecord.tlsStatus, "UNKNOWN");
  assert.strictEqual(pendingRecord.canonical, false);
  assert.strictEqual(pendingRecord.redirectPolicy, "NO_REDIRECT");
  assert.strictEqual(pendingRecord.disabled, false);
  assert.strictEqual(pendingRecord.challengeTokens.length, 1);
  assert.notStrictEqual(pendingRecord.challengeTokens[0], undefined);
  assert.strictEqual(typeof pendingRecord.challengeTokens[0]?.createdAt, "string");
  assert.strictEqual(typeof pendingRecord.challengeTokens[0]?.expiresAt, "string");
  assert.strictEqual(pendingRecord.verifiedAt, null);
  assert.strictEqual(pendingRecord.activatedAt, null);
  assert.strictEqual(pendingRecord.routedAt, null);
  assert.strictEqual(pendingRecord.canonicalSetAt, null);
  assert.strictEqual(state.publicDnsVerified, false);
  assert.strictEqual(state.tlsProvisioned, false);

  const wrongLookupPort: DnsPort = createDnsPort(["wrong-token"]);
  expectError(
    capability.verifyDnsOwnershipWithLookup(
      state,
      domain,
      tenant,
      wrongLookupPort,
      noopAudit,
    ),
    "DNS_MISMATCH",
  );

  state = expectState(
    capability.verifyDnsOwnership(
      state,
      domain,
      tenant,
      getChallengeToken(pendingRecord),
      noopAudit,
    ),
  );
  const verifiedRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(verifiedRecord.ownershipStatus, "VERIFIED");
  assert.notStrictEqual(verifiedRecord.verifiedAt, null);

  const auth = createAuthClientPort();
  state = expectState(
    capability.activateAuthClient(state, domain, tenant, auth, noopAudit),
  );
  const activeRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(activeRecord.authClientStatus, "ACTIVE");
  assert.notStrictEqual(activeRecord.activatedAt, null);

  state = expectState(capability.proveLocalRouting(state, domain, tenant, noopAudit));
  const routedRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(routedRecord.routingStatus, "LOCALLY_ACTIVE");
  assert.strictEqual(routedRecord.tlsStatus, "DEFERRED");
  assert.notStrictEqual(routedRecord.routedAt, null);

  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));
  const canonicalRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(canonicalRecord.canonical, true);
  assert.strictEqual(canonicalRecord.redirectPolicy, "REDIRECT_SLUG_TO_CANONICAL");
  assert.notStrictEqual(canonicalRecord.canonicalSetAt, null);

  state = expectState(capability.unsetCanonical(state, domain, tenant, noopAudit));
  const uncanonicalRecord = getDomainRecord(state, domain, tenant);
  assert.strictEqual(uncanonicalRecord.canonical, false);
  assert.strictEqual(uncanonicalRecord.redirectPolicy, "NO_REDIRECT");
  assert.strictEqual(uncanonicalRecord.canonicalSetAt, null);

  assert.deepStrictEqual(
    [...capability.CustomDomainDnsOwnershipTlsCanonicalOwnershipStatus].sort(),
    ["DNS_MISMATCH", "PENDING_DNS", "VERIFIED"],
  );
  assert.deepStrictEqual(
    [...capability.CustomDomainDnsOwnershipTlsCanonicalAuthClientStatus].sort(),
    ["ACTIVE", "INACTIVE"],
  );
  assert.deepStrictEqual(
    [...capability.CustomDomainDnsOwnershipTlsCanonicalRoutingStatus].sort(),
    ["LOCALLY_ACTIVE", "UNKNOWN"],
  );
  assert.deepStrictEqual(
    [...capability.CustomDomainDnsOwnershipTlsCanonicalTlsStatus].sort(),
    ["DEFERRED", "UNKNOWN"],
  );
  assert.deepStrictEqual(
    [...capability.CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy].sort(),
    ["NO_REDIRECT", "REDIRECT_SLUG_TO_CANONICAL"],
  );
});

test("customdomainsdnsownershiptlscanonicalvalidation", () => {
  const tenant = "tenant-validate";
  const validDomain = "validation.example.com";
  const invalidDomains: readonly string[] = [
    "invalid..domain",
    "192.168.1.1",
    ".validation.com",
    "validation.com.",
    "-validation.com",
    "validation-.com",
    "not a domain",
  ];

  for (const invalid of invalidDomains) {
    const err = expectError(
      capability.createOwnershipChallenge(
        capability.initialState,
        invalid,
        tenant,
        noopAudit,
      ),
      "INVALID_DOMAIN",
    );
    assert.strictEqual(err.outcome, "INVALID_DOMAIN");
  }

  let state: State = grantedState(capability.initialState, tenant);
  state = expectState(
    capability.createOwnershipChallenge(state, validDomain, tenant, noopAudit),
  );
  const pendingRecord = getDomainRecord(state, validDomain, tenant);

  const wrongTokenError = expectError(
    capability.verifyDnsOwnership(
      state,
      validDomain,
      tenant,
      "wrong-token",
      noopAudit,
    ),
    "DNS_MISMATCH",
  );
  assert.strictEqual("token" in wrongTokenError, false);

  expectError(
    capability.verifyDnsOwnership(state, validDomain, tenant, "", noopAudit),
    "DNS_MISMATCH",
  );

  expectError(
    capability.setCanonical(state, validDomain, tenant, noopAudit),
    "NOT_VERIFIED",
  );

  const stateWithOther = grantedState(state, "tenant-cross");
  const crossTenantError = expectError(
    capability.createOwnershipChallenge(
      stateWithOther,
      validDomain,
      "tenant-cross",
      noopAudit,
    ),
    "DOMAIN_ALREADY_CLAIMED",
  );
  assert.strictEqual("token" in crossTenantError, false);

  state = expectState(
    capability.verifyDnsOwnership(
      state,
      validDomain,
      tenant,
      getChallengeToken(pendingRecord),
      noopAudit,
    ),
  );

  expectError(
    capability.setCanonical(state, validDomain, tenant, noopAudit),
    "AUTH_CLIENT_INACTIVE",
  );

  const auth = createAuthClientPort();
  state = expectState(
    capability.activateAuthClient(state, validDomain, tenant, auth, noopAudit),
  );

  expectError(
    capability.setCanonical(state, validDomain, tenant, noopAudit),
    "ROUTING_NOT_PROVEN",
  );

  state = expectState(
    capability.proveLocalRouting(state, validDomain, tenant, noopAudit),
  );

  const canonicalState = expectState(
    capability.setCanonical(state, validDomain, tenant, noopAudit),
  );
  assert.strictEqual(
    getDomainRecord(canonicalState, validDomain, tenant).canonical,
    true,
  );

  expectError(
    capability.setCanonical(canonicalState, validDomain, tenant, noopAudit),
    "NOT_ACTIVE",
  );
});