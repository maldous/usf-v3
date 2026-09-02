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
  'MISSING_ISOLATION_SIGNAL',
  'MISSING_AUDIT_SIGNAL',
  'PERMISSION_DENIED',
  'SEARCH_ENGINE_DEGRADED',
  'SEARCH_ENGINE_BLOCKED',
] as const;
export type SearchErrorKind = typeof SearchErrorKind[number];

export const SearchAuditEventKind = [
  'AUDIT_BEFORE_INDEX',
  'AUDIT_BEFORE_REINDEX',
  'AUDIT_BEFORE_SEARCH',
  'AUDIT_BEFORE_READINESS',
] as const;
export type SearchAuditEventKind = typeof SearchAuditEventKind[number];

export const SearchPermissionDecision = ['GRANTED', 'DENIED'] as const;
export type SearchPermissionDecision = typeof SearchPermissionDecision[number];

export const SearchProofKind = [
  'SEARCH_PROOF',
  'SEARCH_ISOLATION_PROOF',
  'SEARCH_ROUTES_PROOF',
] as const;
export type SearchProofKind = typeof SearchProofKind[number];

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

export interface SearchProofResult {
  readonly kind: SearchProofKind;
  readonly passed: boolean;
  readonly error: SearchError | null;
}

export interface SearchState {
  readonly readiness: SearchReadiness;
  readonly documents: readonly IndexedDocument[];
  readonly lastError: SearchError | null;
  readonly lastAudit: SearchAuditEvent | null;
  readonly probeHistory: readonly SearchEngineProbe[];
  readonly proofHistory: readonly SearchProofResult[];
  readonly indexMutationClosed: boolean;
  readonly readinessProbeFailed: boolean;
}

export type SearchOutcome =
  | { readonly ok: true; readonly state: SearchState }
  | { readonly ok: false; readonly error: SearchError };

export type SearchQueryOutcome =
  | { readonly ok: true; readonly results: readonly SearchResult[]; readonly state: SearchState }
  | { readonly ok: false; readonly error: SearchError };

export type ReadinessOutcome =
  | { readonly ok: true; readonly state: SearchState }
  | { readonly ok: false; readonly error: SearchError };

const SECRET_FIELD_PATTERNS: readonly string[] = [
  'password', 'token', 'secret', 'apikey', 'api_key', 'credential',
  'private_key', 'access_key', 'auth_token', 'session_id'
];

export function containsSecretFields(metadata: Record<string, string>): boolean {
  const metadataKeys = Object.keys(metadata).map(k => k.toLowerCase());
  return SECRET_FIELD_PATTERNS.some(pattern =>
    metadataKeys.some(key => key.includes(pattern))
  );
}

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

export function auditSearchOperation(
  event: SearchAuditEvent,
  auditFn: (event: SearchAuditEvent) => SearchError | null
): SearchError | null {
  try {
    const result = auditFn(event);
    if (result === null) {
      return null;
    }
    return {
      kind: 'AUDIT_FAILURE',
      message: result.message,
      tenantId: event.tenantId,
      organisationId: event.organisationId
    };
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit function threw',
      tenantId: event.tenantId,
      organisationId: event.organisationId
    };
  }
}

export function isReadinessKnown(state: SearchState): boolean {
  return state.probeHistory.length > 0;
}

export function isIsolationSignalPresent(state: SearchState): boolean {
  return state.proofHistory.some(p => p.kind === 'SEARCH_ISOLATION_PROOF' && p.passed);
}

export function isAuditSignalPresent(state: SearchState): boolean {
  return state.lastAudit !== null;
}

export function makeError(
  kind: SearchErrorKind,
  message: string,
  tenantId: string,
  organisationId: string
): SearchError {
  return { kind, message, tenantId, organisationId };
}

function applyMutation(
  state: SearchState,
  auditEvent: SearchAuditEvent,
  auditFn: (event: SearchAuditEvent) => SearchError | null,
  mutation: (validated: SearchState) => SearchState
): SearchOutcome {
  const auditError = auditSearchOperation(auditEvent, auditFn);
  if (auditError !== null) {
    return { ok: false, error: auditError };
  }
  return { ok: true, state: mutation(state) };
}

export function evaluatePermissionGate(
  document: IndexedDocument,
  query: SearchQuery
): SearchPermissionDecision {
  const docHasKey = document.permissionKey !== undefined && document.permissionKey !== '';
  const queryHasKey = query.permissionKey !== undefined && query.permissionKey !== '';

  if (docHasKey && queryHasKey) {
    return document.permissionKey === query.permissionKey ? 'GRANTED' : 'DENIED';
  }

  if (docHasKey && !queryHasKey) {
    return 'DENIED';
  }

  return 'GRANTED';
}

