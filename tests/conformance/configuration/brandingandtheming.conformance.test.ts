import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/configuration/brandingandtheming.ts";

type State = capability.BrandingAndThemingState;
type BrandingDef = capability.BrandingAndThemingBrandingDefinition;
type TenantOverride = capability.BrandingAndThemingTenantThemeOverride;
type AuditEvent = capability.BrandingAndThemingAuditEvent;
type AuditFn = capability.BrandingAndThemingAuditFn;
type BrandingAndThemingError = capability.BrandingAndThemingError;

const writeToken = (tenantId: string): Readonly<Record<string, unknown>> => ({
  tenantId,
  permissions: ["configuration:write", "configuration:read"] as const,
});

const readToken = (tenantId: string): Readonly<Record<string, unknown>> => ({
  tenantId,
  permissions: ["configuration:read"] as const,
});

function withOverrides(
  base: State,
  overrides: ReadonlyMap<string, TenantOverride>,
): State {
  return {
    ...base,
    bootstrapTheme: {
      ...base.bootstrapTheme,
      tenantThemeOverrides: overrides,
    },
  };
}

function withDefinitions(
  base: State,
  definitions: ReadonlyMap<string, BrandingDef>,
): State {
  return {
    ...base,
    brandingRegistry: {
      ...base.brandingRegistry,
      brandingDefinitions: definitions,
    },
  };
}

test("brandingandthemingstatemodel", () => {
  const state = withDefinitions(
    withOverrides(capability.initialState, new Map<string, TenantOverride>([
      ["tenant-state", { primaryColor: "#123456" }],
    ])),
    new Map<string, BrandingDef>([
      ["tenant-state", { applicationName: "Recorded", themeSelection: "dark" }],
    ]),
  );

  const description = capability.describeStateModel(state);
  assert.equal(description.bootstrapThemeStateDistinct, true);
  assert.equal(description.editableBrandingRegistryState, true);
  assert.ok(description.stateKinds.includes("BOOTSTRAP_THEME"));
  assert.ok(description.stateKinds.includes("BRANDING_REGISTRY"));
  assert.equal(description.applicationNameType, "string");
  assert.deepEqual(
    [...description.themeSelectionSet],
    [...capability.BrandingAndThemingThemeSelection],
  );

  const full = capability.describeStateModelFull(state);
  assert.equal(full.hasDefaultTheme, true);
  assert.equal(full.hasTenantThemeOverrides, true);
  assert.equal(full.hasBrandingDefinitions, true);
  assert.equal(full.applicationNameTypeValid, true);
  assert.equal(full.themeSelectionSetMatches, true);
  assert.equal(full.bootstrapThemeKindValid, true);
  assert.equal(full.brandingRegistryKindValid, true);
  assert.equal(full.stateKindsDistinct, true);
});

test("brandingandthemingauditmodel", () => {
  const calls: AuditEvent[] = [];
  const audit: AuditFn = (event) => {
    calls.push(event);
    return null;
  };

  const stateWithDef = withDefinitions(
    capability.initialState,
    new Map<string, BrandingDef>([
      ["tenant-audit", { applicationName: "Original", themeSelection: "light" }],
    ]),
  );

  const patched = capability.patchBrandingDefinition(
    "tenant-audit",
    { applicationName: "Renamed", themeSelection: "dark" },
    writeToken("tenant-audit"),
    stateWithDef,
    audit,
  );
  assert.equal(patched.kind, "SUCCESS");

  const patchedState =
    patched.kind === "SUCCESS" ? patched.newState : stateWithDef;

  const deleted = capability.deleteBrandingDefinition(
    "tenant-audit",
    writeToken("tenant-audit"),
    patchedState,
    audit,
  );
  assert.equal(deleted.kind, "SUCCESS");

  assert.equal(calls.length, 2);
  const patchCall = calls[0];
  const deleteCall = calls[1];
  if (patchCall && deleteCall) {
    assert.equal(patchCall.action, "value-changed");
    assert.equal(patchCall.tenantId, "tenant-audit");
    assert.equal(deleteCall.action, "value-cleared");
    assert.equal(deleteCall.tenantId, "tenant-audit");
  }

  const auditOutcome = capability.runAudit(null, {
    action: "value-changed",
    tenantId: "tenant-audit",
    key: "brandingDefinition",
    previousValue: null,
    newValue: null,
  });
  assert.equal(auditOutcome, null);

  const bootstrapRead = capability.readBootstrapTheme(
    "tenant-audit.example",
    stateWithDef,
  );
  assert.ok(bootstrapRead.kind === "SUCCESS" || bootstrapRead.kind === "FALLBACK");
});

