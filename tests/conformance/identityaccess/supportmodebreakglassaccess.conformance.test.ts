import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/supportmodebreakglassaccess.ts";

type AuditEvent = capability.SupportModeBreakGlassAccessAuditEvent;
type AuditError = capability.SupportModeBreakGlassAccessError;
type State = capability.SupportModeBreakGlassAccessState;
type ErrorKind = capability.SupportModeBreakGlassAccessErrorKind;
type Decision = capability.SupportModeBreakGlassAccessDecision;
type WorkflowStatus = capability.SupportModeBreakGlassAccessWorkflowStatus;
type Role = capability.SupportModeBreakGlassAccessRole;

function capturingAudit(): {
  fn: (event: AuditEvent) => AuditError | null;
  events: AuditEvent[];
} {
  const events: AuditEvent[] = [];
  return {
    events,
    fn: (event: AuditEvent): AuditError | null => {
      events.push(event);
      return null;
    },
  };
}

function isError(value: State | AuditError): value is AuditError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value
  );
}

function isState(value: State | AuditError): value is State {
  return !isError(value);
}

const APPROVED_ROLES: readonly string[] = ["platform-admin", "support-enter", "system-admin"];
const TENANT_FQDN = "tenant.example.com";
const REASON = "Emergency intervention";
const REQUESTED_BY = "actor-1";
const ORG_ID = "org-1";
const TENANT_ID = "tenant-1";

test("supportmodebreakglassaccessauditmodel", () => {
  const { fn: auditFn, events } = capturingAudit();
  const initial: State = capability.initialState;

  const requestResult = capability.requestSupportAccess(
    initial,
    "wf-audit",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(requestResult), "request must succeed");
  const requestState = requestResult;
  assert.strictEqual(
    requestState.workflows.length,
    1,
    "workflow recorded as waiting after approval request audit",
  );
  assert.strictEqual(requestState.workflows[0]!.status, "WAITING");

  assert.strictEqual(events.length, 1, "exactly one audit event on request");
  const approvalAudit = events[0]!;
  assert.strictEqual(approvalAudit.kind, "APPROVAL_REQUESTED");
  assert.strictEqual(approvalAudit.workflowId, "wf-audit");
  assert.strictEqual(approvalAudit.requestedState, "WAITING");
  assert.strictEqual(approvalAudit.targetTenantFqdn, TENANT_FQDN);
  assert.strictEqual(approvalAudit.accessReason, REASON);
  assert.strictEqual(typeof approvalAudit.timestamp, "string");

  const approveResult = capability.approveSupportAccess(
    requestState,
    "wf-audit",
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    auditFn,
  );
  assert.ok(isState(approveResult), "approval must succeed");
  const approveState = approveResult;

  assert.strictEqual(events.length, 2, "second audit event for session creation");
  const sessionAudit = events[1]!;
  assert.strictEqual(sessionAudit.kind, "SUPPORT_SESSION_CREATED");
  assert.strictEqual(sessionAudit.workflowId, "wf-audit");
  assert.strictEqual(sessionAudit.requestedState, "COMPLETED");
  assert.strictEqual(sessionAudit.targetTenantFqdn, TENANT_FQDN);
  assert.strictEqual(sessionAudit.accessReason, REASON);

  const sessionId = approveState.sessions[0]!.id;
  assert.ok(sessionId.length > 0);

  const failingAuditFn = (
    _event: AuditEvent,
  ): AuditError | null => ({
    kind: "AUDIT_BACKEND_FAILURE",
    message: "backend down",
  });
  const preRequestState: State = {
    ...capability.initialState,
    workflows: [
      {
        id: "wf-audit-fail",
        status: "WAITING",
        targetTenantFqdn: TENANT_FQDN,
        accessReason: REASON,
        requestedBy: REQUESTED_BY,
        requestedAt: new Date().toISOString(),
      },
    ],
  };
  const failResult = capability.approveSupportAccess(
    preRequestState,
    "wf-audit-fail",
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    failingAuditFn,
  );
  assert.ok(isError(failResult), "audit failure must surface as error");
  const failError = failResult as AuditError;
  assert.strictEqual(failError.kind, "AUDIT_BACKEND_FAILURE");
  assert.strictEqual(
    preRequestState.sessions.length,
    0,
    "no session on audit failure",
  );

  const directFail = capability.enterSupportModeDirectly(
    capability.initialState,
    TENANT_ID,
    ORG_ID,
    REASON,
    APPROVED_ROLES,
    TENANT_FQDN,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    failingAuditFn,
  );
  assert.ok(isError(directFail), "audit failure on direct entry must surface as error");
  assert.strictEqual(
    (directFail as AuditError).kind,
    "AUDIT_BACKEND_FAILURE",
  );
  assert.strictEqual(
    capability.initialState.sessions.length,
    0,
    "no session created on audit failure",
  );
});

