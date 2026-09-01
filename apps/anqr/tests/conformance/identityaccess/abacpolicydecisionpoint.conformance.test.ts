import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/abacpolicydecisionpoint.ts";

test("abacpolicydecisionpointauditmodel", () => {
  const state = capability.initialState;
  const auditFn = (event: capability.AbacPolicyDecisionPointAuditEvent): capability.AbacPolicyDecisionPointError | null => {
    assert.equal(event.kind, 'AUDIT_BEFORE_CHANGE');
    assert.equal(event.resource, 'test-resource');
    assert.deepEqual(event.policy, { allow: true });
    assert.ok(typeof event.timestamp === 'string');
    return null;
  };
  const result = capability.replaceResourcePolicy(state, 'test-resource', { allow: true }, auditFn);
  assert.ok(!('kind' in result));
  assert.deepEqual(result.resourcePolicies, [{ resource: 'test-resource', policy: { allow: true } }]);

  const failingAuditFn = (_: capability.AbacPolicyDecisionPointAuditEvent): capability.AbacPolicyDecisionPointError | null => ({
    kind: 'AUDIT_FAILURE',
    message: 'Audit failed',
  });
  const errorResult = capability.replaceResourcePolicy(state, 'test-resource', { allow: true }, failingAuditFn);
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
});

test("abacpolicydecisionpointerrormodel", () => {
  const state: capability.AbacPolicyDecisionPointState = {
    routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
    resourcePolicies: [{ resource: 'r1', policy: { allow: true } }],
    lastDecision: null,
    lastError: null,
  };

  const noTokenResult = capability.evaluateRequest(state, null, 'r1', 's1');
  assert.equal(noTokenResult.decision, 'RESOURCE_NOT_REGISTERED');
  assert.equal(noTokenResult.error?.kind, 'AUTHENTICATION_REQUIRED');

  const wrongAuthResult = capability.evaluateRequest(state, { authLevel: 'p0' }, 'r1', 's1');
  assert.equal(wrongAuthResult.decision, 'INSUFFICIENT_AUTH_LEVEL');
  assert.equal(wrongAuthResult.error?.kind, 'STEP_UP_REQUIRED');

  const unregisteredResult = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r2', 's1');
  assert.equal(unregisteredResult.decision, 'RESOURCE_NOT_REGISTERED');
  assert.equal(unregisteredResult.error?.kind, 'POLICY_DENIED');
});

test("abacpolicydecisionpointlifecycle", () => {
  const state: capability.AbacPolicyDecisionPointState = {
    routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
    resourcePolicies: [],
    lastDecision: null,
    lastError: null,
  };
  const auditFn = (_: capability.AbacPolicyDecisionPointAuditEvent): null => null;
  const newState = capability.replaceResourcePolicy(state, 'r1', { allow: true }, auditFn);
  assert.deepEqual(newState.resourcePolicies, [{ resource: 'r1', policy: { allow: true } }]);

  const evalResult = capability.evaluateRequest(newState, { authLevel: 'p1' }, 'r1', 's1');
  assert.equal(evalResult.decision, 'GRANTED');

  const fallbackResult = capability.evaluateRequestWithFallback(
    { ...newState, routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: '' }] },
    { authLevel: 'p0' },
    'r1',
    's1',
  );
  assert.equal(fallbackResult.decision, 'GRANTED');
});

test("abacpolicydecisionpointpermissions", () => {
  const state: capability.AbacPolicyDecisionPointState = {
    routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
    resourcePolicies: [],
    lastDecision: null,
    lastError: null,
  };
  const auditFn = (_: capability.AbacPolicyDecisionPointAuditEvent): null => null;
  const newState = capability.replaceResourcePolicy(state, 'r1', { allow: true }, auditFn);
  assert.deepEqual(newState.resourcePolicies, [{ resource: 'r1', policy: { allow: true } }]);

  const evalResult = capability.evaluateRequest(newState, { authLevel: 'p1' }, 'r1', 's1');
  assert.equal(evalResult.decision, 'GRANTED');
});

test("abacpolicydecisionpointproof", () => {
  const state: capability.AbacPolicyDecisionPointState = {
    routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
    resourcePolicies: [{ resource: 'r1', policy: { allow: true } }],
    lastDecision: null,
    lastError: null,
  };
  const result = capability.evaluateRequest(state, { authLevel: 'p1' }, 'r1', 's1');
  assert.equal(result.decision, 'GRANTED');
  assert.equal(result.error, null);
});

test("abacpolicydecisionpointreadinessmodel", () => {
  const state: capability.AbacPolicyDecisionPointState = {
    routeGuards: [],
    resourcePolicies: [],
    lastDecision: null,
    lastError: null,
  };
  const result = capability.evaluateRequestWithFallback(state, { authLevel: 'p1' }, 'r1', 's1');
  assert.equal(result.decision, 'POLICY_DENIED');
  assert.equal(result.error?.kind, 'POLICY_DENIED');
});

test("abacpolicydecisionpointstatemodel", () => {
  const state: capability.AbacPolicyDecisionPointState = {
    routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
    resourcePolicies: [{ resource: 'r1', policy: { allow: true } }],
    lastDecision: 'GRANTED',
    lastError: null,
  };
  assert.deepEqual(state.routeGuards, [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }]);
  assert.deepEqual(state.resourcePolicies, [{ resource: 'r1', policy: { allow: true } }]);
  assert.equal(state.lastDecision, 'GRANTED');
  assert.equal(state.lastError, null);
});

test("abacpolicydecisionpointvalidation", () => {
  const state: capability.AbacPolicyDecisionPointState = {
    routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: 'p1' }],
    resourcePolicies: [],
    lastDecision: null,
    lastError: null,
  };
  const result = capability.evaluateRequestWithFallback(state, { authLevel: 'p1' }, 'r1', 's1');
  assert.equal(result.decision, 'RESOURCE_NOT_REGISTERED');

  const fallbackState: capability.AbacPolicyDecisionPointState = {
    routeGuards: [{ resource: 'r1', scope: 's1', requiredPermission: '' }],
    resourcePolicies: [],
    lastDecision: null,
    lastError: null,
  };
  const fallbackResult = capability.evaluateRequestWithFallback(fallbackState, { authLevel: 'p1' }, 'r1', 's1');
  assert.equal(fallbackResult.decision, 'GRANTED');

  const policyState: capability.AbacPolicyDecisionPointState = {
    routeGuards: [],
    resourcePolicies: [{ resource: 'r1', policy: { allow: true } }],
    lastDecision: null,
    lastError: null,
  };
  const policyResult = capability.evaluateRequest(policyState, { authLevel: 'p1' }, 'r1', 's1');
  assert.equal(policyResult.decision, 'RESOURCE_NOT_REGISTERED');
});