import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/eventsworkflow/workflowenginescheduledjobsapprovals.ts";

test("workflowenginescheduledjobsapprovalsauditmodel", () => {
  const auditEvents: capability.WorkflowEngineScheduledJobsApprovalsAuditEvent[] = [];
  const auditFn = (event: capability.WorkflowEngineScheduledJobsApprovalsAuditEvent): capability.WorkflowEngineScheduledJobsApprovalsError | null => {
    auditEvents.push(event);
    return null;
  };

  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'READY',
  };

  const workflow = {
    workflowId: 'w1',
    workflowKey: 'k1',
    tenantId: 't1',
    payload: {},
    status: 'running' as const,
    detail: 'started',
    providerReadiness: 'READY' as const,
  };

  const updatedState = capability.addWorkflow(state, workflow);
  const signalResult = capability.signalWorkflow(
    updatedState,
    'w1',
    'approval.requested',
    't1',
    ['platform.workflow.write'],
    auditFn
  );

  assert.equal(signalResult.kind, 'success');
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].kind, 'workflow.started');

  const grantedResult = capability.signalWorkflow(
    updatedState,
    'w1',
    'approval.granted',
    't1',
    ['platform.workflow.write'],
    auditFn
  );

  assert.equal(grantedResult.kind, 'success');
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[1].kind, 'workflow.approved');
  assert.equal(auditEvents[2].kind, 'support-session');
});

