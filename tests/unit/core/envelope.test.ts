import assert from "node:assert/strict";
import test from "node:test";
import { createEnvelope, envelopeIdentity } from "../../../src/core/envelope.ts";

test("envelope identity ignores timestamps but includes canonical payload", () => {
  const base = { kind: "work-packet", producer: { command: "usf work", version: "0.0.0" }, payload: { b: 2, a: 1 } };
  const first = createEnvelope({ ...base, createdAt: "2026-01-01T00:00:00.000Z" });
  const second = createEnvelope({ ...base, createdAt: "2027-01-01T00:00:00.000Z" });
  assert.equal(first.identity.artifactDigest, second.identity.artifactDigest);
  assert.equal(envelopeIdentity(first), first.identity.artifactDigest);
});
