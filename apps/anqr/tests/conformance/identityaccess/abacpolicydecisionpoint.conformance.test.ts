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
        throw new Error('Expected state result');
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
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
        resourcePolicies: [{ resource: 'r1', policy: { allow: true } }],
        lastDecision: null,
        lastError: null,
    };
    const result = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(result.decision, 'GRANTED');
    assert.equal(result.error, null);
    assert.equal(state.lastDecision, null);
    const auditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): null => null;
    const newState = capability.replaceResourcePolicy(state, 'r1', { allow: false }, auditFn);
    if (!('resourcePolicies' in newState)) {
        throw new Error('Expected state result');
    }
    assert.deepEqual(newState.resourcePolicies, [{ resource: 'r1', policy: { allow: false } }]);
});

test("abacpolicydecisionpointerrormodel", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
        resourcePolicies: [{ resource: 'r1', policy: {} }],
        lastDecision: null,
        lastError: null,
    };
    const noToken = capability.evaluateRequest(state, null, 'r1', 's1');
    assert.equal(noToken.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(noToken.error?.kind, 'AUTHENTICATION_REQUIRED');

    const insufficient = capability.evaluateRequest(state, { authLevel: 'p0' }, 'r1', 's1');
    assert.equal(insufficient.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(insufficient.error?.kind, 'STEP_UP_REQUIRED');

    const unreg = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r2', 's1');
    assert.equal(unreg.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(unreg.error?.kind, 'POLICY_DENIED');

    const fallbackState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
    };
    const fallbackResult = capability.evaluateRequestWithFallback(fallbackState, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(fallbackResult.decision, 'POLICY_DENIED');
    assert.equal(fallbackResult.error?.kind, 'POLICY_DENIED');
});

test("abacpolicydecisionpointlifecycle", () => {
    let state = capability.initialState;
    state = {
        ...state,
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
    };
    const auditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): null => null;
    const newState = capability.replaceResourcePolicy(state, 'r1', { allow: true }, auditFn);
    if (!('resourcePolicies' in newState)) {
        throw new Error('Expected state result');
    }
    state = newState;
    const evalResult = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(evalResult.decision, 'GRANTED');

    const noGuardState: capability.AbacPolicyDecisionPointState = {
        ...state,
        routeGuards: [],
    };
    const fallbackResult = capability.evaluateRequestWithFallback(noGuardState, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(fallbackResult.decision, 'POLICY_DENIED');

    const staticState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: '' }],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
    };
    const staticResult = capability.evaluateRequestWithFallback(staticState, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(staticResult.decision, 'GRANTED');
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
    };
    const auditFn = (_event: capability.AbacPolicyDecisionPointAuditEvent): null => null;
    const newState = capability.replaceResourcePolicy(state, 'res1', { allow: true }, auditFn);
    if (!('resourcePolicies' in newState)) {
        throw new Error('Expected state result');
    }
    assert.deepEqual(newState.resourcePolicies, [{ resource: 'res1', policy: { allow: true } }]);
});

test("abacpolicydecisionpointproof", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
        resourcePolicies: [{ resource: 'r1', policy: { allow: true } }],
        lastDecision: null,
        lastError: null,
    };
    const granted = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(granted.decision, 'GRANTED');
    assert.equal(granted.error, null);

    const denied = capability.evaluateRequest(state, { authLevel: 'p0' }, 'r1', 's1');
    assert.equal(denied.decision, 'INSUFFICIENT_AUTH_LEVEL');
    assert.equal(denied.error?.kind, 'STEP_UP_REQUIRED');
});

test("abacpolicydecisionpointreadinessmodel", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
    };
    const unregistered = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(unregistered.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(unregistered.error?.kind, 'POLICY_DENIED');

    const fallbackResult = capability.evaluateRequestWithFallback(state, { authLevel: 'p1' }, 'r1', 's1');
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
    };
    assert.deepEqual(state.routeGuards, [routeGuard]);
    assert.deepEqual(state.resourcePolicies, [resourcePolicy]);
    assert.equal(state.lastDecision, null);
    assert.equal(state.lastError, null);

    const evalResult = capability.evaluateRequest(state, { authLevel: 'read:res1' }, 'res1', 'read');
    assert.equal(evalResult.decision, 'GRANTED');
    assert.equal(evalResult.error, null);
});

test("abacpolicydecisionpointvalidation", () => {
    const state: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
    };
    const unregistered = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(unregistered.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(unregistered.error?.kind, 'POLICY_DENIED');

    const fallbackResult = capability.evaluateRequestWithFallback(state, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(fallbackResult.decision, 'POLICY_DENIED');
    assert.equal(fallbackResult.error?.kind, 'POLICY_DENIED');

    const staticState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: '' }],
        resourcePolicies: [],
        lastDecision: null,
        lastError: null,
    };
    const staticResult = capability.evaluateRequestWithFallback(staticState, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(staticResult.decision, 'GRANTED');
    assert.equal(staticResult.error, null);

    const policyState: capability.AbacPolicyDecisionPointState = {
        routeGuards: [],
        resourcePolicies: [{ resource: 'r1', policy: { allow: true } }],
        lastDecision: null,
        lastError: null,
    };
    const policyResult = capability.evaluateRequestWithFallback(policyState, { authLevel: 'p1' }, 'r1', 's1');
    assert.equal(policyResult.decision, 'RESOURCE_NOT_REGISTERED');
    assert.equal(policyResult.error?.kind, 'POLICY_DENIED');
});