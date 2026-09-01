```typescript
// ------------------------------------------------------------
// Capability Module: apidocsdeveloperportalsdksratelimits
// Domain: developerplatform
// ------------------------------------------------------------

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
  'API_ACCESS',
] as const;
export type Permission = typeof Permission[number];

export const Readiness = ['READY', 'DEGRADED', 'UNAVAILABLE'] as const;
export type Readiness = typeof Readiness[number];

export interface AuditMetadata {
  readonly actorId: string;
  readonly timestamp: string;
  readonly action: string;
  readonly tenantId: string;
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

// ------------------------------------------------------------
// Helper constants & types
// ------------------------------------------------------------

const API_ACCESS = 'API_ACCESS';

// ------------------------------------------------------------
// Audit model – carries actor metadata, never leaks secret / hash
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// Core API‑key management
// ------------------------------------------------------------

export function hashSecret(secret: string): string {
  const hashBuffer = Buffer.from(secret, 'utf8');
  let hash = 0;
  for (let i = 0; i < hashBuffer.length; i++) {
    hash = (hash << 5) - hash + hashBuffer[i];
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function authenticateKey(apiKeys: readonly ApiKey[], keyPrefix: string, secret: string): ApiKey | null {
  const key = apiKeys.find(k => k.prefix === keyPrefix);
  if (!key || key.state === 'REVOKED') return null;
  const computedHash = hashSecret(secret);
  return key.hash === computedHash ? key : null;
}

export function generateApiKey(prefix: string, scopes: readonly string[]): { readonly secret: string; readonly hash: string } {
  const secret = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const hash = hashSecret(secret);
  return { secret, hash };
}

/**
 * Creates a new API key after performing all pre‑mutation audits.
 * Requires TENANT_API_KEY_READ and API_ACCESS (deny‑by‑default).
 */
export function createApiKey(
  state: State,
  tenantId: string,
  actorId: string,
  scopes: readonly string[],
  auditFn: (metadata: AuditMetadata) => void,
  entitlements: readonly Permission[],
): Result<{ readonly state: State; readonly secret: string }> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  // Additional gate: API_ACCESS must be present for creation
  if (!entitlements.includes('TENANT_API_KEY_READ') || !entitlements.includes('API_ACCESS')) {
    return { ok: false, error: { kind: 'NOT_ENTITLED', message: 'Missing required permissions' } };
  }

  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const { secret, hash } = generateApiKey(tenantId, scopes);
  const newKey: ApiKey = {
    id: 'id-' + Math.random().toString(36).substring(2, 11),
    prefix: tenantId,
    hash,
    state: 'ACTIVE',
    scopes,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };

  const auditMetadata: AuditMetadata = {
    actorId,
    timestamp: new Date().toISOString(),
    action: 'API_KEY_CREATED',
    tenantId,
  };
  auditFn(auditMetadata);

  const newState: State = {
    ...state,
    apiKeys: [...state.apiKeys, newKey],
    auditLog: [...state.auditLog, auditMetadata],
  };

  return { ok: true, value: { state: newState, secret } };
}

export function revokeApiKey(
  state: State,
  tenantId: string,
  actorId: string,
  keyId: string,
  auditFn: (metadata: AuditMetadata) => void,
  entitlements: readonly Permission[],
): Result<State> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const hasWritePermission = entitlements.includes('TENANT_API_KEY_WRITE');
  if (!hasWritePermission) {
    return { ok: false, error: { kind: 'NOT_ENTITLED', message: 'Missing TENANT_API_KEY_WRITE permission' } };
  }

  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const keyIndex = state.apiKeys.findIndex(k => k.id === keyId);
  if (keyIndex === -1) {
    return { ok: false, error: { kind: 'REVOKED_OR_INVALID_KEY', message: 'Key not found' } };
  }

  const key = state.apiKeys[keyIndex];
  if (key.state === 'REVOKED') {
    return { ok: false, error: { kind: 'REVOKED_OR_INVALID_KEY', message: 'Key already revoked' }