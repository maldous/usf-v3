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
  if ('kind' in readResult) {
    assert.fail('readPolicy should return a policy, not an error');
  }
  assert.strictEqual(readResult.policyKey, policyKey);
  const summaryResult = capability.readRateLimitSummary(updatedState, tenantId, permissionFn, operatorId, true);
  if ('kind' in summaryResult) {
    assert.fail('readRateLimitSummary should return a summary, not an error');
  }
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
  const token = { entitlement: 'ent1' as const };

  const noPolicyState = capability.initialState;
  const noPolicyResult = capability.evaluateRateLimit(noPolicyState, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(noPolicyResult.decision, 'ALLOWED');

  const evalResult1 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult1.decision, 'ALLOWED');
  const evalResult2 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult2.decision, 'ALLOWED');
  const evalResult3 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult3.decision, 'DENIED_LIMIT_EXCEEDED');
});

test('ratelimitingapipermissions', () => {
  const state = capability.initialState;
  const permissionFn = (required: capability.RateLimitPermission, operatorId: string): boolean => {
    return required === 'PLATFORM_RATE_LIMIT_WRITE' && operatorId === 'operator1';
  };
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

  const result = capability.updatePolicy(state, tenantId, policyKey, policy, () => null, permissionFn, operatorId);
  assert.ok('policies' in result);

  const noPermissionFn = (): boolean => false;
  const deniedResult = capability.updatePolicy(state, tenantId, policyKey, policy, () => null, noPermissionFn, operatorId);
  if (!('kind' in deniedResult)) {
    assert.fail('updatePolicy should return an error when permission is denied');
  }
  assert.strictEqual(deniedResult.kind, 'AUDIT_FAILURE');

  const readPermissionFn = (required: capability.RateLimitPermission): boolean => {
    return required === 'PLATFORM_RATE_LIMIT_READ';
  };
  const readResult = capability.readPolicy(state, tenantId, policyKey, readPermissionFn, operatorId, true);
  if (!('kind' in readResult)) {
    assert.fail('readPolicy should return an error when permission is denied');
  }
  assert.strictEqual(readResult.kind, 'AUDIT_FAILURE');

  const tenantReadPermissionFn = (required: capability.RateLimitPermission): boolean => {
    return required === 'TENANT_DEVELOPER_READ';
  };
  const tenantReadResult = capability.readPolicy(state, tenantId, policyKey, tenantReadPermissionFn, operatorId, false);
  if (!('kind' in tenantReadResult)) {
    assert.fail('readPolicy should return an error when tenant permission is denied');
  }
  assert.strictEqual(tenantReadResult.kind, 'AUDIT_FAILURE');

  const invalidTenantResult = capability.updatePolicy(state, '', policyKey, policy, () => null, permissionFn, operatorId);
  if (!('kind' in invalidTenantResult)) {
    assert.fail('updatePolicy should return an error for invalid tenant');
  }
  assert.strictEqual(invalidTenantResult.kind, 'TENANT_INVALID');
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
  const token = { entitlement: 'ent1' as const };

  const evalResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult.decision, 'ALLOWED');
  assert.strictEqual(evalResult.error, null);

  const degradedCacheAdapter = capability.createMockCacheAdapter(counters, false);
  const degradedResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, degradedCacheAdapter, relationalAdapter);
  assert.strictEqual(degradedResult.decision, 'DEGRADED');
  assert.strictEqual(degradedResult.error?.kind, 'CACHE_UNAVAILABLE');
});

test('ratelimitingapireadinessmodel', () => {
  const readyCache = capability.createMockCacheAdapter(new Map(), true);
  const readyRelational = capability.createMockRelationalAdapter(new Map(), true);
  assert.strictEqual(capability.checkReadiness(readyCache, readyRelational), 'READY');

  const degradedCache = capability.createMockCacheAdapter(new Map(), false);
  const degradedRelational = capability.createMockRelationalAdapter(new Map(), true);
  assert.strictEqual(capability.checkReadiness(degradedCache, degradedRelational), 'DEGRADED');

  const unavailableCache = capability.createMockCacheAdapter(new Map(), false);
  const unavailableRelational = capability.createMockRelationalAdapter(new Map(), false);
  assert.strictEqual(capability.checkReadiness(unavailableCache, unavailableRelational), 'UNAVAILABLE');
});

test('ratelimitingapistatemodel', () => {
  const policy: capability.RateLimitPolicy = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    entitlementKey: 'ent1',
    limit: 10,
    windowSeconds: 60,
    action: 'DENY',
    updatedAt: new Date().toISOString(),
    updatedBy: 'operator1',
  };
  assert.strictEqual(policy.tenantId, 'tenant1');
  assert.strictEqual(policy.policyKey, 'policy1');
  assert.strictEqual(policy.entitlementKey, 'ent1');
  assert.strictEqual(policy.limit, 10);
  assert.strictEqual(policy.windowSeconds, 60);
  assert.strictEqual(policy.action, 'DENY');

  const counter: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: 1000,
    usedCount: 11,
    limit: 10,
    exceeded: true,
  };
  assert.strictEqual(counter.tenantId, 'tenant1');
  assert.strictEqual(counter.policyKey, 'policy1');
  assert.strictEqual(counter.windowStart, 1000);
  assert.strictEqual(counter.usedCount, 11);
  assert.strictEqual(counter.limit, 10);
  assert.strictEqual(counter.exceeded, true);
});

test('ratelimitingapivalidation', () => {
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

  const noPolicyResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', { entitlement: 'ent1' as const }, cacheAdapter, relationalAdapter);
  assert.strictEqual(noPolicyResult.decision, 'ALLOWED');

  const missingEntitlementResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', null, cacheAdapter, relationalAdapter);
  assert.strictEqual(missingEntitlementResult.decision, 'DENIED_ENTITLEMENT_MISSING');

  const belowLimitResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', { entitlement: 'ent1' as const }, cacheAdapter, relationalAdapter);
  assert.strictEqual(belowLimitResult.decision, 'ALLOWED');

  const atLimitState = capability.createOrUpdateCounter(state, 'tenant1', 'policy1', capability.getCurrentWindowStart(60), 1, 1);
  const atLimitResult = capability.evaluateRateLimit(atLimitState, 'tenant1', 'policy1', { entitlement: 'ent1' as const }, cacheAdapter, relationalAdapter);
  assert.strictEqual(atLimitResult.decision, 'DENIED_LIMIT_EXCEEDED');

  const invalidTenantResult = capability.evaluateRateLimit(state, '', 'policy1', { entitlement: 'ent1' as const }, cacheAdapter, relationalAdapter);
  assert.strictEqual(invalidTenantResult.decision, 'DENIED_TENANT_INVALID');
});