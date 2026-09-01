export const ScheduledJobErrorKind = [
  'MISSING_ORGANISATION_ID',
  'INVALID_JOB_ID',
  'POSTGRES_UNAVAILABLE',
] as const;
export type ScheduledJobErrorKind = typeof ScheduledJobErrorKind[number];

export interface ScheduledJobError {
  readonly kind: ScheduledJobErrorKind;
  readonly message: string;
}

export const ScheduledJobAuditEventKind = ['AUDIT_BEFORE_CHANGE'] as const;
export type ScheduledJobAuditEventKind = typeof ScheduledJobAuditEventKind[number];

export interface ScheduledJobAuditEvent {
  readonly kind: ScheduledJobAuditEventKind;
  readonly resource: string;
  readonly payload: unknown;
  readonly timestamp: string;
}

export interface PlatformEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly timestamp: string;
}

export interface ScheduledJob {
  readonly id: string;
  readonly organisationId: string;
  readonly jobKey: string;
  readonly eventType: string;
  readonly intervalSeconds: number;
  readonly enabled: boolean;
  readonly nextRunAt: string; // ISO timestamp
  readonly lastRunAt: string | null; // ISO timestamp or null
}

/** Whole capability state – the scheduled_jobs table */
export interface ScheduledJobState {
  readonly jobs: readonly ScheduledJob[];
}

/** Empty initial state */
export const initialState: ScheduledJobState = {
  jobs: [],
};

/** Permissions used by the HTTP façade */
export const ScheduledJobPermission = {
  LIST: 'platform.jobs.read',
  MODIFY: 'platform.jobs.write',
} as const;

/** Audit helper – runs the supplied audit function before any mutation.
 *  Returns the error from the audit function or null if audit succeeded.
 */
export function auditJobChange(
  resource: string,
  payload: unknown,
  auditFn: (event: ScheduledJobAuditEvent) => ScheduledJobError | null,
): ScheduledJobError | null {
  const ev: ScheduledJobAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    resource,
    payload,
    timestamp: new Date().toISOString(),
  };
  return auditFn(ev);
}

/** List all jobs for an organisation. */
export function listScheduledJobs(
  state: ScheduledJobState,
  organisationId: string | undefined,
): { readonly kind: 'SUCCESS'; readonly jobs: readonly ScheduledJob[] } |
  { readonly kind: 'ERROR'; readonly error: ScheduledJobError } {
  if (organisationId == null) {
    return {
      kind: 'ERROR',
      error: { kind: 'MISSING_ORGANISATION_ID', message: 'organisationId is required' },
    };
  }
  const jobs = state.jobs.filter((j) => j.organisationId === organisationId);
  return { kind: 'SUCCESS', jobs };
}

/** Create a new scheduled job. Audits before mutation. */
export function createScheduledJob(
  state: ScheduledJobState,
  job: ScheduledJob,
  auditFn: (event: ScheduledJobAuditEvent) => ScheduledJobError | null,
): ScheduledJobState | ScheduledJobError {
  const auditError = auditJobChange('scheduled_job.create', job, auditFn);
  if (auditError !== null) {
    return auditError;
  }
  if (job.organisationId == null || job.organisationId === '') {
    return { kind: 'MISSING_ORGANISATION_ID', message: 'organisationId is required' };
  }
  const newJobs = [...state.jobs, job];
  return { jobs: newJobs };
}

/** Patch an existing job identified by id. Audits before mutation. */
export function patchScheduledJob(
  state: ScheduledJobState,
  jobId: string,
  patch: Partial<Omit<ScheduledJob, 'id' | 'organisationId' | 'jobKey' | 'eventType' | 'nextRunAt' | 'lastRunAt'>>,
  auditFn: (event: ScheduledJobAuditEvent) => ScheduledJobError | null,
): ScheduledJobState | ScheduledJobError {
  const auditError = auditJobChange('scheduled_job.patch', { jobId, patch }, auditFn);
  if (auditError !== null) {
    return auditError;
  }
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) {
    return { kind: 'INVALID_JOB_ID', message: `Job ${jobId} does not exist` };
  }
  const existing = state.jobs[idx];
  const updated: ScheduledJob = {
    ...existing,
    ...patch,
  };
  const newJobs = [...state.jobs];
  newJobs[idx] = updated;
  return { jobs: newJobs };
}

/** Run a job immediately, emitting a platform event.
 *  Audits before mutation. Returns new state and the emitted event.
 */
export function runNowScheduledJob(
  state: ScheduledJobState,
  jobId: string,
  auditFn: (event: ScheduledJobAuditEvent) => ScheduledJobError | null,
  now: Date = new Date(),
): { readonly kind: 'SUCCESS'; readonly state: ScheduledJobState; readonly event: PlatformEvent } |
  { readonly kind: 'ERROR'; readonly error: ScheduledJobError } {
  const auditError = auditJobChange('scheduled_job.run', { jobId }, auditFn);
  if (auditError !== null) {
    return { kind: 'ERROR', error: auditError };
  }
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) {
    return { kind: 'ERROR', error: { kind: 'INVALID_JOB_ID', message: `Job ${jobId} not found` } };
  }
  const job = state.jobs[idx];
  const event: PlatformEvent = {
    eventId: `${job.id}-${now.toISOString()}`,
    eventType: job.eventType,
    payload: { jobId: job.id },
    timestamp: now.toISOString(),
  };
  // Update lastRunAt but keep nextRunAt unchanged (run-now does not affect schedule)
  const updatedJob: ScheduledJob = { ...job, lastRunAt: now.toISOString() };
  const newJobs = [...state.jobs];
  newJobs[idx] = updatedJob;
  return { kind: 'SUCCESS', state: { jobs: newJobs }, event };
}

/** Internal server tick that enqueues due jobs.
 *  Returns new state and any events that were emitted.
 *  The function is deterministic and fails closed – any missing substrate is signalled via error.
 */
export function dueTick(
  state: ScheduledJobState,
  now: Date = new Date(),
  postgresAvailable: boolean = true,
): { readonly kind: 'SUCCESS'; readonly state: ScheduledJobState; readonly events: readonly PlatformEvent[] } |
  { readonly kind: 'ERROR'; readonly error: ScheduledJobError } {
  if (!postgresAvailable) {
    return {
      kind: 'ERROR',
      error: { kind: 'POSTGRES_UNAVAILABLE', message: 'Postgres substrate not available' },
    };
  }

  const nowIso = now.toISOString();
  const events: PlatformEvent[] = [];
  const newJobs = state.jobs.map((job) => {
    if (!job.enabled) {
      return job; // disabled jobs are never due
    }
    // If now is before nextRunAt, not due yet
    if (nowIso < job.nextRunAt) {
      return job;
    }
    // Idempotency: if already ran within current interval window, skip
    if (job.lastRunAt !== null) {
      const lastRun = new Date(job.lastRunAt).getTime();
      if (now.getTime() - lastRun < job.intervalSeconds * 1000) {
        return job; // already processed this window
      }
    }
    // Emit event
    events.push({
      eventId: `${job.id}-${nowIso}`,
      eventType: job.eventType,
      payload: { jobId: job.id },
      timestamp: nowIso,
    });
    // Compute next run
    const nextRun = new Date(now.getTime() + job.intervalSeconds * 1000);
    return {
      ...job,
      lastRunAt: nowIso,
      nextRunAt: nextRun.toISOString(),
    };
  });

  return {
    kind: 'SUCCESS',
    state: { jobs: newJobs },
    events,
  };
}