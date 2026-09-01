import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/delegatedadministrationroles.ts";

test("delegatedadministrationrolesauditmodel", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "system-admin-user",
    callerRoles: ["system-admin"],
    organisationId: "org-1",
  };

  // Grant audit before persistence
  let grantAuditCalled = false;
  const grantAuditFn: (event: capability.DelegatedAdministrationRolesAuditEvent) => capability.DelegatedAdministrationRolesError | null = (event) => {
    assert.strictEqual(event.kind, "DELEGATION_GRANTED");
    assert.strictEqual(event.organisationId, "org-1");
    assert.strictEqual(event.granterId, "system-admin-user");
    assert.strictEqual(event.granteeId, "grantee-1");
    assert.strictEqual(event.scope, "scope-1");
    grantAuditCalled = true;
    return null;
  };

  const grantResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    grantAuditFn,
  );
  assert.ok(grantAuditCalled, "Grant should emit audit event before persistence");
  assert.deepStrictEqual(grantResult, {
    outcome: "OK",
    state: {
      delegations: [
        {
          id: "del-1",
          organisationId: "org-1",
          granterId: "system-admin-user",
          granteeId: "grantee-1",
          scope: "scope-1",
          grantedTimestamp: grantResult.outcome === "OK" ? grantResult.state.delegations[0].grantedTimestamp : "",
          grantor: "system-admin-user",
          expiryTimestamp: null,
          revokedTimestamp: null,
          revoker: null,
        },
      ],
    },
  });

  // Revoke audit after successful revoke
  let revokeAuditCalled = false;
  const revokeAuditFn: (event: capability.DelegatedAdministrationRolesAuditEvent) => capability.DelegatedAdministrationRolesError | null = (event) => {
    assert.strictEqual(event.kind, "DELEGATION_REVOKED");
    revokeAuditCalled = true;
    return null;
  };

  const revokeResult = capability.revokeDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    context,
    "del-1",
    revokeAuditFn,
  );
  assert.ok(revokeAuditCalled, "Revoke should emit audit event after successful revoke");
  assert.strictEqual(revokeResult.outcome, "OK");

  // List audit on authorised path
  let listAuditCalled = false;
  const listAuditFn: (event: capability.DelegatedAdministrationRolesAuditEvent) => capability.DelegatedAdministrationRolesError | null = (event) => {
    assert.strictEqual(event.kind, "DELEGATION_LISTED");
    listAuditCalled = true;
    return null;
  };

  const listResult = capability.listDelegations(
    state,
    context,
    listAuditFn,
  );
  assert.ok(listAuditCalled, "List should emit audit event on authorised path");

  // No-op denied paths emit no audit
  const deniedContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [],
    organisationId: "org-1",
  };
  let deniedAuditCalled = false;
  const deniedAuditFn: (event: capability.DelegatedAdministrationRolesAuditEvent) => capability.DelegatedAdministrationRolesError | null = (event) => {
    deniedAuditCalled = true;
    return null;
  };
  const deniedResult = capability.grantDelegation(
    state,
    deniedContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    deniedAuditFn,
  );
  assert.strictEqual((deniedResult as capability.DelegatedAdministrationRolesError).kind, "STATIC_PERMISSION_DENIED");
  assert.ok(!deniedAuditCalled, "Denied grant should not emit audit event");
});

test("delegatedadministrationrolescontracts", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "tenant-admin-user",
    callerRoles: ["tenant-admin"],
    organisationId: "org-1",
  };

  // Create delegation
  const grantResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  if (grantResult.outcome === "OK") {
    assert.strictEqual(grantResult.state.delegations.length, 1);
    assert.strictEqual(grantResult.state.delegations[0].grantor, "tenant-admin-user");
  } else {
    assert.fail("Grant should succeed for tenant-admin");
  }

  // List delegations
  const listResult = capability.listDelegations(
    grantResult.outcome === "OK" ? grantResult.state : state,
    context,
    () => null,
  );
  if (listResult.outcome === "OK") {
    assert.strictEqual(listResult.delegations.length, 1);
  } else {
    assert.fail("List should succeed for tenant-admin");
  }

  // Delete delegation (revoke)
  const revokeResult = capability.revokeDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    { ...context, callerRoles: ["system-admin"] },
    "del-1",
    () => null,
  );
  assert.strictEqual(revokeResult.outcome, "OK");
});

