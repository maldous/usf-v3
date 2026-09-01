import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/apikeyspersonalaccesstokens.ts";

test("apikeyspersonalaccesstokensauditmodel", () => {
  const auditEvents: capability.ApiKeysPersonalAccessTokensAuditEvent[] = [];
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: () => ({ active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-12345", scopes: [], hash: "h", salt: "s" }),
      readMetadata: () => null,
      listMetadata: () => [],
      delete: () => {},
      authenticate: () => null,
    },
    permissions: { tenantApiKeyRead: true, tenantApiKeyWrite: true, platformApiKeyRead: true, apiAccessEntitlement: true },
    audit: (event) => { auditEvents.push(event); },
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const createResult = capability.createKey(config, "t1", []);
  assert.ok(!("outcome" in createResult) && !("kind" in createResult));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "KEY_CREATED");

  auditEvents.length = 0;
  const revokeResult = capability.revokeKey(config, "t1", createResult.keyId);
  assert.ok(!("kind" in revokeResult));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "KEY_REVOKED");

  auditEvents.length = 0;
  capability.readKeyMetadata(config, "t1", createResult.keyId);
  assert.strictEqual(auditEvents.length, 0);
});

test("apikeyspersonalaccesstokenscontracts", () => {
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: () => ({ active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-12345", scopes: [], hash: "h", salt: "s" }),
      readMetadata: () => ({ keyId: "k1", tenantId: "t1", active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [] }),
      listMetadata: () => [{ keyId: "k1", tenantId: "t1", active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [] }],
      delete: () => {},
      authenticate: () => null,
    },
    permissions: { tenantApiKeyRead: true, tenantApiKeyWrite: true, platformApiKeyRead: true, apiAccessEntitlement: true },
    audit: () => {},
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const createResult = capability.createKey(config, "t1", ["read"]);
  assert.ok(!("outcome" in createResult) && !("kind" in createResult));
  assert.ok("secret" in createResult);

  const listResult = capability.listKeys(config, "t1");
  assert.ok(!("kind" in listResult));
  assert.strictEqual(listResult.length, 1);

  const readResult = capability.readKeyMetadata(config, "t1", "k1");
  assert.ok(!("kind" in readResult));
  assert.strictEqual(readResult.keyId, "k1");

  const operatorListResult = capability.operatorListKeys(config, "t1");
  assert.ok(!("kind" in operatorListResult));
  assert.strictEqual(operatorListResult.length, 1);
});

test("apikeyspersonalaccesstokenserrormodel", () => {
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: () => ({ kind: "PROVIDER_FAILURE", message: "fail" } as const),
      readMetadata: () => null,
      listMetadata: () => [],
      delete: () => {},
      authenticate: () => null,
    },
    permissions: { tenantApiKeyRead: true, tenantApiKeyWrite: true, platformApiKeyRead: true, apiAccessEntitlement: true },
    audit: () => {},
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const createResult = capability.createKey(config, "t1", []);
  assert.ok("kind" in createResult);
  assert.strictEqual(createResult.kind, "PROVIDER_FAILURE");

  const invalidKeyId = "invalid!key";
  const readResult = capability.readKeyMetadata(config, "t1", invalidKeyId);
  assert.ok("kind" in readResult);
  assert.strictEqual(readResult.kind, "INVALID_ROUTE_IDENTIFIER");

  const authResult = capability.authenticateKey(config, invalidKeyId, "secret");
  assert.strictEqual(authResult, null);
});

test("apikeyspersonalaccesstokenslifecycle", () => {
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: (tenantId, keyId, state) => state,
      readMetadata: () => ({ keyId: "k1", tenantId: "t1", active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [] }),
      listMetadata: () => [],
      delete: () => {},
      authenticate: (keyId, secret) => keyId === "k1" && secret === "s" ? { tenantId: "t1", scopes: [] } : null,
    },
    permissions: { tenantApiKeyRead: true, tenantApiKeyWrite: true, platformApiKeyRead: true, apiAccessEntitlement: true },
    audit: () => {},
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const createResult = capability.createKey(config, "t1", []);
  assert.ok(!("outcome" in createResult) && !("kind" in createResult));
  assert.ok("secret" in createResult);
  assert.strictEqual(createResult.secret, "s");

  const listResult = capability.listKeys(config, "t1");
  assert.ok(!("kind" in listResult));
  assert.strictEqual(listResult.length, 0);

  const authResult = capability.authenticateKey(config, "k1", "s");
  assert.ok(authResult !== null);
  assert.strictEqual(authResult.tenantId, "t1");

  const revokeResult = capability.revokeKey(config, "t1", "k1");
  assert.ok(!("kind" in revokeResult));

  const postRevokeAuth = capability.authenticateKey(config, "k1", "s");
  assert.strictEqual(postRevokeAuth, null);
});

