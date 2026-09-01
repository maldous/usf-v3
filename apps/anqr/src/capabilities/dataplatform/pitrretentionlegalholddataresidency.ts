export const RetentionOutcome = [
  'PENDING',
  'DELETED',
  'HELD',
] as const;
export type RetentionOutcome = typeof RetentionOutcome[number];

export const LegalHoldState = [
  'ACTIVE',
  'RELEASED',
] as const;
export type LegalHoldState = typeof LegalHoldState[number];

export const ReadinessState = [
  'NOT_READY',
  'READY',
  'DEGRADED',
] as const;
export type ReadinessState = typeof ReadinessState[number];

export const RetentionErrorKind = [
  'TENANT_DATA_LOSS_RISK',
  'READINESS_DEGRADED',
  'CONFIG_UNAVAILABLE',
  'AUDIT_FAILURE',
  'VALIDATION_FAILURE',
] as const;
export type RetentionErrorKind = typeof RetentionErrorKind[number];

export const LegalHoldErrorKind = [
  'INVALID_ACTOR',
  'INVALID_REASON',
  'HOLD_NOT_FOUND',
  'ALREADY_RELEASED',
] as const;
export type LegalHoldErrorKind = typeof LegalHoldErrorKind[number];

export const ResidencyErrorKind = [
  'INVALID_REGION',
  'TAG_CONFLICT',
  'READINESS_DEGRADED',
] as const;
export type ResidencyErrorKind = typeof ResidencyErrorKind[number];

export const IncidentClass = [
  'TENANT_DATA_OR_SECURITY',
] as const;
export type IncidentClass = typeof IncidentClass[number];

export interface LegalHoldRecord {
  readonly tenantId: string;
  readonly resource: string;
  readonly reason: string;
  readonly setBy: string;
  readonly setTimestamp: string;
  readonly releasedBy?: string;
  readonly releasedTimestamp?: string;
  readonly state: LegalHoldState;
}

export interface RetentionPolicyRecord {
  readonly tenantId: string;
  readonly resourceClass: string;
  readonly targetResource?: string;
  readonly timeToLiveMillis: number;
  readonly applyFilter: 'ALL' | 'BY_STATUS' | `BY_STATUS:${string}`;
  readonly enabled: boolean;
}

export interface ResidencyTagRecord {
  readonly tenantId: string;
  readonly homeRegion: string;
}

export interface RetentionCandidate {
  readonly tenantId: string;
  readonly resource: string;
  readonly policyId: string;
  readonly currentOutcome: RetentionOutcome;
  readonly evaluatedAt: string;
}

export interface AuditEvent {
  readonly kind: 'LEGAL_HOLD_SET' | 'LEGAL_HOLD_RELEASED' | 'RETENTION_EVALUATED' | 'RESIDENCY_TAG_SET' | 'RESTORE_DRILL';
  readonly tenantId: string;
  readonly timestamp: string;
  readonly details: unknown;
}

export type AuditFn = (event: AuditEvent) => Error | null;

export interface RetentionWorkerContext {
  readonly isPrivileged: boolean;
  readonly sourceDataAvailable: boolean;
}

export interface SystemState {
  readonly legalHolds: readonly LegalHoldRecord[];
  readonly retentionPolicies: readonly RetentionPolicyRecord[];
  readonly residencyTags: readonly ResidencyTagRecord[];
  readonly candidates: readonly RetentionCandidate[];
  readonly readiness: ReadinessState;
  readonly lastError: Error | null;
}

export const initialState: SystemState = {
  legalHolds: [],
  retentionPolicies: [],
  residencyTags: [],
  candidates: [],
  readiness: 'NOT_READY',
  lastError: null,
};

export interface CreateLegalHoldResult {
  readonly success: true;
  readonly hold: LegalHoldRecord;
}
export interface CreateLegalHoldError {
  readonly success: false;
  readonly kind: LegalHoldErrorKind;
  readonly incidentClass?: IncidentClass;
  readonly message: string;
}
export type CreateLegalHoldOutput = CreateLegalHoldResult | CreateLegalHoldError;

