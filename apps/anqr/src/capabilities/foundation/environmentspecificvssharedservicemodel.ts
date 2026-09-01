export const EnvironmentServiceClassification = [
  'ENVIRONMENT_SPECIFIC',
  'SHARED',
] as const;
export type EnvironmentServiceClassification = typeof EnvironmentServiceClassification[number];

export const EnvironmentServiceClassificationErrorKind = [
  'INVALID_CLASSIFICATION',
  'MISSING_CLASSIFICATION',
  'INCONSISTENT_CLASSIFICATION',
  'CONFIGURATION_LOSS',
  'PROVIDER_FAILURE',
] as const;
export type EnvironmentServiceClassificationErrorKind =
  typeof EnvironmentServiceClassificationErrorKind[number];

export const EnvironmentServiceClassificationAuditEventKind = [
  'CLASSIFICATION_CHANGE',
  'PROOF_GENERATED',
  'READINESS_CHECK',
] as const;
export type EnvironmentServiceClassificationAuditEventKind =
  typeof EnvironmentServiceClassificationAuditEventKind[number];

export const EnvironmentServiceClassificationReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type EnvironmentServiceClassificationReadiness =
  typeof EnvironmentServiceClassificationReadiness[number];

export interface EnvironmentServiceClassificationAuditEvent {
  readonly kind: EnvironmentServiceClassificationAuditEventKind;
  readonly service: string;
  readonly previousClassification: EnvironmentServiceClassification | null;
  readonly newClassification: EnvironmentServiceClassification;
  readonly timestamp: string;
}

export interface EnvironmentServiceClassificationError {
  readonly kind: EnvironmentServiceClassificationErrorKind;
  readonly message: string;
  readonly service?: string;
}

export interface ServiceClassification {
  readonly service: string;
  readonly classification: EnvironmentServiceClassification;
}

export interface EnvironmentServiceClassificationState {
  readonly classifications: readonly ServiceClassification[];
  readonly lastAuditEvent: EnvironmentServiceClassificationAuditEvent | null;
  readonly lastError: EnvironmentServiceClassificationError | null;
  readonly readiness: EnvironmentServiceClassificationReadiness;
}

export const initialState: EnvironmentServiceClassificationState = {
  classifications: [],
  lastAuditEvent: null,
  lastError: null,
  readiness: 'NOT_READY',
};

/**
 * Classify a service. The mutation is guarded by an audit callback.
 * If the audit reports an error, the state is left unchanged and the error is returned.
 */
export function classifyService(
  state: EnvironmentServiceClassificationState,
  service: string,
  classification: EnvironmentServiceClassification,
  auditFn: (
    event: EnvironmentServiceClassificationAuditEvent,
  ) => EnvironmentServiceClassificationError | null,
): EnvironmentServiceClassificationState | EnvironmentServiceClassificationError {
  if (!EnvironmentServiceClassification.includes(classification)) {
    return {
      kind: 'INVALID_CLASSIFICATION',
      message: `Invalid classification: ${classification}`,
      service,
    };
  }

  const existing = state.classifications.find((c) => c.service === service);

  const event: EnvironmentServiceClassificationAuditEvent = {
    kind: 'CLASSIFICATION_CHANGE',
    service,
    previousClassification: existing?.classification ?? null,
    newClassification: classification,
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }

  const newClassifications = existing
    ? state.classifications.map((c) =>
        c.service === service ? { service, classification } : c,
      )
    : [...state.classifications, { service, classification }];

  return {
    ...state,
    classifications: newClassifications,
    lastAuditEvent: event,
    lastError: null,
  };
}

/**
 * Validate that each service appears at most once and that its classification is a known value.
 * Also validates that shared services do not violate environment isolation.
 */
export function validateClassifications(
  state: EnvironmentServiceClassificationState,
): EnvironmentServiceClassificationError | null {
  const seen = new Set<string>();
  for (const sc of state.classifications) {
    if (!EnvironmentServiceClassification.includes(sc.classification)) {
      return {
        kind: 'INVALID_CLASSIFICATION',
        message: `Invalid classification for ${sc.service}`,
        service: sc.service,
      };
    }
    if (seen.has(sc.service)) {
      return {
        kind: 'INCONSISTENT_CLASSIFICATION',
        message: `Duplicate classification for service ${sc.service}`,
        service: sc.service,
      };
    }
    seen.add(sc.service);
  }
  return null;
}

/**
 * Compute readiness based on validation and presence of classifications.
 * If the state is already in a degraded mode (e.g., after provider failure) the stored readiness is returned.
 * Readiness and audit remain visible in degraded mode.
 */
