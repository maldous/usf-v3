import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listPendingTransactions, recoverTransaction } from "../../src/commands/transact.ts";
import { transactCommand } from "../../src/commands/transact.ts";
import { canonicalDigest } from "../../src/core/canonical.ts";

const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));

async function transactionalFixture(): Promise<{ root: string; proposal: string }> {
  const root = await mkdtemp(join(tmpdir(), "usf-transaction-process-"));
  await mkdir(join(root, "graph", "manifests"), { recursive: true });
  await writeFile(join(root, "graph", "transaction-fixture.nq"), [
    '<urn:usf:type:SemanticType> <urn:usf:predicate:type> <urn:usf:type:SemanticType> <urn:usf:graph:transaction-fixture> .',
    '<urn:usf:type:SemanticPredicate> <urn:usf:predicate:type> <urn:usf:type:SemanticType> <urn:usf:graph:transaction-fixture> .',
    '<urn:usf:predicate:type> <urn:usf:predicate:type> <urn:usf:type:SemanticPredicate> <urn:usf:graph:transaction-fixture> .',
    '<urn:usf:predicate:canonicalPath> <urn:usf:predicate:type> <urn:usf:type:SemanticPredicate> <urn:usf:graph:transaction-fixture> .',
    '<urn:usf:type:ProbeShared> <urn:usf:predicate:type> <urn:usf:type:SemanticType> <urn:usf:graph:transaction-fixture> .',
    '<urn:usf:probe:shared> <urn:usf:predicate:type> <urn:usf:type:ProbeShared> <urn:usf:graph:transaction-fixture> .',
    "",
  ].join("\n"));
  await writeFile(join(root, "graph", "manifests", "v3-convention.json"), JSON.stringify({
    schema: "urn:usf:graph-manifest:2", version: 2, imports: [],
    sources: [{ path: "graph/transaction-fixture.nq", format: "application/n-quads", graph: "urn:usf:graph:transaction-fixture", role: "contract", validationProfile: "bootstrap-nquads-v1" }],
  }));
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "race.txt"), "before");
  await writeFile(join(root, "docs", "race-second.txt"), "before-second");
  await mkdir(join(root, ".usf", "proposals"), { recursive: true, mode: 0o700 });
  await chmod(join(root, ".usf"), 0o700);
  const proposal = join(root, ".usf", "proposals", "race.json");
  await writeFile(proposal, JSON.stringify({ schema: "urn:usf:semantic-transaction-proposal:1", intent: "adversarial transaction exclusion",
    declaredAffectedPaths: ["docs/race-second.txt", "docs/race.txt"], operations: [
      { kind: "write-file", path: "docs/race.txt", content: "after", preimageDigest: "sha256:26c4f38e162a98454d54dcd80b8e01c962b52de3b4c965ccfe9d1a91ae7f1862" },
      { kind: "write-file", path: "docs/race-second.txt", content: "after-second", preimageDigest: canonicalDigest("before-second") },
    ] }));
  return { root, proposal };
}

async function transactInChild(root: string, crash = false): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  const modulePath = join(sourceRoot, "src", "commands", "transact.ts");
  const code = `import { transactCommand } from ${JSON.stringify(modulePath)}; transactCommand(${JSON.stringify(root)}, ["--proposal", ".usf/proposals/race.json"], ${crash ? "{ afterAppliedWrite: () => process.kill(process.pid, 'SIGKILL') }" : "undefined"}).then((x) => console.log(JSON.stringify(x))).catch((x) => { console.error(x.code ?? x.message); process.exitCode=1; });`;
  return new Promise((finish) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", code], { env: process.env });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (exitCode, signal) => finish({ code: exitCode, signal, stdout, stderr }));
  });
}

function graphSource(graph: string, subject: string, canonicalPath: string): string {
  return `<${subject}> <urn:usf:predicate:canonicalPath> "${canonicalPath}" <${graph}> .\n`;
}

