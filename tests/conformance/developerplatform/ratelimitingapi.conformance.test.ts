import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from '../../../src/capabilities/developerplatform/ratelimitingapi.ts';

test('ratelimitingapiauditmodel', () => {
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
    tenantKey: tenantId,
    policyKey,
    entitlementKey: 'ent1',
    limit: 10,
    windowSeconds: 60,
    action: 'DENY',
    updatedAt: new Date().toISOString(),
    updatedBy: operatorId,
  };

  const result = capability.updatePolicy(
    capability.initialState,
    tenantId,
    policyKey,
    policy,
    auditFn,
    permissionFn,
    operatorId,
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(auditEvents.length, 1);
  const auditEvent = auditEvents[0]!;
  assert.strictEqual(auditEvent.kind, 'AUDIT_BEFORE_CHANGE');
  assert.strictEqual(auditEvent.tenantId, tenantId);
  assert.strictEqual(auditEvent.policyKey, policyKey);
  assert.deepStrictEqual(auditEvent.policy, policy);
  assert.strictEqual(typeof auditEvent.timestamp, 'string');
  assert.strictEqual(auditEvent.operatorId, operatorId);

  let newState: capability.RateLimitState = capability.initialState;
  if (result.ok === true) {
    newState = result.state;
  }
  assert.strictEqual(newState.policies.length, 1);

  const failingAudit = (_event: capability.RateLimitAuditEvent): capability.RateLimitError | null => ({
    kind: 'AUDIT_FAILURE',
    message: 'audit blocked',
  });
  const blocked = capability.updatePolicy(
    capability.initialState,
    tenantId,
    policyKey,
    policy,
    failingAudit,
    permissionFn,
    operatorId,
  );
  assert.strictEqual(blocked.ok, false);
  if (blocked.ok === false) {
    assert.strictEqual(blocked.error.kind, 'AUDIT_FAILURE');
  }

  const tokens = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(tokens, true);
  const relational = capability.createMockRelationalAdapter(tokens, true);
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };
  const evalResult = capability.evaluateRateLimit(newState, tenantId, policyKey, token, cache, relational);
  assert.ok(
    evalResult.decision === 'ALLOWED' ||
      evalResult.decision === 'DENIED_LIMIT_EXCEEDED' ||
      evalResult.decision === 'DEGRADED',
  );
});

test('ratelimitingapicontracts', () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';

  const updated = capability.setPolicy(
    capability.initialState,
    tenantId,
    policyKey,
    'ent1',
    10,
    60,
    'DENY',
    operatorId,
    () => null,
    permissionFn,
  );
  assert.strictEqual(updated.ok, true);
  if (updated.ok !== true) {
    assert.fail('expected setPolicy to succeed');
  }
  const stateAfter: capability.RateLimitState = updated.state;

  const operatorRead = capability.readPolicy(stateAfter, tenantId, policyKey, permissionFn, operatorId, true);
  assert.strictEqual(operatorRead.ok, true);

  const developerRead = capability.readPolicy(stateAfter, tenantId, policyKey, permissionFn, 'developer1', false);
  assert.strictEqual(developerRead.ok, true);

  const summary = capability.getRateLimitSummary(stateAfter, tenantId, permissionFn, 'developer1', false);
  assert.strictEqual(summary.ok, true);
  if (summary.ok === true) {
    assert.strictEqual(summary.policies.length, 1);
  }

  const cache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const relational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  assert.strictEqual(typeof cache.ping(), 'boolean');
  assert.strictEqual(typeof cache.getCounter, 'function');
  assert.strictEqual(typeof cache.setCounter, 'function');
  assert.strictEqual(typeof relational.ping(), 'boolean');
  assert.strictEqual(typeof relational.getCounter, 'function');
  assert.strictEqual(typeof relational.setCounter, 'function');
});

