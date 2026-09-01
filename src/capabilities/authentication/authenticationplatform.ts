import * as crypto from 'crypto';

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

export interface AuthenticationPlatformAuditEvent {
  readonly kind: AuthenticationPlatformAuditEventKind;
  readonly timestamp: string;
  readonly alias: string;
  readonly operation: string;
  readonly changedFields: readonly string[];
  readonly secretChanged: boolean;
}

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
  'EXTERNALLY_LIMITED',
] as const;
export type AuthenticationPlatformErrorKind = typeof AuthenticationPlatformErrorKind[number];

export interface AuthenticationPlatformError {
  readonly kind: AuthenticationPlatformErrorKind;
  readonly message: string;
}

export const AuthenticationPlatformSuccess = ['NO_CONTENT'] as const;
export type AuthenticationPlatformSuccess = typeof AuthenticationPlatformSuccess[number];

export type AuthenticationPlatformSessionState = 'UNAUTHENTICATED' | 'AUTHENTICATING' | 'AUTHENTICATED' | 'DENIED';

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

export const AuthenticationPlatformMfaMode = ['NONE', 'OPTIONAL', 'REQUIRED_TOTP', 'REQUIRED_WEBAUTHN'] as const;
export type AuthenticationPlatformMfaMode = typeof AuthenticationPlatformMfaMode[number];

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

export interface AuthenticationPlatformPreAuth {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly providerAlias: string;
  readonly expiry: string;
}

export interface AuthenticationPlatformDomain {
  readonly domain: string;
  readonly verified: boolean;
  readonly active: boolean;
}

export const AuthenticationPlatformReadinessKind = [
  'READY',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'FORBIDDEN_REALM_OPERATION',
  'REALM_UNREACHABLE',
  'DISCOVERY_INVALID',
  'DEGRADED',
  'CONFIGURED_OK',
] as const;
export type AuthenticationPlatformReadinessKind = typeof AuthenticationPlatformReadinessKind[number];

export interface AuthenticationPlatformReadiness {
  readonly kind: AuthenticationPlatformReadinessKind;
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

export const AuthenticationPlatformPermission = [
  'READ_AUTH_SETTINGS',
  'WRITE_AUTH_SETTINGS',
] as const;
export type AuthenticationPlatformPermission = typeof AuthenticationPlatformPermission[number];

export interface AuthenticationPlatformState {
  readonly sessions: Map<string, AuthenticationPlatformSession>;
  readonly providers: Map<string, AuthenticationPlatformProvider>;
  readonly policies: Map<string, AuthenticationPlatformPolicy>;
  readonly claimMappings: Map<string, readonly AuthenticationPlatformClaimMapping[]>;
  readonly auditLog: readonly AuthenticationPlatformAuditEvent[];
  readonly readiness: AuthenticationPlatformReadinessKind;
  readonly preAuthStore: Map<string, AuthenticationPlatformPreAuth>;
  readonly domains: Map<string, AuthenticationPlatformDomain>;
  readonly platformRealm: string;
  readonly tenantRoleAllowlist: Map<string, readonly string[]>;
  readonly identityProvidersAvailable: boolean;
  readonly sessionStoreAvailable: boolean;
  readonly configurationAvailable: boolean;
  readonly fixtureMode: boolean;
  readonly tenantCredentials: Map<string, AuthenticationPlatformTenantCredential>;
}

export interface AuthenticationPlatformTenantCredential {
  readonly tenantId: string;
  readonly present: boolean;
  readonly canRead: boolean;
  readonly canWrite: boolean;
}

export const initialState: AuthenticationPlatformState = {
  sessions: new Map(),
  providers: new Map(),
  policies: new Map(),
  claimMappings: new Map(),
  auditLog: [],
  readiness: 'DEGRADED',
  preAuthStore: new Map(),
  domains: new Map(),
  platformRealm: 'https://auth.anqr.dev',
  tenantRoleAllowlist: new Map(),
  identityProvidersAvailable: false,
  sessionStoreAvailable: false,
  configurationAvailable: false,
  fixtureMode: false,
  tenantCredentials: new Map(),
};

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function nowIso(): string {
  return new Date().toISOString();
}

export function auditBeforeChange(
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
  alias: string,
  operation: string,
  changedFields: readonly string[],
  secretChanged: boolean,
): AuthenticationPlatformError | null {
  const event: AuthenticationPlatformAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    timestamp: nowIso(),
    alias,
    operation,
    changedFields,
    secretChanged,
  };
  return auditFn(event);
}