test("supportmodebreakglassaccesscontracts", () => {
  const { fn: auditFn } = capturingAudit();
  const initial: State = capability.initialState;

  const requestResult = capability.requestSupportAccess(
    initial,
    "wf-contracts",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(requestResult));
  const requestState = requestResult;
  assert.strictEqual(requestState.workflows.length, 1);
  assert.strictEqual(requestState.workflows[0]!.id, "wf-contracts");
  assert.strictEqual(requestState.workflows[0]!.status, "WAITING");
  assert.strictEqual(requestState.sessions.length, 0);

  const approveResult = capability.approveSupportAccess(
    requestState,
    "wf-contracts",
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    auditFn,
  );
  assert.ok(isState(approveResult));
  const approveState = approveResult;
  assert.strictEqual(approveState.workflows[0]!.status, "COMPLETED");
  assert.strictEqual(approveState.sessions.length, 1);
  assert.strictEqual(approveState.sessions[0]!.id, "session-wf-contracts");
  assert.strictEqual(approveState.sessions[0]!.supportMode, true);

  const directResult = capability.enterSupportModeDirectly(
    initial,
    TENANT_ID,
    ORG_ID,
    REASON,
    APPROVED_ROLES,
    TENANT_FQDN,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(directResult));
  const directState = directResult;
  assert.strictEqual(directState.sessions.length, 1);
  assert.strictEqual(directState.sessions[0]!.supportMode, true);
});

test("supportmodebreakglassaccesserrormodel", () => {
  const { fn: auditFn } = capturingAudit();
  const initial: State = capability.initialState;

  const forbidden: Decision = capability.validateRequest(
    { roles: ["user"], effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(forbidden, "FORBIDDEN");

  const reasonRequired: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: "   " },
    TENANT_FQDN,
    "   ",
  );
  assert.strictEqual(reasonRequired, "REASON_REQUIRED");

  const invalidTarget: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: "", accessReason: REASON },
    "",
    REASON,
  );
  assert.strictEqual(invalidTarget, "INVALID_TARGET");

  const wrongFqdn: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: "tenant.other.com", accessReason: REASON },
    "tenant.other.com",
    REASON,
    ["tenant.example.com"],
  );
  assert.strictEqual(wrongFqdn, "WRONG_TENANT_FQDN");

  const blocked = capability.requestSupportAccess(
    initial,
    "wf-block",
    "",
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(blocked));
  const blockedErr = blocked as AuditError;
  assert.strictEqual(blockedErr.kind, "INVALID_TARGET");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);

  const failingAudit = (
    _event: AuditEvent,
  ): AuditError | null => ({
    kind: "AUDIT_BACKEND_FAILURE",
    message: "down",
  });
  const auditFail = capability.requestSupportAccess(
    initial,
    "wf-audit-fail",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    failingAudit,
  );
  assert.ok(isError(auditFail));
  const auditFailErr = auditFail as AuditError;
  assert.strictEqual(auditFailErr.kind, "AUDIT_BACKEND_FAILURE");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);

  const validKinds: readonly ErrorKind[] = [
    "FORBIDDEN",
    "REASON_REQUIRED",
    "INVALID_TARGET",
    "WRONG_TENANT_FQDN",
    "AUDIT_BACKEND_FAILURE",
  ];
  assert.ok(validKinds.includes(blockedErr.kind));
  assert.ok(validKinds.includes(auditFailErr.kind));
});

