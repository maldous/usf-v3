import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/observabilityops/observabilitybuiltinalertingandincidents.ts";

type State = capability.ObservabilityBuiltInAlertingAndIncidentsState;
type CapabilityError = capability.ObservabilityBuiltInAlertingAndIncidentsError;
type AlertRule = capability.ObservabilityBuiltInAlertingAndIncidentsAlertRule;
type Incident = capability.ObservabilityBuiltInAlertingAndIncidentsIncident;
type IncidentState = capability.ObservabilityBuiltInAlertingAndIncidentsIncidentState;
type Notification = capability.ObservabilityBuiltInAlertingAndIncidentsNotification;
type AuditEvent = capability.ObservabilityBuiltInAlertingAndIncidentsAuditEvent;
type Comparator = capability.ObservabilityBuiltInAlertingAndIncidentsComparator;
type Severity = capability.ObservabilityBuiltInAlertingAndIncidentsSeverity;
type AuditFn = (event: AuditEvent) => CapabilityError | null;
type Token = {
  readonly authLevel: string;
  readonly permissions: readonly string[];
  readonly tenantId: string;
};

const defaultTenant = "tenant-a";

function adminToken(tenantId: string = defaultTenant): Token {
  return { authLevel: "admin", permissions: ["admin"], tenantId };
}
function readerToken(tenantId: string = defaultTenant): Token {
  return { authLevel: "viewer", permissions: ["observability.read"], tenantId };
}
function makeAuditSink(): { events: AuditEvent[]; sink: AuditFn } {
  const events: AuditEvent[] = [];
  return {
    events,
    sink: (event) => {
      events.push(event);
      return null;
    },
  };
}
function assertOk(
  result:
    | { readonly ok: true; readonly state: State }
    | { readonly ok: false; readonly error: CapabilityError },
): asserts result is { readonly ok: true; readonly state: State } {
  if (!result.ok) {
    assert.fail(`Expected OK result but got error: ${result.error.kind}`);
  }
}
function assertErr(
  result:
    | { readonly ok: true; readonly state: State }
    | { readonly ok: false; readonly error: CapabilityError },
  kind: CapabilityError["kind"],
): CapabilityError {
  if (result.ok) {
    assert.fail("expected error, got ok");
  }
  assert.strictEqual(result.error.kind, kind);
  return result.error;
}
function validRule(overrides: Partial<AlertRule> = {}): AlertRule {
  const base: AlertRule = {
    id: "rule-default",
    name: "default_rule",
    metricName: "cpu.usage",
    comparator: "GT",
    threshold: 50,
    severity: "HIGH",
    tenantId: defaultTenant,
  };
  return { ...base, ...overrides };
}
function openIncident(
  id: string,
  alertId: string,
  tenantId: string = defaultTenant,
): Incident {
  return {
    id,
    alertId,
    state: "OPEN",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tenantId,
  };
}

