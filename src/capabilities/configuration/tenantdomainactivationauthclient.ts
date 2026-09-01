export const TenantDomainActivationAuthClientOutcome = [
  'OK',
  'NOT_FOUND',
  'NOT_VERIFIED',
  'ALREADY_ACTIVE',
  'NOT_ACTIVE',
] as const;
export type TenantDomainActivationAuthClientOutcome = typeof TenantDomainActivationAuthClientOutcome[number];

export const TenantDomainActivationAuthClientAuditEventKind = [
  'AUTH_CLIENT_ACTIVATED',
  'AUTH_CLIENT_DEACTIVATED',
] as const;
export type TenantDomainActivationAuthClientAuditEventKind = typeof TenantDomainActivationAuthClientAuditEventKind[number];

export const TenantDomainActivationAuthClientReadiness = ['READY', 'DEGRADED'] as const;
export type TenantDomainActivationAuthClientReadiness = typeof TenantDomainActivationAuthClientReadiness[number];

export const TenantDomainActivationAuthClientPermission = ['DOMAIN_WRITE'] as const;
export type TenantDomainActivationAuthClientPermission = typeof TenantDomainActivationAuthClientPermission[number];

export interface TenantDomainActivationAuthClientAuditEvent {
  readonly kind: TenantDomainActivationAuthClientAuditEventKind;
  readonly domain: string;
  readonly tenantId: string;
  readonly timestamp: string;
}

export interface TenantDomainActivationAuthClientError {
  readonly kind: 'AUDIT_FAILURE' | 'PORT_ERROR';
  readonly message: string;
}

export interface TenantDomainActivationAuthClientState {
  readonly authClientStatus: 'INACTIVE' | 'ACTIVE';
  readonly activationTimestamp: string | null;
  readonly canonical: boolean;
  readonly routingStatus: boolean;
  readonly disabled: boolean;
}

export const initialState: TenantDomainActivationAuthClientState = {
  authClientStatus: 'INACTIVE',
  activationTimestamp: null,
  canonical: false,
  routingStatus: false,
  disabled: false,
};

export interface ActivateRequest {
  readonly domain: string;
  readonly tenantId: string;
  readonly verified: boolean;
  readonly permission: TenantDomainActivationAuthClientPermission;
}

export interface DeactivateRequest {
  readonly domain: string;
  readonly tenantId: string;
  readonly permission: TenantDomainActivationAuthClientPermission;
}

export interface AuthClientPort {
  readonly addRedirectOrigin: (domain: string) => Promise<void>;
  readonly removeRedirectOrigin: (domain: string) => Promise<void>;
}

export function validateActivateRequest(
  state: TenantDomainActivationAuthClientState,
  request: ActivateRequest,
): TenantDomainActivationAuthClientOutcome {
  if (request.permission !== 'DOMAIN_WRITE') {
    return 'NOT_FOUND';
  }
  if (state.authClientStatus === 'ACTIVE') {
    return 'ALREADY_ACTIVE';
  }
  if (!request.verified) {
    return 'NOT_VERIFIED';
  }
  return 'OK';
}

export function validateDeactivateRequest(
  state: TenantDomainActivationAuthClientState,
  request: DeactivateRequest,
): TenantDomainActivationAuthClientOutcome {
  if (request.permission !== 'DOMAIN_WRITE') {
    return 'NOT_FOUND';
  }
  if (state.authClientStatus === 'INACTIVE') {
    return 'NOT_ACTIVE';
  }
  return 'OK';
}

export function emitActivateAudit(
  request: ActivateRequest,
  auditFn: (event: TenantDomainActivationAuthClientAuditEvent) => TenantDomainActivationAuthClientError | null,
): TenantDomainActivationAuthClientError | null {
  const event: TenantDomainActivationAuthClientAuditEvent = {
    kind: 'AUTH_CLIENT_ACTIVATED',
    domain: request.domain,
    tenantId: request.tenantId,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function emitDeactivateAudit(
  request: DeactivateRequest,
  auditFn: (event: TenantDomainActivationAuthClientAuditEvent) => TenantDomainActivationAuthClientError | null,
): TenantDomainActivationAuthClientError | null {
  const event: TenantDomainActivationAuthClientAuditEvent = {
    kind: 'AUTH_CLIENT_DEACTIVATED',
    domain: request.domain,
    tenantId: request.tenantId,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function activate(
  state: TenantDomainActivationAuthClientState,
  request: ActivateRequest,
  auditFn: (event: TenantDomainActivationAuthClientAuditEvent) => TenantDomainActivationAuthClientError | null,
  port: AuthClientPort,
):
  | { readonly outcome: 'OK'; readonly state: TenantDomainActivationAuthClientState }
  | { readonly outcome: Exclude<TenantDomainActivationAuthClientOutcome, 'OK'> }
  | TenantDomainActivationAuthClientError {
  const validationOutcome = validateActivateRequest(state, request);
  if (validationOutcome !== 'OK') {
    return { outcome: validationOutcome };
  }

  const auditError = emitActivateAudit(request, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  try {
    port.addRedirectOrigin(request.domain).catch(() => {
      throw new Error('Port call failed');
    });
  } catch {
    return { outcome: 'NOT_VERIFIED' };
  }

  const newState: TenantDomainActivationAuthClientState = {
    ...state,
    authClientStatus: 'ACTIVE',
    activationTimestamp: new Date().toISOString(),
    canonical: true,
    routingStatus: false,
    disabled: false,
  };

  return { outcome: 'OK', state: newState };
}

export function deactivate(
  state: TenantDomainActivationAuthClientState,
  request: DeactivateRequest,
  auditFn: (event: TenantDomainActivationAuthClientAuditEvent) => TenantDomainActivationAuthClientError | null,
  port: AuthClientPort,
):
  | { readonly outcome: 'OK'; readonly state: TenantDomainActivationAuthClientState }
  | { readonly outcome: Exclude<TenantDomainActivationAuthClientOutcome, 'OK'> }
  | TenantDomainActivationAuthClientError {
  const validationOutcome = validateDeactivateRequest(state, request);
  if (validationOutcome !== 'OK') {
    return { outcome: validationOutcome };
  }

  const auditError = emitDeactivateAudit(request, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  try {
    port.removeRedirectOrigin(request.domain).catch(() => {
      throw new Error('Port call failed');
    });
  } catch {
    return { outcome: 'NOT_ACTIVE' };
  }

  const newState: TenantDomainActivationAuthClientState = {
    ...state,
    authClientStatus: 'INACTIVE',
    activationTimestamp: null,
    canonical: false,
    routingStatus: false,
    disabled: false,
  };

  return { outcome: 'OK', state: newState };
}

export function getReadiness(
  state: TenantDomainActivationAuthClientState,
): TenantDomainActivationAuthClientReadiness {
  return state.authClientStatus === 'ACTIVE' ? 'READY' : 'DEGRADED';
}