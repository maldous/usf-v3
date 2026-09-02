import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/configuration/customdomainsdnsownershiptlscanonical.ts";

type AuditFn = (event: capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => null;
type State = capability.CustomDomainDnsOwnershipTlsCanonicalState;
type ErrorResult = capability.CustomDomainDnsOwnershipTlsCanonicalError;
type DomainRecord = capability.CustomDomainDnsOwnershipTlsCanonicalDomainRecord;
type Readiness = capability.CustomDomainDnsOwnershipTlsCanonicalReadiness;
type AuditEventKind = capability.CustomDomainDnsOwnershipTlsCanonicalAuditEventKind;
type Outcome = capability.CustomDomainDnsOwnershipTlsCanonicalOutcome;
type OwnershipStatus = capability.CustomDomainDnsOwnershipTlsCanonicalOwnershipStatus;

const noopAudit: AuditFn = () => null;

function isErrorResult(value: unknown): value is ErrorResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "outcome" in value &&
    typeof (value as { outcome?: unknown }).outcome === "string" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function expectState(value: State | ErrorResult): State {
  assert.ok(
    !isErrorResult(value),
    `expected state but received error: ${JSON.stringify(value)}`,
  );
  return value as State;
}

function expectError(
  value: State | ErrorResult | DomainRecord,
  outcome: Outcome,
): ErrorResult {
  assert.ok(
    isErrorResult(value),
    `expected error outcome ${outcome} but received: ${JSON.stringify(value)}`,
  );
  assert.strictEqual(value.outcome, outcome);
  assert.strictEqual(typeof value.message, "string");
  assert.ok(value.message.length > 0);
  return value;
}

function expectDomainRecord(state: State, domain: string, tenant: string): DomainRecord {
  const record = state.domains.find((item) => item.domain === domain && item.tenant === tenant);
  assert.ok(record !== undefined, `expected domain record ${domain}/${tenant}`);
  return record;
}

function expectDomainRecordFromResult(
  value: DomainRecord | ErrorResult,
  domain: string,
  tenant: string,
): DomainRecord {
  assert.ok(
    !isErrorResult(value),
    `expected domain record but got error: ${JSON.stringify(value)}`,
  );
  assert.strictEqual(value.domain, domain);
  assert.strictEqual(value.tenant, tenant);
  return value;
}

function challengeToken(record: DomainRecord): string {
  assert.ok(record.challengeTokens.length > 0, "expected at least one challenge token");
  const t = record.challengeTokens[0]!;
  return t.token;
}

function assertSafeAuditEvent(
  event: capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent,
  kind: AuditEventKind,
  domain: string,
  tenant: string,
): void {
  assert.strictEqual(event.kind, kind);
  assert.strictEqual(event.domain, domain);
  assert.strictEqual(event.tenant, tenant);
  assert.strictEqual(typeof event.timestamp, "string");
  assert.notStrictEqual(event.metadata, null, "metadata must not be null");
  assert.strictEqual(typeof event.metadata, "object");
  assert.strictEqual(event.metadata.domain, domain);
  assert.strictEqual(event.metadata.tenant, tenant);
  assert.strictEqual("token" in event, false);
  assert.strictEqual("challengeTokens" in event, false);
  assert.strictEqual("token" in event.metadata, false);
  assert.strictEqual("challengeTokens" in event.metadata, false);
}

function makeAuthClientPort(
  result: { activate?: boolean; deactivate?: boolean } = {},
): {
  port: capability.CustomDomainDnsOwnershipTlsCanonicalAuthClientPort;
  calls: { activate: number; deactivate: number };
} {
  const calls = { activate: 0, deactivate: 0 };
  const port: capability.CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: (_domain, _tenant) => {
      calls.activate += 1;
      return result.activate ?? true;
    },
    deactivate: (_domain, _tenant) => {
      calls.deactivate += 1;
      return result.deactivate ?? true;
    },
  };
  return { port, calls };
}

function makeProbePort(result: boolean = true): {
  port: capability.CustomDomainDnsOwnershipTlsCanonicalRoutingProbePort;
  calls: { probe: number };
} {
  const calls = { probe: 0 };
  const port: capability.CustomDomainDnsOwnershipTlsCanonicalRoutingProbePort = {
    probe: (_domain, _tenant) => {
      calls.probe += 1;
      return result;
    },
  };
  return { port, calls };
}

