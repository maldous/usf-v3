import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { canonicalDigest, canonicalJson } from "../../../src/core/canonical.ts";
import { runGraphDerivedCheck } from "../../../src/commands/check.ts";
import { loadSemanticGraph, objectValues } from "../../../src/graph/index.ts";
import { deriveWork, type WorkPacket } from "../../../src/graph/work.ts";
import {
  applyCandidateOperations,
  authenticateCandidateWorkspace,
  candidateScope,
  candidateOperations,
  currentCandidateWorkspace,
  deriveCandidatePreimages,
  materialiseCandidate,
  RealisationError,
  withCandidateLock,
  type CandidateSpec,
} from "../../../src/realisation/index.ts";
import { createRealisationBasis, type BasisDraft, type RealisationBasis } from "../../../src/realisation/basis.ts";
import {
  IntegrationError,
  integrateCandidates,
  prepareCandidateIntegration,
  runIntegrationValidation,
  type IntegrationValidationAuthority,
} from "../../../src/realisation/transition.ts";

const sourceRoot = resolve(import.meta.dirname, "../../..");
const workspaceTemporaryRoot = process.env.TMPDIR === undefined ? resolve(sourceRoot, ".usf/tmp") : resolve(process.env.TMPDIR);
const manifestPath = "graph/manifests/self-host.json";
const profile = "urn:usf:profile:v3-self-host:1";
const workId = "urn:usf:work:realisation-basis-chain";
const targetPath = "tests/unit/realisation/workspace.test.ts";

type ProfileBoundPacket = WorkPacket & Readonly<{ realisationBasis: RealisationBasis }>;

function lockProcessUnavailable(context: TestContext): boolean {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission === undefined || permission.has("child_process")) return false;
  context.skip("lock-owning USF operations are proven by the direct outer component validation");
  return true;
}

async function fixture(context: TestContext): Promise<string> {
  await mkdir(workspaceTemporaryRoot, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(join(workspaceTemporaryRoot, "usf-realisation-"));
  const root = join(parent, "repo");
  await mkdir(root);
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")) continue;
    await cp(join(sourceRoot, entry.name), join(root, entry.name), { recursive: true });
  }
  context.after(() => rm(parent, { recursive: true, force: true }));
  return root;
}

function packet(root: string): ProfileBoundPacket {
  const result = deriveWork(loadSemanticGraph(root, manifestPath), { profile, selector: workId });
  assert.equal(result.status, "ok");
  const work = result.items?.[0] as ProfileBoundPacket | undefined;
  assert.ok(work?.realisationBasis, "graph-derived work must carry its realisation basis");
  return work;
}

function candidate(basis: RealisationBasis, content: string, nonce: string): CandidateSpec {
  const operations = [{ kind: "write" as const, path: targetPath, content }];
  const acceptedContributionDigests = [canonicalDigest({ nonce })];
  const digest = canonicalDigest({ basisDigest: basis.basisDigest, operations, acceptedContributionDigests }, { rejectAbsolutePaths: true });
  return {
    digest,
    basis,
    operations,
    lineage: { acceptedContributionDigests, rejected: [] },
    scope: candidateScope(basis),
    writeSet: [targetPath],
    preimages: { [targetPath]: basis.scope.preimages[targetPath]! },
  };
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", ["-c", "user.name=USF Test", "-c", "user.email=test@invalid.local", "-C", root, ...args], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gitOutcome(root: string, args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync("/usr/bin/git", ["-c", "user.name=USF Test", "-c", "user.email=test@invalid.local", "-C", root, ...args], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
}

function initialiseGit(root: string): void {
  git(root, ["init", "-b", "main"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "-m", "fixture"]);
}

