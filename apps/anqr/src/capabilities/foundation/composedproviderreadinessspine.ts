export const ComposedProviderReadinessSpineReadinessState = [
  'READY',
  'DEGRADED',
  'UNAVAILABLE',
] as const;
export type ComposedProviderReadinessSpineReadinessState = typeof ComposedProviderReadinessSpineReadinessState[number];

export const ComposedProviderReadinessSpineErrorKind = [
  'CONFIGURATION_MISSING',
  'CONFIGURATION_INVALID',
  'PROVIDER_UNAVAILABLE',
  'AGGREGATION_FAILED',
] as const;
export type ComposedProviderReadinessSpineErrorKind = typeof ComposedProviderReadinessSpineErrorKind[number];

export interface ComposedProviderReadinessSpineProviderReadiness {
  readonly provider: string;
  readonly state: ComposedProviderReadinessSpineReadinessState;
}

export interface ComposedProviderReadinessSpineError {
  readonly kind: ComposedProviderReadinessSpineErrorKind;
  readonly message: string;
  readonly provider?: string;
}

export interface ComposedProviderReadinessSpineAggregatedReadiness {
  readonly state: ComposedProviderReadinessSpineReadinessState;
  readonly providers: readonly ComposedProviderReadinessSpineProviderReadiness[];
  readonly error: ComposedProviderReadinessSpineError | null;
}

export interface ComposedProviderReadinessSpineConfiguration {
  readonly requiredProviders: readonly string[];
}

export function validateConfiguration(
  config: unknown,
): ComposedProviderReadinessSpineConfiguration | ComposedProviderReadinessSpineError {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('requiredProviders' in config) ||
    !Array.isArray((config as { readonly requiredProviders?: unknown }).requiredProviders)
  ) {
    return {
      kind: 'CONFIGURATION_INVALID',
      message: 'Configuration must contain a requiredProviders array',
    };
  }

  const requiredProviders = (config as { readonly requiredProviders: readonly unknown[] }).requiredProviders;
  if (requiredProviders.some((p) => typeof p !== 'string')) {
    return {
      kind: 'CONFIGURATION_INVALID',
      message: 'All requiredProviders must be strings',
    };
  }

  if (requiredProviders.length === 0) {
    return {
      kind: 'CONFIGURATION_INVALID',
      message: 'At least one required provider must be specified',
    };
  }

  return {
    requiredProviders: requiredProviders as readonly string[],
  };
}

export function aggregateReadiness(
  config: ComposedProviderReadinessSpineConfiguration,
  providerStates: readonly ComposedProviderReadinessSpineProviderReadiness[],
): ComposedProviderReadinessSpineAggregatedReadiness {
  const configSet = new Set(config.requiredProviders);
  const providedSet = new Set(providerStates.map((p) => p.provider));

  for (const required of config.requiredProviders) {
    if (!providedSet.has(required)) {
      return {
        state: 'UNAVAILABLE',
        providers: providerStates,
        error: {
          kind: 'PROVIDER_UNAVAILABLE',
          message: `Required provider ${required} not found in readiness signals`,
          provider: required,
        },
      };
    }
  }

  const allReady = providerStates.every((p) => p.state === 'READY');
  const anyDegraded = providerStates.some((p) => p.state === 'DEGRADED');
  const anyUnavailable = providerStates.some((p) => p.state === 'UNAVAILABLE');

  if (anyUnavailable) {
    return {
      state: 'UNAVAILABLE',
      providers: providerStates,
      error: {
        kind: 'AGGREGATION_FAILED',
        message: 'One or more required providers are unavailable',
      },
    };
  }

  if (anyDegraded) {
    return {
      state: 'DEGRADED',
      providers: providerStates,
      error: null,
    };
  }

  if (allReady) {
    return {
      state: 'READY',
      providers: providerStates,
      error: null,
    };
  }

  return {
    state: 'UNAVAILABLE',
    providers: providerStates,
    error: {
      kind: 'AGGREGATION_FAILED',
      message: 'Unable to determine aggregated readiness state',
    },
  };
}

export function getAggregatedReadiness(
  config: unknown,
  providerStates: readonly ComposedProviderReadinessSpineProviderReadiness[],
): ComposedProviderReadinessSpineAggregatedReadiness | ComposedProviderReadinessSpineError {
  const validatedConfig = validateConfiguration(config);
  if ('kind' in validatedConfig) {
    return validatedConfig;
  }

  return aggregateReadiness(validatedConfig, providerStates);
}

export function proofComposedProviderReadiness(
  config: ComposedProviderReadinessSpineConfiguration,
  providerStates: readonly ComposedProviderReadinessSpineProviderReadiness[],
): boolean {
  const result = aggregateReadiness(config, providerStates);
  return result.state === 'READY';
}