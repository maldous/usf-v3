```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import * as capability from '../../../src/capabilities/dataplatform/historyreadmodelreadonlyprojection.ts';

test('historyreadmodelreadonlyprojectionauditmodel', () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-a',
    isAdmin: false,
  };
  let calledTenantId: string | null = null;
  const repository = (tenantId: string): readonly unknown[] => {
    calledTenantId = tenantId;
    return [
      {
        id: '1',
        source: 'AUDIT',
        type: 'CREATE',
        title: 'Audit event',
        occurrenceTime: '2023-01-01T00:00:00Z',
        actor: 'user-1',
        status: 'success',
        secret: 'should-not-leak',
        payload: { sensitive: true },
      },
    ];
  };

  const result = capability.tenantHistory(state, context, 10, 0, repository);
  assert.ok(calledTenantId === 'tenant-a', 'tenant context must be preserved through the read span');
  assert.ok(!Array.isArray(result) && 'entries' in result, 'expected a projected page result');
  const page = result as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(page.entries.length, 1);
  const entry = page.entries[0];
  const allowedKeys = ['id', 'source', 'type', 'title', 'occurrenceTime', 'actor', 'status'];
  for (const key of Object.keys(entry)) {
    assert.ok(allowedKeys.includes(key), `entry must not expose extra field: ${key}`);
  }
  assert.ok(!('secret' in entry), 'raw secret must not appear in projection');
  assert.ok(!('payload' in entry), 'raw payload must not appear in projection');
  // state must remain untouched (read-only capability)
  assert.strictEqual(state.readiness, 'READY');
  assert.strictEqual(state.lastError, null);
});

test('historyreadmodelreadonlyprojectioncontracts', () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-b',
    isAdmin: false,
  };
  const repository = (): readonly unknown[] => [
    {
      id: '2',
      source: 'EVENT',
      type: 'UPDATE',
      title: 'Event update',
      occurrenceTime: '2023-02-02T00:00:00Z',
      actor: 'user-2',
      status: 'failure',
      token: 'should-not-leak',
    },
  ];

  const result = capability.tenantHistory(state, context, 5, 0, repository);
  assert.ok(!Array.isArray(result) && 'entries' in result, 'tenantHistory must return the paged projection shape');
  const page = result as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.deepStrictEqual(Object.keys(page).sort(), ['entries', 'limit', 'offset', 'total'].sort());
  assert.strictEqual(page.limit, 5);
  assert.strictEqual(page.offset, 0);
  assert.strictEqual(page.total, 1);
  assert.strictEqual(page.entries.length, 1);
  assert.ok(!('token' in page.entries[0]), 'token must be excluded from the projected entry');

  const adminContext: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'admin',
    isAdmin: true,
  };
  const adminResult = capability.adminTenantHistory(state, adminContext, 'tenant-b', 5, 0, repository);
  assert.ok(!Array.isArray(adminResult) && 'entries' in adminResult, 'adminTenantHistory must also return the paged projection shape');
});

test('historyreadmodelreadonlyprojectionerrormodel', () => {
  const degradedState: capability.HistoryReadModelReadOnlyProjectionState = {
    readiness: 'DEGRADED',
    lastError: { kind: 'STORE_UNAVAILABLE', message: 'store down' },
  };
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-c',
    isAdmin: false,
  };
  const emptyRepo = (): readonly unknown[] => [];

  // fail closed when store is unavailable
  let result = capability.tenantHistory(degradedState, context, 10, 0, emptyRepo);
  assert.ok(!Array.isArray(result) && 'kind' in result);
  assert.strictEqual((result as capability.HistoryReadModelReadOnlyProjectionError).kind, 'STORE_UNAVAILABLE');

  // fail closed when tenant context is missing
  result = capability.tenantHistory(capability.initialState, null, 10, 0, emptyRepo);
  assert.strictEqual((result as capability.HistoryReadModelReadOnlyProjectionError).kind, 'TENANT_CONTEXT_MISSING');

  // fail closed when a non-admin tries to read another tenant's history
  const nonAdmin: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-c',
    isAdmin: false,
  };
  result = capability.adminTenantHistory(capability.initialState, nonAdmin, 'tenant-d', 10, 0, emptyRepo);
  assert.strictEqual((result as capability.HistoryReadModelReadOnlyProjectionError).kind, 'UNAUTHORIZED_TENANT_ACCESS');

  // fail closed on invalid paging parameters
  result = capability.tenantHistory(capability.initialState, context, 0, 0, emptyRepo);
  assert.strictEqual((result as capability.HistoryReadModelReadOnlyProjectionError).kind, 'INVALID_PAGING_PARAMETERS');

  // must not invent history entries when repository yields nothing
  const emptyResult = capability.tenantHistory(capability.initialState, context, 10, 0, emptyRepo) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(emptyResult.total, 0);
  assert.deepStrictEqual(emptyResult.entries, []);
});

test('historyreadmodelreadonlyprojectionlifecycle', () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-e',
    isAdmin: false,
  };
  const repository = (): readonly unknown[] => [
    {
      id: '3',
      source: 'AUDIT',
      type: 'DELETE',
      title: 'Delete record',
      occurrenceTime: '2023-03-03T00:00:00Z',
      actor: 'user-3',
      status: 'deleted',
      password: 'super-secret',
      token: 'xyz',
      metadata: { internal: true },
    },
  ];

  const result = capability.tenantHistory(state, context, 10, 0, repository) as capability.HistoryReadModelReadOnlyProjectionPage;
  const entry = result.entries[0];
  assert.ok(!('password' in entry), 'password must be excluded from projection');
  assert.ok(!('token' in entry), 'token must be excluded from projection');
  assert.ok(!('metadata' in entry), 'raw metadata must be excluded from projection');
  // lifecycle is strictly read-only: state must not be mutated
  assert.strictEqual(state.readiness, 'READY');
  assert.strictEqual(state.lastError, null);
});

test('historyreadmodelreadonlyprojectionpermissions', () => {
  const state = capability.initialState;
  const tenantContext: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-f',
    isAdmin: false,
  };

  let scopedTenantId: string | null = null;
  const repository = (tenantId: string): readonly unknown[] => {
    scopedTenantId = tenantId;
    return [
      { id: '4', source: 'EVENT', type: 'ACCESS', title: 'Access', occurrenceTime: '2023-04-04T00:00:00Z', actor: 'user-4', status: 'granted' },
    ];
  };

  capability.tenantHistory(state, tenantContext, 10, 0, repository);
  assert.strictEqual(scopedTenantId, 'tenant-f', 'tenant-scoped read must be confined to the caller tenant');

  const adminContext: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'admin',
    isAdmin: true,
  };
  let adminScopedTenantId: string | null = null;
  const adminRepository = (tenantId: string): readonly unknown[] => {
    adminScopedTenantId = tenantId;
    return [];
  };
  const adminResult = capability.adminTenantHistory(state, adminContext, 'tenant-g', 10, 0, adminRepository) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(adminScopedTenantId, 'tenant-g', 'admin variant must be scoped to the requested tenant');
  assert.strictEqual(adminResult.entries.length, 0);

  const nonAdmin: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-f',
    isAdmin: false,
  };
  const unauthorized = capability.adminTenantHistory(state, nonAdmin, 'tenant-g', 10, 0, adminRepository) as capability.HistoryReadModelReadOnlyProjectionError;
  assert.strictEqual(unauthorized.kind, 'UNAUTHORIZED_TENANT_ACCESS', 'tenant isolation must be enforced across tenants');
});

test('historyreadmodelreadonlyprojectionproof', () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-proof',
    isAdmin: false,
  };
  const repository = (): readonly unknown[] => [
    { id: '5', source: 'AUDIT', type: 'CREATE', title: 'Proof create', occurrenceTime: '2023-05-05T00:00:00Z', actor: 'user-5', status: 'ok', secret: 'hidden' },
  ];

  const result = capability.tenantHistory(state, context, 10, 0, repository) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(result.entries.length, 1);
  const entry = result.entries[0];
  const allowedKeys = ['id', 'source', 'type', 'title', 'occurrenceTime', 'actor', 'status'];
  assert.deepStrictEqual(Object.keys(entry).sort(), allowedKeys.sort(), 'projection must assert the safe summarised shape');
  // tenant scoping is asserted by verifying the repository receives the caller's tenant id
  let proofTenantId: string | null = null;
  const proofRepo = (tenantId: string): readonly unknown[] => {
    proofTenantId = tenantId;
    return [];
  };
  capability.tenantHistory(state, context, 10, 0, proofRepo);
  assert.strictEqual(proofTenantId, 'tenant-proof', 'tenant scoping must be preserved in the proof');
});

test('historyreadmodelreadonlyprojectionreadinessmodel', () => {
  let state = capability.initialState;
  state = capability.checkReadiness(state, true);
  assert.strictEqual(state.readiness, 'READY');
  assert.strictEqual(state.lastError, null);

  state = capability.checkReadiness(state, false);
  assert.strictEqual(state.readiness, 'DEGRADED');
  assert.ok(state.lastError !== null);
  assert.strictEqual(state.lastError!.kind, 'STORE_UNAVAILABLE');
  assert.strictEqual(state.lastError!.message, 'History store is unreachable');
});

test('historyreadmodelreadonlyprojectionstatemodel', () => {
  const rawEntry = {
    id: '6',
    source: 'EVENT',
    type: 'ACCESS',
    title: 'Stat model',
    occurrenceTime: '2023-06-06T00:00:00Z',
    actor: 'user-6',
    status: 'allowed',
    extra: 'should be dropped',
  };
  const projected = capability.projectHistoryEntry(rawEntry);
  assert.ok(projected !== null);
  const entry = projected as capability.HistoryReadModelReadOnlyProjectionEntry;
  const allowedKeys = ['id', 'source', 'type', 'title', 'occurrenceTime', 'actor', 'status'];
  assert.deepStrictEqual(Object.keys(entry).sort(), allowedKeys.sort());

  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: 'tenant-stat',
    isAdmin: false,
  };
  const repository = (): readonly unknown[] => [rawEntry];
  const page = capability.tenantHistory(capability.initialState, context, 7, 2, repository) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.deepStrictEqual(Object.keys(page).sort(), ['entries',