test('ratelimitingapierrormodel', () => {
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant1',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 1,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      },
    ],
  };
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  const freshCounters = new Map<string, capability.RateLimitCounter>();
  const freshCache = capability.createMockCacheAdapter(freshCounters, true);
  const freshRelational = capability.createMockRelationalAdapter(freshCounters, true);

  const noEntitlement = capability.evaluateRateLimit(state, 'tenant1', 'policy1', null, freshCache, freshRelational);
  assert.strictEqual(noEntitlement.decision, 'DENIED_ENTITLEMENT_MISSING');
  assert.ok(noEntitlement.error !== null);
  if (noEntitlement.error !== null) {
    assert.strictEqual(noEntitlement.error.kind, 'ENTITLEMENT_DENIED');
  }

  assert.throws(() => {
    capability.assertRateLimit(state, 'tenant1', 'policy1', null, freshCache, freshRelational);
  });

  const allowedCounters = new Map<string, capability.RateLimitCounter>();
  const allowedCache = capability.createMockCacheAdapter(allowedCounters, true);
  const allowedRelational = capability.createMockRelationalAdapter(allowedCounters, true);
  const first = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, allowedCache, allowedRelational);
  assert.strictEqual(first.decision, 'ALLOWED');
  const second = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, allowedCache, allowedRelational);
  assert.strictEqual(second.decision, 'DENIED_LIMIT_EXCEEDED');
  assert.ok(second.error !== null);
  if (second.error !== null) {
    assert.strictEqual(second.error.kind, 'LIMIT_EXCEEDED');
  }

  assert.throws(() => {
    capability.assertRateLimit(state, 'tenant1', 'policy1', token, allowedCache, allowedRelational);
  });

  const degradedCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const degradedRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const degraded = capability.evaluateRateLimit(state, 'tenant1', 'policy1', token, degradedCache, degradedRelational);
  assert.strictEqual(degraded.decision, 'DEGRADED');
  assert.ok(degraded.error !== null);
  if (degraded.error !== null) {
    assert.strictEqual(degraded.error.kind, 'CACHE_UNAVAILABLE');
  }

  const ambiguousCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const ambiguousRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const ambiguous = capability.evaluateWithDegradedFallback(state, 'tenant1', 'policy1', token, ambiguousCache, ambiguousRelational);
  assert.strictEqual(ambiguous.decision, 'DENIED_LIMIT_EXCEEDED');
  assert.ok(ambiguous.error !== null);
  if (ambiguous.error !== null) {
    assert.strictEqual(ambiguous.error.kind, 'AMBIGUOUS_PROVIDER');
  }
});

test('ratelimitingapilifecycle', () => {
  const permissionFn = (_r: capability.RateLimitPermission, _op: string): boolean => true;
  const operatorId = 'operator1';

  const setResult = capability.setPolicy(
    capability.initialState,
    'tenant1',
    'policy1',
    'ent1',
    2,
    60,
    'DENY',
    operatorId,
    () => null,
    permissionFn,
  );
  assert.strictEqual(setResult.ok, true);
  if (setResult.ok !== true) {
    assert.fail('expected setPolicy to succeed');
  }
  const policyState: capability.RateLimitState = setResult.state;

  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  const noPolicyCounters = new Map<string, capability.RateLimitCounter>();
  const noPolicyCache = capability.createMockCacheAdapter(noPolicyCounters, true);
  const noPolicyRelational = capability.createMockRelationalAdapter(noPolicyCounters, true);
  const noPolicyResult = capability.evaluateRateLimit(
    capability.initialState,
    'tenant1',
    'policy1',
    token,
    noPolicyCache,
    noPolicyRelational,
  );
  assert.strictEqual(noPolicyResult.decision, 'ALLOWED');

  const counters = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(counters, true);
  const relational = capability.createMockRelationalAdapter(counters, true);
  const eval1 = capability.evaluateRateLimit(policyState, 'tenant1', 'policy1', token, cache, relational);
  assert.strictEqual(eval1.decision, 'ALLOWED');
  const eval2 = capability.evaluateRateLimit(policyState, 'tenant1', 'policy1', token, cache, relational);
  assert.strictEqual(eval2.decision, 'ALLOWED');
  const eval3 = capability.evaluateRateLimit(policyState, 'tenant1', 'policy1', token, cache, relational);
  assert.strictEqual(eval3.decision, 'DENIED_LIMIT_EXCEEDED');

  const current = capability.getCurrentWindowStart(60, 1_700_000_000_000);
  const next = capability.getNextWindowStart(60, 1_700_000_000_000);
  assert.strictEqual(current + 60 * 1000, next);
  assert.strictEqual(capability.calculateWindowExpiry(current, 60), next);

  const newBucket = capability.createOrUpdateCounter(policyState, 'tenant1', 'policy1', next, 1, 2);
  assert.strictEqual(newBucket.counters.length, 1);
  const bucket = newBucket.counters[0]!;
  assert.strictEqual(bucket.windowStart, next);
  assert.strictEqual(bucket.usedCount, 1);
  assert.strictEqual(bucket.exceeded, false);
});

