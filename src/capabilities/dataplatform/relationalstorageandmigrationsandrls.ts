import { createHash } from 'node:crypto';

export const RelationalStorageAndMigrationsAndRlsDecision = [
  'GRANTED',
  'DENIED',
  'DEGRADED',
  'READY',
  'NOT_READY',
  'MIGRATION_APPLIED',
  'MIGRATION_SKIPPED',
  'MIGRATION_FAILED',
  'CHECKSUM_MISMATCH',
  'AUDIT_RECORDED',
] as const;
export type RelationalStorageAndMigrationsAndRlsDecision = typeof RelationalStorageAndMigrationsAndRlsDecision[number];

export const RelationalStorageAndMigrationsAndRlsAuditEventKind = [
  'MIGRATION_APPLIED',
  'MIGRATION_SKIPPED',
  'MIGRATION_CHECKSUM_MISMATCH',
  'MIGRATION_FAILED',
  'TENANT_CONTEXT_SET',
  'RLS_PREDICATE_EVALUATED',
  'RESTORE_GUARD_CHECKED',
  'MIGRATION_ROLLBACK',
  'STATE_CHANGING_ACCESS',
] as const;
export type RelationalStorageAndMigrationsAndRlsAuditEventKind = typeof RelationalStorageAndMigrationsAndRlsAuditEventKind[number];

export const RelationalStorageAndMigrationsAndRlsErrorKind = [
  'CHECKSUM_MISMATCH',
  'MIGRATION_FAILED',
  'INVALID_CONFIGURATION',
  'PROVIDER_UNAVAILABLE',
  'READINESS_UNAVAILABLE',
  'AUDIT_FAILURE',
  'TENANT_CONTEXT_INVALID',
  'RESTORE_NOT_PERMITTED',
  'RLS_BYPASS_INVALID',
  'DEGRADED',
] as const;
export type RelationalStorageAndMigrationsAndRlsErrorKind = typeof RelationalStorageAndMigrationsAndRlsErrorKind[number];

export const RelationalStorageAndMigrationsAndRlsReadiness = ['READY', 'NOT_READY', 'DEGRADED'] as const;
export type RelationalStorageAndMigrationsAndRlsReadiness = typeof RelationalStorageAndMigrationsAndRlsReadiness[number];

export const RelationalStorageAndMigrationsAndRlsRoleKind = [
  'APPLICATION_ROLE',
  'BYPASS_ROLE',
  'MIGRATION_ROLE',
  'SYSTEM_ADMIN_ROLE',
] as const;
export type RelationalStorageAndMigrationsAndRlsRoleKind = typeof RelationalStorageAndMigrationsAndRlsRoleKind[number];

export interface RelationalStorageAndMigrationsAndRlsAuditEvent {
  readonly kind: RelationalStorageAndMigrationsAndRlsAuditEventKind;
  readonly tenantId: string | null;
  readonly organisationId: string | null;
  readonly migrationFile: string | null;
  readonly checksum: string | null;
  readonly timestamp: string;
  readonly details: Record<string, unknown>;
}

export interface RelationalStorageAndMigrationsAndRlsError {
  readonly kind: RelationalStorageAndMigrationsAndRlsErrorKind;
  readonly message: string;
  readonly tenantId: string | null;
  readonly organisationId: string | null;
  readonly isError: true;
}

export interface RelationalStorageAndMigrationsAndRlsMigrationFile {
  readonly fileName: string;
  readonly checksum: string;
  readonly content: string;
  readonly orderIndex: number;
  readonly decisionReferenceComment: string;
}

export interface RelationalStorageAndMigrationsAndRlsAppliedMigration {
  readonly fileName: string;
  readonly checksum: string;
  readonly appliedAt: string;
  readonly orderIndex: number;
  readonly decisionReferenceComment: string;
}

export interface RelationalStorageAndMigrationsAndRlsRole {
  readonly name: string;
  readonly kind: RelationalStorageAndMigrationsAndRlsRoleKind;
  readonly inherit: boolean;
  readonly bypassRls: boolean;
  readonly canLogin: boolean;
  readonly password: string | null;
}

export interface RelationalStorageAndMigrationsAndRlsTenantContext {
  readonly tenantId: string;
  readonly roleName: string;
  readonly isBypassRole: boolean;
  readonly organisationId: string | null;
}

export interface RelationalStorageAndMigrationsAndRlsRepositoryPort {
  readonly context: string;
  readonly operations: ReadonlyArray<string>;
}

export interface RelationalStorageAndMigrationsAndRlsState {
  readonly appliedMigrations: readonly RelationalStorageAndMigrationsAndRlsAppliedMigration[];
  readonly roles: readonly RelationalStorageAndMigrationsAndRlsRole[];
  readonly tenantContexts: readonly RelationalStorageAndMigrationsAndRlsTenantContext[];
  readonly connected: boolean;
  readonly substrateAvailable: boolean;
  readonly ledgerNonEmpty: boolean;
  readonly crossTenantIsolationProven: boolean;
  readonly lastError: RelationalStorageAndMigrationsAndRlsError | null;
  readonly readiness: RelationalStorageAndMigrationsAndRlsReadiness;
  readonly auditLog: readonly RelationalStorageAndMigrationsAndRlsAuditEvent[];
  readonly migrationLineage: readonly string[];
}

export const initialState: RelationalStorageAndMigrationsAndRlsState = {
  appliedMigrations: [],
  roles: [],
  tenantContexts: [],
  connected: false,
  substrateAvailable: false,
  ledgerNonEmpty: false,
  crossTenantIsolationProven: false,
  lastError: null,
  readiness: 'NOT_READY',
  auditLog: [],
  migrationLineage: [],
};

