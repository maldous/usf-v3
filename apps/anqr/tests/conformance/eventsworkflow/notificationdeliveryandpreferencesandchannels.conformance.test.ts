import { assert } from "node:assert";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/eventsworkflow/notificationdeliveryandpreferencesandchannels.ts";

test("notificationdeliveryandpreferencesandchannelsauditmodel", () => {
  const auditFn = (): null => null;
  const initial = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";
  const category: capability.NotificationDeliveryAndPreferencesAndChannelsCategory = "WORKFLOW";

  const afterSet = capability.setPreference(
    initial,
    tenantId,
    user,
    organisation,
    channel,
    category,
    true,
    auditFn,
  );
  assert(!(afterSet instanceof Error));
  const afterSetState = afterSet as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(afterSetState.lastAuditEvent?.kind === "AUDIT_BEFORE_CHANGE");
  assert(afterSetState.lastAuditEvent?.action.startsWith("SET_PREFERENCE:"));

  const afterDispatch = capability.dispatchNotification(
    afterSetState,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!(afterDispatch instanceof Error));
  const afterDispatchState = afterDispatch as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(afterDispatchState.lastAuditEvent?.kind === "AUDIT_BEFORE_ACTION");
  assert(afterDispatchState.lastAuditEvent?.action.startsWith("DISPATCH:"));

  const afterTest = capability.testNotification(
    afterDispatchState,
    tenantId,
    channel,
    auditFn,
  );
  assert(!(afterTest instanceof Error));
  const afterTestState = afterTest as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(afterTestState.lastAuditEvent?.kind === "AUDIT_BEFORE_ACTION");
  assert(afterTestState.lastAuditEvent?.action.startsWith("TEST:"));

  const log = afterTestState.notificationLogs[0];
  assert(log.status === "SENT" || log.status === "SUPPRESSED" || log.status === "FAILED");
  assert(!("payload" in log));
});

test("notificationdeliveryandpreferencesandchannelscontracts", () => {
  const state = capability.initialState;
  const preferences = capability.getPreferences(state, "tenant1", "user1");
  assert(Array.isArray(preferences));
  const readiness = capability.getReadiness(state);
  assert(Array.isArray(readiness));
});

test("notificationdeliveryandpreferencesandchannelserrormodel", () => {
  const auditFn = (): null => null;
  const state = capability.initialState;

  const invalidTenantResult = capability.testNotification(state, "", "EMAIL", auditFn);
  assert(invalidTenantResult instanceof Object);
  const error = invalidTenantResult as capability.NotificationDeliveryAndPreferencesAndChannelsError;
  assert(error.kind === "INVALID_TENANT_ID");

  const validationError = capability.validatePreference({});
  assert(validationError !== null);
  assert(validationError.kind === "VALIDATION_ERROR");

  const tenantError = capability.validateTenantId("");
  assert(tenantError !== null);
  assert(tenantError.kind === "INVALID_TENANT_ID");

  const degradedState = capability.setTransportReadiness(state, "EMAIL", "DEGRADED");
  const dispatchResult = capability.dispatchNotification(
    degradedState,
    "tenant1",
    "user1",
    "EMAIL",
    "WORKFLOW",
    auditFn,
  );
  assert(!(dispatchResult instanceof Error));
  const dispatchState = dispatchResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(dispatchState.lastError?.kind === "READINESS_UNAVAILABLE");
});

test("notificationdeliveryandpreferencesandchannelslifecycle", () => {
  const auditFn = (): null => null;
  let state: capability.NotificationDeliveryAndPreferencesAndChannelsState | capability.NotificationDeliveryAndPreferencesAndChannelsError = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";
  const category: capability.NotificationDeliveryAndPreferencesAndChannelsCategory = "WORKFLOW";

  state = capability.setPreference(state, tenantId, user, organisation, channel, category, false, auditFn);
  assert(!(state instanceof Error));
  const prefs = capability.getPreferences(state as capability.NotificationDeliveryAndPreferencesAndChannelsState, tenantId, user);
  assert(prefs.length === 1);
  assert(prefs[0].enabled === false);

  state = capability.dispatchNotification(
    state as capability.NotificationDeliveryAndPreferencesAndChannelsState,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!(state instanceof Error));
  const logs = (state as capability.NotificationDeliveryAndPreferencesAndChannelsState).notificationLogs;
  assert(logs.length === 1);
  assert(logs[0].status === "SUPPRESSED");

  state = capability.setPreference(
    state as capability.NotificationDeliveryAndPreferencesAndChannelsState,
    tenantId,
    user,
    organisation,
    channel,
    category,
    true,
    auditFn,
  );
  state = capability.setTransportReadiness(
    state as capability.NotificationDeliveryAndPreferencesAndChannelsState,
    channel,
    "AVAILABLE",
  );
  state = capability.dispatchNotification(
    state as capability.NotificationDeliveryAndPreferencesAndChannelsState,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!(state instanceof Error));
  const finalLogs = (state as capability.NotificationDeliveryAndPreferencesAndChannelsState).notificationLogs;
  assert(finalLogs.length === 2);
  assert(finalLogs[1].status === "SENT");

  const readiness = capability.getReadiness(state as capability.NotificationDeliveryAndPreferencesAndChannelsState);
  assert(readiness.length === 1);
  assert(readiness[0].readiness === "AVAILABLE");
});