test("observabilitybuiltinalertingandincidentsauditmodel", () => {
  const ruleAudit = makeAuditSink();
  const rule: AlertRule = validRule({ id: "rule-audit", name: "audit_rule" });
  const ruleResult = capability.addAlertRule(
    capability.initialState,
    rule,
    "req-audit-rule",
    "trace-audit-rule",
    adminToken(),
    ruleAudit.sink,
  );
  assertOk(ruleResult);
  assert.strictEqual(ruleResult.state.auditTrail.length, 1);

  const incidentAudit = makeAuditSink();
  const incidentState: State = {
    ...ruleResult.state,
    incidents: [openIncident("incident-audit", rule.id)],
  };
  const ackResult = capability.transitionIncident(
    incidentState,
    "incident-audit",
    "ACKNOWLEDGED",
    "req-audit-ack",
    "trace-audit-ack",
    adminToken(),
    incidentAudit.sink,
  );
  assertOk(ackResult);
  assert.strictEqual(ackResult.state.auditTrail.length, 1);

  const dispatchAudit = makeAuditSink();
  const dispatchState: State = {
    ...capability.initialState,
    alertRules: [rule],
    incidents: [openIncident("incident-send", rule.id)],
  };
  const sentResult = capability.dispatchNotification(
    dispatchState,
    "incident-send",
    "req-audit-send",
    "trace-audit-send",
    adminToken(),
    dispatchAudit.sink,
  );
  assertOk(sentResult);
  assert.strictEqual(sentResult.state.auditTrail.length, 1);

  const suppressAudit = makeAuditSink();
  const suppressState: State = {
    ...capability.initialState,
    alertRules: [rule],
    incidents: [openIncident("incident-suppress", rule.id)],
  };
  const suppressedResult = capability.suppressNotification(
    suppressState,
    "incident-suppress",
    "req-audit-suppress",
    "trace-audit-suppress",
    adminToken(),
    suppressAudit.sink,
  );
  assertOk(suppressedResult);
  assert.strictEqual(suppressedResult.state.auditTrail.length, 1);

  const sentNotification = sentResult.notification;
  assert.strictEqual(sentNotification.status, "SENT");
  const suppressedNotification = suppressedResult.notification;
  assert.strictEqual(suppressedNotification.status, "SUPPRESSED");

  const ruleAuditEvent = ruleAudit.events[0];
  assert.ok(ruleAuditEvent !== undefined);
  assert.strictEqual(ruleAuditEvent.kind, "ALERT_RULE_CHANGE");
  assert.strictEqual(ruleAuditEvent.entityType, "ALERT_RULE");
  assert.strictEqual(ruleAuditEvent.requestId, "req-audit-rule");
  assert.strictEqual(ruleAuditEvent.traceId, "trace-audit-rule");

  const ackAuditEvent = incidentAudit.events[0];
  assert.ok(ackAuditEvent !== undefined);
  assert.strictEqual(ackAuditEvent.kind, "INCIDENT_TRANSITION");
  assert.strictEqual(ackAuditEvent.entityType, "INCIDENT");
  assert.strictEqual(ackAuditEvent.requestId, "req-audit-ack");
  assert.strictEqual(ackAuditEvent.traceId, "trace-audit-ack");

  const sentAuditEvent = dispatchAudit.events[0];
  assert.ok(sentAuditEvent !== undefined);
  assert.strictEqual(sentAuditEvent.kind, "NOTIFICATION_DISPATCH");
  assert.strictEqual(sentAuditEvent.entityType, "NOTIFICATION");
  const sentDetails = sentAuditEvent.details as { status: string };
  assert.strictEqual(sentDetails.status, "SENT");

  const suppressedAuditEvent = suppressAudit.events[0];
  assert.ok(suppressedAuditEvent !== undefined);
  assert.strictEqual(suppressedAuditEvent.kind, "NOTIFICATION_DISPATCH");
  assert.strictEqual(suppressedAuditEvent.entityType, "NOTIFICATION");
  const suppressedDetails = suppressedAuditEvent.details as { status: string };
  assert.strictEqual(suppressedDetails.status, "SUPPRESSED");

  const finalState = suppressedResult.state;
  const lineage = capability.proofLineage(finalState);
  assert.strictEqual(lineage.ok, true);
  if (lineage.ok) {
    assert.strictEqual(lineage.audits.length, finalState.auditTrail.length);
    const kinds = lineage.audits.map((e) => e.kind);
    assert.ok(kinds.includes("ALERT_RULE_CHANGE"));
    assert.ok(kinds.includes("INCIDENT_TRANSITION"));
    assert.ok(kinds.includes("NOTIFICATION_DISPATCH"));
  }

  const readerAuditRead = capability.readAuditTrail(
    finalState,
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readerAuditRead.ok, true);
  if (readerAuditRead.ok) {
    assert.strictEqual(
      readerAuditRead.trail.length,
      finalState.auditTrail.length,
    );
  }

  const unauthorizedAuditRead = capability.readAuditTrail(
    finalState,
    defaultTenant,
    { authLevel: "viewer", permissions: [], tenantId: defaultTenant },
  );
  assert.strictEqual(unauthorizedAuditRead.ok, false);
  if (!unauthorizedAuditRead.ok) {
    assert.strictEqual(unauthorizedAuditRead.error.kind, "PERMISSION_DENIED");
  }
});

