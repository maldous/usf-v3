import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/computeruntime/runtimesecretsmanagement.ts";

test("runtimesecretsmanagementauditmodel", () => {
  const auditFn: (e: capability.SecretAuditEvent) => capability.SecretManagementError | null = () => ({
    kind: 'AUDIT_FAILURE',
    message: 'audit rejected',
  });
  const event: capability.SecretAuditEvent = {
    kind: 'AUDIT_BEFORE_CHANGE',
    name: 'my-secret',
    ref: 'ref-1',
    provider: 'postgres',
    timestamp: new Date().toISOString(),
  };
  const result = capability.auditSecretChange(event, auditFn);
  assert.deepStrictEqual(result, {
    kind: 'AUDIT_FAILURE',
    message: 'audit rejected',
  });

  const passAuditFn: (e: capability.SecretAuditEvent) => capability.SecretManagementError | null = () => null;
  const passResult = capability.auditSecretChange(event, passAuditFn);
  assert.strictEqual(passResult, null);

  const state = capability.initialSecretState;
  const putResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, passAuditFn);
  if (putResult instanceof Error || 'kind' in putResult) {
    assert.fail('putSecret should succeed with valid audit');
  } else {
    assert.strictEqual(putResult.secrets.length, 1);
  }

  const failAuditFn: (e: capability.SecretAuditEvent) => capability.SecretManagementError | null = () => ({
    kind: 'AUDIT_FAILURE',
    message: 'blocked',
  });
  const failPutResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, failAuditFn);
  assert.deepStrictEqual(failPutResult, {
    kind: 'AUDIT_FAILURE',
    message: 'blocked',
  });
});

test("runtimesecretsmanagementcontracts", () => {
  assert.deepStrictEqual(capability.Provider, ['postgres', 'openbao'] as const);
  const state = capability.initialSecretState;
  const putResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, () => null);
  if (!(putResult instanceof Error) && !('kind' in putResult)) {
    assert.ok(Array.isArray(putResult.secrets));
    const listResult = capability.listSecrets(putResult, 'org-1', true);
    if (!(listResult instanceof Error) && !('kind' in listResult)) {
      assert.ok(Array.isArray(listResult));
    }
    const metaResult = capability.getMetadata(putResult, 'org-1', 'ref-1', true);
    if (!(metaResult instanceof Error) && !('kind' in metaResult)) {
      assert.ok(metaResult.ref);
    }
    const resolveResult = capability.resolveSecret(putResult, 'org-1', 'ref-1');
    if (resolveResult !== null && !(resolveResult instanceof Error) && !('kind' in resolveResult)) {
      assert.strictEqual(resolveResult, 'val');
    }
    const readiness = capability.getReadinessPayload(putResult);
    assert.deepStrictEqual(readiness, { readiness: 'BUILTIN_READY_OPENBAO_READY' });
  }
});

test("runtimesecretsmanagementerrormodel", () => {
  const state = capability.initialSecretState;
  const noPermResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', false, () => null);
  assert.deepStrictEqual(noPermResult, {
    kind: 'UNAUTHORIZED',
    message: 'Missing required permission',
  });

  const notFoundResult = capability.getMetadata(state, 'org-1', 'ref-999', true);
  assert.deepStrictEqual(notFoundResult, {
    kind: 'SECRET_NOT_FOUND',
    message: 'Secret not found or deleted',
  });

  const degradedState: capability.SecretManagementState = {
    ...state,
    openBaoReadiness: 'UNREACHABLE',
  };
  const degradedResult = capability.putSecret(degradedState, 'org-1', 's', 'openbao', 'val', true, () => null);
  assert.deepStrictEqual(degradedResult, {
    kind: 'PROVIDER_DEGRADED',
    message: 'OpenBao provider is not ready',
  });

  const resolveResult = capability.resolveSecret(state, 'org-1', 'ref-999');
  assert.strictEqual(resolveResult, null);
});

