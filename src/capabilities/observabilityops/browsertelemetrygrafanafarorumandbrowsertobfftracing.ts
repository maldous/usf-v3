export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness =
  typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness[number];

export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind = [
  'AUDIT_FAILURE',
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
  'ALERT_THRESHOLD_EXCEEDED',
  'SEMANTIC_DRIFT',
  'CONFIGURATION_LOSS',
  'PIPELINE_FAILURE',
] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind =
  typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind[number];

export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind = [
  'CONFIG_CHANGE',
  'CONTRACT_CHANGE',
] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind =
  typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind[number];

export const OBSERVABILITY_VOCABULARY = [
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'url.full',
  'url.path',
  'server.address',
  'server.port',
  'client.address',
  'user_agent.original',
  'browser.to_bff.span',
  'browser.to_bff.span.kind',
  'bff.api.span',
  'bff.api.span.kind',
  'collector.receiver.span',
  'collector.export.span',
  'telemetry.rum.resource',
  'telemetry.rum.session',
  'telemetry.rum.view',
  'telemetry.rum.action',
  'telemetry.error.count',
  'telemetry.pipeline.healthy',
  'telemetry.audit.event',
  'telemetry.readiness.state',
  'trace.context.trace_id',
  'trace.context.span_id',
  'trace.context.trace_flags',
  'enduser.id',
  'tenant.id',
  'request.id',
] as const;
export type ObservabilityVocabulary = typeof OBSERVABILITY_VOCABULARY[number];

export const OBSERVABILITY_SPAN_NAMES = [
  'browser.to_bff.request',
  'bff.api.handler',
  'collector.receiver.ingest',
  'collector.export.tempo',
  'collector.export.loki',
] as const;
export type ObservabilitySpanName = typeof OBSERVABILITY_SPAN_NAMES[number];

export const ALERT_THRESHOLD_DEFAULT = 5;

export interface BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  readonly kind: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind;
  readonly message: string;
  readonly requestId?: string;
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
  readonly attributes: readonly {
    readonly key: ObservabilityVocabulary;
    readonly value: string | number | boolean;
  }[];
  readonly spanName: ObservabilitySpanName;
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
  readonly alertThreshold: number;
  readonly alertActive: boolean;
}

export interface BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingCollectionContract {
  readonly collectionEndpoint: 'receiverEndpoint';
  readonly spans: {
    readonly clientBoundary: 'browser.to_bff.request';
    readonly serverBoundary: 'bff.api.handler';
    readonly collectorBoundary: 'collector.receiver.ingest';
    readonly tempoBoundary: 'collector.export.tempo';
    readonly lokiBoundary: 'collector.export.loki';
  };
  readonly vocabulary: {
    readonly attributes: readonly ObservabilityVocabulary[];
    readonly spans: readonly ObservabilitySpanName[];
  };
}
export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingCollectionContract: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingCollectionContract = {
  collectionEndpoint: 'receiverEndpoint',
  spans: {
    clientBoundary: 'browser.to_bff.request',
    serverBoundary: 'bff.api.handler',
    collectorBoundary: 'collector.receiver.ingest',
    tempoBoundary: 'collector.export.tempo',
    lokiBoundary: 'collector.export.loki',
  },
  vocabulary: {
    attributes: OBSERVABILITY_VOCABULARY,
    spans: OBSERVABILITY_SPAN_NAMES,
  },
};

export const initialState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
  config: null,
  readiness: 'NOT_READY',
  errorCount: 0,
  lastError: null,
  alertThreshold: ALERT_THRESHOLD_DEFAULT,
  alertActive: false,
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeAuditFailure(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Audit callback failed';
}

