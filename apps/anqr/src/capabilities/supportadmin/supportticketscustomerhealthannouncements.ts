export const SupportTicketsCustomerHealthAnnouncementsStateKind = [
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'ANNOUNCEMENT_CREATED',
  'HEALTH_COMPUTED',
  'APPROVAL_REQUESTED',
  'APPROVAL_GRANTED',
  'SESSION_CREATED',
] as const;
export type SupportTicketsCustomerHealthAnnouncementsStateKind = typeof SupportTicketsCustomerHealthAnnouncementsStateKind[number];

export const SupportTicketsCustomerHealthAnnouncementsErrorKind = [
  'DATABASE_FAILURE',
  'USE_CASE_FAILURE',
  'MISSING_APPROVAL',
  'PERMISSION_DENIED',
  'INVALID_INPUT',
  'DEGRADED_MODE',
] as const;
export type SupportTicketsCustomerHealthAnnouncementsErrorKind = typeof SupportTicketsCustomerHealthAnnouncementsErrorKind[number];

export const SupportTicketsCustomerHealthAnnouncementsReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type SupportTicketsCustomerHealthAnnouncementsReadiness = typeof SupportTicketsCustomerHealthAnnouncementsReadiness[number];

export const SupportTicketsCustomerHealthAnnouncementsAuditEventKind = [
  'TICKET_MUTATION',
  'ANNOUNCEMENT_MUTATION',
  'HEALTH_READ',
  'APPROVAL_WORKFLOW',
  'SESSION_CREATED',
] as const;
export type SupportTicketsCustomerHealthAnnouncementsAuditEventKind = typeof SupportTicketsCustomerHealthAnnouncementsAuditEventKind[number];

export interface SupportTicketsCustomerHealthAnnouncementsAuditEvent {
  readonly kind: SupportTicketsCustomerHealthAnnouncementsAuditEventKind;
  readonly entityId: string;
  readonly entityType: string;
  readonly actor: string;
  readonly timestamp: string;
  readonly metadata: unknown;
}

export interface SupportTicketsCustomerHealthAnnouncementsError {
  readonly kind: SupportTicketsCustomerHealthAnnouncementsErrorKind;
  readonly message: string;
}

export interface SupportTicket {
  readonly id: string;
  readonly subject: string;
  readonly body: string;
  readonly status: string;
  readonly organisationId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerHealth {
  readonly organisationId: string;
  readonly ticketCount: number;
  readonly usageCount: number;
  readonly lastComputedAt: string;
}

export interface Announcement {
  readonly id: string;
  readonly subject: string;
  readonly message: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface SupportApproval {
  readonly id: string;
  readonly requester: string;
  readonly approver: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly requestedAt: string;
  readonly approvedAt: string | null;
}

export interface SupportSession {
  readonly id: string;
  readonly approvalId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface SupportTicketsCustomerHealthAnnouncementsState {
  readonly tickets: readonly SupportTicket[];
  readonly healthSignals: readonly CustomerHealth[];
  readonly announcements: readonly Announcement[];
  readonly approvals: readonly SupportApproval[];
  readonly sessions: readonly SupportSession[];
  readonly readiness: SupportTicketsCustomerHealthAnnouncementsReadiness;
  readonly lastError: SupportTicketsCustomerHealthAnnouncementsError | null;
}

export const initialState: SupportTicketsCustomerHealthAnnouncementsState = {
  tickets: [],
  healthSignals: [],
  announcements: [],
  approvals: [],
  sessions: [],
  readiness: 'NOT_READY',
  lastError: null,
};

export function createSupportTicket(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  input: {
    readonly subject: string;
    readonly body: string;
    readonly organisationId: string;
    readonly createdBy: string;
  },
  auditFn: (event: SupportTicketsCustomerHealthAnnouncementsAuditEvent) => SupportTicketsCustomerHealthAnnouncementsError | null,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  if (input.subject.trim() === '' || input.body.trim() === '' || input.organisationId.trim() === '' || input.createdBy.trim() === '') {
    return { kind: 'INVALID_INPUT', message: 'Missing required fields' };
  }

  const newTicket: SupportTicket = {
    id: `ticket-${Date.now()}`,
    subject: input.subject,
    body: input.body,
    status: 'OPEN',
    organisationId: input.organisationId,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'TICKET_MUTATION',
    entityId: newTicket.id,
    entityType: 'TICKET',
    actor: input.createdBy,
    timestamp: newTicket.createdAt,
    metadata: { action: 'CREATE' },
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    tickets: [...state.tickets, newTicket],
    lastError: null,
  };
}

export function listSupportTickets(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  organisationId: string,
  actor: string,
): readonly SupportTicket[] | SupportTicketsCustomerHealthAnnouncementsError {
  if (state.readiness === 'NOT_READY') {
    return { kind: 'DEGRADED_MODE', message: 'Service not ready' };
  }

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'TICKET_MUTATION',
    entityId: '',
    entityType: 'TICKET',
    actor,
    timestamp: new Date().toISOString(),
    metadata: { action: 'LIST', organisationId },
  };

