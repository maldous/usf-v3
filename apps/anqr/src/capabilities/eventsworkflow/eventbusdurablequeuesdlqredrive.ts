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
  readonly reason: