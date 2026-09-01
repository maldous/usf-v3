export const SupportModeBreakGlassAccessDecision = [
  'APPROVED',
  'DENIED',
  'FORBIDDEN',
  'REASON_REQUIRED',
  'INVALID_TARGET',
  'WRONG_TENANT_FQDN',
  'AUDIT_FAILURE',
] as const;
export type SupportModeBreakGlassAccessDecision = typeof SupportModeBreakGlassAccessDecision[number];

export const SupportModeBreakGlassAccessAuditEventKind = [
  'SUPPORT_SESSION_CREATED',
  'APPROVAL_REQUESTED',
] as const;
export type SupportModeBreakGlassAccessAuditEventKind = typeof SupportModeBreakGlassAccessAuditEventKind[number];

export const SupportModeBreakGlassAccessErrorKind = [
  'FORBIDDEN',
  'REASON_REQUIRED',
  'INVALID_TARGET',
  'WRONG_TENANT_FQDN',
  'AUDIT_BACKEND_FAILURE',
] as const;
export type SupportModeBreakGlassAccessErrorKind = typeof SupportModeBreakGlassAccessErrorKind[number];

export const SupportModeBreakGlassAccessReadiness = ['READY', 'DEGRADED'] as const;
export type SupportModeBreakGlassAccessReadiness = typeof SupportModeBreakGlassAccessReadiness[number];

export const SupportModeBreakGlassAccessWorkflowStatus = [
  'WAITING',
  'APPROVED',
  'COMPLETED',
] as const;
export type SupportModeBreakGlassAccessWorkflowStatus = typeof SupportModeBreakGlassAccessWorkflowStatus[number];

export interface SupportModeBreakGlassAccessAuditEvent {
  readonly kind: SupportModeBreakGlassAccessAuditEventKind;
  readonly workflowId: string;
  readonly requestedState: SupportModeBreakGlassAccessWorkflowStatus;
  readonly targetTenantFqdn: string;
  readonly accessReason: string;
  readonly timestamp: string;
}

export interface SupportModeBreakGlassAccessError {
  readonly kind: SupportModeBreakGlassAccessErrorKind;
  readonly message: string;
}

export interface SupportModeBreakGlassAccessSession {
  readonly id: string;
  readonly targetTenantId: string;
  readonly effectiveOrganisationId: string;
  readonly accessReason: string;
  readonly roles: readonly string[];
  readonly createdAt: string;
  readonly ttlSeconds: number;
  readonly supportMode: boolean;
}

export interface SupportModeBreakGlassAccessWorkflow {
  readonly id: string;
  readonly status: SupportModeBreakGlassAccessWorkflowStatus;
  readonly targetTenantFqdn: string;
  readonly accessReason: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
}

export interface SupportModeBreakGlassAccessState {
  readonly workflows: readonly SupportModeBreakGlassAccessWorkflow[];
  readonly sessions: readonly SupportModeBreakGlassAccessSession[];
  readonly readiness: SupportModeBreakGlassAccessReadiness;
  readonly lastError: SupportModeBreakGlassAccessError | null;
}

export const initialState: SupportModeBreakGlassAccessState = {
  workflows: [],
  sessions: [],
  readiness: 'READY',
  lastError: null,
};

export const SUPPORT_SESSION_TTL_SECONDS = 3600;

export function validateRequest(
  actor: { readonly roles: readonly string[]; readonly effectiveOrganisationId: string | null },
  targetTenantFqdn: string,
  accessReason: string,
): SupportModeBreakGlassAccessDecision {
  if (!actor.roles.includes('system-admin')) {
    return 'FORBIDDEN';
  }
  if (actor.effectiveOrganisationId === null) {
    return 'FORBIDDEN';
  }
  if (accessReason.trim() === '') {
    return 'REASON_REQUIRED';
  }
  if (targetTenantFqdn.trim() === '') {
    return 'INVALID_TARGET';
  }
  if (!targetTenantFqdn.endsWith('.example.com')) {
    return 'WRONG_TENANT_FQDN';
  }
  return 'APPROVED';
}

