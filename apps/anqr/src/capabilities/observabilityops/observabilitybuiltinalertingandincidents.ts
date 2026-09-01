export const ObservabilityBuiltInAlertingAndIncidentsAlertEvaluationState = [
  'NO_DATA',
  'WITHIN',
  'FIRED',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsAlertEvaluationState = typeof ObservabilityBuiltInAlertingAndIncidentsAlertEvaluationState[number];

export const ObservabilityBuiltInAlertingAndIncidentsIncidentState = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsIncidentState = typeof ObservabilityBuiltInAlertingAndIncidentsIncidentState[number];

export const ObservabilityBuiltInAlertingAndIncidentsNotificationStatus = [
  'SENT',
  'SUPPRESSED',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsNotificationStatus = typeof ObservabilityBuiltInAlertingAndIncidentsNotificationStatus[number];

export const ObservabilityBuiltInAlertingAndIncidentsComparator = [
  'GT',
  'GTE',
  'LT',
  'LTE',
  'EQ',
  'NEQ',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsComparator = typeof ObservabilityBuiltInAlertingAndIncidentsComparator[number];

export const ObservabilityBuiltInAlertingAndIncidentsSeverity = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsSeverity = typeof ObservabilityBuiltInAlertingAndIncidentsSeverity[number];

export const ObservabilityBuiltInAlertingAndIncidentsReadinessState = [
  'READY',
  'DEGRADED_SIGNAL_INGESTION',
  'DEGRADED_ALERT_EVALUATION',
  'DEGRADED_NOTIFICATION_DISPATCH',
  'UNREADY',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsReadinessState = typeof ObservabilityBuiltInAlertingAndIncidentsReadinessState[number];

export const ObservabilityBuiltInAlertingAndIncidentsErrorKind = [
  'PROVIDER_FAILURE',
  'INVALID_RULE_MUTATION',
  'ILLEGAL_INCIDENT_TRANSITION',
  'CONFIGURATION_DRIFT',
  'PERMISSION_DENIED',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsErrorKind = typeof ObservabilityBuiltInAlertingAndIncidentsErrorKind[number];

export const ObservabilityBuiltInAlertingAndIncidentsAuditEventKind = [
  'ALERT_RULE_CHANGE',
  'INCIDENT_TRANSITION',
  'NOTIFICATION_DISPATCH',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsAuditEventKind = typeof ObservabilityBuiltInAlertingAndIncidentsAuditEventKind[number];

export const ObservabilityBuiltInAlertingAndIncidentsObservableSignal = [
  'observability.signal.ingested',
  'observability.alert.evaluated',
  'observability.alert.fired',
  'observability.incident.opened',
  'observability.incident.acknowledged',
  'observability.incident.resolved',
  'observability.notification.dispatched',
  'observability.notification.suppressed',
  'observability.readiness.ready',
  'observability.readiness.degraded',
  'observability.readiness.unready',
  'observability.error.provider_failure',
  'observability.error.configuration_drift',
  'observability.error.permission_denied',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsObservableSignal = typeof ObservabilityBuiltInAlertingAndIncidentsObservableSignal[number];

export interface ObservabilityBuiltInAlertingAndIncidentsMetricSignal {
  readonly name: string;
  readonly value: number;
  readonly timestamp: string;
  readonly tenantId: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsAlertRule {
  readonly id: string;
  readonly name: string;
  readonly metricName: string;
  readonly comparator: ObservabilityBuiltInAlertingAndIncidentsComparator;
  readonly threshold: number;
  readonly severity: ObservabilityBuiltInAlertingAndIncidentsSeverity;
  readonly tenantId: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsAlert {
  readonly ruleId: string;
  readonly state: ObservabilityBuiltInAlertingAndIncidentsAlertEvaluationState;
  readonly lastEvaluated: string;
  readonly tenantId: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsIncident {
  readonly id: string;
  readonly alertId: string;
  readonly state: ObservabilityBuiltInAlertingAndIncidentsIncidentState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tenantId: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsNotification {
  readonly incidentId: string;
  readonly status: ObservabilityBuiltInAlertingAndIncidentsNotificationStatus;
  readonly dispatchedAt: string;
  readonly tenantId: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsAuditEvent {
  readonly kind: ObservabilityBuiltInAlertingAndIncidentsAuditEventKind;
  readonly entityId: string;
  readonly entityType: 'ALERT_RULE' | 'INCIDENT' | 'NOTIFICATION';
  readonly details: unknown;
  readonly timestamp: string;
  readonly requestId: string;
  readonly traceId: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsError {
  readonly kind: ObservabilityBuiltInAlertingAndIncidentsErrorKind;
  readonly message: string;
  readonly timestamp: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsReadinessPosture {
  readonly state: ObservabilityBuiltInAlertingAndIncidentsReadinessState;
  readonly signalIngestion: boolean;
  readonly alertEvaluation: boolean;
  readonly notificationDispatch: boolean;
  readonly sideEffectsDisabled: boolean;
}

export interface ObservabilityBuiltInAlertingAndIncidentsEmittedSignal {
  readonly signal: ObservabilityBuiltInAlertingAndIncidentsObservableSignal;
  readonly attributes: Readonly<Record<string, string>>;
  readonly timestamp: string;
}

export interface ObservabilityBuiltInAlertingAndIncidentsState {
  readonly metricSignals: readonly ObservabilityBuiltInAlertingAndIncidentsMetricSignal[];
  readonly alertRules: readonly ObservabilityBuiltInAlertingAndIncidentsAlertRule[];
  readonly alerts: readonly ObservabilityBuiltInAlertingAndIncidentsAlert[];
  readonly incidents: readonly ObservabilityBuiltInAlertingAndIncidentsIncident[];
  readonly notifications: readonly ObservabilityBuiltInAlertingAndIncidentsNotification[];
  readonly readiness: ObservabilityBuiltInAlertingAndIncidentsReadinessState;
  readonly readinessPosture: ObservabilityBuiltInAlertingAndIncidentsReadinessPosture;
  readonly lastError: ObservabilityBuiltInAlertingAndIncidentsError | null;
  readonly auditTrail: readonly ObservabilityBuiltInAlertingAndIncidentsAuditEvent[];
  readonly emittedSignals: readonly ObservabilityBuiltInAlertingAndIncidentsEmittedSignal[];
  readonly providerErrors: readonly ObservabilityBuiltInAlertingAndIncidentsError[];
  readonly schemaVersion: number;
}

export const ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion: number = 1;

export const initialState: ObservabilityBuiltInAlertingAndIncidentsState = {
  metricSignals: [],
  alertRules: [],
  alerts: [],
  incidents: [],
  notifications: [],
  readiness: 'UNREADY',
  readinessPosture: {
    state: 'UNREADY',
    signalIngestion: false,
    alertEvaluation: false,
    notificationDispatch: false,
    sideEffectsDisabled: true,
  },
  lastError: null,
  auditTrail: [],
  emittedSignals: [],
  providerErrors: [],
  schemaVersion: ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
};

export const legalIncidentTransitions: ReadonlyMap<
  ObservabilityBuiltInAlertingAndIncidentsIncidentState,
  readonly ObservabilityBuiltInAlertingAndIncidentsIncidentState[]
> = new Map([
  ['OPEN', ['ACKNOWLEDGED', 'RESOLVED'] as const],
  ['ACKNOWLEDGED', ['OPEN', 'RESOLVED'] as const],
  ['RESOLVED', [] as const],
]);

export const ObservabilityBuiltInAlertingAndIncidentsControlledNamePattern: RegExp =
  /^[a-zA-Z0-9_:-]+$/;

export const ObservabilityBuiltInAlertingAndIncidentsObservabilityVocabulary: ReadonlySet<string> =
  new Set([
    'cpu.usage',
    'memory.usage',
    'http.request.duration',
    'http.request.count',
    'errors.count',
    'queue.depth',
  ]);

export function validateAlertRuleInput(
  rule: ObservabilityBuiltInAlertingAndIncidentsAlertRule,
): ObservabilityBuiltInAlertingAndIncidentsError | null {
  if (!ObservabilityBuiltInAlertingAndIncidentsComparator.includes(rule.comparator)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: `Invalid comparator: ${rule.comparator}`,
      timestamp: new Date().toISOString(),
    };
  }
  if (typeof rule.threshold !== 'number' || isNaN(rule.threshold)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: 'Threshold must be a valid number',
      timestamp: new Date().toISOString(),
    };
  }
  if (!ObservabilityBuiltInAlertingAndIncidentsSeverity.includes(rule.severity)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: `Invalid severity: ${rule.severity}`,
      timestamp: new Date().toISOString(),
    };
  }
  if (!ObservabilityBuiltInAlertingAndIncidentsControlledNamePattern.test(rule.name)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: 'Alert rule name must match controlled observability vocabulary',
      timestamp: new Date().toISOString(),
    };
  }
  if (
    !ObservabilityBuiltInAlertingAndIncidentsControlledNamePattern.test(rule.metricName)
  ) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: 'Metric signal name must match controlled observability vocabulary',
      timestamp: new Date().toISOString(),
    };
  }
  if (rule.tenantId === '' || rule.id === '') {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: 'Tenant and rule identifiers are required',
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

export function validateIncidentTransition(
  currentState: ObservabilityBuiltInAlertingAndIncidentsIncidentState,
  newState: ObservabilityBuiltInAlertingAndIncidentsIncidentState,
): ObservabilityBuiltInAlertingAndIncidentsError | null {
  const allowedTransitions = legalIncidentTransitions.get(currentState);
  if (allowedTransitions === undefined || !allowedTransitions.includes(newState)) {
    return {
      kind: 'ILLEGAL_INCIDENT_TRANSITION',
      message: `Cannot transition from ${currentState} to ${newState}`,
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

export function isAllowedTransition(
  currentState: ObservabilityBuiltInAlertingAndIncidentsIncidentState,
  newState: ObservabilityBuiltInAlertingAndIncidentsIncidentState,
): boolean {
  const allowedTransitions = legalIncidentTransitions.get(currentState);
  if (allowedTransitions === undefined) {
    return false;
  }
  return allowedTransitions.includes(newState);
}

export function auditAction(
  kind: ObservabilityBuiltInAlertingAndIncidentsAuditEventKind,
  entityId: string,
  entityType: 'ALERT_RULE' | 'INCIDENT' | 'NOTIFICATION',
  details: unknown,
  requestId: string,
  traceId: string,
): ObservabilityBuiltInAlertingAndIncidentsAuditEvent {
  return {
    kind,
    entityId,
    entityType,
    details,
    timestamp: new Date().toISOString(),
    requestId,
    traceId,
  };
}

export function recordAudit(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent,
): ObservabilityBuiltInAlertingAndIncidentsState {
  return {
    ...state,
    auditTrail: [...state.auditTrail, event],
  };
}

export function emitObservabilitySignal(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  signal: ObservabilityBuiltInAlertingAndIncidentsObservableSignal,
  attributes: Readonly<Record<string, string>>,
  timestamp: string,
): ObservabilityBuiltInAlertingAndIncidentsState {
  return {
    ...state,
    emittedSignals: [
      ...state.emittedSignals,
      { signal, attributes, timestamp },
    ],
  };
}

export function addMetricSignal(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  signal: ObservabilityBuiltInAlertingAndIncidentsMetricSignal,
): ObservabilityBuiltInAlertingAndIncidentsState {
  if (!ObservabilityBuiltInAlertingAndIncidentsControlledNamePattern.test(signal.name)) {
    return {
      ...state,
      lastError: {
        kind: 'CONFIGURATION_DRIFT',
        message: `Metric signal name '${signal.name}' is not in the controlled observability vocabulary`,
        timestamp: new Date().toISOString(),
      },
    };
  }
  const next: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...state,
    metricSignals: [...state.metricSignals, signal],
  };
  return emitObservabilitySignal(
    next,
    'observability.signal.ingested',
    {
      'metric.name': signal.name,
      'tenant.id': signal.tenantId,
    },
    new Date().toISOString(),
  );
}

export function addAlertRule(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  rule: ObservabilityBuiltInAlertingAndIncidentsAlertRule,
  requestId: string,
  traceId: string,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => void,
): ObservabilityBuiltInAlertingAndIncidentsState | ObservabilityBuiltInAlertingAndIncidentsError {
  const validationError = validateAlertRuleInput(rule);
  if (validationError !== null) {
    return validationError;
  }

  const auditEvent = auditAction(
    'ALERT_RULE_CHANGE',
    rule.id,
    'ALERT_RULE',
    { action: 'ADD', rule },
    requestId,
    traceId,
  );
  auditFn(auditEvent);

  const updatedState = recordAudit(state, auditEvent);
  const withRule: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...updatedState,
    alertRules: [...updatedState.alertRules, rule],
  };
  return updateReadiness(withRule);
}

export function updateAlertRule(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  ruleId: string,
  updatedRule: ObservabilityBuiltInAlertingAndIncidentsAlertRule,
  requestId: string,
  traceId: string,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => void,
): ObservabilityBuiltInAlertingAndIncidentsState | ObservabilityBuiltInAlertingAndIncidentsError {
  const validationError = validateAlertRuleInput(updatedRule);
  if (validationError !== null) {
    return validationError;
  }

  const existingRuleIndex = state.alertRules.findIndex((r) => r.id === ruleId);
  if (existingRuleIndex === -1) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: `Alert rule with id ${ruleId} not found`,
      timestamp: new Date().toISOString(),
    };
  }

  const auditEvent = auditAction(
    'ALERT_RULE_CHANGE',
    ruleId,
    'ALERT_RULE',
    { action: 'UPDATE', oldRule: state.alertRules[existingRuleIndex], newRule: updatedRule },
    requestId,
    traceId,
  );
  auditFn(auditEvent);

  const updatedState = recordAudit(state, auditEvent);
  const newAlertRules = [...updatedState.alertRules];
  newAlertRules[existingRuleIndex] = updatedRule;
  return updateReadiness({
    ...updatedState,
    alertRules: newAlertRules,
  });
}

export function evaluateAlertRules(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  currentTime: string,
): {
  readonly newAlerts: readonly ObservabilityBuiltInAlertingAndIncidentsAlert[];
  readonly updatedIncidents: readonly ObservabilityBuiltInAlertingAndIncidentsIncident[];
  readonly newNotifications: readonly ObservabilityBuiltInAlertingAndIncidentsNotification[];
} {
  const newAlerts: ObservabilityBuiltInAlertingAndIncidentsAlert[] = [];
  const updatedIncidents: ObservabilityBuiltInAlertingAndIncidentsIncident[] = [];
  const newNotifications: ObservabilityBuiltInAlertingAndIncidentsNotification[] = [];

  if (state.readinessPosture.sideEffectsDisabled) {
    return { newAlerts, updatedIncidents, newNotifications };
  }

  for (const rule of state.alertRules) {
    const relevantSignals = state.metricSignals.filter(
      (s) => s.name === rule.metricName && s.tenantId === rule.tenantId,
    );
    if (relevantSignals.length === 0) {
      const existingAlert = state.alerts.find((a) => a.ruleId === rule.id);
      if (existingAlert === undefined || existingAlert.state !== 'NO_DATA') {
        newAlerts.push({
          ruleId: rule.id,
          state: 'NO_DATA',
          lastEvaluated: currentTime,
          tenantId: rule.tenantId,
        });
      }
      continue;
    }

    const latestSignal = relevantSignals.reduce((prev, current) =>
      prev.timestamp > current.timestamp ? prev : current,
    );
    let newState: ObservabilityBuiltInAlertingAndIncidentsAlertEvaluationState;
    switch (rule.comparator) {
      case 'GT':
        newState = latestSignal.value > rule.threshold ? 'FIRED' : 'WITHIN';
        break;
      case 'GTE':
        newState = latestSignal.value >= rule.threshold ? 'FIRED' : 'WITHIN';
        break;
      case 'LT':
        newState = latestSignal.value < rule.threshold ? 'FIRED' : 'WITHIN';
        break;
      case 'LTE':
        newState = latestSignal.value <= rule.threshold ? 'FIRED' : 'WITHIN';
        break;
      case 'EQ':
        newState = latestSignal.value === rule.threshold ? 'FIRED' : 'WITHIN';
        break;
      case 'NEQ':
        newState = latestSignal.value !== rule.threshold ? 'FIRED' : 'WITHIN';
        break;
      default:
        newState = 'NO_DATA';
    }

    const existingAlert = state.alerts.find((a) => a.ruleId === rule.id);
    if (existingAlert === undefined || existingAlert.state !== newState) {
      newAlerts.push({
        ruleId: rule.id,
        state: newState,
        lastEvaluated: currentTime,
        tenantId: rule.tenantId,
      });
    }

    if (newState === 'FIRED') {
      const existingIncident = state.incidents.find(
        (i) => i.alertId === rule.id && i.state !== 'RESOLVED',
      );
      if (existingIncident === undefined) {
        const newIncident: ObservabilityBuiltInAlertingAndIncidentsIncident = {
          id: `incident-${rule.id}-${currentTime}`,
          alertId: rule.id,
          state: 'OPEN',
          createdAt: currentTime,
          updatedAt: currentTime,
          tenantId: rule.tenantId,
        };
        updatedIncidents.push(newIncident);

        newNotifications.push({
          incidentId: newIncident.id,
          status: 'SENT',
          dispatchedAt: currentTime,
          tenantId: rule.tenantId,
        });
      }
    }
  }

  return { newAlerts, updatedIncidents, newNotifications };
}

export function applyEvaluation(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  currentTime: string,
): ObservabilityBuiltInAlertingAndIncidentsState {
  if (state.readinessPosture.sideEffectsDisabled) {
    return state;
  }
  const result = evaluateAlertRules(state, currentTime);
  let next: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...state,
    alerts: [...state.alerts, ...result.newAlerts],
    incidents: [...state.incidents, ...result.updatedIncidents],
    notifications: [...state.notifications, ...result.newNotifications],
  };
  for (const a of result.newAlerts) {
    next = emitObservabilitySignal(
      next,
      a.state === 'FIRED'
        ? 'observability.alert.fired'
        : a.state === 'NO_DATA'
          ? 'observability.alert.evaluated'
          : 'observability.alert.evaluated',
      {
        'rule.id': a.ruleId,
        'alert.state': a.state,
        'tenant.id': a.tenantId,
      },
      currentTime,
    );
  }
  for (const i of result.updatedIncidents) {
    next = emitObservabilitySignal(
      next,
      'observability.incident.opened',
      {
        'incident.id': i.id,
        'rule.id': i.alertId,
        'tenant.id': i.tenantId,
      },
      currentTime,
    );
  }
  for (const n of result.newNotifications) {
    next = emitObservabilitySignal(
      next,
      n.status === 'SENT'
        ? 'observability.notification.dispatched'
        : 'observability.notification.suppressed',
      {
        'incident.id': n.incidentId,
        'notification.status': n.status,
        'tenant.id': n.tenantId,
      },
      currentTime,
    );
  }
  return updateReadiness(next);
}

export function transitionIncident(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  incidentId: string,
  newState: ObservabilityBuiltInAlertingAndIncidentsIncidentState,
  requestId: string,
  traceId: string,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => void,
): ObservabilityBuiltInAlertingAndIncidentsState | ObservabilityBuiltInAlertingAndIncidentsError {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (incident === undefined) {
    return {
      kind: 'ILLEGAL_INCIDENT_TRANSITION',
      message: `Incident with id ${incidentId} not found`,
      timestamp: new Date().toISOString(),
    };
  }

  const validationError = validateIncidentTransition(incident.state, newState);
  if (validationError !== null) {
    return validationError;
  }

  const auditEvent = auditAction(
    'INCIDENT_TRANSITION',
    incidentId,
    'INCIDENT',
    { from: incident.state, to: newState },
    requestId,
    traceId,
  );
  auditFn(auditEvent);

  const updatedState = recordAudit(state, auditEvent);
  const updatedAt = new Date().toISOString();
  const updatedIncidents = updatedState.incidents.map((i) =>
    i.id === incidentId ? { ...i, state: newState, updatedAt } : i,
  );
  const withTransition: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...updatedState,
    incidents: updatedIncidents,
  };
  const signal: ObservabilityBuiltInAlertingAndIncidentsObservableSignal =
    newState === 'OPEN'
      ? 'observability.incident.opened'
      : newState === 'ACKNOWLEDGED'
        ? 'observability.incident.acknowledged'
        : 'observability.incident.resolved';
  return emitObservabilitySignal(
    withTransition,
    signal,
    {
      'incident.id': incidentId,
      'from.state': incident.state,
      'to.state': newState,
      'tenant.id': incident.tenantId,
    },
    updatedAt,
  );
}

export function dispatchNotification(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  incidentId: string,
  requestId: string,
  traceId: string,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => void,
): ObservabilityBuiltInAlertingAndIncidentsState | ObservabilityBuiltInAlertingAndIncidentsError {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (incident === undefined) {
    return {
      kind: 'ILLEGAL_INCIDENT_TRANSITION',
      message: `Incident with id ${incidentId} not found`,
      timestamp: new Date().toISOString(),
    };
  }

  const existingNotification = state.notifications.find((n) => n.incidentId === incidentId);
  if (existingNotification !== undefined) {
    return {
      kind: 'ILLEGAL_INCIDENT_TRANSITION',
      message: `Notification for incident ${incidentId} already dispatched`,
      timestamp: new Date().toISOString(),
    };
  }

  const auditEvent = auditAction(
    'NOTIFICATION_DISPATCH',
    incidentId,
    'NOTIFICATION',
    { status: 'SENT' },
    requestId,
    traceId,
  );
  auditFn(auditEvent);

  const updatedState = recordAudit(state, auditEvent);
  const dispatchedAt = new Date().toISOString();
  const newNotification: ObservabilityBuiltInAlertingAndIncidentsNotification = {
    incidentId,
    status: 'SENT',
    dispatchedAt,
    tenantId: incident.tenantId,
  };
  const withNotification: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...updatedState,
    notifications: [...updatedState.notifications, newNotification],
  };
  return emitObservabilitySignal(
    withNotification,
    'observability.notification.dispatched',
    {
      'incident.id': incidentId,
      'notification.status': 'SENT',
      'tenant.id': incident.tenantId,
    },
    dispatchedAt,
  );
}

export function suppressNotification(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  incidentId: string,
  requestId: string,
  traceId: string,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => void,
): ObservabilityBuiltInAlertingAndIncidentsState | ObservabilityBuiltInAlertingAndIncidentsError {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (incident === undefined) {
    return {
      kind: 'ILLEGAL_INCIDENT_TRANSITION',
      message: `Incident with id ${incidentId} not found`,
      timestamp: new Date().toISOString(),
    };
  }

  const existingNotification = state.notifications.find((n) => n.incidentId === incidentId);
  if (existingNotification !== undefined) {
    return {
      kind: 'ILLEGAL_INCIDENT_TRANSITION',
      message: `Notification for incident ${incidentId} already dispatched`,
      timestamp: new Date().toISOString(),
    };
  }

  const auditEvent = auditAction(
    'NOTIFICATION_DISPATCH',
    incidentId,
    'NOTIFICATION',
    { status: 'SUPPRESSED' },
    requestId,
    traceId,
  );
  auditFn(auditEvent);

  const updatedState = recordAudit(state, auditEvent);
  const dispatchedAt = new Date().toISOString();
  const newNotification: ObservabilityBuiltInAlertingAndIncidentsNotification = {
    incidentId,
    status: 'SUPPRESSED',
    dispatchedAt,
    tenantId: incident.tenantId,
  };
  const withNotification: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...updatedState,
    notifications: [...updatedState.notifications, newNotification],
  };
  return emitObservabilitySignal(
    withNotification,
    'observability.notification.suppressed',
    {
      'incident.id': incidentId,
      'notification.status': 'SUPPRESSED',
      'tenant.id': incident.tenantId,
    },
    dispatchedAt,
  );
}

export function computeReadinessPosture(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsReadinessPosture {
  const hasProviderError =
    state.lastError !== null && state.lastError.kind === 'PROVIDER_FAILURE';
  const signalIngestion = !hasProviderError;
  const alertEvaluation = !hasProviderError && state.alertRules.length > 0;
  const notificationDispatch = !hasProviderError && alertEvaluation;
  let stateValue: ObservabilityBuiltInAlertingAndIncidentsReadinessState;
  if (hasProviderError) {
    stateValue = 'DEGRADED_SIGNAL_INGESTION';
  } else if (state.alertRules.length === 0) {
    stateValue = 'DEGRADED_ALERT_EVALUATION';
  } else if (!notificationDispatch) {
    stateValue = 'DEGRADED_NOTIFICATION_DISPATCH';
  } else {
    stateValue = 'READY';
  }
  return {
    state: stateValue,
    signalIngestion,
    alertEvaluation,
    notificationDispatch,
    sideEffectsDisabled: hasProviderError,
  };
}

export function checkReadiness(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsReadinessState {
  return computeReadinessPosture(state).state;
}

export function updateReadiness(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsState {
  const posture = computeReadinessPosture(state);
  let next: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...state,
    readiness: posture.state,
    readinessPosture: posture,
  };
  const emittedSignal: ObservabilityBuiltInAlertingAndIncidentsObservableSignal =
    posture.state === 'READY'
      ? 'observability.readiness.ready'
      : posture.state === 'UNREADY'
        ? 'observability.readiness.unready'
        : 'observability.readiness.degraded';
  next = emitObservabilitySignal(
    next,
    emittedSignal,
    { 'readiness.state': posture.state },
    new Date().toISOString(),
  );
  return next;
}

export function handleProviderFailure(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  errorKind: ObservabilityBuiltInAlertingAndIncidentsErrorKind,
  message: string,
): ObservabilityBuiltInAlertingAndIncidentsState {
  const timestamp = new Date().toISOString();
  const error: ObservabilityBuiltInAlertingAndIncidentsError = {
    kind: errorKind,
    message,
    timestamp,
  };
  const errored: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...state,
    lastError: error,
    providerErrors: [...state.providerErrors, error],
  };
  const withReadiness = updateReadiness(errored);
  return emitObservabilitySignal(
    withReadiness,
    'observability.error.provider_failure',
    {
      'error.kind': errorKind,
      'error.message': message,
    },
    timestamp,
  );
}

export const ObservabilityBuiltInAlertingAndIncidentsProviderFailureThreshold: number = 3;

export function shouldAlertOnProviderFailures(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  threshold: number = ObservabilityBuiltInAlertingAndIncidentsProviderFailureThreshold,
): boolean {
  return state.providerErrors.length >= threshold;
}

export function migrateState(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  fromVersion: number,
  toVersion: number,
): ObservabilityBuiltInAlertingAndIncidentsState | ObservabilityBuiltInAlertingAndIncidentsError {
  if (fromVersion === toVersion) {
    return state;
  }
  if (toVersion < fromVersion) {
    return {
      kind: 'CONFIGURATION_DRIFT',
      message: `Cannot migrate backwards from version ${fromVersion} to ${toVersion}`,
      timestamp: new Date().toISOString(),
    };
  }
  if (fromVersion < ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion) {
    let working = state;
    if (fromVersion < 1) {
      working = {
        ...working,
        emittedSignals: working.emittedSignals ?? [],
        providerErrors: working.providerErrors ?? [],
        readinessPosture: working.readinessPosture ?? computeReadinessPosture(working),
      };
    }
    return {
      ...working,
      schemaVersion: ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
    };
  }
  return {
    kind: 'CONFIGURATION_DRIFT',
    message: `No migration path from version ${fromVersion} to ${toVersion}`,
    timestamp: new Date().toISOString(),
  };
}

export function applyMigrationIfNeeded(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsState | ObservabilityBuiltInAlertingAndIncidentsError {
  if (state.schemaVersion === ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion) {
    return state;
  }
  return migrateState(
    state,
    state.schemaVersion,
    ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
  );
}