```typescript
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

export type BrandingPermissionCheckResult =
  | { readonly kind: 'GRANTED' }
  | { readonly kind: 'DENIED'; readonly error: BrandingAndThemingError };

export function checkBrandingPermission(
  tenantId: string,
  token: unknown,
  state: BrandingAndThemingState,
): BrandingPermissionCheckResult {
  if (token === null || typeof token !== 'object' || !('tenantId' in token) || token.tenantId !== tenantId) {
    return {
      kind: 'DENIED',
      error: { kind: 'FORBIDDEN', message: 'Tenant-scoped permission required' },
    };
  }

  if (!('permissions' in token) || !Array.isArray(token.permissions)) {
    return {
      kind: 'DENIED',
      error: { kind: 'FORBIDDEN', message: 'Invalid permissions in token' },
    };
  }

  const permissions = token.permissions as readonly string[];
  if (!permissions.includes('configuration:read') || !permissions.includes('configuration:write')) {
    return {
      kind: 'DENIED',
      error: { kind: 'FORBIDDEN', message: 'Configuration read/write permissions required' },
    };
  }

  return { kind: 'GRANTED' };
}

export function validateBrandingDefinition(
  definition: unknown,
): BrandingValidationSuccess | BrandingAndThemingError {
  if (definition === null || typeof definition !== 'object') {
    return { kind: 'VALIDATION_ERROR', message: 'Branding definition must be an object' };
  }

  const def = definition as Record<string, unknown>;

  if (typeof def.applicationName !== 'string') {
    return { kind: 'VALIDATION_ERROR', message: 'applicationName must be a string' };
  }

  if (typeof def.themeSelection !== 'string' || !BrandingAndThemingThemeSelection.includes(def.themeSelection as BrandingAndThemingThemeSelection)) {
    return { kind: 'VALIDATION_ERROR', message: 'themeSelection must be one of system, light, dark' };
  }

  const validDef: BrandingDefinition = {
    applicationName: def.applicationName,
    themeSelection: def.themeSelection as BrandingAndThemingThemeSelection,
  };

  return { kind: 'SUCCESS', definition: validDef };
}

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
    return { kind: 'FALLBACK', theme: { ...state.defaultTheme } };
  }
}

export function listBrandingDefinitions(
  tenantId: string,
  token: unknown,
  state: BrandingAndThemingState,
): readonly BrandingDefinition[] | BrandingAndThemingError {
  const permissionCheck = checkBrandingPermission(tenantId, token, state);
  if (permissionCheck.kind === 'DENIED') {
    return permissionCheck.error;
  }

  const definition = state.brandingDefinitions.get(tenantId);
  return definition ? [definition] : [];
}

export function createBrandingDefinition(
  tenantId: string,
  definition: unknown,
  token: unknown,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => BrandingAndThemingError | null,
): BrandingMutationResult {
  const permissionCheck = checkBrandingPermission(tenantId, token, state);
  if (permissionCheck.kind === 'DENIED') {
    return { kind: 'ERROR', error: permissionCheck.error };
  }

  const validation = validateBrandingDefinition(definition);
  if (validation.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validation };
  }

  const currentDef = state.brandingDefinitions.get(tenantId);
  if (currentDef !== undefined) {
    return {
      kind: 'ERROR',
      error: { kind: 'FORBIDDEN', message: 'Branding definition already exists for tenant' },
    };