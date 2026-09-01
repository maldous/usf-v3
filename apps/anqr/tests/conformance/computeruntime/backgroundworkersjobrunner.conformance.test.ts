import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/computeruntime/backgroundworkersjobrunner.ts";

test("backgroundworkersjobrunnerauditmodel", () => {
  const state = capability.initialWorkerState;
  const now = Date.now();
  const heartbeatState = capability.emitHeartbeat(state, 'worker-1', 'test-kind', now);
  assert.equal(heartbeatState.liveness, 'ALIVE');
  assert.equal(heartbeatState.workerId, 'worker-1');
  assert.equal(heartbeatState.workerKind, 'test-kind');
  assert.equal(heartbeatState.heartbeatTimestamp, now);
});

test("backgroundworkersjobrunnercontracts", () => {
  const state: capability.WorkerState = {
    workerId: 'worker-1',
    workerKind: 'test-kind',
    heartbeatTimestamp: Date.now(),
    liveness: 'ALIVE',
    claimedEventId: null,
    claimedEventStatus: null,
    retryCount: 0,
    isDeadLetter: false,
  };
  const permission = 'platform.workers.read';
  const response = capability.getWorkersAdminResponse(state, permission);
  assert.notEqual(response, null);
  if (response && 'workerId' in response) {
    assert.equal(response.workerId, 'worker-1');
    assert.equal(response.workerKind, 'test-kind');
    assert.equal(response.liveness, 'ALIVE');
  }
});

test("backgroundworkersjobrunnererrormodel", () => {
  const state = capability.initialWorkerState;
  const port: capability.JobRunnerPort = {
    claimPendingEvent: () => null,
    markEventProcessed: () => false,
    markEventDeadLetter: () => false,
    isEventProcessed: () => false,
    isPostgresAvailable: () => false,
  };
  const result = capability.claimEvent(state, port, Date.now());
  assert.deepEqual(result, { kind: 'POSTGRES_UNAVAILABLE', message: 'Postgres substrate is unavailable' });
});

test("backgroundworkersjobrunnerlifecycle", () => {
  const state = capability.initialWorkerState;
  const now = Date.now();
  const heartbeatState = capability.emitHeartbeat(state, 'worker-1', 'test-kind', now);
  assert.equal(heartbeatState.liveness, 'ALIVE');
  assert.equal(heartbeatState.workerId, 'worker-1');
  assert.equal(heartbeatState.workerKind, 'test-kind');
  assert.equal(heartbeatState.heartbeatTimestamp, now);
});

test("backgroundworkersjobrunnerpermissions", () => {
  const state: capability.WorkerState = {
    workerId: 'worker-1',
    workerKind: 'test-kind',
    heartbeatTimestamp: Date.now(),
    liveness: 'ALIVE',
    claimedEventId: null,
    claimedEventStatus: null,
    retryCount: 0,
    isDeadLetter: false,
  };
  const permission = 'invalid.permission';
  const response = capability.getWorkersAdminResponse(state, permission);
  assert.deepEqual(response, { kind: 'INVALID_WORKER_STATE', message: 'Permission denied' });
});

test("backgroundworkersjobrunnerproof", () => {
  const state: capability.WorkerState = {
    workerId: 'worker-1',
    workerKind: 'test-kind',
    heartbeatTimestamp: Date.now(),
    liveness: 'ALIVE',
    claimedEventId: 'event-1',
    claimedEventStatus: 'PROCESSED',
    retryCount: 0,
    isDeadLetter: false,
  };
  const port: capability.JobRunnerPort = {
    claimPendingEvent: () => null,
    markEventProcessed: () => true,
    markEventDeadLetter: () => true,
    isEventProcessed: () => true,
    isPostgresAvailable: () => true,
  };
  const registry: capability.HandlerRegistry = {
    processNext: () => true,
  };
  const result = capability.processEvent(state, port, registry, 3, Date.now());
  assert.notEqual(result, null);
  if (result && 'proof' in result) {
    assert.equal(result.proof.processProof, true);
    assert.equal(result.proof.heartbeatProof, true);
  }
});

test("backgroundworkersjobrunnerreadinessmodel", () => {
  const state: capability.WorkerState = {
    workerId: 'worker-1',
    workerKind: 'test-kind',
    heartbeatTimestamp: Date.now(),
    liveness: 'ALIVE',
    claimedEventId: null,
    claimedEventStatus: null,
    retryCount: 0,
    isDeadLetter: false,
  };
  const port: capability.JobRunnerPort = {
    claimPendingEvent: () => null,
    markEventProcessed: () => true,
    markEventDeadLetter: () => true,
    isEventProcessed: () => true,
    isPostgresAvailable: () => true,
  };
  const readiness = capability.computeReadiness(state, port);
  assert.equal(readiness.liveness, 'ALIVE');
  assert.equal(readiness.isDegraded, false);
  assert.notEqual(readiness.proof, null);
});

test("backgroundworkersjobrunnerstatemodel", () => {
  const state = capability.initialWorkerState;
  const now = Date.now();
  const heartbeatState = capability.emitHeartbeat(state, 'worker-1', 'test-kind', now);
  assert.equal(heartbeatState.liveness, 'ALIVE');
  assert.equal(heartbeatState.workerId, 'worker-1');
  assert.equal(heartbeatState.workerKind, 'test-kind');
  assert.equal(heartbeatState.heartbeatTimestamp, now);
  assert.equal(heartbeatState.claimedEventId, null);
  assert.equal(heartbeatState.claimedEventStatus, null);
  assert.equal(heartbeatState.retryCount, 0);
  assert.equal(heartbeatState.isDeadLetter, false);
});

test("backgroundworkersjobrunnervalidation", () => {
  const state: capability.WorkerState = {
    workerId: 'worker-1',
    workerKind: 'test-kind',
    heartbeatTimestamp: Date.now(),
    liveness: 'ALIVE',
    claimedEventId: null,
    claimedEventStatus: null,
    retryCount: 0,
    isDeadLetter: false,
  };
  const port: capability.JobRunnerPort = {
    claimPendingEvent: () => ({ eventId: 'event-1', status: 'PENDING', attemptCount: 0, tenantContext: {} }),
    markEventProcessed: () => true,
    markEventDeadLetter: () => true,
    isEventProcessed: () => false,
    isPostgresAvailable: () => true,
  };
  const result = capability.claimEvent(state, port, Date.now());
  assert.notEqual(result, null);
  if (result && 'state' in result) {
    assert.equal(result.state.claimedEventId, 'event-1');
    assert.equal(result.state.claimedEventStatus, 'PENDING');
  }
});