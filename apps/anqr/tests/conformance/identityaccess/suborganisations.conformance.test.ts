import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/suborganisations.ts";

test("suborganisationsauditmodel", () => {
  const state: capability.SubOrgState = [];
  const tenantId = 'tenant1';

  // Test create audit
  let auditEvents: capability.SubOrgAuditEvent[] = [];
  const auditFn: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = (event) => {
    auditEvents.push(event);
    return null;
  };

  const createResult = capability.createSubOrganisation(state, tenantId, 'test-slug', 'Test Org', auditFn);
  assert.notEqual(createResult, null);
  if (Array.isArray(createResult)) {
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].kind, 'SUBORG_CREATED');
    assert.equal(auditEvents[0].resource, 'suborganisation');
    assert.equal(auditEvents[0].subOrgId, 'test-slug');
  } else {
    assert.fail('Create should succeed');
  }

  // Test audit failure aborts create
  const failingAuditFn: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = () => ({
    kind: 'invalid-body',
    message: 'Audit failed'
  });

  const failCreateResult = capability.createSubOrganisation(state, tenantId, 'test-slug2', 'Test Org 2', failingAuditFn);
  assert.notEqual(failCreateResult, null);
  assert.equal(failCreateResult.kind, 'invalid-body');

  // Test update audit
  auditEvents = [];
  const newState = Array.isArray(createResult) ? createResult : state;
  const updateResult = capability.updateSubOrganisation(newState, tenantId, 'test-slug', 'Updated Org', auditFn);
  assert.notEqual(updateResult, null);
  if (Array.isArray(updateResult)) {
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].kind, 'SUBORG_UPDATED');
  } else {
    assert.fail('Update should succeed');
  }

  // Test deactivate audit
  auditEvents = [];
  const deactivateResult = capability.deactivateSubOrganisation(newState, tenantId, 'test-slug', auditFn);
  assert.notEqual(deactivateResult, null);
  if (Array.isArray(deactivateResult)) {
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].kind, 'SUBORG_DEACTIVATED');
  } else {
    assert.fail('Deactivate should succeed');
  }

  // Test list is not audited
  const listResult = capability.listSubOrganisations(newState, tenantId);
  assert.equal(auditEvents.length, 1); // Should remain unchanged from deactivate
});