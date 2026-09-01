import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/datagovernancecataloglineageclassificationpiidsrgdpr.ts";

type CatalogResult = capability.DataGovernanceCatalogState | capability.DataGovernanceCatalogError;

function isError(value: unknown): value is capability.DataGovernanceCatalogError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

function asState(result: CatalogResult): capability.DataGovernanceCatalogState {
  if (isError(result)) {
    assert.fail(`expected success but got ${result.kind}: ${result.message}`);
  }
  return result;
}

function asError(result: CatalogResult): capability.DataGovernanceCatalogError {
  if (!isError(result)) {
    assert.fail("expected an error result");
  }
  return result;
}

test("datagovernancecataloglineageclassificationpiidsrgdprauditmodel", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = (event: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError | null => {
    auditEvents.push(event);
    return null;
  };

  const seed: capability.DataGovernanceCatalogEntry = {
    id: "entry-audit",
    datasetId: "dataset-audit",
    classification: "PII" as const,
    lineage: ["source-a", "source-b"],
    tenantId: "tenant-audit",
  };
  const withEntry = asState(capability.addCatalogEntry(capability.initialState, seed, auditFn));

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-audit",
    tenantId: "tenant-audit",
    datasetId: "dataset-audit",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request));

  const fulfilled = asState(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-audit",
      "tenant-audit",
      "evidence-audit",
      "operator-audit",
      auditFn,
    ),
  );

  const reclassified = asState(
    capability.updateCatalogEntryClassification(
      fulfilled,
      "entry-audit",
      "sensitive",
      "tenant-audit",
      auditFn,
    ),
  );

  const tenantAudit = capability.getAuditLogForTenant(reclassified, "tenant-audit");
  assert.strictEqual(tenantAudit.length, 3);
  assert.deepStrictEqual(
    tenantAudit.map((event) => event.kind),
    ["CLASSIFICATION_CHANGE", "REQUEST_FULFILLED", "CLASSIFICATION_CHANGE"],
  );
  for (const event of tenantAudit) {
    assert.strictEqual(event.tenantId, "tenant-audit");
  }

  const fulfillmentEvent = tenantAudit.find((event) => event.kind === "REQUEST_FULFILLED");
  assert.ok(fulfillmentEvent !== undefined);
  const fulfillmentDetails = fulfillmentEvent.details as { evidence: string; operatorId: string };
  assert.strictEqual(fulfillmentDetails.evidence, "evidence-audit");
  assert.strictEqual(fulfillmentDetails.operatorId, "operator-audit");

  const durableRequest = capability.getRequestsForTenant(reclassified, "tenant-audit").find(
    (item) => item.id === "request-audit",
  );
  assert.ok(durableRequest !== undefined);
  assert.strictEqual(durableRequest.state, "fulfilled");
  assert.strictEqual(durableRequest.evidence, "evidence-audit");
  assert.strictEqual(durableRequest.operatorId, "operator-audit");

  const spanEvents: capability.DataGovernanceAuditEvent[] = [];
  const spanResult = capability.auditCatalogChange(
    "tenant-audit",
    "entry-audit",
    "LINEAGE_UPDATE",
    { route: "request.fulfillment", useCase: "pii-remediation", provider: "governance-adapter", span: "tenant-audit:request-audit" },
    (event) => {
      spanEvents.push(event);
      return null;
    },
  );
  assert.strictEqual(spanResult, null);
  assert.strictEqual(spanEvents[0].tenantId, "tenant-audit");
});

