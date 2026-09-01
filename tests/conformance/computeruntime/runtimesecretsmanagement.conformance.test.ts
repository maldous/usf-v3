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
  const auditFn = (e: capability.SecretAuditEvent) => {
    return {
      kind: "AUDIT_FAILURE",
      message: "audit rejected",
    };
  };
  const result = capability.auditSecretChange(event, auditFn);
  assert.deepStrictEqual(result, {
    kind: "AUDIT_FAILURE",
    message: "audit rejected",
  });

  const revokeEvent: capability.SecretAuditEvent = {
    kind: "AUDIT_BEFORE_CHANGE" as const,
    name: "revoked-secret",
    ref: "ref-2",
    provider: "openbao" as const,
    timestamp: new Date().toISOString(),
  };
  const revokeResult = capability.auditSecretChange(revokeEvent, auditFn);
  assert.deepStrictEqual(revokeResult, {
    kind: "AUDIT_FAILURE",
    message: "audit rejected",
  });

  const permissionEvent: capability.SecretAuditEvent = {
    kind: "AUDIT_BEFORE_CHANGE" as const,
    name: "protected-secret",
    ref: "ref-3",
    provider: "postgres" as const,
    timestamp: new Date().toISOString(),
  };
  const permAuditFn = (_: capability.SecretAuditEvent) => {
    return {
      kind: "UNAUTHORIZED",
      message: "Missing required permission",
    };
  };
  const permResult = capability.auditSecretChange(permissionEvent, permAuditFn);
  assert.strictEqual(permResult, {
    kind: "UNAUTHORIZED",
    message: "Missing required permission",
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

  const putResult = capability.putSecret(state, "org-1", "my-secret", "postgres", "value", true, (e) => null);
  assert.strictEqual(putResult.nextRefId, 2);
  assert.strictEqual(putResult.secrets.length, 1);
  const secret = putResult.secrets[0];
  assert.strictEqual(secret.ref, "ref-2");
  assert.strictEqual(secret.name, "my-secret");
  assert.strictEqual(secret.provider, "postgres");
  assert.strictEqual(secret.encryptedValue, "c2VybWU=");

  const rotated = capability.rotateSecret(state, "org-1", "ref-2", "new-value", true, (e) => null);
  assert.strictEqual(rotated.nextRefId, 3);
  const secretAfterRotate = rotated.secrets[0];
  assert.strictEqual(secretAfterRotate.version, 2);
  assert.strictEqual(secretAfterRotate.encryptedValue, "c2VjcmV0"); // base64 of "new-value"

  const revoked = capability.revokeSecret(rotated, "org-1", "ref-2", true, (e) => null);
  assert.strictEqual(revoked, null);
  const secretAfterRevoke = rotated.secrets[0];
  assert.strictEqual(secretAfterRevoke.revoked, true);

  const deleted = capability.deleteSecret(rotated, "org-1", "ref-2", true, (e) => null);
  assert.strictEqual(deleted, null);
  const finalState = rotated;
  assert.strictEqual(finalState.secrets.length, 0);
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
  assert.deepStrictEqual(capability.OpenBaoReadiness, ["READY", "DEGRADED", "UNREACHABLE"] as const);

  const encrypt = capability.encrypt;
  const cipher = encrypt("test");
  assert.strictEqual(Buffer.from(cipher, "base64").toString("utf8"), "dGVzdA==");

  const state = capability.initialSecretState;
  const readiness = capability.getReadiness(state);
  assert.strictEqual(readiness, "BUILTIN_READY_OPENBAO_READY");

  const degraded = capability.getReadiness({
    ...state,
    builtInReady: true,
    openBaoReadiness: "DEGRADED",
  });
  assert.strictEqual(degraded, "BUILTIN_READY_OPENBAO_DEGRADED");

  const unreachable = capability.getReadiness({
    ...state,
    builtInReady: false,
    openBaoReadiness: "UNREACHABLE",
  });
  assert.strictEqual(unreachable, "BUILTIN_NOT_READY_OPENBAO_UNREACHABLE");
});

test("runtimesecretsmanagementreadinessmodel", () => {
  const readiness = capability.OpenBaoReadiness;
  assert.deepStrictEqual(readiness, ["READY", "DEGRADED", "UNREACHABLE"] as const);

  let r1 = capability.getReadiness({...capability.initialSecretState, builtInReady: true, openBaoReadiness: "READY"});
  assert.strictEqual(r1, "BUILTIN_READY_OPENBAO_READY");

  let r2 = capability.getReadiness({...capability.initialSecretState, builtInReady: true, openBaoReadiness: "DEGRADED"});
  assert.strictEqual(r2, "BUILTIN_READY_OPENBAO_DEGRADED");

  let r3 = capability.getReadiness({...capability.initialSecretState, builtInReady: false, openBaoReadiness: "READY"});
  assert.strictEqual(r3, "BUILTIN_NOT_READY_OPENBAO_READY");

  let r4 = capability.getReadiness({...capability.initialSecretState, builtInReady: false, openBaoReadiness: "DEGRADED"});
  assert.strictEqual(r4, "BUILTIN_NOT_READY_OPENBAO_DEGRADED");

  let r5 = capability.getReadiness({...capability.initialSecretState, builtInReady: false, openBaoReadiness: "UNREACHABLE"});
  assert.strictEqual(r5, "BUILTIN_NOT_READY_OPENBAO_UNREACHABLE");
});

test("runtimesecretsmanagementstatemodel", () => {
  const state = capability.initialSecretState;
  assert.deepStrictEqual(state.secrets, []);
  assert.strictEqual(state.nextRefId, 1);
  assert.strictEqual(state.builtInReady, true);
  assert.strictEqual(state.openBaoReadiness, "READY");
});

test("runtimesecretsmanagementvalidation", () => {
  const kind = capability.SecretAuditEventKind[0];
  assert.strictEqual(kind, "AUDIT_BEFORE_CHANGE");

  const putResult = capability.putSecret(capability.initialSecretState, "org-1", "my-secret", "postgres", "val", true, (e) => null);
  assert.toBeUndefined("putSecret returns state");

  const listResult = capability.listSecrets(capability.initialSecretState, "org-1", false);
  assert.toBeUndefined("listSecrets returns void");

  const metaResult = capability.getMetadata(capability.initialSecretState, "org-1", "ref-1", false);
  assert.toBeUndefined("getMetadata returns void");

  const rotated = capability.rotateSecret(capability.initialSecretState, "org-1", "ref-1", "new-val", true, (e) => null);
  assert.strictEqual(rotated.nextRefId, 2);
  const secret = rotated.secrets[0];
  assert.strictEqual(secret.ref, "ref-1");
  assert.strictEqual(secret.version, 2);
  assert.strictEqual(secret.encryptedValue, "c2VybWU=");

  const deleted = capability.deleteSecret(capability.initialSecretState, "org-1", "ref-1", true, (e) => null);
  assert.strictEqual(deleted, null);
  const finalState = rotated;
  assert.strictEqual(finalState.secrets.length, 0);
});