test("materialises one basis-bound candidate and applies only its exact byte delta", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  const before = await readFile(join(root, targetPath), "utf8");
  const spec = candidate(basis, `${before}\n// isolated candidate byte\n`, "happy");
  const materialised = await materialiseCandidate(root, spec);
  let signalHeld!: () => void;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { signalHeld = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const lockOperation = withCandidateLock(root, spec.digest, async () => {
    signalHeld();
    await released;
  });
  await held;
  try {
    await assert.rejects(
      () => applyCandidateOperations(root, spec.digest, candidateOperations(spec)),
      (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_BUSY",
      "the inherited parent lock fd remains held after the acquisition child exits",
    );
  } finally {
    release();
    await lockOperation;
  }
  const delta = await applyCandidateOperations(root, spec.digest, candidateOperations(spec));

  assert.equal(materialised.basis.basisDigest, basis.basisDigest);
  assert.equal(delta.length, 1);
  assert.equal(await readFile(join(root, targetPath), "utf8"), before, "primary bytes remain unchanged");
  assert.equal(await readFile(join(materialised.workspace, targetPath), "utf8"), `${before}\n// isolated candidate byte\n`);

  const manifestFile = join(materialised.workspace, ".usf-workspace.json");
  const candidateLocks = join(root, ".usf", "locks", "candidates");
  const lockFile = join(candidateLocks, `${spec.digest.slice("sha256:".length)}.lock`);
  const workspaceManifest = await readFile(manifestFile, "utf8");
  assert.equal((await stat(materialised.workspace)).mode & 0o777, 0o700);
  assert.equal((await stat(manifestFile)).mode & 0o777, 0o600);
  assert.equal((await stat(candidateLocks)).mode & 0o777, 0o700);
  assert.equal((await stat(lockFile)).mode & 0o777, 0o600);
  assert.equal(workspaceManifest.split(basis.basisDigest).length - 1, 1, "the full basis is persisted exactly once");

  const directoryTarget = "tests/fixtures/providers/generated.json";
  const directoryOperations = [{ kind: "write" as const, path: directoryTarget, content: "{\"generated\":true}\n" }];
  const directoryContributionDigests = [canonicalDigest({ nonce: "directory-child" })];
  const directorySpec: CandidateSpec = {
    digest: canonicalDigest({
      basisDigest: basis.basisDigest,
      operations: directoryOperations,
      acceptedContributionDigests: directoryContributionDigests,
    }, { rejectAbsolutePaths: true }),
    basis,
    operations: directoryOperations,
    lineage: { acceptedContributionDigests: directoryContributionDigests, rejected: [] },
    scope: candidateScope(basis),
    writeSet: [directoryTarget],
    preimages: await deriveCandidatePreimages(root, basis, [directoryTarget]),
  };
  assert.deepEqual(directorySpec.preimages, { [directoryTarget]: null });
  await assert.rejects(
    () => materialiseCandidate(root, { ...directorySpec, preimages: { [directoryTarget]: canonicalDigest("caller-authored") } }),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_BASIS_MISMATCH",
    "a caller-authored directory-child preimage grants no authority",
  );
  const directoryCandidate = await materialiseCandidate(root, directorySpec);
  await applyCandidateOperations(root, directorySpec.digest, candidateOperations(directorySpec));
  const currentDirectoryCandidate = await currentCandidateWorkspace(root, directorySpec.digest);
  assert.equal(currentDirectoryCandidate.basis.basisDigest, basis.basisDigest);
  assert.equal(await readFile(join(directoryCandidate.workspace, directoryTarget), "utf8"), "{\"generated\":true}\n");
  await assert.rejects(() => readFile(join(root, directoryTarget)), { code: "ENOENT" });
});

test("basis-bound materialisation refuses missing, fabricated, stale and out-of-scope authority", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  const before = await readFile(join(root, targetPath), "utf8");
  const valid = candidate(basis, `${before}\n// candidate\n`, "valid");
  const { basisDigest: _ignored, ...draft } = basis;
  const fabricated = createRealisationBasis({
    ...(draft as BasisDraft),
    inputs: { ...basis.inputs, policyDigest: canonicalDigest("fabricated-policy") },
  });
  const planted: Array<{ name: string; spec: CandidateSpec; reason: string }> = [
    { name: "missing basis", spec: { ...valid, basis: undefined as unknown as RealisationBasis }, reason: "INVALID_REALISATION_BASIS" },
    { name: "fabricated basis", spec: candidate(fabricated, `${before}\n// candidate\n`, "fabricated"), reason: "STALE_REALISATION_BASIS" },
    {
      name: "fabricated preimage",
      spec: { ...valid, preimages: { [targetPath]: canonicalDigest("wrong-preimage") } },
      reason: "CANDIDATE_BASIS_MISMATCH",
    },
    {
      name: "write beyond basis scope",
      spec: (() => {
        const operations = [{ kind: "write" as const, path: "outside.txt", content: "outside" }];
        const acceptedContributionDigests = [canonicalDigest({ nonce: "outside" })];
        return {
          ...valid,
          digest: canonicalDigest({ basisDigest: basis.basisDigest, operations, acceptedContributionDigests }, { rejectAbsolutePaths: true }),
          operations,
          lineage: { acceptedContributionDigests, rejected: [] },
          writeSet: ["outside.txt"],
          preimages: {},
        };
      })(),
      reason: "UNDECLARED_WRITE",
    },
  ];
  for (const scenario of planted) {
    await assert.rejects(
      () => materialiseCandidate(root, scenario.spec),
      (error: unknown) => error instanceof RealisationError && error.reasonCode === scenario.reason,
      scenario.name,
    );
  }

  await materialiseCandidate(root, valid);
  await writeFile(join(root, targetPath), `${before}\n// relevant primary movement\n`);
  await assert.rejects(
    () => applyCandidateOperations(root, valid.digest, candidateOperations(valid)),
    (error: unknown) => error instanceof RealisationError && ["STALE_REALISATION_BASIS", "STALE_RELEVANT_PREIMAGE"].includes(error.reasonCode),
  );
});

