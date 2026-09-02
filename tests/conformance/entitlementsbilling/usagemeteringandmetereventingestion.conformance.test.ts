import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/entitlementsbilling/usagemeteringandmetereventingestion.ts";

test("usagemeteringandmetereventingestionauditmodel", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const auditEvents: capability.UsageMeteringAndMeterEventIngestionAuditEvent[] = [];
  const auditSink = (event: capability.UsageMeteringAndMeterEventIngestionAuditEvent): capability.UsageMeteringAndMeterEventIngestionError | null => {
    auditEvents.push(event);
    return null;
  };

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
    metadata: { key: 'value' },
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(stateWithEntitlement, input, caller, auditSink);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[0].kind, 'INGESTION_ATTEMPTED');
  assert.equal(auditEvents[1].kind, 'EVENT_RECORDED');
  assert.equal(auditEvents[0].subject, 'test-subject');
  assert.equal(auditEvents[0].source, 'test-source');
  assert.deepEqual(auditEvents[0].metadata, { key: 'value' });

  const invalidInput: capability.IngestMeterEventInput = {
    organizationId: 'org-2',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-2',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result2 = capability.ingestMeterEvent(stateWithEntitlement, invalidInput, caller, auditSink);
  assert.equal(result2.status, 'FAILURE');
  assert.equal(result2.outcome, 'MISSING_ENTITLEMENT');
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[2].kind, 'ENTITLEMENT_REJECTED');
});

test("usagemeteringandmetereventingestioncontracts", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(stateWithEntitlement, input, caller);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.event.meterKey, 'test-meter');
  assert.equal(result.event.quantity, 10);
  assert.equal(result.event.idempotencyKey, 'key-1');

  const readResult = capability.readUsage(stateWithEntitlement, 'org-1', 'test-meter', caller);
  assert.equal(readResult.status, 'SUCCESS');
  assert.equal(readResult.aggregate.totalQuantity, 0);
  assert.equal(readResult.aggregate.eventCount, 0);
});

test("usagemeteringandmetereventingestionerrormodel", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'unknown-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(stateWithMeter, input, caller);
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.outcome, 'UNKNOWN_METER');
  assert.equal(result.error.kind, 'UNKNOWN_METER');
  assert.equal(stateWithMeter.events.length, 0);

  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const invalidQuantityInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: -Infinity,
    idempotencyKey: 'key-2',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result2 = capability.ingestMeterEvent(stateWithEntitlement, invalidQuantityInput, caller);
  assert.equal(result2.status, 'FAILURE');
  assert.equal(result2.outcome, 'INVALID_QUANTITY');
  assert.equal(result2.error.kind, 'INVALID_QUANTITY');

  const degradedState = capability.setSubstrateAvailability(stateWithEntitlement, false);
  const result3 = capability.ingestMeterEvent(degradedState, input, caller);
  assert.equal(result3.status, 'FAILURE');
  assert.equal(result3.outcome, 'PROVIDER_UNAVAILABLE');
  assert.equal(result3.error.kind, 'PROVIDER_UNAVAILABLE');
});

test("usagemeteringandmetereventingestionlifecycle", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(stateWithEntitlement, input, caller);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.event.quantity, 10);

  const duplicateInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 5,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result2 = capability.ingestMeterEvent(result.state, duplicateInput, caller);
  assert.equal(result2.status, 'SUCCESS');
  assert.equal(result2.outcome, 'DUPLICATE_RESOLVED');
  assert.equal(result2.event.quantity, 10);
  assert.equal(result2.isDuplicate, true);

  const negativeInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: -5,
    idempotencyKey: 'key-2',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result3 = capability.ingestMeterEvent(result2.state, negativeInput, caller);
  assert.equal(result3.status, 'SUCCESS');
  assert.equal(result3.outcome, 'ACCEPTED');
  assert.equal(result3.event.quantity, -5);

  const readResult = capability.readUsage(result3.state, 'org-1', 'test-meter', caller);
  assert.equal(readResult.status, 'SUCCESS');
  assert.equal(readResult.aggregate.totalQuantity, 5);
  assert.equal(readResult.aggregate.eventCount, 2);
});

test("usagemeteringandmetereventingestionpermissions", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const tenantCaller: capability.CallerContext = { role: 'TENANT', organizationId: 'org-1' };
  const result = capability.ingestMeterEvent(stateWithEntitlement, input, tenantCaller);
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.outcome, 'PERMISSION_DENIED');
  assert.equal(result.error.kind, 'PERMISSION_DENIED');

  const operatorCaller: capability.CallerContext = { role: 'OPERATOR' };
  const result2 = capability.ingestMeterEvent(stateWithEntitlement, input, operatorCaller);
  assert.equal(result2.status, 'SUCCESS');
  assert.equal(result2.outcome, 'ACCEPTED');

  const readResult = capability.readUsage(result2.state, 'org-1', 'test-meter', tenantCaller);
  assert.equal(readResult.status, 'SUCCESS');
  assert.equal(readResult.aggregate.organizationId, 'org-1');

  const readResult2 = capability.readUsage(result2.state, 'org-2', 'test-meter', tenantCaller);
  assert.equal(readResult2.status, 'FAILURE');
  assert.equal(readResult2.error.kind, 'TENANT_ISOLATION_VIOLATION');
});

