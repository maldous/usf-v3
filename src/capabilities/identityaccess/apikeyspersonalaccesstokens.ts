export const ApiKeysPersonalAccessTokensOutcome = ['OK', 'NOT_ENTITLED'] as const;
export type ApiKeysPersonalAccessTokensOutcome = typeof ApiKeysPersonalAccessTokensOutcome[number];

export const ApiKeysPersonalAccessTokensErrorKind = [
  'INVALID_ROUTE_IDENTIFIER',
  'PROVIDER_FAILURE',
  'AUDIT_VIOLATION',
  'NOT_ENTITLED',
  'MALFORMED_SECRET',
  'DEGRADED',
] as const;
export type ApiKeysPersonalAccessTokensErrorKind = typeof ApiKeysPersonalAccessTokensErrorKind[number];

export const ApiKeysPersonalAccessTokensReadiness = ['READY', 'DEGRADED'] as const;
export type ApiKeysPersonalAccessTokensReadiness = typeof ApiKeysPersonalAccessTokensReadiness[number];

export const ApiKeysPersonalAccessTokensAuditEventKind = ['key-created', 'key-revoked'] as const;
export type ApiKeysPersonalAccessTokensAuditEventKind = typeof ApiKeysPersonalAccessTokensAuditEventKind[number];

export const ApiKeysPersonalAccessTokensActor = ['NO_ACTOR'] as const;
export type ApiKeysPersonalAccessTokensActor = typeof ApiKeysPersonalAccessTokensActor[number];

export interface ApiKeysPersonalAccessTokensAuditEvent {
  readonly kind: ApiKeysPersonalAccessTokensAuditEventKind;
  readonly tenantId: string;
  readonly keyId: string;
  readonly timestamp: string;
}

export interface ApiKeysPersonalAccessTokensError {
  readonly kind: ApiKeysPersonalAccessTokensErrorKind;
  readonly message: string;
  readonly statusCode: number;
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

export interface ApiKeysPersonalAccessTokensAuthenticationResult {
  readonly tenantId: string;
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
  ) => ApiKeysPersonalAccessTokensAuthenticationResult | null | ApiKeysPersonalAccessTokensError;
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

export const initialState: ApiKeysPersonalAccessTokensState | null = null;

export function validateRouteIdentifier(keyId: string): boolean {
  if (typeof keyId !== 'string') {
    return false;
  }
  return /^[a-zA-Z0-9-]{1,64}$/.test(keyId);
}

export function isError(value: unknown): value is ApiKeysPersonalAccessTokensError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('kind' in value)) {
    return false;
  }
  const kind = (value as { kind: unknown }).kind;
  if (typeof kind !== 'string') {
    return false;
  }
  const allowed: readonly string[] = ApiKeysPersonalAccessTokensErrorKind;
  return allowed.indexOf(kind) !== -1;
}

export function computeReadiness(
  config: ApiKeysPersonalAccessTokensConfig,
): ApiKeysPersonalAccessTokensReadiness {
  try {
    const result = config.repository.listMetadata('__readiness_probe__');
    if (isError(result)) {
      return 'DEGRADED';
    }
    return 'READY';
  } catch {
    return 'DEGRADED';
  }
}

export function isDegraded(config: ApiKeysPersonalAccessTokensConfig): boolean {
  return computeReadiness(config) === 'DEGRADED';
}

function wrapRepositoryError(error: ApiKeysPersonalAccessTokensError): ApiKeysPersonalAccessTokensError {
  return { kind: 'PROVIDER_FAILURE', message: error.message, statusCode: 503 };
}

function notEntitledError(): { readonly outcome: 'NOT_ENTITLED' } {
  return { outcome: 'NOT_ENTITLED' };
}

function noActor(): { readonly outcome: 'NO_ACTOR' } {
  return { outcome: 'NO_ACTOR' };
}

