import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/eventsworkflow/scheduledjobsbuiltinontheeventsubstrate.ts";

test("scheduledjobsbuiltinontheeventsubstrateauditmodel", () => {
  const auditCalls: capability.ScheduledJobAuditEvent[] = [];
  const auditFn = (event: capability.ScheduledJobAuditEvent): capability.ScheduledJobError | null => {
    auditCalls.push(event);
    return null;
  };
  const failingAuditFn = (_event: capability.ScheduledJobAuditEvent): capability.ScheduledJobError | null => {
    return { kind: 'POSTGRES_UNAVAILABLE', message: 'Audit rejected' };
  };

  const job: capability.ScheduledJob = {
    id: 'j1',
    organisationId: 'o1',
    jobKey: 'k1',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null,
  };
  const state = capability.initialState;

  const blockedCreate = capability.createScheduledJob(state, job, failingAuditFn);
  assert.ok('kind' in blockedCreate);
  assert.equal(blockedCreate.kind, 'POSTGRES_UNAVAILABLE');

  const createResult = capability.createScheduledJob(state, job, auditFn);
  assert.ok('jobs' in createResult);
  if ('jobs' in createResult) {
    assert.equal(createResult.jobs.length, 1);
  }
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].kind, 'AUDIT_BEFORE_CHANGE');
  assert.equal(auditCalls[0].resource, 'scheduled_job.create');

  const patchResult = capability.patchScheduledJob(
    'jobs' in createResult ? createResult : state,
    'j1',
    { enabled: false },
    auditFn,
  );
  assert.ok('jobs' in patchResult);
  assert.equal(auditCalls.length, 2);
  assert.equal(auditCalls[1].resource, 'scheduled_job.patch');

  const runResult = capability.runNowScheduledJob(
    'jobs' in patchResult ? patchResult : state,
    'j1',
    auditFn,
    new Date('2024-01-01T01:00:00.000Z'),
  );
  assert.equal(runResult.kind, 'SUCCESS');
  assert.equal(auditCalls.length, 3);
  assert.equal(auditCalls[2].resource, 'scheduled_job.run');

  const tickResult = capability.dueTick(
    'jobs' in createResult ? createResult : state,
    new Date('2024-01-01T00:00:00.000Z'),
    true,
  );
  assert.equal(tickResult.kind, 'SUCCESS');
  if (tickResult.kind === 'SUCCESS') {
    assert.equal(tickResult.events.length, 1);
    assert.equal(tickResult.events[0].eventType, 'report.run');
  }
});

test("scheduledjobsbuiltinontheeventsubstratecontracts", () => {
  const state = capability.initialState;
  const noAudit = (): capability.ScheduledJobError | null => null;

  const job: capability.ScheduledJob = {
    id: 'j1',
    organisationId: 'o1',
    jobKey: 'k1',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null,
  };

  const created = capability.createScheduledJob(state, job, noAudit);
  assert.ok('jobs' in created);
  const createdState = 'jobs' in created ? created : state;

  const listResult = capability.listScheduledJobs(createdState, 'o1');
  assert.equal(listResult.kind, 'SUCCESS');
  if (listResult.kind === 'SUCCESS') {
    assert.equal(listResult.jobs.length, 1);
    assert.equal(listResult.jobs[0].id, 'j1');
  }

  const patched = capability.patchScheduledJob(createdState, 'j1', { enabled: false }, noAudit);
  assert.ok('jobs' in patched);
  if ('jobs' in patched) {
    assert.equal(patched.jobs[0].enabled, false);
  }

  const runResult = capability.runNowScheduledJob(
    createdState,
    'j1',
    noAudit,
    new Date('2024-01-01T00:00:00.000Z'),
  );
  assert.equal(runResult.kind, 'SUCCESS');
  if (runResult.kind === 'SUCCESS') {
    assert.equal(runResult.event.eventType, 'report.run');
    assert.deepEqual(runResult.event.payload, { jobId: 'j1' });
  }

  const dueResult = capability.dueTick(createdState, new Date('2024-01-01T00:00:00.000Z'), true);
  assert.equal(dueResult.kind, 'SUCCESS');
  if (dueResult.kind === 'SUCCESS') {
    assert.equal(dueResult.events.length, 1);
    assert.equal(dueResult.events[0].eventType, 'report.run');
  }
});

