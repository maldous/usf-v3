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
        statusCode: 403,
    });
    const errorResult = capability.replaceResourcePolicy(state, 'res1', { allow: true }, failingAuditFn);
    if (!('kind' in errorResult)) {
        throw new Error('Expected error result');
    }
    assert.equal(errorResult.kind, 'AUDIT_FAILURE');
    assert.equal(errorResult.statusCode, 403);
});

test("abacpolicydecisionpointcontracts", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' } as const],
        resourcePolicies: [{ resource: 'r1', policy: { allow: true } } as const],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    const readPolicy = capability.readResourcePolicy(state, 'r1');
    assert.deepEqual(readPolicy, { resource: 'r1', policy: { allow: true } });

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
        readiness: 'READY',
    };

    const noToken = capability.evaluateRequest(state, null, 'r1', 's1', true);
    assert.equal(noToken.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(noToken.error?.kind, 'AUTHENTICATION_REQUIRED');
    assert.equal(noToken.error ? capability.mapErrorToStatusCode(noToken.error) : 0, 401);

    const insufficient = capability.evaluateRequest(state, { authLevel: 'p0' }, 'r1', 's1', true);
    assert.equal(insufficient.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(insufficient.error?.kind, 'STEP_UP_REQUIRED');
    assert.equal(insufficient.error ? capability.mapErrorToStatusCode(insufficient.error) : 0, 401);

    const deniedState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: '' } as const],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    const denied = capability.evaluateRequest(deniedState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(denied.decision, 'POLICY_DENIED');
    assert.equal(denied.error?.kind, 'POLICY_DENIED');
    assert.equal(denied.error ? capability.mapErrorToStatusCode(denied.error) : 0, 403);

    const unreg = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r2', 's1', true);
    assert.equal(unreg.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(capability.mapDecisionToStatusCode(unreg.decision), 503);

    const serverUnavailable = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', false);
    assert.equal(serverUnavailable.decision, 'SERVER_UNAVAILABLE');
    assert.equal(capability.mapDecisionToStatusCode(serverUnavailable.decision), 503);

    const fallbackState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: '' } as const],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    const fallbackResult = capability.evaluateRequestWithFallback(fallbackState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(fallbackResult.decision, 'POLICY_DENIED');
    assert.equal(fallbackResult.error?.kind, 'POLICY_DENIED');
    assert.equal(fallbackResult.error ? capability.mapErrorToStatusCode(fallbackResult.error) : 0, 403);
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

    const readPolicy = capability.readResourcePolicy(state, 'r1');
    assert.deepEqual(readPolicy, { resource: 'r1', policy: { allow: true } });

    const evalResult = capability.evaluateLifecycle(state, 'read', 'r1', { authLevel: 'p1' }, 's1', true);
    assert.equal(evalResult.decision, 'GRANTED');

    const stepUpResult = capability.evaluateLifecycle(state, 'read', 'r1', { authLevel: 'p0' }, 's1', true);
    assert.equal(stepUpResult.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(stepUpResult.error?.kind, 'STEP_UP_REQUIRED');

    const staticFallbackResult = capability.evaluateLifecycle(
        { ...state, resourcePolicies: [] },
        'read',
        'r1',
        { authLevel: 'p1' },
        's1',
        false,
    );
    assert.equal(staticFallbackResult.decision, 'GRANTED');

    const failClosedResult = capability.evaluateLifecycle(
        { ...state, resourcePolicies: [] },
        'read',
        'unregistered',
        { authLevel: 'p1' },
        's1',
        false,
    );
    assert.equal(failClosedResult.decision, 'POLICY_DENIED');

    const adminResult = capability.replaceResourcePolicy(state, 'r1', { allow: false }, auditFn);
    if (!('resourcePolicies' in adminResult)) {
        throw new Error('Expected state result with resourcePolicies');
    }
    assert.deepEqual(adminResult.resourcePolicies, [{ resource: 'r1', policy: { allow: false } }]);
});

