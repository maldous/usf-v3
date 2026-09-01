import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/eventsworkflow/notificationdeliveryandpreferencesandchannels.ts";

function auditFn(
  event: capability.NotificationDeliveryAndPreferencesAndChannelsAuditEvent,
): capability.NotificationDeliveryAndPreferencesAndChannelsError | null {
  return null;
}

test("notificationdeliveryandpreferencesandchannelsauditmodel", () => {
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
  assert(!("kind" in afterSet));
  const afterSetState = afterSet as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(afterSetState.lastAuditEvent?.kind, "AUDIT_BEFORE_CHANGE");
  assert(afterSetState.lastAuditEvent?.action.startsWith("SET_PREFERENCE:"));
  assert.strictEqual(afterSetState.lastAuditEvent?.tenantId, tenantId);
  assert.strictEqual(afterSetState.lastAuditEvent?.user, user);
  assert(!afterSetState.lastAuditEvent?.action.includes("payload"));

  const withReadiness = capability.setTransportReadiness(
    afterSetState,
    channel,
    "AVAILABLE",
  );
  const afterDispatch = capability.dispatchNotification(
    withReadiness,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!("kind" in afterDispatch));
  const afterDispatchState = afterDispatch as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(afterDispatchState.lastAuditEvent?.kind, "AUDIT_BEFORE_ACTION");
  assert(afterDispatchState.lastAuditEvent?.action.startsWith("DISPATCH:"));
  assert(!afterDispatchState.lastAuditEvent?.action.includes("payload"));

  const afterTest = capability.testNotification(
    afterDispatchState,
    tenantId,
    channel,
    auditFn,
  );
  assert(!("kind" in afterTest));
  const afterTestState = afterTest as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(afterTestState.lastAuditEvent?.kind, "AUDIT_BEFORE_ACTION");
  assert(afterTestState.lastAuditEvent?.action.startsWith("TEST:"));
  assert(!afterTestState.lastAuditEvent?.action.includes("payload"));

  const log = afterDispatchState.notificationLogs[0];
  assert(log !== undefined);
  assert(
    log.status === "SENT" ||
      log.status === "SUPPRESSED" ||
      log.status === "FAILED",
  );
});

test("notificationdeliveryandpreferencesandchannelscontracts", () => {
  const state = capability.initialState;
  const userPrefs = capability.getPreferences(state, "tenant1", "user1");
  assert.strictEqual(userPrefs.length, 0);

  const readiness = capability.getReadiness(state);
  assert.strictEqual(readiness.length, 0);

  const withPreference = capability.setPreference(
    state,
    "tenant1",
    "user1",
    "tenant1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    true,
    auditFn,
  );
  assert(!("kind" in withPreference));
  const stateWithPref = withPreference as capability.NotificationDeliveryAndPreferencesAndChannelsState;

  const ready = capability.setTransportReadiness(
    stateWithPref,
    "EMAIL" as const,
    "AVAILABLE",
  );
  const readyPrefs = capability.getPreferences(ready, "tenant1", "user1");
  assert.strictEqual(readyPrefs.length, 1);

  const testResult = capability.testNotification(ready, "tenant1", "EMAIL" as const, auditFn);
  assert(!("kind" in testResult));
});

test("notificationdeliveryandpreferencesandchannelserrormodel", () => {
  const state = capability.initialState;

  const invalidTenantResult = capability.testNotification(
    state,
    "",
    "EMAIL" as const,
    auditFn,
  );
  assert("kind" in invalidTenantResult);
  const invalidTenantError = invalidTenantResult as capability.NotificationDeliveryAndPreferencesAndChannelsError;
  assert.strictEqual(invalidTenantError.kind, "INVALID_TENANT_ID");

  const validationError = capability.validatePreference({});
  assert(validationError !== null);
  assert.strictEqual(validationError.kind, "VALIDATION_ERROR");

  const tenantError = capability.validateTenantId("");
  assert(tenantError !== null);
  assert.strictEqual(tenantError.kind, "INVALID_TENANT_ID");

  const degradedState = capability.setTransportReadiness(
    state,
    "EMAIL" as const,
    "DEGRADED",
  );
  const disabled = capability.setPreference(
    degradedState,
    "tenant1",
    "user1",
    "tenant1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    true,
    auditFn,
  );
  assert(!("kind" in disabled));
  const disabledState = disabled as capability.NotificationDeliveryAndPreferencesAndChannelsState;

  const dispatchResult = capability.dispatchNotification(
    disabledState,
    "tenant1",
    "user1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    auditFn,
  );
  assert(!("kind" in dispatchResult));
  const dispatchState = dispatchResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert(dispatchState.lastError !== null);
  assert.strictEqual(dispatchState.lastError.kind, "READINESS_UNAVAILABLE");
  const lastLog = dispatchState.notificationLogs[0];
  assert(lastLog !== undefined);
  assert.strictEqual(lastLog.status, "FAILED");
});

