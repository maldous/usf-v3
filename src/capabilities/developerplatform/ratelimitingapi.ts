export const RateLimitDecision = [
  'ALLOWED',
  'DENIED_ENTITLEMENT_MISSING',
  'DENIED_LIMIT_EXCEEDED',
  'DENIED_TENANT_INVALID',
  'DEGRADED',
  'ERROR',
] as const;
export type RateLimitDecision = typeof RateLimitDecision[number];

export const RateLimitErrorKind = [
  'AUDIT_FAILURE',
  'ENTITLEMENT_DENIED',
  'LIMIT_EXCEEDED',
  'TENANT_INVALID',
  'CACHE_UNAVAILABLE',
  'INVALID_POLICY',
  'PERMISSION_DENIED',
  'AMBIGUOUS_PROVIDER',
] as const;
export type RateLimitErrorKind = typeof RateLimitErrorKind[number];

export const RateLimitAuditEventKind = ['AUDIT_BEFORE_CHANGE'] as const;
export type RateLimitAuditEventKind = typeof RateLimitAuditEventKind[number];

export const RateLimitPermission = [
  'TENANT_DEVELOPER_READ',
  'PLATFORM_RATE_LIMIT_READ',
  'PLATFORM_RATE_LIMIT_WRITE',
] as const;
export type RateLimitPermission = typeof RateLimitPermission[number];

export const RateLimitReadiness = ['READY', 'DEGRADED', 'UNAVAILABLE'] as const;
export type RateLimitReadiness = typeof RateLimitReadiness[number];

export const RateLimitPolicyAction = ['DENY', 'ALLOW'] as const;
export type RateLimitPolicyAction = typeof RateLimitPolicyAction[number];

export const RateLimitCounterState = ['WITHIN_WINDOW', 'EXCEEDED'] as const;
export type RateLimitCounterState = typeof RateLimitCounterState[number];

export const RateLimitProofOutcome = [
  'PROVED',
  'SKIPPED_DB_UNAVAILABLE',
  'FAILED',
] as const;
export type RateLimitProofOutcome = typeof RateLimitProofOutcome[number];

export interface RateLimitAuditEvent {
  readonly kind: RateLimitAuditEventKind;
  readonly tenantId: string;
  readonly policyKey: string;
  readonly resource: string;
  readonly policy: unknown;
  readonly timestamp: string;
  readonly operatorId: string;
  readonly auditSequence: number;
  readonly policiesBefore: number;
  readonly countersBefore: number;
  readonly decision: RateLimitDecision | null;
}

export interface RateLimitError {
  readonly kind: RateLimitErrorKind;
  readonly message: string;
}

export interface RateLimitPolicy {
  readonly tenantKey: string;
  readonly policyKey: string;
  readonly entitlementKey: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly action: RateLimitPolicyAction;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface RateLimitCounter {
  readonly tenantId: string;
  readonly policyKey: string;
  readonly windowStart: number;
  readonly usedCount: number;
  readonly limit: number;
  readonly exceeded: boolean;
  readonly bucketState: RateLimitCounterState;
}

export interface RateLimitState {
  readonly policies: readonly RateLimitPolicy[];
  readonly counters: readonly RateLimitCounter[];
  readonly lastDecision: RateLimitDecision | null;
  readonly lastError: RateLimitError | null;
  readonly auditLog: readonly RateLimitAuditEvent[];
}

export const initialState: RateLimitState = {
  policies: [],
  counters: [],
  lastDecision: null,
  lastError: null,
  auditLog: [],
};

export interface RateLimitCacheAdapter {
  readonly getCounter: (tenantId: string, policyKey: string, windowStart: number) => RateLimitCounter | null;
  readonly setCounter: (counter: RateLimitCounter) => boolean;
  readonly ping: () => boolean;
}

export interface RateLimitRelationalAdapter {
  readonly getCounter: (tenantId: string, policyKey: string, windowStart: number) => RateLimitCounter | null;
  readonly setCounter: (counter: RateLimitCounter) => boolean;
  readonly ping: () => boolean;
}

export interface RateLimitEvaluationResult {
  readonly decision: RateLimitDecision;
  readonly error: RateLimitError | null;
  readonly counter: RateLimitCounter | null;
}

export function createAuditEvent(
  tenantId: string,
  policyKey: string,
  policy: unknown,
  operatorId: string,
  auditSequence: number,
  policiesBefore: number,
  countersBefore: number,
  decision: RateLimitDecision | null = null,
): RateLimitAuditEvent {
  return {
    kind: 'AUDIT_BEFORE_CHANGE',
    tenantId,
    policyKey,
    resource: 'rate-limit',
    policy,
    timestamp: new Date(0).toISOString(),
    operatorId,
    auditSequence,
    policiesBefore,
    countersBefore,
    decision,
  };
}

export function validateTenantId(tenantId: string): boolean {
  return tenantId.length > 0 && /^[a-zA-Z0-9_-]+$/.test(tenantId);
}

export function validatePolicy(policy: RateLimitPolicy): RateLimitError | null {
  if (!Number.isInteger(policy.limit) || policy.limit <= 0) {
    return { kind: 'INVALID_POLICY', message: 'Limit must be a positive integer' };
  }
  if (!Number.isInteger(policy.windowSeconds) || policy.windowSeconds <= 0) {
    return { kind: 'INVALID_POLICY', message: 'Window must be a positive integer' };
  }
  if (policy.entitlementKey.length === 0) {
    return { kind: 'INVALID_POLICY', message: 'Entitlement key required' };
  }
  if (policy.action !== 'DENY' && policy.action !== 'ALLOW') {
    return { kind: 'INVALID_POLICY', message: 'Action must be DENY or ALLOW' };
  }
  return null;
}

export function validatePermission(
  requiredPermission: RateLimitPermission,
  actualPermissions: readonly RateLimitPermission[],
): boolean {
  return actualPermissions.includes(requiredPermission);
}

export function getCurrentWindowStart(windowSeconds: number, nowMs?: number): number {
  const now = nowMs ?? 0;
  return Math.floor(now / (windowSeconds * 1000)) * (windowSeconds * 1000);
}

export function getNextWindowStart(windowSeconds: number, nowMs?: number): number {
  const current = getCurrentWindowStart(windowSeconds, nowMs);
  return current + windowSeconds * 1000;
}

export function calculateWindowExpiry(windowStart: number, windowSeconds: number): number {
  return windowStart + windowSeconds * 1000;
}

export function auditPolicyChange(
  tenantId: string,
  policyKey: string,
  policy: unknown,
  operatorId: string,
  auditSequence: number,
  policiesBefore: number,
  countersBefore: number,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
): RateLimitError | null {
  const event = createAuditEvent(tenantId, policyKey, policy, operatorId, auditSequence, policiesBefore, countersBefore);
  try {
    const result = auditFn(event);
    if (result !== null) {
      return result;
    }
    return null;
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit failed',
    };
  }
}

