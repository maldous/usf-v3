export const ObjectStorageAndTenantPrefixesAndSignedUrlsScanState = [
  'UPLOADED',
  'QUARANTINED',
  'CLEAN',
  'REJECTED',
] as const;
export type ObjectStorageAndTenantPrefixesAndSignedUrlsScanState = typeof ObjectStorageAndTenantPrefixesAndSignedUrlsScanState[number];

export const ObjectStorageAndTenantPrefixesAndSignedUrlsErrorKind = [
  'TENANT_DATA_OR_SECURITY',
  'PROVIDER_UNAVAILABLE',
  'QUOTA_EXCEEDED',
  'INVALID_CONTENT_TYPE',
  'INVALID_SIZE',
  'SCAN_FAILED',
  'REGISTRY_UNAVAILABLE',
  'PREFIX_ISOLATION_VIOLATION',
  'AUDIT_FAILURE',
  'MISSING_TENANT_CONTEXT',
  'INVALID_CONFIGURATION',
  'OBJECT_NOT_FOUND',
] as const;
export type ObjectStorageAndTenantPrefixesAndSignedUrlsErrorKind = typeof ObjectStorageAndTenantPrefixesAndSignedUrlsErrorKind[number];

export const ObjectStorageAndTenantPrefixesAndSignedUrlsReadinessState = [
  'READY',
  'DEGRADED_READ_ONLY',
  'UNAVAILABLE',
] as const;
export type ObjectStorageAndTenantPrefixesAndSignedUrlsReadinessState = typeof ObjectStorageAndTenantPrefixesAndSignedUrlsReadinessState[number];

export const ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEventKind = [
  'OBJECT_UPLOAD',
  'OBJECT_SCAN_OUTCOME',
  'OBJECT_QUARANTINE',
  'OBJECT_REJECTION',
  'OBJECT_CLEAN',
  'SIGNED_URL_ISSUED',
  'QUOTA_CHANGE',
] as const;
export type ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEventKind = typeof ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEventKind[number];

export const ObjectStorageAndTenantPrefixesAndSignedUrlsAllowedContentType = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
] as const;
export type ObjectStorageAndTenantPrefixesAndSignedUrlsAllowedContentType = typeof ObjectStorageAndTenantPrefixesAndSignedUrlsAllowedContentType[number];

export interface ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent {
  readonly kind: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEventKind;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly objectId: string;
  readonly objectKey: string;
  readonly timestamp: string;
  readonly details: unknown;
}

export interface ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  readonly kind: ObjectStorageAndTenantPrefixesAndSignedUrlsErrorKind;
  readonly message: string;
  readonly tenantId?: string;
  readonly objectId?: string;
}

export interface ObjectStorageAndTenantPrefixesAndSignedUrlsObjectRegistryRecord {
  readonly objectId: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeInBytes: number;
  readonly scanState: ObjectStorageAndTenantPrefixesAndSignedUrlsScanState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tenantPrefix: string;
}

export interface ObjectStorageAndTenantPrefixesAndSignedUrlsState {
  readonly registry: readonly ObjectStorageAndTenantPrefixesAndSignedUrlsObjectRegistryRecord[];
  readonly storageBytesMeter: number;
  readonly readiness: ObjectStorageAndTenantPrefixesAndSignedUrlsReadinessState;
  readonly lastError: ObjectStorageAndTenantPrefixesAndSignedUrlsError | null;
  readonly providerAvailable: boolean;
  readonly registryAvailable: boolean;
  readonly signedUrlIssuedCount: number;
}

export const initialState: ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
  registry: [],
  storageBytesMeter: 0,
  readiness: 'UNAVAILABLE',
  lastError: null,
  providerAvailable: false,
  registryAvailable: false,
  signedUrlIssuedCount: 0,
};

export interface ObjectStorageAndTenantPrefixesAndSignedUrlsSignedUrl {
  readonly url: string;
  readonly expiresAt: string;
  readonly objectId: string;
  readonly tenantId: string;
}

export function generateTenantPrefix(tenantId: string): string {
  return `tenant-${tenantId}-`;
}