test("datagovernancecataloglineageclassificationpiidsrgdprcontracts", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = (event: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError | null => {
    auditEvents.push(event);
    return null;
  };

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-contracts",
    datasetId: "dataset-contracts",
    classification: "sensitive" as const,
    lineage: ["source-contracts"],
    tenantId: "tenant-contracts",
  };
  const withEntry = asState(capability.addCatalogEntry(capability.initialState, entry, auditFn));

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-contracts",
    tenantId: "tenant-contracts",
    datasetId: "dataset-contracts",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request));

  const deniedFulfill = asError(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-contracts",
      "tenant-contracts",
      "",
      "operator-contracts",
      auditFn,
    ),
  );
  assert.strictEqual(deniedFulfill.kind, "MISSING_EVIDENCE");

  const fulfilled = asState(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-contracts",
      "tenant-contracts",
      "evidence-contracts",
      "operator-contracts",
      auditFn,
    ),
  );
  const fulfilledRequest = capability.getRequestsForTenant(fulfilled, "tenant-contracts").find(
    (item) => item.id === "request-contracts",
  );
  assert.ok(fulfilledRequest !== undefined);
  assert.strictEqual(fulfilledRequest.state, "fulfilled");
  assert.strictEqual(fulfilledRequest.evidence, "evidence-contracts");

  const invalidClass = asError(capability.validateClassification("invalid-classification", "tenant-contracts"));
  assert.strictEqual(invalidClass.kind, "INVALID_CLASSIFICATION");

  const invalidRoute = asError(capability.updateCatalogEntryClassification(
    withEntry,
    "entry-contracts",
    "invalid",
    "tenant-contracts",
    auditFn,
  ));
  assert.strictEqual(invalidRoute.kind, "INVALID_CLASSIFICATION");

  assert.ok(auditEvents.some((event) => event.kind === "CLASSIFICATION_CHANGE"));
  assert.ok(auditEvents.some((event) => event.kind === "REQUEST_FULFILLED"));
});

test("datagovernancecataloglineageclassificationpiidsrgdprerrormodel", () => {
  const blockedEvents: capability.DataGovernanceAuditEvent[] = [];
  const blockedAuditFn = (
    event: capability.DataGovernanceAuditEvent,
  ): capability.DataGovernanceCatalogError => {
    blockedEvents.push(event);
    return {
      kind: "DEGRADED_READINESS",
      message: "governance adapter degraded",
      tenantId: event.tenantId,
    };
  };

  const badClassification = asError(capability.validateClassification("invalid", "tenant-error"));
  assert.strictEqual(badClassification.kind, "INVALID_CLASSIFICATION");

  const badRequestState = asError(capability.validateRequestState("invalid", "tenant-error"));
  assert.strictEqual(badRequestState.kind, "CONFIGURATION_MISSING");

  const baselineEntry: capability.DataGovernanceCatalogEntry = {
    id: "entry-error",
    datasetId: "dataset-error",
    classification: "PII" as const,
    lineage: ["source-error"],
    tenantId: "tenant-error",
  };

  const addBlocked = asError(capability.addCatalogEntry(capability.initialState, baselineEntry, blockedAuditFn));
  assert.strictEqual(addBlocked.kind, "DEGRADED_READINESS");

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-error",
    tenantId: "tenant-error",
    datasetId: "dataset-error",
  };
  const seeded = asState(capability.createDataSubjectRequest(capability.initialState, request));
  const fulfillBlocked = asError(
    capability.fulfillDataSubjectRequest(
      seeded,
      "request-error",
      "tenant-error",
      "evidence-error",
      "operator-error",
      blockedAuditFn,
    ),
  );
  assert.strictEqual(fulfillBlocked.kind, "DEGRADED_READINESS");

  const unchanged = capability.getRequestsForTenant(seeded, "tenant-error")[0];
  assert.strictEqual(unchanged.state, "open");
  assert.strictEqual(unchanged.evidence, null);

  const presentState: capability.DataGovernanceCatalogState = asState(
    capability.addCatalogEntry(capability.initialState, baselineEntry, () => null),
  );
  const boundaryViolation = asError(capability.updateCatalogEntryClassification(
    presentState,
    "entry-error",
    "sensitive",
    "tenant-other",
    () => null,
  ));
  assert.strictEqual(boundaryViolation.kind, "TENANT_BOUNDARY_VIOLATION");
});

