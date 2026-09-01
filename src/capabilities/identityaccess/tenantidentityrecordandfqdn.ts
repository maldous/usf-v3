export const TenantIdentityRecordAndFqdnHostSource = ['slug', 'custom_domain', 'fixture'] as const;
export type TenantIdentityRecordAndFqdnHostSource = typeof TenantIdentityRecordAndFqdnHostSource[number];

export const TenantIdentityRecordAndFqdnDomainStatus = [
  'PENDING',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'DISABLED',
] as const;
export type TenantIdentityRecordAndFqdnDomainStatus = typeof TenantIdentityRecordAndFqdnDomainStatus[number];

export const TenantIdentityRecordAndFqdnHostClassification = [
  'apex',
  'slug',
  'local_slug',
  'reserved',
  'unknown',
  'malformed',
  'host_with_port',
  'possible_custom_domain',
] as const;
export type TenantIdentityRecordAndFqdnHostClassification = typeof TenantIdentityRecordAndFqdnHostClassification[number];

export const TenantIdentityRecordAndFqdnReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type TenantIdentityRecordAndFqdnReadiness = typeof TenantIdentityRecordAndFqdnReadiness[number];

export const TenantIdentityRecordAndFqdnAuditEventKind = ['TENANT_PROVISIONED'] as const;
export type TenantIdentityRecordAndFqdnAuditEventKind = typeof TenantIdentityRecordAndFqdnAuditEventKind[number];

export const TenantIdentityRecordAndFqdnErrorKind = [
  'AUDIT_FAILURE',
  'PERMISSION_DENIED',
  'INVALID_INPUT',
  'CONFLICT',
  'DEGRADED_PROVIDER',
  'HOST_RESOLUTION_FAILED',
] as const;
export type TenantIdentityRecordAndFqdnErrorKind = typeof TenantIdentityRecordAndFqdnErrorKind[number];

export const TenantIdentityRecordAndFqdnProofStatus = ['PASSED', 'FAILED', 'PENDING', 'SKIPPED'] as const;
export type TenantIdentityRecordAndFqdnProofStatus = typeof TenantIdentityRecordAndFqdnProofStatus[number];

export const RESERVED_SUBDOMAINS: readonly string[] = [
  'api',
  'app',
  'admin',
  'auth',
  'assets',
  'cdn',
  'dashboard',
  'login',
  'mail',
  'portal',
  'root',
  'static',
  'status',
  'system',
  'www',
];

export interface TenantIdentityRecordAndFqdnAuditLog {
  readonly kind: TenantIdentityRecordAndFqdnAuditEventKind;
  readonly organisationId: string;
  readonly slug: string;
  readonly timestamp: string;
  readonly details?: Record<string, unknown>;
}

export interface TenantIdentityRecordAndFqdnResolutionLog {
  readonly host: string;
  readonly reason: string;
  readonly timestamp: string;
}

export interface TenantIdentityRecordAndFqdnError {
  readonly kind: TenantIdentityRecordAndFqdnErrorKind;
  readonly message: string;
  readonly statusCode: number;
}

