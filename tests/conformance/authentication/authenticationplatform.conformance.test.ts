import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/authentication/authenticationplatform.ts";

// Helper to create fresh state
function freshState() {
  return { ...capability.initialState };
}

// Helper to create a session in a given state
function createTestSession(state: capability.AuthenticationPlatformState) {
  return capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    () => null
  );
}

test("authenticationplatformauditmodel", () => {
  const auditEvents: capability.AuthenticationPlatformAuditEvent[] = [];
  const auditFn = (event: capability.AuthenticationPlatformAuditEvent): capability.AuthenticationPlatformError | null => {
    auditEvents.push(event);
    return null;
  };

  let state = freshState();

  const sessionResult = createTestSession(state);
  assert.ok(!("kind" in sessionResult), "createSession should not return an error");
  assert.equal(auditEvents.length, 1, "Should have one audit event");
  assert.equal(auditEvents[0].kind, "SESSION_CREATED", "Audit should record session creation");

  const session = sessionResult.session;
  assert.ok(session.id, "Session should have an id");
  state = sessionResult.state;

  const destroyResult = capability.destroySession(state, session.id, auditFn);
  assert.ok(!("kind" in destroyResult), "destroySession should not return an error");
  assert.equal(auditEvents.length, 2, "Should have two audit events");
  assert.equal(auditEvents[1].kind, "SESSION_DESTROYED", "Audit should record session destruction");

  const lookupResult = capability.lookupSession(state, session.id);
  assert.equal("kind" in lookupResult, true, "Session should not be found after destruction");
  assert.equal(auditEvents.length, 2, "Lookup should not add an audit event");

  const providerAlias = "test-provider";
  const providerError = capability.createProvider(
    state,
    "tenant1",
    providerAlias,
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"],
    "***REDACTED***",
    auditFn,
  );
  assert.ok(!("kind" in providerError), "createProvider should not return an error");
  assert.equal(auditEvents.length, 3, "Should have three audit events");
  assert.equal(auditEvents[2].kind, "AUDIT_BEFORE_CHANGE", "Audit should record provider creation");
  assert.equal(auditEvents[2].alias, providerAlias, "Audit should record the provider alias");
  assert.equal(auditEvents[2].operation, "createProvider", "Audit should record the correct operation");
  assert.deepStrictEqual(auditEvents[2].changedFields, ["alias", "issuer", "jwksUri", "scopes", "maskedSecret"], "Audit should list all changed fields");
  assert.equal(auditEvents[2].secretChanged, true, "Audit should indicate secret change");
});

test("authenticationplatformcontracts", () => {
  const auditFn = () => null;
  let state = freshState();

  const sessionResult = createTestSession(state);
  assert.ok(!("kind" in sessionResult), "createSession should succeed");
  const session = sessionResult.session;
  assert.equal(session.userId, "user1", "Session should have correct user ID");
  assert.deepStrictEqual(session.roles, ["role1"], "Session should have correct roles");
  assert.deepStrictEqual(session.permissionBundle, ["tenant:tenant1:role1"], "Session should have correct permission bundle");
  state = sessionResult.state;

  const lookupResult = capability.lookupSession(state, session.id);
  assert.ok(!("kind" in lookupResult), "lookupSession should find the session");
  assert.equal(lookupResult.userId, "user1", "Lookup should return correct session");

  const providers = capability.listProviders(state, "tenant1");
  assert.ok(!("kind" in providers), "listProviders should return empty list");
  assert.equal(providers.length, 0, "Should be no providers initially");

  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0, "PKCE challenge should have a code verifier");
  assert.ok(pkce.codeChallenge.length > 0, "PKCE challenge should have a code challenge");

  const preAuth = capability.initiateLogin(
    state,
    "/valid-path",
    "test-provider",
    auditFn,
  );
  assert.equal("kind" in preAuth, true, "initiateLogin should return an error for missing provider");
  assert.equal(preAuth.kind, "NOT_FOUND", "Error should be NOT_FOUND for missing provider");
});

