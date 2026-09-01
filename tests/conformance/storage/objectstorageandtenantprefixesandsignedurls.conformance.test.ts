import * as capability from "../../../src/capabilities/storage/objectstorageandtenantprefixesandsignedurls.ts";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

const auditOk = (
  _event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent,
): null => null;

const auditFailing = (
  _event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent,
): capability.ObjectStorageAndTenantPrefixesAndSignedUrlsError => ({
  kind: "AUDIT_FAILURE",
  message: "audit sink failed",
});

function isSuccess(
  r:
    | { readonly kind: "success"; readonly state: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState }
    | capability.ObjectStorageAndTenantPrefixesAndSignedUrlsError,
): r is { readonly kind: "success"; readonly state: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState } {
  return r.kind === "success";
}

function isError(
  r: unknown,
): r is capability.ObjectStorageAndTenantPrefixesAndSignedUrlsError {
  return (
    typeof r === "object" &&
    r !== null &&
    "kind" in r &&
    typeof (r as { kind: unknown }).kind === "string" &&
    (capability.ObjectStorageAndTenantPrefixesAndSignedUrlsErrorKind as readonly string[]).includes(
      (r as { kind: string }).kind,
    )
  );
}

function isSignedUrl(
  r: unknown,
): r is capability.ObjectStorageAndTenantPrefixesAndSignedUrlsSignedUrl {
  return (
    typeof r === "object" &&
    r !== null &&
    "url" in r &&
    typeof (r as { url: unknown }).url === "string"
  );
}

test("objectstorageandtenantprefixesandsignedurlsauditmodel", () => {
  const seen: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent[] = [];
  const capturingAudit = (
    e: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent,
  ): null => {
    seen.push(e);
    return null;
  };

  const ready: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "READY",
  };

  const uploaded = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-789",
    "doc.txt",
    "text/plain",
    1024,
    2048,
    capturingAudit,
  );
  assert.ok(isSuccess(uploaded));
  const rec0 = uploaded.state.registry[0];
  assert.ok(rec0);
  assert.equal(rec0.tenantId, "tenant-123");
  assert.equal(rec0.organisationId, "org-456");
  assert.equal(rec0.scanState, "UPLOADED");

  const uploadedEvent = seen[0];
  assert.ok(uploadedEvent);
  assert.equal(uploadedEvent.kind, "OBJECT_UPLOAD");
  assert.equal(uploadedEvent.tenantId, "tenant-123");
  assert.equal(uploadedEvent.organisationId, "org-456");
  assert.equal(uploadedEvent.objectId, "obj-789");
  assert.ok(uploadedEvent.objectKey.startsWith("tenant-tenant-123-"));
  assert.match(uploadedEvent.timestamp, /^\d{4}-\d{2}-\d{2}T/);

  const clean = capability.updateScanState(
    uploaded.state,
    "obj-789",
    "tenant-123",
    "org-456",
    "CLEAN",
    capturingAudit,
  );
  assert.ok(isSuccess(clean));
  assert.equal(clean.state.registry[0]?.scanState, "CLEAN");

  const cleanEvent = seen[1];
  assert.ok(cleanEvent);
  assert.equal(cleanEvent.kind, "OBJECT_CLEAN");
  assert.equal(cleanEvent.tenantId, "tenant-123");
  assert.equal(cleanEvent.organisationId, "org-456");

  const signed = capability.issueSignedUrl(
    clean.state,
    "obj-789",
    "tenant-123",
    "org-456",
    3600,
    capturingAudit,
  );
  assert.ok(isSignedUrl(signed));
  const signedEvent = seen[2];
  assert.ok(signedEvent);
  assert.equal(signedEvent.kind, "SIGNED_URL_ISSUED");
  assert.equal(signedEvent.tenantId, "tenant-123");
  assert.equal(signedEvent.organisationId, "org-456");

  const quota = capability.enforceQuota(
    clean.state,
    "tenant-123",
    "org-456",
    2048,
    capturingAudit,
  );
  assert.ok(isSuccess(quota));
  assert.ok(quota.state.storageBytesMeter >= 1024);

  const quotaEvent = seen[3];
  assert.ok(quotaEvent);
  assert.equal(quotaEvent.kind, "QUOTA_CHANGE");
  assert.equal(quotaEvent.tenantId, "tenant-123");
  assert.equal(quotaEvent.organisationId, "org-456");
});