function makeDnsPort(txtRecords: readonly string[]): {
  port: capability.CustomDomainDnsOwnershipTlsCanonicalDnsChallengePort;
  calls: { lookupTxt: number };
} {
  const calls = { lookupTxt: 0 };
  const port: capability.CustomDomainDnsOwnershipTlsCanonicalDnsChallengePort = {
    lookupTxt: (_domain) => {
      calls.lookupTxt += 1;
      return [...txtRecords];
    },
  };
  return { port, calls };
}

function replaceDomainRecord(
  state: State,
  domain: string,
  tenant: string,
  patch: Partial<DomainRecord>,
): State {
  return {
    ...state,
    domains: state.domains.map((record) =>
      record.domain === domain && record.tenant === tenant
        ? { ...record, ...patch }
        : record,
    ),
  };
}

test("customdomainsdnsownershiptlscanonicalauditmodel", () => {
  const auditEvents: capability.CustomDomainDnsOwnershipTlsCanonicalAuditEvent[] = [];
  const captureAudit: AuditFn = (event) => {
    auditEvents.push(event);
    return null;
  };

  const tenantA: string = "tenant-a";
  const tenantB: string = "tenant-b";
  const domain: string = "audit.example.com";

  const before: number = capability.initialState.domains.length;

  const state0: State = expectState(
    capability.createOwnershipChallenge(capability.initialState, domain, tenantA, captureAudit),
  );
  assert.strictEqual(state0.domains.length, before + 1);
  const created: DomainRecord = expectDomainRecord(state0, domain, tenantA);
  assert.strictEqual(auditEvents.length, 1);
  assertSafeAuditEvent(auditEvents[0]!, "CHALLENGE_CREATED", domain, tenantA);

  expectError(
    capability.createOwnershipChallenge(state0, domain, tenantB, captureAudit),
    "DOMAIN_ALREADY_CLAIMED",
  );
  assert.strictEqual(auditEvents.length, 2);
  assertSafeAuditEvent(auditEvents[1]!, "CONFLICT_REJECTED", domain, tenantB);

  const state1: State = expectState(
    capability.verifyDnsOwnership(state0, domain, tenantA, challengeToken(created), captureAudit),
  );
  assert.strictEqual(auditEvents.length, 3);
  assertSafeAuditEvent(auditEvents[2]!, "VERIFICATION", domain, tenantA);
  const verified: DomainRecord = expectDomainRecord(state1, domain, tenantA);
  assert.strictEqual(verified.ownershipStatus, "VERIFIED");

  const authA = makeAuthClientPort();
  const state2: State = expectState(
    capability.activateAuthClient(state1, domain, tenantA, authA.port, captureAudit),
  );
  assert.strictEqual(authA.calls.activate, 1);
  assert.strictEqual(auditEvents.length, 4);
  assertSafeAuditEvent(auditEvents[3]!, "AUTH_CLIENT_ACTIVATED", domain, tenantA);

  const state3: State = expectState(
    capability.deactivateAuthClient(state2, domain, tenantA, authA.port, captureAudit),
  );
  assert.strictEqual(authA.calls.deactivate, 1);
  assert.strictEqual(auditEvents.length, 5);
  assertSafeAuditEvent(auditEvents[4]!, "AUTH_CLIENT_DEACTIVATED", domain, tenantA);

  const authB = makeAuthClientPort();
  const state4: State = expectState(
    capability.activateAuthClient(state3, domain, tenantA, authB.port, captureAudit),
  );
  assert.strictEqual(auditEvents.length, 6);
  assertSafeAuditEvent(auditEvents[5]!, "AUTH_CLIENT_ACTIVATED", domain, tenantA);

  const probeA = makeProbePort();
  const state5: State = expectState(
    capability.proveLocalRoutingWithProbe(state4, domain, tenantA, probeA.port, captureAudit),
  );
  assert.strictEqual(auditEvents.length, 7);
  assertSafeAuditEvent(auditEvents[6]!, "LOCAL_ROUTING_PROOF", domain, tenantA);

  const state6: State = expectState(capability.setCanonical(state5, domain, tenantA, captureAudit));
  assert.strictEqual(auditEvents.length, 8);
  assertSafeAuditEvent(auditEvents[7]!, "CANONICAL_SET", domain, tenantA);
  assert.strictEqual(expectDomainRecord(state6, domain, tenantA).canonical, true);

  const state7: State = expectState(capability.unsetCanonical(state6, domain, tenantA, captureAudit));
  assert.strictEqual(auditEvents.length, 9);
  assertSafeAuditEvent(auditEvents[8]!, "CANONICAL_UNSET", domain, tenantA);
  const finalRec: DomainRecord = expectDomainRecord(state7, domain, tenantA);
  assert.strictEqual(finalRec.canonical, false);
  assert.strictEqual(finalRec.routingStatus, "LOCALLY_ACTIVE");
  assert.strictEqual(finalRec.authClientStatus, "ACTIVE");

  for (const ev of auditEvents) {
    assert.strictEqual("token" in ev.metadata, false);
    assert.strictEqual("challengeTokens" in ev.metadata, false);
    const metaJson: string = JSON.stringify(ev.metadata);
    assert.strictEqual(metaJson.includes("token"), false);
    assert.strictEqual(metaJson.includes("challengeTokens"), false);
  }
});

