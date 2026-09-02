import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/tenantserviceclickthroughpolicy.ts";

// Helper: create a valid service descriptor with optional overrides
function makeServiceDescriptor(
  overrides: Partial<capability.TenantServiceClickthroughPolicyServiceDescriptor> = {},
): capability.TenantServiceClickthroughPolicyServiceDescriptor {
  return {
    id: "svc-default",
    resource: "resource/default",
    apexPath: "/apex",
    tenantPath: "/tenant-default",
    classification: "INTERNAL",
    landingPath: "/landing",
    devOnly: false,
    systemAdminResourceSets: ["system:default"],
    tenantAdminResourceSets: ["tenant:default:admins"],
    ...overrides,
  };
}

// Type guard for errors
function isError(
  result: any,
): result is capability.TenantServiceClickthroughPolicyError {
  return result !== null && typeof result === "object" && "kind" in result;
}

// Assert that a decision result is not an error and return it
function getDecision(
  result:
    | capability.TenantServiceClickthroughPolicyDecisionResult
    | capability.TenantServiceClickthroughPolicyError,
): capability.TenantServiceClickthroughPolicyDecisionResult {
  if (isError(result)) {
    assert.fail(`expected decision result, got error: ${result.kind}: ${result.message}`);
  }
  return result;
}

// Assert that an addServiceDescriptor result is a state and return it
function getState(
  result:
    | capability.TenantServiceClickthroughPolicyState
    | capability.TenantServiceClickthroughPolicyError,
): capability.TenantServiceClickthroughPolicyState {
  if (isError(result)) {
    assert.fail(`expected state, got error: ${result.kind}: ${result.message}`);
  }
  return result;
}

// Assert that a deriveReconciliation result is a string and return it
function getReconciliation(
  result: string | capability.TenantServiceClickthroughPolicyError,
): string {
  if (typeof result !== "string") {
    assert.fail(`expected reconciliation string, got error: ${result.kind}`);
  }
  return result;
}

// Add a descriptor and fail if it returns an error; return the new state
function addDescriptorOrFail(
  state: capability.TenantServiceClickthroughPolicyState,
  descriptor: capability.TenantServiceClickthroughPolicyServiceDescriptor,
  auditFn: (event: capability.TenantServiceClickthroughPolicyAuditEvent) => capability.TenantServiceClickthroughPolicyError | null = () => null,
): capability.TenantServiceClickthroughPolicyState {
  const result = capability.addServiceDescriptor(state, descriptor, auditFn);
  return getState(result);
}

test("tenantserviceclickthroughpolicyauditmodel", () => {
  const events: capability.TenantServiceClickthroughPolicyAuditEvent[] = [];
  const auditSink = (
    event: capability.TenantServiceClickthroughPolicyAuditEvent,
  ): capability.TenantServiceClickthroughPolicyError | null => {
    events.push(event);
    return null;
  };

  // Add service -> should emit POLICY_CHANGE
  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-audit",
      tenantPath: "/tenant-audit",
      landingPath: "/landing-audit",
    }),
    auditSink,
  );

  const policyEvent = events.find(
    (e) =>
      e.kind === "POLICY_CHANGE" &&
      e.serviceId === "svc-audit" &&
      e.tenantId === "/tenant-audit",
  );
  assert.ok(policyEvent, "expected POLICY_CHANGE audit event");

  // Access decision -> should emit ACCESS_DECISION
  const decision = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-audit",
      "svc-audit",
      ["tenant:default:admins"],
      true,
      auditSink,
    ),
  );
  assert.strictEqual(decision.decision, "GRANTED");
  assert.strictEqual(decision.reason, "Access granted based on resource sets");
  assert.strictEqual(decision.clickthroughUrl, "/apex/tenant-audit/landing-audit");
  assert.deepStrictEqual(decision.forwardAuthSets, ["tenant:default:admins"]);

  const accessEvent = events.find(
    (e) =>
      e.kind === "ACCESS_DECISION" &&
      e.serviceId === "svc-audit" &&
      e.tenantId === "/tenant-audit" &&
      e.decision === "GRANTED",
  );
  assert.ok(accessEvent, "expected ACCESS_DECISION audit event");
  assert.strictEqual(accessEvent!.reason, "Access granted based on resource sets");
  assert.deepStrictEqual(accessEvent!.dsrGdprEvidence, {
    userResourceSets: ["tenant:default:admins"],
    serviceResourceSets: ["tenant:default:admins"],
  });

  // Reconciliation -> should emit RECONCILIATION_CHANGE
  const reconciliation = getReconciliation(
    capability.deriveReconciliation(state, "/tenant-audit", true, auditSink),
  );
  assert.ok(reconciliation.includes("/apex/tenant-audit*"));

  const reconciliationEvent = events.find(
    (e) =>
      e.kind === "RECONCILIATION_CHANGE" &&
      e.tenantId === "/tenant-audit",
  );
  assert.ok(reconciliationEvent, "expected RECONCILIATION_CHANGE audit event");

  // Tenant isolation violation -> should emit ACCESS_DECISION with DENIED and return error
  const isolationResult = capability.computeAccessDecision(
    state,
    "/tenant-other",
    "svc-audit",
    ["tenant:default:admins"],
    true,
    auditSink,
  );
  assert.ok(isError(isolationResult));
  assert.strictEqual(isolationResult.kind, "MISSING_TENANT_ISOLATION");

  const isolationEvent = events.find(
    (e) =>
      e.kind === "ACCESS_DECISION" &&
      e.tenantId === "/tenant-other" &&
      e.decision === "DENIED",
  );
  assert.ok(isolationEvent, "expected ACCESS_DECISION event for isolation violation");
  assert.strictEqual(
    isolationEvent!.reason,
    "Tenant isolation violation: service does not belong to tenant",
  );

  // Audit failure -> should return AUDIT_FAILURE error
  const auditFailure = capability.computeAccessDecision(
    state,
    "/tenant-audit",
    "svc-audit",
    ["tenant:default:admins"],
    true,
    () => ({
      kind: "AUDIT_FAILURE",
      message: "audit sink unavailable",
      tenantId: "/tenant-audit",
    }),
  );
  assert.ok(isError(auditFailure));
  assert.strictEqual(auditFailure.kind, "AUDIT_FAILURE");
  assert.strictEqual(auditFailure.message, "audit sink unavailable");
});

