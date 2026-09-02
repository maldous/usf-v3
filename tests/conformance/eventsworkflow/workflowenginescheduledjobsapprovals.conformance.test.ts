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

  const workflow: capability.WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId: 'w1',
    workflowKey: 'k1',
    tenantId: 't1',
    payload: {},
    status: 'running',
    detail: 'started',
    providerReadiness: 'READY',
  };

  const runningState = capability.addWorkflow(state, workflow);
  const reqResult = capability.signalWorkflow(
    runningState,
    'w1',
    'approval.requested',
    't1',
    ['platform.workflow.write'],
    auditFn
  );
  assert.equal(reqResult.kind, 'success');
  if (reqResult.kind === 'success') {
    assert.equal(reqResult.value.status, 'waiting');
  }

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].kind, 'workflow.started');

  const waitingState = capability.updateWorkflow(runningState, 'w1', (w) => ({ ...w, status: 'waiting' }));
  const grantResult = capability.signalWorkflow(
    waitingState,
    'w1',
    'approval.granted',
    't1',
    ['platform.workflow.write'],
    auditFn
  );
  assert.equal(grantResult.kind, 'success');
  if (grantResult.kind === 'success') {
    assert.equal(grantResult.value.status, 'completed');
  }

  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[1].kind, 'workflow.approved');
  assert.equal(auditEvents[2].kind, 'support-session');
  assert.equal(auditEvents[2].detail, 'Access granted via approval');

  const failingAuditFn = (_event: capability.WorkflowEngineScheduledJobsApprovalsAuditEvent): capability.WorkflowEngineScheduledJobsApprovalsError | null => {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Audit logging failed',
    };
  };

  const failAuditResult = capability.signalWorkflow(
    waitingState,
    'w1',
    'approval.denied',
    't1',
    ['platform.workflow.write'],
    failingAuditFn
  );
  assert.equal(failAuditResult.kind, 'failure');
  if (failAuditResult.kind === 'failure') {
    assert.equal(failAuditResult.error.kind, 'PROVIDER_UNAVAILABLE');
  }
});

