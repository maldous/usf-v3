import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const usf = resolve(repositoryRoot, "bin/usf");
const digest = `sha256:${"a".repeat(64)}`;

type Json = Record<string, unknown>;

function childProcessUnavailable(context: TestContext): boolean {
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission === undefined || permission.has("child_process")) return false;
  context.skip("the repository-independent subprocess boundary runs in the direct outer authoritative validation");
  return true;
}

async function optionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function invoke(
  args: readonly string[],
  cwd: string,
  shimDirectory: string,
  log: string,
  mode: "deny" | "delegate",
  input?: string,
): ReturnType<typeof spawnSync> {
  return spawnSync(usf, args, {
    cwd,
    encoding: "utf8",
    input,
    timeout: 5_000,
    env: {
      ...process.env,
      PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
      GIT_SHIM_LOG: log,
      GIT_SHIM_MODE: mode,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

function parseOutput(result: ReturnType<typeof spawnSync>, label: string): Json {
  assert.equal(result.error, undefined, `${label} must not time out`);
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
  assert.equal(result.stderr, "", `${label} wrote stderr`);
  return JSON.parse(String(result.stdout).trim()) as Json;
}

function assertNoAbsolutePathsOrSecrets(value: unknown): void {
  if (typeof value === "string") {
    assert.equal(value.includes(repositoryRoot), false, "output must not disclose the repository path");
    assert.equal(/(?:token|secret|password|authorization)/i.test(value), false, "output must not disclose secrets");
  } else if (Array.isArray(value)) {
    for (const item of value) assertNoAbsolutePathsOrSecrets(item);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(/(?:token|secret|password|authorization)/i.test(key), false, "output must not carry secret-shaped keys");
      assertNoAbsolutePathsOrSecrets(item);
    }
  }
}

test("help is repository-free; status stays local; and metrics preserve unknown coverage", async (t) => {
  if (childProcessUnavailable(t)) return;
  const temporary = await mkdtemp(join(tmpdir(), "usf-observability-cli-"));
  const nonRepository = join(temporary, "not-a-repository");
  const shimDirectory = join(temporary, "bin");
  const log = join(temporary, "git.log");
  await Promise.all([
    mkdir(nonRepository),
    mkdir(shimDirectory),
    writeFile(log, ""),
  ]);
  const shim = join(shimDirectory, "git");
  await writeFile(
    shim,
    "#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$GIT_SHIM_LOG\"\nif [ \"$GIT_SHIM_MODE\" = deny ]; then exit 91; fi\nexec /usr/bin/git \"$@\"\n",
  );
  await chmod(shim, 0o755);
  t.after(async () => { await rm(temporary, { recursive: true, force: true }); });

  const humanHelp = invoke(["--help"], nonRepository, shimDirectory, log, "deny");
  assert.equal(humanHelp.status, 0, `human help failed: ${humanHelp.stderr}`);
  assert.match(String(humanHelp.stdout), /USF command interface/);
  const machineHelp = parseOutput(invoke(["help", "--json"], nonRepository, shimDirectory, log, "deny"), "machine help");
  assert.equal(machineHelp.schema, "urn:usf:cli-help:1");
  assert.equal(machineHelp.status, "ok");
  assert.equal(await optionalText(log), "", "help must not inspect Git or a repository");

  const status = parseOutput(invoke(["status"], repositoryRoot, shimDirectory, log, "delegate"), "broad status");
  assert.equal(status.schema, "urn:usf:status-result:1");
  assert.equal(status.externalContact, false);
  assert.equal((status.repository as Json).remoteContact, false);
  assert.equal((status.semantic as Json).status, "not-selected");
  assert.equal((status.terminalProof as Json).status, "not-evaluated");
  assert.ok((status.nonclaims as unknown[]).includes("no-full-anqr-staging-production-or-terminal-proof-claim"));
  assertNoAbsolutePathsOrSecrets(status);
  const gitOperations = (await optionalText(log)).trim().split("\n").filter(Boolean);
  assert.ok(gitOperations.length > 0, "broad status must record its local carrier reads through the shim");
  // Broad status, including the carrier projection, reads only already-local
  // Git state. The closed allowlist is the invariant; the negative assertion
  // below states the property the allowlist exists to protect, so a future
  // addition cannot quietly introduce remote contact.
  const localOnlyGitOperations = ["rev-parse", "diff-index", "symbolic-ref", "config", "rev-list"];
  assert.ok(gitOperations.every((operation) => localOnlyGitOperations.includes(operation)), `unexpected Git operation: ${gitOperations.join(", ")}`);
  const remoteCapableGitOperations = ["fetch", "ls-remote", "push", "pull", "clone", "remote", "submodule"];
  assert.ok(gitOperations.every((operation) => !remoteCapableGitOperations.includes(operation)), `status contacted a remote: ${gitOperations.join(", ")}`);
  assert.equal((status.carrier as Json).remoteContact, false);
  assert.equal(((status.carrier as Json).upstream as Json).observedFromLocalRefsOnly, true);
  assert.equal((status.carrier as Json).comparisonScope, "this-checkout-only");
  // Without an explicit profile and manifest the graph assertions must say
  // not-selected rather than implying a clean bill of health.
  assert.equal((status.closureSatisfiability as Json).status, "not-selected");
  assert.equal((status.publicationPolicyCoverage as Json).status, "not-selected");
  assert.equal((status.policyBlastRadius as Json).status, "not-selected");

  const implicitOverlay = invoke(["start", "--profile", "urn:usf:profile:v3-self-host:1"], repositoryRoot, shimDirectory, log, "delegate");
  assert.equal(implicitOverlay.status, 2);
  assert.equal(JSON.parse(String(implicitOverlay.stdout).trim()).reasonCode, "LIFECYCLE_MANIFEST_REQUIRED", "start must never select a product manifest implicitly");

  const events = [
    {
      schema: "urn:usf:metric-event:1",
      at: "2026-08-30T00:00:00.000Z",
      kind: "completion",
      run: "run-1",
      requestedRoute: "route-requested",
      actualProvider: "provider-actual",
      actualModel: "model-actual",
      usage: { inputTokens: 4, outputTokens: 5 },
      outcome: "accepted",
      lineage: "accepted-candidate",
      contributionDigest: digest,
    },
    {
      schema: "urn:usf:metric-event:1",
      at: "2026-08-30T00:01:00.000Z",
      kind: "completion",
      run: "run-1",
      requestedRoute: "route-requested",
      actualProvider: "provider-actual",
      actualModel: "model-actual",
    },
  ].map((event) => JSON.stringify(event)).join("\n");
  const metrics = parseOutput(invoke(["metrics", "tokens", "--input", "-"], repositoryRoot, shimDirectory, log, "delegate", `${events}\n`), "metrics stdin");
  assert.equal(metrics.schema, "urn:usf:metrics-report:1");
  assert.equal(metrics.view, "tokens");
  assert.equal((metrics.denominators as Json).requestedRoutes, 1);
  assert.equal((metrics.denominators as Json).actualProviders, 1);
  assert.equal((metrics.totals as Json).totalTokens, null, "missing applicable usage must remain unknown, not zero");
  assert.equal((metrics.coverage as Json).usageUnknownEvents, 1);
  assert.equal(metrics.status, "incomplete");
});

// The semantic assertions below run in the ordinary outer carrier lane, beside
// the subprocess boundary above. The operator candidate deliberately does not
// carry the graph, lifecycle and realisation modules that `status` imports, so
// these are reached through a dynamic import after the same outer-lane guard.
//
// Each planted defect is a failure this repository actually paid for: a
// completion publication rolled back after the outer gate failed on a declared
// production member that did not exist, and a trial policy amendment rolled
// back after it staled a whole cohort of current grants.

type Row = Record<string, Json>;

test("closure satisfiability names every declared production member the repository cannot honour", async (t) => {
  if (childProcessUnavailable(t)) return;
  const { closureSatisfiability } = await import("../../src/commands/status.ts");
  const temporary = await mkdtemp(join(tmpdir(), "usf-closure-"));
  t.after(async () => { await rm(temporary, { recursive: true, force: true }); });
  await mkdir(join(temporary, "src"), { recursive: true });
  await writeFile(join(temporary, "src/present.ts"), "export const present = 1;\n", "utf8");
  await writeFile(join(temporary, "src/also-present.ts"), "export const alsoPresent = 1;\n", "utf8");

  const quad = (subject: string, predicate: string, object: string, objectKind: "iri" | "literal") =>
    ({ subject, predicate, object, objectKind, graph: "urn:fixture:graph", canonical: `${subject} ${predicate} ${object}` });
  const fixture = (id: string, entry: string, declared: string, members: readonly string[]) => ({
    manifest: { schema: "urn:usf:graph-manifest:2" as const, version: 2 as const, imports: [], sources: [] },
    quads: [
      quad(id, "urn:usf:predicate:type", "urn:usf:type:ProductionLeafRuntimeClosure", "iri"),
      quad(id, "urn:usf:predicate:ownerWork", `urn:fixture:work:${id.split(":").pop()!}`, "iri"),
      quad(id, "urn:usf:predicate:entryModulePath", entry, "literal"),
      quad(id, "urn:usf:predicate:closureMemberCount", declared, "literal"),
      ...members.map((member) => quad(id, "urn:usf:predicate:runtimePath", member, "literal")),
    ],
    semanticDigest: `sha256:${"0".repeat(64)}`,
    graphDigests: {},
    sourceDigests: {},
    repositoryRoot: temporary,
  });
  const reasons = (result: Record<string, unknown>): readonly string[] => (result.rows as readonly { reasonCodes: readonly string[] }[])[0]!.reasonCodes;

  const honest = closureSatisfiability(fixture("urn:fixture:closure:honest", "src/present.ts", "2", ["src/present.ts", "src/also-present.ts"]), temporary);
  assert.equal(honest.status, "satisfiable");
  assert.deepEqual(honest.blockedWorks, []);

  // The account-tier defect: declared members that do not exist. The packet's
  // own confined validation cannot observe this, because the leaf dispatcher
  // refuses at the proofblock boundary before closure authentication; only the
  // outer CLI does, after completion has already been minted.
  const missing = closureSatisfiability(fixture("urn:fixture:closure:missing", "src/present.ts", "3", ["src/present.ts", "src/account-sources.ts", "src/disposition.ts"]), temporary);
  assert.equal(missing.status, "unsatisfiable");
  assert.deepEqual(missing.blockedWorks, ["urn:fixture:work:missing"]);
  assert.deepEqual(reasons(missing), ["CLOSURE_MEMBER_MISSING:src/account-sources.ts", "CLOSURE_MEMBER_MISSING:src/disposition.ts"]);

  assert.deepEqual(reasons(closureSatisfiability(fixture("urn:fixture:closure:miscounted", "src/present.ts", "9", ["src/present.ts"]), temporary)), ["CLOSURE_MEMBER_COUNT_MISMATCH:9:1"]);
  assert.deepEqual(reasons(closureSatisfiability(fixture("urn:fixture:closure:escaping", "src/present.ts", "2", ["src/present.ts", "../outside.ts"]), temporary)), ["CLOSURE_MEMBER_OUTSIDE_ROOT:../outside.ts"]);
  assert.deepEqual(reasons(closureSatisfiability(fixture("urn:fixture:closure:directory", "src/present.ts", "2", ["src/present.ts", "src"]), temporary)), ["CLOSURE_MEMBER_NOT_REGULAR_FILE:src"]);
  assert.deepEqual(reasons(closureSatisfiability(fixture("urn:fixture:closure:stray", "src/also-present.ts", "1", ["src/present.ts"]), temporary)), ["CLOSURE_ENTRY_MODULE_NOT_A_MEMBER:src/also-present.ts"]);
});

test("publication policy coverage and blast radius replace trial amendment with read-back", async (t) => {
  if (childProcessUnavailable(t)) return;
  const { policyBlastRadius, publicationPolicyCoverage } = await import("../../src/commands/status.ts");
  const quad = (subject: string, predicate: string, object: string) =>
    ({ subject, predicate, object, objectKind: "iri" as const, graph: "urn:fixture:graph", canonical: `${subject} ${predicate} ${object}` });
  const constructionPolicyType = "urn:usf:type:ConstructionAuthorityPublicationPolicy";
  const completionPolicyType = "urn:usf:type:NoChangeWorkCompletionPublicationPolicy";
  const policy = (id: string, type: string, works: readonly string[], algorithm: string | null, reciprocal: boolean) => [
    quad(id, "urn:usf:predicate:type", type),
    ...works.map((work) => quad(id, "urn:usf:predicate:eligibleWork", work)),
    ...(algorithm === null ? [] : [quad(id, "urn:usf:predicate:publicationAlgorithm", algorithm)]),
    ...(algorithm !== null && reciprocal ? [quad(algorithm, "urn:usf:predicate:publicationPolicy", id)] : []),
  ];
  const graphOf = (quads: readonly ReturnType<typeof quad>[]) => ({
    manifest: { schema: "urn:usf:graph-manifest:2" as const, version: 2 as const, imports: [], sources: [] },
    quads: [...quads], semanticDigest: `sha256:${"0".repeat(64)}`, graphDigests: {}, sourceDigests: {}, repositoryRoot: "/nonexistent-fixture-root",
  });
  const packetOf = (id: string, options: { verified?: boolean; authority?: string; policies?: readonly string[] }) => ({
    id,
    eligibility: { construction: { authority: options.authority ?? "none" } },
    realisationStage: { stage: options.verified === true ? "verified-complete" : "blocked", completion: { verified: options.verified === true } },
    realisationBasis: { work: { dependencies: (options.policies ?? []).map((key) => ({ key, digest: "sha256:00", kind: "semantic-resource" })) } },
  });

  const coverageGraph = graphOf([
    ...policy("urn:fixture:policy:construction:1", constructionPolicyType, ["urn:fixture:work:covered", "urn:fixture:work:ambiguous"], "urn:fixture:algorithm:construction:1", true),
    ...policy("urn:fixture:policy:construction:2", constructionPolicyType, ["urn:fixture:work:ambiguous"], "urn:fixture:algorithm:construction:2", true),
    ...policy("urn:fixture:policy:completion:1", completionPolicyType, ["urn:fixture:work:covered", "urn:fixture:work:ambiguous", "urn:fixture:work:broken-chain"], "urn:fixture:algorithm:completion:1", true),
    // The exact refusal a new policy hit by reusing an existing algorithm: the
    // algorithm declares no reciprocal publicationPolicy edge back to it.
    ...policy("urn:fixture:policy:construction:3", constructionPolicyType, ["urn:fixture:work:broken-chain"], "urn:fixture:algorithm:construction:1", false),
  ]);
  const coverage = publicationPolicyCoverage(coverageGraph as never, ["covered", "ambiguous", "broken-chain", "orphan"].map((name) => packetOf(`urn:fixture:work:${name}`, {})) as never);
  assert.equal(coverage.status, "at-risk");
  const risks = new Map((coverage.rows as readonly { work: string; riskCodes: readonly string[] }[]).map((row) => [row.work, row.riskCodes]));
  assert.deepEqual(risks.get("urn:fixture:work:covered"), []);
  assert.deepEqual(risks.get("urn:fixture:work:ambiguous"), ["CONSTRUCTION_AUTHORITY_POLICY_AMBIGUOUS"]);
  assert.deepEqual(risks.get("urn:fixture:work:broken-chain"), ["CONSTRUCTION_AUTHORITY_PUBLICATION_CHAIN_INVALID:urn:fixture:policy:construction:3"]);
  // The file-asset-index defect: dependency-ready, yet no policy makes it
  // eligible, so it is permanently non-actionable until a sibling policy exists.
  assert.deepEqual(risks.get("urn:fixture:work:orphan"), ["CONSTRUCTION_WORK_NOT_ELIGIBLE", "WORK_COMPLETION_NOT_ELIGIBLE"]);

  const shared = "urn:fixture:policy:shared:1";
  const sibling = "urn:fixture:policy:sibling:1";
  const radius = policyBlastRadius(graphOf([
    // `enumerated-only` is enumerated by the shared policy but the policy is
    // absent from its scoped closure, so a digest move cannot stale it.
    // Deriving the radius from eligibleWork would wrongly include it.
    ...policy(shared, constructionPolicyType, ["urn:fixture:work:complete", "urn:fixture:work:granted", "urn:fixture:work:enumerated-only"], "urn:fixture:algorithm:shared:1", true),
    ...policy(sibling, constructionPolicyType, ["urn:fixture:work:fresh"], "urn:fixture:algorithm:sibling:1", true),
  ]) as never, [
    packetOf("urn:fixture:work:complete", { verified: true, authority: "active-permission", policies: [shared] }),
    packetOf("urn:fixture:work:granted", { authority: "active-permission", policies: [shared] }),
    packetOf("urn:fixture:work:enumerated-only", { verified: true, authority: "active-permission", policies: [] }),
    packetOf("urn:fixture:work:blocked", { policies: [shared] }),
    packetOf("urn:fixture:work:fresh", { policies: [sibling] }),
  ] as never);
  assert.equal(radius.derivation, "scoped-dependency-closure-membership");
  const rows = new Map((radius.rows as readonly { policy: string; stalesOnChange: readonly { work: string }[]; currentGrantsAtRisk: number; currentCompletionsAtRisk: number }[]).map((row) => [row.policy, row]));
  assert.deepEqual(rows.get(shared)?.stalesOnChange.map((entry) => entry.work), ["urn:fixture:work:complete", "urn:fixture:work:granted"]);
  assert.equal(rows.get(shared)?.currentCompletionsAtRisk, 1);
  assert.equal(rows.get(shared)?.currentGrantsAtRisk, 1);
  // A disjoint sibling policy covering only new work stales nothing. This
  // read-back is what replaces trial amendment and rollback.
  assert.deepEqual(rows.get(sibling)?.stalesOnChange, []);
});

test("the live selected closure is cross-checked against the filesystem and the work read-back", async (t) => {
  if (childProcessUnavailable(t)) return;
  const status = JSON.parse(String(spawnSync(usf, ["status", "--profile", "urn:usf:profile:v3-self-host:3", "--manifest", "graph/manifests/self-host-provider-v3.json"], { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 }).stdout).trim()) as Json;

  // Every closure verdict must agree with the filesystem, and satisfiable must
  // mean exactly "no reason codes".
  const closure = status.closureSatisfiability as Json;
  for (const row of closure.rows as unknown as Row[]) {
    assert.equal(row.satisfiable, (row.reasonCodes as unknown as string[]).length === 0);
    for (const reason of row.reasonCodes as unknown as string[]) {
      const missing = /^CLOSURE_MEMBER_MISSING:(.+)$/u.exec(reason);
      if (missing !== null) assert.equal(existsSync(join(repositoryRoot, missing[1]!)), false, `${missing[1]} was reported missing but exists`);
    }
    if (row.satisfiable === true) assert.equal(row.declaredMemberCount, row.runtimePathCount);
  }

  // Blast-radius membership must agree with the independent work read-back.
  const work = JSON.parse(String(spawnSync(usf, ["work", "--profile", "urn:usf:profile:v3-self-host:3", "--manifest", "graph/manifests/self-host-provider-v3.json"], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30_000 }).stdout).trim()) as Json;
  const closureOf = new Map((work.items as unknown as Row[]).map((item) => [
    item.id as unknown as string,
    new Set((((item.realisationBasis as Json).work as Json).dependencies as unknown as { key: string }[]).map((dependency) => dependency.key)),
  ]));
  for (const row of (status.policyBlastRadius as Json).rows as unknown as Row[]) {
    for (const stale of row.stalesOnChange as unknown as { work: string }[]) {
      assert.ok(closureOf.get(stale.work)?.has(row.policy as unknown as string), `${row.policy} is not in ${stale.work}'s scoped closure`);
    }
  }
});
