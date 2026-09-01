import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/computeruntime/runtimesecretsmanagement.ts";

test("runtimesecretsmanagementauditmodel", () => {
  const state = capability.initialSecretState;
  const auditFn: (e: capability.SecretAuditEvent) => capability.SecretManagementError | null = (e) => {
    assert.strictEqual(e.kind, 'AUDIT_BEFORE_CHANGE');
    assert.ok(e.name);
    assert.ok(e.ref);
    assert.ok(e.provider);
    return null;
  };

  const putResult = capability.putSecret(state, 'org-1', 'sec', 'postgres', 'val', true, auditFn);
  assert.ok(!('kind' in putResult), 'putSecret should succeed');

  const failAuditFn: (e: capability.SecretAuditEvent) => capability.SecretManagementError | null = () => ({
    kind: 'AUDIT_FAILURE',
    message: 'blocked',
  });

  const putFail = capability.putSecret(state, 'org-1', 'sec', 'postgres', 'val', true, failAuditFn);
  assert.deepStrictEqual(putFail, { kind: 'AUDIT_FAILURE', message: 'blocked' });

  const stateWithSec = putResult as capability.SecretManagementState;
  const revokeFail = capability.revokeSecret(stateWithSec, 'org-1', 'ref-1', true, failAuditFn);
  assert.deepStrictEqual(revokeFail, { kind: 'AUDIT_FAILURE', message: 'blocked' });

  const deleteFail = capability.deleteSecret(stateWithSec, 'org-1', 'ref-1', true, failAuditFn);
  assert.deepStrictEqual(deleteFail, { kind: 'AUDIT_FAILURE', message: 'blocked' });
});

test("runtimesecretsmanagementcontracts", () => {
  const state = capability.initialSecretState;
  const putRes = capability.putSecret(state, 'org-1', 's', 'postgres', 'v', true, () => null);
  if ('kind' in putRes) assert.fail('put failed');
  const s1 = putRes as capability.SecretManagementState;

  const listRes = capability.listSecrets(s1, 'org-1', true);
  assert.ok(Array.isArray(listRes), 'list should return array');

  const metaRes = capability.getMetadata(s1, 'org-1', 'ref-1', true);
  assert.ok(!('kind' in metaRes), 'meta should return record');

  const resolveRes = capability.resolveSecret(s1, 'org-1', 'ref-1');
  assert.strictEqual(resolveRes, 'v');

  const readRes = capability.getReadinessPayload(s1);
  assert.deepStrictEqual(readRes, { readiness: 'BUILTIN_READY_OPENBAO_READY' });
});

test("runtimesecretsmanagementerrormodel", () => {
  const state = capability.initialSecretState;
  const degradedState: capability.SecretManagementState = { ...state, openBaoReadiness: 'UNREACHABLE' };

  const res = capability.putSecret(degradedState, 'org-1', 's', 'openbao', 'v', true, () => null);
  assert.deepStrictEqual(res, { kind: 'PROVIDER_DEGRADED', message: 'OpenBao provider is not ready' });

  const resolveNull = capability.resolveSecret(state, 'org-1', 'non-existent');
  assert.strictEqual(resolveNull, null);
});

test("runtimesecretsmanagementlifecycle", () => {
  const state = capability.initialSecretState;
  const putRes = capability.putSecret(state, 'org-1', 's', 'postgres', 'v1', true, () => null);
  if ('kind' in putRes) assert.fail('put failed');
  const s1 = putRes as capability.SecretManagementState;
  assert.strictEqual(s1.secrets[0].ref, 'ref-1');

  const rotRes = capability.rotateSecret(s1, 'org-1', 'ref-1', 'v2', true, () => null);
  if ('kind' in rotRes) assert.fail('rotate failed');
  const s2 = rotRes as capability.SecretManagementState;
  assert.strictEqual(s2.secrets[0].version, 2);
  assert.strictEqual(s2.secrets[0].ref, 'ref-1');

  const revRes = capability.revokeSecret(s2, 'org-1', 'ref-1', true, () => null);
  if ('kind' in revRes) assert.fail('revoke failed');
  const s3 = revRes as capability.SecretManagementState;
  assert.strictEqual(capability.resolveSecret(s3, 'org-1', 'ref-1'), null);

  const delRes = capability.deleteSecret(s3, 'org-1', 'ref-1', true, () => null);
  if ('kind' in delRes) assert.fail('delete failed');
  const s4 = delRes as capability.SecretManagementState;
  assert.deepStrictEqual(capability.getMetadata(s4, 'org-1', 'ref-1', true), {
    kind: 'SECRET_NOT_FOUND',
    message: 'Secret not found or deleted',
  });
});