test("notificationdeliveryandpreferencesandchannelslifecycle", () => {
  const initial = capability.initialState;
  const tenantId = "tenant1";
  const user = "user1";
  const organisation = "tenant1";
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
  assert(!("kind" in withPreference));
  const stateWithPref = withPreference as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const prefs = capability.getPreferences(stateWithPref, tenantId, user);
  assert.strictEqual(prefs.length, 1);
  assert.strictEqual(prefs[0].enabled, true);

  const withReadiness = capability.setTransportReadiness(
    stateWithPref,
    channel,
    "AVAILABLE",
  );

  const sentResult = capability.dispatchNotification(
    withReadiness,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!("kind" in sentResult));
  const sentState = sentResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(sentState.notificationLogs.length, 1);
  assert.strictEqual(sentState.notificationLogs[0].status, "SENT");

  const disabled = capability.setPreference(
    sentState,
    tenantId,
    user,
    organisation,
    channel,
    category,
    false,
    auditFn,
  );
  assert(!("kind" in disabled));
  const disabledState = disabled as capability.NotificationDeliveryAndPreferencesAndChannelsState;

  const suppressedResult = capability.dispatchNotification(
    disabledState,
    tenantId,
    user,
    channel,
    category,
    auditFn,
  );
  assert(!("kind" in suppressedResult));
  const suppressedState = suppressedResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(suppressedState.notificationLogs.length, 2);
  assert.strictEqual(suppressedState.notificationLogs[1].status, "SUPPRESSED");

  const unknownResult = capability.dispatchNotification(
    suppressedState,
    tenantId,
    user,
    "WEBHOOK" as const,
    "ALERT" as const,
    auditFn,
  );
  assert(!("kind" in unknownResult));
  const unknownState = unknownResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(unknownState.notificationLogs.length, 3);
  assert.strictEqual(unknownState.notificationLogs[2].status, "SUPPRESSED");
});

test("notificationdeliveryandpreferencesandchannelspermissions", () => {
  const state = capability.initialState;
  const userIdA = "userA";
  const userIdB = "userB";
  const tenantIdA = "tenantA";
  const tenantIdB = "tenantB";

  const setA = capability.setPreference(
    state,
    tenantIdA,
    userIdA,
    tenantIdA,
    "EMAIL" as const,
    "WORKFLOW" as const,
    true,
    auditFn,
  );
  assert(!("kind" in setA));
  const setB = capability.setPreference(
    setA,
    tenantIdB,
    userIdB,
    tenantIdB,
    "EMAIL" as const,
    "WORKFLOW" as const,
    true,
    auditFn,
  );
  assert(!("kind" in setB));
  const populated = setB as capability.NotificationDeliveryAndPreferencesAndChannelsState;

  const aPrefs = capability.getPreferences(populated, tenantIdA, userIdA);
  assert.strictEqual(aPrefs.length, 1);
  const bPrefs = capability.getPreferences(populated, tenantIdB, userIdB);
  assert.strictEqual(bPrefs.length, 1);

  const crossTenant = capability.getPreferences(populated, tenantIdA, userIdB);
  assert.strictEqual(crossTenant.length, 0);
  const crossUser = capability.getPreferences(populated, tenantIdB, userIdA);
  assert.strictEqual(crossUser.length, 0);

  const empty = capability.setTransportReadiness(populated, "EMAIL" as const, "AVAILABLE");
  const readiness = capability.getReadiness(empty);
  assert.strictEqual(readiness.length, 1);
});