test("brandingandthemingcontracts", () => {
  const adapter = capability.createConfigurationStoreAdapter();

  const themeResult = adapter.getEffectiveTheme("tenant-contract.example");
  assert.ok(themeResult.kind === "SUCCESS" || themeResult.kind === "FALLBACK");

  const createResult = adapter.createBrandingDefinition(
    "tenant-contract",
    { applicationName: "ContractApp", themeSelection: "system" },
    writeToken("tenant-contract"),
  );
  assert.equal(createResult.kind, "SUCCESS");
  const stateAfterCreate =
    createResult.kind === "SUCCESS"
      ? createResult.newState
      : capability.initialState;

  const listResult = adapter.listBrandingDefinitions(
    "tenant-contract",
    writeToken("tenant-contract"),
    stateAfterCreate,
  );
  assert.equal(listResult.kind, "SUCCESS");

  const patchResult = adapter.patchBrandingDefinition(
    "tenant-contract",
    { themeSelection: "dark" },
    writeToken("tenant-contract"),
    stateAfterCreate,
  );
  assert.equal(patchResult.kind, "SUCCESS");
  const stateAfterPatch =
    patchResult.kind === "SUCCESS" ? patchResult.newState : stateAfterCreate;

  const deleteResult = adapter.deleteBrandingDefinition(
    "tenant-contract",
    writeToken("tenant-contract"),
    stateAfterPatch,
  );
  assert.equal(deleteResult.kind, "SUCCESS");

  const check = capability.checkContracts(adapter);
  assert.equal(check.ok, true);
  assert.equal(check.sharedStoreContract, "ConfigurationStorePort");
  assert.ok(check.bootstrapPath.includes("getEffectiveTheme"));
  assert.ok(check.managementPath.includes("listBrandingDefinitions"));
  assert.ok(check.managementPath.includes("patchBrandingDefinition"));
  assert.ok(check.managementPath.includes("deleteBrandingDefinition"));
  assert.equal(check.auditBeforePersistence, true);
  assert.equal(check.bootstrapUnauthenticated, true);

  const ensured = capability.ensureContracts(adapter);
  assert.equal(ensured.ok, true);
  assert.ok(ensured.trace.calls.length > 0);
  assert.ok(
    ensured.exposed.includes("getEffectiveTheme") &&
      ensured.exposed.includes("listBrandingDefinitions") &&
      ensured.exposed.includes("patchBrandingDefinition") &&
      ensured.exposed.includes("deleteBrandingDefinition") &&
      ensured.exposed.includes("createBrandingDefinition"),
  );
});

