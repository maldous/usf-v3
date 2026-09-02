import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/developerplatform/ratelimitingapi.ts";

test("ratelimitingapiauditmodel", () => {
  const auditEvents: capability.RateLimitAuditEvent[] = [];
  const auditFn = (event: capability.RateLimitAuditEvent): capability.RateLimitError | null => {
    auditEvents.push(event);
    return null;
  };
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';
  const entitlementKey = 'ent1';
  const limit = 5;
  const windowSeconds = 60;
  const action: capability.RateLimitPolicyAction = 'DENY';
  const policy: capability.RateLimitPolicy = {
    tenantKey: tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    updatedAt: new Date().toISOString(),
    updatedBy: operatorId,
  };

  let observed: { readonly policyBefore: readonly capability.RateLimitPolicy[]; readonly auditCalledAt: number } = {
    policyBefore: [],
    auditCalledAt: -1,
  };
  const tracingAuditFn = (event: capability.RateLimitAuditEvent): capability.RateLimitError | null => {
    observed = {
      policyBefore: [],
      auditCalledAt: auditEvents.length,
    };
    auditEvents.push(event);
    return null;
  };

  const initial = capability.initialState;
  observed = { policyBefore: initial.policies, auditCalledAt: -1 };

  const result = capability.setPolicy(
    initial,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    operatorId,
    tracingAuditFn,
    permissionFn,
  );
  assert.strictEqual(result.ok, true);
  if (!result.ok) {
    assert.fail('expected setPolicy to succeed');
  }
  const newState: capability.RateLimitState = result.state;

  assert.strictEqual(observed.auditCalledAt, 0);
  assert.strictEqual(auditEvents.length, 1);
  const auditEvent = auditEvents[0]!;
  assert.strictEqual(auditEvent.kind, 'AUDIT_BEFORE_CHANGE');
  assert.strictEqual(auditEvent.tenantId, tenantId);
  assert.strictEqual(auditEvent.policyKey, policyKey);
  assert.deepStrictEqual(auditEvent.policy, policy);
  assert.strictEqual(typeof auditEvent.timestamp, 'string');
  assert.strictEqual(auditEvent.operatorId, operatorId);

  assert.strictEqual(newState.policies.length, 1);
  assert.deepStrictEqual(newState.policies[0], policy);

  const failingAudit = () => ({ kind: 'AUDIT_FAILURE' as const, message: 'audit blocked' });
  const blockedResult = capability.setPolicy(
    initial,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    operatorId,
    failingAudit,
    permissionFn,
  );
  assert.strictEqual(blockedResult.ok, false);
  if (!blockedResult.ok) {
    assert.strictEqual(blockedResult.error.kind, 'AUDIT_FAILURE');
    assert.strictEqual(initial.policies.length, 0);
  }

  const counters = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(counters, true);
  const relational = capability.createMockRelationalAdapter(counters, true);
  const token: { readonly entitlement: string } = { entitlement: entitlementKey };
  const evalResult = capability.evaluateRateLimit(newState, tenantId, policyKey, token, cache, relational);
  assert.strictEqual(evalResult.decision, 'ALLOWED');
  assert.strictEqual(evalResult.error, null);
  assert.strictEqual(evalResult.counter?.usedCount, 1);
});

