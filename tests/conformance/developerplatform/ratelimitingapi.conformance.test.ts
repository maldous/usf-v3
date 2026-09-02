import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/developerplatform/ratelimitingapi.ts";

test("ratelimitingapiauditmodel", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = "operator1";
  const tenantId = "tenant1";
  const policyKey = "policy1";
  const entitlementKey = "ent1";
  const limit = 5;
  const windowSeconds = 60;
  const action: capability.RateLimitPolicyAction = "DENY";

  const auditEvents: capability.RateLimitAuditEvent[] = [];
  const captureAuditFn = (event: capability.RateLimitAuditEvent): capability.RateLimitError | null => {
    auditEvents.push(event);
    return null;
  };

  const result = capability.setPolicy(
    capability.initialState,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    operatorId,
    captureAuditFn,
    permissionFn,
  );
  assert.strictEqual(result.ok, true);
  if (!result.ok) {
    assert.fail("expected setPolicy to succeed");
  }
  const newState: capability.RateLimitState = result.state;

  assert.strictEqual(auditEvents.length, 1);
  const auditEvent = auditEvents[0]!;
  assert.strictEqual(auditEvent.kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditEvent.tenantId, tenantId);
  assert.strictEqual(auditEvent.policyKey, policyKey);
  assert.strictEqual(auditEvent.resource, "rate-limit");
  assert.strictEqual(auditEvent.operatorId, operatorId);
  assert.strictEqual(auditEvent.auditSequence, 0);
  assert.strictEqual(auditEvent.policiesBefore, 0);
  assert.strictEqual(auditEvent.countersBefore, 0);
  assert.ok(auditEvent.timestamp.length > 0);
  const recordedPolicy = auditEvent.policy as { readonly limit: number };
  assert.strictEqual(recordedPolicy.limit, limit);

  assert.strictEqual(newState.policies.length, 1);
  assert.strictEqual(newState.auditLog.length, 1);
  assert.strictEqual(newState.auditLog[0], auditEvent);

  const failingAudit = (): capability.RateLimitError => ({ kind: "AUDIT_FAILURE", message: "audit blocked" });
  const blockedResult = capability.setPolicy(
    capability.initialState,
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
    assert.strictEqual(blockedResult.error.kind, "AUDIT_FAILURE");
  }
  assert.strictEqual(capability.initialState.policies.length, 0);
  assert.strictEqual(capability.initialState.auditLog.length, 0);

  const counters = new Map<string, capability.RateLimitCounter>();
  const cache = capability.createMockCacheAdapter(counters, true);
  const relational = capability.createMockRelationalAdapter(counters, true);
  const token: { readonly entitlement: string } = { entitlement: entitlementKey };
  const evalResult = capability.evaluateRateLimit(newState, tenantId, policyKey, token, cache, relational);
  assert.strictEqual(evalResult.decision, "ALLOWED");
  assert.strictEqual(evalResult.error, null);
  assert.ok(evalResult.counter !== null);
  if (evalResult.counter !== null) {
    assert.strictEqual(evalResult.counter.usedCount, 1);
  }
});

