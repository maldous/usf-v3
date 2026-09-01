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

  // Test session creation audit
  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn
  );
  assert.ok(!("kind" in sessionResult), "createSession should succeed");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].kind, "SESSION_CREATED");
  assert.equal(auditEvents[0].operation, "createSession");
  state = sessionResult.state;

  // Test session destruction audit
  const destroyResult = capability.destroySession(state, sessionResult.session.id, auditFn);
  assert.ok(!("kind" in destroyResult), "destroySession should succeed");
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[1].kind, "SESSION_DESTROYED");
  assert.equal(auditEvents[1].operation, "destroySession");

  // Test lookup doesn't audit
  const lookupResult = capability.lookupSession(state, sessionResult.session.id);
  assert.ok("kind" in lookupResult);
  assert.equal(auditEvents.length, 2, "Lookup should not add audit events");

  // Test provider creation audit
  const providerResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"],
    "***REDACTED***",
    auditFn
  );
  assert.ok(!("kind" in providerResult), "createProvider should succeed");
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[2].kind, "AUDIT_BEFORE_CHANGE");
  assert.equal(auditEvents[2].alias, "test-provider");
  assert.equal(auditEvents[2].operation, "createProvider");
  assert.deepStrictEqual(auditEvents[2].changedFields, ["alias", "issuer", "jwksUri", "scopes", "maskedSecret"]);
  assert.equal(auditEvents[2].secretChanged, true);

  // Test audit failure aborts mutation
  const failingAuditFn = () => ({ kind: "AUDIT_VIOLATION", message: "Test audit failure" } as const);
  const failResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider-2",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"],
    "***REDACTED***",
    failingAuditFn
  );
  assert.ok("kind" in failResult);
  assert.equal(failResult.kind, "AUDIT_VIOLATION");
  assert.equal(auditEvents.length, 3, "Failed audit should not add provider");
});

test("authenticationplatformcontracts", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  // Test session operations
  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn
  );
  assert.ok(!("kind" in sessionResult));
  assert.equal(sessionResult.session.userId, "user1");
  assert.deepStrictEqual(sessionResult.session.roles, ["role1"]);
  assert.deepStrictEqual(sessionResult.session.permissionBundle, ["tenant:tenant1:role1"]);
  state = sessionResult.state;

  // Test session lookup
  const lookupResult = capability.lookupSession(state, sessionResult.session.id);
  assert.ok(!("kind" in lookupResult));
  assert.equal(lookupResult.userId, "user1");

  // Test provider enumeration
  const providers = capability.listProviders(state, "tenant1");
  assert.ok(!("kind" in providers));
  assert.equal(providers.length, 0);

  // Test PKCE generation
  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);

  // Test login initiation
  const preAuthResult = capability.initiateLogin(state, "/valid-path", "nonexistent", auditFn);
  assert.ok("kind" in preAuthResult);
  assert.equal(preAuthResult.kind, "NOT_FOUND");

  // Test forward auth check
  const authCheck = capability.forwardAuthCheck(state, sessionResult.session.id);
  assert.equal(authCheck.authenticated, true);
  assert.equal(authCheck.session?.userId, "user1");

  // Test provider CRUD
  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"],
    "***REDACTED***",
    auditFn
  );
  assert.ok(!("kind" in createResult));
  assert.equal(createResult.result, "NO_CONTENT");
  state = createResult.state;

  const getResult = capability.getProvider(state, "test-provider");
  assert.ok(!("kind" in getResult));
  assert.equal(getResult.issuer, "https://issuer.example.com");
  assert.equal(getResult.maskedSecret, "***REDACTED***");

  // Test policy operations
  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writePolicyResult = capability.writePolicy(state, "tenant1", policy, auditFn);
  assert.ok(!("kind" in writePolicyResult));
  assert.equal(writePolicyResult.result, "NO_CONTENT");
  state = writePolicyResult.state;

  const readPolicyResult = capability.readPolicy(state, "tenant1");
  assert.ok(!("kind" in readPolicyResult));
  assert.equal(readPolicyResult.mfaMode, "REQUIRED_TOTP");

  // Test claim mappings
  const mappings: capability.AuthenticationPlatformClaimMapping[] = [
    { claimName: "role", roleName: "admin" }
  ];
  const writeMappingsResult = capability.writeClaimMappings(state, "tenant1", mappings, auditFn);
  assert.ok(!("kind" in writeMappingsResult));
  assert.equal(writeMappingsResult.result, "NO_CONTENT");
  state = writeMappingsResult.state;

  const readMappingsResult = capability.readClaimMappings(state, "tenant1");
  assert.ok(!("kind" in readMappingsResult));
  assert.equal(readMappingsResult.length, 1);
  assert.equal(readMappingsResult[0].claimName, "role");
});

