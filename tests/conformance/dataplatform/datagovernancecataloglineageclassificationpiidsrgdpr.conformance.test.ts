import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/datagovernancecataloglineageclassificationpiidsrgdpr.ts";

type CatalogResult = capability.DataGovernanceCatalogState | capability.DataGovernanceCatalogError;
type AuditFn = (event: capability.DataGovernanceAuditEvent) => capability.DataGovernanceCatalogError | null;
type MaybeError = capability.DataGovernanceCatalogError | null;

function isCapabilityError(value: unknown): value is capability.DataGovernanceCatalogError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

function asState(result: CatalogResult): capability.DataGovernanceCatalogState {
  if (isCapabilityError(result)) {
    assert.fail(`expected success but got ${(result as capability.DataGovernanceCatalogError).kind}: ${(result as capability.DataGovernanceCatalogError).message}`);
  }
  return result as capability.DataGovernanceCatalogState;
}

function asError(result: CatalogResult): capability.DataGovernanceCatalogError {
  if (!isCapabilityError(result)) {
    assert.fail("expected an error result");
  }
  return result;
}

function recordingAudit(
  sink: capability.DataGovernanceAuditEvent[],
): (event: capability.DataGovernanceAuditEvent) => capability.DataGovernanceCatalogError | null {
  return (event: capability.DataGovernanceAuditEvent) => {
    sink.push(event);
    return null;
  };
}

test("datagovernancecataloglineageclassificationpiidsrgdprauditmodel", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = recordingAudit(auditEvents);

  const seed: capability.DataGovernanceCatalogEntry = {
    id: "entry-audit",
    datasetId: "dataset-audit",
    classification: "PII",
    lineage: ["source-a", "source-b"],
    tenantId: "tenant-audit",
  };
  const withEntry = asState(capability.addCatalogEntry(capability.initialState, seed, auditFn));

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-audit",
    tenantId: "tenant-audit",
    datasetId: "dataset-audit",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request, auditFn));

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
  assert.ok(tenantAudit.length >= 3);
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

  const spanResult: MaybeError = capability.auditCatalogChange(
    "tenant-audit",
    "entry-audit",
    "LINEAGE_UPDATE",
    {
      route: "request.fulfillment",
      useCase: "pii-remediation",
      provider: "governance-adapter",
      span: "tenant-audit:request-audit",
    },
    recordingAudit(auditEvents),
  );
  assert.strictEqual(spanResult, null);
  const recorded = auditEvents.find(
    (event) => event.kind === "LINEAGE_UPDATE" && event.tenantId === "tenant-audit",
  );
  assert.ok(recorded !== undefined);
  const spanDetails = recorded.details as {
    route: string;
    useCase: string;
    provider: string;
    span: string;
  };
  assert.strictEqual(spanDetails.route, "request.fulfillment");
  assert.strictEqual(spanDetails.useCase, "pii-remediation");
  assert.strictEqual(spanDetails.provider, "governance-adapter");
  assert.ok(spanDetails.span.includes("tenant-audit"));
});

test("datagovernancecataloglineageclassificationpiidsrgdprcontracts", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = recordingAudit(auditEvents);

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-contracts",
    datasetId: "dataset-contracts",
    classification: "sensitive",
    lineage: ["source-contracts"],
    tenantId: "tenant-contracts",
  };
  const withEntry = asState(capability.addCatalogEntry(capability.initialState, entry, auditFn));

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-contracts",
    tenantId: "tenant-contracts",
    datasetId: "dataset-contracts",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request, auditFn));

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

  const invalidClass = capability.validateClassification("invalid-classification", "tenant-contracts");
  assert.ok(isCapabilityError(invalidClass));
  if (isCapabilityError(invalidClass)) {
    assert.strictEqual(invalidClass.kind, "INVALID_CLASSIFICATION");
  }

  const invalidRoute = asError(
    capability.updateCatalogEntryClassification(
      withEntry,
      "entry-contracts",
      "invalid",
      "tenant-contracts",
      auditFn,
    ),
  );
  assert.strictEqual(invalidRoute.kind, "INVALID_CLASSIFICATION");

  const duplicate = asError(
    capability.createDataSubjectRequest(fulfilled, request, auditFn),
  );
  assert.strictEqual(duplicate.kind, "TENANT_BOUNDARY_VIOLATION");

  assert.ok(auditEvents.some((event) => event.kind === "CLASSIFICATION_CHANGE"));
  assert.ok(auditEvents.some((event) => event.kind === "REQUEST_FULFILLED"));

  const evidencePack = capability.evidencePackForTenant(fulfilled, "tenant-contracts");
  assert.strictEqual(evidencePack.catalog.length, 1);
  assert.strictEqual(evidencePack.requests.length, 1);
  assert.ok(evidencePack.auditLog.length >= 3);
});

