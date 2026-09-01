export const TenantDataImportExportDecision = [
  'IMPORT_EXPORT_GRANTED',
  'TENANT_ISOLATION_VIOLATION',
  'ARCHIVE_INTEGRITY_FAILURE',
  'PROGRESS_RECORD_MISSING',
  'PROVIDER_UNAVAILABLE',
] as const;
export type TenantDataImportExportDecision = typeof TenantDataImportExportDecision[number];

export const TenantDataImportExportAuditEventKind = [
  'EXPORT_STARTED',
  'EXPORT_COMPLETED',
  'EXPORT_FAILED',
  'IMPORT_STARTED',
  'IMPORT_COMPLETED',
  'IMPORT_FAILED',
  'RESUME_ATTEMPTED',
] as const;
export type TenantDataImportExportAuditEventKind = typeof TenantDataImportExportAuditEventKind[number];

export const TenantDataImportExportErrorKind = [
  'TENANT_DATA_LOSS_RISK',
  'ARCHIVE_CORRUPT',
  'DIGEST_MISMATCH',
  'PROGRESS_CONFLICT',
  'PROVIDER_FAILURE',
  'PERMISSION_DENIED',
  'AUDIT_FAILURE',
] as const;
export type TenantDataImportExportErrorKind = typeof TenantDataImportExportErrorKind[number];

export const TenantDataImportExportReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type TenantDataImportExportReadiness = typeof TenantDataImportExportReadiness[number];

export interface TenantDataImportExportAuditEvent {
  readonly kind: TenantDataImportExportAuditEventKind;
  readonly tenantId: string;
  readonly archiveDigest: string | null;
  readonly unitCount: number | null;
  readonly failedUnit: string | null;
  readonly timestamp: string;
  readonly span: {
    readonly route: string;
    readonly useCase: string;
    readonly provider: string;
  };
}

export interface TenantDataImportExportError {
  readonly kind: TenantDataImportExportErrorKind;
  readonly message: string;
  readonly tenantId: string;
  readonly isDataLossRisk: boolean;
}

export interface ImportProgress {
  readonly tenantId: string;
  readonly archiveDigest: string;
  readonly completedUnits: readonly string[];
  readonly failedUnit: string | null;
}

export interface TenantDataImportExportState {
  readonly progressRecords: readonly ImportProgress[];
  readonly lastDecision: TenantDataImportExportDecision | null;
  readonly lastError: TenantDataImportExportError | null;
  readonly readiness: TenantDataImportExportReadiness;
  readonly archiveBuilderAvailable: boolean;
  readonly postgresApplierAvailable: boolean;
}

export const initialState: TenantDataImportExportState = {
  progressRecords: [],
  lastDecision: null,
  lastError: null,
  readiness: 'NOT_READY',
  archiveBuilderAvailable: false,
  postgresApplierAvailable: false,
};

export function computeReadiness(state: TenantDataImportExportState): TenantDataImportExportReadiness {
  if (!state.archiveBuilderAvailable || !state.postgresApplierAvailable) {
    return 'DEGRADED';
  }
  return 'READY';
}

