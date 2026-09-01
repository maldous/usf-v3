export const ApiKeysPersonalAccessTokensOutcome = ['OK', 'NOT_ENTITLED'] as const;
export type ApiKeysPersonalAccessTokensOutcome = typeof ApiKeysPersonalAccessTokensOutcome[number];

export const ApiKeysPersonalAccessTokensErrorKind = [
  'INVALID_ROUTE_IDENTIFIER',
  'PROVIDER_FAILURE',
  'AUDIT_VIOLATION',
] as const;
export type ApiKeysPersonalAccessTokensErrorKind = typeof ApiKeysPersonalAccessTokensErrorKind[number];

export interface ApiKeysPersonalAccessTokensError {
  readonly kind: ApiKeysPersonalAccessTokensErrorKind;
  readonly message: string;
}

export const ApiKeysPersonalAccessTokensReadiness = ['READY', 'DEGRADED'] as const;
export type ApiKeysPersonalAccessTokensReadiness = typeof ApiKeysPersonalAccessTokensReadiness[number];

export const ApiKeysPersonalAccessTokensAuditEventKind = ['key-created', 'key-revoked'] as const;
export type ApiKeysPersonalAccessTokensAuditEventKind = typeof ApiKeysPersonalAccessTokensAuditEventKind[number];

export interface ApiKeysPersonalAccessTokensAuditEvent {
  readonly kind: ApiKeysPersonalAccessTokensAuditEventKind;
  readonly tenantId: string;
  readonly keyId: string;
  readonly timestamp: string;
}

export interface ApiKeysPersonalAccessTokensState {
  readonly active: boolean;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiry: string | null;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
  readonly hash: string;
  readonly salt: string;
}

export interface ApiKeysPersonalAccessTokensMetadata {
  readonly keyId: string;
  readonly tenantId: string;
  readonly active: boolean;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiry: string | null;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
}

export interface ApiKeysPersonalAccessTokensRepository {
  readonly create: (
    tenantId: string,
    keyId: string,
    state: ApiKeysPersonalAccessTokensState,
  ) => ApiKeysPersonalAccessTokensState | ApiKeysPersonalAccessTokensError;
  readonly readMetadata: (tenantId: string, keyId: string) => ApiKeysPersonalAccessTokensMetadata | null | ApiKeysPersonalAccessTokensError;
  readonly listMetadata: (tenantId: string) => readonly ApiKeysPersonalAccessTokensMetadata[] | ApiKeysPersonalAccessTokensError;
  readonly revoke: (tenantId: string, keyId: string) => void | ApiKeysPersonalAccessTokensError;
  readonly authenticate: (
    keyId: string,
    secret: string,
  ) => { readonly tenantId: string; readonly scopes: readonly string[] } | null | ApiKeysPersonalAccessTokensError;
}

export interface ApiKeysPersonalAccessTokensPermissions {
  readonly tenantApiKeyRead: boolean;
  readonly tenantApiKeyWrite: boolean;
  readonly platformApiKeyRead: boolean;
  readonly apiAccessEntitlement: boolean;
}

export interface ApiKeysPersonalAccessTokensConfig {
  readonly repository: ApiKeysPersonalAccessTokensRepository;
  readonly permissions: ApiKeysPersonalAccessTokensPermissions;
  readonly audit: (event: ApiKeysPersonalAccessTokensAuditEvent) => void | ApiKeysPersonalAccessTokensError;
  readonly crypto: {
    readonly generateSecret: () => string;
    readonly hashSecret: (secret: string, salt: string) => string;
    readonly generateSalt: () => string;
  };
  readonly now: () => string;
}

export const initialState = null;

export function validateRouteIdentifier(keyId: string): boolean {
  return /^[a-zA-Z0-9-]{1,64}$/.test(keyId);
}

export function computeReadiness(
  config: ApiKeysPersonalAccessTokensConfig,
): ApiKeysPersonalAccessTokensReadiness {
  try {
    const result = config.repository.listMetadata('dummy-tenant');
    if (result === null || 'kind' in result) {
      return 'DEGRADED';
    }
    return 'READY';
  } catch {
    return 'DEGRADED';
  }
}

function wrapRepositoryError(error: ApiKeysPersonalAccessTokensError): ApiKeysPersonalAccessTokensError {
  return { kind: 'PROVIDER_FAILURE', message: error.message };
}

