import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/relationalstorageandmigrationsandrls.ts";

const auditOk: (
  event: capability.RelationalStorageAndMigrationsAndRlsAuditEvent,
) => capability.RelationalStorageAndMigrationsAndRlsError | null = () => null;

function readyState(
  overrides: Partial<capability.RelationalStorageAndMigrationsAndRlsState> = {},
): capability.RelationalStorageAndMigrationsAndRlsState {
  return {
    ...capability.initialState,
    substrateAvailable: true,
    connected: true,
    ...overrides,
  };
}

function narrowState(
  value: capability.RelationalStorageAndMigrationsAndRlsState | capability.RelationalStorageAndMigrationsAndRlsError,
): capability.RelationalStorageAndMigrationsAndRlsState {
  if (capability.isError(value)) {
    throw new Error("Expected state, got error");
  }
  return value;
}

function narrowError(
  value: capability.RelationalStorageAndMigrationsAndRlsState | capability.RelationalStorageAndMigrationsAndRlsError,
): capability.RelationalStorageAndMigrationsAndRlsError {
  if (!capability.isError(value)) {
    throw new Error("Expected error, got state");
  }
  return value;
}

test("relationalstorageandmigrationsandrlsauditmodel", () => {
  const migrationFile = capability.createMigrationFile(
    "001_init.sql",
    0,
    "CREATE TABLE tenant_orders (tenant_id TEXT NOT NULL);",
    "Initial schema",
  );
  const connectionConfig = {
    roleName: "app_role",
    password: "valid_password",
    tenantId: "tenant-1",
    organisationId: "org-1",
  };

  const appliedState = narrowState(
    capability.applyMigrationFile(
      readyState(),
      migrationFile,
      migrationFile.checksum,
      connectionConfig,
      auditOk,
    ),
  );

  assert.strictEqual(appliedState.appliedMigrations.length, 1);
  const appliedMigration = appliedState.appliedMigrations[0]!;
  assert.strictEqual(appliedMigration.fileName, migrationFile.fileName);
  assert.strictEqual(appliedMigration.checksum, migrationFile.checksum);
  assert.strictEqual(typeof appliedMigration.appliedAt, "string");
  assert.strictEqual(appliedMigration.decisionReferenceComment, "Initial schema");

  const lineage = appliedState.migrationLineage[0]!;
  assert.strictEqual(
    lineage,
    `001_init.sql:${appliedMigration.checksum}:Initial schema`,
  );

  const mutationEvent = capability.auditStateChangingAccess(
    appliedState,
    "tenant-1",
    "org-1",
    "INSERT",
    "route_orders",
    "create_order",
    "span_provider_1",
    auditOk,
  );
  const stateAfterMutation = narrowState(mutationEvent);
  const lastEvent = stateAfterMutation.auditLog[stateAfterMutation.auditLog.length - 1]!;
  assert.strictEqual(lastEvent.kind, "STATE_CHANGING_ACCESS");
  assert.strictEqual(lastEvent.tenantId, "tenant-1");
  assert.strictEqual(lastEvent.organisationId, "org-1");

  const typedError = capability.createTypedTenantError(
    "MIGRATION_FAILED",
    "Migration failed",
    "tenant-1",
    "org-1",
  );
  assert.strictEqual(typedError.tenantId, "tenant-1");
  assert.strictEqual(typedError.organisationId, "org-1");
  assert.strictEqual(typedError.isError, true);
});