test("scheduledjobsbuiltinontheeventsubstrateerrormodel", () => {
  const state = capability.initialState;
  const noAudit = (): capability.ScheduledJobError | null => null;

  const listResult = capability.listScheduledJobs(state, undefined);
  assert.equal(listResult.kind, 'ERROR');
  if (listResult.kind === 'ERROR') {
    assert.equal(listResult.error.kind, 'MISSING_ORGANISATION_ID');
  }

  const invalidCreateJob: capability.ScheduledJob = {
    id: 'j-err',
    organisationId: '',
    jobKey: 'k-err',
    eventType: 'report.run',
    intervalSeconds: 60,
    enabled: true,
    nextRunAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null,
  };
  const createResult = capability.createScheduledJob(state, invalidCreateJob, noAudit);
  assert.ok('kind' in createResult);
  if ('kind' in createResult) {
    assert.equal(createResult.kind, 'MISSING_ORGANISATION_ID');
  }

  const patchResult = capability.patchScheduledJob(state, 'nonexistent', {}, noAudit);
  assert.ok('kind' in patchResult);
  if ('kind' in patchResult) {
    assert.equal(patchResult.kind, 'INVALID_JOB_ID');
  }

  const runResult = capability.runNowScheduledJob(state, 'nonexistent', noAudit, new Date('2024-01-01T00:00:00.000Z'));
  assert.equal(runResult.kind, 'ERROR');
  if (runResult.kind === 'ERROR') {
    assert.equal(runResult.error.kind, 'INVALID_JOB_ID');
  }

  const dueResult = capability.dueTick(state, new Date('2024-01-01T00:00:00.000Z'), false);
  assert.equal(dueResult.kind, 'ERROR');
  if (dueResult.kind === 'ERROR') {
    assert.equal(dueResult.error.kind, 'POSTGRES_UNAVAILABLE');
  }
});

test("scheduledjobsbuiltinontheeventsubstratelifecycle", () => {
  const now = new Date('2024-01-01T00:00:00.000Z');
  const noAudit = (): capability.ScheduledJobError | null => null;

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

  const created = capability.createScheduledJob(capability.initialState, job, noAudit);
  assert.ok('jobs' in created);
  const state: capability.ScheduledJobState = 'jobs' in created ? created : { jobs: [job] };

  const dueResult = capability.dueTick(state, now, true);
  assert.equal(dueResult.kind, 'SUCCESS');
  if (dueResult.kind === 'SUCCESS') {
    assert.equal(dueResult.events.length, 1);
    assert.equal(dueResult.events[0].eventType, 'report.run');
    assert.equal(dueResult.state.jobs[0].lastRunAt, now.toISOString());

    const nextTick = capability.dueTick(dueResult.state, now, true);
    assert.equal(nextTick.kind, 'SUCCESS');
    if (nextTick.kind === 'SUCCESS') {
      assert.equal(nextTick.events.length, 0);
    }
  }

  const paused = capability.patchScheduledJob(state, 'j1', { enabled: false }, noAudit);
  assert.ok('jobs' in paused);
  if ('jobs' in paused) {
    assert.equal(paused.jobs[0].enabled, false);
    const pausedTick = capability.dueTick(paused, now, true);
    assert.equal(pausedTick.kind, 'SUCCESS');
    if (pausedTick.kind === 'SUCCESS') {
      assert.equal(pausedTick.events.length, 0);
    }
  }

  const runResult = capability.runNowScheduledJob(state, 'j1', noAudit, now);
  assert.equal(runResult.kind, 'SUCCESS');
  if (runResult.kind === 'SUCCESS') {
    assert.equal(runResult.event.eventType, 'report.run');
    assert.equal(runResult.state.jobs[0].lastRunAt, now.toISOString());
  }
});

test("scheduledjobsbuiltinontheeventsubstratepermissions", () => {
  assert.equal(capability.ScheduledJobPermission.LIST, 'platform.jobs.read');
  assert.equal(capability.ScheduledJobPermission.MODIFY, 'platform.jobs.write');

  const state: capability.ScheduledJobState = {
    jobs: [
      {
        id: 'j1',
        organisationId: 'org-alpha',
        jobKey: 'k1',
        eventType: 'report.run',
        intervalSeconds: 3600,
        enabled: true,
        nextRunAt: '2024-01-01T00:00:00.000Z',
        lastRunAt: null,
      },
      {
        id: 'j2',
        organisationId: 'org-beta',
        jobKey: 'k2',
        eventType: 'report.run',
        intervalSeconds: 3600,
        enabled: true,
        nextRunAt: '2024-01-01T00:00:00.000Z',
        lastRunAt: null,
      },
    ],
  };

  const listAlpha = capability.listScheduledJobs(state, 'org-alpha');
  assert.equal(listAlpha.kind, 'SUCCESS');
  if (listAlpha.kind === 'SUCCESS') {
    assert.equal(listAlpha.jobs.length, 1);
    assert.equal(listAlpha.jobs[0].id, 'j1');
  }

  const listBeta = capability.listScheduledJobs(state, 'org-beta');
  assert.equal(listBeta.kind, 'SUCCESS');
  if (listBeta.kind === 'SUCCESS') {
    assert.equal(listBeta.jobs.length, 1);
    assert.equal(listBeta.jobs[0].id, 'j2');
  }
});

