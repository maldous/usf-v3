import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/tenantgroups.ts";

test("tenantgroupsauditmodel", () => {
  const auditError: capability.TenantGroupsError = { kind: 'AUDIT_FAILURE', message: 'Audit failed' };
  const auditFn = () => auditError;

  const state: capability.TenantGroupsState = { groups: [], readiness: 'INVARIANT_READY', lastError: null };
  const context: capability.TenantGroupsContext = {
    tenantCredential: { realm: 'test', adminAdapter: { listGroups: async () => [], createGroup: async () => ({ id: '1', name: 'test', path: '/' }), updateGroup: async () => ({ id: '1', name: 'test', path: '/' }), deleteGroup: async () => {} } },
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true }
  };

  const createResult = capability.createGroup(state, context, 'test', '/', auditFn);
  assert.deepEqual(createResult as capability.TenantGroupsError, auditError);

  const group: capability.TenantGroup = { id: '1', name: 'test', path: '/' };
  const updateResult = capability.updateGroup({ ...state, groups: [group] }, context, '1', 'new', '/', auditFn);
  assert.deepEqual(updateResult as capability.TenantGroupsError, auditError);

  const deleteResult = capability.deleteGroup({ ...state, groups: [group] }, context, '1', auditFn);
  assert.deepEqual(deleteResult as capability.TenantGroupsError, auditError);

  const listResult = capability.listGroups(state, context);
  assert.ok(!('kind' in listResult));
});

test("tenantgroupscontracts", () => {
  const state: capability.TenantGroupsState = { groups: [], readiness: 'INVARIANT_READY', lastError: null };
  const context: capability.TenantGroupsContext = {
    tenantCredential: { realm: 'test', adminAdapter: { listGroups: async () => [], createGroup: async () => ({ id: '1', name: 'test', path: '/' }), updateGroup: async () => ({ id: '1', name: 'test', path: '/' }), deleteGroup: async () => {} } },
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true }
  };

  const listResult = capability.listGroups(state, context);
  assert.ok('groups' in listResult);

  const createResult = capability.createGroup(state, context, 'test', '/', () => null);
  assert.ok('groups' in (createResult as capability.TenantGroupsState));

  const group: capability.TenantGroup = { id: '1', name: 'test', path: '/' };
  const updateResult = capability.updateGroup({ ...state, groups: [group] }, context, '1', 'new', '/', () => null);
  assert.ok('groups' in (updateResult as capability.TenantGroupsState));

  const deleteResult = capability.deleteGroup({ ...state, groups: [group] }, context, '1', () => null);
  assert.ok('groups' in (deleteResult as capability.TenantGroupsState));
});

test("tenantgroupserrormodel", () => {
  const state: capability.TenantGroupsState = { groups: [], readiness: 'INVARIANT_READY', lastError: null };
  const contextNoCred: capability.TenantGroupsContext = {
    tenantCredential: null,
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true }
  };

  const listResult = capability.listGroups(state, contextNoCred);
  assert.equal((listResult as capability.TenantGroupsError).kind, 'NO_CREDENTIAL');

  const createResult = capability.createGroup(state, contextNoCred, 'test', '/', () => null);
  assert.equal((createResult as capability.TenantGroupsError).kind, 'NO_CREDENTIAL');

  const validation = capability.validateGroupName('', []);
  assert.equal(validation, 'INVALID_NAME');
  assert.equal(capability.mapOutcomeToHttpStatus('INVALID_NAME'), 400);

  assert.equal(capability.mapOutcomeToHttpStatus('CONFLICT'), 409);
  assert.equal(capability.mapOutcomeToHttpStatus('NOT_FOUND'), 404);
  assert.equal(capability.mapOutcomeToHttpStatus('PROTECTED'), 422);
  assert.equal(capability.mapOutcomeToHttpStatus('OK'), 201);
});

test("tenantgroupslifecycle", () => {
  const state: capability.TenantGroupsState = { groups: [], readiness: 'INVARIANT_READY', lastError: null };
  const context: capability.TenantGroupsContext = {
    tenantCredential: { realm: 'test', adminAdapter: { listGroups: async () => [], createGroup: async () => ({ id: '1', name: 'test', path: '/' }), updateGroup: async () => ({ id: '1', name: 'test', path: '/' }), deleteGroup: async () => {} } },
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true }
  };

  const listResult = capability.listGroups(state, context);
  assert.deepEqual((listResult as { readonly groups: readonly capability.TenantGroup[] }).groups, []);

  const createResult = capability.createGroup(state, context, 'test', '/', () => null);
  assert.equal((createResult as capability.TenantGroupsState).groups.length, 1);

  const group: capability.TenantGroup = { id: '1', name: 'test', path: '/' };
  const updateResult = capability.updateGroup({ ...state, groups: [group] }, context, '1', 'new', '/', () => null);
  assert.equal((updateResult as capability.TenantGroupsState).groups[0].name, 'new');

  const deleteResult = capability.deleteGroup({ ...state, groups: [group] }, context, '1', () => null);
  assert.equal((deleteResult as capability.TenantGroupsState).groups.length, 0);

  const notFoundResult = capability.updateGroup(state, context, '99', 'new', '/', () => null);
  assert.equal((notFoundResult as capability.TenantGroupsError).kind, 'NOT_FOUND');
});

