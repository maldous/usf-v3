import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/search/searchandindexingproductsearch.ts";

test("searchandindexingproductsearchauditmodel", () => {
  const readyState: capability.SearchState = {
    readiness: "READY",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
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

  const secretResult = capability.indexDocument(readyState, secretDoc, () => null);
  assert.strictEqual(secretResult.ok, false);
  if (secretResult.ok) throw new Error("Expected secret result to fail");
  assert.strictEqual(secretResult.error.kind, "SECRET_FIELD_DETECTED");
  assert.strictEqual(secretResult.error.tenantId, "t1");
  assert.strictEqual(secretResult.error.organisationId, "o1");

  const auditError: capability.SearchError = {
    kind: "AUDIT_FAILURE",
    message: "Audit denied",
    tenantId: "t1",
    organisationId: "o1"
  };
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
  const auditResult = capability.indexDocument(readyState, validDoc, () => auditError);
  assert.strictEqual(auditResult.ok, false);
  if (auditResult.ok) throw new Error("Expected audit failure");
  assert.strictEqual(auditResult.error.kind, "AUDIT_FAILURE");
  assert.strictEqual(auditResult.error.tenantId, "t1");
  assert.strictEqual(auditResult.error.organisationId, "o1");

  const successfulIndexResult = capability.indexDocument(readyState, validDoc, () => null);
  assert.strictEqual(successfulIndexResult.ok, true);
  if (!successfulIndexResult.ok) throw new Error("Expected successful index");
  assert.strictEqual(successfulIndexResult.state.lastAudit?.kind, "AUDIT_BEFORE_INDEX");
  assert.strictEqual(successfulIndexResult.state.lastAudit?.tenantId, "t1");
  assert.strictEqual(successfulIndexResult.state.lastAudit?.organisationId, "o1");
  assert.strictEqual(successfulIndexResult.state.lastAudit?.span, "route/use-case/provider");

  const reindexed = capability.reindexTenant(successfulIndexResult.state, "t1", "o1", [validDoc], () => null);
  assert.strictEqual(reindexed.ok, true);
  if (!reindexed.ok) throw new Error("Expected reindex success");
  assert.strictEqual(reindexed.state.lastAudit?.kind, "AUDIT_BEFORE_REINDEX");
  assert.strictEqual(reindexed.state.lastAudit?.tenantId, "t1");
  assert.strictEqual(reindexed.state.lastAudit?.organisationId, "o1");
  assert.strictEqual(reindexed.state.lastAudit?.span, "route/use-case/provider");
  assert.strictEqual(reindexed.state.documents[0]?.tenantId, "t1");
  assert.strictEqual(reindexed.state.documents[0]?.organisationId, "o1");

  const probed = capability.probeReadiness(capability.initialState, "READY", () => null);
  assert.strictEqual(probed.ok, true);
  if (!probed.ok) throw new Error("Expected probe success");
  assert.strictEqual(probed.state.readiness, "READY");
  assert.strictEqual(probed.state.probeHistory.length, 1);
  assert.strictEqual(probed.state.probeHistory[0]?.status, "READY");
  assert.strictEqual(probed.state.lastAudit?.kind, "AUDIT_BEFORE_READINESS");

  const recorded = capability.recordProof(probed.state, {
    kind: "SEARCH_PROOF",
    passed: true,
    error: null
  });
  assert.strictEqual(capability.isAuditSignalPresent(recorded), true);
});

test("searchandindexingproductsearchcontracts", () => {
  const auditFn = () => null;
  const initial: capability.SearchState = {
    readiness: "READY",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
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

  assert.ok(capability.validateDocumentShape(validDoc));
  assert.ok(capability.validateUniqueness(initial.documents, validDoc));

  const indexResult = capability.indexDocument(initial, validDoc, auditFn);
  assert.strictEqual(indexResult.ok, true);
  if (!indexResult.ok) throw new Error("Expected successful index");
  assert.strictEqual(indexResult.state.documents.length, 1);
  assert.strictEqual(indexResult.state.documents[0]?.documentId, "d1");
  assert.strictEqual(indexResult.state.documents[0]?.tenantId, "t1");
  assert.strictEqual(indexResult.state.documents[0]?.organisationId, "o1");
  assert.strictEqual(indexResult.state.documents[0]?.searchVector, "vector");

  const searchQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  const searchResult = capability.performSearch(indexResult.state, searchQuery);
  assert.strictEqual(searchResult.ok, true);
  if (!searchResult.ok) throw new Error("Expected successful search");
  assert.strictEqual(searchResult.results.length, 1);
  assert.strictEqual(searchResult.results[0]?.document.documentId, "d1");
  assert.strictEqual(searchResult.results[0]?.decision, "GRANTED");

  const reindexResult = capability.reindexTenant(indexResult.state, "t1", "o1", [validDoc], auditFn);
  assert.strictEqual(reindexResult.ok, true);
  if (!reindexResult.ok) throw new Error("Expected successful reindex");
  assert.strictEqual(reindexResult.state.documents.length, 1);
  assert.strictEqual(reindexResult.state.documents[0]?.documentId, "d1");
  assert.strictEqual(reindexResult.state.lastAudit?.kind, "AUDIT_BEFORE_REINDEX");
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
  const readyState: capability.SearchState = {
    readiness: "READY",
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
  };

  const foreignQuery: capability.SearchQuery = {
    tenantId: "t2",
    organisationId: "o2",
    query: "test"
  };
  const foreignResult = capability.performSearch(readyState, foreignQuery);
  assert.strictEqual(foreignResult.ok, true);
  if (!foreignResult.ok) throw new Error("Expected ok outcome");
  assert.strictEqual(foreignResult.results.length, 0);

  const unscopedQuery = {
    tenantId: "",
    organisationId: "",
    query: "test"
  } as capability.SearchQuery;
  const unscopedResult = capability.performSearch(readyState, unscopedQuery);
  assert.strictEqual(unscopedResult.ok, false);
  if (unscopedResult.ok) throw new Error("Expected unscoped rejection");
  assert.strictEqual(unscopedResult.error.kind, "CROSS_TENANT_QUERY_REJECTED");

  const blockedState: capability.SearchState = {
    readiness: "BLOCKED",
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
  };
  const blockedResult = capability.performSearch(blockedState, foreignQuery);
  assert.strictEqual(blockedResult.ok, false);
  if (blockedResult.ok) throw new Error("Expected blocked failure");
  assert.strictEqual(blockedResult.error.kind, "SEARCH_ENGINE_UNAVAILABLE");
  assert.strictEqual(blockedResult.error.tenantId, "t2");
  assert.strictEqual(blockedResult.error.organisationId, "o2");

  const degradedState: capability.SearchState = {
    readiness: "DEGRADED",
    documents: [tenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
  };
  const degradedResult = capability.performSearch(degradedState, foreignQuery);
  assert.strictEqual(degradedResult.ok, false);
  if (degradedResult.ok) throw new Error("Expected degraded failure");
  assert.strictEqual(degradedResult.error.kind, "SEARCH_ENGINE_UNAVAILABLE");
  assert.strictEqual(degradedResult.error.tenantId, "t2");
  assert.strictEqual(degradedResult.error.organisationId, "o2");

  const degradedIndexResult = capability.indexDocument(degradedState, tenantDoc, () => null);
  assert.strictEqual(degradedIndexResult.ok, false);
  if (degradedIndexResult.ok) throw new Error("Expected mutation disabled");
  assert.strictEqual(degradedIndexResult.error.kind, "INDEX_MUTATION_DISABLED");

  const blockedIndexResult = capability.indexDocument(blockedState, tenantDoc, () => null);
  assert.strictEqual(blockedIndexResult.ok, false);
  if (blockedIndexResult.ok) throw new Error("Expected mutation disabled on blocked");
  assert.strictEqual(blockedIndexResult.error.kind, "INDEX_MUTATION_DISABLED");

  const secretDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d2",
    documentType: "note",
    title: "Secret",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: { apiKey: "leaked" }
  };
  const secretResult = capability.indexDocument(readyState, secretDoc, () => null);
  assert.strictEqual(secretResult.ok, false);
  if (secretResult.ok) throw new Error("Expected secret rejection");
  assert.strictEqual(secretResult.error.kind, "SECRET_FIELD_DETECTED");
});

test("searchandindexingproductsearchlifecycle", () => {
  const auditFn = () => null;
  const start = capability.initialState;
  assert.strictEqual(start.readiness, "BLOCKED");

  const probed = capability.probeReadiness(start, "READY", auditFn);
  assert.strictEqual(probed.ok, true);
  if (!probed.ok) throw new Error("Expected probe success");
  assert.strictEqual(probed.state.readiness, "READY");

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
  const indexResult = capability.indexDocument(probed.state, doc, auditFn);
  assert.strictEqual(indexResult.ok, true);
  if (!indexResult.ok) throw new Error("Expected index success");
  const indexedState = indexResult.state;

  const searchQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  const searchResult = capability.performSearch(indexedState, searchQuery);
  assert.strictEqual(searchResult.ok, true);
  if (!searchResult.ok) throw new Error("Expected search success");
  assert.strictEqual(searchResult.results.length, 1);

  const reindexResult = capability.reindexTenant(indexedState, "t1", "o1", [doc], auditFn);
  assert.strictEqual(reindexResult.ok, true);
  if (!reindexResult.ok) throw new Error("Expected reindex success");
  assert.strictEqual(reindexResult.state.documents.length, 1);
});

test("searchandindexingproductsearchpermissions", () => {
  const auditFn = () => null;
  const publicDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Public",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  };
  const privateDoc: capability.IndexedDocument = {
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
  };
  const otherTenantDoc: capability.IndexedDocument = {
    tenantId: "t2",
    organisationId: "o2",
    documentId: "d3",
    documentType: "note",
    title: "Other Tenant",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com/3",
    metadata: {}
  };

  const state: capability.SearchState = {
    readiness: "READY",
    documents: [publicDoc, privateDoc, otherTenantDoc],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
  };

  const deniedQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test",
    permissionKey: "wrong"
  };
  const deniedResult = capability.performSearch(state, deniedQuery);
  assert.strictEqual(deniedResult.ok, true);
  if (!deniedResult.ok) throw new Error("Expected ok");
  assert.strictEqual(deniedResult.results.length, 1);
  assert.strictEqual(deniedResult.results[0]?.decision, "GRANTED");
  assert.strictEqual(deniedResult.results[0]?.document.documentId, "d1");

  const noKeyQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  const noKeyResult = capability.performSearch(state, noKeyQuery);
  assert.strictEqual(noKeyResult.ok, true);
  if (!noKeyResult.ok) throw new Error("Expected ok");
  assert.strictEqual(noKeyResult.results.length, 1);
  assert.strictEqual(noKeyResult.results[0]?.document.documentId, "d1");

  const grantedQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test",
    permissionKey: "secret"
  };
  const grantedResult = capability.performSearch(state, grantedQuery);
  assert.strictEqual(grantedResult.ok, true);
  if (!grantedResult.ok) throw new Error("Expected ok");
  assert.strictEqual(grantedResult.results.length, 2);
  assert.strictEqual(grantedResult.results[0]?.decision, "GRANTED");
  assert.strictEqual(grantedResult.results[1]?.decision, "GRANTED");

  const foreignQuery: capability.SearchQuery = {
    tenantId: "t2",
    organisationId: "o2",
    query: "test"
  };
  const foreignResult = capability.performSearch(state, foreignQuery);
  assert.strictEqual(foreignResult.ok, true);
  if (!foreignResult.ok) throw new Error("Expected ok");
  assert.strictEqual(foreignResult.results.length, 1);
  assert.strictEqual(foreignResult.results[0]?.document.tenantId, "t2");
  assert.strictEqual(foreignResult.results[0]?.document.organisationId, "o2");

  const secretDoc: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d4",
    documentType: "note",
    title: "Secret",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: { password: "hunter2" }
  };
  const secretResult = capability.indexDocument(state, secretDoc, auditFn);
  assert.strictEqual(secretResult.ok, false);
  if (secretResult.ok) throw new Error("Expected secret rejection");
  assert.strictEqual(secretResult.error.kind, "SECRET_FIELD_DETECTED");
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
      }
    ],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
  };

  const isolationForeign = capability.checkSearchIsolation(state, {
    tenantId: "t2",
    organisationId: "o2",
    query: "test"
  });
  assert.strictEqual(isolationForeign.isolated, true);
  assert.strictEqual(isolationForeign.error, null);
  assert.strictEqual(isolationForeign.proof.kind, "SEARCH_ISOLATION_PROOF");
  assert.strictEqual(isolationForeign.proof.passed, true);

  const isolationSame = capability.checkSearchIsolation(state, {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  });
  assert.strictEqual(isolationSame.isolated, true);
  assert.strictEqual(isolationSame.proof.passed, true);

  const routesProof = capability.searchRoutesProof(state, {
    tenantId: "t2",
    organisationId: "o2",
    query: "test"
  });
  assert.strictEqual(routesProof.passed, true);
  assert.strictEqual(routesProof.error, null);
  assert.strictEqual(routesProof.proof.kind, "SEARCH_ROUTES_PROOF");
  assert.strictEqual(routesProof.proof.passed, true);

  const runProof = capability.runSearchProof(state, {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  });
  assert.strictEqual(runProof.passed, true);
  assert.strictEqual(runProof.proof.kind, "SEARCH_PROOF");

  const crossContaminate: capability.SearchState = {
    readiness: "READY",
    documents: [
      {
        tenantId: "t1",
        organisationId: "o1",
        documentId: "d1",
        documentType: "note",
        title: "Doc",
        searchVector: "vector",
        indexName: "idx",
        url: "http://example.com",
        metadata: {}
      }
    ],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
  };
  const crossAssertion = capability.crossTenantIsolationAssertion(
    crossContaminate,
    "foreign-tenant",
    "foreign-org"
  );
  assert.strictEqual(crossAssertion.isolated, true);
  assert.strictEqual(crossAssertion.error, null);

  const crossQuery: capability.SearchQuery = {
    tenantId: "foreign-tenant",
    organisationId: "foreign-org",
    query: "test"
  };
  const crossResult = capability.performSearch(crossContaminate, crossQuery);
  assert.strictEqual(crossResult.ok, true);
  if (!crossResult.ok) throw new Error("Expected ok");
  assert.strictEqual(crossResult.results.length, 0);

  const recorded = capability.recordProof(state, routesProof.proof);
  assert.strictEqual(recorded.proofHistory.length, 1);
  assert.strictEqual(recorded.proofHistory[0]?.kind, "SEARCH_ROUTES_PROOF");

  const withIsolation = capability.recordProof(state, isolationForeign.proof);
  assert.strictEqual(capability.isIsolationSignalPresent(withIsolation), true);
});

