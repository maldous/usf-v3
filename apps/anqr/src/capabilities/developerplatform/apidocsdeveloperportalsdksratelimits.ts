export const ApiDocsDeveloperPortalsSdksRateLimitsErrorKind = [
  'MISSING_TENANT_CONTEXT',
  'NOT_ENTITLED',
  'INVALID_TENANT_IDENTIFIER',
  'REVOKED_OR_INVALID_KEY',
  'OPENAPI_DRIFT',
  'PROVIDER_UNAVAILABLE',
] as const;
export type ApiDocsDeveloperPortalsSdksRateLimitsErrorKind = typeof ApiDocsDeveloperPortalsSdksRateLimitsErrorKind[number];

export const ApiKeyState = ['ACTIVE', 'REVOKED'] as const;
export type ApiKeyState = typeof ApiKeyState[number];

export const RateLimitExceededState = ['EXCEEDED', 'NOT_EXCEEDED'] as const;
export type RateLimitExceededState = typeof RateLimitExceededState[number];

export const Permission = [
  'TENANT_DEVELOPER_READ',
  'TENANT_API_KEY_READ',
  'TENANT_API_KEY_WRITE',
  'PLATFORM_API_KEY_OPERATOR',
  'PLATFORM_RATE_LIMIT_OPERATOR',
] as const;
export type Permission = typeof Permission[number];

export const Readiness = ['READY', 'DEGRADED', 'UNAVAILABLE'] as const;
export type Readiness = typeof Readiness[number];

export interface AuditMetadata {
  readonly actorId: string;
  readonly timestamp: string;
  readonly action: string;
}

export interface ApiKey {
  readonly id: string;
  readonly prefix: string;
  readonly hash: string;
  readonly state: ApiKeyState;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface RateLimitPolicy {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface RateLimitState {
  readonly policy: RateLimitPolicy;
  readonly currentWindowCount: number;
  readonly exceeded: RateLimitExceededState;
}

export interface DeveloperPortalSummary {
  readonly openApiContract: unknown;
  readonly graphQlContract: unknown;
  readonly sdkMaterials: readonly string[];
  readonly rateLimitVisibility: boolean;
}

export interface State {
  readonly apiKeys: readonly ApiKey[];
  readonly developerPortal: DeveloperPortalSummary | null;
  readonly rateLimits: ReadonlyMap<string, RateLimitState>;
  readonly auditLog: readonly AuditMetadata[];
  readonly readiness: Readiness;
}

export const initialState: State = {
  apiKeys: [],
  developerPortal: null,
  rateLimits: new Map(),
  auditLog: [],
  readiness: 'UNAVAILABLE',
};

export interface Error {
  readonly kind: ApiDocsDeveloperPortalsSdksRateLimitsErrorKind;
  readonly message: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error };

export function checkTenantContext(tenantId: string | null): Result<string> {
  if (tenantId === null || tenantId.trim() === '') {
    return { ok: false, error: { kind: 'MISSING_TENANT_CONTEXT', message: 'Tenant context is missing' } };
  }
  return { ok: true, value: tenantId };
}

export function checkEntitlement(entitlements: readonly Permission[]): Result<void> {
  const hasApiAccess = entitlements.includes('TENANT_API_KEY_WRITE');
  if (!hasApiAccess) {
    return { ok: false, error: { kind: 'NOT_ENTITLED', message: 'API-access entitlement is deny-by-default' } };
  }
  return { ok: true, value: undefined };
}

export function checkTenantIdentifier(tenantId: string): Result<string> {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(tenantId)) {
    return { ok: false, error: { kind: 'INVALID_TENANT_IDENTIFIER', message: 'Invalid tenant identifier format' } };
  }
  return { ok: true, value: tenantId };
}

export function checkOpenApiDrift(declaredContract: unknown, liveContract: unknown): Result<void> {
  if (JSON.stringify(declaredContract) !== JSON.stringify(liveContract)) {
    return { ok: false, error: { kind: 'OPENAPI_DRIFT', message: 'OpenAPI drift detected' } };
  }
  return { ok: true, value: undefined };
}

export function authenticateKey(apiKeys: readonly ApiKey[], keyPrefix: string, secret: string): ApiKey | null {
  const key = apiKeys.find(k => k.prefix === keyPrefix);
  if (!key || key.state === 'REVOKED') return null;
  return key;
}

export function generateApiKey(prefix: string, scopes: readonly string[]): { readonly secret: string; readonly hash: string } {
  const secret = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const hash = require('crypto').createHash('sha256').update(secret).digest('hex');
  return { secret, hash };
}

export function createApiKey(
  state: State,
  tenantId: string,
  actorId: string,
  scopes: readonly string[],
  auditFn: (metadata: AuditMetadata) => void,
): Result<{ readonly state: State; readonly secret: string }> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement([...state.apiKeys.map(k => 'TENANT_API_KEY_WRITE' as Permission)]);
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const { secret, hash } = generateApiKey(tenantId, scopes);
  const newKey: ApiKey = {
    id: require('crypto').randomUUID(),
    prefix: tenantId,
    hash,
    state: 'ACTIVE',
    scopes,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };

