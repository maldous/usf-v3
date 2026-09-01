export const MetricsAndTracesCapabilityAuditEventKind = ['AUDIT_CONFIG_CHANGE', 'AUDIT_CONTRACT_CHANGE'] as const;
export type MetricsAndTracesCapabilityAuditEventKind = typeof MetricsAndTracesCapabilityAuditEventKind[number];

export const MetricsAndTracesCapabilityErrorKind = [
  'PROVIDER_UNAVAILABLE',
  'INVALID_QUERY_PARAMETERS',
  'MISSING_CONFIGURATION',
  'PERMISSION_DENIED',
  'SEMANTIC_DRIFT_DETECTED',
] as const;
export type MetricsAndTracesCapabilityErrorKind = typeof MetricsAndTracesCapabilityErrorKind[number];

export const MetricsAndTracesCapabilityReadinessState = [
  'READY',
  'DEGRADED_METRICS',
  'DEGRADED_TRACES',
  'UNAVAILABLE',
] as const;
export type MetricsAndTracesCapabilityReadinessState = typeof MetricsAndTracesCapabilityReadinessState[number];

export const MetricsAndTracesCapabilityMetricName = [
  'request_total',
  'failure_total',
  'readiness_state',
] as const;
export type MetricsAndTracesCapabilityMetricName = typeof MetricsAndTracesCapabilityMetricName[number];

export const MetricsAndTracesCapabilitySpanKind = [
  'route',
  'use_case',
  'provider',
] as const;
export type MetricsAndTracesCapabilitySpanKind = typeof MetricsAndTracesCapabilitySpanKind[number];

export interface MetricsAndTracesCapabilityAuditEvent {
  readonly kind: MetricsAndTracesCapabilityAuditEventKind;
  readonly detail: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly timestamp: string;
}

export interface MetricsAndTracesCapabilityError {
  readonly kind: MetricsAndTracesCapabilityErrorKind;
  readonly message: string;
  readonly correlationId: string;
  readonly traceId: string;
}

export interface MetricsAndTracesCapabilityQueryParameters {
  readonly metricName?: MetricsAndTracesCapabilityMetricName;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly organisationId?: string;
  readonly tenantId?: string;
}

export interface MetricsAndTracesCapabilityState {
  readonly metricsProviderAvailable: boolean;
  readonly tracesProviderAvailable: boolean;
  readonly lastReadinessState: MetricsAndTracesCapabilityReadinessState | null;
  readonly lastError: MetricsAndTracesCapabilityError | null;
  readonly lastAuditEvent: MetricsAndTracesCapabilityAuditEvent | null;
}

export const initialState: MetricsAndTracesCapabilityState = {
  metricsProviderAvailable: false,
  tracesProviderAvailable: false,
  lastReadinessState: null,
  lastError: null,
  lastAuditEvent: null,
};

export interface MetricsAndTracesCapabilityQueryResult {
  readonly kind: 'SUCCESS';
  readonly data: unknown;
  readonly correlationId: string;
  readonly traceId: string;
}

export interface MetricsAndTracesCapabilityQueryFailure {
  readonly kind: 'FAILURE';
  readonly error: MetricsAndTracesCapabilityError;
}

export type MetricsAndTracesCapabilityQueryResponse =
  | MetricsAndTracesCapabilityQueryResult
  | MetricsAndTracesCapabilityQueryFailure;

export interface MetricsAndTracesCapabilityReadinessResult {
  readonly kind: 'SUCCESS';
  readonly state: MetricsAndTracesCapabilityReadinessState;
  readonly correlationId: string;
  readonly traceId: string;
}

export interface MetricsAndTracesCapabilityReadinessFailure {
  readonly kind: 'FAILURE';
  readonly error: MetricsAndTracesCapabilityError;
}

export type MetricsAndTracesCapabilityReadinessResponse =
  | MetricsAndTracesCapabilityReadinessResult
  | MetricsAndTracesCapabilityReadinessFailure;

export function validateQueryParameters(
  params: MetricsAndTracesCapabilityQueryParameters,
): MetricsAndTracesCapabilityError | null {
  if (params.metricName !== undefined && !MetricsAndTracesCapabilityMetricName.includes(params.metricName)) {
    return {
      kind: 'INVALID_QUERY_PARAMETERS',
      message: 'Invalid metric name',
      correlationId: '',
      traceId: '',
    };
  }

  if (params.startTime !== undefined && isNaN(Date.parse(params.startTime))) {
    return {
      kind: 'INVALID_QUERY_PARAMETERS',
      message: 'Invalid start time',
      correlationId: '',
      traceId: '',
    };
  }

  if (params.endTime !== undefined && isNaN(Date.parse(params.endTime))) {
    return {
      kind: 'INVALID_QUERY_PARAMETERS',
      message: 'Invalid end time',
      correlationId: '',
      traceId: '',
    };
  }

  if (params.organisationId !== undefined && typeof params.organisationId !== 'string') {
    return {
      kind: 'INVALID_QUERY_PARAMETERS',
      message: 'Invalid organisation ID',
      correlationId: '',
      traceId: '',
    };
  }

  if (params.tenantId !== undefined && typeof params.tenantId !== 'string') {
    return {
      kind: 'INVALID_QUERY_PARAMETERS',
      message: 'Invalid tenant ID',
      correlationId: '',
      traceId: '',
    };
  }

  return null;
}

