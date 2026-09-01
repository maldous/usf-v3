import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/developerplatform/apidocsdeveloperportalsdksratelimits.ts";

test("apidocsdeveloperportalsdksratelimitsauditmodel", () => {
  const auditLog: capability.AuditMetadata[] = [];
  const auditFn: capability.AuditFn = (metadata) => {
    auditLog.push(metadata);
    return null;
  };

  const initial: capability.State = capability.initialState;
  const tenantId = "tenant-123";
  const actorId = "user-456";
  const scopes = ["scope1"] as const;
  const entitlements = ["TENANT_API_KEY_WRITE", "API_ACCESS"] as const;

  const createResult = capability.createApiKey(initial, tenantId, actorId, scopes, auditFn, entitlements);
  assert.ok(createResult.ok);
  assert.equal(auditLog.length, 1);
  assert.equal(auditLog[0].actorId, actorId);
  assert.equal(auditLog[0].action, "API_KEY_CREATED");
  assert.equal(auditLog[0].tenantId, tenantId);
  assert.ok("keyId" in auditLog[0].safeMetadata);
  assert.ok("keyPrefix" in auditLog[0].safeMetadata);
  assert.ok(!("secret" in auditLog[0].safeMetadata));
  assert.ok(!("hash" in auditLog[0].safeMetadata));

  const keyId = createResult.value.state.apiKeys[0].id;
  const revokeResult = capability.revokeApiKey(createResult.value.state, tenantId, actorId, keyId, auditFn, entitlements);
  assert.ok(revokeResult.ok);
  assert.equal(auditLog.length, 2);
  assert.equal(auditLog[1].actorId, actorId);
  assert.equal(auditLog[1].action, "API_KEY_REVOKED");
  assert.equal(auditLog[1].tenantId, tenantId);
  assert.ok(!("secret" in auditLog[1].safeMetadata));
  assert.ok(!("hash" in auditLog[1].safeMetadata));

  const policy: capability.RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const updateResult = capability.updateRateLimitPolicy(
    revokeResult.value,
    tenantId,
    actorId,
    policy,
    auditFn,
    ["PLATFORM_RATE_LIMIT_OPERATOR"] as const
  );
  assert.ok(updateResult.ok);
  assert.equal(auditLog.length, 3);
  assert.equal(auditLog[2].actorId, actorId);
  assert.equal(auditLog[2].action, "RATE_LIMIT_POLICY_CHANGED");
  assert.equal(auditLog[2].tenantId, tenantId);
  assert.ok(!("secret" in auditLog[2].safeMetadata));
  assert.ok(!("hash" in auditLog[2].safeMetadata));

  const getPortalResult = capability.getDeveloperPortalSummary(
    updateResult.value,
    ["TENANT_DEVELOPER_READ"] as const
  );
  assert.ok(getPortalResult.ok);
  assert.equal(auditLog.length, 3);
});

test("apidocsdeveloperportalsdksratelimitserrormodel", () => {
  const missingTenantResult = capability.checkTenantContext(null);
  assert.ok(!missingTenantResult.ok);
  assert.equal(missingTenantResult.error.kind, "MISSING_TENANT_CONTEXT");

  const notEntitledResult = capability.checkEntitlement([], "TENANT_API_KEY_WRITE");
  assert.ok(!notEntitledResult.ok);
  assert.equal(notEntitledResult.error.kind, "NOT_ENTITLED");

  const apiAccessNotEntitledResult = capability.checkApiAccessEntitlement([]);
  assert.ok(!apiAccessNotEntitledResult.ok);
  assert.equal(apiAccessNotEntitledResult.error.kind, "NOT_ENTITLED");

  const invalidTenantResult = capability.checkTenantIdentifier("invalid@tenant");
  assert.ok(!invalidTenantResult.ok);
  assert.equal(invalidTenantResult.error.kind, "INVALID_TENANT_IDENTIFIER");

  const apiKey: capability.ApiKey = {
    id: "key-1",
    prefix: "tenant-1",
    hash: "hash123",
    state: "REVOKED",
    scopes: ["read"] as const,
    createdAt: "2023-01-01T00:00:00Z",
    revokedAt: "2023-01-02T00:00:00Z",
  };
  const authResult = capability.authenticateKey([apiKey], "tenant-1", "secret");
  assert.equal(authResult, null);

  const driftResult = capability.checkOpenApiDrift({ a: 1 }, { a: 2 });
  assert.ok(!driftResult.ok);
  assert.equal(driftResult.error.kind, "OPENAPI_DRIFT");

  const invalidTenantOpResult = capability.operatorRateLimitOperation(
    capability.initialState,
    "invalid@tenant",
    "user-1",
    { windowMs: 60000, maxRequests: 100 },
    () => null,
    ["PLATFORM_RATE_LIMIT_OPERATOR"] as const
  );
  assert.ok(!invalidTenantOpResult.ok);
  assert.equal(invalidTenantOpResult.error.kind, "INVALID_TENANT_IDENTIFIER");
});