test("customdomainsdnsownershiptlscanonicalcontracts", () => {
  const tenant: string = "tenant-contract";
  const domain: string = "contracts.example.com";
  const lookupDomain: string = "lookup.contracts.example.com";

  const port: capability.CustomDomainDnsOwnershipTlsCanonicalTenantDomainPort =
    capability.buildTenantDomainPort();

  const requiredMethods: ReadonlyArray<keyof capability.CustomDomainDnsOwnershipTlsCanonicalTenantDomainPort> = [
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

  const authPort: capability.CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: () => true,
    deactivate: () => true,
  };

  let state: State = expectState(
    port.createChallenge(capability.initialState, domain, tenant, noopAudit),
  );
  state = expectState(
    port.verifyDns(
      state,
      domain,
      tenant,
      challengeToken(expectDomainRecord(state, domain, tenant)),
      noopAudit,
    ),
  );

  state = expectState(port.createChallenge(state, lookupDomain, tenant, noopAudit));
  const lookupRecord: DomainRecord = expectDomainRecord(state, lookupDomain, tenant);
  const dns = makeDnsPort([lookupRecord.challengeTokens[0]!.token]);
  state = expectState(port.verifyDnsWithLookup(state, lookupDomain, tenant, dns.port, noopAudit));

  state = expectState(port.activateAuthClient(state, lookupDomain, tenant, authPort, noopAudit));
  state = expectState(port.proveLocalRouting(state, lookupDomain, tenant, noopAudit));
  state = expectState(port.setCanonical(state, lookupDomain, tenant, noopAudit));
  state = expectState(port.unsetCanonical(state, lookupDomain, tenant, noopAudit));
  state = expectState(port.deactivateAuthClient(state, lookupDomain, tenant, authPort, noopAudit));
  state = expectState(port.deactivateDomain(state, lookupDomain, tenant, authPort, noopAudit));
  state = expectState(port.disableDomain(state, domain, tenant, noopAudit));

  const listed: readonly DomainRecord[] = port.listDomains(state, tenant);
  assert.strictEqual(listed.length, 2);

  const readiness: Readiness = port.getReadiness(state, tenant);
  assert.ok(
    (capability.CustomDomainDnsOwnershipTlsCanonicalReadiness as readonly string[]).includes(
      readiness,
    ),
  );
});

