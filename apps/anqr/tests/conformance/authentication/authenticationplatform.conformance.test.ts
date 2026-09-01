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
    ["role1"] as const,
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"] as const,
  );
  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };

  const result = capability.destroySession(newState, session.id, auditFn);
  if ("kind" in result) throw new Error("Unexpected error");
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "SESSION_DESTROYED");
  assert.strictEqual(auditEvents[0].operation, undefined);

  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"] as const,
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(newState, providerInput, auditFn);
  if ("kind" in providerResult) throw new Error("Unexpected error");
  assert.strictEqual(auditEvents.length, 3);
  assert.strictEqual(auditEvents[1].kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditEvents[1].alias, "test-provider");
  assert.strictEqual(auditEvents[1].operation, "createProvider");
  assert.deepStrictEqual(auditEvents[1].changedFields, ["alias", "enabled", "issuer", "jwksUri", "scopes"]);
  assert.strictEqual(auditEvents[1].secretChanged, true);
  assert.strictEqual(auditEvents[2].kind, "PROVIDER_CREATED");

  const lookupResult = capability.lookupSession(newState, session.id);
  if ("kind" in lookupResult) throw new Error("Unexpected error");
  assert.strictEqual(auditEvents.length, 3);
});

test("authenticationplatformcontracts", () => {
  const state = capability.initialState;
  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"] as const,
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"] as const,
  );
  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };

  const lookupResult = capability.lookupSession(newState, session.id);
  if ("kind" in lookupResult) throw new Error("Unexpected error");
  assert.strictEqual(lookupResult.userId, "user1");
  assert.deepStrictEqual(lookupResult.roles, ["role1"]);
  assert.deepStrictEqual(lookupResult.permissionBundle, ["tenant:tenant1:role1"]);

  const auditFn = () => {};
  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"] as const,
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(newState, providerInput, auditFn);
  if ("kind" in providerResult) throw new Error("Unexpected error");
  const provider = providerResult.providers.get("test-provider");
  assert.strictEqual(provider?.maskedSecret, "***REDACTED***");
});

test("authenticationplatformerrormodel", () => {
  const state = capability.initialState;

  const lookupResult = capability.lookupSession(state, "nonexistent");
  assert.ok("kind" in lookupResult);
  assert.strictEqual(lookupResult.kind, "UNAUTHENTICATED");

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.strictEqual(invalidReturnTo?.kind, "INVALID_RETURN_TO");

  const existingAliases = ["existing"] as const;
  const reservedAlias = capability.validateProviderAlias("existing", Array.from(existingAliases));
  assert.notStrictEqual(reservedAlias, null);
  assert.strictEqual(reservedAlias?.kind, "RESERVED_ALIAS");

  const unsafeUrls = capability.validateOidcUrls("http://insecure.com", "http://insecure.com/jwks");
  assert.notStrictEqual(unsafeUrls, null);
  assert.strictEqual(unsafeUrls?.kind, "UNSAFE_SCHEME");
});

test("authenticationplatformlifecycle", () => {
  const auditFn = () => {};
  const state = capability.initialState;

  const pkce = capability.generatePkceChallenge();
  assert.ok(pkce.codeVerifier.length > 0);
  assert.ok(pkce.codeChallenge.length > 0);

  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"] as const,
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"] as const,
  );
  assert.ok(session.id.length > 0);
  assert.strictEqual(session.state, "AUTHENTICATED");

  const newState = {
    ...state,
    sessions: new Map(state.sessions).set(session.id, session),
  };
  const destroyResult = capability.destroySession(newState, session.id, auditFn);
  if ("kind" in destroyResult) throw new Error("Unexpected error");
  assert.strictEqual(destroyResult.sessions.get(session.id), undefined);

  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"] as const,
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(newState, providerInput, auditFn);
  if ("kind" in providerResult) throw new Error("Unexpected error");
  assert.ok(providerResult.providers.has("test-provider"));
});

