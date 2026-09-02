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
  if ("state" in result) {
    assert.equal(result.state.members[0].role, "MANAGER");
  }

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
  if ("error" in failResult) {
    assert.equal(failResult.error.kind, "AUDIT_FAILURE");
  }
  assert.equal(stateWithMember.members[0].role, "MEMBER");

  const statusAuditFn = (event: capability.RbacRolesAndPermissionsAuditEvent): capability.RbacRolesAndPermissionsError | null => {
    assert.equal(event.kind, "STATUS_CHANGED");
    assert.equal(event.userId, "user1");
    assert.equal(event.organisationId, "org1");
    assert.equal(event.previousRole, null);
    assert.equal(event.newRole, null);
    assert.equal(event.previousStatus, "ACTIVE");
    assert.equal(event.newStatus, "DISABLED");
    return null;
  };
  const statusResult = capability.updateMemberStatus(
    stateWithMember,
    "user1",
    "org1",
    "DISABLED",
    statusAuditFn,
  );
  assert.equal(statusResult.outcome, "SUCCESS");
  if ("state" in statusResult) {
    assert.equal(statusResult.state.members[0].status, "DISABLED");
  }
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

  const rejectResult = capability.updateMemberRole(
    stateWithMember,
    "user1",
    "org1",
    "INVALID_ROLE" as capability.RbacRolesAndPermissionsRole,
    () => null,
  );
  assert.equal(rejectResult.outcome, "INVALID_BODY");
  if ("error" in rejectResult) {
    assert.equal(rejectResult.error.kind, "INVALID_ROLE");
  }
  assert.equal(stateWithMember.members[0].role, "TENANT_ADMIN");
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
  assert.deepEqual(permissionsBefore, ["tenant.members.read"]);

  const auditFn = () => null;
  const result = capability.updateMemberRole(stateWithMember, "user1", "org1", "MANAGER", auditFn);
  assert.equal(result.outcome, "SUCCESS");
  if ("state" in result) {
    const permissionsAfter = capability.getMemberPermissions(result.state, "user1", "org1");
    assert.deepEqual(permissionsAfter, ["tenant.members.read", "tenant.groups.read", "tenant.suborgs.read"]);
  }
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

  const error = capability.enforcePermission(stateWithMember, "user1", "org1", "platform.admin.access");
  assert.deepEqual(error, { kind: "PERMISSION_DENIED", message: "Permission denied: platform.admin.access" });
});

test("rbacrolesandpermissionsproof", () => {
  const domainVocabulary = capability.RbacRolesAndPermissionsRole;
  const adminContractRoles = ["TENANT_ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;
  assert.ok(capability.validateContractDrift(domainVocabulary, adminContractRoles));

  assert.deepEqual(capability.resolvePermissions("SYSTEM_ADMIN"), ["platform.admin.access"]);
  assert.deepEqual(capability.resolvePermissions("TENANT_ADMIN"), [
    "tenant.admin.access",
    "tenant.members.read",
    "tenant.members.write",
    "tenant.groups.read",
    "tenant.groups.write",
    "tenant.suborgs.read",
    "tenant.suborgs.write",
  ]);
  assert.deepEqual(capability.resolvePermissions("MANAGER"), ["tenant.members.read", "tenant.groups.read", "tenant.suborgs.read"]);
  assert.deepEqual(capability.resolvePermissions("MEMBER"), ["tenant.members.read"]);
  assert.deepEqual(capability.resolvePermissions("VIEWER"), []);

  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "MEMBER",
    status: "ACTIVE",
  };
  const state: capability.RbacRolesAndPermissionsState = {
    ...capability.initialState,
    members: [member],
  };
  const result = capability.updateMemberRole(state, "user1", "org1", "MANAGER", () => null);
  assert.equal(result.outcome, "SUCCESS");
  if ("state" in result) {
    const perms = capability.getMemberPermissions(result.state, "user1", "org1");
    assert.deepEqual(perms, ["tenant.members.read", "tenant.groups.read", "tenant.suborgs.read"]);
  }
});

