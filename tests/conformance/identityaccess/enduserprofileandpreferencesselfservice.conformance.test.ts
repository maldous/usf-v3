import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/enduserprofileandpreferencesselfservice.ts";

test("enduserprofileandpreferencesselfserviceauditmodel", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditEvents: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent[] = [];
  const auditFn = (event: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => {
    auditEvents.push(event);
    return null;
  };

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const profileUpdateResult = capability.updateProfile(state, userId, tenantId, profile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(profileUpdateResult.result, "success");
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "AUDIT_BEFORE_CHANGE");

  auditEvents.length = 0;
  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const preferenceUpdateResult = capability.updatePreference(state, userId, tenantId, preference, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(preferenceUpdateResult.result, "success");
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "AUDIT_BEFORE_CHANGE");

  auditEvents.length = 0;
  const payload = { message: "test" };
  const notificationResult = capability.testNotification(state, userId, tenantId, payload, auditFn);
  assert.strictEqual(notificationResult.result, "success");
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "NOTIFICATION_TESTED");
});

test("enduserprofileandpreferencesselfservicecontracts", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const readProfileResult = capability.readProfile(state, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readProfileResult.result, "success");
  assert.deepStrictEqual(readProfileResult.profile, capability.initialProfile);

  const readPreferencesResult = capability.readPreferences(state, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readPreferencesResult.result, "success");
  assert.deepStrictEqual(readPreferencesResult.preferences, []);

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState.result, "success");
  assert.deepStrictEqual(updatedState.state.profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(state, userId, tenantId, preference, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState2.result, "success");
  assert.deepStrictEqual(updatedState2.state.preferences, [preference]);

  const notificationResult = capability.testNotification(state, userId, tenantId, { message: "test" }, auditFn);
  assert.strictEqual(notificationResult.result, "success");
});

test("enduserprofileandpreferencesselfserviceerrormodel", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const invalidProfile = { displayName: 123, locale: "en-US", timezone: "UTC" };
  const profileResult = capability.updateProfile(state, userId, tenantId, invalidProfile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(profileResult.result, "error");
  assert.deepStrictEqual(profileResult.error, {
    kind: "VALIDATION_ERROR",
    message: "Invalid profile field types",
  });

  const noTenantResult = capability.updateProfile(state, "u2", "t2", capability.initialProfile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(noTenantResult.result, "error");
  assert.deepStrictEqual(noTenantResult.error, {
    kind: "NO_TENANT",
    message: "No tenant or user mismatch",
  });

  const secretPayload = { token: "secret" };
  const notificationResult = capability.testNotification(state, userId, tenantId, secretPayload, auditFn);
  assert.strictEqual(notificationResult.result, "error");
  assert.deepStrictEqual(notificationResult.error, {
    kind: "NOT_NOTIFIABLE",
    message: "Payload contains secret-bearing data",
  });

  const degradedState: capability.EndUserProfileAndPreferencesSelfServiceState = {
    ...state,
    readiness: "DEGRADED",
  };
  const degradedResult = capability.updateProfile(degradedState, userId, tenantId, capability.initialProfile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(degradedResult.result, "error");
  assert.deepStrictEqual(degradedResult.error, {
    kind: "DEGRADED",
    message: "Service in degraded mode",
  });
});

test("enduserprofileandpreferencesselfservicelifecycle", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState.result, "success");
  assert.deepStrictEqual(updatedState.state.profile, profile);

  const readProfileResult = capability.readProfile(updatedState.state, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readProfileResult.result, "success");
  assert.deepStrictEqual(readProfileResult.profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(updatedState.state, userId, tenantId, preference, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState2.result, "success");
  assert.deepStrictEqual(updatedState2.state.preferences, [preference]);

  const readPreferencesResult = capability.readPreferences(updatedState2.state, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readPreferencesResult.result, "success");
  assert.deepStrictEqual(readPreferencesResult.preferences, [preference]);

  const disabledPreference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: false,
  };
  const updatedState3 = capability.updatePreference(updatedState2.state, userId, tenantId, disabledPreference, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState3.result, "success");
  assert.deepStrictEqual(updatedState3.state.preferences, [disabledPreference]);
});

