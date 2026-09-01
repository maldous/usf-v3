import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/configuration/tenantcanonicaldomainsetunset.ts";

test("tenantcanonicaldomainsetunsetauditmodel", () => {
  const auditEvents: capability.TenantCanonicalDomainSetUnsetAuditEvent[] = [];
  const auditFn = (
    event: capability.TenantCanonicalDomainSetUnsetAuditEvent,
  ): capability.TenantCanonicalDomainSetUnsetErrorKind | null => {
    auditEvents.push(event);
    return null;
  };

  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: () => ({
      tenantId: "t1",
      domain: "example.com",
      verified: true,
      authClientActive: true,
      localRoutingProven: true,
      canonical: false,
      canonicalTimestamp: null,
      redirectPolicy: "NO_REDIRECT",
    }),
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const result = capability.setCanonicalDomain(
    state,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    authClient,
    auditFn,
  );
  assert.ok(!("kind" in result));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "CANONICAL_SET");
  assert.strictEqual(auditEvents[0].domain, "example.com");
  assert.strictEqual(auditEvents[0].redirectPolicy, "REDIRECT_SLUG_TO_CANONICAL");

  auditEvents.length = 0;
  const unsetResult = capability.unsetCanonicalDomain(
    result,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    auditFn,
  );
  assert.ok(!("kind" in unsetResult));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "CANONICAL_UNSET");
  assert.strictEqual(auditEvents[0].domain, "example.com");
  assert.strictEqual(auditEvents[0].redirectPolicy, "REDIRECT_OFF");
});

test("tenantcanonicaldomainsetunsetcontracts", () => {
  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: () => ({
      tenantId: "t1",
      domain: "example.com",
      verified: true,
      authClientActive: true,
      localRoutingProven: true,
      canonical: false,
      canonicalTimestamp: null,
      redirectPolicy: "NO_REDIRECT",
    }),
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };
  const auditFn = () => null;

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const setResult = capability.setCanonicalDomain(
    state,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    authClient,
    auditFn,
  );
  assert.ok(!("kind" in setResult));

  const unsetResult = capability.unsetCanonicalDomain(
    setResult,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    auditFn,
  );
  assert.ok(!("kind" in unsetResult));
});

test("tenantcanonicaldomainsetunseterrormodel", () => {
  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: () => null,
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };
  const auditFn = () => null;

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const result = capability.setCanonicalDomain(
    state,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    authClient,
    auditFn,
  );
  assert.strictEqual(result.kind, "NOT_FOUND");
});

test("tenantcanonicaldomainsetunsetlifecycle", () => {
  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: (tenantId, domain) => {
      if (tenantId === "t1" && domain === "example.com") {
        return {
          tenantId: "t1",
          domain: "example.com",
          verified: true,
          authClientActive: true,
          localRoutingProven: true,
          canonical: false,
          canonicalTimestamp: null,
          redirectPolicy: "NO_REDIRECT",
        };
      }
      return null;
    },
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };
  const auditFn = () => null;

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const setResult = capability.setCanonicalDomain(
    state,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    authClient,
    auditFn,
  );
  assert.ok(!("kind" in setResult));
  const canonical = setResult.domains.find(
    (d) => d.tenantId === "t1" && d.domain === "example.com",
  );
  assert.ok(canonical !== undefined);
  assert.strictEqual(canonical.canonical, true);
  assert.strictEqual(canonical.redirectPolicy, "REDIRECT_SLUG_TO_CANONICAL");

  const unsetResult = capability.unsetCanonicalDomain(
    setResult,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    auditFn,
  );
  assert.ok(!("kind" in unsetResult));
  const unsetCanonical = unsetResult.domains.find(
    (d) => d.tenantId === "t1" && d.domain === "example.com",
  );
  assert.ok(unsetCanonical !== undefined);
  assert.strictEqual(unsetCanonical.canonical, false);
  assert.strictEqual(unsetCanonical.redirectPolicy, "REDIRECT_OFF");
});

