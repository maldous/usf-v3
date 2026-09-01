import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/browsertelemetrygrafanafarorumandbrowsertobfftracing.ts";

test("browsertelemetrygrafanafarorumandbrowsertobfftracingauditmodel", () => {
  const initial = capability.initialState;
  const config: capability.BrowserTelemetryConfig = {
    receiver: { endpoint: "https://rum.example.com", headers: {} },
    collector: { endpoint: "https://collector.example.com", headers: {} },
    backends: {
      trace: { endpoint: "https://tempo.example.com", headers: {} },
      log: { endpoint: "https://loki.example.com", headers: {} },
    },
    allowedAttributeNames: ["tenant", "request"],
    allowedSpanNames: ["browser-to-bff-tracing-proof"],
  };
  const traceId = "5B8EFFF798038103D269B633813FC60C";
  const spanId = "E19A3088306943A38E560C0000000001";
  const requestId = "req-123";

  const updatedState = capability.updateConfig(
    initial,
    config,
    requestId,
    traceId,
    spanId,
  );
  assert.strictEqual(updatedState.lastAuditEvents.length, 1);
  const auditEvent = updatedState.lastAuditEvents[0];
  assert.strictEqual(auditEvent.action, "CONFIG_CHANGE");
  assert.strictEqual(auditEvent.traceId, traceId);
  assert.strictEqual(auditEvent.spanId, spanId);
  assert.strictEqual(auditEvent.requestId, requestId);

  const payload: capability.BrowserTelemetryPayload = {
    traceContext: { traceId, spanId },
    name: "browser-to-bff-tracing-proof",
    kind: 0,
    startTimeUnixNano: Date.now().toString(),
    attributes: { tenant: "acme" },
  };
  const processedState = capability.processBrowserTelemetry(
    updatedState,
    config,
    payload,
    requestId,
  );
  assert.strictEqual(processedState.lastAuditEvents.length, 2);
  const contractAudit = processedState.lastAuditEvents[1];
  assert.strictEqual(contractAudit.action, "CONTRACT_CHANGE");
  assert.strictEqual(contractAudit.traceId, traceId);
  assert.strictEqual(contractAudit.spanId, spanId);
  assert.strictEqual(contractAudit.requestId, requestId);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingcontracts", () => {
  const config: capability.BrowserTelemetryConfig = {
    receiver: { endpoint: "https://rum.example.com", headers: { "x-tenant": "acme" } },
    collector: { endpoint: "https://collector.example.com", headers: {} },
    backends: {
      trace: { endpoint: "https://tempo.example.com", headers: {} },
      log: { endpoint: "https://loki.example.com", headers: {} },
    },
    allowedAttributeNames: ["tenant"],
    allowedSpanNames: ["browser-to-bff-tracing-proof"],
  };
  const validatedConfig = capability.validateConfig(config);
  if ("kind" in validatedConfig) throw new Error("Config should be valid");
  assert.strictEqual(validatedConfig.receiver.endpoint, "https://rum.example.com");
  assert.strictEqual(validatedConfig.collector.endpoint, "https://collector.example.com");
  assert.strictEqual(validatedConfig.backends.trace.endpoint, "https://tempo.example.com");
  assert.strictEqual(validatedConfig.backends.log.endpoint, "https://loki.example.com");
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingerrormodel", () => {
  const invalidConfig = { receiver: null };
  const error = capability.validateConfig(invalidConfig);
  assert.ok("kind" in error);
  const typedError = error as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.strictEqual(typedError.kind, "CONFIG_INVALID");
  assert.strictEqual(typeof typedError.message, "string");

  const stateWithError = capability.updateConfig(
    capability.initialState,
    invalidConfig,
    "req-1",
    "trace-1",
    "span-1",
  );
  assert.strictEqual(stateWithError.readiness, "DEGRADED");
  assert.notStrictEqual(stateWithError.lastError, null);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracinglifecycle", () => {
  const config: capability.BrowserTelemetryConfig = {
    receiver: { endpoint: "https://rum.example.com", headers: {} },
    collector: { endpoint: "https://collector.example.com", headers: {} },
    backends: {
      trace: { endpoint: "https://tempo.example.com", headers: {} },
      log: { endpoint: "https://loki.example.com", headers: {} },
    },
    allowedAttributeNames: ["tenant"],
    allowedSpanNames: ["browser-to-bff-tracing-proof"],
  };
  const traceId = "5B8EFFF798038103D269B633813FC60C";
  const spanId = "E19A3088306943A38E560C0000000001";
  const payload: capability.BrowserTelemetryPayload = {
    traceContext: { traceId, spanId },
    name: "browser-to-bff-tracing-proof",
    kind: 0,
    startTimeUnixNano: Date.now().toString(),
    attributes: { tenant: "acme" },
  };
  const state = capability.processBrowserTelemetry(
    capability.initialState,
    config,
    payload,
    "req-1",
  );
  assert.strictEqual(state.readiness, "READY");
  assert.strictEqual(state.lastProcessedPayload?.traceContext.traceId, traceId);
  assert.strictEqual(state.lastProcessedPayload?.traceContext.spanId, spanId);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingpermissions", () => {
  const invalidConfig = { receiver: { endpoint: "", headers: {} } };
  const error = capability.validateConfig(invalidConfig);
  assert.ok("kind" in error);
  const typedError = error as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.strictEqual(typedError.kind, "CONFIG_INVALID");

  const invalidPayload = { traceContext: {}, name: "", kind: 0, startTimeUnixNano: "", attributes: {} };
  const config: capability.BrowserTelemetryConfig = {
    receiver: { endpoint: "https://rum.example.com", headers: {} },
    collector: { endpoint: "https://collector.example.com", headers: {} },
    backends: {
      trace: { endpoint: "https://tempo.example.com", headers: {} },
      log: { endpoint: "https://loki.example.com", headers: {} },
    },
    allowedAttributeNames: ["tenant"],
    allowedSpanNames: ["allowed-span"],
  };
  const validation = capability.validateBrowserTelemetryPayload(invalidPayload, config);
  assert.ok("kind" in validation);
  const typedValidation = validation as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.strictEqual(typedValidation.kind, "SHAPE_VALIDATION_FAILED");
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingproof", () => {
  const config: capability.BrowserTelemetryConfig = {
    receiver: { endpoint: "https://rum.example.com", headers: {} },
    collector: { endpoint: "https://collector.example.com", headers: {} },
    backends: {
      trace: { endpoint: "https://tempo.example.com", headers: {} },
      log: { endpoint: "https://loki.example.com", headers: {} },
    },
    allowedAttributeNames: ["proof"],
    allowedSpanNames: ["browser-to-bff-tracing-proof"],
  };
  const traceId = "5B8EFFF798038103D269B633813FC60C";
  const spanId = "E19A3088306943A38E560C0000000001";
  const state = capability.processBrowserTelemetry(
    capability.initialState,
    config,
    {
      traceContext: { traceId, spanId },
      name: "browser-to-bff-tracing-proof",
      kind: 0,
      startTimeUnixNano: Date.now().toString(),
      attributes: { proof: true },
    },
    "req-1",
  );
  const proof = capability.generateEndToEndProof(state, config, traceId, spanId, "req-2");
  assert.ok("kind" in proof && proof.kind === "SUCCESS");
  const successProof = proof as { readonly kind: "SUCCESS"; readonly traceId: string; readonly spanId: string };
  assert.strictEqual(successProof.traceId, traceId);
  assert.strictEqual(successProof.spanId, spanId);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingreadinessmodel", () => {
  assert.strictEqual(capability.initialState.readiness, "NOT_READY");
  const degradedState: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    readiness: "DEGRADED",
    lastError: { kind: "CONFIG_MISSING", message: "missing" },
    lastAuditEvents: [],
    lastProcessedPayload: null,
  };
  assert.strictEqual(capability.computeReadiness(degradedState), "DEGRADED");
  const readyState: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    readiness: "READY",
    lastError: null,
    lastAuditEvents: [],
    lastProcessedPayload: {
      traceContext: { traceId: "1", spanId: "2" },
      name: "test",
      kind: 0,
      startTimeUnixNano: "123",
      attributes: {},
    },
  };
  assert.strictEqual(capability.computeReadiness(readyState), "READY");
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingvalidation", () => {
  const config: capability.BrowserTelemetryConfig = {
    receiver: { endpoint: "https://rum.example.com", headers: {} },
    collector: { endpoint: "https://collector.example.com", headers: {} },
    backends: {
      trace: { endpoint: "https://tempo.example.com", headers: {} },
      log: { endpoint: "https://loki.example.com", headers: {} },
    },
    allowedAttributeNames: ["tenant"],
    allowedSpanNames: ["allowed-span"],
  };
  const invalidTraceContext = { traceId: "", spanId: "1" };
  const traceError = capability.validateTraceContext(invalidTraceContext);
  assert.ok("kind" in traceError);
  const typedTraceError = traceError as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.strictEqual(typedTraceError.kind, "TRACE_CONTEXT_INVALID");

  const invalidPayload = {
    traceContext: { traceId: "1", spanId: "2" },
    name: "disallowed-span",
    kind: 0,
    startTimeUnixNano: "123",
    attributes: { tenant: "acme" },
  };
  const payloadError = capability.validateBrowserTelemetryPayload(invalidPayload, config);
  assert.ok("kind" in payloadError);
  const typedPayloadError = payloadError as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.strictEqual(typedPayloadError.kind, "SHAPE_VALIDATION_FAILED");
});