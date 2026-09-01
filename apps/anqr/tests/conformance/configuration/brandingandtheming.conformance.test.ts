import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/configuration/brandingandtheming.ts";

test("brandingandthemingauditmodel", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'App1', themeSelection: 'light' as const }]
    ]),
  };
  const auditEvents: capability.AuditEvent[] = [];
  const audit = (event: capability.AuditEvent): capability.BrandingAndThemingError | null => {
    auditEvents.push(event);
    return null;
  };

  // Theme read should not emit audit
  capability.readTheme('tenant1', state);
  assert.equal(auditEvents.length, 0);

  // Branding mutation should emit audit before state change
  const createResult = capability.createBrandingDefinition(
    'tenant2',
    { applicationName: 'NewApp', themeSelection: 'dark' as const },
    { tenantId: 'tenant2', permissions: ['configuration:read', 'configuration:write'] },
    state,
    audit
  );
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, 'value-changed');
  assert.equal(auditEvents[0].tenantId, 'tenant2');
  assert.equal(auditEvents[0].key, 'brandingDefinition');
  assert.equal(auditEvents[0].previousValue, null);
  assert.deepEqual(auditEvents[0].newValue, { applicationName: 'NewApp', themeSelection: 'dark' });
  assert.equal(createResult.kind, 'SUCCESS');

  // Test delete audit
  const deleteResult = capability.deleteBrandingDefinition(
    'tenant2',
    { tenantId: 'tenant2', permissions: ['configuration:read', 'configuration:write'] },
    createResult.newState,
    audit
  );
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[1].action, 'value-cleared');
  assert.equal(deleteResult.kind, 'SUCCESS');
});

test("brandingandthemingcontracts", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'TestApp', themeSelection: 'dark' as const }]
    ]),
  };

  // Bootstrap theme read
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');

  // Configuration registry operations
  const listResult = capability.listBrandingDefinitions(
    'tenant1',
    { tenantId: 'tenant1', permissions: ['configuration:read', 'configuration:write'] },
    state
  );
  assert.ok(Array.isArray(listResult));
  assert.equal(listResult.length, 1);
  assert.equal(listResult[0].applicationName, 'TestApp');
  assert.equal(listResult[0].themeSelection, 'dark');

  const patchResult = capability.patchBrandingDefinition(
    'tenant1',
    { applicationName: 'UpdatedApp' },
    { tenantId: 'tenant1', permissions: ['configuration:read', 'configuration:write'] },
    state,
    () => null
  );
  assert.equal(patchResult.kind, 'SUCCESS');

  const deleteResult = capability.deleteBrandingDefinition(
    'tenant1',
    { tenantId: 'tenant1', permissions: ['configuration:read', 'configuration:write'] },
    state,
    () => null
  );
  assert.equal(deleteResult.kind, 'SUCCESS');
});

test("brandingandthemingerrormodel", () => {
  const state: capability.BrandingAndThemingState = capability.initialState;

  // Theme read should always succeed (fail-open)
  const readResult = capability.readTheme('nonexistent', state);
  assert.equal(readResult.kind, 'FALLBACK');
  assert.deepEqual(readResult.theme, capability.initialState.defaultTheme);

  // Branding mutations should fail-closed
  const invalidValidation = capability.validateBrandingDefinition({
    applicationName: 123,
    themeSelection: 'light' as const
  });
  assert.equal(invalidValidation.kind, 'VALIDATION_ERROR');

  const invalidPermission = capability.createBrandingDefinition(
    'tenant1',
    { applicationName: 'App', themeSelection: 'light' as const },
    { tenantId: 'wrong-tenant', permissions: ['configuration:read', 'configuration:write'] },
    state,
    () => null
  );
  assert.equal(invalidPermission.kind, 'ERROR');
  assert.equal(invalidPermission.error.kind, 'FORBIDDEN');

  const unknownKey = capability.patchBrandingDefinition(
    'nonexistent',
    { applicationName: 'App' },
    { tenantId: 'nonexistent', permissions: ['configuration:read', 'configuration:write'] },
    state,
    () => null
  );
  assert.equal(unknownKey.kind, 'ERROR');
  assert.equal(unknownKey.error.kind, 'UNKNOWN_KEY');
});

test("brandingandtheminglifecycle", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    tenantThemeOverrides: new Map([
      ['tenant1', { primaryColor: '#ff0000' }]
    ]),
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'LifecycleApp', themeSelection: 'dark' as const }]
    ]),
  };

  // Bootstrap read with tenant override
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.equal(themeResult.theme.primaryColor, '#ff0000');
  assert.equal(themeResult.theme.secondaryColor, capability.initialState.defaultTheme.secondaryColor);

  // Branding edit through configuration registry
  const createResult = capability.createBrandingDefinition(
    'tenant2',
    { applicationName: 'NewApp', themeSelection: 'light' as const },
    { tenantId: 'tenant2', permissions: ['configuration:read', 'configuration:write'] },
    state,
    () => null
  );
  assert.equal(createResult.kind, 'SUCCESS');

  // Unauthenticated bootstrap (empty host)
  const unauthResult = capability.readTheme('', state);
  assert.equal(unauthResult.kind, 'SUCCESS');
  assert.deepEqual(unauthResult.theme, capability.initialState.defaultTheme);
});