test("observabilitybuiltinalertingandincidentscontracts", () => {
  const metricResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "cpu.usage",
      value: 100,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    adminToken(),
  );
  assertOk(metricResult);
  const stateAfterSignal = metricResult.state;

  const noDataRule = validRule({
    id: "rule-no-data",
    name: "no_data_rule",
    metricName: "errors.count",
    comparator: "GT",
    threshold: 10,
    severity: "MEDIUM",
  });
  const withinRule = validRule({
    id: "rule-within",
    name: "within_rule",
    metricName: "cpu.usage",
    comparator: "GT",
    threshold: 150,
    severity: "LOW",
  });
  const firedRule = validRule({
    id: "rule-fired",
    name: "fired_rule",
    metricName: "cpu.usage",
    comparator: "GTE",
    threshold: 50,
    severity: "CRITICAL",
  });

  const noDataStateResult = capability.addAlertRule(
    stateAfterSignal,
    noDataRule,
    "req-1",
    "trace-1",
    adminToken(),
    () => null,
  );
  assertOk(noDataStateResult);
  const withinStateResult = capability.addAlertRule(
    noDataStateResult.state,
    withinRule,
    "req-2",
    "trace-2",
    adminToken(),
    () => null,
  );
  assertOk(withinStateResult);
  const firedStateResult = capability.addAlertRule(
    withinStateResult.state,
    firedRule,
    "req-3",
    "trace-3",
    adminToken(),
    () => null,
  );
  assertOk(firedStateResult);

  const evaluation = capability.evaluateAlertRules(
    firedStateResult.state,
    "2024-01-01T00:01:00.000Z",
  );

  const noDataAlert = evaluation.newAlerts.find(
    (a) => a.ruleId === noDataRule.id,
  );
  const withinAlert = evaluation.newAlerts.find(
    (a) => a.ruleId === withinRule.id,
  );
  const firedAlert = evaluation.newAlerts.find(
    (a) => a.ruleId === firedRule.id,
  );

  assert.ok(noDataAlert !== undefined, "Expected NO_DATA alert entry");
  assert.strictEqual(noDataAlert.state, "NO_DATA");
  assert.ok(withinAlert !== undefined, "Expected WITHIN alert entry");
  assert.strictEqual(withinAlert.state, "WITHIN");
  assert.ok(firedAlert !== undefined, "Expected FIRED alert entry");
  assert.strictEqual(firedAlert.state, "FIRED");
  assert.strictEqual(evaluation.updatedIncidents.length, 1);
  assert.strictEqual(evaluation.newNotifications.length, 1);

  const appliedResult = capability.applyEvaluation(
    firedStateResult.state,
    "2024-01-01T00:02:00.000Z",
  );
  assertOk(appliedResult);
  const incident = appliedResult.state.incidents.find(
    (i) => i.alertId === firedRule.id,
  );
  assert.ok(incident !== undefined, "Expected incident to exist");
  const incidentId = incident.id;

  const readSignalsResult = capability.readSignal(
    appliedResult.state,
    "cpu.usage",
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readSignalsResult.ok, true);
  if (readSignalsResult.ok) {
    assert.strictEqual(readSignalsResult.signals.length, 1);
  }

  const readRulesResult = capability.readAlertRules(
    appliedResult.state,
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readRulesResult.ok, true);
  if (readRulesResult.ok) {
    assert.strictEqual(readRulesResult.rules.length, 3);
  }

  const readIncidentsResult = capability.readIncidents(
    appliedResult.state,
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readIncidentsResult.ok, true);
  if (readIncidentsResult.ok) {
    assert.strictEqual(readIncidentsResult.incidents.length, 1);
  }

  const readinessResult = capability.checkReadiness(appliedResult.state);
  assert.strictEqual(readinessResult.ok, true);
  if (readinessResult.ok) {
    assert.strictEqual(readinessResult.readiness, "READY");
  }
  const postureResult = capability.readReadinessPosture(appliedResult.state);
  assert.strictEqual(postureResult.ok, true);
  if (postureResult.ok) {
    assert.strictEqual(postureResult.posture.state, "READY");
    assert.strictEqual(postureResult.posture.sideEffectsDisabled, false);
  }
});

test("observabilitybuiltinalertingandincidentserrormodel", () => {
  const f1 = capability.handleProviderFailure(
    capability.initialState,
    "PROVIDER_FAILURE",
    "first failure",
  );
  const f2 = capability.handleProviderFailure(
    f1,
    "PROVIDER_FAILURE",
    "second failure",
  );
  const f3 = capability.handleProviderFailure(
    f2,
    "PROVIDER_FAILURE",
    "third failure",
  );

  assert.strictEqual(capability.shouldAlertOnProviderFailures(f3), true);
  assert.strictEqual(capability.shouldAlertOnProviderFailures(f3, 2), true);
  assert.strictEqual(capability.shouldAlertOnProviderFailures(f3, 5), false);

  assert.strictEqual(f3.readiness, "UNREADY");
  assert.strictEqual(f3.lastError?.kind, "PROVIDER_FAILURE");
  assert.strictEqual(f3.providerErrors.length, 3);

  const blockedEval = capability.applyEvaluation(f3, "2024-01-01T00:02:00.000Z");
  assertErr(blockedEval, "PROVIDER_FAILURE");

  const auditSink = makeAuditSink();
  const badRule: AlertRule = {
    ...validRule(),
    id: "rule-invalid",
    comparator: "NOPE" as Comparator,
  };
  const badRuleResult = capability.addAlertRule(
    capability.initialState,
    badRule,
    "req-bad-rule",
    "trace-bad-rule",
    adminToken(),
    auditSink.sink,
  );
  assertErr(badRuleResult, "INVALID_RULE_MUTATION");
  assert.strictEqual(auditSink.events.length, 0);

  const closedIncidentState: State = {
    ...capability.initialState,
    alertRules: [validRule({ id: "rule-x", name: "rule_x" })],
    incidents: [
      {
        id: "incident-closed",
        alertId: "rule-x",
        state: "RESOLVED",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        tenantId: defaultTenant,
      },
    ],
  };
  const badTransition = capability.transitionIncident(
    closedIncidentState,
    "incident-closed",
    "OPEN" as IncidentState,
    "req-illegal",
    "trace-illegal",
    adminToken(),
    () => null,
  );
  assertErr(badTransition, "ILLEGAL_INCIDENT_TRANSITION");

  const missingIncident = capability.transitionIncident(
    capability.initialState,
    "missing-incident",
    "ACKNOWLEDGED",
    "req-missing",
    "trace-missing",
    adminToken(),
    () => null,
  );
  assertErr(missingIncident, "ILLEGAL_INCIDENT_TRANSITION");
});