test("tenantserviceclickthroughpolicycontracts", () => {
  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-contracts",
      tenantPath: "/tenant-contracts",
      classification: "COMPOSED",
      landingPath: "/landing-contracts",
      systemAdminResourceSets: ["system:contracts:admin"],
      tenantAdminResourceSets: ["tenant:contracts:admin"],
    }),
  );

  // Denied: no matching resource sets
  const denied = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-contracts",
      "svc-contracts",
      ["random:set"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(denied.decision, "DENIED");
  assert.strictEqual(denied.reason, "User lacks required resource sets for access");
  assert.strictEqual(denied.clickthroughUrl, null);
  assert.deepStrictEqual(denied.forwardAuthSets, []);

  // Granted: with matching sets
  const granted = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-contracts",
      "svc-contracts",
      ["system:contracts:admin", "tenant:contracts:admin"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(granted.decision, "GRANTED");
  assert.strictEqual(granted.reason, "Access granted based on resource sets");
  assert.strictEqual(granted.clickthroughUrl, "/apex/tenant-contracts/landing-contracts");
  assert.deepStrictEqual(granted.forwardAuthSets, [
    "system:contracts:admin",
    "tenant:contracts:admin",
  ]);

  // Reconciliation contains expected directives
  const reconciliation = getReconciliation(
    capability.deriveReconciliation(state, "/tenant-contracts", true, () => null),
  );
  assert.ok(reconciliation.includes("/apex/tenant-contracts*"));
  assert.ok(
    reconciliation.includes(
      "uri /auth/verify?sets=system:contracts:admin,tenant:contracts:admin",
    ),
  );
  assert.ok(reconciliation.includes("reverse_proxy /landing-contracts"));

  // Determinism: two calls produce identical results
  const granted2 = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-contracts",
      "svc-contracts",
      ["system:contracts:admin", "tenant:contracts:admin"],
      true,
      () => null,
    ),
  );
  assert.deepStrictEqual(granted2, granted);

  const reconciliation2 = getReconciliation(
    capability.deriveReconciliation(state, "/tenant-contracts", true, () => null),
  );
  assert.strictEqual(reconciliation2, reconciliation);
});