test("objectstorageandtenantprefixesandsignedurlscontracts", () => {
  const ready: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "READY",
    providerAvailable: true,
    registryAvailable: true,
  };

  assert.deepEqual(capability.initialState.registry, []);
  assert.equal(capability.initialState.storageBytesMeter, 0);
  assert.equal(typeof capability.probe, "function");
  assert.equal(typeof capability.checkReadiness, "function");
  assert.equal(typeof capability.uploadObject, "function");
  assert.equal(typeof capability.updateScanState, "function");
  assert.equal(typeof capability.issueSignedUrl, "function");
  assert.equal(typeof capability.enforceQuota, "function");

  const uploaded = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-789",
    "report.pdf",
    "application/pdf",
    100,
    1000,
    auditOk,
  );
  assert.ok(isSuccess(uploaded));
  assert.equal(uploaded.state.registry.length, 1);
  assert.equal(uploaded.state.registry[0]?.tenantId, "tenant-123");
  assert.equal(uploaded.state.registry[0]?.organisationId, "org-456");
  assert.ok(
    uploaded.state.registry[0]?.objectKey.startsWith("tenant-tenant-123-"),
  );
  assert.equal(uploaded.state.storageBytesMeter, 100);
  assert.equal(uploaded.state.registry[0]?.sizeInBytes, 100);

  const probeResult = capability.probe(uploaded.state);
  assert.equal(probeResult.readiness, "READY");
  assert.equal(probeResult.storageBytesMeter, 100);
  assert.equal(probeResult.providerAvailable, true);
  assert.equal(probeResult.registryAvailable, true);

  const listed = capability.listTenantObjects(
    uploaded.state,
    "tenant-123",
    "org-456",
  );
  assert.ok(Array.isArray(listed));
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.objectKey, "tenant-tenant-123-report.pdf");

  const wrongTenant = capability.listTenantObjects(
    uploaded.state,
    "tenant-other",
    "org-other",
  );
  assert.ok(Array.isArray(wrongTenant));
  assert.equal(wrongTenant.length, 0);

  const mutationAllowed = capability.isMutationAllowed(uploaded.state);
  assert.equal(mutationAllowed, true);

  const notReady: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...uploaded.state,
    readiness: "DEGRADED_READ_ONLY",
  };
  assert.equal(capability.isMutationAllowed(notReady), false);
});

