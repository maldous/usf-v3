export const HistoryReadModelReadOnlyProjectionErrorKind = [
  'TENANT_CONTEXT_MISSING',
  'INVALID_PAGING_PARAMETERS',
  'STORE_UNAVAILABLE',
  'UNAUTHORIZED_TENANT_ACCESS',
] as const;
export type HistoryReadModelReadOnlyProjectionErrorKind =
  typeof HistoryReadModelReadOnlyProjectionErrorKind[number];

export const HistoryReadModelReadOnlyProjectionEntrySource = [
  'AUDIT',
  'EVENT',
] as const;
export type HistoryReadModelReadOnlyProjectionEntrySource =
  typeof HistoryReadModelReadOnlyProjectionEntrySource[number];

export const HistoryReadModelReadOnlyProjectionEntryType = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'ACCESS',
] as const;
export type HistoryReadModelReadOnlyProjectionEntryType =
  typeof HistoryReadModelReadOnlyProjectionEntryType[number];

export interface HistoryReadModelReadOnlyProjectionEntry {
  readonly id: string;
  readonly source: HistoryReadModelReadOnlyProjectionEntrySource;
  readonly type: HistoryReadModelReadOnlyProjectionEntryType;
  readonly title: string;
  readonly occurrenceTime: string;
  readonly actor: string;
  readonly status: string;
}