export interface CustomDomainRecord {
  readonly fqdn: string;
  readonly organisationId: string;
  readonly status: TenantIdentityRecordAndFqdnDomainStatus;
  readonly verified: boolean;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TenantRecord {
  readonly organisationId: string;
  readonly slug: string;
  readonly realm: string;
  readonly hostSource: TenantIdentityRecordAndFqdnHostSource;
  readonly createdAt: string;
}

export interface TenantContext {
  readonly organisationId: string;
  readonly slug: string;
  readonly realm: string;
  readonly hostSource: TenantIdentityRecordAndFqdnHostSource;
  readonly matchedFqdn: string;
}

export interface TenantIdentityRecordAndFqdnState {
  readonly tenants: readonly TenantRecord[];
  readonly fixtureTenants: readonly TenantRecord[];
  readonly domainRegistry: readonly CustomDomainRecord[];
  readonly resolverAvailable: boolean;
  readonly domainRegistryAvailable: boolean;
  readonly auditLogs: readonly TenantIdentityRecordAndFqdnAuditLog[];
  readonly resolutionLogs: readonly TenantIdentityRecordAndFqdnResolutionLog[];
  readonly rootDomain: string;
}

export interface RequestHeaders {
  readonly host?: string;
  readonly 'x-forwarded-host'?: string;
  readonly [key: string]: string | undefined;
}

export interface ResolveHostResult {
  readonly success: boolean;
  readonly tenant: TenantContext | null;
  readonly error: TenantIdentityRecordAndFqdnError | null;
  readonly classification: TenantIdentityRecordAndFqdnHostClassification;
  readonly resolvedHost: string;
}

export interface OperatorContext {
  readonly operatorId: string;
  readonly permissions: readonly string[];
}

export interface ProvisionTenantInput {
  readonly organisationId: string;
  readonly slug: string;
  readonly hostSource?: TenantIdentityRecordAndFqdnHostSource;
}

export interface ProvisionTenantResult {
  readonly success: boolean;
  readonly state: TenantIdentityRecordAndFqdnState;
  readonly tenant: TenantRecord | null;
  readonly error: TenantIdentityRecordAndFqdnError | null;
}

export interface DomainIdentityMatrixProofResult {
  readonly proofName: 'DomainIdentityMatrixProof';
  readonly status: TenantIdentityRecordAndFqdnProofStatus;
  readonly lineage: string;
  readonly casesTested: number;
  readonly details: readonly string[];
}

export interface CustomDomainResolutionProofResult {
  readonly proofName: 'CustomDomainResolutionProof';
  readonly status: TenantIdentityRecordAndFqdnProofStatus;
  readonly lineage: string;
  readonly details: readonly string[];
}

export const initialState: TenantIdentityRecordAndFqdnState = {
  tenants: [],
  fixtureTenants: [],
  domainRegistry: [],
  resolverAvailable: true,
  domainRegistryAvailable: true,
  auditLogs: [],
  resolutionLogs: [],
  rootDomain: 'anqr.internal',
};

export function deriveRealm(organisationId: string): string {
  return `tenant-${organisationId}`;
}

export function extractHostFromHeaders(headers: RequestHeaders): string {
  const forwarded = headers['x-forwarded-host'];
  if (forwarded !== undefined && typeof forwarded === 'string' && forwarded.trim().length > 0) {
    const firstForwarded = forwarded.split(',')[0];
    return firstForwarded !== undefined ? firstForwarded.trim().toLowerCase() : '';
  }
  const host = headers.host;
  if (host !== undefined && typeof host === 'string' && host.trim().length > 0) {
    return host.trim().toLowerCase();
  }
  return '';
}

export function normalizeHost(rawHost: string): { readonly host: string; readonly port: number | null; readonly hadPort: boolean } {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) {
    return { host: '', port: null, hadPort: false };
  }
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    const hostPart = parts[0] ?? '';
    const portPart = parts[1] ?? '';
    const parsedPort = Number.parseInt(portPart, 10);
    return {
      host: hostPart,
      port: Number.isNaN(parsedPort) ? null : parsedPort,
      hadPort: true,
    };
  }
  return { host: trimmed, port: null, hadPort: false };
}

export function classifyHost(rawHost: string, rootDomain: string = 'anqr.internal'): TenantIdentityRecordAndFqdnHostClassification {
  if (!rawHost || rawHost.trim().length === 0) {
    return 'malformed';
  }

  const { host, hadPort } = normalizeHost(rawHost);

  if (!host || host.length > 253 || host.startsWith('.') || host.endsWith('.')) {
    return 'malformed';
  }

  const validDomainPattern = /^(?!-)[a-z0-9-_]{1,63}(?<!-)(\.(?!-)[a-z0-9-_]{1,63}(?<!-))*$/;
  if (!validDomainPattern.test(host)) {
    return 'malformed';
  }

  const normalizedRoot = rootDomain.toLowerCase();

  if (host === normalizedRoot) {
    return 'apex';
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return 'local_slug';
  }

  if (host.endsWith(`.${normalizedRoot}`)) {
    const subPart = host.slice(0, -(normalizedRoot.length + 1));
    if (subPart.includes('.')) {
      return 'malformed';
    }
    if (RESERVED_SUBDOMAINS.includes(subPart)) {
      return 'reserved';
    }
    if (hadPort) {
      return 'host_with_port';
    }
    return 'slug';
  }

  if (hadPort) {
    return 'host_with_port';
  }

  if (host.includes('.')) {
    return 'possible_custom_domain';
  }

  return 'unknown';
}

