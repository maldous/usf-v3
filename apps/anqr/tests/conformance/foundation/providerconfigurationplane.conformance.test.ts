import { assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/providerconfigurationplane.ts";

test("providerconfigurationplaneauditmodel", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (event: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => {
    assert.strictEqual(event.kind, "AUDIT_BEFORE_MUTATION");
    assert.strictEqual(event.providerKey, "test-provider");
    assert.strictEqual(event.previousState, null);
    assert.strictEqual(event.newState, "PROPOSED");
    assert.deepStrictEqual(event.metadata, auditMetadata);
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

  const result = capability.createProviderConfig(
    capability.initialState,
    config,
    auditMetadata,
    auditFn,
  );
  assert.deepStrictEqual(result.lastError, null);
  assert.strictEqual(result.providerConfigs.length, 1);
  assert.strictEqual(result.providerConfigs[0].auditMetadata, auditMetadata);
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

  const invalidConfig = { ...config, providerKey: "" };
  const validationError = capability.validateProviderConfig(invalidConfig);
  assert.notStrictEqual(validationError, null);
  assert.strictEqual(validationError?.kind, "INVALID_CONFIGURATION");
});

test("providerconfigurationplaneerrormodel", () => {
  const state: capability.ProviderConfigurationPlaneState = {
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

  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "test",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;

  const result = capability.transitionProviderLifecycle(
    state,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    false,
  );
  assert.notStrictEqual(result, null);
  if (result && typeof result === "object" && "kind" in result) {
    assert.strictEqual(result.kind, "HEALTH_PROBE_FAILED");
  }

  const degradedState: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [
      {
        providerKey: "test-provider",
        capability: "test-capability",
        environment: "test-env",
        instanceLabel: "test-instance",
        classification: "test-class",
        lifecycleState: "DEGRADED",
        endpoint: null,
        config: {},
        credentialRef: null,
        requiresCredential: false,
        auditMetadata: null,
      },
    ],
    lastError: null,
  };
  const readiness = capability.getProviderReadiness(degradedState, "test-provider");
  assert.strictEqual(readiness, "DEGRADED");
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

  let state = capability.createProviderConfig(
    capability.initialState,
    config,
    auditMetadata,
    auditFn,
  );
  assert.deepStrictEqual(state.lastError, null);
  assert.strictEqual(state.providerConfigs[0].lifecycleState, "PROPOSED");

  state = capability.transitionProviderLifecycle(
    state as capability.ProviderConfigurationPlaneState,
    "test-provider",
    "CONFIGURED",
    auditMetadata,
    auditFn,
    true,
  );
  assert.deepStrictEqual((state as capability.ProviderConfigurationPlaneState).lastError, null);
  assert.strictEqual((state as capability.ProviderConfigurationPlaneState).providerConfigs[0].lifecycleState, "CONFIGURED");

  const invalidTransition = capability.transitionProviderLifecycle(
    state as capability.ProviderConfigurationPlaneState,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    false,
  );
  assert.notStrictEqual(invalidTransition, null);
  if (invalidTransition && typeof invalidTransition === "object" && "kind" in invalidTransition) {
    assert.strictEqual(invalidTransition.kind, "HEALTH_PROBE_FAILED");
  }
});

test("providerconfigurationplanepermissions", () => {
  const config: Omit<capability.ProviderConfigurationPlaneProviderConfig, "lifecycleState" | "auditMetadata"> = {
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

  const validationError = capability.validateProviderConfig({
    ...config,
    lifecycleState: "PROPOSED",
    auditMetadata: null,
  });
  assert.notStrictEqual(validationError, null);
  assert.strictEqual(validationError?.kind, "MISSING_CREDENTIAL_REFERENCE");
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

  const state = capability.createProviderConfig(
    capability.initialState,
    config,
    auditMetadata,
    auditFn,
  );
  assert.deepStrictEqual(state.lastError, null);
  assert.strictEqual(state.providerConfigs.length, 1);

  const readiness = capability.getProviderReadiness(
    state as capability.ProviderConfigurationPlaneState,
    "test-provider",
  );
  assert.strictEqual(readiness, null);
});

test("providerconfigurationplanereadinessmodel", () => {
  const state: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [
      {
        providerKey: "test-provider",
        capability: "test-capability",
        environment: "test-env",
        instanceLabel: "test-instance",
        classification: "test-class",
        lifecycleState: "READY",
        endpoint: null,
        config: {},
        credentialRef: null,
        requiresCredential: false,
        auditMetadata: null,
      },
    ],
    lastError: null,
  };

  const readiness = capability.getProviderReadiness(state, "test-provider");
  assert.strictEqual(readiness, "READY");

  const degradedState: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [
      {
        ...state.providerConfigs[0],
        lifecycleState: "DEGRADED",
      },
    ],
    lastError: null,
  };
  const degradedReadiness = capability.getProviderReadiness(degradedState, "test-provider");
  assert.strictEqual(degradedReadiness, "DEGRADED");
});

test("providerconfigurationplanestatemodel", () => {
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

  assert.strictEqual(config.providerKey, "test-provider");
  assert.strictEqual(config.capability, "test-capability");
  assert.strictEqual(config.environment, "test-env");
  assert.strictEqual(config.instanceLabel, "test-instance");
  assert.strictEqual(config.classification, "test-class");
  assert.strictEqual(config.lifecycleState, "PROPOSED");
  assert.strictEqual(config.endpoint, null);
  assert.deepStrictEqual(config.config, {});
  assert.strictEqual(config.credentialRef, null);
  assert.strictEqual(config.requiresCredential, false);
  assert.strictEqual(config.auditMetadata, null);

  const state: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [config],
    lastError: null,
  };
  assert.deepStrictEqual(state.providerConfigs, [config]);
  assert.strictEqual(state.lastError, null);
});

test("providerconfigurationplanevalidation", () => {
  const validConfig: capability.ProviderConfigurationPlaneProviderConfig = {
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
  const validationError = capability.validateProviderConfig(validConfig);
  assert.strictEqual(validationError, null);

  const invalidConfig = { ...validConfig, providerKey: "" };
  const invalidError = capability.validateProviderConfig(invalidConfig);
  assert.notStrictEqual(invalidError, null);
  assert.strictEqual(invalidError?.kind, "INVALID_CONFIGURATION");

  const illegalTransition = capability.validateLifecycleTransition(
    "PROPOSED" as const,
    "READY" as const,
  );
  assert.notStrictEqual(illegalTransition, null);
  assert.strictEqual(illegalTransition?.kind, "ILLEGAL_LIFECYCLE_TRANSITION");

  const requiresCredentialConfig: capability.ProviderConfigurationPlaneProviderConfig = {
    ...validConfig,
    requiresCredential: true,
    credentialRef: null,
  };
  const credentialError = capability.validateProviderConfig(requiresCredentialConfig);
  assert.notStrictEqual(credentialError, null);
  assert.strictEqual(credentialError?.kind, "MISSING_CREDENTIAL_REFERENCE");
});