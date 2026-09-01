export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness =
  typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness[number];

export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind = [
  'CONFIG_MISSING',
  'CONFIG_INVALID',
  'RECEIVER_UNAVAILABLE',
  'COLLECTOR_UNAVAILABLE',
  'BACKEND_TO_END_FAILURE',
  'BACKEND_UNAVAILABLE',
  'TRACE_CONTEXT_MISSING',
  'TRACE_CONTEXT_INVALID',
  'SHAPE_VALIDATION_FAILED',
  'INGESTION_DENIED',
] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind =
  typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind[number];

export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind = [
  'CONFIG_CHANGE',
  'CONTRACT_CHANGE',
] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind =
  typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind[number];

export interface BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  readonly kind: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind;
  readonly message: string;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent {
  readonly kind: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind;
  readonly requestId: string;
  readonly traceId: string;
  readonly changeDescription: string;
  readonly timestamp: string;
}

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags?: number;
}

export interface BrowserTelemetryPayload {
  readonly context: TraceContext;
  readonly attributes: readonly { readonly key: string; readonly value: string | number | boolean }[];
  readonly spanName: string;
  readonly timestamp: string;
}

export interface TelemetryConfiguration {
  readonly receiverEndpoint: string;
  readonly collectorEndpoint: string;
  readonly backendEndpoint: string;
  readonly enabled: boolean;
}

export interface BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState {
  readonly config: TelemetryConfiguration | null;
  readonly readiness: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness;
  readonly errorCount: number;
  readonly lastError: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
}

export const initialState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
  config: null,
  readiness: 'NOT_READY',
  errorCount: 0,
  lastError: null,
};

export function validateTelemetryPayload(
  payload: unknown,
): {
  readonly isValid: boolean;
  readonly error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
} {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('context' in payload) ||
    !('spanName' in payload) ||
    !('timestamp' in payload) ||
    !('attributes' in payload)
  ) {
    return {
      isValid: false,
      error: { kind: 'SHAPE_VALIDATION_FAILED', message: 'Payload shape is invalid' },
    };
  }

  const p = payload as BrowserTelemetryPayload;
  if (!p.context || typeof p.context.traceId !== 'string' || p.context.traceId.length === 0) {
    return {
      isValid: false,
      error: { kind: 'TRACE_CONTEXT_MISSING', message: 'Missing or empty traceId' },
    };
  }

  if (typeof p.spanName !== 'string' || p.spanName.length === 0) {
    return {
      isValid: false,
      error: { kind: 'TRACE_CONTEXT_INVALID', message: 'Invalid span name' },
    };
  }

  return { isValid: true, error: null };
}

export function auditTelemetryChange(
  requestId: string,
  traceId: string,
  description: string,
  auditFn: (event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent) => BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null {
  const event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent = {
    kind: 'CONFIG_CHANGE',
    requestId,
    traceId,
    changeDescription: description,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function updateTelemetryConfig(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  newConfig: TelemetryConfiguration,
  requestId: string,
  traceId: string,
  auditFn: (event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent) => BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState | BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  const auditError = auditTelemetryChange(requestId, traceId, 'Update Telemetry Configuration', auditFn);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    config: newConfig,
    readiness: 'READY',
    errorCount: 0,
    lastError: null,
  };
}

export function processTelemetryIngress(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  payload: unknown,
  pipelineHealthy: boolean,
): {
  readonly newState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState;
  readonly result: 'SUCCESS' | 'FAILURE';
  readonly error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
} {
  if (!state.config || !state.config.enabled) {
    return {
      newState: state,
      result: 'FAILURE',
      error: { kind: 'CONFIG_MISSING', message: 'Telemetry is not configured or enabled' },
    };
  }

  const validation = validateTelemetryPayload(payload);
  if (!validation.isValid) {
    const err = validation.error!;
    return {
      newState: { ...state, errorCount: state.errorCount + 1, lastError: err },
      result: 'FAILURE',
      error: err,
    };
  }

  if (!pipelineHealthy) {
    const err: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError = {
      kind: 'BACKEND_TO_END_FAILURE',
      message: 'Telemetry pipeline is unhealthy',
    };
    return {
      newState: { ...state, errorCount: state.errorCount + 1, lastError: err },
      result: 'FAILURE',
      error: err,
    };
  }

  return {
    newState: { ...state, errorCount: 0, lastError: null },
    result: 'SUCCESS',
    error: null,
  };
}

export function evaluateReadiness(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  receiverOnline: boolean,
  collectorOnline: boolean,
  backendOnline: boolean,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness {
  if (!state.config || !receiverOnline || !collectorOnline || !backendOnline) {
    return 'DEGRADED';
  }
  return 'READY';
}

export function verifyProof(
  traceId: string,
  clientSpanPresent: boolean,
  serverSpanPresent: boolean,
  joined: boolean,
): { readonly proofVerified: boolean; readonly lineage: string } {
  const isHermetic = clientSpanPresent && serverSpanPresent && joined;
  return {
    proofVerified: isHermetic,
    lineage: `traceId=${traceId};joined=${joined}`,
  };
}