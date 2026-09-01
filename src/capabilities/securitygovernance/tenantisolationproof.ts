export const HostClassification = [
  'APEX',
  'SLUG',
  'RESERVED',
  'CUSTOM_DOMAIN',
  'UNKNOWN',
  'MALFORMED',
] as const;
export type HostClassification = typeof HostClassification[number];

export const HostSource = [
  'SLUG_RESOLVED',
  'CUSTOM_DOMAIN_VERIFIED',
  'UNTRUSTED',
] as const;
export type HostSource = typeof HostSource[number];

export const TenantIsolationProofReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type TenantIsolationProofReadiness = typeof TenantIsolationProofReadiness[number];

export const TenantIsolationProofAuditEventKind = [
  'TENANT_MUTATION_AUDIT',
  'ISOLATION_CHECK_GUARD',
] as const;
export type TenantIsolationProofAuditEventKind = typeof TenantIsolationProofAuditEventKind[number];

export const TenantIsolationProofErrorKind = [
  'UNTRUSTED_HOST',
  'UNVERIFIED_CUSTOM_DOMAIN',
  'ABSENT_CUSTOM_DOMAIN',
  'FOREIGN_TENANT_ACCESS_DENIED',
  'CROSS_TENANT_WRITE_PREVENTED',
  'CROSS_TENANT_READ_PREVENTED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_FORWARDED_HOST',
  'AUDIT_FAILURE',
  'PERMISSION_DENIED',
  'RESERVED_HOST_DENIED',
  'APEX_HOST_DENIED',
] as const;
export type TenantIsolationProofErrorKind = typeof TenantIsolationProofErrorKind[number];

export const CustomDomainStatus = [
  'ACTIVE',
  'PENDING',
  'INACTIVE',
  'DISABLED',
  'UNVERIFIED',
] as const;
export type CustomDomainStatus = typeof CustomDomainStatus[number];

export const SubstrateProbeKind = [
  'RESOLVER',
  'ROW_LEVEL_SECURITY',
  'STORAGE_PREFIX',
  'METERING',
  'SEARCH',
  'OBSERVABILITY',
  'WEBHOOKS',
  'EVENTS',
  'SECRET_STORE',
] as const;
export type SubstrateProbeKind = typeof SubstrateProbeKind[number];

export interface TenantContext {
  readonly organisationId: string;
  readonly slug: string;
  readonly hostSource: HostSource;
  readonly rlsTenantSetting: string;
  readonly objectStoragePrefix: string;
}

export interface TenantIsolationProofError {
  readonly kind: TenantIsolationProofErrorKind;
  readonly message: string;
  readonly statusCode: number;
}

export interface TenantIsolationProofAuditEvent {
  readonly kind: TenantIsolationProofAuditEventKind;
  readonly organisationId: string;
  readonly tenantSlug: string;
  readonly action: string;
  readonly targetResource: string;
  readonly timestamp: string;
}

export interface CustomDomainRecord {
  readonly domain: string;
  readonly organisationId: string;
  readonly slug: string;
  readonly status: CustomDomainStatus;
}

export interface TenantRecord {
  readonly organisationId: string;
  readonly slug: string;
  readonly active: boolean;
}

export interface SubstrateProbeStatus {
  readonly probe: SubstrateProbeKind;
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly details?: string;
}

export interface TenantIsolationProofState {
  readonly tenants: readonly TenantRecord[];
  readonly customDomains: readonly CustomDomainRecord[];
  readonly reservedHosts: readonly string[];
  readonly apexHosts: readonly string[];
  readonly activeContext: TenantContext | null;
  readonly lastClassification: HostClassification | null;
  readonly lastError: TenantIsolationProofError | null;
  readonly readiness: TenantIsolationProofReadiness;
  readonly substrateProbes: readonly SubstrateProbeStatus[];
}

