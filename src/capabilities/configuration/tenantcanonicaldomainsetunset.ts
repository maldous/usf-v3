export const TenantCanonicalDomainSetUnsetAuditEventKind = [
  'CANONICAL_SET',
  'CANONICAL_UNSET',
] as const;
export type TenantCanonicalDomainSetUnsetAuditEventKind = typeof TenantCanonicalDomainSetUnsetAuditEventKind[number];

export const TenantCanonicalDomainSetUnsetErrorKind = [
  'OK',
  'NOT_FOUND',
  'NOT_VERIFIED',
  'AUTH_CLIENT_INACTIVE',
  'ROUTING_NOT_PROVEN',
] as const;
export type TenantCanonicalDomainSetUnsetErrorKind = typeof TenantCanonicalDomainSetUnsetErrorKind[number];

export const TenantCanonicalDomainSetUnsetReadiness = [
  'READY_LOCAL',
  'NOT_READY',
] as const;
export type TenantCanonicalDomainSetUnsetReadiness = typeof TenantCanonicalDomainSetUnsetReadiness[number];

export const TenantCanonicalDomainSetUnsetRedirectPolicy = [
  'REDIRECT_SLUG_TO_CANONICAL',
  'NO_REDIRECT',
  'REDIRECT_OFF',
] as const;
export type TenantCanonicalDomainSetUnsetRedirectPolicy = typeof TenantCanonicalDomainSetUnsetRedirectPolicy[number];

export interface TenantCanonicalDomainSetUnsetAuditEvent {
  readonly kind: TenantCanonicalDomainSetUnsetAuditEventKind;
  readonly tenantId: string;
  readonly domain: string;
  readonly redirectPolicy: TenantCanonicalDomainSetUnsetRedirectPolicy;
  readonly timestamp: string;
}

export interface TenantCanonicalDomainSetUnsetError {
  readonly kind: TenantCanonicalDomainSetUnsetErrorKind;
  readonly message: string;
}

export interface TenantCanonicalDomainRecord {
  readonly tenantId: string;
  readonly domain: string;
  readonly verified: boolean;
  readonly authClientActive: boolean;
  readonly localRoutingProven: boolean;
  readonly canonical: boolean;
  readonly canonicalTimestamp: string | null;
  readonly redirectPolicy: TenantCanonicalDomainSetUnsetRedirectPolicy;
}

export interface TenantCanonicalDomainSetUnsetState {
  readonly domains: readonly TenantCanonicalDomainRecord[];
  readonly readiness: TenantCanonicalDomainSetUnsetReadiness;
}

export const tenantCanonicalDomainSetUnsetInitialState: TenantCanonicalDomainSetUnsetState = {
  domains: [],
  readiness: 'NOT_READY',
};

export interface TenantCanonicalDomainSetUnsetPort {
  readonly getDomain: (
    tenantId: string,
    domain: string,
  ) => TenantCanonicalDomainRecord | null;
  readonly setDomain: (
    tenantId: string,
    domain: string,
    canonical: boolean,
    redirectPolicy: TenantCanonicalDomainSetUnsetRedirectPolicy,
  ) => TenantCanonicalDomainRecord | null;
  readonly unsetDomain: (
    tenantId: string,
    domain: string,
  ) => TenantCanonicalDomainRecord | null;
  readonly deactivateDomain: (
    tenantId: string,
    domain: string,
  ) => TenantCanonicalDomainRecord | null;
}

export interface TenantCanonicalDomainSetUnsetAuthClient {
  readonly isActive: (tenantId: string) => boolean;
}

