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

  assert.ok(!('kind' in result));
  assert.strictEqual(auditEvents.length, 1);
  const auditEvent = auditEvents[0];
  assert.strictEqual(auditEvent.kind, 'AUDIT_BEFORE_CHANGE');
  assert.strictEqual(auditEvent.tenantId, tenantId);
  assert.strictEqual(auditEvent.policyKey, policyKey);
  assert.deepStrictEqual(auditEvent.policy, policy);
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
  const stateAfter = updatedState as capability.RateLimitState;
  const readResult = capability.readPolicy(stateAfter, tenantId, policyKey, permissionFn, operatorId, true);
  assert.ok(!('kind' in readResult));
  const summaryResult = capability.readRateLimitSummary(stateAfter, tenantId, permissionFn, operatorId, true);
  assert.ok(!('kind' in summaryResult));
  const summary = summaryResult as { readonly policies: readonly capability.RateLimitPolicy[] };
  assert.strictEqual(summary.policies.length, 1);
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
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  const evalResult1 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult1.decision, 'ALLOWED');
  assert.strictEqual(evalResult1.error, null);

  const evalResult2 = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult2.decision, 'DENIED_LIMIT_EXCEEDED');
  assert.strictEqual(evalResult2.error?.kind, 'LIMIT_EXCEEDED');

  const noEntitlementResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', null, cacheAdapter, relationalAdapter);
  assert.strictEqual(noEntitlementResult.decision, 'DENIED_ENTITLEMENT_MISSING');
  assert.strictEqual(noEntitlementResult.error?.kind, 'ENTITLEMENT_DENIED');

  const degradedCacheAdapter = capability.createMockCacheAdapter(new Map(), false);
  const degradedResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, degradedCacheAdapter, relationalAdapter);
  assert.strictEqual(degradedResult.decision, 'DEGRADED');
  assert.strictEqual(degradedResult.error?.kind, 'CACHE_UNAVAILABLE');

  assert.throws(() => {
    capability.assertRateLimit(state, 'tenant1', 'policy1', null, cacheAdapter, relationalAdapter);
  }, /Entitlement denied/);

  assert.throws(() => {
    const overCache = capability.createMockCacheAdapter(new Map(), true);
    const overRelational = capability.createMockRelationalAdapter(new Map(), true);
    const overState: capability.RateLimitState = {
      ...capability.initialState,
      policies: [{
        tenantId: 'tenant1',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 0,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      }],
      counters: [],
      lastDecision: null,
      lastError: null,
    };
    capability.assertRateLimit(overState, 'tenant1', 'policy1', token, overCache, overRelational);
  }, /Rate limit exceeded/);
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
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

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

  const newWindowStart = capability.getNextWindowStart(60);
  const newCounter = capability.createOrUpdateCounter(state, 'tenant1', 'policy1', newWindowStart, 0, 2);
  assert.strictEqual(newCounter.counters.length, 1);
  assert.strictEqual(newCounter.counters[0].windowStart, newWindowStart);
  assert.strictEqual(newCounter.counters[0].usedCount, 0);
  assert.strictEqual(newCounter.counters[0].exceeded, false);
});