test("datagovernancecataloglineageclassificationpiidsrgdprlifecycle", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = (event: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError | null => {
    auditEvents.push(event);
    return null;
  };

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-lifecycle",
    datasetId: "dataset-lifecycle",
    classification: "none" as const,
    lineage: ["source-lifecycle", "lineage-lifecycle"],
    tenantId: "tenant-lifecycle",
  };
  const created = asState(capability.addCatalogEntry(capability.initialState, entry, auditFn));

  const reclassified = asState(
    capability.updateCatalogEntryClassification(
      created,
      "entry-lifecycle",
      "PII",
      "tenant-lifecycle",
      auditFn,
    ),
  );
  const catalogEntry = capability.getCatalogEntriesForTenant(reclassified, "tenant-lifecycle")[0];
  assert.ok(catalogEntry !== undefined);
  assert.deepStrictEqual(catalogEntry.lineage, ["source-lifecycle", "lineage-lifecycle"]);

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-lifecycle",
    tenantId: "tenant-lifecycle",
    datasetId: "dataset-lifecycle",
  };
  const withRequest = asState(capability.createDataSubjectRequest(reclassified, request));

  const missingEvidence = asError(capability.fulfillDataSubjectRequest(
    withRequest,
    "request-lifecycle",
    "tenant-lifecycle",
    "",
    "operator-lifecycle",
    auditFn,
  ));
  assert.strictEqual(missingEvidence.kind, "MISSING_EVIDENCE");

  const fulfilled = asState(capability.fulfillDataSubjectRequest(
    withRequest,
    "request-lifecycle",
    "tenant-lifecycle",
    "evidence-lifecycle",
    "operator-lifecycle",
    auditFn,
  ));
  const fulfilledRequest = capability.getRequestsForTenant(fulfilled, "tenant-lifecycle").find(
    (item) => item.id === "request-lifecycle",
  );
  assert.ok(fulfilledRequest !== undefined);
  assert.strictEqual(fulfilledRequest.state, "fulfilled");
  assert.strictEqual(fulfilledRequest.evidence, "evidence-lifecycle");

  const secondFulfill = asError(capability.fulfillDataSubjectRequest(
    fulfilled,
    "request-lifecycle",
    "tenant-lifecycle",
    "late-evidence",
    "operator-lifecycle",
    auditFn,
  ));
  assert.strictEqual(secondFulfill.kind, "CONFIGURATION_MISSING");
  assert.ok(auditEvents.some((event) => event.kind === "CLASSIFICATION_CHANGE"));
});

test("datagovernancecataloglineageclassificationpiidsrgdprpermissions", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = (event: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError | null => {
    auditEvents.push(event);
    return null;
  };

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-permissions",
    datasetId: "dataset-permissions",
    classification: "PII" as const,
    lineage: ["source-permissions"],
    tenantId: "tenant-permissions",
  };
  const withEntry = asState(capability.addCatalogEntry(capability.initialState, entry, auditFn));

  const tenant1Entries = capability.getCatalogEntriesForTenant(withEntry, "tenant-permissions");
  assert.strictEqual(tenant1Entries.length, 1);
  assert.strictEqual(tenant1Entries[0].id, "entry-permissions");
  const tenantKeys = Object.keys(tenant1Entries[0]).sort();
  assert.deepStrictEqual(
    tenantKeys,
    ["classification", "datasetId", "id", "lineage", "tenantId"].sort(),
  );

  const tenant2Entries = capability.getCatalogEntriesForTenant(withEntry, "tenant-other");
  assert.strictEqual(tenant2Entries.length, 0);

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-permissions",
    tenantId: "tenant-permissions",
    datasetId: "dataset-permissions",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request));

  const tenant1Requests = capability.getRequestsForTenant(withRequest, "tenant-permissions");
  assert.strictEqual(tenant1Requests.length, 1);
  assert.strictEqual(tenant1Requests[0].id, "request-permissions");

  const tenant2Requests = capability.getRequestsForTenant(withRequest, "tenant-other");
  assert.strictEqual(tenant2Requests.length, 0);

  const crossTenantUpdate = asError(capability.updateCatalogEntryClassification(
    withEntry,
    "entry-permissions",
    "sensitive",
    "tenant-other",
    auditFn,
  ));
  assert.strictEqual(crossTenantUpdate.kind, "TENANT_BOUNDARY_VIOLATION");

  const crossTenantFulfill = asError(capability.fulfillDataSubjectRequest(
    withRequest,
    "request-permissions",
    "tenant-other",
    "evidence-permissions",
    "operator-other",
    auditFn,
  ));
  assert.strictEqual(crossTenantFulfill.kind, "TENANT_BOUNDARY_VIOLATION");

  const fulfilled = asState(capability.fulfillDataSubjectRequest(
    withRequest,
    "request-permissions",
    "tenant-permissions",
    "evidence-permissions",
    "operator-permissions",
    auditFn,
  ));
  const completed = capability.getRequestsForTenant(fulfilled, "tenant-permissions").find(
    (item) => item.id === "request-permissions",
  );
  assert.ok(completed !== undefined);
  assert.strictEqual(completed.operatorId, "operator-permissions");
});

