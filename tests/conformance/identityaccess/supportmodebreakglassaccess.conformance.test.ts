import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/supportmodebreakglassaccess.ts";

test("supportmodebreakglassaccessauditmodel", () => {
  const auditEvents: capability.SupportModeBreakGlassAccessAuditEvent[] = [];
  const auditFn = (
    event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => {
    auditEvents.push(event);
    return null;
  };

  const initial = capability.initialState;
  const workflowId = "workflow-audit";
  const targetTenantFqdn = "tenant.example.com";
  const accessReason = "Emergency access";
  const requestedBy = "org-1";

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn,
  );
  assert.ok(
    !(typeof requestResult === "object" && requestResult !== null && "kind" in requestResult),
  );
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "APPROVAL_REQUESTED");
  assert.strictEqual(auditEvents[0].workflowId, workflowId);
  assert.strictEqual(auditEvents[0].requestedState, "WAITING");
  assert.strictEqual(auditEvents[0].targetTenantFqdn, targetTenantFqdn);
  assert.strictEqual(auditEvents[0].accessReason, accessReason);
  assert.strictEqual(typeof auditEvents[0].timestamp, "string");

  const requestState = requestResult as capability.SupportModeBreakGlassAccessState;
  const approveResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    "tenant-1",
    requestedBy,
    accessReason,
    ["platform-admin", "system-admin"],
    auditFn,
  );
  assert.ok(
    !(typeof approveResult === "object" && approveResult !== null && "kind" in approveResult),
  );
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[1].kind, "SUPPORT_SESSION_CREATED");
  assert.strictEqual(auditEvents[1].workflowId, workflowId);
  assert.strictEqual(auditEvents[1].requestedState, "COMPLETED");
  assert.strictEqual(auditEvents[1].targetTenantFqdn, targetTenantFqdn);
  assert.strictEqual(auditEvents[1].accessReason, accessReason);

  const approveState = approveResult as capability.SupportModeBreakGlassAccessState;
  const auditFailure: capability.SupportModeBreakGlassAccessError = {
    kind: "AUDIT_BACKEND_FAILURE",
    message: "Audit backend down",
  };
  const failingAuditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => auditFailure;

  const failResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    "tenant-1",
    requestedBy,
    accessReason,
    ["platform-admin", "system-admin"],
    failingAuditFn,
  );
  assert.ok(
    typeof failResult === "object" && failResult !== null && "kind" in failResult,
  );
  const failError = failResult as capability.SupportModeBreakGlassAccessError;
  assert.strictEqual(failError.kind, "AUDIT_BACKEND_FAILURE");
  assert.strictEqual(requestState.sessions.length, 0);
  assert.strictEqual(requestState.workflows[0].status, "WAITING");
});

test("supportmodebreakglassaccesscontracts", () => {
  const auditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => null;

  const initial = capability.initialState;
  const workflowId = "workflow-contracts";
  const targetTenantFqdn = "tenant.example.com";
  const accessReason = "Operational intervention";
  const requestedBy = "org-1";
  const targetTenantId = "tenant-1";
  const roles = ["platform-admin", "system-admin"];

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn,
  );
  assert.ok(
    !(typeof requestResult === "object" && requestResult !== null && "kind" in requestResult),
  );
  const requestState = requestResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(requestState.workflows.length, 1);
  const wf = requestState.workflows[0];
  assert.strictEqual(wf.id, workflowId);
  assert.strictEqual(wf.status, "WAITING");
  assert.strictEqual(wf.targetTenantFqdn, targetTenantFqdn);
  assert.strictEqual(wf.accessReason, accessReason);
  assert.strictEqual(wf.requestedBy, requestedBy);

  const approveResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    auditFn,
  );
  assert.ok(
    !(typeof approveResult === "object" && approveResult !== null && "kind" in approveResult),
  );
  const approveState = approveResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(approveState.workflows.length, 1);
  assert.strictEqual(approveState.workflows[0].status, "COMPLETED");
  assert.strictEqual(approveState.sessions.length, 1);
  assert.strictEqual(approveState.sessions[0].id, `session-${workflowId}`);
});

