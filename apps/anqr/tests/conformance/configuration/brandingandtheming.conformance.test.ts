import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capability from "../../../src/capabilities/configuration/brandingandtheming.ts";

test("brandingandthemingauditmodel", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'App1', themeSelection: 'light' }]
    ]),
  };
  const auditEvents: capability.AuditEvent[] = [];
  const audit = (event: capability.AuditEvent) => auditEvents.push(event);

  // Theme read should not emit audit
  const readResult = capability.readTheme('tenant1', state);
  assert.equal(auditEvents.length, 0);

  // Branding mutation should emit audit before state change
  const patchResult = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    'NewApp',
    state,
    audit
  );
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, 'value-changed');
  assert.equal(auditEvents[0].tenantId, 'tenant1');
  assert.equal(auditEvents[0].key, 'applicationName');
  assert.equal(auditEvents[0].previousValue, 'App1');
  assert.equal(auditEvents[0].newValue, 'NewApp');
  assert.deepEqual(patchResult, { kind: 'SUCCESS' });

  // Clear mutation should also emit audit
  const deleteResult = capability.deleteBrandingDefinition(
    'tenant1',
    'applicationName',
    { ...state, brandingDefinitions: new Map([['tenant1', { applicationName: 'NewApp', themeSelection: 'light' }]]) },
    audit
  );
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[1].action, 'value-cleared');
  assert.deepEqual(deleteResult, { kind: 'SUCCESS' });
});

test("brandingandthemingcontracts", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'TestApp', themeSelection: 'dark' }]
    ]),
  };

  // Bootstrap theme read
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.deepEqual(themeResult.theme, capability.defaultTheme);

  // Configuration registry operations
  const listResult = capability.listBrandingDefinitions('tenant1', state);
  assert.deepEqual(listResult, [{ applicationName: 'TestApp', themeSelection: 'dark' }]);

  const patchResult = capability.patchBrandingDefinition(
    'tenant1',
    'themeSelection',
    'system',
    state,
    () => {}
  );
  assert.deepEqual(patchResult, { kind: 'SUCCESS' });

  const deleteResult = capability.deleteBrandingDefinition(
    'tenant1',
    'themeSelection',
    { ...state, brandingDefinitions: new Map([['tenant1', { applicationName: 'TestApp', themeSelection: 'dark' }]]) },
    () => {}
  );
  assert.deepEqual(deleteResult, { kind: 'SUCCESS' });
});

test("brandingandthemingerrormodel", () => {
  const state: capability.BrandingAndThemingState = capability.initialState;

  // Theme read should always succeed (fail-open)
  const readResult = capability.readTheme('nonexistent', state);
  assert.equal(readResult.kind, 'SUCCESS');
  assert.deepEqual(readResult.theme, capability.defaultTheme);

  // Branding mutations should fail-closed
  const invalidPatch = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    123,
    state,
    () => {}
  );
  assert.equal(invalidPatch.kind, 'ERROR');
  assert.equal(invalidPatch.error.kind, 'VALIDATION_ERROR');

  const unknownKey = capability.patchBrandingDefinition(
    'tenant1',
    'invalidKey',
    'value',
    state,
    () => {}
  );
  assert.equal(unknownKey.kind, 'ERROR');
  assert.equal(unknownKey.error.kind, 'UNKNOWN_KEY');

  const forbidden = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    'App',
    state,
    () => {}
  );
  assert.equal(forbidden.kind, 'ERROR');
  assert.equal(forbidden.error.kind, 'FORBIDDEN');

  const nonOverridable = capability.deleteBrandingDefinition(
    'tenant1',
    'applicationName',
    state,
    () => {}
  );
  assert.equal(nonOverridable.kind, 'ERROR');
  assert.equal(nonOverridable.error.kind, 'NON_OVERRIDABLE');
});

test("brandingandtheminglifecycle", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    tenantThemeOverrides: new Map([
      ['tenant1', { primaryColor: '#ff0000' }]
    ]),
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'LifecycleApp', themeSelection: 'dark' }]
    ]),
  };

  // Bootstrap read with tenant override
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.equal(themeResult.theme.primaryColor, '#ff0000');
  assert.equal(themeResult.theme.secondaryColor, capability.defaultTheme.secondaryColor);

  // Branding edit through configuration registry
  const patchResult = capability.patchBrandingDefinition(
    'tenant1',
    'themeSelection',
    'light',
    state,
    () => {}
  );
  assert.deepEqual(patchResult, { kind: 'SUCCESS' });

  // Unauthenticated bootstrap (empty host)
  const unauthResult = capability.readTheme('', state);
  assert.equal(unauthResult.kind, 'SUCCESS');
  assert.deepEqual(unauthResult.theme, capability.defaultTheme);
});

