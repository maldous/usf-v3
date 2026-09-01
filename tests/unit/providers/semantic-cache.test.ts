import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  excludedFromCacheIdentity, lookupSemanticResult, recordSemanticReuse,
  semanticCacheKey, semanticCacheStatistics, storeSemanticResult,
  type SemanticWorkIdentity,
} from "../../../src/providers/semantic-cache.ts";

function identity(overrides: Partial<SemanticWorkIdentity> = {}): SemanticWorkIdentity {
  return Object.freeze({
    requirement: "urn:usf:delivery-artefact:openapicontract",
    inputDigests: Object.freeze([`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`]),
    dependencyResultDigests: Object.freeze([`sha256:${"c".repeat(64)}`]),
    acceptanceRequirements: Object.freeze(["urn:usf:delivery-facet:openapicontracts"]),
    requiredCapabilities: Object.freeze(["reasoning"]),
    outputContract: "urn:usf:artefact-kind:contract",
    policyDigest: `sha256:${"d".repeat(64)}`,
    requiredProvider: null,
    requiredModel: null,
    ...overrides,
  });
}
const scratch = () => mkdtemp(join(tmpdir(), "usf-cache-"));

test("identity determines the key, and input ordering does not", () => {
  assert.equal(semanticCacheKey(identity()), semanticCacheKey(identity()));
  const reordered = identity({
    inputDigests: Object.freeze([`sha256:${"b".repeat(64)}`, `sha256:${"a".repeat(64)}`]),
  });
  assert.equal(semanticCacheKey(reordered), semanticCacheKey(identity()));
  // A duplicate input is not a different requirement.
  const duplicated = identity({
    inputDigests: Object.freeze([`sha256:${"a".repeat(64)}`, `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`]),
  });
  assert.equal(semanticCacheKey(duplicated), semanticCacheKey(identity()));
});

test("every semantic input change moves the key, so a stale result cannot be returned", () => {
  const base = semanticCacheKey(identity());
  const changes: ReadonlyArray<readonly [string, Partial<SemanticWorkIdentity>]> = [
    ["requirement", { requirement: "urn:usf:delivery-artefact:graphqlcontract" }],
    ["an authoritative input", { inputDigests: [`sha256:${"e".repeat(64)}`] }],
    ["a dependency result", { dependencyResultDigests: [`sha256:${"f".repeat(64)}`] }],
    ["an acceptance requirement", { acceptanceRequirements: ["urn:usf:delivery-facet:other"] }],
    ["a required capability", { requiredCapabilities: ["tool-call"] }],
    ["the output contract", { outputContract: "urn:usf:artefact-kind:schema" }],
    ["the policy", { policyDigest: `sha256:${"9".repeat(64)}` }],
  ];
  for (const [what, override] of changes) {
    assert.notEqual(semanticCacheKey(identity(override)), base, `${what} must move the key`);
  }
});

test("a result is reusable across providers unless the requirement names one", () => {
  // Provider and model are absent from identity, so two providers share a key.
  assert.equal(semanticCacheKey(identity()), semanticCacheKey(identity()));
  assert.ok(excludedFromCacheIdentity.includes("provider identity"));
  assert.ok(excludedFromCacheIdentity.includes("model identity"));
  assert.ok(excludedFromCacheIdentity.includes("cycle identity"));
  assert.ok(excludedFromCacheIdentity.includes("transaction identity"));

  // When the requirement genuinely demands a provider, it participates.
  const pinned = semanticCacheKey(identity({ requiredProvider: "groq" }));
  assert.notEqual(pinned, semanticCacheKey(identity()));
  assert.notEqual(pinned, semanticCacheKey(identity({ requiredProvider: "openrouter" })));
});

test("a stored result is found again, and reuse is counted separately from production", async () => {
  const root = await scratch();
  const miss = await lookupSemanticResult(root, identity());
  assert.equal(miss.hit, false);
  assert.equal(miss.evaluated, true, "an absent entry is never ambiguous with an unevaluated lookup");
  assert.equal(miss.refusal, null);

  const stored = await storeSemanticResult(root, identity(), "openapi: 3.1.0", `sha256:${"1".repeat(64)}`);
  assert.equal(stored.reuseCount, 0);
  assert.deepEqual(stored.executionEvidenceDigests, [`sha256:${"1".repeat(64)}`]);

  const hit = await lookupSemanticResult(root, identity());
  assert.equal(hit.hit, true);
  assert.equal(hit.entry?.text, "openapi: 3.1.0");
  const reused = await recordSemanticReuse(root, hit.entry!);
  assert.equal(reused.reuseCount, 1);
  const stats = await semanticCacheStatistics(root);
  assert.equal(stats.entryCount, 1);
  assert.equal(stats.totalReuse, 1);
});

test("one cached result accumulates several execution evidence records", async () => {
  const root = await scratch();
  await storeSemanticResult(root, identity(), "result", `sha256:${"1".repeat(64)}`);
  const second = await storeSemanticResult(root, identity(), "result", `sha256:${"2".repeat(64)}`);
  assert.deepEqual(second.executionEvidenceDigests, [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`]);
  // Evidence is provenance, not identity: it never changes the key.
  assert.equal(second.key, semanticCacheKey(identity()));
});

test("a changed input yields a miss rather than the previous result", async () => {
  const root = await scratch();
  await storeSemanticResult(root, identity(), "computed against the old input", null);
  const moved = identity({ inputDigests: [`sha256:${"e".repeat(64)}`] });
  const lookup = await lookupSemanticResult(root, moved);
  assert.equal(lookup.hit, false, "fails closed when a semantic input changes");
  assert.equal(lookup.entry, null);
});

test("a hand-edited entry is refused rather than reused", async () => {
  const root = await scratch();
  const stored = await storeSemanticResult(root, identity(), "authentic", null);
  const path = resolve(root, ".usf", "semantic-cache", `${stored.key.slice("sha256:".length)}.json`);

  // Body edited while the key is kept: the result digest no longer matches.
  const tampered = { ...JSON.parse(await readFile(path, "utf8")) as object, text: "substituted" };
  await writeFile(path, JSON.stringify(tampered));
  const bodyEdited = await lookupSemanticResult(root, identity());
  assert.equal(bodyEdited.hit, false);
  assert.equal(bodyEdited.refusal, "identity-mismatch");

  // Identity edited while the filename is kept: the recomputed key disagrees.
  const restored = await storeSemanticResult(root, identity(), "authentic", null);
  const entry = JSON.parse(await readFile(path, "utf8")) as { identity: SemanticWorkIdentity };
  await writeFile(path, JSON.stringify({ ...entry, identity: { ...entry.identity, requirement: "urn:usf:other" } }));
  const identityEdited = await lookupSemanticResult(root, identity());
  assert.equal(identityEdited.hit, false);
  assert.equal(identityEdited.refusal, "identity-mismatch");
  assert.equal(restored.key, stored.key);
});

test("a cache-version change invalidates every entry", async () => {
  const root = await scratch();
  const stored = await storeSemanticResult(root, identity(), "result", null);
  const path = resolve(root, ".usf", "semantic-cache", `${stored.key.slice("sha256:".length)}.json`);
  const entry = JSON.parse(await readFile(path, "utf8")) as object;
  await writeFile(path, JSON.stringify({ ...entry, cacheVersion: "0" }));
  const lookup = await lookupSemanticResult(root, identity());
  assert.equal(lookup.hit, false);
  assert.equal(lookup.refusal, "cache-version-changed");
});