test("runtimesecretsmanagementpermissions", () => {
  const state = capability.initialSecretState;
  const noPerm = capability.putSecret(state, 'org-1', 's', 'postgres', 'v', false, () => null);
  assert.deepStrictEqual(noPerm, { kind: 'UNAUTHORIZED', message: 'Missing required permission' });

  const putRes = capability.putSecret(state, 'org-1', 's', 'postgres', 'v', true, () => null);
  const s1 = putRes as capability.SecretManagementState;
  const crossTenant = capability.resolveSecret(s1, 'org-2', 'ref-1');
  assert.strictEqual(crossTenant, null);
});

test("runtimesecretsmanagementproof", () => {
  const state = capability.initialSecretState;
  const putRes = capability.putSecret(state, 'org-1', 's', 'postgres', 'v', true, () => null);
  const s1 = putRes as capability.SecretManagementState;
  assert.strictEqual(capability.resolveSecret(s1, 'org-1', 'ref-1'), 'v');
  assert.strictEqual(capability.getReadinessPayload(state).readiness, 'BUILTIN_READY_OPENBAO_READY');
});

test("runtimesecretsmanagementreadinessmodel", () => {
  const state = capability.initialSecretState;
  const sDegraded: capability.SecretManagementState = { ...state, openBaoReadiness: 'DEGRADED' };
  const sUnreachable: capability.SecretManagementState = { ...state, openBaoReadiness: 'UNREACHABLE' };
  const sBuiltinNotReady: capability.SecretManagementState = { ...state, builtInReady: false };

  assert.strictEqual(capability.getReadinessPayload(state).readiness, 'BUILTIN_READY_OPENBAO_READY');
  assert.strictEqual(capability.getReadinessPayload(sDegraded).readiness, 'BUILTIN_READY_OPENBAO_DEGRADED');
  assert.strictEqual(capability.getReadinessPayload(sUnreachable).readiness, 'BUILTIN_READY_OPENBAO_UNREACHABLE');
  assert.strictEqual(capability.getReadinessPayload(sBuiltinNotReady).readiness, 'BUILTIN_NOT_READY_OPENBAO_READY');
});

test("runtimesecretsmanagementstatemodel", () => {
  const state = capability.initialSecretState;
  const putRes = capability.putSecret(state, 'org-1', 's', 'postgres', 'v', true, () => null);
  const s1 = putRes as capability.SecretManagementState;
  const rec = s1.secrets[0];
  assert.strictEqual(rec.provider, 'postgres');
  assert.strictEqual(rec.encryptedValue, 'dg=='); // "v" in base64 is "dg=="
  assert.strictEqual(rec.backendPath, 'postgres/org-1/s');

  const putBao = capability.putSecret(state, 'org-1', 's', 'openbao', 'v', true, () => null);
  const sBao = putBao as capability.SecretManagementState;
  assert.strictEqual(sBao.secrets[0].encryptedValue, null);
});

test("runtimesecretsmanagementvalidation", () => {
  const state = capability.initialSecretState;
  const putRes = capability.putSecret(state, 'org-1', 's', 'postgres', 'v', true, () => null);
  const s1 = putRes as capability.SecretManagementState;

  const meta = capability.getMetadata(s1, 'org-1', 'ref-1', true);
  assert.ok(!('kind' in meta));
  assert.strictEqual((meta as capability.SecretRecord).encryptedValue, 'dg==');

  const resolve = capability.resolveSecret(s1, 'org-1', 'ref-1');
  assert.strictEqual(resolve, 'v');

  const rot = capability.rotateSecret(s1, 'org-1', 'ref-1', 'v2', true, () => null);
  const s2 = rot as capability.SecretManagementState;
  assert.strictEqual(s2.secrets[0].version, 2);
  assert.strictEqual(s2.secrets[0].ref, 'ref-1');
});