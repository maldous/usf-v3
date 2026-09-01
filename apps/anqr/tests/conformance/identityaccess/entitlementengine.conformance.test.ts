import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/entitlementengine.ts";

test("entitlementengineauditmodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ['FEATURE_A' as const],
  };
  const auditError: capability.EntitlementEngineError = { kind: 'AUDIT_FAILURE', message: 'Audit failed' };
  const auditFn = (_: capability.EntitlementEngineAuditEvent): capability.EntitlementEngineError | null => auditError;

  const grantResult = capability.grantEntitlement(
    state,
    'tenant1',
    'FEATURE_A',
    'op1',
    'test',
    {},
    auditFn,
  );
  assert.deepEqual(grantResult, auditError);
  assert.equal(state.entitlements.length, 0);

  const revokeResult = capability.revokeEntitlement(
    state,
    'tenant1',
    'FEATURE_A',
    'op1',
    'test',
    {},
    auditFn,
  );
  assert.deepEqual(revokeResult, auditError);
  assert.equal(state.entitlements.length, 0);

  let capturedEvent: capability.EntitlementEngineAuditEvent | null = null;
  const goodAuditFn = (event: capability.EntitlementEngineAuditEvent): null => {
    capturedEvent = event;
    return null;
  };

  const newState = capability.grantEntitlement(
    state,
    'tenant1',
    'FEATURE_A',
    'op1',
    'test',
    {},
    goodAuditFn,
  );
  if (!(newState instanceof Error) && 'entitlements' in newState) {
    assert.notEqual(newState, state);
    assert.equal(capturedEvent?.kind, 'ENTITLEMENT_GRANTED');
    assert.equal(capturedEvent?.newState, 'GRANTED');
  }

  const revokedState = capability.revokeEntitlement(
    newState,
    'tenant1',
    'FEATURE_A',
    'op1',
    'test',
    {},
    goodAuditFn,
  );
  if (!(revokedState instanceof Error) && 'entitlements' in revokedState) {
    assert.notEqual(revokedState, newState);
    assert.equal(capturedEvent?.kind, 'ENTITLEMENT_REVOKED');
    assert.equal(capturedEvent?.newState, 'REVOKED');
  }
});

test("entitlementenginecontracts", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [
      { organisationId: 'tenant1', entitlementKey: 'FEATURE_A', state: 'GRANTED', source: 'test', metadata: {}, updatedAt: '2023-01-01T00:00:00Z', updatedBy: 'op1' },
    ],
    catalogKeys: ['FEATURE_A' as const],
  };

  const tenantReadResult = capability.tenantSelfReadEntitlements(
    state,
    'tenant1',
    ['TENANT_ENTITLEMENTS_READ' as const],
  );
  assert.ok('result' in tenantReadResult);
  if ('result' in tenantReadResult) {
    assert.equal(tenantReadResult.result.length, 1);
    assert.equal(tenantReadResult.result[0].entitlementKey, 'FEATURE_A');
    assert.equal(tenantReadResult.result[0].state, 'GRANTED');
  }

  const operatorReadResult = capability.operatorReadEntitlements(
    state,
    'tenant1',
    ['PLATFORM_ENTITLEMENTS_READ' as const],
  );
  assert.ok('result' in operatorReadResult);
  if ('result' in operatorReadResult) {
    assert.equal(operatorReadResult.result.length, 1);
  }

  const operatorWriteResult = capability.operatorWriteEntitlement(
    state,
    'tenant1',
    'FEATURE_A',
    'GRANT',
    'op1',
    'test',
    {},
    ['PLATFORM_ENTITLEMENTS_WRITE' as const],
    (_) => null,
  );
  if (!(operatorWriteResult instanceof Error) && 'entitlements' in operatorWriteResult) {
    assert.notEqual(operatorWriteResult, state);
  }

  const catalogResult = capability.serviceCatalogRead(state);
  assert.deepEqual(catalogResult.result, ['FEATURE_A']);

  const evalResult = capability.evaluateAccess(
    state,
    'tenant1',
    'FEATURE_A',
    ['TENANT_ENTITLEMENTS_READ' as const],
  );
  assert.ok('decision' in evalResult);
  if ('decision' in evalResult) {
    assert.equal(evalResult.decision, 'ALLOWED');
  }

  const assertResult = capability.assertAccess(
    state,
    'tenant1',
    'FEATURE_A',
    ['TENANT_ENTITLEMENTS_READ' as const],
  );
  assert.equal(assertResult, null);
});

test("entitlementengineerrormodel", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ['FEATURE_A' as const],
  };

  const assertResult = capability.assertAccess(
    state,
    'tenant1',
    'FEATURE_A',
    ['TENANT_ENTITLEMENTS_READ' as const],
  );
  assert.notEqual(assertResult, null);
  if (assertResult !== null) {
    assert.equal(assertResult.kind, 'FORBIDDEN');
  }

  const evalResult = capability.evaluateAccess(
    state,
    'tenant1',
    'FEATURE_A',
    ['TENANT_ENTITLEMENTS_READ' as const],
  );
  assert.ok('decision' in evalResult);
  if ('decision' in evalResult) {
    assert.equal(evalResult.decision, 'DENIED');
  }

  const invalidTenantResult = capability.tenantSelfReadEntitlements(
    state,
    '',
    ['TENANT_ENTITLEMENTS_READ' as const],
  );
  if ('kind' in invalidTenantResult) {
    assert.equal(invalidTenantResult.kind, 'INVALID_TENANT');
  }

  const invalidKeyResult = capability.evaluateAccess(
    state,
    'tenant1',
    'UNKNOWN',
    ['TENANT_ENTITLEMENTS_READ' as const],
  );
  if ('kind' in invalidKeyResult) {
    assert.equal(invalidKeyResult.kind, 'INVALID_KEY');
  }

  const missingPermissionResult = capability.tenantSelfReadEntitlements(
    state,
    'tenant1',
    [],
  );
  if ('kind' in missingPermissionResult) {
    assert.equal(missingPermissionResult.kind, 'FORBIDDEN');
  }
});

test("entitlementenginelifecycle", () => {
  const state: capability.EntitlementEngineState = {
    entitlements: [],
    catalogKeys: ['FEATURE_A' as const, 'FEATURE_B' as const],
  };

  const initialEval = capability