test("notificationdeliveryandpreferencesandchannelsproof", () => {
  const state = capability.initialState;
  const readiness = capability.getReadiness(state);
  assert.strictEqual(readiness.length, 0);

  const withReadiness = capability.setTransportReadiness(
    state,
    "EMAIL" as const,
    "AVAILABLE",
  );
  assert.strictEqual(withReadiness.transportReadiness.length, 1);

  const noTenant = capability.testNotification(state, "", "EMAIL" as const, auditFn);
  assert("kind" in noTenant);

  const ok = capability.testNotification(
    withReadiness,
    "tenant1",
    "EMAIL" as const,
    auditFn,
  );
  assert(!("kind" in ok));
});

test("notificationdeliveryandpreferencesandchannelsreadinessmodel", () => {
  const initial = capability.initialState;

  const ready = capability.setTransportReadiness(initial, "EMAIL" as const, "AVAILABLE");
  const readyReadiness = capability.getReadiness(ready);
  assert.strictEqual(readyReadiness.length, 1);
  assert.strictEqual(readyReadiness[0].channel, "EMAIL");
  assert.strictEqual(readyReadiness[0].readiness, "AVAILABLE");

  const degraded = capability.setTransportReadiness(ready, "EMAIL" as const, "DEGRADED");
  const degradedReadiness = capability.getReadiness(degraded);
  assert.strictEqual(degradedReadiness[0].readiness, "DEGRADED");

  const unavailable = capability.setTransportReadiness(
    degraded,
    "WEBHOOK" as const,
    "UNAVAILABLE",
  );
  const allReadiness = capability.getReadiness(unavailable);
  assert.strictEqual(allReadiness.length, 2);

  const readyState = capability.setTransportReadiness(
    ready,
    "WEBHOOK" as const,
    "AVAILABLE",
  );
  const withPreference = capability.setPreference(
    readyState,
    "tenant1",
    "user1",
    "tenant1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    true,
    auditFn,
  );
  assert(!("kind" in withPreference));
  const prepped = withPreference as capability.NotificationDeliveryAndPreferencesAndChannelsState;

  const sendResult = capability.dispatchNotification(
    prepped,
    "tenant1",
    "user1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    auditFn,
  );
  assert(!("kind" in sendResult));
  const sendState = sendResult as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(sendState.notificationLogs[0].status, "SENT");
  assert.strictEqual(sendState.lastError, null);

  const degradedState = capability.setTransportReadiness(
    prepped,
    "EMAIL" as const,
    "DEGRADED",
  );
  const sendOnDegraded = capability.dispatchNotification(
    degradedState,
    "tenant1",
    "user1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    auditFn,
  );
  assert(!("kind" in sendOnDegraded));
  const degradedSendState = sendOnDegraded as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  assert.strictEqual(degradedSendState.notificationLogs[0].status, "FAILED");
  assert(degradedSendState.lastError !== null);
  assert.strictEqual(degradedSendState.lastError.kind, "READINESS_UNAVAILABLE");
});

test("notificationdeliveryandpreferencesandchannelsstatemodel", () => {
  const initial = capability.initialState;
  assert(Array.isArray(initial.preferences));
  assert.strictEqual(initial.preferences.length, 0);
  assert(Array.isArray(initial.notificationLogs));
  assert.strictEqual(initial.notificationLogs.length, 0);
  assert(Array.isArray(initial.transportReadiness));
  assert.strictEqual(initial.transportReadiness.length, 0);
  assert.strictEqual(initial.lastAuditEvent, null);
  assert.strictEqual(initial.lastError, null);

  const withPref = capability.setPreference(
    initial,
    "tenant1",
    "user1",
    "tenant1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    true,
    auditFn,
  );
  assert(!("kind" in withPref));
  const statePref = withPref as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const pref = statePref.preferences[0];
  assert(pref !== undefined);
  assert.strictEqual(pref.organisation, "tenant1");
  assert.strictEqual(pref.user, "user1");
  assert.strictEqual(pref.channel, "EMAIL");
  assert.strictEqual(pref.category, "WORKFLOW");
  assert.strictEqual(pref.enabled, true);

  const withReadiness = capability.setTransportReadiness(
    statePref,
    "EMAIL" as const,
    "AVAILABLE",
  );
  assert.strictEqual(withReadiness.transportReadiness.length, 1);
  assert.strictEqual(withReadiness.transportReadiness[0].channel, "EMAIL");
  assert.strictEqual(withReadiness.transportReadiness[0].readiness, "AVAILABLE");

  const dispatched = capability.dispatchNotification(
    withReadiness,
    "tenant1",
    "user1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    auditFn,
  );
  assert(!("kind" in dispatched));
  const dispatchedState = dispatched as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const log = dispatchedState.notificationLogs[0];
  assert(log !== undefined);
  assert.strictEqual(log.tenantId, "tenant1");
  assert.strictEqual(log.status, "SENT");
  assert.strictEqual(log.channel, "EMAIL");
  assert.strictEqual(log.category, "WORKFLOW");
  assert(typeof log.timestamp === "string");
  assert(dispatchedState.lastAuditEvent !== null);
});