test("ratelimitingapicontracts", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = "operator1";
  const tenantId = "tenant1";
  const policyKey = "policy1";
  const entitlementKey = "ent1";
  const limit = 10;
  const windowSeconds = 60;
  const action: capability.RateLimitPolicyAction = "DENY";

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
  if (!setResult.ok) {
    assert.fail("expected setPolicy to succeed");
  }
  const stateAfter: capability.RateLimitState = setResult.state;

  const developerRead = capability.readPolicy(stateAfter, tenantId, policyKey, permissionFn, "developer1", false);
  assert.strictEqual(developerRead.ok, true);
  if (developerRead.ok) {
    assert.strictEqual(developerRead.policy.policyKey, policyKey);
    assert.strictEqual(developerRead.policy.tenantKey, tenantId);
  }

  const operatorRead = capability.readPolicy(stateAfter, tenantId, policyKey, permissionFn, operatorId, true);
  assert.strictEqual(operatorRead.ok, true);
  if (operatorRead.ok) {
    assert.strictEqual(operatorRead.policy.policyKey, policyKey);
    assert.strictEqual(operatorRead.policy.limit, limit);
  }

  const updatedPolicy: capability.RateLimitPolicy = {
    tenantKey: tenantId,
    policyKey,
    entitlementKey,
    limit: 20,
    windowSeconds,
    action,
    updatedAt: "2024-01-01T00:00:00.000Z",
    updatedBy: operatorId,
  };
  const opUpdate = capability.updatePolicy(
    stateAfter,
    tenantId,
    policyKey,
    updatedPolicy,
    () => null,
    permissionFn,
    operatorId,
  );
  assert.strictEqual(opUpdate.ok, true);
  if (opUpdate.ok) {
    const updated = opUpdate.state.policies.find((p) => p.policyKey === policyKey && p.tenantKey === tenantId);
    assert.ok(updated !== undefined);
    if (updated !== undefined) {
      assert.strictEqual(updated.limit, 20);
    }
  }

  const summary = capability.getRateLimitSummary(stateAfter, tenantId, permissionFn, "developer1", false);
  assert.strictEqual(summary.ok, true);
  if (summary.ok) {
    assert.strictEqual(summary.policies.length, 1);
    assert.strictEqual(summary.counters.length, 0);
  }

  const cacheCounters = new Map<string, capability.RateLimitCounter>();
  const relationalCounters = new Map<string, capability.RateLimitCounter>();
  const cacheAdapter = capability.createMockCacheAdapter(cacheCounters, true);
  const relationalAdapter = capability.createMockRelationalAdapter(relationalCounters, true);
  assert.strictEqual(typeof cacheAdapter.ping(), "boolean");
  assert.strictEqual(typeof relationalAdapter.ping(), "boolean");
  assert.strictEqual(typeof cacheAdapter.getCounter, "function");
  assert.strictEqual(typeof cacheAdapter.setCounter, "function");
  assert.strictEqual(typeof relationalAdapter.getCounter, "function");
  assert.strictEqual(typeof relationalAdapter.setCounter, "function");
});

