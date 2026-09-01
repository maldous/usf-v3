import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/securitygovernance/codequalityandsecretanddependencyscanning.ts";

test("codequalityandsecretanddependencyscanningauditmodel", () => {
  const state = capability.runCodeQualityAndSecretAndDependencyScanningGate(
    capability.initialState,
    [],
    null,
    null,
    null,
    null,
    [],
    "2023-01-01",
    null
  );
  assert.deepEqual(state.lastVerdict, 'FAIL');
  assert.deepEqual(state.lastError?.kind, 'SBOM_MISSING');
});

test("codequalityandsecretanddependencyscanningcontracts", () => {
  const rules: capability.StaticAnalysisRule[] = [{ id: "rule1", severity: "HIGH" } as const];
  const validatedRules = capability.validateStaticAnalysisRules(rules);
  assert.ok(!('kind' in validatedRules));
  assert.deepEqual(validatedRules, rules);

  const sbom: capability.SBOMDocument = { baseline: "baseline", lockHash: "hash", timestamp: "2023-01-01" };
  const validatedSBOM = capability.validateSBOM(sbom);
  assert.ok(!('kind' in validatedSBOM));
  assert.deepEqual(validatedSBOM, sbom);

  const policy: capability.SBOMPolicy = {
    allowedLicenses: ["MIT"],
    forbiddenLicenses: ["GPL"],
    securityRequirements: ["req1"]
  };
  const validatedPolicy = capability.validateSBOMPolicy(policy);
  assert.ok(!('kind' in validatedPolicy));
  assert.deepEqual(validatedPolicy, policy);

  const config: capability.CodeScanningConfig = {
    binaryPath: "/bin",
    configPath: "/config",
    databasePath: "/db",
    authoritative: true
  };
  const validatedConfig = capability.validateCodeScanningConfig(config);
  assert.ok(!('kind' in validatedConfig));
  assert.deepEqual(validatedConfig, config);

  const route: capability.SecurityRoute = { path: "/security", registered: true };
  const validatedRoute = capability.validateSecurityRoute(route);
  assert.ok(!('kind' in validatedRoute));
  assert.deepEqual(validatedRoute, route);
});

test("codequalityandsecretanddependencyscanningerrormodel", () => {
  const invalidRules = "not an array";
  const error = capability.validateStaticAnalysisRules(invalidRules);
  if ('kind' in error) {
    assert.deepEqual(error.kind, 'STATIC_ANALYSIS_ERROR');
  } else {
    assert.fail('Expected error for invalid rules');
  }

  const invalidSBOM = { baseline: 123 };
  const sbomError = capability.validateSBOM(invalidSBOM);
  if ('kind' in sbomError) {
    assert.deepEqual(sbomError.kind, 'SBOM_MISSING');
  } else {
    assert.fail('Expected error for invalid SBOM');
  }

  const staleSBOM: capability.SBOMDocument = { baseline: "old", lockHash: "hash", timestamp: "2020-01-01" };
  const isFresh = capability.verifySBOMFreshness(staleSBOM, "2023-01-01");
  assert.deepEqual(isFresh, false);

  const invalidPolicy = { allowedLicenses: "not an array" };
  const policyError = capability.validateSBOMPolicy(invalidPolicy);
  if ('kind' in policyError) {
    assert.deepEqual(policyError.kind, 'SBOM_POLICY_VIOLATION');
  } else {
    assert.fail('Expected error for invalid policy');
  }

  const invalidConfig = { binaryPath: 123 };
  const configError = capability.validateCodeScanningConfig(invalidConfig);
  if ('kind' in configError) {
    assert.deepEqual(configError.kind, 'CODE_SCANNING_INVALID_CONFIG');
  } else {
    assert.fail('Expected error for invalid config');
  }

  const invalidRoute = { path: 123 };
  const routeError = capability.validateSecurityRoute(invalidRoute);
  if ('kind' in routeError) {
    assert.deepEqual(routeError.kind, 'ROUTE_MISSING');
  } else {
    assert.fail('Expected error for invalid route');
  }

  const authoritativeConfig: capability.CodeScanningConfig = {
    binaryPath: "/bin",
    configPath: "/config",
    databasePath: "/db",
    authoritative: true
  };
  const scanningError = capability.validateCodeScanning(authoritativeConfig, null);
  assert.deepEqual(scanningError?.kind, 'CODE_SCANNING_MISSING');
});

