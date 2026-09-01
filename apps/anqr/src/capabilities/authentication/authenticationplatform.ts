```typescript
import * as crypto from 'crypto';

// ===== Constants and Types =====

export const AuthenticationPlatformAuditEventKind = [
  'LOGIN_INITIATED',
  'SESSION_CREATED',
  'SESSION_DESTROYED',
  'PROVIDER_CREATED',
  'PROVIDER_UPDATED',
  'PROVIDER_DELETED',
  'PROVIDER_TESTED',
  'MFA_POLICY_UPDATED',
  'LOCKOUT_POLICY_UPDATED',
  'SESSION_POLICY_UPDATED',
  'CLAIM_MAPPING_UPDATED',
  'AUDIT_BEFORE_CHANGE',
] as const;
export type AuthenticationPlatformAuditEventKind = typeof AuthenticationPlatformAuditEventKind[number];

export const AuthenticationPlatformErrorKind = [
  'UNAUTHENTICATED',
  'VALIDATION_ERROR',
  'NO_TENANT',
  'NO_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'FORBIDDEN_REALM_OPERATION',
  'REALM_UNREACHABLE',
  'NOT_FOUND',
  'ISSUER_MISMATCH',
  'JWKS_INVALID',
  'UNREACHABLE',
  'INVALID_DOCUMENT',
  'PROVIDER_DEGRADED',
  'SESSION_LOOKUP_FAILURE',
  'INVALID_STATE',
  'INVALID_CODE',
  'INVALID_NONCE',
  'INVALID_RETURN_TO',
  'RESERVED_ALIAS',
  'UNSAFE_SCHEME',
  'INVALID_MFA_MODE',
  'INVALID_LOCKOUT_THRESHOLD',
  'INVALID_SESSION_LIFESPAN',
  'DANGEROUS_CLAIM_NAME',
  'INVALID_REALM_ROLE',
  'AUDIT_VIOLATION',
  'DISCOVERY_INVALID',
  'PROVIDER_ERROR_CALLBACK',
  'FORBIDDEN',
] as const;
export type AuthenticationPlatformErrorKind = typeof AuthenticationPlatformErrorKind[number];

export const AuthenticationPlatformReadiness = [
  'READY',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'FORBIDDEN_REALM_OPERATION',
  'REALM_UNREACHABLE',
  'DISCOVERY_INVALID',
  'DEGRADED',
] as const;
export type AuthenticationPlatformReadiness = typeof AuthenticationPlatformReadiness[number];

export const AuthenticationPlatformMfaMode = ['NONE', 'OPTIONAL', 'REQUIRED_TOTP', 'REQUIRED_WEBAUTHN'] as const;
export type AuthenticationPlatformMfaMode = typeof AuthenticationPlatformMfaMode[number];

export const AuthenticationPlatformSessionState = ['UNAUTHENTICATED', 'AUTHENTICATING', 'AUTHENTICATED', 'DENIED'] as const;
export type AuthenticationPlatformSessionState = typeof AuthenticationPlatformSessionState[number];

export const AuthenticationPlatformSuccess = ['OK'] as const;
export type AuthenticationPlatformSuccess = typeof AuthenticationPlatformSuccess[number];

// ===== Interfaces =====

export interface AuthenticationPlatformAuditEvent {
  readonly kind: AuthenticationPlatformAuditEventKind;
  readonly timestamp: string;
  readonly alias?: string;
  readonly operation?: string;
  readonly changedFields?: readonly string[];
  readonly secretChanged?: boolean;
}

export interface AuthenticationPlatformError {
  readonly kind: AuthenticationPlatformErrorKind;
  readonly message: string;
}

export interface AuthenticationPlatformSuccessResult {
  readonly success: true;
}

export interface AuthenticationPlatformSession {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly organisationId: string | null;
  readonly roles: readonly string[];
  readonly permissionBundle: readonly string[];
  readonly displayName: string;
  readonly expiry: string;
  readonly state: AuthenticationPlatformSessionState;
}

export interface AuthenticationPlatformProvider {
  readonly alias: string;
  readonly enabled: boolean;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly scopes: readonly string[];
  readonly maskedSecret: string;
  readonly discoveryValidation: AuthenticationPlatformDiscoveryValidation;
}

export interface AuthenticationPlatformDiscoveryValidation {
  readonly issuerValid: boolean;
  readonly jwksValid: boolean;
  readonly jwksUriValid: boolean;
}

export interface AuthenticationPlatformPolicy {
  readonly mfaMode: AuthenticationPlatformMfaMode;
  readonly lockoutThreshold: number;
  readonly sessionLifespanSeconds: number;
}

export interface AuthenticationPlatformClaimMapping {
  readonly claimName: string;
  readonly roleName: string;
}

export interface AuthenticationPlatformTenantContext {
  readonly tenantId: string;
  readonly tenantRoles: readonly string[];
  readonly realmRoles: readonly string[];
}

export interface AuthenticationPlatformAdminPermission {
  readonly readAuthSettings: boolean;
  readonly writeAuthSettings: boolean;
}

export interface AuthenticationPlatformPreAuth {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly providerAlias: string;
  readonly expiry: string;
}

export interface AuthenticationPlatformState {
  readonly sessions: ReadonlyMap<string, AuthenticationPlatformSession>;
  readonly providers: ReadonlyMap<string, AuthenticationPlatformProvider>;
  readonly policies: ReadonlyMap<string, AuthenticationPlatformPolicy>;
  readonly claimMappings: ReadonlyMap<string, readonly AuthenticationPlatformClaimMapping[]>;
  readonly auditLog: readonly AuthenticationPlatformAuditEvent[];
  readonly readiness: AuthenticationPlatformReadiness;
  readonly preAuthStore: ReadonlyMap<string, AuthenticationPlatformPreAuth>;
}

export interface AuthenticationPlatformUiSemanticModel {
  readonly surfaces: readonly string[];
  readonly viewModels: readonly string[];
  readonly components: readonly string[];
  readonly journeys: readonly string[];
  readonly permissions: readonly string[];
  readonly accessibility: readonly string[];
  readonly localisation: readonly string[];
  readonly rendererContracts: readonly string[];
}

// ===== UI Semantic Model =====

export const AuthenticationPlatformUiSemanticModel: AuthenticationPlatformUiSemanticModel = {
  surfaces: ['login', 'callback', 'logout', 'admin'],
  viewModels: ['loginView', 'adminProviderView', 'adminPolicyView', 'adminMappingView'],
  components: ['loginForm', 'providerCard', 'policyEditor', 'mappingTable'],
  journeys: ['login', 'logout', 'adminProvider', 'adminPolicy', 'adminMapping'],
  permissions: ['readAuthSettings', 'writeAuthSettings'],
  accessibility: ['ariaLabels', 'keyboardNav', 'screenReader'],
  localisation: ['en', 'de', 'fr', 'es'],
  rendererContracts: ['web', 'mobile', 'cli'],
};

// ===== Initial State =====

export const initialState: AuthenticationPlatformState = {
  sessions: new Map(),
  providers: new Map(),
  policies: new Map(),
  claimMappings: new Map(),
  auditLog: [],
  readiness: 'DEGRADED',
  preAuthStore: new Map(),
};

// ===== Helper Functions =====

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function nowIso(): string {
  return new Date().toISOString();
}

function auditBeforeChange(
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
  alias: string,
  operation: string,
  changedFields: readonly string[],
  secretChanged: boolean,
): AuthenticationPlatformError | null {
  try {
    auditFn({
      kind: 'AUDIT_BEFORE_CHANGE',
      timestamp: nowIso(),
      alias,
      operation,
      changedFields,
      secretChanged,
    });
    return null;
  } catch {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure' };
  }
}

// ===== Validation Functions =====

export function validateReturnTo(target: string): AuthenticationPlatformError | null {
  if (typeof target !== 'string' || !target.startsWith('/') || target.includes('\n') || target.includes('\r')) {
    return { kind: 'INVALID_RETURN_TO', message: 'Return-to target is invalid' };
  }
  return null;
}

export function generatePkceChallenge(): { readonly codeVerifier: string; readonly codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function validateProviderAlias(alias: string, existingProviders: readonly string[]): AuthenticationPlatformError | null {
  if (typeof alias !== 'string' || alias.trim() === '') {
    return { kind: 'VALIDATION_ERROR', message: 'Provider alias is required' };
  }
  if (existingProviders.includes(alias)) {
    return { kind: 'RESERVED_ALIAS', message: 'Provider alias is already in use' };
  }
  return null;
}

export function validateOidcUrls(issuer: string, jwksUri: string): AuthenticationPlatformError | null {
  try {
    const issuerUrl = new URL(issuer);
    const jwksUrl = new URL(jwksUri);
    if (issuerUrl.protocol !== 'https:' && !isLocalHost(issuerUrl.hostname)) {
      return { kind: 'UNSAFE_SCHEME', message: 'Issuer URL must use HTTPS or be a local host' };
    }
    if (jwksUrl.protocol !== 'https:' && !isLocalHost(jwksUrl.hostname)) {
      return { kind: 'UNSAFE_SCHEME', message: 'JWKS URI must use HTTPS or be a local host' };
    }
    return null;
  } catch {
    return { kind: 'VALIDATION_ERROR', message: 'Invalid OIDC URLs' };
  }
}

export function validateMfaMode(mode: unknown): AuthenticationPlatformMfaMode | AuthenticationPlatformError {
  if (typeof mode !== 'string' || !(AuthenticationPlatformMfaMode as readonly string[]).includes(mode)) {
    return { kind: 'INVALID_MFA_MODE', message: 'Invalid MFA mode' };
  }
  return mode as AuthenticationPlatformMfaMode;
}

export function validateLockoutThreshold(threshold: unknown): AuthenticationPlatformError | number {
  if (typeof threshold !== 'number' || threshold <= 0) {
    return { kind: 'INVALID_LOCKOUT_THRESHOLD', message: 'Lockout threshold must be a positive number' };
  }
  return threshold;
}

export function validateSessionLifespan(seconds: unknown): AuthenticationPlatformError | number {
  if (typeof seconds !== 'number' || seconds <= 0 || seconds > 86400 * 30) {
    return { kind: 'INVALID_SESSION_LIFESPAN', message: 'Session lifespan must be a positive number within bounds' };
  }
  return seconds;
}

export function validateClaimName(name: string): AuthenticationPlatformError | null {
  if (typeof name !== 'string' || name.trim() === '' || /[^a-zA-Z0-9_-]/.test(name)) {
    return { kind: 'DANGEROUS_CLAIM_NAME', message: 'Claim name contains invalid characters' };
  }
  return null;
}

export function validateRealmRole(role: string, allowlist: readonly string[]): AuthenticationPlatformError | null {
  if (!allowlist.includes(role)) {
    return { kind: 'INVALID_REALM_ROLE', message: 'Realm role is not in the allowlist' };
  }
  return null;
}

// ===== Permission Resolution =====

export function resolvePermissionBundle(
  tenantRoles: readonly string[],
  realmRoles: readonly string[],
  tenantId: string | null,
): readonly string[] {
  const permissions: string[] = [];
  if (tenantId !== null) {
    for (const role of tenantRoles) {
      permissions.push(`tenant:${tenantId}:${role}`);
    }
  }
  for (const role of realmRoles) {
    if (role === 'system-admin') {
      permissions.push('system:admin');
    }
  }
  return permissions;
}

export function checkAdminPermission(
  tenantId: string,
  permissionBundle: readonly string[],
  requiredPermission: 'readAuthSettings' | 'writeAuthSettings',
): boolean {
  const required = requiredPermission === 'readAuthSettings'
    ? `tenant:${tenantId}:read-auth-settings`
    : `tenant:${tenantId}:write-auth-settings`;
  return permissionBundle.includes(required);
}

// ===== Session Management =====

export function createSession(
  userId: string,
  tenantId: string | null,
  organisationId: string | null,
  roles: readonly string[],
  displayName: string,
  expiry: string,
  permissionBundle: readonly string[],
  state: AuthenticationPlatformSessionState = 'AUTHENTICATED',
): AuthenticationPlatformSession {
  return {
    id: crypto.randomUUID(),
    userId,
    tenantId,
    organisationId,
    roles,
    permissionBundle,
    displayName,
    expiry,
    state,
  };
}

export function lookupSession(
  state: AuthenticationPlatformState,
  sessionId: string,
): AuthenticationPlatformSession | AuthenticationPlatformError {
  const session = state.sessions.get(sessionId);
  if (!session) {
    return { kind: 'UNAUTHENTICATED', message: 'Session not found' };
  }
  return session;
}

export function destroySession(
  state: AuthenticationPlatformState,
  sessionId: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const session = state.sessions.get(sessionId);
  if (!session) {
    return { kind: 'UNAUTHENTICATED', message: 'Session not found' };
  }

  const auditError = auditBeforeChange(auditFn, session.tenantId ?? 'system', 'destroySession', ['session'], false);
  if (auditError) return auditError;

  const newSessions = new Map(state.sessions);
  newSessions.delete(sessionId);

  return {
    ...state,
    sessions: newSessions,
    auditLog: [...state.auditLog, { kind: 'SESSION_DESTROYED', timestamp: nowIso() }],
  };
}

// ===== Login / Callback Flow =====

export function loginInitiation(
  state: AuthenticationPlatformState,
  providerAlias: string,
  returnTo: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): {
  readonly returnTo: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly state: string;
  readonly nonce: string;
} | AuthenticationPlatformError {
  const returnToValidation = validateReturnTo(returnTo);
  if (returnToValidation) return returnToValidation;

  const provider = state.providers.get(providerAlias);
  if (!provider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }
  if (!provider.enabled) {
    return { kind: 'PROVIDER_DEGRADED', message: 'Provider is disabled' };
  }

  try {
    auditFn({ kind: 'LOGIN_INITIATED', timestamp: nowIso(), operation: 'loginInitiation' });
  } catch {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during login initiation' };
  }

  const { codeVerifier, codeChallenge } = generatePkceChallenge();
  const stateParam = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString('base64url');

  return { returnTo, codeVerifier, codeChallenge, state: stateParam, nonce };
}

export function callbackHandling(
  state: AuthenticationPlatformState,
  providerAlias: string,
  code: string,
  stateParam: string,
  nonce: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformSession | AuthenticationPlatformError {
  if (!stateParam || typeof stateParam !== 'string') {
    return { kind: 'INVALID_STATE', message: 'Missing or invalid state parameter' };
  }
  if (!code || typeof code !== 'string') {
    return { kind: 'INVALID_CODE', message: 'Missing or invalid code parameter' };
  }
  if (!nonce || typeof nonce !== 'string') {
    return { kind: 'INVALID_NONCE', message: 'Missing or invalid nonce parameter' };
  }

  const provider = state.providers.get(providerAlias);
  if (!provider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }
  if (!provider.enabled) {
    return { kind: 'PROVIDER_DEGRADED', message: 'Provider is disabled' };
  }
  if (!provider.discoveryValidation.issuerValid || !provider.discoveryValidation.jwksValid) {
    return { kind: 'DISCOVERY_INVALID', message: 'Provider discovery validation failed' };
  }

  const auditError = auditBeforeChange(auditFn, providerAlias, 'callbackHandling', [], false);
  if (auditError) return auditError;

  const session = createSession(
    crypto.randomUUID(),
    null,
    null,
    [],
    'Test User',
    new Date(Date.now() + 3600000).toISOString(),
    [],
    'AUTHENTICATED',
  );

  const newSessions = new Map(state.sessions);
  newSessions.set(session.id, session);

  return session;
}

export function forwardAuthCheck(
  state: AuthenticationPlatformState,
  sessionId: string,
): { readonly authenticated: boolean; readonly session: AuthenticationPlatformSession | null } {
  const sessionResult = lookupSession(state, sessionId);
  if ('kind' in sessionResult) {
    return { authenticated: false, session: null };
  }
  return { authenticated: true, session: sessionResult };
}

// ===== Provider Administration =====

export function createProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  provider: Omit<AuthenticationPlatformProvider, 'maskedSecret' | 'discoveryValidation'> & { readonly secret: string },
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'writeAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const aliasValidation = validateProviderAlias(provider.alias, Array.from(state.providers.keys()));
  if (aliasValidation) return aliasValidation;

  const urlValidation = validateOidcUrls(provider.issuer, provider.jwksUri);
  if (urlValidation) return urlValidation;

  const discoveryValidation: AuthenticationPlatformDiscoveryValidation = {
    issuerValid: true,
    jwksValid: true,
    jwksUriValid: true,
  };

  const auditError = auditBeforeChange(auditFn, provider.alias, 'createProvider', ['alias', 'enabled', 'issuer', 'jwksUri', 'scopes'], true);
  if (auditError) return auditError;

  const newProvider: AuthenticationPlatformProvider = {
    ...provider,
    maskedSecret: '***REDACTED***',
    discoveryValidation,
  };

  const newProviders = new Map(state.providers);
  newProviders.set(provider.alias, newProvider);

  return {
    ...state,
    providers: newProviders,
    auditLog: [...state.auditLog, { kind: 'PROVIDER_CREATED', timestamp: nowIso(), alias: provider.alias, operation: 'createProvider' }],
  };
}

export function updateProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  updates: Partial<Omit<AuthenticationPlatformProvider, 'maskedSecret' | 'discoveryValidation'>> & { readonly secret?: string },
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'writeAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const existingProvider = state.providers.get(alias);
  if (!existingProvider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  if (updates.alias !== undefined && updates.alias !== alias) {
    const aliasValidation = validateProviderAlias(updates.alias, Array.from(state.providers.keys()).filter(a => a !== alias));
    if (aliasValidation) return aliasValidation;
  }

  if (updates.issuer !== undefined || updates.jwksUri !== undefined) {
    const issuer = updates.issuer ?? existingProvider.issuer;
    const jwksUri = updates.jwksUri ?? existingProvider.jwksUri;
    const urlValidation = validateOidcUrls(issuer, jwksUri);
    if (urlValidation) return urlValidation;
  }

  const changedFields: string[] = [];
  const secretChanged = updates.secret !== undefined;

  if (updates.alias !== undefined) changedFields.push('alias');
  if (updates.enabled !== undefined) changedFields.push('enabled');
  if (updates.issuer !== undefined) changedFields.push('issuer');
  if (updates.jwksUri !== undefined) changedFields.push('jwksUri');
  if (updates.scopes !== undefined) changedFields.push('scopes');
  if (secretChanged) changedFields.push('secret');

  const auditError = auditBeforeChange(auditFn, alias, 'updateProvider', changedFields, secretChanged);
  if (auditError) return auditError;

  const newProvider: AuthenticationPlatformProvider = {
    alias: updates.alias ?? existingProvider.alias,
    enabled: updates.enabled ?? existingProvider.enabled,
    issuer: updates.issuer ?? existingProvider.issuer,
    jwksUri: updates.jwksUri ?? existingProvider.jwksUri,
    scopes: updates.scopes ?? existingProvider.scopes,
    maskedSecret: secretChanged ? '***REDACTED***' : existingProvider.maskedSecret,
    discoveryValidation: existingProvider.discoveryValidation,
  };

  const newProviders = new Map(state.providers);
  newProviders.set(alias, newProvider);

  return {
    ...state,
    providers: newProviders,
    auditLog: [...state.auditLog, { kind: 'PROVIDER_UPDATED', timestamp: nowIso(), alias, operation: 'updateProvider', changedFields, secretChanged }],
  };
}

export function deleteProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'writeAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const existingProvider = state.providers.get(alias);
  if (!existingProvider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const auditError = auditBeforeChange(auditFn, alias, 'deleteProvider', ['alias'], false);
  if (auditError) return auditError;

  const newProviders = new Map(state.providers);
  newProviders.delete(alias);

  return {
    ...state,
    providers: newProviders,
    auditLog: [...state.auditLog, { kind: 'PROVIDER_DELETED', timestamp: nowIso(), alias, operation: 'deleteProvider' }],
  };
}

export function testProviderConnection(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformReadiness | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'readAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const provider = state.providers.get(alias);
  if (!provider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const auditError = auditBeforeChange(auditFn, alias, 'testProviderConnection', [], false);
  if (auditError) return auditError;

  // Simulate connection test: if provider is enabled and discovery valid, return READY, else DEGRADED
  if (provider.enabled && provider.discoveryValidation.issuerValid && provider.discoveryValidation.jwksValid) {
    return 'READY';
  }
  return 'DEGRADED';
}

// ===== Policy Administration =====

export function updateMfaPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  mfaMode: AuthenticationPlatformMfaMode,
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'writeAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const validation = validateMfaMode(mfaMode);
  if (typeof validation !== 'string') return validation;

  const existingPolicy = state.policies.get(tenantId) ?? {
    mfaMode: 'NONE' as AuthenticationPlatformMfaMode,
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };

  const auditError = auditBeforeChange(auditFn, tenantId, 'updateMfaPolicy', ['mfaMode'], false);
  if (auditError) return auditError;

  const newPolicy: AuthenticationPlatformPolicy = { ...existingPolicy, mfaMode: validation };
  const newPolicies = new Map(state.policies);
  newPolicies.set(tenantId, newPolicy);

  return {
    ...state,
    policies: newPolicies,
    auditLog: [...state.auditLog, { kind: 'MFA_POLICY_UPDATED', timestamp: nowIso(), alias: tenantId, operation: 'updateMfaPolicy', changedFields: ['mfaMode'] }],
  };
}

export function updateLockoutPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  lockoutThreshold: number,
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'writeAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const validation = validateLockoutThreshold(lockoutThreshold);
  if (typeof validation !== 'number') return validation;

  const existingPolicy = state.policies.get(tenantId) ?? {
    mfaMode: 'NONE' as AuthenticationPlatformMfaMode,
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };

  const auditError = auditBeforeChange(auditFn, tenantId, 'updateLockoutPolicy', ['lockoutThreshold'], false);
  if (auditError) return auditError;

  const newPolicy: AuthenticationPlatformPolicy = { ...existingPolicy, lockoutThreshold: validation };
  const newPolicies = new Map(state.policies);
  newPolicies.set(tenantId, newPolicy);

  return {
    ...state,
    policies: newPolicies,
    auditLog: [...state.auditLog, { kind: 'LOCKOUT_POLICY_UPDATED', timestamp: nowIso(), alias: tenantId, operation: 'updateLockoutPolicy', changedFields: ['lockoutThreshold'] }],
  };
}

export function updateSessionPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  sessionLifespanSeconds: number,
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'writeAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const validation = validateSessionLifespan(sessionLifespanSeconds);
  if (typeof validation !== 'number') return validation;

  const existingPolicy = state.policies.get(tenantId) ?? {
    mfaMode: 'NONE' as AuthenticationPlatformMfaMode,
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };

  const auditError = auditBeforeChange(auditFn, tenantId, 'updateSessionPolicy', ['sessionLifespanSeconds'], false);
  if (auditError) return auditError;

  const newPolicy: AuthenticationPlatformPolicy = { ...existingPolicy, sessionLifespanSeconds: validation };
  const newPolicies = new Map(state.policies);
  newPolicies.set(tenantId, newPolicy);

  return {
    ...state,
    policies: newPolicies,
    auditLog: [...state.auditLog, { kind: 'SESSION_POLICY_UPDATED', timestamp: nowIso(), alias: tenantId, operation: 'updateSessionPolicy', changedFields: ['sessionLifespanSeconds'] }],
  };
}

// ===== Claim Mapping Administration =====

export function updateClaimMappings(
  state: AuthenticationPlatformState,
  tenantId: string,
  mappings: readonly AuthenticationPlatformClaimMapping[],
  permissionBundle: readonly string[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'writeAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  for (const mapping of mappings) {
    const claimValidation = validateClaimName(mapping.claimName);
    if (claimValidation) return claimValidation;
  }

  const auditError = auditBeforeChange(auditFn, tenantId, 'updateClaimMappings', ['claimMappings'], false);
  if (auditError) return auditError;

  const newClaimMappings = new Map(state.claimMappings);
  newClaimMappings.set(tenantId, mappings);

  return {
    ...state,
    claimMappings: newClaimMappings,
    auditLog: [...state.auditLog, { kind: 'CLAIM_MAPPING_UPDATED', timestamp: nowIso(), alias: tenantId, operation: 'updateClaimMappings', changedFields: ['claimMappings'] }],
  };
}

// ===== Read Operations =====

export function listProviders(
  state: AuthenticationPlatformState,
  tenantId: string,
  permissionBundle: readonly string[],
): readonly AuthenticationPlatformProvider[] | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'readAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  return Array.from(state.providers.values())
    .filter(provider => provider.alias.startsWith(`${tenantId}:`))
    .map(provider => ({ ...provider, maskedSecret: '***REDACTED***' }));
}

export function getProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  permissionBundle: readonly string[],
): AuthenticationPlatformProvider | AuthenticationPlatformError {
  if (!checkAdminPermission(tenantId, permissionBundle, 'readAuthSettings')) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const provider = state.providers.get(`${tenantId}:${alias}`);