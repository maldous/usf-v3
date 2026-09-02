import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/configuration/brandingandtheming.ts";

const writeToken = (tenantId: string): Readonly<Record<string, unknown>> => ({
  tenantId,
  permissions: ["configuration:write", "configuration:read"] as const,
});
const readToken = (tenantId: string): Readonly<Record<string, unknown>> => ({
  tenantId,
  permissions: ["configuration:read"] as const,
});

test("brandingandthemingauditmodel", () => {
  const auditEvents: capability.BrandingAndThemingAuditEvent[] = [];
  const auditFn: capability.BrandingAndThemingAuditFn = (event) => {
    auditEvents.push(event);
    return null;
  };

  const baseState: capability.BrandingAndThemingState = capability.initialState;

  const createResult = capability.createBrandingDefinition(
    "tenant-audit",
    { applicationName: "Original", themeSelection: "light" },
    writeToken("tenant-audit"),
    baseState,
    auditFn,
  );
  assert.equal(createResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "value-changed");
  assert.equal(auditEvents[0].tenantId, "tenant-audit");

  const patchResult = capability.patchBrandingDefinition(
    "tenant-audit",
    { applicationName: "Renamed", themeSelection: "dark" },
    writeToken("tenant-audit"),
    createResult.kind === "SUCCESS" ? createResult.newState : baseState,
    auditFn,
  );
  assert.equal(patchResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[1].action, "value-changed");

  const deleteResult = capability.deleteBrandingDefinition(
    "tenant-audit",
    writeToken("tenant-audit"),
    patchResult.kind === "SUCCESS" ? patchResult.newState : baseState,
    auditFn,
  );
  assert.equal(deleteResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[2].action, "value-cleared");

  const beforeRead = auditEvents.length;
  const readResult = capability.readBootstrapTheme("somehost.example", baseState);
  assert.ok(readResult.kind === "SUCCESS" || readResult.kind === "FALLBACK");
  assert.equal(auditEvents.length, beforeRead);
});

test("brandingandthemingcontracts", () => {
  const adapter = capability.brandingAndThemingConfigurationStoreAdapter;
  const check = capability.checkContracts(adapter);
  assert.ok(check.ok);
  assert.deepEqual(check.missing, []);
  assert.ok(check.exposed.includes("getEffectiveTheme"));
  assert.ok(check.exposed.includes("readBootstrapTheme"));
  assert.ok(check.exposed.includes("bootstrapThemeRead"));
  assert.ok(check.exposed.includes("readTheme"));
  assert.ok(check.exposed.includes("listBrandingDefinitions"));
  assert.ok(check.exposed.includes("patchBrandingDefinition"));
  assert.ok(check.exposed.includes("deleteBrandingDefinition"));
  assert.ok(check.exposed.includes("createBrandingDefinition"));
  assert.ok(check.exposed.includes("list"));
  assert.ok(check.exposed.includes("patch"));
  assert.ok(check.exposed.includes("delete"));
  assert.ok(check.surface.includes("bootstrap"));
  assert.ok(check.surface.includes("theme"));
  assert.ok(check.surface.includes("list"));
  assert.ok(check.surface.includes("patch"));
  assert.ok(check.surface.includes("delete"));
  assert.ok(check.surface.includes("create"));
  assert.equal(check.sharedStoreContract, "ConfigurationStorePort");
  assert.ok(check.bootstrapPath.includes("getEffectiveTheme"));
  assert.ok(check.managementPath.includes("listBrandingDefinitions"));
  assert.ok(check.managementPath.includes("patchBrandingDefinition"));
  assert.ok(check.managementPath.includes("deleteBrandingDefinition"));
  assert.ok(check.managementPath.includes("createBrandingDefinition"));
  assert.equal(check.auditBeforePersistence, true);
  assert.equal(check.bootstrapUnauthenticated, true);
});

