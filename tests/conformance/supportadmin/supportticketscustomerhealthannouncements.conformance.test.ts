import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/supportadmin/supportticketscustomerhealthannouncements.ts";

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

  // Ticket creation audit
  const ticketRes = capability.createTicket(
    state,
    "tenant-1",
    "operator-1",
    "Subject A",
    "Body A",
    auditFn,
  );
  if ("tickets" in ticketRes) {
    state = ticketRes;
  } else {
    assert.fail("Ticket creation should succeed");
  }

  // Announcement creation audit
  const annRes = capability.createAnnouncement(
    state,
    "tenant-1",
    "operator-1",
    "Announce",
    "Message",
    auditFn,
  );
  if ("announcements" in annRes) {
    state = annRes;
  } else {
    assert.fail("Announcement creation should succeed");
  }

  // Request approval (no audit for request, but lifecycle check)
  state = capability.requestSupportApproval(state, "tenant-1", "operator-1");
  assert.strictEqual(
    capability.checkSupportAccess(state, "tenant-1"),
    "PENDING_APPROVAL" as const,
  );

  // Attempt session before approval should error
  const sessErr = capability.createSupportSession(state, "tenant-1", "operator-1", auditFn);
  assert.strictEqual((sessErr as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "MISSING_APPROVAL" as const);

  // Approve and create session with audit
  const approved = capability.approveSupportRequest(state, "tenant-1", "operator-1", "approver-1");
  if ("approvals" in approved) {
    state = approved;
  } else {
    assert.fail("Approval should succeed");
  }

  const sessRes = capability.createSupportSession(state, "tenant-1", "operator-1", auditFn);
  if ("sessions" in sessRes) {
    state = sessRes;
  } else {
    assert.fail("Session creation should succeed");
  }

  // Verify audit chain
  assert.strictEqual(auditEvents.length, 3);
  assert.deepStrictEqual(
    auditEvents.map((e) => e.kind),
    ["TICKET_MUTATION", "ANNOUNCEMENT_MUTATION", "SUPPORT_SESSION_CREATED"],
  );
  assert.strictEqual(auditEvents[0].tenantId, "tenant-1");
  assert.strictEqual(auditEvents[0].actorId, "operator-1");
  assert.ok(auditEvents[0].resourceId.startsWith("ticket_"));
  assert.strictEqual((auditEvents[0].metadata as { action: string }).action, "CREATE");

  assert.strictEqual(auditEvents[1].tenantId, "tenant-1");
  assert.strictEqual(auditEvents[1].actorId, "operator-1");
  assert.ok(auditEvents[1].resourceId.startsWith("ann_"));
  assert.strictEqual((auditEvents[1].metadata as { action: string }).action, "CREATE");

  assert.strictEqual(auditEvents[2].tenantId, "tenant-1");
  assert.strictEqual(auditEvents[2].actorId, "operator-1");
  assert.strictEqual((auditEvents[2].metadata as { approvedBy: string | null }).approvedBy, "approver-1");
});

test("supportticketscustomerhealthannouncementscontracts", () => {
  const auditFn: capability.AuditPort = () => null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Ticket contract
  const ticketRes = capability.createTicket(state, "tA", "opA", "Contract Ticket", "Body", auditFn);
  if ("tickets" in ticketRes) {
    state = ticketRes;
  } else {
    assert.fail("Ticket contract failed");
  }
  const tickets = capability.listTickets(state, "tA");
  assert.strictEqual(tickets.length, 1);
  const updRes = capability.updateTicket(
    state,
    "tA",
    "opA",
    tickets[0].id,
    { status: "CLOSED" },
    auditFn,
  );
  if ("tickets" in updRes) {
    state = updRes;
    assert.strictEqual(state.tickets[0].status, "CLOSED");
  } else {
    assert.fail("Ticket update failed");
  }

  // Health read contract
  const health = capability.computeCustomerHealth(state, "tA");
  assert.strictEqual(health.tenantId, "tA");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 0);

  // Announcement contract
  const annRes = capability.createAnnouncement(state, "tA", "opA", "Ann", "Msg", auditFn);
  if ("announcements" in annRes) {
    state = annRes;
  } else {
    assert.fail("Announcement contract failed");
  }
  const anns = capability.listAnnouncements(state, "tA");
  assert.strictEqual(anns.length, 1);

  // Approval workflow boundary
  assert.strictEqual(capability.checkSupportAccess(state, "tA"), "DENIED" as const);
  state = capability.requestSupportApproval(state, "tA", "opA");
  assert.strictEqual(capability.checkSupportAccess(state, "tA"), "PENDING_APPROVAL" as const);
  state = capability.approveSupportRequest(state, "tA", "opA", "appr");
  assert.strictEqual(capability.checkSupportAccess(state, "tA"), "GRANTED" as const);
  const sessRes = capability.createSupportSession(state, "tA", "opA", auditFn);
  if ("sessions" in sessRes) {
    assert.strictEqual(sessRes.sessions.length, 1);
  } else {
    assert.fail("Session creation after approval failed");
  }
});