export function getReadiness(state: TenantIdentityRecordAndFqdnState): TenantIdentityRecordAndFqdnReadiness {
  if (!state.resolverAvailable) {
    return 'NOT_READY';
  }
  if (!state.domainRegistryAvailable) {
    return 'DEGRADED';
  }
  return 'READY';
}

export function hasPermission(operator: OperatorContext, requiredPermission: string): boolean {
  return operator.permissions.includes(requiredPermission) || operator.permissions.includes('*');
}

export function auditTenantProvisioning(
  auditFn: ((event: TenantIdentityRecordAndFqdnAuditLog) => TenantIdentityRecordAndFqdnError | null) | undefined,
  organisationId: string,
  slug: string,
): TenantIdentityRecordAndFqdnError | null {
  if (!auditFn) {
    return null;
  }
  const event: TenantIdentityRecordAndFqdnAuditLog = {
    kind: 'TENANT_PROVISIONED',
    organisationId,
    slug,
    timestamp: new Date().toISOString(),
  };
  try {
    const res = auditFn(event);
    if (res !== null) {
      return res;
    }
    return null;
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit invocation failed',
      statusCode: 403,
    };
  }
}

export function provisionTenant(
  state: TenantIdentityRecordAndFqdnState,
  operator: OperatorContext,
  input: ProvisionTenantInput,
  auditFn?: (event: TenantIdentityRecordAndFqdnAuditLog) => TenantIdentityRecordAndFqdnError | null,
): ProvisionTenantResult {
  if (!hasPermission(operator, 'tenant:create') && !hasPermission(operator, 'tenant:admin')) {
    return {
      success: false,
      state,
      tenant: null,
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Operator lacks platform tenant create permissions',
        statusCode: 403,
      },
    };
  }

  if (!input.organisationId || !input.organisationId.trim()) {
    return {
      success: false,
      state,
      tenant: null,
      error: {
        kind: 'INVALID_INPUT',
        message: 'Organisation ID must not be empty',
        statusCode: 400,
      },
    };
  }

  const normalizedSlug = input.slug.trim().toLowerCase();
  if (!normalizedSlug || !/^[a-z0-9-]+$/.test(normalizedSlug)) {
    return {
      success: false,
      state,
      tenant: null,
      error: {
        kind: 'INVALID_INPUT',
        message: 'Tenant slug is invalid or malformed',
        statusCode: 400,
      },
    };
  }

  if (RESERVED_SUBDOMAINS.includes(normalizedSlug)) {
    return {
      success: false,
      state,
      tenant: null,
      error: {
        kind: 'CONFLICT',
        message: `Tenant slug '${normalizedSlug}' is reserved`,
        statusCode: 409,
      },
    };
  }

  const existingOrg = state.tenants.find((t) => t.organisationId === input.organisationId);
  if (existingOrg) {
    return {
      success: false,
      state,
      tenant: null,
      error: {
        kind: 'CONFLICT',
        message: `Tenant organisationId '${input.organisationId}' already exists`,
        statusCode: 409,
      },
    };
  }

  const existingSlug = state.tenants.find((t) => t.slug === normalizedSlug);
  if (existingSlug) {
    return {
      success: false,
      state,
      tenant: null,
      error: {
        kind: 'CONFLICT',
        message: `Tenant slug '${normalizedSlug}' is already claimed`,
        statusCode: 409,
      },
    };
  }

  const auditErr = auditTenantProvisioning(auditFn, input.organisationId, normalizedSlug);
  if (auditErr !== null) {
    return {
      success: false,
      state,
      tenant: null,
      error: auditErr,
    };
  }

  const newTenant: TenantRecord = {
    organisationId: input.organisationId,
    slug: normalizedSlug,
    realm: deriveRealm(input.organisationId),
    hostSource: input.hostSource ?? 'slug',
    createdAt: new Date().toISOString(),
  };

  const nextAuditLogs = [
    ...state.auditLogs,
    {
      kind: 'TENANT_PROVISIONED' as const,
      organisationId: input.organisationId,
      slug: normalizedSlug,
      timestamp: newTenant.createdAt,
    },
  ];

  const nextState: TenantIdentityRecordAndFqdnState = {
    ...state,
    tenants: [...state.tenants, newTenant],
    auditLogs: nextAuditLogs,
  };

  return {
    success: true,
    state: nextState,
    tenant: newTenant,
    error: null,
  };
}