test("datagovernancecataloglineageclassificationpiidsrgdprerrormodel", () => {
  const blockedEvents: capability.DataGovernanceAuditEvent[] = [];
  const blockedAuditFn: AuditFn = (
    event: capability.DataGovernanceAuditEvent,
  ): capability.DataGovernanceCatalogError => {
    blockedEvents.push(event);
    return {
      kind: "DEGRADED_READINESS",
      message: "governance adapter degraded",
      tenantId: event.tenantId,
    };
  };

  const badClassification = capability.validateClassification("invalid", "tenant-error");
  assert.ok(isCapabilityError(badClassification));
  if (isCapabilityError(badClassification)) {
    assert.strictEqual(badClassification.kind, "INVALID_CLASSIFICATION");
    assert.strictEqual(badClassification.tenantId, "tenant-error");
  }

  const badRequestState = capability.validateRequestState("invalid", "tenant-error");
  assert.ok(isCapabilityError(badRequestState));
  if (isCapabilityError(badRequestState)) {
    assert.strictEqual(badRequestState.kind, "CONFIGURATION_MISSING");
  }

  const baselineEntry: capability.DataGovernanceCatalogEntry = {
    id: "entry-error",
    datasetId: "dataset-error",
    classification: "PII",
    lineage: ["source-error"],
    tenantId: "tenant-error",
  };

  const addBlocked = asError(
    capability.addCatalogEntry(capability.initialState, baselineEntry, blockedAuditFn),
  );
  assert.strictEqual(addBlocked.kind, "DEGRADED_READINESS");
  assert.strictEqual(addBlocked.tenantId, "tenant-error");
  assert.ok(addBlocked.message.includes("governance adapter degraded"));

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-error",
    tenantId: "tenant-error",
    datasetId: "dataset-error",
  };
  const seeded = asState(capability.createDataSubjectRequest(capability.initialState, request, () => null));
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

  const presentState = asState(
    capability.addCatalogEntry(capability.initialState, baselineEntry, () => null),
  );
  const boundaryViolation = asError(
    capability.updateCatalogEntryClassification(
      presentState,
      "entry-error",
      "sensitive",
      "tenant-other",
      () => null,
    ),
  );
  assert.strictEqual(boundaryViolation.kind, "TENANT_BOUNDARY_VIOLATION");
  assert.strictEqual(boundaryViolation.tenantId, "tenant-other");
});

test("datagovernancecataloglineageclassificationpiidsrgdprlifecycle", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = recordingAudit(auditEvents);

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-lifecycle",
    datasetId: "dataset-lifecycle",
    classification: "none",
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

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-lifecycle",
    tenantId: "tenant-lifecycle",
    datasetId: "dataset-lifecycle",
  };
  const withRequest = asState(capability.createDataSubjectRequest(reclassified, request, auditFn));

  const missingEvidence = asError(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-lifecycle",
      "tenant-lifecycle",
      "",
      "operator-lifecycle",
      auditFn,
    ),
  );
  assert.strictEqual(missingEvidence.kind, "MISSING_EVIDENCE");

  const fulfilled = asState(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-lifecycle",
      "tenant-lifecycle",
      "evidence-lifecycle",
      "operator-lifecycle",
      auditFn,
    ),
  );
  const fulfilledRequest = capability.getRequestsForTenant(fulfilled, "tenant-lifecycle").find(
    (item) => item.id === "request-lifecycle",
  );
  assert.ok(fulfilledRequest !== undefined);
  assert.strictEqual(fulfilledRequest.state, "fulfilled");
  assert.strictEqual(fulfilledRequest.evidence, "evidence-lifecycle");

  const secondFulfill = asError(
    capability.fulfillDataSubjectRequest(
      fulfilled,
      "request-lifecycle",
      "tenant-lifecycle",
      "late-evidence",
      "operator-lifecycle",
      auditFn,
    ),
  );
  assert.strictEqual(secondFulfill.kind, "CONFIGURATION_MISSING");
  assert.ok(auditEvents.some((event) => event.kind === "CLASSIFICATION_CHANGE"));
});