test('ratelimitingapipermissions', () => {
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant1',
      policyKey: 'policy1',
      entitlementKey: 'ent1',
      limit: 10,
      windowSeconds: 60,
      action: 'DENY',
      updatedAt: new Date().toISOString(),
      updatedBy: 'operator1',
    }],
    counters: [],
    lastDecision: null,
    lastError: null,
  };
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';

  const operatorReadPermissionFn = (required: capability.RateLimitPermission, _operatorId: string): boolean => {
    return required === 'PLATFORM_RATE_LIMIT_READ';
  };
  const readResult = capability.readPolicy(state, tenantId, policyKey, operatorReadPermissionFn, operatorId, true);
  assert.ok(!('kind' in readResult));
  const policy = readResult as capability.RateLimitPolicy;
  assert.strictEqual(policy.policyKey, policyKey);

  const tenantReadPermissionFn = (required: capability.RateLimitPermission, _operatorId: string): boolean => {
    return required === 'TENANT_DEVELOPER_READ';
  };
  const tenantReadResult = capability.readPolicy(state, tenantId, policyKey, tenantReadPermissionFn, operatorId, false);
  assert.ok('kind' in tenantReadResult);
  assert.strictEqual((tenantReadResult as capability.RateLimitError).kind, 'PERMISSION_DENIED');

  const noOperatorReadResult = capability.readPolicy(state, tenantId, policyKey, () => false, operatorId, true);
  assert.ok('kind' in noOperatorReadResult);
  assert.strictEqual((noOperatorReadResult as capability.RateLimitError).kind, 'PERMISSION_DENIED');

  const writePermissionFn = (required: capability.RateLimitPermission, _operatorId: string): boolean => {
    return required === 'PLATFORM_RATE_LIMIT_WRITE';
  };
  const updatedState = capability.setPolicy(
    state, tenantId, policyKey, 'ent1', 10, 60, 'DENY', operatorId,
    () => null, writePermissionFn
  );
  assert.ok(!('kind' in updatedState));

  const noWritePermissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => false;
  const deniedWriteResult = capability.setPolicy(
    state, tenantId, policyKey, 'ent1', 10, 60, 'DENY', operatorId,
    () => null, noWritePermissionFn
  );
  assert.ok('kind' in deniedWriteResult);
  assert.strictEqual((deniedWriteResult as capability.RateLimitError).kind, 'PERMISSION_DENIED');

  const invalidTenantResult = capability.readPolicy(state, 'invalid@tenant', policyKey, operatorReadPermissionFn, operatorId, true);
  assert.ok('kind' in invalidTenantResult);
  assert.strictEqual((invalidTenantResult as capability.RateLimitError).kind, 'TENANT_INVALID');

  const invalidTenantWriteResult = capability.setPolicy(
    state, 'invalid@tenant', policyKey, 'ent1', 10, 60, 'DENY', operatorId,
    () => null, writePermissionFn
  );
  assert.ok('kind' in invalidTenantWriteResult);
  assert.strictEqual((invalidTenantWriteResult as capability.RateLimitError).kind, 'TENANT_INVALID');

  const counters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(counters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(counters, true);
  const wrongEntitlement: { readonly entitlement: string } = { entitlement: 'wrong' };
  const entitlementDenied = capability.evaluateRateLimit(state, tenantId, policyKey, wrongEntitlement, cacheAdapter, relationalAdapter);
  assert.strictEqual(entitlementDenied.decision, 'DENIED_ENTITLEMENT_MISSING');
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
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  const evalResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult.decision, 'ALLOWED');
  assert.strictEqual(evalResult.error, null);

  const assertState1 = capability.assertRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(assertState1.counters.length, 1);

  const assertState2 = capability.assertRateLimit(assertState1, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(assertState2, assertState1);

  const denyResult = capability.evaluateRateLimit(assertState1, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(denyResult.decision, 'DENIED_LIMIT_EXCEEDED');

  assert.throws(() => {
    capability.assertRateLimit(state, 'tenant1', 'policy1', null, cacheAdapter, relationalAdapter);
  }, /Entitlement denied/);

  const degradedCounters = new Map<string, capability.RateLimitCounter>();
  const degradedCacheAdapter = capability.createMockCacheAdapter(degradedCounters, false);
  const degradedRelationalAdapter = capability.createMockRelationalAdapter(degradedCounters, true);
  const degradedState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant2',
      policyKey: 'policy1',
      entitlementKey: 'ent1',
      limit: 5,
      windowSeconds: 60,
      action: 'DENY',
      updatedAt: new Date().toISOString(),
      updatedBy: 'operator1',
    }],
    counters: [],
    lastDecision: null,
    lastError: null,
  };
  const degradedResult = capability.evaluateRateLimit(degradedState, 'tenant2', 'policy1', token, degradedCacheAdapter, degradedRelationalAdapter);
  assert.strictEqual(degradedResult.decision, 'DEGRADED');
  assert.strictEqual(degradedResult.error?.kind, 'CACHE_UNAVAILABLE');

  const degradedAssertState = capability.assertRateLimit(degradedState, 'tenant2', 'policy1', token, degradedCacheAdapter, degradedRelationalAdapter);
  assert.strictEqual(degradedAssertState.counters.length, 1);
});