test("ratelimitingapicontracts", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';
  const entitlementKey = 'ent1';
  const limit = 10;
  const windowSeconds = 60;
  const action: capability.RateLimitPolicyAction = 'DENY';

  const setResult = capability.setPolicy(
    capability.initialState,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    operatorId,
    () => null,
    permissionFn,
  );
  assert.strictEqual(setResult.ok, true);
  const stateAfter: capability.RateLimitState = setResult.state;

  const developerRead = capability.readPolicy(stateAfter, tenantId, policyKey, permissionFn, 'developer1', false);
  assert.strictEqual(developerRead.ok, true);
  if (developerRead.ok) {
    assert.strictEqual(developerRead.policy.policyKey, policyKey);
  }

  const operatorRead = capability.readPolicy(stateAfter, tenantId, policyKey, permissionFn, operatorId, true);
  assert.strictEqual(operatorRead.ok, true);
  if (operatorRead.ok) {
    assert.strictEqual(operatorRead.policy.policyKey, policyKey);
  }

  const opUpdate = capability.updatePolicy(
    stateAfter,
    tenantId,
    policyKey,
    {
      tenantKey: tenantId,
      policyKey,
      entitlementKey,
      limit: 20,
      windowSeconds,
      action,
      updatedAt: new Date().toISOString(),
      updatedBy: operatorId,
    },
    () => null,
    permissionFn,
    operatorId,
  );
  assert.strictEqual(opUpdate.ok, true);
  if (opUpdate.ok) {
    const updated = opUpdate.state.policies.find((p) => p.policyKey === policyKey && p.tenantKey === tenantId);
    assert.ok(updated !== undefined);
    assert.strictEqual(updated?.limit, 20);
  }

  const summary = capability.getRateLimitSummary(stateAfter, tenantId, permissionFn, 'developer1', false);
  assert.strictEqual(summary.ok, true);
  if (summary.ok) {
    assert.strictEqual(summary.policies.length, 1);
    assert.strictEqual(summary.counters.length, 0);
  }

  const cacheCounters = new Map<string, capability.RateLimitCounter>();
  const relationalCounters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(cacheCounters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(relationalCounters, true);
  assert.strictEqual(typeof cacheAdapter.ping(), 'boolean');
  assert.strictEqual(typeof relationalAdapter.ping(), 'boolean');
  assert.strictEqual(typeof cacheAdapter.getCounter, 'function');
  assert.strictEqual(typeof cacheAdapter.setCounter, 'function');
  assert.strictEqual(typeof relationalAdapter.getCounter, 'function');
  assert.strictEqual(typeof relationalAdapter.setCounter, 'function');
});

test("ratelimitingapierrormodel", () => {
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

  const errorModel = capability.validateErrorModel(ambiguousCache, ambiguousRelational);
  assert.strictEqual(errorModel.assertThrowsOnExceeded, true);
  assert.strictEqual(errorModel.evaluateDistinguishesEntitlementFromExceeded, true);
  assert.strictEqual(errorModel.cacheUnavailableReportsDegraded, false);
  assert.strictEqual(errorModel.relationalFallbackValidForCounting, false);
  assert.strictEqual(errorModel.failClosedOnAmbiguousProvider, true);
});

test("ratelimitingapilifecycle", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = 'operator1';
  const tenantId = 'tenant1';
  const policyKey = 'policy1';
  const entitlementKey = 'ent1';
  const limit = 2;
  const windowSeconds = 60;
  const action: capability.RateLimitPolicyAction = 'DENY';

  const setResult = capability.setPolicy(
    capability.initialState,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    operatorId,
    () => null,
    permissionFn,
  );
  assert.strictEqual(setResult.ok, true);
  const policyState: capability.RateLimitState = setResult.state;
  assert.strictEqual(policyState.policies.length, 1);

  const token: { readonly entitlement: string } = { entitlement: entitlementKey };

  const counters = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(counters, true);
  const relational = capability.createMockRelationalAdapter(counters, true);
  const noPolicyResult = capability.evaluateRateLimit(
    capability.initialState,
    tenantId,
    policyKey,
    token,
    cache,
    relational,
  );
  assert.strictEqual(noPolicyResult.decision, 'ALLOWED');

  const entitlementMissingResult = capability.evaluateRateLimit(
    policyState,
    tenantId,
    policyKey,
    null,
    cache,
    relational,
  );
  assert.strictEqual(entitlementMissingResult.decision, 'DENIED_ENTITLEMENT_MISSING');

  const nowMs = 1_700_000_000_000;
  const eval1 = capability.evaluateRateLimit(policyState, tenantId, policyKey, token, cache, relational, nowMs);
  assert.strictEqual(eval1.decision, 'ALLOWED');
  assert.strictEqual(eval1.counter?.usedCount, 1);
  const eval2 = capability.evaluateRateLimit(policyState, tenantId, policyKey, token, cache, relational, nowMs);
  assert.strictEqual(eval2.decision, 'ALLOWED');
  assert.strictEqual(eval2.counter?.usedCount, 2);
  const eval3 = capability.evaluateRateLimit(policyState, tenantId, policyKey, token, cache, relational, nowMs);
  assert.strictEqual(eval3.decision, 'DENIED_LIMIT_EXCEEDED');
  assert.strictEqual(eval3.counter?.usedCount, 3);
  assert.strictEqual(eval3.counter?.exceeded, true);

  const nextWindowStart = capability.getNextWindowStart(windowSeconds, nowMs);
  const afterBucket = capability.resetCounterInNewBucket(policyState, tenantId, policyKey, nextWindowStart, limit);
  assert.strictEqual(afterBucket.counters.length, 1);
  const resetCounter = afterBucket.counters[0]!;
  assert.strictEqual(resetCounter.windowStart, nextWindowStart);
  assert.strictEqual(resetCounter.usedCount, 0);
  assert.strictEqual(resetCounter.exceeded, false);
});

