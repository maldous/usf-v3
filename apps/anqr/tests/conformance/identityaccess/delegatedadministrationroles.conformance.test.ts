import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/delegatedadministrationroles.ts";

test("delegatedadministrationrolesauditmodel", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "system-admin-user",
    callerRoles: ["system-admin"] as const,
    organisationId: "org-1",
  };

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
  assert.equal("outcome" in grantResult, true);
  assert.strictEqual(grantResult.outcome, "OK");
  assert.strictEqual(grantResult.state.delegations.length, 1);
  assert.strictEqual(grantResult.state.delegations[0].grantor, "system-admin-user");

  const grantedState = grantResult.state;

  let revokeAuditCalled = false;
  const revokeAuditFn: (event: capability.DelegatedAdministrationRolesAuditEvent) => capability.DelegatedAdministrationRolesError | null = (event) => {
    assert.strictEqual(event.kind, "DELEGATION_REVOKED");
    revokeAuditCalled = true;
    return null;
  };

  const revokeResult = capability.revokeDelegation(
    grantedState,
    context,
    "del-1",
    revokeAuditFn,
  );
  assert.ok(revokeAuditCalled, "Revoke should emit audit event after successful revoke");
  assert.equal("outcome" in revokeResult, true);
  assert.strictEqual(revokeResult.outcome, "OK");

  let listAuditCalled = false;
  const listAuditFn: (event: capability.DelegatedAdministrationRolesAuditEvent) => capability.DelegatedAdministrationRolesError | null = (event) => {
    assert.strictEqual(event.kind, "DELEGATION_LISTED");
    listAuditCalled = true;
    return null;
  };

  const listResult = capability.listDelegations(
    grantedState,
    context,
    listAuditFn,
  );
  assert.ok(listAuditCalled, "List should emit audit event on authorised path");
  assert.equal("outcome" in listResult, true);
  assert.strictEqual(listResult.outcome, "OK");

  const deniedContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [] as const,
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
  assert.equal("kind" in deniedResult, true);
  assert.strictEqual(deniedResult.kind, "STATIC_PERMISSION_DENIED");
  assert.ok(!deniedAuditCalled, "Denied grant should not emit audit event");

  const notFoundResult = capability.revokeDelegation(
    state,
    context,
    "non-existent",
    deniedAuditFn,
  );
  assert.equal("kind" in notFoundResult, true);
  assert.strictEqual(notFoundResult.kind, "NOT_FOUND");
  assert.ok(!deniedAuditCalled, "Not found revoke should not emit audit event");
});

test("delegatedadministrationrolescontracts", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "tenant-admin-user",
    callerRoles: ["tenant-admin"] as const,
    organisationId: "org-1",
  };

  const grantResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("outcome" in grantResult, true);
  assert.strictEqual(grantResult.outcome, "OK");
  assert.strictEqual(grantResult.state.delegations.length, 1);
  assert.strictEqual(grantResult.state.delegations[0].grantor, "tenant-admin-user");

  const listResult = capability.listDelegations(
    grantResult.state,
    context,
    () => null,
  );
  assert.equal("outcome" in listResult, true);
  assert.strictEqual(listResult.outcome, "OK");
  assert.strictEqual(listResult.delegations.length, 1);

  const revokeResult = capability.revokeDelegation(
    grantResult.state,
    { ...context, callerRoles: ["system-admin"] as const },
    "del-1",
    () => null,
  );
  assert.equal("outcome" in revokeResult, true);
  assert.strictEqual(revokeResult.outcome, "OK");
});

test("delegatedadministrationroleserrormodel", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [] as const,
    organisationId: "org-1",
  };

  const deniedResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("kind" in deniedResult, true);
  assert.strictEqual(deniedResult.kind, "STATIC_PERMISSION_DENIED");

  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"] as const,
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
  assert.equal("outcome" in firstGrant, true);
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
  assert.equal("kind" in secondGrant, true);
  assert.strictEqual(secondGrant.kind, "DELEGATION_ALREADY_ACTIVE");

  const notFoundResult = capability.revokeDelegation(
    state,
    adminContext,
    "non-existent",
    () => null,
  );
  assert.equal("kind" in notFoundResult, true);
  assert.strictEqual(notFoundResult.kind, "NOT_FOUND");

  const failClosedResult = capability.grantDelegation(
    state,
    adminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => ({ kind: "FAIL_CLOSED", message: "Audit failed" }),
  );
  assert.equal("kind" in failClosedResult, true);
  assert.strictEqual(failClosedResult.kind, "FAIL_CLOSED");
});

test("delegatedadministrationroleslifecycle", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"] as const,
    organisationId: "org-1",
  };

  const grantResult = capability.grantDelegation(
    state,
    adminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("outcome" in grantResult, true);
  assert.strictEqual(grantResult.outcome, "OK");
  const delegation = grantResult.state.delegations[0];
  assert.ok(capability.isDelegationActive(delegation));

  const duplicateResult = capability.grantDelegation(
    grantResult.state,
    adminContext,
    "del-2",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("kind" in duplicateResult, true);
  assert.strictEqual(duplicateResult.kind, "DELEGATION_ALREADY_ACTIVE");

  const revokeResult = capability.revokeDelegation(
    grantResult.state,
    adminContext,
    "del-1",
    () => null,
  );
  assert.equal("outcome" in revokeResult, true);
  assert.strictEqual(revokeResult.outcome, "OK");
  const revokedDelegation = revokeResult.state.delegations.find(d => d.id === "del-1");
  assert.ok(revokedDelegation !== undefined && !capability.isDelegationActive(revokedDelegation));

  const listResult = capability.listDelegations(
    grantResult.state,
    adminContext,
    () => null,
  );
  assert.equal("outcome" in listResult, true);
  assert.strictEqual(listResult.outcome, "OK");

  const nonAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "grantee-1",
    callerRoles: [] as const,
    organisationId: "org-1",
  };
  const selfLookupResult = capability.getDelegation(
    grantResult.state,
    nonAdminContext,
    "del-1",
  );
  assert.equal("outcome" in selfLookupResult, true);
  assert.strictEqual(selfLookupResult.outcome, "OK");
  assert.strictEqual(selfLookupResult.delegation?.granteeId, "grantee-1");
});

