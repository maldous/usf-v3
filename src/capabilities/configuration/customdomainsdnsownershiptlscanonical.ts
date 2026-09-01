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

export const CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy = [
  'NO_REDIRECT',
  'REDIRECT_SLUG_TO_CANONICAL',
] as const;
export type CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy = typeof CustomDomainDnsOwnershipTlsCanonicalRedirectPolicy[number];

export interface CustomDomainDnsOwnershipTlsCanonicalAuditEvent {
  readonly kind: CustomDomainDnsOwnershipTlsCanonicalAuditEventKind;
  readonly domain: string;
  readonly tenant: string;
  readonly timestamp: string;
}

export interface CustomDomainDnsOwnershipTlsCanonicalError {
  readonly kind: CustomDomainDnsOwnershipTlsCanonicalOutcome;
  readonly message: string;
}

export interface CustomDomainDnsOwnershipTlsCanonicalChallengeToken {
  readonly token: string;
  readonly createdAt: string;
}

export interface CustomDomainDnsOwnershipTlsCanonicalDomainRecord {
  readonly domain: string;
  readonly tenant: string;
  readonly ownershipStatus: CustomDomainDnsOwnershipTlsCanonicalOwnershipStatus;
  readonly authClientStatus: CustomDomainDnsOwnershipTlsCanonicalAuthClientStatus;
  readonly routingStatus: CustomDomainDnsOwnershipTlsCanonicalRoutingStatus;
  readonly tlsStatus: 'UNKNOWN';
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

export interface CustomDomainDnsOwnershipTlsCanonicalState {
  readonly domains: readonly CustomDomainDnsOwnershipTlsCanonicalDomainRecord[];
}

export const initialState: CustomDomainDnsOwnershipTlsCanonicalState = {
  domains: [],
};

function isValidDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 253) return false;
  if (/[^a-zA-Z0-9-.]/.test(domain)) return false;
  if (domain.startsWith('-') || domain.endsWith('-')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  const parts = domain.split('.');
  if (parts.some((part) => part.length === 0)) return false;
  return true;
}

function findDomainRecord(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
): CustomDomainDnsOwnershipTlsCanonicalDomainRecord | null {
  return state.domains.find((d) => d.domain === domain) ?? null;
}

function findDomainRecordByTenant(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
): CustomDomainDnsOwnershipTlsCanonicalDomainRecord | null {
  return state.domains.find((d) => d.domain === domain && d.tenant === tenant) ?? null;
}

function findAnyTenantDomainRecord(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
): CustomDomainDnsOwnershipTlsCanonicalDomainRecord | null {
  return state.domains.find((d) => d.domain === domain) ?? null;
}

