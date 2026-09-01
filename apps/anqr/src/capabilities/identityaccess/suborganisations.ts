export const SubOrganisationsErrorKind = [
  'invalid-body',
  'reserved-slug',
  'conflict',
  'not-found',
  'ok',
] as const;
export type SubOrganisationsErrorKind =
  typeof SubOrganisationsErrorKind[number];

export interface SubOrganisationsError {
  readonly kind: SubOrganisationsErrorKind;
  readonly message: string;
}

export const SubOrgAuditEventKind = [
  'SUBORG_CREATED',
  'SUBORG_UPDATED',
  'SUBORG_DEACTIVATED',
] as const;
export type SubOrgAuditEventKind = typeof SubOrgAuditEventKind[number];

export interface SubOrgAuditEvent {
  readonly kind: SubOrgAuditEventKind;
  readonly resource: string;
  readonly subOrgId: string;
  readonly timestamp: string;
}

export const ReservedSubOrgSlugs = ['admin', 'root', 'system'] as const;
type ReservedSlug = typeof ReservedSubOrgSlugs[number];

export interface SubOrg {
  readonly id: string;
  readonly parentId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SubOrgPublic = Omit<SubOrg, 'parentId'>;

export type SubOrgState = readonly SubOrg[];

export const SubOrganisationsReadiness = ['READY', 'NOT_READY'] as const;
export type SubOrganisationsReadiness =
  typeof SubOrganisationsReadiness[number];

export const SubOrganisationsPermissions = {
  read: 'suborg:read',
  create: 'suborg:create',
  update: 'suborg:update',
  delete: 'suborg:delete',
} as const;
export type SubOrganisationsPermission =
  typeof SubOrganisationsPermissions[keyof typeof SubOrganisationsPermissions];

export interface SubOrganisationsRouteGuard {
  readonly resource: string;
  readonly scope: string;
  readonly requiredPermission: SubOrganisationsPermission;
}

function now(): string {
  return new Date().toISOString();
}

function validateSlug(slug: string): SubOrganisationsError | null {
  if (typeof slug !== 'string') {
    return { kind: 'invalid-body', message: 'Slug must be a string' };
  }
  const lower = slug.toLowerCase();
  if (slug !== lower) {
    return { kind: 'invalid-body', message: 'Slug must be lowercase' };
  }
  if (slug.length < 3 || slug.length > 30) {
    return { kind: 'invalid-body', message: 'Slug length must be 3-30' };
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { kind: 'invalid-body', message: 'Slug contains invalid characters or edge hyphens' };
  }
  if ((ReservedSubOrgSlugs as readonly string[]).includes(slug)) {
    return { kind: 'reserved-slug', message: 'Slug is reserved' };
  }
  return null;
}

function validateDisplayName(name: string): SubOrganisationsError | null {
  if (typeof name !== 'string') {
    return { kind: 'invalid-body', message: 'Display name must be a string' };
  }
  if (name.length < 1 || name.length > 100) {
    return { kind: 'invalid-body', message: 'Display name length must be 1-100' };
  }
  return null;
}

export function auditSubOrg(
  kind: SubOrgAuditEventKind,
  resource: string,
  subOrgId: string,
  auditFn: (event: SubOrgAuditEvent) => SubOrganisationsError | null,
): SubOrganisationsError | null {
  const event: SubOrgAuditEvent = {
    kind,
    resource,
    subOrgId,
    timestamp: now(),
  };
  return auditFn(event);
}

export function checkReadiness(tableAvailable: boolean): SubOrganisationsReadiness {
  return tableAvailable ? 'READY' : 'NOT_READY';
}

export function listSubOrganisations(
  state: SubOrgState,
  tenantId: string,
): readonly SubOrgPublic[] {
  return state
    .filter((org) => org.parentId === tenantId && org.active)
    .map(({ parentId, ...pub }) => pub);
}

export function createSubOrganisation(
  state: SubOrgState,
  tenantId: string,
  slug: string,
  displayName: string,
  auditFn: (event: SubOrgAuditEvent) => SubOrganisationsError | null,
): SubOrgState | SubOrganisationsError {
  const slugError = validateSlug(slug);
  if (slugError) return slugError;

  const nameError = validateDisplayName(displayName);
  if (nameError) return nameError;

  if (state.some((org) => org.slug === slug)) {
    return { kind: 'conflict', message: 'Slug already exists' };
  }

  const auditError = auditSubOrg(
    'SUBORG_CREATED',
    'suborganisation',
    slug,
    auditFn,
  );
  if (auditError) return auditError;

  const timestamp = now();
  const newOrg: SubOrg = {
    id: slug,
    parentId: tenantId,
    slug,
    displayName,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return [...state, newOrg];
}

export function updateSubOrganisation(
  state: SubOrgState,
  tenantId: string,
  slug: string,
  newDisplayName: string,
  auditFn: (event: SubOrgAuditEvent) => SubOrganisationsError | null,
): SubOrgState | SubOrganisationsError {
  const org = state.find((o) => o.slug === slug && o.parentId === tenantId);
  if (!org) {
    return { kind: 'not-found', message: 'Sub-organisation not found' };
  }

  const nameError = validateDisplayName(newDisplayName);
  if (nameError) return nameError;

  const auditError = auditSubOrg(
    'SUBORG_UPDATED',
    'suborganisation',
    slug,
    auditFn,
  );
  if (auditError) return auditError;

  const updatedOrg: SubOrg = {
    ...org,
    displayName: newDisplayName,
    updatedAt: now(),
  };

  return state.map((o) => (o.slug === slug && o.parentId === tenantId ? updatedOrg : o));
}

export function deactivateSubOrganisation(
  state: SubOrgState,
  tenantId: string,
  slug: string,
  auditFn: (event: SubOrgAuditEvent) => SubOrganisationsError | null,
): SubOrgState | SubOrganisationsError {
  const org = state.find((o) => o.slug === slug && o.parentId === tenantId);
  if (!org) {
    return { kind: 'not-found', message: 'Sub-organisation not found' };
  }

  if (!org.active) {
    return state;
  }

  const auditError = auditSubOrg(
    'SUBORG_DEACTIVATED',
    'suborganisation',
    slug,
    auditFn,
  );
  if (auditError) return auditError;

  const deactivatedOrg: SubOrg = {
    ...org,
    active: false,
    updatedAt: now(),
  };

  return state.map((o) => (o.slug === slug && o.parentId === tenantId ? deactivatedOrg : o));
}

export type SubOrganisationsResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: SubOrganisationsErrorKind; readonly error: SubOrganisationsError };