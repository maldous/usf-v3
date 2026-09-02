import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/apikeyspersonalaccesstokens.ts";

type Metadata = capability.ApiKeysPersonalAccessTokensMetadata;
type AuditEvent = capability.ApiKeysPersonalAccessTokensAuditEvent;
type Error = capability.ApiKeysPersonalAccessTokensError;
type Config = capability.ApiKeysPersonalAccessTokensConfig;
type Repository = capability.ApiKeysPersonalAccessTokensRepository;
type State = capability.ApiKeysPersonalAccessTokensState;
type AuthResult = capability.ApiKeysPersonalAccessTokensAuthenticationResult;

interface Stored {
  active: boolean;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiry: string | null;
  keyPrefix: string;
  scopes: readonly string[];
  hash: string;
  salt: string;
}

function isError(value: unknown): value is Error {
  return capability.isError(value);
}

function isCreatedWithSecret(
  value: unknown,
): value is {
  readonly outcome: "OK";
  readonly secret: string;
  readonly keyId: string;
  readonly metadata: Metadata;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return rec.outcome === "OK" && "secret" in rec && "keyId" in rec && "metadata" in rec;
}

function isCreatedNoSecret(
  value: unknown,
): value is {
  readonly outcome: "OK";
  readonly keyId: string;
  readonly metadata: Metadata;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    rec.outcome === "OK" &&
    "keyId" in rec &&
    "metadata" in rec &&
    !("secret" in rec) &&
    !("kind" in rec)
  );
}

function isOkList(
  value: unknown,
): value is {
  readonly outcome: "OK";
  readonly keys: readonly Metadata[];
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return rec.outcome === "OK" && "keys" in rec;
}

function isOkOutcome(
  value: unknown,
): value is { readonly outcome: "OK" } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return rec.outcome === "OK" && !("kind" in rec);
}

function isNotEntitled(
  value: unknown,
): value is { readonly outcome: "NOT_ENTITLED" } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    rec.outcome === "NOT_ENTITLED" &&
    !("kind" in rec) &&
    !("keys" in rec) &&
    !("metadata" in rec)
  );
}

function isAuthResult(value: unknown): value is AuthResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    "tenantId" in rec &&
    "scopes" in rec &&
    !("kind" in rec) &&
    !("outcome" in rec)
  );
}

function isMetadata(value: unknown): value is Metadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    !("kind" in rec) &&
    !("outcome" in rec) &&
    "keyId" in rec &&
    "tenantId" in rec &&
    "active" in rec
  );
}

function isNoActor(value: unknown): value is { readonly outcome: "NO_ACTOR" } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return rec.outcome === "NO_ACTOR" && !("kind" in rec);
}

function buildReadyConfig(): Config {
  const stored = new Map<string, Stored>();
  const repository: Repository = {
    create: (_tenantId, keyId, state): State => {
      const next: Stored = {
        active: state.active,
        revokedAt: state.revokedAt,
        createdAt: state.createdAt,
        lastUsedAt: state.lastUsedAt,
        expiry: state.expiry,
        keyPrefix: state.keyPrefix,
        scopes: state.scopes,
        hash: state.hash,
        salt: state.salt,
      };
      stored.set(keyId, next);
      return state;
    },
    readMetadata: (tenantId, keyId): Metadata | null => {
      const s = stored.get(keyId);
      if (!s) return null;
      return {
        keyId,
        tenantId,
        active: s.active,
        revokedAt: s.revokedAt,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiry: s.expiry,
        keyPrefix: s.keyPrefix,
        scopes: s.scopes,
      };
    },
    listMetadata: (tenantId): readonly Metadata[] => {
      const out: Metadata[] = [];
      for (const [keyId, s] of stored) {
        out.push({
          keyId,
          tenantId,
          active: s.active,
          revokedAt: s.revokedAt,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          expiry: s.expiry,
          keyPrefix: s.keyPrefix,
          scopes: s.scopes,
        });
      }
      return out;
    },
    revoke: (_tenantId, keyId): void => {
      const s = stored.get(keyId);
      if (s) {
        stored.set(keyId, { ...s, active: false, revokedAt: "2024-01-02T00:00:00Z" });
      }
    },
    authenticate: (keyId, secret): AuthResult | null => {
      const s = stored.get(keyId);
      if (!s) return null;
      if (!s.active) return null;
      if (s.hash !== `stored:${secret}`) return null;
      return { tenantId: "t1", scopes: s.scopes };
    },
  };
  return {
    repository,
    permissions: {
      tenantApiKeyRead: true,
      tenantApiKeyWrite: true,
      platformApiKeyRead: true,
      apiAccessEntitlement: true,
    },
    audit: () => undefined,
    crypto: {
      generateSecret: () => "plaintext-secret-once",
      generateSalt: () => "salt12345678901234567890",
      hashSecret: (secret) => `stored:${secret}`,
    },
    now: () => "2024-01-01T00:00:00Z",
  };
}