test("objectstorageandtenantprefixesandsignedurlserrormodel", () => {
  const ready: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "READY",
  };

  const missingCtx = capability.uploadObject(
    ready,
    "",
    "org-456",
    "obj-1",
    "k.txt",
    "text/plain",
    10,
    100,
    auditOk,
  );
  assert.ok(isError(missingCtx));
  assert.equal(missingCtx.kind, "MISSING_TENANT_CONTEXT");

  const badType = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-2",
    "k.bin",
    "application/octet-stream",
    10,
    100,
    auditOk,
  );
  assert.ok(isError(badType));
  assert.equal(badType.kind, "INVALID_CONTENT_TYPE");

  const badSize = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-3",
    "k.txt",
    "text/plain",
    0,
    100,
    auditOk,
  );
  assert.ok(isError(badSize));
  assert.equal(badSize.kind, "INVALID_SIZE");

  const uploaded = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-9",
    "doc.txt",
    "text/plain",
    50,
    1000,
    auditOk,
  );
  assert.ok(isSuccess(uploaded));

  const quarantined = capability.updateScanState(
    uploaded.state,
    "obj-9",
    "tenant-123",
    "org-456",
    "QUARANTINED",
    auditOk,
  );
  assert.ok(isSuccess(quarantined));

  const signedForQuarantined = capability.issueSignedUrl(
    quarantined.state,
    "obj-9",
    "tenant-123",
    "org-456",
    60,
    auditOk,
  );
  assert.ok(isError(signedForQuarantined));
  assert.equal(signedForQuarantined.kind, "SCAN_FAILED");

  const signedMissing = capability.issueSignedUrl(
    uploaded.state,
    "obj-nope",
    "tenant-123",
    "org-456",
    60,
    auditOk,
  );
  assert.ok(isError(signedMissing));
  assert.equal(signedMissing.kind, "OBJECT_NOT_FOUND");

  const crossTenant = capability.issueSignedUrl(
    uploaded.state,
    "obj-9",
    "tenant-other",
    "org-other",
    60,
    auditOk,
  );
  assert.ok(isError(crossTenant));
  assert.equal(crossTenant.kind, "OBJECT_NOT_FOUND");

  const unavailable: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "UNAVAILABLE",
  };
  const blockedUpload = capability.uploadObject(
    unavailable,
    "tenant-123",
    "org-456",
    "obj-1",
    "k.txt",
    "text/plain",
    10,
    100,
    auditOk,
  );
  assert.ok(isError(blockedUpload));
  assert.equal(blockedUpload.kind, "PROVIDER_UNAVAILABLE");

  const badExpiry = capability.issueSignedUrl(
    uploaded.state,
    "obj-9",
    "tenant-123",
    "org-456",
    0,
    auditOk,
  );
  assert.ok(isError(badExpiry));
  assert.equal(badExpiry.kind, "INVALID_CONFIGURATION");

  const auditFail = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-audit",
    "k.txt",
    "text/plain",
    10,
    100,
    auditFailing,
  );
  assert.ok(isError(auditFail));
  assert.equal(auditFail.kind, "AUDIT_FAILURE");
});

test("objectstorageandtenantprefixesandsignedurlslifecycle", () => {
  const ready: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "READY",
  };

  const uploaded = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-1",
    "file.txt",
    "text/plain",
    100,
    1000,
    auditOk,
  );
  assert.ok(isSuccess(uploaded));
  assert.equal(uploaded.state.registry[0]?.scanState, "UPLOADED");
  assert.equal(uploaded.state.storageBytesMeter, 100);
  assert.equal(uploaded.state.registry[0]?.contentType, "text/plain");

  const clean = capability.updateScanState(
    uploaded.state,
    "obj-1",
    "tenant-123",
    "org-456",
    "CLEAN",
    auditOk,
  );
  assert.ok(isSuccess(clean));
  assert.equal(clean.state.registry[0]?.scanState, "CLEAN");

  const signed = capability.issueSignedUrl(
    clean.state,
    "obj-1",
    "tenant-123",
    "org-456",
    60,
    auditOk,
  );
  assert.ok(isSignedUrl(signed));
  assert.ok(signed.url.includes("tenant-tenant-123-"));
  assert.match(signed.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(signed.objectId, "obj-1");
  assert.equal(signed.tenantId, "tenant-123");

  const quar = capability.updateScanState(
    clean.state,
    "obj-1",
    "tenant-123",
    "org-456",
    "QUARANTINED",
    auditOk,
  );
  assert.ok(isSuccess(quar));
  assert.equal(quar.state.registry[0]?.scanState, "QUARANTINED");

  const rejected = capability.updateScanState(
    clean.state,
    "obj-1",
    "tenant-123",
    "org-456",
    "REJECTED",
    auditOk,
  );
  assert.ok(isSuccess(rejected));
  assert.equal(rejected.state.registry[0]?.scanState, "REJECTED");
});