export function enforceRowLevelSecurityPredicate(
  document: IndexedDocument,
  tenantId: string,
  organisationId: string
): boolean {
  return document.tenantId === tenantId && document.organisationId === organisationId;
}

export function indexDocument(
  state: SearchState,
  document: unknown,
  auditFn: (event: SearchAuditEvent) => SearchError | null
): SearchOutcome {
  if (!validateDocumentShape(document)) {
    return {
      ok: false,
      error: makeError(
        'DOCUMENT_VALIDATION_FAILURE',
        'Invalid document shape',
        '',
        ''
      )
    };
  }

  if (containsSecretFields(document.metadata)) {
    return {
      ok: false,
      error: makeError(
        'SECRET_FIELD_DETECTED',
        'Document metadata contains secret fields',
        document.tenantId,
        document.organisationId
      )
    };
  }

  if (!validateUniqueness(state.documents, document)) {
    return {
      ok: false,
      error: makeError(
        'UNIQUENESS_VIOLATION',
        'Document with tenant/type/id already exists',
        document.tenantId,
        document.organisationId
      )
    };
  }

  if (state.indexMutationClosed || state.readiness !== 'READY') {
    return {
      ok: false,
      error: makeError(
        'INDEX_MUTATION_DISABLED',
        `Search engine is ${state.readiness}; index mutations disabled`,
        document.tenantId,
        document.organisationId
      )
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

  return applyMutation(state, auditEvent, auditFn, (s) => ({
    ...s,
    documents: [...s.documents, document],
    lastError: null,
    lastAudit: auditEvent
  }));
}

export function performSearch(
  state: SearchState,
  query: SearchQuery,
  auditFn?: (event: SearchAuditEvent) => SearchError | null
): SearchQueryOutcome {
  if (!validateQueryScope(query)) {
    return {
      ok: false,
      error: makeError(
        'CROSS_TENANT_QUERY_REJECTED',
        'Query must be properly scoped to tenant and organisation',
        query.tenantId,
        query.organisationId
      )
    };
  }

  if (state.readiness === 'BLOCKED' || state.readinessProbeFailed) {
    return {
      ok: false,
      error: makeError(
        'SEARCH_ENGINE_BLOCKED',
        `Search engine is BLOCKED; cannot serve results`,
        query.tenantId,
        query.organisationId
      )
    };
  }

  if (state.readiness === 'DEGRADED') {
    return {
      ok: false,
      error: makeError(
        'SEARCH_ENGINE_DEGRADED',
        `Search engine is DEGRADED; cannot serve results`,
        query.tenantId,
        query.organisationId
      )
    };
  }

  const auditEvent: SearchAuditEvent = {
    kind: 'AUDIT_BEFORE_SEARCH',
    tenantId: query.tenantId,
    organisationId: query.organisationId,
    operation: 'perform_search',
    timestamp: new Date().toISOString(),
    span: 'route/use-case/provider'
  };

  let recordedState: SearchState = state;
  if (auditFn !== undefined) {
    const auditError = auditSearchOperation(auditEvent, auditFn);
    if (auditError !== null) {
      return { ok: false, error: auditError };
    }
    recordedState = { ...state, lastAudit: auditEvent };
  }

  const tenantDocs = state.documents.filter(doc =>
    enforceRowLevelSecurityPredicate(doc, query.tenantId, query.organisationId)
  );

  const typeFiltered = query.documentType === undefined
    ? tenantDocs
    : tenantDocs.filter(doc => doc.documentType === query.documentType);

  const evaluated: SearchResult[] = typeFiltered.map(doc => ({
    document: doc,
    decision: evaluatePermissionGate(doc, query)
  }));

  const grantedResults = evaluated.filter(r => r.decision === 'GRANTED');

  return {
    ok: true,
    results: grantedResults,
    state: recordedState
  };
}

export function reindexTenant(
  state: SearchState,
  tenantId: string,
  organisationId: string,
  documents: readonly unknown[],
  auditFn: (event: SearchAuditEvent) => SearchError | null
): SearchOutcome {
  if (tenantId === '' || organisationId === '') {
    return {
      ok: false,
      error: makeError(
        'CROSS_TENANT_QUERY_REJECTED',
        'Reindex requires tenant and organisation identifier',
        tenantId,
        organisationId
      )
    };
  }

  if (state.indexMutationClosed || state.readiness !== 'READY') {
    return {
      ok: false,
      error: makeError(
        'INDEX_MUTATION_DISABLED',
        `Search engine is ${state.readiness}; index mutations disabled`,
        tenantId,
        organisationId
      )
    };
  }

  const validatedDocs: IndexedDocument[] = [];
  for (const doc of documents) {
    if (!validateDocumentShape(doc)) {
      return {
        ok: false,
        error: makeError(
          'DOCUMENT_VALIDATION_FAILURE',
          'Invalid document shape during reindex',
          tenantId,
          organisationId
        )
      };
    }
    if (containsSecretFields(doc.metadata)) {
      return {
        ok: false,
        error: makeError(
          'SECRET_FIELD_DETECTED',
          'Document metadata contains secret fields during reindex',
          tenantId,
          organisationId
        )
      };
    }
    if (doc.tenantId !== tenantId || doc.organisationId !== organisationId) {
      return {
        ok: false,
        error: makeError(
          'TENANT_ISOLATION_VIOLATION',
          'Reindex documents must belong to the specified tenant and organisation',
          tenantId,
          organisationId
        )
      };
    }
    if (!validateUniqueness(validatedDocs, doc)) {
      return {
        ok: false,
        error: makeError(
          'UNIQUENESS_VIOLATION',
          'Duplicate tenant/type/documentId within reindex batch',
          tenantId,
          organisationId
        )
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

  return applyMutation(state, auditEvent, auditFn, (s) => {
    const retained = s.documents.filter(doc =>
      !(doc.tenantId === tenantId && doc.organisationId === organisationId)
    );
    return {
      ...s,
      documents: [...retained, ...validatedDocs],
      lastError: null,
      lastAudit: auditEvent
    }
  });
}

export function probeReadiness(
  state: SearchState,
  engineStatus: SearchReadiness,
  auditFn: (event: SearchAuditEvent) => SearchError | null
): ReadinessOutcome {
  const probe: SearchEngineProbe = {
    status: engineStatus,
    timestamp: new Date().toISOString()
  };

  const auditEvent: SearchAuditEvent = {
    kind: 'AUDIT_BEFORE_READINESS',
    tenantId: '',
    organisationId: '',
    operation: 'probe_readiness',
    timestamp: new Date().toISOString(),
    span: 'route/use-case/provider'
  };

  const auditError = auditSearchOperation(auditEvent, auditFn);
  if (auditError !== null) {
    return { ok: false, error: auditError };
  }

  return {
    ok: true,
    state: {
      ...state,
      readiness: engineStatus,
      indexMutationClosed: engineStatus !== 'READY',
      readinessProbeFailed: engineStatus === 'BLOCKED',
      probeHistory: [...state.probeHistory, probe],
      lastAudit: auditEvent
    }
  };
}

export function probeReadinessForTenant(
  state: SearchState,
  engineStatus: SearchReadiness,
  tenantId: string,
  organisationId: string,
  auditFn: (event: SearchAuditEvent) => SearchError | null
): ReadinessOutcome {
  const probe: SearchEngineProbe = {
    status: engineStatus,
    timestamp: new Date().toISOString()
  };

  const auditEvent: SearchAuditEvent = {
    kind: 'AUDIT_BEFORE_READINESS',
    tenantId,
    organisationId,
    operation: 'probe_readiness',
    timestamp: new Date().toISOString(),
    span: 'route/use-case/provider'
  };

  const auditError = auditSearchOperation(auditEvent, auditFn);
  if (auditError !== null) {
    return { ok: false, error: auditError };
  }

  return {
    ok: true,
    state: {
      ...state,
      readiness: engineStatus,
      indexMutationClosed: engineStatus !== 'READY',
      readinessProbeFailed: engineStatus === 'BLOCKED',
      probeHistory: [...state.probeHistory, probe],
      lastAudit: auditEvent
    }
  };
}

export function checkSearchIsolation(
  state: SearchState,
  query: SearchQuery
): { readonly isolated: boolean; readonly error: SearchError | null; readonly proof: SearchProofResult } {
  const result = performSearch(state, query);

  if (!result.ok) {
    const proof: SearchProofResult = {
      kind: 'SEARCH_ISOLATION_PROOF',
      passed: false,
      error: result.error
    };
    return { isolated: false, error: result.error, proof };
  }

  const hasResultsFromOtherTenants = result.results.some(r =>
    !enforceRowLevelSecurityPredicate(r.document, query.tenantId, query.organisationId)
  );

  if (hasResultsFromOtherTenants) {
    const err = makeError(
      'TENANT_ISOLATION_VIOLATION',
      'Search returned documents from other tenants',
      query.tenantId,
      query.organisationId
    );
    const proof: SearchProofResult = {
      kind: 'SEARCH_ISOLATION_PROOF',
      passed: false,
      error: err
    };
    return { isolated: false, error: err, proof };
  }

  const proof: SearchProofResult = {
    kind: 'SEARCH_ISOLATION_PROOF',
    passed: true,
    error: null
  };
  return { isolated: true, error: null, proof };
}

export function searchRoutesProof(
  state: SearchState,
  query: SearchQuery
): { readonly passed: boolean; readonly error: SearchError | null; readonly proof: SearchProofResult } {
  const result = performSearch(state, query);
  if (!result.ok) {
    const proof: SearchProofResult = {
      kind: 'SEARCH_ROUTES_PROOF',
      passed: false,
      error: result.error
    };
    return { passed: false, error: result.error, proof };
  }

  const crossTenantQuery: SearchQuery = {
    tenantId: 'foreign-tenant',
    organisationId: 'foreign-org',
    query: query.query
  };
  const crossTenantResult = performSearch(state, crossTenantQuery);
  if (crossTenantResult.ok && crossTenantResult.results.length > 0) {
    const err = makeError(
      'TENANT_ISOLATION_VIOLATION',
      'Cross-tenant query returned results',
      query.tenantId,
      query.organisationId
    );
    const proof: SearchProofResult = {
      kind: 'SEARCH_ROUTES_PROOF',
      passed: false,
      error: err
    };
    return { passed: false, error: err, proof };
  }

  const proof: SearchProofResult = {
    kind: 'SEARCH_ROUTES_PROOF',
    passed: true,
    error: null
  };
  return { passed: true, error: null, proof };
}

export function runSearchProof(
  state: SearchState,
  query: SearchQuery
): { readonly passed: boolean; readonly error: SearchError | null; readonly proof: SearchProofResult } {
  const result = performSearch(state, query);
  if (!result.ok) {
    const proof: SearchProofResult = {
      kind: 'SEARCH_PROOF',
      passed: false,
      error: result.error
    };
    return { passed: false, error: result.error, proof };
  }

  const proof: SearchProofResult = {
    kind: 'SEARCH_PROOF',
    passed: true,
    error: null
  };
  return { passed: true, error: null, proof };
}

export function recordProof(
  state: SearchState,
  proof: SearchProofResult
): SearchState {
  return {
    ...state,
    proofHistory: [...state.proofHistory, proof]
  };
}

export function checkPromotionGates(
  state: SearchState
): { readonly allowed: boolean; readonly errors: readonly SearchError[] } {
  const errors: SearchError[] = [];

  if (state.readiness === 'BLOCKED') {
    errors.push(makeError(
      'READINESS_PROBE_FAILED',
      'Readiness is BLOCKED',
      '',
      ''
    ));
  }

  if (!isIsolationSignalPresent(state)) {
    errors.push(makeError(
      'MISSING_ISOLATION_SIGNAL',
      'Missing isolation signal',
      '',
      ''
    ));
  }

  if (!isAuditSignalPresent(state)) {
    errors.push(makeError(
      'MISSING_AUDIT_SIGNAL',
      'Missing audit signal',
      '',
      ''
    ));
  }

  const failedProof = state.proofHistory.find(p => !p.passed);
  if (failedProof !== undefined && failedProof.error !== null) {
    errors.push(failedProof.error);
  }

  return { allowed: errors.length === 0, errors };
}

export function crossTenantIsolationAssertion(
  state: SearchState,
  tenantId: string,
  organisationId: string,
  documentType?: string
): { readonly isolated: boolean; readonly error: SearchError | null } {
  const query: SearchQuery = {
    tenantId,
    organisationId,
    query: '',
    documentType
  };

  const result = performSearch(state, query);

  if (!result.ok) {
    return { isolated: true, error: result.error };
  }

  const hasForeignDocs = result.results.some(r =>
    !enforceRowLevelSecurityPredicate(r.document, tenantId, organisationId)
  );

  if (hasForeignDocs) {
    return {
      isolated: false,
      error: makeError(
        'TENANT_ISOLATION_VIOLATION',
        'Cross-tenant isolation assertion failed',
        tenantId,
        organisationId
      )
    };
  }

  return { isolated: true, error: null };
}

export function evaluateProviderFailure(
  tenantId: string,
  organisationId: string,
  providerMessage: string
): SearchError {
  return makeError(
    'SEARCH_ENGINE_UNAVAILABLE',
    `Provider failure: ${providerMessage}`,
    tenantId,
    organisationId
  );
}

export function evaluateReadinessBlockedFailure(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'SEARCH_ENGINE_BLOCKED',
    'Readiness probe reports BLOCKED status; cannot serve results',
    tenantId,
    organisationId
  );
}

export function evaluateReadinessDegradedFailure(
  tenantId: string,
  organisationId: string,
  details?: string
): SearchError {
  return makeError(
    'SEARCH_ENGINE_DEGRADED',
    details === undefined
      ? 'Readiness probe reports DEGRADED status; cannot serve results'
      : `Readiness probe reports DEGRADED status; cannot serve results: ${details}`,
    tenantId,
    organisationId
  );
}

export function evaluatePermissionKeyRequired(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'PERMISSION_KEY_REQUIRED',
    'Query missing required permission key for tenant-scoped documents',
    tenantId,
    organisationId
  );
}

export function evaluateMissingIsolationSignal(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'MISSING_ISOLATION_SIGNAL',
    'Isolation signal missing for tenant scope',
    tenantId,
    organisationId
  );
}

export function evaluateMissingAuditSignal(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'MISSING_AUDIT_SIGNAL',
    'Audit signal missing for tenant scope',
    tenantId,
    organisationId
  );
}

export function evaluatePermissionDenied(
  tenantId: string,
  organisationId: string,
  documentId: string
): SearchError {
  return makeError(
    'PERMISSION_DENIED',
    `Permission denied for document ${documentId} in tenant scope`,
    tenantId,
    organisationId
  );
}

export function evaluateReadinessProbeFailure(
  tenantId: string,
  organisationId: string,
  details?: string
): SearchError {
  return makeError(
    'READINESS_PROBE_FAILED',
    details === undefined
      ? 'Readiness probe failed'
      : `Readiness probe failed: ${details}`,
    tenantId,
    organisationId
  );
}

export function evaluateIndexMutationDisabled(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'INDEX_MUTATION_DISABLED',
    'Index mutation disabled; readiness is not READY',
    tenantId,
    organisationId
  );
}

