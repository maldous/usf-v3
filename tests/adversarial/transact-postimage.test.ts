import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphSourceDenominator, isOwnedIntegrityViolation, transactCommand } from "../../src/commands/transact.ts";
import { canonicalDigest } from "../../src/core/canonical.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * usf transact guarantees that the resulting corpus satisfies every semantic
 * integrity invariant before any path is written. Two defects broke that.
 *
 * Novelty. Discovery walked the on-disk graph tree and then substituted
 * postimages only for the files it had found, so a transaction that CREATED a
 * graph source never parsed or checked the bytes it produced. The existing
 * graph-source-discovery test proves recursion by appending to an overlay that
 * already exists, and cannot catch this, because a modified path is always
 * discovered.
 *
 * Attribution. Owned violations were filtered on `graph.length > 0`, and
 * `undeclared-type` reports with an empty graph label, so every corpus-level
 * violation was silently excused. A transaction introducing an undeclared type
 * was accepted while `usf graph integrity` called the same corpus
 * non-conforming.
 *
 * The pure cases below run everywhere, including inside the hermetic cage,
 * because they touch no filesystem. The end-to-end cases drive the real command
 * and therefore need repository write access, which the cage deliberately
 * withholds: it grants exactly one scoped write root. They are guarded rather
 * than exempted, and are asserted in the ordinary outer carrier lane.
 */

const confined = process.permission !== undefined && !process.permission.has("fs.write");
const needsRepositoryWrite = confined
  ? { skip: "drives usf transact against the repository root, which the hermetic cage does not grant; asserted in the outer carrier lane" }
  : {};

// ---------------------------------------------------------------- pure cases

test("a created graph source joins the denominator, at any depth", () => {
  const discovered = ["foundation.nq", "products/anqr/profile.nq"];
  const created = [
    "graph/new-root.nq",
    "graph/products/anqr/new-overlay.nq",
    "graph/deeply/nested/new.nq",
  ];
  const denominator = graphSourceDenominator(discovered, created);
  assert.deepEqual(denominator, [
    "deeply/nested/new.nq",
    "foundation.nq",
    "new-root.nq",
    "products/anqr/new-overlay.nq",
    "products/anqr/profile.nq",
  ]);
  // The defect in one assertion: the preimage alone is not the denominator.
  assert.equal(denominator.length, discovered.length + created.length);
});

test("the denominator is a set, so a modified source is never counted twice", () => {
  const discovered = ["foundation.nq", "products/anqr/profile.nq"];
  const modified = ["graph/products/anqr/profile.nq"];
  assert.deepEqual(graphSourceDenominator(discovered, modified), discovered);
});

test("non-graph and non-nquads postimage paths never enter the denominator", () => {
  const discovered = ["foundation.nq"];
  const irrelevant = [
    "graph/manifests/some.json",
    "docs/handover.md",
    "src/commands/transact.ts",
    "graphology/not-under-graph.nq",
  ];
  assert.deepEqual(graphSourceDenominator(discovered, irrelevant), ["foundation.nq"]);
});

test("a created fixture source stays excluded at every depth", () => {
  const discovered = ["foundation.nq"];
  const fixtures = [
    "graph/fixtures/created.nq",
    "graph/products/fixtures/created.nq",
    "graph/fixtures/deep/created.nq",
  ];
  // Fixtures carry known dangling references and an undeclared type. Counting a
  // created fixture would fail the corpus for a file deliberately outside it.
  assert.deepEqual(graphSourceDenominator(discovered, fixtures), ["foundation.nq"]);
});

test("the denominator is deterministic and frozen", () => {
  const first = graphSourceDenominator(["b.nq"], ["graph/a.nq"]);
  const second = graphSourceDenominator(["b.nq"], ["graph/a.nq"]);
  assert.deepEqual(first, second);
  assert.throws(() => (first as string[]).push("c.nq"), TypeError);
});

test("a violation with no graph label is owned, whatever is exempt", () => {
  const exempt = ["urn:usf:graph:integration", "urn:usf:graph:foundation"];
  // undeclared-type reports with an empty label. This is the whole defect.
  assert.equal(isOwnedIntegrityViolation("", exempt), true);
  assert.equal(isOwnedIntegrityViolation("", []), true);
});

test("a named exempt graph's violation stays excused, and any other is owned", () => {
  const exempt = ["urn:usf:graph:integration"];
  assert.equal(isOwnedIntegrityViolation("urn:usf:graph:integration", exempt), false);
  assert.equal(isOwnedIntegrityViolation("urn:usf:graph:v3-delivery", exempt), true);
  assert.equal(isOwnedIntegrityViolation("urn:anqr:graph:architecture", exempt), true);
});

// ----------------------------------------------------------- end-to-end cases

const PROBE = "graph/probe-postimage";
const PROPOSAL = ".usf/proposals/transact-postimage-probe.json";

async function authoredSourceCount(): Promise<number> {
  const root = resolve(repositoryRoot, "graph");
  const walk = async (directory: string): Promise<number> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "fixtures") continue;
        total += await walk(resolve(directory, entry.name));
      } else if (entry.name.endsWith(".nq")) total += 1;
    }
    return total;
  };
  return walk(root);
}

interface TransactReport {
  readonly validation: { readonly graphFilesParsed: number; readonly resultingQuadCount: number; readonly conforming: boolean };
}