function buildTenantScopedRepo(): Repository {
  const stored = new Map<string, Map<string, Stored>>();
  const ensureTenant = (tenantId: string): Map<string, Stored> => {
    let bucket = stored.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      stored.set(tenantId, bucket);
    }
    return bucket;
  };
  return {
    create: (tenantId, keyId, state): State => {
      ensureTenant(tenantId).set(keyId, {
        active: state.active,
        revokedAt: state.revokedAt,
        createdAt: state.createdAt,
        lastUsedAt: state.lastUsedAt,
        expiry: state.expiry,
        keyPrefix: state.keyPrefix,
        scopes: state.scopes,
        hash: state.hash,
        salt: state.salt,
      });
      return state;
    },
    readMetadata: (tenantId, keyId): Metadata | null => {
      const s = ensureTenant(tenantId).get(keyId);
      if (!s) return null;
      return {
        keyId,
        tenantId,
        active: s.active,
        revokedAt: s.revokedAt,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiry: s.expiry,
        keyPrefix: s.keyPrefix,
        scopes: s.scopes,
      };
    },
    listMetadata: (tenantId): readonly Metadata[] => {
      const bucket = ensureTenant(tenantId);
      const out: Metadata[] = [];
      for (const [keyId, s] of bucket) {
        out.push({
          keyId,
          tenantId,
          active: s.active,
          revokedAt: s.revokedAt,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          expiry: s.expiry,
          keyPrefix: s.keyPrefix,
          scopes: s.scopes,
        });
      }
      return out;
    },
    revoke: (tenantId, keyId): void => {
      const bucket = ensureTenant(tenantId);
      const s = bucket.get(keyId);
      if (s) {
        bucket.set(keyId, { ...s, active: false, revokedAt: "2024-01-02T00:00:00Z" });
      }
    },
    authenticate: (keyId, secret): AuthResult | null => {
      for (const [tenantId, bucket] of stored) {
        const s = bucket.get(keyId);
        if (s && s.active && s.hash === `stored:${secret}`) {
          return { tenantId, scopes: s.scopes };
        }
      }
      return null;
    },
  };
}

