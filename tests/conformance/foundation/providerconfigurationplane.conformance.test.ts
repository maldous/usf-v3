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
});

test("providerconfigurationplaneerrormodel", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;

  const invalidConfig = {
    providerKey: "",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: false,
  };
  const createResult = capability.createProviderConfig(
    capability.initialState,
    invalidConfig,
    auditMetadata,
    auditFn,
  );
  assert.ok("kind" in createResult);
  const error = createResult as capability.ProviderConfigurationPlaneError;
  assert.strictEqual(error.kind, "INVALID_CONFIGURATION");

  const stateWithConfig: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [
      {
        providerKey: "test-provider",
        capability: "test-capability",
        environment: "test-env",
        instanceLabel: "test-instance",
        classification: "test-class",
        lifecycleState: "CONFIGURED",
        endpoint: null,
        config: {},
        credentialRef: null,
        requiresCredential: false,
        auditMetadata: null,
      },
    ],
    lastError: null,
  };
  const transitionResult = capability.transitionProviderLifecycle(
    stateWithConfig,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    false,
  );
  assert.ok("kind" in transitionResult);
  const transitionError = transitionResult as capability.ProviderConfigurationPlaneError;
  assert.strictEqual(transitionError.kind, "HEALTH_PROBE_FAILED");
});

test("providerconfigurationplanelifecycle", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;

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
  assert.strictEqual(state1.providerConfigs[0].lifecycleState, "PROPOSED");

  const transitionResult1 = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "CONFIGURED",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(!("kind" in transitionResult1));
  const state2 = transitionResult1 as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state2.providerConfigs[0].lifecycleState, "CONFIGURED");

  const transitionResult2 = capability.transitionProviderLifecycle(
    state2,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(!("kind" in transitionResult2));
  const state3 = transitionResult2 as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state3.providerConfigs[0].lifecycleState, "READY");

  const illegalTransitionResult = capability.transitionProviderLifecycle(
    state3,
    "test-provider",
    "PROPOSED",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok("kind" in illegalTransitionResult);
  const illegalError = illegalTransitionResult as capability.ProviderConfigurationPlaneError;
  assert.strictEqual(illegalError.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
});

test("providerconfigurationplanepermissions", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;

  const configWithCredential: Omit<capability.ProviderConfigurationPlaneProviderConfig, "lifecycleState" | "auditMetadata"> = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: true,
  };

  const createResult = capability.createProviderConfig(
    capability.initialState,
    configWithCredential,
    auditMetadata,
    auditFn,
  );
  assert.ok("kind" in createResult);
  const error = createResult as capability.ProviderConfigurationPlaneError;
  assert.strictEqual(error.kind, "MISSING_CREDENTIAL_REFERENCE");

  const configWithoutCredential: Omit<capability.ProviderConfigurationPlaneProviderConfig, "lifecycleState" | "auditMetadata"> = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: "secret-ref",
    requiresCredential: true,
  };

  const validCreateResult = capability.createProviderConfig(
    capability.initialState,
    configWithoutCredential,
    auditMetadata,
    auditFn,
  );
  assert.ok(!("kind" in validCreateResult));
  const state = validCreateResult as capability.ProviderConfigurationPlaneState;
  const fetched = capability.getProviderConfig(state, "test-provider");
  assert.strictEqual(fetched?.credentialRef, "secret-ref");
  assert.strictEqual(fetched?.requiresCredential, true);
});

test("providerconfigurationplaneproof", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;

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
  assert.strictEqual(state1.providerConfigs.length, 1);

  const transitionResult = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(!("kind" in transitionResult));
  const state2 = transitionResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state2.providerConfigs[0].lifecycleState, "READY");

  const readiness = capability.getProviderReadiness(state2, "test-provider");
  assert.strictEqual(readiness, "READY");
});