test("codequalityandsecretanddependencyscanninglifecycle", () => {
  const rules: capability.StaticAnalysisRule[] = [{ id: "rule1", severity: "HIGH" } as const];
  const sbom: capability.SBOMDocument = { baseline: "baseline", lockHash: "hash", timestamp: "2023-01-01" };
  const policy: capability.SBOMPolicy = {
    allowedLicenses: ["MIT"],
    forbiddenLicenses: ["GPL"],
    securityRequirements: ["req1"]
  };
  const config: capability.CodeScanningConfig = {
    binaryPath: "/bin",
    configPath: "/config",
    databasePath: "/db",
    authoritative: false
  };
  const route: capability.SecurityRoute = { path: "/security", registered: true };

  const state = capability.runCodeQualityAndSecretAndDependencyScanningGate(
    capability.initialState,
    rules,
    sbom,
    policy,
    config,
    route,
    ["finding1"],
    "2023-01-01",
    {}
  );
  assert.deepEqual(state.lastVerdict, 'FAIL');
  assert.deepEqual(state.lastError?.kind, 'STATIC_ANALYSIS_ERROR');

  const freshState = capability.runCodeQualityAndSecretAndDependencyScanningGate(
    capability.initialState,
    rules,
    sbom,
    policy,
    config,
    route,
    [],
    "2022-01-01",
    {}
  );
  assert.deepEqual(freshState.lastVerdict, 'FAIL');
  assert.deepEqual(freshState.lastError?.kind, 'SBOM_STALE');

  const policyViolationState = capability.runCodeQualityAndSecretAndDependencyScanningGate(
    capability.initialState,
    rules,
    { baseline: "GPL code", lockHash: "hash", timestamp: "2023-01-01" },
    policy,
    config,
    route,
    [],
    "2022-01-01",
    {}
  );
  assert.deepEqual(policyViolationState.lastVerdict, 'FAIL');
  assert.deepEqual(policyViolationState.lastError?.kind, 'SBOM_POLICY_VIOLATION');
});

test("codequalityandsecretanddependencyscanningpermissions", () => {
  const route: capability.SecurityRoute = { path: "/security", registered: true };
  const validatedRoute = capability.validateSecurityRoute(route);
  assert.ok(!('kind' in validatedRoute));
  assert.deepEqual(validatedRoute.registered, true);

  const unregisteredRoute: capability.SecurityRoute = { path: "/security", registered: false };
  const unregisteredResult = capability.validateSecurityRoute(unregisteredRoute);
  assert.ok(!('kind' in unregisteredResult));
  assert.deepEqual(unregisteredResult.registered, false);
});

test("codequalityandsecretanddependencyscanningproof", () => {
  const rules: capability.StaticAnalysisRule[] = [{ id: "rule1", severity: "HIGH" } as const];
  const sbom: capability.SBOMDocument = { baseline: "baseline", lockHash: "hash", timestamp: "2023-01-01" };
  const policy: capability.SBOMPolicy = {
    allowedLicenses: ["MIT"],
    forbiddenLicenses: [],
    securityRequirements: []
  };
  const config: capability.CodeScanningConfig = {
    binaryPath: "/bin",
    configPath: "/config",
    databasePath: "/db",
    authoritative: false
  };
  const route: capability.SecurityRoute = { path: "/security", registered: true };

  const state = capability.runCodeQualityAndSecretAndDependencyScanningGate(
    capability.initialState,
    rules,
    sbom,
    policy,
    config,
    route,
    [],
    "2022-01-01",
    {}
  );
  assert.deepEqual(state.lastVerdict, 'PASS');
  assert.deepEqual(state.readiness, 'READY');
  assert.deepEqual(state.securityConsoleReady, false);
});

