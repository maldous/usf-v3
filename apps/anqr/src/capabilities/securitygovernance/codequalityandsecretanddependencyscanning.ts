export const CodeQualityAndSecretAndDependencyScanningVerdict = ['PASS', 'FAIL'] as const;
export type CodeQualityAndSecretAndDependencyScanningVerdict = typeof CodeQualityAndSecretAndDependencyScanningVerdict[number];

export const CodeQualityAndSecretAndDependencyScanningReadiness = ['READY', 'NOT_READY'] as const;
export type CodeQualityAndSecretAndDependencyScanningReadiness = typeof CodeQualityAndSecretAndDependencyScanningReadiness[number];

export const CodeQualityAndSecretAndDependencyScanningErrorKind = [
  'STATIC_ANALYSIS_ERROR',
  'SBOM_MISSING',
  'SBOM_STALE',
  'SBOM_STALE',
  'SBOM_POLICY_VIOLATION',
  'CODE_SCANNING_MISSING',
  'CODE_SCANNING_INVALID_CONFIG',
  'ROUTE_MISSING',
] as const;
export type CodeQualityAndSecretAndDependencyScanningErrorKind = typeof CodeQualityAndSecretAndDependencyScanningErrorKind[number];

export interface CodeQualityAndSecretAndDependencyScanningError {
  readonly kind: CodeQualityAndSecretAndDependencyScanningErrorKind;
  readonly message: string;
}

export interface StaticAnalysisRule {
  readonly id: string;
  readonly severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface SBOMDocument {
  readonly baseline: string;
  readonly lockHash: string;
  readonly timestamp: string;
}

export interface SBOMPolicy {
  readonly allowedLicenses: readonly string[];
  readonly forbiddenLicenses: readonly string[];
  readonly securityRequirements: readonly string[];
}

export interface CodeScanningConfig {
  readonly binaryPath: string;
  readonly configPath: string;
  readonly databasePath: string;
  readonly authoritative: boolean;
}

export interface SecurityRoute {
  readonly path: string;
  readonly registered: boolean;
}

export interface CodeQualityAndSecretAndDependencyScanningState {
  readonly readiness: CodeQualityAndSecretAndDependencyScanningReadiness;
  readonly lastVerdict: CodeQualityAndSecretAndDependencyScanningVerdict | null;
  readonly staticAnalysisRules: readonly StaticAnalysisRule[];
  readonly sbomDocument: SBOMDocument | null;
  readonly sbomPolicy: SBOMPolicy | null;
  readonly codeScanningConfig: CodeScanningConfig | null;
  readonly securityRoute: SecurityRoute | null;
  readonly lastError: CodeQualityAndSecretAndDependencyScanningError | null;
  readonly securityConsoleReady: boolean;
}

export const initialState: CodeQualityAndSecretAndDependencyScanningState = {
  readiness: 'NOT_READY',
  lastVerdict: null,
  staticAnalysisRules: [],
  sbomDocument: null,
  sbomPolicy: null,
  codeScanningConfig: null,
  securityRoute: null,
  lastError: null,
  securityConsoleReady: false,
};

export function validateStaticAnalysisRules(
  rules: unknown,
): readonly StaticAnalysisRule[] | CodeQualityAndSecretAndDependencyScanningError {
  if (!Array.isArray(rules)) {
    return { kind: 'STATIC_ANALYSIS_ERROR', message: 'Static analysis rules must be an array' };
  }

  for (const rule of rules) {
    if (
      rule === null ||
      typeof rule !== 'object' ||
      !('id' in rule) ||
      typeof rule.id !== 'string' ||
      !('severity' in rule) ||
      !['HIGH', 'MEDIUM', 'LOW'].includes(rule.severity as string)
    ) {
      return { kind: 'STATIC_ANALYSIS_ERROR', message: 'Invalid static analysis rule structure' };
    }
  }

  return rules as readonly StaticAnalysisRule[];
}

export function validateSBOM(
  sbom: unknown,
): SBOMDocument | CodeQualityAndSecretAndDependencyScanningError {
  if (
    sbom === null ||
    typeof sbom !== 'object' ||
    !('baseline' in sbom) ||
    typeof sbom.baseline !== 'string' ||
    !('lockHash' in sbom) ||
    typeof sbom.lockHash !== 'string' ||
    !('timestamp' in sbom) ||
    typeof sbom.timestamp !== 'string'
  ) {
    return { kind: 'SBOM_MISSING', message: 'SBOM document is missing or invalid' };
  }

  return {
    baseline: sbom.baseline,
    lockHash: sbom.lockHash,
    timestamp: sbom.timestamp,
  };
}

export function validateSBOMPolicy(
  policy: unknown,
): SBOMPolicy | CodeQualityAndSecretAndDependencyScanningError {
  if (
    policy === null ||
    typeof policy !== 'object' ||
    !('allowedLicenses' in policy) ||
    !Array.isArray(policy.allowedLicenses) ||
    !('forbiddenLicenses' in policy) ||
    !Array.isArray(policy.forbiddenLicenses) ||
    !('securityRequirements' in policy) ||
    !Array.isArray(policy.securityRequirements)
  ) {
    return { kind: 'SBOM_POLICY_VIOLATION', message: 'SBOM policy is missing or invalid' };
  }

  return {
    allowedLicenses: policy.allowedLicenses,
    forbiddenLicenses: policy.forbiddenLicenses,
    securityRequirements: policy.securityRequirements,
  };
}

export function validateCodeScanningConfig(
  config: unknown,
): CodeScanningConfig | CodeQualityAndSecretAndDependencyScanningError {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('binaryPath' in config) ||
    typeof config.binaryPath !== 'string' ||
    !('configPath' in config) ||
    typeof config.configPath !== 'string' ||
    !('databasePath' in config) ||
    typeof config.databasePath !== 'string' ||
    !('authoritative' in config) ||
    typeof config.authoritative !== 'boolean'
  ) {
    return { kind: 'CODE_SCANNING_INVALID_CONFIG', message: 'Code scanning configuration is invalid' };
  }

