import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/tenantdataimportexport.ts";

const defaultConfig: capability.TenantDataImportExportConfig = {
  enableExport: true,
  enableImport: true,
  enforceTenantIsolation: true,
  requireStrictAudit: true,
};

function makeArchive(
  tenantId: string,
  contentDigest: string,
  unitCount: number,
): capability.EncryptedArchive {
  return {
    tenantId,
    contentDigest,
    encryptedData: `cipher:${contentDigest}`,
    isEncrypted: true,
    isCompressed: true,
    unitCount,
  };
}

function makeBuilder(
  archive: capability.EncryptedArchive,
  options: {
    available?: boolean;
    error?: capability.TenantDataImportExportError;
  } = {},
): capability.ArchiveBuilderPort {
  const available = options.available ?? true;
  const error = options.error;
  return {
    isAvailable: () => available,
    buildEncryptedArchive: () => {
      if (error) {
        return { ok: false, error };
      }
      return { ok: true, archive };
    },
  };
}

function makeApplier(
  units: readonly capability.DataUnit[],
  options: {
    available?: boolean;
    unpackError?: string;
    applyErrors?: Readonly<Record<string, string>>;
    onApply?: (unit: capability.DataUnit) => void;
  } = {},
): capability.PostgresApplierPort {
  const available = options.available ?? true;
  const applyErrors = options.applyErrors ?? {};
  return {
    isAvailable: () => available,
    applyUnit: (_tenantId, unit) => {
      options.onApply?.(unit);
      const message = applyErrors[unit.id];
      if (message !== undefined) {
        return { ok: false, error: message };
      }
      return { ok: true };
    },
    decryptAndDecompressUnits: () => {
      if (options.unpackError !== undefined) {
        return { ok: false, error: options.unpackError };
      }
      return { ok: true, units };
    },
  };
}

function makeAuditCapture() {
  const events: capability.TenantDataImportExportAuditEvent[] = [];
  return {
    events,
    auditFn: (event: capability.TenantDataImportExportAuditEvent) => {
      events.push(event);
      return null;
    },
  };
}

test("tenantdataimportexportauditmodel", () => {
  const tenantId = "tenant-audit";
  const actor = "audit-operator";
  const units: readonly capability.DataUnit[] = [
    { id: "unit-audit-1", tenantId, payload: { secret: "redacted" } },
  ];
  const archive = makeArchive(tenantId, "audit-digest", units.length);
  const audit = makeAuditCapture();

  const exportResult = capability.exportTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    units,
    makeBuilder(archive),
    audit.auditFn,
  );

  assert.strictEqual(exportResult.ok, true);
  if (!exportResult.ok) return;

  const exportEvent = audit.events[0];
  assert.strictEqual(exportEvent.kind, "IMPORT_EXPORT_AUDIT");
  assert.strictEqual(exportEvent.tenantId, tenantId);
  assert.strictEqual(exportEvent.operation, "EXPORT");
  assert.strictEqual(exportEvent.archiveDigest, null);
  assert.strictEqual(exportEvent.span.route, "/api/v1/tenant/export");
  assert.strictEqual(exportEvent.span.useCase, "TenantDataExport");
  assert.strictEqual(exportEvent.span.provider, "PostgresToArchiveBuilder");
  assert.strictEqual(exportEvent.span.tenantId, tenantId);

  const importResult = capability.importTenantData(
    exportResult.state,
    defaultConfig,
    tenantId,
    actor,
    exportResult.archive,
    makeApplier(
      [{ id: "unit-foreign", tenantId: "tenant-other", payload: { secret: "forbidden" } }],
    ),
    audit.auditFn,
  );

  assert.strictEqual(importResult.ok, false);
  if (importResult.ok) return;

  const importEvent = audit.events[1];
  assert.strictEqual(importEvent.kind, "IMPORT_EXPORT_AUDIT");
  assert.strictEqual(importEvent.tenantId, tenantId);
  assert.strictEqual(importEvent.operation, "IMPORT");
  assert.strictEqual(importEvent.span.route, "/api/v1/tenant/import");
  assert.strictEqual(importEvent.span.provider, "PostgresApplier");
  assert.strictEqual(importEvent.archiveDigest, archive.contentDigest);

  const failedProgress = importResult.progress;
  assert.ok(failedProgress !== undefined);
  assert.strictEqual(failedProgress.status, "FAILED");
  assert.strictEqual(failedProgress.failedUnit, "unit-foreign");
  assert.deepStrictEqual(failedProgress.completedUnits, []);
  assert.strictEqual(("payload" in failedProgress), false);
  assert.strictEqual(importResult.error.kind, "TENANT_ISOLATION_VIOLATION");
  assert.strictEqual(importResult.error.tenantId, tenantId);
  assert.strictEqual(exportResult.archive.isEncrypted, true);
  assert.strictEqual(exportResult.archive.isCompressed, true);
});

