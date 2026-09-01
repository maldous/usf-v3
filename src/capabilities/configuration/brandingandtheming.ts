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

export const BrandingAndThemingReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type BrandingAndThemingReadiness = typeof BrandingAndThemingReadiness[number];

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
  readonly tenantThemeOverrides: ReadonlyMap<string, TenantThemeOverride> | Readonly<Record<string, TenantThemeOverride>>;
  readonly brandingDefinitions: ReadonlyMap<string, BrandingDefinition> | Readonly<Record<string, BrandingDefinition>>;
  readonly hostTenantMappings?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly hostMappings?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly nonOverridableTenants?: ReadonlySet<string> | readonly string[];
  readonly nonOverridableKeys?: ReadonlySet<string> | readonly string[];
  readonly readiness?: BrandingAndThemingReadiness;
}>;

export const initialState: BrandingAndThemingState = {
  defaultTheme: {
    primaryColor: '#0066cc',
    secondaryColor: '#004499',
    backgroundColor: '#ffffff',
    textColor: '#000000',
  },
  tenantThemeOverrides: new Map<string, TenantThemeOverride>(),
  brandingDefinitions: new Map<string, BrandingDefinition>(),
  readiness: 'READY',
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

export type BrandingAndThemingAuditEvent = AuditEvent;

export type ThemeReadResult =
  | { readonly kind: 'SUCCESS'; readonly theme: EffectiveTheme }
  | { readonly kind: 'FALLBACK'; readonly theme: EffectiveTheme };

export type BrandingListResult =
  | { readonly kind: 'SUCCESS'; readonly definitions: readonly BrandingDefinition[] }
  | { readonly kind: 'ERROR'; readonly error: BrandingAndThemingError };

export type BrandingMutationResult =
  | { readonly kind: 'SUCCESS'; readonly newState: BrandingAndThemingState; readonly state: BrandingAndThemingState }
  | { readonly kind: 'ERROR'; readonly error: BrandingAndThemingError };

export type BrandingPermissionCheckResult =
  | { readonly kind: 'GRANTED' }
  | { readonly kind: 'DENIED'; readonly error: BrandingAndThemingError };

export type BrandingValidationSuccess = {
  readonly kind: 'SUCCESS';
  readonly definition: BrandingDefinition;
};

export type BrandingValidationResult =
  | BrandingValidationSuccess
  | BrandingAndThemingError;

export interface ConfigurationStorePort {
  readonly getEffectiveTheme: (
    host: string,
    state: BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly readBootstrapTheme?: (
    host: string,
    state: BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly bootstrapThemeRead?: (
    host: string,
    state: BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly readTheme?: (
    host: string,
    state: BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly listBrandingDefinitions: (
    tenantId: string,
    token: unknown,
    state: BrandingAndThemingState,
  ) => BrandingListResult;
  readonly patchBrandingDefinition: (
    tenantId: string,
    partialDefinition: Partial<BrandingDefinition>,
    token: unknown,
    state: BrandingAndThemingState,
    audit: (event: AuditEvent) => BrandingAndThemingError | null,
  ) => BrandingMutationResult;
  readonly deleteBrandingDefinition: (
    tenantId: string,
    token: unknown,
    state: BrandingAndThemingState,
    audit: (event: AuditEvent) => BrandingAndThemingError | null,
  ) => BrandingMutationResult;
  readonly createBrandingDefinition?: (
    tenantId: string,
    definition: unknown,
    token: unknown,
    state: BrandingAndThemingState,
    audit: (event: AuditEvent) => BrandingAndThemingError | null,
  ) => BrandingMutationResult;
  readonly list?: (
    tenantId: string,
    token: unknown,
    state: BrandingAndThemingState,
  ) => BrandingListResult;
  readonly patch?: (
    tenantId: string,
    partialDefinition: Partial<BrandingDefinition>,
    token: unknown,
    state: BrandingAndThemingState,
    audit: (event: AuditEvent) => BrandingAndThemingError | null,
  ) => BrandingMutationResult;
  readonly delete?: (
    tenantId: string,
    token: unknown,
    state: BrandingAndThemingState,
    audit: (event: AuditEvent) => BrandingAndThemingError | null,
  ) => BrandingMutationResult;
}

function getTenantThemeOverrideFromState(
  state: BrandingAndThemingState,
  tenantId: string,
): TenantThemeOverride | undefined {
  if (!state.tenantThemeOverrides) {
    return undefined;
  }
  const overrides = state.tenantThemeOverrides;
  if (overrides instanceof Map) {
    return overrides.get(tenantId);
  }
  if (typeof overrides === 'object' && overrides !== null) {
    return (overrides as Readonly<Record<string, TenantThemeOverride>>)[tenantId];
  }
  return undefined;
}

function hasTenantThemeOverrideInState(
  state: BrandingAndThemingState,
  tenantId: string,
): boolean {
  if (!state.tenantThemeOverrides) {
    return false;
  }
  const overrides = state.tenantThemeOverrides;
  if (overrides instanceof Map) {
    return overrides.has(tenantId);
  }
  if (typeof overrides === 'object' && overrides !== null) {
    return Object.prototype.hasOwnProperty.call(overrides, tenantId);
  }
  return false;
}

function getBrandingDefinitionFromState(
  state: BrandingAndThemingState,
  tenantId: string,
): BrandingDefinition | undefined {
  if (!state.brandingDefinitions) {
    return undefined;
  }
  const defs = state.brandingDefinitions;
  if (defs instanceof Map) {
    return defs.get(tenantId);
  }
  if (typeof defs === 'object' && defs !== null) {
    return (defs as Readonly<Record<string, BrandingDefinition>>)[tenantId];
  }
  return undefined;
}

function hasBrandingDefinitionInState(
  state: BrandingAndThemingState,
  tenantId: string,
): boolean {
  if (!state.brandingDefinitions) {
    return false;
  }
  const defs = state.brandingDefinitions;
  if (defs instanceof Map) {
    return defs.has(tenantId);
  }
  if (typeof defs === 'object' && defs !== null) {
    return Object.prototype.hasOwnProperty.call(defs, tenantId);
  }
  return false;
}

function setBrandingDefinitionInState(
  state: BrandingAndThemingState,
  tenantId: string,
  definition: BrandingDefinition | null,
): BrandingAndThemingState {
  if (state.brandingDefinitions instanceof Map) {
    const newMap = new Map(state.brandingDefinitions);
    if (definition === null) {
      newMap.delete(tenantId);
    } else {
      newMap.set(tenantId, definition);
    }
    return {
      ...state,
      brandingDefinitions: newMap,
    };
  } else {
    const newRecord = { ...(state.brandingDefinitions as Record<string, BrandingDefinition>) };
    if (definition === null) {
      delete newRecord[tenantId];
    } else {
      newRecord[tenantId] = definition;
    }
    return {
      ...state,
      brandingDefinitions: newRecord,
    };
  }
}

function isTenantNonOverridable(tenantId: string, state: BrandingAndThemingState): boolean {
  if ('nonOverridableTenants' in state && state.nonOverridableTenants) {
    const set = state.nonOverridableTenants;
    if (set instanceof Set && set.has(tenantId)) {
      return true;
    }
    if (Array.isArray(set) && set.includes(tenantId)) {
      return true;
    }
  }
  if ('nonOverridableKeys' in state && state.nonOverridableKeys) {
    const set = state.nonOverridableKeys;
    if (set instanceof Set && set.has(tenantId)) {
      return true;
    }
    if (Array.isArray(set) && set.includes(tenantId)) {
      return true;
    }
  }
  return false;
}

export function resolveTenantFromHost(
  host: string | null | undefined,
  state: BrandingAndThemingState,
): string | null {
  if (typeof host !== 'string' || host.trim() === '') {
    return null;
  }
  const cleanHost = host.trim();

  if ('hostTenantMappings' in state && state.hostTenantMappings) {
    const mappings = state.hostTenantMappings;
    if (mappings instanceof Map && mappings.has(cleanHost)) {
      return mappings.get(cleanHost) ?? null;
    }
    if (typeof mappings === 'object' && mappings !== null && cleanHost in mappings) {
      return (mappings as Record<string, string>)[cleanHost] ?? null;
    }
  }

  if ('hostMappings' in state && state.hostMappings) {
    const mappings = state.hostMappings;
    if (mappings instanceof Map && mappings.has(cleanHost)) {
      return mappings.get(cleanHost) ?? null;
    }
    if (typeof mappings === 'object' && mappings !== null && cleanHost in mappings) {
      return (mappings as Record<string, string>)[cleanHost] ?? null;
    }
  }

  if (hasTenantThemeOverrideInState(state, cleanHost) || hasBrandingDefinitionInState(state, cleanHost)) {
    return cleanHost;
  }

  const subdomain = cleanHost.split('.')[0];
  if (subdomain && subdomain !== cleanHost) {
    if (hasTenantThemeOverrideInState(state, subdomain) || hasBrandingDefinitionInState(state, subdomain)) {
      return subdomain;
    }
  }

  return cleanHost;
}

export function checkBrandingPermission(
  tenantId: string,
  token: unknown,
  operation: 'read' | 'write' = 'write',
): BrandingPermissionCheckResult {
  if (token === null || typeof token !== 'object') {
    return {
      kind: 'DENIED',
      error: { kind: 'FORBIDDEN', message: 'Tenant-scoped permission required' },
    };
  }

  const tokenRecord = token as Record<string, unknown>;
  const tokenTenantId = tokenRecord.tenantId ?? tokenRecord.tenant;
  if (typeof tokenTenantId !== 'string' || (tokenTenantId !== tenantId && tokenTenantId !== '*')) {
    return {
      kind: 'DENIED',
      error: { kind: 'FORBIDDEN', message: 'Tenant-scoped permission required' },
    };
  }

  const permissions: string[] = [];
  if (Array.isArray(tokenRecord.permissions)) {
    for (const p of tokenRecord.permissions) {
      if (typeof p === 'string') {
        permissions.push(p);
      }
    }
  }
  if (Array.isArray(tokenRecord.scopes)) {
    for (const s of tokenRecord.scopes) {
      if (typeof s === 'string') {
        permissions.push(s);
      }
    }
  }
  if (typeof tokenRecord.permission === 'string') {
    permissions.push(tokenRecord.permission);
  }
  if (typeof tokenRecord.scope === 'string') {
    permissions.push(tokenRecord.scope);
  }

  const hasRead =
    permissions.includes('configuration:read') ||
    permissions.includes('branding:read') ||
    permissions.includes('read') ||
    permissions.includes('*') ||
    permissions.includes('admin') ||
    permissions.includes('configuration:write') ||
    permissions.includes('branding:write');

  const hasWrite =
    permissions.includes('configuration:write') ||
    permissions.includes('branding:write') ||
    permissions.includes('write') ||
    permissions.includes('*') ||
    permissions.includes('admin');

  if (operation === 'read') {
    if (!hasRead) {
      return {
        kind: 'DENIED',
        error: {
          kind: 'FORBIDDEN',
          message: 'Configuration read permission required',
        },
      };
    }
    return { kind: 'GRANTED' };
  }

  if (operation === 'write') {
    if (!hasWrite) {
      return {
        kind: 'DENIED',
        error: {
          kind: 'FORBIDDEN',
          message: 'Configuration write permission required',
        },
      };
    }
    return { kind: 'GRANTED' };
  }

  return {
    kind: 'DENIED',
    error: {
      kind: 'FORBIDDEN',
      message: 'Unknown operation for permission check',
    },
  };
}

export function validateBrandingDefinition(
  definition: unknown,
): BrandingValidationResult {
  if (definition === null || typeof definition !== 'object') {
    return {
      kind: 'VALIDATION_ERROR',
      message: 'Branding definition must be an object',
    };
  }

  const def = definition as Record<string, unknown>;

  if (typeof def.applicationName !== 'string') {
    return {
      kind: 'VALIDATION_ERROR',
      message: 'applicationName must be a string',
    };
  }

  if (
    typeof def.themeSelection !== 'string' ||
    !BrandingAndThemingThemeSelection.includes(
      def.themeSelection as BrandingAndThemingThemeSelection,
    )
  ) {
    return {
      kind: 'VALIDATION_ERROR',
      message: 'themeSelection must be one of system, light, dark',
    };
  }

  return {
    kind: 'SUCCESS',
    definition: {
      applicationName: def.applicationName,
      themeSelection: def.themeSelection as BrandingAndThemingThemeSelection,
    },
  };
}

export function resolveEffectiveTheme(
  tenantId: string | null,
  state: BrandingAndThemingState,
): EffectiveTheme {
  const fallbackDefault = {
    primaryColor: '#0066cc',
    secondaryColor: '#004499',
    backgroundColor: '#ffffff',
    textColor: '#000000',
  };
  const baseDefault = state && state.defaultTheme ? state.defaultTheme : fallbackDefault;

  if (tenantId === null) {
    return { ...baseDefault };
  }

  const override = getTenantThemeOverrideFromState(state, tenantId);
  if (!override) {
    return { ...baseDefault };
  }

  return {
    primaryColor: override.primaryColor ?? baseDefault.primaryColor,
    secondaryColor: override.secondaryColor ?? baseDefault.secondaryColor,
    backgroundColor: override.backgroundColor ?? baseDefault.backgroundColor,
    textColor: override.textColor ?? baseDefault.textColor,
  };
}

export function getEffectiveTheme(
  host: string,
  state: BrandingAndThemingState,
): ThemeReadResult {
  const fallbackDefault = {
    primaryColor: '#0066cc',
    secondaryColor: '#004499',
    backgroundColor: '#ffffff',
    textColor: '#000000',
  };
  const baseDefault = state && state.defaultTheme ? state.defaultTheme : fallbackDefault;

  try {
    const tenantId = resolveTenantFromHost(host, state);
    if (tenantId === null) {
      return { kind: 'FALLBACK', theme: { ...baseDefault } };
    }

    const hasOverride = hasTenantThemeOverrideInState(state, tenantId);
    const theme = resolveEffectiveTheme(tenantId, state);

    if (!hasOverride) {
      return { kind: 'FALLBACK', theme };
    }
    return { kind: 'SUCCESS', theme };
  } catch {
    return { kind: 'FALLBACK', theme: { ...baseDefault } };
  }
}

export const readBootstrapTheme = getEffectiveTheme;
export const bootstrapThemeRead = getEffectiveTheme;
export const readTheme = getEffectiveTheme;
export const getBootstrapTheme = getEffectiveTheme;

export function listBrandingDefinitions(
  tenantId: string,
  token: unknown,
  state: BrandingAndThemingState,
): BrandingListResult {
  const permissionCheck = checkBrandingPermission(tenantId, token, 'read');
  if (permissionCheck.kind === 'DENIED') {
    return { kind: 'ERROR', error: permissionCheck.error };
  }

  const definition = getBrandingDefinitionFromState(state, tenantId);
  return {
    kind: 'SUCCESS',
    definitions: definition ? [definition] : [],
  };
}

export function createBrandingDefinition(
  tenantId: string,
  definition: unknown,
  token: unknown,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => BrandingAndThemingError | null,
): BrandingMutationResult {
  const permissionCheck = checkBrandingPermission(tenantId, token, 'write');
  if (permissionCheck.kind === 'DENIED') {
    return { kind: 'ERROR', error: permissionCheck.error };
  }

  if (isTenantNonOverridable(tenantId, state)) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'NON_OVERRIDABLE',
        message: 'Branding definition is non-overridable for tenant',
      },
    };
  }

  const validation = validateBrandingDefinition(definition);
  if (validation.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validation };
  }

  const currentDef = getBrandingDefinitionFromState(state, tenantId);
  if (currentDef !== undefined) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'NON_OVERRIDABLE',
        message: 'Branding definition already exists for tenant',
      },
    };
  }

  const auditEvent: AuditEvent = {
    action: 'value-changed',
    tenantId,
    key: 'brandingDefinition',
    previousValue: null,
    newValue: validation.definition,
  };

  try {
    const auditError = audit(auditEvent);
    if (auditError !== null) {
      return { kind: 'ERROR', error: auditError };
    }
  } catch (err) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'CONFIGURATION_ERROR',
        message: err instanceof Error ? err.message : 'Audit execution failed',
      },
    };
  }

  const newState = setBrandingDefinitionInState(state, tenantId, validation.definition);
  return { kind: 'SUCCESS', newState, state: newState };
}

