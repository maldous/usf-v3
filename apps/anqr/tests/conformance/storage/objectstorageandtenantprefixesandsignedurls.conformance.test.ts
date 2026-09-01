import * as capability from "../../../src/capabilities/storage/objectstorageandtenantprefixesandsignedurls.ts";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

test("objectstorageandtenantprefixesandsignedurlsauditmodel", () => {
  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const state = capability.initialState;
  const uploaded = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    1024,
    2048,
    mockAuditFn,
  );
  assert.equal(uploaded.kind, "success");
  assert.equal(uploaded.state.registry[0]?.tenantId, "tenant-123");
  assert.equal(uploaded.state.registry[0]?.organisationId, "org-456");
  assert.equal(uploaded.state.registry[0]?.scanState, "UPLOADED");

  const clean = capability.updateScanState(
    uploaded.state,
    "obj-789",
    "tenant-123",
    "CLEAN",
    mockAuditFn,
  );
  assert.equal(clean.kind, "success");
  assert.equal(clean.state.registry[0]?.scanState, "CLEAN");

  const signedUrl = capability.issueSignedUrl(
    clean.state,
    "obj-789",
    "tenant-123",
    3600,
    mockAuditFn,
  );
  assert.equal(typeof signedUrl, "object");
  assert.ok("url" in signedUrl);
  assert.ok(signedUrl.url.includes("tenant-tenant-123-"));
  assert.ok(signedUrl.expiresAt);

  const quotaState = capability.enforceQuota(
    clean.state,
    "tenant-123",
    2048,
    mockAuditFn,
  );
  assert.equal(quotaState.kind, "success");
  assert.equal(quotaState.state.storageBytesMeter, 1024);
});

test("objectstorageandtenantprefixesandsignedurlscontracts", () => {
  const state = capability.initialState;
  assert.deepEqual(state.registry, []);
  assert.equal(state.storageBytesMeter, 0);
  assert.equal(state.readiness, "UNAVAILABLE");
  assert.equal(state.lastError, null);

  assert.equal(typeof capability.probe, "function");
  assert.equal(typeof capability.checkReadiness, "function");
  assert.equal(typeof capability.uploadObject, "function");
  assert.equal(typeof capability.updateScanState, "function");
  assert.equal(typeof capability.issueSignedUrl, "function");
  assert.equal(typeof capability.enforceQuota, "function");

  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const uploaded = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploaded.kind, "success");
  assert.equal(uploaded.state.registry.length, 1);
  assert.equal(uploaded.state.registry[0]?.tenantId, "tenant-123");
  assert.equal(uploaded.state.registry[0]?.organisationId, "org-456");
  assert.ok(uploaded.state.registry[0]?.objectKey.startsWith("tenant-tenant-123-"));
  assert.equal(uploaded.state.storageBytesMeter, 100);

  const probeResult = capability.probe(uploaded.state);
  assert.equal(probeResult.readiness, "UNAVAILABLE");
  assert.equal(probeResult.storageBytesMeter, 100);
  assert.equal(probeResult.error, null);
});

test("objectstorageandtenantprefixesandsignedurlserrormodel", () => {
  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const state = capability.initialState;

  const signedUrlResult = capability.issueSignedUrl(
    state,
    "non-existent-obj",
    "tenant-123",
    3600,
    mockAuditFn,
  );
  assert.equal(signedUrlResult.kind, "TENANT_DATA_OR_SECURITY");

  const uploaded = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploaded.kind, "success");

  const quarantined = capability.updateScanState(
    uploaded.state,
    "obj-789",
    "tenant-123",
    "QUARANTINED",
    mockAuditFn,
  );
  assert.equal(quarantined.kind, "success");

  const signedUrlForQuarantined = capability.issueSignedUrl(
    quarantined.state,
    "obj-789",
    "tenant-123",
    3600,
    mockAuditFn,
  );
  assert.equal(signedUrlForQuarantined.kind, "SCAN_FAILED");

  const unavailableState: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...state,
    readiness: "UNAVAILABLE",
  };
  const uploadError = capability.uploadObject(
    unavailableState,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploadError.kind, "PROVIDER_UNAVAILABLE");

  const tenantAState = capability.uploadObject(
    state,
    "tenant-A",
    "org-1",
    "obj-A",
    "key-A.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(tenantAState.kind, "success");

  const tenantBError = capability.issueSignedUrl(
    tenantAState.state,
    "obj-A",
    "tenant-B",
    3600,
    mockAuditFn,
  );
  assert.equal(tenantBError.kind, "TENANT_DATA_OR_SECURITY");
});

