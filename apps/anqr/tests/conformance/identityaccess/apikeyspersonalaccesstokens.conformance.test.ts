import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/apikeyspersonalaccesstokens.ts";

test("apikeyspersonalaccesstokensauditmodel", () => {
  const auditEvents: capability.ApiKeysPersonalAccessTokensAuditEvent[] = [];
  const config: capability.ApiKeysPersonalAccessTokensConfig = {
    repository: {
      create: () => ({ active: true, revokedAt: null, createdAt: "2024-01-01T00:00:00Z", lastUsedAt: null, expiry: null, keyPrefix: "ak-1234", scopes: [], hash: "h", salt: "s" }),
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
  const failingAuditConfig: capability.ApiKeysPersonalAccessTokensConfig = {
    ...config,
    audit: () => ({ kind: "AUDIT_VIOLATION", message: "audit fail" } as const),
    repository: {
      ...config.repository,
      create: () => { throw new Error("Should not be called"); },
    },
  };
  const failingCreateResult = capability.createKey(failingAuditConfig, "t1", []);
  assert.ok("kind" in failingCreateResult);
  assert.strictEqual(failingCreateResult.kind, "AUDIT_VIOLATION");

  auditEvents.length = 0;
  const revokeResult = capability.revokeKey(config, "t1", (createResult as { keyId: string }).keyId);
  assert.ok(!("kind" in revokeResult));
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].kind, "KEY_REVOKED");

  auditEvents.length = 0;
  capability.readKeyMetadata(config, "t1", (createResult as { keyId: string }).keyId);
  assert.strictEqual(auditEvents.length, 0);
});