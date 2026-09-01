import * as capability from "../../../src/capabilities/storage/objectstorageandtenantprefixesandsignedurls.ts";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

test("objectstorageandtenantprefixesandsignedurlsauditmodel", () => {
  const mockAuditFn = (): null => null;
  const auditEvent = capability.auditEvent(
    "OBJECT_UPLOAD" as const,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    { contentType: "text/plain", sizeInBytes: 1024 },
    mockAuditFn,
  );
  assert.strictEqual(auditEvent, null);

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
  if ("registry" in uploaded) {
    assert.strictEqual(uploaded.registry[0]?.tenantId, "tenant-123");
    assert.strictEqual(uploaded.registry[0]?.organisationId, "org-456");
  } else {
    assert.fail("uploadObject should return state with registry");
  }

  const clean = capability.updateScanState(
    uploaded,
    "obj-789",
    "tenant-123",
    "CLEAN",
    mockAuditFn,
  );
  if ("registry" in clean) {
    assert.strictEqual(clean.registry[0]?.scanState, "CLEAN");
  } else {
    assert.fail("updateScanState should return state with registry");
  }

  const signedUrl = capability.issueSignedUrl(
    clean,
    "obj-789",
    "tenant-123",
    3600,
  );
  if ("url" in signedUrl) {
    assert.ok(signedUrl.url.includes("tenant-tenant-123-"));
    assert.ok(signedUrl.expiresAt);
  } else {
    assert.fail("issueSignedUrl should return signed URL for clean object");
  }

  const quotaState = capability.enforceQuota(
    clean,
    "tenant-123",
    2048,
  );
  if ("registry" in quotaState) {
    assert.strictEqual(quotaState.storageBytesMeter, 1024);
  } else {
    assert.fail("enforceQuota should return state with storageBytesMeter");
  }
});

test("objectstorageandtenantprefixesandsignedurlscontracts", () => {
  const state = capability.initialState;
  assert.deepStrictEqual(state.registry, []);
  assert.strictEqual(state.storageBytesMeter, 0);
  assert.strictEqual(state.readiness, "UNAVAILABLE");
  assert.strictEqual(state.lastError, null);

  assert(typeof capability.probe === "function");
  assert(typeof capability.checkReadiness === "function");
  assert(typeof capability.uploadObject === "function");
  assert(typeof capability.updateScanState === "function");
  assert(typeof capability.issueSignedUrl === "function");
  assert(typeof capability.enforceQuota === "function");

  const mockAuditFn = (): null => null;
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
  if ("registry" in uploaded) {
    assert.strictEqual(uploaded.registry.length, 1);
    assert.strictEqual(uploaded.registry[0]?.tenantId, "tenant-123");
    assert.strictEqual(uploaded.registry[0]?.organisationId, "org-456");
    assert(uploaded.registry[0]?.objectKey.startsWith("tenant-tenant-123-"));
    assert.strictEqual(uploaded.storageBytesMeter, 100);
  } else {
    assert.fail("uploadObject should return state with registry");
  }

  const probeResult = capability.probe(uploaded);
  assert.strictEqual(probeResult.readiness, "UNAVAILABLE");
  assert.strictEqual(probeResult.storageBytesMeter, 100);
  assert.strictEqual(probeResult.error, null);
});

test("objectstorageandtenantprefixesandsignedurlserrormodel", () => {
  const mockAuditFn = (): null => null;
  const state = capability.initialState;

  // Unscanned object cannot be signed
  const signedUrlResult = capability.issueSignedUrl(
    state,
    "non-existent-obj",
    "tenant-123",
    3600,
  );
  assert("kind" in signedUrlResult);
  assert.strictEqual(signedUrlResult.kind, "TENANT_DATA_OR_SECURITY");

  // Quarantined object cannot be signed
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
  if ("registry" in uploaded) {
    const quarantined = capability.updateScanState(
      uploaded,
      "obj-789",
      "tenant-123",
      "QUARANTINED",
      mockAuditFn,
    );
    if ("registry" in quarantined) {
      const signedUrlForQuarantined = capability.issueSignedUrl(
        quarantined,
        "obj-789",
        "tenant-123",
        3600,
      );
      assert("kind" in signedUrlForQuarantined);
      assert.strictEqual(signedUrlForQuarantined.kind, "SCAN_FAILED");
    } else {
      assert.fail("updateScanState should return state with registry");
    }
  } else {
    assert.fail("uploadObject should return state with registry");
  }

  // Provider unavailable returns typed error
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
  assert("kind" in uploadError);
  assert.strictEqual(uploadError.kind, "PROVIDER_UNAVAILABLE");

  // Cross-tenant access denied
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
  if ("registry" in tenantAState) {
    const tenantBError = capability.issueSignedUrl(
      tenantAState,
      "obj-A",
      "tenant-B",
      3600,
    );
    assert("kind" in tenantBError);
    assert.strictEqual(tenantBError.kind, "TENANT_DATA_OR_SECURITY");
  } else {
    assert.fail("uploadObject should return state with registry");
  }
});