export function auditConfigurationChange(
  detail: string,
  correlationId: string,
  traceId: string,
  auditFn: (event: MetricsAndTracesCapabilityAuditEvent) => MetricsAndTracesCapabilityError | null,
): MetricsAndTracesCapabilityError | null {
  const event: MetricsAndTracesCapabilityAuditEvent = {
    kind: 'AUDIT_CONFIG_CHANGE',
    detail,
    correlationId,
    traceId,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function auditContractChange(
  detail: string,
  correlationId: string,
  traceId: string,
  auditFn: (event: MetricsAndTracesCapabilityAuditEvent) => MetricsAndTracesCapabilityError | null,
): MetricsAndTracesCapabilityError | null {
  const event: MetricsAndTracesCapabilityAuditEvent = {
    kind: 'AUDIT_CONTRACT_CHANGE',
    detail,
    correlationId,
    traceId,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function queryMetrics(
  state: MetricsAndTracesCapabilityState,
  params: MetricsAndTracesCapabilityQueryParameters,
  correlationId: string,
  traceId: string,
  auditFn: (event: MetricsAndTracesCapabilityAuditEvent) => MetricsAndTracesCapabilityError | null,
): MetricsAndTracesCapabilityQueryResponse {
  const validationError = validateQueryParameters(params);
  if (validationError !== null) {
    return {
      kind: 'FAILURE',
      error: { ...validationError, correlationId, traceId },
    };
  }

  if (!state.metricsProviderAvailable) {
    return {
      kind: 'FAILURE',
      error: {
        kind: 'PROVIDER_UNAVAILABLE',
        message: 'Metrics provider unavailable',
        correlationId,
        traceId,
      },
    };
  }

  const auditError = auditContractChange(
    `Metrics query: ${JSON.stringify(params)}`,
    correlationId,
    traceId,
    auditFn,
  );
  if (auditError !== null) {
    return {
      kind: 'FAILURE',
      error: { ...auditError, correlationId, traceId },
    };
  }

  return {
    kind: 'SUCCESS',
    data: { metrics: [] },
    correlationId,
    traceId,
  };
}

export function queryReadiness(
  state: MetricsAndTracesCapabilityState,
  correlationId: string,
  traceId: string,
): MetricsAndTracesCapabilityReadinessResponse {
  if (!state.metricsProviderAvailable && !state.tracesProviderAvailable) {
    return {
      kind: 'FAILURE',
      error: {
        kind: 'PROVIDER_UNAVAILABLE',
        message: 'Both metrics and traces providers unavailable',
        correlationId,
        traceId,
      },
    };
  }

  let readinessState: MetricsAndTracesCapabilityReadinessState;
  if (state.metricsProviderAvailable && state.tracesProviderAvailable) {
    readinessState = 'READY';
  } else if (state.metricsProviderAvailable) {
    readinessState = 'DEGRADED_TRACES';
  } else {
    readinessState = 'DEGRADED_METRICS';
  }

  return {
    kind: 'SUCCESS',
    state: readinessState,
    correlationId,
    traceId,
  };
}

export function updateProviderAvailability(
  state: MetricsAndTracesCapabilityState,
  metricsAvailable: boolean,
  tracesAvailable: boolean,
  correlationId: string,
  traceId: string,
  auditFn: (event: MetricsAndTracesCapabilityAuditEvent) => MetricsAndTracesCapabilityError | null,
): MetricsAndTracesCapabilityState | MetricsAndTracesCapabilityError {
  const auditError = auditConfigurationChange(
    `Provider availability update: metrics=${metricsAvailable}, traces=${tracesAvailable}`,
    correlationId,
    traceId,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    metricsProviderAvailable: metricsAvailable,
    tracesProviderAvailable: tracesAvailable,
    lastReadinessState: null,
    lastError: null,
  };
}

export function checkPermission(
  organisationId: string | undefined,
  tenantId: string | undefined,
): boolean {
  if (organisationId === undefined || tenantId === undefined) {
    return false;
  }
  return true;
}

export function enforcePermission(
  organisationId: string | undefined,
  tenantId: string | undefined,
  correlationId: string,
  traceId: string,
): MetricsAndTracesCapabilityError | null {
  if (!checkPermission(organisationId, tenantId)) {
    return {
      kind: 'PERMISSION_DENIED',
      message: 'Missing required scoped attributes',
      correlationId,
      traceId,
    };
  }
  return null;
}

export function createSpan(
  kind: MetricsAndTracesCapabilitySpanKind,
  name: string,
  organisationId: string,
  tenantId: string,
  correlationId: string,
  traceId: string,
): { readonly kind: MetricsAndTracesCapabilitySpanKind; readonly name: string; readonly organisationId: string; readonly tenantId: string; readonly correlationId: string; readonly traceId: string } {
  return {
    kind,
    name,
    organisationId,
    tenantId,
    correlationId,
    traceId,
  };
}