export function validateContentType(contentType: string): boolean {
  return (ObjectStorageAndTenantPrefixesAndSignedUrlsAllowedContentType as readonly string[]).includes(contentType);
}

export function validateSize(sizeInBytes: number, quota: number): boolean {
  return Number.isFinite(sizeInBytes) && sizeInBytes > 0 && sizeInBytes <= quota;
}

export function validateTenantContext(tenantId: string, organisationId: string): boolean {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    return false;
  }
  if (typeof organisationId !== 'string' || organisationId.length === 0) {
    return false;
  }
  return true;
}

export function validatePrefixIsolation(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  objectKey: string,
  tenantId: string,
): boolean {
  const expectedPrefix = generateTenantPrefix(tenantId);
  if (!objectKey.startsWith(expectedPrefix)) {
    return false;
  }
  for (const record of state.registry) {
    if (record.tenantId !== tenantId && objectKey === record.objectKey) {
      return false;
    }
  }
  return true;
}

export function auditEvent(
  kind: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEventKind,
  tenantId: string,
  organisationId: string,
  objectId: string,
  objectKey: string,
  details: unknown,
  auditFn: (event: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent) => ObjectStorageAndTenantPrefixesAndSignedUrlsError | null,
): ObjectStorageAndTenantPrefixesAndSignedUrlsError | null {
  if (!validateTenantContext(tenantId, organisationId)) {
    return {
      kind: 'MISSING_TENANT_CONTEXT',
      message: 'Tenant context is required for audit events',
    };
  }
  const event: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent = {
    kind,
    tenantId,
    organisationId,
    objectId,
    objectKey,
    timestamp: new Date().toISOString(),
    details,
  };
  return auditFn(event);
}

export function uploadObject(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  tenantId: string,
  organisationId: string,
  objectId: string,
  objectKey: string,
  contentType: string,
  sizeInBytes: number,
  quota: number,
  auditFn: (event: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent) => ObjectStorageAndTenantPrefixesAndSignedUrlsError | null,
): { readonly kind: 'success'; readonly state: ObjectStorageAndTenantPrefixesAndSignedUrlsState } | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  if (!validateTenantContext(tenantId, organisationId)) {
    return {
      kind: 'MISSING_TENANT_CONTEXT',
      message: 'Tenant context is required for upload',
      tenantId,
      objectId,
    };
  }

  if (state.readiness === 'UNAVAILABLE') {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Storage provider is unavailable',
      tenantId,
      objectId,
    };
  }

  if (!validateContentType(contentType)) {
    return {
      kind: 'INVALID_CONTENT_TYPE',
      message: 'Invalid content type',
      tenantId,
      objectId,
    };
  }

  if (!validateSize(sizeInBytes, quota)) {
    return {
      kind: 'INVALID_SIZE',
      message: 'Object size exceeds quota or is invalid',
      tenantId,
      objectId,
    };
  }

  const tenantPrefix = generateTenantPrefix(tenantId);
  const prefixedKey = `${tenantPrefix}${objectKey}`;

  if (!validatePrefixIsolation(state, prefixedKey, tenantId)) {
    return {
      kind: 'PREFIX_ISOLATION_VIOLATION',
      message: 'Object key violates tenant prefix isolation',
      tenantId,
      objectId,
    };
  }

  const auditError = auditEvent(
    'OBJECT_UPLOAD',
    tenantId,
    organisationId,
    objectId,
    prefixedKey,
    { contentType, sizeInBytes },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const newRecord: ObjectStorageAndTenantPrefixesAndSignedUrlsObjectRegistryRecord = {
    objectId,
    tenantId,
    organisationId,
    objectKey: prefixedKey,
    contentType,
    sizeInBytes,
    scanState: 'UPLOADED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tenantPrefix,
  };

  const newRegistry = [...state.registry, newRecord];
  const newStorageBytesMeter = state.storageBytesMeter + sizeInBytes;

  return {
    kind: 'success',
    state: {
      ...state,
      registry: newRegistry,
      storageBytesMeter: newStorageBytesMeter,
      lastError: null,
    },
  };
}

