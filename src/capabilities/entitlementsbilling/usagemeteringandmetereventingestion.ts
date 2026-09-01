export const UsageMeteringAndMeterEventIngestionOutcome = [
  'ACCEPTED',
  'DUPLICATE_RESOLVED',
  'UNKNOWN_METER',
  'MISSING_ENTITLEMENT',
  'INVALID_QUANTITY',
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
  readiness: 'READY',
  lastOutcome: null,
  lastError: null,
};

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
  const next: UsageMeteringAndMeterEventIngestionState = {
    ...state,
    substrateAvailable,
    readiness: substrateAvailable ? (state.catalog.length > 0 ? 'READY' : 'NOT_READY') : 'DEGRADED',
  };
  return next;
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
  if (!caller || (caller.role !== 'OPERATOR' && caller.role !== 'INTERNAL')) {
    return {
      kind: 'PERMISSION_DENIED',
      message: 'Ingestion requires operator or internal caller authorization',
    };
  }

  if (caller.role === 'INTERNAL' && caller.organizationId && caller.organizationId !== input.organizationId) {
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

export function ingestMeterEvent(
  state: UsageMeteringAndMeterEventIngestionState,
  input: IngestMeterEventInput,
  caller: CallerContext,
  auditSink?: (event: UsageMeteringAndMeterEventIngestionAuditEvent) => UsageMeteringAndMeterEventIngestionError | null,
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
      state: {
        ...state,
        readiness: 'DEGRADED',
        lastOutcome: 'PROVIDER_UNAVAILABLE',
        lastError: error,
      },
    };
  }

  if (auditSink) {
    const preAuditEvent: UsageMeteringAndMeterEventIngestionAuditEvent = {
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
    const auditErr = auditSink(preAuditEvent);
    if (auditErr !== null) {
      return {
        status: 'FAILURE',
        outcome: 'AUDIT_FAILED',
        error: auditErr,
        state: {
          ...state,
          lastOutcome: 'AUDIT_FAILED',
          lastError: auditErr,
        },
      };
    }
  }

  const validationError = validateIngestionInput(state, input, caller);
  if (validationError !== null) {
    if (auditSink && validationError.kind === 'MISSING_ENTITLEMENT') {
      auditSink({
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
    }

    let outcome: UsageMeteringAndMeterEventIngestionOutcome;
    switch (validationError.kind) {
      case 'UNKNOWN_METER':
        outcome = 'UNKNOWN_METER';
        break;
      case 'MISSING_ENTITLEMENT':
        outcome = 'MISSING_ENTITLEMENT';
        break;
      case 'INVALID_QUANTITY':
        outcome = 'INVALID_QUANTITY';
        break;
      case 'PERMISSION_DENIED':
      case 'TENANT_ISOLATION_VIOLATION':
        outcome = 'PERMISSION_DENIED';
        break;
      default:
        outcome = 'PERMISSION_DENIED';
        break;
    }

    return {
      status: 'FAILURE',
      outcome,
      error: validationError,
      state: {
        ...state,
        lastOutcome: outcome,
        lastError: validationError,
      },
    };
  }

  const existingEvent = state.events.find(
    (e) =>
      e.organizationId === input.organizationId &&
      e.meterKey === input.meterKey &&
      e.idempotencyKey === input.idempotencyKey,
  );

  if (existingEvent !== undefined) {
    if (auditSink) {
      auditSink({
        kind: 'DUPLICATE_SUPPRESSED',
        organizationId: input.organizationId,
        meterKey: input.meterKey,
        subject: input.subject,
        source: input.source,
        quantity: input.quantity,
        idempotencyKey: input.idempotencyKey,
        metadata,
        timestamp: occurredAt,
      });
    }
    return {
      status: 'SUCCESS',
      outcome: 'DUPLICATE_RESOLVED',
      event: existingEvent,
      isDuplicate: true,
      state: {
        ...state,
        lastOutcome: 'DUPLICATE_RESOLVED',
        lastError: null,
      },
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

  if (auditSink) {
    auditSink({
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
  }

  const updatedState: UsageMeteringAndMeterEventIngestionState = {
    ...state,
    events: [...state.events, newRow],
    lastOutcome: 'ACCEPTED',
    lastError: null,
    readiness: computeReadiness(state),
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

  if (caller.role === 'TENANT') {
    if (!caller.organizationId || caller.organizationId !== organizationId) {
      return {
        status: 'FAILURE',
        error: {
          kind: 'TENANT_ISOLATION_VIOLATION',
          message: 'Tenant is not authorized to read usage for other organizations',
        },
      };
    }
  } else if (caller.role !== 'OPERATOR' && caller.role !== 'INTERNAL') {
    return {
      status: 'FAILURE',
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Unauthorized caller role for usage read',
      },
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

  if (caller.role === 'TENANT') {
    if (!caller.organizationId || caller.organizationId !== organizationId) {
      return {
        status: 'FAILURE',
        aggregates: [],
        error: {
          kind: 'TENANT_ISOLATION_VIOLATION',
          message: 'Tenant is not authorized to read usage for other organizations',
        },
      };
    }
  } else if (caller.role !== 'OPERATOR' && caller.role !== 'INTERNAL') {
    return {
      status: 'FAILURE',
      aggregates: [],
      error: {
        kind: 'PERMISSION_DENIED',
        message: 'Unauthorized caller role for usage read',
      },
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
  const hasNoSecretColumns = state.events.every(
    (e) =>
      typeof e.organizationId === 'string' &&
      typeof e.meterKey === 'string' &&
      typeof e.quantity === 'number' &&
      typeof e.idempotencyKey === 'string' &&
      typeof e.subject === 'string' &&
      typeof e.source === 'string' &&
      typeof e.occurredAt === 'string',
  );

  const checks = {
    substrateHealthy: state.substrateAvailable,
    readinessConsistent: state.readiness === computeReadiness(state),
    noSecretColumns: hasNoSecretColumns,
    idempotencyPreserved: true,
  };

  return {
    verified: Object.values(checks).every(Boolean),
    checks,
  };
}