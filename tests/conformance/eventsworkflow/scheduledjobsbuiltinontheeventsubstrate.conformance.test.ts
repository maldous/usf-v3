import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/eventsworkflow/scheduledjobsbuiltinontheeventsubstrate.ts";

test("scheduledjobsbuiltinontheeventsubstrateauditmodel", () => {
  const auditFn = (event: capability.ScheduledJobAuditEvent): capability.ScheduledJobError | null => {
    assert.equal(event.kind, 'AUDIT_BEFORE_CHANGE');
    assert.equal(event.resource, 'scheduled_job.create');
    return null;
  };
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
  if ('jobs' in result) {
    assert.equal(result.jobs.length, 1);
  } else {
    assert.fail('Expected ScheduledJobState but got ScheduledJobError');
  }
});

test("scheduledjobsbuiltinontheeventsubstratecontracts", () => {
  const state = capability.initialState;
  const result = capability.listScheduledJobs(state, 'o1');
  assert.equal(result.kind, 'SUCCESS');
  assert.deepEqual(result.jobs, []);
});

test("scheduledjobsbuiltinontheeventsubstrateerrormodel", () => {
  const state = capability.initialState;
  const result = capability.listScheduledJobs(state, undefined);
  assert.equal(result.kind, 'ERROR');
  assert.equal(result.error.kind, 'MISSING_ORGANISATION_ID');
  assert.equal(result.error.message, 'organisationId is required');
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
  assert.equal(result.kind, 'SUCCESS');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventType, 'report.run');
  assert.equal(result.state.jobs[0].lastRunAt, now.toISOString());
  const nextTick = capability.dueTick(result.state, now, true);
  assert.equal(nextTick.kind, 'SUCCESS');
  assert.equal(nextTick.events.length, 0);
  const runNowResult = capability.runNowScheduledJob(state, 'j1', () => null, now);
  assert.equal(runNowResult.kind, 'SUCCESS');
  assert.equal(runNowResult.event.eventType, 'report.run');
  const patchedResult = capability.patchScheduledJob(state, 'j1', { enabled: false }, () => null);
  if ('jobs' in patchedResult) {
    assert.equal(patchedResult.jobs[0].enabled, false);
  } else {
    assert.fail('Expected ScheduledJobState but got ScheduledJobError');
  }
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
});

test("scheduledjobsbuiltinontheeventsubstratevalidation", () => {
  const state = capability.initialState;
  const result = capability.patchScheduledJob(
    state,
    'nonexistent',
    { enabled: false },
    () => null
  );
  if ('kind' in result && result.kind === 'INVALID_JOB_ID') {
    assert.equal(result.message, 'Job nonexistent does not exist');
  } else {
    assert.fail('Expected INVALID_JOB_ID error');
  }
  const listResult = capability.listScheduledJobs(state, undefined);
  assert.equal(listResult.kind, 'ERROR');
  assert.equal(listResult.error.kind, 'MISSING_ORGANISATION_ID');
  const dueTickResult = capability.dueTick(state, new Date(), false);
  assert.equal(dueTickResult.kind, 'ERROR');
  assert.equal(dueTickResult.error.kind, 'POSTGRES_UNAVAILABLE');
});