test("runtimesecretsmanagementlifecycle", () => {
  const state = capability.initialSecretState;
  const putResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, () => null);
  if (putResult instanceof Error || 'kind' in putResult) {
    assert.fail('putSecret should succeed');
  } else {
    assert.strictEqual(putResult.secrets[0].ref, 'ref-1');
    assert.strictEqual(putResult.secrets[0].version, 1);
    assert.strictEqual(putResult.secrets[0].encryptedValue, 'dmFs');

    const rotated = capability.rotateSecret(putResult, 'org-1', 'ref-1', 'new', true, () => null);
    if (rotated instanceof Error || 'kind' in rotated) {
      assert.fail('rotateSecret should succeed');
    } else {
      assert.strictEqual(rotated.secrets[0].ref, 'ref-1');
      assert.strictEqual(rotated.secrets[0].version, 2);
      assert.strictEqual(rotated.secrets[0].encryptedValue, 'bmV3');

      const revoked = capability.revokeSecret(rotated, 'org-1', 'ref-1', true, () => null);
      if (revoked instanceof Error || 'kind' in revoked) {
        assert.fail('revokeSecret should succeed');
      } else {
        assert.strictEqual(revoked.secrets[0].revoked, true);
        assert.strictEqual(capability.resolveSecret(revoked, 'org-1', 'ref-1'), null);

        const deleted = capability.deleteSecret(revoked, 'org-1', 'ref-1', true, () => null);
        if (deleted instanceof Error || 'kind' in deleted) {
          assert.fail('deleteSecret should succeed');
        } else {
          assert.strictEqual(deleted.secrets[0].deleted, deleted.secrets[0].updated);
        }
      }
    }
  }

  const listResult = capability.listSecrets(putResult, 'org-1', true);
  if (listResult instanceof Error || 'kind' in listResult) {
    assert.fail('listSecrets should succeed');
  } else {
    assert.strictEqual(listResult[0].encryptedValue, 'dmFs');
  }

  const metaResult = capability.getMetadata(putResult, 'org-1', 'ref-1', true);
  if (metaResult instanceof Error || 'kind' in metaResult) {
    assert.fail('getMetadata should succeed');
  } else {
    assert.strictEqual(metaResult.encryptedValue, 'dmFs');
  }
});

test("runtimesecretsmanagementpermissions", () => {
  const state = capability.initialSecretState;
  const noPermPut = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', false, () => null);
  assert.deepStrictEqual(noPermPut, {
    kind: 'UNAUTHORIZED',
    message: 'Missing required permission',
  });

  const noPermList = capability.listSecrets(state, 'org-1', false);
  assert.deepStrictEqual(noPermList, {
    kind: 'UNAUTHORIZED',
    message: 'Missing required permission',
  });

  const noPermMeta = capability.getMetadata(state, 'org-1', 'ref-1', false);
  assert.deepStrictEqual(noPermMeta, {
    kind: 'UNAUTHORIZED',
    message: 'Missing required permission',
  });

  const crossOrgState = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, () => null);
  if (!(crossOrgState instanceof Error) && !('kind' in crossOrgState)) {
    const crossOrgResolve = capability.resolveSecret(crossOrgState, 'org-2', 'ref-1');
    assert.strictEqual(crossOrgResolve, null);
    const crossOrgMeta = capability.getMetadata(crossOrgState, 'org-2', 'ref-1', true);
    assert.deepStrictEqual(crossOrgMeta, {
      kind: 'SECRET_NOT_FOUND',
      message: 'Secret not found or deleted',
    });
    const crossOrgList = capability.listSecrets(crossOrgState, 'org-2', true);
    if (!(crossOrgList instanceof Error) && !('kind' in crossOrgList)) {
      assert.strictEqual(crossOrgList.length, 0);
    }
  }
});

test("runtimesecretsmanagementproof", () => {
  assert.deepStrictEqual(capability.OpenBaoReadiness, ['READY', 'DEGRADED', 'UNREACHABLE'] as const);
  assert.deepStrictEqual(capability.BuiltInReadiness, ['READY', 'NOT_READY'] as const);
  assert.deepStrictEqual(capability.SecretManagementReadiness, [
    'BUILTIN_READY_OPENBAO_READY',
    'BUILTIN_READY_OPENBAO_DEGRADED',
    'BUILTIN_READY_OPENBAO_UNREACHABLE',
    'BUILTIN_NOT_READY_OPENBAO_READY',
    'BUILTIN_NOT_READY_OPENBAO_DEGRADED',
    'BUILTIN_NOT_READY_OPENBAO_UNREACHABLE',
  ] as const);

  const state = capability.initialSecretState;
  const putResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, () => null);
  if (!(putResult instanceof Error) && !('kind' in putResult)) {
    assert.strictEqual(putResult.secrets[0].encryptedValue, 'dmFs');
    const decrypted = Buffer.from(putResult.secrets[0].encryptedValue!, 'base64').toString('utf8');
    assert.strictEqual(decrypted, 'val');
  }
});

