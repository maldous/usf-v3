import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/securitygovernance/codequalityandsecretanddependencyscanning.ts";

test("codequalityandsecretanddependencyscanningauditmodel", () => {
  const state = capability.initialState;
  const result = capability.runSecurityGate(state, true);
  assert.equal(result.lastDecision, 'FAILED');
  assert.equal(result.lastError?.kind, 'SBOM_MISSING');
});

test("codequalityandsecretanddependencyscanningcontracts", () => {
  const findings: capability.StaticAnalysisFinding[] = [
    { severity: 'HIGH', message: 'test', location: 'test.ts' } as const,
  ];
  const result = capability.validateStaticAnalysis(findings);
  assert.equal(result.decision, 'FAILED');
  assert.equal(result.error?.kind, 'STATIC_ANALYSIS_ERROR');

  const baseline: capability.SBOMBaseline = {
    version: '1.0.0',
    lockHash: 'abc123',
    createdAt: '2023-01-01T00:00:00Z',
  };
  const policyAudit: capability.SBOMPolicyAudit = { passed: true, details: [] };
  const sbomResult = capability.validateSBOM(baseline, policyAudit);
  assert.equal(sbomResult.decision, 'PASSED');
  assert.equal(sbomResult.error, null);

  const config: capability.CodeScanningConfig = { enabled: true };
  const scanningResult = capability.validateCodeScanning(config, ['result1'], true);
  assert.equal(scanningResult.decision, 'PASSED');
  assert.equal(scanningResult.error, null);

  const route: capability.SecurityRoute = {
    resource: 'test',
    scope: 'global',
    requiredPermission: 'admin',
    registeredAt: '2023-01-01T00:00:00Z',
  };
  const routeResult = capability.validateSecurityRoute(route);
  assert.equal(routeResult.decision, 'PASSED');
  assert.equal(routeResult.error, null);
});

test("codequalityandsecretanddependencyscanningerrormodel", () => {
  const highFinding: capability.StaticAnalysisFinding[] = [
    { severity: 'HIGH', message: 'Critical issue', location: 'src/index.ts' } as const,
  ];
  const staticResult = capability.validateStaticAnalysis(highFinding);
  assert.equal(staticResult.decision, 'FAILED');
  assert.equal(staticResult.error?.kind, 'STATIC_ANALYSIS_ERROR');

  const missingSBOM = capability.validateSBOM(null, null);
  assert.equal(missingSBOM.decision, 'FAILED');
  assert.equal(missingSBOM.error?.kind, 'SBOM_MISSING');

  const failedPolicy: capability.SBOMPolicyAudit = { passed: false, details: ['License violation'] };
  const policyResult = capability.validateSBOM(
    { version: '1.0.0', lockHash: 'abc', createdAt: '2023-01-01' },
    failedPolicy
  );
  assert.equal(policyResult.decision, 'FAILED');
  assert.equal(policyResult.error?.kind, 'SBOM_POLICY_VIOLATION');

  const missingConfig = capability.validateCodeScanning(null, [], true);
  assert.equal(missingConfig.decision, 'FAILED');
  assert.equal(missingConfig.error?.kind, 'CODE_SCANNING_INVALID_CONFIG');

  const disabledConfig: capability.CodeScanningConfig = { enabled: false };
  const disabledResult = capability.validateCodeScanning(disabledConfig, [], true);
  assert.equal(disabledResult.decision, 'FAILED');
  assert.equal(disabledResult.error?.kind, 'CODE_SCANNING_MISSING');

  const missingRoute = capability.validateSecurityRoute(null);
  assert.equal(missingRoute.decision, 'FAILED');
  assert.equal(missingRoute.error?.kind, 'ROUTE_MISSING');
});

