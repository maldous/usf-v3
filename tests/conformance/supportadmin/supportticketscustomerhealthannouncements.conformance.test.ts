import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/supportadmin/supportticketscustomerhealthannouncements.ts";

const assertCapabilityState = (
  value: unknown,
): asserts value is capability.SupportTicketsCustomerHealthAnnouncementsState => {
  assert.ok(value && typeof value === "object" && "tickets" in value && "announcements" in value);
};

const assertCapabilityError = (
  value: unknown,
): asserts value is capability.SupportTicketsCustomerHealthAnnouncementsError => {
  assert.ok(value && typeof value === "object" && "kind" in value && "message" in value);
};

test("supportticketscustomerhealthannouncementsauditmodel", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn: capability.AuditPort = (event) => {
    auditEvents.push(event);
    return null;
  };

  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  const ticketResult = capability.createTicket(
    state,
    "tenant-a",
    "operator-a",
    "Login issue",
    "Customer cannot login",
    auditFn,
  );
  assertCapabilityState(ticketResult);
  state = ticketResult;

  const announcementResult = capability.createAnnouncement(
    state,
    "tenant-a",
    "operator-a",
    "Maintenance",
    "Login fix in progress",
    auditFn,
  );
  assertCapabilityState(announcementResult);
  state = announcementResult;

  const pendingRequest = capability.requestSupportApproval(state, "tenant-a", "operator-a");
  assertCapabilityState(pendingRequest);
  state = pendingRequest;
  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "PENDING_APPROVAL" as const);

  const deniedSessionResult = capability.createSupportSession(state, "tenant-a", "operator-a", auditFn);
  assertCapabilityError(deniedSessionResult);
  assert.strictEqual(deniedSessionResult.kind, "MISSING_APPROVAL" as const);

  const approvedRequest = capability.approveSupportRequest(state, "tenant-a", "operator-a", "approver-a");
  assertCapabilityState(approvedRequest);
  state = approvedRequest;

  const supportSession = capability.createSupportSession(state, "tenant-a", "operator-a", auditFn);
  assertCapabilityState(supportSession);
  state = supportSession;

  assert.strictEqual(auditEvents.length, 3);
  assert.deepStrictEqual(
    auditEvents.map((event) => event.kind),
    ["TICKET_MUTATION", "ANNOUNCEMENT_MUTATION", "SUPPORT_SESSION_CREATED"],
  );
  assert.strictEqual(auditEvents[0].tenantId, "tenant-a");
  assert.strictEqual(auditEvents[0].actorId, "operator-a");
  assert.strictEqual(auditEvents[0].resourceId.startsWith("ticket_"), true);
  assert.strictEqual((auditEvents[0].metadata as { action: string }).action, "CREATE");

  assert.strictEqual(auditEvents[1].tenantId, "tenant-a");
  assert.strictEqual(auditEvents[1].actorId, "operator-a");
  assert.strictEqual(auditEvents[1].resourceId.startsWith("ann_"), true);
  assert.strictEqual((auditEvents[1].metadata as { action: string }).action, "CREATE");

  assert.strictEqual(auditEvents[2].tenantId, "tenant-a");
  assert.strictEqual(auditEvents[2].actorId, "operator-a");
  assert.strictEqual((auditEvents[2].metadata as { approvedBy: string | null }).approvedBy, "approver-a");
  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "GRANTED" as const);
});

test("supportticketscustomerhealthannouncementscontracts", () => {
  const auditFn: capability.AuditPort = () => null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  const ticketResult = capability.createTicket(
    state,
    "tenant-a",
    "operator-a",
    "Ticket contract",
    "Initial problem",
    auditFn,
  );
  assertCapabilityState(ticketResult);
  state = ticketResult;

  const tickets = capability.listTickets(state, "tenant-a");
  assert.strictEqual(tickets.length, 1);

  const updatedTicket = capability.updateTicket(
    state,
    "tenant-a",
    "operator-a",
    state.tickets[0].id,
    { status: "CLOSED" },
    auditFn,
  );
  assertCapabilityState(updatedTicket);
  state = updatedTicket;
  assert.strictEqual(state.tickets[0].status, "CLOSED");

  const health = capability.computeCustomerHealth(state, "tenant-a");
  assert.strictEqual(health.tenantId, "tenant-a");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 0);

  const announcementResult = capability.createAnnouncement(
    state,
    "tenant-a",
    "operator-a",
    "Operator update",
    "Work is ongoing",
    auditFn,
  );
  assertCapabilityState(announcementResult);
  state = announcementResult;
  const announcements = capability.listAnnouncements(state, "tenant-a");
  assert.strictEqual(announcements.length, 1);

  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "DENIED" as const);
  const approvalRequested = capability.requestSupportApproval(state, "tenant-a", "operator-a");
  assertCapabilityState(approvalRequested);
  state = approvalRequested;
  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "PENDING_APPROVAL" as const);

  const approvalGranted = capability.approveSupportRequest(state, "tenant-a", "operator-a", "approver-a");
  assertCapabilityState(approvalGranted);
  state = approvalGranted;
  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "GRANTED" as const);

  const sessionResult = capability.createSupportSession(state, "tenant-a", "operator-a", auditFn);
  assertCapabilityState(sessionResult);
  assert.strictEqual(sessionResult.sessions.length, 1);
});

