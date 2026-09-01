export const SupportTicketsCustomerHealthAnnouncementsDecision = [
  'GRANTED',
  'DENIED',
  'PENDING_APPROVAL',
  'ERROR',
] as const;
export type SupportTicketsCustomerHealthAnnouncementsDecision = typeof SupportTicketsCustomerHealthAnnouncementsDecision[number];

export const SupportTicketsCustomerHealthAnnouncementsAuditEventKind = [
  'TICKET_MUTATION',
  'ANNOUNCEMENT_MUTATION',
  'SUPPORT_SESSION_CREATED',
] as const;
export type SupportTicketsCustomerHealthAnnouncementsAuditEventKind = typeof SupportTicketsCustomerHealthAnnouncementsAuditEventKind[number];

export const SupportTicketsCustomerHealthAnnouncementsErrorKind = [
  'DATABASE_FAILURE',
  'USE_CASE_FAILURE',
  'PERMISSION_DENIED',
  'MISSING_APPROVAL',
  'VALIDATION_ERROR',
] as const;
export type SupportTicketsCustomerHealthAnnouncementsErrorKind = typeof SupportTicketsCustomerHealthAnnouncementsErrorKind[number];

export const SupportTicketsCustomerHealthAnnouncementsReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type SupportTicketsCustomerHealthAnnouncementsReadiness = typeof SupportTicketsCustomerHealthAnnouncementsReadiness[number];

export interface SupportTicketsCustomerHealthAnnouncementsAuditEvent {
  readonly kind: SupportTicketsCustomerHealthAnnouncementsAuditEventKind;
  readonly tenantId: string;
  readonly actorId: string;
  readonly resourceId: string;
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
  readonly organisation: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface Announcement {
  readonly id: string;
  readonly subject: string;
  readonly message: string;
  readonly creator: string;
  readonly createdAt: string;
  readonly tenantId: string;
}

export interface SupportApproval {
  readonly tenantId: string;
  readonly requesterId: string;
  readonly approverId: string | null;
  readonly status: 'PENDING' | 'APPROVED';
  readonly requestedAt: string;
  readonly approvedAt: string | null;
}

export interface SupportSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly createdAt: string;
}

export interface CustomerHealthSignal {
  readonly tenantId: string;
  readonly ticketCount: number;
  readonly meteredUsage: number;
}

export interface SupportTicketsCustomerHealthAnnouncementsState {
  readonly tickets: readonly SupportTicket[];
  readonly announcements: readonly Announcement[];
  readonly approvals: readonly SupportApproval[];
  readonly sessions: readonly SupportSession[];
  readonly usageSignals: readonly { tenantId: string; usage: number }[];
  readonly readiness: SupportTicketsCustomerHealthAnnouncementsReadiness;
}

export const initialState: SupportTicketsCustomerHealthAnnouncementsState = {
  tickets: [],
  announcements: [],
  approvals: [],
  sessions: [],
  usageSignals: [],
  readiness: 'NOT_READY',
};

export type AuditPort = (event: SupportTicketsCustomerHealthAnnouncementsAuditEvent) => SupportTicketsCustomerHealthAnnouncementsError | null;

export function createTicket(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  tenantId: string,
  actorId: string,
  subject: string,
  body: string,
  auditFn: AuditPort,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  if (state.readiness === 'DEGRADED' || state.readiness === 'NOT_READY') {
    return { kind: 'DATABASE_FAILURE', message: 'System in read-only or unavailable mode' };
  }
  if (!subject || !body) {
    return { kind: 'VALIDATION_ERROR', message: 'Subject and body are required' };
  }

  const ticket: SupportTicket = {
    id: `ticket_${Math.random().toString(36).substr(2, 9)}`,
    subject,
    body,
    status: 'OPEN',
    organisation: tenantId,
    actor: actorId,
    createdAt: new Date().toISOString(),
  };

  const auditError = auditFn({
    kind: 'TICKET_MUTATION',
    tenantId,
    actorId,
    resourceId: ticket.id,
    timestamp: ticket.createdAt,
    metadata: { action: 'CREATE' },
  });

  if (auditError !== null) return auditError;

  return { ...state, tickets: [...state.tickets, ticket] };
}

export function updateTicket(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  tenantId: string,
  actorId: string,
  ticketId: string,
  updates: Partial<Omit<SupportTicket, 'id' | 'createdAt' | 'organisation'>>,
  auditFn: AuditPort,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  if (state.readiness === 'DEGRADED' || state.readiness === 'NOT_READY') {
    return { kind: 'DATABASE_FAILURE', message: 'System in read-only or unavailable mode' };
  }

  const index = state.tickets.findIndex((t) => t.id === ticketId && t.organisation === tenantId);
  if (index === -1) {
    return { kind: 'USE_CASE_FAILURE', message: 'Ticket not found' };
  }

  const currentTicket = state.tickets[index];
  const updatedTicket: SupportTicket = {
    ...currentTicket,
    ...updates,
    organisation: currentTicket.organisation,
  };

  const auditError = auditFn({
    kind: 'TICKET_MUTATION',
    tenantId,
    actorId,
    resourceId: ticketId,
    timestamp: new Date().toISOString(),
    metadata: { action: 'UPDATE' },
  });

  if (auditError !== null) return auditError;

  const newTickets = [...state.tickets];
  newTickets[index] = updatedTicket;
  return { ...state, tickets: newTickets };
}