test("relationalstorageandmigrationsandrlscontracts", () => {
  const validResult = capability.validateConnectionPassword("valid_password_123");
  assert.strictEqual(validResult, null);

  const withQuote = capability.validateConnectionPassword("has'quote");
  assert.notStrictEqual(withQuote, null);
  if (withQuote !== null) {
    assert.strictEqual(withQuote.kind, "INVALID_CONFIGURATION");
  }

  const withBackslash = capability.validateConnectionPassword("has\\backslash");
  assert.notStrictEqual(withBackslash, null);
  if (withBackslash !== null) {
    assert.strictEqual(withBackslash.kind, "INVALID_CONFIGURATION");
  }

  const withControl = capability.validateConnectionPassword("has\ncontrol");
  assert.notStrictEqual(withControl, null);
  if (withControl !== null) {
    assert.strictEqual(withControl.kind, "INVALID_CONFIGURATION");
  }

  const substituted = capability.substituteManagedRolePassword(
    "postgresql://user:__MANAGED_APP_ROLE_PASSWORD__@localhost/db",
    "top_secret_1",
  );
  if (typeof substituted !== "string") {
    throw new Error("Expected string substitution result");
  }
  assert.strictEqual(
    substituted,
    "postgresql://user:top_secret_1@localhost/db",
  );

  const badSubstitution = capability.substituteManagedRolePassword(
    "postgresql://user:__MANAGED_APP_ROLE_PASSWORD__@localhost/db",
    "bad'pw",
  );
  assert.strictEqual(typeof badSubstitution, "object");
  if (typeof badSubstitution === "string") {
    throw new Error("Expected error for bad password substitution");
  }
  assert(capability.isError(badSubstitution));
  const badError = narrowError(badSubstitution);
  assert.strictEqual(badError.kind, "INVALID_CONFIGURATION");

  const rlsPredicate = capability.createRlsPredicate(
    "tenant_id",
    "app.current_tenant",
    "bypass_role",
  );
  assert.match(
    rlsPredicate,
    /current_setting|pg_has_role/,
  );

  const ddl = capability.createTableWithRls(
    "tenant_orders",
    "tenant_id",
    rlsPredicate,
  );
  assert.match(ddl, /ENABLE ROW LEVEL SECURITY/);
  assert.match(ddl, /FORCE ROW LEVEL SECURITY/);
  assert.match(ddl, /tenant_isolation_policy/);

  const port = capability.createRepositoryPort("orders", ["create", "findById"]);
  assert.strictEqual(port.context, "orders");
  assert.deepStrictEqual([...port.operations], ["create", "findById"]);
});

test("relationalstorageandmigrationsandrlserrormodel", () => {
  const migrationFile = capability.createMigrationFile(
    "001_init.sql",
    0,
    "CREATE TABLE tenant_data (tenant_id TEXT NOT NULL);",
    "Initial schema",
  );
  const connectionConfig = {
    roleName: "app_role",
    password: "valid_password",
    tenantId: "tenant-1",
    organisationId: "org-1",
  };

  const mismatch = capability.applyMigrationFile(
    readyState(),
    migrationFile,
    "wrong_checksum",
    connectionConfig,
    auditOk,
  );
  const mismatchError = narrowError(mismatch);
  assert.strictEqual(mismatchError.kind, "CHECKSUM_MISMATCH");

  const appliedState = narrowState(
    capability.applyMigrationFile(
      readyState(),
      migrationFile,
      migrationFile.checksum,
      connectionConfig,
      auditOk,
    ),
  );

  const secondAttempt = capability.applyMigrationFile(
    appliedState,
    migrationFile,
    "tampered_checksum",
    connectionConfig,
    auditOk,
  );
  const secondError = narrowError(secondAttempt);
  assert.strictEqual(secondError.kind, "CHECKSUM_MISMATCH");
  assert.strictEqual(appliedState.appliedMigrations.length, 1);
  assert.strictEqual(appliedState.migrationLineage.length, 1);

  const missingConfig = capability.validateMissingConfiguration(null);
  assert.notStrictEqual(missingConfig, null);
  if (missingConfig !== null) {
    assert.strictEqual(missingConfig.kind, "INVALID_CONFIGURATION");
  }

  const providerFailure = capability.applyMigrationFile(
    { ...capability.initialState, substrateAvailable: false },
    migrationFile,
    migrationFile.checksum,
    connectionConfig,
    auditOk,
  );
  const providerError = narrowError(providerFailure);
  assert.strictEqual(providerError.kind, "PROVIDER_UNAVAILABLE");

  const degraded = capability.determineDegradedMode({
    ...capability.initialState,
    substrateAvailable: false,
  });
  assert.strictEqual(degraded.isDegraded, true);
  assert.strictEqual(degraded.canMutate, false);
  assert.strictEqual(degraded.canRead, true);
});