export interface ReleaseLegalHoldResult {
  readonly success: true;
  readonly hold: LegalHoldRecord;
}
export interface ReleaseLegalHoldError {
  readonly success: false;
  readonly kind: LegalHoldErrorKind;
  readonly incidentClass?: IncidentClass;
  readonly message: string;
}
export type ReleaseLegalHoldOutput = ReleaseLegalHoldResult | ReleaseLegalHoldError;

export interface SetResidencyTagResult {
  readonly success: true;
  readonly tag: ResidencyTagRecord;
}
export interface SetResidencyTagError {
  readonly success: false;
  readonly kind: ResidencyErrorKind;
  readonly incidentClass?: IncidentClass;
  readonly message: string;
}
export type SetResidencyTagOutput = SetResidencyTagResult | SetResidencyTagError;

export interface EvaluateRetentionResult {
  readonly success: true;
  readonly candidates: readonly RetentionCandidate[];
}
export interface EvaluateRetentionError {
  readonly success: false;
  readonly kind: RetentionErrorKind;
  readonly incidentClass?: IncidentClass;
  readonly message: string;
}
export type EvaluateRetentionOutput = EvaluateRetentionResult | EvaluateRetentionError;

export interface RunRetentionWorkerResult {
  readonly success: true;
  readonly state: SystemState;
}
export interface RunRetentionWorkerError {
  readonly success: false;
  readonly kind: RetentionErrorKind;
  readonly incidentClass?: IncidentClass;
  readonly message: string;
}
export type RunRetentionWorkerOutput = RunRetentionWorkerResult | RunRetentionWorkerError;

export interface PerformRestoreDrillResult {
  readonly success: true;
  readonly timestamp: string;
  readonly tenantIdsRestored: readonly string[];
}
export interface PerformRestoreDrillError {
  readonly success: false;
  readonly kind: RetentionErrorKind | ResidencyErrorKind;
  readonly incidentClass?: IncidentClass;
  readonly message: string;
}
export type PerformRestoreDrillOutput = PerformRestoreDrillResult | PerformRestoreDrillError;

export interface CheckReadinessResult {
  readonly ready: boolean;
  readonly details: unknown;
}
export interface CheckReadinessError {
  readonly ready: false;
  readonly kind: RetentionErrorKind | ResidencyErrorKind;
  readonly message: string;
}
export type CheckReadinessOutput = CheckReadinessResult | CheckReadinessError;

export function auditEvent(
  kind: AuditEvent['kind'],
  tenantId: string,
  details: unknown,
  auditFn: AuditFn,
): Error | null {
  const event: AuditEvent = {
    kind,
    tenantId,
    timestamp: new Date().toISOString(),
    details,
  };
  return auditFn(event);
}

export function createLegalHold(
  state: SystemState,
  tenantId: string,
  resource: string,
  reason: string,
  actor: string,
  auditFn: AuditFn,
): CreateLegalHoldOutput {
  if (!actor || typeof actor !== 'string') {
    return { success: false, kind: 'INVALID_ACTOR', message: 'Legal hold set by requires a valid actor' };
  }
  if (!reason || typeof reason !== 'string') {
    return { success: false, kind: 'INVALID_REASON', message: 'Legal hold requires a reason' };
  }

  const existingHold = state.legalHolds.find(
    (h) => h.tenantId === tenantId && h.resource === resource && h.state === 'ACTIVE',
  );
  if (existingHold !== undefined) {
    return { success: true, hold: existingHold };
  }

  const newHold: LegalHoldRecord = {
    tenantId,
    resource,
    reason,
    setBy: actor,
    setTimestamp: new Date().toISOString(),
    state: 'ACTIVE',
  };

  const auditError = auditEvent('LEGAL_HOLD_SET', tenantId, newHold, auditFn);
  if (auditError !== null) {
    return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditError.message };
  }

  const updatedHolds = [...state.legalHolds, newHold];
  const updatedCandidates = state.candidates.map((c) =>
    c.tenantId === tenantId && c.resource === resource
      ? { ...c, currentOutcome: 'HELD' as RetentionOutcome }
      : c
  );

  return {
    success: true,
    hold: newHold,
  };
}