test("objectstorageandtenantprefixesandsignedurlslifecycle", () => {
  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const state = capability.initialState;

  const uploaded = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploaded.kind, "success");
  assert.equal(uploaded.state.registry[0]?.scanState, "UPLOADED");
  assert.equal(uploaded.state.storageBytesMeter, 100);

  const clean = capability.updateScanState(
    uploaded.state,
    "obj-789",
    "tenant-123",
    "CLEAN",
    mockAuditFn,
  );
  assert.equal(clean.kind, "success");
  assert.equal(clean.state.registry[0]?.scanState, "CLEAN");

  const signedUrl = capability.issueSignedUrl(
    clean.state,
    "obj-789",
    "tenant-123",
    3600,
    mockAuditFn,
  );
  assert.equal(typeof signedUrl, "object");
  assert.ok("url" in signedUrl);
  assert.ok(signedUrl.url.includes("tenant-tenant-123-"));
  assert.ok(signedUrl.expiresAt.includes("T"));

  const quarantined = capability.updateScanState(
    clean.state,
    "obj-789",
    "tenant-123",
    "QUARANTINED",
    mockAuditFn,
  );
  assert.equal(quarantined.kind, "success");
  assert.equal(quarantined.state.registry[0]?.scanState, "QUARANTINED");

  const rejected = capability.updateScanState(
    clean.state,
    "obj-789",
    "tenant-123",
    "REJECTED",
    mockAuditFn,
  );
  assert.equal(rejected.kind, "success");
  assert.equal(rejected.state.registry[0]?.scanState, "REJECTED");
});

test("objectstorageandtenantprefixesandsignedurlspermissions", () => {
  const tenantPrefixA = capability.generateTenantPrefix("tenant-A");
  const tenantPrefixB = capability.generateTenantPrefix("tenant-B");
  assert.equal(tenantPrefixA, "tenant-tenant-A-");
  assert.equal(tenantPrefixB, "tenant-tenant-B-");
  assert.notEqual(tenantPrefixA, tenantPrefixB);

  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const tenantAState = capability.uploadObject(
    capability.initialState,
    "tenant-A",
    "org-1",
    "obj-A",
    "key-A.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(tenantAState.kind, "success");
  assert.equal(tenantAState.state.registry.length, 1);
  assert.equal(tenantAState.state.registry[0]?.tenantId, "tenant-A");
  assert.ok(tenantAState.state.registry[0]?.objectKey.startsWith("tenant-tenant-A-"));

  const tenantBState = capability.uploadObject(
    capability.initialState,
    "tenant-B",
    "org-2",
    "obj-B",
    "key-B.txt",
    "text/plain",
    200,
    1000,
    mockAuditFn,
  );
  assert.equal(tenantBState.kind, "success");
  assert.equal(tenantBState.state.registry.length, 1);
  assert.equal(tenantBState.state.registry[0]?.tenantId, "tenant-B");
  assert.ok(tenantBState.state.registry[0]?.objectKey.startsWith("tenant-tenant-B-"));

  const signedUrlA = capability.issueSignedUrl(
    tenantAState.state,
    "obj-A",
    "tenant-A",
    3600,
    mockAuditFn,
  );
  assert.equal(typeof signedUrlA, "object");
  assert.ok("url" in signedUrlA);
  assert.ok(signedUrlA.url.includes("tenant-tenant-A-"));

  const signedUrlB = capability.issueSignedUrl(
    tenantBState.state,
    "obj-B",
    "tenant-B",
    3600,
    mockAuditFn,
  );
  assert.equal(typeof signedUrlB, "object");
  assert.ok("url" in signedUrlB);
  assert.ok(signedUrlB.url.includes("tenant-tenant-B-"));
});

test("objectstorageandtenantprefixesandsignedurlsproof", () => {
  const state = capability.initialState;
  assert.deepEqual(state.registry, []);
  assert.equal(state.storageBytesMeter, 0);
  assert.equal(state.readiness, "UNAVAILABLE");
  assert.equal(state.lastError, null);

  const capabilities = [
    capability.uploadObject,
    capability.updateScanState,
    capability.issueSignedUrl,
    capability.checkReadiness,
    capability.probe,
    capability.enforceQuota,
  ];
  assert.equal(capabilities.length, 6);
  capabilities.forEach((fn) => assert.equal(typeof fn, "function"));

  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const uploaded = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "test.txt",
    "text/plain",
    500,
    1000,
    mockAuditFn,
  );
  assert.equal(uploaded.kind, "success");
  assert.equal(uploaded.state.registry[0]?.objectId, "obj-789");

  const clean = capability.updateScanState(
    uploaded.state,
    "obj-789",
    "tenant-123",
    "CLEAN",
    mockAuditFn,
  );
  assert.equal(clean.kind, "success");
  assert.equal(clean.state.registry[0]?.scanState, "CLEAN");

  const signedUrl = capability.issueSignedUrl(
    clean.state,
    "obj-789",
    "tenant-123",
    1800,
    mockAuditFn,
  );
  assert.equal(typeof signedUrl, "object");
  assert.ok("url" in signedUrl);
  assert.ok(signedUrl.expiresAt.includes("T"));

  const readinessState = capability.checkReadiness(
    clean.state,
    true,
    true,
  );
  assert.equal(readinessState.readiness, "READY");

  const probeResult = capability.probe(clean.state);
  assert.equal(probeResult.readiness, "READY");
  assert.equal(probeResult.storageBytesMeter, 500);
});

