import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/authentication/authenticationplatform.ts";

test("authenticationplatformauditmodel", () => {
  const auditEvents: capability.AuthenticationPlatformAuditEvent[] = [];
  const auditFn = (event: capability.AuthenticationPlatformAuditEvent): capability.AuthenticationPlatformError | null => {
    auditEvents.push(event);
    return null;
  };

  let state = capability.initialState;

  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn,
  );
  if ("kind" in sessionResult) throw new Error("Unexpected error");
  assert.equal(sessionResult.state.auditLog.at(-1)?.kind, "SESSION_CREATED");
  assert.equal(sessionResult.state.auditLog.at(-1)?.operation, "createSession");
  state = sessionResult.state;

  const destroyResult = capability.destroySession(state, sessionResult.session.id, auditFn);
  if ("kind" in destroyResult) throw new Error("Unexpected error");
  assert.equal(destroyResult.state.auditLog.at(-1)?.kind, "SESSION_DESTROYED");
  state = destroyResult.state;

  const lookupResult = capability.lookupSession(state, sessionResult.session.id);
  assert.ok("kind" in lookupResult);

  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"] as const,
    "***REDACTED***",
    auditFn,
  );
  if ("kind" in createResult) throw new Error("Unexpected error");
  const auditEvent = createResult.state.auditLog.at(-1);
  assert.ok(auditEvent !== undefined);
  assert.equal(auditEvent.kind, "PROVIDER_CREATED");
  assert.equal(auditEvent.alias, "test-provider");
  assert.equal(auditEvent.operation, "createProvider");
  assert.deepStrictEqual(auditEvent.changedFields, ["alias", "issuer", "jwksUri", "scopes", "maskedSecret"]);
  assert.equal(auditEvent.secretChanged, true);

  const beforeChangeEvents = auditEvents.filter((e) => e.kind === "AUDIT_BEFORE_CHANGE");
  assert.ok(beforeChangeEvents.length >= 1, "audit-before-change must be emitted before provider mutation");

  const providerBefore = createResult.state.providers.get("test-provider");
  assert.ok(providerBefore !== undefined, "provider must be persisted after successful audit");

  state = createResult.state;

  const failingAuditFn = (): capability.AuthenticationPlatformError => ({ kind: "AUDIT_VIOLATION", message: "Test audit failure" });
  const failResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider-2",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"] as const,
    "***REDACTED***",
    failingAuditFn,
  );
  assert.ok("kind" in failResult);
  if (!("kind" in failResult)) throw new Error("Expected error");
  assert.equal(failResult.kind, "AUDIT_VIOLATION");
  assert.equal(state.providers.has("test-provider-2"), false, "audit failure must abort mutation before provider is touched");
});