test("authenticationplatformerrormodel", () => {
  const state = capability.initialState;

  // Test unauthenticated session lookup
  const lookupResult = capability.lookupSession(state, "nonexistent");
  assert.ok("kind" in lookupResult);
  assert.equal(lookupResult.kind, "UNAUTHENTICATED");

  // Test session store unavailable
  const unavailableState: capability.AuthenticationPlatformState = {
    ...state,
    sessionStoreAvailable: false,
    fixtureMode: false,
  };
  const unavailableLookup = capability.lookupSession(unavailableState, "any");
  assert.ok("kind" in unavailableLookup);
  assert.equal(unavailableLookup.kind, "SESSION_LOOKUP_FAILURE");

  // Test validation errors
  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.equal(invalidReturnTo.kind, "INVALID_RETURN_TO");

  const reservedAlias = capability.validateProviderAlias("existing", ["existing"]);
  assert.notStrictEqual(reservedAlias, null);
  assert.equal(reservedAlias.kind, "RESERVED_ALIAS");

  const unsafeUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(unsafeUrls, null);
  assert.equal(unsafeUrls.kind, "UNSAFE_SCHEME");

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null);
  assert.equal(invalidMfaMode.kind, "INVALID_MFA_MODE");

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null);
  assert.equal(invalidThreshold.kind, "INVALID_LOCKOUT_THRESHOLD");

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null);
  assert.equal(invalidLifespan.kind, "INVALID_SESSION_LIFESPAN");

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null);
  assert.equal(invalidClaimName.kind, "DANGEROUS_CLAIM_NAME");

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null);
  assert.equal(invalidRealmRole.kind, "INVALID_REALM_ROLE");

  // Test callback with provider error
  const callbackResult = capability.handleCallback(
    state,
    "code",
    "state",
    "nonce",
    "provider_error",
    () => null
  );
  assert.ok("kind" in callbackResult);
  assert.equal(callbackResult.kind, "PROVIDER_ERROR_CALLBACK");
});

test("authenticationplatformlifecycle", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  // Test PKCE generation
  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);

  // Test session lifecycle
  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn
  );
  assert.ok(!("kind" in sessionResult));
  assert.equal(sessionResult.session.state, "AUTHENTICATED");
  state = sessionResult.state;

  const destroyResult = capability.destroySession(state, sessionResult.session.id, auditFn);
  assert.ok(!("kind" in destroyResult));
  assert.equal(destroyResult.result, "NO_CONTENT");
  state = destroyResult.state;

  const lookupAfterDestroy = capability.lookupSession(state, sessionResult.session.id);
  assert.ok("kind" in lookupAfterDestroy);
  assert.equal(lookupAfterDestroy.kind, "UNAUTHENTICATED");

  // Test provider lifecycle
  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"],
    "***REDACTED***",
    auditFn
  );
  assert.ok(!("kind" in createResult));
  state = createResult.state;

  const preAuthResult = capability.initiateLogin(state, "/valid-path", "test-provider", auditFn);
  assert.ok(!("kind" in preAuthResult));
  assert.equal(preAuthResult.preAuth.providerAlias, "test-provider");

  const updateResult = capability.updateProvider(
    state,
    "tenant1",
    "test-provider",
    { enabled: false },
    auditFn
  );
  assert.ok(!("kind" in updateResult));
  state = updateResult.state;

  const deleteResult = capability.deleteProvider(state, "tenant1", "test-provider", auditFn);
  assert.ok(!("kind" in deleteResult));
  state = deleteResult.state;

  // Test policy lifecycle
  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writePolicyResult = capability.writePolicy(state, "tenant1", policy, auditFn);
  assert.ok(!("kind" in writePolicyResult));
  state = writePolicyResult.state;

  const readPolicyResult = capability.readPolicy(state, "tenant1");
  assert.ok(!("kind" in readPolicyResult));
  assert.equal(readPolicyResult.mfaMode, "REQUIRED_TOTP");

  // Test claim mappings lifecycle
  const mappings: capability.AuthenticationPlatformClaimMapping[] = [
    { claimName: "role", roleName: "admin" }
  ];
  const writeMappingsResult = capability.writeClaimMappings(state, "tenant1", mappings, auditFn);
  assert.ok(!("kind" in writeMappingsResult));
  state = writeMappingsResult.state;

  const readMappingsResult = capability.readClaimMappings(state, "tenant1");
  assert.ok(!("kind" in readMappingsResult));
  assert.equal(readMappingsResult.length, 1);
});

