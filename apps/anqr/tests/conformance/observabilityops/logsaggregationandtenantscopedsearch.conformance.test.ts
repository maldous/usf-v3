import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/observabilityops/logsaggregationandtenantscopedsearch.ts";

test("logsaggregationandtenantscopedsearchauditmodel", () => {
  const auditFn = (e: capability.LogSearchAuditEvent): capability.LogSearchError | null => {
    if (e.tenantId === "") return { kind: "MISSING_TENANT", message: "Tenant ID missing in audit" };
    return null;
  };

  const auditEvent: capability.LogSearchAuditEvent = {
    kind: "AUDIT_BEFORE_SEARCH",
    tenantId: "tenant-1",
    requestId: "req-123",
    timestamp: new Date().toISOString(),
  };
  const error = capability.auditBeforeSearch(auditEvent, auditFn);
  assert.strictEqual(error, null);

  const badEvent: capability.LogSearchAuditEvent = {
    kind: "AUDIT_BEFORE_SEARCH",
    tenantId: "",
    requestId: "req-123",
    timestamp: new Date().toISOString(),
  };
  const badError = capability.auditBeforeSearch(badEvent, auditFn);
  assert.notStrictEqual(badError, null);
  assert.strictEqual(badError?.kind, "MISSING_TENANT");
});

test("logsaggregationandtenantscopedsearchcontracts", () => {
  const mockAdapter: capability.LogStoreAdapter = {
    search: (request: capability.LogSearchRequest): capability.LogSearchSuccess | capability.LogSearchError => {
      return {
        kind: "SUCCESS",
        entries: [],
        readiness: { subStates: ["QUERY"], degraded: false },
      };
    },
    readiness: (): capability.ReadinessState => ({
      subStates: ["QUERY"],
      degraded: false,
    }),
  };

  const request: capability.LogSearchRequest = {
    tenantId: "tenant-1",
    requestId: "req-123",
    timeStart: "2023-01-01T00:00:00Z",
    timeEnd: "2023-01-02T00:00:00Z",
    filters: [],
    isAdmin: true,
  };

  const result = capability.searchLogs(request, mockAdapter, () => null);
  assert.strictEqual(result.kind, "SUCCESS");
  assert.deepStrictEqual(result.readiness.subStates, ["QUERY"]);
});

test("logsaggregationandtenantscopedsearcherrormodel", () => {
  const mockAdapter: capability.LogStoreAdapter = {
    search: (): capability.LogSearchError => ({
      kind: "PROVIDER_UNAVAILABLE",
      message: "Backend down",
    }),
    readiness: (): capability.ReadinessState => ({
      subStates: [],
      degraded: true,
    }),
  };

  const request: capability.LogSearchRequest = {
    tenantId: "tenant-1",
    requestId: "req-123",
    timeStart: "2023-01-01T00:00:00Z",
    timeEnd: "2023-01-02T00:00:00Z",
    filters: [],
    isAdmin: true,
  };

  const result = capability.searchLogs(request, mockAdapter, () => null);
  assert.strictEqual(result.kind, "DEGRADED");
  assert.strictEqual(result.error.kind, "PROVIDER_UNAVAILABLE");
});

test("logsaggregationandtenantscopedsearchlifecycle", () => {
  const mockAdapter: capability.LogStoreAdapter = {
    search: (request: capability.LogSearchRequest): capability.LogSearchSuccess => ({
      kind: "SUCCESS",
      entries: [
        {
          timestamp: "2023-01-01T00:00:00Z",
          message: "log entry",
          tenantId: request.tenantId,
          labels: {},
        },
      ],
      readiness: { subStates: ["QUERY"], degraded: false },
    }),
    readiness: (): capability.ReadinessState => ({
      subStates: ["QUERY"],
      degraded: false,
    }),
  };

  const request: capability.LogSearchRequest = {
    tenantId: "tenant-1",
    requestId: "req-123",
    timeStart: "2023-01-01T00:00:00Z",
    timeEnd: "2023-01-02T00:00:00Z",
    filters: [],
    isAdmin: true,
  };

  const result = capability.searchLogs(request, mockAdapter, () => null);
  assert.strictEqual(result.kind, "SUCCESS");
  assert.strictEqual(result.entries[0].tenantId, request.tenantId);
});