test("tenantdataimportexportcontracts", () => {
  const tenantId = "tenant-contracts";
  const actor = "contract-operator";
  const units: readonly capability.DataUnit[] = [
    { id: "contract-unit-1", tenantId, payload: { value: 1 } },
    { id: "contract-unit-2", tenantId, payload: { value: 2 } },
  ];
  const archive = makeArchive(tenantId, "contracts-digest", units.length);

  const exportResult = capability.exportTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    units,
    makeBuilder(archive),
    () => null,
  );

  assert.strictEqual(exportResult.ok, true);
  if (!exportResult.ok) return;

  const firstCalls: string[] = [];
  const firstImport = capability.importTenantData(
    exportResult.state,
    defaultConfig,
    tenantId,
    actor,
    exportResult.archive,
    makeApplier(units, {
      applyErrors: { "contract-unit-2": "temporary conflict" },
      onApply: (unit) => {
        firstCalls.push(unit.id);
      },
    }),
    () => null,
  );

  assert.strictEqual(firstImport.ok, false);
  if (firstImport.ok) return;
  assert.ok(firstImport.progress !== undefined);
  assert.deepStrictEqual(firstImport.progress.completedUnits, ["contract-unit-1"]);
  assert.strictEqual(firstImport.progress.failedUnit, "contract-unit-2");

  const resumeCalls: string[] = [];
  const resumedImport = capability.importTenantData(
    firstImport.state,
    defaultConfig,
    tenantId,
    actor,
    exportResult.archive,
    makeApplier(units, {
      onApply: (unit) => {
        resumeCalls.push(unit.id);
      },
    }),
    () => null,
  );

  assert.strictEqual(resumedImport.ok, true);
  if (!resumedImport.ok) return;
  assert.deepStrictEqual(resumedImport.progress.completedUnits, ["contract-unit-1", "contract-unit-2"]);
  assert.deepStrictEqual(resumeCalls, ["contract-unit-2"]);
  assert.strictEqual(resumedImport.progress.failedUnit, null);

  let replayCalled = false;
  const replayImport = capability.importTenantData(
    resumedImport.state,
    defaultConfig,
    tenantId,
    actor,
    exportResult.archive,
    makeApplier(units, {
      onApply: () => {
        replayCalled = true;
      },
    }),
    () => null,
  );

  assert.strictEqual(replayImport.ok, true);
  if (!replayImport.ok) return;
  assert.strictEqual(replayCalled, false);
  assert.deepStrictEqual(replayImport.progress.completedUnits, ["contract-unit-1", "contract-unit-2"]);
  assert.strictEqual(replayImport.progress.failedUnit, null);
  assert.strictEqual(firstCalls.length, 2);
});