test("brandingandthemingerrormodel", () => {
  const summary = capability.describeErrorModel(capability.initialState);
  assert.equal(summary.path, "BOOTSTRAP");
  assert.equal(summary.mode, "FAIL_OPEN");
  assert.equal(summary.bootstrapFailsOpen, true);
  assert.equal(summary.managementFailsClosed, true);
  assert.equal(summary.nonBlocking, true);
  assert.ok((summary.defaultKinds as readonly string[]).includes("THEME_READ_FAILURE"));
  assert.ok((summary.defaultKinds as readonly string[]).includes("TENANT_RESOLUTION_FAILURE"));
  assert.ok((summary.defaultKinds as readonly string[]).includes("PERSISTENCE_UNAVAILABLE"));
  assert.ok((summary.configurationKinds as readonly string[]).includes("VALIDATION_ERROR"));
  assert.ok((summary.configurationKinds as readonly string[]).includes("FORBIDDEN"));
  assert.ok((summary.configurationKinds as readonly string[]).includes("UNKNOWN_KEY"));
  assert.ok((summary.configurationKinds as readonly string[]).includes("NON_OVERRIDABLE"));

  const invalidTheme = capability.patchBrandingDefinition(
    "tenant-error",
    { themeSelection: "neon" },
    writeToken("tenant-error"),
    capability.initialState,
  );
  assert.equal(invalidTheme.kind, "ERROR");
  if (invalidTheme.kind === "ERROR") {
    assert.equal(invalidTheme.error.kind, "VALIDATION_ERROR");
    assert.equal(invalidTheme.error.path, "MANAGEMENT");
    assert.equal(invalidTheme.error.mode, "FAIL_CLOSED");
  }

  const deniedRead = capability.listBrandingDefinitions(
    "tenant-error",
    null,
  );
  assert.equal(deniedRead.kind, "ERROR");
  if (deniedRead.kind === "ERROR") {
    assert.equal(deniedRead.error.kind, "FORBIDDEN");
    assert.equal(deniedRead.error.mode, "FAIL_CLOSED");
  }

  const nonOverridableState: State = {
    ...capability.initialState,
    nonOverridableTenants: ["tenant-error"],
    brandingRegistry: {
      ...capability.initialState.brandingRegistry,
      brandingDefinitions: new Map<string, BrandingDef>([
        ["tenant-error", { applicationName: "Locked", themeSelection: "light" }],
      ]),
    },
  };
  const nonOverridable = capability.patchBrandingDefinition(
    "tenant-error",
    { applicationName: "Try" },
    writeToken("tenant-error"),
    nonOverridableState,
  );
  assert.equal(nonOverridable.kind, "ERROR");
  if (nonOverridable.kind === "ERROR") {
    assert.equal(nonOverridable.error.kind, "NON_OVERRIDABLE");
    assert.equal(nonOverridable.error.mode, "FAIL_CLOSED");
  }

  const bootstrapOpen = capability.buildThemeReadError("read failed");
  assert.equal(bootstrapOpen.path, "BOOTSTRAP");
  assert.equal(bootstrapOpen.mode, "FAIL_OPEN");

  const bootstrapFallback = capability.getEffectiveTheme("");
  assert.equal(bootstrapFallback.kind, "FALLBACK");
  assert.equal(bootstrapFallback.fallback, true);
  assert.equal(bootstrapFallback.isDefault, true);

  const mappedForbidden: BrandingAndThemingError = {
    kind: "FORBIDDEN",
    message: "nope",
    path: "MANAGEMENT",
    mode: "FAIL_CLOSED",
  };
  assert.equal(capability.mapErrorToStatusCode(mappedForbidden), 403);

  assert.equal(capability.isBootstrapErrorKind("THEME_READ_FAILURE"), true);
  assert.equal(capability.isBootstrapErrorKind("VALIDATION_ERROR"), false);
  assert.equal(capability.isManagementErrorKind("VALIDATION_ERROR"), true);
  assert.equal(capability.isManagementErrorKind("THEME_READ_FAILURE"), false);
});

test("brandingandtheminglifecycle", () => {
  const tenantOverrides = new Map<string, TenantOverride>([
    ["tenant-lifecycle", { primaryColor: "#abcdef", textColor: "#111111" }],
  ]);
  const baseState = withOverrides(capability.initialState, tenantOverrides);

  const bootstrapRead = capability.readBootstrapTheme(
    "tenant-lifecycle.example",
    baseState,
  );
  assert.equal(bootstrapRead.kind, "SUCCESS");
  if (bootstrapRead.kind === "SUCCESS") {
    assert.equal(bootstrapRead.theme.primaryColor, "#abcdef");
    assert.equal(bootstrapRead.theme.textColor, "#111111");
    assert.equal(bootstrapRead.isDefault, false);
  }

  const fallbackBootstrap = capability.bootstrapThemeRead(
    "unmapped.example",
    baseState,
  );
  assert.equal(fallbackBootstrap.kind, "FALLBACK");

  const created = capability.createBrandingDefinition(
    "tenant-lifecycle",
    { applicationName: "LifecycleApp", themeSelection: "dark" },
    writeToken("tenant-lifecycle"),
    baseState,
  );
  assert.equal(created.kind, "SUCCESS");

  const createdState =
    created.kind === "SUCCESS" ? created.newState : baseState;

  const patched = capability.patchBrandingDefinition(
    "tenant-lifecycle",
    { applicationName: "LifecycleAppRenamed" },
    writeToken("tenant-lifecycle"),
    createdState,
  );
  assert.equal(patched.kind, "SUCCESS");

  const lifecycleCheck = capability.checkContracts(
    capability.createConfigurationStoreAdapter(baseState),
  );
  assert.equal(lifecycleCheck.ok, true);
  assert.ok(lifecycleCheck.bootstrapPath.includes("readBootstrapTheme"));

  const ensuredLifecycle = capability.ensureContracts(
    capability.createConfigurationStoreAdapter(baseState),
  );
  assert.equal(ensuredLifecycle.ok, true);
  assert.ok(ensuredLifecycle.exposed.includes("readBootstrapTheme"));
});