test("ratelimitingapierrormodel", () => {
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: "tenant1",
        policyKey: "policy1",
        entitlementKey: "ent1",
        limit: 1,
        windowSeconds: 60,
        action: "DENY",
        updatedAt: "2024-01-01T00:00:00.000Z",
        updatedBy: "operator1",
      },
    ],
  };
  const token: { readonly entitlement: string } = { entitlement: "ent1" };

  const noEntitlementCounters = new Map<string, capability.RateLimitCounter>();
  const noEntitlementCache = capability.createMockCacheAdapter(noEntitlementCounters, true);
  const noEntitlementRelational = capability.createMockRelationalAdapter(noEntitlementCounters, true);
  const noEntitlement = capability.evaluateRateLimit(state, "tenant1", "policy1", null, noEntitlementCache, noEntitlementRelational);
  assert.strictEqual(noEntitlement.decision, "DENIED_ENTITLEMENT_MISSING");
  assert.ok(noEntitlement.error !== null);
  if (noEntitlement.error !== null) {
    assert.strictEqual(noEntitlement.error.kind, "ENTITLEMENT_DENIED");
  }

  const allowedCounters = new Map<string, capability.RateLimitCounter>();
  const allowedCache = capability.createMockCacheAdapter(allowedCounters, true);
  const allowedRelational = capability.createMockRelationalAdapter(allowedCounters, true);
  const first = capability.evaluateRateLimit(state, "tenant1", "policy1", token, allowedCache, allowedRelational);
  assert.strictEqual(first.decision, "ALLOWED");
  const second = capability.evaluateRateLimit(state, "tenant1", "policy1", token, allowedCache, allowedRelational);
  assert.strictEqual(second.decision, "DENIED_LIMIT_EXCEEDED");
  assert.ok(second.error !== null);
  if (second.error !== null) {
    assert.strictEqual(second.error.kind, "LIMIT_EXCEEDED");
  }

  const assertCounters = new Map<string, capability.RateLimitCounter>();
  const assertCache = capability.createMockCacheAdapter(assertCounters, true);
  const assertRelational = capability.createMockRelationalAdapter(assertCounters, true);
  capability.assertRateLimit(state, "tenant1", "policy1", token, assertCache, assertRelational);
  assert.throws(() => {
    capability.assertRateLimit(state, "tenant1", "policy1", token, assertCache, assertRelational);
  });

  const degradedCounters = new Map<string, capability.RateLimitCounter>();
  const degradedCache = capability.createMockCacheAdapter(degradedCounters, false);
  const degradedRelational = capability.createMockRelationalAdapter(degradedCounters, true);
  const degraded = capability.evaluateRateLimit(state, "tenant1", "policy1", token, degradedCache, degradedRelational);
  assert.strictEqual(degraded.decision, "DEGRADED");
  assert.ok(degraded.error !== null);
  if (degraded.error !== null) {
    assert.strictEqual(degraded.error.kind, "CACHE_UNAVAILABLE");
  }
  assert.ok(degraded.counter !== null);
  if (degraded.counter !== null) {
    assert.strictEqual(degraded.counter.usedCount, 1);
  }

  const ambiguousCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const ambiguousRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const ambiguous = capability.evaluateWithDegradedFallback(state, "tenant1", "policy1", token, ambiguousCache, ambiguousRelational);
  assert.strictEqual(ambiguous.decision, "DENIED_LIMIT_EXCEEDED");
  assert.ok(ambiguous.error !== null);
  if (ambiguous.error !== null) {
    assert.strictEqual(ambiguous.error.kind, "AMBIGUOUS_PROVIDER");
  }

  const errorModel = capability.validateErrorModel(ambiguousCache, ambiguousRelational);
  assert.strictEqual(errorModel.assertThrowsOnExceeded, true);
  assert.strictEqual(errorModel.evaluateDistinguishesEntitlementFromExceeded, true);
  assert.strictEqual(errorModel.failClosedOnAmbiguousProvider, true);

  const degradedModelCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const degradedModelRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const degradedModel = capability.validateErrorModel(degradedModelCache, degradedModelRelational);
  assert.strictEqual(degradedModel.cacheUnavailableReportsDegraded, true);
  assert.strictEqual(degradedModel.relationalFallbackValidForCounting, true);
});

