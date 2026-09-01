import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/configuration/tenantdomainactivationauthclient.ts";

test("tenantdomainactivationauthclientauditmodel", () => {
  const request: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  let capturedEvent: capability.TenantDomainActivationAuthClientAuditEvent | null = null;
  const auditFn = (event: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => {
    capturedEvent = event;
    return null;
  };
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: async () => {},
  };

  const state = capability.initialState;
  const result = capability.activate(state, request, auditFn, port);
  assert.deepEqual(result, { outcome: 'OK', state: {
    authClientStatus: 'ACTIVE',
    activationTimestamp: capturedEvent!.timestamp,
    canonical: true,
    routingStatus: false,
    disabled: false,
  } });
  assert.equal(capturedEvent!.kind, 'AUTH_CLIENT_ACTIVATED');
  assert.equal(capturedEvent!.domain, 'example.com');
  assert.equal(capturedEvent!.tenantId, 'tenant-123');
});

test("tenantdomainactivationauthclientcontracts", () => {
  const activateRequest: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  const deactivateRequest: capability.DeactivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    permission: 'DOMAIN_WRITE',
  };
  const auditFn = (_: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => null;
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: async () => {},
  };

  const state = capability.initialState;
  const activateResult = capability.activate(state, activateRequest, auditFn, port);
  assert.equal(activateResult.outcome, 'OK');

  const deactivateResult = capability.deactivate(activateResult.state, deactivateRequest, auditFn, port);
  assert.equal(deactivateResult.outcome, 'OK');
});

test("tenantdomainactivationauthclienterrormodel", () => {
  const request: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: false,
    permission: 'DOMAIN_WRITE',
  };
  const auditFn = (_: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => null;
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async () => { throw new Error('Port error'); },
    removeRedirectOrigin: async () => {},
  };

  const state = capability.initialState;
  const result = capability.activate(state, request, auditFn, port);
  assert.equal(result.outcome, 'NOT_VERIFIED');

  const validRequest: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  const portErrorResult = capability.activate(state, validRequest, auditFn, port);
  assert.equal(portErrorResult.outcome, 'NOT_VERIFIED');
});

test("tenantdomainactivationauthclientlifecycle", () => {
  const activateRequest: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  const deactivateRequest: capability.DeactivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    permission: 'DOMAIN_WRITE',
  };
  const auditFn = (_: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => null;
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: async () => {},
  };

  const initialState = capability.initialState;
  const activateResult = capability.activate(initialState, activateRequest, auditFn, port);
  assert.equal(activateResult.outcome, 'OK');
  assert.equal(activateResult.state.authClientStatus, 'ACTIVE');
  assert.notEqual(activateResult.state.activationTimestamp, null);

  const deactivateResult = capability.deactivate(activateResult.state, deactivateRequest, auditFn, port);
  assert.equal(deactivateResult.outcome, 'OK');
  assert.equal(deactivateResult.state.authClientStatus, 'INACTIVE');
  assert.equal(deactivateResult.state.activationTimestamp, null);
  assert.equal(deactivateResult.state.canonical, false);
  assert.equal(deactivateResult.state.routingStatus, false);
});

test("tenantdomainactivationauthclientpermissions", () => {
  const invalidRequest: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: true,
    permission: 'DOMAIN_WRITE' as capability.TenantDomainActivationAuthClientPermission,
  };
  // @ts-expect-error - intentionally wrong permission
  invalidRequest.permission = 'INVALID' as capability.TenantDomainActivationAuthClientPermission;

  const auditFn = (_: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => null;
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: async () => {},
  };

  const state = capability.initialState;
  const result = capability.activate(state, invalidRequest, auditFn, port);
  assert.equal(result.outcome, 'NOT_FOUND');

  const deactivateRequest: capability.DeactivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    permission: 'DOMAIN_WRITE',
  };
  // @ts-expect-error - intentionally wrong permission
  deactivateRequest.permission = 'INVALID' as capability.TenantDomainActivationAuthClientPermission;
  const deactivateResult = capability.deactivate(state, deactivateRequest, auditFn, port);
  assert.equal(deactivateResult.outcome, 'NOT_FOUND');
});

test("tenantdomainactivationauthclientproof", () => {
  const request: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  const auditFn = (_: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => null;
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: async () => {},
  };

  const state = capability.initialState;
  const result = capability.activate(state, request, auditFn, port);
  assert.equal(result.outcome, 'OK');
  assert.equal(result.state.authClientStatus, 'ACTIVE');
});

test("tenantdomainactivationauthclientreadinessmodel", () => {
  const activeState: capability.TenantDomainActivationAuthClientState = {
    authClientStatus: 'ACTIVE',
    activationTimestamp: new Date().toISOString(),
    canonical: true,
    routingStatus: false,
    disabled: false,
  };
  const inactiveState = capability.initialState;

  assert.equal(capability.getReadiness(activeState), 'READY');
  assert.equal(capability.getReadiness(inactiveState), 'DEGRADED');
});

test("tenantdomainactivationauthclientstatemodel", () => {
  const state: capability.TenantDomainActivationAuthClientState = {
    authClientStatus: 'INACTIVE',
    activationTimestamp: null,
    canonical: false,
    routingStatus: false,
    disabled: false,
  };
  assert.deepEqual(state, capability.initialState);

  const activeState: capability.TenantDomainActivationAuthClientState = {
    authClientStatus: 'ACTIVE',
    activationTimestamp: '2023-01-01T00:00:00.000Z',
    canonical: true,
    routingStatus: false,
    disabled: false,
  };
  assert.equal(activeState.authClientStatus, 'ACTIVE');
  assert.equal(activeState.activationTimestamp, '2023-01-01T00:00:00.000Z');
});

test("tenantdomainactivationauthclientvalidation", () => {
  const state = capability.initialState;
  const auditFn = (_: capability.TenantDomainActivationAuthClientAuditEvent): capability.TenantDomainActivationAuthClientError | null => null;
  const port: capability.AuthClientPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: async () => {},
  };

  const notVerifiedRequest: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: false,
    permission: 'DOMAIN_WRITE',
  };
  assert.equal(capability.validateActivateRequest(state, notVerifiedRequest), 'NOT_VERIFIED');

  const alreadyActiveState: capability.TenantDomainActivationAuthClientState = {
    ...state,
    authClientStatus: 'ACTIVE',
    activationTimestamp: new Date().toISOString(),
  };
  const validRequest: capability.ActivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    verified: true,
    permission: 'DOMAIN_WRITE',
  };
  assert.equal(capability.validateActivateRequest(alreadyActiveState, validRequest), 'ALREADY_ACTIVE');

  const inactiveState = capability.initialState;
  const deactivateRequest: capability.DeactivateRequest = {
    domain: 'example.com',
    tenantId: 'tenant-123',
    permission: 'DOMAIN_WRITE',
  };
  assert.equal(capability.validateDeactivateRequest(inactiveState, deactivateRequest), 'NOT_ACTIVE');
});