test("tenantdataimportexporterrormodel", () => {
  const tenantId = "tenant-error";
  const actor = "error-operator";
  const units: readonly capability.DataUnit[] = [{ id: "error-unit-1", tenantId, payload: {} }];
  const archive = makeArchive(tenantId, "error-digest", 2);

  const disabledExport = capability.exportTenantData(
    capability.initialTenantDataImportExportState,
    { ...defaultConfig, enableExport: false },
    tenantId,
    actor,
    units,
    makeBuilder(archive),
    () => null,
  );
  assert.strictEqual(disabledExport.ok, false);
  if (disabledExport.ok) return;
  assert.strictEqual(disabledExport.error.kind, "FAIL_CLOSED_CONFIGURATION_ERROR");

  const disabledImport = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    { ...defaultConfig, enableImport: false },
    tenantId,
    actor,
    archive,
    makeApplier(units),
    () => null,
  );
  assert.strictEqual(disabledImport.ok, false);
  if (disabledImport.ok) return;
  assert.strictEqual(disabledImport.error.kind, "FAIL_CLOSED_CONFIGURATION_ERROR");

  const builderUnavailable = capability.exportTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    units,
    makeBuilder(archive, { available: false }),
    () => null,
  );
  assert.strictEqual(builderUnavailable.ok, false);
  if (builderUnavailable.ok) return;
  assert.strictEqual(builderUnavailable.error.kind, "ARCHIVE_BUILDER_UNAVAILABLE");
  assert.strictEqual(builderUnavailable.state.readiness, "DEGRADED");

  const applierUnavailable = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    archive,
    makeApplier(units, { available: false }),
    () => null,
  );
  assert.strictEqual(applierUnavailable.ok, false);
  if (applierUnavailable.ok) return;
  assert.strictEqual(applierUnavailable.error.kind, "IMPORT_APPLIER_UNAVAILABLE");
  assert.strictEqual(applierUnavailable.state.readiness, "DEGRADED");

  const partialUnits: readonly capability.DataUnit[] = [
    { id: "error-unit-a", tenantId, payload: {} },
    { id: "error-unit-b", tenantId, payload: {} },
  ];
  const partialFail = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    archive,
    makeApplier(partialUnits, {
      applyErrors: { "error-unit-b": "unit apply failed" },
    }),
    () => null,
  );
  assert.strictEqual(partialFail.ok, false);
  if (partialFail.ok) return;
  assert.strictEqual(partialFail.error.kind, "UNIT_PROCESSING_FAILED");
  assert.strictEqual(partialFail.error.risk, "TENANT_DATA_LOSS");
  assert.ok(partialFail.progress !== undefined);
  assert.deepStrictEqual(partialFail.progress.completedUnits, ["error-unit-a"]);
  assert.strictEqual(partialFail.progress.failedUnit, "error-unit-b");
});

test("tenantdataimportexportlifecycle", () => {
  const tenantId = "tenant-lifecycle";
  const actor = "lifecycle-operator";
  const units: readonly capability.DataUnit[] = [
    { id: "life-unit-1", tenantId, payload: { idx: 1 } },
    { id: "life-unit-2", tenantId, payload: { idx: 2 } },
    { id: "life-unit-3", tenantId, payload: { idx: 3 } },
  ];
  const archive = makeArchive(tenantId, "lifecycle-digest", units.length);

  const exportResult = capability.exportTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    units,
    makeBuilder(archive),
    () => null,
  );

  assert.strictEqual(exportResult.ok, true);
  if (!exportResult.ok) return;
  assert.strictEqual(exportResult.archive.isEncrypted, true);
  assert.strictEqual(exportResult.archive.isCompressed, true);

  const interruptedCalls: string[] = [];
  const interrupted = capability.importTenantData(
    exportResult.state,
    defaultConfig,
    tenantId,
    actor,
    exportResult.archive,
    makeApplier(units, {
      applyErrors: { "life-unit-3": "interruption" },
      onApply: (unit) => {
        interruptedCalls.push(unit.id);
      },
    }),
    () => null,
  );

  assert.strictEqual(interrupted.ok, false);
  if (interrupted.ok) return;
  assert.ok(interrupted.progress !== undefined);
  assert.deepStrictEqual(interrupted.progress.completedUnits, ["life-unit-1", "life-unit-2"]);
  assert.strictEqual(interrupted.progress.failedUnit, "life-unit-3");
  assert.deepStrictEqual(interruptedCalls, ["life-unit-1", "life-unit-2", "life-unit-3"]);

  const resumedCalls: string[] = [];
  const resumed = capability.importTenantData(
    interrupted.state,
    defaultConfig,
    tenantId,
    actor,
    exportResult.archive,
    makeApplier(units, {
      onApply: (unit) => {
        resumedCalls.push(unit.id);
      },
    }),
    () => null,
  );

  assert.strictEqual(resumed.ok, true);
  if (!resumed.ok) return;
  assert.strictEqual(resumed.state.readiness, "READY");
  assert.deepStrictEqual(resumed.progress.completedUnits, ["life-unit-1", "life-unit-2", "life-unit-3"]);
  assert.deepStrictEqual(resumedCalls, ["life-unit-3"]);
});