test("objectstorageandtenantprefixesandsignedurlspermissions", () => {
  const prefixA = capability.generateTenantPrefix("tenant-A");
  const prefixB = capability.generateTenantPrefix("tenant-B");
  assert.equal(prefixA, "tenant-tenant-A-");
  assert.equal(prefixB, "tenant-tenant-B-");
  assert.notEqual(prefixA, prefixB);

  const ready: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "READY",
  };

  const stateA = capability.uploadObject(
    ready,
    "tenant-A",
    "org-1",
    "obj-A",
    "key-A.txt",
    "text/plain",
    100,
    1000,
    auditOk,
  );
  assert.ok(isSuccess(stateA));
  const recA = stateA.state.registry[0];
  assert.ok(recA);
  assert.ok(recA.objectKey.startsWith("tenant-tenant-A-"));
  assert.ok(!recA.objectKey.startsWith("tenant-tenant-B-"));

  const stateB = capability.uploadObject(
    ready,
    "tenant-B",
    "org-2",
    "obj-B",
    "key-B.txt",
    "text/plain",
    200,
    1000,
    auditOk,
  );
  assert.ok(isSuccess(stateB));
  const recB = stateB.state.registry[0];
  assert.ok(recB);
  assert.ok(recB.objectKey.startsWith("tenant-tenant-B-"));
  assert.ok(!recB.objectKey.startsWith("tenant-tenant-A-"));

  const crossAttempt = capability.issueSignedUrl(
    stateA.state,
    "obj-A",
    "tenant-B",
    "org-2",
    60,
    auditOk,
  );
  assert.ok(isError(crossAttempt));
  assert.equal(crossAttempt.kind, "OBJECT_NOT_FOUND");

  const isolation = capability.validatePrefixIsolation(
    stateA.state,
    "tenant-tenant-A-other.txt",
    "tenant-A",
  );
  assert.equal(isolation, true);

  const wrongPrefix = capability.validatePrefixIsolation(
    stateA.state,
    "tenant-tenant-B-other.txt",
    "tenant-A",
  );
  assert.equal(wrongPrefix, false);

  const ctxOk = capability.validateTenantContext("tenant-A", "org-1");
  assert.equal(ctxOk, true);
  const ctxBad = capability.validateTenantContext("", "org-1");
  assert.equal(ctxBad, false);

  assert.equal(
    capability.validateContentType("application/pdf"),
    true,
  );
  assert.equal(
    capability.validateContentType("application/octet-stream"),
    false,
  );
});

test("objectstorageandtenantprefixesandsignedurlsproof", () => {
  const state = capability.initialState;
  assert.deepEqual(state.registry, []);
  assert.equal(state.storageBytesMeter, 0);
  assert.equal(state.readiness, "UNAVAILABLE");
  assert.equal(state.lastError, null);
  assert.equal(state.providerAvailable, false);
  assert.equal(state.registryAvailable, false);

  const exports = [
    capability.uploadObject,
    capability.updateScanState,
    capability.issueSignedUrl,
    capability.checkReadiness,
    capability.probe,
    capability.enforceQuota,
    capability.listTenantObjects,
    capability.validatePrefixIsolation,
    capability.validateTenantContext,
    capability.validateContentType,
    capability.validateSize,
    capability.validateConfiguration,
    capability.generateTenantPrefix,
    capability.isMutationAllowed,
  ];
  for (const fn of exports) {
    assert.equal(typeof fn, "function");
  }

  const ready = capability.checkReadiness(state, true, true);
  assert.equal(ready.readiness, "READY");

  const uploaded = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-789",
    "test.txt",
    "text/plain",
    500,
    1000,
    auditOk,
  );
  assert.ok(isSuccess(uploaded));
  assert.equal(uploaded.state.registry[0]?.objectId, "obj-789");

  const clean = capability.updateScanState(
    uploaded.state,
    "obj-789",
    "tenant-123",
    "org-456",
    "CLEAN",
    auditOk,
  );
  assert.ok(isSuccess(clean));
  assert.equal(clean.state.registry[0]?.scanState, "CLEAN");

  const signed = capability.issueSignedUrl(
    clean.state,
    "obj-789",
    "tenant-123",
    "org-456",
    1800,
    auditOk,
  );
  assert.ok(isSignedUrl(signed));
  assert.match(signed.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

  const probeResult = capability.probe(clean.state);
  assert.equal(probeResult.readiness, "READY");
  assert.equal(probeResult.storageBytesMeter, 500);

  const quota = capability.enforceQuota(
    clean.state,
    "tenant-123",
    "org-456",
    1000,
    auditOk,
  );
  assert.ok(isSuccess(quota));
});