export interface ForwardedHeaders {
  readonly 'x-forwarded-host'?: string | readonly string[];
  readonly 'x-original-host'?: string | readonly string[];
  readonly host?: string | readonly string[];
}

export interface RequestContext {
  readonly headers: ForwardedHeaders;
  readonly path?: string;
}

export interface TenantActor {
  readonly actorId: string;
  readonly organisationId: string;
  readonly roles: readonly string[];
  readonly isSystemOperator?: boolean;
}

export interface TenantRowRecord {
  readonly id: string;
  readonly organisationId: string;
  readonly payload: unknown;
}

export interface IsolationProofResult {
  readonly proofType: string;
  readonly organisationId: string;
  readonly verified: boolean;
  readonly details: string;
  readonly crossTenantViolations: number;
}

export const initialState: TenantIsolationProofState = {
  tenants: [],
  customDomains: [],
  reservedHosts: ['admin', 'internal', 'system', 'api-internal', 'localhost', '127.0.0.1'],
  apexHosts: ['example.com', 'anqr.io', 'anqr.local'],
  activeContext: null,
  lastClassification: null,
  lastError: null,
  readiness: 'READY',
  substrateProbes: [],
};

export function mapErrorToStatusCode(error: TenantIsolationProofError): number {
  switch (error.kind) {
    case 'PERMISSION_DENIED':
    case 'FOREIGN_TENANT_ACCESS_DENIED':
    case 'CROSS_TENANT_WRITE_PREVENTED':
    case 'CROSS_TENANT_READ_PREVENTED':
    case 'RESERVED_HOST_DENIED':
    case 'APEX_HOST_DENIED':
      return 403;
    case 'UNTRUSTED_HOST':
    case 'UNVERIFIED_CUSTOM_DOMAIN':
    case 'ABSENT_CUSTOM_DOMAIN':
      return 404;
    case 'INVALID_FORWARDED_HOST':
      return 400;
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    case 'AUDIT_FAILURE':
    default:
      return 403;
  }
}

function normalizeHeaderValue(value: string | readonly string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first !== 'string') {
      return null;
    }
    const parts = first.split(',');
    const entry = parts[0];
    return typeof entry === 'string' ? entry.trim().toLowerCase() : null;
  }
  if (typeof value === 'string') {
    const parts = value.split(',');
    const entry = parts[0];
    return typeof entry === 'string' ? entry.trim().toLowerCase() : null;
  }
  return null;
}

export function extractForwardedHost(headers: ForwardedHeaders): string | null {
  const xForwardedHost = normalizeHeaderValue(headers['x-forwarded-host']);
  if (xForwardedHost && xForwardedHost.length > 0) {
    return xForwardedHost.split(':')[0] ?? null;
  }
  const xOriginalHost = normalizeHeaderValue(headers['x-original-host']);
  if (xOriginalHost && xOriginalHost.length > 0) {
    return xOriginalHost.split(':')[0] ?? null;
  }
  const host = normalizeHeaderValue(headers.host);
  if (host && host.length > 0) {
    return host.split(':')[0] ?? null;
  }
  return null;
}

export function classifyHost(
  host: string | null,
  state: TenantIsolationProofState,
  baseDomain = 'anqr.io'
): { readonly classification: HostClassification; readonly identifier: string | null } {
  if (host === null || host.trim().length === 0) {
    return { classification: 'MALFORMED', identifier: null };
  }

  const cleanHost = host.trim().toLowerCase().split(':')[0];
  if (!cleanHost || cleanHost.includes('/') || cleanHost.includes('\\') || cleanHost.includes(' ')) {
    return { classification: 'MALFORMED', identifier: null };
  }

  if (state.reservedHosts.includes(cleanHost)) {
    return { classification: 'RESERVED', identifier: cleanHost };
  }

  if (state.apexHosts.includes(cleanHost) || cleanHost === baseDomain) {
    return { classification: 'APEX', identifier: cleanHost };
  }

  if (cleanHost.endsWith(`.${baseDomain}`)) {
    const prefix = cleanHost.slice(0, -(baseDomain.length + 1));
    if (prefix.length === 0 || prefix.includes('.')) {
      return { classification: 'MALFORMED', identifier: null };
    }
    if (state.reservedHosts.includes(prefix)) {
      return { classification: 'RESERVED', identifier: prefix };
    }
    return { classification: 'SLUG', identifier: prefix };
  }

  const customDomainRecord = state.customDomains.find((cd) => cd.domain.toLowerCase() === cleanHost);
  if (customDomainRecord) {
    return { classification: 'CUSTOM_DOMAIN', identifier: cleanHost };
  }

  return { classification: 'UNKNOWN', identifier: cleanHost };
}

