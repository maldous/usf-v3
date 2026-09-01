import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/datagovernancecataloglineageclassificationpiidsrgdpr.ts";

function isError(value: unknown): value is capability.DataGovernanceCatalogError {
  return typeof value === "object" && value !== null && "kind" in value;
}

test("datagovernancecataloglineageclassificationpiidsrgdprauditmodel", () => {
  const auditLog: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = (event: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError | null => {
    auditLog.push(event);
    return null;
  };

  const initial: capability.DataGovernanceCatalogState = capability.initialState;
  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry1",
    datasetId: "dataset1",
    classification: "PII",
    lineage: ["source1"],
    tenantId: "tenant1",
  };

  const result = capability.addCatalogEntry(initial, entry, auditFn);
  if (isError(result)) throw new Error("addCatalogEntry should succeed");
  assert.strictEqual(auditLog.length, 1);
  assert.strictEqual(auditLog[0].kind, "CLASSIFICATION_CHANGE");
  assert.strictEqual(auditLog[0].tenantId, "tenant1");
  assert.strictEqual(auditLog[0].resourceId, "entry1");

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(result, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");

  const fulfilled = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "evidence1",
    "op1",
    auditFn,
  );
  if (isError(fulfilled)) throw new Error("fulfillDataSubjectRequest should succeed");
  assert.strictEqual(auditLog.length, 2);
  assert.strictEqual(auditLog[1].kind, "REQUEST_FULFILLED");
  assert.strictEqual(auditLog[1].tenantId, "tenant1");
  assert.strictEqual(auditLog[1].resourceId, "req1");
  const details = auditLog[1].details as { evidence: string; operatorId: string };
  assert.strictEqual(details.evidence, "evidence1");
  assert.strictEqual(details.operatorId, "op1");

  const tenantAudit = capability.getAuditLogForTenant(fulfilled, "tenant1");
  assert.strictEqual(tenantAudit.length, 2);
  assert.strictEqual(tenantAudit[0].tenantId, "tenant1");
  assert.strictEqual(tenantAudit[1].tenantId, "tenant1");

  const fulfilledRequest = (fulfilled as capability.DataGovernanceCatalogState).requests.find(
    (r) => r.id === "req1",
  );
  assert.strictEqual(fulfilledRequest?.evidence, "evidence1");
});

test("datagovernancecataloglineageclassificationpiidsrgdprcontracts", () => {
  const auditFn = (_: capability.DataGovernanceAuditEvent): null => null;
  const initial: capability.DataGovernanceCatalogState = capability.initialState;

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry1",
    datasetId: "dataset1",
    classification: "sensitive",
    lineage: ["source1"],
    tenantId: "tenant1",
  };
  const stateWithEntry = capability.addCatalogEntry(initial, entry, auditFn);
  if (isError(stateWithEntry)) throw new Error("addCatalogEntry should succeed");

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(stateWithEntry, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");

  const invalidFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "",
    "op1",
    auditFn,
  );
  assert.ok(isError(invalidFulfill), "fulfill without evidence must fail");
  assert.strictEqual((invalidFulfill as capability.DataGovernanceCatalogError).kind, "MISSING_EVIDENCE");

  const validFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "evidence1",
    "op1",
    auditFn,
  );
  if (isError(validFulfill)) throw new Error("fulfill with evidence must succeed");
  const fulfilledRequest = (validFulfill as capability.DataGovernanceCatalogState).requests.find(
    (r) => r.id === "req1",
  );
  assert.strictEqual(fulfilledRequest?.state, "fulfilled");
  assert.strictEqual(fulfilledRequest?.evidence, "evidence1");
  assert.strictEqual(fulfilledRequest?.operatorId, "op1");

  const invalidClassification = capability.validateClassification("invalid");
  assert.ok(isError(invalidClassification), "invalid classification must be rejected");
  assert.strictEqual(
    (invalidClassification as capability.DataGovernanceCatalogError).kind,
    "INVALID_CLASSIFICATION",
  );
});

test("datagovernancecataloglineageclassificationpiidsrgdprerrormodel", () => {
  const auditFn = (_: capability.DataGovernanceAuditEvent): null => null;
  const initial: capability.DataGovernanceCatalogState = capability.initialState;

  const invalidClassification = capability.validateClassification("invalid");
  assert.ok(isError(invalidClassification));
  assert.strictEqual(
    (invalidClassification as capability.DataGovernanceCatalogError).kind,
    "INVALID_CLASSIFICATION",
  );

  const invalidState = capability.validateRequestState("invalid");
  assert.ok(isError(invalidState));
  assert.strictEqual(
    (invalidState as capability.DataGovernanceCatalogError).kind,
    "CONFIGURATION_MISSING",
  );

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(initial, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");
  const invalidFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "",
    "op1",
    auditFn,
  );
  assert.ok(isError(invalidFulfill));
  assert.strictEqual(
    (invalidFulfill as capability.DataGovernanceCatalogError).kind,
    "MISSING_EVIDENCE",
  );

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry1",
    datasetId: "dataset1",
    classification: "PII",
    lineage: ["source1"],
    tenantId: "tenant1",
  };
  const stateWithEntry = capability.addCatalogEntry(initial, entry, auditFn);
  if (isError(stateWithEntry)) throw new Error("addCatalogEntry should succeed");
  const duplicateEntry = capability.addCatalogEntry(stateWithEntry, entry, auditFn);
  assert.ok(isError(duplicateEntry));
  assert.strictEqual(
    (duplicateEntry as capability.DataGovernanceCatalogError).kind,
    "TENANT_BOUNDARY_VIOLATION",
  );

  const providerUnavailableFn = (_: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError => ({
    kind: "PROVIDER_UNAVAILABLE",
    message: "Audit provider unavailable",
    tenantId: "tenant1",
  });
  const providerError = capability.addCatalogEntry(initial, entry, providerUnavailableFn);
  assert.ok(isError(providerError));
  assert.strictEqual((providerError as capability.DataGovernanceCatalogError).kind, "PROVIDER_UNAVAILABLE");
});

