import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/tenantserviceclickthroughpolicy.ts";

function makeServiceDescriptor(
  overrides: Partial<capability.TenantServiceClickthroughPolicyServiceDescriptor> = {},
): capability.TenantServiceClickthroughPolicyServiceDescriptor {
  return {
    id: "svc-core",
    resource: "resource/core",
    apexPath: "/apex",
    tenantPath: "/tenant-a",
    classification: "INTERNAL",
    landingPath: "/landing",
    devOnly: false,
    systemAdminResourceSets: ["system:ops"],
    tenantAdminResourceSets: ["tenant:tenant-a:admins"],
    ...overrides,
  };
}

function addDescriptorOrFail(
  state: capability.TenantServiceClickthroughPolicyState,
  descriptor: capability.TenantServiceClickthroughPolicyServiceDescriptor,
): capability.TenantServiceClickthroughPolicyState {
  const added = capability.addServiceDescriptor(state, descriptor, () => null);
  if ("kind" in added) {
    assert.fail(added.kind);
  }
  return added;
}

test("tenantserviceclickthroughpolicyauditmodel", () => {
  const events: capability.TenantServiceClickthroughPolicyAuditEvent[] = [];

  const addResult = capability.addServiceDescriptor(
    capability.initialState,
    makeServiceDescriptor({ id: "svc-audit", tenantPath: "/tenant-a" }),
    (event) => {
      events.push(event);
      return null;
    },
  );
  assert.ok(!("kind" in addResult));
  const state = addResult;

  const accessResult = capability.computeAccessDecision(
    state,
    "/tenant-a",
    "svc-audit",
    ["tenant:tenant-a:admins"],
    true,
    (event) => {
      events.push(event);
      return null;
    },
  );
  assert.ok(!("kind" in accessResult));
  assert.strictEqual(accessResult.decision, "GRANTED");
  assert.strictEqual(typeof accessResult.clickthroughUrl, "string");
  assert.ok(accessResult.clickthroughUrl!.includes("/apex/tenant-a/landing"));

  const policyEvent = events.find((e) => e.kind === "POLICY_CHANGE");
  assert.ok(policyEvent);
  assert.strictEqual(policyEvent.tenantId, "/tenant-a");
  assert.strictEqual(policyEvent.reason, "Policy configuration changed");

  const accessEvent = events.find((e) => e.kind === "ACCESS_DECISION");
  assert.ok(accessEvent);
  assert.strictEqual(accessEvent.tenantId, "/tenant-a");
  assert.strictEqual(accessEvent.serviceId, "svc-audit");
  assert.strictEqual(accessEvent.reason, "Access granted based on resource sets");
  assert.deepStrictEqual(accessEvent.dsrGdprEvidence, {
    userResourceSets: ["tenant:tenant-a:admins"],
    serviceResourceSets: ["tenant:tenant-a:admins"],
  });

  const reconcResult = capability.deriveReconciliation(
    state,
    "/tenant-a",
    true,
    (event) => {
      events.push(event);
      return null;
    },
  );
  assert.strictEqual(typeof reconcResult, "string");
  assert.ok((reconcResult as string).includes("/apex/tenant-a*"));

  const reconcEvent = events.find((e) => e.kind === "RECONCILIATION_CHANGE");
  assert.ok(reconcEvent);
  assert.strictEqual(reconcEvent.tenantId, "/tenant-a");

  const isolationResult = capability.computeAccessDecision(
    state,
    "/tenant-b",
    "svc-audit",
    ["tenant:tenant-a:admins"],
    true,
    () => null,
  );
  assert.ok("kind" in isolationResult);
  assert.strictEqual(isolationResult.kind, "MISSING_TENANT_ISOLATION");

  const auditFailure: capability.TenantServiceClickthroughPolicyError = {
    kind: "AUDIT_FAILURE",
    message: "audit sink unavailable",
    tenantId: "/tenant-a",
  };
  const alertResult = capability.computeAccessDecision(
    state,
    "/tenant-a",
    "svc-audit",
    ["tenant:tenant-a:admins"],
    true,
    () => auditFailure,
  );
  assert.deepStrictEqual(alertResult, auditFailure);
});

