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
  if (payloadStr && (payloadStr.includes('secret') || payloadStr.includes('