test("objectstorageandtenantprefixesandsignedurlsreadinessmodel", () => {
  const state = capability.initialState;

  const ready = capability.checkReadiness(state, true, true);
  assert.equal(ready.readiness, "READY");
  assert.equal(ready.lastError, null);
  assert.equal(ready.providerAvailable, true);
  assert.equal(ready.registryAvailable, true);
  assert.equal(capability.isMutationAllowed(ready), true);

  const unavailableBoth = capability.checkReadiness(state, false, false);
  assert.equal(unavailableBoth.readiness, "UNAVAILABLE");
  assert.ok(unavailableBoth.lastError);
  assert.equal(unavailableBoth.lastError?.kind, "PROVIDER_UNAVAILABLE");
  assert.equal(capability.isMutationAllowed(unavailableBoth), false);

  const degradedProviderOnly = capability.checkReadiness(state, true, false);
  assert.equal(degradedProviderOnly.readiness, "DEGRADED_READ_ONLY");
  assert.ok(degradedProviderOnly.lastError);
  assert.equal(
    degradedProviderOnly.lastError?.kind,
    "REGISTRY_UNAVAILABLE",
  );
  assert.equal(capability.isMutationAllowed(degradedProviderOnly), false);

  const degradedRegistryOnly = capability.checkReadiness(state, false, true);
  assert.equal(degradedRegistryOnly.readiness, "DEGRADED_READ_ONLY");
  assert.ok(degradedRegistryOnly.lastError);
  assert.equal(
    degradedRegistryOnly.lastError?.kind,
    "PROVIDER_UNAVAILABLE",
  );
  assert.equal(capability.isMutationAllowed(degradedRegistryOnly), false);

  const readyProbe = capability.probe(ready);
  assert.equal(readyProbe.readiness, "READY");
  assert.equal(readyProbe.error, null);

  const unavailableProbe = capability.probe(unavailableBoth);
  assert.equal(unavailableProbe.readiness, "UNAVAILABLE");
  assert.equal(unavailableProbe.error?.kind, "PROVIDER_UNAVAILABLE");

  const uploadWhenUnavailable = capability.uploadObject(
    unavailableBoth,
    "tenant-123",
    "org-456",
    "obj-1",
    "k.txt",
    "text/plain",
    10,
    100,
    auditOk,
  );
  assert.ok(isError(uploadWhenUnavailable));
  assert.equal(uploadWhenUnavailable.kind, "PROVIDER_UNAVAILABLE");

  const invalidConfig = capability.validateConfiguration(false, true, 1000);
  assert.ok(invalidConfig);
  assert.equal(invalidConfig.kind, "INVALID_CONFIGURATION");

  const zeroQuota = capability.validateConfiguration(true, true, 0);
  assert.ok(zeroQuota);
  assert.equal(zeroQuota.kind, "INVALID_CONFIGURATION");

  const goodConfig = capability.validateConfiguration(true, true, 1000);
  assert.equal(goodConfig, null);
});