test("abacpolicydecisionpointpermissions", () => {
    const routeGuard: capability.AbacPolicyDecisionPointRouteGuard = {
        resource: 'res1',
        scope: 'read',
        requiredPermission: 'read:res1',
    };
    assert.equal(routeGuard.resource, 'res1');
    assert.equal(routeGuard.scope, 'read');
    assert.equal(routeGuard.requiredPermission, 'read:res1');

    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [routeGuard],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };

    const deniedWrite = capability.evaluateLifecycle(state, 'write', 'res1', { authLevel: 'viewer' }, 'read', true);
    assert.equal(deniedWrite.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(deniedWrite.error?.kind, 'STEP_UP_REQUIRED');

    const allowedWrite = capability.evaluateLifecycle(state, 'write', 'res1', { authLevel: 'tenant:auth-settings' }, 'read', true);
    assert.equal(allowedWrite.decision, 'GRANTED');

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
        readiness: 'READY',
    };
    const granted = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(granted.decision, 'GRANTED');
    assert.equal(granted.error, null);

    const denied = capability.evaluateRequest(state, { authLevel: 'p0' }, 'r1', 's1', true);
    assert.equal(denied.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(denied.error?.kind, 'STEP_UP_REQUIRED');

    const auditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): null => null;
    const updated = capability.replaceResourcePolicy(state, 'r1', { allow: false }, auditFn);
    if (!('resourcePolicies' in updated)) {
        throw new Error('Expected state result');
    }
    assert.deepEqual(updated.resourcePolicies, [{ resource: 'r1', policy: { allow: false } }]);
});

test("abacpolicydecisionpointreadinessmodel", () => {
    const readyState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    const readinessReady = capability.computeReadiness(readyState);
    assert.equal(readinessReady, 'READY');

    const explicitDegradedState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'DEGRADED',
    };
    const readinessExplicitDegraded = capability.computeReadiness(explicitDegradedState);
    assert.equal(readinessExplicitDegraded, 'DEGRADED');

    const serverUnavailableState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: 'SERVER_UNAVAILABLE',
        lastError: null,
        readiness: 'READY',
    };
    const readinessUnavailable = capability.computeReadiness(serverUnavailableState);
    assert.equal(readinessUnavailable, 'DEGRADED');

    const unregState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: 'RESOURCE_NOT_REGISTERED',
        lastError: null,
        readiness: 'READY',
    };
    const readinessUnreg = capability.computeReadiness(unregState);
    assert.equal(readinessUnreg, 'DEGRADED');

    const unregisteredEval = capability.evaluateRequest(readyState, { authLevel: 'p1' }, 'r1', 's1', true);
    assert.equal(unregisteredEval.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(unregisteredEval.error, null);

    const serverUnavailableEval = capability.evaluateRequest(readyState, { authLevel: 'p1' }, 'r1', 's1', false);
    assert.equal(serverUnavailableEval.decision, 'SERVER_UNAVAILABLE');
    assert.equal(serverUnavailableEval.error, null);
});

test("abacpolicydecisionpointstatemodel", () => {
    const routeGuard: capability.AbacPolicyDecisionPointRouteGuard = {
        resource: 'res1',
        scope: 'read',
        requiredPermission: 'read:res1',
    };
    const resourcePolicy: capability.AbacPolicyDecisionPointResourcePolicy = {
        resource: 'res1',
        policy: { allow: true },
    };
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [routeGuard],
        resourcePolicies: [resourcePolicy],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    assert.deepEqual(state.routeGuards, [routeGuard]);
    assert.deepEqual(state.resourcePolicies, [resourcePolicy]);
    assert.equal(state.lastDecision, null);
    assert.equal(state.lastError, null);
    assert.equal(capability.initialState.readiness, 'READY');

    const evalResult = capability.evaluateRequest(state, { authLevel: 'read:res1' }, 'res1', 'read', true);
    assert.equal(evalResult.decision, 'GRANTED');
    assert.equal(evalResult.error, null);
    assert.equal(state.lastDecision, null);
});

test("abacpolicydecisionpointvalidation", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    const unregisteredValidation = capability.applyValidation(state, 'r1', null, null);
    assert.equal(unregisteredValidation?.kind, 'POLICY_DENIED');
    assert.equal(unregisteredValidation?.message, 'Resource not registered and no injected policy');
    assert.equal(unregisteredValidation?.statusCode, 403);

    const withGuardState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1/*', scope: 's1', requiredPermission: 'p1' } as const],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
        readiness: 'READY',
    };
    const absentStatic = capability.applyValidation(withGuardState, 'r1/item', null, null);
    assert.equal(absentStatic?.kind, 'POLICY_DENIED');
    assert.equal(absentStatic?.message, 'Absent static permission denies');
    assert.equal(absentStatic?.statusCode, 403);

    const injectedPolicyValidation = capability.applyValidation(state, 'r1', { allow: true }, null);
    assert.equal(injectedPolicyValidation, null);

    const validWithStatic = capability.applyValidation(withGuardState, 'r1/item', null, 'p1');
    assert.equal(validWithStatic, null);
});