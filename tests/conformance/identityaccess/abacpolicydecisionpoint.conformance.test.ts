import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/abacpolicydecisionpoint.ts";

test("abacpolicydecisionpointauditmodel", () => {
    const state = capability.initialState;
    let auditCalled = false;
    const auditFn = (event: capability.AbacPolicyDecisionPointAuditEvent): capability.AbacPolicyDecisionPointError | null => {
        auditCalled = true;
        assert.equal(event.kind, 'AUDIT_BEFORE_CHANGE');
        assert.equal(event.resource, 'res1');
        assert.deepEqual(event.policy, { allow: true });
        assert.ok(typeof event.timestamp === 'string');
        return null;
    };
    const result = capability.replaceResourcePolicy(state, 'res1', { allow: true }, auditFn);
    assert.ok(auditCalled, 'audit function should be called');
    if (!('resourcePolicies' in result)) {
        throw new Error('Expected state result with resourcePolicies');
    }
    assert.deepEqual(result.resourcePolicies, [{ resource: 'res1', policy: { allow: true } }]);
    assert.equal(result.lastError, null);

    const failingAuditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): capability.AbacPolicyDecisionPointError => ({
        kind: 'AUDIT_FAILURE',
        message: 'fail',
    });
    const errorResult = capability.replaceResourcePolicy(state, 'res1', { allow: true }, failingAuditFn);
    if (!('kind' in errorResult)) {
        throw new Error('Expected error result');
    }
    assert.equal(errorResult.kind, 'AUDIT_FAILURE');
});

test("abacpolicydecisionpointcontracts", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' } as const],
        resourcePolicies: [{ resource: 'r1', policy: { allow: true } } as const],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const result = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(result.decision, 'GRANTED');
    assert.equal(result.error, null);
    assert.equal(state.lastDecision, null);
    const auditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): null => null;
    const newState = capability.replaceResourcePolicy(state, 'r1', { allow: false }, auditFn);
    if (!('resourcePolicies' in newState)) {
        throw new Error('Expected state result with resourcePolicies');
    }
    assert.deepEqual(newState.resourcePolicies, [{ resource: 'r1', policy: { allow: false } }]);
});

