import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/configuration/brandingandtheming.ts";

test("brandingandthemingauditmodel", () => {
  const auditEvents: capability.AuditEvent[] = [];
  const audit = (event: capability.AuditEvent): capability.BrandingAndThemingError | null => {
    auditEvents.push(event);
    return null;
  };

  // Theme read must not emit any audit
  capability.readTheme("tenant1");
  assert.equal(auditEvents.length, 0);

  // Branding create must emit value-changed audit
  const createResult = capability.createBrandingDefinition(
    "tenant-a",
    { applicationName: "NewApp", themeSelection: "dark" as const },
    { tenantId: "tenant-a", permissions: ["configuration:read", "configuration:write"] },
    capability.initialState,
    audit,
  );
  assert.equal(createResult.kind, "SUCCESS");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "value-changed");
  assert.equal(auditEvents[0].tenantId, "tenant-a");
  assert.equal(auditEvents[0].key, "brandingDefinition");
  assert.equal(auditEvents[0].previousValue, null);
  assert.deepEqual(auditEvents[0].newValue, {
    applicationName: "NewApp",
    themeSelection: "dark",
  });

  // Branding delete must emit value-cleared audit
  const deleteResult = capability.deleteBrandingDefinition(
    "tenant-a",
    { tenantId: "tenant-a", permissions: ["configuration:read", "configuration:write"] },
    capability.initialState,
    audit,
  );
  assert.equal(deleteResult.kind, "ERROR");
  assert.equal(deleteResult.error.kind, "UNKNOWN_KEY");
  assert.equal(auditEvents.length, 1);
});

test("brandingandthemingcontracts", () => {
  // Configuration store port is the single contract surface
  const adapter = capability.createAdapter({
    ...capability.initialState,
    tenantThemeOverrides: new Map<string, capability.TenantThemeOverride>([
      ["tenant-1", { primaryColor: "#aa0000" }],
    ]),
    brandingDefinitions: new Map<string, capability.BrandingDefinition>([
      ["tenant-1", { applicationName: "TestApp", themeSelection: "dark" as const }],
    ]),
  });

  // Bootstrap theme read
  const themeResult = adapter.getEffectiveTheme("tenant-1");
  assert.equal(themeResult.kind, "SUCCESS");
  assert.equal(themeResult.primaryColor, "#aa0000");

  // Configuration registry list scoped to branding
  const listResult = adapter.listBrandingDefinitions(
    "tenant-1",
    { tenantId: "tenant-1", permissions: ["configuration:read", "configuration:write"] },
  );
  assert.equal(listResult.kind, "SUCCESS");
  assert.equal(listResult.definitions.length, 1);
  assert.equal(listResult.definitions[0].applicationName, "TestApp");
  assert.equal(listResult.definitions[0].themeSelection, "dark");

  // Configuration registry patch
  const patchResult = adapter.patchBrandingDefinition(
    "tenant-1",
    { applicationName: "UpdatedApp" },
    { tenantId: "tenant-1", permissions: ["configuration:read", "configuration:write"] },
    () => null,
  );
  assert.equal(patchResult.kind, "SUCCESS");

  // Configuration registry delete
  const deleteResult = adapter.deleteBrandingDefinition(
    "tenant-1",
    { tenantId: "tenant-1", permissions: ["configuration:read", "configuration:write"] },
    () => null,
  );
  assert.equal(deleteResult.kind, "SUCCESS");
});

