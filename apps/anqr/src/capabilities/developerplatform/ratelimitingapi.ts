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

export interface RateLimitAuditEvent {
  readonly kind: RateLimitAuditEventKind;
  readonly tenantId: string;
  readonly policyKey: string;
  readonly policy: unknown;
  readonly timestamp: string;
  readonly operatorId: string;
}

export interface RateLimitError {
  readonly kind: RateLimitErrorKind;
  readonly message: string;
}

export interface RateLimitPolicy {
  readonly tenantId: string;
  readonly policyKey: string;
  readonly entitlementKey: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly action: 'DENY' | 'ALLOW';
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
}

export interface RateLimitState {
  readonly policies: readonly RateLimitPolicy[];
  readonly counters: readonly RateLimitCounter[];
  readonly lastDecision: RateLimitDecision | null;
  readonly lastError: RateLimitError | null;
}

export const initialState: RateLimitState = {
  policies: [],
  counters: [],
  lastDecision: null,
  lastError: null,
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

export function createAuditEvent(
  tenantId: string,
  policyKey: string,
  policy: unknown,
  operatorId: string,
): RateLimitAuditEvent {
  return {
    kind: 'AUDIT_BEFORE_CHANGE',
    tenantId,
    policyKey,
    policy,
    timestamp: new Date().toISOString(),
    operatorId,
  };
}

export function validateTenantId(tenantId: string): boolean {
  return tenantId.length > 0 && /^[a-zA-Z0-9_-]+$/.test(tenantId);
}

export function validatePolicy(policy: RateLimitPolicy): RateLimitError | null {
  if (policy.limit <= 0) {
    return { kind: 'INVALID_POLICY', message: 'Limit must be positive' };
  }
  if (policy.windowSeconds <= 0) {
    return { kind: 'INVALID_POLICY', message: 'Window must be positive' };
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

export function getCurrentWindowStart(windowSeconds: number): number {
  const now = Date.now();
  return Math.floor(now / (windowSeconds * 1000)) * (windowSeconds * 1000);
}

export function getNextWindowStart(windowSeconds: number): number {
  const current = getCurrentWindowStart(windowSeconds);
  return current + windowSeconds * 1000;
}

export function calculateWindowExpiry(windowStart: number, windowSeconds: number): number {
  return windowStart + windowSeconds * 1000;
}

export function updatePolicy(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  policy: RateLimitPolicy,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
): RateLimitState | RateLimitError {
  if (!permissionFn('PLATFORM_RATE_LIMIT_WRITE', operatorId)) {
    return { kind: 'AUDIT_FAILURE', message: 'Operator permission denied for policy mutation' };
  }

  if (!validateTenantId(tenantId)) {
    return { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' };
  }

  const auditEvent = createAuditEvent(tenantId, policyKey, policy, operatorId);
  const auditError = auditFn(auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const policyValidationError = validatePolicy(policy);
  if (policyValidationError !== null) {
    return policyValidationError;
  }

  const existingIndex = state.policies.findIndex(
    (p) => p.policyKey === policyKey && p.tenantId === tenantId,
  );
  const newPolicies = [...state.policies];
  if (existingIndex >= 0) {
    newPolicies[existingIndex] = policy;
  } else {
    newPolicies.push(policy);
  }

  return {
    ...state,
    policies: newPolicies,
    lastDecision: null,
    lastError: null,
  };
}

export function setPolicy(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  entitlementKey: string,
  limit: number,
  windowSeconds: number,
  action: 'DENY' | 'ALLOW',
  operatorId: string,
  auditFn: (event: RateLimitAuditEvent) => RateLimitError | null,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
): RateLimitState | RateLimitError {
  const policy: RateLimitPolicy = {
    tenantId,
    policyKey,
    entitlementKey,
    limit,
    windowSeconds,
    action,
    updatedAt: new Date().toISOString(),
    updatedBy: operatorId,
  };
  return updatePolicy(state, tenantId, policyKey, policy, auditFn, permissionFn, operatorId);
}

export function readPolicy(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
  isOperator: boolean,
): RateLimitPolicy | RateLimitError {
  if (isOperator) {
    if (!permissionFn('PLATFORM_RATE_LIMIT_READ', operatorId)) {
      return { kind: 'AUDIT_FAILURE', message: 'Operator permission denied' };
    }
  } else {
    if (!permissionFn('TENANT_DEVELOPER_READ', operatorId)) {
      return { kind: 'AUDIT_FAILURE', message: 'Tenant permission denied' };
    }
  }

  const policy = state.policies.find(
    (p) => p.policyKey === policyKey && p.tenantId === tenantId,
  );

  if (policy === undefined) {
    return { kind: 'INVALID_POLICY', message: 'Policy not found' };
  }

  return policy;
}

export function readRateLimitSummary(
  state: RateLimitState,
  tenantId: string,
  permissionFn: (required: RateLimitPermission, operatorId: string) => boolean,
  operatorId: string,
  isOperator: boolean,
): { readonly policies: readonly RateLimitPolicy[] } | RateLimitError {
  if (isOperator) {
    if (!permissionFn('PLATFORM_RATE_LIMIT_READ', operatorId)) {
      return { kind: 'AUDIT_FAILURE', message: 'Operator permission denied' };
    }
  } else {
    if (!permissionFn('TENANT_DEVELOPER_READ', operatorId)) {
      return { kind: 'AUDIT_FAILURE', message: 'Tenant permission denied' };
    }
  }

  const tenantPolicies = state.policies.filter((p) => p.tenantId === tenantId);
  return { policies: tenantPolicies };
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
  return counter || null;
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
  const newCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart,
    usedCount,
    limit,
    exceeded,
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

export function evaluateRateLimit(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  token: { readonly entitlement: string } | null,
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
): { readonly decision: RateLimitDecision; readonly error: RateLimitError | null } {
  if (!validateTenantId(tenantId)) {
    return {
      decision: 'DENIED_TENANT_INVALID',
      error: { kind: 'TENANT_INVALID', message: 'Invalid tenant identifier' },
    };
  }

  const policy = state.policies.find(
    (p) => p.policyKey === policyKey && p.tenantId === tenantId,
  );

  if (policy === undefined) {
    return {
      decision: 'ALLOWED',
      error: null,
    };
  }

  if (token === null || token.entitlement !== policy.entitlementKey) {
    return {
      decision: 'DENIED_ENTITLEMENT_MISSING',
      error: { kind: 'ENTITLEMENT_DENIED', message: 'Missing required entitlement' },
    };
  }

  const windowStart = getCurrentWindowStart(policy.windowSeconds);

  let counter = cacheAdapter.getCounter(tenantId, policyKey, windowStart);
  const cacheAvailable = cacheAdapter.ping();

  if (counter === null && cacheAvailable) {
    counter = relationalAdapter.getCounter(tenantId, policyKey, windowStart);
    if (counter !== null) {
      cacheAdapter.setCounter(counter);
    }
  }

  if (counter === null) {
    const newUsedCount = 1;
    const exceeded = newUsedCount > policy.limit;
    const newCounter: RateLimitCounter = {
      tenantId,
      policyKey,
      windowStart,
      usedCount: newUsedCount,
      limit: policy.limit,
      exceeded,
    };

    if (cacheAvailable) {
      cacheAdapter.setCounter(newCounter);
    }
    relationalAdapter.setCounter(newCounter);

    return {
      decision: exceeded ? 'DENIED_LIMIT_EXCEEDED' : (cacheAvailable ? 'ALLOWED' : 'DEGRADED'),
      error: exceeded ? { kind: 'LIMIT_EXCEEDED', message: 'Rate limit exceeded' } : null,
    };
  }

  const newUsedCount = counter.usedCount + 1;
  const exceeded = newUsedCount > policy.limit;
  const updatedCounter: RateLimitCounter = {
    tenantId,
    policyKey,
    windowStart,
    usedCount: newUsedCount,
    limit: policy.limit,
    exceeded,
  };

  if (cacheAvailable) {
    cacheAdapter.setCounter(updatedCounter);
  } else {
    relationalAdapter.setCounter(updatedCounter);
    return {
      decision: 'DEGRADED',
      error: { kind: 'CACHE_UNAVAILABLE', message: 'Cache unavailable, using relational' },
    };
  }

  relationalAdapter.setCounter(updatedCounter);

  return {
    decision: exceeded ? 'DENIED_LIMIT_EXCEEDED' : 'ALLOWED',
    error: exceeded ? { kind: 'LIMIT_EXCEEDED', message: 'Rate limit exceeded' } : null,
  };
}

export function assertRateLimit(
  state: RateLimitState,
  tenantId: string,
  policyKey: string,
  token: { readonly entitlement: string } | null,
  cacheAdapter: RateLimitCacheAdapter,
  relationalAdapter: RateLimitRelationalAdapter,
): RateLimitState {
  const result = evaluateRateLimit(state, tenantId, policyKey, token, cacheAdapter, relationalAdapter);

  if (result.decision === 'DENIED_LIMIT_EXCEEDED') {
    throw new Error('Rate limit exceeded');
  }

  if (result.decision === 'DENIED_ENTITLEMENT_MISSING') {
    throw new Error('Entitlement denied');
  }

  if (result.decision === 'DENIED_TENANT_INVALID') {
    throw new Error('Invalid tenant');
  }

  if (result.decision === 'ERROR') {
    throw new Error(result.error?.message || 'Unknown error');
  }

  if (result.decision === 'DEGRADED') {
    const policy = state.policies.find(
      (p) => p.policyKey === policyKey && p.tenantId === tenantId,
    );
    if (policy) {
      const windowStart = getCurrentWindowStart(policy.windowSeconds);
      const counter = relationalAdapter.getCounter(tenantId, policyKey, windowStart);
      if (counter) {
        return createOrUpdateCounter(state, tenantId, policyKey, windowStart, counter.usedCount + 1, policy.limit);
      }
      const newCounter: RateLimitCounter = {
        tenantId,
        policyKey,
        windowStart,
        usedCount: 1,
        limit: policy.limit,
        exceeded: 1 > policy.limit,
      };
      relationalAdapter.setCounter(newCounter);
      return createOrUpdateCounter(state, tenantId, policyKey, windowStart, 1, policy.limit);
    }
    return state;
  }

  if (result.decision === 'ALLOWED') {
    const policy = state.policies.find(
      (p) => p.policyKey === policyKey && p.tenantId === tenantId,
    );
    if (policy) {
      const windowStart = getCurrentWindowStart(policy.windowSeconds);
      const existingCounter = getCounter(state, tenantId, policyKey, windowStart);
      const newUsedCount = existingCounter ? existingCounter.usedCount + 1 : 1;
      return createOrUpdateCounter(state, tenantId, policyKey, windowStart, newUsedCount, policy.limit);
    }
  }

  return state;
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

  if (cacheReady && !relationalReady) {
    return 'DEGRADED';
  }

  return 'UNAVAILABLE';
}

export function createMockCacheAdapter(
  counters: Map<string, RateLimitCounter>,
  pingResult: boolean,
): RateLimitCacheAdapter {
  return {
    getCounter: (tenantId: string, policyKey: string, windowStart: number): RateLimitCounter | null => {
      const key = `${tenantId}:${policyKey}:${windowStart}`;
      return counters.get(key) || null;
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
      return counters.get(key) || null;
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
): { readonly policies: readonly RateLimitPolicy[]; readonly counters: readonly RateLimitCounter[] } | RateLimitError {
  if (isOperator) {
    if (!permissionFn('PLATFORM_RATE_LIMIT_READ', operatorId)) {
      return { kind: 'AUDIT_FAILURE', message: 'Operator permission denied' };
    }
  } else {
    if (!permissionFn('TENANT_DEVELOPER_READ', operatorId)) {
      return { kind: 'AUDIT_FAILURE', message: 'Tenant permission denied' };
    }
  }

  const tenantPolicies = state.policies.filter((p) => p.tenantId === tenantId);
  const tenantCounters = state.counters.filter((c) => c.tenantId === tenantId);

  return {
    policies: tenantPolicies,
    counters: tenantCounters,
  };
}