test("scheduledjobsbuiltinontheeventsubstratestatemodel", () => {
  assert.deepEqual(capability.initialState, { jobs: [] });

  const job: capability.ScheduledJob = {
    id: 'j1',
    organisationId: 'o1',
    jobKey: 'k1',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null,
  };
  const state: capability.ScheduledJobState = { jobs: [job] };

  assert.equal(state.jobs[0].organisationId, 'o1');
  assert.equal(state.jobs[0].jobKey, 'k1');
  assert.equal(state.jobs[0].eventType, 'report.run');
  assert.equal(state.jobs[0].intervalSeconds, 3600);
  assert.equal(state.jobs[0].enabled, true);
  assert.equal(state.jobs[0].nextRunAt, '2024-01-01T00:00:00.000Z');
  assert.equal(state.jobs[0].lastRunAt, null);

  const tickResult = capability.dueTick(state, new Date('2024-01-01T00:00:00.000Z'), true);
  assert.equal(tickResult.kind, 'SUCCESS');
  if (tickResult.kind === 'SUCCESS') {
    assert.equal(tickResult.state.jobs[0].lastRunAt, '2024-01-01T00:00:00.000Z');
    assert.equal(tickResult.state.jobs[0].nextRunAt, new Date('2024-01-01T01:00:00.000Z').toISOString());
    assert.equal(tickResult.events[0].eventType, 'report.run');
    assert.deepEqual(tickResult.events[0].payload, { jobId: 'j1' });
  }
});

test("scheduledjobsbuiltinontheeventsubstratevalidation", () => {
  const state = capability.initialState;
  const noAudit = (): capability.ScheduledJobError | null => null;

  const listMissing = capability.listScheduledJobs(state, undefined);
  assert.equal(listMissing.kind, 'ERROR');
  if (listMissing.kind === 'ERROR') {
    assert.equal(listMissing.error.kind, 'MISSING_ORGANISATION_ID');
  }

  const invalidJob: capability.ScheduledJob = {
    id: 'j-invalid',
    organisationId: '',
    jobKey: 'k1',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null,
  };
  const createInvalid = capability.createScheduledJob(state, invalidJob, noAudit);
  assert.ok('kind' in createInvalid);
  if ('kind' in createInvalid) {
    assert.equal(createInvalid.kind, 'MISSING_ORGANISATION_ID');
  }

  const patchInvalid = capability.patchScheduledJob(state, 'missing-id', { enabled: true }, noAudit);
  assert.ok('kind' in patchInvalid);
  if ('kind' in patchInvalid) {
    assert.equal(patchInvalid.kind, 'INVALID_JOB_ID');
  }

  const runInvalid = capability.runNowScheduledJob(state, 'missing-id', noAudit, new Date('2024-01-01T00:00:00.000Z'));
  assert.equal(runInvalid.kind, 'ERROR');
  if (runInvalid.kind === 'ERROR') {
    assert.equal(runInvalid.error.kind, 'INVALID_JOB_ID');
  }

  const disabledJob: capability.ScheduledJob = {
    id: 'j-disabled',
    organisationId: 'o1',
    jobKey: 'k-disabled',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: false,
    nextRunAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null,
  };
  const disabledTick = capability.dueTick({ jobs: [disabledJob] }, new Date('2024-01-01T00:00:00.000Z'), true);
  assert.equal(disabledTick.kind, 'SUCCESS');
  if (disabledTick.kind === 'SUCCESS') {
    assert.equal(disabledTick.events.length, 0);
  }

  const dueJob: capability.ScheduledJob = {
    id: 'j-due',
    organisationId: 'o1',
    jobKey: 'k-due',
    eventType: 'report.run',
    intervalSeconds: 3600,
    enabled: true,
    nextRunAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null,
  };
  const firstTick = capability.dueTick({ jobs: [dueJob] }, new Date('2024-01-01T00:00:00.000Z'), true);
  assert.equal(firstTick.kind, 'SUCCESS');
  if (firstTick.kind === 'SUCCESS') {
    assert.equal(firstTick.events.length, 1);
    const secondTick = capability.dueTick(firstTick.state, new Date('2024-01-01T00:10:00.000Z'), true);
    assert.equal(secondTick.kind, 'SUCCESS');
    if (secondTick.kind === 'SUCCESS') {
      assert.equal(secondTick.events.length, 0);
    }
  }
});