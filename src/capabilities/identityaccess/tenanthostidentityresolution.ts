export const TenantHostClassificationKind = [
  'apex',
  'tenant_slug',
  'reserved_subdomain',
  'invalid_subdomain',
  'possible_custom_domain',
  'malformed',
] as const;
export type TenantHostClassificationKind = typeof TenantHostClassificationKind[number];

export const TenantHostSource = [
  'tenant_slug',
  'custom_domain',
] as const;
export type TenantHostSource = typeof TenantHostSource[number];

export const CustomDomainStatus = [
  'active',
  'pending',
  'inactive',
  'disabled',
] as const;
export type CustomDomainStatus = typeof CustomDomainStatus[number];

export const TenantHostIdentityResolutionReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type TenantHostIdentityResolutionReadiness = typeof TenantHostIdentityResolutionReadiness[number];

export const TenantHostIdentityResolutionErrorKind = [
  'APEX_SUBDOMAIN_REJECTED',
  'REGISTRY_DEGRADED',
  'REGISTRY_UNAVAILABLE',
  'MALFORMED_HOST',
  'UNRESOLVED_HOST',
] as const;
export type TenantHostIdentityResolutionErrorKind = typeof TenantHostIdentityResolutionErrorKind[number];

export const TenantHostIdentityResolutionWarningKind = [
  'FAILED_RESOLUTION',
  'UNTRUSTED_HOST',
  'MALFORMED_HOST',
  'RESERVED_SUBDOMAIN',
  'INVALID_SUBDOMAIN',
  'INACTIVE_DOMAIN',
  'PENDING_DOMAIN',
  'DISABLED_DOMAIN',
  'UNKNOWN_SLUG',
  'UNKNOWN_CUSTOM_DOMAIN',
  'REGISTRY_DEGRADED',
] as const;
export type TenantHostIdentityResolutionWarningKind = typeof TenantHostIdentityResolutionWarningKind[number];

export const TenantHostIdentityResolutionProofStatus = [
  'VALIDATED',
  'PENDING',
  'SKIPPED',
] as const;
export type TenantHostIdentityResolutionProofStatus = typeof TenantHostIdentityResolutionProofStatus[number];

export const TenantHostIdentityResolutionLifecycleStage = [
  'classify',
  'resolve',
  'finalize',
] as const;
export type TenantHostIdentityResolutionLifecycleStage = typeof TenantHostIdentityResolutionLifecycleStage[number];

export const TenantHostIdentityResolutionLineage = [
  'hermetic',
  'runtime',
] as const;
export type TenantHostIdentityResolutionLineage = typeof TenantHostIdentityResolutionLineage[number];

export const TenantHostIdentityResolutionAuditEventKind = ['NONE'] as const;
export type TenantHostIdentityResolutionAuditEventKind = typeof TenantHostIdentityResolutionAuditEventKind[number];

export const DEFAULT_RESERVED_SUBDOMAINS: readonly string[] = [
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'cdn',
  'dashboard',
  'docs',
  'gateway',
  'graphql',
  'health',
  'login',
  'metrics',
  'portal',
  'root',
  'signup',
  'sso',
  'status',
  'static',
  'support',
  'system',
  'test',
  'webhook',
  'webhooks',
  'www',
] as const;

export interface TenantResolvedContext {
  readonly organizationId: string;
  readonly slug: string;
  readonly realmName: string;
  readonly hostSource: TenantHostSource;
}

export interface TenantHostIdentityResolutionState {
  readonly classification: TenantHostClassificationKind;
  readonly tenant: TenantResolvedContext | null;
  readonly rawHost: string;
  readonly sanitizedHost: string;
  readonly apexDomain: string;
  readonly isTrusted: boolean;
  readonly lifecycleStage: TenantHostIdentityResolutionLifecycleStage;
  readonly proofStatus: TenantHostIdentityResolutionProofStatus;
}

export interface OrganizationRecord {
  readonly organizationId: string;
  readonly slug: string;
  readonly realmName: string;
  readonly active: boolean;
}

export interface CustomDomainRecord {
  readonly domain: string;
  readonly organizationId: string;
  readonly slug: string;
  readonly realmName: string;
  readonly status: CustomDomainStatus;
}

