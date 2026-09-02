import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/configuration/writeonlysecretsettings.ts";

test("writeonlysecretsettingsauditmodel", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = { tenantId: "t1", permissions: ["WEBHOOK_WRITE"], environment: "test" };
  const input: capability.WriteWebhookSecretInput = { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com", secret: "s3cr3t" };

  const badAuditFn: capability.WriteOnlySecretSettingsAuditFn = () => ({ ok: false, error: "rejected" });
  const blocked = capability.writeWebhookSecret(state, input, context, badAuditFn);
  const err = blocked as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err.kind, "AUDIT_FAILURE");

  const goodAuditFn: capability.WriteOnlySecretSettingsAuditFn = () => ({ ok: true });
  const result = capability.writeWebhookSecret(state, input, context, goodAuditFn);
  assert.strictEqual((result as { success: true }).success, true);
  const newState = (result as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const audit = newState.lastAudit;
  assert.ok(audit);
  assert.deepStrictEqual(audit!.changedFields, ["endpointUrl", "secret"]);
  assert.strictEqual(audit!.hasSecret, true);
  assert.strictEqual(audit!.secretChanged, true);
  const serialized = JSON.stringify(audit);
  assert.ok(!serialized.includes("s3cr3t"));
});

test("writeonlysecretsettingscontracts", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = { tenantId: "t1", permissions: ["API_KEY_CREATE", "SETTINGS_READ"], environment: "test" };
  const createRes = capability.createRevealOnceApiKey(state, { tenantId: "t1", name: "key1" }, context, () => ({ ok: true }));
  assert.strictEqual(createRes.success, true);
  const data = (createRes as { success: true; data: capability.RevealOnceApiKeyResponse }).data;
  assert.ok(data.rawApiKeyRevealOnce.startsWith("anqr_live_"));

  const readRes = capability.readSecretSettingsMetadata(createRes.state, "t1", context);
  assert.strictEqual(readRes.success, true);
  const metadata = (readRes as { success: true; metadata: any }).metadata;
  assert.strictEqual(metadata.apiKeys.length, 1);
  const apiKeyMeta = metadata.apiKeys[0];
  assert.strictEqual(apiKeyMeta.keyHash, data.metadata.keyHash);
  assert.ok(!("rawApiKeyRevealOnce" in apiKeyMeta));
});

test("writeonlysecretsettingserrormodel", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = { tenantId: "t1", permissions: ["AUTH_SETTINGS_WRITE"], environment: "test" };

  const noCredRes = capability.rotateTenantAdminCredential(state, { tenantId: "t1", adminUsername: "admin" }, context, () => ({ ok: true }));
  const noCredErr = noCredRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(noCredErr.kind, "NO_CREDENTIAL");
  assert.ok(!noCredErr.message.includes("secret"));

  const invalidCredRes = capability.rotateTenantAdminCredential(state, { tenantId: "t1", adminUsername: "admin", newPassword: "short" }, context, () => ({ ok: true }));
  const invalidCredErr = invalidCredRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(invalidCredErr.kind, "INVALID_CREDENTIAL");
  assert.ok(!invalidCredErr.message.includes("short"));

  const valErrRes = capability.writeWebhookSecret(state, { tenantId: "t1", webhookId: "wh1", endpointUrl: "ftp://evil.com" }, context, () => ({ ok: true }));
  const valErr = valErrRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(valErr.kind, "VALIDATION_FAILURE");
  assert.ok(!valErr.message.includes("ftp://evil.com"));

  const notFoundRes = capability.revokeApiKey(state, { tenantId: "t1", keyId: "nonexistent" }, context, () => ({ ok: true }));
  const notFoundErr = notFoundRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(notFoundErr.kind, "NOT_FOUND");
});