export function listTickets(state: SupportTicketsCustomerHealthAnnouncementsState, tenantId: string): readonly SupportTicket[] {
  return state.tickets.filter((t) => t.organisation === tenantId);
}

export function computeCustomerHealth(state: SupportTicketsCustomerHealthAnnouncementsState, tenantId: string): CustomerHealthSignal {
  const ticketCount = state.tickets.filter((t) => t.organisation === tenantId).length;
  const usageRecord = state.usageSignals.find((u) => u.tenantId === tenantId);
  const meteredUsage = usageRecord ? usageRecord.usage : 0;

  return {
    tenantId,
    ticketCount,
    meteredUsage,
  };
}

export function createAnnouncement(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  tenantId: string,
  actorId: string,
  subject: string,
  message: string,
  auditFn: AuditPort,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  if (state.readiness === 'DEGRADED' || state.readiness === 'NOT_READY') {
    return { kind: 'DATABASE_FAILURE', message: 'System in read-only or unavailable mode' };
  }
  if (!subject || !message) {
    return { kind: 'VALIDATION_ERROR', message: 'Subject and message are required' };
  }

  const announcement: Announcement = {
    id: `ann_${Math.random().toString(36).substr(2, 9)}`,
    subject,
    message,
    creator: actorId,
    createdAt: new Date().toISOString(),
    tenantId,
  };

  const auditError = auditFn({
    kind: 'ANNOUNCEMENT_MUTATION',
    tenantId,
    actorId,
    resourceId: announcement.id,
    timestamp: announcement.createdAt,
    metadata: { action: 'CREATE' },
  });

  if (auditError !== null) return auditError;

  return { ...state, announcements: [...state.announcements, announcement] };
}

export function listAnnouncements(state: SupportTicketsCustomerHealthAnnouncementsState, tenantId: string): readonly (Omit<Announcement, 'tenantId'>)[] {
  return state.announcements
    .filter((a) => a.tenantId === tenantId)
    .map(({ id, subject, message, creator, createdAt }) => ({ id, subject, message, creator, createdAt }));
}

export function requestSupportApproval(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  tenantId: string,
  requesterId: string,
): SupportTicketsCustomerHealthAnnouncementsState {
  const approval: SupportApproval = {
    tenantId,
    requesterId,
    approverId: null,
    status: 'PENDING',
    requestedAt: new Date().toISOString(),
    approvedAt: null,
  };
  return { ...state, approvals: [...state.approvals, approval] };
}

export function approveSupportRequest(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  tenantId: string,
  requesterId: string,
  approverId: string,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  const index = state.approvals.findIndex((a) => a.tenantId === tenantId && a.requesterId === requesterId && a.status === 'PENDING');
  if (index === -1) {
    return { kind: 'MISSING_APPROVAL', message: 'No pending approval request found' };
  }

  const newApprovals = [...state.approvals];
  newApprovals[index] = {
    ...newApprovals[index],
    approverId,
    status: 'APPROVED',
    approvedAt: new Date().toISOString(),
  };

  return { ...state, approvals: newApprovals };
}

export function createSupportSession(
  state: SupportTicketsCustomerHealthAnnouncementsState,
  tenantId: string,
  operatorId: string,
  auditFn: AuditPort,
): SupportTicketsCustomerHealthAnnouncementsState | SupportTicketsCustomerHealthAnnouncementsError {
  const approval = state.approvals.find((a) => a.tenantId === tenantId && a.status === 'APPROVED');
  
  if (!approval) {
    return { kind: 'MISSING_APPROVAL', message: 'Support access is gated; no approved request found' };
  }

  const session: SupportSession = {
    sessionId: `sess_${Math.random().toString(36).substr(2, 9)}`,
    tenantId,
    operatorId,
    createdAt: new Date().toISOString(),
  };

  const auditError = auditFn({
    kind: 'SUPPORT_SESSION_CREATED',
    tenantId,
    actorId: operatorId,
    resourceId: session.sessionId,
    timestamp: session.createdAt,
    metadata: { approvedBy: approval.approverId },
  });

  if (auditError !== null) return auditError;

  return { ...state, sessions: [...state.sessions, session] };
}

export function checkSupportAccess(state: SupportTicketsCustomerHealthAnnouncementsState, tenantId: string): SupportTicketsCustomerHealthAnnouncementsDecision {
  const approval = state.approvals.find((a) => a.tenantId === tenantId);
  if (!approval) return 'DENIED';
  if (approval.status === 'APPROVED') return 'GRANTED';
  if (approval.status === 'PENDING') return 'PENDING_APPROVAL';
  return 'DENIED';
}