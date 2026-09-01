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
}

export const initialState: ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
  registry: [],
  storageBytesMeter: 0,
  readiness: 'UNAVAILABLE',
  lastError: null,
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
  const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'];
  return validTypes.includes(contentType);
}

export function validateSize(sizeInBytes: number, quota: number): boolean {
  return sizeInBytes > 0 && sizeInBytes <= quota;
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
): ObjectStorageAndTenantPrefixesAndSignedUrlsState | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  if (state.readiness === 'UNAVAILABLE') {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Storage provider is unavailable',
      tenantId,
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
    ...state,
    registry: newRegistry,
    storageBytesMeter: newStorageBytesMeter,
    lastError: null,
  };
}

export function updateScanState(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  objectId: string,
  tenantId: string,
  newScanState: ObjectStorageAndTenantPrefixesAndSignedUrlsScanState,
  auditFn: (event: ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent) => ObjectStorageAndTenantPrefixesAndSignedUrlsError | null,
): ObjectStorageAndTenantPrefixesAndSignedUrlsState | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
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
      kind: 'TENANT_DATA_OR_SECURITY',
      message: 'Object not found or tenant mismatch',
      tenantId,
      objectId,
    };
  }

  const record = state.registry[recordIndex];
  const auditKind = `OBJECT_${newScanState}` as ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEventKind;
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
    ...state,
    registry: newRegistry,
    lastError: null,
  };
}

export function issueSignedUrl(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  objectId: string,
  tenantId: string,
  expiresInSeconds: number,
): ObjectStorageAndTenantPrefixesAndSignedUrlsSignedUrl | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  if (state.readiness === 'UNAVAILABLE') {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Storage provider is unavailable',
      tenantId,
      objectId,
    };
  }

  const record = state.registry.find(
    (r) => r.objectId === objectId && r.tenantId === tenantId,
  );
  if (record === undefined) {
    return {
      kind: 'TENANT_DATA_OR_SECURITY',
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
    (): null => null,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    url: `https://storage.provider.com/${record.objectKey}?expires=${expiresAt}`,
    expiresAt,
    objectId: record.objectId,
    tenantId: record.tenantId,
  };
}

export function checkReadiness(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  providerAvailable: boolean,
  registryAvailable: boolean,
): ObjectStorageAndTenantPrefixesAndSignedUrlsState {
  if (!providerAvailable || !registryAvailable) {
    return {
      ...state,
      readiness: 'UNAVAILABLE',
      lastError: {
        kind: 'PROVIDER_UNAVAILABLE',
        message: 'Storage provider or registry is unavailable',
      },
    };
  }

  if (state.readiness === 'UNAVAILABLE') {
    return {
      ...state,
      readiness: 'READY',
      lastError: null,
    };
  }

  return state;
}

export function probe(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
): {
  readonly readiness: ObjectStorageAndTenantPrefixesAndSignedUrlsReadinessState;
  readonly storageBytesMeter: number;
  readonly error: ObjectStorageAndTenantPrefixesAndSignedUrlsError | null;
} {
  return {
    readiness: state.readiness,
    storageBytesMeter: state.storageBytesMeter,
    error: state.lastError,
  };
}

export function enforceQuota(
  state: ObjectStorageAndTenantPrefixesAndSignedUrlsState,
  tenantId: string,
  quota: number,
): ObjectStorageAndTenantPrefixesAndSignedUrlsState | ObjectStorageAndTenantPrefixesAndSignedUrlsError {
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
    tenantObjects[0]?.organisationId ?? 'unknown',
    '',
    '',
    { totalUsage, quota },
    (): null => null,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    lastError: null,
  };
}