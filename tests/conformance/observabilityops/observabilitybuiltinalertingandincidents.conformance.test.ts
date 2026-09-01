import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/observabilitybuiltinalertingandincidents.ts";

type State = capability.ObservabilityBuiltInAlertingAndIncidentsState;
type CapabilityError = capability.ObservabilityBuiltInAlertingAndIncidentsError;
type AlertRule = capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule;
type MetricSignal = capability.ObservabilityBuiltInAlertingAndIncidentsMetricSignal;
type AuditEvent = capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent;

function isError(
  result: State | CapabilityError,
): result is CapabilityError {
  return "kind" in result;
}

test("observabilitybuiltinalertingandincidentsauditmodel", () => {
  const signal: MetricSignal = {
    name: "cpu.usage",
    value: 80,
    timestamp: "2024-01-01T00:00:00.000Z",
    tenantId: "tenant-a",
  };
  const withSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: AlertRule = {
    id: "rule-audit",
    name: "cpu_high",
    metricName: "cpu.usage",
    comparator: "GT",
    threshold: 75,
    severity: "HIGH",
    tenantId: "tenant-a",
  };
  const ruleAudit: AuditEvent[] = [];
  const withRule = capability.addAlertRule(
    withSignal,
    rule,
    "req-audit-rule",
    "trace-audit-rule",
    (event) => ruleAudit.push(event),
  );
  assert.equal(isError(withRule), false);
  assert.strictEqual(ruleAudit.length, 1);
  assert.strictEqual(ruleAudit[0].kind, "ALERT_RULE_CHANGE");
  assert.strictEqual(ruleAudit[0].entityType, "ALERT_RULE");
  assert.strictEqual(ruleAudit[0].entityId, rule.id);
  assert.strictEqual(ruleAudit[0].requestId, "req-audit-rule");
  assert.strictEqual(ruleAudit[0].traceId, "trace-audit-rule");
  assert.deepStrictEqual(ruleAudit[0].details, { action: "ADD", rule });

  const evaluated = capability.applyEvaluation(withRule, "2024-01-01T00:01:00.000Z");
  const incident = evaluated.incidents[0];
  assert.ok(incident !== undefined);

  const transitionAudit: AuditEvent[] = [];
  const transitioned = capability.transitionIncident(
    evaluated,
    incident.id,
    "ACKNOWLEDGED",
    "req-incident-transition",
    "trace-incident-transition",
    (event) => transitionAudit.push(event),
  );
  assert.equal(isError(transitioned), false);
  assert.strictEqual(transitioned.incidents[0].state, "ACKNOWLEDGED");
  assert.strictEqual(transitionAudit.length, 1);
  assert.strictEqual(transitionAudit[0].kind, "INCIDENT_TRANSITION");
  assert.strictEqual(transitionAudit[0].entityType, "INCIDENT");
  assert.strictEqual(transitionAudit[0].entityId, incident.id);
  assert.deepStrictEqual(transitionAudit[0].details, {
    from: "OPEN",
    to: "ACKNOWLEDGED",
  });
  assert.strictEqual(transitionAudit[0].requestId, "req-incident-transition");
  assert.strictEqual(transitionAudit[0].traceId, "trace-incident-transition");

  const dispatchAudit: AuditEvent[] = [];
  const dispatchInput: State = {
    ...capability.initialState,
    incidents: [
      {
        id: "incident-dispatch",
        alertId: "rule-audit",
        state: "OPEN",
        createdAt: "2024-01-01T00:02:00.000Z",
        updatedAt: "2024-01-01T00:02:00.000Z",
        tenantId: "tenant-a",
      },
    ],
  };
  const dispatched = capability.dispatchNotification(
    dispatchInput,
    "incident-dispatch",
    "req-notify-send",
    "trace-notify-send",
    (event) => dispatchAudit.push(event),
  );
  assert.equal(isError(dispatched), false);
  assert.strictEqual(dispatched.notifications.length, 1);
  assert.strictEqual(dispatched.notifications[0].status, "SENT");
  assert.strictEqual(dispatchAudit.length, 1);
  assert.strictEqual(dispatchAudit[0].kind, "NOTIFICATION_DISPATCH");
  assert.deepStrictEqual(dispatchAudit[0].details, { status: "SENT" });

  const suppressAudit: AuditEvent[] = [];
  const suppressInput: State = {
    ...capability.initialState,
    incidents: [
      {
        id: "incident-suppress",
        alertId: "rule-audit",
        state: "OPEN",
        createdAt: "2024-01-01T00:03:00.000Z",
        updatedAt: "2024-01-01T00:03:00.000Z",
        tenantId: "tenant-a",
      },
    ],
  };
  const suppressed = capability.suppressNotification(
    suppressInput,
    "incident-suppress",
    "req-notify-suppress",
    "trace-notify-suppress",
    (event) => suppressAudit.push(event),
  );
  assert.equal(isError(suppressed), false);
  assert.strictEqual(suppressed.notifications.length, 1);
  assert.strictEqual(suppressed.notifications[0].status, "SUPPRESSED");
  assert.strictEqual(suppressAudit.length, 1);
  assert.strictEqual(suppressAudit[0].kind, "NOTIFICATION_DISPATCH");
  assert.deepStrictEqual(suppressAudit[0].details, { status: "SUPPRESSED" });
});

