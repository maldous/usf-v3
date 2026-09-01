import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/search/searchandindexingproductsearch.ts";

test("searchandindexingproductsearchauditmodel", () => {
  const state: capability.SearchState = {
    readiness: "READY",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const secretDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Secret",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: { password: "hunter2" }
  };

  const secretResult = capability.indexDocument(state, secretDoc, () => null);
  assert.ok("kind" in secretResult);
  assert.strictEqual(secretResult.kind, "SECRET_FIELD_DETECTED");
  assert.strictEqual(secretResult.tenantId, "t1");
  assert.strictEqual(secretResult.organisationId, "o1");

  const auditError: capability.SearchError = {
    kind: "AUDIT_FAILURE",
    message: "Audit denied",
    tenantId: "t1",
    organisationId: "o1"
  };
  const auditFnError = () => auditError;
  const validDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d2",
    documentType: "note",
    title: "Valid",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  };
  const auditResult = capability.indexDocument(state, validDoc, auditFnError);
  assert.ok("kind" in auditResult);
  assert.strictEqual(auditResult.kind, "AUDIT_FAILURE");
  assert.strictEqual(auditResult.tenantId, "t1");
  assert.strictEqual(auditResult.organisationId, "o1");

  let probeState = capability.initialState;
  assert.strictEqual(probeState.readiness, "BLOCKED");
  probeState = capability.probeReadiness(probeState, "READY");
  assert.strictEqual(probeState.readiness, "READY");
  assert.strictEqual(probeState.probeHistory.length, 1);
  assert.strictEqual(probeState.probeHistory[0].status, "READY");
});

test("searchandindexingproductsearchcontracts", () => {
  const auditFn = () => null;
  const initialState: capability.SearchState = {
    readiness: "READY",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const validDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Test",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  };
  const indexResult = capability.indexDocument(initialState, validDoc, auditFn);
  if ("kind" in indexResult) throw new Error("Unexpected error");
  assert.strictEqual(indexResult.documents.length, 1);
  assert.strictEqual(indexResult.documents[0].documentId, "d1");

  const searchQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  const searchResult = capability.performSearch(indexResult, searchQuery);
  assert.strictEqual(searchResult.error, null);
  assert.strictEqual(searchResult.results.length, 1);
  assert.strictEqual(searchResult.results[0].document.documentId, "d1");
  assert.strictEqual(searchResult.results[0].decision, "GRANTED");

  const docForReindex: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d2",
    documentType: "note",
    title: "Reindexed",
    searchVector: "vector2",
    indexName: "idx",
    url: "http://example.com/2",
    metadata: {}
  };
  const reindexResult = capability.reindexTenant(indexResult, "t1", "o1", [docForReindex], auditFn);
  if ("kind" in reindexResult) throw new Error("Unexpected error");
  assert.strictEqual(reindexResult.documents.length, 2);
  const ids = reindexResult.documents.map(d => d.documentId).sort();
  assert.deepStrictEqual(ids, ["d1", "d2"]);
});

