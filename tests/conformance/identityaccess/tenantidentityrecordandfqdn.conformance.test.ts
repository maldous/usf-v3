import assert from "node:assert/strict";
import test from "node:test";
import * as capability from "../../../src/capabilities/identityaccess/tenantidentityrecordandfqdn.ts";

test("tenantidentityrecordandfqdnauditmodel", () => {
  const auditFn: capability.AuditFn = (event) => {
    assert.strictEqual(event.kind, "PROVISION_AUDIT");
    assert.strictEqual(event.tenantId, "org-123");
    assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    return null;
  };

  const state: readonly capability.TenantState[] = [];
  const tenantInfo = {
    organizationId: "org-123",
    slug: "test-slug",
    fqdn: "test-slug.example.com",
  } as const;

  const result = capability.provisionTenant(state, tenantInfo, auditFn);
  assert.ok(!("kind" in result && result.kind === "PROVISION_ERROR"));
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].organizationId, "org-123");
});