test("logsaggregationandtenantscopedsearchpermissions", () => {
  const request: capability.LogSearchRequest = {
    tenantId: "tenant-1",
    requestId: "req-123",
    timeStart: "2023-01-01T00:00:00Z",
    timeEnd: "2023-01-02T00:00:00Z",
    filters: [],
    isAdmin: false,
  };

  const error = capability.validateSearchRequest(request);
  assert.notStrictEqual(error, null);
  assert.strictEqual(error?.kind, "UNAUTHORIZED");
});

test("logsaggregationandtenantscopedsearchproof", () => {
  const mockAdapter: capability.LogStoreAdapter = {
    search: (request: capability.LogSearchRequest): capability.LogSearchSuccess => ({
      kind: "SUCCESS",
      entries: [],
      readiness: { subStates: ["QUERY"], degraded: false },
    }),
    readiness: (): capability.ReadinessState => ({
      subStates: ["QUERY"],
      degraded: false,
    }),
  };

  const request: capability.LogSearchRequest = {
    tenantId: "tenant-1",
    requestId: "req-123",
    timeStart: "2023-01-01T00:00:00Z",
    timeEnd: "2023-01-02T00:00:00Z",
    filters: [],
    isAdmin: true,
  };

  const searchResult = capability.searchLogs(request, mockAdapter, () => null);
  assert.strictEqual(searchResult.kind, "SUCCESS");

  const readinessResult = capability.queryReadiness(mockAdapter, () => null);
  assert.deepStrictEqual(readinessResult, { subStates: ["QUERY"], degraded: false });
});

test("logsaggregationandtenantscopedsearchreadinessmodel", () => {
  const readiness = capability.computeReadiness(
    true,
    true,
    true,
    false,
    true,
    true,
    true,
  );
  assert.deepStrictEqual(readiness.subStates, [
    "INGESTION",
    "QUERY",
    "TRACE_CORRELATION",
    "COLLECTOR",
    "METRICS",
    "ERROR_CAPTURE",
  ]);
  assert.strictEqual(readiness.degraded, false);

  const degradedReadiness = capability.computeReadiness(
    true,
    false,
    true,
    false,
    true,
    true,
    true,
  );
  assert.strictEqual(degradedReadiness.degraded, true);
});

test("logsaggregationandtenantscopedsearchvalidation", () => {
  const validRequest: capability.LogSearchRequest = {
    tenantId: "tenant-1",
    requestId: "req-123",
    timeStart: "2023-01-01T00:00:00Z",
    timeEnd: "2023-01-02T00:00:00Z",
    filters: [],
    isAdmin: true,
  };
  assert.strictEqual(capability.validateSearchRequest(validRequest), null);

  const missingTenant: capability.LogSearchRequest = {
    tenantId: "",
    requestId: "req-123",
    timeStart: "2023-01-01T00:00:00Z",
    timeEnd: "2023-01-02T00:00:00Z",
    filters: [],
    isAdmin: true,
  };
  const error1 = capability.validateSearchRequest(missingTenant);
  assert.strictEqual(error1?.kind, "MISSING_TENANT");

  const badTimeRange: capability.LogSearchRequest = {
    tenantId: "tenant-1",
    requestId: "req-123",
    timeStart: "2023-01-02T00:00:00Z",
    timeEnd: "2023-01-01T00:00:00Z",
    filters: [],
    isAdmin: true,
  };
  const error2 = capability.validateSearchRequest(badTimeRange);
  assert.strictEqual(error2?.kind, "VALIDATION_ERROR");
});