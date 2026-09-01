import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/providerconfigurationplane.ts";

test("providerconfigurationplaneauditmodel", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };

  let capturedEvent: capability.ProviderConfigurationPlaneAuditEvent | null = null;
  const auditFn = (event: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => {
    capturedEvent = event;
    return null;
  };

  const config: Omit<capability.ProviderConfigurationPlaneProviderConfig, "lifecycleState" | "auditMetadata"> = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: false,
  };

  const createResult = capability.createProviderConfig(capability.initialState, config, auditMetadata, auditFn);
  assert.ok(!capability.ProviderConfigurationPlaneErrorKind.includes((createResult as capability.ProviderConfigurationPlaneError).kind as never));
  const state1 = createResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state1.lastError, null);
  assert.strictEqual(state1.providerConfigs.length, 1);
  assert.deepStrictEqual(state1.providerConfigs[0]?.auditMetadata, auditMetadata);

  assert.ok(capturedEvent !== null);
  assert.strictEqual(capturedEvent.kind, "AUDIT_BEFORE_MUTATION" as capability.ProviderConfigurationPlaneAuditEventKind);
  assert.strictEqual(capturedEvent.providerKey, "test-provider");
  assert.strictEqual(capturedEvent.previousState, null);
  assert.strictEqual(capturedEvent.newState, "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.deepStrictEqual(capturedEvent.metadata, auditMetadata);

  capturedEvent = null;
  const transitionResult = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(!capability.ProviderConfigurationPlaneErrorKind.includes((transitionResult as capability.ProviderConfigurationPlaneError).kind as never));
  const state2 = transitionResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state2.lastError, null);
  assert.strictEqual(state2.providerConfigs[0]?.lifecycleState, "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.deepStrictEqual(state2.providerConfigs[0]?.auditMetadata, auditMetadata);

  assert.ok(capturedEvent !== null);
  assert.strictEqual(capturedEvent.kind, "AUDIT_BEFORE_MUTATION" as capability.ProviderConfigurationPlaneAuditEventKind);
  assert.strictEqual(capturedEvent.providerKey, "test-provider");
  assert.strictEqual(capturedEvent.previousState, "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.strictEqual(capturedEvent.newState, "DEGRADED" as capability.ProviderConfigurationPlaneLifecycleState);
  assert.deepStrictEqual(capturedEvent.metadata, auditMetadata);

  const readiness = capability.getProviderReadiness(state2, "test-provider");
  assert.strictEqual(readiness, "DEGRADED" as capability.ProviderConfigurationPlaneReadinessSignal);
});