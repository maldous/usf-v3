export const BrandingAndThemingThemeSelection = ['system', 'light', 'dark'] as const;
export type BrandingAndThemingThemeSelection = typeof BrandingAndThemingThemeSelection[number];

export const BrandingAndThemingAuditAction = ['value-changed', 'value-cleared'] as const;
export type BrandingAndThemingAuditAction = typeof BrandingAndThemingAuditAction[number];

export const BrandingAndThemingAuditEventKind = ['value-changed', 'value-cleared', 'AUDIT_BEFORE_CHANGE'] as const;
export type BrandingAndThemingAuditEventKind = typeof BrandingAndThemingAuditEventKind[number];

export const BrandingAndThemingErrorKind = [
  'VALIDATION_ERROR',
  'VALIDATION',
  'FORBIDDEN',
  'UNKNOWN_KEY',
  'NON_OVERRIDABLE',
  'CONFIGURATION_ERROR',
  'AUDIT_FAILURE',
] as const;
export type BrandingAndThemingErrorKind = typeof BrandingAndThemingErrorKind[number];

export const BrandingAndThemingReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type BrandingAndThemingReadiness = typeof BrandingAndThemingReadiness[number];

export const BrandingAndThemingProof = ['hermetic', 'runtime', 'pending'] as const;
export type BrandingAndThemingProof = typeof BrandingAndThemingProof[number];

export const BrandingAndThemingProofLineage = ['hermetic', 'runtime'] as const;
export type BrandingAndThemingProofLineage = typeof BrandingAndThemingProofLineage[number];

export const BrandingAndThemingProofStatus = ['pending', 'fresh-pending', 'verified'] as const;
export type BrandingAndThemingProofStatus = typeof BrandingAndThemingProofStatus[number];

export interface BrandingAndThemingError {
  readonly kind: BrandingAndThemingErrorKind;
  readonly message: string;
  readonly statusCode?: number;
}

export interface DefaultTheme {
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly backgroundColor: string;
  readonly textColor: string;
}
export type BrandingAndThemingDefaultTheme = DefaultTheme;

export interface TenantThemeOverride {
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly backgroundColor?: string;
  readonly textColor?: string;
}
export type BrandingAndThemingTenantThemeOverride = TenantThemeOverride;

export interface BrandingDefinition {
  readonly applicationName: string;
  readonly themeSelection: BrandingAndThemingThemeSelection;
}
export type BrandingAndThemingBrandingDefinition = BrandingDefinition;
export type BrandingAndThemingDefinition = BrandingDefinition;

export interface EffectiveTheme {
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly backgroundColor: string;
  readonly textColor: string;
}
export type BrandingAndThemingEffectiveTheme = EffectiveTheme;

export interface AuditEvent {
  readonly action: BrandingAndThemingAuditAction;
  readonly tenantId: string;
  readonly key: string;
  readonly previousValue: unknown;
  readonly newValue: unknown;
  readonly timestamp?: string;
}
export type BrandingAndThemingAuditEvent = AuditEvent;

export interface BrandingAndThemingState {
  readonly defaultTheme: DefaultTheme;
  readonly tenantThemeOverrides:
    | ReadonlyMap<string, TenantThemeOverride>
    | Readonly<Record<string, TenantThemeOverride>>;
  readonly brandingDefinitions:
    | ReadonlyMap<string, BrandingDefinition>
    | Readonly<Record<string, BrandingDefinition>>;
  readonly hostTenantMappings?:
    | ReadonlyMap<string, string>
    | Readonly<Record<string, string>>;
  readonly hostMappings?:
    | ReadonlyMap<string, string>
    | Readonly<Record<string, string>>;
  readonly nonOverridableTenants?: ReadonlySet<string> | readonly string[];
  readonly nonOverridableKeys?: ReadonlySet<string> | readonly string[];
  readonly lastError?: BrandingAndThemingError | null;
  readonly readiness: BrandingAndThemingReadiness;
}

