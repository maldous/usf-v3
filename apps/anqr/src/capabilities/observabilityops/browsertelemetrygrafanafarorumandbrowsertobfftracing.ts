```typescript
export const BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness = typeof BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingReadiness[number];

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
  readonly trace