test('ratelimitingapipermissions', () => {
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant1',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 10,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      },
    ],
  };
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';

  const opReadPermission = (required: capability.RateLimitPermission, _op: string): boolean =>
    required === 'PLATFORM_RATE_LIMIT_READ';
  const opWritePermission = (required: capability.RateLimitPermission, _op: string): boolean =>
    required === 'PLATFORM_RATE_LIMIT_WRITE';
  const tenantReadPermission = (required: capability.RateLimitPermission, _op: string): boolean =>
    required === 'TENANT_DEVELOPER_READ';
  const denyAll = (_r: capability.RateLimitPermission, _op: string): boolean => false;

  const operatorReadOk = capability.readPolicy(state, tenantId, policyKey, opReadPermission, operatorId, true);
  assert.strictEqual(operatorReadOk.ok, true);

  const tenantReadOk = capability.readPolicy(state, tenantId, policyKey, tenantReadPermission, 'dev1', false);
  assert.strictEqual(tenantReadOk.ok, true);

  const tenantDeniedForOperatorPerm = capability.readPolicy(state, tenantId, policyKey, opReadPermission, 'dev1', false);
  assert.strictEqual(tenantDeniedForOperatorPerm.ok, false);
  if (tenantDeniedForOperatorPerm.ok === false) {
    assert.strictEqual(tenantDeniedForOperatorPerm.error.kind, 'PERMISSION_DENIED');
  }

  const operatorDeniedForTenantPerm = capability.readPolicy(state, tenantId, policyKey, tenantReadPermission, operatorId, true);
  assert.strictEqual(operatorDeniedForTenantPerm.ok, false);
  if (operatorDeniedForTenantPerm.ok === false) {
    assert.strictEqual(operatorDeniedForTenantPerm.error.kind, 'PERMISSION_DENIED');
  }

  const everythingDenied = capability.readPolicy(state, tenantId, policyKey, denyAll, operatorId, true);
  assert.strictEqual(everythingDenied.ok, false);
  if (everythingDenied.ok === false) {
    assert.strictEqual(everythingDenied.error.kind, 'PERMISSION_DENIED');
  }

  const writeOk = capability.setPolicy(
    state,
    tenantId,
    policyKey,
    'ent1',
    10,
    60,
    'DENY',
    operatorId,
    () => null,
    opWritePermission,
  );
  assert.strictEqual(writeOk.ok, true);

  const writeDenied = capability.setPolicy(
    state,
    tenantId,
    policyKey,
    'ent1',
    10,
    60,
    'DENY',
    operatorId,
    () => null,
    denyAll,
  );
  assert.strictEqual(writeDenied.ok, false);
  if (writeDenied.ok === false) {
    assert.strictEqual(writeDenied.error.kind, 'PERMISSION_DENIED');
  }

  const invalidTenantRead = capability.readPolicy(state, 'invalid@tenant', policyKey, opReadPermission, operatorId, true);
  assert.strictEqual(invalidTenantRead.ok, false);
  if (invalidTenantRead.ok === false) {
    assert.strictEqual(invalidTenantRead.error.kind, 'TENANT_INVALID');
  }

  const invalidTenantWrite = capability.setPolicy(
    state,
    'invalid@tenant',
    policyKey,
    'ent1',
    10,
    60,
    'DENY',
    operatorId,
    () => null,
    opWritePermission,
  );
  assert.strictEqual(invalidTenantWrite.ok, false);
  if (invalidTenantWrite.ok === false) {
    assert.strictEqual(invalidTenantWrite.error.kind, 'TENANT_INVALID');
  }

  const counters = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(counters, true);
  const relational = capability.createMockRelationalAdapter(counters, true);
  const wrongEntitlement: { readonly entitlement: string } = { entitlement: 'wrong' };
  const wrongEntitlementResult = capability.evaluateRateLimit(state, tenantId, policyKey, wrongEntitlement, cache, relational);
  assert.strictEqual(wrongEntitlementResult.decision, 'DENIED_ENTITLEMENT_MISSING');
});