test("brandingandthemingerrormodel", () => {
  const fallbackResult = capability.getEffectiveTheme("unknownhost.example");
  assert.equal(fallbackResult.kind, "FALLBACK");
  assert.equal(fallbackResult.fallback, true);
  assert.equal(fallbackResult.isDefault, true);

  const bootstrapError = capability.buildThemeReadError("read failed");
  assert.equal(bootstrapError.path, "BOOTSTRAP");
  assert.equal(bootstrapError.mode, "FAIL_OPEN");

  const seedAudit: capability.BrandingAndThemingAuditFn = () => null;
  const seedResult = capability.createBrandingDefinition(
    "tenant-val",
    { applicationName: "Seed", themeSelection: "light" },
    writeToken("tenant-val"),
    capability.initialState,
    seedAudit,
  );
  assert.equal(seedResult.kind, "SUCCESS");
  const seededState = seedResult.kind === "SUCCESS" ? seedResult.newState : capability.initialState;

  const validationErrorResult = capability.patchBrandingDefinition(
    "tenant-val",
    { themeSelection: "neon" },
    writeToken("tenant-val"),
    seededState,
  );
  assert.equal(validationErrorResult.kind, "ERROR");
  if (validationErrorResult.kind === "ERROR") {
    assert.equal(validationErrorResult.error.kind, "VALIDATION_ERROR");
    assert.equal(validationErrorResult.error.path, "MANAGEMENT");
    assert.equal(validationErrorResult.error.mode, "FAIL_CLOSED");
  }

  const forbiddenResult = capability.listBrandingDefinitions("tenant-forbid", null);
  assert.equal(forbiddenResult.kind, "ERROR");
  if (forbiddenResult.kind === "ERROR") {
    assert.equal(forbiddenResult.error.kind, "FORBIDDEN");
    assert.equal(forbiddenResult.error.mode, "FAIL_CLOSED");
  }

  const unknownResult = capability.patchBrandingDefinition(
    "tenant-unknown",
    { applicationName: "X" },
    writeToken("tenant-unknown"),
    capability.initialState,
  );
  assert.equal(unknownResult.kind, "ERROR");
  if (unknownResult.kind === "ERROR") {
    assert.equal(unknownResult.error.kind, "UNKNOWN_KEY");
    assert.equal(unknownResult.error.mode, "FAIL_CLOSED");
  }

  const nonOverridableState: capability.BrandingAndThemingState = {
    ...capability.initialState,
    nonOverridableTenants: ["tenant-nonoverridable"],
  };
  const nonOverridableResult = capability.patchBrandingDefinition(
    "tenant-nonoverridable",
    { applicationName: "Y" },
    writeToken("tenant-nonoverridable"),
    nonOverridableState,
  );
  assert.equal(nonOverridableResult.kind, "ERROR");
  if (nonOverridableResult.kind === "ERROR") {
    assert.equal(nonOverridableResult.error.kind, "NON_OVERRIDABLE");
    assert.equal(nonOverridableResult.error.mode, "FAIL_CLOSED");
  }

  const mapped = capability.mapErrorToStatusCode({ kind: "FORBIDDEN", message: "no", path: "MANAGEMENT", mode: "FAIL_CLOSED" });
  assert.equal(mapped, 403);

  assert.equal(capability.isBootstrapErrorKind("THEME_READ_FAILURE"), true);
  assert.equal(capability.isBootstrapErrorKind("VALIDATION_ERROR"), false);
  assert.equal(capability.isManagementErrorKind("VALIDATION_ERROR"), true);
  assert.equal(capability.isManagementErrorKind("THEME_READ_FAILURE"), false);

  const summary = capability.describeErrorModel(capability.initialState);
  assert.equal(summary.path, "BOOTSTRAP");
  assert.equal(summary.mode, "FAIL_OPEN");
  assert.equal(summary.bootstrapFailsOpen, true);
  assert.equal(summary.managementFailsClosed, true);
  assert.equal(summary.nonBlocking, true);
  assert.ok(summary.defaultKinds.includes("THEME_READ_FAILURE"));
  assert.ok(summary.defaultKinds.includes("TENANT_RESOLUTION_FAILURE"));
  assert.ok(summary.defaultKinds.includes("PERSISTENCE_UNAVAILABLE"));
  assert.ok(summary.configurationKinds.includes("VALIDATION_ERROR"));
  assert.ok(summary.configurationKinds.includes("FORBIDDEN"));
  assert.ok(summary.configurationKinds.includes("UNKNOWN_KEY"));
  assert.ok(summary.configurationKinds.includes("NON_OVERRIDABLE"));
});