test("delegatedadministrationrolespermissions", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"] as const,
    organisationId: "org-1",
  };
  const tenantAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "tenant-admin-1",
    callerRoles: ["tenant-admin"] as const,
    organisationId: "org-1",
  };
  const nonAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [] as const,
    organisationId: "org-1",
  };

  const grantResult = capability.grantDelegation(
    state,
    tenantAdminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("outcome" in grantResult, true);
  assert.strictEqual(grantResult.outcome, "OK");

  const revokeResult = capability.revokeDelegation(
    grantResult.state,
    tenantAdminContext,
    "del-1",
    () => null,
  );
  assert.equal("kind" in revokeResult, true);
  assert.strictEqual(revokeResult.kind, "STATIC_PERMISSION_DENIED");

  const systemAdminRevokeResult = capability.revokeDelegation(
    grantResult.state,
    adminContext,
    "del-1",
    () => null,
  );
  assert.equal("outcome" in systemAdminRevokeResult, true);
  assert.strictEqual(systemAdminRevokeResult.outcome, "OK");

  const selfLookupResult = capability.getDelegation(
    grantResult.state,
    nonAdminContext,
    "del-1",
  );
  assert.equal("kind" in selfLookupResult, true);
  assert.strictEqual(selfLookupResult.kind, "NOT_FOUND");

  const otherOrgContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"] as const,
    organisationId: "org-2",
  };
  const otherOrgListResult = capability.listDelegations(
    grantResult.state,
    otherOrgContext,
    () => null,
  );
  assert.equal("outcome" in otherOrgListResult, true);
  assert.strictEqual(otherOrgListResult.outcome, "OK");
  assert.strictEqual(otherOrgListResult.delegations.length, 0);
});

test("delegatedadministrationrolesproof", () => {
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

  const expiredDelegation: capability.DelegatedAdministrationRolesDelegation = {
    ...delegation,
    expiryTimestamp: new Date(Date.now() - 1000).toISOString(),
  };
  assert.ok(!capability.isDelegationActive(expiredDelegation));
});

test("delegatedadministrationrolesreadinessmodel", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const context: capability.DelegatedAdministrationRolesContext = {
    callerId: "system-admin-user",
    callerRoles: ["system-admin"] as const,
    organisationId: "org-1",
  };

  const listResult = capability.listDelegations(
    state,
    context,
    () => null,
  );
  assert.equal("outcome" in listResult, true);
  assert.strictEqual(listResult.outcome, "OK");
  assert.strictEqual(listResult.delegations.length, 0);

  const grantResult = capability.grantDelegation(
    state,
    context,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("outcome" in grantResult, true);
  assert.strictEqual(grantResult.outcome, "OK");
});

test("delegatedadministrationrolesstatemodel", () => {
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

  assert.ok(capability.isDelegationActive(delegation));

  const state: capability.DelegatedAdministrationRolesState = {
    delegations: [delegation],
  };
  assert.strictEqual(state.delegations.length, 1);
  assert.strictEqual(state.delegations[0].id, "del-1");
});

test("delegatedadministrationrolesvalidation", () => {
  const state: capability.DelegatedAdministrationRolesState = capability.initialState;
  const nonAdminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "user-1",
    callerRoles: [] as const,
    organisationId: "org-1",
  };

  const grantResult = capability.grantDelegation(
    state,
    nonAdminContext,
    "del-1",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("kind" in grantResult, true);
  assert.strictEqual(grantResult.kind, "STATIC_PERMISSION_DENIED");

  const listResult = capability.listDelegations(
    state,
    nonAdminContext,
    () => null,
  );
  assert.equal("kind" in listResult, true);
  assert.strictEqual(listResult.kind, "STATIC_PERMISSION_DENIED");

  const revokeResult = capability.revokeDelegation(
    state,
    nonAdminContext,
    "del-1",
    () => null,
  );
  assert.equal("kind" in revokeResult, true);
  assert.strictEqual(revokeResult.kind, "STATIC_PERMISSION_DENIED");

  const adminContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"] as const,
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
  assert.equal("outcome" in firstGrant, true);
  const duplicateResult = capability.grantDelegation(
    firstGrant.state,
    adminContext,
    "del-2",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("kind" in duplicateResult, true);
  assert.strictEqual(duplicateResult.kind, "DELEGATION_ALREADY_ACTIVE");

  const grantWithClientGrantor = capability.grantDelegation(
    state,
    adminContext,
    "del-3",
    "grantee-1",
    "scope-1",
    null,
    () => null,
  );
  assert.equal("outcome" in grantWithClientGrantor, true);
  assert.strictEqual(grantWithClientGrantor.state.delegations[0].grantor, "admin-1");

  const otherOrgContext: capability.DelegatedAdministrationRolesContext = {
    callerId: "admin-1",
    callerRoles: ["system-admin"] as const,
    organisationId: "org-2",
  };
  const otherOrgListResult = capability.listDelegations(
    firstGrant.state,
    otherOrgContext,
    () => null,
  );
  assert.equal("outcome" in otherOrgListResult, true);
  assert.strictEqual(otherOrgListResult.delegations.length, 0);
});