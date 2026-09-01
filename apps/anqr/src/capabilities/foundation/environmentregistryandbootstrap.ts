export const EnvironmentRegistryAndBootstrapAuditEventKind = ['AUDIT_BEFORE_REGISTRATION', 'AUDIT_BEFORE_BOOTSTRAP'] as const;
export type EnvironmentRegistryAndBootstrapAuditEventKind = typeof EnvironmentRegistryAndBootstrapAuditEventKind[number];

export const EnvironmentRegistryAndBootstrapErrorKind = [
  'AUDIT_FAILURE',
  'INVALID_MANIFEST',
  'MISSING_CONFIGURATION',
  'PROVIDER_UNAVAILABLE',
  'MUTATION_FAILURE',
] as const;
export type EnvironmentRegistryAndBootstrapErrorKind = typeof EnvironmentRegistryAndBootstrapErrorKind[number];

export const EnvironmentRegistryAndBootstrapProofKind = [
  'proof:environment-registry',
  'proof:environment-admin-bootstrap',
  'proof:environment-operations',
] as const;
export type EnvironmentRegistryAndBootstrapProofKind = typeof EnvironmentRegistryAndBootstrapProofKind[number];

export const EnvironmentRegistryAndBootstrapReadinessSignal = ['READY', 'DEGRADED', 'UNAVAILABLE'] as const;
export type EnvironmentRegistryAndBootstrapReadinessSignal = typeof EnvironmentRegistryAndBootstrapReadinessSignal[number];

export interface EnvironmentRegistryAndBootstrapAuditEvent {
  readonly kind: EnvironmentRegistryAndBootstrapAuditEventKind;
  readonly environment: string;
  readonly operator: string;
  readonly manifest: unknown;
  readonly timestamp: string;
}

export interface EnvironmentRegistryAndBootstrapError {
  readonly kind: EnvironmentRegistryAndBootstrapErrorKind;
  readonly message: string;
}

export interface EnvironmentManifest {
  readonly name: string;
  readonly provider: string;
  readonly config: Record<string, string>;
}

export interface GeneratedEnvironmentConfig {
  readonly environment: string;
  readonly config: Record<string, string>;
}

export interface EnvironmentRegistryAndBootstrapState {
  readonly environments: readonly EnvironmentManifest[];
  readonly generatedConfigs: readonly GeneratedEnvironmentConfig[];
  readonly lastAuditEvent: EnvironmentRegistryAndBootstrapAuditEvent | null;
  readonly lastError: EnvironmentRegistryAndBootstrapError | null;
  readonly readiness: EnvironmentRegistryAndBootstrapReadinessSignal;
  readonly pendingProofs: readonly EnvironmentRegistryAndBootstrapProofKind[];
}

export const initialState: EnvironmentRegistryAndBootstrapState = {
  environments: [],
  generatedConfigs: [],
  lastAuditEvent: null,
  lastError: null,
  readiness: 'UNAVAILABLE',
  pendingProofs: [...EnvironmentRegistryAndBootstrapProofKind],
};

