import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/observabilityops/observabilitybuiltinalertingandincidents.ts";

test("observabilitybuiltinalertingandincidentsauditmodel", () => {
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
  const addResult = capability.addAlertRule(capability.initialState, rule, "req-1", "trace-1", auditFn);
  assert.ok(!("kind" in addResult));
  const stateAfterAdd = addResult as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "ALERT_RULE_CHANGE");
  assert.strictEqual(auditEvents[0].entityType, "ALERT_RULE");
  assert.strictEqual(auditEvents[0].requestId, "req-1");
  assert.strictEqual(auditEvents[0].traceId, "trace-1");

  const incident: capability.ObservabilityBuiltInAlertingAndIncidentsIncident = {
    id: "inc-1",
    alertId: rule.id,
    state: "OPEN",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    tenantId: "tenant-1",
  };
  const stateWithIncident: capability.ObservabilityBuiltInAlertingAndIncidentsState = {
    ...stateAfterAdd,
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
  const stateAfterTransition = transitionResult as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[1].kind, "INCIDENT_TRANSITION");
  assert.strictEqual(auditEvents[1].entityType, "INCIDENT");
  assert.strictEqual(auditEvents[1].requestId, "req-2");
  assert.strictEqual(auditEvents[1].traceId, "trace-2");

  const dispatchResult = capability.dispatchNotification(
    stateAfterTransition,
    "inc-1",
    "req-3",
    "trace-3",
    auditFn,
  );
  assert.ok(!("kind" in dispatchResult));
  const stateAfterDispatch = dispatchResult as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(auditEvents.length, 3);
  assert.strictEqual(auditEvents[2].kind, "NOTIFICATION_DISPATCH");
  assert.strictEqual(auditEvents[2].entityType, "NOTIFICATION");
  assert.strictEqual(auditEvents[2].requestId, "req-3");
  assert.strictEqual(auditEvents[2].traceId, "trace-3");
  assert.strictEqual(stateAfterDispatch.notifications[0].status, "SENT");

  const suppressResult = capability.suppressNotification(
    stateAfterTransition,
    "inc-1",
    "req-4",
    "trace-4",
    auditFn,
  );
  assert.ok(!("kind" in suppressResult));
  const stateAfterSuppress = suppressResult as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(auditEvents.length, 4);
  assert.strictEqual(auditEvents[3].kind, "NOTIFICATION_DISPATCH");
  assert.strictEqual(auditEvents[3].entityType, "NOTIFICATION");
  assert.strictEqual(auditEvents[3].requestId, "req-4");
  assert.strictEqual(auditEvents[3].traceId, "trace-4");
  assert.deepStrictEqual(auditEvents[3].details, { status: "SUPPRESSED" });
  assert.strictEqual(stateAfterSuppress.notifications[0].status, "SUPPRESSED");
});

test("observabilitybuiltinalertingandincidentscontracts", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "temp",
    value: 15,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "t1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  assert.strictEqual(stateWithSignal.metricSignals.length, 1);
  assert.strictEqual(stateWithSignal.metricSignals[0].name, "temp");

  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "tempRule",
    metricName: "temp",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "t1",
  };
  const addResult = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    (e) => auditEvents.push(e),
  );
  assert.ok(!("kind" in addResult));
  const stateWithRule = addResult as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(stateWithRule.alertRules.length, 1);
  assert.strictEqual(stateWithRule.alertRules[0].id, "rule-1");

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
  const errorState = capability.handleProviderFailure(
    capability.initialState,
    "PROVIDER_FAILURE",
    "Provider unavailable"
  );
  assert.strictEqual(errorState.lastError?.kind, "PROVIDER_FAILURE");
  assert.strictEqual(errorState.readiness, "DEGRADED_SIGNAL_INGESTION");

  const illegalTransitionResult = capability.validateIncidentTransition(
    "RESOLVED" as capability.ObservabilityBuiltInAlertingAndIncidentsIncidentState,
    "OPEN" as capability.ObservabilityBuiltInAlertingAndIncidentsIncidentState
  );
  assert.notStrictEqual(illegalTransitionResult, null);
  assert.strictEqual(illegalTransitionResult?.kind, "ILLEGAL_INCIDENT_TRANSITION");

  const invalidRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "invalid-rule!",
    metricName: "test-metric",
    comparator: "INVALID" as capability.ObservabilityBuiltInAlertingAndIncidentsComparator,
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-1",
  };
  const validationResult = capability.validateAlertRuleInput(invalidRule);
  assert.notStrictEqual(validationResult, null);
  assert.strictEqual(validationResult?.kind, "INVALID_RULE_MUTATION");
});

test("observabilitybuiltinalertingandincidentslifecycle", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "cpu-usage",
    value: 80,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "t1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "high-cpu",
    metricName: "cpu-usage",
    comparator: "GT",
    threshold: 75,
    severity: "HIGH",
    tenantId: "t1",
  };
  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    (e) => auditEvents.push(e)
  ) as capability.ObservabilityBuiltInAlertingAndIncidentsState;

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
    value: 10,
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
  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    (e) => auditEvents.push(e)
  ) as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(stateWithRule.alertRules[0].tenantId, "tenant-1");
});