test("relationalstorageandmigrationsandrlslifecycle", () => {
  const migration1 = capability.createMigrationFile(
    "001_init.sql",
    0,
    "CREATE TABLE tenant_data (tenant_id TEXT NOT NULL);",
    "Initial schema",
  );
  const migration2 = capability.createMigrationFile(
    "002_add_name.sql",
    1,
    "ALTER TABLE tenant_data ADD COLUMN name TEXT;",
    "Add name",
  );
  const migration3 = capability.createMigrationFile(
    "003_seed.sql",
    2,
    "CREATE TABLE tenant_audit (tenant_id TEXT NOT NULL);",
    "Seed audit",
  );
  const connectionConfig = {
    roleName: "app_role",
    password: "valid_password",
    tenantId: "tenant-1",
    organisationId: "org-1",
  };

  const freshChain = narrowState(
    capability.runMigrationChain(
      readyState(),
      [migration2, migration1, migration3],
      connectionConfig,
      auditOk,
    ),
  );
  assert.deepStrictEqual(
    freshChain.appliedMigrations.map((m) => m.fileName),
    ["001_init.sql", "002_add_name.sql", "003_seed.sql"],
  );
  assert.strictEqual(freshChain.ledgerNonEmpty, true);

  const oneAppliedState = narrowState(
    capability.applyMigrationFile(
      readyState(),
      migration1,
      migration1.checksum,
      connectionConfig,
      auditOk,
    ),
  );

  const partialChain = narrowState(
    capability.runMigrationChain(
      oneAppliedState,
      [migration1, migration2, migration3],
      connectionConfig,
      auditOk,
    ),
  );
  assert.strictEqual(partialChain.appliedMigrations.length, 3);
  const skipped = partialChain.auditLog.filter((event) => event.kind === "MIGRATION_SKIPPED");
  assert.strictEqual(skipped.length, 1);

  const lineageCheck = capability.verifyMigrationLineage(
    partialChain,
    partialChain.migrationLineage,
  );
  assert.strictEqual(lineageCheck, true);

  const checksumGateResult = capability.executeChecksumGates(
    partialChain,
    [migration1, migration2, migration3],
    connectionConfig,
    auditOk,
  );
  assert.strictEqual(
    capability.isError(checksumGateResult),
    false,
  );

  const tamperedState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...partialChain,
    appliedMigrations: partialChain.appliedMigrations.map((m, idx) =>
      idx === 0 ? { ...m, checksum: "sha256:bad" } : m,
    ),
  };
  const tamperResult = capability.executeChecksumGates(
    tamperedState,
    [migration1, migration2, migration3],
    connectionConfig,
    auditOk,
  );
  assert(capability.isError(tamperResult));
  if (capability.isError(tamperResult)) {
    assert.strictEqual(tamperResult.kind, "CHECKSUM_MISMATCH");
  }
});