test("ratelimitingapilifecycle", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = "operator1";
  const tenantId = "tenant1";
  const policyKey = "policy1";
  const entitlementKey = "ent1";
  const limit = 2;
  const windowSeconds = 60;
  const action: capability.RateLimitPolicyAction = "DENY";

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
  if (!setResult.ok) {
    assert.fail("expected setPolicy to succeed");
  }
  const policyState: capability.RateLimitState = setResult.state;
  assert.strictEqual(policyState.policies.length, 1);

  const token: { readonly entitlement: string } = { entitlement: entitlementKey };

  const noPolicyCounters = new Map<string, capability.RateLimitCounter>();
  const noPolicyCache = capability.createMockCacheAdapter(noPolicyCounters, true);
  const noPolicyRelational = capability.createMockRelationalAdapter(noPolicyCounters, true);
  const noPolicyResult = capability.evaluateRateLimit(
    capability.initialState,
    tenantId,
    policyKey,
    token,
    noPolicyCache,
    noPolicyRelational,
  );
  assert.strictEqual(noPolicyResult.decision, "ALLOWED");

  const missingEntCounters = new Map<string, capability.RateLimitCounter>();
  const missingEntCache = capability.createMockCacheAdapter(missingEntCounters, true);
  const missingEntRelational = capability.createMockRelationalAdapter(missingEntCounters, true);
  const entitlementMissingResult = capability.evaluateRateLimit(
    policyState,
    tenantId,
    policyKey,
    null,
    missingEntCache,
    missingEntRelational,
  );
  assert.strictEqual(entitlementMissingResult.decision, "DENIED_ENTITLEMENT_MISSING");
  assert.strictEqual(missingEntCounters.size, 0);

  const nowMs = 1_700_000_000_000;
  const evalCounters = new Map<string, capability.RateLimitCounter>();
  const evalCache = capability.createMockCacheAdapter(evalCounters, true);
  const evalRelational = capability.createMockRelationalAdapter(evalCounters, true);
  const eval1 = capability.evaluateRateLimit(policyState, tenantId, policyKey, token, evalCache, evalRelational, nowMs);
  assert.strictEqual(eval1.decision, "ALLOWED");
  assert.ok(eval1.counter !== null);
  if (eval1.counter !== null) {
    assert.strictEqual(eval1.counter.usedCount, 1);
    assert.strictEqual(eval1.counter.exceeded, false);
  }
  const eval2 = capability.evaluateRateLimit(policyState, tenantId, policyKey, token, evalCache, evalRelational, nowMs);
  assert.strictEqual(eval2.decision, "ALLOWED");
  assert.ok(eval2.counter !== null);
  if (eval2.counter !== null) {
    assert.strictEqual(eval2.counter.usedCount, 2);
    assert.strictEqual(eval2.counter.exceeded, false);
  }
  const eval3 = capability.evaluateRateLimit(policyState, tenantId, policyKey, token, evalCache, evalRelational, nowMs);
  assert.strictEqual(eval3.decision, "DENIED_LIMIT_EXCEEDED");
  assert.ok(eval3.counter !== null);
  if (eval3.counter !== null) {
    assert.strictEqual(eval3.counter.usedCount, 3);
    assert.strictEqual(eval3.counter.exceeded, true);
  }

  const nextWindowStart = capability.getNextWindowStart(windowSeconds, nowMs);
  const afterBucket = capability.resetCounterInNewBucket(policyState, tenantId, policyKey, nextWindowStart, limit);
  assert.strictEqual(afterBucket.counters.length, 1);
  const resetCounter = afterBucket.counters[0]!;
  assert.strictEqual(resetCounter.windowStart, nextWindowStart);
  assert.strictEqual(resetCounter.usedCount, 0);
  assert.strictEqual(resetCounter.exceeded, false);
  assert.strictEqual(resetCounter.bucketState, "WITHIN_WINDOW");
});