export function createAuditEvent(
  kind: RelationalStorageAndMigrationsAndRlsAuditEventKind,
  tenantId: string | null,
  organisationId: string | null,
  migrationFile: string | null,
  checksum: string | null,
  details: Record<string, unknown>,
): RelationalStorageAndMigrationsAndRlsAuditEvent {
  return {
    kind,
    tenantId,
    organisationId,
    migrationFile,
    checksum,
    timestamp: new Date().toISOString(),
    details,
  };
}

function asError(
  kind: RelationalStorageAndMigrationsAndRlsErrorKind,
  message: string,
  tenantId: string | null,
  organisationId: string | null,
): RelationalStorageAndMigrationsAndRlsError {
  return { kind, message, tenantId, organisationId, isError: true };
}

function safeExecuteAudit(
  event: RelationalStorageAndMigrationsAndRlsAuditEvent,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
  tenantId: string | null,
  organisationId: string | null,
): RelationalStorageAndMigrationsAndRlsError | null {
  try {
    const result = auditFn(event);
    if (result !== null) {
      if (typeof result.kind === 'string' && typeof result.message === 'string') {
        return asError(
          result.kind,
          result.message,
          result.tenantId ?? tenantId,
          result.organisationId ?? organisationId,
        );
      }
      return asError('AUDIT_FAILURE', 'Audit failure', tenantId, organisationId);
    }
    return null;
  } catch (err) {
    return asError(
      'AUDIT_FAILURE',
      err instanceof Error ? err.message : 'Audit execution threw an error',
      tenantId,
      organisationId,
    );
  }
}

export function isError(
  value: RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError,
): value is RelationalStorageAndMigrationsAndRlsError {
  return typeof value === 'object' && value !== null && 'isError' in value && (value as { isError: unknown }).isError === true;
}

