import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/supportmodebreakglassaccess.ts";

test("supportmodebreakglassaccessauditmodel", () => {
  const auditEvents: capability.SupportModeBreakGlassAccessAuditEvent[] = [];
  const auditFn = (event: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => {
    auditEvents.push(event);
    return null;
  };

  const initial = capability.initialState;
  const workflowId = 'workflow-1';
  const targetTenantFqdn = 'tenant.example.com';
  const accessReason = 'Emergency access';
  const requestedBy = 'org-1';

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn
  );
  assert.ok(!('kind' in requestResult));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, 'APPROVAL_REQUESTED');
  assert.strictEqual(auditEvents[0].workflowId, workflowId);
  assert.strictEqual(auditEvents[0].requestedState, 'WAITING');
  assert.strictEqual(auditEvents[0].targetTenantFqdn, targetTenantFqdn);
  assert.strictEqual(auditEvents[0].accessReason, accessReason);

  const auditError: capability.SupportModeBreakGlassAccessError = { kind: 'AUDIT_BACKEND_FAILURE', message: 'Audit failed' };
  const failingAuditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => auditError;
  const failResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    failingAuditFn
  );
  assert.ok('kind' in failResult);
  assert.strictEqual((failResult as capability.SupportModeBreakGlassAccessError).kind, 'AUDIT_BACKEND_FAILURE');
});

test("supportmodebreakglassaccesscontracts", () => {
  const auditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => null;
  const initial = capability.initialState;
  const workflowId = 'workflow-1';
  const targetTenantFqdn = 'tenant.example.com';
  const accessReason = 'Emergency access';
  const requestedBy = 'org-1';
  const targetTenantId = 'tenant-1';
  const roles = ['system-admin'] as const;

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn
  );
  assert.ok(!('kind' in requestResult));
  const requestState = requestResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(requestState.workflows.length, 1);
  assert.strictEqual(requestState.workflows[0].status, 'WAITING');

  const approveResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    auditFn
  );
  assert.ok(!('kind' in approveResult));
  const approveState = approveResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(approveState.workflows[0].status, 'COMPLETED');
  assert.strictEqual(approveState.sessions.length, 1);
  assert.strictEqual(approveState.sessions[0].id, `session-${workflowId}`);
});

test("supportmodebreakglassaccesserrormodel", () => {
  const auditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => null;
  const initial = capability.initialState;

  const nonAdminResult = capability.validateRequest(
    { roles: [], effectiveOrganisationId: 'org-1' },
    'tenant.example.com',
    'reason'
  );
  assert.strictEqual(nonAdminResult, 'FORBIDDEN');

  const noOrgResult = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: null },
    'tenant.example.com',
    'reason'
  );
  assert.strictEqual(noOrgResult, 'FORBIDDEN');

  const emptyReasonResult = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: 'org-1' },
    'tenant.example.com',
    '   '
  );
  assert.strictEqual(emptyReasonResult, 'REASON_REQUIRED');

  const emptyTargetResult = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: 'org-1' },
    '',
    'reason'
  );
  assert.strictEqual(emptyTargetResult, 'INVALID_TARGET');

  const wrongFqdnResult = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: 'org-1' },
    'tenant.wrong.com',
    'reason'
  );
  assert.strictEqual(wrongFqdnResult, 'WRONG_TENANT_FQDN');

  const auditError: capability.SupportModeBreakGlassAccessError = { kind: 'AUDIT_BACKEND_FAILURE', message: 'Audit failed' };
  const failingAuditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => auditError;
  const failResult = capability.requestSupportAccess(
    initial,
    'workflow-1',
    'tenant.example.com',
    'reason',
    'org-1',
    failingAuditFn
  );
  assert.ok('kind' in failResult);
  assert.strictEqual((failResult as capability.SupportModeBreakGlassAccessError).kind, 'AUDIT_BACKEND_FAILURE');
});

test("supportmodebreakglassaccesslifecycle", () => {
  const auditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => null;
  const initial = capability.initialState;
  const workflowId = 'workflow-1';
  const targetTenantFqdn = 'tenant.example.com';
  const accessReason = 'Emergency access';
  const requestedBy = 'org-1';
  const targetTenantId = 'tenant-1';
  const roles = ['system-admin'] as const;

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn
  );
  assert.ok(!('kind' in requestResult));
  const requestState = requestResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(requestState.workflows[0].status, 'WAITING');

  const approveResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    auditFn
  );
  assert.ok(!('kind' in approveResult));
  const approveState = approveResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(approveState.workflows[0].status, 'COMPLETED');
  assert.strictEqual(approveState.sessions.length, 1);
  assert.strictEqual(approveState.sessions[0].ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
  assert.strictEqual(approveState.sessions[0].supportMode, true);

  const directResult = capability.enterSupportModeDirectly(
    initial,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    targetTenantFqdn,
    auditFn
  );
  assert.ok(!('kind' in directResult));
  const directState = directResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(directState.sessions.length, 1);
  assert.strictEqual(directState.sessions[0].ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
});

