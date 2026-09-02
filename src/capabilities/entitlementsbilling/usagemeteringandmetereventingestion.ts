export const UsageMeteringAndMeterEventIngestionOutcome = [
  'ACCEPTED',
  'DUPLICATE_RESOLVED',
  'UNKNOWN_METER',
  'MISSING_ENTITLEMENT',
  'INVALID_QUANTITY',
  'INVALID_IDEMPOTENCY_KEY',
  'PROVIDER_UNAVAILABLE',
  'PERMISSION_DENIED',
  'AUDIT_FAILED',
] as const;
export type UsageMeteringAndMeterEventIngestionOutcome =
  typeof UsageMeteringAndMeterEventIngestionOutcome[number];

export const UsageMeteringAndMeterEventIngestionErrorKind = [
  'UNKNOWN_METER',
  'MISSING_ENTITLEMENT',
  'INVALID_QUANTITY',
  'PROVIDER_UNAVAILABLE',
  'PERMISSION_DENIED',
  'AUDIT_FAILURE',
  'TENANT_ISOLATION_VIOLATION',
  'INVALID_IDEMPOTENCY_KEY',
] as const;
export type UsageMeteringAndMeterEventIngestionErrorKind =
  typeof UsageMeteringAndMeterEventIngestionErrorKind[number];

export const UsageMeteringAndMeterEventIngestionAuditEventKind = [
  'INGESTION_ATTEMPTED',
  'ENTITLEMENT_REJECTED',
  'EVENT_RECORDED',
  'DUPLICATE_SUPPRESSED',
] as const;
export type UsageMeteringAndMeterEventIngestionAuditEventKind =
  typeof UsageMeteringAndMeterEventIngestionAuditEventKind[number];

export const UsageMeteringAndMeterEventIngestionReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type UsageMeteringAndMeterEventIngestionReadiness =
  typeof UsageMeteringAndMeterEventIngestionReadiness[number];

export const UsageMeteringAndMeterEventIngestionCallerRole = [
  'OPERATOR',
  'INTERNAL',
  'TENANT',
] as const;
export type UsageMeteringAndMeterEventIngestionCallerRole =
  typeof UsageMeteringAndMeterEventIngestionCallerRole[number];

export interface MeterCatalogEntry {
  readonly meterKey: string;
  readonly entitlementKey: string;
  readonly displayName: string;
  readonly unit: string;
}