test("authenticates candidate lineage, actual bytes, modes and scoped tree without caller identity", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  const before = await readFile(join(root, targetPath), "utf8");
  const spec = candidate(basis, `${before}\n// authenticated candidate\n`, "authenticated");
  const materialised = await materialiseCandidate(root, spec);
  await applyCandidateOperations(root, spec.digest, candidateOperations(spec));

  const authenticated = await authenticateCandidateWorkspace(root, spec.digest);
  assert.equal(authenticated.candidateDigest, spec.digest);
  assert.equal(authenticated.constructionBasis.basisDigest, basis.basisDigest);
  assert.deepEqual(authenticated.acceptedContributionDigests, spec.lineage.acceptedContributionDigests);
  assert.equal(authenticated.actualOperationDelta.length, 1);
  assert.equal(authenticated.actualOperationDelta[0]?.beforeMode, "100644");
  assert.equal(authenticated.actualOperationDelta[0]?.afterMode, "100644");
  for (const value of [authenticated.lineageDigest, authenticated.byteDeltaDigest, authenticated.fileModeDigest,
    authenticated.writeSetDigest, authenticated.candidateTreeDigest, authenticated.workspaceIdentityDigest]) assert.match(value, /^sha256:[a-f0-9]{64}$/u);

  await chmod(materialised.workspace, 0o755);
  await assert.rejects(
    () => authenticateCandidateWorkspace(root, spec.digest),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "INVALID_WORKSPACE_MANIFEST",
    "candidate workspace ancestry must remain owner-private",
  );
  await chmod(materialised.workspace, 0o700);
  const lockPath = join(root, ".usf", "locks", "candidates", `${spec.digest.slice("sha256:".length)}.lock`);
  const hardlinkPath = `${lockPath}.hardlink`;
  await link(lockPath, hardlinkPath);
  await assert.rejects(
    () => authenticateCandidateWorkspace(root, spec.digest),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_LOCK_UNAVAILABLE",
    "a hardlinked candidate lock cannot establish process-held identity",
  );
  await unlink(hardlinkPath);

  const workspacesRoot = join(root, ".usf", "workspaces");
  const workspacesBackup = join(root, ".usf", "workspaces-authenticated-backup");
  await rename(workspacesRoot, workspacesBackup);
  await symlink(workspacesBackup, workspacesRoot, "dir");
  try {
    await assert.rejects(
      () => authenticateCandidateWorkspace(root, spec.digest),
      (error: unknown) => error instanceof RealisationError && error.reasonCode === "INVALID_WORKSPACE_MANIFEST",
      "a symlinked candidate-workspace ancestor cannot be authenticated",
    );
  } finally {
    await unlink(workspacesRoot);
    await rename(workspacesBackup, workspacesRoot);
  }

  await chmod(join(materialised.workspace, targetPath), 0o755);
  await assert.rejects(
    () => authenticateCandidateWorkspace(root, spec.digest),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_BASIS_MISMATCH",
    "a caller cannot smuggle an undeclared executable-mode effect into the authenticated tree",
  );
});

