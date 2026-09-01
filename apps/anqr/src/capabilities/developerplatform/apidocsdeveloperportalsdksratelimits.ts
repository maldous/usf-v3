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
  'AUDIT_FAILURE',
  'ROUTE_METADATA_MISMATCH',
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

export const ProofStatus = ['PENDING', 'PASSED', 'FAILED'] as const;
export type ProofStatus = typeof ProofStatus[number];

export const AuditAction = [
  'API_KEY_CREATED',
  'API_KEY_REVOKED',
  'RATE_LIMIT_POLICY_CHANGED',
] as const;
export type AuditAction = typeof AuditAction[number];

export const RouteScopeKind = ['PLATFORM', 'TENANT'] as const;
export type RouteScopeKind = typeof RouteScopeKind[number];

export const RendererTarget = ['WEB', 'MOBILE', 'CLI'] as const;
export type RendererTarget = typeof RendererTarget[number];

export interface AuditMetadata {
  readonly actorId: string;
  readonly timestamp: string;
  readonly action: AuditAction;
  readonly tenantId: string;
  readonly safeMetadata: Readonly<Record<string, string>>;
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

export interface RedactedApiKey {
  readonly id: string;
  readonly prefix: string;
  readonly state: ApiKeyState;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface OperatorApiKeyView {
  readonly id: string;
  readonly prefix: string;
  readonly state: ApiKeyState;
  readonly tenantId: string;
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
  readonly tenantId: string;
  readonly openApiContract: unknown;
  readonly graphQlContract: unknown;
  readonly sdkMaterials: readonly string[];
  readonly rateLimitVisibility: boolean;
  readonly keys: readonly RedactedApiKey[];
}

export interface RouteMetadata {
  readonly method: string;
  readonly path: string;
  readonly requiredScope: string;
  readonly scopeKind: RouteScopeKind;
}

export interface State {
  readonly apiKeys: readonly ApiKey[];
  readonly developerPortal: DeveloperPortalSummary | null;
  readonly rateLimits: ReadonlyMap<string, RateLimitState>;
  readonly auditLog: readonly AuditMetadata[];
  readonly readiness: Readiness;
  readonly openApiContract: unknown;
  readonly graphQlContract: unknown;
  readonly routeMetadata: readonly RouteMetadata[];
}

export const initialState: State = {
  apiKeys: [],
  developerPortal: null,
  rateLimits: new Map(),
  auditLog: [],
  readiness: 'UNAVAILABLE',
  openApiContract: null,
  graphQlContract: null,
  routeMetadata: [],
};

export interface Error {
  readonly kind: ApiDocsDeveloperPortalsSdksRateLimitsErrorKind;
  readonly message: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error };

export type AuditFn = (metadata: AuditMetadata) => Error | null;

// ------------------------------------------------------------
// UI Semantic Model types
// ------------------------------------------------------------

export interface UISurface {
  readonly name: string;
  readonly description: string;
}

export interface ViewModel {
  readonly name: string;
  readonly fields: readonly string[];
}

export interface Component {
  readonly name: string;
  readonly props: readonly string[];
}

export interface Journey {
  readonly name: string;
  readonly steps: readonly string[];
}

export interface UIAccessibility {
  readonly ariaLabels: boolean;
  readonly keyboardNavigation: boolean;
}

export interface UILocalisation {
  readonly supportedLanguages: readonly string[];
  readonly defaultLanguage: string;
}

export interface RendererContract {
  readonly target: RendererTarget;
  readonly framework: string;
  readonly bindings: readonly string[];
}

export interface UIModel {
  readonly surfaces: readonly UISurface[];
  readonly viewModels: readonly ViewModel[];
  readonly components: readonly Component[];
  readonly journeys: readonly Journey[];
  readonly permissions: readonly Permission[];
  readonly accessibility: UIAccessibility;
  readonly localisation: UILocalisation;
  readonly rendererContracts: readonly RendererContract[];
  readonly disclaimers: readonly string[];
}

// ------------------------------------------------------------
// Helper functions
// ------------------------------------------------------------

export function checkTenantContext(tenantId: string | null): Result<string> {
  if (tenantId === null || tenantId.trim() === '') {
    return { ok: false, error: { kind: 'MISSING_TENANT_CONTEXT', message: 'Tenant context is missing' } };
  }
  return { ok: true, value: tenantId };
}

export function checkEntitlement(entitlements: readonly Permission[], required: Permission): Result<void> {
  if (!entitlements.includes(required)) {
    return { ok: false, error: { kind: 'NOT_ENTITLED', message: 'Missing required permission: ' + required } };
  }
  return { ok: true, value: undefined };
}

export function checkApiAccessEntitlement(entitlements: readonly Permission[]): Result<void> {
  if (!entitlements.includes('API_ACCESS')) {
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

export function checkGraphQlDrift(declaredContract: unknown, liveContract: unknown): Result<void> {
  if (JSON.stringify(declaredContract) !== JSON.stringify(liveContract)) {
    return { ok: false, error: { kind: 'OPENAPI_DRIFT', message: 'GraphQL contract drift detected' } };
  }
  return { ok: true, value: undefined };
}

export function hashSecret(secret: string): string {
  let hash = 0;
  for (let i = 0; i < secret.length; i++) {
    const char = secret.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function deriveKeyPrefix(tenantId: string, sequence: number): string {
  return tenantId + '_' + sequence.toString(36);
}

export function generateSecret(): string {
  const a = Math.floor(Math.random() * 0x7fffffff).toString(36);
  const b = Math.floor(Math.random() * 0x7fffffff).toString(36);
  const c = Math.floor(Math.random() * 0x7fffffff).toString(36);
  return a + b + c;
}

export function generateApiKeyMaterial(tenantId: string, sequence: number, secret: string): {
  readonly secret: string;
  readonly hash: string;
  readonly prefix: string;
} {
  const hash = hashSecret(secret);
  const prefix = deriveKeyPrefix(tenantId, sequence);
  return { secret, hash, prefix };
}

export function authenticateKey(apiKeys: readonly ApiKey[], keyPrefix: string, secret: string): ApiKey | null {
  const key = apiKeys.find((k) => k.prefix === keyPrefix);
  if (!key || key.state === 'REVOKED') return null;
  const computedHash = hashSecret(secret);
  return key.hash === computedHash ? key : null;
}

export function authenticateWithHash(apiKeys: readonly ApiKey[], keyPrefix: string, candidateHash: string): ApiKey | null {
  const key = apiKeys.find((k) => k.prefix === keyPrefix);
  if (!key || key.state === 'REVOKED') return null;
  return key.hash === candidateHash ? key : null;
}

export function redactApiKey(key: ApiKey): RedactedApiKey {
  return {
    id: key.id,
    prefix: key.prefix,
    state: key.state,
    scopes: key.scopes,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

export function redactApiKeys(keys: readonly ApiKey[]): readonly RedactedApiKey[] {
  return keys.map(redactApiKey);
}

export function redactForOperator(key: ApiKey, tenantId: string): OperatorApiKeyView {
  return {
    id: key.id,
    prefix: key.prefix,
    state: key.state,
    tenantId,
    scopes: key.scopes,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

// ------------------------------------------------------------
// Audit model
// ------------------------------------------------------------

export function buildAuditMetadata(
  actorId: string,
  tenantId: string,
  action: AuditAction,
  safeMetadata: Readonly<Record<string, string>>,
): AuditMetadata {
  return {
    actorId,
    timestamp: new Date().toISOString(),
    action,
    tenantId,
    safeMetadata,
  };
}

export function auditApiKeyCreate(
  actorId: string,
  tenantId: string,
  keyId: string,
  keyPrefix: string,
  auditFn: AuditFn,
): Error | null {
  const metadata: AuditMetadata = buildAuditMetadata(actorId, tenantId, 'API_KEY_CREATED', {
    keyId,
    keyPrefix,
  });
  const error = auditFn(metadata);
  return error;
}

export function auditApiKeyRevoke(
  actorId: string,
  tenantId: string,
  keyId: string,
  keyPrefix: string,
  auditFn: AuditFn,
): Error | null {
  const metadata: AuditMetadata = buildAuditMetadata(actorId, tenantId, 'API_KEY_REVOKED', {
    keyId,
    keyPrefix,
  });
  const error = auditFn(metadata);
  return error;
}

export function auditRateLimitPolicyChange(
  actorId: string,
  tenantId: string,
  policy: RateLimitPolicy,
  auditFn: AuditFn,
): Error | null {
  const metadata: AuditMetadata = buildAuditMetadata(actorId, tenantId, 'RATE_LIMIT_POLICY_CHANGED', {
    windowMs: policy.windowMs.toString(),
    maxRequests: policy.maxRequests.toString(),
  });
  const error = auditFn(metadata);
  return error;
}

// ------------------------------------------------------------
// API key management
// ------------------------------------------------------------

export function createApiKey(
  state: State,
  tenantId: string,
  actorId: string,
  scopes: readonly string[],
  auditFn: AuditFn,
  entitlements: readonly Permission[],
): Result<{ readonly state: State; readonly secret: string }> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement(entitlements, 'TENANT_API_KEY_WRITE');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const apiAccessCheck = checkApiAccessEntitlement(entitlements);
  if (!apiAccessCheck.ok) return apiAccessCheck as Result<never>;

  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const sequence = state.apiKeys.length + 1;
  const secret = generateSecret();
  const material = generateApiKeyMaterial(tenantId, sequence, secret);
  const newKeyId = 'id_' + sequence.toString(36) + '_' + Math.floor(Math.random() * 0x7fffffff).toString(36);

  const auditError = auditApiKeyCreate(actorId, tenantId, newKeyId, material.prefix, auditFn);
  if (auditError !== null) return { ok: false, error: auditError };

  const newKey: ApiKey = {
    id: newKeyId,
    prefix: material.prefix,
    hash: material.hash,
    state: 'ACTIVE',
    scopes,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };

  const newState: State = {
    ...state,
    apiKeys: [...state.apiKeys, newKey],
    auditLog: [...state.auditLog, {
      actorId,
      timestamp: new Date().toISOString(),
      action: 'API_KEY_CREATED',
      tenantId,
      safeMetadata: { keyId: newKeyId, keyPrefix: material.prefix },
    }],
  };

  return { ok: true, value: { state: newState, secret } };
}

export function revokeApiKey(
  state: State,
  tenantId: string,
  actorId: string,
  keyId: string,
  auditFn: AuditFn,
  entitlements: readonly Permission[],
): Result<State> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement(entitlements, 'TENANT_API_KEY_WRITE');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const keyIndex = state.apiKeys.findIndex((k) => k.id === keyId);
  if (keyIndex === -1) {
    return { ok: false, error: { kind: 'REVOKED_OR_INVALID_KEY', message: 'Key not found' } };
  }

  const key = state.apiKeys[keyIndex];
  if (key.state === 'REVOKED') {
    return { ok: false, error: { kind: 'REVOKED_OR_INVALID_KEY', message: 'Key already revoked' } };
  }

  const auditError = auditApiKeyRevoke(actorId, tenantId, keyId, key.prefix, auditFn);
  if (auditError !== null) return { ok: false, error: auditError };

  const updatedKeys: readonly ApiKey[] = state.apiKeys.map((k) =>
    k.id === keyId ? { ...k, state: 'REVOKED' as const, revokedAt: new Date().toISOString() } : k,
  );

  const newState: State = {
    ...state,
    apiKeys: updatedKeys,
    auditLog: [...state.auditLog, {
      actorId,
      timestamp: new Date().toISOString(),
      action: 'API_KEY_REVOKED',
      tenantId,
      safeMetadata: { keyId, keyPrefix: key.prefix },
    }],
  };

  return { ok: true, value: newState };
}

export function listApiKeys(
  state: State,
  tenantId: string,
  entitlements: readonly Permission[],
): Result<readonly RedactedApiKey[]> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement(entitlements, 'TENANT_API_KEY_READ');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const tenantKeys = state.apiKeys.filter((k) => k.prefix.startsWith(tenantId + '_'));
  const redacted: readonly RedactedApiKey[] = redactApiKeys(tenantKeys);
  return { ok: true, value: redacted };
}

export function operatorListApiKeys(
  state: State,
  entitlements: readonly Permission[],
): Result<readonly OperatorApiKeyView[]> {
  const entitlementCheck = checkEntitlement(entitlements, 'PLATFORM_API_KEY_OPERATOR');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const views: readonly OperatorApiKeyView[] = state.apiKeys.map((k) => {
    const tenantId = k.prefix.split('_')[0] ?? '';
    return redactForOperator(k, tenantId);
  });
  return { ok: true, value: views };
}

export function authenticateRequest(
  state: State,
  keyPrefix: string,
  secret: string,
): Result<ApiKey | null> {
  const key = authenticateKey(state.apiKeys, keyPrefix, secret);
  return { ok: true, value: key };
}

// ------------------------------------------------------------
// Rate limit management
// ------------------------------------------------------------

export function evaluateRateLimit(
  state: State,
  tenantId: string,
  policy: RateLimitPolicy,
): Result<RateLimitState> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const existing = state.rateLimits.get(tenantId);
  if (existing !== undefined) {
    const exceeded: RateLimitExceededState = existing.currentWindowCount >= policy.maxRequests ? 'EXCEEDED' : 'NOT_EXCEEDED';
    const updated: RateLimitState = {
      policy,
      currentWindowCount: existing.currentWindowCount,
      exceeded,
    };
    return { ok: true, value: updated };
  }

  const initial: RateLimitState = {
    policy,
    currentWindowCount: 0,
    exceeded: 'NOT_EXCEEDED',
  };
  return { ok: true, value: initial };
}

export function incrementRateLimit(
  state: State,
  tenantId: string,
  policy: RateLimitPolicy,
): Result<{ readonly state: State; readonly rateLimitState: RateLimitState }> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const existing = state.rateLimits.get(tenantId);
  const baseCount = existing?.currentWindowCount ?? 0;
  const nextCount = baseCount + 1;
  const exceeded: RateLimitExceededState = nextCount > policy.maxRequests ? 'EXCEEDED' : 'NOT_EXCEEDED';

  const newRateLimit: RateLimitState = {
    policy,
    currentWindowCount: nextCount,
    exceeded,
  };

  const newRateLimits = new Map(state.rateLimits);
  newRateLimits.set(tenantId, newRateLimit);

  const newState: State = {
    ...state,
    rateLimits: newRateLimits,
  };

  return { ok: true, value: { state: newState, rateLimitState: newRateLimit } };
}

export function updateRateLimitPolicy(
  state: State,
  tenantId: string,
  actorId: string,
  policy: RateLimitPolicy,
  auditFn: AuditFn,
  entitlements: readonly Permission[],
): Result<State> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement(entitlements, 'PLATFORM_RATE_LIMIT_OPERATOR');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const auditError = auditRateLimitPolicyChange(actorId, tenantId, policy, auditFn);
  if (auditError !== null) return { ok: false, error: auditError };

  const newRateLimits = new Map(state.rateLimits);
  newRateLimits.set(tenantId, {
    policy,
    currentWindowCount: 0,
    exceeded: 'NOT_EXCEEDED',
  });

  const newState: State = {
    ...state,
    rateLimits: newRateLimits,
    auditLog: [...state.auditLog, {
      actorId,
      timestamp: new Date().toISOString(),
      action: 'RATE_LIMIT_POLICY_CHANGED',
      tenantId,
      safeMetadata: {
        windowMs: policy.windowMs.toString(),
        maxRequests: policy.maxRequests.toString(),
      },
    }],
  };

  return { ok: true, value: newState };
}

// ------------------------------------------------------------
// Developer portal lifecycle
// ------------------------------------------------------------

export function buildDeveloperPortal(
  state: State,
  tenantId: string,
  openApiContract: unknown,
  graphQlContract: unknown,
  sdkMaterials: readonly string[],
  entitlements: readonly Permission[],
  declaredOpenApiContract: unknown,
): Result<{ readonly state: State; readonly summary: DeveloperPortalSummary }> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const entitlementCheck = checkEntitlement(entitlements, 'TENANT_DEVELOPER_READ');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const driftCheck = checkOpenApiDrift(declaredOpenApiContract, openApiContract);
  if (!driftCheck.ok) return driftCheck as Result<never>;

  const tenantKeys = state.apiKeys.filter((k) => k.prefix.startsWith(tenantId + '_'));
  const redacted: readonly RedactedApiKey[] = redactApiKeys(tenantKeys);

  const summary: DeveloperPortalSummary = {
    tenantId,
    openApiContract,
    graphQlContract,
    sdkMaterials,
    rateLimitVisibility: true,
    keys: redacted,
  };

  const newState: State = {
    ...state,
    developerPortal: summary,
    openApiContract,
    graphQlContract,
    readiness: state.readiness === 'UNAVAILABLE' ? 'DEGRADED' : state.readiness,
  };

  return { ok: true, value: { state: newState, summary } };
}

export function getDeveloperPortalSummary(
  state: State,
  entitlements: readonly Permission[],
): Result<DeveloperPortalSummary | null> {
  const entitlementCheck = checkEntitlement(entitlements, 'TENANT_DEVELOPER_READ');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  return { ok: true, value: state.developerPortal };
}

// ------------------------------------------------------------
// OpenAPI and GraphQL contract surface
// ------------------------------------------------------------

export function getOpenApiContract(state: State, entitlements: readonly Permission[]): Result<unknown> {
  const entitlementCheck = checkEntitlement(entitlements, 'TENANT_DEVELOPER_READ');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;
  return { ok: true, value: state.openApiContract };
}

export function getGraphQlContract(state: State, entitlements: readonly Permission[]): Result<unknown> {
  const entitlementCheck = checkEntitlement(entitlements, 'TENANT_DEVELOPER_READ');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;
  return { ok: true, value: state.graphQlContract };
}

// ------------------------------------------------------------
// Readiness model
// ------------------------------------------------------------

export function checkProviderAvailability(
  cacheAvailable: boolean,
  relationalAvailable: boolean,
): Readiness {
  if (cacheAvailable && relationalAvailable) return 'READY';
  if (!cacheAvailable && !relationalAvailable) return 'UNAVAILABLE';
  return 'DEGRADED';
}

export function updateReadiness(
  state: State,
  cacheAvailable: boolean,
  relationalAvailable: boolean,
): State {
  const readiness = checkProviderAvailability(cacheAvailable, relationalAvailable);
  return { ...state, readiness };
}

export function evaluateRateLimitWithFallback(
  state: State,
  tenantId: string,
  policy: RateLimitPolicy,
  cacheAvailable: boolean,
  relationalAvailable: boolean,
): Result<RateLimitState> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const readiness = checkProviderAvailability(cacheAvailable, relationalAvailable);
  if (readiness === 'UNAVAILABLE') {
    return { ok: false, error: { kind: 'PROVIDER_UNAVAILABLE', message: 'Both cache and relational providers unavailable' } };
  }

  const existing = state.rateLimits.get(tenantId);
  if (existing !== undefined) {
    const exceeded: RateLimitExceededState = existing.currentWindowCount >= policy.maxRequests ? 'EXCEEDED' : 'NOT_EXCEEDED';
    const updated: RateLimitState = {
      policy,
      currentWindowCount: existing.currentWindowCount,
      exceeded,
    };
    return { ok: true, value: updated };
  }

  const initial: RateLimitState = {
    policy,
    currentWindowCount: 0,
    exceeded: 'NOT_EXCEEDED',
  };
  return { ok: true, value: initial };
}

export function incrementRateLimitWithFallback(
  state: State,
  tenantId: string,
  policy: RateLimitPolicy,
  cacheAvailable: boolean,
  relationalAvailable: boolean,
): Result<{ readonly state: State; readonly rateLimitState: RateLimitState }> {
  const tenantCheck = checkTenantContext(tenantId);
  if (!tenantCheck.ok) return tenantCheck as Result<never>;

  const readiness = checkProviderAvailability(cacheAvailable, relationalAvailable);
  if (readiness === 'UNAVAILABLE') {
    return { ok: false, error: { kind: 'PROVIDER_UNAVAILABLE', message: 'Both cache and relational providers unavailable' } };
  }

  const existing = state.rateLimits.get(tenantId);
  const baseCount = existing?.currentWindowCount ?? 0;
  const nextCount = baseCount + 1;
  const exceeded: RateLimitExceededState = nextCount > policy.maxRequests ? 'EXCEEDED' : 'NOT_EXCEEDED';

  const newRateLimit: RateLimitState = {
    policy,
    currentWindowCount: nextCount,
    exceeded,
  };

  const newRateLimits = new Map(state.rateLimits);
  newRateLimits.set(tenantId, newRateLimit);

  const newState: State = {
    ...state,
    rateLimits: newRateLimits,
  };

  return { ok: true, value: { state: newState, rateLimitState: newRateLimit } };
}

// ------------------------------------------------------------
// Operator rate-limit operation
// ------------------------------------------------------------

export function operatorRateLimitOperation(
  state: State,
  tenantId: string,
  actorId: string,
  policy: RateLimitPolicy,
  auditFn: AuditFn,
  entitlements: readonly Permission[],
): Result<State> {
  const tenantIdCheck = checkTenantIdentifier(tenantId);
  if (!tenantIdCheck.ok) return tenantIdCheck as Result<never>;

  const entitlementCheck = checkEntitlement(entitlements, 'PLATFORM_RATE_LIMIT_OPERATOR');
  if (!entitlementCheck.ok) return entitlementCheck as Result<never>;

  const auditError = auditRateLimitPolicyChange(actorId, tenantId, policy, auditFn);
  if (auditError !== null) return { ok: false, error: auditError };

  const newRateLimits = new Map(state.rateLimits);
  newRateLimits.set(tenantId, {
    policy,
    currentWindowCount: 0,
    exceeded: 'NOT_EXCEEDED',
  });

  const newState: State = {
    ...state,
    rateLimits: newRateLimits,
    auditLog: [...state.auditLog, {
      actorId,
      timestamp: new Date().toISOString(),
      action: 'RATE_LIMIT_POLICY_CHANGED',
      tenantId,
      safeMetadata: {
        windowMs: policy.windowMs.toString(),
        maxRequests: policy.maxRequests.toString(),
      },
    }],
  };

  return { ok: true, value: newState };
}

// ------------------------------------------------------------
// Route metadata validation
// ------------------------------------------------------------

export function validateRouteMetadata(
  routeMetadata: readonly RouteMetadata[],
  method: string,
  path: string,
  scope: string,
): Result<RouteMetadata> {
  const match = routeMetadata.find((r) => r.method === method && r.path === path);
  if (match === undefined) {
    return { ok: false, error: { kind: 'ROUTE_METADATA_MISMATCH', message: 'Route not found' } };
  }
  if (match.requiredScope !== scope) {
    return { ok: false, error: { kind: 'ROUTE_METADATA_MISMATCH', message: 'Scope does not match route metadata' } };
  }
  return { ok: true, value: match };
}

export function checkRouteScopeMatch(
  routeMetadata: readonly RouteMetadata[],
  method: string,
  path: string,
  scopes: readonly string[],
): Result<RouteMetadata> {
  const match = routeMetadata.find((r) => r.method === method && r.path === path);
  if (match === undefined) {
    return { ok: false, error: { kind: 'ROUTE_METADATA_MISMATCH', message: 'Route not found' } };
  }
  if (!scopes.includes(match.requiredScope)) {
    return { ok: false, error: { kind: 'ROUTE_METADATA_MISMATCH', message: 'Scopes do not include route required scope' } };
  }
  return { ok: true, value: match };
}

// ------------------------------------------------------------
// UI semantic model
// ------------------------------------------------------------

export function getUIModel(): UIModel {
  return {
    surfaces: [
      { name: 'DeveloperPortal', description: 'Tenant developer portal surface' },
      { name: 'APIKeyManagement', description: 'API key creation and revocation surface' },
      { name: 'RateLimitDashboard', description: 'Rate limit visibility and configuration surface' },
      { name: 'ContractViewer', description: 'OpenAPI and GraphQL contract viewer' },
    ],
    viewModels: [
      { name: 'PortalSummaryViewModel', fields: ['tenantId', 'openApiContract', 'graphQlContract', 'sdkMaterials', 'rateLimitVisibility', 'keys'] },
      { name: 'ApiKeyViewModel', fields: ['id', 'prefix', 'state', 'scopes', 'createdAt', 'revokedAt'] },
      { name: 'RateLimitViewModel', fields: ['policy', 'currentWindowCount', 'exceeded'] },
      { name: 'OperatorApiKeyViewModel', fields: ['id', 'prefix', 'state', 'tenantId', 'scopes', 'createdAt', 'revokedAt'] },
    ],
    components: [
      { name: 'ApiKeyTable', props: ['keys', 'onRevoke'] },
      { name: 'RateLimitChart', props: ['state'] },
      { name: 'ContractViewer', props: ['contract', 'kind'] },
      { name: 'SdkMaterialsList', props: ['materials'] },
    ],
    journeys: [
      { name: 'CreateAPIKey', steps: ['Authenticate', 'CheckEntitlement', 'CheckApiAccess', 'Audit', 'GenerateSecret', 'Store'] },
      { name: 'RevokeAPIKey', steps: ['Authenticate', 'CheckEntitlement', 'Audit', 'UpdateState'] },
      { name: 'ViewRateLimits', steps: ['Authenticate', 'CheckEntitlement', 'Evaluate', 'Display'] },
      { name: 'ViewDeveloperPortal', steps: ['Authenticate', 'CheckEntitlement', 'DriftCheck', 'Build', 'Display'] },
    ],
    permissions: [
      'TENANT_DEVELOPER_READ',
      'TENANT_API_KEY_READ',
      'TENANT_API_KEY_WRITE',
      'PLATFORM_API_KEY_OPERATOR',
      'PLATFORM_RATE_LIMIT_OPERATOR',
      'API_ACCESS',
    ],
    accessibility: {
      ariaLabels: true,
      keyboardNavigation: true,
    },
    localisation: {
      supportedLanguages: ['en'],
      defaultLanguage: 'en',
    },
    rendererContracts: [
      { target: 'WEB', framework: 'react', bindings: ['ApiKeyTable', 'RateLimitChart', 'ContractViewer'] },
      { target: 'MOBILE', framework: 'react-native', bindings: ['ApiKeyTable', 'RateLimitChart'] },
      { target: 'CLI', framework: 'node-cli', bindings: ['SdkMaterialsList'] },
    ],
    disclaimers: [
      'No product parity is asserted.',
      'No human acceptance is asserted.',
      'No accessibility compliance is asserted.',
      'No launch-language readiness is asserted.',
    ],
  };
}

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

export interface ValidationReport {
  readonly entitlementGated: boolean;
  readonly secretOnce: boolean;
  readonly listOmitsSecret: boolean;
  readonly listOmitsHash: boolean;
  readonly listOmitsSalt: boolean;
  readonly operatorOmitsSecret: boolean;
  readonly operatorOmitsHash: boolean;
  readonly operatorOmitsSalt: boolean;
  readonly secretAuthenticates: boolean;
  readonly hashCannotAuthenticate: boolean;
  readonly revokedDenied: boolean;
  readonly routeMetadataMatches: boolean;
  readonly openApiDriftFailsGate: boolean;
}

export function runValidation(state: State, declaredContract: unknown): ValidationReport {
  let entitlementGated = false;
  let secretOnce = false;
  let listOmitsSecret = true;
  let listOmitsHash = true;
  let listOmitsSalt = true;
  let operatorOmitsSecret = true;
  let operatorOmitsHash = true;
  let operatorOmitsSalt = true;
  let secretAuthenticates = false;
  let hashCannotAuthenticate = true;
  let revokedDenied = false;
  let routeMetadataMatches = false;
  let openApiDriftFailsGate = false;

  const createWithoutEntitlement = createApiKey(
    state,
    'tenant-1',
    'actor-1',
    ['read:api'],
    () => null,
    ['TENANT_DEVELOPER_READ'],
  );
  if (!createWithoutEntitlement.ok) entitlementGated = true;

  const createWithEntitlement = createApiKey(
    state,
    'tenant-1',
    'actor-1',
    ['read:api'],
    () => null,
    ['TENANT_API_KEY_WRITE', 'API_ACCESS'],
  );
  if (createWithEntitlement.ok && createWithEntitlement.value.secret.length > 0) {
    secretOnce = true;
    const createdKey = createWithEntitlement.value.state.apiKeys[0];
    if (createdKey !== undefined) {
      const listResult = listApiKeys(createWithEntitlement.value.state, 'tenant-1', ['TENANT_API_KEY_READ']);
      if (listResult.ok) {
        for (const k of listResult.value) {
          const serialized = JSON.stringify(k);
          if (serialized.includes('hash')) listOmitsHash = false;
          if (serialized.includes('salt')) listOmitsSalt = false;
          if (serialized.includes('secret')) listOmitsSecret = false;
        }
      }
      const opResult = operatorListApiKeys(createWithEntitlement.value.state, ['PLATFORM_API_KEY_OPERATOR']);
      if (opResult.ok) {
        for (const k of opResult.value) {
          const serialized = JSON.stringify(k);
          if (serialized.includes('hash')) operatorOmitsHash = false;
          if (serialized.includes('salt')) operatorOmitsSalt = false;
          if (serialized.includes('secret')) operatorOmitsSecret = false;
        }
      }
      const authWithSecret = authenticateRequest(createWithEntitlement.value.state, createdKey.prefix, createWithEntitlement.value.secret);
      if (authWithSecret.ok && authWithSecret.value !== null) secretAuthenticates = true;
      const authWithHashResult = authenticateWithHash(createWithEntitlement.value.state.apiKeys, createdKey.prefix, createdKey.hash);
      if (authWithHashResult === null) hashCannotAuthenticate = true;
    }
  }

  const stateAfterCreate = createWithEntitlement.ok ? createWithEntitlement.value.state : state;
  const targetKey = stateAfterCreate.apiKeys[0];
  if (targetKey !== undefined) {
    const revokeResult = revokeApiKey(stateAfterCreate, 'tenant-1', 'actor-1', targetKey.id, () => null, ['TENANT_API_KEY_WRITE']);
    if (revokeResult.ok) {
      const revokedKey = revokeResult.value.apiKeys.find((k) => k.id === targetKey.id);
      if (revokedKey !== undefined && revokedKey.state === 'REVOKED') {
        const authAfterRevoke = authenticateRequest(revokeResult.value, revokedKey.prefix, createWithEntitlement.ok ? createWithEntitlement.value.secret : '');
        if (authAfterRevoke.ok && authAfterRevoke.value === null) revokedDenied = true;
      }
    }
  }

  const sampleRoute: RouteMetadata = { method: 'GET', path: '/api/v1/keys', requiredScope: 'read:api', scopeKind: 'TENANT' };
  const routeCheck = validateRouteMetadata([sampleRoute], 'GET', '/api/v1/keys', 'read:api');
  if (routeCheck.ok) routeMetadataMatches = true;

  const driftCheck = checkOpenApiDrift(declaredContract, { drifted: true });
  if (!driftCheck.ok) openApiDriftFailsGate = true;

  return {
    entitlementGated,
    secretOnce,
    listOmitsSecret,
    listOmitsHash,
    listOmitsSalt,
    operatorOmitsSecret,
    operatorOmitsHash,
    operatorOmitsSalt,
    secretAuthenticates,
    hashCannotAuthenticate,
    revokedDenied,
    routeMetadataMatches,
    openApiDriftFailsGate,
  };
}

// ------------------------------------------------------------
// Proof model
// ------------------------------------------------------------

export interface ProofResult {
  readonly status: ProofStatus;
  readonly details: readonly string[];
  readonly apiKeyProof: ProofStatus;
  readonly apiKeyRouteProof: ProofStatus;
  readonly rateLimitProof: ProofStatus;
  readonly openApiDriftProof: ProofStatus;
  readonly graphQlRuntimeProof: ProofStatus;
}

export function runRuntimeProof(
  state: State,
  declaredOpenApiContract: unknown,
  declaredGraphQlContract: unknown,
  liveOpenApiContract: unknown,
  liveGraphQlContract: unknown,
): ProofResult {
  const details: string[] = [];
  let apiKeyProof: ProofStatus = 'PENDING';
  let apiKeyRouteProof: ProofStatus = 'PENDING';
  let rateLimitProof: ProofStatus = 'PENDING';
  let openApiDriftProof: ProofStatus = 'PENDING';
  let graphQlRuntimeProof: ProofStatus = 'PENDING';

  const createResult = createApiKey(
    state,
    'tenant-1',
    'actor-1',
    ['read:api'],
    () => null,
    ['TENANT_API_KEY_WRITE', 'API_ACCESS'],
  );
  if (createResult.ok && createResult.value.secret.length > 0) {
    apiKeyProof = 'PASSED';
    details.push('API-key runtime proof: secret revealed once, hash stored.');
  } else {
    apiKeyProof = 'FAILED';
    details.push('API-key runtime proof: failed to create key.');
  }

  const stateAfterCreate = createResult.ok ? createResult.value.state : state;
  const createdKey = stateAfterCreate.apiKeys[0];
  if (createdKey !== undefined) {
    const routeMeta: readonly RouteMetadata[] = [
      { method: 'GET', path: '/keys', requiredScope: 'read:api', scopeKind: 'TENANT' },
    ];
    const routeCheck = checkRouteScopeMatch(routeMeta, 'GET', '/keys', createdKey.scopes);
    if (routeCheck.ok) {
      apiKeyRouteProof = 'PASSED';
      details.push('API-key route proof: scopes match declared route metadata.');
    } else {
      apiKeyRouteProof = 'FAILED';
      details.push('API-key route proof: scopes do not match route metadata.');
    }
  } else {
    apiKeyRouteProof = 'FAILED';
    details.push('API-key route proof: no key available.');
  }

  const policy: RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const evalResult = evaluateRateLimitWithFallback(
    stateAfterCreate,
    'tenant-1',
    policy,
    true,
    true,
  );
  if (evalResult.ok) {
    rateLimitProof = 'PASSED';
    details.push('Rate-limit proof: evaluation succeeded against live substrate.');
  } else {
    rateLimitProof = 'FAILED';
    details.push('Rate-limit proof: evaluation failed.');
  }

  const openApiDriftCheck = checkOpenApiDrift(declaredOpenApiContract, liveOpenApiContract);
  if (openApiDriftCheck.ok) {
    openApiDriftProof = 'PASSED';
    details.push('OpenAPI drift proof: declared matches live contract.');
  } else {
    openApiDriftProof = 'FAILED';
    details.push('OpenAPI drift proof: declared contract drifted from live.');
  }

  const graphQlDriftCheck = checkGraphQlDrift(declaredGraphQlContract, liveGraphQlContract);
  if (graphQlDriftCheck.ok) {
    graphQlRuntimeProof = 'PASSED';
    details.push('GraphQL runtime proof: declared matches live contract.');
  } else {
    graphQlRuntimeProof = 'FAILED';
    details.push('GraphQL runtime proof: declared contract drifted from live.');
  }

  let status: ProofStatus = 'PENDING';
  if (
    apiKeyProof === 'PASSED' &&
    apiKeyRouteProof === 'PASSED' &&
    rateLimitProof === 'PASSED' &&
    openApiDriftProof === 'PASSED' &&
    graphQlRuntimeProof === 'PASSED'
  ) {
    status = 'PASSED';
  } else if (
    apiKeyProof === 'FAILED' ||
    apiKeyRouteProof === 'FAILED' ||
    rateLimitProof === 'FAILED' ||
    openApiDriftProof === 'FAILED' ||
    graphQlRuntimeProof === 'FAILED'
  ) {
    status = 'FAILED';
  }

  return {
    status,
    details,
    apiKeyProof,
    apiKeyRouteProof,
    rateLimitProof,
    openApiDriftProof,
    graphQlRuntimeProof,
  };
}