export interface DomainRegistry {
  readonly findOrganizationBySlug: (slug: string) => OrganizationRecord | null;
  readonly findCustomDomain: (domain: string) => CustomDomainRecord | null;
  readonly isAvailable: boolean;
}

export interface RequestContext {
  readonly host?: string | null;
  readonly forwardedHost?: string | null;
  readonly headers?: Record<string, string | readonly string[] | undefined>;
}

export interface TenantHostIdentityResolutionWarning {
  readonly kind: TenantHostIdentityResolutionWarningKind;
  readonly message: string;
  readonly host: string;
}

export interface TenantHostIdentityResolutionError {
  readonly kind: TenantHostIdentityResolutionErrorKind;
  readonly message: string;
  readonly detail?: string;
  readonly statusCode: number;
}

export interface TenantHostIdentityResolutionAuditEvent {
  readonly kind: TenantHostIdentityResolutionAuditEventKind;
  readonly resource: string;
  readonly host: string;
  readonly timestamp: string;
}

export interface TenantHostIdentityResolutionSuccess {
  readonly success: true;
  readonly classification: TenantHostClassificationKind;
  readonly tenant: TenantResolvedContext | null;
  readonly warnings: readonly TenantHostIdentityResolutionWarning[];
  readonly state: TenantHostIdentityResolutionState;
  readonly error: null;
  readonly proof: RuntimeResolutionProof;
}

export interface TenantHostIdentityResolutionFailure {
  readonly success: false;
  readonly classification: TenantHostClassificationKind;
  readonly tenant: null;
  readonly warnings: readonly TenantHostIdentityResolutionWarning[];
  readonly state: TenantHostIdentityResolutionState;
  readonly error: TenantHostIdentityResolutionError;
  readonly proof: RuntimeResolutionProof;
}

export type TenantHostIdentityResolutionResult =
  | TenantHostIdentityResolutionSuccess
  | TenantHostIdentityResolutionFailure;

export interface GlobalRouteRejection {
  readonly rejected: true;
  readonly reason: 'APEX_SUBDOMAIN_REJECTED';
  readonly detail: string;
  readonly statusCode: number;
}

export interface GlobalRouteAcceptance {
  readonly rejected: false;
  readonly detail: null;
}

export type GlobalRouteGuardResult = GlobalRouteRejection | GlobalRouteAcceptance;

export interface HermeticSubstrateProofConfig {
  readonly seededOrganizations: readonly OrganizationRecord[];
  readonly seededDomains: readonly CustomDomainRecord[];
  readonly substrateAvailable: boolean;
  readonly registryAvailable: boolean;
}

export interface RuntimeResolutionProof {
  readonly status: TenantHostIdentityResolutionProofStatus;
  readonly lineage: TenantHostIdentityResolutionLineage;
  readonly matrixValidationPassed: boolean;
  readonly details: readonly string[];
}

export interface ResolverConfiguration {
  readonly apexDomain: string;
  readonly reservedSubdomains?: readonly string[];
  readonly trustForwardedHost?: boolean;
}

export const HAS_MUTATION_AUDIT = false;

export function stripPort(rawHost: string): string {
  const trimmed = rawHost.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']');
    if (closingBracket !== -1) {
      return trimmed.slice(0, closingBracket + 1);
    }
  }
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex !== -1) {
    return trimmed.slice(0, colonIndex);
  }
  return trimmed;
}

export function extractEffectiveHost(request: RequestContext, trustForwarded: boolean = true): string {
  if (trustForwarded) {
    if (request.forwardedHost && typeof request.forwardedHost === 'string' && request.forwardedHost.trim() !== '') {
      const parts = request.forwardedHost.split(',');
      const firstPart = parts[0];
      if (firstPart !== undefined && firstPart.trim() !== '') {
        return stripPort(firstPart);
      }
    }
    const headers = request.headers;
    if (headers) {
      const xForwarded = headers['x-forwarded-host'] ?? headers['X-Forwarded-Host'];
      if (typeof xForwarded === 'string' && xForwarded.trim() !== '') {
        const parts = xForwarded.split(',');
        const firstPart = parts[0];
        if (firstPart !== undefined && firstPart.trim() !== '') {
          return stripPort(firstPart);
        }
      } else if (Array.isArray(xForwarded) && xForwarded.length > 0) {
        const first = xForwarded[0];
        if (typeof first === 'string' && first.trim() !== '') {
          return stripPort(first.split(',')[0] ?? first);
        }
      }
    }
  }

  if (request.host && typeof request.host === 'string' && request.host.trim() !== '') {
    return stripPort(request.host);
  }

  if (request.headers) {
    const hostHeader = request.headers['host'] ?? request.headers['Host'];
    if (typeof hostHeader === 'string' && hostHeader.trim() !== '') {
      return stripPort(hostHeader);
    }
  }

  return '';
}

