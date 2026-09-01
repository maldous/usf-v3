```typescript
export const EndUserProfileAndPreferencesSelfServiceAuditEventKind = [
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
  readonly isDegraded: boolean;
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
  isDegraded: false,
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
  if (payloadStr && (payloadStr.includes('secret') || payloadStr.includes('password') || payloadStr.includes('token'))) {
    return { kind: 'NOT_NOTIFIABLE', message: 'Payload contains secret-bearing columns' };
  }
  return null;
}

export function emitAudit(
  kind: EndUserProfileAndPreferencesSelfServiceAuditEventKind,
  userId: string,
  tenantId: string,
  payload: unknown,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): EndUserProfileAndPreferencesSelfServiceError | null {
  const event: EndUserProfileAndPreferencesSelfServiceAuditEvent = {
    kind,
    userId,
    tenantId,
    timestamp: new Date().toISOString(),
    payload,
  };
  return auditFn(event);
}

export function readProfile(
  state: EndUserProfileAndPreferencesSelfServiceState,
  authenticatedUserId: string,
  authenticatedTenantId: string,
): { readonly result: 'success'; readonly profile: EndUserProfileAndPreferencesSelfServiceProfile } |
  { readonly result: 'error'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (state.tenantId !== authenticatedTenantId || state.userId !== authenticatedUserId) {
    return {
      result: 'error',
      error: { kind: 'NO_TENANT', message: 'Tenant or user mismatch' },
    };
  }

  return {
    result: 'success',
    profile: { ...state.profile },
  };
}

export function readPreferences(
  state: EndUserProfileAndPreferencesSelfServiceState,
  authenticatedUserId: string,
  authenticatedTenantId: string,
): { readonly result: 'success'; readonly preferences: readonly EndUserProfileAndPreferencesSelfServicePreference[] } |
  { readonly result: 'error'; readonly error: EndUserProfileAndPreferencesSelfServiceError } {
  if (state.tenantId !== authenticatedTenantId || state.userId !== authenticatedUserId) {
    return {
      result: 'error',
      error: { kind: 'NO_TENANT', message: 'Tenant or user mismatch' },
    };
  }

  return {
    result: 'success',
    preferences: [...state.preferences],
  };
}

export function updateProfile(
  state: EndUserProfileAndPreferencesSelfServiceState,
  authenticatedUserId: string,
  authenticatedTenantId: string,
  profile: unknown,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): EndUserProfileAndPreferencesSelfServiceState | EndUserProfileAndPreferencesSelfServiceError {
  if (state.tenantId !== authenticatedTenantId || state.userId !== authenticatedUserId) {
    return { kind: 'NO_TENANT', message: 'Tenant or user mismatch' };
  }

  if (state.isDegraded) {
    return { kind: 'DEGRADED', message: 'Degraded mode: writes disabled' };
  }

  const validation = validateProfile(profile);
  if (validation.result === 'invalid') {
    return validation.error;
  }

  const beforeChangeError = emitAudit(
    'PROFILE_UPDATED',
    authenticatedUserId,
    authenticatedTenantId,
    { oldProfile: state.profile, newProfile: validation.profile },
    auditFn,
  );
  if (beforeChangeError !== null) {
    return beforeChangeError;
  }

  return {
    ...state,
    profile: { ...validation.profile },
  };
}

export function updatePreference(
  state: EndUserProfileAndPreferencesSelfServiceState,
  authenticatedUserId: string,
  authenticatedTenantId: string,
  preference: unknown,
  auditFn: (event: EndUserProfileAndPreferencesSelfServiceAuditEvent) => EndUserProfileAndPreferencesSelfServiceError | null,
): EndUserProfileAndPreferencesSelfServiceState | EndUserProfileAndPreferencesSelfServiceError {
  if (state.tenantId !== authenticatedTenantId || state.userId !== authenticatedUserId) {
    return { kind: 'NO_TENANT', message: 'Tenant or user mismatch' };
  }

  if (state.isDegraded) {
    return { kind: 'DEGRADED', message: 'Degraded mode: writes disabled' };
  }

  const validation = validatePreference(preference);
  if (validation.result === 'invalid') {
    return validation.error;
  }

  const beforeChangeError = emitAudit(
    'PREFERENCE_UPDATED',
    authenticatedUserId,
    authenticatedTenantId,
    { oldPreferences: state.preferences, newPreference: validation.preference },
    auditFn,
  );
  if (beforeChangeError !== null) {
    return beforeChangeError;
  }

  const existingIndex = state.preferences.findIndex(
    (p) => p.channel === validation.preference.channel && p.category === validation.preference.category,
  );
  const newPreferences = [...state.preferences];
  if (existingIndex >= 0) {
    newPreferences[existingIndex] = { ...validation.preference };
  } else {
    newPreferences.push({ ...validation.preference });
  }

  return {
    ...state,
    preferences: newPreferences,
  };
}

export function testNotification(
  authenticatedUserId: string,
  authenticatedTenantId: