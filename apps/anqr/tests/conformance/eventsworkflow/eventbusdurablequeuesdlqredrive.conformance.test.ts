import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/eventsworkflow/eventbusdurablequeuesdlqredrive.ts";

test("eventbusdurablequeuesdlqredriveauditmodel", () => {
  const state: capability.CapabilityState = capability.initialState;
  const auditRecords: capability.RedriveAuditRecord[] = [];
  const auditFn = (record: capability.RedriveAuditRecord): capability.CapabilityError | null => {
    auditRecords.push(record);
    return null;
  };

  const deadLetterEvent: capability.PlatformEvent = {
    id: "evt_1",
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
    status: "dead_letter",
    attempts: 3,
    maxAttempts: 3,
    lastError: "Handler exhausted",
    payloadSummary: "keys: data, size: 15",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  };
  state.events = [deadLetterEvent];

  const request: capability.RedriveRequest = {
    organisationId: "org_1",
    eventId: "evt_1",
  };

  const result = capability.redriveEvent(state, request, auditFn);
  assert.equal(result.error, null);
  assert.notEqual(result.event, null);
  assert.equal(auditRecords.length, 1);
  assert.equal(auditRecords[0].kind, "REDRIVEN");
  assert.equal(auditRecords[0].eventId, deadLetterEvent.id);
  assert.equal(auditRecords[0].organisationId, deadLetterEvent.organisationId);
  assert.equal(auditRecords[0].previousStatus, "dead_letter");
  assert.ok(auditRecords[0].timestamp);
});

test("eventbusdurablequeuesdlqredriveerrormodel", () => {
  const state: capability.CapabilityState = capability.initialState;

  const publishRequest: capability.PublishRequest = {
    organisationId: "",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
  };
  const publishResult = capability.publishEvent(state, publishRequest);
  assert.equal(publishResult.event, null);
  assert.notEqual(publishResult.error, null);
  assert.equal(publishResult.error?.kind, "MISSING_ORGANISATION_ID");

  const redriveRequest: capability.RedriveRequest = {
    organisationId: "org_1",
    eventId: "",
  };
  const redriveResult = capability.redriveEvent(state, redriveRequest, () => null);
  assert.equal(redriveResult.event, null);
  assert.notEqual(redriveResult.error, null);
  assert.equal(redriveResult.error?.kind, "INVALID_REDRIVE_ID");

  const secretPayloadRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_2",
    payload: { password: "secret" },
  };
  const secretResult = capability.publishEvent(state, secretPayloadRequest);
  assert.equal(secretResult.event, null);
  assert.notEqual(secretResult.error, null);
  assert.equal(secretResult.error?.kind, "SECRET_PAYLOAD");
  assert.equal(secretResult.error?.organisationId, "org_1");
  assert.ok(!("payload" in (secretResult.error?.details ?? {})));
});

test("eventbusdurablequeuesdlqredrivelifecycle", () => {
  const state: capability.CapabilityState = capability.initialState;
  const auditFn = (): capability.CapabilityError | null => null;

  const publishRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
  };
  const publishResult = capability.publishEvent(state, publishRequest);
  assert.equal(publishResult.error, null);
  assert.notEqual(publishResult.event, null);
  assert.equal(publishResult.event?.status, "pending");

  let newState = capability.applyPublish(state, publishResult) as capability.CapabilityState;
  assert.equal(newState.events.length, 1);

  const deadLetterEvent: capability.PlatformEvent = {
    ...newState.events[0],
    status: "dead_letter",
    attempts: 3,
    lastError: "Handler exhausted",
  };
  newState.events = [deadLetterEvent];

  const redriveRequest: capability.RedriveRequest = {
    organisationId: "org_1",
    eventId: deadLetterEvent.id,
  };
  const redriveResult = capability.redriveEvent(newState, redriveRequest, auditFn);
  assert.equal(redriveResult.error, null);
  assert.notEqual(redriveResult.event, null);
  assert.equal(redriveResult.event?.status, "pending");
  assert.ok(redriveResult.event?.idempotencyKey.startsWith("redrive_"));
});

