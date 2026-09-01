import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/rbacrolesandpermissions.ts";

test("rbacrolesandpermissionsauditmodel", () => {
  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "MEMBER",
    status: "ACTIVE",
  };
  const stateWithMember: capability.RbacRolesAndPermissionsState = {
    ...capability.initialState,
    members: [member],
  };

  const auditFn = (event: capability.RbacRolesAndPermissionsAuditEvent): capability.RbacRolesAndPermissionsError | null => {
    assert.equal(event.kind, "ROLE_ASSIGNED");
    assert.equal(event.userId, "user1");
    assert.equal(event.organisationId, "org1");
    assert.equal(event.previousRole, "MEMBER");
    assert.equal(event.newRole, "MANAGER");
    assert.equal(event.previousStatus, null);
    assert.equal(event.newStatus, null);
    return null;
  };

  const result = capability.updateMemberRole(
    stateWithMember,
    "user1",
    "org1",
    "MANAGER",
    auditFn,
  );
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.state.members[0].role, "MANAGER");

  const failingAuditFn = (_: capability.RbacRolesAndPermissionsAuditEvent): capability.RbacRolesAndPermissionsError | null => {
    return { kind: "AUDIT_FAILURE", message: "Audit failed" };
  };
  const failResult = capability.updateMemberRole(
    stateWithMember,
    "user1",
    "org1",
    "MANAGER",
    failingAuditFn,
  );
  assert.equal(failResult.outcome, "UNPROCESSABLE_ENTITY");
  assert.equal(failResult.error.kind, "AUDIT_FAILURE");
  assert.equal(stateWithMember.members[0].role, "MEMBER");
});

test("rbacrolesandpermissionscontracts", () => {
  const domainVocabulary = capability.RbacRolesAndPermissionsRole;
  const adminContractRoles = ["TENANT_ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;
  assert.ok(
    capability.validateContractDrift(
      domainVocabulary,
      adminContractRoles,
    ),
  );
  const invalidRole = ["TENANT_ADMIN", "MANAGER", "MEMBER", "VIEWER", "INVALID"] as const;
  assert.ok(
    !capability.validateContractDrift(domainVocabulary, invalidRole),
  );
});

test("rbacrolesandpermissionserrormodel", () => {
  const state = capability.initialState;
  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "TENANT_ADMIN",
    status: "ACTIVE",
  };
  const stateWithMember: capability.RbacRolesAndPermissionsState = {
    ...state,
    members: [member],
  };

  const invalidRoleError = capability.validateMemberUpdate(
    stateWithMember,
    "user1",
    "org1",
    "INVALID_ROLE" as capability.RbacRolesAndPermissionsRole,
    null,
  );
  assert.deepEqual(invalidRoleError, { kind: "INVALID_ROLE", message: "Invalid role: INVALID_ROLE" });

  const notFoundError = capability.validateMemberUpdate(
    state,
    "unknown",
    "org1",
    null,
    null,
  );
  assert.deepEqual(notFoundError, { kind: "MEMBERSHIP_NOT_FOUND", message: "Membership not found for user unknown in organisation org1" });

  const lastAdminError = capability.validateMemberUpdate(
    stateWithMember,
    "user1",
    "org1",
    "MEMBER",
    null,
  );
  assert.deepEqual(lastAdminError, { kind: "LAST_ADMIN_VIOLATION", message: "Cannot remove last TENANT_ADMIN" });

  const permissionDeniedError = capability.enforcePermission(
    state,
    "user1",
    "org1",
    "tenant.admin.access",
  );
  assert.deepEqual(permissionDeniedError, { kind: "PERMISSION_DENIED", message: "Permission denied: tenant.admin.access" });
});

