export const EndUserProfileAndPreferencesSelfServiceAuditEventKind = [
  'AUDIT_BEFORE_CHANGE',
  'PROFILE_UPDATED',
  'PREFERENCE_UPDATED',
  'NOTIFICATION_TESTED',
] as const;
export type EndUserProfileAndPreferencesSelfServiceAuditEventKind = typeof EndUserProfileAndPreferencesSelfServiceAuditEventKind[number];

export const EndUserProfileAndPreferencesSelfServiceErrorKind = [
  'VALIDATION_ERROR',
  'NO_TENANT',
  'NOT_NOTIFIABLE',
  'DEGRADED',
] as const;
export type EndUserProfileAndPreferencesSelfServiceErrorKind = typeof EndUserProfileAndPreferencesSelfServiceErrorKind[number];

export const EndUserProfileAndPreferencesSelfServiceDispatchStatus = [
  'SENT',
  'SUPPRESSED',
  'FAILED',
] as const;
export type EndUserProfileAndPreferencesSelfServiceDispatchStatus = typeof EndUserProfileAndPreferencesSelfServiceDispatchStatus[number];

export const EndUserProfileAndPreferencesSelfServicePermission = [
  'SELF_READ',
  'SELF_UPDATE',
] as const;
export type EndUserProfileAndPreferencesSelfServicePermission = typeof EndUserProfileAndPreferencesSelfServicePermission[number];

export const EndUserProfileAndPreferencesSelfServiceReadiness = [
  'READY',
  'DEGRADED',
] as const;
export type EndUserProfileAndPreferencesSelfServiceReadiness = typeof EndUserProfileAndPreferencesSelfServiceReadiness[number];

export interface EndUserProfileAndPreferencesSelfServiceAuditEvent {
  readonly kind: EndUserProfileAndPreferencesSelfServiceAuditEventKind;
  readonly userId: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly payload: unknown;
}

export interface EndUserProfileAndPreferencesSelfServiceError {
  readonly kind: EndUserProfileAndPreferencesSelfServiceErrorKind;
  readonly message: string;
}

export interface EndUserProfileAndPreferencesSelfServiceProfile {
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
}

export interface EndUserProfileAndPreferencesSelfServicePreference {
  readonly channel: string;
  readonly category: string;
  readonly enabled: boolean;
}

export interface EndUserProfileAndPreferencesSelfServiceDispatchLog {
  readonly userId: string;
  readonly tenantId: string;
  readonly preference: EndUserProfileAndPreferencesSelfServicePreference;
  readonly status: EndUserProfileAndPreferencesSelfServiceDispatchStatus;
}

export interface EndUserProfileAndPreferencesSelfServiceState {
  readonly tenantId: string;
  readonly userId: string;
  readonly profile: EndUserProfileAndPreferencesSelfServiceProfile;
  readonly preferences: readonly EndUserProfileAndPreferencesSelfServicePreference[];
  readonly dispatchLogs: readonly EndUserProfileAndPreferencesSelfServiceDispatchLog[];
  readonly readiness: EndUserProfileAndPreferencesSelfServiceReadiness;
}

export const initialProfile: EndUserProfileAndPreferencesSelfServiceProfile = {
  displayName: '',
  locale: 'en-US',
  timezone: 'UTC',
};

export const initialState = (
  tenantId: string,
  userId: string,
): EndUserProfileAndPreferencesSelfServiceState => ({
  tenantId,
  userId,
  profile: { ...initialProfile },
  preferences: [],
  dispatchLogs: [],
  readiness: 'READY',
});

export function validateProfile(
  profile: unknown,
): { readonly result: 'valid'; readonly profile: EndUserProfileAndPreferencesSelfServiceProfile } |
  { readonly result: 'invalid'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (
    profile === null ||
    typeof profile !== 'object' ||
    !('displayName' in profile) ||
    !('locale' in profile) ||
    !('timezone' in profile)
  ) {
    return {
      result: 'invalid',
      error: { kind: 'VALIDATION_ERROR', message: 'Invalid profile structure' },
    };
  }

  const p = profile as Record<string, unknown>;
  if (
    typeof p.displayName !== 'string' ||
    typeof p.locale !== 'string' ||
    typeof p.timezone !== 'string'
  ) {
    return {
      result: 'invalid',
      error: { kind: 'VALIDATION_ERROR', message: 'Invalid profile field types' },
    };
  }

  return {
    result: 'valid',
    profile: {
      displayName: p.displayName,
      locale: p.locale,
      timezone: p.timezone,
    },
  };
}