test("ratelimitingapipermissions", () => {
  const state: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: "tenant1",
        policyKey: "policy1",
        entitlementKey: "ent1",
        limit: 10,
        windowSeconds: 60,
        action: "DENY",
        updatedAt: "2024-01-01T00:00:00.000Z",
        updatedBy: "operator1",
      },
    ],
  };
  const operatorId = "operator1";
  const tenantId = "tenant1";
  const policyKey = "policy1";

  const opReadPermission = (required: capability.RateLimitPermission, _op: string): boolean => required === "PLATFORM_RATE_LIMIT_READ";
  const opWritePermission = (required: capability.RateLimitPermission, _op: string): boolean => required === "PLATFORM_RATE_LIMIT_WRITE";
  const tenantReadPermission = (required: capability.RateLimitPermission, _op: string): boolean => required === "TENANT_DEVELOPER_READ";
  const denyAll = (_required: capability.RateLimitPermission, _operatorId: string): boolean => false;

  const operatorReadOk = capability.readPolicy(state, tenantId, policyKey, opReadPermission, operatorId, true);
  assert.strictEqual(operatorReadOk.ok, true);

  const tenantReadOk = capability.readPolicy(state, tenantId, policyKey, tenantReadPermission, "dev1", false);
  assert.strictEqual(tenantReadOk.ok, true);

  const tenantDeniedForOperatorPerm = capability.readPolicy(state, tenantId, policyKey, opReadPermission, "dev1", false);
  assert.strictEqual(tenantDeniedForOperatorPerm.ok, false);
  if (!tenantDeniedForOperatorPerm.ok) {
    assert.strictEqual(tenantDeniedForOperatorPerm.error.kind, "PERMISSION_DENIED");
  }

  const operatorDeniedForTenantPerm = capability.readPolicy(state, tenantId, policyKey, tenantReadPermission, operatorId, true);
  assert.strictEqual(operatorDeniedForTenantPerm.ok, false);
  if (!operatorDeniedForTenantPerm.ok) {
    assert.strictEqual(operatorDeniedForTenantPerm.error.kind, "PERMISSION_DENIED");
  }

  const writeOk = capability.setPolicy(
    state,
    tenantId,
    policyKey,
    "ent1",
    10,
    60,
    "DENY",
    operatorId,
    () => null,
    opWritePermission,
  );
  assert.strictEqual(writeOk.ok, true);

  const writeDenied = capability.setPolicy(
    state,
    tenantId,
    policyKey,
    "ent1",
    10,
    60,
    "DENY",
    operatorId,
    () => null,
    denyAll,
  );
  assert.strictEqual(writeDenied.ok, false);
  if (!writeDenied.ok) {
    assert.strictEqual(writeDenied.error.kind, "PERMISSION_DENIED");
  }

  const invalidTenantRead = capability.readPolicy(state, "invalid@tenant", policyKey, opReadPermission, operatorId, true);
  assert.strictEqual(invalidTenantRead.ok, false);
  if (!invalidTenantRead.ok) {
    assert.strictEqual(invalidTenantRead.error.kind, "TENANT_INVALID");
  }

  const invalidTenantWrite = capability.setPolicy(
    state,
    "invalid@tenant",
    policyKey,
    "ent1",
    10,
    60,
    "DENY",
    operatorId,
    () => null,
    opWritePermission,
  );
  assert.strictEqual(invalidTenantWrite.ok, false);
  if (!invalidTenantWrite.ok) {
    assert.strictEqual(invalidTenantWrite.error.kind, "TENANT_INVALID");
  }

  const evalCounters = new Map<string, capability.RateLimitCounter>();
  const evalCache = capability.createMockCacheAdapter(evalCounters, true);
  const evalRelational = capability.createMockRelationalAdapter(evalCounters, true);
  const wrongEntitlement: { readonly entitlement: string } = { entitlement: "wrong" };
  const wrongEntitlementResult = capability.evaluateRateLimit(state, tenantId, policyKey, wrongEntitlement, evalCache, evalRelational);
  assert.strictEqual(wrongEntitlementResult.decision, "DENIED_ENTITLEMENT_MISSING");
});