test("tenantserviceclickthroughpolicycontracts", () => {
  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-contracts",
      tenantPath: "/tenant-contracts",
      systemAdminResourceSets: ["system:contracts"],
      tenantAdminResourceSets: ["tenant:contracts:admins"],
      landingPath: "/contracts/landing",
    }),
  );

  const first = capability.computeAccessDecision(
    state,
    "/tenant-contracts",
    "svc-contracts",
    ["system:contracts", "tenant:contracts:admins"],
    true,
    () => null,
  );
  assert.ok(!("kind" in first));
  assert.strictEqual(first.decision, "GRANTED");
  assert.strictEqual(first.reason, "Access granted based on resource sets");
  assert.strictEqual(first.clickthroughUrl, "/apex/tenant-contracts/contracts/landing");
  assert.deepStrictEqual(first.forwardAuthSets, ["system:contracts", "tenant:contracts:admins"]);
  assert.strictEqual(typeof first.reconciliationConfig, "string");
  assert.ok(first.reconciliationConfig!.includes("uri /auth/verify?sets=system:contracts,tenant:contracts:admins"));

  const second = capability.computeAccessDecision(
    state,
    "/tenant-contracts",
    "svc-contracts",
    ["system:contracts", "tenant:contracts:admins"],
    true,
    () => null,
  );
  assert.ok(!("kind" in second));
  assert.deepStrictEqual(second, first);

  const firstReconcile = capability.deriveReconciliation(
    state,
    "/tenant-contracts",
    true,
    () => null,
  );
  assert.strictEqual(typeof firstReconcile, "string");
  assert.ok((firstReconcile as string).includes("/apex/tenant-contracts*"));
  assert.ok((firstReconcile as string).includes("uri /auth/verify?sets=system:contracts,tenant:contracts:admins"));
  assert.ok((firstReconcile as string).includes("reverse_proxy /contracts/landing"));

  const secondReconcile = capability.deriveReconciliation(
    state,
    "/tenant-contracts",
    true,
    () => null,
  );
  assert.strictEqual(typeof secondReconcile, "string");
  assert.strictEqual(secondReconcile, firstReconcile);
});

test("tenantserviceclickthroughpolicyerrormodel", () => {
  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-error",
      tenantPath: "/tenant-error",
    }),
  );
  const snapshot = state.services.map((s) => s.id);

  const events: capability.TenantServiceClickthroughPolicyAuditEvent[] = [];
  const reconcError = capability.deriveReconciliation(
    state,
    "/tenant-error",
    false,
    (event) => {
      events.push(event);
      return null;
    },
  );
  assert.ok(reconcError !== null);
  assert.ok("kind" in reconcError);
  assert.strictEqual(reconcError.kind, "RECONCILER_FAILURE");
  assert.deepStrictEqual(state.services.map((s) => s.id), snapshot);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "RECONCILIATION_CHANGE");

  const unavailableResult = capability.computeAccessDecision(
    state,
    "/tenant-error",
    "svc-error",
    ["system:ops", "tenant:tenant-error:admins"],
    false,
    (event) => {
      events.push(event);
      return null;
    },
  );
  assert.ok(!("kind" in unavailableResult));
  assert.strictEqual(unavailableResult.decision, "RECONCILER_UNAVAILABLE");
  assert.strictEqual(unavailableResult.clickthroughUrl, null);
  assert.ok(events.some((e) => e.kind === "ACCESS_DECISION" && e.decision === "RECONCILER_UNAVAILABLE"));

  const deniedResult = capability.computeAccessDecision(
    state,
    "/tenant-error",
    "svc-error",
    ["unrelated:set"],
    true,
    () => null,
  );
  assert.ok(!("kind" in deniedResult));
  assert.strictEqual(deniedResult.decision, "DENIED");
  assert.strictEqual(deniedResult.clickthroughUrl, null);
});