export function validatePreference(
  preference: unknown,
): { readonly result: 'valid'; readonly preference: EndUserProfileAndPreferencesSelfServicePreference } |
  { readonly result: 'invalid'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (
    preference === null ||
    typeof preference !== 'object' ||
    !('channel' in preference) ||
    !('category' in preference) ||
    !('enabled' in preference)
  ) {
    return {
      result: 'invalid',
      error: { kind: 'VALIDATION_ERROR', message: 'Invalid preference structure' },
    };
  }

  const pref = preference as Record<string, unknown>;
  if (
    typeof pref.channel !== 'string' ||
    typeof pref.category !== 'string' ||
    typeof pref.enabled !== 'boolean'
  ) {
    return {
      result: 'invalid',
      error: { kind: 'VALIDATION_ERROR', message: 'Invalid preference field types' },
    };
  }

  return {
    result: 'valid',
    preference: {
      channel: pref.channel,
      category: pref.category,
      enabled: pref.enabled,
    },
  };
}

export function validateNotificationPayload(
  payload: unknown,
): EndUserProfileAndPreferencesSelfServiceError | null {
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.includes('secret') || payloadStr.includes('password') || payloadStr.includes('token')) {
    return { kind: 'NOT_NOTIFIABLE', message: 'Payload contains secret-bearing data' };
  }
  return null;
}

export function auditProfileUpdate(
  tenantId: string,
  userId: string,
  profile: EndUserProfileAndPreferencesSelfServiceProfile,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): EndUserProfileAndPreferencesSelfServiceError | null {
  const event: EndUserProfileAndPreferencesSelfServiceAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    userId,
    tenantId,
    timestamp: new Date().toISOString(),
    payload: { profile },
  };
  return auditFn(event);
}

export function auditPreferenceUpdate(
  tenantId: string,
  userId: string,
  preference: EndUserProfileAndPreferencesSelfServicePreference,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): EndUserProfileAndPreferencesSelfServiceError | null {
  const event: EndUserProfileAndPreferencesSelfServiceAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    userId,
    tenantId,
    timestamp: new Date().toISOString(),
    payload: { preference },
  };
  return auditFn(event);
}

export function auditNotificationTest(
  tenantId: string,
  userId: string,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): EndUserProfileAndPreferencesSelfServiceError | null {
  const event: EndUserProfileAndPreferencesSelfServiceAuditEvent = {
    kind: 'NOTIFICATION_TESTED',
    userId,
    tenantId,
    timestamp: new Date().toISOString(),
    payload: null,
  };
  return auditFn(event);
}

export function readProfile(
  state: EndUserProfileAndPreferencesSelfServiceState,
  userId: string,
  tenantId: string,
  permission: EndUserProfileAndPreferencesSelfServicePermission,
): { readonly result: 'success'; readonly profile: EndUserProfileAndPreferencesSelfServiceProfile } |
  { readonly result: 'error'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (permission !== 'SELF_READ') {
    return {
      result: 'error',
      error: { kind: 'VALIDATION_ERROR', message: 'Insufficient permissions' },
    };
  }

  if (state.userId !== userId || state.tenantId !== tenantId) {
    return {
      result: 'error',
      error: { kind: 'NO_TENANT', message: 'No tenant or user mismatch' },
    };
  }

  return {
    result: 'success',
    profile: state.profile,
  };
}

export function readPreferences(
  state: EndUserProfileAndPreferencesSelfServiceState,
  userId: string,
  tenantId: string,
  permission: EndUserProfileAndPreferencesSelfServicePermission,
): { readonly result: 'success'; readonly preferences: readonly EndUserProfileAndPreferencesSelfServicePreference[] } |
  { readonly result: 'error'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (permission !== 'SELF_READ') {
    return {
      result: 'error',
      error: { kind: 'VALIDATION_ERROR', message: 'Insufficient permissions' },
    };
  }

  if (state.userId !== userId || state.tenantId !== tenantId) {
    return {
      result: 'error',
      error: { kind: 'NO_TENANT', message: 'No tenant or user mismatch' },
    };
  }

  return {
    result: 'success',
    preferences: state.preferences,
  };
}