test("datagovernancecataloglineageclassificationpiidsrgdprproof", () => {
  const validClassifications: readonly capability.DataGovernanceCatalogClassification[] = [
    "none",
    "PII",
    "sensitive",
  ];
  for (const classification of validClassifications) {
    const result = capability.validateClassification(classification, "tenant-proof");
    assert.strictEqual(result, classification);
  }

  const invalidClassification = asError(capability.validateClassification("not-a-valid-value", "tenant-proof"));
  assert.strictEqual(invalidClassification.kind, "INVALID_CLASSIFICATION");

  const validStates: readonly capability.DataSubjectRequestState[] = ["open", "fulfilled"];
  for (const state of validStates) {
    const result = capability.validateRequestState(state, "tenant-proof");
    assert.strictEqual(result, state);
  }

  const invalidState = asError(capability.validateRequestState("done", "tenant-proof"));
  assert.strictEqual(invalidState.kind, "CONFIGURATION_MISSING");

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-proof",
    tenantId: "tenant-proof",
    datasetId: "dataset-proof",
  };
  const withRequest = asState(capability.createDataSubjectRequest(capability.initialState, request));

  const missingEvidence = asError(capability.fulfillDataSubjectRequest(
    withRequest,
    "request-proof",
    "tenant-proof",
    "",
    "operator-proof",
    () => null,
  ));
  assert.strictEqual(missingEvidence.kind, "MISSING_EVIDENCE");

  const withFulfillment = asState(capability.fulfillDataSubjectRequest(
    withRequest,
    "request-proof",
    "tenant-proof",
    "proof-evidence",
    "operator-proof",
    () => null,
  ));
  const proofRequest = capability.getRequestsForTenant(withFulfillment, "tenant-proof")[0];
  assert.ok(proofRequest !== undefined);
  assert.strictEqual(proofRequest.evidence, "proof-evidence");

  const proofEvent = capability.auditCatalogChange(
    "tenant-proof",
    "request-proof",
    "REQUEST_FULFILLED",
    { kind: "proof", evidence: "proof-evidence" },
    () => null,
  );
  assert.strictEqual(proofEvent, null);
});

test("datagovernancecataloglineageclassificationpiidsrgdprreadinessmodel", () => {
  const seedEntry: capability.DataGovernanceCatalogEntry = {
    id: "entry-readiness",
    datasetId: "dataset-readiness",
    classification: "PII" as const,
    lineage: ["source-readiness"],
    tenantId: "tenant-readiness",
  };
  const readyState = asState(capability.addCatalogEntry(capability.initialState, seedEntry, () => null));

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-readiness",
    tenantId: "tenant-readiness",
    datasetId: "dataset-readiness",
  };
  const readyRequestState = asState(capability.createDataSubjectRequest(readyState, request));

  const readinessEvents: capability.DataGovernanceAuditEvent[] = [];
  const readinessAuditFn = (
    event: capability.DataGovernanceAuditEvent,
  ): capability.DataGovernanceCatalogError => {
    readinessEvents.push(event);
    return {
      kind: "DEGRADED_READINESS",
      message: "readiness blocked",
      tenantId: event.tenantId,
    };
  };

  const blockedAdd = asError(capability.addCatalogEntry(
    readyState,
    {
      id: "entry-readiness-disabled",
      datasetId: "dataset-readiness-disabled",
      classification: "PII",
      lineage: [],
      tenantId: "tenant-readiness",
    },
    readinessAuditFn,
  ));
  assert.strictEqual(blockedAdd.kind, "DEGRADED_READINESS");

  const blockedUpdate = asError(capability.updateCatalogEntryClassification(
    readyState,
    "entry-readiness",
    "sensitive",
    "tenant-readiness",
    readinessAuditFn,
  ));
  assert.strictEqual(blockedUpdate.kind, "DEGRADED_READINESS");

  const blockedFulfill = asError(capability.fulfillDataSubjectRequest(
    readyRequestState,
    "request-readiness",
    "tenant-readiness",
    "evidence-readiness",
    "operator-readiness",
    readinessAuditFn,
  ));
  assert.strictEqual(blockedFulfill.kind, "DEGRADED_READINESS");

  const readOnlyCatalog = capability.getCatalogEntriesForTenant(readyState, "tenant-readiness");
  assert.strictEqual(readOnlyCatalog.length, 1);

  const readOnlyRequests = capability.getRequestsForTenant(readyRequestState, "tenant-readiness");
  assert.strictEqual(readOnlyRequests.length, 1);

  const probe = asError(
    capability.auditCatalogChange(
      "tenant-readiness",
      "entry-readiness",
      "TENANT_SCOPE_CHANGE",
      { probe: "readiness" },
      readinessAuditFn,
    ),
  );
  assert.strictEqual(probe.kind, "DEGRADED_READINESS");
  assert.ok(readinessEvents.some((event) => event.tenantId === "tenant-readiness"));
});