test("writeonlysecretsettingslifecycle", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = { tenantId: "t1", permissions: ["WEBHOOK_WRITE"], environment: "test" };
  const createRes = capability.writeWebhookSecret(state, { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com", secret: "s3cr3t" }, context, () => ({ ok: true }));
  assert.strictEqual(createRes.success, true);
  const newState = (createRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const wh = newState.webhooks[0];
  assert.strictEqual(wh.hasSecret, true);
  assert.strictEqual(wh.secretHash, capability.hashSecretMaterial("s3cr3t"));

  const updateRes = capability.writeWebhookSecret(newState, { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com" }, context, () => ({ ok: true }));
  assert.strictEqual(updateRes.success, true);
  const updatedState = (updateRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const wh2 = updatedState.webhooks[0];
  assert.strictEqual(wh2.hasSecret, true);
  assert.strictEqual(wh2.secretHash, capability.hashSecretMaterial("s3cr3t"));
});

test("writeonlysecretsettingspermissions", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const contextNoPerm: capability.SecretStoreContext = { tenantId: "t1", permissions: [], environment: "test" };
  const contextOtherTenant: capability.SecretStoreContext = { tenantId: "t2", permissions: ["WEBHOOK_WRITE"], environment: "test" };

  const res1 = capability.writeWebhookSecret(state, { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com" }, contextNoPerm, () => ({ ok: true }));
  const err1 = res1 as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err1.kind, "PERMISSION_DENIED");

  const res2 = capability.readSecretSettingsMetadata(state, "t1", contextOtherTenant);
  const err2 = res2 as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err2.kind, "FORBIDDEN_REALM_OPERATION");

  const res3 = capability.revokeApiKey(state, { tenantId: "t1", keyId: "k1" }, contextNoPerm, () => ({ ok: true }));
  const err3 = res3 as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err3.kind, "PERMISSION_DENIED");
});

test("writeonlysecretsettingsproof", () => {
  const cryptoProof = capability.verifyProofTokenCryptography("mySecret", "a".repeat(64));
  assert.strictEqual(cryptoProof.encryptedCorrectly, true);
  assert.strictEqual(cryptoProof.noLeakage, true);

  const auditEvent: capability.WriteOnlySecretSettingsAuditEvent = {
    kind: "AUDIT_SECRET_CREATE",
    tenantId: "t1",
    alias: "alias1",
    changedFields: ["secret"],
    hasSecret: true,
    secretChanged: true,
    configKeyNames: ["alias"],
    readinessResult: "READY",
    timestamp: new Date().toISOString(),
  };
  const auditProof = capability.verifyProofAuditRedaction(auditEvent, "mySecret");
  assert.strictEqual(auditProof, true);
});

test("writeonlysecretsettingsreadinessmodel", () => {
  assert.strictEqual(capability.assessProviderReadiness("PROVIDER_BACKED", false, undefined), "MISSING");
  assert.strictEqual(capability.assessProviderReadiness("PROVIDER_BACKED", true, false), "PROVIDER_UNAVAILABLE");
  assert.strictEqual(capability.assessProviderReadiness("PROVIDER_BACKED", true, true), "READY");
  assert.strictEqual(capability.assessProviderReadiness("PROVIDER_BACKED", true, undefined), "NOT_READY");
  assert.strictEqual(capability.assessProviderReadiness("PERSISTENCE_BACKED", true, undefined), "READY");

  const state = capability.initialWriteOnlySecretSettingsState;
  const readiness = capability.evaluateOverallReadiness(state, "t1");
  assert.strictEqual(readiness, "MISSING");
});

test("writeonlysecretsettingsstatemodel", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const testContext: capability.SecretStoreContext = { tenantId: "t1", permissions: ["AUTH_SETTINGS_WRITE"], environment: "test" };
  const prodContext: capability.SecretStoreContext = { tenantId: "t1", permissions: ["AUTH_SETTINGS_WRITE"], environment: "production", masterKeyHex: "a".repeat(64) };

  const testRes = capability.writeMailSenderSecret(state, { tenantId: "t1", senderId: "s1", host: "h1", port: 587, password: "s3cr3t" }, testContext, () => ({ ok: true }));
  const testMeta = (testRes as { success: true; data: capability.MailSenderSecretMetadata }).data;
  assert.strictEqual(testMeta.crypto.mode, "TEST_UNENCRYPTED_MARKER");

  const prodRes = capability.encryptSecretMaterial("s3cr3t", "a".repeat(64), "production");
  assert.strictEqual(prodRes.ok, true);
  const prodCrypto = prodRes.crypto;
  assert.strictEqual(prodCrypto.mode, "ENCRYPTED");
  assert.ok(prodCrypto.ciphertextHex.length > 0);

  const writeRes = capability.writeMailSenderSecret(state, { tenantId: "t1", senderId: "s1", host: "h1", port: 587, password: "s3cr3t" }, prodContext, () => ({ ok: true }));
  const writeMeta = (writeRes as { success: true; data: capability.MailSenderSecretMetadata }).data;
  assert.strictEqual(writeMeta.crypto.mode, "ENCRYPTED");
  assert.ok(writeMeta.crypto.ciphertextHex.length > 0);
});

test("writeonlysecretsettingsvalidation", () => {
  assert.strictEqual(capability.validateSafeUrl("ftp://evil.com"), false);
  assert.strictEqual(capability.validateSafeUrl("https://safe.com"), true);

  const encRes = capability.encryptSecretMaterial("s3cr3t", "short", "production");
  assert.strictEqual(encRes.ok, false);
  const encErr = encRes.error as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(encErr.kind, "VALIDATION_FAILURE");

  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = { tenantId: "t1", permissions: ["PROVIDER_CONFIG_WRITE"], environment: "test" };
  const createRes = capability.saveIdentityProviderSecret(state, { tenantId: "t1", providerId: "p1", alias: "alias1", url: "https://example.com", secret: "s3cr3t" }, context, () => ({ ok: true }));
  assert.strictEqual(createRes.success, true);
  const newState = (createRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;

  const updateRes = capability.saveIdentityProviderSecret(newState, { tenantId: "t1", providerId: "p1", alias: "alias1", url: "https://example.com" }, context, () => ({ ok: true }));
  const updatedState = (updateRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const p = updatedState.identityProviders[0];
  assert.strictEqual(p.hasSecret, true);
});