test("tenantserviceclickthroughpolicylifecycle", () => {
  const alpha = makeServiceDescriptor({
    id: "svc-lifecycle-alpha",
    tenantPath: "/tenant-alpha",
    apexPath: "/apex-alpha/",
    resource: "res/alpha",
    landingPath: "/landing-alpha",
    systemAdminResourceSets: ["system:alpha"],
    tenantAdminResourceSets: ["tenant:alpha:admin"],
  });
  const beta = makeServiceDescriptor({
    id: "svc-lifecycle-beta",
    tenantPath: "/tenant-beta",
    apexPath: "/apex-beta/",
    resource: "res/beta",
    landingPath: "/landing-beta",
    systemAdminResourceSets: ["system:beta"],
    tenantAdminResourceSets: ["tenant:beta:admin"],
  });

  let state = addDescriptorOrFail(capability.initialState, alpha);
  state = addDescriptorOrFail(state, beta);

  assert.strictEqual(state.readiness, "READY");

  const alphaDecision = capability.computeAccessDecision(
    state,
    "/tenant-alpha",
    "svc-lifecycle-alpha",
    ["tenant:alpha:admin"],
    true,
    () => null,
  );
  assert.ok(!("kind" in alphaDecision));
  assert.strictEqual(alphaDecision.decision, "GRANTED");
  assert.strictEqual(alphaDecision.clickthroughUrl, "/apex-alpha//tenant-alpha/landing-alpha");

  const crossTenantDecision = capability.computeAccessDecision(
    state,
    "/tenant-alpha",
    "svc-lifecycle-beta",
    ["system:alpha"],
    true,
    () => null,
  );
  assert.ok("kind" in crossTenantDecision);
  assert.strictEqual(crossTenantDecision.kind, "MISSING_TENANT_ISOLATION");

  const alphaReconcile = capability.deriveReconciliation(
    state,
    "/tenant-alpha",
    true,
    () => null,
  );
  assert.strictEqual(typeof alphaReconcile, "string");
  assert.ok((alphaReconcile as string).includes("/apex-alpha//tenant-alpha*"));
  assert.ok(!(alphaReconcile as string).includes("/apex-beta//tenant-beta*"));

  const betaReconcile = capability.deriveReconciliation(
    state,
    "/tenant-beta",
    true,
    () => null,
  );
  assert.strictEqual(typeof betaReconcile, "string");
  assert.ok((betaReconcile as string).includes("/apex-beta//tenant-beta*"));
  assert.ok(!(betaReconcile as string).includes("/apex-alpha//tenant-alpha*"));
});

test("tenantserviceclickthroughpolicypermissions", () => {
  assert.strictEqual(
    capability.validateServiceDescriptor(
      makeServiceDescriptor({
        id: "svc-permissions",
        classification: "COMPOSED",
        tenantAdminResourceSets: ["tenant:perms:admin"],
        systemAdminResourceSets: ["system:perms:ops"],
      }),
    ),
    null,
  );

  const state = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-permissions",
      tenantPath: "/tenant-perms",
      classification: "COMPOSED",
      tenantAdminResourceSets: ["tenant:perms:admin"],
      systemAdminResourceSets: ["system:perms:ops"],
    }),
  );

  const tenantGrant = capability.computeAccessDecision(
    state,
    "/tenant-perms",
    "svc-permissions",
    ["tenant:perms:admin"],
    true,
    () => null,
  );
  assert.ok(!("kind" in tenantGrant));
  assert.strictEqual(tenantGrant.decision, "GRANTED");
  assert.deepStrictEqual(tenantGrant.forwardAuthSets, ["tenant:perms:admin"]);

  const systemGrant = capability.computeAccessDecision(
    state,
    "/tenant-perms",
    "svc-permissions",
    ["system:perms:ops"],
    true,
    () => null,
  );
  assert.ok(!("kind" in systemGrant));
  assert.strictEqual(systemGrant.decision, "GRANTED");
  assert.deepStrictEqual(systemGrant.forwardAuthSets, ["system:perms:ops"]);

  const deny = capability.computeAccessDecision(
    state,
    "/tenant-perms",
    "svc-permissions",
    ["nobody"],
    true,
    () => null,
  );
  assert.ok(!("kind" in deny));
  assert.strictEqual(deny.decision, "DENIED");
  assert.strictEqual(deny.clickthroughUrl, null);

  const devOnlyState = addDescriptorOrFail(
    state,
    makeServiceDescriptor({
      id: "svc-permissions-dev",
      tenantPath: "/tenant-perms",
      classification: "DEV_ONLY",
      devOnly: true,
      systemAdminResourceSets: ["system:perms:ops"],
    }),
  );

  const devOnlyDecision = capability.computeAccessDecision(
    devOnlyState,
    "/tenant-perms",
    "svc-permissions-dev",
    ["system:perms:ops"],
    true,
    () => null,
  );
  assert.ok(!("kind" in devOnlyDecision));
  assert.strictEqual(devOnlyDecision.decision, "DENIED");
  assert.strictEqual(devOnlyDecision.reason, "Dev-only service not accessible in this context");
});