test("authenticationplatformerrormodel", () => {
  const state = freshState();

  const lookupResult = capability.lookupSession(state, "nonexistent");
  assert.ok("kind" in lookupResult, "Session lookup should fail");
  assert.equal(lookupResult.kind, "UNAUTHENTICATED", "Error should be UNAUTHENTICATED");

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null, "Invalid returnTo should return an error");
  assert.equal(invalidReturnTo?.kind, "INVALID_RETURN_TO", "Error kind should be INVALID_RETURN_TO");

  const existingAliases = ["existing"];
  const reservedAlias = capability.validateProviderAlias("existing", existingAliases);
  assert.notStrictEqual(reservedAlias, null, "Reserved alias should return an error");
  assert.equal(reservedAlias?.kind, "RESERVED_ALIAS", "Error kind should be RESERVED_ALIAS");

  const unsafeUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(unsafeUrls, null, "Unsafe URLs should return an error");
  assert.equal(unsafeUrls?.kind, "UNSAFE_SCHEME", "Error kind should be UNSAFE_SCHEME");

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null, "Invalid MFA mode should return an error");
  assert.equal(invalidMfaMode?.kind, "INVALID_MFA_MODE", "Error kind should be INVALID_MFA_MODE");

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null, "Invalid threshold should return an error");
  assert.equal(invalidThreshold?.kind, "INVALID_LOCKOUT_THRESHOLD", "Error kind should be INVALID_LOCKOUT_THRESHOLD");

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null, "Invalid lifespan should return an error");
  assert.equal(invalidLifespan?.kind, "INVALID_SESSION_LIFESPAN", "Error kind should be INVALID_SESSION_LIFESPAN");

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null, "Invalid claim name should return an error");
  assert.equal(invalidClaimName?.kind, "DANGEROUS_CLAIM_NAME", "Error kind should be DANGEROUS_CLAIM_NAME");

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null, "Invalid realm role should return an error");
  assert.equal(invalidRealmRole?.kind, "INVALID_REALM_ROLE", "Error kind should be INVALID_REALM_ROLE");
});

test("authenticationplatformlifecycle", () => {
  const auditFn = () => null;
  let state = freshState();

  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0, "PKCE challenge should have a code verifier");
  assert.ok(pkce.codeChallenge.length > 0, "PKCE challenge should have a code challenge");

  const sessionResult = createTestSession(state);
  assert.ok(!("kind" in sessionResult), "createSession should succeed");
  const session = sessionResult.session;
  assert.equal(session.state, "AUTHENTICATED", "Session should be authenticated");
  state = sessionResult.state;

  const destroyResult = capability.destroySession(state, session.id, auditFn);
  assert.ok(!("kind" in destroyResult), "destroySession should succeed");

  const lookupAfterDestroy = capability.lookupSession(state, session.id);
  assert.equal("kind" in lookupAfterDestroy, true, "Lookup should fail after destruction");
  assert.equal(lookupAfterDestroy.kind, "UNAUTHENTICATED", "Error should be UNAUTHENTICATED");

  const provider: capability.AuthenticationPlatformProvider = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid"],
    maskedSecret: "***REDACTED***",
    discoveryValidation: { issuerValid: true, jwksValid: true, jwksUriValid: true },
  };
  state = { ...state, providers: new Map(state.providers).set(provider.alias, provider) };

  const preAuth = capability.initiateLogin(state, "/valid-path", provider.alias, auditFn);
  assert.ok(!("kind" in preAuth), "initiateLogin should succeed for existing provider");
  assert.equal(preAuth.providerAlias, provider.alias, "Pre-auth should record correct provider");
});