test("ratelimitingapiproof", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;

  const cacheProof = capability.runCacheCountingProof(
    capability.initialState,
    "tenant1",
    "policy1",
    "ent1",
    2,
    60,
    "operator1",
    () => null,
    permissionFn,
  );
  assert.strictEqual(cacheProof.outcome, "PROVED");
  assert.strictEqual(cacheProof.counters.size, 1);
  const cacheTerminal = Array.from(cacheProof.counters.values())[0]!;
  assert.strictEqual(cacheTerminal.usedCount, 3);
  assert.strictEqual(cacheTerminal.exceeded, true);

  const relationalProof = capability.runRelationalCountingProof(
    capability.initialState,
    "tenant1",
    "policy1",
    "ent1",
    2,
    60,
    "operator1",
    () => null,
    permissionFn,
    true,
  );
  assert.strictEqual(relationalProof.outcome, "PROVED");
  assert.strictEqual(relationalProof.counters.size, 1);
  const relationalTerminal = Array.from(relationalProof.counters.values())[0]!;
  assert.strictEqual(relationalTerminal.usedCount, 3);
  assert.strictEqual(relationalTerminal.exceeded, true);

  const skippedProof = capability.runRelationalCountingProof(
    capability.initialState,
    "tenant1",
    "policy1",
    "ent1",
    2,
    60,
    "operator1",
    () => null,
    permissionFn,
    false,
  );
  assert.strictEqual(skippedProof.outcome, "SKIPPED_DB_UNAVAILABLE");

  const operatorRoute = capability.evaluateOperatorRoute(
    cacheProof.state,
    "tenant2",
    "policy1",
    "ent1",
    3,
    60,
    "DENY",
    "operator1",
    () => null,
    permissionFn,
  );
  assert.strictEqual(operatorRoute.ok, true);
  if (operatorRoute.ok) {
    assert.strictEqual(operatorRoute.state.policies.length, 2);
  }

  const degradeState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: "tenant3",
        policyKey: "policy1",
        entitlementKey: "ent1",
        limit: 5,
        windowSeconds: 60,
        action: "DENY",
        updatedAt: "2024-01-01T00:00:00.000Z",
        updatedBy: "operator1",
      },
    ],
  };
  const degradeCounters = new Map<string, capability.RateLimitCounter>();
  const degraded = capability.evaluateRateLimit(
    degradeState,
    "tenant3",
    "policy1",
    { entitlement: "ent1" },
    capability.createMockCacheAdapter(degradeCounters, false),
    capability.createMockRelationalAdapter(degradeCounters, true),
  );
  assert.strictEqual(degraded.decision, "DEGRADED");
  assert.ok(degraded.counter !== null);
  if (degraded.counter !== null) {
    assert.strictEqual(degraded.counter.usedCount, 1);
  }

  const hermeticProof = capability.runHermeticProof(
    capability.initialState,
    "tenant4",
    "policy1",
    "ent1",
    2,
    60,
    capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true),
    capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true),
    "operator1",
    () => null,
    permissionFn,
  );
  assert.strictEqual(hermeticProof.outcome, "PROVED");
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
  assert.strictEqual(capability.checkReadiness(readyCache, readyRelational), "READY");

  const degradedCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const degradedRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), true);
  assert.strictEqual(capability.checkReadiness(degradedCache, degradedRelational), "DEGRADED");

  const unavailableCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), false);
  const unavailableRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  assert.strictEqual(capability.checkReadiness(unavailableCache, unavailableRelational), "UNAVAILABLE");
  assert.strictEqual(capability.isProviderStateAmbiguous(unavailableCache, unavailableRelational), true);

  const relationalDownCache = capability.createMockCacheAdapter(new Map<string, capability.RateLimitCounter>(), true);
  const relationalDownRelational = capability.createMockRelationalAdapter(new Map<string, capability.RateLimitCounter>(), false);
  assert.strictEqual(capability.checkReadiness(relationalDownCache, relationalDownRelational), "DEGRADED");

  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const skipProof = capability.runRelationalCountingProof(
    capability.initialState,
    "tenant1",
    "policy1",
    "ent1",
    2,
    60,
    "operator1",
    () => null,
    permissionFn,
    false,
  );
  assert.strictEqual(skipProof.outcome, "SKIPPED_DB_UNAVAILABLE");

  const fallbackState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: "tenant1",
        policyKey: "policy1",
        entitlementKey: "ent1",
        limit: 3,
        windowSeconds: 60,
        action: "DENY",
        updatedAt: "2024-01-01T00:00:00.000Z",
        updatedBy: "operator1",
      },
    ],
  };
  const fallbackCounters = new Map<string, capability.RateLimitCounter>();
  const fallback = capability.evaluateRateLimit(
    fallbackState,
    "tenant1",
    "policy1",
    { entitlement: "ent1" },
    capability.createMockCacheAdapter(fallbackCounters, false),
    capability.createMockRelationalAdapter(fallbackCounters, true),
  );
  assert.strictEqual(fallback.decision, "DEGRADED");
  assert.strictEqual(fallbackCounters.size, 1);
  const fallbackCounter = Array.from(fallbackCounters.values())[0]!;
  assert.strictEqual(fallbackCounter.usedCount, 1);
});