export function validateReturnTo(target: string): AuthenticationPlatformError | null {
  if (typeof target !== 'string' || target.trim() === '' || !target.startsWith('/') || target.includes('\n') || target.includes('\r')) {
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
      return { kind: 'UNSAFE_SCHEME', message: 'Issuer URL must use HTTPS for non-local hosts' };
    }
    if (jwksUrl.protocol !== 'https:' && !isLocalHost(jwksUrl.hostname)) {
      return { kind: 'UNSAFE_SCHEME', message: 'JWKS URI must use HTTPS for non-local hosts' };
    }
    return null;
  } catch {
    return { kind: 'INVALID_DOCUMENT', message: 'Invalid OIDC URL format' };
  }
}

export function validateMfaMode(mode: string): AuthenticationPlatformError | null {
  if (!AuthenticationPlatformMfaMode.includes(mode as AuthenticationPlatformMfaMode)) {
    return { kind: 'INVALID_MFA_MODE', message: 'Invalid MFA mode' };
  }
  return null;
}

export function validateLockoutThreshold(threshold: number): AuthenticationPlatformError | null {
  if (typeof threshold !== 'number' || threshold <= 0) {
    return { kind: 'INVALID_LOCKOUT_THRESHOLD', message: 'Lockout threshold must be positive' };
  }
  return null;
}

export function validateSessionLifespan(seconds: number): AuthenticationPlatformError | null {
  if (typeof seconds !== 'number' || seconds <= 0) {
    return { kind: 'INVALID_SESSION_LIFESPAN', message: 'Session lifespan must be positive' };
  }
  return null;
}

export function validateClaimName(claimName: string): AuthenticationPlatformError | null {
  if (typeof claimName !== 'string' || claimName.trim() === '' || /[^a-zA-Z0-9_-]/.test(claimName)) {
    return { kind: 'DANGEROUS_CLAIM_NAME', message: 'Claim name contains invalid characters' };
  }
  return null;
}

export function validateRealmRole(role: string, allowlist: readonly string[]): AuthenticationPlatformError | null {
  if (!allowlist.includes(role)) {
    return { kind: 'INVALID_REALM_ROLE', message: 'Realm role not in allowlist' };
  }
  return null;
}

export function resolveTenantContext(
  state: AuthenticationPlatformState,
  tenantId: string | null,
): AuthenticationPlatformTenantContext | AuthenticationPlatformError {
  if (tenantId === null) {
    return {
      tenantId: '',
      tenantRoles: [],
      realmRoles: [],
    };
  }

  const tenantRoles = state.tenantRoleAllowlist.get(tenantId) ?? [];
  return {
    tenantId,
    tenantRoles,
    realmRoles: [],
  };
}

export function resolvePermissionBundle(
  tenantRoles: readonly string[],
  realmRoles: readonly string[],
  tenantRoleAllowlist: Map<string, readonly string[]>,
  tenantId: string | null,
): readonly string[] {
  const permissions: string[] = [];

  if (tenantId !== null) {
    const allowlist = tenantRoleAllowlist.get(tenantId) ?? [];
    for (const role of tenantRoles) {
      if (allowlist.includes(role)) {
        permissions.push('READ_AUTH_SETTINGS', 'WRITE_AUTH_SETTINGS');
      }
    }
  }

  for (const role of realmRoles) {
    if (role === 'system-admin') {
      permissions.push('READ_AUTH_SETTINGS', 'WRITE_AUTH_SETTINGS');
    }
  }

  return permissions;
}