test("supportmodebreakglassaccesserrormodel", () => {
  const initial = capability.initialState;
  const passingAudit = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => null;

  const nonAdmin = capability.validateRequest(
    { roles: [], effectiveOrganisationId: "org-1" },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(nonAdmin, "FORBIDDEN");

  const noOrg = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: null },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(noOrg, "FORBIDDEN");

  const emptyReason = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "tenant.example.com",
    "   ",
  );
  assert.strictEqual(emptyReason, "REASON_REQUIRED");

  const emptyTarget = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "",
    "reason",
  );
  assert.strictEqual(emptyTarget, "INVALID_TARGET");

  const wrongFqdn = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "tenant.other.com",
    "reason",
  );
  assert.strictEqual(wrongFqdn, "WRONG_TENANT_FQDN");

  const blockedRequest = capability.requestSupportAccess(
    initial,
    "wf-fail",
    "",
    "reason",
    "org-1",
    passingAudit,
  );
  assert.ok(
    typeof blockedRequest === "object" && blockedRequest !== null && "kind" in blockedRequest,
  );
  const blockedError = blockedRequest as capability.SupportModeBreakGlassAccessError;
  assert.strictEqual(blockedError.kind, "INVALID_TARGET");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);

  const auditFailure: capability.SupportModeBreakGlassAccessError = {
    kind: "AUDIT_BACKEND_FAILURE",
    message: "Audit backend down",
  };
  const failingAuditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => auditFailure;
  const auditFailResult = capability.requestSupportAccess(
    initial,
    "wf-audit-fail",
    "tenant.example.com",
    "reason",
    "org-1",
    failingAuditFn,
  );
  assert.ok(
    typeof auditFailResult === "object" && auditFailResult !== null && "kind" in auditFailResult,
  );
  const auditFailError = auditFailResult as capability.SupportModeBreakGlassAccessError;
  assert.strictEqual(auditFailError.kind, "AUDIT_BACKEND_FAILURE");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);
});

test("supportmodebreakglassaccesslifecycle", () => {
  const auditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => null;

  const initial = capability.initialState;
  const workflowId = "workflow-lifecycle";
  const targetTenantFqdn = "tenant.example.com";
  const accessReason = "Outage intervention";
  const requestedBy = "org-1";
  const targetTenantId = "tenant-1";
  const roles = ["platform-admin", "system-admin"];

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn,
  );
  assert.ok(
    !(typeof requestResult === "object" && requestResult !== null && "kind" in requestResult),
  );
  const requestState = requestResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(requestState.workflows[0].status, "WAITING");

  const approveResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    auditFn,
  );
  assert.ok(
    !(typeof approveResult === "object" && approveResult !== null && "kind" in approveResult),
  );
  const approveState = approveResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(approveState.workflows[0].status, "COMPLETED");
  assert.strictEqual(approveState.sessions.length, 1);
  assert.strictEqual(approveState.sessions[0].ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
  assert.strictEqual(capability.SUPPORT_SESSION_TTL_SECONDS, 3600);
  assert.strictEqual(approveState.sessions[0].supportMode, true);
  assert.strictEqual(approveState.sessions[0].targetTenantId, targetTenantId);

  const directResult = capability.enterSupportModeDirectly(
    initial,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    targetTenantFqdn,
    auditFn,
  );
  assert.ok(
    !(typeof directResult === "object" && directResult !== null && "kind" in directResult),
  );
  const directState = directResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(directState.sessions.length, 1);
  assert.strictEqual(directState.sessions[0].ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
  assert.strictEqual(directState.sessions[0].supportMode, true);
  assert.strictEqual(directState.sessions[0].targetTenantId, targetTenantId);
  assert.strictEqual(directState.sessions[0].effectiveOrganisationId, requestedBy);
});