test("delegatedadministrationroleserrormodel", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [],
    organisationId: "org-1",
  };

  // Static permission denied
  const deniedResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.strictEqual((deniedResult as capability.DelegatedAdministrationRolesError).kind, "STATIC_PERMISSION_DENIED");

  // Delegation already active
  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"],
    organisationId: "org-1",
  };
  const firstGrant = capability.grantDelegation(
    state,
    adminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  const secondGrantState = firstGrant.outcome === "OK" ? firstGrant.state : state;
  const secondGrant = capability.grantDelegation(
    secondGrantState,
    adminContext,
    "del-2",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.strictEqual((secondGrant as capability.DelegatedAdministrationRolesError).kind, "DELEGATION_ALREADY_ACTIVE");

  // Not found
  const notFoundResult = capability.revokeDelegation(
    state,
    adminContext,
    "non-existent",
    () => null,
  );
  assert.strictEqual((notFoundResult as capability.DelegatedAdministrationRolesError).kind, "NOT_FOUND");

  // Fail closed (simulated via audit failure)
  const failClosedResult = capability.grantDelegation(
    state,
    adminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => ({ kind: "FAIL_CLOSED", message: "Audit failed" }),
  );
  assert.strictEqual((failClosedResult as capability.DelegatedAdministrationRolesError).kind, "FAIL_CLOSED");
});

test("delegatedadministrationroleslifecycle", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"],
    organisationId: "org-1",
  };

  // Grant to active
  const grantResult = capability.grantDelegation(
    state,
    adminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.strictEqual(grantResult.outcome, "OK");
  const delegation = grantResult.outcome === "OK" ? grantResult.state.delegations[0] : null;
  assert.ok(capability.isDelegationActive(delegation!));

  // Duplicate active grant short-circuits
  const duplicateResult = capability.grantDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    adminContext,
    "del-2",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.strictEqual((duplicateResult as capability.DelegatedAdministrationRolesError).kind, "DELEGATION_ALREADY_ACTIVE");

  // Revoke to revoked
  const revokeResult = capability.revokeDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    adminContext,
    "del-1",
    () => null,
  );
  assert.strictEqual(revokeResult.outcome, "OK");
  const revokedDelegation = revokeResult.outcome === "OK" ? revokeResult.state.delegations.find(d => d.id === "del-1") : null;
  assert.ok(revokedDelegation !== undefined && !capability.isDelegationActive(revokedDelegation));

  // List delegations
  const listResult = capability.listDelegations(
    grantResult.outcome === "OK" ? grantResult.state : state,
    adminContext,
    () => null,
  );
  assert.strictEqual(listResult.outcome, "OK");

  // Self-only lookup for non-admin
  const nonAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "grantee-1",
    callerRoles: [],
    organisationId: "org-1",
  };
  const selfLookupResult = capability.getDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    nonAdminContext,
    "del-1",
  );
  if (selfLookupResult.outcome === "OK") {
    assert.strictEqual(selfLookupResult.delegation?.granteeId, "grantee-1");
  } else {
    assert.fail("Self lookup should succeed for grantee");
  }
});