export function registerCustomDomain(
  state: TenantIdentityRecordAndFqdnState,
  operator: OperatorContext,
  organisationId: string,
  fqdn: string,
  verified: boolean = false,
  active: boolean = false,
): { readonly success: boolean; readonly state: TenantIdentityRecordAndFqdnState; readonly error: TenantIdentityRecordAndFqdnError | null } {
  if (getReadiness(state) === 'DEGRADED' || !state.domainRegistryAvailable) {
    return {
      success: false,
      state,
      error: {
        kind: 'DEGRADED_PROVIDER',
        message: 'Custom domain mutations are disabled when domain registry is degraded',
        statusCode: 503,
      },
    };
  }

  if (!hasPermission(operator, 'tenant:create') && !hasPermission(operator, 'tenant:admin')) {
    return {
      success: false,
      state,
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Operator lacks permission to register domain',
        statusCode: 403,
      },
    };
  }

  const tenant = state.tenants.find((t) => t.organisationId === organisationId);
  if (!tenant) {
    return {
      success: false,
      state,
      error: {
        kind: 'INVALID_INPUT',
        message: `Tenant organisationId '${organisationId}' does not exist`,
        statusCode: 404,
      },
    };
  }

  const normalizedFqdn = fqdn.trim().toLowerCase();
  const existingDomain = state.domainRegistry.find((d) => d.fqdn === normalizedFqdn);
  if (existingDomain) {
    return {
      success: false,
      state,
      error: {
        kind: 'CONFLICT',
        message: `Domain '${normalizedFqdn}' is already registered`,
        statusCode: 409,
      },
    };
  }

  let status: TenantIdentityRecordAndFqdnDomainStatus = 'PENDING';
  if (verified && active) {
    status = 'ACTIVE';
  } else if (verified && !active) {
    status = 'INACTIVE';
  }

  const newDomain: CustomDomainRecord = {
    fqdn: normalizedFqdn,
    organisationId,
    status,
    verified,
    active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    success: true,
    state: {
      ...state,
      domainRegistry: [...state.domainRegistry, newDomain],
    },
    error: null,
  };
}

export function updateCustomDomainStatus(
  state: TenantIdentityRecordAndFqdnState,
  operator: OperatorContext,
  fqdn: string,
  status: TenantIdentityRecordAndFqdnDomainStatus,
): { readonly success: boolean; readonly state: TenantIdentityRecordAndFqdnState; readonly error: TenantIdentityRecordAndFqdnError | null } {
  if (getReadiness(state) === 'DEGRADED' || !state.domainRegistryAvailable) {
    return {
      success: false,
      state,
      error: {
        kind: 'DEGRADED_PROVIDER',
        message: 'Custom domain mutations are disabled when domain registry is degraded',
        statusCode: 503,
      },
    };
  }

  if (!hasPermission(operator, 'tenant:create') && !hasPermission(operator, 'tenant:admin')) {
    return {
      success: false,
      state,
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Operator lacks permission to update domain status',
        statusCode: 403,
      },
    };
  }

  const normalizedFqdn = fqdn.trim().toLowerCase();
  const domainIdx = state.domainRegistry.findIndex((d) => d.fqdn === normalizedFqdn);
  if (domainIdx === -1) {
    return {
      success: false,
      state,
      error: {
        kind: 'INVALID_INPUT',
        message: `Domain '${normalizedFqdn}' not found`,
        statusCode: 404,
      },
    };
  }

  const prev = state.domainRegistry[domainIdx];
  if (!prev) {
    return {
      success: false,
      state,
      error: {
        kind: 'INVALID_INPUT',
        message: `Domain '${normalizedFqdn}' not found`,
        statusCode: 404,
      },
    };
  }

  const isVerified = status === 'ACTIVE' || status === 'VERIFIED';
  const isActive = status === 'ACTIVE';

  const updated: CustomDomainRecord = {
    ...prev,
    status,
    verified: isVerified,
    active: isActive,
    updatedAt: new Date().toISOString(),
  };

  const nextRegistry = [...state.domainRegistry];
  nextRegistry[domainIdx] = updated;

  return {
    success: true,
    state: {
      ...state,
      domainRegistry: nextRegistry,
    },
    error: null,
  };
}