export function createSession(
  state: AuthenticationPlatformState,
  userId: string,
  tenantId: string | null,
  organisationId: string | null,
  roles: readonly string[],
  displayName: string,
  expiry: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly session: AuthenticationPlatformSession; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantContext = resolveTenantContext(state, tenantId);
  if ('kind' in tenantContext) {
    return tenantContext;
  }

  const permissionBundle = resolvePermissionBundle(
    tenantContext.tenantRoles,
    tenantContext.realmRoles,
    state.tenantRoleAllowlist,
    tenantId,
  );

  const sessionId = crypto.randomUUID();
  const session: AuthenticationPlatformSession = {
    id: sessionId,
    userId,
    tenantId,
    organisationId,
    roles,
    permissionBundle,
    displayName,
    expiry,
    state: 'AUTHENTICATED',
  };

  const auditError = auditFn({
    kind: 'SESSION_CREATED',
    timestamp: nowIso(),
    alias: '',
    operation: 'createSession',
    changedFields: [],
    secretChanged: false,
  });
  if (auditError !== null) {
    return auditError;
  }

  const newSessions = new Map(state.sessions);
  newSessions.set(sessionId, session);

  const newState: AuthenticationPlatformState = {
    ...state,
    sessions: newSessions,
    auditLog: [...state.auditLog, {
      kind: 'SESSION_CREATED',
      timestamp: nowIso(),
      alias: '',
      operation: 'createSession',
      changedFields: [],
      secretChanged: false,
    }],
  };

  return { session, state: newState };
}