test("authenticationplatformpermissions", () => {
  const permissions = capability.resolvePermissionBundle(
    ["tenant-role"] as const,
    ["system-admin"] as const,
    "tenant1",
  );
  assert.deepStrictEqual(permissions, [
    "tenant:tenant1:tenant-role",
    "system:admin",
  ]);

  const nullTenantPermissions = capability.resolvePermissionBundle(
    ["tenant-role"] as const,
    ["system-admin"] as const,
    null,
  );
  assert.deepStrictEqual(nullTenantPermissions, ["system:admin"]);
});

test("authenticationplatformproof", () => {
  const auditFn = () => {};
  const state = capability.initialState;

  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"] as const,
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"] as const,
    "AUTHENTICATING",
  );
  assert.strictEqual(session.state, "AUTHENTICATING");

  const providerInput = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"] as const,
    secret: "test-secret",
  };
  const providerResult = capability.createProvider(state, providerInput, auditFn);
  if ("kind" in providerResult) throw new Error("Unexpected error");
  const provider = providerResult.providers.get("test-provider");
  assert.strictEqual(provider?.maskedSecret, "***REDACTED***");
});

test("authenticationplatformreadinessmodel", () => {
  assert.strictEqual(capability.initialState.readiness, "DEGRADED");

  const readinessValues: readonly capability.AuthenticationPlatformReadiness[] = [
    "READY",
    "MISSING_CREDENTIAL",
    "INVALID_CREDENTIAL",
    "FORBIDDEN_REALM_OPERATION",
    "REALM_UNREACHABLE",
    "DISCOVERY_INVALID",
    "DEGRADED",
  ] as const;
  assert.deepStrictEqual(
    readinessValues.sort(),
    capability.AuthenticationPlatformReadiness.slice().sort(),
  );
});

test("authenticationplatformstatemodel", () => {
  const session = capability.createSession(
    "user1",
    "tenant1",
    null,
    ["role1"] as const,
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"] as const,
    "UNAUTHENTICATED",
  );
  assert.strictEqual(session.state, "UNAUTHENTICATED");

  const provider: capability.AuthenticationPlatformProvider = {
    alias: "test-provider",
    enabled: true,
    issuer: "https://issuer.example.com",
    jwksUri: "https://issuer.example.com/.well-known/jwks.json",
    scopes: ["openid", "profile"] as const,
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
  assert.ok(Array.isArray(capability.AuthenticationPlatformAuditEventKind));
  assert.ok(Array.isArray(capability.AuthenticationPlatformErrorKind));
  assert.ok(Array.isArray(capability.AuthenticationPlatformReadiness));
  assert.ok(Array.isArray(capability.AuthenticationPlatformMfaMode));
  assert.ok(Array.isArray(capability.AuthenticationPlatformSessionState));
});

test("authenticationplatformvalidation", () => {
  const validReturnTo = capability.validateReturnTo("/valid-path");
  assert.strictEqual(validReturnTo, null);

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.strictEqual(invalidReturnTo?.kind, "INVALID_RETURN_TO");

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  if ("kind" in validMfaMode) throw new Error("Unexpected error");
  assert.strictEqual(validMfaMode, "REQUIRED_TOTP");

  const invalidMfaMode = capability.validateMfaMode("INVALID");
  assert.ok("kind" in invalidMfaMode);
  assert.strictEqual(invalidMfaMode.kind, "INVALID_MFA_MODE");

  const validThreshold = capability.validateLockoutThreshold(5);
  if ("kind" in validThreshold) throw new Error("Unexpected error");
  assert.strictEqual(validThreshold, 5);

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.ok("kind" in invalidThreshold);
  assert.strictEqual(invalidThreshold.kind, "INVALID_LOCKOUT_THRESHOLD");

  const validLifespan = capability.validateSessionLifespan(3600);
  if ("kind" in validLifespan) throw new Error("Unexpected error");
  assert