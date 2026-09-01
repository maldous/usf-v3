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
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, auditFn);
  assert.ok(updatedState !== null && typeof updatedState === "object" && "profile" in updatedState);
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[0].kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditEvents[1].kind, "PROFILE_UPDATED");

  auditEvents.length = 0;
  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(state, userId, tenantId, preference, auditFn);
  assert.ok(updatedState2 !== null && typeof updatedState2 === "object" && "preferences" in updatedState2);
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[0].kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditEvents[1].kind, "PREFERENCE_UPDATED");

  auditEvents.length = 0;
  const payload = { message: "test" };
  const result = capability.testNotification(userId, tenantId, payload, auditFn);
  assert.deepStrictEqual(result, { result: "success" });
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[0].kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditEvents[1].kind, "NOTIFICATION_TESTED");
});

test("enduserprofileandpreferencesselfservicecontracts", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const readProfileResult = capability.readProfile(state, userId, tenantId);
  assert.strictEqual(readProfileResult.result, "success");
  assert.deepStrictEqual(readProfileResult.profile, capability.initialProfile);

  const readPreferencesResult = capability.readPreferences(state, userId, tenantId);
  assert.strictEqual(readPreferencesResult.result, "success");
  assert.deepStrictEqual(readPreferencesResult.preferences, []);

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, auditFn);
  assert.ok(updatedState !== null && typeof updatedState === "object" && "profile" in updatedState);
  assert.deepStrictEqual((updatedState as capability.EndUserProfileAndPreferencesSelfServiceState).profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(state, userId, tenantId, preference, auditFn);
  assert.ok(updatedState2 !== null && typeof updatedState2 === "object" && "preferences" in updatedState2);
  assert.deepStrictEqual(
    (updatedState2 as capability.EndUserProfileAndPreferencesSelfServiceState).preferences,
    [preference]
  );

  const notificationResult = capability.testNotification(userId, tenantId, { message: "test" }, auditFn);
  assert.deepStrictEqual(notificationResult, { result: "success" });
});

test("enduserprofileandpreferencesselfserviceerrormodel", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const invalidProfile = { displayName: 123, locale: "en-US", timezone: "UTC" };
  const profileResult = capability.updateProfile(state, userId, tenantId, invalidProfile, auditFn);
  assert.deepStrictEqual(profileResult, {
    kind: "VALIDATION_ERROR",
    message: "Invalid profile field types",
  });

  const noTenantResult = capability.updateProfile(state, "u2", "t2", capability.initialProfile, auditFn);
  assert.deepStrictEqual(noTenantResult, {
    kind: "NO_TENANT",
    message: "Tenant or user mismatch",
  });

  const secretPayload = { token: "secret" };
  const notificationResult = capability.testNotification(userId, tenantId, secretPayload, auditFn);
  assert.deepStrictEqual(notificationResult, {
    kind: "NOT_NOTIFIABLE",
    message: "Payload contains secret-bearing columns",
  });

  const degradedState: capability.EndUserProfileAndPreferencesSelfServiceState = {
    ...state,
    isDegraded: true,
  };
  const degradedResult = capability.updateProfile(degradedState, userId, tenantId, capability.initialProfile, auditFn);
  assert.deepStrictEqual(degradedResult, {
    kind: "DEGRADED",
    message: "Degraded mode: writes disabled",
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
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, auditFn) as capability.EndUserProfileAndPreferencesSelfServiceState;
  assert.deepStrictEqual(updatedState.profile, profile);

  const readProfileResult = capability.readProfile(updatedState, userId, tenantId);
  assert.strictEqual(readProfileResult.result, "success");
  assert.deepStrictEqual(readProfileResult.profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(updatedState, userId, tenantId, preference, auditFn) as capability.EndUserProfileAndPreferencesSelfServiceState;
  assert.deepStrictEqual(updatedState2.preferences, [preference]);

  const readPreferencesResult = capability.readPreferences(updatedState2, userId, tenantId);
  assert.strictEqual(readPreferencesResult.result, "success");
  assert.deepStrictEqual(readPreferencesResult.preferences, [preference]);

  const dispatchedState = capability.dispatchNotifications(updatedState2);
  assert.strictEqual(dispatchedState.dispatchLogs.length, 1);
  assert.strictEqual(dispatchedState.dispatchLogs[0].status, "SENT");

  const disabledPreference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: false,
  };
  const updatedState3 = capability.updatePreference(updatedState2, userId, tenantId, disabledPreference, auditFn) as capability.EndUserProfileAndPreferencesSelfServiceState;
  const dispatchedState2 = capability.dispatchNotifications(updatedState3);
  assert.strictEqual(dispatchedState2.dispatchLogs.length, 2);
  assert.strictEqual(dispatchedState2.dispatchLogs[1].status, "SUPPRESSED");
});