test("tenantdataimportexportpermissions", () => {
  const tenantId = "tenant-permissions";
  const actor = "permission-operator";

  const crossTenantExport = capability.exportTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    [{ id: "cross-unit", tenantId: "tenant-other", payload: {} }],
    makeBuilder(makeArchive(tenantId, "permission-export-digest", 1)),
    () => null,
  );
  assert.strictEqual(crossTenantExport.ok, false);
  if (crossTenantExport.ok) return;
  assert.strictEqual(crossTenantExport.error.kind, "TENANT_ISOLATION_VIOLATION");

  const archiveByOtherTenant = makeArchive("tenant-other", "permission-digest", 1);
  const archiveTenantMismatch = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    archiveByOtherTenant,
    makeApplier([{ id: "tenant-unit-1", tenantId: "tenant-other", payload: {} }]),
    () => null,
  );
  assert.strictEqual(archiveTenantMismatch.ok, false);
  if (archiveTenantMismatch.ok) return;
  assert.strictEqual(archiveTenantMismatch.error.kind, "TENANT_ISOLATION_VIOLATION");

  const expectedTenantArchive = makeArchive(tenantId, "permission-digest", 1);
  const crossTenantUnit = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    expectedTenantArchive,
    makeApplier([{ id: "cross-unit", tenantId: "tenant-other", payload: {} }]),
    () => null,
  );
  assert.strictEqual(crossTenantUnit.ok, false);
  if (crossTenantUnit.ok) return;
  assert.strictEqual(crossTenantUnit.error.kind, "TENANT_ISOLATION_VIOLATION");
  assert.ok(crossTenantUnit.progress !== undefined);
  assert.strictEqual(crossTenantUnit.progress.tenantId, tenantId);
  assert.strictEqual(crossTenantUnit.progress.archiveDigest, expectedTenantArchive.contentDigest);
});

test("tenantdataimportexportproof", () => {
  const readyState: capability.TenantDataImportExportState = {
    ...capability.initialTenantDataImportExportState,
    readiness: "READY",
  };

  const pending = capability.evaluatePromotionBlockers(readyState, "PENDING", true, true);
  assert.strictEqual(pending.canPromote, false);
  if (!pending.canPromote) {
    assert.strictEqual(pending.error.kind, "PROMOTION_BLOCKED");
  }

  const missingSignals = capability.evaluatePromotionBlockers(readyState, "VERIFIED", false, false);
  assert.strictEqual(missingSignals.canPromote, false);
  if (!missingSignals.canPromote) {
    assert.strictEqual(missingSignals.error.kind, "PROMOTION_BLOCKED");
  }

  const failedProof = capability.evaluatePromotionBlockers(readyState, "FAILED", true, true);
  assert.strictEqual(failedProof.canPromote, false);
  if (!failedProof.canPromote) {
    assert.strictEqual(failedProof.error.kind, "PROMOTION_BLOCKED");
  }

  const promoted = capability.evaluatePromotionBlockers(readyState, "VERIFIED", true, true);
  assert.strictEqual(promoted.canPromote, true);

  const blockedByReadiness = capability.evaluatePromotionBlockers(
    { ...readyState, readiness: "NOT_READY" },
    "VERIFIED",
    true,
    true,
  );
  assert.strictEqual(blockedByReadiness.canPromote, false);
  if (!blockedByReadiness.canPromote) {
    assert.strictEqual(blockedByReadiness.error.kind, "PROMOTION_BLOCKED");
  }
});