test("relationalstorageandmigrationsandrlspermissions", () => {
  const appRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: "app_role",
    kind: "APPLICATION_ROLE",
    inherit: false,
    bypassRls: false,
    canLogin: true,
    password: "valid_password",
  };
  const bypassRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: "bypass_role",
    kind: "BYPASS_ROLE",
    inherit: true,
    bypassRls: true,
    canLogin: true,
    password: null,
  };
  const migrationRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: "migration_role",
    kind: "MIGRATION_ROLE",
    inherit: false,
    bypassRls: false,
    canLogin: true,
    password: null,
  };
  const systemRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: "system_admin",
    kind: "SYSTEM_ADMIN_ROLE",
    inherit: false,
    bypassRls: false,
    canLogin: true,
    password: null,
  };

  const valid = capability.validateRoleConfiguration([
    appRole,
    bypassRole,
    migrationRole,
    systemRole,
  ]);
  assert.strictEqual(valid, null);

  const invalidApp = capability.validateRoleConfiguration([
    {
      name: "bad_app",
      kind: "APPLICATION_ROLE",
      inherit: true,
      bypassRls: false,
      canLogin: true,
      password: "valid_password",
    },
    bypassRole,
  ]);
  assert.notStrictEqual(invalidApp, null);
  if (invalidApp !== null) {
    assert.strictEqual(invalidApp.kind, "INVALID_CONFIGURATION");
  }

  const invalidBypass = capability.validateRoleConfiguration([
    appRole,
    {
      ...bypassRole,
      inherit: false,
    },
  ]);
  assert.notStrictEqual(invalidBypass, null);
  if (invalidBypass !== null) {
    assert.strictEqual(invalidBypass.kind, "INVALID_CONFIGURATION");
  }

  const state: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...capability.initialState,
    substrateAvailable: true,
    connected: true,
    roles: [appRole, bypassRole, migrationRole, systemRole],
  };

  assert.strictEqual(
    capability.evaluateTenantIsolation(
      state,
      { tenantId: "tenant-1", roleName: "app_role", isBypassRole: false, organisationId: "org-1" },
      "tenant-1",
      "bypass_role",
      true,
    ),
    "GRANTED",
  );
  assert.strictEqual(
    capability.evaluateTenantIsolation(
      state,
      { tenantId: "tenant-1", roleName: "app_role", isBypassRole: false, organisationId: "org-1" },
      "tenant-2",
      "bypass_role",
      true,
    ),
    "DENIED",
  );
  assert.strictEqual(
    capability.evaluateTenantIsolation(
      state,
      { tenantId: "tenant-1", roleName: "bypass_role", isBypassRole: true, organisationId: "org-1" },
      "tenant-9",
      "bypass_role",
      true,
    ),
    "GRANTED",
  );
  assert.strictEqual(
    capability.evaluateTenantIsolation(
      state,
      { tenantId: "tenant-1", roleName: "migration_role", isBypassRole: false, organisationId: "org-1" },
      "tenant-9",
      "bypass_role",
      true,
    ),
    "GRANTED",
  );
  assert.strictEqual(
    capability.evaluateTenantIsolation(
      state,
      { tenantId: "tenant-1", roleName: "system_admin", isBypassRole: false, organisationId: "org-1" },
      "tenant-9",
      "bypass_role",
      false,
    ),
    "GRANTED",
  );

  const port = capability.createRepositoryPort("orders", ["create"]);
  assert.strictEqual(
    capability.mediateRepositoryAccess(
      state,
      port,
      { roleName: "app_role", tenantId: "tenant-1" },
    ),
    "GRANTED",
  );
  assert.strictEqual(
    capability.mediateRepositoryAccess(
      state,
      port,
      { roleName: "app_role", tenantId: null },
    ),
    "DENIED",
  );
  assert.strictEqual(
    capability.mediateRepositoryAccess(
      state,
      port,
      { roleName: "missing_role", tenantId: "tenant-1" },
    ),
    "DENIED",
  );
});

