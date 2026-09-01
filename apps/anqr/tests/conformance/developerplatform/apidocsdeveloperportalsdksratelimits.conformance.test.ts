import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/developerplatform/apidocsdeveloperportalsdksratelimits.ts";

test("apidocsdeveloperportalsdksratelimitsauditmodel", () => {
  const auditLog: capability.AuditMetadata[] = [];
  const auditFn = (metadata: capability.AuditMetadata) => auditLog.push(metadata);

  const initial: capability.State = capability.initialState;
  const tenantId = 'tenant-123';
  const actorId = 'user-456';
  const scopes: readonly string[] = ['scope1'];
  const entitlements: readonly capability.Permission[] = ['TENANT_API_KEY_WRITE'];

  const createResult = capability.createApiKey(
    initial,
    tenantId,
    actorId,
    scopes,
    auditFn,
    entitlements
  );
  assert.ok(createResult.ok);
  assert.equal(auditLog.length, 2);
  assert.equal(auditLog[0].actorId, actorId);
  assert.equal(auditLog[0].action, 'API_KEY_CREATED');
  assert.equal(auditLog[0].tenantId, tenantId);
  assert.ok(!('secret' in auditLog[0]));
  assert.ok(!('hash' in auditLog[0]));

  const keyId = createResult.value.state.apiKeys[0].id;
  const revokeResult = capability.revokeApiKey(
    createResult.value.state,
    tenantId,
    actorId,
    keyId,
    auditFn,
    entitlements
  );
  assert.ok(revokeResult.ok);
  assert.equal(auditLog.length, 4);
  assert.equal(auditLog[2].actorId, actorId);
  assert.equal(auditLog[2].action, 'API_KEY_REVOKED');
  assert.equal(auditLog[2].tenantId, tenantId);
  assert.ok(!('secret' in auditLog[2]));
  assert.ok(!('hash' in auditLog[2]));

  const policy: capability.RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const updateResult = capability.updateRateLimitPolicy(
    revokeResult.value,
    tenantId,
    actorId,
    '/test',
    policy,
    auditFn,
    ['PLATFORM_RATE_LIMIT_OPERATOR'] as const
  );
  assert.ok(updateResult.ok);
  assert.equal(auditLog.length, 6);
  assert.equal(auditLog[4].actorId, actorId);
  assert.equal(auditLog[4].action, 'RATE_LIMIT_POLICY_CHANGED');
  assert.equal(auditLog[4].tenantId, tenantId);
  assert.ok(!('secret' in auditLog[4]));
  assert.ok(!('hash' in auditLog[4]));
});

test("apidocsdeveloperportalsdksratelimitserrormodel", () => {
  const state: capability.State = capability.initialState;

  const missingTenantResult = capability.checkTenantContext(null);
  assert.ok(!missingTenantResult.ok);
  assert.equal(missingTenantResult.error.kind, 'MISSING_TENANT_CONTEXT');

  const notEntitledResult = capability.checkEntitlement([]);
  assert.ok(!notEntitledResult.ok);
  assert.equal(notEntitledResult.error.kind, 'NOT_ENTITLED');

  const invalidTenantResult = capability.checkTenantIdentifier('invalid@tenant');
  assert.ok(!invalidTenantResult.ok);
  assert.equal(invalidTenantResult.error.kind, 'INVALID_TENANT_IDENTIFIER');

  const apiKey: capability.ApiKey = {
    id: 'key-1',
    prefix: 'tenant-1',
    hash: 'hash123',
    state: 'REVOKED',
    scopes: ['read'],
    createdAt: '2023-01-01T00:00:00Z',
    revokedAt: '2023-01-02T00:00:00Z',
  };
  const authResult = capability.authenticateKey([apiKey], 'tenant-1', 'secret');
  assert.equal(authResult, null);

  const driftResult = capability.checkOpenApiDrift({ a: 1 }, { a: 2 });
  assert.ok(!driftResult.ok);
  assert.equal(driftResult.error.kind, 'OPENAPI_DRIFT');

  const invalidTenantOpResult = capability.updateRateLimitPolicy(
    state,
    'invalid@tenant',
    'user-1',
    '/test',
    { windowMs: 60000, maxRequests: 100 },
    () => {},
    ['PLATFORM_RATE_LIMIT_OPERATOR'] as const
  );
  assert.ok(!invalidTenantOpResult.ok);
  assert.equal(invalidTenantOpResult.error.kind, 'INVALID_TENANT_IDENTIFIER');
});