test("objectstorageandtenantprefixesandsignedurlslifecycle", () => {
  const mockAuditFn = (): null => null;
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
  if ("registry" in uploaded) {
    assert.strictEqual(uploaded.registry[0]?.scanState, "UPLOADED");
    assert.strictEqual(uploaded.storageBytesMeter, 100);

    const clean = capability.updateScanState(
      uploaded,
      "obj-789",
      "tenant-123",
      "CLEAN",
      mockAuditFn,
    );
    if ("registry" in clean) {
      assert.strictEqual(clean.registry[0]?.scanState, "CLEAN");

      const signedUrl = capability.issueSignedUrl(
        clean,
        "obj-789",
        "tenant-123",
        3600,
      );
      assert("url" in signedUrl);
      assert(signedUrl.url.includes("tenant-tenant-123-"));
      assert(signedUrl.expiresAt.includes("T"));

      const quarantined = capability.updateScanState(
        clean,
        "obj-789",
        "tenant-123",
        "QUARANTINED",
        mockAuditFn,
      );
      if ("registry" in quarantined) {
        assert.strictEqual(quarantined.registry[0]?.scanState, "QUARANTINED");
      }

      const rejected = capability.updateScanState(
        clean,
        "obj-789",
        "tenant-123",
        "REJECTED",
        mockAuditFn,
      );
      if ("registry" in rejected) {
        assert.strictEqual(rejected.registry[0]?.scanState, "REJECTED");
      }
    } else {
      assert.fail("updateScanState should return state with registry");
    }
  } else {
    assert.fail("uploadObject should return state with registry");
  }
});

test("objectstorageandtenantprefixesandsignedurlspermissions", () => {
  const tenantPrefixA = capability.generateTenantPrefix("tenant-A");
  const tenantPrefixB = capability.generateTenantPrefix("tenant-B");
  assert.strictEqual(tenantPrefixA, "tenant-tenant-A-");
  assert.strictEqual(tenantPrefixB, "tenant-tenant-B-");
  assert.notStrictEqual(tenantPrefixA, tenantPrefixB);

  const mockAuditFn = (): null => null;
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
  if ("registry" in tenantAState) {
    assert.strictEqual(tenantAState.registry.length, 1);
    assert.strictEqual(tenantAState.registry[0]?.tenantId, "tenant-A");
    assert(tenantAState.registry[0]?.objectKey.startsWith("tenant-tenant-A-"));

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
    if ("registry" in tenantBState) {
      assert.strictEqual(tenantBState.registry.length, 1);
      assert.strictEqual(tenantBState.registry[0]?.tenantId, "tenant-B");
      assert(tenantBState.registry[0]?.objectKey.startsWith("tenant-tenant-B-"));

      const signedUrlA = capability.issueSignedUrl(
        tenantAState,
        "obj-A",
        "tenant-A",
        3600,
      );
      assert("url" in signedUrlA);
      assert(signedUrlA.url.includes("tenant-tenant-A-"));

      const signedUrlB = capability.issueSignedUrl(
        tenantBState,
        "obj-B",
        "tenant-B",
        3600,
      );
      assert("url" in signedUrlB);
      assert(signedUrlB.url.includes("tenant-tenant-B-"));
    } else {
      assert.fail("uploadObject should return state with registry");
    }
  } else {
    assert.fail("uploadObject should return state with registry");
  }
});

test("objectstorageandtenantprefixesandsignedurlsproof", () => {
  const state = capability.initialState;
  assert.deepStrictEqual(state.registry, []);
  assert.strictEqual(state.storageBytesMeter, 0);
  assert.strictEqual(state.readiness, "UNAVAILABLE");
  assert.strictEqual(state.lastError, null);

  const capabilities = [
    capability.uploadObject,
    capability.updateScanState,
    capability.issueSignedUrl,
    capability.checkReadiness,
    capability.probe,
    capability.enforceQuota,
  ];
  assert.strictEqual(capabilities.length, 6);
  capabilities.forEach((fn) => assert(typeof fn === "function"));

  const mockAuditFn = (): null => null;
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
  if ("registry" in uploaded) {
    assert.strictEqual(uploaded.registry[0]?.objectId, "obj-789");

    const clean = capability.updateScanState(
      uploaded,
      "obj-789",
      "tenant-123",
      "CLEAN",
      mockAuditFn,
    );
    if ("registry" in clean) {
      assert.strictEqual(clean.registry[0]?.scanState, "CLEAN");

      const signedUrl = capability.issueSignedUrl(
        clean,
        "obj-789",
        "tenant-123",
        1800,
      );
      assert("url" in signedUrl);
      assert(signedUrl.expiresAt.includes("T"));

      const readinessState = capability.checkReadiness(
        clean,
        true,
        true,
      );
      assert.strictEqual(readinessState.readiness, "READY");

      const probeResult = capability.probe(clean);
      assert.strictEqual(probeResult.readiness, "READY");
      assert.strictEqual(probeResult.storageBytesMeter, 500);
    } else {
      assert.fail("updateScanState should return state with registry");
    }
  } else {
    assert.fail("uploadObject should return state with registry");
  }
});

