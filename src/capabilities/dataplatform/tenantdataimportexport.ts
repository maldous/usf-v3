import * as crypto from 'node:crypto';

export const TenantDataImportExportStatus = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
] as const;
export type TenantDataImportExportStatus = typeof TenantDataImportExportStatus[number];

export const TenantDataImportExportReadiness = [
  'READY',
  'DEGRADED',
  'NOT_READY',
] as const;
export type TenantDataImportExportReadiness = typeof TenantDataImportExportReadiness[number];

export const TenantDataImportExportErrorKind = [
  'PERMISSION_DENIED',
  'INVALID_ARCHIVE',
  'DIGEST_MISMATCH',
  'INTEGRITY_CHECK_FAILED',
  'ARCHIVE_BUILDER_UNAVAILABLE',
  'IMPORT_APPLIER_UNAVAILABLE',
  'AUDIT_FAILURE',
  'TENANT_ISOLATION_VIOLATION',
  'UNIT_PROCESSING_FAILED',
  'FAIL_CLOSED_CONFIGURATION_ERROR',
  'PROMOTION_BLOCKED',
] as const;
export type TenantDataImportExportErrorKind = typeof TenantDataImportExportErrorKind[number];

export const TenantDataImportExportIncidentClass = [
  'TENANT_DATA_OR_SECURITY',
] as const;
export type TenantDataImportExportIncidentClass = typeof TenantDataImportExportIncidentClass[number];

export const TenantDataImportExportProofStatus = [
  'PENDING',
  'VERIFIED',
  'FAILED',
] as const;
export type TenantDataImportExportProofStatus = typeof TenantDataImportExportProofStatus[number];

export const TenantDataImportExportOperation = [
  'EXPORT',
  'IMPORT',
] as const;
export type TenantDataImportExportOperation = typeof TenantDataImportExportOperation[number];

export interface TenantDataImportExportSpan {
  readonly route: string;
  readonly useCase: string;
  readonly provider: string;
  readonly tenantId: string;
}

export interface TenantDataImportExportAuditEvent {
  readonly kind: 'IMPORT_EXPORT_AUDIT';
  readonly tenantId: string;
  readonly operation: TenantDataImportExportOperation;
  readonly span: TenantDataImportExportSpan;
  readonly archiveDigest: string | null;
  readonly timestamp: string;
  readonly actor: string;
}

export interface TenantDataImportExportError {
  readonly kind: TenantDataImportExportErrorKind;
  readonly message: string;
  readonly tenantId: string;
  readonly incidentClass: TenantDataImportExportIncidentClass;
  readonly risk: 'TENANT_DATA_LOSS' | 'NONE';
  readonly details?: unknown;
}

export interface TenantDataImportExportProgress {
  readonly tenantId: string;
  readonly archiveDigest: string;
  readonly status: TenantDataImportExportStatus;
  readonly completedUnits: readonly string[];
  readonly failedUnit: string | null;
  readonly lastUpdated: string;
}

export interface EncryptedArchive {
  readonly tenantId: string;
  readonly contentDigest: string;
  readonly encryptedData: string;
  readonly isEncrypted: true;
  readonly isCompressed: true;
  readonly unitCount: number;
}

export interface DataUnit {
  readonly id: string;
  readonly tenantId: string;
  readonly payload: unknown;
}

export interface ArchiveBuilderPort {
  readonly isAvailable: () => boolean;
  readonly buildEncryptedArchive: (
    tenantId: string,
    units: readonly DataUnit[],
  ) => { readonly ok: true; readonly archive: EncryptedArchive } | { readonly ok: false; readonly error: TenantDataImportExportError };
}

export interface PostgresApplierPort {
  readonly isAvailable: () => boolean;
  readonly applyUnit: (
    tenantId: string,
    unit: DataUnit,
  ) => { readonly ok: true } | { readonly ok: false; readonly error: string };
  readonly decryptAndDecompressUnits: (
    archive: EncryptedArchive,
  ) => { readonly ok: true; readonly units: readonly DataUnit[] } | { readonly ok: false; readonly error: string };
}

export interface TenantDataImportExportConfig {
  readonly enableExport: boolean;
  readonly enableImport: boolean;
  readonly enforceTenantIsolation: boolean;
  readonly requireStrictAudit: boolean;
}