test("tenantserviceclickthroughpolicyerrormodel", () => {
  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-error",
      tenantPath: "/tenant-error",
      landingPath: "/landing-error",
      systemAdminResourceSets: ["system:error:ops"],
      tenantAdminResourceSets: ["tenant:error:admins"],
    }),
  );

  // Reconciler unavailable -> RECONCILER_UNAVAILABLE decision (not an error)
  const unavailable = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-error",
      "svc-error",
      ["system:error:ops", "tenant:error:admins"],
      false,
      () => null,
    ),
  );
  assert.strictEqual(unavailable.decision, "RECONCILER_UNAVAILABLE");
  assert.strictEqual(unavailable.clickthroughUrl, null);
  assert.strictEqual(unavailable.forwardAuthSets.length, 0);

  // Derive reconciliation with reconciler unavailable -> RECONCILER_FAILURE error
  const reconciliationError = capability.deriveReconciliation(
    state,
    "/tenant-error",
    false,
    () => null,
  );
  assert.ok(isError(reconciliationError));
  assert.strictEqual(reconciliationError.kind, "RECONCILER_FAILURE");

  // Audit failure (thrown error) -> AUDIT_FAILURE error
  const auditError = capability.computeAccessDecision(
    state,
    "/tenant-error",
    "svc-error",
    ["system:error:ops", "tenant:error:admins"],
    true,
    () => {
      throw new Error("provider failed");
    },
  );
  assert.ok(isError(auditError));
  assert.strictEqual(auditError.kind, "AUDIT_FAILURE");
  assert.strictEqual(auditError.message, "provider failed");

  // Unknown service -> INVALID_SERVICE_DESCRIPTOR error
  const unknownService = capability.computeAccessDecision(
    state,
    "/tenant-error",
    "svc-missing",
    ["system:error:ops"],
    true,
    () => null,
  );
  assert.ok(isError(unknownService));
  assert.strictEqual(unknownService.kind, "INVALID_SERVICE_DESCRIPTOR");
  assert.notStrictEqual(unknownService.kind, "GRANTED");

  // Adding invalid descriptor -> error, state unchanged
  const invalidDescriptor = makeServiceDescriptor({
    id: "",
    tenantPath: "/tenant-error",
  });
  const addResult = capability.addServiceDescriptor(
    capability.initialState,
    invalidDescriptor,
    () => null,
  );
  assert.ok(isError(addResult));
  assert.strictEqual(addResult.kind, "INVALID_SERVICE_DESCRIPTOR");

  // Adding duplicate id -> error
  const duplicateDescriptor = makeServiceDescriptor({
    id: "svc-error",
    tenantPath: "/tenant-error",
  });
  const duplicateResult = capability.addServiceDescriptor(
    state,
    duplicateDescriptor,
    () => null,
  );
  assert.ok(isError(duplicateResult));
  assert.strictEqual(duplicateResult.kind, "INVALID_SERVICE_DESCRIPTOR");
});

test("tenantserviceclickthroughpolicylifecycle", () => {
  // Add two services in different tenants
  let state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-alpha",
      tenantPath: "/tenant-alpha",
      classification: "INTERNAL",
      apexPath: "/apex-alpha",
      landingPath: "/landing-alpha",
      systemAdminResourceSets: ["system:alpha"],
      tenantAdminResourceSets: ["tenant:alpha:admin"],
    }),
  );

  state = addDescriptorOrFail(
    state,
    makeServiceDescriptor({
      id: "svc-beta",
      tenantPath: "/tenant-beta",
      classification: "COMPOSED",
      apexPath: "/apex-beta",
      landingPath: "/landing-beta",
      systemAdminResourceSets: ["system:beta"],
      tenantAdminResourceSets: ["tenant:beta:admin"],
    }),
  );

  // Alpha tenant decision
  const alphaDecision = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-alpha",
      "svc-alpha",
      ["tenant:alpha:admin"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(alphaDecision.decision, "GRANTED");
  assert.strictEqual(alphaDecision.clickthroughUrl, "/apex-alpha/tenant-alpha/landing-alpha");
  assert.deepStrictEqual(alphaDecision.forwardAuthSets, ["tenant:alpha:admin"]);

  // Beta tenant decision
  const betaDecision = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-beta",
      "svc-beta",
      ["system:beta"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(betaDecision.decision, "GRANTED");
  assert.strictEqual(betaDecision.clickthroughUrl, "/apex-beta/tenant-beta/landing-beta");
  assert.deepStrictEqual(betaDecision.forwardAuthSets, ["system:beta"]);

  // Cross-tenant access denied
  const crossTenant = capability.computeAccessDecision(
    state,
    "/tenant-alpha",
    "svc-beta",
    ["system:beta"],
    true,
    () => null,
  );
  assert.ok(isError(crossTenant));
  assert.strictEqual(crossTenant.kind, "MISSING_TENANT_ISOLATION");

  // Reconciliation per tenant contains only that tenant's services
  const alphaReconciliation = getReconciliation(
    capability.deriveReconciliation(state, "/tenant-alpha", true, () => null),
  );
  assert.ok(alphaReconciliation.includes("/apex-alpha/tenant-alpha*"));
  assert.ok(!alphaReconciliation.includes("/apex-beta/tenant-beta*"));

  const betaReconciliation = getReconciliation(
    capability.deriveReconciliation(state, "/tenant-beta", true, () => null),
  );
  assert.ok(betaReconciliation.includes("/apex-beta/tenant-beta*"));
  assert.ok(!betaReconciliation.includes("/apex-alpha/tenant-alpha*"));

  // Readiness after adding services with reconciler available
  const readyState = capability.computeReadiness(state, true);
  assert.strictEqual(readyState.readiness, "READY");
  assert.strictEqual(readyState.services.length, 2);

  // Readiness degrades when reconciler unavailable
  const degradedState = capability.computeReadiness(state, false);
  assert.strictEqual(degradedState.readiness, "DEGRADED");
  assert.strictEqual(degradedState.reconcilerAvailable, false);
});

