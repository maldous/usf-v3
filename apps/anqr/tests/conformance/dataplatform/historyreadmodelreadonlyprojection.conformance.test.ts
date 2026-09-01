import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/dataplatform/historyreadmodelreadonlyprojection.ts";

test("historyreadmodelreadonlyprojectionauditmodel", () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-a",
    isAdmin: false,
  };
  let calledTenantId: string | null = null;
  const repository: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => {
    calledTenantId = tenantId;
    return {
      total: 1,
      entries: [
        {
          id: "1",
          source: "AUDIT" as const,
          type: "CREATE" as const,
          title: "Audit event",
          occurrenceTime: "2023-01-01T00:00:00Z",
          actor: "user-1",
          status: "success",
          secret: "should-not-leak",
          payload: { sensitive: true },
        },
      ],
    };
  };

  const result = capability.tenantHistory(state, context, 10, 0, repository);
  assert.strictEqual(calledTenantId, "tenant-a");
  assert.ok(!Array.isArray(result) && "entries" in result);
  const page = result as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(page.entries.length, 1);
  const entry = page.entries[0];
  const allowedKeys: readonly (keyof capability.HistoryReadModelReadOnlyProjectionEntry)[] =
    [
      "id",
      "source",
      "type",
      "title",
      "occurrenceTime",
      "actor",
      "status",
    ];
  for (const key of Object.keys(entry)) {
    assert.ok(
      allowedKeys.includes(key as keyof capability.HistoryReadModelReadOnlyProjectionEntry),
      `entry must not expose extra field: ${key}`
    );
  }
  assert.strictEqual(state.readiness, "READY");
  assert.strictEqual(state.lastError, null);
});

test("historyreadmodelreadonlyprojectioncontracts", () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-b",
    isAdmin: false,
  };
  const repository: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => ({
    total: 1,
    entries: [
      {
        id: "2",
        source: "EVENT" as const,
        type: "UPDATE" as const,
        title: "Event update",
        occurrenceTime: "2023-02-02T00:00:00Z",
        actor: "user-2",
        status: "failure",
        token: "should-not-leak",
      },
    ],
  });

  const result = capability.tenantHistory(state, context, 5, 0, repository);
  assert.ok(!Array.isArray(result) && "entries" in result);
  const page = result as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(page.limit, 5);
  assert.strictEqual(page.offset, 0);
  assert.strictEqual(page.total, 1);
  assert.strictEqual(page.entries.length, 1);
  assert.ok(!("token" in page.entries[0]));

  const adminContext: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "admin",
    isAdmin: true,
  };
  const adminResult = capability.adminTenantHistory(
    state,
    adminContext,
    "tenant-b",
    5,
    0,
    repository
  );
  assert.ok(!Array.isArray(adminResult) && "entries" in adminResult);
});

test("historyreadmodelreadonlyprojectionerrormodel", () => {
  const degradedState: capability.HistoryReadModelReadOnlyProjectionState = {
    readiness: "DEGRADED",
    lastError: { kind: "STORE_UNAVAILABLE", message: "store down" },
  };
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-c",
    isAdmin: false,
  };
  const emptyRepo: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => ({
    total: 0,
    entries: [],
  });

  let result = capability.tenantHistory(degradedState, context, 10, 0, emptyRepo);
  assert.ok(!Array.isArray(result) && "kind" in result);
  assert.strictEqual(
    (result as capability.HistoryReadModelReadOnlyProjectionError).kind,
    "STORE_UNAVAILABLE"
  );

  result = capability.tenantHistory(capability.initialState, null, 10, 0, emptyRepo);
  assert.strictEqual(
    (result as capability.HistoryReadModelReadOnlyProjectionError).kind,
    "TENANT_CONTEXT_MISSING"
  );

  const nonAdmin: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-c",
    isAdmin: false,
  };
  result = capability.adminTenantHistory(
    capability.initialState,
    nonAdmin,
    "tenant-d",
    10,
    0,
    emptyRepo
  );
  assert.strictEqual(
    (result as capability.HistoryReadModelReadOnlyProjectionError).kind,
    "UNAUTHORIZED_TENANT_ACCESS"
  );

  result = capability.tenantHistory(capability.initialState, context, 0, 0, emptyRepo);
  assert.strictEqual(
    (result as capability.HistoryReadModelReadOnlyProjectionError).kind,
    "INVALID_PAGING_PARAMETERS"
  );

  const emptyResult = capability.tenantHistory(
    capability.initialState,
    context,
    10,
    0,
    emptyRepo
  ) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(emptyResult.total, 0);
  assert.deepStrictEqual(emptyResult.entries, []);
});