test("apikeyspersonalaccesstokensauditmodel", () => {
  const auditEvents: AuditEvent[] = [];
  let createCalled = false;
  const repository: Repository = {
    create: (_tenantId, _keyId, state): State => {
      createCalled = true;
      return state;
    },
    readMetadata: () => null,
    listMetadata: (): readonly Metadata[] => [],
    revoke: () => undefined,
    authenticate: () => null,
  };
  const config: Config = {
    repository,
    permissions: {
      tenantApiKeyRead: true,
      tenantApiKeyWrite: true,
      platformApiKeyRead: true,
      apiAccessEntitlement: true,
    },
    audit: (event) => {
      auditEvents.push(event);
      return undefined;
    },
    crypto: {
      generateSecret: () => "plaintext-secret-once",
      generateSalt: () => "salt123456789012",
      hashSecret: (s) => `stored:${s}`,
    },
    now: () => "2024-01-01T00:00:00Z",
  };

  const created = capability.createKey(config, () => undefined, "t1", ["read"]);
  assert.ok(isCreatedNoSecret(created));
  assert.strictEqual(auditEvents.length, 1);
  const createdAudit = auditEvents[0]!;
  assert.strictEqual(createdAudit.kind, "key-created");
  assert.strictEqual(createdAudit.tenantId, "t1");
  assert.strictEqual(createdAudit.keyId, created.keyId);

  const seededRepo: Repository = {
    ...repository,
    readMetadata: (tenantId, keyId): Metadata | null => ({
      keyId,
      tenantId,
      active: true,
      revokedAt: null,
      createdAt: "2024-01-01T00:00:00Z",
      lastUsedAt: null,
      expiry: null,
      keyPrefix: keyId.substring(0, 8),
      scopes: ["read"],
    }),
  };
  const seededConfig: Config = { ...config, repository: seededRepo };

  const revoked = capability.revokeKey(seededConfig, () => undefined, "t1", created.keyId);
  assert.ok(isOkOutcome(revoked));
  assert.strictEqual(revoked.outcome, "OK");
  assert.strictEqual(auditEvents.length, 2);
  const revokedAudit = auditEvents[1]!;
  assert.strictEqual(revokedAudit.kind, "key-revoked");
  assert.strictEqual(revokedAudit.tenantId, "t1");

  const failingAuditConfig: Config = {
    ...config,
    audit: (): Error => ({ kind: "AUDIT_VIOLATION", message: "audit fail", statusCode: 403 }),
  };
  createCalled = false;
  const failingAuditResult = capability.createKey(
    failingAuditConfig,
    failingAuditConfig.audit,
    "t1",
    [],
  );
  assert.ok(isError(failingAuditResult));
  assert.strictEqual(failingAuditResult.kind, "AUDIT_VIOLATION");
  assert.strictEqual(createCalled, false);

  const auditBeforeLength = auditEvents.length;
  capability.readKeyMetadata(seededConfig, "t1", created.keyId);
  capability.listKeys(seededConfig, "t1");
  assert.strictEqual(auditEvents.length, auditBeforeLength);
});

test("apikeyspersonalaccesstokenscontracts", () => {
  const config = buildReadyConfig();

  const createdWithSecret = capability.createKeyWithSecret(
    config,
    config.audit,
    "tenant-a",
    ["read"],
  );
  assert.ok(isCreatedWithSecret(createdWithSecret));
  assert.strictEqual(typeof createdWithSecret.secret, "string");
  assert.ok(createdWithSecret.secret.length > 0);

  const createdNoSecret = capability.createKey(config, config.audit, "tenant-a", ["read"]);
  assert.ok(isCreatedNoSecret(createdNoSecret));
  assert.strictEqual(
    (createdNoSecret as unknown as { secret?: unknown }).secret,
    undefined,
  );

  const listResult: unknown = capability.listKeys(config, "tenant-a");
  assert.ok(isOkList(listResult));
  assert.strictEqual(listResult.outcome, "OK");
  assert.ok(listResult.keys.length >= 1);
  const listedMeta = listResult.keys[0]!;
  assert.strictEqual(listedMeta.keyId, createdNoSecret.keyId);
  assert.strictEqual(
    (listedMeta as unknown as { secret?: unknown }).secret,
    undefined,
  );
  assert.strictEqual((listedMeta as unknown as { hash?: unknown }).hash, undefined);

  const devRead: unknown = capability.readKeyMetadata(config, "tenant-a", createdNoSecret.keyId);
  assert.ok(isMetadata(devRead));
  const devMeta = devRead as Metadata;
  assert.strictEqual(devMeta.tenantId, "tenant-a");
  assert.strictEqual(devMeta.active, true);
  assert.strictEqual(
    (devMeta as unknown as { secret?: unknown }).secret,
    undefined,
  );

  const operatorResult: unknown = capability.operatorListKeys(config, "tenant-a");
  assert.ok(isOkList(operatorResult));
  assert.strictEqual(operatorResult.outcome, "OK");
  assert.ok(operatorResult.keys.length >= 1);
  const operatorMeta = operatorResult.keys[0]!;
  assert.strictEqual(operatorMeta.keyId, createdNoSecret.keyId);
  assert.strictEqual(
    (operatorMeta as unknown as { secret?: unknown }).secret,
    undefined,
  );

  const deleted = capability.revokeKey(config, config.audit, "tenant-a", createdNoSecret.keyId);
  assert.ok(isOkOutcome(deleted));
  assert.strictEqual(deleted.outcome, "OK");
});