test("tenantserviceclickthroughpolicypermissions", () => {
  // Validate classification
  const validClass = capability.validateServiceDescriptor(
    makeServiceDescriptor({
      classification: "DEV_ONLY" as capability.TenantServiceClickthroughPolicyClassification,
    }),
  );
  assert.strictEqual(validClass, null);

  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-perms",
      tenantPath: "/tenant-perms",
      classification: "COMPOSED",
      tenantAdminResourceSets: ["tenant:perms:admin"],
      systemAdminResourceSets: ["system:perms:ops"],
      landingPath: "/landing-perms",
    }),
  );

  // Tenant-admin access granted
  const tenantGranted = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-perms",
      "svc-perms",
      ["tenant:perms:admin"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(tenantGranted.decision, "GRANTED");
  assert.deepStrictEqual(tenantGranted.forwardAuthSets, ["tenant:perms:admin"]);

  // System-admin access granted
  const systemGranted = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-perms",
      "svc-perms",
      ["system:perms:ops"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(systemGranted.decision, "GRANTED");
  assert.deepStrictEqual(systemGranted.forwardAuthSets, ["system:perms:ops"]);

  // No matching set -> denied
  const denied = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-perms",
      "svc-perms",
      ["nobody"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(denied.decision, "DENIED");
  assert.strictEqual(denied.clickthroughUrl, null);

  // Dev-only service is denied even with valid sets
  const devState = addDescriptorOrFail(
    state,
    makeServiceDescriptor({
      id: "svc-perms-dev",
      tenantPath: "/tenant-perms",
      classification: "DEV_ONLY",
      devOnly: true,
      tenantAdminResourceSets: ["tenant:perms:admin"],
      systemAdminResourceSets: ["system:perms:ops"],
      landingPath: "/landing-perms-dev",
    }),
  );

  const devDenied = getDecision(
    capability.computeAccessDecision(
      devState,
      "/tenant-perms",
      "svc-perms-dev",
      ["system:perms:ops"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(devDenied.decision, "DENIED");
  assert.strictEqual(
    devDenied.reason,
    "Dev-only service not accessible in this context",
  );
});

test("tenantserviceclickthroughpolicyproof", () => {
  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-proof",
      tenantPath: "/tenant-proof",
      landingPath: "/proof",
      systemAdminResourceSets: ["system:proof:ops"],
      tenantAdminResourceSets: ["tenant:proof:admin"],
    }),
  );

  // Compute decision and reconciliation on original state
  const decision = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-proof",
      "svc-proof",
      ["system:proof:ops"],
      true,
      () => null,
    ),
  );
  const reconciliation = getReconciliation(
    capability.deriveReconciliation(state, "/tenant-proof", true, () => null),
  );

  // Change readiness (keeping reconciler available) -> decisions unchanged
  const notReadyState = capability.setReadiness(state, "NOT_READY", true);
  const decision2 = getDecision(
    capability.computeAccessDecision(
      notReadyState,
      "/tenant-proof",
      "svc-proof",
      ["system:proof:ops"],
      true,
      () => null,
    ),
  );
  assert.deepStrictEqual(decision2, decision);

  const reconciliation2 = getReconciliation(
    capability.deriveReconciliation(notReadyState, "/tenant-proof", true, () => null),
  );
  assert.strictEqual(reconciliation2, reconciliation);

  // computeReadiness returns READY when services exist and reconciler available
  const computed = capability.computeReadiness(state, true);
  assert.strictEqual(computed.readiness, "READY");

  // computeReadiness returns NOT_READY when no services
  const emptyState = capability.computeReadiness(capability.initialState, true);
  assert.strictEqual(emptyState.readiness, "NOT_READY");
});