export function updateScanState(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  objectId: string,
  tenantId: string,
  organisationId: string,
  newScanState: ObjectStorageAndTenantPrefixesAndSignedUrlsScanState,
  auditFn: (event: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent) => ObjectStorageAndTenantPrefixesAndSignedUrlsError | null,
): { readonly kind: 'success'; readonly state: ObjectStorageAndTenantPrefixesAndSignedUrlsState } | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  if (!validateTenantContext(tenantId, organisationId)) {
    return {
      kind: 'MISSING_TENANT_CONTEXT',
      message: 'Tenant context is required for scan state update',
      tenantId,
      objectId,
    };
  }

  if (state.readiness === 'UNAVAILABLE') {
    return {
      kind: 'REGISTRY_UNAVAILABLE',
      message: 'Registry is unavailable',
      tenantId,
      objectId,
    };
  }

  const recordIndex = state.registry.findIndex(
    (r) => r.objectId === objectId && r.tenantId === tenantId,
  );
  if (recordIndex === -1) {
    return {
      kind: 'OBJECT_NOT_FOUND',
      message: 'Object not found or tenant mismatch',
      tenantId,
      objectId,
    };
  }

  const record = state.registry[recordIndex];
  const auditKindMap: Record<ObjectStorageAndTenantPrefixesAndSignedUrlsScanState, ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEventKind> = {
    UPLOADED: 'OBJECT_UPLOAD',
    QUARANTINED: 'OBJECT_QUARANTINE',
    CLEAN: 'OBJECT_CLEAN',
    REJECTED: 'OBJECT_REJECTION',
  };
  const auditKind = auditKindMap[newScanState];
  const auditError = auditEvent(
    auditKind,
    record.tenantId,
    record.organisationId,
    record.objectId,
    record.objectKey,
    { fromState: record.scanState, toState: newScanState },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const newRecord: ObjectStorageAndTenantPrefixesAndSignedUrlsObjectRegistryRecord = {
    ...record,
    scanState: newScanState,
    updatedAt: new Date().toISOString(),
  };

  const newRegistry = [...state.registry];
  newRegistry[recordIndex] = newRecord;

  return {
    kind: 'success',
    state: {
      ...state,
      registry: newRegistry,
      lastError: null,
    },
  };
}

export function issueSignedUrl(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  objectId: string,
  tenantId: string,
  organisationId: string,
  expiresInSeconds: number,
  auditFn: (event: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent) => ObjectStorageAndTenantPrefixesAndSignedUrlsError | null,
): ObjectStorageAndTenantPrefixesAndSignedUrlsSignedUrl | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  if (!validateTenantContext(tenantId, organisationId)) {
    return {
      kind: 'MISSING_TENANT_CONTEXT',
      message: 'Tenant context is required for signed URL issuance',
      tenantId,
      objectId,
    };
  }

  if (state.readiness === 'UNAVAILABLE') {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Storage provider is unavailable',
      tenantId,
      objectId,
    };
  }

  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Signed URL expiration must be positive',
      tenantId,
      objectId,
    };
  }

  const record = state.registry.find(
    (r) => r.objectId === objectId && r.tenantId === tenantId,
  );
  if (record === undefined) {
    return {
      kind: 'OBJECT_NOT_FOUND',
      message: 'Object not found or tenant mismatch',
      tenantId,
      objectId,
    };
  }

  if (record.scanState !== 'CLEAN') {
    return {
      kind: 'SCAN_FAILED',
      message: 'Object is not in clean state',
      tenantId,
      objectId,
    };
  }

  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  const auditError = auditEvent(
    'SIGNED_URL_ISSUED',
    record.tenantId,
    record.organisationId,
    record.objectId,
    record.objectKey,
    { expiresAt },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    kind: 'success',
    url: `https://storage.provider.com/${record.objectKey}?expires=${expiresAt}`,
    expiresAt,
    objectId: record.objectId,
    tenantId: record.tenantId,
  } as unknown as ObjectStorageAndTenantPrefixesAndSignedUrlsSignedUrl;
}