test("customdomainsdnsownershiptlscanonicalerrormodel", () => {
  const tenant: string = "tenant-error";
  const domain: string = "error.example.com";

  expectError(
    capability.createOwnershipChallenge(capability.initialState, "invalid..domain", tenant, noopAudit),
    "INVALID_DOMAIN",
  );

  expectError(
    capability.verifyDnsOwnership(capability.initialState, "absent.example.com", tenant, "any-token", noopAudit),
    "NOT_FOUND",
  );

  const state0: State = expectState(
    capability.createOwnershipChallenge(capability.initialState, domain, tenant, noopAudit),
  );
  const pending: DomainRecord = expectDomainRecord(state0, domain, tenant);
  const pendingToken = pending.challengeTokens[0]!;

  expectError(
    capability.verifyDnsOwnership(state0, domain, tenant, "wrong-token", noopAudit),
    "DNS_MISMATCH",
  );
  expectError(
    capability.verifyDnsOwnership(state0, domain, tenant, "", noopAudit),
    "DNS_MISMATCH",
  );

  const noTokensState: State = replaceDomainRecord(state0, domain, tenant, { challengeTokens: [] });
  expectError(
    capability.verifyDnsOwnershipWithLookup(
      noTokensState,
      domain,
      tenant,
      { lookupTxt: () => ["token"] },
      noopAudit,
    ),
    "DNS_NOT_FOUND",
  );

  expectError(
    capability.verifyDnsOwnershipWithLookup(
      state0,
      domain,
      tenant,
      { lookupTxt: () => ["wrong-txt"] },
      noopAudit,
    ),
    "DNS_MISMATCH",
  );

  const expiredTokenRecord: State = replaceDomainRecord(state0, domain, tenant, {
    challengeTokens: [
      {
        ...pendingToken,
        createdAt: "1970-01-01T00:00:00.000Z",
        expiresAt: "1970-01-01T00:00:00.000Z",
      },
    ],
  });
  expectError(
    capability.verifyDnsOwnership(expiredTokenRecord, domain, tenant, pendingToken.token, noopAudit),
    "EXPIRED",
  );

  const verified: State = expectState(
    capability.verifyDnsOwnership(state0, domain, tenant, pendingToken.token, noopAudit),
  );
  expectError(
    capability.verifyDnsOwnership(verified, domain, tenant, pendingToken.token, noopAudit),
    "ALREADY_VERIFIED",
  );

  expectError(
    capability.activateAuthClient(
      state0,
      domain,
      tenant,
      { activate: () => true, deactivate: () => true },
      noopAudit,
    ),
    "NOT_VERIFIED",
  );

  const failingActivatePort: capability.CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: () => false,
    deactivate: () => true,
  };
  expectError(
    capability.activateAuthClient(verified, domain, tenant, failingActivatePort, noopAudit),
    "AUTH_CLIENT_INACTIVE",
  );

  const successAuthPort: capability.CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: () => true,
    deactivate: () => true,
  };
  const active: State = expectState(
    capability.activateAuthClient(verified, domain, tenant, successAuthPort, noopAudit),
  );
  expectError(
    capability.setCanonical(active, domain, tenant, noopAudit),
    "ROUTING_NOT_PROVEN",
  );
  expectError(
    capability.deactivateAuthClient(verified, domain, tenant, successAuthPort, noopAudit),
    "NOT_ACTIVE",
  );

  expectError(
    capability.createOwnershipChallenge(verified, domain, "tenant-other", noopAudit),
    "DOMAIN_ALREADY_CLAIMED",
  );

  const outcomeList: readonly string[] = capability.CustomDomainDnsOwnershipTlsCanonicalOutcome;
  assert.strictEqual(outcomeList.includes("SUCCESS"), true);
  for (const requiredOutcome of [
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
  ] as const) {
    assert.strictEqual(
      outcomeList.includes(requiredOutcome),
      true,
      `outcome ${requiredOutcome} should be exported`,
    );
  }

  const sample: ErrorResult = expectError(
    capability.createOwnershipChallenge(
      capability.initialState,
      "bad..name",
      "tenant-outcome",
      noopAudit,
    ),
    "INVALID_DOMAIN",
  );
  assert.strictEqual("token" in sample, false);
  assert.strictEqual("challengeTokens" in sample, false);
  assert.strictEqual(JSON.stringify(sample).includes("token"), false);
});