test("datagovernancecataloglineageclassificationpiidsrgdprpermissions", () => {
  const auditEvents: capability.DataGovernanceAuditEvent[] = [];
  const auditFn = recordingAudit(auditEvents);

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-permissions",
    datasetId: "dataset-permissions",
    classification: "PII",
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
  assert.ok(!("secret" in tenant1Entries[0]));
  assert.ok(!("password" in tenant1Entries[0]));
  assert.ok(!("token" in tenant1Entries[0]));

  const tenant2Entries = capability.getCatalogEntriesForTenant(withEntry, "tenant-other");
  assert.strictEqual(tenant2Entries.length, 0);

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-permissions",
    tenantId: "tenant-permissions",
    datasetId: "dataset-permissions",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request, auditFn));

  const tenant1Requests = capability.getRequestsForTenant(withRequest, "tenant-permissions");
  assert.strictEqual(tenant1Requests.length, 1);
  assert.strictEqual(tenant1Requests[0].id, "request-permissions");

  const tenant2Requests = capability.getRequestsForTenant(withRequest, "tenant-other");
  assert.strictEqual(tenant2Requests.length, 0);

  const crossTenantUpdate = asError(
    capability.updateCatalogEntryClassification(
      withEntry,
      "entry-permissions",
      "sensitive",
      "tenant-other",
      auditFn,
    ),
  );
  assert.strictEqual(crossTenantUpdate.kind, "TENANT_BOUNDARY_VIOLATION");

  const crossTenantFulfill = asError(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-permissions",
      "tenant-other",
      "evidence-permissions",
      "operator-other",
      auditFn,
    ),
  );
  assert.strictEqual(crossTenantFulfill.kind, "TENANT_BOUNDARY_VIOLATION");

  const fulfilled = asState(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-permissions",
      "tenant-permissions",
      "evidence-permissions",
      "operator-permissions",
      auditFn,
    ),
  );
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

  const invalidClassificationResult = capability.validateClassification("not-a-valid-value", "tenant-proof");
  assert.ok(isCapabilityError(invalidClassificationResult));
  if (isCapabilityError(invalidClassificationResult)) {
    assert.strictEqual(invalidClassificationResult.kind, "INVALID_CLASSIFICATION");
  }

  const validStates: readonly capability.DataSubjectRequestState[] = ["open", "fulfilled"];
  for (const state of validStates) {
    const result = capability.validateRequestState(state, "tenant-proof");
    assert.strictEqual(result, state);
  }

  const invalidStateResult = capability.validateRequestState("done", "tenant-proof");
  assert.ok(isCapabilityError(invalidStateResult));
  if (isCapabilityError(invalidStateResult)) {
    assert.strictEqual(invalidStateResult.kind, "CONFIGURATION_MISSING");
  }

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-proof",
    tenantId: "tenant-proof",
    datasetId: "dataset-proof",
  };
  const withRequest = asState(capability.createDataSubjectRequest(capability.initialState, request, () => null));

  const missingEvidenceResult = capability.fulfillDataSubjectRequest(
    withRequest,
    "request-proof",
    "tenant-proof",
    "",
    "operator-proof",
    () => null,
  );
  assert.ok(isCapabilityError(missingEvidenceResult));
  if (isCapabilityError(missingEvidenceResult)) {
    assert.strictEqual(missingEvidenceResult.kind, "MISSING_EVIDENCE");
  }

  const withFulfillment = asState(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-proof",
      "tenant-proof",
      "proof-evidence",
      "operator-proof",
      () => null,
    ),
  );
  const proofRequest = capability.getRequestsForTenant(withFulfillment, "tenant-proof")[0];
  assert.ok(proofRequest !== undefined);
  assert.strictEqual(proofRequest.evidence, "proof-evidence");

  const proofEvent: MaybeError = capability.auditCatalogChange(
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
    classification: "PII",
    lineage: ["source-readiness"],
    tenantId: "tenant-readiness",
  };
  const readyState = asState(
    capability.addCatalogEntry(capability.initialState, seedEntry, () => null),
  );

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-readiness",
    tenantId: "tenant-readiness",
    datasetId: "dataset-readiness",
  };
  const readyRequestState = asState(capability.createDataSubjectRequest(readyState, request, () => null));

  const readinessEvents: capability.DataGovernanceAuditEvent[] = [];
  const readinessAuditFn: AuditFn = (
    event: capability.DataGovernanceAuditEvent,
  ): capability.DataGovernanceCatalogError => {
    readinessEvents.push(event);
    return {
      kind: "DEGRADED_READINESS",
      message: "readiness blocked",
      tenantId: event.tenantId,
    };
  };

  const degradedState = asState(
    capability.setReadiness(readyState, "DEGRADED", "tenant-readiness"),
  );
  assert.strictEqual(degradedState.readiness, "DEGRADED");

  const checkDegraded = capability.checkReadiness(degradedState, "tenant-readiness");
  assert.strictEqual(checkDegraded.ok, false);
  assert.strictEqual(checkDegraded.readiness, "DEGRADED");
  assert.ok(checkDegraded.error !== null);
  assert.strictEqual(checkDegraded.error.kind, "DEGRADED_READINESS");

  const newEntry: capability.DataGovernanceCatalogEntry = {
    id: "entry-readiness-disabled",
    datasetId: "dataset-readiness-disabled",
    classification: "PII",
    lineage: [],
    tenantId: "tenant-readiness",
  };
  const blockedAdd = asError(capability.addCatalogEntry(degradedState, newEntry, readinessAuditFn));
  assert.strictEqual(blockedAdd.kind, "DEGRADED_READINESS");

  const blockedUpdate = asError(
    capability.updateCatalogEntryClassification(
      degradedState,
      "entry-readiness",
      "sensitive",
      "tenant-readiness",
      readinessAuditFn,
    ),
  );
  assert.strictEqual(blockedUpdate.kind, "DEGRADED_READINESS");

  const blockedFulfill = asError(
    capability.fulfillDataSubjectRequest(
      readyRequestState,
      "request-readiness",
      "tenant-readiness",
      "evidence-readiness",
      "operator-readiness",
      readinessAuditFn,
    ),
  );
  assert.strictEqual(blockedFulfill.kind, "DEGRADED_READINESS");

  const readOnlyCatalog = capability.getCatalogEntriesForTenant(degradedState, "tenant-readiness");
  assert.strictEqual(readOnlyCatalog.length, 1);

  const readOnlyRequests = capability.getRequestsForTenant(readyRequestState, "tenant-readiness");
  assert.strictEqual(readOnlyRequests.length, 1);

  const probe: MaybeError = capability.auditCatalogChange(
    "tenant-readiness",
    "entry-readiness",
    "TENANT_SCOPE_CHANGE",
    { probe: "readiness" },
    readinessAuditFn,
  );
  assert.ok(isCapabilityError(probe));
  if (isCapabilityError(probe)) {
    assert.strictEqual(probe.kind, "DEGRADED_READINESS");
  }
  assert.ok(readinessEvents.some((event) => event.tenantId === "tenant-readiness"));
});

