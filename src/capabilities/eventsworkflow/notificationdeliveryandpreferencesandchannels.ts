export const NotificationDeliveryAndPreferencesAndChannelsStatus = [
  'SENT',
  'SUPPRESSED',
  'FAILED',
] as const;
export type NotificationDeliveryAndPreferencesAndChannelsStatus = typeof NotificationDeliveryAndPreferencesAndChannelsStatus[number];

export const NotificationDeliveryAndPreferencesAndChannelsReadiness = [
  'AVAILABLE',
  'UNAVAILABLE',
  'DEGRADED',
] as const;
export type NotificationDeliveryAndPreferencesAndChannelsReadiness = typeof NotificationDeliveryAndPreferencesAndChannelsReadiness[number];

export const NotificationDeliveryAndPreferencesAndChannelsErrorKind = [
  'READINESS_UNAVAILABLE',
  'READINESS_DEGRADED',
  'NO_TENANT',
  'VALIDATION_ERROR',
  'INVALID_TENANT_ID',
  'TRANSPORT_NON_2XX_FAILURE',
] as const;
export type NotificationDeliveryAndPreferencesAndChannelsErrorKind = typeof NotificationDeliveryAndPreferencesAndChannelsErrorKind[number];

export const NotificationDeliveryAndPreferencesAndChannelsAuditEventKind = [
  'AUDIT_BEFORE_CHANGE',
  'AUDIT_BEFORE_ACTION',
] as const;
export type NotificationDeliveryAndPreferencesAndChannelsAuditEventKind = typeof NotificationDeliveryAndPreferencesAndChannelsAuditEventKind[number];

export const NotificationDeliveryAndPreferencesAndChannelsChannel = [
  'EMAIL',
  'WEBHOOK',
  'LOCAL',
] as const;
export type NotificationDeliveryAndPreferencesAndChannelsChannel = typeof NotificationDeliveryAndPreferencesAndChannelsChannel[number];

export const NotificationDeliveryAndPreferencesAndChannelsCategory = [
  'WORKFLOW',
  'SYSTEM',
  'ALERT',
] as const;
export type NotificationDeliveryAndPreferencesAndChannelsCategory = typeof NotificationDeliveryAndPreferencesAndChannelsCategory[number];

export interface NotificationDeliveryAndPreferencesAndChannelsPreference {
  readonly organisation: string;
  readonly user: string;
  readonly channel: NotificationDeliveryAndPreferencesAndChannelsChannel;
  readonly category: NotificationDeliveryAndPreferencesAndChannelsCategory;
  readonly enabled: boolean;
}

export interface NotificationDeliveryAndPreferencesAndChannelsNotificationLog {
  readonly id: string;
  readonly tenantId: string;
  readonly status: NotificationDeliveryAndPreferencesAndChannelsStatus;
  readonly channel: NotificationDeliveryAndPreferencesAndChannelsChannel;
  readonly category: NotificationDeliveryAndPreferencesAndChannelsCategory;
  readonly timestamp: string;
}

export interface NotificationDeliveryAndPreferencesAndChannelsAuditEvent {
  readonly kind: NotificationDeliveryAndPreferencesAndChannelsAuditEventKind;
  readonly action: string;
  readonly tenantId: string;
  readonly user: string;
  readonly timestamp: string;
}

export interface NotificationDeliveryAndPreferencesAndChannelsError {
  readonly kind: NotificationDeliveryAndPreferencesAndChannelsErrorKind;
  readonly message: string;
}

export interface NotificationDeliveryAndPreferencesAndChannelsTransportReadiness {
  readonly channel: NotificationDeliveryAndPreferencesAndChannelsChannel;
  readonly readiness: NotificationDeliveryAndPreferencesAndChannelsReadiness;
}

export interface NotificationDeliveryAndPreferencesAndChannelsState {
  readonly preferences: readonly NotificationDeliveryAndPreferencesAndChannelsPreference[];
  readonly notificationLogs: readonly NotificationDeliveryAndPreferencesAndChannelsNotificationLog[];
  readonly transportReadiness: readonly NotificationDeliveryAndPreferencesAndChannelsTransportReadiness[];
  readonly lastAuditEvent: NotificationDeliveryAndPreferencesAndChannelsAuditEvent | null;
  readonly lastError: NotificationDeliveryAndPreferencesAndChannelsError | null;
}

export const initialState: NotificationDeliveryAndPreferencesAndChannelsState = {
  preferences: [],
  notificationLogs: [],
  transportReadiness: [],
  lastAuditEvent: null,
  lastError: null,
};

