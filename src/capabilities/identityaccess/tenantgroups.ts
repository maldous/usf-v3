export const TenantGroupsOutcome = [
  'INVALID_NAME',
  'CONFLICT',
  'NOT_FOUND',
  'PROTECTED',
  'OK',
] as const;
export type TenantGroupsOutcome = typeof TenantGroupsOutcome[number];

export const TenantGroupsHttpStatus = [400, 409, 404, 422, 201, 204] as const;
export type TenantGroupsHttpStatus = typeof TenantGroupsHttpStatus[number];

export const TenantGroupsAuditEventKind = [
  'GROUP_CREATED',
  'GROUP_UPDATED',
  'GROUP_DELETED',
] as const;
export type TenantGroupsAuditEventKind = typeof TenantGroupsAuditEventKind[number];

export const TenantGroupsErrorKind = [
  'AUDIT_FAILURE',
  'NO_CREDENTIAL',
  'INVALID_NAME',
  'CONFLICT',
  'NOT_FOUND',
  'PROTECTED',
] as const;
export type TenantGroupsErrorKind = typeof TenantGroupsErrorKind[number];

export const TenantGroupsReadiness = ['INVARIANT_READY', 'DEGRADED', 'NOT_READY'] as const;
export type TenantGroupsReadiness = typeof TenantGroupsReadiness[number];

export const ReservedGroupNames = ['admin', 'users', 'everyone'] as const;
export type ReservedGroupName = typeof ReservedGroupNames[number];

export interface TenantGroupsAuditEvent {
  readonly kind: TenantGroupsAuditEventKind;
  readonly groupId: string;
  readonly groupName: string;
  readonly groupPath: string;
  readonly timestamp: string;
}

export interface TenantGroupsError {
  readonly kind: TenantGroupsErrorKind;
  readonly message: string;
}

export interface TenantGroup {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface TenantGroupsState {
  readonly groups: readonly TenantGroup[];
  readonly readiness: TenantGroupsReadiness;
  readonly lastError: TenantGroupsError | null;
}

export interface TenantCredential {
  readonly realm: string;
  readonly adminAdapter: {
    readonly listGroups: () => Promise<readonly TenantGroup[]>;
    readonly createGroup: (name: string, path: string) => Promise<TenantGroup>;
    readonly updateGroup: (id: string, name: string, path: string) => Promise<TenantGroup>;
    readonly deleteGroup: (id: string) => Promise<void>;
  };
}

export interface TenantGroupsContext {
  readonly tenantCredential: TenantCredential | null;
  readonly permissions: {
    readonly canRead: boolean;
    readonly canCreate: boolean;
    readonly canUpdate: boolean;
    readonly canDelete: boolean;
  };
}

export const initialState: TenantGroupsState = {
  groups: [],
  readiness: 'NOT_READY',
  lastError: null,
};

export function mapOutcomeToHttpStatus(outcome: TenantGroupsOutcome): TenantGroupsHttpStatus {
  switch (outcome) {
    case 'INVALID_NAME': return 400;
    case 'CONFLICT': return 409;
    case 'NOT_FOUND': return 404;
    case 'PROTECTED': return 422;
    case 'OK': return 201;
  }
}

export function isValidGroupName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) {
    return false;
  }
  const hasPathSeparator = name.includes('/') || name.includes('\\');
  const hasControlChar = /[\x00-\x1F\x7F]/.test(name);
  if (hasPathSeparator || hasControlChar) {
    return false;
  }
  const lowerName = name.toLowerCase();
  return !ReservedGroupNames.some(r => r.toLowerCase() === lowerName);
}

export function checkNameConflict(name: string, groups: readonly TenantGroup[]): boolean {
  const lowerName = name.toLowerCase();
  return groups.some(g => g.name.toLowerCase() === lowerName);
}

export function validateGroupName(
  name: string,
  groups: readonly TenantGroup[],
): TenantGroupsOutcome {
  if (!isValidGroupName(name)) {
    return 'INVALID_NAME';
  }
  if (checkNameConflict(name, groups)) {
    return 'CONFLICT';
  }
  return 'OK';
}

