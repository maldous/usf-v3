import assert from "node:assert/strict";
import test from "node:test";
import { createJsonSchemaValidator, SchemaPolicyError } from "../../../src/schema/index.ts";

const dialect = "https://json-schema.org/draft/2020-12/schema";

test("explicit registry composes one canonical descriptor without coercion or defaults", () => {
  const descriptor = { $schema: dialect, $id: "urn:test:descriptor:1", type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } };
  const interrogation = { $schema: dialect, $id: "urn:test:interrogation:1", type: "array", items: { $ref: descriptor.$id } };
  const validator = createJsonSchemaValidator(interrogation, { dependencySchemas: [descriptor] });
  assert.equal(validator.validate([{ id: "a" }]).valid, true);
  assert.equal(validator.validate([{ id: 1 }]).valid, false);
  assert.equal(validator.validate([{ id: "a", extra: true }]).valid, false);
  descriptor.properties.id.type = "number";
  assert.equal(validator.validate([{ id: "a" }]).valid, true);
  assert.throws(() => createJsonSchemaValidator(interrogation), (e: unknown) => e instanceof SchemaPolicyError && e.reasonCode === "SCHEMA_REF_EXTERNAL");
});

test("registry rejects unknown refs, absent and duplicate IDs, including root collisions", () => {
  const root = { $schema: dialect, $id: "urn:test:root:1", type: "string" };
  const refused = (schema: unknown, dependencies: readonly unknown[], reason: string) => assert.throws(() => createJsonSchemaValidator(schema, { dependencySchemas: dependencies }), (e: unknown) => e instanceof SchemaPolicyError && e.reasonCode === reason);
  refused({ ...root, $ref: "https://unregistered.invalid/schema" }, [], "SCHEMA_REF_UNRESOLVED");
  refused({ ...root, $ref: "file:///unregistered/schema" }, [], "SCHEMA_REF_UNRESOLVED");
  refused(root, [{ $schema: dialect, type: "string" }], "SCHEMA_ID_INVALID");
  refused({ $schema: dialect, type: "string" }, [], "SCHEMA_ID_INVALID");
  refused(root, [root], "SCHEMA_ID_DUPLICATE");
  const dep = { ...root, $id: "urn:test:dep:1" };
  refused(root, [dep, dep], "SCHEMA_ID_DUPLICATE");
  refused(root, [{ ...dep, $ref: "urn:test:missing:1" }], "SCHEMA_REF_UNRESOLVED");
  refused({ ...root, $ref: "urn:test:dep:1#/$defs/missing" }, [dep], "SCHEMA_REF_UNRESOLVED");
  refused(root, [{ ...dep, unevaluatedProperties: false }], "SCHEMA_KEYWORD_UNSUPPORTED");
  refused(root, [{ ...dep, $defs: { nested: { $id: "urn:test:nested:1", type: "string" } } }], "SCHEMA_ID_INVALID");
});

test("registry supports explicit transitive references and document-local fragments", () => {
  const leaf = { $schema: dialect, $id: "urn:test:leaf:1", $defs: { text: { type: "string" } }, $ref: "#/$defs/text" };
  const middle = { $schema: dialect, $id: "urn:test:middle:1", $ref: leaf.$id + "#/$defs/text" };
  const root = { $schema: dialect, $id: "urn:test:root:1", $ref: middle.$id };
  const validator = createJsonSchemaValidator(root, { dependencySchemas: [middle, leaf] });
  assert.equal(validator.validate("yes").valid, true);
  assert.equal(validator.validate(3).valid, false);
});

test("registry bounds document count, depth, text bytes, nodes and cycles", () => {
  const root = { $schema: dialect, $id: "urn:test:root:1", type: "string" };
  const bounds = (deps: readonly unknown[]) => assert.throws(() => createJsonSchemaValidator(root, { dependencySchemas: deps }), (e: unknown) => e instanceof SchemaPolicyError && e.reasonCode === "SCHEMA_REGISTRY_BOUNDS");
  bounds(Array.from({ length: 33 }, (_, i) => ({ ...root, $id: `urn:test:dep:${i}` })));
  bounds([{ ...root, $id: "urn:test:big:1", description: "x".repeat(1048577) }]);
  let nested: unknown = { type: "string" };
  for (let i = 0; i < 65; i++) nested = { type: "array", items: nested };
  bounds([{ $schema: dialect, $id: "urn:test:deep:1", $defs: { nested } }]);
  bounds([{ ...root, $id: "urn:test:wide:1", enum: Array.from({ length: 100001 }, () => "a") }]);
  const cycle: Record<string, unknown> = { ...root, $id: "urn:test:cycle:1" }; cycle.items = cycle;
  assert.throws(() => createJsonSchemaValidator(root, { dependencySchemas: [cycle] }), (e: unknown) => e instanceof SchemaPolicyError && e.reasonCode === "SCHEMA_NOT_JSON");
});
