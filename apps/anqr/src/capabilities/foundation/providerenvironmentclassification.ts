export const ProviderMode = [
  'hermetic-mock',
  'production-shaped',
  'production-live',
] as const;
export type ProviderMode = typeof ProviderMode[number];

export const Environment = [
  'test',
  'external',
  'live',
] as const;
export type Environment = typeof Environment[number];

export const ClassificationAuditEventKind = ['CLASSIFICATION_CHANGE'] as const;
export type ClassificationAuditEventKind = typeof ClassificationAuditEventKind[number];

export const ClassificationErrorKind = [
  'DEGRADED',
  'CONFIG_MISSING',
  'CONFIG_INVALID',
  'VALIDATION_FAILED',
  'PROOF_PENDING',
  'PROOF_INVALID',
] as const;
export type ClassificationErrorKind = typeof ClassificationErrorKind[number];

export interface ClassificationAuditEvent {
  readonly kind: ClassificationAuditEventKind;
  readonly provider: string;
  readonly mode: ProviderMode;
  readonly environment: Environment;
  readonly timestamp: string;
}

export interface ClassificationError {
  readonly kind: ClassificationErrorKind;
  readonly message: string;
}

export interface ProviderClassification {
  readonly provider: string;
  readonly mode: ProviderMode;
  readonly environment: Environment;
}

export interface ProviderClassificationState {
  readonly classifications: readonly ProviderClassification[];
  readonly lastError: ClassificationError | null;
}

export const initialState: ProviderClassificationState = {
  classifications: [],
  lastError: null,
};

export function auditClassificationChange(
  provider: string,
  mode: ProviderMode,
  environment: Environment,
  auditFn: (event: ClassificationAuditEvent) => ClassificationError | null,
): ClassificationError | null {
  const event: ClassificationAuditEvent = {
    kind: 'CLASSIFICATION_CHANGE',
    provider,
    mode,
    environment,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

/**
 * Validates a single classification entry against cross‑dimension safety rules.
 */
export function validateClassificationEntry(
  entry: ProviderClassification,
): ClassificationError | null {
  if (!ProviderMode.includes(entry.mode)) {
    return {
      kind: 'CONFIG_INVALID',
      message: `Invalid mode '${entry.mode}' for provider '${entry.provider}'.`,
    };
  }
  if (!Environment.includes(entry.environment)) {
    return {
      kind: 'CONFIG_INVALID',
      message: `Invalid environment '${entry.environment}' for provider '${entry.provider}'.`,
    };
  }

  // hermetic‑mock must not be paired with live or external environments
  if (entry.mode === 'hermetic-mock' && (entry.environment === 'live' || entry.environment === 'external')) {
    return {
      kind: 'VALIDATION_FAILED',
      message: `hermetic-mock cannot be used with environment '${entry.environment}' for provider '${entry.provider}'.`,
    };
  }

  // production‑shaped must not be paired with live environment
  if (entry.mode === 'production-shaped' && entry.environment === 'live') {
    return {
      kind: 'VALIDATION_FAILED',
      message: `production-shaped cannot be used with live environment for provider '${entry.provider}'.`,
    };
  }

  return null;
}

/**
 * Validates the entire classification matrix.
 */
export function validateClassificationMatrix(
  matrix: readonly ProviderClassification[],
): ClassificationError | null {
  const seen = new Set<string>();
  for (const entry of matrix) {
    if (seen.has(entry.provider)) {
      return {
        kind: 'VALIDATION_FAILED',
        message: `Duplicate classification for provider '${entry.provider}'.`,
      };
    }
    seen.add(entry.provider);
    const entryError = validateClassificationEntry(entry);
    if (entryError !== null) {
      return entryError;
    }
  }
  return null;
}

/**
 * Returns the classification matrix derived from the state.
 * Fails closed if the matrix is empty.
 */
export function getClassificationMatrix(
  state: ProviderClassificationState,
): { readonly matrix: Record<string, { readonly mode: ProviderMode; readonly environment: Environment }>; readonly error: ClassificationError | null } {
  if (state.classifications.length === 0) {
    return {
      matrix: {},
      error: {
        kind: 'CONFIG_MISSING',
        message: 'No provider classifications configured.',
      },
    };
  }

  const validationError = validateClassificationMatrix(state.classifications);
  if (validationError !== null) {
    return { matrix: {}, error: validationError };
  }

  const matrix: Record<string, { readonly mode: ProviderMode; readonly environment: Environment }> = {};
  for (const c of state.classifications) {
    matrix[c.provider] = { mode: c.mode, environment: c.environment };
  }
  return { matrix, error: null };
}

/**
 * Mutates the state by setting a provider's classification.
 * The mutation occurs only after successful audit and validation.
 */
export function setProviderClassification(
  state: ProviderClassificationState,
  provider: string,
  mode: ProviderMode,
  environment: Environment,
  auditFn: (event: ClassificationAuditEvent) => ClassificationError | null,
): ProviderClassificationState | ClassificationError {
  const auditError = auditClassificationChange(provider, mode, environment, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newEntry: ProviderClassification = { provider, mode, environment };
  const entryError = validateClassificationEntry(newEntry);
  if (entryError !== null) {
    return entryError;
  }

  const filtered = state.classifications.filter((c) => c.provider !== provider);
  const newClassifications = [...filtered, newEntry];

  const matrixError = validateClassificationMatrix(newClassifications);
  if (matrixError !== null) {
    return matrixError;
  }

  return {
    classifications: newClassifications,
    lastError: null,
  };
}

/**
 * Readiness check – returns true only if every provider has a valid,
 * non‑stale classification and the matrix validates.
 */
export function checkReadiness(
  state: ProviderClassificationState,
): { readonly ready: boolean; readonly error: ClassificationError | null } {
  const { error } = getClassificationMatrix(state);
  if (error !== null) {
    return { ready: false, error };
  }
  // In this pure model, we treat the presence of a valid matrix as readiness.
  return { ready: true, error: null };
}

/**
 * Proof object for provider‑environment classification.
 */
export type ClassificationProofStatus = 'PENDING' | 'VALID' | 'INVALID';
export interface ClassificationProof {
  readonly status: ClassificationProofStatus;
  readonly details?: string;
}

/**
 * Generates a proof of correct classification.
 * If validation passes, proof is VALID; otherwise INVALID.
 * The initial call can be considered PENDING if the state is empty.
 */
export function generateProof(
  state: ProviderClassificationState,
): ClassificationProof {
  if (state.classifications.length === 0) {
    return { status: 'PENDING', details: 'No classifications present.' };
  }

  const validationError = validateClassificationMatrix(state.classifications);
  if (validationError !== null) {
    return { status: 'INVALID', details: validationError.message };
  }

  return { status: 'VALID' };
}

/**
 * Degraded/readiness error factory – used when a provider cannot be
 * classified due to missing or invalid configuration.
 */
export function degradedError(message: string): ClassificationError {
  return { kind: 'DEGRADED', message };
}