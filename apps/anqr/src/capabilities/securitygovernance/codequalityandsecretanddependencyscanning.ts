export const CodeQualityAndSecretAndDependencyScanningDecision = [
  'PASSED',
  'FAILED',
  'SKIPPED',
] as const;
export type CodeQualityAndSecretAndDependencyScanningDecision = typeof CodeQualityAndSecretAndDependencyScanningDecision[number];

export const CodeQualityAndSecretAndDependencyScanningErrorKind = [
  'STATIC_ANALYSIS_ERROR',
  'SBOM_MISSING',
  'SBOM_STALE',
  'SBOM_POLICY_VIOLATION',
  'CODE_SCANNING_MISSING',
  'CODE_SCANNING_INVALID_CONFIG',
  'ROUTE_MISSING',
] as const;
export type CodeQualityAndSecretAndDependencyScanningErrorKind = typeof CodeQualityAndSecretAndDependencyScanningErrorKind[number];

export const CodeQualityAndSecretAndDependencyScanningReadiness = [
  'READY',
  'NOT_READY',
] as const;
export type CodeQualityAndSecretAndDependencyScanningReadiness = typeof CodeQualityAndSecretAndDependencyScanningReadiness[number];

export interface StaticAnalysisFinding {
  readonly severity: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly message: string;
  readonly location: string;
}

export interface SBOMBaseline {
  readonly version: string;
  readonly lockHash: string;
  readonly createdAt: string;
}

export interface SBOMPolicyAudit {
  readonly passed: boolean;
  readonly details: readonly string[];
}

export interface CodeScanningConfig {
  readonly enabled: boolean;
  readonly binaryPath?: string;
  readonly dbConnection?: string;
  readonly resultStore?: string;
}

export interface SecurityRoute {
  readonly resource: string;
  readonly scope: string;
  readonly requiredPermission: string;
  readonly registeredAt: string;
}

export interface ConsoleReadiness {
  readonly servicesProbed: readonly string[];
  readonly allReady: boolean;
}

export interface CodeQualityAndSecretAndDependencyScanningState {
  readonly staticAnalysisFindings: readonly StaticAnalysisFinding[];
  readonly sbomBaseline: SBOMBaseline | null;
  readonly sbomPolicyAudit: SBOMPolicyAudit | null;
  readonly codeScanningConfig: CodeScanningConfig | null;
  readonly codeScanningResults: readonly string[];
  readonly securityRoute: SecurityRoute | null;
  readonly consoleReadiness: ConsoleReadiness | null;
  readonly lastDecision: CodeQualityAndSecretAndDependencyScanningDecision | null;
  readonly lastError: {
    readonly kind: CodeQualityAndSecretAndDependencyScanningErrorKind;
    readonly message: string;
  } | null;
}

export const initialState: CodeQualityAndSecretAndDependencyScanningState = {
  staticAnalysisFindings: [],
  sbomBaseline: null,
  sbomPolicyAudit: null,
  codeScanningConfig: null,
  codeScanningResults: [],
  securityRoute: null,
  consoleReadiness: null,
  lastDecision: null,
  lastError: null,
};

export function validateStaticAnalysis(
  findings: readonly StaticAnalysisFinding[],
): {
  readonly decision: CodeQualityAndSecretAndDependencyScanningDecision;
  readonly error: { readonly kind: CodeQualityAndSecretAndDependencyScanningErrorKind; readonly message: string } | null;
} {
  const highFindings = findings.filter((f) => f.severity === 'HIGH');
  if (highFindings.length > 0) {
    return {
      decision: 'FAILED',
      error: { kind: 'STATIC_ANALYSIS_ERROR', message: 'High severity findings detected' },
    };
  }
  return { decision: 'PASSED', error: null };
}

export function validateSBOM(
  baseline: SBOMBaseline | null,
  policyAudit: SBOMPolicyAudit | null,
): {
  readonly decision: CodeQualityAndSecretAndDependencyScanningDecision;
  readonly error: { readonly kind: CodeQualityAndSecretAndDependencyScanningErrorKind; readonly message: string } | null;
} {
  if (baseline === null) {
    return {
      decision: 'FAILED',
      error: { kind: 'SBOM_MISSING', message: 'SBOM baseline is missing' },
    };
  }
  if (policyAudit === null) {
    return {
      decision: 'FAILED',
      error: { kind: 'SBOM_POLICY_VIOLATION', message: 'SBOM policy audit missing' },
    };
  }
  if (!policyAudit.passed) {
    return {
      decision: 'FAILED',
      error: { kind: 'SBOM_POLICY_VIOLATION', message: `SBOM policy violations: ${policyAudit.details.join(', ')}` },
    };
  }
  return { decision: 'PASSED', error: null };
}

