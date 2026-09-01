export const BrandingAndThemingThemeSelection = ['system', 'light', 'dark'] as const;
export type BrandingAndThemingThemeSelection = typeof BrandingAndThemingThemeSelection[number];

export const BrandingAndThemingAuditAction = ['value-changed', 'value-cleared'] as const;
export type BrandingAndThemingAuditAction = typeof BrandingAndTheAuditAction[number];

export const BrandingAndThemingErrorKind = [
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'UNKNOWN_KEY',
  'NON_OVERRIDABLE',
  'CONFIGURATION_ERROR',
] as const;
export type BrandingAndThemingErrorKind = typeof BrandingAndThemingErrorKind[number];

export interface BrandingAndThemingError {
  readonly kind: BrandingAndThemingErrorKind;
  readonly message: string;
}

export interface DefaultTheme {
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly backgroundColor: string;
  readonly textColor: string;
}

export interface TenantThemeOverride {
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly backgroundColor?: string;
  readonly textColor?: string;
}

export interface BrandingDefinition {
  readonly applicationName: string;
  readonly themeSelection: BrandingAndThemingThemeSelection;
}

export type BrandingAndThemingState = Readonly<{
  readonly defaultTheme: DefaultTheme;
  readonly tenantThemeOverrides: ReadonlyMap<string, TenantThemeOverride>;
  readonly brandingDefinitions: ReadonlyMap<string, BrandingDefinition>;
}>;

export const initialState: BrandingAndThemingState = {
  defaultTheme: {
    primaryColor: '#0066cc',
    secondaryColor: '#004499',
    backgroundColor: '#ffffff',
    textColor: '#000000',
  },
  tenantThemeOverrides: new Map(),
  brandingDefinitions: new Map(),
};

export interface EffectiveTheme {
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly backgroundColor: string;
  readonly textColor: string;
}

export interface AuditEvent {
  readonly action: BrandingAndThemingAuditAction;
  readonly tenantId: string;
  readonly key: string;
  readonly previousValue: unknown;
  readonly newValue: unknown;
}

export type ThemeReadResult =
  | { readonly kind: 'SUCCESS'; readonly theme: EffectiveTheme }
  | { readonly kind: 'FALLBACK'; readonly theme: EffectiveTheme };

export type BrandingMutationResult =
  | { readonly kind: 'SUCCESS'; readonly newState: BrandingAndThemingState }
  | { readonly kind: 'ERROR'; readonly error: BrandingAndThemingError };

export function resolveEffectiveTheme(
  tenantId: string | null,
  state: BrandingAndThemingState,
): EffectiveTheme {
  if (tenantId === null) {
    return { ...state.defaultTheme };
  }

  const override = state.tenantThemeOverrides.get(tenantId);
  if (!override) {
    return { ...state.defaultTheme };
  }

  return {
    primaryColor: override.primaryColor ?? state.defaultTheme.primaryColor,
    secondaryColor: override.secondaryColor ?? state.defaultTheme.secondaryColor,
    backgroundColor: override.backgroundColor ?? state.defaultTheme.backgroundColor,
    textColor: override.textColor ?? state.defaultTheme.textColor,
  };
}

export function readTheme(
  host: string,
  state: BrandingAndThemingState,
): ThemeReadResult {
  try {
    const tenantId = host === '' ? null : host;
    const theme = resolveEffectiveTheme(tenantId, state);
    if (tenantId !== null && !state.tenantThemeOverrides.has(tenantId)) {
      return { kind: 'FALLBACK', theme };
    }
    return { kind: 'SUCCESS', theme };
  } catch {
    return { kind: 'FALLBACK', theme: state.defaultTheme };
  }
}

export function listBrandingDefinitions(
  tenantId: string,
  state: BrandingAndThemingState,
): readonly BrandingDefinition[] {
  const definition = state.brandingDefinitions.get(tenantId);
  return definition ? [definition] : [];
}

export function createBrandingDefinition(
  tenantId: string,
  definition: unknown,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => BrandingAndThemingError | null,
): BrandingMutationResult {
  const validation = validateBrandingDefinition(definition);
  if (validation.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validation };
  }

  const auditError = audit({
    action: 'value-changed',
    tenantId,
    key: 'brandingDefinition',
    previousValue: null,
    newValue: definition,
  });
  if (auditError !== null) {
    return { kind: 'ERROR', error: auditError };
  }

  const updatedDefinitions = new Map(state.brandingDefinitions);
  updatedDefinitions.set(tenantId, validation.definition);

  const newState: BrandingAndThemingState = {
    ...state,
    brandingDefinitions: updatedDefinitions,
  };

  return { kind: 'SUCCESS', newState };
}