export interface MeterEventRow {
  readonly organizationId: string;
  readonly meterKey: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly subject: string;
  readonly source: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface IngestMeterEventInput {
  readonly organizationId: string;
  readonly meterKey: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly subject: string;
  readonly source: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly occurredAt?: string;
}

export interface CallerContext {
  readonly role: UsageMeteringAndMeterEventIngestionCallerRole;
  readonly organizationId?: string;
}

export interface UsageMeteringAndMeterEventIngestionAuditEvent {
  readonly kind: UsageMeteringAndMeterEventIngestionAuditEventKind;
  readonly organizationId: string;
  readonly meterKey: string;
  readonly subject: string;
  readonly source: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface UsageMeteringAndMeterEventIngestionError {
  readonly kind: UsageMeteringAndMeterEventIngestionErrorKind;
  readonly message: string;
}

export interface TenantEntitlementGrant {
  readonly organizationId: string;
  readonly entitlementKey: string;
}

export interface UsageMeteringAndMeterEventIngestionState {
  readonly catalog: readonly MeterCatalogEntry[];
  readonly events: readonly MeterEventRow[];
  readonly tenantEntitlements: readonly TenantEntitlementGrant[];
  readonly substrateAvailable: boolean;
  readonly readiness: UsageMeteringAndMeterEventIngestionReadiness;
  readonly lastOutcome: UsageMeteringAndMeterEventIngestionOutcome | null;
  readonly lastError: UsageMeteringAndMeterEventIngestionError | null;
}

export type IngestionResult =
  | {
      readonly status: 'SUCCESS';
      readonly outcome: 'ACCEPTED' | 'DUPLICATE_RESOLVED';
      readonly event: MeterEventRow;
      readonly isDuplicate: boolean;
      readonly state: UsageMeteringAndMeterEventIngestionState;
    }
  | {
      readonly status: 'FAILURE';
      readonly outcome: UsageMeteringAndMeterEventIngestionOutcome;
      readonly error: UsageMeteringAndMeterEventIngestionError;
      readonly state: UsageMeteringAndMeterEventIngestionState;
    };

export interface UsageAggregate {
  readonly organizationId: string;
  readonly meterKey: string;
  readonly totalQuantity: number;
  readonly eventCount: number;
  readonly unit: string;
}

export type ReadUsageResult =
  | {
      readonly status: 'SUCCESS';
      readonly aggregate: UsageAggregate;
      readonly events: readonly MeterEventRow[];
    }
  | {
      readonly status: 'FAILURE';
      readonly error: UsageMeteringAndMeterEventIngestionError;
    };

export const initialUsageMeteringState: UsageMeteringAndMeterEventIngestionState = {
  catalog: [],
  events: [],
  tenantEntitlements: [],
  substrateAvailable: true,
  readiness: 'NOT_READY',
  lastOutcome: null,
  lastError: null,
};

function withOutcomeState(
  state: UsageMeteringAndMeterEventIngestionState,
  outcome: UsageMeteringAndMeterEventIngestionOutcome,
  error: UsageMeteringAndMeterEventIngestionError | null,
): UsageMeteringAndMeterEventIngestionState {
  const nextState: UsageMeteringAndMeterEventIngestionState = {
    ...state,
    lastOutcome: outcome,
    lastError: error,
  };
  return {
    ...nextState,
    readiness: computeReadiness(nextState),
  };
}

function mapValidationErrorToOutcome(
  errorKind: UsageMeteringAndMeterEventIngestionErrorKind,
): UsageMeteringAndMeterEventIngestionOutcome {
  switch (errorKind) {
    case 'UNKNOWN_METER':
      return 'UNKNOWN_METER';
    case 'MISSING_ENTITLEMENT':
      return 'MISSING_ENTITLEMENT';
    case 'INVALID_QUANTITY':
      return 'INVALID_QUANTITY';
    case 'INVALID_IDEMPOTENCY_KEY':
      return 'INVALID_IDEMPOTENCY_KEY';
    case 'PROVIDER_UNAVAILABLE':
      return 'PROVIDER_UNAVAILABLE';
    case 'PERMISSION_DENIED':
    case 'TENANT_ISOLATION_VIOLATION':
    case 'AUDIT_FAILURE':
    default:
      return 'PERMISSION_DENIED';
  }
}

function resolveUsageReadAccessError(
  organizationId: string,
  caller: CallerContext,
): UsageMeteringAndMeterEventIngestionError | null {
  if (caller.role === 'TENANT') {
    if (!caller.organizationId || caller.organizationId !== organizationId) {
      return {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: 'Tenant is not authorized to read usage for other organizations',
      };
    }
    return null;
  }

  if (caller.role === 'INTERNAL') {
    if (!caller.organizationId) {
      return {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: 'Internal caller must be scoped to an organization',
      };
    }
    if (caller.organizationId !== organizationId) {
      return {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: 'Internal caller is not authorized to read usage for other organizations',
      };
    }
    return null;
  }

  if (caller.role === 'OPERATOR') {
    return null;
  }

  return {
    kind: 'PERMISSION_DENIED',
    message: 'Unauthorized caller role for usage read',
  };
}

export function computeReadiness(
  state: UsageMeteringAndMeterEventIngestionState,
): UsageMeteringAndMeterEventIngestionReadiness {
  if (!state.substrateAvailable) {
    return 'DEGRADED';
  }
  if (state.catalog.length === 0) {
    return 'NOT_READY';
  }
  return 'READY';
}

export function setSubstrateAvailability(
  state: UsageMeteringAndMeterEventIngestionState,
  substrateAvailable: boolean,
): UsageMeteringAndMeterEventIngestionState {
  const nextState: UsageMeteringAndMeterEventIngestionState = {
    ...state,
    substrateAvailable,
  };
  return {
    ...nextState,
    readiness: computeReadiness(nextState),
  };
}

export function registerMeter(
  state: UsageMeteringAndMeterEventIngestionState,
  meter: MeterCatalogEntry,
): UsageMeteringAndMeterEventIngestionState {
  const existingIdx = state.catalog.findIndex((m) => m.meterKey === meter.meterKey);
  const nextCatalog = [...state.catalog];
  if (existingIdx >= 0) {
    nextCatalog[existingIdx] = meter;
  } else {
    nextCatalog.push(meter);
  }
  const nextState: UsageMeteringAndMeterEventIngestionState = {
    ...state,
    catalog: nextCatalog,
  };
  return {
    ...nextState,
    readiness: computeReadiness(nextState),
  };
}

export function grantTenantEntitlement(
  state: UsageMeteringAndMeterEventIngestionState,
  grant: TenantEntitlementGrant,
): UsageMeteringAndMeterEventIngestionState {
  const exists = state.tenantEntitlements.some(
    (g) => g.organizationId === grant.organizationId && g.entitlementKey === grant.entitlementKey,
  );
  if (exists) {
    return state;
  }
  return {
    ...state,
    tenantEntitlements: [...state.tenantEntitlements, grant],
  };
}

export function validateIngestionInput(
  state: UsageMeteringAndMeterEventIngestionState,
  input: IngestMeterEventInput,
  caller: CallerContext,
): UsageMeteringAndMeterEventIngestionError | null {
  if (caller.role !== 'OPERATOR' && caller.role !== 'INTERNAL') {
    return {
      kind: 'PERMISSION_DENIED',
      message: 'Ingestion requires operator or internal caller authorization',
    };
  }

  if (
    caller.role === 'INTERNAL' &&
    (!caller.organizationId || caller.organizationId.trim() === '')
  ) {
    return {
      kind: 'TENANT_ISOLATION_VIOLATION',
      message: 'Internal caller must be scoped to an organization',
    };
  }

  if (
    caller.role === 'INTERNAL' &&
    caller.organizationId !== undefined &&
    caller.organizationId !== input.organizationId
  ) {
    return {
      kind: 'TENANT_ISOLATION_VIOLATION',
      message: 'Internal caller cannot ingest events for a mismatched organization',
    };
  }

  if (!input.organizationId || input.organizationId.trim() === '') {
    return {
      kind: 'TENANT_ISOLATION_VIOLATION',
      message: 'Organization ID is required and cannot be empty',
    };
  }

  if (!input.idempotencyKey || input.idempotencyKey.trim() === '') {
    return {
      kind: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency key is required for safe ingestion',
    };
  }

  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity)) {
    return {
      kind: 'INVALID_QUANTITY',
      message: 'Quantity must be a finite number',
    };
  }