test("apidocsdeveloperportalsdksratelimitslifecycle", () => {
  const state: capability.State = capability.initialState;
  const tenantId = 'tenant-123';
  const actorId = 'user-456';
  const scopes: readonly string[] = ['scope1'];
  const entitlements: readonly capability.Permission[] = ['TENANT_API_KEY_WRITE'];
  const auditFn = () => {};

  const openApiContract = { openapi: '3.0.0' } as const;
  const graphQlContract = { schema: 'type Query { hello: String }' } as const;
  const sdkMaterials = ['sdk.zip'] as const;
  const portal = capability.buildDeveloperPortal(openApiContract, graphQlContract, sdkMaterials, true);
  const stateWithPortal = capability.setDeveloperPortal(state, portal);

  const createResult = capability.createApiKey(stateWithPortal, tenantId, actorId, scopes, auditFn, entitlements);
  assert.ok(createResult.ok);
  assert.ok(createResult.value.secret.length > 0);

  const listResult = capability.listApiKeys(createResult.value.state, tenantId, ['TENANT_API_KEY_READ'] as const);
  assert.ok(listResult.ok);
  assert.equal(listResult.value.length, 1);
  assert.ok(!('hash' in listResult.value[0]));
  assert.ok(!('id' in listResult.value[0]));

  const authResult = capability.authenticateKey(
    createResult.value.state.apiKeys,
    tenantId,
    createResult.value.secret
  );
  assert.equal(authResult?.prefix, tenantId);

  const keyId = createResult.value.state.apiKeys[0].id;
  const revokeResult = capability.revokeApiKey(
    createResult.value.state,
    tenantId,
    actorId,
    keyId,
    auditFn,
    entitlements
  );
  assert.ok(revokeResult.ok);

  const rateLimitPolicy: capability.RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const rateLimitState: capability.RateLimitState = {
    policy: rateLimitPolicy,
    currentWindowCount: 0,
    exceeded: 'NOT_EXCEEDED',
  };
  const stateWithRateLimit: capability.State = {
    ...revokeResult.value,
    rateLimits: new Map([['/test', rateLimitState]]),
  };
  const evaluateResult = capability.evaluateRateLimit(stateWithRateLimit, tenantId, '/test');
  assert.ok(evaluateResult.ok);
  assert.equal(evaluateResult.value.policy.maxRequests, 100);
});

test("apidocsdeveloperportalsdksratelimitspermissions", () => {
  const state: capability.State = capability.initialState;
  const tenantId = 'tenant-123';
  const actorId = 'user-456';
  const auditFn = () => {};

  const listResult = capability.listApiKeys(state, tenantId, []);
  assert.ok(!listResult.ok);
  assert.equal(listResult.error.kind, 'NOT_ENTITLED');

  const createResult = capability.createApiKey(
    state,
    tenantId,
    actorId,
    ['scope1'],
    auditFn,
    []
  );
  assert.ok(!createResult.ok);
  assert.equal(createResult.error.kind, 'NOT_ENTITLED');

  const revokeResult = capability.revokeApiKey(
    state,
    tenantId,
    actorId,
    'key-1',
    auditFn,
    []
  );
  assert.ok(!revokeResult.ok);
  assert.equal(revokeResult.error.kind, 'NOT_ENTITLED');

  const updateResult = capability.updateRateLimitPolicy(
    state,
    tenantId,
    actorId,
    '/test',
    { windowMs: 60000, maxRequests: 100 },
    auditFn,
    []
  );
  assert.ok(!updateResult.ok);
  assert.equal(updateResult.error.kind, 'NOT_ENTITLED');
});

test("apidocsdeveloperportalsdksratelimitsproof", () => {
  const state: capability.State = capability.initialState;
  const tenantId = 'tenant-123';
  const actorId = 'user-456';
  const scopes: readonly string[] = ['scope1'];
  const entitlements: readonly capability.Permission[] = ['TENANT_API_KEY_WRITE'];
  const auditFn = () => {};

  const createResult = capability.createApiKey(state, tenantId, actorId, scopes, auditFn, entitlements);
  assert.ok(createResult.ok);
  const key = createResult.value.state.apiKeys[0];
  assert.equal(key.prefix, tenantId);

  const authResult = capability.authenticateKey(
    createResult.value.state.apiKeys,
    tenantId,
    createResult.value.secret
  );
  assert.equal(authResult?.id, key.id);

  const rateLimitPolicy: capability.RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const rateLimitState: capability.RateLimitState = {
    policy: rateLimitPolicy,
    currentWindowCount: 0,
    exceeded: 'NOT_EXCEEDED',
  };
  const stateWithRateLimit: capability.State = {
    ...createResult.value.state,
    rateLimits: new Map([['/test', rateLimitState]]),
  };
  const evaluateResult = capability.evaluateRateLimit(stateWithRateLimit, tenantId, '/test');
  assert.ok(evaluateResult.ok);

  const driftResult = capability.checkOpenApiDrift({ a: 1 }, { a: 1 });
  assert.ok(driftResult.ok);
});

