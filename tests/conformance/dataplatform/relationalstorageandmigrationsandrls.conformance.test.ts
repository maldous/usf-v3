import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/relationalstorageandmigrationsandrls.ts";

const auditOk: (event: capability.RelationalStorageAndMigrationsAndRlsAuditEvent) => capability.RelationalStorageAndMigrationsAndRlsError | null = () => null;

function readyState(overrides: Partial<capability.RelationalStorageAndMigrationsAndRlsState> = {}): capability.RelationalStorageAndMigrationsAndRlsState {
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
  assert.strictEqual(capability.isError(value), false);
  if (capability.isError(value)) {
    throw new Error("Expected state, got error");
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
  } as const;

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

  const migrationEvent = appliedState.auditLog[appliedState.auditLog.length - 1]!;
  assert.strictEqual(migrationEvent.kind, "MIGRATION_APPLIED");
  assert.strictEqual(migrationEvent.tenantId, connectionConfig.tenantId);
  assert.strictEqual(migrationEvent.organisationId, connectionConfig.organisationId);
  assert.strictEqual(migrationEvent.migrationFile, "001_init.sql");
  assert.strictEqual(migrationEvent.checksum, migrationFile.checksum);

  const tenantContext: capability.RelationalStorageAndMigrationsAndRlsTenantContext = {
    tenantId: "tenant-1",
    roleName: "app_role",
    isBypassRole: false,
    organisationId: "org-1",
  };
  const contextSetResult = narrowState(
    capability.setTenantContext(appliedState, tenantContext, auditOk),
  );
  const contextEvent = contextSetResult.auditLog[contextSetResult.auditLog.length - 1]!;
  assert.strictEqual(contextEvent.kind, "TENANT_CONTEXT_SET");
  assert.strictEqual(contextEvent.tenantId, tenantContext.tenantId);
  assert.strictEqual(contextEvent.organisationId, tenantContext.organisationId);

  const stateChangingResult = narrowState(
    capability.auditStateChangingAccess(
      contextSetResult,
      tenantContext.tenantId,
      tenantContext.organisationId,
      "UPDATE",
      "/api/orders",
      "create-order",
      "provider-span-1",
      auditOk,
    ),
  );
  const stateChangingEvent = stateChangingResult.auditLog[stateChangingResult.auditLog.length - 1]!;
  assert.strictEqual(stateChangingEvent.kind, "STATE_CHANGING_ACCESS");
  assert.strictEqual(stateChangingEvent.tenantId, tenantContext.tenantId);
  assert.strictEqual(stateChangingEvent.organisationId, tenantContext.organisationId);
  const stateChangingDetails = stateChangingEvent.details as {
    routeName: string;
    useCaseName: string;
    providerSpanId: string;
    tenantBoundaryPreserved: boolean;
    dataSubjectEvidencePreserved: boolean;
    auditTrailSpans: { route: string; useCase: string; provider: string };
  };
  assert.strictEqual(stateChangingDetails.routeName, "/api/orders");
  assert.strictEqual(stateChangingDetails.useCaseName, "create-order");
  assert.strictEqual(stateChangingDetails.providerSpanId, "provider-span-1");
  assert.strictEqual(stateChangingDetails.tenantBoundaryPreserved, true);
  assert.strictEqual(stateChangingDetails.dataSubjectEvidencePreserved, true);
  assert.strictEqual(stateChangingDetails.auditTrailSpans.route, "/api/orders");
  assert.strictEqual(stateChangingDetails.auditTrailSpans.useCase, "create-order");
  assert.strictEqual(stateChangingDetails.auditTrailSpans.provider, "provider-span-1");

  const failingAuditFn: (event: capability.RelationalStorageAndMigrationsAndRlsAuditEvent) => capability.RelationalStorageAndMigrationsAndRlsError | null = () => ({
    kind: "AUDIT_FAILURE",
    message: "audit sink unavailable",
    tenantId: null,
    organisationId: null,
    isError: true,
  });
  const failure = capability.auditStateChangingAccess(
    contextSetResult,
    tenantContext.tenantId,
    tenantContext.organisationId,
    "UPDATE",
    "/api/orders",
    "create-order",
    "provider-span-1",
    failingAuditFn,
  );
  assert.strictEqual(capability.isError(failure), true);
  if (!capability.isError(failure)) {
    throw new Error("audit failure must surface");
  }
  assert.strictEqual(failure.kind, "AUDIT_FAILURE");
  assert.strictEqual(failure.tenantId, tenantContext.tenantId);
  assert.strictEqual(failure.organisationId, tenantContext.organisationId);

  const typedError = capability.createTypedTenantError(
    "TENANT_CONTEXT_INVALID",
    "missing context",
    "tenant-1",
    "org-1",
  );
  assert.strictEqual(typedError.tenantId, "tenant-1");
  assert.strictEqual(typedError.organisationId, "org-1");
  assert.ok(typedError.message.includes("organisation=org-1"));

  const typedErrorNoOrg = capability.createTypedTenantError(
    "TENANT_CONTEXT_INVALID",
    "missing context",
    null,
    null,
  );
  assert.strictEqual(typedErrorNoOrg.tenantId, null);
  assert.strictEqual(typedErrorNoOrg.organisationId, null);
  assert.strictEqual(typedErrorNoOrg.message, "missing context");

  const provenState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...stateChangingResult,
    crossTenantIsolationProven: true,
  };
  const restoreResult = narrowState(
    capability.guardRestore(provenState, provenState, auditOk),
  );
  const restoreEvent = restoreResult.auditLog[restoreResult.auditLog.length - 1]!;
  assert.strictEqual(restoreEvent.kind, "RESTORE_GUARD_CHECKED");
  const restoreDetails = restoreEvent.details as {
    tenantBoundaryPreserved: boolean;
    dataSubjectEvidencePreserved: boolean;
    isolationSignalPreserved: boolean;
  };
  assert.strictEqual(restoreDetails.tenantBoundaryPreserved, true);
  assert.strictEqual(restoreDetails.dataSubjectEvidencePreserved, true);
  assert.strictEqual(restoreDetails.isolationSignalPreserved, true);

  const restoreBoundaryResult = narrowState(
    capability.auditRestoredTenantBoundary(
      restoreResult,
      "tenant-1",
      "org-1",
      true,
      true,
      auditOk,
    ),
  );
  const restoredBoundaryEvent = restoreBoundaryResult.auditLog[restoreBoundaryResult.auditLog.length - 1]!;
  assert.strictEqual(restoredBoundaryEvent.kind, "RESTORE_GUARD_CHECKED");
  const restoredBoundaryDetails = restoredBoundaryEvent.details as {
    tenantBoundaryPreserved: boolean;
    auditSignalPreserved: boolean;
    isolationSignalPreserved: boolean;
    dataSubjectEvidencePreserved: boolean;
  };
  assert.strictEqual(restoredBoundaryDetails.tenantBoundaryPreserved, true);
  assert.strictEqual(restoredBoundaryDetails.auditSignalPreserved, true);
  assert.strictEqual(restoredBoundaryDetails.isolationSignalPreserved, true);
  assert.strictEqual(restoredBoundaryDetails.dataSubjectEvidencePreserved, true);

  const restoreBlocked = capability.auditRestoredTenantBoundary(
    restoreResult,
    "",
    "org-1",
    true,
    true,
    auditOk,
  );
  assert.strictEqual(capability.isError(restoreBlocked), true);
  if (!capability.isError(restoreBlocked)) {
    throw new Error("restore with empty tenant must be blocked");
  }
  assert.strictEqual(restoreBlocked.kind, "RESTORE_NOT_PERMITTED");

  const recordResult = narrowState(
    capability.recordMutationAuditTrail(
      restoreBoundaryResult,
      "tenant-1",
      "org-1",
      "/api/orders",
      "create-order",
      "provider-span-1",
      auditOk,
    ),
  );
  const recordEvent = recordResult.auditLog[recordResult.auditLog.length - 1]!;
  assert.strictEqual(recordEvent.kind, "STATE_CHANGING_ACCESS");
  const recordDetails = recordEvent.details as {
    auditTrailSpans: { route: string; useCase: string; provider: string };
  };
  assert.strictEqual(recordDetails.auditTrailSpans.route, "/api/orders");
  assert.strictEqual(recordDetails.auditTrailSpans.useCase, "create-order");
  assert.strictEqual(recordDetails.auditTrailSpans.provider, "provider-span-1");

  const missingOrg = capability.recordMutationAuditTrail(
    restoreBoundaryResult,
    "tenant-1",
    "",
    "/api/orders",
    "create-order",
    "provider-span-1",
    auditOk,
  );
  assert.strictEqual(capability.isError(missingOrg), true);
  if (capability.isError(missingOrg)) {
    assert.strictEqual(missingOrg.kind, "TENANT_CONTEXT_INVALID");
  }
});

