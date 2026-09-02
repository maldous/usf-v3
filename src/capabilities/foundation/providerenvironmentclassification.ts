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

export const ClassificationPostureLabel = [
  'sandbox',
  'staging-shaped',
  'production-live',
  'unknown',
] as const;
export type ClassificationPostureLabel = typeof ClassificationPostureLabel[number];

export const PROOF_ID = 'proof:provider-environment-classification' as const;
export type ProofId = typeof PROOF_ID;

export interface ClassificationAuditEvent {
  readonly kind: ClassificationAuditEventKind;
  readonly provider: string;
  readonly mode: ProviderMode;
  readonly environment: Environment;
  readonly timestamp: string;
  readonly previousMode: ProviderMode | null;
  readonly previousEnvironment: Environment | null;
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

export interface ProviderConfigurationSource {
  readonly providers: readonly ProviderClassification[];
}

export interface ProviderClassificationState {
  readonly classifications: readonly ProviderClassification[];
  readonly lastError: ClassificationError | null;
  readonly readiness: ClassificationReadiness;
  readonly proofStatus: ClassificationProofStatus;
  readonly auditLog: readonly ClassificationAuditEvent[];
}

export const initialState: ProviderClassificationState = {
  classifications: [],
  lastError: null,
  readiness: 'NOT_READY',
  proofStatus: 'PENDING',
  auditLog: [],
};

export function isProviderMode(value: unknown): value is ProviderMode {
  return typeof value === 'string' && (ProviderMode as readonly string[]).includes(value);
}

export function isEnvironment(value: unknown): value is Environment {
  return typeof value === 'string' && (Environment as readonly string[]).includes(value);
}

export function isClassificationAuditEventKind(
  value: unknown,
): value is ClassificationAuditEventKind {
  return (
    typeof value === 'string' &&
    (ClassificationAuditEventKind as readonly string[]).includes(value)
  );
}

export function isClassificationErrorKind(value: unknown): value is ClassificationErrorKind {
  return (
    typeof value === 'string' &&
    (ClassificationErrorKind as readonly string[]).includes(value)
  );
}

export function isClassificationReadiness(value: unknown): value is ClassificationReadiness {
  return (
    typeof value === 'string' &&
    (ClassificationReadiness as readonly string[]).includes(value)
  );
}

export function isClassificationProofStatus(
  value: unknown,
): value is ClassificationProofStatus {
  return (
    typeof value === 'string' &&
    (ClassificationProofStatus as readonly string[]).includes(value)
  );
}

export function isClassificationPostureLabel(
  value: unknown,
): value is ClassificationPostureLabel {
  return (
    typeof value === 'string' &&
    (ClassificationPostureLabel as readonly string[]).includes(value)
  );
}

export function isProviderConfigurationSource(
  value: unknown,
): value is ProviderConfigurationSource {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.providers)) {
    return false;
  }
  for (const entry of source.providers) {
    if (entry === null || typeof entry !== 'object') {
      return false;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.provider !== 'string' || e.provider.trim() === '') {
      return false;
    }
    if (!isProviderMode(e.mode)) {
      return false;
    }
    if (!isEnvironment(e.environment)) {
      return false;
    }
  }
  return true;
}

export function validateClassificationEntry(
  entry: ProviderClassification,
): ClassificationError | null {
  if (typeof entry.provider !== 'string' || entry.provider.trim() === '') {
    return {
      kind: 'CONFIG_INVALID',
      message: `Provider name must be a non-empty string.`,
    };
  }
  if (!isProviderMode(entry.mode)) {
    return {
      kind: 'CONFIG_INVALID',
      message: `Invalid mode '${String(entry.mode)}' for provider '${entry.provider}'.`,
    };
  }
  if (!isEnvironment(entry.environment)) {
    return {
      kind: 'CONFIG_INVALID',
      message: `Invalid environment '${String(entry.environment)}' for provider '${entry.provider}'.`,
    };
  }

  // provider mode and environment are independent dimensions:
  // hermetic-mock must not satisfy live-external-provider.
  if (entry.mode === 'hermetic-mock' && entry.environment !== 'test') {
    return {
      kind: 'VALIDATION_FAILED',
      message: `hermetic-mock must not satisfy live-external-provider for '${entry.provider}'.`,
    };
  }

  // production-shaped must not satisfy production-live.
  if (entry.mode === 'production-shaped' && entry.environment === 'live') {
    return {
      kind: 'VALIDATION_FAILED',
      message: `production-shaped must not satisfy production-live for '${entry.provider}'.`,
    };
  }

  return null;
}