test("authenticationplatformpermissions", () => {
  const state = freshState();
  const tenantContext = capability.resolveTenantContext(state, "tenant1");
  assert.ok(!("kind" in tenantContext), "resolveTenantContext should succeed");
  assert.equal(tenantContext.tenantId, "tenant1", "Tenant context should have correct ID");

  const nullTenantContext = capability.resolveTenantContext(state, null);
  assert.ok(!("kind" in nullTenantContext), "resolveTenantContext with null should succeed");
  assert.equal(nullTenantContext.tenantId, "", "Null tenant context should have empty ID");

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writeResult = capability.writePolicy(state, "tenant1", policy, () => null);
  assert.ok(!("kind" in writeResult), "writePolicy should succeed");
  assert.equal(writeResult.result, "NO_CONTENT", "Write result should be NO_CONTENT");

  const readState = { ...state, policies: new Map(state.policies).set("tenant1", policy) };
  const readResult = capability.readPolicy(readState, "tenant1");
  assert.ok(!("kind" in readResult), "readPolicy should succeed");
  assert.equal(readResult.mfaMode, "REQUIRED_TOTP", "Read policy should have correct MFA mode");
});

test("authenticationplatformproof", () => {
  const auditFn = () => null;
  let state = freshState();

  const sessionResult = createTestSession(state);
  assert.ok(!("kind" in sessionResult), "createSession should succeed");
  const session = sessionResult.session;
  assert.equal(session.state, "AUTHENTICATED", "Session should be authenticated");
  state = sessionResult.state;

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.equal(validMfaMode, null, "Valid MFA mode should return null");

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.equal(validThreshold, null, "Valid threshold should return null");

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.equal(validLifespan, null, "Valid lifespan should return null");

  const validClaimName = capability.validateClaimName("valid_claim");
  assert.equal(validClaimName, null, "Valid claim name should return null");

  const validRealmRole = capability.validateRealmRole("admin", ["admin", "user"]);
  assert.equal(validRealmRole, null, "Valid realm role should return null");

  const validUrls = capability.validateOidcUrls("https://issuer.example.com", "https://issuer.example.com/.well-known/jwks.json");
  assert.equal(validUrls, null, "Valid URLs should return null");
});

test("authenticationplatformreadinessmodel", () => {
  assert.equal(capability.initialState.readiness, "DEGRADED", "Initial readiness should be DEGRADED");

  const readiness = capability.checkReadiness(capability.initialState, null);
  assert.equal(readiness.kind, "DEGRADED", "Readiness with null tenant should be DEGRADED");

  const tenantReadiness = capability.checkReadiness(capability.initialState, "tenant1");
  assert.equal(tenantReadiness.kind, "FORBIDDEN_REALM_OPERATION", "Readiness for non-existent tenant should be FORBIDDEN_REALM_OPERATION");

  const readyState: capability.AuthenticationPlatformState = {
    ...capability.initialState,
    readiness: "READY",
  };
  const configuredReadiness = capability.checkReadiness(readyState, "tenant1");
  assert.equal(configuredReadiness.kind, "CONFIGURED_OK", "Configured readiness should be CONFIGURED_OK");
});

test("authenticationplatformstatemodel", () => {
  const auditFn = () => null;
  let state = freshState();

  const sessionResult = createTestSession(state);
  assert.ok(!("kind" in sessionResult), "createSession should succeed");
  const session = sessionResult.session;
  assert.equal(session.state, "AUTHENTICATED", "Session should be authenticated");
  assert.equal(session.userId, "user1", "Session should have correct user ID");
  assert.deepStrictEqual(session.roles, ["role1"], "Session should have correct roles");
  assert.deepStrictEqual(session.permissionBundle, ["tenant:tenant1:role1"], "Session should have correct permission bundle");
  assert.equal(session.displayName, "User One", "Session should have correct display name");
  assert.equal(session.tenantId, "tenant1", "Session should have correct tenant ID");
  assert.equal(session.organisationId, null, "Session should have null organization ID");
  state = sessionResult.state;

  const provider: capability.AuthenticationPlatformProvider = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"],
    maskedSecret: "***REDACTED***",
    discoveryValidation: {
      issuerValid: true,
      jwksValid: true,
      jwksUriValid: true,
    },
  };
  assert.equal(provider.alias, "test-provider", "Provider should have correct alias");
  assert.equal(provider.maskedSecret, "***REDACTED***", "Provider should have redacted secret");

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  assert.equal(policy.mfaMode, "REQUIRED_TOTP", "Policy should have correct MFA mode");
  assert.equal(policy.lockoutThreshold, 5, "Policy should have correct lockout threshold");
  assert.equal(policy.sessionLifespanSeconds, 3600, "Policy should have correct session lifespan");
});