test("authenticationplatformcontracts", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn,
  );
  if ("kind" in sessionResult) throw new Error("Unexpected error");
  assert.equal(sessionResult.session.userId, "user1");
  state = sessionResult.state;

  const lookupResult = capability.lookupSession(state, sessionResult.session.id);
  if ("kind" in lookupResult) throw new Error("Unexpected error");
  assert.equal(lookupResult.userId, "user1");

  const providers = capability.listProviders(state, "tenant1");
  if ("kind" in providers) throw new Error("Unexpected error");

  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);
  assert.equal(pkce.codeChallenge, pkce.codeChallenge.toLowerCase());

  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"] as const,
    "***REDACTED***",
    auditFn,
  );
  if ("kind" in createResult) throw new Error("Unexpected error");
  assert.equal(createResult.result, "NO_CONTENT");
  state = createResult.state;

  const initiateResult = capability.initiateLogin(state, "/dashboard", "test-provider", auditFn);
  if ("kind" in initiateResult) throw new Error("Unexpected error");
  assert.equal(initiateResult.preAuth.providerAlias, "test-provider");
  state = initiateResult.state;

  const callbackResult = capability.handleCallback(
    state,
    "auth-code-123",
    initiateResult.preAuth.state,
    initiateResult.preAuth.nonce,
    null,
    auditFn,
  );
  if ("kind" in callbackResult) throw new Error("Unexpected error");
  assert.equal(callbackResult.session.state, "AUTHENTICATED");
  state = callbackResult.state;

  const logoutResult = capability.logout(state, callbackResult.session.id, auditFn);
  if ("kind" in logoutResult) throw new Error("Unexpected error");
  assert.equal(logoutResult.result, "NO_CONTENT");

  const authCheck = capability.forwardAuthCheck(state, callbackResult.session.id);
  assert.equal(authCheck.authenticated, false);

  const updateResult = capability.updateProvider(
    state,
    "tenant1",
    "test-provider",
    { issuer: "https://issuer2.example.com" },
    auditFn,
  );
  if ("kind" in updateResult) throw new Error("Unexpected error");
  state = updateResult.state;

  const importResult = capability.importOidcDiscovery(
    state,
    "tenant1",
    "test-provider",
    { issuer: "https://issuer2.example.com", jwks_uri: "https://issuer2.example.com/jwks.json" },
    auditFn,
  );
  if ("kind" in importResult) throw new Error("Unexpected error");
  state = importResult.state;

  const testResult = capability.testProviderConnection(state, "tenant1", "test-provider", auditFn);
  if ("kind" in testResult) throw new Error("Unexpected error");
  state = testResult.state;

  const callbackUrl = capability.deriveCallbackUrl(state, "example.com");
  assert.ok(typeof callbackUrl === "string");

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writePolicyResult = capability.writePolicy(state, "tenant1", policy, auditFn);
  if ("kind" in writePolicyResult) throw new Error("Unexpected error");
  state = writePolicyResult.state;

  const readPolicyResult = capability.readPolicy(state, "tenant1");
  if ("kind" in readPolicyResult) throw new Error("Unexpected error");

  const mappings: capability.AuthenticationPlatformClaimMapping[] = [
    { claimName: "role", roleName: "admin" },
  ];
  const writeMappingsResult = capability.writeClaimMappings(state, "tenant1", mappings, auditFn);
  if ("kind" in writeMappingsResult) throw new Error("Unexpected error");
  state = writeMappingsResult.state;

  const readMappingsResult = capability.readClaimMappings(state, "tenant1");
  if ("kind" in readMappingsResult) throw new Error("Unexpected error");
  assert.equal(readMappingsResult.length, 1);

  const enumResult = capability.enumerateProviders(state);
  assert.ok(Array.isArray(enumResult));
  assert.ok(enumResult.includes("test-provider"));

  const deleteResult = capability.deleteProvider(state, "tenant1", "test-provider", auditFn);
  if ("kind" in deleteResult) throw new Error("Unexpected error");
  assert.equal(deleteResult.result, "NO_CONTENT");
});