export function validateClassificationMatrix(
  matrix: readonly ProviderClassification[],
): ClassificationError | null {
  if (matrix.length === 0) {
    return {
      kind: 'CONFIG_MISSING',
      message: 'No provider classifications configured.',
    };
  }
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

export function loadFromConfiguration(
  source: unknown,
):
  | { readonly ok: true; readonly state: ProviderClassificationState }
  | { readonly ok: false; readonly error: ClassificationError } {
  if (!isProviderConfigurationSource(source)) {
    return {
      ok: false,
      error: {
        kind: 'CONFIG_MISSING',
        message:
          'Configuration source missing or invalid; failing closed without inventing defaults.',
      },
    };
  }
  const validationError = validateClassificationMatrix(source.providers);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }
  const readinessResult = computeReadiness(source.providers);
  return {
    ok: true,
    state: {
      classifications: source.providers,
      lastError: null,
      readiness: readinessResult.readiness,
      proofStatus: 'PENDING',
      auditLog: [],
    },
  };
}

export function auditClassificationChange(
  provider: string,
  mode: ProviderMode,
  environment: Environment,
  previousMode: ProviderMode | null,
  previousEnvironment: Environment | null,
  auditFn: (event: ClassificationAuditEvent) => ClassificationError | null,
): ClassificationError | null {
  const event: ClassificationAuditEvent = {
    kind: 'CLASSIFICATION_CHANGE',
    provider,
    mode,
    environment,
    timestamp: new Date().toISOString(),
    previousMode,
    previousEnvironment,
  };
  try {
    const result = auditFn(event);
    if (result === null) {
      return null;
    }
    if (isClassificationErrorKind(result.kind)) {
      return { kind: result.kind, message: result.message };
    }
    return {
      kind: 'DEGRADED',
      message: 'Audit function returned an error without a valid kind.',
    };
  } catch (err) {
    return {
      kind: 'DEGRADED',
      message: err instanceof Error ? err.message : 'Audit function threw.',
    };
  }
}

export function getClassificationMatrix(
  state: ProviderClassificationState,
): {
  readonly matrix: Record<string, { readonly mode: ProviderMode; readonly environment: Environment }>;
  readonly error: ClassificationError | null;
} {
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

  const matrix: Record<
    string,
    { readonly mode: ProviderMode; readonly environment: Environment }
  > = {};
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
):
  | { readonly ok: true; readonly state: ProviderClassificationState }
  | { readonly ok: false; readonly error: ClassificationError } {
  if (typeof provider !== 'string' || provider.trim() === '') {
    return {
      ok: false,
      error: {
        kind: 'CONFIG_INVALID',
        message: 'Provider name must be a non-empty string.',
      },
    };
  }

  const previous = state.classifications.find((c) => c.provider === provider);
  const previousMode: ProviderMode | null = previous === undefined ? null : previous.mode;
  const previousEnvironment: Environment | null =
    previous === undefined ? null : previous.environment;

  // Audit must precede mutation. If it throws or returns a failure,
  // state is not mutated and the original state is preserved.
  const auditError = auditClassificationChange(
    provider,
    mode,
    environment,
    previousMode,
    previousEnvironment,
    auditFn,
  );
  if (auditError !== null) {
    return { ok: false, error: auditError };
  }

  const newEntry: ProviderClassification = { provider, mode, environment };
  const entryError = validateClassificationEntry(newEntry);
  if (entryError !== null) {
    return { ok: false, error: entryError };
  }

  const filtered = state.classifications.filter((c) => c.provider !== provider);
  const newClassifications = [...filtered, newEntry];

  const matrixError = validateClassificationMatrix(newClassifications);
  if (matrixError !== null) {
    return { ok: false, error: matrixError };
  }

  const readinessResult = computeReadiness(newClassifications);

  const auditEvent: ClassificationAuditEvent = {
    kind: 'CLASSIFICATION_CHANGE',
    provider,
    mode,
    environment,
    timestamp: new Date().toISOString(),
    previousMode,
    previousEnvironment,
  };

  return {
    ok: true,
    state: {
      classifications: newClassifications,
      lastError: null,
      readiness: readinessResult.readiness,
      proofStatus: 'PENDING',
      auditLog: [...state.auditLog, auditEvent],
    },
  };
}

