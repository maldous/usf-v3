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

export const SupportModeBreakGlassAccessRole = [
  'platform-admin',
  'system-admin',
] as const;
export type SupportModeBreakGlassAccessRole = typeof SupportModeBreakGlassAccessRole[number];

export interface SupportModeBreakGlassAccessAuditEvent {
  readonly kind: SupportModeBreakGlassAccessAuditEventKind;
  readonly workflowId: string;
  readonly requestedState: SupportModeBreakGlassAccessWorkflowStatus;
  readonly targetTenantFqdn: string;
  readonly accessReason: string;
  readonly timestamp: string;
  readonly supportMode: boolean;
  readonly effectiveOrganisationId: string;
  readonly roles: readonly string[];
  readonly tenantScopedPermissions: readonly never[];
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
  readonly tenantScopedPermissions: readonly never[];
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
  readonly liveExternalProviderClaimed: boolean;
}

export const initialState: SupportModeBreakGlassAccessState = {
  workflows: [],
  sessions: [],
  readiness: 'READY',
  lastError: null,
  liveExternalProviderClaimed: false,
};

export const SUPPORT_SESSION_TTL_SECONDS = 3600;
export const SUPPORT_SESSION_TTL_MS = SUPPORT_SESSION_TTL_SECONDS * 1000;

function hasRole(roles: readonly string[], role: string): boolean {
  return roles.includes(role);
}

function buildAuditEvent(
  kind: SupportModeBreakGlassAccessAuditEventKind,
  workflowId: string,
  requestedState: SupportModeBreakGlassAccessWorkflowStatus,
  targetTenantFqdn: string,
  accessReason: string,
  effectiveOrganisationId: string,
  roles: readonly string[],
): SupportModeBreakGlassAccessAuditEvent {
  return {
    kind,
    workflowId,
    requestedState,
    targetTenantFqdn,
    accessReason,
    timestamp: new Date().toISOString(),
    supportMode: true,
    effectiveOrganisationId,
    roles,
    tenantScopedPermissions: [],
  };
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
    case 'DENIED':
      return { kind: 'FORBIDDEN', message: 'Access denied' };
    default:
      return { kind: 'FORBIDDEN', message: 'Access denied' };
  }
}

export function validateRequest(
  actor: {
    readonly roles: readonly string[];
    readonly effectiveOrganisationId: string | null;
    readonly targetTenantFqdn: string;
    readonly accessReason: string;
  },
  targetTenantFqdn: string,
  accessReason: string,
  allowedTenantFqdns: readonly string[] = [],
): SupportModeBreakGlassAccessDecision {
  if (!hasRole(actor.roles, 'platform-admin')) {
    return 'FORBIDDEN';
  }
  if (!hasRole(actor.roles, 'support-enter')) {
    return 'FORBIDDEN';
  }
  if (!hasRole(actor.roles, 'system-admin')) {
    return 'FORBIDDEN';
  }
  if (actor.effectiveOrganisationId === null || actor.effectiveOrganisationId.trim() === '') {
    return 'FORBIDDEN';
  }
  if (accessReason.trim() === '') {
    return 'REASON_REQUIRED';
  }
  if (targetTenantFqdn.trim() === '') {
    return 'INVALID_TARGET';
  }
  if (allowedTenantFqdns.length > 0 && !allowedTenantFqdns.includes(targetTenantFqdn)) {
    return 'WRONG_TENANT_FQDN';
  }
  return 'APPROVED';
}

export function checkTenantFqdnMatch(
  actor: {
    readonly roles: readonly string[];
    readonly effectiveOrganisationId: string | null;
    readonly effectiveTenantFqdns: readonly string[];
  },
  targetTenantFqdn: string,
): SupportModeBreakGlassAccessDecision {
  if (!hasRole(actor.roles, 'platform-admin')) {
    return 'FORBIDDEN';
  }
  if (!hasRole(actor.roles, 'support-enter')) {
    return 'FORBIDDEN';
  }
  if (!hasRole(actor.roles, 'system-admin')) {
    return 'FORBIDDEN';
  }
  if (actor.effectiveOrganisationId === null || actor.effectiveOrganisationId.trim() === '') {
    return 'FORBIDDEN';
  }
  if (targetTenantFqdn.trim() === '') {
    return 'INVALID_TARGET';
  }
  if (!actor.effectiveTenantFqdns.includes(targetTenantFqdn)) {
    return 'WRONG_TENANT_FQDN';
  }
  return 'APPROVED';
}