export function auditStateChangingAccess(
  state: RelationalStorageAndMigrationsAndRlsState,
  tenantId: string | null,
  organisationId: string | null,
  operationType: string,
  routeName: string,
  useCaseName: string,
  providerSpanId: string,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const lastCtx = state.tenantContexts.length > 0 ? state.tenantContexts[state.tenantContexts.length - 1] : null;
  const event = createAuditEvent('STATE_CHANGING_ACCESS', tenantId, organisationId, null, null, {
    operationType,
    route: routeName,
    routeName,
    useCase: useCaseName,
    useCaseName,
    providerSpan: providerSpanId,
    providerSpanId,
    routeSpanId: routeName,
    useCaseSpanId: useCaseName,
    providerSpanIdLogged: providerSpanId,
    tenantBoundaryPreserved: tenantId !== null,
    dataSubjectEvidencePreserved: true,
    auditTrailSpans: {
      route: routeName,
      useCase: useCaseName,
      provider: providerSpanId,
    },
    currentRole: lastCtx !== null ? lastCtx.roleName : null,
  });
  const auditError = safeExecuteAudit(event, auditFn, tenantId, organisationId);
  if (auditError !== null) {
    return auditError;
  }
  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

export function auditMigrationApplication(
  state: RelationalStorageAndMigrationsAndRlsState,
  migrationFile: RelationalStorageAndMigrationsAndRlsMigrationFile,
  tenantId: string | null,
  organisationId: string | null,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const event = createAuditEvent('MIGRATION_APPLIED', tenantId, organisationId, migrationFile.fileName, migrationFile.checksum, {
    orderIndex: state.appliedMigrations.length,
    decisionReferenceComment: migrationFile.decisionReferenceComment,
    tenantBoundaryPreserved: tenantId !== null,
    dataSubjectEvidencePreserved: true,
  });
  const auditError = safeExecuteAudit(event, auditFn, tenantId, organisationId);
  if (auditError !== null) {
    return auditError;
  }
  return {
    ...state,
    auditLog: [...state.auditLog, event],
    migrationLineage: [...state.migrationLineage, `${migrationFile.fileName}:${migrationFile.checksum}:${migrationFile.decisionReferenceComment}`],
  };
}

export function auditMigrationRollback(
  state: RelationalStorageAndMigrationsAndRlsState,
  migrationFile: string,
  reason: string,
  tenantId: string | null,
  organisationId: string | null,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const event = createAuditEvent('MIGRATION_ROLLBACK', tenantId, organisationId, migrationFile, null, {
    reason,
    rollbackTimestamp: new Date().toISOString(),
    tenantBoundaryPreserved: tenantId !== null,
    dataSubjectEvidencePreserved: true,
  });
  const auditError = safeExecuteAudit(event, auditFn, tenantId, organisationId);
  if (auditError !== null) {
    return auditError;
  }
  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

export function validateConnectionPassword(password: string): RelationalStorageAndMigrationsAndRlsError | null {
  const forbiddenChars = /['"`\\]|[\x00-\x1F\x7F]/;
  if (forbiddenChars.test(password)) {
    return asError(
      'INVALID_CONFIGURATION',
      'Password contains forbidden characters: quote, backslash, or control characters',
      null,
      null,
    );
  }
  return null;
}

export function substituteManagedRolePassword(
  connectionString: string,
  managedRolePassword: string,
): string | RelationalStorageAndMigrationsAndRlsError {
  const validationError = validateConnectionPassword(managedRolePassword);
  if (validationError !== null) {
    return validationError;
  }
  return connectionString.replaceAll('__MANAGED_APP_ROLE_PASSWORD__', managedRolePassword);
}

export function createRlsPredicate(
  tenantColumn: string,
  currentTenantSetting: string,
  bypassRoleName: string,
): string {
  return `((${tenantColumn} = current_setting('${currentTenantSetting}')) OR (current_user = '${bypassRoleName}') OR (pg_has_role(current_user, '${bypassRoleName}', 'MEMBER') AND current_setting('role_inheritance.active', true) = 'on'))`;
}

export function createTableWithRls(
  tableName: string,
  tenantColumn: string,
  rlsPredicate: string,
): string {
  return `CREATE TABLE ${tableName} (${tenantColumn} TEXT NOT NULL); ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation_policy ON ${tableName} USING (${rlsPredicate});`;
}

export function applyMigrationFile(
  state: RelationalStorageAndMigrationsAndRlsState,
  migrationFile: RelationalStorageAndMigrationsAndRlsMigrationFile,
  checksum: string,
  connectionConfig: {
    readonly roleName: string;
    readonly password: string;
    readonly tenantId: string | null;
    readonly organisationId: string | null;
  },
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  if (!state.substrateAvailable) {
    return asError(
      'PROVIDER_UNAVAILABLE',
      'Substrate is not available for migration application',
      connectionConfig.tenantId,
      connectionConfig.organisationId,
    );
  }

  const passwordError = validateConnectionPassword(connectionConfig.password);
  if (passwordError !== null) {
    return asError(passwordError.kind, passwordError.message, connectionConfig.tenantId, connectionConfig.organisationId);
  }

  if (checksum !== migrationFile.checksum) {
    const event = createAuditEvent('MIGRATION_CHECKSUM_MISMATCH', connectionConfig.tenantId, connectionConfig.organisationId, migrationFile.fileName, checksum, {
      expectedChecksum: migrationFile.checksum,
      actualChecksum: checksum,
      tenantBoundaryPreserved: connectionConfig.tenantId !== null,
      dataSubjectEvidencePreserved: true,
    });
    const auditError = safeExecuteAudit(event, auditFn, connectionConfig.tenantId, connectionConfig.organisationId);
    if (auditError !== null) {
      return auditError;
    }
    return asError(
      'CHECKSUM_MISMATCH',
      `Checksum mismatch for migration file: ${migrationFile.fileName}`,
      connectionConfig.tenantId,
      connectionConfig.organisationId,
    );
  }

  const existingMigration = state.appliedMigrations.find(
    (m) => m.fileName === migrationFile.fileName,
  );

  if (existingMigration !== undefined) {
    if (existingMigration.checksum === checksum) {
      const skippedEvent = createAuditEvent('MIGRATION_SKIPPED', connectionConfig.tenantId, connectionConfig.organisationId, migrationFile.fileName, checksum, {
        reason: 'Already applied with matching checksum',
        orderIndex: existingMigration.orderIndex,
        decisionReferenceComment: existingMigration.decisionReferenceComment,
        tenantBoundaryPreserved: connectionConfig.tenantId !== null,
        dataSubjectEvidencePreserved: true,
      });
      const skippedAuditError = safeExecuteAudit(skippedEvent, auditFn, connectionConfig.tenantId, connectionConfig.organisationId);
      if (skippedAuditError !== null) {
        return skippedAuditError;
      }
      return {
        ...state,
        auditLog: [...state.auditLog, skippedEvent],
      };
    } else {
      const mismatchEvent = createAuditEvent('MIGRATION_CHECKSUM_MISMATCH', connectionConfig.tenantId, connectionConfig.organisationId, migrationFile.fileName, checksum, {
        expectedChecksum: existingMigration.checksum,
        actualChecksum: checksum,
        orderIndex: existingMigration.orderIndex,
        decisionReferenceComment: existingMigration.decisionReferenceComment,
        tenantBoundaryPreserved: connectionConfig.tenantId !== null,
        dataSubjectEvidencePreserved: true,
      });
      const mismatchAuditError = safeExecuteAudit(mismatchEvent, auditFn, connectionConfig.tenantId, connectionConfig.organisationId);
      if (mismatchAuditError !== null) {
        return mismatchAuditError;
      }
      return asError(
        'CHECKSUM_MISMATCH',
        `Checksum mismatch for already applied migration: ${migrationFile.fileName}`,
        connectionConfig.tenantId,
        connectionConfig.organisationId,
      );
    }
  }

  const appliedMigration: RelationalStorageAndMigrationsAndRlsAppliedMigration = {
    fileName: migrationFile.fileName,
    checksum: checksum,
    appliedAt: new Date().toISOString(),
    orderIndex: state.appliedMigrations.length,
    decisionReferenceComment: migrationFile.decisionReferenceComment,
  };

  const auditState = auditMigrationApplication(
    state,
    migrationFile,
    connectionConfig.tenantId,
    connectionConfig.organisationId,
    auditFn,
  );

  if (isError(auditState)) {
    return auditState;
  }

  return {
    ...auditState,
    appliedMigrations: [...auditState.appliedMigrations, appliedMigration],
    ledgerNonEmpty: true,
    lastError: null,
  };
}

export function runMigrationChain(
  state: RelationalStorageAndMigrationsAndRlsState,
  migrationFiles: readonly RelationalStorageAndMigrationsAndRlsMigrationFile[],
  connectionConfig: {
    readonly roleName: string;
    readonly password: string;
    readonly tenantId: string | null;
    readonly organisationId: string | null;
  },
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  if (!state.substrateAvailable) {
    return asError(
      'PROVIDER_UNAVAILABLE',
      'Substrate is not available for migration chain execution',
      connectionConfig.tenantId,
      connectionConfig.organisationId,
    );
  }

  const passwordError = validateConnectionPassword(connectionConfig.password);
  if (passwordError !== null) {
    return asError(passwordError.kind, passwordError.message, connectionConfig.tenantId, connectionConfig.organisationId);
  }

  const sortedFiles = [...migrationFiles].sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  );

  let currentState = state;

  for (const file of sortedFiles) {
    const result = applyMigrationFile(
      currentState,
      file,
      file.checksum,
      connectionConfig,
      auditFn,
    );

    if (isError(result)) {
      return result;
    }

    currentState = result;
  }

  return currentState;
}

export function checkReadiness(
  state: RelationalStorageAndMigrationsAndRlsState,
  unfilteredCount: number,
  foreignTenantId: string,
): {
  readonly readiness: RelationalStorageAndMigrationsAndRlsReadiness;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
  readonly acceptanceGatesPassed: boolean;
  readonly promotionBlocked: boolean;
  readonly promotionBlockReason: string | null;
  readonly gates: {
    readonly migrated: boolean;
    readonly isolation: boolean;
    readonly audit: boolean;
  };
} {
  const substrateUnavailable = !state.substrateAvailable;

  if (substrateUnavailable) {
    return {
      readiness: 'DEGRADED',
      error: asError(
        'DEGRADED',
        'Substrate is unavailable - read-only readiness visible, mutation and side-effect paths disabled',
        null,
        null,
      ),
      acceptanceGatesPassed: false,
      promotionBlocked: true,
      promotionBlockReason: 'Substrate is unavailable - promotion blocked',
      gates: {
        migrated: state.ledgerNonEmpty && state.appliedMigrations.length > 0,
        isolation: false,
        audit: state.auditLog.length > 0,
      },
    };
  }

  const migratedGatePassed = state.ledgerNonEmpty && state.appliedMigrations.length > 0;
  const isolationGatePassed = state.crossTenantIsolationProven && unfilteredCount === 0;
  const auditGatePassed = state.auditLog.length > 0;

  const allGatesPassed = migratedGatePassed && isolationGatePassed && auditGatePassed;

  if (allGatesPassed) {
    return {
      readiness: 'READY',
      error: null,
      acceptanceGatesPassed: true,
      promotionBlocked: false,
      promotionBlockReason: null,
      gates: {
        migrated: true,
        isolation: true,
        audit: true,
      },
    };
  }

  if (!migratedGatePassed) {
    return {
      readiness: 'NOT_READY',
      error: asError(
        'READINESS_UNAVAILABLE',
        'Migration ledger is empty; store is not fully migrated',
        null,
        null,
      ),
      acceptanceGatesPassed: false,
      promotionBlocked: true,
      promotionBlockReason: 'Migration ledger empty - promotion blocked',
      gates: {
        migrated: false,
        isolation: isolationGatePassed,
        audit: auditGatePassed,
      },
    };
  }

  if (!isolationGatePassed) {
    return {
      readiness: 'NOT_READY',
      error: asError(
        'READINESS_UNAVAILABLE',
        `Cross-tenant isolation live-proof failed: unfiltered count under foreign tenant context must be zero (was ${unfilteredCount})`,
        foreignTenantId,
        null,
      ),
      acceptanceGatesPassed: false,
      promotionBlocked: true,
      promotionBlockReason: 'Cross-tenant isolation signal missing - promotion blocked',
      gates: {
        migrated: migratedGatePassed,
        isolation: false,
        audit: auditGatePassed,
      },
    };
  }

  return {
    readiness: 'NOT_READY',
    error: asError(
      'READINESS_UNAVAILABLE',
      'Audit signal missing',
      null,
      null,
    ),
    acceptanceGatesPassed: false,
    promotionBlocked: true,
    promotionBlockReason: 'Audit signal missing - promotion blocked',
    gates: {
      migrated: migratedGatePassed,
      isolation: isolationGatePassed,
      audit: false,
    },
  };
}

export function checkCrossTenantIsolationGate(
  state: RelationalStorageAndMigrationsAndRlsState,
  unfilteredCount: number,
  foreignTenantId: string,
): {
  readonly passed: boolean;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
} {
  if (!state.substrateAvailable) {
    return {
      passed: false,
      error: asError(
        'PROVIDER_UNAVAILABLE',
        'Substrate unavailable for cross-tenant isolation check',
        foreignTenantId,
        null,
      ),
    };
  }

  if (unfilteredCount !== 0) {
    return {
      passed: false,
      error: asError(
        'RLS_BYPASS_INVALID',
        `Cross-tenant isolation proof failed: unfiltered count under foreign tenant context is ${unfilteredCount}, expected 0`,
        foreignTenantId,
        null,
      ),
    };
  }

  return {
    passed: true,
    error: null,
  };
}

export function checkMigratedGate(
  state: RelationalStorageAndMigrationsAndRlsState,
): {
  readonly passed: boolean;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
} {
  if (!state.ledgerNonEmpty) {
    return {
      passed: false,
      error: asError(
        'READINESS_UNAVAILABLE',
        'Migration ledger is empty',
        null,
        null,
      ),
    };
  }

  if (state.appliedMigrations.length === 0) {
    return {
      passed: false,
      error: asError(
        'READINESS_UNAVAILABLE',
        'No applied migrations in the migration ledger',
        null,
        null,
      ),
    };
  }

  return {
    passed: true,
    error: null,
  };
}

export function checkAuditSignalGate(
  state: RelationalStorageAndMigrationsAndRlsState,
): {
  readonly passed: boolean;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
} {
  if (state.auditLog.length === 0) {
    return {
      passed: false,
      error: asError(
        'READINESS_UNAVAILABLE',
        'Audit signal missing',
        null,
        null,
      ),
    };
  }

  return {
    passed: true,
    error: null,
  };
}

export function evaluateTenantIsolation(
  state: RelationalStorageAndMigrationsAndRlsState,
  tenantContext: RelationalStorageAndMigrationsAndRlsTenantContext,
  rowTenantId: string,
  bypassRoleName: string,
  roleInheritanceActive: boolean,
): RelationalStorageAndMigrationsAndRlsDecision {
  if (tenantContext.isBypassRole && tenantContext.roleName === bypassRoleName) {
    return 'GRANTED';
  }

  if (tenantContext.roleName === bypassRoleName) {
    return 'GRANTED';
  }

  const currentRole = state.roles.find((r) => r.name === tenantContext.roleName);
  if (currentRole !== undefined) {
    if (currentRole.kind === 'MIGRATION_ROLE' || currentRole.kind === 'SYSTEM_ADMIN_ROLE') {
      return 'GRANTED';
    }
  }

  if (roleInheritanceActive && pgHasRoleWithInheritance(tenantContext.roleName, bypassRoleName, state.roles, roleInheritanceActive)) {
    return 'GRANTED';
  }

  if (tenantContext.tenantId !== '' && tenantContext.tenantId === rowTenantId) {
    return 'GRANTED';
  }

  return 'DENIED';
}

function pgHasRoleWithInheritance(
  roleName: string,
  bypassRoleName: string,
  roles: readonly RelationalStorageAndMigrationsAndRlsRole[],
  roleInheritanceActive: boolean,
): boolean {
  if (!roleInheritanceActive) {
    return false;
  }
  const role = roles.find((r) => r.name === roleName);
  if (role === undefined) {
    return false;
  }
  return role.inherit && role.bypassRls;
}

export function setTenantContext(
  state: RelationalStorageAndMigrationsAndRlsState,
  tenantContext: RelationalStorageAndMigrationsAndRlsTenantContext,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  if (tenantContext.tenantId === '' || tenantContext.tenantId === null || tenantContext.tenantId === undefined) {
    return asError(
      'TENANT_CONTEXT_INVALID',
      'Tenant ID cannot be empty, null, or undefined',
      null,
      tenantContext.organisationId,
    );
  }

  if (tenantContext.isBypassRole && tenantContext.roleName !== 'bypass_role') {
    return asError(
      'TENANT_CONTEXT_INVALID',
      'Bypass role context must use the designated bypass role name',
      tenantContext.tenantId,
      tenantContext.organisationId,
    );
  }

  const event = createAuditEvent('TENANT_CONTEXT_SET', tenantContext.tenantId, tenantContext.organisationId, null, null, {
    roleName: tenantContext.roleName,
    isBypassRole: tenantContext.isBypassRole,
    tenantBoundaryPreserved: true,
    dataSubjectEvidencePreserved: true,
  });

  const auditError = safeExecuteAudit(event, auditFn, tenantContext.tenantId, tenantContext.organisationId);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    tenantContexts: [...state.tenantContexts, tenantContext],
    auditLog: [...state.auditLog, event],
  };
}

export function guardRestore(
  state: RelationalStorageAndMigrationsAndRlsState,
  targetState: RelationalStorageAndMigrationsAndRlsState,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const currentMigrationLineage = state.migrationLineage;
  const targetMigrationLineage = targetState.migrationLineage;

  if (currentMigrationLineage.length !== targetMigrationLineage.length) {
    return asError(
      'RESTORE_NOT_PERMITTED',
      'Restore blocked: migration lineage length mismatch between current and target state',
      null,
      null,
    );
  }

  for (let i = 0; i < currentMigrationLineage.length; i++) {
    if (currentMigrationLineage[i] !== targetMigrationLineage[i]) {
      return asError(
        'RESTORE_NOT_PERMITTED',
        'Restore blocked: migration lineage mismatch between current and target state',
        null,
        null,
      );
    }
  }

  const event = createAuditEvent('RESTORE_GUARD_CHECKED', null, null, null, null, {
    currentLineage: currentMigrationLineage.join(','),
    targetLineage: targetMigrationLineage.join(','),
    tenantBoundaryPreserved: true,
    dataSubjectEvidencePreserved: true,
    auditSignalPreserved: state.auditLog.length > 0,
    isolationSignalPreserved: state.crossTenantIsolationProven,
  });

  const auditError = safeExecuteAudit(event, auditFn, null, null);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

export function createMigrationFile(
  fileName: string,
  orderIndex: number,
  content: string,
  decisionReferenceComment: string,
): RelationalStorageAndMigrationsAndRlsMigrationFile {
  return {
    fileName,
    checksum: computeChecksum(content),
    content,
    orderIndex,
    decisionReferenceComment,
  };
}

export function computeChecksum(content: string): string {
  return 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex');
}

export function validateRoleConfiguration(
  roles: readonly RelationalStorageAndMigrationsAndRlsRole[],
): RelationalStorageAndMigrationsAndRlsError | null {
  const bypassRoles = roles.filter((r) => r.kind === 'BYPASS_ROLE');
  if (bypassRoles.length !== 1) {
    return asError(
      'INVALID_CONFIGURATION',
      'Exactly one bypass role must be configured',
      null,
      null,
    );
  }

  const applicationRoles = roles.filter((r) => r.kind === 'APPLICATION_ROLE');
  if (applicationRoles.length === 0) {
    return asError(
      'INVALID_CONFIGURATION',
      'At least one application role must be configured',
      null,
      null,
    );
  }

  for (const role of applicationRoles) {
    if (role.inherit !== false) {
      return asError(
        'INVALID_CONFIGURATION',
        'Application role must be NOINHERIT',
        null,
        null,
      );
    }
    if (role.bypassRls !== false) {
      return asError(
        'INVALID_CONFIGURATION',
        'Application role must not bypass RLS',
        null,
        null,
      );
    }
    if (role.password !== null) {
      const passwordError = validateConnectionPassword(role.password);
      if (passwordError !== null) {
        return passwordError;
      }
    }
  }

  for (const role of bypassRoles) {
    if (role.inherit !== true || role.bypassRls !== true) {
      return asError(
        'INVALID_CONFIGURATION',
        'Bypass role must have INHERIT and BYPASSRLS enabled',
        null,
        null,
      );
    }
  }

  return null;
}

export function createRepositoryPort(
  context: string,
  operations: readonly string[],
): RelationalStorageAndMigrationsAndRlsRepositoryPort {
  return {
    context,
    operations,
  };
}

export function mediateRepositoryAccess(
  state: RelationalStorageAndMigrationsAndRlsState,
  port: RelationalStorageAndMigrationsAndRlsRepositoryPort,
  connectionConfig: {
    readonly roleName: string;
    readonly tenantId: string | null;
  },
): RelationalStorageAndMigrationsAndRlsDecision {
  if (!state.substrateAvailable || !state.connected) {
    return 'DEGRADED';
  }

  const role = state.roles.find((r) => r.name === connectionConfig.roleName);
  if (role === undefined) {
    return 'DENIED';
  }

  if (role.kind === 'APPLICATION_ROLE' && connectionConfig.tenantId === null) {
    return 'DENIED';
  }

  if (role.kind === 'APPLICATION_ROLE' && !role.canLogin) {
    return 'DENIED';
  }

  if (port.context === '') {
    return 'DENIED';
  }

  return 'GRANTED';
}

export function verifyMigrationLineage(
  state: RelationalStorageAndMigrationsAndRlsState,
  expectedLineage: readonly string[],
): boolean {
  const actualLineage = state.migrationLineage;
  if (actualLineage.length !== expectedLineage.length) {
    return false;
  }
  for (let i = 0; i < actualLineage.length; i++) {
    if (actualLineage[i] !== expectedLineage[i]) {
      return false;
    }
  }
  return true;
}

export function createTenantIsolationProof(
  state: RelationalStorageAndMigrationsAndRlsState,
  unfilteredCount: number,
  foreignTenantContext: RelationalStorageAndMigrationsAndRlsTenantContext,
): boolean {
  if (foreignTenantContext.isBypassRole) {
    return false;
  }
  return unfilteredCount === 0;
}

export function proveCrossTenantIsolation(
  state: RelationalStorageAndMigrationsAndRlsState,
  foreignTenantId: string,
  unfilteredCount: number,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const isolationProof = createTenantIsolationProof(state, unfilteredCount, {
    tenantId: foreignTenantId,
    roleName: 'foreign_role',
    isBypassRole: false,
    organisationId: null,
  });

  if (!isolationProof) {
    return asError(
      'RLS_BYPASS_INVALID',
      'Cross-tenant isolation proof failed: unfiltered count should be zero',
      foreignTenantId,
      null,
    );
  }

  const event = createAuditEvent('RLS_PREDICATE_EVALUATED', foreignTenantId, null, null, null, {
    unfilteredCount,
    isolationProven: isolationProof,
    tenantBoundaryEnforced: true,
    dataSubjectEvidencePreserved: true,
  });

  const auditError = safeExecuteAudit(event, auditFn, foreignTenantId, null);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    crossTenantIsolationProven: true,
    auditLog: [...state.auditLog, event],
  };
}

export function runLiveIsolationProof(
  state: RelationalStorageAndMigrationsAndRlsState,
  foreignTenantContext: RelationalStorageAndMigrationsAndRlsTenantContext,
  unfilteredCount: number,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): {
  readonly state: RelationalStorageAndMigrationsAndRlsState;
  readonly proofPassed: boolean;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
} {
  if (foreignTenantContext.isBypassRole) {
    return {
      state,
      proofPassed: false,
      error: asError(
        'RLS_BYPASS_INVALID',
        'Cannot prove isolation with bypass role',
        foreignTenantContext.tenantId,
        foreignTenantContext.organisationId,
      ),
    };
  }

  if (unfilteredCount !== 0) {
    return {
      state,
      proofPassed: false,
      error: asError(
        'RLS_BYPASS_INVALID',
        'Cross-tenant isolation proof failed: unfiltered count must be zero',
        foreignTenantContext.tenantId,
        foreignTenantContext.organisationId,
      ),
    };
  }

  const event = createAuditEvent('RLS_PREDICATE_EVALUATED', foreignTenantContext.tenantId, foreignTenantContext.organisationId, null, null, {
    proofType: 'live_isolation',
    unfilteredCount,
    tenantBoundaryEnforced: true,
    dataSubjectEvidencePreserved: true,
  });

  const auditError = safeExecuteAudit(event, auditFn, foreignTenantContext.tenantId, foreignTenantContext.organisationId);
  if (auditError !== null) {
    return {
      state,
      proofPassed: false,
      error: auditError,
    };
  }

  return {
    state: {
      ...state,
      crossTenantIsolationProven: true,
      auditLog: [...state.auditLog, event],
    },
    proofPassed: true,
    error: null,
  };
}

export function executeChecksumGates(
  state: RelationalStorageAndMigrationsAndRlsState,
  migrationFiles: readonly RelationalStorageAndMigrationsAndRlsMigrationFile[],
  connectionConfig: {
    readonly roleName: string;
    readonly password: string;
    readonly tenantId: string | null;
    readonly organisationId: string | null;
  },
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const sortedFiles = [...migrationFiles].sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  );

  for (const file of sortedFiles) {
    const existingMigration = state.appliedMigrations.find((m) => m.fileName === file.fileName);

    if (existingMigration !== undefined) {
      if (existingMigration.checksum !== file.checksum) {
        const mismatchEvent = createAuditEvent('MIGRATION_CHECKSUM_MISMATCH', connectionConfig.tenantId, connectionConfig.organisationId, file.fileName, file.checksum, {
          expectedChecksum: existingMigration.checksum,
          actualChecksum: file.checksum,
          orderIndex: existingMigration.orderIndex,
          decisionReferenceComment: existingMigration.decisionReferenceComment,
          tenantBoundaryPreserved: connectionConfig.tenantId !== null,
          dataSubjectEvidencePreserved: true,
        });
        const auditError = safeExecuteAudit(mismatchEvent, auditFn, connectionConfig.tenantId, connectionConfig.organisationId);
        if (auditError !== null) {
          return auditError;
        }
        return asError(
          'CHECKSUM_MISMATCH',
          `Checksum mismatch for applied migration: ${file.fileName}`,
          connectionConfig.tenantId,
          connectionConfig.organisationId,
        );
      }
    }
  }

  return state;
}

