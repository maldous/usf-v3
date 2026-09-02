import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/supportadmin/supportticketscustomerhealthannouncements.ts";

type Result =
  | capability.SupportTicketsCustomerHealthAnnouncementsState
  | capability.SupportTicketsCustomerHealthAnnouncementsError;

function isError(r: Result): r is capability.SupportTicketsCustomerHealthAnnouncementsError {
  return (r as capability.SupportTicketsCustomerHealthAnnouncementsError).kind !== undefined
    && !("tickets" in (r as object));
}

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

  // Ticket creation emits TICKET_MUTATION audit
  const ticketRes = capability.createTicket(
    state,
    "tenant-1",
    "operator-1",
    "Subject A",
    "Body A",
    auditFn,
  );
  assert.ok(!isError(ticketRes), "Ticket creation should succeed");
  state = ticketRes;

  // Announcement creation emits ANNOUNCEMENT_MUTATION audit
  const annRes = capability.createAnnouncement(
    state,
    "tenant-1",
    "operator-1",
    "Announce",
    "Message",
    auditFn,
  );
  assert.ok(!isError(annRes), "Announcement creation should succeed");
  state = annRes;

  // Support session creation emits SUPPORT_SESSION_CREATED audit
  // (gated by approval, so approval must be requested and approved first)
  state = capability.requestSupportApproval(state, "tenant-1", "operator-1");
  assert.strictEqual(
    capability.checkSupportAccess(state, "tenant-1"),
    "PENDING_APPROVAL" as const,
  );

  // Session before approval is denied (no audit emission)
  const blockedRes = capability.createSupportSession(state, "tenant-1", "operator-1", auditFn);
  assert.ok(isError(blockedRes));
  assert.strictEqual((blockedRes as capability.SupportTicketsCustomerHealthAnnouncementsError).kind, "MISSING_APPROVAL" as const);
  assert.strictEqual(auditEvents.length, 2, "Blocked session must not produce an audit event");

  // Approval completion, then session creation with audit
  const approved = capability.approveSupportRequest(state, "tenant-1", "operator-1", "approver-1");
  assert.ok(!isError(approved), "Approval should succeed");
  state = approved;

  const sessRes = capability.createSupportSession(state, "tenant-1", "operator-1", auditFn);
  assert.ok(!isError(sessRes), "Session creation should succeed");
  state = sessRes;

  // Verify ordered audit lifecycle: TICKET, ANNOUNCEMENT, SUPPORT_SESSION_CREATED
  assert.strictEqual(auditEvents.length, 3);
  assert.deepStrictEqual(
    auditEvents.map((e) => e.kind),
    ["TICKET_MUTATION", "ANNOUNCEMENT_MUTATION", "SUPPORT_SESSION_CREATED"],
  );

  // Ticket audit attributable to actor/tenant
  assert.strictEqual(auditEvents[0].kind, "TICKET_MUTATION" as const);
  assert.strictEqual(auditEvents[0].tenantId, "tenant-1");
  assert.strictEqual(auditEvents[0].actorId, "operator-1");
  assert.ok(auditEvents[0].resourceId.startsWith("ticket_"));
  assert.strictEqual(
    (auditEvents[0].metadata as { action: string }).action,
    "CREATE",
  );

  // Announcement audit attributable to actor/tenant
  assert.strictEqual(auditEvents[1].kind, "ANNOUNCEMENT_MUTATION" as const);
  assert.strictEqual(auditEvents[1].tenantId, "tenant-1");
  assert.strictEqual(auditEvents[1].actorId, "operator-1");
  assert.ok(auditEvents[1].resourceId.startsWith("ann_"));

  // Support-session audit carries approver attribution
  assert.strictEqual(auditEvents[2].kind, "SUPPORT_SESSION_CREATED" as const);
  assert.strictEqual(auditEvents[2].tenantId, "tenant-1");
  assert.strictEqual(auditEvents[2].actorId, "operator-1");
  assert.ok(auditEvents[2].resourceId.startsWith("sess_"));
  assert.strictEqual(
    (auditEvents[2].metadata as { approvedBy: string | null }).approvedBy,
    "approver-1",
  );
});

