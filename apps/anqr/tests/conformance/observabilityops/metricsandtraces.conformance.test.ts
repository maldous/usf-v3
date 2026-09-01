import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/metricsandtraces.ts";

test("metricsandtracesauditmodel", () => {
  const capturedEvents: capability.MetricsAndTracesCapabilityAuditEvent[] = [];
  const auditFn = (event: capability.MetricsAndTracesCapabilityAuditEvent): capability.MetricsAndTracesCapabilityError | null => {
    capturedEvents.push(event);
    return null;
  };

  const error1 = capability.auditConfigurationChange("Config updated", "corr-1", "trace-1", auditFn);
  assert.strictEqual(error1, null);
  assert.strictEqual(capturedEvents.length, 1);
  const ev1 = capturedEvents[0];
  assert.strictEqual(ev1.kind, "AUDIT_CONFIG_CHANGE");
  assert.strictEqual(ev1.detail, "Config updated");
  assert.strictEqual(ev1.correlationId, "corr-1");
  assert.strictEqual(ev1.traceId, "trace-1");
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(ev1.timestamp));

  const error2 = capability.auditContractChange("Contract revised", "corr-2", "trace-2", auditFn);
  assert.strictEqual(error2, null);
  assert.strictEqual(capturedEvents.length, 2);
  const ev2 = capturedEvents[1];
  assert.strictEqual(ev2.kind, "AUDIT_CONTRACT_CHANGE");
  assert.strictEqual(ev2.detail, "Contract revised");
  assert.strictEqual(ev2.correlationId, "corr-2");
  assert.strictEqual(ev2.traceId, "trace-2");

  const failingAuditFn = (_: capability.MetricsAndTracesCapabilityAuditEvent): capability.MetricsAndTracesCapabilityError | null => ({
    kind: "PROVIDER_UNAVAILABLE",
    message: "Audit failed",
    correlationId: "",
    traceId: "",
  });
  const error3 = capability.auditConfigurationChange("Bad config", "corr-3", "trace-3", failingAuditFn);
  assert(error3 !== null);
  assert.strictEqual(error3.kind, "PROVIDER_UNAVAILABLE");
});

test("metricsandtracescontracts", () => {
  const state: capability.MetricsAndTracesCapabilityState = {
    metricsProviderAvailable: true,
    tracesProviderAvailable: true,
    lastReadinessState: null,
    lastError: null,
    lastAuditEvent: null,
  };
  const auditFn = (_: capability.MetricsAndTracesCapabilityAuditEvent): capability.MetricsAndTracesCapabilityError | null => null;

  const queryResult = capability.queryMetrics(state, { metricName: "request_total" }, "corr-q", "trace-q", auditFn);
  assert.strictEqual(queryResult.kind, "SUCCESS");
  assert.strictEqual(queryResult.correlationId, "corr-q");
  assert.strictEqual(queryResult.traceId, "trace-q");

  const invalidResult = capability.queryMetrics(state, { metricName: "invalid_metric" as capability.MetricsAndTracesCapabilityMetricName }, "corr-iv", "trace-iv", auditFn);
  assert.strictEqual(invalidResult.kind, "FAILURE");
  assert.strictEqual(invalidResult.error.kind, "INVALID_QUERY_PARAMETERS");

  const span = capability.createSpan("route", "my-route", "org-x", "tenant-y", "corr-span", "trace-span");
  assert.strictEqual(span.kind, "route");
  assert.strictEqual(span.name, "my-route");
  assert.strictEqual(span.organisationId, "org-x");
  assert.strictEqual(span.tenantId, "tenant-y");
});

test("metricsandtraceserrormodel", () => {
  const emptyState: capability.MetricsAndTracesCapabilityState = capability.initialState;
  const auditFn = (_: capability.MetricsAndTracesCapabilityAuditEvent): capability.MetricsAndTracesCapabilityError | null => null;

  const queryResult = capability.queryMetrics(emptyState, {}, "corr-e1", "trace-e1", auditFn);
  assert.strictEqual(queryResult.kind, "FAILURE");
  assert.strictEqual(queryResult.error.kind, "PROVIDER_UNAVAILABLE");

  const readinessResult = capability.queryReadiness(emptyState, "corr-e2", "trace-e2");
  assert.strictEqual(readinessResult.kind, "FAILURE");
  assert.strictEqual(readinessResult.error.kind, "PROVIDER_UNAVAILABLE");
});

test("metricsandtraceslifecycle", () => {
  let currentState: capability.MetricsAndTracesCapabilityState = capability.initialState;
  const auditEvents: capability.MetricsAndTracesCapabilityAuditEvent[] = [];
  const auditFn = (event: capability.MetricsAndTracesCapabilityAuditEvent): capability.MetricsAndTracesCapabilityError | null => {
    auditEvents.push(event);
    return null;
  };

  const updateResult = capability.updateProviderAvailability(currentState, true, false, "corr-l1", "trace-l1", auditFn);
  assert.notEqual(updateResult, null);
  if (typeof updateResult !== "object" || "kind" in updateResult) assert.fail("Expected state");
  currentState = updateResult;
  assert.strictEqual(currentState.metricsProviderAvailable, true);
  assert.strictEqual(currentState.tracesProviderAvailable, false);
  assert.strictEqual(auditEvents[0].kind, "AUDIT_CONFIG_CHANGE");

  const readiness = capability.queryReadiness(currentState, "corr-l2", "trace-l2");
  assert.strictEqual(readiness.kind, "SUCCESS");
  assert.strictEqual(readiness.state, "DEGRADED_TRACES");
});