test("codequalityandsecretanddependencyscanninglifecycle", () => {
  const stateWithHighFinding: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    staticAnalysisFindings: [
      { severity: 'HIGH', message: 'Critical', location: 'test.ts' } as const,
    ],
  };
  const result = capability.runSecurityGate(stateWithHighFinding, true);
  assert.equal(result.lastDecision, 'FAILED');
  assert.equal(result.lastError?.kind, 'STATIC_ANALYSIS_ERROR');

  const stateWithMissingSBOM: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    sbomBaseline: null,
    sbomPolicyAudit: null,
  };
  const sbomResult = capability.runSecurityGate(stateWithMissingSBOM, true);
  assert.equal(sbomResult.lastDecision, 'FAILED');
  assert.equal(sbomResult.lastError?.kind, 'SBOM_MISSING');

  const stateWithFailedPolicy: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    sbomBaseline: { version: '1.0.0', lockHash: 'abc', createdAt: '2023-01-01' },
    sbomPolicyAudit: { passed: false, details: ['Violation'] },
  };
  const policyResult = capability.runSecurityGate(stateWithFailedPolicy, true);
  assert.equal(policyResult.lastDecision, 'FAILED');
  assert.equal(policyResult.lastError?.kind, 'SBOM_POLICY_VIOLATION');

  const stateWithMissingConfig: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    sbomBaseline: { version: '1.0.0', lockHash: 'abc', createdAt: '2023-01-01' },
    sbomPolicyAudit: { passed: true, details: [] },
    codeScanningConfig: null,
    codeScanningResults: [],
  };
  const configResult = capability.runSecurityGate(stateWithMissingConfig, true);
  assert.equal(configResult.lastDecision, 'FAILED');
  assert.equal(configResult.lastError?.kind, 'CODE_SCANNING_INVALID_CONFIG');

  const stateWithMissingRoute: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    sbomBaseline: { version: '1.0.0', lockHash: 'abc', createdAt: '2023-01-01' },
    sbomPolicyAudit: { passed: true, details: [] },
    codeScanningConfig: { enabled: true },
    codeScanningResults: ['result'],
    securityRoute: null,
  };
  const routeResult = capability.runSecurityGate(stateWithMissingRoute, true);
  assert.equal(routeResult.lastDecision, 'FAILED');
  assert.equal(routeResult.lastError?.kind, 'ROUTE_MISSING');
});

test("codequalityandsecretanddependencyscanningpermissions", () => {
  const route: capability.SecurityRoute = {
    resource: 'global-operator',
    scope: 'global',
    requiredPermission: 'operator',
    registeredAt: '2023-01-01T00:00:00Z',
  };
  const state = capability.registerSecurityRoute(capability.initialState, route.resource, route.scope, route.requiredPermission);
  assert.equal(state.securityRoute?.scope, 'global');
  assert.equal(state.securityRoute?.requiredPermission, 'operator');
});

test("codequalityandsecretanddependencyscanningproof", () => {
  const state: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    staticAnalysisFindings: [],
    sbomBaseline: { version: '1.0.0', lockHash: 'abc', createdAt: '2023-01-01' },
    sbomPolicyAudit: { passed: true, details: [] },
    codeScanningConfig: { enabled: true },
    codeScanningResults: ['result'],
    securityRoute: {
      resource: 'test',
      scope: 'global',
      requiredPermission: 'admin',
      registeredAt: '2023-01-01T00:00:00Z',
    },
  };
  const result = capability.runSecurityGate(state, true);
  assert.equal(result.lastDecision, 'PASSED');
  assert.equal(result.lastError, null);

  const routeState = capability.registerSecurityRoute(capability.initialState, 'test', 'global', 'admin');
  assert.notEqual(routeState.securityRoute, null);
});

