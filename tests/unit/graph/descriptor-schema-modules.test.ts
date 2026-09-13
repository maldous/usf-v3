import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const descriptorPath = "schemas/cli-transition-descriptor.schema.json";
const manifestPath = "graph/manifests/cli-transition-definition.json";

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8")) as Record<string, unknown>;
}

/** Every non-fragment $ref the descriptor schema carries, at any depth. */
function externalRefs(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) for (const item of node) externalRefs(item, found);
  else if (node !== null && typeof node === "object") {
    for (const [keyword, value] of Object.entries(node)) {
      if (keyword === "$ref" && typeof value === "string" && !value.startsWith("#")) found.add(value.split("#")[0]!);
      else externalRefs(value, found);
    }
  }
  return found;
}

/** Every source path in the transitive closure of a manifest. */
function closureSources(entryManifest: string): ReadonlySet<string> {
  const sources = new Set<string>();
  const seen = new Set<string>();
  const visit = (relativePath: string): void => {
    if (seen.has(relativePath)) return;
    seen.add(relativePath);
    const manifest = readJson(relativePath);
    for (const imported of (manifest.imports as string[] | undefined) ?? []) visit(imported);
    for (const source of (manifest.sources as { path: string }[] | undefined) ?? []) sources.add(source.path);
  };
  visit(entryManifest);
  return sources;
}

/**
 * A descriptor $ref to a graph-owned schema module resolves only against the
 * registry the selected manifest derives, so a module the manifest cannot
 * reach makes every interrogation of this root refuse with
 * SCHEMA_REF_UNRESOLVED before producing any DAG. That is how the three
 * transition schema modules were referenced and declared but never imported.
 *
 * Naming the identity is not reaching it: the base source already carries a
 * schemaIdentity quad for every module, so the guard requires each module's
 * own record specification to be declared in the closure.
 */
test("every graph-owned descriptor schema module is reachable from the manifest that uses it", () => {
  const refs = externalRefs(readJson(descriptorPath));
  assert.ok(refs.size > 0, "the descriptor schema must carry the module references this guards");
  // A module is graph-owned exactly when it has a declaring source beside it.
  const modules = [...refs]
    .map(ref => ({ ref, source: `graph/${/^urn:usf:([a-z0-9-]+):\d+$/.exec(ref)?.[1] ?? ""}-schema.nq` }))
    .filter(entry => existsSync(resolve(repositoryRoot, entry.source)));
  assert.ok(modules.length >= 3, `expected the transition schema modules to be graph-owned, found ${modules.length}`);
  const reachable = closureSources(manifestPath);
  const unreachable = modules.filter(entry => !reachable.has(entry.source)).map(entry => `${entry.ref} (${entry.source})`).sort();
  assert.deepEqual(unreachable, [], `referenced by ${descriptorPath} but unreachable from ${manifestPath}: ${unreachable.join(", ")}`);
});