test("observabilitybuiltinalertingandincidentscontracts", () => {
  const metric: MetricSignal = {
    name: "cpu.usage",
    value: 80,
    timestamp: "2024-01-01T00:04:00.000Z",
    tenantId: "tenant-a",
  };
  const withSignal = capability.addMetricSignal(capability.initialState, metric);

  const noDataRule: AlertRule = {
    id: "rule-no-data",
    name: "cpu_missing",
    metricName: "errors.count",
    comparator: "GT",
    threshold: 10,
    severity: "MEDIUM",
    tenantId: "tenant-a",
  };
  const withinRule: AlertRule = {
    id: "rule-within",
    name: "cpu_within",
    metricName: "cpu.usage",
    comparator: "GT",
    threshold: 90,
    severity: "HIGH",
    tenantId: "tenant-a",
  };
  const withNoDataRule = capability.addAlertRule(
    withSignal,
    noDataRule,
    "req-no-data",
    "trace-no-data",
    () => {},
  );
  assert.equal(isError(withNoDataRule), false);

  const withTwoRules = capability.addAlertRule(
    withNoDataRule,
    withinRule,
    "req-within",
    "trace-within",
    () => {},
  );
  assert.equal(isError(withTwoRules), false);

  const evaluation = capability.evaluateAlertRules(withTwoRules, "2024-01-01T00:04:30.000Z");
  const noDataAlert = evaluation.newAlerts.find((alert) => alert.ruleId === "rule-no-data");
  const withinAlert = evaluation.newAlerts.find((alert) => alert.ruleId === "rule-within");
  assert.ok(noDataAlert !== undefined);
  assert.ok(withinAlert !== undefined);
  assert.strictEqual(noDataAlert.state, "NO_DATA");
  assert.strictEqual(withinAlert.state, "WITHIN");

  const firingRule: AlertRule = {
    id: "rule-fired",
    name: "cpu_fired",
    metricName: "cpu.usage",
    comparator: "GTE",
    threshold: 10,
    severity: "CRITICAL",
    tenantId: "tenant-a",
  };
  const withFiringRule = capability.addAlertRule(
    withSignal,
    firingRule,
    "req-fired",
    "trace-fired",
    () => {},
  );
  assert.equal(isError(withFiringRule), false);

  const updatedRule: AlertRule = {
    ...firingRule,
    threshold: 15,
  };
  const updated = capability.updateAlertRule(
    withFiringRule,
    firingRule.id,
    updatedRule,
    "req-update",
    "trace-update",
    () => {},
  );
  assert.equal(isError(updated), false);
  assert.strictEqual(updated.alertRules[0].threshold, 15);

  const evaluated = capability.applyEvaluation(updated, "2024-01-01T00:05:00.000Z");
  assert.strictEqual(evaluated.alerts.length, 1);
  assert.strictEqual(evaluated.alerts[0].state, "FIRED");
  assert.strictEqual(evaluated.incidents.length, 1);
  assert.strictEqual(evaluated.notifications.length, 1);
  assert.strictEqual(evaluated.notifications[0].status, "SENT");

  const transitioned = capability.transitionIncident(
    evaluated,
    evaluated.incidents[0].id,
    "ACKNOWLEDGED",
    "req-ack",
    "trace-ack",
    () => {},
  );
  assert.equal(isError(transitioned), false);
  const resolved = capability.transitionIncident(
    transitioned,
    transitioned.incidents[0].id,
    "RESOLVED",
    "req-resolve",
    "trace-resolve",
    () => {},
  );
  assert.equal(isError(resolved), false);
  assert.strictEqual(resolved.incidents[0].state, "RESOLVED");

  assert.strictEqual(capability.checkReadiness(evaluated), "READY");
});

