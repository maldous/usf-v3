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
    readiness: 'NOT_READY',
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