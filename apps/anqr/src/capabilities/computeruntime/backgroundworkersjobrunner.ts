export const BackgroundWorkersJobRunnerLiveness = ['ALIVE', 'STALE', 'STOPPED'] as const;
export type BackgroundWorkersJobRunnerLiveness = typeof BackgroundWorkersJobRunnerLiveness[number];

export const BackgroundWorkersJobRunnerEventStatus = ['PENDING', 'PROCESSED', 'DEAD_LETTER'] as const;
export type BackgroundWorkersJobRunnerEventStatus = typeof BackgroundWorkersJobRunnerEventStatus[number];

export const BackgroundWorkersJobRunnerErrorKind = [
  'HANDLER_ERROR',
  'MAX_ATTEMPTS_EXCEEDED',
  'POSTGRES_UNAVAILABLE',
  'IDENTICAL_EVENT_ALREADY_PROCESSED',
  'INVALID_WORKER_STATE',
] as const;
export type BackgroundWorkersJobRunnerErrorKind = typeof BackgroundWorkersJobRunnerErrorKind[number];

export interface BackgroundWorkersJobRunnerError {
  readonly kind: BackgroundWorkersJobRunnerErrorKind;
  readonly message: string;
}

export interface WorkerState {
  readonly workerId: string;
  readonly workerKind: string;
  readonly heartbeatTimestamp: number;
  readonly liveness: BackgroundWorkersJobRunnerLiveness;
  readonly claimedEventId: string | null;
  readonly claimedEventStatus: BackgroundWorkersJobRunnerEventStatus | null;
  readonly retryCount: number;
  readonly isDeadLetter: boolean;
}

export interface EventRecord {
  readonly eventId: string;
  readonly status: BackgroundWorkersJobRunnerEventStatus;
  readonly attemptCount: number;
  readonly tenantContext: Record<string, unknown>;
}

export interface JobRunnerPort {
  readonly claimPendingEvent: () => EventRecord | null;
  readonly markEventProcessed: (eventId: string) => boolean;
  readonly markEventDeadLetter: (eventId: string) => boolean;
  readonly isEventProcessed: (eventId: string) => boolean;
  readonly isPostgresAvailable: () => boolean;
}

export interface HandlerRegistry {
  readonly processNext: (event: EventRecord) => boolean;
}

export interface WorkerProof {
  readonly workerId: string;
  readonly workerKind: string;
  readonly claimProof: boolean;
  readonly processProof: boolean;
  readonly skipProof: boolean;
  readonly retryProof: boolean;
  readonly deadLetterProof: boolean;
  readonly heartbeatProof: boolean;
}

export type WorkerReadiness = Readonly<{
  readonly liveness: BackgroundWorkersJobRunnerLiveness;
  readonly proof: WorkerProof | null;
  readonly isDegraded: boolean;
}>;

export const initialWorkerState: WorkerState = {
  workerId: '',
  workerKind: '',
  heartbeatTimestamp: 0,
  liveness: 'STOPPED',
  claimedEventId: null,
  claimedEventStatus: null,
  retryCount: 0,
  isDeadLetter: false,
};

export function computeLiveness(heartbeatTimestamp: number, now: number): BackgroundWorkersJobRunnerLiveness {
  const staleThresholdMs = 30000;
  if (now - heartbeatTimestamp < staleThresholdMs) {
    return 'ALIVE';
  }
  return heartbeatTimestamp > 0 ? 'STALE' : 'STOPPED';
}

export function emitHeartbeat(
  state: WorkerState,
  workerId: string,
  workerKind: string,
  now: number,
): WorkerState {
  return {
    ...state,
    workerId,
    workerKind,
    heartbeatTimestamp: now,
    liveness: computeLiveness(now, now),
  };
}

export function claimEvent(
  state: WorkerState,
  port: JobRunnerPort,
  now: number,
): { readonly state: WorkerState } | BackgroundWorkersJobRunnerError {
  if (!port.isPostgresAvailable()) {
    return { kind: 'POSTGRES_UNAVAILABLE', message: 'Postgres substrate is unavailable' };
  }

  const event = port.claimPendingEvent();
  if (event === null) {
    return {
      state: {
        ...state,
        liveness: computeLiveness(state.heartbeatTimestamp, now),
      },
    };
  }

  if (port.isEventProcessed(event.eventId)) {
    return { kind: 'IDENTICAL_EVENT_ALREADY_PROCESSED', message: 'Event already processed' };
  }

  return {
    state: {
      ...state,
      claimedEventId: event.eventId,
      claimedEventStatus: event.status,
      retryCount: event.attemptCount,
      isDeadLetter: false,
      liveness: computeLiveness(state.heartbeatTimestamp, now),
    },
  };
}