test("apidocsdeveloperportalsdksratelimitsreadinessmodel", () => {
  const stateNoPortal: capability.State = {
    ...capability.initialState,
    developerPortal: null,
  };
  const readinessNoPortal = capability.computeReadiness(stateNoPortal);
  assert.equal(readinessNoPortal, 'UNAVAILABLE');

  const portal: capability.DeveloperPortalSummary = {
    openApiContract: {},
    graphQlContract: {},
    sdkMaterials: [],
    rateLimitVisibility: true,
  };
  const stateWithPortal: capability.State = {
    ...capability.initialState,
    developerPortal: portal,
    readiness: 'READY',
  };
  const readinessWithPortal = capability.computeReadiness(stateWithPortal);
  assert.equal(readinessWithPortal, 'READY');

  const stateDegraded: capability.State = {
    ...stateWithPortal,
    readiness: 'DEGRADED',
  };
  const readinessDegraded = capability.computeReadiness(stateDegraded);
  assert.equal(readinessDegraded, 'DEGRADED');
});

test("apidocsdeveloperportalsdksratelimitsstatemodel", () => {
  const apiKey: capability.ApiKey = {
    id: 'key-1',
    prefix: 'tenant-1',
    hash: 'hash123',
    state: 'ACTIVE',
    scopes: ['read', 'write'] as const,
    createdAt: '2023-01-01T00:00:00Z',
    revokedAt: null,
  };
  const rateLimitPolicy: capability.RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const rateLimitState: capability.RateLimitState = {
    policy: rateLimitPolicy,
    currentWindowCount: 50,
    exceeded: 'NOT_EXCEEDED',
  };
  const portal: capability.DeveloperPortalSummary = {
    openApiContract: { openapi: '3.0.0' },
    graphQlContract: { schema: 'type Query { hello: String }' },
    sdkMaterials: ['sdk.zip'],
    rateLimitVisibility: true,
  };
  const state: capability.State = {
    apiKeys: [apiKey],
    developerPortal: portal,
    rateLimits: new Map([['/test', rateLimitState]]),
    auditLog: [],
    readiness: 'READY',
  };

  assert.equal(state.apiKeys[0].state, 'ACTIVE');
  assert.equal(state.apiKeys[0].prefix, 'tenant-1');
  assert.deepEqual(state.apiKeys[0].scopes, ['read', 'write']);
  assert.ok(!('secret' in state.apiKeys[0]));
  assert.ok(state.developerPortal !== null);
  assert.ok(state.rateLimits.has('/test'));
  assert.equal(state.rateLimits.get('/test')?.policy.maxRequests, 100);
  assert.equal(state.rateLimits.get('/test')?.currentWindowCount, 50);
  assert.equal(state.rateLimits.get('/test')?.exceeded, 'NOT_EXCEEDED');
});

test("apidocsdeveloperportalsdksratelimitsuisemantics", () => {
  const portal = capability.buildDeveloperPortal(
    { openapi: '3.0.0' } as const,
    { schema: 'type Query { hello: String }' } as const,
    ['sdk.zip'] as const,
    true
  );
  assert.deepEqual(portal.openApiContract, { openapi: '3.0.0' });
  assert.deepEqual(portal.graphQlContract, { schema: 'type Query { hello: String }' });
  assert.deepEqual(portal.sdkMaterials, ['sdk.zip']);
  assert.equal(portal.rateLimitVisibility, true);
});

test("apidocsdeveloperportalsdksratelimitsvalidation", () => {
  const state: capability.State = capability.initialState;
  const tenantId = 'tenant-123';
  const actorId = 'user-456';
  const scopes: readonly string[] = ['scope1'];
  const entitlements: readonly capability.Permission[] = ['TENANT_API_KEY_WRITE'];
  const auditFn = () => {};

  const createResult = capability.createApiKey(state, tenantId, actorId, scopes, auditFn, entitlements);
  assert.ok(createResult.ok);
  const secret = createResult.value.secret;
  assert.ok(secret.length > 0);

  const listResult = capability.listApiKeys(createResult.value.state, tenantId, ['TENANT_API_KEY_READ'] as const);
  assert.ok(listResult.ok);
  assert.equal(listResult.value.length, 1);
  assert.ok(!('hash' in listResult.value[0]));
  assert.ok(!('id' in listResult.value[0]));
  assert.ok(!('secret' in listResult.value[0]));

  const authResult = capability.authenticateKey(
    createResult.value.state.apiKeys,
    tenantId,
    secret
  );
  assert.notEqual(authResult, null);
  assert.equal(authResult?.prefix, tenantId);

  const revokeResult = capability.revokeApiKey(
    createResult.value.state,
    tenantId,
    actorId,
    createResult.value.state.apiKeys[0].id,
    auditFn,
    entitlements
  );
  assert.ok(revokeResult.ok);

  const authRevokedResult = capability.authenticateKey(
    revokeResult.value.apiKeys,
    tenantId,
    secret
  );
  assert.equal(authRevokedResult, null);

  const driftResult = capability.checkOpenApiDrift({ a: 1 }, { a: 2 });
  assert.ok(!driftResult.ok);
  assert.equal(driftResult.error.kind, 'OPENAPI_DRIFT');
});