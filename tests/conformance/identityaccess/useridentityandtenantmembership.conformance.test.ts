import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/useridentityandtenantmembership.ts";

test("useridentityandtenantmembershipauditmodel", () => {
  let auditEmitted = false;
  const auditFn = (e: capability.UserIdentityAndTenantMembershipAuditEvent) => {
    auditEmitted = true;
    return null;
  };
  const failAuditFn = (e: capability.UserIdentityAndTenantMembershipAuditEvent) => {
    return { kind: "PROVIDER_FAILURE" as const, message: "audit fail", statusCode: 422 as const };
  };

  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:invite", "member:update-role", "member:delete"]
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "READY"
  };

  const invalidInput = { email: "bad" };
  const res1 = capability.inviteMember(state, context, invalidInput, auditFn);
  assert.equal(auditEmitted, false);
  assert.equal(res1.kind, "INVALID_BODY");

  const validInvite = { email: "test@example.com", role: "member" };
  const res2 = capability.inviteMember(state, context, validInvite, failAuditFn);
  assert.equal(res2.kind, "PROVIDER_FAILURE");

  const res3 = capability.inviteMember(state, context, validInvite, auditFn);
  assert.equal(auditEmitted, true);
  assert.equal(res3.kind, "CREATED");
});

test("useridentityandtenantmembershipcontracts", () => {
  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:read", "member:invite"]
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "READY"
  };
  const res = capability.listMembers(state, context);
  assert.equal(res.kind, "OK");
  if (res.kind === "OK") {
    assert.deepEqual(res.value, []);
  }
  const pending = capability.listPendingInvitations(state, context);
  assert.equal(pending.kind, "OK");

  const inviteRes = capability.inviteMember(state, context, { email: "a@b.com", role: "viewer" }, () => null);
  assert.equal(inviteRes.kind, "CREATED");
});

test("useridentityandtenantmembershiperrormodel", () => {
  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:invite", "member:update-role", "member:delete"]
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "READY",
    members: [
      { userId: "u-2", organisationId: "org-1", role: "admin", status: "active", username: null, createdAt: "", updatedAt: "", lastLoginAt: null, inviter: null }
    ]
  };

  const res = capability.inviteMember(state, context, null, () => null);
  assert.equal(res.kind, "INVALID_BODY");
  if (res.kind === "INVALID_BODY") {
    assert.equal(res.statusCode, 400);
  }

  const resDemote = capability.updateMemberRole(state, context, { userId: "u-2", role: "member" }, () => null);
  assert.equal(resDemote.kind, "LAST_ADMIN_GUARD_DEMOTE");

  const resRemove = capability.removeMember(state, context, { userId: "u-2" }, () => null);
  assert.equal(resRemove.kind, "LAST_ADMIN_GUARD_REMOVE");
});

test("useridentityandtenantmembershiplifecycle", () => {
  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:invite", "member:update-role"]
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "READY",
    members: [
      { userId: "u-3", organisationId: "org-1", role: "member", status: "invited", username: null, createdAt: "", updatedAt: "", lastLoginAt: null, inviter: null }
    ]
  };

  const resStatus = capability.updateMemberStatus(state, context, { userId: "u-3", status: "active" }, () => null);
  assert.equal(resStatus.kind, "OK");

  const resStatusInvalid = capability.updateMemberStatus(state, context, { userId: "u-3", status: "invited" }, () => null);
  assert.equal(resStatusInvalid.kind, "INVALID_TRANSITION");
});

test("useridentityandtenantmembershippermissions", () => {
  const contextNoPerms: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "viewer",
    permissions: []
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "READY"
  };
  const resList = capability.listMembers(state, contextNoPerms);
  assert.equal(resList.kind, "INVALID_BODY");

  const resInvite = capability.inviteMember(state, contextNoPerms, { email: "a@b.com", role: "member" }, () => null);
  assert.equal(resInvite.kind, "INVALID_BODY");
});

test("useridentityandtenantmembershipproof", () => {
  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:read"]
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "READY"
  };
  const identities = capability.readExternalIdentities(state, context, "u-not-found");
  assert.equal(identities.kind, "NOT_FOUND");
});

test("useridentityandtenantmembershipreadinessmodel", () => {
  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:read", "member:invite"]
  };
  const stateNotReady: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "NOT_READY"
  };
  const resInvite = capability.inviteMember(stateNotReady, context, { email: "a@b.com", role: "member" }, () => null);
  assert.equal(resInvite.kind, "PROVIDER_FAILURE");

  const resList = capability.listMembers(stateNotReady, context);
  assert.equal(resList.kind, "OK");
});

test("useridentityandtenantmembershipstatemodel", () => {
  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:read"]
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    members: [
      { userId: "u-5", organisationId: "org-2", role: "member", status: "active", username: "bob", createdAt: "", updatedAt: "", lastLoginAt: null, inviter: "u-1" }
    ],
    readiness: "READY"
  };
  const res = capability.listMembers(state, context);
  assert.equal(res.kind, "OK");
  if (res.kind === "OK") {
    assert.equal(res.value.length, 0);
  }
});

test("useridentityandtenantmembershipvalidation", () => {
  const context: capability.UserIdentityAndTenantMembershipContext = {
    organisationId: "org-1",
    currentUserId: "u-1",
    currentUserRole: "admin",
    permissions: ["member:invite"]
  };
  const state: capability.UserIdentityAndTenantMembershipState = {
    ...capability.initialState,
    readiness: "READY"
  };

  const resBadEmail = capability.inviteMember(state, context, { email: "not-an-email", role: "member" }, () => null);
  assert.equal(resBadEmail.kind, "INVALID_BODY");

  const resBadRole = capability.inviteMember(state, context, { email: "a@b.com", role: "adminX" }, () => null);
  assert.equal(resBadRole.kind, "INVALID_BODY");

  const resSysAdmin = capability.inviteMember(state, context, { email: "a@b.com", role: "admin" }, () => null);
  assert.equal(resSysAdmin.kind, "CREATED");
});