import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/observabilityops/observabilitybuiltinalertingandincidents.ts";

test("observabilitybuiltinalertingandincidentsauditmodel", () => {
  const initial = capability.initialState;
  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const auditFn = (event: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => {
    auditEvents.push(event);
  };

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const result = capability.addAlertRule(initial, rule, "req-1", "trace-1", auditFn);
  assert.ok(!("kind" in result));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "ALERT_RULE_CHANGE");
  assert.strictEqual(auditEvents[0].entityType, "ALERT_RULE");
  assert.strictEqual(auditEvents[0].requestId, "req-1");
  assert.strictEqual(auditEvents[0].traceId, "trace-1");

  const incident: capability.ObservabilityBuiltInAlertingAndIncidentsIncident = {
    id: "inc-1",
    alertId: "alert-1",
    state: "OPEN",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithIncident: capability.ObservabilityBuiltInAlertingAndIncidentsState = {
    ...result,
    incidents: [incident],
  };
  const transitionResult = capability.transitionIncident(
    stateWithIncident,
    "inc-1",
    "ACKNOWLEDGED",
    "req-2",
    "trace-2",
    auditFn,
  );
  assert.ok(!("kind" in transitionResult));
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[1].kind, "INCIDENT_TRANSITION");
  assert.strictEqual(auditEvents[1].entityType, "INCIDENT");
  assert.strictEqual(auditEvents[1].requestId, "req-2");
  assert.strictEqual(auditEvents[1].traceId, "trace-2");

  const dispatchResult = capability.dispatchNotification(
    transitionResult,
    "inc-1",
    "req-3",
    "trace-3",
    auditFn,
  );
  assert.ok(!("kind" in dispatchResult));
  assert.strictEqual(auditEvents.length, 3);
  assert.strictEqual(auditEvents[2].kind, "NOTIFICATION_DISPATCH");
  assert.strictEqual(auditEvents[2].entityType, "NOTIFICATION");
  assert.strictEqual(auditEvents[2].requestId, "req-3");
  assert.strictEqual(auditEvents[2].traceId, "trace-3");
});

test("observabilitybuiltinalertingandincidentscontracts", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 15,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    (e) => auditEvents.push(e),
  );
  assert.ok(!("kind" in stateWithRule));

  const evaluation = capability.evaluateAlertRules(stateWithRule, "2024-01-01T00:01:00Z");
  assert.strictEqual(evaluation.newAlerts.length, 1);
  assert.strictEqual(evaluation.newAlerts[0].state, "FIRED");
  assert.strictEqual(evaluation.updatedIncidents.length, 1);
  assert.strictEqual(evaluation.updatedIncidents[0].state, "OPEN");
  assert.strictEqual(evaluation.newNotifications.length, 1);
  assert.strictEqual(evaluation.newNotifications[0].status, "SENT");

  const readiness = capability.checkReadiness(stateWithRule);
  assert.strictEqual(readiness, "READY");
});

test("observabilitybuiltinalertingandincidentserrormodel", () => {
  const invalidRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "INVALID" as capability.ObservabilityBuiltInAlertingAndIncidentsComparator,
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const auditFn = () => {};
  const result = capability.addAlertRule(
    capability.initialState,
    invalidRule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok("kind" in result);
  assert.strictEqual(result.kind, "INVALID_RULE_MUTATION");

  const stateWithIncident: capability.ObservabilityBuiltInAlertingAndIncidentsState = {
    ...capability.initialState,
    incidents: [
      {
        id: "inc-1",
        alertId: "alert-1",
        state: "RESOLVED",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        tenantId: "tenant-1",
      },
    ],
  };
  const transitionResult = capability.transitionIncident(
    stateWithIncident,
    "inc-1",
    "OPEN",
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok("kind" in transitionResult);
  assert.strictEqual(transitionResult.kind, "ILLEGAL_INCIDENT_TRANSITION");

  const errorState = capability.handleProviderFailure(
    capability.initialState,
    "PROVIDER_FAILURE",
    "Provider down",
  );
  assert.strictEqual(errorState.lastError?.kind, "PROVIDER_FAILURE");
  assert.strictEqual(errorState.readiness, "DEGRADED_SIGNAL_INGESTION");
});

test("observabilitybuiltinalertingandincidentslifecycle", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 15,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const auditFn = () => {};
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok(!("kind" in stateWithRule));

  const evaluation = capability.evaluateAlertRules(stateWithRule, "2024-01-01T00:01:00Z");
  assert.strictEqual(evaluation.newAlerts.length, 1);
  assert.strictEqual(evaluation.newAlerts[0].state, "FIRED");
  assert.strictEqual(evaluation.updatedIncidents.length, 1);
  assert.strictEqual(evaluation.updatedIncidents[0].state, "OPEN");
  assert.strictEqual(evaluation.newNotifications.length, 1);
  assert.strictEqual(evaluation.newNotifications[0].status, "SENT");
});

test("observabilitybuiltinalertingandincidentspermissions", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 15,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  assert.strictEqual(stateWithSignal.metricSignals[0].tenantId, "tenant-1");

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const auditFn = () => {};
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok(!("kind" in stateWithRule));
  assert.strictEqual(stateWithRule.alertRules[0].tenantId, "tenant-1");

  const incident: capability.ObservabilityBuiltInAlertingAndIncidentsIncident = {
    id: "inc-1",
    alertId: "alert-1",
    state: "OPEN",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithIncident: capability.ObservabilityBuiltInAlertingAndIncidentsState = {
    ...stateWithRule,
    incidents: [incident],
  };
  assert.strictEqual(stateWithIncident.incidents[0].tenantId, "tenant-1");
});

test("observabilitybuiltinalertingandincidentsproof", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 15,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const auditFn = () => {};
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok(!("kind" in stateWithRule));

  const evaluation = capability.evaluateAlertRules(stateWithRule, "2024-01-01T00:01:00Z");
  assert.strictEqual(evaluation.newAlerts.length, 1);
  assert.strictEqual(evaluation.newAlerts[0].state, "FIRED");
  assert.strictEqual(evaluation.updatedIncidents.length, 1);
  assert.strictEqual(evaluation.updatedIncidents[0].state, "OPEN");
  assert.strictEqual(evaluation.newNotifications.length, 1);
  assert.strictEqual(evaluation.newNotifications[0].status, "SENT");
});