function emitAudit(
  kind: CustomDomainDnsOwnershipTlsCanonicalAuditEventKind,
  domain: string,
  tenant: string,
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalError | null {
  const event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent = {
    kind,
    domain,
    tenant,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function createOwnershipChallenge(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  if (!isValidDomain(domain)) {
    return { kind: 'INVALID_DOMAIN', message: 'Domain name is malformed' };
  }

  const existingAnyTenant = findAnyTenantDomainRecord(state, domain);
  if (existingAnyTenant !== null) {
    const auditError = emitAudit('CONFLICT_REJECTED', domain, tenant, auditFn);
    if (auditError !== null) return auditError;
    return { kind: 'DOMAIN_ALREADY_CLAIMED', message: 'Domain already claimed by another tenant' };
  }

  const existing = findDomainRecordByTenant(state, domain, tenant);
  if (existing !== null) {
    const auditError = emitAudit('CONFLICT_REJECTED', domain, tenant, auditFn);
    if (auditError !== null) return auditError;
    return { kind: 'DOMAIN_ALREADY_CLAIMED', message: 'Domain already claimed by this tenant' };
  }

  const auditError = emitAudit('CHALLENGE_CREATED', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

  const token: CustomDomainDnsOwnershipTlsCanonicalChallengeToken = {
    token: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
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
    createdAt: new Date().toISOString(),
    verifiedAt: null,
    activatedAt: null,
    routedAt: null,
    canonicalSetAt: null,
    disabled: false,
    challengeTokens: [token],
  };

  return {
    ...state,
    domains: [...state.domains, newRecord],
  };
}

export function verifyDnsOwnership(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  expectedToken: string,
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.ownershipStatus === 'VERIFIED') {
    return { kind: 'ALREADY_VERIFIED', message: 'Domain already verified' };
  }

  const tokenMatch = record.challengeTokens.some((t) => t.token === expectedToken);
  if (!tokenMatch) {
    const auditError = emitAudit('VERIFICATION', domain, tenant, auditFn);
    if (auditError !== null) return auditError;
    return { kind: 'DNS_MISMATCH', message: 'DNS verification token mismatch' };
  }

  const auditError = emitAudit('VERIFICATION', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    ownershipStatus: 'VERIFIED',
    verifiedAt: new Date().toISOString(),
  };

  return {
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function activateAuthClient(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  authClientPort: { readonly activate: (domain: string, tenant: string) => boolean },
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.ownershipStatus !== 'VERIFIED') {
    return { kind: 'NOT_VERIFIED', message: 'Domain must be verified before activating auth client' };
  }

  if (record.authClientStatus === 'ACTIVE') {
    return { kind: 'ALREADY_VERIFIED', message: 'Auth client already active' };
  }

  const success = authClientPort.activate(domain, tenant);
  if (!success) {
    return { kind: 'AUTH_CLIENT_INACTIVE', message: 'Auth client activation failed' };
  }

  const auditError = emitAudit('AUTH_CLIENT_ACTIVATED', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    authClientStatus: 'ACTIVE',
    activatedAt: new Date().toISOString(),
  };

  return {
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function deactivateAuthClient(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  authClientPort: { readonly deactivate: (domain: string, tenant: string) => boolean },
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.authClientStatus !== 'ACTIVE') {
    return { kind: 'NOT_ACTIVE', message: 'Auth client not active' };
  }

  const success = authClientPort.deactivate(domain, tenant);
  if (!success) {
    return { kind: 'AUTH_CLIENT_INACTIVE', message: 'Auth client deactivation failed' };
  }

  const auditError = emitAudit('AUTH_CLIENT_DEACTIVATED', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

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
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function proveLocalRouting(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.ownershipStatus !== 'VERIFIED') {
    return { kind: 'NOT_VERIFIED', message: 'Domain must be verified' };
  }

  if (record.authClientStatus !== 'ACTIVE') {
    return { kind: 'AUTH_CLIENT_INACTIVE', message: 'Auth client must be active' };
  }

  if (record.routingStatus === 'LOCALLY_ACTIVE') {
    return { kind: 'SUCCESS', message: 'Routing already proven' };
  }

  const auditError = emitAudit('LOCAL_ROUTING_PROOF', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    routingStatus: 'LOCALLY_ACTIVE',
    routedAt: new Date().toISOString(),
  };

  return {
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function setCanonical(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.ownershipStatus !== 'VERIFIED') {
    return { kind: 'NOT_VERIFIED', message: 'Domain must be verified' };
  }

  if (record.authClientStatus !== 'ACTIVE') {
    return { kind: 'AUTH_CLIENT_INACTIVE', message: 'Auth client must be active' };
  }

  if (record.routingStatus !== 'LOCALLY_ACTIVE') {
    return { kind: 'ROUTING_NOT_PROVEN', message: 'Routing must be proven' };
  }

  if (record.canonical) {
    return { kind: 'SUCCESS', message: 'Domain already canonical' };
  }

  const auditError = emitAudit('CANONICAL_SET', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    canonical: true,
    canonicalSetAt: new Date().toISOString(),
    redirectPolicy: 'REDIRECT_SLUG_TO_CANONICAL',
  };

  return {
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function unsetCanonical(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (!record.canonical) {
    return { kind: 'SUCCESS', message: 'Domain not canonical' };
  }

  const auditError = emitAudit('CANONICAL_UNSET', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

  const updatedRecord: CustomDomainDnsOwnershipTlsCanonicalDomainRecord = {
    ...record,
    canonical: false,
    canonicalSetAt: null,
    redirectPolicy: 'NO_REDIRECT',
  };

  return {
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function deactivateDomain(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  authClientPort: { readonly deactivate: (domain: string, tenant: string) => boolean },
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.authClientStatus === 'ACTIVE') {
    const success = authClientPort.deactivate(domain, tenant);
    if (!success) {
      return { kind: 'AUTH_CLIENT_INACTIVE', message: 'Auth client deactivation failed' };
    }
    const auditError = emitAudit('AUTH_CLIENT_DEACTIVATED', domain, tenant, auditFn);
    if (auditError !== null) return auditError;
  }

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
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function disableDomain(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
  auditFn: (event: CustomDomainDnsOwnershipTlsCanonicalAuditEvent) => CustomDomainDnsOwnershipTlsCanonicalError | null,
): CustomDomainDnsOwnershipTlsCanonicalState | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.disabled) {
    return { kind: 'SUCCESS', message: 'Domain already disabled' };
  }

  const auditError = emitAudit('AUTH_CLIENT_DEACTIVATED', domain, tenant, auditFn);
  if (auditError !== null) return auditError;

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
    ...state,
    domains: state.domains.map((d) => (d.domain === domain && d.tenant === tenant ? updatedRecord : d)),
  };
}

export function listDomains(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
): readonly CustomDomainDnsOwnershipTlsCanonicalDomainRecord[] {
  return state.domains.filter((d) => d.tenant === tenant);
}

export function getReadiness(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  tenant: string,
): CustomDomainDnsOwnershipTlsCanonicalReadiness {
  const domains = listDomains(state, tenant);
  if (domains.length === 0) return 'NO_DOMAINS';

  const verifiedDomains = domains.filter((d) => d.ownershipStatus === 'VERIFIED');
  if (verifiedDomains.length === 0) return 'PENDING_DNS';

  const activeAuthDomains = verifiedDomains.filter((d) => d.authClientStatus === 'ACTIVE');
  if (activeAuthDomains.length === 0) return 'VERIFIED';

  const routedDomains = activeAuthDomains.filter((d) => d.routingStatus === 'LOCALLY_ACTIVE');
  if (routedDomains.length === 0) return 'INACTIVE_AUTH_CLIENT';

  const canonicalDomains = routedDomains.filter((d) => d.canonical);
  if (canonicalDomains.length > 0) return 'CANONICAL_REDIRECT_CUTOVER';

  return 'LOCALLY_ROUTED';
}

export function getDomainReadiness(
  state: CustomDomainDnsOwnershipTlsCanonicalState,
  domain: string,
  tenant: string,
): CustomDomainDnsOwnershipTlsCanonicalReadiness | CustomDomainDnsOwnershipTlsCanonicalError {
  const record = findDomainRecordByTenant(state, domain, tenant);
  if (record === null) {
    return { kind: 'NOT_FOUND', message: 'Domain not found for tenant' };
  }

  if (record.ownershipStatus !== 'VERIFIED') return 'PENDING_DNS';
  if (record.authClientStatus !== 'ACTIVE') return 'VERIFIED';
  if (record.routingStatus !== 'LOCALLY_ACTIVE') return 'INACTIVE_AUTH_CLIENT';
  if (record.canonical) return 'CANONICAL_REDIRECT_CUTOVER';
  return 'LOCALLY_ROUTED';
}