test("observabilitybuiltinalertingandincidentslifecycle", () => {
  const signalResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "http.request.duration",
      value: 200,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    adminToken(),
  );
  assertOk(signalResult);

  const rule = validRule({
    id: "rule-lifecycle",
    name: "lifecycle_rule",
    metricName: "http.request.duration",
    comparator: "GT",
    threshold: 150,
    severity: "MEDIUM",
  });

  const ruleResult = capability.addAlertRule(
    signalResult.state,
    rule,
    "req-life",
    "trace-life",
    adminToken(),
    () => null,
  );
  assertOk(ruleResult);

  const evalResult = capability.applyEvaluation(
    ruleResult.state,
    "2024-01-01T00:00:30.000Z",
  );
  assertOk(evalResult);
  const fired = evalResult.state.alerts.find((a) => a.ruleId === rule.id);
  assert.ok(fired !== undefined);
  assert.strictEqual(fired.state, "FIRED");
  assert.strictEqual(evalResult.state.incidents.length, 1);
  assert.strictEqual(evalResult.state.notifications.length, 1);
  const firstNotification = evalResult.state.notifications[0];
  assert.ok(firstNotification !== undefined);
  assert.strictEqual(firstNotification.status, "SENT");

  const incident = evalResult.state.incidents[0];
  assert.ok(incident !== undefined);

  const ackResult = capability.transitionIncident(
    evalResult.state,
    incident.id,
    "ACKNOWLEDGED",
    "req-life-ack",
    "trace-life-ack",
    adminToken(),
    () => null,
  );
  assertOk(ackResult);

  const resolvedResult = capability.transitionIncident(
    ackResult.state,
    incident.id,
    "RESOLVED",
    "req-life-resolve",
    "trace-life-resolve",
    adminToken(),
    () => null,
  );
  assertOk(resolvedResult);

  const emitted = new Set(
    resolvedResult.state.emittedSignals.map((entry) => entry.signal),
  );
  assert.strictEqual(emitted.has("observability.signal.ingested"), true);
  assert.strictEqual(emitted.has("observability.alert.fired"), true);
  assert.strictEqual(emitted.has("observability.incident.opened"), true);
  assert.strictEqual(emitted.has("observability.incident.acknowledged"), true);
  assert.strictEqual(emitted.has("observability.incident.resolved"), true);
  assert.strictEqual(emitted.has("observability.notification.dispatched"), true);
  assert.strictEqual(emitted.has("observability.readiness.ready"), true);

  assert.strictEqual(capability.freshProofPending(), true);

  const migrated = capability.applyMigrationIfNeeded(resolvedResult.state);
  assert.strictEqual(migrated.ok, true);
  if (migrated.ok) {
    assert.strictEqual(
      migrated.state.schemaVersion,
      capability.ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
    );
    assert.strictEqual(
      migrated.state.readinessPosture.state,
      resolvedResult.state.readinessPosture.state,
    );
    assert.strictEqual(
      migrated.state.readinessPosture.sideEffectsDisabled,
      resolvedResult.state.readinessPosture.sideEffectsDisabled,
    );
  }

  const backwards = capability.migrateState(
    migrated.ok ? migrated.state : resolvedResult.state,
    capability.ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
    1,
  );
  assertErr(backwards, "CONFIGURATION_DRIFT");
});