export function emitApprovalRequestAudit(
  workflowId: string,
  requestedState: SupportModeBreakGlassAccessWorkflowStatus,
  targetTenantFqdn: string,
  accessReason: string,
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessError | null {
  const event: SupportModeBreakGlassAccessAuditEvent = {
    kind: 'APPROVAL_REQUESTED',
    workflowId,
    requestedState,
    targetTenantFqdn,
    accessReason,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function emitSupportSessionCreatedAudit(
  workflowId: string,
  sessionId: string,
  targetTenantFqdn: string,
  accessReason: string,
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessError | null {
  const event: SupportModeBreakGlassAccessAuditEvent = {
    kind: 'SUPPORT_SESSION_CREATED',
    workflowId,
    requestedState: 'COMPLETED',
    targetTenantFqdn,
    accessReason,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function requestSupportAccess(
  state: SupportModeBreakGlassAccessState,
  workflowId: string,
  targetTenantFqdn: string,
  accessReason: string,
  requestedBy: string,
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  const validation = validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: requestedBy },
    targetTenantFqdn,
    accessReason,
  );
  if (validation !== 'APPROVED') {
    return mapDecisionToError(validation);
  }

  const auditError = emitApprovalRequestAudit(
    workflowId,
    'WAITING',
    targetTenantFqdn,
    accessReason,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const newWorkflow: SupportModeBreakGlassAccessWorkflow = {
    id: workflowId,
    status: 'WAITING',
    targetTenantFqdn,
    accessReason,
    requestedBy,
    requestedAt: new Date().toISOString(),
  };

  return {
    ...state,
    workflows: [...state.workflows, newWorkflow],
    lastError: null,
  };
}

export function approveSupportAccess(
  state: SupportModeBreakGlassAccessState,
  workflowId: string,
  targetTenantId: string,
  effectiveOrganisationId: string,
  accessReason: string,
  roles: readonly string[],
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  const workflow = state.workflows.find((w) => w.id === workflowId);
  if (workflow === undefined) {
    return { kind: 'INVALID_TARGET', message: 'Workflow not found' };
  }
  if (workflow.status !== 'WAITING') {
    return { kind: 'INVALID_TARGET', message: 'Workflow not in waiting state' };
  }

  const sessionId = `session-${workflowId}`;
  const auditError = emitSupportSessionCreatedAudit(
    workflowId,
    sessionId,
    workflow.targetTenantFqdn,
    workflow.accessReason,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const newSession: SupportModeBreakGlassAccessSession = {
    id: sessionId,
    targetTenantId,
    effectiveOrganisationId,
    accessReason: workflow.accessReason,
    roles,
    createdAt: new Date().toISOString(),
    ttlSeconds: SUPPORT_SESSION_TTL_SECONDS,
    supportMode: true,
  };

  const updatedWorkflows: readonly SupportModeBreakGlassAccessWorkflow[] = state.workflows.map(
    (w): SupportModeBreakGlassAccessWorkflow =>
      w.id === workflowId ? { ...w, status: 'COMPLETED' } : w,
  );

  return {
    ...state,
    workflows: updatedWorkflows,
    sessions: [...state.sessions, newSession],
    lastError: null,
  };
}

export function enterSupportModeDirectly(
  state: SupportModeBreakGlassAccessState,
  targetTenantId: string,
  effectiveOrganisationId: string,
  accessReason: string,
  roles: readonly string[],
  targetTenantFqdn: string,
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  const validation = validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId },
    targetTenantFqdn,
    accessReason,
  );
  if (validation !== 'APPROVED') {
    return mapDecisionToError(validation);
  }

  const sessionId = `session-direct-${Date.now()}`;
  const auditError = emitSupportSessionCreatedAudit(
    'direct',
    sessionId,
    targetTenantFqdn,
    accessReason,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const newSession: SupportModeBreakGlassAccessSession = {
    id: sessionId,
    targetTenantId,
    effectiveOrganisationId,
    accessReason,
    roles,
    createdAt: new Date().toISOString(),
    ttlSeconds: SUPPORT_SESSION_TTL_SECONDS,
    supportMode: true,
  };

  return {
    ...state,
    sessions: [...state.sessions, newSession],
    lastError: null,
  };
}

export function proveWorkflowAndSessionStateMachine(
  state: SupportModeBreakGlassAccessState,
  workflowId: string,
  targetTenantFqdn: string,
  accessReason: string,
  requestedBy: string,
  targetTenantId: string,
  roles: readonly string[],
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  const step1 = requestSupportAccess(
    state,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    () => null,
  );
  if ('kind' in step1 && typeof step1.kind === 'string' && step1.kind !== null) {
    return step1;
  }
  const requestState = step1 as SupportModeBreakGlassAccessState;
  const step2 = approveSupportAccess(
    requestState,
    workflowId,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    () => null,
  );
  return step2;
}

function mapDecisionToError(decision: SupportModeBreakGlassAccessDecision): SupportModeBreakGlassAccessError {
  switch (decision) {
    case 'FORBIDDEN':
      return { kind: 'FORBIDDEN', message: 'Access forbidden' };
    case 'REASON_REQUIRED':
      return { kind: 'REASON_REQUIRED', message: 'Reason is required' };
    case 'INVALID_TARGET':
      return { kind: 'INVALID_TARGET', message: 'Invalid target' };
    case 'WRONG_TENANT_FQDN':
      return { kind: 'WRONG_TENANT_FQDN', message: 'Wrong tenant FQDN' };
    case 'AUDIT_FAILURE':
      return { kind: 'AUDIT_BACKEND_FAILURE', message: 'Audit backend failure' };
    default:
      return { kind: 'FORBIDDEN', message: 'Access denied' };
  }
}