test("ratelimitingapipermissions", () => {
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

  const opReadPermission = (required: capability.RateLimitPermission, _op: string): boolean => required === 'PLATFORM_RATE_LIMIT_READ';
  const opWritePermission = (required: capability.RateLimitPermission, _op: string): boolean => required === 'PLATFORM_RATE_LIMIT_WRITE';
  const tenantReadPermission = (required: capability.RateLimitPermission, _op: string): boolean => required === 'TENANT_DEVELOPER_READ';
  const denyAll = (_required: capability.RateLimitPermission, _operatorId: string): boolean => false;

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

test("ratelimitingapiproof", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;

  const cacheProof = capability.runCacheCountingProof(
    capability.initialState,
    'tenant1',
    'policy1',
    'ent1',
    2,
    60,
    'operator1',
    () => null,
    permissionFn,
  );
  assert.strictEqual(cacheProof.outcome, 'PROVED');
  const cacheTerminal = Array.from(cacheProof.counters.values()).pop()!;
  assert.strictEqual(cacheTerminal.usedCount, 3);
  assert.strictEqual(cacheTerminal.exceeded, true);

  const relationalProof = capability.runRelationalCountingProof(
    capability.initialState,
    'tenant1',
    'policy1',
    'ent1',
    2,
    60,
    'operator1',
    () => null,
    permissionFn,
    true,
  );
  assert.strictEqual(relationalProof.outcome, 'PROVED');
  const relationalTerminal = Array.from(relationalProof.counters.values()).pop()!;
  assert.strictEqual(relationalTerminal.usedCount, 3);
  assert.strictEqual(relationalTerminal.exceeded, true);

  const skippedProof = capability.runRelationalCountingProof(
    capability.initialState,
    'tenant1',
    'policy1',
    'ent1',
    2,
    60,
    'operator1',
    () => null,
    permissionFn,
    false,
  );
  assert.strictEqual(skippedProof.outcome, 'SKIPPED_DB_UNAVAILABLE');

  const operatorRoute = capability.evaluateOperatorRoute(
    cacheProof.state,
    'tenant2',
    'policy1',
    'ent1',
    3,
    60,
    'DENY',
    'operator1',
    () => null,
    permissionFn,
  );
  assert.strictEqual(operatorRoute.ok, true);
  if (operatorRoute.ok === true) {
    assert.strictEqual(operatorRoute.state.policies.length, 2);
  }

  const degradeState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant3',
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
  const degradeCounters = new Map<string, capability.RateLimitCounter>();
  const degraded = capability.evaluateRateLimit(
    degradeState,
    'tenant3',
    'policy1',
    { entitlement: 'ent1' },
    capability.createMockCacheAdapter(degradeCounters, false),
    capability.createMockRelationalAdapter(degradeCounters, true),
  );
  assert.strictEqual(degraded.decision, 'DEGRADED');
  assert.ok(degraded.counter !== null);
  if (degraded.counter !== null) {
    assert.strictEqual(degraded.counter.usedCount, 1);
  }

  const hermeticProof = capability.runHermeticProof(
    capability.initialState,
    'tenant4',
    'policy1',
    'ent1',
    2,
    60,
    capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true),
    capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true),
    'operator1',
    () => null,
    permissionFn,
  );
  assert.strictEqual(hermeticProof.outcome, 'PROVED');
  assert.strictEqual(hermeticProof.cacheProofRan, true);
  assert.strictEqual(hermeticProof.relationalProofRan, true);
  assert.strictEqual(hermeticProof.relationalProofSkippedWhenDbUnavailable, false);
  assert.strictEqual(hermeticProof.cacheReadyOnPing, true);
  assert.strictEqual(hermeticProof.cacheDegradedOnPingFailure, false);
  assert.strictEqual(hermeticProof.freshProofPending, true);
  assert.strictEqual(hermeticProof.hermeticRuntimeLineage, true);
});

