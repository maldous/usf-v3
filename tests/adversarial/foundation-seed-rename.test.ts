import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveProfileClosure } from "../../src/commands/profile.ts";

/**
 * Adversarial proof for the foundation dependency seed rename.
 *
 * `coreDependencySeed` named the foundation "core", which the naming standard
 * retires for it. The predicate is referenced by every profile-to-foundation
 * binding including released ones, so it is migrated with a **declared alias**
 * rather than mutated silently: the reader prefers the canonical name and
 * accepts the retired one, so the graph can move in a separate step without a
 * moment where the reader and the graph disagree.
 *
 * The property that matters most is the one an alias usually breaks. Two names
 * for one dependency set is exactly the ambiguity the alias exists to avoid, so
 * a binding declaring both is refused rather than merged. An alias that
 * silently unioned them would be worse than no alias, because the resulting
 * closure would depend on which predicate someone happened to use.
 */

const BINDING = "urn:fixture:binding:1";
const SEED_A = "urn:fixture:seed:a";
const SEED_B = "urn:fixture:seed:b";
const GRAPH = "urn:fixture:graph:1";

interface Quad { readonly subject: string; readonly predicate: string; readonly object: string; readonly graph: string }

const quad = (subject: string, predicate: string, object: string): Quad =>
  ({ subject, predicate: `urn:usf:predicate:${predicate}`, object, graph: GRAPH });

const graphOf = (quads: readonly Quad[]): never =>
  Object.freeze({ quads: Object.freeze([...quads]) }) as never;

/** A foundation carrying both seeds, so an unresolved seed is never the cause. */
const foundation = graphOf([
  quad(SEED_A, "type", "urn:usf:type:SemanticContract"),
  quad(SEED_B, "type", "urn:usf:type:SemanticContract"),
]);

test("a binding declaring only the canonical predicate resolves", () => {
  const product = graphOf([quad(BINDING, "foundationDependencySeed", SEED_A)]);
  const closure = deriveProfileClosure(product, foundation, BINDING);
  assert.deepEqual([...closure.seeds], [SEED_A]);
});

test("a binding declaring only the retired predicate resolves identically", () => {
  // The whole point of the alias: a graph written before the migration keeps
  // working, byte for byte in its result.
  const canonical = deriveProfileClosure(graphOf([quad(BINDING, "foundationDependencySeed", SEED_A)]), foundation, BINDING);
  const retired = deriveProfileClosure(graphOf([quad(BINDING, "coreDependencySeed", SEED_A)]), foundation, BINDING);
  assert.deepEqual(retired, canonical, "the alias must produce the same closure, not a similar one");
});

test("a binding declaring both predicates is refused, not merged", () => {
  const product = graphOf([
    quad(BINDING, "foundationDependencySeed", SEED_A),
    quad(BINDING, "coreDependencySeed", SEED_B),
  ]);
  assert.throws(() => deriveProfileClosure(product, foundation, BINDING), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROFILE_SEED_PREDICATE_AMBIGUOUS");
    return true;
  }, "a union would make the closure depend on which predicate someone happened to use");
});

test("a binding declaring neither predicate is unresolved as before", () => {
  const product = graphOf([quad(BINDING, "type", "urn:usf:type:ProfileFoundationBinding")]);
  const closure = deriveProfileClosure(product, foundation, BINDING);
  const seeds = [...closure.seeds];
  assert.deepEqual(seeds, [], "no seeds, and no invented ones");
});

test("a seed absent from the foundation is still refused under either name", () => {
  // The alias must not weaken the check it feeds. An unresolved seed is a
  // defect whichever predicate declared it.
  const empty = graphOf([]);
  for (const predicate of ["foundationDependencySeed", "coreDependencySeed"] as const) {
    assert.throws(
      () => deriveProfileClosure(graphOf([quad(BINDING, predicate, SEED_A)]), empty, BINDING),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "PROFILE_SEED_UNRESOLVED");
        return true;
      },
      `${predicate} must still resolve its seeds against the foundation`,
    );
  }
});
