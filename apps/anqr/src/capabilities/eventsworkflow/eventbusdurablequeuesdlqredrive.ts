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

export interface PlatformEvent {
  readonly id: string;
  readonly organisationId: string;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly payload: Record<string, unknown>;
  readonly status: EventStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
  readonly payloadSummary: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkerHeartbeat {
  readonly workerId: string;
  readonly organisationId: string;
  readonly liveness: WorkerLiveness;
  readonly lastSeen: string;
}

export interface RedriveAuditRecord {
  readonly kind: RedriveAuditEventKind;
  readonly eventId: string;
  readonly organisationId: string;
  readonly previousStatus: EventStatus;
  readonly timestamp: string;
}

export interface CapabilityError {
  readonly kind: ErrorKind;
  readonly message: string;
  readonly organisationId?: string;
  readonly details?: Record<string, unknown>;
}

export interface PublishRequest {
  readonly organisationId: string;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly payload: Record<string, unknown>;
}

export interface PublishResult {
  readonly event: PlatformEvent | null;
  readonly error: CapabilityError | null;
}

export interface RedriveRequest {
  readonly organisationId: string;
  readonly eventId: string;
}

export interface RedriveResult {
  readonly event: PlatformEvent | null;
  readonly error: CapabilityError | null;
}

export interface ListRequest {
  readonly organisationId: string;
  readonly token: { readonly permissions: readonly string[] };
}

export interface ListResult {
  readonly events: readonly PlatformEvent[] | null;
  readonly error: CapabilityError | null;
}

export interface HeartbeatRequest {
  readonly workerId: string;
  readonly organisationId: string;
  readonly liveness: WorkerLiveness;
}

export interface HeartbeatResult {
  readonly heartbeat: WorkerHeartbeat | null;
  readonly error: CapabilityError | null;
}

export interface ReadinessResult {
  readonly eventQueueVisible: boolean;
  readonly deadLetterQueueVisible: boolean;
  readonly workerHeartbeatLiveness: WorkerLiveness;
  readonly postgresAvailable: boolean;
  readonly mutationPathsEnabled: boolean;
}

export interface CapabilityState {
  readonly events: readonly PlatformEvent[];
  readonly heartbeats: readonly WorkerHeartbeat[];
  readonly postgresAvailable: boolean;
}

// === Initial State ===

export const initialState: CapabilityState = {
  events: [],
  heartbeats: [],
  postgresAvailable: true,
};

// === Pure Functions ===

// Secret field detection patterns
const SECRET_PATTERNS: readonly SecretField[] = [
  { path: 'password', reason: 'contains password field' },
  { path: 'secret', reason: 'contains secret field' },
  { path: 'token', reason: 'contains token field' },
  { path: 'apiKey', reason: 'contains API key field' },
  { path: 'credential', reason: 'contains credential field' },
];

function detectSecretFields(payload: Record<string, unknown>): SecretField | null {
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    for (const pattern of SECRET_PATTERNS) {
      if (lowerKey.includes(pattern.path)) {
        return pattern;
      }
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = detectSecretFields(value as Record<string, unknown>);
      if (nested !== null) {
        return { path: `${key}.${nested.path}`, reason: nested.reason };
      }
    }
  }
  return null;
}

function checkPermission(
  token: { readonly permissions: readonly string[] },
  required: Permission
): boolean {
  return token.permissions.includes(required);
}

function validateOrganisationId(organisationId: string | undefined): CapabilityError | null {
  if (organisationId === undefined || organisationId === null || organisationId === '') {
    return {
      kind: 'MISSING_ORGANISATION_ID',
      message: 'organisationId is required',
    };
  }
  return null;
}

function validateEventId(eventId: string | undefined): CapabilityError | null {
  if (eventId === undefined || eventId === null || eventId === '') {
    return {
      kind: 'INVALID_REDRIVE_ID',
      message: 'Invalid event id',
    };
  }
  return null;
}

function findEvent(
  events: readonly PlatformEvent[],
  organisationId: string,
  eventId: string
): PlatformEvent | undefined {
  return events.find(
    (e) => e.organisationId === organisationId && e.id === eventId
  );
}

function findDuplicate(
  events: readonly PlatformEvent[],
  organisationId: string,
  eventType: string,
  idempotencyKey: string
): PlatformEvent | undefined {
  return events.find(
    (e) =>
      e.organisationId === organisationId &&
      e.eventType === eventType &&
      e.idempotencyKey === idempotencyKey
  );
}