  const auditError = auditFnForRead(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  return state.tickets.filter((ticket) => ticket.organisationId === organisationId);
}

function auditFnForRead(event: SupportTicketsCustomerHealthAnnouncementsAuditEvent): SupportTicketsCustomerHealthAnnouncementsError | null {
  return null;
}

export function updateSupportTicket(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  ticketId: string,
  input: {
    readonly subject?: string;
    readonly body?: string;
    readonly status?: string;
  },
  actor: string,
  auditFn: (event: SupportTicketsCustomerHealthAnnouncementsAuditEvent) => SupportTicketsCustomerHealthAnnouncementsError | null,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (ticket === undefined) {
    return { kind: 'DATABASE_FAILURE', message: 'Ticket not found' };
  }

  const updatedTicket: SupportTicket = {
    ...ticket,
    subject: input.subject ?? ticket.subject,
    body: input.body ?? ticket.body,
    status: input.status ?? ticket.status,
    updatedAt: new Date().toISOString(),
  };

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'TICKET_MUTATION',
    entityId: ticketId,
    entityType: 'TICKET',
    actor,
    timestamp: updatedTicket.updatedAt,
    metadata: { action: 'UPDATE', changes: input },
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const updatedTickets = state.tickets.map((t) => (t.id === ticketId ? updatedTicket : t));
  return {
    ...state,
    tickets: updatedTickets,
    lastError: null,
  };
}

export function computeCustomerHealth(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  organisationId: string,
): CustomerHealth | SupportTicketsCustomerHealthAnnouncementsError {
  const organisationTickets = state.tickets.filter((t) => t.organisationId === organisationId);
  const ticketCount = organisationTickets.length;

  const healthSignal = state.healthSignals.find((h) => h.organisationId === organisationId);
  const usageCount = healthSignal?.usageCount ?? 0;

  const newHealth: CustomerHealth = {
    organisationId,
    ticketCount,
    usageCount,
    lastComputedAt: new Date().toISOString(),
  };

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'HEALTH_READ',
    entityId: organisationId,
    entityType: 'HEALTH',
    actor: 'system',
    timestamp: newHealth.lastComputedAt,
    metadata: { ticketCount, usageCount },
  };

  const auditError = auditFnForRead(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  return newHealth;
}

export function createAnnouncement(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  input: {
    readonly subject: string;
    readonly message: string;
    readonly createdBy: string;
  },
  auditFn: (event: SupportTicketsCustomerHealthAnnouncementsAuditEvent) => SupportTicketsCustomerHealthAnnouncementsError | null,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  if (input.subject.trim() === '' || input.message.trim() === '' || input.createdBy.trim() === '') {
    return { kind: 'INVALID_INPUT', message: 'Missing required fields' };
  }

  const newAnnouncement: Announcement = {
    id: `announcement-${Date.now()}`,
    subject: input.subject,
    message: input.message,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'ANNOUNCEMENT_MUTATION',
    entityId: newAnnouncement.id,
    entityType: 'ANNOUNCEMENT',
    actor: input.createdBy,
    timestamp: newAnnouncement.createdAt,
    metadata: { action: 'CREATE' },
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    announcements: [...state.announcements, newAnnouncement],
    lastError: null,
  };
}

export function listAnnouncements(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  organisationId: string,
  actor: string,
): readonly Announcement[] | SupportTicketsCustomerHealthAnnouncementsError {
  if (state.readiness === 'NOT_READY') {
    return { kind: 'DEGRADED_MODE', message: 'Service not ready' };
  }

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'ANNOUNCEMENT_MUTATION',
    entityId: '',
    entityType: 'ANNOUNCEMENT',
    actor,
    timestamp: new Date().toISOString(),
    metadata: { action: 'LIST', organisationId },
  };