export interface TenantDataImportExportState {
  readonly progressRecords: readonly TenantDataImportExportProgress[];
  readonly readiness: TenantDataImportExportReadiness;
  readonly proofStatus: TenantDataImportExportProofStatus;
  readonly lastError: TenantDataImportExportError | null;
}

export const initialTenantDataImportExportState: TenantDataImportExportState = {
  progressRecords: [],
  readiness: 'NOT_READY',
  proofStatus: 'PENDING',
  lastError: null,
};

export function checkReadiness(
  builder: ArchiveBuilderPort,
  applier: PostgresApplierPort,
): TenantDataImportExportReadiness {
  const builderAvailable = builder.isAvailable();
  const applierAvailable = applier.isAvailable();

  if (builderAvailable && applierAvailable) {
    return 'READY';
  }
  if (builderAvailable || applierAvailable) {
    return 'DEGRADED';
  }
  return 'NOT_READY';
}

export function auditOperation(
  event: TenantDataImportExportAuditEvent,
  auditFn: (evt: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): { readonly ok: true } | { readonly ok: false; readonly error: TenantDataImportExportError } {
  try {
    const error = auditFn(event);
    if (error !== null) {
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'AUDIT_FAILURE',
        message: err instanceof Error ? err.message : 'Audit logger failure',
        tenantId: event.tenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }
}

export function validateArchiveIntegrity(
  archive: unknown,
  expectedTenantId: string,
): { readonly ok: true; readonly validatedArchive: EncryptedArchive } | { readonly ok: false; readonly error: TenantDataImportExportError } {
  if (
    archive === null ||
    typeof archive !== 'object' ||
    !('tenantId' in archive) ||
    !('contentDigest' in archive) ||
    !('encryptedData' in archive) ||
    !('isEncrypted' in archive) ||
    !('isCompressed' in archive) ||
    !('unitCount' in archive)
  ) {
    return {
      ok: false,
      error: {
        kind: 'INVALID_ARCHIVE',
        message: 'Archive format is invalid or malformed',
        tenantId: expectedTenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }

  const candidate = archive as EncryptedArchive;

  if (candidate.tenantId !== expectedTenantId) {
    return {
      ok: false,
      error: {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: `Archive tenant ${candidate.tenantId} does not match expected tenant ${expectedTenantId}`,
        tenantId: expectedTenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }

  if (candidate.isEncrypted !== true || candidate.isCompressed !== true) {
    return {
      ok: false,
      error: {
        kind: 'INTEGRITY_CHECK_FAILED',
        message: 'Archive must be encrypted and compressed',
        tenantId: expectedTenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }

  if (typeof candidate.contentDigest !== 'string' || candidate.contentDigest.trim().length === 0) {
    return {
      ok: false,
      error: {
        kind: 'DIGEST_MISMATCH',
        message: 'Archive content digest is missing or empty',
        tenantId: expectedTenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }

  return { ok: true, validatedArchive: candidate };
}

export function exportTenantData(
  state: TenantDataImportExportState,
  config: TenantDataImportExportConfig,
  tenantId: string,
  actor: string,
  units: readonly DataUnit[],
  builder: ArchiveBuilderPort,
  auditFn: (evt: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): { readonly ok: true; readonly state: TenantDataImportExportState; readonly archive: EncryptedArchive } | { readonly ok: false; readonly state: TenantDataImportExportState; readonly error: TenantDataImportExportError } {
  if (!config.enableExport || !config.enforceTenantIsolation) {
    const error: TenantDataImportExportError = {
      kind: 'FAIL_CLOSED_CONFIGURATION_ERROR',
      message: 'Export is disabled or misconfigured',
      tenantId,
      incidentClass: 'TENANT_DATA_OR_SECURITY',
      risk: 'TENANT_DATA_LOSS',
    };
    return { ok: false, state: { ...state, lastError: error }, error };
  }

  if (!builder.isAvailable()) {
    const error: TenantDataImportExportError = {
      kind: 'ARCHIVE_BUILDER_UNAVAILABLE',
      message: 'Archive builder is unavailable',
      tenantId,
      incidentClass: 'TENANT_DATA_OR_SECURITY',
      risk: 'NONE',
    };
    return {
      ok: false,
      state: { ...state, readiness: 'DEGRADED', lastError: error },
      error,
    };
  }

  for (const unit of units) {
    if (unit.tenantId !== tenantId) {
      const error: TenantDataImportExportError = {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: `Cross-tenant unit detected: expected ${tenantId}, found ${unit.tenantId}`,
        tenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      };
      return { ok: false, state: { ...state, lastError: error }, error };
    }
  }

  const span: TenantDataImportExportSpan = {
    route: '/api/v1/tenant/export',
    useCase: 'TenantDataExport',
    provider: 'PostgresToArchiveBuilder',
    tenantId,
  };

  const auditResult = auditOperation(
    {
      kind: 'IMPORT_EXPORT_AUDIT',
      tenantId,
      operation: 'EXPORT',
      span,
      archiveDigest: null,
      timestamp: new Date().toISOString(),
      actor,
    },
    auditFn,
  );

  if (!auditResult.ok) {
    return {
      ok: false,
      state: { ...state, lastError: auditResult.error },
      error: auditResult.error,
    };
  }

  const buildResult = builder.buildEncryptedArchive(tenantId, units);
  if (!buildResult.ok) {
    return {
      ok: false,
      state: { ...state, lastError: buildResult.error },
      error: buildResult.error,
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      readiness: 'READY',
      lastError: null,
    },
    archive: buildResult.archive,
  };
}

export function importTenantData(
  state: TenantDataImportExportState,
  config: TenantDataImportExportConfig,
  tenantId: string,
  actor: string,
  archive: unknown,
  applier: PostgresApplierPort,
  auditFn: (evt: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): { readonly ok: true; readonly state: TenantDataImportExportState; readonly progress: TenantDataImportExportProgress } | { readonly ok: false; readonly state: TenantDataImportExportState; readonly error: TenantDataImportExportError; readonly progress?: TenantDataImportExportProgress } {
  if (!config.enableImport || !config.enforceTenantIsolation) {
    const error: TenantDataImportExportError = {
      kind: 'FAIL_CLOSED_CONFIGURATION_ERROR',
      message: 'Import is disabled or misconfigured',
      tenantId,
      incidentClass: 'TENANT_DATA_OR_SECURITY',
      risk: 'TENANT_DATA_LOSS',
    };
    return { ok: false, state: { ...state, lastError: error }, error };
  }

  if (!applier.isAvailable()) {
    const error: TenantDataImportExportError = {
      kind: 'IMPORT_APPLIER_UNAVAILABLE',
      message: 'Postgres import applier is unavailable',
      tenantId,
      incidentClass: 'TENANT_DATA_OR_SECURITY',
      risk: 'NONE',
    };
    return {
      ok: false,
      state: { ...state, readiness: 'DEGRADED', lastError: error },
      error,
    };
  }

  const validationResult = validateArchiveIntegrity(archive, tenantId);
  if (!validationResult.ok) {
    return {
      ok: false,
      state: { ...state, lastError: validationResult.error },
      error: validationResult.error,
    };
  }

  const validatedArchive = validationResult.validatedArchive;

  const span: TenantDataImportExportSpan = {
    route: '/api/v1/tenant/import',
    useCase: 'TenantDataImport',
    provider: 'PostgresApplier',
    tenantId,
  };

  const auditResult = auditOperation(
    {
      kind: 'IMPORT_EXPORT_AUDIT',
      tenantId,
      operation: 'IMPORT',
      span,
      archiveDigest: validatedArchive.contentDigest,
      timestamp: new Date().toISOString(),
      actor,
    },
    auditFn,
  );

  if (!auditResult.ok) {
    return {
      ok: false,
      state: { ...state, lastError: auditResult.error },
      error: auditResult.error,
    };
  }

  const existingProgress = state.progressRecords.find(
    (p) => p.tenantId === tenantId && p.archiveDigest === validatedArchive.contentDigest,
  );

  if (existingProgress !== undefined && existingProgress.status === 'COMPLETED') {
    return {
      ok: true,
      state,
      progress: existingProgress,
    };
  }

  const initialCompletedUnits: readonly string[] = existingProgress ? existingProgress.completedUnits : [];
  const completedUnitsSet = new Set<string>(initialCompletedUnits);

  const unpackResult = applier.decryptAndDecompressUnits(validatedArchive);
  if (!unpackResult.ok) {
    const error: TenantDataImportExportError = {
      kind: 'INVALID_ARCHIVE',
      message: `Failed to unpack archive: ${unpackResult.error}`,
      tenantId,
      incidentClass: 'TENANT_DATA_OR_SECURITY',
      risk: 'TENANT_DATA_LOSS',
    };
    return { ok: false, state: { ...state, lastError: error }, error };
  }

  const units = unpackResult.units;
  const currentCompleted: string[] = [...initialCompletedUnits];

  for (const unit of units) {
    if (unit.tenantId !== tenantId) {
      const error: TenantDataImportExportError = {
        kind: 'TENANT_ISOLATION_VIOLATION',
        message: `Archive contains unit belonging to another tenant: ${unit.tenantId}`,
        tenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      };
      const failedProgress: TenantDataImportExportProgress = {
        tenantId,
        archiveDigest: validatedArchive.contentDigest,
        status: 'FAILED',
        completedUnits: currentCompleted,
        failedUnit: unit.id,
        lastUpdated: new Date().toISOString(),
      };
      const updatedRecords = upsertProgress(state.progressRecords, failedProgress);
      return {
        ok: false,
        state: { ...state, progressRecords: updatedRecords, lastError: error },
        error,
        progress: failedProgress,
      };
    }

    if (completedUnitsSet.has(unit.id)) {
      continue;
    }

    const applyResult = applier.applyUnit(tenantId, unit);
    if (!applyResult.ok) {
      const error: TenantDataImportExportError = {
        kind: 'UNIT_PROCESSING_FAILED',
        message: `Failed to apply unit ${unit.id}: ${applyResult.error}`,
        tenantId,
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      };
      const failedProgress: TenantDataImportExportProgress = {
        tenantId,
        archiveDigest: validatedArchive.contentDigest,
        status: 'FAILED',
        completedUnits: currentCompleted,
        failedUnit: unit.id,
        lastUpdated: new Date().toISOString(),
      };
      const updatedRecords = upsertProgress(state.progressRecords, failedProgress);
      return {
        ok: false,
        state: { ...state, progressRecords: updatedRecords, lastError: error },
        error,
        progress: failedProgress,
      };
    }

    currentCompleted.push(unit.id);
    completedUnitsSet.add(unit.id);
  }

  const completedProgress: TenantDataImportExportProgress = {
    tenantId,
    archiveDigest: validatedArchive.contentDigest,
    status: 'COMPLETED',
    completedUnits: currentCompleted,
    failedUnit: null,
    lastUpdated: new Date().toISOString(),
  };

  const updatedRecords = upsertProgress(state.progressRecords, completedProgress);

  return {
    ok: true,
    state: {
      ...state,
      progressRecords: updatedRecords,
      readiness: 'READY',
      lastError: null,
    },
    progress: completedProgress,
  };
}

export function evaluatePromotionBlockers(
  state: TenantDataImportExportState,
  proofStatus: TenantDataImportExportProofStatus,
  hasIsolationSignal: boolean,
  hasAuditSignal: boolean,
): { readonly canPromote: true } | { readonly canPromote: false; readonly error: TenantDataImportExportError } {
  if (state.readiness !== 'READY') {
    return {
      canPromote: false,
      error: {
        kind: 'PROMOTION_BLOCKED',
        message: `Readiness is ${state.readiness}, promotion blocked`,
        tenantId: 'SYSTEM',
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }

  if (proofStatus !== 'VERIFIED') {
    return {
      canPromote: false,
      error: {
        kind: 'PROMOTION_BLOCKED',
        message: `Portability proof status is ${proofStatus}, promotion blocked`,
        tenantId: 'SYSTEM',
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }

  if (!hasIsolationSignal || !hasAuditSignal) {
    return {
      canPromote: false,
      error: {
        kind: 'PROMOTION_BLOCKED',
        message: 'Missing required isolation or audit signals for promotion',
        tenantId: 'SYSTEM',
        incidentClass: 'TENANT_DATA_OR_SECURITY',
        risk: 'TENANT_DATA_LOSS',
      },
    };
  }

  return { canPromote: true };
}

function upsertProgress(
  records: readonly TenantDataImportExportProgress[],
  updated: TenantDataImportExportProgress,
): readonly TenantDataImportExportProgress[] {
  const index = records.findIndex(
    (p) => p.tenantId === updated.tenantId && p.archiveDigest === updated.archiveDigest,
  );
  if (index >= 0) {
    const copy = [...records];
    copy[index] = updated;
    return copy;
  }
  return [...records, updated];
}