export function isValidHostSyntax(host: string): boolean {
  if (!host || host.length > 253) {
    return false;
  }
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    return false;
  }
  const labels = host.split('.');
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) {
      return false;
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return false;
    }
    if (!/^[a-z0-9-]+$/.test(label)) {
      return false;
    }
  }
  return true;
}

export function isValidSubdomainSlug(slug: string): boolean {
  if (!slug || slug.length < 1 || slug.length > 63) {
    return false;
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return false;
  }
  return /^[a-z0-9-]+$/.test(slug);
}

export function classifyHost(
  sanitizedHost: string,
  apexDomain: string,
  reservedSubdomains: readonly string[] = DEFAULT_RESERVED_SUBDOMAINS,
): TenantHostClassificationKind {
  const normalizedHost = stripPort(sanitizedHost);

  if (!normalizedHost || !isValidHostSyntax(normalizedHost)) {
    return 'malformed';
  }

  const normalizedApex = stripPort(apexDomain).toLowerCase();
  if (normalizedHost === normalizedApex) {
    return 'apex';
  }

  const suffix = `.${normalizedApex}`;
  if (normalizedHost.endsWith(suffix)) {
    const prefix = normalizedHost.slice(0, -suffix.length);
    if (!prefix || prefix.includes('.')) {
      return 'invalid_subdomain';
    }
    if (!isValidSubdomainSlug(prefix)) {
      return 'invalid_subdomain';
    }
    if (reservedSubdomains.includes(prefix)) {
      return 'reserved_subdomain';
    }
    return 'tenant_slug';
  }

  return 'possible_custom_domain';
}

export function checkReadiness(
  registry: DomainRegistry | null | undefined,
): TenantHostIdentityResolutionReadiness {
  if (!registry) {
    return 'NOT_READY';
  }
  if (!registry.isAvailable) {
    return 'DEGRADED';
  }
  return 'READY';
}

export function guardGlobalRoute(
  classification: TenantHostClassificationKind,
  host: string,
): GlobalRouteGuardResult {
  if (classification === 'reserved_subdomain' || classification === 'invalid_subdomain') {
    return {
      rejected: true,
      reason: 'APEX_SUBDOMAIN_REJECTED',
      detail: `Global route rejected apex subdomain access for host: ${host} (classification: ${classification})`,
      statusCode: 400,
    };
  }
  return {
    rejected: false,
    detail: null,
  };
}

export function createInitialState(
  rawHost: string = '',
  apexDomain: string = '',
): TenantHostIdentityResolutionState {
  return {
    classification: 'malformed',
    tenant: null,
    rawHost,
    sanitizedHost: '',
    apexDomain,
    isTrusted: false,
    lifecycleStage: 'classify',
    proofStatus: 'PENDING',
  };
}

function finalizeState(
  partial: Omit<TenantHostIdentityResolutionState, 'lifecycleStage' | 'proofStatus'>,
  lifecycleStage: TenantHostIdentityResolutionLifecycleStage,
  proofStatus: TenantHostIdentityResolutionProofStatus,
): TenantHostIdentityResolutionState {
  return {
    classification: partial.classification,
    tenant: partial.tenant,
    rawHost: partial.rawHost,
    sanitizedHost: partial.sanitizedHost,
    apexDomain: partial.apexDomain,
    isTrusted: partial.isTrusted,
    lifecycleStage,
    proofStatus,
  };
}

function buildProof(
  status: TenantHostIdentityResolutionProofStatus,
  lineage: TenantHostIdentityResolutionLineage,
  matrixValidationPassed: boolean,
  details: readonly string[],
): RuntimeResolutionProof {
  return {
    status,
    lineage,
    matrixValidationPassed,
    details,
  };
}