test("authenticationplatformpermissions", () => {
  let state = capability.initialState;

  // Test tenant context resolution
  const tenantContext = capability.resolveTenantContext(state, "tenant1");
  assert.ok(!("kind" in tenantContext));
  assert.equal(tenantContext.tenantId, "tenant1");
  assert.deepStrictEqual(tenantContext.tenantRoles, []);

  const nullTenantContext = capability.resolveTenantContext(state, null);
  assert.ok(!("kind" in nullTenantContext));
  assert.equal(nullTenantContext.tenantId, "");

  // Test policy operations with tenant context
  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writeResult = capability.writePolicy(state, "tenant1", policy, () => null);
  assert.ok(!("kind" in writeResult));
  assert.equal(writeResult.result, "NO_CONTENT");
  state = writeResult.state;

  const readState = { ...state, policies: new Map(state.policies).set("tenant1", policy) };
  const readResult = capability.readPolicy(readState, "tenant1");
  assert.ok(!("kind" in readResult));
  assert.equal(readResult.mfaMode, "REQUIRED_TOTP");

  // Test provider operations with tenant context
  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"],
    "***REDACTED***",
    () => null
  );
  assert.ok(!("kind" in createResult));
  state = createResult.state;

  const listResult = capability.listProviders(state, "tenant1");
  assert.ok(!("kind" in listResult));
  assert.equal(listResult.length, 1);

  // Test claim mappings with tenant context
  const mappings: capability.AuthenticationPlatformClaimMapping[] = [
    { claimName: "role", roleName: "admin" }
  ];
  const writeMappingsResult = capability.writeClaimMappings(state, "tenant1", mappings, () => null);
  assert.ok(!("kind" in writeMappingsResult));
  state = writeMappingsResult.state;

  const readMappingsResult = capability.readClaimMappings(state, "tenant1");
  assert.ok(!("kind" in readMappingsResult));
  assert.equal(readMappingsResult.length, 1);

  // Test callback URL derivation
  const callbackUrl = capability.deriveCallbackUrl(state, "example.com");
  assert.equal(callbackUrl, "https://auth.anqr.dev");
});

test("authenticationplatformproof", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  // Test session creation and state
  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn
  );
  assert.ok(!("kind" in sessionResult));
  assert.equal(sessionResult.session.state, "AUTHENTICATED");
  state = sessionResult.state;

  // Test validation functions
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
    "https://issuer.example.com/.well-known/jwks.json"
  );
  assert.equal(validUrls, null);

  // Test provider operations
  const createResult = capability.createProvider(
    state,
    "tenant1",
    "test-provider",
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json",
    ["openid"],
    "***REDACTED***",
    auditFn
  );
  assert.ok(!("kind" in createResult));
  state = createResult.state;

  const getResult = capability.getProvider(state, "test-provider");
  assert.ok(!("kind" in getResult));
  assert.equal(getResult.issuer, "https://issuer.example.com");

  const updateResult = capability.updateProvider(
    state,
    "tenant1",
    "test-provider",
    { maskedSecret: "***NEW_REDACTED***" },
    auditFn
  );
  assert.ok(!("kind" in updateResult));
  state = updateResult.state;

  const updatedProvider = capability.getProvider(state, "test-provider");
  assert.ok(!("kind" in updatedProvider));
  assert.equal(updatedProvider.maskedSecret, "***NEW_REDACTED***");

  // Test policy round-trip
  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writePolicyResult = capability.writePolicy(state, "tenant1", policy, auditFn);
  assert.ok(!("kind" in writePolicyResult));
  state = writePolicyResult.state;

  const readPolicyResult = capability.readPolicy(state, "tenant1");
  assert.ok(!("kind" in readPolicyResult));
  assert.equal(readPolicyResult.mfaMode, "REQUIRED_TOTP");
  assert.equal(readPolicyResult.lockoutThreshold, 5);
  assert.equal(readPolicyResult.sessionLifespanSeconds, 3600);
});

test("authenticationplatformreadinessmodel", () => {
  // Test initial state readiness
  assert.equal(capability.initialState.readiness, "DEGRADED");

  // Test readiness checks
  const readiness = capability.checkReadiness(capability.initialState, null);
  assert.equal(readiness.kind, "DEGRADED");

  const tenantReadiness = capability.checkReadiness(capability.initialState, "tenant1");
  assert.equal(tenantReadiness.kind, "MISSING_CREDENTIAL");

  // Test fixture mode
  const fixtureState = capability.setFixtureMode(capability.initialState, true);
  assert.equal(fixtureState.fixtureMode, true);
  assert.equal(fixtureState.identityProvidersAvailable, true);
  assert.equal(fixtureState.sessionStoreAvailable, true);
  assert.equal(fixtureState.configurationAvailable, true);

  const fixtureReadiness = capability.checkReadiness(fixtureState, null);
  assert.equal(fixtureReadiness.kind, "READY");

  // Test credential-based readiness
  const credential: capability.AuthenticationPlatformTenantCredential = {
    tenantId: "tenant1",
    present: true,
    canRead: true,
    canWrite: true,
  };
  const credentialState = capability.setTenantCredential(capability.initialState, credential);
  const credentialReadiness = capability.checkReadiness(credentialState, "tenant1");
  assert.equal(credentialReadiness.kind, "CONFIGURED_OK");

  // Test invalid credential
  const invalidCredential: capability.AuthenticationPlatformTenantCredential = {
    tenantId: "tenant2",
    present: true,
    canRead: false,
    canWrite: false,
  };
  const invalidCredentialState = capability.setTenantCredential(capability.initialState, invalidCredential);
  const invalidReadiness = capability.checkReadiness(invalidCredentialState, "tenant2");
  assert.equal(invalidReadiness.kind, "INVALID_CREDENTIAL");

  // Test missing credential
  const missingReadiness = capability.checkReadiness(capability.initialState, "tenant3");
  assert.equal(missingReadiness.kind, "MISSING_CREDENTIAL");
});