export interface HistoryReadModelReadOnlyProjectionPage {
  readonly entries: readonly HistoryReadModelReadOnlyProjectionEntry[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface HistoryReadModelReadOnlyProjectionError {
  readonly kind: HistoryReadModelReadOnlyProjectionErrorKind;
  readonly message: string;
}

export interface HistoryReadModelReadOnlyProjectionTenantContext {
  readonly tenantId: string;
  readonly isAdmin: boolean;
}

export const HistoryReadModelReadOnlyProjectionReadiness = [
  'READY',
  'DEGRADED',
] as const;
export type HistoryReadModelReadOnlyProjectionReadiness =
  typeof HistoryReadModelReadOnlyProjectionReadiness[number];

export interface HistoryReadModelReadOnlyProjectionState {
  readonly readiness: HistoryReadModelReadOnlyProjectionReadiness;
  readonly lastError: HistoryReadModelReadOnlyProjectionError | null;
}

export const initialState: HistoryReadModelReadOnlyProjectionState = {
  readiness: 'READY',
  lastError: null,
};

export const MAX_LIMIT = 100;
export const MIN_LIMIT = 1;
export const MAX_OFFSET = 10000;

function isValidSource(
  v: unknown,
): v is HistoryReadModelReadOnlyProjectionEntrySource {
  return (
    typeof v === 'string' &&
    (HistoryReadModelReadOnlyProjectionEntrySource as readonly string[]).includes(v)
  );
}

function isValidType(
  v: unknown,
): v is HistoryReadModelReadOnlyProjectionEntryType {
  return (
    typeof v === 'string' &&
    (HistoryReadModelReadOnlyProjectionEntryType as readonly string[]).includes(v)
  );
}

export function validatePaging(
  limit: number,
  offset: number,
): HistoryReadModelReadOnlyProjectionError | null {
  if (
    limit < MIN_LIMIT ||
    limit > MAX_LIMIT ||
    offset < 0 ||
    offset > MAX_OFFSET
  ) {
    return {
      kind: 'INVALID_PAGING_PARAMETERS',
      message: `Invalid paging parameters: limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}, offset between 0 and ${MAX_OFFSET}`,
    };
  }
  return null;
}

export function validateTenantContext(
  context: HistoryReadModelReadOnlyProjectionTenantContext | null,
): HistoryReadModelReadOnlyProjectionError | null {
  if (context === null || context.tenantId.trim() === '') {
    return {
      kind: 'TENANT_CONTEXT_MISSING',
      message: 'Tenant context is required',
    };
  }
  return null;
}

export function validateTenantAccess(
  context: HistoryReadModelReadOnlyProjectionTenantContext,
  requestedTenantId: string,
): HistoryReadModelReadOnlyProjectionError | null {
  if (!context.isAdmin && context.tenantId !== requestedTenantId) {
    return {
      kind: 'UNAUTHORIZED_TENANT_ACCESS',
      message: 'Tenant can only access its own history',
    };
  }
  return null;
}

export function projectHistoryEntry(
  raw: unknown,
): HistoryReadModelReadOnlyProjectionEntry | null {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'id' in raw &&
    typeof (raw as any).id === 'string' &&
    'source' in raw &&
    isValidSource((raw as any).source) &&
    'type' in raw &&
    isValidType((raw as any).type) &&
    'title' in raw &&
    typeof (raw as any).title === 'string' &&
    'occurrenceTime' in raw &&
    typeof (raw as any).occurrenceTime === 'string' &&
    'actor' in raw &&
    typeof (raw as any).actor === 'string' &&
    'status' in raw &&
    typeof (raw as any).status === 'string'
  ) {
    const r = raw as {
      readonly id: string;
      readonly source: HistoryReadModelReadOnlyProjectionEntrySource;
      readonly type: HistoryReadModelReadOnlyProjectionEntryType;
      readonly title: string;
      readonly occurrenceTime: string;
      readonly actor: string;
      readonly status: string;
    };
    return {
      id: r.id,
      source: r.source,
      type: r.type,
      title: r.title,
      occurrenceTime: r.occurrenceTime,
      actor: r.actor,
      status: r.status,
    };
  }
  return null;
}

export function tenantHistory(
  state: HistoryReadModelReadOnlyProjectionState,
  context: HistoryReadModelReadOnlyProjectionTenantContext | null,
  limit: number,
  offset: number,
  repository: (
    tenantId: string,
    limit: number,
    offset: number,
  ) => readonly unknown[],
): HistoryReadModelReadOnlyProjectionPage | HistoryReadModelReadOnlyProjectionError {
  const pagingError = validatePaging(limit, offset);
  if (pagingError !== null) {
    return pagingError;
  }

  const contextError = validateTenantContext(context);
  if (contextError !== null) {
    return contextError;
  }

  const ctx = context as HistoryReadModelReadOnlyProjectionTenantContext;

  if (state.readiness !== 'READY') {
    return {
      kind: 'STORE_UNAVAILABLE',
      message: 'History store is unavailable',
    };
  }

  const rawEntries = repository(ctx.tenantId, limit, offset);
  const entries: HistoryReadModelReadOnlyProjectionEntry[] = [];
  for (const raw of rawEntries) {
    const projected = projectHistoryEntry(raw);
    if (projected !== null) {
      entries.push(projected);
    }
  }

  return {
    entries,
    total: entries.length,
    limit,
    offset,
  };
}

export function adminTenantHistory(
  state: HistoryReadModelReadOnlyProjectionState,
  context: HistoryReadModelReadOnlyProjectionTenantContext | null,
  requestedTenantId: string,
  limit: number,
  offset: number,
  repository: (
    tenantId: string,
    limit: number,
    offset: number,
  ) => readonly unknown[],
): HistoryReadModelReadOnlyProjectionPage | HistoryReadModelReadOnlyProjectionError {
  const pagingError = validatePaging(limit, offset);
  if (pagingError !== null) {
    return pagingError;
  }

  const contextError = validateTenantContext(context);
  if (contextError !== null) {
    return contextError;
  }

  const ctx = context as HistoryReadModelReadOnlyProjectionTenantContext;

  const accessError = validateTenantAccess(ctx, requestedTenantId);
  if (accessError !== null) {
    return accessError;
  }

  if (state.readiness !== 'READY') {
    return {
      kind: 'STORE_UNAVAILABLE',
      message: 'History store is unavailable',
    };
  }

  const rawEntries = repository(requestedTenantId, limit, offset);
  const entries: HistoryReadModelReadOnlyProjectionEntry[] = [];
  for (const raw of rawEntries) {
    const projected = projectHistoryEntry(raw);
    if (projected !== null) {
      entries.push(projected);
    }
  }

  return {
    entries,
    total: entries.length,
    limit,
    offset,
  };
}

export function checkReadiness(
  state: HistoryReadModelReadOnlyProjectionState,
  storeReachable: boolean,
): HistoryReadModelReadOnlyProjectionState {
  if (!storeReachable) {
    return {
      ...state,
      readiness: 'DEGRADED',
      lastError: {
        kind: 'STORE_UNAVAILABLE',
        message: 'History store is unreachable',
      },
    };
  }

  return {
    ...state,
    readiness: 'READY',
    lastError: null,
  };
}