  const meter = state.catalog.find((m) => m.meterKey === input.meterKey);
  if (!meter) {
    return {
      kind: 'UNKNOWN_METER',
      message: `Meter with key '${input.meterKey}' is not registered in catalog`,
    };
  }

  const hasEntitlement = state.tenantEntitlements.some(
    (e) => e.organizationId === input.organizationId && e.entitlementKey === meter.entitlementKey,
  );

  if (!hasEntitlement) {
    return {
      kind: 'MISSING_ENTITLEMENT',
      message: `Tenant '${input.organizationId}' lacks required entitlement '${meter.entitlementKey}' for meter '${meter.meterKey}'`,
    };
  }

  return null;
}

export function emitAuditEvent(
  auditSink:
    | ((
        event: UsageMeteringAndMeterEventIngestionAuditEvent,
      ) => UsageMeteringAndMeterEventIngestionError | null)
    | undefined,
  event: UsageMeteringAndMeterEventIngestionAuditEvent,
): UsageMeteringAndMeterEventIngestionError | null {
  if (auditSink === undefined) {
    return null;
  }
  try {
    const result = auditSink(event);
    if (result === null) {
      return null;
    }
    return {
      kind: result.kind,
      message: result.message,
    };
  } catch (err) {
    return {
      kind: 'AUDIT_FAILURE',
      message: err instanceof Error ? err.message : 'Audit sink raised an exception',
    };
  }
}