test("workflowenginescheduledjobsapprovalscontracts", () => {
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = capability.setReadiness(capability.initialState, 'READY');

  const getWorkflowsResult = capability.getWorkflows(state, 't1', ['tenant.workflow.read']);
  assert.equal(getWorkflowsResult.kind, 'success');
  if (getWorkflowsResult.kind === 'success') {
    assert.deepEqual(getWorkflowsResult.value, []);
  }

  const getReadinessResult = capability.getWorkflowReadiness(state);
  assert.equal(getReadinessResult.kind, 'success');
  if (getReadinessResult.kind === 'success') {
    assert.equal(getReadinessResult.value, 'READY');
  }

  const startResult = capability.startWorkflow(
    state,
    'w1',
    'k1',
    't1',
    { job: 'nightly' },
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startResult.kind, 'success');
  if (startResult.kind === 'success') {
    assert.equal(startResult.value.status, 'running');
    assert.equal(startResult.value.workflowId, 'w1');
  }

  let workflowState = capability.addWorkflow(state, (startResult as capability.WorkflowEngineScheduledJobsApprovalsResult<capability.WorkflowEngineScheduledJobsApprovalsWorkflow>).value);

  const getWorkflowResult = capability.getWorkflow(workflowState, 'w1', 't1', ['tenant.workflow.read']);
  assert.equal(getWorkflowResult.kind, 'success');
  if (getWorkflowResult.kind === 'success') {
    assert.equal(getWorkflowResult.value?.workflowId, 'w1');
  }

  const signalResult = capability.signalWorkflow(
    workflowState,
    'w1',
    'approval.requested',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(signalResult.kind, 'success');
  if (signalResult.kind === 'success') {
    assert.equal(signalResult.value.status, 'waiting');
    workflowState = capability.updateWorkflow(workflowState, 'w1', () => signalResult.value);
  }

  const cancelResult = capability.cancelWorkflow(
    workflowState,
    'w1',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(cancelResult.kind, 'success');
  if (cancelResult.kind === 'success') {
    assert.equal(cancelResult.value.status, 'cancelled');
  }
});

test("workflowenginescheduledjobsapprovalserrormodel", () => {
  const degradedState: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'DEGRADED',
  };

  const startDegradedResult = capability.startWorkflow(
    degradedState,
    'w1',
    'k1',
    't1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startDegradedResult.kind, 'failure');
  if (startDegradedResult.kind === 'failure') {
    assert.equal(startDegradedResult.error.kind, 'READINESS_DEGRADED');
  }

  const unknownWorkflowResult = capability.getWorkflow(degradedState, 'unknown-id', 't1', ['tenant.workflow.read']);
  assert.equal(unknownWorkflowResult.kind, 'failure');
  if (unknownWorkflowResult.kind === 'failure') {
    assert.equal(unknownWorkflowResult.error.kind, 'UNKNOWN_WORKFLOW');
  }

  const workflow: capability.WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId: 'w1',
    workflowKey: 'k1',
    tenantId: 't1',
    payload: {},
    status: 'waiting',
    detail: 'waiting for approval',
    providerReadiness: 'READY',
  };
  const readyState = capability.setReadiness(capability.addWorkflow(degradedState, workflow), 'READY');

  const deniedResult = capability.signalWorkflow(
    readyState,
    'w1',
    'approval.denied',
    't1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(deniedResult.kind, 'success');
  if (deniedResult.kind === 'success') {
    assert.equal(deniedResult.value.status, 'failed');
  }

  const crossTenantResult = capability.getWorkflow(readyState, 'w1', 't2', ['tenant.workflow.read']);
  assert.equal(crossTenantResult.kind, 'failure');
  if (crossTenantResult.kind === 'failure') {
    assert.equal(crossTenantResult.error.kind, 'CROSS_TENANT_ACCESS');
  }
});

test("workflowenginescheduledjobsapprovalslifecycle", () => {
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [],
    auditEvents: [],
    readiness: 'READY',
  };

  const startRes = capability.startWorkflow(
    state,
    'wf-lifecycle',
    'key-1',
    'tenant-a',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startRes.kind, 'success');
  if (startRes.kind === 'success') {
    assert.equal(startRes.value.status, 'running');
  }

  let currentState = capability.addWorkflow(state, (startRes as capability.WorkflowEngineScheduledJobsApprovalsResult<capability.WorkflowEngineScheduledJobsApprovalsWorkflow>).value);

  const reqRes = capability.signalWorkflow(
    currentState,
    'wf-lifecycle',
    'approval.requested',
    'tenant-a',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(reqRes.kind, 'success');
  if (reqRes.kind === 'success') {
    assert.equal(reqRes.value.status, 'waiting');
    currentState = capability.updateWorkflow(currentState, 'wf-lifecycle', () => reqRes.value);
  }

  const grantRes = capability.signalWorkflow(
    currentState,
    'wf-lifecycle',
    'approval.granted',
    'tenant-a',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(grantRes.kind, 'success');
  if (grantRes.kind === 'success') {
    assert.equal(grantRes.value.status, 'completed');
  }

  const waitingWorkflow: capability.WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId: 'wf-deny',
    workflowKey: 'key-2',
    tenantId: 'tenant-a',
    payload: {},
    status: 'waiting',
    detail: 'waiting',
    providerReadiness: 'READY',
  };
  const denyState = capability.addWorkflow(currentState, waitingWorkflow);
  const denyRes = capability.signalWorkflow(
    denyState,
    'wf-deny',
    'approval.denied',
    'tenant-a',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(denyRes.kind, 'success');
  if (denyRes.kind === 'success') {
    assert.equal(denyRes.value.status, 'failed');
  }

  const cancelRes = capability.cancelWorkflow(
    denyState,
    'wf-deny',
    'tenant-a',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(cancelRes.kind, 'success');
  if (cancelRes.kind === 'success') {
    assert.equal(cancelRes.value.status, 'cancelled');
  }
});

test("workflowenginescheduledjobsapprovalspermissions", () => {
  const workflow: capability.WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId: 'wf-perm',
    workflowKey: 'key-perm',
    tenantId: 'tenant-1',
    payload: {},
    status: 'running',
    detail: 'running',
    providerReadiness: 'READY',
  };
  const state: capability.WorkflowEngineScheduledJobsApprovalsState = {
    workflows: [workflow],
    auditEvents: [],
    readiness: 'READY',
  };

  const noPermList = capability.getWorkflows(state, 'tenant-1', []);
  assert.equal(noPermList.kind, 'failure');
  if (noPermList.kind === 'failure') {
    assert.equal(noPermList.error.kind, 'CROSS_TENANT_ACCESS');
  }

  const tenantReadList = capability.getWorkflows(state, 'tenant-1', ['tenant.workflow.read']);
  assert.equal(tenantReadList.kind, 'success');
  if (tenantReadList.kind === 'success') {
    assert.equal(tenantReadList.value.length, 1);
  }

  const platformReadList = capability.getWorkflows(state, 'other-tenant', ['platform.workflow.read']);
  assert.equal(platformReadList.kind, 'success');
  if (platformReadList.kind === 'success') {
    assert.equal(platformReadList.value.length, 1);
  }

  const noWriteStart = capability.startWorkflow(
    state,
    'wf-new',
    'key-new',
    'tenant-1',
    {},
    ['tenant.workflow.read'],
    () => null
  );
  assert.equal(noWriteStart.kind, 'failure');
  if (noWriteStart.kind === 'failure') {
    assert.equal(noWriteStart.error.kind, 'CROSS_TENANT_ACCESS');
  }

  const crossTenantGet = capability.getWorkflow(state, 'wf-perm', 'tenant-2', ['tenant.workflow.read']);
  assert.equal(crossTenantGet.kind, 'failure');
  if (crossTenantGet.kind === 'failure') {
    assert.equal(crossTenantGet.error.kind, 'CROSS_TENANT_ACCESS');
  }

  const platformGet = capability.getWorkflow(state, 'wf-perm', 'tenant-2', ['platform.workflow.read']);
  assert.equal(platformGet.kind, 'success');
  if (platformGet.kind === 'success') {
    assert.equal(platformGet.value?.workflowId, 'wf-perm');
  }
});

test("workflowenginescheduledjobsapprovalsproof", () => {
  const state = capability.initialState;
  const readinessRes = capability.getWorkflowReadiness(state);
  assert.equal(readinessRes.kind, 'success');
  if (readinessRes.kind === 'success') {
    assert.equal(readinessRes.value, 'NOT_READY');
  }

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
  assert.deepEqual(capability.WorkflowEngineScheduledJobsApprovalsSignal, [
    'approval.requested',
    'approval.granted',
    'approval.denied',
  ]);
  assert.deepEqual(capability.WorkflowEngineScheduledJobsApprovalsErrorKind, [
    'UNKNOWN_WORKFLOW',
    'INVALID_WORKFLOW_ID',
    'PROVIDER_UNAVAILABLE',
    'APPROVAL_DENIED',
    'CROSS_TENANT_ACCESS',
    'READINESS_DEGRADED',
  ]);
});

test("workflowenginescheduledjobsapprovalsreadinessmodel", () => {
  const notReadyState = capability.initialState;
  const notReadyRes = capability.getWorkflowReadiness(notReadyState);
  assert.equal(notReadyRes.kind, 'success');
  if (notReadyRes.kind === 'success') {
    assert.equal(notReadyRes.value, 'NOT_READY');
  }

  const degradedState = capability.setReadiness(notReadyState, 'DEGRADED');
  const degradedRes = capability.getWorkflowReadiness(degradedState);
  assert.equal(degradedRes.kind, 'success');
  if (degradedRes.kind === 'success') {
    assert.equal(degradedRes.value, 'DEGRADED');
  }

  const startDegraded = capability.startWorkflow(
    degradedState,
    'wf-1',
    'key-1',
    'tenant-1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startDegraded.kind, 'failure');
  if (startDegraded.kind === 'failure') {
    assert.equal(startDegraded.error.kind, 'READINESS_DEGRADED');
  }

  const readyState = capability.setReadiness(degradedState, 'READY');
  const readyRes = capability.getWorkflowReadiness(readyState);
  assert.equal(readyRes.kind, 'success');
  if (readyRes.kind === 'success') {
    assert.equal(readyRes.value, 'READY');
  }

  const startReady = capability.startWorkflow(
    readyState,
    'wf-1',
    'key-1',
    'tenant-1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(startReady.kind, 'success');
});

test("workflowenginescheduledjobsapprovalsstatemodel", () => {
  const workflow: capability.WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId: 'wf-state-1',
    workflowKey: 'key-state',
    tenantId: 'tenant-owner',
    payload: { config: 'test' },
    status: 'running',
    detail: 'running detail',
    providerReadiness: 'READY',
  };

  const baseState = capability.setReadiness(capability.initialState, 'READY');
  const stateWithWorkflow = capability.addWorkflow(baseState, workflow);

  const ownerAccess = capability.getWorkflow(stateWithWorkflow, 'wf-state-1', 'tenant-owner', ['tenant.workflow.read']);
  assert.equal(ownerAccess.kind, 'success');
  if (ownerAccess.kind === 'success') {
    assert.equal(ownerAccess.value?.workflowId, 'wf-state-1');
    assert.equal(ownerAccess.value?.tenantId, 'tenant-owner');
    assert.equal(ownerAccess.value?.status, 'running');
    assert.equal(ownerAccess.value?.detail, 'running detail');
    assert.equal(ownerAccess.value?.providerReadiness, 'READY');
  }

  const crossTenantAccess = capability.getWorkflow(stateWithWorkflow, 'wf-state-1', 'other-tenant', ['tenant.workflow.read']);
  assert.equal(crossTenantAccess.kind, 'failure');
  if (crossTenantAccess.kind === 'failure') {
    assert.equal(crossTenantAccess.error.kind, 'CROSS_TENANT_ACCESS');
  }

  const updatedState = capability.updateWorkflow(stateWithWorkflow, 'wf-state-1', (w) => ({
    ...w,
    status: 'completed',
    detail: 'completed detail',
  }));
  const updatedAccess = capability.getWorkflow(updatedState, 'wf-state-1', 'tenant-owner', ['tenant.workflow.read']);
  assert.equal(updatedAccess.kind, 'success');
  if (updatedAccess.kind === 'success') {
    assert.equal(updatedAccess.value?.status, 'completed');
    assert.equal(updatedAccess.value?.detail, 'completed detail');
  }

  const auditEvent: capability.WorkflowEngineScheduledJobsApprovalsAuditEvent = {
    kind: 'workflow.external_run',
    workflowId: 'wf-state-1',
    tenantId: 'tenant-owner',
    timestamp: '2026-09-02T00:00:00.000Z',
    detail: 'external dispatch',
  };
  const auditState = capability.addAuditEvent(updatedState, auditEvent);
  assert.equal(auditState.auditEvents.length, 1);
  assert.equal(auditState.auditEvents[0].kind, 'workflow.external_run');
});

test("workflowenginescheduledjobsapprovalsvalidation", () => {
  const readyState = capability.setReadiness(capability.initialState, 'READY');

  const emptyIdRes = capability.startWorkflow(
    readyState,
    '',
    'key-1',
    'tenant-1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(emptyIdRes.kind, 'failure');
  if (emptyIdRes.kind === 'failure') {
    assert.equal(emptyIdRes.error.kind, 'INVALID_WORKFLOW_ID');
  }

  const emptyKeyRes = capability.startWorkflow(
    readyState,
    'wf-1',
    '',
    'tenant-1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(emptyKeyRes.kind, 'failure');
  if (emptyKeyRes.kind === 'failure') {
    assert.equal(emptyKeyRes.error.kind, 'INVALID_WORKFLOW_ID');
  }

  const emptyTenantRes = capability.startWorkflow(
    readyState,
    'wf-1',
    'key-1',
    '',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(emptyTenantRes.kind, 'failure');
  if (emptyTenantRes.kind === 'failure') {
    assert.equal(emptyTenantRes.error.kind, 'INVALID_WORKFLOW_ID');
  }

  const workflow: capability.WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId: 'wf-valid',
    workflowKey: 'key-1',
    tenantId: 'tenant-1',
    payload: {},
    status: 'running',
    detail: 'running',
    providerReadiness: 'READY',
  };
  const workflowState = capability.addWorkflow(readyState, workflow);

  const duplicateStartRes = capability.startWorkflow(
    workflowState,
    'wf-valid',
    'key-1',
    'tenant-1',
    {},
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(duplicateStartRes.kind, 'failure');
  if (duplicateStartRes.kind === 'failure') {
    assert.equal(duplicateStartRes.error.kind, 'UNKNOWN_WORKFLOW');
  }

  const invalidSignalRes = capability.signalWorkflow(
    workflowState,
    'wf-valid',
    'unknown.signal' as capability.WorkflowEngineScheduledJobsApprovalsSignal,
    'tenant-1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(invalidSignalRes.kind, 'failure');
  if (invalidSignalRes.kind === 'failure') {
    assert.equal(invalidSignalRes.error.kind, 'INVALID_WORKFLOW_ID');
  }

  const unknownSignalRes = capability.signalWorkflow(
    workflowState,
    'non-existent',
    'approval.requested',
    'tenant-1',
    ['platform.workflow.write'],
    () => null
  );
  assert.equal(unknownSignalRes.kind, 'failure');
  if (unknownSignalRes.kind === 'failure') {
    assert.equal(unknownSignalRes.error.kind, 'UNKNOWN_WORKFLOW');
  }

  const unknownGetRes = capability.getWorkflow(
    workflowState,
    'non-existent',
    'tenant-1',
    ['tenant.workflow.read']
  );
  assert.equal(unknownGetRes.kind, 'failure');
  if (unknownGetRes.kind === 'failure') {
    assert.equal(unknownGetRes.error.kind, 'UNKNOWN_WORKFLOW');
  }
});