test("searchandindexingproductsearcherrormodel", () => {
  const tenantDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Tenant 1",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  };
  const stateWithDoc: capability.SearchState = {
    readiness: "READY",
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const foreignQuery: capability.SearchQuery = {
    tenantId: "t2",
    organisationId: "o1",
    query: "test"
  };
  const foreignResult = capability.performSearch(stateWithDoc, foreignQuery);
  assert.strictEqual(foreignResult.results.length, 0);
  assert.strictEqual(foreignResult.error, null);

  const blockedState: capability.SearchState = {
    readiness: "BLOCKED",
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  const blockedResult = capability.performSearch(blockedState, foreignQuery);
  assert.ok(blockedResult.error);
  assert.strictEqual(blockedResult.error.kind, "SEARCH_ENGINE_UNAVAILABLE");
  assert.strictEqual(blockedResult.results.length, 0);

  const degradedState: capability.SearchState = {
    readiness: "DEGRADED",
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  const degradedResult = capability.indexDocument(degradedState, tenantDoc, () => null);
  assert.ok("kind" in degradedResult);
  assert.strictEqual(degradedResult.kind, "INDEX_MUTATION_DISABLED");
});

test("searchandindexingproductsearchlifecycle", () => {
  const auditFn = () => null;
  const initialState = capability.initialState;
  assert.strictEqual(initialState.readiness, "BLOCKED");

  let state = capability.probeReadiness(initialState, "READY");
  assert.strictEqual(state.readiness, "READY");

  const doc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Test",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  };
  const indexResult = capability.indexDocument(state, doc, auditFn);
  if ("kind" in indexResult) throw new Error("Unexpected error");
  state = indexResult;

  const searchQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  const searchResult = capability.performSearch(state, searchQuery);
  assert.strictEqual(searchResult.error, null);
  assert.strictEqual(searchResult.results.length, 1);

  const reindexResult = capability.reindexTenant(state, "t1", "o1", [doc], auditFn);
  if ("kind" in reindexResult) throw new Error("Unexpected error");
  assert.strictEqual(reindexResult.documents.length, 1);
});

test("searchandindexingproductsearchpermissions", () => {
  const auditFn = () => null;
  const state: capability.SearchState = {
    readiness: "READY",
    documents: [
      {
        tenantId: "t1",
        organisationId: "o1",
        documentId: "d1",
        documentType: "note",
        title: "Public",
        searchVector: "vector",
        indexName: "idx",
        url: "http://example.com",
        metadata: {}
      } as capability.IndexedDocument,
      {
        tenantId: "t1",
        organisationId: "o1",
        documentId: "d2",
        documentType: "note",
        title: "Private",
        searchVector: "vector",
        indexName: "idx",
        url: "http://example.com/2",
        metadata: {},
        permissionKey: "secret"
      } as capability.IndexedDocument,
      {
        tenantId: "t2",
        organisationId: "o2",
        documentId: "d3",
        documentType: "note",
        title: "Other Tenant",
        searchVector: "vector",
        indexName: "idx",
        url: "http://example.com/3",
        metadata: {}
      } as capability.IndexedDocument
    ],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const query: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test",
    permissionKey: "wrong"
  };
  const result = capability.performSearch(state, query);
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.results.length, 2);
  assert.strictEqual(result.results[0].decision, "GRANTED");
  assert.strictEqual(result.results[1].decision, "DENIED");

  const foreignQuery: capability.SearchQuery = {
    tenantId: "t2",
    organisationId: "o2",
    query: "test"
  };
  const foreignResult = capability.performSearch(state, foreignQuery);
  assert.strictEqual(foreignResult.error, null);
  assert.strictEqual(foreignResult.results.length, 1);
  assert.strictEqual(foreignResult.results[0].document.tenantId, "t2");
});

test("searchandindexingproductsearchproof", () => {
  const state: capability.SearchState = {
    readiness: "READY",
    documents: [
      {
        tenantId: "t1",
        organisationId: "o1",
        documentId: "d1",
        documentType: "note",
        title: "Tenant 1 Doc",
        searchVector: "vector",
        indexName: "idx",
        url: "http://example.com",
        metadata: {}
      } as capability.IndexedDocument
    ],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const isolationResult = capability.checkSearchIsolation(state, {
    tenantId: "t2",
    organisationId: "o2",
    query: "test"
  } as capability.SearchQuery);
  assert.strictEqual(isolationResult.isolated, true);
  assert.strictEqual(isolationResult.error, null);

  const violationResult = capability.checkSearchIsolation(state, {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  } as capability.SearchQuery);
  assert.strictEqual(violationResult.isolated, false);
  assert.ok(violationResult.error);
  assert.strictEqual(violationResult.error.kind, "TENANT_ISOLATION_VIOLATION");
});

test("searchandindexingproductsearchreadinessmodel", () => {
  const initialState = capability.initialState;
  assert.strictEqual(initialState.readiness, "BLOCKED");

  let state = capability.probeReadiness(initialState, "READY");
  assert.strictEqual(state.readiness, "READY");
  assert.strictEqual(state.probeHistory.length, 1);
  assert.strictEqual(state.probeHistory[0].status, "READY");

  state = capability.probeReadiness(state, "DEGRADED");
  assert.strictEqual(state.readiness, "DEGRADED");
  assert.strictEqual(state.probeHistory.length, 2);
  assert.strictEqual(state.probeHistory[1].status, "DEGRADED");

  const blockedState: capability.SearchState = {
    readiness: "BLOCKED",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  const mutationResult = capability.indexDocument(blockedState, {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Test",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  } as capability.IndexedDocument, () => null);
  assert.ok("kind" in mutationResult);
  assert.strictEqual(mutationResult.kind, "INDEX_MUTATION_DISABLED");
});

test("searchandindexingproductsearchstatemodel", () => {
  const doc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Test",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: { safe: "value" },
    permissionKey: "key1"
  };
  assert.ok(capability.validateDocumentShape(doc));

  const state: capability.SearchState = {
    readiness: "READY",
    documents: [doc],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };
  assert.strictEqual(state.readiness, "READY");
  assert.strictEqual(state.documents.length, 1);
  assert.strictEqual(state.documents[0].tenantId, "t1");
  assert.strictEqual(state.documents[0].organisationId, "o1");
  assert.strictEqual(state.documents[0].documentId, "d1");
  assert.strictEqual(state.documents[0].documentType, "note");
  assert.strictEqual(state.documents[0].title, "Test");
  assert.strictEqual(state.documents[0].searchVector, "vector");
  assert.strictEqual(state.documents[0].indexName, "idx");
  assert.strictEqual(state.documents[0].url, "http://example.com");
  assert.deepStrictEqual(state.documents[0].metadata, { safe: "value" });
  assert.strictEqual(state.documents[0].permissionKey, "key1");

  const secretDoc = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d2",
    documentType: "note",
    title: "Secret",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: { password: "hunter2" }
  };
  assert.ok(!capability.validateDocumentShape(secretDoc));
});

test("searchandindexingproductsearchvalidation", () => {
  const state: capability.SearchState = {
    readiness: "READY",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: []
  };

  const invalidQuery = {
    tenantId: "",
    organisationId: "o1",
    query: "test"
  };
  const invalidResult = capability.performSearch(state, invalidQuery as capability.SearchQuery);
  assert.ok(invalidResult.error);
  assert.strictEqual(invalidResult.error.kind, "CROSS_TENANT_QUERY_REJECTED");

  const validQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  const validResult = capability.performSearch(state, validQuery);
  assert.strictEqual(validResult.error, null);
  assert.strictEqual(validResult.results.length, 0);

  const duplicateDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "First",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  };
  const stateWithDoc = capability.indexDocument(state, duplicateDoc, () => null);
  if ("kind" in stateWithDoc) throw new Error("Unexpected error");
  const duplicateResult = capability.indexDocument(stateWithDoc, duplicateDoc, () => null);
  assert.ok("kind" in duplicateResult);
  assert.strictEqual(duplicateResult.kind, "UNIQUENESS_VIOLATION");

  const probeResult = capability.probeReadiness(state, "READY");
  assert.strictEqual(probeResult.readiness, "READY");
  assert.strictEqual(probeResult.probeHistory.length, 1);
});