export const initialState: BrandingAndThemingState = {
  defaultTheme: {
    primaryColor: '#0066cc',
    secondaryColor: '#004499',
    backgroundColor: '#ffffff',
    textColor: '#000000',
  },
  tenantThemeOverrides: new Map<string, TenantThemeOverride>(),
  brandingDefinitions: new Map<string, BrandingDefinition>(),
  lastError: null,
  readiness: 'READY',
};

export type ThemeReadResult =
  | {
      readonly kind: 'SUCCESS';
      readonly theme: EffectiveTheme;
      readonly primaryColor: string;
      readonly secondaryColor: string;
      readonly backgroundColor: string;
      readonly textColor: string;
      readonly isDefault: boolean;
      readonly fallback: boolean;
    }
  | {
      readonly kind: 'FALLBACK';
      readonly theme: EffectiveTheme;
      readonly primaryColor: string;
      readonly secondaryColor: string;
      readonly backgroundColor: string;
      readonly textColor: string;
      readonly isDefault: boolean;
      readonly fallback: boolean;
    };
export type BrandingAndThemingThemeReadResult = ThemeReadResult;

export type BrandingListResult =
  | {
      readonly kind: 'SUCCESS';
      readonly definitions: readonly BrandingDefinition[];
      readonly error?: null;
    }
  | {
      readonly kind: 'ERROR';
      readonly error: BrandingAndThemingError;
      readonly definitions?: readonly [];
    };
export type BrandingAndThemingListResult = BrandingListResult;

export type BrandingMutationResult =
  | {
      readonly kind: 'SUCCESS';
      readonly newState: BrandingAndThemingState;
      readonly state: BrandingAndThemingState;
      readonly definition?: BrandingDefinition | null;
      readonly error?: null;
    }
  | {
      readonly kind: 'ERROR';
      readonly error: BrandingAndThemingError;
      readonly newState?: undefined;
      readonly state?: undefined;
      readonly definition?: undefined;
    };
export type BrandingAndThemingMutationResult = BrandingMutationResult;

export type BrandingPermissionCheckResult =
  | { readonly kind: 'GRANTED'; readonly granted: true; readonly error?: null }
  | { readonly kind: 'DENIED'; readonly granted: false; readonly error: BrandingAndThemingError };
export type BrandingAndThemingPermissionCheckResult = BrandingPermissionCheckResult;

export type BrandingValidationSuccess = {
  readonly kind: 'SUCCESS';
  readonly valid: true;
  readonly definition: BrandingDefinition;
  readonly error?: null;
};

export type BrandingValidationFailure = {
  readonly kind: 'VALIDATION_ERROR' | 'VALIDATION';
  readonly valid: false;
  readonly message: string;
  readonly error: BrandingAndThemingError;
};

export type BrandingValidationResult =
  | BrandingValidationSuccess
  | BrandingValidationFailure;
export type BrandingAndThemingValidationResult = BrandingValidationResult;