test("observabilitybuiltinalertingandincidentspermissions", () => {
  const viewerToken: Token = {
    authLevel: "viewer",
    permissions: ["viewer"],
    tenantId: defaultTenant,
  };
  const wrongTenantToken: Token = {
    authLevel: "admin",
    permissions: ["admin"],
    tenantId: "tenant-b",
  };

  const viewerMetricResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "errors.count",
      value: 5,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    viewerToken,
  );
  assertErr(viewerMetricResult, "PERMISSION_DENIED");

  const nullMetricResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "errors.count",
      value: 5,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    null as unknown as Token,
  );
  assertErr(nullMetricResult, "PERMISSION_DENIED");

  const wrongTenantRuleResult = capability.addAlertRule(
    capability.initialState,
    validRule({ id: "rule-wrong", metricName: "errors.count" }),
    "req-perm",
    "trace-perm",
    wrongTenantToken,
    () => null,
  );
  assertErr(wrongTenantRuleResult, "PERMISSION_DENIED");

  const seededResult = capability.addAlertRule(
    capability.initialState,
    validRule({
      id: "rule-owner",
      name: "owner_rule",
      metricName: "errors.count",
      threshold: 1,
      severity: "LOW",
    }),
    "req-owner",
    "trace-owner",
    adminToken(),
    () => null,
  );
  assertOk(seededResult);

  const withMetricResult = capability.addMetricSignal(
    seededResult.state,
    {
      name: "errors.count",
      value: 2,
      timestamp: "2024-01-01T00:00:30.000Z",
      tenantId: defaultTenant,
    },
    adminToken(),
  );
  assertOk(withMetricResult);

  const withIncidentResult = capability.applyEvaluation(
    withMetricResult.state,
    "2024-01-01T00:01:00.000Z",
  );
  assertOk(withIncidentResult);
  const incident = withIncidentResult.state.incidents[0];
  assert.ok(incident !== undefined);
  const incidentId = incident.id;

  const viewerTransitionResult = capability.transitionIncident(
    withIncidentResult.state,
    incidentId,
    "ACKNOWLEDGED",
    "req-viewer-ack",
    "trace-viewer-ack",
    viewerToken,
    () => null,
  );
  assertErr(viewerTransitionResult, "PERMISSION_DENIED");

  const tenantMismatchDispatchResult = capability.dispatchNotification(
    withIncidentResult.state,
    incidentId,
    "req-tenant-dispatch",
    "trace-tenant-dispatch",
    wrongTenantToken,
    () => null,
  );
  assertErr(tenantMismatchDispatchResult, "PERMISSION_DENIED");

  const readerSignalsResult = capability.readSignal(
    withIncidentResult.state,
    "errors.count",
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readerSignalsResult.ok, true);
  if (readerSignalsResult.ok) {
    assert.strictEqual(readerSignalsResult.signals.length, 1);
  }

  const crossTenantReadResult = capability.readSignal(
    withIncidentResult.state,
    "errors.count",
    "tenant-b",
    {
      authLevel: "admin",
      permissions: ["observability.read"],
      tenantId: "tenant-b",
    },
  );
  assert.strictEqual(crossTenantReadResult.ok, true);
  if (crossTenantReadResult.ok) {
    assert.strictEqual(crossTenantReadResult.signals.length, 0);
  }
});