export function auditCanonicalEvent(
  tenantId: string,
  domain: string,
  redirectPolicy: TenantCanonicalDomainSetUnsetRedirectPolicy,
  kind: TenantCanonicalDomainSetUnsetAuditEventKind,
  auditFn: (
    event: TenantCanonicalDomainSetUnsetAuditEvent,
  ) => TenantCanonicalDomainSetUnsetErrorKind | null,
): TenantCanonicalDomainSetUnsetErrorKind | null {
  const event: TenantCanonicalDomainSetUnsetAuditEvent = {
    kind,
    tenantId,
    domain,
    redirectPolicy,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function setCanonicalDomain(
  state: TenantCanonicalDomainSetUnsetState,
  tenantId: string,
  domain: string,
  requiredPermission: string,
  port: TenantCanonicalDomainSetUnsetPort,
  authClient: TenantCanonicalDomainSetUnsetAuthClient,
  auditFn: (
    event: TenantCanonicalDomainSetUnsetAuditEvent,
  ) => TenantCanonicalDomainSetUnsetErrorKind | null,
): TenantCanonicalDomainSetUnsetState | TenantCanonicalDomainSetUnsetError {
  if (requiredPermission !== 'tenant-domain-write') {
    return {
      kind: 'NOT_VERIFIED',
      message: 'Missing required permission tenant-domain-write',
    };
  }

  const existing = port.getDomain(tenantId, domain);
  if (existing === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (!existing.verified) {
    return { kind: 'NOT_VERIFIED', message: 'Domain ownership is not verified' };
  }

  if (!authClient.isActive(tenantId)) {
    return { kind: 'AUTH_CLIENT_INACTIVE', message: 'Auth client is inactive' };
  }

  if (!existing.localRoutingProven) {
    return { kind: 'ROUTING_NOT_PROVEN', message: 'Local routing is not proven' };
  }

  const auditError = auditCanonicalEvent(
    tenantId,
    domain,
    'REDIRECT_SLUG_TO_CANONICAL',
    'CANONICAL_SET',
    auditFn,
  );
  if (auditError !== null) {
    return { kind: auditError, message: 'Audit failure before mutation' };
  }

  let nextDomains = state.domains.map((d) => {
    if (d.tenantId === tenantId && d.canonical && d.domain !== domain) {
      return {
        ...d,
        canonical: false,
        canonicalTimestamp: null,
        redirectPolicy: 'NO_REDIRECT' as const,
      };
    }
    return d;
  });

  const targetIndex = nextDomains.findIndex(
    (d) => d.tenantId === tenantId && d.domain === domain,
  );
  if (targetIndex >= 0) {
    const updated: TenantCanonicalDomainRecord = {
      ...nextDomains[targetIndex],
      canonical: true,
      canonicalTimestamp: new Date().toISOString(),
      redirectPolicy: 'REDIRECT_SLUG_TO_CANONICAL',
    };
    nextDomains = [
      ...nextDomains.slice(0, targetIndex),
      updated,
      ...nextDomains.slice(targetIndex + 1),
    ];
  } else {
    const newRecord: TenantCanonicalDomainRecord = {
      tenantId,
      domain,
      verified: existing.verified,
      authClientActive: existing.authClientActive,
      localRoutingProven: existing.localRoutingProven,
      canonical: true,
      canonicalTimestamp: new Date().toISOString(),
      redirectPolicy: 'REDIRECT_SLUG_TO_CANONICAL',
    };
    nextDomains = [...nextDomains, newRecord];
  }

  return {
    ...state,
    domains: nextDomains,
    readiness: 'READY_LOCAL',
  };
}

export function unsetCanonicalDomain(
  state: TenantCanonicalDomainSetUnsetState,
  tenantId: string,
  domain: string,
  requiredPermission: string,
  port: TenantCanonicalDomainSetUnsetPort,
  auditFn: (
    event: TenantCanonicalDomainSetUnsetAuditEvent,
  ) => TenantCanonicalDomainSetUnsetErrorKind | null,
): TenantCanonicalDomainSetUnsetState | TenantCanonicalDomainSetUnsetError {
  if (requiredPermission !== 'tenant-domain-write') {
    return {
      kind: 'NOT_VERIFIED',
      message: 'Missing required permission tenant-domain-write',
    };
  }

  const existing = port.getDomain(tenantId, domain);
  if (existing === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  const auditError = auditCanonicalEvent(
    tenantId,
    domain,
    'REDIRECT_OFF',
    'CANONICAL_UNSET',
    auditFn,
  );
  if (auditError !== null) {
    return { kind: auditError, message: 'Audit failure before mutation' };
  }

  const nextDomains = state.domains.map((d) => {
    if (d.tenantId === tenantId && d.domain === domain) {
      return {
        ...d,
        canonical: false,
        canonicalTimestamp: null,
        redirectPolicy: 'REDIRECT_OFF' as const,
      };
    }
    return d;
  });

  return {
    ...state,
    domains: nextDomains,
    readiness: 'NOT_READY',
  };
}

export function deactivateDomainClearsCanonical(
  state: TenantCanonicalDomainSetUnsetState,
  tenantId: string,
  domain: string,
  requiredPermission: string,
  port: TenantCanonicalDomainSetUnsetPort,
  auditFn: (
    event: TenantCanonicalDomainSetUnsetAuditEvent,
  ) => TenantCanonicalDomainSetUnsetErrorKind | null,
): TenantCanonicalDomainSetUnsetState | TenantCanonicalDomainSetUnsetError {
  if (requiredPermission !== 'tenant-domain-write') {
    return {
      kind: 'NOT_VERIFIED',
      message: 'Missing required permission tenant-domain-write',
    };
  }

  const existing = port.getDomain(tenantId, domain);
  if (existing === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (!existing.canonical) {
    return { kind: 'NOT_FOUND', message: 'Domain is not canonical' };
  }

  const auditError = auditCanonicalEvent(
    tenantId,
    domain,
    'REDIRECT_OFF',
    'CANONICAL_UNSET',
    auditFn,
  );
  if (auditError !== null) {
    return { kind: auditError, message: 'Audit failure before mutation' };
  }

  const nextDomains = state.domains.map((d) => {
    if (d.tenantId === tenantId && d.domain === domain) {
      return {
        ...d,
        canonical: false,
        canonicalTimestamp: null,
        redirectPolicy: 'REDIRECT_OFF' as const,
      };
    }
    return d;
  });

  return {
    ...state,
    domains: nextDomains,
    readiness: 'NOT_READY',
  };
}

export function checkCanonicalInvariant(
  state: TenantCanonicalDomainSetUnsetState,
  tenantId: string,
): boolean {
  const canonicalDomains = state.domains.filter(
    (d) => d.tenantId === tenantId && d.canonical,
  );
  return canonicalDomains.length <= 1;
}

export function getCanonicalDomainForTenant(
  state: TenantCanonicalDomainSetUnsetState,
  tenantId: string,
): TenantCanonicalDomainRecord | null {
  const found = state.domains.find(
    (d) => d.tenantId === tenantId && d.canonical,
  );
  return found ?? null;
}

export function proveCanonicalRuntime(
  state: TenantCanonicalDomainSetUnsetState,
  tenantId: string,
  domain: string,
  port: TenantCanonicalDomainSetUnsetPort,
  authClient: TenantCanonicalDomainSetUnsetAuthClient,
  auditFn: (
    event: TenantCanonicalDomainSetUnsetAuditEvent,
  ) => TenantCanonicalDomainSetUnsetErrorKind | null,
): {
  readonly setResult: TenantCanonicalDomainSetUnsetState | TenantCanonicalDomainSetUnsetError;
  readonly invariantHolds: boolean;
  readonly unsetResult: TenantCanonicalDomainSetUnsetState | TenantCanonicalDomainSetUnsetError;
  readonly deactivationResult: TenantCanonicalDomainSetUnsetState | TenantCanonicalDomainSetUnsetError;
} {
  const setResult = setCanonicalDomain(
    state,
    tenantId,
    domain,
    'tenant-domain-write',
    port,
    authClient,
    auditFn,
  );

  const invariantHolds =
    typeof setResult !== 'object' || 'kind' in setResult
      ? false
      : checkCanonicalInvariant(setResult, tenantId);

  const unsetState =
    typeof setResult !== 'object' || 'kind' in setResult ? state : setResult;

  const unsetResult = unsetCanonicalDomain(
    unsetState,
    tenantId,
    domain,
    'tenant-domain-write',
    port,
    auditFn,
  );

  const deactivationState =
    typeof unsetResult !== 'object' || 'kind' in unsetResult
      ? unsetState
      : unsetResult;

  const deactivationResult = deactivateDomainClearsCanonical(
    deactivationState,
    tenantId,
    domain,
    'tenant-domain-write',
    port,
    auditFn,
  );

  return {
    setResult,
    invariantHolds,
    unsetResult,
    deactivationResult,
  };
}