  const auditError = auditFnForRead(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  return state.announcements.filter((a) => a.createdBy === actor || a.message.includes(organisationId));
}

export function requestSupportApproval(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  requester: string,
  organisationId: string,
  auditFn: (event: SupportTicketsCustomerHealthAnnouncementsAuditEvent) => SupportTicketsCustomerHealthAnnouncementsError | null,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  const newApproval: SupportApproval = {
    id: `approval-${Date.now()}`,
    requester,
    approver: null,
    status: 'PENDING',
    requestedAt: new Date().toISOString(),
    approvedAt: null,
  };

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'APPROVAL_WORKFLOW',
    entityId: newApproval.id,
    entityType: 'APPROVAL',
    actor: requester,
    timestamp: newApproval.requestedAt,
    metadata: { action: 'REQUEST', organisationId },
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    approvals: [...state.approvals, newApproval],
    lastError: null,
  };
}

export function approveSupportRequest(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  approvalId: string,
  approver: string,
  auditFn: (event: SupportTicketsCustomerHealthAnnouncementsAuditEvent) => SupportTicketsCustomerHealthAnnouncementsError | null,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  const approval = state.approvals.find((a) => a.id === approvalId);
  if (approval === undefined) {
    return { kind: 'DATABASE_FAILURE', message: 'Approval not found' };
  }

  if (approval.status !== 'PENDING') {
    return { kind: 'INVALID_INPUT', message: 'Approval already processed' };
  }

  const updatedApproval: SupportApproval = {
    ...approval,
    approver,
    status: 'APPROVED',
    approvedAt: new Date().toISOString(),
  };

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'APPROVAL_WORKFLOW',
    entityId: approvalId,
    entityType: 'APPROVAL',
    actor: approver,
    timestamp: updatedApproval.approvedAt,
    metadata: { action: 'APPROVE' },
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const updatedApprovals = state.approvals.map((a) => (a.id === approvalId ? updatedApproval : a));
  return {
    ...state,
    approvals: updatedApprovals,
    lastError: null,
  };
}

export function createSupportSession(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  approvalId: string,
  createdBy: string,
  auditFn: (event: SupportTicketsCustomerHealthAnnouncementsAuditEvent) => SupportTicketsCustomerHealthAnnouncementsError | null,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  const approval = state.approvals.find((a) => a.id === approvalId);
  if (approval === undefined) {
    return { kind: 'MISSING_APPROVAL', message: 'Approval not found' };
  }

  if (approval.status !== 'APPROVED') {
    return { kind: 'MISSING_APPROVAL', message: 'Approval not granted' };
  }

  const newSession: SupportSession = {
    id: `session-${Date.now()}`,
    approvalId,
    createdBy,
    createdAt: new Date().toISOString(),
  };

  const auditEvent: SupportTicketsCustomerHealthAnnouncementsAuditEvent = {
    kind: 'SESSION_CREATED',
    entityId: newSession.id,
    entityType: 'SESSION',
    actor: createdBy,
    timestamp: newSession.createdAt,
    metadata: { approvalId },
  };

  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    sessions: [...state.sessions, newSession],
    lastError: null,
  };
}

export function checkReadiness(
  state: SupportTicketsCustomerHealthAnnouncementsState,
): SupportTicketsCustomerHealthAnnouncementsReadiness {
  return state.readiness;
}

export function setReadiness(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  readiness: SupportTicketsCustomerHealthAnnouncementsReadiness,
): SupportTicketsCustomerHealthAnnouncementsState {
  return {
    ...state,
    readiness,
  };
}