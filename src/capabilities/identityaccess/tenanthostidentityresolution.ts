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

export interface TenantHostIdentityResolutionSuccess {
  readonly success: true;
  readonly classification: TenantHostClassificationKind;
  readonly tenant: TenantResolvedContext | null;
  readonly warnings: readonly TenantHostIdentityResolutionWarning[];
  readonly state: TenantHostIdentityResolutionState;
  readonly error: null;
}

export interface TenantHostIdentityResolutionFailure {
  readonly success: false;
  readonly classification: TenantHostClassificationKind;
  readonly tenant: null;
  readonly warnings: readonly TenantHostIdentityResolutionWarning[];
  readonly state: TenantHostIdentityResolutionState;
  readonly error: TenantHostIdentityResolutionError;
}

export type TenantHostIdentityResolutionResult =
  | TenantHostIdentityResolutionSuccess
  | TenantHostIdentityResolutionFailure;

export interface GlobalRouteRejection {
  readonly rejected: true;
  readonly reason: 'APEX_SUBDOMAIN_REJECTED';
  readonly detail: string;
  readonly statusCode: 400;
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
  readonly lineage: 'hermetic' | 'runtime';
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

function isValidHostSyntax(host: string): boolean {
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

function isValidSubdomainSlug(slug: string): boolean {
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
  if (!sanitizedHost || !isValidHostSyntax(sanitizedHost)) {
    return 'malformed';
  }

  const normalizedApex = stripPort(apexDomain).toLowerCase();
  if (sanitizedHost === normalizedApex) {
    return 'apex';
  }

  const suffix = '.' + normalizedApex;
  if (sanitizedHost.endsWith(suffix)) {
    const prefix = sanitizedHost.slice(0, -suffix.length);
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
  };
}

export function resolveHostIdentity(
  request: RequestContext,
  registry: DomainRegistry | null | undefined,
  config: ResolverConfiguration,
): TenantHostIdentityResolutionResult {
  const rawHost = request.forwardedHost ?? request.host ?? '';
  const sanitizedHost = extractEffectiveHost(request, config.trustForwardedHost ?? true);
  const apexDomain = stripPort(config.apexDomain).toLowerCase();
  const reserved = config.reservedSubdomains ?? DEFAULT_RESERVED_SUBDOMAINS;

  const warnings: TenantHostIdentityResolutionWarning[] = [];

  const classification = classifyHost(sanitizedHost, apexDomain, reserved);

  const isTrustedClassification = classification === 'tenant_slug' || classification === 'possible_custom_domain';

  if (!isTrustedClassification) {
    const untrustedState: TenantHostIdentityResolutionState = {
      classification,
      tenant: null,
      rawHost,
      sanitizedHost,
      apexDomain,
      isTrusted: false,
    };

    if (classification === 'malformed') {
      warnings.push({
        kind: 'MALFORMED_HOST',
        message: `Malformed or invalid host string encountered: '${sanitizedHost}'`,
        host: sanitizedHost,
      });
      return {
        success: true,
        classification: 'malformed',
        tenant: null,
        warnings,
        state: untrustedState,
        error: null,
      };
    }

    if (classification === 'reserved_subdomain') {
      warnings.push({
        kind: 'RESERVED_SUBDOMAIN',
        message: `Host '${sanitizedHost}' matches a reserved platform subdomain and serves global context with no tenant.`,
        host: sanitizedHost,
      });
      return {
        success: true,
        classification: 'reserved_subdomain',
        tenant: null,
        warnings,
        state: untrustedState,
        error: null,
      };
    }

    if (classification === 'invalid_subdomain') {
      warnings.push({
        kind: 'INVALID_SUBDOMAIN',
        message: `Host '${sanitizedHost}' has an invalid or unknown apex subdomain structure.`,
        host: sanitizedHost,
      });
      return {
        success: true,
        classification: 'invalid_subdomain',
        tenant: null,
        warnings,
        state: untrustedState,
        error: null,
      };
    }

    if (classification === 'apex') {
      return {
        success: true,
        classification: 'apex',
        tenant: null,
        warnings,
        state: untrustedState,
        error: null,
      };
    }

    return {
      success: true,
      classification,
      tenant: null,
      warnings,
      state: untrustedState,
      error: null,
    };
  }

  if (classification === 'tenant_slug') {
    const suffix = '.' + apexDomain;
    const slug = sanitizedHost.slice(0, -suffix.length);

    if (!registry || !registry.isAvailable) {
      const degradedState: TenantHostIdentityResolutionState = {
        classification: 'tenant_slug',
        tenant: null,
        rawHost,
        sanitizedHost,
        apexDomain,
        isTrusted: false,
      };
      warnings.push({
        kind: 'REGISTRY_DEGRADED',
        message: 'Domain registry is unavailable; cannot verify tenant slug.',
        host: sanitizedHost,
      });
      return {
        success: false,
        classification: 'tenant_slug',
        tenant: null,
        warnings,
        state: degradedState,
        error: {
          kind: 'REGISTRY_DEGRADED',
          message: 'Domain registry is degraded or unavailable',
          statusCode: 503,
        },
      };
    }

    const org = registry.findOrganizationBySlug(slug);
    if (org && org.active) {
      const tenantContext: TenantResolvedContext = {
        organizationId: org.organizationId,
        slug: org.slug,
        realmName: org.realmName,
        hostSource: 'tenant_slug',
      };
      const resolvedState: TenantHostIdentityResolutionState = {
        classification: 'tenant_slug',
        tenant: tenantContext,
        rawHost,
        sanitizedHost,
        apexDomain,
        isTrusted: true,
      };
      return {
        success: true,
        classification: 'tenant_slug',
        tenant: tenantContext,
        warnings,
        state: resolvedState,
        error: null,
      };
    }

    const failClosedState: TenantHostIdentityResolutionState = {
      classification: 'tenant_slug',
      tenant: null,
      rawHost,
      sanitizedHost,
      apexDomain,
      isTrusted: false,
    };
    warnings.push({
      kind: 'UNKNOWN_SLUG',
      message: `Tenant slug '${slug}' not found or inactive.`,
      host: sanitizedHost,
    });
    return {
      success: true,
      classification: 'tenant_slug',
      tenant: null,
      warnings,
      state: failClosedState,
      error: null,
    };
  }

  if (classification === 'possible_custom_domain') {
    if (!registry || !registry.isAvailable) {
      const degradedState: TenantHostIdentityResolutionState = {
        classification: 'possible_custom_domain',
        tenant: null,
        rawHost,
        sanitizedHost,
        apexDomain,
        isTrusted: false,
      };
      warnings.push({
        kind: 'REGISTRY_DEGRADED',
        message: 'Domain registry is unavailable; registry-dependent custom domain paths disabled.',
        host: sanitizedHost,
      });
      return {
        success: false,
        classification: 'possible_custom_domain',
        tenant: null,
        warnings,
        state: degradedState,
        error: {
          kind: 'REGISTRY_DEGRADED',
          message: 'Registry unavailable for custom domain resolution',
          statusCode: 503,
        },
      };
    }

    const customDomain = registry.findCustomDomain(sanitizedHost);
    if (customDomain) {
      if (customDomain.status === 'active') {
        const tenantContext: TenantResolvedContext = {
          organizationId: customDomain.organizationId,
          slug: customDomain.slug,
          realmName: customDomain.realmName,
          hostSource: 'custom_domain',
        };
        const resolvedState: TenantHostIdentityResolutionState = {
          classification: 'possible_custom_domain',
          tenant: tenantContext,
          rawHost,
          sanitizedHost,
          apexDomain,
          isTrusted: true,
        };
        return {
          success: true,
          classification: 'possible_custom_domain',
          tenant: tenantContext,
          warnings,
          state: resolvedState,
          error: null,
        };
      }

      let warnKind: TenantHostIdentityResolutionWarningKind = 'FAILED_RESOLUTION';
      if (customDomain.status === 'inactive') {
        warnKind = 'INACTIVE_DOMAIN';
      } else if (customDomain.status === 'pending') {
        warnKind = 'PENDING_DOMAIN';
      } else if (customDomain.status === 'disabled') {
        warnKind = 'DISABLED_DOMAIN';
      }

      const unresolvedState: TenantHostIdentityResolutionState = {
        classification: 'possible_custom_domain',
        tenant: null,
        rawHost,
        sanitizedHost,
        apexDomain,
        isTrusted: false,
      };
      warnings.push({
        kind: warnKind,
        message: `Custom domain '${sanitizedHost}' has non-active status: ${customDomain.status}.`,
        host: sanitizedHost,
      });
      return {
        success: true,
        classification: 'possible_custom_domain',
        tenant: null,
        warnings,
        state: unresolvedState,
        error: null,
      };
    }

    const unresolvedDomainState: TenantHostIdentityResolutionState = {
      classification: 'possible_custom_domain',
      tenant: null,
      rawHost,
      sanitizedHost,
      apexDomain,
      isTrusted: false,
    };
    warnings.push({
      kind: 'UNKNOWN_CUSTOM_DOMAIN',
      message: `Custom domain '${sanitizedHost}' is not registered in the domain registry.`,
      host: sanitizedHost,
    });
    return {
      success: true,
      classification: 'possible_custom_domain',
      tenant: null,
      warnings,
      state: unresolvedDomainState,
      error: null,
    };
  }

  const exhaustiveFallbackState: TenantHostIdentityResolutionState = {
    classification,
    tenant: null,
    rawHost,
    sanitizedHost,
    apexDomain,
    isTrusted: false,
  };
  return {
    success: true,
    classification,
    tenant: null,
    warnings,
    state: exhaustiveFallbackState,
    error: null,
  };
}

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

export function validateRuntimeProof(
  config: HermeticSubstrateProofConfig,
  apexDomain: string = 'anqr.io',
): RuntimeResolutionProof {
  const details: string[] = [];

  if (!config.substrateAvailable) {
    return {
      status: 'PENDING',
      lineage: 'runtime',
      matrixValidationPassed: false,
      details: ['Substrate is not yet initialized or pending fresh proof validation'],
    };
  }

  if (config.seededOrganizations.length === 0) {
    return {
      status: 'SKIPPED',
      lineage: 'runtime',
      matrixValidationPassed: false,
      details: ['Skipped live resolution validation honestly because no seeded organization exists'],
    };
  }

  const registry = createInMemoryDomainRegistry(
    config.seededOrganizations,
    config.seededDomains,
    config.registryAvailable,
  );
  const resolverConfig: ResolverConfiguration = { apexDomain };

  const testClasses: readonly { readonly host: string; readonly expectedClass: TenantHostClassificationKind }[] = [
    { host: apexDomain, expectedClass: 'apex' },
    { host: `admin.${apexDomain}`, expectedClass: 'reserved_subdomain' },
    { host: `deep.nested.${apexDomain}`, expectedClass: 'invalid_subdomain' },
    { host: 'invalid..host', expectedClass: 'malformed' },
    { host: `${config.seededOrganizations[0]?.slug ?? 'tenant'}.${apexDomain}`, expectedClass: 'tenant_slug' },
    { host: 'customer.example.com', expectedClass: 'possible_custom_domain' },
  ];

  let matrixPassed = true;
  for (const testCase of testClasses) {
    const result = resolveHostIdentity({ host: testCase.host }, registry, resolverConfig);
    if (result.classification !== testCase.expectedClass) {
      matrixPassed = false;
      details.push(`Classification mismatch for ${testCase.host}: expected ${testCase.expectedClass}, got ${result.classification}`);
    }
  }

  const seededSlug = config.seededOrganizations[0]?.slug;
  if (seededSlug) {
    const slugRes = resolveHostIdentity({ host: `${seededSlug}.${apexDomain}` }, registry, resolverConfig);
    if (!slugRes.tenant || slugRes.tenant.slug !== seededSlug) {
      matrixPassed = false;
      details.push(`Seeded slug resolution failed for ${seededSlug}`);
    }
  }

  if (config.seededDomains.length > 0) {
    const activeDomain = config.seededDomains.find((d) => d.status === 'active');
    if (activeDomain) {
      const activeRes = resolveHostIdentity({ host: activeDomain.domain }, registry, resolverConfig);
      if (!activeRes.tenant || activeRes.tenant.organizationId !== activeDomain.organizationId) {
        matrixPassed = false;
        details.push(`Active custom domain resolution failed for ${activeDomain.domain}`);
      }
    }
    const inactiveDomain = config.seededDomains.find((d) => d.status !== 'active');
    if (inactiveDomain) {
      const inactiveRes = resolveHostIdentity({ host: inactiveDomain.domain }, registry, resolverConfig);
      if (inactiveRes.tenant !== null) {
        matrixPassed = false;
        details.push(`Non-active custom domain unexpectedly resolved tenant for ${inactiveDomain.domain}`);
      }
    }
  }

  return {
    status: matrixPassed ? 'VALIDATED' : 'PENDING',
    lineage: 'hermetic',
    matrixValidationPassed: matrixPassed,
    details: matrixPassed ? ['All host classes and custom domain proofs verified hermetically'] : details,
  };
}