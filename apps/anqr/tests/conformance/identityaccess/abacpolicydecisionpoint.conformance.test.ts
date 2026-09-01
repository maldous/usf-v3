import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/abacpolicydecisionpoint.ts";

test("abacpolicydecisionpointauditmodel", () => {
    const state = capability.initialState;
    let auditCalled = false;
    const auditFn = (event: capability.AbacPolicyDecisionPointAuditEvent) => {
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
    // state is not mutated by evaluation
    assert.equal(state.lastDecision, null);
    // replacement returns a new state
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
    const staticResult = capability.evaluateRequestWithFallback(staticState