export function createKey(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
  scopes: readonly string[],
): { readonly outcome: ApiKeysPersonalAccessTokensOutcome } | { readonly secret: string; readonly keyId: string; readonly metadata: ApiKeysPersonalAccessTokensMetadata } | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.apiAccessEntitlement) {
    return { outcome: 'NOT_ENTITLED' };
  }
  if (!config.permissions.tenantApiKeyWrite) {
    return { outcome: 'NOT_ENTITLED' };
  }

  if (computeReadiness(config) === 'DEGRADED') {
    return { kind: 'PROVIDER_FAILURE', message: 'Store unavailable for mutation' };
  }

  const keyId = `ak-${config.crypto.generateSalt().substring(0, 16)}`;
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Generated key identifier is invalid' };
  }

  const secret = config.crypto.generateSecret();
  const salt = config.crypto.generateSalt();
  const hash = config.crypto.hashSecret(secret, salt);
  const now = config.now();

  const state: ApiKeysPersonalAccessTokensState = {
    active: true,
    revokedAt: null,
    createdAt: now,
    lastUsedAt: null,
    expiry: null,
    keyPrefix: keyId.substring(0, 8),
    scopes,
    hash,
    salt,
  };

  const auditEvent: ApiKeysPersonalAccessTokensAuditEvent = {
    kind: 'key-created',
    tenantId,
    keyId,
    timestamp: now,
  };

  const auditResult = config.audit(auditEvent);
  if (auditResult && 'kind' in auditResult) {
    return auditResult;
  }

  const repoResult = config.repository.create(tenantId, keyId, state);
  if ('kind' in repoResult) {
    return wrapRepositoryError(repoResult);
  }

  const metadata: ApiKeysPersonalAccessTokensMetadata = {
    keyId,
    tenantId,
    active: true,
    revokedAt: null,
    createdAt: now,
    lastUsedAt: null,
    expiry: null,
    keyPrefix: keyId.substring(0, 8),
    scopes,
  };

  return { secret, keyId, metadata };
}

export function revokeKey(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
  keyId: string,
): { readonly outcome: ApiKeysPersonalAccessTokensOutcome } | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.tenantApiKeyWrite) {
    return { outcome: 'NOT_ENTITLED' };
  }
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Invalid key identifier' };
  }

  if (computeReadiness(config) === 'DEGRADED') {
    return { kind: 'PROVIDER_FAILURE', message: 'Store unavailable for mutation' };
  }

  const metadata = config.repository.readMetadata(tenantId, keyId);
  if (metadata === null) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Key not found' };
  }
  if ('kind' in metadata) {
    return wrapRepositoryError(metadata);
  }

  const now = config.now();
  const auditEvent: ApiKeysPersonalAccessTokensAuditEvent = {
    kind: 'key-revoked',
    tenantId,
    keyId,
    timestamp: now,
  };

  const auditResult = config.audit(auditEvent);
  if (auditResult && 'kind' in auditResult) {
    return auditResult;
  }

  const repoResult = config.repository.revoke(tenantId, keyId);
  if (repoResult && 'kind' in repoResult) {
    return wrapRepositoryError(repoResult);
  }

  return { outcome: 'OK' };
}

export function listKeys(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
): readonly ApiKeysPersonalAccessTokensMetadata[] | { readonly kind: ApiKeysPersonalAccessTokensErrorKind; readonly message: string } {
  if (!config.permissions.tenantApiKeyRead) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Not entitled' };
  }

  const result = config.repository.listMetadata(tenantId);
  if (result === null || 'kind' in result) {
    return result === null ? [] : wrapRepositoryError(result);
  }
  return result;
}

export function operatorListKeys(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
): readonly ApiKeysPersonalAccessTokensMetadata[] | { readonly kind: ApiKeysPersonalAccessTokensErrorKind; readonly message: string } {
  if (!config.permissions.platformApiKeyRead) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Not entitled' };
  }

  const result = config.repository.listMetadata(tenantId);
  if (result === null || 'kind' in result) {
    return result === null ? [] : wrapRepositoryError(result);
  }
  return result;
}

export function readKeyMetadata(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
  keyId: string,
): ApiKeysPersonalAccessTokensMetadata | { readonly kind: ApiKeysPersonalAccessTokensErrorKind; readonly message: string } {
  if (!config.permissions.tenantApiKeyRead) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Not entitled' };
  }
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Invalid key identifier' };
  }

  const result = config.repository.readMetadata(tenantId, keyId);
  if (result === null) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Key not found' };
  }
  if ('kind' in result) {
    return wrapRepositoryError(result);
  }
  return result;
}

export function authenticateKey(
  config: ApiKeysPersonalAccessTokensConfig,
  keyId: string,
  secret: string,
): { readonly tenantId: string; readonly scopes: readonly string[] } | null | ApiKeysPersonalAccessTokensError {
  if (!validateRouteIdentifier(keyId)) {
    return null;
  }

  const result = config.repository.authenticate(keyId, secret);
  if (result === null) {
    return null;
  }
  if ('kind' in result) {
    return wrapRepositoryError(result);
  }
  return result;
}