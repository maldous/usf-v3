import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, cp, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { candidateArtifactDigest } from "../../../src/providers/types.ts";
import { canonicalDigest, canonicalJson, sha256 } from "../../../src/core/canonical.ts";
import {
  RegistrationFeatureError,
  registrationFeatureDigestsEqual,
  registrationFeatureOperations,
  registrationFeatureOperationsDigest,
  registrationFeaturePostimageSet,
  registrationFeaturePostimageSetDigest,
} from "../../../src/collaboration/resolve.ts";
import { authenticateGraphDerivedCheckIntent, readGraphDerivedCheckFailureDiagnostic, runGraphDerivedCheck } from "../../../src/commands/check.ts";
import { apply } from "../../../src/commands/apply.ts";
import { loadSemanticGraph, objectValues } from "../../../src/graph/index.ts";
import { deriveWork, type WorkPacket } from "../../../src/graph/work.ts";
import {
  applyCandidateOperations,
  applyResolvedCandidate,
  authenticateCandidateWorkspace,
  candidateScope,
  candidateOperations,
  currentCandidateWorkspace,
  deriveCandidatePreimages,
  deriveNoChangeCandidateIdentity,
  materialiseCandidate,
  materialiseNoChangeCandidate,
  maximumWorkspaceManifestBytes,
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
  const digest = candidateArtifactDigest({ basisDigest: basis.basisDigest, operations, acceptedContributionDigests });
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

async function twoOperationCandidate(root: string, basis: RealisationBasis, nonce: string): Promise<CandidateSpec> {
  const first = targetPath;
  const second = "tests/fixtures/providers/ordinary-recovery-generated.json";
  const before = await readFile(join(root, first), "utf8");
  const operations = [
    { kind: "write" as const, path: second, content: "{\"ordinaryRecovery\":true}\n" },
    { kind: "write" as const, path: first, content: `${before}\n// ordinary recovery first effect\n` },
  ];
  const acceptedContributionDigests = [canonicalDigest({ nonce })];
  return {
    digest: candidateArtifactDigest({ basisDigest: basis.basisDigest, operations, acceptedContributionDigests }),
    basis,
    operations,
    lineage: { acceptedContributionDigests, rejected: [] },
    scope: candidateScope(basis),
    writeSet: operations.map(operation => operation.path),
    preimages: await deriveCandidatePreimages(root, basis, operations.map(operation => operation.path)),
  };
}

type WorkspaceInterruptionBoundary = "beforemanifest" | "aftermanifest" | "betweeneffects" | "afterfinal";

async function expectedDeltaBytes(root: string, spec: CandidateSpec): Promise<Readonly<Record<string, string | null>>> {
  return Object.fromEntries(await Promise.all(candidateOperations(spec).map(async operation => [
    operation.path,
    (await readFile(join(root, operation.path)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }))?.toString("base64") ?? null,
  ])));
}

function assertOriginalDelta(
  delta: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[],
  spec: CandidateSpec,
  before: Readonly<Record<string, string | null>>,
): void {
  const expected = candidateOperations(spec).map(operation => ({
    path: operation.path,
    before: before[operation.path]!,
    after: operation.kind === "write" ? operation.bytes : null,
  })).sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(delta.map(({ path, before: prior, after }) => ({ path, before: prior, after })), expected);
}

