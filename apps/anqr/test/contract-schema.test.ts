import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createJsonSchemaValidator } from "../../../src/schema/index.ts";
import { analyzeDecodedPayload } from "../index.ts";

test("the published JSON schema validates both result variants and rejects planted contract defects", () => {
  const schema = JSON.parse(readFileSync(new URL("../contract.schema.json", import.meta.url), "utf8")) as Record<string, unknown>;
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.ok(Array.isArray(schema.oneOf));
  assert.equal(schema.oneOf.length, 2);
  const validator = createJsonSchemaValidator(schema);

  assert.equal(validator.validate(analyzeDecodedPayload("https://example.test")).valid, true);
  assert.equal(validator.validate(analyzeDecodedPayload(42)).valid, true);
  assert.equal(validator.validate({
    ...analyzeDecodedPayload("plain text"),
    unexpected: "not declared by the contract",
  }).valid, false);
  assert.equal(validator.validate({
    ok: true,
    contentType: "executable",
    label: "Executable",
    payloadLength: 1,
    urlDetails: null,
  }).valid, false);
  assert.equal(validator.validate({ ok: true, payloadLength: -1 }).valid, false);
  assert.equal(validator.validate({ ok: false, reason: "LEAKED" }).valid, false);
});