test("brandingandthemingpermissions", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'App1', themeSelection: 'light' }],
      ['tenant2', { applicationName: 'App2', themeSelection: 'dark' }]
    ]),
  };

  // Unauthenticated theme read (host-derived)
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');

  // Tenant-scoped operations
  const listTenant1 = capability.listBrandingDefinitions('tenant1', state);
  assert.deepEqual(listTenant1, [{ applicationName: 'App1', themeSelection: 'light' }]);

  const listTenant2 = capability.listBrandingDefinitions('tenant2', state);
  assert.deepEqual(listTenant2, [{ applicationName: 'App2', themeSelection: 'dark' }]);

  // Cross-tenant access should fail
  const patchResult = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    'NewApp',
    { ...state, brandingDefinitions: new Map([['tenant2', { applicationName: 'App2', themeSelection: 'dark' }]]) },
    () => {}
  );
  assert.equal(patchResult.kind, 'ERROR');
  assert.equal(patchResult.error.kind, 'FORBIDDEN');
});

test("brandingandthemingproof", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'ProofApp', themeSelection: 'system' }]
    ]),
    tenantThemeOverrides: new Map([
      ['tenant1', { primaryColor: '#00ff00' }]
    ]),
  };

  // Configuration unit proofs
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.equal(themeResult.theme.primaryColor, '#00ff00');

  const listResult = capability.listBrandingDefinitions('tenant1', state);
  assert.deepEqual(listResult, [{ applicationName: 'ProofApp', themeSelection: 'system' }]);

  const auditEvents: capability.AuditEvent[] = [];
  const patchResult = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    'UpdatedApp',
    state,
    (e) => auditEvents.push(e)
  );
  assert.deepEqual(patchResult, { kind: 'SUCCESS' });
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, 'value-changed');

  // Route-level coverage of theme bootstrap
  const defaultThemeResult = capability.readTheme('nonexistent', state);
  assert.equal(defaultThemeResult.kind, 'SUCCESS');
  assert.deepEqual(defaultThemeResult.theme, capability.defaultTheme);
});

test("brandingandthemingreadinessmodel", () => {
  const state: capability.BrandingAndThemingState = capability.initialState;

  // Degraded to default when tenant settings unavailable
  const themeResult = capability.readTheme('nonexistent', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.deepEqual(themeResult.theme, capability.defaultTheme);

  // Configuration-managed branding requires persistence
  const emptyState: capability.BrandingAndThemingState = {
    defaultTheme: capability.defaultTheme,
    tenantThemeOverrides: new Map(),
    brandingDefinitions: new Map(),
  };

  const patchResult = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    'App',
    emptyState,
    () => {}
  );
  assert.equal(patchResult.kind, 'ERROR');
  assert.equal(patchResult.error.kind, 'FORBIDDEN');
});

test("brandingandthemingstatemodel", () => {
  const state: capability.BrandingAndThemingState = {
    defaultTheme: capability.defaultTheme,
    tenantThemeOverrides: new Map([
      ['tenant1', { primaryColor: '#123456' }]
    ]),
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'StateApp', themeSelection: 'dark' }]
    ]),
  };

  // Static default theme
  assert.deepEqual(state.defaultTheme, capability.defaultTheme);

  // Tenant-scoped theme overrides
  const themeResult = capability.readTheme('tenant1', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.equal(themeResult.theme.primaryColor, '#123456');
  assert.equal(themeResult.theme.secondaryColor, capability.defaultTheme.secondaryColor);

  // Registry-managed branding definitions
  const listResult = capability.listBrandingDefinitions('tenant1', state);
  assert.deepEqual(listResult, [{ applicationName: 'StateApp', themeSelection: 'dark' }]);

  // Theme selection constrained to allowed set
  const validThemeSelection: capability.BrandingAndThemingThemeSelection = 'light';
  assert.ok(capability.BrandingAndThemingThemeSelection.includes(validThemeSelection));
});

test("brandingandthemingvalidation", () => {
  const state: capability.BrandingAndThemingState = {
    ...capability.initialState,
    brandingDefinitions: new Map([
      ['tenant1', { applicationName: 'ValidationApp', themeSelection: 'light' }]
    ]),
  };

  // Theme reads tolerate missing tenant
  const themeResult = capability.readTheme('nonexistent', state);
  assert.equal(themeResult.kind, 'SUCCESS');
  assert.deepEqual(themeResult.theme, capability.defaultTheme);

  // Branding edits validate theme selection
  const invalidThemeSelection = capability.patchBrandingDefinition(
    'tenant1',
    'themeSelection',
    'invalid' as capability.BrandingAndThemingThemeSelection,
    state,
    () => {}
  );
  assert.equal(invalidThemeSelection.kind, 'ERROR');
  assert.equal(invalidThemeSelection.error.kind, 'VALIDATION_ERROR');

  // Application name must be string
  const invalidAppName = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    123,
    state,
    () => {}
  );
  assert.equal(invalidAppName.kind, 'ERROR');
  assert.equal(invalidAppName.error.kind, 'VALIDATION_ERROR');

  // Valid mutation
  const validPatch = capability.patchBrandingDefinition(
    'tenant1',
    'applicationName',
    'ValidApp',
    state,
    () => {}
  );
  assert.deepEqual(validPatch, { kind: 'SUCCESS' });
});