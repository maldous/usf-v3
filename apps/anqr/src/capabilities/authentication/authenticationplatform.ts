```typescript
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

export const AuthenticationPlatformReadiness = [
  'READY',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'FORBIDDEN_REALM_OPERATION',
  'REALM_UNREACHABLE',
  'DISCOVERY_INVALID',
  'DEGRADED',
  'CONFIGURED_OK',
] as const;
export type AuthenticationPlatformReadiness = typeof AuthenticationPlatformReadiness[number];

export const AuthenticationPlatformMfaMode = ['NONE', 'OPTIONAL', 'REQUIRED_TOTP', 'REQUIRED_WEBAUTHN'] as const;
export type AuthenticationPlatformMfaMode = typeof AuthenticationPlatformMfaMode[number];

export const AuthenticationPlatformSessionState = ['UNAUTHENTICATED', 'AUTHENTICATING', 'AUTHENTICATED', 'DENIED'] as const;
export type AuthenticationPlatformSessionState = typeof AuthenticationPlatformSessionState[number];

export const AuthenticationPlatformSuccess = ['NO_CONTENT'] as const;
export type AuthenticationPlatformSuccess = typeof AuthenticationPlatformSuccess[number];

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

export interface AuthenticationPlatformNoContentResult {
  readonly success: true;
  readonly kind: AuthenticationPlatformSuccess;
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

export interface AuthenticationPlatformState {
  readonly sessions: ReadonlyMap<string, AuthenticationPlatformSession>;
  readonly providers: ReadonlyMap<string, AuthenticationPlatformProvider>;
  readonly policies: ReadonlyMap<string, AuthenticationPlatformPolicy>;
  readonly claimMappings: ReadonlyMap<string, readonly AuthenticationPlatformClaimMapping[]>;
  readonly auditLog: readonly AuthenticationPlatformAuditEvent[];
  readonly readiness: AuthenticationPlatformReadiness;
  readonly preAuthStore: ReadonlyMap<string, AuthenticationPlatformPreAuth>;
  readonly domains: ReadonlyMap<string, AuthenticationPlatformDomain>;
  readonly platformRealm: string;
  readonly tenantRoleAllowlist: ReadonlyMap<string, readonly string[]>;
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
};

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
  if (typeof threshold !== 'number' || threshold <= 0 || !Number.isInteger(threshold)) {
    return { kind: 'INVALID_LOCKOUT_THRESHOLD', message: 'Lockout threshold must be a positive integer' };
  }
  return threshold;
}

export function validateSessionLifespan(seconds: unknown): AuthenticationPlatformError | number {
  if (typeof seconds !== 'number' || seconds <= 0 || seconds > 86400 * 30 || !Number.isInteger(seconds)) {
    return { kind: 'INVALID_SESSION_LIFESPAN', message: 'Session lifespan must be a positive integer within bounds' };
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
  if (typeof role !== 'string' || !allowlist.includes(role)) {
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

  const auditError = auditBeforeChange(
    auditFn,
    session.tenantId ?? 'system',
    'destroySession',
    ['sessionId'],
    false,
  );
  if (auditError) return auditError;

  const newSessions = new Map(state.sessions);
  newSessions.delete(sessionId);

  return {
    ...state,
    sessions: newSessions,
    auditLog: [
      ...state.auditLog,
      { kind: 'SESSION_DESTROYED', timestamp: nowIso(), alias: session.tenantId ?? 'system', operation: 'destroySession' },
    ],
  };
}

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
  readonly preAuthKey: string;
} | AuthenticationPlatformError {
  const