export function verifyMigratedStateGate(
  state: RelationalStorageAndMigrationsAndRlsState,
  expectedMigrationCount: number,
): {
  readonly passed: boolean;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
} {
  if (!state.ledgerNonEmpty || state.appliedMigrations.length === 0) {
    return {
      passed: false,
      error: asError(
        'READINESS_UNAVAILABLE',
        'Migration ledger is empty',
        null,
        null,
      ),
    };
  }

  if (state.appliedMigrations.length < expectedMigrationCount) {
    return {
      passed: false,
      error: asError(
        'READINESS_UNAVAILABLE',
        `Expected ${expectedMigrationCount} migrations but found ${state.appliedMigrations.length}`,
        null,
        null,
      ),
    };
  }

  return {
    passed: true,
    error: null,
  };
}

export function performStateChangingMutation(
  state: RelationalStorageAndMigrationsAndRlsState,
  tenantId: string | null,
  organisationId: string | null,
  operationType: string,
  routeName: string,
  useCaseName: string,
  providerSpanId: string,
  mutationFn: (currentState: RelationalStorageAndMigrationsAndRlsState) => RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  if (!state.substrateAvailable || !state.connected) {
    return asError(
      'PROVIDER_UNAVAILABLE',
      'Substrate or connection unavailable for mutation',
      tenantId,
      organisationId,
    );
  }

  const auditedState = auditStateChangingAccess(state, tenantId, organisationId, operationType, routeName, useCaseName, providerSpanId, auditFn);
  if (isError(auditedState)) {
    return auditedState;
  }

  return mutationFn(auditedState);
}

