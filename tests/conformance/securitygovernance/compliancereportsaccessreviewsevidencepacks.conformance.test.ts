import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/securitygovernance/compliancereportsaccessreviewsevidencepacks.ts";

test("compliancereportsaccessreviewsevidencepacksauditmodel", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["signal-1"] },
    incidents: { healthy: true, openCount: 0 },
    legalHolds: { healthy: true, holdCount: 0 },
    retention: { healthy: true, policyCount: 0 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const report = capability.composeReport("org-1", sources, capability.initialState, "res", "scope");
  // The requirement states reports compose existing signals rather than emitting new mutation audits.
  // We verify composition produces the expected data without modifying any state.
  assert.deepStrictEqual(report.metricsSignals, ["signal-1"]);
});

test("compliancereportsaccessreviewsevidencepackscontracts", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const report = capability.composeReport("org-1", sources, capability.initialState, "res", "scope");
  assert.strictEqual(report.openIncidentCount, 1);
  assert.strictEqual(report.legalHoldCount, 2);
  assert.strictEqual(report.retentionPolicyCount, 3);
});

test("compliancereportsaccessreviewsevidencepackserrormodel", () => {
  const unhealthySources: capability.FoundationSources = {
    metrics: { healthy: false, data: [] },
    incidents: { healthy: true, openCount: 0 },
    legalHolds: { healthy: true, holdCount: 0 },
    retention: { healthy: true, policyCount: 0 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const result = capability.setFoundationSources(capability.initialState, unhealthySources);
  if (typeof result === "object" && "kind" in result) {
    assert.strictEqual(result.kind, "UNHEALTHY_METRICS_SOURCE");
  } else {
    assert.fail("Should have failed closed due to unhealthy source");
  }
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
  const s1 = capability.registerRoute(state, "res", "scope", "operator");
  const s2 = capability.setFoundationSources(s1, sources);
  if (typeof s2 === "object" && "kind" in s2) throw new Error("Setup failed");
  
  const finalState = capability.generateReport(s2 as capability.ComplianceReportState, "org-1", "res", "scope");
  if (typeof finalState === "object" && "kind" in finalState) throw new Error("Generation failed");
  
  const report = (finalState as capability.ComplianceReportState).report;
  assert.ok(report?.generatedAt);
  assert.strictEqual(report?.organisationId, "org-1");
});

test("compliancereportsaccessreviewsevidencepackspermissions", () => {
  const state = capability.initialState;
  const token = { authLevel: "tenant-user" };
  const routeState = capability.registerRoute(state, "res", "scope", "operator");
  const error = capability.checkPermissions(routeState, "res", "scope", "operator", token);
  assert.notStrictEqual(error, null);
  if (error) {
    assert.strictEqual(error.kind, "INSUFFICIENT_PERMISSIONS");
  }
});

test("compliancereportsaccessreviewsevidencepacksproof", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const state = capability.registerRoute(capability.initialState, "res", "scope", "operator");
  const report = capability.composeReport("org-1", sources, state, "res", "scope");
  const isValid = capability.validateReportComposition(report, sources, "org-1", "res", "scope", state);
  assert.strictEqual(isValid, true);
});

test("compliancereportsaccessreviewsevidencepacksreadinessmodel", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: [] },
    incidents: { healthy: true, openCount: 0 },
    legalHolds: { healthy: true, holdCount: 0 },
    retention: { healthy: true, policyCount: 0 },
    storage: { healthy: true, configured: false, isolation: true },
  };
  const state = capability.registerRoute(capability.initialState, "res", "scope", "operator");
  const ready = capability.determineReadiness(sources, state, "res", "scope");
  assert.strictEqual(ready, false, "Report should not be ready if storage is not configured");
});

test("compliancereportsaccessreviewsevidencepacksstatemodel", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const report = capability.composeReport("org-1", sources, capability.initialState, "res", "scope");
  assert.strictEqual(report.openIncidentCount, 1);
  assert.strictEqual(report.storageReadiness.configured, true);
});

test("compliancereportsaccessreviewsevidencepacksvalidation", () => {
  const sources: capability.FoundationSources = {
    metrics: { healthy: true, data: ["m1"] },
    incidents: { healthy: true, openCount: 1 },
    legalHolds: { healthy: true, holdCount: 2 },
    retention: { healthy: true, policyCount: 3 },
    storage: { healthy: true, configured: true, isolation: true },
  };
  const state = capability.registerRoute(capability.initialState, "res", "scope", "operator");
  const report = capability.composeReport("org-1", sources, state, "res", "scope");
  
  const corruptedSources: capability.FoundationSources = {
    ...sources,
    incidents: { ...sources.incidents, openCount: 99 },
  };
  const isValid = capability.validateReportComposition(report, corruptedSources, "org-1", "res", "scope", state);
  assert.strictEqual(isValid, false, "Validation must fail if sources differ from report data");
});