test("notificationdeliveryandpreferencesandchannelspermissions", () => {
  const auditFn = (): null => null;
  const state = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";
  const category: capability.NotificationDeliveryAndPreferencesAndChannelsCategory = "WORKFLOW";

  const setResult = capability.setPreference(state, tenantId, user, organisation, channel, category, true, auditFn);
  assert(!(setResult instanceof Error));
  const setState = setResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const prefs = capability.getPreferences(setState, tenantId, user);
  assert(prefs.length === 1);

  const otherPrefs = capability.getPreferences(setState, "otherTenant", "otherUser");
  assert(otherPrefs.length === 0);

  const readiness = capability.getReadiness(setState);
  assert(Array.isArray(readiness));

  const testResult = capability.testNotification(setState, tenantId, channel, auditFn);
  assert(!(testResult instanceof Error));
});

test("notificationdeliveryandpreferencesandchannelsproof", () => {
  const auditFn = (): null => null;
  let state: capability.NotificationDeliveryAndPreferencesAndChannelsState | capability.NotificationDeliveryAndPreferencesAndChannelsError = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";
  const category: capability.NotificationDeliveryAndPreferencesAndChannelsCategory = "WORKFLOW";

  state = capability.setPreference(state, tenantId, user, organisation, channel, category, true, auditFn);
  assert(!(state instanceof Error));

  state = capability.dispatchNotification(
    state as capability.NotificationDeliveryAndPreferencesAndChannelsState,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!(state instanceof Error));

  state = capability.testNotification(
    state as capability.NotificationDeliveryAndPreferencesAndChannelsState,
    tenantId,
    channel,
    auditFn,
  );
  assert(!(state instanceof Error));
});

test("notificationdeliveryandpreferencesandchannelsreadinessmodel", () => {
  let state = capability.initialState;
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";

  state = capability.setTransportReadiness(state, channel, "AVAILABLE");
  let readiness = capability.getReadiness(state);
  assert(readiness.length === 1);
  assert(readiness[0].readiness === "AVAILABLE");

  state = capability.setTransportReadiness(state, channel, "DEGRADED");
  readiness = capability.getReadiness(state);
  assert(readiness[0].readiness === "DEGRADED");

  state = capability.setTransportReadiness(state, channel, "UNAVAILABLE");
  readiness = capability.getReadiness(state);
  assert(readiness[0].readiness === "UNAVAILABLE");

  const auditFn = (): null => null;
  const dispatchResult = capability.dispatchNotification(state, "tenant1", "user1", channel, "WORKFLOW", auditFn);
  assert(!(dispatchResult instanceof Error));
  const dispatchState = dispatchResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(dispatchState.lastError?.kind === "READINESS_UNAVAILABLE");
});

test("notificationdeliveryandpreferencesandchannelsstatemodel", () => {
  const auditFn = (): null => null;
  let state: capability.NotificationDeliveryAndPreferencesAndChannelsState | capability.NotificationDeliveryAndPreferencesAndChannelsError = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";
  const category: capability.NotificationDeliveryAndPreferencesAndChannelsCategory = "WORKFLOW";

  state = capability.setPreference(state, tenantId, user, organisation, channel, category, true, auditFn);
  assert(!(state instanceof Error));
  const setState = state as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(setState.preferences.length === 1);
  assert(setState.preferences[0].organisation === organisation);
  assert(setState.preferences[0].user === user);
  assert(setState.preferences[0].channel === channel);
  assert(setState.preferences[0].category === category);
  assert(setState.preferences[0].enabled === true);

  state = capability.dispatchNotification(setState, tenantId, user, channel, category, auditFn);
  assert(!(state instanceof Error));
  const dispatchState = state as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(dispatchState.notificationLogs.length === 1);
  assert(dispatchState.notificationLogs[0].status === "SENT");

  state = capability.setTransportReadiness(dispatchState, channel, "AVAILABLE");
  const readinessState = state as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(readinessState.transportReadiness.length === 1);
  assert(readinessState.transportReadiness[0].channel === channel);
  assert(readinessState.transportReadiness[0].readiness === "AVAILABLE");
});

test("notificationdeliveryandpreferencesandchannelsuisemantics", () => {
  const auditFn = (): null => null;
  const state = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";
  const category: capability.NotificationDeliveryAndPreferencesAndChannelsCategory = "WORKFLOW";

  const setResult = capability.setPreference(state, tenantId, user, organisation, channel, category, true, auditFn);
  assert(!(setResult instanceof Error));
  const setState = setResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const prefs = capability.getPreferences(setState, tenantId, user);
  assert(prefs.length === 1);
});

test("notificationdeliveryandpreferencesandchannelsvalidation", () => {
  const auditFn = (): null => null;
  const state = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel: capability.NotificationDeliveryAndPreferencesAndChannelsChannel = "EMAIL";
  const category: capability.NotificationDeliveryAndPreferencesAndChannelsCategory = "WORKFLOW";

  const invalidPref = capability.validatePreference({});
  assert(invalidPref !== null);
  assert(invalidPref.kind === "VALIDATION_ERROR");

  const invalidTenant = capability.validateTenantId("");
  assert(invalidTenant !== null);
  assert(invalidTenant.kind === "INVALID_TENANT_ID");

  const setState = capability.setPreference(state, tenantId, user, organisation, channel, category, false, auditFn);
  assert(!(setState instanceof Error));
  const dispatchResult = capability.dispatchNotification(
    setState as capability.NotificationDeliveryAndPreferencesAndChannelsState,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!(dispatchResult instanceof Error));
  const dispatchState = dispatchResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(dispatchState.notificationLogs[0].status === "SUPPRESSED");

  const testResult = capability.testNotification(state, "", channel, auditFn);
  assert(testResult instanceof Object);
  const error = testResult as capability.NotificationDeliveryAndPreferencesAndChannelsError;
  assert(error.kind === "INVALID_TENANT_ID");
});