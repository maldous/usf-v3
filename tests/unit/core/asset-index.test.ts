import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AssetIndexError,
  assetIndexReasonCodes,
  createFileAssetIndex,
  serializeFileAssetIndex,
  type AssetIndexEntry,
  type AssetIndexReasonCode,
} from "../../../src/core/asset-index.ts";

function sha256(bytes: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixtures(): AssetIndexEntry[] {
  return [
    {
      contentDigest: sha256("beta launch copy"),
      id: "urn:test:asset:beta-launch-copy",
      mediaType: "text/markdown",
      path: "tests/fixtures/assets/beta/launch.md",
      product: "urn:test:product:beta",
    },
    {
      contentDigest: sha256("alpha hero"),
      id: "urn:test:asset:alpha-hero",
      mediaType: "image/svg+xml",
      path: "tests/fixtures/assets/alpha/hero.svg",
      product: "urn:test:product:alpha",
    },
    {
      contentDigest: sha256("alpha tokens"),
      id: "urn:test:asset:alpha-tokens",
      mediaType: "application/json",
      path: "tests/fixtures/assets/alpha/tokens.json",
      product: "urn:test:product:alpha",
    },
  ];
}

function expectRefusal(input: unknown, reasonCode: AssetIndexReasonCode): void {
  assert.throws(
    () => createFileAssetIndex(input),
    (error: unknown) => {
      assert.ok(error instanceof AssetIndexError);
      assert.equal(error.reasonCode, reasonCode);
      return true;
    },
  );
}

test("positive multi-product entries have canonical bytes and identity independent of input order", () => {
  const forward = fixtures();
  const reversed = [...forward].reverse();
  const first = createFileAssetIndex(forward);
  const second = createFileAssetIndex(reversed);

  assert.deepEqual(first, second);
  assert.equal(serializeFileAssetIndex(forward), serializeFileAssetIndex(reversed));
  assert.deepEqual(Buffer.from(serializeFileAssetIndex(forward)), Buffer.from(serializeFileAssetIndex(reversed)));
  assert.deepEqual(first.entries.map((entry) => entry.id), [
    "urn:test:asset:alpha-hero",
    "urn:test:asset:alpha-tokens",
    "urn:test:asset:beta-launch-copy",
  ]);
  assert.equal(first.contentDigest, sha256(JSON.stringify({ entries: first.entries, schema: first.schema })));
  assert.equal(serializeFileAssetIndex(forward).endsWith("\n"), true);
});

test("construction is immutable metadata-only work with no asset or database dependency", () => {
  const entries = fixtures();
  const before = structuredClone(entries);
  for (const entry of entries) Object.freeze(entry);
  Object.freeze(entries);

  const index = createFileAssetIndex(entries);
  assert.deepEqual(entries, before);
  assert.equal(Object.isFrozen(index), true);
  assert.equal(Object.isFrozen(index.entries), true);
  assert.equal(index.entries.every(Object.isFrozen), true);
  assert.equal(index.entries.every((entry) => entry.path.includes("tests/fixtures/assets/")), true);
});

test("duplicate semantic identifiers and paths fail with distinct stable reasons", () => {
  const duplicateId = fixtures();
  duplicateId[1] = { ...duplicateId[1]!, id: duplicateId[0]!.id };
  expectRefusal(duplicateId, assetIndexReasonCodes.IDENTIFIER_DUPLICATE);

  const duplicatePath = fixtures();
  duplicatePath[1] = { ...duplicatePath[1]!, path: duplicatePath[0]!.path };
  expectRefusal(duplicatePath, assetIndexReasonCodes.PATH_DUPLICATE);
});

test("non-canonical and alternate-spelling semantic identifiers fail closed", () => {
  for (const id of [
    "asset:alpha",
    "https://example.test/asset",
    "urn:test:",
    "urn:x:a",
    "urn:Test:asset",
    "urn:test:asset with space",
    "urn:test:a%",
    "urn:test:a%GG",
    "urn:test:a%2F",
    "urn:test:a%2f",
    "urn:test:a?query",
    "urn:test:a#fragment",
    "urn:test:a#x#y",
  ]) {
    const entries = fixtures();
    entries[0] = { ...entries[0]!, id };
    expectRefusal(entries, assetIndexReasonCodes.IDENTIFIER_INVALID);
  }
});

test("absolute, traversal, control and non-canonical paths fail with one stable reason", () => {
  for (const path of [
    "/outside/hero.svg",
    "../outside/hero.svg",
    "tests/../outside/hero.svg",
    "./tests/fixtures/assets/hero.svg",
    "tests//fixtures/assets/hero.svg",
    "tests\\fixtures\\assets\\hero.svg",
    ".usf/index.json",
    ".env",
  ]) {
    const entries = fixtures();
    entries[0] = { ...entries[0]!, path };
    expectRefusal(entries, assetIndexReasonCodes.PATH_INVALID);
  }
});

test("media types are bounded canonical lowercase type/subtype values", () => {
  for (const mediaType of [
    "",
    "Application/JSON",
    "text/plain; charset=utf-8",
    "text /plain",
    "text/",
    "/plain",
    "text/plain\n",
    "application/" + "a".repeat(64),
  ]) {
    const entries = fixtures();
    entries[0] = { ...entries[0]!, mediaType };
    expectRefusal(entries, assetIndexReasonCodes.MEDIA_TYPE_INVALID);
  }
});

test("only exact lowercase sha256 content digests are accepted", () => {
  for (const contentDigest of [
    "0".repeat(64),
    "sha256:" + "A".repeat(64),
    "sha256:" + "a".repeat(63),
    "sha512:" + "a".repeat(64),
    "sha256:not-a-content-digest",
  ]) {
    const entries = fixtures();
    entries[0] = { ...entries[0]!, contentDigest } as AssetIndexEntry;
    expectRefusal(entries, assetIndexReasonCodes.CONTENT_DIGEST_INVALID);
  }
});

test("entry shape and aggregate size are bounded before canonicalization", () => {
  expectRefusal([{ ...fixtures()[0]!, unexpected: true }], assetIndexReasonCodes.ENTRY_INVALID);
  expectRefusal(new Array(1), assetIndexReasonCodes.ENTRY_INVALID);
  expectRefusal(new Array(10_001).fill(fixtures()[0]), assetIndexReasonCodes.TOO_LARGE);
});
