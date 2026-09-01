import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/dataplatform/relationalstorageandmigrationsandrls.ts";

test("relationalstorageandmigrationsandrlsauditmodel", () => {
  const initial = capability.initialState;
  const auditFn = (event: capability.RelationalStorageAndMigrationsAndRlsAuditEvent): capability.RelationalStorageAndMigrationsAndRlsError | null => null;

  const migrationFile = capability.createMigrationFile(
    '001_init.sql',
    0,
    'CREATE TABLE test (tenant_id TEXT NOT NULL);',
    'Initial schema'
  );

  const connectionConfig = {
    roleName: 'app_role',
    password: 'valid_password',
    tenantId: 'tenant_1' as const,
  };

  const result = capability.applyMigrationFile(
    initial,
    migrationFile,
    migrationFile.checksum,
    connectionConfig,
    auditFn
  );

  assert.ok(!('kind' in result && 'message' in result));
  const state = result as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(state.auditLog.length, 1);
  assert.strictEqual(state.auditLog[0].kind, 'MIGRATION_APPLIED');
  assert.strictEqual(state.auditLog[0].tenantId, 'tenant_1');
  assert.strictEqual(state.auditLog[0].migrationFile, '001_init.sql');
  assert.strictEqual(state.auditLog[0].checksum, migrationFile.checksum);
  assert.deepStrictEqual(state.auditLog[0].details, {
    orderIndex: 0,
    decisionReferenceComment: 'Initial schema',
    tenantBoundaryPreserved: true,
    dataSubjectEvidencePreserved: true,
  });

  const stateChangingResult = capability.auditStateChangingAccess(
    state,
    'tenant_1',
    'mutation',
    auditFn
  );
  assert.ok(!('kind' in stateChangingResult && 'message' in stateChangingResult));
  const stateChangingState = stateChangingResult as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(stateChangingState.auditLog.length, 2);
  assert.strictEqual(stateChangingState.auditLog[1].kind, 'STATE_CHANGING_ACCESS');
  assert.strictEqual(stateChangingState.auditLog[1].tenantId, 'tenant_1');
  assert.deepStrictEqual(stateChangingState.auditLog[1].details, {
    operationType: 'mutation',
    route: 'app_role',
    useCase: 'mutation',
    providerSpan: 'disconnected',
    tenantBoundaryPreserved: true,
    dataSubjectEvidencePreserved: true,
  });

  const restoreState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...state,
    migrationLineage: ['001_init.sql:sha256:1e3d2c8e:Initial schema'],
  };
  const targetState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...state,
    migrationLineage: ['001_init.sql:sha256:1e3d2c8e:Initial schema'],
  };
  const restoreResult = capability.guardRestore(
    restoreState,
    targetState,
    auditFn
  );
  assert.ok(!('kind' in restoreResult && 'message' in restoreResult));
  const restoreStateResult = restoreResult as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(restoreStateResult.auditLog.length, 3);
  assert.strictEqual(restoreStateResult.auditLog[2].kind, 'RESTORE_GUARD_CHECKED');
  assert.deepStrictEqual(restoreStateResult.auditLog[2].details, {
    currentLineage: '001_init.sql:sha256:1e3d2c8e:Initial schema',
    targetLineage: '001_init.sql:sha256:1e3d2c8e:Initial schema',
    tenantBoundaryPreserved: true,
    dataSubjectEvidencePreserved: true,
    auditSignalPreserved: true,
    isolationSignalPreserved: false,
  });
});

test("relationalstorageandmigrationsandrlscontracts", () => {
  const password = 'valid_password';
  const validationError = capability.validateConnectionPassword(password);
  assert.strictEqual(validationError, null);

  const invalidPassword = "'; DROP TABLE users;--";
  const invalidError = capability.validateConnectionPassword(invalidPassword);
  assert.notStrictEqual(invalidError, null);
  assert.strictEqual(invalidError?.kind, 'INVALID_CONFIGURATION');

  const connectionString = 'postgresql://user:__MANAGED_APP_ROLE_PASSWORD__@localhost/db';
  const substituted = capability.substituteManagedRolePassword(connectionString, password);
  assert.strictEqual(substituted, 'postgresql://user:valid_password@localhost/db');

  const rlsPredicate = capability.createRlsPredicate('tenant_id', 'app.current_tenant', 'bypass_role');
  assert.strictEqual(
    rlsPredicate,
    '(tenant_id = current_setting(\'app.current_tenant\') OR current_user = \'bypass_role\' OR (pg_has_role(current_user, \'bypass_role\', \'MEMBER\') AND current_setting(\'role_inheritance.active\', true) = \'on\'))'
  );

  const tableSql = capability.createTableWithRls('test_table', 'tenant_id', rlsPredicate);
  assert.ok(tableSql.includes('CREATE TABLE test_table (tenant_id TEXT NOT NULL)'));
  assert.ok(tableSql.includes('ALTER TABLE test_table ENABLE ROW LEVEL SECURITY'));
  assert.ok(tableSql.includes('ALTER TABLE test_table FORCE ROW LEVEL SECURITY'));
  assert.ok(tableSql.includes('CREATE POLICY tenant_isolation_policy ON test_table USING (' + rlsPredicate + ')'));

  const port = capability.createRepositoryPort('test_context', ['read', 'write'] as const);
  assert.strictEqual(port.context, 'test_context');
  assert.deepStrictEqual(port.operations, ['read', 'write']);
});

