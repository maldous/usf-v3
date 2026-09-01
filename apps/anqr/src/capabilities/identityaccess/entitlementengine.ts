export const EntitlementEngineEntitlementState = ['GRANTED', 'REVOKED', 'NOT_GRANTED'] as const;
export type EntitlementEngineEntitlementState = typeof EntitlementEngineEntitlementState[number];

export const EntitlementEngineDecision = ['ALLOWED', 'DENIED'] as const;
export type EntitlementEngineDecision = typeof EntitlementEngineDecision[number];

export const EntitlementEngineErrorKind = [
  'FORBIDDEN',
  'INVALID_TENANT',
  'INVALID_KEY',
  'DEGRADED',
  'AUDIT_FAILURE',
] as const;
export type EntitlementEngineErrorKind = typeof EntitlementEngineErrorKind[number];

export const EntitlementEngineAuditEventKind = ['ENTITLEMENT_GRANTED', 'ENTITLEMENT_REVOKED'] as const;
export type EntitlementEngineAuditEventKind = typeof EntitlementEngineAuditEventKind[number];

export const EntitlementEnginePermission = [
  'TENANT_ENTITLEMENTS_READ',
  'PLATFORM_ENTITLEMENTS_READ',
  'PLATFORM_ENTITLEMENTS_WRITE',
] as const;
export type EntitlementEnginePermission = typeof EntitlementEnginePermission[number];

export interface EntitlementEngineAuditEvent {
  readonly kind: EntitlementEngineAuditEventKind;
  readonly tenantId: string;
  readonly entitlementKey: string;
  readonly newState: EntitlementEngineEntitlementState;
  readonly timestamp: string;
  readonly operatorId: string;
}

export interface EntitlementEngineError {
  readonly kind: EntitlementEngineErrorKind;
  readonly message: string;
}