function performAudit(
  auditFn: (event: ApiKeysPersonalAccessTokensAuditEvent) => void | ApiKeysPersonalAccessTokensError,
  event: ApiKeysPersonalAccessTokensAuditEvent,
): ApiKeysPersonalAccessTokensError | null {
  try {
    const result = auditFn(event);
    if (result === undefined) {
      return null;
    }
    if (result === null) {
      return { kind: 'AUDIT_VIOLATION', message: 'Audit returned null', statusCode: 403 };
    }
    if (isError(result)) {
      return result;
    }
    return { kind: 'AUDIT_VIOLATION', message: 'Audit returned unexpected value', statusCode: 403 };
  } catch (err) {
    return {
      kind: 'AUDIT_VIOLATION',
      message: err instanceof Error ? err.message : 'Audit failed',
      statusCode: 403,
    };
  }
}

export function generateKeyId(salt: string): string {
  const sanitized = salt.replace(/[^a-zA-Z0-9-]/g, 'x');
  const trimmed = sanitized.length > 16 ? sanitized.slice(0, 16) : sanitized.padEnd(8, 'x');
  const uniqueSuffix = Math.random().toString(36).slice(2, 10);
  return `ak-${trimmed}-${uniqueSuffix}`;
}

export function createKey(
  config: ApiKeysPersonalAccessTokensConfig,
  auditFn: (event: ApiKeysPersonalAccessTokensAuditEvent) => void | ApiKeysPersonalAccessTokensError,
  tenantId: string,
  scopes: readonly string[],
):
  | { readonly outcome: 'OK'; readonly keyId: string; readonly metadata: ApiKeysPersonalAccessTokensMetadata }
  | { readonly outcome: 'NOT_ENTITLED' }
  | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.tenantApiKeyWrite) {
    return notEntitledError();
  }
  if (!config.permissions.apiAccessEntitlement) {
    return notEntitledError();
  }

  if (isDegraded(config)) {
    return { kind: 'DEGRADED', message: 'Store unavailable for mutation', statusCode: 503 };
  }

  const salt = config.crypto.generateSalt();
  const keyId = generateKeyId(salt);
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Generated key identifier is invalid', statusCode: 400 };
  }

  const secret = config.crypto.generateSecret();
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

  const auditError = performAudit(auditFn, auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const repoResult = config.repository.create(tenantId, keyId, state);
  if (isError(repoResult)) {
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

  return { outcome: 'OK', keyId, metadata };
}

export function revokeKey(
  config: ApiKeysPersonalAccessTokensConfig,
  auditFn: (event: ApiKeysPersonalAccessTokensAuditEvent) => void | ApiKeysPersonalAccessTokensError,
  tenantId: string,
  keyId: string,
): { readonly outcome: 'OK' } | { readonly outcome: 'NOT_ENTITLED' } | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.tenantApiKeyWrite) {
    return notEntitledError();
  }
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Invalid key identifier', statusCode: 400 };
  }

  if (isDegraded(config)) {
    return { kind: 'DEGRADED', message: 'Store unavailable for mutation', statusCode: 503 };
  }

  const metadata = config.repository.readMetadata(tenantId, keyId);
  if (metadata === null) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Key not found', statusCode: 400 };
  }
  if (isError(metadata)) {
    return wrapRepositoryError(metadata);
  }

  const now = config.now();
  const auditEvent: ApiKeysPersonalAccessTokensAuditEvent = {
    kind: 'key-revoked',
    tenantId,
    keyId,
    timestamp: now,
  };

  const auditError = performAudit(auditFn, auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const repoResult = config.repository.revoke(tenantId, keyId);
  if (isError(repoResult)) {
    return wrapRepositoryError(repoResult);
  }

  return { outcome: 'OK' };
}

export function listKeys(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
):
  | { readonly outcome: 'OK'; readonly keys: readonly ApiKeysPersonalAccessTokensMetadata[] }
  | { readonly outcome: 'NOT_ENTITLED' }
  | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.tenantApiKeyRead) {
    return notEntitledError();
  }

  const result = config.repository.listMetadata(tenantId);
  if (isError(result)) {
    return wrapRepositoryError(result);
  }
  if (result === null) {
    return { outcome: 'OK', keys: [] };
  }
  return { outcome: 'OK', keys: result };
}

export function operatorListKeys(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
):
  | { readonly outcome: 'OK'; readonly keys: readonly ApiKeysPersonalAccessTokensMetadata[] }
  | { readonly outcome: 'NOT_ENTITLED' }
  | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.platformApiKeyRead) {
    return notEntitledError();
  }

  const result = config.repository.listMetadata(tenantId);
  if (isError(result)) {
    return wrapRepositoryError(result);
  }
  if (result === null) {
    return { outcome: 'OK', keys: [] };
  }
  return { outcome: 'OK', keys: result };
}

