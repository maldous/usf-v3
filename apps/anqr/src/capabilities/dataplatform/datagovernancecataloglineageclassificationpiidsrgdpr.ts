export const DataGovernanceCatalogClassification = ['none', 'PII', 'sensitive'] as const;
export type DataGovernanceCatalogClassification = typeof DataGovernanceCatalogClassification[number];

export const DataSubjectRequestState = ['open', 'fulfilled'] as const;
export type DataSubjectRequestState = typeof DataSubjectRequestState[number];

export const DataGovernanceCatalogErrorKind = [
  'INVALID_CLASSIFICATION',
  'MISSING_EVIDENCE',
  'PROVIDER_UNAVAILABLE',
  'TENANT_BOUNDARY_VIOLATION',
  'CONFIGURATION_MISSING',
] as const;
export type DataGovernanceCatalogErrorKind = typeof DataGovernanceCatalogErrorKind[number];

export const DataGovernanceAuditEventKind = [
  'CLASSIFICATION_CHANGE',
  'LINEAGE_UPDATE',
  'REQUEST_FULFILLED',
  'TENANT_SCOPE_CHANGE',
] as const;
export type DataGovernanceAuditEventKind = typeof DataGovernanceAuditEventKind[number];

export interface DataGovernanceCatalogEntry {
  readonly id: string;
  readonly datasetId: string;
  readonly classification: DataGovernanceCatalogClassification;
  readonly lineage: readonly string[];
  readonly tenantId: string;
}

export interface DataSubjectRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly datasetId: string;
  readonly state: DataSubjectRequestState;
  readonly evidence: string | null;
  readonly operatorId: string | null;
}

export interface DataGovernanceAuditEvent {
  readonly kind: DataGovernanceAuditEventKind;
  readonly tenantId: string;
  readonly resourceId: string;
  readonly timestamp: string;
  readonly details: unknown;
}

export interface DataGovernanceCatalogError {
  readonly kind: DataGovernanceCatalogErrorKind;
  readonly message: string;
  readonly tenantId: string;
}

export interface DataGovernanceCatalogState {
  readonly catalog: readonly DataGovernanceCatalogEntry[];
  readonly requests: readonly DataSubjectRequest[];
  readonly auditLog: readonly DataGovernanceAuditEvent[];
  readonly lastError: DataGovernanceCatalogError | null;
}

export const initialState: DataGovernanceCatalogState = {
  catalog: [],
  requests: [],
  auditLog: [],
  lastError: null,
};

export function validateClassification(
  classification: string,
): DataGovernanceCatalogClassification | DataGovernanceCatalogError {
  if (DataGovernanceCatalogClassification.includes(classification as DataGovernanceCatalogClassification)) {
    return classification as DataGovernanceCatalogClassification;
  }
  return {
    kind: 'INVALID_CLASSIFICATION',
    message: `Invalid classification: ${classification}`,
    tenantId: '',
  };
}

export function validateRequestState(
  state: string,
): DataSubjectRequestState | DataGovernanceCatalogError {
  if (DataSubjectRequestState.includes(state as DataSubjectRequestState)) {
    return state as DataSubjectRequestState;
  }
  return {
    kind: 'CONFIGURATION_MISSING',
    message: `Invalid request state: ${state}`,
    tenantId: '',
  };
}