test("metricsandtracespermissions", () => {
  const err1 = capability.enforcePermission(undefined, undefined, "c", "t");
  assert(err1 !== null);
  assert.strictEqual(err1.kind, "PERMISSION_DENIED");

  const err2 = capability.enforcePermission("org1", undefined, "c", "t");
  assert(err2 !== null);
  assert.strictEqual(err2.kind, "PERMISSION_DENIED");

  const success = capability.enforcePermission("org1", "tenant1", "c", "t");
  assert.strictEqual(success, null);

  const span = capability.createSpan("provider", "svc-a", "org1", "tenant1", "corr-p", "trace-p");
  assert.strictEqual(span.organisationId, "org1");
  assert.strictEqual(span.tenantId, "tenant1");
});

test("metricsandtracesproof", () => {
  const state: capability.MetricsAndTracesCapabilityState = {
    metricsProviderAvailable: true,
    tracesProviderAvailable: true,
    lastReadinessState: null,
    lastError: null,
    lastAuditEvent: null,
  };
  const auditFn = (_: capability.MetricsAndTracesCapabilityAuditEvent): capability.MetricsAndTracesCapabilityError | null => null;

  const metricsResponse = capability.queryMetrics(state, { metricName: "failure_total" }, "corr-proof", "trace-proof", auditFn);
  assert.strictEqual(metricsResponse.kind, "SUCCESS");
  assert.strictEqual(metricsResponse.correlationId, "corr-proof");
  assert.strictEqual(metricsResponse.traceId, "trace-proof");

  const readinessResponse = capability.queryReadiness(state, "corr-proof", "trace-proof");
  assert.strictEqual(readinessResponse.kind, "SUCCESS");
  assert.strictEqual(readinessResponse.correlationId, "corr-proof");
  assert.strictEqual(readinessResponse.traceId, "trace-proof");
});

test("metricsandtracesreadinessmodel", () => {
  const readyState: capability.MetricsAndTracesCapabilityState = {
    metricsProviderAvailable: true,
    tracesProviderAvailable: true,
    lastReadinessState: null,
    lastError: null,
    lastAuditEvent: null,
  };
  let readiness = capability.queryReadiness(readyState, "c1", "t1");
  assert.strictEqual(readiness.kind, "SUCCESS");
  assert.strictEqual(readiness.state, "READY");

  const metricsOnlyState: capability.MetricsAndTracesCapabilityState = {
    metricsProviderAvailable: true,
    tracesProviderAvailable: false,
    lastReadinessState: null,
    lastError: null,
    lastAuditEvent: null,
  };
  readiness = capability.queryReadiness(metricsOnlyState, "c2", "t2");
  assert.strictEqual(readiness.kind, "SUCCESS");
  assert.strictEqual(readiness.state, "DEGRADED_TRACES");

  const tracesOnlyState: capability.MetricsAndTracesCapabilityState = {
    metricsProviderAvailable: false,
    tracesProviderAvailable: true,
    lastReadinessState: null,
    lastError: null,
    lastAuditEvent: null,
  };
  readiness = capability.queryReadiness(tracesOnlyState, "c3", "t3");
  assert.strictEqual(readiness.kind, "SUCCESS");
  assert.strictEqual(readiness.state, "DEGRADED_METRICS");

  const noneState = capability.initialState;
  readiness = capability.queryReadiness(noneState, "c4", "t4");
  assert.strictEqual(readiness.kind, "FAILURE");
  assert.strictEqual(readiness.error.kind, "PROVIDER_UNAVAILABLE");
});

test("metricsandtracesvalidation", () => {
  let error = capability.validateQueryParameters({ metricName: "invalid_metric" as capability.MetricsAndTracesCapabilityMetricName });
  assert(error !== null);
  assert.strictEqual(error.kind, "INVALID_QUERY_PARAMETERS");

  error = capability.validateQueryParameters({ startTime: "not-a-date" });
  assert(error !== null);
  assert.strictEqual(error.kind, "INVALID_QUERY_PARAMETERS");
  assert.strictEqual(error.message, "Invalid start time");

  error = capability.validateQueryParameters({ endTime: "also-not" });
  assert(error !== null);
  assert.strictEqual(error.kind, "INVALID_QUERY_PARAMETERS");
  assert.strictEqual(error.message, "Invalid end time");

  error = capability.validateQueryParameters({ organisationId: 123 as unknown as string });
  assert(error !== null);
  assert.strictEqual(error.kind, "INVALID_QUERY_PARAMETERS");
  assert.strictEqual(error.message, "Invalid organisation ID");

  error = capability.validateQueryParameters({ tenantId: 456 as unknown as string });
  assert(error !== null);
  assert.strictEqual(error.kind, "INVALID_QUERY_PARAMETERS");
  assert.strictEqual(error.message, "Invalid tenant ID");

  error = capability.validateQueryParameters({
    metricName: "readiness_state",
    startTime: "2023-01-01T00:00:00.000Z",
    endTime: "2023-01-02T00:00:00.000Z",
    organisationId: "org",
    tenantId: "tenant",
  });
  assert.strictEqual(error, null);
});