test("authenticationplatformstatemodel", () => {
  const auditFn = () => null;
  let state = capability.initialState;

  // Test session state
  const sessionResult = capability.createSession(
    state,
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn
  );
  assert.ok(!("kind" in sessionResult));
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

  // Test provider state
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
  assert.equal(provider.alias, "test-provider");
  assert.equal(provider.enabled, true);
  assert.equal(provider.maskedSecret, "***REDACTED***");
  assert.deepStrictEqual(provider.scopes, ["openid", "profile"]);
  assert.deepStrictEqual(provider.discoveryValidation, {
    issuerValid: true,
    jwksValid: true,
    jwksUriValid: true,
  });

  // Test policy state
  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  assert.equal(policy.mfaMode, "REQUIRED_TOTP");
  assert.equal(policy.lockoutThreshold, 5);
  assert.equal(policy.sessionLifespanSeconds, 3600);

  // Test domain state
  const domain: capability.AuthenticationPlatformDomain = {
    domain: "example.com",
    verified: true,
    active: true,
  };
  assert.equal(domain.domain, "example.com");
  assert.equal(domain.verified, true);
  assert.equal(domain.active, true);

  // Test callback URL derivation
  const callbackUrl = capability.deriveCallbackUrl(
    { ...state, domains: new Map().set("example.com", domain) },
    "example.com"
  );
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
});

test("authenticationplatformvalidation", () => {
  // Test return-to validation
  const validReturnTo = capability.validateReturnTo("/valid-path");
  assert.equal(validReturnTo, null);

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.equal(invalidReturnTo.kind, "INVALID_RETURN_TO");

  // Test MFA mode validation
  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.equal(validMfaMode, null);

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null);
  assert.equal(invalidMfaMode.kind, "INVALID_MFA_MODE");

  // Test lockout threshold validation
  const validThreshold = capability.validateLockoutThreshold(5);
  assert.equal(validThreshold, null);

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null);
  assert.equal(invalidThreshold.kind, "INVALID_LOCKOUT_THRESHOLD");

  // Test session lifespan validation
  const validLifespan = capability.validateSessionLifespan(3600);
  assert.equal(validLifespan, null);

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null);
  assert.equal(invalidLifespan.kind, "INVALID_SESSION_LIFESPAN");

  // Test claim name validation
  const validClaimName = capability.validateClaimName("valid_claim");
  assert.equal(validClaimName, null);

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null);
  assert.equal(invalidClaimName.kind, "DANGEROUS_CLAIM_NAME");

  // Test realm role validation
  const validRealmRole = capability.validateRealmRole("admin", ["admin", "user"]);
  assert.equal(validRealmRole, null);

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null);
  assert.equal(invalidRealmRole.kind, "INVALID_REALM_ROLE");

  // Test OIDC URL validation
  const validUrls = capability.validateOidcUrls(
    "https://issuer.example.com",
    "https://issuer.example.com/.well-known/jwks.json"
  );
  assert.equal(validUrls, null);

  const invalidUrls = capability.validateOidcUrls(
    "http://insecure.com",
    "http://insecure.com/jwks"
  );
  assert.notStrictEqual(invalidUrls, null);
  assert.equal(invalidUrls.kind, "UNSAFE_SCHEME");

  // Test localhost URLs are allowed with HTTP
  const localUrls = capability.validateOidcUrls(
    "http://localhost",
    "http://localhost/jwks"
  );
  assert.equal(localUrls, null);

  // Test provider alias validation
  const validAlias = capability.validateProviderAlias("new-provider", []);
  assert.equal(validAlias, null);

  const invalidAlias = capability.validateProviderAlias("", ["existing"]);
  assert.notStrictEqual(invalidAlias, null);
  assert.equal(invalidAlias.kind, "VALIDATION_ERROR");

  const reservedAlias = capability.validateProviderAlias("existing", ["existing"]);
  assert.notStrictEqual(reservedAlias, null);
  assert.equal(reservedAlias.kind, "RESERVED_ALIAS");
});