test("customdomainsdnsownershiptlscanonicallifecycle", () => {
  const tenant: string = "tenant-lifecycle";
  const domain: string = "lifecycle.example.com";

  let state: State = expectState(
    capability.createOwnershipChallenge(capability.initialState, domain, tenant, noopAudit),
  );
  const pending: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(pending.ownershipStatus, "PENDING_DNS");
  assert.strictEqual(pending.authClientStatus, "INACTIVE");
  assert.strictEqual(pending.routingStatus, "UNKNOWN");

  state = expectState(
    capability.verifyDnsOwnership(state, domain, tenant, pending.challengeTokens[0]!.token, noopAudit),
  );
  const verified: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(verified.ownershipStatus, "VERIFIED");
  assert.notStrictEqual(verified.verifiedAt, null);

  const auth = makeAuthClientPort();
  state = expectState(capability.activateAuthClient(state, domain, tenant, auth.port, noopAudit));
  assert.strictEqual(auth.calls.activate, 1);
  const active: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(active.authClientStatus, "ACTIVE");
  assert.notStrictEqual(active.activatedAt, null);

  state = expectState(capability.proveLocalRouting(state, domain, tenant, noopAudit));
  const routed: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(routed.routingStatus, "LOCALLY_ACTIVE");
  assert.strictEqual(routed.tlsStatus, "DEFERRED");
  assert.notStrictEqual(routed.routedAt, null);

  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));
  const canonical: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(canonical.canonical, true);
  assert.strictEqual(canonical.redirectPolicy, "REDIRECT_SLUG_TO_CANONICAL");

  state = expectState(capability.unsetCanonical(state, domain, tenant, noopAudit));
  const uncanonical: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(uncanonical.canonical, false);
  assert.strictEqual(uncanonical.redirectPolicy, "NO_REDIRECT");
  assert.strictEqual(uncanonical.canonicalSetAt, null);

  state = expectState(capability.deactivateDomain(state, domain, tenant, auth.port, noopAudit));
  assert.strictEqual(auth.calls.deactivate, 1);
  const deactivated: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(deactivated.authClientStatus, "INACTIVE");
  assert.strictEqual(deactivated.activatedAt, null);
  assert.strictEqual(deactivated.canonical, false);
  assert.strictEqual(deactivated.canonicalSetAt, null);
  assert.strictEqual(deactivated.routingStatus, "UNKNOWN");
  assert.strictEqual(deactivated.routedAt, null);

  const disabled: State = expectState(capability.disableDomain(state, domain, tenant, noopAudit));
  const disabledRecord: DomainRecord = expectDomainRecord(disabled, domain, tenant);
  assert.strictEqual(disabledRecord.disabled, true);
  assert.strictEqual(disabledRecord.canonical, false);
  assert.strictEqual(disabledRecord.authClientStatus, "INACTIVE");

  const reopened: State = expectState(capability.createOwnershipChallenge(disabled, domain, tenant, noopAudit));
  const newRecord = reopened.domains.find(
    (item) => item.domain === domain && item.tenant === tenant && item.disabled === false,
  );
  assert.ok(newRecord !== undefined);
  assert.strictEqual(newRecord!.ownershipStatus, "PENDING_DNS");
  assert.strictEqual(newRecord!.disabled, false);
  assert.strictEqual(reopened.domains.length, disabled.domains.length + 1);
});

test("customdomainsdnsownershiptlscanonicalpermissions", () => {
  const tenant1: string = "tenant-perm-1";
  const tenant2: string = "tenant-perm-2";
  const domain: string = "permission.example.com";

  const initial: State = capability.initialState;
  assert.strictEqual(capability.hasDomainWritePermission(initial, tenant1, "domain:write"), true);
  assert.strictEqual(capability.hasDomainWritePermission(initial, tenant1, "domain:read"), false);
  assert.strictEqual(capability.hasDomainReadPermission(initial, tenant1, "domain:read"), true);
  assert.strictEqual(capability.hasDomainReadPermission(initial, tenant1, "domain:write"), false);
  assert.strictEqual(capability.hasDomainWritePermission(initial, "", "domain:write"), false);
  assert.strictEqual(capability.hasDomainReadPermission(initial, "", "domain:read"), false);

  const claimed: State = expectState(
    capability.createOwnershipChallenge(initial, domain, tenant1, noopAudit),
  );

  const crossTenant: ErrorResult = expectError(
    capability.createOwnershipChallenge(claimed, domain, tenant2, noopAudit),
    "DOMAIN_ALREADY_CLAIMED",
  );
  assert.strictEqual(crossTenant.outcome, "DOMAIN_ALREADY_CLAIMED");
  assert.strictEqual("token" in crossTenant, false);
  assert.strictEqual(JSON.stringify(crossTenant).includes("token"), false);

  assert.strictEqual(capability.listDomains(claimed, tenant2).length, 0);
  expectError(
    capability.verifyDnsOwnership(claimed, domain, tenant2, "any-token", noopAudit),
    "NOT_FOUND",
  );

  const auth = makeAuthClientPort();
  expectError(
    capability.activateAuthClient(claimed, domain, tenant2, auth.port, noopAudit),
    "NOT_FOUND",
  );
  assert.strictEqual(auth.calls.activate, 0);

  expectError(
    capability.activateAuthClient(claimed, domain, tenant1, auth.port, noopAudit),
    "NOT_VERIFIED",
  );
  assert.strictEqual(auth.calls.activate, 0);

  const verified: State = expectState(
    capability.verifyDnsOwnership(
      claimed,
      domain,
      tenant1,
      expectDomainRecord(claimed, domain, tenant1).challengeTokens[0]!.token,
      noopAudit,
    ),
  );

  const activated: State = expectState(
    capability.activateAuthClient(verified, domain, tenant1, auth.port, noopAudit),
  );
  assert.strictEqual(auth.calls.activate, 1);
  assert.strictEqual(expectDomainRecord(activated, domain, tenant1).authClientStatus, "ACTIVE");

  const tenantView: readonly DomainRecord[] = capability.listDomains(activated, tenant1);
  assert.strictEqual(tenantView.length, 1);
  assert.strictEqual(tenantView[0]!.tenant, tenant1);

  assert.strictEqual(capability.listDomains(activated, tenant2).length, 0);
});