export function auditEnvironmentOperation(
  kind: EnvironmentRegistryAndBootstrapAuditEventKind,
  environment: string,
  operator: string,
  manifest: unknown,
  auditFn: (event: EnvironmentRegistryAndBootstrapAuditEvent) => EnvironmentRegistryAndBootstrapError | null,
): EnvironmentRegistryAndBootstrapError | null {
  const event: EnvironmentRegistryAndBootstrapAuditEvent = {
    kind,
    environment,
    operator,
    manifest,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function registerEnvironment(
  state: EnvironmentRegistryAndBootstrapState,
  manifest: EnvironmentManifest,
  operator: string,
  auditFn: (event: EnvironmentRegistryAndBootstrapAuditEvent) => EnvironmentRegistryAndBootstrapError | null,
): EnvironmentRegistryAndBootstrapState | EnvironmentRegistryAndBootstrapError {
  const auditError = auditEnvironmentOperation(
    'AUDIT_BEFORE_REGISTRATION',
    manifest.name,
    operator,
    manifest,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const existingEnvironment = state.environments.find((env) => env.name === manifest.name);
  if (existingEnvironment !== undefined) {
    return {
      kind: 'MUTATION_FAILURE',
      message: `Environment ${manifest.name} already registered`,
    };
  }

  if (manifest.provider === '' || Object.keys(manifest.config).length === 0) {
    return {
      kind: 'INVALID_MANIFEST',
      message: 'Manifest must have a provider and non-empty config',
    };
  }

  return {
    ...state,
    environments: [...state.environments, manifest],
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_REGISTRATION',
      environment: manifest.name,
      operator,
      manifest,
      timestamp: new Date().toISOString(),
    },
    lastError: null,
    readiness: 'READY',
    pendingProofs: state.pendingProofs.filter((proof) => proof !== 'proof:environment-registry'),
  };
}

export function bootstrapEnvironment(
  state: EnvironmentRegistryAndBootstrapState,
  environment: string,
  operator: string,
  providerConfigPlane: Record<string, Record<string, string>>,
  secretsResolver: (key: string) => string | null,
  auditFn: (event: EnvironmentRegistryAndBootstrapAuditEvent) => EnvironmentRegistryAndBootstrapError | null,
): EnvironmentRegistryAndBootstrapState | EnvironmentRegistryAndBootstrapError {
  const auditError = auditEnvironmentOperation(
    'AUDIT_BEFORE_BOOTSTRAP',
    environment,
    operator,
    null,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const manifest = state.environments.find((env) => env.name === environment);
  if (manifest === undefined) {
    return {
      kind: 'MISSING_CONFIGURATION',
      message: `Environment ${environment} not registered`,
    };
  }

  const providerConfig = providerConfigPlane[manifest.provider];
  if (providerConfig === undefined) {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: `Provider ${manifest.provider} not available in config plane`,
    };
  }

  const generatedConfig: Record<string, string> = { ...providerConfig };
  for (const [key, value] of Object.entries(manifest.config)) {
    if (value.startsWith('secret:')) {
      const secretKey = value.substring(7);
      const resolvedSecret = secretsResolver(secretKey);
      if (resolvedSecret === null) {
        return {
          kind: 'MISSING_CONFIGURATION',
          message: `Secret ${secretKey} not resolved`,
        };
      }
      generatedConfig[key] = resolvedSecret;
    } else {
      generatedConfig[key] = value;
    }
  }

  const existingConfigIndex = state.generatedConfigs.findIndex((config) => config.environment === environment);
  const newGeneratedConfigs = [...state.generatedConfigs];
  if (existingConfigIndex >= 0) {
    newGeneratedConfigs[existingConfigIndex] = { environment, config: generatedConfig };
  } else {
    newGeneratedConfigs.push({ environment, config: generatedConfig });
  }

  return {
    ...state,
    generatedConfigs: newGeneratedConfigs,
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_BOOTSTRAP',
      environment,
      operator,
      manifest: null,
      timestamp: new Date().toISOString(),
    },
    lastError: null,
    readiness: 'READY',
    pendingProofs: state.pendingProofs.filter((proof) => proof !== 'proof:environment-admin-bootstrap'),
  };
}

export function getEnvironmentConfig(
  state: EnvironmentRegistryAndBootstrapState,
  environment: string,
): GeneratedEnvironmentConfig | EnvironmentRegistryAndBootstrapError {
  const config = state.generatedConfigs.find((c) => c.environment === environment);
  if (config === undefined) {
    return {
      kind: 'MISSING_CONFIGURATION',
      message: `No generated config for environment ${environment}`,
    };
  }
  return config;
}

export function runProofs(
  state: EnvironmentRegistryAndBootstrapState,
): EnvironmentRegistryAndBootstrapState {
  if (state.pendingProofs.length === 0) {
    return { ...state, readiness: 'READY' };
  }

  return {
    ...state,
    readiness: state.pendingProofs.includes('proof:environment-operations') ? 'DEGRADED' : 'READY',
  };
}

export function getReadiness(
  state: EnvironmentRegistryAndBootstrapState,
): EnvironmentRegistryAndBootstrapReadinessSignal {
  return state.readiness;
}