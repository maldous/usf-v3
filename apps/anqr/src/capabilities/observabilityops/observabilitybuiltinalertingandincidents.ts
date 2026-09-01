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

export interface ObservabilityBuiltInAlertingAndIncidentsState {
  readonly metricSignals: readonly ObservabilityBuiltInAlertingAndIncidentsMetricSignal[];
  readonly alertRules: readonly ObservabilityBuiltInAlertingAndIncidentsAlertRule[];
  readonly alerts: readonly ObservabilityBuiltInAlertingAndIncidentsAlert[];
  readonly incidents: readonly ObservabilityBuiltInAlertingAndIncidentsIncident[];
  readonly notifications: readonly ObservabilityBuiltInAlertingAndIncidentsNotification[];
  readonly readiness: ObservabilityBuiltInAlertingAndIncidentsReadinessState;
  readonly lastError: ObservabilityBuiltInAlertingAndIncidentsError | null;
  readonly auditTrail: readonly ObservabilityBuiltInAlertingAndIncidentsAuditEvent[];
}

export const initialState: ObservabilityBuiltInAlertingAndIncidentsState = {
  metricSignals: [],
  alertRules: [],
  alerts: [],
  incidents: [],
  notifications: [],
  readiness: 'UNREADY',
  lastError: null,
  auditTrail: [],
};

export const legalIncidentTransitions: ReadonlyMap<
  ObservabilityBuiltInAlertingAndIncidentsIncidentState,
  readonly ObservabilityBuiltInAlertingAndIncidentsIncidentState[]
> = new Map([
  ['OPEN', ['ACKNOWLEDGED', 'RESOLVED'] as const],
  ['ACKNOWLEDGED', ['OPEN', 'RESOLVED'] as const],
  ['RESOLVED', [] as const],
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
  if (!/^[a-zA-Z0-9_:-]+$/.test(rule.name)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: 'Alert rule name must match controlled observability vocabulary',
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

export function addMetricSignal(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  signal: ObservabilityBuiltInAlertingAndIncidentsMetricSignal,
): ObservabilityBuiltInAlertingAndIncidentsState {
  return {
    ...state,
    metricSignals: [...state.metricSignals, signal],
  };
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
  return {
    ...updatedState,
    alertRules: [...updatedState.alertRules, rule],
  };
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
  return {
    ...updatedState,
    alertRules: newAlertRules,
  };
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
  const updatedIncidents = updatedState.incidents.map((i) =>
    i.id === incidentId ? { ...i, state: newState, updatedAt: new Date().toISOString() } : i,
  );
  return {
    ...updatedState,
    incidents: updatedIncidents,
  };
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
  const newNotification: ObservabilityBuiltInAlertingAndIncidentsNotification = {
    incidentId,
    status: 'SENT',
    dispatchedAt: new Date().toISOString(),
    tenantId: incident.tenantId,
  };
  return {
    ...updatedState,
    notifications: [...updatedState.notifications, newNotification],
  };
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
  const newNotification: ObservabilityBuiltInAlertingAndIncidentsNotification = {
    incidentId,
    status: 'SUPPRESSED',
    dispatchedAt: new Date().toISOString(),
    tenantId: incident.tenantId,
  };
  return {
    ...updatedState,
    notifications: [...updatedState.notifications, newNotification],
  };
}

export function checkReadiness(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsReadinessState {
  if (state.lastError !== null) {
    if (state.lastError.kind === 'PROVIDER_FAILURE') {
      return 'DEGRADED_SIGNAL_INGESTION';
    }
    return 'UNREADY';
  }

  if (state.metricSignals.length === 0) {
    return 'DEGRADED_SIGNAL_INGESTION';
  }

  if (state.alertRules.length === 0) {
    return 'DEGRADED_ALERT_EVALUATION';
  }

  return 'READY';
}

export function updateReadiness(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsState {
  return {
    ...state,
    readiness: checkReadiness(state),
  };
}

export function handleProviderFailure(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  errorKind: ObservabilityBuiltInAlertingAndIncidentsErrorKind,
  message: string,
): ObservabilityBuiltInAlertingAndIncidentsState {
  const error: ObservabilityBuiltInAlertingAndIncidentsError = {
    kind: errorKind,
    message,
    timestamp: new Date().toISOString(),
  };
  return {
    ...state,
    lastError: error,
    readiness: checkReadiness({ ...state, lastError: error }),
  };
}