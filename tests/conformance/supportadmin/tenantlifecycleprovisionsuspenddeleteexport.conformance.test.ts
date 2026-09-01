import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as capability from "../../../src/capabilities/supportadmin/tenantlifecycleprovisionsuspenddeleteexport.ts";

function unwrapState(result: capability.TenantLifecycleCoordinatorState | capability.TenantLifecycleError): capability.TenantLifecycleCoordinatorState {
  if ('kind' in result) {
    assert.fail(`Unexpected error: ${result.kind}`);
  }
  return result;
}

function unwrapError(result: capability.TenantLifecycleCoordinatorState | capability.TenantLifecycleError): capability.TenantLifecycleError {
  if (!('kind' in result)) {
    assert.fail('Expected an error result');
  }
  return result;
}

test("tenantlifecycleprovisionsuspenddeleteexportauditmodel", () => {
  const tenantId = 'tenant-auditmodel';
  const organisationId = 'org-auditmodel';

  const provisioned = unwrapState(
    capability.provisionTenant(
      capability.initialState,
      tenantId,
      organisationId,
      () => null,
    ),
  );
  assert.strictEqual(provisioned.lastAuditEvent?.kind, 'AUDIT_BEFORE_PROVISION');
  assert.strictEqual(provisioned.lastAuditEvent?.operation, 'PROVISION');

  const suspendTrace: string[] = [];
  const suspended = unwrapState(
    capability.suspendTenant(
      provisioned,
      tenantId,
      organisationId,
      (event) => {
        suspendTrace.push(`audit:${event.operation}`);
        return null;
      },
      (subsystem) => {
        suspendTrace.push(`subsystem:${subsystem}`);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(
    suspendTrace,
    ['audit:SUSPEND', 'subsystem:DATA', 'subsystem:STORAGE', 'subsystem:REALM', 'subsystem:DSR'],
  );
  assert.strictEqual(suspended.lastAuditEvent?.kind, 'AUDIT_BEFORE_SUSPEND');

  const exported = unwrapState(
    capability.exportTenant(
      suspended,
      tenantId,
      organisationId,
      (event) => {
        assert.strictEqual(event.kind, 'AUDIT_BEFORE_EXPORT');
        return null;
      },
    ),
  );
  assert.strictEqual(exported.lastAuditEvent?.kind, 'AUDIT_BEFORE_EXPORT');

  const deleteTrace: string[] = [];
  const deleted = unwrapState(
    capability.deleteTenant(
      exported,
      tenantId,
      organisationId,
      (event) => {
        deleteTrace.push(`audit:${event.operation}`);
        return null;
      },
      (subsystem) => {
        deleteTrace.push(`subsystem:${subsystem}`);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(
    deleteTrace,
    ['audit:DELETE', 'subsystem:STORAGE', 'subsystem:REALM', 'subsystem:DSR', 'subsystem:DATA'],
  );
  assert.strictEqual(deleted.lastAuditEvent?.kind, 'AUDIT_BEFORE_DELETE');
  assert.strictEqual(deleted.tenants.length, 0);
});

test("tenantlifecycleprovisionsuspenddeleteexportcontracts", () => {
  assert.strictEqual(capability.TenantLifecycleOperation.includes('IMPORT'), true);

  const tenantId = 'tenant-contracts';
  const organisationId = 'org-contracts';

  const provisioned = unwrapState(
    capability.provisionTenant(
      capability.initialState,
      tenantId,
      organisationId,
      () => null,
    ),
  );

  const suspendOrder: capability.TenantLifecycleSubsystem[] = [];
  const suspended = unwrapState(
    capability.suspendTenant(
      provisioned,
      tenantId,
      organisationId,
      () => null,
      (subsystem) => {
        suspendOrder.push(subsystem);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(suspendOrder, ['DATA', 'STORAGE', 'REALM', 'DSR']);

  const exported = unwrapState(
    capability.exportTenant(
      suspended,
      tenantId,
      organisationId,
      () => null,
    ),
  );
  assert.strictEqual(exported.lastAuditEvent?.operation, 'EXPORT');

  const deleteOrder: capability.TenantLifecycleSubsystem[] = [];
  const deleted = unwrapState(
    capability.deleteTenant(
      exported,
      tenantId,
      organisationId,
      () => null,
      (subsystem) => {
        deleteOrder.push(subsystem);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(deleteOrder, ['STORAGE', 'REALM', 'DSR', 'DATA']);
  assert.strictEqual(deleted.tenants.length, 0);
});

test("tenantlifecycleprovisionsuspenddeleteexporterrormodel", () => {
  const tenantId = 'tenant-errormodel';
  const organisationId = 'org-errormodel';

  const exported = unwrapState(
    capability.exportTenant(
      unwrapState(
        capability.provisionTenant(
          capability.initialState,
          tenantId,
          organisationId,
          () => null,
        ),
      ),
      tenantId,
      organisationId,
      () => null,
    ),
  );

  const calls: capability.TenantLifecycleSubsystem[] = [];
  const error = unwrapError(
    capability.deleteTenant(
      exported,
      tenantId,
      organisationId,
      () => null,
      (subsystem) => {
        calls.push(subsystem);
        if (subsystem === 'REALM') {
          return {
            kind: 'SUBSYSTEM_FAILURE',
            message: 'realm unavailable',
            subsystem: 'REALM',
          };
        }
        return null;
      },
    ),
  );

  assert.strictEqual(error.kind, 'DELETION_HALTED');
  assert.deepStrictEqual(calls, ['STORAGE', 'REALM']);
  assert.ok(exported.tenants.length === 1);
  assert.strictEqual(exported.tenants[0].tenantId, tenantId);
});

test("tenantlifecycleprovisionsuspenddeleteexportlifecycle", () => {
  const tenantId = 'tenant-lifecycle';
  const organisationId = 'org-lifecycle';

  const provisioned = unwrapState(
    capability.provisionTenant(
      capability.initialState,
      tenantId,
      organisationId,
      () => null,
    ),
  );
  assert.strictEqual(provisioned.tenants[0].state, 'ACTIVE');

  const suspendOrder: capability.TenantLifecycleSubsystem[] = [];
  const suspended = unwrapState(
    capability.suspendTenant(
      provisioned,
      tenantId,
      organisationId,
      () => null,
      (subsystem) => {
        suspendOrder.push(subsystem);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(suspendOrder, ['DATA', 'STORAGE', 'REALM', 'DSR']);
  assert.strictEqual(suspended.tenants[0].state, 'SUSPENDED');

  const exported = unwrapState(
    capability.exportTenant(
      suspended,
      tenantId,
      organisationId,
      () => null,
    ),
  );
  assert.strictEqual(exported.tenants[0].state, 'EXPORTED');

  const deleteOrder: capability.TenantLifecycleSubsystem[] = [];
  const deleted = unwrapState(
    capability.deleteTenant(
      exported,
      tenantId,
      organisationId,
      () => null,
      (subsystem) => {
        deleteOrder.push(subsystem);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(deleteOrder, ['STORAGE', 'REALM', 'DSR', 'DATA']);
  assert.strictEqual(deleted.tenants.length, 0);
});

test("tenantlifecycleprovisionsuspenddeleteexportpermissions", () => {
  const tenantId = 'tenant-permissions';
  const organisationId = 'org-permissions';

  const invalidAudits: capability.TenantLifecycleAuditEvent[] = [];
  const invalidAuditFn = (event: capability.TenantLifecycleAuditEvent): capability.TenantLifecycleError | null => {
    invalidAudits.push(event);
    return null;
  };

  const badTenant = unwrapError(
    capability.provisionTenant(
      capability.initialState,
      'tenant with spaces',
      organisationId,
      invalidAuditFn,
    ),
  );
  assert.strictEqual(badTenant.kind, 'INVALID_TENANT_ID');
  assert.strictEqual(invalidAudits.length, 0);

  const scopedAudits: capability.TenantLifecycleAuditEvent[] = [];
  const provisioned = unwrapState(
    capability.provisionTenant(
      capability.initialState,
      tenantId,
      organisationId,
      (event) => {
        scopedAudits.push(event);
        return null;
      },
    ),
  );
  assert.strictEqual(provisioned.lastAuditEvent?.organisationId, organisationId);
  assert.ok(!('actor' in (provisioned.lastAuditEvent ?? {})));

  const suspended = unwrapState(
    capability.suspendTenant(
      provisioned,
      tenantId,
      organisationId,
      (event) => {
        scopedAudits.push(event);
        return null;
      },
      () => null,
    ),
  );
  assert.strictEqual(suspended.lastAuditEvent?.organisationId, organisationId);

  const badOrgExport = unwrapError(
    capability.exportTenant(
      suspended,
      tenantId,
      'org with spaces',
      invalidAuditFn,
    ),
  );
  assert.strictEqual(badOrgExport.kind, 'INVALID_TENANT_ID');
  assert.strictEqual(invalidAudits.length, 0);

  const badOrgDelete = unwrapError(
    capability.deleteTenant(
      suspended,
      tenantId,
      'org with spaces',
      invalidAuditFn,
      () => null,
    ),
  );
  assert.strictEqual(badOrgDelete.kind, 'INVALID_TENANT_ID');
  assert.strictEqual(invalidAudits.length, 0);
});

test("tenantlifecycleprovisionsuspenddeleteexportproof", () => {
  const tenantId = 'tenant-proof';
  const organisationId = 'org-proof';

  const directAuditEvents: capability.TenantLifecycleAuditEvent[] = [];
  const directResult = capability.auditTenantLifecycleOperation(
    tenantId,
    organisationId,
    'PROVISION',
    (event) => {
      directAuditEvents.push(event);
      return null;
    },
  );
  assert.strictEqual(directResult, null);
  assert.strictEqual(directAuditEvents[0].kind, 'AUDIT_BEFORE_PROVISION');

  const provisioned = unwrapState(
    capability.provisionTenant(
      capability.initialState,
      tenantId,
      organisationId,
      () => null,
    ),
  );

  const suspendProof: string[] = [];
  const suspended = unwrapState(
    capability.suspendTenant(
      provisioned,
      tenantId,
      organisationId,
      (event) => {
        suspendProof.push(`audit:${event.operation}`);
        return null;
      },
      (subsystem) => {
        suspendProof.push(`subsystem:${subsystem}`);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(
    suspendProof,
    ['audit:SUSPEND', 'subsystem:DATA', 'subsystem:STORAGE', 'subsystem:REALM', 'subsystem:DSR'],
  );

  const exported = unwrapState(
    capability.exportTenant(
      suspended,
      tenantId,
      organisationId,
      () => null,
    ),
  );

  const deleteProof: string[] = [];
  const deleted = unwrapState(
    capability.deleteTenant(
      exported,
      tenantId,
      organisationId,
      (event) => {
        deleteProof.push(`audit:${event.operation}`);
        return null;
      },
      (subsystem) => {
        deleteProof.push(`subsystem:${subsystem}`);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(
    deleteProof,
    ['audit:DELETE', 'subsystem:STORAGE', 'subsystem:REALM', 'subsystem:DSR', 'subsystem:DATA'],
  );
  assert.strictEqual(deleted.tenants.length, 0);
});

test("tenantlifecycleprovisionsuspenddeleteexportreadinessmodel", () => {
  assert.strictEqual(capability.checkReadiness(capability.initialState), 'NOT_READY');

  const readyState: capability.TenantLifecycleCoordinatorState = {
    ...capability.initialState,
    readiness: 'READY',
    lastError: null,
  };
  assert.strictEqual(capability.checkReadiness(readyState), 'READY');

  const unavailableState: capability.TenantLifecycleCoordinatorState = {
    ...readyState,
    readiness: 'NOT_READY',
    lastError: {
      kind: 'SUBSYSTEM_FAILURE',
      message: 'substrate unavailable',
    },
  };
  assert.strictEqual(capability.checkReadiness(unavailableState), 'NOT_READY');

  const degradedState: capability.TenantLifecycleCoordinatorState = {
    ...readyState,
    lastError: {
      kind: 'DELETION_HALTED',
      message: 'proof degraded',
    },
  };
  assert.strictEqual(capability.checkReadiness(degradedState), 'DEGRADED');

  const operational = unwrapState(
    capability.provisionTenant(
      readyState,
      'tenant-readiness',
      'org-readiness',
      () => null,
    ),
  );
  assert.strictEqual(capability.checkReadiness(operational), 'READY');
});

test("tenantlifecycleprovisionsuspenddeleteexportstatemodel", () => {
  const tenantId = 'tenant-statemodel';
  const organisationId = 'org-statemodel';

  const provisioned = unwrapState(
    capability.provisionTenant(
      capability.initialState,
      tenantId,
      organisationId,
      () => null,
    ),
  );

  const suspendOrder: capability.TenantLifecycleSubsystem[] = [];
  const suspended = unwrapState(
    capability.suspendTenant(
      provisioned,
      tenantId,
      organisationId,
      () => null,
      (subsystem) => {
        suspendOrder.push(subsystem);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(suspendOrder, ['DATA', 'STORAGE', 'REALM', 'DSR']);
  assert.deepStrictEqual(suspended.tenants[0].suspendedSubsystems, ['DATA', 'STORAGE', 'REALM', 'DSR']);

  const exported = unwrapState(
    capability.exportTenant(
      suspended,
      tenantId,
      organisationId,
      () => null,
    ),
  );
  const metadata = exported.tenants[0].exportMetadata;
  assert.notEqual(metadata, null);
  assert.match(metadata.digest, /^export-digest-tenant-statemodel-\d+$/);
  assert.match(metadata.keyReference, /^export-key-tenant-statemodel-\d+$/);

  const deleteOrder: capability.TenantLifecycleSubsystem[] = [];
  const deleted = unwrapState(
    capability.deleteTenant(
      exported,
      tenantId,
      organisationId,
      () => null,
      (subsystem) => {
        deleteOrder.push(subsystem);
        return null;
      },
    ),
  );
  assert.deepStrictEqual(deleteOrder, ['STORAGE', 'REALM', 'DSR', 'DATA']);
  assert.strictEqual(deleted.tenants.length, 0);
});

test("tenantlifecycleprovisionsuspenddeleteexportvalidation", () => {
  const tenantId = 'tenant-validation';
  const organisationId = 'org-validation';

  const invalidAuditEvents: capability.TenantLifecycleAuditEvent[] = [];
  const invalidAuditFn = (event: capability.TenantLifecycleAuditEvent): capability.TenantLifecycleError | null => {
    invalidAuditEvents.push(event);
    return null;
  };

  const provisioned = unwrapState(
    capability.provisionTenant(
      capability.initialState,
      tenantId,
      organisationId,
      () => null,
    ),
  );

  const invalidSuspend = unwrapError(
    capability.suspendTenant(
      provisioned,
      'tenant with spaces',
      organisationId,
      invalidAuditFn,
      () => null,
    ),
  );
  assert.strictEqual(invalidSuspend.kind, 'INVALID_TENANT_ID');
  assert.strictEqual(invalidAuditEvents.length, 0);

  const invalidDeleteBeforeExport = unwrapError(
    capability.deleteTenant(
      provisioned,
      tenantId,
      organisationId,
      (event) => {
        invalidAuditEvents.push(event);
        return null;
      },
      () => {
        assert.fail('Delete must not reach subsystems before export');
      },
    ),
  );
  assert.strictEqual(invalidDeleteBeforeExport.kind, 'EXPORT_FAILURE');
  assert.strictEqual(invalidAuditEvents.at(-1)?.kind, 'AUDIT_BEFORE_DELETE');
  assert.strictEqual(provisioned.tenants.length, 1);
});