export const BrandingAndThemingThemeSelection = ['system', 'light', 'dark'] as const;
export type BrandingAndThemingThemeSelection = typeof BrandingAndThemingThemeSelection[number];

export const BrandingAndThemingAuditAction = ['value-changed', 'value-cleared'] as const;
export type BrandingAndThemingAuditAction = typeof BrandingAndThemingAuditAction[number];

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

export const defaultTheme: DefaultTheme = initialState.defaultTheme;

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
  | { readonly kind: 'SUCCESS' }
  | { readonly kind: 'ERROR'; readonly error: BrandingAndThemingError };

function resolveEffectiveTheme(
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

function validateBrandingDefinition(
  definition: unknown,
): BrandingDefinition | BrandingAndThemingError {
  if (definition === null || typeof definition !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Branding definition must be an object' };
  }

  const def = definition as Record<string, unknown>;
  if (
    typeof def.applicationName !== 'string' ||
    !BrandingAndThemingThemeSelection.includes(def.themeSelection as BrandingAndThemingThemeSelection)
  ) {
    return { kind: 'VALIDATION_ERROR', message: 'Invalid applicationName or themeSelection' };
  }

  return {
    applicationName: def.applicationName,
    themeSelection: def.themeSelection as BrandingAndThemingThemeSelection,
  };
}

export function readTheme(
  host: string,
  state: BrandingAndThemingState,
): ThemeReadResult {
  const tenantId = host === '' ? null : host;
  const theme = resolveEffectiveTheme(tenantId, state);
  return { kind: 'SUCCESS', theme };
}

export function listBrandingDefinitions(
  tenantId: string,
  state: BrandingAndThemingState,
): readonly BrandingDefinition[] {
  const definitions = state.brandingDefinitions.get(tenantId);
  return definitions ? [definitions] : [];
}

export function patchBrandingDefinition(
  tenantId: string,
  key: string,
  value: unknown,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => void,
): BrandingMutationResult {
  if (key !== 'applicationName' && key !== 'themeSelection') {
    return { kind: 'ERROR', error: { kind: 'UNKNOWN_KEY', message: `Unknown branding key: ${key}` } };
  }

  const currentDef = state.brandingDefinitions.get(tenantId);
  if (!currentDef) {
    return { kind: 'ERROR', error: { kind: 'FORBIDDEN', message: 'No branding definition exists for tenant' } };
  }

  const newDef: Partial<BrandingDefinition> = { ...currentDef };
  if (key === 'applicationName') {
    if (typeof value !== 'string') {
      return { kind: 'ERROR', error: { kind: 'VALIDATION_ERROR', message: 'applicationName must be a string' } };
    }
    newDef.applicationName = value;
  } else if (key === 'themeSelection') {
    if (!BrandingAndThemingThemeSelection.includes(value as BrandingAndThemingThemeSelection)) {
      return { kind: 'ERROR', error: { kind: 'VALIDATION_ERROR', message: 'themeSelection must be one of system, light, dark' } };
    }
    newDef.themeSelection = value as BrandingAndThemingThemeSelection;
  }

  const validatedDef = validateBrandingDefinition(newDef);
  if ('kind' in validatedDef && validatedDef.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validatedDef };
  }

  const previousValue = currentDef[key as keyof BrandingDefinition];
  audit({
    action: previousValue === undefined ? 'value-changed' : 'value-changed',
    tenantId,
    key,
    previousValue,
    newValue: value,
  });

  const updatedDefinitions = new Map(state.brandingDefinitions);
  updatedDefinitions.set(tenantId, validatedDef as BrandingDefinition);

  return { kind: 'SUCCESS' };
}

export function deleteBrandingDefinition(
  tenantId: string,
  key: string,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => void,
): BrandingMutationResult {
  const currentDef = state.brandingDefinitions.get(tenantId);
  if (!currentDef) {
    return { kind: 'ERROR', error: { kind: 'FORBIDDEN', message: 'No branding definition exists for tenant' } };
  }

  if (key !== 'applicationName' && key !== 'themeSelection') {
    return { kind: 'ERROR', error: { kind: 'UNKNOWN_KEY', message: `Unknown branding key: ${key}` } };
  }

  const previousValue = currentDef[key as keyof BrandingDefinition];
  if (previousValue === undefined) {
    return { kind: 'ERROR', error: { kind: 'NON_OVERRIDABLE', message: `Key ${key} is not overridable` } };
  }

  audit({
    action: 'value-cleared',
    tenantId,
    key,
    previousValue,
    newValue: undefined,
  });

  const newDef: Partial<BrandingDefinition> = { ...currentDef };
  delete newDef[key as keyof BrandingDefinition];

  const validatedDef = validateBrandingDefinition(newDef);
  if ('kind' in validatedDef && validatedDef.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validatedDef };
  }

  const updatedDefinitions = new Map(state.brandingDefinitions);
  updatedDefinitions.set(tenantId, validatedDef as BrandingDefinition);

  return { kind: 'SUCCESS' };
}