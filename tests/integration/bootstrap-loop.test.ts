import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { runBootstrapLoop, type BootstrapLoopInput, type ProfileBoundWorkPacket } from "../../src/bootstrap/loop.ts";
import { loadSemanticGraph } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import { fakeProviderRoutes } from "../../src/providers/fake.ts";
import type { RealisationBasis } from "../../src/realisation/basis.ts";
import { applyTransitionOperations, reverseTransitionOperations, verifyTransitionActivationCurrentness } from "../../src/realisation/transition.ts";

const sourceRoot = resolve(import.meta.dirname, "../..");
const workspaceTemporaryRoot = process.env.TMPDIR === undefined ? resolve(sourceRoot, ".usf/tmp") : resolve(process.env.TMPDIR);
const manifestPath = "graph/manifests/self-host.json";
const profile = "urn:usf:profile:v3-self-host:1";
const workId = "urn:usf:work:realisation-basis-chain";
const implementationPath = "tests/unit/realisation/workspace.test.ts";
const checkPath = "tests/adversarial/realisation-check.test.ts";
const sourcePath = "graph/semantic-first.nq";
const gatePermission = "urn:usf:permission:semantic-first-order";
const gateCurrentness = "urn:usf:currentness:semantic-first-bootstrap-transition:1";
const outerValidation = "node --test --test-isolation=none tests/unit/providers/routing.test.ts tests/contract/fake-call-resolve.test.ts tests/unit/realisation/workspace.test.ts tests/adversarial/realisation-check.test.ts tests/integration/bootstrap-loop.test.ts";
const innerValidation = "node --test --test-isolation=none tests/unit/providers/routing.test.ts tests/contract/fake-call-resolve.test.ts tests/unit/realisation/workspace.test.ts tests/adversarial/realisation-check.test.ts";

async function canonicalPreSource(): Promise<string> {
  const currentSource = await readFile(resolve(sourceRoot, sourcePath), "utf8");
  const currentGraph = loadSemanticGraph(sourceRoot, manifestPath);
  const states = currentGraph.quads
    .filter((quad) => quad.subject === gatePermission && quad.predicate === "urn:usf:predicate:activationState" && quad.objectKind === "iri")
    .map((quad) => quad.object);
  assert.equal(states.length, 1, "the source gate permission state is exact");
  if (states[0] === "urn:usf:contract-state:proofblocked") return currentSource;
  assert.equal(states[0], "urn:usf:contract-state:active", "only the exact pre or verified post state may seed a bootstrap fixture");
  const verified = verifyTransitionActivationCurrentness(currentGraph, gateCurrentness, gatePermission, profile);
  const sourceBefore = reverseTransitionOperations(currentSource, verified.receipt.operations);
  assert.equal(applyTransitionOperations(sourceBefore, verified.receipt.operations), currentSource, "the verified receipt exactly reconstructs the canonical post-state");
  return sourceBefore;
}

async function fixture(context: TestContext): Promise<string> {
  await mkdir(workspaceTemporaryRoot, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(join(workspaceTemporaryRoot, "usf-bootstrap-loop-"));
  const root = join(parent, "repo");
  await mkdir(root);
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".usf")) continue;
    await cp(join(sourceRoot, entry.name), join(root, entry.name), { recursive: true });
  }
  const graphPath = join(root, sourcePath);
  const canonicalGraph = await canonicalPreSource();
  assert.equal(canonicalGraph.split(outerValidation).length - 1, 1, "the canonical outer validation must include this integration test exactly once");
  const specialisedGraph = canonicalGraph.replace(outerValidation, innerValidation);
  assert.equal(specialisedGraph.includes(outerValidation), false);
  assert.equal(specialisedGraph.split(innerValidation).length - 1, 1, "the inner focused check must remain one exact graph-defined component suite");
  await writeFile(graphPath, specialisedGraph, "utf8");
  context.after(() => rm(parent, { recursive: true, force: true }));
  return root;
}

function packet(root: string): ProfileBoundWorkPacket {
  const result = deriveWork(loadSemanticGraph(root, manifestPath), { profile, selector: workId });
  assert.equal(result.status, "ok");
  const value = result.items?.[0] as ProfileBoundWorkPacket | undefined;
  assert.ok(value?.realisationBasis, "bootstrap work must be graph-derived and profile-bound");
  return value;
}

