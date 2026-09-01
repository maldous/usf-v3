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
export type EnvironmentServiceClassificationErrorKind = typeof EnvironmentServiceClassificationErrorKind[number];

export const EnvironmentServiceClassificationAuditEventKind = [
  'CLASSIFICATION_CHANGE',
  'PROOF_GENERATED',
  'READINESS_CHECK',
] as const;
export type EnvironmentServiceClassificationAuditEventKind = typeof EnvironmentServiceClassificationAuditEventKind[number];

export const EnvironmentServiceClassificationReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type EnvironmentServiceClassificationReadiness = typeof EnvironmentServiceClassificationReadiness[number];

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

export function classifyService(
  state: EnvironmentServiceClassificationState,
  service: string,
  classification: EnvironmentServiceClassification,
  auditFn: (event: EnvironmentServiceClassificationAuditEvent) => EnvironmentServiceClassificationError | null,
): EnvironmentServiceClassificationState | EnvironmentServiceClassificationError {
  if (!EnvironmentServiceClassification.includes(classification)) {
    return {
      kind: 'INVALID_CLASSIFICATION',
      message: `Invalid classification: ${classification}`,
      service,
    };
  }

  const existingClassification = state.classifications.find(
    (sc) => sc.service === service,
  );

  const event: EnvironmentServiceClassificationAuditEvent = {
    kind: 'CLASSIFICATION_CHANGE',
    service,
    previousClassification: existingClassification?.classification ?? null,
    newClassification: classification,
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }

  const newClassifications = existingClassification
    ? state.classifications.map((sc) =>
        sc.service === service ? { service, classification } : sc,
      )
    : [...state.classifications, { service, classification }];

  return {
    ...state,
    classifications: newClassifications,
    lastAuditEvent: event,
    lastError: null,
  };
}

export function validateClassifications(
  state: EnvironmentServiceClassificationState,
): EnvironmentServiceClassificationError | null {
  const services = new Set<string>();
  const classificationMap = new Map<string, EnvironmentServiceClassification>();

  for (const sc of state.classifications) {
    if (services.has(sc.service)) {
      return {
        kind: 'INCONSISTENT_CLASSIFICATION',
        message: `Duplicate service classification for: ${sc.service}`,
        service: sc.service,
      };
    }
    services.add(sc.service);
    classificationMap.set(sc.service, sc.classification);
  }

  return null;
}

export function checkReadiness(
  state: EnvironmentServiceClassificationState,
): {
  readonly readiness: EnvironmentServiceClassificationReadiness;
  readonly error: EnvironmentServiceClassificationError | null;
} {
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

  return {
    proof: [...state.classifications],
    error: null,
  };
}

export function getClassification(
  state: EnvironmentServiceClassificationState,
  service: string,
): EnvironmentServiceClassification | null {
  const classification = state.classifications.find(
    (sc) => sc.service === service,
  );
  return classification?.classification ?? null;
}

export function auditClassificationChange(
  service: string,
  previousClassification: EnvironmentServiceClassification | null,
  newClassification: EnvironmentServiceClassification,
  auditFn: (event: EnvironmentServiceClassificationAuditEvent) => EnvironmentServiceClassificationError | null,
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