// Search and Indexing Product Search Capability Module

// === Constants and Types ===

export const SearchReadiness = ['READY', 'DEGRADED', 'BLOCKED'] as const;
export type SearchReadiness = typeof SearchReadiness[number];

export const SearchErrorKind = [
  'AUDIT_FAILURE',
  'TENANT_ISOLATION_VIOLATION',
  'PERMISSION_KEY_REQUIRED',
  'SEARCH_ENGINE_UNAVAILABLE',
  'INDEX_MUTATION_DISABLED',
  'DOCUMENT_VALIDATION_FAILURE',
  'UNIQUENESS_VIOLATION',
  'SECRET_FIELD_DETECTED',
  'CROSS_TENANT_QUERY_REJECTED',
  'READINESS_PROBE_FAILED',
] as const;
export type SearchErrorKind = typeof SearchErrorKind[number];

export const SearchAuditEventKind = [
  'AUDIT_BEFORE_INDEX',
  'AUDIT_BEFORE_REINDEX',
  'AUDIT_BEFORE_SEARCH',
] as const;
export type SearchAuditEventKind = typeof SearchAuditEventKind[number];

export const SearchPermissionDecision = ['GRANTED', 'DENIED'] as const;
export type SearchPermissionDecision = typeof SearchPermissionDecision[number];

// === Interfaces ===

export interface SearchAuditEvent {
  readonly kind: SearchAuditEventKind;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly operation: string;
  readonly timestamp: string;
  readonly span: string;
}

export interface SearchError {
  readonly kind: SearchErrorKind;
  readonly message: string;
  readonly tenantId: string;
  readonly organisationId: string;
}

export interface IndexedDocument {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly documentId: string;
  readonly documentType: string;
  readonly title: string;
  readonly searchVector: string;
  readonly indexName: string;
  readonly url: string;
  readonly metadata: Record<string, string>;
  readonly permissionKey?: string;
}

export interface SearchQuery {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly query: string;
  readonly permissionKey?: string;
  readonly documentType?: string;
}

export interface SearchResult {
  readonly document: IndexedDocument;
  readonly decision: SearchPermissionDecision;
}

export interface SearchEngineProbe {
  readonly status: SearchReadiness;
  readonly timestamp: string;
  readonly details?: string;
}

export interface SearchState {
  readonly readiness: SearchReadiness;
  readonly documents: readonly IndexedDocument[];
  readonly lastError: SearchError | null;
  readonly lastAudit: SearchAuditEvent | null;
  readonly probeHistory: readonly SearchEngineProbe[];
}

// === Secret Field Detection ===

const SECRET_FIELD_PATTERNS = [
  'password', 'token', 'secret', 'apikey', 'api_key', 'credential',
  'private_key', 'access_key', 'auth_token', 'session_id'
];

function containsSecretFields(metadata: Record<string, string>): boolean {
  const metadataKeys = Object.keys(metadata).map(k => k.toLowerCase());
  return SECRET_FIELD_PATTERNS.some(pattern =>
    metadataKeys.some(key => key.includes(pattern))
  );
}

// === Validation Functions ===

export function validateDocumentShape(document: unknown): document is IndexedDocument {
  if (typeof document !== 'object' || document === null) return false;

  const doc = document as Record<string, unknown>;
  return (
    typeof doc.tenantId === 'string' &&
    typeof doc.organisationId === 'string' &&
    typeof doc.documentId === 'string' &&
    typeof doc.documentType === 'string' &&
    typeof doc.title === 'string' &&
    typeof doc.searchVector === 'string' &&
    typeof doc.indexName === 'string' &&
    typeof doc.url === 'string' &&
    typeof doc.metadata === 'object' && doc.metadata !== null &&
    Object.values(doc.metadata).every(v => typeof v === 'string') &&
    (doc.permissionKey === undefined || typeof doc.permissionKey === 'string')
  );
}

export function validateUniqueness(
  documents: readonly IndexedDocument[],
  newDoc: IndexedDocument
): boolean {
  return !documents.some(doc =>
    doc.tenantId === newDoc.tenantId &&
    doc.documentType === newDoc.documentType &&
    doc.documentId === newDoc.documentId
  );
}

export function validateQueryScope(query: SearchQuery): boolean {
  return typeof query.tenantId === 'string' &&
         typeof query.organisationId === 'string' &&
         query.tenantId.length > 0 &&
         query.organisationId.length > 0;
}

// === Audit Function ===

export function auditSearchOperation(
  event: SearchAuditEvent,
  auditFn: (event: SearchAuditEvent) => SearchError | null
): SearchError | null {
  return auditFn(event);
}

// === Core Operations ===