test("authenticationplatformerrormodel", () => {
  const state = capability.initialState;

  const lookupResult = capability.lookupSession(state, "nonexistent");
  assert.ok("kind" in lookupResult);
  if (!("kind" in lookupResult)) throw new Error("Expected error");
  assert.equal(lookupResult.kind, "UNAUTHENTICATED");

  const unavailableState: capability.AuthenticationPlatformState = {
    ...state,
    sessionStoreAvailable: false,
    fixtureMode: false,
  };
  const unavailableLookup = capability.lookupSession(unavailableState, "any");
  assert.ok("kind" in unavailableLookup);
  if (!("kind" in unavailableLookup)) throw new Error("Expected error");
  assert.equal(unavailableLookup.kind, "SESSION_LOOKUP_FAILURE");

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  if (invalidReturnTo === null) throw new Error("Expected error");
  assert.equal(invalidReturnTo.kind, "INVALID_RETURN_TO");

  const reservedAlias = capability.validateProviderAlias("existing", ["existing"]);
  assert.notStrictEqual(reservedAlias, null);
  if (reservedAlias === null) throw new Error("Expected error");
  assert.equal(reservedAlias.kind, "RESERVED_ALIAS");

  const unsafeUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(unsafeUrls, null);
  if (unsafeUrls === null) throw new Error("Expected error");
  assert.equal(unsafeUrls.kind, "UNSAFE_SCHEME");

  const invalidDoc = capability.validateOidcUrls("not a url", "also not a url");
  assert.notStrictEqual(invalidDoc, null);
  if (invalidDoc === null) throw new Error("Expected error");
  assert.equal(invalidDoc.kind, "INVALID_DOCUMENT");

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null);
  if (invalidMfaMode === null) throw new Error("Expected error");
  assert.equal(invalidMfaMode.kind, "INVALID_MFA_MODE");

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null);
  if (invalidThreshold === null) throw new Error("Expected error");
  assert.equal(invalidThreshold.kind, "INVALID_LOCKOUT_THRESHOLD");

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null);
  if (invalidLifespan === null) throw new Error("Expected error");
  assert.equal(invalidLifespan.kind, "INVALID_SESSION_LIFESPAN");

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null);
  if (invalidClaimName === null) throw new Error("Expected error");
  assert.equal(invalidClaimName.kind, "DANGEROUS_CLAIM_NAME");

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null);
  if (invalidRealmRole === null) throw new Error("Expected error");
  assert.equal(invalidRealmRole.kind, "INVALID_REALM_ROLE");

  const callbackResult = capability.handleCallback(
    state,
    "code",
    "state",
    "nonce",
    "provider_error",
    () => null,
  );
  assert.ok("kind" in callbackResult);
  if (!("kind" in callbackResult)) throw new Error("Expected error");
  assert.equal(callbackResult.kind, "PROVIDER_ERROR_CALLBACK");

  const fallback = capability.deriveCallbackUrl(state, "unknown.example.com");
  assert.equal(fallback, "https://auth.anqr.dev");

  const inactiveDomain: capability.AuthenticationPlatformDomain = {
    domain: "inactive.example.com",
    verified: true,
    active: false,
  };
  const stateWithDomain: capability.AuthenticationPlatformState = {
    ...state,
    domains: new Map([["inactive.example.com", inactiveDomain]]),
  };
  const fallbackInactive = capability.deriveCallbackUrl(stateWithDomain, "inactive.example.com");
  assert.equal(fallbackInactive, "https://auth.anqr.dev");

  const readinessDegraded = capability.checkReadiness(state, null);
  assert.equal(readinessDegraded.kind, "DEGRADED");

  const readinessMissing = capability.checkReadiness(state, "tenant1");
  assert.equal(readinessMissing.kind, "MISSING_CREDENTIAL");
});

