import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as capability from "../../../src/capabilities/configuration/tenantdomainactivationauthclient.ts";

type ActivateResult = ReturnType<typeof capability.activate>;
type DeactivateResult = ReturnType<typeof capability.deactivate>;
type CapabilityResult = ActivateResult | DeactivateResult;

function isErrorResult(
  result: CapabilityResult,
): result is capability.TenantDomainActivationAuthClientError {
  return typeof result === 'object' && result !== null && 'kind' in result;
}

function assertOkResult(
  result: CapabilityResult,
): asserts result is { readonly outcome: 'OK'; readonly state: capability.TenantDomainActivationAuthClientState } {
  if (isErrorResult(result)) {
    assert.fail(`expected OK outcome, got error ${result.kind}`);
  }
  assert.equal(result.outcome, 'OK');
}

function assertOutcomeResult(
  result: CapabilityResult,
  expected: Exclude<capability.TenantDomainActivationAuthClientOutcome, 'OK'>,
): asserts result is { readonly outcome: typeof expected } {
  if (isErrorResult(result)) {
    assert.fail(`expected ${expected}, got error ${result.kind}`);
  }
  assert.equal(result.outcome, expected);
}

test("tenantdomainactivationauthclientauditmodel", () => {
  const domain = 'audit.example.com';
  const tenantId = 'tenant-audit';

  let sequence: string[] = [];
  let recorded: capability.TenantDomainActivationAuthClientAuditEvent | null = null;
  const activationAuditFn = (
    event: capability.TenantDomainActivationAuthClientAuditEvent,
  ): capability.TenantDomainActivationAuthClientError | null => {
    sequence.push(`audit:${event.kind}`);
    recorded = event;
    return null;
  };

  const activationPort: capability.AuthClientPort = {
    addRedirectOrigin: (d: string): Promise<void> => {
      sequence.push(`port:add:${d}`);
      throw new Error('provider failed');
    },
    removeRedirectOrigin: async () => {
      sequence.push('port:remove:unexpected');
    },
  };

  const activateRequest: capability.ActivateRequest = {
    domain,
    tenantId,
    verified: true,
    permission: 'DOMAIN_WRITE',
  };

  const activationResult = capability.activate(capability.initialState, activateRequest, activationAuditFn, activationPort);
  assertOutcomeResult(activationResult, 'NOT_VERIFIED');
  assert.deepEqual(sequence, [`audit:AUTH_CLIENT_ACTIVATED`, `port:add:${domain}`]);
  assert.notEqual(recorded, null);
  assert.equal(recorded!.kind, 'AUTH_CLIENT_ACTIVATED');
  assert.equal(recorded!.domain, domain);
  assert.equal(recorded!.tenantId, tenantId);
  assert.deepEqual(Object.keys(recorded!).sort(), ['domain', 'kind', 'tenantId', 'timestamp'].sort());

  sequence = [];
  recorded = null;

  const deactivationPort: capability.AuthClientPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: (d: string): Promise<void> => {
      sequence.push(`port:remove:${d}`);
      throw new Error('provider failed');
    },
  };

  const activeState: capability.TenantDomainActivationAuthClientState = {
    ...capability.initialState,
    authClientStatus: 'ACTIVE',
    activationTimestamp: '2025-01-01T00:00:00.000Z',
    canonical: true,
    routingStatus: true,
    disabled: false,
  };

  const deactivateRequest: capability.DeactivateRequest = {
    domain,
    tenantId,
    permission: 'DOMAIN_WRITE',
  };

  const deactivationResult = capability.deactivate(activeState, deactivateRequest, activationAuditFn, deactivationPort);
  assertOutcomeResult(deactivationResult, 'NOT_ACTIVE');
  assert.deepEqual(sequence, [`audit:AUTH_CLIENT_DEACTIVATED`, `port:remove:${domain}`]);
  assert.notEqual(recorded, null);
  assert.equal(recorded!.kind, 'AUTH_CLIENT_DEACTIVATED');
  assert.equal(recorded!.domain, domain);
  assert.equal(recorded!.tenantId, tenantId);
});