test('ratelimitingapireadinessmodel', () => {
  const counters = new Map<string, capability.RateLimitCounter>();
  const readyCache = capability.createMockCacheAdapter(counters, true);
  const readyRelational = capability.createMockRelationalAdapter(counters, true);
  assert.strictEqual(capability.checkReadiness(readyCache, readyRelational), 'READY');

  const degradedCache = capability.createMockCacheAdapter(new Map(), false);
  const degradedRelational = capability.createMockRelationalAdapter(new Map(), true);
  assert.strictEqual(capability.checkReadiness(degradedCache, degradedRelational), 'DEGRADED');

  const unavailableCache = capability.createMockCacheAdapter(new Map(), false);
  const unavailableRelational = capability.createMockRelationalAdapter(new Map(), false);
  assert.strictEqual(capability.checkReadiness(unavailableCache, unavailableRelational), 'UNAVAILABLE');

  const cacheDownCounters = new Map<string, capability.RateLimitCounter>();
  const cacheDown = capability.createMockCacheAdapter(cacheDownCounters, false);
  const relationalUp = capability.createMockRelationalAdapter(cacheDownCounters, true);
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant1',
      policyKey: 'policy1',
      entitlementKey: 'ent1',
      limit: 5,
      windowSeconds: 60,
      action: 'DENY',
      updatedAt: new Date().toISOString(),
      updatedBy: 'operator1',
    }],
    counters: [],
    lastDecision: null,
    lastError: null,
  };
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };
  const fallbackResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheDown, relationalUp);
  assert.strictEqual(fallbackResult.decision, 'DEGRADED');
});

