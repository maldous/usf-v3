import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/configuration/configurationregistryandhistory.ts";

const sampleDef: capability.ConfigurationDefinition = {
  key: "featureX",
  category: "features",
  valueType: "BOOLEAN" as const,
  allowedValues: null,
  defaultValue: false,
  tenantOverridable: true,
  lifecycle: "ACTIVE" as const,
  requiredReadPermission: "read-featureX",
  requiredWritePermission: "write-featureX",
  isFeatureFlag: true,
};

const enumDef: capability.ConfigurationDefinition = {
  key: "color",
  category: "ui",
  valueType: "ENUM" as const,
  allowedValues: ["red", "green", "blue"] as const,
  defaultValue: "red",
  tenantOverridable: true,
  lifecycle: "ACTIVE" as const,
  requiredReadPermission: "read-color",
  requiredWritePermission: "write-color",
  isFeatureFlag: false,
};

const nonOverDef: capability.ConfigurationDefinition = {
  key: "systemMode",
  category: "system",
  valueType: "STRING" as const,
  allowedValues: null,
  defaultValue: "auto",
  tenantOverridable: false,
  lifecycle: "ACTIVE" as const,
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

  const missing = capability.patchConfiguration(
    state,
    "tenant1",
    "featureX",
    undefined as unknown,
    "write-featureX",
    auditFn,
  );
  assert.ok("kind" in missing && missing.kind === "VALIDATION_ERROR");

  const unknown = capability.patchConfiguration(
    state,
    "tenant1",
    "unknownKey",
    true,
    "write-featureX",
    auditFn,
  );
  assert.ok("kind" in unknown && unknown.kind === "NOT_FOUND");

  const nonOver = capability.patchConfiguration(
    state,
    "tenant1",
    "systemMode",
    "manual",
    "write-systemMode",
    auditFn,
  );
  assert.ok("kind" in nonOver && nonOver.kind === "UNPROCESSABLE_ENTITY");

  const forbidden = capability.patchConfiguration(
    state,
    "tenant1",
    "featureX",
    true,
    "wrong-permission",
    auditFn,
  );
  assert.ok("kind" in forbidden && forbidden.kind === "FORBIDDEN");

  const noTenant = capability.listConfigurations(state, null, null, "read-featureX");
  assert.strictEqual(noTenant.outcome, "BAD_REQUEST");
  assert.ok(noTenant.error && noTenant.error.kind === "BAD_REQUEST");

  const storeUnreachable: capability.ConfigurationRegistryAndHistoryState = {
    ...state,
    storeReachable: false,
  };
  const unreachable = capability.listConfigurations(storeUnreachable, "tenant1", null, "read-featureX");
  assert.strictEqual(unreachable.outcome, "BAD_REQUEST");
  assert.ok(unreachable.error && unreachable.error.kind === "STORE_UNAVAILABLE");
});

test("configurationregistryandhistorylifecycle", () => {
  const activeDef: capability.ConfigurationDefinition = {
    ...sampleDef,
    lifecycle: "ACTIVE" as const,
  };
  const deprecatedDef: capability.ConfigurationDefinition = {
    ...sampleDef,
    key: "oldFeature",
    lifecycle: "DEPRECATED" as const,
  };
  const internalDef: capability.ConfigurationDefinition = {
    ...sampleDef,
    key: "internalFeature",
    lifecycle: "INTERNAL" as const,
  };

  const state: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [activeDef, deprecatedDef, internalDef],
    storeReachable: true,
  };

  const auditFn = () => null;
  const patched = capability.patchConfiguration(
    state,
    "tenant1",
    "featureX",
    true,
    "write-featureX",
    auditFn,
  );
  assert.ok("tenantOverrides" in patched);
  assert.strictEqual(patched.lastAuditEvent?.kind, "CONFIGURATION_CHANGE");

  const deleted = capability.deleteConfiguration(
    patched,
    "tenant1",
    "featureX",
    "write-featureX",
    auditFn,
  );
  assert.ok("tenantOverrides" in deleted);
  assert.strictEqual(deleted.lastAuditEvent?.kind, "CONFIGURATION_CLEARED");

  const resolved = capability.resolveEffectiveValue(
    state,
    "tenant1",
    "featureX",
    "read-featureX",
  );
  assert.strictEqual(resolved.entry?.source, "PLATFORM_DEFAULT");
  assert.strictEqual(resolved.entry?.effectiveValue, false);
});

test("configurationregistryandhistorypermissions", () => {
  const state: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [sampleDef, enumDef],
    storeReachable: true,
  };
  const auditFn = () => null;

  const wrongReadPerm = capability.listConfigurations(state, "tenant1", null, "wrong-perm");
  assert.strictEqual(wrongReadPerm.result.length, 0);

  const wrongWritePerm = capability.patchConfiguration(
    state,
    "tenant1",
    "featureX",
    true,
    "wrong-perm",
    auditFn,
  );
  assert.ok("kind" in wrongWritePerm && wrongWritePerm.kind === "FORBIDDEN");

  const wrongDeletePerm = capability.deleteConfiguration(
    state,
    "tenant1",
    "featureX",
    "wrong-perm",
    auditFn,
  );
  assert.ok("kind" in wrongDeletePerm && wrongDeletePerm.kind === "FORBIDDEN");

  const readResult = capability.resolveEffectiveValue(
    state,
    "tenant1",
    "featureX",
    "read-featureX",
  );
  assert.strictEqual(readResult.entry?.definition.key, "featureX");

  const wrongReadPermResolve = capability.resolveEffectiveValue(
    state,
    "tenant1",
    "featureX",
    "wrong-perm",
  );
  assert.strictEqual(wrongReadPermResolve.outcome, "FORBIDDEN");
});