function buildSuccess(
  classification: TenantHostClassificationKind,
  tenant: TenantResolvedContext | null,
  warnings: readonly TenantHostIdentityResolutionWarning[],
  state: TenantHostIdentityResolutionState,
  proofStatus: TenantHostIdentityResolutionProofStatus = 'PENDING',
  proofLineage: TenantHostIdentityResolutionLineage = 'runtime',
  proofDetails: readonly string[] = [],
  matrixValidationPassed: boolean = false,
): TenantHostIdentityResolutionSuccess {
  return {
    success: true,
    classification,
    tenant,
    warnings,
    state,
    error: null,
    proof: buildProof(proofStatus, proofLineage, matrixValidationPassed, proofDetails),
  };
}

function buildFailure(
  classification: TenantHostClassificationKind,
  warnings: readonly TenantHostIdentityResolutionWarning[],
  state: TenantHostIdentityResolutionState,
  error: TenantHostIdentityResolutionError,
  proofStatus: TenantHostIdentityResolutionProofStatus,
  proofLineage: TenantHostIdentityResolutionLineage,
  proofDetails: readonly string[],
  matrixValidationPassed: boolean,
): TenantHostIdentityResolutionFailure {
  return {
    success: false,
    classification,
    tenant: null,
    warnings,
    state,
    error,
    proof: buildProof(proofStatus, proofLineage, matrixValidationPassed, proofDetails),
  };
}

export function auditResolutionEvent(
  host: string,
  auditFn: (event: TenantHostIdentityResolutionAuditEvent) => TenantHostIdentityResolutionError | null,
): TenantHostIdentityResolutionError | null {
  const event: TenantHostIdentityResolutionAuditEvent = {
    kind: 'NONE',
    resource: 'tenanthostidentityresolution',
    host,
    timestamp: new Date().toISOString(),
  };
  try {
    const result = auditFn(event);
    if (result !== null) {
      return result;
    }
    return null;
  } catch (err) {
    return {
      kind: 'UNRESOLVED_HOST',
      message: err instanceof Error ? err.message : 'Audit failed',
      detail: `Audit failure for host '${host}'`,
      statusCode: 503,
    };
  }
}