export function checkReadiness(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  providerAvailable: boolean,
  registryAvailable: boolean,
): ObjectStorageAndTenantPrefixesAndSignedUrlsState {
  const bothAvailable = providerAvailable && registryAvailable;
  const neitherAvailable = !providerAvailable && !registryAvailable;
  const providerOnly = providerAvailable && !registryAvailable;
  const registryOnly = !providerAvailable && registryAvailable;

  if (neitherAvailable) {
    return {
      ...state,
      readiness: 'UNAVAILABLE',
      providerAvailable,
      registryAvailable,
      lastError: {
        kind: 'PROVIDER_UNAVAILABLE',
        message: 'Storage provider and registry are unavailable',
      },
    };
  }

  if (providerOnly || registryOnly) {
    return {
      ...state,
      readiness: 'DEGRADED_READ_ONLY',
      providerAvailable,
      registryAvailable,
      lastError: {
        kind: providerOnly ? 'REGISTRY_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',
        message: providerOnly
          ? 'Registry is unavailable; storage paths are disabled'
          : 'Provider is unavailable; storage paths are disabled',
      },
    };
  }

  if (state.readiness === 'UNAVAILABLE' || state.readiness === 'DEGRADED_READ_ONLY') {
    return {
      ...state,
      readiness: 'READY',
      providerAvailable,
      registryAvailable,
      lastError: null,
    };
  }

  return {
    ...state,
    providerAvailable,
    registryAvailable,
  };
}

export function probe(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
): {
  readonly readiness: ObjectStorageAndTenantPrefixesAndSignedUrlsReadinessState;
  readonly storageBytesMeter: number;
  readonly error: ObjectStorageAndTenantPrefixesAndSignedUrlsError | null;
  readonly providerAvailable: boolean;
  readonly registryAvailable: boolean;
} {
  return {
    readiness: state.readiness,
    storageBytesMeter: state.storageBytesMeter,
    error: state.lastError,
    providerAvailable: state.providerAvailable,
    registryAvailable: state.registryAvailable,
  };
}

export function enforceQuota(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  tenantId: string,
  organisationId: string,
  quota: number,
  auditFn: (event: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent) => ObjectStorageAndTenantPrefixesAndSignedUrlsError | null,
): { readonly kind: 'success'; readonly state: ObjectStorageAndTenantPrefixesAndSignedUrlsState } | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  if (!validateTenantContext(tenantId, organisationId)) {
    return {
      kind: 'MISSING_TENANT_CONTEXT',
      message: 'Tenant context is required for quota enforcement',
      tenantId,
    };
  }

  const tenantObjects = state.registry.filter((r) => r.tenantId === tenantId);
  const totalUsage = tenantObjects.reduce((sum, obj) => sum + obj.sizeInBytes, 0);

  if (totalUsage > quota) {
    return {
      kind: 'QUOTA_EXCEEDED',
      message: 'Tenant storage quota exceeded',
      tenantId,
    };
  }

  const auditError = auditEvent(
    'QUOTA_CHANGE',
    tenantId,
    organisationId,
    '',
    '',
    { totalUsage, quota },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    kind: 'success',
    state: {
      ...state,
      lastError: null,
    },
  };
}

export function listTenantObjects(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  tenantId: string,
  organisationId: string,
): readonly ObjectStorageAndTenantPrefixesAndSignedUrlsObjectRegistryRecord[] | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  if (!validateTenantContext(tenantId, organisationId)) {
    return {
      kind: 'MISSING_TENANT_CONTEXT',
      message: 'Tenant context is required for listing objects',
      tenantId,
    };
  }
  return state.registry.filter((r) => r.tenantId === tenantId);
}

export function isMutationAllowed(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
): boolean {
  return state.readiness === 'READY';
}

export function validateConfiguration(
  providerAvailable: boolean,
  registryAvailable: boolean,
  quota: number,
): ObjectStorageAndTenantPrefixesAndSignedUrlsError | null {
  if (!providerAvailable || !registryAvailable) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Provider and registry must be configured',
    };
  }
  if (!Number.isFinite(quota) || quota <= 0) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Quota must be a positive finite number',
    };
  }
  return null;
}