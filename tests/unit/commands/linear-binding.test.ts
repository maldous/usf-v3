import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalDigest, canonicalJson } from "../../../src/core/canonical.ts";
import { deriveWork } from "../../../src/graph/work.ts";
import { loadSemanticGraph, validationRuntimeClosure } from "../../../src/graph/index.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { constructionAwarePublishCommandHandler, evidenceCommandHandler, proveCommandHandler } from "../../../src/commands/construction-authority.ts";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  LinearBindingError,
  afterHermesResult,
  beforeHermesDispatch,
  observeLinearBinding,
  prepareLinearBinding,
  type GraphExecutionEvidenceDigest,
  type LinearBindingSelector,
} from "../../../src/commands/linear-binding.ts";

const manifestPath = "graph/manifests/linear-work-binding.json";
const bindingManifestPath = "graph/manifests/linear-binding-authority.json";
const bindingGraphPath = "graph/linear-binding-authority.nq";
const sourceRoot = resolve(import.meta.dirname, "../../..");
const testRoots = new Set<string>();

test.afterEach(async () => {
  await Promise.all([...testRoots].map(async (root) => rm(root, { recursive: true, force: true })));
  testRoots.clear();
});

function reason(reasonCode: string): (error: unknown) => boolean {
  return (error) => error instanceof LinearBindingError && error.reasonCode === reasonCode;
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "usf-linear-binding-"));
  testRoots.add(root);

  const work = "urn:usf:work:linear-work-binding";
  const profile = "urn:usf:profile:linear-work-binding:1";
  const obligation = "urn:usf:proof:linear-work-binding:construction-authority";
  const graph = loadSemanticGraph(sourceRoot, manifestPath);
  const result = deriveWork(graph, { selector: work, profile, maxItems: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.items?.length, 1);
  const selected = result.items![0];
  const basis = selected.realisationBasis;
  assert.ok(basis);

  const requiredPaths = new Set<string>([
    manifestPath,
    ...validationRuntimeClosure(graph, "urn:usf:validation:linear-work-binding").repositoryReadFiles,
    ...selected.readSet,
    ...basis.scope.readSet,
    ...Object.keys(basis.scope.preimages),
    ...basis.inputs.schemaDigests.map(({ id }) => id),
    ...basis.inputs.toolDigests.map(({ id }) => id),
  ]);
  const optionalWritePaths = new Set<string>([
    ...selected.writeSet,
    ...basis.scope.writeSet,
  ]);
  for (const path of requiredPaths) optionalWritePaths.delete(path);

  const files = new Map<string, Buffer>();
  const pending = [...requiredPaths];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (files.has(path)) continue;
    const bytes = await readFile(resolve(sourceRoot, path));
    files.set(path, bytes);
    if (path.endsWith(".json")) {
      const value = JSON.parse(bytes.toString("utf8")) as { imports?: string[]; sources?: Array<{ path: string }> };
      for (const importedPath of [...(value.imports ?? []), ...(value.sources ?? []).map(({ path: sourcePath }) => sourcePath)]) {
        if (!files.has(importedPath)) pending.push(importedPath);
      }
    }
  }
  for (const path of optionalWritePaths) {
    try {
      files.set(path, await readFile(resolve(sourceRoot, path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const [path, bytes] of files) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), bytes);
  }

  const evidencePath = ".usf/candidates/construction-authority/linear-binding-evidence.json";
  const bundlePath = ".usf/candidates/construction-authority/linear-binding-bundle.json";
  await mkdir(resolve(root, ".usf/candidates/construction-authority"), { recursive: true, mode: 0o700 });
  const evidenceResult = await evidenceCommandHandler({
    command: "evidence",
    repositoryRoot: root,
    args: ["construction", "--work", work, "--profile", profile, "--manifest", manifestPath, "--output", evidencePath],
  });
  assert.equal(evidenceResult.exitCode ?? 0, 0);
  assert.equal((evidenceResult.output as { status: unknown }).status, "candidate");
  const proofResult = await proveCommandHandler({
    command: "prove",
    repositoryRoot: root,
    args: ["construction", "--obligation", obligation, "--evidence", evidencePath, "--profile", profile, "--manifest", manifestPath, "--output", bundlePath],
  });
  assert.equal(proofResult.exitCode ?? 0, 0);
  assert.equal((proofResult.output as { proof: { outcome: unknown } }).proof.outcome, "pass");
  const publicationResult = await constructionAwarePublishCommandHandler({
    command: "publish",
    repositoryRoot: root,
    args: ["construction-authority", "--bundle", bundlePath, "--profile", profile, "--manifest", manifestPath, "--apply"],
  });
  assert.equal(publicationResult.exitCode ?? 0, 0);
  assert.equal((publicationResult.output as { status: unknown }).status, "ok");

  await mkdir(resolve(root, "graph/manifests"), { recursive: true });
  return root;
}