test("supportticketscustomerhealthannouncementscontracts", () => {
  const auditFn: capability.AuditPort = () => null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Ticket create contract returns new state with a ticket
  const ticketRes = capability.createTicket(state, "tA", "opA", "Contract Ticket", "Body", auditFn);
  assert.ok(!isError(ticketRes), "Ticket contract failed");
  state = ticketRes;

  // Ticket list contract returns tenant-scoped tickets
  const tickets = capability.listTickets(state, "tA");
  assert.strictEqual(tickets.length, 1);
  assert.strictEqual(tickets[0].subject, "Contract Ticket");

  // Ticket update contract returns new state with the update applied
  const updRes = capability.updateTicket(
    state,
    "tA",
    "opA",
    tickets[0].id,
    { status: "CLOSED" },
    auditFn,
  );
  assert.ok(!isError(updRes), "Ticket update should succeed");
  state = updRes;
  assert.strictEqual(state.tickets[0].status, "CLOSED");

  // Customer-health read contract
  const health = capability.computeCustomerHealth(state, "tA");
  assert.strictEqual(health.tenantId, "tA");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 0);

  // Announcement create contract
  const annRes = capability.createAnnouncement(state, "tA", "opA", "Ann", "Msg", auditFn);
  assert.ok(!isError(annRes), "Announcement contract failed");
  state = annRes;

  // Announcement list contract projects subject/message/creator
  const anns = capability.listAnnouncements(state, "tA");
  assert.strictEqual(anns.length, 1);
  assert.strictEqual(anns[0].subject, "Ann");
  assert.strictEqual(anns[0].message, "Msg");
  assert.strictEqual(anns[0].creator, "opA");

  // Approval workflow boundary is the contract gate before session
  assert.strictEqual(capability.checkSupportAccess(state, "tA"), "DENIED" as const);
  state = capability.requestSupportApproval(state, "tA", "opA");
  assert.strictEqual(capability.checkSupportAccess(state, "tA"), "PENDING_APPROVAL" as const);
  const approved = capability.approveSupportRequest(state, "tA", "opA", "appr");
  assert.ok(!isError(approved), "Approval should succeed");
  state = approved;
  assert.strictEqual(capability.checkSupportAccess(state, "tA"), "GRANTED" as const);

  // Session contract only fires after approval boundary completes
  const sessRes = capability.createSupportSession(state, "tA", "opA", auditFn);
  assert.ok(!isError(sessRes), "Session creation after approval failed");
  assert.strictEqual((sessRes as capability.SupportTicketsCustomerHealthAnnouncementsState).sessions.length, 1);
});

