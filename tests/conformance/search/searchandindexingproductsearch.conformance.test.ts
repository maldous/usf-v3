import assert from 'node:assert/strict';
import test from 'node:test';
import * as capability from '../../../src/capabilities/search/searchandindexingproductsearch.ts';

test('searchandindexingproductsearchauditmodel', () => {
  const auditFn = () => null;
  const state: capability.SearchState = {
    readiness: 'READY',
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const secretDoc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Secret',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: { password: 'hunter2' }
  };
  const secretResult = capability.indexDocument(state, secretDoc, auditFn);
  assert.ok('kind' in secretResult);
  assert.strictEqual(secretResult.kind, 'SECRET_FIELD_DETECTED');
  assert.strictEqual(secretResult.tenantId, 't1');
  assert.strictEqual(secretResult.organisationId, 'o1');

  const auditError: capability.SearchError = {
    kind: 'AUDIT_FAILURE',
    message: 'Audit denied',
    tenantId: 't1',
    organisationId: 'o1'
  };
  const auditFnError = () => auditError;
  const validDoc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd2',
    documentType: 'note',
    title: 'Valid',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const auditResult = capability.indexDocument(state, validDoc, auditFnError);
  assert.ok('kind' in auditResult);
  assert.strictEqual(auditResult.kind, 'AUDIT_FAILURE');
  assert.strictEqual(auditResult.tenantId, 't1');
  assert.strictEqual(auditResult.organisationId, 'o1');

  let probeState = capability.initialState;
  assert.strictEqual(probeState.readiness, 'BLOCKED');
  probeState = capability.probeReadiness(probeState, 'READY');
  assert.strictEqual(probeState.readiness, 'READY');
  assert.strictEqual(probeState.probeHistory.length, 1);
  assert.strictEqual(probeState.probeHistory[0].status, 'READY');
});

test('searchandindexingproductsearchcontracts', () => {
  const auditFn = () => null;
  const initialState: capability.SearchState = {
    readiness: 'READY',
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const validDoc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const indexResult = capability.indexDocument(initialState, validDoc, auditFn);
  assert.ok(!('kind' in indexResult));
  assert.strictEqual(indexResult.documents.length, 1);
  assert.strictEqual(indexResult.documents[0].documentId, 'd1');

  const searchQuery: capability.SearchQuery = {
    tenantId: 't1',
    organisationId: 'o1',
    query: 'test'
  };
  const searchResult = capability.performSearch(indexResult, searchQuery);
  assert.strictEqual(searchResult.error, null);
  assert.strictEqual(searchResult.results.length, 1);
  assert.strictEqual(searchResult.results[0].document.documentId, 'd1');
  assert.strictEqual(searchResult.results[0].decision, 'GRANTED');

  const docForReindex: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd2',
    documentType: 'note',
    title: 'Reindexed',
    searchVector: 'vector2',
    indexName: 'idx',
    url: 'http://example.com/2',
    metadata: {}
  };
  const reindexResult = capability.reindexTenant(indexResult, 't1', 'o1', [docForReindex], auditFn);
  assert.ok(!('kind' in reindexResult));
  assert.strictEqual(reindexResult.documents.length, 2);
  const ids = reindexResult.documents.map(d => d.documentId).sort();
  assert.deepStrictEqual(ids, ['d1', 'd2']);
});

