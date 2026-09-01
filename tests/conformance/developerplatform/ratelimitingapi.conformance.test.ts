```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from '../../../src/capabilities/developerplatform/ratelimitingapi.ts';

test('ratelimitingapiauditmodel', () => {
  const state = capability.initialState;
  const auditEvents: capability.RateLimitAuditEvent[] = [];
  const auditFn = (event: capability.RateLimitAuditEvent): capability.RateLimitError | null => {
    auditEvents.push(event);
    return null;
  };
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';
  const policy: capability.RateLimitPolicy = {
    tenantId,
    policyKey,
    entitlementKey: 'ent1',
    limit: 10,
    windowSeconds: 60,
    action: 'DENY',
    updatedAt: new Date().toISOString(),
    updatedBy: operatorId,
  };

  const result = capability.updatePolicy(state, tenantId, policyKey, policy, auditFn, permissionFn, operatorId);
  
  assert.ok(auditEvents.length > 0);
  assert.strictEqual(auditEvents.length, 1);
  const auditEvent = auditEvents[0];
  assert.strictEqual(auditEvent.kind, 'AUDIT_BEFORE_CHANGE');
  assert.strictEqual(auditEvent.tenantId, tenantId);
  assert.strictEqual(auditEvent.policyKey, policyKey);
});

test('ratelimitingapicontracts', () => {
  const state = capability.initialState;
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';
  const updatedState = capability.setPolicy(
    state, tenantId, policyKey, 'ent1', 10, 60, 'DENY', operatorId,
    () => null, permissionFn
  );
  
  assert.ok(!('kind' in updatedState));
  const readResult = capability.readPolicy(updatedState, tenantId, policyKey, permissionFn, operatorId, true);
  assert.ok(!('kind' in readResult));
  const summaryResult = capability.readRateLimitSummary(updatedState, tenantId, permissionFn, operatorId, true);
  assert.ok(!('kind' in summaryResult));
  assert.strictEqual(summaryResult.policies.length, 1);
});

test('ratelimitingapierrormodel', () => {
  const counters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(counters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(counters, true);
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant1',
      policyKey: 'policy1',
      entitlementKey: 'ent1',
      limit: 1,
      windowSeconds: 60,
      action: 'DENY',
      updatedAt: new Date().toISOString(),
      updatedBy: 'operator1',
    }],
    counters: [],
    lastDecision: null,
    lastError: null,
  };
  const token = { entitlement: 'ent1' };

  const evalResult1 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult1.decision, 'ALLOWED');
  assert.strictEqual(evalResult1.error, null);

  const evalResult2 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult2.decision, 'DENIED_LIMIT_EXCEEDED');
  assert.strictEqual(evalResult2.error?.kind, 'LIMIT_EXCEEDED');

  const noEntitlementResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', null, cacheAdapter, relationalAdapter);
  assert.strictEqual(noEntitlementResult.decision, 'DENIED_ENTITLEMENT_MISSING');
  assert.strictEqual(noEntitlementResult.error?.kind, 'ENTITLEMENT_DENIED');

  const degradedCacheAdapter = capability.createMockCacheAdapter(counters, false);
  const degradedResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, degradedCacheAdapter, relationalAdapter);
  assert.strictEqual(degradedResult.decision, 'DEGRADED');
  assert.strictEqual(degradedResult.error?.kind, 'CACHE_UNAVAILABLE');
});

test('ratelimitingapilifecycle', () => {
  const counters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(counters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(counters, true);
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant1',
      policyKey: 'policy1',
      entitlementKey: 'ent1',
      limit: 2,
      windowSeconds: 60,
      action: 'DENY',
      updatedAt: new Date().toISOString(),
      updatedBy: 'operator1',
    }],
    counters: [],
    lastDecision: null,
    lastError: null,
  };
  const token = { entitlement: 'ent1' };

  const noPolicyResult = capability.evaluateRateLimit(
    { ...state, policies: [] },
    'tenant1', 'policy1', token, cacheAdapter, relationalAdapter
  );
  assert.strictEqual(noPolicyResult.decision, 'ALLOWED');

  const evalResult1 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult1.decision, 'ALLOWED');

  const evalResult2 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult2.decision, 'ALLOWED');

  const evalResult3 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult3.decision, 'DENIED_LIMIT_EXCEEDED');
});

test('ratelimitingapermissions', () => {
  const state = capability.initialState;
  const permissionFn = (required: capability.RateLimitPermission, _operatorId: string): boolean => {
    return required === 'PLATFORM_RATE_LIMIT_READ' || required === 'PLATFORM_RATE_LIMIT_WRITE';
  };
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';

  const readResult = capability.readPolicy(state, tenantId, policyKey, permissionFn, operatorId, true);
  assert.ok(!('kind' in readResult));

  const writePermissionFn = (required: capability.RateLimitPermission, _operatorId: string): boolean => {
    return required === 'PLATFORM_RATE_LIMIT_WRITE';
  };
  const updatedState = capability.setPolicy(
    state, tenantId, policyKey, 'ent1', 10, 60, 'DENY', operatorId,
    () => null, writePermissionFn
  );
  assert.ok(!('kind' in updatedState));

  const tenantPermissionFn = (required: capability.RateLimitPermission, _operatorId: string): boolean => {
    return required === 'TENANT_DEVELOPER_READ';
  };
  const tenantReadResult = capability.readPolicy(state, tenantId, policyKey, tenantPermissionFn, operatorId, false);
  assert.ok('kind' in tenantReadResult);
  assert.strictEqual(tenantReadResult.kind, 'PERMISSION_DENIED');

  const noPermissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => false;
  const deniedResult = capability.readPolicy(state, tenantId, policyKey, noPermissionFn, operatorId, true);
  assert.ok('kind' in deniedResult);
  assert.strictEqual(deniedResult.kind, 'PERMISSION_DENIED');
});

test('ratelimitingapiproof', () => {
  const counters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(counters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(counters, true);
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant1',
      policyKey: 'policy1',
      entitlementKey: 'ent1',
      limit: 1,
      windowSeconds: 60,
      action: 'DENY',
      updatedAt: new Date().toISOString(),
      updatedBy: 'operator1',
    }],
    counters: [],
    lastDecision: null,
    lastError: null,
  };
  const token = { entitlement: 'ent1' };

  const evalResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult.decision, 'ALLOWED');
  assert.strictEqual(evalResult.error, null);

  const assertResult = capability.assertRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.ok(!('lastError' in assertResult && assertResult.lastError !== null));
});

test('ratelimitingapireadinessmodel', () => {
  const counters = new Map<string, capability.RateLimitCounter>();
  const readyCache = capability.createMockCacheAdapter(counters, true);
  const readyRelational = capability.createMockRelationalAdapter(counters, true);
  assert.strictEqual(capability.checkReadiness(readyCache, readyRelational), 'READY');

  const degradedCache = capability.createMockCacheAdapter(counters, false);
  const degradedRelational = capability.createMockRelationalAdapter(counters, true);
  assert.strictEqual(capability.checkReadiness(degradedCache, degradedRelational), 'DEGRADED');

  const unavailableCache = capability.createMockCacheAdapter(counters, false);
  const unavailableRelational = capability.createMockRelationalAdapter(counters, false);
  assert.strictEqual(capability.checkReadiness(unavailableCache, unavailableRelational), 'UNAVAILABLE');
});

test('ratelimitingapistatemodel', () => {
  const policy: capability.RateLimitPolicy = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    entit