test('ratelimitingapiproof', () => {
  const counters = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(counters, true);
  const relational = capability.createMockRelationalAdapter(counters, true);
  const permissionFn = (_r: capability.RateLimitPermission, _op: string): boolean => true;

  const proof = capability.runHermeticProof(
    capability.initialState,
    'tenant1',
    'policy1',
    'ent1',
    2,
    60,
    cache,
    relational,
    'operator1',
    () => null,
    permissionFn,
  );

  assert.strictEqual(typeof proof.state, 'object');
  assert.strictEqual(proof.relationalProofRan, true);
  assert.strictEqual(proof.cacheProofRan, true);
  assert.strictEqual(proof.operatorRouteValid, true);
  assert.strictEqual(proof.degradedFallbackValid, true);
  assert.strictEqual(proof.permissionValidationValid, true);
  assert.strictEqual(proof.errorModelValid, true);
  assert.strictEqual(proof.auditBeforeMutationValid, true);
  assert.strictEqual(proof.entitlementPrecedesCountValid, true);
  assert.strictEqual(proof.freshProofPending, true);
  assert.strictEqual(proof.state.policies.length, 1);

  const proofPolicy = proof.state.policies.find((p) => p.tenantKey === 'tenant1');
  assert.ok(proofPolicy !== undefined);

  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  const freshCacheStore = new Map<string, capability.RateLimitCounter>();
  const freshRelationalStore = new Map<string, capability.RateLimitCounter>();
  const freshCache = capability.createMockCacheAdapter(freshCacheStore, true);
  const freshRelational = capability.createMockRelationalAdapter(freshRelationalStore, true);

  let liveState = proof.state;
  for (let i = 0; i < 2; i++) {
    const evalResult = capability.evaluateRateLimit(
      liveState,
      'tenant1',
      proofPolicy!.policyKey,
      token,
      freshCache,
      freshRelational,
    );
    assert.ok(evalResult.decision === 'ALLOWED' || evalResult.decision === 'DEGRADED');
    assert.ok(evalResult.counter !== null);
    if (evalResult.counter !== null) {
      liveState = capability.bucketCounterByWindow(
        liveState,
        'tenant1',
        proofPolicy!.policyKey,
        evalResult.counter.windowStart,
        evalResult.counter.usedCount,
        evalResult.counter.limit,
      );
    }
  }
  const exceededEval = capability.evaluateRateLimit(
    liveState,
    'tenant1',
    proofPolicy!.policyKey,
    token,
    freshCache,
    freshRelational,
  );
  assert.strictEqual(exceededEval.decision, 'DENIED_LIMIT_EXCEEDED');

  const degradedCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const degradedRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const degraded = capability.evaluateWithDegradedFallback(proof.state, 'tenant1', proofPolicy!.policyKey, token, degradedCache, degradedRelational);
  assert.strictEqual(degraded.decision, 'DEGRADED');

  const ambiguousCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const ambiguousRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const ambiguous = capability.evaluateWithDegradedFallback(proof.state, 'tenant1', proofPolicy!.policyKey, token, ambiguousCache, ambiguousRelational);
  assert.strictEqual(ambiguous.decision, 'DENIED_LIMIT_EXCEEDED');
  assert.ok(ambiguous.error !== null);
  if (ambiguous.error !== null) {
    assert.strictEqual(ambiguous.error.kind, 'AMBIGUOUS_PROVIDER');
  }

  const downRelationalCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const downRelationalRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const downRelationalProof = capability.runHermeticProof(
    capability.initialState,
    'tenant1',
    'policy1',
    'ent1',
    2,
    60,
    downRelationalCache,
    downRelationalRelational,
    'operator1',
    () => null,
    permissionFn,
  );
  assert.strictEqual(downRelationalProof.relationalProofRan, false);
  assert.strictEqual(downRelationalProof.cacheProofRan, false);
  assert.strictEqual(downRelationalProof.freshProofPending, true);
});

