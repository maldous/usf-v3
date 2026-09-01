export const SecretAuditEventKind = ['AUDIT_BEFORE_CHANGE'] as const;
export type SecretAuditEventKind = typeof SecretAuditEventKind[number];

export const SecretErrorKind = [
  'AUDIT_FAILURE',
  'UNAUTHORIZED',
  'SECRET_NOT_FOUND',
  'PROVIDER_DEGRADED',
  'INVALID_OPERATION',
] as const;
export type SecretErrorKind = typeof SecretErrorKind[number];

export const Provider = ['postgres', 'openbao'] as const;
export type Provider = typeof Provider[number];

export const BuiltInReadiness = ['READY', 'NOT_READY'] as const;
export type BuiltInReadiness = typeof BuiltInReadiness[number];

export const OpenBaoReadiness = ['READY', 'DEGRADED', 'UNREACHABLE'] as const;
export type OpenBaoReadiness = typeof OpenBaoReadiness[number];

export const SecretManagementReadiness = [
  'BUILTIN_READY_OPENBAO_READY',
  'BUILTIN_READY_OPENBAO_DEGRADED',
  'BUILTIN_READY_OPENBAO_UNREACHABLE',
  'BUILTIN_NOT_READY_OPENBAO_READY',
  'BUILTIN_NOT_READY_OPENBAO_DEGRADED',
  'BUILTIN_NOT_READY_OPENBAO_UNREACHABLE',
] as const;
export type SecretManagementReadiness = typeof SecretManagementReadiness[number];

export interface SecretAuditEvent {
  readonly kind: SecretAuditEventKind;
  readonly name: string;
  readonly ref: string;
  readonly provider: Provider;
  readonly timestamp: string;
}

export interface SecretManagementError {
  readonly kind: SecretErrorKind;
  readonly message: string;
}

export interface SecretRecord {
  readonly ref: string;
  readonly organisationId: string;
  readonly name: string;
  readonly provider: Provider;
  readonly version: number;
  readonly revoked: boolean;
  readonly backendPath: string;
  readonly encryptedValue: string | null;
  readonly created: string;
  readonly updated: string;
  readonly deleted: string | null;
}

export interface SecretManagementState {
  readonly secrets: readonly SecretRecord[];
  readonly nextRefId: number;
  readonly builtInReady: boolean;
  readonly openBaoReadiness: OpenBaoReadiness;
}

export const initialSecretState: SecretManagementState = {
  secrets: [],
  nextRefId: 1,
  builtInReady: true,
  openBaoReadiness: 'READY',
};