test("relationalstorageandmigrationsandrlserrormodel", () => {
  const initial = capability.initialState;
  const auditFn = (event: capability.RelationalStorageAndMigrationsAndRlsAuditEvent): capability.RelationalStorageAndMigrationsAndRlsError | null => null;

  const migrationFile = capability.createMigrationFile(
    '001_init.sql',
    0,
    'CREATE TABLE test (tenant_id TEXT NOT NULL);',
    'Initial schema'
  );

  const connectionConfig = {
    roleName: 'app_role',
    password: 'valid_password',
    tenantId: 'tenant_1' as const,
  };

  const wrongChecksum = 'wrong_checksum';
  const result = capability.applyMigrationFile(
    initial,
    migrationFile,
    wrongChecksum,
    connectionConfig,
    auditFn
  );

  assert.ok('kind' in result && 'message' in result);
  const error = result as capability.RelationalStorageAndMigrationsAndRlsError;
  assert.strictEqual(error.kind, 'CHECKSUM_MISMATCH');
  assert.strictEqual(error.tenantId, 'tenant_1');

  const substrateUnavailableState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...initial,
    substrateAvailable: false,
  };
  const providerError = capability.applyMigrationFile(
    substrateUnavailableState,
    migrationFile,
    migrationFile.checksum,
    connectionConfig,
    auditFn
  );
  assert.ok('kind' in providerError && 'message' in providerError);
  const providerErrorTyped = providerError as capability.RelationalStorageAndMigrationsAndRlsError;
  assert.strictEqual(providerErrorTyped.kind, 'PROVIDER_UNAVAILABLE');

  const missingConfigError = capability.validateMissingConfiguration(null);
  assert.notStrictEqual(missingConfigError, null);
  assert.strictEqual(missingConfigError?.kind, 'INVALID_CONFIGURATION');

  const partialConfigError = capability.validateMissingConfiguration({ key: null });
  assert.notStrictEqual(partialConfigError, null);
  assert.strictEqual(partialConfigError?.kind, 'INVALID_CONFIGURATION');

  const degradedMode = capability.determineDegradedMode(substrateUnavailableState);
  assert.strictEqual(degradedMode.isDegraded, true);
  assert.strictEqual(degradedMode.canMutate, false);
  assert.strictEqual(degradedMode.canRead, false);
  assert.strictEqual(degradedMode.error?.kind, 'DEGRADED');
});

