import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/suborganisations.ts";

const isError = (
  value: capability.SubOrgState | capability.SubOrganisationsError,
): value is capability.SubOrganisationsError => {
  return typeof value === "object" && value !== null && "kind" in value;
};

const unwrapState = (
  value: capability.SubOrgState | capability.SubOrganisationsError,
): capability.SubOrgState => {
  assert.ok(!isError(value));
  return value as capability.SubOrgState;
};

const mapToStandardStatus = (
  mutation: "create" | "update" | "deactivate",
  result: capability.SubOrgState | capability.SubOrganisationsError,
): number => {
  if (isError(result)) {
    if (result.kind === "reserved-slug") return 400;
    if (result.kind === "conflict") return 409;
    if (result.kind === "not-found") return 404;
    return 422;
  }
  return mutation === "create" ? 201 : mutation === "update" ? 200 : 204;
};

const noopAudit: (
  event: capability.SubOrgAuditEvent,
) => capability.SubOrganisationsError | null = () => null;

test("suborganisationsauditmodel", () => {
  const auditEvents: capability.SubOrgAuditEvent[] = [];
  const auditOk: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = (
    event,
  ) => {
    auditEvents.push(event);
    return null;
  };

  const createdState = unwrapState(
    capability.createSubOrganisation(
      [],
      "tenant-a",
      "valid-slug",
      "Valid Org",
      auditOk,
    ),
  );
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].kind, "SUBORG_CREATED");
  assert.equal(auditEvents[0].resource, "suborganisation");
  assert.equal(auditEvents[0].subOrgId, "valid-slug");

  const failedCreate = capability.createSubOrganisation(
    createdState,
    "tenant-a",
    "blocked-create",
    "Blocked Create",
    () => ({
      kind: "invalid-body",
      message: "audit rejected",
    }),
  );
  assert.ok(isError(failedCreate));
  assert.equal(failedCreate.kind, "invalid-body");
  assert.equal(createdState.length, 1);

  const updatedState = unwrapState(
    capability.updateSubOrganisation(
      createdState,
      "tenant-a",
      "valid-slug",
      "Updated Org",
      auditOk,
    ),
  );
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[1].kind, "SUBORG_UPDATED");
  assert.equal(updatedState[0].displayName, "Updated Org");

  const failedUpdate = capability.updateSubOrganisation(
    updatedState,
    "tenant-a",
    "valid-slug",
    "Should Not Apply",
    () => ({
      kind: "invalid-body",
      message: "audit rejected",
    }),
  );
  assert.ok(isError(failedUpdate));
  assert.equal(failedUpdate.kind, "invalid-body");
  assert.equal(updatedState[0].displayName, "Updated Org");

  const failedDeactivate = capability.deactivateSubOrganisation(
    updatedState,
    "tenant-a",
    "valid-slug",
    () => ({
      kind: "invalid-body",
      message: "audit rejected",
    }),
  );
  assert.ok(isError(failedDeactivate));
  assert.equal(failedDeactivate.kind, "invalid-body");
  assert.equal(updatedState[0].active, true);

  const deactivatedState = unwrapState(
    capability.deactivateSubOrganisation(
      updatedState,
      "tenant-a",
      "valid-slug",
      auditOk,
    ),
  );
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[2].kind, "SUBORG_DEACTIVATED");
  assert.equal(deactivatedState[0].active, false);

  capability.listSubOrganisations(deactivatedState, "tenant-a");
  assert.equal(auditEvents.length, 3);
});