test("enduserprofileandpreferencesselfservicepermissions", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const readProfileResult = capability.readProfile(state, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readProfileResult.result, "success");

  const readProfileResultWrongUser = capability.readProfile(state, "u2", tenantId, "SELF_READ" as const);
  assert.strictEqual(readProfileResultWrongUser.result, "error");
  assert.strictEqual(readProfileResultWrongUser.error.kind, "NO_TENANT");

  const updateProfileResult = capability.updateProfile(state, userId, tenantId, capability.initialProfile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updateProfileResult.result, "success");

  const updateProfileResultWrongUser = capability.updateProfile(state, "u2", tenantId, capability.initialProfile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updateProfileResultWrongUser.result, "error");
  assert.strictEqual(updateProfileResultWrongUser.error.kind, "NO_TENANT");

  const updateProfileResultWrongPermission = capability.updateProfile(state, userId, tenantId, capability.initialProfile, "SELF_READ" as const, auditFn);
  assert.strictEqual(updateProfileResultWrongPermission.result, "error");
  assert.strictEqual(updateProfileResultWrongPermission.error.kind, "VALIDATION_ERROR");
});

test("enduserprofileandpreferencesselfserviceproof", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState.result, "success");
  assert.deepStrictEqual(updatedState.state.profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(updatedState.state, userId, tenantId, preference, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState2.result, "success");
  assert.deepStrictEqual(updatedState2.state.preferences, [preference]);
});

test("enduserprofileandpreferencesselfservicereadinessmodel", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const readProfileResult = capability.readProfile(state, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readProfileResult.result, "success");

  const degradedState: capability.EndUserProfileAndPreferencesSelfServiceState = {
    ...state,
    readiness: "DEGRADED",
  };
  const degradedUpdateResult = capability.updateProfile(degradedState, userId, tenantId, capability.initialProfile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(degradedUpdateResult.result, "error");
  assert.strictEqual(degradedUpdateResult.error.kind, "DEGRADED");

  const readProfileResultDegraded = capability.readProfile(degradedState, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readProfileResultDegraded.result, "success");
});

test("enduserprofileandpreferencesselfservicestatemodel", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  assert.strictEqual(state.tenantId, tenantId);
  assert.strictEqual(state.userId, userId);
  assert.deepStrictEqual(state.profile, capability.initialProfile);
  assert.deepStrictEqual(state.preferences, []);
  assert.deepStrictEqual(state.dispatchLogs, []);

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const dispatchLog: capability.EndUserProfileAndPreferencesSelfServiceDispatchLog = {
    userId,
    tenantId,
    preference,
    status: "SENT",
  };
  const updatedState: capability.EndUserProfileAndPreferencesSelfServiceState = {
    ...state,
    profile,
    preferences: [preference],
    dispatchLogs: [dispatchLog],
  };
  assert.strictEqual(updatedState.profile.displayName, "Test User");
  assert.strictEqual(updatedState.profile.locale, "en-GB");
  assert.strictEqual(updatedState.profile.timezone, "Europe/London");
  assert.strictEqual(updatedState.preferences[0].channel, "email");
  assert.strictEqual(updatedState.preferences[0].category, "marketing");
  assert.strictEqual(updatedState.preferences[0].enabled, true);
  assert.strictEqual(updatedState.dispatchLogs[0].status, "SENT");
});

test("enduserprofileandpreferencesselfserviceuisemantics", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const readProfileResult = capability.readProfile(state, userId, tenantId, "SELF_READ" as const);
  assert.strictEqual(readProfileResult.result, "success");

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState.result, "success");
  assert.deepStrictEqual(updatedState.state.profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(updatedState.state, userId, tenantId, preference, "SELF_UPDATE" as const, auditFn);
  assert.strictEqual(updatedState2.result, "success");
  assert.deepStrictEqual(updatedState2.state.preferences, [preference]);
});