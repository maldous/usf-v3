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
  readonly migrationFile: string | null;
  readonly checksum: string | null;
  readonly timestamp: string;
  readonly details: Record<string, unknown>;
}

export interface RelationalStorageAndMigrationsAndRlsError {
  readonly kind: RelationalStorageAndMigrationsAndRlsErrorKind;
  readonly message: string;
  readonly tenantId?: string | null;
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
  migrationFile: string | null,
  checksum: string | null,
  details: Record<string, unknown>,
): RelationalStorageAndMigrationsAndRlsAuditEvent {
  return {
    kind,
    tenantId,
    migrationFile,
    checksum,
    timestamp: new Date().toISOString(),
    details,
  };
}

export function auditStateChangingAccess(
  state: RelationalStorageAndMigrationsAndRlsState,
  tenantId: string | null,
  operationType: string,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const event = createAuditEvent('STATE_CHANGING_ACCESS', tenantId, null, null, {
    operationType,
    route: state.tenantContexts.length > 0 ? state.tenantContexts[state.tenantContexts.length - 1].roleName : null,
    useCase: operationType,
    providerSpan: state.connected ? 'connected' : 'disconnected',
    tenantBoundaryPreserved: tenantId !== null,
    dataSubjectEvidencePreserved: true,
  });
  const auditError = auditFn(event);
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
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const event = createAuditEvent('MIGRATION_APPLIED', tenantId, migrationFile.fileName, migrationFile.checksum, {
    orderIndex: state.appliedMigrations.length,
    decisionReferenceComment: migrationFile.decisionReferenceComment,
    tenantBoundaryPreserved: tenantId !== null,
    dataSubjectEvidencePreserved: true,
  });
  const auditError = auditFn(event);
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
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const event = createAuditEvent('MIGRATION_ROLLBACK', tenantId, migrationFile, null, {
    reason,
    rollbackTimestamp: new Date().toISOString(),
    tenantBoundaryPreserved: tenantId !== null,
    dataSubjectEvidencePreserved: true,
  });
  const auditError = auditFn(event);
  if (auditError !== null) {
    return auditError;
  }
  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

export function validateConnectionPassword(password: string): RelationalStorageAndMigrationsAndRlsError | null {
  const forbiddenChars = /['"\\\\\x00-\x1F]/;
  if (forbiddenChars.test(password)) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Password contains forbidden characters: quote, backslash, or control characters',
    };
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
  return connectionString.replace('__MANAGED_APP_ROLE_PASSWORD__', managedRolePassword);
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
  },
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  if (!state.substrateAvailable) {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Substrate is not available for migration application',
      tenantId: connectionConfig.tenantId,
    };
  }

  if (checksum !== migrationFile.checksum) {
    const event = createAuditEvent('MIGRATION_CHECKSUM_MISMATCH', connectionConfig.tenantId, migrationFile.fileName, checksum, {
      expectedChecksum: migrationFile.checksum,
      actualChecksum: checksum,
      tenantBoundaryPreserved: connectionConfig.tenantId !== null,
      dataSubjectEvidencePreserved: true,
    });
    const auditError = auditFn(event);
    if (auditError !== null) {
      return auditError;
    }
    return {
      kind: 'CHECKSUM_MISMATCH',
      message: `Checksum mismatch for migration file: ${migrationFile.fileName}`,
      tenantId: connectionConfig.tenantId,
    };
  }

  const existingMigration = state.appliedMigrations.find(
    (m) => m.fileName === migrationFile.fileName,
  );

  if (existingMigration !== undefined) {
    if (existingMigration.checksum === checksum) {
      const skippedEvent = createAuditEvent('MIGRATION_SKIPPED', connectionConfig.tenantId, migrationFile.fileName, checksum, {
        reason: 'Already applied with matching checksum',
        orderIndex: existingMigration.orderIndex,
        decisionReferenceComment: existingMigration.decisionReferenceComment,
        tenantBoundaryPreserved: connectionConfig.tenantId !== null,
        dataSubjectEvidencePreserved: true,
      });
      const skippedAuditError = auditFn(skippedEvent);
      if (skippedAuditError !== null) {
        return skippedAuditError;
      }
      return {
        ...state,
        auditLog: [...state.auditLog, skippedEvent],
      };
    } else {
      const mismatchEvent = createAuditEvent('MIGRATION_CHECKSUM_MISMATCH', connectionConfig.tenantId, migrationFile.fileName, checksum, {
        expectedChecksum: existingMigration.checksum,
        actualChecksum: checksum,
        orderIndex: existingMigration.orderIndex,
        tenantBoundaryPreserved: connectionConfig.tenantId !== null,
        dataSubjectEvidencePreserved: true,
      });
      const mismatchAuditError = auditFn(mismatchEvent);
      if (mismatchAuditError !== null) {
        return mismatchAuditError;
      }
      return {
        kind: 'CHECKSUM_MISMATCH',
        message: `Checksum mismatch for already applied migration: ${migrationFile.fileName}`,
        tenantId: connectionConfig.tenantId,
      };
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
    auditFn,
  );

  if ('kind' in auditState && 'message' in auditState) {
    return auditState;
  }

  const successfulState = auditState as RelationalStorageAndMigrationsAndRlsState;

  return {
    ...successfulState,
    appliedMigrations: [...successfulState.appliedMigrations, appliedMigration],
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
  },
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  if (!state.substrateAvailable) {
    return {
      kind: 'PROVIDER_UNAVAILABLE',
      message: 'Substrate is not available for migration chain execution',
      tenantId: connectionConfig.tenantId,
    };
  }

  let currentState = state;

  const sortedFiles = [...migrationFiles].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const file of sortedFiles) {
    const result = applyMigrationFile(
      currentState,
      file,
      file.checksum,
      connectionConfig,
      auditFn,
    );

    if ('kind' in result && 'message' in result) {
      const errorResult = result as RelationalStorageAndMigrationsAndRlsError;
      const rollbackResult = auditMigrationRollback(
        currentState,
        file.fileName,
        `Migration failed: ${errorResult.message}`,
        connectionConfig.tenantId,
        auditFn,
      );
      if ('kind' in rollbackResult && 'message' in rollbackResult) {
        return rollbackResult;
      }
      return {
        ...(rollbackResult as RelationalStorageAndMigrationsAndRlsState),
        lastError: errorResult,
      };
    }

    currentState = result as RelationalStorageAndMigrationsAndRlsState;
  }

  return currentState;
}