test("brandingandtheminglifecycle", () => {
  const stateWithOverrides: capability.BrandingAndThemingState = {
    ...capability.initialState,
    bootstrapTheme: {
      ...capability.initialState.bootstrapTheme,
      tenantThemeOverrides: new Map([["tenant-lifecycle", { primaryColor: "#abcdef" }]]),
    },
  };

  const bootstrapRead = capability.readBootstrapTheme("tenant-lifecycle.example", stateWithOverrides);
  assert.equal(bootstrapRead.kind, "SUCCESS");
  if (bootstrapRead.kind === "SUCCESS") {
    assert.equal(bootstrapRead.theme.primaryColor, "#abcdef");
  }

  const fallbackRead = capability.readBootstrapTheme("unmapped.example", stateWithOverrides);
  assert.equal(fallbackRead.kind, "FALLBACK");

  const auditEvents: capability.BrandingAndThemingAuditEvent[] = [];
  const auditFn: capability.BrandingAndThemingAuditFn = (e) => { auditEvents.push(e); return null; };
  const createResult = capability.createBrandingDefinition(
    "tenant-lifecycle",
    { applicationName: "LifecycleApp", themeSelection: "dark" },
    writeToken("tenant-lifecycle"),
    stateWithOverrides,
    auditFn,
  );
  assert.equal(createResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "value-changed");

  const afterCreate = createResult.kind === "SUCCESS" ? createResult.newState : stateWithOverrides;

  const patchResult = capability.patchBrandingDefinition(
    "tenant-lifecycle",
    { applicationName: "LifecycleAppRenamed" },
    writeToken("tenant-lifecycle"),
    afterCreate,
    auditFn,
  );
  assert.equal(patchResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[1].action, "value-changed");

  const afterPatch = patchResult.kind === "SUCCESS" ? patchResult.newState : afterCreate;

  const deleteResult = capability.deleteBrandingDefinition(
    "tenant-lifecycle",
    writeToken("tenant-lifecycle"),
    afterPatch,
    auditFn,
  );
  assert.equal(deleteResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[2].action, "value-cleared");

  const adapter = capability.createConfigurationStoreAdapter(stateWithOverrides);
  const contract = capability.checkContracts(adapter);
  assert.ok(contract.ok);
  assert.ok(contract.bootstrapPath.includes("readBootstrapTheme"));
});

