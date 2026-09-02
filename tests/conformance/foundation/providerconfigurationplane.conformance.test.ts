import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/providerconfigurationplane.ts";

type StateOrError =
  | capability.ProviderConfigurationPlaneState
  | capability.ProviderConfigurationPlaneError;

function isErrorResult(result: StateOrError): result is capability.ProviderConfigurationPlaneError {
  return typeof result === "object" && result !== null && "kind" in result;
}

function makeAuditMetadata(changedBy: string): capability.ProviderConfigurationPlaneAuditMetadata {
  return {
    changedBy,
    timestamp: "2026-09-02T00:00:00Z",
    justification: "conformance",
  };
}

function makeProviderConfig(
  providerKey: string,
): Omit<capability.ProviderConfigurationPlaneProviderConfig, "lifecycleState" | "auditMetadata"> {
  return {
    providerKey,
    capability: "providerconfigurationplane",
    environment: "test",
    instanceLabel: "default",
    classification: "internal",
    endpoint: "https://provider.internal",
    config: { region: "us-east-1" },
    credentialRef: null,
    requiresCredential: false,
  };
}

test("providerconfigurationplaneauditmodel", () => {
  const auditMetadata = makeAuditMetadata("audit-admin");
  const auditEvents: capability.ProviderConfigurationPlaneAuditEvent[] = [];

  const auditFn = (
    event: capability.ProviderConfigurationPlaneAuditEvent,
  ): capability.ProviderConfigurationPlaneError | null => {
    auditEvents.push(event);
    return null;
  };

  const config = makeProviderConfig("provider-auditmodel");
  const createResult = capability.createProviderConfig(
    capability.initialState,
    config,
    auditMetadata,
    auditFn,
  );

  if (isErrorResult(createResult)) {
    assert.fail(createResult.kind);
  }

  assert.strictEqual(auditEvents.length, 1);
  const createEvent = auditEvents[0];
  assert.ok(createEvent !== undefined);
  assert.strictEqual(createEvent.kind, "AUDIT_BEFORE_MUTATION");
  assert.strictEqual(createEvent.providerKey, "provider-auditmodel");
  assert.strictEqual(createEvent.previousState, null);
  assert.strictEqual(
    createEvent.newState,
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(createEvent.metadata.changedBy, "audit-admin");

  const created = createResult.providerConfigs[0];
  assert.ok(created !== undefined);
  assert.deepStrictEqual(created.auditMetadata, auditMetadata);

  const configured = capability.transitionProviderLifecycle(
    createResult,
    "provider-auditmodel",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }

  const transitionResult = capability.transitionProviderLifecycle(
    configured,
    "provider-auditmodel",
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );

  if (isErrorResult(transitionResult)) {
    assert.fail(transitionResult.kind);
  }

  assert.strictEqual(auditEvents.length, 3);
  const transitionEvent = auditEvents[2];
  assert.ok(transitionEvent !== undefined);
  assert.strictEqual(transitionEvent.providerKey, "provider-auditmodel");
  assert.strictEqual(
    transitionEvent.previousState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(
    transitionEvent.newState,
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  const transitioned = transitionResult.providerConfigs[0];
  assert.ok(transitioned !== undefined);
  assert.strictEqual(
    transitioned.lifecycleState,
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  // Readiness signal remains visible in degraded mode (audit-history honesty).
  const readiness = capability.getProviderReadiness(transitionResult, "provider-auditmodel");
  assert.strictEqual(
    readiness,
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneReadinessSignal,
  );

  const deleteAuditEvents: capability.ProviderConfigurationPlaneAuditEvent[] = [];
  const deleteAuditFn = (
    event: capability.ProviderConfigurationPlaneAuditEvent,
  ): capability.ProviderConfigurationPlaneError | null => {
    deleteAuditEvents.push(event);
    return null;
  };
  const deleted = capability.deleteProviderConfig(
    transitionResult,
    "provider-auditmodel",
    auditMetadata,
    deleteAuditFn,
  );
  if (isErrorResult(deleted)) {
    assert.fail(deleted.kind);
  }
  assert.strictEqual(deleteAuditEvents.length, 1);
  const deleteEvent = deleteAuditEvents[0];
  assert.ok(deleteEvent !== undefined);
  assert.strictEqual(deleteEvent.kind, "AUDIT_BEFORE_MUTATION");
  assert.strictEqual(
    deleteEvent.previousState,
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(deleteEvent.newState, null);
  assert.strictEqual(deleted.providerConfigs.length, 0);
});

test("providerconfigurationplanecontracts", () => {
  const auditMetadata = makeAuditMetadata("contract-admin");
  const auditFn = () => null;

  // Initial repository state is empty and last-error is null.
  const baseConfigs = capability.getAllProviderConfigs(capability.initialState);
  assert.strictEqual(baseConfigs.length, 0);
  assert.strictEqual(capability.initialState.lastError, null);

  // Admin create operation.
  const created = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-contracts"),
    auditMetadata,
    auditFn,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }

  const allConfigs = capability.getAllProviderConfigs(created);
  assert.strictEqual(allConfigs.length, 1);

  // Admin read operation.
  const readConfig = capability.getProviderConfig(created, "provider-contracts");
  assert.ok(readConfig !== null);
  assert.strictEqual(readConfig.providerKey, "provider-contracts");

  // Read of missing configuration returns null (no invented default).
  assert.strictEqual(capability.getProviderConfig(created, "missing-provider"), null);

  // Lifecycle transition operations.
  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-contracts",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }
  const configuredRecord = capability.getProviderConfig(configured, "provider-contracts");
  assert.ok(configuredRecord !== null);
  assert.strictEqual(
    configuredRecord.lifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  const ready = capability.transitionProviderLifecycle(
    configured,
    "provider-contracts",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(ready)) {
    assert.fail(ready.kind);
  }
  const readyRecord = capability.getProviderConfig(ready, "provider-contracts");
  assert.ok(readyRecord !== null);
  assert.strictEqual(
    readyRecord.lifecycleState,
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  // Admin delete operation.
  const deleted = capability.deleteProviderConfig(
    ready,
    "provider-contracts",
    auditMetadata,
    auditFn,
  );
  if (isErrorResult(deleted)) {
    assert.fail(deleted.kind);
  }
  assert.strictEqual(
    capability.getProviderConfig(deleted, "provider-contracts"),
    null,
  );

  // Fail-closed: missing required providerKey is rejected rather than defaulted.
  const invalidCreate = capability.createProviderConfig(
    capability.initialState,
    {
      ...makeProviderConfig("bad-provider-contracts"),
      providerKey: "",
    },
    auditMetadata,
    auditFn,
  );
  if (isErrorResult(invalidCreate)) {
    assert.strictEqual(invalidCreate.kind, "INVALID_CONFIGURATION");
  } else {
    assert.fail("invalid config should fail contract validation");
  }

  // The state object exposed for read was not mutated by the failed create.
  const stateAfterInvalid = capability.getAllProviderConfigs(capability.initialState);
  assert.strictEqual(stateAfterInvalid.length, 0);
});

test("providerconfigurationplaneerrormodel", () => {
  const auditMetadata = makeAuditMetadata("error-admin");
  const auditEvents: capability.ProviderConfigurationPlaneAuditEvent[] = [];

  const auditFn = (
    event: capability.ProviderConfigurationPlaneAuditEvent,
  ): capability.ProviderConfigurationPlaneError | null => {
    auditEvents.push(event);
    return null;
  };

  const created = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-errormodel"),
    auditMetadata,
    auditFn,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }

  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-errormodel",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }

  // Health-probe failure returns a typed degraded/readiness failure and keeps the
  // mutation boundary closed.
  const preErrorAuditCount = auditEvents.length;
  const failedReady = capability.transitionProviderLifecycle(
    configured,
    "provider-errormodel",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    false,
  );

  if (isErrorResult(failedReady)) {
    assert.strictEqual(failedReady.kind, "HEALTH_PROBE_FAILED");
    assert.strictEqual(failedReady.providerKey, "provider-errormodel");
  } else {
    assert.fail("health-probe failure should return typed error");
  }

  // No successful mutation was reported; the lifecycle is unchanged.
  assert.strictEqual(auditEvents.length, preErrorAuditCount);

  const stillConfigured = capability.getProviderConfig(configured, "provider-errormodel");
  assert.ok(stillConfigured !== null);
  assert.strictEqual(
    stillConfigured.lifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  // No false readiness was reported.
  assert.strictEqual(capability.getProviderReadiness(configured, "provider-errormodel"), null);

  // Explicit degraded mode stays visible read-only.
  const degradedResult = capability.transitionProviderLifecycle(
    configured,
    "provider-errormodel",
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(degradedResult)) {
    assert.fail(degradedResult.kind);
  }
  const degradedReadiness = capability.getProviderReadiness(degradedResult, "provider-errormodel");
  assert.strictEqual(
    degradedReadiness,
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneReadinessSignal,
  );

  // Audit history is still visible in degraded mode.
  assert.ok(auditEvents.length > 0);

  // Illegal lifecycle transition is reported as a typed error.
  const illegalTransition = capability.transitionProviderLifecycle(
    configured,
    "provider-errormodel",
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(illegalTransition)) {
    assert.strictEqual(illegalTransition.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  } else {
    assert.fail("illegal transition should return typed error");
  }
});

test("providerconfigurationplanelifecycle", () => {
  const auditMetadata = makeAuditMetadata("lifecycle-admin");
  const auditFn = () => null;

  // PROPOSED on creation.
  const created = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-lifecycle"),
    auditMetadata,
    auditFn,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }
  const createdRecord = capability.getProviderConfig(created, "provider-lifecycle");
  assert.ok(createdRecord !== null);
  assert.strictEqual(
    createdRecord.lifecycleState,
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  // PROPOSED -> CONFIGURED.
  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-lifecycle",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }
  const configuredRecord = capability.getProviderConfig(configured, "provider-lifecycle");
  assert.ok(configuredRecord !== null);
  assert.strictEqual(
    configuredRecord.lifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  // CONFIGURED -> READY.
  const ready = capability.transitionProviderLifecycle(
    configured,
    "provider-lifecycle",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(ready)) {
    assert.fail(ready.kind);
  }
  const readyRecord = capability.getProviderConfig(ready, "provider-lifecycle");
  assert.ok(readyRecord !== null);
  assert.strictEqual(
    readyRecord.lifecycleState,
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(
    capability.getProviderReadiness(ready, "provider-lifecycle"),
    "READY" satisfies capability.ProviderConfigurationPlaneReadinessSignal,
  );

  // READY -> DEGRADED.
  const degraded = capability.transitionProviderLifecycle(
    ready,
    "provider-lifecycle",
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(degraded)) {
    assert.fail(degraded.kind);
  }
  const degradedRecord = capability.getProviderConfig(degraded, "provider-lifecycle");
  assert.ok(degradedRecord !== null);
  assert.strictEqual(
    degradedRecord.lifecycleState,
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(
    capability.getProviderReadiness(degraded, "provider-lifecycle"),
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneReadinessSignal,
  );

  // DEGRADED -> DISABLED.
  const disabled = capability.transitionProviderLifecycle(
    degraded,
    "provider-lifecycle",
    "DISABLED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(disabled)) {
    assert.fail(disabled.kind);
  }
  const disabledRecord = capability.getProviderConfig(disabled, "provider-lifecycle");
  assert.ok(disabledRecord !== null);
  assert.strictEqual(
    disabledRecord.lifecycleState,
    "DISABLED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(capability.getProviderReadiness(disabled, "provider-lifecycle"), null);

  // DISABLED -> PROPOSED.
  const reopened = capability.transitionProviderLifecycle(
    disabled,
    "provider-lifecycle",
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(reopened)) {
    assert.fail(reopened.kind);
  }
  const reopenedRecord = capability.getProviderConfig(reopened, "provider-lifecycle");
  assert.ok(reopenedRecord !== null);
  assert.strictEqual(
    reopenedRecord.lifecycleState,
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  // PROPOSED -> READY is illegal; promotion is deliberate.
  const illegalJump = capability.transitionProviderLifecycle(
    reopened,
    "provider-lifecycle",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(illegalJump)) {
    assert.strictEqual(illegalJump.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  } else {
    assert.fail("illegal PROPOSED -> READY transition should be rejected");
  }
});

test("providerconfigurationplanepermissions", () => {
  const baseMetadata = makeAuditMetadata("permission-admin");

  // Credential reference is gated by requiresCredential; the secrets boundary
  // is enforced by the validator.
  const requiresRefMissing = capability.createProviderConfig(
    capability.initialState,
    {
      ...makeProviderConfig("provider-permissions"),
      requiresCredential: true,
      credentialRef: null,
    },
    baseMetadata,
    () => null,
  );

  if (isErrorResult(requiresRefMissing)) {
    assert.strictEqual(requiresRefMissing.kind, "MISSING_CREDENTIAL_REFERENCE");
    assert.strictEqual(requiresRefMissing.providerKey, "provider-permissions");
  } else {
    assert.fail("requiresCredential without credentialRef should fail");
  }

  // Provider config is created with a credential reference, not embedded secrets.
  const created = capability.createProviderConfig(
    capability.initialState,
    {
      ...makeProviderConfig("provider-permissions"),
      requiresCredential: true,
      credentialRef: "secrets://provider-permissions/key",
    },
    baseMetadata,
    () => null,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }

  const stored = capability.getProviderConfig(created, "provider-permissions");
  assert.ok(stored !== null);
  assert.strictEqual(stored.requiresCredential, true);
  assert.strictEqual(stored.credentialRef, "secrets://provider-permissions/key");

  // Audit failure must keep the lifecycle mutation boundary closed.
  const blockedAudit: capability.ProviderConfigurationPlaneAuditEvent[] = [];
  const auditBlockedError = capability.transitionProviderLifecycle(
    created,
    "provider-permissions",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    baseMetadata,
    (event) => {
      blockedAudit.push(event);
      return {
        kind: "AUDIT_FAILURE",
        message: "audit denied",
        providerKey: event.providerKey,
      };
    },
    true,
  );

  if (isErrorResult(auditBlockedError)) {
    assert.strictEqual(auditBlockedError.kind, "AUDIT_FAILURE");
  } else {
    assert.fail("audit failure should block lifecycle mutation");
  }

  const unchanged = capability.getProviderConfig(created, "provider-permissions");
  assert.ok(unchanged !== null);
  assert.strictEqual(
    unchanged.lifecycleState,
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(blockedAudit.length, 1);

  // Audit failure also closes the delete mutation boundary.
  const deleteBlockedAudit: capability.ProviderConfigurationPlaneAuditEvent[] = [];
  const deleteBlocked = capability.deleteProviderConfig(
    created,
    "provider-permissions",
    baseMetadata,
    (event) => {
      deleteBlockedAudit.push(event);
      return {
        kind: "AUDIT_FAILURE",
        message: "audit denied",
        providerKey: event.providerKey,
      };
    },
  );
  if (isErrorResult(deleteBlocked)) {
    assert.strictEqual(deleteBlocked.kind, "AUDIT_FAILURE");
  } else {
    assert.fail("audit failure should block delete");
  }
  const stillThere = capability.getProviderConfig(created, "provider-permissions");
  assert.ok(stillThere !== null);
});

test("providerconfigurationplaneproof", () => {
  const proofMetadata = makeAuditMetadata("proof-admin");

  // Configuration semantics: valid configuration passes validation.
  const validated = capability.validateProviderConfig({
    ...makeProviderConfig("provider-proof"),
    lifecycleState: "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.strictEqual(validated, null);

  // Lifecycle semantics: a legal transition passes; an illegal one is rejected.
  const transitionProofA = capability.validateLifecycleTransition(
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(transitionProofA, null);

  const transitionProofBad = capability.validateLifecycleTransition(
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  if (transitionProofBad !== null) {
    assert.strictEqual(transitionProofBad.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  } else {
    assert.fail("invalid lifecycle transition should fail");
  }

  // Audit-before-mutation semantics: the audit callback observes the event.
  const auditEvents: capability.ProviderConfigurationPlaneAuditEvent[] = [];
  const auditResult = capability.auditProviderConfigMutation(
    "provider-proof",
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    proofMetadata,
    (event) => {
      auditEvents.push(event);
      return null;
    },
  );
  assert.strictEqual(auditResult, null);
  assert.strictEqual(auditEvents.length, 1);

  // A throwing audit fn is converted to a typed AUDIT_FAILURE.
  const throwingAudit = capability.auditProviderConfigMutation(
    "provider-proof-throw",
    null,
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    proofMetadata,
    () => {
      throw new Error("boom");
    },
  );
  if (throwingAudit !== null) {
    assert.strictEqual(throwingAudit.kind, "AUDIT_FAILURE");
    assert.strictEqual(throwingAudit.providerKey, "provider-proof-throw");
  } else {
    assert.fail("throwing audit fn should return typed AUDIT_FAILURE");
  }

  // Readiness semantics: configured providers are not yet ready.
  const proofState = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-proof"),
    proofMetadata,
    () => null,
  );
  if (isErrorResult(proofState)) {
    assert.fail(proofState.kind);
  }

  const proofTransition = capability.transitionProviderLifecycle(
    proofState,
    "provider-proof",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    proofMetadata,
    () => null,
    true,
  );
  if (isErrorResult(proofTransition)) {
    assert.fail(proofTransition.kind);
  }
  assert.strictEqual(capability.getProviderReadiness(proofTransition, "provider-proof"), null);

  const readyState = capability.transitionProviderLifecycle(
    proofTransition,
    "provider-proof",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    proofMetadata,
    () => null,
    true,
  );
  if (isErrorResult(readyState)) {
    assert.fail(readyState.kind);
  }
  assert.strictEqual(
    capability.getProviderReadiness(readyState, "provider-proof"),
    "READY" satisfies capability.ProviderConfigurationPlaneReadinessSignal,
  );
});

test("providerconfigurationplanereadinessmodel", () => {
  const metadata = makeAuditMetadata("readiness-admin");
  const auditFn = () => null;

  const created = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-readiness"),
    metadata,
    auditFn,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }

  // PROPOSED is not ready.
  assert.strictEqual(capability.getProviderReadiness(created, "provider-readiness"), null);
  assert.strictEqual(capability.getProviderReadiness(created, "missing-provider"), null);

  // PROPOSED -> READY is illegal; readiness cannot be reached without
  // configuration.
  const illegalReady = capability.transitionProviderLifecycle(
    created,
    "provider-readiness",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(illegalReady)) {
    assert.strictEqual(illegalReady.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  } else {
    assert.fail("provider should not become READY from PROPOSED");
  }

  // CONFIGURED is still not ready.
  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-readiness",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }
  assert.strictEqual(capability.getProviderReadiness(configured, "provider-readiness"), null);

  // A failed health probe blocks the READY transition (fails closed).
  const failedReady = capability.transitionProviderLifecycle(
    configured,
    "provider-readiness",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    false,
  );
  if (isErrorResult(failedReady)) {
    assert.strictEqual(failedReady.kind, "HEALTH_PROBE_FAILED");
  } else {
    assert.fail("health probe must block READY transition when false");
  }

  const stillConfigured = capability.getProviderConfig(configured, "provider-readiness");
  assert.ok(stillConfigured !== null);
  assert.strictEqual(
    stillConfigured.lifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  // A passing health probe allows the transition to READY.
  const ready = capability.transitionProviderLifecycle(
    configured,
    "provider-readiness",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(ready)) {
    assert.fail(ready.kind);
  }
  assert.strictEqual(
    capability.getProviderReadiness(ready, "provider-readiness"),
    "READY" satisfies capability.ProviderConfigurationPlaneReadinessSignal,
  );

  // READY -> DEGRADED keeps readiness visible read-only.
  const degraded = capability.transitionProviderLifecycle(
    ready,
    "provider-readiness",
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(degraded)) {
    assert.fail(degraded.kind);
  }
  assert.strictEqual(
    capability.getProviderReadiness(degraded, "provider-readiness"),
    "DEGRADED" satisfies capability.ProviderConfigurationPlaneReadinessSignal,
  );

  // DISABLED has no readiness signal.
  const disabled = capability.transitionProviderLifecycle(
    degraded,
    "provider-readiness",
    "DISABLED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(disabled)) {
    assert.fail(disabled.kind);
  }
  assert.strictEqual(capability.getProviderReadiness(disabled, "provider-readiness"), null);
});

test("providerconfigurationplanestatemodel", () => {
  const metadata = makeAuditMetadata("state-admin");

  const providerConfig: Omit<
    capability.ProviderConfigurationPlaneProviderConfig,
    "lifecycleState" | "auditMetadata"
  > = {
    providerKey: "provider-state",
    capability: "state-plane",
    environment: "prod",
    instanceLabel: "i-001",
    classification: "restricted",
    endpoint: "https://state.internal",
    config: { timeoutMs: 30000 },
    credentialRef: "cred:/state/ref",
    requiresCredential: true,
  };

  const state = capability.createProviderConfig(
    capability.initialState,
    providerConfig,
    metadata,
    () => null,
  );
  if (isErrorResult(state)) {
    assert.fail(state.kind);
  }

  const stored = state.providerConfigs[0];
  assert.ok(stored !== undefined);
  assert.strictEqual(stored.providerKey, providerConfig.providerKey);
  assert.strictEqual(stored.capability, providerConfig.capability);
  assert.strictEqual(stored.environment, providerConfig.environment);
  assert.strictEqual(stored.instanceLabel, providerConfig.instanceLabel);
  assert.strictEqual(stored.classification, providerConfig.classification);
  assert.strictEqual(
    stored.lifecycleState,
    "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.strictEqual(stored.endpoint, providerConfig.endpoint);
  assert.deepStrictEqual(stored.config, providerConfig.config);
  assert.strictEqual(stored.credentialRef, providerConfig.credentialRef);
  assert.strictEqual(stored.requiresCredential, providerConfig.requiresCredential);
  assert.deepStrictEqual(stored.auditMetadata, metadata);

  const all = capability.getAllProviderConfigs(state);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(
    capability.getProviderConfig(state, "provider-state")?.providerKey,
    "provider-state",
  );
  assert.strictEqual(state.lastError, null);

  // The lifecycle-state union must include all contractual states.
  const lifecycle: readonly capability.ProviderConfigurationPlaneLifecycleState[] =
    capability.ProviderConfigurationPlaneLifecycleState;
  assert.ok(
    (lifecycle as readonly string[]).includes("PROPOSED"),
    "lifecycle state union must include PROPOSED",
  );
  assert.ok(
    (lifecycle as readonly string[]).includes("CONFIGURED"),
    "lifecycle state union must include CONFIGURED",
  );
  assert.ok(
    (lifecycle as readonly string[]).includes("READY"),
    "lifecycle state union must include READY",
  );
  assert.ok(
    (lifecycle as readonly string[]).includes("DEGRADED"),
    "lifecycle state union must include DEGRADED",
  );
  assert.ok(
    (lifecycle as readonly string[]).includes("DISABLED"),
    "lifecycle state union must include DISABLED",
  );

  const secondConfig = capability.createProviderConfig(
    state,
    makeProviderConfig("provider-state-2"),
    metadata,
    () => null,
  );
  if (isErrorResult(secondConfig)) {
    assert.fail(secondConfig.kind);
  }
  assert.strictEqual(secondConfig.providerConfigs.length, 2);
  assert.strictEqual(capability.getAllProviderConfigs(secondConfig).length, 2);
});

test("providerconfigurationplanevalidation", () => {
  const metadata = makeAuditMetadata("validation-admin");
  const auditFn = () => null;

  // Missing providerKey fails closed.
  const directValidation = capability.validateProviderConfig({
    ...makeProviderConfig("provider-validation"),
    providerKey: "",
    lifecycleState: "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.ok(directValidation !== null);
  if (directValidation !== null) {
    assert.strictEqual(directValidation.kind, "INVALID_CONFIGURATION");
  }

  // Missing capability fails closed.
  const missingCapability = capability.validateProviderConfig({
    ...makeProviderConfig("provider-validation"),
    capability: "",
    lifecycleState: "PROPOSED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.ok(missingCapability !== null);
  if (missingCapability !== null) {
    assert.strictEqual(missingCapability.kind, "INVALID_CONFIGURATION");
  }

  // requiresCredential with no credentialRef fails closed.
  const missingCredential = capability.createProviderConfig(
    capability.initialState,
    {
      ...makeProviderConfig("provider-validation"),
      requiresCredential: true,
      credentialRef: null,
    },
    metadata,
    auditFn,
  );
  if (isErrorResult(missingCredential)) {
    assert.strictEqual(missingCredential.kind, "MISSING_CREDENTIAL_REFERENCE");
  } else {
    assert.fail("requiresCredential with no credentialRef should fail");
  }

  // Valid configuration succeeds and is validated before mutation.
  const created = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-validation"),
    metadata,
    auditFn,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }

  // Illegal lifecycle transition (PROPOSED -> READY) is rejected before mutation.
  const invalidTransition = capability.transitionProviderLifecycle(
    created,
    "provider-validation",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(invalidTransition)) {
    assert.strictEqual(invalidTransition.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  } else {
    assert.fail("invalid lifecycle transition should be rejected");
  }

  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-validation",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }

  // Health is probed before READY is allowed; a failed probe fails closed.
  const healthFail = capability.transitionProviderLifecycle(
    configured,
    "provider-validation",
    "READY" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    false,
  );
  if (isErrorResult(healthFail)) {
    assert.strictEqual(healthFail.kind, "HEALTH_PROBE_FAILED");
  } else {
    assert.fail("health probe failure should be enforced before READY");
  }

  const afterFailedProbe = capability.getProviderConfig(configured, "provider-validation");
  assert.ok(afterFailedProbe !== null);
  assert.strictEqual(
    afterFailedProbe.lifecycleState,
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
  );

  // Transitioning a missing provider is rejected.
  const missingProviderTransition = capability.transitionProviderLifecycle(
    configured,
    "missing-provider",
    "CONFIGURED" satisfies capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(missingProviderTransition)) {
    assert.strictEqual(missingProviderTransition.kind, "INVALID_CONFIGURATION");
  } else {
    assert.fail("missing provider should fail before mutation");
  }

  const missingProviderDelete = capability.deleteProviderConfig(
    configured,
    "missing-provider",
    metadata,
    auditFn,
  );
  if (isErrorResult(missingProviderDelete)) {
    assert.strictEqual(missingProviderDelete.kind, "INVALID_CONFIGURATION");
  } else {
    assert.fail("delete of missing provider should fail");
  }
});