export function evaluateDocumentValidationFailure(
  tenantId: string,
  organisationId: string,
  details?: string
): SearchError {
  return makeError(
    'DOCUMENT_VALIDATION_FAILURE',
    details === undefined
      ? 'Document shape validation failed'
      : `Document shape validation failed: ${details}`,
    tenantId,
    organisationId
  );
}

export function evaluateUniquenessViolation(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'UNIQUENESS_VIOLATION',
    'Document violates uniqueness on tenant/type/documentId',
    tenantId,
    organisationId
  );
}

export function evaluateSecretFieldDetected(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'SECRET_FIELD_DETECTED',
    'Secret field detected in document metadata',
    tenantId,
    organisationId
  );
}

export function evaluateTenantIsolationViolation(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'TENANT_ISOLATION_VIOLATION',
    'Document does not belong to specified tenant scope',
    tenantId,
    organisationId
  );
}

export function evaluateCrossTenantQueryRejected(
  tenantId: string,
  organisationId: string
): SearchError {
  return makeError(
    'CROSS_TENANT_QUERY_REJECTED',
    'Cross-tenant or unscoped query rejected',
    tenantId,
    organisationId
  );
}

export function evaluateAuditFailure(
  tenantId: string,
  organisationId: string,
  details?: string
): SearchError {
  return makeError(
    'AUDIT_FAILURE',
    details === undefined
      ? 'Audit failure'
      : `Audit failure: ${details}`,
    tenantId,
    organisationId
  );
}