async function runProposal(operations: readonly Record<string, unknown>[], dryRun: boolean): Promise<{
  readonly exitCode: number;
  readonly output: Record<string, unknown>;
}> {
  const absolute = resolve(repositoryRoot, PROPOSAL);
  await mkdir(resolve(repositoryRoot, ".usf/proposals"), { recursive: true });
  await writeFile(absolute, JSON.stringify({
    schema: "urn:usf:semantic-transaction-proposal:1",
    intent: "Adversarial probe for postimage denominator completeness.",
    declaredAffectedPaths: [...new Set(operations.map((operation) => operation.path as string))].sort(),
    operations,
  }));
  try {
    const args = ["--proposal", PROPOSAL, ...(dryRun ? ["--dry-run"] : [])];
    const result = await transactCommand(repositoryRoot, args) as { output: Record<string, unknown>; exitCode?: number };
    return { exitCode: result.exitCode ?? 0, output: result.output };
  } catch (error) {
    return { exitCode: -1, output: { thrown: error instanceof Error ? error.message : String(error) } };
  } finally {
    await rm(absolute, { force: true });
  }
}

/**
 * A minimal well-formed source. The type name is derived from the graph so two
 * probe sources never declare the same type twice, which would itself be a
 * multiple-type-declaration violation and would make these pass for the wrong
 * reason.
 */
function validSource(graph: string, subject: string): string {
  const localType = `urn:usf:type:Probe${graph.split(":").pop()!.replace(/[^A-Za-z0-9]/g, "")}`;
  return [
    `<${subject}> <urn:usf:predicate:type> <${localType}> <${graph}> .`,
    `<${localType}> <urn:usf:predicate:type> <urn:usf:type:SemanticType> <${graph}> .`,
    `<${subject}> <urn:usf:predicate:canonicalName> "probe" <${graph}> .`,
  ].join("\n") + "\n";
}

const cleanProbe = (): Promise<void> => rm(resolve(repositoryRoot, PROBE), { recursive: true, force: true });
const exists = (path: string): Promise<boolean> => stat(resolve(repositoryRoot, path)).then(() => true, () => false);

test("a created graph source is counted in the reported denominator", needsRepositoryWrite, async () => {
  await cleanProbe();
  const before = await authoredSourceCount();
  const path = `${PROBE}/created.nq`;
  try {
    const dry = await runProposal([
      { kind: "write-file", path, content: validSource("urn:usf:graph:probe-created", "urn:usf:probe:created"), preimageDigest: null },
    ], true);
    assert.equal(dry.exitCode, 0, `dry run refused: ${JSON.stringify(dry.output).slice(0, 300)}`);
    const report = dry.output as unknown as TransactReport;
    // Before the repair this reported `before` and the pre-transaction quad
    // count, while creating the file anyway.
    assert.equal(report.validation.graphFilesParsed, before + 1);
    assert.equal(report.validation.conforming, true);
    assert.equal(await exists(path), false, "a dry run must write nothing");
  } finally {
    await cleanProbe();
  }
});

test("a created source with invalid N-Quads refuses before any write", needsRepositoryWrite, async () => {
  await cleanProbe();
  const path = `${PROBE}/broken.nq`;
  try {
    const result = await runProposal([
      { kind: "write-file", path, content: "this is not n-quads at all\n", preimageDigest: null },
    ], false);
    assert.notEqual(result.exitCode, 0, "a syntactically invalid created source must refuse");
    assert.match(JSON.stringify(result.output), /TRANSACT_GRAPH_INVALID|NQUADS|thrown/);
    assert.equal(await exists(path), false, "the refused source must not be written");
  } finally {
    await cleanProbe();
  }
});

test("a created source asserting an undeclared type refuses before any write", needsRepositoryWrite, async () => {
  await cleanProbe();
  const path = `${PROBE}/undeclared.nq`;
  try {
    // Structurally valid N-Quads, semantically a violation, reported with an
    // empty graph label. This is the case the ownership filter excused.
    const content = "<urn:usf:probe:undeclared> <urn:usf:predicate:type> <urn:usf:type:ProbeNeverDeclared> <urn:usf:graph:probe-undeclared> .\n";
    const result = await runProposal([{ kind: "write-file", path, content, preimageDigest: null }], false);
    assert.notEqual(result.exitCode, 0, "an undeclared type in a created source must refuse");
    assert.match(JSON.stringify(result.output), /TRANSACT_INTEGRITY_VIOLATION|undeclared|thrown/);
    assert.equal(await exists(path), false, "the refused source must not be written");
  } finally {
    await cleanProbe();
  }
});

test("one invalid source among valid ones refuses the whole transaction", needsRepositoryWrite, async () => {
  await cleanProbe();
  const good = `${PROBE}/good.nq`;
  const bad = `${PROBE}/nested/bad.nq`;
  try {
    const result = await runProposal([
      { kind: "write-file", path: good, content: validSource("urn:usf:graph:probe-good", "urn:usf:probe:good"), preimageDigest: null },
      { kind: "write-file", path: bad, content: "<not-an-iri> junk\n", preimageDigest: null },
    ], false);
    assert.notEqual(result.exitCode, 0);
    // Atomicity: the valid sibling must not land either.
    assert.equal(await exists(good), false, "no path may be written when any postimage is invalid");
    assert.equal(await exists(bad), false);
  } finally {
    await cleanProbe();
  }
});

test("a modification-only transaction reports exactly what it did before", needsRepositoryWrite, async () => {
  const before = await authoredSourceCount();
  const overlay = "graph/products/anqr/profile.nq";
  const preimageDigest = canonicalDigest(await readFile(resolve(repositoryRoot, overlay), "utf8"));
  const dry = await runProposal([{ kind: "append-quads", path: overlay, content: "", preimageDigest }], true);
  assert.equal(dry.exitCode, 0, `dry run refused: ${JSON.stringify(dry.output).slice(0, 300)}`);
  const report = dry.output as unknown as TransactReport;
  // The repair must not change the behaviour a modifying transaction already had.
  assert.equal(report.validation.graphFilesParsed, before);
  assert.equal(report.validation.conforming, true);
});