test("work currentness imports WorkPacket content only through explicit predecessors", async (context) => {
  const root = await fixture(context);
  const graph = loadSemanticGraph(root, manifestPath);
  const gateWork = "urn:usf:work:semantic-first-eligibility";
  const realisationWork = "urn:usf:work:realisation-basis-chain";
  const lifecycleWork = "urn:usf:work:semantic-first-lifecycle-admission";
  const siblingWork = "urn:usf:work:repository-path-scope";
  const policy = "urn:fixture:policy:directional-work-currentness";
  const identitySource = "urn:usf:requirement:semantic-realisation-basis";
  const validationSeed = "urn:usf:validation:realisation-basis-chain-focused";
  const identityPredicate = "urn:usf:predicate:ownerWork";
  const eligibleWork = "urn:usf:predicate:eligibleWork";
  const typePredicate = "urn:usf:predicate:type";
  const workType = "urn:usf:type:WorkPacket";
  const graphName = "urn:usf:graph:semantic-first";
  const syntheticGraph = {
    ...graph,
    quads: [...graph.quads,
      { subject: policy, predicate: "urn:usf:predicate:type", object: "urn:usf:type:ConstructionAuthorityPublicationPolicy", objectKind: "iri" as const, graph: graphName, canonical: "planted construction policy type" },
      ...[realisationWork, lifecycleWork].map((work) => ({ subject: policy, predicate: eligibleWork, object: work, objectKind: "iri" as const, graph: graphName, canonical: `planted eligible work ${work}` })),
      { subject: identitySource, predicate: identityPredicate, object: lifecycleWork, objectKind: "iri" as const, graph: graphName, canonical: "planted non-predecessor work identity edge" },
    ],
  };
  const derivePacket = (candidateGraph: typeof syntheticGraph) => {
    const result = deriveWork(candidateGraph, { profile, selector: realisationWork, maxItems: 1 });
    assert.equal(result.status, "ok");
    const value = result.items?.[0];
    assert.ok(value?.realisationBasis);
    return value;
  };
  const workResources = (value: ReturnType<typeof derivePacket>) => value.semanticDependencies
    .filter((dependency) => dependency.kind === "semantic-resource" && syntheticGraph.quads.some((quad) => quad.subject === dependency.key
      && quad.predicate === typePredicate && quad.objectKind === "iri" && quad.object === workType))
    .map((dependency) => dependency.key);
  const realisation = derivePacket(syntheticGraph);
  assert.deepEqual(workResources(realisation), [gateWork, realisationWork].sort());

  const changedLifecycleGraph = {
    ...syntheticGraph,
    quads: syntheticGraph.quads.map((quad) => quad.subject === lifecycleWork && quad.predicate === "urn:usf:predicate:objective"
      ? { ...quad, object: quad.object + " changed", canonical: quad.canonical + "|changed-downstream-work" }
      : quad),
  };
  const stableRealisation = derivePacket(changedLifecycleGraph);
  assert.equal(stableRealisation.scopedDependencyDigest, realisation.scopedDependencyDigest);

  const changedPredecessorGraph = {
    ...syntheticGraph,
    quads: syntheticGraph.quads.map((quad) => quad.subject === gateWork && quad.predicate === "urn:usf:predicate:objective"
      ? { ...quad, object: quad.object + " changed", canonical: quad.canonical + "|changed-explicit-predecessor" }
      : quad),
  };
  const predecessorChangedRealisation = derivePacket(changedPredecessorGraph);
  assert.notEqual(predecessorChangedRealisation.scopedDependencyDigest, realisation.scopedDependencyDigest);

  const changedPolicyIdentityGraph = {
    ...syntheticGraph,
    quads: syntheticGraph.quads.map((quad) => quad.subject === policy && quad.predicate === eligibleWork && quad.object === lifecycleWork
      ? { ...quad, object: siblingWork, canonical: quad.canonical + "|changed-policy-work-identity" }
      : quad),
  };
  assert.notEqual(derivePacket(changedPolicyIdentityGraph).scopedDependencyDigest, realisation.scopedDependencyDigest);

  const ambiguousSeedGraph = {
    ...syntheticGraph,
    quads: [...syntheticGraph.quads,
      { subject: validationSeed, predicate: typePredicate, object: workType, objectKind: "iri" as const, graph: graphName, canonical: "planted ambiguous WorkPacket seed" },
    ],
  };
  assert.throws(() => derivePacket(ambiguousSeedGraph), new RegExp(`SEMANTIC_WORK_PACKET_SEED_INVALID:${validationSeed}$`));
});
test("profile-bound work preserves one current basis through heterogeneous calls and isolated check", async (context) => {
  const root = await fixture(context);
  const work = packet(root);
  const implementationBefore = await readFile(join(root, implementationPath), "utf8");
  const checkBefore = await readFile(join(root, checkPath), "utf8");
  const [implementationRoute, testRoute] = fakeProviderRoutes();

  const input: BootstrapLoopInput = {
    repositoryRoot: root,
    work,
    proposals: [
      { route: implementationRoute!, operations: [{ kind: "write", path: implementationPath, content: implementationBefore }] },
      { route: testRoute!, operations: [{ kind: "write", path: checkPath, content: checkBefore }] },
    ],
    hostConcurrency: 2,
  };
  const permission = (process as typeof process & { permission?: { has(scope: string): boolean } }).permission;
  if (permission !== undefined && !permission.has("child_process")) {
    assert.equal(work.decisionBoundary.kind, "realisation-profile");
    assert.equal(work.realisationBasis.work.id, work.id);
    assert.equal(work.realisationBasis.work.scopedDependencyDigest, work.scopedDependencyDigest);
    assert.equal(work.eligibility?.construction.eligible, true);
    assert.equal(input.proposals.length, 2);
  } else {
    const result = await runBootstrapLoop(input);
    assert.equal(result.status, "checked");
    assert.equal(result.basis.basisDigest, work.realisationBasis.basisDigest);
    assert.equal(result.calls.basis.basisDigest, result.basis.basisDigest);
    assert.equal(result.calls.metrics.succeeded, 2);
    assert.equal(result.calls.contributions.every((contribution) => contribution.identity.basisDigest === result.basis.basisDigest), true);
    assert.equal(result.contributionDigests.length, 2);
    assert.equal(result.check.status, "pass");
    assert.equal(result.check.basis.basisDigest, result.basis.basisDigest);
  }
  assert.equal(await readFile(join(root, implementationPath), "utf8"), implementationBefore);
  assert.equal(await readFile(join(root, checkPath), "utf8"), checkBefore);

  await assert.rejects(
    () => runBootstrapLoop({
      repositoryRoot: root,
      work: { ...work, realisationBasis: undefined as unknown as RealisationBasis },
      proposals: [{ route: implementationRoute!, operations: [{ kind: "write", path: implementationPath, content: implementationBefore }] }],
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "BOOTSTRAP_BASIS_INVALID",
  );
});
