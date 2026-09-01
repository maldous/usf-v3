import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/eventsworkflow/scheduledjobsbuiltinontheeventsubstrate.ts";

test("scheduledjobsbuiltinontheeventsubstrateauditmodel", () => {
  const auditCalls: capability.ScheduledJobAuditEvent[] = [];
  const auditFn = (event: capability.ScheduledJobAuditEvent): capability.ScheduledJobError | null => {
    auditCalls.push(event);
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
  
  assert.strictEqual(auditCalls.length, 0);
  
  const createResult = capability.createScheduledJob(state, job, auditFn);
  assert.ok(createResult.jobs.length > 0);
  
  assert.strictEqual(auditCalls.length, 1);
  assert.equal(auditCalls[0].kind, 'AUDIT_BEFORE_CHANGE');
  assert.equal(auditCalls[0].resource, 'scheduled_job.create');
  
  auditCalls.length = 0;
});

test("scheduledjobsbuiltinontheeventsubstratecontracts", () => {
  const state = capability.initialState;
  
  const listResult = capability.listScheduledJobs(state, undefined);
  assert.equal(listResult.kind, 'SUCCESS');
  assert.deepEqual(listResult.jobs, []);
  
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
  const createResult = capability.createScheduledJob(state, job, () => null);
  assert.ok(createResult.jobs.length > 0);
  
  const patchResult = capability.patchScheduledJob(
    { jobs: [job] },
    'j1',
    { enabled: false },
    () => null
  );
  assert.ok(patchResult.jobs[0].enabled === false);
  
  const runResult = capability.runNowScheduledJob(
    { jobs: [job] },
    'j1',
    () => null,
    new Date()
  );
  assert.equal(runResult.kind, 'SUCCESS');
  assert.equal(runResult.event.eventType, 'report.run');
});

test("scheduledjobsbuiltinontheeventsubstrateerrormodel", () => {
  const state = capability.initialState;
  
  const listResult = capability.listScheduledJobs(state, undefined);
  assert.equal(listResult.kind, 'ERROR');
  assert.equal(listResult.error.kind, 'MISSING_ORGANISATION_ID');
  
  const patchResult = capability.patchScheduledJob(state, 'nonexistent', {}, () => null);
  assert.equal(patchResult.kind, 'INVALID_JOB_ID');
  
  const runResult = capability.runNowScheduledJob(state, 'nonexistent', () => null, new Date());
  assert.equal(runResult.kind, 'ERROR');
  assert.equal(runResult.error.kind, 'INVALID_JOB_ID');
  
  const dueResult = capability.dueTick(state, new Date(), false);
  assert.equal(dueResult.kind, 'ERROR');
  assert.equal(dueResult.error.kind, 'POSTGRES_UNAVAILABLE');
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
  
  const dueResult = capability.dueTick(state, now, true);
  assert.equal(dueResult.kind, 'SUCCESS');
  assert.equal(dueResult.events.length, 1);
  assert.equal(dueResult.events[0].eventType, 'report.run');
  assert.equal(dueResult.state.jobs[0].lastRunAt, now.toISOString());
  
  const nextTick = capability.dueTick(dueResult.state, now, true);
  assert.equal(nextTick.kind, 'SUCCESS');
  assert.equal(nextTick.events.length, 0);
  
  const runResult = capability.runNowScheduledJob(state, 'j1', () => null, now);
  assert.equal(runResult.kind, 'SUCCESS');
  assert.equal(runResult.event.eventType, 'report.run');
  
  const patchedResult = capability.patchScheduledJob(state, 'j1', { enabled: false }, () => null);
  assert.ok(patchedResult.jobs[0].enabled === false);
});

test("scheduledjobsbuiltinontheeventsubstratepermissions", () => {
  const permissions = capability.ScheduledJobPermission;
  assert.deepEqual(permissions.LIST, 'platform.jobs.read');
  assert.deepEqual(permissions.MODIFY, 'platform.jobs.write');
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
  assert.equal(state.jobs[0].nextRunAt, job.nextRunAt);
  assert.equal(state.jobs[0].lastRunAt, null);
});
```