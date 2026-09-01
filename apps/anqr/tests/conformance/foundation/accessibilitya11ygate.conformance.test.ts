import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/foundation/accessibilitya11ygate.ts";

test("accessibilitya11ygateauditmodel", () => {
  const expectationSet = {
    landmarks: ["main"] as const,
    roles: ["button"] as const,
    aria: { "aria-label": true } as const,
    axeRules: ["color-contrast"] as const,
  };
  const rendered = { main: true, button: true, "aria-label": true, "color-contrast": true };
  const result = capability.auditSurface("test", rendered, expectationSet);
  assert.ok(!("kind" in result));
  const auditResult = result as capability.AccessibilityAuditResult;
  assert.deepEqual(auditResult.landmarks, { main: true });
  assert.deepEqual(auditResult.roles, { button: true });
  assert.deepEqual(auditResult.aria, { "aria-label": true });
  assert.deepEqual(auditResult.axeViolations, []);
});

test("accessibilitya11ygatecontracts", () => {
  const validConfig: capability.AccessibilityA11yGateConfig = {
    expectationSet: {
      landmarks: ["main"],
      roles: ["button"],
      aria: { "aria-label": true },
      axeRules: ["color-contrast"],
    },
  };
  const validated = capability.validateConfig(validConfig);
  assert.ok(!("kind" in validated));
  assert.deepEqual((validated as capability.AccessibilityA11yGateConfig).expectationSet, validConfig.expectationSet);

  const invalidConfig = { expectationSet: null };
  const invalid = capability.validateConfig(invalidConfig);
  assert.equal((invalid as capability.AccessibilityA11yGateError).kind, "CONFIG_MISSING");
});

test("accessibilitya11ygateerrormodel", () => {
  const error = capability.validateConfig(null);
  assert.equal((error as capability.AccessibilityA11yGateError).kind, "CONFIG_MISSING");
  assert.ok(typeof (error as capability.AccessibilityA11yGateError).message === "string");

  const surfaceError = capability.auditSurface("test", null, {
    landmarks: [],
    roles: [],
    aria: {},
    axeRules: [],
  });
  assert.equal((surfaceError as capability.AccessibilityA11yGateError).kind, "DEPENDENCY_UNAVAILABLE");
});

test("accessibilitya11ygatelifecycle", () => {
  const state: capability.AccessibilityA11yGateState = capability.initialState;
  const config: capability.AccessibilityA11yGateConfig = {
    expectationSet: {
      landmarks: ["main"],
      roles: ["button"],
      aria: {},
      axeRules: [],
    },
  };
  const surfaces = [{ id: "test", rendered: { main: true, button: true } }];
  const newState = capability.runAccessibilityGate(state, config, surfaces);
  assert.equal(newState.readiness, "READY");
  assert.equal(newState.lastVerdict, "PASS");
  assert.equal(newState.lastError, null);
});

test("accessibilitya11ygatepermissions", () => {
  const state: capability.AccessibilityA11yGateState = capability.initialState;
  const config: capability.AccessibilityA11yGateConfig = {
    expectationSet: {
      landmarks: ["main"],
      roles: ["button"],
      aria: {},
      axeRules: [],
    },
  };
  const surfaces = [{ id: "test", rendered: { main: true, button: true } }];
  const newState = capability.runAccessibilityGate(state, config, surfaces);
  assert.equal(newState.lastError, null);
  assert.equal(newState.lastVerdict, "PASS");
});

test("accessibilitya11ygateproof", () => {
  const expectationSet = {
    landmarks: ["main"] as const,
    roles: ["button"] as const,
    aria: {} as const,
    axeRules: [] as const,
  };
  const rendered = { main: true, button: true };
  const result = capability.auditSurface("test", rendered, expectationSet);
  assert.ok(!("kind" in result));
  const auditResult = result as capability.AccessibilityAuditResult;
  assert.deepEqual(auditResult.landmarks, { main: true });
  assert.deepEqual(auditResult.roles, { button: true });
});

test("accessibilitya11ygatereadinessmodel", () => {
  const state: capability.AccessibilityA11yGateState = {
    readiness: "NOT_READY",
    lastVerdict: null,
    lastAuditResults: null,
    lastError: null,
  };
  const readiness = capability.computeReadiness(state);
  assert.equal(readiness, "NOT_READY");

  const readyState: capability.AccessibilityA11yGateState = {
    readiness: "NOT_READY",
    lastVerdict: "PASS",
    lastAuditResults: [],
    lastError: null,
  };
  const readyReadiness = capability.computeReadiness(readyState);
  assert.equal(readyReadiness, "READY");
});

test("accessibilitya11ygatevalidation", () => {
  const expectationSet = {
    landmarks: ["main"] as const,
    roles: ["button"] as const,
    aria: {} as const,
    axeRules: ["color-contrast"] as const,
  };
  const validRendered = { main: true, button: true, "color-contrast": true };
  const validResult = capability.auditSurface("test", validRendered, expectationSet);
  assert.ok(!("kind" in validResult));
  assert.deepEqual((validResult as capability.AccessibilityAuditResult).axeViolations, []);

  const invalidRendered = { main: true, button: true };
  const invalidResult = capability.auditSurface("test", invalidRendered, expectationSet);
  assert.ok(!("kind" in invalidResult));
  assert.deepEqual((invalidResult as capability.AccessibilityAuditResult).axeViolations, ["color-contrast"]);
});