export function determineDegradedMode(
  state: RelationalStorageAndMigrationsAndRlsState,
): {
  readonly isDegraded: boolean;
  readonly canMutate: boolean;
  readonly canRead: boolean;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
} {
  if (state.substrateAvailable && state.connected) {
    return {
      isDegraded: false,
      canMutate: true,
      canRead: true,
      error: null,
    };
  }

  if (!state.substrateAvailable) {
    return {
      isDegraded: true,
      canMutate: false,
      canRead: true,
      error: asError(
        'DEGRADED',
        'Substrate unavailable - mutation and side-effects disabled, read-only readiness and audit remain visible',
        null,
        null,
      ),
    };
  }

  return {
    isDegraded: true,
    canMutate: false,
    canRead: true,
    error: asError(
      'DEGRADED',
      'Connection unavailable - read-only mode, mutation disabled',
      null,
      null,
    ),
  };
}

export function validateMissingConfiguration(
  config: Record<string, unknown> | null,
): RelationalStorageAndMigrationsAndRlsError | null {
  if (config === null || config === undefined) {
    return asError(
      'INVALID_CONFIGURATION',
      'Configuration is missing - fail-closed',
      null,
      null,
    );
  }

  for (const key of Object.keys(config)) {
    if (config[key] === null || config[key] === undefined) {
      return asError(
        'INVALID_CONFIGURATION',
        `Configuration key '${key}' is null or undefined - fail-closed`,
        null,
        null,
      );
    }
  }

  return null;
}