test("authenticationplatformlifecycle", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);

  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn,
  );
  if ("kind" in sessionResult) throw new Error("Unexpected error");
  assert.equal(sessionResult.session.state, "AUTHENTICATED");
  state = sessionResult.state;

  const destroyResult = capability.destroySession(state, sessionResult.session.id, auditFn);
  if ("kind" in destroyResult) throw new Error("Unexpected error");
  assert.equal(destroyResult.result, "NO_CONTENT");
  state = destroyResult.state;

  const lookupAfterDestroy = capability.lookupSession(state, sessionResult.session.id);
  assert.ok("kind" in lookupAfterDestroy);
  if (!("kind" in lookupAfterDestroy)) throw new Error("Expected error");
  assert.equal(lookupAfterDestroy.kind, "UNAUTHENTICATED");

  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"] as const,
    "***REDACTED***",
    auditFn,
  );
  if ("kind" in createResult) throw new Error("Unexpected error");
  state = createResult.state;

  const initiateResult = capability.initiateLogin(state, "/dashboard", "test-provider", auditFn);
  if ("kind" in initiateResult) throw new Error("Unexpected error");
  assert.equal(initiateResult.preAuth.providerAlias, "test-provider");
  state = initiateResult.state;

  const callbackResult = capability.handleCallback(
    state,
    "auth-code",
    initiateResult.preAuth.state,
    initiateResult.preAuth.nonce,
    null,
    auditFn,
  );
  if ("kind" in callbackResult) throw new Error("Unexpected error");
  assert.equal(callbackResult.session.state, "AUTHENTICATED");
  state = callbackResult.state;

  const logoutResult = capability.logout(state, callbackResult.session.id, auditFn);
  if ("kind" in logoutResult) throw new Error("Unexpected error");
  assert.equal(logoutResult.result, "NO_CONTENT");
  state = logoutResult.state;

  const updateResult = capability.updateProvider(
    state,
    "tenant1",
    "test-provider",
    { enabled: false },
    auditFn,
  );
  if ("kind" in updateResult) throw new Error("Unexpected error");
  state = updateResult.state;

  const rotateResult = capability.rotateProviderSecret(state, "tenant1", "test-provider", "***NEW***", auditFn);
  if ("kind" in rotateResult) throw new Error("Unexpected error");
  state = rotateResult.state;

  const enableResult = capability.enableProvider(state, "tenant1", "test-provider", auditFn);
  if ("kind" in enableResult) throw new Error("Unexpected error");
  state = enableResult.state;

  const disableResult = capability.disableProvider(state, "tenant1", "test-provider", auditFn);
  if ("kind" in disableResult) throw new Error("Unexpected error");
  state = disableResult.state;

  const importResult = capability.importOidcDiscovery(
    state,
    "tenant1",
    "test-provider",
    { issuer: "https://issuer.example.com", jwks_uri: "https://issuer.example.com/jwks.json" },
    auditFn,
  );
  if ("kind" in importResult) throw new Error("Unexpected error");
  state = importResult.state;

  const testResult = capability.testProviderConnection(state, "tenant1", "test-provider", auditFn);
  if ("kind" in testResult) throw new Error("Unexpected error");
  state = testResult.state;

  const deleteResult = capability.deleteProvider(state, "tenant1", "test-provider", auditFn);
  if ("kind" in deleteResult) throw new Error("Unexpected error");
  state = deleteResult.state;

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writePolicyResult = capability.writePolicy(state, "tenant1", policy, auditFn);
  if ("kind" in writePolicyResult) throw new Error("Unexpected error");
  state = writePolicyResult.state;

  const readPolicyResult = capability.readPolicy(state, "tenant1");
  if ("kind" in readPolicyResult) throw new Error("Unexpected error");
  assert.equal(readPolicyResult.mfaMode, "REQUIRED_TOTP");

  const mappings: capability.AuthenticationPlatformClaimMapping[] = [
    { claimName: "role", roleName: "admin" },
  ];
  const writeMappingsResult = capability.writeClaimMappings(state, "tenant1", mappings, auditFn);
  if ("kind" in writeMappingsResult) throw new Error("Unexpected error");
  state = writeMappingsResult.state;

  const readMappingsResult = capability.readClaimMappings(state, "tenant1");
  if ("kind" in readMappingsResult) throw new Error("Unexpected error");
  assert.equal(readMappingsResult.length, 1);
});

test("authenticationplatformpermissions", () => {
  let state = capability.initialState;

  const tenantContext = capability.resolveTenantContext(state, "tenant1");
  if ("kind" in tenantContext) throw new Error("Unexpected error");
  assert.equal(tenantContext.tenantId, "tenant1");
  assert.deepStrictEqual(tenantContext.tenantRoles, []);

  const nullTenantContext = capability.resolveTenantContext(state, null);
  if ("kind" in nullTenantContext) throw new Error("Unexpected error");
  assert.equal(nullTenantContext.tenantId, "");

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writeResult = capability.writePolicy(state, "tenant1", policy, () => null);
  if ("kind" in writeResult) throw new Error("Unexpected error");
  state = writeResult.state;

  const readResult = capability.readPolicy(state, "tenant1");
  if ("kind" in readResult) throw new Error("Unexpected error");
  assert.equal(readResult.mfaMode, "REQUIRED_TOTP");

  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"] as const,
    "***REDACTED***",
    () => null,
  );
  if ("kind" in createResult) throw new Error("Unexpected error");
  state = createResult.state;

  const listResult = capability.listProviders(state, "tenant1");
  if ("kind" in listResult) throw new Error("Unexpected error");
  assert.equal(listResult.length, 1);

  const mappings: capability.AuthenticationPlatformClaimMapping[] = [
    { claimName: "role", roleName: "admin" },
  ];
  const writeMappingsResult = capability.writeClaimMappings(state, "tenant1", mappings, () => null);
  if ("kind" in writeMappingsResult) throw new Error("Unexpected error");
  state = writeMappingsResult.state;

  const readMappingsResult = capability.readClaimMappings(state, "tenant1");
  if ("kind" in readMappingsResult) throw new Error("Unexpected error");
  assert.equal(readMappingsResult.length, 1);

  const callbackUrl = capability.deriveCallbackUrl(state, "example.com");
  assert.equal(callbackUrl, "https://auth.anqr.dev");
});

