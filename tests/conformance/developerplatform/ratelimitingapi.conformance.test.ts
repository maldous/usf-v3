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
  const permissionFn = (): boolean => true;
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
  assert.ok('policies' in result);
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, 'AUDIT_BEFORE_CHANGE');
  assert.strictEqual(auditEvents[0].tenantId, tenantId);
  assert.strictEqual(auditEvents[0].policyKey, policyKey);
});

test('ratelimitingapicontracts', () => {
  const state = capability.initialState;
  const permissionFn = (): boolean => true;
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
  const updatedState = capability.setPolicy(
    state, tenantId, policyKey, 'ent1', 10, 60, 'DENY', operatorId,
    () => null, permissionFn
  );
  assert.ok('policies' in updatedState);
  const readResult = capability.readPolicy(updatedState, tenantId, policyKey, permissionFn, operatorId, true);
  assert.ok('policy' in readResult);
  assert.strictEqual(readResult.policyKey, policyKey);
  const summaryResult = capability.readRateLimitSummary(updatedState, tenantId, permissionFn, operatorId, true);
  assert.ok('policies' in summaryResult);
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
  const token = { entitlement: 'ent1' as const };

  // Allowed
  const evalResult1 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult1.decision, 'ALLOWED');
  assert.strictEqual(evalResult1.error, null);

  // Limit exceeded
  const evalResult2 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult2.decision, 'DENIED_LIMIT_EXCEEDED');
  assert.strictEqual(evalResult2.error?.kind, 'LIMIT_EXCEEDED');

  // Missing entitlement
  const noEntitlementResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', null, cacheAdapter, relationalAdapter);
  assert.strictEqual(noEntitlementResult.decision, 'DENIED_ENTITLEMENT_MISSING');
  assert.strictEqual(noEntitlementResult.error?.kind, 'ENTITLEMENT_DENIED');

  // Degraded (cache unavailable)
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
  const token = { entitlement: 'ent1' as const };

  // Initially allowed (no usage yet)
  const noPolicyResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(noPolicyResult.decision, 'ALLOWED');

  // After one use, still allowed (below limit)
  const evalResult1 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult1.decision, 'ALLOWED');

  // After exceeding limit, denied
  const evalResult2 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult2.decision, 'DENIED_LIMIT_EXCEEDED');

  // Counter tracking at limit boundary
  const atLimitState = capability.createOrUpdateCounter(state, 'tenant1', 'policy1', capability.getCurrentWindowStart(60), 1, 1);
  const atLimitResult = capability.evaluateRateLimit(atLimitState, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(atLimitResult.decision, 'DENIED_LIMIT_EXCEEDED');
});

test('ratelimitingapermissions', () => {
  const state = capability.initialState;
  const permissionFn = (required: capability.RateLimitPermission, operatorId: string): boolean => {
    return required === 'PLATFORM_RATE_L