test("datagovernancecataloglineageclassificationpiidsrgdprlifecycle", () => {
  const auditLog: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = (event: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError | null => {
    auditLog.push(event);
    return null;
  };

  const initial: capability.DataGovernanceCatalogState = capability.initialState;
  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry1",
    datasetId: "dataset1",
    classification: "none",
    lineage: ["source1"],
    tenantId: "tenant1",
  };
  const stateWithEntry = capability.addCatalogEntry(initial, entry, auditFn);
  if (isError(stateWithEntry)) throw new Error("addCatalogEntry should succeed");

  const updated = capability.updateCatalogEntryClassification(
    stateWithEntry,
    "entry1",
    "PII",
    "tenant1",
    auditFn,
  );
  if (isError(updated)) throw new Error("updateCatalogEntryClassification should succeed");
  const updatedEntry = (updated as capability.DataGovernanceCatalogState).catalog.find(
    (e) => e.id === "entry1",
  );
  assert.strictEqual(updatedEntry?.classification, "PII");

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(updated, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");
  const fulfilled = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "evidence1",
    "op1",
    auditFn,
  );
  if (isError(fulfilled)) throw new Error("fulfillDataSubjectRequest should succeed");
  const fulfilledRequest = (fulfilled as capability.DataGovernanceCatalogState).requests.find(
    (r) => r.id === "req1",
  );
  assert.strictEqual(fulfilledRequest?.state, "fulfilled");
  assert.strictEqual(fulfilledRequest?.evidence, "evidence1");

  const invalidFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "",
    "op1",
    auditFn,
  );
  assert.ok(isError(invalidFulfill));
});

test("datagovernancecataloglineageclassificationpiidsrgdprpermissions", () => {
  const auditFn = (_: capability.DataGovernanceAuditEvent): null => null;
  const initial: capability.DataGovernanceCatalogState = capability.initialState;

  const entryTenant1: capability.DataGovernanceCatalogEntry = {
    id: "entry1",
    datasetId: "dataset1",
    classification: "PII",
    lineage: ["source1"],
    tenantId: "tenant1",
  };
  const stateWithEntry = capability.addCatalogEntry(initial, entryTenant1, auditFn);
  if (isError(stateWithEntry)) throw new Error("addCatalogEntry should succeed");

  const entriesForTenant1 = capability.getCatalogEntriesForTenant(stateWithEntry, "tenant1");
  assert.strictEqual(entriesForTenant1.length, 1);
  assert.strictEqual(entriesForTenant1[0].id, "entry1");

  const entriesForTenant2 = capability.getCatalogEntriesForTenant(stateWithEntry, "tenant2");
  assert.strictEqual(entriesForTenant2.length, 0);

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(stateWithEntry, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");

  const requestsForTenant1 = capability.getRequestsForTenant(stateWithRequest, "tenant1");
  assert.strictEqual(requestsForTenant1.length, 1);
  assert.strictEqual(requestsForTenant1[0].id, "req1");

  const requestsForTenant2 = capability.getRequestsForTenant(stateWithRequest, "tenant2");
  assert.strictEqual(requestsForTenant2.length, 0);

  const crossTenantUpdate = capability.updateCatalogEntryClassification(
    stateWithEntry,
    "entry1",
    "sensitive",
    "tenant2",
    auditFn,
  );
  assert.ok(isError(crossTenantUpdate));
  assert.strictEqual(
    (crossTenantUpdate as capability.DataGovernanceCatalogError).kind,
    "TENANT_BOUNDARY_VIOLATION",
  );

  const crossTenantFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant2",
    "evidence1",
    "op1",
    auditFn,
  );
  assert.ok(isError(crossTenantFulfill));
  assert.strictEqual(
    (crossTenantFulfill as capability.DataGovernanceCatalogError).kind,
    "TENANT_BOUNDARY_VIOLATION",
  );
});

