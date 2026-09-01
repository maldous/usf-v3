import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/composedproviderreadinessspine.ts";

test("composedproviderreadinessspineauditmodel", () => {
  const config: capability.ComposedProviderReadinessSpineConfiguration = {
    requiredProviders: ["providerA", "providerB"],
  };
  const providerStates: readonly capability.ComposedProviderReadinessSpineProviderReadiness[] = [
    { provider: "providerA", state: "READY" },
    { provider: "providerB", state: "DEGRADED" },
  ] as const;
  const result = capability.aggregateReadiness(config, providerStates);
  assert.deepEqual(result.state, "DEGRADED");
  assert.deepEqual(result.providers, providerStates);
  assert.deepEqual(result.error, null);
});

test("composedproviderreadinessspinecontracts", () => {
  const invalidConfig = { requiredProviders: [] };
  const result = capability.validateConfiguration(invalidConfig);
  assert.deepEqual(
    (result as capability.ComposedProviderReadinessSpineError).kind,
    "CONFIGURATION_INVALID"
  );
  assert.deepEqual(
    (result as capability.ComposedProviderReadinessSpineError).message,
    "At least one required provider must be specified"
  );
});

test("composedproviderreadinessspineerrormodel", () => {
  const config: capability.ComposedProviderReadinessSpineConfiguration = {
    requiredProviders: ["providerA"],
  };
  const providerStates: readonly capability.ComposedProviderReadinessSpineProviderReadiness[] = [] as const;
  const result = capability.aggregateReadiness(config, providerStates);
  assert.deepEqual(result.state, "UNAVAILABLE");
  assert.deepEqual(
    (result.error as capability.ComposedProviderReadinessSpineError).kind,
    "PROVIDER_UNAVAILABLE"
  );
});

test("composedproviderreadinessspinelifecycle", () => {
  const config: capability.ComposedProviderReadinessSpineConfiguration = {
    requiredProviders: ["providerA"],
  };
  const providerStates: readonly capability.ComposedProviderReadinessSpineProviderReadiness[] = [
    { provider: "providerA", state: "READY" },
  ] as const;
  const result = capability.aggregateReadiness(config, providerStates);
  assert.deepEqual(result.state, "READY");
  assert.deepEqual(result.providers, providerStates);
  assert.deepEqual(result.error, null);
});

test("composedproviderreadinessspinepermissions", () => {
  const config: capability.ComposedProviderReadinessSpineConfiguration = {
    requiredProviders: ["providerA"],
  };
  const providerStates: readonly capability.ComposedProviderReadinessSpineProviderReadiness[] = [
    { provider: "providerA", state: "READY" },
  ] as const;
  const result = capability.getAggregatedReadiness(config, providerStates);
  assert.deepEqual(
    (result as capability.ComposedProviderReadinessSpineAggregatedReadiness).state,
    "READY"
  );
});

test("composedproviderreadinessspineproof", () => {
  const config: capability.ComposedProviderReadinessSpineConfiguration = {
    requiredProviders: ["providerA"],
  };
  const providerStates: readonly capability.ComposedProviderReadinessSpineProviderReadiness[] = [
    { provider: "providerA", state: "READY" },
  ] as const;
  const isReady = capability.proofComposedProviderReadiness(config, providerStates);
  assert.deepEqual(isReady, true);
});

test("composedproviderreadinessspinereadinessmodel", () => {
  const config: capability.ComposedProviderReadinessSpineConfiguration = {
    requiredProviders: ["providerA"],
  };
  const providerStates: readonly capability.ComposedProviderReadinessSpineProviderReadiness[] = [
    { provider: "providerA", state: "UNAVAILABLE" },
  ] as const;
  const result = capability.aggregateReadiness(config, providerStates);
  assert.deepEqual(result.state, "UNAVAILABLE");
  assert.deepEqual(
    (result.error as capability.ComposedProviderReadinessSpineError).kind,
    "AGGREGATION_FAILED"
  );
});

test("composedproviderreadinessspinevalidation", () => {
  const config: capability.ComposedProviderReadinessSpineConfiguration = {
    requiredProviders: ["providerA"],
  };
  const providerStates: readonly capability.ComposedProviderReadinessSpineProviderReadiness[] = [
    { provider: "providerA", state: "DEGRADED" },
  ] as const;
  const result = capability.aggregateReadiness(config, providerStates);
  assert.deepEqual(result.state, "DEGRADED");
  assert.deepEqual(result.error, null);
});