test("observabilitybuiltinalertingandincidentsreadinessmodel", () => {
  const initialReadiness = capability.checkReadiness(capability.initialState);
  assert.strictEqual(initialReadiness, "UNREADY");

  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 15,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  const readinessWithSignal = capability.checkReadiness(stateWithSignal);
  assert.strictEqual(readinessWithSignal, "DEGRADED_ALERT_EVALUATION");

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const auditFn = () => {};
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok(!("kind" in stateWithRule));
  const readinessWithRule = capability.checkReadiness(stateWithRule);
  assert.strictEqual(readinessWithRule, "READY");

  const errorState = capability.handleProviderFailure(stateWithRule, "PROVIDER_FAILURE", "Provider down");
  assert.strictEqual(errorState.readiness, "DEGRADED_SIGNAL_INGESTION");
});

test("observabilitybuiltinalertingandincidentsstatemodel", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 15,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  assert.strictEqual(stateWithSignal.metricSignals.length, 1);
  assert.strictEqual(stateWithSignal.metricSignals[0].name, "test-metric");

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const auditFn = () => {};
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok(!("kind" in stateWithRule));
  assert.strictEqual(stateWithRule.alertRules.length, 1);
  assert.strictEqual(stateWithRule.alertRules[0].comparator, "GT");

  const evaluation = capability.evaluateAlertRules(stateWithRule, "2024-01-01T00:01:00Z");
  assert.strictEqual(evaluation.newAlerts.length, 1);
  assert.strictEqual(evaluation.newAlerts[0].state, "FIRED");
  assert.strictEqual(evaluation.updatedIncidents.length, 1);
  assert.strictEqual(evaluation.updatedIncidents[0].state, "OPEN");
  assert.strictEqual(evaluation.newNotifications.length, 1);
  assert.strictEqual(evaluation.newNotifications[0].status, "SENT");
});

test("observabilitybuiltinalertingandincidentsvalidation", () => {
  const auditFn = () => {};
  const invalidComparatorRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "INVALID" as capability.ObservabilityBuiltInAlertingAndIncidentsComparator,
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const resultComparator = capability.addAlertRule(
    capability.initialState,
    invalidComparatorRule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok("kind" in resultComparator);
  assert.strictEqual(resultComparator.kind, "INVALID_RULE_MUTATION");

  const invalidThresholdRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: NaN,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const resultThreshold = capability.addAlertRule(
    capability.initialState,
    invalidThresholdRule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok("kind" in resultThreshold);
  assert.strictEqual(resultThreshold.kind, "INVALID_RULE_MUTATION");

  const invalidSeverityRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "INVALID" as capability.ObservabilityBuiltInAlertingAndIncidentsSeverity,
    tenantId: "tenant-1",
  };
  const resultSeverity = capability.addAlertRule(
    capability.initialState,
    invalidSeverityRule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok("kind" in resultSeverity);
  assert.strictEqual(resultSeverity.kind, "INVALID_RULE_MUTATION");

  const invalidNameRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "invalid name!",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const resultName = capability.addAlertRule(
    capability.initialState,
    invalidNameRule,
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok("kind" in resultName);
  assert.strictEqual(resultName.kind, "INVALID_RULE_MUTATION");

  const stateWithIncident: capability.ObservabilityBuiltInAlertingAndIncidentsState = {
    ...capability.initialState,
    incidents: [
      {
        id: "inc-1",
        alertId: "alert-1",
        state: "RESOLVED",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        tenantId: "tenant-1",
      },
    ],
  };
  const transitionResult = capability.transitionIncident(
    stateWithIncident,
    "inc-1",
    "OPEN",
    "req-1",
    "trace-1",
    auditFn,
  );
  assert.ok("kind" in transitionResult);
  assert.strictEqual(transitionResult.kind, "ILLEGAL_INCIDENT_TRANSITION");
});