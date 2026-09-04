import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Adversarial proof that one ingestion path exists and the mechanism that
 * discovered that requirement does not.
 *
 * The requirement being proved here was found inside the thing it condemns. A
 * legacy-mining exercise had, among twenty-one requirements, one saying to unify
 * or retire the second semantic ingestion path rather than maintain two truths.
 * That second path was still there: `src/semantic/store.ts` and its siblings,
 * reachable from no declared root, importing three production dependencies that
 * existed for nothing else. So the requirement and its violation surfaced
 * together.
 *
 * These tests read the tracked tree rather than importing anything, for the
 * reason absence tests usually must: you cannot import a module to prove it is
 * gone, and importing a survivor would drag its module graph into this packet's
 * read closure without proving anything about the tree.
 */

const REMOVED_PATHS = [
  // The mining mechanism.
  "src/graph/recovery.ts",
  "src/graph/recovery-extract.ts",
  "tests/unit/graph/semantic-recovery.test.ts",
  "config/semantic-recovery-sources.json",
  "schemas/semantic-recovery.schema.json",
  // The second ingestion stack.
  "src/semantic/index.ts",
  "src/semantic/canonical.ts",
  "src/semantic/query.ts",
  "src/semantic/store.ts",
  "src/semantic/types.ts",
  "src/semantic/n3.d.ts",
  "tests/unit/semantic/store.test.ts",
] as const;

/** Dependencies that existed only for the second ingestion stack. */
const REMOVED_DEPENDENCIES = ["n3", "oxigraph", "rdf-validate-shacl"] as const;

/** Module specifiers no surviving source may name. */
const REMOVED_SPECIFIERS = [
  "graph/recovery",
  "recovery-extract",
  "semantic/store",
  "semantic/query",
  "semantic/canonical",
  "semantic/types",
] as const;

function sourceFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    const absolute = join(repositoryRoot, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.(ts|mts|mjs|js)$/u.test(entry.name)) found.push(next.slice(1));
    }
  };
  for (const root of ["src", "tests", "scripts", "apps", "packages"]) walk(`/${root}`);
  return found;
}

test("every removed path is absent from the tracked tree", () => {
  for (const path of REMOVED_PATHS) {
    assert.equal(existsSync(join(repositoryRoot, path)), false, path);
  }
});

test("the second ingestion stack leaves no directory behind", () => {
  // An empty directory is not absence: a reader finding src/semantic would
  // reasonably assume the path still exists and is merely unpopulated.
  for (const directory of ["src/semantic", "tests/unit/semantic"]) {
    assert.equal(existsSync(join(repositoryRoot, directory)), false, directory);
  }
});

test("no surviving source imports a removed module", () => {
  // The property that makes the removal real rather than cosmetic. A dangling
  // import would fail at load time, but only on the path that loads it, and an
  // unreached path is exactly what this whole exercise was about.
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    // This file names every removed specifier, because that is what it is for.
    // A sweep that did not exempt itself would report itself forever.
    if (file === "tests/adversarial/semantic-authority-path.test.ts") continue;
    const source = readFileSync(join(repositoryRoot, file), "utf8");
    for (const specifier of REMOVED_SPECIFIERS) {
      if (new RegExp(`["'][^"']*${specifier}[^"']*["']`, "u").test(source)) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the dependency manifest no longer declares what only the removed stack required", () => {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as { readonly dependencies?: Record<string, string>; readonly devDependencies?: Record<string, string> };
  for (const dependency of REMOVED_DEPENDENCIES) {
    assert.equal(manifest.dependencies?.[dependency], undefined, `dependencies.${dependency}`);
    assert.equal(manifest.devDependencies?.[dependency], undefined, `devDependencies.${dependency}`);
  }
});

test("no surviving source imports the removed dependencies", () => {
  // Dropping a manifest entry while a source still imports it would move the
  // failure from install time to run time, which is strictly worse.
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file === "tests/adversarial/semantic-authority-path.test.ts") continue;
    const source = readFileSync(join(repositoryRoot, file), "utf8");
    for (const dependency of REMOVED_DEPENDENCIES) {
      if (new RegExp(`from\\s+["']${dependency}["']|import\\(["']${dependency}["']\\)`, "u").test(source)) {
        offenders.push(`${file} -> ${dependency}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("exactly one semantic ingestion implementation survives", () => {
  // The requirement is one path, not zero. Proving absence of the second is
  // only half of it; the remaining one must still be there and be singular.
  assert.equal(existsSync(join(repositoryRoot, "src/graph/index.ts")), true, "the ingestion path exists");
  assert.equal(existsSync(join(repositoryRoot, "src/graph/nquads.ts")), true, "its canonical form exists");
  const loaders = sourceFiles().filter((file) =>
    file.startsWith("src/") && /export function loadSemanticGraph\b/u.test(readFileSync(join(repositoryRoot, file), "utf8")));
  assert.deepEqual(loaders, ["src/graph/index.ts"], "one loader, in one place");
});

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