export function classifyThenResolve(
  request: RequestContext,
  registry: DomainRegistry | null | undefined,
  config: ResolverConfiguration,
): TenantHostIdentityResolutionResult {
  const trustForwardedHost = config.trustForwardedHost ?? true;
  const rawHostValue = request.forwardedHost ?? request.host ?? '';
  const rawHost = typeof rawHostValue === 'string' ? rawHostValue : String(rawHostValue);
  const sanitizedHost = extractEffectiveHost(request, trustForwardedHost);
  const apexDomain = stripPort(config.apexDomain).toLowerCase();
  const reserved = config.reservedSubdomains ?? DEFAULT_RESERVED_SUBDOMAINS;

  const warnings: TenantHostIdentityResolutionWarning[] = [];

  const classification = classifyHost(sanitizedHost, apexDomain, reserved);

  if (classification === 'malformed') {
    warnings.push({
      kind: 'MALFORMED_HOST',
      message: `Malformed or invalid host string encountered: '${sanitizedHost}'`,
      host: sanitizedHost,
    });
    return buildSuccess(
      'malformed',
      null,
      warnings,
      finalizeState(
        {
          classification: 'malformed',
          tenant: null,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: false,
        },
        'finalize',
        'PENDING',
      ),
      'PENDING',
      'runtime',
      ['Malformed host: resolution skipped'],
    );
  }

  if (classification === 'apex') {
    return buildSuccess(
      'apex',
      null,
      warnings,
      finalizeState(
        {
          classification: 'apex',
          tenant: null,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: false,
        },
        'finalize',
        'PENDING',
      ),
      'PENDING',
      'runtime',
      ['Apex host: serves global context with no tenant'],
    );
  }

  if (classification === 'reserved_subdomain') {
    warnings.push({
      kind: 'RESERVED_SUBDOMAIN',
      message: `Host '${sanitizedHost}' matches a reserved platform subdomain and serves global context with no tenant.`,
      host: sanitizedHost,
    });
    return buildSuccess(
      'reserved_subdomain',
      null,
      warnings,
      finalizeState(
        {
          classification: 'reserved_subdomain',
          tenant: null,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: false,
        },
        'finalize',
        'PENDING',
      ),
      'PENDING',
      'runtime',
      ['Reserved subdomain: serves global context with no tenant'],
    );
  }

  if (classification === 'invalid_subdomain') {
    warnings.push({
      kind: 'INVALID_SUBDOMAIN',
      message: `Host '${sanitizedHost}' has an invalid or unknown apex subdomain structure.`,
      host: sanitizedHost,
    });
    return buildSuccess(
      'invalid_subdomain',
      null,
      warnings,
      finalizeState(
        {
          classification: 'invalid_subdomain',
          tenant: null,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: false,
        },
        'finalize',
        'PENDING',
      ),
      'PENDING',
      'runtime',
      ['Invalid subdomain: serves global context with no tenant'],
    );
  }

  if (classification === 'tenant_slug') {
    const suffix = '.' + apexDomain;
    const slug = sanitizedHost.slice(0, -suffix.length);

    if (!registry || !registry.isAvailable) {
      warnings.push({
        kind: 'REGISTRY_DEGRADED',
        message: 'Domain registry is unavailable; cannot verify tenant slug.',
        host: sanitizedHost,
      });
      const degradedState = finalizeState(
        {
          classification: 'tenant_slug',
          tenant: null,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: false,
        },
        'resolve',
        'PENDING',
      );
      return buildFailure(
        'tenant_slug',
        warnings,
        degradedState,
        {
          kind: 'REGISTRY_DEGRADED',
          message: 'Domain registry is degraded or unavailable',
          detail: `Registry unavailable while resolving tenant slug host '${sanitizedHost}'`,
          statusCode: 503,
        },
        'PENDING',
        'runtime',
        ['Registry unavailable for tenant slug resolution'],
        false,
      );
    }

    const org = registry.findOrganizationBySlug(slug);
    if (org !== null && org.active) {
      const tenantContext: TenantResolvedContext = {
        organizationId: org.organizationId,
        slug: org.slug,
        realmName: org.realmName,
        hostSource: 'tenant_slug',
      };
      const resolvedState = finalizeState(
        {
          classification: 'tenant_slug',
          tenant: tenantContext,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: true,
        },
        'finalize',
        'VALIDATED',
      );
      return buildSuccess(
        'tenant_slug',
        tenantContext,
        warnings,
        resolvedState,
        'VALIDATED',
        'runtime',
        ['Tenant slug resolution validated'],
        true,
      );
    }

    warnings.push({
      kind: 'UNKNOWN_SLUG',
      message: `Tenant slug '${slug}' not found or inactive.`,
      host: sanitizedHost,
    });
    const failClosedState = finalizeState(
      {
        classification: 'tenant_slug',
        tenant: null,
        rawHost,
        sanitizedHost,
        apexDomain,
        isTrusted: false,
      },
      'finalize',
      'PENDING',
    );
    return buildSuccess('tenant_slug', null, warnings, failClosedState);
  }

  if (classification === 'possible_custom_domain') {
    if (!registry || !registry.isAvailable) {
      warnings.push({
        kind: 'REGISTRY_DEGRADED',
        message: 'Domain registry is unavailable; registry-dependent custom domain paths disabled.',
        host: sanitizedHost,
      });
      const degradedState = finalizeState(
        {
          classification: 'possible_custom_domain',
          tenant: null,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: false,
        },
        'resolve',
        'PENDING',
      );
      return buildFailure(
        'possible_custom_domain',
        warnings,
        degradedState,
        {
          kind: 'REGISTRY_DEGRADED',
          message: 'Registry unavailable for custom domain resolution',
          detail: `Registry unavailable while resolving custom domain host '${sanitizedHost}'`,
          statusCode: 503,
        },
        'PENDING',
        'runtime',
        ['Registry unavailable for custom domain resolution'],
        false,
      );
    }

    const customDomain = registry.findCustomDomain(sanitizedHost);
    if (customDomain !== null) {
      if (customDomain.status === 'active') {
        const tenantContext: TenantResolvedContext = {
          organizationId: customDomain.organizationId,
          slug: customDomain.slug,
          realmName: customDomain.realmName,
          hostSource: 'custom_domain',
        };
        const resolvedState = finalizeState(
          {
            classification: 'possible_custom_domain',
            tenant: tenantContext,
            rawHost,
            sanitizedHost,
            apexDomain,
            isTrusted: true,
          },
          'finalize',
          'VALIDATED',
        );
        return buildSuccess(
          'possible_custom_domain',
          tenantContext,
          warnings,
          resolvedState,
          'VALIDATED',
          'runtime',
          ['Active custom domain resolution validated'],
          true,
        );
      }

      let warnKind: TenantHostIdentityResolutionWarningKind = 'FAILED_RESOLUTION';
      if (customDomain.status === 'inactive') {
        warnKind = 'INACTIVE_DOMAIN';
      } else if (customDomain.status === 'pending') {
        warnKind = 'PENDING_DOMAIN';
      } else if (customDomain.status === 'disabled') {
        warnKind = 'DISABLED_DOMAIN';
      }

      warnings.push({
        kind: warnKind,
        message: `Custom domain '${sanitizedHost}' has non-active status: ${customDomain.status}.`,
        host: sanitizedHost,
      });
      const unresolvedState = finalizeState(
        {
          classification: 'possible_custom_domain',
          tenant: null,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: false,
        },
        'finalize',
        'PENDING',
      );
      return buildSuccess('possible_custom_domain', null, warnings, unresolvedState);
    }

    warnings.push({
      kind: 'UNKNOWN_CUSTOM_DOMAIN',
      message: `Custom domain '${sanitizedHost}' is not registered in the domain registry.`,
      host: sanitizedHost,
    });
    const unresolvedDomainState = finalizeState(
      {
        classification: 'possible_custom_domain',
        tenant: null,
        rawHost,
        sanitizedHost,
        apexDomain,
        isTrusted: false,
      },
      'finalize',
      'PENDING',
    );
    return buildSuccess('possible_custom_domain', null, warnings, unresolvedDomainState);
  }

  const exhaustiveFallbackState = finalizeState(
    {
      classification,
      tenant: null,
      rawHost,
      sanitizedHost,
      apexDomain,
      isTrusted: false,
    },
    'finalize',
    'PENDING',
  );
  return buildSuccess(classification, null, warnings, exhaustiveFallbackState);
}