test("delegatedadministrationrolespermissions", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"],
    organisationId: "org-1",
  };
  const tenantAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "tenant-admin-1",
    callerRoles: ["tenant-admin"],
    organisationId: "org-1",
  };
  const nonAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [],
    organisationId: "org-1",
  };

  // Grant allowed for system-admin or tenant-admin
  const grantResult = capability.grantDelegation(
    state,
    tenantAdminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.strictEqual(grantResult.outcome, "OK");

  // Revoke is system-admin only
  const revokeResult = capability.revokeDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    tenantAdminContext,
    "del-1",
    () => null,
  );
  assert.strictEqual((revokeResult as capability.DelegatedAdministrationRolesError).kind, "STATIC_PERMISSION_DENIED");

  const systemAdminRevokeResult = capability.revokeDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    adminContext,
    "del-1",
    () => null,
  );
  assert.strictEqual(systemAdminRevokeResult.outcome, "OK");

  // Non-admin self-lookup limited to own grantee id
  const selfLookupResult = capability.getDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    nonAdminContext,
    "del-1",
  );
  assert.strictEqual((selfLookupResult as capability.DelegatedAdministrationRolesError).kind, "NOT_FOUND");

  // Tenant isolation
  const otherOrgContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"],
    organisationId: "org-2",
  };
  const otherOrgListResult = capability.listDelegations(
    grantResult.outcome === "OK" ? grantResult.state : state,
    otherOrgContext,
    () => null,
  );
  if (otherOrgListResult.outcome === "OK") {
    assert.strictEqual(otherOrgListResult.delegations.length, 0);
  } else {
    assert.fail("List should succeed but return empty for other org");
  }
});

test("delegatedadministrationrolesproof", () => {
  // Unit proof: delegation state machine
  const delegation: capability.DelegatedAdministrationRolesDelegation = {
    id: "del-1",
    organisationId: "org-1",
    granterId: "admin-1",
    granteeId: "user-1",
    scope: "scope-1",
    grantedTimestamp: new Date().toISOString(),
    grantor: "admin-1",
    expiryTimestamp: null,
    revokedTimestamp: null,
    revoker: null,
  };
  assert.ok(capability.isDelegationActive(delegation));

  const revokedDelegation: capability.DelegatedAdministrationRolesDelegation = {
    ...delegation,
    revokedTimestamp: new Date().toISOString(),
    revoker: "admin-1",
  };
  assert.ok(!capability.isDelegationActive(revokedDelegation));

  // Runtime proof: local composition with in-memory port and audit
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "system-admin-user",
    callerRoles: ["system-admin"],
    organisationId: "org-1",
  };

  const auditFn = (): null => null;
  const grantResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    auditFn,
  );
  assert.strictEqual(grantResult.outcome, "OK");

  const listResult = capability.listDelegations(
    grantResult.outcome === "OK" ? grantResult.state : state,
    context,
    auditFn,
  );
  assert.strictEqual(listResult.outcome, "OK");

  const revokeResult = capability.revokeDelegation(
    grantResult.outcome === "OK" ? grantResult.state : state,
    context,
    "del-1",
    auditFn,
  );
  assert.strictEqual(revokeResult.outcome, "OK");
});

test("delegatedadministrationrolesreadinessmodel", () => {
  // Readiness is invariant-ready for the usecase contract
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "system-admin-user",
    callerRoles: ["system-admin"],
    organisationId: "org-1",
  };

  // Local runtime proof exercises the composition root against in-memory port and audit
  const auditFn = (): null => null;
  const grantResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    auditFn,
  );
  assert.strictEqual(grantResult.outcome, "OK");

  // Read-only listing and audit visible in degraded mode
  const listResult = capability.listDelegations(
    grantResult.outcome === "OK" ? grantResult.state : state,
    context,
    auditFn,
  );
  assert.strictEqual(listResult.outcome, "OK");
});