test("codequalityandsecretanddependencyscanningreadinessmodel", () => {
  const readyState: capability.CodeQualityAndSecretAndDependencyScanningState = {
    readiness: 'READY',
    lastVerdict: 'PASS',
    staticAnalysisRules: [{ id: "rule1", severity: "HIGH" } as const],
    sbomDocument: { baseline: "baseline", lockHash: "hash", timestamp: "2023-01-01" },
    sbomPolicy: null,
    codeScanningConfig: {
      binaryPath: "/bin",
      configPath: "/config",
      databasePath: "/db",
      authoritative: false
    },
    securityRoute: { path: "/security", registered: true },
    lastError: null,
    securityConsoleReady: false
  };
  const computedReadiness = capability.computeReadiness(readyState);
  assert.deepEqual(computedReadiness, 'READY');

  const notReadyState: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...readyState,
    lastVerdict: 'FAIL',
    securityConsoleReady: false
  };
  const computedNotReady = capability.computeReadiness(notReadyState);
  assert.deepEqual(computedNotReady, 'NOT_READY');
});

test("codequalityandsecretanddependencyscanningstatemodel", () => {
  const state: capability.CodeQualityAndSecretAndDependencyScanningState = {
    readiness: 'NOT_READY',
    lastVerdict: null,
    staticAnalysisRules: [{ id: "rule1", severity: "HIGH" } as const],
    sbomDocument: { baseline: "baseline", lockHash: "hash", timestamp: "2023-01-01" },
    sbomPolicy: {
      allowedLicenses: ["MIT"],
      forbiddenLicenses: ["GPL"],
      securityRequirements: ["req1"]
    },
    codeScanningConfig: {
      binaryPath: "/bin",
      configPath: "/config",
      databasePath: "/db",
      authoritative: true
    },
    securityRoute: { path: "/security", registered: true },
    lastError: null,
    securityConsoleReady: false
  };
  assert.deepEqual(state.staticAnalysisRules[0].severity, 'HIGH');
  assert.deepEqual(state.sbomDocument?.baseline, 'baseline');
  assert.deepEqual(state.sbomPolicy?.forbiddenLicenses, ['GPL']);
  assert.deepEqual(state.codeScanningConfig?.authoritative, true);
  assert.deepEqual(state.securityRoute?.registered, true);
});

test("codequalityandsecretanddependencyscanningvalidation", () => {
  const invalidRules = [{ id: 123, severity: "HIGH" }];
  const rulesError = capability.validateStaticAnalysisRules(invalidRules);
  if ('kind' in rulesError) {
    assert.deepEqual(rulesError.kind, 'STATIC_ANALYSIS_ERROR');
  } else {
    assert.fail('Expected error for invalid rules');
  }

  const invalidSBOM = { baseline: "baseline", lockHash: 123, timestamp: "2023-01-01" };
  const sbomError = capability.validateSBOM(invalidSBOM);
  if ('kind' in sbomError) {
    assert.deepEqual(sbomError.kind, 'SBOM_MISSING');
  } else {
    assert.fail('Expected error for invalid SBOM');
  }

  const invalidPolicy = { allowedLicenses: [], forbiddenLicenses: [], securityRequirements: 123 };
  const policyError = capability.validateSBOMPolicy(invalidPolicy);
  if ('kind' in policyError) {
    assert.deepEqual(policyError.kind, 'SBOM_POLICY_VIOLATION');
  } else {
    assert.fail('Expected error for invalid policy');
  }

  const invalidConfig = { binaryPath: "/bin", configPath: "/config", databasePath: "/db" };
  const configError = capability.validateCodeScanningConfig(invalidConfig);
  if ('kind' in configError) {
    assert.deepEqual(configError.kind, 'CODE_SCANNING_INVALID_CONFIG');
  } else {
    assert.fail('Expected error for invalid config');
  }

  const invalidRoute = { path: "/security" };
  const routeError = capability.validateSecurityRoute(invalidRoute);
  if ('kind' in routeError) {
    assert.deepEqual(routeError.kind, 'ROUTE_MISSING');
  } else {
    assert.fail('Expected error for invalid route');
  }

  const authoritativeConfig: capability.CodeScanningConfig = {
    binaryPath: "/bin",
    configPath: "/config",
    databasePath: "/db",
    authoritative: true
  };
  const scanningError = capability.validateCodeScanning(authoritativeConfig, null);
  assert.deepEqual(scanningError?.kind, 'CODE_SCANNING_MISSING');
});