export function blockPromotionOnUnavailability(
  state: RelationalStorageAndMigrationsAndRlsState,
  unfilteredCount: number,
  foreignTenantId: string,
): {
  readonly blocked: boolean;
  readonly reason: string | null;
} {
  const readiness = checkReadiness(state, unfilteredCount, foreignTenantId);

  if (readiness.readiness === 'NOT_READY') {
    return {
      blocked: true,
      reason: readiness.error?.message ?? 'Readiness unavailable',
    };
  }

  if (readiness.readiness === 'DEGRADED') {
    return {
      blocked: true,
      reason: 'System in degraded mode - promotion blocked',
    };
  }

  if (!state.crossTenantIsolationProven) {
    return {
      blocked: true,
      reason: 'Cross-tenant isolation proof missing',
    };
  }

  if (!state.ledgerNonEmpty || state.appliedMigrations.length === 0) {
    return {
      blocked: true,
      reason: 'Migration ledger empty',
    };
  }

  if (state.auditLog.length === 0) {
    return {
      blocked: true,
      reason: 'Audit signal missing',
    };
  }

  return {
    blocked: false,
    reason: null,
  };
}

export function checkAcceptanceGates(
  state: RelationalStorageAndMigrationsAndRlsState,
  unfilteredCount: number,
  foreignTenantId: string,
): {
  readonly passed: boolean;
  readonly readiness: RelationalStorageAndMigrationsAndRlsReadiness;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
  readonly gates: {
    readonly migrated: boolean;
    readonly isolation: boolean;
    readonly audit: boolean;
  };
} {
  if (!state.substrateAvailable) {
    return {
      passed: false,
      readiness: 'DEGRADED',
      error: asError(
        'DEGRADED',
        'Substrate is unavailable - read-only readiness visible, mutation and side-effect paths disabled',
        null,
        null,
      ),
      gates: {
        migrated: state.ledgerNonEmpty && state.appliedMigrations.length > 0,
        isolation: false,
        audit: state.auditLog.length > 0,
      },
    };
  }

  const migratedGate = state.ledgerNonEmpty && state.appliedMigrations.length > 0;
  const isolationGate = state.crossTenantIsolationProven && unfilteredCount === 0;
  const auditGate = state.auditLog.length > 0;

  if (!migratedGate) {
    return {
      passed: false,
      readiness: 'NOT_READY',
      error: asError(
        'READINESS_UNAVAILABLE',
        'Migrated check failed: migration ledger is empty',
        null,
        null,
      ),
      gates: {
        migrated: false,
        isolation: isolationGate,
        audit: auditGate,
      },
    };
  }

  if (!isolationGate) {
    return {
      passed: false,
      readiness: 'NOT_READY',
      error: asError(
        'READINESS_UNAVAILABLE',
        'Cross-tenant isolation live-proof failed: unfiltered count under foreign tenant context must be zero',
        foreignTenantId,
        null,
      ),
      gates: {
        migrated: migratedGate,
        isolation: false,
        audit: auditGate,
      },
    };
  }

  if (!auditGate) {
    return {
      passed: false,
      readiness: 'NOT_READY',
      error: asError(
        'READINESS_UNAVAILABLE',
        'Audit signal missing',
        null,
        null,
      ),
      gates: {
        migrated: migratedGate,
        isolation: isolationGate,
        audit: false,
      },
    };
  }

  return {
    passed: true,
    readiness: 'READY',
    error: null,
    gates: {
      migrated: true,
      isolation: true,
      audit: true,
    },
  };
}