test("supportticketscustomerhealthannouncementserrormodel", () => {
  const notReadyTicket = capability.createTicket(capability.initialState, "tenant-a", "operator-a", "Sub", "Body", () => null);
  assertCapabilityError(notReadyTicket);
  assert.strictEqual(notReadyTicket.kind, "DATABASE_FAILURE" as const);

  const readyState: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };
  const missingTicket = capability.updateTicket(readyState, "tenant-a", "operator-a", "no-ticket", { status: "OPEN" }, () => null);
  assertCapabilityError(missingTicket);
  assert.strictEqual(missingTicket.kind, "USE_CASE_FAILURE" as const);

  const waitingApproval = capability.requestSupportApproval(readyState, "tenant-a", "requester-a");
  assertCapabilityState(waitingApproval);
  assert.strictEqual(capability.checkSupportAccess(waitingApproval, "tenant-a"), "PENDING_APPROVAL" as const);
  assert.strictEqual(waitingApproval.approvals[0].status, "PENDING" as const);

  const sessionBlocked = capability.createSupportSession(waitingApproval, "tenant-a", "operator-a", () => null);
  assertCapabilityError(sessionBlocked);
  assert.strictEqual(sessionBlocked.kind, "MISSING_APPROVAL" as const);
  assert.strictEqual(waitingApproval.sessions.length, 0);

  const noDataHealth = capability.computeCustomerHealth(waitingApproval, "tenant-a");
  assert.strictEqual(noDataHealth.ticketCount, 0);
  assert.strictEqual(noDataHealth.meteredUsage, 0);

  assert.strictEqual(capability.checkSupportAccess(capability.initialState, "tenant-b"), "DENIED" as const);
});

test("supportticketscustomerhealthannouncementslifecycle", () => {
  const auditFn: capability.AuditPort = () => null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  const createdTicket = capability.createTicket(
    state,
    "tenant-a",
    "operator-a",
    "Portal issue",
    "Cannot open new ticket",
    auditFn,
  );
  assertCapabilityState(createdTicket);
  state = createdTicket;

  const ticketSummary = capability.listTickets(state, "tenant-a");
  assert.strictEqual(ticketSummary.length, 1);

  const updatedTicket = capability.updateTicket(
    state,
    "tenant-a",
    "operator-a",
    state.tickets[0].id,
    { subject: "Portal issue (updated)" },
    auditFn,
  );
  assertCapabilityState(updatedTicket);
  state = updatedTicket;

  const health = capability.computeCustomerHealth(state, "tenant-a");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 0);

  const createdAnnouncement = capability.createAnnouncement(
    state,
    "tenant-a",
    "operator-a",
    "Tenant note",
    "Monitoring is on",
    auditFn,
  );
  assertCapabilityState(createdAnnouncement);
  state = createdAnnouncement;

  const announcementSummary = capability.listAnnouncements(state, "tenant-a");
  assert.strictEqual(announcementSummary.length, 1);
  assert.strictEqual(announcementSummary[0].subject, "Tenant note");
  assert.strictEqual(announcementSummary[0].creator, "operator-a");

  const requestedApproval = capability.requestSupportApproval(state, "tenant-a", "operator-a");
  assertCapabilityState(requestedApproval);
  assert.strictEqual(capability.checkSupportAccess(requestedApproval, "tenant-a"), "PENDING_APPROVAL" as const);

  const blockedSession = capability.createSupportSession(requestedApproval, "tenant-a", "operator-a", () => null);
  assertCapabilityError(blockedSession);
  assert.strictEqual(blockedSession.kind, "MISSING_APPROVAL" as const);

  const approved = capability.approveSupportRequest(requestedApproval, "tenant-a", "operator-a", "approver-a");
  assertCapabilityState(approved);
  const supportSession = capability.createSupportSession(approved, "tenant-a", "operator-a", () => null);
  assertCapabilityState(supportSession);
  assert.strictEqual(supportSession.sessions.length, 1);
  assert.strictEqual(supportSession.approvals[0].status, "APPROVED" as const);
});

