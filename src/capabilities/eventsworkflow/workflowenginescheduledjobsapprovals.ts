export const WorkflowEngineScheduledJobsApprovalsWorkflowStatus = [
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const;
export type WorkflowEngineScheduledJobsApprovalsWorkflowStatus = typeof WorkflowEngineScheduledJobsApprovalsWorkflowStatus[number];

export const WorkflowEngineScheduledJobsApprovalsAuditEventKind = [
  'workflow.started',
  'workflow.approved',
  'workflow.external_run',
  'workflow.completed',
  'support-session',
] as const;
export type WorkflowEngineScheduledJobsApprovalsAuditEventKind = typeof WorkflowEngineScheduledJobsApprovalsAuditEventKind[number];

export const WorkflowEngineScheduledJobsApprovalsSignal = [
  'approval.requested',
  'approval.granted',
  'approval.denied',
] as const;
export type WorkflowEngineScheduledJobsApprovalsSignal = typeof WorkflowEngineScheduledJobsApprovalsSignal[number];

export const WorkflowEngineScheduledJobsApprovalsErrorKind = [
  'UNKNOWN_WORKFLOW',
  'INVALID_WORKFLOW_ID',
  'PROVIDER_UNAVAILABLE',
  'APPROVAL_DENIED',
  'CROSS_TENANT_ACCESS',
  'READINESS_DEGRADED',
] as const;
export type WorkflowEngineScheduledJobsApprovalsErrorKind = typeof WorkflowEngineScheduledJobsApprovalsErrorKind[number];

export const WorkflowEngineScheduledJobsApprovalsReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type WorkflowEngineScheduledJobsApprovalsReadiness = typeof WorkflowEngineScheduledJobsApprovalsReadiness[number];

export const WorkflowEngineScheduledJobsApprovalsPermission = [
  'platform.workflow.read',
  'platform.workflow.write',
  'tenant.workflow.read',
] as const;
export type WorkflowEngineScheduledJobsApprovalsPermission = typeof WorkflowEngineScheduledJobsApprovalsPermission[number];

export interface WorkflowEngineScheduledJobsApprovalsWorkflow {
  readonly workflowId: string;
  readonly workflowKey: string;
  readonly tenantId: string;
  readonly payload: unknown;
  readonly status: WorkflowEngineScheduledJobsApprovalsWorkflowStatus;
  readonly detail: string;
  readonly providerReadiness: WorkflowEngineScheduledJobsApprovalsReadiness;
}

export interface WorkflowEngineScheduledJobsApprovalsAuditEvent {
  readonly kind: WorkflowEngineScheduledJobsApprovalsAuditEventKind;
  readonly workflowId: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly detail?: string;
}

export interface WorkflowEngineScheduledJobsApprovalsError {
  readonly kind: WorkflowEngineScheduledJobsApprovalsErrorKind;
  readonly message: string;
  readonly workflowId?: string;
}

export interface WorkflowEngineScheduledJobsApprovalsState {
  readonly workflows: readonly WorkflowEngineScheduledJobsApprovalsWorkflow[];
  readonly auditEvents: readonly WorkflowEngineScheduledJobsApprovalsAuditEvent[];
  readonly readiness: WorkflowEngineScheduledJobsApprovalsReadiness;
}

export interface WorkflowEngineScheduledJobsApprovalsResult<T> {
  readonly kind: 'success';
  readonly value: T;
}

export interface WorkflowEngineScheduledJobsApprovalsFailure {
  readonly kind: 'failure';
  readonly error: WorkflowEngineScheduledJobsApprovalsError;
}

export type WorkflowEngineScheduledJobsApprovalsResponse<T> =
  | WorkflowEngineScheduledJobsApprovalsResult<T>
  | WorkflowEngineScheduledJobsApprovalsFailure;

export const initialState: WorkflowEngineScheduledJobsApprovalsState = {
  workflows: [],
  auditEvents: [],
  readiness: 'NOT_READY',
};

function canAccess(workflowId: string, tenantId: string, state: WorkflowEngineScheduledJobsApprovalsState): boolean {
  const workflow = state.workflows.find((w) => w.workflowId === workflowId);
  return workflow !== undefined && workflow.tenantId === tenantId;
}

function hasPermission(requiredPermission: WorkflowEngineScheduledJobsApprovalsPermission, permissions: readonly string[]): boolean {
  return permissions.includes(requiredPermission);
}

function emitAudit(
  kind: WorkflowEngineScheduledJobsApprovalsAuditEventKind,
  workflowId: string,
  tenantId: string,
  detail?: string,
): WorkflowEngineScheduledJobsApprovalsAuditEvent {
  return {
    kind,
    workflowId,
    tenantId,
    timestamp: new Date().toISOString(),
    detail,
  };
}

function findWorkflow(workflowId: string, state: WorkflowEngineScheduledJobsApprovalsState): WorkflowEngineScheduledJobsApprovalsWorkflow | null {
  return state.workflows.find((w) => w.workflowId === workflowId) ?? null;
}

function validateWorkflowId(workflowId: string): boolean {
  return workflowId.length > 0;
}

function validateWorkflowKey(workflowKey: string): boolean {
  return workflowKey.length > 0;
}

function validateTenantId(tenantId: string): boolean {
  return tenantId.length > 0;
}

function transitionWorkflow(
  workflow: WorkflowEngineScheduledJobsApprovalsWorkflow,
  signal: WorkflowEngineScheduledJobsApprovalsSignal,
  auditFn: (event: WorkflowEngineScheduledJobsApprovalsAuditEvent) => WorkflowEngineScheduledJobsApprovalsError | null,
): WorkflowEngineScheduledJobsApprovalsResponse<WorkflowEngineScheduledJobsApprovalsWorkflow> {
  const now = new Date().toISOString();
  switch (signal) {
    case 'approval.requested':
      if (workflow.status !== 'running') {
        return {
          kind: 'failure',
          error: {
            kind: 'INVALID_WORKFLOW_ID',
            message: `Workflow ${workflow.workflowId} is not in running state`,
            workflowId: workflow.workflowId,
          },
        };
      }
      const beforeAudit = emitAudit('workflow.started', workflow.workflowId, workflow.tenantId);
      const auditError = auditFn(beforeAudit);
      if (auditError !== null) {
        return { kind: 'failure', error: auditError };
      }
      return {
        kind: 'success',
        value: {
          ...workflow,
          status: 'waiting',
          detail: `Approval requested at ${now}`,
        },
      };
    case 'approval.granted':
      if (workflow.status !== 'waiting') {
        return {
          kind: 'failure',
          error: {
            kind: 'INVALID_WORKFLOW_ID',
            message: `Workflow ${workflow.workflowId} is not in waiting state`,
            workflowId: workflow.workflowId,
          },
        };
      }
      const grantedAudit = emitAudit('workflow.approved', workflow.workflowId, workflow.tenantId);
      const grantedAuditError = auditFn(grantedAudit);
      if (grantedAuditError !== null) {
        return { kind: 'failure', error: grantedAuditError };
      }
      const supportSessionAudit = emitAudit('support-session', workflow.workflowId, workflow.tenantId, 'Access granted via approval');
      const supportAuditError = auditFn(supportSessionAudit);
      if (supportAuditError !== null) {
        return { kind: 'failure', error: supportAuditError };
      }
      return {
        kind: 'success',
        value: {
          ...workflow,
          status: 'completed',
          detail: `Approval granted at ${now}`,
        },
      };
    case 'approval.denied':
      if (workflow.status !== 'waiting') {
        return {
          kind: 'failure',
          error: {
            kind: 'INVALID_WORKFLOW_ID',
            message: `Workflow ${workflow.workflowId} is not in waiting state`,
            workflowId: workflow.workflowId,
          },
        };
      }
      const deniedAudit = emitAudit('workflow.completed', workflow.workflowId, workflow.tenantId);
      const deniedAuditError = auditFn(deniedAudit);
      if (deniedAuditError !== null) {
        return { kind: 'failure', error: deniedAuditError };
      }
      return {
        kind: 'success',
        value: {
          ...workflow,
          status: 'failed',
          detail: `Approval denied at ${now}`,
        },
      };
    default:
      return {
        kind: 'failure',
        error: {
          kind: 'INVALID_WORKFLOW_ID',
          message: `Unknown signal ${signal} for workflow ${workflow.workflowId}`,
          workflowId: workflow.workflowId,
        },
      };
  }
}

export function getWorkflows(
  state: WorkflowEngineScheduledJobsApprovalsState,
  tenantId: string,
  permissions: readonly string[],
): WorkflowEngineScheduledJobsApprovalsResponse<readonly WorkflowEngineScheduledJobsApprovalsWorkflow[]> {
  if (!hasPermission('tenant.workflow.read', permissions) && !hasPermission('platform.workflow.read', permissions)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: 'Insufficient permissions to read workflows',
      },
    };
  }
  const accessibleWorkflows = state.workflows.filter((w) => hasPermission('platform.workflow.read', permissions) || w.tenantId === tenantId);
  return {
    kind: 'success',
    value: accessibleWorkflows,
  };
}

