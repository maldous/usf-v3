import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/authentication/authenticationplatform.ts";

test("authenticationplatformauditmodel", () => {
  const auditEvents: capability.AuthenticationPlatformAuditEvent[] = [];
  const auditFn = (event: capability.AuthenticationPlatformAuditEvent): capability.AuthenticationPlatformError | null => {
    auditEvents.push(event);
    return null;
  };

  const state = capability.initialState;
  const session = capability.createSession(
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
  assert.ok(!("kind" in session));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "SESSION_CREATED");

  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };

  const destroyResult = capability.destroySession(newState, session.id, auditFn);
  assert.ok(!("kind" in destroyResult));
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[1].kind, "SESSION_DESTROYED");

  const lookupResult = capability.lookupSession(newState, session.id);
  assert.ok(!("kind" in lookupResult));
  assert.strictEqual(auditEvents.length, 2);

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
  assert.ok(!("kind" in providerError));
  assert.strictEqual(auditEvents.length, 3);
  assert.strictEqual(auditEvents[2].kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditEvents[2].alias, providerAlias);
  assert.strictEqual(auditEvents[2].operation, "createProvider");
  assert.deepStrictEqual(auditEvents[2].changedFields, ["alias", "issuer", "jwksUri", "scopes", "maskedSecret"]);
  assert.strictEqual(auditEvents[2].secretChanged, true);
});

test("authenticationplatformcontracts", () => {
  const auditFn = () => null;
  const state = capability.initialState;

  const session = capability.createSession(
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
  assert.ok(!("kind" in session));
  assert.strictEqual(session.userId, "user1");
  assert.deepStrictEqual(session.roles, ["role1"]);
  assert.deepStrictEqual(session.permissionBundle, ["tenant:tenant1:role1"]);

  const lookupResult = capability.lookupSession(
    { ...state, sessions: new Map(state.sessions).set(session.id, session) },
    session.id,
  );
  assert.ok(!("kind" in lookupResult));
  assert.strictEqual(lookupResult.userId, "user1");

  const providers = capability.listProviders(state, "tenant1");
  assert.ok(!("kind" in providers));
  assert.strictEqual(providers.length, 0);

  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);

  const preAuth = capability.initiateLogin(
    state,
    "/valid-path",
    "test-provider",
    auditFn,
  );
  assert.ok("kind" in preAuth);
  assert.strictEqual(preAuth.kind, "NOT_FOUND");
});

test("authenticationplatformerrormodel", () => {
  const state = capability.initialState;

  const lookupResult = capability.lookupSession(state, "nonexistent");
  assert.ok("kind" in lookupResult);
  assert.strictEqual(lookupResult.kind, "UNAUTHENTICATED");

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.strictEqual(invalidReturnTo?.kind, "INVALID_RETURN_TO");

  const existingAliases = ["existing"];
  const reservedAlias = capability.validateProviderAlias("existing", existingAliases);
  assert.notStrictEqual(reservedAlias, null);
  assert.strictEqual(reservedAlias?.kind, "RESERVED_ALIAS");

  const unsafeUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(unsafeUrls, null);
  assert.strictEqual(unsafeUrls?.kind, "UNSAFE_SCHEME");

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null);
  assert.strictEqual(invalidMfaMode?.kind, "INVALID_MFA_MODE");

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null);
  assert.strictEqual(invalidThreshold?.kind, "INVALID_LOCKOUT_THRESHOLD");

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null);
  assert.strictEqual(invalidLifespan?.kind, "INVALID_SESSION_LIFESPAN");

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null);
  assert.strictEqual(invalidClaimName?.kind, "DANGEROUS_CLAIM_NAME");

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null);
  assert.strictEqual(invalidRealmRole?.kind, "INVALID_REALM_ROLE");
});

