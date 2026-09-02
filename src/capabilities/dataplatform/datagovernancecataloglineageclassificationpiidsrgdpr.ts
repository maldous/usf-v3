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
  'DEGRADED_READINESS',
] as const;
export type DataGovernanceCatalogErrorKind = typeof DataGovernanceCatalogErrorKind[number];

export const DataGovernanceAuditEventKind = [
  'CLASSIFICATION_CHANGE',
  'LINEAGE_UPDATE',
  'REQUEST_FULFILLED',
  'TENANT_SCOPE_CHANGE',
] as const;
export type DataGovernanceAuditEventKind = typeof DataGovernanceAuditEventKind[number];

export const DataGovernanceReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type DataGovernanceReadiness = typeof DataGovernanceReadiness[number];

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
  readonly readiness: DataGovernanceReadiness;
}

export const initialState: DataGovernanceCatalogState = {
  catalog: [],
  requests: [],
  auditLog: [],
  lastError: null,
  readiness: 'READY',
};

export function validateClassification(
  classification: string,
  tenantId: string,
): DataGovernanceCatalogClassification | DataGovernanceCatalogError {
  if (!DataGovernanceCatalogClassification.includes(classification as DataGovernanceCatalogClassification)) {
    return {
      kind: 'INVALID_CLASSIFICATION',
      message: `Invalid classification: ${classification}`,
      tenantId,
    };
  }
  return classification as DataGovernanceCatalogClassification;
}

export function validateRequestState(
  state: string,
  tenantId: string,
): DataSubjectRequestState | DataGovernanceCatalogError {
  if (!DataSubjectRequestState.includes(state as DataSubjectRequestState)) {
    return {
      kind: 'CONFIGURATION_MISSING',
      message: `Invalid request state: ${state}`,
      tenantId,
    };
  }
  return state as DataSubjectRequestState;
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
  try {
    const result = auditFn(event);
    if (result === null) {
      return null;
    }
    return result;
  } catch (err) {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Audit provider failed',
      tenantId,
    };
  }
}