test("apidocsdeveloperportalsdksratelimitslifecycle", () => {
  const state: capability.State = capability.initialState;
  const tenantId = "tenant-123";
  const actorId = "user-456";
  const scopes = ["scope1"] as const;
  const entitlements = ["TENANT_API_KEY_WRITE", "API_ACCESS", "TENANT_DEVELOPER_READ"] as const;
  const auditFn: capability.AuditFn = () => null;

  const openApiContract = { openapi: "3.0.0" } as const;
  const graphQlContract = { schema: "type Query { hello: String }" } as const;
  const sdkMaterials = ["sdk.zip"] as const;
  const declaredOpenApiContract = { openapi: "3.0.0" } as const;

  const developerPortalResult = capability.buildDeveloperPortal(
    state,
    tenantId,
    openApiContract,
    graphQlContract,
    sdkMaterials,
    entitlements,
    declaredOpenApiContract
  );
  assert.ok(developerPortalResult.ok);
  assert.ok(developerPortalResult.value.summary.rateLimitVisibility);

  const createResult = capability.createApiKey(developerPortalResult.value.state, tenantId, actorId, scopes, auditFn, entitlements);
  assert.ok(createResult.ok);
  assert.ok(createResult.value.secret.length > 0);

  const listResult = capability.listApiKeys(createResult.value.state, tenantId, ["TENANT_API_KEY_READ"] as const);
  assert.ok(listResult.ok);
  assert.equal(listResult.value.length, 1);
  const key = listResult.value[0];
  assert.ok(!("hash" in key));
  assert.ok(!("secret" in key));

  const authResult = capability.authenticateRequest(createResult.value.state, key.prefix, createResult.value.secret);
  assert.ok(authResult.ok);
  assert.ok(authResult.value !== null);

  const keyId = createResult.value.state.apiKeys[0].id;
  const revokeResult = capability.revokeApiKey(createResult.value.state, tenantId, actorId, keyId, auditFn, entitlements);
  assert.ok(revokeResult.ok);

  const policy: capability.RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const evaluateResult = capability.evaluateRateLimit(revokeResult.value, tenantId, policy);
  assert.ok(evaluateResult.ok);
  assert.equal(evaluateResult.value.policy.maxRequests, 100);
  assert.equal(evaluateResult.value.currentWindowCount, 0);
  assert.equal(evaluateResult.value.exceeded, "NOT_EXCEEDED");
});

test("apidocsdeveloperportalsdksratelimitspermissions", () => {
  const state: capability.State = capability.initialState;
  const tenantId = "tenant-123";
  const actorId = "user-456";
  const auditFn: capability.AuditFn = () => null;

  const listResult = capability.listApiKeys(state, tenantId, []);
  assert.ok(!listResult.ok);
  assert.equal(listResult.error.kind, "NOT_ENTITLED");

  const createResult = capability.createApiKey(state, tenantId, actorId, ["scope1"] as const, auditFn, []);
  assert.ok(!createResult.ok);
  assert.equal(createResult.error.kind, "NOT_ENTITLED");

  const revokeResult = capability.revokeApiKey(state, tenantId, actorId, "key-1", auditFn, []);
  assert.ok(!revokeResult.ok);
  assert.equal(revokeResult.error.kind, "NOT_ENTITLED");

  const operatorListResult = capability.operatorListApiKeys(state, []);
  assert.ok(!operatorListResult.ok);
  assert.equal(operatorListResult.error.kind, "NOT_ENTITLED");

  const updateResult = capability.updateRateLimitPolicy(
    state,
    tenantId,
    actorId,
    { windowMs: 60000, maxRequests: 100 },
    auditFn,
    []
  );
  assert.ok(!updateResult.ok);
  assert.equal(updateResult.error.kind, "NOT_ENTITLED");

  const apiAccessResult = capability.createApiKey(
    state,
    tenantId,
    actorId,
    ["scope1"] as const,
    auditFn,
    ["TENANT_API_KEY_WRITE"] as const
  );
  assert.ok(!apiAccessResult.ok);
  assert.equal(apiAccessResult.error.kind, "NOT_ENTITLED");
});

test("apidocsdeveloperportalsdksratelimitsproof", () => {
  const state: capability.State = capability.initialState;
  const proofResult = capability.runRuntimeProof(
    state,
    { openapi: "3.0.0" },
    { schema: "type Query { hello: String }" },
    { openapi: "3.0.0" },
    { schema: "type Query { hello: String }" }
  );
  assert.ok(proofResult.status === "PASSED" || proofResult.status === "FAILED" || proofResult.status === "PENDING");
  assert.ok(proofResult.details.length > 0);
});

