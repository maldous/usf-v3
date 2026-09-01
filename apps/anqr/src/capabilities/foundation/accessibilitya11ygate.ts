export const AccessibilityA11yGateVerdict = ['PASS', 'FAIL'] as const;
export type AccessibilityA11yGateVerdict = typeof AccessibilityA11yGateVerdict[number];

export const AccessibilityA11yGateReadiness = ['READY', 'NOT_READY'] as const;
export type AccessibilityA11yGateReadiness = typeof AccessibilityA11yGateReadiness[number];

export const AccessibilityA11yGateErrorKind = [
  'CONFIG_MISSING',
  'CONFIG_INVALID',
  'DEPENDENCY_UNAVAILABLE',
  'AUDIT_VIOLATION',
] as const;
export type AccessibilityA11yGateErrorKind = typeof AccessibilityA11yGateErrorKind[number];

export interface AccessibilityA11yGateError {
  readonly kind: AccessibilityA11yGateErrorKind;
  readonly message: string;
}

export interface AccessibilityExpectationSet {
  readonly landmarks: readonly string[];
  readonly roles: readonly string[];
  readonly aria: Readonly<Record<string, unknown>>;
  readonly axeRules: readonly string[];
}

export interface AccessibilityAuditResult {
  readonly surfaceId: string;
  readonly landmarks: Readonly<Record<string, boolean>>;
  readonly roles: Readonly<Record<string, boolean>>;
  readonly aria: Readonly<Record<string, boolean>>;
  readonly axeViolations: readonly string[];
}

export interface AccessibilityA11yGateConfig {
  readonly expectationSet: AccessibilityExpectationSet;
}

export type AccessibilityA11yGateState = Readonly<{
  readonly readiness: AccessibilityA11yGateReadiness;
  readonly lastVerdict: AccessibilityA11yGateVerdict | null;
  readonly lastAuditResults: readonly AccessibilityAuditResult[] | null;
  readonly lastError: AccessibilityA11yGateError | null;
}>;

export const initialState: AccessibilityA11yGateState = {
  readiness: 'NOT_READY',
  lastVerdict: null,
  lastAuditResults: null,
  lastError: null,
};

export function validateConfig(
  config: unknown,
): AccessibilityA11yGateConfig | AccessibilityA11yGateError {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('expectationSet' in config) ||
    config.expectationSet === null ||
    typeof config.expectationSet !== 'object'
  ) {
    return { kind: 'CONFIG_MISSING', message: 'Accessibility expectation set is missing or invalid' };
  }

  const expectationSet = config.expectationSet as Record<string, unknown>;
  if (
    !Array.isArray(expectationSet.landmarks) ||
    !Array.isArray(expectationSet.roles) ||
    typeof expectationSet.aria !== 'object' ||
    !Array.isArray(expectationSet.axeRules)
  ) {
    return { kind: 'CONFIG_INVALID', message: 'Accessibility expectation set structure is invalid' };
  }

  return { expectationSet: config.expectationSet as AccessibilityExpectationSet };
}

export function auditSurface(
  surfaceId: string,
  renderedSurface: unknown,
  expectationSet: AccessibilityExpectationSet,
): AccessibilityAuditResult | AccessibilityA11yGateError {
  if (renderedSurface === null || typeof renderedSurface !== 'object') {
    return { kind: 'DEPENDENCY_UNAVAILABLE', message: 'Rendered surface is unavailable or invalid' };
  }

  const surface = renderedSurface as Record<string, unknown>;
  const landmarks: Record<string, boolean> = {};
  for (const landmark of expectationSet.landmarks) {
    landmarks[landmark] = landmark in surface;
  }

  const roles: Record<string, boolean> = {};
  for (const role of expectationSet.roles) {
    roles[role] = role in surface;
  }

  const aria: Record<string, boolean> = {};
  for (const [key] of Object.entries(expectationSet.aria)) {
    aria[key] = key in surface;
  }

  const axeViolations: string[] = [];
  for (const rule of expectationSet.axeRules) {
    if (!(rule in surface)) {
      axeViolations.push(rule);
    }
  }

  return {
    surfaceId,
    landmarks,
    roles,
    aria,
    axeViolations,
  };
}

export function evaluateGate(
  auditResults: readonly AccessibilityAuditResult[],
  expectationSet: AccessibilityExpectationSet,
): AccessibilityA11yGateVerdict {
  for (const result of auditResults) {
    for (const landmark of expectationSet.landmarks) {
      if (!result.landmarks[landmark]) return 'FAIL';
    }
    for (const role of expectationSet.roles) {
      if (!result.roles[role]) return 'FAIL';
    }
    for (const [key] of Object.entries(expectationSet.aria)) {
      if (!result.aria[key]) return 'FAIL';
    }
    if (result.axeViolations.length > 0) return 'FAIL';
  }
  return 'PASS';
}

export function computeReadiness(
  state: AccessibilityA11yGateState,
): AccessibilityA11yGateReadiness {
  if (state.lastVerdict === 'PASS' && state.lastError === null) {
    return 'READY';
  }
  return 'NOT_READY';
}

export function runAccessibilityGate(
  state: AccessibilityA11yGateState,
  config: unknown,
  surfaces: readonly { readonly id: string; readonly rendered: unknown }[],
): AccessibilityA11yGateState {
  const validatedConfig = validateConfig(config);
  if ('kind' in validatedConfig) {
    return {
      ...state,
      readiness: 'NOT_READY',
      lastVerdict: null,
      lastAuditResults: null,
      lastError: validatedConfig,
    };
  }

  const auditResults: AccessibilityAuditResult[] = [];
  for (const surface of surfaces) {
    const result = auditSurface(surface.id, surface.rendered, validatedConfig.expectationSet);
    if ('kind' in result) {
      return {
        ...state,
        readiness: 'NOT_READY',
        lastVerdict: null,
        lastAuditResults: null,
        lastError: result,
      };
    }
    auditResults.push(result);
  }

  const verdict = evaluateGate(auditResults, validatedConfig.expectationSet);
  const readiness = computeReadiness({ ...state, lastVerdict: verdict, lastError: null });

  return {
    ...state,
    readiness,
    lastVerdict: verdict,
    lastAuditResults: auditResults,
    lastError: null,
  };
}