test("workflowenginescheduledjobsapprovalscontracts", () => {
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'READY',
  };

  const getWorkflowsResult = capability.getWorkflows(state, 't1', ['tenant.workflow.read']);
  assert.equal(getWorkflowsResult.kind, 'success');
  assert.deepEqual(getWorkflowsResult.value, []);

  const getReadinessResult = capability.getWorkflowReadiness(state);
  assert.equal(getReadinessResult.kind, 'success');
  assert.equal(getReadinessResult.value, 'READY');

  const startResult = capability.startWorkflow(
    state,
    'w1',
    'k1',
    't1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startResult.kind, 'success');
  assert.equal(startResult.value.status, 'running');

  const workflowState = capability.addWorkflow(state, startResult.value);
  const getWorkflowResult = capability.getWorkflow(workflowState, 'w1', 't1', ['tenant.workflow.read']);
  assert.equal(getWorkflowResult.kind, 'success');
  assert.equal(getWorkflowResult.value?.workflowId, 'w1');

  const signalResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'approval.requested',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(signalResult.kind, 'success');

  const cancelResult = capability.cancelWorkflow(
    workflowState,
    'w1',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(cancelResult.kind, 'success');
});

test("workflowenginescheduledjobsapprovalserrormodel", () => {
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'DEGRADED',
  };

  const startResult = capability.startWorkflow(
    state,
    'w1',
    'k1',
    't1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startResult.kind, 'failure');
  assert.equal(startResult.error.kind, 'READINESS_DEGRADED');

  const getWorkflowResult = capability.getWorkflow(state, 'unknown', 't1', ['tenant.workflow.read']);
  assert.equal(getWorkflowResult.kind, 'failure');
  assert.equal(getWorkflowResult.error.kind, 'UNKNOWN_WORKFLOW');

  const workflow = {
    workflowId: 'w1',
    workflowKey: 'k1',
    tenantId: 't1',
    payload: {},
    status: 'running' as const,
    detail: 'started',
    providerReadiness: 'READY' as const,
  };
  const workflowState = capability.addWorkflow(state, workflow);
  const signalResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'approval.denied',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(signalResult.kind, 'success');
  assert.equal(signalResult.value.status, 'failed');

  const crossTenantResult = capability.getWorkflow(workflowState, 'w1', 't2', ['tenant.workflow.read']);
  assert.equal(crossTenantResult.kind, 'failure');
  assert.equal(crossTenantResult.error.kind, 'CROSS_TENANT_ACCESS');
});

test("workflowenginescheduledjobsapprovalslifecycle", () => {
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'READY',
  };

  const startResult = capability.startWorkflow(
    state,
    'w1',
    'k1',
    't1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startResult.kind, 'success');
  assert.equal(startResult.value.status, 'running');

  const workflowState = capability.addWorkflow(state, startResult.value);
  const requestedResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'approval.requested',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(requestedResult.kind, 'success');
  assert.equal(requestedResult.value.status, 'waiting');

  const grantedResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'approval.granted',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(grantedResult.kind, 'success');
  assert.equal(grantedResult.value.status, 'completed');

  const deniedResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'approval.denied',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(deniedResult.kind, 'success');
  assert.equal(deniedResult.value.status, 'failed');

  const cancelResult = capability.cancelWorkflow(
    workflowState,
    'w1',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(cancelResult.kind, 'success');
  assert.equal(cancelResult.value.status, 'cancelled');
});

test("workflowenginescheduledjobsapprovalspermissions", () => {
  const workflow = {
    workflowId: 'w1',
    workflowKey: 'k1',
    tenantId: 't1',
    payload: {},
    status: 'running' as const,
    detail: 'started',
    providerReadiness: 'READY' as const,
  };
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [workflow],
    auditEvents: [],
    readiness: 'READY',
  };

  const noPermResult = capability.getWorkflows(state, 't1', []);
  assert.equal(noPermResult.kind, 'failure');
  assert.equal(noPermResult.error.kind, 'CROSS_TENANT_ACCESS');

  const tenantReadResult = capability.getWorkflows(state, 't1', ['tenant.workflow.read']);
  assert.equal(tenantReadResult.kind, 'success');
  assert.equal(tenantReadResult.value.length, 1);

  const platformReadResult = capability.getWorkflows(state, 't1', ['platform.workflow.read']);
  assert.equal(platformReadResult.kind, 'success');
  assert.equal(platformReadResult.value.length, 1);

  const noWritePermResult = capability.startWorkflow(
    state,
    'w2',
    'k2',
    't1',
    {},
    [],
    () => null
  );
  assert.equal(noWritePermResult.kind, 'failure');
  assert.equal(noWritePermResult.error.kind, 'CROSS_TENANT_ACCESS');

  const crossTenantResult = capability.getWorkflow(state, 'w1', 't2', ['tenant.workflow.read']);
  assert.equal(crossTenantResult.kind, 'failure');
  assert.equal(crossTenantResult.error.kind, 'CROSS_TENANT_ACCESS');

  const platformReadWorkflowResult = capability.getWorkflow(state, 'w1', 't2', ['platform.workflow.read']);
  assert.equal(platformReadWorkflowResult.kind, 'success');
  assert.equal(platformReadWorkflowResult.value?.workflowId, 'w1');
});

test("workflowenginescheduledjobsapprovalsproof", () => {
  assert.deepEqual(capability.WorkflowEngineScheduledJobsApprovalsWorkflowStatus, [
    'running',
    'waiting',
    'completed',
    'failed',
    'cancelled',
  ]);
  assert.deepEqual(capability.WorkflowEngineScheduledJobsApprovalsAuditEventKind, [
    'workflow.started',
    'workflow.approved',
    'workflow.external_run',
    'workflow.completed',
    'support-session',
  ]);
});

test("workflowenginescheduledjobsapprovalsreadinessmodel", () => {
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'READY',
  };

  const getReadinessResult = capability.getWorkflowReadiness(state);
  assert.equal(getReadinessResult.kind, 'success');
  assert.equal(getReadinessResult.value, 'READY');

  const degradedState = capability.setReadiness(state, 'DEGRADED');
  assert.equal(degradedState.readiness, 'DEGRADED');

  const startResult = capability.startWorkflow(
    degradedState,
    'w1',
    'k1',
    't1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startResult.kind, 'failure');
  assert.equal(startResult.error.kind, 'READINESS_DEGRADED');
});

test("workflowenginescheduledjobsapprovalsstatemodel", () => {
  const workflow: capability.WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId: 'w1',
    workflowKey: 'k1',
    tenantId: 't1',
    payload: {},
    status: 'running',
    detail: 'started',
    providerReadiness: 'READY',
  };

  assert.equal(workflow.workflowId, 'w1');
  assert.equal(workflow.workflowKey, 'k1');
  assert.equal(workflow.tenantId, 't1');
  assert.equal(workflow.status, 'running');
  assert.equal(workflow.detail, 'started');
  assert.equal(workflow.providerReadiness, 'READY');

  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [workflow],
    auditEvents: [],
    readiness: 'READY',
  };

  assert.equal(capability.canAccess('w1', 't1', state), true);
  assert.equal(capability.canAccess('w1', 't2', state), false);
});

test("workflowenginescheduledjobsapprovalsvalidation", () => {
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'READY',
  };

  const invalidStartResult = capability.startWorkflow(
    state,
    '',
    'k1',
    't1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(invalidStartResult.kind, 'failure');
  assert.equal(invalidStartResult.error.kind, 'INVALID_WORKFLOW_ID');

  const workflow = {
    workflowId: 'w1',
    workflowKey: 'k1',
    tenantId: 't1',
    payload: {},
    status: 'running' as const,
    detail: 'started',
    providerReadiness: 'READY' as const,
  };
  const workflowState = capability.addWorkflow(state, workflow);

  const invalidSignalResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'invalid.signal' as capability.WorkflowEngineScheduledJobsApprovalsSignal,
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(invalidSignalResult.kind, 'failure');
  assert.equal(invalidSignalResult.error.kind, 'INVALID_WORKFLOW_ID');

  const deniedResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'approval.denied',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(deniedResult.kind, 'success');
  assert.equal(deniedResult.value.status, 'failed');

  const unknownWorkflowResult = capability.getWorkflow(workflowState, 'unknown', 't1', ['tenant.workflow.read']);
  assert.equal(unknownWorkflowResult.kind, 'failure');
  assert.equal(unknownWorkflowResult.error.kind, 'UNKNOWN_WORKFLOW');
});