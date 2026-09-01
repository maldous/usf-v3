export const ConfigurationRegistryAndHistoryOperationOutcome = [
  'NO_CONTENT',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'UNPROCESSABLE_ENTITY',
  'FORBIDDEN',
  'BAD_REQUEST',
] as const;
export type ConfigurationRegistryAndHistoryOperationOutcome = typeof ConfigurationRegistryAndHistoryOperationOutcome[number];

export const ConfigurationRegistryAndHistoryAuditEventKind = [
  'CONFIGURATION_CHANGE',
  'CONFIGURATION_CLEARED',
] as const;
export type ConfigurationRegistryAndHistoryAuditEventKind = typeof ConfigurationRegistryAndHistoryAuditEventKind[number];

export const ConfigurationRegistryAndHistoryErrorKind = [
  'AUDIT_FAILURE',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'UNPROCESSABLE_ENTITY',
  'FORBIDDEN',
  'BAD_REQUEST',
  'STORE_UNAVAILABLE',
] as const;
export type ConfigurationRegistryAndHistoryErrorKind = typeof ConfigurationRegistryAndHistoryErrorKind[number];

export const ConfigurationDefinitionLifecycle = [
  'ACTIVE',
  'DEPRECATED',
  'INTERNAL',
] as const;
export type ConfigurationDefinitionLifecycle = typeof ConfigurationDefinitionLifecycle[number];

export const ConfigurationValueSource = [
  'PLATFORM_DEFAULT',
  'TENANT_OVERRIDE',
] as const;
export type ConfigurationValueSource = typeof ConfigurationValueSource[number];

export const ConfigurationValueType = [
  'STRING',
  'ENUM',
  'BOOLEAN',
  'JSON',
] as const;
export type ConfigurationValueType = typeof ConfigurationValueType[number];

export interface ConfigurationDefinition {
  readonly key: string;
  readonly category: string;
  readonly valueType: ConfigurationValueType;
  readonly allowedValues: readonly string[] | null;
  readonly defaultValue: unknown;
  readonly tenantOverridable: boolean;
  readonly lifecycle: ConfigurationDefinitionLifecycle;
  readonly requiredReadPermission: string;
  readonly requiredWritePermission: string;
  readonly isFeatureFlag: boolean;
}

export interface TenantOverride {
  readonly tenantId: string;
  readonly key: string;
  readonly value: unknown;
}

export interface ConfigurationRegistryAndHistoryAuditEvent {
  readonly kind: ConfigurationRegistryAndHistoryAuditEventKind;
  readonly tenantId: string;
  readonly key: string;
  readonly value: unknown | null;
  readonly timestamp: string;
}

export interface ConfigurationRegistryAndHistoryError {
  readonly kind: ConfigurationRegistryAndHistoryErrorKind;
  readonly message: string;
}

export interface ConfigurationRegistryAndHistoryState {
  readonly definitions: readonly ConfigurationDefinition[];
  readonly tenantOverrides: readonly TenantOverride[];
  readonly lastAuditEvent: ConfigurationRegistryAndHistoryAuditEvent | null;
  readonly lastError: ConfigurationRegistryAndHistoryError | null;
  readonly storeReachable: boolean;
}

export interface ConfigurationEntry {
  readonly definition: ConfigurationDefinition;
  readonly effectiveValue: unknown;
  readonly source: ConfigurationValueSource;
}

export const initialState: ConfigurationRegistryAndHistoryState = {
  definitions: [],
  tenantOverrides: [],
  lastAuditEvent: null,
  lastError: null,
  storeReachable: false,
};

