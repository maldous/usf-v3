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
  readonly timeStart: string;
  readonly timeEnd: string;
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

export interface LogStoreAdapter {
  readonly search: (request: LogSearchRequest) => LogSearchSuccess | LogSearchError;
  readonly readiness: () => ReadinessState;
}

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
  for (const filter of request.filters) {
    for (const [key, value] of Object.entries(filter)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return { kind: 'VALIDATION_ERROR', message: 'Filter keys and values must be strings' };
      }
    }
  }
  return null;
}

export function auditBeforeSearch(
  event: LogSearchAuditEvent,
  auditFn: (e: LogSearchAuditEvent) => LogSearchError | null,
): LogSearchError | null {
  return auditFn(event);
}

export function computeReadiness(
  ingestionAvailable: boolean,
  queryAvailable: boolean,
  traceCorrelationAvailable: boolean,
  dashboardAvailable: boolean,
  collectorAvailable: boolean,
  metricsAvailable: boolean,
  errorCaptureAvailable: boolean,
): ReadinessState {
  const subStates: ReadinessSubState[] = [];
  if (ingestionAvailable) subStates.push('INGESTION');
  if (queryAvailable) subStates.push('QUERY');
  if (traceCorrelationAvailable) subStates.push('TRACE_CORRELATION');
  if (dashboardAvailable) subStates.push('DASHBOARD');
  if (collectorAvailable) subStates.push('COLLECTOR');
  if (metricsAvailable) subStates.push('METRICS');
  if (errorCaptureAvailable) subStates.push('ERROR_CAPTURE');

  const degraded = !(
    ingestionAvailable &&
    queryAvailable &&
    traceCorrelationAvailable &&
    collectorAvailable &&
    errorCaptureAvailable
  );

  return { subStates, degraded };
}

export function searchLogs(
  request: LogSearchRequest,
  adapter: LogStoreAdapter,
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

  const providerResult = adapter.search(request);
  if ('kind' in providerResult && providerResult.kind === 'SUCCESS') {
    return providerResult;
  }

  const providerError = providerResult as LogSearchError;
  return { kind: 'DEGRADED', error: providerError };
}

export function queryReadiness(
  adapter: LogStoreAdapter,
  auditFn: (e: LogSearchAuditEvent) => LogSearchError | null,
): ReadinessState | LogSearchError {
  const readiness = adapter.readiness();
  const auditEvent: LogSearchAuditEvent = {
    kind: 'AUDIT_READINESS_QUERY',
    tenantId: '',
    requestId: '',
    timestamp: new Date().toISOString(),
  };
  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }
  return readiness;
}