test("observabilitybuiltinalertingandincidentserrormodel", () => {
  const withProviderFailure1 = capability.handleProviderFailure(
    capability.initialState,
    "PROVIDER_FAILURE",
    "first provider failure",
  );
  const withProviderFailure2 = capability.handleProviderFailure(
    withProviderFailure1,
    "PROVIDER_FAILURE",
    "second provider failure",
  );
  const withProviderFailure3 = capability.handleProviderFailure(
    withProviderFailure2,
    "PROVIDER_FAILURE",
    "third provider failure",
  );

  assert.strictEqual(capability.shouldAlertOnProviderFailures(withProviderFailure3), true);
  assert.strictEqual(capability.shouldAlertOnProviderFailures(withProviderFailure3, 2), true);
  assert.strictEqual(withProviderFailure3.readiness, "DEGRADED_SIGNAL_INGESTION");

  const afterAttempt = capability.applyEvaluation(withProviderFailure3, "2024-01-01T00:06:00.000Z");
  assert.strictEqual(afterAttempt, withProviderFailure3);

  let auditCalls = 0;
  const invalidRule: AlertRule = {
    id: "bad-rule",
    name: "invalid_rule",
    metricName: "cpu.usage",
    comparator: "INVALID" as unknown as AlertRule["comparator"],
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-a",
  };
  const badRuleResult = capability.addAlertRule(
    capability.initialState,
    invalidRule,
    "req-bad-rule",
    "trace-bad-rule",
    () => {
      auditCalls += 1;
    },
  );
  assert.equal(isError(badRuleResult), true);
  if (isError(badRuleResult)) {
    assert.strictEqual(badRuleResult.kind, "INVALID_RULE_MUTATION");
  }
  assert.strictEqual(auditCalls, 0);

  const closedState: State = {
    ...capability.initialState,
    incidents: [
      {
        id: "incident-closed",
        alertId: "rule-a",
        state: "RESOLVED",
        createdAt: "2024-01-01T00:06:30.000Z",
        updatedAt: "2024-01-01T00:06:30.000Z",
        tenantId: "tenant-a",
      },
    ],
  };
  const badTransition = capability.transitionIncident(
    closedState,
    "incident-closed",
    "OPEN",
    "req-bad-transition",
    "trace-bad-transition",
    () => {},
  );
  assert.equal(isError(badTransition), true);
  if (isError(badTransition)) {
    assert.strictEqual(badTransition.kind, "ILLEGAL_INCIDENT_TRANSITION");
  }

  assert.strictEqual(capability.isAllowedTransition("OPEN", "OPEN"), false);
});

test("observabilitybuiltinalertingandincidentslifecycle", () => {
  const signal: MetricSignal = {
    name: "http.request.duration",
    value: 150,
    timestamp: "2024-01-01T00:07:00.000Z",
    tenantId: "tenant-a",
  };
  const withSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: AlertRule = {
    id: "rule-lifecycle",
    name: "http_latency",
    metricName: "http.request.duration",
    comparator: "GT",
    threshold: 100,
    severity: "MEDIUM",
    tenantId: "tenant-a",
  };
  const withRule = capability.addAlertRule(
    withSignal,
    rule,
    "req-lifecycle",
    "trace-lifecycle",
    () => {},
  );
  assert.equal(isError(withRule), false);

  const applied = capability.applyEvaluation(withRule, "2024-01-01T00:07:30.000Z");
  assert.strictEqual(applied.alerts[0].state, "FIRED");
  assert.strictEqual(applied.incidents[0].state, "OPEN");
  assert.strictEqual(applied.notifications[0].status, "SENT");
  assert.strictEqual(applied.alerts[0].tenantId, "tenant-a");
  assert.strictEqual(applied.incidents[0].tenantId, "tenant-a");
  assert.strictEqual(applied.notifications[0].tenantId, "tenant-a");
  const emittedSignals = new Set(
    applied.emittedSignals.map((entry) => entry.signal),
  );
  assert.strictEqual(emittedSignals.has("observability.signal.ingested"), true);
  assert.strictEqual(emittedSignals.has("observability.alert.fired"), true);
  assert.strictEqual(emittedSignals.has("observability.incident.opened"), true);
  assert.strictEqual(emittedSignals.has("observability.notification.dispatched"), true);
  assert.strictEqual(emittedSignals.has("observability.readiness.ready"), true);
});