export function resolveTenantContext(
  headers: ForwardedHeaders,
  state: TenantIsolationProofState,
  baseDomain = 'anqr.io'
): { readonly context: TenantContext | null; readonly error: TenantIsolationProofError | null; readonly classification: HostClassification } {
  const host = extractForwardedHost(headers);
  const { classification, identifier } = classifyHost(host, state, baseDomain);

  switch (classification) {
    case 'SLUG': {
      if (!identifier) {
        return {
          context: null,
          error: { kind: 'UNTRUSTED_HOST', message: 'Slug host could not be resolved', statusCode: 404 },
          classification,
        };
      }
      const tenant = state.tenants.find((t) => t.slug === identifier && t.active);
      if (!tenant) {
        return {
          context: null,
          error: { kind: 'UNTRUSTED_HOST', message: `Tenant slug '${identifier}' not found or inactive`, statusCode: 404 },
          classification,
        };
      }
      const context: TenantContext = {
        organisationId: tenant.organisationId,
        slug: tenant.slug,
        hostSource: 'SLUG_RESOLVED',
        rlsTenantSetting: `app.current_tenant_id = '${tenant.organisationId}'`,
        objectStoragePrefix: `tenants/${tenant.organisationId}/`,
      };
      return { context, error: null, classification };
    }

    case 'CUSTOM_DOMAIN': {
      if (!identifier) {
        return {
          context: null,
          error: { kind: 'ABSENT_CUSTOM_DOMAIN', message: 'Custom domain is absent', statusCode: 404 },
          classification,
        };
      }
      const customDomain = state.customDomains.find((cd) => cd.domain.toLowerCase() === identifier);
      if (!customDomain) {
        return {
          context: null,
          error: { kind: 'ABSENT_CUSTOM_DOMAIN', message: `Custom domain '${identifier}' not found`, statusCode: 404 },
          classification,
        };
      }
      if (customDomain.status !== 'ACTIVE') {
        return {
          context: null,
          error: {
            kind: 'UNVERIFIED_CUSTOM_DOMAIN',
            message: `Custom domain '${identifier}' is not active/verified (status: ${customDomain.status})`,
            statusCode: 404,
          },
          classification,
        };
      }
      const tenant = state.tenants.find((t) => t.organisationId === customDomain.organisationId && t.active);
      if (!tenant) {
        return {
          context: null,
          error: { kind: 'UNTRUSTED_HOST', message: `Tenant for custom domain '${identifier}' is inactive or missing`, statusCode: 404 },
          classification,
        };
      }
      const context: TenantContext = {
        organisationId: tenant.organisationId,
        slug: tenant.slug,
        hostSource: 'CUSTOM_DOMAIN_VERIFIED',
        rlsTenantSetting: `app.current_tenant_id = '${tenant.organisationId}'`,
        objectStoragePrefix: `tenants/${tenant.organisationId}/`,
      };
      return { context, error: null, classification };
    }

    case 'APEX':
      return {
        context: null,
        error: { kind: 'APEX_HOST_DENIED', message: 'Apex host does not bind to any single tenant context', statusCode: 403 },
        classification,
      };

    case 'RESERVED':
      return {
        context: null,
        error: { kind: 'RESERVED_HOST_DENIED', message: 'Reserved host cannot be used as a tenant host', statusCode: 403 },
        classification,
      };

    case 'MALFORMED':
      return {
        context: null,
        error: { kind: 'INVALID_FORWARDED_HOST', message: 'Malformed host header', statusCode: 400 },
        classification,
      };

    case 'UNKNOWN':
    default:
      return {
        context: null,
        error: { kind: 'UNTRUSTED_HOST', message: 'Unknown or untrusted host resolves to no tenant context', statusCode: 404 },
        classification: 'UNKNOWN',
      };
  }
}

