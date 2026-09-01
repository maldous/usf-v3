```typescript
import { assert } from "node:assert/strict";
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
    "user1