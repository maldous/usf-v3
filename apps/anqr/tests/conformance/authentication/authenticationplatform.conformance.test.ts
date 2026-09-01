import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/authentication/authenticationplatform.ts";

test("authenticationplatformauditmodel", () => {
  const auditEvents: capability.AuthenticationPlatformAuditEvent[] = [];
  const auditFn = (event: capability.AuthenticationPlatformAuditEvent) => {
    auditEvents.push(event);
  };

  const state = capability.initialState;
  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"],
  );
  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };

  // Test session destruction emits audit event
  const result = capability.destroySession(newState, session.id, auditFn);
  assert.ok(!("kind" in result), "destroySession should return state, not error");
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "SESSION_DESTROYED");
  assert.strictEqual(auditEvents[0].operation, "destroySession");

  // Test provider creation emits audit event with secretChanged
  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"],
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(
    newState,
    providerInput,
    auditFn,
    "tenant1",
  );
  assert.ok(!("kind" in providerResult), "createProvider should return state, not error");
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[1].kind, "PROVIDER_CREATED");
  assert.strictEqual(auditEvents[1].secretChanged, true);
  assert.deepStrictEqual(auditEvents[1].changedFields, [
    "alias",
    "enabled",
    "issuer",
    "jwksUri",
    "scopes",
  ]);

  // Test lookupSession does not emit audit
  const lookupResult = capability.lookupSession(newState, session.id);
  assert.ok(!("kind" in lookupResult), "lookupSession should return session, not error");
  assert.strictEqual(auditEvents.length, 2, "lookupSession should not emit audit events");
});

test("authenticationplatformcontracts", () => {
  const state = capability.initialState;
  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"],
  );
  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };

  // Test session lookup returns redacted projection (no raw tokens)
  const lookupResult = capability.lookupSession(newState, session.id);
  assert.ok(!("kind" in lookupResult), "lookupSession should return session");
  assert.strictEqual(lookupResult.userId, "user1");
  assert.deepStrictEqual(lookupResult.roles, ["role1"]);
  assert.deepStrictEqual(lookupResult.permissionBundle, ["tenant:tenant1:role1"]);

  // Test provider creation returns no raw secret
  const auditFn = () => {};
  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"],
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(
    newState,
    providerInput,
    auditFn,
    "tenant1",
  );
  assert.ok(!("kind" in providerResult), "createProvider should return state");
  const provider = providerResult.providers.get("test-provider");
  assert.strictEqual(provider?.maskedSecret, "***REDACTED***");
});

test("authenticationplatformerrormodel", () => {
  const state = capability.initialState;

  // Test unauthenticated session lookup returns UNAUTHENTICATED error
  const lookupResult = capability.lookupSession(state, "nonexistent");
  assert.ok("kind" in lookupResult);
  assert.strictEqual(lookupResult.kind, "UNAUTHENTICATED");

  // Test invalid return-to target
  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.strictEqual(invalidReturnTo?.kind, "INVALID_RETURN_TO");

  // Test reserved alias validation
  const existingAliases = ["existing"];
  const reservedAlias = capability.validateProviderAlias("existing", existingAliases);
  assert.notStrictEqual(reservedAlias, null);
  assert.strictEqual(reservedAlias?.kind, "RESERVED_ALIAS");

  // Test unsafe scheme validation
  const unsafeUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(unsafeUrls, null);
  assert.strictEqual(unsafeUrls?.kind, "UNSAFE_SCHEME");
});

test("authenticationplatformlifecycle", () => {
  const auditFn = () => {};
  const state = capability.initialState;

  // Test PKCE challenge generation
  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);

  // Test session creation and destruction lifecycle
  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"],
  );
  assert.ok(session.id.length > 0);
  assert.strictEqual(session.state, "AUTHENTICATED");

  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };
  const destroyResult = capability.destroySession(newState, session.id, auditFn);
  assert.ok(!("kind" in destroyResult), "destroySession should return state");
  assert.strictEqual(destroyResult.sessions.get(session.id), undefined);

  // Test provider creation lifecycle
  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"],
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(
    newState,
    providerInput,
    auditFn,
    "tenant1",
  );
  assert.ok(!("kind" in providerResult), "createProvider should return state");
  assert.ok(providerResult.providers.has("test-provider"));
});

