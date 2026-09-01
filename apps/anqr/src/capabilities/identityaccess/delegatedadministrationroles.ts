export const DelegatedAdministrationRolesOutcome = [
  'OK',
  'STATIC_PERMISSION_DENIED',
  'DELEGATION_ALREADY_ACTIVE',
  'NOT_FOUND',
  'FAIL_CLOSED',
] as const;
export type DelegatedAdministrationRolesOutcome = typeof DelegatedAdministrationRolesOutcome[number];

export const DelegatedAdministrationRolesAuditEventKind = [
  'DELEGATION_GRANTED',
  'DELEGATION_REVOKED',
  'DELEGATION_LISTED',
] as const;
export type DelegatedAdministrationRolesAuditEventKind = typeof DelegatedAdministrationRolesAuditEventKind[number];

export const DelegatedAdministrationRolesPermission = [
  'PLATFORM_DELEGATION_READ',
  'PLATFORM_DELEGATION_WRITE',
] as const;
export type DelegatedAdministrationRolesPermission = typeof DelegatedAdministrationRolesPermission[number];

export interface DelegatedAdministrationRolesAuditEvent {
  readonly kind: DelegatedAdministrationRolesAuditEventKind;
  readonly organisationId: string;
  readonly delegationId: string | null;
  readonly granterId: string;
  readonly granteeId: string;
  readonly scope: string;
  readonly timestamp: string;
}

export interface DelegatedAdministrationRolesError {
  readonly kind: 'STATIC_PERMISSION_DENIED' | 'DELEGATION_ALREADY_ACTIVE' | 'NOT_FOUND' | 'FAIL_CLOSED';
  readonly message: string;
}

export interface DelegatedAdministrationRolesDelegation {
  readonly id: string;
  readonly organisationId: string;
  readonly granterId: string;
  readonly granteeId: string;
  readonly scope: string;
  readonly grantedTimestamp: string;
  readonly grantor: string;
  readonly expiryTimestamp: string | null;
  readonly revokedTimestamp: string | null;
  readonly revoker: string | null;
}

export interface DelegatedAdministrationRolesState {
  readonly delegations: readonly DelegatedAdministrationRolesDelegation[];
}

export const initialState: DelegatedAdministrationRolesState = {
  delegations: [],
};

export interface DelegatedAdministrationRolesContext {
  readonly callerId: string;
  readonly callerRoles: readonly string[];
  readonly organisationId: string;
}

export function isDelegationActive(delegation: DelegatedAdministrationRolesDelegation): boolean {
  if (delegation.revokedTimestamp !== null) {
    return false;
  }
  if (delegation.expiryTimestamp !== null) {
    const expiryDate = new Date(delegation.expiryTimestamp);
    const now = new Date();
    return expiryDate > now;
  }
  return true;
}