export function computeReadiness(
  classifications: readonly ProviderClassification[],
): {
  readonly readiness: ClassificationReadiness;
  readonly error: ClassificationError | null;
} {
  if (classifications.length === 0) {
    return {
      readiness: 'NOT_READY',
      error: {
        kind: 'CONFIG_MISSING',
        message: 'No provider classifications configured.',
      },
    };
  }

  const validationError = validateClassificationMatrix(classifications);
  if (validationError !== null) {
    return { readiness: 'DEGRADED', error: validationError };
  }

  // Every entry must be honestly classified: provider mode and environment
  // must be present and independent. No implicit posture upgrade.
  for (const entry of classifications) {
    if (!isProviderMode(entry.mode) || !isEnvironment(entry.environment)) {
      return {
        readiness: 'NOT_READY',
        error: {
          kind: 'CONFIG_INVALID',
          message: `Provider '${entry.provider}' has missing or invalid posture.`,
        },
      };
    }
  }

  return { readiness: 'READY', error: null };
}

export function checkReadiness(
  state: ProviderClassificationState,
): {
  readonly readiness: ClassificationReadiness;
  readonly error: ClassificationError | null;
} {
  // Readiness is shown by re-running the proof, not by a live heartbeat.
  const proof = generateProof(state);
  if (proof.status === 'INVALID') {
    return {
      readiness: 'DEGRADED',
      error: {
        kind: 'PROOF_INVALID',
        message: proof.details,
      },
    };
  }
  const result = computeReadiness(state.classifications);
  if (result.readiness === 'READY') {
    return {
      readiness: 'READY',
      error: null,
    };
  }
  return result;
}

export interface ClassificationProof {
  readonly status: ClassificationProofStatus;
  readonly proofId: ProofId;
  readonly lineage: readonly ProviderClassification[];
  readonly details: string;
  readonly proofRunAt: string;
}

export function postureLabelFor(
  mode: ProviderMode,
  environment: Environment,
): ClassificationPostureLabel {
  // Hermetic-mock + test is sandbox. production-shaped + external is staging-shaped.
  // production-live + live is production-live. Anything else is unknown (fail closed).
  if (mode === 'hermetic-mock' && environment === 'test') {
    return 'sandbox';
  }
  if (mode === 'production-shaped' && environment === 'external') {
    return 'staging-shaped';
  }
  if (mode === 'production-live' && environment === 'live') {
    return 'production-live';
  }
  return 'unknown';
}

export function generateProof(
  state: ProviderClassificationState,
): ClassificationProof {
  const lineage: readonly ProviderClassification[] = state.classifications;
  const proofRunAt = new Date().toISOString();

  if (lineage.length === 0) {
    return {
      status: 'PENDING',
      proofId: PROOF_ID,
      lineage,
      details: 'No classifications present; fresh proof remains pending.',
      proofRunAt,
    };
  }

  const validationError = validateClassificationMatrix(lineage);
  if (validationError !== null) {
    return {
      status: 'INVALID',
      proofId: PROOF_ID,
      lineage,
      details: validationError.message,
      proofRunAt,
    };
  }

  // Provider mode and environment must remain independent dimensions.
  const allIndependent = lineage.every((entry) => {
    return validateClassificationEntry(entry) === null;
  });

  if (!allIndependent) {
    return {
      status: 'INVALID',
      proofId: PROOF_ID,
      lineage,
      details:
        'Proof invalid: provider mode and environment are not independent across the matrix.',
      proofRunAt,
    };
  }

  // Fresh proof remains pending: hermetic/runtime lineage is captured but
  // not committed as VALID until independently observed.
  return {
    status: 'PENDING',
    proofId: PROOF_ID,
    lineage,
    details:
      'Proof is hermetic/runtime lineage; fresh proof remains pending. Provider mode and environment remain independent dimensions.',
    proofRunAt,
  };
}

export function runProof(
  state: ProviderClassificationState,
): ClassificationProof {
  return generateProof(state);
}

export function degradedError(message: string): ClassificationError {
  return { kind: 'DEGRADED', message };
}

export function configMissingError(message: string): ClassificationError {
  return { kind: 'CONFIG_MISSING', message };
}

export function configInvalidError(message: string): ClassificationError {
  return { kind: 'CONFIG_INVALID', message };
}

export function validationFailedError(message: string): ClassificationError {
  return { kind: 'VALIDATION_FAILED', message };
}

export function proofPendingError(message: string): ClassificationError {
  return { kind: 'PROOF_PENDING', message };
}

export function proofInvalidError(message: string): ClassificationError {
  return { kind: 'PROOF_INVALID', message };
}