export function patchBrandingDefinition(
  tenantId: string,
  partialDefinition: Partial<BrandingDefinition>,
  token: unknown,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => BrandingAndThemingError | null,
): BrandingMutationResult {
  const permissionCheck = checkBrandingPermission(tenantId, token, 'write');
  if (permissionCheck.kind === 'DENIED') {
    return { kind: 'ERROR', error: permissionCheck.error };
  }

  if (isTenantNonOverridable(tenantId, state)) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'NON_OVERRIDABLE',
        message: 'Branding definition is non-overridable for tenant',
      },
    };
  }

  const currentDef = getBrandingDefinitionFromState(state, tenantId);
  if (currentDef === undefined) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'UNKNOWN_KEY',
        message: 'No branding definition exists for tenant',
      },
    };
  }

  if (partialDefinition === null || typeof partialDefinition !== 'object') {
    return {
      kind: 'ERROR',
      error: {
        kind: 'VALIDATION_ERROR',
        message: 'Partial definition must be an object',
      },
    };
  }

  const mergedDefinition: BrandingDefinition = {
    applicationName:
      partialDefinition.applicationName !== undefined
        ? partialDefinition.applicationName
        : currentDef.applicationName,
    themeSelection:
      partialDefinition.themeSelection !== undefined
        ? partialDefinition.themeSelection
        : currentDef.themeSelection,
  };

  const validation = validateBrandingDefinition(mergedDefinition);
  if (validation.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validation };
  }

  const auditEvent: AuditEvent = {
    action: 'value-changed',
    tenantId,
    key: 'brandingDefinition',
    previousValue: currentDef,
    newValue: validation.definition,
  };

  try {
    const auditError = audit(auditEvent);
    if (auditError !== null) {
      return { kind: 'ERROR', error: auditError };
    }
  } catch (err) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'CONFIGURATION_ERROR',
        message: err instanceof Error ? err.message : 'Audit execution failed',
      },
    };
  }

  const newState = setBrandingDefinitionInState(state, tenantId, validation.definition);
  return { kind: 'SUCCESS', newState, state: newState };
}