test("supportmodebreakglassaccesspermissions", () => {
  const nonAdminDecision = capability.validateRequest(
    { roles: ['user'], effectiveOrganisationId: 'org-1' },
    'tenant.example.com',
    'reason'
  );
  assert.strictEqual(nonAdminDecision, 'FORBIDDEN');

  const noOrgDecision = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: null },
    'tenant.example.com',
    'reason'
  );
  assert.strictEqual(noOrgDecision, 'FORBIDDEN');

  const validDecision = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: 'org-1' },
    'tenant.example.com',
    'reason'
  );
  assert.strictEqual(validDecision, 'APPROVED');

  const wrongFqdnDecision = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: 'org-1' },
    'tenant.wrong.com',
    'reason'
  );
  assert.strictEqual(wrongFqdnDecision, 'WRONG_TENANT_FQDN');
});

test("supportmodebreakglassaccessproof", () => {
  const auditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => null;
  const initial = capability.initialState;
  const workflowId = 'workflow-1';
  const targetTenantFqdn = 'tenant.example.com';
  const accessReason = 'Emergency access';
  const requestedBy = 'org-1';
  const targetTenantId = 'tenant-1';
  const roles = ['system-admin'] as const;

  const proofResult = capability.proveWorkflowAndSessionStateMachine(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    targetTenantId,
    roles
  );
  assert.ok(!('kind' in proofResult));
  const proofState = proofResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(proofState.workflows.length, 1);
  assert.strictEqual(proofState.workflows[0].status, 'COMPLETED');
  assert.strictEqual(proofState.sessions.length, 1);
});

test("supportmodebreakglassaccessreadinessmodel", () => {
  const initial = capability.initialState;
  assert.strictEqual(initial.readiness, 'READY');
  assert.deepStrictEqual(initial.workflows, []);
  assert.deepStrictEqual(initial.sessions, []);
  assert.strictEqual(initial.lastError, null);

  const degradedState: capability.SupportModeBreakGlassAccessState = {
    ...initial,
    readiness: 'DEGRADED',
  };
  assert.strictEqual(degradedState.readiness, 'DEGRADED');
});

test("supportmodebreakglassaccessstatemodel", () => {
  const auditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => null;
  const initial = capability.initialState;
  const workflowId = 'workflow-1';
  const targetTenantFqdn = 'tenant.example.com';
  const accessReason = 'Emergency access';
  const requestedBy = 'org-1';
  const targetTenantId = 'tenant-1';
  const roles = ['system-admin'] as const;

  const requestResult = capability.requestSupportAccess(
    initial,
    workflowId,
    targetTenantFqdn,
    accessReason,
    requestedBy,
    auditFn
  );
  assert.ok(!('kind' in requestResult));
  const requestState = requestResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(requestState.workflows[0].id, workflowId);
  assert.strictEqual(requestState.workflows[0].status, 'WAITING');
  assert.strictEqual(requestState.workflows[0].targetTenantFqdn, targetTenantFqdn);
  assert.strictEqual(requestState.workflows[0].accessReason, accessReason);
  assert.strictEqual(requestState.workflows[0].requestedBy, requestedBy);

  const approveResult = capability.approveSupportAccess(
    requestState,
    workflowId,
    targetTenantId,
    requestedBy,
    accessReason,
    roles,
    auditFn
  );
  assert.ok(!('kind' in approveResult));
  const approveState = approveResult as capability.SupportModeBreakGlassAccessState;
  assert.strictEqual(approveState.sessions[0].id, `session-${workflowId}`);
  assert.strictEqual(approveState.sessions[0].targetTenantId, targetTenantId);
  assert.strictEqual(approveState.sessions[0].effectiveOrganisationId, requestedBy);
  assert.strictEqual(approveState.sessions[0].accessReason, accessReason);
  assert.deepStrictEqual(approveState.sessions[0].roles, roles);
  assert.strictEqual(approveState.sessions[0].ttlSeconds, capability.SUPPORT_SESSION_TTL_SECONDS);
  assert.strictEqual(approveState.sessions[0].supportMode, true);
});

test("supportmodebreakglassaccessvalidation", () => {
  const nonAdminDecision = capability.validateRequest(
    { roles: ['user'], effectiveOrganisationId: 'org-1' },
    'tenant.example.com',
    'reason'
  );
  assert.strictEqual(nonAdminDecision, 'FORBIDDEN');

  const noOrgDecision = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: null },
    'tenant.example.com',
    'reason'
  );
  assert.strictEqual(noOrgDecision, 'FORBIDDEN');

  const emptyReasonDecision = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: 'org-1' },
    'tenant.example.com',
    '   '
  );
  assert.strictEqual(emptyReasonDecision, 'REASON_REQUIRED');

  const emptyTargetDecision = capability.validateRequest(
    { roles: ['system-admin'], effectiveOrganisationId: 'org-1' },
    '',
    'reason'
  );
  assert.strictEqual(emptyTargetDecision, 'INVALID_TARGET');

  const auditFn = (_: capability.SupportModeBreakGlassAccessAuditEvent): capability.SupportModeBreakGlassAccessError | null => null;
  const initial = capability.initialState;
  const failResult = capability.requestSupportAccess(
    initial,
    'workflow-1',
    '',
    'reason',
    'org-1',
    auditFn
  );
  assert.ok('kind' in failResult);
  assert.strictEqual((failResult as capability.SupportModeBreakGlassAccessError).kind, 'INVALID_TARGET');
});