  return {
    binaryPath: config.binaryPath,
    configPath: config.configPath,
    databasePath: config.databasePath,
    authoritative: config.authoritative,
  };
}

export function validateSecurityRoute(
  route: unknown,
): SecurityRoute | CodeQualityAndSecretAndDependencyScanningError {
  if (
    route === null ||
    typeof route !== 'object' ||
    !('path' in route) ||
    typeof route.path !== 'string' ||
    !('registered' in route) ||
    typeof route.registered !== 'boolean'
  ) {
    return { kind: 'ROUTE_MISSING', message: 'Security route is missing or invalid' };
  }

  return {
    path: route.path,
    registered: route.registered,
  };
}

export function runStaticAnalysisGate(
  rules: readonly StaticAnalysisRule[],
  findings: readonly string[],
): CodeQualityAndSecretAndDependencyScanningVerdict {
  if (findings.length > 0) {
    return 'FAIL';
  }
  return 'PASS';
}

export function verifySBOMFreshness(
  sbom: SBOMDocument,
  currentTimestamp: string,
): boolean {
  return sbom.timestamp >= currentTimestamp;
}

export function enforceSBOMPolicy(
  sbom: SBOMDocument,
  policy: SBOMPolicy,
): CodeQualityAndSecretAndDependencyScanningError | null {
  for (const license of policy.forbiddenLicenses) {
    if (sbom.baseline.includes(license)) {
      return { kind: 'SBOM_POLICY_VIOLATION', message: `Forbidden license detected: ${license}` };
    }
  }

  for (const requirement of policy.securityRequirements) {
    if (!sbom.baseline.includes(requirement)) {
      return { kind: 'SBOM_POLICY_VIOLATION', message: `Security requirement not met: ${requirement}` };
    }
  }

  return null;
}

export function validateCodeScanning(
  config: CodeScanningConfig,
  databaseState: unknown,
): CodeQualityAndSecretAndDependencyScanningError | null {
  if (config.authoritative && databaseState === null) {
    return { kind: 'CODE_SCANNING_MISSING', message: 'Code scanning database is missing in authoritative mode' };
  }
  return null;
}

export function computeReadiness(
  state: CodeQualityAndSecretAndDependencyScanningState,
): CodeQualityAndSecretAndDependencyScanningReadiness {
  if (
    state.lastVerdict === 'PASS' &&
    state.lastError === null &&
    state.sbomDocument !== null &&
    state.codeScanningConfig !== null &&
    state.securityRoute !== null &&
    state.securityRoute.registered
  ) {
    return 'READY';
  }
  return 'NOT_READY';
}

