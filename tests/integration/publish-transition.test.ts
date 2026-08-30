import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { canonicalJson } from "../../src/core/canonical.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveCurrentRealisationBasis, deriveWork } from "../../src/graph/work.ts";
import {
  createPublishRecoveryJournal,
  publishCommandHandler,
  recoverPublishTransition,
  withPublishTransitionLock,
  type PublishRecoveryJournal,
} from "../../src/commands/publish.ts";
import { applyTransitionOperations, reverseTransitionOperations, verifyTransitionActivationCurrentness, type VerifiedTransitionReceipt } from "../../src/realisation/transition.ts";
import { assertBasisMatchesPacket } from "../../src/realisation/basis.ts";

const sourceRoot = resolve(import.meta.dirname, "../..");
const temporaryRoot = resolve(sourceRoot, ".usf/tmp");
const profile = "urn:usf:profile:v3-semantic-first:1";
const broaderConsumerProfile = "urn:usf:profile:v3-self-host:1";
const manifestPath = "graph/manifests/self-host.json";
const sourcePath = "graph/semantic-first.nq";
const receiptPath = "evidence/semantic-first-bootstrap-admission.json";
const journalPath = ".usf/transactions/bootstrap-transition.json";
const gatePermission = "urn:usf:permission:semantic-first-order";
const gateCurrentness = "urn:usf:currentness:semantic-first-bootstrap-transition:1";
const applyArguments = ["bootstrap-transition", "--profile", profile, "--manifest", manifestPath, "--receipt", receiptPath, "--apply"];

let canonicalPreSourcePromise: Promise<string> | undefined;

function canonicalPreSource(): Promise<string> {
  canonicalPreSourcePromise ??= (async () => {
    const currentSource = await readFile(join(sourceRoot, sourcePath), "utf8");
    const currentGraph = loadSemanticGraph(sourceRoot, manifestPath);
    const states = currentGraph.quads
      .filter((quad) => quad.subject === gatePermission && quad.predicate === "urn:usf:predicate:activationState" && quad.objectKind === "iri")
      .map((quad) => quad.object);
    assert.equal(states.length, 1, "the source gate permission state is exact");
    if (states[0] === "urn:usf:contract-state:proofblocked") {
      await assert.rejects(() => readFile(join(sourceRoot, receiptPath)), { code: "ENOENT" }, "pre-state source must retain the missing receipt preimage");
      return currentSource;
    }
    assert.equal(states[0], "urn:usf:contract-state:active", "only the exact pre or verified post state may seed a publication fixture");
    const verified = verifyTransitionActivationCurrentness(currentGraph, gateCurrentness, gatePermission, broaderConsumerProfile);
    const sourceBefore = reverseTransitionOperations(currentSource, verified.receipt.operations);
    assert.equal(applyTransitionOperations(sourceBefore, verified.receipt.operations), currentSource, "the closed receipt exactly reconstructs the post-state source");
    return sourceBefore;
  })();
  return canonicalPreSourcePromise;
}

async function fixture(context: TestContext, withDependencies = false): Promise<string> {
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(join(temporaryRoot, "usf-publish-transition-"));
  const root = join(parent, "repository");
  await mkdir(root, { mode: 0o700 });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "evidence" || entry.name.startsWith(".usf")) continue;
    await cp(join(sourceRoot, entry.name), join(root, entry.name), { recursive: true });
  }
  await writeFile(join(root, sourcePath), await canonicalPreSource(), "utf8");
  await mkdir(join(root, ".usf/tmp"), { recursive: true, mode: 0o700 });
  await mkdir(join(root, ".usf/cache"), { recursive: true, mode: 0o700 });
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  const indexed = spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(indexed.status, 0, indexed.stderr);
  if (withDependencies) {
    const dependencies = spawnSync("cp", ["-a", "--reflink=auto", join(sourceRoot, "node_modules"), join(root, "node_modules")], { encoding: "utf8" });
    const dependencyStore = spawnSync("cp", ["-a", "--reflink=auto", join(sourceRoot, ".usf/cache/pnpm-virtual-store"), join(root, ".usf/cache/pnpm-virtual-store")], { encoding: "utf8" });
    assert.equal(dependencies.status, 0, dependencies.stderr);
    assert.equal(dependencyStore.status, 0, dependencyStore.stderr);
  }
  context.after(() => rm(parent, { recursive: true, force: true }));
  return root;
}

