export const CustomDomainDnsOwnershipTlsCanonicalOutcome = [
  'SUCCESS',
  'INVALID_DOMAIN',
  'DOMAIN_ALREADY_CLAIMED',
  'NOT_FOUND',
  'EXPIRED',
  'ALREADY_VERIFIED',
  'DNS_NOT_FOUND',
  'DNS_MISMATCH',
  'NOT_VERIFIED',
  'AUTH_CLIENT_INACTIVE',
  'ROUTING_NOT_PROVEN',
  'NOT_ACTIVE',
  'PERMISSION_DENIED',
  'AUDIT_FAILURE',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalOutcome = typeof CustomDomainDnsOwnershipTlsCanonicalOutcome[number];

export const CustomDomainDnsOwnershipTlsCanonicalAuditEventKind = [
  'CHALLENGE_CREATED',
  'CONFLICT_REJECTED',
  'VERIFICATION',
  'AUTH_CLIENT_ACTIVATED',
  'AUTH_CLIENT_DEACTIVATED',
  'LOCAL_ROUTING_PROOF',
  'CANONICAL_SET',
  'CANONICAL_UNSET',
  'DOMAIN_DISABLED',
  'DOMAIN_DEACTIVATED',
  'PERMISSION_DENIED',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalAuditEventKind = typeof CustomDomainDnsOwnershipTlsCanonicalAuditEventKind[number];

export const CustomDomainDnsOwnershipTlsCanonicalReadiness = [
  'NO_DOMAINS',
  'PENDING_DNS',
  'VERIFIED',
  'INACTIVE_AUTH_CLIENT',
  'LOCALLY_ROUTED',
  'DEFERRED_PUBLIC_DNS_TLS',
  'CANONICAL_REDIRECT_CUTOVER',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalReadiness = typeof CustomDomainDnsOwnershipTlsCanonicalReadiness[number];

export const CustomDomainDnsOwnershipTlsCanonicalOwnershipStatus = [
  'PENDING_DNS',
  'DNS_MISMATCH',
  'VERIFIED',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalOwnershipStatus = typeof CustomDomainDnsOwnershipTlsCanonicalOwnershipStatus[number];

export const CustomDomainDnsOwnershipTlsCanonicalAuthClientStatus = [
  'INACTIVE',
  'ACTIVE',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalAuthClientStatus = typeof CustomDomainDnsOwnershipTlsCanonicalAuthClientStatus[number];

export const CustomDomainDnsOwnershipTlsCanonicalRoutingStatus = [
  'UNKNOWN',
  'LOCALLY_ACTIVE',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalRoutingStatus = typeof CustomDomainDnsOwnershipTlsCanonicalRoutingStatus[number];

export const CustomDomainDnsOwnershipTlsCanonicalTlsStatus = [
  'UNKNOWN',
  'DEFERRED',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalTlsStatus = typeof CustomDomainDnsOwnershipTlsCanonicalTlsStatus[number];

export const CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy = [
  'NO_REDIRECT',
  'REDIRECT_SLUG_TO_CANONICAL',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy = typeof CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy[number];

export const CustomDomainDnsOwnershipTlsCanonicalPermission = [
  'DOMAIN_READ',
  'DOMAIN_WRITE',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalPermission = typeof CustomDomainDnsOwnershipTlsCanonicalPermission[number];

export interface CustomDomainDnsOwnershipTlsCanonicalAuditEvent {
  readonly kind: CustomDomainDnsOwnershipTlsCanonicalAuditEventKind;
  readonly domain: string;
  readonly tenant: string;
  readonly timestamp: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface CustomDomainDnsOwnershipTlsCanonicalError {
  readonly outcome: CustomDomainDnsOwnershipTlsCanonicalOutcome;
  readonly message: string;
}

export interface CustomDomainDnsOwnershipTlsCanonicalSuccess {
  readonly outcome: 'SUCCESS';
}

export interface CustomDomainDnsOwnershipTlsCanonicalChallengeToken {
  readonly token: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CustomDomainDnsOwnershipTlsCanonicalDomainRecord {
  readonly domain: string;
  readonly tenant: string;
  readonly ownershipStatus: CustomDomainDnsOwnershipTlsCanonicalOwnershipStatus;
  readonly authClientStatus: CustomDomainDnsOwnershipTlsCanonicalAuthClientStatus;
  readonly routingStatus: CustomDomainDnsOwnershipTlsCanonicalRoutingStatus;
  readonly tlsStatus: CustomDomainDnsOwnershipTlsCanonicalTlsStatus;
  readonly canonical: boolean;
  readonly redirectPolicy: CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
  readonly activatedAt: string | null;
  readonly routedAt: string | null;
  readonly canonicalSetAt: string | null;
  readonly disabled: boolean;
  readonly challengeTokens: readonly CustomDomainDnsOwnershipTlsCanonicalChallengeToken[];
}

export interface CustomDomainDnsOwnershipTlsCanonicalTenantPermissions {
  readonly tenant: string;
  readonly permissions: ReadonlySet<CustomDomainDnsOwnershipTlsCanonicalPermission>;
}

export interface CustomDomainDnsOwnershipTlsCanonicalState {
  readonly domains: readonly CustomDomainDnsOwnershipTlsCanonicalDomainRecord[];
  readonly publicDnsVerified: boolean;
  readonly tlsProvisioned: boolean;
  readonly tenantPermissions: readonly CustomDomainDnsOwnershipTlsCanonicalTenantPermissions[];
}

export interface CustomDomainDnsOwnershipTlsCanonicalAuthClientPort {
  readonly activate: (domain: string, tenant: string) => boolean;
  readonly deactivate: (domain: string, tenant: string) => boolean;
}

export interface CustomDomainDnsOwnershipTlsCanonicalDnsChallengePort {
  readonly lookupTxt: (domain: string) => readonly string[];
}

export interface CustomDomainDnsOwnershipTlsCanonicalRoutingProbePort {
  readonly probe: (domain: string, tenant: string) => boolean;
}

export type CustomDomainDnsOwnershipTlsCanonicalAuditFn = (
  event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent,
) => null;

export type CustomDomainDnsOwnershipTlsCanonicalPermissionChecker = (
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  permission: CustomDomainDnsOwnershipTlsCanonicalPermission,
) => boolean;

export interface CustomDomainDnsOwnershipTlsCanonicalTenantDomainPort {
  readonly createChallenge: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly verifyDns: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    expectedToken: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly verifyDnsWithLookup: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    dnsPort: CustomDomainDnsOwnershipTlsCanonicalDnsChallengePort,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly activateAuthClient: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    authClientPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly deactivateAuthClient: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    authClientPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly proveLocalRouting: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly proveLocalRoutingWithProbe: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    routingProbePort: CustomDomainDnsOwnershipTlsCanonicalRoutingProbePort,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly setCanonical: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly unsetCanonical: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly disableDomain: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly deactivateDomain: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    domain: string,
    tenant: string,
    authClientPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly listDomains: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    tenant: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => readonly CustomDomainDnsOwnershipTlsCanonicalDomainRecord[] | CustomDomainDnsOwnershipTlsCanonicalError;
  readonly getReadiness: (
    state: CustomDomainDnsOwnershipTlsCanonicalState,
    tenant: string,
    auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  ) => CustomDomainDnsOwnershipTlsCanonicalReadiness | CustomDomainDnsOwnershipTlsCanonicalError;
}

export const initialState: CustomDomainDnsOwnershipTlsCanonicalState = {
  domains: [],
  publicDnsVerified: false,
  tlsProvisioned: false,
  tenantPermissions: [],
};

export const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

const DOMAIN_LABEL_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/;

export function isValidDomain(domain: string): boolean {
  if (typeof domain !== 'string') return false;
  if (domain.length === 0 || domain.length > 253) return false;
  if (/[^a-zA-Z0-9.\-]/.test(domain)) return false;
  if (domain.startsWith('-') || domain.endsWith('-')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  const parts = domain.split('.');
  if (parts.some((part) => part.length === 0)) return false;
  if (parts.some((part) => part.length > 63)) return false;
  if (/^\[.*\]$/.test(domain)) return false;
  if (/^[0-9]+(\.[0-9]+){3}$/.test(domain)) return false;
  if (parts.every((part) => /^[0-9]+$/.test(part))) return false;
  for (const part of parts) {
    if (!DOMAIN_LABEL_RE.test(part)) return false;
  }
  return true;
}

function asState(value: unknown): CustomDomainDnsOwnershipTlsCanonicalState {
  if (value === null || typeof value !== 'object') {
    return initialState;
  }
  const v = value as Record<string, unknown>;
  const domains = Array.isArray(v.domains) ? v.domains : [];
  const tenantPermissions = Array.isArray(v.tenantPermissions) ? v.tenantPermissions : [];
  return {
    domains: domains as readonly CustomDomainDnsOwnershipTlsCanonicalDomainRecord[],
    publicDnsVerified: typeof v.publicDnsVerified === 'boolean' ? v.publicDnsVerified : false,
    tlsProvisioned: typeof v.tlsProvisioned === 'boolean' ? v.tlsProvisioned : false,
    tenantPermissions: tenantPermissions as readonly CustomDomainDnsOwnershipTlsCanonicalTenantPermissions[],
  };
}

function findDomainRecordByTenant(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
): CustomDomainDnsOwnershipTlsCanonicalDomainRecord | null {
  return state.domains.find((d) => d.domain === domain && d.tenant === tenant) ?? null;
}

function findEnabledAnyTenantDomainRecord(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
): CustomDomainDnsOwnershipTlsCanonicalDomainRecord | null {
  return state.domains.find((d) => d.domain === domain && !d.disabled) ?? null;
}

function isChallengeTokenExpired(token: CustomDomainDnsOwnershipTlsCanonicalChallengeToken, nowIso: string): boolean {
  return token.expiresAt <= nowIso;
}

function hasUnexpiredChallengeToken(
  record: CustomDomainDnsOwnershipTlsCanonicalDomainRecord,
  nowIso: string,
): boolean {
  return record.challengeTokens.some((t) => !isChallengeTokenExpired(t, nowIso));
}

function emitAudit(
  kind: CustomDomainDnsOwnershipTlsCanonicalAuditEventKind,
  domain: string,
  tenant: string,
  metadata: Readonly<Record<string, string>>,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): boolean {
  const event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent = {
    kind,
    domain,
    tenant,
    timestamp: new Date().toISOString(),
    metadata,
  };
  try {
    const result = auditFn(event);
    return result === null;
  } catch {
    return false;
  }
}

function deniedOutcome(
  outcome: CustomDomainDnsOwnershipTlsCanonicalOutcome,
  message: string,
): CustomDomainDnsOwnershipTlsCanonicalError {
  return { outcome, message };
}

function safeDomainMetadata(domain: string, tenant: string): Readonly<Record<string, string>> {
  return {
    domain,
    tenant,
  };
}

function performAuditOrFail(
  kind: CustomDomainDnsOwnershipTlsCanonicalAuditEventKind,
  domain: string,
  tenant: string,
  metadata: Readonly<Record<string, string>>,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
  failureOutcome: CustomDomainDnsOwnershipTlsCanonicalOutcome,
  failureMessage: string,
): CustomDomainDnsOwnershipTlsCanonicalError | null {
  const ok = emitAudit(kind, domain, tenant, metadata, auditFn);
  if (!ok) {
    return deniedOutcome(failureOutcome, failureMessage);
  }
  return null;
}

export function hasDomainReadPermission(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  permission: CustomDomainDnsOwnershipTlsCanonicalPermission,
): boolean {
  if (permission !== 'DOMAIN_READ') return false;
  if (typeof tenant !== 'string' || tenant.length === 0) return false;
  const safe = asState(state);
  const tp = safe.tenantPermissions.find((p) => p.tenant === tenant);
  if (tp === undefined) return false;
  return tp.permissions.has('DOMAIN_READ');
}

export function hasDomainWritePermission(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  permission: CustomDomainDnsOwnershipTlsCanonicalPermission,
): boolean {
  if (permission !== 'DOMAIN_WRITE') return false;
  if (typeof tenant !== 'string' || tenant.length === 0) return false;
  const safe = asState(state);
  const tp = safe.tenantPermissions.find((p) => p.tenant === tenant);
  if (tp === undefined) return false;
  return tp.permissions.has('DOMAIN_WRITE');
}

export function checkDomainReadPermission(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  permission: CustomDomainDnsOwnershipTlsCanonicalPermission,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalError | null {
  if (hasDomainReadPermission(state, tenant, permission)) {
    return null;
  }
  const ok = emitAudit(
    'PERMISSION_DENIED',
    '',
    tenant,
    { tenant, phase: 'permission_denied', permission },
    auditFn,
  );
  if (!ok) {
    return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
  }
  return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:read permission');
}

export function checkDomainWritePermission(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  permission: CustomDomainDnsOwnershipTlsCanonicalPermission,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalError | null {
  if (hasDomainWritePermission(state, tenant, permission)) {
    return null;
  }
  const ok = emitAudit(
    'PERMISSION_DENIED',
    '',
    tenant,
    { tenant, phase: 'permission_denied', permission },
    auditFn,
  );
  if (!ok) {
    return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
  }
  return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
}

export function createOwnershipChallenge(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const enabledByOther = findEnabledAnyTenantDomainRecord(safe, domain);
  if (enabledByOther !== null && enabledByOther.tenant !== tenant) {
    const auditFailure = performAuditOrFail(
      'CONFLICT_REJECTED',
      domain,
      tenant,
      safeDomainMetadata(domain, tenant),
      auditFn,
      'AUDIT_FAILURE',
      'Audit failed for cross-tenant conflict',
    );
    if (auditFailure !== null) return auditFailure;
    return deniedOutcome('DOMAIN_ALREADY_CLAIMED', 'Domain already claimed by another tenant');
  }

  const now = new Date();
  const tokenId = cryptoRandomUuid();
  const token: CustomDomainDnsOwnershipTlsCanonicalChallengeToken = {
    token: tokenId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
  };

  const newRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    domain,
    tenant,
    ownershipStatus: 'PENDING_DNS',
    authClientStatus: 'INACTIVE',
    routingStatus: 'UNKNOWN',
    tlsStatus: 'UNKNOWN',
    canonical: false,
    redirectPolicy: 'NO_REDIRECT',
    createdAt: now.toISOString(),
    verifiedAt: null,
    activatedAt: null,
    routedAt: null,
    canonicalSetAt: null,
    disabled: false,
    challengeTokens: [token],
  };

  const auditFailure = performAuditOrFail(
    'CHALLENGE_CREATED',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'challenge_created' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for challenge creation',
  );
  if (auditFailure !== null) return auditFailure;

  const existingByTenant = findDomainRecordByTenant(safe, domain, tenant);
  if (existingByTenant !== null && existingByTenant.disabled) {
    const updatedDisabled: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
      ...existingByTenant,
      ownershipStatus: 'PENDING_DNS',
      authClientStatus: 'INACTIVE',
      routingStatus: 'UNKNOWN',
      canonical: false,
      canonicalSetAt: null,
      activatedAt: null,
      routedAt: null,
      redirectPolicy: 'NO_REDIRECT',
      disabled: false,
      verifiedAt: null,
      challengeTokens: [token],
      createdAt: now.toISOString(),
    };
    return {
      ...safe,
      domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedDisabled : d)),
    };
  }

  return {
    ...safe,
    domains: [...safe.domains, newRecord],
  };
}

export function verifyDnsOwnership(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  expectedToken: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (record.ownershipStatus === 'VERIFIED') {
    return deniedOutcome('ALREADY_VERIFIED', 'Domain already verified');
  }

  if (typeof expectedToken !== 'string' || expectedToken.length === 0) {
    return deniedOutcome('DNS_MISMATCH', 'Expected DNS verification token is required');
  }

  const nowIso = new Date().toISOString();
  if (!hasUnexpiredChallengeToken(record, nowIso)) {
    return deniedOutcome('EXPIRED', 'DNS challenge token has expired');
  }

  if (record.challengeTokens.length === 0) {
    return deniedOutcome('DNS_NOT_FOUND', 'No DNS challenge token exists for domain');
  }

  const tokenMatch = record.challengeTokens.some(
    (t) => t.token === expectedToken && !isChallengeTokenExpired(t, nowIso),
  );
  if (!tokenMatch) {
    return deniedOutcome('DNS_MISMATCH', 'DNS verification token mismatch');
  }

  const auditFailure = performAuditOrFail(
    'VERIFICATION',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'verified' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for DNS verification',
  );
  if (auditFailure !== null) return auditFailure;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    ownershipStatus: 'VERIFIED',
    verifiedAt: nowIso,
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function verifyDnsOwnershipWithLookup(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  dnsPort: CustomDomainDnsOwnershipTlsCanonicalDnsChallengePort,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (record.ownershipStatus === 'VERIFIED') {
    return deniedOutcome('ALREADY_VERIFIED', 'Domain already verified');
  }

  const nowIso = new Date().toISOString();
  if (!hasUnexpiredChallengeToken(record, nowIso)) {
    return deniedOutcome('EXPIRED', 'DNS challenge token has expired');
  }

  if (record.challengeTokens.length === 0) {
    return deniedOutcome('DNS_NOT_FOUND', 'No DNS challenge token exists for domain');
  }

  const txtRecords = dnsPort.lookupTxt(domain);
  if (!Array.isArray(txtRecords)) {
    return deniedOutcome('DNS_NOT_FOUND', 'DNS lookup returned no records');
  }
  const matchingToken = record.challengeTokens.find(
    (t) => txtRecords.includes(t.token) && !isChallengeTokenExpired(t, nowIso),
  );
  if (matchingToken === undefined) {
    return deniedOutcome('DNS_MISMATCH', 'Expected DNS TXT token not found');
  }

  const auditFailure = performAuditOrFail(
    'VERIFICATION',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'verified' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for DNS verification',
  );
  if (auditFailure !== null) return auditFailure;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    ownershipStatus: 'VERIFIED',
    verifiedAt: nowIso,
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function activateAuthClient(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  authClientPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (record.ownershipStatus !== 'VERIFIED') {
    return deniedOutcome('NOT_VERIFIED', 'Domain must be verified before activating auth client');
  }

  if (record.authClientStatus === 'ACTIVE') {
    return deniedOutcome('NOT_ACTIVE', 'Auth client already active');
  }

  const success = authClientPort.activate(domain, tenant);
  if (!success) {
    return deniedOutcome('AUTH_CLIENT_INACTIVE', 'Auth client activation failed');
  }

  const auditFailure = performAuditOrFail(
    'AUTH_CLIENT_ACTIVATED',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'auth_client_activated' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for auth-client activation',
  );
  if (auditFailure !== null) return auditFailure;

  const nowIso = new Date().toISOString();
  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    authClientStatus: 'ACTIVE',
    activatedAt: nowIso,
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function deactivateAuthClient(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  authClientPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (record.authClientStatus !== 'ACTIVE') {
    return deniedOutcome('NOT_ACTIVE', 'Auth client not active');
  }

  const success = authClientPort.deactivate(domain, tenant);
  if (!success) {
    return deniedOutcome('AUTH_CLIENT_INACTIVE', 'Auth client deactivation failed');
  }

  const auditFailure = performAuditOrFail(
    'AUTH_CLIENT_DEACTIVATED',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'auth_client_deactivated' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for auth-client deactivation',
  );
  if (auditFailure !== null) return auditFailure;

  const nowIso = new Date().toISOString();
  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    authClientStatus: 'INACTIVE',
    activatedAt: null,
    canonical: false,
    canonicalSetAt: null,
    routingStatus: 'UNKNOWN',
    routedAt: null,
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function proveLocalRouting(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (record.ownershipStatus !== 'VERIFIED') {
    return deniedOutcome('NOT_VERIFIED', 'Domain must be verified');
  }

  if (record.authClientStatus !== 'ACTIVE') {
    return deniedOutcome('AUTH_CLIENT_INACTIVE', 'Auth client must be active');
  }

  if (record.routingStatus === 'LOCALLY_ACTIVE') {
    return deniedOutcome('ROUTING_NOT_PROVEN', 'Routing already proven');
  }

  const auditFailure = performAuditOrFail(
    'LOCAL_ROUTING_PROOF',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'local_routing_proof' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for local routing proof',
  );
  if (auditFailure !== null) return auditFailure;

  const nowIso = new Date().toISOString();
  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    routingStatus: 'LOCALLY_ACTIVE',
    routedAt: nowIso,
    tlsStatus: 'DEFERRED',
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function proveLocalRoutingWithProbe(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  routingProbePort: CustomDomainDnsOwnershipTlsCanonicalRoutingProbePort,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (record.ownershipStatus !== 'VERIFIED') {
    return deniedOutcome('NOT_VERIFIED', 'Domain must be verified');
  }

  if (record.authClientStatus !== 'ACTIVE') {
    return deniedOutcome('AUTH_CLIENT_INACTIVE', 'Auth client must be active');
  }

  if (record.routingStatus === 'LOCALLY_ACTIVE') {
    return deniedOutcome('ROUTING_NOT_PROVEN', 'Routing already proven');
  }

  const probeOk = routingProbePort.probe(domain, tenant);
  if (!probeOk) {
    return deniedOutcome('ROUTING_NOT_PROVEN', 'Local routing probe did not prove');
  }

  const auditFailure = performAuditOrFail(
    'LOCAL_ROUTING_PROOF',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'local_routing_proof' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for local routing proof',
  );
  if (auditFailure !== null) return auditFailure;

  const nowIso = new Date().toISOString();
  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    routingStatus: 'LOCALLY_ACTIVE',
    routedAt: nowIso,
    tlsStatus: 'DEFERRED',
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function setCanonical(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (record.ownershipStatus !== 'VERIFIED') {
    return deniedOutcome('NOT_VERIFIED', 'Domain must be verified before canonical designation');
  }

  if (record.authClientStatus !== 'ACTIVE') {
    return deniedOutcome('AUTH_CLIENT_INACTIVE', 'Auth client must be active before canonical designation');
  }

  if (record.routingStatus !== 'LOCALLY_ACTIVE') {
    return deniedOutcome('ROUTING_NOT_PROVEN', 'Routing must be proven before canonical designation');
  }

  if (record.canonical) {
    return deniedOutcome('NOT_ACTIVE', 'Domain already canonical');
  }

  const auditFailure = performAuditOrFail(
    'CANONICAL_SET',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'canonical_set' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for canonical set',
  );
  if (auditFailure !== null) return auditFailure;

  const nowIso = new Date().toISOString();
  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    canonical: true,
    canonicalSetAt: nowIso,
    redirectPolicy: 'REDIRECT_SLUG_TO_CANONICAL',
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function unsetCanonical(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  if (!record.canonical) {
    return deniedOutcome('NOT_ACTIVE', 'Domain not canonical');
  }

  const auditFailure = performAuditOrFail(
    'CANONICAL_UNSET',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'canonical_unset' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for canonical unset',
  );
  if (auditFailure !== null) return auditFailure;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    canonical: false,
    canonicalSetAt: null,
    redirectPolicy: 'NO_REDIRECT',
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function deactivateDomain(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  authClientPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }

  let workingRecord = record;

  if (workingRecord.authClientStatus === 'ACTIVE') {
    const success = authClientPort.deactivate(domain, tenant);
    if (!success) {
      return deniedOutcome('AUTH_CLIENT_INACTIVE', 'Auth client deactivation failed');
    }
    const auditFailure = performAuditOrFail(
      'AUTH_CLIENT_DEACTIVATED',
      domain,
      tenant,
      { ...safeDomainMetadata(domain, tenant), phase: 'auth_client_deactivated' },
      auditFn,
      'AUDIT_FAILURE',
      'Audit failed for auth-client deactivation during domain deactivation',
    );
    if (auditFailure !== null) return auditFailure;
    workingRecord = {
      ...workingRecord,
      authClientStatus: 'INACTIVE',
      activatedAt: null,
    };
  }

  const deactivationAudit = performAuditOrFail(
    'DOMAIN_DEACTIVATED',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'domain_deactivated' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for domain deactivation',
  );
  if (deactivationAudit !== null) return deactivationAudit;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...workingRecord,
    canonical: false,
    canonicalSetAt: null,
    routingStatus: 'UNKNOWN',
    routedAt: null,
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function disableDomain(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return deniedOutcome('INVALID_DOMAIN', 'Domain name is malformed or an IP literal');
  }

  const safe = asState(state);

  if (!hasDomainWritePermission(safe, tenant, 'DOMAIN_WRITE')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_WRITE' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:write permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain already disabled');
  }

  const auditFailure = performAuditOrFail(
    'DOMAIN_DISABLED',
    domain,
    tenant,
    { ...safeDomainMetadata(domain, tenant), phase: 'domain_disabled' },
    auditFn,
    'AUDIT_FAILURE',
    'Audit failed for domain disable',
  );
  if (auditFailure !== null) return auditFailure;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    disabled: true,
    authClientStatus: 'INACTIVE',
    activatedAt: null,
    canonical: false,
    canonicalSetAt: null,
    routingStatus: 'UNKNOWN',
    routedAt: null,
  };

  return {
    ...safe,
    domains: safe.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function listDomains(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): readonly CustomDomainDnsOwnershipTlsCanonicalDomainRecord[] | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  if (!hasDomainReadPermission(safe, tenant, 'DOMAIN_READ')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      '',
      tenant,
      { tenant, phase: 'permission_denied', permission: 'DOMAIN_READ' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:read permission');
  }
  return safe.domains.filter((d) => d.tenant === tenant);
}

export function getReadiness(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalReadiness | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  if (!hasDomainReadPermission(safe, tenant, 'DOMAIN_READ')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      '',
      tenant,
      { tenant, phase: 'permission_denied', permission: 'DOMAIN_READ' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:read permission');
  }
  const domains = safe.domains.filter((d) => d.tenant === tenant);
  if (domains.length === 0) return 'NO_DOMAINS';

  const enabledDomains = domains.filter((d) => !d.disabled);
  if (enabledDomains.length === 0) return 'DEFERRED_PUBLIC_DNS_TLS';

  const pendingDomains = enabledDomains.filter(
    (d) => d.ownershipStatus === 'PENDING_DNS' || d.ownershipStatus === 'DNS_MISMATCH',
  );
  if (pendingDomains.length === enabledDomains.length) return 'PENDING_DNS';

  const verifiedDomains = enabledDomains.filter((d) => d.ownershipStatus === 'VERIFIED');
  if (verifiedDomains.length === 0) return 'PENDING_DNS';

  const activeAuthDomains = verifiedDomains.filter((d) => d.authClientStatus === 'ACTIVE');
  if (activeAuthDomains.length === 0) {
    return 'INACTIVE_AUTH_CLIENT';
  }

  const routedDomains = activeAuthDomains.filter((d) => d.routingStatus === 'LOCALLY_ACTIVE');
  if (routedDomains.length === 0) {
    return 'LOCALLY_ROUTED';
  }

  const canonicalDomains = routedDomains.filter((d) => d.canonical);
  if (canonicalDomains.length > 0) {
    return 'CANONICAL_REDIRECT_CUTOVER';
  }

  return 'LOCALLY_ROUTED';
}

export function getDomainReadiness(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalReadiness | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  if (!hasDomainReadPermission(safe, tenant, 'DOMAIN_READ')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_READ' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:read permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }

  if (record.disabled) return 'DEFERRED_PUBLIC_DNS_TLS';
  if (record.ownershipStatus === 'PENDING_DNS' || record.ownershipStatus === 'DNS_MISMATCH') {
    return 'PENDING_DNS';
  }
  if (record.ownershipStatus !== 'VERIFIED') return 'PENDING_DNS';
  if (record.authClientStatus !== 'ACTIVE') return 'INACTIVE_AUTH_CLIENT';
  if (record.routingStatus !== 'LOCALLY_ACTIVE') return 'LOCALLY_ROUTED';
  if (record.canonical) {
    return 'CANONICAL_REDIRECT_CUTOVER';
  }
  return 'LOCALLY_ROUTED';
}

export function resolveCustomDomain(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalDomainRecord | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  if (!hasDomainReadPermission(safe, tenant, 'DOMAIN_READ')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_READ' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:read permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }
  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }
  if (record.routingStatus !== 'LOCALLY_ACTIVE') {
    return deniedOutcome('ROUTING_NOT_PROVEN', 'Domain routing not proven locally');
  }
  return record;
}

export function resolveCustomDomainAuthOrigin(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalDomainRecord | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  if (!hasDomainReadPermission(safe, tenant, 'DOMAIN_READ')) {
    const ok = emitAudit(
      'PERMISSION_DENIED',
      domain,
      tenant,
      { tenant, domain, phase: 'permission_denied', permission: 'DOMAIN_READ' },
      auditFn,
    );
    if (!ok) {
      return deniedOutcome('AUDIT_FAILURE', 'Audit failed for permission denial');
    }
    return deniedOutcome('PERMISSION_DENIED', 'Tenant lacks domain:read permission');
  }

  const record = findDomainRecordByTenant(safe, domain, tenant);
  if (record === null) {
    return deniedOutcome('NOT_FOUND', 'Domain not found for tenant');
  }
  if (record.disabled) {
    return deniedOutcome('NOT_FOUND', 'Domain is disabled');
  }
  if (record.ownershipStatus !== 'VERIFIED') {
    return deniedOutcome('NOT_VERIFIED', 'Domain ownership not verified');
  }
  if (record.authClientStatus !== 'ACTIVE') {
    return deniedOutcome('AUTH_CLIENT_INACTIVE', 'Auth client not active');
  }
  return record;
}

export function setPublicDnsVerified(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  verified: boolean,
): CustomDomainDnsOwnershipTlsCanonicalState {
  const safe = asState(state);
  return { ...safe, publicDnsVerified: verified };
}

export function setTlsProvisioned(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  provisioned: boolean,
): CustomDomainDnsOwnershipTlsCanonicalState {
  const safe = asState(state);
  return { ...safe, tlsProvisioned: provisioned };
}

export function grantTenantPermission(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  permission: CustomDomainDnsOwnershipTlsCanonicalPermission,
): CustomDomainDnsOwnershipTlsCanonicalState {
  const safe = asState(state);
  const existing = safe.tenantPermissions.find((p) => p.tenant === tenant);
  if (existing !== undefined) {
    if (existing.permissions.has(permission)) {
      return safe;
    }
    const updated: CustomDomainDnsOwnershipTlsCanonicalTenantPermissions = {
      tenant: existing.tenant,
      permissions: new Set<CustomDomainDnsOwnershipTlsCanonicalPermission>([
        ...existing.permissions,
        permission,
      ]),
    };
    return {
      ...safe,
      tenantPermissions: safe.tenantPermissions.map((p) => (p.tenant === tenant ? updated : p)),
    };
  }
  const created: CustomDomainDnsOwnershipTlsCanonicalTenantPermissions = {
    tenant,
    permissions: new Set<CustomDomainDnsOwnershipTlsCanonicalPermission>([permission]),
  };
  return {
    ...safe,
    tenantPermissions: [...safe.tenantPermissions, created],
  };
}

function cryptoRandomUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildTenantDomainPort(): CustomDomainDnsOwnershipTlsCanonicalTenantDomainPort {
  return {
    createChallenge: createOwnershipChallenge,
    verifyDns: verifyDnsOwnership,
    verifyDnsWithLookup: verifyDnsOwnershipWithLookup,
    activateAuthClient: activateAuthClient,
    deactivateAuthClient: deactivateAuthClient,
    proveLocalRouting: proveLocalRouting,
    proveLocalRoutingWithProbe: proveLocalRoutingWithProbe,
    setCanonical: setCanonical,
    unsetCanonical: unsetCanonical,
    disableDomain: disableDomain,
    deactivateDomain: deactivateDomain,
    listDomains: listDomains,
    getReadiness: getReadiness,
  };
}

export function runDomainChallengeAndVerificationProof(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  const withPerms = grantTenantPermission(safe, tenant, 'DOMAIN_WRITE');
  const created = createOwnershipChallenge(withPerms, 'proof.example.com', tenant, auditFn);
  if ('outcome' in created) return created;
  const tokens = created.domains.find(
    (d) => d.domain === 'proof.example.com' && d.tenant === tenant,
  );
  if (tokens === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge record missing');
  }
  const token = tokens.challengeTokens[0];
  if (token === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge token missing');
  }
  return verifyDnsOwnership(created, 'proof.example.com', tenant, token.token, auditFn);
}

export function runLocalRoutingProof(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  const withPerms = grantTenantPermission(safe, tenant, 'DOMAIN_WRITE');
  const created = createOwnershipChallenge(withPerms, 'route.example.com', tenant, auditFn);
  if ('outcome' in created) return created;
  const tokens = created.domains.find(
    (d) => d.domain === 'route.example.com' && d.tenant === tenant,
  );
  if (tokens === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge record missing');
  }
  const token = tokens.challengeTokens[0];
  if (token === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge token missing');
  }
  const verified = verifyDnsOwnership(created, 'route.example.com', tenant, token.token, auditFn);
  if ('outcome' in verified) return verified;
  const authPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: () => true,
    deactivate: () => true,
  };
  const activated = activateAuthClient(verified, 'route.example.com', tenant, authPort, auditFn);
  if ('outcome' in activated) return activated;
  return proveLocalRouting(activated, 'route.example.com', tenant, auditFn);
}

export function runCanonicalCutoverProof(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  const withPerms = grantTenantPermission(safe, tenant, 'DOMAIN_WRITE');
  const created = createOwnershipChallenge(withPerms, 'canonical.example.com', tenant, auditFn);
  if ('outcome' in created) return created;
  const tokens = created.domains.find(
    (d) => d.domain === 'canonical.example.com' && d.tenant === tenant,
  );
  if (tokens === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge record missing');
  }
  const token = tokens.challengeTokens[0];
  if (token === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge token missing');
  }
  const verified = verifyDnsOwnership(
    created,
    'canonical.example.com',
    tenant,
    token.token,
    auditFn,
  );
  if ('outcome' in verified) return verified;
  const authPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: () => true,
    deactivate: () => true,
  };
  const activated = activateAuthClient(
    verified,
    'canonical.example.com',
    tenant,
    authPort,
    auditFn,
  );
  if ('outcome' in activated) return activated;
  const routed = proveLocalRouting(activated, 'canonical.example.com', tenant, auditFn);
  if ('outcome' in routed) return routed;
  return setCanonical(routed, 'canonical.example.com', tenant, auditFn);
}

export function runClaimLifecycleProof(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  const withPerms = grantTenantPermission(safe, tenant, 'DOMAIN_WRITE');
  const created = createOwnershipChallenge(withPerms, 'lifecycle.example.com', tenant, auditFn);
  if ('outcome' in created) return created;
  const authPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: () => true,
    deactivate: () => true,
  };
  const deactivated = deactivateDomain(
    created,
    'lifecycle.example.com',
    tenant,
    authPort,
    auditFn,
  );
  if ('outcome' in deactivated) return deactivated;
  const disabled = disableDomain(deactivated, 'lifecycle.example.com', tenant, auditFn);
  if ('outcome' in disabled) return disabled;
  const reenabled = createOwnershipChallenge(
    disabled,
    'lifecycle.example.com',
    tenant,
    auditFn,
  );
  return reenabled;
}

export function runCustomDomainResolutionProof(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
):
  | {
      readonly outcome: 'SUCCESS';
      readonly state: CustomDomainDnsOwnershipTlsCanonicalState;
    }
  | CustomDomainDnsOwnershipTlsCanonicalError {
  const routingResult = runLocalRoutingProof(state, tenant, auditFn);
  if ('outcome' in routingResult) return routingResult;
  const withRead = grantTenantPermission(routingResult, tenant, 'DOMAIN_READ');
  const resolved = resolveCustomDomain(withRead, 'route.example.com', tenant, auditFn);
  if ('outcome' in resolved) return resolved;
  return { outcome: 'SUCCESS', state: routingResult };
}

export function runCustomDomainAuthOriginProof(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
  auditFn: CustomDomainDnsOwnershipTlsCanonicalAuditFn,
):
  | {
      readonly outcome: 'SUCCESS';
      readonly state: CustomDomainDnsOwnershipTlsCanonicalState;
    }
  | CustomDomainDnsOwnershipTlsCanonicalError {
  const safe = asState(state);
  const withPerms = grantTenantPermission(safe, tenant, 'DOMAIN_WRITE');
  const created = createOwnershipChallenge(withPerms, 'auth.example.com', tenant, auditFn);
  if ('outcome' in created) return created;
  const tokens = created.domains.find(
    (d) => d.domain === 'auth.example.com' && d.tenant === tenant,
  );
  if (tokens === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge record missing');
  }
  const token = tokens.challengeTokens[0];
  if (token === undefined) {
    return deniedOutcome('NOT_FOUND', 'Challenge token missing');
  }
  const verified = verifyDnsOwnership(created, 'auth.example.com', tenant, token.token, auditFn);
  if ('outcome' in verified) return verified;
  const authPort: CustomDomainDnsOwnershipTlsCanonicalAuthClientPort = {
    activate: () => true,
    deactivate: () => true,
  };
  const activated = activateAuthClient(verified, 'auth.example.com', tenant, authPort, auditFn);
  if ('outcome' in activated) return activated;
  const withRead = grantTenantPermission(activated, tenant, 'DOMAIN_READ');
  const origin = resolveCustomDomainAuthOrigin(withRead, 'auth.example.com', tenant, auditFn);
  if ('outcome' in origin) return origin;
  return { outcome: 'SUCCESS', state: activated };
}