test("tenantdataimportexportreadinessmodel", () => {
  const archive = makeArchive("tenant-readiness", "readiness-digest", 1);
  const alwaysReady = capability.checkReadiness(makeBuilder(archive, { available: true }), makeApplier([], { available: true }));
  assert.strictEqual(alwaysReady, "READY");

  const degradedByApplier = capability.checkReadiness(
    makeBuilder(archive, { available: true }),
    makeApplier([], { available: false }),
  );
  assert.strictEqual(degradedByApplier, "DEGRADED");

  const degradedByBuilder = capability.checkReadiness(
    makeBuilder(archive, { available: false }),
    makeApplier([], { available: true }),
  );
  assert.strictEqual(degradedByBuilder, "DEGRADED");

  const notReady = capability.checkReadiness(
    makeBuilder(archive, { available: false }),
    makeApplier([], { available: false }),
  );
  assert.strictEqual(notReady, "NOT_READY");

  const disabledExport = capability.exportTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    "tenant-readiness",
    "readiness-operator",
    [],
    makeBuilder(makeArchive("tenant-readiness", "readiness-disabled", 0), { available: false }),
    () => null,
  );
  assert.strictEqual(disabledExport.ok, false);
  if (!disabledExport.ok) return;
  assert.strictEqual(disabledExport.error.kind, "ARCHIVE_BUILDER_UNAVAILABLE");
  assert.strictEqual(disabledExport.state.readiness, "DEGRADED");

  const blockedPromotion = capability.evaluatePromotionBlockers(
    { ...capability.initialTenantDataImportExportState, readiness: notReady },
    "PENDING",
    false,
    false,
  );
  assert.strictEqual(blockedPromotion.canPromote, false);
  if (!blockedPromotion.canPromote) {
    assert.strictEqual(blockedPromotion.error.kind, "PROMOTION_BLOCKED");
  }
});

test("tenantdataimportexportstatemodel", () => {
  const tenantId = "tenant-state";
  const actor = "state-operator";
  const unitA: capability.DataUnit = { id: "state-a", tenantId, payload: { part: "a" } };
  const unitB: capability.DataUnit = { id: "state-b", tenantId, payload: { part: "b" } };
  const unitC: capability.DataUnit = { id: "state-c", tenantId, payload: { part: "c" } };

  const archiveA = makeArchive(tenantId, "state-digest-a", 1);
  const archiveB = makeArchive(tenantId, "state-digest-b", 1);
  const archiveC = makeArchive(tenantId, "state-digest-c", 1);

  const first = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    archiveA,
    makeApplier([unitA]),
    () => null,
  );
  assert.strictEqual(first.ok, true);
  if (!first.ok) return;

  const second = capability.importTenantData(
    first.state,
    defaultConfig,
    tenantId,
    actor,
    archiveB,
    makeApplier([unitB]),
    () => null,
  );
  assert.strictEqual(second.ok, true);
  if (!second.ok) return;
  assert.strictEqual(second.state.progressRecords.length, 2);

  const recordA = second.state.progressRecords.find((record) => record.archiveDigest === archiveA.contentDigest);
  const recordB = second.state.progressRecords.find((record) => record.archiveDigest === archiveB.contentDigest);
  assert.ok(recordA !== undefined);
  assert.ok(recordB !== undefined);
  assert.strictEqual(recordA.tenantId, tenantId);
  assert.strictEqual(recordB.tenantId, tenantId);
  assert.deepStrictEqual(recordA.completedUnits, ["state-a"]);
  assert.deepStrictEqual(recordB.completedUnits, ["state-b"]);
  assert.strictEqual(recordA.failedUnit, null);
  assert.strictEqual(recordB.failedUnit, null);
  assert.strictEqual(("payload" in recordA), false);
  assert.strictEqual(("encryptedData" in recordA), false);

  const failed = capability.importTenantData(
    second.state,
    defaultConfig,
    tenantId,
    actor,
    archiveC,
    makeApplier([unitC], { applyErrors: { "state-c": "temporary failure" } }),
    () => null,
  );
  assert.strictEqual(failed.ok, false);
  if (failed.ok) return;
  assert.ok(failed.progress !== undefined);
  assert.strictEqual(failed.progress.failedUnit, "state-c");

  let replayCalled = false;
  const replay = capability.importTenantData(
    failed.state,
    defaultConfig,
    tenantId,
    actor,
    archiveA,
    makeApplier([unitA], {
      onApply: () => {
        replayCalled = true;
      },
    }),
    () => null,
  );
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replayCalled, false);
  assert.strictEqual(replay.state.progressRecords.length, 3);
});