export function bindRequestContext(
  state: TenantIsolationProofState,
  request: RequestContext,
  baseDomain = 'anqr.io'
): TenantIsolationProofState {
  const { context, error, classification } = resolveTenantContext(request.headers, state, baseDomain);
  return {
    ...state,
    activeContext: context,
    lastClassification: classification,
    lastError: error,
  };
}

export function authorizeTenantActor(
  context: TenantContext | null,
  actor: TenantActor | null
): { readonly authorized: boolean; readonly error: TenantIsolationProofError | null } {
  if (actor?.isSystemOperator === true && actor.roles.includes('system_operator')) {
    return { authorized: true, error: null };
  }

  if (context === null) {
    return {
      authorized: false,
      error: { kind: 'UNTRUSTED_HOST', message: 'No tenant context resolved; access denied', statusCode: 403 },
    };
  }

  if (actor === null) {
    return {
      authorized: false,
      error: { kind: 'PERMISSION_DENIED', message: 'Authentication required for tenant operations', statusCode: 403 },
    };
  }

  if (actor.organisationId !== context.organisationId) {
    return {
      authorized: false,
      error: {
        kind: 'FOREIGN_TENANT_ACCESS_DENIED',
        message: `Actor organisation '${actor.organisationId}' does not match context organisation '${context.organisationId}'`,
        statusCode: 403,
      },
    };
  }

  return { authorized: true, error: null };
}

export function guardTenantMutation(
  context: TenantContext | null,
  actor: TenantActor | null,
  targetOrganisationId: string
): { readonly allowed: boolean; readonly error: TenantIsolationProofError | null } {
  const auth = authorizeTenantActor(context, actor);
  if (!auth.authorized || auth.error !== null) {
    return { allowed: false, error: auth.error };
  }

  if (actor?.isSystemOperator === true && actor.roles.includes('system_operator')) {
    return { allowed: true, error: null };
  }

  if (!context || context.organisationId !== targetOrganisationId) {
    return {
      allowed: false,
      error: {
        kind: 'CROSS_TENANT_WRITE_PREVENTED',
        message: `Cross-tenant mutation prevented: target '${targetOrganisationId}' does not match context '${context?.organisationId ?? ''}'`,
        statusCode: 403,
      },
    };
  }

  return { allowed: true, error: null };
}

export function executeTenantMutation<T>(
  state: TenantIsolationProofState,
  actor: TenantActor | null,
  targetOrganisationId: string,
  resource: string,
  action: string,
  mutateFn: () => T,
  auditFn: (event: TenantIsolationProofAuditEvent) => TenantIsolationProofError | null
): { readonly success: boolean; readonly result: T | null; readonly error: TenantIsolationProofError | null } {
  const guard = guardTenantMutation(state.activeContext, actor, targetOrganisationId);
  if (!guard.allowed || guard.error !== null) {
    return { success: false, result: null, error: guard.error };
  }

  const tenantSlug = state.activeContext?.slug ?? 'system';
  const auditEvent: TenantIsolationProofAuditEvent = {
    kind: 'TENANT_MUTATION_AUDIT',
    organisationId: targetOrganisationId,
    tenantSlug,
    action,
    targetResource: resource,
    timestamp: new Date().toISOString(),
  };

  try {
    const auditError = auditFn(auditEvent);
    if (auditError !== null) {
      return { success: false, result: null, error: auditError };
    }
  } catch (err) {
    return {
      success: false,
      result: null,
      error: {
        kind: 'AUDIT_FAILURE',
        message: err instanceof Error ? err.message : 'Audit check threw an exception',
        statusCode: 403,
      },
    };
  }

  const result = mutateFn();
  return { success: true, result, error: null };
}