export function addCatalogEntry(
  state: DataGovernanceCatalogState,
  entry: DataGovernanceCatalogEntry,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  if (state.readiness !== 'READY') {
    return {
      kind: 'DEGRADED_READINESS',
      message: `Governance mutating paths disabled while readiness is ${state.readiness}`,
      tenantId: entry.tenantId,
    };
  }

  const classificationResult = validateClassification(entry.classification, entry.tenantId);
  if (typeof classificationResult !== 'string') {
    return classificationResult;
  }

  const existingEntryIndex = state.catalog.findIndex((e) => e.id === entry.id && e.tenantId === entry.tenantId);
  if (existingEntryIndex >= 0) {
    return {
      kind: 'TENANT_BOUNDARY_VIOLATION',
      message: `Catalog entry with id ${entry.id} already exists for tenant ${entry.tenantId}`,
      tenantId: entry.tenantId,
    };
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

  return {
    ...state,
    catalog: [...state.catalog, entry],
    auditLog: [...state.auditLog, {
      kind: 'CLASSIFICATION_CHANGE',
      tenantId: entry.tenantId,
      resourceId: entry.id,
      timestamp: new Date().toISOString(),
      details: { classification: entry.classification, lineage: entry.lineage },
    }],
    lastError: null,
  };
}

export function updateCatalogEntryClassification(
  state: DataGovernanceCatalogState,
  entryId: string,
  newClassification: string,
  tenantId: string,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  if (state.readiness !== 'READY') {
    return {
      kind: 'DEGRADED_READINESS',
      message: `Governance mutating paths disabled while readiness is ${state.readiness}`,
      tenantId,
    };
  }

  const classificationResult = validateClassification(newClassification, tenantId);
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

  const oldClassification = state.catalog[entryIndex].classification;

  const auditError = auditCatalogChange(
    tenantId,
    entryId,
    'CLASSIFICATION_CHANGE',
    { oldClassification, newClassification },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const updatedCatalog = [...state.catalog];
  updatedCatalog[entryIndex] = {
    ...updatedCatalog[entryIndex],
    classification: classificationResult,
  };

  return {
    ...state,
    catalog: updatedCatalog,
    auditLog: [...state.auditLog, {
      kind: 'CLASSIFICATION_CHANGE',
      tenantId,
      resourceId: entryId,
      timestamp: new Date().toISOString(),
      details: { oldClassification, newClassification },
    }],
    lastError: null,
  };
}

export function updateCatalogLineage(
  state: DataGovernanceCatalogState,
  entryId: string,
  lineage: readonly string[],
  tenantId: string,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  if (state.readiness !== 'READY') {
    return {
      kind: 'DEGRADED_READINESS',
      message: `Governance mutating paths disabled while readiness is ${state.readiness}`,
      tenantId,
    };
  }

  const entryIndex = state.catalog.findIndex((e) => e.id === entryId && e.tenantId === tenantId);
  if (entryIndex === -1) {
    return {
      kind: 'TENANT_BOUNDARY_VIOLATION',
      message: `Catalog entry ${entryId} not found for tenant ${tenantId}`,
      tenantId,
    };
  }

  const oldLineage = state.catalog[entryIndex].lineage;

  const auditError = auditCatalogChange(
    tenantId,
    entryId,
    'LINEAGE_UPDATE',
    { oldLineage, newLineage: lineage },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const updatedCatalog = [...state.catalog];
  updatedCatalog[entryIndex] = {
    ...updatedCatalog[entryIndex],
    lineage,
  };

  return {
    ...state,
    catalog: updatedCatalog,
    auditLog: [...state.auditLog, {
      kind: 'LINEAGE_UPDATE',
      tenantId,
      resourceId: entryId,
      timestamp: new Date().toISOString(),
      details: { oldLineage, newLineage: lineage },
    }],
    lastError: null,
  };
}

export function createDataSubjectRequest(
  state: DataGovernanceCatalogState,
  request: Omit<DataSubjectRequest, 'state' | 'evidence' | 'operatorId'>,
  auditFn: (event: DataGovernanceAuditEvent) => DataGovernanceCatalogError | null,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  if (state.readiness !== 'READY') {
    return {
      kind: 'DEGRADED_READINESS',
      message: `Governance mutating paths disabled while readiness is ${state.readiness}`,
      tenantId: request.tenantId,
    };
  }

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

  const auditError = auditCatalogChange(
    request.tenantId,
    request.id,
    'TENANT_SCOPE_CHANGE',
    { state: 'open' },
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    requests: [...state.requests, newRequest],
    auditLog: [...state.auditLog, {
      kind: 'TENANT_SCOPE_CHANGE',
      tenantId: request.tenantId,
      resourceId: request.id,
      timestamp: new Date().toISOString(),
      details: { state: 'open' },
    }],
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
  if (state.readiness !== 'READY') {
    return {
      kind: 'DEGRADED_READINESS',
      message: `Governance mutating paths disabled while readiness is ${state.readiness}`,
      tenantId,
    };
  }

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

  if (operatorId.trim() === '') {
    return {
      kind: 'CONFIGURATION_MISSING',
      message: 'Fulfilment requires an attributable operator identifier',
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
    auditLog: [...state.auditLog, {
      kind: 'REQUEST_FULFILLED',
      tenantId,
      resourceId: requestId,
      timestamp: new Date().toISOString(),
      details: { evidence, operatorId },
    }],
    lastError: null,
  };
}

export function setReadiness(
  state: DataGovernanceCatalogState,
  readiness: DataGovernanceReadiness,
  tenantId: string,
): DataGovernanceCatalogState | DataGovernanceCatalogError {
  const nextReadiness: DataGovernanceReadiness = readiness;
  const previousReadiness = state.readiness;
  if (previousReadiness === nextReadiness) {
    return state;
  }
  return {
    ...state,
    readiness: nextReadiness,
    auditLog: [...state.auditLog, {
      kind: 'TENANT_SCOPE_CHANGE',
      tenantId,
      resourceId: 'readiness',
      timestamp: new Date().toISOString(),
      details: { from: previousReadiness, to: nextReadiness },
    }],
    lastError: nextReadiness === 'READY' ? null : {
      kind: nextReadiness === 'NOT_READY' ? 'PROVIDER_UNAVAILABLE' : 'DEGRADED_READINESS',
      message: `Governance readiness is ${nextReadiness}`,
      tenantId,
    },
  };
}

export function checkReadiness(
  state: DataGovernanceCatalogState,
  tenantId: string,
): { readonly readiness: DataGovernanceReadiness; readonly ok: boolean; readonly error: DataGovernanceCatalogError | null } {
  if (state.readiness === 'READY') {
    return { readiness: 'READY', ok: true, error: null };
  }
  return {
    readiness: state.readiness,
    ok: false,
    error: {
      kind: state.readiness === 'NOT_READY' ? 'PROVIDER_UNAVAILABLE' : 'DEGRADED_READINESS',
      message: `Governance readiness is ${state.readiness}`,
      tenantId,
    },
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

export function evidencePackForTenant(
  state: DataGovernanceCatalogState,
  tenantId: string,
): {
  readonly catalog: readonly DataGovernanceCatalogEntry[];
  readonly requests: readonly DataSubjectRequest[];
  readonly auditLog: readonly DataGovernanceAuditEvent[];
} {
  return {
    catalog: getCatalogEntriesForTenant(state, tenantId),
    requests: getRequestsForTenant(state, tenantId),
    auditLog: getAuditLogForTenant(state, tenantId),
  };
}

export function isErrorResult<T>(
  result: T | DataGovernanceCatalogError,
): result is DataGovernanceCatalogError {
  return typeof result !== 'string' && !Array.isArray(result) && typeof result === 'object' && result !== null && 'kind' in result;
}