test("authenticationplatformproof", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn,
  );
  if ("kind" in sessionResult) throw new Error("Unexpected error");
  assert.equal(sessionResult.session.state, "AUTHENTICATED");
  state = sessionResult.state;

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.equal(validMfaMode, null);

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.equal(validThreshold, null);

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.equal(validLifespan, null);

  const validClaimName = capability.validateClaimName("valid_claim");
  assert.equal(validClaimName, null);

  const validRealmRole = capability.validateRealmRole("admin", ["admin", "user"]);
  assert.equal(validRealmRole, null);

  const validUrls = capability.validateOidcUrls(
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
  );
  assert.equal(validUrls, null);

  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"] as const,
    "***REDACTED***",
    auditFn,
  );
  if ("kind" in createResult) throw new Error("Unexpected error");
  state = createResult.state;

  const getResult = capability.getProvider(state, "test-provider");
  if ("kind" in getResult) throw new Error("Unexpected error");
  assert.equal(getResult.issuer, "https://issuer.example.com");

  const updateResult = capability.updateProvider(
    state,
    "tenant1",
    "test-provider",
    { maskedSecret: "***NEW_REDACTED***" },
    auditFn,
  );
  if ("kind" in updateResult) throw new Error("Unexpected error");
  state = updateResult.state;

  const updatedProvider = capability.getProvider(state, "test-provider");
  if ("kind" in updatedProvider) throw new Error("Unexpected error");
  assert.equal(updatedProvider.maskedSecret, "***NEW_REDACTED***");

  const importResult = capability.importOidcDiscovery(
    state,
    "tenant1",
    "test-provider",
    { issuer: "https://issuer.example.com", jwks_uri: "https://issuer.example.com/jwks.json" },
    auditFn,
  );
  if ("kind" in importResult) throw new Error("Unexpected error");
  state = importResult.state;

  const testResult = capability.testProviderConnection(state, "tenant1", "test-provider", auditFn);
  if ("kind" in testResult) throw new Error("Unexpected error");
  state = testResult.state;

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writePolicyResult = capability.writePolicy(state, "tenant1", policy, auditFn);
  if ("kind" in writePolicyResult) throw new Error("Unexpected error");
  state = writePolicyResult.state;

  const readPolicyResult = capability.readPolicy(state, "tenant1");
  if ("kind" in readPolicyResult) throw new Error("Unexpected error");
  assert.equal(readPolicyResult.mfaMode, "REQUIRED_TOTP");
  assert.equal(readPolicyResult.lockoutThreshold, 5);
  assert.equal(readPolicyResult.sessionLifespanSeconds, 3600);

  const restoredPolicy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "NONE",
    lockoutThreshold: 10,
    sessionLifespanSeconds: 7200,
  };
  const restorePolicyResult = capability.writePolicy(state, "tenant1", restoredPolicy, auditFn);
  if ("kind" in restorePolicyResult) throw new Error("Unexpected error");
  state = restorePolicyResult.state;

  const mappings: capability.AuthenticationPlatformClaimMapping[] = [
    { claimName: "role", roleName: "admin" },
  ];
  const writeMappingsResult = capability.writeClaimMappings(state, "tenant1", mappings, auditFn);
  if ("kind" in writeMappingsResult) throw new Error("Unexpected error");
  state = writeMappingsResult.state;

  const readMappingsResult = capability.readClaimMappings(state, "tenant1");
  if ("kind" in readMappingsResult) throw new Error("Unexpected error");
  assert.equal(readMappingsResult.length, 1);
  assert.equal(readMappingsResult[0]?.claimName, "role");

  const callbackUrl = capability.deriveCallbackUrl(state, "example.com");
  assert.equal(callbackUrl, "https://auth.anqr.dev");
});

