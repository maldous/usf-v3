import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/eventsworkflow/eventbusdurablequeuesdlqredrive.ts";

test("eventbusdurablequeuesdlqredriveauditmodel", () => {
  const state: capability.EventBusState = {
    ...capability.initialState,
    deadLetters: [
      {
        organisationId: "org_1",
        eventType: "test.event",
        idempotencyKey: "key_1",
        payloadSummary: "{}",
        attempts: 3,
        lastError: "failed",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const auditRecords: capability.RedriveAuditEvent[] = [];
  const auditFn = (event: capability.RedriveAuditEvent): capability.EventError | null => {
    auditRecords.push(event);
    return null;
  };

  const result = capability.redriveEvent(state, "org_1", "key_1", auditFn);
  assert.equal(result.kind, "SUCCESS");
  assert.equal(auditRecords.length, 1);
  assert.equal(auditRecords[0].kind, "REDRIVEN");
  assert.equal(auditRecords[0].organisationId, "org_1");
  assert.equal(auditRecords[0].eventId, "key_1");
});

test("eventbusdurablequeuesdlqredriveerrormodel", () => {
  const state: capability.EventBusState = capability.initialState;

  const res1 = capability.publishEvent(state, null, "type", "key", {}, 3);
  assert.equal(res1.kind, "ERROR");
  assert.equal(res1.error?.kind, "MISSING_ORGANISATION_ID");

  const res2 = capability.redriveEvent(state, "org_1", "nonexistent", () => null);
  assert.equal(res2.kind, "ERROR");
  assert.equal(res2.error?.kind, "INVALID_REDRIVE_ID");

  const offlineState: capability.EventBusState = { ...state, postgresAvailable: false };
  const res3 = capability.publishEvent(offlineState, "org_1", "type", "key", {}, 3);
  assert.equal(res3.kind, "ERROR");
  assert.equal(res3.error?.kind, "POSTGRES_UNAVAILABLE");
});

test("eventbusdurablequeuesdlqredrivelifecycle", () => {
  const state: capability.EventBusState = capability.initialState;
  
  const pub = capability.publishEvent(state, "org_1", "type", "key_1", { val: 1 }, 1);
  assert.equal(pub.kind, "SUCCESS");
  const event = pub.event!;
  
  const stateWithEvent: capability.EventBusState = { ...state, events: [event] };
  const procResult = capability.processEvent(stateWithEvent, "org_1", "key_1", "worker_1");
  assert.strictEqual(typeof procResult, "object");
  assert.ok("events" in procResult);
  const stateProcessing = procResult as capability.EventBusState;
  assert.equal(stateProcessing.events[0].status, "processing");

  const failResult = capability.failEvent(stateProcessing, "org_1", "key_1", "err");
  assert.strictEqual(typeof failResult, "object");
  assert.ok("deadLetters" in failResult);
  const stateDLQ = failResult as capability.EventBusState;
  assert.equal(stateDLQ.deadLetters.length, 1);

  const redriveRes = capability.redriveEvent(stateDLQ, "org_1", "key_1", () => null);
  assert.equal(redriveRes.kind, "SUCCESS");
  assert.equal(redriveRes.newEvent?.status, "pending");
  assert.ok(redriveRes.newEvent!.idempotencyKey.includes("redrive"));
});

test("eventbusdurablequeuesdlqredrivepermissions", () => {
  const userPerms: readonly capability.Permission[] = [capability.Permission.EVENTS_READ];
  
  assert.equal(capability.checkPermission(capability.Permission.EVENTS_READ, userPerms), true);
  assert.equal(capability.checkPermission(capability.Permission.EVENTS_WRITE, userPerms), false);
  assert.equal(capability.checkPermission(capability.Permission.WORKERS_READ, userPerms), false);
});

test("eventbusdurablequeuesdlqredriveproof", () => {
  const state: capability.EventBusState = capability.initialState;
  const secretPayload = { api_key: "secret123" };
  const result = capability.publishEvent(state, "org_1", "type", "key", secretPayload, 3);
  assert.equal(result.kind, "ERROR");
  assert.equal(result.error?.kind, "SECRET_PAYLOAD");
});

test("eventbusdurablequeuesdlqredrivereadinessmodel", () => {
  const state: capability.EventBusState = {
    ...capability.initialState,
    postgresAvailable: false,
    workerHeartbeats: [{ workerId: "w1", liveness: "stale", lastSeenAt: "..." }]
  };
  const readiness = capability.checkReadiness(state);
  assert.equal(readiness.postgresAvailable, false);
  assert.equal(readiness.workerHeartbeats[0].liveness, "stale");
});

test("eventbusdurablequeuesdlqredrivestatemodel", () => {
  const state: capability.EventBusState = {
    ...capability.initialState,
    deadLetters: [{
      organisationId: "org_1",
      eventType: "type",
      idempotencyKey: "key",
      payloadSummary: "sum",
      attempts: 1,
      lastError: "err",
      createdAt: "now"
    }]
  };
  const dlq = capability.listDeadLetters(state, "org_1");
  assert.equal(dlq.kind, "SUCCESS");
  assert.equal(dlq.deadLetters?.length, 1);
  assert.equal(dlq.deadLetters?.[0].payloadSummary, "sum");
});

test("eventbusdurablequeuesdlqredrivevalidation", () => {
  const state: capability.EventBusState = capability.initialState;
  
  const pub1 = capability.publishEvent(state, "org_1", "type", "key", {}, 3);
  const state1: capability.EventBusState = { ...state, events: [pub1.event!] };
  const pub2 = capability.publishEvent(state1, "org_1", "type", "key", {}, 3);
  assert.equal(pub2.kind, "ERROR");
  assert.equal(pub2.error?.kind, "DUPLICATE_EVENT");

  const listFail = capability.listEvents(state, null);
  assert.equal(listFail.kind, "ERROR");
  assert.equal(listFail.error?.kind, "MISSING_ORGANISATION_ID");
});