test("relationalstorageandmigrationsandrlsproof", () => {
  const migrationFile = capability.createMigrationFile(
    "001_init.sql",
    0,
    "CREATE TABLE tenant_data (tenant_id TEXT NOT NULL);",
    "Initial schema",
  );
  const connectionConfig = {
    roleName: "app_role",
    password: "valid_password",
    tenantId: "tenant-1",
    organisationId: "org-1",
  };

  const appliedState = narrowState(
    capability.applyMigrationFile(
      readyState(),
      migrationFile,
      migrationFile.checksum,
      connectionConfig,
      auditOk,
    ),
  );

  const foreignTenantContext: capability.RelationalStorageAndMigrationsAndRlsTenantContext = {
    tenantId: "tenant-2",
    roleName: "app_role",
    isBypassRole: false,
    organisationId: "org-2",
  };
  assert.strictEqual(
    capability.createTenantIsolationProof(appliedState, 0, foreignTenantContext),
    true,
  );
  assert.strictEqual(
    capability.createTenantIsolationProof(appliedState, 1, foreignTenantContext),
    false,
  );

  const bypassContext: capability.RelationalStorageAndMigrationsAndRlsTenantContext = {
    tenantId: "tenant-2",
    roleName: "bypass_role",
    isBypassRole: true,
    organisationId: "org-2",
  };
  assert.strictEqual(
    capability.createTenantIsolationProof(appliedState, 0, bypassContext),
    false,
  );

  const proof = narrowState(
    capability.proveCrossTenantIsolation(appliedState, "tenant-2", 0, auditOk),
  );
  assert.strictEqual(proof.crossTenantIsolationProven, true);
  const proofEvent = proof.auditLog[proof.auditLog.length - 1]!;
  assert.strictEqual(proofEvent.kind, "RLS_PREDICATE_EVALUATED");

  const failedProof = capability.proveCrossTenantIsolation(appliedState, "tenant-2", 3, auditOk);
  const failedProofError = narrowError(failedProof);
  assert.strictEqual(failedProofError.kind, "RLS_BYPASS_INVALID");

  const live = capability.runLiveIsolationProof(appliedState, foreignTenantContext, 0, auditOk);
  assert.strictEqual(live.proofPassed, true);
  assert.strictEqual(live.error, null);
  assert.strictEqual(live.state.crossTenantIsolationProven, true);

  const failedLive = capability.runLiveIsolationProof(appliedState, foreignTenantContext, 4, auditOk);
  assert.strictEqual(failedLive.proofPassed, false);
  if (failedLive.error !== null) {
    assert.strictEqual(failedLive.error.kind, "RLS_BYPASS_INVALID");
  } else {
    throw new Error("Expected error for failed live isolation proof");
  }

  const bypassLive = capability.runLiveIsolationProof(appliedState, bypassContext, 0, auditOk);
  assert.strictEqual(bypassLive.proofPassed, false);
  if (bypassLive.error !== null) {
    assert.strictEqual(bypassLive.error.kind, "RLS_BYPASS_INVALID");
  } else {
    throw new Error("Expected error for bypass live isolation proof");
  }

  const isolationGate = capability.checkCrossTenantIsolationGate(appliedState, 0, "tenant-2");
  assert.strictEqual(isolationGate.passed, true);
  const isolationGateFail = capability.checkCrossTenantIsolationGate(appliedState, 5, "tenant-2");
  assert.strictEqual(isolationGateFail.passed, false);
  if (isolationGateFail.error !== null) {
    assert.strictEqual(isolationGateFail.error.kind, "RLS_BYPASS_INVALID");
  } else {
    throw new Error("Expected error for failed isolation gate");
  }
});