test("observabilitybuiltinalertingandincidentspermissions", () => {
  const signalTenantA: MetricSignal = {
    name: "errors.count",
    value: 90,
    timestamp: "2024-01-01T00:08:00.000Z",
    tenantId: "tenant-a",
  };
  const signalTenantB: MetricSignal = {
    name: "errors.count",
    value: 20,
    timestamp: "2024-01-01T00:08:00.000Z",
    tenantId: "tenant-b",
  };

  const withSignals = capability.addMetricSignal(
    capability.addMetricSignal(capability.initialState, signalTenantA),
    signalTenantB,
  );

  const tenantARule: AlertRule = {
    id: "rule-tenant-a",
    name: "errors_tenant_a",
    metricName: "errors.count",
    comparator: "GT",
    threshold: 75,
    severity: "HIGH",
    tenantId: "tenant-a",
  };
  const tenantBRule: AlertRule = {
    id: "rule-tenant-b",
    name: "errors_tenant_b",
    metricName: "errors.count",
    comparator: "GT",
    threshold: 75,
    severity: "LOW",
    tenantId: "tenant-b",
  };

  const withTenantARule = capability.addAlertRule(
    withSignals,
    tenantARule,
    "req-tenant-a",
    "trace-tenant-a",
    () => {},
  );
  assert.equal(isError(withTenantARule), false);

  const withTenantRules = capability.addAlertRule(
    withTenantARule,
    tenantBRule,
    "req-tenant-b",
    "trace-tenant-b",
    () => {},
  );
  assert.equal(isError(withTenantRules), false);

  const evalResult = capability.evaluateAlertRules(withTenantRules, "2024-01-01T00:08:30.000Z");
  const alertA = evalResult.newAlerts.find((alert) => alert.ruleId === "rule-tenant-a");
  const alertB = evalResult.newAlerts.find((alert) => alert.ruleId === "rule-tenant-b");
  assert.ok(alertA !== undefined);
  assert.ok(alertB !== undefined);
  assert.strictEqual(alertA.state, "FIRED");
  assert.strictEqual(alertB.state, "WITHIN");

  const applied = capability.applyEvaluation(withTenantRules, "2024-01-01T00:09:00.000Z");
  assert.strictEqual(applied.incidents.length, 1);
  assert.strictEqual(applied.incidents[0].tenantId, "tenant-a");
  assert.ok(!applied.incidents.some((incident) => incident.tenantId === "tenant-b"));
});

test("observabilitybuiltinalertingandincidentsproof", () => {
  const signal: MetricSignal = {
    name: "queue.depth",
    value: 42,
    timestamp: "2024-01-01T00:10:00.000Z",
    tenantId: "tenant-a",
  };
  const withSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: AlertRule = {
    id: "rule-proof",
    name: "queue_depth",
    metricName: "queue.depth",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
    tenantId: "tenant-a",
  };
  const withRule = capability.addAlertRule(
    withSignal,
    rule,
    "req-proof",
    "trace-proof",
    () => {},
  );
  assert.equal(isError(withRule), false);

  const applied = capability.applyEvaluation(withRule, "2024-01-01T00:10:30.000Z");
  const incident = applied.incidents[0];
  assert.ok(incident !== undefined);

  const transitionEvents: AuditEvent[] = [];
  const acknowledged = capability.transitionIncident(
    applied,
    incident.id,
    "ACKNOWLEDGED",
    "req-proof-ack",
    "trace-proof-ack",
    (event) => transitionEvents.push(event),
  );
  assert.equal(isError(acknowledged), false);

  const resolved = capability.transitionIncident(
    acknowledged,
    incident.id,
    "RESOLVED",
    "req-proof-resolve",
    "trace-proof-resolve",
    (event) => transitionEvents.push(event),
  );
  assert.equal(isError(resolved), false);

  const emittedSignals = new Set(resolved.emittedSignals.map((entry) => entry.signal));
  assert.strictEqual(emittedSignals.has("observability.signal.ingested"), true);
  assert.strictEqual(emittedSignals.has("observability.alert.fired"), true);
  assert.strictEqual(emittedSignals.has("observability.incident.opened"), true);
  assert.strictEqual(emittedSignals.has("observability.notification.dispatched"), true);
  assert.strictEqual(emittedSignals.has("observability.incident.acknowledged"), true);
  assert.strictEqual(emittedSignals.has("observability.incident.resolved"), true);
  assert.strictEqual(emittedSignals.has("observability.readiness.ready"), true);
  assert.strictEqual(transitionEvents.length, 2);
});