function nq(subject: string, predicate: string, object: string, iri = false): string {
  return `<${subject}> <urn:usf:predicate:${predicate}> ${iri ? `<${object}>` : JSON.stringify(object)} <urn:usf:graph:linear-work-binding> .`;
}

async function addBinding(root: string, owner = "USF", binding = "urn:test:binding:one"): Promise<LinearBindingSelector> {
  const path = resolve(root, bindingGraphPath);
  const targetManifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8")) as Record<string, unknown>;
  const sourceManifest = {
    ...targetManifest,
    imports: [],
    sources: [{
      path: bindingGraphPath,
      format: "application/n-quads",
      graph: "urn:usf:graph:linear-work-binding",
      role: "contract",
      validationProfile: "bootstrap-nquads-v1",
    }],
  };
  await writeFile(resolve(root, bindingManifestPath), `${JSON.stringify(sourceManifest, null, 2)}\n`);
  const profile = "urn:usf:profile:linear-work-binding:1";
  const lines = [
    nq(binding, "type", "urn:usf:type:LinearIssueWorkBinding", true),
    nq(binding, "issueWorkspace", "workspace-main"),
    nq(binding, "issueUuid", "123e4567-e89b-42d3-a456-426614174000"),
    nq(binding, "canonicalIssueLocator", "workspace-main:123e4567-e89b-42d3-a456-426614174000"),
    nq(binding, "owningModel", owner),
    nq(binding, "selectedProfile", profile, true),
    nq(binding, "targetManifest", manifestPath),
    nq(binding, "workIri", "urn:usf:work:linear-work-binding", true),
    nq(binding, "fixedPrompt", "Use only graph-derived semantic work."),
    nq(binding, "maximumPromptTokens", "20000"),
  ];
  await writeFile(path, `${lines.join("\n")}\n`);
  return { repositoryRoot: root, manifestPath: bindingManifestPath, bindingIri: binding };
}

test("binding extraction is graph-only and preserves modelCapabilities", async () => {
  const selector = await addBinding(await fixtureRoot());
  const result = await prepareLinearBinding(selector);
  assert.equal(result.status, "PREPARED");
  assert.equal(result.binding.authority.owner, "USF");
  assert.equal(result.binding.unit.workIri, "urn:usf:work:linear-work-binding");
  assert.equal(result.binding.unit.bindingManifestPath, bindingManifestPath);
  assert.equal(result.binding.unit.manifestPath, manifestPath);
  assert.deepEqual(result.binding.unit.modelCapabilities, result.binding.unit.packet.modelCapabilities);
  assert.equal("requiredCapability" in result.binding.unit, false);
  const prompt = JSON.parse(result.binding.unit.prompt) as { objective: unknown; fixedPrompt: unknown };
  assert.equal(prompt.objective, result.binding.unit.packet.objective);
  assert.equal(prompt.fixedPrompt, "Use only graph-derived semantic work.");
});