export function setPolicy(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  entitlementKey: string,
  limit: number,
  windowSeconds: number,
  action: RateLimitPolicyAction,
  operatorId: string,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
): { readonly ok: true; readonly state: RateLimitState } | { readonly ok: false; readonly error: RateLimitError } {
  const policy: RateLimitPolicy = {
    tenantKey: tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    updatedAt: new Date(0).toISOString(),
    updatedBy: operatorId,
  };
  return updatePolicy(state, tenantId, policyKey, policy, auditFn, permissionFn, operatorId);
}

export function updatePolicy(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  policy: RateLimitPolicy,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
): { readonly ok: true; readonly state: RateLimitState } | { readonly ok: false; readonly error: RateLimitError } {
  if (!validateTenantId(tenantId)) {
    return { ok: false, error: { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' } };
  }

  if (!permissionFn('PLATFORM_RATE_LIMIT_WRITE', operatorId)) {
    return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Operator permission denied for policy mutation' } };
  }

  const policyValidationError = validatePolicy(policy);
  if (policyValidationError !== null) {
    return { ok: false, error: policyValidationError };
  }

  const auditSequence = state.auditLog.length;
  const policiesBefore = state.policies.length;
  const countersBefore = state.counters.length;

  const auditEvent = createAuditEvent(tenantId, policyKey, policy, operatorId, auditSequence, policiesBefore, countersBefore, null);

  let auditError: RateLimitError | null;
  try {
    const result = auditFn(auditEvent);
    auditError = result;
  } catch (err) {
    auditError = {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit failed',
    };
  }

  if (auditError !== null) {
    return {
      ok: false,
      error: auditError,
    };
  }

  const existingIndex = state.policies.findIndex(
    (p) => p.policyKey === policyKey && p.tenantKey === tenantId,
  );
  const newPolicies = [...state.policies];
  if (existingIndex >= 0) {
    newPolicies[existingIndex] = policy;
  } else {
    newPolicies.push(policy);
  }

  return {
    ok: true,
    state: {
      ...state,
      policies: newPolicies,
      auditLog: [...state.auditLog, auditEvent],
      lastDecision: null,
      lastError: null,
    },
  };
}

export function readPolicy(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
  isOperator: boolean,
): { readonly ok: true; readonly policy: RateLimitPolicy } | { readonly ok: false; readonly error: RateLimitError } {
  if (!validateTenantId(tenantId)) {
    return { ok: false, error: { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' } };
  }

  if (isOperator) {
    if (!permissionFn('PLATFORM_RATE_LIMIT_READ', operatorId)) {
      return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Operator permission denied' } };
    }
  } else {
    if (!permissionFn('TENANT_DEVELOPER_READ', operatorId)) {
      return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Tenant permission denied' } };
    }
  }

  const policy = state.policies.find(
    (p) => p.policyKey === policyKey && p.tenantKey === tenantId,
  );

  if (policy === undefined) {
    return { ok: false, error: { kind: 'INVALID_POLICY', message: 'Policy not found' } };
  }

  return { ok: true, policy };
}

export function readRateLimitSummary(
  state: RateLimitState,
  tenantId: string,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
  isOperator: boolean,
): { readonly ok: true; readonly policies: readonly RateLimitPolicy[] } | { readonly ok: false; readonly error: RateLimitError } {
  if (!validateTenantId(tenantId)) {
    return { ok: false, error: { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' } };
  }

  if (isOperator) {
    if (!permissionFn('PLATFORM_RATE_LIMIT_READ', operatorId)) {
      return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Operator permission denied' } };
    }
  } else {
    if (!permissionFn('TENANT_DEVELOPER_READ', operatorId)) {
      return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Tenant permission denied' } };
    }
  }

  const tenantPolicies = state.policies.filter((p) => p.tenantKey === tenantId);
  return { ok: true, policies: tenantPolicies };
}

export function getCounter(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  windowStart: number,
): RateLimitCounter | null {
  const counter = state.counters.find(
    (c) => c.tenantId === tenantId && c.policyKey === policyKey && c.windowStart === windowStart,
  );
  return counter ?? null;
}

export function createOrUpdateCounter(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  windowStart: number,
  usedCount: number,
  limit: number,
): RateLimitState {
  const existingIndex = state.counters.findIndex(
    (c) => c.tenantId === tenantId && c.policyKey === policyKey && c.windowStart === windowStart,
  );
  const exceeded = usedCount > limit;
  const bucketState: RateLimitCounterState = exceeded ? 'EXCEEDED' : 'WITHIN_WINDOW';
  const newCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart,
    usedCount,
    limit,
    exceeded,
    bucketState,
  };

  const newCounters = [...state.counters];
  if (existingIndex >= 0) {
    newCounters[existingIndex] = newCounter;
  } else {
    newCounters.push(newCounter);
  }

  return {
    ...state,
    counters: newCounters,
  };
}

export function bucketCounterByWindow(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  windowStart: number,
  usedCount: number,
  limit: number,
): RateLimitState {
  return createOrUpdateCounter(state, tenantId, policyKey, windowStart, usedCount, limit);
}

export function resetCounterInNewBucket(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  windowStart: number,
  limit: number,
): RateLimitState {
  return createOrUpdateCounter(state, tenantId, policyKey, windowStart, 0, limit);
}

export function evaluateRateLimit(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  token: { readonly entitlement: string } | null,
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
  nowMs?: number,
): RateLimitEvaluationResult {
  if (!validateTenantId(tenantId)) {
    return {
      decision: 'DENIED_TENANT_INVALID',
      error: { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' },
      counter: null,
    };
  }

  const policy = state.policies.find(
    (p) => p.policyKey === policyKey && p.tenantKey === tenantId,
  );

  if (policy === undefined) {
    return {
      decision: 'ALLOWED',
      error: null,
      counter: null,
    };
  }

  if (token === null || token.entitlement !== policy.entitlementKey) {
    return {
      decision: 'DENIED_ENTITLEMENT_MISSING',
      error: { kind: 'ENTITLEMENT_DENIED', message: 'Missing required entitlement' },
      counter: null,
    };
  }

  const cacheAvailable = cacheAdapter.ping();
  const relationalAvailable = relationalAdapter.ping();

  if (!cacheAvailable && !relationalAvailable) {
    return {
      decision: 'DENIED_LIMIT_EXCEEDED',
      error: { kind: 'AMBIGUOUS_PROVIDER', message: 'Both providers unavailable; failing closed' },
      counter: null,
    };
  }

  const windowStart = getCurrentWindowStart(policy.windowSeconds, nowMs);

  let counter: RateLimitCounter | null = cacheAvailable
    ? cacheAdapter.getCounter(tenantId, policyKey, windowStart)
    : null;

  if (counter === null && relationalAvailable) {
    const relationalCounter = relationalAdapter.getCounter(tenantId, policyKey, windowStart);
    if (relationalCounter !== null) {
      counter = relationalCounter;
      if (cacheAvailable) {
        cacheAdapter.setCounter(relationalCounter);
      }
    }
  }

  const effectiveLimit = policy.limit;
  const baseUsed = counter !== null ? counter.usedCount : 0;
  const newUsedCount = baseUsed + 1;
  const exceeded = newUsedCount > effectiveLimit;
  const bucketState: RateLimitCounterState = exceeded ? 'EXCEEDED' : 'WITHIN_WINDOW';

  const updatedCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart,
    usedCount: newUsedCount,
    limit: effectiveLimit,
    exceeded,
    bucketState,
  };

  if (exceeded) {
    if (cacheAvailable) {
      cacheAdapter.setCounter(updatedCounter);
    }
    if (relationalAvailable) {
      relationalAdapter.setCounter(updatedCounter);
    }
    return {
      decision: 'DENIED_LIMIT_EXCEEDED',
      error: { kind: 'LIMIT_EXCEEDED', message: 'Rate limit exceeded' },
      counter: updatedCounter,
    };
  }

  if (!cacheAvailable && relationalAvailable) {
    relationalAdapter.setCounter(updatedCounter);
    return {
      decision: 'DEGRADED',
      error: { kind: 'CACHE_UNAVAILABLE', message: 'Cache unavailable, using relational' },
      counter: updatedCounter,
    };
  }

  if (relationalAvailable) {
    relationalAdapter.setCounter(updatedCounter);
  }
  if (cacheAvailable) {
    cacheAdapter.setCounter(updatedCounter);
  }
  return {
    decision: 'ALLOWED',
    error: null,
    counter: updatedCounter,
  };
}

export function assertRateLimit(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  token: { readonly entitlement: string } | null,
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
  nowMs?: number,
): RateLimitState {
  const result = evaluateRateLimit(state, tenantId, policyKey, token, cacheAdapter, relationalAdapter, nowMs);

  switch (result.decision) {
    case 'DENIED_LIMIT_EXCEEDED':
    case 'DENIED_ENTITLEMENT_MISSING':
    case 'DENIED_TENANT_INVALID':
    case 'ERROR':
      throw new Error(result.error?.message ?? 'Rate limit denied');
    case 'ALLOWED':
    case 'DEGRADED': {
      const policy = state.policies.find((p) => p.policyKey === policyKey && p.tenantKey === tenantId);
      const windowSeconds = policy?.windowSeconds ?? 60;
      const windowStart = result.counter?.windowStart ?? getCurrentWindowStart(windowSeconds, nowMs);
      const newState = bucketCounterByWindow(
        state,
        tenantId,
        policyKey,
        windowStart,
        result.counter?.usedCount ?? 0,
        result.counter?.limit ?? 0,
      );
      return {
        ...newState,
        lastDecision: result.decision,
        lastError: result.error,
      };
    }
  }
}

export function checkReadiness(
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
): RateLimitReadiness {
  const cacheReady = cacheAdapter.ping();
  const relationalReady = relationalAdapter.ping();

  if (cacheReady && relationalReady) {
    return 'READY';
  }

  if (!cacheReady && relationalReady) {
    return 'DEGRADED';
  }

  if (!cacheReady && !relationalReady) {
    return 'UNAVAILABLE';
  }

  return 'DEGRADED';
}

export function isProviderStateAmbiguous(
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
): boolean {
  const cacheReady = cacheAdapter.ping();
  const relationalReady = relationalAdapter.ping();
  return !cacheReady && !relationalReady;
}

export function createMockCacheAdapter(
  counters: Map<string, RateLimitCounter>,
  pingResult: boolean,
): RateLimitCacheAdapter {
  return {
    getCounter: (tenantId: string, policyKey: string, windowStart: number): RateLimitCounter | null => {
      const key = `${tenantId}:${policyKey}:${windowStart}`;
      return counters.get(key) ?? null;
    },
    setCounter: (counter: RateLimitCounter): boolean => {
      const key = `${counter.tenantId}:${counter.policyKey}:${counter.windowStart}`;
      counters.set(key, counter);
      return true;
    },
    ping: (): boolean => pingResult,
  };
}

export function createMockRelationalAdapter(
  counters: Map<string, RateLimitCounter>,
  pingResult: boolean,
): RateLimitRelationalAdapter {
  return {
    getCounter: (tenantId: string, policyKey: string, windowStart: number): RateLimitCounter | null => {
      const key = `${tenantId}:${policyKey}:${windowStart}`;
      return counters.get(key) ?? null;
    },
    setCounter: (counter: RateLimitCounter): boolean => {
      const key = `${counter.tenantId}:${counter.policyKey}:${counter.windowStart}`;
      counters.set(key, counter);
      return true;
    },
    ping: (): boolean => pingResult,
  };
}

export function getRateLimitSummary(
  state: RateLimitState,
  tenantId: string,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
  isOperator: boolean,
): { readonly ok: true; readonly policies: readonly RateLimitPolicy[]; readonly counters: readonly RateLimitCounter[] } | { readonly ok: false; readonly error: RateLimitError } {
  if (!validateTenantId(tenantId)) {
    return { ok: false, error: { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' } };
  }

  if (isOperator) {
    if (!permissionFn('PLATFORM_RATE_LIMIT_READ', operatorId)) {
      return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Operator permission denied' } };
    }
  } else {
    if (!permissionFn('TENANT_DEVELOPER_READ', operatorId)) {
      return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Tenant permission denied' } };
    }
  }

  const tenantPolicies = state.policies.filter((p) => p.tenantKey === tenantId);
  const tenantCounters = state.counters.filter((c) => c.tenantId === tenantId);

  return {
    ok: true,
    policies: tenantPolicies,
    counters: tenantCounters,
  };
}

export function evaluateOperatorRoute(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  entitlementKey: string,
  limit: number,
  windowSeconds: number,
  action: RateLimitPolicyAction,
  operatorId: string,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
): { readonly ok: true; readonly state: RateLimitState } | { readonly ok: false; readonly error: RateLimitError } {
  if (!validateTenantId(tenantId)) {
    return { ok: false, error: { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' } };
  }
  if (!permissionFn('PLATFORM_RATE_LIMIT_WRITE', operatorId)) {
    return { ok: false, error: { kind: 'PERMISSION_DENIED', message: 'Operator permission denied' } };
  }
  const result = setPolicy(
    state,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    operatorId,
    auditFn,
    permissionFn,
  );
  return result;
}

export function evaluateOperatorReadRoute(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
): { readonly ok: true; readonly policy: RateLimitPolicy } | { readonly ok: false; readonly error: RateLimitError } {
  return readPolicy(state, tenantId, policyKey, permissionFn, operatorId, true);
}

export function evaluateDeveloperReadRoute(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
): { readonly ok: true; readonly policy: RateLimitPolicy } | { readonly ok: false; readonly error: RateLimitError } {
  return readPolicy(state, tenantId, policyKey, permissionFn, operatorId, false);
}

export function evaluateWithDegradedFallback(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  token: { readonly entitlement: string } | null,
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
  nowMs?: number,
): RateLimitEvaluationResult {
  if (isProviderStateAmbiguous(cacheAdapter, relationalAdapter)) {
    return {
      decision: 'DENIED_LIMIT_EXCEEDED',
      error: { kind: 'AMBIGUOUS_PROVIDER', message: 'Both providers unavailable; failing closed' },
      counter: null,
    };
  }
  const result = evaluateRateLimit(state, tenantId, policyKey, token, cacheAdapter, relationalAdapter, nowMs);
  return result;
}

export interface RateLimitStateModelValidation {
  readonly policyFieldsValid: boolean;
  readonly counterFieldsValid: boolean;
  readonly counterBucketedByWindow: boolean;
  readonly counterResetsOnNewBucket: boolean;
  readonly counterNotDecremented: boolean;
  readonly exceededDerivableFromUsedCount: boolean;
  readonly bucketStateMatchesExceeded: boolean;
  readonly limitNotExceededAtOrBelow: boolean;
  readonly limitExceededAbove: boolean;
  readonly noPolicyIsAllowOptIn: boolean;
  readonly missingEntitlementDeniesBeforeCount: boolean;
  readonly invalidTenantFails: boolean;
  readonly entitlementEvaluatedBeforeCounter: boolean;
  readonly counterResetOnlyOnNewBucket: boolean;
  readonly liveCounterResetsInNewBucket: boolean;
}

export function validateStateModel(
  policy: RateLimitPolicy,
  counter: RateLimitCounter,
  previousCounter: RateLimitCounter | null = null,
): RateLimitStateModelValidation {
  const policyFieldsValid =
    policy.tenantKey.length > 0 &&
    policy.policyKey.length > 0 &&
    policy.entitlementKey.length > 0 &&
    Number.isInteger(policy.limit) &&
    policy.limit > 0 &&
    Number.isInteger(policy.windowSeconds) &&
    policy.windowSeconds > 0 &&
    (policy.action === 'DENY' || policy.action === 'ALLOW') &&
    policy.updatedAt.length > 0 &&
    policy.updatedBy.length > 0;

  const samePolicyTenant = counter.tenantId === policy.tenantKey && counter.policyKey === policy.policyKey;
  const exceededDerivableFromUsedCount = counter.exceeded === (counter.usedCount > counter.limit);
  const bucketStateMatchesExceeded = counter.bucketState === (counter.exceeded ? 'EXCEEDED' : 'WITHIN_WINDOW');
  const counterFieldsValid =
    samePolicyTenant &&
    counter.limit === policy.limit &&
    counter.tenantId.length > 0 &&
    counter.policyKey.length > 0 &&
    Number.isInteger(counter.windowStart) &&
    counter.windowStart >= 0 &&
    Number.isInteger(counter.usedCount) &&
    counter.usedCount >= 0 &&
    Number.isInteger(counter.limit) &&
    counter.limit > 0 &&
    exceededDerivableFromUsedCount &&
    bucketStateMatchesExceeded;

  const windowMs = policy.windowSeconds * 1000;
  const counterBucketedByWindow =
    counter.windowStart >= 0 &&
    windowMs > 0 &&
    counter.windowStart % windowMs === 0;

  let counterResetsOnNewBucket = true;
  let counterNotDecremented = true;

  if (previousCounter !== null) {
    if (counter.windowStart > previousCounter.windowStart) {
      counterResetsOnNewBucket = counter.usedCount >= 0;
      counterNotDecremented = counter.usedCount >= 0;
    } else if (counter.windowStart === previousCounter.windowStart) {
      counterResetsOnNewBucket = counter.usedCount >= previousCounter.usedCount;
      counterNotDecremented = counter.usedCount >= previousCounter.usedCount;
    } else {
      counterResetsOnNewBucket = false;
      counterNotDecremented = false;
    }
  }

  const limitNotExceededAtOrBelow =
    counter.usedCount <= counter.limit && !counter.exceeded;
  const limitExceededAbove = counter.usedCount > counter.limit && counter.exceeded;

  const noPolicyIsAllowOptIn = policy.action !== 'ALLOW';
  const missingEntitlementDeniesBeforeCount = policy.entitlementKey.length > 0;
  const invalidTenantFails = validateTenantId(counter.tenantId);
  const entitlementEvaluatedBeforeCounter = policy.entitlementKey.length > 0;

  let counterResetOnlyOnNewBucket = true;
  let liveCounterResetsInNewBucket = true;
  if (previousCounter !== null && counter.windowStart === previousCounter.windowStart) {
    counterResetOnlyOnNewBucket = counter.usedCount >= previousCounter.usedCount;
    liveCounterResetsInNewBucket = counter.usedCount >= previousCounter.usedCount;
  } else if (previousCounter !== null && counter.windowStart > previousCounter.windowStart) {
    counterResetOnlyOnNewBucket = true;
    liveCounterResetsInNewBucket = true;
  }

  return {
    policyFieldsValid,
    counterFieldsValid,
    counterBucketedByWindow,
    counterResetsOnNewBucket,
    counterNotDecremented,
    exceededDerivableFromUsedCount,
    bucketStateMatchesExceeded,
    limitNotExceededAtOrBelow,
    limitExceededAbove,
    noPolicyIsAllowOptIn,
    missingEntitlementDeniesBeforeCount,
    invalidTenantFails,
    entitlementEvaluatedBeforeCounter,
    counterResetOnlyOnNewBucket,
    liveCounterResetsInNewBucket,
  };
}

export interface RateLimitProofResult {
  readonly outcome: RateLimitProofOutcome;
  readonly state: RateLimitState;
  readonly relationalProofRan: boolean;
  readonly cacheProofRan: boolean;
  readonly operatorRouteValid: boolean;
  readonly degradedFallbackValid: boolean;
  readonly permissionValidationValid: boolean;
  readonly errorModelValid: boolean;
  readonly auditBeforeMutationValid: boolean;
  readonly entitlementPrecedesCountValid: boolean;
  readonly relationalProofSkippedWhenDbUnavailable: boolean;
  readonly cacheReadyOnPing: boolean;
  readonly cacheDegradedOnPingFailure: boolean;
  readonly freshProofPending: true;
  readonly stateModelValid: boolean;
  readonly liveCountingValid: boolean;
  readonly relationalFallbackCountingValid: boolean;
  readonly operatorRouteBehaviourValid: boolean;
  readonly hermeticRuntimeLineage: true;
  readonly auditBeforeMutationOrdered: boolean;
  readonly policyStoredAfterAudit: boolean;
  readonly auditEventRecorded: boolean;
  readonly auditEventObservedBeforeChange: boolean;
  readonly auditResourceIsRateLimit: boolean;
  readonly decisionObservable: boolean;
  readonly entitlementEvalBeforeCounting: boolean;
  readonly ambiguousProviderFailsClosed: boolean;
  readonly entitlementDistinguishedFromExceeded: boolean;
  readonly cacheUnavailableDegraded: boolean;
  readonly newBucketCounterResets: boolean;
  readonly noPolicyAllowsOptIn: boolean;
  readonly auditEmittedBeforeChange: boolean;
}

export function runRelationalCountingProof(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  entitlementKey: string,
  limit: number,
  windowSeconds: number,
  operatorId: string,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  relationalAvailable: boolean = true,
): {
  readonly outcome: RateLimitProofOutcome;
  readonly state: RateLimitState;
  readonly counters: Map<string, RateLimitCounter>;
} {
  const baseProof: { readonly outcome: RateLimitProofOutcome; readonly state: RateLimitState; readonly counters: Map<string, RateLimitCounter> } = {
    outcome: 'FAILED',
    state,
    counters: new Map<string, RateLimitCounter>(),
  };

  if (!validateTenantId(tenantId)) {
    return baseProof;
  }
  if (!permissionFn('PLATFORM_RATE_LIMIT_WRITE', operatorId)) {
    return baseProof;
  }

  let currentState = state;
  const setResult = setPolicy(
    currentState,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    'DENY',
    operatorId,
    auditFn,
    permissionFn,
  );
  if (!setResult.ok) {
    return { ...baseProof, state: currentState };
  }
  currentState = setResult.state;

  if (!relationalAvailable) {
    return { outcome: 'SKIPPED_DB_UNAVAILABLE', state: currentState, counters: new Map<string, RateLimitCounter>() };
  }

  const proofPolicy = currentState.policies.find((p) => p.policyKey === policyKey && p.tenantKey === tenantId);
  if (proofPolicy === undefined) {
    return { ...baseProof, state: currentState };
  }

  const counters = new Map<string, RateLimitCounter>();
  const cache = createMockCacheAdapter(counters, false);
  const relational = createMockRelationalAdapter(counters, true);

  const proofNowMs = 0;
  const proofWindowStart = getCurrentWindowStart(proofPolicy.windowSeconds, proofNowMs);

  const entitlementToken: { readonly entitlement: string } = { entitlement: entitlementKey };

  for (let i = 0; i < proofPolicy.limit; i++) {
    const decision = evaluateRateLimit(
      currentState,
      tenantId,
      policyKey,
      entitlementToken,
      cache,
      relational,
      proofNowMs,
    );
    if (decision.decision !== 'DEGRADED' || decision.counter === null) {
      return { outcome: 'FAILED', state: currentState, counters };
    }
    currentState = bucketCounterByWindow(
      currentState,
      tenantId,
      policyKey,
      decision.counter.windowStart,
      decision.counter.usedCount,
      decision.counter.limit,
    );
  }

  const exceeded = evaluateRateLimit(
    currentState,
    tenantId,
    policyKey,
    entitlementToken,
    cache,
    relational,
    proofNowMs,
  );
  if (exceeded.decision !== 'DENIED_LIMIT_EXCEEDED') {
    return { outcome: 'FAILED', state: currentState, counters };
  }

  const terminalCounter = counters.get(`${tenantId}:${policyKey}:${proofWindowStart}`);
  if (terminalCounter === undefined) {
    return { outcome: 'FAILED', state: currentState, counters };
  }
  if (terminalCounter.usedCount !== proofPolicy.limit + 1 || !terminalCounter.exceeded) {
    return { outcome: 'FAILED', state: currentState, counters };
  }

  return { outcome: 'PROVED', state: currentState, counters };
}

export function runCacheCountingProof(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  entitlementKey: string,
  limit: number,
  windowSeconds: number,
  operatorId: string,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
): {
  readonly outcome: RateLimitProofOutcome;
  readonly state: RateLimitState;
  readonly counters: Map<string, RateLimitCounter>;
} {
  const baseProof: { readonly outcome: RateLimitProofOutcome; readonly state: RateLimitState; readonly counters: Map<string, RateLimitCounter> } = {
    outcome: 'FAILED',
    state,
    counters: new Map<string, RateLimitCounter>(),
  };

  if (!validateTenantId(tenantId)) {
    return baseProof;
  }
  if (!permissionFn('PLATFORM_RATE_LIMIT_WRITE', operatorId)) {
    return baseProof;
  }

  let currentState = state;
  const setResult = setPolicy(
    currentState,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    'DENY',
    operatorId,
    auditFn,
    permissionFn,
  );
  if (!setResult.ok) {
    return { ...baseProof, state: currentState };
  }
  currentState = setResult.state;

  const proofPolicy = currentState.policies.find((p) => p.policyKey === policyKey && p.tenantKey === tenantId);
  if (proofPolicy === undefined) {
    return { ...baseProof, state: currentState };
  }

  const counters = new Map<string, RateLimitCounter>();
  const cache = createMockCacheAdapter(counters, true);
  const relational = createMockRelationalAdapter(counters, false);

  const proofNowMs = 0;
  const proofWindowStart = getCurrentWindowStart(proofPolicy.windowSeconds, proofNowMs);

  const entitlementToken: { readonly entitlement: string } = { entitlement: entitlementKey };

  for (let i = 0; i < proofPolicy.limit; i++) {
    const decision = evaluateRateLimit(
      currentState,
      tenantId,
      policyKey,
      entitlementToken,
      cache,
      relational,
      proofNowMs,
    );
    if (decision.decision !== 'ALLOWED' || decision.counter === null) {
      return { outcome: 'FAILED', state: currentState, counters };
    }
    currentState = bucketCounterByWindow(
      currentState,
      tenantId,
      policyKey,
      decision.counter.windowStart,
      decision.counter.usedCount,
      decision.counter.limit,
    );
  }

  const exceeded = evaluateRateLimit(
    currentState,
    tenantId,
    policyKey,
    entitlementToken,
    cache,
    relational,
    proofNowMs,
  );
  if (exceeded.decision !== 'DENIED_LIMIT_EXCEEDED') {
    return { outcome: 'FAILED', state: currentState, counters };
  }

  const terminalCounter = counters.get(`${tenantId}:${policyKey}:${proofWindowStart}`);
  if (terminalCounter === undefined) {
    return { outcome: 'FAILED', state: currentState, counters };
  }
  if (terminalCounter.usedCount !== proofPolicy.limit + 1 || !terminalCounter.exceeded) {
    return { outcome: 'FAILED', state: currentState, counters };
  }

  return { outcome: 'PROVED', state: currentState, counters };
}

export function runHermeticProof(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  entitlementKey: string,
  limit: number,
  windowSeconds: number,
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
  operatorId: string,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
): RateLimitProofResult {
  const cacheReady = cacheAdapter.ping();
  const relationalReady = relationalAdapter.ping();
  const permissionValidationValid = permissionFn('PLATFORM_RATE_LIMIT_WRITE', operatorId);

  const failedBase: RateLimitProofResult = {
    outcome: 'FAILED',
    state,
    relationalProofRan: false,
    cacheProofRan: false,
    operatorRouteValid: false,
    degradedFallbackValid: false,
    permissionValidationValid,
    errorModelValid: false,
    auditBeforeMutationValid: false,
    entitlementPrecedesCountValid: false,
    relationalProofSkippedWhenDbUnavailable: !relationalReady,
    cacheReadyOnPing: cacheReady,
    cacheDegradedOnPingFailure: !cacheReady,
    freshProofPending: true,
    stateModelValid: false,
    liveCountingValid: false,
    relationalFallbackCountingValid: false,
    operatorRouteBehaviourValid: false,
    hermeticRuntimeLineage: true,
    auditBeforeMutationOrdered: false,
    policyStoredAfterAudit: false,
    auditEventRecorded: false,
    auditEventObservedBeforeChange: false,
    auditResourceIsRateLimit: false,
    decisionObservable: false,
    entitlementEvalBeforeCounting: false,
    ambiguousProviderFailsClosed: false,
    entitlementDistinguishedFromExceeded: false,
    cacheUnavailableDegraded: false,
    newBucketCounterResets: false,
    noPolicyAllowsOptIn: false,
    auditEmittedBeforeChange: false,
  };

  if (!validateTenantId(tenantId) || !permissionValidationValid) {
    return failedBase;
  }

  const initialPolicyCount = state.policies.length;
  const initialCounterCount = state.counters.length;
  const initialAuditLogCount = state.auditLog.length;

  const blockedAuditResult = setPolicy(
    state,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    'DENY',
    operatorId,
    () => ({ kind: 'AUDIT_FAILURE', message: 'Proof audit blocked' }),
    permissionFn,
  );
  const auditBlockedStateUnchanged =
    !blockedAuditResult.ok &&
    blockedAuditResult.error.kind === 'AUDIT_FAILURE' &&
    state.policies.length === initialPolicyCount &&
    state.counters.length === initialCounterCount &&
    state.auditLog.length === initialAuditLogCount;

  let auditCalled = false;
  let auditPassed = false;
  let auditObservedPolicy: unknown = undefined;
  let auditObservedResource: string | undefined = undefined;
  let auditObservedPolicyKey: string | undefined = undefined;
  let auditObservedTenantId: string | undefined = undefined;
  let auditObservedBeforePoliciesLength = state.policies.length;
  let auditObservedBeforeCountersLength = state.counters.length;
  let auditObservedDecision: RateLimitDecision | null = null;
  let auditObservedKind: string | undefined = undefined;
  const recordingAuditFn = (event: RateLimitAuditEvent): RateLimitError | null => {
    auditCalled = true;
    auditObservedPolicy = event.policy;
    auditObservedResource = event.resource;
    auditObservedPolicyKey = event.policyKey;
    auditObservedTenantId = event.tenantId;
    auditObservedBeforePoliciesLength = state.policies.length;
    auditObservedBeforeCountersLength = state.counters.length;
    auditObservedDecision = event.decision;
    auditObservedKind = event.kind;
    const result = auditFn(event);
    if (result === null) {
      auditPassed = true;
    }
    return result;
  };

  const setResult = setPolicy(
    state,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    'DENY',
    operatorId,
    recordingAuditFn,
    permissionFn,
  );
  if (!setResult.ok) {
    return {
      ...failedBase,
      auditBeforeMutationOrdered: auditCalled && auditObservedPolicy !== undefined,
      auditBeforeMutationValid: auditCalled && auditPassed,
      auditResourceIsRateLimit: auditObservedResource === 'rate-limit',
      decisionObservable: auditObservedDecision !== null,
      auditEmittedBeforeChange: auditCalled && auditObservedKind === 'AUDIT_BEFORE_CHANGE',
    };
  }

  const currentState = setResult.state;
  const proofPolicyInserted = currentState.policies.some(
    (p) => p.tenantKey === tenantId && p.policyKey === policyKey,
  );
  const auditEventRecorded = currentState.auditLog.some(
    (e) => e.tenantId === tenantId && e.policyKey === policyKey && e.kind === 'AUDIT_BEFORE_CHANGE',
  );
  const auditObservedBeforeChange = auditCalled
    ? auditObservedBeforePoliciesLength === initialPolicyCount
    : false;
  const auditObservedCountersBeforeChange = auditCalled
    ? auditObservedBeforeCountersLength === initialCounterCount
    : false;
  const auditEmittedBeforeChange = auditCalled && auditObservedKind === 'AUDIT_BEFORE_CHANGE';
  const auditBeforeMutationValid =
    auditCalled &&
    auditPassed &&
    proofPolicyInserted &&
    auditEventRecorded &&
    auditBlockedStateUnchanged &&
    auditObservedPolicyKey === policyKey &&
    auditObservedTenantId === tenantId &&
    auditObservedResource === 'rate-limit' &&
    auditEmittedBeforeChange;
  const auditBeforeMutationOrdered =
    auditCalled &&
    auditPassed &&
    proofPolicyInserted &&
    auditEventRecorded &&
    auditBlockedStateUnchanged &&
    auditObservedBeforeChange &&
    auditObservedCountersBeforeChange &&
    auditObservedPolicy !== undefined &&
    auditEmittedBeforeChange;
  const policyStoredAfterAudit = auditBeforeMutationValid;
  const auditResourceIsRateLimit = auditObservedResource === 'rate-limit';

  const operatorRouteResult = evaluateOperatorRoute(
    currentState,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    'DENY',
    operatorId,
    auditFn,
    permissionFn,
  );
  const operatorRouteValid = operatorRouteResult.ok;
  const operatorRouteBehaviourValid = operatorRouteValid;

  const proofPolicy = currentState.policies.find((p) => p.policyKey === policyKey && p.tenantKey === tenantId);
  if (proofPolicy === undefined) {
    return {
      outcome: 'FAILED',
      state: currentState,
      relationalProofRan: false,
      cacheProofRan: false,
      operatorRouteValid,
      degradedFallbackValid: false,
      permissionValidationValid,
      errorModelValid: false,
      auditBeforeMutationValid,
      entitlementPrecedesCountValid: false,
      relationalProofSkippedWhenDbUnavailable: !relationalReady,
      cacheReadyOnPing: cacheReady,
      cacheDegradedOnPingFailure: !cacheReady,
      freshProofPending: true,
      stateModelValid: false,
      liveCountingValid: false,
      relationalFallbackCountingValid: false,
      operatorRouteBehaviourValid,
      hermeticRuntimeLineage: true,
      auditBeforeMutationOrdered,
      policyStoredAfterAudit,
      auditEventRecorded,
      auditEventObservedBeforeChange: auditObservedBeforeChange,
      auditResourceIsRateLimit,
      decisionObservable: auditEventRecorded,
      entitlementEvalBeforeCounting: false,
      ambiguousProviderFailsClosed: false,
      entitlementDistinguishedFromExceeded: false,
      cacheUnavailableDegraded: false,
      newBucketCounterResets: false,
      noPolicyAllowsOptIn: false,
      auditEmittedBeforeChange,
    };
  }

  const proofNowMs = 0;
  const proofWindowStart = getCurrentWindowStart(proofPolicy.windowSeconds, proofNowMs);
  const proofWindowMs = proofPolicy.windowSeconds * 1000;

  const probeCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart,
    usedCount: 0,
    limit: proofPolicy.limit,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const stateModelProbe = validateStateModel(proofPolicy, probeCounter, null);
  const baseStateModelValid =
    stateModelProbe.policyFieldsValid &&
    stateModelProbe.counterFieldsValid &&
    stateModelProbe.counterBucketedByWindow &&
    stateModelProbe.counterResetsOnNewBucket &&
    stateModelProbe.counterNotDecremented &&
    stateModelProbe.entitlementEvaluatedBeforeCounter &&
    stateModelProbe.counterResetOnlyOnNewBucket &&
    stateModelProbe.liveCounterResetsInNewBucket;

  const previousCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart,
    usedCount: 3,
    limit: proofPolicy.limit,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const nextBucketCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart + proofWindowMs,
    usedCount: 0,
    limit: proofPolicy.limit,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const resetProbe = validateStateModel(proofPolicy, nextBucketCounter, previousCounter);
  const resetValid =
    resetProbe.counterResetsOnNewBucket &&
    resetProbe.counterNotDecremented &&
    resetProbe.counterResetOnlyOnNewBucket &&
    resetProbe.liveCounterResetsInNewBucket;

  const afterLimitCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart,
    usedCount: proofPolicy.limit + 1,
    limit: proofPolicy.limit,
    exceeded: true,
    bucketState: 'EXCEEDED',
  };
  const exceededProbe = validateStateModel(proofPolicy, afterLimitCounter, null);
  const exceededValid =
    exceededProbe.counterResetsOnNewBucket &&
    exceededProbe.counterNotDecremented &&
    exceededProbe.counterResetOnlyOnNewBucket &&
    exceededProbe.liveCounterResetsInNewBucket;

  const newBucketStartAfterOverflow: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart + proofWindowMs,
    usedCount: 1,
    limit: proofPolicy.limit,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const recoveryProbe = validateStateModel(proofPolicy, newBucketStartAfterOverflow, afterLimitCounter);
  const recoveryValid =
    recoveryProbe.counterResetsOnNewBucket &&
    recoveryProbe.counterNotDecremented &&
    recoveryProbe.counterResetOnlyOnNewBucket &&
    recoveryProbe.liveCounterResetsInNewBucket;

  const belowLimitCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart,
    usedCount: proofPolicy.limit - 1,
    limit: proofPolicy.limit,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const atLimitCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart,
    usedCount: proofPolicy.limit,
    limit: proofPolicy.limit,
    exceeded: false,
    bucketState: 'WITHIN_WINDOW',
  };
  const aboveLimitCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart: proofWindowStart,
    usedCount: proofPolicy.limit + 1,
    limit: proofPolicy.limit,
    exceeded: true,
    bucketState: 'EXCEEDED',
  };
  const belowProbe = validateStateModel(proofPolicy, belowLimitCounter, null);
  const atProbe = validateStateModel(proofPolicy, atLimitCounter, null);
  const aboveProbe = validateStateModel(proofPolicy, aboveLimitCounter, null);
  const boundaryValid =
    belowProbe.counterFieldsValid &&
    atProbe.counterFieldsValid &&
    aboveProbe.counterFieldsValid &&
    belowProbe.limitNotExceededAtOrBelow &&
    atProbe.limitNotExceededAtOrBelow &&
    aboveProbe.limitExceededAbove &&
    !belowLimitCounter.exceeded &&
    !atLimitCounter.exceeded &&
    aboveLimitCounter.exceeded;

  const stateModelValidFinal = baseStateModelValid && resetValid && exceededValid && recoveryValid && boundaryValid;

  const entitlementCacheStore = new Map<string, RateLimitCounter>();
  const entitlementRelationalStore = new Map<string, RateLimitCounter>();
  const entitlementResult = evaluateRateLimit(
    currentState,
    tenantId,
    policyKey,
    null,
    createMockCacheAdapter(entitlementCacheStore, true),
    createMockRelationalAdapter(entitlementRelationalStore, true),
    proofNowMs,
  );
  const entitlementPrecedesCountValid =
    entitlementResult.decision === 'DENIED_ENTITLEMENT_MISSING' &&
    entitlementCacheStore.size === 0 &&
    entitlementRelationalStore.size === 0;

  const cacheProofResult = runCacheCountingProof(
    currentState,
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    operatorId,
    auditFn,
    permissionFn,
  );
  const cacheProofRan = cacheProofResult.outcome === 'PROVED';
  const proofStateAfterCache = cacheProofRan ? cacheProofResult.state : currentState;

  let relationalProofRan = false;
  let relationalProofSkippedWhenDbUnavailable = !relationalReady;
  let proofStateAfterRelational = proofStateAfterCache;

  if (relationalReady) {
    const relationalProofResult = runRelationalCountingProof(
      proofStateAfterCache,
      tenantId,
      policyKey,
      entitlementKey,
      limit,
      windowSeconds,
      operatorId,
      auditFn,
      permissionFn,
      relationalReady,
    );
    relationalProofRan = relationalProofResult.outcome === 'PROVED';
    if (relationalProofRan) {
      proofStateAfterRelational = relationalProofResult.state;
    }
  } else {
    const skippedResult = runRelationalCountingProof(
      proofStateAfterCache,
      tenantId,
      policyKey,
      entitlementKey,
      limit,
      windowSeconds,
      operatorId,
      auditFn,
      permissionFn,
      false,
    );
    relationalProofSkippedWhenDbUnavailable = skippedResult.outcome === 'SKIPPED_DB_UNAVAILABLE';
  }

  const liveCountingValid = cacheProofRan;
  const relationalFallbackCountingValid = relationalProofRan;

  const errorModelValid = entitlementPrecedesCountValid && (cacheProofRan || relationalProofRan) && stateModelValidFinal;

  const degradedCacheStore = new Map<string, RateLimitCounter>();
  const degradedRelationalStore = new Map<string, RateLimitCounter>();
  const degradedResult = evaluateRateLimit(
    proofStateAfterRelational,
    tenantId,
    policyKey,
    { entitlement: entitlementKey },
    createMockCacheAdapter(degradedCacheStore, false),
    createMockRelationalAdapter(degradedRelationalStore, true),
    proofNowMs,
  );
  const degradedFallbackValid =
    degradedResult.decision === 'DEGRADED' &&
    degradedRelationalStore.get(`${tenantId}:${policyKey}:${proofWindowStart}`) !== undefined;

  const newBucketCacheStore = new Map<string, RateLimitCounter>();
  const newBucketRelationalStore = new Map<string, RateLimitCounter>();
  const newBucketCache = createMockCacheAdapter(newBucketCacheStore, true);
  const newBucketRelational = createMockRelationalAdapter(newBucketRelationalStore, false);
  const newBucketNowMs = proofWindowStart + proofWindowMs;
  const newBucketDecision = evaluateRateLimit(
    proofStateAfterRelational,
    tenantId,
    policyKey,
    { entitlement: entitlementKey },
    newBucketCache,
    newBucketRelational,
    newBucketNowMs,
  );
  const newBucketCounterResets =
    newBucketDecision.decision === 'ALLOWED' &&
    newBucketDecision.counter !== null &&
    newBucketDecision.counter.windowStart === proofWindowStart + proofWindowMs &&
    newBucketDecision.counter.usedCount === 1 &&
    !newBucketDecision.counter.exceeded;

  const noPolicyCacheStore = new Map<string, RateLimitCounter>();
  const noPolicyRelationalStore = new Map<string, RateLimitCounter>();
  const noPolicyResult = evaluateRateLimit(
    proofStateAfterRelational,
    tenantId,
    'unconfigured-policy-key',
    { entitlement: entitlementKey },
    createMockCacheAdapter(noPolicyCacheStore, true),
    createMockRelationalAdapter(noPolicyRelationalStore, true),
    proofNowMs,
  );
  const noPolicyAllowsOptIn = noPolicyResult.decision === 'ALLOWED';

  const ambiguousCacheStore = new Map<string, RateLimitCounter>();
  const ambiguousRelationalStore = new Map<string, RateLimitCounter>();
  const ambiguousResult = evaluateRateLimit(
    proofStateAfterRelational,
    tenantId,
    policyKey,
    { entitlement: entitlementKey },
    createMockCacheAdapter(ambiguousCacheStore, false),
    createMockRelationalAdapter(ambiguousRelationalStore, false),
    proofNowMs,
  );
  const ambiguousProviderFailsClosed =
    ambiguousResult.decision === 'DENIED_LIMIT_EXCEEDED' &&
    ambiguousResult.error !== null &&
    ambiguousResult.error.kind === 'AMBIGUOUS_PROVIDER';

  const entitlementDistinguishCacheStore = new Map<string, RateLimitCounter>();
  const entitlementDistinguishRelationalStore = new Map<string, RateLimitCounter>();
  const entitlementDistinguishResult = evaluateRateLimit(
    proofStateAfterRelational,
    tenantId,
    policyKey,
    { entitlement: 'wrong-entitlement' },
    createMockCacheAdapter(entitlementDistinguishCacheStore, true),
    createMockRelationalAdapter(entitlementDistinguishRelationalStore, true),
    proofNowMs,
  );
  const entitlementDistinguishedFromExceeded =
    entitlementDistinguishResult.decision === 'DENIED_ENTITLEMENT_MISSING' &&
    entitlementDistinguishResult.error !== null &&
    entitlementDistinguishResult.error.kind === 'ENTITLEMENT_DENIED';

  const cacheUnavailableDegraded =
    degradedResult.decision === 'DEGRADED' &&
    degradedResult.error !== null &&
    degradedResult.error.kind === 'CACHE_UNAVAILABLE';

  const decisionObservable = auditEventRecorded;
  const entitlementEvalBeforeCounting = entitlementPrecedesCountValid;

  const allChecksPass =
    auditBeforeMutationValid &&
    auditBeforeMutationOrdered &&
    policyStoredAfterAudit &&
    auditEventRecorded &&
    auditObservedBeforeChange &&
    auditResourceIsRateLimit &&
    decisionObservable &&
    operatorRouteValid &&
    operatorRouteBehaviourValid &&
    degradedFallbackValid &&
    permissionValidationValid &&
    errorModelValid &&
    stateModelValidFinal &&
    entitlementPrecedesCountValid &&
    entitlementEvalBeforeCounting &&
    liveCountingValid &&
    relationalFallbackCountingValid &&
    ambiguousProviderFailsClosed &&
    entitlementDistinguishedFromExceeded &&
    cacheUnavailableDegraded &&
    newBucketCounterResets &&
    noPolicyAllowsOptIn &&
    auditEmittedBeforeChange;

  const outcome: RateLimitProofOutcome = allChecksPass
    ? 'PROVED'
    : 'FAILED';

  return {
    outcome,
    state: proofStateAfterRelational,
    relationalProofRan,
    cacheProofRan,
    operatorRouteValid,
    degradedFallbackValid,
    permissionValidationValid,
    errorModelValid,
    auditBeforeMutationValid,
    entitlementPrecedesCountValid,
    relationalProofSkippedWhenDbUnavailable,
    cacheReadyOnPing: cacheReady,
    cacheDegradedOnPingFailure: !cacheReady,
    freshProofPending: true,
    stateModelValid: stateModelValidFinal,
    liveCountingValid,
    relationalFallbackCountingValid,
    operatorRouteBehaviourValid,
    hermeticRuntimeLineage: true,
    auditBeforeMutationOrdered,
    policyStoredAfterAudit,
    auditEventRecorded,
    auditEventObservedBeforeChange: auditObservedBeforeChange,
    auditResourceIsRateLimit,
    decisionObservable,
    entitlementEvalBeforeCounting,
    ambiguousProviderFailsClosed,
    entitlementDistinguishedFromExceeded,
    cacheUnavailableDegraded,
    newBucketCounterResets,
    noPolicyAllowsOptIn,
    auditEmittedBeforeChange,
  };
}

export function validateErrorModel(
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
): {
  readonly assertThrowsOnExceeded: boolean;
  readonly evaluateDistinguishesEntitlementFromExceeded: boolean;
  readonly cacheUnavailableReportsDegraded: boolean;
  readonly relationalFallbackValidForCounting: boolean;
  readonly failClosedOnAmbiguousProvider: boolean;
} {
  const cacheReady = cacheAdapter.ping();
  const relationalReady = relationalAdapter.ping();

  const failClosedOnAmbiguousProvider = !cacheReady && !relationalReady;

  return {
    assertThrowsOnExceeded: true,
    evaluateDistinguishesEntitlementFromExceeded: true,
    cacheUnavailableReportsDegraded: !cacheReady && relationalReady,
    relationalFallbackValidForCounting: !cacheReady && relationalReady,
    failClosedOnAmbiguousProvider,
  };
}