test("objectstorageandtenantprefixesandsignedurlsreadinessmodel", () => {
  const state = capability.initialState;

  const readyState = capability.checkReadiness(state, true, true);
  assert.equal(readyState.readiness, "READY");
  assert.equal(readyState.lastError, null);

  const degradedProvider = capability.checkReadiness(state, false, true);
  assert.equal(degradedProvider.readiness, "UNAVAILABLE");
  assert.notEqual(degradedProvider.lastError, null);
  assert.equal(degradedProvider.lastError?.kind, "PROVIDER_UNAVAILABLE");

  const degradedRegistry = capability.checkReadiness(state, true, false);
  assert.equal(degradedRegistry.readiness, "UNAVAILABLE");
  assert.notEqual(degradedRegistry.lastError, null);
  assert.equal(degradedRegistry.lastError?.kind, "PROVIDER_UNAVAILABLE");

  const readyProbe = capability.probe(readyState);
  assert.equal(readyProbe.readiness, "READY");

  const unavailableProbe = capability.probe(degradedProvider);
  assert.equal(unavailableProbe.readiness, "UNAVAILABLE");
  assert.equal(unavailableProbe.error?.kind, "PROVIDER_UNAVAILABLE");

  const unavailableState: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...state,
    readiness: "UNAVAILABLE",
  };
  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const uploadBlocked = capability.uploadObject(
    unavailableState,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploadBlocked.kind, "PROVIDER_UNAVAILABLE");
});

test("objectstorageandtenantprefixesandsignedurlsstatemodel", () => {
  const registryRecord: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsObjectRegistryRecord = {
    objectId: "obj-123",
    tenantId: "tenant-123",
    organisationId: "org-456",
    objectKey: "tenant-tenant-123-key.txt",
    contentType: "text/plain",
    sizeInBytes: 1024,
    scanState: "CLEAN",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tenantPrefix: "tenant-tenant-123-",
  };

  assert.equal(registryRecord.objectId, "obj-123");
  assert.equal(registryRecord.tenantId, "tenant-123");
  assert.equal(registryRecord.organisationId, "org-456");
  assert.ok(registryRecord.objectKey.startsWith("tenant-tenant-123-"));
  assert.equal(registryRecord.contentType, "text/plain");
  assert.equal(registryRecord.sizeInBytes, 1024);
  assert.equal(registryRecord.scanState, "CLEAN");
  assert.equal(registryRecord.tenantPrefix, capability.generateTenantPrefix("tenant-123"));

  const state: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    registry: [registryRecord],
    storageBytesMeter: 1024,
    readiness: "READY",
    lastError: null,
  };

  const tenantUsage = state.registry
    .filter((r) => r.tenantId === "tenant-123")
    .reduce((sum, obj) => sum + obj.sizeInBytes, 0);
  assert.equal(tenantUsage, 1024);
});

test("objectstorageandtenantprefixesandsignedurlsvalidation", () => {
  const mockAuditFn = (_event: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsAuditEvent): null => null;
  const state = capability.initialState;

  const uploadedValid = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploadedValid.kind, "success");

  const uploadInvalidContentType = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "invalid/type" as capability.ObjectStorageAndTenantPrefixesAndSignedUrlsObjectRegistryRecord["contentType"],
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploadInvalidContentType.kind, "INVALID_CONTENT_TYPE");

  const uploadInvalidSize = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    0,
    1000,
    mockAuditFn,
  );
  assert.equal(uploadInvalidSize.kind, "INVALID_SIZE");

  const uploadSizeTooLarge = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    2000,
    1000,
    mockAuditFn,
  );
  assert.equal(uploadSizeTooLarge.kind, "INVALID_SIZE");

  const uploadValidSize = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    500,
    1000,
    mockAuditFn,
  );
  assert.equal(uploadValidSize.kind, "success");

  const uploaded = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "text/plain",
    100,
    1000,
    mockAuditFn,
  );
  assert.equal(uploaded.kind, "success");

  const quarantined = capability.updateScanState(
    uploaded.state,
    "obj-789",
    "tenant-123",
    "QUARANTINED",
    mockAuditFn,
  );
  assert.equal(quarantined.kind, "success");

  const signedUrlQuarantined = capability.issueSignedUrl(
    quarantined.state,
    "obj-789",
    "tenant-123",
    3600,
    mockAuditFn,
  );
  assert.equal(signedUrlQuarantined.kind, "SCAN_FAILED");
});