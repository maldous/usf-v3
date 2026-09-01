import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/configuration/configurationregistryandhistory.ts";

const sampleDef: capability.ConfigurationDefinition = {
  key: "featureX",
  category: "features",
  valueType: "BOOLEAN",
  allowedValues: null,
  defaultValue: false,
  tenantOverridable: true,
  lifecycle: "ACTIVE",
  requiredReadPermission: "read-featureX",
  requiredWritePermission: "write-featureX",
  isFeatureFlag: true,
};

const enumDef: capability.ConfigurationDefinition = {
  key: "color",
  category: "ui",
  valueType: "ENUM",
  allowedValues: ["red", "green", "blue"],
  defaultValue: "red",
  tenantOverridable: true,
  lifecycle: "ACTIVE",
  requiredReadPermission: "read-color",
  requiredWritePermission: "write-color",
  isFeatureFlag: false,
};

const nonOverDef: capability.ConfigurationDefinition = {
  key: "systemMode",
  category: "system",
  valueType: "STRING",
  allowedValues: null,
  defaultValue: "auto",
  tenantOverridable: false,
  lifecycle: "ACTIVE",
  requiredReadPermission: "read-systemMode",
  requiredWritePermission: "write-systemMode",
  isFeatureFlag: false,
};

test("configurationregistryandhistoryauditmodel", () => {
  const baseState: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [sampleDef],
    storeReachable: true,
  };

  const auditCalls: capability.ConfigurationRegistryAndHistoryAuditEvent[] = [];
  const auditFn = (event: capability.ConfigurationRegistryAndHistoryAuditEvent) => {
    auditCalls.push(event);
    return null;
  };

  const patched = capability.patchConfiguration(
    baseState,
    "tenant1",
    "featureX",
    true,
    "write-featureX",
    auditFn,
  );
  assert.ok("tenantOverrides" in patched);
  assert.strictEqual(patched.tenantOverrides.length, 1);
  assert.strictEqual(patched.lastAuditEvent?.kind, "CONFIGURATION_CHANGE");
  assert.strictEqual(auditCalls.length, 1);
  assert.strictEqual(auditCalls[0].kind, "CONFIGURATION_CHANGE");
  assert.strictEqual(auditCalls[0].key, "featureX");
  assert.strictEqual(auditCalls[0].value, true);

  const failingAuditFn = () => ({
    kind: "AUDIT_FAILURE" as const,
    message: "audit failed",
  });
  const auditFailed = capability.patchConfiguration(
    baseState,
    "tenant1",
    "featureX",
    false,
    "write-featureX",
    failingAuditFn,
  );
  assert.ok("kind" in auditFailed && auditFailed.kind === "AUDIT_FAILURE");

  const deleteAuditCalls: capability.ConfigurationRegistryAndHistoryAuditEvent[] = [];
  const deleteAuditFn = (event: capability.ConfigurationRegistryAndHistoryAuditEvent) => {
    deleteAuditCalls.push(event);
    return null;
  };
  const stateWithOverride: capability.ConfigurationRegistryAndHistoryState = {
    ...patched,
  };
  const deleted = capability.deleteConfiguration(
    stateWithOverride,
    "tenant1",
    "featureX",
    "write-featureX",
    deleteAuditFn,
  );
  assert.ok("tenantOverrides" in deleted);
  assert.strictEqual(deleted.tenantOverrides.length, 0);
  assert.strictEqual(deleteAuditCalls.length, 1);
  assert.strictEqual(deleteAuditCalls[0].kind, "CONFIGURATION_CLEARED");
});

test("configurationregistryandhistorycontracts", () => {
  const state: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [enumDef],
    storeReachable: true,
  };
  const list1 = capability.listConfigurations(state, "tenant1", "ui", "read-color");
  assert.strictEqual(list1.result.length, 1);
  assert.strictEqual(list1.result[0].definition.key, "color");
  assert.strictEqual(list1.result[0].source, "PLATFORM_DEFAULT");
  assert.strictEqual(list1.result[0].effectiveValue, "red");

  const auditFn = () => null;
  const patched = capability.patchConfiguration(
    state,
    "tenant1",
    "color",
    "green",
    "write-color",
    auditFn,
  );
  assert.ok("tenantOverrides" in patched);
  const list2 = capability.listConfigurations(patched, "tenant1", null, "read-color");
  const entry = list2.result.find((e) => e.definition.key === "color");
  assert.ok(entry);
  assert.strictEqual(entry.source, "TENANT_OVERRIDE");
  assert.strictEqual(entry.effectiveValue, "green");

  const deleted = capability.deleteConfiguration(
    patched,
    "tenant1",
    "color",
    "write-color",
    auditFn,
  );
  assert.ok("tenantOverrides" in deleted);
  const list3 = capability.listConfigurations(deleted, "tenant1", null, "read-color");
  const entryAfterDelete = list3.result.find((e) => e.definition.key === "color");
  assert.ok(entryAfterDelete);
  assert.strictEqual(entryAfterDelete.source, "PLATFORM_DEFAULT");
  assert.strictEqual(entryAfterDelete.effectiveValue, "red");
});

test("configurationregistryandhistoryerrormodel", () => {
  const state: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [sampleDef, nonOverDef],
    storeReachable: true,
  };
  const auditFn = () => null;

  // missing value
  const missing = capability.patchConfiguration(
    state,
    "tenant1",
    "featureX",
    undefined as unknown,
    "write-featureX",
    auditFn,
  );
  assert.ok("kind" in missing && missing.kind === "VALIDATION_ERROR");

  // unknown key
  const unknown = capability.patchConfiguration(
    state,
    "tenant1",
    "unknownKey",
    true,
    "write-featureX",
    auditFn,
  );
  assert.ok("kind" in unknown && unknown.kind === "NOT_FOUND");

  // non-overridable definition
  const nonOver = capability.patchConfiguration(
    state,
    "tenant1",
    "systemMode