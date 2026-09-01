export const RbacRolesAndPermissionsRole = [
  'SYSTEM_ADMIN',
  'TENANT_ADMIN',
  'MANAGER',
  'MEMBER',
  'VIEWER',
] as const;
export type RbacRolesAndPermissionsRole = typeof RbacRolesAndPermissionsRole[number];

export const RbacRolesAndPermissionsMembershipStatus = [
  'ACTIVE',
  'DISABLED',
] as const;
export type RbacRolesAndPermissionsMembershipStatus = typeof RbacRolesAndPermissionsMembershipStatus[number];

export const RbacRolesAndPermissionsPermission = [
  'platform.admin.access',
  'tenant.admin.access',
  'tenant.members.read',
  'tenant.members.write',
  'tenant.groups.read',
  'tenant.groups.write',
  'tenant.suborgs.read',
  'tenant.suborgs.write',
] as const;
export type RbacRolesAndPermissionsPermission = typeof RbacRolesAndPermissionsPermission[number];

export const RbacRolesAndPermissionsOutcome = [
  'SUCCESS',
  'INVALID_BODY',
  'NOT_FOUND',
  'UNPROCESSABLE_ENTITY',
] as const;
export type RbacRolesAndPermissionsOutcome = typeof RbacRolesAndPermissionsOutcome[number];

export const RbacRolesAndPermissionsAuditEventKind = [
  'ROLE_ASSIGNED',
  'ROLE_REVOKED',
  'STATUS_CHANGED',
] as const;
export type RbacRolesAndPermissionsAuditEventKind = typeof RbacRolesAndPermissionsAuditEventKind[number];

export const RbacRolesAndPermissionsErrorKind = [
  'AUDIT_FAILURE',
  'INVALID_ROLE',
  'LAST_ADMIN_VIOLATION',
  'MEMBERSHIP_NOT_FOUND',
] as const;
export type RbacRolesAndPermissionsErrorKind = typeof RbacRolesAndPermissionsErrorKind[number];

export interface RbacRolesAndPermissionsAuditEvent {
  readonly kind: RbacRolesAndPermissionsAuditEventKind;
  readonly userId: string;
  readonly organisationId: string;
  readonly previousRole: RbacRolesAndPermissionsRole | null;
  readonly newRole: RbacRolesAndPermissionsRole | null;
  readonly previousStatus: RbacRolesAndPermissionsMembershipStatus | null;
  readonly newStatus: RbacRolesAndPermissionsMembershipStatus | null;
  readonly timestamp: string;
}

export interface RbacRolesAndPermissionsError {
  readonly kind: RbacRolesAndPermissionsErrorKind;
  readonly message: string;
}

export interface RbacRolesAndPermissionsMember {
  readonly userId: string;
  readonly organisationId: string;
  readonly role: RbacRolesAndPermissionsRole;
  readonly status: RbacRolesAndPermissionsMembershipStatus;
}

export interface RbacRolesAndPermissionsState {
  readonly members: readonly RbacRolesAndPermissionsMember[];
  readonly rolePermissionMap: ReadonlyMap<RbacRolesAndPermissionsRole, readonly RbacRolesAndPermissionsPermission[]>;
  readonly lastAuditError: RbacRolesAndPermissionsError | null;
  readonly readiness: 'READY' | 'DEGRADED';
}

export const initialState: RbacRolesAndPermissionsState = {
  members: [],
  rolePermissionMap: new Map<RbacRolesAndPermissionsRole, readonly RbacRolesAndPermissionsPermission[]>([
    ['SYSTEM_ADMIN', ['platform.admin.access']],
    ['TENANT_ADMIN', ['tenant.admin.access', 'tenant.members.read', 'tenant.members.write', 'tenant.groups.read', 'tenant.groups.write', 'tenant.suborgs.read', 'tenant.suborgs.write']],
    ['MANAGER', ['tenant.members.read', 'tenant.groups.read', 'tenant.suborgs.read']],
    ['MEMBER', ['tenant.members.read']],
    ['VIEWER', []],
  ]),
  lastAuditError: null,
  readiness: 'READY',
};

export const rolePermissionMap: ReadonlyMap<RbacRolesAndPermissionsRole, readonly RbacRolesAndPermissionsPermission[]> =
  initialState.rolePermissionMap;

export function resolvePermissions(
  role: RbacRolesAndPermissionsRole,
): readonly RbacRolesAndPermissionsPermission[] {
  const permissions = rolePermissionMap.get(role);
  if (permissions === undefined) {
    throw new Error(`Unknown role: ${role}`);
  }
  return permissions;
}

