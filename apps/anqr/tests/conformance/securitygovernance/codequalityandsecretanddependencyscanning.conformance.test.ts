import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/securitygovernance/codequalityandsecretanddependencyscanning.ts";

test("codequalityandsecretanddependencyscanningauditmodel", () => {
  const state = capability.initialState;
  const result = capability.runCodeQualityAndSecretAndDependencyScanningGate(
    state,
    [],
    null,
    null,
    null,
    null,
    [],
    "",
    null
  );
  assert.deepEqual(result.lastVerdict, 'FAIL');
  assert.deepEqual(result.lastError?.kind, 'SBOM_MISSING');
});

test("codequalityandsecretanddependencyscanningcontracts", () => {
  const rules: capability.StaticAnalysisRule[] = [{ id: "rule1", severity: "HIGH" }];
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
  assert.deepEqual(error.kind, 'STATIC_ANALYSIS_ERROR');

  const invalidSBOM = { baseline: 123 };
  const sbomError = capability.validateSBOM(invalidSBOM);
  assert.deepEqual(sbomError.kind, 'SBOM_MISSING');

  const staleSBOM: capability.SBOMDocument = { baseline: "old", lockHash: "hash", timestamp: "2020-01-01" };
  const isFresh = capability.verifySBOMFreshness(staleSBOM, "2023-01-01");
  assert.deepEqual(isFresh, false);

  const invalidPolicy = { allowedLicenses: "not an array" };
  const policyError = capability.validateSBOMPolicy(invalidPolicy);
  assert.deepEqual(policyError.kind, 'SBOM_POLICY_VIOLATION');

  const invalidConfig = { binaryPath: 123 };
  const configError = capability.validateCodeScanningConfig(invalidConfig);
  assert.deepEqual(configError.kind, 'CODE_SCANNING_INVALID_CONFIG');

  const invalidRoute = { path: 123 };
  const routeError = capability.validateSecurityRoute(invalidRoute);
  assert.deepEqual(routeError.kind, 'ROUTE_MISSING');

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
  const rules: capability.StaticAnalysisRule[] = [{ id: "rule1", severity: "HIGH" }];
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
  const unregisteredError = capability.validateSecurityRoute(unregisteredRoute);
  assert.ok(!('kind' in unregisteredError));
  assert.deepEqual(unregisteredError.registered, false);
});

test("codequalityandsecretanddependencyscanningproof", () => {
  const rules: capability.StaticAnalysisRule[] = [{ id: "rule1", severity: "HIGH" }];
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
});

test("codequalityandsecretanddependencyscanningreadinessmodel", () => {
  const readyState: capability.CodeQualityAndSecretAndDependencyScanningState = {
    readiness: 'READY',
    lastVerdict: 'PASS',
    staticAnalysisRules: [{ id: "rule1", severity: "HIGH" }],
    sbomDocument: { baseline: "baseline", lockHash: "hash", timestamp: "2023-01-01" },
    sbomPolicy: null,
    codeScanningConfig: {
      binaryPath: "/bin",
      configPath: "/config",
      databasePath: "/db",
      authoritative: false
    },
    securityRoute: { path: "/security", registered: true },
    lastError: null
  };
  const computedReadiness = capability.computeReadiness(readyState);
  assert.deepEqual(computedReadiness, 'READY');

  const notReadyState: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...readyState,
    lastVerdict: 'FAIL'
  };
  const computedNotReady = capability.computeReadiness(notReadyState);
  assert.deepEqual(computedNotReady, 'NOT_READY');
});

test("codequalityandsecretanddependencyscanningstatemodel", () => {
  const state: capability.CodeQualityAndSecretAndDependencyScanningState = {
    readiness: 'NOT_READY',
    lastVerdict: null,
    staticAnalysisRules: [{ id: "rule1", severity: "HIGH" }],
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
    lastError: null
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
  assert.deepEqual(rulesError.kind, 'STATIC_ANALYSIS_ERROR');

  const invalidSBOM = { baseline: "baseline", lockHash: 123, timestamp: "2023-01-01" };
  const sbomError = capability.validateSBOM(invalidSBOM);
  assert.deepEqual(sbomError.kind, 'SBOM_MISSING');

  const invalidPolicy = { allowedLicenses: [], forbiddenLicenses: [], securityRequirements: 123 };
  const policyError = capability.validateSBOMPolicy(invalidPolicy);
  assert.deepEqual(policyError.kind, 'SBOM_POLICY_VIOLATION');

  const invalidConfig = { binaryPath: "/bin", configPath: "/config", databasePath: "/db" };
  const configError = capability.validateCodeScanningConfig(invalidConfig);
  assert.deepEqual(configError.kind, 'CODE_SCANNING_INVALID_CONFIG');

  const invalidRoute = { path: "/security" };
  const routeError = capability.validateSecurityRoute(invalidRoute);
  assert.deepEqual(routeError.kind, 'ROUTE_MISSING');

  const authoritativeConfig: capability.CodeScanningConfig = {
    binaryPath: "/bin",
    configPath: "/config",
    databasePath: "/db",
    authoritative: true
  };
  const scanningError = capability.validateCodeScanning(authoritativeConfig, null);
  assert.deepEqual(scanningError?.kind, 'CODE_SCANNING_MISSING');
});