test("supportmodebreakglassaccesslifecycle", () => {
  const { fn: auditFn } = capturingAudit();
  const initial: State = capability.initialState;

  const requestResult = capability.requestSupportAccess(
    initial,
    "wf-life",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(requestResult));
  const requestState = requestResult;
  assert.strictEqual(requestState.workflows[0]!.status, "WAITING");
  assert.strictEqual(requestState.sessions.length, 0);

  const approveResult = capability.approveSupportAccess(
    requestState,
    "wf-life",
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    auditFn,
  );
  assert.ok(isState(approveResult));
  const approveState = approveResult;
  assert.strictEqual(approveState.workflows[0]!.status, "COMPLETED");
  assert.strictEqual(approveState.sessions.length, 1);
  const session = approveState.sessions[0]!;
  assert.strictEqual(session.targetTenantId, TENANT_ID);
  assert.strictEqual(session.ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
  assert.strictEqual(capability.SUPPORT_SESSION_TTL_SECONDS, 3600);
  assert.strictEqual(session.supportMode, true);

  const directResult = capability.enterSupportModeDirectly(
    initial,
    TENANT_ID,
    ORG_ID,
    REASON,
    APPROVED_ROLES,
    TENANT_FQDN,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(directResult));
  const directState = directResult;
  assert.strictEqual(directState.sessions.length, 1);
  const directSession = directState.sessions[0]!;
  assert.strictEqual(directSession.targetTenantId, TENANT_ID);
  assert.strictEqual(directSession.ttlSeconds, 3600);
  assert.strictEqual(directSession.supportMode, true);
  assert.strictEqual(directSession.effectiveOrganisationId, ORG_ID);

  const statusValues: readonly WorkflowStatus[] = [
    "WAITING",
    "APPROVED",
    "COMPLETED",
  ];
  assert.ok(statusValues.includes(approveState.workflows[0]!.status));

  const futureIso = new Date(Date.now() + capability.SUPPORT_SESSION_TTL_MS + 1000).toISOString();
  assert.strictEqual(
    capability.sessionIsExpired(approveState.sessions[0]!, futureIso),
    true,
    "session expires after TTL",
  );
});

test("supportmodebreakglassaccesspermissions", () => {
  const { fn: auditFn } = capturingAudit();

  const onlyUser: Decision = capability.validateRequest(
    { roles: ["user"], effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(onlyUser, "FORBIDDEN");

  const onlyPlatform: Decision = capability.validateRequest(
    { roles: ["platform-admin"], effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(onlyPlatform, "FORBIDDEN");

  const platformSupport: Decision = capability.validateRequest(
    { roles: ["platform-admin", "support-enter"], effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(platformSupport, "FORBIDDEN");

  const noOrg: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: null, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(noOrg, "FORBIDDEN");

  const emptyOrg: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: "   ", targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(emptyOrg, "FORBIDDEN");

  const approved: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(approved, "APPROVED");

  const foreignFqdn: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: "foreign.example.com", accessReason: REASON },
    "foreign.example.com",
    REASON,
    [TENANT_FQDN],
  );
  assert.strictEqual(foreignFqdn, "WRONG_TENANT_FQDN");

  const tenantMatchOk: Decision = capability.checkTenantFqdnMatch(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, effectiveTenantFqdns: [TENANT_FQDN] },
    TENANT_FQDN,
  );
  assert.strictEqual(tenantMatchOk, "APPROVED");

  const tenantMatchNoOrg: Decision = capability.checkTenantFqdnMatch(
    { roles: APPROVED_ROLES, effectiveOrganisationId: null, effectiveTenantFqdns: [TENANT_FQDN] },
    TENANT_FQDN,
  );
  assert.strictEqual(tenantMatchNoOrg, "FORBIDDEN");

  const tenantMatchOnlyPlatform: Decision = capability.checkTenantFqdnMatch(
    { roles: ["platform-admin"], effectiveOrganisationId: ORG_ID, effectiveTenantFqdns: [TENANT_FQDN] },
    TENANT_FQDN,
  );
  assert.strictEqual(tenantMatchOnlyPlatform, "FORBIDDEN");

  const tenantMatchWrongFqdn: Decision = capability.checkTenantFqdnMatch(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, effectiveTenantFqdns: [TENANT_FQDN] },
    "tenant.other.com",
  );
  assert.strictEqual(tenantMatchWrongFqdn, "WRONG_TENANT_FQDN");

  const directNoOrg = capability.enterSupportModeDirectly(
    capability.initialState,
    TENANT_ID,
    ORG_ID,
    REASON,
    APPROVED_ROLES,
    TENANT_FQDN,
    APPROVED_ROLES,
    null,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(directNoOrg), "no effective organisation must be rejected");
  assert.strictEqual((directNoOrg as AuditError).kind, "FORBIDDEN");

  const directWrongFqdn = capability.enterSupportModeDirectly(
    capability.initialState,
    TENANT_ID,
    ORG_ID,
    REASON,
    APPROVED_ROLES,
    "tenant.other.com",
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(directWrongFqdn));
  assert.strictEqual(
    (directWrongFqdn as AuditError).kind,
    "WRONG_TENANT_FQDN",
  );

  const directOnlyPlatform = capability.enterSupportModeDirectly(
    capability.initialState,
    TENANT_ID,
    ORG_ID,
    REASON,
    ["platform-admin"],
    TENANT_FQDN,
    ["platform-admin"],
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(directOnlyPlatform));
  assert.strictEqual(
    (directOnlyPlatform as AuditError).kind,
    "FORBIDDEN",
  );

  const roles: readonly Role[] = capability.SupportModeBreakGlassAccessRole;
  assert.ok(roles.includes("platform-admin"));
  assert.ok(roles.includes("system-admin"));
});

test("supportmodebreakglassaccessproof", () => {
  const initial: State = capability.initialState;

  const successResult = capability.proveWorkflowAndSessionStateMachine(
    initial,
    "wf-proof",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    APPROVED_ROLES,
  );
  assert.ok(isState(successResult), "proof success yields state");
  const successState = successResult;
  assert.strictEqual(successState.workflows.length, 1);
  assert.strictEqual(successState.workflows[0]!.id, "wf-proof");
  assert.strictEqual(successState.workflows[0]!.status, "COMPLETED");
  assert.strictEqual(successState.sessions.length, 1);
  assert.strictEqual(successState.sessions[0]!.id, "session-wf-proof");
  assert.strictEqual(successState.sessions[0]!.supportMode, true);

  const failResult = capability.proveWorkflowAndSessionStateMachine(
    initial,
    "wf-bad-proof",
    "",
    REASON,
    REQUESTED_BY,
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    APPROVED_ROLES,
  );
  assert.ok(isError(failResult));
  assert.strictEqual((failResult as AuditError).kind, "INVALID_TARGET");

  const failReasonResult = capability.proveWorkflowAndSessionStateMachine(
    initial,
    "wf-no-reason-proof",
    TENANT_FQDN,
    "  ",
    REQUESTED_BY,
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    APPROVED_ROLES,
  );
  assert.ok(isError(failReasonResult));
  assert.strictEqual((failReasonResult as AuditError).kind, "REASON_REQUIRED");

  const { fn: auditFn } = capturingAudit();
  const runtimeResult = capability.proveRuntimeApprovalFlow(
    initial,
    "wf-runtime",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(runtimeResult), "runtime proof yields state");
  const runtimeState = runtimeResult;
  assert.strictEqual(runtimeState.workflows.length, 1);
  assert.strictEqual(runtimeState.workflows[0]!.status, "WAITING");

  const runtimeFail = capability.proveRuntimeApprovalFlow(
    initial,
    "wf-runtime-fail",
    "tenant.other.com",
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(runtimeFail));
  assert.strictEqual(
    (runtimeFail as AuditError).kind,
    "WRONG_TENANT_FQDN",
  );
});

test("supportmodebreakglassaccessreadinessmodel", () => {
  const { fn: auditFn } = capturingAudit();
  const initial: State = capability.initialState;

  assert.strictEqual(initial.readiness, "READY");
  assert.strictEqual(initial.liveExternalProviderClaimed, false);

  const decisionValues: readonly Decision[] = [
    "APPROVED",
    "DENIED",
    "FORBIDDEN",
    "REASON_REQUIRED",
    "INVALID_TARGET",
    "WRONG_TENANT_FQDN",
    "AUDIT_FAILURE",
  ];
  const approved: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.ok(decisionValues.includes(approved));

  const requestResult = capability.requestSupportAccess(
    initial,
    "wf-ready",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(requestResult));
  const requestState = requestResult;
  assert.strictEqual(requestState.readiness, "READY");
  assert.strictEqual(requestState.workflows[0]!.status, "WAITING");

  const approveResult = capability.approveSupportAccess(
    requestState,
    "wf-ready",
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    auditFn,
  );
  assert.ok(isState(approveResult));
  const readyState = approveResult;
  assert.strictEqual(readyState.readiness, "READY");
  assert.strictEqual(readyState.sessions.length, 1);
  assert.strictEqual(readyState.workflows[0]!.status, "COMPLETED");
  assert.strictEqual(readyState.liveExternalProviderClaimed, false);

  const readinessValues: readonly capability.SupportModeBreakGlassAccessReadiness[] = [
    "READY",
    "DEGRADED",
  ];
  assert.ok(readinessValues.includes(readyState.readiness));

  const computedReady = capability.computeReadiness(readyState, false);
  assert.strictEqual(computedReady, "READY");
  const computedDegraded = capability.computeReadiness(readyState, true);
  assert.strictEqual(computedDegraded, "DEGRADED");

  const claimedState = capability.claimNoLiveExternalProvider(readyState);
  assert.strictEqual(claimedState.liveExternalProviderClaimed, false);

  const setDegraded = capability.setReadiness(readyState, "DEGRADED");
  assert.strictEqual(setDegraded.readiness, "DEGRADED");

  const marked = capability.markDegradedMode(readyState, "backend down");
  assert.strictEqual(marked.readiness, "DEGRADED");
  assert.strictEqual(marked.liveExternalProviderClaimed, false);
  assert.ok(marked.lastError !== null);
  assert.strictEqual(marked.lastError!.kind, "AUDIT_BACKEND_FAILURE");
});

test("supportmodebreakglassaccessstatemodel", () => {
  const { fn: auditFn } = capturingAudit();
  const initial: State = capability.initialState;

  const requestResult = capability.requestSupportAccess(
    initial,
    "wf-state",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isState(requestResult));
  const requestState = requestResult;
  const wf = requestState.workflows[0]!;
  assert.strictEqual(wf.id, "wf-state");
  assert.strictEqual(wf.status, "WAITING");
  assert.strictEqual(wf.targetTenantFqdn, TENANT_FQDN);
  assert.strictEqual(wf.accessReason, REASON);
  assert.strictEqual(wf.requestedBy, REQUESTED_BY);
  assert.strictEqual(typeof wf.requestedAt, "string");

  const approveResult = capability.approveSupportAccess(
    requestState,
    "wf-state",
    TENANT_ID,
    ORG_ID,
    APPROVED_ROLES,
    auditFn,
  );
  assert.ok(isState(approveResult));
  const approveState = approveResult;
  const session = approveState.sessions[0]!;
  assert.strictEqual(session.id, "session-wf-state");
  assert.strictEqual(session.targetTenantId, TENANT_ID);
  assert.strictEqual(session.effectiveOrganisationId, ORG_ID);
  assert.strictEqual(session.accessReason, REASON);
  assert.deepStrictEqual([...session.roles], ["platform-admin", "support-enter", "system-admin"]);
  assert.strictEqual(session.ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
  assert.strictEqual(session.ttlSeconds, 3600);
  assert.strictEqual(session.supportMode, true);
  assert.strictEqual(typeof session.createdAt, "string");
  assert.deepStrictEqual([...session.tenantScopedPermissions], []);
  assert.ok(
    !("permissions" in session),
    "session must not carry tenant-scoped permissions",
  );
  assert.ok(
    !("tenantPermissions" in session),
    "session must not carry tenant-scoped permissions",
  );
});

test("supportmodebreakglassaccessvalidation", () => {
  const { fn: auditFn } = capturingAudit();
  const initial: State = capability.initialState;

  const nonAdmin: Decision = capability.validateRequest(
    { roles: ["user"], effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(nonAdmin, "FORBIDDEN");

  const whitespaceReason: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: TENANT_FQDN, accessReason: "   " },
    TENANT_FQDN,
    "   ",
  );
  assert.strictEqual(whitespaceReason, "REASON_REQUIRED");

  const noOrg: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: null, targetTenantFqdn: TENANT_FQDN, accessReason: REASON },
    TENANT_FQDN,
    REASON,
  );
  assert.strictEqual(noOrg, "FORBIDDEN");

  const foreignFqdn: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: "tenant.other.com", accessReason: REASON },
    "tenant.other.com",
    REASON,
    [TENANT_FQDN],
  );
  assert.strictEqual(foreignFqdn, "WRONG_TENANT_FQDN");

  const emptyTarget: Decision = capability.validateRequest(
    { roles: APPROVED_ROLES, effectiveOrganisationId: ORG_ID, targetTenantFqdn: "", accessReason: REASON },
    "",
    REASON,
  );
  assert.strictEqual(emptyTarget, "INVALID_TARGET");

  const blockedByTarget = capability.requestSupportAccess(
    initial,
    "wf-empty-target",
    "",
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(blockedByTarget));
  assert.strictEqual((blockedByTarget as AuditError).kind, "INVALID_TARGET");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);

  const blockedByReason = capability.requestSupportAccess(
    initial,
    "wf-empty-reason",
    TENANT_FQDN,
    "  ",
    REQUESTED_BY,
    APPROVED_ROLES,
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(blockedByReason));
  assert.strictEqual((blockedByReason as AuditError).kind, "REASON_REQUIRED");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);

  const blockedByRoles = capability.requestSupportAccess(
    initial,
    "wf-no-roles",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    [],
    ORG_ID,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(blockedByRoles));
  assert.strictEqual((blockedByRoles as AuditError).kind, "FORBIDDEN");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);

  const blockedByNoOrg = capability.requestSupportAccess(
    initial,
    "wf-no-org",
    TENANT_FQDN,
    REASON,
    REQUESTED_BY,
    APPROVED_ROLES,
    null,
    [TENANT_FQDN],
    auditFn,
  );
  assert.ok(isError(blockedByNoOrg));
  assert.strictEqual((blockedByNoOrg as AuditError).kind, "FORBIDDEN");
  assert.strictEqual(initial.sessions.length, 0);
  assert.strictEqual(initial.workflows.length, 0);
});