async function graphProposal(root: string, name: string, operations: readonly Record<string, unknown>[]): Promise<string> {
  const path = join(root, ".usf", "proposals", `${name}.json`);
  await writeFile(path, JSON.stringify({ schema: "urn:usf:semantic-transaction-proposal:1", intent: name, declaredAffectedPaths: operations.map((op) => op.path).sort(), operations }));
  return `.usf/proposals/${name}.json`;
}

async function fixture(): Promise<{ root: string; pending: string; digest: string; transaction: Record<string, unknown> }> {
  const root = await mkdtemp(join(tmpdir(), "usf-transaction-exclusion-"));
  await mkdir(join(root, ".usf", "transactions"), { recursive: true, mode: 0o700 });
  await chmod(join(root, ".usf"), 0o700);
  await mkdir(join(root, "docs"), { recursive: true });
  const transaction = {
    schema: "urn:usf:semantic-transaction:1", version: 1, applied: true, targetRepository: null,
    derivedAffectedPaths: ["docs/a.txt", "docs/b.txt"], deletions: [],
    preimages: [{ path: "docs/a.txt", preimageDigest: canonicalDigest("before-a") }, { path: "docs/b.txt", preimageDigest: canonicalDigest("before-b") }],
    postimages: [{ path: "docs/a.txt", postimageDigest: canonicalDigest("after-a") }, { path: "docs/b.txt", postimageDigest: canonicalDigest("after-b") }],
  };
  const digest = canonicalDigest(transaction);
  const pending = join(root, ".usf", "transactions", `${digest.slice(7)}.pending.json`);
  await writeFile(pending, JSON.stringify({
    schema: "urn:usf:semantic-transaction-pending:1",
    transactionDigest: digest,
    writeRoot: root,
    targetRepository: null,
    transaction: { ...transaction, transactionDigest: digest },
    images: [
      { path: "docs/a.txt", preimage: "before-a", postimage: "after-a" },
      { path: "docs/b.txt", preimage: "before-b", postimage: "after-b" },
    ],
  }));
  await chmod(pending, 0o600);
  return { root, pending, digest, transaction };
}

test("recovery rolls back a partial exact postimage and removes its pending envelope", async (t) => {
  const { root, digest } = await fixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "docs/a.txt"), "after-a");
  await writeFile(join(root, "docs/b.txt"), "before-b");
  assert.deepEqual(await listPendingTransactions(root), [digest]);
  assert.deepEqual(await recoverTransaction(root, digest), { outcome: "rolled-back", transactionDigest: digest });
  assert.equal(await readFile(join(root, "docs/a.txt"), "utf8"), "before-a");
  assert.equal(await readFile(join(root, "docs/b.txt"), "utf8"), "before-b");
  assert.deepEqual(await listPendingTransactions(root), []);
});

test("recovery finishes an exact complete postimage with a durable receipt", async (t) => {
  const { root, digest } = await fixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "docs/a.txt"), "after-a");
  await writeFile(join(root, "docs/b.txt"), "after-b");
  assert.deepEqual(await recoverTransaction(root, digest), { outcome: "finished", transactionDigest: digest });
  const receipt = JSON.parse(await readFile(join(root, ".usf", "transactions", `${digest.slice(7)}.json`), "utf8")) as Record<string, unknown>;
  assert.equal(receipt.recovered, true);
  assert.equal(await readFile(join(root, "docs/a.txt"), "utf8"), "after-a");
});

test("recovery reuses an exact receipt left before pending cleanup", async (t) => {
  const { root, digest, transaction } = await fixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "docs/a.txt"), "after-a"); await writeFile(join(root, "docs/b.txt"), "after-b");
  const receipt = join(root, ".usf", "transactions", `${digest.slice(7)}.json`);
  await writeFile(receipt, JSON.stringify({ ...transaction, transactionDigest: digest, appliedAt: "2026-09-05T00:00:00.000Z" })); await chmod(receipt, 0o600);
  assert.deepEqual(await recoverTransaction(root, digest), { outcome: "finished", transactionDigest: digest });
  assert.deepEqual(await listPendingTransactions(root), []);
  assert.equal((await readFile(receipt, "utf8")).includes("2026-09-05T00:00:00.000Z"), true);
});