function generateId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function generateHeartbeatId(): string {
  return `hb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function summarisePayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).slice(0, 3);
  return `keys: ${keys.join(', ')}, size: ${JSON.stringify(payload).length}`;
}

// === Publish Event ===

export function publishEvent(
  state: CapabilityState,
  request: PublishRequest,
): PublishResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { event: null, error: orgError };
  }

  if (!state.postgresAvailable) {
    return {
      event: null,
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId: request.organisationId,
      },
    };
  }

  const secret = detectSecretFields(request.payload);
  if (secret !== null) {
    return {
      event: null,
      error: {
        kind: 'SECRET_PAYLOAD',
        message: secret.reason,
        organisationId: request.organisationId,
        details: { path: secret.path },
      },
    };
  }

  const duplicate = findDuplicate(
    state.events,
    request.organisationId,
    request.eventType,
    request.idempotencyKey
  );
  if (duplicate !== undefined) {
    return { event: duplicate, error: null };
  }

  const now = new Date().toISOString();
  const newEvent: PlatformEvent = {
    id: generateId(),
    organisationId: request.organisationId,
    eventType: request.eventType,
    idempotencyKey: request.idempotencyKey,
    payload: request.payload,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    payloadSummary: summarisePayload(request.payload),
    createdAt: now,
    updatedAt: now,
  };

  return {
    event: newEvent,
    error: null,
  };
}

// === Apply Publish (state mutation) ===

export function applyPublish(
  state: CapabilityState,
  result: PublishResult
): CapabilityState | CapabilityError {
  if (result.error !== null) {
    return result.error;
  }
  if (result.event === null) {
    return {
      kind: 'DUPLICATE_EVENT',
      message: 'No event to publish',
    };
  }
  return {
    ...state,
    events: [...state.events, result.event],
  };
}

// === Redrive Event ===

export function redriveEvent(
  state: CapabilityState,
  request: RedriveRequest,
  auditFn: (record: RedriveAuditRecord) => CapabilityError | null
): RedriveResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { event: null, error: orgError };
  }

  const idError = validateEventId(request.eventId);
  if (idError !== null) {
    return { event: null, error: idError };
  }

  if (!state.postgresAvailable) {
    return {
      event: null,
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId: request.organisationId,
      },
    };
  }

  const existing = findEvent(
    state.events,
    request.organisationId,
    request.eventId
  );
  if (existing === undefined) {
    return {
      event: null,
      error: {
        kind: 'EVENT_NOT_FOUND',
        message: 'Event not found',
        organisationId: request.organisationId,
      },
    };
  }

  if (existing.status !== 'dead_letter') {
    return {
      event: null,
      error: {
        kind: 'INVALID_STATUS',
        message: `Cannot redrive event in status: ${existing.status}`,
        organisationId: request.organisationId,
      },
    };
  }

  // Audit before change
  const auditRecord: RedriveAuditRecord = {
    kind: 'REDRIVEN',
    eventId: existing.id,
    organisationId: existing.organisationId,
    previousStatus: existing.status,
    timestamp: new Date().toISOString(),
  };

  const auditError = auditFn(auditRecord);
  if (auditError !== null) {
    return { event: null, error: auditError };
  }

  // Create fresh pending event with new idempotency key
  const now = new Date().toISOString();
  const redrivenEvent: PlatformEvent = {
    id: generateId(),
    organisationId: existing.organisationId,
    eventType: existing.eventType,
    idempotencyKey: `redrive_${existing.idempotencyKey}_${now}`,
    payload: existing.payload,
    status: 'pending',
    attempts: 0,
    maxAttempts: existing.maxAttempts,
    lastError: null,
    payloadSummary: existing.payloadSummary,
    createdAt: now,
    updatedAt: now,
  };

  return {
    event: redrivenEvent,
    error: null,
  };
}

// === Apply Redrive (state mutation) ===

export function applyRedrive(
  state: CapabilityState,
  result: RedriveResult
): CapabilityState | CapabilityError {
  if (result.error !== null) {
    return result.error;
  }
  if (result.event === null) {
    return {
      kind: 'EVENT_NOT_FOUND',
      message: 'No event to redrive',
    };
  }
  return {
    ...state,
    events: [...state.events, result.event],
  };
}

// === List Events ===

export function listEvents(
  state: CapabilityState,
  request: ListRequest
): ListResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { events: null, error: orgError };
  }

  if (!checkPermission(request.token, Permission.EVENTS_READ)) {
    return {
      events: null,
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Missing platform.events.read permission',
        organisationId: request.organisationId,
      },
    };
  }

  const filtered = state.events.filter(
    (e) => e.organisationId === request.organisationId
  );

  return { events: filtered, error: null };
}

// === List Dead-Letter Events ===

export function listDeadLetterEvents(
  state: CapabilityState,
  request: ListRequest
): ListResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { events: null, error: orgError };
  }

  if (!checkPermission(request.token, Permission.EVENTS_READ)) {
    return {
      events: null,
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Missing platform.events.read permission',
        organisationId: request.organisationId,
      },
    };
  }

  const filtered = state.events.filter(
    (e) => e.organisationId === request.organisationId && e.status === 'dead_letter'
  );

  return { events: filtered, error: null };
}

// === Worker Heartbeat ===

export function recordHeartbeat(
  state: CapabilityState,
  request: HeartbeatRequest
): HeartbeatResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { heartbeat: null, error: orgError };
  }

  if (!state.postgresAvailable) {
    return {
      heartbeat: null,
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId: request.organisationId,
      },
    };
  }

  const now = new Date().toISOString();
  const heartbeat: WorkerHeartbeat = {
    workerId: request.workerId,
    organisationId: request.organisationId,
    liveness: request.liveness,
    lastSeen: now,
  };

  return { heartbeat, error: null };
}

// === Apply Heartbeat (state mutation) ===

export function applyHeartbeat(
  state: CapabilityState,
  result: HeartbeatResult
): CapabilityState | CapabilityError {
  if (result.error !== null) {
    return result.error;
  }
  if (result.heartbeat === null) {
    return {
      kind: 'AUDIT_FAILURE',
      message: 'No heartbeat to record',
    };
  }
  return {
    ...state,
    heartbeats: [...state.heartbeats, result.heartbeat],
  };
}

// === Readiness ===

export function checkReadiness(
  state: CapabilityState,
  token: { readonly permissions: readonly string[] }
): ReadinessResult {
  const eventQueueVisible = checkPermission(token, Permission.EVENTS_READ);
  const deadLetterQueueVisible = checkPermission(token, Permission.EVENTS_READ);
  const workerHeartbeatLiveness: WorkerLiveness =
    state.heartbeats.length > 0
      ? state.heartbeats[state.heartbeats.length - 1].liveness
      : 'stopped';
  const mutationPathsEnabled = state.postgresAvailable;

  return {
    eventQueueVisible,
    deadLetterQueueVisible,
    workerHeartbeatLiveness,
    postgresAvailable: state.postgresAvailable,
    mutationPathsEnabled,
  };
}

// === Process Event (worker processing) ===

export interface ProcessRequest {
  readonly organisationId: string;
  readonly eventId: string;
  readonly workerId: string;
}

export interface ProcessResult {
  readonly updatedEvent: PlatformEvent | null;
  readonly error: CapabilityError | null;
}

export function processEvent(
  state: CapabilityState,
  request: ProcessRequest
): ProcessResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { updatedEvent: null, error: orgError };
  }

  const idError = validateEventId(request.eventId);
  if (idError !== null) {
    return { updatedEvent: null, error: idError };
  }

  if (!state.postgresAvailable) {
    return {
      updatedEvent: null,
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId: request.organisationId,
      },
    };
  }

  const existing = findEvent(
    state.events,
    request.organisationId,
    request.eventId
  );
  if (existing === undefined) {
    return {
      updatedEvent: null,
      error: {
        kind: 'EVENT_NOT_FOUND',
        message: 'Event not found',
        organisationId: request.organisationId,
      },
    };
  }

  if (existing.status !== 'pending') {
    return {
      updatedEvent: null,
      error: {
        kind: 'INVALID_STATUS',
        message: `Cannot process event in status: ${existing.status}`,
        organisationId: request.organisationId,
      },
    };
  }

  const now = new Date().toISOString();
  const updatedEvent: PlatformEvent = {
    ...existing,
    status: 'processing',
    attempts: existing.attempts + 1,
    updatedAt: now,
  };

  return {
    updatedEvent,
    error: null,
  };
}

// === Apply Process (state mutation) ===

export function applyProcess(
  state: CapabilityState,
  result: ProcessResult
): CapabilityState | CapabilityError {
  if (result.error !== null) {
    return result.error;
  }
  if (result.updatedEvent === null) {
    return {
      kind: 'EVENT_NOT_FOUND',
      message: 'No event to process',
    };
  }

  const updatedEvents = state.events.map((e) =>
    e.id === result.updatedEvent.id && e.organisationId === result.updatedEvent.organisationId
      ? result.updatedEvent
      : e
  );

  return {
    ...state,
    events: updatedEvents,
  };
}

// === Fail Event (worker failure) ===

export interface FailRequest {
  readonly organisationId: string;
  readonly eventId: string;
  readonly errorMessage: string;
}

export interface FailResult {
  readonly updatedEvent: PlatformEvent | null;
  readonly error: CapabilityError | null;
}

export function failEvent(
  state: CapabilityState,
  request: FailRequest
): FailResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { updatedEvent: null, error: orgError };
  }

  const idError = validateEventId(request.eventId);
  if (idError !== null) {
    return { updatedEvent: null, error: idError };
  }

  if (!state.postgresAvailable) {
    return {
      updatedEvent: null,
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId: request.organisationId,
      },
    };
  }

  const existing = findEvent(
    state.events,
    request.organisationId,
    request.eventId
  );
  if (existing === undefined) {
    return {
      updatedEvent: null,
      error: {
        kind: 'EVENT_NOT_FOUND',
        message: 'Event not found',
        organisationId: request.organisationId,
      },
    };
  }

  if (existing.status !== 'processing') {
    return {
      updatedEvent: null,
      error: {
        kind: 'INVALID_STATUS',
        message: `Cannot fail event in status: ${existing.status}`,
        organisationId: request.organisationId,
      },
    };
  }

  const now = new Date().toISOString();
  const attempts = existing.attempts + 1;
  const maxAttempts = existing.maxAttempts;

  if (attempts >= maxAttempts) {
    const updatedEvent: PlatformEvent = {
      ...existing,
      status: 'dead_letter',
      attempts,
      lastError: request.errorMessage,
      updatedAt: now,
    };
    return { updatedEvent, error: null };
  }

  const updatedEvent: PlatformEvent = {
    ...existing,
    status: 'pending',
    attempts,
    lastError: request.errorMessage,
    updatedAt: now,
  };

  return { updatedEvent, error: null };
}

// === Apply Fail (state mutation) ===

export function applyFail(
  state: CapabilityState,
  result: FailResult
): CapabilityState | CapabilityError {
  if (result.error !== null) {
    return result.error;
  }
  if (result.updatedEvent === null) {
    return {
      kind: 'EVENT_NOT_FOUND',
      message: 'No event to fail',
    };
  }

  const updatedEvents = state.events.map((e) =>
    e.id === result.updatedEvent.id && e.organisationId === result.updatedEvent.organisationId
      ? result.updatedEvent
      : e
  );

  return {
    ...state,
    events: updatedEvents,
  };
}

// === Complete Event (worker success) ===

export interface CompleteRequest {
  readonly organisationId: string;
  readonly eventId: string;
}

export interface CompleteResult {
  readonly updatedEvent: PlatformEvent | null;
  readonly error: CapabilityError | null;
}

export function completeEvent(
  state: CapabilityState,
  request: CompleteRequest
): CompleteResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { updatedEvent: null, error: orgError };
  }

  const idError = validateEventId(request.eventId);
  if (idError !== null) {
    return { updatedEvent: null, error: idError };
  }

  if (!state.postgresAvailable) {
    return {
      updatedEvent: null,
      error: {
        kind: 'POSTGRES_UNAVAILABLE',
        message: 'Postgres substrate unavailable',
        organisationId: request.organisationId,
      },
    };
  }

  const existing = findEvent(
    state.events,
    request.organisationId,
    request.eventId
  );
  if (existing === undefined) {
    return {
      updatedEvent: null,
      error: {
        kind: 'EVENT_NOT_FOUND',
        message: 'Event not found',
        organisationId: request.organisationId,
      },
    };
  }

  if (existing.status !== 'processing') {
    return {
      updatedEvent: null,
      error: {
        kind: 'INVALID_STATUS',
        message: `Cannot complete event in status: ${existing.status}`,
        organisationId: request.organisationId,
      },
    };
  }

  const now = new Date().toISOString();
  const updatedEvent: PlatformEvent = {
    ...existing,
    status: 'processed',
    updatedAt: now,
  };

  return { updatedEvent, error: null };
}

// === Apply Complete (state mutation) ===

export function applyComplete(
  state: CapabilityState,
  result: CompleteResult
): CapabilityState | CapabilityError {
  if (result.error !== null) {
    return result.error;
  }
  if (result.updatedEvent === null) {
    return {
      kind: 'EVENT_NOT_FOUND',
      message: 'No event to complete',
    };
  }

  const updatedEvents = state.events.map((e) =>
    e.id === result.updatedEvent.id && e.organisationId === result.updatedEvent.organisationId
      ? result.updatedEvent
      : e
  );

  return {
    ...state,
    events: updatedEvents,
  };
}