test("observabilitybuiltinalertingandincidentsproof", () => {
  const ruleAudit = makeAuditSink();
  const metricResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "queue.depth",
      value: 42,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    adminToken(),
  );
  assertOk(metricResult);

  const rule = validRule({
    id: "rule-proof",
    name: "proof_rule",
    metricName: "queue.depth",
    comparator: "GT",
    threshold: 10,
    severity: "HIGH",
  });

  const ruleResult = capability.addAlertRule(
    metricResult.state,
    rule,
    "req-proof",
    "trace-proof",
    adminToken(),
    ruleAudit.sink,
  );
  assertOk(ruleResult);
  assert.strictEqual(ruleAudit.events.length, 1);
  const ruleAuditEvent = ruleAudit.events[0];
  assert.ok(ruleAuditEvent !== undefined);
  assert.strictEqual(ruleAuditEvent.kind, "ALERT_RULE_CHANGE");

  const evalResult = capability.applyEvaluation(
    ruleResult.state,
    "2024-01-01T00:01:00.000Z",
  );
  assertOk(evalResult);
  const incident = evalResult.state.incidents[0];
  assert.ok(incident !== undefined);
  const incidentId = incident.id;

  const transitionAudit = makeAuditSink();
  const ackResult = capability.transitionIncident(
    evalResult.state,
    incidentId,
    "ACKNOWLEDGED",
    "req-proof-ack",
    "trace-proof-ack",
    adminToken(),
    transitionAudit.sink,
  );
  assertOk(ackResult);

  const resolvedResult = capability.transitionIncident(
    ackResult.state,
    incidentId,
    "RESOLVED",
    "req-proof-resolve",
    "trace-proof-resolve",
    adminToken(),
    transitionAudit.sink,
  );
  assertOk(resolvedResult);
  assert.strictEqual(transitionAudit.events.length, 2);
  const firstTransition = transitionAudit.events[0];
  const secondTransition = transitionAudit.events[1];
  assert.ok(firstTransition !== undefined);
  assert.ok(secondTransition !== undefined);
  assert.strictEqual(firstTransition.requestId, "req-proof-ack");
  assert.strictEqual(secondTransition.requestId, "req-proof-resolve");
  assert.strictEqual(firstTransition.kind, "INCIDENT_TRANSITION");
  assert.strictEqual(secondTransition.kind, "INCIDENT_TRANSITION");

  const emitted = new Set(
    resolvedResult.state.emittedSignals.map((entry) => entry.signal),
  );
  assert.strictEqual(emitted.has("observability.alert.fired"), true);
  assert.strictEqual(emitted.has("observability.incident.opened"), true);
  assert.strictEqual(emitted.has("observability.notification.dispatched"), true);
  assert.strictEqual(emitted.has("observability.incident.acknowledged"), true);
  assert.strictEqual(emitted.has("observability.incident.resolved"), true);
  assert.strictEqual(emitted.has("observability.readiness.ready"), true);

  const lineage = capability.proofLineage(resolvedResult.state);
  assert.strictEqual(lineage.ok, true);
  if (lineage.ok) {
    assert.strictEqual(
      lineage.audits.length,
      resolvedResult.state.auditTrail.length,
    );
    assert.strictEqual(
      lineage.signals.length,
      resolvedResult.state.emittedSignals.length,
    );
    assert.strictEqual(
      lineage.incidents.length,
      resolvedResult.state.incidents.length,
    );
    assert.strictEqual(
      lineage.notifications.length,
      resolvedResult.state.notifications.length,
    );
  }

  const signalReadout = capability.readEmittedSignals(resolvedResult.state);
  assert.strictEqual(signalReadout.ok, true);
  if (signalReadout.ok) {
    assert.strictEqual(
      signalReadout.signals.length,
      resolvedResult.state.emittedSignals.length,
    );
  }

  const proofState = capability.recordRuntimeProof(
    resolvedResult.state,
    "observability_signals",
    "test proof",
  );
  assert.strictEqual(
    proofState.lineage.length,
    resolvedResult.state.lineage.length + 1,
  );
  const lastLineage = proofState.lineage[proofState.lineage.length - 1];
  assert.ok(lastLineage !== undefined);
  assert.strictEqual(lastLineage.kind, "observability_signals");
  assert.strictEqual(lastLineage.description, "test proof");

  assert.strictEqual(capability.freshProofPending(), true);
});

test("observabilitybuiltinalertingandincidentsreadinessmodel", () => {
  const baseline = capability.computeReadinessPosture(capability.initialState);
  assert.strictEqual(baseline.state, "READY");
  assert.strictEqual(baseline.sideEffectsDisabled, false);
  assert.strictEqual(baseline.signalIngestion, true);
  assert.strictEqual(baseline.alertEvaluation, true);
  assert.strictEqual(baseline.notificationDispatch, true);
  const baselineReadiness = capability.checkReadiness(capability.initialState);
  assert.strictEqual(baselineReadiness.ok, true);
  if (baselineReadiness.ok) {
    assert.strictEqual(baselineReadiness.readiness, "READY");
  }

  const withSignalResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "http.request.count",
      value: 12,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    adminToken(),
  );
  assertOk(withSignalResult);
  const afterSignalPosture = capability.computeReadinessPosture(
    withSignalResult.state,
  );
  assert.strictEqual(afterSignalPosture.state, "READY");
  assert.strictEqual(afterSignalPosture.sideEffectsDisabled, false);

  const withRuleResult = capability.addAlertRule(
    withSignalResult.state,
    validRule({
      id: "rule-readiness",
      name: "readiness_rule",
      metricName: "http.request.count",
      threshold: 1,
      severity: "LOW",
    }),
    "req-readiness",
    "trace-readiness",
    adminToken(),
    () => null,
  );
  assertOk(withRuleResult);
  assert.strictEqual(withRuleResult.state.readinessPosture.state, "READY");
  assert.strictEqual(withRuleResult.state.readinessPosture.signalIngestion, true);
  assert.strictEqual(withRuleResult.state.readinessPosture.alertEvaluation, true);
  assert.strictEqual(
    withRuleResult.state.readinessPosture.notificationDispatch,
    true,
  );
  assert.strictEqual(
    withRuleResult.state.readinessPosture.sideEffectsDisabled,
    false,
  );

  const degradedResult = capability.handleProviderFailure(
    withRuleResult.state,
    "PROVIDER_FAILURE",
    "signal ingestion offline",
  );
  assert.strictEqual(degradedResult.readiness, "UNREADY");
  assert.strictEqual(degradedResult.readinessPosture.sideEffectsDisabled, true);
  assert.strictEqual(degradedResult.readinessPosture.signalIngestion, false);
  assert.strictEqual(degradedResult.readinessPosture.alertEvaluation, false);
  assert.strictEqual(degradedResult.readinessPosture.notificationDispatch, false);
  const degradedReadiness = capability.checkReadiness(degradedResult);
  assert.strictEqual(degradedReadiness.ok, true);
  if (degradedReadiness.ok) {
    assert.strictEqual(degradedReadiness.readiness, "UNREADY");
  }

  const emitted = new Set(
    degradedResult.emittedSignals.map((entry) => entry.signal),
  );
  assert.strictEqual(emitted.has("observability.readiness.unready"), true);
  assert.strictEqual(emitted.has("observability.error.provider_failure"), true);

  const blocked = capability.applyEvaluation(
    degradedResult,
    "2024-01-01T00:01:30.000Z",
  );
  assertErr(blocked, "PROVIDER_FAILURE");

  const readinessView = capability.readReadinessPosture(degradedResult);
  assert.strictEqual(readinessView.ok, true);
  if (readinessView.ok) {
    assert.strictEqual(readinessView.posture.state, "UNREADY");
    assert.strictEqual(readinessView.posture.sideEffectsDisabled, true);
  }
});