test("recovery refuses a near-match receipt and retains pending state", async (t) => {
  const { root, digest, transaction } = await fixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "docs/a.txt"), "after-a"); await writeFile(join(root, "docs/b.txt"), "after-b");
  const receipt = join(root, ".usf", "transactions", `${digest.slice(7)}.json`);
  await writeFile(receipt, JSON.stringify({ ...transaction, transactionDigest: digest, intent: "forged", appliedAt: "2026-09-05T00:00:00.000Z" })); await chmod(receipt, 0o600);
  await assert.rejects(() => recoverTransaction(root, digest), { code: "TRANSACT_DURABLE_STATE_EXISTS" });
  assert.deepEqual(await listPendingTransactions(root), [digest]);
});

test("recovery never overwrites later unknown bytes", async (t) => {
  const { root, digest } = await fixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "docs/a.txt"), "later-accepted-bytes");
  await writeFile(join(root, "docs/b.txt"), "before-b");
  await assert.rejects(() => recoverTransaction(root, digest), { code: "TRANSACT_RECOVERY_REFUSED" });
  assert.equal(await readFile(join(root, "docs/a.txt"), "utf8"), "later-accepted-bytes");
  assert.deepEqual(await listPendingTransactions(root), [digest]);
});

test("recovery refuses a symlinked pending envelope", async (t) => {
  const { root, pending, digest } = await fixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  const target = join(root, "outside.json");
  await writeFile(target, "{}");
  await rm(pending);
  await symlink(target, pending);
  await assert.rejects(() => recoverTransaction(root, digest), { code: "TRANSACT_RECOVERY_REFUSED" });
});

test("two real processes derived from one preimage cannot both apply", async (t) => {
  const { root } = await transactionalFixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  const [first, second] = await Promise.all([transactInChild(root), transactInChild(root)]);
  assert.equal([first.code, second.code].filter((code) => code === 0).length, 1, `${first.stderr} ${second.stderr}`);
  assert.equal(await readFile(join(root, "docs", "race.txt"), "utf8"), "after");
});

test("a real SIGKILL after the first write leaves a pending envelope recoverable", async (t) => {
  const { root } = await transactionalFixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  const crashed = await transactInChild(root, true);
  assert.equal(crashed.signal, "SIGKILL");
  const pending = await listPendingTransactions(root);
  assert.equal(pending.length, 1);
  assert.deepEqual(await recoverTransaction(root, pending[0]!), { outcome: "rolled-back", transactionDigest: pending[0] });
  assert.equal(await readFile(join(root, "docs", "race.txt"), "utf8"), "before");
  assert.equal(await readFile(join(root, "docs", "race-second.txt"), "utf8"), "before-second");
});

test("individually valid semantic proposals cannot compose into an invalid corpus", async (t) => {
  const { root } = await transactionalFixture(); t.after(async () => rm(root, { recursive: true, force: true }));
  const first = await graphProposal(root, "semantic-first", [{ kind: "write-file", path: "graph/probe/a.nq", content: graphSource("urn:usf:graph:probe-a", "urn:usf:probe:shared", "docs/a.txt"), preimageDigest: null }]);
  const second = await graphProposal(root, "semantic-second", [{ kind: "write-file", path: "graph/probe/b.nq", content: graphSource("urn:usf:graph:probe-b", "urn:usf:probe:shared", "docs/b.txt"), preimageDigest: null }]);
  await transactCommand(root, ["--proposal", first, "--dry-run"]);
  await transactCommand(root, ["--proposal", second, "--dry-run"]);
  await transactCommand(root, ["--proposal", first]);
  await assert.rejects(() => transactCommand(root, ["--proposal", second]), { code: "TRANSACT_INTEGRITY_VIOLATION" });
});