test("tenantdataimportexportvalidation", () => {
  const tenantId = "tenant-validation";
  const actor = "validation-operator";
  const validArchive = makeArchive(tenantId, "validation-digest", 2);
  const invalidArchive: unknown = 123;

  const validCheck = capability.validateArchiveIntegrity(validArchive, tenantId);
  assert.strictEqual(validCheck.ok, true);
  if (validCheck.ok) {
    assert.strictEqual(validCheck.validatedArchive.contentDigest, validArchive.contentDigest);
  }

  const invalidCheck = capability.validateArchiveIntegrity(invalidArchive, tenantId);
  assert.strictEqual(invalidCheck.ok, false);
  if (!invalidCheck.ok) {
    assert.strictEqual(invalidCheck.error.kind, "INVALID_ARCHIVE");
  }

  const malformedDigestArchive = {
    tenantId,
    contentDigest: "   ",
    encryptedData: "ciphertext",
    isEncrypted: true,
    isCompressed: true,
    unitCount: 1,
  };
  const digestMismatch = capability.validateArchiveIntegrity(malformedDigestArchive, tenantId);
  assert.strictEqual(digestMismatch.ok, false);
  if (!digestMismatch.ok) {
    assert.strictEqual(digestMismatch.error.kind, "DIGEST_MISMATCH");
  }

  const closedImport = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    { ...defaultConfig, enableImport: false },
    tenantId,
    actor,
    validArchive,
    makeApplier([{ id: "x", tenantId, payload: {} }]),
    () => null,
  );
  assert.strictEqual(closedImport.ok, false);
  if (!closedImport.ok) return;
  assert.strictEqual(closedImport.error.kind, "FAIL_CLOSED_CONFIGURATION_ERROR");

  const units: readonly capability.DataUnit[] = [
    { id: "validation-unit-1", tenantId, payload: { idx: 1 } },
    { id: "validation-unit-2", tenantId, payload: { idx: 2 } },
  ];

  const firstPass = capability.importTenantData(
    capability.initialTenantDataImportExportState,
    defaultConfig,
    tenantId,
    actor,
    validArchive,
    makeApplier(units, { applyErrors: { "validation-unit-2": "transient" } }),
    () => null,
  );
  assert.strictEqual(firstPass.ok, false);
  if (firstPass.ok) return;
  assert.ok(firstPass.progress !== undefined);
  assert.deepStrictEqual(firstPass.progress.completedUnits, ["validation-unit-1"]);
  assert.strictEqual(firstPass.progress.failedUnit, "validation-unit-2");
  assert.strictEqual(firstPass.error.kind, "UNIT_PROCESSING_FAILED");

  const secondCalls: string[] = [];
  const secondPass = capability.importTenantData(
    firstPass.state,
    defaultConfig,
    tenantId,
    actor,
    validArchive,
    makeApplier(units, {
      onApply: (unit) => {
        secondCalls.push(unit.id);
      },
    }),
    () => null,
  );
  assert.strictEqual(secondPass.ok, true);
  if (!secondPass.ok) return;
  assert.deepStrictEqual(secondCalls, ["validation-unit-2"]);
  assert.deepStrictEqual(secondPass.progress.completedUnits, ["validation-unit-1", "validation-unit-2"]);

  let thirdCalled = false;
  const thirdPass = capability.importTenantData(
    secondPass.state,
    defaultConfig,
    tenantId,
    actor,
    validArchive,
    makeApplier(units, {
      onApply: () => {
        thirdCalled = true;
      },
    }),
    () => null,
  );
  assert.strictEqual(thirdPass.ok, true);
  assert.strictEqual(thirdCalled, false);
});