test("caller cannot inject semantic authority fields", async () => {
  const selector = await addBinding(await fixtureRoot());
  await assert.rejects(prepareLinearBinding({ ...selector, workIri: "urn:forged" } as LinearBindingSelector), reason("LINEAR_BINDING_CALLER_AUTHORITY_REFUSED"));
  await assert.rejects(prepareLinearBinding({ ...selector, prompt: "forged" } as LinearBindingSelector), reason("LINEAR_BINDING_CALLER_AUTHORITY_REFUSED"));
  await assert.rejects(prepareLinearBinding({ ...selector, intentKey: "sha256:forged" } as LinearBindingSelector), reason("LINEAR_BINDING_CALLER_AUTHORITY_REFUSED"));
});

test("all four owning models are accepted and every other owner is refused", async () => {
  for (const owner of ["ANQR", "USF", "UXF", "UIF"] as const) {
    const selector = await addBinding(await fixtureRoot(), owner, `urn:test:binding:${owner}`);
    const result = await prepareLinearBinding(selector);
    assert.equal(result.binding.authority.owner, owner);
  }
  const invalid = await addBinding(await fixtureRoot(), "OTHER");
  await assert.rejects(prepareLinearBinding(invalid), reason("LINEAR_BINDING_OWNER_INVALID"));
});

test("same issue retry and cross-agent handoff reuse one intent and attempt", async () => {
  const selector = await addBinding(await fixtureRoot());
  const first = await prepareLinearBinding(selector);
  const second = await prepareLinearBinding(selector);
  assert.equal(first.binding.unit.intentKey, second.binding.unit.intentKey);
  assert.equal(first.binding.unit.attemptKey, second.binding.unit.attemptKey);
  assert.equal(first.binding.unitPath, second.binding.unitPath);
  assert.equal(first.binding.attemptPath, second.binding.attemptPath);
  assert.equal(first.binding.unitPath.endsWith(`${first.binding.unit.attemptKey.slice(7)}.nq`), true);
  const graph = await readFile(resolve(selector.repositoryRoot, first.binding.unitPath), "utf8");
  assert.equal(graph.includes(`<urn:usf:work-unit:${first.binding.unit.attemptKey}> <urn:usf:predicate:type> <urn:usf:type:SemanticWorkUnit>`), true);
  assert.equal(graph.includes(`<urn:usf:graph:hermes-input:${first.binding.unit.attemptKey}>`), true);
  assert.equal(graph.includes(`<urn:usf:predicate:bindingManifestPath> ${JSON.stringify(bindingManifestPath)}`), true);
  assert.equal(graph.includes(`<urn:usf:predicate:targetManifest> ${JSON.stringify(manifestPath)}`), true);
});

test("PREPARED becomes durable STARTED and interrupted retry becomes UNKNOWN without redispatch", async () => {
  const selector = await addBinding(await fixtureRoot());
  assert.equal((await prepareLinearBinding(selector)).status, "PREPARED");
  const started = await beforeHermesDispatch(selector);
  assert.equal(started.status, "STARTED");
  const retried = await beforeHermesDispatch(selector);
  assert.equal(retried.status, "UNKNOWN");
  assert.equal((await beforeHermesDispatch(selector)).status, "UNKNOWN");
  const stored = JSON.parse(await readFile(resolve(selector.repositoryRoot, retried.binding.attemptPath), "utf8")) as { state: string };
  assert.equal(stored.state, "UNKNOWN");
});