test("apikeyspersonalaccesstokenserrormodel", () => {
  const noEntitledConfig: Config = {
    ...buildReadyConfig(),
    permissions: {
      tenantApiKeyRead: false,
      tenantApiKeyWrite: false,
      platformApiKeyRead: false,
      apiAccessEntitlement: false,
    },
  };
  const notEntitled = capability.createKey(
    noEntitledConfig,
    noEntitledConfig.audit,
    "t1",
    [],
  );
  assert.ok(isNotEntitled(notEntitled));
  assert.strictEqual(notEntitled.outcome, "NOT_ENTITLED");

  const okConfig = buildReadyConfig();
  const okResult = capability.createKey(okConfig, okConfig.audit, "t1", []);
  assert.ok(isCreatedNoSecret(okResult));

  const invalidRoute = capability.readKeyMetadata(okConfig, "t1", "bad id with spaces!");
  assert.ok(isError(invalidRoute));
  assert.strictEqual(invalidRoute.kind, "INVALID_ROUTE_IDENTIFIER");
  assert.strictEqual(capability.mapErrorToStatusCode(invalidRoute), 400);

  const revokeOk = capability.revokeKey(okConfig, okConfig.audit, "t1", okResult.keyId);
  assert.ok(isOkOutcome(revokeOk));

  const authRevoked = capability.authenticateKey(okConfig, okResult.keyId, "plaintext-secret-once");
  assert.strictEqual(isAuthResult(authRevoked), false);
  assert.strictEqual(isNotEntitled(authRevoked), false);

  const authMalformed = capability.authenticateKey(okConfig, okResult.keyId, "garbage-secret");
  assert.strictEqual(isAuthResult(authMalformed), false);
  assert.strictEqual(isNotEntitled(authMalformed), false);

  const missingKey = capability.authenticateKey(okConfig, "ak-doesnotexist0000", "anything");
  assert.strictEqual(isAuthResult(missingKey), false);
  assert.strictEqual(isNotEntitled(missingKey), false);

  const invalidKeyIdAuth = capability.authenticateKey(okConfig, "bad id!", "anything");
  assert.strictEqual(isAuthResult(invalidKeyIdAuth), false);
  assert.strictEqual(isNotEntitled(invalidKeyIdAuth), false);

  const failingRepoConfig: Config = {
    ...buildReadyConfig(),
    repository: {
      create: (): Error => ({
        kind: "PROVIDER_FAILURE",
        message: "store down",
        statusCode: 503,
      }),
      readMetadata: () => null,
      listMetadata: (): readonly Metadata[] => [],
      revoke: () => undefined,
      authenticate: (): Error => ({
        kind: "PROVIDER_FAILURE",
        message: "store down",
        statusCode: 503,
      }),
    },
  };
  const degraded = capability.createKey(
    failingRepoConfig,
    failingRepoConfig.audit,
    "t1",
    [],
  );
  assert.ok(isError(degraded));
  assert.strictEqual(degraded.kind, "PROVIDER_FAILURE");

  const errorKinds: readonly capability.ApiKeysPersonalAccessTokensErrorKind[] = [
    "INVALID_ROUTE_IDENTIFIER",
    "PROVIDER_FAILURE",
    "AUDIT_VIOLATION",
    "NOT_ENTITLED",
    "MALFORMED_SECRET",
    "DEGRADED",
  ];
  assert.deepEqual([...capability.ApiKeysPersonalAccessTokensErrorKind], errorKinds);

  const outcomeValues: readonly capability.ApiKeysPersonalAccessTokensOutcome[] = [
    "OK",
    "NOT_ENTITLED",
  ];
  assert.deepEqual([...capability.ApiKeysPersonalAccessTokensOutcome], outcomeValues);
});