test("authenticationplatformuisemantics", () => {
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.surfaces,
    ["login", "callback", "session", "admin"],
    "Should have correct surfaces"
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.viewModels,
    ["LoginViewModel", "CallbackViewModel", "SessionViewModel", "AdminViewModel"],
    "Should have correct view models"
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.components,
    ["LoginForm", "CallbackHandler", "SessionDisplay", "AdminPanel"],
    "Should have correct components"
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.journeys,
    ["loginJourney", "callbackJourney", "sessionJourney", "adminJourney"],
    "Should have correct journeys"
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.permissions,
    ["READ_AUTH_SETTINGS", "WRITE_AUTH_SETTINGS"],
    "Should have correct permissions"
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.accessibility,
    ["screenReader", "keyboardNav", "highContrast"],
    "Should have correct accessibility options"
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.localisation,
    ["en", "fr", "de"],
    "Should have correct localization options"
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.rendererContracts,
    ["ReactRenderer", "VueRenderer", "AngularRenderer"],
    "Should have correct renderer contracts"
  );
});

test("authenticationplatformvalidation", () => {
  const validReturnTo = capability.validateReturnTo("/valid-path");
  assert.equal(validReturnTo, null, "Valid returnTo should return null");

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null, "Invalid returnTo should return an error");
  assert.equal(invalidReturnTo?.kind, "INVALID_RETURN_TO", "Error kind should be INVALID_RETURN_TO");

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.equal(validMfaMode, null, "Valid MFA mode should return null");

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null, "Invalid MFA mode should return an error");
  assert.equal(invalidMfaMode?.kind, "INVALID_MFA_MODE", "Error kind should be INVALID_MFA_MODE");

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.equal(validThreshold, null, "Valid threshold should return null");

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null, "Invalid threshold should return an error");
  assert.equal(invalidThreshold?.kind, "INVALID_LOCKOUT_THRESHOLD", "Error kind should be INVALID_LOCKOUT_THRESHOLD");

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.equal(validLifespan, null, "Valid lifespan should return null");

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null, "Invalid lifespan should return an error");
  assert.equal(invalidLifespan?.kind, "INVALID_SESSION_LIFESPAN", "Error kind should be INVALID_SESSION_LIFESPAN");

  const validClaimName = capability.validateClaimName("valid_claim");
  assert.equal(validClaimName, null, "Valid claim name should return null");

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null, "Invalid claim name should return an error");
  assert.equal(invalidClaimName?.kind, "DANGEROUS_CLAIM_NAME", "Error kind should be DANGEROUS_CLAIM_NAME");

  const validRealmRole = capability.validateRealmRole("admin", ["admin", "user"]);
  assert.equal(validRealmRole, null, "Valid realm role should return null");

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null, "Invalid realm role should return an error");
  assert.equal(invalidRealmRole?.kind, "INVALID_REALM_ROLE", "Error kind should be INVALID_REALM_ROLE");

  const validUrls = capability.validateOidcUrls("https://issuer.example.com", "https://issuer.example.com/.well-known/jwks.json");
  assert.equal(validUrls, null, "Valid URLs should return null");

  const invalidUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(invalidUrls, null, "Invalid URLs should return an error");
  assert.equal(invalidUrls?.kind, "UNSAFE_SCHEME", "Error kind should be UNSAFE_SCHEME");

  const localUrls = capability.validateOidcUrls("http://localhost", "http://localhost/jwks");
  assert.equal(localUrls, null, "Localhost URLs should be valid");
});