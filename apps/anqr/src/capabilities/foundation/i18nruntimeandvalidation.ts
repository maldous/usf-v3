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

  // Check for missing required keys (usedKeys not in localeKeyMap)
  const missingKeys = state.usedKeys.filter((key) => !state.localeKeyMap.has(key));
  findings.push(
    ...missingKeys.map((key) => ({
      kind: 'MISSING_REQUIRED_KEY',
      message: `Missing required key: ${key}`,
      key,
    } as const))
  );

  // Check for duplicate keys
  findings.push(
    ...state.duplicateKeys.map((key) => ({
      kind: 'DUPLICATE_KEY',
      message: `Duplicate key: ${key}`,
      key,
    } as const))
  );

  // Check for unused keys (in localeKeyMap but not in usedKeys)
  const unusedKeys = Array.from(state.localeKeyMap.keys()).filter(
    (key) => !state.usedKeys.includes(key) && !state.config.excludedKeys.includes(key)
  );
  findings.push(
    ...unusedKeys.map((key) => ({
      kind: 'UNUSED_KEY',
      message: `Unused key: ${key}`,
      key,
    } as const))
  );

  // Check for raw literals
  const rawLiteralFindings = state.rawLiteralFindings.filter(
    (f) => !state.config.governedLiterals.includes(f.literal || '') && !state.config.exceptionPatterns.some(p => f.literal?.includes(p) || false)
  );
  findings.push(...rawLiteralFindings);

  // Check interpolation parameters
  for (const [key, expectedParams] of state.interpolationParams) {
    if (!state.localeKeyMap.has(key)) continue;
    const template = state.localeKeyMap.get(key)!;
    const templateParams = (template.match(/\{(\w+)\}/g) || []).map(m => m.slice(1, -1));
    const missingInTemplate = expectedParams.filter(p => !templateParams.includes(p));
    const extraInTemplate = templateParams.filter(p => !expectedParams.includes(p));

    if (missingInTemplate.length > 0 || extraInTemplate.length > 0) {
      findings.push({
        kind: 'MISMATCHED_INTERPOLATION',
        message: `Interpolation parameter mismatch for key ${key}: expected ${expectedParams.join(', ')}, found ${templateParams.join(', ')}`,
        key,
      } as const);
    }
  }

  // Determine exit state
  const hasStrictFailures =
    state.validationMode === 'STRICT' &&
    findings.some(
      (f) =>
        f.kind === 'MISSING_REQUIRED_KEY' ||
        f.kind === 'DUPLICATE_KEY' ||
        f.kind === 'MISMATCHED_INTERPOLATION' ||
        (state.config.strictFailOnRawLiteral && f.kind === 'UNGOVERNED_RAW_LITERAL')
    );

  const exitState: I18nRuntimeAndValidationExitState = hasStrictFailures ? 'FAIL' : 'PASS';

  return {
    findings,
    exitState,
  };
}

export function checkReadiness(
  state: I18nRuntimeAndValidationState,
): {
  readonly ready: boolean;
  readonly error: I18nRuntimeAndValidationError | null;
} {
  const validationResult = validateI18n(state);
  if (validationResult.exitState === 'FAIL') {
    return {
      ready: false,
      error: {
        kind: 'READINESS_DEGRADED',
        message: 'Validation gate failed',
      },
    };
  }

  if (validationResult.findings.length > 0) {
    return {
      ready: false,
      error: {
        kind: 'READINESS_DEGRADED',
        message: 'Outstanding findings in report-only mode',
      },
    };
  }

  return {
    ready: true,
    error: null,
  };
}

export function createState(
  localeKeyMap: ReadonlyMap<string, string>,
  usedKeys: readonly string[],
  interpolationParams: ReadonlyMap<string, readonly string[]>,
  rawLiteralFindings: readonly I18nRuntimeAndValidationFinding[],
  config: I18nRuntimeAndValidationConfig,
  validationMode: I18nRuntimeAndValidationValidationMode,
): I18nRuntimeAndValidationState {
  // Detect duplicates
  const keyCounts = new Map<string, number>();
  for (const key of localeKeyMap.keys()) {
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  const duplicateKeys = Array.from(keyCounts.entries())
    .filter(([_, count]) => count > 1)
    .map(([key]) => key);

  return {
    localeKeyMap,
    duplicateKeys,
    usedKeys,
    interpolationParams,
    rawLiteralFindings,
    config,
    validationMode,
    exitState: 'PASS',
  };
}

export function validateConfiguration(
  config: unknown,
): { readonly kind: 'VALID'; readonly config: I18nRuntimeAndValidationConfig } | I18nRuntimeAndValidationError {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('strictFailOnRawLiteral' in config) ||
    !('governedLiterals' in config) ||
    !('excludedKeys' in config) ||
    !('exceptionPatterns' in config)
  ) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Invalid i18n configuration structure',
    };
  }

  const typedConfig = config as Record<string, unknown>;
  if (
    typeof typedConfig.strictFailOnRawLiteral !== 'boolean' ||
    !Array.isArray(typedConfig.governedLiterals) ||
    !Array.isArray(typedConfig.excludedKeys) ||
    !Array.isArray(typedConfig.exceptionPatterns)
  ) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Invalid i18n configuration types',
    };
  }

  return {
    kind: 'VALID',
    config: {
      strictFailOnRawLiteral: typedConfig.strictFailOnRawLiteral,
      governedLiterals: typedConfig.governedLiterals as readonly string[],
      excludedKeys: typedConfig.excludedKeys as readonly string[],
      exceptionPatterns: typedConfig.exceptionPatterns as readonly string[],
    },
  };
}