test("brandingandthemingpermissions", () => {
  const state: capability.BrandingAndThemingState = capability.initialState;

  // Unauthenticated theme read (host-derived)
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'FALLBACK');

  // Tenant-scoped operations with valid permissions
  const validToken = { tenantId: 'tenant1', permissions: ['configuration:read', 'configuration:write'] };
  const createResult = capability.createBrandingDefinition(
    'tenant1',
    { applicationName: 'App', themeSelection: 'light' as const },
    validToken,
    state,
    () => null
  );
  assert.equal(createResult.kind, 'SUCCESS');

  // Cross-tenant access should fail
  const crossTenantToken = { tenantId: 'tenant2', permissions: ['configuration:read', 'configuration:write'] };
  const deniedResult = capability.createBrandingDefinition(
    'tenant1',
    { applicationName: 'App', themeSelection: 'light' as const },
    crossTenantToken,
    state,
    () => null
  );
  assert.equal(deniedResult.kind, 'ERROR');
  assert.equal(deniedResult.error.kind, 'FORBIDDEN');

  // Missing permissions should fail
  const noPermToken = { tenantId: 'tenant1', permissions: [] };
  const noPermResult = capability.createBrandingDefinition(
    'tenant1',
    { applicationName: 'App', themeSelection: 'light' as const },
    noPermToken,
    state,
    () => null
  );
  assert.equal(noPermResult.kind, 'ERROR');
  assert.equal(noPermResult.error.kind, 'FORBIDDEN');
});

test("brandingandthemingproof", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'ProofApp', themeSelection: 'system' as const }]
    ]),
    tenantThemeOverrides: new Map([
      ['tenant1', { primaryColor: '#00ff00' }]
    ]),
  };

  // Configuration unit proofs
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.equal(themeResult.theme.primaryColor, '#00ff00');

  const listResult = capability.listBrandingDefinitions(
    'tenant1',
    { tenantId: 'tenant1', permissions: ['configuration:read', 'configuration:write'] },
    state
  );
  assert.deepEqual(listResult, [{ applicationName: 'ProofApp', themeSelection: 'system' as const }]);

  const auditEvents: capability.AuditEvent[] = [];
  const createResult = capability.createBrandingDefinition(
    'tenant2',
    { applicationName: 'UpdatedApp', themeSelection: 'light' as const },
    { tenantId: 'tenant2', permissions: ['configuration:read', 'configuration:write'] },
    state,
    (e) => { auditEvents.push(e); return null; }
  );
  assert.equal(createResult.kind, 'SUCCESS');
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, 'value-changed');

  // Route-level coverage of theme bootstrap
  const defaultThemeResult = capability.readTheme('nonexistent', state);
  assert.equal(defaultThemeResult.kind, 'FALLBACK');
  assert.deepEqual(defaultThemeResult.theme, capability.initialState.defaultTheme);
});

test("brandingandthemingreadinessmodel", () => {
  const state: capability.BrandingAndThemingState = capability.initialState;

  // Degraded to default when tenant settings unavailable
  const themeResult = capability.readTheme('nonexistent', state);
  assert.equal(themeResult.kind, 'FALLBACK');
  assert.deepEqual(themeResult.theme, capability.initialState.defaultTheme);

  // Configuration-managed branding requires persistence
  const emptyState: capability.BrandingAndThemingState = {
    defaultTheme: capability.initialState.defaultTheme,
    tenantThemeOverrides: new Map(),
    brandingDefinitions: new Map(),
  };

  const createResult = capability.createBrandingDefinition(
    'tenant1',
    { applicationName: 'App', themeSelection: 'light' as const },
    { tenantId: 'tenant1', permissions: ['configuration:read', 'configuration:write'] },
    emptyState,
    () => null
  );
  assert.equal(createResult.kind, 'SUCCESS');
});

test("brandingandthemingstatemodel", () => {
  const state: capability.BrandingAndThemingState = {
    defaultTheme: capability.initialState.defaultTheme,
    tenantThemeOverrides: new Map([
      ['tenant1', { primaryColor: '#123456' }]
    ]),
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'StateApp', themeSelection: 'dark' as const }]
    ]),
  };

  // Static default theme
  assert.deepEqual(state.defaultTheme, capability.initialState.defaultTheme);

  // Tenant-scoped theme overrides
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.equal(themeResult.theme.primaryColor, '#123456');
  assert.equal(themeResult.theme.secondaryColor, capability.initialState.defaultTheme.secondaryColor);

  // Registry-managed branding definitions
  const listResult = capability.listBrandingDefinitions(
    'tenant1',
    { tenantId: 'tenant1', permissions: ['configuration:read', 'configuration:write'] },
    state
  );
  assert.deepEqual(listResult, [{ applicationName: 'StateApp', themeSelection: 'dark' as const }]);

  // Theme selection constrained to allowed set
  const validThemeSelection: capability.BrandingAndThemingThemeSelection = 'light';
  assert.ok(capability.BrandingAndThemingThemeSelection.includes(validThemeSelection));
});

test("brandingandthemingvalidation", () => {
  const state: capability.BrandingAndThemingState = capability.initialState;

  // Theme reads tolerate missing tenant
  const themeResult = capability.readTheme('nonexistent', state);
  assert.equal(themeResult.kind, 'FALLBACK');
  assert.deepEqual(themeResult.theme, capability.initialState.defaultTheme);

  // Branding edits validate theme selection
  const invalidThemeSelection = capability.validateBrandingDefinition({
    applicationName: 'App',
    themeSelection: 'invalid' as capability.BrandingAndThemingThemeSelection
  });
  assert.equal(invalidThemeSelection.kind, 'VALIDATION_ERROR');

  // Application name must be string
  const invalidAppName = capability.validateBrandingDefinition({
    applicationName: 123,
    themeSelection: 'light' as const
  });
  assert.equal(invalidAppName.kind, 'VALIDATION_ERROR');

  // Valid mutation
  const validValidation = capability.validateBrandingDefinition({
    applicationName: 'ValidApp',
    themeSelection: 'dark' as const
  });
  assert.equal(validValidation.kind, 'SUCCESS');
});