test("observabilitybuiltinalertingandincidentsstatemodel", () => {
  const signalResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "memory.usage",
      value: 95,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    adminToken(),
  );
  assertOk(signalResult);

  const ruleResult = capability.addAlertRule(
    signalResult.state,
    validRule({
      id: "rule-state",
      name: "state_rule",
      metricName: "memory.usage",
      comparator: "GTE",
      threshold: 90,
      severity: "HIGH",
    }),
    "req-state",
    "trace-state",
    adminToken(),
    () => null,
  );
  assertOk(ruleResult);

  const evalResult = capability.applyEvaluation(
    ruleResult.state,
    "2024-01-01T00:00:30.000Z",
  );
  assertOk(evalResult);
  const persisted: State = evalResult.state;
  assert.strictEqual(persisted.metricSignals.length, 1);
  assert.strictEqual(persisted.alertRules.length, 1);
  const persistedRule = persisted.alertRules[0];
  assert.ok(persistedRule !== undefined);
  assert.strictEqual(persistedRule.comparator, "GTE");
  assert.strictEqual(persistedRule.threshold, 90);
  assert.strictEqual(persistedRule.severity, "HIGH");
  assert.strictEqual(persisted.alerts.length, 1);
  const persistedAlert = persisted.alerts[0];
  assert.ok(persistedAlert !== undefined);
  assert.strictEqual(persistedAlert.state, "FIRED");
  assert.strictEqual(persisted.incidents.length, 1);
  const persistedIncident = persisted.incidents[0];
  assert.ok(persistedIncident !== undefined);
  assert.strictEqual(persistedIncident.state, "OPEN");
  assert.strictEqual(persisted.notifications.length, 1);
  const persistedNotification = persisted.notifications[0];
  assert.ok(persistedNotification !== undefined);
  assert.strictEqual(persistedNotification.status, "SENT");
  assert.strictEqual(
    persisted.schemaVersion,
    capability.ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
  );

  const legacyState: State = { ...persisted, schemaVersion: 1 };
  const migrated = capability.migrateState(
    legacyState,
    legacyState.schemaVersion,
    capability.ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
  );
  assertOk(migrated);
  assert.strictEqual(migrated.state.schemaVersion, 2);
  assert.strictEqual(
    migrated.state.metricSignals.length,
    persisted.metricSignals.length,
  );
  assert.strictEqual(
    migrated.state.alertRules.length,
    persisted.alertRules.length,
  );
  assert.strictEqual(migrated.state.alerts.length, persisted.alerts.length);
  assert.strictEqual(
    migrated.state.incidents.length,
    persisted.incidents.length,
  );
  assert.strictEqual(
    migrated.state.notifications.length,
    persisted.notifications.length,
  );

  const backwards = capability.migrateState(migrated.state, 2, 1);
  assertErr(backwards, "CONFIGURATION_DRIFT");

  const same = capability.applyMigrationIfNeeded(persisted);
  assert.strictEqual(same.ok, true);
  if (same.ok) {
    assert.strictEqual(same.state, persisted);
  }

  const readRulesResult = capability.readAlertRules(
    persisted,
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readRulesResult.ok, true);
  if (readRulesResult.ok) {
    assert.strictEqual(readRulesResult.rules.length, 1);
  }

  const readIncidentsResult = capability.readIncidents(
    persisted,
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readIncidentsResult.ok, true);
  if (readIncidentsResult.ok) {
    assert.strictEqual(readIncidentsResult.incidents.length, 1);
  }

  const readSignalsResult = capability.readSignal(
    persisted,
    "memory.usage",
    defaultTenant,
    readerToken(),
  );
  assert.strictEqual(readSignalsResult.ok, true);
  if (readSignalsResult.ok) {
    assert.strictEqual(readSignalsResult.signals.length, 1);
  }

  assert.ok(capability.legalIncidentTransitions instanceof Map);
  const resolvedTargets =
    capability.legalIncidentTransitions.get("RESOLVED") ?? [];
  assert.strictEqual(resolvedTargets.length, 0);
});