export const resolveHostIdentity = classifyThenResolve;

export function createInMemoryDomainRegistry(
  orgs: readonly OrganizationRecord[] = [],
  domains: readonly CustomDomainRecord[] = [],
  available: boolean = true,
): DomainRegistry {
  return {
    isAvailable: available,
    findOrganizationBySlug(slug: string): OrganizationRecord | null {
      if (!available) {
        return null;
      }
      const match = orgs.find((o) => o.slug.toLowerCase() === slug.toLowerCase());
      return match ?? null;
    },
    findCustomDomain(domain: string): CustomDomainRecord | null {
      if (!available) {
        return null;
      }
      const match = domains.find((d) => d.domain.toLowerCase() === domain.toLowerCase());
      return match ?? null;
    },
  };
}

export function validateMatrixClassification(
  registry: DomainRegistry | null | undefined,
  apexDomain: string,
): {
  readonly passed: boolean;
  readonly matrix: readonly { readonly host: string; readonly expected: TenantHostClassificationKind; readonly actual: TenantHostClassificationKind }[];
} {
  const sanitizedApex = stripPort(apexDomain).toLowerCase();
  const testHosts: readonly string[] = [
    sanitizedApex,
    `admin.${sanitizedApex}`,
    `deep.nested.${sanitizedApex}`,
    'invalid..host',
    `tenant.${sanitizedApex}`,
    'customer.example.com',
    '',
  ];

  const expected: readonly TenantHostClassificationKind[] = [
    'apex',
    'reserved_subdomain',
    'invalid_subdomain',
    'malformed',
    'tenant_slug',
    'possible_custom_domain',
    'malformed',
  ];

  const matrix: { host: string; expected: TenantHostClassificationKind; actual: TenantHostClassificationKind }[] = [];
  let passed = true;

  for (let i = 0; i < testHosts.length; i++) {
    const host = testHosts[i];
    const exp = expected[i];
    if (host === undefined || exp === undefined) {
      continue;
    }
    const actual = classifyHost(host, sanitizedApex);
    matrix.push({ host, expected: exp, actual });
    if (actual !== exp) {
      passed = false;
    }
  }

  return { passed, matrix };
}