function apply(root: string): { output: { status: string; mode: string; effects: string[] } } {
  return publishCommandHandler({ command: "publish", args: applyArguments, repositoryRoot: root }) as { output: { status: string; mode: string; effects: string[] } };
}

async function installJournal(root: string, journal: PublishRecoveryJournal): Promise<void> {
  await mkdir(join(root, ".usf/transactions"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, journalPath), `${canonicalJson(journal, { rejectAbsolutePaths: true })}\n`, { mode: 0o600 });
}

test("fresh publication creates its contained receipt parent, excludes ignored secrets, and recovers exact crash states", async (context) => {
  const root = await fixture(context, true);
  const authorizedUntrackedLeaf = "tests/fixtures/providers/authorized-untracked.json";
  await writeFile(join(root, authorizedUntrackedLeaf), "{\"authorized\":true}\n", "utf8");
  assert.notEqual(spawnSync("git", ["ls-files", "--error-unmatch", authorizedUntrackedLeaf], { cwd: root }).status, 0, "the directory-authorized leaf remains untracked");
  const secretCanary = join(root, ".usf/secret-canary");
  await writeFile(secretCanary, "must-not-enter-proof-shadow\n", { mode: 0o600 });
  await symlink(secretCanary, join(root, ".env"));
  await assert.rejects(() => lstat(join(root, "evidence")), { code: "ENOENT" });

  assert.throws(
    () => publishCommandHandler({
      command: "publish",
      args: applyArguments.with(2, broaderConsumerProfile),
      repositoryRoot: root,
    }),
    { code: "PUBLISH_SELECTION_MISMATCH", exitCode: 2 },
    "the broader consumer profile cannot mint the isolated core authority receipt",
  );
  assert.equal((await readFile(join(root, sourcePath), "utf8")).includes("urn:usf:contract-state:proofblocked"), true);

  const result = apply(root);
  assert.equal(result.output.status, "ok");
  assert.equal(result.output.mode, "apply");
  assert.deepEqual(result.output.effects, [sourcePath, receiptPath]);
  assert.equal((await lstat(join(root, "evidence"))).isDirectory(), true);
  assert.equal((await lstat(join(root, receiptPath))).mode & 0o777, 0o644);
  assert.equal((await lstat(join(root, ".env"))).isSymbolicLink(), true, "the ignored credential path never entered the proof shadow");
  await assert.rejects(() => lstat(join(root, journalPath)), { code: "ENOENT" });

  const consumerGraph = loadSemanticGraph(root, manifestPath);
  const broadFull = deriveWork(consumerGraph, { profile: broaderConsumerProfile, maxItems: 100 });
  const broadReady = deriveWork(consumerGraph, { profile: broaderConsumerProfile, ready: true, maxItems: 100 });
  assert.equal(broadFull.status, "ok", "a broad consumer replays direct gate currentness under the receipt authority profile");
  assert.equal(broadReady.status, "ok", "ready projection uses the same exact receipt authority selection");
  for (const workId of [
    "urn:usf:work:semantic-first-eligibility",
    "urn:usf:work:realisation-basis-chain",
    "urn:usf:work:semantic-first-lifecycle-admission",
  ]) assert.equal(broadFull.items?.some((item) => item.id === workId), true, workId);

  const integrateStage = deriveWork(loadSemanticGraph(root, manifestPath), { profile, ready: true, stage: "integrate", maxItems: 100 });
  assert.equal(integrateStage.status, "ok");
  assert.deepEqual(integrateStage.items?.map((item) => item.id), [
    "urn:usf:work:semantic-first-eligibility",
    "urn:usf:work:realisation-basis-chain",
    "urn:usf:work:semantic-first-lifecycle-admission",
  ]);
  for (const item of integrateStage.items ?? []) {
    assert.equal(item.realisationStage?.stage, "checked-awaiting-integration");
    assert.ok(item.realisationBasis);
    assertBasisMatchesPacket(item.realisationBasis, item);
    const current = await deriveCurrentRealisationBasis(root, item.realisationBasis);
    assert.equal(current.basisDigest, item.realisationBasis.basisDigest);
  }

  assert.equal(withPublishTransitionLock(root, () => "stale-file-safe"), "stale-file-safe");
  withPublishTransitionLock(root, () => assert.throws(
    () => withPublishTransitionLock(root, () => undefined),
    { code: "PUBLISH_TRANSITION_LOCKED", exitCode: 7 },
  ));

  const sourceAfter = await readFile(join(root, sourcePath), "utf8");
  const receiptBytes = await readFile(join(root, receiptPath), "utf8");
  const receipt = JSON.parse(receiptBytes) as VerifiedTransitionReceipt;
  assert.equal(receipt.profile, profile);
  assert.equal(receipt.manifestPath, manifestPath);
  const consumer = deriveWork(loadSemanticGraph(root, manifestPath), {
    profile: broaderConsumerProfile,
    selector: "urn:usf:work:repository-path-scope",
    maxItems: 1,
  }).items?.[0];
  assert.equal(
    consumer?.eligibility?.construction.reasonCodes.some((code) => code === "REQUIRED_PERMISSION_CURRENTNESS_UNVERIFIED:urn:usf:permission:semantic-first-order"),
    false,
    "a broader consumer verifies the same isolated core receipt without minting it",
  );
  const sourceBefore = reverseTransitionOperations(sourceAfter, receipt.operations);
  const journal = createPublishRecoveryJournal({ profile, manifestPath, sourcePath, receiptPath, sourceBefore, sourceAfter, receiptBytes });

  await unlink(join(root, receiptPath));
  await installJournal(root, journal);
  assert.equal(recoverPublishTransition(root), "rolled-back", "a crash after source write rolls back to the exact pre-state");
  assert.equal(await readFile(join(root, sourcePath), "utf8"), sourceBefore);
  await assert.rejects(() => lstat(join(root, receiptPath)), { code: "ENOENT" });
  await assert.rejects(() => lstat(join(root, journalPath)), { code: "ENOENT" });

  await writeFile(join(root, sourcePath), sourceAfter, "utf8");
  await writeFile(join(root, receiptPath), receiptBytes, { mode: 0o644 });
  await installJournal(root, journal);
  assert.equal(recoverPublishTransition(root), "completed", "a crash after receipt write preserves the exact completed pair");
  assert.equal(await readFile(join(root, sourcePath), "utf8"), sourceAfter);
  assert.equal(await readFile(join(root, receiptPath), "utf8"), receiptBytes);
  await assert.rejects(() => lstat(join(root, journalPath)), { code: "ENOENT" });

  await writeFile(join(root, sourcePath), `${sourceAfter}# mismatch\n`, "utf8");
  await installJournal(root, journal);
  assert.throws(() => recoverPublishTransition(root), { code: "PUBLISH_RECOVERY_STATE_MISMATCH", exitCode: 5 });
  assert.equal((await lstat(join(root, journalPath))).isFile(), true, "a mismatched crash state remains fail-closed for diagnosis");
});

