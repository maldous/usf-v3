import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/foundation/environmentregistryandbootstrap.ts";

test("environmentregistryandbootstrapauditmodel", () => {
  const manifest: capability.EnvironmentManifest = {
    name: "env-a",
    provider: "aws",
    config: { key: "value" },
  };

  const stateAfterRegister = capability.registerEnvironment(
    capability.initialState,
    manifest,
    "alice",
    () => null,
  );

  // registerEnvironment should succeed and return a new state
  assert.ok("environments" in stateAfterRegister);
  const regState = stateAfterRegister as capability.EnvironmentRegistryAndBootstrapState;
  assert.equal(regState.lastAuditEvent?.kind, "AUDIT_BEFORE_REGISTRATION");
  assert.equal(regState.lastAuditEvent?.environment, "env-a");
  assert.equal(regState.lastAuditEvent?.operator, "alice");
  assert.equal(regState.readiness, "UNAVAILABLE");

  const bootstrapped = capability.bootstrapEnvironment(
    regState,
    "env-a",
    "bob",
    { aws: { region: "us-east-1" } },
    () => null,
    () => null,
  );

  // bootstrapEnvironment should succeed and return a new state
  assert.ok("generatedConfigs" in bootstrapped);
  const bootState = bootstrapped as capability.EnvironmentRegistryAndBootstrapState;
  assert.equal(bootState.lastAuditEvent?.kind, "AUDIT_BEFORE_BOOTSTRAP");
  assert.equal(bootState.lastAuditEvent?.environment, "env-a");
  assert.equal(bootState.lastAuditEvent?.operator, "bob");
  assert.equal(bootState.readiness, "UNAVAILABLE");
});

test("environmentregistryandbootstrapcontracts", () => {
  const manifest: capability.EnvironmentManifest = {
    name: "env-b",
    provider: "gcp",
    config: { secretKey: "secret:dbPass", static: "staticVal" },
  };

  const baseState = capability.registerEnvironment(
    capability.initialState,
    manifest,
    "carol",
    () => null,
  ) as capability.EnvironmentRegistryAndBootstrapState;

  // Fail when provider config plane does not contain the provider
  const missingProvider = capability.bootstrapEnvironment(
    baseState,
    "env-b",
    "dave",
    { aws: { region: "us-west-2" } },
    () => null,
    () => null,
  );
  assert.ok("kind" in missingProvider);
  const err1 = missingProvider as capability.EnvironmentRegistryAndBootstrapError;
  assert.equal(err1.kind, "PROVIDER_UNAVAILABLE");

  // Successful bootstrap with secret resolution
  const resolved = capability.bootstrapEnvironment(
    baseState,
    "env-b",
    "erin",
    { gcp: { region: "europe-west1" } },
    (key) => (key === "dbPass" ? "s3cr3t" : null),
    () => null,
  );
  assert.ok("generatedConfigs" in resolved);
  const bootState = resolved as capability.EnvironmentRegistryAndBootstrapState;
  const genConfig = capability.getEnvironmentConfig(bootState, "env-b");
  assert.ok(genConfig !== null);
  assert.equal(genConfig?.config["region"], "europe-west1");
  assert.equal(genConfig?.config["static"], "staticVal");
  assert.equal(genConfig?.config["secretKey"], "s3cr3t");
});

test("environmentregistryandbootstraplifecycle", () => {
  const manifest: capability.EnvironmentManifest = {
    name: "env-c",
    provider: "azure",
    config: { foo: "bar" },
  };

  const afterReg = capability.registerEnvironment(
    capability.initialState,
    manifest,
    "frank",
    () => null,
  ) as capability.EnvironmentRegistryAndBootstrapState;

  const afterBoot = capability.bootstrapEnvironment(
    afterReg,
    "env-c",
    "grace",
    { azure: { location: "westus" } },
    () => null,
    () => null,
  ) as capability.EnvironmentRegistryAndBootstrapState;

  const afterProofs = capability.runProofs(afterBoot);
  assert.deepEqual(afterProofs.pendingProofs, [] as const);
});

test("environmentregistryandbootstrappermissions", () => {
  const manifest: capability.EnvironmentManifest = {
    name: "env-d",
    provider: "aws",
    config: { key: "value" },
  };

  const firstState = capability.registerEnvironment(
    capability.initialState,
    manifest,
    "henry",
    () => null,
  ) as capability.EnvironmentRegistryAndBootstrapState;

  // Attempt duplicate registration – should return MUTATION_FAILURE and not mutate state
  const duplicate = capability.registerEnvironment(
    firstState,
    manifest,
    "ian",
    () => null,
  );
  assert.ok("kind" in duplicate);
  const dupErr = duplicate as capability.EnvironmentRegistryAndBootstrapError;
  assert.equal(dupErr.kind, "MUTATION_FAILURE");
  assert.equal(firstState.environments.length, 1);

  // Bootstrap with an unresolvable secret – should fail closed
  const manifestWithSecret: capability.EnvironmentManifest = {
    name: "env-e",
    provider: "aws",
    config: { secretVal: "secret:missing" },
  };
  const stateWithSecret = capability.registerEnvironment(
    capability.initialState,
    manifestWithSecret,
    "jack",
    () => null,
  ) as capability.EnvironmentRegistryAndBootstrapState;

  const secretFail = capability.bootstrapEnvironment(
    stateWithSecret,
    "env-e",
    "kate",
    { aws: { region: "us-east-2" } },
    () => null,
    () => null,
  );
  assert.ok("kind" in secretFail);
  const secErr = secretFail as capability.EnvironmentRegistryAndBootstrapError;
  assert.equal(secErr.kind, "MISSING_CONFIGURATION");
  assert.equal(stateWithSecret.generatedConfigs.length, 0);
});

test("environmentregistryandbootstrapproof", () => {
  // Fresh state – all proofs pending
  const freshProofs = capability.runProofs(capability.initialState);
  assert.deepEqual(
    freshProofs.pendingProofs,
    [
      "proof:environment-registry",
      "proof:environment-admin-bootstrap",
      "proof:environment-operations",
    ] as const,
  );

  // After registration only – registry proof cleared, others may remain
  const manifest: capability.EnvironmentManifest = {
    name: "env-f",
    provider: "aws",
    config: { key: "val" },
  };
  const afterReg = capability.registerEnvironment(
    capability.initialState,
    manifest,
    "leo",
    () => null,
  ) as capability.EnvironmentRegistryAndBootstrapState;

  const afterRegProofs = capability.runProofs(afterReg);
  assert.deepEqual(afterRegProofs.pendingProofs, [
    "proof:environment-admin-bootstrap",
    "proof:environment-operations",
  ] as const);

  // After full lifecycle – no pending proofs
  const afterBoot = capability.bootstrapEnvironment(
    afterReg,
    "env-f",
    "mia",
    { aws: { region: "us-west-1" } },
    () => null,
    () => null,
  ) as capability.EnvironmentRegistryAndBootstrapState;

  const finalProofs = capability.runProofs(afterBoot);
  assert.deepEqual(finalProofs.pendingProofs, [] as const);
});