export function deleteBrandingDefinition(
  tenantId: string,
  token: unknown,
  state: BrandingAndThemingState,
  audit: (event: AuditEvent) => BrandingAndThemingError | null,
): BrandingMutationResult {
  const permissionCheck = checkBrandingPermission(tenantId, token, 'write');
  if (permissionCheck.kind === 'DENIED') {
    return { kind: 'ERROR', error: permissionCheck.error };
  }

  if (isTenantNonOverridable(tenantId, state)) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'NON_OVERRIDABLE',
        message: 'Branding definition is non-overridable for tenant',
      },
    };
  }

  const currentDef = getBrandingDefinitionFromState(state, tenantId);
  if (currentDef === undefined) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'UNKNOWN_KEY',
        message: 'No branding definition exists for tenant',
      },
    };
  }

  const auditEvent: AuditEvent = {
    action: 'value-cleared',
    tenantId,
    key: 'brandingDefinition',
    previousValue: currentDef,
    newValue: null,
  };

  try {
    const auditError = audit(auditEvent);
    if (auditError !== null) {
      return { kind: 'ERROR', error: auditError };
    }
  } catch (err) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'CONFIGURATION_ERROR',
        message: err instanceof Error ? err.message : 'Audit execution failed',
      },
    };
  }

  const newState = setBrandingDefinitionInState(state, tenantId, null);
  return { kind: 'SUCCESS', newState, state: newState };
}

export const configurationStoreAdapter: ConfigurationStorePort = {
  getEffectiveTheme,
  readBootstrapTheme: getEffectiveTheme,
  bootstrapThemeRead: getEffectiveTheme,
  readTheme: getEffectiveTheme,
  listBrandingDefinitions,
  patchBrandingDefinition,
  deleteBrandingDefinition,
  createBrandingDefinition,
  list: listBrandingDefinitions,
  patch: patchBrandingDefinition,
  delete: deleteBrandingDefinition,
};