test("usagemeteringandmetereventingestionproof", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(stateWithEntitlement, input, caller);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.outcome, 'ACCEPTED');

  const duplicateInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 5,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result2 = capability.ingestMeterEvent(result.state, duplicateInput, caller);
  assert.equal(result2.status, 'SUCCESS');
  assert.equal(result2.outcome, 'DUPLICATE_RESOLVED');
  assert.equal(result2.isDuplicate, true);

  const readResult = capability.readUsage(result2.state, 'org-1', 'test-meter', caller);
  assert.equal(readResult.status, 'SUCCESS');
  assert.equal(readResult.aggregate.totalQuantity, 10);
  assert.equal(readResult.aggregate.eventCount, 1);

  const proof = capability.verifyHermeticLineageProof(result2.state);
  assert.equal(proof.verified, true);
  assert.equal(proof.checks.substrateHealthy, true);
  assert.equal(proof.checks.readinessConsistent, true);
  assert.equal(proof.checks.noSecretColumns, true);
  assert.equal(proof.checks.idempotencyPreserved, true);
});

test("usagemeteringandmetereventingestionreadinessmodel", () => {
  const initialState = capability.initialUsageMeteringState;
  assert.equal(initialState.readiness, 'NOT_READY');

  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  assert.equal(stateWithMeter.readiness, 'READY');

  const degradedState = capability.setSubstrateAvailability(stateWithMeter, false);
  assert.equal(degradedState.readiness, 'DEGRADED');

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(degradedState, input, caller);
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.outcome, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.state.readiness, 'DEGRADED');
});

test("usagemeteringandmetereventingestionstatemodel", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
    metadata: { key: 'value' },
    occurredAt: '2023-01-01T00:00:00Z',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(stateWithEntitlement, input, caller);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.event.organizationId, 'org-1');
  assert.equal(result.event.meterKey, 'test-meter');
  assert.equal(result.event.quantity, 10);
  assert.equal(result.event.idempotencyKey, 'key-1');
  assert.equal(result.event.subject, 'test-subject');
  assert.equal(result.event.source, 'test-source');
  assert.deepEqual(result.event.metadata, { key: 'value' });
  assert.equal(result.event.occurredAt, '2023-01-01T00:00:00Z');

  const duplicateInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 5,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result2 = capability.ingestMeterEvent(result.state, duplicateInput, caller);
  assert.equal(result2.status, 'SUCCESS');
  assert.equal(result2.outcome, 'DUPLICATE_RESOLVED');
  assert.equal(result2.isDuplicate, true);
  assert.equal(result2.event.quantity, 10);

  const negativeInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: -5,
    idempotencyKey: 'key-2',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result3 = capability.ingestMeterEvent(result2.state, negativeInput, caller);
  assert.equal(result3.status, 'SUCCESS');
  assert.equal(result3.outcome, 'ACCEPTED');
  assert.equal(result3.event.quantity, -5);
});

test("usagemeteringandmetereventingestionvalidation", () => {
  const initialState = capability.initialUsageMeteringState;
  const meter: capability.MeterCatalogEntry = {
    meterKey: 'test-meter',
    entitlementKey: 'test-entitlement',
    displayName: 'Test Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initialState, meter);
  const grant: capability.TenantEntitlementGrant = {
    organizationId: 'org-1',
    entitlementKey: 'test-entitlement',
  };
  const stateWithEntitlement = capability.grantTenantEntitlement(stateWithMeter, grant);

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'unknown-meter',
    quantity: 10,
    idempotencyKey: 'key-1',
    subject: 'test-subject',
    source: 'test-source',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const result = capability.ingestMeterEvent(stateWithEntitlement, input, caller);
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.outcome, 'UNKNOWN_METER');
  assert.equal(result.error.kind, 'UNKNOWN_METER');

  const invalidQuantityInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: NaN,
    idempotencyKey: 'key-2',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result2 = capability.ingestMeterEvent(stateWithEntitlement, invalidQuantityInput, caller);
  assert.equal(result2.status, 'FAILURE');
  assert.equal(result2.outcome, 'INVALID_QUANTITY');
  assert.equal(result2.error.kind, 'INVALID_QUANTITY');

  const missingEntitlementInput: capability.IngestMeterEventInput = {
    organizationId: 'org-2',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-3',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result3 = capability.ingestMeterEvent(stateWithEntitlement, missingEntitlementInput, caller);
  assert.equal(result3.status, 'FAILURE');
  assert.equal(result3.outcome, 'MISSING_ENTITLEMENT');
  assert.equal(result3.error.kind, 'MISSING_ENTITLEMENT');

  const duplicateInput: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 10,
    idempotencyKey: 'key-4',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result4 = capability.ingestMeterEvent(stateWithEntitlement, duplicateInput, caller);
  assert.equal(result4.status, 'SUCCESS');
  assert.equal(result4.outcome, 'ACCEPTED');

  const duplicateInput2: capability.IngestMeterEventInput = {
    organizationId: 'org-1',
    meterKey: 'test-meter',
    quantity: 5,
    idempotencyKey: 'key-4',
    subject: 'test-subject',
    source: 'test-source',
  };
  const result5 = capability.ingestMeterEvent(result4.state, duplicateInput2, caller);
  assert.equal(result5.status, 'SUCCESS');
  assert.equal(result5.outcome, 'DUPLICATE_RESOLVED');
  assert.equal(result5.isDuplicate, true);
});