test("relationalstorageandmigrationsandrlsreadinessmodel", () => {
  const baseMigration: capability.RelationalStorageAndMigrationsAndRlsAppliedMigration = {
    fileName: "001_init.sql",
    checksum: "sha256:abc",
    appliedAt: new Date().toISOString(),
    orderIndex: 0,
    decisionReferenceComment: "init",
  };
  const baseAudit = capability.createAuditEvent(
    "MIGRATION_APPLIED",
    "tenant-1",
    "org-1",
    "001_init.sql",
    "sha256:abc",
    {},
  );

  const substrateOff: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...capability.initialState,
    substrateAvailable: false,
  };
  const degraded = capability.checkReadiness(substrateOff, 0, "tenant-2");
  assert.strictEqual(degraded.readiness, "DEGRADED");
  if (degraded.error !== null) {
    assert.strictEqual(degraded.error.kind, "DEGRADED");
  } else {
    throw new Error("Expected error for degraded readiness");
  }
  assert.strictEqual(degraded.promotionBlocked, true);

  const noLedger: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...capability.initialState,
    substrateAvailable: true,
    connected: true,
    ledgerNonEmpty: false,
    appliedMigrations: [],
  };
  const notReady = capability.checkReadiness(noLedger, 0, "tenant-2");
  assert.strictEqual(notReady.readiness, "NOT_READY");
  if (notReady.error !== null) {
    assert.strictEqual(notReady.error.kind, "READINESS_UNAVAILABLE");
  } else {
    throw new Error("Expected error for not-ready readiness");
  }

  const noIsolation: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...noLedger,
    ledgerNonEmpty: true,
    appliedMigrations: [baseMigration],
    crossTenantIsolationProven: false,
    auditLog: [baseAudit],
  };
  const noIsolationReadiness = capability.checkReadiness(noIsolation, 1, "tenant-2");
  assert.strictEqual(noIsolationReadiness.readiness, "NOT_READY");
  if (noIsolationReadiness.error !== null) {
    assert.strictEqual(noIsolationReadiness.error.kind, "READINESS_UNAVAILABLE");
  } else {
    throw new Error("Expected error for no-isolation readiness");
  }
  assert.strictEqual(noIsolationReadiness.gates.isolation, false);

  const noAudit: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...noIsolation,
    crossTenantIsolationProven: true,
    auditLog: [],
  };
  const noAuditReadiness = capability.checkReadiness(noAudit, 0, "tenant-2");
  assert.strictEqual(noAuditReadiness.readiness, "NOT_READY");
  if (noAuditReadiness.error !== null) {
    assert.strictEqual(noAuditReadiness.error.kind, "READINESS_UNAVAILABLE");
  } else {
    throw new Error("Expected error for no-audit readiness");
  }
  assert.strictEqual(noAuditReadiness.gates.audit, false);

  const readyStateInput: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...noIsolation,
    crossTenantIsolationProven: true,
    auditLog: [baseAudit],
  };
  const ready = capability.checkReadiness(readyStateInput, 0, "tenant-2");
  assert.strictEqual(ready.readiness, "READY");
  assert.strictEqual(ready.error, null);
  assert.strictEqual(ready.acceptanceGatesPassed, true);
  assert.strictEqual(ready.gates.migrated, true);
  assert.strictEqual(ready.gates.isolation, true);
  assert.strictEqual(ready.gates.audit, true);

  const readinessModel = capability.checkReadinessModel(readyStateInput, 0, "tenant-2");
  assert.strictEqual(readinessModel.readiness, "READY");
  assert.strictEqual(readinessModel.promotionBlocked, false);
  assert.strictEqual(readinessModel.promotionBlockReason, null);

  const promotionBlock = capability.blockPromotionOnUnavailability(readyStateInput, 0, "tenant-2");
  assert.strictEqual(promotionBlock.blocked, false);
  assert.strictEqual(promotionBlock.reason, null);

  const promotionBlockFail = capability.blockPromotionOnUnavailability(noLedger, 0, "tenant-2");
  assert.strictEqual(promotionBlockFail.blocked, true);
  assert.notStrictEqual(promotionBlockFail.reason, null);

  const acceptanceGates = capability.checkAcceptanceGates(readyStateInput, 0, "tenant-2");
  assert.strictEqual(acceptanceGates.passed, true);
  assert.strictEqual(acceptanceGates.readiness, "READY");

  const verifyAudit = capability.verifyAuditTrailReadiness(readyStateInput, 0, "tenant-2");
  assert.strictEqual(verifyAudit.ready, true);
  assert.strictEqual(verifyAudit.auditSignalPresent, true);
  assert.strictEqual(verifyAudit.isolationSignalPresent, true);
  assert.strictEqual(verifyAudit.migratedSignalPresent, true);
});