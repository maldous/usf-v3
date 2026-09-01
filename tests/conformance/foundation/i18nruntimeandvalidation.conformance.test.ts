import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/foundation/i18nruntimeandvalidation.ts";

test("i18nruntimeandvalidationauditmodel", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    duplicateKeys: ["dupKey"],
    rawLiteralFindings: [{ kind: "UNGOVERNED_RAW_LITERAL", message: "test", literal: "raw" }],
    validationMode: "STRICT",
    exitState: "FAIL",
  };
  const result = capability.validateI18n(state);
  assert.ok(result.findings.some(f => f.kind === "DUPLICATE_KEY" && f.key === "dupKey"));
  assert.ok(result.findings.some(f => f.kind === "UNGOVERNED_RAW_LITERAL"));
  assert.equal(result.exitState, "FAIL");
});

test("i18nruntimeandvalidationcontracts", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    localeKeyMap: new Map([["key1", "value {param}"]]),
    interpolationParams: new Map([["key1", ["param"]]]),
  };
  const resolved = capability.resolveLocaleKey(state, "key1", { param: "test" });
  assert.equal(resolved.kind, "SUCCESS");
  assert.equal((resolved as { readonly kind: 'SUCCESS'; readonly value: string }).value, "value test");
  const missingKeyResult = capability.resolveLocaleKey(state, "missingKey");
  assert.equal(missingKeyResult.kind, "MISSING_REQUIRED_KEY");
});

test("i18nruntimeandvalidationerrormodel", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    usedKeys: ["missingKey"],
    validationMode: "STRICT",
  };
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "FAIL");
  assert.equal(result.findings[0]?.kind, "MISSING_REQUIRED_KEY");
});

test("i18nruntimeandvalidationlifecycle", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    localeKeyMap: new Map([["key1", "value"]]),
    usedKeys: ["key1"],
    validationMode: "STRICT",
  };
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "PASS");
  const resolved = capability.resolveLocaleKey(state, "key1");
  assert.equal(resolved.kind, "SUCCESS");
});

test("i18nruntimeandvalidationpermissions", () => {
  const state = capability.initialState;
  const result = capability.validateI18n(state);
  assert.deepEqual(result.findings, []);
  assert.equal(result.exitState, "PASS");
  const resolved = capability.resolveLocaleKey(state, "nonexistent");
  assert.equal(resolved.kind, "MISSING_REQUIRED_KEY");
});

test("i18nruntimeandvalidationproof", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    localeKeyMap: new Map([["key1", "value {param}"]]),
    interpolationParams: new Map([["key1", ["param"]]]),
    usedKeys: ["key1"],
  };
  const resolved = capability.resolveLocaleKey(state, "key1", { param: "test" });
  assert.equal(resolved.kind, "SUCCESS");
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "PASS");
});

test("i18nruntimeandvalidationreadinessmodel", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    usedKeys: ["missingKey"],
    validationMode: "STRICT",
  };
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "FAIL");
  assert.ok(result.findings.some(f => f.kind === "MISSING_REQUIRED_KEY"));
});

test("i18nruntimeandvalidationstatemodel", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    localeKeyMap: new Map([["key1", "value"]]),
    usedKeys: ["key1"],
    duplicateKeys: ["dupKey"],
    rawLiteralFindings: [{ kind: "UNGOVERNED_RAW_LITERAL", message: "test", literal: "raw" }],
    config: {
      strictFailOnRawLiteral: true,
      governedLiterals: ["allowed"],
      excludedKeys: ["excluded"],
      exceptionPatterns: ["pattern"],
    },
    validationMode: "REPORT_ONLY",
    exitState: "PASS",
  };
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "PASS");
  assert.ok(state.localeKeyMap.has("key1"));
  assert.deepEqual(state.usedKeys, ["key1"]);
  assert.deepEqual(state.duplicateKeys, ["dupKey"]);
  assert.deepEqual(state.rawLiteralFindings, [{ kind: "UNGOVERNED_RAW_LITERAL", message: "test", literal: "raw" }]);
  assert.equal(state.config.strictFailOnRawLiteral, true);
  assert.deepEqual(state.config.governedLiterals, ["allowed"]);
  assert.deepEqual(state.config.excludedKeys, ["excluded"]);
  assert.deepEqual(state.config.exceptionPatterns, ["pattern"]);
  assert.equal(state.validationMode, "REPORT_ONLY");
});

test("i18nruntimeandvalidationvalidation", () => {
  const state: capability.I18nRuntimeAndValidationState = {
    ...capability.initialState,
    localeKeyMap: new Map([["key1", "value"]]),
    usedKeys: ["key1", "key2"],
    validationMode: "STRICT",
  };
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "FAIL");
  assert.equal(result.findings[0]?.kind, "MISSING_REQUIRED_KEY");
  assert.equal(result.findings[0]?.key, "key2");
});