test("codequalityandsecretanddependencyscanningreadinessmodel", () => {
  const readyState: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    lastDecision: 'PASSED',
    lastError: null,
    consoleReadiness: { servicesProbed: ['service1'], allReady: true },
  };
  const readiness = capability.checkReadiness(readyState, readyState.consoleReadiness);
  assert.equal(readiness, 'READY');

  const notReadyState: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    lastDecision: 'FAILED',
    lastError: { kind: 'STATIC_ANALYSIS_ERROR', message: 'test' },
    consoleReadiness: { servicesProbed: ['service1'], allReady: true },
  };
  const notReady = capability.checkReadiness(notReadyState, notReadyState.consoleReadiness);
  assert.equal(notReady, 'NOT_READY');

  const missingConsole: capability.CodeQualityAndSecretAndDependencyScanningState = {
    ...capability.initialState,
    lastDecision: 'PASSED',
    lastError: null,
    consoleReadiness: null,
  };
  const missingReadiness = capability.checkReadiness(missingConsole, null);
  assert.equal(missingReadiness, 'NOT_READY');
});

test("codequalityandsecretanddependencyscanningstatemodel", () => {
  const state: capability.CodeQualityAndSecretAndDependencyScanningState = {
    staticAnalysisFindings: [
      { severity: 'HIGH', message: 'test', location: 'test.ts' } as const,
    ],
    sbomBaseline: { version: '1.0.0', lockHash: 'abc', createdAt: '2023-01-01' },
    sbomPolicyAudit: { passed: true, details: ['detail'] },
    codeScanningConfig: { enabled: true, binaryPath: '/bin' },
    codeScanningResults: ['result'],
    securityRoute: {
      resource: 'test',
      scope: 'global',
      requiredPermission: 'admin',
      registeredAt: '2023-01-01T00:00:00Z',
    },
    consoleReadiness: { servicesProbed: ['service1'], allReady: true },
    lastDecision: 'PASSED',
    lastError: null,
  };
  assert.deepEqual(state.staticAnalysisFindings[0].severity, 'HIGH');
  assert.deepEqual(state.sbomBaseline?.version, '1.0.0');
  assert.deepEqual(state.sbomPolicyAudit?.passed, true);
  assert.deepEqual(state.codeScanningConfig?.enabled, true);
  assert.deepEqual(state.codeScanningResults[0], 'result');
  assert.deepEqual(state.securityRoute?.resource, 'test');
  assert.deepEqual(state.consoleReadiness?.allReady, true);
});

test("codequalityandsecretanddependencyscanningvalidation", () => {
  const highFinding: capability.StaticAnalysisFinding[] = [
    { severity: 'HIGH', message: 'Critical', location: 'src/index.ts' } as const,
  ];
  const staticResult = capability.validateStaticAnalysis(highFinding);
  assert.equal(staticResult.decision, 'FAILED');
  assert.equal(staticResult.error?.kind, 'STATIC_ANALYSIS_ERROR');

  const baseline: capability.SBOMBaseline = {
    version: '1.0.0',
    lockHash: 'abc123',
    createdAt: '2023-01-01T00:00:00Z',
  };
  const policyAudit: capability.SBOMPolicyAudit = { passed: true, details: [] };
  const sbomResult = capability.validateSBOM(baseline, policyAudit);
  assert.equal(sbomResult.decision, 'PASSED');
  assert.equal(sbomResult.error, null);

  const config: capability.CodeScanningConfig = { enabled: true };
  const scanningResult = capability.validateCodeScanning(config, ['result1'], true);
  assert.equal(scanningResult.decision, 'PASSED');
  assert.equal(scanningResult.error, null);

  const route: capability.SecurityRoute = {
    resource: 'test',
    scope: 'global',
    requiredPermission: 'admin',
    registeredAt: '2023-01-01T00:00:00Z',
  };
  const routeResult = capability.validateSecurityRoute(route);
  assert.equal(routeResult.decision, 'PASSED');
  assert.equal(routeResult.error, null);

  const skippedConfig = capability.validateCodeScanning(null, [], false);
  assert.equal(skippedConfig.decision, 'SKIPPED');
  assert.equal(skippedConfig.error, null);
});