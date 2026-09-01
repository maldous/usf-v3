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
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("createProviderConfig returned an error: " + (createResult as capability.ProviderConfigurationPlaneError).kind);
  }
  const state1 = createResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state1.lastError, null);
  assert.strictEqual(state1.providerConfigs.length, 1);
  assert.deepStrictEqual(state1.providerConfigs[0]?.auditMetadata, auditMetadata);

  if (capturedEvent === null) {
    assert.fail("auditFn was not called on create");
  }
  assert.strictEqual(capturedEvent.kind, "AUDIT_BEFORE_MUTATION");
  assert.strictEqual(capturedEvent.providerKey, "test-provider");
  assert.strictEqual(capturedEvent.previousState, null);
  assert.strictEqual(capturedEvent.newState, "PROPOSED");
  assert.deepStrictEqual(capturedEvent.metadata, auditMetadata);

  capturedEvent = null;
  const transitionResult = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "DEGRADED",
    auditMetadata,
    auditFn,
    true,
  );
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("transitionProviderLifecycle returned an error: " + (transitionResult as capability.ProviderConfigurationPlaneError).kind);
  }
  const state2 = transitionResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state2.lastError, null);
  assert.strictEqual(state2.providerConfigs[0]?.lifecycleState, "DEGRADED");
  assert.deepStrictEqual(state2.providerConfigs[0]?.auditMetadata, auditMetadata);

  if (capturedEvent === null) {
    assert.fail("auditFn was not called on transition");
  }
  assert.strictEqual(capturedEvent.kind, "AUDIT_BEFORE_MUTATION");
  assert.strictEqual(capturedEvent.providerKey, "test-provider");
  assert.strictEqual(capturedEvent.previousState, "PROPOSED");
  assert.strictEqual(capturedEvent.newState, "DEGRADED");
  assert.deepStrictEqual(capturedEvent.metadata, auditMetadata);

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
  assert.ok(fetched !== null);
  assert.deepStrictEqual(fetched, config);

  const all = capability.getAllProviderConfigs(state);
  assert.strictEqual(all.length, 1);
  assert.deepStrictEqual(all[0], config);

  const missing = capability.getProviderConfig(state, "does-not-exist");
  assert.strictEqual(missing, null);

  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: "delete",
  };
  const auditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => null;
  const deleteResult = capability.deleteProviderConfig(state, "test-provider", auditMetadata, auditFn);
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (deleteResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("deleteProviderConfig returned an error: " + (deleteResult as capability.ProviderConfigurationPlaneError).kind);
  }
  const stateAfterDelete = deleteResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(stateAfterDelete.providerConfigs.length, 0);
  assert.strictEqual(capability.getProviderConfig(stateAfterDelete, "test-provider"), null);

  const stateWithNoConfig: capability.ProviderConfigurationPlaneState = {
    providerConfigs: [],
    lastError: null,
  };
  const missingDeleteResult = capability.deleteProviderConfig(
    stateWithNoConfig,
    "does-not-exist",
    auditMetadata,
    auditFn,
  );
  assert.ok(capability.ProviderConfigurationPlaneErrorKind.some((kind) => (missingDeleteResult as capability.ProviderConfigurationPlaneError).kind === kind));
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (missingDeleteResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.strictEqual((missingDeleteResult as capability.ProviderConfigurationPlaneError).kind, "INVALID_CONFIGURATION");
  }
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
  assert.ok(capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind));
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.strictEqual((createResult as capability.ProviderConfigurationPlaneError).kind, "INVALID_CONFIGURATION");
  }

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
  assert.ok(capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult as capability.ProviderConfigurationPlaneError).kind === kind));
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.strictEqual((transitionResult as capability.ProviderConfigurationPlaneError).kind, "HEALTH_PROBE_FAILED");
  }

  const degradedReadiness = capability.getProviderReadiness(
    {
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
    },
    "test-provider",
  );
  assert.strictEqual(degradedReadiness, "DEGRADED");
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
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("createProviderConfig returned an error: " + (createResult as capability.ProviderConfigurationPlaneError).kind);
  }
  const state1 = createResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state1.providerConfigs[0]?.lifecycleState, "PROPOSED");

  const transitionResult1 = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "CONFIGURED",
    auditMetadata,
    auditFn,
    true,
  );
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult1 as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("transitionProviderLifecycle to CONFIGURED returned an error: " + (transitionResult1 as capability.ProviderConfigurationPlaneError).kind);
  }
  const state2 = transitionResult1 as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state2.providerConfigs[0]?.lifecycleState, "CONFIGURED");

  const transitionResult2 = capability.transitionProviderLifecycle(
    state2,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    true,
  );
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult2 as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("transitionProviderLifecycle to READY returned an error: " + (transitionResult2 as capability.ProviderConfigurationPlaneError).kind);
  }
  const state3 = transitionResult2 as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state3.providerConfigs[0]?.lifecycleState, "READY");

  const illegalTransitionResult = capability.transitionProviderLifecycle(
    state3,
    "test-provider",
    "PROPOSED",
    auditMetadata,
    auditFn,
    true,
  );
  assert.ok(capability.ProviderConfigurationPlaneErrorKind.some((kind) => (illegalTransitionResult as capability.ProviderConfigurationPlaneError).kind === kind));
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (illegalTransitionResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.strictEqual((illegalTransitionResult as capability.ProviderConfigurationPlaneError).kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  }

  for (const state of capability.ProviderConfigurationPlaneLifecycleState) {
    assert.ok(typeof state === "string");
  }
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
  assert.ok(capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind));
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.strictEqual((createResult as capability.ProviderConfigurationPlaneError).kind, "MISSING_CREDENTIAL_REFERENCE");
  }

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
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (validCreateResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("createProviderConfig returned an error: " + (validCreateResult as capability.ProviderConfigurationPlaneError).kind);
  }
  const state = validCreateResult as capability.ProviderConfigurationPlaneState;
  const fetched = capability.getProviderConfig(state, "test-provider");
  assert.ok(fetched !== null);
  assert.strictEqual(fetched.credentialRef, "secret-ref");
  assert.strictEqual(fetched.requiresCredential, true);

  let auditCalled = false;
  let failingAuditFn = (_: capability.ProviderConfigurationPlaneAuditEvent): capability.ProviderConfigurationPlaneError | null => {
    auditCalled = true;
    return {
      kind: "AUDIT_FAILURE",
      message: "audit failed",
      providerKey: "test-provider",
    };
  };
  const configForAuditFailure: Omit<capability.ProviderConfigurationPlaneProviderConfig, "lifecycleState" | "auditMetadata"> = {
    providerKey: "another-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    endpoint: null,
    config: {},
    credentialRef: null,
    requiresCredential: false,
  };
  const auditFailureResult = capability.createProviderConfig(
    capability.initialState,
    configForAuditFailure,
    auditMetadata,
    failingAuditFn,
  );
  assert.ok(capability.ProviderConfigurationPlaneErrorKind.some((kind) => (auditFailureResult as capability.ProviderConfigurationPlaneError).kind === kind));
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (auditFailureResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.strictEqual((auditFailureResult as capability.ProviderConfigurationPlaneError).kind, "AUDIT_FAILURE");
  }
  assert.strictEqual(auditCalled, true);
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
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("createProviderConfig returned an error: " + (createResult as capability.ProviderConfigurationPlaneError).kind);
  }
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
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("transitionProviderLifecycle returned an error: " + (transitionResult as capability.ProviderConfigurationPlaneError).kind);
  }
  const state2 = transitionResult as capability.ProviderConfigurationPlaneState;
  assert.strictEqual(state2.providerConfigs[0]?.lifecycleState, "READY");

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
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (createResult as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("createProviderConfig returned an error: " + (createResult as capability.ProviderConfigurationPlaneError).kind);
  }
  const state1 = createResult as capability.ProviderConfigurationPlaneState;

  const transitionResult1 = capability.transitionProviderLifecycle(
    state1,
    "test-provider",
    "CONFIGURED",
    auditMetadata,
    auditFn,
    true,
  );
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult1 as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("transitionProviderLifecycle to CONFIGURED returned an error: " + (transitionResult1 as capability.ProviderConfigurationPlaneError).kind);
  }
  const state2 = transitionResult1 as capability.ProviderConfigurationPlaneState;

  const transitionResult2 = capability.transitionProviderLifecycle(
    state2,
    "test-provider",
    "READY",
    auditMetadata,
    auditFn,
    true,
  );
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult2 as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("transitionProviderLifecycle to READY returned an error: " + (transitionResult2 as capability.ProviderConfigurationPlaneError).kind);
  }
  const state3 = transitionResult2 as capability.ProviderConfigurationPlaneState;
  const readiness1 = capability.getProviderReadiness(state3, "test-provider");
  assert.strictEqual(readiness1, "READY");

  const transitionResult3 = capability.transitionProviderLifecycle(
    state3,
    "test-provider",
    "DEGRADED",
    auditMetadata,
    auditFn,
    true,
  );
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (transitionResult3 as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.fail("transitionProviderLifecycle to DEGRADED returned an error: " + (transitionResult3 as capability.ProviderConfigurationPlaneError).kind);
  }
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

  const readinessForUnknown = capability.getProviderReadiness(capability.initialState, "unknown");
  assert.strictEqual(readinessForUnknown, null);

  for (const signal of capability.ProviderConfigurationPlaneReadinessSignal) {
    assert.ok(signal === "READY" || signal === "DEGRADED");
  }
});

