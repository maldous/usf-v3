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

  const destroyResult = capability.destroySession(newState, session.id, auditFn);
  assert.ok(!("kind" in destroyResult));
  assert.strictEqual(auditEvents.length, 2);
  assert.strictEqual(auditEvents[0].kind, "AUDIT_BEFORE_CHANGE");
  assert.strictEqual(auditEvents[0].alias, "tenant1");
  assert.strictEqual(auditEvents[0].operation, "destroySession");
  assert.deepStrictEqual(auditEvents[0].changedFields, ["sessionId"]);
  assert.strictEqual(auditEvents[0].secretChanged, false);
  assert.strictEqual(auditEvents[1].kind, "SESSION_DESTROYED");

  const lookupResult = capability.lookupSession(newState, session.id);
  assert.ok(!("kind" in lookupResult));
  assert.strictEqual(auditEvents.length, 2);
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

  const lookupResult = capability.lookupSession(newState, session.id);
  assert.ok(!("kind" in lookupResult));
  assert.strictEqual(lookupResult.userId, "user1");
  assert.deepStrictEqual(lookupResult.roles, ["role1"]);
  assert.deepStrictEqual(lookupResult.permissionBundle, ["tenant:tenant1:role1"]);
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
  assert.ok(!("kind" in destroyResult));
  assert.strictEqual(destroyResult.sessions.get(session.id), undefined);
});

test("authenticationplatformpermissions", () => {
  const permissions = capability.resolvePermissionBundle(
    ["tenant-role"],
    ["system-admin"],
    "tenant1",
  );
  assert.deepStrictEqual(permissions, [
    "tenant:tenant1:tenant-role",
    "system:admin",
  ]);

  const nullTenantPermissions = capability.resolvePermissionBundle(
    ["tenant-role"],
    ["system-admin"],
    null,
  );
  assert.deepStrictEqual(nullTenantPermissions, ["system:admin"]);

  const hasReadPermission = capability.checkAdminPermission(
    "tenant1",
    ["tenant:tenant1:read-auth-settings"],
    "readAuthSettings"
  );
  assert.strictEqual(hasReadPermission, true);

  const hasWritePermission = capability.checkAdminPermission(
    "tenant1",
    ["tenant:tenant1:write-auth-settings"],
    "writeAuthSettings"
  );
  assert.strictEqual(hasWritePermission, true);

  const missingPermission = capability.checkAdminPermission(
    "tenant1",
    ["tenant:tenant1:read-auth-settings"],
    "writeAuthSettings"
  );
  assert.strictEqual(missingPermission, false);
});

test("authenticationplatformproof", () => {
  const auditFn = () => {};
  const state = capability.initialState;

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

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.ok(!("kind" in validMfaMode));
  assert.strictEqual(validMfaMode, "REQUIRED_TOTP");

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.ok(!("kind" in validThreshold));
  assert.strictEqual(validThreshold, 5);

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.ok(!("kind" in validLifespan));
  assert.strictEqual(validLifespan, 3600);
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
    "CONFIGURED_OK",
  ] as const;
  assert.deepStrictEqual(
    [...readinessValues].sort(),
    [...capability.AuthenticationPlatformReadiness].sort(),
  );
});

test("authenticationplatformstatemodel", () => {
  const session = capability.createSession(
    "user1",
    "tenant1",
    "org1",
    ["role1"],
    "User One",
    new Date(Date.now() + 3600000).toISOString(),
    ["tenant:tenant1:role1"],
    "UNAUTHENTICATED",
  );
  assert.strictEqual(session.state, "UNAUTHENTICATED");
  assert.strictEqual(session.tenantId, "tenant1");
  assert.strictEqual(session.organisationId, "org1");

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
  assert.deepStrictEqual(
    capability.AuthenticationPlatformUiSemanticModel.surfaces,
    ["login", "callback", "logout", "admin"]
  );
  assert.deepStrictEqual(
    capability.AuthenticationPlatformUiSemanticModel.viewModels,
    ["loginView", "adminProviderView", "adminPolicyView", "adminMappingView"]
  );
  assert.deepStrictEqual(
    capability.AuthenticationPlatformUiSemanticModel.components,
    ["loginForm", "providerCard", "policyEditor", "mappingTable"]
  );
});

test("authenticationplatformvalidation", () => {
  const validReturnTo = capability.validateReturnTo("/valid-path");
  assert.strictEqual(validReturnTo, null);

  const invalidReturnTo = capability.validateReturnTo("http://evil.com");
  assert.notStrictEqual(invalidReturnTo, null);
  assert.strictEqual(invalidReturnTo?.kind, "INVALID_RETURN_TO");

  const validMfaMode = capability.validateMfaMode("REQUIRED_TOTP");
  assert.ok(!("kind" in validMfaMode));
  assert.strictEqual(validMfaMode, "REQUIRED_TOTP");

  const invalidMfaMode = capability.validateMfaMode("INVALID");
  assert.ok("kind" in invalidMfaMode);
  assert.strictEqual(invalidMfaMode.kind, "INVALID_MFA_MODE");

  const validThreshold = capability.validateLockoutThreshold(5);
  assert.ok(!("kind" in validThreshold));
  assert.strictEqual(validThreshold, 5);

  const invalidThreshold = capability.validateLockoutThreshold(-1);
  assert.ok("kind" in invalidThreshold);
  assert.strictEqual(invalidThreshold.kind, "INVALID_LOCKOUT_THRESHOLD");

  const validLifespan = capability.validateSessionLifespan(3600);
  assert.ok(!("kind" in validLifespan));
  assert.strictEqual(validLifespan, 3600);

  const invalidLifespan = capability.validateSessionLifespan(0);
  assert.ok("kind" in invalidLifespan);
  assert.strictEqual(invalidLifespan.kind, "INVALID_SESSION_LIFESPAN");

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
});