export function runCodeQualityAndSecretAndDependencyScanningGate(
  state: CodeQualityAndSecretAndDependencyScanningState,
  staticAnalysisRules: unknown,
  sbom: unknown,
  sbomPolicy: unknown,
  codeScanningConfig: unknown,
  securityRoute: unknown,
  staticAnalysisFindings: readonly string[],
  currentTimestamp: string,
  databaseState: unknown,
): CodeQualityAndSecretAndDependencyScanningState {
  const validatedRules = validateStaticAnalysisRules(staticAnalysisRules);
  if ('kind' in validatedRules) {
    return {
      ...state,
      lastError: validatedRules,
      lastVerdict: 'FAIL',
      readiness: 'NOT_READY',
    };
  }

  const validatedSBOM = validateSBOM(sbom);
  if ('kind' in validatedSBOM) {
    return {
      ...state,
      lastError: validatedSBOM,
      lastVerdict: 'FAIL',
      readiness: 'NOT_READY',
    };
  }

  const validatedPolicy = validateSBOMPolicy(sbomPolicy);
  if ('kind' in validatedPolicy) {
    return {
      ...state,
      lastError: validatedPolicy,
      lastVerdict: 'FAIL',
      readiness: 'NOT_READY',
    };
  }

  const validatedConfig = validateCodeScanningConfig(codeScanningConfig);
  if ('kind' in validatedConfig) {
    return {
      ...state,
      lastError: validatedConfig,
      lastVerdict: 'FAIL',
      readiness: 'NOT_READY',
    };
  }

  const validatedRoute = validateSecurityRoute(securityRoute);
  if ('kind' in validatedRoute) {
    return {
      ...state,
      lastError: validatedRoute,
      lastVerdict: 'FAIL',
      readiness: 'NOT_READY',
    };
  }

  const staticAnalysisVerdict = runStaticAnalysisGate(validatedRules, staticAnalysisFindings);
  if (staticAnalysisVerdict === 'FAIL') {
    return {
      ...state,
      staticAnalysisRules: validatedRules,
      sbomDocument: validatedSBOM,
      sbomPolicy: validatedPolicy,
      codeScanningConfig: validatedConfig,
      securityRoute: validatedRoute,
      lastVerdict: 'FAIL',
      lastError: { kind: 'STATIC_ANALYSIS_ERROR', message: 'Static analysis findings detected' },
      readiness: 'NOT_READY',
    };
  }

  if (!verifySBOMFreshness(validatedSBOM, currentTimestamp)) {
    return {
      ...state,
      staticAnalysisRules: validatedRules,
      sbomDocument: validatedSBOM,
      sbomPolicy: validatedPolicy,
      codeScanningConfig: validatedConfig,
      securityRoute: validatedRoute,
      lastVerdict: 'FAIL',
      lastError: { kind: 'SBOM_STALE', message: 'SBOM is stale' },
      readiness: 'NOT_READY',
    };
  }

  const policyError = enforceSBOMPolicy(validatedSBOM, validatedPolicy);
  if (policyError !== null) {
    return {
      ...state,
      staticAnalysisRules: validatedRules,
      sbomDocument: validatedSBOM,
      sbomPolicy: validatedPolicy,
      codeScanningConfig: validatedConfig,
      securityRoute: validatedRoute,
      lastVerdict: 'FAIL',
      lastError: policyError,
      readiness: 'NOT_READY',
    };
  }

  const scanningError = validateCodeScanning(validatedConfig, databaseState);
  if (scanningError !== null) {
    return {
      ...state,
      staticAnalysisRules: validatedRules,
      sbomDocument: validatedSBOM,
      sbomPolicy: validatedPolicy,
      codeScanningConfig: validatedConfig,
      securityRoute: validatedRoute,
      lastVerdict: 'FAIL',
      lastError: scanningError,
      readiness: 'NOT_READY',
    };
  }

  const finalState = {
    ...state,
    staticAnalysisRules: validatedRules,
    sbomDocument: validatedSBOM,
    sbomPolicy: validatedPolicy,
    codeScanningConfig: validatedConfig,
    securityRoute: validatedRoute,
    lastVerdict: 'PASS',
    lastError: null,
  };

  return {
    ...finalState,
    readiness: computeReadiness(finalState),
  };
}