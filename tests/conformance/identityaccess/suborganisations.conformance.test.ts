import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/suborganisations.ts";

test("suborganisationsauditmodel", () => {
  let auditEvents: capability.SubOrgAuditEvent[] = [];
  const auditFn: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = (event) => {
    auditEvents.push(event);
    return null;
  };

  const createResult = capability.createSubOrganisation(
    [],
    'tenant1',
    'valid-slug',
    'Valid Org',
    auditFn
  );
  assert.ok(!('kind' in createResult));
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].kind, 'SUBORG_CREATED');
  assert.equal(auditEvents[0].resource, 'suborganisation');
  assert.equal(auditEvents[0].subOrgId, 'valid-slug');

  const failingAuditFn: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = () => ({
    kind: 'invalid-body',
    message: 'Validation failed'
  });

  const failCreateResult = capability.createSubOrganisation(
    [],
    'tenant1',
    'another-slug',
    'Another Org',
    failingAuditFn
  );
  assert.equal(failCreateResult.kind, 'invalid-body');

  auditEvents = [];
  const state: capability.SubOrgState = [
    {
      id: 'org1',
      parentId: 'tenant1',
      slug: 'valid-slug',
      displayName: 'Valid Org',
      active: true,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ];
  const updateResult = capability.updateSubOrganisation(
    state,
    'tenant1',
    'valid-slug',
    'Updated Valid Org',
    auditFn
  );
  assert.ok(!('kind' in updateResult));
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].kind, 'SUBORG_UPDATED');

  auditEvents = [];
  const deactivateResult = capability.deactivateSubOrganisation(
    state,
    'tenant1',
    'valid-slug',
    auditFn
  );
  assert.ok(!('kind' in deactivateResult));
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].kind, 'SUBORG_DEACTIVATED');

  const listResult = capability.listSubOrganisations(state, 'tenant1');
  assert.equal(auditEvents.length, 1);
});