test("authenticationplatformlifecycle", () => {
  const auditFn = () => null;
  const state = capability.initialState;

  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);

  const session = capability.createSession(
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
  assert.ok(!("kind" in session));
  assert.strictEqual(session.state, "AUTHENTICATED");

  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };
  const destroyResult = capability.destroySession(newState, session.id, auditFn);
  assert.ok(!("kind" in destroyResult));

  const lookupAfterDestroy = capability.lookupSession(newState, session.id);
  assert.ok("kind" in lookupAfterDestroy);
  assert.strictEqual(lookupAfterDestroy.kind, "UNAUTHENTICATED");

  const provider: capability.AuthenticationPlatformProvider = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid"],
    maskedSecret: "***REDACTED***",
    discoveryValidation: { issuerValid: true, jwksValid: true, jwksUriValid: true },
  };
  const stateWithProvider = {
    ...state,
    providers: new Map(state.providers).set(provider.alias, provider),
  };

  const preAuth = capability.initiateLogin(stateWithProvider, "/valid-path", provider.alias, auditFn);
  assert.ok(!("kind" in preAuth));
  assert.strictEqual(preAuth.providerAlias, provider.alias);
});

test("authenticationplatformpermissions", () => {
  const state = capability.initialState;
  const tenantContext = capability.resolveTenantContext(state, "tenant1");
  assert.ok(!("kind" in tenantContext));
  assert.strictEqual(tenantContext.tenantId, "tenant1");

  const nullTenantContext = capability.resolveTenantContext(state, null);
  assert.ok(!("kind" in nullTenantContext));
  assert.strictEqual(nullTenantContext.tenantId, "");

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  const writeResult = capability.writePolicy(state, "tenant1", policy, () => null);
  assert.ok(!("kind" in writeResult));
  assert.strictEqual(writeResult.result, "NO_CONTENT");

  const readResult = capability.readPolicy(
    { ...state, policies: new Map(state.policies).set("tenant1", policy) },
    "tenant1",
  );
  assert.ok(!("kind" in readResult));
  assert.strictEqual(readResult.mfaMode, "REQUIRED_TOTP");
});

test("authenticationplatformproof", () => {
  const auditFn = () => null;
  const state = capability.initialState;

  const session = capability.createSession(
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
  assert.ok(!("kind" in session));
  assert.strictEqual(session.state, "AUTHENTICATED");

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.strictEqual(validMfaMode, null);

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.strictEqual(validThreshold, null);

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.strictEqual(validLifespan, null);

  const validClaimName = capability.validateClaimName("valid_claim");
  assert.strictEqual(validClaimName, null);

  const validRealmRole = capability.validateRealmRole("admin", ["admin", "user"]);
  assert.strictEqual(validRealmRole, null);

  const validUrls = capability.validateOidcUrls("https://issuer.example.com", "https://issuer.example.com/.well-known/jwks.json");
  assert.strictEqual(validUrls, null);
});

test("authenticationplatformreadinessmodel", () => {
  assert.strictEqual(capability.initialState.readiness, "DEGRADED");

  const readiness = capability.checkReadiness(capability.initialState, null);
  assert.strictEqual(readiness.kind, "DEGRADED");

  const tenantReadiness = capability.checkReadiness(capability.initialState, "tenant1");
  assert.strictEqual(tenantReadiness.kind, "FORBIDDEN_REALM_OPERATION");

  const readyState: capability.AuthenticationPlatformState = {
    ...capability.initialState,
    readiness: "READY",
  };
  const configuredReadiness = capability.checkReadiness(readyState, "tenant1");
  assert.strictEqual(configuredReadiness.kind, "CONFIGURED_OK");
});

test("authenticationplatformstatemodel", () => {
  const auditFn = () => null;
  const state = capability.initialState;

  const session = capability.createSession(
    state,
    "user1",
    "tenant1",
    "org1",
    ["role1"],
    "User One",
    ["tenant:tenant1:role1"],
    new Date(Date.now() + 3600000).toISOString(),
    auditFn,
  );
  assert.ok(!("kind" in session));
  assert.strictEqual(session.state, "AUTHENTICATED");
  assert.strictEqual(session.userId, "user1");
  assert.strictEqual(session.tenantId, "tenant1");
  assert.strictEqual(session.organisationId, "org1");
  assert.deepStrictEqual(session.roles, ["role1"]);
  assert.deepStrictEqual(session.permissionBundle, ["tenant:tenant1:role1"]);
  assert.strictEqual(session.displayName, "User One");

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
  assert.strictEqual(provider.alias, "test-provider");
  assert.strictEqual(provider.maskedSecret, "***REDACTED***");

  const policy: capability.AuthenticationPlatformPolicy = {
    mfaMode: "REQUIRED_TOTP",
    lockoutThreshold: 5,
    sessionLifespanSeconds: 3600,
  };
  assert.strictEqual(policy.mfaMode, "REQUIRED_TOTP");
  assert.strictEqual(policy.lockoutThreshold, 5);
  assert.strictEqual(policy.sessionLifespanSeconds, 3600);
});

test("authenticationplatformuisemantics", () => {
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.surfaces,
    ["login", "callback", "session", "admin"],
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.viewModels,
    ["LoginViewModel", "CallbackViewModel", "SessionViewModel", "AdminViewModel"],
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.components,
    ["LoginForm", "CallbackHandler", "SessionDisplay", "AdminPanel"],
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.journeys,
    ["loginJourney", "callbackJourney", "sessionJourney", "adminJourney"],
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.permissions,
    ["READ_AUTH_SETTINGS", "WRITE_AUTH_SETTINGS"],
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.accessibility,
    ["screenReader", "keyboardNav", "highContrast"],
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.localisation,
    ["en", "fr", "de"],
  );
  assert.deepStrictEqual(
    capability.authenticationPlatformUiSemanticModel.rendererContracts,
    ["ReactRenderer", "VueRenderer", "AngularRenderer"],
  );
});