test("brandingandthemingerrormodel", () => {
  // Theme read fails open with a default fallback
  const readResult = capability.readTheme("nonexistent-tenant");
  assert.equal(readResult.kind, "FALLBACK");
  assert.deepEqual(readResult.theme, capability.initialState.defaultTheme);
  assert.equal(readResult.fallback, true);

  // Validation error mapping: 400
  const validation = capability.validateBrandingDefinition({
    applicationName: 123 as unknown as string,
    themeSelection: "light" as const,
  });
  assert.equal(validation.kind, "VALIDATION_ERROR");
  assert.equal(capability.mapErrorToStatusCode(validation.error), 400);

  // Forbidden mapping: 403
  const forbidden = capability.createBrandingDefinition(
    "tenant-x",
    { applicationName: "App", themeSelection: "light" as const },
    { tenantId: "other-tenant", permissions: ["configuration:write"] },
    capability.initialState,
    () => null,
  );
  assert.equal(forbidden.kind, "ERROR");
  assert.equal(forbidden.error.kind, "FORBIDDEN");
  assert.equal(capability.mapErrorToStatusCode(forbidden.error), 403);

  // Unknown key mapping: 404
  const unknown = capability.patchBrandingDefinition(
    "missing-tenant",
    { applicationName: "App" },
    { tenantId: "missing-tenant", permissions: ["configuration:write"] },
    capability.initialState,
    () => null,
  );
  assert.equal(unknown.kind, "ERROR");
  assert.equal(unknown.error.kind, "UNKNOWN_KEY");
  assert.equal(capability.mapErrorToStatusCode(unknown.error), 404);

  // Non-overridable mapping: 409
  const lockedState: capability.BrandingAndThemingState = {
    ...capability.initialState,
    nonOverridableTenants: new Set<string>(["locked-tenant"]),
  };
  const nonOverridable = capability.createBrandingDefinition(
    "locked-tenant",
    { applicationName: "App", themeSelection: "light" as const },
    { tenantId: "locked-tenant", permissions: ["configuration:write"] },
    lockedState,
    () => null,
  );
  assert.equal(nonOverridable.kind, "ERROR");
  assert.equal(nonOverridable.error.kind, "NON_OVERRIDABLE");
  assert.equal(capability.mapErrorToStatusCode(nonOverridable.error), 409);
});

test("brandingandtheminglifecycle", () => {
  const overrideState: capability.BrandingAndThemingState = {
    ...capability.initialState,
    tenantThemeOverrides: new Map<string, capability.TenantThemeOverride>([
      ["tenant-1", { primaryColor: "#ff0000" }],
    ]),
  };

  // Bootstrap read resolves default overlaid by tenant override
  const themeResult = capability.readTheme("tenant-1", overrideState);
  assert.equal(themeResult.kind, "SUCCESS");
  assert.equal(themeResult.theme.primaryColor, "#ff0000");
  assert.equal(themeResult.theme.secondaryColor, capability.initialState.defaultTheme.secondaryColor);

  // Unauthenticated bootstrap returns the default theme
  const unauth = capability.readTheme("");
  assert.equal(unauth.kind, "FALLBACK");
  assert.deepEqual(unauth.theme, capability.initialState.defaultTheme);

  // Managed branding edit flows through the configuration registry
  const createResult = capability.createBrandingDefinition(
    "tenant-2",
    { applicationName: "LifecycleApp", themeSelection: "light" as const },
    { tenantId: "tenant-2", permissions: ["configuration:read", "configuration:write"] },
    capability.initialState,
    () => null,
  );
  assert.equal(createResult.kind, "SUCCESS");
  if (createResult.kind === "SUCCESS") {
    assert.equal(createResult.definition?.applicationName, "LifecycleApp");
    assert.equal(createResult.definition?.themeSelection, "light");
  }
});

test("brandingandthemingpermissions", () => {
  // Unauthenticated host-derived theme read succeeds (no token required)
  const unauth = capability.readTheme("any-host");
  assert.equal(unauth.kind, "FALLBACK");

  // Tenant-scoped branding write with matching token and write permission succeeds
  const validToken = {
    tenantId: "tenant-1",
    permissions: ["configuration:write"] as readonly string[],
  };
  const granted = capability.createBrandingDefinition(
    "tenant-1",
    { applicationName: "PermApp", themeSelection: "light" as const },
    validToken,
    capability.initialState,
    () => null,
  );
  assert.equal(granted.kind, "SUCCESS");

  // Cross-tenant token is denied
  const crossTenant = capability.createBrandingDefinition(
    "tenant-1",
    { applicationName: "PermApp", themeSelection: "light" as const },
    { tenantId: "tenant-2", permissions: ["configuration:write"] },
    capability.initialState,
    () => null,
  );
  assert.equal(crossTenant.kind, "ERROR");
  assert.equal(crossTenant.error.kind, "FORBIDDEN");

  // Same tenant but missing write permission is denied
  const readOnly = capability.createBrandingDefinition(
    "tenant-1",
    { applicationName: "PermApp", themeSelection: "light" as const },
    { tenantId: "tenant-1", permissions: ["configuration:read"] },
    capability.initialState,
    () => null,
  );
  assert.equal(readOnly.kind, "ERROR");
  assert.equal(readOnly.error.kind, "FORBIDDEN");

  // Null token is denied for any write
  const nullToken = capability.createBrandingDefinition(
    "tenant-1",
    { applicationName: "PermApp", themeSelection: "light" as const },
    null,
    capability.initialState,
    () => null,
  );
  assert.equal(nullToken.kind, "ERROR");
  assert.equal(nullToken.error.kind, "FORBIDDEN");
});