test("ratelimitingapireadinessmodel", () => {
  const readyCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const readyRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  assert.strictEqual(capability.checkReadiness(readyCache, readyRelational), 'READY');

  const degradedCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const degradedRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  assert.strictEqual(capability.checkReadiness(degradedCache, degradedRelational), 'DEGRADED');

  const unavailableCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const unavailableRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  assert.strictEqual(capability.checkReadiness(unavailableCache, unavailableRelational), 'UNAVAILABLE');
  assert.strictEqual(capability.isProviderStateAmbiguous(unavailableCache, unavailableRelational), true);

  const relationalDownCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const relationalDownRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  assert.strictEqual(capability.checkReadiness(relationalDownCache, relationalDownRelational), 'DEGRADED');

  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const skipProof = capability.runRelationalCountingProof(
    capability.initialState,
    'tenant1',
    'policy1',
    'ent1',
    2,
    60,
    'operator1',
    () => null,
    permissionFn,
    false,
  );
  assert.strictEqual(skipProof.outcome, 'SKIPPED_DB_UNAVAILABLE');

  const fallbackState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: 'tenant1',
        policyKey: 'policy1',
        entitlementKey: 'ent1',
        limit: 3,
        windowSeconds: 60,
        action: 'DENY',
        updatedAt: new Date().toISOString(),
        updatedBy: 'operator1',
      },
    ],
  };
  const fallbackCounters = new Map<string, capability.RateLimitCounter>();
  const fallback = capability.evaluateRateLimit(
    fallbackState,
    'tenant1',
    'policy1',
    { entitlement: 'ent1' },
    capability.createMockCacheAdapter(fallbackCounters, false),
    capability.createMockRelationalAdapter(fallbackCounters, true),
  );
  assert.strictEqual(fallback.decision, 'DEGRADED');
  assert.strictEqual(fallbackCounters.size, 1);
});

