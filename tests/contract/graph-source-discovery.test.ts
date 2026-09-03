import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphIntegrityCommand } from "../../src/commands/graph-integrity.ts";
import { transactCommand } from "../../src/commands/transact.ts";
import { canonicalDigest } from "../../src/core/canonical.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The authority corpus is every authored graph source, not every graph source
 * that happens to sit at the top of the directory. Both the read-only gate and
 * the transaction enumerated `graph/` with a flat readdir, so both validated 14
 * of 21 sources and neither had ever seen the ANQR product overlay. Nothing
 * detected it, because nothing asserted the source count.
 */
async function authoredSources(): Promise<{ readonly all: number; readonly rootOnly: number; readonly overlay: number }> {
  const root = resolve(repositoryRoot, "graph");
  const walk = async (directory: string): Promise<readonly string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "fixtures") continue;
        found.push(...await walk(resolve(directory, entry.name)));
      } else if (entry.name.endsWith(".nq")) {
        found.push(resolve(directory, entry.name));
      }
    }
    return found;
  };
  const all = await walk(root);
  const rootOnly = all.filter((path) => resolve(path, "..") === root);
  return { all: all.length, rootOnly: rootOnly.length, overlay: all.length - rootOnly.length };
}

test("graph integrity discovers every authored source recursively and excludes fixtures", async () => {
  const counted = await authoredSources();
  assert.ok(counted.overlay > 0, "the corpus has product-overlay sources; without them this test proves nothing");

  const result = await graphIntegrityCommand(repositoryRoot, []);
  const report = result.output as { sourceFileCount: number; unparsedFiles: readonly string[]; quadCount: number };

  // The exact count, not merely "more than the root": a flat readdir returns
  // rootOnly, and any regression to one lands on that number.
  assert.equal(report.sourceFileCount, counted.all);
  assert.notEqual(report.sourceFileCount, counted.rootOnly);
  assert.deepEqual(report.unparsedFiles, [], "every discovered source parses");

  // Fixtures are synthetic test input in their own namespace. They carry known
  // dangling references and an undeclared type, so including them would fail
  // the gate; excluding them is deliberate and must stay deliberate.
  const withFixtures = await readdir(resolve(repositoryRoot, "graph/fixtures"), { withFileTypes: true });
  assert.ok(withFixtures.some((entry) => entry.name.endsWith(".nq")), "fixtures exist to be excluded");
});

test("a transaction validates its postimage against every authored source", async () => {
  const counted = await authoredSources();
  // Built at run time rather than frozen as a fixture: a stored preimage digest
  // would go stale the moment the overlay it names changes, and the test would
  // then fail for a reason that has nothing to do with what it proves.
  const overlay = "graph/products/anqr/profile.nq";
  const preimageDigest = canonicalDigest(await readFile(resolve(repositoryRoot, overlay), "utf8"));
  const proposalPath = ".usf/proposals/graph-source-discovery-probe.json";
  const absolute = resolve(repositoryRoot, proposalPath);
  await mkdir(resolve(repositoryRoot, ".usf/proposals"), { recursive: true });
  await writeFile(absolute, JSON.stringify({
    schema: "urn:usf:semantic-transaction-proposal:1",
    intent: "Regression probe: a no-op append to a product-overlay path, so the transaction must parse and validate the overlay postimage.",
    declaredAffectedPaths: [overlay],
    operations: [{ kind: "append-quads", path: overlay, content: "", preimageDigest }],
  }));
  try {
    const result = await transactCommand(repositoryRoot, ["--proposal", proposalPath, "--dry-run"]);
    const report = (result as { output: { validation: { graphFilesParsed: number; conforming: boolean } } }).output;
    // The breadth of the validation is the point, not the write: a flat readdir
    // would neither parse the overlay postimage nor count it.
    assert.equal(report.validation.graphFilesParsed, counted.all);
    assert.equal(report.validation.conforming, true);
  } finally {
    await rm(absolute, { force: true });
  }
});
