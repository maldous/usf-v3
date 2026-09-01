// eventbusdurablequeuesdlqredrive capability module
// Domain: eventsworkflow

// === Constants and Types ===

export const EventStatus = ['pending', 'processing', 'processed', 'dead_letter'] as const;
export type EventStatus = typeof EventStatus[number];

export const WorkerLiveness = ['alive', 'stale', 'stopped'] as const;
export type WorkerLiveness = typeof WorkerLiveness[number];

export const RedriveAuditEventKind = ['REDRIVEN'] as const;
export type RedriveAuditEventKind = typeof RedriveAuditEventKind[number];

export const ErrorKind = [
  'DUPLICATE_EVENT',
  'MISSING_ORGANISATION_ID',
  'INVALID_REDRIVE_ID',
  'POSTGRES_UNAVAILABLE',
  'PERMISSION_DENIED',
  'SECRET_PAYLOAD',
  'HANDLER_EXHAUSTED',
  'EVENT_NOT_FOUND',
  'INVALID_STATUS',
  'AUDIT_FAILURE',
] as const;
export type ErrorKind = typeof ErrorKind[number];

export const Permission = {
  EVENTS_READ: 'platform.events.read',
  EVENTS_WRITE: 'platform.events.write',
  WORKERS_READ: 'platform.workers.read',
} as const;
export type Permission = typeof Permission[keyof typeof Permission];

// === Interfaces ===

export interface SecretField {
  readonly path: string;
  readonly reason: string;
}

export interface EventRecord {
  readonly organisationId: string;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly status: EventStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeadLetterRecord {
  readonly organisationId: string;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly payloadSummary: string;
  readonly attempts: number;
  readonly lastError: string;
  readonly createdAt: string;
}

export interface WorkerHeartbeat {
  readonly workerId: string;
  readonly liveness: WorkerLiveness;
  readonly lastSeenAt: string;
}

export interface RedriveAuditEvent {
  readonly kind: RedriveAuditEventKind;
  readonly organisationId: string;
  readonly eventId: string;
  readonly timestamp: string;
}

export interface EventError {
  readonly kind: ErrorKind;
  readonly message: string;
  readonly organisationId?: string;
}

export interface PublishResult {
  readonly kind: 'SUCCESS' | 'ERROR';
  readonly event?: EventRecord;
  readonly error?: EventError;
}

export interface RedriveResult {
  readonly kind: 'SUCCESS' | 'ERROR';
  readonly newEvent?: EventRecord;
  readonly error?: EventError;
}

export interface ListEventsResult {
  readonly kind: 'SUCCESS' | 'ERROR';
  readonly events?: readonly EventRecord[];
  readonly error?: EventError;
}

export interface ListDeadLettersResult {
  readonly kind: 'SUCCESS' | 'ERROR';
  readonly deadLetters?: readonly DeadLetterRecord[];
  readonly error?: EventError;
}

export interface ReadinessStatus {
  readonly eventQueueVisible: boolean;
  readonly deadLetterQueueVisible: boolean;
  readonly workerHeartbeats: readonly WorkerHeartbeat[];
  readonly postgresAvailable: boolean;
}

// === State ===

export interface EventBusState {
  readonly events: readonly EventRecord[];
  readonly deadLetters: readonly DeadLetterRecord[];
  readonly workerHeartbeats: readonly WorkerHeartbeat[];
  readonly postgresAvailable: boolean;
}

export const initialState: EventBusState = {
  events: [],
  deadLetters: [],
  workerHeartbeats: [],
  postgresAvailable: true,
};

// === Validation ===

const SECRET_PATTERNS = ['password', 'secret', 'token', 'key', 'credential'] as const;

function containsSecretField(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') {
    return false;
  }

  const obj = payload as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (SECRET_PATTERNS.some(pattern => lowerKey.includes(pattern))) {
      return true;
    }
    if (containsSecretField(obj[key])) {
      return true;
    }
  }
  return false;
}

// === Audit ===

export function createRedriveAuditEvent(
  organisationId: string,
  eventId: string,
): RedriveAuditEvent {
  return {
    kind: 'REDRIVEN',
    organisationId,
    eventId,
    timestamp: new Date().toISOString(),
  };
}

export function auditRedrive(
  auditEvent: RedriveAuditEvent,
  auditFn: (event: RedriveAuditEvent) => EventError | null,
): EventError | null {
  return auditFn(auditEvent);
}

// === Core Operations ===