test("ratelimitingapistatemodel", () => {
  const policy: capability.RateLimitPolicy = {
    tenantKey: "tenant1",
    policyKey: "policy1",
    entitlementKey: "ent1",
    limit: 10,
    windowSeconds: 60,
    action: "DENY",
    updatedAt: "2024-01-01T00:00:00.000Z",
    updatedBy: "operator1",
  };

  const windowA = capability.getCurrentWindowStart(60, 1_700_000_000_000);
  const windowB = capability.getNextWindowStart(60, 1_700_000_000_000);

  const counterWithin: capability.RateLimitCounter = {
    tenantId: "tenant1",
    policyKey: "policy1",
    windowStart: windowA,
    usedCount: 5,
    limit: 10,
    exceeded: false,
    bucketState: "WITHIN_WINDOW",
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
    tenantId: "tenant1",
    policyKey: "policy1",
    windowStart: windowA,
    usedCount: 11,
    limit: 10,
    exceeded: true,
    bucketState: "EXCEEDED",
  };
  const validationExceeded = capability.validateStateModel(policy, counterExceeded, null);
  assert.strictEqual(validationExceeded.counterFieldsValid, true);
  assert.strictEqual(validationExceeded.exceededDerivableFromUsedCount, true);
  assert.strictEqual(validationExceeded.bucketStateMatchesExceeded, true);
  assert.strictEqual(validationExceeded.limitExceededAbove, true);

  const previous: capability.RateLimitCounter = {
    tenantId: "tenant1",
    policyKey: "policy1",
    windowStart: windowA,
    usedCount: 3,
    limit: 10,
    exceeded: false,
    bucketState: "WITHIN_WINDOW",
  };
  const nextBucketCounter: capability.RateLimitCounter = {
    tenantId: "tenant1",
    policyKey: "policy1",
    windowStart: windowB,
    usedCount: 0,
    limit: 10,
    exceeded: false,
    bucketState: "WITHIN_WINDOW",
  };
  const resetResult = capability.validateStateModel(policy, nextBucketCounter, previous);
  assert.strictEqual(resetResult.counterResetsOnNewBucket, true);
  assert.strictEqual(resetResult.counterNotDecremented, true);
  assert.strictEqual(resetResult.counterResetOnlyOnNewBucket, true);
  assert.strictEqual(resetResult.liveCounterResetsInNewBucket, true);

  const afterOverflow: capability.RateLimitCounter = {
    tenantId: "tenant1",
    policyKey: "policy1",
    windowStart: windowA,
    usedCount: 11,
    limit: 10,
    exceeded: true,
    bucketState: "EXCEEDED",
  };
  const recovery: capability.RateLimitCounter = {
    tenantId: "tenant1",
    policyKey: "policy1",
    windowStart: windowB,
    usedCount: 1,
    limit: 10,
    exceeded: false,
    bucketState: "WITHIN_WINDOW",
  };
  const recoveryResult = capability.validateStateModel(policy, recovery, afterOverflow);
  assert.strictEqual(recoveryResult.counterResetsOnNewBucket, true);
  assert.strictEqual(recoveryResult.counterNotDecremented, true);

  const newBucket = capability.createOrUpdateCounter(capability.initialState, "tenant1", "policy1", windowB, 0, 10);
  assert.strictEqual(newBucket.counters.length, 1);
  assert.strictEqual(newBucket.counters[0]!.windowStart, windowB);
  assert.strictEqual(newBucket.counters[0]!.usedCount, 0);

  const resetViaFunction = capability.resetCounterInNewBucket(capability.initialState, "tenant1", "policy1", windowB, 10);
  assert.strictEqual(resetViaFunction.counters[0]!.usedCount, 0);
  assert.strictEqual(resetViaFunction.counters[0]!.windowStart, windowB);
});

