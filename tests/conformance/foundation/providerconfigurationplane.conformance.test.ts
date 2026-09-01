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
  assert.ok(!("kind" in createResult));
  const state1 = createResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state1.lastError, null);
  assert.strictEqual(state1.providerConfigs.length, 1);
  assert.deepStrictEqual(state1.providerConfigs[0].auditMetadata, auditMetadata);

  assert.ok(capturedEvent !== null);
  assert.strictEqual(capturedEvent!.kind, "AUDIT_BEFORE_MUTATION");
  assert.strictEqual(capturedEvent!.providerKey, "test-provider");
  assert.strictEqual(capturedEvent!.previousState, null);
  assert.strictEqual(capturedEvent!.newState, "PROPOSED");
  assert.deepStrictEqual(capturedEvent!.metadata, auditMetadata);

  capturedEvent = null;
  const transitionResult = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "DEGRADED",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(!("kind" in transitionResult));
  const state2 = transitionResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state2.lastError, null);
  assert.strictEqual(state2.providerConfigs[0].lifecycleState, "DEGRADED");
  assert.deepStrictEqual(state2.providerConfigs[0].auditMetadata, auditMetadata);

  assert.ok(capturedEvent !== null);
  assert.strictEqual(capturedEvent!.kind, "AUDIT_BEFORE_MUTATION");
  assert.strictEqual(capturedEvent!.providerKey, "test-provider");
  assert.strictEqual(capturedEvent!.previousState, "PROPOSED");
  assert.strictEqual(capturedEvent!.newState, "DEGRADED");
  assert.deepStrictEqual(capturedEvent!.metadata, auditMetadata);

  const readiness = capability.getProviderReadiness(state2, "test-provider");
  assert.strictEqual(readiness, "DEGRADED");
});

test("providerconfigurationplanecontracts", () => {
  const config: capability.ProviderConfigurationPlaneProviderConfig = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    lifecycleState: "PROPOSED",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: false,
    auditMetadata: null,
  };
  const state: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [config],
    lastError: null,
  };

  const fetched = capability.getProviderConfig(state, "test-provider");
  assert.deepStrictEqual(fetched, config);

  const all = capability.getAllProviderConfigs(state);
  assert.strictEqual(all.length, 1);
  assert.deepStrictEqual(all[0], config);

  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "delete",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;
  const deleteResult = capability.deleteProviderConfig(state, "test-provider", auditMetadata, auditFn);
  assert.ok(!("kind" in deleteResult));
  const stateAfterDelete = deleteResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(stateAfterDelete.providerConfigs.length, 0);
  assert.strictEqual(capability.getProviderConfig(stateAfterDelete, "test-provider"), null);

  const invalidConfig = { ...config, providerKey: "", lifecycleState: "PROPOSED" as const, auditMetadata: null };