export function auditGroupChange(
  kind: TenantGroupsAuditEventKind,
  group: TenantGroup,
  auditFn: (event: TenantGroupsAuditEvent) => TenantGroupsError | null,
): TenantGroupsError | null {
  const event: TenantGroupsAuditEvent = {
    kind,
    groupId: group.id,
    groupName: group.name,
    groupPath: group.path,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function listGroups(
  state: TenantGroupsState,
  context: TenantGroupsContext,
): { readonly groups: readonly TenantGroup[] } | TenantGroupsError {
  if (!context.permissions.canRead) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing read permission' };
  }
  if (context.tenantCredential === null) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing tenant credential' };
  }
  return { groups: state.groups };
}

export function createGroup(
  state: TenantGroupsState,
  context: TenantGroupsContext,
  name: string,
  path: string,
  auditFn: (event: TenantGroupsAuditEvent) => TenantGroupsError | null,
): TenantGroupsState | TenantGroupsError {
  if (!context.permissions.canCreate) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing create permission' };
  }
  if (context.tenantCredential === null) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing tenant credential' };
  }

  const validation = validateGroupName(name, state.groups);
  if (validation !== 'OK') {
    return { kind: validation, message: `Invalid group name: ${name}` };
  }

  const auditError = auditGroupChange('GROUP_CREATED', { id: '', name, path }, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newGroup: TenantGroup = {
    id: `group-${Date.now()}`,
    name,
    path,
  };

  return {
    ...state,
    groups: [...state.groups, newGroup],
    readiness: 'INVARIANT_READY',
    lastError: null,
  };
}

export function updateGroup(
  state: TenantGroupsState,
  context: TenantGroupsContext,
  id: string,
  newName: string,
  newPath: string,
  auditFn: (event: TenantGroupsAuditEvent) => TenantGroupsError | null,
): TenantGroupsState | TenantGroupsError {
  if (!context.permissions.canUpdate) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing update permission' };
  }
  if (context.tenantCredential === null) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing tenant credential' };
  }

  const groupIndex = state.groups.findIndex(g => g.id === id);
  if (groupIndex === -1) {
    return { kind: 'NOT_FOUND', message: `Group not found: ${id}` };
  }

  const existingGroup = state.groups[groupIndex];
  if (ReservedGroupNames.some(r => r.toLowerCase() === newName.toLowerCase())) {
    return { kind: 'PROTECTED', message: `Group name is protected: ${newName}` };
  }

  const validation = validateGroupName(newName, state.groups.filter((_, i) => i !== groupIndex));
  if (validation !== 'OK') {
    return { kind: validation, message: `Invalid group name: ${newName}` };
  }

  const auditError = auditGroupChange('GROUP_UPDATED', { ...existingGroup, name: newName, path: newPath }, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedGroups = [...state.groups];
  updatedGroups[groupIndex] = { ...existingGroup, name: newName, path: newPath };

  return {
    ...state,
    groups: updatedGroups,
    readiness: 'INVARIANT_READY',
    lastError: null,
  };
}

export function deleteGroup(
  state: TenantGroupsState,
  context: TenantGroupsContext,
  id: string,
  auditFn: (event: TenantGroupsAuditEvent) => TenantGroupsError | null,
): TenantGroupsState | TenantGroupsError {
  if (!context.permissions.canDelete) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing delete permission' };
  }
  if (context.tenantCredential === null) {
    return { kind: 'NO_CREDENTIAL', message: 'Missing tenant credential' };
  }

  const groupIndex = state.groups.findIndex(g => g.id === id);
  if (groupIndex === -1) {
    return { kind: 'NOT_FOUND', message: `Group not found: ${id}` };
  }

  const group = state.groups[groupIndex];
  if (ReservedGroupNames.some(r => r.toLowerCase() === group.name.toLowerCase())) {
    return { kind: 'PROTECTED', message: `Group is protected: ${group.name}` };
  }

  const auditError = auditGroupChange('GROUP_DELETED', group, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newGroups = state.groups.filter((_, i) => i !== groupIndex);
  return {
    ...state,
    groups: newGroups,
    readiness: 'INVARIANT_READY',
    lastError: null,
  };
}

export function checkReadiness(
  state: TenantGroupsState,
  context: TenantGroupsContext,
): TenantGroupsReadiness {
  if (context.tenantCredential === null) {
    return 'DEGRADED';
  }
  return state.readiness;
}