import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/supportadmin/supportticketscustomerhealthannouncements.ts";

test("supportticketscustomerhealthannouncementsauditmodel", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn = (event: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent): capability.SupportTicketsCustomerHealthAnnouncementsError | null => {
    auditEvents.push(event);
    return null;
  };

  let state = capability.initialState;
  const ticketResult = capability.createSupportTicket(state, {
    subject: "Test Subject",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, auditFn);
  assert.ok(!('kind' in ticketResult));
  state = ticketResult;
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, 'TICKET_MUTATION');
  assert.strictEqual(auditEvents[0].entityType, 'TICKET');
  assert.strictEqual(auditEvents[0].actor, 'user1');

  const announcementResult = capability.createAnnouncement(state, {
    subject: "Test Announcement",
    message: "Test Message",
    createdBy: "user1"
  }, auditFn);
  assert.ok(!('kind' in announcementResult));
  state = announcementResult;
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[1].kind, 'ANNOUNCEMENT_MUTATION');
  assert.strictEqual(auditEvents[1].entityType, 'ANNOUNCEMENT');

  const approvalResult = capability.requestSupportApproval(state, "user1", "org1", auditFn);
  assert.ok(!('kind' in approvalResult));
  state = approvalResult;
  assert.strictEqual(auditEvents.length, 3);
  assert.strictEqual(auditEvents[2].kind, 'APPROVAL_WORKFLOW');

  const approveResult = capability.approveSupportRequest(state, state.approvals[0].id, "approver1", auditFn);
  assert.ok(!('kind' in approveResult));
  state = approveResult;
  assert.strictEqual(auditEvents.length, 4);
  assert.strictEqual(auditEvents[3].kind, 'APPROVAL_WORKFLOW');

  const sessionResult = capability.createSupportSession(state, state.approvals[0].id, "user1", auditFn);
  assert.ok(!('kind' in sessionResult));
  assert.strictEqual(auditEvents.length, 5);
  assert.strictEqual(auditEvents[4].kind, 'SESSION_CREATED');
});

test("supportticketscustomerhealthannouncementscontracts", () => {
  const state = capability.initialState;
  const ticketResult = capability.createSupportTicket(state, {
    subject: "Test Subject",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in ticketResult));
  assert.strictEqual(ticketResult.tickets.length, 1);

  const listResult = capability.listSupportTickets(ticketResult, "org1", "user1");
  assert.ok(!('kind' in listResult));
  assert.strictEqual(listResult.length, 1);

  const updateResult = capability.updateSupportTicket(ticketResult, ticketResult.tickets[0].id, { status: "CLOSED" }, "user1", () => null);
  assert.ok(!('kind' in updateResult));
  assert.strictEqual(updateResult.tickets[0].status, "CLOSED");

  const healthResult = capability.computeCustomerHealth(ticketResult, "org1");
  assert.ok(!('kind' in healthResult));
  assert.strictEqual(healthResult.organisationId, "org1");

  const announcementResult = capability.createAnnouncement(state, {
    subject: "Test Announcement",
    message: "Test Message",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in announcementResult));
  assert.strictEqual(announcementResult.announcements.length, 1);

  const listAnnouncementsResult = capability.listAnnouncements(announcementResult, "org1", "user1");
  assert.ok(!('kind' in listAnnouncementsResult));

  const approvalResult = capability.requestSupportApproval(state, "user1", "org1", () => null);
  assert.ok(!('kind' in approvalResult));
  assert.strictEqual(approvalResult.approvals.length, 1);

  const approveResult = capability.approveSupportRequest(approvalResult, approvalResult.approvals[0].id, "approver1", () => null);
  assert.ok(!('kind' in approveResult));
  assert.strictEqual(approveResult.approvals[0].status, 'APPROVED');
});

