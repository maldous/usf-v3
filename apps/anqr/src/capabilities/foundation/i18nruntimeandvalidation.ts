export const I18nRuntimeAndValidationValidationMode = ['STRICT', 'REPORT_ONLY'] as const;
export type I18nRuntimeAndValidationValidationMode = typeof I18nRuntimeAndValidationValidationMode[number];

export const I18nRuntimeAndValidationExitState = ['PASS', 'FAIL'] as const;
export type I18nRuntimeAndValidationExitState = typeof I18nRuntimeAndValidationExitState[number];

export const I18nRuntimeAndValidationErrorKind = [
  'MISSING_REQUIRED_KEY',
  'DUPLICATE_KEY',
  'UNUSED_KEY',
  'MISMATCHED_INTERPOLATION',
  'UNGOVERNED_RAW_LITERAL',
  'INVALID_CONFIGURATION',
  'READINESS_DEGRADED',
] as const;
export type I18nRuntimeAndValidationErrorKind = typeof I18nRuntimeAndValidationErrorKind[number];

export interface I18nRuntimeAndValidationError {
  readonly kind: I18nRuntimeAndValidationErrorKind;
  readonly message: string;
  readonly key?: string;
  readonly literal?: string;
}

export interface I18nRuntimeAndValidationFinding {
  readonly kind: I18nRuntimeAndValidationErrorKind;
  readonly message: string;
  readonly key?: string;
  readonly literal?: string;
}

export interface I18nRuntimeAndValidationConfig {
  readonly strictFailOnRawLiteral: boolean;
  readonly governedLiterals: readonly string[];
  readonly excludedKeys: readonly string[];
  readonly exceptionPatterns: readonly string[];
}

export interface I18nRuntimeAndValidationState {
  readonly localeKeyMap: ReadonlyMap<string, string>;
  readonly duplicateKeys: readonly string[];
  readonly usedKeys: readonly string[];
  readonly interpolationParams: ReadonlyMap<string, readonly string[]>;
  readonly rawLiteralFindings: readonly I18nRuntimeAndValidationFinding[];
  readonly config: I18nRuntimeAndValidationConfig;
  readonly validationMode: I18nRuntimeAndValidationValidationMode;
  readonly exitState: I18nRuntimeAndValidationExitState;
}

export const initialState: I18nRuntimeAndValidationState = {
  localeKeyMap: new Map(),
  duplicateKeys: [],
  usedKeys: [],
  interpolationParams: new Map(),
  rawLiteralFindings: [],
  config: {
    strictFailOnRawLiteral: true,
    governedLiterals: [],
    excludedKeys: [],
    exceptionPatterns: [],
  },
  validationMode: 'STRICT',
  exitState: 'PASS',
};

export function resolveLocaleKey(
  state: I18nRuntimeAndValidationState,
  key: string,
  params?: Record<string, string>,
): { readonly kind: 'SUCCESS'; readonly value: string } | I18nRuntimeAndValidationError {
  if (!state.localeKeyMap.has(key)) {
    return {
      kind: 'MISSING_REQUIRED_KEY',
      message: `Missing required key: ${key}`,
      key,
    };
  }

  const template = state.localeKeyMap.get(key)!;
  if (params) {
    const expectedParams = state.interpolationParams.get(key) || [];
    const providedParamKeys = Object.keys(params);
    const missingParams = expectedParams.filter((p) => !(p in params));
    const extraParams = providedParamKeys.filter((p) => !expectedParams.includes(p));

    if (missingParams.length > 0 || extraParams.length > 0) {
      return {
        kind: 'MISMATCHED_INTERPOLATION',
        message: `Interpolation mismatch for key ${key}: missing ${missingParams.join(', ')}, extra ${extraParams.join(', ')}`,
        key,
      };
    }

    try {
      const value = template.replace(/\{(\w+)\}/g, (_, param) => params[param] || '');
      return { kind: 'SUCCESS', value };
    } catch {
      return {
        kind: 'MISMATCHED_INTERPOLATION',
        message: `Interpolation failed for key ${key}`,
        key,
      };
    }
  }

  return { kind: 'SUCCESS', value: template };
}

export function validateI18n(
  state: I18nRuntimeAndValidationState,
): {
  readonly findings: readonly I18nRuntimeAndValidationFinding[];
  readonly exitState: I18nRuntimeAndValidationExitState;
} {
  const findings: I18nRuntimeAndValidationFinding[] = [];

  const missingKeys = state.usedKeys.filter((key) => !state.localeKeyMap.has(key));
  findings.push(
    ...missingKeys.map((key) => ({
      kind: 'MISSING_REQUIRED_KEY' as const,
      message: `Missing required key: ${key}`,
      key,
    }))
  );

  findings.push(
    ...state.duplicateKeys.map((key) => ({
      kind: 'DUPLICATE_KEY' as const,
      message: `Duplicate key: ${key}`,
      key,
    }))
  );

  const unusedKeys = Array.from(state.localeKeyMap.keys()).filter(
    (key) => !state.usedKeys.includes(key) && !state.config.excludedKeys.includes(key)
  );
  findings.push(
    ...unusedKeys.map((key) => ({
      kind: 'UNUSED_KEY' as const,
      message: `Unused key: ${key}`,
      key,
    }))
  );

  const rawLiteralFindings = state.rawLiteralFindings.filter(
    (f) => !state.config.governedLiterals.includes(f.literal || '') && !state.config.exceptionPatterns.some(p => f.literal?.includes(p) || false)
  );
  findings.push(...rawLiteralFindings);

  for (const [key, expectedParams] of state.interpolationParams) {
    if (!state.localeKeyMap.has(key)) continue;
    const template = state.localeKeyMap.get(key)!;
    const templateParams = (template.match(/\{(\w+)\}/g) || []).map(m => m.slice(1, -1));
    const missingInTemplate = expectedParams.filter(p => !templateParams.includes(p));
    const extraInTemplate = templateParams.filter(p => !expectedParams.includes(p));

    if (missingInTemplate.length > 0 || extraInTemplate.length > 0) {
      findings.push({
        kind: 'MISMATCHED_INTERPOLATION' as const,
        message: `Interpolation parameter mismatch for key ${key}: expected ${expectedParams.join(', ')}, found ${templateParams.join(', ')}`,
        key,
      });
    }
  }

  const hasStrictFailures = findings.some(
    f => f.kind !== 'UNUSED_KEY' && f.kind !== 'DUPLICATE_KEY'
  );
  const exitState = state.validationMode === 'STRICT' && hasStrictFailures
    ? 'FAIL'
    : 'PASS';

  return {
    findings: Object.freeze(findings),
    exitState,
  };
}