export function readKeyMetadata(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
  keyId: string,
): ApiKeysPersonalAccessTokensMetadata | { readonly outcome: 'NOT_ENTITLED' } | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.tenantApiKeyRead) {
    return notEntitledError();
  }
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Invalid key identifier', statusCode: 400 };
  }

  const result = config.repository.readMetadata(tenantId, keyId);
  if (result === null) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Key not found', statusCode: 400 };
  }
  if (isError(result)) {
    return wrapRepositoryError(result);
  }
  return result;
}

export function readDeveloperContext(
  config: ApiKeysPersonalAccessTokensConfig,
  tenantId: string,
):
  | { readonly outcome: 'OK'; readonly tenantId: string; readonly keys: readonly ApiKeysPersonalAccessTokensMetadata[] }
  | { readonly outcome: 'NOT_ENTITLED' }
  | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.tenantApiKeyRead) {
    return notEntitledError();
  }
  const result = config.repository.listMetadata(tenantId);
  if (isError(result)) {
    return wrapRepositoryError(result);
  }
  if (result === null) {
    return { outcome: 'OK', tenantId, keys: [] };
  }
  return { outcome: 'OK', tenantId, keys: result };
}

export function authenticateKey(
  config: ApiKeysPersonalAccessTokensConfig,
  keyId: string,
  secret: string,
):
  | ApiKeysPersonalAccessTokensAuthenticationResult
  | { readonly outcome: 'NO_ACTOR' }
  | ApiKeysPersonalAccessTokensError {
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'MALFORMED_SECRET', message: 'Invalid key identifier', statusCode: 400 };
  }

  if (typeof secret !== 'string' || secret.length === 0) {
    return { kind: 'MALFORMED_SECRET', message: 'Malformed secret', statusCode: 400 };
  }

  if (isDegraded(config)) {
    return { kind: 'PROVIDER_FAILURE', message: 'Provider unavailable', statusCode: 503 };
  }

  const result = config.repository.authenticate(keyId, secret);
  if (isError(result)) {
    return wrapRepositoryError(result);
  }
  if (result === null) {
    return noActor();
  }
  return result;
}

export function mapErrorToStatusCode(error: ApiKeysPersonalAccessTokensError): number {
  switch (error.kind) {
    case 'INVALID_ROUTE_IDENTIFIER':
    case 'MALFORMED_SECRET':
      return 400;
    case 'NOT_ENTITLED':
    case 'AUDIT_VIOLATION':
      return 403;
    case 'PROVIDER_FAILURE':
    case 'DEGRADED':
    default:
      return 503;
  }
}

export function createKeyWithSecret(
  config: ApiKeysPersonalAccessTokensConfig,
  auditFn: (event: ApiKeysPersonalAccessTokensAuditEvent) => void | ApiKeysPersonalAccessTokensError,
  tenantId: string,
  scopes: readonly string[],
):
  | { readonly outcome: 'OK'; readonly secret: string; readonly keyId: string; readonly metadata: ApiKeysPersonalAccessTokensMetadata }
  | { readonly outcome: 'NOT_ENTITLED' }
  | ApiKeysPersonalAccessTokensError {
  if (!config.permissions.tenantApiKeyWrite) {
    return notEntitledError();
  }
  if (!config.permissions.apiAccessEntitlement) {
    return notEntitledError();
  }

  if (isDegraded(config)) {
    return { kind: 'DEGRADED', message: 'Store unavailable for mutation', statusCode: 503 };
  }

  const salt = config.crypto.generateSalt();
  const keyId = generateKeyId(salt);
  if (!validateRouteIdentifier(keyId)) {
    return { kind: 'INVALID_ROUTE_IDENTIFIER', message: 'Generated key identifier is invalid', statusCode: 400 };
  }

  const secret = config.crypto.generateSecret();
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

  const auditError = performAudit(auditFn, auditEvent);
  if (auditError !== null) {
    return auditError;
  }

  const repoResult = config.repository.create(tenantId, keyId, state);
  if (isError(repoResult)) {
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

  return { outcome: 'OK', secret, keyId, metadata };
}