test("datagovernancecataloglineageclassificationpiidsrgdprstatemodel", () => {
  const auditFn: AuditFn = () => null;

  const entry: capability.DataGovernanceCatalogEntry = {
    id: "entry-state",
    datasetId: "dataset-state",
    classification: "none",
    lineage: ["source-state"],
    tenantId: "tenant-state",
  };
  const withEntry = asState(capability.addCatalogEntry(capability.initialState, entry, auditFn));

  const catalogRecord = capability.getCatalogEntriesForTenant(withEntry, "tenant-state")[0];
  assert.ok(catalogRecord !== undefined);
  assert.strictEqual(catalogRecord.classification, "none");
  assert.deepStrictEqual(catalogRecord.lineage, ["source-state"]);

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-state",
    tenantId: "tenant-state",
    datasetId: "dataset-state",
  };
  const withRequest = asState(capability.createDataSubjectRequest(withEntry, request, auditFn));
  const createdRequest = capability.getRequestsForTenant(withRequest, "tenant-state")[0];
  assert.ok(createdRequest !== undefined);
  assert.strictEqual(createdRequest.state, "open");
  assert.strictEqual(createdRequest.evidence, null);
  assert.strictEqual(createdRequest.operatorId, null);

  const fulfilled = asState(
    capability.fulfillDataSubjectRequest(
      withRequest,
      "request-state",
      "tenant-state",
      "state-evidence",
      "operator-state",
      auditFn,
    ),
  );
  const fulfilledRequest = capability.getRequestsForTenant(fulfilled, "tenant-state")[0];
  assert.ok(fulfilledRequest !== undefined);
  assert.strictEqual(fulfilledRequest.state, "fulfilled");
  assert.strictEqual(fulfilledRequest.evidence, "state-evidence");
  assert.strictEqual(fulfilledRequest.operatorId, "operator-state");

  const reclassified = asState(
    capability.updateCatalogEntryClassification(
      fulfilled,
      "entry-state",
      "sensitive",
      "tenant-state",
      auditFn,
    ),
  );
  const preserved = capability.getRequestsForTenant(reclassified, "tenant-state")[0];
  assert.ok(preserved !== undefined);
  assert.strictEqual(preserved.evidence, "state-evidence");
  assert.strictEqual(
    capability.getCatalogEntriesForTenant(reclassified, "tenant-state")[0].classification,
    "sensitive",
  );

  assert.strictEqual(capability.initialState.readiness, "READY");
  assert.deepStrictEqual(capability.initialState.catalog, []);
  assert.deepStrictEqual(capability.initialState.requests, []);
  assert.deepStrictEqual(capability.initialState.auditLog, []);
  assert.strictEqual(capability.initialState.lastError, null);
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
  const invalidClassificationResult = capability.validateClassification("bad-value", "tenant-validation");
  assert.ok(isCapabilityError(invalidClassificationResult));
  if (isCapabilityError(invalidClassificationResult)) {
    assert.strictEqual(invalidClassificationResult.kind, "INVALID_CLASSIFICATION");
  }

  const validStates: readonly capability.DataSubjectRequestState[] = ["open", "fulfilled"];
  for (const state of validStates) {
    const stateResult = capability.validateRequestState(state, "tenant-validation");
    assert.strictEqual(stateResult, state);
  }
  const invalidStateResult = capability.validateRequestState("bad-state", "tenant-validation");
  assert.ok(isCapabilityError(invalidStateResult));
  if (isCapabilityError(invalidStateResult)) {
    assert.strictEqual(invalidStateResult.kind, "CONFIGURATION_MISSING");
  }

  const request: Omit<capability.DataSubjectRequest, "state" | "evidence" | "operatorId"> = {
    id: "request-validation",
    tenantId: "tenant-validation",
    datasetId: "dataset-validation",
  };
  const withRequest = asState(capability.createDataSubjectRequest(capability.initialState, request, () => null));

  const missingEvidenceResult = capability.fulfillDataSubjectRequest(
    withRequest,
    "request-validation",
    "tenant-validation",
    "   ",
    "operator-validation",
    () => null,
  );
  assert.ok(isCapabilityError(missingEvidenceResult));
  if (isCapabilityError(missingEvidenceResult)) {
    assert.strictEqual(missingEvidenceResult.kind, "MISSING_EVIDENCE");
  }

  const missingOperatorResult = capability.fulfillDataSubjectRequest(
    withRequest,
    "request-validation",
    "tenant-validation",
    "validation-evidence",
    "   ",
    () => null,
  );
  assert.ok(isCapabilityError(missingOperatorResult));
  if (isCapabilityError(missingOperatorResult)) {
    assert.strictEqual(missingOperatorResult.kind, "CONFIGURATION_MISSING");
  }
});