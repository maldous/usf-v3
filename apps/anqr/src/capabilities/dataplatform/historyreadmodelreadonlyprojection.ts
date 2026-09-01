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

export interface HistoryReadModelReadOnlyProjectionRepositoryResult {
  readonly total: number;
  readonly entries: readonly unknown[];
}

export type HistoryReadModelReadOnlyProjectionRepository = (
  tenantId: string,
  limit: number,
  offset: number,
) => HistoryReadModelReadOnlyProjectionRepositoryResult;

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

function isTenantContext(
  context: HistoryReadModelReadOnlyProjectionTenantContext | null,
): context is HistoryReadModelReadOnlyProjectionTenantContext {
  return context !== null && context.tenantId.trim() !== '';
}

export function validateTenantContext(
  context: HistoryReadModelReadOnlyProjectionTenantContext | null,
): HistoryReadModelReadOnlyProjectionError | null {
  if (!isTenantContext(context)) {
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
    typeof (raw as { id: unknown }).id === 'string' &&
    'source' in raw &&
    isValidSource((raw as { source: unknown }).source) &&
    'type' in raw &&
    isValidType((raw as { type: unknown }).type) &&
    'title' in raw &&
    typeof (raw as { title: unknown }).title === 'string' &&
    'occurrenceTime' in raw &&
    typeof (raw as { occurrenceTime: unknown }).occurrenceTime === 'string' &&
    'actor' in raw &&
    typeof (raw as { actor: unknown }).actor === 'string' &&
    'status' in raw &&
    typeof (raw as { status: unknown }).status === 'string'
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
  repository: HistoryReadModelReadOnlyProjectionRepository,
):
  | HistoryReadModelReadOnlyProjectionPage
  | HistoryReadModelReadOnlyProjectionError {
  const pagingError = validatePaging(limit, offset);
  if (pagingError !== null) {
    return pagingError;
  }

  const contextError = validateTenantContext(context);
  if (contextError !== null) {
    return contextError;
  }

  if (!isTenantContext(context)) {
    return {
      kind: 'TENANT_CONTEXT_MISSING',
      message: 'Tenant context is required',
    };
  }

  if (state.readiness !== 'READY') {
    return {
      kind: 'STORE_UNAVAILABLE',
      message: 'History store is unavailable',
    };
  }

  const accessError = validateTenantAccess(context, context.tenantId);
  if (accessError !== null) {
    return accessError;
  }

  const repositoryResult = repository(context.tenantId, limit, offset);
  const projectedEntries: HistoryReadModelReadOnlyProjectionEntry[] = [];
  for (const raw of repositoryResult.entries) {
    const projected = projectHistoryEntry(raw);
    if (projected !== null) {
      projectedEntries.push(projected);
    }
  }

  return {
    entries: projectedEntries,
    total: repositoryResult.total,
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
  repository: HistoryReadModelReadOnlyProjectionRepository,
):
  | HistoryReadModelReadOnlyProjectionPage
  | HistoryReadModelReadOnlyProjectionError {
  const pagingError = validatePaging(limit, offset);
  if (pagingError !== null) {
    return pagingError;
  }

  const contextError = validateTenantContext(context);
  if (contextError !== null) {
    return contextError;
  }

  if (!isTenantContext(context)) {
    return {
      kind: 'TENANT_CONTEXT_MISSING',
      message: 'Tenant context is required',
    };
  }

  if (state.readiness !== 'READY') {
    return {
      kind: 'STORE_UNAVAILABLE',
      message: 'History store is unavailable',
    };
  }

  const accessError = validateTenantAccess(context, requestedTenantId);
  if (accessError !== null) {
    return accessError;
  }

  const repositoryResult = repository(requestedTenantId, limit, offset);
  const projectedEntries: HistoryReadModelReadOnlyProjectionEntry[] = [];
  for (const raw of repositoryResult.entries) {
    const projected = projectHistoryEntry(raw);
    if (projected !== null) {
      projectedEntries.push(projected);
    }
  }

  return {
    entries: projectedEntries,
    total: repositoryResult.total,
    limit,
    offset,
  };
}