test("supportmodebreakglassaccesspermissions", () => {
  const nonAdmin = capability.validateRequest(
    { roles: ["user"], effectiveOrganisationId: "org-1" },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(nonAdmin, "FORBIDDEN");

  const noOrg = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: null },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(noOrg, "FORBIDDEN");

  const approved = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(approved, "APPROVED");

  const wrongFqdn = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "tenant.other.com",
    "reason",
  );
  assert.strictEqual(wrongFqdn, "WRONG_TENANT_FQDN");

  const auditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => null;

  const noOrgAttempt = capability.enterSupportModeDirectly(
    capability.initialState,
    "tenant-1",
    null,
    "reason",
    ["platform-admin", "system-admin"],
    "tenant.example.com",
    auditFn,
  );
  assert.ok(
    typeof noOrgAttempt === "object" && noOrgAttempt !== null && "kind" in noOrgAttempt,
  );
  assert.strictEqual(
    (noOrgAttempt as capability.SupportModeBreakGlassAccessError).kind,
    "FORBIDDEN",
  );

  const mismatchedFqdn = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-other" },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(mismatchedFqdn, "APPROVED");

  const foreignFqdn = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "foreign.example.com",
    "reason",
  );
  assert.strictEqual(foreignFqdn, "WRONG_TENANT_FQDN");
});

test("supportmodebreakglassaccessproof", () => {
  const initial = capability.initialState;
  const workflowId = "workflow-proof";
  const targetTenantFqdn = "tenant.example.com";
  const accessReason = "Proven access";
  const requestedBy = "org-1";
  const targetTenantId = "tenant-1";
  const roles = ["platform-admin", "system-admin"];

  const proofResult = capability.proveWorkflowAndSessionStateMachine(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    targetTenantId,
    roles,
  );
  assert.ok(
    !(typeof proofResult === "object" && proofResult !== null && "kind" in proofResult),
  );
  const proofState = proofResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(proofState.workflows.length, 1);
  assert.strictEqual(proofState.workflows[0].id, workflowId);
  assert.strictEqual(proofState.workflows[0].status, "COMPLETED");
  assert.strictEqual(proofState.sessions.length, 1);
  assert.strictEqual(proofState.sessions[0].id, `session-${workflowId}`);
  assert.strictEqual(proofState.sessions[0].supportMode, true);

  const failingProof = capability.proveWorkflowAndSessionStateMachine(
    initial,
    "wf-bad",
    "",
    "reason",
    requestedBy,
    targetTenantId,
    roles,
  );
  assert.ok(
    typeof failingProof === "object" && failingProof !== null && "kind" in failingProof,
  );
  assert.strictEqual(
    (failingProof as capability.SupportModeBreakGlassAccessError).kind,
    "INVALID_TARGET",
  );
});

test("supportmodebreakglassaccessreadinessmodel", () => {
  const auditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => null;

  assert.strictEqual(capability.initialState.readiness, "READY");

  const working = capability.requestSupportAccess(
    capability.initialState,
    "wf-ready",
    "tenant.example.com",
    "reason",
    "org-1",
    auditFn,
  );
  assert.ok(
    !(typeof working === "object" && working !== null && "kind" in working),
  );
  const workingState = working as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(workingState.readiness, "READY");

  const workingApprove = capability.approveSupportAccess(
    workingState,
    "wf-ready",
    "tenant-1",
    "org-1",
    "reason",
    ["platform-admin", "system-admin"],
    auditFn,
  );
  assert.ok(
    !(typeof workingApprove === "object" && workingApprove !== null && "kind" in workingApprove),
  );
  const readyState = workingApprove as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(readyState.readiness, "READY");
  assert.strictEqual(readyState.sessions.length, 1);

  const degraded = capability.enterSupportModeDirectly(
    capability.initialState,
    "tenant-1",
    "org-1",
    "reason",
    ["platform-admin", "system-admin"],
    "tenant.example.com",
    auditFn,
  );
  assert.ok(
    !(typeof degraded === "object" && degraded !== null && "kind" in degraded),
  );
  const degradedState = degraded as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(degradedState.readiness, "READY");

  const readinessValues: readonly capability.SupportModeBreakGlassAccessReadiness[] = [
    "READY",
    "DEGRADED",
  ];
  assert.ok(readinessValues.includes(readyState.readiness));
});