test("rbacrolesandpermissionsreadinessmodel", () => {
  assert.equal(capability.initialState.readiness, "READY");

  const perms = capability.resolvePermissions("TENANT_ADMIN");
  assert.deepEqual(perms, [
    "tenant.admin.access",
    "tenant.members.read",
    "tenant.members.write",
    "tenant.groups.read",
    "tenant.groups.write",
    "tenant.suborgs.read",
    "tenant.suborgs.write",
  ]);

  const degradedState = capability.setReadiness(capability.initialState, "DEGRADED");
  assert.equal(degradedState.readiness, "DEGRADED");
  const result = capability.updateMemberRole(degradedState, "user1", "org1", "MEMBER", () => null);
  assert.equal(result.outcome, "UNPROCESSABLE_ENTITY");
  if ("error" in result) {
    assert.deepEqual(result.error, { kind: "DEGRADED_MODE", message: "Mutation disabled in degraded mode" });
  }

  const member: capability.RbacRolesAndPermissionsMember = {
    userId: "user1",
    organisationId: "org1",
    role: "MEMBER",
    status: "ACTIVE",
  };
  const stateWithMember: capability.RbacRolesAndPermissionsState = {
    ...degradedState,
    members: [member],
  };
  assert.ok(capability.checkPermission(stateWithMember, "user1", "org1", "tenant.members.read"));
});

test("rbacrolesandpermissionsstatemodel", () => {
  const state = capability.initialState;

  assert.deepEqual(state.rolePermissionMap.get("SYSTEM_ADMIN"), ["platform.admin.access"]);
  assert.deepEqual(state.rolePermissionMap.get("TENANT_ADMIN"), [
    "tenant.admin.access",
    "tenant.members.read",
    "tenant.members.write",
    "tenant.groups.read",
    "tenant.groups.write",
    "tenant.suborgs.read",
    "tenant.suborgs.write",
  ]);
  assert.deepEqual(state.rolePermissionMap.get("MANAGER"), ["tenant.members.read", "tenant.groups.read", "tenant.suborgs.read"]);
  assert.deepEqual(state.rolePermissionMap.get("MEMBER"), ["tenant.members.read"]);
  assert.deepEqual(state.rolePermissionMap.get("VIEWER"), []);

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
  assert.equal(stateWithMember.members[0].status, "ACTIVE");

  const perms = capability.getMemberPermissions(stateWithMember, "user1", "org1");
  assert.deepEqual(perms, ["tenant.members.read"]);
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

  const missingIdError = capability.validateMemberUpdate(
    stateWithMember,
    undefined as unknown as string,
    "org1",
    "MEMBER",
    null,
  );
  assert.deepEqual(missingIdError, { kind: "INVALID_ROLE", message: "User ID and organisation ID are required" });

  const systemAdminError = capability.validateMemberUpdate(
    stateWithMember,
    "user1",
    "org1",
    "SYSTEM_ADMIN",
    null,
  );
  assert.deepEqual(systemAdminError, { kind: "INVALID_ROLE", message: "SYSTEM_ADMIN cannot be assigned as a tenant role" });

  const unknownRoleError = capability.validateMemberUpdate(
    stateWithMember,
    "user1",
    "org1",
    "UNKNOWN" as capability.RbacRolesAndPermissionsRole,
    null,
  );
  assert.deepEqual(unknownRoleError, { kind: "INVALID_ROLE", message: "Invalid role: UNKNOWN" });

  assert.deepEqual(capability.resolvePermissions("SYSTEM_ADMIN"), ["platform.admin.access"]);
  assert.deepEqual(capability.resolvePermissions("TENANT_ADMIN"), [
    "tenant.admin.access",
    "tenant.members.read",
    "tenant.members.write",
    "tenant.groups.read",
    "tenant.groups.write",
    "tenant.suborgs.read",
    "tenant.suborgs.write",
  ]);
});