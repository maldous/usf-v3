import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/internalservicecatalogandreadiness.ts";

test("internalservicecatalogandreadinessauditmodel", () => {
  const auditEvents: capability.InternalServiceCatalogAndReadinessAuditEvent[] = [];
  const auditFn = (event: capability.InternalServiceCatalogAndReadinessAuditEvent): capability.InternalServiceCatalogAndReadinessError | null => {
    auditEvents.push(event);
    return null;
  };

  const service: capability.InternalServiceCatalogAndReadinessService = {
    id: "svc-1",
    provider: "provider-1",
    readinessPort: 8080,
    tenantId: "tenant-1",
  };

  const state = capability.registerService(
    capability.initialState,
    service,
    auditFn,
  );
  assert.ok(!("kind" in state), "Registration should succeed");
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "CATALOG_SERVICE_REGISTERED");
  assert.strictEqual(auditEvents[0].serviceId, "svc-1");
  assert.strictEqual(auditEvents[0].tenantId, "tenant-1");
  assert.ok(typeof auditEvents[0].timestamp === "string");
});

test("internalservicecatalogandreadinesscontracts", () => {
  const probeFn = (port: number): capability.ReadinessProbeResult | capability.InternalServiceCatalogAndReadinessError => ({
    state: "READY",
    serviceId: "svc-1",
    tenantId: "tenant-1",
  });
  const auditFn = (): capability.InternalServiceCatalogAndReadinessError | null => null;

  const service: capability.InternalServiceCatalogAndReadinessService = {
    id: "svc-1",
    provider: "provider-1",
    readinessPort: 8080,
    tenantId: "tenant-1",
  };
  const state: capability.InternalServiceCatalogAndReadinessState = {
    services: [service],
    lastAuditEvent: null,
    lastError: null,
  };

  const result = capability.getTenantScopedReadiness(state, "tenant-1", probeFn, auditFn);
  assert.strictEqual(result.services.length, 1);
  assert.strictEqual(result.services[0].serviceId, "svc-1");
  assert.strictEqual(result.services[0].provider, "provider-1");
  assert.strictEqual(result.services[0].readinessState, "READY");
  assert.strictEqual(result.aggregateState, "READY");
  assert.strictEqual(result.error, null);
});

test("internalservicecatalogandreadinesserrormodel", () => {
  const probeFn = (port: number): capability.ReadinessProbeResult | capability.InternalServiceCatalogAndReadinessError => ({
    kind: "PROBE_FAILURE",
    message: "Probe failed",
    serviceId: "svc-1",
    tenantId: "tenant-1",
  });
  const auditFn = (): capability.InternalServiceCatalogAndReadinessError | null => null;

  const service: capability.InternalServiceCatalogAndReadinessService = {
    id: "svc-1",
    provider: "provider-1",
    readinessPort: 8080,
    tenantId: "tenant-1",
  };
  const state: capability.InternalServiceCatalogAndReadinessState = {
    services: [service],
    lastAuditEvent: null,
    lastError: null,
  };

  const result = capability.getTenantScopedReadiness(state, "tenant-1", probeFn, auditFn);
  assert.strictEqual(result.services[0].readinessState, "UNAVAILABLE");
  assert.strictEqual(result.aggregateState, "UNAVAILABLE");
  assert.strictEqual(result.error?.kind, "PROBE_FAILURE");
});

test("internalservicecatalogandreadinesslifecycle", () => {
  const auditFn = (): capability.InternalServiceCatalogAndReadinessError | null => null;
  const probeFn = (port: number): capability.ReadinessProbeResult => ({
    state: "READY",
    serviceId: "svc-1",
    tenantId: "tenant-1",
  });

  const service: capability.InternalServiceCatalogAndReadinessService = {
    id: "svc-1",
    provider: "provider-1",
    readinessPort: 8080,
    tenantId: "tenant-1",
  };
  const state = capability.registerService(
    capability.initialState,
    service,
    auditFn,
  );
  assert.ok(!("kind" in state), "Registration should succeed");

  const result = capability.getTenantScopedReadiness(
    state as capability.InternalServiceCatalogAndReadinessState,
    "tenant-1",
    probeFn,
    auditFn,
  );
  assert.strictEqual(result.aggregateState, "READY");
  assert.strictEqual(result.services.length, 1);
});