test('searchandindexingproductsearcherrormodel', () => {
  const tenantDoc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Tenant 1',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const stateWithDoc: capability.SearchState = {
    readiness: 'READY',
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const foreignQuery: capability.SearchQuery = {
    tenantId: 't2',
    organisationId: 'o1',
    query: 'test'
  };
  const foreignResult = capability.performSearch(stateWithDoc, foreignQuery);
  assert.strictEqual(foreignResult.results.length, 0);
  assert.strictEqual(foreignResult.error, null);

  const blockedState: capability.SearchState = {
    readiness: 'BLOCKED',
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  const blockedResult = capability.performSearch(blockedState, foreignQuery);
  assert.ok(blockedResult.error);
  assert.strictEqual(blockedResult.error.kind, 'SEARCH_ENGINE_UNAVAILABLE');
  assert.strictEqual(blockedResult.results.length, 0);

  const degradedState: capability.SearchState = {
    readiness: 'DEGRADED',
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  const degradedResult = capability.performSearch(degradedState, foreignQuery);
  assert.strictEqual(degradedResult.error, null);
  assert.strictEqual(degradedResult.results.length, 0);

  const docForMutation: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd2',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const auditFn = () => null;
  const degradedIndexResult = capability.indexDocument(degradedState, docForMutation, auditFn);
  assert.ok('kind' in degradedIndexResult);
  assert.strictEqual(degradedIndexResult.kind, 'INDEX_MUTATION_DISABLED');
});

test('searchandindexingproductsearchlifecycle', () => {
  let state = capability.initialState;
  assert.strictEqual(state.readiness, 'BLOCKED');

  state = capability.probeReadiness(state, 'READY');
  assert.strictEqual(state.readiness, 'READY');
  assert.strictEqual(state.probeHistory.length, 1);
  assert.strictEqual(state.probeHistory[0].status, 'READY');

  state = capability.probeReadiness(state, 'DEGRADED');
  assert.strictEqual(state.readiness, 'DEGRADED');
  assert.strictEqual(state.probeHistory.length, 2);
  assert.strictEqual(state.probeHistory[1].status, 'DEGRADED');

  const doc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const auditFn = () => null;
  const indexResult = capability.indexDocument(state, doc, auditFn);
  assert.ok('kind' in indexResult);
  assert.strictEqual(indexResult.kind, 'INDEX_MUTATION_DISABLED');

  state = capability.probeReadiness(state, 'READY');
  const readyIndexResult = capability.indexDocument(state, doc, auditFn);
  assert.ok(!('kind' in readyIndexResult));
  assert.strictEqual(readyIndexResult.documents.length, 1);

  const otherTenantDoc: capability.IndexedDocument = {
    tenantId: 't2',
    organisationId: 'o1',
    documentId: 'd2',
    documentType: 'note',
    title: 'Other',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com/other',
    metadata: {}
  };
  const stateWithOther = capability.indexDocument(readyIndexResult, otherTenantDoc, auditFn);
  assert.ok(!('kind' in stateWithOther));
  assert.strictEqual(stateWithOther.documents.length, 2);
  const reindexed = capability.reindexTenant(stateWithOther, 't1', 'o1', [doc], auditFn);
  assert.ok(!('kind' in reindexed));
  assert.strictEqual(reindexed.documents.length, 1);
  assert.strictEqual(reindexed.documents[0].tenantId, 't1');
});

test('searchandindexingproductsearchpermissions', () => {
  const docWithPerm: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Restricted',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {},
    permissionKey: 'keyA'
  };
  const docWithoutPerm: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd2',
    documentType: 'note',
    title: 'Public',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com/2',
    metadata: {}
  };
  const state: capability.SearchState = {
    readiness: 'READY',
    documents: [docWithPerm, docWithoutPerm],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const queryWithKey: capability.SearchQuery = {
    tenantId: 't1',
    organisationId: 'o1',
    query: 'test',
    permissionKey: 'keyA'
  };
  const resultWithKey = capability.performSearch(state, queryWithKey);
  assert.strictEqual(resultWithKey.results.length, 2);
  const granted = resultWithKey.results.find(r => r.document.documentId === 'd1');
  const denied = resultWithKey.results.find(r => r.document.documentId === 'd2');
  assert.ok(granted && granted.decision === 'GRANTED');
  assert.ok(denied && denied.decision === 'DENIED');

  const queryNoKey: capability.SearchQuery = {
    tenantId: 't1',
    organisationId: 'o1',
    query: 'test'
  };
  const resultNoKey = capability.performSearch(state, queryNoKey);
  assert.strictEqual(resultNoKey.results.length, 2);
  const allGranted = resultNoKey.results.every(r => r.decision === 'GRANTED');
  assert.ok(allGranted);
});

test('searchandindexingproductsearchproof', () => {
  const tenant1Doc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Tenant 1',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const state: capability.SearchState = {
    readiness: 'READY',
    documents: [tenant1Doc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const foreignQuery: capability.SearchQuery = {
    tenantId: 't2',
    organisationId: 'o1',
    query: 'test'
  };
  const searchResult = capability.performSearch(state, foreignQuery);
  assert.strictEqual(searchResult.results.length, 0);
  assert.strictEqual(searchResult.error, null);

  const isolationResult = capability.checkSearchIsolation(state, foreignQuery);
  assert.strictEqual(isolationResult.isolated, false);
  assert.ok(isolationResult.error);
  assert.strictEqual(isolationResult.error.kind, 'TENANT_ISOLATION_VIOLATION');

  const sameQuery: capability.SearchQuery = {
    tenantId: 't1',
    organisationId: 'o1',
    query: 'test'
  };
  const sameSearch = capability.performSearch(state, sameQuery);
  assert.strictEqual(sameSearch.results.length, 1);
  const sameIsolation = capability.checkSearchIsolation(state, sameQuery);
  assert.strictEqual(sameIsolation.isolated, true);
  assert.strictEqual(sameIsolation.error, null);
});

test('searchandindexingproductsearchreadinessmodel', () => {
  let state = capability.initialState;
  assert.strictEqual(state.readiness, 'BLOCKED');

  state = capability.probeReadiness(state, 'READY');
  assert.strictEqual(state.readiness, 'READY');
  assert.strictEqual(state.probeHistory[0].status, 'READY');

  state = capability.probeReadiness(state, 'DEGRADED');
  assert.strictEqual(state.readiness, 'DEGRADED');
  assert.strictEqual(state.probeHistory[1].status, 'DEGRADED');

  state = capability.probeReadiness(state, 'BLOCKED');
  assert.strictEqual(state.readiness, 'BLOCKED');
  assert.strictEqual(state.probeHistory[2].status, 'BLOCKED');

  const doc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const auditFn = () => null;

  const readyResult = capability.indexDocument(state, doc, auditFn);
  assert.ok('kind' in readyResult);
  assert.strictEqual(readyResult.kind, 'INDEX_MUTATION_DISABLED');

  state = capability.probeReadiness(state, 'READY');
  const readyIndexResult = capability.indexDocument(state, doc, auditFn);
  assert.ok(!('kind' in readyIndexResult));
  assert.strictEqual(readyIndexResult.documents.length, 1);

  state = capability.probeReadiness(state, 'DEGRADED');
  const degradedResult = capability.indexDocument(state, doc, auditFn);
  assert.ok('kind' in degradedResult);
  assert.strictEqual(degradedResult.kind, 'INDEX_MUTATION_DISABLED');

  state = capability.probeReadiness(state, 'BLOCKED');
  const blockedResult = capability.indexDocument(state, doc, auditFn);
  assert.ok('kind' in blockedResult);
  assert.strictEqual(blockedResult.kind, 'INDEX_MUTATION_DISABLED');

  const blockedSearch = capability.performSearch(state, {
    tenantId: 't1',
    organisationId: 'o1',
    query: 'test'
  });
  assert.ok(blockedSearch.error);
  assert.strictEqual(blockedSearch.error.kind, 'SEARCH_ENGINE_UNAVAILABLE');
});

test('searchandindexingproductsearchstatemodel', () => {
  const validDoc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  assert.ok(capability.validateDocumentShape(validDoc));

  const invalidDoc = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: 'not-an-object'
  };
  assert.ok(!capability.validateDocumentShape(invalidDoc));

  const doc1: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Doc1',
    searchVector: 'v1',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const doc2: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Doc2',
    searchVector: 'v2',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  const doc3: capability.IndexedDocument = {
    tenantId: 't2',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Doc3',
    searchVector: 'v3',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  assert.ok(!capability.validateUniqueness([doc1], doc2));
  assert.ok(capability.validateUniqueness([doc1], doc3));

  const secretDoc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd3',
    documentType: 'note',
    title: 'Secret',
    searchVector: 'v',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: { token: 'xyz' }
  };
  const state: capability.SearchState = {
    readiness: 'READY',
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  const auditFn = () => null;
  const secretResult = capability.indexDocument(state, secretDoc, auditFn);
  assert.ok('kind' in secretResult);
  assert.strictEqual(secretResult.kind, 'SECRET_FIELD_DETECTED');
});

test('searchandindexingproductsearchvalidation', () => {
  const validQuery: capability.SearchQuery = {
    tenantId: 't1',
    organisationId: 'o1',
    query: 'test'
  };
  assert.ok(capability.validateQueryScope(validQuery));

  const invalidQuery = {
    tenantId: '',
    organisationId: 'o1',
    query: 'test'
  };
  assert.ok(!capability.validateQueryScope(invalidQuery));

  const validDoc: capability.IndexedDocument = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: {}
  };
  assert.ok(capability.validateDocumentShape(validDoc));

  const invalidDoc = {
    tenantId: 't1',
    organisationId: 'o1',
    documentId: 'd1',
    documentType: 'note',
    title: 'Test',
    searchVector: 'vector',
    indexName: 'idx',
    url: 'http://example.com',
    metadata: 'not-an-object'
  };
  assert.ok(!capability.validateDocumentShape(invalidDoc));

  const state: capability.SearchState = {
    readiness: 'READY',
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  const invalidSearchQuery: capability.SearchQuery = {
    tenantId: '',
    organisationId: '',
    query: 'test'
  };
  const result = capability.performSearch(state, invalidSearchQuery);
  assert.ok(result.error);
  assert.strictEqual(result.error.kind, 'CROSS_TENANT_QUERY_REJECTED');
});