import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/securitygovernance/compliancereportsaccessreviewsevidencepacks.ts";

test("compliancereportsaccessreviewsevidencepacksauditmodel", () => {
  const state = capability.initialState;
  const report: capability.ComplianceReport = {
    organisationId: "org-1",
    generatedAt: "2024-01-01T00:00:00.000Z",
    metricsSignals: ["signal1"],
    openIncidentCount: 0,
    legalHoldCount: 0,
    retentionPolicyCount: 0,
    storageReadiness: { configured: true, isolation: true },
    ready: true,
  };
  const newState = { ...state, report };
  const result = capability.getReport(
    newState,
    "compliance",
    "operator",
    "admin",
    { authLevel: "admin" }
  );
  assert.ok(!("kind" in result), "Report read must not be a mutation audit error");
});

test("compliancereportsaccessreviewsevidencepackscontracts", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 0 },
    legalHolds: { healthy: true, holdCount: 0 },
    retention: { healthy: true, policyCount: 0 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const report = capability.composeReport("org-1", sources);
  assert.deepEqual(report.metricsSignals, ["m1"]);
  assert.deepEqual(report.storageReadiness, { configured: true, isolation: true });
  const evidence = capability.exportEvidencePack(report);
  assert.ok(typeof evidence === "string");
});

test("compliancereportsaccessreviewsevidencepackserrormodel", () => {
  const unhealthySources: capability.FoundationSources = {
    metrics: { healthy: false, data: [] },
    incidents: { healthy: true, openCount: 0 },
    legalHolds: { healthy: true, holdCount: 0 },
    retention: { healthy: true, policyCount: 0 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const error = capability.validateFoundationSources(unhealthySources);
  assert.deepEqual(error, {
    kind: "UNHEALTHY_METRICS_SOURCE",
    message: "Metrics source is unhealthy or missing",
  });
});

test("compliancereportsaccessreviewsevidencepackslifecycle", () => {
  const state = capability.initialState;
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const registeredState = capability.registerRoute(state, "compliance", "operator", "admin");
  const reportState = capability.generateReport(
    registeredState,
    "org-1",
    sources,
    "compliance",
    "operator",
    "admin",
    { authLevel: "admin" }
  );
  assert.ok(!("kind" in reportState), "Generation must succeed");
  if (!("kind" in reportState)) {
    assert.ok(reportState.report?.ready);
    assert.ok(reportState.report?.generatedAt);
  }
});

test("compliancereportsaccessreviewsevidencepackspermissions", () => {
  const state = capability.initialState;
  const error = capability.checkPermissions(
    state,
    "compliance",
    "operator",
    "admin",
    null
  );
  assert.deepEqual(error, {
    kind: "INSUFFICIENT_PERMISSIONS",
    message: "Authentication required",
  });
});

test("compliancereportsaccessreviewsevidencepacksproof", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const report = capability.composeReport("org-1", sources);
  const validation = capability.validateReportComposition(report, sources);
  assert.deepEqual(validation, null);
});

test("compliancereportsaccessreviewsevidencepacksreadinessmodel", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: [] },
    incidents: { healthy: true, openCount: 0 },
    legalHolds: { healthy: true, holdCount: 0 },
    retention: { healthy: true, policyCount: 0 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const ready = capability.determineReadiness(sources);
  assert.ok(ready);
  const sourcesNotReady: capability.FoundationSources = {
    metrics: { healthy: true, data: [] },
    incidents: { healthy: true, openCount: 0 },
    legalHolds: { healthy: true, holdCount: 0 },
    retention: { healthy: true, policyCount: 0 },
    storage: { healthy: true, configured: false, isolation: true },
  };
  const notReady = capability.determineReadiness(sourcesNotReady);
  assert.ok(!notReady);
});

test("compliancereportsaccessreviewsevidencepacksstatemodel", () => {
  const state = capability.initialState;
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const reportState = capability.setFoundationSources(state, sources);
  assert.ok(!("kind" in reportState), "State must be updated");
  if (!("kind" in reportState)) {
    assert.deepEqual(reportState.foundationSources, sources);
  }
});

test("compliancereportsaccessreviewsevidencepacksvalidation", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const report = capability.composeReport("org-1", sources);
  const validation = capability.validateReportComposition(report, sources);
  assert.deepEqual(validation, null);
  const mismatchedSources: capability.FoundationSources = {
    ...sources,
    incidents: { healthy: true, openCount: 999 },
  };
  const validationError = capability.validateReportComposition(report, mismatchedSources);
  assert.deepEqual(validationError, {
    kind: "VALIDATION_FAILURE",
    message: "Open incident count mismatch",
  });
});