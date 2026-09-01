export const TenantLifecycleOperation = [
  'PROVISION',
  'SUSPEND',
  'DELETE',
  'EXPORT',
  'IMPORT',
] as const;
export type TenantLifecycleOperation = typeof TenantLifecycleOperation[number];

export const TenantLifecycleSubsystem = [
  'DATA',
  'STORAGE',
  'REALM',
  'DSR',
] as const;
export type TenantLifecycleSubsystem = typeof TenantLifecycleSubsystem[number];

export const TenantLifecycleState = [
  'ACTIVE',
  'SUSPENDED',
  'DELETED',
  'EXPORTED',
] as const;
export type TenantLifecycleState = typeof TenantLifecycleState[number];

export const TenantLifecycleAuditEventKind = [
  'AUDIT_BEFORE_PROVISION',
  'AUDIT_BEFORE_SUSPEND',
  'AUDIT_BEFORE_DELETE',
  'AUDIT_BEFORE_EXPORT',
  'AUDIT_BEFORE_IMPORT',
] as const;
export type TenantLifecycleAuditEventKind = typeof TenantLifecycleAuditEventKind[number];

export const TenantLifecycleErrorKind = [
  'AUDIT_FAILURE',
  'INVALID_TENANT_ID',
  'PERMISSION_DENIED',
  'SUBSYSTEM_FAILURE',
  'EXPORT_FAILURE',
  'DELETION_HALTED',
] as const;
export type TenantLifecycleErrorKind = typeof TenantLifecycleErrorKind[number];

export const TenantLifecycleReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type TenantLifecycleReadiness = typeof TenantLifecycleReadiness[number];

export interface TenantLifecycleAuditEvent {
  readonly kind: TenantLifecycleAuditEventKind;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly operation: TenantLifecycleOperation;
  readonly timestamp: string;
}

export interface TenantLifecycleError {
  readonly kind: TenantLifecycleErrorKind;
  readonly message: string;
  readonly subsystem?: TenantLifecycleSubsystem;
}

export interface TenantLifecycleExportMetadata {
  readonly digest: string;
  readonly keyReference: string;
}

export interface TenantLifecycleStateRepresentation {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly state: TenantLifecycleState;
  readonly exportMetadata: TenantLifecycleExportMetadata | null;
  readonly suspendedSubsystems: readonly TenantLifecycleSubsystem[];
  readonly deletedSubsystems: readonly TenantLifecycleSubsystem[];
}

export interface TenantLifecycleCoordinatorState {
  readonly tenants: readonly TenantLifecycleStateRepresentation[];
  readonly lastAuditEvent: TenantLifecycleAuditEvent | null;
  readonly lastError: TenantLifecycleError | null;
  readonly readiness: TenantLifecycleReadiness;
}

export const initialState: TenantLifecycleCoordinatorState = {
  tenants: [],
  lastAuditEvent: null,
  lastError: null,
  readiness: 'NOT_READY',
};

export function validateTenantId(tenantId: string): boolean {
  return tenantId.length > 0 && tenantId.length <= 64 && /^[a-zA-Z0-9-]+$/.test(tenantId);
}

export function validateOrganisationId(organisationId: string): boolean {
  return organisationId.length > 0 && organisationId.length <= 64 && /^[a-zA-Z0-9-]+$/.test(organisationId);
}