export function auditPreferenceChange(
  tenantId: string,
  user: string,
  action: string,
  auditFn: (event: NotificationDeliveryAndPreferencesAndChannelsAuditEvent) => NotificationDeliveryAndPreferencesAndChannelsError | null,
): NotificationDeliveryAndPreferencesAndChannelsError | null {
  const event: NotificationDeliveryAndPreferencesAndChannelsAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    action,
    tenantId,
    user,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function auditDispatchAction(
  tenantId: string,
  user: string,
  action: string,
  auditFn: (event: NotificationDeliveryAndPreferencesAndChannelsAuditEvent) => NotificationDeliveryAndPreferencesAndChannelsError | null,
): NotificationDeliveryAndPreferencesAndChannelsError | null {
  const event: NotificationDeliveryAndPreferencesAndChannelsAuditEvent = {
    kind: 'AUDIT_BEFORE_ACTION',
    action,
    tenantId,
    user,
    timestamp: new Date().toISOString(),
  };
  return auditFn(event);
}

export function setPreference(
  state: NotificationDeliveryAndPreferencesAndChannelsState,
  tenantId: string,
  user: string,
  organisation: string,
  channel: NotificationDeliveryAndPreferencesAndChannelsChannel,
  category: NotificationDeliveryAndPreferencesAndChannelsCategory,
  enabled: boolean,
  auditFn: (event: NotificationDeliveryAndPreferencesAndChannelsAuditEvent) => NotificationDeliveryAndPreferencesAndChannelsError | null,
): NotificationDeliveryAndPreferencesAndChannelsState | NotificationDeliveryAndPreferencesAndChannelsError {
  const action = `SET_PREFERENCE:${organisation}:${user}:${channel}:${category}`;
  const auditError = auditPreferenceChange(tenantId, user, action, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const existingIndex = state.preferences.findIndex(
    (p) =>
      p.organisation === organisation &&
      p.user === user &&
      p.channel === channel &&
      p.category === category,
  );

  const newPreferences = [...state.preferences];
  if (existingIndex >= 0) {
    newPreferences[existingIndex] = { organisation, user, channel, category, enabled };
  } else {
    newPreferences.push({ organisation, user, channel, category, enabled });
  }

  return {
    ...state,
    preferences: newPreferences,
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_CHANGE',
      action,
      tenantId,
      user,
      timestamp: new Date().toISOString(),
    },
    lastError: null,
  };
}

export function getPreferences(
  state: NotificationDeliveryAndPreferencesAndChannelsState,
  tenantId: string,
  user: string,
): readonly NotificationDeliveryAndPreferencesAndChannelsPreference[] {
  return state.preferences.filter(
    (p) => p.organisation === tenantId && p.user === user,
  );
}

export function dispatchNotification(
  state: NotificationDeliveryAndPreferencesAndChannelsState,
  tenantId: string,
  user: string,
  channel: NotificationDeliveryAndPreferencesAndChannelsChannel,
  category: NotificationDeliveryAndPreferencesAndChannelsCategory,
  auditFn: (event: NotificationDeliveryAndPreferencesAndChannelsAuditEvent) => NotificationDeliveryAndPreferencesAndChannelsError | null,
): NotificationDeliveryAndPreferencesAndChannelsState | NotificationDeliveryAndPreferencesAndChannelsError {
  const action = `DISPATCH:${tenantId}:${user}:${channel}:${category}`;
  const auditError = auditDispatchAction(tenantId, user, action, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const preference = state.preferences.find(
    (p) =>
      p.organisation === tenantId &&
      p.user === user &&
      p.channel === channel &&
      p.category === category,
  );

  if (preference === undefined || !preference.enabled) {
    const newLog: NotificationDeliveryAndPreferencesAndChannelsNotificationLog = {
      id: `${Date.now()}`,
      tenantId,
      status: 'SUPPRESSED',
      channel,
      category,
      timestamp: new Date().toISOString(),
    };
    return {
      ...state,
      notificationLogs: [...state.notificationLogs, newLog],
      lastAuditEvent: {
        kind: 'AUDIT_BEFORE_ACTION',
        action,
        tenantId,
        user,
        timestamp: new Date().toISOString(),
      },
      lastError: null,
    };
  }

  const transportReadiness = state.transportReadiness.find(
    (tr) => tr.channel === channel,
  );

  if (transportReadiness === undefined || transportReadiness.readiness !== 'AVAILABLE') {
    const newLog: NotificationDeliveryAndPreferencesAndChannelsNotificationLog = {
      id: `${Date.now()}`,
      tenantId,
      status: 'FAILED',
      channel,
      category,
      timestamp: new Date().toISOString(),
    };
    return {
      ...state,
      notificationLogs: [...state.notificationLogs, newLog],
      lastAuditEvent: {
        kind: 'AUDIT_BEFORE_ACTION',
        action,
        tenantId,
        user,
        timestamp: new Date().toISOString(),
      },
      lastError: {
        kind: 'READINESS_UNAVAILABLE',
        message: `Transport ${channel} is not available`,
      },
    };
  }

  const newLog: NotificationDeliveryAndPreferencesAndChannelsNotificationLog = {
    id: `${Date.now()}`,
    tenantId,
    status: 'SENT',
    channel,
    category,
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    notificationLogs: [...state.notificationLogs, newLog],
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_ACTION',
      action,
      tenantId,
      user,
      timestamp: new Date().toISOString(),
    },
    lastError: null,
  };
}

export function testNotification(
  state: NotificationDeliveryAndPreferencesAndChannelsState,
  tenantId: string,
  channel: NotificationDeliveryAndPreferencesAndChannelsChannel,
  auditFn: (event: NotificationDeliveryAndPreferencesAndChannelsAuditEvent) => NotificationDeliveryAndPreferencesAndChannelsError | null,
): NotificationDeliveryAndPreferencesAndChannelsState | NotificationDeliveryAndPreferencesAndChannelsError {
  if (tenantId === '') {
    return { kind: 'INVALID_TENANT_ID', message: 'Tenant ID cannot be empty' };
  }

  const action = `TEST:${tenantId}:${channel}`;
  const auditError = auditDispatchAction(tenantId, '', action, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const transportReadiness = state.transportReadiness.find(
    (tr) => tr.channel === channel,
  );

  if (transportReadiness === undefined || transportReadiness.readiness !== 'AVAILABLE') {
    return {
      kind: 'READINESS_UNAVAILABLE',
      message: `Transport ${channel} is not available for test`,
    };
  }

  const newLog: NotificationDeliveryAndPreferencesAndChannelsNotificationLog = {
    id: `${Date.now()}`,
    tenantId,
    status: 'SENT',
    channel,
    category: 'SYSTEM',
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    notificationLogs: [...state.notificationLogs, newLog],
    lastAuditEvent: {
      kind: 'AUDIT_BEFORE_ACTION',
      action,
      tenantId,
      user: '',
      timestamp: new Date().toISOString(),
    },
    lastError: null,
  };
}

export function getReadiness(
  state: NotificationDeliveryAndPreferencesAndChannelsState,
): readonly NotificationDeliveryAndPreferencesAndChannelsTransportReadiness[] {
  return state.transportReadiness;
}

export function setTransportReadiness(
  state: NotificationDeliveryAndPreferencesAndChannelsState,
  channel: NotificationDeliveryAndPreferencesAndChannelsChannel,
  readiness: NotificationDeliveryAndPreferencesAndChannelsReadiness,
): NotificationDeliveryAndPreferencesAndChannelsState {
  const existingIndex = state.transportReadiness.findIndex(
    (tr) => tr.channel === channel,
  );

  const newTransportReadiness = [...state.transportReadiness];
  if (existingIndex >= 0) {
    newTransportReadiness[existingIndex] = { channel, readiness };
  } else {
    newTransportReadiness.push({ channel, readiness });
  }

  return {
    ...state,
    transportReadiness: newTransportReadiness,
  };
}

export function validatePreference(
  preference: unknown,
): NotificationDeliveryAndPreferencesAndChannelsError | null {
  if (
    preference === null ||
    typeof preference !== 'object' ||
    !('organisation' in preference) ||
    !('user' in preference) ||
    !('channel' in preference) ||
    !('category' in preference) ||
    !('enabled' in preference)
  ) {
    return { kind: 'VALIDATION_ERROR', message: 'Invalid preference structure' };
  }

  const pref = preference as Record<string, unknown>;
  if (
    typeof pref.organisation !== 'string' ||
    typeof pref.user !== 'string' ||
    !NotificationDeliveryAndPreferencesAndChannelsChannel.includes(
      pref.channel as NotificationDeliveryAndPreferencesAndChannelsChannel,
    ) ||
    !NotificationDeliveryAndPreferencesAndChannelsCategory.includes(
      pref.category as NotificationDeliveryAndPreferencesAndChannelsCategory,
    ) ||
    typeof pref.enabled !== 'boolean'
  ) {
    return { kind: 'VALIDATION_ERROR', message: 'Invalid preference fields' };
  }

  return null;
}

export function validateTenantId(
  tenantId: string,
): NotificationDeliveryAndPreferencesAndChannelsError | null {
  if (tenantId === '') {
    return { kind: 'INVALID_TENANT_ID', message: 'Tenant ID cannot be empty' };
  }
  return null;
}