export function checkReadinessModel(
  state: RelationalStorageAndMigrationsAndRlsState,
  unfilteredCount: number,
  foreignTenantId: string,
): {
  readonly readiness: RelationalStorageAndMigrationsAndRlsReadiness;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
  readonly promotionBlocked: boolean;
  readonly promotionBlockReason: string | null;
  readonly gates: {
    readonly migrated: boolean;
    readonly isolation: boolean;
    readonly audit: boolean;
  };
} {
  const readiness = checkReadiness(state, unfilteredCount, foreignTenantId);
  return {
    readiness: readiness.readiness,
    error: readiness.error,
    promotionBlocked: readiness.promotionBlocked,
    promotionBlockReason: readiness.promotionBlockReason,
    gates: readiness.gates,
  };
}

export function auditRestoredTenantBoundary(
  state: RelationalStorageAndMigrationsAndRlsState,
  restoredTenantId: string,
  restoredOrganisationId: string | null,
  restoredAuditSignal: boolean,
  restoredIsolationSignal: boolean,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  if (restoredTenantId === '' || restoredTenantId === null || restoredTenantId === undefined) {
    return asError(
      'RESTORE_NOT_PERMITTED',
      'Restore blocked: tenant boundary not preserved (missing tenant identifier)',
      null,
      null,
    );
  }

  if (!restoredAuditSignal) {
    return asError(
      'RESTORE_NOT_PERMITTED',
      'Restore blocked: audit signal not preserved in restored state',
      restoredTenantId,
      restoredOrganisationId,
    );
  }

  if (!restoredIsolationSignal) {
    return asError(
      'RESTORE_NOT_PERMITTED',
      'Restore blocked: cross-tenant isolation signal not preserved in restored state',
      restoredTenantId,
      restoredOrganisationId,
    );
  }

  const event = createAuditEvent('RESTORE_GUARD_CHECKED', restoredTenantId, restoredOrganisationId, null, null, {
    restoreType: 'tenant_boundary_audit',
    tenantBoundaryPreserved: true,
    auditSignalPreserved: restoredAuditSignal,
    isolationSignalPreserved: restoredIsolationSignal,
    dataSubjectEvidencePreserved: true,
  });

  const auditError = safeExecuteAudit(event, auditFn, restoredTenantId, restoredOrganisationId);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

export function recordMutationAuditTrail(
  state: RelationalStorageAndMigrationsAndRlsState,
  tenantId: string | null,
  organisationId: string | null,
  routeName: string,
  useCaseName: string,
  providerSpanId: string,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const isTenantScoped = tenantId !== null;
  const effectiveTenantId = isTenantScoped ? tenantId : null;
  const effectiveOrgId = isTenantScoped ? organisationId : null;

  if (isTenantScoped && (organisationId === null || organisationId === '')) {
    return asError(
      'TENANT_CONTEXT_INVALID',
      'Tenant-scoped operation must carry an organisation identifier in the audit trail',
      tenantId,
      null,
    );
  }

  const event = createAuditEvent('STATE_CHANGING_ACCESS', effectiveTenantId, effectiveOrgId, null, null, {
    routeName,
    useCaseName,
    providerSpanId,
    organisationId,
    tenantBoundaryPreserved: isTenantScoped,
    dataSubjectEvidencePreserved: true,
    auditTrailSpans: {
      route: routeName,
      useCase: useCaseName,
      provider: providerSpanId,
    },
  });

  const auditError = safeExecuteAudit(event, auditFn, effectiveTenantId, effectiveOrgId);
  if (auditError !== null) {
    return auditError;
  }

  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

export function createTypedTenantError(
  errorKind: RelationalStorageAndMigrationsAndRlsErrorKind,
  message: string,
  tenantId: string | null,
  organisationId: string | null,
): RelationalStorageAndMigrationsAndRlsError {
  const isTenantScoped = tenantId !== null;
  const errorTenantId = isTenantScoped ? tenantId : null;
  const errorOrgId = isTenantScoped ? organisationId : null;
  const orgSuffix = isTenantScoped && organisationId !== null && organisationId !== ''
    ? ` (organisation=${organisationId})`
    : '';
  return {
    kind: errorKind,
    message: `${message}${orgSuffix}`,
    tenantId: errorTenantId,
    organisationId: errorOrgId,
    isError: true,
  };
}

export function verifyAuditTrailReadiness(
  state: RelationalStorageAndMigrationsAndRlsState,
  unfilteredCount: number,
  foreignTenantId: string,
): {
  readonly ready: boolean;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
  readonly auditSignalPresent: boolean;
  readonly isolationSignalPresent: boolean;
  readonly migratedSignalPresent: boolean;
  readonly promotionBlocked: boolean;
  readonly promotionBlockReason: string | null;
} {
  const readiness = checkReadiness(state, unfilteredCount, foreignTenantId);
  const migratedSignalPresent = state.ledgerNonEmpty && state.appliedMigrations.length > 0;
  const isolationSignalPresent = state.crossTenantIsolationProven && unfilteredCount === 0;
  const auditSignalPresent = state.auditLog.length > 0;

  if (readiness.readiness === 'READY') {
    return {
      ready: true,
      error: null,
      auditSignalPresent: true,
      isolationSignalPresent: true,
      migratedSignalPresent: true,
      promotionBlocked: false,
      promotionBlockReason: null,
    };
  }

  return {
    ready: false,
    error: readiness.error,
    auditSignalPresent,
    isolationSignalPresent,
    migratedSignalPresent,
    promotionBlocked: readiness.promotionBlocked,
    promotionBlockReason: readiness.promotionBlockReason,
  };
}