test("datagovernancecataloglineageclassificationpiidsrgdprstatemodel", () => {
  const auditFn = (event: capability.DataGovernanceAuditEvent): capability.DataGovernanceCatalogError | null => {
    return null;
  };

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-state",
    datasetId: "dataset-state",
    classification: "none" as const,
    lineage: ["source-state"],
    tenantId: "tenant-state",
  };
  const withEntry = asState(capability.addCatalogEntry(capability.initialState, entry, auditFn));

  const catalogRecord = capability.getCatalogEntriesForTenant(withEntry, "tenant-state")[0];
  assert.ok(catalogRecord !== undefined);
  assert.strictEqual(catalogRecord.classification, "none");
  assert.deepStrictEqual(catalogRecord.lineage, ["source-state"]);

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-state",
    tenantId: "tenant-state",
    datasetId: "dataset-state",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request));
  const createdRequest = capability.getRequestsForTenant(withRequest, "tenant-state")[0];
  assert.ok(createdRequest !== undefined);
  assert.strictEqual(createdRequest.state, "open");
  assert.strictEqual(createdRequest.evidence, null);
  assert.strictEqual(createdRequest.operatorId, null);

  const fulfilled = asState(capability.fulfillDataSubjectRequest(
    withRequest,
    "request-state",
    "tenant-state",
    "state-evidence",
    "operator-state",
    auditFn,
  ));
  const fulfilledRequest = capability.getRequestsForTenant(fulfilled, "tenant-state")[0];
  assert.ok(fulfilledRequest !== undefined);
  assert.strictEqual(fulfilledRequest.state, "fulfilled");
  assert.strictEqual(fulfilledRequest.evidence, "state-evidence");
  assert.strictEqual(fulfilledRequest.operatorId, "operator-state");

  const reclassified = asState(capability.updateCatalogEntryClassification(
    fulfilled,
    "entry-state",
    "sensitive",
    "tenant-state",
    auditFn,
  ));
  const preserved = capability.getRequestsForTenant(reclassified, "tenant-state")[0];
  assert.ok(preserved !== undefined);
  assert.strictEqual(preserved.evidence, "state-evidence");
  assert.strictEqual(capability.getCatalogEntriesForTenant(reclassified, "tenant-state")[0].classification, "sensitive");
});

test("datagovernancecataloglineageclassificationpiidsrgdprvalidation", () => {
  const validClassifications: readonly capability.DataGovernanceCatalogClassification[] = [
    "none",
    "PII",
    "sensitive",
  ];
  for (const classification of validClassifications) {
    const classificationResult = capability.validateClassification(classification, "tenant-validation");
    assert.strictEqual(classificationResult, classification);
  }
  const invalidClassification = asError(capability.validateClassification("bad-value", "tenant-validation"));
  assert.strictEqual(invalidClassification.kind, "INVALID_CLASSIFICATION");

  const validStates: readonly capability.DataSubjectRequestState[] = ["open", "fulfilled"];
  for (const state of validStates) {
    const stateResult = capability.validateRequestState(state, "tenant-validation");
    assert.strictEqual(stateResult, state);
  }
  const invalidState = asError(capability.validateRequestState("bad-state", "tenant-validation"));
  assert.strictEqual(invalidState.kind, "CONFIGURATION_MISSING");

  const request: Omit<
    capability.DataSubjectRequest,
    "state" | "evidence" | "operatorId"
  > = {
    id: "request-validation",
    tenantId: "tenant-validation",
    datasetId: "dataset-validation",
  };
  const withRequest = asState(capability.createDataSubjectRequest(capability.initialState, request));

  const missingEvidence = asError(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-validation",
      "tenant-validation",
      "   ",
      "operator-validation",
      () => null,
    ),
  );
  assert.strictEqual(missingEvidence.kind, "MISSING_EVIDENCE");
});