export function getWorkflowReadiness(
  state: WorkflowEngineScheduledJobsApprovalsState,
): WorkflowEngineScheduledJobsApprovalsResponse<WorkflowEngineScheduledJobsApprovalsReadiness> {
  return {
    kind: 'success',
    value: state.readiness,
  };
}

export function startWorkflow(
  state: WorkflowEngineScheduledJobsApprovalsState,
  workflowId: string,
  workflowKey: string,
  tenantId: string,
  payload: unknown,
  permissions: readonly string[],
  auditFn: (event: WorkflowEngineScheduledJobsApprovalsAuditEvent) => WorkflowEngineScheduledJobsApprovalsError | null,
): WorkflowEngineScheduledJobsApprovalsResponse<WorkflowEngineScheduledJobsApprovalsWorkflow> {
  if (!hasPermission('platform.workflow.write', permissions)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: 'Insufficient permissions to start workflow',
      },
    };
  }
  if (!validateWorkflowId(workflowId) || !validateWorkflowKey(workflowKey) || !validateTenantId(tenantId)) {
    return {
      kind: 'failure',
      error: {
        kind: 'INVALID_WORKFLOW_ID',
        message: 'Invalid workflow parameters',
      },
    };
  }
  if (state.readiness !== 'READY') {
    return {
      kind: 'failure',
      error: {
        kind: 'READINESS_DEGRADED',
        message: 'Provider not ready',
      },
    };
  }
  const existingWorkflow = findWorkflow(workflowId, state);
  if (existingWorkflow !== null) {
    return {
      kind: 'failure',
      error: {
        kind: 'UNKNOWN_WORKFLOW',
        message: `Workflow ${workflowId} already exists`,
        workflowId,
      },
    };
  }
  const now = new Date().toISOString();
  const auditEvent = emitAudit('workflow.started', workflowId, tenantId);
  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return { kind: 'failure', error: auditError };
  }
  const newWorkflow: WorkflowEngineScheduledJobsApprovalsWorkflow = {
    workflowId,
    workflowKey,
    tenantId,
    payload,
    status: 'running',
    detail: `Started at ${now}`,
    providerReadiness: state.readiness,
  };
  return {
    kind: 'success',
    value: newWorkflow,
  };
}

