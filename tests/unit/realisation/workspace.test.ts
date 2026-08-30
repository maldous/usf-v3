import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { canonicalDigest } from "../../../src/core/canonical.ts";
import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { deriveWork, type WorkPacket } from "../../../src/graph/work.ts";
import {
  applyCandidateOperations,
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