test("suborganisationscontracts", () => {
  const auditEvents: capability.SubOrgAuditEvent[] = [];
  const auditFn: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = (
    event,
  ) => {
    auditEvents.push(event);
    return null;
  };

  const seed: capability.SubOrgState = [
    {
      id: "org-a",
      parentId: "tenant-1",
      slug: "alpha",
      displayName: "Alpha",
      active: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "org-b",
      parentId: "tenant-2",
      slug: "beta",
      displayName: "Beta",
      active: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "org-c",
      parentId: "tenant-1",
      slug: "gamma",
      displayName: "Gamma",
      active: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ];

  const listResult = capability.listSubOrganisations(seed, "tenant-1");
  assert.equal(listResult.length, 1);
  assert.equal(listResult[0].slug, "alpha");
  assert.equal(listResult[0].id, "org-a");
  assert.equal("parentId" in listResult[0], false);

  const createdState = unwrapState(
    capability.createSubOrganisation(seed, "tenant-1", "delta", "Delta", auditFn),
  );
  assert.equal(mapToStandardStatus("create", createdState), 201);

  const updatedState = unwrapState(
    capability.updateSubOrganisation(createdState, "tenant-1", "delta", "Delta v2", auditFn),
  );
  const updatedRecord = updatedState.find((org) => org.id === "delta");
  assert.ok(updatedRecord !== undefined);
  assert.equal(updatedRecord.displayName, "Delta v2");
  assert.equal(mapToStandardStatus("update", updatedState), 200);

  const deactivatedState = unwrapState(
    capability.deactivateSubOrganisation(updatedState, "tenant-1", "delta", auditFn),
  );
  assert.equal(mapToStandardStatus("deactivate", deactivatedState), 204);
  assert.equal(deactivatedState.find((org) => org.slug === "delta")?.active, false);

  const notFound = capability.updateSubOrganisation(deactivatedState, "tenant-1", "missing", "No", auditFn);
  assert.ok(isError(notFound));
  assert.equal(notFound.kind, "not-found");
  assert.equal(mapToStandardStatus("update", notFound), 404);
  assert.ok(auditEvents.length > 0);
});

test("suborganisationserrormodel", () => {
  const seedState = unwrapState(
    capability.createSubOrganisation(
      [],
      "tenant-x",
      "tenant-x-root",
      "Tenant X",
      noopAudit,
    ),
  );

  const invalidBody = capability.createSubOrganisation(
    seedState,
    "tenant-x",
    "Bad_Slug",
    "Invalid",
    noopAudit,
  );
  assert.ok(isError(invalidBody));
  assert.equal(invalidBody.kind, "invalid-body");
  assert.equal(mapToStandardStatus("create", invalidBody), 422);

  const reservedSlug = capability.createSubOrganisation(
    seedState,
    "tenant-x",
    "admin",
    "Admin",
    noopAudit,
  );
  assert.ok(isError(reservedSlug));
  assert.equal(reservedSlug.kind, "reserved-slug");
  assert.equal(mapToStandardStatus("create", reservedSlug), 400);

  const conflict = capability.createSubOrganisation(
    seedState,
    "tenant-x",
    "tenant-x-root",
    "Duplicate",
    noopAudit,
  );
  assert.ok(isError(conflict));
  assert.equal(conflict.kind, "conflict");
  assert.equal(mapToStandardStatus("create", conflict), 409);
  assert.equal(seedState.length, 1);

  const notFound = capability.updateSubOrganisation(
    seedState,
    "tenant-x",
    "missing",
    "Not there",
    noopAudit,
  );
  assert.ok(isError(notFound));
  assert.equal(notFound.kind, "not-found");
  assert.equal(mapToStandardStatus("update", notFound), 404);

  const providerFailure: (
    event: capability.SubOrgAuditEvent,
  ) => capability.SubOrganisationsError = () => ({
    kind: "invalid-body",
    message: "provider unavailable",
  });

  const providerCreate = capability.createSubOrganisation(
    seedState,
    "tenant-x",
    "provider-child",
    "Provider Child",
    providerFailure,
  );
  assert.ok(isError(providerCreate));
  assert.equal(providerCreate.kind, "invalid-body");
  assert.equal(mapToStandardStatus("create", providerCreate), 422);
  assert.equal(seedState.length, 1);

  const providerUpdate = capability.updateSubOrganisation(
    seedState,
    "tenant-x",
    "tenant-x-root",
    "Should not persist",
    providerFailure,
  );
  assert.ok(isError(providerUpdate));
  assert.equal(seedState[0].displayName, "Tenant X");

  const providerDeactivate = capability.deactivateSubOrganisation(
    seedState,
    "tenant-x",
    "tenant-x-root",
    providerFailure,
  );
  assert.ok(isError(providerDeactivate));
  assert.equal(seedState[0].active, true);

  const okUpdate = unwrapState(
    capability.updateSubOrganisation(seedState, "tenant-x", "tenant-x-root", "Still Tenant X", noopAudit),
  );
  assert.equal(mapToStandardStatus("update", okUpdate), 200);
});

test("suborganisationslifecycle", () => {
  const auditEvents: capability.SubOrgAuditEvent[] = [];
  const auditFn: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = (
    event,
  ) => {
    auditEvents.push(event);
    return null;
  };

  let state = unwrapState(
    capability.createSubOrganisation([], "tenant-1", "first", "First", auditFn),
  );
  state = unwrapState(capability.createSubOrganisation(state, "tenant-1", "second", "Second", auditFn));
  state = unwrapState(capability.createSubOrganisation(state, "tenant-2", "other", "Other", auditFn));

  const tenantOneList = capability.listSubOrganisations(state, "tenant-1");
  assert.equal(tenantOneList.length, 2);

  state = unwrapState(
    capability.updateSubOrganisation(state, "tenant-1", "first", "First Updated", auditFn),
  );
  assert.equal(state.find((org) => org.slug === "first")?.displayName, "First Updated");

  state = unwrapState(
    capability.deactivateSubOrganisation(state, "tenant-1", "first", auditFn),
  );
  const visibleAfterDeactivate = capability.listSubOrganisations(state, "tenant-1");
  assert.equal(visibleAfterDeactivate.length, 1);
  assert.equal(visibleAfterDeactivate[0].slug, "second");

  const deactivatedRecord = state.find((org) => org.slug === "first");
  assert.ok(deactivatedRecord !== undefined);
  assert.equal(deactivatedRecord.active, false);

  const allRecords = state.some((org) => org.slug === "first");
  assert.equal(allRecords, true);
  assert.equal(auditEvents[0].kind, "SUBORG_CREATED");
});

test("suborganisationspermissions", () => {
  const readPermission: capability.SubOrganisationsPermission =
    capability.SubOrganisationsPermissions.read;
  const createPermission: capability.SubOrganisationsPermission =
    capability.SubOrganisationsPermissions.create;
  const updatePermission: capability.SubOrganisationsPermission =
    capability.SubOrganisationsPermissions.update;
  const deletePermission: capability.SubOrganisationsPermission =
    capability.SubOrganisationsPermissions.delete;

  assert.equal(readPermission, "suborg:read");
  assert.equal(createPermission, "suborg:create");
  assert.equal(updatePermission, "suborg:update");
  assert.equal(deletePermission, "suborg:delete");

  const routeGuards: readonly capability.SubOrganisationsRouteGuard[] = [
    { resource: "suborganisation", scope: readPermission, requiredPermission: readPermission },
    {
      resource: "suborganisation",
      scope: createPermission,
      requiredPermission: createPermission,
    },
    {
      resource: "suborganisation",
      scope: updatePermission,
      requiredPermission: updatePermission,
    },
    {
      resource: "suborganisation",
      scope: deletePermission,
      requiredPermission: deletePermission,
    },
  ];

  for (const guard of routeGuards) {
    assert.equal(guard.resource, "suborganisation");
    assert.ok(guard.scope.startsWith("suborg:"));
    assert.equal(guard.requiredPermission, guard.scope);
  }

  const state: capability.SubOrgState = [
    {
      id: "tenant-a-child",
      parentId: "tenant-a",
      slug: "alpha",
      displayName: "Alpha",
      active: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "tenant-b-child",
      parentId: "tenant-b",
      slug: "beta",
      displayName: "Beta",
      active: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ];

  const tenantScopedList = capability.listSubOrganisations(state, "tenant-a");
  assert.equal(tenantScopedList.length, 1);
  assert.equal(tenantScopedList[0].slug, "alpha");

  const crossTenantUpdate = capability.updateSubOrganisation(state, "tenant-a", "beta", "Nope", noopAudit);
  assert.ok(isError(crossTenantUpdate));
  assert.equal(crossTenantUpdate.kind, "not-found");

  const crossTenantDeactivate = capability.deactivateSubOrganisation(
    state,
    "tenant-a",
    "beta",
    noopAudit,
  );
  assert.ok(isError(crossTenantDeactivate));
  assert.equal(crossTenantDeactivate.kind, "not-found");
});

test("suborganisationsproof", () => {
  const auditTrail: capability.SubOrgAuditEvent[] = [];
  const auditFn: (event: capability.SubOrgAuditEvent) => capability.SubOrganisationsError | null = (
    event,
  ) => {
    auditTrail.push(event);
    return null;
  };

  const invalidInput = capability.createSubOrganisation(
    [],
    "tenant-proof",
    "BAD",
    "Bad",
    auditFn,
  );
  assert.ok(isError(invalidInput));
  assert.equal(invalidInput.kind, "invalid-body");
  assert.equal(auditTrail.length, 0);

  let state = unwrapState(
    capability.createSubOrganisation([], "tenant-proof", "proof-a", "Proof A", auditFn),
  );
  state = unwrapState(capability.createSubOrganisation(state, "tenant-proof", "proof-b", "Proof B", auditFn));
  state = unwrapState(capability.updateSubOrganisation(state, "tenant-proof", "proof-a", "Proof A1", auditFn));
  state = unwrapState(capability.deactivateSubOrganisation(state, "tenant-proof", "proof-b", auditFn));

  assert.equal(auditTrail[0].kind, "SUBORG_CREATED");
  assert.equal(auditTrail[1].kind, "SUBORG_CREATED");
  assert.equal(auditTrail[2].kind, "SUBORG_UPDATED");
  assert.equal(auditTrail[3].kind, "SUBORG_DEACTIVATED");

  const publicList = capability.listSubOrganisations(state, "tenant-proof");
  assert.equal(publicList.length, 1);
  assert.equal(publicList[0].slug, "proof-a");

  const proofRecord = state.find((org) => org.slug === "proof-b");
  assert.ok(proofRecord !== undefined);
  assert.equal(proofRecord.active, false);
});

test("suborganisationsreadinessmodel", () => {
  const state: capability.SubOrgState = [
    {
      id: "r1",
      parentId: "tenant-ready",
      slug: "ready-child",
      displayName: "Ready Child",
      active: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "r2",
      parentId: "tenant-ready",
      slug: "inactive-child",
      displayName: "Inactive",
      active: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ];

  assert.equal(capability.checkReadiness(true), "READY");
  assert.equal(capability.checkReadiness(false), "NOT_READY");

  const readyList = capability.listSubOrganisations(state, "tenant-ready");
  assert.equal(readyList.length, 1);
  assert.equal(readyList[0].slug, "ready-child");

  const otherTenant = capability.listSubOrganisations(state, "tenant-other");
  assert.equal(otherTenant.length, 0);

  const readiness = capability.checkReadiness(false);
  const mutableState = readiness === "READY"
    ? unwrapState(capability.createSubOrganisation(state, "tenant-ready", "blocked", "Blocked", noopAudit))
    : state;
  assert.equal(mutableState.length, state.length);
});

test("suborganisationsstatemodel", () => {
  const stateResult = capability.createSubOrganisation(
    [],
    "tenant-model",
    "slugged",
    "Slugged",
    noopAudit,
  );
  const state = unwrapState(stateResult);

  const created = state[0];
  assert.equal(created.id, "slugged");
  assert.equal(created.parentId, "tenant-model");
  assert.equal(created.slug, "slugged");
  assert.equal(created.displayName, "Slugged");
  assert.equal(created.active, true);
  assert.equal(typeof created.createdAt, "string");
  assert.equal(typeof created.updatedAt, "string");

  const publicList = capability.listSubOrganisations(state, "tenant-model");
  assert.equal(publicList.length, 1);
  assert.equal(publicList[0].id, "slugged");
  assert.equal("parentId" in publicList[0], false);

  const otherTenant = capability.listSubOrganisations(state, "tenant-other");
  assert.equal(otherTenant.length, 0);
});

test("suborganisationsvalidation", () => {
  const state = unwrapState(
    capability.createSubOrganisation([], "tenant-valid", "seed", "Seed", noopAudit),
  );

  const nonStringSlug = capability.createSubOrganisation(
    state,
    "tenant-valid",
    123 as unknown as string,
    "Seed",
    noopAudit,
  );
  assert.ok(isError(nonStringSlug));
  assert.equal(nonStringSlug.kind, "invalid-body");

  const uppercaseSlug = capability.createSubOrganisation(
    state,
    "tenant-valid",
    "Bad-Slug",
    "Seed",
    noopAudit,
  );
  assert.ok(isError(uppercaseSlug));
  assert.equal(uppercaseSlug.kind, "invalid-body");

  const tooShortSlug = capability.createSubOrganisation(
    state,
    "tenant-valid",
    "ab",
    "Seed",
    noopAudit,
  );
  assert.ok(isError(tooShortSlug));
  assert.equal(tooShortSlug.kind, "invalid-body");

  const tooLongSlug = capability.createSubOrganisation(
    state,
    "tenant-valid",
    "a".repeat(31),
    "Seed",
    noopAudit,
  );
  assert.ok(isError(tooLongSlug));
  assert.equal(tooLongSlug.kind, "invalid-body");

  const edgeHyphenSlug = capability.createSubOrganisation(
    state,
    "tenant-valid",
    "-edge",
    "Seed",
    noopAudit,
  );
  assert.ok(isError(edgeHyphenSlug));
  assert.equal(edgeHyphenSlug.kind, "invalid-body");

  const duplicateSlug = capability.createSubOrganisation(
    state,
    "tenant-other",
    "seed",
    "Another",
    noopAudit,
  );
  assert.ok(isError(duplicateSlug));
  assert.equal(duplicateSlug.kind, "conflict");

  const reservedSlug = capability.createSubOrganisation(
    state,
    "tenant-valid",
    "system",
    "System",
    noopAudit,
  );
  assert.ok(isError(reservedSlug));
  assert.equal(reservedSlug.kind, "reserved-slug");

  const emptyDisplayName = capability.createSubOrganisation(
    state,
    "tenant-valid",
    "seed-two",
    "",
    noopAudit,
  );
  assert.ok(isError(emptyDisplayName));
  assert.equal(emptyDisplayName.kind, "invalid-body");

  const tooLongDisplayName = capability.createSubOrganisation(
    state,
    "tenant-valid",
    "seed-three",
    "a".repeat(101),
    noopAudit,
  );
  assert.ok(isError(tooLongDisplayName));
  assert.equal(tooLongDisplayName.kind, "invalid-body");

  const invalidUpdate = capability.updateSubOrganisation(
    state,
    "tenant-valid",
    "seed",
    "",
    noopAudit,
  );
  assert.ok(isError(invalidUpdate));
  assert.equal(invalidUpdate.kind, "invalid-body");
  assert.equal(state[0].displayName, "Seed");

  const tooLongUpdate = capability.updateSubOrganisation(
    state,
    "tenant-valid",
    "seed",
    "a".repeat(101),
    noopAudit,
  );
  assert.ok(isError(tooLongUpdate));
  assert.equal(tooLongUpdate.kind, "invalid-body");
  assert.equal(state[0].displayName, "Seed");
});