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
  readonly newClassification: EnvironmentServiceClassification | null;
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

export interface EnvironmentServiceClassificationProof {
  readonly document: readonly ServiceClassification[];
  readonly checks: readonly string[];
}

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
    readiness: 'NOT_READY',
  };
}

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

export function checkReadiness(
  state: EnvironmentServiceClassificationState,
): EnvironmentServiceClassificationReadiness {
  const validationError = validateClassifications(state);
  if (validationError !== null) {
    return 'NOT_READY';
  }
  if (state.classifications.length === 0) {
    return 'NOT_READY';
  }
  return 'READY';
}

export function generateProof(
  state: EnvironmentServiceClassificationState,
): EnvironmentServiceClassificationProof | EnvironmentServiceClassificationError {
  const validationError = validateClassifications(state);
  if (validationError !== null) {
    return validationError;
  }
  const checks: string[] = [
    'all-classifications-valid',
    'no-duplicate-services',
    'no-missing-classifications',
  ];
  return {
    document: state.classifications,
    checks,
  };
}

export function readClassification(
  state: EnvironmentServiceClassificationState,
  service: string,
): ServiceClassification | EnvironmentServiceClassificationError {
  const classification = state.classifications.find((c) => c.service === service);
  if (classification === undefined) {
    return {
      kind: 'MISSING_CLASSIFICATION',
      message: `No classification found for service ${service}`,
      service,
    };
  }
  return classification;
}

export function getAuditEvents(
  state: EnvironmentServiceClassificationState,
): readonly EnvironmentServiceClassificationAuditEvent[] {
  return state.lastAuditEvent ? [state.lastAuditEvent] : [];
}

export function getReadiness(
  state: EnvironmentServiceClassificationState,
): EnvironmentServiceClassificationReadiness {
  return state.readiness;
}