export function validateDefinition(
  definitions: readonly ConfigurationDefinition[],
  key: string,
  value: unknown,
): ConfigurationRegistryAndHistoryError | null {
  const definition = definitions.find((d) => d.key === key);
  if (definition === undefined) {
    return { kind: 'NOT_FOUND', message: `Unknown configuration key: ${key}` };
  }
  if (!definition.tenantOverridable) {
    return { kind: 'UNPROCESSABLE_ENTITY', message: `Definition ${key} is not overridable` };
  }
  if (value === null || value === undefined) {
    return { kind: 'VALIDATION_ERROR', message: 'Missing value' };
  }
  if (definition.valueType === 'ENUM' && definition.allowedValues !== null) {
    if (typeof value !== 'string' || !definition.allowedValues.includes(value)) {
      return { kind: 'VALIDATION_ERROR', message: `Value ${String(value)} not in allowed set` };
    }
  }
  if (definition.valueType === 'BOOLEAN' && typeof value !== 'boolean') {
    return { kind: 'VALIDATION_ERROR', message: 'Value must be boolean' };
  }
  if (definition.valueType === 'STRING' && typeof value !== 'string') {
    return { kind: 'VALIDATION_ERROR', message: 'Value must be string' };
  }
  if (definition.valueType === 'JSON') {
    try {
      JSON.stringify(value);
    } catch {
      return { kind: 'VALIDATION_ERROR', message: 'Value must be JSON-serializable' };
    }
  }
  return null;
}