test("observabilitybuiltinalertingandincidentsvalidation", () => {
  const validRuleResult = capability.validateAlertRuleInput(
    validRule({ id: "rule-valid", name: "valid_rule" }),
  );
  assert.strictEqual(validRuleResult, null);

  const badComparator = capability.validateAlertRuleInput({
    ...validRule(),
    id: "bad-comparator",
    comparator: "NOPE" as Comparator,
  });
  assert.ok(badComparator !== null);
  assert.strictEqual(badComparator.kind, "INVALID_RULE_MUTATION");

  const badThreshold = capability.validateAlertRuleInput({
    ...validRule(),
    id: "bad-threshold",
    threshold: Number.NaN,
  });
  assert.ok(badThreshold !== null);
  assert.strictEqual(badThreshold.kind, "INVALID_RULE_MUTATION");

  const badSeverity = capability.validateAlertRuleInput({
    ...validRule(),
    id: "bad-severity",
    severity: "CATASTROPHIC" as Severity,
  });
  assert.ok(badSeverity !== null);
  assert.strictEqual(badSeverity.kind, "INVALID_RULE_MUTATION");

  const badMetric = capability.validateAlertRuleInput({
    ...validRule(),
    id: "bad-metric",
    metricName: "custom.unknown.metric",
  });
  assert.ok(badMetric !== null);
  assert.strictEqual(badMetric.kind, "INVALID_RULE_MUTATION");

  const badEmptyIds = capability.validateAlertRuleInput({
    ...validRule(),
    id: "",
    tenantId: "",
  });
  assert.ok(badEmptyIds !== null);
  assert.strictEqual(badEmptyIds.kind, "INVALID_RULE_MUTATION");

  let auditCalls = 0;
  const invalidMutation = capability.addAlertRule(
    capability.initialState,
    {
      ...validRule(),
      id: "invalid-mutation",
      metricName: "custom.unknown.metric",
    },
    "req-reject",
    "trace-reject",
    adminToken(),
    () => {
      auditCalls += 1;
      return null;
    },
  );
  assertErr(invalidMutation, "INVALID_RULE_MUTATION");
  assert.strictEqual(auditCalls, 0);

  const illegal = capability.validateIncidentTransition(
    "OPEN",
    "OPEN" as IncidentState,
  );
  assert.ok(illegal !== null);
  assert.strictEqual(illegal.kind, "ILLEGAL_INCIDENT_TRANSITION");

  const legal = capability.validateIncidentTransition(
    "OPEN",
    "ACKNOWLEDGED" as IncidentState,
  );
  assert.strictEqual(legal, null);

  const resolvedTerminal = capability.validateIncidentTransition(
    "RESOLVED",
    "OPEN" as IncidentState,
  );
  assert.ok(resolvedTerminal !== null);
  assert.strictEqual(resolvedTerminal.kind, "ILLEGAL_INCIDENT_TRANSITION");

  assert.strictEqual(capability.validateComparator("GT"), true);
  assert.strictEqual(capability.validateComparator("BOGUS" as Comparator), false);
  assert.strictEqual(capability.validateSeverity("HIGH"), true);
  assert.strictEqual(
    capability.validateSeverity("CATASTROPHIC" as Severity),
    false,
  );
  assert.strictEqual(capability.validateControlledSignalName("cpu.usage"), true);
  assert.strictEqual(
    capability.validateControlledSignalName("custom.metric"),
    false,
  );
  assert.strictEqual(capability.validateControlledSignalName("bad name"), false);

  const driftedSignalResult = capability.addMetricSignal(
    capability.initialState,
    {
      name: "custom.drift.metric",
      value: 1,
      timestamp: "2024-01-01T00:00:00.000Z",
      tenantId: defaultTenant,
    },
    adminToken(),
  );
  assertErr(driftedSignalResult, "CONFIGURATION_DRIFT");
});