export function checkReadiness(
  state: RelationalStorageAndMigrationsAndRlsState,
): {
  readonly readiness: RelationalStorageAndMigrationsAndRlsReadiness;
  readonly error: RelationalStorageAndMigrationsAndRlsError | null;
} {
  if (!state.substrateAvailable) {
    return {
      readiness: 'DEGRADED',
      error: {
        kind: 'DEGRADED',
        message: 'Substrate is unavailable - read-only mode active',
        tenantId: null,
      },
    };
  }

  if (!state.connected) {
    return {
      readiness: 'DEGRADED',
      error: {
        kind: 'DEGRADED',
        message: 'Connection not established - read-only mode active',
        tenantId: null,
      },
    };
  }

  if (!state.ledgerNonEmpty) {
    return {
      readiness: 'NOT_READY',
      error: {
        kind: 'READINESS_UNAVAILABLE',
        message: 'Migration ledger is empty; store is not fully migrated',
        tenantId: null,
      },
    };
  }

  if (!state.crossTenantIsolationProven) {
    return {
      readiness: 'NOT_READY',
      error: {
        kind: 'READINESS_UNAVAILABLE',
        message: 'Cross-tenant isolation proof is missing',
        tenantId: null,
      },
    };
  }

  if (state.auditLog.length === 0) {
    return {
      readiness: 'NOT_READY',
      error: {
        kind: 'READINESS_UNAVAILABLE',
        message: 'Audit signal missing',
        tenantId: null,
      },
    };
  }

  return {
    readiness: 'READY',
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
  if (tenantContext.isBypassRole) {
    return 'GRANTED';
  }

  if (tenantContext.roleName === bypassRoleName) {
    return 'GRANTED';
  }

  if (pgHasRoleWithInheritance(tenantContext.roleName, bypassRoleName, state.roles, roleInheritanceActive)) {
    return 'GRANTED';
  }

  if (tenantContext.tenantId === rowTenantId) {
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
    return {
      kind: 'TENANT_CONTEXT_INVALID',
      message: 'Tenant ID cannot be empty, null, or undefined',
      tenantId: null,
    };
  }

  if (tenantContext.isBypassRole && tenantContext.roleName !== 'bypass_role') {
    return {
      kind: 'TENANT_CONTEXT_INVALID',
      message: 'Bypass role context must use the designated bypass role name',
      tenantId: tenantContext.tenantId,
    };
  }

  const event = createAuditEvent('TENANT_CONTEXT_SET', tenantContext.tenantId, null, null, {
    roleName: tenantContext.roleName,
    isBypassRole: tenantContext.isBypassRole,
    tenantBoundaryPreserved: true,
    dataSubjectEvidencePreserved: true,
  });

  const auditError = auditFn(event);
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
    return {
      kind: 'RESTORE_NOT_PERMITTED',
      message: 'Restore blocked: migration lineage length mismatch between current and target state',
      tenantId: null,
    };
  }

  for (let i = 0; i < currentMigrationLineage.length; i++) {
    if (currentMigrationLineage[i] !== targetMigrationLineage[i]) {
      return {
        kind: 'RESTORE_NOT_PERMITTED',
        message: 'Restore blocked: migration lineage mismatch between current and target state',
        tenantId: null,
      };
    }
  }

  const event = createAuditEvent('RESTORE_GUARD_CHECKED', null, null, null, {
    currentLineage: currentMigrationLineage.join(','),
    targetLineage: targetMigrationLineage.join(','),
    tenantBoundaryPreserved: true,
    dataSubjectEvidencePreserved: true,
    auditSignalPreserved: state.auditLog.length > 0,
    isolationSignalPreserved: state.crossTenantIsolationProven,
  });

  const auditError = auditFn(event);
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
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'sha256:' + Math.abs(hash).toString(16);
}