export function emitApprovalRequestAudit(
  workflowId: string,
  requestedState: SupportModeBreakGlassAccessWorkflowStatus,
  targetTenantFqdn: string,
  accessReason: string,
  effectiveOrganisationId: string,
  roles: readonly string[],
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessError | null {
  const event = buildAuditEvent(
    'APPROVAL_REQUESTED',
    workflowId,
    requestedState,
    targetTenantFqdn,
    accessReason,
    effectiveOrganisationId,
    roles,
  );
  try {
    const result = auditFn(event);
    if (result === null) {
      return null;
    }
    return {
      kind: 'AUDIT_BACKEND_FAILURE',
      message: result.message,
    };
  } catch (err) {
    return {
      kind: 'AUDIT_BACKEND_FAILURE',
      message: err instanceof Error ? err.message : 'Audit backend failure',
    };
  }
}

export function emitSupportSessionCreatedAudit(
  workflowId: string,
  sessionId: string,
  targetTenantFqdn: string,
  accessReason: string,
  effectiveOrganisationId: string,
  roles: readonly string[],
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessError | null {
  const event = buildAuditEvent(
    'SUPPORT_SESSION_CREATED',
    workflowId,
    'COMPLETED',
    targetTenantFqdn,
    accessReason,
    effectiveOrganisationId,
    roles,
  );
  try {
    const result = auditFn(event);
    if (result === null) {
      return null;
    }
    return {
      kind: 'AUDIT_BACKEND_FAILURE',
      message: result.message,
    };
  } catch (err) {
    return {
      kind: 'AUDIT_BACKEND_FAILURE',
      message: err instanceof Error ? err.message : 'Audit backend failure',
    };
  }
}

export function requestSupportAccess(
  state: SupportModeBreakGlassAccessState,
  workflowId: string,
  targetTenantFqdn: string,
  accessReason: string,
  requestedBy: string,
  actorRoles: readonly string[],
  actorEffectiveOrganisationId: string | null,
  allowedTenantFqdns: readonly string[],
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  const validation = validateRequest(
    { roles: actorRoles, effectiveOrganisationId: actorEffectiveOrganisationId, targetTenantFqdn, accessReason },
    targetTenantFqdn,
    accessReason,
    allowedTenantFqdns,
  );
  if (validation !== 'APPROVED') {
    return mapDecisionToError(validation);
  }

  const effectiveOrganisationId = actorEffectiveOrganisationId === null ? '' : actorEffectiveOrganisationId;

  const auditError = emitApprovalRequestAudit(
    workflowId,
    'WAITING',
    targetTenantFqdn,
    accessReason,
    effectiveOrganisationId,
    actorRoles,
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

  const approvedWorkflows: readonly SupportModeBreakGlassAccessWorkflow[] = state.workflows.map(
    (w): SupportModeBreakGlassAccessWorkflow =>
      w.id === workflowId ? { ...w, status: 'APPROVED' } : w,
  );

  const auditError = emitSupportSessionCreatedAudit(
    workflowId,
    sessionId,
    workflow.targetTenantFqdn,
    workflow.accessReason,
    effectiveOrganisationId,
    roles,
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
    tenantScopedPermissions: [],
  };

  const completedWorkflows: readonly SupportModeBreakGlassAccessWorkflow[] = approvedWorkflows.map(
    (w): SupportModeBreakGlassAccessWorkflow =>
      w.id === workflowId ? { ...w, status: 'COMPLETED' } : w,
  );

  return {
    ...state,
    workflows: completedWorkflows,
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
  actorRoles: readonly string[],
  actorEffectiveOrganisationId: string | null,
  allowedTenantFqdns: readonly string[],
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  const validation = validateRequest(
    { roles: actorRoles, effectiveOrganisationId: actorEffectiveOrganisationId, targetTenantFqdn, accessReason },
    targetTenantFqdn,
    accessReason,
    allowedTenantFqdns,
  );
  if (validation !== 'APPROVED') {
    return mapDecisionToError(validation);
  }

  const sessionId = `session-direct-${workflowIdFromFqdn(targetTenantFqdn)}`;
  const effectiveOrganisationIdForAudit = actorEffectiveOrganisationId === null ? '' : actorEffectiveOrganisationId;

  const auditError = emitSupportSessionCreatedAudit(
    'direct',
    sessionId,
    targetTenantFqdn,
    accessReason,
    effectiveOrganisationIdForAudit,
    roles,
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
    tenantScopedPermissions: [],
  };

  return {
    ...state,
    sessions: [...state.sessions, newSession],
    lastError: null,
  };
}

function workflowIdFromFqdn(fqdn: string): string {
  let hash = 0;
  for (let i = 0; i < fqdn.length; i += 1) {
    hash = ((hash << 5) - hash + fqdn.charCodeAt(i)) | 0;
  }
  return `${hash}`;
}

export function proveWorkflowAndSessionStateMachine(
  state: SupportModeBreakGlassAccessState,
  workflowId: string,
  targetTenantFqdn: string,
  accessReason: string,
  requestedBy: string,
  targetTenantId: string,
  effectiveOrganisationId: string,
  roles: readonly string[],
  actorRoles: readonly string[],
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  const okAudit = (): SupportModeBreakGlassAccessError | null => null;
  const requestResult = requestSupportAccess(
    state,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    actorRoles,
    effectiveOrganisationId,
    [targetTenantFqdn],
    okAudit,
  );
  if ('kind' in requestResult) {
    return requestResult;
  }

  const approveResult = approveSupportAccess(
    requestResult,
    workflowId,
    targetTenantId,
    effectiveOrganisationId,
    roles,
    okAudit,
  );
  return approveResult;
}

export function proveRuntimeApprovalFlow(
  state: SupportModeBreakGlassAccessState,
  workflowId: string,
  targetTenantFqdn: string,
  accessReason: string,
  requestedBy: string,
  actorRoles: readonly string[],
  actorEffectiveOrganisationId: string | null,
  allowedTenantFqdns: readonly string[],
  auditFn: (event: SupportModeBreakGlassAccessAuditEvent) => SupportModeBreakGlassAccessError | null,
): SupportModeBreakGlassAccessState | SupportModeBreakGlassAccessError {
  return requestSupportAccess(
    state,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    actorRoles,
    actorEffectiveOrganisationId,
    allowedTenantFqdns,
    auditFn,
  );
}

export function computeReadiness(
  state: SupportModeBreakGlassAccessState,
  liveExternalProviderClaimed: boolean,
): SupportModeBreakGlassAccessReadiness {
  if (liveExternalProviderClaimed) {
    return 'DEGRADED';
  }
  return state.readiness;
}

export function setReadiness(
  state: SupportModeBreakGlassAccessState,
  readiness: SupportModeBreakGlassAccessReadiness,
): SupportModeBreakGlassAccessState {
  return { ...state, readiness };
}

export function markDegradedMode(
  state: SupportModeBreakGlassAccessState,
  reason: string,
): SupportModeBreakGlassAccessState {
  const error: SupportModeBreakGlassAccessError = {
    kind: 'AUDIT_BACKEND_FAILURE',
    message: reason,
  };
  return {
    ...state,
    readiness: 'DEGRADED',
    liveExternalProviderClaimed: false,
    lastError: error,
  };
}

export function claimNoLiveExternalProvider(
  state: SupportModeBreakGlassAccessState,
): SupportModeBreakGlassAccessState {
  return { ...state, liveExternalProviderClaimed: false };
}

export function sessionIsExpired(
  session: SupportModeBreakGlassAccessSession,
  nowIso: string,
): boolean {
  const createdMs = Date.parse(session.createdAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(createdMs) || Number.isNaN(nowMs)) {
    return true;
  }
  return nowMs - createdMs >= SUPPORT_SESSION_TTL_MS;
}