export function validateMemberUpdate(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
  newRole: RbacRolesAndPermissionsRole | null,
  newStatus: RbacRolesAndPermissionsMembershipStatus | null,
): RbacRolesAndPermissionsError | null {
  if (newRole !== null && !RbacRolesAndPermissionsRole.includes(newRole)) {
    return { kind: 'INVALID_ROLE', message: `Invalid role: ${newRole}` };
  }

  if (newRole === 'SYSTEM_ADMIN') {
    return { kind: 'INVALID_ROLE', message: 'SYSTEM_ADMIN cannot be assigned as a tenant role' };
  }

  const existingMember = state.members.find(
    (m) => m.userId === userId && m.organisationId === organisationId,
  );

  if (existingMember === undefined && newRole === null && newStatus === null) {
    return { kind: 'MEMBERSHIP_NOT_FOUND', message: `Membership not found for user ${userId} in organisation ${organisationId}` };
  }

  if (newRole !== null && newStatus !== null) {
    return { kind: 'INVALID_ROLE', message: 'Cannot update both role and status simultaneously' };
  }

  if (newRole !== null) {
    const tenantAdmins = state.members.filter(
      (m) => m.organisationId === organisationId && m.role === 'TENANT_ADMIN' && m.status === 'ACTIVE',
    );

    if (tenantAdmins.length === 1 && existingMember?.role === 'TENANT_ADMIN' && newRole !== 'TENANT_ADMIN') {
      return { kind: 'LAST_ADMIN_VIOLATION', message: 'Cannot remove last TENANT_ADMIN' };
    }
  }

  if (newStatus !== null && newStatus === 'DISABLED') {
    const tenantAdmins = state.members.filter(
      (m) => m.organisationId === organisationId && m.role === 'TENANT_ADMIN' && m.status === 'ACTIVE',
    );

    if (tenantAdmins.length === 1 && existingMember?.role === 'TENANT_ADMIN') {
      return { kind: 'LAST_ADMIN_VIOLATION', message: 'Cannot disable last TENANT_ADMIN' };
    }
  }

  return null;
}

export function updateMemberRole(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
  newRole: RbacRolesAndPermissionsRole,
  auditFn: (event: RbacRolesAndPermissionsAuditEvent) => RbacRolesAndPermissionsError | null,
): { readonly outcome: RbacRolesAndPermissionsOutcome } | RbacRolesAndPermissionsError {
  const validationError = validateMemberUpdate(state, userId, organisationId, newRole, null);
  if (validationError !== null) {
    return validationError;
  }

  const existingMember = state.members.find(
    (m) => m.userId === userId && m.organisationId === organisationId,
  );

  if (existingMember === undefined) {
    return { kind: 'MEMBERSHIP_NOT_FOUND', message: `Membership not found for user ${userId} in organisation ${organisationId}` };
  }

  const auditEvent: RbacRolesAndPermissionsAuditEvent = {
    kind: 'ROLE_ASSIGNED',
    userId,
    organisationId,
    previousRole: existingMember.role,
    newRole,
    previousStatus: null,
    newStatus: null,
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const updatedMembers = state.members.map((m) =>
    m.userId === userId && m.organisationId === organisationId ? { ...m, role: newRole } : m,
  );

  return {
    outcome: 'SUCCESS',
    ...state,
    members: updatedMembers,
    lastAuditError: null,
  };
}

export function updateMemberStatus(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
  newStatus: RbacRolesAndPermissionsMembershipStatus,
  auditFn: (event: RbacRolesAndPermissionsAuditEvent) => RbacRolesAndPermissionsError | null,
): { readonly outcome: RbacRolesAndPermissionsOutcome } | RbacRolesAndPermissionsError {
  const validationError = validateMemberUpdate(state, userId, organisationId, null, newStatus);
  if (validationError !== null) {
    return validationError;
  }

  const existingMember = state.members.find(
    (m) => m.userId === userId && m.organisationId === organisationId,
  );

  if (existingMember === undefined) {
    return { kind: 'MEMBERSHIP_NOT_FOUND', message: `Membership not found for user ${userId} in organisation ${organisationId}` };
  }

  const auditEvent: RbacRolesAndPermissionsAuditEvent = {
    kind: 'STATUS_CHANGED',
    userId,
    organisationId,
    previousRole: null,
    newRole: null,
    previousStatus: existingMember.status,
    newStatus,
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const updatedMembers = state.members.map((m) =>
    m.userId === userId && m.organisationId === organisationId ? { ...m, status: newStatus } : m,
  );

  return {
    outcome: 'SUCCESS',
    ...state,
    members: updatedMembers,
    lastAuditError: null,
  };
}

export function getMemberPermissions(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
): readonly RbacRolesAndPermissionsPermission[] | null {
  const member = state.members.find(
    (m) => m.userId === userId && m.organisationId === organisationId && m.status === 'ACTIVE',
  );

  if (member === undefined) {
    return null;
  }

  return resolvePermissions(member.role);
}

export function checkPermission(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
  requiredPermission: RbacRolesAndPermissionsPermission,
): boolean {
  const permissions = getMemberPermissions(state, userId, organisationId);
  if (permissions === null) {
    return false;
  }
  return permissions.includes(requiredPermission);
}

export function validateContractDrift(
  domainVocabulary: readonly RbacRolesAndPermissionsRole[],
  adminContractRoles: readonly string[],
): boolean {
  const domainSet = new Set(domainVocabulary);
  const contractSet = new Set(adminContractRoles);

  for (const role of domainVocabulary) {
    if (role === 'SYSTEM_ADMIN') continue;
    if (!contractSet.has(role)) {
      return false;
    }
  }

  for (const role of adminContractRoles) {
    if (!domainSet.has(role as RbacRolesAndPermissionsRole)) {
      return false;
    }
  }

  return true;
}