test("relationalstorageandmigrationsandrlscontracts", () => {
  assert.strictEqual(capability.validateConnectionPassword("valid_password_123"), null);
  const withQuote = capability.validateConnectionPassword("has'quote");
  assert.ok(withQuote !== null);
  if (withQuote !== null) {
    assert.strictEqual(withQuote.kind, "INVALID_CONFIGURATION");
  }
  const withBackslash = capability.validateConnectionPassword("has\\backslash");
  assert.ok(withBackslash !== null);
  if (withBackslash !== null) {
    assert.strictEqual(withBackslash.kind, "INVALID_CONFIGURATION");
  }
  const withControl = capability.validateConnectionPassword("has\ncontrol");
  assert.ok(withControl !== null);
  if (withControl !== null) {
    assert.strictEqual(withControl.kind, "INVALID_CONFIGURATION");
  }

  const substituted = capability.substituteManagedRolePassword(
    "postgresql://user:__MANAGED_APP_ROLE_PASSWORD__@localhost/db",
    "top_secret_1",
  );
  assert.strictEqual(typeof substituted, "string");
  if (typeof substituted === "string") {
    assert.strictEqual(substituted, "postgresql://user:top_secret_1@localhost/db");
  } else {
    throw new Error("Expected string substitution");
  }

  const noPlaceholder = capability.substituteManagedRolePassword(
    "postgresql://user:fixed@localhost/db",
    "top_secret_1",
  );
  assert.strictEqual(typeof noPlaceholder, "string");
  if (typeof noPlaceholder === "string") {
    assert.strictEqual(noPlaceholder, "postgresql://user:fixed@localhost/db");
  } else {
    throw new Error("Expected string substitution");
  }

  const badSubstitution = capability.substituteManagedRolePassword(
    "postgresql://user:__MANAGED_APP_ROLE_PASSWORD__@localhost/db",
    "bad'pw",
  );
  assert.strictEqual(capability.isError(badSubstitution), true);
  if (!capability.isError(badSubstitution)) {
    throw new Error("Expected error for bad password substitution");
  }
  assert.strictEqual(badSubstitution.kind, "INVALID_CONFIGURATION");

  const predicate = capability.createRlsPredicate("tenant_id", "app.current_tenant", "bypass_role");
  assert.ok(predicate.includes("tenant_id = current_setting('app.current_tenant')"));
  assert.ok(predicate.includes("current_user = 'bypass_role'"));
  assert.ok(predicate.includes("pg_has_role(current_user, 'bypass_role', 'MEMBER')"));
  assert.ok(predicate.includes("role_inheritance.active"));

  const tableSql = capability.createTableWithRls("tenant_order_items", "tenant_id", predicate);
  assert.ok(tableSql.includes("CREATE TABLE tenant_order_items (tenant_id TEXT NOT NULL)"));
  assert.ok(tableSql.includes("ALTER TABLE tenant_order_items ENABLE ROW LEVEL SECURITY"));
  assert.ok(tableSql.includes("ALTER TABLE tenant_order_items FORCE ROW LEVEL SECURITY"));
  assert.ok(tableSql.includes("CREATE POLICY tenant_isolation_policy ON tenant_order_items USING ("));
  assert.ok(tableSql.includes(predicate));

  const port = capability.createRepositoryPort("orders_context", ["read", "write"]);
  assert.strictEqual(port.context, "orders_context");
  assert.deepStrictEqual(port.operations, ["read", "write"]);

  const appRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: "app_role",
    kind: "APPLICATION_ROLE",
    inherit: false,
    bypassRls: false,
    canLogin: true,
    password: "valid_password",
  };
  const state: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...capability.initialState,
    substrateAvailable: true,
    connected: true,
    roles: [appRole],
  };
  assert.strictEqual(
    capability.mediateRepositoryAccess(state, port, {
      roleName: "app_role",
      tenantId: "tenant-1",
    }),
    "GRANTED",
  );

  assert.strictEqual(
    capability.mediateRepositoryAccess(state, port, {
      roleName: "app_role",
      tenantId: null,
    }),
    "DENIED",
  );

  assert.strictEqual(
    capability.mediateRepositoryAccess({ ...state, connected: false }, port, {
      roleName: "app_role",
      tenantId: "tenant-1",
    }),
    "DEGRADED",
  );

  assert.strictEqual(
    capability.mediateRepositoryAccess(state, { context: "", operations: ["read"] }, {
      roleName: "app_role",
      tenantId: "tenant-1",
    }),
    "DENIED",
  );

  const noLoginRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: "no_login_app",
    kind: "APPLICATION_ROLE",
    inherit: false,
    bypassRls: false,
    canLogin: false,
    password: null,
  };
  const noLoginState: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...state,
    roles: [noLoginRole],
  };
  assert.strictEqual(
    capability.mediateRepositoryAccess(noLoginState, port, {
      roleName: "no_login_app",
      tenantId: "tenant-1",
    }),
    "DENIED",
  );
});