test("prepares, fast-forwards and recovers one observed local Git integration without touching unrelated dirt", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  initialiseGit(root);
  const startingCommit = git(root, ["rev-parse", "HEAD"]);
  const cleanGoal = await readFile(join(root, "GOAL.md"), "utf8");
  await writeFile(join(root, "GOAL.md"), `${cleanGoal}\n<!-- dirty relevant dependency omitted from HEAD -->\n`);
  const dirtyBasis = packet(root).realisationBasis;
  const dirtyBefore = await readFile(join(root, targetPath), "utf8");
  const dirtySpec = candidate(dirtyBasis, `${dirtyBefore}\n// detached-basis refusal\n`, "detached-basis");
  await materialiseCandidate(root, dirtySpec);
  await applyCandidateOperations(root, dirtySpec.digest, candidateOperations(dirtySpec));
  const dirtyCheck = await runGraphDerivedCheck(root, dirtySpec.digest, dirtyBasis.trace.validation[0]!.id);
  assert.equal(dirtyCheck.status, "pass", dirtyCheck.status === "refused" ? dirtyCheck.reasonCode : undefined);
  await assert.rejects(
    () => prepareCandidateIntegration(root, { candidateDigests: [dirtySpec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_DETACHED_BASIS_MISMATCH",
    "a dirty relevant construction dependency absent from the detached carrier refuses",
  );
  await writeFile(join(root, "GOAL.md"), cleanGoal);
  const basis = packet(root).realisationBasis;
  const before = await readFile(join(root, targetPath), "utf8");
  const after = `${before}\n// integrated candidate\n`;
  const spec = candidate(basis, after, "integrated");
  await materialiseCandidate(root, spec);
  await applyCandidateOperations(root, spec.digest, candidateOperations(spec));
  await assert.rejects(
    () => prepareCandidateIntegration(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_CHECK_RECEIPT_MISSING",
    "integrate cannot bypass the explicit durable check stage",
  );
  const check = await runGraphDerivedCheck(root, spec.digest, basis.trace.validation[0]!.id);
  assert.equal(check.status, "pass", check.status === "refused" ? check.reasonCode : undefined);
  const integrationWorktrees = join(root, ".usf", "integration-worktrees");
  const integrationWorktreesBackup = join(root, ".usf", "integration-worktrees-authenticated-backup");
  await rename(integrationWorktrees, integrationWorktreesBackup);
  await symlink(integrationWorktreesBackup, integrationWorktrees, "dir");
  try {
    await assert.rejects(
      () => prepareCandidateIntegration(root, { candidateDigests: [spec.digest] }),
      (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_PRIVATE_STATE_UNSAFE",
      "a symlinked integration-worktree ancestor refuses before Git or removal",
    );
  } finally {
    await unlink(integrationWorktrees);
    await rename(integrationWorktreesBackup, integrationWorktrees);
  }
  await writeFile(join(root, ".gitattributes"), `${targetPath} filter=untrusted\n`);
  await assert.rejects(
    () => prepareCandidateIntegration(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_FILTER_ATTRIBUTE",
  );
  const refusalFiles = (await readdir(join(root, ".usf", "receipts", "integration"))).filter((name) => name.endsWith(".json"));
  const refusalRecords = await Promise.all(refusalFiles.map(async (name) => JSON.parse(await readFile(join(root, ".usf", "receipts", "integration", name), "utf8"))));
  const refusal = refusalRecords.find((record) => record.refusalReason === "INTEGRATION_FILTER_ATTRIBUTE");
  assert.ok(refusal);
  assert.equal(refusal.outcome, "urn:usf:outcome:integration-refused");
  assert.equal(refusal.refusalReason, "INTEGRATION_FILTER_ATTRIBUTE");
  for (const forbidden of ["integratedTreeDigest", "observedCarrierCommit", "observedCarrierTree", "independentlyDerivedPostimageBasisDigest", "postimageValidationResultSetDigest"]) {
    assert.equal(Object.hasOwn(refusal, forbidden), false, `refusal must not fabricate ${forbidden}`);
  }
  await rm(join(root, ".gitattributes"));

  let prepared = await prepareCandidateIntegration(root, { candidateDigests: [spec.digest] });
  assert.equal(git(root, ["rev-parse", "HEAD"]), startingCommit, "dry-run preparation does not move the primary branch");
  assert.equal(await readFile(join(root, targetPath), "utf8"), before);
  assert.equal(prepared.request.candidateCount, 1);
  assert.equal(prepared.request.candidateValidationWallTimeMilliseconds, 120_000);
  assert.equal(prepared.request.postimageValidationWallTimeMilliseconds, 120_000);
  assert.equal(prepared.request.validationTerminationGraceMilliseconds, 5_000);
  assert.equal(prepared.cohortMembers[0]?.originalConstructionBasisDigest, basis.basisDigest);
  assert.equal(prepared.cohortMembers[0]?.validationObligationCount, 1);
  assert.deepEqual(prepared.cohortMembers[0]?.checkedCandidateReceiptDigests, [prepared.checkedCandidateReceipts[0]?.receiptDigest]);
  assert.equal(prepared.cohortMembers[0]?.checkedCandidateReceiptSetDigest, canonicalDigest(prepared.cohortMembers[0]?.checkedCandidateReceiptDigests));
  assert.notEqual(prepared.independentlyDerivedPostimageBasisDigest, "");
  assert.equal(prepared.authoritativeGitDiff[0]?.path, targetPath);
  assert.equal(prepared.nonClaims.includes("integration-observation-not-completion"), true);
  assert.deepEqual(await readdir(join(root, ".usf", "integration-worktrees")), [], "the preparation worktree is short-lived");
  await assert.rejects(() => stat(join(root, ".usf", "locks", "primary-mutation.lock")), { code: "ENOENT" });

  const timeoutWorktree = join(root, ".usf", "integration-worktrees", "f".repeat(64));
  git(root, ["worktree", "add", "--detach", timeoutWorktree, "HEAD"]);
  await chmod(timeoutWorktree, 0o700);
  try {
    const checked = prepared.checkedCandidateReceipts[0]!;
    const shortAuthority: IntegrationValidationAuthority = {
      obligationIri: checked.validationObligationIri,
      command: checked.validationCommandTokens.join(" "),
      commandTokens: checked.validationCommandTokens,
      validationResourceDigest: checked.validationResourceDigest,
      environmentIri: checked.validationEnvironmentIri,
      executionModeIri: checked.validationExecutionModeIri,
      commandDigest: checked.validationCommandDigest,
      environmentDigest: checked.validationEnvironmentDigest,
      executionModeDigest: checked.validationExecutionModeDigest,
      toolDependencies: checked.validationToolDependencies,
      toolDependencyDigest: checked.validationToolDependencyDigest,
      schemaDependencies: checked.validationSchemaDependencies,
      schemaDependencyDigest: checked.validationSchemaDependencyDigest,
      executionAuthorityResourceDigest: checked.validationExecutionAuthorityResourceDigest,
      wallTimeMilliseconds: 1,
      terminationGraceMilliseconds: 5,
      terminationSignal: "SIGTERM",
      forcedTerminationSignal: "SIGKILL",
      maximumSettlementWallTimeMilliseconds: 6,
    };
    await assert.rejects(
      () => runIntegrationValidation({
        phase: "postimage",
        repositoryRoot: timeoutWorktree,
        candidateDigest: spec.digest,
        workIri: basis.work.id,
        explicitProfileIri: profile,
        basis,
        authority: shortAuthority,
        expectedByteDeltaDigest: prepared.cohortMembers[0]!.byteDeltaDigest,
        expectedFileModeDigest: prepared.cohortMembers[0]!.fileModeDigest,
        expectedTreeDigest: prepared.integratedTreeDigest,
      }),
      (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_VALIDATION_TIMEOUT"
        && error.validationExecution?.timedOut === true && error.validationExecution.timeoutTerminationSignal !== "none",
      "short injected authority exercises detached process-group timeout without waiting 125 seconds",
    );
  } finally {
    git(root, ["worktree", "remove", "--force", timeoutWorktree]);
    await rm(timeoutWorktree, { recursive: true, force: true });
  }
  const preparedRef = `refs/usf/integration/${prepared.request.requestDigest.slice("sha256:".length)}`;
  assert.equal(git(root, ["rev-parse", "--verify", preparedRef]), prepared.preparedCarrierCommit);
  assert.equal(gitOutcome(root, ["symbolic-ref", "-q", preparedRef]).status, 1, "the prepared carrier uses a direct ref");

  const requestMembershipSubject = "urn:usf:digest-membership:integration-request:2";
  const memberFieldPredicate = "urn:usf:predicate:memberField";
  const memberIdentity = (): string => canonicalDigest([...objectValues(
    loadSemanticGraph(root, "graph/manifests/integration.json"), requestMembershipSubject, memberFieldPredicate,
  )].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
  const originalMemberIdentity = memberIdentity();
  const integrationGraphPath = join(root, "graph", "integration.nq");
  const originalIntegrationGraph = await readFile(integrationGraphPath, "utf8");
  const reorderedLines = originalIntegrationGraph.split("\n");
  const memberLines = reorderedLines.map((line, index) => ({ line, index })).filter(({ line }) => line.includes(`<${requestMembershipSubject}> <${memberFieldPredicate}>`));
  assert.ok(memberLines.length >= 2);
  [reorderedLines[memberLines[0]!.index], reorderedLines[memberLines[1]!.index]] = [memberLines[1]!.line, memberLines[0]!.line];
  await writeFile(integrationGraphPath, reorderedLines.join("\n"));
  assert.equal(memberIdentity(), originalMemberIdentity, "N-Quad declaration order does not alter canonical member identity");
  assert.equal(prepared.request.requestMemberSetDigest, originalMemberIdentity);
  await writeFile(integrationGraphPath, originalIntegrationGraph);

  const protectedMain = git(root, ["rev-parse", "refs/heads/main"]);
  git(root, ["symbolic-ref", preparedRef, "refs/heads/main"]);
  prepared = await prepareCandidateIntegration(root, { candidateDigests: [spec.digest] });
  assert.equal(git(root, ["rev-parse", "refs/heads/main"]), protectedMain, "pre-existing symref cannot redirect prepared-ref mutation to main");
  assert.equal(gitOutcome(root, ["symbolic-ref", "-q", preparedRef]).status, 1);

  const unrelatedBefore = await readFile(join(root, "README.md"), "utf8");
  const unrelatedAfter = `${unrelatedBefore}\n<!-- preserve unrelated primary dirt -->\n`;
  await writeFile(join(root, "README.md"), unrelatedAfter);
  git(root, ["add", "--", "README.md"]);
  git(root, ["commit", "-m", "unrelated successor after preparation"]);
  const unrelatedDirtyPath = join(root, "unrelated.local");
  await writeFile(unrelatedDirtyPath, "preserve untracked dirt\n");
  const observation = await integrateCandidates(root, { candidateDigests: [spec.digest] });
  assert.equal(observation.outcome, "urn:usf:outcome:integration-success");
  assert.equal(observation.observedCarrierCommit, git(root, ["rev-parse", "HEAD"]));
  assert.equal(observation.observedCarrierTree, git(root, ["rev-parse", "HEAD^{tree}"]));
  assert.equal(await readFile(join(root, targetPath), "utf8"), after);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), unrelatedAfter);
  assert.match(git(root, ["status", "--porcelain=v1", "--", "unrelated.local"]), /^\?\?/u);
  assert.equal(observation.postimageValidationTimedOut, false);
  assert.equal(observation.postimageValidationTimeoutTerminationSignal, "none");
  assert.match(observation.postimageValidationOutputResultDigest, /^sha256:[a-f0-9]{64}$/u);
  const observationPath = join(root, ".usf", "receipts", "integration", `${observation.observationDigest.slice("sha256:".length)}.json`);
  assert.equal((await stat(observationPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, ".usf", "locks", "primary-mutation.lock"))).mode & 0o777, 0o600);
  assert.equal((await JSON.parse(await readFile(observationPath, "utf8"))).schema, "urn:usf:integration-observation:2");
  const markerPath = join(root, ".usf", "receipts", "integration", "markers", `${observation.requestDigest.slice("sha256:".length)}.json`);
  assert.equal((await stat(markerPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).state, "primary-advanced");

  await rm(markerPath);
  await writeFile(join(root, targetPath), `${after}\n// dirty recovery attempt\n`);
  await assert.rejects(
    () => integrateCandidates(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_PRIMARY_TOUCHED_PATH_DIRTY",
  );
  await writeFile(join(root, targetPath), after);
  await writeFile(join(root, targetPath), `${after}\n// staged recovery attempt\n`);
  git(root, ["add", "--", targetPath]);
  await assert.rejects(
    () => integrateCandidates(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_PRIMARY_TOUCHED_PATH_DIRTY",
  );
  await writeFile(join(root, targetPath), after);
  git(root, ["add", "--", targetPath]);
  await integrateCandidates(root, { candidateDigests: [spec.digest] });
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).state, "primary-advanced");

  git(root, ["add", "--", "unrelated.local"]);
  git(root, ["commit", "-m", "unrelated successor"]);
  const primaryLockPath = join(root, ".usf", "locks", "primary-mutation.lock");
  const primaryLockHardlink = `${primaryLockPath}.hardlink`;
  await link(primaryLockPath, primaryLockHardlink);
  await rm(markerPath);
  await assert.rejects(
    () => integrateCandidates(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_LOCK_UNAVAILABLE",
    "marker recovery refuses an aliased primary-mutation lock",
  );
  await unlink(primaryLockHardlink);
  const recovered = await integrateCandidates(root, { candidateDigests: [spec.digest] });
  assert.equal(recovered.observationDigest, observation.observationDigest);
  assert.equal(recovered.recoveryState, observation.recoveryState, "recovery returns the immutable historical observation");
  assert.equal(JSON.parse(await readFile(markerPath, "utf8")).state, "primary-advanced", "recovery recreates the under-lock marker");

  const untamperedObservation = await readFile(observationPath, "utf8");
  const tamperedObservation = JSON.parse(untamperedObservation);
  tamperedObservation.nonClaims = [...tamperedObservation.nonClaims, "same-user-tamper"];
  await writeFile(observationPath, `${canonicalJson(tamperedObservation, { rejectAbsolutePaths: true })}\n`);
  await assert.rejects(
    () => integrateCandidates(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_RECOVERY_QUARANTINED",
    "digest-addressed observation readback authenticates all excluded payload fields",
  );
  await writeFile(observationPath, untamperedObservation);

  const historicalObservation = await readFile(observationPath, "utf8");
  await writeFile(join(root, targetPath), `${after}\n// relevant successor movement\n`);
  git(root, ["add", "--", targetPath]);
  git(root, ["commit", "-m", "relevant successor"]);
  await assert.rejects(
    () => integrateCandidates(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_POSTIMAGE_MOVED",
  );
  assert.equal(await readFile(observationPath, "utf8"), historicalObservation, "relevant movement cannot corrupt the historical observation");
});

test("integration consumes each graph-required validation exactly once in canonical order", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const graph = "urn:usf:graph:semantic-first";
  const semanticPath = join(root, "graph", "semantic-first.nq");
  const semantic = await readFile(semanticPath, "utf8");
  const originalBinding = `<${workId}> <urn:usf:predicate:validation> <urn:usf:validation:realisation-basis-chain-focused> <${graph}> .`;
  assert.equal(semantic.split(originalBinding).length, 2, "the fixture replaces one exact recursive validation binding");
  const validations = [
    {
      iri: "urn:usf:validation:realisation-basis-chain-focused-primary",
      command: "node --test --test-isolation=none tests/unit/providers/routing.test.ts",
    },
    {
      iri: "urn:usf:validation:realisation-basis-chain-focused-secondary",
      command: "node --test --test-isolation=none tests/contract/fake-call-resolve.test.ts",
    },
  ];
  const statements = validations.flatMap(({ iri, command }) => [
    `<${iri}> <urn:usf:predicate:type> <urn:usf:type:TestObligation> <${graph}> .`,
    `<${iri}> <urn:usf:predicate:command> ${JSON.stringify(command)} <${graph}> .`,
    `<${iri}> <urn:usf:predicate:environment> <urn:usf:environment:hermetic> <${graph}> .`,
    `<${iri}> <urn:usf:predicate:executionMode> <urn:usf:mode:deterministic-test-substitute> <${graph}> .`,
    `<${iri}> <urn:usf:predicate:applicability> "required" <${graph}> .`,
    `<${iri}> <urn:usf:predicate:hostToolDependency> <urn:usf:host-tool:bwrap:0.9.0> <${graph}> .`,
    `<${workId}> <urn:usf:predicate:validation> <${iri}> <${graph}> .`,
  ]);
  await writeFile(semanticPath, `${semantic.replace(`${originalBinding}\n`, "").trimEnd()}\n${statements.join("\n")}\n`);
  initialiseGit(root);
  const basis = packet(root).realisationBasis;
  const validationIris = basis.trace.validation.map((reference) => reference.id)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  assert.equal(validationIris.length, 2);

  const before = await readFile(join(root, targetPath), "utf8");
  const spec = candidate(basis, `${before}\n// two-validation candidate\n`, "two-validation");
  await materialiseCandidate(root, spec);
  await applyCandidateOperations(root, spec.digest, candidateOperations(spec));
  const firstCheck = await runGraphDerivedCheck(root, spec.digest, validationIris[0]!);
  assert.equal(firstCheck.status, "pass", firstCheck.status === "refused" ? firstCheck.reasonCode : undefined);
  await assert.rejects(
    () => prepareCandidateIntegration(root, { candidateDigests: [spec.digest] }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_CHECK_RECEIPT_MISSING",
    "one receipt cannot stand in for the complete graph-required validation set",
  );
  const secondCheck = await runGraphDerivedCheck(root, spec.digest, validationIris[1]!);
  assert.equal(secondCheck.status, "pass", secondCheck.status === "refused" ? secondCheck.reasonCode : undefined);

  const duplicateResult = canonicalDigest("duplicate-postimage-result");
  await assert.rejects(
    () => prepareCandidateIntegration(root, {
      candidateDigests: [spec.digest],
      verifier: async () => ({ outcome: "pass", resultDigests: [duplicateResult, duplicateResult] }),
    }),
    (error: unknown) => error instanceof IntegrationError && error.reasonCode === "INTEGRATION_VALIDATION_FAILED",
    "duplicate verifier results cannot inflate or satisfy the required validation set",
  );

  const observedAuthorities: Array<{ obligation: string; executionAuthority: string }> = [];
  const prepared = await prepareCandidateIntegration(root, {
    candidateDigests: [spec.digest],
    verifier: async ({ authority }) => {
      observedAuthorities.push({ obligation: authority.obligationIri, executionAuthority: authority.executionAuthorityResourceDigest });
      return { outcome: "pass", resultDigests: [canonicalDigest({ obligation: authority.obligationIri })] };
    },
  });
  assert.equal(prepared.schema, "urn:usf:prepared-candidate-integration:2");
  assert.equal(prepared.request.algorithmVersion, "3");
  assert.deepEqual(prepared.checkedCandidateReceipts.map((receipt) => receipt.validationObligationIri), validationIris);
  assert.deepEqual(prepared.cohortMembers[0]?.checkedCandidateReceiptDigests, prepared.checkedCandidateReceipts.map((receipt) => receipt.receiptDigest));
  assert.equal(prepared.cohortMembers[0]?.validationObligationCount, 2);
  assert.equal(prepared.request.checkedCandidateSetDigest, canonicalDigest(prepared.checkedCandidateReceipts.map((receipt) => receipt.receiptDigest)));
  assert.deepEqual(prepared.postimageValidationResults.map((result) => result.validationObligationIri), validationIris);
  assert.deepEqual(observedAuthorities.map(({ obligation }) => obligation), validationIris);
  assert.equal(observedAuthorities.every(({ executionAuthority }) => executionAuthority === prepared.request.algorithmResourceDigest), true);
  assert.equal(prepared.checkedCandidateReceipts.every((receipt) => receipt.validationExecutionAuthorityResourceDigest !== prepared.request.algorithmResourceDigest), true);
});

test("integration cohort ingress refuses invalid bounds and duplicate locators before preparation", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  initialiseGit(root);
  const digest = canonicalDigest("candidate-locator");
  const scenarios = [
    { candidateDigests: [] as string[], reason: "INTEGRATION_CANDIDATE_COUNT_INVALID" },
    { candidateDigests: Array.from({ length: 33 }, (_, index) => canonicalDigest({ index })), reason: "INTEGRATION_CANDIDATE_COUNT_INVALID" },
    { candidateDigests: [digest, digest], reason: "INTEGRATION_DUPLICATE_CANDIDATE" },
  ];
  for (const scenario of scenarios) {
    await assert.rejects(
      () => prepareCandidateIntegration(root, { candidateDigests: scenario.candidateDigests }),
      (error: unknown) => error instanceof IntegrationError && error.reasonCode === scenario.reason,
      scenario.reason,
    );
  }
});