test("observabilitybuiltinalertingandincidentsproof", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 50,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "t1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 40,
    severity: "HIGH",
    tenantId: "t1",
  };
  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    (e) => auditEvents.push(e)
  ) as capability.ObservabilityBuiltInAlertingAndIncidentsState;

  const evaluation = capability.evaluateAlertRules(stateWithRule, "2024-01-01T00:01:00Z");
  assert.strictEqual(evaluation.newAlerts.length, 1);
  assert.strictEqual(evaluation.newAlerts[0].state, "FIRED");
  assert.strictEqual(evaluation.updatedIncidents.length, 1);
  assert.strictEqual(evaluation.updatedIncidents[0].state, "OPEN");
  assert.strictEqual(evaluation.newNotifications.length, 1);
  assert.strictEqual(evaluation.newNotifications[0].status, "SENT");
});

test("observabilitybuiltinalertingandincidentsreadinessmodel", () => {
  const readyState = capability.updateReadiness(capability.initialState);
  assert.strictEqual(readyState.readiness, "UNREADY");

  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 10,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "t1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  const stateAfterSignalReadiness = capability.updateReadiness(stateWithSignal);
  assert.strictEqual(stateAfterSignalReadiness.readiness, "DEGRADED_ALERT_EVALUATION");

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "t1",
  };
  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    (e) => auditEvents.push(e)
  ) as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  const stateAfterRuleReadiness = capability.updateReadiness(stateWithRule);
  assert.strictEqual(stateAfterRuleReadiness.readiness, "READY");

  const errorState = capability.handleProviderFailure(
    stateWithRule,
    "PROVIDER_FAILURE",
    "Provider unavailable"
  );
  assert.strictEqual(errorState.readiness, "DEGRADED_SIGNAL_INGESTION");
});

test("observabilitybuiltinalertingandincidentsstatemodel", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "test-metric",
    value: 10,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "t1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  assert.strictEqual(stateWithSignal.metricSignals.length, 1);
  assert.strictEqual(stateWithSignal.metricSignals[0].name, "test-metric");
  assert.strictEqual(stateWithSignal.metricSignals[0].value, 10);
  assert.strictEqual(stateWithSignal.metricSignals[0].tenantId, "t1");

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "t1",
  };
  const auditEvents: capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] = [];
  const stateWithRule = capability.addAlertRule(
    stateWithSignal,
    rule,
    "req-1",
    "trace-1",
    (e) => auditEvents.push(e)
  ) as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(stateWithRule.alertRules.length, 1);
  assert.strictEqual(stateWithRule.alertRules[0].comparator, "GT");
  assert.strictEqual(stateWithRule.alertRules[0].threshold, 10);
  assert.strictEqual(stateWithRule.alertRules[0].severity, "HIGH");
  assert.strictEqual(stateWithRule.alertRules[0].tenantId, "t1");

  const evaluation = capability.evaluateAlertRules(stateWithRule, "2024-01-01T00:01:00Z");
  assert.strictEqual(evaluation.newAlerts.length, 1);
  assert.strictEqual(evaluation.newAlerts[0].state, "FIRED");
  assert.strictEqual(evaluation.newAlerts[0].ruleId, "rule-1");
  assert.strictEqual(evaluation.newAlerts[0].tenantId, "t1");
  assert.strictEqual(evaluation.updatedIncidents.length, 1);
  assert.strictEqual(evaluation.updatedIncidents[0].state, "OPEN");
  assert.strictEqual(evaluation.updatedIncidents[0].alertId, "rule-1");
  assert.strictEqual(evaluation.updatedIncidents[0].tenantId, "t1");
  assert.strictEqual(evaluation.newNotifications.length, 1);
  assert.strictEqual(evaluation.newNotifications[0].status, "SENT");
  assert.strictEqual(evaluation.newNotifications[0].tenantId, "t1");
});

test("observabilitybuiltinalertingandincidentsvalidation", () => {
  const invalidComparatorRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "INVALID" as capability.ObservabilityBuiltInAlertingAndIncidentsComparator,
    threshold: 10,
    severity: "HIGH",
    tenantId: "t1",
  };
  const comparatorValidation = capability.validateAlertRuleInput(invalidComparatorRule);
  assert.notStrictEqual(comparatorValidation, null);
  assert.strictEqual(comparatorValidation?.kind, "INVALID_RULE_MUTATION");

  const invalidThresholdRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: NaN,
    severity: "HIGH",
    tenantId: "t1",
  };
  const thresholdValidation = capability.validateAlertRuleInput(invalidThresholdRule);
  assert.notStrictEqual(thresholdValidation, null);
  assert.strictEqual(thresholdValidation?.kind, "INVALID_RULE_MUTATION");

  const invalidSeverityRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "test-rule",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "INVALID" as capability.ObservabilityBuiltInAlertingAndIncidentsSeverity,
    tenantId: "t1",
  };
  const severityValidation = capability.validateAlertRuleInput(invalidSeverityRule);
  assert.notStrictEqual(severityValidation, null);
  assert.strictEqual(severityValidation?.kind, "INVALID_RULE_MUTATION");

  const invalidNameRule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "invalid-rule!",
    metricName: "test-metric",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "t1",
  };
  const nameValidation = capability.validateAlertRuleInput(invalidNameRule);
  assert.notStrictEqual(nameValidation, null);
  assert.strictEqual(nameValidation?.kind, "INVALID_RULE_MUTATION");

  const illegalTransition = capability.validateIncidentTransition(
    "RESOLVED" as capability.ObservabilityBuiltInAlertingAndIncidentsIncidentState,
    "OPEN" as capability.ObservabilityBuiltInAlertingAndIncidentsIncidentState
  );
  assert.notStrictEqual(illegalTransition, null);
  assert.strictEqual(illegalTransition?.kind, "ILLEGAL_INCIDENT_TRANSITION");
});