export interface EntitlementRecord {
  readonly organisationId: string;
  readonly entitlementKey: string;
  readonly state: 'GRANTED' | 'REVOKED';
  readonly source: string;
  readonly metadata: Record<string, string>;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface EntitlementEngineState {
  readonly entitlements: readonly EntitlementRecord[];
  readonly catalogKeys: readonly string[];
}

export const initialState: EntitlementEngineState = {
  entitlements: [],
  catalogKeys: [],
};

export interface TenantEntitlementView {
  readonly entitlementKey: string;
  readonly state: EntitlementEngineEntitlementState;
}

export function validateTenantId(tenantId: string): EntitlementEngineError | null {
  if (tenantId.trim() === '') {
    return { kind: 'INVALID_TENANT', message: 'Tenant ID cannot be empty' };
  }
  return null;
}

export function validateEntitlementKey(key: string, catalogKeys: readonly string[]): EntitlementEngineError | null {
  if (key.trim() === '') {
    return { kind: 'INVALID_KEY', message: 'Entitlement key cannot be empty' };
  }
  if (!catalogKeys.includes(key)) {
    return { kind: 'INVALID_KEY', message: 'Unknown entitlement key' };
  }
  return null;
}

export function getEntitlementState(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
): EntitlementEngineEntitlementState {
  const record = state.entitlements.find(
    (e) => e.organisationId === tenantId && e.entitlementKey === entitlementKey,
  );
  return record ? (record.state === 'GRANTED' ? 'GRANTED' : 'REVOKED') : 'NOT_GRANTED';
}

export function projectTenantView(
  state: EntitlementEngineState,
  tenantId: string,
): readonly TenantEntitlementView[] {
  return state.catalogKeys.map((key) => {
    const record = state.entitlements.find(
      (e) => e.organisationId === tenantId && e.entitlementKey === key,
    );
    const stateValue: EntitlementEngineEntitlementState = record
      ? (record.state === 'GRANTED' ? 'GRANTED' : 'REVOKED')
      : 'NOT_GRANTED';
    return { entitlementKey: key, state: stateValue };
  });
}

export function checkPermission(
  requiredPermission: EntitlementEnginePermission,
  actorPermissions: readonly EntitlementEnginePermission[],
): boolean {
  return actorPermissions.includes(requiredPermission);
}

export function evaluateEntitlement(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
): EntitlementEngineDecision {
  const entitlementState = getEntitlementState(state, tenantId, entitlementKey);
  return entitlementState === 'GRANTED' ? 'ALLOWED' : 'DENIED';
}

export function assertEntitlement(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
): EntitlementEngineError | null {
  const entitlementState = getEntitlementState(state, tenantId, entitlementKey);
  return entitlementState === 'GRANTED'
    ? null
    : { kind: 'FORBIDDEN', message: 'Access denied: entitlement not granted' };
}

export function emitAuditEvent(
  kind: EntitlementEngineAuditEventKind,
  tenantId: string,
  entitlementKey: string,
  newState: EntitlementEngineEntitlementState,
  operatorId: string,
  auditFn: (event: EntitlementEngineAuditEvent) => EntitlementEngineError | null,
): EntitlementEngineError | null {
  const event: EntitlementEngineAuditEvent = {
    kind,
    tenantId,
    entitlementKey,
    newState,
    timestamp: new Date().toISOString(),
    operatorId,
  };
  return auditFn(event);
}

export function grantEntitlement(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
  operatorId: string,
  source: string,
  metadata: Record<string, string>,
  auditFn: (event: EntitlementEngineAuditEvent) => EntitlementEngineError | null,
): EntitlementEngineState | EntitlementEngineError {
  const tenantError = validateTenantId(tenantId);
  if (tenantError !== null) return tenantError;

  const keyError = validateEntitlementKey(entitlementKey, state.catalogKeys);
  if (keyError !== null) return keyError;

  const auditError = emitAuditEvent(
    'ENTITLEMENT_GRANTED',
    tenantId,
    entitlementKey,
    'GRANTED',
    operatorId,
    auditFn,
  );
  if (auditError !== null) return auditError;

  const existingIndex = state.entitlements.findIndex(
    (e) => e.organisationId === tenantId && e.entitlementKey === entitlementKey,
  );

  const newEntitlements = [...state.entitlements];
  if (existingIndex >= 0) {
    newEntitlements[existingIndex] = {
      organisationId: tenantId,
      entitlementKey,
      state: 'GRANTED',
      source,
      metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: operatorId,
    };
  } else {
    newEntitlements.push({
      organisationId: tenantId,
      entitlementKey,
      state: 'GRANTED',
      source,
      metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: operatorId,
    });
  }

  return { ...state, entitlements: newEntitlements };
}

export function revokeEntitlement(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
  operatorId: string,
  source: string,
  metadata: Record<string, string>,
  auditFn: (event: EntitlementEngineAuditEvent) => EntitlementEngineError | null,
): EntitlementEngineState | EntitlementEngineError {
  const tenantError = validateTenantId(tenantId);
  if (tenantError !== null) return tenantError;

  const keyError = validateEntitlementKey(entitlementKey, state.catalogKeys);
  if (keyError !== null) return keyError;

  const auditError = emitAuditEvent(
    'ENTITLEMENT_REVOKED',
    tenantId,
    entitlementKey,
    'REVOKED',
    operatorId,
    auditFn,
  );
  if (auditError !== null) return auditError;

  const existingIndex = state.entitlements.findIndex(
    (e) => e.organisationId === tenantId && e.entitlementKey === entitlementKey,
  );

  const newEntitlements = [...state.entitlements];
  if (existingIndex >= 0) {
    newEntitlements[existingIndex] = {
      ...newEntitlements[existingIndex],
      state: 'REVOKED',
      source,
      metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: operatorId,
    };
  } else {
    newEntitlements.push({
      organisationId: tenantId,
      entitlementKey,
      state: 'REVOKED',
      source,
      metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: operatorId,
    });
  }

  return { ...state, entitlements: newEntitlements };
}

export function tenantSelfReadEntitlements(
  state: EntitlementEngineState,
  tenantId: string,
  actorPermissions: readonly EntitlementEnginePermission[],
): { readonly result: readonly TenantEntitlementView[] } | EntitlementEngineError {
  if (!checkPermission('TENANT_ENTITLEMENTS_READ', actorPermissions)) {
    return { kind: 'FORBIDDEN', message: 'Missing TENANT_ENTITLEMENTS_READ permission' };
  }

  const tenantError = validateTenantId(tenantId);
  if (tenantError !== null) return tenantError;

  return { result: projectTenantView(state, tenantId) };
}

export function operatorReadEntitlements(
  state: EntitlementEngineState,
  tenantId: string,
  actorPermissions: readonly EntitlementEnginePermission[],
): { readonly result: readonly TenantEntitlementView[] } | EntitlementEngineError {
  if (!checkPermission('PLATFORM_ENTITLEMENTS_READ', actorPermissions)) {
    return { kind: 'FORBIDDEN', message: 'Missing PLATFORM_ENTITLEMENTS_READ permission' };
  }

  const tenantError = validateTenantId(tenantId);
  if (tenantError !== null) return tenantError;

  return { result: projectTenantView(state, tenantId) };
}

export function operatorWriteEntitlement(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
  action: 'GRANT' | 'REVOKE',
  operatorId: string,
  source: string,
  metadata: Record<string, string>,
  actorPermissions: readonly EntitlementEnginePermission[],
  auditFn: (event: EntitlementEngineAuditEvent) => EntitlementEngineError | null,
): EntitlementEngineState | EntitlementEngineError {
  if (!checkPermission('PLATFORM_ENTITLEMENTS_WRITE', actorPermissions)) {
    return { kind: 'FORBIDDEN', message: 'Missing PLATFORM_ENTITLEMENTS_WRITE permission' };
  }

  return action === 'GRANT'
    ? grantEntitlement(state, tenantId, entitlementKey, operatorId, source, metadata, auditFn)
    : revokeEntitlement(state, tenantId, entitlementKey, operatorId, source, metadata, auditFn);
}

export function serviceCatalogRead(
  state: EntitlementEngineState,
): { readonly result: readonly string[] } {
  return { result: [...state.catalogKeys] };
}

export function evaluateAccess(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
  actorPermissions: readonly EntitlementEnginePermission[],
): { readonly decision: EntitlementEngineDecision } | EntitlementEngineError {
  const tenantError = validateTenantId(tenantId);
  if (tenantError !== null) return tenantError;

  const keyError = validateEntitlementKey(entitlementKey, state.catalogKeys);
  if (keyError !== null) return keyError;

  if (!checkPermission('TENANT_ENTITLEMENTS_READ', actorPermissions)) {
    return { kind: 'FORBIDDEN', message: 'Missing TENANT_ENTITLEMENTS_READ permission' };
  }

  const decision = evaluateEntitlement(state, tenantId, entitlementKey);
  return { decision };
}

export function assertAccess(
  state: EntitlementEngineState,
  tenantId: string,
  entitlementKey: string,
  actorPermissions: readonly EntitlementEnginePermission[],
): EntitlementEngineError | null {
  const tenantError = validateTenantId(tenantId);
  if (tenantError !== null) return tenantError;

  const keyError = validateEntitlementKey(entitlementKey, state.catalogKeys);
  if (keyError !== null) return keyError;

  if (!checkPermission('TENANT_ENTITLEMENTS_READ', actorPermissions)) {
    return { kind: 'FORBIDDEN', message: 'Missing TENANT_ENTITLEMENTS_READ permission' };
  }

  return assertEntitlement(state, tenantId, entitlementKey);
}