test("relationalstorageandmigrationsandrlslifecycle", () => {
  const initial = capability.initialState;
  const auditFn = (event: capability.RelationalStorageAndMigrationsAndRlsAuditEvent): capability.RelationalStorageAndMigrationsAndRlsError | null => null;

  const migration1 = capability.createMigrationFile(
    '001_init.sql',
    0,
    'CREATE TABLE test (tenant_id TEXT NOT NULL);',
    'Initial schema'
  );
  const migration2 = capability.createMigrationFile(
    '002_add_column.sql',
    1,
    'ALTER TABLE test ADD COLUMN name TEXT;',
    'Add name column'
  );

  const connectionConfig = {
    roleName: 'app_role',
    password: 'valid_password',
    tenantId: 'tenant_1' as const,
  };

  const stateAfterFirst = capability.applyMigrationFile(
    initial,
    migration1,
    migration1.checksum,
    connectionConfig,
    auditFn
  );
  assert.ok(!('kind' in stateAfterFirst && 'message' in stateAfterFirst));
  const state1 = stateAfterFirst as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(state1.appliedMigrations.length, 1);
  assert.strictEqual(state1.appliedMigrations[0].fileName, '001_init.sql');
  assert.strictEqual(state1.migrationLineage.length, 1);
  assert.ok(state1.migrationLineage[0].includes('001_init.sql:sha256:'));
  assert.ok(state1.migrationLineage[0].includes(':Initial schema'));

  const stateAfterSecond = capability.applyMigrationFile(
    state1,
    migration2,
    migration2.checksum,
    connectionConfig,
    auditFn
  );
  assert.ok(!('kind' in stateAfterSecond && 'message' in stateAfterSecond));
  const state2 = stateAfterSecond as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(state2.appliedMigrations.length, 2);
  assert.strictEqual(state2.appliedMigrations[1].fileName, '002_add_column.sql');
  assert.strictEqual(state2.migrationLineage.length, 2);

  const skipResult = capability.applyMigrationFile(
    state2,
    migration1,
    migration1.checksum,
    connectionConfig,
    auditFn
  );
  assert.ok(!('kind' in skipResult && 'message' in skipResult));
  const state3 = skipResult as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(state3.auditLog[state3.auditLog.length - 1].kind, 'MIGRATION_SKIPPED');
  assert.strictEqual(state3.appliedMigrations.length, 2);

  const chainResult = capability.runMigrationChain(
    initial,
    [migration1, migration2],
    connectionConfig,
    auditFn
  );
  assert.ok(!('kind' in chainResult && 'message' in chainResult));
  const chainState = chainResult as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(chainState.appliedMigrations.length, 2);
  assert.strictEqual(chainState.migrationLineage.length, 2);

  const checksumGateResult = capability.executeChecksumGates(
    state2,
    [migration1, migration2],
    connectionConfig,
    auditFn
  );
  assert.ok(!('kind' in checksumGateResult && 'message' in checksumGateResult));
});

test("relationalstorageandmigrationsandrlspermissions", () => {
  const bypassRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: 'bypass_role',
    kind: 'BYPASS_ROLE',
    inherit: true,
    bypassRls: true,
    canLogin: true,
    password: null,
  };
  const appRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: 'app_role',
    kind: 'APPLICATION_ROLE',
    inherit: false,
    bypassRls: false,
    canLogin: true,
    password: 'valid_password',
  };
  const roles = [bypassRole, appRole];
  const validationError = capability.validateRoleConfiguration(roles);
  assert.strictEqual(validationError, null);

  const invalidAppRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: 'invalid_app_role',
    kind: 'APPLICATION_ROLE',
    inherit: true,
    bypassRls: false,
    canLogin: true,
    password: null,
  };
  const invalidRoles = [bypassRole, invalidAppRole];
  const invalidError = capability.validateRoleConfiguration(invalidRoles);
  assert.notStrictEqual(invalidError, null);
  assert.strictEqual(invalidError?.kind, 'INVALID_CONFIGURATION');

  const state: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...capability.initialState,
    roles,
    substrateAvailable: true,
    connected: true,
  };
  const port = capability.createRepositoryPort('test_context', ['read', 'write'] as const);
  const connectionConfig = {
    roleName: 'app_role',
    tenantId: 'tenant_1' as const,
  };
  const decision = capability.mediateRepositoryAccess(state, port, connectionConfig);
  assert.strictEqual(decision, 'GRANTED');

  const noTenantConfig = {
    roleName: 'app_role',
    tenantId: null as string | null,
  };
  const noTenantDecision = capability.mediateRepositoryAccess(state, port, noTenantConfig);
  assert.strictEqual(noTenantDecision, 'DENIED');

  const tenantContext: capability.RelationalStorageAndMigrationsAndRlsTenantContext = {
    tenantId: 'tenant_1',
    roleName: 'app_role',
    isBypassRole: false,
  };
  const isolationDecision = capability.evaluateTenantIsolation(state, tenantContext, 'tenant_1', 'bypass_role', true);
  assert.strictEqual(isolationDecision, 'GRANTED');

  const crossTenantDecision = capability.evaluateTenantIsolation(state, tenantContext, 'tenant_2', 'bypass_role', true);
  assert.strictEqual(crossTenantDecision, 'DENIED');

  const bypassContext: capability.RelationalStorageAndMigrationsAndRlsTenantContext = {
    tenantId: 'tenant_1',
    roleName: 'bypass_role',
    isBypassRole: true,
  };
  const bypassDecision = capability.evaluateTenantIsolation(state, bypassContext, 'tenant_2', 'bypass_role', true);
  assert.strictEqual(bypassDecision, 'GRANTED');
});