test("supportticketscustomerhealthannouncementserrormodel", () => {
  const state = capability.initialState;
  const errorResult = capability.createSupportTicket(state, {
    subject: "",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok('kind' in errorResult);
  assert.strictEqual(errorResult.kind, 'INVALID_INPUT');

  const sessionErrorResult = capability.createSupportSession(state, "non-existent", "user1", () => null);
  assert.ok('kind' in sessionErrorResult);
  assert.strictEqual(sessionErrorResult.kind, 'MISSING_APPROVAL');

  const healthResult = capability.computeCustomerHealth(state, "org1");
  assert.ok(!('kind' in healthResult));
  assert.strictEqual(healthResult.ticketCount, 0);
  assert.strictEqual(healthResult.usageCount, 0);
});

test("supportticketscustomerhealthannouncementslifecycle", () => {
  let state = capability.initialState;
  const ticketResult = capability.createSupportTicket(state, {
    subject: "Test Subject",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in ticketResult));
  state = ticketResult;

  const listResult = capability.listSupportTickets(state, "org1", "user1");
  assert.ok(!('kind' in listResult));
  assert.strictEqual(listResult.length, 1);

  const updateResult = capability.updateSupportTicket(state, state.tickets[0].id, { status: "CLOSED" }, "user1", () => null);
  assert.ok(!('kind' in updateResult));
  state = updateResult;

  const healthResult = capability.computeCustomerHealth(state, "org1");
  assert.ok(!('kind' in healthResult));
  assert.strictEqual(healthResult.ticketCount, 1);

  const announcementResult = capability.createAnnouncement(state, {
    subject: "Test Announcement",
    message: "Test Message",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in announcementResult));
  state = announcementResult;

  const listAnnouncementsResult = capability.listAnnouncements(state, "org1", "user1");
  assert.ok(!('kind' in listAnnouncementsResult));

  const approvalResult = capability.requestSupportApproval(state, "user1", "org1", () => null);
  assert.ok(!('kind' in approvalResult));
  state = approvalResult;

  const approveResult = capability.approveSupportRequest(state, state.approvals[0].id, "approver1", () => null);
  assert.ok(!('kind' in approveResult));
  state = approveResult;

  const sessionResult = capability.createSupportSession(state, state.approvals[0].id, "user1", () => null);
  assert.ok(!('kind' in sessionResult));
  assert.strictEqual(sessionResult.sessions.length, 1);
});

test("supportticketscustomerhealthannouncementspermissions", () => {
  let state = capability.initialState;
  const ticketResult = capability.createSupportTicket(state, {
    subject: "Test Subject",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in ticketResult));
  state = ticketResult;

  const listResult = capability.listSupportTickets(state, "org1", "user1");
  assert.ok(!('kind' in listResult));
  assert.strictEqual(listResult.length, 1);

  const otherOrgListResult = capability.listSupportTickets(state, "org2", "user1");
  assert.ok(!('kind' in otherOrgListResult));
  assert.strictEqual(otherOrgListResult.length, 0);

  const announcementResult = capability.createAnnouncement(state, {
    subject: "Test Announcement",
    message: "Test Message for org1",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in announcementResult));
  state = announcementResult;

  const listAnnouncementsResult = capability.listAnnouncements(state, "org1", "user1");
  assert.ok(!('kind' in listAnnouncementsResult));
  assert.strictEqual(listAnnouncementsResult.length, 1);

  const otherOrgAnnouncementsResult = capability.listAnnouncements(state, "org2", "user1");
  assert.ok(!('kind' in otherOrgAnnouncementsResult));
  assert.strictEqual(otherOrgAnnouncementsResult.length, 0);

  const approvalResult = capability.requestSupportApproval(state, "user1", "org1", () => null);
  assert.ok(!('kind' in approvalResult));
  state = approvalResult;

  const sessionErrorResult = capability.createSupportSession(state, state.approvals[0].id, "user1", () => null);
  assert.ok('kind' in sessionErrorResult);
  assert.strictEqual(sessionErrorResult.kind, 'MISSING_APPROVAL');
});

test("supportticketscustomerhealthannouncementsproof", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn = (event: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent): capability.SupportTicketsCustomerHealthAnnouncementsError | null => {
    auditEvents.push(event);
    return null;
  };

  let state = capability.initialState;
  const approvalResult = capability.requestSupportApproval(state, "user1", "org1", auditFn);
  assert.ok(!('kind' in approvalResult));
  state = approvalResult;
  assert.strictEqual(state.approvals.length, 1);
  assert.strictEqual(state.approvals[0].status, 'PENDING');

  const approveResult = capability.approveSupportRequest(state, state.approvals[0].id, "approver1", auditFn);
  assert.ok(!('kind' in approveResult));
  state = approveResult;
  assert.strictEqual(state.approvals[0].status, 'APPROVED');

  const sessionResult = capability.createSupportSession(state, state.approvals[0].id, "user1", auditFn);
  assert.ok(!('kind' in sessionResult));
  assert.strictEqual(sessionResult.sessions.length, 1);
  assert.strictEqual(auditEvents.filter(e => e.kind === 'SESSION_CREATED').length, 1);
});

test("supportticketscustomerhealthannouncementsreadinessmodel", () => {
  let state = capability.initialState;
  assert.strictEqual(capability.checkReadiness(state), 'NOT_READY');

  state = capability.setReadiness(state, 'READY');
  assert.strictEqual(capability.checkReadiness(state), 'READY');

  const listResult = capability.listSupportTickets(state, "org1", "user1");
  assert.ok(!('kind' in listResult));

  state = capability.setReadiness(state, 'DEGRADED');
  assert.strictEqual(capability.checkReadiness(state), 'DEGRADED');

  const mutationResult = capability.createSupportTicket(state, {
    subject: "Test Subject",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in mutationResult));
});

test("supportticketscustomerhealthannouncementsstatemodel", () => {
  let state = capability.initialState;
  const ticketResult = capability.createSupportTicket(state, {
    subject: "Test Subject",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in ticketResult));
  state = ticketResult;
  assert.strictEqual(state.tickets.length, 1);
  assert.strictEqual(state.tickets[0].subject, "Test Subject");
  assert.strictEqual(state.tickets[0].organisationId, "org1");

  const healthResult = capability.computeCustomerHealth(state, "org1");
  assert.ok(!('kind' in healthResult));
  assert.strictEqual(healthResult.ticketCount, 1);

  const announcementResult = capability.createAnnouncement(state, {
    subject: "Test Announcement",
    message: "Test Message",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in announcementResult));
  state = announcementResult;
  assert.strictEqual(state.announcements.length, 1);
  assert.strictEqual(state.announcements[0].subject, "Test Announcement");

  const approvalResult = capability.requestSupportApproval(state, "user1", "org1", () => null);
  assert.ok(!('kind' in approvalResult));
  state = approvalResult;
  assert.strictEqual(state.approvals.length, 1);

  const approveResult = capability.approveSupportRequest(state, state.approvals[0].id, "approver1", () => null);
  assert.ok(!('kind' in approveResult));
  state = approveResult;

  const sessionResult = capability.createSupportSession(state, state.approvals[0].id, "user1", () => null);
  assert.ok(!('kind' in sessionResult));
  assert.strictEqual(state.sessions.length, 0);
  state = sessionResult;
  assert.strictEqual(state.sessions.length, 1);
});

test("supportticketscustomerhealthannouncementsvalidation", () => {
  const state = capability.initialState;
  const ticketResult = capability.createSupportTicket(state, {
    subject: "Test Subject",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in ticketResult));
  assert.ok(ticketResult.tickets[0].id.startsWith('ticket-'));

  const healthResult = capability.computeCustomerHealth(ticketResult, "org1");
  assert.ok(!('kind' in healthResult));
  assert.strictEqual(healthResult.ticketCount, 1);
  assert.strictEqual(healthResult.usageCount, 0);

  const announcementResult = capability.createAnnouncement(state, {
    subject: "Test Announcement",
    message: "Test Message",
    createdBy: "user1"
  }, () => null);
  assert.ok(!('kind' in announcementResult));
  assert.ok(announcementResult.announcements[0].id.startsWith('announcement-'));

  const listAnnouncementsResult = capability.listAnnouncements(announcementResult, "org1", "user1");
  assert.ok(!('kind' in listAnnouncementsResult));
  assert.strictEqual(listAnnouncementsResult[0].subject, "Test Announcement");

  const approvalResult = capability.requestSupportApproval(state, "user1", "org1", () => null);
  assert.ok(!('kind' in approvalResult));
  const approveResult = capability.approveSupportRequest(approvalResult, approvalResult.approvals[0].id, "approver1", () => null);
  assert.ok(!('kind' in approveResult));
  const sessionResult = capability.createSupportSession(approveResult, approveResult.approvals[0].id, "user1", () => null);
  assert.ok(!('kind' in sessionResult));
  assert.strictEqual(sessionResult.sessions.length, 1);

  const invalidTicketResult = capability.createSupportTicket(state, {
    subject: "",
    body: "Test Body",
    organisationId: "org1",
    createdBy: "user1"
  }, () => null);
  assert.ok('kind' in invalidTicketResult);
  assert.strictEqual(invalidTicketResult.kind, 'INVALID_INPUT');
});