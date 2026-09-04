import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Corpus-wide assurances for the semantic authority path, at repository scope.
 *
 * These two properties are about the whole tracked corpus, so they cannot be
 * proved inside a confined candidate: a candidate materialises only its
 * declared closure, and for this lane that is one manifest and no graph sources.
 * A validation asserting them there would fail on an absence the confinement
 * itself created, and a validation that tolerated the failure would report a
 * pass over a tree it never read -- which is the more dangerous of the two,
 * because missing evidence would become indistinguishable from satisfied
 * evidence.
 *
 * So they live here, where the tree is real, and the graph-selected validation
 * next door proves only what its own closure carries.
 */

test("every operational graph source satisfies the declared source profile", () => {
  // bootstrap-nquads-v1: an explicit named graph, IRI subject, predicate and
  // graph, and no blank node. This is the requirement the corpus enforced
  // structurally while stating it only inside the mining graph.
  const graphDirectory = join(repositoryRoot, "graph");
  const sources: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(graphDirectory, relative), { withFileTypes: true })) {
      const next = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".nq")) sources.push(next);
    }
  };
  walk("");
  assert.ok(sources.length > 0, "the corpus has sources");
  for (const source of sources) {
    if (source.includes("fixtures/")) continue;
    const text = readFileSync(join(graphDirectory, source), "utf8");
    for (const [index, line] of text.split("\n").entries()) {
      if (line.trim() === "") continue;
      assert.ok(line.startsWith("<"), `${source}:${index + 1} subject must be an IRI`);
      assert.match(line, /<[^>]+> \.$/u, `${source}:${index + 1} must name its graph`);
      assert.equal(/(^|\s)_:/u.test(line), false, `${source}:${index + 1} must carry no blank node`);
    }
  }
});

test("the pinned graph sources this lane deliberately did not touch are still present", () => {
  // Both are pinned in an immutable historical-carrier record with
  // observedCurrentnessDisposition exact-present. Removing the implementation
  // must not quietly take them with it; retiring a pinned carrier member is a
  // separate declared act.
  for (const path of ["graph/semantic-recovery.nq", "graph/foundation.nq",
    "graph/manifests/self-host-semantic-recovery.json"]) {
    const absolute = join(repositoryRoot, path);
    assert.equal(existsSync(absolute), true, path);
    assert.ok(statSync(absolute).size > 0, `${path} is non-empty`);
  }
});