test('ratelimitingapireadinessmodel', () => {
  const readyCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const readyRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  assert.strictEqual(capability.checkReadiness(readyCache, readyRelational), 'READY');
  assert.strictEqual(readyCache.ping(), true);
  assert.strictEqual(readyRelational.ping(), true);

  const degradedCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const degradedRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  assert.strictEqual(capability.checkReadiness(degradedCache, degradedRelational), 'DEGRADED');
  assert.strictEqual(degradedCache.ping(), false);

  const unavailableCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const unavailableRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  assert.strictEqual(capability.checkReadiness(unavailableCache, unavailableRelational), 'UNAVAILABLE');
  assert.strictEqual(capability.isProviderStateAmbiguous(unavailableCache, unavailableRelational), true);

  const relationalDownCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const relationalDownRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  assert.strictEqual(capability.checkReadiness(relationalDownCache, relationalDownRelational), 'DEGRADED');

  const errorModel = capability.validateErrorModel(relationalDownCache, relationalDownRelational);
  assert.strictEqual(errorModel.cacheUnavailableReportsDegraded, false);
  assert.strictEqual(errorModel.relationalFallbackValidForCounting, false);

  const fallbackState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant1',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 5,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      },
    ],
  };
  const fallbackCounters = new Map<string, capability.RateLimitCounter>();
  const cacheDown = capability.createMockCacheAdapter(fallbackCounters, false);
  const relationalUp = capability.createMockRelationalAdapter(fallbackCounters, true);
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };
  const fallback = capability.evaluateRateLimit(fallbackState, 'tenant1', 'policy1', token, cacheDown, relationalUp);
  assert.strictEqual(fallback.decision, 'DEGRADED');

  const fullReadyErrorModel = capability.validateErrorModel(readyCache, readyRelational);
  assert.strictEqual(fullReadyErrorModel.failClosedOnAmbiguousProvider, false);
});

