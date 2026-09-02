import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/configuration/brandingandtheming.ts";

// Helper token factories
const writeToken = (tenantId: string): Readonly<Record<string, unknown>> => ({
  tenantId,
  permissions: ["configuration:write", "configuration:read"] as const,
});
const readToken = (tenantId: string): Readonly<Record<string, unknown>> => ({
  tenantId,
  permissions: ["configuration:read"] as const,
});

// brandingandthemingauditmodel
test("brandingandthemingauditmodel", () => {
  const auditEvents: capability.BrandingAndThemingAuditEvent[] = [];
  const auditFn: capability.BrandingAndThemingAuditFn = (event) => {
    auditEvents.push(event);
    return null;
  };

  const baseState: capability.BrandingAndThemingState = capability.initialState;

  // Create a definition
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

  // Patch the definition
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

  // Delete the definition
  const deleteResult = capability.deleteBrandingDefinition(
    "tenant-audit",
    writeToken("tenant-audit"),
    patchResult.kind === "SUCCESS" ? patchResult.newState : baseState,
    auditFn,
  );
  assert.equal(deleteResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[2].action, "value-cleared");

  // Verify readBootstrapTheme does not emit audit
  const beforeRead = auditEvents.length;
  const readResult = capability.readBootstrapTheme("somehost.example", baseState);
  assert.ok(readResult.kind === "SUCCESS" || readResult.kind === "FALLBACK");
  assert.equal(auditEvents.length, beforeRead);
});

// brandingandthemingcontracts
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