export interface ConfigurationStorePort {
  readonly getEffectiveTheme: (
    hostOrState: string | BrandingAndThemingState,
    stateOrHost?: string | BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly readBootstrapTheme: (
    hostOrState: string | BrandingAndThemingState,
    stateOrHost?: string | BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly bootstrapThemeRead: (
    hostOrState: string | BrandingAndThemingState,
    stateOrHost?: string | BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly readTheme: (
    hostOrState: string | BrandingAndThemingState,
    stateOrHost?: string | BrandingAndThemingState,
  ) => ThemeReadResult;
  readonly listBrandingDefinitions: (
    tenantIdOrState: string | BrandingAndThemingState,
    tokenOrTenantId?: unknown,
    stateOrToken?: unknown,
  ) => BrandingListResult;
  readonly patchBrandingDefinition: (
    arg1: unknown,
    arg2?: unknown,
    arg3?: unknown,
    arg4?: unknown,
    arg5?: unknown,
  ) => BrandingMutationResult;
  readonly deleteBrandingDefinition: (
    arg1: unknown,
    arg2?: unknown,
    arg3?: unknown,
    arg4?: unknown,
  ) => BrandingMutationResult;
  readonly createBrandingDefinition: (
    arg1: unknown,
    arg2?: unknown,
    arg3?: unknown,
    arg4?: unknown,
    arg5?: unknown,
  ) => BrandingMutationResult;
  readonly list: (
    tenantIdOrState: string | BrandingAndThemingState,
    tokenOrTenantId?: unknown,
    stateOrToken?: unknown,
  ) => BrandingListResult;
  readonly patch: (
    arg1: unknown,
    arg2?: unknown,
    arg3?: unknown,
    arg4?: unknown,
    arg5?: unknown,
  ) => BrandingMutationResult;
  readonly delete: (
    arg1: unknown,
    arg2?: unknown,
    arg3?: unknown,
    arg4?: unknown,
  ) => BrandingMutationResult;
}
export type BrandingAndThemingConfigurationStorePort = ConfigurationStorePort;

function isBrandingAndThemingState(value: unknown): value is BrandingAndThemingState {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return 'defaultTheme' in rec || 'tenantThemeOverrides' in rec || 'brandingDefinitions' in rec;
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
      lastError: null,
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
      lastError: null,
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

export function mapErrorToStatusCode(error: BrandingAndThemingError): number {
  switch (error.kind) {
    case 'FORBIDDEN':
      return 403;
    case 'UNKNOWN_KEY':
      return 404;
    case 'VALIDATION':
    case 'VALIDATION_ERROR':
      return 400;
    case 'NON_OVERRIDABLE':
      return 409;
    case 'AUDIT_FAILURE':
    case 'CONFIGURATION_ERROR':
    default:
      return 500;
  }
}

export function getReadiness(state?: BrandingAndThemingState): BrandingAndThemingReadiness {
  if (!state || !state.readiness) {
    return 'READY';
  }
  return state.readiness;
}
export const checkReadiness = getReadiness;

export function resolveTenantFromHost(
  host: string | null | undefined,
  state: BrandingAndThemingState = initialState,
): string | null {
  if (typeof host !== 'string' || host.trim() === '') {
    return null;
  }
  const cleanHost = host.trim();

  if ('hostTenantMappings' in state && state.hostTenantMappings) {
    const mappings = state.hostTenantMappings;
    if (mappings instanceof Map && mappings.has(cleanHost)) {
      const mapped = mappings.get(cleanHost);
      return typeof mapped === 'string' ? mapped : null;
    }
    if (typeof mappings === 'object' && mappings !== null && cleanHost in mappings) {
      const mapped = (mappings as Record<string, string>)[cleanHost];
      return typeof mapped === 'string' ? mapped : null;
    }
  }

  if ('hostMappings' in state && state.hostMappings) {
    const mappings = state.hostMappings;
    if (mappings instanceof Map && mappings.has(cleanHost)) {
      const mapped = mappings.get(cleanHost);
      return typeof mapped === 'string' ? mapped : null;
    }
    if (typeof mappings === 'object' && mappings !== null && cleanHost in mappings) {
      const mapped = (mappings as Record<string, string>)[cleanHost];
      return typeof mapped === 'string' ? mapped : null;
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
      granted: false,
      error: {
        kind: 'FORBIDDEN',
        message: 'Tenant-scoped permission required',
        statusCode: 403,
      },
    };
  }

  const tokenRecord = token as Record<string, unknown>;
  const tokenTenantId = tokenRecord.tenantId ?? tokenRecord.tenant ?? tokenRecord.sub;
  if (typeof tokenTenantId !== 'string' || (tokenTenantId !== tenantId && tokenTenantId !== '*')) {
    return {
      kind: 'DENIED',
      granted: false,
      error: {
        kind: 'FORBIDDEN',
        message: 'Tenant-scoped permission required',
        statusCode: 403,
      },
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
        granted: false,
        error: {
          kind: 'FORBIDDEN',
          message: 'Configuration read permission required',
          statusCode: 403,
        },
      };
    }
    return { kind: 'GRANTED', granted: true };
  }

  if (operation === 'write') {
    if (!hasWrite) {
      return {
        kind: 'DENIED',
        granted: false,
        error: {
          kind: 'FORBIDDEN',
          message: 'Configuration write permission required',
          statusCode: 403,
        },
      };
    }
    return { kind: 'GRANTED', granted: true };
  }

  return {
    kind: 'DENIED',
    granted: false,
    error: {
      kind: 'FORBIDDEN',
      message: 'Unknown operation for permission check',
      statusCode: 403,
    },
  };
}
export const checkPermission = checkBrandingPermission;

export function validateThemeSelection(themeSelection: unknown): boolean {
  return (
    typeof themeSelection === 'string' &&
    (BrandingAndThemingThemeSelection as readonly string[]).includes(themeSelection)
  );
}

export function validateApplicationName(applicationName: unknown): boolean {
  return typeof applicationName === 'string';
}

export function validateBrandingDefinition(
  definition: unknown,
): BrandingValidationResult {
  if (definition === null || typeof definition !== 'object') {
    const error: BrandingAndThemingError = {
      kind: 'VALIDATION_ERROR',
      message: 'Branding definition must be an object',
      statusCode: 400,
    };
    return {
      kind: 'VALIDATION_ERROR',
      valid: false,
      message: error.message,
      error,
    };
  }

  const def = definition as Record<string, unknown>;

  if (typeof def.applicationName !== 'string') {
    const error: BrandingAndThemingError = {
      kind: 'VALIDATION_ERROR',
      message: 'applicationName must be a string',
      statusCode: 400,
    };
    return {
      kind: 'VALIDATION_ERROR',
      valid: false,
      message: error.message,
      error,
    };
  }

  if (
    typeof def.themeSelection !== 'string' ||
    !(BrandingAndThemingThemeSelection as readonly string[]).includes(def.themeSelection)
  ) {
    const error: BrandingAndThemingError = {
      kind: 'VALIDATION_ERROR',
      message: 'themeSelection must be one of system, light, dark',
      statusCode: 400,
    };
    return {
      kind: 'VALIDATION_ERROR',
      valid: false,
      message: error.message,
      error,
    };
  }

  return {
    kind: 'SUCCESS',
    valid: true,
    definition: {
      applicationName: def.applicationName,
      themeSelection: def.themeSelection as BrandingAndThemingThemeSelection,
    },
  };
}
export const validateDefinition = validateBrandingDefinition;

export function resolveEffectiveTheme(
  tenantId: string | null,
  state: BrandingAndThemingState = initialState,
): EffectiveTheme {
  const fallbackDefault: DefaultTheme = {
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
  arg1: string | BrandingAndThemingState,
  arg2?: string | BrandingAndThemingState,
): ThemeReadResult {
  let host = '';
  let state: BrandingAndThemingState = initialState;

  if (typeof arg1 === 'string') {
    host = arg1;
    if (isBrandingAndThemingState(arg2)) {
      state = arg2;
    }
  } else if (isBrandingAndThemingState(arg1)) {
    state = arg1;
    if (typeof arg2 === 'string') {
      host = arg2;
    }
  }

  const fallbackDefault: DefaultTheme = {
    primaryColor: '#0066cc',
    secondaryColor: '#004499',
    backgroundColor: '#ffffff',
    textColor: '#000000',
  };
  const baseDefault = state && state.defaultTheme ? state.defaultTheme : fallbackDefault;

  try {
    const tenantId = resolveTenantFromHost(host, state);
    if (tenantId === null) {
      const theme = { ...baseDefault };
      return {
        kind: 'FALLBACK',
        theme,
        primaryColor: theme.primaryColor,
        secondaryColor: theme.secondaryColor,
        backgroundColor: theme.backgroundColor,
        textColor: theme.textColor,
        isDefault: true,
        fallback: true,
      };
    }

    const hasOverride = hasTenantThemeOverrideInState(state, tenantId);
    const theme = resolveEffectiveTheme(tenantId, state);

    if (!hasOverride) {
      return {
        kind: 'FALLBACK',
        theme,
        primaryColor: theme.primaryColor,
        secondaryColor: theme.secondaryColor,
        backgroundColor: theme.backgroundColor,
        textColor: theme.textColor,
        isDefault: true,
        fallback: true,
      };
    }

    return {
      kind: 'SUCCESS',
      theme,
      primaryColor: theme.primaryColor,
      secondaryColor: theme.secondaryColor,
      backgroundColor: theme.backgroundColor,
      textColor: theme.textColor,
      isDefault: false,
      fallback: false,
    };
  } catch {
    const theme = { ...baseDefault };
    return {
      kind: 'FALLBACK',
      theme,
      primaryColor: theme.primaryColor,
      secondaryColor: theme.secondaryColor,
      backgroundColor: theme.backgroundColor,
      textColor: theme.textColor,
      isDefault: true,
      fallback: true,
    };
  }
}

export function readBootstrapTheme(
  arg1: string | BrandingAndThemingState,
  arg2?: string | BrandingAndThemingState,
): ThemeReadResult {
  return getEffectiveTheme(arg1, arg2);
}
export function bootstrapThemeRead(
  arg1: string | BrandingAndThemingState,
  arg2?: string | BrandingAndThemingState,
): ThemeReadResult {
  return getEffectiveTheme(arg1, arg2);
}
export function readTheme(
  arg1: string | BrandingAndThemingState,
  arg2?: string | BrandingAndThemingState,
): ThemeReadResult {
  return getEffectiveTheme(arg1, arg2);
}
export const getBootstrapTheme = readBootstrapTheme;

export function listBrandingDefinitions(
  arg1: string | BrandingAndThemingState,
  arg2?: unknown,
  arg3?: unknown,
): BrandingListResult {
  let tenantId = '';
  let token: unknown = null;
  let state: BrandingAndThemingState = initialState;

  if (typeof arg1 === 'string') {
    tenantId = arg1;
    token = arg2;
    if (isBrandingAndThemingState(arg3)) {
      state = arg3;
    }
  } else if (isBrandingAndThemingState(arg1)) {
    state = arg1;
    if (typeof arg2 === 'string') {
      tenantId = arg2;
      token = arg3;
    }
  }

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
export const list = listBrandingDefinitions;

export function createBrandingDefinition(
  arg1: unknown,
  arg2?: unknown,
  arg3?: unknown,
  arg4?: unknown,
  arg5?: unknown,
): BrandingMutationResult {
  let state: BrandingAndThemingState = initialState;
  let tenantId = '';
  let definition: unknown = null;
  let token: unknown = null;
  let audit: ((event: AuditEvent) => BrandingAndThemingError | null) | null = null;

  const args = [arg1, arg2, arg3, arg4, arg5];
  for (const a of args) {
    if (typeof a === 'function') {
      audit = a as (event: AuditEvent) => BrandingAndThemingError | null;
    } else if (isBrandingAndThemingState(a)) {
      state = a;
    } else if (typeof a === 'string' && tenantId === '') {
      tenantId = a;
    } else if (a !== null && typeof a === 'object' && definition === null && !('tenantId' in a) && !('permissions' in a)) {
      definition = a;
    } else if (token === null && a !== undefined) {
      token = a;
    }
  }

  if (typeof arg1 === 'string') {
    tenantId = arg1;
    definition = arg2;
    token = arg3;
    if (isBrandingAndThemingState(arg4)) {
      state = arg4;
      if (typeof arg5 === 'function') {
        audit = arg5 as (event: AuditEvent) => BrandingAndThemingError | null;
      }
    } else if (typeof arg4 === 'function') {
      audit = arg4 as (event: AuditEvent) => BrandingAndThemingError | null;
    }
  }

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
        statusCode: 409,
      },
    };
  }

  const validation = validateBrandingDefinition(definition);
  if (validation.kind !== 'SUCCESS') {
    return { kind: 'ERROR', error: validation.error };
  }

  const currentDef = getBrandingDefinitionFromState(state, tenantId);
  if (currentDef !== undefined) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'NON_OVERRIDABLE',
        message: 'Branding definition already exists for tenant',
        statusCode: 409,
      },
    };
  }

  const auditEvent: AuditEvent = {
    action: 'value-changed',
    tenantId,
    key: 'brandingDefinition',
    previousValue: null,
    newValue: validation.definition,
    timestamp: new Date().toISOString(),
  };

  if (audit !== null) {
    try {
      const auditError = audit(auditEvent);
      if (auditError !== null) {
        return {
          kind: 'ERROR',
          error: {
            kind: auditError.kind ?? 'AUDIT_FAILURE',
            message: auditError.message ?? 'Audit execution rejected change',
            statusCode: auditError.statusCode ?? 403,
          },
        };
      }
    } catch (err) {
      return {
        kind: 'ERROR',
        error: {
          kind: 'AUDIT_FAILURE',
          message: err instanceof Error ? err.message : 'Audit execution failed',
          statusCode: 403,
        },
      };
    }
  }

  const newState = setBrandingDefinitionInState(state, tenantId, validation.definition);
  return {
    kind: 'SUCCESS',
    newState,
    state: newState,
    definition: validation.definition,
  };
}
export const create = createBrandingDefinition;