test("searchandindexingproductsearchreadinessmodel", () => {
  const initialState = capability.initialState;
  assert.strictEqual(initialState.readiness, "BLOCKED");
  assert.strictEqual(capability.isReadinessKnown(initialState), false);

  const probedReady = capability.probeReadiness(initialState, "READY", () => null);
  assert.strictEqual(probedReady.ok, true);
  if (!probedReady.ok) throw new Error("Expected probe success");
  assert.strictEqual(probedReady.state.readiness, "READY");
  assert.strictEqual(probedReady.state.probeHistory.length, 1);
  assert.strictEqual(probedReady.state.probeHistory[0]?.status, "READY");
  assert.strictEqual(capability.isReadinessKnown(probedReady.state), true);

  const probedDegraded = capability.probeReadiness(probedReady.state, "DEGRADED", () => null);
  assert.strictEqual(probedDegraded.ok, true);
  if (!probedDegraded.ok) throw new Error("Expected probe success");
  assert.strictEqual(probedDegraded.state.readiness, "DEGRADED");
  assert.strictEqual(probedDegraded.state.probeHistory.length, 2);
  assert.strictEqual(probedDegraded.state.probeHistory[1]?.status, "DEGRADED");

  const blockedState: capability.SearchState = {
    readiness: "BLOCKED",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
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
  }, () => null);
  assert.strictEqual(mutationResult.ok, false);
  if (mutationResult.ok) throw new Error("Expected mutation disabled");
  assert.strictEqual(mutationResult.error.kind, "INDEX_MUTATION_DISABLED");

  const readOnlyQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  const blockedSearch = capability.performSearch(blockedState, readOnlyQuery);
  assert.strictEqual(blockedSearch.ok, false);
  if (blockedSearch.ok) throw new Error("Expected blocked search failure");
  assert.strictEqual(blockedSearch.error.kind, "SEARCH_ENGINE_UNAVAILABLE");

  const probedBlocked = capability.probeReadiness(probedDegraded.state, "BLOCKED", () => null);
  assert.strictEqual(probedBlocked.ok, true);
  if (!probedBlocked.ok) throw new Error("Expected probe success");
  const gates = capability.checkPromotionGates(probedBlocked.state);
  assert.strictEqual(gates.allowed, false);
  assert.strictEqual(gates.errors.some(e => e.kind === "READINESS_PROBE_FAILED"), true);
  assert.strictEqual(gates.errors.some(e => e.kind === "MISSING_ISOLATION_SIGNAL"), true);
  assert.strictEqual(gates.errors.some(e => e.kind === "MISSING_AUDIT_SIGNAL"), true);
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
    probeHistory: [],
    proofHistory: []
  };
  assert.strictEqual(state.readiness, "READY");
  assert.strictEqual(state.documents.length, 1);
  assert.strictEqual(state.documents[0]?.tenantId, "t1");
  assert.strictEqual(state.documents[0]?.organisationId, "o1");
  assert.strictEqual(state.documents[0]?.documentId, "d1");
  assert.strictEqual(state.documents[0]?.documentType, "note");
  assert.strictEqual(state.documents[0]?.title, "Test");
  assert.strictEqual(state.documents[0]?.searchVector, "vector");
  assert.strictEqual(state.documents[0]?.indexName, "idx");
  assert.strictEqual(state.documents[0]?.url, "http://example.com");
  assert.deepStrictEqual(state.documents[0]?.metadata, { safe: "value" });
  assert.strictEqual(state.documents[0]?.permissionKey, "key1");

  const dup: capability.IndexedDocument = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1",
    documentType: "note",
    title: "Dup",
    searchVector: "vector",
    indexName: "idx",
    url: "http://example.com",
    metadata: {}
  };
  assert.strictEqual(capability.validateUniqueness(state.documents, dup), false);

  const secretDoc: capability.IndexedDocument = {
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
  const secretIndexResult = capability.indexDocument(state, secretDoc, () => null);
  assert.strictEqual(secretIndexResult.ok, false);
  if (secretIndexResult.ok) throw new Error("Expected secret rejection");
  assert.strictEqual(secretIndexResult.error.kind, "SECRET_FIELD_DETECTED");
});