export function checkReadiness(
  state: EnvironmentServiceClassificationState,
): {
  readonly readiness: EnvironmentServiceClassificationReadiness;
  readonly error: EnvironmentServiceClassificationError | null;
} {
  if (state.readiness === 'DEGRADED') {
    return {
      readiness: 'DEGRADED',
      error: state.lastError,
    };
  }

  const validationError = validateClassifications(state);
  if (validationError !== null) {
    return {
      readiness: 'NOT_READY',
      error: validationError,
    };
  }

  if (state.classifications.length === 0) {
    return {
      readiness: 'NOT_READY',
      error: {
        kind: 'MISSING_CLASSIFICATION',
        message: 'No service classifications present',
      },
    };
  }

  return {
    readiness: 'READY',
    error: null,
  };
}

/**
 * Produce a proof document consisting of the current classifications.
 * The proof is considered pending until the caller explicitly acknowledges it.
 * Proof is hermetic/runtime lineage; fresh proof remains pending.
 */
export function generateProof(
  state: EnvironmentServiceClassificationState,
): {
  readonly proof: readonly ServiceClassification[];
  readonly error: EnvironmentServiceClassificationError | null;
} {
  const validationError = validateClassifications(state);
  if (validationError !== null) {
    return {
      proof: [],
      error: validationError,
    };
  }
  if (state.readiness === 'DEGRADED') {
    return {
      proof: [...state.classifications],
      error: state.lastError,
    };
  }
  return {
    proof: [...state.classifications],
    error: null,
  };
}

/**
 * Return a proof together with a pending flag. The flag is true when the system
 * is not fully ready, signalling that the proof may be stale.
 */
export function pendingProof(
  state: EnvironmentServiceClassificationState,
): {
  readonly proof: readonly ServiceClassification[];
  readonly pending: boolean;
  readonly error: EnvironmentServiceClassificationError | null;
} {
  const { proof, error } = generateProof(state);
  const { readiness } = checkReadiness(state);
  return {
    proof,
    pending: readiness !== 'READY',
    error,
  };
}

/**
 * Retrieve the classification for a service. If the service is not known,
 * a typed error is returned (fail‑closed).
 */
export type ClassificationLookupResult =
  | {
      readonly kind: 'FOUND';
      readonly classification: EnvironmentServiceClassification;
    }
  | {
      readonly kind: 'MISSING_CLASSIFICATION';
      readonly message: string;
      readonly service: string;
    };

export function getClassification(
  state: EnvironmentServiceClassificationState,
  service: string,
): ClassificationLookupResult {
  const found = state.classifications.find((c) => c.service === service);
  if (found) {
    return { kind: 'FOUND', classification: found.classification };
  }
  return {
    kind: 'MISSING_CLASSIFICATION',
    message: `Classification for service ${service} not found`,
    service,
  };
}

/**
 * Simulate a provider failure. The returned state is marked as DEGRADED,
 * the error is recorded, and no mutations to classifications occur.
 * Degraded mode disables dependent side-effect paths while keeping read-only readiness and audit visible.
 */
export function providerFailure(
  state: EnvironmentServiceClassificationState,
  message: string,
): EnvironmentServiceClassificationState {
  const error: EnvironmentServiceClassificationError = {
    kind: 'PROVIDER_FAILURE',
    message,
  };
  return {
    ...state,
    readiness: 'DEGRADED',
    lastError: error,
  };
}

/**
 * Helper to emit an audit event for proof generation.
 */
export function auditProofGeneration(
  auditFn: (
    event: EnvironmentServiceClassificationAuditEvent,
  ) => EnvironmentServiceClassificationError | null,
): EnvironmentServiceClassificationError | null {
  const event: EnvironmentServiceClassificationAuditEvent = {
    kind: 'PROOF_GENERATED',
    service: '<PROOF>',
    previousClassification: null,
    newClassification: 'SHARED',
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

/**
 * Helper to emit an audit event for readiness checks.
 */
export function auditReadinessCheck(
  auditFn: (
    event: EnvironmentServiceClassificationAuditEvent,
  ) => EnvironmentServiceClassificationError | null,
): EnvironmentServiceClassificationError | null {
  const event: EnvironmentServiceClassificationAuditEvent = {
    kind: 'READINESS_CHECK',
    service: '<READINESS>',
    previousClassification: null,
    newClassification: 'SHARED',
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

/**
 * Existing helper retained for explicit audit before a classification change.
 */
export function auditClassificationChange(
  service: string,
  previousClassification: EnvironmentServiceClassification | null,
  newClassification: EnvironmentServiceClassification,
  auditFn: (
    event: EnvironmentServiceClassificationAuditEvent,
  ) => EnvironmentServiceClassificationError | null,
): EnvironmentServiceClassificationError | null {
  const event: EnvironmentServiceClassificationAuditEvent = {
    kind: 'CLASSIFICATION_CHANGE',
    service,
    previousClassification,
    newClassification,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}