export function isMutationClosed(
  state: SearchState,
  error: SearchError
): boolean {
  if (error.kind === 'SEARCH_ENGINE_UNAVAILABLE' ||
      error.kind === 'SEARCH_ENGINE_DEGRADED' ||
      error.kind === 'SEARCH_ENGINE_BLOCKED' ||
      error.kind === 'READINESS_PROBE_FAILED' ||
      error.kind === 'INDEX_MUTATION_DISABLED') {
    return state.readiness !== 'READY' || state.indexMutationClosed;
  }
  return false;
}

export function reportProviderFailure(
  state: SearchState,
  tenantId: string,
  organisationId: string,
  providerMessage: string
): SearchState {
  const error = evaluateProviderFailure(tenantId, organisationId, providerMessage);
  return {
    ...state,
    readiness: 'DEGRADED',
    indexMutationClosed: true,
    readinessProbeFailed: false,
    lastError: error,
    probeHistory: [...state.probeHistory, {
      status: 'DEGRADED',
      timestamp: new Date().toISOString(),
      details: providerMessage
    }]
  };
}

export const initialState: SearchState = {
  readiness: 'BLOCKED',
  documents: [],
  lastError: null,
  lastAudit: null,
  probeHistory: [],
  proofHistory: [],
  indexMutationClosed: true,
  readinessProbeFailed: true
};