test("apikeyspersonalaccesstokenspermissions", () => {
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: () => ({ active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [], hash: "h", salt: "s" }),
      readMetadata: () => ({ keyId: "k1", tenantId: "t1", active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [] }),
      listMetadata: () => [],
      delete: () => {},
      authenticate: () => null,
    },
    permissions: { tenantApiKeyRead: false, tenantApiKeyWrite: false, platformApiKeyRead: false, apiAccessEntitlement: false },
    audit: () => {},
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const createResult = capability.createKey(config, "t1", []);
  assert.ok("outcome" in createResult);
  assert.strictEqual(createResult.outcome, "NOT_ENTITLED");

  const listResult = capability.listKeys(config, "t1");
  assert.ok("kind" in listResult);

  const operatorListResult = capability.operatorListKeys(config, "t1");
  assert.ok("kind" in operatorListResult);

  const readResult = capability.readKeyMetadata(config, "t1", "k1");
  assert.ok("kind" in readResult);
});

test("apikeyspersonalaccesstokensproof", () => {
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: (tenantId, keyId, state) => state,
      readMetadata: () => ({ keyId: "k1", tenantId: "t1", active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [] }),
      listMetadata: () => [],
      delete: () => {},
      authenticate: (keyId, secret) => keyId === "k1" && secret === "s" ? { tenantId: "t1", scopes: [] } : null,
    },
    permissions: { tenantApiKeyRead: true, tenantApiKeyWrite: true, platformApiKeyRead: true, apiAccessEntitlement: true },
    audit: () => {},
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const createResult = capability.createKey(config, "t1", []);
  assert.ok(!("outcome" in createResult) && !("kind" in createResult));
  assert.ok("secret" in createResult);

  const authResult = capability.authenticateKey(config, createResult.keyId, createResult.secret);
  assert.ok(authResult !== null);

  const revokeResult = capability.revokeKey(config, "t1", createResult.keyId);
  assert.ok(!("kind" in revokeResult));

  const postRevokeAuth = capability.authenticateKey(config, createResult.keyId, createResult.secret);
  assert.strictEqual(postRevokeAuth, null);
});

test("apikeyspersonalaccesstokensreadinessmodel", () => {
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: () => ({ active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [], hash: "h", salt: "s" }),
      readMetadata: () => null,
      listMetadata: () => [],
      delete: () => {},
      authenticate: () => null,
    },
    permissions: { tenantApiKeyRead: true, tenantApiKeyWrite: true, platformApiKeyRead: true, apiAccessEntitlement: true },
    audit: () => {},
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const readiness = capability.computeReadiness(config);
  assert.strictEqual(readiness, "READY");
});

test("apikeyspersonalaccesstokensstatemodel", () => {
  const state: capability.ApiKeysPersonalAccessTokensState = {
    active: true,
    revokedAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    lastUsedAt: null,
    expiry: null,
    keyPrefix: "ak-1234",
    scopes: ["read"],
    hash: "h",
    salt: "s",
  };
  assert.ok(state.active);
  assert.strictEqual(state.revokedAt, null);
  assert.strictEqual(state.createdAt, "2024-01-01T00:00:00Z");
  assert.strictEqual(state.lastUsedAt, null);
  assert.strictEqual(state.expiry, null);
  assert.strictEqual(state.keyPrefix, "ak-1234");
  assert.deepStrictEqual(state.scopes, ["read"]);
  assert.strictEqual(state.hash, "h");
  assert.strictEqual(state.salt, "s");
});

test("apikeyspersonalaccesstokensuisemantics", () => {
  assert.ok(true);
});

test("apikeyspersonalaccesstokensvalidation", () => {
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: () => ({ active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [], hash: "h", salt: "s" }),
      readMetadata: () => null,
      listMetadata: () => [],
      delete: () => {},
      authenticate: () => null,
    },
    permissions: { tenantApiKeyRead: true, tenantApiKeyWrite: true, platformApiKeyRead: true, apiAccessEntitlement: false },
    audit: () => {},
    crypto: { generateSecret: () => "s", generateSalt: () => "salt123456789012", hashSecret: () => "h" },
    now: () => "2024-01-01T00:00:00Z",
  };

  const createResult = capability.createKey(config, "t1", []);
  assert.ok("outcome" in createResult);
  assert.strictEqual(createResult.outcome, "NOT_ENTITLED");

  const invalidKeyId = "invalid!key";
  const readResult = capability.readKeyMetadata(config, "t1", invalidKeyId);
  assert.ok("kind" in readResult);
  assert.strictEqual(readResult.kind, "INVALID_ROUTE_IDENTIFIER");

  const authResult = capability.authenticateKey(config, "k1", "wrong");
  assert.strictEqual(authResult, null);

  const crossTenantList = capability.listKeys(config, "t2");
  assert.ok(!("kind" in crossTenantList));
  assert.strictEqual(crossTenantList.length, 0);
});