export function updateProfile(
  state: EndUserProfileAndPreferencesSelfServiceState,
  userId: string,
  tenantId: string,
  newProfile: unknown,
  permission: EndUserProfileAndPreferencesSelfServicePermission,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): { readonly result: 'success'; readonly state: EndUserProfileAndPreferencesSelfServiceState } |
  { readonly result: 'error'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (permission !== 'SELF_UPDATE') {
    return {
      result: 'error',
      error: { kind: 'VALIDATION_ERROR', message: 'Insufficient permissions' },
    };
  }

  if (state.userId !== userId || state.tenantId !== tenantId) {
    return {
      result: 'error',
      error: { kind: 'NO_TENANT', message: 'No tenant or user mismatch' },
    };
  }

  if (state.readiness === 'DEGRADED') {
    return {
      result: 'error',
      error: { kind: 'DEGRADED', message: 'Service in degraded mode' },
    };
  }

  const validation = validateProfile(newProfile);
  if (validation.result === 'invalid') {
    return {
      result: 'error',
      error: validation.error,
    };
  }

  const auditError = auditProfileUpdate(tenantId, userId, validation.profile, auditFn);
  if (auditError !== null) {
    return {
      result: 'error',
      error: auditError,
    };
  }

  const updatedState: EndUserProfileAndPreferencesSelfServiceState = {
    ...state,
    profile: validation.profile,
  };

  return {
    result: 'success',
    state: updatedState,
  };
}

export function updatePreference(
  state: EndUserProfileAndPreferencesSelfServiceState,
  userId: string,
  tenantId: string,
  newPreference: unknown,
  permission: EndUserProfileAndPreferencesSelfServicePermission,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): { readonly result: 'success'; readonly state: EndUserProfileAndPreferencesSelfServiceState } |
  { readonly result: 'error'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (permission !== 'SELF_UPDATE') {
    return {
      result: 'error',
      error: { kind: 'VALIDATION_ERROR', message: 'Insufficient permissions' },
    };
  }

  if (state.userId !== userId || state.tenantId !== tenantId) {
    return {
      result: 'error',
      error: { kind: 'NO_TENANT', message: 'No tenant or user mismatch' },
    };
  }

  if (state.readiness === 'DEGRADED') {
    return {
      result: 'error',
      error: { kind: 'DEGRADED', message: 'Service in degraded mode' },
    };
  }

  const validation = validatePreference(newPreference);
  if (validation.result === 'invalid') {
    return {
      result: 'error',
      error: validation.error,
    };
  }

  const auditError = auditPreferenceUpdate(tenantId, userId, validation.preference, auditFn);
  if (auditError !== null) {
    return {
      result: 'error',
      error: auditError,
    };
  }

  const existingIndex = state.preferences.findIndex(
    (p) => p.channel === validation.preference.channel && p.category === validation.preference.category,
  );

  const updatedPreferences = [...state.preferences];
  if (existingIndex >= 0) {
    updatedPreferences[existingIndex] = validation.preference;
  } else {
    updatedPreferences.push(validation.preference);
  }

  const updatedState: EndUserProfileAndPreferencesSelfServiceState = {
    ...state,
    preferences: updatedPreferences,
  };

  return {
    result: 'success',
    state: updatedState,
  };
}

export function testNotification(
  state: EndUserProfileAndPreferencesSelfServiceState,
  userId: string,
  tenantId: string,
  payload: unknown,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): { readonly result: 'success' } |
  { readonly result: 'error'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (state.userId !== userId || state.tenantId !== tenantId) {
    return {
      result: 'error',
      error: { kind: 'NO_TENANT', message: 'No tenant or user mismatch' },
    };
  }

  const secretError = validateNotificationPayload(payload);
  if (secretError !== null) {
    return {
      result: 'error',
      error: secretError,
    };
  }

  const auditError = auditNotificationTest(tenantId, userId, auditFn);
  if (auditError !== null) {
    return {
      result: 'error',
      error: auditError,
    };
  }

  return {
    result: 'success',
  };
}

export function checkReadiness(
  state: EndUserProfileAndPreferencesSelfServiceState,
): EndUserProfileAndPreferencesSelfServiceReadiness {
  return state.readiness;
}