test("tenantdomainactivationauthclientcontracts", () => {
  const providerCalls: string[] = [];
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async (d: string): Promise<void> => {
      providerCalls.push(`add:${d}`);
    },
    removeRedirectOrigin: async (d: string): Promise<void> => {
      providerCalls.push(`remove:${d}`);
    },
  };

  const events: capability.TenantDomainActivationAuthClientAuditEvent[] = [];
  const auditFn = (
    event: capability.TenantDomainActivationAuthClientAuditEvent,
  ): capability.TenantDomainActivationAuthClientError | null => {
    events.push(event);
    return null;
  };

  const domain = 'contract.example.com';
  const tenantId = 'tenant-contract';
  const activateRequest: capability.ActivateRequest = {
    domain,
    tenantId,
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  const deactivateRequest: capability.DeactivateRequest = {
    domain,
    tenantId,
    permission: 'DOMAIN_WRITE',
  };

  assert.equal(capability.validateActivateRequest(capability.initialState, activateRequest), 'OK');
  const activateResult = capability.activate(capability.initialState, activateRequest, auditFn, port);
  assertOkResult(activateResult);
  assert.equal(activateResult.state.authClientStatus, 'ACTIVE');

  assert.equal(capability.validateDeactivateRequest(activateResult.state, deactivateRequest), 'OK');
  const deactivateResult = capability.deactivate(activateResult.state, deactivateRequest, auditFn, port);
  assertOkResult(deactivateResult);
  assert.equal(deactivateResult.state.authClientStatus, 'INACTIVE');

  assert.deepEqual(providerCalls, [`add:${domain}`, `remove:${domain}`]);
  assert.equal(events[0]!.kind, 'AUTH_CLIENT_ACTIVATED');
  assert.equal(events[1]!.kind, 'AUTH_CLIENT_DEACTIVATED');

  const adapterCalls: string[] = [];
  const adapterPort: capability.AuthClientPort = {
    addRedirectOrigin: async (d: string): Promise<void> => {
      adapterCalls.push(`adapter-add:${d}`);
    },
    removeRedirectOrigin: async (d: string): Promise<void> => {
      adapterCalls.push(`adapter-remove:${d}`);
    },
  };

  const adapterActivateRequest: capability.ActivateRequest = {
    domain: 'contract-adapter.example.com',
    tenantId,
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  const adapterDeactivateRequest: capability.DeactivateRequest = {
    domain: 'contract-adapter.example.com',
    tenantId,
    permission: 'DOMAIN_WRITE',
  };

  const adapterActivateResult = capability.activate(
    capability.initialState,
    adapterActivateRequest,
    auditFn,
    adapterPort,
  );
  assertOkResult(adapterActivateResult);
  const adapterDeactivateResult = capability.deactivate(
    adapterActivateResult.state,
    adapterDeactivateRequest,
    auditFn,
    adapterPort,
  );
  assertOkResult(adapterDeactivateResult);

  assert.deepEqual(
    adapterCalls,
    [`adapter-add:contract-adapter.example.com`, `adapter-remove:contract-adapter.example.com`],
  );
});

test("tenantdomainactivationauthclienterrormodel", () => {
  const auditFn = (_event: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => null;
  const failingPort: capability.AuthClientPort = {
    addRedirectOrigin: (): Promise<void> => {
      throw new Error('add failed');
    },
    removeRedirectOrigin: (): Promise<void> => {
      throw new Error('remove failed');
    },
  };

  const missingPermission = capability.activate(
    capability.initialState,
    {
      domain: 'error.example.com',
      tenantId: 'tenant-error',
      verified: true,
      permission: 'INVALID_PERMISSION' as capability.TenantDomainActivationAuthClientPermission,
    },
    auditFn,
    failingPort,
  );
  assertOutcomeResult(missingPermission, 'NOT_FOUND');

  const notVerified = capability.activate(
    capability.initialState,
    {
      domain: 'error.example.com',
      tenantId: 'tenant-error',
      verified: false,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    failingPort,
  );
  assertOutcomeResult(notVerified, 'NOT_VERIFIED');

  const alreadyActive = capability.activate(
    {
      ...capability.initialState,
      authClientStatus: 'ACTIVE',
      activationTimestamp: '2025-01-01T00:00:00.000Z',
      canonical: true,
      routingStatus: false,
      disabled: false,
    },
    {
      domain: 'error.example.com',
      tenantId: 'tenant-error',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    failingPort,
  );
  assertOutcomeResult(alreadyActive, 'ALREADY_ACTIVE');

  const deactivateMissingPermission = capability.deactivate(
    capability.initialState,
    {
      domain: 'error.example.com',
      tenantId: 'tenant-error',
      permission: 'INVALID_PERMISSION' as capability.TenantDomainActivationAuthClientPermission,
    },
    auditFn,
    failingPort,
  );
  assertOutcomeResult(deactivateMissingPermission, 'NOT_FOUND');

  const notActive = capability.deactivate(
    capability.initialState,
    {
      domain: 'error.example.com',
      tenantId: 'tenant-error',
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    failingPort,
  );
  assertOutcomeResult(notActive, 'NOT_ACTIVE');

  const portThrow = capability.activate(
    capability.initialState,
    {
      domain: 'error.example.com',
      tenantId: 'tenant-error',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    failingPort,
  );
  assertOutcomeResult(portThrow, 'NOT_VERIFIED');
});

test("tenantdomainactivationauthclientlifecycle", () => {
  const domain = 'lifecycle.example.com';
  const tenantId = 'tenant-lifecycle';

  const portMutations: string[] = [];
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async (d: string): Promise<void> => {
      portMutations.push(`add:${d}`);
    },
    removeRedirectOrigin: async (d: string): Promise<void> => {
      portMutations.push(`remove:${d}`);
    },
  };

  const eventKinds: string[] = [];
  const auditFn = (
    event: capability.TenantDomainActivationAuthClientAuditEvent,
  ): capability.TenantDomainActivationAuthClientError | null => {
    eventKinds.push(event.kind);
    return null;
  };

  const blockedActivate = capability.activate(
    capability.initialState,
    {
      domain,
      tenantId,
      verified: false,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    port,
  );
  assertOutcomeResult(blockedActivate, 'NOT_VERIFIED');
  assert.equal(portMutations.length, 0);

  const activateResult = capability.activate(
    capability.initialState,
    {
      domain,
      tenantId,
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    port,
  );
  assertOkResult(activateResult);
  assert.equal(eventKinds[0], 'AUTH_CLIENT_ACTIVATED');
  assert.equal(portMutations[0], `add:${domain}`);
  assert.equal(activateResult.state.authClientStatus, 'ACTIVE');
  assert.equal(activateResult.state.canonical, true);
  assert.equal(activateResult.state.routingStatus, false);
  assert.equal(activateResult.state.disabled, false);
  assert.notEqual(activateResult.state.activationTimestamp, null);

  const deactivateResult = capability.deactivate(
    activateResult.state,
    {
      domain,
      tenantId,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    port,
  );
  assertOkResult(deactivateResult);
  assert.equal(eventKinds[eventKinds.length - 1], 'AUTH_CLIENT_DEACTIVATED');
  assert.equal(portMutations[portMutations.length - 1], `remove:${domain}`);
  assert.equal(deactivateResult.state.authClientStatus, 'INACTIVE');
  assert.equal(deactivateResult.state.activationTimestamp, null);
  assert.equal(deactivateResult.state.canonical, false);
  assert.equal(deactivateResult.state.routingStatus, false);
});

test("tenantdomainactivationauthclientpermissions", () => {
  const invalidPermissionActivate = capability.activate(
    capability.initialState,
    {
      domain: 'permissions.example.com',
      tenantId: 'tenant-permissions',
      verified: true,
      permission: 'INVALID_PERMISSION' as capability.TenantDomainActivationAuthClientPermission,
    },
    () => null,
    {
      addRedirectOrigin: async () => {},
      removeRedirectOrigin: async () => {},
    },
  );
  assertOutcomeResult(invalidPermissionActivate, 'NOT_FOUND');

  const invalidPermissionDeactivate = capability.deactivate(
    capability.initialState,
    {
      domain: 'permissions.example.com',
      tenantId: 'tenant-permissions',
      permission: 'INVALID_PERMISSION' as capability.TenantDomainActivationAuthClientPermission,
    },
    () => null,
    {
      addRedirectOrigin: async () => {},
      removeRedirectOrigin: async () => {},
    },
  );
  assertOutcomeResult(invalidPermissionDeactivate, 'NOT_FOUND');

  const auditedTenants: string[] = [];
  const tenantAwareAuditFn = (
    event: capability.TenantDomainActivationAuthClientAuditEvent,
  ): capability.TenantDomainActivationAuthClientError | null => {
    auditedTenants.push(event.tenantId);
    return null;
  };

  const tenantAPortState = capability.initialState;
  const tenantBPortState = capability.initialState;

  const tenantA = capability.activate(
    tenantAPortState,
    {
      domain: 'tenant-a.example.com',
      tenantId: 'tenant-a',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    tenantAwareAuditFn,
    {
      addRedirectOrigin: async () => {},
      removeRedirectOrigin: async () => {},
    },
  );
  assertOkResult(tenantA);

  const tenantB = capability.activate(
    tenantBPortState,
    {
      domain: 'tenant-b.example.com',
      tenantId: 'tenant-b',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    tenantAwareAuditFn,
    {
      addRedirectOrigin: async () => {},
      removeRedirectOrigin: async () => {},
    },
  );
  assertOkResult(tenantB);

  assert.deepEqual(auditedTenants, ['tenant-a', 'tenant-b']);
});

test("tenantdomainactivationauthclientproof", () => {
  const domain = 'proof.example.com';
  const tenantId = 'tenant-proof';

  assert.equal(
    capability.validateActivateRequest(
      capability.initialState,
      {
        domain,
        tenantId,
        verified: false,
        permission: 'DOMAIN_WRITE',
      },
    ),
    'NOT_VERIFIED',
  );
  assert.equal(
    capability.validateActivateRequest(
      {
        ...capability.initialState,
        authClientStatus: 'ACTIVE',
        activationTimestamp: '2025-01-01T00:00:00.000Z',
        canonical: true,
        routingStatus: false,
        disabled: false,
      },
      {
        domain,
        tenantId,
        verified: true,
        permission: 'DOMAIN_WRITE',
      },
    ),
    'ALREADY_ACTIVE',
  );
  assert.equal(
    capability.validateDeactivateRequest(
      capability.initialState,
      {
        domain,
        tenantId,
        permission: 'DOMAIN_WRITE',
      },
    ),
    'NOT_ACTIVE',
  );

  const externalMutations: string[] = [];
  const auditKind: string[] = [];
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async (d: string): Promise<void> => {
      externalMutations.push(`add:${d}`);
    },
    removeRedirectOrigin: async (d: string): Promise<void> => {
      externalMutations.push(`remove:${d}`);
    },
  };
  const auditFn = (
    event: capability.TenantDomainActivationAuthClientAuditEvent,
  ): capability.TenantDomainActivationAuthClientError | null => {
    auditKind.push(event.kind);
    return null;
  };

  const activateRequest: capability.ActivateRequest = {
    domain,
    tenantId,
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  const activateResult = capability.activate(capability.initialState, activateRequest, auditFn, port);
  assertOkResult(activateResult);
  assert.equal(auditKind[0], 'AUTH_CLIENT_ACTIVATED');
  assert.equal(externalMutations[0], `add:${domain}`);
  assert.equal(activateResult.state.canonical, true);

  const deactivateRequest: capability.DeactivateRequest = {
    domain,
    tenantId,
    permission: 'DOMAIN_WRITE',
  };
  const deactivateResult = capability.deactivate(activateResult.state, deactivateRequest, auditFn, port);
  assertOkResult(deactivateResult);
  assert.equal(auditKind[1], 'AUTH_CLIENT_DEACTIVATED');
  assert.equal(externalMutations[1], `remove:${domain}`);
  assert.equal(deactivateResult.state.canonical, false);
});

test("tenantdomainactivationauthclientreadinessmodel", () => {
  const activeState: capability.TenantDomainActivationAuthClientState = {
    authClientStatus: 'ACTIVE',
    activationTimestamp: '2025-01-01T00:00:00.000Z',
    canonical: true,
    routingStatus: false,
    disabled: true,
  };

  const inactiveState = capability.initialState;

  assert.equal(capability.getReadiness(activeState), 'READY');
  assert.equal(capability.getReadiness(inactiveState), 'DEGRADED');

  const blockedActivationResult = capability.activate(
    capability.initialState,
    {
      domain: 'readiness.example.com',
      tenantId: 'tenant-readiness',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    () => null,
    {
      addRedirectOrigin: (): Promise<void> => {
        throw new Error('provider blocked');
      },
      removeRedirectOrigin: async () => {},
    },
  );
  assertOutcomeResult(blockedActivationResult, 'NOT_VERIFIED');
  assert.equal(capability.getReadiness(capability.initialState), 'DEGRADED');
});

test("tenantdomainactivationauthclientstatemodel", () => {
  assert.deepEqual(capability.initialState, {
    authClientStatus: 'INACTIVE',
    activationTimestamp: null,
    canonical: false,
    routingStatus: false,
    disabled: false,
  });

  const activateResult = capability.activate(
    capability.initialState,
    {
      domain: 'state.example.com',
      tenantId: 'tenant-state',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    () => null,
    {
      addRedirectOrigin: async () => {},
      removeRedirectOrigin: async () => {},
    },
  );
  assertOkResult(activateResult);
  assert.equal(activateResult.state.authClientStatus, 'ACTIVE');
  assert.equal(activateResult.state.canonical, true);
  assert.equal(activateResult.state.routingStatus, false);
  assert.equal(activateResult.state.disabled, false);
  assert.notEqual(activateResult.state.activationTimestamp, null);

  const deactivateResult = capability.deactivate(
    activateResult.state,
    {
      domain: 'state.example.com',
      tenantId: 'tenant-state',
      permission: 'DOMAIN_WRITE',
    },
    () => null,
    {
      addRedirectOrigin: async () => {},
      removeRedirectOrigin: async () => {},
    },
  );
  assertOkResult(deactivateResult);
  assert.equal(deactivateResult.state.authClientStatus, 'INACTIVE');
  assert.equal(deactivateResult.state.activationTimestamp, null);
  assert.equal(deactivateResult.state.canonical, false);
  assert.equal(deactivateResult.state.routingStatus, false);
  assert.equal(deactivateResult.state.disabled, false);

  const failedActivate = capability.activate(
    capability.initialState,
    {
      domain: 'state.example.com',
      tenantId: 'tenant-state',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    () => null,
    {
      addRedirectOrigin: (): Promise<void> => {
        throw new Error('port down');
      },
      removeRedirectOrigin: async () => {},
    },
  );
  assertOutcomeResult(failedActivate, 'NOT_VERIFIED');
});

test("tenantdomainactivationauthclientvalidation", () => {
  let auditCalls = 0;
  let addCalls = 0;
  let removeCalls = 0;

  const port: capability.AuthClientPort = {
    addRedirectOrigin: async (): Promise<void> => {
      addCalls += 1;
    },
    removeRedirectOrigin: async (): Promise<void> => {
      removeCalls += 1;
    },
  };

  const auditFn = (
    _event: capability.TenantDomainActivationAuthClientAuditEvent,
  ): capability.TenantDomainActivationAuthClientError | null => {
    auditCalls += 1;
    return null;
  };

  const alreadyActive = capability.activate(
    {
      ...capability.initialState,
      authClientStatus: 'ACTIVE',
      activationTimestamp: '2025-01-01T00:00:00.000Z',
      canonical: true,
      routingStatus: false,
      disabled: false,
    },
    {
      domain: 'validation.example.com',
      tenantId: 'tenant-validation',
      verified: true,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    port,
  );
  assertOutcomeResult(alreadyActive, 'ALREADY_ACTIVE');
  assert.equal(auditCalls, 0);
  assert.equal(addCalls, 0);
  assert.equal(removeCalls, 0);

  const notVerified = capability.activate(
    capability.initialState,
    {
      domain: 'validation.example.com',
      tenantId: 'tenant-validation',
      verified: false,
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    port,
  );
  assertOutcomeResult(notVerified, 'NOT_VERIFIED');
  assert.equal(auditCalls, 0);
  assert.equal(addCalls, 0);
  assert.equal(removeCalls, 0);

  const activateNotFound = capability.activate(
    capability.initialState,
    {
      domain: 'validation.example.com',
      tenantId: 'tenant-validation',
      verified: true,
      permission: 'INVALID_PERMISSION' as capability.TenantDomainActivationAuthClientPermission,
    },
    auditFn,
    port,
  );
  assertOutcomeResult(activateNotFound, 'NOT_FOUND');
  assert.equal(auditCalls, 0);
  assert.equal(addCalls, 0);
  assert.equal(removeCalls, 0);

  const deactivateNotFound = capability.deactivate(
    capability.initialState,
    {
      domain: 'validation.example.com',
      tenantId: 'tenant-validation',
      permission: 'INVALID_PERMISSION' as capability.TenantDomainActivationAuthClientPermission,
    },
    auditFn,
    port,
  );
  assertOutcomeResult(deactivateNotFound, 'NOT_FOUND');
  assert.equal(auditCalls, 0);
  assert.equal(addCalls, 0);
  assert.equal(removeCalls, 0);

  const deactivateNotActive = capability.deactivate(
    capability.initialState,
    {
      domain: 'validation.example.com',
      tenantId: 'tenant-validation',
      permission: 'DOMAIN_WRITE',
    },
    auditFn,
    port,
  );
  assertOutcomeResult(deactivateNotActive, 'NOT_ACTIVE');
  assert.equal(auditCalls, 0);
  assert.equal(addCalls, 0);
  assert.equal(removeCalls, 0);
});