export function releaseLegalHold(
  state: SystemState,
  tenantId: string,
  resource: string,
  actor: string,
  auditFn: AuditFn,
): ReleaseLegalHoldOutput {
  if (!actor || typeof actor !== 'string') {
    return { success: false, kind: 'INVALID_ACTOR', message: 'Legal hold release by requires a valid actor' };
  }

  const holdIndex = state.legalHolds.findIndex(
    (h) => h.tenantId === tenantId && h.resource === resource && h.state === 'ACTIVE',
  );

  if (holdIndex < 0) {
    return { success: false, kind: 'HOLD_NOT_FOUND', message: 'No active legal hold found for resource' };
  }

  const existingHold = state.legalHolds[holdIndex];
  if (existingHold.state === 'RELEASED') {
    return { success: false, kind: 'ALREADY_RELEASED', message: 'Legal hold already released' };
  }

  const updatedHold: LegalHoldRecord = {
    ...existingHold,
    releasedBy: actor,
    releasedTimestamp: new Date().toISOString(),
    state: 'RELEASED',
  };

  const auditError = auditEvent('LEGAL_HOLD_RELEASED', tenantId, updatedHold, auditFn);
  if (auditError !== null) {
    return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditError.message };
  }

  const updatedHolds = [...state.legalHolds];
  updatedHolds[holdIndex] = updatedHold;

  const updatedCandidates = state.candidates.map((c) =>
    c.tenantId === tenantId && c.resource === resource
      ? { ...c, currentOutcome: 'PENDING' as RetentionOutcome }
      : c
  );

  return {
    success: true,
    hold: updatedHold,
  };
}

export function createResidencyTag(
  state: SystemState,
  tenantId: string,
  homeRegion: string,
  auditFn: AuditFn,
): SetResidencyTagOutput {
  if (!homeRegion || typeof homeRegion !== 'string') {
    return { success: false, kind: 'INVALID_REGION', message: 'Home region must be a non-empty string' };
  }

  const existingTag = state.residencyTags.find((t) => t.tenantId === tenantId);
  if (existingTag !== undefined) {
    return { success: true, tag: existingTag };
  }

  const auditError = auditEvent('RESIDENCY_TAG_SET', tenantId, { homeRegion }, auditFn);
  if (auditError !== null) {
    return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditError.message };
  }

  const newTag: ResidencyTagRecord = { tenantId, homeRegion };

  return {
    success: true,
    tag: newTag,
  };
}

export function createRetentionPolicy(
  state: SystemState,
  tenantId: string,
  resourceClass: string,
  timeToLiveMillis: number,
  applyFilter: RetentionPolicyRecord['applyFilter'],
  enabled: boolean,
  auditFn: AuditFn,
): EvaluateRetentionOutput {
  const auditError = auditEvent('RETENTION_EVALUATED', tenantId, { resourceClass, timeToLiveMillis }, auditFn);
  if (auditError !== null) {
    return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditError.message };
  }

  const newPolicy: RetentionPolicyRecord = {
    tenantId,
    resourceClass,
    timeToLiveMillis,
    applyFilter,
    enabled,
  };

  return {
    success: true,
    candidates: state.candidates,
  };
}

