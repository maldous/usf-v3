import assert from "node:assert/strict";
import test from "node:test";

import { loadSemanticGraph } from "../../../src/graph/index.ts";
import {
  deriveCapabilityImplementationNeeds,
  deriveConformancePrompt,
  deriveImplementationPrompt,
  readImplementationConventions,
} from "../../../src/providers/implementation-work.ts";
import { dispatchBurstSize, rotationGroup } from "../../../src/providers/route-universe.ts";
import { resolve } from "node:path";

/**
 * Provider prompt caching is prefix caching: it pays only when consecutive
 * requests to the same model share a long byte-identical prefix. Measured
 * before this layout, prompts diverged at line two and per-unit provider
 * rotation meant a model was never revisited inside its cache window, so cache
 * reads were under half a percent of input. These tests pin the two properties
 * that make caching possible; whether a provider honours them stays a measured
 * number, never an assumption.
 */
const canonicalRoot = resolve(import.meta.dirname, "../../..");

function sharedPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

test("implementation prompts for different capabilities share a long stable prefix", () => {
  const graph = loadSemanticGraph(canonicalRoot, "graph/products/anqr/manifest.json");
  const conventions = readImplementationConventions(graph);
  const needs = deriveCapabilityImplementationNeeds(graph, conventions);
  assert.ok(needs.length >= 2);
  const context = Object.freeze({ existingTarget: null, moduleSource: null, siblingModule: null });
  const first = deriveImplementationPrompt(needs[0]!, conventions[0]!, context);
  const second = deriveImplementationPrompt(needs[1]!, conventions[0]!, context);
  const shared = sharedPrefixLength(first, second);
  assert.ok(shared >= 1_500,
    `units of one stage must share a cacheable prefix; shared ${shared} characters`);
  // And the volatile blocks stay out of it: the capability name appears only
  // after the shared prefix ends.
  assert.ok(first.indexOf(needs[0]!.canonicalName) >= shared - needs[0]!.canonicalName.length);
});

test("conformance prompts keep the module source out of the shared prefix", () => {
  const graph = loadSemanticGraph(canonicalRoot, "graph/products/anqr/manifest.json");
  const conventions = readImplementationConventions(graph);
  const needs = deriveCapabilityImplementationNeeds(graph, conventions);
  const moduleA = "export function alpha(): number { return 1; }";
  const moduleB = "export function beta(): string { return 'two'; }";
  const first = deriveConformancePrompt(needs[0]!, moduleA, "../../../src/a.ts");
  const second = deriveConformancePrompt(needs[1]!, moduleB, "../../../src/b.ts");
  const shared = sharedPrefixLength(first, second);
  assert.ok(shared >= 1_000, `shared ${shared} characters`);
  assert.ok(first.indexOf(moduleA) > shared, "the module source must come after the shared prefix");
});

test("rotation advances per group so a model sees a burst, and spread survives", () => {
  // Within one group every unit gets the same rotation, so the same top
  // candidate serves consecutive requests inside its cache window.
  for (let ordinal = 0; ordinal < dispatchBurstSize; ordinal += 1) {
    assert.equal(rotationGroup(ordinal), 0);
  }
  // Across groups the rotation still advances, so no provider absorbs the
  // whole cycle and a quota failure stays bounded to bursts.
  assert.equal(rotationGroup(dispatchBurstSize), 1);
  assert.equal(rotationGroup(dispatchBurstSize * 3 + 1), 3);
  // Degenerate inputs stay safe.
  assert.equal(rotationGroup(-1), 0);
  assert.equal(rotationGroup(5, 0), 5);
});