test("brandingandthemingpermissions", () => {
  const stateWithDef: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingRegistry: {
      ...capability.initialState.brandingRegistry,
      brandingDefinitions: new Map([["tenant-a", { applicationName: "A", themeSelection: "light" }]]),
    },
  };

  const bootstrapRead = capability.readBootstrapTheme("anyhost.example", capability.initialState);
  assert.ok(bootstrapRead.kind === "SUCCESS" || bootstrapRead.kind === "FALLBACK");

  const noTokenResult = capability.listBrandingDefinitions("tenant-a", null);
  assert.equal(noTokenResult.kind, "ERROR");
  if (noTokenResult.kind === "ERROR") {
    assert.equal(noTokenResult.error.kind, "FORBIDDEN");
  }

  const wrongTenantResult = capability.listBrandingDefinitions(
    "tenant-a",
    writeToken("tenant-b"),
    stateWithDef,
  );
  assert.equal(wrongTenantResult.kind, "ERROR");
  if (wrongTenantResult.kind === "ERROR") {
    assert.equal(wrongTenantResult.error.kind, "FORBIDDEN");
  }

  const readOnlyResult = capability.patchBrandingDefinition(
    "tenant-a",
    { applicationName: "Attempted" },
    readToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(readOnlyResult.kind, "ERROR");
  if (readOnlyResult.kind === "ERROR") {
    assert.equal(readOnlyResult.error.kind, "FORBIDDEN");
  }

  const readResult = capability.listBrandingDefinitions(
    "tenant-a",
    readToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(readResult.kind, "SUCCESS");

  const writeResult = capability.patchBrandingDefinition(
    "tenant-a",
    { applicationName: "Granted" },
    writeToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(writeResult.kind, "SUCCESS");

  const permCheck = capability.checkBrandingPermission("tenant-a", writeToken("tenant-a"), "write");
  assert.equal(permCheck.kind, "GRANTED");

  const deniedCheck = capability.checkPermission("tenant-a", null, "write");
  assert.equal(deniedCheck.kind, "DENIED");
});

test("brandingandthemingproof", () => {
  assert.ok((capability.BrandingAndThemingProof as readonly string[]).includes("hermetic"));
  assert.ok((capability.BrandingAndThemingProof as readonly string[]).includes("runtime"));
  assert.ok((capability.BrandingAndThemingProof as readonly string[]).includes("pending"));

  assert.ok((capability.BrandingAndThemingProofLineage as readonly string[]).includes("hermetic"));
  assert.ok((capability.BrandingAndThemingProofLineage as readonly string[]).includes("runtime"));

  assert.ok((capability.BrandingAndThemingProofStatus as readonly string[]).includes("pending"));
  assert.ok((capability.BrandingAndThemingProofStatus as readonly string[]).includes("fresh-pending"));
  assert.ok((capability.BrandingAndThemingProofStatus as readonly string[]).includes("verified"));

  const adapter = capability.brandingAndThemingConfigurationStoreAdapter;
  const contract = capability.checkContracts(adapter);
  assert.ok(contract.ok);
  assert.equal(contract.invariantReady, true);
  assert.equal(contract.auditBeforePersistence, true);
  assert.ok(contract.bootstrapPath.includes("getEffectiveTheme"));

  const ensured = capability.ensureContracts(adapter);
  assert.ok(ensured.ok);
  assert.equal(ensured.invariantReady, true);
  assert.equal(ensured.auditBeforePersistence, true);

  const fallback = capability.getEffectiveTheme("unknownhost.example");
  assert.equal(fallback.kind, "FALLBACK");
  assert.equal(fallback.isDefault, true);
});

test("brandingandthemingreadinessmodel", () => {
  assert.equal(capability.getReadiness(capability.initialState), "READY");
  assert.equal(capability.getReadiness(), "READY");
  assert.equal(capability.getReadiness(undefined), "READY");

  const degradedState: capability.BrandingAndThemingState = {
    ...capability.initialState,
    readiness: "DEGRADED",
  };
  assert.equal(capability.getReadiness(degradedState), "DEGRADED");

  const notReadyState: capability.BrandingAndThemingState = {
    ...capability.initialState,
    readiness: "NOT_READY",
  };
  assert.equal(capability.getReadiness(notReadyState), "NOT_READY");

  assert.equal(capability.checkReadiness(degradedState), "DEGRADED");

  const degradedConfig: capability.BrandingAndThemingState = {
    ...capability.initialState,
    persistenceReachable: false,
    tenantResolverAvailable: false,
    readiness: "DEGRADED",
  };
  const degradedTheme = capability.getEffectiveTheme("anyhost.example", degradedConfig);
  assert.equal(degradedTheme.kind, "FALLBACK");
  assert.equal(degradedTheme.fallback, true);
  assert.equal(degradedTheme.isDefault, true);

  const normalConfig: capability.BrandingAndThemingState = {
    ...capability.initialState,
    bootstrapTheme: {
      ...capability.initialState.bootstrapTheme,
      tenantThemeOverrides: new Map([["tenant-ready", { primaryColor: "#111" }]]),
    },
    persistenceReachable: true,
    tenantResolverAvailable: true,
  };
  const readyTheme = capability.getEffectiveTheme("tenant-ready.example", normalConfig);
  assert.equal(readyTheme.kind, "SUCCESS");
  assert.equal(readyTheme.isDefault, false);

  const adapter = capability.createConfigurationStoreAdapter(normalConfig);
  const contract = capability.checkContracts(adapter);
  assert.equal(contract.invariantReady, true);
});

test("brandingandthemingstatemodel", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    bootstrapTheme: {
      ...capability.initialState.bootstrapTheme,
      tenantThemeOverrides: new Map([["tenant-state", { primaryColor: "#123456" }]]),
    },
    brandingRegistry: {
      ...capability.initialState.brandingRegistry,
      brandingDefinitions: new Map([["tenant-state", { applicationName: "Recorded", themeSelection: "dark" }]]),
    },
  };

  const description = capability.describeStateModel(state);
  assert.equal(description.defaultTheme.primaryColor, "#0066cc");
  assert.equal(description.defaultTheme.secondaryColor, "#004499");
  assert.equal(description.defaultTheme.backgroundColor, "#ffffff");
  assert.equal(description.defaultTheme.textColor, "#000000");

  const overrides = description.tenantThemeOverrides as ReadonlyMap<string, capability.BrandingAndThemingTenantThemeOverride>;
  assert.ok(overrides.has("tenant-state"));
  assert.equal(overrides.get("tenant-state")?.primaryColor, "#123456");

  const definitions = description.brandingDefinitions as ReadonlyMap<string, capability.BrandingAndThemingBrandingDefinition>;
  assert.ok(definitions.has("tenant-state"));
  assert.equal(definitions.get("tenant-state")?.applicationName, "Recorded");
  assert.equal(definitions.get("tenant-state")?.themeSelection, "dark");

  assert.equal(description.applicationNameType, "string");
  assert.deepEqual(
    [...description.themeSelectionSet],
    [...capability.BrandingAndThemingThemeSelection],
  );

  assert.equal(description.bootstrapThemeStateDistinct, true);
  assert.equal(description.editableBrandingRegistryState, true);
  assert.ok(description.stateKinds.includes("BOOTSTRAP_THEME"));
  assert.ok(description.stateKinds.includes("BRANDING_REGISTRY"));

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

test("brandingandthemingvalidation", () => {
  const tolerantRead = capability.getEffectiveTheme("missing.example");
  assert.equal(tolerantRead.kind, "FALLBACK");

  const validResult = capability.validateBrandingDefinition({
    applicationName: "Valid",
    themeSelection: "system",
  });
  assert.equal(validResult.kind, "SUCCESS");
  if (validResult.kind === "SUCCESS") {
    assert.equal(validResult.definition.applicationName, "Valid");
    assert.equal(validResult.definition.themeSelection, "system");
  }

  const invalidThemeResult = capability.validateBrandingDefinition({
    applicationName: "Valid",
    themeSelection: "purple",
  });
  assert.equal(invalidThemeResult.kind, "VALIDATION_ERROR");
  if (invalidThemeResult.kind === "VALIDATION_ERROR") {
    assert.equal(invalidThemeResult.error.kind, "VALIDATION_ERROR");
  }

  const invalidNameResult = capability.validateBrandingDefinition({
    applicationName: 42,
    themeSelection: "light",
  });
  assert.equal(invalidNameResult.kind, "VALIDATION_ERROR");
  if (invalidNameResult.kind === "VALIDATION_ERROR") {
    assert.equal(invalidNameResult.error.kind, "VALIDATION_ERROR");
  }

  const notAnObjectResult = capability.validateBrandingDefinition(null);
  assert.equal(notAnObjectResult.kind, "VALIDATION_ERROR");
  if (notAnObjectResult.kind === "VALIDATION_ERROR") {
    assert.equal(notAnObjectResult.error.kind, "VALIDATION_ERROR");
  }

  assert.equal(capability.validateThemeSelection("dark"), true);
  assert.equal(capability.validateThemeSelection("light"), true);
  assert.equal(capability.validateThemeSelection("system"), true);
  assert.equal(capability.validateThemeSelection("neon"), false);
  assert.equal(capability.validateThemeSelection(123), false);

  assert.equal(capability.validateApplicationName("MyApp"), true);
  assert.equal(capability.validateApplicationName(123), false);
  assert.equal(capability.validateApplicationName(null), false);

  const seedAudit: capability.BrandingAndThemingAuditFn = () => null;
  const seedResult = capability.createBrandingDefinition(
    "tenant-val",
    { applicationName: "Seed", themeSelection: "light" },
    writeToken("tenant-val"),
    capability.initialState,
    seedAudit,
  );
  assert.equal(seedResult.kind, "SUCCESS");
  const seededState = seedResult.kind === "SUCCESS" ? seedResult.newState : capability.initialState;

  const mutationValidationError = capability.patchBrandingDefinition(
    "tenant-val",
    { themeSelection: "neon" },
    writeToken("tenant-val"),
    seededState,
  );
  assert.equal(mutationValidationError.kind, "ERROR");
  if (mutationValidationError.kind === "ERROR") {
    assert.equal(mutationValidationError.error.kind, "VALIDATION_ERROR");
    assert.equal(mutationValidationError.error.mode, "FAIL_CLOSED");
  }
});