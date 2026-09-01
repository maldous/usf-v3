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
  'PERMISSION_DENIED',
  'DEGRADED_MODE',
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

export interface RbacRolesAndPermissionsMemberUpdateSuccess {
  readonly outcome: 'SUCCESS';
  readonly state: RbacRolesAndPermissionsState;
}

export interface RbacRolesAndPermissionsMemberUpdateFailure {
  readonly outcome: RbacRolesAndPermissionsOutcome;
  readonly error: RbacRolesAndPermissionsError;
}

export type RbacRolesAndPermissionsMemberUpdateResult =
  | RbacRolesAndPermissionsMemberUpdateSuccess
  | RbacRolesAndPermissionsMemberUpdateFailure;

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
  if (userId === undefined || organisationId === undefined) {
    return { kind: 'INVALID_ROLE', message: 'User ID and organisation ID are required' };
  }

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

function errorToOutcome(error: RbacRolesAndPermissionsError): RbacRolesAndPermissionsOutcome {
  switch (error.kind) {
    case 'INVALID_ROLE':
      return 'INVALID_BODY';
    case 'MEMBERSHIP_NOT_FOUND':
      return 'NOT_FOUND';
    case 'LAST_ADMIN_VIOLATION':
    case 'AUDIT_FAILURE':
    case 'PERMISSION_DENIED':
    case 'DEGRADED_MODE':
      return 'UNPROCESSABLE_ENTITY';
    default:
      return 'UNPROCESSABLE_ENTITY';
  }
}

export function updateMemberRole(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
  newRole: RbacRolesAndPermissionsRole,
  auditFn: (event: RbacRolesAndPermissionsAuditEvent) => RbacRolesAndPermissionsError | null,
): RbacRolesAndPermissionsMemberUpdateResult {
  if (state.readiness === 'DEGRADED') {
    const error: RbacRolesAndPermissionsError = { kind: 'DEGRADED_MODE', message: 'Mutation disabled in degraded mode' };
    return { outcome: errorToOutcome(error), error };
  }

  const validationError = validateMemberUpdate(state, userId, organisationId, newRole, null);
  if (validationError !== null) {
    return { outcome: errorToOutcome(validationError), error: validationError };
  }

  const existingMember = state.members.find(
    (m) => m.userId === userId && m.organisationId === organisationId,
  );

  if (existingMember === undefined) {
    const error: RbacRolesAndPermissionsError = { kind: 'MEMBERSHIP_NOT_FOUND', message: `Membership not found for user ${userId} in organisation ${organisationId}` };
    return { outcome: 'NOT_FOUND', error };
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
    return { outcome: errorToOutcome(auditError), error: auditError };
  }

  const updatedMembers = state.members.map((m) =>
    m.userId === userId && m.organisationId === organisationId ? { ...m, role: newRole } : m,
  );

  const newState: RbacRolesAndPermissionsState = {
    ...state,
    members: updatedMembers,
    lastAuditError: null,
  };

  return { outcome: 'SUCCESS', state: newState };
}

export function updateMemberStatus(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
  newStatus: RbacRolesAndPermissionsMembershipStatus,
  auditFn: (event: RbacRolesAndPermissionsAuditEvent) => RbacRolesAndPermissionsError | null,
): RbacRolesAndPermissionsMemberUpdateResult {
  if (state.readiness === 'DEGRADED') {
    const error: RbacRolesAndPermissionsError = { kind: 'DEGRADED_MODE', message: 'Mutation disabled in degraded mode' };
    return { outcome: errorToOutcome(error), error };
  }

  const validationError = validateMemberUpdate(state, userId, organisationId, null, newStatus);
  if (validationError !== null) {
    return { outcome: errorToOutcome(validationError), error: validationError };
  }

  const existingMember = state.members.find(
    (m) => m.userId === userId && m.organisationId === organisationId,
  );

  if (existingMember === undefined) {
    const error: RbacRolesAndPermissionsError = { kind: 'MEMBERSHIP_NOT_FOUND', message: `Membership not found for user ${userId} in organisation ${organisationId}` };
    return { outcome: 'NOT_FOUND', error };
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
    return { outcome: errorToOutcome(auditError), error: auditError };
  }

  const updatedMembers = state.members.map((m) =>
    m.userId === userId && m.organisationId === organisationId ? { ...m, status: newStatus } : m,
  );

  const newState: RbacRolesAndPermissionsState = {
    ...state,
    members: updatedMembers,
    lastAuditError: null,
  };

  return { outcome: 'SUCCESS', state: newState };
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

export function enforcePermission(
  state: RbacRolesAndPermissionsState,
  userId: string,
  organisationId: string,
  requiredPermission: RbacRolesAndPermissionsPermission,
): RbacRolesAndPermissionsError | null {
  if (!checkPermission(state, userId, organisationId, requiredPermission)) {
    return { kind: 'PERMISSION_DENIED', message: `Permission denied: ${requiredPermission}` };
  }
  return null;
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

export function setReadiness(
  state: RbacRolesAndPermissionsState,
  readiness: 'READY' | 'DEGRADED',
): RbacRolesAndPermissionsState {
  return { ...state, readiness };
}

export function isReady(state: RbacRolesAndPermissionsState): boolean {
  return state.readiness === 'READY';
}