test("tenantserviceclickthroughpolicyproof", () => {
  const withService = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-proof",
      tenantPath: "/tenant-proof",
      systemAdminResourceSets: ["system:proof:ops"],
      tenantAdminResourceSets: ["tenant:proof:admin"],
      landingPath: "/proof/landing",
    }),
  );
  const stateNotReady = capability.setReadiness(withService, "NOT_READY");

  const proofDecisionOne = capability.computeAccessDecision(
    stateNotReady,
    "/tenant-proof",
    "svc-proof",
    ["system:proof:ops"],
    true,
    () => null,
  );
  assert.ok(!("kind" in proofDecisionOne));

  const proofDecisionTwo = capability.computeAccessDecision(
    stateNotReady,
    "/tenant-proof",
    "svc-proof",
    ["system:proof:ops"],
    true,
    () => null,
  );
  assert.ok(!("kind" in proofDecisionTwo));
  assert.deepStrictEqual(proofDecisionTwo, proofDecisionOne);

  const reconcOne = capability.deriveReconciliation(stateNotReady, "/tenant-proof", true, () => null);
  assert.strictEqual(typeof reconcOne, "string");
  const reconcTwo = capability.deriveReconciliation(stateNotReady, "/tenant-proof", true, () => null);
  assert.strictEqual(typeof reconcTwo, "string");
  assert.strictEqual(reconcTwo, reconcOne);
  assert.ok((reconcOne as string).includes(`sets=${proofDecisionOne.forwardAuthSets.join(",")}`));

  const readyState = capability.setReadiness(stateNotReady, "READY");
  const afterReadyDecision = capability.computeAccessDecision(
    readyState,
    "/tenant-proof",
    "svc-proof",
    ["system:proof:ops"],
    true,
    () => null,
  );
  assert.ok(!("kind" in afterReadyDecision));
  assert.deepStrictEqual(afterReadyDecision, proofDecisionOne);
});

test("tenantserviceclickthroughpolicyreadinessmodel", () => {
  const base = capability.setReadiness(capability.initialState, "DEGRADED");
  const state = addDescriptorOrFail(
    base,
    makeServiceDescriptor({
      id: "svc-readiness",
      tenantPath: "/tenant-readiness",
      systemAdminResourceSets: ["system:rdy"],
      tenantAdminResourceSets: ["tenant:rdy:admin"],
    }),
  );
  assert.strictEqual(capability.getReadiness(state), "DEGRADED");

  const events: capability.TenantServiceClickthroughPolicyAuditEvent[] = [];
  const reconciliation = capability.deriveReconciliation(
    state,
    "/tenant-readiness",
    false,
    (event) => {
      events.push(event);
      return null;
    },
  );
  assert.ok(reconciliation !== null);
  assert.ok("kind" in reconciliation);
  assert.strictEqual(reconciliation.kind, "RECONCILER_FAILURE");
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "RECONCILIATION_CHANGE");
  assert.strictEqual(capability.getReadiness(state), "DEGRADED");
});

