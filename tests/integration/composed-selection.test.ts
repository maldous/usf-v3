import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadSemanticGraph } from "../../src/graph/index.ts";
import {
  deriveCapabilityImplementationNeeds,
  readImplementationConventions,
} from "../../src/providers/implementation-work.ts";

/**
 * Three selections, three results.
 *
 * Realising the foundation makes the foundation. Realising the product makes the
 * product. Realising both makes both, each capability landing in the repository
 * that owns it.
 *
 * The composed selection used to refuse outright: exactly one implementation
 * convention was required, so a selection that declared two was rejected before
 * it could describe work it was perfectly able to describe. Isolation and
 * composition are not in tension — what must never mix is where the results
 * land, and that is decided per capability from the graph rather than from the
 * shape of a path. Both conventions use the same path pattern, so a test that
 * checked paths would pass while the routing was wrong.
 */
const canonicalRoot = resolve(import.meta.dirname, "../..");
const foundationManifest = "graph/manifests/v3-delivery.json";
const productManifest = "graph/products/anqr/manifest.json";
const composedManifest = "graph/manifests/anqr-with-foundation.json";
const productRepository = "urn:anqr:repository:main";

function needsOf(manifest: string) {
  const graph = loadSemanticGraph(canonicalRoot, manifest);
  const conventions = readImplementationConventions(graph);
  return { conventions, needs: deriveCapabilityImplementationNeeds(graph, conventions) };
}

test("the foundation alone realises only the foundation", () => {
  const { conventions, needs } = needsOf(foundationManifest);
  assert.equal(conventions.length, 1);
  assert.equal(conventions[0]!.productRepository, null);
  assert.ok(needs.length > 0);
  assert.ok(needs.every((need) => need.sourceRepository === null));
  assert.equal(needs.filter((need) => need.capability.startsWith("urn:anqr:")).length, 0);
});

test("the product alone realises only the product", () => {
  const { conventions, needs } = needsOf(productManifest);
  assert.equal(conventions.length, 1);
  assert.equal(conventions[0]!.productRepository, productRepository);
  assert.ok(needs.length > 0);
  assert.ok(needs.every((need) => need.sourceRepository === productRepository));
  assert.equal(needs.filter((need) => need.capability.startsWith("urn:usf:")).length, 0);
});

test("the composed selection realises both, and is exactly their union", () => {
  const foundation = needsOf(foundationManifest).needs;
  const product = needsOf(productManifest).needs;
  const { conventions, needs } = needsOf(composedManifest);
  assert.equal(conventions.length, 2, "a composed selection declares both conventions");
  assert.equal(needs.length, foundation.length + product.length);
  const composed = new Set(needs.map((need) => need.capability));
  for (const need of [...foundation, ...product]) assert.ok(composed.has(need.capability));
});

test("in the composed selection each capability lands in the repository that owns it", () => {
  const { needs } = needsOf(composedManifest);
  const product = needs.filter((need) => need.capability.startsWith("urn:anqr:"));
  const foundation = needs.filter((need) => need.capability.startsWith("urn:usf:"));
  assert.ok(product.length > 0 && foundation.length > 0);
  assert.ok(product.every((need) => need.sourceRepository === productRepository),
    "a product capability must never be realised into the foundation");
  assert.ok(foundation.every((need) => need.sourceRepository === null),
    "a foundation capability must never be realised into a product repository");
});

test("routing survives the two conventions sharing a path pattern", () => {
  // Both declare src/capabilities/{domain}/{capability}.ts, so a path alone
  // cannot say which repository a result belongs in. Ownership must come from
  // the graph, and this asserts the ambiguity really exists rather than
  // assuming it.
  const { conventions, needs } = needsOf(composedManifest);
  const patterns = new Set(conventions.map((entry) => entry.modulePathPattern));
  assert.equal(patterns.size, 1, "the pattern collision this guards against must be real");
  const byPath = new Map<string, Set<string | null>>();
  for (const need of needs) {
    const owners = byPath.get(need.modulePath) ?? new Set<string | null>();
    owners.add(need.sourceRepository);
    byPath.set(need.modulePath, owners);
  }
  // No two capabilities may claim the same path, whichever repository they are in.
  for (const [path, owners] of byPath) assert.equal(owners.size, 1, `${path} is claimed by two repositories`);
});