test("observabilitybuiltinalertingandincidentsreadinessmodel", () => {
  const signal: MetricSignal = {
    name: "http.request.count",
    value: 12,
    timestamp: "2024-01-01T00:11:00.000Z",
    tenantId: "tenant-a",
  };
  const initialPosture = capability.computeReadinessPosture(capability.initialState);
  assert.strictEqual(initialPosture.state, "DEGRADED_ALERT_EVALUATION");
  assert.strictEqual(capability.checkReadiness(capability.initialState), "DEGRADED_ALERT_EVALUATION");
  assert.strictEqual(initialPosture.signalIngestion, true);
  assert.strictEqual(initialPosture.alertEvaluation, false);
  assert.strictEqual(initialPosture.notificationDispatch, false);
  assert.strictEqual(initialPosture.sideEffectsDisabled, false);

  const withMetric = capability.addMetricSignal(capability.initialState, signal);
  assert.strictEqual(capability.checkReadiness(withMetric), "DEGRADED_ALERT_EVALUATION");

  const rule: AlertRule = {
    id: "rule-readiness",
    name: "http_count",
    metricName: "http.request.count",
    comparator: "GT",
    threshold: 1,
    severity: "LOW",
    tenantId: "tenant-a",
  };
  const withRule = capability.addAlertRule(
    withMetric,
    rule,
    "req-readiness-rule",
    "trace-readiness-rule",
    () => {},
  );
  assert.equal(isError(withRule), false);

  const afterReadiness = capability.checkReadiness(withRule);
  assert.strictEqual(afterReadiness, "READY");
  const postureReady = capability.computeReadinessPosture(withRule);
  assert.strictEqual(postureReady.state, "READY");
  assert.strictEqual(postureReady.signalIngestion, true);
  assert.strictEqual(postureReady.alertEvaluation, true);
  assert.strictEqual(postureReady.notificationDispatch, true);
  assert.strictEqual(postureReady.sideEffectsDisabled, false);

  const degraded = capability.handleProviderFailure(withRule, "PROVIDER_FAILURE", "readiness provider failure");
  assert.strictEqual(degraded.readiness, "DEGRADED_SIGNAL_INGESTION");
  assert.strictEqual(degraded.readinessPosture.signalIngestion, false);
  assert.strictEqual(degraded.readinessPosture.alertEvaluation, false);
  assert.strictEqual(degraded.readinessPosture.notificationDispatch, false);
  assert.strictEqual(degraded.readinessPosture.sideEffectsDisabled, true);
  assert.ok(
    degraded.emittedSignals.some((entry) => entry.signal === "observability.readiness.degraded"),
  );
  assert.ok(
    degraded.emittedSignals.some((entry) => entry.signal === "observability.error.provider_failure"),
  );

  const blocked = capability.applyEvaluation(degraded, "2024-01-01T00:11:30.000Z");
  assert.strictEqual(blocked, degraded);
});

