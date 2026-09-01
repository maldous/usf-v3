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
  readonly event?: PlatformEvent;
  readonly error?: CapabilityError;
}

export interface RedriveRequest {
  readonly organisationId: string;
  readonly eventId: string;
}

export interface RedriveResult {
  readonly event?: PlatformEvent;
  readonly error?: CapabilityError;
}

export interface ListRequest {
  readonly organisationId: string;
  readonly token: { readonly permissions: readonly string[] };
}

export interface ListResult {
  readonly events?: readonly PlatformEvent[];
  readonly error?: CapabilityError;
}

export interface HeartbeatRequest {
  readonly workerId: string;
  readonly organisationId: string;
  readonly liveness: WorkerLiveness;
}

export interface HeartbeatResult {
  readonly heartbeat?: WorkerHeartbeat;
  readonly error?: CapabilityError;
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
  auditFn?: (record: RedriveAuditRecord) => CapabilityError | null
): PublishResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { error: orgError };
  }

  if (!state.postgresAvailable) {
    return {
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
    return { event: duplicate };
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
): CapabilityState {
  if (result.error !== null || result.event === undefined) {
    return state;
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
    return { error: orgError };
  }

  const idError = validateEventId(request.eventId);
  if (idError !== null) {
    return { error: idError };
  }

  if (!state.postgresAvailable) {
    return {
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
      error: {
        kind: 'EVENT_NOT_FOUND',
        message: 'Event not found',
        organisationId: request.organisationId,
      },
    };
  }

  if (existing.status !== 'dead_letter') {
    return {
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
    return { error: auditError };
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
): CapabilityState {
  if (result.error !== null || result.event === undefined) {
    return state;
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
    return { error: orgError };
  }

  if (!checkPermission(request.token, Permission.EVENTS_READ)) {
    return {
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
    return { error: orgError };
  }

  if (!checkPermission(request.token, Permission.EVENTS_READ)) {
    return {
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Missing platform.events.read permission',
        organisationId: request.organisationId,
      },
    };
  }

  const filtered = state.events.filter(
    (e) =>
      e.organisationId === request.organisationId && e.status === 'dead_letter'
  );

  return { events: filtered, error: null };
}

// === List Workers ===

export function listWorkers(
  state: CapabilityState,
  request: ListRequest
): ListResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { error: orgError };
  }

  if (!checkPermission(request.token, Permission.WORKERS_READ)) {
    return {
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Missing platform.workers.read permission',
        organisationId: request.organisationId,
      },
    };
  }

  // Workers are derived from heartbeats
  const workerIds = new Set(
    state.heartbeats
      .filter((h) => h.organisationId === request.organisationId)
      .map((h) => h.workerId)
  );

  return {
    events: [],
    error: null,
  };
}

// === Report Heartbeat ===

export function reportHeartbeat(
  state: CapabilityState,
  request: HeartbeatRequest
): HeartbeatResult {
  const orgError = validateOrganisationId(request.organisationId);
  if (orgError !== null) {
    return { error: orgError };
  }

  if (!state.postgresAvailable) {
    return {
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

export function applyHeartbeat(
  state: CapabilityState,
  result: HeartbeatResult
): CapabilityState {
  if (result.error !== null || result.heartbeat === undefined) {
    return state;
  }

  const existing = state.heartbeats.find(
    (h) =>
      h.workerId === result.heartbeat!.workerId &&
      h.organisationId === result.heartbeat!.organisationId
  );

  let newHeartbeats: readonly WorkerHeartbeat[];
  if (existing !== undefined) {
    newHeartbeats = state.heartbeats.map((h) =>
      h === existing ? result.heartbeat! : h
    );
  } else {
    newHeartbeats = [...state.heartbeats, result.heartbeat];
  }

  return {
    ...state,
    heartbeats: newHeartbeats,
  };
}

// === Process Event (worker claim) ===

export function processEvent(
  state: CapabilityState,
  eventId: string,
  organisationId: string,
  handler: (payload: Record<string, unknown>) => { success: boolean; error?: string }
): CapabilityState {
  const event = findEvent(state.events, organisationId, eventId);
  if (event === undefined || event.status !== 'pending') {
    return state;
  }

  const now = new Date().toISOString();
  const processingEvent: PlatformEvent = {
    ...event,
    status: 'processing',
    updatedAt: now,
  };

  const handlerResult = handler(event.payload);
  let finalEvent: PlatformEvent;

  if (handlerResult.success) {
    finalEvent = {
      ...processingEvent,
      status: 'processed',
      updatedAt: now,
    };
  } else {
    const newAttempts = event.attempts + 1;
    if (newAttempts >= event.maxAttempts) {
      finalEvent = {
        ...processingEvent,
        status: 'dead_letter',
        attempts: newAttempts,
        lastError: handlerResult.error ?? 'Handler exhausted',
        updatedAt: now,
      };
    } else {
      finalEvent = {
        ...processingEvent,
        attempts: newAttempts,
        lastError: handlerResult.error ?? null,
        updatedAt: now,
      };
    }
  }

  return {
    ...state,
    events: state.events.map((e) => (e.id === event.id ? finalEvent : e)),
  };
}

// === Readiness Check ===

export function checkReadiness(state: CapabilityState): ReadinessResult {
  const eventQueueVisible = state.postgresAvailable;
  const deadLetterQueueVisible = state.postgresAvailable;
  const mutationPathsEnabled = state.postgresAvailable;

  let liveness: WorkerLiveness = 'stopped';
  const now = Date.now();
  const recentHeartbeats = state.heartbeats.filter((h) => {
    const lastSeen = new Date(h.lastSeen).getTime();
    return now - lastSeen < 30000; // 30 seconds
  });

  if (recentHeartbeats.length > 0) {
    liveness = 'alive';
  } else {
    const staleHeartbeats = state.heartbeats.filter((h) => {
      const lastSeen = new Date(h.lastSeen).getTime();
      return now - lastSeen < 300000; // 5 minutes
    });
    if (staleHeartbeats.length > 0) {
      liveness = 'stale';
    }
  }

  return {
    eventQueueVisible,
    deadLetterQueueVisible,
    workerHeartbeatLiveness: liveness,
    postgresAvailable: state.postgresAvailable,
    mutationPathsEnabled,
  };
}

// === Set Postgres Availability (for testing) ===

export function setPostgresAvailable(
  state: CapabilityState,
  available: boolean
): CapabilityState {
  return {
    ...state,
    postgresAvailable: available,
  };
}

// === Audit Function ===

export function createAuditFunction(
  state: CapabilityState
): (record: RedriveAuditRecord) => CapabilityError | null {
  return (record: RedriveAuditRecord): CapabilityError | null => {
    // Audit write must precede state mutation
    // In real implementation, this would write to audit log
    // For pure function testing, we validate the record
    if (record.eventId === '' || record.organisationId === '') {
      return {
        kind: 'AUDIT_FAILURE',
        message: 'Invalid audit record',
      };
    }
    return null;
  };
}

// === Validate Payload Contract ===

export function validatePayloadContract(
  eventType: string,
  payload: Record<string, unknown>
): CapabilityError | null {
  switch (eventType) {
    case 'tenant.config.changed':
      if (!('key' in payload)) {
        return {
          kind: 'SECRET_PAYLOAD',
          message: 'Missing required field: key',
        };
      }
      break;
    case 'report.run':
      if (!('reportId' in payload)) {
        return {
          kind: 'SECRET_PAYLOAD',
          message: 'Missing required field: reportId',
        };
      }
      break;
    default:
      // Generic event-bus path allows any payload (test fixtures excluded)
      break;
  }
  return null;
}