test("customdomainsdnsownershiptlscanonicalproof", () => {
  const tenant: string = "tenant-proof";
  const otherTenant: string = "tenant-other";
  const domain: string = "proof.example.com";
  const secondary: string = "proof-two.example.com";

  const auth = makeAuthClientPort();
  const probe = makeProbePort();

  let state: State = expectState(
    capability.createOwnershipChallenge(capability.initialState, domain, tenant, noopAudit),
  );
  const primaryToken: string = expectDomainRecord(state, domain, tenant).challengeTokens[0]!.token;
  state = expectState(capability.verifyDnsOwnership(state, domain, tenant, primaryToken, noopAudit));
  state = expectState(capability.activateAuthClient(state, domain, tenant, auth.port, noopAudit));
  state = expectState(capability.proveLocalRoutingWithProbe(state, domain, tenant, probe.port, noopAudit));
  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));

  const resolved: DomainRecord = expectDomainRecordFromResult(
    capability.resolveCustomDomain(state, domain, tenant),
    domain,
    tenant,
  );
  assert.strictEqual(resolved.canonical, true);
  const authOrigin: DomainRecord = expectDomainRecordFromResult(
    capability.resolveCustomDomainAuthOrigin(state, domain, tenant),
    domain,
    tenant,
  );
  assert.strictEqual(authOrigin.authClientStatus, "ACTIVE");

  expectError(
    capability.resolveCustomDomain(state, domain, otherTenant),
    "NOT_FOUND",
  );

  assert.strictEqual(auth.calls.activate, 1);
  assert.strictEqual(probe.calls.probe, 1);

  state = expectState(capability.createOwnershipChallenge(state, secondary, tenant, noopAudit));
  const secondaryRecord: DomainRecord = expectDomainRecord(state, secondary, tenant);
  state = expectState(
    capability.verifyDnsOwnership(state, secondary, tenant, secondaryRecord.challengeTokens[0]!.token, noopAudit),
  );
  const readiness: Readiness | ErrorResult = capability.getDomainReadiness(state, secondary, tenant);
  assert.ok(!isErrorResult(readiness));
  assert.strictEqual(readiness, "VERIFIED");

  expectError(
    capability.resolveCustomDomain(state, secondary, tenant),
    "ROUTING_NOT_PROVEN",
  );

  const disabled: State = expectState(capability.disableDomain(state, domain, tenant, noopAudit));
  expectError(
    capability.resolveCustomDomain(disabled, domain, tenant),
    "NOT_FOUND",
  );

  const probed: State = expectState(
    capability.proveLocalRoutingWithProbe(
      expectState(capability.activateAuthClient(state, secondary, tenant, auth.port, noopAudit)),
      secondary,
      tenant,
      probe.port,
      noopAudit,
    ),
  );
  const resolvedSecondary: DomainRecord = expectDomainRecordFromResult(
    capability.resolveCustomDomain(probed, secondary, tenant),
    secondary,
    tenant,
  );
  assert.strictEqual(resolvedSecondary.routingStatus, "LOCALLY_ACTIVE");
});