export function emitAuditEvent(
  kind: ConfigurationRegistryAndHistoryAuditEventKind,
  tenantId: string,
  key: string,
  value: unknown | null,
  auditFn: (event: ConfigurationRegistryAndHistoryAuditEvent) => ConfigurationRegistryAndHistoryError | null,
): ConfigurationRegistryAndHistoryError | null {
  const event: ConfigurationRegistryAndHistoryAuditEvent = {
    kind,
    tenantId,
    key,
    value,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function listConfigurations(
  state: ConfigurationRegistryAndHistoryState,
  tenantId: string | null,
  categoryFilter: string | null,
  readPermission: string,
): {
  readonly result: readonly ConfigurationEntry[];
  readonly error: ConfigurationRegistryAndHistoryError | null;
  readonly outcome: ConfigurationRegistryAndHistoryOperationOutcome;
} {
  if (tenantId === null) {
    return {
      result: [],
      error: { kind: 'BAD_REQUEST', message: 'Tenant context required' },
      outcome: 'BAD_REQUEST',
    };
  }
  if (!state.storeReachable) {
    return {
      result: [],
      error: { kind: 'STORE_UNAVAILABLE', message: 'Store is unreachable' },
      outcome: 'BAD_REQUEST',
    };
  }

  const filteredDefinitions = state.definitions.filter(
    (d) => (categoryFilter === null || d.category === categoryFilter) && d.requiredReadPermission === readPermission,
  );

  const result: ConfigurationEntry[] = filteredDefinitions.map((definition) => {
    const override = state.tenantOverrides.find(
      (to) => to.tenantId === tenantId && to.key === definition.key,
    );
    if (override !== undefined) {
      return {
        definition,
        effectiveValue: override.value,
        source: 'TENANT_OVERRIDE',
      };
    }
    return {
      definition,
      effectiveValue: definition.defaultValue,
      source: 'PLATFORM_DEFAULT',
    };
  });

  return {
    result,
    error: null,
    outcome: 'NO_CONTENT',
  };
}

export function patchConfiguration(
  state: ConfigurationRegistryAndHistoryState,
  tenantId: string,
  key: string,
  value: unknown,
  writePermission: string,
  auditFn: (event: ConfigurationRegistryAndHistoryAuditEvent) => ConfigurationRegistryAndHistoryError | null,
): ConfigurationRegistryAndHistoryState | ConfigurationRegistryAndHistoryError {
  if (!state.storeReachable) {
    return { kind: 'STORE_UNAVAILABLE', message: 'Store is unreachable' };
  }

  const definition = state.definitions.find((d) => d.key === key);
  if (definition === undefined) {
    return { kind: 'NOT_FOUND', message: `Unknown configuration key: ${key}` };
  }
  if (definition.requiredWritePermission !== writePermission) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permission' };
  }

  const validationError = validateDefinition(state.definitions, key, value);
  if (validationError !== null) {
    return validationError;
  }

  const auditError = emitAuditEvent('CONFIGURATION_CHANGE', tenantId, key, value, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const existingOverrideIndex = state.tenantOverrides.findIndex(
    (to) => to.tenantId === tenantId && to.key === key,
  );
  const newOverrides = [...state.tenantOverrides];
  if (existingOverrideIndex >= 0) {
    newOverrides[existingOverrideIndex] = { tenantId, key, value };
  } else {
    newOverrides.push({ tenantId, key, value });
  }

  return {
    ...state,
    tenantOverrides: newOverrides,
    lastAuditEvent: {
      kind: 'CONFIGURATION_CHANGE',
      tenantId,
      key,
      value,
      timestamp: new Date().toISOString(),
    },
    lastError: null,
  };
}

export function deleteConfiguration(
  state: ConfigurationRegistryAndHistoryState,
  tenantId: string,
  key: string,
  writePermission: string,
  auditFn: (event: ConfigurationRegistryAndHistoryAuditEvent) => ConfigurationRegistryAndHistoryError | null,
): ConfigurationRegistryAndHistoryState | ConfigurationRegistryAndHistoryError {
  if (!state.storeReachable) {
    return { kind: 'STORE_UNAVAILABLE', message: 'Store is unreachable' };
  }

  const definition = state.definitions.find((d) => d.key === key);
  if (definition === undefined) {
    return { kind: 'NOT_FOUND', message: `Unknown configuration key: ${key}` };
  }
  if (definition.requiredWritePermission !== writePermission) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permission' };
  }
  if (!definition.tenantOverridable) {
    return { kind: 'UNPROCESSABLE_ENTITY', message: `Definition ${key} is not overridable` };
  }

  const auditError = emitAuditEvent('CONFIGURATION_CLEARED', tenantId, key, null, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newOverrides = state.tenantOverrides.filter(
    (to) => !(to.tenantId === tenantId && to.key === key),
  );

  return {
    ...state,
    tenantOverrides: newOverrides,
    lastAuditEvent: {
      kind: 'CONFIGURATION_CLEARED',
      tenantId,
      key,
      value: null,
      timestamp: new Date().toISOString(),
    },
    lastError: null,
  };
}

export function resolveEffectiveValue(
  state: ConfigurationRegistryAndHistoryState,
  tenantId: string | null,
  key: string,
  readPermission: string,
): {
  readonly entry: ConfigurationEntry | null;
  readonly error: ConfigurationRegistryAndHistoryError | null;
  readonly outcome: ConfigurationRegistryAndHistoryOperationOutcome;
} {
  if (tenantId === null) {
    return {
      entry: null,
      error: { kind: 'BAD_REQUEST', message: 'Tenant context required' },
      outcome: 'BAD_REQUEST',
    };
  }
  if (!state.storeReachable) {
    return {
      entry: null,
      error: { kind: 'STORE_UNAVAILABLE', message: 'Store is unreachable' },
      outcome: 'BAD_REQUEST',
    };
  }

  const definition = state.definitions.find((d) => d.key === key);
  if (definition === undefined) {
    return {
      entry: null,
      error: { kind: 'NOT_FOUND', message: `Unknown configuration key: ${key}` },
      outcome: 'NOT_FOUND',
    };
  }
  if (definition.requiredReadPermission !== readPermission) {
    return {
      entry: null,
      error: { kind: 'FORBIDDEN', message: 'Insufficient permission' },
      outcome: 'FORBIDDEN',
    };
  }

  const override = state.tenantOverrides.find(
    (to) => to.tenantId === tenantId && to.key === key,
  );

  const entry: ConfigurationEntry = override !== undefined
    ? {
        definition,
        effectiveValue: override.value,
        source: 'TENANT_OVERRIDE',
      }
    : {
        definition,
        effectiveValue: definition.defaultValue,
        source: 'PLATFORM_DEFAULT',
      };

  return {
    entry,
    error: null,
    outcome: 'NO_CONTENT',
  };
}