test("objectstorageandtenantprefixesandsignedurlsreadinessmodel", () => {
  const state = capability.initialState;

  const readyState = capability.checkReadiness(state, true, true);
  assert.strictEqual(readyState.readiness, "READY");
  assert.strictEqual(readyState.lastError, null);

  const degradedProvider = capability.checkReadiness(state, false, true);
  assert.strictEqual(degradedProvider.readiness, "UNAVAILABLE");
  assert.notStrictEqual(degradedProvider.lastError, null);
  assert.strictEqual(degradedProvider.lastError?.kind, "PROVIDER_UNAVAILABLE");

  const degradedRegistry = capability.checkReadiness(state, true, false);
  assert.strictEqual(degradedRegistry.readiness, "UNAVAILABLE");
  assert.notStrictEqual(degradedRegistry.lastError, null);
  assert.strictEqual(degradedRegistry.lastError?.kind, "PROVIDER_UNAVAILABLE");

  const readyProbe = capability.probe(readyState);
  assert.strictEqual(readyProbe.readiness, "READY");

  const unavailableProbe = capability.probe(degradedProvider);
  assert.strictEqual(unavailableProbe.readiness, "UNAVAILABLE");
  assert.strictEqual(unavailableProbe.error?.kind, "PROVIDER_UNAVAILABLE");

  const unavailableState: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    ...state,
    readiness: "UNAVAILABLE",
  };
  const mockAuditFn = (): null => null;
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
  assert("kind" in uploadBlocked);
  assert.strictEqual(uploadBlocked.kind, "PROVIDER_UNAVAILABLE");
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

  assert.strictEqual(registryRecord.objectId, "obj-123");
  assert.strictEqual(registryRecord.tenantId, "tenant-123");
  assert.strictEqual(registryRecord.organisationId, "org-456");
  assert(registryRecord.objectKey.startsWith("tenant-tenant-123-"));
  assert.strictEqual(registryRecord.contentType, "text/plain");
  assert.strictEqual(registryRecord.sizeInBytes, 1024);
  assert.strictEqual(registryRecord.scanState, "CLEAN");
  assert.strictEqual(registryRecord.tenantPrefix, capability.generateTenantPrefix("tenant-123"));

  const state: capability.ObjectStorageAndTenantPrefixesAndSignedUrlsState = {
    registry: [registryRecord],
    storageBytesMeter: 1024,
    readiness: "READY",
    lastError: null,
  };

  const tenantUsage = state.registry
    .filter((r) => r.tenantId === "tenant-123")
    .reduce((sum, obj) => sum + obj.sizeInBytes, 0);
  assert.strictEqual(tenantUsage, 1024);
});

test("objectstorageandtenantprefixesandsignedurlsvalidation", () => {
  const mockAuditFn = (): null => null;
  const state = capability.initialState;

  // Valid content type and size
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
  assert("registry" in uploadedValid);

  // Invalid content type
  const uploadInvalidContentType = capability.uploadObject(
    state,
    "tenant-123",
    "org-456",
    "obj-789",
    "key.txt",
    "invalid/type",
    100,
    1000,
    mockAuditFn,
  );
  assert("kind" in uploadInvalidContentType);
  assert.strictEqual(uploadInvalidContentType.kind, "INVALID_CONTENT_TYPE");

  // Invalid size (0)
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
  assert("kind" in uploadInvalidSize);
  assert.strictEqual(uploadInvalidSize.kind, "INVALID_SIZE");

  // Size exceeds quota
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
  assert("kind" in uploadSizeTooLarge);
  assert.strictEqual(uploadSizeTooLarge.kind, "INVALID_SIZE");

  // Valid size within quota
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
  assert("registry" in uploadValidSize);

  // Non-clean objects cannot be used for signed URLs
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
  if ("registry" in uploaded) {
    const quarantined = capability.updateScanState(
      uploaded,
      "obj-789",
      "tenant-123",
      "QUARANTINED",
      mockAuditFn,
    );
    if ("registry" in quarantined) {
      const signedUrlQuarantined = capability.issueSignedUrl(
        quarantined,
        "obj-789",
        "tenant-123",
        3600,
      );
      assert("kind" in signedUrlQuarantined);
      assert.strictEqual(signedUrlQuarantined.kind, "SCAN_FAILED");
    } else {
      assert.fail("updateScanState should return state with registry");
    }
  } else {
    assert.fail("uploadObject should return state with registry");
  }
});