export function indexDocument(
  state: SearchState,
  document: unknown,
  auditFn: (event: SearchAuditEvent) => SearchError | null
): SearchState | SearchError {
  if (!validateDocumentShape(document)) {
    return {
      kind: 'DOCUMENT_VALIDATION_FAILURE',
      message: 'Invalid document shape',
      tenantId: '',
      organisationId: ''
    };
  }

  if (containsSecretFields(document.metadata)) {
    return {
      kind: 'SECRET_FIELD_DETECTED',
      message: 'Document metadata contains secret fields',
      tenantId: document.tenantId,
      organisationId: document.organisationId
    };
  }

  if (!validateUniqueness(state.documents, document)) {
    return {
      kind: 'UNIQUENESS_VIOLATION',
      message: 'Document with tenant/type/id already exists',
      tenantId: document.tenantId,
      organisationId: document.organisationId
    };
  }

  if (state.readiness !== 'READY') {
    return {
      kind: 'INDEX_MUTATION_DISABLED',
      message: 'Search engine not ready for mutations',
      tenantId: document.tenantId,
      organisationId: document.organisationId
    };
  }

  const auditEvent: SearchAuditEvent = {
    kind: 'AUDIT_BEFORE_INDEX',
    tenantId: document.tenantId,
    organisationId: document.organisationId,
    operation: 'index_document',
    timestamp: new Date().toISOString(),
    span: 'route/use-case/provider'
  };

  const auditError = auditSearchOperation(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newDocuments = [...state.documents, document];
  return {
    ...state,
    documents: newDocuments,
    lastError: null,
    lastAudit: auditEvent
  };
}

export function performSearch(
  state: SearchState,
  query: SearchQuery
): { readonly results: SearchResult[]; readonly error: SearchError | null } {
  if (!validateQueryScope(query)) {
    return {
      results: [],
      error: {
        kind: 'CROSS_TENANT_QUERY_REJECTED',
        message: 'Query must be properly scoped to tenant and organisation',
        tenantId: query.tenantId,
        organisationId: query.organisationId
      }
    };
  }

  if (state.readiness === 'BLOCKED') {
    return {
      results: [],
      error: {
        kind: 'SEARCH_ENGINE_UNAVAILABLE',
        message: 'Search engine is blocked',
        tenantId: query.tenantId,
        organisationId: query.organisationId
      }
    };
  }

  const tenantDocs = state.documents.filter(doc =>
    doc.tenantId === query.tenantId &&
    doc.organisationId === query.organisationId
  );

  const results: SearchResult[] = tenantDocs
    .filter(doc => query.documentType === undefined || doc.documentType === query.documentType)
    .map(doc => {
      if (doc.permissionKey !== undefined && query.permissionKey !== doc.permissionKey) {
        return { document: doc, decision: 'DENIED' };
      }
      return { document: doc, decision: 'GRANTED' };
    });

  return { results, error: null };
}

export function reindexTenant(
  state: SearchState,
  tenantId: string,
  organisationId: string,
  documents: readonly unknown[],
  auditFn: (event: SearchAuditEvent) => SearchError | null
): SearchState | SearchError {
  if (state.readiness !== 'READY') {
    return {
      kind: 'INDEX_MUTATION_DISABLED',
      message: 'Search engine not ready for mutations',
      tenantId,
      organisationId
    };
  }

  const validatedDocs: IndexedDocument[] = [];
  for (const doc of documents) {
    if (!validateDocumentShape(doc)) {
      return {
        kind: 'DOCUMENT_VALIDATION_FAILURE',
        message: 'Invalid document shape during reindex',
        tenantId,
        organisationId
      };
    }
    if (containsSecretFields(doc.metadata)) {
      return {
        kind: 'SECRET_FIELD_DETECTED',
        message: 'Document metadata contains secret fields during reindex',
        tenantId,
        organisationId
      };
    }
    if (doc.tenantId !== tenantId || doc.organisationId !== organisationId) {
      return {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: 'Reindex documents must belong to the specified tenant and organisation',
        tenantId,
        organisationId
      };
    }
    validatedDocs.push(doc);
  }

  const auditEvent: SearchAuditEvent = {
    kind: 'AUDIT_BEFORE_REINDEX',
    tenantId,
    organisationId,
    operation: 'reindex_tenant',
    timestamp: new Date().toISOString(),
    span: 'route/use-case/provider'
  };

  const auditError = auditSearchOperation(auditEvent, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const newDocuments = state.documents.filter(doc =>
    !(doc.tenantId === tenantId && doc.organisationId === organisationId)
  );
  newDocuments.push(...validatedDocs);

  return {
    ...state,
    documents: newDocuments,
    lastError: null,
    lastAudit: auditEvent
  };
}

export function probeReadiness(
  state: SearchState,
  engineStatus: SearchReadiness
): SearchState {
  const probe: SearchEngineProbe = {
    status: engineStatus,
    timestamp: new Date().toISOString()
  };

  return {
    ...state,
    readiness: engineStatus,
    probeHistory: [...state.probeHistory, probe]
  };
}

export function checkSearchIsolation(
  state: SearchState,
  query: SearchQuery
): { readonly isolated: boolean; readonly error: SearchError | null } {
  const result = performSearch(state, query);
  if (result.error !== null) {
    return { isolated: false, error: result.error };
  }

  const hasOtherTenantDocs = state.documents.some(doc =>
    doc.tenantId !== query.tenantId || doc.organisationId !== query.organisationId
  );

  const hasResultsFromOtherTenants = result.results.some(r =>
    r.document.tenantId !== query.tenantId || r.document.organisationId !== query.organisationId
  );

  if (hasResultsFromOtherTenants) {
    return {
      isolated: false,
      error: {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: 'Search returned documents from other tenants',
        tenantId: query.tenantId,
        organisationId: query.organisationId
      }
    };
  }

  return { isolated: true, error: null };
}

export function searchRoutesProof(
  state: SearchState,
  query: SearchQuery
): { readonly passed: boolean; readonly error: SearchError | null } {
  const result = performSearch(state, query);
  if (result.error !== null) {
    return { passed: false, error: result.error };
  }

  const crossTenantQuery: SearchQuery = {
    ...query,
    tenantId: 'foreign-tenant',
    organisationId: 'foreign-org'
  };
  const crossTenantResult = performSearch(state, crossTenantQuery);
  if (crossTenantResult.results.length > 0) {
    return {
      passed: false,
      error: {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: 'Cross-tenant query returned results',
        tenantId: query.tenantId,
        organisationId: query.organisationId
      }
    };
  }

  return { passed: true, error: null };
}

export const initialState: SearchState = {
  readiness: 'BLOCKED',
  documents: [],
  lastError: null,
  lastAudit: null,
  probeHistory: []
};