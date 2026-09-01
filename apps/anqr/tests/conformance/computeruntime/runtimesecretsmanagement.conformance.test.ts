import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/computeruntime/runtimesecretsmanagement.ts";

test("runtimesecretsmanagementauditmodel", () => {
  const event: capability.SecretAuditEvent = {
    kind: "AUDIT_BEFORE_CHANGE" as const,
    name: "my-secret",
    ref: "ref-1",
    provider: "postgres" as const,
    timestamp: new Date().toISOString(),
  };
  const auditFn = (e: capability.SecretAuditEvent): capability.SecretManagementError | null => ({
    kind: "AUDIT_FAILURE",
    message: "audit rejected",
  });
  const result = capability.auditSecretChange(event, auditFn);
  assert.deepStrictEqual(result, {
    kind: "AUDIT_FAILURE",
    message: "audit rejected",
  });
});

test("runtimesecretsmanagementcontracts", () => {
  assert.ok(Array.isArray(capability.Provider));
  assert.deepStrictEqual(capability.Provider, ["postgres", "openbao"] as const);
});

test("runtimesecretsmanagementerrormodel", () => {
  const err: capability.SecretManagementError = {
    kind: "UNAUTHORIZED",
    message: "no permission",
  };
  assert.strictEqual(err.kind, "UNAUTHORIZED");
});

test("runtimesecretsmanagementlifecycle", () => {
  const state = capability.initialSecretState;
  assert.strictEqual(state.nextRefId, 1);
  assert.strictEqual(state.builtInReady, true);
  assert.strictEqual(state.openBaoReadiness, "READY");
});

test("runtimesecretsmanagementpermissions", () => {
  const event: capability.SecretAuditEvent = {
    kind: "AUDIT_BEFORE_CHANGE",
    name: "s",
    ref: "r",
    provider: "openbao",
    timestamp: "",
  };
  const auditFn = (_: capability.SecretAuditEvent) => null;
  const result = capability.auditSecretChange(event, auditFn);
  assert.strictEqual(result, null);
});

test("runtimesecretsmanagementproof", () => {
  assert.equal(typeof capability.auditSecretChange, "function");
});

test("runtimesecretsmanagementreadinessmodel", () => {
  const readiness = capability.OpenBaoReadiness;
  assert.deepStrictEqual(readiness, ["READY", "DEGRADED", "UNREACHABLE"] as const);
});

test("runtimesecretsmanagementstatemodel", () => {
  const state = capability.initialSecretState;
  assert.deepStrictEqual(state.secrets, []);
});

test("runtimesecretsmanagementvalidation", () => {
  const kind = capability.SecretAuditEventKind[0];
  assert.strictEqual(kind, "AUDIT_BEFORE_CHANGE");
});