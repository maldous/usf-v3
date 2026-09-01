export const ProviderConfigurationPlaneLifecycleState = [
  'PROPOSED',
  'CONFIGURED',
  'READY',
  'DEGRADED',
  'DISABLED',
] as const;
export type ProviderConfigurationPlaneLifecycleState = typeof ProviderConfigurationPlaneLifecycleState[number];

export const ProviderConfigurationPlaneAuditEventKind = ['AUDIT_BEFORE_MUTATION'] as const;
export type ProviderConfigurationPlaneAuditEventKind = typeof ProviderConfigurationPlaneAuditEventKind[number];

export const ProviderConfigurationPlaneErrorKind = [
  'INVALID_CONFIGURATION',
  'ILLEGAL_LIFECYCLE_TRANSITION',
  'MISSING_CREDENTIAL_REFERENCE',
  'HEALTH_PROBE_FAILED',
  'AUDIT_FAILURE',
  'DEGRADED_MODE',
] as const;
export type ProviderConfigurationPlaneErrorKind = typeof ProviderConfigurationPlaneErrorKind[number];

export interface ProviderConfigurationPlaneAuditMetadata {
  readonly changedBy: string;
  readonly timestamp: string;
  readonly justification: string | null;
}

export interface ProviderConfigurationPlaneAuditEvent {
  readonly kind: ProviderConfigurationPlaneAuditEventKind;
  readonly providerKey: string;
  readonly previousState: ProviderConfigurationPlaneLifecycleState | null;
  readonly newState: ProviderConfigurationPlaneLifecycleState | null;
  readonly metadata: ProviderConfigurationPlaneAuditMetadata;
}

export interface ProviderConfigurationPlaneError {
  readonly kind: ProviderConfigurationPlaneErrorKind;
  readonly message: string;
  readonly providerKey: string;
}

export interface ProviderConfigurationPlaneProviderConfig {
  readonly providerKey: string;
  readonly capability: string;
  readonly environment: string;
  readonly instanceLabel: string;
  readonly classification: string;
  readonly lifecycleState: ProviderConfigurationPlaneLifecycleState;
  readonly endpoint: string | null;
  readonly config: unknown;
  readonly credentialRef: string | null;
  readonly requiresCredential: boolean;
  readonly auditMetadata: ProviderConfigurationPlaneAuditMetadata | null;
}

export interface ProviderConfigurationPlaneState {
  readonly providerConfigs: readonly ProviderConfigurationPlaneProviderConfig[];
  readonly lastError: ProviderConfigurationPlaneError | null;
}

export const initialState: ProviderConfigurationPlaneState = {
  providerConfigs: [],
  lastError: null,
};

export const ProviderConfigurationPlaneReadinessSignal = [
  'READY',
  'DEGRADED',
] as const;
export type ProviderConfigurationPlaneReadinessSignal = typeof ProviderConfigurationPlaneReadinessSignal[number];

export function validateProviderConfig(
  config: ProviderConfigurationPlaneProviderConfig,
): ProviderConfigurationPlaneError | null {
  if (!config.providerKey || typeof config.providerKey !== 'string') {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'providerKey is required and must be a string',
      providerKey: config.providerKey ?? 'unknown',
    };
  }

  if (!config.capability || typeof config.capability !== 'string') {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'capability is required and must be a string',
      providerKey: config.providerKey,
    };
  }

  if (!config.environment || typeof config.environment !== 'string') {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'environment is required and must be a string',
      providerKey: config.providerKey,
    };
  }

  if (!config.instanceLabel || typeof config.instanceLabel !== 'string') {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'instanceLabel is required and must be a string',
      providerKey: config.providerKey,
    };
  }

  if (!config.classification || typeof config.classification !== 'string') {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'classification is required and must be a string',
      providerKey: config.providerKey,
    };
  }

  if (config.requiresCredential && !config.credentialRef) {
    return {
      kind: 'MISSING_CREDENTIAL_REFERENCE',
      message: 'credentialRef is required when requiresCredential is true',
      providerKey: config.providerKey,
    };
  }

  return null;
}

export function validateLifecycleTransition(
  currentState: ProviderConfigurationPlaneLifecycleState,
  newState: ProviderConfigurationPlaneLifecycleState,
): ProviderConfigurationPlaneError | null {
  const validTransitions: Record<ProviderConfigurationPlaneLifecycleState, readonly ProviderConfigurationPlaneLifecycleState[]> = {
    PROPOSED: ['CONFIGURED', 'DISABLED'],
    CONFIGURED: ['READY', 'DEGRADED', 'DISABLED'],
    READY: ['DEGRADED', 'DISABLED'],
    DEGRADED: ['READY', 'DISABLED'],
    DISABLED: ['PROPOSED'],
  };

  if (!validTransitions[currentState].includes(newState)) {
    return {
      kind: 'ILLEGAL_LIFECYCLE_TRANSITION',
      message: `Cannot transition from ${currentState} to ${newState}`,
      providerKey: 'unknown',
    };
  }

  return null;
}