export function emitAuditBeforeGrant(
  organisationId: string,
  delegationId: string,
  granterId: string,
  granteeId: string,
  scope: string,
  auditFn: (event: DelegatedAdministrationRolesAuditEvent) => DelegatedAdministrationRolesError | null,
): DelegatedAdministrationRolesError | null {
  const event: DelegatedAdministrationRolesAuditEvent = {
    kind: 'DELEGATION_GRANTED',
    organisationId,
    delegationId,
    granterId,
    granteeId,
    scope,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function grantDelegation(
  state: DelegatedAdministrationRolesState,
  context: DelegatedAdministrationRolesContext,
  delegationId: string,
  granteeId: string,
  scope: string,
  expiryTimestamp: string | null,
  auditFn: (event: DelegatedAdministrationRolesAuditEvent) => DelegatedAdministrationRolesError | null,
): { readonly outcome: DelegatedAdministrationRolesOutcome; readonly state: DelegatedAdministrationRolesState } | DelegatedAdministrationRolesError {
  if (!context.callerRoles.includes('system-admin') && !context.callerRoles.includes('tenant-admin')) {
    return { kind: 'STATIC_PERMISSION_DENIED', message: 'Caller lacks permission to grant delegation' };
  }

  const existingActiveDelegation = state.delegations.find(
    (d) =>
      d.organisationId === context.organisationId &&
      d.granteeId === granteeId &&
      d.scope === scope &&
      isDelegationActive(d),
  );

  if (existingActiveDelegation !== undefined) {
    return { kind: 'DELEGATION_ALREADY_ACTIVE', message: 'Active delegation already exists for this grantee and scope' };
  }

  const auditError = emitAuditBeforeGrant(
    context.organisationId,
    delegationId,
    context.callerId,
    granteeId,
    scope,
    auditFn,
  );

  if (auditError !== null) {
    return auditError;
  }

  const now = new Date().toISOString();
  const newDelegation: DelegatedAdministrationRolesDelegation = {
    id: delegationId,
    organisationId: context.organisationId,
    granterId: context.callerId,
    granteeId,
    scope,
    grantedTimestamp: now,
    grantor: context.callerId,
    expiryTimestamp,
    revokedTimestamp: null,
    revoker: null,
  };

  return {
    outcome: 'OK',
    state: {
      ...state,
      delegations: [...state.delegations, newDelegation],
    },
  };
}

export function emitAuditAfterRevoke(
  organisationId: string,
  delegationId: string,
  granterId: string,
  granteeId: string,
  scope: string,
  auditFn: (event: DelegatedAdministrationRolesAuditEvent) => DelegatedAdministrationRolesError | null,
): DelegatedAdministrationRolesError | null {
  const event: DelegatedAdministrationRolesAuditEvent = {
    kind: 'DELEGATION_REVOKED',
    organisationId,
    delegationId,
    granterId,
    granteeId,
    scope,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function revokeDelegation(
  state: DelegatedAdministrationRolesState,
  context: DelegatedAdministrationRolesContext,
  delegationId: string,
  auditFn: (event: DelegatedAdministrationRolesAuditEvent) => DelegatedAdministrationRolesError | null,
): { readonly outcome: DelegatedAdministrationRolesOutcome; readonly state: DelegatedAdministrationRolesState } | DelegatedAdministrationRolesError {
  if (!context.callerRoles.includes('system-admin')) {
    return { kind: 'STATIC_PERMISSION_DENIED', message: 'Caller lacks permission to revoke delegation' };
  }

  const delegationIndex = state.delegations.findIndex(
    (d) => d.id === delegationId && d.organisationId === context.organisationId,
  );

  if (delegationIndex === -1) {
    return { kind: 'NOT_FOUND', message: 'Delegation not found' };
  }

  const delegation = state.delegations[delegationIndex];
  if (!isDelegationActive(delegation)) {
    return { kind: 'NOT_FOUND', message: 'Delegation is not active' };
  }

  const now = new Date().toISOString();
  const updatedDelegations = [...state.delegations];
  updatedDelegations[delegationIndex] = {
    ...delegation,
    revokedTimestamp: now,
    revoker: context.callerId,
  };

  const newState = {
    ...state,
    delegations: updatedDelegations,
  };

  const auditError = emitAuditAfterRevoke(
    context.organisationId,
    delegationId,
    delegation.granterId,
    delegation.granteeId,
    delegation.scope,
    auditFn,
  );

  if (auditError !== null) {
    return auditError;
  }

  return { outcome: 'OK', state: newState };
}

export function emitAuditList(
  organisationId: string,
  auditFn: (event: DelegatedAdministrationRolesAuditEvent) => DelegatedAdministrationRolesError | null,
): DelegatedAdministrationRolesError | null {
  const event: DelegatedAdministrationRolesAuditEvent = {
    kind: 'DELEGATION_LISTED',
    organisationId,
    delegationId: null,
    granterId: '',
    granteeId: '',
    scope: '',
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function listDelegations(
  state: DelegatedAdministrationRolesState,
  context: DelegatedAdministrationRolesContext,
  auditFn: (event: DelegatedAdministrationRolesAuditEvent) => DelegatedAdministrationRolesError | null,
): { readonly outcome: DelegatedAdministrationRolesOutcome; readonly delegations: readonly DelegatedAdministrationRolesDelegation[] } | DelegatedAdministrationRolesError {
  if (!context.callerRoles.includes('PLATFORM_DELEGATION_READ') && !context.callerRoles.includes('system-admin') && !context.callerRoles.includes('tenant-admin')) {
    return { kind: 'STATIC_PERMISSION_DENIED', message: 'Caller lacks permission to list delegations' };
  }

  let delegations: readonly DelegatedAdministrationRolesDelegation[];
  if (context.callerRoles.includes('system-admin') || context.callerRoles.includes('tenant-admin')) {
    delegations = state.delegations.filter(
      (d) => d.organisationId === context.organisationId,
    );
  } else {
    delegations = state.delegations.filter(
      (d) => d.organisationId === context.organisationId && d.granteeId === context.callerId && isDelegationActive(d),
    );
  }

  const auditError = emitAuditList(context.organisationId, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  return { outcome: 'OK', delegations };
}

export function getDelegation(
  state: DelegatedAdministrationRolesState,
  context: DelegatedAdministrationRolesContext,
  delegationId: string,
): { readonly outcome: DelegatedAdministrationRolesOutcome; readonly delegation: DelegatedAdministrationRolesDelegation | null } | DelegatedAdministrationRolesError {
  if (!context.callerRoles.includes('system-admin') && !context.callerRoles.includes('tenant-admin')) {
    const delegation = state.delegations.find(
      (d) => d.id === delegationId && d.organisationId === context.organisationId && d.granteeId === context.callerId && isDelegationActive(d),
    );
    if (delegation === undefined) {
      return { kind: 'NOT_FOUND', message: 'Delegation not found or not active for caller' };
    }
    return { outcome: 'OK', delegation };
  }

  const delegation = state.delegations.find(
    (d) => d.id === delegationId && d.organisationId === context.organisationId,
  );
  if (delegation === undefined) {
    return { kind: 'NOT_FOUND', message: 'Delegation not found' };
  }
  return { outcome: 'OK', delegation };
}