test("historyreadmodelreadonlyprojectionlifecycle", () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-e",
    isAdmin: false,
  };
  const repository: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => ({
    total: 1,
    entries: [
      {
        id: "3",
        source: "AUDIT" as const,
        type: "DELETE" as const,
        title: "Delete record",
        occurrenceTime: "2023-03-03T00:00:00Z",
        actor: "user-3",
        status: "deleted",
        password: "super-secret",
        token: "xyz",
        metadata: { internal: true },
      },
    ],
  });

  const result = capability.tenantHistory(
    state,
    context,
    10,
    0,
    repository
  ) as capability.HistoryReadModelReadOnlyProjectionPage;
  const entry = result.entries[0];
  assert.ok(!("password" in entry));
  assert.ok(!("token" in entry));
  assert.ok(!("metadata" in entry));
  assert.strictEqual(state.readiness, "READY");
  assert.strictEqual(state.lastError, null);
});

test("historyreadmodelreadonlyprojectionpermissions", () => {
  const state = capability.initialState;
  const tenantContext: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-f",
    isAdmin: false,
  };

  let scopedTenantId: string | null = null;
  const repository: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => {
    scopedTenantId = tenantId;
    return {
      total: 1,
      entries: [
        {
          id: "4",
          source: "EVENT" as const,
          type: "ACCESS" as const,
          title: "Access",
          occurrenceTime: "2023-04-04T00:00:00Z",
          actor: "user-4",
          status: "granted",
        },
      ],
    };
  };

  capability.tenantHistory(state, tenantContext, 10, 0, repository);
  assert.strictEqual(scopedTenantId, "tenant-f");

  const adminContext: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "admin",
    isAdmin: true,
  };
  let adminScopedTenantId: string | null = null;
  const adminRepository: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => {
    adminScopedTenantId = tenantId;
    return { total: 0, entries: [] };
  };
  const adminResult = capability.adminTenantHistory(
    state,
    adminContext,
    "tenant-g",
    10,
    0,
    adminRepository
  ) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(adminScopedTenantId, "tenant-g");
  assert.strictEqual(adminResult.entries.length, 0);

  const nonAdmin: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-f",
    isAdmin: false,
  };
  const unauthorized = capability.adminTenantHistory(
    state,
    nonAdmin,
    "tenant-g",
    10,
    0,
    adminRepository
  ) as capability.HistoryReadModelReadOnlyProjectionError;
  assert.strictEqual(unauthorized.kind, "UNAUTHORIZED_TENANT_ACCESS");
});

test("historyreadmodelreadonlyprojectionproof", () => {
  const state = capability.initialState;
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-proof",
    isAdmin: false,
  };
  const repository: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => ({
    total: 1,
    entries: [
      {
        id: "5",
        source: "AUDIT" as const,
        type: "CREATE" as const,
        title: "Proof create",
        occurrenceTime: "2023-05-05T00:00:00Z",
        actor: "user-5",
        status: "ok",
        secret: "hidden",
      },
    ],
  });

  const result = capability.tenantHistory(
    state,
    context,
    10,
    0,
    repository
  ) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(result.entries.length, 1);
  const entry = result.entries[0];
  const allowedKeys: readonly (keyof capability.HistoryReadModelReadOnlyProjectionEntry)[] =
    [
      "id",
      "source",
      "type",
      "title",
      "occurrenceTime",
      "actor",
      "status",
    ];
  assert.deepStrictEqual(
    Object.keys(entry),
    allowedKeys,
    "projection must assert the safe summarised shape"
  );
  let proofTenantId: string | null = null;
  const proofRepo: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => {
    proofTenantId = tenantId;
    return { total: 0, entries: [] };
  };
  capability.tenantHistory(state, context, 10, 0, proofRepo);
  assert.strictEqual(proofTenantId, "tenant-proof");
});

