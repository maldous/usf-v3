import assert from "node:assert/strict";
import test from "node:test";

// This test intentionally imports only the package's declared public entrypoint.
import { analyzeDecodedPayload } from "@anqr/decoded-payload-analysis";

test("public entrypoint provides the decoded-payload analysis contract", () => {
  assert.deepEqual(analyzeDecodedPayload("tel:+611234"), {
    ok: true,
    contentType: "tel",
    label: "Phone Number",
    payloadLength: 11,
    urlDetails: null,
  });
});
