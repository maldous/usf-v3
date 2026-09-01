import { test } from "node:test";
import assert from "node:assert/strict";
import * as capability from "../../../src/capabilities/identityaccess/auditofprivilegedaccess.ts";

test("auditofprivilegedaccessauditmodel", () => {
  const event = {
    id: "1",
    action: "read",
    actorId: "user1",
    resource: "member",
    resourceId: "123",
    timestamp: "2023-01-01T00:00:00Z",
    metadata: { password: "secret123", name: "test" },
    tenantId: "tenant1",
  };
  const projection = capability.projectAuditEvent(event);
  assert.notEqual(projection, null);
  assert.equal(projection?.metadata.password, "[REDACTED]");
  assert.equal(projection?.metadata.name, "test");
});

test("auditofprivilegedaccesscontracts", () => {
  const query: capability.AuditQuery = {
    resource: "member",
    resourceId: "123",
    action: "read",
    actor: "user1",
    from: "2023-01-01T00:00:00Z",
    to: "2023-01-02T00:00:00Z",
    limit: 10,
  };
  const validation = capability.validateQuery(query);
  assert.notEqual(validation, "invalid");
  assert.equal((validation as capability.AuditQuery).limit, 10);
});

test("auditofprivilegedaccesserrormodel", () => {
  const invalidQuery: capability.AuditQuery = { limit: 0 };
  const outcome = capability.validateQuery(invalidQuery);
  assert.equal(outcome, "invalid");

  const forbiddenOutcome = capability.checkPermissions("tenant1", "tenant2", null);
  assert.equal(forbiddenOutcome, "forbidden");

  const state: capability.AuditOfPrivilegedAccessState = {
    readiness: "INVARIANT_READY",
    lastError: { kind: "PROVIDER_FAILURE", message: "Provider down" },
  };
  const readiness = capability.computeReadiness(state);
  assert.equal(readiness, "DEGRADED");
});

test("auditofprivilegedaccesslifecycle", () => {
  const durableRows = [
    {
      id: "1",
      action: "read",
      actorId: "user1",
      resource: "member",
      resourceId: "123",
      timestamp: "2023-01-01T00:00:00Z",
      metadata: { name: "test" },
      tenantId: "tenant1",
    },
  ];
  const query: capability.AuditQuery = { resource: "member" };
  const result = capability.queryAuditEvents(
    durableRows,
    query,
    "tenant1",
    "member-read",
  );
  assert.equal(result.outcome, "ok");
  assert.equal((result as { outcome: "ok"; events: readonly capability.AuditEventProjection[] }).events.length, 1);
});

test("auditofprivilegedaccesspermissions", () => {
  const outcome = capability.checkPermissions("tenant1", "tenant1", null);
  assert.equal(outcome, "forbidden");

  const allowedOutcome = capability.checkPermissions("tenant1", "tenant1", "member-read");
  assert.equal(allowedOutcome, "ok");
});

test("auditofprivilegedaccessproof", () => {
  const durableRows = [
    {
      id: "1",
      action: "read",
      actorId: "user1",
      resource: "member",
      resourceId: "123",
      timestamp: "2023-01-01T00:00:00Z",
      metadata: { name: "test" },
      tenantId: "tenant1",
    },
  ];
  const query: capability.AuditQuery = {};
  const result = capability.queryAuditEvents(
    durableRows,
    query,
    "tenant1",
    "member-read",
  );
  assert.equal(result.outcome, "ok");
  assert.equal((result as { outcome: "ok"; events: readonly capability.AuditEventProjection[] }).events.length, 1);
});

test("auditofprivilegedaccessreadinessmodel", () => {
  const state: capability.AuditOfPrivilegedAccessState = {
    readiness: "INVARIANT_READY",
    lastError: null,
  };
  const readiness = capability.computeReadiness(state);
  assert.equal(readiness, "INVARIANT_READY");

  const degradedState: capability.AuditOfPrivilegedAccessState = {
    readiness: "INVARIANT_READY",
    lastError: { kind: "PROVIDER_FAILURE", message: "Provider down" },
  };
  const degradedReadiness = capability.computeReadiness(degradedState);
  assert.equal(degradedReadiness, "DEGRADED");
});

test("auditofprivilegedaccessstatemodel", () => {
  const event = {
    id: "1",
    action: "read",
    actorId: "user1",
    resource: "member",
    resourceId: "123",
    timestamp: "2023-01-01T00:00:00Z",
    metadata: { name: "test" },
    tenantId: "tenant1",
  };
  const projection = capability.projectAuditEvent(event);
  assert.notEqual(projection, null);
  assert.equal(projection?.id, "1");
  assert.equal(projection?.action, "read");
  assert.equal(projection?.actorId, "user1");
  assert.equal(projection?.resource, "member");
  assert.equal(projection?.resourceId, "123");
  assert.equal(projection?.timestamp, "2023-01-01T00:00:00Z");
  assert.deepEqual(projection?.metadata, { name: "test" });
});

test("auditofprivilegedaccessvalidation", () => {
  const invalidResourceQuery: capability.AuditQuery = { resource: "unknown" as capability.LogicalResourceKind };
  const outcome = capability.validateQuery(invalidResourceQuery);
  assert.equal(outcome, "invalid");

  const invalidLimitQuery: capability.AuditQuery = { limit: 101 };
  const limitOutcome = capability.validateQuery(invalidLimitQuery);
  assert.equal(limitOutcome, "invalid");

  const validQuery: capability.AuditQuery = { limit: 50 };
  const validOutcome = capability.validateQuery(validQuery);
  assert.notEqual(validOutcome, "invalid");
  assert.equal((validOutcome as capability.AuditQuery).limit, 50);
});