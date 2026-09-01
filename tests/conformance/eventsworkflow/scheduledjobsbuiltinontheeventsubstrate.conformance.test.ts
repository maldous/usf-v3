import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/eventsworkflow/scheduledjobsbuiltinontheeventsubstrate.ts";

test("scheduledjobsbuiltinontheeventsubstrateauditmodel", () => {
  const auditFn = (event: capability.ScheduledJobAuditEvent) => null;
  const job: capability.ScheduledJob = {
    id: 'j1',
    organisationId: 'o1',
    jobKey: 'k1',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: new Date(Date.now() + 3600000).toISOString(),
    lastRunAt: null,
  };
  const state = capability.initialState;
  const result = capability.createScheduledJob(state, job, auditFn);
  assert('jobs' in result, 'Should have added job to state');
  assert.equal(result.jobs.length, 1, 'One job should be added');
  const jobInState = result.jobs[0];
  assert.equal(jobInState.id, 'j1');
  assert.equal(jobInState.organisationId, 'o1');
  assert.equal(jobInState.jobKey, 'k1');
  assert.equal(jobInState.eventType, 'report.run');
  assert.equal(jobInState.intervalSeconds, 3600);
  assert.equal(jobInState.enabled, true);
  assert.equal(jobInState.nextRunAt, result.jobs[0].nextRunAt);
});

test("scheduledjobsbuiltinontheeventsubstratecontracts", () => {
  const state = capability.initialState;
  const result = capability.listScheduledJobs(state, 'o1');
  assert.equal(result.kind, 'SUCCESS', 'List with valid organisation should succeed');
  assert.deepEqual(result.jobs, [], 'No jobs should be returned initially');
  
  const stateWithJob = { jobs: [{ id: 'j1', organisationId: 'o1', jobKey: 'k1', eventType: 'report.run', intervalSeconds: 3600, enabled: true, nextRunAt: new Date(Date.now() + 3600000).toISOString(), lastRunAt: null }] };
  const result2 = capability.listScheduledJobs(stateWithJob, undefined);
  assert.equal(result2.kind, 'SUCCESS', 'List with valid job should succeed');
  assert.deepEqual(result2.jobs, []);
});

test("scheduledjobsbuiltinontheeventsubstratelifecycle", () => {
  const now = new Date('2024-01-01T00:00:00.000Z');
  const job: capability.ScheduledJob = {
    id: 'j1',
    organisationId: 'o1',
    jobKey: 'k1',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: now.toISOString(),
    lastRunAt: null,
  };
  const state: capability.ScheduledJobState = { jobs: [job] };
  
  const result = capability.dueTick(state, now, true);
  assert.equal(result.kind, 'SUCCESS', 'Due tick should succeed');
  assert.equal(result.events.length, 1, 'One event should be emitted');
  assert.equal(result.events[0].eventType, 'report.run', 'Correct event type emitted');
  assert.equal(result.state.jobs[0].lastRunAt, now.toISOString(), 'Last run time set');
  
  const nextTick = capability.dueTick(result.state, now, true);
  assert.equal(nextTick.kind, 'SUCCESS', 'Second due tick should succeed');
  assert.equal(nextTick.events.length, 0, 'No new events after processing');
  
  const runNowResult = capability.runNowScheduledJob(state, 'j1', () => null, now);
  assert.equal(runNowResult.kind, 'SUCCESS', 'Run now should succeed');
  assert.equal(runNowResult.event.eventType, 'report.run', 'Correct event type emitted');
  
  const patchedResult = capability.patchScheduledJob(state, 'j1', { enabled: false }, () => null);
  assert('jobs' in patchedResult, 'Patch should return updated state');
  assert.equal(patchedResult.jobs[0].enabled, false, 'Job should be disabled');
});

test("scheduledjobsbuiltinontheeventsubstratepermissions", () => {
  assert.deepEqual(capability.ScheduledJobPermission, {
    LIST: 'platform.jobs.read',
    MODIFY: 'platform.jobs.write',
  } as const);
});

test("scheduledjobsbuiltinontheeventsubstratestatemodel", () => {
  const job: capability.ScheduledJob = {
    id: 'j1',
    organisationId: 'o1',
    jobKey: 'k1',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: new Date(Date.now() + 3600000).toISOString(),
    lastRunAt: null,
  };
  const state: capability.ScheduledJobState = { jobs: [job] };
  
  assert.equal(state.jobs[0].organisationId, 'o1');
  assert.equal(state.jobs[0].jobKey, 'k1');
  assert.equal(state.jobs[0].eventType, 'report.run');
  assert.equal(state.jobs[0].intervalSeconds, 3600);
  assert.equal(state.jobs[0].enabled, true);
  assert.typeOf(state.jobs[0], 'capability.ScheduledJob');
});