test("eventbusdurablequeuesdlqredrivepermissions", () => {
  const state: capability.CapabilityState = capability.initialState;
  const event: capability.PlatformEvent = {
    id: "evt_1",
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    payloadSummary: "keys: data, size: 15",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  };
  state.events = [event];

  const listRequest: capability.ListRequest = {
    organisationId: "org_1",
    token: { permissions: [] },
  };
  const listResult = capability.listEvents(state, listRequest);
  assert.equal(listResult.events, null);
  assert.notEqual(listResult.error, null);
  assert.equal(listResult.error?.kind, "PERMISSION_DENIED");

  const validListRequest: capability.ListRequest = {
    organisationId: "org_1",
    token: { permissions: [capability.Permission.EVENTS_READ] },
  };
  const validListResult = capability.listEvents(state, validListRequest);
  assert.equal(validListResult.error, null);
  assert.equal(validListResult.events?.length, 1);
});

test("eventbusdurablequeuesdlqredriveproof", () => {
  const state: capability.CapabilityState = capability.initialState;
  const publishRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
  };
  const publishResult = capability.publishEvent(state, publishRequest);
  assert.equal(publishResult.error, null);
  assert.notEqual(publishResult.event, null);

  const secretRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_2",
    payload: { secret: "value" },
  };
  const secretResult = capability.publishEvent(state, secretRequest);
  assert.notEqual(secretResult.error, null);
  assert.equal(secretResult.error?.kind, "SECRET_PAYLOAD");
});

test("eventbusdurablequeuesdlqredrivereadinessmodel", () => {
  const state: capability.CapabilityState = {
    ...capability.initialState,
    postgresAvailable: false,
  };
  const publishRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
  };
  const publishResult = capability.publishEvent(state, publishRequest);
  assert.equal(publishResult.event, null);
  assert.notEqual(publishResult.error, null);
  assert.equal(publishResult.error?.kind, "POSTGRES_UNAVAILABLE");
});

test("eventbusdurablequeuesdlqredrivestatemodel", () => {
  const state: capability.CapabilityState = capability.initialState;
  const publishRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
  };
  const publishResult = capability.publishEvent(state, publishRequest);
  assert.equal(publishResult.error, null);
  assert.notEqual(publishResult.event, null);
  const event = publishResult.event;
  assert.equal(event.organisationId, "org_1");
  assert.equal(event.eventType, "test.event");
  assert.equal(event.idempotencyKey, "key_1");
  assert.equal(event.status, "pending");
  assert.equal(event.attempts, 0);
  assert.equal(event.maxAttempts, 3);
  assert.equal(event.lastError, null);
  assert.ok(event.payloadSummary);
  assert.ok(event.createdAt);
  assert.ok(event.updatedAt);
});

test("eventbusdurablequeuesdlqredrivevalidation", () => {
  const state: capability.CapabilityState = capability.initialState;

  const secretRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { password: "secret" },
  };
  const secretResult = capability.publishEvent(state, secretRequest);
  assert.equal(secretResult.event, null);
  assert.notEqual(secretResult.error, null);
  assert.equal(secretResult.error?.kind, "SECRET_PAYLOAD");

  const duplicateRequest: capability.PublishRequest = {
    organisationId: "org_1",
    eventType: "test.event",
    idempotencyKey: "key_1",
    payload: { data: "value" },
  };
  const firstResult = capability.publishEvent(state, duplicateRequest);
  assert.equal(firstResult.error, null);
  assert.notEqual(firstResult.event, null);

  const newState = capability.applyPublish(state, firstResult) as capability.CapabilityState;
  const secondResult = capability.publishEvent(newState, duplicateRequest);
  assert.equal(secondResult.error, null);
  assert.notEqual(secondResult.event, null);
  assert.equal(secondResult.event?.id, firstResult.event?.id);

  const listRequest: capability.ListRequest = {
    organisationId: "",
    token: { permissions: [capability.Permission.EVENTS_READ] },
  };
  const listResult = capability.listEvents(state, listRequest);
  assert.equal(listResult.events, null);
  assert.notEqual(listResult.error, null);
  assert.equal(listResult.error?.kind, "MISSING_ORGANISATION_ID");

  const redriveRequest: capability.RedriveRequest = {
    organisationId: "org_1",
    eventId: "nonexistent",
  };
  const redriveResult = capability.redriveEvent(state, redriveRequest, () => null);
  assert.equal(redriveResult.event, null);
  assert.notEqual(redriveResult.error, null);
  assert.equal(redriveResult.error?.kind, "EVENT_NOT_FOUND");
});