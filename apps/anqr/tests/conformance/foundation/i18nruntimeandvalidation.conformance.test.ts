import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/foundation/i18nruntimeandvalidation.ts";

test("i18nruntimeandvalidationauditmodel", () => {
  const state = capability.createState(
    new Map([["key1", "value1"]]),
    ["key1"],
    new Map(),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  const result = capability.validateI18n(state);
  assert.deepEqual(result.findings, []);
  assert.equal(result.exitState, "PASS");
});

test("i18nruntimeandvalidationcontracts", () => {
  const state = capability.createState(
    new Map([["key1", "value {param}"]]),
    ["key1"],
    new Map([["key1", ["param"]]]),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  const resolved = capability.resolveLocaleKey(state, "key1", { param: "test" });
  assert.equal(resolved, "value test");
  const missingKeyResult = capability.resolveLocaleKey(state, "missingKey");
  assert.equal(missingKeyResult.kind, "MISSING_REQUIRED_KEY");
});

test("i18nruntimeandvalidationerrormodel", () => {
  const state = capability.createState(
    new Map(),
    ["key1"],
    new Map(),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "FAIL");
  assert.equal(result.findings[0]?.kind, "MISSING_REQUIRED_KEY");
});

test("i18nruntimeandvalidationlifecycle", () => {
  const state = capability.createState(
    new Map([["key1", "value"]]),
    ["key1"],
    new Map(),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  const readiness = capability.checkReadiness(state);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.error, null);
});

test("i18nruntimeandvalidationpermissions", () => {
  const state = capability.initialState;
  const result = capability.validateI18n(state);
  assert.deepEqual(result.findings, []);
  assert.equal(result.exitState, "PASS");
});

test("i18nruntimeandvalidationproof", () => {
  const state = capability.createState(
    new Map([["key1", "value {param}"]]),
    ["key1"],
    new Map([["key1", ["param"]]]),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  const resolved = capability.resolveLocaleKey(state, "key1", { param: "test" });
  assert.equal(resolved, "value test");
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "PASS");
});

test("i18nruntimeandvalidationreadinessmodel", () => {
  const state = capability.createState(
    new Map(),
    ["key1"],
    new Map(),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  const readiness = capability.checkReadiness(state);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.error?.kind, "READINESS_DEGRADED");
});

test("i18nruntimeandvalidationstatemodel", () => {
  const state = capability.createState(
    new Map([["key1", "value"]]),
    ["key1"],
    new Map(),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  assert.equal(state.localeKeyMap.get("key1"), "value");
  assert.deepEqual(state.usedKeys, ["key1"]);
  assert.deepEqual(state.duplicateKeys, []);
  assert.deepEqual(state.rawLiteralFindings, []);
  assert.equal(state.validationMode, "STRICT");
  assert.equal(state.exitState, "PASS");
});

test("i18nruntimeandvalidationvalidation", () => {
  const state = capability.createState(
    new Map([["key1", "value"]]),
    ["key1", "key2"],
    new Map(),
    [],
    {
      strictFailOnRawLiteral: true,
      governedLiterals: [],
      excludedKeys: [],
      exceptionPatterns: [],
    },
    "STRICT"
  );
  const result = capability.validateI18n(state);
  assert.equal(result.exitState, "FAIL");
  assert.equal(result.findings[0]?.kind, "MISSING_REQUIRED_KEY");
  assert.equal(result.findings[0]?.key, "key2");
});