export function signalWorkflow(
  state: WorkflowEngineScheduledJobsApprovalsState,
  workflowId: string,
  signal: WorkflowEngineScheduledJobsApprovalsSignal,
  tenantId: string,
  permissions: readonly string[],
  auditFn: (event: WorkflowEngineScheduledJobsApprovalsAuditEvent) => WorkflowEngineScheduledJobsApprovalsError | null,
): WorkflowEngineScheduledJobsApprovalsResponse<WorkflowEngineScheduledJobsApprovalsWorkflow> {
  if (!hasPermission('platform.workflow.write', permissions)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: 'Insufficient permissions to signal workflow',
      },
    };
  }
  const workflow = findWorkflow(workflowId, state);
  if (workflow === null) {
    return {
      kind: 'failure',
      error: {
        kind: 'UNKNOWN_WORKFLOW',
        message: `Workflow ${workflowId} not found`,
        workflowId,
      },
    };
  }
  if (!canAccess(workflowId, tenantId, state)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: `Cross-tenant access denied for workflow ${workflowId}`,
        workflowId,
      },
    };
  }
  if (state.readiness !== 'READY') {
    return {
      kind: 'failure',
      error: {
        kind: 'READINESS_DEGRADED',
        message: 'Provider not ready',
      },
    };
  }
  return transitionWorkflow(workflow, signal, auditFn);
}

