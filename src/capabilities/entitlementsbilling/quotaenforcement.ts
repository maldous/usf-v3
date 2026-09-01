export const QuotaEnforcementDecision = [
  'WITHIN',
  'EXCEEDED',
  'NO_ENTITLEMENT',
  'NO_QUOTA',
] as const;
export type QuotaEnforcementDecision = typeof QuotaEnforcementDecision[number];

export const QuotaEnforcementAuditEventKind = ['AUDIT_BEFORE_UPSERT'] as const;
export type QuotaEnforcementAuditEventKind = typeof QuotaEnforcementAuditEventKind[number];

export const QuotaEnforcementErrorKind = [
  'QUOTA_EXCEEDED',
  'ENTITLEMENT_REVOKED',
  'NO_ENTITLEMENT',
  'UNAUTHORIZED_OPERATOR',
  'STORAGE_UNAVAILABLE',
] as const;
export type QuotaEnforcementErrorKind = typeof QuotaEnforcementErrorKind[number];

export interface QuotaEnforcementAuditEvent {
  readonly kind: QuotaEnforcementAuditEventKind;
  readonly resource: string;
  readonly quota: QuotaRecord;
  readonly operator: string;
  readonly timestamp: string;
}

export interface QuotaEnforcementError {
  readonly kind: QuotaEnforcementErrorKind;
  readonly message: string;
}

export interface QuotaRecord {
  readonly quotaKey: string;
  readonly entitlementKey: string;
  readonly meterKey: string;
  readonly limit: number;
  readonly window: string;
  readonly denyAction: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface QuotaEvaluationState {
  readonly decision: QuotaEnforcementDecision;
  readonly currentUsage: number;
  readonly allowed: boolean;
  readonly projectedUsage: number;
}

export interface QuotaEnforcementState {
  readonly quotas: readonly QuotaRecord[];
  readonly currentUsage: readonly { readonly meterKey: string; readonly value: number }[];
  readonly lastDecision: QuotaEvaluationState | null;
  readonly lastError: QuotaEnforcementError | null;
  readonly readiness: 'READY' | 'DEGRADED' | 'NOT_READY';
}

export const initialState: QuotaEnforcementState = {
  quotas: [],
  currentUsage: [],
  lastDecision: null,
  lastError: null,
  readiness: 'NOT_READY',
};

export function auditQuotaUpsert(
  quota: QuotaRecord,
  operator: string,
  auditFn: (event: QuotaEnforcementAuditEvent) => QuotaEnforcementError | null,
): QuotaEnforcementError | null {
  const event: QuotaEnforcementAuditEvent = {
    kind: 'AUDIT_BEFORE_UPSERT',
    resource: quota.quotaKey,
    quota,
    operator,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function setQuota(
  state: QuotaEnforcementState,
  quota: QuotaRecord,
  operator: string,
  auditFn: (event: QuotaEnforcementAuditEvent) => QuotaEnforcementError | null,
): QuotaEnforcementState | QuotaEnforcementError {
  const auditError = auditQuotaUpsert(quota, operator, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const existingIndex = state.quotas.findIndex(
    (q) => q.quotaKey === quota.quotaKey,
  );
  const newQuotas = [...state.quotas];
  if (existingIndex >= 0) {
    newQuotas[existingIndex] = quota;
  } else {
    newQuotas.push(quota);
  }

  return {
    ...state,
    quotas: newQuotas,
    lastDecision: null,
    lastError: null,
  };
}

export function getQuota(
  state: QuotaEnforcementState,
  quotaKey: string,
): QuotaRecord | null {
  return state.quotas.find((q) => q.quotaKey === quotaKey) ?? null;
}

export function getCurrentUsage(
  state: QuotaEnforcementState,
  meterKey: string,
): number {
  const usage = state.currentUsage.find((u) => u.meterKey === meterKey);
  return usage?.value ?? 0;
}

export function evaluateQuota(
  state: QuotaEnforcementState,
  quotaKey: string,
  entitlementKey: string,
  deltaUsage: number,
): {
  readonly evaluation: QuotaEvaluationState;
  readonly error: QuotaEnforcementError | null;
} {
  const quota = getQuota(state, quotaKey);
  if (quota === null) {
    return {
      evaluation: {
        decision: 'NO_QUOTA',
        currentUsage: 0,
        allowed: true,
        projectedUsage: deltaUsage,
      },
      error: null,
    };
  }

  if (quota.entitlementKey !== entitlementKey) {
    return {
      evaluation: {
        decision: 'NO_ENTITLEMENT',
        currentUsage: 0,
        allowed: false,
        projectedUsage: 0,
      },
      error: {
        kind: 'NO_ENTITLEMENT',
        message: 'Entitlement does not match',
      },
    };
  }

  const currentUsage = getCurrentUsage(state, quota.meterKey);
  const projectedUsage = currentUsage + deltaUsage;

  if (projectedUsage > quota.limit) {
    return {
      evaluation: {
        decision: 'EXCEEDED',
        currentUsage,
        allowed: false,
        projectedUsage,
      },
      error: {
        kind: 'QUOTA_EXCEEDED',
        message: 'Projected usage exceeds quota limit',
      },
    };
  }

  return {
    evaluation: {
      decision: 'WITHIN',
      currentUsage,
      allowed: true,
      projectedUsage,
    },
    error: null,
  };
}

export function assertQuota(
  state: QuotaEnforcementState,
  quotaKey: string,
  entitlementKey: string,
  deltaUsage: number,
): QuotaEvaluationState | QuotaEnforcementError {
  const { evaluation, error } = evaluateQuota(state, quotaKey, entitlementKey, deltaUsage);
  if (error !== null) {
    return error;
  }
  if (!evaluation.allowed) {
    return {
      kind: 'QUOTA_EXCEEDED',
      message: 'Quota assertion failed',
    };
  }
  return evaluation;
}

export function updateUsage(
  state: QuotaEnforcementState,
  meterKey: string,
  delta: number,
): QuotaEnforcementState {
  const existingIndex = state.currentUsage.findIndex(
    (u) => u.meterKey === meterKey,
  );
  const newUsage = [...state.currentUsage];
  if (existingIndex >= 0) {
    newUsage[existingIndex] = {
      meterKey,
      value: newUsage[existingIndex].value + delta,
    };
  } else {
    newUsage.push({ meterKey, value: delta });
  }

  return {
    ...state,
    currentUsage: newUsage,
  };
}

export function checkReadiness(
  state: QuotaEnforcementState,
  storageAvailable: boolean,
): QuotaEnforcementState {
  if (!storageAvailable) {
    return {
      ...state,
      readiness: 'DEGRADED',
    };
  }

  return {
    ...state,
    readiness: 'READY',
  };
}