test("objectstorageandtenantprefixesandsignedurlsstatemodel", () => {
  const ready: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "READY",
  };

  const uploaded = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-123",
    "key.txt",
    "text/plain",
    1024,
    10000,
    auditOk,
  );
  assert.ok(isSuccess(uploaded));
  const rec = uploaded.state.registry[0];
  assert.ok(rec);
  assert.equal(rec.objectId, "obj-123");
  assert.equal(rec.tenantId, "tenant-123");
  assert.equal(rec.organisationId, "org-456");
  assert.ok(rec.objectKey.startsWith("tenant-tenant-123-"));
  assert.equal(rec.contentType, "text/plain");
  assert.equal(rec.sizeInBytes, 1024);
  assert.equal(rec.scanState, "UPLOADED");
  assert.equal(
    rec.tenantPrefix,
    capability.generateTenantPrefix("tenant-123"),
  );
  assert.equal(rec.tenantPrefix, "tenant-tenant-123-");
  assert.match(rec.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(rec.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const tenantBytes = uploaded.state.registry
    .filter((r) => r.tenantId === "tenant-123")
    .reduce((sum, obj) => sum + obj.sizeInBytes, 0);
  assert.equal(tenantBytes, 1024);
  assert.equal(uploaded.state.storageBytesMeter, 1024);
});

test("objectstorageandtenantprefixesandsignedurlsvalidation", () => {
  const ready: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...capability.initialState,
    readiness: "READY",
  };

  assert.equal(
    capability.validateContentType("application/pdf"),
    true,
  );
  assert.equal(capability.validateContentType("image/png"), true);
  assert.equal(
    capability.validateContentType("application/octet-stream"),
    false,
  );

  assert.equal(capability.validateSize(100, 1000), true);
  assert.equal(capability.validateSize(0, 1000), false);
  assert.equal(capability.validateSize(-1, 1000), false);
  assert.equal(capability.validateSize(1001, 1000), false);
  assert.equal(capability.validateSize(NaN, 1000), false);

  assert.equal(
    capability.validateTenantContext("tenant-123", "org-456"),
    true,
  );
  assert.equal(capability.validateTenantContext("", "org-456"), false);
  assert.equal(
    capability.validateTenantContext("tenant-123", ""),
    false,
  );

  const badType = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-1",
    "k.bin",
    "application/octet-stream",
    10,
    100,
    auditOk,
  );
  assert.ok(isError(badType));
  assert.equal(badType.kind, "INVALID_CONTENT_TYPE");

  const badSize = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-2",
    "k.txt",
    "text/plain",
    0,
    100,
    auditOk,
  );
  assert.ok(isError(badSize));
  assert.equal(badSize.kind, "INVALID_SIZE");

  const tooBig = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-3",
    "k.txt",
    "text/plain",
    2000,
    1000,
    auditOk,
  );
  assert.ok(isError(tooBig));
  assert.equal(tooBig.kind, "INVALID_SIZE");

  const uploaded = capability.uploadObject(
    ready,
    "tenant-123",
    "org-456",
    "obj-9",
    "k.txt",
    "text/plain",
    100,
    1000,
    auditOk,
  );
  assert.ok(isSuccess(uploaded));

  const quar = capability.updateScanState(
    uploaded.state,
    "obj-9",
    "tenant-123",
    "org-456",
    "QUARANTINED",
    auditOk,
  );
  assert.ok(isSuccess(quar));

  const notCleanSigned = capability.issueSignedUrl(
    quar.state,
    "obj-9",
    "tenant-123",
    "org-456",
    60,
    auditOk,
  );
  assert.ok(isError(notCleanSigned));
  assert.equal(notCleanSigned.kind, "SCAN_FAILED");

  const invalidConfig = capability.validateConfiguration(false, true, 1000);
  assert.ok(invalidConfig);
  assert.equal(invalidConfig.kind, "INVALID_CONFIGURATION");

  const prefix = capability.generateTenantPrefix("tenant-123");
  assert.equal(prefix, "tenant-tenant-123-");
  assert.ok(
    uploaded.state.registry[0]?.objectKey.startsWith(prefix),
  );
});