test("supportticketscustomerhealthannouncementspermissions", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn: capability.AuditPort = (event) => {
    auditEvents.push(event);
    return null;
  };

  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  const tenantATicket = capability.createTicket(
    state,
    "tenant-a",
    "operator-a",
    "Tenant A issue",
    "Needs routing fix",
    auditFn,
  );
  assertCapabilityState(tenantATicket);
  state = tenantATicket;

  const tenantBTicket = capability.createTicket(
    state,
    "tenant-b",
    "operator-b",
    "Tenant B issue",
    "Needs escalation",
    auditFn,
  );
  assertCapabilityState(tenantBTicket);
  state = tenantBTicket;
  assert.strictEqual(auditEvents[0].actorId, "operator-a");
  assert.strictEqual(auditEvents[1].actorId, "operator-b");

  const tenantAAnnouncements = capability.createAnnouncement(state, "tenant-a", "operator-a", "A note", "Tenant A update", auditFn);
  assertCapabilityState(tenantAAnnouncements);
  state = tenantAAnnouncements;
  const tenantBAnnouncements = capability.createAnnouncement(state, "tenant-b", "operator-b", "B note", "Tenant B update", auditFn);
  assertCapabilityState(tenantBAnnouncements);
  state = tenantBAnnouncements;

  const tenantAListedTickets = capability.listTickets(state, "tenant-a");
  const tenantBListedTickets = capability.listTickets(state, "tenant-b");
  const otherTenantListedTickets = capability.listTickets(state, "tenant-c");
  assert.strictEqual(tenantAListedTickets.length, 1);
  assert.strictEqual(tenantBListedTickets.length, 1);
  assert.strictEqual(otherTenantListedTickets.length, 0);
  assert.strictEqual(tenantAListedTickets[0].organisation, "tenant-a");
  assert.strictEqual(tenantBListedTickets[0].organisation, "tenant-b");

  const tenantAListedAnnouncements = capability.listAnnouncements(state, "tenant-a");
  const tenantBListedAnnouncements = capability.listAnnouncements(state, "tenant-b");
  const otherTenantListedAnnouncements = capability.listAnnouncements(state, "tenant-c");
  assert.strictEqual(tenantAListedAnnouncements.length, 1);
  assert.strictEqual(tenantBListedAnnouncements.length, 1);
  assert.strictEqual(otherTenantListedAnnouncements.length, 0);

  const tenantAHealth = capability.computeCustomerHealth(state, "tenant-a");
  const tenantBHealth = capability.computeCustomerHealth(state, "tenant-b");
  const otherTenantHealth = capability.computeCustomerHealth(state, "tenant-c");
  assert.strictEqual(tenantAHealth.ticketCount, 1);
  assert.strictEqual(tenantBHealth.ticketCount, 1);
  assert.strictEqual(otherTenantHealth.ticketCount, 0);

  const approvalForA = capability.requestSupportApproval(state, "tenant-a", "operator-a");
  assertCapabilityState(approvalForA);
  const deniedCrossTenantSession = capability.createSupportSession(approvalForA, "tenant-b", "operator-a", () => null);
  assertCapabilityError(deniedCrossTenantSession);
  assert.strictEqual(deniedCrossTenantSession.kind, "MISSING_APPROVAL" as const);
  assert.strictEqual(capability.checkSupportAccess(state, "tenant-b"), "DENIED" as const);
});