test("relationalstorageandmigrationsandrlserrormodel", () => {
  const migrationFile = capability.createMigrationFile(
    "001_init.sql",
    0,
    "CREATE TABLE tenant_data (tenant_id TEXT NOT NULL);",
    "Initial schema",
  );
  const migrationFile2 = capability.createMigrationFile(
    "002_add_name.sql",
    1,
    "ALTER TABLE tenant_data ADD COLUMN name TEXT;",
    "Add name",
  );
  const connectionConfig = {
    roleName: "app_role",
    password: "valid_password",
    tenantId: "tenant-1",
    organisationId: "org-1",
  } as const;

  const ready = readyState();

  const mismatch = capability.applyMigrationFile(
    ready,
    migrationFile,
    "wrong_checksum",
    connectionConfig,
    auditOk,
  );
  assert.strictEqual(capability.isError(mismatch), true);
  if (!capability.isError(mismatch)) {
    throw new Error("Expected checksum mismatch error");
  }
  assert.strictEqual(mismatch.kind, "CHECKSUM_MISMATCH");

  const appliedState = narrowState(
    capability.applyMigrationFile(
      ready,
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
  assert.strictEqual(capability.isError(secondAttempt), true);
  if (!capability.isError(secondAttempt)) {
    throw new Error("Expected another checksum mismatch error");
  }
  assert.strictEqual(secondAttempt.kind, "CHECKSUM_MISMATCH");
  assert.strictEqual(appliedState.appliedMigrations.length, 1);
  assert.strictEqual(appliedState.migrationLineage.length, 1);

  const tamperedTampered = capability.createMigrationFile(
    "001_init.sql",
    0,
    "DIFFERENT CONTENT",
    "Tampered",
  );
  const mismatchChain = capability.runMigrationChain(
    ready,
    [
      migrationFile,
      tamperedTampered,
      migrationFile2,
    ],
    connectionConfig,
    auditOk,
  );
  assert.strictEqual(capability.isError(mismatchChain), true);
  if (!capability.isError(mismatchChain)) {
    throw new Error("Expected migration chain failure");
  }
  assert.strictEqual(mismatchChain.kind, "CHECKSUM_MISMATCH");

  const checksumGateFail = capability.executeChecksumGates(
    appliedState,
    [migrationFile, { ...migrationFile2, checksum: "bad_checksum" }],
    connectionConfig,
    auditOk,
  );
  assert.strictEqual(capability.isError(checksumGateFail), true);
  if (!capability.isError(checksumGateFail)) {
    throw new Error("Expected checksum gate failure");
  }
  assert.strictEqual(checksumGateFail.kind, "CHECKSUM_MISMATCH");

  const providerUnavailable: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...capability.initialState,
    substrateAvailable: false,
  };
  const providerResult = capability.applyMigrationFile(
    providerUnavailable,
    migrationFile,
    migrationFile.checksum,
    connectionConfig,
    auditOk,
  );
  assert.strictEqual(capability.isError(providerResult), true);
  if (!capability.isError(providerResult)) {
    throw new Error("Expected provider unavailable error");
  }
  assert.strictEqual(providerResult.kind, "PROVIDER_UNAVAILABLE");

  const readiness = capability.checkReadiness(providerUnavailable, 0, "tenant-1");
  assert.strictEqual(readiness.readiness, "DEGRADED");
  assert.ok(readiness.error !== null);
  if (readiness.error !== null) {
    assert.strictEqual(readiness.error.kind, "DEGRADED");
  }

  const missing = capability.validateMissingConfiguration(null);
  assert.strictEqual(capability.isError(missing), true);
  if (!capability.isError(missing)) {
    throw new Error("Missing configuration should be an error");
  }
  assert.strictEqual(missing.kind, "INVALID_CONFIGURATION");

  const partial = capability.validateMissingConfiguration({ tenantId: null });
  assert.strictEqual(capability.isError(partial), true);
  if (!capability.isError(partial)) {
    throw new Error("Partial configuration should be an error");
  }
  assert.strictEqual(partial.kind, "INVALID_CONFIGURATION");

  const good = capability.validateMissingConfiguration({ tenantId: "tenant-1", org: "org-1" });
  assert.strictEqual(good, null);

  const badRoleConfig = capability.validateRoleConfiguration([
    {
      name: "bad_app",
      kind: "APPLICATION_ROLE",
      inherit: true,
      bypassRls: false,
      canLogin: true,
      password: "valid_password",
    },
  ]);
  assert.notStrictEqual(badRoleConfig, null);
  if (badRoleConfig !== null) {
    assert.strictEqual(badRoleConfig.kind, "INVALID_CONFIGURATION");
  }

  const rollingBack = narrowState(
    capability.auditMigrationRollback(
      appliedState,
      "002_add_name.sql",
      "operator fix",
      "tenant-1",
      "org-1",
      auditOk,
    ),
  );
  const rollbackEvent = rollingBack.auditLog[rollingBack.auditLog.length - 1]!;
  assert.strictEqual(rollbackEvent.kind, "MIGRATION_ROLLBACK");
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
  } as const;

  const ready = readyState();

  const freshChain = narrowState(
    capability.runMigrationChain(
      ready,
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
      ready,
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

  const tampered = capability.createMigrationFile(
    "002_add_name.sql",
    1,
    "ALTER TABLE tenant_data ADD COLUMN wrong TEXT;",
    "Tampered",
  );
  const gateFail = capability.executeChecksumGates(
    partialChain,
    [migration1, tampered, migration3],
    connectionConfig,
    auditOk,
  );
  assert.strictEqual(capability.isError(gateFail), true);
  if (!capability.isError(gateFail)) {
    throw new Error("Expected checksum gate failure");
  }
  assert.strictEqual(gateFail.kind, "CHECKSUM_MISMATCH");

  const gatePass = capability.executeChecksumGates(
    partialChain,
    [migration1, migration2, migration3],
    connectionConfig,
    auditOk,
  );
  assert.strictEqual(capability.isError(gatePass), false);
  if (capability.isError(gatePass)) {
    throw new Error("Expected gate to pass");
  }
  assert.strictEqual(gatePass.appliedMigrations.length, 3);

  assert.strictEqual(
    capability.verifyMigrationLineage(partialChain, partialChain.migrationLineage),
    true,
  );
  assert.strictEqual(capability.verifyMigrationLineage(partialChain, []), false);

  assert.ok(migration1.checksum.startsWith("sha256:"));
  assert.strictEqual(typeof migration1.checksum, "string");
  assert.notStrictEqual(
    migration1.checksum,
    capability.createMigrationFile(
      "001_init.sql",
      0,
      "CREATE TABLE tenant_data (tenant_id TEXT NOT NULL); DIFFERENT",
      "Initial schema",
    ).checksum,
  );
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

  const twoBypassRoles = capability.validateRoleConfiguration([
    appRole,
    bypassRole,
    {
      name: "another_bypass",
      kind: "BYPASS_ROLE",
      inherit: true,
      bypassRls: true,
      canLogin: true,
      password: null,
    },
  ]);
  assert.notStrictEqual(twoBypassRoles, null);
  if (twoBypassRoles !== null) {
    assert.strictEqual(twoBypassRoles.kind, "INVALID_CONFIGURATION");
  }

  const noBypass = capability.validateRoleConfiguration([
    appRole,
    migrationRole,
  ]);
  assert.notStrictEqual(noBypass, null);
  if (noBypass !== null) {
    assert.strictEqual(noBypass.kind, "INVALID_CONFIGURATION");
  }

  const bypassWithoutInherit = capability.validateRoleConfiguration([
    appRole,
    {
      name: "bad_bypass",
      kind: "BYPASS_ROLE",
      inherit: false,
      bypassRls: true,
      canLogin: true,
      password: null,
    },
  ]);
  assert.notStrictEqual(bypassWithoutInherit, null);
  if (bypassWithoutInherit !== null) {
    assert.strictEqual(bypassWithoutInherit.kind, "INVALID_CONFIGURATION");
  }

  const state: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...capability.initialState,
    substrateAvailable: true,
    connected: true,
    roles: [appRole, bypassRole, migrationRole, systemRole],
  };

  const port = capability.createRepositoryPort("orders", ["read", "write"]);
  assert.strictEqual(
    capability.mediateRepositoryAccess(state, port, { roleName: "app_role", tenantId: "tenant-1" }),
    "GRANTED",
  );
  assert.strictEqual(
    capability.mediateRepositoryAccess(state, port, { roleName: "app_role", tenantId: null }),
    "DENIED",
  );
  assert.strictEqual(
    capability.mediateRepositoryAccess(state, port, { roleName: "unknown", tenantId: "tenant-1" }),
    "DENIED",
  );
  assert.strictEqual(
    capability.mediateRepositoryAccess(
      { ...state, connected: false },
      port,
      { roleName: "app_role", tenantId: "tenant-1" },
    ),
    "DEGRADED",
  );

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

  const inheritedRole: capability.RelationalStorageAndMigrationsAndRlsRole = {
    name: "delegated_reader",
    kind: "APPLICATION_ROLE",
    inherit: true,
    bypassRls: true,
    canLogin: true,
    password: null,
  };
  const withInheritance: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...state,
    roles: [appRole, bypassRole, inheritedRole],
  };
  assert.strictEqual(
    capability.evaluateTenantIsolation(
      withInheritance,
      { tenantId: "tenant-1", roleName: "delegated_reader", isBypassRole: false, organisationId: "org-1" },
      "tenant-2",
      "bypass_role",
      false,
    ),
    "DENIED",
  );
  assert.strictEqual(
    capability.evaluateTenantIsolation(
      withInheritance,
      { tenantId: "tenant-1", roleName: "delegated_reader", isBypassRole: false, organisationId: "org-1" },
      "tenant-2",
      "bypass_role",
      true,
    ),
    "GRANTED",
  );

  const emptyTenant = capability.setTenantContext(state, {
    tenantId: "",
    roleName: "app_role",
    isBypassRole: false,
    organisationId: "org-1",
  }, auditOk);
  assert.strictEqual(capability.isError(emptyTenant), true);
  if (!capability.isError(emptyTenant)) {
    throw new Error("Expected empty tenant ID to be rejected");
  }
  assert.strictEqual(emptyTenant.kind, "TENANT_CONTEXT_INVALID");

  const wrongBypassName = capability.setTenantContext(state, {
    tenantId: "tenant-1",
    roleName: "not_bypass",
    isBypassRole: true,
    organisationId: "org-1",
  }, auditOk);
  assert.strictEqual(capability.isError(wrongBypassName), true);
  if (!capability.isError(wrongBypassName)) {
    throw new Error("Expected bypass role name mismatch to be rejected");
  }
  assert.strictEqual(wrongBypassName.kind, "TENANT_CONTEXT_INVALID");
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
  } as const;

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
  assert.strictEqual(capability.isError(failedProof), true);
  if (!capability.isError(failedProof)) {
    throw new Error("Expected proof failure with non-zero count");
  }
  assert.strictEqual(failedProof.kind, "RLS_BYPASS_INVALID");

  const live = capability.runLiveIsolationProof(appliedState, foreignTenantContext, 0, auditOk);
  assert.strictEqual(live.proofPassed, true);
  assert.strictEqual(live.error, null);
  assert.strictEqual(live.state.crossTenantIsolationProven, true);

  const failedLive = capability.runLiveIsolationProof(appliedState, foreignTenantContext, 4, auditOk);
  assert.strictEqual(failedLive.proofPassed, false);
  assert.ok(failedLive.error !== null);
  if (failedLive.error !== null) {
    assert.strictEqual(failedLive.error.kind, "RLS_BYPASS_INVALID");
  }

  const bypassLive = capability.runLiveIsolationProof(appliedState, bypassContext, 0, auditOk);
  assert.strictEqual(bypassLive.proofPassed, false);
  assert.ok(bypassLive.error !== null);
  if (bypassLive.error !== null) {
    assert.strictEqual(bypassLive.error.kind, "RLS_BYPASS_INVALID");
  }

  const crossTenantGate = capability.checkCrossTenantIsolationGate(appliedState, 0, "tenant-2");
  assert.strictEqual(crossTenantGate.passed, true);
  assert.strictEqual(crossTenantGate.error, null);

  const crossTenantGateFail = capability.checkCrossTenantIsolationGate(appliedState, 2, "tenant-2");
  assert.strictEqual(crossTenantGateFail.passed, false);
  assert.ok(crossTenantGateFail.error !== null);
  if (crossTenantGateFail.error !== null) {
    assert.strictEqual(crossTenantGateFail.error.kind, "RLS_BYPASS_INVALID");
  }

  const crossTenantGateNoSubstrate = capability.checkCrossTenantIsolationGate(
    { ...appliedState, substrateAvailable: false },
    0,
    "tenant-2",
  );
  assert.strictEqual(crossTenantGateNoSubstrate.passed, false);
  assert.ok(crossTenantGateNoSubstrate.error !== null);
  if (crossTenantGateNoSubstrate.error !== null) {
    assert.strictEqual(crossTenantGateNoSubstrate.error.kind, "PROVIDER_UNAVAILABLE");
  }

  const migratedGate = capability.verifyMigratedStateGate(appliedState, 1);
  assert.strictEqual(migratedGate.passed, true);
  assert.strictEqual(migratedGate.error, null);

  const migratedGateFail = capability.verifyMigratedStateGate(appliedState, 5);
  assert.strictEqual(migratedGateFail.passed, false);
  assert.ok(migratedGateFail.error !== null);
  if (migratedGateFail.error !== null) {
    assert.strictEqual(migratedGateFail.error.kind, "READINESS_UNAVAILABLE");
  }

  const performResult = capability.performStateChangingMutation(
    readyState({ crossTenantIsolationProven: true }),
    "tenant-1",
    "org-1",
    "UPDATE",
    "/api/orders",
    "create-order",
    "provider-span-1",
    (s) => s,
    auditOk,
  );
  assert.strictEqual(capability.isError(performResult), false);
  if (capability.isError(performResult)) {
    throw new Error("Expected mutation to succeed");
  }
  assert.strictEqual(performResult.crossTenantIsolationProven, true);

  const performBlocked = capability.performStateChangingMutation(
    { ...readyState(), substrateAvailable: false },
    "tenant-1",
    "org-1",
    "UPDATE",
    "/api/orders",
    "create-order",
    "provider-span-1",
    (s) => s,
    auditOk,
  );
  assert.strictEqual(capability.isError(performBlocked), true);
  if (!capability.isError(performBlocked)) {
    throw new Error("Expected provider unavailable error during mutation");
  }
  assert.strictEqual(performBlocked.kind, "PROVIDER_UNAVAILABLE");
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
  assert.ok(degraded.error !== null);
  if (degraded.error !== null) {
    assert.strictEqual(degraded.error.kind, "DEGRADED");
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
  assert.ok(notReady.error !== null);
  if (notReady.error !== null) {
    assert.strictEqual(notReady.error.kind, "READINESS_UNAVAILABLE");
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
  assert.ok(noIsolationReadiness.error !== null);
  if (noIsolationReadiness.error !== null) {
    assert.strictEqual(noIsolationReadiness.error.kind, "READINESS_UNAVAILABLE");
  }
  assert.strictEqual(noIsolationReadiness.gates.isolation, false);

  const noAudit: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...noIsolation,
    crossTenantIsolationProven: true,
    auditLog: [],
  };
  const noAuditReadiness = capability.checkReadiness(noAudit, 0, "tenant-2");
  assert.strictEqual(noAuditReadiness.readiness, "NOT_READY");
  assert.ok(noAuditReadiness.error !== null);
  if (noAuditReadiness.error !== null) {
    assert.strictEqual(noAuditReadiness.error.kind, "READINESS_UNAVAILABLE");
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

  const acceptance = capability.checkAcceptanceGates(readyStateInput, 0, "tenant-2");
  assert.strictEqual(acceptance.passed, true);
  assert.strictEqual(acceptance.readiness, "READY");
  assert.strictEqual(acceptance.gates.isolation, true);

  const blockedIsolation = capability.checkAcceptanceGates(readyStateInput, 2, "tenant-2");
  assert.strictEqual(blockedIsolation.passed, false);
  assert.strictEqual(blockedIsolation.readiness, "NOT_READY");
  assert.strictEqual(blockedIsolation.gates.isolation, false);

  const trailReady = capability.verifyAuditTrailReadiness(readyStateInput, 0, "tenant-2");
  assert.strictEqual(trailReady.ready, true);
  assert.strictEqual(trailReady.auditSignalPresent, true);
  assert.strictEqual(trailReady.isolationSignalPresent, true);
  assert.strictEqual(trailReady.migratedSignalPresent, true);
  assert.strictEqual(trailReady.promotionBlocked, false);

  const trailNotReady = capability.verifyAuditTrailReadiness(noIsolation, 0, "tenant-2");
  assert.strictEqual(trailNotReady.ready, false);
  assert.strictEqual(trailNotReady.isolationSignalPresent, false);
  assert.strictEqual(trailNotReady.promotionBlocked, true);

  const blockedPromotion = capability.blockPromotionOnUnavailability(readyStateInput, 0, "tenant-2");
  assert.strictEqual(blockedPromotion.blocked, false);
  assert.strictEqual(blockedPromotion.reason, null);

  const blockedByAudit = capability.blockPromotionOnUnavailability(
    { ...readyStateInput, auditLog: [] },
    0,
    "tenant-2",
  );
  assert.strictEqual(blockedByAudit.blocked, true);
  assert.strictEqual(blockedByAudit.reason, "Audit signal missing");

  const blockedByIsolation = capability.blockPromotionOnUnavailability(
    { ...readyStateInput, crossTenantIsolationProven: false },
    0,
    "tenant-2",
  );
  assert.strictEqual(blockedByIsolation.blocked, true);
  assert.strictEqual(blockedByIsolation.reason, "Cross-tenant isolation proof missing");

  const blockedLedger = capability.blockPromotionOnUnavailability(
    { ...readyStateInput, ledgerNonEmpty: false, appliedMigrations: [] },
    0,
    "tenant-2",
  );
  assert.strictEqual(blockedLedger.blocked, true);
  assert.strictEqual(blockedLedger.reason, "Migration ledger empty");

  const degradedMode = capability.determineDegradedMode(substrateOff);
  assert.strictEqual(degradedMode.isDegraded, true);
  assert.strictEqual(degradedMode.canMutate, false);
  assert.strictEqual(degradedMode.canRead, true);

  const healthyMode = capability.determineDegradedMode(readyStateInput);
  assert.strictEqual(healthyMode.isDegraded, false);
  assert.strictEqual(healthyMode.canMutate, true);
  assert.strictEqual(healthyMode.canRead, true);

  const disconnected: capability.RelationalStorageAndMigrationsAndRlsState = {
    ...readyStateInput,
    connected: false,
  };
  const disconnectedMode = capability.determineDegradedMode(disconnected);
  assert.strictEqual(disconnectedMode.isDegraded, true);
  assert.strictEqual(disconnectedMode.canMutate, false);
  assert.strictEqual(disconnectedMode.canRead, true);

  const migrateGateEmpty = capability.checkMigratedGate(noLedger);
  assert.strictEqual(migrateGateEmpty.passed, false);
  assert.ok(migrateGateEmpty.error !== null);
  if (migrateGateEmpty.error !== null) {
    assert.strictEqual(migrateGateEmpty.error.kind, "READINESS_UNAVAILABLE");
  }

  const migrateGatePass = capability.checkMigratedGate(readyStateInput);
  assert.strictEqual(migrateGatePass.passed, true);
  assert.strictEqual(migrateGatePass.error, null);

  const auditGateEmpty = capability.checkAuditSignalGate(noAudit);
  assert.strictEqual(auditGateEmpty.passed, false);
  assert.ok(auditGateEmpty.error !== null);
  if (auditGateEmpty.error !== null) {
    assert.strictEqual(auditGateEmpty.error.kind, "READINESS_UNAVAILABLE");
  }

  const auditGatePass = capability.checkAuditSignalGate(readyStateInput);
  assert.strictEqual(auditGatePass.passed, true);
  assert.strictEqual(auditGatePass.error, null);
});
</arg_value>