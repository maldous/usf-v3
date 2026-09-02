import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/entitlementsbilling/usagemeteringandmetereventingestion.ts";

function seedReadyState(
  meterKey: string,
  entitlementKey: string,
  organizationId: string,
  unit = 'units',
): capability.UsageMeteringAndMeterEventIngestionState {
  const meter: capability.MeterCatalogEntry = {
    meterKey,
    entitlementKey,
    displayName: meterKey,
    unit,
  };
  const withMeter = capability.registerMeter(capability.initialUsageMeteringState, meter);
  return capability.grantTenantEntitlement(withMeter, {
    organizationId,
    entitlementKey,
  });
}

test("usagemeteringandmetereventingestionauditmodel", () => {
  const state = seedReadyState('audit-meter', 'audit-entitlement', 'org-audit');
  const auditEvents: capability.UsageMeteringAndMeterEventIngestionAuditEvent[] = [];
  const auditSink = (
    event: capability.UsageMeteringAndMeterEventIngestionAuditEvent,
  ): capability.UsageMeteringAndMeterEventIngestionError | null => {
    auditEvents.push(event);
    return null;
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };
  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-audit',
    meterKey: 'audit-meter',
    quantity: 7,
    idempotencyKey: 'audit-key-1',
    subject: 'subj-audit',
    source: 'src-audit',
    metadata: { traceId: 'trace-1' },
  };

  const result = capability.ingestMeterEvent(state, input, caller, auditSink);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.outcome, 'ACCEPTED');
  if (result.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(result.event.subject, 'subj-audit');
  assert.equal(result.event.source, 'src-audit');
  assert.deepEqual(result.event.metadata, { traceId: 'trace-1' });

  assert.ok(auditEvents.length >= 2);
  const kinds = auditEvents.map((e) => e.kind);
  assert.ok(kinds.includes('INGESTION_ATTEMPTED'));
  assert.ok(kinds.includes('EVENT_RECORDED'));
  const attempted = auditEvents.find((e) => e.kind === 'INGESTION_ATTEMPTED');
  assert.ok(attempted);
  assert.equal(attempted.subject, 'subj-audit');
  assert.equal(attempted.source, 'src-audit');
  assert.deepEqual(attempted.metadata, { traceId: 'trace-1' });

  const rejectedInput: capability.IngestMeterEventInput = {
    organizationId: 'org-other',
    meterKey: 'audit-meter',
    quantity: 1,
    idempotencyKey: 'audit-key-2',
    subject: 'subj-audit',
    source: 'src-audit',
  };
  const rejectedResult = capability.ingestMeterEvent(state, rejectedInput, caller, auditSink);
  assert.equal(rejectedResult.status, 'FAILURE');
  assert.equal(rejectedResult.outcome, 'MISSING_ENTITLEMENT');
  const rejectionAudit = auditEvents.find((e) => e.kind === 'ENTITLEMENT_REJECTED');
  assert.ok(rejectionAudit);
  assert.equal(rejectionAudit.organizationId, 'org-other');
});

