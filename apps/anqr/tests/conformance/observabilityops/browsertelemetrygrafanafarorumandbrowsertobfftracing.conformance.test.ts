import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/browsertelemetrygrafanafarorumandbrowsertobfftracing.ts";

test("browsertelemetrygrafanafarorumandbrowsertobfftracingauditmodel", () => {
  const traceId = "5B8EFFF798038103D269B633813FC60C";
  const requestId = "req-123";
  const auditFn = (event: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingAuditEvent): capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingError | null => {
    assert.strictEqual(event.kind, "CONFIG_CHANGE");
    assert.strictEqual(event.requestId, requestId);
    assert.strictEqual(event.traceId, traceId);
    assert.strictEqual(typeof event.changeDescription, "string");
    assert.strictEqual(typeof event.timestamp, "string");
    return null;
  };
  const config: capability.TelemetryConfiguration = {
    receiverEndpoint: "https://rum.example.com",
    collectorEndpoint: "https://collector.example.com",
    backendEndpoint: "https://tempo.example.com",
    enabled: true,
  };
  const state = capability.initialState;
  const result = capability.updateTelemetryConfig(state, config, requestId, traceId, auditFn);
  assert.ok(!("kind" in result));
  assert.strictEqual((result as capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState).config, config);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingcontracts", () => {
  const config: capability.TelemetryConfiguration = {
    receiverEndpoint: "https://rum.example.com",
    collectorEndpoint: "https://collector.example.com",
    backendEndpoint: "https://tempo.example.com",
    enabled: true,
  };
  const traceId = "5B8EFFF798038103D269B633813FC60C";
  const spanId = "E19A3088306943A38E560C0000000001";
  const payload: capability.BrowserTelemetryPayload = {
    context: { traceId, spanId },
    attributes: [{ key: "tenant", value: "acme" }],
    spanName: "browser-to-bff-tracing-proof",
    timestamp: new Date().toISOString(),
  };
  const state: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    config,
    readiness: "READY",
    errorCount: 0,
    lastError: null,
  };
  const result = capability.processTelemetryIngress(state, payload, true);
  assert.strictEqual(result.result, "SUCCESS");
  assert.strictEqual(result.error, null);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingerrormodel", () => {
  const invalidPayload = { context: { traceId: "", spanId: "" }, attributes: [], spanName: "", timestamp: "" };
  const validation = capability.validateTelemetryPayload(invalidPayload);
  assert.strictEqual(validation.isValid, false);
  assert.notStrictEqual(validation.error, null);
  assert.strictEqual(validation.error!.kind, "TRACE_CONTEXT_MISSING");

  const state = capability.initialState;
  const result = capability.processTelemetryIngress(state, invalidPayload, true);
  assert.strictEqual(result.result, "FAILURE");
  assert.notStrictEqual(result.error, null);
  assert.strictEqual(result.newState.errorCount, 1);
  assert.strictEqual(result.newState.lastError, validation.error);

  const config: capability.TelemetryConfiguration = {
    receiverEndpoint: "https://rum.example.com",
    collectorEndpoint: "https://collector.example.com",
    backendEndpoint: "https://tempo.example.com",
    enabled: false,
  };
  const stateWithDisabledConfig: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    config,
    readiness: "READY",
    errorCount: 0,
    lastError: null,
  };
  const disabledResult = capability.processTelemetryIngress(stateWithDisabledConfig, invalidPayload, true);
  assert.strictEqual(disabledResult.result, "FAILURE");
  assert.strictEqual(disabledResult.error!.kind, "CONFIG_MISSING");
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracinglifecycle", () => {
  const config: capability.TelemetryConfiguration = {
    receiverEndpoint: "https://rum.example.com",
    collectorEndpoint: "https://collector.example.com",
    backendEndpoint: "https://tempo.example.com",
    enabled: true,
  };
  const traceId = "5B8EFFF798038103D269B633813FC60C";
  const spanId = "E19A3088306943A38E560C0000000001";
  const payload: capability.BrowserTelemetryPayload = {
    context: { traceId, spanId },
    attributes: [{ key: "tenant", value: "acme" }],
    spanName: "browser-to-bff-tracing-proof",
    timestamp: new Date().toISOString(),
  };
  const state: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    config,
    readiness: "READY",
    errorCount: 0,
    lastError: null,
  };
  const result = capability.processTelemetryIngress(state, payload, true);
  assert.strictEqual(result.result, "SUCCESS");
  assert.strictEqual(result.newState.errorCount, 0);
  assert.strictEqual(result.newState.lastError, null);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingpermissions", () => {
  const invalidPayload = { context: { traceId: "", spanId: "" }, attributes: [], spanName: "", timestamp: "" };
  const validation = capability.validateTelemetryPayload(invalidPayload);
  assert.strictEqual(validation.isValid, false);
  assert.strictEqual(validation.error!.kind, "TRACE_CONTEXT_MISSING");

  const state = capability.initialState;
  const result = capability.processTelemetryIngress(state, invalidPayload, true);
  assert.strictEqual(result.result, "FAILURE");
  assert.notStrictEqual(result.error, null);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingproof", () => {
  const traceId = "5B8EFFF798038103D269B633813FC60C";
  const proof = capability.verifyProof(traceId, true, true, true);
  assert.strictEqual(proof.proofVerified, true);
  assert.strictEqual(proof.lineage, `traceId=${traceId};joined=true`);

  const failedProof = capability.verifyProof(traceId, true, false, false);
  assert.strictEqual(failedProof.proofVerified, false);
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingreadinessmodel", () => {
  assert.strictEqual(capability.initialState.readiness, "NOT_READY");
  const state: capability.BrowserTelemetryGrafanaFarorumAndBrowserToBffTracingState = {
    config: {
      receiverEndpoint: "https://rum.example.com",
      collectorEndpoint: "https://collector.example.com",
      backendEndpoint: "https://tempo.example.com",
      enabled: true,
    },
    readiness: "READY",
    errorCount: 0,
    lastError: null,
  };
  assert.strictEqual(capability.evaluateReadiness(state, true, true, true), "READY");
  assert.strictEqual(capability.evaluateReadiness(state, false, true, true), "DEGRADED");
  assert.strictEqual(capability.evaluateReadiness(capability.initialState, true, true, true), "DEGRADED");
});

test("browsertelemetrygrafanafarorumandbrowsertobfftracingvalidation", () => {
  const validPayload: capability.BrowserTelemetryPayload = {
    context: { traceId: "5B8EFFF798038103D269B633813FC60C", spanId: "E19A3088306943A38E560C0000000001" },
    attributes: [{ key: "tenant", value: "acme" }],
    spanName: "browser-to-bff-tracing-proof",
    timestamp: new Date().toISOString(),
  };
  const validation = capability.validateTelemetryPayload(validPayload);
  assert.strictEqual(validation.isValid, true);
  assert.strictEqual(validation.error, null);

  const invalidPayload = { context: { traceId: "", spanId: "" }, attributes: [], spanName: "", timestamp: "" };
  const invalidValidation = capability.validateTelemetryPayload(invalidPayload);
  assert.strictEqual(invalidValidation.isValid, false);
  assert.notStrictEqual(invalidValidation.error, null);
  assert.strictEqual(invalidValidation.error!.kind, "TRACE_CONTEXT_MISSING");
});