test('ratelimitingapistatemodel', () => {
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant1',
      policyKey: 'policy1',
      entitlementKey: 'ent1',
      limit: 10,
      windowSeconds: 60,
      action: 'DENY',
      updatedAt: new Date().toISOString(),
      updatedBy: 'operator1',
    }],
    counters: [],
    lastDecision: null,
    lastError: null,
  };

  const counters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(counters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(counters, true);
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  const evalResult = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(evalResult.decision, 'ALLOWED');

  const updatedState = capability.assertRateLimit(state, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(updatedState.counters.length, 1);
  const counter = updatedState.counters[0];
  assert.strictEqual(counter.tenantId, 'tenant1');
  assert.strictEqual(counter.policyKey, 'policy1');
  assert.strictEqual(counter.usedCount, 1);
  assert.strictEqual(counter.limit, 10);
  assert.strictEqual(counter.exceeded, false);

  const exceededState = capability.assertRateLimit(updatedState, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(exceededState.counters[0].usedCount, 2);
  assert.strictEqual(exceededState.counters[0].exceeded, false);

  const limitState: capability.RateLimitState = {
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
  const freshCounters = new Map<string, capability.RateLimitCounter>();
  const freshCache = capability.createMockCacheAdapter(freshCounters, true);
  const freshRelational = capability.createMockRelationalAdapter(freshCounters, true);
  const limitAssertState = capability.assertRateLimit(limitState, 'tenant1', 'policy1', token, freshCache, freshRelational);
  assert.strictEqual(limitAssertState.counters[0].usedCount, 1);
  assert.strictEqual(limitAssertState.counters[0].exceeded, false);
  const limitExceededEvalResult = capability.evaluateRateLimit(limitAssertState, 'tenant1', 'policy1', token, freshCache, freshRelational);
  assert.strictEqual(limitExceededEvalResult.decision, 'DENIED_LIMIT_EXCEEDED');

  const policy = state.policies[0];
  assert.strictEqual(policy.policyKey, 'policy1');
  assert.strictEqual(policy.entitlementKey, 'ent1');
  assert.strictEqual(policy.limit, 10);
  assert.strictEqual(policy.windowSeconds, 60);
  assert.strictEqual(policy.action, 'DENY');

  const windowA = capability.getCurrentWindowStart(60);
  const windowB = capability.getNextWindowStart(60);
  assert.notStrictEqual(windowA, windowB);
  assert.strictEqual(capability.calculateWindowExpiry(windowA, 60), windowB);

  const resetCounter = capability.createOrUpdateCounter(updatedState, 'tenant1', 'policy1', windowB, 1, 10);
  assert.strictEqual(resetCounter.counters.length, 2);
  const newBucket = resetCounter.counters.find((c) => c.windowStart === windowB);
  assert.ok(newBucket !== undefined);
  assert.strictEqual(newBucket?.usedCount, 1);
});

test('ratelimitingapivalidation', () => {
  const state = capability.initialState;
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';

  const invalidTenantResult = capability.readPolicy(state, 'invalid@tenant', policyKey, permissionFn, operatorId, true);
  assert.ok('kind' in invalidTenantResult);
  assert.strictEqual((invalidTenantResult as capability.RateLimitError).kind, 'TENANT_INVALID');

  const invalidPolicy: capability.RateLimitPolicy = {
    tenantId,
    policyKey,
    entitlementKey: '',
    limit: 0,
    windowSeconds: 0,
    action: 'DENY',
    updatedAt: new Date().toISOString(),
    updatedBy: operatorId,
  };
  const policyValidationError = capability.validatePolicy(invalidPolicy);
  assert.ok(policyValidationError !== null);
  assert.strictEqual((policyValidationError as capability.RateLimitError).kind, 'INVALID_POLICY');

  const counters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(counters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(counters, true);
  const stateWithPolicy: capability.RateLimitState = {
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
  const noEntitlementResult = capability.evaluateRateLimit(stateWithPolicy, 'tenant1', 'policy1', null, cacheAdapter, relationalAdapter);
  assert.strictEqual(noEntitlementResult.decision, 'DENIED_ENTITLEMENT_MISSING');
  assert.strictEqual(noEntitlementResult.error?.kind, 'ENTITLEMENT_DENIED');
  assert.strictEqual(stateWithPolicy.counters.length, 0);

  const token: { readonly entitlement: string } = { entitlement: 'ent1' };
  const allowedResult = capability.evaluateRateLimit(stateWithPolicy, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(allowedResult.decision, 'ALLOWED');
  const deniedResult = capability.evaluateRateLimit(stateWithPolicy, 'tenant1', 'policy1', token, cacheAdapter, relationalAdapter);
  assert.strictEqual(deniedResult.decision, 'DENIED_LIMIT_EXCEEDED');

  const atLimitCounters = new Map<string, capability.RateLimitCounter>();
  const atLimitCache = capability.createMockCacheAdapter(atLimitCounters, true);
  const atLimitRelational = capability.createMockRelationalAdapter(atLimitCounters, true);
  const atLimitState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [{
      tenantId: 'tenant2',
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
  const firstResult = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atLimitCache, atLimitRelational);
  assert.strictEqual(firstResult.decision, 'ALLOWED');
  const secondResult = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atLimitCache, atLimitRelational);
  assert.strictEqual(secondResult.decision, 'ALLOWED');
  const thirdResult = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atLimitCache, atLimitRelational);
  assert.strictEqual(thirdResult.decision, 'DENIED_LIMIT_EXCEEDED');
});