test("ratelimitingapivalidation", () => {
  const permissionFn = (_required: capability.RateLimitPermission, _operatorId: string): boolean => true;
  const operatorId = "operator1";
  const policyKey = "policy1";

  const invalidTenantRead = capability.readPolicy(capability.initialState, "invalid@tenant", policyKey, permissionFn, operatorId, true);
  assert.strictEqual(invalidTenantRead.ok, false);
  if (!invalidTenantRead.ok) {
    assert.strictEqual(invalidTenantRead.error.kind, "TENANT_INVALID");
  }

  const invalidPolicy: capability.RateLimitPolicy = {
    tenantKey: "tenant1",
    policyKey,
    entitlementKey: "",
    limit: 0,
    windowSeconds: 0,
    action: "DENY",
    updatedAt: "2024-01-01T00:00:00.000Z",
    updatedBy: operatorId,
  };
  const policyError = capability.validatePolicy(invalidPolicy);
  assert.ok(policyError !== null);
  if (policyError !== null) {
    assert.strictEqual(policyError.kind, "INVALID_POLICY");
  }

  const noPolicyCounters = new Map<string, capability.RateLimitCounter>();
  const noPolicyCache = capability.createMockCacheAdapter(noPolicyCounters, true);
  const noPolicyRelational = capability.createMockRelationalAdapter(noPolicyCounters, true);
  const noPolicyEval = capability.evaluateRateLimit(
    capability.initialState,
    "tenant1",
    "policy1",
    { entitlement: "ent1" },
    noPolicyCache,
    noPolicyRelational,
  );
  assert.strictEqual(noPolicyEval.decision, "ALLOWED");

  const stateWithPolicy: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: "tenant1",
        policyKey: "policy1",
        entitlementKey: "ent1",
        limit: 1,
        windowSeconds: 60,
        action: "DENY",
        updatedAt: "2024-01-01T00:00:00.000Z",
        updatedBy: "operator1",
      },
    ],
  };
  const countersBefore = stateWithPolicy.counters.length;
  const entCounters = new Map<string, capability.RateLimitCounter>();
  const entCache = capability.createMockCacheAdapter(entCounters, true);
  const entRelational = capability.createMockRelationalAdapter(entCounters, true);
  const missingEntitlementResult = capability.evaluateRateLimit(stateWithPolicy, "tenant1", "policy1", null, entCache, entRelational);
  assert.strictEqual(missingEntitlementResult.decision, "DENIED_ENTITLEMENT_MISSING");
  assert.strictEqual(stateWithPolicy.counters.length, countersBefore);
  assert.strictEqual(entCounters.size, 0);

  const atLimitState: capability.RateLimitState = {
    ...capability.initialState,
    policies: [
      {
        tenantKey: "tenant2",
        policyKey: "policy1",
        entitlementKey: "ent1",
        limit: 2,
        windowSeconds: 60,
        action: "DENY",
        updatedAt: "2024-01-01T00:00:00.000Z",
        updatedBy: "operator1",
      },
    ],
  };
  const token: { readonly entitlement: string } = { entitlement: "ent1" };
  const atCounters = new Map<string, capability.RateLimitCounter>();
  const atCache = capability.createMockCacheAdapter(atCounters, true);
  const atRelational = capability.createMockRelationalAdapter(atCounters, true);
  const firstAt = capability.evaluateRateLimit(atLimitState, "tenant2", "policy1", token, atCache, atRelational);
  assert.strictEqual(firstAt.decision, "ALLOWED");
  const secondAt = capability.evaluateRateLimit(atLimitState, "tenant2", "policy1", token, atCache, atRelational);
  assert.strictEqual(secondAt.decision, "ALLOWED");
  const thirdAt = capability.evaluateRateLimit(atLimitState, "tenant2", "policy1", token, atCache, atRelational);
  assert.strictEqual(thirdAt.decision, "DENIED_LIMIT_EXCEEDED");

  assert.strictEqual(capability.validateTenantId(""), false);
  assert.strictEqual(capability.validateTenantId("invalid@tenant"), false);
  assert.strictEqual(capability.validateTenantId("valid_tenant-1"), true);
});