export function resolveHostIdentity(
  state: TenantIdentityRecordAndFqdnState,
  headers: RequestHeaders,
): ResolveHostResult {
  if (!state.resolverAvailable) {
    return {
      success: false,
      tenant: null,
      error: {
        kind: 'DEGRADED_PROVIDER',
        message: 'Resolver substrate is unavailable',
        statusCode: 503,
      },
      classification: 'unknown',
      resolvedHost: '',
    };
  }

  const rawHost = extractHostFromHeaders(headers);
  if (!rawHost) {
    return {
      success: false,
      tenant: null,
      error: null,
      classification: 'malformed',
      resolvedHost: '',
    };
  }

  const classification = classifyHost(rawHost, state.rootDomain);
  const { host } = normalizeHost(rawHost);

  if (
    classification === 'apex' ||
    classification === 'reserved' ||
    classification === 'invalid' as unknown ||
    classification === 'malformed' ||
    classification === 'unknown'
  ) {
    return {
      success: false,
      tenant: null,
      error: null,
      classification,
      resolvedHost: host,
    };
  }

  if (classification === 'slug' || classification === 'host_with_port') {
    const normalizedRoot = state.rootDomain.toLowerCase();
    if (host.endsWith(`.${normalizedRoot}`)) {
      const slug = host.slice(0, -(normalizedRoot.length + 1));
      const tenant = state.tenants.find((t) => t.slug === slug);
      if (tenant) {
        return {
          success: true,
          tenant: {
            organisationId: tenant.organisationId,
            slug: tenant.slug,
            realm: tenant.realm,
            hostSource: 'slug',
            matchedFqdn: host,
          },
          error: null,
          classification: 'slug',
          resolvedHost: host,
        };
      }
    }
    return {
      success: false,
      tenant: null,
      error: null,
      classification,
      resolvedHost: host,
    };
  }

  if (classification === 'local_slug') {
    const slug = host.replace(/\.localhost$/, '').replace(/^localhost$/, '');
    if (slug) {
      const fixtureTenant = state.fixtureTenants.find((t) => t.slug === slug);
      if (fixtureTenant) {
        return {
          success: true,
          tenant: {
            organisationId: fixtureTenant.organisationId,
            slug: fixtureTenant.slug,
            realm: fixtureTenant.realm,
            hostSource: 'fixture',
            matchedFqdn: host,
          },
          error: null,
          classification: 'local_slug',
          resolvedHost: host,
        };
      }
      const tenant = state.tenants.find((t) => t.slug === slug);
      if (tenant) {
        return {
          success: true,
          tenant: {
            organisationId: tenant.organisationId,
            slug: tenant.slug,
            realm: tenant.realm,
            hostSource: 'slug',
            matchedFqdn: host,
          },
          error: null,
          classification: 'local_slug',
          resolvedHost: host,
        };
      }
    }
    return {
      success: false,
      tenant: null,
      error: null,
      classification: 'local_slug',
      resolvedHost: host,
    };
  }

  if (classification === 'possible_custom_domain') {
    if (!state.domainRegistryAvailable) {
      return {
        success: false,
        tenant: null,
        error: {
          kind: 'DEGRADED_PROVIDER',
          message: 'Domain registry provider is degraded',
          statusCode: 503,
        },
        classification: 'possible_custom_domain',
        resolvedHost: host,
      };
    }

    const domainEntry = state.domainRegistry.find((d) => d.fqdn === host);
    if (!domainEntry) {
      return {
        success: false,
        tenant: null,
        error: null,
        classification: 'possible_custom_domain',
        resolvedHost: host,
      };
    }

    if (!domainEntry.verified || !domainEntry.active || domainEntry.status !== 'ACTIVE') {
      return {
        success: false,
        tenant: null,
        error: null,
        classification: 'possible_custom_domain',
        resolvedHost: host,
      };
    }

    const tenant = state.tenants.find((t) => t.organisationId === domainEntry.organisationId);
    if (!tenant) {
      return {
        success: false,
        tenant: null,
        error: null,
        classification: 'possible_custom_domain',
        resolvedHost: host,
      };
    }

    return {
      success: true,
      tenant: {
        organisationId: tenant.organisationId,
        slug: tenant.slug,
        realm: tenant.realm,
        hostSource: 'custom_domain',
        matchedFqdn: host,
      },
      error: null,
      classification: 'possible_custom_domain',
      resolvedHost: host,
    };
  }

  return {
    success: false,
    tenant: null,
    error: null,
    classification: 'unknown',
    resolvedHost: host,
  };
}