test("authenticationplatformreadinessmodel", () => {
  assert.equal(capability.initialState.readiness, "DEGRADED");

  const readiness = capability.checkReadiness(capability.initialState, null);
  assert.equal(readiness.kind, "DEGRADED");

  const tenantReadiness = capability.checkReadiness(capability.initialState, "tenant1");
  assert.equal(tenantReadiness.kind, "MISSING_CREDENTIAL");

  const fixtureState = capability.setFixtureMode(capability.initialState, true);
  assert.equal(fixtureState.fixtureMode, true);
  assert.equal(fixtureState.identityProvidersAvailable, true);
  assert.equal(fixtureState.sessionStoreAvailable, true);
  assert.equal(fixtureState.configurationAvailable, true);

  const fixtureReadiness = capability.checkReadiness(fixtureState, null);
  assert.equal(fixtureReadiness.kind, "READY");

  const credential: capability.AuthenticationPlatformTenantCredential = {
    tenantId: "tenant1",
    present: true,
    canRead: true,
    canWrite: true,
  };
  const credentialState = capability.setTenantCredential(capability.initialState, credential);
  const credentialReadiness = capability.checkReadiness(credentialState, "tenant1");
  assert.equal(credentialReadiness.kind, "CONFIGURED_OK");

  const invalidCredential: capability.AuthenticationPlatformTenantCredential = {
    tenantId: "tenant2",
    present: true,
    canRead: false,
    canWrite: false,
  };
  const invalidCredentialState = capability.setTenantCredential(capability.initialState, invalidCredential);
  const invalidReadiness = capability.checkReadiness(invalidCredentialState, "tenant2");
  assert.equal(invalidReadiness.kind, "INVALID_CREDENTIAL");

  const missingReadiness = capability.checkReadiness(capability.initialState, "tenant3");
  assert.equal(missingReadiness.kind, "MISSING_CREDENTIAL");

  const absentCredential: capability.AuthenticationPlatformTenantCredential = {
    tenantId: "tenant4",
    present: false,
    canRead: false,
    canWrite: false,
  };
  const absentCredentialState = capability.setTenantCredential(capability.initialState, absentCredential);
  const absentReadiness = capability.checkReadiness(absentCredentialState, "tenant4");
  assert.equal(absentReadiness.kind, "MISSING_CREDENTIAL");
});

test("authenticationplatformstatemodel", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn,
  );
  if ("kind" in sessionResult) throw new Error("Unexpected error");
  const session = sessionResult.session;
  assert.equal(session.state, "AUTHENTICATED");
  assert.equal(session.userId, "user1");
  assert.deepStrictEqual(session.roles, ["role1"]);
  assert.deepStrictEqual(session.permissionBundle, ["tenant:tenant1:role1"]);
  assert.equal(session.displayName, "User One");
  assert.equal(session.tenantId, "tenant1");
  assert.equal(session.organisationId, null);
  assert.ok(session.id.length > 0);
  assert.ok(session.expiry.length > 0);
  state = sessionResult.state;

  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"] as const,
    "***REDACTED***",
    auditFn,
  );
  if ("kind" in createResult) throw new Error("Unexpected error");
  state = createResult.state;

  const provider = state.providers.get("test-provider");
  assert.ok(provider !== undefined);
  assert.equal(provider.alias, "test-provider");
  assert.equal(provider.enabled, true);
  assert.equal(provider.maskedSecret, "***REDACTED***");
  assert.deepStrictEqual(provider.scopes, ["openid"]);
  assert.deepStrictEqual(provider.discoveryValidation, {
    issuerValid: true,
    jwksValid: true,
    jwksUriValid: true,
  });

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  assert.equal(policy.mfaMode, "REQUIRED_TOTP");
  assert.equal(policy.lockoutThreshold, 5);
  assert.equal(policy.sessionLifespanSeconds, 3600);

  const activeDomain: capability.AuthenticationPlatformDomain = {
    domain: "example.com",
    verified: true,
    active: true,
  };
  assert.equal(activeDomain.domain, "example.com");
  assert.equal(activeDomain.verified, true);
  assert.equal(activeDomain.active, true);

  const stateWithDomain: capability.AuthenticationPlatformState = {
    ...state,
    domains: new Map([["example.com", activeDomain]]),
  };
  const callbackUrl = capability.deriveCallbackUrl(stateWithDomain, "example.com");
  assert.equal(callbackUrl, "https://example.com/auth/callback");

  const fallbackUrl = capability.deriveCallbackUrl(state, "unknown.com");
  assert.equal(fallbackUrl, "https://auth.anqr.dev");
});