test("supportticketscustomerhealthannouncementsproof", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn: capability.AuditPort = (event) => {
    auditEvents.push(event);
    return null;
  };

  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "DENIED" as const);

  state = capability.requestSupportApproval(state, "tenant-a", "operator-a");
  assertCapabilityState(state);
  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "PENDING_APPROVAL" as const);

  const pendingSession = capability.createSupportSession(state, "tenant-a", "operator-a", auditFn);
  assertCapabilityError(pendingSession);
  assert.strictEqual(pendingSession.kind, "MISSING_APPROVAL" as const);

  state = capability.approveSupportRequest(state, "tenant-a", "operator-a", "approver-a");
  assertCapabilityState(state);
  assert.strictEqual(state.approvals[0].status, "APPROVED" as const);
  assert.strictEqual(capability.checkSupportAccess(state, "tenant-a"), "GRANTED" as const);

  const liveSession = capability.createSupportSession(state, "tenant-a", "operator-a", auditFn);
  assertCapabilityState(liveSession);
  assert.strictEqual(liveSession.sessions.length, 1);
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "SUPPORT_SESSION_CREATED" as const);
  assert.strictEqual(auditEvents[0].tenantId, "tenant-a");
  assert.strictEqual((auditEvents[0].metadata as { approvedBy: string | null }).approvedBy, "approver-a");
});

test("supportticketscustomerhealthannouncementsreadinessmodel", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn: capability.AuditPort = (event) => {
    auditEvents.push(event);
    return null;
  };

  assert.strictEqual(capability.initialState.readiness, "NOT_READY" as const);
  const readOnlyHealth = capability.computeCustomerHealth(capability.initialState, "tenant-a");
  assert.strictEqual(readOnlyHealth.ticketCount, 0);
  assert.strictEqual(readOnlyHealth.meteredUsage, 0);

  const blockedReadinessTicket = capability.createTicket(capability.initialState, "tenant-a", "operator-a", "Blocked", "Write path", () => null);
  assertCapabilityError(blockedReadinessTicket);
  assert.strictEqual(blockedReadinessTicket.kind, "DATABASE_FAILURE" as const);

  const blockedReadinessAnnouncement = capability.createAnnouncement(
    capability.initialState,
    "tenant-a",
    "operator-a",
    "Blocked announcement",
    "No writes in not ready",
    () => null,
  );
  assertCapabilityError(blockedReadinessAnnouncement);
  assert.strictEqual(blockedReadinessAnnouncement.kind, "DATABASE_FAILURE" as const);

  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };
  const readyTicket = capability.createTicket(state, "tenant-a", "operator-a", "Ready write", "Write path", auditFn);
  assertCapabilityState(readyTicket);
  state = readyTicket;
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(capability.listTickets(state, "tenant-a").length, 1);

  state = {
    ...state,
    readiness: "DEGRADED" as const,
    usageSignals: [{ tenantId: "tenant-a", usage: 42 }],
  };
  const degradedHealth = capability.computeCustomerHealth(state, "tenant-a");
  assert.strictEqual(degradedHealth.meteredUsage, 42);

  const degradedTicket = capability.createTicket(state, "tenant-a", "operator-a", "Should not write", "Read-only", () => null);
  assertCapabilityError(degradedTicket);
  assert.strictEqual(degradedTicket.kind, "DATABASE_FAILURE" as const);

  const degradedAnnouncement = capability.createAnnouncement(
    state,
    "tenant-a",
    "operator-a",
    "Should not write",
    "Read-only",
    () => null,
  );
  assertCapabilityError(degradedAnnouncement);
  assert.strictEqual(degradedAnnouncement.kind, "DATABASE_FAILURE" as const);

  assert.strictEqual(auditEvents.length, 1);
});

