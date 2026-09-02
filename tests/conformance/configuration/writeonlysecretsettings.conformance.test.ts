import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/configuration/writeonlysecretsettings.ts";

test("writeonlysecretsettingsauditmodel", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["WEBHOOK_WRITE"],
    environment: "test",
  };
  const input: capability.WriteWebhookSecretInput = {
    tenantId: "t1",
    webhookId: "wh1",
    endpointUrl: "https://example.com",
    secret: "s3cr3t",
  };

  const badAuditFn: capability.WriteOnlySecretSettingsAuditFn = () => ({
    ok: false,
    error: "rejected",
  });
  const blocked = capability.writeWebhookSecret(state, input, context, badAuditFn);
  assert.strictEqual(blocked.success, false);
  const err = blocked as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err.kind, "AUDIT_FAILURE");
  // The state must not have been mutated when audit fails.
  assert.strictEqual(state.webhooks.length, 0);

  const goodAuditFn: capability.WriteOnlySecretSettingsAuditFn = () => ({ ok: true });
  const result = capability.writeWebhookSecret(state, input, context, goodAuditFn);
  assert.strictEqual(result.success, true);
  const newState = (result as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const audit = newState.lastAudit;
  assert.ok(audit);
  // Audit must record only metadata: changed field names, has-secret flag, secret-changed flag,
  // config key names, and readiness — never the raw secret value.
  assert.deepStrictEqual(audit!.changedFields, ["endpointUrl", "secret"]);
  assert.strictEqual(audit!.hasSecret, true);
  assert.strictEqual(audit!.secretChanged, true);
  assert.deepStrictEqual(audit!.configKeyNames, ["webhookId", "endpointUrl"]);
  assert.strictEqual(typeof audit!.alias, "string");
  const serialized = JSON.stringify(audit);
  assert.ok(!serialized.includes("s3cr3t"));
});