export function runDomainIdentityMatrixProof(
  state: TenantIdentityRecordAndFqdnState,
): DomainIdentityMatrixProofResult {
  const cases: readonly { readonly host: string; readonly expectedClass: TenantIdentityRecordAndFqdnHostClassification }[] = [
    { host: state.rootDomain, expectedClass: 'apex' },
    { host: `alpha.${state.rootDomain}`, expectedClass: 'slug' },
    { host: `alpha.localhost`, expectedClass: 'local_slug' },
    { host: `admin.${state.rootDomain}`, expectedClass: 'reserved' },
    { host: `alpha.${state.rootDomain}:8080`, expectedClass: 'host_with_port' },
    { host: 'tenant.acme-corp.com', expectedClass: 'possible_custom_domain' },
    { host: 'not-a-domain', expectedClass: 'unknown' },
    { host: '..invalid..', expectedClass: 'malformed' },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const c of cases) {
    const actual = classifyHost(c.host, state.rootDomain);
    if (actual === c.expectedClass) {
      details.push(`PASS: ${c.host} -> ${actual}`);
    } else {
      details.push(`FAIL: ${c.host} -> expected ${c.expectedClass}, got ${actual}`);
      allPassed = false;
    }
  }

  return {
    proofName: 'DomainIdentityMatrixProof',
    status: allPassed ? 'PASSED' : 'FAILED',
    lineage: 'hermes.runtime.identityaccess.domain_identity_matrix_proof.v1',
    casesTested: cases.length,
    details,
  };
}

export function runCustomDomainResolutionProof(
  state: TenantIdentityRecordAndFqdnState,
): CustomDomainResolutionProofResult {
  if (state.tenants.length === 0 && state.fixtureTenants.length === 0) {
    return {
      proofName: 'CustomDomainResolutionProof',
      status: 'SKIPPED',
      lineage: 'hermes.runtime.identityaccess.custom_domain_resolution_proof.v1',
      details: ['Skipped honestly: seeded local substrate is absent'],
    };
  }

  const details: string[] = [];
  let passed = true;

  const testCases: readonly { readonly status: TenantIdentityRecordAndFqdnDomainStatus; readonly verified: boolean; readonly active: boolean; readonly shouldResolve: boolean }[] = [
    { status: 'ACTIVE', verified: true, active: true, shouldResolve: true },
    { status: 'PENDING', verified: false, active: false, shouldResolve: false },
    { status: 'INACTIVE', verified: true, active: false, shouldResolve: false },
    { status: 'DISABLED', verified: true, active: false, shouldResolve: false },
  ];

  for (const tc of testCases) {
    const orgId = `proof-org-${tc.status.toLowerCase()}`;
    const fqdn = `custom-${tc.status.toLowerCase()}.example.com`;
    const mockTenant: TenantRecord = {
      organisationId: orgId,
      slug: `proof-slug-${tc.status.toLowerCase()}`,
      realm: deriveRealm(orgId),
      hostSource: 'slug',
      createdAt: new Date().toISOString(),
    };
    const mockDomain: CustomDomainRecord = {
      fqdn,
      organisationId: orgId,
      status: tc.status,
      verified: tc.verified,
      active: tc.active,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const testState: TenantIdentityRecordAndFqdnState = {
      ...state,
      tenants: [...state.tenants, mockTenant],
      domainRegistry: [...state.domainRegistry, mockDomain],
    };

    const res = resolveHostIdentity(testState, { host: fqdn });
    const resolved = res.success && res.tenant !== null;
    if (resolved === tc.shouldResolve) {
      details.push(`PASS: ${tc.status} domain correctly evaluated to ${tc.shouldResolve ? 'resolved' : 'null context'}`);
    } else {
      details.push(`FAIL: ${tc.status} domain expected resolve=${tc.shouldResolve}, got resolve=${resolved}`);
      passed = false;
    }
  }

  return {
    proofName: 'CustomDomainResolutionProof',
    status: passed ? 'PASSED' : 'FAILED',
    lineage: 'hermes.runtime.identityaccess.custom_domain_resolution_proof.v1',
    details,
  };
}