test("internalservicecatalogandreadinesspermissions", () => {
  const auditFn = (): capability.InternalServiceCatalogAndReadinessError | null => null;
  const probeFn = (port: number): capability.ReadinessProbeResult => ({
    state: "READY",
    serviceId: "svc-1",
    tenantId: "tenant-1",
  });

  const service: capability.InternalServiceCatalogAndReadinessService = {
    id: "svc-1",
    provider: "provider-1",
    readinessPort: 8080,
    tenantId: "tenant-1",
  };
  const state: capability.InternalServiceCatalogAndReadinessState = {
    services: [service],
    lastAuditEvent: null,
    lastError: null,
  };

  const result = capability.getTenantScopedReadiness(state, "tenant-2", probeFn, auditFn);
  assert.strictEqual(result.services.length, 0);
  assert.strictEqual(result.aggregateState, "UNAVAILABLE");
  assert.strictEqual(result.error?.kind, "SERVICE_REFERENCE_INVALID");
});

test("internalservicecatalogandreadinessproof", () => {
  const auditFn = (): capability.InternalServiceCatalogAndReadinessError | null => null;
  const probeFn = (port: number): capability.ReadinessProbeResult => ({
    state: "READY",
    serviceId: "svc-1",
    tenantId: "tenant-1",
  });

  const service: capability.InternalServiceCatalogAndReadinessService = {
    id: "svc-1",
    provider: "provider-1",
    readinessPort: 8080,
    tenantId: "tenant-1",
  };
  const state = capability.registerService(
    capability.initialState,
    service,
    auditFn,
  );
  assert.ok(!("kind" in state), "Registration should succeed");

  const result = capability.getTenantScopedReadiness(
    state as capability.InternalServiceCatalogAndReadinessState,
    "tenant-1",
    probeFn,
    auditFn,
  );
  assert.strictEqual(result.services[0].readinessState, "READY");
  assert.strictEqual(result.aggregateState, "READY");
});

test("internalservicecatalogandreadinessreadinessmodel", () => {
  const auditFn = (): capability.InternalServiceCatalogAndReadinessError | null => null;
  const probeFn = (port: number): capability.ReadinessProbeResult => ({
    state: "DEGRADED",
    serviceId: "svc-1",
    tenantId: "tenant-1",
  });

  const service: capability.InternalServiceCatalogAndReadinessService = {
    id: "svc-1",
    provider: "provider-1",
    readinessPort: 8080,
    tenantId: "tenant-1",
  };
  const state: capability.InternalServiceCatalogAndReadinessState = {
    services: [service],
    lastAuditEvent: null,
    lastError: null,
  };

  const result = capability.getTenantScopedReadiness(state, "tenant-1", probeFn, auditFn);
  assert.strictEqual(result.services[0].readinessState, "DEGRADED");
  assert.strictEqual(result.aggregateState, "DEGRADED");
});

test("internalservicecatalogandreadinessvalidation", () => {
  const auditFn = (): capability.InternalServiceCatalogAndReadinessError | null => null;
  const invalidService = {
    id: "",
    provider: "",
    readinessPort: 0,
    tenantId: "",
  };

  const result = capability.validateServiceReference(invalidService);
  assert.strictEqual(result?.kind, "SERVICE_REFERENCE_INVALID");

  const scopeResult = capability.validateTenantScope(undefined);
  assert.strictEqual(scopeResult?.kind, "TENANT_SCOPE_MISSING");
});