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
  readonly encryptedValue: string | null; // null when provider is openbao
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

/* Helper encryption – pure deterministic base64 */
function encrypt(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}
function decrypt(cipher: string): string {
  return Buffer.from(cipher, 'base64').toString('utf8');
}

/* Audit helper – caller supplies audit implementation */
export function auditSecretChange(
  event: SecretAuditEvent,
  auditFn: (e: SecretAuditEvent) => SecretManagementError | null,
): SecretManagementError | null {
  return auditFn(event);
}

/* Permission guard */
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

/* Find secret by ref */
function findSecret(
  state: SecretManagementState,
  organisationId: string,
  ref: string,
): SecretRecord | undefined {
  return state.secrets.find(
    (s) => s.ref === ref && s.organisationId === organisationId,
  );
}

/* -------------------- Mutating operations -------------------- */

export function putSecret(
  state: SecretManagementState,
  organisationId: string,
  name: string,
  provider: Provider,
  value: string,
  hasPermission