import { assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/tenantdataimportexport.ts";

test("tenantdataimportexportauditmodel", () => {
  const tenantId = "tenant-123";
  const archiveDigest = "abc123";
  const unitCount = 5;
  const span = { route: "export", useCase: "backup", provider: "aws" } as const;
  let auditEvent: capability.TenantDataImportExportAuditEvent | null = null;

  const auditFn: (event: capability.TenantDataImportExportAuditEvent) => capability.TenantDataImportExportError | null = (event) => {
    auditEvent = event;
    return null;
  };

  const state: capability.TenantDataImportExportState = {
    ...capability.initialState,
    readiness: "READY",
    archiveBuilderAvailable: true,
    postgresApplierAvailable: true,
  };

  const result = capability.startExport(state, tenantId, archiveDigest, unitCount, span, auditFn);
  assert(!(result instanceof Error));
  assert(auditEvent !== null);
  assert.strictEqual(auditEvent.tenantId, tenantId);
  assert.strictEqual(auditEvent.kind, "EXPORT_STARTED");
  assert.strictEqual(auditEvent.archiveDigest, archiveDigest);
  assert.strictEqual(auditEvent.unitCount, unitCount);
  assert.deepStrictEqual(auditEvent.span, span);
  assert(auditEvent.timestamp !== undefined);
});

test("tenantdataimportexportcontracts", () => {
  const tenantId = "tenant-456";
  const archiveDigest = "def456";
  const unitCount = 3;
  const span = { route: "import", useCase: "restore", provider: "gcp" } as const;
  const auditFn = () => null;

  const state: capability.TenantDataImportExportState = {
    ...capability.initialState,
    readiness: "READY",
    archiveBuilderAvailable: true,
    postgresApplierAvailable: true,
  };

  const startResult = capability.startImport(state, tenantId, archiveDigest, unitCount, span, auditFn);
  assert(!(startResult instanceof Error));
  assert(startResult.progressRecords.length === 1);
  assert.strictEqual(startResult.progressRecords[0].tenantId, tenantId);
  assert.strictEqual(startResult.progressRecords[0].archiveDigest, archiveDigest);
  assert.deepStrictEqual(startResult.progressRecords[0].completedUnits, []);

  const progressResult = capability.recordImportProgress(
    startResult,
    tenantId,
    archiveDigest,
    "unit-1",
    span,
    auditFn,
  );
  assert(!(progressResult instanceof Error));
  assert(progressResult.progressRecords[0].completedUnits.includes("unit-1"));
  assert.strictEqual(progressResult.progressRecords[0].failedUnit, null);

  const reRunResult = capability.recordImportProgress(
    progressResult,
    tenantId,
    archiveDigest,
    "unit-1",
    span,
    auditFn,
  );
  assert(!(reRunResult instanceof Error));
  assert.strictEqual(reRunResult.progressRecords[0].completedUnits.length, 1);
});

test("tenantdataimportexporterrormodel", () => {
  const tenantId = "tenant-789";
  const archiveDigest = "ghi789";
  const unitCount = 2;
  const failedUnit = "unit-2";
  const span = { route: "export", useCase: "backup", provider: "azure" } as const;
  const auditFn = () => null;

  const state: capability.TenantDataImportExportState = {
    ...capability.initialState,
    readiness: "READY",
    archiveBuilderAvailable: true,
    postgresApplierAvailable: true,
  };

  const result = capability.failExport(state, tenantId, archiveDigest, unitCount, failedUnit, span, auditFn);
  assert(!(result instanceof Error));
  assert.strictEqual(result.lastDecision, "ARCHIVE_INTEGRITY_FAILURE");
  assert(result.lastError !== null);
  assert.strictEqual(result.lastError.kind, "ARCHIVE_CORRUPT");
  assert.strictEqual(result.lastError.message, `Export failed at unit ${failedUnit}`);
  assert.strictEqual(result.lastError.tenantId, tenantId);
  assert.strictEqual(result.lastError.isDataLossRisk, true);
});

test("tenantdataimportexportlifecycle", () => {
  const tenantId = "tenant-101";
  const archiveDigest = "jkl101";
  const unitCount = 4;
  const span = { route: "import", useCase: "migration", provider: "aws" } as const;
  const auditFn = () => null;

  const state: capability.TenantDataImportExportState = {
    ...capability.initialState,
    readiness: "READY",
    archiveBuilderAvailable: true,
    postgresApplierAvailable: true,
  };

  const startResult = capability.startImport(state, tenantId, archiveDigest, unitCount, span, auditFn);
  assert(!(startResult instanceof Error));
  assert(startResult.progressRecords.length === 1);

  const progressResult = capability.recordImportProgress(
    startResult,
    tenantId,
    archiveDigest,
    "unit-1",
    span,
    auditFn,
  );
  assert(!(progressResult instanceof Error));
  assert(progressResult.progressRecords[0].completedUnits.includes("unit-1"));

  const failureResult = capability.recordImportFailure(
    progressResult,
    tenantId,
    archiveDigest,
    "unit-2",
    span,
    auditFn,
  );
  assert(!(failureResult instanceof Error));
  assert.strictEqual(failureResult.progressRecords[0].failedUnit, "unit-2");
  assert(failureResult.progressRecords[0].completedUnits.includes("unit-1"));
  assert.strictEqual(failureResult.lastDecision, "ARCHIVE_INTEGRITY_FAILURE");
  assert(failureResult.lastError !== null);
  assert.strictEqual(failureResult.lastError.isDataLossRisk, true);
});

test("tenantdataimportexportpermissions", () => {
  const tenantId = "tenant-202";
  const targetTenantId = "tenant-303";
  const result = capability.checkTenantIsolation(
    capability.initialState,
    tenantId,
    targetTenantId,
  );
  assert(result instanceof Object);
  assert.strictEqual((result as capability.TenantDataImportExportError).kind, "TENANT_ISOLATION_VIOLATION");
  assert.strictEqual((result as capability.TenantDataImportExportError).tenantId, tenantId);
  assert.strictEqual((result as capability.TenantDataImportExportError).isDataLossRisk, true);

  const sameTenantResult = capability.checkTenantIsolation(
    capability.initialState,
    tenantId,
    tenantId,
  );
  assert.strictEqual(sameTenantResult, "IMPORT_EXPORT_GRANTED");
});

test("tenantdataimportexportproof", () => {
  const tenantId = "tenant-404";
  const archiveDigest = "mno404";
  const unitCount = 1;
  const span = { route: "import", useCase: "test", provider: "local" } as const;
  const auditFn = () => null;

  const state: capability.TenantDataImportExportState = {
    ...capability.initialState,
    readiness: "READY",
    archiveBuilderAvailable: true,
    postgresApplierAvailable: true,
  };

  const startResult = capability.startImport(state, tenantId, archiveDigest, unitCount, span, auditFn);
  assert(!(startResult instanceof Error));
  const progressResult = capability.recordImportProgress(
    startResult,
    tenantId,
    archiveDigest,
    "unit-0",
    span,
    auditFn,
  );
  assert(!(progressResult instanceof Error));
  assert(progressResult.progressRecords[0].completedUnits.includes("unit-0"));

  const reRunResult = capability.recordImportProgress(
    progressResult,
    tenantId,
    archiveDigest,
    "unit-0",
    span,
    auditFn,
  );
  assert(!(reRunResult instanceof Error));
  assert.strictEqual(reRunResult.progressRecords[0].completedUnits.length, 1);
});

test("tenantdataimportexportreadinessmodel", () => {
  const state1 = capability.setProviderAvailability(
    capability.initialState,
    true,
    true,
  );
  assert.strictEqual(state1.readiness, "READY");
  assert.strictEqual(state1.archiveBuilderAvailable, true);
  assert.strictEqual(state1.postgresApplierAvailable, true);

  const state2 = capability.setProviderAvailability(
    capability.initialState,
    true,
    false,
  );
  assert.strictEqual(state2.readiness, "DEGRADED");

  const state3 = capability.setProviderAvailability(
    capability.initialState,
    false,
    true,
  );
  assert.strictEqual(state3.readiness, "DEGRADED");

  const state4 = capability.setProviderAvailability(
    capability.initialState,
    false,
    false,
  );
  assert.strictEqual(state4.readiness, "DEGRADED");
});

test("tenantdataimportexportstatemodel", () => {
  const tenantId = "tenant-505";
  const archiveDigest = "pqr505";
  const unitCount = 2;
  const span = { route: "import", useCase: "sync", provider: "aws" } as const;
  const auditFn = () => null;

  const state: capability.TenantDataImportExportState = {
    ...capability.initialState,
    readiness: "READY",
    archiveBuilderAvailable: true,
    postgresApplierAvailable: true,
  };

  const startResult = capability.startImport(state, tenantId, archiveDigest, unitCount, span, auditFn);
  assert(!(startResult instanceof Error));
  const progressRecord = startResult.progressRecords[0];
  assert.strictEqual(progressRecord.tenantId, tenantId);
  assert.strictEqual(progressRecord.archiveDigest, archiveDigest);
  assert.deepStrictEqual(progressRecord.completedUnits, []);
  assert.strictEqual(progressRecord.failedUnit, null);

  const progressResult = capability.recordImportProgress(
    startResult,
    tenantId,
    archiveDigest,
    "unit-1",
    span,
    auditFn,
  );
  assert(!(progressResult instanceof Error));
  assert(progressResult.progressRecords[0].completedUnits.includes("unit-1"));
  assert.strictEqual(progressResult.progressRecords[0].failedUnit, null);
});

test("tenantdataimportexportvalidation", () => {
  const archiveDigest = "valid-digest";
  const expectedDigest = "valid-digest";
  const validResult = capability.validateArchiveIntegrity(archiveDigest, expectedDigest);
  assert(!(validResult instanceof Error));
  assert.strictEqual((validResult as { valid: boolean }).valid, true);

  const invalidResult = capability.validateArchiveIntegrity("invalid-digest", expectedDigest);
  assert(invalidResult instanceof Object);
  assert.strictEqual((invalidResult as capability.TenantDataImportExportError).kind, "DIGEST_MISMATCH");
  assert.strictEqual((invalidResult as capability.TenantDataImportExportError).isDataLossRisk, true);
});