test("apikeyspersonalaccesstokenslifecycle", () => {
  const config = buildReadyConfig();
  const created = capability.createKeyWithSecret(config, config.audit, "t1", ["read"]);
  assert.ok(isCreatedWithSecret(created));
  assert.strictEqual(created.secret, "plaintext-secret-once");

  const listResult: unknown = capability.listKeys(config, "t1");
  assert.ok(isOkList(listResult));
  assert.strictEqual(listResult.outcome, "OK");
  const listedMeta = listResult.keys[0]!;
  assert.strictEqual(listedMeta.active, true);
  assert.deepEqual(Array.from(listedMeta.scopes), ["read"]);
  assert.strictEqual(
    (listedMeta as unknown as { secret?: unknown }).secret,
    undefined,
  );
  assert.strictEqual(
    (listedMeta as unknown as { hash?: unknown }).hash,
    undefined,
  );

  const auth: unknown = capability.authenticateKey(config, created.keyId, created.secret);
  assert.ok(isAuthResult(auth));
  const authOk = auth as AuthResult;
  assert.strictEqual(authOk.tenantId, "t1");
  assert.deepEqual(Array.from(authOk.scopes), ["read"]);

  const revoke = capability.revokeKey(config, config.audit, "t1", created.keyId);
  assert.ok(isOkOutcome(revoke));

  const afterRevoke = capability.authenticateKey(config, created.keyId, created.secret);
  assert.strictEqual(isAuthResult(afterRevoke), false);
  assert.strictEqual(isNotEntitled(afterRevoke), false);
  assert.ok(isNoActor(afterRevoke));

  const listAfterResult: unknown = capability.listKeys(config, "t1");
  assert.ok(isOkList(listAfterResult));
  const afterMeta = listAfterResult.keys[0]!;
  assert.strictEqual(afterMeta.active, false);
  assert.strictEqual(afterMeta.revokedAt, "2024-01-02T00:00:00Z");

  const afterRead: unknown = capability.readKeyMetadata(config, "t1", created.keyId);
  assert.ok(isMetadata(afterRead));
  const afterReadMeta = afterRead as Metadata;
  assert.strictEqual(afterReadMeta.active, false);
  assert.strictEqual(typeof afterReadMeta.revokedAt, "string");
});

test("apikeyspersonalaccesstokenspermissions", () => {
  const noPermsConfig: Config = {
    ...buildReadyConfig(),
    permissions: {
      tenantApiKeyRead: false,
      tenantApiKeyWrite: false,
      platformApiKeyRead: false,
      apiAccessEntitlement: false,
    },
  };
  const deniedCreate = capability.createKey(
    noPermsConfig,
    noPermsConfig.audit,
    "t1",
    [],
  );
  assert.ok(isNotEntitled(deniedCreate));
  assert.strictEqual(deniedCreate.outcome, "NOT_ENTITLED");

  const onlyEntitlementConfig: Config = {
    ...buildReadyConfig(),
    permissions: {
      tenantApiKeyRead: false,
      tenantApiKeyWrite: false,
      platformApiKeyRead: false,
      apiAccessEntitlement: true,
    },
  };
  const stillDenied = capability.createKey(
    onlyEntitlementConfig,
    onlyEntitlementConfig.audit,
    "t1",
    [],
  );
  assert.ok(isNotEntitled(stillDenied));
  assert.strictEqual(stillDenied.outcome, "NOT_ENTITLED");

  const noWriteConfig: Config = {
    ...buildReadyConfig(),
    permissions: {
      tenantApiKeyRead: true,
      tenantApiKeyWrite: false,
      platformApiKeyRead: true,
      apiAccessEntitlement: true,
    },
  };
  const stillDeniedWrite = capability.createKey(
    noWriteConfig,
    noWriteConfig.audit,
    "t1",
    [],
  );
  assert.ok(isNotEntitled(stillDeniedWrite));
  assert.strictEqual(stillDeniedWrite.outcome, "NOT_ENTITLED");

  const noReadConfig: Config = {
    ...buildReadyConfig(),
    permissions: {
      tenantApiKeyRead: false,
      tenantApiKeyWrite: true,
      platformApiKeyRead: true,
      apiAccessEntitlement: true,
    },
  };
  const deniedList = capability.listKeys(noReadConfig, "t1");
  assert.ok(isNotEntitled(deniedList));
  assert.strictEqual(deniedList.outcome, "NOT_ENTITLED");

  const noPlatformReadConfig: Config = {
    ...buildReadyConfig(),
    permissions: {
      tenantApiKeyRead: true,
      tenantApiKeyWrite: true,
      platformApiKeyRead: false,
      apiAccessEntitlement: true,
    },
  };
  const deniedOperator = capability.operatorListKeys(noPlatformReadConfig, "t1");
  assert.ok(isNotEntitled(deniedOperator));
  assert.strictEqual(deniedOperator.outcome, "NOT_ENTITLED");

  const crossTenantConfig: Config = {
    ...buildReadyConfig(),
    repository: buildTenantScopedRepo(),
  };
  const crossCreated = capability.createKey(
    crossTenantConfig,
    crossTenantConfig.audit,
    "tenant-a",
    [],
  );
  assert.ok(isCreatedNoSecret(crossCreated));
  const crossTenantList: unknown = capability.listKeys(crossTenantConfig, "tenant-b");
  assert.ok(isOkList(crossTenantList));
  assert.strictEqual(crossTenantList.outcome, "OK");
  assert.strictEqual(crossTenantList.keys.length, 0);

  const crossTenantRead = capability.readKeyMetadata(
    crossTenantConfig,
    "tenant-b",
    crossCreated.keyId,
  );
  assert.ok(isError(crossTenantRead));
  assert.strictEqual(crossTenantRead.kind, "INVALID_ROUTE_IDENTIFIER");
});