test("configurationregistryandhistoryproof", () => {
  const state: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [sampleDef],
    storeReachable: true,
  };
  const auditFn = () => null;

  const patched = capability.patchConfiguration(
    state,
    "tenant1",
    "featureX",
    true,
    "write-featureX",
    auditFn,
  );
  assert.ok("tenantOverrides" in patched);
  assert.strictEqual(patched.lastAuditEvent?.kind, "CONFIGURATION_CHANGE");

  const resolved = capability.resolveEffectiveValue(
    patched,
    "tenant1",
    "featureX",
    "read-featureX",
  );
  assert.strictEqual(resolved.entry?.source, "TENANT_OVERRIDE");
  assert.strictEqual(resolved.entry?.effectiveValue, true);

  const validationError = capability.validateDefinition(
    state.definitions,
    "featureX",
    "not-a-boolean",
  );
  assert.ok(validationError && validationError.kind === "VALIDATION_ERROR");
});

test("configurationregistryandhistoryreadinessmodel", () => {
  const unreachableState: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [sampleDef],
    storeReachable: false,
  };

  const listResult = capability.listConfigurations(
    unreachableState,
    "tenant1",
    null,
    "read-featureX",
  );
  assert.strictEqual(listResult.outcome, "BAD_REQUEST");
  assert.ok(listResult.error && listResult.error.kind === "STORE_UNAVAILABLE");

  const patchResult = capability.patchConfiguration(
    unreachableState,
    "tenant1",
    "featureX",
    true,
    "write-featureX",
    () => null,
  );
  assert.ok("kind" in patchResult && patchResult.kind === "STORE_UNAVAILABLE");

  const reachableState: capability.ConfigurationRegistryAndHistoryState = {
    ...unreachableState,
    storeReachable: true,
  };
  const listReachable = capability.listConfigurations(
    reachableState,
    "tenant1",
    null,
    "read-featureX",
  );
  assert.strictEqual(listReachable.outcome, "NO_CONTENT");
  assert.strictEqual(listReachable.error, null);
});

test("configurationregistryandhistorystatemodel", () => {
  const state: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [sampleDef, enumDef],
    tenantOverrides: [
      { tenantId: "tenant1", key: "featureX", value: true },
      { tenantId: "tenant2", key: "color", value: "blue" },
    ],
    storeReachable: true,
  };

  assert.strictEqual(state.definitions.length, 2);
  assert.strictEqual(state.tenantOverrides.length, 2);

  const resolvedDefault = capability.resolveEffectiveValue(
    state,
    "tenant3",
    "featureX",
    "read-featureX",
  );
  assert.strictEqual(resolvedDefault.entry?.source, "PLATFORM_DEFAULT");
  assert.strictEqual(resolvedDefault.entry?.effectiveValue, false);

  const resolvedOverride = capability.resolveEffectiveValue(
    state,
    "tenant1",
    "featureX",
    "read-featureX",
  );
  assert.strictEqual(resolvedOverride.entry?.source, "TENANT_OVERRIDE");
  assert.strictEqual(resolvedOverride.entry?.effectiveValue, true);
});

test("configurationregistryandhistoryvalidation", () => {
  const state: capability.ConfigurationRegistryAndHistoryState = {
    ...capability.initialState,
    definitions: [sampleDef, enumDef, nonOverDef],
    storeReachable: true,
  };
  const auditFn = () => null;

  const unknownKeyError = capability.validateDefinition(
    state.definitions,
    "unknownKey",
    true,
  );
  assert.ok(unknownKeyError && unknownKeyError.kind === "NOT_FOUND");

  const nonOverridableError = capability.validateDefinition(
    state.definitions,
    "systemMode",
    "manual",
  );
  assert.ok(nonOverridableError && nonOverridableError.kind === "UNPROCESSABLE_ENTITY");

  const missingValueError = capability.validateDefinition(
    state.definitions,
    "featureX",
    undefined as unknown,
  );
  assert.ok(missingValueError && missingValueError.kind === "VALIDATION_ERROR");

  const invalidEnumError = capability.validateDefinition(
    state.definitions,
    "color",
    "yellow",
  );
  assert.ok(invalidEnumError && invalidEnumError.kind === "VALIDATION_ERROR");

  const typeMismatchError = capability.validateDefinition(
    state.definitions,
    "featureX",
    "not-a-boolean",
  );
  assert.ok(typeMismatchError && typeMismatchError.kind === "VALIDATION_ERROR");

  const listFiltered = capability.listConfigurations(
    state,
    "tenant1",
    "features",
    "read-featureX",
  );
  assert.strictEqual(listFiltered.result.length, 1);
  assert.strictEqual(listFiltered.result[0].definition.key, "featureX");

  const listWrongPerm = capability.listConfigurations(
    state,
    "tenant1",
    null,
    "wrong-perm",
  );
  assert.strictEqual(listWrongPerm.result.length, 0);
});