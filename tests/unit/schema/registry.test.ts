import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJsonSchemaValidator, createRegisteredJsonSchemaValidator, SchemaPolicyError } from "../../../src/schema/index.ts";

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

test("registered external schemas compose only exact in-memory metadata tuples", () => {
  const contribution = { $schema: dialect, $id: "urn:test:contribution:1", type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "local" } } };
  const root = { $schema: dialect, $id: "urn:test:root:1", type: "array", items: { $ref: "urn:test:contribution:1" } };
  const reference = { identity: "urn:test:schema:contribution:1", schemaIdentity: contribution.$id, repositoryPath: "schemas/contribution.schema.json", schemaFragment: "" };
  const options = { externalSchemas: [reference], registry: [{ ...reference, document: contribution }] };
  const validator = createRegisteredJsonSchemaValidator(root, options);
  assert.equal(validator.validate([{ kind: "local" }]).valid, true);
  assert.equal(validator.validate([{ kind: "provider" }]).valid, false);
  assert.throws(() => createRegisteredJsonSchemaValidator(root, { ...options, externalSchemas: [{ ...reference, schemaIdentity: "urn:test:missing:1" }] }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_REGISTRY_UNKNOWN");
  assert.throws(() => createRegisteredJsonSchemaValidator(root, { ...options, externalSchemas: [{ ...reference, schemaIdentity: "not an id" }] }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_ID_INVALID");
  assert.throws(() => createRegisteredJsonSchemaValidator(root, { ...options, registry: [{ ...reference, document: { ...contribution, $id: "urn:test:wrong:1" } }] }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_ID_INVALID");
  assert.throws(() => createRegisteredJsonSchemaValidator(root, { ...options, externalSchemas: [{ ...reference, repositoryPath: "../schema.json" }] }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_PATH_INVALID");
  assert.throws(() => createRegisteredJsonSchemaValidator(root, { ...options, externalSchemas: [{ ...reference, schemaFragment: "#/$defs/value" }] }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_FRAGMENT_INVALID");
  assert.throws(() => createRegisteredJsonSchemaValidator(root, { ...options, registry: [{ ...reference, document: contribution }, { ...reference, document: contribution }] }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_REGISTRY_DUPLICATE");
});

test("registered composition reuses an equivalent selected root document but refuses a conflicting root", () => {
  const registered = { $schema: dialect, $id: "urn:test:selected-root:1", type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "selected" } } };
  const root = { type: "object", properties: { kind: { const: "selected" } }, required: ["kind"], additionalProperties: false, $id: "urn:test:selected-root:1", $schema: dialect };
  const reference = { identity: "urn:test:schema:selected-root:1", schemaIdentity: registered.$id, repositoryPath: "schemas/selected-root.schema.json", schemaFragment: "" };
  const options = { externalSchemas: [reference], registry: [{ ...reference, document: registered }] };
  const validator = createRegisteredJsonSchemaValidator(root, options);
  assert.equal(validator.validate({ kind: "selected" }).valid, true);
  assert.equal(validator.validate({ kind: "other" }).valid, false);
  assert.throws(() => createRegisteredJsonSchemaValidator({ ...root, properties: { kind: { const: "conflict" } } }, options),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_REGISTRY_DUPLICATE");
  assert.throws(() => createJsonSchemaValidator(root, { dependencySchemas: [registered] }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_ID_DUPLICATE");
});

test("registered composition resolves actual local and call-result contribution fragments", () => {
  const local = JSON.parse(readFileSync("schemas/local-contribution.schema.json", "utf8"));
  const callResult = JSON.parse(readFileSync("schemas/call-result.schema.json", "utf8"));
  const localReference = { identity: "urn:test:schema:local:1", schemaIdentity: "urn:usf:local-contribution:1", repositoryPath: "schemas/local-contribution.schema.json", schemaFragment: "" };
  const providerReference = { identity: "urn:test:schema:provider-contribution:1", schemaIdentity: "urn:usf:call-result:1", repositoryPath: "schemas/call-result.schema.json", schemaFragment: "/$defs/contribution" };
  const providerRootReference = { identity: "urn:test:schema:provider-root:1", schemaIdentity: "urn:usf:call-result:1", repositoryPath: "schemas/call-result.schema.json", schemaFragment: "" };
  const root = { $schema: dialect, $id: "urn:test:ordinary-input:1", type: "array", items: { oneOf: [
    { $ref: "urn:usf:local-contribution:1" },
    { $ref: "urn:usf:call-result:1#/$defs/contribution" },
  ] } };
  const validator = createRegisteredJsonSchemaValidator(root, {
    externalSchemas: [localReference, providerReference, providerRootReference],
    registry: [
      { ...localReference, document: local },
      { ...providerReference, document: callResult },
      { ...providerRootReference, document: callResult },
    ],
  });
  assert.equal(validator.validate([]).valid, true);
  assert.equal(validator.validate([{}]).valid, false);
  const missing = { ...providerReference, schemaFragment: "/$defs/missing" };
  assert.throws(() => createRegisteredJsonSchemaValidator(root, {
    externalSchemas: [localReference, missing], registry: [{ ...localReference, document: local }, { ...missing, document: callResult }],
  }), (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_REF_UNRESOLVED");
});

test("registered composition accepts an authenticated descriptor dependency with external fragments", () => {
  const contribution = {
    $schema: dialect,
    $id: "urn:test:external-contribution:1",
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: { kind: { const: "external" } },
  };
  const descriptor = {
    $schema: dialect,
    $id: "urn:test:descriptor:1",
    $defs: { output: { $ref: contribution.$id } },
  };
  const reference = {
    identity: "urn:test:schema:external-contribution:1",
    schemaIdentity: contribution.$id,
    repositoryPath: "schemas/external-contribution.schema.json",
    schemaFragment: "",
  };
  const wrapper = {
    $schema: dialect,
    $id: "urn:test:wrapper:1",
    $ref: descriptor.$id + "#/$defs/output",
  };
  const validator = createRegisteredJsonSchemaValidator(wrapper, {
    externalSchemas: [reference],
    registry: [{ ...reference, document: contribution }],
    dependencySchemas: [descriptor],
  });
  assert.equal(validator.validate({ kind: "external" }).valid, true);
  assert.equal(validator.validate({ kind: "different" }).valid, false);
  assert.throws(() => createRegisteredJsonSchemaValidator(wrapper, {
    externalSchemas: [reference],
    registry: [{ ...reference, document: contribution }],
  }), (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_REF_UNRESOLVED");
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

/**
 * A refusal that names only where it looked leaves the reader to open the
 * schema and guess which identity the registry is missing. Naming the exact
 * unresolved reference is the difference between reading the reason and
 * reconstructing it: the schema path is shared by every module reference at
 * that position, while the identity is the one fact that distinguishes them.
 */
test("an unresolved reference names the exact identity, not only the schema path", () => {
  const root = { $schema: dialect, $id: "urn:test:root:1", type: "string" };
  const caught = (schema: unknown, dependencies: readonly unknown[]): SchemaPolicyError => {
    try {
      createJsonSchemaValidator(schema, { dependencySchemas: dependencies });
    } catch (error) {
      assert.ok(error instanceof SchemaPolicyError);
      return error;
    }
    throw new Error("the schema was expected to refuse");
  };

  const missingDependency = caught(root, [{ $schema: dialect, $id: "urn:test:dep:1", $ref: "urn:test:missing:1" }]);
  assert.equal(missingDependency.reasonCode, "SCHEMA_REF_UNRESOLVED");
  assert.equal(missingDependency.reference, "urn:test:missing:1");
  assert.match(missingDependency.message, /urn:test:missing:1/);

  const missingFragment = caught({ ...root, $ref: "urn:test:dep:1#/$defs/missing" }, [{ $schema: dialect, $id: "urn:test:dep:1", type: "string" }]);
  assert.equal(missingFragment.reasonCode, "SCHEMA_REF_UNRESOLVED");
  assert.equal(missingFragment.reference, "urn:test:dep:1#/$defs/missing");

  // A refusal that is not about a reference carries none, rather than an
  // empty string that would read as an unnamed one.
  const unsupported = caught(root, [{ $schema: dialect, $id: "urn:test:dep:1", unevaluatedProperties: false }]);
  assert.equal(unsupported.reasonCode, "SCHEMA_KEYWORD_UNSUPPORTED");
  assert.equal(unsupported.reference, null);
});
