import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/dataplatform/backupandrestore.ts";

test("backupandrestoreauditmodel", () => {
  const config: capability.BackupAndRestoreConfig = {
    toolingAvailable: true,
    stageDestructiveAllowed: true,
    stageDataPreservation: true,
  };
  const auditFn = (artifact: capability.BackupArtifact): capability.BackupAndRestoreError | null => null;
  const result = capability.produceBackup("DEVELOPMENT", config, auditFn);
  assert.ok(!("kind" in result));
  assert.equal(result.result.compressed, true);
  assert.match(result.result.name, /^backup_\d+$/);
  assert.ok(result.result.timestamp);
});

test("backupandrestorecontracts", () => {
  const config: capability.BackupAndRestoreConfig = {
    toolingAvailable: true,
    stageDestructiveAllowed: true,
    stageDataPreservation: true,
  };
  const auditFn = (_: capability.BackupArtifact): capability.BackupAndRestoreError | null => null;
  const backupResult = capability.produceBackup("DEVELOPMENT", config, auditFn);
  assert.ok(!("kind" in backupResult));
  assert.ok(backupResult.result);

  const restoreResult = capability.restoreBackup(
    "DEVELOPMENT",
    "target_db",
    "backup_123",
    { ...config, confirmationToken: "DEVELOPMENT" },
    auditFn,
  );
  assert.ok(!("kind" in restoreResult));
  assert.equal(restoreResult.result.name, "backup_123");
});

test("backupandrestoreerrormodel", () => {
  const config: capability.BackupAndRestoreConfig = {
    toolingAvailable: false,
    stageDestructiveAllowed: true,
    stageDataPreservation: true,
  };
  const error = capability.validateToolingAvailable(config);
  assert.notEqual(error, null);
  assert.equal(error?.kind, "TOOLING_UNAVAILABLE");
  assert.match(error?.message, /unavailable/);
});

test("backupandrestorepermissions", () => {
  const config: capability.BackupAndRestoreConfig = {
    toolingAvailable: true,
    stageDestructiveAllowed: true,
    stageDataPreservation: true,
  };
  const envError = capability.validateEnvironmentGuard("PRODUCTION", config, "BACKUP");
  assert.notEqual(envError, null);
  assert.equal(envError?.kind, "ENVIRONMENT_GUARD_VIOLATION");

  const restoreError = capability.validateRestoreConfirmation("DEVELOPMENT", { ...config, confirmationToken: "TEST" });
  assert.notEqual(restoreError, null);
  assert.equal(restoreError?.kind, "CONFIRMATION_TOKEN_MISMATCH");
});

test("backupandrestoreproof", () => {
  const config: capability.BackupAndRestoreConfig = {
    toolingAvailable: true,
    stageDestructiveAllowed: true,
    stageDataPreservation: true,
  };
  const auditFn = (_: capability.BackupArtifact): capability.BackupAndRestoreError | null => null;
  const result = capability.produceBackup("DEVELOPMENT", config, auditFn);
  assert.ok(!("kind" in result));
  assert.ok(result.result);
  assert.equal(result.result.compressed, true);
  assert.match(result.result.name, /^backup_\d+$/);
  assert.ok(result.result.timestamp);
});

test("backupandrestorereadinessmodel", () => {
  const config: capability.BackupAndRestoreConfig = {
    toolingAvailable: false,
    stageDestructiveAllowed: true,
    stageDataPreservation: true,
  };
  const state: capability.BackupAndRestoreState = {
    readiness: "NOT_READY",
    lastBackupProof: null,
    lastError: null,
    lastOperation: null,
  };
  const readiness = capability.computeReadiness(state, config);
  assert.equal(readiness, "DEGRADED");

  const readyConfig: capability.BackupAndRestoreConfig = {
    toolingAvailable: true,
    stageDestructiveAllowed: true,
    stageDataPreservation: true,
  };
  const readyState: capability.BackupAndRestoreState = {
    readiness: "NOT_READY",
    lastBackupProof: {
      environment: "DEVELOPMENT",
      artifact: { name: "backup_123", timestamp: "2023-01-01T00:00:00.000Z", compressed: true },
      verdict: "SUCCESS",
    },
    lastError: null,
    lastOperation: null,
  };
  assert.equal(capability.computeReadiness(readyState, readyConfig), "READY");
});

test("backupandrestorevalidation", () => {
  const config: capability.BackupAndRestoreConfig = {
    toolingAvailable: true,
    stageDestructiveAllowed: false,
    stageDataPreservation: true,
  };
  const stageError = capability.validateStageSettings(config, "BACKUP");
  assert.notEqual(stageError, null);
  assert.equal(stageError?.kind, "OPERATION_ABORTED");

  const restoreConfig: capability.BackupAndRestoreConfig = {
    toolingAvailable: true,
    stageDestructiveAllowed: true,
    stageDataPreservation: false,
  };
  const restoreStageError = capability.validateStageSettings(restoreConfig, "RESTORE");
  assert.notEqual(restoreStageError, null);
  assert.equal(restoreStageError?.kind, "OPERATION_ABORTED");
});