  const newState: State = {
    ...state,
    apiKeys: [...state.apiKeys, newKey],
  };

  auditFn({
    actorId,
    timestamp: new Date().toISOString(),
    action: 'API_KEY_CREATED',
  });

  return { ok: true, value: { state: newState, secret } };
}

export function revokeApiKey(
  state: State,
  tenantId: string,
  actorId: string,
  keyId: string,
  auditFn: (metadata: AuditMetadata) => void,
): Result<State> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement([...state.apiKeys.map(k => 'TENANT_API_KEY_WRITE' as Permission)]);
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const keyIndex = state.apiKeys.findIndex(k => k.id === keyId);
  if (keyIndex === -1) {
    return { ok: false, error: { kind: 'REVOKED_OR_INVALID_KEY', message: 'Key not found' } };
  }

  const key = state.apiKeys[keyIndex];
  if (key.state === 'REVOKED') {
    return { ok: false, error: { kind: 'REVOKED_OR_INVALID_KEY', message: 'Key already revoked' } };
  }

  const newKey: ApiKey = {
    ...key,
    state: 'REVOKED',
    revokedAt: new Date().toISOString(),
  };

  const newState: State = {
    ...state,
    apiKeys: [
      ...state.apiKeys.slice(0, keyIndex),
      newKey,
      ...state.apiKeys.slice(keyIndex + 1),
    ],
  };

  auditFn({
    actorId,
    timestamp: new Date().toISOString(),
    action: 'API_KEY_REVOKED',
  });

  return { ok: true, value: newState };
}

export function listApiKeys(state: State, tenantId: string): Result<readonly Omit<ApiKey, 'hash'>[]> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement([...state.apiKeys.map(k => 'TENANT_API_KEY_READ' as Permission)]);
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const keys = state.apiKeys
    .filter(k => k.prefix === tenantId)
    .map(({ hash, ...rest }) => rest);
  return { ok: true, value: keys };
}

export function buildDeveloperPortal(
  openApiContract: unknown,
  graphQlContract: unknown,
  sdkMaterials: readonly string[],
  rateLimitVisibility: boolean,
): DeveloperPortalSummary {
  return {
    openApiContract,
    graphQlContract,
    sdkMaterials,
    rateLimitVisibility,
  };
}

export function setDeveloperPortal(state: State, portal: DeveloperPortalSummary): State {
  return { ...state, developerPortal: portal };
}

export function evaluateRateLimit(
  state: State,
  tenantId: string,
  route: string,
): Result<RateLimitState> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const rateLimit = state.rateLimits.get(route);
  if (!rateLimit) {
    return { ok: false, error: { kind: 'PROVIDER_UNAVAILABLE', message: 'Rate limit not configured for route' } };
  }

  return { ok: true, value: rateLimit };
}

export function updateRateLimitPolicy(
  state: State,
  tenantId: string,
  actorId: string,
  route: string,
  policy: RateLimitPolicy,
  auditFn: (metadata: AuditMetadata) => void,
): Result<State> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement(['PLATFORM_RATE_LIMIT_OPERATOR' as Permission]);
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const newRateLimit: RateLimitState = {
    policy,
    currentWindowCount: 0,
    exceeded: 'NOT_EXCEEDED',
  };

  const newRateLimits = new Map(state.rateLimits);
  newRateLimits.set(route, newRateLimit);

  const newState: State = {
    ...state,
    rateLimits: newRateLimits,
  };

  auditFn({
    actorId,
    timestamp: new Date().toISOString(),
    action: 'RATE_LIMIT_POLICY_CHANGED',
  });

  return { ok: true, value: newState };
}

export function incrementRateLimitCount(state: State, route: string): State {
  const rateLimit = state.rateLimits.get(route);
  if (!rateLimit) return state;

  const newCount = rateLimit.currentWindowCount + 1;
  const exceeded: RateLimitExceededState =
    newCount > rateLimit.policy.maxRequests ? 'EXCEEDED' : 'NOT_EXCEEDED';

  const newRateLimit: RateLimitState = {
    ...rateLimit,
    currentWindowCount: newCount,
    exceeded,
  };

  const newRateLimits = new Map(state.rateLimits);
  newRateLimits.set(route, newRateLimit);

  return { ...state, rateLimits: newRateLimits };
}

export function computeReadiness(state: State): Readiness {
  if (state.developerPortal === null) return 'UNAVAILABLE';
  if (state.readiness === 'DEGRADED') return 'DEGRADED';
  return 'READY';
}