test("datagovernancecataloglineageclassificationpiidsrgdprproof", () => {
  const auditFn = (_: capability.DataGovernanceAuditEvent): null => null;
  const initial: capability.DataGovernanceCatalogState = capability.initialState;

  const validClassification = capability.validateClassification("PII");
  assert.strictEqual(validClassification, "PII");

  const invalidClassification = capability.validateClassification("invalid");
  assert.ok(isError(invalidClassification));

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(initial, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");

  const invalidFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "",
    "op1",
    auditFn,
  );
  assert.ok(isError(invalidFulfill));
  assert.strictEqual((invalidFulfill as capability.DataGovernanceCatalogError).kind, "MISSING_EVIDENCE");

  const validFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "evidence1",
    "op1",
    auditFn,
  );
  if (isError(validFulfill)) throw new Error("fulfillDataSubjectRequest should succeed");
  const fulfilledRequest = (validFulfill as capability.DataGovernanceCatalogState).requests.find(
    (r) => r.id === "req1",
  );
  assert.strictEqual(fulfilledRequest?.evidence, "evidence1");
});

test("datagovernancecataloglineageclassificationpiidsrgdprreadinessmodel", () => {
  const auditFn = (_: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError => ({
    kind: "PROVIDER_UNAVAILABLE",
    message: "Audit provider unavailable",
    tenantId: "tenant1",
  });

  const initial: capability.DataGovernanceCatalogState = capability.initialState;
  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry1",
    datasetId: "dataset1",
    classification: "PII",
    lineage: ["source1"],
    tenantId: "tenant1",
  };

  const result = capability.addCatalogEntry(initial, entry, auditFn);
  assert.ok(isError(result));
  assert.strictEqual((result as capability.DataGovernanceCatalogError).kind, "PROVIDER_UNAVAILABLE");

  const readOnlyResult = capability.getCatalogEntriesForTenant(initial, "tenant1");
  assert.strictEqual(readOnlyResult.length, 0);
});

test("datagovernancecataloglineageclassificationpiidsrgdprstatemodel", () => {
  const auditFn = (_: capability.DataGovernanceAuditEvent): null => null;
  const initial: capability.DataGovernanceCatalogState = capability.initialState;

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry1",
    datasetId: "dataset1",
    classification: "none" as const,
    lineage: ["source1"],
    tenantId: "tenant1",
  };
  const stateWithEntry = capability.addCatalogEntry(initial, entry, auditFn);
  if (isError(stateWithEntry)) throw new Error("addCatalogEntry should succeed");
  const catalogEntry = (stateWithEntry as capability.DataGovernanceCatalogState).catalog.find(
    (e) => e.id === "entry1",
  );
  assert.strictEqual(catalogEntry?.classification, "none");

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(stateWithEntry, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");
  const createdRequest = (stateWithRequest as capability.DataGovernanceCatalogState).requests.find(
    (r) => r.id === "req1",
  );
  assert.strictEqual(createdRequest?.state, "open");
  assert.strictEqual(createdRequest?.evidence, null);
  assert.strictEqual(createdRequest?.operatorId, null);

  const fulfilled = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "evidence1",
    "op1",
    auditFn,
  );
  if (isError(fulfilled)) throw new Error("fulfillDataSubjectRequest should succeed");
  const fulfilledRequest = (fulfilled as capability.DataGovernanceCatalogState).requests.find(
    (r) => r.id === "req1",
  );
  assert.strictEqual(fulfilledRequest?.state, "fulfilled");
  assert.strictEqual(fulfilledRequest?.evidence, "evidence1");
  assert.strictEqual(fulfilledRequest?.operatorId, "op1");
});

test("datagovernancecataloglineageclassificationpiidsrgdprvalidation", () => {
  const auditFn = (_: capability.DataGovernanceAuditEvent): null => null;
  const initial: capability.DataGovernanceCatalogState = capability.initialState;

  const validClassifications: readonly capability.DataGovernanceCatalogClassification[] = [
    "none",
    "PII",
    "sensitive",
  ];
  for (const classification of validClassifications) {
    const result = capability.validateClassification(classification);
    assert.strictEqual(result, classification);
  }

  const invalidClassification = capability.validateClassification("invalid");
  assert.ok(isError(invalidClassification));
  assert.strictEqual((invalidClassification as capability.DataGovernanceCatalogError).kind, "INVALID_CLASSIFICATION");

  const validStates: readonly capability.DataSubjectRequestState[] = ["open", "fulfilled"];
  for (const state of validStates) {
    const result = capability.validateRequestState(state);
    assert.strictEqual(result, state);
  }

  const invalidState = capability.validateRequestState("invalid");
  assert.ok(isError(invalidState));
  assert.strictEqual((invalidState as capability.DataGovernanceCatalogError).kind, "CONFIGURATION_MISSING");

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "req1",
    tenantId: "tenant1",
    datasetId: "dataset1",
  };
  const stateWithRequest = capability.createDataSubjectRequest(initial, request);
  if (isError(stateWithRequest)) throw new Error("createDataSubjectRequest should succeed");

  const invalidFulfill = capability.fulfillDataSubjectRequest(
    stateWithRequest,
    "req1",
    "tenant1",
    "",
    "op1",
    auditFn,
  );
  assert.ok(isError(invalidFulfill));
  assert.strictEqual((invalidFulfill as capability.DataGovernanceCatalogError).kind, "MISSING_EVIDENCE");
});