test("authenticationplatformuisemantics", () => {
  const model = capability.authenticationPlatformUiSemanticModel;

  assert.deepStrictEqual(model.surfaces, ["login", "callback", "session", "admin"]);
  assert.deepStrictEqual(model.viewModels, ["LoginViewModel", "CallbackViewModel", "SessionViewModel", "AdminViewModel"]);
  assert.deepStrictEqual(model.components, ["LoginForm", "CallbackHandler", "SessionDisplay", "AdminPanel"]);
  assert.deepStrictEqual(model.journeys, ["loginJourney", "callbackJourney", "sessionJourney", "adminJourney"]);
  assert.deepStrictEqual(model.permissions, ["READ_AUTH_SETTINGS", "WRITE_AUTH_SETTINGS"]);
  assert.deepStrictEqual(model.accessibility, ["screenReader", "keyboardNav", "highContrast"]);
  assert.deepStrictEqual(model.localisation, ["en", "fr", "de"]);
  assert.deepStrictEqual(model.rendererContracts, ["ReactRenderer", "VueRenderer", "AngularRenderer"]);

  assert.equal(model.surfaces.includes("login"), true);
  assert.equal(model.viewModels.includes("LoginViewModel"), true);
  assert.equal(model.components.includes("LoginForm"), true);
  assert.equal(model.journeys.includes("loginJourney"), true);
  assert.equal(model.permissions.includes("READ_AUTH_SETTINGS"), true);
  assert.equal(model.rendererContracts.includes("ReactRenderer"), true);
});

test("authenticationplatformvalidation", () => {
  const validReturnTo = capability.validateReturnTo("/valid-path");
  assert.equal(validReturnTo, null);

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  if (invalidReturnTo === null) throw new Error("Expected error");
  assert.equal(invalidReturnTo.kind, "INVALID_RETURN_TO");

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.equal(validMfaMode, null);

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null);
  if (invalidMfaMode === null) throw new Error("Expected error");
  assert.equal(invalidMfaMode.kind, "INVALID_MFA_MODE");

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.equal(validThreshold, null);

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null);
  if (invalidThreshold === null) throw new Error("Expected error");
  assert.equal(invalidThreshold.kind, "INVALID_LOCKOUT_THRESHOLD");

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.equal(validLifespan, null);

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null);
  if (invalidLifespan === null) throw new Error("Expected error");
  assert.equal(invalidLifespan.kind, "INVALID_SESSION_LIFESPAN");

  const validClaimName = capability.validateClaimName("valid_claim");
  assert.equal(validClaimName, null);

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null);
  if (invalidClaimName === null) throw new Error("Expected error");
  assert.equal(invalidClaimName.kind, "DANGEROUS_CLAIM_NAME");

  const validRealmRole = capability.validateRealmRole("admin", ["admin", "user"]);
  assert.equal(validRealmRole, null);

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null);
  if (invalidRealmRole === null) throw new Error("Expected error");
  assert.equal(invalidRealmRole.kind, "INVALID_REALM_ROLE");

  const validUrls = capability.validateOidcUrls(
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
  );
  assert.equal(validUrls, null);

  const invalidUrls = capability.validateOidcUrls(
    "http://insecure.com",
    "http://insecure.com/jwks",
  );
  assert.notStrictEqual(invalidUrls, null);
  if (invalidUrls === null) throw new Error("Expected error");
  assert.equal(invalidUrls.kind, "UNSAFE_SCHEME");

  const localUrls = capability.validateOidcUrls("http://localhost", "http://localhost/jwks");
  assert.equal(localUrls, null);

  const validAlias = capability.validateProviderAlias("new-provider", []);
  assert.equal(validAlias, null);

  const invalidAlias = capability.validateProviderAlias("", ["existing"]);
  assert.notStrictEqual(invalidAlias, null);
  if (invalidAlias === null) throw new Error("Expected error");
  assert.equal(invalidAlias.kind, "VALIDATION_ERROR");

  const reservedAlias = capability.validateProviderAlias("existing", ["existing"]);
  assert.notStrictEqual(reservedAlias, null);
  if (reservedAlias === null) throw new Error("Expected error");
  assert.equal(reservedAlias.kind, "RESERVED_ALIAS");
});