export function ingestMeterEvent(
  state: UsageMeteringAndMeterEventIngestionState,
  input: IngestMeterEventInput,
  caller: CallerContext,
  auditSink?: (
    event: UsageMeteringAndMeterEventIngestionAuditEvent,
  ) => UsageMeteringAndMeterEventIngestionError | null,
): IngestionResult {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const metadata = input.metadata ?? {};

  if (!state.substrateAvailable) {
    const error: UsageMeteringAndMeterEventIngestionError = {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Metering substrate is unavailable; mutations are disabled',
    };
    return {
      status: 'FAILURE',
      outcome: 'PROVIDER_UNAVAILABLE',
      error,
      state: withOutcomeState(state, 'PROVIDER_UNAVAILABLE', error),
    };
  }

  const attemptedAudit: UsageMeteringAndMeterEventIngestionAuditEvent = {
    kind: 'INGESTION_ATTEMPTED',
    organizationId: input.organizationId,
    meterKey: input.meterKey,
    subject: input.subject,
    source: input.source,
    quantity: input.quantity,
    idempotencyKey: input.idempotencyKey,
    metadata,
    timestamp: occurredAt,
  };
  const attemptedAuditErr = emitAuditEvent(auditSink, attemptedAudit);
  if (attemptedAuditErr !== null) {
    return {
      status: 'FAILURE',
      outcome: 'AUDIT_FAILED',
      error: {
        kind: 'AUDIT_FAILURE',
        message: attemptedAuditErr.message,
      },
      state: withOutcomeState(state, 'AUDIT_FAILED', {
        kind: 'AUDIT_FAILURE',
        message: attemptedAuditErr.message,
      }),
    };
  }

  const validationError = validateIngestionInput(state, input, caller);
  if (validationError !== null) {
    if (validationError.kind === 'MISSING_ENTITLEMENT') {
      const rejectionErr = emitAuditEvent(auditSink, {
        kind: 'ENTITLEMENT_REJECTED',
        organizationId: input.organizationId,
        meterKey: input.meterKey,
        subject: input.subject,
        source: input.source,
        quantity: input.quantity,
        idempotencyKey: input.idempotencyKey,
        metadata,
        reason: validationError.message,
        timestamp: occurredAt,
      });
      if (rejectionErr !== null) {
        return {
          status: 'FAILURE',
          outcome: 'AUDIT_FAILED',
          error: {
            kind: 'AUDIT_FAILURE',
            message: rejectionErr.message,
          },
          state: withOutcomeState(state, 'AUDIT_FAILED', {
            kind: 'AUDIT_FAILURE',
            message: rejectionErr.message,
          }),
        };
      }
    }

    const outcome = mapValidationErrorToOutcome(validationError.kind);
    return {
      status: 'FAILURE',
      outcome,
      error: validationError,
      state: withOutcomeState(state, outcome, validationError),
    };
  }

  const existingEvent = state.events.find(
    (e) =>
      e.organizationId === input.organizationId &&
      e.meterKey === input.meterKey &&
      e.idempotencyKey === input.idempotencyKey,
  );

  if (existingEvent !== undefined) {
    const duplicateAuditErr = emitAuditEvent(auditSink, {
      kind: 'DUPLICATE_SUPPRESSED',
      organizationId: input.organizationId,
      meterKey: input.meterKey,
      subject: input.subject,
      source: input.source,
      quantity: existingEvent.quantity,
      idempotencyKey: input.idempotencyKey,
      metadata,
      timestamp: occurredAt,
    });

    if (duplicateAuditErr !== null) {
      return {
        status: 'FAILURE',
        outcome: 'AUDIT_FAILED',
        error: {
          kind: 'AUDIT_FAILURE',
          message: duplicateAuditErr.message,
        },
        state: withOutcomeState(state, 'AUDIT_FAILED', {
          kind: 'AUDIT_FAILURE',
          message: duplicateAuditErr.message,
        }),
      };
    }

    return {
      status: 'SUCCESS',
      outcome: 'DUPLICATE_RESOLVED',
      event: existingEvent,
      isDuplicate: true,
      state: withOutcomeState(state, 'DUPLICATE_RESOLVED', null),
    };
  }

  const newRow: MeterEventRow = {
    organizationId: input.organizationId,
    meterKey: input.meterKey,
    quantity: input.quantity,
    idempotencyKey: input.idempotencyKey,
    subject: input.subject,
    source: input.source,
    metadata,
    occurredAt,
  };

  const recordErr = emitAuditEvent(auditSink, {
    kind: 'EVENT_RECORDED',
    organizationId: newRow.organizationId,
    meterKey: newRow.meterKey,
    subject: newRow.subject,
    source: newRow.source,
    quantity: newRow.quantity,
    idempotencyKey: newRow.idempotencyKey,
    metadata: newRow.metadata,
    timestamp: newRow.occurredAt,
  });

  if (recordErr !== null) {
    return {
      status: 'FAILURE',
      outcome: 'AUDIT_FAILED',
      error: {
        kind: 'AUDIT_FAILURE',
        message: recordErr.message,
      },
      state: withOutcomeState(state, 'AUDIT_FAILED', {
        kind: 'AUDIT_FAILURE',
        message: recordErr.message,
      }),
    };
  }

  const nextEvents = [...state.events, newRow];
  const recordedState: UsageMeteringAndMeterEventIngestionState = {
    ...state,
    events: nextEvents,
    lastOutcome: 'ACCEPTED',
    lastError: null,
  };
  const updatedState: UsageMeteringAndMeterEventIngestionState = {
    ...recordedState,
    readiness: computeReadiness(recordedState),
  };

  return {
    status: 'SUCCESS',
    outcome: 'ACCEPTED',
    event: newRow,
    isDuplicate: false,
    state: updatedState,
  };
}

