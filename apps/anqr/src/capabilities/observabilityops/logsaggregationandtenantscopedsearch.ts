export const LogSearchAuditEventKind = ['AUDIT_BEFORE_SEARCH', 'AUDIT_READINESS_QUERY'] as const;
export type LogSearchAuditEventKind = typeof LogSearchAuditEventKind[number];

export const LogSearchErrorKind = [
  'VALIDATION_ERROR',
  'MISSING_TENANT',
  'UNAUTHORIZED',
  'PROVIDER_UNAVAILABLE',
  'AUDIT_FAILURE',
] as const;
export type LogSearchErrorKind = typeof LogSearchErrorKind[number];

export const ReadinessSubState = [
  'INGESTION',
  'QUERY',
  'TRACE_CORRELATION',
  'DASHBOARD',
  'COLLECTOR',
  'METRICS',
  'ERROR_CAPTURE',
] as const;
export type ReadinessSubState = typeof ReadinessSubState[number];

export const LogSearchResultKind = ['SUCCESS', 'DEGRADED', 'UNAVAILABLE'] as const;
export type LogSearchResultKind = typeof LogSearchResultKind[number];

export interface LogSearchAuditEvent {
  readonly kind: LogSearchAuditEventKind;
  readonly tenantId: string;
  readonly requestId: string;
  readonly timestamp: string;
}

export interface LogSearchError {
  readonly kind: LogSearchErrorKind;
  readonly message: string;
}

export interface ReadinessState {
  readonly subStates: readonly ReadinessSubState[];
  readonly degraded: boolean;
}

export interface LogSearchRequest {
  readonly tenantId: string;
  readonly requestId: string;
  readonly timeStart: string; // ISO string
  readonly timeEnd: string;   // ISO string
  readonly filters: readonly Record<string, string>[];
  readonly isAdmin: boolean;
}

export interface LogEntry {
  readonly timestamp: string;
  readonly message: string;
  readonly tenantId: string;
  readonly labels: Record<string, string>;
}

export interface LogSearchSuccess {
  readonly kind: 'SUCCESS';
  readonly entries: readonly LogEntry[];
  readonly readiness: ReadinessState;
}

export interface LogSearchFailure {
  readonly kind: 'DEGRADED' | 'UNAVAILABLE';
  readonly error: LogSearchError;
}

export type LogSearchResult = LogSearchSuccess | LogSearchFailure;

/**
 * Validates a search request before any provider interaction.
 * Returns null when the request is valid, otherwise a LogSearchError.
 */
export function validateSearchRequest(request: LogSearchRequest): LogSearchError | null {
  if (!request.tenantId) {
    return { kind: 'MISSING_TENANT', message: 'Tenant identifier is required' };
  }
  if (!request.isAdmin) {
    return { kind: 'UNAUTHORIZED', message: 'Admin permission required' };
  }
  const start = Date.parse(request.timeStart);
  const end = Date.parse(request.timeEnd);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return { kind: 'VALIDATION_ERROR', message: 'Invalid time range' };
  }
  if (!Array.isArray(request.filters)) {
    return { kind: 'VALIDATION_ERROR', message: 'Filters must be an array' };
  }
  return null;
}

/**
 * Emits an audit event before the search operation.
 * Returns null on success, otherwise a LogSearchError.
 */
export function auditBeforeSearch(
  event: LogSearchAuditEvent,
  auditFn: (e: LogSearchAuditEvent) => LogSearchError | null,
): LogSearchError | null {
  return auditFn(event);
}

/**
 * Executes a tenant‑scoped log search using a provider function.
 * The provider function must be pure and return either a success or an error.
 * The function enforces validation, permission, and audit ordering.
 */
export function searchLogs(
  request: LogSearchRequest,
  providerFn: (req: LogSearchRequest) => LogSearchSuccess | LogSearchError,
  auditFn: (e: LogSearchAuditEvent) => LogSearchError | null,
): LogSearchResult {
  const validationError = validateSearchRequest(request);
  if (validationError !== null) {
    return { kind: 'UNAVAILABLE', error: validationError };
  }

  const auditEvent: LogSearchAuditEvent = {
    kind: 'AUDIT_BEFORE_SEARCH',
    tenantId: request.tenantId,
    requestId: request.requestId,
    timestamp: new Date().toISOString(),
  };
  const auditError = auditBeforeSearch(auditEvent, auditFn);
  if (auditError !== null) {
    return { kind: 'UNAVAILABLE', error: auditError };
  }

  const providerResult = providerFn(request);
  if ('kind' in providerResult && providerResult.kind === 'SUCCESS') {
    return providerResult;
  }

  const providerError = providerResult as LogSearchError;
  return { kind: 'DEGRADED', error: providerError };
}

/**
 * Constructs a readiness state from discrete subsystem flags.
 * Degraded is true when any critical subsystem is unavailable.
 */
export function computeReadiness(
  ingestionAvailable: boolean,
  queryAvailable: boolean,
  traceCorrelationAvailable: boolean,
  dashboardAvailable: boolean,
  collectorAvailable: boolean,
  metricsAvailable: boolean,
  errorCaptureAvailable: boolean,
):