export function filterTenantRows(
  context: TenantContext | null,
  rows: readonly TenantRowRecord[],
  actor?: TenantActor
): { readonly rows: readonly TenantRowRecord[]; readonly error: TenantIsolationProofError | null } {
  if (actor?.isSystemOperator === true && actor.roles.includes('system_operator')) {
    return { rows, error: null };
  }

  if (context === null) {
    return {
      rows: [],
      error: { kind: 'UNTRUSTED_HOST', message: 'No tenant context resolved; cross-tenant read rejected', statusCode: 403 },
    };
  }

  const filtered = rows.filter((r) => r.organisationId === context.organisationId);
  return { rows: filtered, error: null };
}

export function validateStoragePrefix(
  context: TenantContext | null,
  storagePath: string
): { readonly valid: boolean; readonly error: TenantIsolationProofError | null } {
  if (context === null) {
    return {
      valid: false,
      error: { kind: 'UNTRUSTED_HOST', message: 'No tenant context resolved for storage access', statusCode: 403 },
    };
  }

  if (!storagePath.startsWith(context.objectStoragePrefix)) {
    return {
      valid: false,
      error: {
        kind: 'CROSS_TENANT_READ_PREVENTED',
        message: `Storage path '${storagePath}' is outside tenant prefix '${context.objectStoragePrefix}'`,
        statusCode: 403,
      },
    };
  }

  return { valid: true, error: null };
}

export function evaluateReadiness(probes: readonly SubstrateProbeStatus[]): TenantIsolationProofReadiness {
  if (probes.length === 0) {
    return 'READY';
  }

  const anyFailed = probes.some((p) => !p.healthy);
  if (anyFailed) {
    return 'DEGRADED';
  }

  return 'READY';
}

export function runSubstrateProof(
  probe: SubstrateProbeKind,
  context: TenantContext | null,
  liveCheck: () => { readonly healthy: boolean; readonly latencyMs: number; readonly violations?: number }
): IsolationProofResult {
  if (context === null) {
    return {
      proofType: probe,
      organisationId: 'unresolved',
      verified: false,
      details: 'Proof pending: untrusted host without tenant context',
      crossTenantViolations: 0,
    };
  }

  try {
    const outcome = liveCheck();
    const violations = outcome.violations ?? 0;
    const verified = outcome.healthy && violations === 0;

    return {
      proofType: probe,
      organisationId: context.organisationId,
      verified,
      details: verified
        ? `Substrate ${probe} verified for org ${context.organisationId} with 0 violations`
        : `Substrate ${probe} check failed with ${violations} violations`,
      crossTenantViolations: violations,
    };
  } catch (err) {
    return {
      proofType: probe,
      organisationId: context.organisationId,
      verified: false,
      details: `Substrate probe error: ${err instanceof Error ? err.message : String(err)}`,
      crossTenantViolations: 1,
    };
  }
}

export function verifyDomainIdentityMatrix(
  state: TenantIsolationProofState,
  testHosts: readonly string[],
  baseDomain = 'anqr.io'
): readonly { readonly host: string; readonly classification: HostClassification; readonly resolvedOrgId: string | null }[] {
  return testHosts.map((host) => {
    const headers: ForwardedHeaders = { 'x-forwarded-host': host };
    const { context, classification } = resolveTenantContext(headers, state, baseDomain);
    return {
      host,
      classification,
      resolvedOrgId: context ? context.organisationId : null,
    };
  });
}