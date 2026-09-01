import * as crypto from 'crypto';

export const WriteOnlySecretSettingsErrorKind = [
  'NO_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'FORBIDDEN_REALM_OPERATION',
  'REALM_UNREACHABLE',
  'VALIDATION_FAILURE',
  'NOT_FOUND',
  'PROVIDER_UNAVAILABLE',
  'AUDIT_FAILURE',
  'PERMISSION_DENIED',
] as const;
export type WriteOnlySecretSettingsErrorKind = typeof WriteOnlySecretSettingsErrorKind[number];

export const WriteOnlySecretSettingsReadiness = [
  'CONFIGURED',
  'MISSING',
  'INVALID',
  'FORBIDDEN',
  'UNREACHABLE',
  'PROVIDER_UNAVAILABLE',
  'READY',
  'NOT_READY',
] as const;
export type WriteOnlySecretSettingsReadiness = typeof WriteOnlySecretSettingsReadiness[number];

export const WriteOnlySecretSettingsScope = [
  'AUTH_SETTINGS_WRITE',
  'PROVIDER_CONFIG_WRITE',
  'WEBHOOK_WRITE',
  'API_KEY_CREATE',
  'API_KEY_REVOKE',
  'SETTINGS_READ',
] as const;
export type WriteOnlySecretSettingsScope = typeof WriteOnlySecretSettingsScope[number];

export const WriteOnlySecretSettingsAuditEventKind = [
  'AUDIT_SECRET_CREATE',
  'AUDIT_SECRET_UPDATE',
  'AUDIT_SECRET_ROTATE',
  'AUDIT_SECRET_REVOKE',
  'AUDIT_READINESS_CHECK',
] as const;
export type WriteOnlySecretSettingsAuditEventKind = typeof WriteOnlySecretSettingsAuditEventKind[number];

export const WriteOnlySecretSettingsCryptoMode = [
  'ENCRYPTED',
  'TEST_UNENCRYPTED_MARKER',
] as const;
export type WriteOnlySecretSettingsCryptoMode = typeof WriteOnlySecretSettingsCryptoMode[number];

export const WriteOnlySecretSettingsAdapterType = [
  'PROVIDER_BACKED',
  'PERSISTENCE_BACKED',
] as const;
export type WriteOnlySecretSettingsAdapterType = typeof WriteOnlySecretSettingsAdapterType[number];

export interface WriteOnlySecretSettingsError {
  readonly success: false;
  readonly kind: WriteOnlySecretSettingsErrorKind;
  readonly message: string;
  readonly statusCode: number;
}

export interface WriteOnlySecretSettingsAuditEvent {
  readonly kind: WriteOnlySecretSettingsAuditEventKind;
  readonly tenantId: string;
  readonly alias: string;
  readonly changedFields: readonly string[];
  readonly hasSecret: boolean;
  readonly secretChanged: boolean;
  readonly configKeyNames: readonly string[];
  readonly readinessResult: WriteOnlySecretSettingsReadiness;
  readonly timestamp: string;
}