test('ratelimitingapistatemodel', () => {
  const policy: capability.RateLimitPolicy = {
    tenantKey: 'tenant1',
    policyKey: 'policy1',
    entitlementKey: 'ent1',
    limit: 10,
    windowSeconds: 60,
    action: 'DENY',
    updatedAt: new Date().toISOString(),
    updatedBy: 'operator1',
  };

  const counterWithin: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: 1_700_000_000_000,
    usedCount: 5,
    limit: 10,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };

  const counterExceeded: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: 1_700_000_000_000,
    usedCount: 11,
    limit: 10,
    exceeded: true,
    bucketState: 'EXCEEDED',
  };

  const okWithin = capability.validateStateModel(policy, counterWithin);
  assert.strictEqual(okWithin.policyFieldsValid, true);
  assert.strictEqual(okWithin.counterFieldsValid, true);
  assert.strictEqual(okWithin.counterBucketedByWindow, true);
  assert.strictEqual(okWithin.counterResetsOnNewBucket, true);
  assert.strictEqual(okWithin.counterNotDecremented, true);

  const okExceeded = capability.validateStateModel(policy, counterExceeded);
  assert.strictEqual(okExceeded.policyFieldsValid, true);
  assert.strictEqual(okExceeded.counterFieldsValid, true);
  assert.strictEqual(okExceeded.counterBucketedByWindow, true);
  assert.strictEqual(okExceeded.counterResetsOnNewBucket, true);
  assert.strictEqual(okExceeded.counterNotDecremented, true);

  const windowA = capability.getCurrentWindowStart(60, 1_700_000_000_000);
  const windowB = capability.getNextWindowStart(60, 1_700_000_000_000);
  assert.notStrictEqual(windowA, windowB);
  assert.strictEqual(capability.calculateWindowExpiry(windowA, 60), windowB);

  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [policy],
  };

  const afterFirst = capability.createOrUpdateCounter(state, 'tenant1', 'policy1', windowA, 1, 10);
  const first = afterFirst.counters[0]!;
  assert.strictEqual(first.tenantId, 'tenant1');
  assert.strictEqual(first.policyKey, 'policy1');
  assert.strictEqual(first.windowStart, windowA);
  assert.strictEqual(first.usedCount, 1);
  assert.strictEqual(first.limit, 10);
  assert.strictEqual(first.exceeded, false);
  assert.strictEqual(first.bucketState, 'WITHIN_WINDOW');

  const afterSecond = capability.createOrUpdateCounter(afterFirst, 'tenant1', 'policy1', windowA, 2, 10);
  const second = afterSecond.counters[0]!;
  assert.strictEqual(second.windowStart, windowA);
  assert.strictEqual(second.usedCount, 2);
  assert.strictEqual(second.exceeded, false);

  const overCounter = capability.createOrUpdateCounter(afterSecond, 'tenant1', 'policy1', windowA, 11, 10);
  const over = overCounter.counters[0]!;
  assert.strictEqual(over.usedCount, 11);
  assert.strictEqual(over.exceeded, true);
  assert.strictEqual(over.bucketState, 'EXCEEDED');

  const newBucket = capability.createOrUpdateCounter(afterFirst, 'tenant1', 'policy1', windowB, 1, 10);
  assert.strictEqual(newBucket.counters.length, 2);
  const resetBucket = newBucket.counters.find((c) => c.windowStart === windowB)!;
  assert.strictEqual(resetBucket.usedCount, 1);
  assert.strictEqual(resetBucket.exceeded, false);
  const preservedBucket = newBucket.counters.find((c) => c.windowStart === windowA)!;
  assert.strictEqual(preservedBucket.usedCount, 2);

  const limitState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant1',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 1,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      },
    ],
  };
  const freshCounters = new Map<string, capability.RateLimitCounter>();
  const freshCache = capability.createMockCacheAdapter(freshCounters, true);
  const freshRelational = capability.createMockRelationalAdapter(freshCounters, true);
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  let liveState = capability.assertRateLimit(limitState, 'tenant1', 'policy1', token, freshCache, freshRelational);
  assert.strictEqual(liveState.counters[0]!.windowStart, windowA);
  assert.strictEqual(liveState.counters[0]!.usedCount, 1);
  assert.strictEqual(liveState.counters[0]!.exceeded, false);

  liveState = capability.assertRateLimit(liveState, 'tenant1', 'policy1', token, freshCache, freshRelational);
  assert.strictEqual(liveState.counters[0]!.windowStart, windowA);
  assert.strictEqual(liveState.counters[0]!.usedCount, 1);

  const overLimit = capability.evaluateRateLimit(liveState, 'tenant1', 'policy1', token, freshCache, freshRelational);
  assert.strictEqual(overLimit.decision, 'DENIED_LIMIT_EXCEEDED');
});