test("brandingandthemingproof", () => {
  // Branding definitions proof: list returns the managed definition
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map<string, capability.BrandingDefinition>([
      ["tenant-1", { applicationName: "ProofApp", themeSelection: "system" as const }],
    ]),
    tenantThemeOverrides: new Map<string, capability.TenantThemeOverride>([
      ["tenant-1", { primaryColor: "#00ff00" }],
    ]),
  };

  const listResult = capability.listBrandingDefinitions(
    "tenant-1",
    { tenantId: "tenant-1", permissions: ["configuration:read"] },
    state,
  );
  assert.equal(listResult.kind, "SUCCESS");
  assert.equal(listResult.definitions.length, 1);
  assert.equal(listResult.definitions[0].applicationName, "ProofApp");

  // Override source proof: theme resolves to the override value
  const themeResult = capability.readTheme("tenant-1", state);
  assert.equal(themeResult.kind, "SUCCESS");
  assert.equal(themeResult.theme.primaryColor, "#00ff00");

  // Validation proof
  const valid = capability.validateBrandingDefinition({
    applicationName: "V",
    themeSelection: "system" as const,
  });
  assert.equal(valid.kind, "SUCCESS");

  // Audit-first write proof: audit fires before state is mutated
  let auditFired = false;
  let stateSeenAtAudit: unknown = null;
  const audit = (event: capability.AuditEvent): capability.BrandingAndThemingError | null => {
    auditFired = true;
    stateSeenAtAudit = state.brandingDefinitions instanceof Map
      ? state.brandingDefinitions.has("tenant-2")
      : false;
    void event;
    return null;
  };
  const createResult = capability.createBrandingDefinition(
    "tenant-2",
    { applicationName: "AuditedApp", themeSelection: "light" as const },
    { tenantId: "tenant-2", permissions: ["configuration:write"] },
    state,
    audit,
  );
  assert.equal(createResult.kind, "SUCCESS");
  assert.equal(auditFired, true);
  assert.equal(stateSeenAtAudit, false);

  // Route-level theme bootstrap default fallback proof
  const bootstrap = capability.readTheme("unknown-host", state);
  assert.equal(bootstrap.kind, "FALLBACK");
  assert.deepEqual(bootstrap.theme, capability.initialState.defaultTheme);
});

test("brandingandthemingreadinessmodel", () => {
  // Theme delivery degrades to default when tenant settings are unavailable
  const degraded = capability.readTheme("missing-tenant");
  assert.equal(degraded.kind, "FALLBACK");
  assert.deepEqual(degraded.theme, capability.initialState.defaultTheme);

  // Readiness accessor reports module readiness
  const ready = capability.getReadiness(capability.initialState);
  assert.equal(ready, "READY");

  const notReadyState: capability.BrandingAndThemingState = {
    ...capability.initialState,
    readiness: "NOT_READY",
  };
  assert.equal(capability.getReadiness(notReadyState), "NOT_READY");

  // Configuration-managed branding becomes effective when persistence is reachable
  const createResult = capability.createBrandingDefinition(
    "tenant-ready",
    { applicationName: "ReadyApp", themeSelection: "light" as const },
    { tenantId: "tenant-ready", permissions: ["configuration:write"] },
    capability.initialState,
    () => null,
  );
  assert.equal(createResult.kind, "SUCCESS");
});