export type WriteOnlySecretSettingsAuditFn = (
  event: WriteOnlySecretSettingsAuditEvent
) => { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface ProtectedTokenCryptoState {
  readonly mode: WriteOnlySecretSettingsCryptoMode;
  readonly ciphertextHex: string;
  readonly ivHex: string;
  readonly tagHex: string;
  readonly keyFingerprint: string;
}

export interface IdentityProviderSecretMetadata {
  readonly tenantId: string;
  readonly providerId: string;
  readonly alias: string;
  readonly url: string;
  readonly hasSecret: boolean;
  readonly maskedValue: string;
  readonly lastRotatedAt: string;
  readonly readiness: WriteOnlySecretSettingsReadiness;
}

export interface MailSenderSecretMetadata {
  readonly tenantId: string;
  readonly senderId: string;
  readonly host: string;
  readonly port: number;
  readonly hasSecret: boolean;
  readonly readiness: WriteOnlySecretSettingsReadiness;
  readonly crypto: ProtectedTokenCryptoState;
}

export interface WebhookSecretMetadata {
  readonly tenantId: string;
  readonly webhookId: string;
  readonly endpointUrl: string;
  readonly hasSecret: boolean;
  readonly secretHash: string;
  readonly readiness: WriteOnlySecretSettingsReadiness;
}

export interface ApiKeyMetadata {
  readonly tenantId: string;
  readonly keyId: string;
  readonly name: string;
  readonly prefix: string;
  readonly keyHash: string;
  readonly createdAt: string;
  readonly revoked: boolean;
  readonly readiness: WriteOnlySecretSettingsReadiness;
}

export interface TenantAdminCredentialMetadata {
  readonly tenantId: string;
  readonly adminUsername: string;
  readonly hasPassword: boolean;
  readonly passwordHash: string;
  readonly lastRotatedAt: string;
  readonly readiness: WriteOnlySecretSettingsReadiness;
}

export interface RevealOnceApiKeyResponse {
  readonly keyId: string;
  readonly name: string;
  readonly rawApiKeyRevealOnce: string;
  readonly prefix: string;
  readonly metadata: ApiKeyMetadata;
}

export interface WriteOnlySecretSettingsState {
  readonly tenantAdminCredentials: readonly TenantAdminCredentialMetadata[];
  readonly identityProviders: readonly IdentityProviderSecretMetadata[];
  readonly mailSenders: readonly MailSenderSecretMetadata[];
  readonly webhooks: readonly WebhookSecretMetadata[];
  readonly apiKeys: readonly ApiKeyMetadata[];
  readonly readiness: WriteOnlySecretSettingsReadiness;
  readonly lastAudit: WriteOnlySecretSettingsAuditEvent | null;
  readonly lastError: WriteOnlySecretSettingsError | null;
}

export const initialWriteOnlySecretSettingsState: WriteOnlySecretSettingsState = {
  tenantAdminCredentials: [],
  identityProviders: [],
  mailSenders: [],
  webhooks: [],
  apiKeys: [],
  readiness: 'NOT_READY',
  lastAudit: null,
  lastError: null,
};

export interface SecretStoreContext {
  readonly tenantId: string;
  readonly permissions: readonly WriteOnlySecretSettingsScope[];
  readonly environment: 'test' | 'development' | 'staging' | 'production';
  readonly masterKeyHex?: string;
  readonly substrateAvailable?: boolean;
}

export interface CreateOrUpdateIdentityProviderInput {
  readonly tenantId: string;
  readonly providerId: string;
  readonly alias: string;
  readonly url: string;
  readonly secret?: string;
}

export interface RotateTenantAdminCredentialInput {
  readonly tenantId: string;
  readonly adminUsername: string;
  readonly newPassword?: string;
}

export interface WriteMailSenderSecretInput {
  readonly tenantId: string;
  readonly senderId: string;
  readonly host: string;
  readonly port: number;
  readonly password?: string;
}

export interface WriteWebhookSecretInput {
  readonly tenantId: string;
  readonly webhookId: string;
  readonly endpointUrl: string;
  readonly secret?: string;
}

export interface CreateApiKeyInput {
  readonly tenantId: string;
  readonly name: string;
}

export interface RevokeApiKeyInput {
  readonly tenantId: string;
  readonly keyId: string;
}

export type MutationResult<T> =
  | { readonly success: true; readonly state: WriteOnlySecretSettingsState; readonly data: T }
  | WriteOnlySecretSettingsError;

function makeError(
  kind: WriteOnlySecretSettingsErrorKind,
  message: string,
  statusCode: number
): WriteOnlySecretSettingsError {
  return {
    success: false,
    kind,
    message,
    statusCode,
  };
}

export function mapErrorKindToStatusCode(kind: WriteOnlySecretSettingsErrorKind): number {
  switch (kind) {
    case 'NO_CREDENTIAL':
    case 'INVALID_CREDENTIAL':
      return 401;
    case 'PERMISSION_DENIED':
    case 'FORBIDDEN_REALM_OPERATION':
    case 'AUDIT_FAILURE':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION_FAILURE':
      return 422;
    case 'REALM_UNREACHABLE':
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

export function maskSecretValue(secret: string): string {
  if (!secret) {
    return '';
  }
  return '********';
}

export function hashSecretMaterial(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function encryptSecretMaterial(
  secret: string,
  masterKeyHex: string | undefined,
  environment: 'test' | 'development' | 'staging' | 'production'
): { readonly ok: true; readonly crypto: ProtectedTokenCryptoState } | { readonly ok: false; readonly error: WriteOnlySecretSettingsError } {
  if (environment === 'production' || environment === 'staging') {
    if (!masterKeyHex || masterKeyHex.length < 64) {
      return {
        ok: false,
        error: makeError(
          'VALIDATION_FAILURE',
          'Encryption key of at least 256-bit hex is required for staging and production environments',
          422
        ),
      };
    }
    try {
      const key = Buffer.from(masterKeyHex.slice(0, 64), 'hex');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let ciphertext = cipher.update(secret, 'utf8', 'hex');
      ciphertext += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      const keyFingerprint = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

      return {
        ok: true,
        crypto: {
          mode: 'ENCRYPTED',
          ciphertextHex: ciphertext,
          ivHex: iv.toString('hex'),
          tagHex: tag,
          keyFingerprint,
        },
      };
    } catch {
      return {
        ok: false,
        error: makeError('VALIDATION_FAILURE', 'Failed to encrypt secret payload', 422),
      };
    }
  }

  if (masterKeyHex && masterKeyHex.length >= 64) {
    const key = Buffer.from(masterKeyHex.slice(0, 64), 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(secret, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const keyFingerprint = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
    return {
      ok: true,
      crypto: {
        mode: 'ENCRYPTED',
        ciphertextHex: ciphertext,
        ivHex: iv.toString('hex'),
        tagHex: tag,
        keyFingerprint,
      },
    };
  }

  return {
    ok: true,
    crypto: {
      mode: 'TEST_UNENCRYPTED_MARKER',
      ciphertextHex: '',
      ivHex: '',
      tagHex: '',
      keyFingerprint: 'test-unencrypted',
    },
  };
}

export function validateSafeUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://localhost')) {
    return false;
  }
  if (trimmed.includes(' ') || trimmed.includes('<') || trimmed.includes('>') || trimmed.includes('"')) {
    return false;
  }
  return true;
}

export function hasPermission(
  requiredScope: WriteOnlySecretSettingsScope,
  context: SecretStoreContext
): boolean {
  return context.permissions.includes(requiredScope);
}

function emitAudit(
  auditFn: WriteOnlySecretSettingsAuditFn,
  event: WriteOnlySecretSettingsAuditEvent
): WriteOnlySecretSettingsError | null {
  try {
    const outcome = auditFn(event);
    if (!outcome.ok) {
      return makeError('AUDIT_FAILURE', outcome.error || 'Audit rejection', 403);
    }
    return null;
  } catch {
    return makeError('AUDIT_FAILURE', 'Audit invocation failed unexpectedly', 403);
  }
}

export function assessProviderReadiness(
  adapterType: WriteOnlySecretSettingsAdapterType,
  hasSecret: boolean,
  substrateAvailable: boolean | undefined
): WriteOnlySecretSettingsReadiness {
  if (!hasSecret) {
    return 'MISSING';
  }
  if (adapterType === 'PROVIDER_BACKED') {
    if (substrateAvailable === false) {
      return 'PROVIDER_UNAVAILABLE';
    }
    if (substrateAvailable === true) {
      return 'READY';
    }
    return 'NOT_READY';
  }
  return 'READY';
}

export function saveIdentityProviderSecret(
  state: WriteOnlySecretSettingsState,
  input: CreateOrUpdateIdentityProviderInput,
  context: SecretStoreContext,
  auditFn: WriteOnlySecretSettingsAuditFn
): MutationResult<IdentityProviderSecretMetadata> {
  if (!hasPermission('PROVIDER_CONFIG_WRITE', context)) {
    return makeError('PERMISSION_DENIED', 'Missing required permission PROVIDER_CONFIG_WRITE', 403);
  }
  if (input.tenantId !== context.tenantId) {
    return makeError('FORBIDDEN_REALM_OPERATION', 'Tenant scope mismatch', 403);
  }
  if (!validateSafeUrl(input.url)) {
    return makeError('VALIDATION_FAILURE', 'Invalid or insecure Identity Provider URL', 422);
  }
  if (!input.providerId || !input.alias) {
    return makeError('VALIDATION_FAILURE', 'Missing required identity provider fields', 422);
  }

  const existing = state.identityProviders.find(
    (p) => p.tenantId === input.tenantId && p.providerId === input.providerId
  );

  const secretProvided = input.secret !== undefined && input.secret.trim().length > 0;
  const hasSecret = secretProvided ? true : existing ? existing.hasSecret : false;
  const secretChanged = secretProvided;

  const readiness = assessProviderReadiness('PROVIDER_BACKED', hasSecret, context.substrateAvailable);

  const changedFields: string[] = ['url', 'alias'];
  if (secretChanged) {
    changedFields.push('secret');
  }

  const auditEvent: WriteOnlySecretSettingsAuditEvent = {
    kind: existing ? 'AUDIT_SECRET_UPDATE' : 'AUDIT_SECRET_CREATE',
    tenantId: input.tenantId,
    alias: input.alias,
    changedFields,
    hasSecret,
    secretChanged,
    configKeyNames: ['providerId', 'alias', 'url'],
    readinessResult: readiness,
    timestamp: new Date().toISOString(),
  };

  const auditErr = emitAudit(auditFn, auditEvent);
  if (auditErr) {
    return auditErr;
  }

  const newMeta: IdentityProviderSecretMetadata = {
    tenantId: input.tenantId,
    providerId: input.providerId,
    alias: input.alias,
    url: input.url,
    hasSecret,
    maskedValue: hasSecret ? '********' : '',
    lastRotatedAt: secretChanged ? new Date().toISOString() : existing ? existing.lastRotatedAt : '',
    readiness,
  };

  const filtered = state.identityProviders.filter(
    (p) => !(p.tenantId === input.tenantId && p.providerId === input.providerId)
  );

  const newState: WriteOnlySecretSettingsState = {
    ...state,
    identityProviders: [...filtered, newMeta],
    lastAudit: auditEvent,
    lastError: null,
  };

  return {
    success: true,
    state: newState,
    data: newMeta,
  };
}

export function rotateTenantAdminCredential(
  state: WriteOnlySecretSettingsState,
  input: RotateTenantAdminCredentialInput,
  context: SecretStoreContext,
  auditFn: WriteOnlySecretSettingsAuditFn
): MutationResult<TenantAdminCredentialMetadata> {
  if (!hasPermission('AUTH_SETTINGS_WRITE', context)) {
    return makeError('PERMISSION_DENIED', 'Missing required permission AUTH_SETTINGS_WRITE', 403);
  }
  if (input.tenantId !== context.tenantId) {
    return makeError('FORBIDDEN_REALM_OPERATION', 'Tenant scope mismatch', 403);
  }
  if (!input.adminUsername) {
    return makeError('VALIDATION_FAILURE', 'Admin username is required', 422);
  }

  const existing = state.tenantAdminCredentials.find(
    (c) => c.tenantId === input.tenantId && c.adminUsername === input.adminUsername
  );

  const hasNewPassword = input.newPassword !== undefined && input.newPassword.trim().length > 0;
  if (!existing && !hasNewPassword) {
    return makeError('NO_CREDENTIAL', 'No credential provided for initial admin setup', 401);
  }
  if (hasNewPassword && (input.newPassword?.length ?? 0) < 8) {
    return makeError('INVALID_CREDENTIAL', 'Admin credential does not satisfy complexity requirements', 401);
  }

  const hasPassword = hasNewPassword ? true : existing ? existing.hasPassword : false;
  const passwordHash = hasNewPassword ? hashSecretMaterial(input.newPassword ?? '') : existing ? existing.passwordHash : '';
  const secretChanged = hasNewPassword;

  const readiness: WriteOnlySecretSettingsReadiness = hasPassword ? 'READY' : 'MISSING';

  const auditEvent: WriteOnlySecretSettingsAuditEvent = {
    kind: 'AUDIT_SECRET_ROTATE',
    tenantId: input.tenantId,
    alias: input.adminUsername,
    changedFields: secretChanged ? ['password'] : [],
    hasSecret: hasPassword,
    secretChanged,
    configKeyNames: ['adminUsername'],
    readinessResult: readiness,
    timestamp: new Date().toISOString(),
  };

  const auditErr = emitAudit(auditFn, auditEvent);
  if (auditErr) {
    return auditErr;
  }

  const newMeta: TenantAdminCredentialMetadata = {
    tenantId: input.tenantId,
    adminUsername: input.adminUsername,
    hasPassword,
    passwordHash,
    lastRotatedAt: secretChanged ? new Date().toISOString() : existing ? existing.lastRotatedAt : '',
    readiness,
  };

  const filtered = state.tenantAdminCredentials.filter(
    (c) => !(c.tenantId === input.tenantId && c.adminUsername === input.adminUsername)
  );

  const newState: WriteOnlySecretSettingsState = {
    ...state,
    tenantAdminCredentials: [...filtered, newMeta],
    lastAudit: auditEvent,
    lastError: null,
  };

  return {
    success: true,
    state: newState,
    data: newMeta,
  };
}

export function writeMailSenderSecret(
  state: WriteOnlySecretSettingsState,
  input: WriteMailSenderSecretInput,
  context: SecretStoreContext,
  auditFn: WriteOnlySecretSettingsAuditFn
): MutationResult<MailSenderSecretMetadata> {
  if (!hasPermission('AUTH_SETTINGS_WRITE', context)) {
    return makeError('PERMISSION_DENIED', 'Missing required permission AUTH_SETTINGS_WRITE', 403);
  }
  if (input.tenantId !== context.tenantId) {
    return makeError('FORBIDDEN_REALM_OPERATION', 'Tenant scope mismatch', 403);
  }
  if (!input.senderId || !input.host || input.port <= 0 || input.port > 65535) {
    return makeError('VALIDATION_FAILURE', 'Invalid mail sender configuration parameters', 422);
  }

  const existing = state.mailSenders.find(
    (m) => m.tenantId === input.tenantId && m.senderId === input.senderId
  );

  const secretProvided = input.password !== undefined && input.password.trim().length > 0;
  const hasSecret = secretProvided ? true : existing ? existing.hasSecret : false;
  const secretChanged = secretProvided;

  let cryptoState: ProtectedTokenCryptoState;
  if (secretProvided) {
    const encRes = encryptSecretMaterial(input.password ?? '', context.masterKeyHex, context.environment);
    if (!encRes.ok) {
      return encRes.error;
    }
    cryptoState = encRes.crypto;
  } else if (existing) {
    cryptoState = existing.crypto;
  } else {
    cryptoState = {
      mode: 'TEST_UNENCRYPTED_MARKER',
      ciphertextHex: '',
      ivHex: '',
      tagHex: '',
      keyFingerprint: 'none',
    };
  }

  const readiness: WriteOnlySecretSettingsReadiness = hasSecret ? 'READY' : 'MISSING';

  const auditEvent: WriteOnlySecretSettingsAuditEvent = {
    kind: existing ? 'AUDIT_SECRET_UPDATE' : 'AUDIT_SECRET_CREATE',
    tenantId: input.tenantId,
    alias: input.senderId,
    changedFields: secretChanged ? ['host', 'port', 'password'] : ['host', 'port'],
    hasSecret,
    secretChanged,
    configKeyNames: ['senderId', 'host', 'port'],
    readinessResult: readiness,
    timestamp: new Date().toISOString(),
  };

  const auditErr = emitAudit(auditFn, auditEvent);
  if (auditErr) {
    return auditErr;
  }

  const newMeta: MailSenderSecretMetadata = {
    tenantId: input.tenantId,
    senderId: input.senderId,
    host: input.host,
    port: input.port,
    hasSecret,
    readiness,
    crypto: cryptoState,
  };

  const filtered = state.mailSenders.filter(
    (m) => !(m.tenantId === input.tenantId && m.senderId === input.senderId)
  );

  const newState: WriteOnlySecretSettingsState = {
    ...state,
    mailSenders: [...filtered, newMeta],
    lastAudit: auditEvent,
    lastError: null,
  };

  return {
    success: true,
    state: newState,
    data: newMeta,
  };
}

export function writeWebhookSecret(
  state: WriteOnlySecretSettingsState,
  input: WriteWebhookSecretInput,
  context: SecretStoreContext,
  auditFn: WriteOnlySecretSettingsAuditFn
): MutationResult<WebhookSecretMetadata> {
  if (!hasPermission('WEBHOOK_WRITE', context)) {
    return makeError('PERMISSION_DENIED', 'Missing required permission WEBHOOK_WRITE', 403);
  }
  if (input.tenantId !== context.tenantId) {
    return makeError('FORBIDDEN_REALM_OPERATION', 'Tenant scope mismatch', 403);
  }
  if (!input.webhookId || !validateSafeUrl(input.endpointUrl)) {
    return makeError('VALIDATION_FAILURE', 'Invalid webhook endpoint configuration or insecure URL', 422);
  }

  const existing = state.webhooks.find(
    (w) => w.tenantId === input.tenantId && w.webhookId === input.webhookId
  );

  const secretProvided = input.secret !== undefined && input.secret.trim().length > 0;
  const hasSecret = secretProvided ? true : existing ? existing.hasSecret : false;
  const secretChanged = secretProvided;

  const secretHash = secretProvided ? hashSecretMaterial(input.secret ?? '') : existing ? existing.secretHash : '';
  const readiness: WriteOnlySecretSettingsReadiness = hasSecret ? 'READY' : 'MISSING';

  const auditEvent: WriteOnlySecretSettingsAuditEvent = {
    kind: existing ? 'AUDIT_SECRET_UPDATE' : 'AUDIT_SECRET_CREATE',
    tenantId: input.tenantId,
    alias: input.webhookId,
    changedFields: secretChanged ? ['endpointUrl', 'secret'] : ['endpointUrl'],
    hasSecret,
    secretChanged,
    configKeyNames: ['webhookId', 'endpointUrl'],
    readinessResult: readiness,
    timestamp: new Date().toISOString(),
  };

  const auditErr = emitAudit(auditFn, auditEvent);
  if (auditErr) {
    return auditErr;
  }

  const newMeta: WebhookSecretMetadata = {
    tenantId: input.tenantId,
    webhookId: input.webhookId,
    endpointUrl: input.endpointUrl,
    hasSecret,
    secretHash,
    readiness,
  };

  const filtered = state.webhooks.filter(
    (w) => !(w.tenantId === input.tenantId && w.webhookId === input.webhookId)
  );

  const newState: WriteOnlySecretSettingsState = {
    ...state,
    webhooks: [...filtered, newMeta],
    lastAudit: auditEvent,
    lastError: null,
  };

  return {
    success: true,
    state: newState,
    data: newMeta,
  };
}

export function createRevealOnceApiKey(
  state: WriteOnlySecretSettingsState,
  input: CreateApiKeyInput,
  context: SecretStoreContext,
  auditFn: WriteOnlySecretSettingsAuditFn
): MutationResult<RevealOnceApiKeyResponse> {
  if (!hasPermission('API_KEY_CREATE', context)) {
    return makeError('PERMISSION_DENIED', 'Missing required permission API_KEY_CREATE', 403);
  }
  if (input.tenantId !== context.tenantId) {
    return makeError('FORBIDDEN_REALM_OPERATION', 'Tenant scope mismatch', 403);
  }
  if (!input.name || input.name.trim().length === 0) {
    return makeError('VALIDATION_FAILURE', 'API Key name cannot be empty', 422);
  }

  const keyId = 'key_' + crypto.randomBytes(8).toString('hex');
  const secretBytes = crypto.randomBytes(24).toString('base64url');
  const rawApiKey = `anqr_live_${secretBytes}`;
  const prefix = rawApiKey.slice(0, 14);
  const keyHash = hashSecretMaterial(rawApiKey);
  const createdAt = new Date().toISOString();

  const auditEvent: WriteOnlySecretSettingsAuditEvent = {
    kind: 'AUDIT_SECRET_CREATE',
    tenantId: input.tenantId,
    alias: input.name,
    changedFields: ['apiKey'],
    hasSecret: true,
    secretChanged: true,
    configKeyNames: ['keyId', 'name', 'prefix'],
    readinessResult: 'READY',
    timestamp: createdAt,
  };

  const auditErr = emitAudit(auditFn, auditEvent);
  if (auditErr) {
    return auditErr;
  }

  const metadata: ApiKeyMetadata = {
    tenantId: input.tenantId,
    keyId,
    name: input.name,
    prefix,
    keyHash,
    createdAt,
    revoked: false,
    readiness: 'READY',
  };

  const newState: WriteOnlySecretSettingsState = {
    ...state,
    apiKeys: [...state.apiKeys, metadata],
    lastAudit: auditEvent,
    lastError: null,
  };

  return {
    success: true,
    state: newState,
    data: {
      keyId,
      name: input.name,
      rawApiKeyRevealOnce: rawApiKey,
      prefix,
      metadata,
    },
  };
}

export function revokeApiKey(
  state: WriteOnlySecretSettingsState,
  input: RevokeApiKeyInput,
  context: SecretStoreContext,
  auditFn: WriteOnlySecretSettingsAuditFn
): MutationResult<ApiKeyMetadata> {
  if (!hasPermission('API_KEY_REVOKE', context)) {
    return makeError('PERMISSION_DENIED', 'Missing required permission API_KEY_REVOKE', 403);
  }
  if (input.tenantId !== context.tenantId) {
    return makeError('FORBIDDEN_REALM_OPERATION', 'Tenant scope mismatch', 403);
  }

  const target = state.apiKeys.find(
    (k) => k.tenantId === input.tenantId && k.keyId === input.keyId
  );
  if (!target) {
    return makeError('NOT_FOUND', 'Target API key not found in tenant scope', 404);
  }

  const auditEvent: WriteOnlySecretSettingsAuditEvent = {
    kind: 'AUDIT_SECRET_REVOKE',
    tenantId: input.tenantId,
    alias: target.name,
    changedFields: ['revoked'],
    hasSecret: false,
    secretChanged: true,
    configKeyNames: ['keyId', 'revoked'],
    readinessResult: 'NOT_READY',
    timestamp: new Date().toISOString(),
  };

  const auditErr = emitAudit(auditFn, auditEvent);
  if (auditErr) {
    return auditErr;
  }

  const updated: ApiKeyMetadata = {
    ...target,
    revoked: true,
    readiness: 'NOT_READY',
  };

  const filtered = state.apiKeys.filter(
    (k) => !(k.tenantId === input.tenantId && k.keyId === input.keyId)
  );

  const newState: WriteOnlySecretSettingsState = {
    ...state,
    apiKeys: [...filtered, updated],
    lastAudit: auditEvent,
    lastError: null,
  };

  return {
    success: true,
    state: newState,
    data: updated,
  };
}

export function readSecretSettingsMetadata(
  state: WriteOnlySecretSettingsState,
  tenantId: string,
  context: SecretStoreContext
): { readonly success: true; readonly metadata: {
  readonly identityProviders: readonly IdentityProviderSecretMetadata[];
  readonly mailSenders: readonly MailSenderSecretMetadata[];
  readonly webhooks: readonly WebhookSecretMetadata[];
  readonly apiKeys: readonly ApiKeyMetadata[];
  readonly tenantAdminCredentials: readonly TenantAdminCredentialMetadata[];
} } | WriteOnlySecretSettingsError {
  if (!hasPermission('SETTINGS_READ', context)) {
    return makeError('PERMISSION_DENIED', 'Missing required permission SETTINGS_READ', 403);
  }
  if (tenantId !== context.tenantId) {
    return makeError('FORBIDDEN_REALM_OPERATION', 'Access to foreign tenant settings is forbidden', 403);
  }

  return {
    success: true,
    metadata: {
      identityProviders: state.identityProviders.filter((p) => p.tenantId === tenantId),
      mailSenders: state.mailSenders.filter((m) => m.tenantId === tenantId),
      webhooks: state.webhooks.filter((w) => w.tenantId === tenantId),
      apiKeys: state.apiKeys.filter((k) => k.tenantId === tenantId),
      tenantAdminCredentials: state.tenantAdminCredentials.filter((c) => c.tenantId === tenantId),
    },
  };
}

export function evaluateOverallReadiness(
  state: WriteOnlySecretSettingsState,
  tenantId: string
): WriteOnlySecretSettingsReadiness {
  const providers = state.identityProviders.filter((p) => p.tenantId === tenantId);
  const senders = state.mailSenders.filter((m) => m.tenantId === tenantId);
  const webhooks = state.webhooks.filter((w) => w.tenantId === tenantId);

  if (providers.length === 0 && senders.length === 0 && webhooks.length === 0) {
    return 'MISSING';
  }

  for (const p of providers) {
    if (p.readiness === 'PROVIDER_UNAVAILABLE') {
      return 'PROVIDER_UNAVAILABLE';
    }
    if (p.readiness === 'NOT_READY' || p.readiness === 'MISSING') {
      return 'NOT_READY';
    }
  }

  for (const s of senders) {
    if (s.readiness !== 'READY') {
      return s.readiness;
    }
  }

  for (const w of webhooks) {
    if (w.readiness !== 'READY') {
      return w.readiness;
    }
  }

  return 'READY';
}

export function verifyProofTokenCryptography(
  plainSecret: string,
  masterKeyHex: string
): { readonly encryptedCorrectly: boolean; readonly noLeakage: boolean } {
  const encRes = encryptSecretMaterial(plainSecret, masterKeyHex, 'production');
  if (!encRes.ok) {
    return { encryptedCorrectly: false, noLeakage: false };
  }
  const serialized = JSON.stringify(encRes.crypto);
  const noLeakage = !serialized.includes(plainSecret);
  const encryptedCorrectly = encRes.crypto.mode === 'ENCRYPTED' && encRes.crypto.ciphertextHex.length > 0;
  return { encryptedCorrectly, noLeakage };
}

export function verifyProofAuditRedaction(
  event: WriteOnlySecretSettingsAuditEvent,
  rawSecretToCheck: string
): boolean {
  const serialized = JSON.stringify(event);
  if (!rawSecretToCheck) {
    return true;
  }
  return !serialized.includes(rawSecretToCheck);
}