// brandingandthemingerrormodel
test("brandingandthemingerrormodel", () => {
  // Theme read failures are non‑blocking (fallback)
  const fallbackResult = capability.getEffectiveTheme("unknownhost.example");
  assert.equal(fallbackResult.kind, "FALLBACK");
  assert.equal(fallbackResult.fallback, true);
  assert.equal(fallbackResult.isDefault, true);

  // Bootstrap error mode is FAIL_OPEN
  const bootstrapError = capability.buildThemeReadError("read failed");
  assert.equal(bootstrapError.path, "BOOTSTRAP");
  assert.equal(bootstrapError.mode, "FAIL_OPEN");

  // Validation error (fail‑closed)
  const validationErrorResult = capability.patchBrandingDefinition(
    "tenant-val",
    { themeSelection: "neon" },
    writeToken("tenant-val"),
    capability.initialState,
  );
  assert.equal(validationErrorResult.kind, "ERROR");
  if (validationErrorResult.kind === "ERROR") {
    assert.equal(validationErrorResult.error.kind, "VALIDATION_ERROR");
    assert.equal(validationErrorResult.error.path, "MANAGEMENT");
    assert.equal(validationErrorResult.error.mode, "FAIL_CLOSED");
  }

  // Forbidden error (fail‑closed)
  const forbiddenResult = capability.listBrandingDefinitions("tenant-forbid", null);
  assert.equal(forbiddenResult.kind, "ERROR");
  if (forbiddenResult.kind === "ERROR") {
    assert.equal(forbiddenResult.error.kind, "FORBIDDEN");
    assert.equal(forbiddenResult.error.mode, "FAIL_CLOSED");
  }

  // Unknown‑key error (fail‑closed) – tenant has no definition
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

  // Non‑overridable error (fail‑closed)
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

  // Mapping error to status code
  const mapped = capability.mapErrorToStatusCode({ kind: "FORBIDDEN", message: "no", path: "MANAGEMENT", mode: "FAIL_CLOSED" });
  assert.equal(mapped, 403);

  // Bootstrap vs management error kind checks
  assert.equal(capability.isBootstrapErrorKind("THEME_READ_FAILURE"), true);
  assert.equal(capability.isBootstrapErrorKind("VALIDATION_ERROR"), false);
  assert.equal(capability.isManagementErrorKind("VALIDATION_ERROR"), true);
  assert.equal(capability.isManagementErrorKind("THEME_READ_FAILURE"), false);

  // Error model summary
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

// brandingandtheminglifecycle
test("brandingandtheminglifecycle", () => {
  // State with tenant theme overrides
  const stateWithOverrides: capability.BrandingAndThemingState = {
    ...capability.initialState,
    bootstrapTheme: {
      ...capability.initialState.bootstrapTheme,
      tenantThemeOverrides: new Map([["tenant-lifecycle", { primaryColor: "#abcdef" }]]),
    },
  };

  // Bootstrap read for tenant with overrides
  const bootstrapRead = capability.readBootstrapTheme("tenant-lifecycle.example", stateWithOverrides);
  assert.equal(bootstrapRead.kind, "SUCCESS");
  if (bootstrapRead.kind === "SUCCESS") {
    assert.equal(bootstrapRead.theme.primaryColor, "#abcdef");
  }

  // Fallback for unknown host
  const fallbackRead = capability.readBootstrapTheme("unmapped.example", stateWithOverrides);
  assert.equal(fallbackRead.kind, "FALLBACK");

  // Brander edits flow through configuration registry – create
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

  // Patch
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

  // Delete
  const deleteResult = capability.deleteBrandingDefinition(
    "tenant-lifecycle",
    writeToken("tenant-lifecycle"),
    afterPatch,
    auditFn,
  );
  assert.equal(deleteResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 3);
  assert.equal(auditEvents[2].action, "value-cleared");

  // Contract check on adapter built with the base state
  const adapter = capability.createConfigurationStoreAdapter(stateWithOverrides);
  const contract = capability.checkContracts(adapter);
  assert.ok(contract.ok);
  assert.ok(contract.bootstrapPath.includes("readBootstrapTheme"));
});

// brandingandthemingpermissions
test("brandingandthemingpermissions", () => {
  const stateWithDef: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingRegistry: {
      ...capability.initialState.brandingRegistry,
      brandingDefinitions: new Map([["tenant-a", { applicationName: "A", themeSelection: "light" }]]),
    },
  };

  // Unauthenticated bootstrap read
  const bootstrapRead = capability.readBootstrapTheme("anyhost.example", capability.initialState);
  assert.ok(bootstrapRead.kind === "SUCCESS" || bootstrapRead.kind === "FALLBACK");

  // No token – forbidden
  const noTokenResult = capability.listBrandingDefinitions("tenant-a", null);
  assert.equal(noTokenResult.kind, "ERROR");
  if (noTokenResult.kind === "ERROR") {
    assert.equal(noTokenResult.error.kind, "FORBIDDEN");
  }

  // Wrong tenant token – forbidden
  const wrongTenantResult = capability.listBrandingDefinitions(
    "tenant-a",
    writeToken("tenant-b"),
    stateWithDef,
  );
  assert.equal(wrongTenantResult.kind, "ERROR");
  if (wrongTenantResult.kind === "ERROR") {
    assert.equal(wrongTenantResult.error.kind, "FORBIDDEN");
  }

  // Read‑only token cannot write
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

  // Correct read token can read
  const readResult = capability.listBrandingDefinitions(
    "tenant-a",
    readToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(readResult.kind, "SUCCESS");

  // Correct write token can write
  const writeResult = capability.patchBrandingDefinition(
    "tenant-a",
    { applicationName: "Granted" },
    writeToken("tenant-a"),
    stateWithDef,
  );
  assert.equal(writeResult.kind, "SUCCESS");

  // Permission check helpers
  const permCheck = capability.checkBrandingPermission("tenant-a", writeToken("tenant-a"), "write");
  assert.equal(permCheck.kind, "GRANTED");

  const deniedCheck = capability.checkPermission("tenant-a", null, "write");
  assert.equal(deniedCheck.kind, "DENIED");
});

// brandingandthemingproof
test("brandingandthemingproof", () => {
  // Proof types
  assert.ok((capability.BrandingAndThemingProof as readonly string[]).includes("hermetic"));
  assert.ok((capability.BrandingAndThemingProof as readonly string[]).includes("runtime"));
  assert.ok((capability.BrandingAndThemingProof as readonly string[]).includes("pending"));

  assert.ok((capability.BrandingAndThemingProofLineage as readonly string[]).includes("hermetic"));
  assert.ok((capability.BrandingAndThemingProofLineage as readonly string[]).includes("runtime"));

  assert.ok((capability.BrandingAndThemingProofStatus as readonly string[]).includes("pending"));
  assert.ok((capability.BrandingAndThemingProofStatus as readonly string[]).includes("fresh-pending"));
  assert.ok((capability.BrandingAndThemingProofStatus as readonly string[]).includes("verified"));

  // Contract check indicates proof is present
  const adapter = capability.brandingAndThemingConfigurationStoreAdapter;
  const contract = capability.checkContracts(adapter);
  assert.ok(contract.ok);
  assert.equal(contract.invariantReady, true);
  assert.equal(contract.auditBeforePersistence, true);
  assert.ok(contract.bootstrapPath.includes("getEffectiveTheme"));

  // EnsureContracts also passes
  const ensured = capability.ensureContracts(adapter);
  assert.ok(ensured.ok);
  assert.equal(ensured.invariantReady, true);
  assert.equal(ensured.auditBeforePersistence, true);

  // Route‑level coverage: default fallback
  const fallback = capability.getEffectiveTheme("unknownhost.example");
  assert.equal(fallback.kind, "FALLBACK");
  assert.equal(fallback.isDefault, true);
});

// brandingandthemingreadinessmodel
test("brandingandthemingreadinessmodel", () => {
  // Readiness getters
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

  // Alias
  assert.equal(capability.checkReadiness(degradedState), "DEGRADED");

  // Degraded theme delivery when persistence or tenant resolver unavailable
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

  // Invariant ready when substrate reachable (use a normal state)
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

  // Contract check also reports invariantReady
  const adapter = capability.createConfigurationStoreAdapter(normalConfig);
  const contract = capability.checkContracts(adapter);
  assert.equal(contract.invariantReady, true);
});

// brandingandthemingstatemodel
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

  // Full description
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

// brandingandthemingvalidation
test("brandingandthemingvalidation", () => {
  // Theme read tolerance – missing tenant resolves to fallback
  const tolerantRead = capability.getEffectiveTheme("missing.example");
  assert.equal(tolerantRead.kind, "FALLBACK");

  // Validation of branding definition
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

  // Theme selection validation helper
  assert.equal(capability.validateThemeSelection("dark"), true);
  assert.equal(capability.validateThemeSelection("light"), true);
  assert.equal(capability.validateThemeSelection("system"), true);
  assert.equal(capability.validateThemeSelection("neon"), false);
  assert.equal(capability.validateThemeSelection(123), false);

  // Application name validation helper
  assert.equal(capability.validateApplicationName("MyApp"), true);
  assert.equal(capability.validateApplicationName(123), false);
  assert.equal(capability.validateApplicationName(null), false);

  // Mutation validation (fail‑closed)
  const mutationValidationError = capability.patchBrandingDefinition(
    "tenant-val",
    { themeSelection: "neon" },
    writeToken("tenant-val"),
    capability.initialState,
  );
  assert.equal(mutationValidationError.kind, "ERROR");
  if (mutationValidationError.kind === "ERROR") {
    assert.equal(mutationValidationError.error.kind, "VALIDATION_ERROR");
    assert.equal(mutationValidationError.error.mode, "FAIL_CLOSED");
  }
});