test("apikeyspersonalaccesstokensproof", () => {
  const config = buildReadyConfig();
  const created = capability.createKeyWithSecret(config, config.audit, "t1", ["s"]);
  assert.ok(isCreatedWithSecret(created));

  const auth: unknown = capability.authenticateKey(config, created.keyId, created.secret);
  assert.ok(isAuthResult(auth));

  const revoke = capability.revokeKey(config, config.audit, "t1", created.keyId);
  assert.ok(isOkOutcome(revoke));

  const afterRevoke = capability.authenticateKey(config, created.keyId, created.secret);
  assert.strictEqual(isAuthResult(afterRevoke), false);
  assert.strictEqual(isNotEntitled(afterRevoke), false);

  const readiness = capability.computeReadiness(config);
  assert.strictEqual(readiness, "READY");

  const secondCreate = capability.createKeyWithSecret(config, config.audit, "t1", ["s"]);
  assert.ok(isCreatedWithSecret(secondCreate));
  assert.notStrictEqual(secondCreate.keyId, created.keyId);

  const listResult: unknown = capability.listKeys(config, "t1");
  assert.ok(isOkList(listResult));
  assert.strictEqual(listResult.keys.length, 2);

  assert.strictEqual(capability.initialState, null);
});

test("apikeyspersonalaccesstokensreadinessmodel", () => {
  const readyConfig = buildReadyConfig();
  const readyReadiness = capability.computeReadiness(readyConfig);
  assert.strictEqual(readyReadiness, "READY");

  const throwingRepo: Repository = {
    create: () => {
      throw new Error("boom");
    },
    readMetadata: () => null,
    listMetadata: (): readonly Metadata[] => {
      throw new Error("boom");
    },
    revoke: () => undefined,
    authenticate: () => null,
  };
  const throwingConfig: Config = { ...buildReadyConfig(), repository: throwingRepo };
  const degradedReadiness = capability.computeReadiness(throwingConfig);
  assert.strictEqual(degradedReadiness, "DEGRADED");

  const degradedRepo: Repository = {
    create: (_t, _k, s): State => s,
    readMetadata: () => null,
    listMetadata: (): Error => ({
      kind: "PROVIDER_FAILURE",
      message: "store down",
      statusCode: 503,
    }),
    revoke: () => undefined,
    authenticate: () => null,
  };
  const degradedConfig: Config = { ...buildReadyConfig(), repository: degradedRepo };

  const readinessFromDegraded = capability.computeReadiness(degradedConfig);
  assert.strictEqual(readinessFromDegraded, "DEGRADED");

  const readDuringDegraded = capability.readKeyMetadata(
    degradedConfig,
    "t1",
    "ak-1234567890123456",
  );
  assert.ok(isError(readDuringDegraded));

  const mutateDuringDegraded = capability.createKey(
    degradedConfig,
    degradedConfig.audit,
    "t1",
    [],
  );
  assert.ok(isError(mutateDuringDegraded));
  assert.strictEqual(mutateDuringDegraded.kind, "PROVIDER_FAILURE");

  const revokedDuringDegraded = capability.revokeKey(
    degradedConfig,
    degradedConfig.audit,
    "t1",
    "ak-1234567890123456",
  );
  assert.ok(isError(revokedDuringDegraded));
  assert.strictEqual(revokedDuringDegraded.kind, "PROVIDER_FAILURE");

  const readinessValues: readonly capability.ApiKeysPersonalAccessTokensReadiness[] = [
    "READY",
    "DEGRADED",
  ];
  assert.deepEqual([...capability.ApiKeysPersonalAccessTokensReadiness], readinessValues);
});