test("rbacrolesandpermissionslifecycle", () => {
  const state = capability.initialState;
  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "MEMBER",
    status: "ACTIVE",
  };
  const stateWithMember: capability.RbacRolesAndPermissionsState = {
    ...state,
    members: [member],
  };

  const systemAdminError = capability.validateMemberUpdate(
    stateWithMember,
    "user1",
    "org1",
    "SYSTEM_ADMIN",
    null,
  );
  assert.deepEqual(systemAdminError, { kind: "INVALID_ROLE", message: "SYSTEM_ADMIN cannot be assigned as a tenant role" });

  const permissionsBefore = capability.getMemberPermissions(stateWithMember, "user1", "org1");
  assert.deepEqual(permissionsBefore, ["tenant.members.read"] as const);

  const auditFn = () => null;
  const result = capability.updateMemberRole(stateWithMember, "user1", "org1", "MANAGER", auditFn);
  assert.equal(result.outcome, "SUCCESS");
  const permissionsAfter = capability.getMemberPermissions(result.state, "user1", "org1");
  assert.deepEqual(permissionsAfter, ["tenant.members.read", "tenant.groups.read", "tenant.suborgs.read"] as const);
});

test("rbacrolesandpermissionspermissions", () => {
  const state = capability.initialState;
  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "TENANT_ADMIN",
    status: "ACTIVE",
  };
  const stateWithMember: capability.RbacRolesAndPermissionsState = {
    ...state,
    members: [member],
  };

  assert.ok(capability.checkPermission(stateWithMember, "user1", "org1", "tenant.admin.access"));
  assert.ok(!capability.checkPermission(stateWithMember, "user1", "org1", "platform.admin.access"));
  assert.ok(!capability.checkPermission(stateWithMember, "user1", "org2", "tenant.members.write"));
});

test("rbacrolesandpermissionsproof", () => {
  const domainVocabulary = capability.RbacRolesAndPermissionsRole;
  const adminContractRoles = ["TENANT_ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;
  assert.ok(capability.validateContractDrift(domainVocabulary, adminContractRoles));

  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "MANAGER",
    status: "ACTIVE",
  };
  const state: capability.RbacRolesAndPermissionsState = {
    ...capability.initialState,
    members: [member],
  };
  const permissions = capability.getMemberPermissions(state, "user1", "org1");
  assert.deepEqual(permissions, ["tenant.members.read", "tenant.groups.read", "tenant.suborgs.read"] as const);
});

test("rbacrolesandpermissionsreadinessmodel", () => {
  assert.equal(capability.initialState.readiness, "READY");
  const permissions = capability.resolvePermissions("TENANT_ADMIN");
  assert.deepEqual(permissions, [
    "tenant.admin.access",
    "tenant.members.read",
    "tenant.members.write",
    "tenant.groups.read",
    "tenant.groups.write",
    "tenant.suborgs.read",
    "tenant.suborgs.write",
  ] as const);

  const degradedState = capability.setReadiness(capability.initialState, "DEGRADED");
  assert.equal(degradedState.readiness, "DEGRADED");
  const result = capability.updateMemberRole(degradedState, "user1", "org1", "MEMBER", () => null);
  assert.equal(result.outcome, "UNPROCESSABLE_ENTITY");
  assert.deepEqual(result.error, { kind: "DEGRADED_MODE", message: "Mutation disabled in degraded mode" });
});

test("rbacrolesandpermissionsstatemodel", () => {
  const state = capability.initialState;
  assert.deepEqual(state.rolePermissionMap.get("SYSTEM_ADMIN"), ["platform.admin.access"] as const);
  assert.deepEqual(state.rolePermissionMap.get("TENANT_ADMIN"), [
    "tenant.admin.access",
    "tenant.members.read",
    "tenant.members.write",
    "tenant.groups.read",
    "tenant.groups.write",
    "tenant.suborgs.read",
    "tenant.suborgs.write",
  ] as const);
  assert.deepEqual(state.rolePermissionMap.get("VIEWER"), [] as const);
});

test("rbacrolesandpermissionsvalidation", () => {
  const state = capability.initialState;
  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "MEMBER",
    status: "ACTIVE",
  };
  const stateWithMember: capability.RbacRolesAndPermissionsState = {
    ...state,
    members: [member],
  };

  const systemAdminError = capability.validateMemberUpdate(
    stateWithMember,
    "user1",
    "org1",
    "SYSTEM_ADMIN",
    null,
  );
  assert.deepEqual(systemAdminError, { kind: "INVALID_ROLE", message: "SYSTEM_ADMIN cannot be assigned as a tenant role" });

  const permissions = capability.resolvePermissions("MANAGER");
  assert.deepEqual(permissions, ["tenant.members.read", "tenant.groups.read", "tenant.suborgs.read"] as const);
});