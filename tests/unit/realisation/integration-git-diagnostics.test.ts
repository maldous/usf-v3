import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { integrateCommandHandler } from "../../../src/commands/apply.ts";
import { canonicalDigest, sha256 } from "../../../src/core/canonical.ts";
import { loadSemanticGraph } from "../../../src/graph/index.ts";
import { deriveWork, type WorkPacket } from "../../../src/graph/work.ts";
import {
  applyCandidateOperations,
  candidateOperations,
  candidateScope,
  materialiseCandidate,
  type CandidateSpec,
} from "../../../src/realisation/index.ts";
import type { RealisationBasis } from "../../../src/realisation/basis.ts";
import {
  assertAuthenticatedCandidateWhitespace,
  IntegrationError,
  isTrustedRootOwnedGitUid,
  stagedIntegrationPaths,
  type AuthenticatedCandidateWhitespaceInput,
  type IntegrationGitDiagnostic,
  type IntegrationWhitespacePreflightDependencies,
} from "../../../src/realisation/transition.ts";
import { createJsonSchemaValidator } from "../../../src/schema/index.ts";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const candidateDigest = digest("a");
const basisDigest = digest("b");
const sourceRoot = resolve(import.meta.dirname, "../../..");
const fallbackTemporaryRoot = resolve(sourceRoot, ".usf/tmp");
const selfHostManifestPath = "graph/manifests/self-host.json";
const selfHostProfile = "urn:usf:profile:v3-self-host:1";
const selfHostWork = "urn:usf:work:realisation-basis-chain";
const integrationTargetPath = "tests/unit/realisation/workspace.test.ts";

type ProfileBoundPacket = WorkPacket & Readonly<{ realisationBasis: RealisationBasis }>;