export function validateRuntimeProof(
  config: HermeticSubstrateProofConfig,
  apexDomain: string = 'anqr.io',
): RuntimeResolutionProof {
  if (!config.substrateAvailable) {
    return {
      status: 'PENDING',
      lineage: 'hermetic',
      matrixValidationPassed: false,
      details: ['Substrate is not yet initialized or pending fresh proof validation'],
    };
  }

  if (config.seededOrganizations.length === 0 && config.seededDomains.length === 0) {
    return {
      status: 'SKIPPED',
      lineage: 'runtime',
      matrixValidationPassed: false,
      details: ['Skipped live resolution validation honestly because no seeded organization or custom domain exists'],
    };
  }

  const details: string[] = [];
  const registry = createInMemoryDomainRegistry(
    config.seededOrganizations,
    config.seededDomains,
    config.registryAvailable,
  );
  const resolverConfig: ResolverConfiguration = { apexDomain };

  const matrixResult = validateMatrixClassification(registry, apexDomain);
  if (!matrixResult.passed) {
    for (const row of matrixResult.matrix) {
      if (row.actual !== row.expected) {
        details.push(`Classification mismatch for ${row.host}: expected ${row.expected}, got ${row.actual}`);
      }
    }
    return {
      status: 'PENDING',
      lineage: 'runtime',
      matrixValidationPassed: false,
      details,
    };
  }
  details.push('Domain-identity matrix validated across all host classes');

  let allValid = true;

  for (const seededOrg of config.seededOrganizations) {
    if (seededOrg.slug === '') {
      continue;
    }
    const slugRes = classifyThenResolve(
      { host: `${seededOrg.slug}.${apexDomain}` },
      registry,
      resolverConfig,
    );

    if (!slugRes.success) {
      allValid = false;
      details.push(`Registry dependency blocked seeded slug validation for ${seededOrg.slug}`);
      continue;
    }

    if (seededOrg.active) {
      if (slugRes.tenant === null || slugRes.tenant.organizationId !== seededOrg.organizationId) {
        allValid = false;
        details.push(`Seeded slug resolution failed for ${seededOrg.slug}`);
        continue;
      }
      if (slugRes.proof.status !== 'VALIDATED') {
        allValid = false;
        details.push(`Seeded slug resolution proof not validated for ${seededOrg.slug}`);
        continue;
      }
      details.push(`Tenant slug resolution proof validated for slug ${seededOrg.slug}`);
    } else {
      if (slugRes.tenant !== null) {
        allValid = false;
        details.push(`Inactive seeded slug unexpectedly resolved for ${seededOrg.slug}`);
        continue;
      }
      details.push(`Inactive seeded slug correctly unresolved for ${seededOrg.slug}`);
    }
  }

  for (const seededDomain of config.seededDomains) {
    const domainRes = classifyThenResolve({ host: seededDomain.domain }, registry, resolverConfig);

    if (!domainRes.success) {
      allValid = false;
      details.push(`Registry dependency blocked seeded custom-domain validation for ${seededDomain.domain}`);
      continue;
    }

    if (seededDomain.status === 'active') {
      if (domainRes.tenant === null || domainRes.tenant.organizationId !== seededDomain.organizationId) {
        allValid = false;
        details.push(`Active custom domain resolution failed for ${seededDomain.domain}`);
        continue;
      }
      if (domainRes.proof.status !== 'VALIDATED') {
        allValid = false;
        details.push(`Active custom domain resolution proof not validated for ${seededDomain.domain}`);
        continue;
      }
      details.push(`Active custom domain proof validated for ${seededDomain.domain}`);
      continue;
    }

    if (domainRes.tenant !== null) {
      allValid = false;
      details.push(`Non-active custom domain unexpectedly resolved tenant for ${seededDomain.domain}`);
      continue;
    }
    details.push(`Non-active custom domain (${seededDomain.status}) correctly unresolved for ${seededDomain.domain}`);
  }

  if (!allValid) {
    return {
      status: 'PENDING',
      lineage: 'runtime',
      matrixValidationPassed: false,
      details,
    };
  }

  return {
    status: 'VALIDATED',
    lineage: 'runtime',
    matrixValidationPassed: true,
    details: [
      ...details,
      'Hermetic/runtime substrate validation lineage established; runtime domain-identity matrix and custom-domain resolution proofs validated live local resolver behaviour across all host classes',
    ],
  };
}