function buildFailureReadiness(state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness {
  return state.readiness === 'NOT_READY' ? 'NOT_READY' : 'DEGRADED';
}

function isInvalidResultError(
  error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  if (error !== null) {
    return error;
  }
  return {
    kind: 'SHAPE_VALIDATION_FAILED',
    message: 'Invalid telemetry payload',
  };
}

export function isObservabilityVocabulary(name: string): name is ObservabilityVocabulary {
  return (OBSERVABILITY_VOCABULARY as readonly string[]).includes(name);
}

export function isObservabilitySpanName(name: string): name is ObservabilitySpanName {
  return (OBSERVABILITY_SPAN_NAMES as readonly string[]).includes(name);
}

export function validateTelemetryConfiguration(
  config: TelemetryConfiguration | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null {
  if (config === null) {
    return {
      kind: 'CONFIG_MISSING',
      message: 'Telemetry configuration is missing',
    };
  }

  if (!isNonEmptyString(config.receiverEndpoint)) {
    return {
      kind: 'CONFIG_INVALID',
      message: 'Receiver endpoint is missing or invalid',
    };
  }

  if (!isNonEmptyString(config.collectorEndpoint)) {
    return {
      kind: 'CONFIG_INVALID',
      message: 'Collector endpoint is missing or invalid',
    };
  }

  if (!isNonEmptyString(config.backendEndpoint)) {
    return {
      kind: 'CONFIG_INVALID',
      message: 'Backend endpoint is missing or invalid',
    };
  }

  return null;
}

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

  const p = payload as Record<string, unknown>;
  if (
    typeof p.context !== 'object' ||
    p.context === null ||
    !('traceId' in p.context) ||
    !('spanId' in p.context) ||
    typeof p.context.traceId !== 'string' ||
    p.context.traceId.length === 0 ||
    typeof p.context.spanId !== 'string' ||
    p.context.spanId.length === 0
  ) {
    return {
      isValid: false,
      error: { kind: 'TRACE_CONTEXT_MISSING', message: 'Missing or empty traceId or spanId' },
    };
  }

  if ('traceFlags' in p.context && typeof p.context.traceFlags !== 'number') {
    return {
      isValid: false,
      error: { kind: 'TRACE_CONTEXT_INVALID', message: 'traceFlags must be a number' },
    };
  }

  if (
    typeof p.spanName !== 'string' ||
    p.spanName.length === 0 ||
    !isObservabilitySpanName(p.spanName)
  ) {
    return {
      isValid: false,
      error: { kind: 'TRACE_CONTEXT_INVALID', message: 'Invalid span name' },
    };
  }

  if (typeof p.timestamp !== 'string' || p.timestamp.length === 0) {
    return {
      isValid: false,
      error: { kind: 'SHAPE_VALIDATION_FAILED', message: 'Missing or invalid timestamp' },
    };
  }

  if (!Array.isArray(p.attributes)) {
    return {
      isValid: false,
      error: { kind: 'SHAPE_VALIDATION_FAILED', message: 'Attributes must be an array' },
    };
  }

  for (const rawAttribute of p.attributes as Array<unknown>) {
    if (typeof rawAttribute !== 'object' || rawAttribute === null) {
      return {
        isValid: false,
        error: { kind: 'SHAPE_VALIDATION_FAILED', message: 'Invalid attribute entry' },
      };
    }

    const attr = rawAttribute as {
      readonly key: unknown;
      readonly value: unknown;
    };

    if (
      typeof attr.key !== 'string' ||
      attr.key.length === 0 ||
      !isObservabilityVocabulary(attr.key)
    ) {
      return {
        isValid: false,
        error: { kind: 'SHAPE_VALIDATION_FAILED', message: 'Invalid attribute key' },
      };
    }

    if (
      typeof attr.value !== 'string' &&
      typeof attr.value !== 'number' &&
      typeof attr.value !== 'boolean'
    ) {
      return {
        isValid: false,
        error: { kind: 'SHAPE_VALIDATION_FAILED', message: 'Invalid attribute value type' },
      };
    }
  }

  return { isValid: true, error: null };
}

export function auditTelemetryChange(
  requestId: string,
  traceId: string,
  description: string,
  kind: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind,
  auditFn: (
    event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent,
  ) => BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null {
  const event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent = {
    kind,
    requestId,
    traceId,
    changeDescription: description,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function evaluateReadiness(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  receiverOnline: boolean,
  collectorOnline: boolean,
  backendOnline: boolean,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness {
  if (state.config === null || !state.config.enabled) {
    return 'DEGRADED';
  }

  if (validateTelemetryConfiguration(state.config) !== null) {
    return 'DEGRADED';
  }

  if (!receiverOnline || !collectorOnline || !backendOnline) {
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

function runSafeAudit(
  requestId: string,
  traceId: string,
  description: string,
  kind: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEventKind,
  auditFn: (
    event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent,
  ) => BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null {
  try {
    return auditTelemetryChange(requestId, traceId, description, kind, auditFn);
  } catch (error) {
    return {
      kind: 'AUDIT_FAILURE',
      message: safeAuditFailure(error),
      requestId,
      traceId,
    };
  }
}

function buildStateFailure(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError,
): {
  readonly outcome: 'FAILURE';
  readonly newState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState;
  readonly error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
} {
  return {
    outcome: 'FAILURE',
    newState: {
      ...state,
      readiness: buildFailureReadiness(state),
      errorCount: state.errorCount + 1,
      lastError: error,
    },
    error,
  };
}

export function updateTelemetryConfig(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  newConfig: TelemetryConfiguration,
  requestId: string,
  traceId: string,
  auditFn: (
    event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent,
  ) => BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState | BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  const configValidationError = validateTelemetryConfiguration(newConfig);
  if (configValidationError !== null && configValidationError.kind !== 'CONFIG_MISSING') {
    return configValidationError;
  }

  const nextState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    ...state,
    config: newConfig,
    readiness: evaluateReadiness(
      { ...state, config: newConfig },
      true,
      true,
      true,
    ),
    errorCount: 0,
    lastError: null,
    alertActive: false,
  };

  const auditError = runSafeAudit(
    requestId,
    traceId,
    'Update Telemetry Configuration',
    'CONFIG_CHANGE',
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return nextState;
}

export function updateTelemetryContract(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  newConfig: TelemetryConfiguration,
  requestId: string,
  traceId: string,
  auditFn: (
    event: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent,
  ) => BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState | BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  const configValidationError = validateTelemetryConfiguration(newConfig);
  if (configValidationError !== null && configValidationError.kind !== 'CONFIG_MISSING') {
    return configValidationError;
  }

  const nextState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    ...state,
    config: newConfig,
    readiness: evaluateReadiness(
      { ...state, config: newConfig },
      true,
      true,
      true,
    ),
    errorCount: 0,
    lastError: null,
    alertActive: false,
  };

  const auditError = runSafeAudit(
    requestId,
    traceId,
    'Update Telemetry Collection Contract',
    'CONTRACT_CHANGE',
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return nextState;
}

export function processTelemetryIngress(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  payload: unknown,
  pipelineHealthy: boolean,
): {
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly newState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState;
  readonly error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
} {
  if (state.config !== null && !state.config.enabled) {
    return buildStateFailure(state, {
      kind: 'CONFIG_MISSING',
      message: 'Telemetry configuration exists but is disabled',
    });
  }

  const validation = validateTelemetryPayload(payload);
  if (!validation.isValid) {
    const rawError = isInvalidResultError(validation.error);
    const mappedError =
      state.config === null && rawError.kind === 'TRACE_CONTEXT_MISSING'
        ? { ...rawError, kind: 'SHAPE_VALIDATION_FAILED' as const }
        : rawError;
    return buildStateFailure(state, mappedError);
  }

  if (state.config === null) {
    return buildStateFailure(state, {
      kind: 'CONFIG_MISSING',
      message: 'Telemetry configuration is missing',
    });
  }

  const configError = validateTelemetryConfiguration(state.config);
  if (
    configError !== null &&
    (configError.kind === 'CONFIG_INVALID' || configError.kind === 'CONFIG_MISSING')
  ) {
    return buildStateFailure(state, configError);
  }

  if (!pipelineHealthy) {
    return buildStateFailure(state, {
      kind: 'PIPELINE_FAILURE',
      message: 'Telemetry pipeline is unhealthy',
    });
  }

  return {
    outcome: 'SUCCESS',
    newState: {
      ...state,
      readiness: evaluateReadiness(state, true, true, true),
      errorCount: 0,
      lastError: null,
      alertActive: false,
    },
    error: null,
  };
}

export function recordTypedError(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError,
): {
  readonly newState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState;
  readonly alertRaised: boolean;
  readonly alertError: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
} {
  const nextCount = state.errorCount + 1;
  const thresholdExceeded = nextCount >= state.alertThreshold;
  const newState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    ...state,
    errorCount: nextCount,
    lastError: error,
    alertActive: thresholdExceeded,
  };

  if (!thresholdExceeded) {
    return { newState, alertRaised: false, alertError: null };
  }

  const alertError: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError = {
    kind: 'ALERT_THRESHOLD_EXCEEDED',
    message: `Typed error threshold (${state.alertThreshold}) exceeded for kind=${error.kind}`,
    traceId: error.traceId,
    spanId: error.spanId,
  };

  return { newState, alertRaised: true, alertError };
}

export function ingestTelemetryWithAlert(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  payload: unknown,
  pipelineHealthy: boolean,
): {
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly newState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState;
  readonly error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
  readonly alertRaised: boolean;
  readonly alertError: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
} {
  const result = processTelemetryIngress(state, payload, pipelineHealthy);
  if (result.outcome === 'SUCCESS') {
    return {
      outcome: 'SUCCESS',
      newState: result.newState,
      error: null,
      alertRaised: false,
      alertError: null,
    };
  }

  const err = isInvalidResultError(result.error);
  const alertBaseState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    ...result.newState,
    errorCount: state.errorCount,
  };
  const alertResult = recordTypedError(alertBaseState, err);
  return {
    outcome: 'FAILURE',
    newState: alertResult.newState,
    error: err,
    alertRaised: alertResult.alertRaised,
    alertError: alertResult.alertError,
  };
}

export function detectSemanticDrift(
  currentVocabulary: readonly string[],
  currentSpanNames: readonly string[],
  expectedVocabulary: readonly string[],
  expectedSpanNames: readonly string[],
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null {
  for (const v of currentVocabulary) {
    if (!(expectedVocabulary as readonly string[]).includes(v)) {
      return {
        kind: 'SEMANTIC_DRIFT',
        message: `Attribute name '${v}' is not in the controlled observability vocabulary`,
      };
    }
  }
  for (const s of currentSpanNames) {
    if (!(expectedSpanNames as readonly string[]).includes(s)) {
      return {
        kind: 'SEMANTIC_DRIFT',
        message: `Span name '${s}' is not in the controlled span vocabulary`,
      };
    }
  }
  return null;
}

export function detectConfigurationLoss(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null {
  if (state.config === null) {
    return {
      kind: 'CONFIGURATION_LOSS',
      message: 'Telemetry configuration has been lost (no config present in state)',
    };
  }
  if (!state.config.enabled) {
    return {
      kind: 'CONFIGURATION_LOSS',
      message: 'Telemetry configuration is present but disabled',
    };
  }
  if (!isNonEmptyString(state.config.receiverEndpoint)) {
    return {
      kind: 'CONFIGURATION_LOSS',
      message: 'Receiver endpoint is empty',
    };
  }
  if (!isNonEmptyString(state.config.collectorEndpoint)) {
    return {
      kind: 'CONFIGURATION_LOSS',
      message: 'Collector endpoint is empty',
    };
  }
  if (!isNonEmptyString(state.config.backendEndpoint)) {
    return {
      kind: 'CONFIGURATION_LOSS',
      message: 'Backend endpoint is empty',
    };
  }
  return null;
}

export function handleProviderFailure(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  failureKind: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind,
  message: string,
  traceId?: string,
  spanId?: string,
): {
  readonly newState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState;
  readonly error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  readonly alertRaised: boolean;
  readonly alertError: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
} {
  const error: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError = {
    kind: failureKind,
    message,
    ...(traceId !== undefined ? { traceId } : {}),
    ...(spanId !== undefined ? { spanId } : {}),
  };
  const stateWithReadiness: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    ...state,
    readiness:
      state.config === null || !state.config.enabled
        ? 'NOT_READY'
        : 'DEGRADED',
  };
  const alertResult = recordTypedError(stateWithReadiness, error);
  return {
    newState: alertResult.newState,
    error,
    alertRaised: alertResult.alertRaised,
    alertError: alertResult.alertError,
  };
}