async function interruptResolvedCandidate(root: string, spec: CandidateSpec, boundary: WorkspaceInterruptionBoundary): Promise<void> {
  const input = join(root, "..", `ordinary-recovery-${boundary}.json`);
  await writeFile(input, JSON.stringify(spec), { mode: 0o600 });
  const child = spawn(process.execPath, [resolve(sourceRoot, "tests/fixtures/realisation/workspace-interruption.ts"),
    root, sourceRoot, input, boundary], { cwd: root, env: {}, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let reached: { readonly boundary: WorkspaceInterruptionBoundary; readonly completedOperations: number } | null = null;
  let stdout = "";
  let stderr = "";
  let outputOverflow = false;
  const collect = (current: string, chunk: unknown): string => {
    const next = `${current}${String(chunk)}`;
    if (next.length > 16_384) {
      outputOverflow = true;
      child.kill("SIGKILL");
    }
    return next.slice(0, 16_384);
  };
  child.stdout!.on("data", chunk => { stdout = collect(stdout, chunk); });
  child.stderr!.on("data", chunk => { stderr = collect(stderr, chunk); });
  child.on("message", message => {
    if (message !== null && typeof message === "object" && (message as { kind?: string; boundary?: unknown; completedOperations?: unknown }).kind === "boundary") {
      const observed = message as { readonly boundary?: unknown; readonly completedOperations?: unknown };
      if (observed.boundary === boundary && Number.isSafeInteger(observed.completedOperations)) {
        reached = { boundary, completedOperations: observed.completedOperations as number };
      }
      child.kill("SIGKILL");
    }
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 300_000);
  try {
    const ended = await new Promise<{ readonly signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (_code, signal) => accept({ signal }));
    });
    assert.equal(outputOverflow, false, `fixture output exceeded bound\nstdout: ${stdout}\nstderr: ${stderr}`);
    assert.ok(reached, `fixture did not report the requested boundary\nstdout: ${stdout}\nstderr: ${stderr}`);
    const observedBoundary = reached as { readonly boundary: WorkspaceInterruptionBoundary; readonly completedOperations: number };
    assert.equal(observedBoundary.boundary, boundary);
    assert.equal(observedBoundary.completedOperations, boundary === "betweeneffects" ? 1 : boundary === "afterfinal" ? 2 : 0);
    assert.equal(ended.signal, "SIGKILL");
  } finally {
    clearTimeout(timeout);
    await unlink(input).catch(() => undefined);
  }
}

async function driftPrimaryDuringDeltaReadback(root: string, spec: CandidateSpec): Promise<void> {
  const input = join(root, "..", "ordinary-recovery-delta-readback.json");
  await writeFile(input, JSON.stringify(spec), { mode: 0o600 });
  const child = spawn(process.execPath, [resolve(sourceRoot, "tests/fixtures/realisation/workspace-interruption.ts"),
    root, sourceRoot, input, "deltareadback"], { cwd: root, env: {}, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stdout = "";
  let stderr = "";
  let overflow = false;
  let reached = false;
  let failure: { readonly reasonCode?: unknown } | null = null;
  const collect = (current: string, chunk: unknown): string => {
    const next = `${current}${String(chunk)}`;
    if (next.length > 16_384) {
      overflow = true;
      child.kill("SIGKILL");
    }
    return next.slice(0, 16_384);
  };
  child.stdout!.on("data", chunk => { stdout = collect(stdout, chunk); });
  child.stderr!.on("data", chunk => { stderr = collect(stderr, chunk); });
  child.on("message", async message => {
    if (message !== null && typeof message === "object" && (message as { kind?: unknown }).kind === "boundary") {
      const observed = message as { readonly boundary?: unknown; readonly completedOperations?: unknown };
      if (observed.boundary !== "deltareadback" || observed.completedOperations !== 2) return;
      reached = true;
      const primary = await readFile(join(root, targetPath), "utf8");
      await writeFile(join(root, targetPath), `${primary}\n// drift after delta capture\n`, { mode: 0o644 });
      child.send({ kind: "continue" });
    }
    if (message !== null && typeof message === "object" && (message as { kind?: unknown }).kind === "error") {
      failure = message as { readonly reasonCode?: unknown };
    }
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 300_000);
  try {
    const ended = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => accept({ code, signal }));
    });
    assert.equal(overflow, false, `fixture output exceeded bound\nstdout: ${stdout}\nstderr: ${stderr}`);
    assert.equal(reached, true, `fixture did not reach delta readback\nstdout: ${stdout}\nstderr: ${stderr}`);
    assert.equal(ended.signal, null);
    assert.equal(ended.code, 0);
    assert.equal((failure as { readonly reasonCode?: unknown } | null)?.reasonCode, "STALE_REALISATION_BASIS");
  } finally {
    clearTimeout(timeout);
    await unlink(input).catch(() => undefined);
  }
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

function cliApply(root: string, input: string): ReturnType<typeof spawnSync> {
  return spawnSync("/bin/sh", [resolve(sourceRoot, "bin/usf"), "apply", "--input", input], {
    cwd: root,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("materialises one basis-bound candidate and applies only its exact byte delta", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  const before = await readFile(join(root, targetPath), "utf8");
  const content = `/** Opaque source content, not a filesystem path. */\n${before}\n// isolated candidate byte\n`;
  const spec = candidate(basis, content, "happy");
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
  assert.equal(await readFile(join(materialised.workspace, targetPath), "utf8"), content);

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

test("ordinary candidate recovery classifies absent, materialised and fully applied states without rebuilding retained bytes", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;

  const absent = await twoOperationCandidate(root, basis, "ordinary-absent");
  const absentBefore = await expectedDeltaBytes(root, absent);
  const commandResult = await apply(root, { candidate: absent });
  assert.equal(commandResult.status, "applied");
  if (commandResult.status !== "applied") throw new Error("Apply command wrapper unexpectedly refused the resolved candidate");
  const created = commandResult;
  assertOriginalDelta(created.delta, absent, absentBefore);
  const appliedManifest = await readFile(join(created.workspace, ".usf-workspace.json"));
  const appliedTarget = await stat(join(created.workspace, targetPath));
  const replay = await applyResolvedCandidate(root, absent);
  assert.equal(replay.disposition, "reused");
  assert.deepEqual(replay.delta, created.delta, "replay returns the original primary-to-postimage delta");
  assert.deepEqual(await readFile(join(replay.workspace, ".usf-workspace.json")), appliedManifest);
  assert.equal((await stat(join(replay.workspace, targetPath))).ino, appliedTarget.ino, "fully applied replay must not rewrite retained bytes");

  initialiseGit(root);
  const cliInput = ".usf/inputs/ordinary-cli-replay.json";
  await mkdir(join(root, ".usf", "inputs"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, cliInput), JSON.stringify({ candidate: absent }), { mode: 0o600 });
  try {
    const cli = cliApply(root, cliInput);
    assert.equal(cli.status, 0, String(cli.stderr ?? ""));
    const output = JSON.parse(String(cli.stdout ?? "")) as { readonly schema?: unknown; readonly status?: unknown; readonly delta?: unknown; readonly workspace?: unknown };
    assert.equal(output.schema, "urn:usf:apply-result:1");
    assert.equal(output.status, "applied");
    assert.deepEqual(output.delta, created.delta);
    assert.equal(output.workspace, `.usf/workspaces/${absent.digest.slice("sha256:".length)}`);
    assert.deepEqual(await readFile(join(created.workspace, ".usf-workspace.json")), appliedManifest);
    assert.equal((await stat(join(created.workspace, targetPath))).ino, appliedTarget.ino, "CLI replay must not rewrite the retained workspace");
  } finally {
    await unlink(join(root, cliInput)).catch(() => undefined);
  }

  const callerMutation = await twoOperationCandidate(root, basis, "ordinary-caller-mutation");
  const callerSnapshot = structuredClone(callerMutation) as CandidateSpec;
  const pendingCallerMutation = applyResolvedCandidate(root, callerMutation);
  const mutableOperations = callerMutation.operations as unknown as Array<{ kind: "write"; path: string; content: string }>;
  mutableOperations[0] = { ...mutableOperations[0]!, content: "caller-mutated-after-invocation\n" };
  const callerApplied = await pendingCallerMutation;
  assert.equal(callerApplied.disposition, "applied");
  assertOriginalDelta(callerApplied.delta, callerSnapshot, await expectedDeltaBytes(root, callerSnapshot));

  const materialisedSpec = await twoOperationCandidate(root, basis, "ordinary-materialised");
  const materialisedBefore = await expectedDeltaBytes(root, materialisedSpec);
  const materialised = await materialiseCandidate(root, materialisedSpec);
  const manifest = await readFile(join(materialised.workspace, ".usf-workspace.json"));
  const workspace = await stat(materialised.workspace);
  const continued = await applyResolvedCandidate(root, materialisedSpec);
  assert.equal(continued.disposition, "applied");
  assertOriginalDelta(continued.delta, materialisedSpec, materialisedBefore);
  assert.equal((await stat(continued.workspace)).ino, workspace.ino, "materialised recovery must retain the original workspace directory");
  assert.deepEqual(await readFile(join(continued.workspace, ".usf-workspace.json")), manifest);

  const partialSpec = await twoOperationCandidate(root, basis, "ordinary-partial");
  const partial = await materialiseCandidate(root, partialSpec);
  const first = partialSpec.operations[0]!;
  if (first.kind !== "write" || first.content === undefined) throw new Error("partial recovery requires an exact write operation");
  await writeFile(join(partial.workspace, first.path), first.content, { mode: 0o644 });
  const retained = await readFile(join(partial.workspace, first.path));
  await assert.rejects(
    () => applyResolvedCandidate(root, partialSpec),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_BASIS_MISMATCH",
  );
  assert.deepEqual(await readFile(join(partial.workspace, first.path)), retained, "mixed postimages must be preserved, not repaired");

  const partialCliInput = ".usf/inputs/ordinary-cli-partial.json";
  await writeFile(join(root, partialCliInput), JSON.stringify({ candidate: partialSpec }), { mode: 0o600 });
  try {
    const cli = cliApply(root, partialCliInput);
    assert.notEqual(cli.status, 0);
    const output = JSON.parse(String(cli.stdout ?? "")) as { readonly schema?: unknown; readonly status?: unknown; readonly reasonCode?: unknown };
    assert.equal(output.schema, "urn:usf:apply-result:1");
    assert.equal(output.status, "refused");
    assert.equal(output.reasonCode, "CANDIDATE_BASIS_MISMATCH");
  } finally {
    await unlink(join(root, partialCliInput)).catch(() => undefined);
  }

  const manifestOnlySpec = await twoOperationCandidate(root, basis, "ordinary-manifest-only");
  const manifestOnly = await materialiseCandidate(root, manifestOnlySpec);
  const manifestOnlyBytes = await readFile(join(manifestOnly.workspace, ".usf-workspace.json"));
  await rm(manifestOnly.workspace, { recursive: true, force: true });
  await mkdir(manifestOnly.workspace, { mode: 0o700 });
  await writeFile(join(manifestOnly.workspace, ".usf-workspace.json"), manifestOnlyBytes, { mode: 0o600 });
  await assert.rejects(
    () => applyResolvedCandidate(root, manifestOnlySpec),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_BASIS_MISMATCH",
  );
  assert.deepEqual(await readFile(join(manifestOnly.workspace, ".usf-workspace.json")), manifestOnlyBytes);

  const driftRoot = await fixture(context);
  const driftSpec = await twoOperationCandidate(driftRoot, packet(driftRoot).realisationBasis, "ordinary-delta-readback");
  await driftPrimaryDuringDeltaReadback(driftRoot, driftSpec);
  const driftWorkspace = join(driftRoot, ".usf", "workspaces", driftSpec.digest.slice("sha256:".length));
  await stat(join(driftWorkspace, ".usf-workspace.json"));
});

test("ordinary candidate recovery preserves genuine SIGKILL boundaries and releases the candidate lock", async (context) => {
  if (lockProcessUnavailable(context)) return;
  for (const boundary of ["beforemanifest", "aftermanifest", "betweeneffects", "afterfinal"] as const) {
    const root = await fixture(context);
    const basis = packet(root).realisationBasis;
    const spec = await twoOperationCandidate(root, basis, `ordinary-interruption-${boundary}`);
    const before = await expectedDeltaBytes(root, spec);
    await interruptResolvedCandidate(root, spec, boundary);
    await withCandidateLock(root, spec.digest, async () => undefined);

    const workspace = join(root, ".usf", "workspaces", spec.digest.slice("sha256:".length));
    const manifest = join(workspace, ".usf-workspace.json");
    if (boundary === "beforemanifest") await assert.rejects(() => readFile(manifest), { code: "ENOENT" });
    else await stat(manifest);
    if (boundary === "beforemanifest" || boundary === "betweeneffects") {
      const before = await readdir(workspace);
      await assert.rejects(
        () => applyResolvedCandidate(root, spec),
        (error: unknown) => error instanceof RealisationError && error.reasonCode === (boundary === "beforemanifest" ? "INVALID_WORKSPACE_MANIFEST" : "CANDIDATE_BASIS_MISMATCH"),
        boundary,
      );
      assert.deepEqual(await readdir(workspace), before, `${boundary} refusal must preserve the retained workspace inventory`);
      continue;
    }

    const recovered = await applyResolvedCandidate(root, spec);
    assert.equal(recovered.disposition, boundary === "aftermanifest" ? "applied" : "reused");
    assertOriginalDelta(recovered.delta, spec, before);
  }
});

test("ordinary candidate recovery preserves invalid retained states and never steals a busy lock", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  for (const scenario of ["manifest-missing", "extra", "temporary", "mode"] as const) {
    const spec = await twoOperationCandidate(root, basis, `ordinary-invalid-${scenario}`);
    const materialised = await materialiseCandidate(root, spec);
    const manifest = join(materialised.workspace, ".usf-workspace.json");
    const existingScopedOperation = spec.operations.find(operation => operation.path === targetPath);
    assert.ok(existingScopedOperation, "the ordinary recovery matrix requires one existing scoped file");
    const first = join(materialised.workspace, existingScopedOperation.path);
    const extra = join(materialised.workspace, "unexpected-retained-byte");
    if (scenario === "manifest-missing") await unlink(manifest);
    if (scenario === "extra") await writeFile(extra, "preserve extra\n", { mode: 0o600 });
    if (scenario === "temporary") await writeFile(`${manifest}.usf-interrupted`, "preserve temporary\n", { mode: 0o600 });
    if (scenario === "mode") await chmod(first, 0o755);
    const retained = scenario === "manifest-missing" ? null : await readFile(manifest).catch(() => null);
    await assert.rejects(
      () => applyResolvedCandidate(root, spec),
      (error: unknown) => error instanceof RealisationError && error.reasonCode === (scenario === "manifest-missing" ? "INVALID_WORKSPACE_MANIFEST" : "CANDIDATE_BASIS_MISMATCH"),
      scenario,
    );
    if (retained === null) await assert.rejects(() => readFile(manifest), { code: "ENOENT" });
    else assert.deepEqual(await readFile(manifest), retained);
    if (scenario === "extra") assert.equal(await readFile(extra, "utf8"), "preserve extra\n");
    if (scenario === "temporary") assert.equal(await readFile(`${manifest}.usf-interrupted`, "utf8"), "preserve temporary\n");
    if (scenario === "mode") assert.equal((await stat(first)).mode & 0o777, 0o755);
  }

  const hardlinked = await twoOperationCandidate(root, basis, "ordinary-hardlink");
  const hardlinkedWorkspace = await materialiseCandidate(root, hardlinked);
  const hardlinkedOperation = hardlinked.operations.find(operation => operation.path === targetPath);
  assert.ok(hardlinkedOperation, "the ordinary recovery matrix requires one existing scoped file");
  const hardlinkedTarget = join(hardlinkedWorkspace.workspace, hardlinkedOperation.path);
  const retainedHardlink = join(root, "ordinary-retained-hardlink");
  await link(hardlinkedTarget, retainedHardlink);
  try {
    assert.ok((await stat(hardlinkedTarget)).nlink > 1, "the scoped workspace file must have a retained external hardlink");
    await assert.rejects(
      () => applyResolvedCandidate(root, hardlinked),
      (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_BASIS_MISMATCH",
      "a regular scoped file with multiple links is not an authenticated retained workspace byte",
    );
    assert.ok((await stat(hardlinkedTarget)).nlink > 1, "hardlink refusal must preserve the retained workspace");
  } finally {
    await unlink(retainedHardlink).catch(() => undefined);
  }

  const stale = await twoOperationCandidate(root, basis, "ordinary-stale");
  const staleWorkspace = await materialiseCandidate(root, stale);
  const primary = await readFile(join(root, targetPath), "utf8");
  await writeFile(join(root, targetPath), `${primary}\n// stale primary\n`);
  const retainedManifest = await readFile(join(staleWorkspace.workspace, ".usf-workspace.json"));
  await assert.rejects(
    () => applyResolvedCandidate(root, stale),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "STALE_REALISATION_BASIS",
  );
  assert.deepEqual(await readFile(join(staleWorkspace.workspace, ".usf-workspace.json")), retainedManifest);

  const busyRoot = await fixture(context);
  const busy = await twoOperationCandidate(busyRoot, packet(busyRoot).realisationBasis, "ordinary-busy");
  let entered!: () => void;
  let release!: () => void;
  const acquired = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const lock = withCandidateLock(busyRoot, busy.digest, async () => { entered(); await held; });
  await acquired;
  try {
    await assert.rejects(
      () => applyResolvedCandidate(busyRoot, busy),
      (error: unknown) => error instanceof RealisationError && error.reasonCode === "CANDIDATE_BUSY",
    );
  } finally {
    release();
    await lock;
  }
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

test("roundtrips a workspace manifest above the old bound through native and check-intent readers", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  const content = "/*" + "x".repeat(Math.floor(maximumWorkspaceManifestBytes * 3 / 4)) + "*/\n";
  const spec = candidate(basis, content, "large-manifest-roundtrip");
  const materialised = await materialiseCandidate(root, spec);
  const manifestFile = join(materialised.workspace, ".usf-workspace.json");
  const manifestBytes = await readFile(manifestFile);
  assert.ok(manifestBytes.byteLength > 512 * 1024, "fixture must cross the previous serialized manifest limit");
  assert.ok(manifestBytes.byteLength <= maximumWorkspaceManifestBytes);
  assert.equal(JSON.parse(manifestBytes.toString("utf8")).digest, spec.digest);
  await applyCandidateOperations(root, spec.digest, candidateOperations(spec));
  assert.equal(await readFile(join(materialised.workspace, targetPath), "utf8"), content);
  const authenticated = await authenticateCandidateWorkspace(root, spec.digest);
  assert.equal(authenticated.candidateDigest, spec.digest);
  assert.equal((await currentCandidateWorkspace(root, spec.digest)).basis.basisDigest, basis.basisDigest);
  await withCandidateLock(root, spec.digest, async () => {
    const before = await stat(manifestFile);
    assert.equal(await authenticateGraphDerivedCheckIntent(root, spec.digest, basis.trace.validation[0]!.id), "ABSENT",
      "the real check-intent preflight must read the large manifest without running or fabricating a check");
    assert.deepEqual(await readFile(manifestFile), manifestBytes);
    const after = await stat(manifestFile);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.ctimeMs, before.ctimeMs);
  });
  const ordinary = candidate(basis, "ordinary retained manifest\n", "small-manifest-replay");
  const small = await materialiseCandidate(root, ordinary);
  await applyCandidateOperations(root, ordinary.digest, candidateOperations(ordinary));
  const smallPath = join(small.workspace, ".usf-workspace.json");
  const smallBytes = await readFile(smallPath);
  assert.deepEqual(await currentCandidateWorkspace(root, ordinary.digest), await currentCandidateWorkspace(root, ordinary.digest));
  assert.deepEqual(await readFile(smallPath), smallBytes, "small retained manifest bytes and identities must remain unchanged");
  context.diagnostic(JSON.stringify({ workspaceManifestCapacity: { serializedBytes: manifestBytes.byteLength,
    maximumBytes: maximumWorkspaceManifestBytes, previousMaximumBytes: 512 * 1024,
    smallSerializedBytes: smallBytes.byteLength, checkIntent: "ABSENT", candidateDigest: spec.digest } }));
});

test("preflights an oversized workspace manifest before changing an existing workspace", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  const oversized = candidate(basis, "x".repeat(maximumWorkspaceManifestBytes), "manifest-oversize");
  const workspace = join(root, ".usf", "workspaces", oversized.digest.slice("sha256:".length));
  await assert.rejects(() => materialiseCandidate(root, oversized),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "INVALID_WORKSPACE_MANIFEST");
  await assert.rejects(() => stat(workspace), { code: "ENOENT" });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const sentinel = join(workspace, "preserved-before-preflight");
  await writeFile(sentinel, "unchanged\n", { mode: 0o600 });

  await assert.rejects(
    () => materialiseCandidate(root, oversized),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "INVALID_WORKSPACE_MANIFEST",
  );
  assert.equal(await readFile(sentinel, "utf8"), "unchanged\n");
  assert.deepEqual((await readdir(workspace)).sort(), ["preserved-before-preflight"]);

  const ordinary = candidate(basis, "ordinary candidate bytes\n", "manifest-ordinary");
  const materialised = await materialiseCandidate(root, ordinary);
  await applyCandidateOperations(root, ordinary.digest, candidateOperations(ordinary));
  assert.equal(await readFile(join(materialised.workspace, targetPath), "utf8"), "ordinary candidate bytes\n");
});

test("preflights an oversized no-change workspace manifest before changing an existing workspace", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const work = packet(root);
  assert.equal(work.realisationBasis.authority.effectiveAuthority, "active-permission");
  const policy = {
    iri: `urn:usf:policy:workspace-manifest-preflight-test:${"x".repeat(maximumWorkspaceManifestBytes)}`,
    algorithmIri: "urn:usf:algorithm:workspace-manifest-preflight-test",
    resourceDigest: `sha256:${"a".repeat(64)}`,
    algorithmResourceDigest: `sha256:${"b".repeat(64)}`,
  } as const;
  const candidateDigest = await deriveNoChangeCandidateIdentity(root, work.realisationBasis, policy);
  const workspace = join(root, ".usf", "workspaces", candidateDigest.slice("sha256:".length));
  await assert.rejects(() => materialiseNoChangeCandidate(root, work.realisationBasis, policy),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "INVALID_WORKSPACE_MANIFEST");
  await assert.rejects(() => stat(workspace), { code: "ENOENT" });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const sentinel = join(workspace, "preserved-before-preflight");
  await writeFile(sentinel, "unchanged\n", { mode: 0o600 });

  await assert.rejects(
    () => materialiseNoChangeCandidate(root, work.realisationBasis, policy),
    (error: unknown) => error instanceof RealisationError && error.reasonCode === "INVALID_WORKSPACE_MANIFEST",
  );
  assert.equal(await readFile(sentinel, "utf8"), "unchanged\n");
  assert.deepEqual((await readdir(workspace)).sort(), ["preserved-before-preflight"]);
});

test("reads only the current digest-bound failed-check diagnostic and refuses tamper or conflict", async (context) => {
  if (lockProcessUnavailable(context)) return;
  const root = await fixture(context);
  const basis = packet(root).realisationBasis;
  const spec = candidate(basis, "diagnostic-reader-candidate\n", "diagnostic-reader");
  await materialiseCandidate(root, spec);
  await applyCandidateOperations(root, spec.digest, candidateOperations(spec));
  const validationId = basis.trace.validation[0]!.id;
  const candidateHash = spec.digest.slice("sha256:".length);
  const validationHash = canonicalDigest(validationId).slice("sha256:".length);
  const stdout = Buffer.from("failed child output\n");
  const stderr = Buffer.from("failed child error\n");
  const intentDigest = canonicalDigest("diagnostic-intent");
  const executionInputDigest = canonicalDigest("diagnostic-input");
  const base = {
    intentDigest, executionInputDigest, candidateDigest: spec.digest, validationObligationIri: validationId,
    workIri: basis.work.id, explicitProfileIri: basis.selection.profile,
    originalConstructionBasisDigest: basis.basisDigest, scopedDependencyDigest: basis.work.scopedDependencyDigest,
    validationResourceDigest: canonicalDigest("resource"), validationCommandDigest: canonicalDigest("command"),
    validationEnvironmentDigest: canonicalDigest("environment"), validationExecutionModeDigest: canonicalDigest("mode"),
    validationExecutionAuthorityResourceDigest: canonicalDigest("authority"), exitCode: 1, timedOut: false,
    timeoutTerminationSignal: "none" as const, outputLimitBytes: 262144, outputWithinLimit: true,
    stdoutObservedBytes: stdout.byteLength, stderrObservedBytes: stderr.byteLength,
    stdoutCapturedBase64: stdout.toString("base64"), stderrCapturedBase64: stderr.toString("base64"),
    outputTruncated: false,
  };
  const name = canonicalDigest({ intentDigest, executionInputDigest, exitCode: 1, timedOut: false,
    stdout: sha256(stdout), stderr: sha256(stderr) }).slice("sha256:".length) + ".json";
  const diagnosticPath = `.usf/diagnostics/check/${candidateHash}/${validationHash}/${name}`;
  const record = { ...base, diagnosticPath };
  const diagnostic = { diagnosticDigest: canonicalDigest(record, { rejectAbsolutePaths: true }), ...record };
  const path = join(root, diagnosticPath);
  await mkdir(join(root, ".usf/diagnostics/check", candidateHash, validationHash), { recursive: true, mode: 0o700 });
  await writeFile(path, canonicalJson(diagnostic, { rejectAbsolutePaths: true }), { mode: 0o600 });
  const available = await readGraphDerivedCheckFailureDiagnostic(root, spec.digest, validationId);
  assert.equal(available.status, "available");
  if (available.status === "available") assert.deepEqual(available.diagnostic, diagnostic);
  const before = await readFile(path);
  const tampered = JSON.parse(before.toString("utf8")) as Record<string, unknown>;
  tampered.exitCode = 2;
  await writeFile(path, canonicalJson(tampered, { rejectAbsolutePaths: true }));
  const stale = await readGraphDerivedCheckFailureDiagnostic(root, spec.digest, validationId);
  assert.deepEqual(stale, { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" });
  await writeFile(path, before);
  await writeFile(join(root, ".usf/diagnostics/check", candidateHash, validationHash, "f".repeat(64) + ".json"), before, { mode: 0o600 });
  const conflict = await readGraphDerivedCheckFailureDiagnostic(root, spec.digest, validationId);
  assert.deepEqual(conflict, { status: "refused", reasonCode: "CHECK_DIAGNOSTIC_INVALID" });
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
  assert.equal(prepared.request.candidateValidationWallTimeMilliseconds, 300_000);
  assert.equal(prepared.request.postimageValidationWallTimeMilliseconds, 300_000);
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
  const secondaryClosure = `${validations[1]!.iri}:runtime-closure:1`;
  statements.push(
    `<${secondaryClosure}> <urn:usf:predicate:type> <urn:usf:type:ValidationRuntimeClosure> <${graph}> .`,
    `<${secondaryClosure}> <urn:usf:predicate:version> "1" <${graph}> .`,
    `<${secondaryClosure}> <urn:usf:predicate:forValidation> <${validations[1]!.iri}> <${graph}> .`,
    ...[
      "schemas/call-result.schema.json",
      "schemas/cli-transition-descriptor.schema.json",
      "schemas/cli-transition-interrogation.schema.json",
      "schemas/provider-config.schema.json",
      "schemas/resolve-result.schema.json",
      "schemas/route-qualification-receipt.schema.json",
      "src/collaboration/local-contribution.ts",
      "src/collaboration/resolve.ts",
      "src/commands/call.ts",
      "src/commands/check.ts",
      "src/commands/command-input.ts",
      "src/commands/dispatcher.ts",
      "src/commands/graph-leaf-dispatch.ts",
      "src/commands/help.ts",
      "src/commands/provider-leaf-dispatch.ts",
      "src/commands/resolve.ts",
      "src/commands/transition.ts",
      "src/continuous/lifecycle.ts",
      "src/core/canonical.ts",
      "src/core/errors.ts",
      "src/core/scope.ts",
      "src/graph/cli-transitions.ts",
      "src/graph/index.ts",
      "src/graph/linear-binding.ts",
      "src/graph/nquads.ts",
      "src/graph/query.ts",
      "src/graph/work.ts",
      "src/providers/fake.ts",
      "src/providers/types.ts",
      "src/realisation/basis.ts",
      "src/realisation/construction-authority.ts",
      "src/realisation/fixture-process.ts",
      "src/realisation/index.ts",
      "src/realisation/transition.ts",
      "src/realisation/work-completion.ts",
      "src/schema/index.ts",
      "tests/contract/fake-call-resolve.test.ts",
      "tests/fixtures/proposal-packet.ts",
    ].map((path) => `<${secondaryClosure}> <urn:usf:predicate:repositoryReadFile> ${JSON.stringify(path)} <${graph}> .`),
    `<${secondaryClosure}> <urn:usf:predicate:authorityRule> "Supply only the exact non-candidate runtime files imported by this synthetic fake call and resolve validation." <${graph}> .`,
  );
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

// ---------------------------------------------------------------------------
// Registration-feature identity for urn:usf:rule:provider-receipt-target-registration:1.
// The rule's refusal prose becomes executable here: cross-phase equality, and
// fail-closed behaviour on additional, missing or changed members.
// ---------------------------------------------------------------------------
  const declaredWriteSet = [
    "src/commands/provider-receipts.ts",
    "schemas/account-observation.schema.json",
    "tests/integration/provider-receipts.test.ts",
  ];
  const featureOperations = [
    { kind: "write" as const, path: "src/commands/provider-receipts.ts", content: "export const receipts = 2;\n" },
    { kind: "write" as const, path: "schemas/account-observation.schema.json", content: "{\n  \"x\": 1\n}\n" },
  ];

  test("registration feature digests are canonical, path-ordered and content-bound", () => {
    const members = registrationFeatureOperations(featureOperations);
    assert.deepEqual(members.map((m) => m.path), [
      "schemas/account-observation.schema.json",
      "src/commands/provider-receipts.ts",
    ], "members are path-ordered regardless of submission order");
    for (const member of members) {
      assert.match(member.contentDigest as string, /^sha256:[0-9a-f]{64}$/u);
      assert.deepEqual(Object.keys(member).sort(), ["contentDigest", "kind", "path"], "closed member: no envelope fields");
    }

    // Submission order must not change identity.
    assert.equal(
      registrationFeatureOperationsDigest(featureOperations),
      registrationFeatureOperationsDigest([...featureOperations].reverse()),
    );

    // The postimage set spans the entire declared write set, including the
    // member the feature does not touch, which carries canonical absence.
    const postimages = registrationFeaturePostimageSet(declaredWriteSet, featureOperations);
    assert.equal(postimages.length, declaredWriteSet.length);
    const untouched = postimages.find((m) => m.path === "tests/integration/provider-receipts.test.ts")!;
    assert.deepEqual(untouched, { path: "tests/integration/provider-receipts.test.ts", kind: null, resultingMode: null, resultingContentDigest: null });
    const written = postimages.find((m) => m.path === "src/commands/provider-receipts.ts")!;
    assert.equal(written.kind, "write");
    assert.equal(written.resultingMode, "100644");
    assert.match(written.resultingContentDigest as string, /^sha256:[0-9a-f]{64}$/u);
  });

  test("registration feature digests are basis-independent and cross-phase equal", () => {
    // The preliminary and final candidates differ only in the operator
    // predecessor basis, which contributes nothing to either digest.
    const preliminary = {
      operationsDigest: registrationFeatureOperationsDigest(featureOperations),
      postimageSetDigest: registrationFeaturePostimageSetDigest(declaredWriteSet, featureOperations),
    };
    const final = {
      operationsDigest: registrationFeatureOperationsDigest([...featureOperations].reverse()),
      postimageSetDigest: registrationFeaturePostimageSetDigest([...declaredWriteSet].reverse(), [...featureOperations].reverse()),
    };
    assert.deepEqual(final, preliminary, "independently constructed representations agree");
    assert.equal(registrationFeatureDigestsEqual(preliminary, final), true);
  });

  test("registration feature identity fails closed on changed, extra or missing members", () => {
    const base = {
      operationsDigest: registrationFeatureOperationsDigest(featureOperations),
      postimageSetDigest: registrationFeaturePostimageSetDigest(declaredWriteSet, featureOperations),
    };

    // Changed content changes both digests.
    const changed = [{ ...featureOperations[0]!, content: "export const receipts = 3;\n" }, featureOperations[1]!];
    assert.notEqual(registrationFeatureOperationsDigest(changed), base.operationsDigest);
    assert.notEqual(registrationFeaturePostimageSetDigest(declaredWriteSet, changed), base.postimageSetDigest);
    assert.equal(registrationFeatureDigestsEqual(base, {
      operationsDigest: registrationFeatureOperationsDigest(changed),
      postimageSetDigest: registrationFeaturePostimageSetDigest(declaredWriteSet, changed),
    }), false);

    // A missing operation changes both digests rather than being tolerated.
    const missing = [featureOperations[0]!];
    assert.notEqual(registrationFeatureOperationsDigest(missing), base.operationsDigest);
    assert.notEqual(registrationFeaturePostimageSetDigest(declaredWriteSet, missing), base.postimageSetDigest);

    // A declared-scope change alone moves the postimage digest, so the key
    // binds intended scope and not only resulting content.
    assert.notEqual(
      registrationFeaturePostimageSetDigest([...declaredWriteSet, "docs/extra.md"], featureOperations),
      base.postimageSetDigest,
    );

    // An operation outside the declared write set refuses.
    const refusal = (run: () => unknown): string | null => {
      try { run(); return null; } catch (error) { return error instanceof RegistrationFeatureError ? error.reasonCode : null; }
    };
    assert.equal(refusal(() => registrationFeaturePostimageSetDigest(declaredWriteSet, [
      ...featureOperations, { kind: "write" as const, path: "src/commands/help.ts", content: "x\n" },
    ])), "UNDECLARED_WRITE");
    // Duplicate and malformed members refuse.
    assert.equal(refusal(() => registrationFeatureOperations([featureOperations[0]!, featureOperations[0]!])), "UNDECLARED_WRITE");
    assert.equal(refusal(() => registrationFeatureOperations([{ kind: "write" as const, path: "/etc/passwd", content: "x" }])), "UNDECLARED_WRITE");
    assert.equal(refusal(() => registrationFeatureOperations([{ kind: "write" as const, path: "a/../../b", content: "x" }])), "UNDECLARED_WRITE");
    // A write must carry exact content; a delete must not.
    assert.equal(refusal(() => registrationFeatureOperations([{ kind: "write" as const, path: "a.ts" }])), "UNDECLARED_WRITE");
    assert.equal(refusal(() => registrationFeatureOperations([{ kind: "delete" as const, path: "a.ts", content: "x" }])), "UNDECLARED_WRITE");
  });