test("tenantserviceclickthroughpolicyreadinessmodel", () => {
  // Start with empty state, reconciler available -> NOT_READY
  const emptyReady = capability.computeReadiness(capability.initialState, true);
  assert.strictEqual(emptyReady.readiness, "NOT_READY");
  assert.strictEqual(capability.getReadiness(emptyReady), "NOT_READY");

  // Add a service -> READY
  const withService = addDescriptorOrFail(
    emptyReady,
    makeServiceDescriptor({
      id: "svc-readiness",
      tenantPath: "/tenant-readiness",
      landingPath: "/readiness",
      systemAdminResourceSets: ["system:readiness"],
      tenantAdminResourceSets: ["tenant:readiness:admin"],
    }),
  );
  assert.strictEqual(capability.getReadiness(withService), "READY");

  // Reconciler unavailable -> DEGRADED
  const degraded = capability.computeReadiness(withService, false);
  assert.strictEqual(degraded.readiness, "DEGRADED");
  assert.strictEqual(degraded.reconcilerAvailable, false);
  assert.strictEqual(capability.getReadiness(degraded), "DEGRADED");

  // setReadiness with reconcilerAvailable=false forces DEGRADED even if readiness=READY
  const guarded = capability.setReadiness(degraded, "READY", false);
  assert.strictEqual(guarded.readiness, "DEGRADED");
  assert.strictEqual(guarded.reconcilerAvailable, false);

  // Derive reconciliation on degraded state -> RECONCILER_FAILURE error, but audit event emitted
  const auditEvents: capability.TenantServiceClickthroughPolicyAuditEvent[] = [];
  const reconcileError = capability.deriveReconciliation(
    guarded,
    "/tenant-readiness",
    false,
    (event) => {
      auditEvents.push(event);
      return null;
    },
  );
  assert.ok(isError(reconcileError));
  assert.strictEqual(reconcileError.kind, "RECONCILER_FAILURE");
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "RECONCILIATION_CHANGE");
  assert.strictEqual(auditEvents[0].tenantId, "/tenant-readiness");
});

