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

export const GlobalErrorKind = [
  'AUDIT_FAILURE',
  'TENANT_DATA_LOSS_RISK',
  'CONFIG_UNAVAILABLE',
  'READINESS_DEGRADED',
  'VALIDATION_FAILURE',
] as const;
export type GlobalErrorKind = typeof GlobalErrorKind[number];

export const LegalHoldErrorKind = [
  ...GlobalErrorKind,
  'INVALID_ACTOR',
  'INVALID_REASON',
  'HOLD_NOT_FOUND',
  'ALREADY_RELEASED',
] as const;
export type LegalHoldErrorKind = typeof LegalHoldErrorKind[number];

export const ResidencyErrorKind = [
  ...GlobalErrorKind,
  'INVALID_REGION',
  'TAG_CONFLICT',
] as const;
export type ResidencyErrorKind = typeof ResidencyErrorKind[number];

export const RetentionErrorKind = [
  ...GlobalErrorKind,
] as const;
export type RetentionErrorKind = typeof RetentionErrorKind[number];

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
  readonly timeToLiveMillis: number;
  readonly applyFilter: 'ALL' | 'BY_STATUS';
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
  readonly newState: SystemState;
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
  readonly newState: SystemState;
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
  readonly newState: SystemState;
}
export interface SetResidencyTagError {
  readonly success: false;
  readonly kind: ResidencyErrorKind;
  readonly incidentClass?: IncidentClass;
  readonly message: string;
}
export type SetResidencyTagOutput = SetResidencyTagResult | SetResidencyTagError;

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
  readonly ready: true;
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
  if (!actor) return { success: false, kind: 'INVALID_ACTOR', message: 'Actor required' };
  if (!reason) return { success: false, kind: 'INVALID_REASON', message: 'Reason required' };

  const newHold: LegalHoldRecord = {
    tenantId,
    resource,
    reason,
    setBy: actor,
    setTimestamp: new Date().toISOString(),
    state: 'ACTIVE',
  };

  const auditErr = auditEvent('LEGAL_HOLD_SET', tenantId, newHold, auditFn);
  if (auditErr) return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditErr.message };

  return {
    success: true,
    hold: newHold,
    newState: {
      ...state,
      legalHolds: [...state.legalHolds, newHold],
    },
  };
}

export function releaseLegalHold(
  state: SystemState,
  tenantId: string,
  resource: string,
  actor: string,
  auditFn: AuditFn,
): ReleaseLegalHoldOutput {
  if (!actor) return { success: false, kind: 'INVALID_ACTOR', message: 'Actor required' };

  const idx = state.legalHolds.findIndex(h => h.tenantId === tenantId && h.resource === resource && h.state === 'ACTIVE');
  if (idx === -1) return { success: false, kind: 'HOLD_NOT_FOUND', message: 'No active hold' };

  const hold = state.legalHolds[idx];
  const updatedHold: LegalHoldRecord = {
    ...hold,
    releasedBy: actor,
    releasedTimestamp: new Date().toISOString(),
    state: 'RELEASED',
  };

  const auditErr = auditEvent('LEGAL_HOLD_RELEASED', tenantId, updatedHold, auditFn);
  if (auditErr) return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditErr.message };

  const newHolds = [...state.legalHolds];
  newHolds[idx] = updatedHold;

  return {
    success: true,
    hold: updatedHold,
    newState: { ...state, legalHolds: newHolds },
  };
}

export function setResidencyTag(
  state: SystemState,
  tenantId: string,
  homeRegion: string,
  auditFn: AuditFn,
): SetResidencyTagOutput {
  if (!homeRegion) return { success: false, kind: 'INVALID_REGION', message: 'Region required' };

  const tag: ResidencyTagRecord = { tenantId, homeRegion };
  const auditErr = auditEvent('RESIDENCY_TAG_SET', tenantId, tag, auditFn);
  if (auditErr) return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditErr.message };

  const filtered = state.residencyTags.filter(t => t.tenantId !== tenantId);
  return {
    success: true,
    tag,
    newState: { ...state, residencyTags: [...filtered, tag] },
  };
}

export function validateResidencyWrite(
  state: SystemState,
  tenantId: string,
  targetRegion: string,
): boolean {
  const tag = state.residencyTags.find(t => t.tenantId === tenantId);
  if (!tag) return false;
  return tag.homeRegion === targetRegion;
}

export function validateRetentionCandidate(
  state: SystemState,
  candidate: RetentionCandidate,
  now: number,
): RetentionOutcome {
  const policy = state.retentionPolicies.find(p => p.tenantId === candidate.tenantId && p.enabled);
  if (!policy) return 'PENDING';

  const activeHold = state.legalHolds.find(h => h.tenantId === candidate.tenantId && h.resource === candidate.resource && h.state === 'ACTIVE');
  if (activeHold) return 'HELD';

  const createdAt = Date.parse(candidate.evaluatedAt);
  if (isNaN(createdAt)) return 'PENDING';

  if (now - createdAt > policy.timeToLiveMillis) {
    return 'DELETED';
  }

  return 'PENDING';
}

export function runRetentionWorker(
  state: SystemState,
  ctx: RetentionWorkerContext,
  auditFn: AuditFn,
): RunRetentionWorkerOutput {
  if (!ctx.isPrivileged) return { success: false, kind: 'VALIDATION_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: 'Privilege required' };
  if (!ctx.sourceDataAvailable) return { success: false, kind: 'CONFIG_UNAVAILABLE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: 'Fail-closed' };

  const now = Date.now();
  const nextCandidates: RetentionCandidate[] = [];

  for (const c of state.candidates) {
    const outcome = validateRetentionCandidate(state, c, now);
    const auditErr = auditEvent('RETENTION_EVALUATED', c.tenantId, { resource: c.resource, outcome }, auditFn);
    if (auditErr) return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditErr.message };
    
    nextCandidates.push({ ...c, currentOutcome: outcome, evaluatedAt: new Date().toISOString() });
  }

  return {
    success: true,
    state: { ...state, candidates: nextCandidates },
  };
}

export function performRestoreDrill(
  state: SystemState,
  tenantId: string,
  pointInTime: string,
  auditFn: AuditFn,
): PerformRestoreDrillOutput {
  const auditErr = auditEvent('RESTORE_DRILL', tenantId, { pointInTime }, auditFn);
  if (auditErr) return { success: false, kind: 'AUDIT_FAILURE', incidentClass: 'TENANT_DATA_OR_SECURITY', message: auditErr.message };

  const hasActiveHold = state.legalHolds.some(h => h.tenantId === tenantId && h.state === 'ACTIVE');
  if (hasActiveHold) return { success: false, kind: 'TENANT_DATA_LOSS_RISK', incidentClass: 'TENANT_DATA_OR_SECURITY', message: 'Hold blocks restore' };

  return { success: true, timestamp: pointInTime, tenantIdsRestored: [tenantId] };
}

export function checkReadiness(
  state: SystemState,
  workerReachable: boolean,
  holdStoreReachable: boolean,
  residencyEnforcerReachable: boolean,
  drillSuccess: boolean,
): CheckReadinessOutput {
  if (!workerReachable || !holdStoreReachable || !residencyEnforcerReachable || !drillSuccess) {
    return { ready: false, kind: 'READINESS_DEGRADED', message: 'Capability adapters or drills failed' };
  }
  return { ready: true, details: { workerReachable, holdStoreReachable, residencyEnforcerReachable, drillSuccess } };
}