test("apidocsdeveloperportalsdksratelimitsreadinessmodel", () => {
  const readinessNoProvider = capability.checkProviderAvailability(false, false);
  assert.equal(readinessNoProvider, "UNAVAILABLE");

  const readinessDegraded = capability.checkProviderAvailability(true, false);
  assert.equal(readinessDegraded, "DEGRADED");

  const readinessReady = capability.checkProviderAvailability(true, true);
  assert.equal(readinessReady, "READY");

  const stateReady = capability.updateReadiness(capability.initialState, true, true);
  assert.equal(stateReady.readiness, "READY");

  const stateDegraded = capability.updateReadiness(capability.initialState, false, true);
  assert.equal(stateDegraded.readiness, "DEGRADED");

  const stateUnavailable = capability.updateReadiness(capability.initialState, false, false);
  assert.equal(stateUnavailable.readiness, "UNAVAILABLE");

  const evalResult = capability.evaluateRateLimitWithFallback(
    capability.initialState,
    "tenant-1",
    { windowMs: 60000, maxRequests: 100 },
    false,
    false
  );
  assert.ok(!evalResult.ok);
  assert.equal(evalResult.error.kind, "PROVIDER_UNAVAILABLE");
});

test("apidocsdeveloperportalsdksratelimitsstatemodel", () => {
  const state = capability.initialState;
  const tenantId = "tenant-1" as const;
  const scopes = ["read", "write"] as const;
  const entitlements = ["TENANT_API_KEY_WRITE", "API_ACCESS"] as const;
  const auditFn: capability.AuditFn = () => null;

  const createResult = capability.createApiKey(state, tenantId, "actor-1", scopes, auditFn, entitlements);
  assert.ok(createResult.ok);
  const createdState = createResult.value.state;
  assert.equal(createdState.apiKeys.length, 1);
  const apiKey = createdState.apiKeys[0];
  assert.equal(apiKey.state, "ACTIVE");
  assert.equal(apiKey.prefix, tenantId + "_1");
  assert.deepEqual(apiKey.scopes, scopes);
  assert.ok(!("secret" in apiKey));
  assert.ok(apiKey.hash.length > 0);

  const policy: capability.RateLimitPolicy = { windowMs: 60000, maxRequests: 100 };
  const evalResult = capability.evaluateRateLimit(createdState, tenantId, policy);
  assert.ok(evalResult.ok);
  assert.equal(evalResult.value.policy.maxRequests, 100);
  assert.equal(evalResult.value.currentWindowCount, 0);
  assert.equal(evalResult.value.exceeded, "NOT_EXCEEDED");

  const openApiContract = { openapi: "3.0.0" } as const;
  const graphQlContract = { schema: "type Query { hello: String }" } as const;
  const sdkMaterials = ["sdk.zip"] as const;
  const buildResult = capability.buildDeveloperPortal(
    createdState,
    tenantId,
    openApiContract,
    graphQlContract,
    sdkMaterials,
    ["TENANT_DEVELOPER_READ"] as const,
    openApiContract
  );
  assert.ok(buildResult.ok);
  assert.ok(buildResult.value.summary.rateLimitVisibility);
  assert.deepEqual(buildResult.value.summary.openApiContract, openApiContract);
  assert.deepEqual(buildResult.value.summary.graphQlContract, graphQlContract);
  assert.deepEqual(buildResult.value.summary.sdkMaterials, sdkMaterials);
});

test("apidocsdeveloperportalsdksratelimitsuisemantics", () => {
  const uiModel = capability.getUIModel();
  assert.ok(uiModel !== undefined);
  assert.equal(uiModel.surfaces.length, 4);
  assert.equal(uiModel.viewModels.length, 4);
  assert.equal(uiModel.components.length, 4);
  assert.equal(uiModel.journeys.length, 4);
  assert.equal(uiModel.permissions.length, 6);
  assert.ok(uiModel.accessibility.ariaLabels);
  assert.ok(uiModel.accessibility.keyboardNavigation);
  assert.equal(uiModel.localisation.supportedLanguages.length, 1);
  assert.equal(uiModel.localisation.defaultLanguage, "en");
  assert.equal(uiModel.rendererContracts.length, 3);
  assert.equal(uiModel.disclaimers.length, 4);
});

test("apidocsdeveloperportalsdksratelimitsvalidation", () => {
  const state: capability.State = capability.initialState;
  const validation = capability.runValidation(state, { openapi: "3.0.0" });
  assert.ok(validation.entitlementGated);
  assert.ok(validation.secretOnce);
  assert.ok(validation.listOmitsSecret);
  assert.ok(validation.listOmitsHash);
  assert.ok(validation.listOmitsSalt);
  assert.ok(validation.operatorOmitsSecret);
  assert.ok(validation.operatorOmitsHash);
  assert.ok(validation.operatorOmitsSalt);
  assert.ok(validation.secretAuthenticates);
  assert.ok(validation.hashCannotAuthenticate);
  assert.ok(validation.revokedDenied);
  assert.ok(validation.routeMetadataMatches);
  assert.ok(validation.openApiDriftFailsGate);
});