test("tenantserviceclickthroughpolicystatemodel", () => {
  const descriptorA: capability.TenantServiceClickthroughPolicyServiceDescriptor = {
    id: "svc-state-a",
    resource: "resource/state-a",
    apexPath: "/apex/state-a",
    tenantPath: "/tenant-state-a",
    classification: "INTERNAL",
    landingPath: "/landing-a",
    devOnly: false,
    systemAdminResourceSets: ["system:state-a"],
    tenantAdminResourceSets: ["tenant:state-a:admin"],
  };

  const descriptorB: capability.TenantServiceClickthroughPolicyServiceDescriptor = {
    id: "svc-state-b",
    resource: "resource/state-b",
    apexPath: "/apex/state-b",
    tenantPath: "/tenant-state-b",
    classification: "COMPOSED",
    landingPath: "/landing-b",
    devOnly: false,
    systemAdminResourceSets: ["system:state-b"],
    tenantAdminResourceSets: ["tenant:state-b:admin"],
  };

  let state = addDescriptorOrFail(capability.initialState, descriptorA);
  state = addDescriptorOrFail(state, descriptorB);

  // Verify all fields are preserved
  assert.strictEqual(state.services.length, 2);
  const first = state.services[0];
  assert.ok(first !== undefined);
  assert.strictEqual(first.id, "svc-state-a");
  assert.strictEqual(first.resource, "resource/state-a");
  assert.strictEqual(first.apexPath, "/apex/state-a");
  assert.strictEqual(first.tenantPath, "/tenant-state-a");
  assert.strictEqual(first.classification, "INTERNAL");
  assert.strictEqual(first.landingPath, "/landing-a");
  assert.strictEqual(first.devOnly, false);
  assert.deepStrictEqual(first.systemAdminResourceSets, ["system:state-a"]);
  assert.deepStrictEqual(first.tenantAdminResourceSets, ["tenant:state-a:admin"]);

  const second = state.services[1];
  assert.ok(second !== undefined);
  assert.strictEqual(second.id, "svc-state-b");
  assert.strictEqual(second.resource, "resource/state-b");
  assert.strictEqual(second.classification, "COMPOSED");

  // Decision derived from state fields
  const decision = getDecision(
    capability.computeAccessDecision(
      state,
      "/tenant-state-b",
      "svc-state-b",
      ["tenant:state-b:admin"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(decision.decision, "GRANTED");
  assert.strictEqual(decision.clickthroughUrl, "/apex/state-b/tenant-state-b/landing-b");
  assert.deepStrictEqual(decision.forwardAuthSets, ["tenant:state-b:admin"]);

  // Reconciliation uses the correct sets
  const reconciliation = getReconciliation(
    capability.deriveReconciliation(state, "/tenant-state-b", true, () => null),
  );
  assert.ok(reconciliation.includes("/apex/state-b/tenant-state-b*"));
  assert.ok(
    reconciliation.includes(
      "uri /auth/verify?sets=system:state-b,tenant:state-b:admin",
    ),
  );

  // State is immutable: original initialState unchanged
  assert.strictEqual(capability.initialState.services.length, 0);
});

test("tenantserviceclickthroughpolicyvalidation", () => {
  // Empty id
  const emptyId = capability.validateServiceDescriptor(
    makeServiceDescriptor({ id: "   ", tenantPath: "/tenant-validation" }),
  );
  assert.ok(emptyId !== null);
  assert.strictEqual(emptyId.kind, "INVALID_SERVICE_DESCRIPTOR");

  // Empty apex path
  const emptyApex = capability.validateServiceDescriptor(
    makeServiceDescriptor({ apexPath: "   " }),
  );
  assert.ok(emptyApex !== null);
  assert.strictEqual(emptyApex.kind, "INVALID_SERVICE_DESCRIPTOR");

  // Empty tenant path
  const emptyTenant = capability.validateServiceDescriptor(
    makeServiceDescriptor({ tenantPath: "   " }),
  );
  assert.ok(emptyTenant !== null);
  assert.strictEqual(emptyTenant.kind, "INVALID_SERVICE_DESCRIPTOR");

  // Empty landing path
  const emptyLanding = capability.validateServiceDescriptor(
    makeServiceDescriptor({ landingPath: "   " }),
  );
  assert.ok(emptyLanding !== null);
  assert.strictEqual(emptyLanding.kind, "INVALID_SERVICE_DESCRIPTOR");

  // Invalid classification
  const invalidClass: capability.TenantServiceClickthroughPolicyServiceDescriptor = {
    ...makeServiceDescriptor({ tenantPath: "/tenant-validation" }),
    classification: "BROKEN" as capability.TenantServiceClickthroughPolicyClassification,
  };
  const invalidClassError = capability.validateServiceDescriptor(invalidClass);
  assert.ok(invalidClassError !== null);
  assert.strictEqual(invalidClassError.kind, "INVALID_SERVICE_DESCRIPTOR");

  // Adding invalid descriptor fails and does not change state
  const beforeAdd = capability.initialState;
  const addResult = capability.addServiceDescriptor(
    beforeAdd,
    makeServiceDescriptor({ id: "" }),
    () => null,
  );
  assert.ok(isError(addResult));
  assert.strictEqual(addResult.kind, "INVALID_SERVICE_DESCRIPTOR");
  assert.strictEqual(beforeAdd.services.length, 0);

  // Valid descriptor added successfully
  const validState = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-validation",
      tenantPath: "/tenant-validation",
      systemAdminResourceSets: ["system:validation:ops"],
      tenantAdminResourceSets: ["tenant:validation:admin"],
    }),
  );

  // Cross-tenant access -> MISSING_TENANT_ISOLATION
  const crossTenant = capability.computeAccessDecision(
    validState,
    "/tenant-other",
    "svc-validation",
    ["system:validation:ops"],
    true,
    () => null,
  );
  assert.ok(isError(crossTenant));
  assert.strictEqual(crossTenant.kind, "MISSING_TENANT_ISOLATION");

  // No matching resource set -> DENIED (fail closed)
  const denied = getDecision(
    capability.computeAccessDecision(
      validState,
      "/tenant-validation",
      "svc-validation",
      ["random:set"],
      true,
      () => null,
    ),
  );
  assert.strictEqual(denied.decision, "DENIED");
  assert.strictEqual(denied.clickthroughUrl, null);
});