async function fixture(context: TestContext): Promise<string> {
  const parent = process.env.TMPDIR === undefined ? fallbackTemporaryRoot : resolve(process.env.TMPDIR);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const root = await mkdtemp(join(parent, "integration-git-diagnostics-"));
  await chmod(root, 0o700);
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function repositoryFixture(context: TestContext): Promise<string> {
  const root = await fixture(context);
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")) continue;
    await cp(join(sourceRoot, entry.name), join(root, entry.name), { recursive: true });
  }
  const git = (args: readonly string[]) => {
    const result = spawnSync("/usr/bin/git", ["-c", "user.name=USF Test", "-c", "user.email=test@invalid.local", "-C", root, ...args], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init", "-b", "main"]);
  git(["add", "--all"]);
  git(["commit", "-m", "fixture"]);
  return root;
}

test("staged integration paths retain both rename paths alongside additions deletions and modifications", async (context) => {
  const root = await fixture(context);
  const git = (...args: string[]): string => {
    const result = spawnSync("/usr/bin/git", ["-c", "user.name=USF Test", "-c", "user.email=test@invalid.local", "-C", root, ...args], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git("init", "-b", "main");
  git("config", "diff.renames", "true");
  for (const [path, content] of [
    ["old.ts", "rename identity\n"], ["deleted.ts", "deleted content\n"], ["modified.ts", "before\n"],
  ]) await writeFile(join(root, path!), content!);
  git("add", "--all");
  git("commit", "-m", "fixture");
  const base = git("rev-parse", "HEAD").trim();
  git("mv", "old.ts", "new.ts");
  await rm(join(root, "deleted.ts"));
  await writeFile(join(root, "added.ts"), "independent addition\n");
  await writeFile(join(root, "modified.ts"), "after\n");
  git("add", "--all");
  assert.match(git("diff", "--cached", "--name-status", base), /R100\told\.ts\tnew\.ts/u);
  assert.deepEqual(stagedIntegrationPaths(root, base), ["added.ts", "deleted.ts", "modified.ts", "new.ts", "old.ts"]);
});

function selfHostBasis(root: string): RealisationBasis {
  const derived = deriveWork(loadSemanticGraph(root, selfHostManifestPath), { profile: selfHostProfile, selector: selfHostWork });
  assert.equal(derived.status, "ok");
  const packet = derived.items?.[0] as ProfileBoundPacket | undefined;
  assert.ok(packet?.realisationBasis);
  return packet.realisationBasis;
}

function workspaceCandidate(basis: RealisationBasis, content: string): CandidateSpec {
  const operations = [{ kind: "write" as const, path: integrationTargetPath, content }];
  const acceptedContributionDigests = [canonicalDigest("integration-git-diagnostics")];
  return {
    digest: canonicalDigest({ basisDigest: basis.basisDigest, operations, acceptedContributionDigests }, { rejectAbsolutePaths: true }),
    basis,
    operations,
    lineage: { acceptedContributionDigests, rejected: [] },
    scope: candidateScope(basis),
    writeSet: [integrationTargetPath],
    preimages: { [integrationTargetPath]: basis.scope.preimages[integrationTargetPath]! },
  };
}

function encoded(content: string | Buffer): { snapshot: string; digest: string } {
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  return { snapshot: bytes.toString("base64"), digest: sha256(bytes) };
}

function delta(path: string, before: string | Buffer | null, after: string | Buffer | null) {
  const beforeValue = before === null ? null : encoded(before);
  const afterValue = after === null ? null : encoded(after);
  return {
    path,
    before: beforeValue?.snapshot ?? null,
    after: afterValue?.snapshot ?? null,
    beforeDigest: beforeValue?.digest ?? null,
    afterDigest: afterValue?.digest ?? null,
  };
}

function candidate(deltas: AuthenticatedCandidateWhitespaceInput["deltas"]): AuthenticatedCandidateWhitespaceInput {
  return { candidateDigest, basisDigest, deltas };
}

function observedFailure(action: () => void): IntegrationError {
  try { action(); }
  catch (error) {
    assert.ok(error instanceof IntegrationError);
    return error;
  }
  assert.fail("expected an integration refusal");
}

test("trusted Git ownership accepts only root or the exact authenticated fixture UID mapping", () => {
  assert.equal(isTrustedRootOwnedGitUid(0, 1000), true);
  for (const accepted of [
    "1000 0 1",
    "1000 0 1\n",
    "   1000\t0   1  \n",
    "\t001000 00 01\r\n",
  ]) assert.equal(isTrustedRootOwnedGitUid(65534, 1000, Buffer.from(accepted, "ascii")), true, accepted);

  for (const [uid, currentUid, raw] of [
    [1, 1000, "1000 0 1\n"],
    [65534, 0, "1000 0 1\n"],
    [65534, 1001, "1000 0 1\n"],
    [65534, 1000, ""],
    [65534, 1000, "1000 0"],
    [65534, 1000, "1000 0 2\n"],
    [65534, 1000, "1000 1 1\n"],
    [65534, 1000, "0 0 1\n"],
    [65534, 1000, "1000 0 1\n1000 0 1\n"],
    [65534, 1000, "1000 0 1\n\n"],
    [65534, 1000, "1000\u00a00 1\n"],
    [65534, 1000, `${" ".repeat(249)}1000 0 1\n`],
  ] as const) assert.equal(isTrustedRootOwnedGitUid(uid, currentUid, Buffer.from(raw, "utf8")), false, JSON.stringify({ uid, currentUid, raw }));
});

async function privateIntegrationWorktree(stateRoot: string, identity: string): Promise<string> {
  const state = join(stateRoot, ".usf");
  const worktrees = join(state, "integration-worktrees");
  const worktree = join(worktrees, identity);
  for (const path of [state, worktrees, worktree]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
  return worktree;
}

test("Git state classification authenticates direct worktrees and keeps nested repositories independent", async (context) => {
  const stateRoot = await fixture(context);
  const outerWorktree = await privateIntegrationWorktree(stateRoot, "d".repeat(64));
  const nestedRepository = join(outerWorktree, ".usf", "integration-validation", "nested-repository");
  await mkdir(nestedRepository, { recursive: true, mode: 0o700 });
  await chmod(nestedRepository, 0o700);
  const nestedWorktree = await privateIntegrationWorktree(nestedRepository, "e".repeat(64));
  const input = candidate([delta("src/example.ts", "clean\n", "bad   \n")]);

  for (const [name, root] of [
    ["direct", outerWorktree],
    ["nested-independent", nestedRepository],
    ["last-marker-direct", nestedWorktree],
  ] as const) {
    const failure = observedFailure(() => assertAuthenticatedCandidateWhitespace(root, [input]));
    assert.equal(failure.reasonCode, "INTEGRATION_GIT_FAILED", name);
    assert.deepEqual(failure.gitDiagnostic, {
      operation: "git-diff-check",
      failureClass: "candidate-whitespace",
      candidateDigest,
      basisDigest,
      details: [{ path: "src/example.ts", line: 1, kind: "trailing-whitespace" }],
      detailsTruncated: false,
    }, name);
  }

  const malformed = await privateIntegrationWorktree(stateRoot, "malformed");
  const malformedFailure = observedFailure(() => assertAuthenticatedCandidateWhitespace(malformed, [input]));
  assert.equal(malformedFailure.reasonCode, "INTEGRATION_GIT_FAILED");
  assert.equal(malformedFailure.gitDiagnostic?.failureClass, "git-failed");
  assert.deepEqual(malformedFailure.gitDiagnostic?.details, []);
});

test("no-index preflight cannot discover an inaccessible ancestor Git pointer", async (context) => {
  const ancestor = await fixture(context);
  await writeFile(join(ancestor, ".git"), "gitdir: /unavailable/integration-carrier/worktrees/candidate\n", { mode: 0o600 });
  const root = join(ancestor, "nested-independent-repository");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const failure = observedFailure(() => assertAuthenticatedCandidateWhitespace(root, [candidate([
    delta("src/example.ts", "clean\n", "bad   \n"),
  ])]));
  assert.equal(failure.reasonCode, "INTEGRATION_GIT_FAILED");
  assert.deepEqual(failure.gitDiagnostic, {
    operation: "git-diff-check",
    failureClass: "candidate-whitespace",
    candidateDigest,
    basisDigest,
    details: [{ path: "src/example.ts", line: 1, kind: "trailing-whitespace" }],
    detailsTruncated: false,
  });
});

test("trusted Git detects only newly introduced whitespace and emits canonical bounded details", async (context) => {
  const root = await fixture(context);
  const failure = observedFailure(() => assertAuthenticatedCandidateWhitespace(root, [candidate([
    delta("src/zeta.ts", "ok\n", "ok\nbad \n"),
    delta("src/alpha.ts", "clean\n", "bad   \n \tindent\n\n"),
  ])]));

  assert.equal(failure.reasonCode, "INTEGRATION_GIT_FAILED");
  assert.deepEqual(failure.gitDiagnostic, {
    operation: "git-diff-check",
    failureClass: "candidate-whitespace",
    candidateDigest,
    basisDigest,
    details: [
      { path: "src/alpha.ts", line: 1, kind: "trailing-whitespace" },
      { path: "src/alpha.ts", line: 2, kind: "space-before-tab" },
      { path: "src/alpha.ts", line: 3, kind: "blank-at-eof" },
      { path: "src/zeta.ts", line: 2, kind: "trailing-whitespace" },
    ],
    detailsTruncated: false,
  });
  assert.equal(JSON.stringify(failure.gitDiagnostic).includes(root), false, "scratch paths are not exposed");
  assert.equal(existsSync(join(root, ".usf/integration-worktrees")), false, "preflight creates no integration worktree");
  assert.deepEqual(await readdir(join(root, ".usf/integration-git-preflight")), [], "scratch bytes are removed");

  assert.doesNotThrow(() => assertAuthenticatedCandidateWhitespace(root, [candidate([
    delta("src/historical.ts", "old   \nclean\n", "old   \nchanged\n"),
    delta("src/binary.bin", null, Buffer.from([0, 1, 2, 3, 4])),
    delta("src/deleted.ts", "deleted   \n", null),
  ])]), "unchanged historical whitespace, binary additions and deletions do not acquire a text-whitespace class");

  const many = Array.from({ length: 20 }, (_, index) => `line-${index}   \n`).join("");
  const truncated = observedFailure(() => assertAuthenticatedCandidateWhitespace(root, [candidate([
    delta("src/many.ts", null, many),
  ])]));
  assert.equal(truncated.gitDiagnostic?.failureClass, "candidate-whitespace");
  assert.equal(truncated.gitDiagnostic?.details.length, 16);
  assert.deepEqual(truncated.gitDiagnostic?.details.map(({ line }) => line), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.equal(truncated.gitDiagnostic?.detailsTruncated, true);
});

test("malformed, oversized, unexpected and unavailable Git outcomes fail closed", async (context) => {
  const root = await fixture(context);
  const input = candidate([delta("src/example.ts", "before\n", "after\n")]);
  const cases: Array<{
    name: string;
    dependencies: IntegrationWhitespacePreflightDependencies;
    reasonCode: "INTEGRATION_GIT_FAILED" | "INTEGRATION_GIT_UNAVAILABLE";
    failureClass: "git-failed" | "git-unavailable";
  }> = [
    {
      name: "malformed",
      dependencies: { diffCheck: () => ({ status: 3, stdout: Buffer.from("malformed\n"), stderr: Buffer.alloc(0) }) },
      reasonCode: "INTEGRATION_GIT_FAILED",
      failureClass: "git-failed",
    },
    {
      name: "oversized",
      dependencies: { diffCheck: () => ({ status: 3, stdout: Buffer.alloc(64 * 1024 + 1, "x"), stderr: Buffer.alloc(0) }) },
      reasonCode: "INTEGRATION_GIT_FAILED",
      failureClass: "git-failed",
    },
    {
      name: "unexpected-status",
      dependencies: { diffCheck: () => ({ status: 2, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) },
      reasonCode: "INTEGRATION_GIT_FAILED",
      failureClass: "git-failed",
    },
    {
      name: "nonempty-clean-output",
      dependencies: { diffCheck: () => ({ status: 1, stdout: Buffer.from("unexpected\n"), stderr: Buffer.alloc(0) }) },
      reasonCode: "INTEGRATION_GIT_FAILED",
      failureClass: "git-failed",
    },
    {
      name: "unavailable",
      dependencies: { diffCheck: () => { throw new IntegrationError("INTEGRATION_GIT_UNAVAILABLE"); } },
      reasonCode: "INTEGRATION_GIT_UNAVAILABLE",
      failureClass: "git-unavailable",
    },
  ];

  for (const scenario of cases) {
    const failure = observedFailure(() => assertAuthenticatedCandidateWhitespace(root, [input], scenario.dependencies));
    assert.equal(failure.reasonCode, scenario.reasonCode, scenario.name);
    assert.deepEqual(failure.gitDiagnostic, {
      operation: "git-diff-check",
      failureClass: scenario.failureClass,
      candidateDigest,
      basisDigest,
      details: [],
      detailsTruncated: false,
    }, scenario.name);
  }
});

test("an actual authenticated candidate is checked before receipts, worktrees, locks or publication", async (context) => {
  const root = await repositoryFixture(context);
  const basis = selfHostBasis(root);
  const before = await readFile(join(root, integrationTargetPath), "utf8");
  const whitespace = workspaceCandidate(basis, `${before}\n// planted candidate whitespace   \n`);
  await materialiseCandidate(root, whitespace);
  await applyCandidateOperations(root, whitespace.digest, candidateOperations(whitespace));

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network forbidden"); };
  try {
    const refused = await integrateCommandHandler({
      command: "integrate",
      args: ["--candidate", whitespace.digest, "--dry-run"],
      repositoryRoot: root,
    });
    assert.notEqual(refused.exitCode, 0);
    assert.equal((refused.output as { reasonCode: string }).reasonCode, "INTEGRATION_GIT_FAILED");
    const diagnostic = (refused.output as { gitDiagnostic: IntegrationGitDiagnostic }).gitDiagnostic;
    assert.equal(diagnostic.operation, "git-diff-check");
    assert.equal(diagnostic.failureClass, "candidate-whitespace");
    assert.equal(diagnostic.candidateDigest, whitespace.digest);
    assert.equal(diagnostic.basisDigest, basis.basisDigest);
    assert.deepEqual(diagnostic.details, [{
      path: integrationTargetPath,
      line: before.split("\n").length + 1,
      kind: "trailing-whitespace",
    }]);
    assert.equal(existsSync(join(root, ".usf/receipts")), false, "preflight precedes receipt recovery or publication");
    assert.equal(existsSync(join(root, ".usf/integration-worktrees")), false);
    assert.equal(existsSync(join(root, ".usf/integration-intents")), false);
    assert.equal(existsSync(join(root, ".usf/locks/primary-mutation.lock")), false);

    const clean = workspaceCandidate(basis, `${before}\n// clean downstream candidate\n`);
    await materialiseCandidate(root, clean);
    await applyCandidateOperations(root, clean.digest, candidateOperations(clean));
    const downstream = await integrateCommandHandler({
      command: "integrate",
      args: ["--candidate", clean.digest, "--dry-run"],
      repositoryRoot: root,
    });
    assert.notEqual(downstream.exitCode, 0);
    assert.equal((downstream.output as { reasonCode: string }).reasonCode, "INTEGRATION_CHECK_RECEIPT_MISSING");
    assert.equal(Object.hasOwn(downstream.output as object, "gitDiagnostic"), false);
    assert.deepEqual((downstream.output as { candidateDigests: string[] }).candidateDigests, [clean.digest]);
    assert.equal(existsSync(join(root, ".usf/receipts")), false);
    assert.equal(existsSync(join(root, ".usf/integration-worktrees")), false);
    assert.equal(existsSync(join(root, ".usf/integration-intents")), false);
    assert.equal(existsSync(join(root, ".usf/locks/primary-mutation.lock")), false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the real integrate handler emits one schema-valid sanitized preflight refusal", async (context) => {
  const root = await fixture(context);
  const marker = "private-candidate-content   ";
  let preparationCalls = 0;
  let integrationCalls = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network forbidden"); };
  try {
    const result = await integrateCommandHandler({
      command: "integrate",
      args: ["--candidate", candidateDigest, "--dry-run"],
      repositoryRoot: root,
    }, {
      prepareCandidateIntegration: async () => {
        preparationCalls += 1;
        assert.equal(existsSync(join(root, ".usf/integration-worktrees")), false);
        assertAuthenticatedCandidateWhitespace(root, [candidate([
          delta("src/example.ts", "clean\n", `${marker}\n`),
        ])]);
        assert.fail("whitespace preflight must refuse");
      },
      integrateCandidates: async () => {
        integrationCalls += 1;
        assert.fail("dry-run must not invoke integration");
      },
    });

    assert.equal(result.exitCode, 1);
    assert.equal(preparationCalls, 1);
    assert.equal(integrationCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(result.output, {
      schema: "urn:usf:integrate-result:1",
      status: "refused",
      reasonCode: "INTEGRATION_GIT_FAILED",
      candidateDigests: [candidateDigest],
      dryRun: true,
      gitDiagnostic: {
        operation: "git-diff-check",
        failureClass: "candidate-whitespace",
        candidateDigest,
        basisDigest,
        details: [{ path: "src/example.ts", line: 1, kind: "trailing-whitespace" }],
        detailsTruncated: false,
      },
      nonClaims: [
        "no-successful-integration-or-completion-effect",
        "refusal-integration-observation-may-exist",
        "no-evidence-or-proof-publication-effect",
        "no-github-push-provider-runtime-staging-or-production-effect",
      ],
    });
    assert.equal(JSON.stringify(result.output).includes(marker), false, "candidate content is not exposed");
    assert.equal(JSON.stringify(result.output).includes(root), false, "absolute scratch paths are not exposed");

    const schema = JSON.parse(await readFile(resolve(sourceRoot, "schemas/integrate-result.schema.json"), "utf8"));
    const validator = createJsonSchemaValidator(schema);
    assert.equal(validator.schemaId, "urn:usf:integrate-result:1");
    assert.equal(validator.validate(result.output).valid, true);
    assert.equal(validator.validate({ ...(result.output as object), rawStderr: marker }).valid, false);
    const absolutePath = structuredClone(result.output) as { gitDiagnostic: IntegrationGitDiagnostic };
    absolutePath.gitDiagnostic = { ...absolutePath.gitDiagnostic, details: [{ path: root, line: 1, kind: "trailing-whitespace" }] };
    assert.equal(validator.validate(absolutePath).valid, false);

    const downstream = await integrateCommandHandler({
      command: "integrate",
      args: ["--candidate", candidateDigest, "--dry-run"],
      repositoryRoot: root,
    }, {
      prepareCandidateIntegration: async () => {
        preparationCalls += 1;
        assertAuthenticatedCandidateWhitespace(root, [candidate([
          delta("src/example.ts", "clean\n", "changed\n"),
        ])]);
        throw new IntegrationError("INTEGRATION_CHECK_RECEIPT_MISSING", "downstream preparation reached");
      },
      integrateCandidates: async () => {
        integrationCalls += 1;
        assert.fail("dry-run must not invoke integration");
      },
    });
    assert.equal(preparationCalls, 2, "a clean comparison reaches the existing downstream preparation seam");
    assert.equal(integrationCalls, 0);
    assert.notEqual(downstream.exitCode, 0);
    assert.equal((downstream.output as { reasonCode: string }).reasonCode, "INTEGRATION_CHECK_RECEIPT_MISSING");
    assert.equal(Object.hasOwn(downstream.output as object, "gitDiagnostic"), false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the handler drops a diagnostic that is not bound to the requested candidate", async (context) => {
  const root = await fixture(context);
  const unrelatedCandidate = digest("c");
  const diagnostic: IntegrationGitDiagnostic = {
    operation: "git-diff-check",
    failureClass: "candidate-whitespace",
    candidateDigest: unrelatedCandidate,
    basisDigest,
    details: [{ path: "src/example.ts", line: 1, kind: "trailing-whitespace" }],
    detailsTruncated: false,
  };
  const result = await integrateCommandHandler({
    command: "integrate",
    args: ["--candidate", candidateDigest, "--dry-run"],
    repositoryRoot: root,
  }, {
    prepareCandidateIntegration: async () => { throw new IntegrationError("INTEGRATION_GIT_FAILED", "refused", undefined, diagnostic); },
    integrateCandidates: async () => { assert.fail("not reachable"); },
  });
  assert.equal(Object.hasOwn(result.output as object, "gitDiagnostic"), false);

  const malformed = { ...diagnostic, candidateDigest, rawStderr: "private transport output" } as unknown as IntegrationGitDiagnostic;
  const malformedResult = await integrateCommandHandler({
    command: "integrate",
    args: ["--candidate", candidateDigest, "--dry-run"],
    repositoryRoot: root,
  }, {
    prepareCandidateIntegration: async () => { throw new IntegrationError("INTEGRATION_GIT_FAILED", "refused", undefined, malformed); },
    integrateCandidates: async () => { assert.fail("not reachable"); },
  });
  assert.equal(Object.hasOwn(malformedResult.output as object, "gitDiagnostic"), false);
  assert.equal(JSON.stringify(malformedResult.output).includes("private transport output"), false);
});

test("production preparation invokes the preflight after canonical authentication and before worktree creation", async () => {
  const source = await readFile(resolve(sourceRoot, "src/realisation/transition.ts"), "utf8");
  const preparation = source.indexOf("export async function prepareCandidateIntegration");
  const authentication = source.indexOf("authenticateCandidateWorkspace(canonicalRoot, candidateDigest)", preparation);
  const ordering = source.indexOf("canonicalCohortOrder(workGraph, authenticated.map", preparation);
  const preflight = source.indexOf("assertAuthenticatedCandidateWhitespace(canonicalRoot, preflightRecords.map", preparation);
  const receipts = source.indexOf("authenticatedCheckedReceipts(", preparation);
  const worktreeRoot = source.indexOf('const worktreesRoot = resolve(canonicalRoot, ".usf", "integration-worktrees")', preparation);
  const worktreeAdd = source.indexOf('gitWithCanonicalMaterialisation(canonicalRoot, "worktree", ["add", "--detach", worktree, startingCarrierCommit])', preparation);
  assert.ok(authentication >= 0 && authentication < ordering);
  assert.ok(ordering < preflight);
  assert.ok(preflight < receipts && receipts < worktreeRoot && worktreeRoot < worktreeAdd);
});