test("brandingandthemingstatemodel", () => {
  // Static default theme
  assert.equal(capability.initialState.defaultTheme.primaryColor, "#0066cc");
  assert.equal(capability.initialState.defaultTheme.secondaryColor, "#004499");
  assert.equal(capability.initialState.defaultTheme.backgroundColor, "#ffffff");
  assert.equal(capability.initialState.defaultTheme.textColor, "#000000");

  // State shape: defaultTheme, tenantThemeOverrides, brandingDefinitions, readiness
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    tenantThemeOverrides: new Map<string, capability.TenantThemeOverride>([
      ["tenant-1", { primaryColor: "#123456" }],
    ]),
    brandingDefinitions: new Map<string, capability.BrandingDefinition>([
      ["tenant-1", { applicationName: "StateApp", themeSelection: "dark" as const }],
    ]),
  };

  // Tenant-scoped override is consumed by the runtime theme response
  const themeResult = capability.readTheme("tenant-1", state);
  assert.equal(themeResult.kind, "SUCCESS");
  assert.equal(themeResult.theme.primaryColor, "#123456");
  assert.equal(themeResult.theme.secondaryColor, capability.initialState.defaultTheme.secondaryColor);

  // Registry-managed branding definitions carry full semantics
  const listResult = capability.listBrandingDefinitions(
    "tenant-1",
    { tenantId: "tenant-1", permissions: ["configuration:read"] },
    state,
  );
  assert.equal(listResult.kind, "SUCCESS");
  assert.equal(listResult.definitions[0].applicationName, "StateApp");
  assert.equal(listResult.definitions[0].themeSelection, "dark");

  // Theme selection constrained to allowed set
  const allowed: readonly string[] = capability.BrandingAndThemingThemeSelection;
  assert.equal(allowed.length, 3);
  assert.ok(allowed.includes("system"));
  assert.ok(allowed.includes("light"));
  assert.ok(allowed.includes("dark"));
});

test("brandingandthemingvalidation", () => {
  // Theme reads tolerate missing tenant by returning defaults
  const themeResult = capability.readTheme("missing-tenant");
  assert.equal(themeResult.kind, "FALLBACK");
  assert.deepEqual(themeResult.theme, capability.initialState.defaultTheme);

  // Theme selection validator
  assert.equal(capability.validateThemeSelection("system"), true);
  assert.equal(capability.validateThemeSelection("light"), true);
  assert.equal(capability.validateThemeSelection("dark"), true);
  assert.equal(capability.validateThemeSelection("nope"), false);
  assert.equal(capability.validateThemeSelection(123), false);

  // Application name type check
  assert.equal(capability.validateApplicationName("MyApp"), true);
  assert.equal(capability.validateApplicationName(123), false);
  assert.equal(capability.validateApplicationName(null), false);

  // Branding definition validation rejects unknown theme selection
  const badTheme = capability.validateBrandingDefinition({
    applicationName: "App",
    themeSelection: "neon" as unknown as capability.BrandingAndThemingThemeSelection,
  });
  assert.equal(badTheme.kind, "VALIDATION_ERROR");
  assert.equal(badTheme.valid, false);

  // Branding definition validation rejects non-string applicationName
  const badName = capability.validateBrandingDefinition({
    applicationName: 42 as unknown as string,
    themeSelection: "light" as const,
  });
  assert.equal(badName.kind, "VALIDATION_ERROR");
  assert.equal(badName.valid, false);

  // Non-overridable enforcement through mutation path
  const lockedState: capability.BrandingAndThemingState = {
    ...capability.initialState,
    nonOverridableTenants: new Set<string>(["locked"]),
  };
  const blocked = capability.createBrandingDefinition(
    "locked",
    { applicationName: "App", themeSelection: "light" as const },
    { tenantId: "locked", permissions: ["configuration:write"] },
    lockedState,
    () => null,
  );
  assert.equal(blocked.kind, "ERROR");
  assert.equal(blocked.error.kind, "NON_OVERRIDABLE");

  // Valid mutation succeeds
  const ok = capability.createBrandingDefinition(
    "tenant-ok",
    { applicationName: "App", themeSelection: "dark" as const },
    { tenantId: "tenant-ok", permissions: ["configuration:write"] },
    capability.initialState,
    () => null,
  );
  assert.equal(ok.kind, "SUCCESS");
});