export function auditOperation(
  tenantId: string,
  kind: TenantDataImportExportAuditEventKind,
  archiveDigest: string | null,
  unitCount: number | null,
  failedUnit: string | null,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportError | null {
  const event: TenantDataImportExportAuditEvent = {
    kind,
    tenantId,
    archiveDigest,
    unitCount,
    failedUnit,
    timestamp: new Date().toISOString(),
    span,
  };
  return auditFn(event);
}

export function startExport(
  state: TenantDataImportExportState,
  tenantId: string,
  archiveDigest: string,
  unitCount: number,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportState | TenantDataImportExportError {
  if (state.readiness === 'NOT_READY') {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Export provider not ready',
      tenantId,
      isDataLossRisk: false,
    };
  }

  const auditError = auditOperation(
    tenantId,
    'EXPORT_STARTED',
    archiveDigest,
    unitCount,
    null,
    span,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    lastDecision: 'IMPORT_EXPORT_GRANTED',
    lastError: null,
  };
}

export function completeExport(
  state: TenantDataImportExportState,
  tenantId: string,
  archiveDigest: string,
  unitCount: number,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportState | TenantDataImportExportError {
  const auditError = auditOperation(
    tenantId,
    'EXPORT_COMPLETED',
    archiveDigest,
    unitCount,
    null,
    span,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    lastDecision: 'IMPORT_EXPORT_GRANTED',
    lastError: null,
  };
}

export function failExport(
  state: TenantDataImportExportState,
  tenantId: string,
  archiveDigest: string,
  unitCount: number,
  failedUnit: string,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportState | TenantDataImportExportError {
  const auditError = auditOperation(
    tenantId,
    'EXPORT_FAILED',
    archiveDigest,
    unitCount,
    failedUnit,
    span,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    lastDecision: 'ARCHIVE_INTEGRITY_FAILURE',
    lastError: {
      kind: 'ARCHIVE_CORRUPT',
      message: `Export failed at unit ${failedUnit}`,
      tenantId,
      isDataLossRisk: true,
    },
  };
}

export function startImport(
  state: TenantDataImportExportState,
  tenantId: string,
  archiveDigest: string,
  unitCount: number,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportState | TenantDataImportExportError {
  if (state.readiness === 'NOT_READY') {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Import provider not ready',
      tenantId,
      isDataLossRisk: false,
    };
  }

  const existingProgress = state.progressRecords.find(
    (record) => record.tenantId === tenantId && record.archiveDigest === archiveDigest,
  );
  if (existingProgress !== undefined) {
    return {
      kind: 'PROGRESS_CONFLICT',
      message: 'Import already in progress for this archive',
      tenantId,
      isDataLossRisk: false,
    };
  }

  const auditError = auditOperation(
    tenantId,
    'IMPORT_STARTED',
    archiveDigest,
    unitCount,
    null,
    span,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  const newProgress: ImportProgress = {
    tenantId,
    archiveDigest,
    completedUnits: [],
    failedUnit: null,
  };

  return {
    ...state,
    progressRecords: [...state.progressRecords, newProgress],
    lastDecision: 'IMPORT_EXPORT_GRANTED',
    lastError: null,
  };
}

export function recordImportProgress(
  state: TenantDataImportExportState,
  tenantId: string,
  archiveDigest: string,
  completedUnit: string,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportState | TenantDataImportExportError {
  const progressIndex = state.progressRecords.findIndex(
    (record) => record.tenantId === tenantId && record.archiveDigest === archiveDigest,
  );
  if (progressIndex === -1) {
    return {
      kind: 'PROGRESS_RECORD_MISSING',
      message: 'No progress record found for import',
      tenantId,
      isDataLossRisk: true,
    };
  }

  const progress = state.progressRecords[progressIndex];
  if (progress.completedUnits.includes(completedUnit)) {
    return state;
  }

  const newProgress: ImportProgress = {
    ...progress,
    completedUnits: [...progress.completedUnits, completedUnit],
  };

  const newProgressRecords = [...state.progressRecords];
  newProgressRecords[progressIndex] = newProgress;

  const auditError = auditOperation(
    tenantId,
    'IMPORT_COMPLETED',
    archiveDigest,
    newProgress.completedUnits.length,
    null,
    span,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    progressRecords: newProgressRecords,
    lastDecision: 'IMPORT_EXPORT_GRANTED',
    lastError: null,
  };
}

export function recordImportFailure(
  state: TenantDataImportExportState,
  tenantId: string,
  archiveDigest: string,
  failedUnit: string,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportState | TenantDataImportExportError {
  const progressIndex = state.progressRecords.findIndex(
    (record) => record.tenantId === tenantId && record.archiveDigest === archiveDigest,
  );
  if (progressIndex === -1) {
    return {
      kind: 'PROGRESS_RECORD_MISSING',
      message: 'No progress record found for import failure',
      tenantId,
      isDataLossRisk: true,
    };
  }

  const progress = state.progressRecords[progressIndex];
  if (progress.failedUnit !== null) {
    return state;
  }

  const newProgress: ImportProgress = {
    ...progress,
    failedUnit,
  };

  const newProgressRecords = [...state.progressRecords];
  newProgressRecords[progressIndex] = newProgress;

  const auditError = auditOperation(
    tenantId,
    'IMPORT_FAILED',
    archiveDigest,
    progress.completedUnits.length,
    failedUnit,
    span,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    progressRecords: newProgressRecords,
    lastDecision: 'ARCHIVE_INTEGRITY_FAILURE',
    lastError: {
      kind: 'ARCHIVE_CORRUPT',
      message: `Import failed at unit ${failedUnit}`,
      tenantId,
      isDataLossRisk: true,
    },
  };
}

export function resumeImport(
  state: TenantDataImportExportState,
  tenantId: string,
  archiveDigest: string,
  span: TenantDataImportExportAuditEvent['span'],
  auditFn: (event: TenantDataImportExportAuditEvent) => TenantDataImportExportError | null,
): TenantDataImportExportState | TenantDataImportExportError {
  const progressIndex = state.progressRecords.findIndex(
    (record) => record.tenantId === tenantId && record.archiveDigest === archiveDigest,
  );
  if (progressIndex === -1) {
    return {
      kind: 'PROGRESS_RECORD_MISSING',
      message: 'No progress record found for resume',
      tenantId,
      isDataLossRisk: true,
    };
  }

  const auditError = auditOperation(
    tenantId,
    'RESUME_ATTEMPTED',
    archiveDigest,
    null,
    null,
    span,
    auditFn,
  );
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    lastDecision: 'IMPORT_EXPORT_GRANTED',
    lastError: null,
  };
}

export function validateArchiveIntegrity(
  archiveDigest: string,
  expectedDigest: string,
): { readonly valid: boolean } | TenantDataImportExportError {
  if (archiveDigest !== expectedDigest) {
    return {
      kind: 'DIGEST_MISMATCH',
      message: 'Archive digest does not match expected value',
      tenantId: '',
      isDataLossRisk: true,
    };
  }
  return { valid: true };
}

export function checkTenantIsolation(
  state: TenantDataImportExportState,
  tenantId: string,
  targetTenantId: string,
): TenantDataImportExportDecision | TenantDataImportExportError {
  if (tenantId !== targetTenantId) {
    return {
      kind: 'TENANT_ISOLATION_VIOLATION',
      message: 'Cross-tenant operation detected',
      tenantId,
      isDataLossRisk: true,
    };
  }
  return 'IMPORT_EXPORT_GRANTED';
}

export function setProviderAvailability(
  state: TenantDataImportExportState,
  archiveBuilderAvailable: boolean,
  postgresApplierAvailable: boolean,
): TenantDataImportExportState {
  return {
    ...state,
    archiveBuilderAvailable,
    postgresApplierAvailable,
    readiness: computeReadiness({
      ...state,
      archiveBuilderAvailable,
      postgresApplierAvailable,
    }),
  };
}