test("tenantserviceclickthroughpolicystatemodel", () => {
  const first = makeServiceDescriptor({
    id: "svc-state-a",
    resource: "resource/state-a",
    apexPath: "/apex/state-a/",
    tenantPath: "/tenant-state-a",
    classification: "INTERNAL",
    landingPath: "/landing-a",
    systemAdminResourceSets: ["system:state-a"],
    tenantAdminResourceSets: ["tenant:state-a:admin"],
  });
  const second = makeServiceDescriptor({
    id: "svc-state-b",
    resource: "resource/state-b",
    apexPath: "/apex/state-b/",
    tenantPath: "/tenant-state-b",
    classification: "COMPOSED",
    landingPath: "/landing-b",
    systemAdminResourceSets: ["system:state-b"],
    tenantAdminResourceSets: ["tenant:state-b:admin"],
  });

  let state = addDescriptorOrFail(capability.initialState, first);
  state = addDescriptorOrFail(state, second);

  assert.strictEqual(state.services.length, 2);
  assert.strictEqual(state.services[0].id, "svc-state-a");
  assert.strictEqual(state.services[0].resource, "resource/state-a");
  assert.strictEqual(state.services[0].apexPath, "/apex/state-a/");
  assert.strictEqual(state.services[0].tenantPath, "/tenant-state-a");
  assert.strictEqual(state.services[0].classification, "INTERNAL");
  assert.strictEqual(state.services[0].landingPath, "/landing-a");
  assert.strictEqual(state.services[0].devOnly, false);
  assert.deepStrictEqual(state.services[0].systemAdminResourceSets, ["system:state-a"]);
  assert.deepStrictEqual(state.services[0].tenantAdminResourceSets, ["tenant:state-a:admin"]);

  const decision = capability.computeAccessDecision(
    state,
    "/tenant-state-b",
    "svc-state-b",
    ["tenant:state-b:admin"],
    true,
    () => null,
  );
  assert.ok(!("kind" in decision));
  assert.strictEqual(decision.decision, "GRANTED");
  assert.strictEqual(decision.clickthroughUrl, "/apex/state-b//tenant-state-b/landing-b");

  const migration = capability.deriveReconciliation(
    state,
    "/tenant-state-b",
    true,
    () => null,
  );
  assert.strictEqual(typeof migration, "string");
  assert.ok((migration as string).includes("/apex/state-b//tenant-state-b*"));
  assert.ok((migration as string).includes("uri /auth/verify?sets=system:state-b,tenant:state-b:admin"));
});

test("tenantserviceclickthroughpolicyvalidation", () => {
  const emptyIdError = capability.validateServiceDescriptor(makeServiceDescriptor({ id: "   " }));
  assert.ok(emptyIdError !== null);
  assert.strictEqual(emptyIdError.kind, "INVALID_SERVICE_DESCRIPTOR");

  const invalidClassification = {
    ...makeServiceDescriptor({ id: "svc-validation-class" }),
    classification: "BROKEN" as unknown as capability.TenantServiceClickthroughPolicyClassification,
  } as capability.TenantServiceClickthroughPolicyServiceDescriptor;

  const invalidClassificationError = capability.validateServiceDescriptor(invalidClassification);
  assert.ok(invalidClassificationError !== null);
  assert.strictEqual(invalidClassificationError.kind, "INVALID_SERVICE_DESCRIPTOR");

  const rejected = capability.addServiceDescriptor(
    capability.initialState,
    invalidClassification,
    () => null,
  );
  assert.ok("kind" in rejected);
  assert.strictEqual(rejected.kind, "INVALID_SERVICE_DESCRIPTOR");

  const validState = addDescriptorOrFail(
    capability.initialState,
    makeServiceDescriptor({
      id: "svc-validation",
      tenantPath: "/tenant-validation",
      systemAdminResourceSets: ["system:validation"],
    }),
  );

  const isolationFailure = capability.computeAccessDecision(
    validState,
    "/tenant-other",
    "svc-validation",
    ["system:validation"],
    true,
    () => null,
  );
  assert.ok("kind" in isolationFailure);
  assert.strictEqual(isolationFailure.kind, "MISSING_TENANT_ISOLATION");

  const denied = capability.computeAccessDecision(
    validState,
    "/tenant-validation",
    "svc-validation",
    ["random:set"],
    true,
    () => null,
  );
  assert.ok(!("kind" in denied));
  assert.strictEqual(denied.decision, "DENIED");
  assert.strictEqual(denied.clickthroughUrl, null);
});