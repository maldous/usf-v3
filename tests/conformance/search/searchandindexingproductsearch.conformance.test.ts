```typescript
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
  assert.ok(!("kind" in indexResult));
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
  assert.ok(!("kind" in reindexResult));
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
  assert