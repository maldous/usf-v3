export const AuditOfPrivilegedAccessOutcome = ['ok', 'forbidden', 'invalid'] as const;
export type AuditOfPrivilegedAccessOutcome = typeof AuditOfPrivilegedAccessOutcome[number];

export const AuditOfPrivilegedAccessReadiness = ['INVARIANT_READY', 'DEGRADED'] as const;
export type AuditOfPrivilegedAccessReadiness = typeof AuditOfPrivilegedAccessReadiness[number];

export const AuditOfPrivilegedAccessErrorKind = [
  'PROVIDER_FAILURE',
  'TENANT_ISOLATION_VIOLATION',
  'SECRET_EXPOSURE_RISK',
  'UNAUTHORISED_ACCESS',
] as const;
export type AuditOfPrivilegedAccessErrorKind = typeof AuditOfPrivilegedAccessErrorKind[number];

export interface AuditOfPrivilegedAccessError {
  readonly kind: AuditOfPrivilegedAccessErrorKind;
  readonly message: string;
}

export const LogicalResourceKind = ['member', 'config', 'feature', 'auth-settings'] as const;
export type LogicalResourceKind = typeof LogicalResourceKind[number];

export interface AuditEventProjection {
  readonly id: string;
  readonly action: string;
  readonly actorId: string;
  readonly resource: LogicalResourceKind;
  readonly resourceId: string;
  readonly timestamp: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AuditQuery {
  readonly resource?: LogicalResourceKind;
  readonly resourceId?: string;
  readonly action?: string;
  readonly actor?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface AuditOfPrivilegedAccessState {
  readonly readiness: AuditOfPrivilegedAccessReadiness;
  readonly lastError: AuditOfPrivilegedAccessError | null;
}

export const initialState: AuditOfPrivilegedAccessState = {
  readiness: 'INVARIANT_READY',
  lastError: null,
};

export const MAX_LIMIT = 100;
export const MIN_LIMIT = 1;

export function validateQuery(query: AuditQuery): AuditOfPrivilegedAccessOutcome | AuditQuery {
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'number' || query.limit < MIN_LIMIT || query.limit > MAX_LIMIT || !Number.isInteger(query.limit)) {
      return 'invalid';
    }
  }

  if (query.resource !== undefined && !LogicalResourceKind.includes(query.resource)) {
    return 'invalid';
  }

  if (query.from !== undefined && typeof query.from !== 'string') {
    return 'invalid';
  }

  if (query.to !== undefined && typeof query.to !== 'string') {
    return 'invalid';
  }

  if (query.actor !== undefined && typeof query.actor !== 'string') {
    return 'invalid';
  }

  if (query.resourceId !== undefined && typeof query.resourceId !== 'string') {
    return 'invalid';
  }

  if (query.action !== undefined && typeof query.action !== 'string') {
    return 'invalid';
  }

  return query;
}

export function redactMetadata(metadata: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const secretLikeKeys = new Set(['password', 'secret', 'token', 'key', 'credential', 'apiKey', 'privateKey']);
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    const lowerKey = k.toLowerCase();
    if (secretLikeKeys.has(lowerKey)) {
      redacted[k] = '[REDACTED]';
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

export function projectAuditEvent(
  event: Readonly<{
    readonly id: string;
    readonly action: string;
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly timestamp: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }>,
): AuditEventProjection | null {
  if (!LogicalResourceKind.includes(event.resource as LogicalResourceKind)) {
    return null;
  }

  return {
    id: event.id,
    action: event.action,
    actorId: event.actorId,
    resource: event.resource as LogicalResourceKind,
    resourceId: event.resourceId,
    timestamp: event.timestamp,
    metadata: redactMetadata(event.metadata),
  };
}

export function checkPermissions(
  tenantId: string,
  sessionTenantId: string,
  perContextPermission: string | null,
): AuditOfPrivilegedAccessOutcome {
  if (tenantId !== sessionTenantId) {
    return 'forbidden';
  }
  if (perContextPermission === null) {
    return 'forbidden';
  }
  return 'ok';
}

export function queryAuditEvents(
  durableRows: readonly Readonly<{
    readonly id: string;
    readonly action: string;
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly timestamp: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly tenantId: string;
  }>[],
  query: AuditQuery,
  sessionTenantId: string,
  perContextPermission: string | null,
): { readonly outcome: AuditOfPrivilegedAccessOutcome } | { readonly outcome: 'ok'; readonly events: readonly AuditEventProjection[] } {
  const validationOutcome = validateQuery(query);
  if (validationOutcome !== 'ok' && typeof validationOutcome !== 'object') {
    return { outcome: validationOutcome };
  }

  const permissionOutcome = checkPermissions(sessionTenantId, sessionTenantId, perContextPermission);
  if (permissionOutcome !== 'ok') {
    return { outcome: permissionOutcome };
  }

  const limit = query.limit ?? MAX_LIMIT;
  const filtered = durableRows.filter((row) => {
    if (row.tenantId !== sessionTenantId) return false;
    if (query.resource !== undefined && row.resource !== query.resource) return false;
    if (query.resourceId !== undefined && row.resourceId !== query.resourceId) return false;
    if (query.action !== undefined && row.action !== query.action) return false;
    if (query.actor !== undefined && row.actorId !== query.actor) return false;
    if (query.from !== undefined && row.timestamp < query.from) return false;
    if (query.to !== undefined && row.timestamp > query.to) return false;
    return true;
  });

  const projected = filtered
    .map((row) => projectAuditEvent(row))
    .filter((projection): projection is AuditEventProjection => projection !== null)
    .slice(0, limit);

  return { outcome: 'ok', events: projected };
}

export function computeReadiness(
  state: AuditOfPrivilegedAccessState,
): AuditOfPrivilegedAccessReadiness {
  if (state.lastError !== null && state.lastError.kind === 'PROVIDER_FAILURE') {
    return 'DEGRADED';
  }
  return 'INVARIANT_READY';
}

export function runAuditOfPrivilegedAccess(
  state: AuditOfPrivilegedAccessState,
  durableRows: readonly Readonly<{
    readonly id: string;
    readonly action: string;
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly timestamp: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly tenantId: string;
  }>[],
  query: AuditQuery,
  sessionTenantId: string,
  perContextPermission: string | null,
): AuditOfPrivilegedAccessState {
  const result = queryAuditEvents(durableRows, query, sessionTenantId, perContextPermission);
  if (result.outcome === 'ok') {
    return {
      ...state,
      readiness: computeReadiness(state),
      lastError: null,
    };
  }

  if (result.outcome === 'forbidden') {
    return {
      ...state,
      lastError: { kind: 'UNAUTHORISED_ACCESS', message: 'Access forbidden due to missing permissions' },
    };
  }

  if (result.outcome === 'invalid') {
    return {
      ...state,
      lastError: { kind: 'SECRET_EXPOSURE_RISK', message: 'Invalid query parameters' },
    };
  }

  return {
    ...state,
    lastError: { kind: 'PROVIDER_FAILURE', message: 'Unexpected provider failure' },
  };
}