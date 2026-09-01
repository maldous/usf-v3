import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/providerconfigurationplane.ts";

function isErrorResult(
  result: capability.ProviderConfigurationPlaneState | capability.ProviderConfigurationPlaneError,
): result is capability.ProviderConfigurationPlaneError {
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

  const auditFn = (event: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => {
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
  assert.strictEqual(createEvent.newState, "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(createEvent.metadata.changedBy, "audit-admin");
  assert.strictEqual(createEvent.metadata.timestamp, "2026-09-02T00:00:00Z");

  const created = createResult.providerConfigs[0];
  assert.ok(created !== undefined);
  assert.deepStrictEqual(created.auditMetadata, auditMetadata);

  const transitionResult = capability.transitionProviderLifecycle(
    createResult,
    "provider-auditmodel",
    "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );

  if (isErrorResult(transitionResult)) {
    assert.fail(transitionResult.kind);
  }

  assert.strictEqual(auditEvents.length, 2);
  const transitionEvent = auditEvents[1];
  assert.ok(transitionEvent !== undefined);
  assert.strictEqual(transitionEvent.providerKey, "provider-auditmodel");
  assert.strictEqual(transitionEvent.previousState, "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(transitionEvent.newState, "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.deepStrictEqual(transitionEvent.metadata, auditMetadata);

  const transitioned = transitionResult.providerConfigs[0];
  assert.ok(transitioned !== undefined);
  assert.strictEqual(transitioned.lifecycleState, "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState);

  const readiness = capability.getProviderReadiness(transitionResult, "provider-auditmodel");
  assert.strictEqual(readiness, "DEGRADED" as capability.ProviderConfigurationPlaneReadinessSignal);
});

test("providerconfigurationplanecontracts", () => {
  const auditMetadata = makeAuditMetadata("contract-admin");
  const auditFn = () => null;

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

  const readConfig = capability.getProviderConfig(created, "provider-contracts");
  assert.ok(readConfig !== null);
  assert.strictEqual(readConfig.providerKey, "provider-contracts");

  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-contracts",
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }

  const ready = capability.transitionProviderLifecycle(
    configured,
    "provider-contracts",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(ready)) {
    assert.fail(ready.kind);
  }

  const deleted = capability.deleteProviderConfig(
    ready,
    "provider-contracts",
    auditMetadata,
    auditFn,
  );
  if (isErrorResult(deleted)) {
    assert.fail(deleted.kind);
  }

  const missingAfterDelete = capability.getProviderConfig(deleted, "provider-contracts");
  assert.strictEqual(missingAfterDelete, null);

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

  const baseConfigCount = capability.getAllProviderConfigs(capability.initialState);
  assert.strictEqual(baseConfigCount.length, 0);
});

test("providerconfigurationplaneerrormodel", () => {
  const auditMetadata = makeAuditMetadata("error-admin");
  const auditEvents: capability.ProviderConfigurationPlaneAuditEvent[] = [];

  const auditFn = (event: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => {
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
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }

  const preErrorAuditCount = auditEvents.length;
  const failedReady = capability.transitionProviderLifecycle(
    configured,
    "provider-errormodel",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
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

  assert.strictEqual(auditEvents.length, preErrorAuditCount);

  const stillConfigured = capability.getProviderConfig(configured, "provider-errormodel");
  assert.ok(stillConfigured !== null);
  assert.strictEqual(stillConfigured.lifecycleState, "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState);

  const readySignal = capability.getProviderReadiness(configured, "provider-errormodel");
  assert.strictEqual(readySignal, null);
});

test("providerconfigurationplanelifecycle", () => {
  const auditMetadata = makeAuditMetadata("lifecycle-admin");
  const auditFn = () => null;

  const created = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-lifecycle"),
    auditMetadata,
    auditFn,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }

  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-lifecycle",
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }
  const configuredRecord = capability.getProviderConfig(configured, "provider-lifecycle");
  assert.ok(configuredRecord !== null);
  assert.strictEqual(configuredRecord.lifecycleState, "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState);

  const ready = capability.transitionProviderLifecycle(
    configured,
    "provider-lifecycle",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(ready)) {
    assert.fail(ready.kind);
  }
  const readyRecord = capability.getProviderConfig(ready, "provider-lifecycle");
  assert.ok(readyRecord !== null);
  assert.strictEqual(readyRecord.lifecycleState, "READY" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(capability.getProviderReadiness(ready, "provider-lifecycle"), "READY");

  const degraded = capability.transitionProviderLifecycle(
    ready,
    "provider-lifecycle",
    "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(degraded)) {
    assert.fail(degraded.kind);
  }
  const degradedRecord = capability.getProviderConfig(degraded, "provider-lifecycle");
  assert.ok(degradedRecord !== null);
  assert.strictEqual(degradedRecord.lifecycleState, "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(capability.getProviderReadiness(degraded, "provider-lifecycle"), "DEGRADED");

  const disabled = capability.transitionProviderLifecycle(
    degraded,
    "provider-lifecycle",
    "DISABLED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(disabled)) {
    assert.fail(disabled.kind);
  }
  const disabledRecord = capability.getProviderConfig(disabled, "provider-lifecycle");
  assert.ok(disabledRecord !== null);
  assert.strictEqual(disabledRecord.lifecycleState, "DISABLED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(capability.getProviderReadiness(disabled, "provider-lifecycle"), null);

  const reopened = capability.transitionProviderLifecycle(
    disabled,
    "provider-lifecycle",
    "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  if (isErrorResult(reopened)) {
    assert.fail(reopened.kind);
  }
  const reopenedRecord = capability.getProviderConfig(reopened, "provider-lifecycle");
  assert.ok(reopenedRecord !== null);
  assert.strictEqual(reopenedRecord.lifecycleState, "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState);
});

test("providerconfigurationplanepermissions", () => {
  const baseMetadata = makeAuditMetadata("permission-admin");

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

  const blockedAudit: capability.ProviderConfigurationPlaneAuditEvent[] = [];
  const auditBlockedError = capability.transitionProviderLifecycle(
    created,
    "provider-permissions",
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
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
  assert.strictEqual(unchanged.lifecycleState, "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(blockedAudit.length, 1);
});

test("providerconfigurationplaneproof", () => {
  const proofMetadata = makeAuditMetadata("proof-admin");

  const validated = capability.validateProviderConfig({
    ...makeProviderConfig("provider-proof"),
    lifecycleState: "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.strictEqual(validated, null);

  const transitionProofA = capability.validateLifecycleTransition(
    "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
  );
  const transitionProofB = capability.validateLifecycleTransition(
    "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
  );
  assert.deepStrictEqual(transitionProofA, transitionProofB);

  const transitionProofBad = capability.validateLifecycleTransition(
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
  );
  if (transitionProofBad !== null) {
    assert.strictEqual(transitionProofBad.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  } else {
    assert.fail("invalid lifecycle transition should fail");
  }

  const auditEvents: capability.ProviderConfigurationPlaneAuditEvent[] = [];
  const auditResult = capability.auditProviderConfigMutation(
    "provider-proof",
    "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    proofMetadata,
    (event) => {
      auditEvents.push(event);
      return null;
    },
  );
  assert.strictEqual(auditResult, null);
  assert.strictEqual(auditEvents.length, 1);

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
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    proofMetadata,
    () => null,
    true,
  );
  if (isErrorResult(proofTransition)) {
    assert.fail(proofTransition.kind);
  }

  const readiness = capability.getProviderReadiness(proofTransition, "provider-proof");
  assert.strictEqual(readiness, null);
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

  assert.strictEqual(capability.getProviderReadiness(created, "provider-readiness"), null);

  const illegalReady = capability.transitionProviderLifecycle(
    created,
    "provider-readiness",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(illegalReady)) {
    assert.strictEqual(illegalReady.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  } else {
    assert.fail("provider should not become READY from PROPOSED");
  }

  const configured = capability.transitionProviderLifecycle(
    created,
    "provider-readiness",
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }
  assert.strictEqual(capability.getProviderReadiness(configured, "provider-readiness"), null);

  const failedReady = capability.transitionProviderLifecycle(
    configured,
    "provider-readiness",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    false,
  );
  if (isErrorResult(failedReady)) {
    assert.strictEqual(failedReady.kind, "HEALTH_PROBE_FAILED");
  } else {
    assert.fail("health probe must block READY transition when false");
  }

  const ready = capability.transitionProviderLifecycle(
    configured,
    "provider-readiness",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(ready)) {
    assert.fail(ready.kind);
  }
  assert.strictEqual(capability.getProviderReadiness(ready, "provider-readiness"), "READY");

  const degraded = capability.transitionProviderLifecycle(
    ready,
    "provider-readiness",
    "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(degraded)) {
    assert.fail(degraded.kind);
  }
  assert.strictEqual(capability.getProviderReadiness(degraded, "provider-readiness"), "DEGRADED");

  const disabled = capability.transitionProviderLifecycle(
    degraded,
    "provider-readiness",
    "DISABLED" as capability.ProviderConfigurationPlaneLifecycleState,
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
  assert.strictEqual(stored.lifecycleState, "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(stored.endpoint, providerConfig.endpoint);
  assert.deepStrictEqual(stored.config, providerConfig.config);
  assert.strictEqual(stored.credentialRef, providerConfig.credentialRef);
  assert.strictEqual(stored.requiresCredential, providerConfig.requiresCredential);
  assert.deepStrictEqual(stored.auditMetadata, metadata);

  const all = capability.getAllProviderConfigs(state);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(capability.getProviderConfig(state, "provider-state")?.providerKey, "provider-state");
  assert.strictEqual(state.lastError, null);
});

test("providerconfigurationplanevalidation", () => {
  const metadata = makeAuditMetadata("validation-admin");
  const auditFn = () => null;

  const directValidation = capability.validateProviderConfig({
    ...makeProviderConfig("provider-validation"),
    providerKey: "",
    lifecycleState: "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.ok(directValidation !== null);
  assert.strictEqual(directValidation.kind, "INVALID_CONFIGURATION");

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

  const created = capability.createProviderConfig(
    capability.initialState,
    makeProviderConfig("provider-validation"),
    metadata,
    auditFn,
  );
  if (isErrorResult(created)) {
    assert.fail(created.kind);
  }

  const invalidTransition = capability.transitionProviderLifecycle(
    created,
    "provider-validation",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
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
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(configured)) {
    assert.fail(configured.kind);
  }

  const healthFail = capability.transitionProviderLifecycle(
    configured,
    "provider-validation",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    false,
  );
  if (isErrorResult(healthFail)) {
    assert.strictEqual(healthFail.kind, "HEALTH_PROBE_FAILED");
  } else {
    assert.fail("health probe failure should be enforced before READY");
  }

  const missingProviderTransition = capability.transitionProviderLifecycle(
    configured,
    "missing-provider",
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
    metadata,
    auditFn,
    true,
  );
  if (isErrorResult(missingProviderTransition)) {
    assert.strictEqual(missingProviderTransition.kind, "INVALID_CONFIGURATION");
  } else {
    assert.fail("missing provider should fail before mutation");
  }
});