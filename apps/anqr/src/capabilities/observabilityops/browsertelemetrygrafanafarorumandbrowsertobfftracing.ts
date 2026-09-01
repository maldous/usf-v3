export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness = typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness[number];

export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind = [
  'CONFIG_MISSING',
  'CONFIG_INVALID',
  'RECEIVER_UNAVAILABLE',
  'COLLECTOR_UNAVAILABLE',
  'BACKEND_UNAVAILABLE',
  'TRACE_CONTEXT_MISSING',
  'TRACE_CONTEXT_INVALID',
  'SHAPE_VALIDATION_FAILED',
] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind = typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind[number];

export interface BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  readonly kind: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingErrorKind;
  readonly message: string;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags?: number;
}

export interface BrowserTelemetryPayload {
  readonly traceContext: TraceContext;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface BrowserTelemetryContract {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface BrowserTelemetryConfig {
  readonly receiver: BrowserTelemetryContract;
  readonly collector: BrowserTelemetryContract;
  readonly backends: Readonly<{
    readonly trace: BrowserTelemetryContract;
    readonly log: BrowserTelemetryContract;
  }>;
  readonly allowedAttributeNames: readonly string[];
  readonly allowedSpanNames: readonly string[];
}

export interface AuditEvent {
  readonly timestamp: string;
  readonly action: 'CONFIG_CHANGE' | 'CONTRACT_CHANGE';
  readonly traceId: string;
  readonly spanId: string;
  readonly requestId: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = Readonly<{
  readonly readiness: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness;
  readonly lastError: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null;
  readonly lastAuditEvents: readonly AuditEvent[];
  readonly lastProcessedPayload: BrowserTelemetryPayload | null;
}>;

export const initialState: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
  readiness: 'NOT_READY',
  lastError: null,
  lastAuditEvents: [],
  lastProcessedPayload: null,
};

export function validateConfig(
  config: unknown,
): BrowserTelemetryConfig | BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('receiver' in config) ||
    !('collector' in config) ||
    !('backends' in config) ||
    !('allowedAttributeNames' in config) ||
    !('allowedSpanNames' in config)
  ) {
    return { kind: 'CONFIG_MISSING', message: 'Telemetry configuration is missing required fields' };
  }

  const typedConfig = config as Record<string, unknown>;
  if (
    typeof typedConfig.receiver !== 'object' ||
    typedConfig.receiver === null ||
    typeof typedConfig.collector !== 'object' ||
    typedConfig.collector === null ||
    typeof typedConfig.backends !== 'object' ||
    typedConfig.backends === null ||
    !Array.isArray(typedConfig.allowedAttributeNames) ||
    !Array.isArray(typedConfig.allowedSpanNames)
  ) {
    return { kind: 'CONFIG_INVALID', message: 'Telemetry configuration has invalid structure' };
  }

  const backends = typedConfig.backends as Record<string, unknown>;
  if (
    typeof backends.trace !== 'object' ||
    backends.trace === null ||
    typeof backends.log !== 'object' ||
    backends.log === null
  ) {
    return { kind: 'CONFIG_INVALID', message: 'Telemetry backends configuration is invalid' };
  }

  return {
    receiver: typedConfig.receiver as BrowserTelemetryContract,
    collector: typedConfig.collector as BrowserTelemetryContract,
    backends: {
      trace: backends.trace as BrowserTelemetryContract,
      log: backends.log as BrowserTelemetryContract,
    },
    allowedAttributeNames: typedConfig.allowedAttributeNames as string[],
    allowedSpanNames: typedConfig.allowedSpanNames as string[],
  };
}

export function validateTraceContext(
  traceContext: unknown,
): TraceContext | BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  if (
    traceContext === null ||
    typeof traceContext !== 'object' ||
    !('traceId' in traceContext) ||
    !('spanId' in traceContext)
  ) {
    return { kind: 'TRACE_CONTEXT_MISSING', message: 'Trace context is missing required fields' };
  }

  const ctx = traceContext as Record<string, unknown>;
  if (
    typeof ctx.traceId !== 'string' ||
    ctx.traceId.length === 0 ||
    typeof ctx.spanId !== 'string' ||
    ctx.spanId.length === 0
  ) {
    return { kind: 'TRACE_CONTEXT_INVALID', message: 'Trace context fields are invalid' };
  }

  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    traceFlags: typeof ctx.traceFlags === 'number' ? ctx.traceFlags : undefined,
  };
}