test("providerconfigurationplanereadinessmodel", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;

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

  const transitionResult1 = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "CONFIGURED",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(!("kind" in transitionResult1));
  const state2 = transitionResult1 as capability.ProviderConfigurationPlaneState;

  const transitionResult2 = capability.transitionProviderLifecycle(
    state2,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(!("kind" in transitionResult2));
  const state3 = transitionResult2 as capability.ProviderConfigurationPlaneState;
  const readiness1 = capability.getProviderReadiness(state3, "test-provider");
  assert.strictEqual(readiness1, "READY");

  const transitionResult3 = capability.transitionProviderLifecycle(
    state3,
    "test-provider",
    "DEGRADED",
    auditMetadata,
    auditFn,
    false,
  );
  assert.ok(!("kind" in transitionResult3));
  const state4 = transitionResult3 as capability.ProviderConfigurationPlaneState;
  const readiness2 = capability.getProviderReadiness(state4, "test-provider");
  assert.strictEqual(readiness2, "DEGRADED");

  const nonReadyState: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [
      {
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
      },
    ],
    lastError: null,
  };
  const readiness3 = capability.getProviderReadiness(nonReadyState, "test-provider");
  assert.strictEqual(readiness3, null);
});

test("providerconfigurationplanestatemodel", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };

  const config: capability.ProviderConfigurationPlaneProviderConfig = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    lifecycleState: "READY",
    endpoint: "https://example.com",
    config: { key: "value" },
    credentialRef: "secret-ref",
    requiresCredential: true,
    auditMetadata,
  };

  assert.strictEqual(config.providerKey, "test-provider");
  assert.strictEqual(config.capability, "test-capability");
  assert.strictEqual(config.environment, "test-env");
  assert.strictEqual(config.instanceLabel, "test-instance");
  assert.strictEqual(config.classification, "test-class");
  assert.strictEqual(config.lifecycleState, "READY");
  assert.strictEqual(config.endpoint, "https://example.com");
  assert.deepStrictEqual(config.config, { key: "value" });
  assert.strictEqual(config.credentialRef, "secret-ref");
  assert.strictEqual(config.requiresCredential, true);
  assert.deepStrictEqual(config.auditMetadata, auditMetadata);

  const state: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [config],
    lastError: null,
  };
  assert.deepStrictEqual(state.providerConfigs, [config]);
  assert.strictEqual(state.lastError, null);
});

test("providerconfigurationplanevalidation", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;

  const invalidConfig1 = {
    providerKey: "",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: false,
  };
  const validationResult1 = capability.validateProviderConfig({
    ...invalidConfig1,
    lifecycleState: "PROPOSED",
    auditMetadata: null,
  });
  assert.ok(validationResult1 !== null);
  assert.strictEqual(validationResult1!.kind, "INVALID_CONFIGURATION");

  const invalidConfig2 = {
    providerKey: "test-provider",
    capability: "",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: false,
  };
  const validationResult2 = capability.validateProviderConfig({
    ...invalidConfig2,
    lifecycleState: "PROPOSED",
    auditMetadata: null,
  });
  assert.ok(validationResult2 !== null);
  assert.strictEqual(validationResult2!.kind, "INVALID_CONFIGURATION");

  const invalidConfig3 = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: true,
  };
  const validationResult3 = capability.validateProviderConfig({
    ...invalidConfig3,
    lifecycleState: "PROPOSED",
    auditMetadata: null,
  });
  assert.ok(validationResult3 !== null);
  assert.strictEqual(validationResult3!.kind, "MISSING_CREDENTIAL_REFERENCE");

  const validConfig = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: "secret-ref",
    requiresCredential: true,
    lifecycleState: "PROPOSED",
    auditMetadata: null,
  };
  const validationResult4 = capability.validateProviderConfig(validConfig);
  assert.strictEqual(validationResult4, null);

  const illegalTransition = capability.validateLifecycleTransition(
    "READY" as const,
    "PROPOSED" as const,
  );
  assert.ok(illegalTransition !== null);
  assert.strictEqual(illegalTransition!.kind, "ILLEGAL_LIFECYCLE_TRANSITION");

  const legalTransition = capability.validateLifecycleTransition(
    "PROPOSED" as const,
    "CONFIGURED" as const,
  );
  assert.strictEqual(legalTransition, null);
});