test("authenticationplatformvalidation", () => {
  const validReturnTo = capability.validateReturnTo("/valid-path");
  assert.strictEqual(validReturnTo, null);

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.strictEqual(invalidReturnTo?.kind, "INVALID_RETURN_TO");

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.strictEqual(validMfaMode, null);

  const invalidMfaMode = capability.validateMfaMode("INVALID" as capability.AuthenticationPlatformMfaMode);
  assert.notStrictEqual(invalidMfaMode, null);
  assert.strictEqual(invalidMfaMode?.kind, "INVALID_MFA_MODE");

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.strictEqual(validThreshold, null);

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.notStrictEqual(invalidThreshold, null);
  assert.strictEqual(invalidThreshold?.kind, "INVALID_LOCKOUT_THRESHOLD");

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.strictEqual(validLifespan, null);

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.notStrictEqual(invalidLifespan, null);
  assert.strictEqual(invalidLifespan?.kind, "INVALID_SESSION_LIFESPAN");

  const validClaimName = capability.validateClaimName("valid_claim");
  assert.strictEqual(validClaimName, null);

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null);
  assert.strictEqual(invalidClaimName?.kind, "DANGEROUS_CLAIM_NAME");

  const validRealmRole = capability.validateRealmRole("admin", ["admin", "user"]);
  assert.strictEqual(validRealmRole, null);

  const invalidRealmRole = capability.validateRealmRole("invalid", ["admin", "user"]);
  assert.notStrictEqual(invalidRealmRole, null);
  assert.strictEqual(invalidRealmRole?.kind, "INVALID_REALM_ROLE");

  const validUrls = capability.validateOidcUrls("https://issuer.example.com", "https://issuer.example.com/.well-known/jwks.json");
  assert.strictEqual(validUrls, null);

  const invalidUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(invalidUrls, null);
  assert.strictEqual(invalidUrls?.kind, "UNSAFE_SCHEME");

  const localUrls = capability.validateOidcUrls("http://localhost", "http://localhost/jwks");
  assert.strictEqual(localUrls, null);
});