test("ratelimitingapistatemodel", () => {
  const policy: capability.RateLimitPolicy = {
    tenantKey: 'tenant1',
    policyKey: 'policy1',
    entitlementKey: 'ent1',
    limit: 10,
    windowSeconds: 60,
    action: 'DENY',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'operator1',
  };

  const windowA = capability.getCurrentWindowStart(60, 1_700_000_000_000);
  const windowB = capability.getNextWindowStart(60, 1_700_000_000_000);

  const counterWithin: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: windowA,
    usedCount: 5,
    limit: 10,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };

  const validation = capability.validateStateModel(policy, counterWithin, null);
  assert.strictEqual(validation.policyFieldsValid, true);
  assert.strictEqual(validation.counterFieldsValid, true);
  assert.strictEqual(validation.counterBucketedByWindow, true);
  assert.strictEqual(validation.counterResetsOnNewBucket, true);
  assert.strictEqual(validation.counterNotDecremented, true);
  assert.strictEqual(validation.exceededDerivableFromUsedCount, true);
  assert.strictEqual(validation.bucketStateMatchesExceeded, true);
  assert.strictEqual(validation.limitNotExceededAtOrBelow, true);
  assert.strictEqual(validation.limitExceededAbove, false);

  const counterExceeded: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: windowA,
    usedCount: 11,
    limit: 10,
    exceeded: true,
    bucketState: 'EXCEEDED',
  };
  const validationExceeded = capability.validateStateModel(policy, counterExceeded, null);
  assert.strictEqual(validationExceeded.counterFieldsValid, true);
  assert.strictEqual(validationExceeded.exceededDerivableFromUsedCount, true);
  assert.strictEqual(validationExceeded.bucketStateMatchesExceeded, true);
  assert.strictEqual(validationExceeded.limitExceededAbove, true);

  const previous: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: windowA,
    usedCount: 3,
    limit: 10,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const nextBucketCounter: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: windowB,
    usedCount: 0,
    limit: 10,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const resetResult = capability.validateStateModel(policy, nextBucketCounter, previous);
  assert.strictEqual(resetResult.counterResetsOnNewBucket, true);
  assert.strictEqual(resetResult.counterNotDecremented, true);

  const afterOverflow: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: windowA,
    usedCount: 11,
    limit: 10,
    exceeded: true,
    bucketState: 'EXCEEDED',
  };
  const recovery: capability.RateLimitCounter = {
    tenantId: 'tenant1',
    policyKey: 'policy1',
    windowStart: windowB,
    usedCount: 1,
    limit: 10,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const recoveryResult = capability.validateStateModel(policy, recovery, afterOverflow);
  assert.strictEqual(recoveryResult.counterResetsOnNewBucket, true);
  assert.strictEqual(recoveryResult.counterNotDecremented, true);

  const newBucket = capability.createOrUpdateCounter(capability.initialState, 'tenant1', 'policy1', windowB, 0, 10);
  assert.strictEqual(newBucket.counters.length, 1);
  assert.strictEqual(newBucket.counters[0]!.windowStart, windowB);
  assert.strictEqual(newBucket.counters[0]!.usedCount, 0);

  const resetViaFunction = capability.resetCounterInNewBucket(capability.initialState, 'tenant1', 'policy1', windowB, 10);
  assert.strictEqual(resetViaFunction.counters[0]!.usedCount, 0);
  assert.strictEqual(resetViaFunction.counters[0]!.windowStart, windowB);
});

test("ratelimitingapivalidation", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
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
  const policyError = capability.validatePolicy(invalidPolicy);
  assert.ok(policyError !== null);
  if (policyError !== null) {
    assert.strictEqual(policyError.kind, 'INVALID_POLICY');
  }

  const noPolicyEval = capability.evaluateRateLimit(
    capability.initialState,
    'tenant1',
    'policy1',
    { entitlement: 'ent1' },
    capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true),
    capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true),
  );
  assert.strictEqual(noPolicyEval.decision, 'ALLOWED');

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
  const countersBefore = stateWithPolicy.counters.length;
  const cache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const relational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const token: { readonly entitlement: string } = { entitlement: 'ent1' };
  const missingEntitlementResult = capability.evaluateRateLimit(stateWithPolicy, 'tenant1', 'policy1', null, cache, relational);
  assert.strictEqual(missingEntitlementResult.decision, 'DENIED_ENTITLEMENT_MISSING');
  assert.strictEqual(stateWithPolicy.counters.length, countersBefore);

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
  const atCounters = new Map<string, capability.RateLimitCounter>();
  const atCache = capability.createMockCacheAdapter(atCounters, true);
  const atRelational = capability.createMockRelationalAdapter(atCounters, true);
  const firstAt = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atCache, atRelational);
  assert.strictEqual(firstAt.decision, 'ALLOWED');
  const secondAt = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atCache, atRelational);
  assert.strictEqual(secondAt.decision, 'ALLOWED');
  const thirdAt = capability.evaluateRateLimit(atLimitState, 'tenant2', 'policy1', token, atCache, atRelational);
  assert.strictEqual(thirdAt.decision, 'DENIED_LIMIT_EXCEEDED');

  assert.strictEqual(capability.validateTenantId(''), false);
  assert.strictEqual(capability.validateTenantId('invalid@tenant'), false);
  assert.strictEqual(capability.validateTenantId('valid_tenant-1'), true);
});