test("brandingandthemingpermissions", () => {
  const stateWithDef = withDefinitions(
    capability.initialState,
    new Map<string, BrandingDef>([
      ["tenant-a", { applicationName: "A", themeSelection: "light" }],
    ]),
  );

  const deniedNoToken = capability.listBrandingDefinitions("tenant-a", null);
  assert.equal(deniedNoToken.kind, "ERROR");
  if (deniedNoToken.kind === "ERROR") {
    assert.equal(deniedNoToken.error.kind, "FORBIDDEN");
  }

  const deniedCrossTenant = capability.listBrandingDefinitions(
    "tenant-a",
    writeToken("tenant-b"),
    stateWithDef,
  );
  assert.equal(deniedCrossTenant.kind, "ERROR");
  if (deniedCrossTenant.kind === "ERROR") {
    assert.equal(deniedCrossTenant.error.kind, "FORBIDDEN");
  }

  const readOnlyDeniedWrite = capability.patchBrandingDefinition(
    "tenant-a",
    { applicationName: "Attempted" },
    readToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(readOnlyDeniedWrite.kind, "ERROR");
  if (readOnlyDeniedWrite.kind === "ERROR") {
    assert.equal(readOnlyDeniedWrite.error.kind, "FORBIDDEN");
  }

  const grantedRead = capability.listBrandingDefinitions(
    "tenant-a",
    readToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(grantedRead.kind, "SUCCESS");

  const grantedWrite = capability.patchBrandingDefinition(
    "tenant-a",
    { applicationName: "Granted" },
    writeToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(grantedWrite.kind, "SUCCESS");

  const permCheck = capability.checkBrandingPermission(
    "tenant-a",
    writeToken("tenant-a"),
    "write",
  );
  assert.equal(permCheck.kind, "GRANTED");

  const deniedCheck = capability.checkPermission("tenant-a", null, "write");
  assert.equal(deniedCheck.kind, "DENIED");

  const bootstrapUnauthenticated = capability.readBootstrapTheme(
    "anyone.example",
    stateWithDef,
  );
  assert.ok(
    bootstrapUnauthenticated.kind === "SUCCESS" ||
      bootstrapUnauthenticated.kind === "FALLBACK",
  );
});

test("brandingandthemingproof", () => {
  const proof = capability.BrandingAndThemingProof;
  assert.ok((proof as readonly string[]).includes("hermetic"));
  assert.ok((proof as readonly string[]).includes("runtime"));
  assert.ok((proof as readonly string[]).includes("pending"));

  const lineage = capability.BrandingAndThemingProofLineage;
  assert.ok((lineage as readonly string[]).includes("hermetic"));
  assert.ok((lineage as readonly string[]).includes("runtime"));

  const status = capability.BrandingAndThemingProofStatus;
  assert.ok((status as readonly string[]).includes("pending"));
  assert.ok((status as readonly string[]).includes("fresh-pending"));
  assert.ok((status as readonly string[]).includes("verified"));

  const contract = capability.checkContracts(
    capability.createConfigurationStoreAdapter(),
  );
  assert.equal(contract.ok, true);
  assert.equal(contract.invariantReady, true);
  assert.equal(contract.auditBeforePersistence, true);

  const ensured = capability.ensureContracts(
    capability.createConfigurationStoreAdapter(),
  );
  assert.equal(ensured.ok, true);
  assert.equal(ensured.invariantReady, true);
  assert.equal(ensured.auditBeforePersistence, true);

  const fallback = capability.getEffectiveTheme("");
  assert.equal(fallback.kind, "FALLBACK");
  assert.equal(fallback.isDefault, true);
});

test("brandingandthemingreadinessmodel", () => {
  const readyReadiness = capability.getReadiness(capability.initialState);
  assert.equal(readyReadiness, "READY");

  const missingReadiness = capability.getReadiness();
  assert.equal(missingReadiness, "READY");

  const explicitMissing = capability.getReadiness(undefined);
  assert.equal(explicitMissing, "READY");

  const degraded: State = {
    ...capability.initialState,
    readiness: "DEGRADED",
  };
  assert.equal(capability.getReadiness(degraded), "DEGRADED");

  const notReady: State = {
    ...capability.initialState,
    readiness: "NOT_READY",
  };
  assert.equal(capability.getReadiness(notReady), "NOT_READY");

  const aliased = capability.checkReadiness(degraded);
  assert.equal(aliased, "DEGRADED");

  const fallbackOnEmpty = capability.getEffectiveTheme("", degraded);
  assert.equal(fallbackOnEmpty.kind, "FALLBACK");
  assert.equal(fallbackOnEmpty.fallback, true);
  assert.equal(fallbackOnEmpty.isDefault, true);

  const fallbackOnMissing = capability.getEffectiveTheme(
    "no-such-tenant.example",
    degraded,
  );
  assert.equal(fallbackOnMissing.kind, "FALLBACK");
  assert.equal(fallbackOnMissing.fallback, true);

  const contract = capability.checkContracts(
    capability.createConfigurationStoreAdapter(),
  );
  assert.equal(contract.invariantReady, true);
});

test("brandingandthemingvalidation", () => {
  const validDef = capability.validateBrandingDefinition({
    applicationName: "Valid",
    themeSelection: "system",
  });
  assert.equal(validDef.kind, "SUCCESS");
  if (validDef.kind === "SUCCESS") {
    assert.equal(validDef.definition.applicationName, "Valid");
    assert.equal(validDef.definition.themeSelection, "system");
  }

  const invalidTheme = capability.validateBrandingDefinition({
    applicationName: "Valid",
    themeSelection: "purple",
  });
  assert.equal(invalidTheme.kind, "VALIDATION_ERROR");
  if (invalidTheme.kind === "VALIDATION_ERROR") {
    assert.equal(invalidTheme.error.kind, "VALIDATION_ERROR");
  }

  const invalidName = capability.validateBrandingDefinition({
    applicationName: 42,
    themeSelection: "light",
  });
  assert.equal(invalidName.kind, "VALIDATION_ERROR");
  if (invalidName.kind === "VALIDATION_ERROR") {
    assert.equal(invalidName.error.kind, "VALIDATION_ERROR");
  }

  const notAnObject = capability.validateBrandingDefinition(null);
  assert.equal(notAnObject.kind, "VALIDATION_ERROR");
  if (notAnObject.kind === "VALIDATION_ERROR") {
    assert.equal(notAnObject.error.kind, "VALIDATION_ERROR");
  }

  assert.equal(capability.validateThemeSelection("dark"), true);
  assert.equal(capability.validateThemeSelection("light"), true);
  assert.equal(capability.validateThemeSelection("system"), true);
  assert.equal(capability.validateThemeSelection("neon"), false);
  assert.equal(capability.validateThemeSelection(123), false);

  assert.equal(capability.validateApplicationName("MyApp"), true);
  assert.equal(capability.validateApplicationName(123), false);
  assert.equal(capability.validateApplicationName(null), false);

  const tolerantMissing = capability.getEffectiveTheme("missing.example");
  assert.equal(tolerantMissing.kind, "FALLBACK");

  const stateWithDef = withDefinitions(
    capability.initialState,
    new Map<string, BrandingDef>([
      ["tenant-validation", { applicationName: "Before", themeSelection: "light" }],
    ]),
  );

  const mutationValidation = capability.patchBrandingDefinition(
    "tenant-validation",
    { themeSelection: "neon" },
    writeToken("tenant-validation"),
    stateWithDef,
  );
  assert.equal(mutationValidation.kind, "ERROR");
  if (mutationValidation.kind === "ERROR") {
    assert.equal(mutationValidation.error.kind, "VALIDATION_ERROR");
  }
});