test("supportticketscustomerhealthannouncementsstatemodel", () => {
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  const createdTicket = capability.createTicket(
    state,
    "tenant-a",
    "operator-a",
    "State ticket",
    "Stateful fields",
    () => null,
  );
  assertCapabilityState(createdTicket);
  state = createdTicket;

  const ticket = state.tickets[0];
  assert.strictEqual(ticket.id.startsWith("ticket_"), true);
  assert.strictEqual(ticket.subject, "State ticket");
  assert.strictEqual(ticket.body, "Stateful fields");
  assert.strictEqual(ticket.status, "OPEN");
  assert.strictEqual(ticket.organisation, "tenant-a");
  assert.strictEqual(ticket.actor, "operator-a");
  assert.strictEqual(typeof ticket.createdAt, "string");

  state = {
    ...state,
    usageSignals: [{ tenantId: "tenant-a", usage: 33 }],
  };

  const computedHealth = capability.computeCustomerHealth(state, "tenant-a");
  assert.strictEqual(computedHealth.ticketCount, 1);
  assert.strictEqual(computedHealth.meteredUsage, 33);

  const noUsageHealth = capability.computeCustomerHealth(
    { ...state, usageSignals: [] },
    "tenant-a",
  );
  assert.strictEqual(noUsageHealth.meteredUsage, 0);

  const createdAnnouncement = capability.createAnnouncement(
    state,
    "tenant-a",
    "operator-a",
    "Health note",
    "Read-model check",
    () => null,
  );
  assertCapabilityState(createdAnnouncement);
  state = createdAnnouncement;

  const announcement = state.announcements[0];
  assert.strictEqual(announcement.id.startsWith("ann_"), true);
  assert.strictEqual(announcement.subject, "Health note");
  assert.strictEqual(announcement.message, "Read-model check");
  assert.strictEqual(announcement.creator, "operator-a");
  assert.strictEqual(typeof announcement.createdAt, "string");
  assert.strictEqual(announcement.tenantId, "tenant-a");

  const approvalRequested = capability.requestSupportApproval(state, "tenant-a", "operator-a");
  assertCapabilityState(approvalRequested);
  assert.strictEqual(approvalRequested.approvals[0].approverId, null);
  assert.strictEqual(approvalRequested.approvals[0].status, "PENDING" as const);
  assert.strictEqual(approvalRequested.sessions.length, 0);

  const approvalGranted = capability.approveSupportRequest(approvalRequested, "tenant-a", "operator-a", "approver-a");
  assertCapabilityState(approvalGranted);

  const session = capability.createSupportSession(approvalGranted, "tenant-a", "operator-a", () => null);
  assertCapabilityState(session);
  assert.strictEqual(session.sessions[0].tenantId, "tenant-a");
  assert.strictEqual(session.sessions[0].operatorId, "operator-a");
});

test("supportticketscustomerhealthannouncementsvalidation", () => {
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  const createdTicket = capability.createTicket(
    state,
    "tenant-a",
    "operator-a",
    "Validation ticket",
    "Must include subject and body",
    () => null,
  );
  assertCapabilityState(createdTicket);
  state = createdTicket;
  assert.strictEqual(state.tickets[0].id.startsWith("ticket_"), true);

  state = {
    ...state,
    usageSignals: [{ tenantId: "tenant-a", usage: 11 }],
  };
  const healthWithUsage = capability.computeCustomerHealth(state, "tenant-a");
  assert.strictEqual(healthWithUsage.ticketCount, 1);
  assert.strictEqual(healthWithUsage.meteredUsage, 11);

  const createdAnnouncement = capability.createAnnouncement(
    state,
    "tenant-a",
    "operator-a",
    "Validation announcement",
    "Must project subject message creator",
    () => null,
  );
  assertCapabilityState(createdAnnouncement);
  state = createdAnnouncement;
  assert.strictEqual(state.announcements[0].id.startsWith("ann_"), true);

  const announcementSummary = capability.listAnnouncements(state, "tenant-a");
  assert.strictEqual(announcementSummary[0].subject, "Validation announcement");
  assert.strictEqual(announcementSummary[0].message, "Must project subject message creator");
  assert.strictEqual(announcementSummary[0].creator, "operator-a");
  assert.ok(!("tenantId" in announcementSummary[0]));

  const blockedByApproval = capability.createSupportSession(state, "tenant-a", "operator-a", () => null);
  assertCapabilityError(blockedByApproval);
  assert.strictEqual(blockedByApproval.kind, "MISSING_APPROVAL" as const);

  const approvalRequested = capability.requestSupportApproval(state, "tenant-a", "operator-a");
  assertCapabilityState(approvalRequested);
  const approvalGranted = capability.approveSupportRequest(approvalRequested, "tenant-a", "operator-a", "approver-a");
  assertCapabilityState(approvalGranted);
  const liveSession = capability.createSupportSession(approvalGranted, "tenant-a", "operator-a", () => null);
  assertCapabilityState(liveSession);
  assert.strictEqual(liveSession.sessions.length, 1);

  const invalidTicket = capability.createTicket(state, "tenant-a", "operator-a", "", "Missing subject", () => null);
  assertCapabilityError(invalidTicket);
  assert.strictEqual(invalidTicket.kind, "VALIDATION_ERROR" as const);

  const invalidAnnouncement = capability.createAnnouncement(state, "tenant-a", "operator-a", "Missing message", "", () => null);
  assertCapabilityError(invalidAnnouncement);
  assert.strictEqual(invalidAnnouncement.kind, "VALIDATION_ERROR" as const);
});