test("only immutable owner-private graph execution evidence settles a current STARTED attempt and recovers interrupted settlement", async () => {
  const selector = await addBinding(await fixtureRoot());
  const started = await beforeHermesDispatch(selector);
  assert.equal(started.status, "STARTED");
  const graph = await readFile(resolve(selector.repositoryRoot, started.binding.unitPath), "utf8");
  const digest = (text: string): `sha256:${string}` => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
  const resultText = "bounded Hermes output";
  const sourceGraph = `urn:usf:graph:hermes-input:${started.binding.unit.attemptKey}`;
  const sourceAssertionDigest = canonicalQuadDigest(parseStrictNQuads(graph, sourceGraph));
  const evidence = {
    schema: "urn:usf:graph-execution-evidence:1",
    version: 1,
    status: "ok",
    observedAt: "2026-09-06T00:00:00.000Z",
    sourceGraph,
    sourceGraphDigest: sourceAssertionDigest,
    economicsClosureDigest: digest("economics"),
    resultGraph: "urn:usf:graph:hermes-result:test",
    resultGraphDigest: digest("result-graph"),
    workUnitCount: 1,
    declaredUnitCount: 1,
    dependencyEdgeCount: 0,
    dependencyAcyclic: true,
    selectedUnits: [started.binding.unit.unitIri],
    externallySatisfiedDependencies: [],
    succeededCount: 1,
    authoritySnapshot: { schema: "test" },
    catalogue: { providerCount: 1 },
    concurrency: { requested: 1 },
    localAgentDispositions: [],
    units: [{ unit: started.binding.unit.unitIri, sourceAssertionDigest, requiredCapabilities: [...started.binding.unit.modelCapabilities], candidatesConsidered: 1, attempts: [], status: "ok", selectedCandidateId: "candidate", transport: "local", actualModel: null, invocationIdentity: null, usage: null, transportReportedCostUsd: null, resultDigest: canonicalDigest(resultText), resultText, observation: { native: true } }],
    nonClaims: [],
    deferredRouteCount: 0,
  };
  const evidenceText = canonicalJson(evidence, { rejectAbsolutePaths: true });
  const evidenceDigest = canonicalDigest(evidence) as GraphExecutionEvidenceDigest;
  const evidenceRoot = resolve(selector.repositoryRoot, ".usf/graph-executions");
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await writeFile(resolve(evidenceRoot, `${evidenceDigest.slice(7)}.json`), `${evidenceText}\n`, { mode: 0o600 });

  assert.equal((await beforeHermesDispatch(selector)).status, "UNKNOWN");
  const settled = await afterHermesResult(selector, evidenceDigest);
  assert.equal(settled.status, "SETTLED");
  assert.equal(settled.binding.attempt.executionResultDigest, canonicalDigest(resultText));
  assert.equal((await observeLinearBinding(selector)).status, "SETTLED");

  const repeated = await afterHermesResult(selector, evidenceDigest);
  assert.equal(repeated.status, "SETTLED");
  assert.equal(repeated.binding.unit.intentKey, settled.binding.unit.intentKey);
  assert.equal(repeated.binding.unit.attemptKey, settled.binding.unit.attemptKey);
  assert.equal(repeated.binding.attempt.executionResultDigest, settled.binding.attempt.executionResultDigest);

  const privateFiles: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) privateFiles.push(path);
    }
  };
  await visit(resolve(selector.repositoryRoot, ".usf/work"));
  const issueRecords: Array<{ path: string; value: Record<string, unknown> }> = [];
  for (const path of privateFiles) {
    if (path === resolve(selector.repositoryRoot, settled.binding.attemptPath)) continue;
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (
      value.state === "SETTLED"
      && canonicalJson(value, { rejectAbsolutePaths: true }).includes(settled.binding.unit.attemptKey)
      && canonicalJson(value, { rejectAbsolutePaths: true }).includes(selector.bindingIri)
    ) issueRecords.push({ path, value });
  }
  assert.equal(issueRecords.length, 1);
  const issueRecord = issueRecords[0]!;
  await writeFile(issueRecord.path, `${canonicalJson({ ...issueRecord.value, state: "STARTED" }, { rejectAbsolutePaths: true })}\n`);

  const recovered = await afterHermesResult(selector, evidenceDigest);
  assert.equal(recovered.status, "SETTLED");
  assert.equal(recovered.binding.unit.intentKey, settled.binding.unit.intentKey);
  assert.equal(recovered.binding.unit.attemptKey, settled.binding.unit.attemptKey);
  assert.equal(recovered.binding.attempt.executionResultDigest, settled.binding.attempt.executionResultDigest);
  assert.equal((await observeLinearBinding(selector)).status, "SETTLED");

  const changedResultText = "different bounded Hermes output";
  const changedEvidence = {
    ...evidence,
    units: [{
      ...evidence.units[0]!,
      resultDigest: canonicalDigest(changedResultText),
      resultText: changedResultText,
    }],
  };
  const changedEvidenceDigest = canonicalDigest(changedEvidence) as GraphExecutionEvidenceDigest;
  await writeFile(
    resolve(evidenceRoot, `${changedEvidenceDigest.slice(7)}.json`),
    `${canonicalJson(changedEvidence, { rejectAbsolutePaths: true })}\n`,
    { mode: 0o600 },
  );
  await assert.rejects(
    afterHermesResult(selector, changedEvidenceDigest),
    reason("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH"),
  );
});