test("writeonlysecretsettingscontracts", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["API_KEY_CREATE", "SETTINGS_READ"],
    environment: "test",
  };
  const createRes = capability.createRevealOnceApiKey(
    state,
    { tenantId: "t1", name: "key1" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(createRes.success, true);
  const data = (createRes as { success: true; data: capability.RevealOnceApiKeyResponse }).data;
  assert.ok(data.rawApiKeyRevealOnce.startsWith("anqr_live_"));

  const readRes = capability.readSecretSettingsMetadata(
    (createRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state,
    "t1",
    context
  );
  assert.strictEqual(readRes.success, true);
  const metadata = (readRes as { success: true; metadata: {
    identityProviders: readonly capability.IdentityProviderSecretMetadata[];
    mailSenders: readonly capability.MailSenderSecretMetadata[];
    webhooks: readonly capability.WebhookSecretMetadata[];
    apiKeys: readonly capability.ApiKeyMetadata[];
    tenantAdminCredentials: readonly capability.TenantAdminCredentialMetadata[];
  } }).metadata;
  assert.strictEqual(metadata.apiKeys.length, 1);
  const apiKeyMeta = metadata.apiKeys[0];
  // The read path must expose only redacted metadata — never the raw reveal-once value.
  assert.ok(!("rawApiKeyRevealOnce" in apiKeyMeta));
  assert.strictEqual(apiKeyMeta.keyHash, data.metadata.keyHash);
});

test("writeonlysecretsettingserrormodel", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["AUTH_SETTINGS_WRITE", "WEBHOOK_WRITE", "API_KEY_REVOKE"],
    environment: "test",
  };

  // NO_CREDENTIAL: rotation of an unknown admin without a password is denied before any store.
  const noCredRes = capability.rotateTenantAdminCredential(
    state,
    { tenantId: "t1", adminUsername: "admin" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(noCredRes.success, false);
  const noCredErr = noCredRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(noCredErr.kind, "NO_CREDENTIAL");
  assert.strictEqual(noCredErr.statusCode, 401);
  assert.ok(!noCredErr.message.toLowerCase().includes("s3cr3t"));

  // INVALID_CREDENTIAL: a too-short password is rejected before any store.
  const invalidCredRes = capability.rotateTenantAdminCredential(
    state,
    { tenantId: "t1", adminUsername: "admin", newPassword: "short" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(invalidCredRes.success, false);
  const invalidCredErr = invalidCredRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(invalidCredErr.kind, "INVALID_CREDENTIAL");
  assert.strictEqual(invalidCredErr.statusCode, 401);
  assert.ok(!invalidCredErr.message.includes("short"));

  // VALIDATION_FAILURE: unsafe webhook URL is rejected before any store.
  const valErrRes = capability.writeWebhookSecret(
    state,
    { tenantId: "t1", webhookId: "wh1", endpointUrl: "ftp://evil.com", secret: "rawValueXYZ" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(valErrRes.success, false);
  const valErr = valErrRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(valErr.kind, "VALIDATION_FAILURE");
  assert.strictEqual(valErr.statusCode, 422);
  assert.ok(!valErr.message.includes("rawValueXYZ"));

  // NOT_FOUND: revoking an unknown API key is denied.
  const notFoundRes = capability.revokeApiKey(
    state,
    { tenantId: "t1", keyId: "nonexistent" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(notFoundRes.success, false);
  const notFoundErr = notFoundRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(notFoundErr.kind, "NOT_FOUND");
  assert.strictEqual(notFoundErr.statusCode, 404);

  // FORBIDDEN_REALM_OPERATION: cross-tenant admin rotation is denied.
  const crossTenantRes = capability.rotateTenantAdminCredential(
    state,
    { tenantId: "t2", adminUsername: "admin", newPassword: "longenoughpw" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(crossTenantRes.success, false);
  const crossTenantErr = crossTenantRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(crossTenantErr.kind, "FORBIDDEN_REALM_OPERATION");
  assert.strictEqual(crossTenantErr.statusCode, 403);
  assert.ok(!crossTenantErr.message.includes("longenoughpw"));

  // Provider-specific readiness states surface as typed error kinds, not as 200-OK success.
  assert.strictEqual(
    capability.mapErrorKindToStatusCode("REALM_UNREACHABLE"),
    503
  );
  assert.strictEqual(
    capability.mapErrorKindToStatusCode("PROVIDER_UNAVAILABLE"),
    503
  );
});

test("writeonlysecretsettingslifecycle", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["WEBHOOK_WRITE", "PROVIDER_CONFIG_WRITE"],
    environment: "test",
  };

  // Create: secret is stored hashed; raw value never appears on the metadata.
  const createRes = capability.writeWebhookSecret(
    state,
    { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com", secret: "s3cr3t" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(createRes.success, true);
  const newState = (createRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const wh = newState.webhooks[0];
  assert.strictEqual(wh.hasSecret, true);
  assert.strictEqual(wh.secretHash, capability.hashSecretMaterial("s3cr3t"));
  assert.ok(!("secret" in wh));
  assert.ok(!("rawSecret" in wh));
  assert.ok(!JSON.stringify(wh).includes("s3cr3t"));

  // Update without a secret: existing value is preserved.
  const updateRes = capability.writeWebhookSecret(
    newState,
    { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(updateRes.success, true);
  const updatedState = (updateRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const wh2 = updatedState.webhooks[0];
  assert.strictEqual(wh2.hasSecret, true);
  assert.strictEqual(wh2.secretHash, capability.hashSecretMaterial("s3cr3t"));
  assert.strictEqual(wh2.readiness, "READY");

  // Identity provider: secret is provider-masked; raw value never appears.
  const createIdpRes = capability.saveIdentityProviderSecret(
    state,
    { tenantId: "t1", providerId: "p1", alias: "alias1", url: "https://example.com", secret: "rawIdpSecret" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(createIdpRes.success, true);
  const idpState = (createIdpRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const idp = idpState.identityProviders[0];
  assert.strictEqual(idp.hasSecret, true);
  assert.strictEqual(idp.maskedValue, "********");
  assert.ok(!JSON.stringify(idp).includes("rawIdpSecret"));
});

test("writeonlysecretsettingspermissions", () => {
  const state = capability.initialWriteOnlySecretSettingsState;

  // No permissions at all: every secret-bearing write must be denied.
  const contextNoPerm: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: [],
    environment: "test",
  };
  const res1 = capability.writeWebhookSecret(
    state,
    { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com", secret: "v" },
    contextNoPerm,
    () => ({ ok: true })
  );
  assert.strictEqual(res1.success, false);
  const err1 = res1 as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err1.kind, "PERMISSION_DENIED");
  assert.strictEqual(err1.statusCode, 403);

  // The owning surface permission gates each write: WEBHOOK_WRITE is required.
  const contextNoWebhook: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["API_KEY_CREATE"],
    environment: "test",
  };
  const res1b = capability.writeWebhookSecret(
    state,
    { tenantId: "t1", webhookId: "wh1", endpointUrl: "https://example.com", secret: "v" },
    contextNoWebhook,
    () => ({ ok: true })
  );
  assert.strictEqual(res1b.success, false);
  const err1b = res1b as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err1b.kind, "PERMISSION_DENIED");

  // Cross-tenant read is denied even when SETTINGS_READ is present.
  const contextOtherTenant: capability.SecretStoreContext = {
    tenantId: "t2",
    permissions: ["SETTINGS_READ"],
    environment: "test",
  };
  const res2 = capability.readSecretSettingsMetadata(state, "t1", contextOtherTenant);
  assert.strictEqual(res2.success, false);
  const err2 = res2 as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err2.kind, "FORBIDDEN_REALM_OPERATION");
  assert.strictEqual(err2.statusCode, 403);

  // API-key revoke requires API_KEY_REVOKE.
  const res3 = capability.revokeApiKey(
    state,
    { tenantId: "t1", keyId: "k1" },
    contextNoPerm,
    () => ({ ok: true })
  );
  assert.strictEqual(res3.success, false);
  const err3 = res3 as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(err3.kind, "PERMISSION_DENIED");

  // Reads return only redacted metadata: every key on the returned records is metadata,
  // never a raw secret value, and SETTINGS_READ is required.
  const readNoPerm = capability.readSecretSettingsMetadata(
    state,
    "t1",
    contextNoPerm
  );
  assert.strictEqual(readNoPerm.success, false);
  const readNoPermErr = readNoPerm as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(readNoPermErr.kind, "PERMISSION_DENIED");

  // The full permission set is the union of the owning-surface scopes; nothing here
  // implies retrieval of a stored raw secret.
  const allPerms: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: [
      "AUTH_SETTINGS_WRITE",
      "PROVIDER_CONFIG_WRITE",
      "WEBHOOK_WRITE",
      "API_KEY_CREATE",
      "API_KEY_REVOKE",
      "SETTINGS_READ",
    ],
    environment: "test",
  };
  const seeded = capability.createRevealOnceApiKey(
    state,
    { tenantId: "t1", name: "k1" },
    allPerms,
    () => ({ ok: true })
  );
  assert.strictEqual(seeded.success, true);
  const readAll = capability.readSecretSettingsMetadata(
    (seeded as { success: true; state: capability.WriteOnlySecretSettingsState }).state,
    "t1",
    allPerms
  );
  assert.strictEqual(readAll.success, true);
  const allMeta = (readAll as { success: true; metadata: {
    identityProviders: readonly capability.IdentityProviderSecretMetadata[];
    mailSenders: readonly capability.MailSenderSecretMetadata[];
    webhooks: readonly capability.WebhookSecretMetadata[];
    apiKeys: readonly capability.ApiKeyMetadata[];
    tenantAdminCredentials: readonly capability.TenantAdminCredentialMetadata[];
  } }).metadata;
  for (const k of allMeta.apiKeys) {
    assert.ok(!("rawApiKeyRevealOnce" in k));
    assert.ok(!("secret" in k));
  }
});

test("writeonlysecretsettingsproof", () => {
  const masterKey = "a".repeat(64);
  const cryptoProof = capability.verifyProofTokenCryptography("mySecret", masterKey);
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
  assert.strictEqual(
    capability.assessProviderReadiness("PROVIDER_BACKED", false, undefined),
    "MISSING"
  );
  assert.strictEqual(
    capability.assessProviderReadiness("PROVIDER_BACKED", true, false),
    "PROVIDER_UNAVAILABLE"
  );
  assert.strictEqual(
    capability.assessProviderReadiness("PROVIDER_BACKED", true, true),
    "READY"
  );
  assert.strictEqual(
    capability.assessProviderReadiness("PROVIDER_BACKED", true, undefined),
    "NOT_READY"
  );
  assert.strictEqual(
    capability.assessProviderReadiness("PERSISTENCE_BACKED", true, undefined),
    "READY"
  );

  const state = capability.initialWriteOnlySecretSettingsState;
  const readiness = capability.evaluateOverallReadiness(state, "t1");
  assert.strictEqual(readiness, "MISSING");

  // Provider-backed readiness must degrade to NOT_READY when substrate is not validated,
  // and the overall readiness propagates provider-unreachable classifications.
  const ctxNoSubstrate: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["PROVIDER_CONFIG_WRITE"],
    environment: "test",
  };
  const created = capability.saveIdentityProviderSecret(
    state,
    { tenantId: "t1", providerId: "p1", alias: "alias1", url: "https://example.com", secret: "s" },
    ctxNoSubstrate,
    () => ({ ok: true })
  );
  assert.strictEqual(created.success, true);
  const s1 = (created as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  assert.strictEqual(s1.identityProviders[0].readiness, "NOT_READY");
  assert.strictEqual(capability.evaluateOverallReadiness(s1, "t1"), "NOT_READY");

  const ctxUnreachable: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["PROVIDER_CONFIG_WRITE"],
    environment: "test",
    substrateAvailable: false,
  };
  const createdUnreachable = capability.saveIdentityProviderSecret(
    state,
    { tenantId: "t1", providerId: "p2", alias: "alias2", url: "https://example.com", secret: "s" },
    ctxUnreachable,
    () => ({ ok: true })
  );
  assert.strictEqual(createdUnreachable.success, true);
  const s2 = (createdUnreachable as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  assert.strictEqual(s2.identityProviders[0].readiness, "PROVIDER_UNAVAILABLE");
  assert.strictEqual(capability.evaluateOverallReadiness(s2, "t1"), "PROVIDER_UNAVAILABLE");
});

test("writeonlysecretsettingsstatemodel", () => {
  const state = capability.initialWriteOnlySecretSettingsState;
  const testContext: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["AUTH_SETTINGS_WRITE"],
    environment: "test",
  };
  const prodContext: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["AUTH_SETTINGS_WRITE"],
    environment: "production",
    masterKeyHex: "a".repeat(64),
  };

  // Mail-sender secret in a test environment yields the explicit unencrypted test marker;
  // no raw secret is materialised on the state.
  const testRes = capability.writeMailSenderSecret(
    state,
    { tenantId: "t1", senderId: "s1", host: "h1", port: 587, password: "s3cr3t" },
    testContext,
    () => ({ ok: true })
  );
  assert.strictEqual(testRes.success, true);
  const testMeta = (testRes as { success: true; data: capability.MailSenderSecretMetadata }).data;
  assert.strictEqual(testMeta.crypto.mode, "TEST_UNENCRYPTED_MARKER");
  assert.strictEqual(testMeta.hasSecret, true);
  assert.ok(!JSON.stringify(testMeta).includes("s3cr3t"));

  // In production with a master key, the secret is encrypted, not stored as a raw value.
  const prodRes = capability.encryptSecretMaterial("s3cr3t", "a".repeat(64), "production");
  assert.strictEqual(prodRes.ok, true);
  const prodCrypto = prodRes.crypto;
  assert.strictEqual(prodCrypto.mode, "ENCRYPTED");
  assert.ok(prodCrypto.ciphertextHex.length > 0);
  assert.ok(prodCrypto.ivHex.length > 0);
  assert.ok(prodCrypto.tagHex.length > 0);
  assert.ok(prodCrypto.keyFingerprint.length > 0);
  assert.ok(!JSON.stringify(prodCrypto).includes("s3cr3t"));

  const writeRes = capability.writeMailSenderSecret(
    state,
    { tenantId: "t1", senderId: "s1", host: "h1", port: 587, password: "s3cr3t" },
    prodContext,
    () => ({ ok: true })
  );
  assert.strictEqual(writeRes.success, true);
  const writeMeta = (writeRes as { success: true; data: capability.MailSenderSecretMetadata }).data;
  assert.strictEqual(writeMeta.crypto.mode, "ENCRYPTED");
  assert.ok(writeMeta.crypto.ciphertextHex.length > 0);
  assert.ok(!JSON.stringify(writeMeta).includes("s3cr3t"));

  // Tenant admin credential lifecycle metadata carries only a hash and a has-password flag.
  const adminContext: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["AUTH_SETTINGS_WRITE"],
    environment: "test",
  };
  const adminRes = capability.rotateTenantAdminCredential(
    state,
    { tenantId: "t1", adminUsername: "admin", newPassword: "longenoughpw" },
    adminContext,
    () => ({ ok: true })
  );
  assert.strictEqual(adminRes.success, true);
  const adminState = (adminRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const admin = adminState.tenantAdminCredentials[0];
  assert.strictEqual(admin.hasPassword, true);
  assert.strictEqual(admin.passwordHash, capability.hashSecretMaterial("longenoughpw"));
  assert.ok(!JSON.stringify(admin).includes("longenoughpw"));
});

test("writeonlysecretsettingsvalidation", () => {
  assert.strictEqual(capability.validateSafeUrl("ftp://evil.com"), false);
  assert.strictEqual(capability.validateSafeUrl("https://safe.com"), true);

  // Encryption-key requirement is enforced for higher environments before any encryption runs.
  const encRes = capability.encryptSecretMaterial("s3cr3t", "short", "production");
  assert.strictEqual(encRes.ok, false);
  const encErr = encRes.error as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(encErr.kind, "VALIDATION_FAILURE");
  assert.ok(!encErr.message.includes("s3cr3t"));

  const state = capability.initialWriteOnlySecretSettingsState;
  const context: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["PROVIDER_CONFIG_WRITE"],
    environment: "test",
  };
  const createRes = capability.saveIdentityProviderSecret(
    state,
    { tenantId: "t1", providerId: "p1", alias: "alias1", url: "https://example.com", secret: "s3cr3t" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(createRes.success, true);
  const newState = (createRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;

  // An empty identity-provider secret on update preserves the existing value.
  const updateRes = capability.saveIdentityProviderSecret(
    newState,
    { tenantId: "t1", providerId: "p1", alias: "alias1", url: "https://example.com" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(updateRes.success, true);
  const updatedState = (updateRes as { success: true; state: capability.WriteOnlySecretSettingsState }).state;
  const p = updatedState.identityProviders[0];
  assert.strictEqual(p.hasSecret, true);
  assert.ok(!JSON.stringify(p).includes("s3cr3t"));

  // Unsafe URL is rejected before any store.
  const unsafeRes = capability.saveIdentityProviderSecret(
    state,
    { tenantId: "t1", providerId: "p2", alias: "alias2", url: "javascript:alert(1)", secret: "v" },
    context,
    () => ({ ok: true })
  );
  assert.strictEqual(unsafeRes.success, false);
  const unsafeErr = unsafeRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(unsafeErr.kind, "VALIDATION_FAILURE");

  // Invalid tenant credential is classified before any store.
  const adminContext: capability.SecretStoreContext = {
    tenantId: "t1",
    permissions: ["AUTH_SETTINGS_WRITE"],
    environment: "test",
  };
  const invalidCredRes = capability.rotateTenantAdminCredential(
    state,
    { tenantId: "t1", adminUsername: "admin", newPassword: "no" },
    adminContext,
    () => ({ ok: true })
  );
  assert.strictEqual(invalidCredRes.success, false);
  const invalidCredErr = invalidCredRes as capability.WriteOnlySecretSettingsError;
  assert.strictEqual(invalidCredErr.kind, "INVALID_CREDENTIAL");
  assert.strictEqual(state.tenantAdminCredentials.length, 0);
});