test("relationalstorageandmigrationsandrlsproof", () => {
  const initial = capability.initialState;
  const auditFn = (event: capability.RelationalStorageAndMigrationsAndRlsAuditEvent): capability.RelationalStorageAndMigrationsAndRlsError | null => null;

  const migrationFile = capability.createMigrationFile(
    '001_init.sql',
    0,
    'CREATE TABLE test (tenant_id TEXT NOT NULL);',
    'Initial schema'
  );

  const connectionConfig = {
    roleName: 'app_role',
    password: 'valid_password',
    tenantId: 'tenant_1' as const,
  };

  const stateAfterMigration = capability.applyMigrationFile(
    initial,
    migrationFile,
    migrationFile.checksum,
    connectionConfig,
    auditFn
  );
  assert.ok(!('kind' in stateAfterMigration && 'message' in stateAfterMigration));
  const state = stateAfterMigration as capability.RelationalStorageAndMigrationsAndRlsState;

  const foreignTenantContext: capability.RelationalStorageAndMigrationsAndRlsTenantContext = {
    tenantId: 'tenant_2',
    roleName: 'app_role',
    isBypassRole: false,
  };
  const proof = capability.createTenantIsolationProof(state, 0, foreignTenantContext);
  assert.strictEqual(proof, true);

  const nonZeroProof = capability.createTenantIsolationProof(state, 1, foreignTenantContext);
  assert.strictEqual(nonZeroProof, false);

  const bypassContext: capability.RelationalStorageAndMigrationsAndRlsTenantContext = {
    tenantId: 'tenant_1',
    roleName: 'bypass_role',
    isBypassRole: true,
  };
  const bypassProof = capability.createTenantIsolationProof(state, 1, bypassContext);
  assert.strictEqual(bypassProof, false);

  const proofResult = capability.proveCrossTenantIsolation(
    state,
    'tenant_2',
    0,
    auditFn
  );
  assert.ok(!('kind' in proofResult && 'message' in proofResult));
  const proofState = proofResult as capability.RelationalStorageAndMigrationsAndRlsState;
  assert.strictEqual(proofState.crossTenantIsolationProven, true);

  const liveProof = capability.runLiveIsolationProof(
    state,
    foreignTenantContext,
    0,
    auditFn
  );
  assert.strictEqual(liveProof.proofPassed, true);
  assert.strictEqual(liveProof.error, null);

  const migratedStateGate = capability.verifyMigratedStateGate(state, 1);
  assert.strictEqual(migratedStateGate.passed, true);
  assert.strictEqual(migratedStateGate.error, null);
});

test("relationalstorageandmigrationsandrlsreadinessmodel", () => {
  const initial = capability.initialState;
  const readiness = capability.checkReadiness(initial);
  assert.strictEqual(readiness.readiness, 'NOT_READY');
  assert.notStrictEqual(readiness.error, null);
  assert.strictEqual(readiness.error?.kind, 'READINESS_UNAVAILABLE');

  const connectedState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...initial,
    connected: true,
    substrateAvailable: true,
  };
  const connectedReadiness = capability.checkReadiness(connectedState);
  assert.strictEqual(connectedReadiness.readiness, 'NOT_READY');
  assert.strictEqual(connectedReadiness.error?.kind, 'READINESS_UNAVAILABLE');

  const migratedState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...connectedState,
    ledgerNonEmpty: true,
  };
  const migratedReadiness = capability.checkReadiness(migratedState);
  assert.strictEqual(migratedReadiness.readiness, 'NOT_READY');
  assert.strictEqual(migratedReadiness.error?.kind, 'READINESS_UNAVAILABLE');

  const readyState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...migratedState,
    crossTenantIsolationProven: true,
    auditLog: [capability.createAuditEvent('MIGRATION_APPLIED', 'tenant_1', '001_init.sql', 'sha256:abc', {})],
  };
  const readyReadiness = capability.checkReadiness(readyState);
  assert.strictEqual(readyReadiness.readiness, 'READY');
  assert.strictEqual(readyReadiness.error, null);

  const degradedState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...initial,
    substrateAvailable: false,
  };
  const degradedReadiness = capability.checkReadiness(degradedState);
  assert.strictEqual(degradedReadiness.readiness, 'DEGRADED');
  assert.strictEqual(degradedReadiness.error?.kind, 'DEGRADED');

  const promotionBlock = capability.blockPromotionOnUnavailability(readyState);
  assert.strictEqual(promotionBlock.blocked, false);
  assert.strictEqual(promotionBlock.reason, null);

  const unreadyPromotionBlock = capability.blockPromotionOnUnavailability(initial);
  assert.strictEqual(unreadyPromotionBlock.blocked, true);
  assert.notStrictEqual(unreadyPromotionBlock.reason, null);

  const degradedMode = capability.determineDegradedMode(degradedState);
  assert.strictEqual(degradedMode.isDegraded, true);
  assert.strictEqual(degradedMode.canMutate, false);
  assert.strictEqual(degradedMode.canRead, false);
});