test("runtimesecretsmanagementreadinessmodel", () => {
  const state = capability.initialSecretState;
  assert.strictEqual(capability.getReadiness(state), 'BUILTIN_READY_OPENBAO_READY');
  const payload = capability.getReadinessPayload(state);
  assert.deepStrictEqual(payload, { readiness: 'BUILTIN_READY_OPENBAO_READY' });

  const degraded: capability.SecretManagementState = {
    ...state,
    openBaoReadiness: 'DEGRADED',
  };
  assert.strictEqual(capability.getReadiness(degraded), 'BUILTIN_READY_OPENBAO_DEGRADED');

  const unreachable: capability.SecretManagementState = {
    ...state,
    openBaoReadiness: 'UNREACHABLE',
  };
  assert.strictEqual(capability.getReadiness(unreachable), 'BUILTIN_READY_OPENBAO_UNREACHABLE');

  const builtInNotReady: capability.SecretManagementState = {
    ...state,
    builtInReady: false,
  };
  assert.strictEqual(capability.getReadiness(builtInNotReady), 'BUILTIN_NOT_READY_OPENBAO_READY');
});

test("runtimesecretsmanagementstatemodel", () => {
  const state = capability.initialSecretState;
  assert.deepStrictEqual(state.secrets, []);
  assert.strictEqual(state.nextRefId, 1);
  assert.strictEqual(state.builtInReady, true);
  assert.strictEqual(state.openBaoReadiness, 'READY');

  const putResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, () => null);
  if (!(putResult instanceof Error) && !('kind' in putResult)) {
    const secret = putResult.secrets[0];
    assert.strictEqual(secret.organisationId, 'org-1');
    assert.strictEqual(secret.name, 's');
    assert.strictEqual(secret.provider, 'postgres');
    assert.strictEqual(secret.version, 1);
    assert.strictEqual(secret.revoked, false);
    assert.strictEqual(secret.backendPath, 'postgres/org-1/s');
    assert.strictEqual(secret.encryptedValue, 'dmFs');
    assert.ok(secret.created);
    assert.ok(secret.updated);
    assert.strictEqual(secret.deleted, null);
  }

  const openBaoResult = capability.putSecret(state, 'org-1', 's2', 'openbao', 'val', true, () => null);
  if (!(openBaoResult instanceof Error) && !('kind' in openBaoResult)) {
    const secret = openBaoResult.secrets[0];
    assert.strictEqual(secret.encryptedValue, null);
    assert.strictEqual(secret.backendPath, 'openbao/org-1/s2');
  }
});

test("runtimesecretsmanagementvalidation", () => {
  const state = capability.initialSecretState;
  const putResult = capability.putSecret(state, 'org-1', 's', 'postgres', 'val', true, () => null);
  if (putResult instanceof Error || 'kind' in putResult) {
    assert.fail('putSecret should return state');
  } else {
    assert.ok(putResult.secrets.length > 0);
  }

  const listResult = capability.listSecrets(state, 'org-1', true);
  if (!(listResult instanceof Error) && !('kind' in listResult)) {
    assert.ok(Array.isArray(listResult));
    assert.strictEqual(listResult.length, 0);
  }

  const metaResult = capability.getMetadata(state, 'org-1', 'ref-1', true);
  if (!(metaResult instanceof Error) && !('kind' in metaResult)) {
    assert.fail('getMetadata should return error for missing secret');
  }

  const resolveResult = capability.resolveSecret(state, 'org-1', 'ref-1');
  assert.strictEqual(resolveResult, null);

  const readiness = capability.getReadinessPayload(state);
  assert.deepStrictEqual(readiness, { readiness: 'BUILTIN_READY_OPENBAO_READY' });
});