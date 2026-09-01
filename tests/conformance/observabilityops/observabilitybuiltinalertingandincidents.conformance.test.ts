import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/observabilityops/observabilitybuiltinalertingandincidents.ts";

test("observabilitybuiltinalertingandincidentsreadinessmodel", () => {
  const initialReadiness = capability.checkReadiness(capability.initialState);
  assert.strictEqual(initialReadiness, "UNREADY");

  const posture = capability.computeReadinessPosture(capability.initialState);
  assert.strictEqual(posture.state, "UNREADY");
  assert.strictEqual(posture.signalIngestion, false);
  assert.strictEqual(posture.alertEvaluation, false);
  assert.strictEqual(posture.notificationDispatch, false);
  assert.strictEqual(posture.sideEffectsDisabled, true);

  const errorState = capability.handleProviderFailure(
    capability.initialState,
    "PROVIDER_FAILURE",
    "Provider unavailable"
  );
  assert.strictEqual(errorState.readiness, "DEGRADED_SIGNAL_INGESTION");
  assert.strictEqual(errorState.readinessPosture.signalIngestion, false);
  assert.strictEqual(errorState.readinessPosture.alertEvaluation, false);
  assert.strictEqual(errorState.readinessPosture.notificationDispatch, false);
  assert.strictEqual(errorState.readinessPosture.sideEffectsDisabled, true);

  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "cpu.usage",
    value: 50,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "t1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  const signalReadiness = capability.checkReadiness(stateWithSignal);
  assert.strictEqual(signalReadiness, "DEGRADED_ALERT_EVALUATION");

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "high-cpu",
    metricName: "cpu.usage",
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
  const ruleReadiness = capability.checkReadiness(stateWithRule);
  assert.strictEqual(ruleReadiness, "READY");
  assert.strictEqual(stateWithRule.readinessPosture.signalIngestion, true);
  assert.strictEqual(stateWithRule.readinessPosture.alertEvaluation, true);
  assert.strictEqual(stateWithRule.readinessPosture.notificationDispatch, true);
  assert.strictEqual(stateWithRule.readinessPosture.sideEffectsDisabled, false);
});

test("observabilitybuiltinalertingandincidentsstatemodel", () => {
  const signal: capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal = {
    name: "cpu.usage",
    value: 80,
    timestamp: "2024-01-01T00:00:00Z",
    tenantId: "t1",
  };
  const stateWithSignal = capability.addMetricSignal(capability.initialState, signal);
  assert.strictEqual(stateWithSignal.metricSignals.length, 1);
  assert.strictEqual(stateWithSignal.metricSignals[0].name, "cpu.usage");
  assert.strictEqual(stateWithSignal.metricSignals[0].value, 80);
  assert.strictEqual(stateWithSignal.metricSignals[0].tenantId, "t1");
  assert.strictEqual(stateWithSignal.schemaVersion, 1);

  const rule: capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule = {
    id: "rule-1",
    name: "high-cpu",
    metricName: "cpu.usage",
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
  assert.strictEqual(stateWithRule.alertRules.length, 1);
  assert.strictEqual(stateWithRule.alertRules[0].comparator, "GT");
  assert.strictEqual(stateWithRule.alertRules[0].threshold, 75);
  assert.strictEqual(stateWithRule.alertRules[0].severity, "HIGH");
  assert.strictEqual(stateWithRule.alertRules[0].tenantId, "t1");

  const appliedState = capability.applyEvaluation(stateWithRule, "2024-01-01T00:01:00Z");
  assert.strictEqual(appliedState.alerts.length, 1);
  assert.strictEqual(appliedState.alerts[0].state, "FIRED");
  assert.strictEqual(appliedState.alerts[0].ruleId, "rule-1");
  assert.strictEqual(appliedState.alerts[0].tenantId, "t1");
  assert.strictEqual(appliedState.incidents.length, 1);
  assert.strictEqual(appliedState.incidents[0].state, "OPEN");
  assert.strictEqual(appliedState.incidents[0].alertId, "rule-1");
  assert.strictEqual(appliedState.incidents[0].tenantId, "t1");
  assert.strictEqual(appliedState.notifications.length, 1);
  assert.strictEqual(appliedState.notifications[0].status, "SENT");
  assert.strictEqual(appliedState.notifications[0].tenantId, "t1");

  const migratedState = capability.migrateState(
    { ...appliedState, schemaVersion: 0 },
    0,
    1
  ) as capability.ObservabilityBuiltInAlertingAndIncidentsState;
  assert.strictEqual(migratedState.schemaVersion, 1);
  assert.strictEqual(migratedState.emittedSignals.length, 0);
  assert.strictEqual(migratedState.providerErrors.length, 0);
});