export function validateRoleConfiguration(
  roles: readonly RelationalStorageAndMigrationsAndRlsRole[],
): RelationalStorageAndMigrationsAndRlsError | null {
  const bypassRoles = roles.filter((r) => r.kind === 'BYPASS_ROLE');
  if (bypassRoles.length !== 1) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Exactly one bypass role must be configured',
      tenantId: null,
    };
  }

  const applicationRoles = roles.filter((r) => r.kind === 'APPLICATION_ROLE');
  if (applicationRoles.length === 0) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'At least one application role must be configured',
      tenantId: null,
    };
  }

  for (const role of applicationRoles) {
    if (role.inherit !== false) {
      return {
        kind: 'INVALID_CONFIGURATION',
        message: 'Application role must be NOINHERIT',
        tenantId: null,
      };
    }
    if (role.bypassRls !== false) {
      return {
        kind: 'INVALID_CONFIGURATION',
        message: 'Application role must not bypass RLS',
        tenantId: null,
      };
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
      return {
        kind: 'INVALID_CONFIGURATION',
        message: 'Bypass role must have INHERIT and BYPASSRLS enabled',
        tenantId: null,
      };
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
    operations: operations,
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
  });

  if (!isolationProof) {
    return {
      kind: 'RLS_BYPASS_INVALID',
      message: 'Cross-tenant isolation proof failed: unfiltered count should be zero',
      tenantId: foreignTenantId,
    };
  }

  const event = createAuditEvent('RLS_PREDICATE_EVALUATED', foreignTenantId, null, null, {
    unfilteredCount,
    isolationProven: isolationProof,
    tenantBoundaryEnforced: true,
    dataSubjectEvidencePreserved: true,
  });

  const auditError = auditFn(event);
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
      error: {
        kind: 'RLS_BYPASS_INVALID',
        message: 'Cannot prove isolation with bypass role',
        tenantId: foreignTenantContext.tenantId,
      },
    };
  }

  if (unfilteredCount !== 0) {
    return {
      state,
      proofPassed: false,
      error: {
        kind: 'RLS_BYPASS_INVALID',
        message: 'Cross-tenant isolation proof failed: unfiltered count must be zero',
        tenantId: foreignTenantContext.tenantId,
      },
    };
  }

  const event = createAuditEvent('RLS_PREDICATE_EVALUATED', foreignTenantContext.tenantId, null, null, {
    proofType: 'live_isolation',
    unfilteredCount,
    tenantBoundaryEnforced: true,
    dataSubjectEvidencePreserved: true,
  });

  const auditError = auditFn(event);
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
  },
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const sortedFiles = [...migrationFiles].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const file of sortedFiles) {
    const existingMigration = state.appliedMigrations.find((m) => m.fileName === file.fileName);

    if (existingMigration !== undefined) {
      if (existingMigration.checksum !== file.checksum) {
        const mismatchEvent = createAuditEvent('MIGRATION_CHECKSUM_MISMATCH', connectionConfig.tenantId, file.fileName, file.checksum, {
          expectedChecksum: existingMigration.checksum,
          actualChecksum: file.checksum,
          orderIndex: existingMigration.orderIndex,
          tenantBoundaryPreserved: connectionConfig.tenantId !== null,
          dataSubjectEvidencePreserved: true,
        });
        const auditError = auditFn(mismatchEvent);
        if (auditError !== null) {
          return auditError;
        }
        return {
          kind: 'CHECKSUM_MISMATCH',
          message: `Checksum mismatch for applied migration: ${file.fileName}`,
          tenantId: connectionConfig.tenantId,
        };
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
  if (!state.ledgerNonEmpty) {
    return {
      passed: false,
      error: {
        kind: 'READINESS_UNAVAILABLE',
        message: 'Migration ledger is empty',
        tenantId: null,
      },
    };
  }

  if (state.appliedMigrations.length < expectedMigrationCount) {
    return {
      passed: false,
      error: {
        kind: 'READINESS_UNAVAILABLE',
        message: `Expected ${expectedMigrationCount} migrations but found ${state.appliedMigrations.length}`,
        tenantId: null,
      },
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
  operationType: string,
  mutationFn: (currentState: RelationalStorageAndMigrationsAndRlsState) => RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError,
  auditFn: (event: RelationalStorageAndMigrationsAndRlsAuditEvent) => RelationalStorageAndMigrationsAndRlsError | null,
): RelationalStorageAndMigrationsAndRlsState | RelationalStorageAndMigrationsAndRlsError {
  const auditedState = auditStateChangingAccess(state, tenantId, operationType, auditFn);
  if ('kind' in auditedState && 'message' in auditedState) {
    return auditedState;
  }

  const mutableState = auditedState as RelationalStorageAndMigrationsAndRlsState;
  return mutationFn(mutableState);
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
      canRead: false,
      error: {
        kind: 'DEGRADED',
        message: 'Substrate unavailable - mutation and read disabled',
        tenantId: null,
      },
    };
  }

  return {
    isDegraded: true,
    canMutate: false,
    canRead: true,
    error: {
      kind: 'DEGRADED',
      message: 'Connection unavailable - read-only mode',
      tenantId: null,
    },
  };
}

export function validateMissingConfiguration(
  config: Record<string, unknown> | null,
): RelationalStorageAndMigrationsAndRlsError | null {
  if (config === null || config === undefined) {
    return {
      kind: 'INVALID_CONFIGURATION',
      message: 'Configuration is missing - fail-closed',
      tenantId: null,
    };
  }

  for (const key of Object.keys(config)) {
    if (config[key] === null || config[key] === undefined) {
      return {
        kind: 'INVALID_CONFIGURATION',
        message: `Configuration key '${key}' is null or undefined - fail-closed`,
        tenantId: null,
      };
    }
  }

  return null;
}

export function blockPromotionOnUnavailability(
  state: RelationalStorageAndMigrationsAndRlsState,
): {
  readonly blocked: boolean;
  readonly reason: string | null;
} {
  const readiness = checkReadiness(state);

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

  if (!state.ledgerNonEmpty) {
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