test("searchandindexingproductsearchvalidation", () => {
  const state: capability.SearchState = {
    readiness: "READY",
    documents: [],
    lastError: null,
    lastAudit: null,
    probeHistory: [],
    proofHistory: []
  };

  const invalidQuery = {
    tenantId: "",
    organisationId: "o1",
    query: "test"
  };
  assert.strictEqual(capability.validateQueryScope(invalidQuery as capability.SearchQuery), false);
  const invalidResult = capability.performSearch(state, invalidQuery as capability.SearchQuery);
  assert.strictEqual(invalidResult.ok, false);
  if (invalidResult.ok) throw new Error("Expected invalid query failure");
  assert.strictEqual(invalidResult.error.kind, "CROSS_TENANT_QUERY_REJECTED");

  const validQuery: capability.SearchQuery = {
    tenantId: "t1",
    organisationId: "o1",
    query: "test"
  };
  assert.strictEqual(capability.validateQueryScope(validQuery), true);
  const validResult = capability.performSearch(state, validQuery);
  assert.strictEqual(validResult.ok, true);
  if (!validResult.ok) throw new Error("Expected ok");
  assert.strictEqual(validResult.results.length, 0);

  const invalidShape = {
    tenantId: "t1",
    organisationId: "o1",
    documentId: "d1"
  };
  assert.strictEqual(capability.validateDocumentShape(invalidShape), false);

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
  assert.strictEqual(stateWithDoc.ok, true);
  if (!stateWithDoc.ok) throw new Error("Expected successful index");
  const duplicateResult = capability.indexDocument(stateWithDoc.state, duplicateDoc, () => null);
  assert.strictEqual(duplicateResult.ok, false);
  if (duplicateResult.ok) throw new Error("Expected uniqueness violation");
  assert.strictEqual(duplicateResult.error.kind, "UNIQUENESS_VIOLATION");

  const probeResult = capability.probeReadiness(state, "READY", () => null);
  assert.strictEqual(probeResult.ok, true);
  if (!probeResult.ok) throw new Error("Expected probe success");
  assert.strictEqual(probeResult.state.readiness, "READY");
  assert.strictEqual(probeResult.state.probeHistory.length, 1);
  assert.strictEqual(probeResult.state.probeHistory[0]?.status, "READY");
});