test("customdomainsdnsownershiptlscanonicalreadinessmodel", () => {
  const tenant: string = "tenant-ready";
  const domain: string = "readiness.example.com";

  const readinessValues: ReadonlyArray<Readiness> =
    capability.CustomDomainDnsOwnershipTlsCanonicalReadiness;
  const expectedReadinessValues: ReadonlyArray<Readiness> = [
    "NO_DOMAINS",
    "PENDING_DNS",
    "VERIFIED",
    "INACTIVE_AUTH_CLIENT",
    "LOCALLY_ROUTED",
    "DEFERRED_PUBLIC_DNS_TLS",
    "CANONICAL_REDIRECT_CUTOVER",
  ];
  for (const value of expectedReadinessValues) {
    assert.strictEqual(readinessValues.includes(value), true);
  }

  let state: State = capability.initialState;
  assert.strictEqual(capability.getReadiness(state, tenant), "NO_DOMAINS");

  state = expectState(capability.createOwnershipChallenge(state, domain, tenant, noopAudit));
  assert.strictEqual(capability.getReadiness(state, tenant), "PENDING_DNS");

  state = expectState(
    capability.verifyDnsOwnership(
      state,
      domain,
      tenant,
      expectDomainRecord(state, domain, tenant).challengeTokens[0]!.token,
      noopAudit,
    ),
  );
  assert.strictEqual(capability.getReadiness(state, tenant), "VERIFIED");

  state = expectState(
    capability.activateAuthClient(
      state,
      domain,
      tenant,
      { activate: () => true, deactivate: () => true },
      noopAudit,
    ),
  );
  assert.strictEqual(capability.getReadiness(state, tenant), "INACTIVE_AUTH_CLIENT");

  state = expectState(capability.proveLocalRouting(state, domain, tenant, noopAudit));
  assert.strictEqual(capability.getReadiness(state, tenant), "DEFERRED_PUBLIC_DNS_TLS");

  state = capability.setPublicDnsVerified(state, true);
  state = capability.setTlsProvisioned(state, true);
  assert.strictEqual(capability.getReadiness(state, tenant), "LOCALLY_ROUTED");

  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));
  assert.strictEqual(capability.getReadiness(state, tenant), "CANONICAL_REDIRECT_CUTOVER");

  const domainReadiness: Readiness | ErrorResult = capability.getDomainReadiness(state, domain, tenant);
  assert.ok(!isErrorResult(domainReadiness));
  assert.strictEqual(domainReadiness, "CANONICAL_REDIRECT_CUTOVER");

  state = expectState(capability.disableDomain(state, domain, tenant, noopAudit));
  assert.strictEqual(capability.getReadiness(state, tenant), "DEFERRED_PUBLIC_DNS_TLS");
  const disabledDomainReadiness: Readiness | ErrorResult = capability.getDomainReadiness(state, domain, tenant);
  assert.ok(!isErrorResult(disabledDomainReadiness));
  assert.strictEqual(disabledDomainReadiness, "DEFERRED_PUBLIC_DNS_TLS");

  const probeOnlyDomain: string = "probe-only.example.com";
  const probeOnlyState: State = expectState(
    capability.createOwnershipChallenge(capability.initialState, probeOnlyDomain, tenant, noopAudit),
  );
  const withVerified: State = expectState(
    capability.verifyDnsOwnership(
      probeOnlyState,
      probeOnlyDomain,
      tenant,
      expectDomainRecord(probeOnlyState, probeOnlyDomain, tenant).challengeTokens[0]!.token,
      noopAudit,
    ),
  );
  const withActivated: State = expectState(
    capability.activateAuthClient(
      withVerified,
      probeOnlyDomain,
      tenant,
      { activate: () => true, deactivate: () => true },
      noopAudit,
    ),
  );
  const probeOnly: State = expectState(
    capability.proveLocalRouting(withActivated, probeOnlyDomain, tenant, noopAudit),
  );
  assert.strictEqual(
    capability.getReadiness(probeOnly, tenant),
    "DEFERRED_PUBLIC_DNS_TLS",
  );
  assert.strictEqual(probeOnly.publicDnsVerified, false);
  assert.strictEqual(probeOnly.tlsProvisioned, false);
});