test("tenantcanonicaldomainsetunsetpermissions", () => {
  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: () => ({
      tenantId: "t1",
      domain: "example.com",
      verified: true,
      authClientActive: true,
      localRoutingProven: true,
      canonical: false,
      canonicalTimestamp: null,
      redirectPolicy: "NO_REDIRECT",
    }),
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };
  const auditFn = () => null;

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const result = capability.setCanonicalDomain(
    state,
    "t1",
    "example.com",
    "wrong-permission",
    port,
    authClient,
    auditFn,
  );
  assert.strictEqual(result.kind, "NOT_VERIFIED");
});

test("tenantcanonicaldomainsetunsetproof", () => {
  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: (tenantId, domain) => {
      if (tenantId === "t1" && domain === "example.com") {
        return {
          tenantId: "t1",
          domain: "example.com",
          verified: true,
          authClientActive: true,
          localRoutingProven: true,
          canonical: false,
          canonicalTimestamp: null,
          redirectPolicy: "NO_REDIRECT",
        };
      }
      return null;
    },
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };
  const auditFn = () => null;

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const proof = capability.proveCanonicalRuntime(
    state,
    "t1",
    "example.com",
    port,
    authClient,
    auditFn,
  );
  assert.ok(!("kind" in proof.setResult));
  assert.strictEqual(proof.invariantHolds, true);
  assert.ok(!("kind" in proof.unsetResult));
  assert.ok(!("kind" in proof.deactivationResult));
});

test("tenantcanonicaldomainsetunsetreadinessmodel", () => {
  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: () => ({
      tenantId: "t1",
      domain: "example.com",
      verified: true,
      authClientActive: true,
      localRoutingProven: true,
      canonical: false,
      canonicalTimestamp: null,
      redirectPolicy: "NO_REDIRECT",
    }),
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };
  const auditFn = () => null;

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const result = capability.setCanonicalDomain(
    state,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    authClient,
    auditFn,
  );
  assert.ok(!("kind" in result));
  assert.strictEqual(result.readiness, "READY_LOCAL");

  const unsetResult = capability.unsetCanonicalDomain(
    result,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    auditFn,
  );
  assert.ok(!("kind" in unsetResult));
  assert.strictEqual(unsetResult.readiness, "NOT_READY");
});

test("tenantcanonicaldomainsetunsetstatemodel", () => {
  const state: capability.TenantCanonicalDomainSetUnsetState = {
    domains: [
      {
        tenantId: "t1",
        domain: "example.com",
        verified: true,
        authClientActive: true,
        localRoutingProven: true,
        canonical: true,
        canonicalTimestamp: "2024-01-01T00:00:00.000Z",
        redirectPolicy: "REDIRECT_SLUG_TO_CANONICAL",
      },
    ],
    readiness: "READY_LOCAL",
  };
  assert.strictEqual(
    capability.checkCanonicalInvariant(state, "t1"),
    true,
  );
  const canonical = capability.getCanonicalDomainForTenant(state, "t1");
  assert.ok(canonical !== null);
  assert.strictEqual(canonical.domain, "example.com");
});

test("tenantcanonicaldomainsetunsetvalidation", () => {
  const port: capability.TenantCanonicalDomainSetUnsetPort = {
    getDomain: (tenantId, domain) => {
      if (tenantId === "t1" && domain === "example.com") {
        return {
          tenantId: "t1",
          domain: "example.com",
          verified: false,
          authClientActive: true,
          localRoutingProven: true,
          canonical: false,
          canonicalTimestamp: null,
          redirectPolicy: "NO_REDIRECT",
        };
      }
      return null;
    },
    setDomain: () => null,
    unsetDomain: () => null,
    deactivateDomain: () => null,
  };
  const authClient: capability.TenantCanonicalDomainSetUnsetAuthClient = {
    isActive: () => true,
  };
  const auditFn = () => null;

  const state = capability.tenantCanonicalDomainSetUnsetInitialState;
  const result = capability.setCanonicalDomain(
    state,
    "t1",
    "example.com",
    "tenant-domain-write",
    port,
    authClient,
    auditFn,
  );
  assert.strictEqual(result.kind, "NOT_VERIFIED");
});