export function validateBrowserTelemetryPayload(
  payload: unknown,
  config: BrowserTelemetryConfig,
): BrowserTelemetryPayload | BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !('traceContext' in payload) ||
    !('name' in payload) ||
    !('kind' in payload) ||
    !('startTimeUnixNano' in payload) ||
    !('attributes' in payload)
  ) {
    return { kind: 'SHAPE_VALIDATION_FAILED', message: 'Browser telemetry payload has invalid shape' };
  }

  const typedPayload = payload as Record<string, unknown>;
  const traceContextResult = validateTraceContext(typedPayload.traceContext);
  if ('kind' in traceContextResult && 'message' in traceContextResult) {
    return traceContextResult;
  }

  if (
    typeof typedPayload.name !== 'string' ||
    typedPayload.name.length === 0 ||
    typeof typedPayload.kind !== 'number' ||
    typeof typedPayload.startTimeUnixNano !== 'string' ||
    typedPayload.startTimeUnixNano.length === 0 ||
    typeof typedPayload.attributes !== 'object' ||
    typedPayload.attributes === null
  ) {
    return { kind: 'SHAPE_VALIDATION_FAILED', message: 'Browser telemetry payload fields are invalid' };
  }

  if (!config.allowedSpanNames.includes(typedPayload.name)) {
    return { kind: 'SHAPE_VALIDATION_FAILED', message: 'Browser telemetry span name is not allowed' };
  }

  const attributes = typedPayload.attributes as Record<string, unknown>;
  for (const key of Object.keys(attributes)) {
    if (!config.allowedAttributeNames.includes(key)) {
      return { kind: 'SHAPE_VALIDATION_FAILED', message: `Browser telemetry attribute name "${key}" is not allowed` };
    }
  }

  return {
    traceContext: traceContextResult,
    name: typedPayload.name,
    kind: typedPayload.kind,
    startTimeUnixNano: typedPayload.startTimeUnixNano,
    attributes,
  };
}

export function recordAuditEvent(
  action: 'CONFIG_CHANGE' | 'CONTRACT_CHANGE',
  traceId: string,
  spanId: string,
  requestId: string,
  details: Readonly<Record<string, unknown>>,
): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    action,
    traceId,
    spanId,
    requestId,
    details,
  };
}

export function computeReadiness(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness {
  if (state.lastError !== null) {
    return 'DEGRADED';
  }
  if (state.lastProcessedPayload !== null) {
    return 'READY';
  }
  return 'NOT_READY';
}

export function processBrowserTelemetry(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  config: BrowserTelemetryConfig,
  payload: unknown,
  requestId: string,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState {
  const validatedPayload = validateBrowserTelemetryPayload(payload, config);
  if ('kind' in validatedPayload && 'message' in validatedPayload) {
    const error = validatedPayload as BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
    return {
      ...state,
      readiness: 'DEGRADED',
      lastError: error,
      lastProcessedPayload: null,
    };
  }

  const validated = validatedPayload as BrowserTelemetryPayload;
  const auditEvent = recordAuditEvent(
    'CONTRACT_CHANGE',
    validated.traceContext.traceId,
    validated.traceContext.spanId,
    requestId,
    { payloadName: validated.name },
  );

  return {
    ...state,
    readiness: computeReadiness({
      ...state,
      lastError: null,
      lastProcessedPayload: validated,
    }),
    lastError: null,
    lastAuditEvents: [...state.lastAuditEvents, auditEvent],
    lastProcessedPayload: validated,
  };
}

export function updateConfig(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  newConfig: unknown,
  requestId: string,
  traceId: string,
  spanId: string,
): BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState {
  const validatedConfig = validateConfig(newConfig);
  if ('kind' in validatedConfig && 'message' in validatedConfig) {
    const error = validatedConfig as BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
    return {
      ...state,
      readiness: 'DEGRADED',
      lastError: error,
    };
  }

  const auditEvent = recordAuditEvent(
    'CONFIG_CHANGE',
    traceId,
    spanId,
    requestId,
    { config: validatedConfig },
  );

  return {
    ...state,
    lastAuditEvents: [...state.lastAuditEvents, auditEvent],
  };
}

export function generateEndToEndProof(
  state: BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState,
  config: BrowserTelemetryConfig,
  traceId: string,
  spanId: string,
  requestId: string,
): { readonly kind: 'SUCCESS'; readonly traceId: string; readonly spanId: string } | BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError {
  if (state.readiness !== 'READY') {
    return { kind: 'RECEIVER_UNAVAILABLE', message: 'System not ready for end-to-end proof' };
  }

  const proofPayload: BrowserTelemetryPayload = {
    traceContext: { traceId, spanId },
    name: 'browser-to-bff-tracing-proof',
    kind: 0,
    startTimeUnixNano: Date.now().toString(),
    attributes: { proof: true },
  };

  const validationResult = validateBrowserTelemetryPayload(proofPayload, config);
  if ('kind' in validationResult && 'message' in validationResult) {
    return validationResult as BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  }

  return { kind: 'SUCCESS', traceId, spanId };
}