export function patchBrandingDefinition(
  tenantId: string,
  key: string,
  value: unknown,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => BrandingAndThemingError | null,
): BrandingMutationResult {
  if (key !== 'applicationName' && key !== 'themeSelection') {
    return {
      kind: 'ERROR',
      error: { kind: 'UNKNOWN_KEY', message: `Unknown branding key: ${key}` },
    };
  }

  const currentDef = state.brandingDefinitions.get(tenantId);
  if (!currentDef) {
    return {
      kind: 'ERROR',
      error: { kind: 'FORBIDDEN', message: 'No branding definition exists for tenant' },
    };
  }

  let nextDefinition: BrandingDefinition;
  if (key === 'applicationName') {
    if (typeof value !== 'string') {
      return {
        kind: 'ERROR',
        error: { kind: 'VALIDATION_ERROR', message: 'applicationName must be a string' },
      };
    }
    nextDefinition = { ...currentDef, applicationName: value };
  } else {
    if (!BrandingAndThemingThemeSelection.includes(value as BrandingAndThemingThemeSelection)) {
      return {
        kind: 'ERROR',
        error: { kind: 'VALIDATION_ERROR', message: 'Invalid themeSelection' },
      };
    }
    nextDefinition = { ...currentDef, themeSelection: value as BrandingAndThemingThemeSelection };
  }

  const validation = validateBrandingDefinition(nextDefinition);
  if (validation.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validation };
  }

  const currentDefAsAny = currentDef as unknown as Record<string, unknown>;
  const previousValue = currentDefAsAny[key];

  const auditError = audit({
    action: 'value-changed',
    tenantId,
    key,
    previousValue,
    newValue: value,
  });
  if (auditError !== null) {
    return { kind: 'ERROR', error: auditError };
  }

  const updatedDefinitions = new Map(state.brandingDefinitions);
  updatedDefinitions.set(tenantId, validation.definition);

  const newState: BrandingAndThemingState = {
    ...state,
    brandingDefinitions: updatedDefinitions,
  };

  return { kind: 'SUCCESS', newState };
}

export function deleteBrandingDefinition(
  tenantId: string,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => BrandingAndThemingError | null,
): BrandingMutationResult {
  const currentDef = state.brandingDefinitions.get(tenantId);
  if (!currentDef) {
    return {
      kind: 'ERROR',
      error: { kind: 'FORBIDDEN', message: 'No branding definition exists for tenant' },
    };
  }

  const auditError = audit({
    action: 'value-cleared',
    tenantId,
    key: 'brandingDefinition',
    previousValue: currentDef,
    newValue: null,
  });
  if (auditError !== null) {
    return { kind: 'ERROR', error: auditError };
  }

  const updatedDefinitions = new Map(state.brandingDefinitions);
  updatedDefinitions.delete(tenantId);

  const newState: BrandingAndThemingState = {
    ...state,
    brandingDefinitions: updatedDefinitions,
  };

  return { kind: 'SUCCESS', newState };
}

function validateBrandingDefinition(
  definition: unknown,
): BrandingValidationSuccess | BrandingAndThemingError {
  if (definition === null || typeof definition !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Branding definition must be an object' };
  }

  const def = definition as Record<string, unknown>;

  if (typeof def.applicationName !== 'string') {
    return { kind: 'VALIDATION_ERROR', message: 'applicationName must be a string' };
  }

  if (!BrandingAndThemingThemeSelection.includes(def.themeSelection as BrandingAndThemingThemeSelection)) {
    return { kind: 'VALIDATION_ERROR', message: 'Invalid themeSelection' };
  }

  const validDef: BrandingDefinition = {
    applicationName: def.applicationName,
    themeSelection: def.themeSelection as BrandingAndThemingThemeSelection,
  };

  return { kind: 'SUCCESS', definition: validDef };
}

type BrandingValidationSuccess = { readonly kind: 'SUCCESS'; readonly definition: BrandingDefinition };