test("supportticketscustomerhealthannouncementserrormodel", () => {
  // Database/readiness failures surface as DATABASE_FAILURE route error
  const notReadyRes = capability.createTicket(
    capability.initialState,
    "tX",
    "opX",
    "Subj",
    "Body",
    () => null,
  );
  assert.ok(isError(notReadyRes));
  assert.strictEqual(
    (notReadyRes as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "DATABASE_FAILURE" as const,
  );

  const readyState: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Use-case failure surfaces for missing ticket on update
  const missingRes = capability.updateTicket(
    readyState,
    "tX",
    "opX",
    "nonexistent",
    { status: "OPEN" },
    () => null,
  );
  assert.ok(isError(missingRes));
  assert.strictEqual(
    (missingRes as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "USE_CASE_FAILURE" as const,
  );

  // Missing approval keeps access waiting and no session is created (fail-closed)
  const pending = capability.requestSupportApproval(readyState, "tX", "reqX");
  assert.strictEqual(capability.checkSupportAccess(pending, "tX"), "PENDING_APPROVAL" as const);
  const blockedSess = capability.createSupportSession(pending, "tX", "opX", () => null);
  assert.ok(isError(blockedSess));
  assert.strictEqual(
    (blockedSess as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "MISSING_APPROVAL" as const,
  );

  // Absent ticket/usage rows produce zero-count health signals
  const healthZero = capability.computeCustomerHealth(pending, "tX");
  assert.strictEqual(healthZero.ticketCount, 0);
  assert.strictEqual(healthZero.meteredUsage, 0);

  // Approval gate fails closed when no approval exists at all
  assert.strictEqual(capability.checkSupportAccess(capability.initialState, "other"), "DENIED" as const);
  const noApprSess = capability.createSupportSession(capability.initialState, "other", "op", () => null);
  assert.ok(isError(noApprSess));
  assert.strictEqual(
    (noApprSess as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "MISSING_APPROVAL" as const,
  );
});

test("supportticketscustomerhealthannouncementslifecycle", () => {
  const auditFn: capability.AuditPort = () => null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Ticket created and exposed through the support route layer
  const crTicket = capability.createTicket(state, "tL", "opL", "Life ticket", "Body", auditFn);
  assert.ok(!isError(crTicket), "Ticket creation should succeed");
  state = crTicket;
  const listT = capability.listTickets(state, "tL");
  assert.strictEqual(listT.length, 1);

  // Ticket updated and exposed
  const updTicket = capability.updateTicket(
    state,
    "tL",
    "opL",
    listT[0].id,
    { subject: "Updated" },
    auditFn,
  );
  assert.ok(!isError(updTicket), "Ticket update should succeed");
  state = updTicket;
  assert.strictEqual(state.tickets[0].subject, "Updated");

  // Customer health computed from tickets + usage signals
  const health = capability.computeCustomerHealth(state, "tL");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 0);

  // Announcement lifecycle created and listed for the tenant
  const crAnn = capability.createAnnouncement(state, "tL", "opL", "Note", "Content", auditFn);
  assert.ok(!isError(crAnn), "Announcement creation should succeed");
  state = crAnn;
  const annList = capability.listAnnouncements(state, "tL");
  assert.strictEqual(annList.length, 1);
  assert.strictEqual(annList[0].subject, "Note");
  assert.strictEqual(annList[0].creator, "opL");

  // Health/announcement/ticket summaries are exposed for operators
  assert.strictEqual(health.tenantId, "tL");
  assert.strictEqual(state.tickets[0].organisation, "tL");
  assert.strictEqual(state.announcements[0].tenantId, "tL");

  // Support access is gated by the approval workflow before a session is created
  state = capability.requestSupportApproval(state, "tL", "opL");
  assert.strictEqual(capability.checkSupportAccess(state, "tL"), "PENDING_APPROVAL" as const);
  const blocked = capability.createSupportSession(state, "tL", "opL", auditFn);
  assert.ok(isError(blocked));
  assert.strictEqual(
    (blocked as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "MISSING_APPROVAL" as const,
  );

  const granted = capability.approveSupportRequest(state, "tL", "opL", "apprL");
  assert.ok(!isError(granted), "Approval should succeed");
  state = granted;
  const sess = capability.createSupportSession(state, "tL", "opL", auditFn);
  assert.ok(!isError(sess), "Session should be created after approval");
  assert.strictEqual((sess as capability.SupportTicketsCustomerHealthAnnouncementsState).sessions.length, 1);
});

test("supportticketscustomerhealthannouncementspermissions", () => {
  const auditFn: capability.AuditPort = () => null;
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Tenant A ticket
  const aTicket = capability.createTicket(state, "A", "opA", "A ticket", "Body", auditFn);
  assert.ok(!isError(aTicket), "Tenant A ticket creation should succeed");
  state = aTicket;

  // Tenant B ticket
  const bTicket = capability.createTicket(state, "B", "opB", "B ticket", "Body", auditFn);
  assert.ok(!isError(bTicket), "Tenant B ticket creation should succeed");
  state = bTicket;

  // Tenant context cannot read another tenant's tickets
  const listA = capability.listTickets(state, "A");
  const listB = capability.listTickets(state, "B");
  const listC = capability.listTickets(state, "C");
  assert.strictEqual(listA.length, 1);
  assert.strictEqual(listA[0].organisation, "A");
  assert.strictEqual(listB.length, 1);
  assert.strictEqual(listB[0].organisation, "B");
  assert.strictEqual(listC.length, 0);

  // Announcements scoped per tenant
  const aAnn = capability.createAnnouncement(state, "A", "opA", "AnnA", "MsgA", auditFn);
  assert.ok(!isError(aAnn), "Tenant A announcement creation should succeed");
  state = aAnn;
  const bAnn = capability.createAnnouncement(state, "B", "opB", "AnnB", "MsgB", auditFn);
  assert.ok(!isError(bAnn), "Tenant B announcement creation should succeed");
  state = bAnn;

  const annsA = capability.listAnnouncements(state, "A");
  const annsB = capability.listAnnouncements(state, "B");
  const annsC = capability.listAnnouncements(state, "C");
  assert.strictEqual(annsA.length, 1);
  assert.strictEqual(annsB.length, 1);
  assert.strictEqual(annsC.length, 0);

  // Health scoped per tenant
  const healthA = capability.computeCustomerHealth(state, "A");
  const healthB = capability.computeCustomerHealth(state, "B");
  const healthC = capability.computeCustomerHealth(state, "C");
  assert.strictEqual(healthA.tenantId, "A");
  assert.strictEqual(healthA.ticketCount, 1);
  assert.strictEqual(healthB.tenantId, "B");
  assert.strictEqual(healthB.ticketCount, 1);
  assert.strictEqual(healthC.tenantId, "C");
  assert.strictEqual(healthC.ticketCount, 0);

  // Support session cannot be created cross-tenant without that tenant's own approval
  const apprA = capability.requestSupportApproval(state, "A", "opA");
  const crossSess = capability.createSupportSession(apprA, "B", "opA", auditFn);
  assert.ok(isError(crossSess));
  assert.strictEqual(
    (crossSess as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "MISSING_APPROVAL" as const,
  );
  assert.strictEqual(capability.checkSupportAccess(state, "B"), "DENIED" as const);

  // Audit events carry the originating actor/tenant
  state = apprA;
  const sessA = capability.createSupportSession(
    { ...state, approvals: [{ tenantId: "A", requesterId: "opA", approverId: "apprA", status: "APPROVED" as const, requestedAt: new Date().toISOString(), approvedAt: new Date().toISOString() }] },
    "A",
    "opA",
    auditFn,
  );
  assert.ok(!isError(sessA));
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

  // Initial denial with no approval present
  assert.strictEqual(capability.checkSupportAccess(state, "P"), "DENIED" as const);

  // Request approval — workflow enters waiting state
  state = capability.requestSupportApproval(state, "P", "opP");
  assert.strictEqual(capability.checkSupportAccess(state, "P"), "PENDING_APPROVAL" as const);

  // Waiting approval blocks session creation
  const blocked = capability.createSupportSession(state, "P", "opP", auditFn);
  assert.ok(isError(blocked));
  assert.strictEqual(
    (blocked as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "MISSING_APPROVAL" as const,
  );
  assert.strictEqual(auditEvents.length, 0, "No audit event for blocked session");

  // Approval completed — workflow transitions to granted
  const approved = capability.approveSupportRequest(state, "P", "opP", "apprP");
  assert.ok(!isError(approved), "Approval should succeed");
  state = approved;
  assert.strictEqual(capability.checkSupportAccess(state, "P"), "GRANTED" as const);

  // Support-session audit lifecycle emits the live event after approval
  const live = capability.createSupportSession(state, "P", "opP", auditFn);
  assert.ok(!isError(live), "Live session should succeed");
  assert.strictEqual((live as capability.SupportTicketsCustomerHealthAnnouncementsState).sessions.length, 1);

  // Hermetic/runtime proof of the approval waiting/completed workflow + session audit
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "SUPPORT_SESSION_CREATED" as const);
  assert.strictEqual(auditEvents[0].tenantId, "P");
  assert.strictEqual(auditEvents[0].actorId, "opP");
  assert.strictEqual(
    (auditEvents[0].metadata as { approvedBy: string | null }).approvedBy,
    "apprP",
  );
});

test("supportticketscustomerhealthannouncementsreadinessmodel", () => {
  const auditEvents: capability.SupportTicketsCustomerHealthAnnouncementsAuditEvent[] = [];
  const auditFn: capability.AuditPort = (e) => {
    auditEvents.push(e);
    return null;
  };

  // Initial readiness state is NOT_READY
  assert.strictEqual(capability.initialState.readiness, "NOT_READY" as const);
  const healthInit = capability.computeCustomerHealth(capability.initialState, "any");
  assert.strictEqual(healthInit.ticketCount, 0);
  assert.strictEqual(healthInit.meteredUsage, 0);

  // Mutation paths disabled while NOT_READY
  const blockedTicket = capability.createTicket(
    capability.initialState,
    "any",
    "op",
    "Sub",
    "Body",
    () => null,
  );
  assert.ok(isError(blockedTicket));
  assert.strictEqual(
    (blockedTicket as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "DATABASE_FAILURE" as const,
  );
  const blockedAnn = capability.createAnnouncement(
    capability.initialState,
    "any",
    "op",
    "Sub",
    "Msg",
    () => null,
  );
  assert.ok(isError(blockedAnn));
  assert.strictEqual(
    (blockedAnn as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "DATABASE_FAILURE" as const,
  );

  // READY enables mutation; audit remains visible
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };
  const ticketOk = capability.createTicket(state, "T", "op", "Ok", "Ok", auditFn);
  assert.ok(!isError(ticketOk), "Ticket creation should succeed when READY");
  state = ticketOk;
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "TICKET_MUTATION" as const);
  assert.strictEqual(capability.listTickets(state, "T").length, 1);

  // DEGRADED keeps read paths and audit visible while disabling mutations
  const degradedState: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...state,
    readiness: "DEGRADED" as const,
    usageSignals: [{ tenantId: "T", usage: 42 }],
  };
  const healthDeg = capability.computeCustomerHealth(degradedState, "T");
  assert.strictEqual(healthDeg.meteredUsage, 42);
  assert.strictEqual(healthDeg.ticketCount, 1);
  assert.strictEqual(degradedState.readiness, "DEGRADED" as const);

  const ticketDeg = capability.createTicket(degradedState, "T", "op", "No", "Write", () => null);
  assert.ok(isError(ticketDeg));
  assert.strictEqual(
    (ticketDeg as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "DATABASE_FAILURE" as const,
  );
  const annDeg = capability.createAnnouncement(degradedState, "T", "op", "No", "Write", () => null);
  assert.ok(isError(annDeg));
  assert.strictEqual(
    (annDeg as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "DATABASE_FAILURE" as const,
  );

  // Approval workflow proof boundary runs even when state is read-only
  const pendingAppr = capability.requestSupportApproval(degradedState, "T", "op");
  assert.strictEqual(capability.checkSupportAccess(pendingAppr, "T"), "PENDING_APPROVAL" as const);
  assert.strictEqual(auditEvents.length, 1, "No new audit events during degraded mutations");
});

test("supportticketscustomerhealthannouncementsstatemodel", () => {
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Ticket state carries identifier, subject, body, status, organisation, actor, timestamps
  const ticketRes = capability.createTicket(state, "S", "opS", "State Ticket", "Details", () => null);
  assert.ok(!isError(ticketRes), "Ticket creation should succeed");
  state = ticketRes;
  const t = state.tickets[0];
  assert.ok(t.id.startsWith("ticket_"));
  assert.strictEqual(typeof t.id, "string");
  assert.strictEqual(t.subject, "State Ticket");
  assert.strictEqual(t.body, "Details");
  assert.strictEqual(t.status, "OPEN");
  assert.strictEqual(t.organisation, "S");
  assert.strictEqual(t.actor, "opS");
  assert.strictEqual(typeof t.createdAt, "string");

  // Customer-health is a computed read-model over tickets + metered usage, not a stored score
  state = { ...state, usageSignals: [{ tenantId: "S", usage: 33 }] };
  const health = capability.computeCustomerHealth(state, "S");
  assert.strictEqual(health.tenantId, "S");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 33);
  const noUsage = capability.computeCustomerHealth({ ...state, usageSignals: [] }, "S");
  assert.strictEqual(noUsage.ticketCount, 1);
  assert.strictEqual(noUsage.meteredUsage, 0);

  // Announcement state carries identifier, subject, message, creator, created-at
  const annRes = capability.createAnnouncement(state, "S", "opS", "Ann Title", "Ann Body", () => null);
  assert.ok(!isError(annRes), "Announcement creation should succeed");
  state = annRes;
  const a = state.announcements[0];
  assert.ok(a.id.startsWith("ann_"));
  assert.strictEqual(typeof a.id, "string");
  assert.strictEqual(a.subject, "Ann Title");
  assert.strictEqual(a.message, "Ann Body");
  assert.strictEqual(a.creator, "opS");
  assert.strictEqual(typeof a.createdAt, "string");
  assert.strictEqual(a.tenantId, "S");

  // Support-mode approval and session state in the adjacent approval proof
  const apprState = capability.requestSupportApproval(state, "S", "opS");
  assert.strictEqual(apprState.approvals[0].status, "PENDING" as const);
  assert.strictEqual(apprState.approvals[0].approverId, null);
  assert.strictEqual(apprState.approvals[0].tenantId, "S");
  assert.strictEqual(apprState.approvals[0].requesterId, "opS");

  const approved = capability.approveSupportRequest(apprState, "S", "opS", "apprS");
  assert.ok(!isError(approved), "Approval grant should succeed");
  const approvedState = approved as capability.SupportTicketsCustomerHealthAnnouncementsState;
  assert.strictEqual(approvedState.approvals[0].status, "APPROVED" as const);
  assert.strictEqual(approvedState.approvals[0].approverId, "apprS");

  const sess = capability.createSupportSession(approvedState, "S", "opS", () => null);
  assert.ok(!isError(sess), "Session creation should succeed");
  const sessState = sess as capability.SupportTicketsCustomerHealthAnnouncementsState;
  assert.ok(sessState.sessions[0].sessionId.startsWith("sess_"));
  assert.strictEqual(sessState.sessions[0].tenantId, "S");
  assert.strictEqual(sessState.sessions[0].operatorId, "opS");
  assert.strictEqual(typeof sessState.sessions[0].createdAt, "string");
});

test("supportticketscustomerhealthannouncementsvalidation", () => {
  let state: capability.SupportTicketsCustomerHealthAnnouncementsState = {
    ...capability.initialState,
    readiness: "READY" as const,
  };

  // Ticket creation returns an identifier and persists subject/body
  const ticketRes = capability.createTicket(state, "V", "opV", "Valid Ticket", "Body", () => null);
  assert.ok(!isError(ticketRes), "Valid ticket should succeed");
  state = ticketRes;
  assert.strictEqual(typeof state.tickets[0].id, "string");
  assert.ok(state.tickets[0].id.startsWith("ticket_"));
  assert.strictEqual(state.tickets[0].subject, "Valid Ticket");

  // Health aggregates ticket count and metered usage
  state = { ...state, usageSignals: [{ tenantId: "V", usage: 11 }] };
  const health = capability.computeCustomerHealth(state, "V");
  assert.strictEqual(health.tenantId, "V");
  assert.strictEqual(health.ticketCount, 1);
  assert.strictEqual(health.meteredUsage, 11);

  // Announcement creation returns an identifier and listing projects subject/message/creator
  const annRes = capability.createAnnouncement(state, "V", "opV", "Valid Ann", "Content", () => null);
  assert.ok(!isError(annRes), "Valid announcement should succeed");
  state = annRes;
  assert.strictEqual(typeof state.announcements[0].id, "string");
  assert.ok(state.announcements[0].id.startsWith("ann_"));
  const proj = capability.listAnnouncements(state, "V")[0];
  assert.strictEqual(proj.subject, "Valid Ann");
  assert.strictEqual(proj.message, "Content");
  assert.strictEqual(proj.creator, "opV");

  // Support session is created only after an approval signal
  const blocked = capability.createSupportSession(state, "V", "opV", () => null);
  assert.ok(isError(blocked));
  assert.strictEqual(
    (blocked as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "MISSING_APPROVAL" as const,
  );

  const req = capability.requestSupportApproval(state, "V", "opV");
  const appr = capability.approveSupportRequest(req, "V", "opV", "apprV");
  assert.ok(!isError(appr), "Approval should succeed");
  const sess = capability.createSupportSession(appr, "V", "opV", () => null);
  assert.ok(!isError(sess), "Session after approval should succeed");
  assert.strictEqual((sess as capability.SupportTicketsCustomerHealthAnnouncementsState).sessions.length, 1);

  // Inputs are validated at the route/use-case layer before persistence
  const invalidTicket = capability.createTicket(state, "V", "opV", "", "No subject", () => null);
  assert.ok(isError(invalidTicket));
  assert.strictEqual(
    (invalidTicket as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "VALIDATION_ERROR" as const,
  );

  const invalidAnn = capability.createAnnouncement(state, "V", "opV", "Sub", "", () => null);
  assert.ok(isError(invalidAnn));
  assert.strictEqual(
    (invalidAnn as capability.SupportTicketsCustomerHealthAnnouncementsError).kind,
    "VALIDATION_ERROR" as const,
  );
});