export function publishEvent(
  state: EventBusState,
  organisationId: string | null,
  eventType: string,
  idempotencyKey: string,
  payload: unknown,
  maxAttempts: number,
): PublishResult {
  // Validate organisationId
  if (organisationId === null) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'MISSING_ORGANISATION_ID',
        message: 'organisationId is required',
      },
    };
  }

  // Validate payload for secrets
  if (containsSecretField(payload)) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'SECRET_PAYLOAD',
        message: 'Payload contains secret fields',
        organisationId,
      },
    };
  }

  // Check for duplicate
  const existingEvent = state.events.find(
    e => e.organisationId === organisationId && e.eventType === eventType && e.idempotencyKey === idempotencyKey,
  );
  if (existingEvent !== undefined) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'DUPLICATE_EVENT',
        message: 'Duplicate event detected',
        organisationId,
      },
    };
  }

  // Check Postgres availability
  if (!state.postgresAvailable) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId,
      },
    };
  }

  const now = new Date().toISOString();
  const newEvent: EventRecord = {
    organisationId,
    eventType,
    idempotencyKey,
    payload,
    status: 'pending',
    attempts: 0,
    maxAttempts,
    createdAt: now,
    updatedAt: now,
  };

  return {
    kind: 'SUCCESS',
    event: newEvent,
  };
}

export function processEvent(
  state: EventBusState,
  organisationId: string,
  eventId: string,
  workerId: string,
): EventBusState | EventError {
  const eventIndex = state.events.findIndex(
    e => e.organisationId === organisationId && e.idempotencyKey === eventId,
  );

  if (eventIndex === -1) {
    return {
      kind: 'EVENT_NOT_FOUND',
      message: 'Event not found',
      organisationId,
    };
  }

  const event = state.events[eventIndex];
  if (event.status !== 'pending') {
    return {
      kind: 'INVALID_STATUS',
      message: 'Event is not in pending state',
      organisationId,
    };
  }

  const updatedEvent: EventRecord = {
    ...event,
    status: 'processing',
    attempts: event.attempts + 1,
    updatedAt: new Date().toISOString(),
  };

  const updatedEvents = [...state.events] as EventRecord[];
  updatedEvents[eventIndex] = updatedEvent;

  const now = new Date().toISOString();
  const existingHeartbeatIndex = state.workerHeartbeats.findIndex(
    h => h.workerId === workerId,
  );

  let updatedHeartbeats: WorkerHeartbeat[];
  if (existingHeartbeatIndex >= 0) {
    const updatedHeartbeat: WorkerHeartbeat = {
      ...state.workerHeartbeats[existingHeartbeatIndex],
      liveness: 'alive',
      lastSeenAt: now,
    };
    updatedHeartbeats = [...state.workerHeartbeats] as WorkerHeartbeat[];
    updatedHeartbeats[existingHeartbeatIndex] = updatedHeartbeat;
  } else {
    updatedHeartbeats = [
      ...state.workerHeartbeats,
      { workerId, liveness: 'alive', lastSeenAt: now },
    ];
  }

  return {
    ...state,
    events: updatedEvents,
    workerHeartbeats: updatedHeartbeats,
  };
}

export function failEvent(
  state: EventBusState,
  organisationId: string,
  eventId: string,
  errorMessage: string,
): EventBusState | EventError {
  const eventIndex = state.events.findIndex(
    e => e.organisationId === organisationId && e.idempotencyKey === eventId,
  );

  if (eventIndex === -1) {
    return {
      kind: 'EVENT_NOT_FOUND',
      message: 'Event not found',
      organisationId,
    };
  }

  const event = state.events[eventIndex];
  if (event.status !== 'processing') {
    return {
      kind: 'INVALID_STATUS',
      message: 'Event is not in processing state',
      organisationId,
    };
  }

  const newAttempts = event.attempts + 1;
  if (newAttempts >= event.maxAttempts) {
    // Move to dead letter
    const deadLetter: DeadLetterRecord = {
      organisationId: event.organisationId,
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
      payloadSummary: typeof event.payload === 'object' && event.payload !== null
        ? JSON.stringify(Object.keys(event.payload as object))
        : 'non-object payload',
      attempts: newAttempts,
      lastError: errorMessage,
      createdAt: new Date().toISOString(),
    };

    const updatedEvents = state.events.filter(
      e => !(e.organisationId === organisationId && e.idempotencyKey === eventId),
    );

    return {
      ...state,
      events: updatedEvents,
      deadLetters: [...state.deadLetters, deadLetter],
    };
  }

  // Retry
  const updatedEvent: EventRecord = {
    ...event,
    status: 'pending',
    attempts: newAttempts,
    updatedAt: new Date().toISOString(),
  };

  const updatedEvents = [...state.events] as EventRecord[];
  updatedEvents[eventIndex] = updatedEvent;

  return {
    ...state,
    events: updatedEvents,
  };
}