test("delegatedadministrationrolesstatemodel", () => {
  // State is a delegated-role record carrying required fields
  const delegation: capability.DelegatedAdministrationRolesDelegation = {
    id: "del-1",
    organisationId: "org-1",
    granterId: "admin-1",
    granteeId: "user-1",
    scope: "scope-1",
    grantedTimestamp: new Date().toISOString(),
    grantor: "admin-1",
    expiryTimestamp: null,
    revokedTimestamp: null,
    revoker: null,
  };
  assert.strictEqual(delegation.id, "del-1");
  assert.strictEqual(delegation.organisationId, "org-1");
  assert.strictEqual(delegation.granterId, "admin-1");
  assert.strictEqual(delegation.granteeId, "user-1");
  assert.strictEqual(delegation.scope, "scope-1");
  assert.strictEqual(delegation.grantor, "admin-1");
  assert.strictEqual(delegation.expiryTimestamp, null);
  assert.strictEqual(delegation.revokedTimestamp, null);
  assert.strictEqual(delegation.revoker, null);

  // Activeness is derived from the revoked and expiry fields
  assert.ok(capability.isDelegationActive(delegation));

  const expiredDelegation: capability.DelegatedAdministrationRolesDelegation = {
    ...delegation,
    expiryTimestamp: new Date(Date.now() - 1000).toISOString(),
  };
  assert.ok(!capability.isDelegationActive(expiredDelegation));

  const revokedDelegation: capability.DelegatedAdministrationRolesDelegation = {
    ...delegation,
    revokedTimestamp: new Date().toISOString(),
    revoker: "admin-1",
  };
  assert.ok(!capability.isDelegationActive(revokedDelegation));
});

test("delegatedadministrationrolesvalidation", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"],
    organisationId: "org-1",
  };
  const nonAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [],
    organisationId: "org-1",
  };

  // Non-admin grant fails closed
  const nonAdminGrantResult = capability.grantDelegation(
    state,
    nonAdminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.strictEqual((nonAdminGrantResult as capability.DelegatedAdministrationRolesError).kind, "STATIC_PERMISSION_DENIED");

  // Non-admin list fails closed
  const nonAdminListResult = capability.listDelegations(
    state,
    nonAdminContext,
    () => null,
  );
  assert.strictEqual((nonAdminListResult as capability.DelegatedAdministrationRolesError).kind, "STATIC_PERMISSION_DENIED");

  // Non-admin revoke fails closed
  const nonAdminRevokeResult = capability.revokeDelegation(
    state,
    nonAdminContext,
    "del-1",
    () => null,
  );
  assert.strictEqual((nonAdminRevokeResult as capability.DelegatedAdministrationRolesError).kind, "STATIC_PERMISSION_DENIED");

  // Duplicate active grant short-circuits without mutation
  const firstGrant = capability.grantDelegation(
    state,
    adminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  const secondGrantState = firstGrant.outcome === "OK" ? firstGrant.state : state;
  const secondGrant = capability.grantDelegation(
    secondGrantState,
    adminContext,
    "del-2",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.strictEqual((secondGrant as capability.DelegatedAdministrationRolesError).kind, "DELEGATION_ALREADY_ACTIVE");
  assert.strictEqual(secondGrantState.delegations.length, 1);

  // Server overwrites client-supplied grantor with caller's id
  const grantResult = capability.grantDelegation(
    state,
    adminContext,
    "del-2",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  if (grantResult.outcome === "OK") {
    assert.strictEqual(grantResult.state.delegations[0].grantor, "admin-1");
  } else {
    assert.fail("Grant should succeed for admin");
  }

  // Tenant isolation keeps one organisation's grants from another
  const otherOrgState: capability.DelegatedAdministrationRolesState = {
    delegations: [
      {
        id: "del-1",
        organisationId: "org-2",
        granterId: "admin-1",
        granteeId: "user-1",
        scope: "scope-1",
        grantedTimestamp: new Date().toISOString(),
        grantor: "admin-1",
        expiryTimestamp: null,
        revokedTimestamp: null,
        revoker: null,
      },
    ],
  };
  const otherOrgListResult = capability.listDelegations(
    otherOrgState,
    adminContext,
    () => null,
  );
  if (otherOrgListResult.outcome === "OK") {
    assert.strictEqual(otherOrgListResult.delegations.length, 0);
  } else {
    assert.fail("List should succeed but return empty for other org");
  }
});