test('ratelimitingapivalidation', () => {
  const permissionFn = (_r: capability.RateLimitPermission, _op: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';

  const invalidTenantRead = capability.readPolicy(capability.initialState, 'invalid@tenant', policyKey, permissionFn, operatorId, true);
  assert.strictEqual(invalidTenantRead.ok, false);
  if (invalidTenantRead.ok === false) {
    assert.strictEqual(invalidTenantRead.error.kind, 'TENANT_INVALID');
  }

  const invalidPolicy: capability.RateLimitPolicy = {
    tenantKey: tenantId,
    policyKey,
    entitlementKey: '',
    limit: 0,
    windowSeconds: 0,
    action: 'DENY',
    updatedAt: new Date().toISOString(),
    updatedBy: operatorId,
  };
  const policyErr = capability.validatePolicy(invalidPolicy);
  assert.ok(policyErr !== null);
  if (policyErr !== null) {
    assert.strictEqual(policyErr.kind, 'INVALID_POLICY');
  }

  const noEntitlementPolicy: capability.RateLimitPolicy = {
    tenantKey: tenantId,
    policyKey,
    entitlementKey: '',
    limit: 10,
    windowSeconds: 60,
    action: 'DENY',
    updatedAt: new Date().toISOString(),
    updatedBy: operatorId,
  };
  const noEntitlementErr = capability.validatePolicy(noEntitlementPolicy);
  assert.ok(noEntitlementErr !== null);
  if (noEntitlementErr !== null) {
    assert.strictEqual(noEntitlementErr.kind, 'INVALID_POLICY');
  }

  const stateWithPolicy: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant1',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 1,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      },
    ],
  };
  const counters = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(counters, true);
  const relational = capability.createMockRelationalAdapter(counters, true);
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };

  const beforeCountersLength = stateWithPolicy.counters.length;
  const noEntitlementEval = capability.evaluateRateLimit(stateWithPolicy, 'tenant1', 'policy1', null, cache, relational);
  assert.strictEqual(noEntitlementEval.decision, 'DENIED_ENTITLEMENT_MISSING');
  assert.ok(noEntitlementEval.error !== null);
  if (noEntitlementEval.error !== null) {
    assert.strictEqual(noEntitlementEval.error.kind, 'ENTITLEMENT_DENIED');
  }
  assert.strictEqual(noEntitlementEval.counter, null);
  assert.strictEqual(stateWithPolicy.counters.length, beforeCountersLength);

  const deniedCounters = new Map<string, capability.RateLimitCounter>();
  const deniedCache = capability.createMockCacheAdapter(deniedCounters, true);
  const deniedRelational = capability.createMockRelationalAdapter(deniedCounters, true);
  const firstEval = capability.evaluateRateLimit(stateWithPolicy, 'tenant1', 'policy1', token, deniedCache, deniedRelational);
  assert.strictEqual(firstEval.decision, 'ALLOWED');
  const secondEval = capability.evaluateRateLimit(stateWithPolicy, 'tenant1', 'policy1', token, deniedCache, deniedRelational);
  assert.strictEqual(secondEval.decision, 'DENIED_LIMIT_EXCEEDED');

  const atLimitState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant2',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 2,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      },
    ],
  };
  const atLimitCounters = new Map<string, capability.RateLimitCounter>();
  const atLimitCache = capability.createMockCacheAdapter(atLimitCounters, true);
  const atLimitRelational = capability.createMockRelationalAdapter(atLimitCounters, true);
  const firstAtLimit = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atLimitCache, atLimitRelational);
  assert.strictEqual(firstAtLimit.decision, 'ALLOWED');
  const secondAtLimit = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atLimitCache, atLimitRelational);
  assert.strictEqual(secondAtLimit.decision, 'ALLOWED');
  const thirdAtLimit = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atLimitCache, atLimitRelational);
  assert.strictEqual(thirdAtLimit.decision, 'DENIED_LIMIT_EXCEEDED');

  const invalidTenantWrite = capability.setPolicy(
    stateWithPolicy,
    'invalid@tenant',
    policyKey,
    'ent1',
    10,
    60,
    'DENY',
    operatorId,
    () => null,
    permissionFn,
  );
  assert.strictEqual(invalidTenantWrite.ok, false);
  if (invalidTenantWrite.ok === false) {
    assert.strictEqual(invalidTenantWrite.error.kind, 'TENANT_INVALID');
  }

  assert.strictEqual(capability.validateTenantId(''), false);
  assert.strictEqual(capability.validateTenantId('invalid@tenant'), false);
  assert.strictEqual(capability.validateTenantId('valid_tenant-1'), true);
});