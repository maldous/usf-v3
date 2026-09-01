import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/identityaccess/suborganisations.ts";

test("suborganisationsauditmodel", () => {
  // Test create audit emission
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
  
  assert.ok(auditEvents.length > 0);
  if (auditEvents.length > 0) {
    assert.equal(auditEvents[0].kind, 'SUBORG_CREATED');
    assert.equal(auditEvents[0].resource, 'suborganisation');
    assert.equal(auditEvents[0].subOrgId, 'valid-slug');
  }

  // Test audit failure aborts create
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

  // Test update audit emission
  auditEvents = [];
  const updateResult = capability.updateSubOrganisation(
    [], 
    'tenant1', 
    'valid-slug', 
    'Updated Valid Org', 
    auditFn
  );
  assert.ok(updateResult !== null);
  if (updateResult) {
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].kind, 'SUBORG_UPDATED');
  }

  // Test deactivate audit emission
  auditEvents = [];
  const deactivateResult = capability.deactivateSubOrganisation(
    [], 
    'tenant1', 
    'valid-slug', 
    auditFn
  );
  assert.ok(deactivateResult !== null);
  if (deactivateResult) {
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].kind, 'SUBORG_DEACTIVATED');
  }

  // Test list is not audited
  const listResult = capability.listSubOrganisations([], 'tenant1');
  assert.equal(auditEvents.length, 0);
});

test("suborganisationserrormodel", () => {
  // Verify error kinds are defined
  const errorKind: capability.SubOrganisationsErrorKind = 'invalid-body';
  const conflictKind: capability.SubOrganisationsErrorKind = 'conflict';
  const notFoundKind: capability.SubOrganisationsErrorKind = 'not-found';
  const okKind: capability.SubOrganisationsErrorKind = 'ok';
  
  assert.strictEqual(errorKind, 'invalid-body');
  assert.strictEqual(conflictKind, 'conflict');
  assert.strictEqual(notFoundKind, 'not-found');
  assert.strictEqual(okKind, 'ok');

  // Verify SubOrgState type
  const state: capability.SubOrgState[] = [];
  assert.typeOf(state, 'readonly SubOrgState[]');
});

test("suborganisationsreadinessmodel", () => {
  // Test checkReadiness returns READY when table available
  const readyResult = capability.checkReadiness(true);
  assert.equal(readyResult, 'READY');
  
  // Test checkReadiness returns NOT_READY when table unavailable
  const notReadyResult = capability.checkReadiness(false);
  assert.equal(notReadyResult, 'NOT_READY');
});

test("suborganisationsstatemodel", () => {
  // Verify SubOrgState structure
  const state: capability.SubOrgState = [
    {
      id: 'org1',
      parentId: 'tenant1',
      slug: 'team-a',
      displayName: 'Team A',
      active: true,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ];
  
  assert.typeOf(state, 'SubOrgState');
  assert.strictEqual(state[0].id, 'org1');
  assert.strictEqual(state[0].parentId, 'tenant1');
  assert.strictEqual(state[0].slug, 'team-a');
  assert.strictEqual(state[0].displayName, 'Team A');
  assert.strictEqual(state[0].active, true);
  assert.strictEqual(state[0].createdAt, '2024-01-01T00:00:00Z');
  assert.strictEqual(state[0].updatedAt, '2024-01-02T00:00:00Z');
});

test("suborganisationsvalidation", () => {
  // Test validateSlug accepts valid lowercase slug
  const validSlug = 'my-org';
  const validResult = capability.validateSlug(validSlug);
  assert.strictEqual(validResult?.kind, undefined);
  assert.strictEqual(validResult?.message, undefined);

  // Test validateSlug rejects non-string
  const nonStringResult = capability.validateSlug(123);
  assert.equal(nonStringResult?.kind, 'invalid-body');

  // Test validateSlug rejects too short
  const shortResult = capability.validateSlug('ab');
  assert.equal(shortResult?.kind, 'invalid-body');

  // Test validateSlug rejects too long
  const longResult = capability.validateSlug('a'.repeat(31));
  assert.equal(longResult?.kind, 'invalid-body');

  // Test validateSlug rejects uppercase
  const upperResult = capability.validateSlug('MyOrg');
  assert.equal(upperResult?.kind, 'invalid-body');

  // Test validateSlug rejects edge hyphens
  const hyphenResult = capability.validateSlug('a-');
  assert.equal(hyphenResult?.kind, 'invalid-body');

  // Test validateDisplayName accepts valid name
  const validName = 'Good Name';
  const nameResult = capability.validateDisplayName(validName);
  assert.strictEqual(nameResult?.kind, undefined);
  assert.strictEqual(nameResult?.message, undefined);

  // Test validateDisplayName rejects empty
  const emptyResult = capability.validateDisplayName('');
  assert.equal(emptyResult?.kind, 'invalid-body');

  // Test validateDisplayName rejects too short
  const shortName = 'A';
  const shortNameResult = capability.validateDisplayName(shortName);
  assert.equal(shortNameResult?.kind, 'invalid-body');

  // Test validateDisplayName rejects too long
  const longName = 'x'.repeat(101);
  const longNameResult = capability.validateDisplayName(longName);
  assert.equal(longNameResult?.kind, 'invalid-body');
});