export function cancelWorkflow(
  state: WorkflowEngineScheduledJobsApprovalsState,
  workflowId: string,
  tenantId: string,
  permissions: readonly string[],
  auditFn: (event: WorkflowEngineScheduledJobsApprovalsAuditEvent) => WorkflowEngineScheduledJobsApprovalsError | null,
): WorkflowEngineScheduledJobsApprovalsResponse<WorkflowEngineScheduledJobsApprovalsWorkflow> {
  if (!hasPermission('platform.workflow.write', permissions)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: 'Insufficient permissions to cancel workflow',
      },
    };
  }
  const workflow = findWorkflow(workflowId, state);
  if (workflow === null) {
    return {
      kind: 'failure',
      error: {
        kind: 'UNKNOWN_WORKFLOW',
        message: `Workflow ${workflowId} not found`,
        workflowId,
      },
    };
  }
  if (!canAccess(workflowId, tenantId, state)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: `Cross-tenant access denied for workflow ${workflowId}`,
        workflowId,
      },
    };
  }
  if (state.readiness !== 'READY') {
    return {
      kind: 'failure',
      error: {
        kind: 'READINESS_DEGRADED',
        message: 'Provider not ready',
      },
    };
  }
  const now = new Date().toISOString();
  const auditEvent = emitAudit('workflow.completed', workflowId, tenantId, 'Cancelled');
  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return { kind: 'failure', error: auditError };
  }
  return {
    kind: 'success',
    value: {
      ...workflow,
      status: 'cancelled',
      detail: `Cancelled at ${now}`,
    },
  };
}

export function getWorkflow(
  state: WorkflowEngineScheduledJobsApprovalsState,
  workflowId: string,
  tenantId: string,
  permissions: readonly string[],
): WorkflowEngineScheduledJobsApprovalsResponse<WorkflowEngineScheduledJobsApprovalsWorkflow | null> {
  if (!hasPermission('tenant.workflow.read', permissions) && !hasPermission('platform.workflow.read', permissions)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: 'Insufficient permissions to read workflow',
      },
    };
  }
  const workflow = findWorkflow(workflowId, state);
  if (workflow === null) {
    return {
      kind: 'failure',
      error: {
        kind: 'UNKNOWN_WORKFLOW',
        message: `Workflow ${workflowId} not found`,
        workflowId,
      },
    };
  }
  if (!canAccess(workflowId, tenantId, state) && !hasPermission('platform.workflow.read', permissions)) {
    return {
      kind: 'failure',
      error: {
        kind: 'CROSS_TENANT_ACCESS',
        message: `Cross-tenant access denied for workflow ${workflowId}`,
        workflowId,
      },
    };
  }
  return {
    kind: 'success',
    value: workflow,
  };
}

export function setReadiness(
  state: WorkflowEngineScheduledJobsApprovalsState,
  readiness: WorkflowEngineScheduledJobsApprovalsReadiness,
): WorkflowEngineScheduledJobsApprovalsState {
  return {
    ...state,
    readiness,
  };
}

export function addWorkflow(
  state: WorkflowEngineScheduledJobsApprovalsState,
  workflow: WorkflowEngineScheduledJobsApprovalsWorkflow,
): WorkflowEngineScheduledJobsApprovalsState {
  return {
    ...state,
    workflows: [...state.workflows, workflow],
  };
}

export function updateWorkflow(
  state: WorkflowEngineScheduledJobsApprovalsState,
  workflowId: string,
  updateFn: (workflow: WorkflowEngineScheduledJobsApprovalsWorkflow) => WorkflowEngineScheduledJobsApprovalsWorkflow,
): WorkflowEngineScheduledJobsApprovalsState {
  const workflows = state.workflows.map((w) => (w.workflowId === workflowId ? updateFn(w) : w));
  return {
    ...state,
    workflows,
  };
}

export function addAuditEvent(
  state: WorkflowEngineScheduledJobsApprovalsState,
  event: WorkflowEngineScheduledJobsApprovalsAuditEvent,
): WorkflowEngineScheduledJobsApprovalsState {
  return {
    ...state,
    auditEvents: [...state.auditEvents, event],
  };
}