export function getEnvironmentClassificationMatrix(
  state: ProviderClassificationState,
): {
  readonly matrix: Record<string, { readonly mode: ProviderMode; readonly environment: Environment }>;
  readonly error: ClassificationError | null;
} {
  return getClassificationMatrix(state);
}

export function getPostureLabels(
  state: ProviderClassificationState,
): {
  readonly labels: Record<string, ClassificationPostureLabel>;
  readonly error: ClassificationError | null;
} {
  const matrixResult = getClassificationMatrix(state);
  if (matrixResult.error !== null) {
    return { labels: {}, error: matrixResult.error };
  }
  const labels: Record<string, ClassificationPostureLabel> = {};
  for (const [provider, value] of Object.entries(matrixResult.matrix)) {
    labels[provider] = postureLabelFor(value.mode, value.environment);
  }
  return { labels, error: null };
}

export function isAlertable(error: ClassificationError): boolean {
  if (error.kind === 'DEGRADED') {
    return true;
  }
  if (error.kind === 'VALIDATION_FAILED') {
    return true;
  }
  if (error.kind === 'PROOF_PENDING' || error.kind === 'PROOF_INVALID') {
    return true;
  }
  if (error.kind === 'CONFIG_MISSING') {
    return true;
  }
  if (error.kind === 'CONFIG_INVALID') {
    return true;
  }
  return false;
}

export function isReady(state: ProviderClassificationState): boolean {
  // Readiness is shown by re-running proof, not a live heartbeat.
  const proof = generateProof(state);
  if (proof.status === 'INVALID') {
    return false;
  }
  if (state.readiness !== 'READY') {
    return false;
  }
  return true;
}

export function isDegraded(state: ProviderClassificationState): boolean {
  return state.readiness === 'DEGRADED';
}

export function isFreshProof(state: ProviderClassificationState): boolean {
  return state.proofStatus === 'PENDING';
}

export function hasValidClassifications(state: ProviderClassificationState): boolean {
  if (state.classifications.length === 0) {
    return false;
  }
  return validateClassificationMatrix(state.classifications) === null;
}

export function getProviderMode(
  state: ProviderClassificationState,
  provider: string,
): ProviderMode | null {
  const entry = state.classifications.find((c) => c.provider === provider);
  if (entry === undefined) {
    return null;
  }
  return entry.mode;
}

export function getProviderEnvironment(
  state: ProviderClassificationState,
  provider: string,
): Environment | null {
  const entry = state.classifications.find((c) => c.provider === provider);
  if (entry === undefined) {
    return null;
  }
  return entry.environment;
}

export function getProviderPostureLabel(
  state: ProviderClassificationState,
  provider: string,
): ClassificationPostureLabel {
  const entry = state.classifications.find((c) => c.provider === provider);
  if (entry === undefined) {
    return 'unknown';
  }
  return postureLabelFor(entry.mode, entry.environment);
}

export function listProviders(state: ProviderClassificationState): readonly string[] {
  const providers: string[] = [];
  for (const c of state.classifications) {
    providers.push(c.provider);
  }
  return providers;
}

export function listAuditLog(state: ProviderClassificationState): readonly ClassificationAuditEvent[] {
  return state.auditLog;
}

export function isModeEnvironmentCompatible(
  mode: ProviderMode,
  environment: Environment,
): boolean {
  const testEntry: ProviderClassification = { provider: '__check__', mode, environment };
  return validateClassificationEntry(testEntry) === null;
}

// Fail-closed posture reporting: an unclassified provider cannot be reported
// as production-live. This is the matrix authority other capabilities read.
export function canBeReportedAsLive(
  state: ProviderClassificationState,
  provider: string,
): boolean {
  const label = getProviderPostureLabel(state, provider);
  if (label === 'production-live') {
    return true;
  }
  return false;
}

export function canBeReportedAsSandbox(
  state: ProviderClassificationState,
  provider: string,
): boolean {
  const label = getProviderPostureLabel(state, provider);
  if (label === 'sandbox') {
    return true;
  }
  return false;
}

// The capability owns no tenant mutation: no tenant-mutating routes are
// exposed. This function exists to make the separation observable to tests
// and callers. It always returns the fixed set of capability-internal
// surfaces (read-only classification inspection), never a tenant mutator.
export function capabilitySurfaces(): readonly string[] {
  return [
    'read:classifications',
    'read:posture-labels',
    'read:readiness',
    'read:proof',
    'read:audit-log',
  ];
}