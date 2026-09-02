import assert from "node:assert/strict";
import { test } from "node:test";
import * as capability from "../../../src/capabilities/configuration/brandingandtheming.ts";

type State = capability.BrandingAndThemingState;
type BrandingDef = capability.BrandingAndThemingBrandingDefinition;
type TenantOverride = capability.BrandingAndThemingTenantThemeOverride;
type AuditEvent = capability.BrandingAndThemingAuditEvent;
type AuditFn = capability.BrandingAndThemingAuditFn;

const writeToken = (tenantId: string) => ({
  tenantId,
  permissions: ["configuration:write", "configuration:read"] as const,
});

const readToken = (tenantId: string) => ({
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
    withOverrides(capability.initialState, new Map([
      ["tenant-state", { primaryColor: "#123456" }],
    ])),
    new Map([
      ["tenant-state", { applicationName: "Recorded", themeSelection: "dark" }],
    ]),
  );

  const description = capability.describeStateModel(state);
  assert.equal(description.bootstrapThemeStateDistinct, true);
  assert.equal(description.editableBrandingRegistryState, true);
  assert.ok(description.stateKinds.includes("BOOTSTRAP_THEME"));
  assert.ok(description.stateKinds.includes("BRANDING_REGISTRY"));
  assert.equal(description.applicationNameType, "string");
  assert.deepEqual(description.themeSelectionSet, capability.BrandingAndThemingThemeSelection);
});