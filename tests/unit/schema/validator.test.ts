import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createJsonSchemaValidator, SchemaPolicyError } from "../../../src/schema/index.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const digest = `sha256:${"a".repeat(64)}`;

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
    schemaId: createJsonSchemaValidator(readSchema(path)).schemaId,
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

test("candidate validation distinguishes resolved fixtures from required-field and status defects", () => {
  const validator = createJsonSchemaValidator(readSchema(join(repositoryRoot, "schemas/candidate.schema.json")));
  const candidate = {
    schema: "urn:usf:candidate:1",
    kind: "candidate",
    status: "resolved",
    identity: { artifactDigest: digest },
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