test("customdomainsdnsownershiptlscanonicalstatemodel", () => {
  const tenant: string = "tenant-state";
  const domain: string = "state.example.com";

  let state: State = expectState(
    capability.createOwnershipChallenge(capability.initialState, domain, tenant, noopAudit),
  );
  const pending: DomainRecord = expectDomainRecord(state, domain, tenant);

  const ownership: OwnershipStatus = pending.ownershipStatus;
  assert.strictEqual(ownership, "PENDING_DNS");
  assert.strictEqual(pending.authClientStatus, "INACTIVE");
  assert.strictEqual(pending.routingStatus, "UNKNOWN");
  assert.strictEqual(pending.tlsStatus, "UNKNOWN");
  assert.strictEqual(pending.canonical, false);
  assert.strictEqual(pending.redirectPolicy, "NO_REDIRECT");
  assert.strictEqual(pending.disabled, false);
  assert.strictEqual(pending.challengeTokens.length, 1);
  assert.strictEqual(typeof pending.challengeTokens[0]!.createdAt, "string");
  assert.strictEqual(typeof pending.challengeTokens[0]!.expiresAt, "string");
  assert.strictEqual(pending.verifiedAt, null);
  assert.strictEqual(pending.activatedAt, null);
  assert.strictEqual(pending.routedAt, null);
  assert.strictEqual(pending.canonicalSetAt, null);
  assert.strictEqual(state.publicDnsVerified, false);
  assert.strictEqual(state.tlsProvisioned, false);

  expectError(
    capability.verifyDnsOwnershipWithLookup(
      state,
      domain,
      tenant,
      { lookupTxt: () => ["wrong-token"] },
      noopAudit,
    ),
    "DNS_MISMATCH",
  );

  state = expectState(
    capability.verifyDnsOwnership(state, domain, tenant, pending.challengeTokens[0]!.token, noopAudit),
  );
  const verified: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.notStrictEqual(verified.verifiedAt, null);

  state = expectState(
    capability.activateAuthClient(
      state,
      domain,
      tenant,
      { activate: () => true, deactivate: () => true },
      noopAudit,
    ),
  );
  const active: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.notStrictEqual(active.activatedAt, null);

  state = expectState(capability.proveLocalRouting(state, domain, tenant, noopAudit));
  const routed: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(routed.routingStatus, "LOCALLY_ACTIVE");
  assert.strictEqual(routed.tlsStatus, "DEFERRED");
  assert.notStrictEqual(routed.routedAt, null);

  state = expectState(capability.setCanonical(state, domain, tenant, noopAudit));
  const canonicalized: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(canonicalized.canonical, true);
  assert.strictEqual(canonicalized.redirectPolicy, "REDIRECT_SLUG_TO_CANONICAL");
  assert.notStrictEqual(canonicalized.canonicalSetAt, null);

  state = expectState(capability.unsetCanonical(state, domain, tenant, noopAudit));
  const uncanonicalized: DomainRecord = expectDomainRecord(state, domain, tenant);
  assert.strictEqual(uncanonicalized.canonical, false);
  assert.strictEqual(uncanonicalized.redirectPolicy, "NO_REDIRECT");
  assert.strictEqual(uncanonicalized.canonicalSetAt, null);

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
  const tenant: string = "tenant-validate";
  const validDomain: string = "validation.example.com";
  const invalidDomains: ReadonlyArray<string> = [
    "invalid..domain",
    "192.168.1.1",
    ".validation.com",
    "validation.com.",
    "-validation.com",
    "validation-.com",
  ];

  for (const invalid of invalidDomains) {
    expectError(
      capability.createOwnershipChallenge(capability.initialState, invalid, tenant, noopAudit),
      "INVALID_DOMAIN",
    );
  }

  let state: State = expectState(
    capability.createOwnershipChallenge(capability.initialState, validDomain, tenant, noopAudit),
  );
  const pending: DomainRecord = expectDomainRecord(state, validDomain, tenant);

  expectError(
    capability.verifyDnsOwnership(state, validDomain, tenant, "wrong-token", noopAudit),
    "DNS_MISMATCH",
  );
  expectError(
    capability.verifyDnsOwnership(state, validDomain, tenant, "", noopAudit),
    "DNS_MISMATCH",
  );

  expectError(
    capability.setCanonical(state, validDomain, tenant, noopAudit),
    "NOT_VERIFIED",
  );

  expectError(
    capability.createOwnershipChallenge(state, validDomain, "tenant-cross", noopAudit),
    "DOMAIN_ALREADY_CLAIMED",
  );

  state = expectState(
    capability.verifyDnsOwnership(state, validDomain, tenant, pending.challengeTokens[0]!.token, noopAudit),
  );
  expectError(
    capability.setCanonical(state, validDomain, tenant, noopAudit),
    "AUTH_CLIENT_INACTIVE",
  );

  state = expectState(
    capability.activateAuthClient(
      state,
      validDomain,
      tenant,
      { activate: () => true, deactivate: () => true },
      noopAudit,
    ),
  );
  expectError(
    capability.setCanonical(state, validDomain, tenant, noopAudit),
    "ROUTING_NOT_PROVEN",
  );

  state = expectState(capability.proveLocalRouting(state, validDomain, tenant, noopAudit));
  const canonical: State = expectState(capability.setCanonical(state, validDomain, tenant, noopAudit));
  assert.strictEqual(expectDomainRecord(canonical, validDomain, tenant).canonical, true);

  expectError(
    capability.setCanonical(canonical, validDomain, tenant, noopAudit),
    "NOT_ACTIVE",
  );
});