test("tenantgroupspermissions", () => {
  const state: capability.TenantGroupsState = { groups: [], readiness: 'INVARIANT_READY', lastError: null };
  const contextNoPerm: capability.TenantGroupsContext = {
    tenantCredential: { realm: 'test', adminAdapter: { listGroups: async () => [], createGroup: async () => ({ id: '1', name: 'test', path: '/' }), updateGroup: async () => ({ id: '1', name: 'test', path: '/' }), deleteGroup: async () => {} } },
    permissions: { canRead: false, canCreate: false, canUpdate: false, canDelete: false }
  };

  const listResult = capability.listGroups(state, contextNoPerm);
  assert.equal((listResult as capability.TenantGroupsError).kind, 'NO_CREDENTIAL');

  const createResult = capability.createGroup(state, contextNoPerm, 'test', '/', () => null);
  assert.equal((createResult as capability.TenantGroupsError).kind, 'NO_CREDENTIAL');

  const group: capability.TenantGroup = { id: '1', name: 'test', path: '/' };
  const updateResult = capability.updateGroup({ ...state, groups: [group] }, contextNoPerm, '1', 'new', '/', () => null);
  assert.equal((updateResult as capability.TenantGroupsError).kind, 'NO_CREDENTIAL');

  const deleteResult = capability.deleteGroup({ ...state, groups: [group] }, contextNoPerm, '1', () => null);
  assert.equal((deleteResult as capability.TenantGroupsError).kind, 'NO_CREDENTIAL');
});

test("tenantgroupsproof", () => {
  const state: capability.TenantGroupsState = { groups: [], readiness: 'INVARIANT_READY', lastError: null };
  const context: capability.TenantGroupsContext = {
    tenantCredential: { realm: 'test', adminAdapter: { listGroups: async () => [], createGroup: async () => ({ id: '1', name: 'test', path: '/' }), updateGroup: async () => ({ id: '1', name: 'test', path: '/' }), deleteGroup: async () => {} } },
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true }
  };

  const createResult = capability.createGroup(state, context, 'test', '/', () => null);
  assert.ok('groups' in (createResult as capability.TenantGroupsState));

  const group: capability.TenantGroup = { id: '1', name: 'test', path: '/' };
  const updateResult = capability.updateGroup({ ...state, groups: [group] }, context, '1', 'new', '/', () => null);
  assert.ok('groups' in (updateResult as capability.TenantGroupsState));

  const deleteResult = capability.deleteGroup({ ...state, groups: [group] }, context, '1', () => null);
  assert.ok('groups' in (deleteResult as capability.TenantGroupsState));

  assert.ok(capability.isValidGroupName('valid'));
  assert.ok(!capability.isValidGroupName('admin'));
});

test("tenantgroupsreadinessmodel", () => {
  const stateReady: capability.TenantGroupsState = { groups: [], readiness: 'INVARIANT_READY', lastError: null };
  const stateDegraded: capability.TenantGroupsState = { groups: [], readiness: 'DEGRADED', lastError: null };
  const contextWithCred: capability.TenantGroupsContext = {
    tenantCredential: { realm: 'test', adminAdapter: { listGroups: async () => [], createGroup: async () => ({ id: '1', name: 'test', path: '/' }), updateGroup: async () => ({ id: '1', name: 'test', path: '/' }), deleteGroup: async () => {} } },
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true }
  };
  const contextNoCred: capability.TenantGroupsContext = {
    tenantCredential: null,
    permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true }
  };

  assert.equal(capability.checkReadiness(stateReady, contextWithCred), 'INVARIANT_READY');
  assert.equal(capability.checkReadiness(stateDegraded, contextWithCred), 'DEGRADED');
  assert.equal(capability.checkReadiness(stateReady, contextNoCred), 'DEGRADED');

  const listResult = capability.listGroups(stateReady, contextNoCred);
  assert.equal((listResult as capability.TenantGroupsError).kind, 'NO_CREDENTIAL');
});

test("tenantgroupsstatemodel", () => {
  const group: capability.TenantGroup = { id: '1', name: 'test', path: '/' };
  const state: capability.TenantGroupsState = { groups: [group], readiness: 'INVARIANT_READY', lastError: null };

  assert.equal(group.id, '1');
  assert.equal(group.name, 'test');
  assert.equal(group.path, '/');

  assert.ok(!capability.isValidGroupName('admin'));
  assert.ok(!capability.isValidGroupName('users'));
  assert.ok(!capability.isValidGroupName('everyone'));
});

test("tenantgroupsvalidation", () => {
  assert.ok(capability.isValidGroupName('valid'));
  assert.ok(!capability.isValidGroupName(''));
  assert.ok(!capability.isValidGroupName('a'.repeat(65)));
  assert.ok(!capability.isValidGroupName('a/b'));
  assert.ok(!capability.isValidGroupName('a\\b'));
  assert.ok(!capability.isValidGroupName('a\x00b'));
  assert.ok(!capability.isValidGroupName('admin'));

  const groups: capability.TenantGroup[] = [{ id: '1', name: 'existing', path: '/' }];
  assert.ok(capability.checkNameConflict('existing', groups));
  assert.ok(capability.checkNameConflict('EXISTING', groups));
  assert.ok(!capability.checkNameConflict('new', groups));

  assert.equal(capability.validateGroupName('existing', groups), 'CONFLICT');
  assert.equal(capability.validateGroupName('admin', groups), 'INVALID_NAME');
  assert.equal(capability.validateGroupName('new', groups), 'OK');
});