export function patchBrandingDefinition(
  arg1: unknown,
  arg2?: unknown,
  arg3?: unknown,
  arg4?: unknown,
  arg5?: unknown,
): BrandingMutationResult {
  let state: BrandingAndThemingState = initialState;
  let tenantId = '';
  let partialDefinition: Partial<BrandingDefinition> | null = null;
  let token: unknown = null;
  let audit: ((event: AuditEvent) => BrandingAndThemingError | null) | null = null;

  if (typeof arg1 === 'string') {
    tenantId = arg1;
    partialDefinition = (arg2 && typeof arg2 === 'object' ? arg2 : null) as Partial<BrandingDefinition> | null;
    token = arg3;
    if (isBrandingAndThemingState(arg4)) {
      state = arg4;
      if (typeof arg5 === 'function') {
        audit = arg5 as (event: AuditEvent) => BrandingAndThemingError | null;
      }
    } else if (typeof arg4 === 'function') {
      audit = arg4 as (event: AuditEvent) => BrandingAndThemingError | null;
      if (isBrandingAndThemingState(arg5)) {
        state = arg5;
      }
    }
  } else if (isBrandingAndThemingState(arg1)) {
    state = arg1;
    if (typeof arg2 === 'string') {
      tenantId = arg2;
      partialDefinition = (arg3 && typeof arg3 === 'object' ? arg3 : null) as Partial<BrandingDefinition> | null;
      token = arg4;
      if (typeof arg5 === 'function') {
        audit = arg5 as (event: AuditEvent) => BrandingAndThemingError | null;
      }
    }
  }

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
        statusCode: 409,
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
        statusCode: 404,
      },
    };
  }

  if (partialDefinition === null || typeof partialDefinition !== 'object') {
    return {
      kind: 'ERROR',
      error: {
        kind: 'VALIDATION_ERROR',
        message: 'Partial definition must be an object',
        statusCode: 400,
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
    return { kind: 'ERROR', error: validation.error };
  }

  const auditEvent: AuditEvent = {
    action: 'value-changed',
    tenantId,
    key: 'brandingDefinition',
    previousValue: currentDef,
    newValue: validation.definition,
    timestamp: new Date().toISOString(),
  };

  if (audit !== null) {
    try {
      const auditError = audit(auditEvent);
      if (auditError !== null) {
        return {
          kind: 'ERROR',
          error: {
            kind: auditError.kind ?? 'AUDIT_FAILURE',
            message: auditError.message ?? 'Audit execution rejected change',
            statusCode: auditError.statusCode ?? 403,
          },
        };
      }
    } catch (err) {
      return {
        kind: 'ERROR',
        error: {
          kind: 'AUDIT_FAILURE',
          message: err instanceof Error ? err.message : 'Audit execution failed',
          statusCode: 403,
        },
      };
    }
  }

  const newState = setBrandingDefinitionInState(state, tenantId, validation.definition);
  return {
    kind: 'SUCCESS',
    newState,
    state: newState,
    definition: validation.definition,
  };
}
export const patch = patchBrandingDefinition;

export function deleteBrandingDefinition(
  arg1: unknown,
  arg2?: unknown,
  arg3?: unknown,
  arg4?: unknown,
): BrandingMutationResult {
  let state: BrandingAndThemingState = initialState;
  let tenantId = '';
  let token: unknown = null;
  let audit: ((event: AuditEvent) => BrandingAndThemingError | null) | null = null;

  if (typeof arg1 === 'string') {
    tenantId = arg1;
    token = arg2;
    if (isBrandingAndThemingState(arg3)) {
      state = arg3;
      if (typeof arg4 === 'function') {
        audit = arg4 as (event: AuditEvent) => BrandingAndThemingError | null;
      }
    } else if (typeof arg3 === 'function') {
      audit = arg3 as (event: AuditEvent) => BrandingAndThemingError | null;
      if (isBrandingAndThemingState(arg4)) {
        state = arg4;
      }
    }
  } else if (isBrandingAndThemingState(arg1)) {
    state = arg1;
    if (typeof arg2 === 'string') {
      tenantId = arg2;
      token = arg3;
      if (typeof arg4 === 'function') {
        audit = arg4 as (event: AuditEvent) => BrandingAndThemingError | null;
      }
    }
  }

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
        statusCode: 409,
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
        statusCode: 404,
      },
    };
  }

  const auditEvent: AuditEvent = {
    action: 'value-cleared',
    tenantId,
    key: 'brandingDefinition',
    previousValue: currentDef,
    newValue: null,
    timestamp: new Date().toISOString(),
  };

  if (audit !== null) {
    try {
      const auditError = audit(auditEvent);
      if (auditError !== null) {
        return {
          kind: 'ERROR',
          error: {
            kind: auditError.kind ?? 'AUDIT_FAILURE',
            message: auditError.message ?? 'Audit execution rejected change',
            statusCode: auditError.statusCode ?? 403,
          },
        };
      }
    } catch (err) {
      return {
        kind: 'ERROR',
        error: {
          kind: 'AUDIT_FAILURE',
          message: err instanceof Error ? err.message : 'Audit execution failed',
          statusCode: 403,
        },
      };
    }
  }

  const newState = setBrandingDefinitionInState(state, tenantId, null);
  return {
    kind: 'SUCCESS',
    newState,
    state: newState,
    definition: null,
  };
}
export const deleteDefinition = deleteBrandingDefinition;

