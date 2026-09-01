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

export const ClassificationReadiness = ['READY', 'NOT_READY', 'DEGRADED'] as const;
export type ClassificationReadiness = typeof ClassificationReadiness[number];

export const ClassificationProofStatus = ['PENDING', 'VALID', 'INVALID'] as const;
export type ClassificationProofStatus = typeof ClassificationProofStatus[number];

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

  if (entry.mode === 'hermetic-mock' && (entry.environment === 'live' || entry.environment === 'external')) {
    return {
      kind: 'VALIDATION_FAILED',
      message: `hermetic-mock cannot be used with environment '${entry.environment}' for provider '${entry.provider}'.`,
    };
  }

  if (entry.mode === 'production-shaped' && entry.environment === 'live') {
    return {
      kind: 'VALIDATION_FAILED',
      message: `production-shaped cannot be used with live environment for provider '${entry.provider}'.`,
    };
  }

  return null;
}

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

export function setProviderClassification(
  state: ProviderClassificationState,
  provider: string,
  mode: ProviderMode,
  environment: Environment,
  auditFn: (event: ClassificationAuditEvent) => ClassificationError | null,
): ProviderClassificationState | ClassificationError {
  const auditError = auditClassificationChange(provider, mode, environment, auditFn);
  if (auditError !== null) {
    return {
      ...state,
      lastError: auditError,
    } as ProviderClassificationState | ClassificationError;
  }

  const newEntry: ProviderClassification = { provider, mode, environment };
  const entryError = validateClassificationEntry(newEntry);
  if (entryError !== null) {
    return {
      ...state,
      lastError: entryError,
    } as ProviderClassificationState | ClassificationError;
  }

  const filtered = state.classifications.filter((c) => c.provider !== provider);
  const newClassifications = [...filtered, newEntry];

  const matrixError = validateClassificationMatrix(newClassifications);
  if (matrixError !== null) {
    return {
      ...state,
      lastError: matrixError,
    } as ProviderClassificationState | ClassificationError;
  }

  return {
    classifications: newClassifications,
    lastError: null,
  };
}

export function checkReadiness(
  state: ProviderClassificationState,
): { readonly readiness: ClassificationReadiness; readonly error: ClassificationError | null } {
  const { error } = getClassificationMatrix(state);
  if (error !== null) {
    if (error.kind === 'CONFIG_MISSING' || error.kind === 'CONFIG_INVALID' || error.kind === 'VALIDATION_FAILED') {
      return { readiness: 'DEGRADED', error };
    }
    return { readiness: 'NOT_READY', error };
  }
  return { readiness: 'READY', error: null };
}

export interface ClassificationProof {
  readonly status: ClassificationProofStatus;
  readonly details?: string;
}

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

export function degradedError(message: string): ClassificationError {
  return { kind: 'DEGRADED', message };
}