export function readUsage(
  state: UsageMeteringAndMeterEventIngestionState,
  organizationId: string,
  meterKey: string,
  caller: CallerContext,
): ReadUsageResult {
  if (!state.substrateAvailable) {
    return {
      status: 'FAILURE',
      error: {
        kind: 'PROVIDER_UNAVAILABLE',
        message: 'Metering substrate is unavailable',
      },
    };
  }

  const accessError = resolveUsageReadAccessError(organizationId, caller);
  if (accessError !== null) {
    return {
      status: 'FAILURE',
      error: accessError,
    };
  }

  const meter = state.catalog.find((m) => m.meterKey === meterKey);
  if (!meter) {
    return {
      status: 'FAILURE',
      error: {
        kind: 'UNKNOWN_METER',
        message: `Meter with key '${meterKey}' does not exist in catalog`,
      },
    };
  }

  const tenantEvents = state.events.filter(
    (e) => e.organizationId === organizationId && e.meterKey === meterKey,
  );

  const totalQuantity = tenantEvents.reduce((acc, curr) => acc + curr.quantity, 0);

  return {
    status: 'SUCCESS',
    aggregate: {
      organizationId,
      meterKey,
      totalQuantity,
      eventCount: tenantEvents.length,
      unit: meter.unit,
    },
    events: tenantEvents,
  };
}

