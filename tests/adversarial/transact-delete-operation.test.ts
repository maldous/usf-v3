import assert from "node:assert/strict";
import { test } from "node:test";

import { graphSourceDenominator } from "../../src/commands/transact.ts";

/**
 * Adversarial proof for the delete operation.
 *
 * It exists because a graph source could not be moved. `usf transact` admitted
 * only append, write and derive, so a rename had to be two transactions — and
 * the postimage validator, correctly, refused the state in between, where both
 * the old and the new copy existed and every identity in the file was typed in
 * two graphs. The gap was real and the refusal was right; what was missing was
 * a way to say "and this one goes".
 *
 * The property under test is the same one the Priority 1 repair established for
 * creation, extended to removal: **the validated denominator is the resulting
 * corpus.** Existing, plus created, minus deleted. Omitting the subtraction
 * would validate a corpus containing a source the transaction is about to
 * remove, which is the same defect as omitting the addition, in the other
 * direction.
 */

const discovered = ["foundation.nq", "products/anqr/profile.nq", "v3-convention.nq"] as const;

test("the denominator is existing plus created minus deleted", () => {
  assert.deepEqual(
    graphSourceDenominator([...discovered], ["graph/products/anqr/new-source.nq"], ["graph/foundation.nq"]),
    ["products/anqr/new-source.nq", "products/anqr/profile.nq", "v3-convention.nq"],
  );
});

test("a move leaves exactly one copy in the denominator", () => {
  // The case that motivated the operation: one transaction writes the new path
  // and deletes the old one, and what gets validated is the corpus that will
  // exist rather than a transient with both.
  const moved = graphSourceDenominator(
    [...discovered],
    ["graph/products/anqr/decoded-payload.nq"],
    ["graph/anqr-first-slice.nq"],
  );
  assert.ok(moved.includes("products/anqr/decoded-payload.nq"), "the new path is counted");
  assert.ok(!moved.includes("anqr-first-slice.nq"), "the old path is not");
  assert.equal(new Set(moved).size, moved.length, "and nothing is counted twice");
});

test("deleting a source the corpus does not have changes nothing", () => {
  assert.deepEqual(
    graphSourceDenominator([...discovered], [], ["graph/never-existed.nq"]),
    [...discovered].sort(),
  );
});

test("a delete of a path also written in the same transaction removes it", () => {
  // Last operation on a path wins. Writing then deleting is a delete, which is
  // what makes "write the new bytes, then decide against them" expressible
  // without leaving the file behind.
  const both = graphSourceDenominator([...discovered], ["graph/temp.nq"], ["graph/temp.nq"]);
  assert.ok(!both.includes("temp.nq"));
});

test("deletions outside the graph tree do not touch the graph denominator", () => {
  // A transaction may delete a document or a schema. Those are not graph
  // sources and must not silently change what the corpus is.
  assert.deepEqual(
    graphSourceDenominator([...discovered], [], ["docs/whatever.md", "schemas/a.schema.json"]),
    [...discovered].sort(),
  );
});

test("a deleted fixture is ignored, exactly as a created one is", () => {
  // Fixtures are synthetic test input and are excluded from the corpus in both
  // directions, or the exclusion would be asymmetric and the asymmetry would
  // show up as a phantom deletion.
  assert.deepEqual(
    graphSourceDenominator([...discovered], [], ["graph/fixtures/synthetic.nq"]),
    [...discovered].sort(),
  );
});

test("the denominator is stable, sorted and duplicate-free under every combination", () => {
  const result = graphSourceDenominator(
    ["b.nq", "a.nq", "b.nq"],
    ["graph/c.nq", "graph/a.nq"],
    ["graph/b.nq"],
  );
  assert.deepEqual(result, ["a.nq", "c.nq"]);
  assert.deepEqual([...result].sort(), result, "sorted");
  assert.equal(new Set(result).size, result.length, "duplicate-free");
});

/**
 * The three refusals a delete must produce -- a null preimage, content on a
 * delete, and a stale preimage -- are exercised against the real command in the
 * primary tree after integration rather than here. A candidate workspace
 * materialises only this work's declared closure, so it has no bin/usf to spawn,
 * and a subprocess test written here would pass by not running.
 */