test("enduserprofileandpreferencesselfservicepermissions", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const readProfileResult = capability.readProfile(state, userId, tenantId);
  assert.strictEqual(readProfileResult.result, "success");

  const readProfileResultWrongUser = capability.readProfile(state, "u2", tenantId);
  assert.strictEqual(readProfileResultWrongUser.result, "error");
  assert.strictEqual(readProfileResultWrongUser.error.kind, "NO_TENANT");

  const updateProfileResult = capability.updateProfile(state, userId, tenantId, capability.initialProfile, auditFn);
  assert.ok(updateProfileResult !== null && typeof updateProfileResult === "object" && "profile" in updateProfileResult);

  const updateProfileResultWrongUser = capability.updateProfile(state, "u2", tenantId, capability.initialProfile, auditFn);
  assert.deepStrictEqual(updateProfileResultWrongUser, {
    kind: "NO_TENANT",
    message: "Tenant or user mismatch",
  });
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
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, auditFn) as capability.EndUserProfileAndPreferencesSelfServiceState;
  assert.deepStrictEqual(updatedState.profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(updatedState, userId, tenantId, preference, auditFn) as capability.EndUserProfileAndPreferencesSelfServiceState;
  assert.deepStrictEqual(updatedState2.preferences, [preference]);

  const dispatchedState = capability.dispatchNotifications(updatedState2);
  assert.strictEqual(dispatchedState.dispatchLogs.length, 1);
  assert.strictEqual(dispatchedState.dispatchLogs[0].status, "SENT");
});

test("enduserprofileandpreferencesselfservicereadinessmodel", () => {
  const tenantId = "t1";
  const userId = "u1";
  const state = capability.initialState(tenantId, userId);
  const auditFn = (_: capability.EndUserProfileAndPreferencesSelfServiceAuditEvent): capability.EndUserProfileAndPreferencesSelfServiceError | null => null;

  const readProfileResult = capability.readProfile(state, userId, tenantId);
  assert.strictEqual(readProfileResult.result, "success");

  const degradedState: capability.EndUserProfileAndPreferencesSelfServiceState = {
    ...state,
    isDegraded: true,
  };
  const degradedUpdateResult = capability.updateProfile(degradedState, userId, tenantId, capability.initialProfile, auditFn);
  assert.deepStrictEqual(degradedUpdateResult, {
    kind: "DEGRADED",
    message: "Degraded mode: writes disabled",
  });

  const readProfileResultDegraded = capability.readProfile(degradedState, userId, tenantId);
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
  const updatedState = {
    ...state,
    profile,
    preferences: [preference],
    dispatchLogs: [
      {
        userId,
        tenantId,
        preference,
        status: "SENT" as const,
      },
    ],
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

  const readProfileResult = capability.readProfile(state, userId, tenantId);
  assert.strictEqual(readProfileResult.result, "success");

  const profile: capability.EndUserProfileAndPreferencesSelfServiceProfile = {
    displayName: "Test User",
    locale: "en-GB",
    timezone: "Europe/London",
  };
  const updatedState = capability.updateProfile(state, userId, tenantId, profile, auditFn) as capability.EndUserProfileAndPreferencesSelfServiceState;
  assert.deepStrictEqual(updatedState.profile, profile);

  const preference: capability.EndUserProfileAndPreferencesSelfServicePreference = {
    channel: "email",
    category: "marketing",
    enabled: true,
  };
  const updatedState2 = capability.updatePreference(updatedState, userId, tenantId, preference, auditFn) as capability.EndUserProfileAndPreferencesSelfServiceState;
  assert.deepStrictEqual(updatedState2.preferences, [preference]);
});