export function validateCodeScanning(
  config: CodeScanningConfig | null,
  results: readonly string[],
  authoritativeMode: boolean,
): {
  readonly decision: CodeQualityAndSecretAndDependencyScanningDecision;
  readonly error: { readonly kind: CodeQualityAndSecretAndDependencyScanningErrorKind; readonly message: string } | null;
} {
  if (config === null) {
    if (authoritativeMode) {
      return {
        decision: 'FAILED',
        error: { kind: 'CODE_SCANNING_INVALID_CONFIG', message: 'Code scanning configuration is missing in authoritative mode' },
      };
    }
    return { decision: 'SKIPPED', error: null };
  }
  if (!config.enabled) {
    if (authoritativeMode) {
      return {
        decision: 'FAILED',
        error: { kind: 'CODE_SCANNING_MISSING', message: 'Code scanning is disabled in authoritative mode' },
      };
    }
    return { decision: 'SKIPPED', error: null };
  }
  if (results.length === 0) {
    return {
      decision: 'FAILED',
      error: { kind: 'CODE_SCANNING_MISSING', message: 'No code scanning results found' },
    };
  }
  return { decision: 'PASSED', error: null };
}

export function validateSecurityRoute(
  route: SecurityRoute | null,
): {
  readonly decision: CodeQualityAndSecretAndDependencyScanningDecision;
  readonly error: { readonly kind: CodeQualityAndSecretAndDependencyScanningErrorKind; readonly message: string } | null;
} {
  if (route === null) {
    return {
      decision: 'FAILED',
      error: { kind: 'ROUTE_MISSING', message: 'Security route is not registered' },
    };
  }
  return { decision: 'PASSED', error: null };
}

export function runSecurityGate(
  state: CodeQualityAndSecretAndDependencyScanningState,
  authoritativeMode: boolean,
): CodeQualityAndSecretAndDependencyScanningState {
  const staticAnalysisResult = validateStaticAnalysis(state.staticAnalysisFindings);
  if (staticAnalysisResult.decision === 'FAILED') {
    return {
      ...state,
      lastDecision: 'FAILED',
      lastError: staticAnalysisResult.error,
    };
  }

  const sbomResult = validateSBOM(state.sbomBaseline, state.sbomPolicyAudit);
  if (sbomResult.decision === 'FAILED') {
    return {
      ...state,
      lastDecision: 'FAILED',
      lastError: sbomResult.error,
    };
  }

  const codeScanningResult = validateCodeScanning(state.codeScanningConfig, state.codeScanningResults, authoritativeMode);
  if (codeScanningResult.decision === 'FAILED') {
    return {
      ...state,
      lastDecision: 'FAILED',
      lastError: codeScanningResult.error,
    };
  }

  const routeResult = validateSecurityRoute(state.securityRoute);
  if (routeResult.decision === 'FAILED') {
    return {
      ...state,
      lastDecision: 'FAILED',
      lastError: routeResult.error,
    };
  }

  return {
    ...state,
    lastDecision: 'PASSED',
    lastError: null,
  };
}

export function checkReadiness(
  state: CodeQualityAndSecretAndDependencyScanningState,
  consoleReadiness: ConsoleReadiness | null,
): CodeQualityAndSecretAndDependencyScanningReadiness {
  if (state.lastDecision !== 'PASSED') {
    return 'NOT_READY';
  }
  if (consoleReadiness === null || !consoleReadiness.allReady) {
    return 'NOT_READY';
  }
  return 'READY';
}

export function registerSecurityRoute(
  state: CodeQualityAndSecretAndDependencyScanningState,
  resource: string,
  scope: string,
  requiredPermission: string,
): CodeQualityAndSecretAndDependencyScanningState {
  return {
    ...state,
    securityRoute: {
      resource,
      scope,
      requiredPermission,
      registeredAt: new Date().toISOString(),
    },
  };
}

export function setSBOMBaseline(
  state: CodeQualityAndSecretAndDependencyScanningState,
  version: string,
  lockHash: string,
): CodeQualityAndSecretAndDependencyScanningState {
  return {
    ...state,
    sbomBaseline: {
      version,
      lockHash,
      createdAt: new Date().toISOString(),
    },
  };
}

export function setSBOMPolicyAudit(
  state: CodeQualityAndSecretAndDependencyScanningState,
  passed: boolean,
  details: readonly string[],
): CodeQualityAndSecretAndDependencyScanningState {
  return {
    ...state,
    sbomPolicyAudit: { passed, details },
  };
}

export function setCodeScanningConfig(
  state: CodeQualityAndSecretAndDependencyScanningState,
  config: CodeScanningConfig,
): CodeQualityAndSecretAndDependencyScanningState {
  return {
    ...state,
    codeScanningConfig: config,
  };
}

export function addStaticAnalysisFindings(
  state: CodeQualityAndSecretAndDependencyScanningState,
  findings: readonly StaticAnalysisFinding[],
): CodeQualityAndSecretAndDependencyScanningState {
  return {
    ...state,
    staticAnalysisFindings: [...state.staticAnalysisFindings, ...findings],
  };
}

export function addCodeScanningResults(
  state: CodeQualityAndSecretAndDependencyScanningState,
  results: readonly string[],
): CodeQualityAndSecretAndDependencyScanningState {
  return {
    ...state,
    codeScanningResults: [...state.codeScanningResults, ...results],
  };
}

export function setConsoleReadiness(
  state: CodeQualityAndSecretAndDependencyScanningState,
  consoleReadiness: ConsoleReadiness,
): CodeQualityAndSecretAndDependencyScanningState {
  return {
    ...state,
    consoleReadiness,
  };
}