function encrypt(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function decrypt(cipher: string): string {
  return Buffer.from(cipher, 'base64').toString('utf8');
}

export function auditSecretChange(
  event: SecretAuditEvent,
  auditFn: (e: SecretAuditEvent) => SecretManagementError | null,
): SecretManagementError | null {
  return auditFn(event);
}

function requirePermission(
  hasPermission: boolean,
): SecretManagementError | null {
  if (!hasPermission) {
    return {
      kind: 'UNAUTHORIZED',
      message: 'Missing required permission',
    };
  }
  return null;
}

function findSecret(
  state: SecretManagementState,
  organisationId: string,
  ref: string,
): SecretRecord | undefined {
  return state.secrets.find(
    (s) => s.ref === ref && s.organisationId === organisationId && s.deleted === null,
  );
}

function generateRef(nextRefId: number): string {
  return `ref-${nextRefId}`;
}

function getReadiness(state: SecretManagementState): SecretManagementReadiness {
  if (state.builtInReady && state.openBaoReadiness === 'READY') {
    return 'BUILTIN_READY_OPENBAO_READY';
  }
  if (state.builtInReady && state.openBaoReadiness === 'DEGRADED') {
    return 'BUILTIN_READY_OPENBAO_DEGRADED';
  }
  if (state.builtInReady && state.openBaoReadiness === 'UNREACHABLE') {
    return 'BUILTIN_READY_OPENBAO_UNREACHABLE';
  }
  if (!state.builtInReady && state.openBaoReadiness === 'READY') {
    return 'BUILTIN_NOT_READY_OPENBAO_READY';
  }
  if (!state.builtInReady && state.openBaoReadiness === 'DEGRADED') {
    return 'BUILTIN_NOT_READY_OPENBAO_DEGRADED';
  }
  return 'BUILTIN_NOT_READY_OPENBAO_UNREACHABLE';
}

export function getReadinessPayload(
  state: SecretManagementState,
): { readonly readiness: SecretManagementReadiness } {
  return { readiness: getReadiness(state) };
}

export function putSecret(
  state: SecretManagementState,
  organisationId: string,
  name: string,
  provider: Provider,
  value: string,
  hasPermission: boolean,
  auditFn: (e: SecretAuditEvent) => SecretManagementError | null,
): SecretManagementState | SecretManagementError {
  const permissionError = requirePermission(hasPermission);
  if (permissionError !== null) {
    return permissionError;
  }

  if (provider === 'openbao' && state.openBaoReadiness !== 'READY') {
    return {
      kind: 'PROVIDER_DEGRADED',
      message: 'OpenBao provider is not ready',
    };
  }

  const ref = generateRef(state.nextRefId);
  const now = new Date().toISOString();
  const encryptedValue = provider === 'postgres' ? encrypt(value) : null;
  const backendPath = provider === 'openbao' ? `openbao/${organisationId}/${name}` : `postgres/${organisationId}/${name}`;

  const auditEvent: SecretAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    name,
    ref,
    provider,
    timestamp: now,
  };

  const auditError = auditSecretChange(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newSecret: SecretRecord = {
    ref,
    organisationId,
    name,
    provider,
    version: 1,
    revoked: false,
    backendPath,
    encryptedValue,
    created: now,
    updated: now,
    deleted: null,
  };

  return {
    ...state,
    secrets: [...state.secrets, newSecret],
    nextRefId: state.nextRefId + 1,
  };
}

export function listSecrets(
  state: SecretManagementState,
  organisationId: string,
  hasPermission: boolean,
): readonly SecretRecord[] | SecretManagementError {
  const permissionError = requirePermission(hasPermission);
  if (permissionError !== null) {
    return permissionError;
  }

  return state.secrets.filter(
    (s) => s.organisationId === organisationId && s.deleted === null,
  );
}

export function getMetadata(
  state: SecretManagementState,
  organisationId: string,
  ref: string,
  hasPermission: boolean,
): SecretRecord | SecretManagementError {
  const permissionError = requirePermission(hasPermission);
  if (permissionError !== null) {
    return permissionError;
  }

  const secret = findSecret(state, organisationId, ref);
  if (secret === undefined) {
    return {
      kind: 'SECRET_NOT_FOUND',
      message: 'Secret not found or deleted',
    };
  }

  return secret;
}

export function resolveSecret(
  state: SecretManagementState,
  organisationId: string,
  ref: string,
): string | SecretManagementError | null {
  const secret = findSecret(state, organisationId, ref);
  if (secret === undefined) {
    return null;
  }

  if (secret.revoked) {
    return null;
  }

  if (secret.provider === 'postgres') {
    if (secret.encryptedValue === null) {
      return {
        kind: 'INVALID_OPERATION',
        message: 'Postgres secret has no encrypted value',
      };
    }
    return decrypt(secret.encryptedValue);
  }

  return null;
}

export function rotateSecret(
  state: SecretManagementState,
  organisationId: string,
  ref: string,
  newValue: string,
  hasPermission: boolean,
  auditFn: (e: SecretAuditEvent) => SecretManagementError | null,
): SecretManagementState | SecretManagementError {
  const permissionError = requirePermission(hasPermission);
  if (permissionError !== null) {
    return permissionError;
  }

  const secret = findSecret(state, organisationId, ref);
  if (secret === undefined) {
    return {
      kind: 'SECRET_NOT_FOUND',
      message: 'Secret not found or deleted',
    };
  }

  if (secret.provider === 'openbao' && state.openBaoReadiness !== 'READY') {
    return {
      kind: 'PROVIDER_DEGRADED',
      message: 'OpenBao provider is not ready',
    };
  }

  const now = new Date().toISOString();
  const auditEvent: SecretAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    name: secret.name,
    ref,
    provider: secret.provider,
    timestamp: now,
  };

  const auditError = auditSecretChange(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedSecrets = state.secrets.map((s) => {
    if (s.ref === ref && s.organisationId === organisationId) {
      return {
        ...s,
        version: s.version + 1,
        updated: now,
        encryptedValue:
          s.provider === 'postgres' ? encrypt(newValue) : s.encryptedValue,
      };
    }
    return s;
  });

  return {
    ...state,
    secrets: updatedSecrets,
  };
}

export function revokeSecret(
  state: SecretManagementState,
  organisationId: string,
  ref: string,
  hasPermission: boolean,
  auditFn: (e: SecretAuditEvent) => SecretManagementError | null,
): SecretManagementState | SecretManagementError {
  const permissionError = requirePermission(hasPermission);
  if (permissionError !== null) {
    return permissionError;
  }

  const secret = findSecret(state, organisationId, ref);
  if (secret === undefined) {
    return {
      kind: 'SECRET_NOT_FOUND',
      message: 'Secret not found or deleted',
    };
  }

  const now = new Date().toISOString();
  const auditEvent: SecretAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    name: secret.name,
    ref,
    provider: secret.provider,
    timestamp: now,
  };

  const auditError = auditSecretChange(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedSecrets = state.secrets.map((s) => {
    if (s.ref === ref && s.organisationId === organisationId) {
      return {
        ...s,
        revoked: true,
        updated: now,
      };
    }
    return s;
  });

  return {
    ...state,
    secrets: updatedSecrets,
  };
}

export function deleteSecret(
  state: SecretManagementState,
  organisationId: string,
  ref: string,
  hasPermission: boolean,
  auditFn: (e: SecretAuditEvent) => SecretManagementError | null,
): SecretManagementState | SecretManagementError {
  const permissionError = requirePermission(hasPermission);
  if (permissionError !== null) {
    return permissionError;
  }

  const secret = findSecret(state, organisationId, ref);
  if (secret === undefined) {
    return {
      kind: 'SECRET_NOT_FOUND',
      message: 'Secret not found or deleted',
    };
  }

  const now = new Date().toISOString();
  const auditEvent: SecretAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    name: secret.name,
    ref,
    provider: secret.provider,
    timestamp: now,
  };

  const auditError = auditSecretChange(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedSecrets = state.secrets.map((s) => {
    if (s.ref === ref && s.organisationId === organisationId) {
      return {
        ...s,
        deleted: now,
        updated: now,
      };
    }
    return s;
  });

  return {
    ...state,
    secrets: updatedSecrets,
  };
}