test("publication refuses planted parent and tracked-secret defects before authority mutation", async (context) => {
  for (const scenario of ["symlink-parent", "file-parent", "tracked-env", "directory-secret"] as const) {
    const root = await fixture(context);
    if (scenario === "symlink-parent") {
      await mkdir(join(root, ".usf/evidence-target"), { recursive: true, mode: 0o700 });
      await symlink(join(root, ".usf/evidence-target"), join(root, "evidence"));
    } else if (scenario === "file-parent") {
      await writeFile(join(root, "evidence"), "not-a-directory\n", "utf8");
    } else if (scenario === "tracked-env") {
      await writeFile(join(root, ".env"), "SECRET_CANARY=never-copy\n", { mode: 0o600 });
      const indexed = spawnSync("git", ["add", "-f", ".env"], { cwd: root, encoding: "utf8" });
      assert.equal(indexed.status, 0, indexed.stderr);
    } else {
      await writeFile(join(root, "tests/fixtures/providers/.env.secret"), "SECRET_CANARY=never-copy\n", { mode: 0o600 });
    }
    const expected = scenario === "symlink-parent"
      ? "PUBLISH_PATH_SYMLINK_REFUSED"
      : scenario === "file-parent"
        ? "PUBLISH_PATH_PARENT_NOT_DIRECTORY"
        : "PUBLISH_SHADOW_SECRET_PATH_REFUSED";
    assert.throws(() => apply(root), { code: expected, exitCode: 5 }, scenario);
    assert.equal((await readFile(join(root, sourcePath), "utf8")).includes("urn:usf:contract-state:proofblocked"), true, `${scenario} must not mutate authority`);
  }
});