test("supportmodebreakglassaccessstatemodel", () => {
  const auditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => null;

  const initial = capability.initialState;
  const workflowId = "workflow-state";
  const targetTenantFqdn = "tenant.example.com";
  const accessReason = "State model probe";
  const requestedBy = "org-1";
  const targetTenantId = "tenant-1";
  const roles = ["platform-admin", "system-admin"];

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn,
  );
  assert.ok(
    !(typeof requestResult === "object" && requestResult !== null && "kind" in requestResult),
  );
  const requestState = requestResult as capability.SupportModeBreakGlassAccessState;
  const wf = requestState.workflows[0];
  assert.strictEqual(wf.id, workflowId);
  assert.strictEqual(wf.status, "WAITING");
  assert.strictEqual(wf.targetTenantFqdn, targetTenantFqdn);
  assert.strictEqual(wf.accessReason, accessReason);
  assert.strictEqual(wf.requestedBy, requestedBy);
  assert.strictEqual(typeof wf.requestedAt, "string");

  const approveResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    auditFn,
  );
  assert.ok(
    !(typeof approveResult === "object" && approveResult !== null && "kind" in approveResult),
  );
  const approveState = approveResult as capability.SupportModeBreakGlassAccessState;
  const session = approveState.sessions[0];
  assert.strictEqual(session.id, `session-${workflowId}`);
  assert.strictEqual(session.targetTenantId, targetTenantId);
  assert.strictEqual(session.effectiveOrganisationId, requestedBy);
  assert.strictEqual(session.accessReason, accessReason);
  assert.deepStrictEqual([...session.roles], ["platform-admin", "system-admin"]);
  assert.strictEqual(session.ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
  assert.strictEqual(session.supportMode, true);
  assert.strictEqual(typeof session.createdAt, "string");
  assert.ok(
    !(session as unknown as Record<string, unknown>)["permissions"],
    "session must not carry tenant-scoped permissions",
  );
});

test("supportmodebreakglassaccessvalidation", () => {
  const auditFn = (
    _event: capability.SupportModeBreakGlassAccessAuditEvent,
  ): capability.SupportModeBreakGlassAccessError | null => null;

  const nonAdmin = capability.validateRequest(
    { roles: ["user"], effectiveOrganisationId: "org-1" },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(nonAdmin, "FORBIDDEN");

  const emptyReason = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "tenant.example.com",
    "   ",
  );
  assert.strictEqual(emptyReason, "REASON_REQUIRED");

  const noOrg = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: null },
    "tenant.example.com",
    "reason",
  );
  assert.strictEqual(noOrg, "FORBIDDEN");

  const foreignFqdn = capability.validateRequest(
    { roles: ["platform-admin", "system-admin"], effectiveOrganisationId: "org-1" },
    "tenant.other.com",
    "reason",
  );
  assert.strictEqual(foreignFqdn, "WRONG_TENANT_FQDN");

  const initial = capability.initialState;
  const blockedSession = capability.requestSupportAccess(
    initial,
    "wf-bad-validation",
    "",
    "reason",
    "org-1",
    auditFn,
  );
  assert.ok(
    typeof blockedSession === "object" && blockedSession !== null && "kind" in blockedSession,
  );
  const blockedError = blockedSession as capability.SupportModeBreakGlassAccessError;
  assert.strictEqual(blockedError.kind, "INVALID_TARGET");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);

  const blockedReason = capability.requestSupportAccess(
    initial,
    "wf-no-reason",
    "tenant.example.com",
    "  ",
    "org-1",
    auditFn,
  );
  assert.ok(
    typeof blockedReason === "object" && blockedReason !== null && "kind" in blockedReason,
  );
  const blockedReasonError = blockedReason as capability.SupportModeBreakGlassAccessError;
  assert.strictEqual(blockedReasonError.kind, "REASON_REQUIRED");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);
});