export function destroySession(
  state: AuthenticationPlatformState,
  sessionId: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const session = state.sessions.get(sessionId);
  if (session === undefined) {
    return { kind: 'UNAUTHENTICATED', message: 'Session not found' };
  }

  const auditError = auditFn({
    kind: 'SESSION_DESTROYED',
    timestamp: nowIso(),
    alias: '',
    operation: 'destroySession',
    changedFields: [],
    secretChanged: false,
  });
  if (auditError !== null) {
    return auditError;
  }

  const newSessions = new Map(state.sessions);
  newSessions.delete(sessionId);

  const newState: AuthenticationPlatformState = {
    ...state,
    sessions: newSessions,
    auditLog: [...state.auditLog, {
      kind: 'SESSION_DESTROYED',
      timestamp: nowIso(),
      alias: '',
      operation: 'destroySession',
      changedFields: [],
      secretChanged: false,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function lookupSession(
  state: AuthenticationPlatformState,
  sessionId: string,
): AuthenticationPlatformSession | AuthenticationPlatformError {
  if (!state.sessionStoreAvailable && !state.fixtureMode) {
    return { kind: 'UNAUTHENTICATED', message: 'Session store unavailable' };
  }
  const session = state.sessions.get(sessionId);
  if (session === undefined) {
    return { kind: 'UNAUTHENTICATED', message: 'Session not found' };
  }
  return session;
}

export function initiateLogin(
  state: AuthenticationPlatformState,
  returnTo: string,
  providerAlias: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly stateParam: string; readonly codeChallenge: string; readonly nonce: string; readonly returnTo: string; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const returnToError = validateReturnTo(returnTo);
  if (returnToError !== null) {
    return returnToError;
  }

  const provider = state.providers.get(providerAlias);
  if (provider === undefined) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const { codeVerifier, codeChallenge } = generatePkceChallenge();
  const stateParam = crypto.randomBytes(16).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');

  const preAuth: AuthenticationPlatformPreAuth = {
    state: stateParam,
    nonce,
    codeVerifier,
    returnTo,
    providerAlias,
    expiry: nowIso(),
  };

  const auditError = auditFn({
    kind: 'LOGIN_INITIATED',
    timestamp: nowIso(),
    alias: providerAlias,
    operation: 'initiateLogin',
    changedFields: [],
    secretChanged: false,
  });
  if (auditError !== null) {
    return auditError;
  }

  const newPreAuthStore = new Map(state.preAuthStore);
  newPreAuthStore.set(stateParam, preAuth);

  const newState: AuthenticationPlatformState = {
    ...state,
    preAuthStore: newPreAuthStore,
    auditLog: [...state.auditLog, {
      kind: 'LOGIN_INITIATED',
      timestamp: nowIso(),
      alias: providerAlias,
      operation: 'initiateLogin',
      changedFields: [],
      secretChanged: false,
    }],
  };

  return { stateParam, codeChallenge, nonce, returnTo, state: newState };
}

export function handleCallback(
  state: AuthenticationPlatformState,
  code: string,
  stateParam: string,
  nonce: string,
  providerError: string | null,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly session: AuthenticationPlatformSession; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  if (providerError !== null) {
    return { kind: 'PROVIDER_ERROR_CALLBACK', message: 'Generic sign-in error' };
  }

  if (typeof code !== 'string' || code.trim() === '') {
    return { kind: 'INVALID_CODE', message: 'Invalid code parameter' };
  }

  const preAuth = state.preAuthStore.get(stateParam);
  if (preAuth === undefined) {
    return { kind: 'INVALID_STATE', message: 'Invalid state parameter' };
  }

  if (preAuth.nonce !== nonce) {
    return { kind: 'INVALID_NONCE', message: 'Invalid nonce parameter' };
  }

  const provider = state.providers.get(preAuth.providerAlias);
  if (provider === undefined) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const userId = crypto.randomUUID();
  const tenantId: string | null = null;
  const organisationId: string | null = null;
  const roles: string[] = [];
  const displayName = 'Test User';

  const result = createSession(
    state,
    userId,
    tenantId,
    organisationId,
    roles,
    displayName,
    new Date(Date.now() + 3600000).toISOString(),
    auditFn,
  );

  if ('kind' in result) {
    return result;
  }

  return result;
}

export function logout(
  state: AuthenticationPlatformState,
  sessionId: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  return destroySession(state, sessionId, auditFn);
}

export function listProviders(
  state: AuthenticationPlatformState,
  tenantId: string,
  permission: AuthenticationPlatformPermission,
  scope: string,
): readonly AuthenticationPlatformProvider[] | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canRead) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  if (permission !== 'READ_AUTH_SETTINGS' || scope !== 'admin') {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  return Array.from(state.providers.values()).map(provider => ({
    ...provider,
    maskedSecret: 'REDACTED',
  }));
}

export function createProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  issuer: string,
  jwksUri: string,
  scopes: readonly string[],
  maskedSecret: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canWrite) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const aliasError = validateProviderAlias(alias, Array.from(state.providers.keys()));
  if (aliasError !== null) {
    return aliasError;
  }

  const urlError = validateOidcUrls(issuer, jwksUri);
  if (urlError !== null) {
    return urlError;
  }

  const discoveryValidation = {
    issuerValid: true,
    jwksValid: true,
    jwksUriValid: true,
  };

  const auditError = auditBeforeChange(auditFn, alias, 'createProvider', ['alias', 'issuer', 'jwksUri', 'scopes', 'maskedSecret'], true);
  if (auditError !== null) {
    return auditError;
  }

  const provider: AuthenticationPlatformProvider = {
    alias,
    enabled: true,
    issuer,
    jwksUri,
    scopes,
    maskedSecret: 'REDACTED',
    discoveryValidation,
  };

  const newProviders = new Map(state.providers);
  newProviders.set(alias, provider);

  const newState: AuthenticationPlatformState = {
    ...state,
    providers: newProviders,
    auditLog: [...state.auditLog, {
      kind: 'PROVIDER_CREATED',
      timestamp: nowIso(),
      alias,
      operation: 'createProvider',
      changedFields: ['alias', 'issuer', 'jwksUri', 'scopes', 'maskedSecret'],
      secretChanged: true,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function updateProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  updates: Partial<Omit<AuthenticationPlatformProvider, 'alias' | 'discoveryValidation'>>,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canWrite) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const provider = state.providers.get(alias);
  if (provider === undefined) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const changedFields: string[] = [];
  const secretChanged = updates.maskedSecret !== undefined;

  if (updates.issuer !== undefined) {
    const urlError = validateOidcUrls(updates.issuer, provider.jwksUri);
    if (urlError !== null) {
      return urlError;
    }
    changedFields.push('issuer');
  }

  if (updates.jwksUri !== undefined) {
    const urlError = validateOidcUrls(provider.issuer, updates.jwksUri);
    if (urlError !== null) {
      return urlError;
    }
    changedFields.push('jwksUri');
  }

  if (updates.scopes !== undefined) {
    changedFields.push('scopes');
  }

  if (updates.enabled !== undefined) {
    changedFields.push('enabled');
  }

  if (updates.maskedSecret !== undefined) {
    changedFields.push('maskedSecret');
  }

  const auditError = auditBeforeChange(auditFn, alias, 'updateProvider', changedFields, secretChanged);
  if (auditError !== null) {
    return auditError;
  }

  const newProvider: AuthenticationPlatformProvider = {
    ...provider,
    ...updates,
    maskedSecret: updates.maskedSecret !== undefined ? 'REDACTED' : provider.maskedSecret,
  };

  const newProviders = new Map(state.providers);
  newProviders.set(alias, newProvider);

  const newState: AuthenticationPlatformState = {
    ...state,
    providers: newProviders,
    auditLog: [...state.auditLog, {
      kind: 'PROVIDER_UPDATED',
      timestamp: nowIso(),
      alias,
      operation: 'updateProvider',
      changedFields,
      secretChanged,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function deleteProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canWrite) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const provider = state.providers.get(alias);
  if (provider === undefined) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const auditError = auditBeforeChange(auditFn, alias, 'deleteProvider', ['alias'], false);
  if (auditError !== null) {
    return auditError;
  }

  const newProviders = new Map(state.providers);
  newProviders.delete(alias);

  const newState: AuthenticationPlatformState = {
    ...state,
    providers: newProviders,
    auditLog: [...state.auditLog, {
      kind: 'PROVIDER_DELETED',
      timestamp: nowIso(),
      alias,
      operation: 'deleteProvider',
      changedFields: ['alias'],
      secretChanged: false,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function testProviderConnection(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canRead) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const provider = state.providers.get(alias);
  if (provider === undefined) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const auditError = auditBeforeChange(auditFn, alias, 'testProviderConnection', [], false);
  if (auditError !== null) {
    return auditError;
  }

  const newState: AuthenticationPlatformState = {
    ...state,
    auditLog: [...state.auditLog, {
      kind: 'PROVIDER_TESTED',
      timestamp: nowIso(),
      alias,
      operation: 'testProviderConnection',
      changedFields: [],
      secretChanged: false,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function readPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  permission: AuthenticationPlatformPermission,
  scope: string,
): AuthenticationPlatformPolicy | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canRead) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  if (permission !== 'READ_AUTH_SETTINGS' || scope !== 'admin') {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const policy = state.policies.get(tenantId);
  if (policy === undefined) {
    return { kind: 'NOT_FOUND', message: 'Policy not found' };
  }

  return policy;
}

export function writePolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  policy: AuthenticationPlatformPolicy,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canWrite) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const mfaError = validateMfaMode(policy.mfaMode);
  if (mfaError !== null) {
    return mfaError;
  }

  const lockoutError = validateLockoutThreshold(policy.lockoutThreshold);
  if (lockoutError !== null) {
    return lockoutError;
  }

  const lifespanError = validateSessionLifespan(policy.sessionLifespanSeconds);
  if (lifespanError !== null) {
    return lifespanError;
  }

  const auditError = auditBeforeChange(auditFn, tenantId, 'writePolicy', ['mfaMode', 'lockoutThreshold', 'sessionLifespanSeconds'], false);
  if (auditError !== null) {
    return auditError;
  }

  const newPolicies = new Map(state.policies);
  newPolicies.set(tenantId, policy);

  const newState: AuthenticationPlatformState = {
    ...state,
    policies: newPolicies,
    auditLog: [...state.auditLog, {
      kind: 'SESSION_POLICY_UPDATED',
      timestamp: nowIso(),
      alias: tenantId,
      operation: 'writePolicy',
      changedFields: ['mfaMode', 'lockoutThreshold', 'sessionLifespanSeconds'],
      secretChanged: false,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function readClaimMappings(
  state: AuthenticationPlatformState,
  tenantId: string,
  permission: AuthenticationPlatformPermission,
  scope: string,
): readonly AuthenticationPlatformClaimMapping[] | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canRead) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  if (permission !== 'READ_AUTH_SETTINGS' || scope !== 'admin') {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  return state.claimMappings.get(tenantId) ?? [];
}

export function writeClaimMappings(
  state: AuthenticationPlatformState,
  tenantId: string,
  mappings: readonly AuthenticationPlatformClaimMapping[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canWrite) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  for (const mapping of mappings) {
    const claimError = validateClaimName(mapping.claimName);
    if (claimError !== null) {
      return claimError;
    }
  }

  const auditError = auditBeforeChange(auditFn, tenantId, 'writeClaimMappings', ['claimMappings'], false);
  if (auditError !== null) {
    return auditError;
  }

  const newClaimMappings = new Map(state.claimMappings);
  newClaimMappings.set(tenantId, mappings);

  const newState: AuthenticationPlatformState = {
    ...state,
    claimMappings: newClaimMappings,
    auditLog: [...state.auditLog, {
      kind: 'CLAIM_MAPPING_UPDATED',
      timestamp: nowIso(),
      alias: tenantId,
      operation: 'writeClaimMappings',
      changedFields: ['claimMappings'],
      secretChanged: false,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function deriveCallbackUrl(
  state: AuthenticationPlatformState,
  domain: string,
): string | AuthenticationPlatformError {
  const host = state.domains.get(domain);
  if (host === undefined || !host.verified || !host.active) {
    return state.platformRealm;
  }
  return `https://${domain}/auth/callback`;
}

export function checkReadiness(
  state: AuthenticationPlatformState,
  tenantId: string | null,
): AuthenticationPlatformReadiness {
  if (tenantId === null) {
    if (state.fixtureMode) {
      return { kind: 'READY' };
    }
    if (!state.identityProvidersAvailable) {
      return { kind: 'DEGRADED' };
    }
    if (!state.sessionStoreAvailable) {
      return { kind: 'DEGRADED' };
    }
    if (!state.configurationAvailable) {
      return { kind: 'DEGRADED' };
    }
    return { kind: 'READY' };
  }

  const credential = state.tenantCredentials.get(tenantId);
  if (credential === undefined) {
    return { kind: 'MISSING_CREDENTIAL' };
  }
  if (!credential.present) {
    return { kind: 'MISSING_CREDENTIAL' };
  }
  if (!credential.canRead || !credential.canWrite) {
    return { kind: 'INVALID_CREDENTIAL' };
  }
  return { kind: 'CONFIGURED_OK' };
}

export const authenticationPlatformUiSemanticModel: AuthenticationPlatformUiSemanticModel = {
  surfaces: ['login', 'callback', 'session', 'admin'],
  viewModels: ['LoginViewModel', 'CallbackViewModel', 'SessionViewModel', 'AdminViewModel'],
  components: ['LoginForm', 'CallbackHandler', 'SessionDisplay', 'AdminPanel'],
  journeys: ['loginJourney', 'callbackJourney', 'sessionJourney', 'adminJourney'],
  permissions: ['READ_AUTH_SETTINGS', 'WRITE_AUTH_SETTINGS'],
  accessibility: ['screenReader', 'keyboardNav', 'highContrast'],
  localisation: ['en', 'fr', 'de'],
  rendererContracts: ['ReactRenderer', 'VueRenderer', 'AngularRenderer'],
};

export function enableProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  return updateProvider(state, tenantId, alias, { enabled: true }, auditFn);
}

export function disableProvider(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  return updateProvider(state, tenantId, alias, { enabled: false }, auditFn);
}

export function rotateProviderSecret(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  newMaskedSecret: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  return updateProvider(state, tenantId, alias, { maskedSecret: newMaskedSecret }, auditFn);
}

export function importOidcDiscovery(
  state: AuthenticationPlatformState,
  tenantId: string,
  alias: string,
  discoveryDocument: { readonly issuer: string; readonly jwks_uri: string },
  auditFn: (event: AuthenticationPlatformAuditEvent) => AuthenticationPlatformError | null,
): { readonly result: AuthenticationPlatformSuccess; readonly state: AuthenticationPlatformState } | AuthenticationPlatformError {
  const tenantCredential = state.tenantCredentials.get(tenantId);
  if (tenantCredential === undefined || !tenantCredential.present || !tenantCredential.canWrite) {
    return { kind: 'FORBIDDEN', message: 'Insufficient permissions' };
  }

  const urlError = validateOidcUrls(discoveryDocument.issuer, discoveryDocument.jwks_uri);
  if (urlError !== null) {
    return urlError;
  }

  const auditError = auditBeforeChange(auditFn, alias, 'importOidcDiscovery', ['issuer', 'jwksUri'], false);
  if (auditError !== null) {
    return auditError;
  }

  const newState: AuthenticationPlatformState = {
    ...state,
    auditLog: [...state.auditLog, {
      kind: 'PROVIDER_UPDATED',
      timestamp: nowIso(),
      alias,
      operation: 'importOidcDiscovery',
      changedFields: ['issuer', 'jwksUri'],
      secretChanged: false,
    }],
  };

  return { result: 'NO_CONTENT', state: newState };
}

export function forwardAuthCheck(
  state: AuthenticationPlatformState,
  sessionId: string,
): { readonly authenticated: boolean; readonly session: AuthenticationPlatformSession | null } {
  const result = lookupSession(state, sessionId);
  if ('kind' in result) {
    return { authenticated: false, session: null };
  }
  return { authenticated: true, session: result };
}

export function enumerateProviders(
  state: AuthenticationPlatformState,
): readonly string[] {
  return Array.from(state.providers.keys());
}

export function setFixtureMode(
  state: AuthenticationPlatformState,
  enabled: boolean,
): AuthenticationPlatformState {
  return {
    ...state,
    fixtureMode: enabled,
    identityProvidersAvailable: enabled || state.identityProvidersAvailable,
    sessionStoreAvailable: enabled || state.sessionStoreAvailable,
    configurationAvailable: enabled || state.configurationAvailable,
  };
}

export function setIdentityProvidersAvailable(
  state: AuthenticationPlatformState,
  available: boolean,
): AuthenticationPlatformState {
  return { ...state, identityProvidersAvailable: available };
}

export function setSessionStoreAvailable(
  state: AuthenticationPlatformState,
  available: boolean,
): AuthenticationPlatformState {
  return { ...state, sessionStoreAvailable: available };
}

export function setConfigurationAvailable(
  state: AuthenticationPlatformState,
  available: boolean,
): AuthenticationPlatformState {
  return { ...state, configurationAvailable: available };
}

export function setTenantCredential(
  state: AuthenticationPlatformState,
  credential: AuthenticationPlatformTenantCredential,
): AuthenticationPlatformState {
  const newCredentials = new Map(state.tenantCredentials);
  newCredentials.set(credential.tenantId, credential);
  return { ...state, tenantCredentials: newCredentials };
}

export function getProvider(
  state: AuthenticationPlatformState,
  alias: string,
): AuthenticationPlatformProvider | AuthenticationPlatformError {
  const provider = state.providers.get(alias);
  if (provider === undefined) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }
  return { ...provider, maskedSecret: 'REDACTED' };
}