export function processEvent(
  state: WorkerState,
  port: JobRunnerPort,
  registry: HandlerRegistry,
  maxAttempts: number,
  now: number,
): { readonly state: WorkerState; readonly proof: WorkerProof } | BackgroundWorkersJobRunnerError {
  if (state.claimedEventId === null) {
    return { kind: 'INVALID_WORKER_STATE', message: 'No event claimed for processing' };
  }

  if (!port.isPostgresAvailable()) {
    return { kind: 'POSTGRES_UNAVAILABLE', message: 'Postgres substrate is unavailable' };
  }

  const event = port.claimPendingEvent();
  if (event === null || event.eventId !== state.claimedEventId) {
    return { kind: 'INVALID_WORKER_STATE', message: 'Claimed event not found' };
  }

  const handlerSuccess = registry.processNext(event);
  if (handlerSuccess) {
    const processed = port.markEventProcessed(state.claimedEventId);
    if (!processed) {
      return { kind: 'HANDLER_ERROR', message: 'Failed to mark event as processed' };
    }
    return {
      state: {
        ...state,
        claimedEventId: null,
        claimedEventStatus: 'PROCESSED',
        retryCount: 0,
        isDeadLetter: false,
        liveness: computeLiveness(state.heartbeatTimestamp, now),
      },
      proof: {
        workerId: state.workerId,
        workerKind: state.workerKind,
        claimProof: true,
        processProof: true,
        skipProof: false,
        retryProof: false,
        deadLetterProof: false,
        heartbeatProof: true,
      },
    };
  }

  const newRetryCount = state.retryCount + 1;
  if (newRetryCount >= maxAttempts) {
    const deadLettered = port.markEventDeadLetter(state.claimedEventId);
    if (!deadLettered) {
      return { kind: 'HANDLER_ERROR', message: 'Failed to dead-letter event' };
    }
    return {
      state: {
        ...state,
        claimedEventId: null,
        claimedEventStatus: 'DEAD_LETTER',
        retryCount: 0,
        isDeadLetter: true,
        liveness: computeLiveness(state.heartbeatTimestamp, now),
      },
      proof: {
        workerId: state.workerId,
        workerKind: state.workerKind,
        claimProof: true,
        processProof: false,
        skipProof: false,
        retryProof: false,
        deadLetterProof: true,
        heartbeatProof: true,
      },
    };
  }

  return {
    state: {
      ...state,
      retryCount: newRetryCount,
      liveness: computeLiveness(state.heartbeatTimestamp, now),
    },
    proof: {
      workerId: state.workerId,
      workerKind: state.workerKind,
      claimProof: true,
      processProof: false,
      skipProof: false,
      retryProof: true,
      deadLetterProof: false,
      heartbeatProof: true,
    },
  };
}

export function skipProcessedEvent(
  state: WorkerState,
  port: JobRunnerPort,
  now: number,
): { readonly state: WorkerState } | BackgroundWorkersJobRunnerError {
  if (state.claimedEventId === null) {
    return { kind: 'INVALID_WORKER_STATE', message: 'No event claimed for processing' };
  }

  if (port.isEventProcessed(state.claimedEventId)) {
    return {
      state: {
        ...state,
        claimedEventId: null,
        claimedEventStatus: 'PROCESSED',
        retryCount: 0,
        isDeadLetter: false,
        liveness: computeLiveness(state.heartbeatTimestamp, now),
      },
    };
  }

  return { kind: 'IDENTICAL_EVENT_ALREADY_PROCESSED', message: 'Event already processed' };
}

export function computeReadiness(
  state: WorkerState,
  port: JobRunnerPort,
): WorkerReadiness {
  const isDegraded = !port.isPostgresAvailable();
  const now = Date.now();
  const liveness = computeLiveness(state.heartbeatTimestamp, now);

  if (isDegraded) {
    return {
      liveness,
      proof: null,
      isDegraded: true,
    };
  }

  const proof: WorkerProof = {
    workerId: state.workerId,
    workerKind: state.workerKind,
    claimProof: state.claimedEventId !== null,
    processProof: state.claimedEventStatus === 'PROCESSED',
    skipProof: state.claimedEventStatus === 'PROCESSED' && state.claimedEventId !== null,
    retryProof: state.retryCount > 0,
    deadLetterProof: state.isDeadLetter,
    heartbeatProof: state.heartbeatTimestamp > 0,
  };

  return {
    liveness,
    proof,
    isDegraded: false,
  };
}

export function getWorkersAdminResponse(
  state: WorkerState,
  permission: string,
): { readonly workerId: string; readonly workerKind: string; readonly liveness: BackgroundWorkersJobRunnerLiveness } | BackgroundWorkersJobRunnerError {
  if (permission !== 'platform.workers.read') {
    return { kind: 'INVALID_WORKER_STATE', message: 'Permission denied' };
  }

  return {
    workerId: state.workerId,
    workerKind: state.workerKind,
    liveness: state.liveness,
  };
}