export function validateRetentionCandidate(
  state: SystemState,
  tenantId: string,
  resource: string,
): RetentionOutcome | Error {
  const policy = state.retentionPolicies.find((p) => p.tenantId === tenantId);
  if (policy === undefined || !policy.enabled) {
    return 'PENDING';
  }

  const now = Date.now();
  const candidateTimestamp = now; // Simplified: assuming we are evaluating "now" against TTL

  const timeWindowExpired = (candidateTimestamp - policy.timeToLiveMillis) > 0;

  if (!timeWindowExpired) {
    return 'PENDING';
  }

  const activeHold = state.legalHolds.find(
    (h) => h.tenantId === tenantId && h.resource === resource && h.state === 'ACTIVE',
  );

  if (activeHold !== undefined) {
    return 'HELD';
  }

  return 'DELETED';
}

export function runRetentionWorker(
  state: SystemState,
  ctx: RetentionWorkerContext,
  auditFn: AuditFn,
): RunRetentionWorkerOutput {
  if (!ctx.isPrivileged) {
    return { success: false, kind: 'TENANT_DATA_LOSS_RISK', incidentClass: 'TENANT_DATA_OR_SECURITY', message: 'Retention worker requires privileged bypass context' };
  }

  if (!ctx.sourceDataAvailable) {
    return { success: false, kind: 'CONFIG_UNAVAILABLE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: 'Source data unavailable, fail-closed' };
  }

  const updatedCandidates: RetentionCandidate[] = [];

  for (const candidate of state.candidates) {
    const outcome = validateRetentionCandidate(state, candidate.tenantId, candidate.resource);
    
    if (outcome instanceof Error) {
      const auditError = auditEvent('RETENTION_EVALUATED', candidate.tenantId, { resource: candidate.resource, error: outcome.message }, auditFn);
      if (auditError !== null) {
         return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditError.message };
      }
    }

    const newCandidate: RetentionCandidate = {
      ...candidate,
      currentOutcome: outcome as RetentionOutcome,
      evaluatedAt: new Date().toISOString(),
    };
    updatedCandidates.push(newCandidate);
  }

  return {
    success: true,
    state: {
      ...state,
      candidates: updatedCandidates,
    },
  };
}

export function performRestoreDrill(
  state: SystemState,
  tenantId: string,
  pointInTime: string,
  auditFn: AuditFn,
): PerformRestoreDrillOutput {
  const auditError = auditEvent('RESTORE_DRILL', tenantId, { pointInTime }, auditFn);
  if (auditError !== null) {
    return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditError.message };
  }

  const tenantHolds = state.legalHolds.filter((h) => h.tenantId === tenantId);
  const tenantTags = state.residencyTags.filter((t) => t.tenantId === tenantId);

  if (tenantHolds.some((h) => h.state === 'ACTIVE')) {
    return { success: false, kind: 'TENANT_DATA_LOSS_RISK', incidentClass: 'TENANT_DATA_OR_SECURITY', message: 'Cannot restore drill: active legal hold blocks restore' };
  }

  return {
    success: true,
    timestamp: pointInTime,
    tenantIdsRestored: [tenantId],
  };
}

export function checkReadiness(
  state: SystemState,
  workerReachable: boolean,
  holdStoreReachable: boolean,
  residencyEnforcerReachable: boolean,
): CheckReadinessOutput {
  const issues: string[] = [];

  if (!workerReachable || !holdStoreReachable || !residencyEnforcerReachable) {
    issues.push('Core adapters unavailable');
  }

  if (state.residencyTags.length === 0) {
    issues.push('Residency configuration missing');
  }

  if (issues.length > 0) {
    return {
      ready: false,
      kind: 'READINESS_DEGRADED',
      message: issues.join('; '),
    };
  }

  const drillResult = performRestoreDrill(state, 'system-wide', new Date().toISOString(), () => null);
  if (drillResult.success === false) {
    return { ready: false, kind: drillResult.kind, message: drillResult.message };
  }

  return {
    ready: true,
    details: { workerReachable, holdStoreReachable, residencyEnforcerReachable },
  };
}