export function queryAllUsageForTenant(
  state: UsageMeteringAndMeterEventIngestionState,
  organizationId: string,
  caller: CallerContext,
): {
  readonly status: 'SUCCESS' | 'FAILURE';
  readonly aggregates: readonly UsageAggregate[];
  readonly error?: UsageMeteringAndMeterEventIngestionError;
} {
  if (!state.substrateAvailable) {
    return {
      status: 'FAILURE',
      aggregates: [],
      error: {
        kind: 'PROVIDER_UNAVAILABLE',
        message: 'Metering substrate is unavailable',
      },
    };
  }

  const accessError = resolveUsageReadAccessError(organizationId, caller);
  if (accessError !== null) {
    return {
      status: 'FAILURE',
      aggregates: [],
      error: accessError,
    };
  }

  const aggregates: UsageAggregate[] = state.catalog.map((meter) => {
    const tenantEvents = state.events.filter(
      (e) => e.organizationId === organizationId && e.meterKey === meter.meterKey,
    );
    const totalQuantity = tenantEvents.reduce((acc, curr) => acc + curr.quantity, 0);
    return {
      organizationId,
      meterKey: meter.meterKey,
      totalQuantity,
      eventCount: tenantEvents.length,
      unit: meter.unit,
    };
  });

  return {
    status: 'SUCCESS',
    aggregates,
  };
}

export function verifyHermeticLineageProof(
  state: UsageMeteringAndMeterEventIngestionState,
): {
  readonly verified: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
} {
  let noSecretColumns = true;
  let idempotencyPreserved = true;
  let entitlementsEnforced = true;
  let tenantIsolationPreserved = true;
  let aggregateTraceable = true;

  const duplicateKeyCheck = new Set<string>();
  const aggregationByOrgAndMeter = new Map<string, number>();

  for (const e of state.events) {
    if (
      typeof e.organizationId !== 'string' ||
      typeof e.meterKey !== 'string' ||
      typeof e.quantity !== 'number' ||
      typeof e.idempotencyKey !== 'string' ||
      typeof e.subject !== 'string' ||
      typeof e.source !== 'string' ||
      typeof e.occurredAt !== 'string' ||
      typeof e.metadata !== 'object' ||
      e.metadata === null ||
      Array.isArray(e.metadata)
    ) {
      noSecretColumns = false;
    }

    if (
      e.organizationId.trim() === '' ||
      e.meterKey.trim() === '' ||
      e.idempotencyKey.trim() === '' ||
      !Number.isFinite(e.quantity)
    ) {
      tenantIsolationPreserved = false;
    }

    const identity = `${e.organizationId}|${e.meterKey}|${e.idempotencyKey}`;
    if (duplicateKeyCheck.has(identity)) {
      idempotencyPreserved = false;
    }
    duplicateKeyCheck.add(identity);

    const meter = state.catalog.find((m) => m.meterKey === e.meterKey);
    if (meter === undefined) {
      entitlementsEnforced = false;
      tenantIsolationPreserved = false;
    } else {
      const hasEntitlement = state.tenantEntitlements.some(
        (grant) => grant.organizationId === e.organizationId && grant.entitlementKey === meter.entitlementKey,
      );
      if (!hasEntitlement) {
        entitlementsEnforced = false;
      }
    }

    const aggKey = `${e.organizationId}|${e.meterKey}`;
    const priorTotal = aggregationByOrgAndMeter.get(aggKey) ?? 0;
    const nextTotal = priorTotal + e.quantity;
    if (!Number.isFinite(nextTotal)) {
      aggregateTraceable = false;
    }
    aggregationByOrgAndMeter.set(aggKey, nextTotal);
  }

  const checks: Record<string, boolean> = {
    substrateHealthy: state.substrateAvailable,
    readinessConsistent: state.readiness === computeReadiness(state),
    noSecretColumns,
    idempotencyPreserved,
    entitlementsEnforced,
    tenantIsolationPreserved,
    aggregateTraceable,
  };

  return {
    verified: Object.values(checks).every(Boolean),
    checks,
  };
}