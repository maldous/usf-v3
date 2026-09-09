import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createJsonSchemaValidator, SchemaPolicyError } from "../../../src/schema/index.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const digest = `sha256:${"a".repeat(64)}`;
const dialect = "https://json-schema.org/draft/2020-12/schema";

function schemaFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return schemaFiles(path);
      return entry.isFile() && entry.name.endsWith(".schema.json") ? [path] : [];
    })
    .sort();
}

function readSchema(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}


test("every repository JSON schema compiles deterministically through the narrow profile", () => {
  const files = [
    ...schemaFiles(join(repositoryRoot, "schemas")),
    ...schemaFiles(join(repositoryRoot, "apps")),
  ].sort();
  const names = files.map((path) => relative(repositoryRoot, path));
  assert.equal(names.length > 0, true);
  assert.deepEqual(names, [...names].sort());

  const compile = () => files.map((path) => ({
    path: relative(repositoryRoot, path),
    schemaId: createJsonSchemaValidator(readSchema(path), (() => {
      const relativePath = relative(repositoryRoot, path);
      if (relativePath === "schemas/cli-transition-interrogation.schema.json") {
        return {
          dependencySchemas: [
            "schemas/cli-transition-descriptor.schema.json",
            "schemas/cli-operational-support.schema.json",
            "schemas/local-contribution.schema.json",
            "schemas/call-result.schema.json",
            "schemas/cli-parallel-safety.schema.json",
            "schemas/cli-parser-coverage.schema.json",
          ].map((dependency) => readSchema(join(repositoryRoot, dependency))),
        };
      }
      if (relativePath === "schemas/cli-transition-descriptor.schema.json") {
        return {
          dependencySchemas: [
            "schemas/cli-operational-support.schema.json",
            "schemas/local-contribution.schema.json",
            "schemas/call-result.schema.json",
            "schemas/cli-parallel-safety.schema.json",
            "schemas/cli-parser-coverage.schema.json",
          ].map((dependency) => readSchema(join(repositoryRoot, dependency))),
        };
      }
      return {};
    })()).schemaId,
  }));
  assert.deepEqual(compile(), compile());
});

test("external references and unapproved schema capabilities fail before compilation", () => {
  const dialect = "https://json-schema.org/draft/2020-12/schema";
  assert.throws(
    () => createJsonSchemaValidator({ $schema: dialect, $ref: "https://schemas.example/remote.json" }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_REF_EXTERNAL",
  );
  assert.throws(
    () => createJsonSchemaValidator({ $schema: dialect, type: "object", unevaluatedProperties: false }),
    (error: unknown) => error instanceof SchemaPolicyError && error.reasonCode === "SCHEMA_KEYWORD_UNSUPPORTED",
  );
});

test("compiled validators cannot become stale through dependency mutation", () => {
  const dependency = {
    $schema: dialect,
    $id: "urn:test:validator-dependency:1",
    $defs: { value: { type: "string", const: "before" } },
  };
  const root = {
    $schema: dialect,
    $id: "urn:test:validator-root:1",
    $ref: "urn:test:validator-dependency:1#/$defs/value",
  };
  const validator = createJsonSchemaValidator(root, { dependencySchemas: [dependency] });
  dependency.$defs.value.const = "after";

  assert.equal(validator.validate("before").valid, true);
  assert.equal(validator.validate("after").valid, false);

  const changed = createJsonSchemaValidator(root, {
    dependencySchemas: [{
      ...dependency,
      $defs: { value: { type: "string", const: "after" } },
    }],
  });
  assert.equal(changed.validate("before").valid, false);
  assert.equal(changed.validate("after").valid, true);
});

test("array cardinality bounds are admitted and report stable failures", () => {
  const validator = createJsonSchemaValidator({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "array",
    minItems: 2,
    maxItems: 3,
    items: { type: "string" },
  });

  assert.equal(validator.validate(["one", "two"]).valid, true);
  const tooShort = validator.validate(["one"]);
  const tooLong = validator.validate(["one", "two", "three", "four"]);
  assert.equal(tooShort.valid, false);
  assert.equal(tooLong.valid, false);
  if (!tooShort.valid) assert.deepEqual(tooShort.errors.map(({ keyword, message }) => ({ keyword, message })), [
    { keyword: "minItems", message: "must contain at least the minimum number of items" },
  ]);
  if (!tooLong.valid) assert.deepEqual(tooLong.errors.map(({ keyword, message }) => ({ keyword, message })), [
    { keyword: "maxItems", message: "must not contain more than the maximum number of items" },
  ]);
});

test("envelope validation rejects additional properties and malformed digests with stable bounded errors", () => {
  const validator = createJsonSchemaValidator(readSchema(join(repositoryRoot, "schemas/envelope.schema.json")), { maxErrors: 2 });
  const envelope = {
    schema: "urn:usf:envelope:1",
    kind: "work-packet",
    producer: { command: "usf work", version: "0.0.0" },
    identity: { artifactDigest: digest, chainDigest: digest },
    semantic: { globalRevisionDigest: null, dependencyDigest: digest, dependencies: [] },
    repository: { carrierCommit: null, carrierTree: null, pathDependencies: [] },
    inputs: [],
    payload: {},
    metrics: {},
    claims: [],
    nonclaims: [],
    createdAt: "2026-08-30T00:00:00.000Z",
  };

  assert.equal(validator.validate(envelope).valid, true);
  const invalid = validator.validate({
    ...envelope,
    unexpected: true,
    identity: { ...envelope.identity, artifactDigest: "sha256:NOT-A-DIGEST" },
  });
  assert.equal(invalid.valid, false);
  if (invalid.valid) return;
  assert.deepEqual(invalid.errors.map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message })), [
    { instancePath: "", keyword: "additionalProperties", message: "unexpected property" },
    { instancePath: "/identity/artifactDigest", keyword: "pattern", message: "must match the required pattern" },
  ]);
  assert.equal(invalid.truncatedErrors, 0);
  assert.deepEqual(validator.validate({ ...envelope, unexpected: true, identity: {} }), validator.validate({ ...envelope, unexpected: true, identity: {} }));
});

test("candidate validation distinguishes resolved fixtures from required-field and status defects", async () => {
  const { proposalBasis } = await import("../../fixtures/proposal-packet.ts");
  const validator = createJsonSchemaValidator(readSchema(join(repositoryRoot, "schemas/candidate.schema.json")));
  const basis = proposalBasis();
  const candidate = {
    schema: "urn:usf:candidate:1",
    kind: "candidate",
    status: "resolved",
    basis,
    identity: { artifactDigest: digest, basisDigest: basis.basisDigest },
    payload: { operations: [] },
    lineage: { acceptedContributionDigests: [], rejected: [] },
  };

  assert.equal(validator.validate(candidate).valid, true);
  assert.equal(validator.validate({ ...candidate, status: "model-approved" }).valid, false);
  const { lineage: _lineage, ...missingLineage } = candidate;
  const missing = validator.validate(missingLineage);
  assert.equal(missing.valid, false);
  if (!missing.valid) assert.equal(missing.errors.some((issue) => issue.keyword === "required"), true);
});
