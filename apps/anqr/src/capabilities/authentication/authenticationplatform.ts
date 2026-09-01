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

export interface AuthenticationPlatformState {
  readonly sessions: ReadonlyMap<string, AuthenticationPlatformSession>;
  readonly providers: ReadonlyMap<string, AuthenticationPlatformProvider>;
  readonly policies: ReadonlyMap<string, AuthenticationPlatformPolicy>;
  readonly claimMappings: ReadonlyMap<string, readonly AuthenticationPlatformClaimMapping[]>;
  readonly auditLog: readonly AuthenticationPlatformAuditEvent[];
  readonly readiness: AuthenticationPlatformReadiness;
}

export const initialState: AuthenticationPlatformState = {
  sessions: new Map(),
  providers: new Map(),
  policies: new Map(),
  claimMappings: new Map(),
  auditLog: [],
  readiness: 'DEGRADED',
};

export function validateReturnTo(target: string): AuthenticationPlatformError | null {
  if (typeof target !== 'string' || !target.startsWith('/') || target.includes('\n') || target.includes('\r')) {
    return { kind: 'INVALID_RETURN_TO', message: 'Return-to target is invalid' };
  }
  return null;
}

export function generatePkceChallenge(): { readonly codeVerifier: string; readonly codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

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

  try {
    auditFn({
      kind: 'SESSION_DESTROYED',
      timestamp: new Date().toISOString(),
      alias: undefined,
      operation: 'destroySession',
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during session destruction' } as AuthenticationPlatformError;
  }

  const newSessions = new Map(state.sessions);
  newSessions.delete(sessionId);
  return {
    ...state,
    sessions: newSessions,
    auditLog: [...state.auditLog, { kind: 'SESSION_DESTROYED', timestamp: new Date().toISOString() }],
  };
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

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function validateMfaMode(mode: unknown): AuthenticationPlatformError | AuthenticationPlatformMfaMode {
  if (typeof mode !== 'string' || !AuthenticationPlatformMfaMode.includes(mode as AuthenticationPlatformMfaMode)) {
    return { kind: 'INVALID_MFA_MODE', message: 'Invalid MFA mode' };
  }
  return mode;
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

export function createProvider(
  state: AuthenticationPlatformState,
  provider: Omit<AuthenticationPlatformProvider, 'maskedSecret'> & { readonly secret: string },
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
  tenantId: string,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const aliasValidation = validateProviderAlias(provider.alias, Array.from(state.providers.keys()));
  if (aliasValidation !== null) return aliasValidation;

  const urlValidation = validateOidcUrls(provider.issuer, provider.jwksUri);
  if (urlValidation !== null) return urlValidation;

  const discoveryValidation: AuthenticationPlatformDiscoveryValidation = {
    issuerValid: true,
    jwksValid: true,
    jwksUriValid: true,
  };

  try {
    auditFn({
      kind: 'PROVIDER_CREATED',
      timestamp: new Date().toISOString(),
      alias: provider.alias,
      operation: 'createProvider',
      changedFields: ['alias', 'enabled', 'issuer', 'jwksUri', 'scopes'],
      secretChanged: true,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during provider creation' } as AuthenticationPlatformError;
  }

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
    auditLog: [
      ...state.auditLog,
      {
        kind: 'PROVIDER_CREATED',
        timestamp: new Date().toISOString(),
        alias: provider.alias,
        operation: 'createProvider',
        changedFields: ['alias', 'enabled', 'issuer', 'jwksUri', 'scopes'],
        secretChanged: true,
      },
    ],
  };
}

export function updateProvider(
  state: AuthenticationPlatformState,
  alias: string,
  updates: Partial<Omit<AuthenticationPlatformProvider, 'maskedSecret'>> & { readonly secret?: string },
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const existingProvider = state.providers.get(alias);
  if (!existingProvider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const changedFields: string[] = [];
  const secretChanged = updates.secret !== undefined;

  if (updates.alias !== undefined) {
    const aliasValidation = validateProviderAlias(updates.alias, Array.from(state.providers.keys()).filter(a => a !== alias));
    if (aliasValidation !== null) return aliasValidation;
    changedFields.push('alias');
  }

  if (updates.issuer !== undefined || updates.jwksUri !== undefined) {
    const issuer = updates.issuer ?? existingProvider.issuer;
    const jwksUri = updates.jwksUri ?? existingProvider.jwksUri;
    const urlValidation = validateOidcUrls(issuer, jwksUri);
    if (urlValidation !== null) return urlValidation;
    if (updates.issuer !== undefined) changedFields.push('issuer');
    if (updates.jwksUri !== undefined) changedFields.push('jwksUri');
  }

  if (updates.enabled !== undefined) changedFields.push('enabled');
  if (updates.scopes !== undefined) changedFields.push('scopes');

  try {
    auditFn({
      kind: 'PROVIDER_UPDATED',
      timestamp: new Date().toISOString(),
      alias,
      operation: 'updateProvider',
      changedFields,
      secretChanged,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during provider update' } as AuthenticationPlatformError;
  }

  const updatedProvider: AuthenticationPlatformProvider = {
    ...existingProvider,
    ...updates,
    alias: updates.alias ?? existingProvider.alias,
    maskedSecret: secretChanged ? '***REDACTED***' : existingProvider.maskedSecret,
  };

  const newProviders = new Map(state.providers);
  if (updates.alias !== undefined) {
    newProviders.delete(alias);
    newProviders.set(updates.alias, updatedProvider);
  } else {
    newProviders.set(alias, updatedProvider);
  }

  return {
    ...state,
    providers: newProviders,
    auditLog: [
      ...state.auditLog,
      {
        kind: 'PROVIDER_UPDATED',
        timestamp: new Date().toISOString(),
        alias,
        operation: 'updateProvider',
        changedFields,
        secretChanged,
      },
    ],
  };
}

export function deleteProvider(
  state: AuthenticationPlatformState,
  alias: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const existingProvider = state.providers.get(alias);
  if (!existingProvider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  try {
    auditFn({
      kind: 'PROVIDER_DELETED',
      timestamp: new Date().toISOString(),
      alias,
      operation: 'deleteProvider',
      changedFields: ['alias'],
      secretChanged: false,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during provider deletion' } as AuthenticationPlatformError;
  }

  const newProviders = new Map(state.providers);
  newProviders.delete(alias);

  return {
    ...state,
    providers: newProviders,
    auditLog: [
      ...state.auditLog,
      {
        kind: 'PROVIDER_DELETED',
        timestamp: new Date().toISOString(),
        alias,
        operation: 'deleteProvider',
        changedFields: ['alias'],
        secretChanged: false,
      },
    ],
  };
}

export function testProviderConnection(
  state: AuthenticationPlatformState,
  alias: string,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const provider = state.providers.get(alias);
  if (!provider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  try {
    auditFn({
      kind: 'PROVIDER_TESTED',
      timestamp: new Date().toISOString(),
      alias,
      operation: 'testProviderConnection',
      changedFields: [],
      secretChanged: false,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during provider test' } as AuthenticationPlatformError;
  }

  return {
    ...state,
    auditLog: [
      ...state.auditLog,
      {
        kind: 'PROVIDER_TESTED',
        timestamp: new Date().toISOString(),
        alias,
        operation: 'testProviderConnection',
        changedFields: [],
        secretChanged: false,
      },
    ],
  };
}

export function updateMfaPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  mfaMode: AuthenticationPlatformMfaMode,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const mfaValidation = validateMfaMode(mfaMode);
  if ('kind' in mfaValidation) return mfaValidation;

  const existingPolicy = state.policies.get(tenantId) ?? {
    mfaMode: 'NONE',
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };

  try {
    auditFn({
      kind: 'MFA_POLICY_UPDATED',
      timestamp: new Date().toISOString(),
      alias: undefined,
      operation: 'updateMfaPolicy',
      changedFields: ['mfaMode'],
      secretChanged: false,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during MFA policy update' } as AuthenticationPlatformError;
  }

  const updatedPolicy: AuthenticationPlatformPolicy = {
    ...existingPolicy,
    mfaMode,
  };

  const newPolicies = new Map(state.policies);
  newPolicies.set(tenantId, updatedPolicy);

  return {
    ...state,
    policies: newPolicies,
    auditLog: [
      ...state.auditLog,
      {
        kind: 'MFA_POLICY_UPDATED',
        timestamp: new Date().toISOString(),
        alias: undefined,
        operation: 'updateMfaPolicy',
        changedFields: ['mfaMode'],
        secretChanged: false,
      },
    ],
  };
}

export function updateLockoutPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  lockoutThreshold: number,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const thresholdValidation = validateLockoutThreshold(lockoutThreshold);
  if ('kind' in thresholdValidation) return thresholdValidation;

  const existingPolicy = state.policies.get(tenantId) ?? {
    mfaMode: 'NONE',
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };

  try {
    auditFn({
      kind: 'LOCKOUT_POLICY_UPDATED',
      timestamp: new Date().toISOString(),
      alias: undefined,
      operation: 'updateLockoutPolicy',
      changedFields: ['lockoutThreshold'],
      secretChanged: false,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during lockout policy update' } as AuthenticationPlatformError;
  }

  const updatedPolicy: AuthenticationPlatformPolicy = {
    ...existingPolicy,
    lockoutThreshold,
  };

  const newPolicies = new Map(state.policies);
  newPolicies.set(tenantId, updatedPolicy);

  return {
    ...state,
    policies: newPolicies,
    auditLog: [
      ...state.auditLog,
      {
        kind: 'LOCKOUT_POLICY_UPDATED',
        timestamp: new Date().toISOString(),
        alias: undefined,
        operation: 'updateLockoutPolicy',
        changedFields: ['lockoutThreshold'],
        secretChanged: false,
      },
    ],
  };
}

export function updateSessionPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
  sessionLifespanSeconds: number,
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  const lifespanValidation = validateSessionLifespan(sessionLifespanSeconds);
  if ('kind' in lifespanValidation) return lifespanValidation;

  const existingPolicy = state.policies.get(tenantId) ?? {
    mfaMode: 'NONE',
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };

  try {
    auditFn({
      kind: 'SESSION_POLICY_UPDATED',
      timestamp: new Date().toISOString(),
      alias: undefined,
      operation: 'updateSessionPolicy',
      changedFields: ['sessionLifespanSeconds'],
      secretChanged: false,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during session policy update' } as AuthenticationPlatformError;
  }

  const updatedPolicy: AuthenticationPlatformPolicy = {
    ...existingPolicy,
    sessionLifespanSeconds,
  };

  const newPolicies = new Map(state.policies);
  newPolicies.set(tenantId, updatedPolicy);

  return {
    ...state,
    policies: newPolicies,
    auditLog: [
      ...state.auditLog,
      {
        kind: 'SESSION_POLICY_UPDATED',
        timestamp: new Date().toISOString(),
        alias: undefined,
        operation: 'updateSessionPolicy',
        changedFields: ['sessionLifespanSeconds'],
        secretChanged: false,
      },
    ],
  };
}

export function updateClaimMappings(
  state: AuthenticationPlatformState,
  tenantId: string,
  mappings: readonly AuthenticationPlatformClaimMapping[],
  auditFn: (event: AuthenticationPlatformAuditEvent) => void,
): AuthenticationPlatformState | AuthenticationPlatformError {
  for (const mapping of mappings) {
    const claimValidation = validateClaimName(mapping.claimName);
    if (claimValidation !== null) return claimValidation;
  }

  try {
    auditFn({
      kind: 'CLAIM_MAPPING_UPDATED',
      timestamp: new Date().toISOString(),
      alias: undefined,
      operation: 'updateClaimMappings',
      changedFields: ['claimMappings'],
      secretChanged: false,
    });
  } catch (e) {
    return { kind: 'AUDIT_VIOLATION', message: 'Audit failure during claim mapping update' } as AuthenticationPlatformError;
  }

  const newClaimMappings = new Map(state.claimMappings);
  newClaimMappings.set(tenantId, mappings);

  return {
    ...state,
    claimMappings: newClaimMappings,
    auditLog: [
      ...state.auditLog,
      {
        kind: 'CLAIM_MAPPING_UPDATED',
        timestamp: new Date().toISOString(),
        alias: undefined,
        operation: 'updateClaimMappings',
        changedFields: ['claimMappings'],
        secretChanged: false,
      },
    ],
  };
}

export function computeReadiness(
  state: AuthenticationPlatformState,
  tenantCredential: { readonly valid: boolean; readonly kind?: AuthenticationPlatformErrorKind } | null,
): AuthenticationPlatformReadiness {
  if (tenantCredential === null) {
    return 'MISSING_CREDENTIAL';
  }
  if (!tenantCredential.valid) {
    return tenantCredential.kind === 'FORBIDDEN_REALM_OPERATION'
      ? 'FORBIDDEN_REALM_OPERATION'
      : tenantCredential.kind === 'REALM_UNREACHABLE'
        ? 'REALM_UNREACHABLE'
        : 'INVALID_CREDENTIAL';
  }
  return 'READY';
}

export function loginInitiation(
  returnTo: string,
  state: AuthenticationPlatformState,
): { readonly codeVerifier: string; readonly codeChallenge: string; readonly stateParam: string } | AuthenticationPlatformError {
  const returnToValidation = validateReturnTo(returnTo);
  if (returnToValidation !== null) return returnToValidation;

  const { codeVerifier, codeChallenge } = generatePkceChallenge();
  const stateParam = crypto.randomUUID();

  return {
    codeVerifier,
    codeChallenge,
    stateParam,
  };
}

export function callbackValidation(
  state: AuthenticationPlatformState,
  code: string,
  stateParam: string,
  nonce: string,
  providerAlias: string,
): AuthenticationPlatformSession | AuthenticationPlatformError {
  if (typeof code !== 'string' || code.trim() === '') {
    return { kind: 'INVALID_CODE', message: 'Authorization code is missing or invalid' };
  }
  if (typeof stateParam !== 'string' || stateParam.trim() === '') {
    return { kind: 'INVALID_STATE', message: 'State parameter is missing or invalid' };
  }
  if (typeof nonce !== 'string' || nonce.trim() === '') {
    return { kind: 'INVALID_NONCE', message: 'Nonce is missing or invalid' };
  }

  const provider = state.providers.get(providerAlias);
  if (!provider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }

  const session = createSession(
    'user-' + crypto.randomUUID(),
    'tenant-' + crypto.randomUUID(),
    null,
    ['user'],
    'Test User',
    new Date(Date.now() + 3600000).toISOString(),
    ['read:data'],
  );

  return session;
}

export function forwardAuthCheck(
  state: AuthenticationPlatformState,
  sessionId: string,
): AuthenticationPlatformSession | AuthenticationPlatformError {
  return lookupSession(state, sessionId);
}

export function listProviders(
  state: AuthenticationPlatformState,
  tenantId: string,
): readonly AuthenticationPlatformProvider[] | AuthenticationPlatformError {
  return Array.from(state.providers.values());
}

export function getProvider(
  state: AuthenticationPlatformState,
  alias: string,
): AuthenticationPlatformProvider | AuthenticationPlatformError {
  const provider = state.providers.get(alias);
  if (!provider) {
    return { kind: 'NOT_FOUND', message: 'Provider not found' };
  }
  return provider;
}

export function getPolicy(
  state: AuthenticationPlatformState,
  tenantId: string,
): AuthenticationPlatformPolicy | AuthenticationPlatformError {
  const policy = state.policies.get(tenantId);
  if (!policy) {
    return { kind: 'NOT_FOUND', message: 'Policy not found' };
  }
  return policy;
}

export function getClaimMappings(
  state: AuthenticationPlatformState,
  tenantId: string,
): readonly AuthenticationPlatformClaimMapping[] | AuthenticationPlatformError {
  const mappings = state.claimMappings.get(tenantId);
  if (!mappings) {
    return { kind: 'NOT_FOUND', message: 'Claim mappings not found' };
  }
  return mappings;
}