test("historyreadmodelreadonlyprojectionreadinessmodel", () => {
  const degradedState: capability.HistoryReadModelReadOnlyProjectionState = {
    readiness: "DEGRADED",
    lastError: { kind: "STORE_UNAVAILABLE", message: "store down" },
  };
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-readiness",
    isAdmin: false,
  };
  const emptyRepo: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => ({
    total: 0,
    entries: [],
  });

  const result = capability.tenantHistory(degradedState, context, 10, 0, emptyRepo);
  assert.ok(!Array.isArray(result) && "kind" in result);
  assert.strictEqual(
    (result as capability.HistoryReadModelReadOnlyProjectionError).kind,
    "STORE_UNAVAILABLE"
  );
});

test("historyreadmodelreadonlyprojectionstatemodel", () => {
  const rawEntry = {
    id: "6",
    source: "EVENT" as const,
    type: "ACCESS" as const,
    title: "Stat model",
    occurrenceTime: "2023-06-06T00:00:00Z",
    actor: "user-6",
    status: "allowed",
    extra: "should be dropped",
  };
  const projected = capability.projectHistoryEntry(rawEntry);
  assert.ok(projected !== null);
  const entry = projected as capability.HistoryReadModelReadOnlyProjectionEntry;
  const allowedKeys: readonly (keyof capability.HistoryReadModelReadOnlyProjectionEntry)[] =
    [
      "id",
      "source",
      "type",
      "title",
      "occurrenceTime",
      "actor",
      "status",
    ];
  assert.deepStrictEqual(Object.keys(entry), allowedKeys);

  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-stat",
    isAdmin: false,
  };
  const repository: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => ({
    total: 1,
    entries: [rawEntry],
  });
  const page = capability.tenantHistory(
    capability.initialState,
    context,
    7,
    2,
    repository
  ) as capability.HistoryReadModelReadOnlyProjectionPage;
  assert.strictEqual(page.limit, 7);
  assert.strictEqual(page.offset, 2);
  assert.strictEqual(page.total, 1);
  assert.strictEqual(page.entries.length, 1);
  assert.deepStrictEqual(Object.keys(page.entries[0]), allowedKeys);
});

test("historyreadmodelreadonlyprojectionvalidation", () => {
  const context: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "tenant-validate",
    isAdmin: false,
  };
  const emptyRepo: capability.HistoryReadModelReadOnlyProjectionRepository = (
    tenantId: string,
    limit: number,
    offset: number
  ): capability.HistoryReadModelReadOnlyProjectionRepositoryResult => ({
    total: 0,
    entries: [],
  });

  const invalidPaging = capability.validatePaging(0, 0);
  assert.ok(invalidPaging !== null);
  assert.strictEqual(invalidPaging!.kind, "INVALID_PAGING_PARAMETERS");

  const validPaging = capability.validatePaging(10, 0);
  assert.strictEqual(validPaging, null);

  const missingContext = capability.validateTenantContext(null);
  assert.ok(missingContext !== null);
  assert.strictEqual(missingContext!.kind, "TENANT_CONTEXT_MISSING");

  const validContext = capability.validateTenantContext(context);
  assert.strictEqual(validContext, null);

  const accessError = capability.validateTenantAccess(context, "other-tenant");
  assert.ok(accessError !== null);
  assert.strictEqual(accessError!.kind, "UNAUTHORIZED_TENANT_ACCESS");

  const adminContext: capability.HistoryReadModelReadOnlyProjectionTenantContext = {
    tenantId: "admin",
    isAdmin: true,
  };
  const adminAccess = capability.validateTenantAccess(adminContext, "any-tenant");
  assert.strictEqual(adminAccess, null);

  const invalidEntry = { id: "x" };
  const projectedInvalid = capability.projectHistoryEntry(invalidEntry);
  assert.strictEqual(projectedInvalid, null);

  const validEntry = {
    id: "7",
    source: "AUDIT" as const,
    type: "CREATE" as const,
    title: "Valid",
    occurrenceTime: "2023-07-07T00:00:00Z",
    actor: "user-7",
    status: "ok",
  };
  const projectedValid = capability.projectHistoryEntry(validEntry);
  assert.ok(projectedValid !== null);
});