export function auditCatalogChange(
  tenantId: string,
  resourceId: string,
  kind: DataGovernanceAuditEventKind,
  details: unknown,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogError | null {
  const event: DataGovernanceAuditEvent = {
    kind,
    tenantId,
    resourceId,
    timestamp: new Date().toISOString(),
    details,
  };
  return auditFn(event);
}

export function addCatalogEntry(
  state: DataGovernanceCatalogState,
  entry: DataGovernanceCatalogEntry,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  const classificationResult = validateClassification(entry.classification);
  if (typeof classificationResult !== 'string') {
    return classificationResult;
  }

  const auditError = auditCatalogChange(
    entry.tenantId,
    entry.id,
    'CLASSIFICATION_CHANGE',
    { classification: entry.classification, lineage: entry.lineage },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const existingEntryIndex = state.catalog.findIndex((e) => e.id === entry.id);
  if (existingEntryIndex >= 0) {
    return {
      kind: 'TENANT_BOUNDARY_VIOLATION',
      message: `Catalog entry with id ${entry.id} already exists`,
      tenantId: entry.tenantId,
    };
  }

  return {
    ...state,
    catalog: [...state.catalog, entry],
    lastError: null,
  };
}

export function updateCatalogEntryClassification(
  state: DataGovernanceCatalogState,
  entryId: string,
  newClassification: DataGovernanceCatalogClassification,
  tenantId: string,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  const classificationResult = validateClassification(newClassification);
  if (typeof classificationResult !== 'string') {
    return classificationResult;
  }

  const entryIndex = state.catalog.findIndex((e) => e.id === entryId && e.tenantId === tenantId);
  if (entryIndex === -1) {
    return {
      kind: 'TENANT_BOUNDARY_VIOLATION',
      message: `Catalog entry ${entryId} not found for tenant ${tenantId}`,
      tenantId,
    };
  }

  const auditError = auditCatalogChange(
    tenantId,
    entryId,
    'CLASSIFICATION_CHANGE',
    { oldClassification: state.catalog[entryIndex].classification, newClassification },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const updatedCatalog = [...state.catalog];
  updatedCatalog[entryIndex] = {
    ...updatedCatalog[entryIndex],
    classification: newClassification,
  };

  return {
    ...state,
    catalog: updatedCatalog,
    lastError: null,
  };
}

export function createDataSubjectRequest(
  state: DataGovernanceCatalogState,
  request: Omit<DataSubjectRequest, 'state' | 'evidence' | 'operatorId'>,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  const existingRequest = state.requests.find(
    (r) => r.id === request.id && r.tenantId === request.tenantId,
  );
  if (existingRequest !== undefined) {
    return {
      kind: 'TENANT_BOUNDARY_VIOLATION',
      message: `Request with id ${request.id} already exists for tenant ${request.tenantId}`,
      tenantId: request.tenantId,
    };
  }

  const newRequest: DataSubjectRequest = {
    ...request,
    state: 'open',
    evidence: null,
    operatorId: null,
  };

  return {
    ...state,
    requests: [...state.requests, newRequest],
    lastError: null,
  };
}

export function fulfillDataSubjectRequest(
  state: DataGovernanceCatalogState,
  requestId: string,
  tenantId: string,
  evidence: string,
  operatorId: string,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  const requestIndex = state.requests.findIndex(
    (r) => r.id === requestId && r.tenantId === tenantId,
  );
  if (requestIndex === -1) {
    return {
      kind: 'TENANT_BOUNDARY_VIOLATION',
      message: `Request ${requestId} not found for tenant ${tenantId}`,
      tenantId,
    };
  }

  const currentRequest = state.requests[requestIndex];
  if (currentRequest.state !== 'open') {
    return {
      kind: 'CONFIGURATION_MISSING',
      message: `Request ${requestId} is not in open state`,
      tenantId,
    };
  }

  if (evidence.trim() === '') {
    return {
      kind: 'MISSING_EVIDENCE',
      message: 'Fulfilment evidence cannot be empty',
      tenantId,
    };
  }

  const auditError = auditCatalogChange(
    tenantId,
    requestId,
    'REQUEST_FULFILLED',
    { evidence, operatorId },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const updatedRequests = [...state.requests];
  updatedRequests[requestIndex] = {
    ...currentRequest,
    state: 'fulfilled',
    evidence,
    operatorId,
  };

  return {
    ...state,
    requests: updatedRequests,
    lastError: null,
  };
}

export function getCatalogEntriesForTenant(
  state: DataGovernanceCatalogState,
  tenantId: string,
): readonly DataGovernanceCatalogEntry[] {
  return state.catalog.filter((entry) => entry.tenantId === tenantId);
}

export function getRequestsForTenant(
  state: DataGovernanceCatalogState,
  tenantId: string,
): readonly DataSubjectRequest[] {
  return state.requests.filter((request) => request.tenantId === tenantId);
}

export function getAuditLogForTenant(
  state: DataGovernanceCatalogState,
  tenantId: string,
): readonly DataGovernanceAuditEvent[] {
  return state.auditLog.filter((event) => event.tenantId === tenantId);
}