test("providerconfigurationplanestatemodel", () => {
  const auditMetadata: capability.ProviderConfigurationPlaneAuditMetadata = {
    changedBy: "admin",
    timestamp: "2024-01-01T00:00:00Z",
    justification: null,
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

  assert.strictEqual(capability.initialState.providerConfigs.length, 0);
  assert.strictEqual(capability.initialState.lastError, null);

  for (const stateValue of capability.ProviderConfigurationPlaneLifecycleState) {
    assert.ok(typeof stateValue === "string");
  }
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
    lifecycleState: "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.ok(validationResult1 !== null);
  if (validationResult1 !== null) {
    assert.strictEqual(validationResult1.kind, "INVALID_CONFIGURATION");
  }

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
    lifecycleState: "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.ok(validationResult2 !== null);
  if (validationResult2 !== null) {
    assert.strictEqual(validationResult2.kind, "INVALID_CONFIGURATION");
  }

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
    lifecycleState: "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata: null,
  });
  assert.ok(validationResult3 !== null);
  if (validationResult3 !== null) {
    assert.strictEqual(validationResult3.kind, "MISSING_CREDENTIAL_REFERENCE");
  }

  const validConfig: capability.ProviderConfigurationPlaneProviderConfig = {
    providerKey: "test-provider",
    capability: "test-capability",
    environment: "test-env",
    instanceLabel: "test-instance",
    classification: "test-class",
    lifecycleState: "PROPOSED",
    endpoint: null,
    config: {},
    credentialRef: "secret-ref",
    requiresCredential: true,
    auditMetadata: null,
  };
  const validationResult4 = capability.validateProviderConfig(validConfig);
  assert.strictEqual(validationResult4, null);

  const illegalTransition = capability.validateLifecycleTransition(
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState
  );
  assert.ok(illegalTransition !== null);
  if (illegalTransition !== null) {
    assert.strictEqual(illegalTransition.kind, "ILLEGAL_LIFECYCLE_TRANSITION");
  }

  const legalTransition = capability.validateLifecycleTransition(
    "PROPOSED" as capability.ProviderConfigurationPlaneLifecycleState,
    "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState
  );
  assert.strictEqual(legalTransition, null);

  const healthProbeBlocked = capability.transitionProviderLifecycle(
    {
      providerConfigs: [
        {
          providerKey: "test-provider",
          capability: "test-capability",
          environment: "test-env",
          instanceLabel: "test-instance",
          classification: "test-class",
          lifecycleState: "CONFIGURED" as capability.ProviderConfigurationPlaneLifecycleState,
          endpoint: null,
          config: {},
          credentialRef: null,
          requiresCredential: false,
          auditMetadata: null,
        },
      ],
      lastError: null,
    },
    "test-provider",
    "READY" as capability.ProviderConfigurationPlaneLifecycleState,
    auditMetadata,
    auditFn,
    false,
  );
  assert.ok(capability.ProviderConfigurationPlaneErrorKind.some((kind) => (healthProbeBlocked as capability.ProviderConfigurationPlaneError).kind === kind));
  if (capability.ProviderConfigurationPlaneErrorKind.some((kind) => (healthProbeBlocked as capability.ProviderConfigurationPlaneError).kind === kind)) {
    assert.strictEqual((healthProbeBlocked as capability.ProviderConfigurationPlaneError).kind, "HEALTH_PROBE_FAILED");
  }
});