test("apikeyspersonalaccesstokensstatemodel", () => {
  const config = buildReadyConfig();
  const created = capability.createKeyWithSecret(config, config.audit, "t1", ["s"]);
  assert.ok(isCreatedWithSecret(created));
  const meta = created.metadata;

  assert.strictEqual(meta.active, true);
  assert.strictEqual(meta.revokedAt, null);
  assert.strictEqual(typeof meta.createdAt, "string");
  assert.strictEqual(meta.lastUsedAt, null);
  assert.strictEqual(meta.expiry, null);
  assert.strictEqual(typeof meta.keyPrefix, "string");
  assert.deepEqual(Array.from(meta.scopes), ["s"]);
  assert.notStrictEqual(meta.keyPrefix, created.secret);

  assert.strictEqual((meta as unknown as { hash?: unknown }).hash, undefined);
  assert.strictEqual((meta as unknown as { salt?: unknown }).salt, undefined);
  assert.strictEqual((meta as unknown as { secret?: unknown }).secret, undefined);

  assert.strictEqual(created.secret.includes("hash"), false);
  assert.strictEqual(created.secret.includes("salt"), false);

  const listResult: unknown = capability.listKeys(config, "t1");
  assert.ok(isOkList(listResult));
  const listedMeta = listResult.keys[0]!;
  assert.strictEqual(listedMeta.active, true);
  assert.strictEqual(
    (listedMeta as unknown as { hash?: unknown }).hash,
    undefined,
  );
  assert.strictEqual(
    (listedMeta as unknown as { salt?: unknown }).salt,
    undefined,
  );
  assert.strictEqual(
    (listedMeta as unknown as { secret?: unknown }).secret,
    undefined,
  );

  const revoked = capability.revokeKey(config, config.audit, "t1", created.keyId);
  assert.ok(isOkOutcome(revoked));

  const afterRevokeList: unknown = capability.listKeys(config, "t1");
  assert.ok(isOkList(afterRevokeList));
  const afterMeta = afterRevokeList.keys[0]!;
  assert.strictEqual(afterMeta.active, false);
  assert.strictEqual(typeof afterMeta.revokedAt, "string");

  const outcomeValues: readonly capability.ApiKeysPersonalAccessTokensOutcome[] = [
    "OK",
    "NOT_ENTITLED",
  ];
  assert.deepEqual([...capability.ApiKeysPersonalAccessTokensOutcome], outcomeValues);

  const auditKinds: readonly capability.ApiKeysPersonalAccessTokensAuditEventKind[] = [
    "key-created",
    "key-revoked",
  ];
  assert.deepEqual(
    [...capability.ApiKeysPersonalAccessTokensAuditEventKind],
    auditKinds,
  );

  assert.strictEqual(capability.initialState, null);
});