test("supportticketscustomerhealthannouncementserrormodel", () => {
  // Database readiness error
  const notReadyRes = capability.createTicket(
    capability.initialState,
    "tX",
    "opX",
    "Subj",
    "Body",
    () => null,
  );
  assert.strictEqual((notReadyRes as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "DATABASE_FAILURE" as const);

  // Use-case failure on missing ticket
  const readyState: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };
  const missingRes = capability.updateTicket(
    readyState,
    "tX",
    "opX",
    "nonexistent",
    { status: "OPEN" },
    () => null,
  );
  assert.strictEqual((missingRes as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "USE_CASE_FAILURE" as const);

  // Missing approval keeps access denied
  const pending = capability.requestSupportApproval(readyState, "tX", "reqX");
  assert.strictEqual(capability.checkSupportAccess(pending, "tX"), "PENDING_APPROVAL" as const);
  const blockedSess = capability.createSupportSession(pending, "tX", "opX", () => null);
  assert.strictEqual((blockedSess as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "MISSING_APPROVAL" as const);

  // Health signal defaults to zero when no data
  const healthZero = capability.computeCustomerHealth(pending, "tX");
  assert.strictEqual(healthZero.ticketCount, 0);
  assert.strictEqual(healthZero.meteredUsage, 0);

  // Cross-tenant access denied
  assert.strictEqual(capability.checkSupportAccess(capability.initialState, "other"), "DENIED" as const);
});

test("supportticketscustomerhealthannouncementslifecycle", () => {
  const auditFn: capability.AuditPort = () => null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Ticket lifecycle
  const crTicket = capability.createTicket(state, "tL", "opL", "Life ticket", "Body", auditFn);
  if ("tickets" in crTicket) state = crTicket;
  const listT = capability.listTickets(state, "tL");
  assert.strictEqual(listT.length, 1);
  const updTicket = capability.updateTicket(
    state,
    "tL",
    "opL",
    listT[0].id,
    { subject: "Updated" },
    auditFn,
  );
  if ("tickets" in updTicket) state = updTicket;

  // Health computation
  const health = capability.computeCustomerHealth(state, "tL");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 0);

  // Announcement lifecycle
  const crAnn = capability.createAnnouncement(state, "tL", "opL", "Note", "Content", auditFn);
  if ("announcements" in crAnn) state = crAnn;
  const annList = capability.listAnnouncements(state, "tL");
  assert.strictEqual(annList.length, 1);
  assert.strictEqual(annList[0].subject, "Note");
  assert.strictEqual(annList[0].creator, "opL");

  // Approval workflow gating
  state = capability.requestSupportApproval(state, "tL", "opL");
  assert.strictEqual(capability.checkSupportAccess(state, "tL"), "PENDING_APPROVAL" as const);
  const blocked = capability.createSupportSession(state, "tL", "opL", auditFn);
  assert.strictEqual((blocked as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "MISSING_APPROVAL" as const);
  state = capability.approveSupportRequest(state, "tL", "opL", "apprL");
  const sess = capability.createSupportSession(state, "tL", "opL", auditFn);
  if ("sessions" in sess) {
    assert.strictEqual(sess.sessions.length, 1);
  } else {
    assert.fail("Session should be created after approval");
  }
});

test("supportticketscustomerhealthannouncementspermissions", () => {
  const auditFn: capability.AuditPort = (e) => e && e.actorId ? null : null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Tenant A ticket
  const aTicket = capability.createTicket(state, "A", "opA", "A ticket", "Body", auditFn);
  if ("tickets" in aTicket) state = aTicket;
  // Tenant B ticket
  const bTicket = capability.createTicket(state, "B", "opB", "B ticket", "Body", auditFn);
  if ("tickets" in bTicket) state = bTicket;

  // Verify isolation
  const listA = capability.listTickets(state, "A");
  const listB = capability.listTickets(state, "B");
  const listC = capability.listTickets(state, "C");
  assert.strictEqual(listA.length, 1);
  assert.strictEqual(listA[0].organisation, "A");
  assert.strictEqual(listB.length, 1);
  assert.strictEqual(listB[0].organisation, "B");
  assert.strictEqual(listC.length, 0);

  // Announcements isolation
  const aAnn = capability.createAnnouncement(state, "A", "opA", "AnnA", "MsgA", auditFn);
  if ("announcements" in aAnn) state = aAnn;
  const bAnn = capability.createAnnouncement(state, "B", "opB", "AnnB", "MsgB", auditFn);
  if ("announcements" in bAnn) state = bAnn;

  const annsA = capability.listAnnouncements(state, "A");
  const annsB = capability.listAnnouncements(state, "B");
  const annsC = capability.listAnnouncements(state, "C");
  assert.strictEqual(annsA.length, 1);
  assert.strictEqual(annsB.length, 1);
  assert.strictEqual(annsC.length, 0);

  // Health isolation
  const healthA = capability.computeCustomerHealth(state, "A");
  const healthB = capability.computeCustomerHealth(state, "B");
  const healthC = capability.computeCustomerHealth(state, "C");
  assert.strictEqual(healthA.ticketCount, 1);
  assert.strictEqual(healthB.ticketCount, 1);
  assert.strictEqual(healthC.ticketCount, 0);

  // Cross-tenant session attempt fails
  const apprA = capability.requestSupportApproval(state, "A", "opA");
  const crossSess = capability.createSupportSession(apprA, "B", "opA", auditFn);
  assert.strictEqual((crossSess as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "MISSING_APPROVAL" as const);
  assert.strictEqual(capability.checkSupportAccess(state, "B"), "DENIED" as const);
});

test("supportticketscustomerhealthannouncementsproof", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn: capability.AuditPort = (e) => {
    auditEvents.push(e);
    return null;
  };
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Initial denial
  assert.strictEqual(capability.checkSupportAccess(state, "P"), "DENIED" as const);

  // Request approval (pending)
  state = capability.requestSupportApproval(state, "P", "opP");
  assert.strictEqual(capability.checkSupportAccess(state, "P"), "PENDING_APPROVAL" as const);

  // Session blocked
  const blocked = capability.createSupportSession(state, "P", "opP", auditFn);
  assert.strictEqual((blocked as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "MISSING_APPROVAL" as const);

  // Approve and create session (live)
  state = capability.approveSupportRequest(state, "P", "opP", "apprP");
  assert.strictEqual(capability.checkSupportAccess(state, "P"), "GRANTED" as const);
  const live = capability.createSupportSession(state, "P", "opP", auditFn);
  if ("sessions" in live) {
    assert.strictEqual(live.sessions.length, 1);
  } else {
    assert.fail("Live session should succeed");
  }
  // Verify audit lifecycle
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "SUPPORT_SESSION_CREATED" as const);
  assert.strictEqual(auditEvents[0].tenantId, "P");
  assert.strictEqual((auditEvents[0].metadata as { approvedBy: string | null }).approvedBy, "apprP");
});

test("supportticketscustomerhealthannouncementsreadinessmodel", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn: capability.AuditPort = (e) => {
    auditEvents.push(e);
    return null;
  };

  // Initial not ready state
  assert.strictEqual(capability.initialState.readiness, "NOT_READY" as const);
  const healthInit = capability.computeCustomerHealth(capability.initialState, "any");
  assert.strictEqual(healthInit.ticketCount, 0);
  assert.strictEqual(healthInit.meteredUsage, 0);

  // Write attempts blocked
  const blockedTicket = capability.createTicket(
    capability.initialState,
    "any",
    "op",
    "Sub",
    "Body",
    () => null,
  );
  assert.strictEqual((blockedTicket as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "DATABASE_FAILURE" as const);
  const blockedAnn = capability.createAnnouncement(
    capability.initialState,
    "any",
    "op",
    "Sub",
    "Msg",
    () => null,
  );
  assert.strictEqual((blockedAnn as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "DATABASE_FAILURE" as const);

  // Ready state allows writes
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };
  const ticketOk = capability.createTicket(state, "T", "op", "Ok", "Ok", auditFn);
  if ("tickets" in ticketOk) state = ticketOk;
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(capability.listTickets(state, "T").length, 1);

  // Degraded read-only mode
  state = {
    ...state,
    readiness: "DEGRADED" as const,
    usageSignals: [{ tenantId: "T", usage: 42 }],
  };
  const healthDeg = capability.computeCustomerHealth(state, "T");
  assert.strictEqual(healthDeg.meteredUsage, 42);
  const ticketDeg = capability.createTicket(state, "T", "op", "No", "Write", () => null);
  assert.strictEqual((ticketDeg as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "DATABASE_FAILURE" as const);
  const annDeg = capability.createAnnouncement(state, "T", "op", "No", "Write", () => null);
  assert.strictEqual((annDeg as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "DATABASE_FAILURE" as const);
  assert.strictEqual(auditEvents.length, 1); // no new audit events in degraded mode
});

test("supportticketscustomerhealthannouncementsstatemodel", () => {
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Ticket creation reflects all fields
  const ticketRes = capability.createTicket(state, "S", "opS", "State Ticket", "Details", () => null);
  if ("tickets" in ticketRes) state = ticketRes;
  const t = state.tickets[0];
  assert.ok(t.id.startsWith("ticket_"));
  assert.strictEqual(t.subject, "State Ticket");
  assert.strictEqual(t.body, "Details");
  assert.strictEqual(t.status, "OPEN");
  assert.strictEqual(t.organisation, "S");
  assert.strictEqual(t.actor, "opS");
  assert.strictEqual(typeof t.createdAt, "string");

  // Usage signal aggregation
  state = { ...state, usageSignals: [{ tenantId: "S", usage: 33 }] };
  const health = capability.computeCustomerHealth(state, "S");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 33);
  const noUsage = capability.computeCustomerHealth({ ...state, usageSignals: [] }, "S");
  assert.strictEqual(noUsage.meteredUsage, 0);

  // Announcement fields
  const annRes = capability.createAnnouncement(state, "S", "opS", "Ann Title", "Ann Body", () => null);
  if ("announcements" in annRes) state = annRes;
  const a = state.announcements[0];
  assert.ok(a.id.startsWith("ann_"));
  assert.strictEqual(a.subject, "Ann Title");
  assert.strictEqual(a.message, "Ann Body");
  assert.strictEqual(a.creator, "opS");
  assert.strictEqual(typeof a.createdAt, "string");
  assert.strictEqual(a.tenantId, "S");

  // Approval and session state
  const apprState = capability.requestSupportApproval(state, "S", "opS");
  assert.strictEqual(apprState.approvals[0].status, "PENDING" as const);
  assert.strictEqual(apprState.approvals[0].approverId, null);
  const granted = capability.approveSupportRequest(apprState, "S", "opS", "apprS");
  if ("approvals" in granted) {
    assert.strictEqual(granted.approvals[0].status, "APPROVED" as const);
  } else {
    assert.fail("Approval grant failed");
  }
  const sess = capability.createSupportSession(granted, "S", "opS", () => null);
  if ("sessions" in sess) {
    assert.strictEqual(sess.sessions[0].tenantId, "S");
    assert.strictEqual(sess.sessions[0].operatorId, "opS");
  } else {
    assert.fail("Session creation failed");
  }
});

test("supportticketscustomerhealthannouncementsvalidation", () => {
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Valid ticket creation returns identifier
  const ticketRes = capability.createTicket(state, "V", "opV", "Valid Ticket", "Body", () => null);
  if ("tickets" in ticketRes) {
    state = ticketRes;
    assert.ok(state.tickets[0].id.startsWith("ticket_"));
  } else {
    assert.fail("Valid ticket should succeed");
  }

  // Health includes usage when present
  state = { ...state, usageSignals: [{ tenantId: "V", usage: 11 }] };
  const health = capability.computeCustomerHealth(state, "V");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 11);

  // Announcement creation and projection
  const annRes = capability.createAnnouncement(state, "V", "opV", "Valid Ann", "Content", () => null);
  if ("announcements" in annRes) {
    state = annRes;
    assert.ok(state.announcements[0].id.startsWith("ann_"));
  } else {
    assert.fail("Valid announcement should succeed");
  }
  const proj = capability.listAnnouncements(state, "V")[0];
  assert.strictEqual(proj.subject, "Valid Ann");
  assert.strictEqual(proj.message, "Content");
  assert.strictEqual(proj.creator, "opV");
  assert.ok(!("tenantId" in proj));

  // Support session blocked without approval
  const blocked = capability.createSupportSession(state, "V", "opV", () => null);
  assert.strictEqual((blocked as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "MISSING_APPROVAL" as const);

  // Full approval flow
  const req = capability.requestSupportApproval(state, "V", "opV");
  const appr = capability.approveSupportRequest(req, "V", "opV", "apprV");
  const sess = capability.createSupportSession(appr, "V", "opV", () => null);
  if ("sessions" in sess) {
    assert.strictEqual(sess.sessions.length, 1);
  } else {
    assert.fail("Session after approval should succeed");
  }

  // Invalid ticket input validation
  const invalidTicket = capability.createTicket(state, "V", "opV", "", "No subject", () => null);
  assert.strictEqual((invalidTicket as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "VALIDATION_ERROR" as const);

  // Invalid announcement input validation
  const invalidAnn = capability.createAnnouncement(state, "V", "opV", "Sub", "", () => null);
  assert.strictEqual((invalidAnn as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "VALIDATION_ERROR" as const);
});