export function auditProviderConfigMutation(
  providerKey: string,
  previousState: ProviderConfigurationPlaneLifecycleState | null,
  newState: ProviderConfigurationPlaneLifecycleState | null,
  metadata: ProviderConfigurationPlaneAuditMetadata,
  auditFn: (event: ProviderConfigurationPlaneAuditEvent) => ProviderConfigurationPlaneError | null,
): ProviderConfigurationPlaneError | null {
  const event: ProviderConfigurationPlaneAuditEvent = {
    kind: 'AUDIT_BEFORE_MUTATION',
    providerKey,
    previousState,
    newState,
    metadata,
  };
  return auditFn(event);
}

export function createProviderConfig(
  state: ProviderConfigurationPlaneState,
  config: Omit<ProviderConfigurationPlaneProviderConfig, 'lifecycleState' | 'auditMetadata'>,
  auditMetadata: ProviderConfigurationPlaneAuditMetadata,
  auditFn: (event: ProviderConfigurationPlaneAuditEvent) => ProviderConfigurationPlaneError | null,
): ProviderConfigurationPlaneState | ProviderConfigurationPlaneError {
  const validationError = validateProviderConfig({
    ...config,
    lifecycleState: 'PROPOSED',
    auditMetadata: null,
  });
  if (validationError !== null) {
    return validationError;
  }

  const auditError = auditProviderConfigMutation(
    config.providerKey,
    null,
    'PROPOSED',
    auditMetadata,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const newConfig: ProviderConfigurationPlaneProviderConfig = {
    ...config,
    lifecycleState: 'PROPOSED',
    auditMetadata,
  };

  return {
    ...state,
    providerConfigs: [...state.providerConfigs, newConfig],
    lastError: null,
  };
}

export function transitionProviderLifecycle(
  state: ProviderConfigurationPlaneState,
  providerKey: string,
  newState: ProviderConfigurationPlaneLifecycleState,
  auditMetadata: ProviderConfigurationPlaneAuditMetadata,
  auditFn: (event: ProviderConfigurationPlaneAuditEvent) => ProviderConfigurationPlaneError | null,
  healthProbePassed: boolean,
): ProviderConfigurationPlaneState | ProviderConfigurationPlaneError {
  const existingConfig = state.providerConfigs.find((pc) => pc.providerKey === providerKey);
  if (existingConfig === undefined) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Provider configuration not found',
      providerKey,
    };
  }

  if (newState === 'READY' && !healthProbePassed) {
    return {
      kind: 'HEALTH_PROBE_FAILED',
      message: 'Health probe must pass before transitioning to READY',
      providerKey,
    };
  }

  const transitionError = validateLifecycleTransition(existingConfig.lifecycleState, newState);
  if (transitionError !== null) {
    return transitionError;
  }

  const auditError = auditProviderConfigMutation(
    providerKey,
    existingConfig.lifecycleState,
    newState,
    auditMetadata,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const updatedConfigs = state.providerConfigs.map((pc) =>
    pc.providerKey === providerKey
      ? { ...pc, lifecycleState: newState, auditMetadata }
      : pc,
  );

  return {
    ...state,
    providerConfigs: updatedConfigs,
    lastError: null,
  };
}

export function deleteProviderConfig(
  state: ProviderConfigurationPlaneState,
  providerKey: string,
  auditMetadata: ProviderConfigurationPlaneAuditMetadata,
  auditFn: (event: ProviderConfigurationPlaneAuditEvent) => ProviderConfigurationPlaneError | null,
): ProviderConfigurationPlaneState | ProviderConfigurationPlaneError {
  const existingConfig = state.providerConfigs.find((pc) => pc.providerKey === providerKey);
  if (existingConfig === undefined) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Provider configuration not found',
      providerKey,
    };
  }

  const auditError = auditProviderConfigMutation(
    providerKey,
    existingConfig.lifecycleState,
    null,
    auditMetadata,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const updatedConfigs = state.providerConfigs.filter((pc) => pc.providerKey !== providerKey);

  return {
    ...state,
    providerConfigs: updatedConfigs,
    lastError: null,
  };
}

export function getProviderConfig(
  state: ProviderConfigurationPlaneState,
  providerKey: string,
): ProviderConfigurationPlaneProviderConfig | null {
  return state.providerConfigs.find((pc) => pc.providerKey === providerKey) ?? null;
}

export function getProviderReadiness(
  state: ProviderConfigurationPlaneState,
  providerKey: string,
): ProviderConfigurationPlaneReadinessSignal | null {
  const config = getProviderConfig(state, providerKey);
  if (config === null) {
    return null;
  }

  if (config.lifecycleState === 'READY') {
    return 'READY';
  } else if (config.lifecycleState === 'DEGRADED') {
    return 'DEGRADED';
  }

  return null;
}

export function getAllProviderConfigs(state: ProviderConfigurationPlaneState): readonly ProviderConfigurationPlaneProviderConfig[] {
  return state.providerConfigs;
}