test("usagemeteringandmetereventingestioncontracts", () => {
  const state = seedReadyState('contract-meter', 'contract-entitlement', 'org-contract');
  const caller: capability.CallerContext = { role: 'OPERATOR' };
  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-contract',
    meterKey: 'contract-meter',
    quantity: 10,
    idempotencyKey: 'contract-key-1',
    subject: 'subj-contract',
    source: 'src-contract',
  };

  const result = capability.ingestMeterEvent(state, input, caller);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.outcome, 'ACCEPTED');
  if (result.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(result.event.meterKey, 'contract-meter');
  assert.equal(result.event.quantity, 10);
  assert.equal(result.event.idempotencyKey, 'contract-key-1');

  const opRead = capability.readUsage(result.state, 'org-contract', 'contract-meter', caller);
  assert.equal(opRead.status, 'SUCCESS');
  if (opRead.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(opRead.aggregate.totalQuantity, 10);
  assert.equal(opRead.aggregate.eventCount, 1);
  assert.equal(opRead.aggregate.unit, 'units');

  const tenantCaller: capability.CallerContext = {
    role: 'TENANT',
    organizationId: 'org-contract',
  };
  const tenantRead = capability.readUsage(
    result.state,
    'org-contract',
    'contract-meter',
    tenantCaller,
  );
  assert.equal(tenantRead.status, 'SUCCESS');
  if (tenantRead.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(tenantRead.aggregate.totalQuantity, 10);
});

test("usagemeteringandmetereventingestionerrormodel", () => {
  const state = seedReadyState('err-meter', 'err-entitlement', 'org-err');
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const unknownMeterInput: capability.IngestMeterEventInput = {
    organizationId: 'org-err',
    meterKey: 'no-such-meter',
    quantity: 1,
    idempotencyKey: 'err-key-1',
    subject: 'subj',
    source: 'src',
  };
  const r1 = capability.ingestMeterEvent(state, unknownMeterInput, caller);
  assert.equal(r1.status, 'FAILURE');
  assert.equal(r1.outcome, 'UNKNOWN_METER');
  if (r1.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(r1.error.kind, 'UNKNOWN_METER');
  assert.equal(r1.state.events.length, 0);

  const missingEntInput: capability.IngestMeterEventInput = {
    organizationId: 'org-other',
    meterKey: 'err-meter',
    quantity: 1,
    idempotencyKey: 'err-key-2',
    subject: 'subj',
    source: 'src',
  };
  const r2 = capability.ingestMeterEvent(state, missingEntInput, caller);
  assert.equal(r2.status, 'FAILURE');
  assert.equal(r2.outcome, 'MISSING_ENTITLEMENT');
  if (r2.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(r2.error.kind, 'MISSING_ENTITLEMENT');
  assert.equal(r2.state.events.length, 0);

  const invalidQtyInput: capability.IngestMeterEventInput = {
    organizationId: 'org-err',
    meterKey: 'err-meter',
    quantity: Number.NaN,
    idempotencyKey: 'err-key-3',
    subject: 'subj',
    source: 'src',
  };
  const r3 = capability.ingestMeterEvent(state, invalidQtyInput, caller);
  assert.equal(r3.status, 'FAILURE');
  assert.equal(r3.outcome, 'INVALID_QUANTITY');
  if (r3.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(r3.error.kind, 'INVALID_QUANTITY');
  assert.equal(r3.state.events.length, 0);

  const accepted: capability.IngestMeterEventInput = {
    organizationId: 'org-err',
    meterKey: 'err-meter',
    quantity: 5,
    idempotencyKey: 'err-key-4',
    subject: 'subj',
    source: 'src',
  };
  const acceptedResult = capability.ingestMeterEvent(state, accepted, caller);
  assert.equal(acceptedResult.status, 'SUCCESS');

  const dup: capability.IngestMeterEventInput = {
    organizationId: 'org-err',
    meterKey: 'err-meter',
    quantity: 99,
    idempotencyKey: 'err-key-4',
    subject: 'subj',
    source: 'src',
  };
  const dupResult = capability.ingestMeterEvent(acceptedResult.state, dup, caller);
  assert.equal(dupResult.status, 'SUCCESS');
  assert.equal(dupResult.outcome, 'DUPLICATE_RESOLVED');
  if (dupResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(dupResult.isDuplicate, true);
  assert.equal(dupResult.event.quantity, 5);
  assert.equal(dupResult.state.events.length, 1);

  const degraded = capability.setSubstrateAvailability(state, false);
  const providerInput: capability.IngestMeterEventInput = {
    organizationId: 'org-err',
    meterKey: 'err-meter',
    quantity: 1,
    idempotencyKey: 'err-key-5',
    subject: 'subj',
    source: 'src',
  };
  const providerResult = capability.ingestMeterEvent(degraded, providerInput, caller);
  assert.equal(providerResult.status, 'FAILURE');
  assert.equal(providerResult.outcome, 'PROVIDER_UNAVAILABLE');
  if (providerResult.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(providerResult.error.kind, 'PROVIDER_UNAVAILABLE');
});

test("usagemeteringandmetereventingestionlifecycle", () => {
  const state = seedReadyState('life-meter', 'life-entitlement', 'org-life');
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-life',
    meterKey: 'life-meter',
    quantity: 10,
    idempotencyKey: 'life-key-1',
    subject: 'subj',
    source: 'src',
  };
  const result = capability.ingestMeterEvent(state, input, caller);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.outcome, 'ACCEPTED');

  const dup: capability.IngestMeterEventInput = {
    organizationId: 'org-life',
    meterKey: 'life-meter',
    quantity: 5,
    idempotencyKey: 'life-key-1',
    subject: 'subj',
    source: 'src',
  };
  const dupResult = capability.ingestMeterEvent(result.state, dup, caller);
  assert.equal(dupResult.outcome, 'DUPLICATE_RESOLVED');
  if (dupResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(dupResult.event.quantity, 10);

  const negative: capability.IngestMeterEventInput = {
    organizationId: 'org-life',
    meterKey: 'life-meter',
    quantity: -3,
    idempotencyKey: 'life-key-2',
    subject: 'subj',
    source: 'src',
  };
  const negResult = capability.ingestMeterEvent(dupResult.state, negative, caller);
  assert.equal(negResult.status, 'SUCCESS');
  assert.equal(negResult.outcome, 'ACCEPTED');
  if (negResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(negResult.event.quantity, -3);

  const operatorRead = capability.readUsage(
    negResult.state,
    'org-life',
    'life-meter',
    caller,
  );
  assert.equal(operatorRead.status, 'SUCCESS');
  if (operatorRead.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(operatorRead.aggregate.totalQuantity, 7);
  assert.equal(operatorRead.aggregate.eventCount, 2);

  const tenantCaller: capability.CallerContext = {
    role: 'TENANT',
    organizationId: 'org-life',
  };
  const tenantRead = capability.readUsage(
    negResult.state,
    'org-life',
    'life-meter',
    tenantCaller,
  );
  assert.equal(tenantRead.status, 'SUCCESS');
  if (tenantRead.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(tenantRead.aggregate.totalQuantity, 7);

  const queryResult = capability.queryAllUsageForTenant(
    negResult.state,
    'org-life',
    tenantCaller,
  );
  assert.equal(queryResult.status, 'SUCCESS');
  assert.equal(queryResult.aggregates.length, 1);
  assert.equal(queryResult.aggregates[0].totalQuantity, 7);
});

test("usagemeteringandmetereventingestionpermissions", () => {
  const state = seedReadyState('perm-meter', 'perm-entitlement', 'org-perm');
  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-perm',
    meterKey: 'perm-meter',
    quantity: 10,
    idempotencyKey: 'perm-key-1',
    subject: 'subj',
    source: 'src',
  };

  const tenantCaller: capability.CallerContext = {
    role: 'TENANT',
    organizationId: 'org-perm',
  };
  const tenantResult = capability.ingestMeterEvent(state, input, tenantCaller);
  assert.equal(tenantResult.status, 'FAILURE');
  assert.equal(tenantResult.outcome, 'PERMISSION_DENIED');
  if (tenantResult.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(tenantResult.error.kind, 'PERMISSION_DENIED');

  const operatorCaller: capability.CallerContext = { role: 'OPERATOR' };
  const operatorResult = capability.ingestMeterEvent(state, input, operatorCaller);
  assert.equal(operatorResult.status, 'SUCCESS');
  assert.equal(operatorResult.outcome, 'ACCEPTED');
  if (operatorResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }

  const internalScoped: capability.CallerContext = {
    role: 'INTERNAL',
    organizationId: 'org-perm',
  };
  const internalResult = capability.ingestMeterEvent(
    operatorResult.state,
    { ...input, idempotencyKey: 'perm-key-2' },
    internalScoped,
  );
  assert.equal(internalResult.status, 'SUCCESS');
  assert.equal(internalResult.outcome, 'ACCEPTED');

  const internalMismatch: capability.CallerContext = {
    role: 'INTERNAL',
    organizationId: 'org-other',
  };
  const mismatchIngest = capability.ingestMeterEvent(
    operatorResult.state,
    { ...input, idempotencyKey: 'perm-key-3' },
    internalMismatch,
  );
  assert.equal(mismatchIngest.status, 'FAILURE');
  if (mismatchIngest.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(mismatchIngest.error.kind, 'TENANT_ISOLATION_VIOLATION');

  const tenantReadOk = capability.readUsage(
    operatorResult.state,
    'org-perm',
    'perm-meter',
    tenantCaller,
  );
  assert.equal(tenantReadOk.status, 'SUCCESS');

  const tenantCrossRead = capability.readUsage(
    operatorResult.state,
    'org-other',
    'perm-meter',
    tenantCaller,
  );
  assert.equal(tenantCrossRead.status, 'FAILURE');
  if (tenantCrossRead.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(tenantCrossRead.error.kind, 'TENANT_ISOLATION_VIOLATION');

  const operatorRead = capability.readUsage(
    operatorResult.state,
    'org-perm',
    'perm-meter',
    operatorCaller,
  );
  assert.equal(operatorRead.status, 'SUCCESS');
  if (operatorRead.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(operatorRead.aggregate.organizationId, 'org-perm');
});

test("usagemeteringandmetereventingestionproof", () => {
  const state = seedReadyState('proof-meter', 'proof-entitlement', 'org-proof');
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-proof',
    meterKey: 'proof-meter',
    quantity: 10,
    idempotencyKey: 'proof-key-1',
    subject: 'subj',
    source: 'src',
  };
  const result = capability.ingestMeterEvent(state, input, caller);
  assert.equal(result.status, 'SUCCESS');
  if (result.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }

  const dup: capability.IngestMeterEventInput = {
    organizationId: 'org-proof',
    meterKey: 'proof-meter',
    quantity: 5,
    idempotencyKey: 'proof-key-1',
    subject: 'subj',
    source: 'src',
  };
  const dupResult = capability.ingestMeterEvent(result.state, dup, caller);
  assert.equal(dupResult.outcome, 'DUPLICATE_RESOLVED');

  const readResult = capability.readUsage(dupResult.state, 'org-proof', 'proof-meter', caller);
  assert.equal(readResult.status, 'SUCCESS');
  if (readResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(readResult.aggregate.totalQuantity, 10);
  assert.equal(readResult.aggregate.eventCount, 1);

  const proof = capability.verifyHermeticLineageProof(dupResult.state);
  assert.equal(proof.verified, true);
  assert.equal(proof.checks.substrateHealthy, true);
  assert.equal(proof.checks.readinessConsistent, true);
  assert.equal(proof.checks.noSecretColumns, true);
  assert.equal(proof.checks.idempotencyPreserved, true);
  assert.equal(proof.checks.entitlementsEnforced, true);
  assert.equal(proof.checks.tenantIsolationPreserved, true);
  assert.equal(proof.checks.aggregateTraceable, true);
});

test("usagemeteringandmetereventingestionreadinessmodel", () => {
  const initial = capability.initialUsageMeteringState;
  assert.equal(initial.readiness, 'NOT_READY');

  const meter: capability.MeterCatalogEntry = {
    meterKey: 'ready-meter',
    entitlementKey: 'ready-entitlement',
    displayName: 'Ready Meter',
    unit: 'units',
  };
  const stateWithMeter = capability.registerMeter(initial, meter);
  assert.equal(stateWithMeter.readiness, 'READY');

  const degraded = capability.setSubstrateAvailability(stateWithMeter, false);
  assert.equal(degraded.readiness, 'DEGRADED');

  const readyState = capability.grantTenantEntitlement(stateWithMeter, {
    organizationId: 'org-ready',
    entitlementKey: 'ready-entitlement',
  });
  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-ready',
    meterKey: 'ready-meter',
    quantity: 1,
    idempotencyKey: 'ready-key-1',
    subject: 'subj',
    source: 'src',
  };
  const caller: capability.CallerContext = { role: 'OPERATOR' };
  const result = capability.ingestMeterEvent(degraded, input, caller);
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.outcome, 'PROVIDER_UNAVAILABLE');
  if (result.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(result.state.readiness, 'DEGRADED');

  const readDegraded = capability.readUsage(degraded, 'org-ready', 'ready-meter', caller);
  assert.equal(readDegraded.status, 'FAILURE');
  if (readDegraded.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(readDegraded.error.kind, 'PROVIDER_UNAVAILABLE');

  const recovered = capability.setSubstrateAvailability(degraded, true);
  assert.equal(recovered.readiness, 'READY');

  const ok = capability.ingestMeterEvent(
    capability.grantTenantEntitlement(stateWithMeter, {
      organizationId: 'org-ready',
      entitlementKey: 'ready-entitlement',
    }),
    input,
    caller,
  );
  assert.equal(ok.status, 'SUCCESS');
});

test("usagemeteringandmetereventingestionstatemodel", () => {
  const state = seedReadyState('state-meter', 'state-entitlement', 'org-state');
  const caller: capability.CallerContext = { role: 'OPERATOR' };
  const input: capability.IngestMeterEventInput = {
    organizationId: 'org-state',
    meterKey: 'state-meter',
    quantity: 10,
    idempotencyKey: 'state-key-1',
    subject: 'subj-state',
    source: 'src-state',
    metadata: { channel: 'web' },
    occurredAt: '2024-01-01T00:00:00.000Z',
  };
  const result = capability.ingestMeterEvent(state, input, caller);
  assert.equal(result.status, 'SUCCESS');
  if (result.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(result.event.organizationId, 'org-state');
  assert.equal(result.event.meterKey, 'state-meter');
  assert.equal(result.event.quantity, 10);
  assert.equal(result.event.idempotencyKey, 'state-key-1');
  assert.equal(result.event.subject, 'subj-state');
  assert.equal(result.event.source, 'src-state');
  assert.deepEqual(result.event.metadata, { channel: 'web' });
  assert.equal(result.event.occurredAt, '2024-01-01T00:00:00.000Z');

  const dup: capability.IngestMeterEventInput = {
    organizationId: 'org-state',
    meterKey: 'state-meter',
    quantity: 5,
    idempotencyKey: 'state-key-1',
    subject: 'subj-state',
    source: 'src-state',
  };
  const dupResult = capability.ingestMeterEvent(result.state, dup, caller);
  assert.equal(dupResult.outcome, 'DUPLICATE_RESOLVED');
  if (dupResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(dupResult.event.quantity, 10);
  assert.equal(dupResult.state.events.length, 1);

  const negative: capability.IngestMeterEventInput = {
    organizationId: 'org-state',
    meterKey: 'state-meter',
    quantity: -4,
    idempotencyKey: 'state-key-2',
    subject: 'subj-state',
    source: 'src-state',
  };
  const negResult = capability.ingestMeterEvent(dupResult.state, negative, caller);
  assert.equal(negResult.outcome, 'ACCEPTED');
  if (negResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(negResult.event.quantity, -4);
  assert.equal(negResult.state.events.length, 2);
});

test("usagemeteringandmetereventingestionvalidation", () => {
  const state = seedReadyState('val-meter', 'val-entitlement', 'org-val');
  const caller: capability.CallerContext = { role: 'OPERATOR' };

  const unknownMeterInput: capability.IngestMeterEventInput = {
    organizationId: 'org-val',
    meterKey: 'missing-meter',
    quantity: 1,
    idempotencyKey: 'val-key-1',
    subject: 'subj',
    source: 'src',
  };
  const r1 = capability.ingestMeterEvent(state, unknownMeterInput, caller);
  assert.equal(r1.status, 'FAILURE');
  assert.equal(r1.outcome, 'UNKNOWN_METER');
  if (r1.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(r1.state.events.length, 0);

  const nanInput: capability.IngestMeterEventInput = {
    organizationId: 'org-val',
    meterKey: 'val-meter',
    quantity: Number.NaN,
    idempotencyKey: 'val-key-2',
    subject: 'subj',
    source: 'src',
  };
  const r2 = capability.ingestMeterEvent(state, nanInput, caller);
  assert.equal(r2.status, 'FAILURE');
  assert.equal(r2.outcome, 'INVALID_QUANTITY');
  if (r2.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(r2.state.events.length, 0);

  const negativeInput: capability.IngestMeterEventInput = {
    organizationId: 'org-val',
    meterKey: 'val-meter',
    quantity: -2,
    idempotencyKey: 'val-key-3',
    subject: 'subj',
    source: 'src',
  };
  const r3 = capability.ingestMeterEvent(state, negativeInput, caller);
  assert.equal(r3.status, 'SUCCESS');
  assert.equal(r3.outcome, 'ACCEPTED');
  if (r3.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(r3.event.quantity, -2);

  const missingEntInput: capability.IngestMeterEventInput = {
    organizationId: 'org-other',
    meterKey: 'val-meter',
    quantity: 1,
    idempotencyKey: 'val-key-4',
    subject: 'subj',
    source: 'src',
  };
  const r4 = capability.ingestMeterEvent(r3.state, missingEntInput, caller);
  assert.equal(r4.status, 'FAILURE');
  assert.equal(r4.outcome, 'MISSING_ENTITLEMENT');
  if (r4.status !== 'FAILURE') {
    throw new Error('unreachable');
  }
  assert.equal(r4.state.events.length, 1);

  const first: capability.IngestMeterEventInput = {
    organizationId: 'org-val',
    meterKey: 'val-meter',
    quantity: 5,
    idempotencyKey: 'val-key-5',
    subject: 'subj',
    source: 'src',
  };
  const firstResult = capability.ingestMeterEvent(r3.state, first, caller);
  assert.equal(firstResult.outcome, 'ACCEPTED');

  const replay: capability.IngestMeterEventInput = {
    organizationId: 'org-val',
    meterKey: 'val-meter',
    quantity: 99,
    idempotencyKey: 'val-key-5',
    subject: 'subj',
    source: 'src',
  };
  const replayResult = capability.ingestMeterEvent(firstResult.state, replay, caller);
  assert.equal(replayResult.status, 'SUCCESS');
  assert.equal(replayResult.outcome, 'DUPLICATE_RESOLVED');
  if (replayResult.status !== 'SUCCESS') {
    throw new Error('unreachable');
  }
  assert.equal(replayResult.isDuplicate, true);
  assert.equal(replayResult.event.quantity, 5);
});