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
  assert.deepEqual(updatedState.lastAuditEvents.length, 1);
  const auditEvent = updatedState.lastAuditEvents[0];
  assert.equal(auditEvent.action, "CONFIG_CHANGE");
  assert.equal(auditEvent.traceId, traceId);
  assert.equal(auditEvent.spanId, spanId);
  assert.equal(auditEvent.requestId, requestId);

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
  assert.equal(processedState.lastAuditEvents.length, 2);
  const contractAudit = processedState.lastAuditEvents[1];
  assert.equal(contractAudit.action, "CONTRACT_CHANGE");
  assert.equal(contractAudit.traceId, traceId);
  assert.equal(contractAudit.spanId, spanId);
  assert.equal(contractAudit.requestId, requestId);
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
  assert.equal("receiver" in validatedConfig, true);
  assert.equal("collector" in validatedConfig, true);
  assert.equal("backends" in validatedConfig, true);
  assert.deepEqual(validatedConfig.receiver.endpoint, "https://rum.example.com");
  assert.deepEqual(validatedConfig.collector.endpoint, "https://collector.example.com");
  assert.deepEqual(validatedConfig.backends.trace.endpoint, "https://tempo.example.com");
  assert.deepEqual(validatedConfig.backends.log.endpoint, "https://loki.example.com");
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingerrormodel", () => {
  const invalidConfig = { receiver: null };
  const error = capability.validateConfig(invalidConfig);
  assert.equal("kind" in error, true);
  const typedError = error as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.equal(typedError.kind, "CONFIG_INVALID");
  assert.equal(typeof typedError.message, "string");

  const stateWithError = capability.updateConfig(
    capability.initialState,
    invalidConfig,
    "req-1",
    "trace-1",
    "span-1",
  );
  assert.equal(stateWithError.readiness, "DEGRADED");
  assert.notEqual(stateWithError.lastError, null);
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
  assert.equal(state.readiness, "READY");
  assert.equal(state.lastProcessedPayload?.traceContext.traceId, traceId);
  assert.equal(state.lastProcessedPayload?.traceContext.spanId, spanId);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingpermissions", () => {
  const invalidConfig = { receiver: { endpoint: "", headers: {} } };
  const error = capability.validateConfig(invalidConfig);
  assert.equal("kind" in error, true);
  const typedError = error as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.equal(typedError.kind, "CONFIG_INVALID");

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
  assert.equal("kind" in validation, true);
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
  assert.equal("kind" in proof && proof.kind === "SUCCESS", true);
  const successProof = proof as { readonly kind: "SUCCESS"; readonly traceId: string; readonly spanId: string };
  assert.equal(successProof.traceId, traceId);
  assert.equal(successProof.spanId, spanId);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingreadinessmodel", () => {
  assert.equal(capability.initialState.readiness, "NOT_READY");
  const degradedState: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    readiness: "DEGRADED",
    lastError: { kind: "CONFIG_MISSING", message: "missing" },
    lastAuditEvents: [],
    lastProcessedPayload: null,
  };
  assert.equal(capability.computeReadiness(degradedState), "DEGRADED");
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
  assert.equal(capability.computeReadiness(readyState), "READY");
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
  assert.equal("kind" in traceError, true);
  const typedTraceError = traceError as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.equal(typedTraceError.kind, "TRACE_CONTEXT_INVALID");

  const invalidPayload = {
    traceContext: { traceId: "1", spanId: "2" },
    name: "disallowed-span",
    kind: 0,
    startTimeUnixNano: "123",
    attributes: { tenant: "acme" },
  };
  const payloadError = capability.validateBrowserTelemetryPayload(invalidPayload, config);
  assert.equal("kind" in payloadError, true);
  const typedPayloadError = payloadError as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError;
  assert.equal(typedPayloadError.kind, "SHAPE_VALIDATION_FAILED");
});