export function createConfigurationStoreAdapter(
  initialAdapterState: BrandingAndThemingState = initialState,
): ConfigurationStorePort {
  let currentState: BrandingAndThemingState = initialAdapterState;

  const adapter: ConfigurationStorePort = {
    getEffectiveTheme: (
      hostOrState: string | BrandingAndThemingState,
      stateOrHost?: string | BrandingAndThemingState,
    ) => {
      if (typeof hostOrState === 'string') {
        const state = isBrandingAndThemingState(stateOrHost) ? stateOrHost : currentState;
        return getEffectiveTheme(hostOrState, state);
      }
      return getEffectiveTheme(hostOrState, stateOrHost);
    },
    readBootstrapTheme: (
      hostOrState: string | BrandingAndThemingState,
      stateOrHost?: string | BrandingAndThemingState,
    ) => {
      if (typeof hostOrState === 'string') {
        const state = isBrandingAndThemingState(stateOrHost) ? stateOrHost : currentState;
        return getEffectiveTheme(hostOrState, state);
      }
      return getEffectiveTheme(hostOrState, stateOrHost);
    },
    bootstrapThemeRead: (
      hostOrState: string | BrandingAndThemingState,
      stateOrHost?: string | BrandingAndThemingState,
    ) => {
      if (typeof hostOrState === 'string') {
        const state = isBrandingAndThemingState(stateOrHost) ? stateOrHost : currentState;
        return getEffectiveTheme(hostOrState, state);
      }
      return getEffectiveTheme(hostOrState, stateOrHost);
    },
    readTheme: (
      hostOrState: string | BrandingAndThemingState,
      stateOrHost?: string | BrandingAndThemingState,
    ) => {
      if (typeof hostOrState === 'string') {
        const state = isBrandingAndThemingState(stateOrHost) ? stateOrHost : currentState;
        return getEffectiveTheme(hostOrState, state);
      }
      return getEffectiveTheme(hostOrState, stateOrHost);
    },
    listBrandingDefinitions: (
      tenantIdOrState: string | BrandingAndThemingState,
      tokenOrTenantId?: unknown,
      stateOrToken?: unknown,
    ) => {
      if (typeof tenantIdOrState === 'string') {
        const state = isBrandingAndThemingState(stateOrToken) ? stateOrToken : currentState;
        return listBrandingDefinitions(tenantIdOrState, tokenOrTenantId, state);
      }
      return listBrandingDefinitions(tenantIdOrState, tokenOrTenantId, stateOrToken);
    },
    patchBrandingDefinition: (
      arg1: unknown,
      arg2?: unknown,
      arg3?: unknown,
      arg4?: unknown,
      arg5?: unknown,
    ) => {
      const result = patchBrandingDefinition(arg1, arg2, arg3, arg4 ?? currentState, arg5);
      if (result.kind === 'SUCCESS') {
        currentState = result.newState;
      }
      return result;
    },
    deleteBrandingDefinition: (
      arg1: unknown,
      arg2?: unknown,
      arg3?: unknown,
      arg4?: unknown,
    ) => {
      const result = deleteBrandingDefinition(arg1, arg2, arg3 ?? currentState, arg4);
      if (result.kind === 'SUCCESS') {
        currentState = result.newState;
      }
      return result;
    },
    createBrandingDefinition: (
      arg1: unknown,
      arg2?: unknown,
      arg3?: unknown,
      arg4?: unknown,
      arg5?: unknown,
    ) => {
      const result = createBrandingDefinition(arg1, arg2, arg3, arg4 ?? currentState, arg5);
      if (result.kind === 'SUCCESS') {
        currentState = result.newState;
      }
      return result;
    },
    list: (
      tenantIdOrState: string | BrandingAndThemingState,
      tokenOrTenantId?: unknown,
      stateOrToken?: unknown,
    ) => {
      if (typeof tenantIdOrState === 'string') {
        const state = isBrandingAndThemingState(stateOrToken) ? stateOrToken : currentState;
        return listBrandingDefinitions(tenantIdOrState, tokenOrTenantId, state);
      }
      return listBrandingDefinitions(tenantIdOrState, tokenOrTenantId, stateOrToken);
    },
    patch: (
      arg1: unknown,
      arg2?: unknown,
      arg3?: unknown,
      arg4?: unknown,
      arg5?: unknown,
    ) => {
      const result = patchBrandingDefinition(arg1, arg2, arg3, arg4 ?? currentState, arg5);
      if (result.kind === 'SUCCESS') {
        currentState = result.newState;
      }
      return result;
    },
    delete: (
      arg1: unknown,
      arg2?: unknown,
      arg3?: unknown,
      arg4?: unknown,
    ) => {
      const result = deleteBrandingDefinition(arg1, arg2, arg3 ?? currentState, arg4);
      if (result.kind === 'SUCCESS') {
        currentState = result.newState;
      }
      return result;
    },
  };

  return adapter;
}
export const createAdapter = createConfigurationStoreAdapter;

export const configurationStoreAdapter: ConfigurationStorePort = createConfigurationStoreAdapter();
export const brandingAndThemingConfigurationStoreAdapter: ConfigurationStorePort = configurationStoreAdapter;