test("caller-provided result objects and missing evidence digests are refused", async () => {
  const selector = await addBinding(await fixtureRoot());
  await beforeHermesDispatch(selector);
  await assert.rejects(afterHermesResult(selector, (() => undefined) as unknown as GraphExecutionEvidenceDigest), reason("LINEAR_BINDING_RESULT_INVALID"));
  await assert.rejects(afterHermesResult(selector, `sha256:${"a".repeat(64)}`), reason("LINEAR_BINDING_RESULT_INVALID"));
});

test("malformed locator and missing binding fail closed", async () => {
  const root = await fixtureRoot();
  await assert.rejects(prepareLinearBinding({ repositoryRoot: root, manifestPath, bindingIri: "urn:test:missing" }), reason("LINEAR_BINDING_GRAPH_BINDING_MISSING"));
  const selector = await addBinding(root);
  const path = resolve(root, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8")).replace("123e4567-e89b-42d3-a456-426614174000", "USF-1162"));
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_LOCATOR_INVALID"));
});

test("concurrent prepares reuse one durable immutable attempt", async () => {
  const selector = await addBinding(await fixtureRoot());
  const [left, right] = await Promise.all([
    prepareLinearBinding(selector),
    prepareLinearBinding(selector),
  ]);
  assert.equal(left.status, "PREPARED");
  assert.equal(right.status, "PREPARED");
  assert.equal(left.binding.unit.intentKey, right.binding.unit.intentKey);
  assert.equal(left.binding.unit.attemptKey, right.binding.unit.attemptKey);
  assert.equal(left.binding.unitPath, right.binding.unitPath);
  assert.equal(left.binding.attemptPath, right.binding.attemptPath);
  assert.deepEqual(
    await readFile(resolve(selector.repositoryRoot, left.binding.unitPath)),
    await readFile(resolve(selector.repositoryRoot, right.binding.unitPath)),
  );
});

test("an interrupted STARTED attempt refuses retry and changed scope while its outcome is unknown", async () => {
  const root = await fixtureRoot();
  const selector = await addBinding(root);
  const started = await beforeHermesDispatch(selector);
  assert.equal(started.status, "STARTED");
  assert.equal((await beforeHermesDispatch(selector)).status, "UNKNOWN");

  const graphPath = resolve(root, bindingGraphPath);
  await writeFile(
    graphPath,
    (await readFile(graphPath, "utf8")).replace(
      "Use only graph-derived semantic work.",
      "Use only changed graph-derived semantic work.",
    ),
  );
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_OUTCOME_UNKNOWN"));
});

test("status observation tolerates an absent private work subtree without creating it", async () => {
  const selector = await addBinding(await fixtureRoot());
  assert.equal((await observeLinearBinding(selector)).status, "PREPARED");
  await assert.rejects(readFile(resolve(selector.repositoryRoot, ".usf/work")));
});

test("prompt emission refuses a conservative UTF-8 byte bound above the declared cap", async () => {
  const selector = await addBinding(await fixtureRoot());
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8")).replace('"20000"', '"1"'));
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_PROMPT_POLICY_INVALID"));
});

test("owner-private ancestry rejects symlinks", async () => {
  const selector = await addBinding(await fixtureRoot());
  await mkdir(resolve(selector.repositoryRoot, ".usf"), { recursive: true, mode: 0o700 });
  await symlink(resolve(selector.repositoryRoot, "graph"), resolve(selector.repositoryRoot, ".usf/work"));
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_RUNTIME_UNSAFE"));
});