test("apikeyspersonalaccesstokensuisemantics", () => {
  const config = buildReadyConfig();
  const created = capability.createKey(config, config.audit, "t1", ["read"]);
  assert.ok(isCreatedNoSecret(created));
  const meta = created.metadata;
  assert.strictEqual(meta.active, true);
  assert.deepEqual(Array.from(meta.scopes), ["read"]);

  const listResult: unknown = capability.listKeys(config, "t1");
  assert.ok(isOkList(listResult));
  assert.strictEqual(listResult.keys.length, 1);
  const listedMeta = listResult.keys[0]!;
  assert.strictEqual(listedMeta.keyId, created.keyId);
  assert.strictEqual(listedMeta.active, true);

  const devRead: unknown = capability.readKeyMetadata(config, "t1", created.keyId);
  assert.ok(isMetadata(devRead));

  const operatorResult: unknown = capability.operatorListKeys(config, "t1");
  assert.ok(isOkList(operatorResult));
  assert.strictEqual(operatorResult.keys.length, 1);
  const operatorMeta = operatorResult.keys[0]!;
  assert.strictEqual(operatorMeta.keyId, created.keyId);

  const auditKinds: readonly capability.ApiKeysPersonalAccessTokensAuditEventKind[] = [
    "key-created",
    "key-revoked",
  ];
  assert.strictEqual(auditKinds.length, 2);
});

test("apikeyspersonalaccesstokensvalidation", () => {
  const noEntitlementConfig: Config = {
    ...buildReadyConfig(),
    permissions: {
      tenantApiKeyRead: true,
      tenantApiKeyWrite: true,
      platformApiKeyRead: true,
      apiAccessEntitlement: false,
    },
  };
  const deniedForNoEntitlement = capability.createKey(
    noEntitlementConfig,
    noEntitlementConfig.audit,
    "t1",
    [],
  );
  assert.ok(isNotEntitled(deniedForNoEntitlement));
  assert.strictEqual(deniedForNoEntitlement.outcome, "NOT_ENTITLED");

  const config = buildReadyConfig();
  const invalidRoute = capability.readKeyMetadata(config, "t1", "bad id with spaces!");
  assert.ok(isError(invalidRoute));
  assert.strictEqual(invalidRoute.kind, "INVALID_ROUTE_IDENTIFIER");

  const invalidRouteRevoke = capability.revokeKey(
    config,
    config.audit,
    "t1",
    "!!!invalid!!!",
  );
  assert.ok(isError(invalidRouteRevoke));
  assert.strictEqual(invalidRouteRevoke.kind, "INVALID_ROUTE_IDENTIFIER");

  const created = capability.createKey(config, config.audit, "t1", ["read"]);
  assert.ok(isCreatedNoSecret(created));

  const garbageSecret = capability.authenticateKey(config, created.keyId, "garbage");
  assert.strictEqual(isAuthResult(garbageSecret), false);
  assert.strictEqual(isNotEntitled(garbageSecret), false);

  const wrongSecret = capability.authenticateKey(config, created.keyId, "wrong-secret");
  assert.strictEqual(isAuthResult(wrongSecret), false);
  assert.strictEqual(isNotEntitled(wrongSecret), false);

  const missingKeyAuth = capability.authenticateKey(
    config,
    "ak-valididentifier123",
    "any-secret",
  );
  assert.strictEqual(isAuthResult(missingKeyAuth), false);
  assert.strictEqual(isNotEntitled(missingKeyAuth), false);

  const revoked = capability.revokeKey(config, config.audit, "t1", created.keyId);
  assert.ok(isOkOutcome(revoked));

  const hashPresented = capability.authenticateKey(
    config,
    created.keyId,
    "stored:plaintext-secret-once",
  );
  assert.strictEqual(isAuthResult(hashPresented), false);
  assert.strictEqual(isNotEntitled(hashPresented), false);

  const crossTenantConfig: Config = {
    ...buildReadyConfig(),
    repository: buildTenantScopedRepo(),
  };
  const tenantAKey = capability.createKey(
    crossTenantConfig,
    crossTenantConfig.audit,
    "tenant-a",
    [],
  );
  assert.ok(isCreatedNoSecret(tenantAKey));
  const crossTenantList: unknown = capability.listKeys(crossTenantConfig, "tenant-b");
  assert.ok(isOkList(crossTenantList));
  assert.strictEqual(crossTenantList.keys.length, 0);

  assert.strictEqual(capability.validateRouteIdentifier("valid-key-1"), true);
  assert.strictEqual(capability.validateRouteIdentifier("bad id!"), false);
});