test("observabilitybuiltinalertingandincidentsstatemodel", () => {
  const signal: MetricSignal = {
    name: "memory.usage",
    value: 93,
    timestamp: "2024-01-01T00:12:00.000Z",
    tenantId: "tenant-a",
  };
  const withSignal = capability.addMetricSignal(capability.initialState, signal);

  const rule: AlertRule = {
    id: "rule-state",
    name: "high-memory",
    metricName: "memory.usage",
    comparator: "GTE",
    threshold: 90,
    severity: "HIGH",
    tenantId: "tenant-a",
  };
  const withRule = capability.addAlertRule(
    withSignal,
    rule,
    "req-state",
    "trace-state",
    () => {},
  );
  assert.equal(isError(withRule), false);

  const applied = capability.applyEvaluation(withRule, "2024-01-01T00:12:30.000Z");
  assert.strictEqual(applied.metricSignals.length, 1);
  assert.strictEqual(applied.alertRules.length, 1);
  assert.strictEqual(applied.alertRules[0].comparator, "GTE");
  assert.strictEqual(applied.alerts.length, 1);
  assert.strictEqual(applied.alerts[0].state, "FIRED");
  assert.strictEqual(applied.incidents.length, 1);
  assert.strictEqual(applied.incidents[0].state, "OPEN");
  assert.strictEqual(applied.notifications[0].status, "SENT");
  assert.strictEqual(applied.schemaVersion, capability.ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion);

  const legacyState: State = {
    ...applied,
    schemaVersion: 0,
  };
  const migrated = capability.migrateState(
    legacyState,
    legacyState.schemaVersion,
    capability.ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
  );
  assert.equal(isError(migrated), false);
  if (!isError(migrated)) {
    assert.strictEqual(migrated.schemaVersion, 1);
    assert.strictEqual(migrated.metricSignals.length, applied.metricSignals.length);
    assert.strictEqual(migrated.alertRules.length, applied.alertRules.length);
    assert.strictEqual(migrated.alerts.length, applied.alerts.length);
    assert.strictEqual(migrated.incidents.length, applied.incidents.length);
    assert.strictEqual(migrated.notifications.length, applied.notifications.length);
  }

  const blocked = capability.migrateState(applied, 2, 1);
  assert.equal(isError(blocked), true);
  if (isError(blocked)) {
    assert.strictEqual(blocked.kind, "CONFIGURATION_DRIFT");
  }

  const alreadyCurrent = capability.applyMigrationIfNeeded(applied);
  assert.equal(isError(alreadyCurrent), false);
  if (!isError(alreadyCurrent)) {
    assert.strictEqual(alreadyCurrent, applied);
  }
});

test("observabilitybuiltinalertingandincidentsvalidation", () => {
  const validRule: AlertRule = {
    id: "rule-valid",
    name: "good_rule",
    metricName: "cpu.usage",
    comparator: "GT",
    threshold: 55,
    severity: "MEDIUM",
    tenantId: "tenant-a",
  };

  assert.strictEqual(capability.validateAlertRuleInput(validRule), null);

  const badComparatorRule = {
    ...validRule,
    comparator: "BAD" as unknown as AlertRule["comparator"],
  };
  const badComparator = capability.validateAlertRuleInput(badComparatorRule as AlertRule);
  assert.ok(badComparator !== null);
  assert.strictEqual(badComparator.kind, "INVALID_RULE_MUTATION");

  const badThresholdRule = {
    ...validRule,
    id: "rule-invalid-threshold",
    threshold: Number.NaN,
  };
  const badThreshold = capability.validateAlertRuleInput(badThresholdRule as AlertRule);
  assert.ok(badThreshold !== null);
  assert.strictEqual(badThreshold.kind, "INVALID_RULE_MUTATION");

  const badSeverityRule = {
    ...validRule,
    id: "rule-invalid-severity",
    severity: "EXTREME" as unknown as AlertRule["severity"],
  };
  const badSeverity = capability.validateAlertRuleInput(badSeverityRule as AlertRule);
  assert.ok(badSeverity !== null);
  assert.strictEqual(badSeverity.kind, "INVALID_RULE_MUTATION");

  const badNameRule = {
    ...validRule,
    id: "rule-invalid-name",
    name: "bad rule",
  };
  const badName = capability.validateAlertRuleInput(badNameRule as AlertRule);
  assert.ok(badName !== null);
  assert.strictEqual(badName.kind, "INVALID_RULE_MUTATION");

  const badMetricRule = {
    ...validRule,
    id: "rule-invalid-metric",
    metricName: "custom.metric",
  };
  const badMetric = capability.validateAlertRuleInput(badMetricRule as AlertRule);
  assert.ok(badMetric !== null);
  assert.strictEqual(badMetric.kind, "INVALID_RULE_MUTATION");

  let auditCalls = 0;
  const rejectResult = capability.addAlertRule(
    capability.initialState,
    badMetricRule as AlertRule,
    "req-invalid-mutate",
    "trace-invalid-mutate",
    () => {
      auditCalls += 1;
    },
  );
  assert.equal(isError(rejectResult), true);
  if (isError(rejectResult)) {
    assert.strictEqual(rejectResult.kind, "INVALID_RULE_MUTATION");
  }
  assert.strictEqual(auditCalls, 0);

  const illegalTransition = capability.validateIncidentTransition("OPEN", "OPEN");
  assert.ok(illegalTransition !== null);
  assert.strictEqual(illegalTransition.kind, "ILLEGAL_INCIDENT_TRANSITION");
  assert.strictEqual(capability.validateIncidentTransition("OPEN", "ACKNOWLEDGED"), null);
});