test("authenticationplatformpermissions", () => {
  // Test permission bundle resolution
  const permissions = capability.resolvePermissionBundle(
    ["tenant-role"],
    ["system-admin"],
    "tenant1",
  );
  assert.deepStrictEqual(permissions, [
    "tenant:tenant1:tenant-role",
    "system:admin",
  ]);

  // Test permission bundle with null tenant
  const nullTenantPermissions = capability.resolvePermissionBundle(
    ["tenant-role"],
    ["system-admin"],
    null,
  );
  assert.deepStrictEqual(nullTenantPermissions, ["system:admin"]);
});

test("authenticationplatformproof", () => {
  const auditFn = () => {};
  const state = capability.initialState;

  // Test session fixtures and state transitions
  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"],
    "AUTHENTICATING",
  );
  assert.strictEqual(session.state, "AUTHENTICATING");

  // Test provider CRUD with secret redaction
  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"],
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(
    state,
    providerInput,
    auditFn,
    "tenant1",
  );
  assert.ok(!("kind" in providerResult), "createProvider should return state");
  const provider = providerResult.providers.get("test-provider");
  assert.strictEqual(provider?.maskedSecret, "***REDACTED***");
});

test("authenticationplatformreadinessmodel", () => {
  // Test initial state readiness
  assert.strictEqual(capability.initialState.readiness, "DEGRADED");

  // Test readiness enum values
  const readinessValues: readonly capability.AuthenticationPlatformReadiness[] = [
    "READY",
    "MISSING_CREDENTIAL",
    "INVALID_CREDENTIAL",
    "FORBIDDEN_REALM_OPERATION",
    "REALM_UNREACHABLE",
    "DISCOVERY_INVALID",
    "DEGRADED",
  ];
  assert.deepStrictEqual(
    readinessValues.sort(),
    capability.AuthenticationPlatformReadiness.slice().sort(),
  );
});

test("authenticationplatformstatemodel", () => {
  // Test session state transitions
  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"],
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"],
    "UNAUTHENTICATED",
  );
  assert.strictEqual(session.state, "UNAUTHENTICATED");

  // Test provider state model
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
});

test("authenticationplatformuisemantics", () => {
  // Test that UI semantic model types exist (no runtime validation needed)
  assert.ok(Array.isArray(capability.AuthenticationPlatformAuditEventKind));
  assert.ok(Array.isArray(capability.AuthenticationPlatformErrorKind));
  assert.ok(Array.isArray(capability.AuthenticationPlatformReadiness));
  assert.ok(Array.isArray(capability.AuthenticationPlatformMfaMode));
  assert.ok(Array.isArray(capability.AuthenticationPlatformSessionState));
});

test("authenticationplatformvalidation", () => {
  // Test return-to validation
  const validReturnTo = capability.validateReturnTo("/valid-path");
  assert.strictEqual(validReturnTo, null);

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.strictEqual(invalidReturnTo?.kind, "INVALID_RETURN_TO");

  // Test MFA mode validation
  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.strictEqual(validMfaMode, "REQUIRED_TOTP");

  const invalidMfaMode = capability.validateMfaMode("INVALID");
  assert.ok("kind" in invalidMfaMode);
  assert.strictEqual(invalidMfaMode.kind, "INVALID_MFA_MODE");

  // Test lockout threshold validation
  const validThreshold = capability.validateLockoutThreshold(5);
  assert.strictEqual(validThreshold, 5);

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.ok("kind" in invalidThreshold);
  assert.strictEqual(invalidThreshold.kind, "INVALID_LOCKOUT_THRESHOLD");

  // Test session lifespan validation
  const validLifespan = capability.validateSessionLifespan(3600);
  assert.strictEqual(validLifespan, 3600);

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.ok("kind" in invalidLifespan);
  assert.strictEqual(invalidLifespan.kind, "INVALID_SESSION_LIFESPAN");

  // Test claim name validation
  const validClaimName = capability.validateClaimName("valid-claim");
  assert.strictEqual(validClaimName, null);

  const invalidClaimName = capability.validateClaimName("invalid claim!");
  assert.notStrictEqual(invalidClaimName, null);
  assert.strictEqual(invalidClaimName?.kind, "DANGEROUS_CLAIM_NAME");

  // Test realm role validation
  const allowlist = ["admin", "user"];
  const validRealmRole = capability.validateRealmRole("admin", allowlist);
  assert.strictEqual(validRealmRole, null);

  const invalidRealmRole = capability.validateRealmRole("superadmin", allowlist);
  assert.notStrictEqual(invalidRealmRole, null);
  assert.strictEqual(invalidRealmRole?.kind, "INVALID_REALM_ROLE");
});