export function completeEvent(
  state: EventBusState,
  organisationId: string,
  eventId: string,
): EventBusState | EventError {
  const eventIndex = state.events.findIndex(
    e => e.organisationId === organisationId && e.idempotencyKey === eventId,
  );

  if (eventIndex === -1) {
    return {
      kind: 'EVENT_NOT_FOUND',
      message: 'Event not found',
      organisationId,
    };
  }

  const event = state.events[eventIndex];
  if (event.status !== 'processing') {
    return {
      kind: 'INVALID_STATUS',
      message: 'Event is not in processing state',
      organisationId,
    };
  }

  const updatedEvent: EventRecord = {
    ...event,
    status: 'processed',
    updatedAt: new Date().toISOString(),
  };

  const updatedEvents = [...state.events] as EventRecord[];
  updatedEvents[eventIndex] = updatedEvent;

  return {
    ...state,
    events: updatedEvents,
  };
}

export function redriveEvent(
  state: EventBusState,
  organisationId: string | null,
  eventId: string,
  auditFn: (event: RedriveAuditEvent) => EventError | null,
): RedriveResult {
  // Validate organisationId
  if (organisationId === null) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'MISSING_ORGANISATION_ID',
        message: 'organisationId is required',
      },
    };
  }

  // Find dead letter
  const deadLetterIndex = state.deadLetters.findIndex(
    dl => dl.organisationId === organisationId && dl.idempotencyKey === eventId,
  );

  if (deadLetterIndex === -1) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'INVALID_REDRIVE_ID',
        message: 'Dead letter event not found',
        organisationId,
      },
    };
  }

  // Check Postgres availability
  if (!state.postgresAvailable) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId,
      },
    };
  }

  const deadLetter = state.deadLetters[deadLetterIndex];
  const auditEvent = createRedriveAuditEvent(organisationId, deadLetter.idempotencyKey);
  const auditError = auditRedrive(auditEvent, auditFn);

  if (auditError !== null) {
    return {
      kind: 'ERROR',
      error: auditError,
    };
  }

  // Create new event from dead letter
  const now = new Date().toISOString();
  const newEvent: EventRecord = {
    organisationId: deadLetter.organisationId,
    eventType: deadLetter.eventType,
    idempotencyKey: `${deadLetter.idempotencyKey}-redrive-${now}`,
    payload: {}, // Payload is excluded from redrive per requirements
    status: 'pending',
    attempts: 0,
    maxAttempts: deadLetter.attempts + 1, // Ensure we don't immediately exhaust attempts
    createdAt: now,
    updatedAt: now,
  };

  // Remove from dead letters
  const updatedDeadLetters = state.deadLetters.filter(
    (_, index) => index !== deadLetterIndex,
  );

  return {
    kind: 'SUCCESS',
    newEvent,
  };
}

export function listEvents(
  state: EventBusState,
  organisationId: string | null,
): ListEventsResult {
  if (organisationId === null) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'MISSING_ORGANISATION_ID',
        message: 'organisationId is required',
      },
    };
  }

  const filteredEvents = state.events.filter(
    e => e.organisationId === organisationId,
  );

  return {
    kind: 'SUCCESS',
    events: filteredEvents,
  };
}

export function listDeadLetters(
  state: EventBusState,
  organisationId: string | null,
): ListDeadLettersResult {
  if (organisationId === null) {
    return {
      kind: 'ERROR',
      error: {
        kind: 'MISSING_ORGANISATION_ID',
        message: 'organisationId is required',
      },
    };
  }

  const filteredDeadLetters = state.deadLetters.filter(
    dl => dl.organisationId === organisationId,
  );

  return {
    kind: 'SUCCESS',
    deadLetters: filteredDeadLetters,
  };
}

export function listWorkers(
  state: EventBusState,
): readonly WorkerHeartbeat[] {
  return state.workerHeartbeats;
}

export function checkReadiness(
  state: EventBusState,
): ReadinessStatus {
  return {
    eventQueueVisible: true,
    deadLetterQueueVisible: true,
    workerHeartbeats: state.workerHeartbeats,
    postgresAvailable: state.postgresAvailable,
  };
}

export function checkPermission(
  requiredPermission: Permission,
  userPermissions: readonly Permission[],
): boolean {
  return userPermissions.includes(requiredPermission);
}