test("notificationdeliveryandpreferencesandchannelsuisemantics", () => {
  const state = capability.initialState;
  const channel = "EMAIL" as const;
  const category = "WORKFLOW" as const;
  assert(
    capability.NotificationDeliveryAndPreferencesAndChannelsChannel.includes(
      channel,
    ),
  );
  assert(
    capability.NotificationDeliveryAndPreferencesAndChannelsCategory.includes(
      category,
    ),
  );

  const populated = capability.setPreference(
    state,
    "tenant1",
    "user1",
    "tenant1",
    channel,
    category,
    true,
    auditFn,
  );
  assert(!("kind" in populated));
  const populatedState = populated as capability.NotificationDeliveryAndPreferencesAndChannelsState;

  const readiness = capability.getReadiness(
    capability.setTransportReadiness(populatedState, channel, "AVAILABLE"),
  );
  assert.strictEqual(readiness.length, 1);

  const visiblePrefs = capability.getPreferences(
    populatedState,
    "tenant1",
    "user1",
  );
  assert.strictEqual(visiblePrefs.length, 1);
});

test("notificationdeliveryandpreferencesandchannelsvalidation", () => {
  const invalid = capability.validatePreference({});
  assert(invalid !== null);
  assert.strictEqual(invalid.kind, "VALIDATION_ERROR");

  const wrongTypes = capability.validatePreference({
    organisation: 1,
    user: "user1",
    channel: "EMAIL",
    category: "WORKFLOW",
    enabled: true,
  });
  assert(wrongTypes !== null);
  assert.strictEqual(wrongTypes.kind, "VALIDATION_ERROR");

  const badChannel = capability.validatePreference({
    organisation: "tenant1",
    user: "user1",
    channel: "CARRIER_PIGEON" as capability.NotificationDeliveryAndPreferencesAndChannelsChannel,
    category: "WORKFLOW",
    enabled: true,
  });
  assert(badChannel !== null);
  assert.strictEqual(badChannel.kind, "VALIDATION_ERROR");

  const tenantError = capability.validateTenantId("");
  assert(tenantError !== null);
  assert.strictEqual(tenantError.kind, "INVALID_TENANT_ID");

  const validPreference: capability.NotificationDeliveryAndPreferencesAndChannelsPreference = {
    organisation: "tenant1",
    user: "user1",
    channel: "EMAIL",
    category: "WORKFLOW",
    enabled: true,
  };
  const validResult = capability.validatePreference(validPreference);
  assert.strictEqual(validResult, null);

  const validTenantResult = capability.validateTenantId("tenant1");
  assert.strictEqual(validTenantResult, null);

  const state = capability.initialState;
  const disabled = capability.setPreference(
    state,
    "tenant1",
    "user1",
    "tenant1",
    "EMAIL" as const,
    "WORKFLOW" as const,
    false,
    auditFn,
  );
  assert(!("kind" in disabled));
  const disabledState = disabled as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const ready = capability.setTransportReadiness(
    disabledState,
    "EMAIL" as const,
    "AVAILABLE",
  );
  const missingRecipient = capability.dispatchNotification(
    ready,
    "tenant1",
    "ghostUser",
    "EMAIL" as const,
    "WORKFLOW" as const,
    auditFn,
  );
  assert(!("kind" in missingRecipient));
  const missingState = missingRecipient as capability.NotificationDeliveryAndPreferencesAndChannelsState;
  const log = missingState.notificationLogs[0];
  assert(log !== undefined);
  assert.strictEqual(log.status, "SUPPRESSED");
});