export function auditTenantLifecycleOperation(
  tenantId: string,
  organisationId: string,
  operation: TenantLifecycleOperation,
  auditFn: (event: TenantLifecycleAuditEvent) => TenantLifecycleError | null,
): TenantLifecycleError | null {
  const event: TenantLifecycleAuditEvent = {
    kind: `AUDIT_BEFORE_${operation.toUpperCase()}` as TenantLifecycleAuditEventKind,
    tenantId,
    organisationId,
    operation,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function provisionTenant(
  state: TenantLifecycleCoordinatorState,
  tenantId: string,
  organisationId: string,
  auditFn: (event: TenantLifecycleAuditEvent) => TenantLifecycleError | null,
): TenantLifecycleCoordinatorState | TenantLifecycleError {
  if (!validateTenantId(tenantId) || !validateOrganisationId(organisationId)) {
    return {
      kind: 'INVALID_TENANT_ID',
      message: 'Invalid tenant or organisation identifier',
    };
  }

  const auditError = auditTenantLifecycleOperation(
    tenantId,
    organisationId,
    'PROVISION',
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const existingTenant = state.tenants.find((t) => t.tenantId === tenantId);
  if (existingTenant !== undefined) {
    return {
      kind: 'SUBSYSTEM_FAILURE',
      message: 'Tenant already exists',
    };
  }

  const newTenant: TenantLifecycleStateRepresentation = {
    tenantId,
    organisationId,
    state: 'ACTIVE',
    exportMetadata: null,
    suspendedSubsystems: [],
    deletedSubsystems: [],
  };

  return {
    ...state,
    tenants: [...state.tenants, newTenant],
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_PROVISION',
      tenantId,
      organisationId,
      operation: 'PROVISION',
      timestamp: new Date().toISOString(),
    },
    lastError: null,
    readiness: 'READY',
  };
}

export function suspendTenant(
  state: TenantLifecycleCoordinatorState,
  tenantId: string,
  organisationId: string,
  auditFn: (event: TenantLifecycleAuditEvent) => TenantLifecycleError | null,
  subsystemSuspendFn: (subsystem: TenantLifecycleSubsystem) => TenantLifecycleError | null,
): TenantLifecycleCoordinatorState | TenantLifecycleError {
  if (!validateTenantId(tenantId) || !validateOrganisationId(organisationId)) {
    return {
      kind: 'INVALID_TENANT_ID',
      message: 'Invalid tenant or organisation identifier',
    };
  }

  const auditError = auditTenantLifecycleOperation(
    tenantId,
    organisationId,
    'SUSPEND',
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const tenant = state.tenants.find((t) => t.tenantId === tenantId);
  if (tenant === undefined) {
    return {
      kind: 'SUBSYSTEM_FAILURE',
      message: 'Tenant not found',
    };
  }

  if (tenant.state !== 'ACTIVE') {
    return {
      kind: 'SUBSYSTEM_FAILURE',
      message: 'Tenant is not in ACTIVE state',
    };
  }

  const subsystems: TenantLifecycleSubsystem[] = ['DATA', 'STORAGE', 'REALM', 'DSR'];
  const suspendedSubsystems: TenantLifecycleSubsystem[] = [];
  for (const subsystem of subsystems) {
    const error = subsystemSuspendFn(subsystem);
    if (error !== null) {
      return {
        kind: 'SUBSYSTEM_FAILURE',
        message: `Failed to suspend subsystem ${subsystem}`,
        subsystem,
      };
    }
    suspendedSubsystems.push(subsystem);
  }

  const updatedTenant: TenantLifecycleStateRepresentation = {
    ...tenant,
    state: 'SUSPENDED',
    suspendedSubsystems,
  };

  const updatedTenants = state.tenants.map((t) =>
    t.tenantId === tenantId ? updatedTenant : t,
  );

  return {
    ...state,
    tenants: updatedTenants,
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_SUSPEND',
      tenantId,
      organisationId,
      operation: 'SUSPEND',
      timestamp: new Date().toISOString(),
    },
    lastError: null,
    readiness: 'READY',
  };
}

export function exportTenant(
  state: TenantLifecycleCoordinatorState,
  tenantId: string,
  organisationId: string,
  auditFn: (event: TenantLifecycleAuditEvent) => TenantLifecycleError | null,
): TenantLifecycleCoordinatorState | TenantLifecycleError {
  if (!validateTenantId(tenantId) || !validateOrganisationId(organisationId)) {
    return {
      kind: 'INVALID_TENANT_ID',
      message: 'Invalid tenant or organisation identifier',
    };
  }

  const auditError = auditTenantLifecycleOperation(
    tenantId,
    organisationId,
    'EXPORT',
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const tenant = state.tenants.find((t) => t.tenantId === tenantId);
  if (tenant === undefined) {
    return {
      kind: 'EXPORT_FAILURE',
      message: 'Tenant not found',
    };
  }

  const exportMetadata: TenantLifecycleExportMetadata = {
    digest: `export-digest-${tenantId}-${Date.now()}`,
    keyReference: `export-key-${tenantId}-${Date.now()}`,
  };

  const updatedTenant: TenantLifecycleStateRepresentation = {
    ...tenant,
    state: 'EXPORTED',
    exportMetadata,
  };

  const updatedTenants = state.tenants.map((t) =>
    t.tenantId === tenantId ? updatedTenant : t,
  );

  return {
    ...state,
    tenants: updatedTenants,
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_EXPORT',
      tenantId,
      organisationId,
      operation: 'EXPORT',
      timestamp: new Date().toISOString(),
    },
    lastError: null,
    readiness: 'READY',
  };
}

export function deleteTenant(
  state: TenantLifecycleCoordinatorState,
  tenantId: string,
  organisationId: string,
  auditFn: (event: TenantLifecycleAuditEvent) => TenantLifecycleError | null,
  subsystemDeleteFn: (subsystem: TenantLifecycleSubsystem) => TenantLifecycleError | null,
): TenantLifecycleCoordinatorState | TenantLifecycleError {
  if (!validateTenantId(tenantId) || !validateOrganisationId(organisationId)) {
    return {
      kind: 'INVALID_TENANT_ID',
      message: 'Invalid tenant or organisation identifier',
    };
  }

  const auditError = auditTenantLifecycleOperation(
    tenantId,
    organisationId,
    'DELETE',
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const tenant = state.tenants.find((t) => t.tenantId === tenantId);
  if (tenant === undefined) {
    return {
      kind: 'SUBSYSTEM_FAILURE',
      message: 'Tenant not found',
    };
  }

  if (tenant.exportMetadata === null) {
    return {
      kind: 'EXPORT_FAILURE',
      message: 'Export must succeed before delete',
    };
  }

  const subsystems: TenantLifecycleSubsystem[] = ['STORAGE', 'REALM', 'DSR', 'DATA'];
  const deletedSubsystems: TenantLifecycleSubsystem[] = [];
  for (const subsystem of subsystems) {
    const error = subsystemDeleteFn(subsystem);
    if (error !== null) {
      return {
        kind: 'DELETION_HALTED',
        message: `Failed to delete subsystem ${subsystem}, halting deletion`,
        subsystem,
      };
    }
    deletedSubsystems.push(subsystem);
  }

  const updatedTenants = state.tenants.filter((t) => t.tenantId !== tenantId);

  return {
    ...state,
    tenants: updatedTenants,
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_DELETE',
      tenantId,
      organisationId,
      operation: 'DELETE',
      timestamp: new Date().toISOString(),
    },
    lastError: null,
    readiness: 'READY',
  };
}

export function checkReadiness(
  state: TenantLifecycleCoordinatorState,
): TenantLifecycleReadiness {
  if (state.readiness === 'NOT_READY') {
    return 'NOT_READY';
  }
  if (state.lastError !== null) {
    return 'DEGRADED';
  }
  return 'READY';
}