test("abacpolicydecisionpointerrormodel", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' } as const],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };

    // Missing token -> AUTHENTICATION_REQUIRED
    const noToken = capability.evaluateRequest(state, null, 'r1', 's1', true);
    assert.equal(noToken.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(noToken.error?.kind, 'AUTHENTICATION_REQUIRED');

    // Insufficient auth level -> STEP_UP_REQUIRED
    const insufficient = capability.evaluateRequest(state, { authLevel: 'p0' }, 'r1', 's1', true);
    assert.equal(insufficient.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(insufficient.error?.kind, 'STEP_UP_REQUIRED');

    // Unregistered resource -> RESOURCE_NOT_REGISTERED
    const unreg = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r2', 's1', true);
    assert.equal(unreg.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(unreg.error, null);

    // Server unavailable -> SERVER_UNAVAILABLE
    const serverUnavailable = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', false);
    assert.equal(serverUnavailable.decision, 'SERVER_UNAVAILABLE');
    assert.equal(serverUnavailable.error, null);

    // Static fallback without permission -> POLICY_DENIED
    const fallbackState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const fallbackResult = capability.evaluateRequestWithFallback(fallbackState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(fallbackResult.decision, 'POLICY_DENIED');
    assert.equal(fallbackResult.error?.kind, 'POLICY_DENIED');
});

test("abacpolicydecisionpointlifecycle", () => {
    let state: capability.AbacPolicyDecisionPointState = {
        ...capability.initialState,
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' } as const],
    };
    const auditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): null => null;
    const newState = capability.replaceResourcePolicy(state, 'r1', { allow: true }, auditFn);
    if (!('resourcePolicies' in newState)) {
        throw new Error('Expected state result with resourcePolicies');
    }
    state = newState;

    // With valid guard and token -> GRANTED
    const evalResult = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(evalResult.decision, 'GRANTED');

    // Without guard -> RESOURCE_NOT_REGISTERED (fallback)
    const noGuardState: capability.AbacPolicyDecisionPointState = {
        ...state,
        routeGuards: [],
    };
    const fallbackResult = capability.evaluateRequestWithFallback(noGuardState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(fallbackResult.decision, 'RESOURCE_NOT_REGISTERED');

    // Static guard with empty permission -> GRANTED
    const staticState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: '' } as const],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const staticResult = capability.evaluateRequestWithFallback(staticState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(staticResult.decision, 'GRANTED');

    // Server unavailable -> SERVER_UNAVAILABLE
    const serverUnavailableResult = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', false);
    assert.equal(serverUnavailableResult.decision, 'SERVER_UNAVAILABLE');
    assert.equal(serverUnavailableResult.error, null);
});

test("abacpolicydecisionpointpermissions", () => {
    const routeGuard: capability.AbacPolicyDecisionPointRouteGuard = {
        resource: 'res1',
        scope: 'read',
        requiredPermission: 'read:res1'
    };
    assert.equal(routeGuard.resource, 'res1');
    assert.equal(routeGuard.scope, 'read');
    assert.equal(routeGuard.requiredPermission, 'read:res1');

    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [routeGuard],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const auditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): null => null;
    const newState = capability.replaceResourcePolicy(state, 'res1', { allow: true }, auditFn);
    if (!('resourcePolicies' in newState)) {
        throw new Error('Expected state result with resourcePolicies');
    }
    assert.deepEqual(newState.resourcePolicies, [{ resource: 'res1', policy: { allow: true } }]);
});

test("abacpolicydecisionpointproof", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' } as const],
        resourcePolicies: [{ resource: 'r1', policy: { allow: true } } as const],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const granted = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(granted.decision, 'GRANTED');
    assert.equal(granted.error, null);

    const denied = capability.evaluateRequest(state, { authLevel: 'p0' }, 'r1', 's1', true);
    assert.equal(denied.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(denied.error?.kind, 'STEP_UP_REQUIRED');
});

test("abacpolicydecisionpointreadinessmodel", () => {
    const notReadyState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const readinessNotReady = capability.computeReadiness(notReadyState);
    assert.equal(readinessNotReady, 'NOT_READY');

    const readyState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    const readinessReady = capability.computeReadiness(readyState);
    assert.equal(readinessReady, 'READY');

    const degradedState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: 'SERVER_UNAVAILABLE',
        lastError: null,
        readiness: 'NOT_READY',
    };
    const readinessDegraded = capability.computeReadiness(degradedState);
    assert.equal(readinessDegraded, 'DEGRADED');

    const unregistered = capability.evaluateRequest(notReadyState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(unregistered.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(unregistered.error, null);

    const serverUnavailable = capability.evaluateRequest(notReadyState, { authLevel: 'p1' }, 'r1', 's1', false);
    assert.equal(serverUnavailable.decision, 'SERVER_UNAVAILABLE');
    assert.equal(serverUnavailable.error, null);

    const fallbackResult = capability.evaluateRequestWithFallback(notReadyState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(fallbackResult.decision, 'POLICY_DENIED');
    assert.equal(fallbackResult.error?.kind, 'POLICY_DENIED');
});

test("abacpolicydecisionpointstatemodel", () => {
    const routeGuard: capability.AbacPolicyDecisionPointRouteGuard = {
        resource: 'res1',
        scope: 'read',
        requiredPermission: 'read:res1'
    };
    const resourcePolicy: capability.AbacPolicyDecisionPointResourcePolicy = {
        resource: 'res1',
        policy: { allow: true }
    };
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [routeGuard],
        resourcePolicies: [resourcePolicy],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    assert.deepEqual(state.routeGuards, [routeGuard]);
    assert.deepEqual(state.resourcePolicies, [resourcePolicy]);
    assert.equal(state.lastDecision, null);
    assert.equal(state.lastError, null);

    const evalResult = capability.evaluateRequest(state, { authLevel: 'read:res1' }, 'res1', 'read', true);
    assert.equal(evalResult.decision, 'GRANTED');
    assert.equal(evalResult.error, null);
});

test("abacpolicydecisionpointvalidation", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const unregistered = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(unregistered.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(unregistered.error, null);

    const validationError = capability.applyValidation(state, 'r1', { allow: true }, null);
    assert.equal(validationError?.kind, 'POLICY_DENIED');
    assert.equal(validationError?.message, 'Resource not registered');

    const withGuardState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' } as const],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'NOT_READY',
    };
    const staticValidationError = capability.applyValidation(withGuardState, 'r1', { allow: true }, null);
    assert.equal(staticValidationError?.kind, 'POLICY_DENIED');
    assert.equal(staticValidationError?.message, 'Static permission not configured for resource');

    const validValidation = capability.applyValidation(withGuardState, 'r1', { allow: true }, 'p1');
    assert.equal(validValidation, null);
});