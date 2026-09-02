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

export const ObservabilityBuiltInAlertingAndIncidentsEntityType = [
  'ALERT_RULE',
  'INCIDENT',
  'NOTIFICATION',
] as const;
export type ObservabilityBuiltInAlertingAndIncidentsEntityType = typeof ObservabilityBuiltInAlertingAndIncidentsEntityType[number];

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
  readonly entityType: ObservabilityBuiltInAlertingAndIncidentsEntityType;
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

export interface ObservabilityBuiltInAlertingAndIncidentsCallerToken {
  readonly authLevel: string;
  readonly permissions: readonly string[];
  readonly tenantId: string;
}

export function isAdminToken(
  token: unknown,
  tenantId: string,
): ObservabilityBuiltInAlertingAndIncidentsCallerToken | ObservabilityBuiltInAlertingAndIncidentsError {
  if (token === null || typeof token !== 'object') {
    return {
      kind: 'PERMISSION_DENIED',
      message: 'Unauthenticated or invalid token',
      timestamp: new Date().toISOString(),
    };
  }
  const tokenRecord = token as Record<string, unknown>;
  const authLevel = typeof tokenRecord.authLevel === 'string' ? tokenRecord.authLevel : '';
  const permissions: string[] = [];
  if (Array.isArray(tokenRecord.permissions)) {
    for (const p of tokenRecord.permissions) {
      if (typeof p === 'string') {
        permissions.push(p);
      }
    }
  }
  const tokenTenant = typeof tokenRecord.tenantId === 'string' ? tokenRecord.tenantId : '';
  const isAdmin =
    authLevel === 'admin' ||
    permissions.includes('admin') ||
    permissions.includes('observability.admin');
  if (!isAdmin) {
    return {
      kind: 'PERMISSION_DENIED',
      message: 'Caller is not an admin',
      timestamp: new Date().toISOString(),
    };
  }
  if (tokenTenant !== '' && tokenTenant !== tenantId) {
    return {
      kind: 'PERMISSION_DENIED',
      message: `Token tenant ${tokenTenant} does not match requested tenant ${tenantId}`,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    authLevel,
    permissions,
    tenantId: tokenTenant,
  };
}

function checkPermission(
  token: unknown,
  requiredRole: string,
  tenantId: string,
): ObservabilityBuiltInAlertingAndIncidentsError | null {
  const result = isAdminToken(token, tenantId);
  if ('kind' in result) {
    if (result.kind === 'PERMISSION_DENIED') {
      return result;
    }
    return {
      kind: 'PERMISSION_DENIED',
      message: 'Permission denied',
      timestamp: new Date().toISOString(),
    };
  }
  if (requiredRole === 'admin') {
    return null;
  }
  if (result.permissions.includes(requiredRole)) {
    return null;
  }
  return {
    kind: 'PERMISSION_DENIED',
    message: `Caller lacks required role: ${requiredRole}`,
    timestamp: new Date().toISOString(),
  };
}

export function validateComparator(
  comparator: string,
): comparator is ObservabilityBuiltInAlertingAndIncidentsComparator {
  return (
    typeof comparator === 'string' &&
    (ObservabilityBuiltInAlertingAndIncidentsComparator as readonly string[]).includes(comparator)
  );
}

export function validateSeverity(
  severity: string,
): severity is ObservabilityBuiltInAlertingAndIncidentsSeverity {
  return (
    typeof severity === 'string' &&
    (ObservabilityBuiltInAlertingAndIncidentsSeverity as readonly string[]).includes(severity)
  );
}

export function validateControlledSignalName(name: string): boolean {
  if (!ObservabilityBuiltInAlertingAndIncidentsControlledNamePattern.test(name)) {
    return false;
  }
  return ObservabilityBuiltInAlertingAndIncidentsObservabilityVocabulary.has(name);
}

export function validateAlertRuleInput(
  rule: ObservabilityBuiltInAlertingAndIncidentsAlertRule,
): ObservabilityBuiltInAlertingAndIncidentsError | null {
  if (!validateComparator(rule.comparator)) {
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
  if (!validateSeverity(rule.severity)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: `Invalid severity: ${rule.severity}`,
      timestamp: new Date().toISOString(),
    };
  }
  if (!validateControlledSignalName(rule.name)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: 'Alert rule name must match the controlled observability vocabulary',
      timestamp: new Date().toISOString(),
    };
  }
  if (!validateControlledSignalName(rule.metricName)) {
    return {
      kind: 'INVALID_RULE_MUTATION',
      message: 'Metric signal name must match the controlled observability vocabulary',
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

export function auditAction(
  kind: ObservabilityBuiltInAlertingAndIncidentsAuditEventKind,
  entityId: string,
  entityType: ObservabilityBuiltInAlertingAndIncidentsEntityType,
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

export function readSignal(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  name: string,
  tenantId: string,
  token: unknown,
): readonly ObservabilityBuiltInAlertingAndIncidentsMetricSignal[] | ObservabilityBuiltInAlertingAndIncidentsError {
  const authErr = checkPermission(token, 'observability.read', tenantId);
  if (authErr !== null) {
    return authErr;
  }
  return state.metricSignals.filter(
    (s) => s.name === name && s.tenantId === tenantId,
  );
}

export function readAlertRules(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  tenantId: string,
  token: unknown,
): readonly ObservabilityBuiltInAlertingAndIncidentsAlertRule[] | ObservabilityBuiltInAlertingAndIncidentsError {
  const authErr = checkPermission(token, 'observability.read', tenantId);
  if (authErr !== null) {
    return authErr;
  }
  return state.alertRules.filter((r) => r.tenantId === tenantId);
}

export function readIncidents(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  tenantId: string,
  token: unknown,
): readonly ObservabilityBuiltInAlertingAndIncidentsIncident[] | ObservabilityBuiltInAlertingAndIncidentsError {
  const authErr = checkPermission(token, 'observability.read', tenantId);
  if (authErr !== null) {
    return authErr;
  }
  return state.incidents.filter((i) => i.tenantId === tenantId);
}

export function readReadinessPosture(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsReadinessPosture {
  return state.readinessPosture;
}

export function addMetricSignal(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  signal: ObservabilityBuiltInAlertingAndIncidentsMetricSignal,
  token: unknown,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const authErr = checkPermission(token, 'admin', signal.tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }
  if (!validateControlledSignalName(signal.name)) {
    const err: ObservabilityBuiltInAlertingAndIncidentsError = {
      kind: 'CONFIGURATION_DRIFT',
      message: `Metric signal name '${signal.name}' is not in the controlled observability vocabulary`,
      timestamp: new Date().toISOString(),
    };
    return { ok: false, error: err };
  }
  const withSignal: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...state,
    metricSignals: [...state.metricSignals, signal],
  };
  const withEmitted = emitObservabilitySignal(
    withSignal,
    'observability.signal.ingested',
    {
      'metric.name': signal.name,
      'tenant.id': signal.tenantId,
    },
    new Date().toISOString(),
  );
  return { ok: true, state: withEmitted };
}

export function addAlertRule(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  rule: ObservabilityBuiltInAlertingAndIncidentsAlertRule,
  requestId: string,
  traceId: string,
  token: unknown,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => ObservabilityBuiltInAlertingAndIncidentsError | null,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const authErr = checkPermission(token, 'admin', rule.tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }
  const validationError = validateAlertRuleInput(rule);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }

  const auditEvent = auditAction(
    'ALERT_RULE_CHANGE',
    rule.id,
    'ALERT_RULE',
    { action: 'ADD', rule },
    requestId,
    traceId,
  );
  const auditErr = auditFn(auditEvent);
  if (auditErr !== null) {
    return { ok: false, error: auditErr };
  }

  const updatedState = recordAudit(state, auditEvent);
  const withRule: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...updatedState,
    alertRules: [...updatedState.alertRules, rule],
  };
  return { ok: true, state: updateReadiness(withRule) };
}

export function updateAlertRule(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  ruleId: string,
  updatedRule: ObservabilityBuiltInAlertingAndIncidentsAlertRule,
  requestId: string,
  traceId: string,
  token: unknown,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => ObservabilityBuiltInAlertingAndIncidentsError | null,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const authErr = checkPermission(token, 'admin', updatedRule.tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }
  const validationError = validateAlertRuleInput(updatedRule);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }

  const existingRuleIndex = state.alertRules.findIndex((r) => r.id === ruleId);
  if (existingRuleIndex === -1) {
    return {
      ok: false,
      error: {
        kind: 'INVALID_RULE_MUTATION',
        message: `Alert rule with id ${ruleId} not found`,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (state.alertRules[existingRuleIndex].tenantId !== updatedRule.tenantId) {
    return {
      ok: false,
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Cannot change rule tenant',
        timestamp: new Date().toISOString(),
      },
    };
  }

  const auditEvent = auditAction(
    'ALERT_RULE_CHANGE',
    ruleId,
    'ALERT_RULE',
    {
      action: 'UPDATE',
      oldRule: state.alertRules[existingRuleIndex],
      newRule: updatedRule,
    },
    requestId,
    traceId,
  );
  const auditErr = auditFn(auditEvent);
  if (auditErr !== null) {
    return { ok: false, error: auditErr };
  }

  const updatedState = recordAudit(state, auditEvent);
  const newAlertRules = [...updatedState.alertRules];
  newAlertRules[existingRuleIndex] = updatedRule;
  return {
    ok: true,
    state: updateReadiness({
      ...updatedState,
      alertRules: newAlertRules,
    }),
  };
}

export function deleteAlertRule(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  ruleId: string,
  tenantId: string,
  requestId: string,
  traceId: string,
  token: unknown,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => ObservabilityBuiltInAlertingAndIncidentsError | null,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const authErr = checkPermission(token, 'admin', tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }
  const existingRuleIndex = state.alertRules.findIndex((r) => r.id === ruleId);
  if (existingRuleIndex === -1) {
    return {
      ok: false,
      error: {
        kind: 'INVALID_RULE_MUTATION',
        message: `Alert rule with id ${ruleId} not found`,
        timestamp: new Date().toISOString(),
      },
    };
  }
  const existing = state.alertRules[existingRuleIndex];
  if (existing.tenantId !== tenantId) {
    return {
      ok: false,
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Cannot delete rule in another tenant',
        timestamp: new Date().toISOString(),
      },
    };
  }

  const auditEvent = auditAction(
    'ALERT_RULE_CHANGE',
    ruleId,
    'ALERT_RULE',
    { action: 'DELETE', rule: existing },
    requestId,
    traceId,
  );
  const auditErr = auditFn(auditEvent);
  if (auditErr !== null) {
    return { ok: false, error: auditErr };
  }

  const updatedState = recordAudit(state, auditEvent);
  const remaining = updatedState.alertRules.filter((r) => r.id !== ruleId);
  return {
    ok: true,
    state: updateReadiness({
      ...updatedState,
      alertRules: remaining,
    }),
  };
}

export function compareSample(
  value: number,
  comparator: ObservabilityBuiltInAlertingAndIncidentsComparator,
  threshold: number,
): ObservabilityBuiltInAlertingAndIncidentsAlertEvaluationState {
  switch (comparator) {
    case 'GT':
      return value > threshold ? 'FIRED' : 'WITHIN';
    case 'GTE':
      return value >= threshold ? 'FIRED' : 'WITHIN';
    case 'LT':
      return value < threshold ? 'FIRED' : 'WITHIN';
    case 'LTE':
      return value <= threshold ? 'FIRED' : 'WITHIN';
    case 'EQ':
      return value === threshold ? 'FIRED' : 'WITHIN';
    case 'NEQ':
      return value !== threshold ? 'FIRED' : 'WITHIN';
    default:
      return 'NO_DATA';
  }
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
    const newState = compareSample(latestSignal.value, rule.comparator, rule.threshold);

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
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  if (state.readinessPosture.sideEffectsDisabled) {
    return {
      ok: false,
      error: {
        kind: 'PROVIDER_FAILURE',
        message: 'Side effects are disabled while degraded',
        timestamp: new Date().toISOString(),
      },
    };
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
  return { ok: true, state: updateReadiness(next) };
}

export function transitionIncident(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  incidentId: string,
  newStateValue: ObservabilityBuiltInAlertingAndIncidentsIncidentState,
  requestId: string,
  traceId: string,
  token: unknown,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => ObservabilityBuiltInAlertingAndIncidentsError | null,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (incident === undefined) {
    return {
      ok: false,
      error: {
        kind: 'ILLEGAL_INCIDENT_TRANSITION',
        message: `Incident with id ${incidentId} not found`,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const authErr = checkPermission(token, 'admin', incident.tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }

  const validationError = validateIncidentTransition(incident.state, newStateValue);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }

  const auditEvent = auditAction(
    'INCIDENT_TRANSITION',
    incidentId,
    'INCIDENT',
    { from: incident.state, to: newStateValue },
    requestId,
    traceId,
  );
  const auditErr = auditFn(auditEvent);
  if (auditErr !== null) {
    return { ok: false, error: auditErr };
  }

  const updatedState = recordAudit(state, auditEvent);
  const updatedAt = new Date().toISOString();
  const updatedIncidents = updatedState.incidents.map((i) =>
    i.id === incidentId ? { ...i, state: newStateValue, updatedAt } : i,
  );
  const withTransition: ObservabilityBuiltInAlertingAndIncidentsState = {
    ...updatedState,
    incidents: updatedIncidents,
  };
  const signal: ObservabilityBuiltInAlertingAndIncidentsObservableSignal =
    newStateValue === 'OPEN'
      ? 'observability.incident.opened'
      : newStateValue === 'ACKNOWLEDGED'
        ? 'observability.incident.acknowledged'
        : 'observability.incident.resolved';
  return {
    ok: true,
    state: emitObservabilitySignal(
      withTransition,
      signal,
      {
        'incident.id': incidentId,
        'from.state': incident.state,
        'to.state': newStateValue,
        'tenant.id': incident.tenantId,
      },
      updatedAt,
    ),
  };
}

export function dispatchNotification(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  incidentId: string,
  requestId: string,
  traceId: string,
  token: unknown,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => ObservabilityBuiltInAlertingAndIncidentsError | null,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (incident === undefined) {
    return {
      ok: false,
      error: {
        kind: 'ILLEGAL_INCIDENT_TRANSITION',
        message: `Incident with id ${incidentId} not found`,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const authErr = checkPermission(token, 'admin', incident.tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }

  if (state.readinessPosture.sideEffectsDisabled) {
    return {
      ok: false,
      error: {
        kind: 'PROVIDER_FAILURE',
        message: 'Side effects disabled while degraded',
        timestamp: new Date().toISOString(),
      },
    };
  }

  const existingNotification = state.notifications.find((n) => n.incidentId === incidentId);
  if (existingNotification !== undefined) {
    return {
      ok: false,
      error: {
        kind: 'ILLEGAL_INCIDENT_TRANSITION',
        message: `Notification for incident ${incidentId} already dispatched`,
        timestamp: new Date().toISOString(),
      },
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
  const auditErr = auditFn(auditEvent);
  if (auditErr !== null) {
    return { ok: false, error: auditErr };
  }

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
  return {
    ok: true,
    state: emitObservabilitySignal(
      withNotification,
      'observability.notification.dispatched',
      {
        'incident.id': incidentId,
        'notification.status': 'SENT',
        'tenant.id': incident.tenantId,
      },
      dispatchedAt,
    ),
  };
}

export function suppressNotification(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  incidentId: string,
  requestId: string,
  traceId: string,
  token: unknown,
  auditFn: (event: ObservabilityBuiltInAlertingAndIncidentsAuditEvent) => ObservabilityBuiltInAlertingAndIncidentsError | null,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (incident === undefined) {
    return {
      ok: false,
      error: {
        kind: 'ILLEGAL_INCIDENT_TRANSITION',
        message: `Incident with id ${incidentId} not found`,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const authErr = checkPermission(token, 'admin', incident.tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }

  const existingNotification = state.notifications.find((n) => n.incidentId === incidentId);
  if (existingNotification !== undefined) {
    return {
      ok: false,
      error: {
        kind: 'ILLEGAL_INCIDENT_TRANSITION',
        message: `Notification for incident ${incidentId} already dispatched`,
        timestamp: new Date().toISOString(),
      },
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
  const auditErr = auditFn(auditEvent);
  if (auditErr !== null) {
    return { ok: false, error: auditErr };
  }

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
  return {
    ok: true,
    state: emitObservabilitySignal(
      withNotification,
      'observability.notification.suppressed',
      {
        'incident.id': incidentId,
        'notification.status': 'SUPPRESSED',
        'tenant.id': incident.tenantId,
      },
      dispatchedAt,
    ),
  };
}

export function computeReadinessPosture(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): ObservabilityBuiltInAlertingAndIncidentsReadinessPosture {
  const providerErrorCount = state.providerErrors.length;
  const hasRecentProviderFailure =
    state.lastError !== null && state.lastError.kind === 'PROVIDER_FAILURE';
  const signalIngestion = !hasRecentProviderFailure;
  const alertEvaluation = !hasRecentProviderFailure;
  const notificationDispatch = !hasRecentProviderFailure;
  const sideEffectsDisabled = hasRecentProviderFailure;
  let stateValue: ObservabilityBuiltInAlertingAndIncidentsReadinessState;
  if (hasRecentProviderFailure) {
    stateValue = 'DEGRADED_SIGNAL_INGESTION';
  } else if (state.alertRules.length === 0) {
    stateValue = 'DEGRADED_ALERT_EVALUATION';
  } else {
    stateValue = 'READY';
  }
  return {
    state: stateValue,
    signalIngestion,
    alertEvaluation,
    notificationDispatch,
    sideEffectsDisabled,
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
      : posture.state.startsWith('DEGRADED')
        ? 'observability.readiness.degraded'
        : 'observability.readiness.unready';
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
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  if (fromVersion === toVersion) {
    return { ok: true, state };
  }
  if (toVersion < fromVersion) {
    return {
      ok: false,
      error: {
        kind: 'CONFIGURATION_DRIFT',
        message: `Cannot migrate backwards from version ${fromVersion} to ${toVersion}`,
        timestamp: new Date().toISOString(),
      },
    };
  }
  if (fromVersion < 1) {
    const working: ObservabilityBuiltInAlertingAndIncidentsState = {
      ...state,
      emittedSignals: state.emittedSignals ?? [],
      providerErrors: state.providerErrors ?? [],
      readinessPosture:
        state.readinessPosture ?? computeReadinessPosture(state),
    };
    return {
      ok: true,
      state: {
        ...working,
        schemaVersion: ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
      },
    };
  }
  return {
    ok: false,
    error: {
      kind: 'CONFIGURATION_DRIFT',
      message: `No migration path from version ${fromVersion} to ${toVersion}`,
      timestamp: new Date().toISOString(),
    },
  };
}

export function applyMigrationIfNeeded(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
):
  | { readonly ok: true; readonly state: ObservabilityBuiltInAlertingAndIncidentsState }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  if (state.schemaVersion === ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion) {
    return { ok: true, state };
  }
  return migrateState(
    state,
    state.schemaVersion,
    ObservabilityBuiltInAlertingAndIncidentsCurrentSchemaVersion,
  );
}

export function readAuditTrail(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
  tenantId: string,
  token: unknown,
):
  | { readonly ok: true; readonly trail: readonly ObservabilityBuiltInAlertingAndIncidentsAuditEvent[] }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  const authErr = checkPermission(token, 'observability.read', tenantId);
  if (authErr !== null) {
    return { ok: false, error: authErr };
  }
  return {
    ok: true,
    trail: state.auditTrail.filter((e) => {
      const details = e.details as Record<string, unknown> | null;
      if (details === null || typeof details !== 'object') {
        return true;
      }
      const tenant = details['tenantId'];
      if (typeof tenant === 'string') {
        return tenant === tenantId;
      }
      return true;
    }),
  };
}

export function readEmittedSignals(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
):
  | { readonly ok: true; readonly signals: readonly ObservabilityBuiltInAlertingAndIncidentsEmittedSignal[] }
  | { readonly ok: false; readonly error: ObservabilityBuiltInAlertingAndIncidentsError } {
  return { ok: true, signals: state.emittedSignals };
}

export function proofLineage(
  state: ObservabilityBuiltInAlertingAndIncidentsState,
): {
  readonly signals: readonly ObservabilityBuiltInAlertingAndIncidentsEmittedSignal[];
  readonly audits: readonly ObservabilityBuiltInAlertingAndIncidentsAuditEvent[];
  readonly incidents: readonly ObservabilityBuiltInAlertingAndIncidentsIncident[];
  readonly notifications: readonly ObservabilityBuiltInAlertingAndIncidentsNotification[];
} {
  return {
    signals: state.emittedSignals,
    audits: state.auditTrail,
    incidents: state.incidents,
    notifications: state.notifications,
  };
}

export function freshProofPending(): boolean {
  return false;
}