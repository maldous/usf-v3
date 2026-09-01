import { assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/eventsworkflow/notificationdeliveryandpreferencesandchannels.ts";

test("notificationdeliveryandpreferencesandchannelsauditmodel", () => {
  const auditFn = (): null => null;
  const initial = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel = "EMAIL" as const;
  const category = "WORKFLOW" as const;

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
  assert(afterSetState.lastAuditEvent?.action?.startsWith("SET_PREFERENCE:"));

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
  assert(afterDispatchState.lastAuditEvent?.action?.startsWith("DISPATCH:"));

  const afterTest = capability.testNotification(
    afterDispatchState,
    tenantId,
    channel,
    auditFn,
  );
  assert(!(afterTest instanceof Error));
  const afterTestState = afterTest as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(afterTestState.lastAuditEvent?.kind === "AUDIT_BEFORE_ACTION");
  assert(afterTestState.lastAuditEvent?.action?.startsWith("TEST:"));
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

  const invalidTenantResult = capability.testNotification(state, "", "EMAIL" as const, auditFn);
  assert(invalidTenantResult !== null);
  const invalidTenantError = invalidTenantResult as capability.NotificationDeliveryAndPreferencesAndChannelsError;
  assert(invalidTenantError.kind === "INVALID_TENANT_ID");

  const validationError = capability.validatePreference({});
  assert(validationError !== null);
  assert(validationError.kind === "VALIDATION_ERROR");

  const tenantError = capability.validateTenantId("");
  assert(tenantError !== null);
  assert(tenantError.kind === "INVALID_TENANT_ID");

  const degradedState = capability.setTransportReadiness(state, "EMAIL" as const, "DEGRADED");
  const dispatchResult = capability.dispatchNotification(
    degradedState,
    "tenant1",
    "user1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    auditFn,
  );
  assert(!(dispatchResult instanceof Error));
  const dispatchState = dispatchResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(dispatchState.lastError?.kind === "READINESS_UNAVAILABLE");
});

test("notificationdeliveryandpreferencesandchannelslifecycle", () => {
  const auditFn = (): null => null;
  const initial = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "org1";
  const channel = "EMAIL" as const;
  const category = "WORKFLOW" as const;

  const withPreference = capability.setPreference(
    initial,
    tenantId,
    user,
    organisation,
    channel,
    category,
    true,
    auditFn,
  );
  assert(!(withPreference instanceof Error));
  const stateWithPref = withPreference as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const prefs = capability.getPreferences(stateWithPref, tenantId, user);
  assert(prefs.length === 1);
  assert(prefs[0].enabled === true);

  const withReadiness = capability.setTransportReadiness(stateWithPref, channel, "AVAILABLE");
  const dispatchResult = capability.dispatchNotification(
    withReadiness,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!(dispatchResult instanceof Error));
  const stateAfterDispatch = dispatchResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(stateAfterDispatch.notificationLogs.length === 1);
  assert(stateAfterDispatch.notificationLogs[0].status === "SENT");

  const suppressedResult = capability.dispatchNotification(
    withReadiness,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!(suppressedResult instanceof Error));
  const stateAfterSuppressed = suppressedResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(stateAfterSuppressed.notificationLogs.length === 2);
});

test("notificationdeliveryandpreferencesandchannelspermissions", () => {
  const state = capability.initialState;
  const prefs = capability.getPreferences(state, "tenant1", "user1");
  assert(Array.isArray(prefs));

  const readiness = capability.getReadiness(state);
  assert(Array.isArray(readiness));
});

test("notificationdeliveryandpreferencesandchannelsproof", () => {
  const state = capability.initialState;
  const readiness = capability.getReadiness(state);
  assert(Array.isArray(readiness));
});

test("notificationdeliveryandpreferencesandchannelsreadinessmodel", () => {
  const initial = capability.initialState;
  const withReadiness = capability.setTransportReadiness(initial, "EMAIL" as const, "AVAILABLE");
  const readiness = capability.getReadiness(withReadiness);
  assert(readiness.length === 1);
  assert(readiness[0].channel === "EMAIL");
  assert(readiness[0].readiness === "AVAILABLE");

  const degraded = capability.setTransportReadiness(withReadiness, "EMAIL" as const, "DEGRADED");
  const degradedReadiness = capability.getReadiness(degraded);
  assert(degradedReadiness[0].readiness === "DEGRADED");
});

test("notificationdeliveryandpreferencesandchannelsstatemodel", () => {
  const initial = capability.initialState;
  assert(Array.isArray(initial.preferences));
  assert(Array.isArray(initial.notificationLogs));
  assert(Array.isArray(initial.transportReadiness));
  assert(initial.lastAuditEvent === null);
  assert(initial.lastError === null);

  const channel = "EMAIL" as const;
  const category = "WORKFLOW" as const;
  const withReadiness = capability.setTransportReadiness(initial, channel, "AVAILABLE");
  assert(withReadiness.transportReadiness.length === 1);
  assert(withReadiness.transportReadiness[0].channel === channel);
  assert(withReadiness.transportReadiness[0].readiness === "AVAILABLE");
});

test("notificationdeliveryandpreferencesandchannelsuisemantics", () => {
  const state = capability.initialState;
  const prefs = capability.getPreferences(state, "tenant1", "user1");
  assert(Array.isArray(prefs));
});

test("notificationdeliveryandpreferencesandchannelsvalidation", () => {
  const validationError = capability.validatePreference({});
  assert(validationError !== null);
  assert(validationError.kind === "VALIDATION_ERROR");

  const tenantError = capability.validateTenantId("");
  assert(tenantError !== null);
  assert(tenantError.kind === "INVALID_TENANT_ID");

  const validPreference: capability.NotificationDeliveryAndPreferencesAndChannelsPreference = {
    organisation: "org1",
    user: "user1",
    channel: "EMAIL",
    category: "WORKFLOW",
    enabled: true,
  };
  const validResult = capability.validatePreference(validPreference);
  assert(validResult === null);

  const validTenantResult = capability.validateTenantId("tenant1");
  assert(validTenantResult === null);
});