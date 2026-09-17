import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalDigest, canonicalJson } from "../../../src/core/canonical.ts";
import { deriveWork } from "../../../src/graph/work.ts";
import { loadSemanticGraph, validationRuntimeClosure } from "../../../src/graph/index.ts";
import { deriveConstructionAuthority } from "../../../src/realisation/construction-authority.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../../../src/graph/nquads.ts";
import { constructionAwarePublishCommandHandler, evidenceCommandHandler, proveCommandHandler } from "../../../src/commands/construction-authority.ts";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { bindingSelector } from "../../../src/commands/hermes.ts";
import {
  LinearBindingError,
  afterHermesResult,
  afterHermesRefusal,
  beforeHermesDispatch,
  observeLinearBinding,
  prepareLinearBinding,
  withNativeLinearCompletion,
  type GraphExecutionEvidenceDigest,
  type LinearBindingSelector,
} from "../../../src/commands/linear-binding.ts";

const manifestPath = "graph/manifests/linear-work-binding.json";
  const bindingManifestPath = "graph/manifests/linear-issue-bindings.json";
  const bindingGraphPath = "graph/linear-issue-bindings.nq";
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

  const { sourcePath: grantsSourcePath, targetGraphIri } = deriveConstructionAuthority(graph, work, manifestPath);
  // Imported grant records without their matching receipt cannot seed a fixture.
  await writeFile(resolve(root, grantsSourcePath), [
    `<urn:usf:record:linear-work-binding-grants-empty> <urn:usf:predicate:forContract> <urn:usf:contract:linear-work-binding:1> <${targetGraphIri}> .`,
    `<urn:usf:record:linear-work-binding-grants-empty> <urn:usf:predicate:text> "No construction or completion authority is published in this source." <${targetGraphIri}> .`,
    `<urn:usf:record:linear-work-binding-grants-empty> <urn:usf:predicate:type> <urn:usf:type:SemanticRecordType> <${targetGraphIri}> .`,
    "",
  ].join("\n"));

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
  assert.equal(Object.hasOwn(result.binding.authority, "maximumOutputTokens"), false);
  assert.equal(Object.hasOwn(result.binding.unit, "maximumOutputTokens"), false);
  const legacy = result.binding.authority;
  assert.equal(result.binding.unit.intentKey, canonicalDigest({
    locator: legacy.locator, owner: legacy.owner, profile: legacy.profile,
    manifestPath: legacy.targetManifest, workIri: legacy.workIri, fixedPrompt: legacy.fixedPrompt,
    maximumPromptTokens: legacy.maximumPromptTokens, supersedes: legacy.supersedes,
  }), "absent output policy must retain the exact legacy intent domain");
  const prompt = JSON.parse(result.binding.unit.prompt) as { objective: unknown; fixedPrompt: unknown };
  assert.equal(prompt.objective, result.binding.unit.packet.objective);
  assert.equal(prompt.fixedPrompt, "Use only graph-derived semantic work.");

  const source = await readFile(resolve(selector.repositoryRoot, result.binding.unitPath), "utf8");
  const graph = `urn:usf:graph:hermes-input:${result.binding.unit.attemptKey}`;
  const quads = parseStrictNQuads(source, graph);
  assert.equal(quads.some(q => q.predicate === "urn:usf:predicate:maximumOutputTokens"), false);
  const work = {
    file: result.binding.unitPath,
    graph,
    unitIris: [result.binding.unit.unitIri],
    quads,
  };
  assert.deepEqual(bindingSelector(selector.repositoryRoot, work), selector);

  const bindingIriQuad = `<${result.binding.unit.unitIri}> <urn:usf:predicate:bindingIri> <${selector.bindingIri}> <${graph}> .`;
  const wrongKindSource = source.replace(
    bindingIriQuad,
    `<${result.binding.unit.unitIri}> <urn:usf:predicate:bindingIri> ${JSON.stringify(selector.bindingIri)} <${graph}> .`,
  );
  assert.notEqual(wrongKindSource, source);
  assert.throws(
    () => bindingSelector(selector.repositoryRoot, { ...work, quads: parseStrictNQuads(wrongKindSource, graph) }),
    (error: unknown) => (error as { code?: unknown }).code === "HERMES_LINEAR_BINDING_METADATA_INVALID",
  );

  const extraUnit = "urn:usf:work-unit:mixed-extra";
  const mixedSource = `${source}<${extraUnit}> <urn:usf:predicate:type> <urn:usf:type:SemanticWorkUnit> <${graph}> .\n`;
  assert.throws(
    () => bindingSelector(selector.repositoryRoot, {
      ...work,
      unitIris: [result.binding.unit.unitIri, extraUnit],
      quads: parseStrictNQuads(mixedSource, graph),
    }),
    (error: unknown) => (error as { code?: unknown }).code === "HERMES_LINEAR_BINDING_METADATA_INVALID",
  );
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

test("canonical zero-success refusal evidence self-reconciles a STARTED attempt for retry", async () => {
  const selector = await addBinding(await fixtureRoot());
  const started = await beforeHermesDispatch(selector);
  assert.equal(started.status, "STARTED");
  const graph = await readFile(resolve(selector.repositoryRoot, started.binding.unitPath), "utf8");
  const sourceGraph = `urn:usf:graph:hermes-input:${started.binding.unit.attemptKey}`;
  const sourceAssertionDigest = canonicalQuadDigest(parseStrictNQuads(graph, sourceGraph));
  const digest = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
  const evidence = {
    schema: "urn:usf:graph-execution-evidence:1",
    version: 1,
    status: "refused",
    observedAt: "2026-09-14T00:00:00.000Z",
    sourceGraph,
    sourceGraphDigest: sourceAssertionDigest,
    economicsClosureDigest: digest("economics"),
    resultGraph: "urn:usf:graph:hermes-result:refused",
    resultGraphDigest: digest("result-graph"),
    workUnitCount: 1,
    declaredUnitCount: 1,
    dependencyEdgeCount: 0,
    dependencyAcyclic: true,
    selectedUnits: [started.binding.unit.unitIri],
    externallySatisfiedDependencies: [],
    succeededCount: 0,
    authoritySnapshot: { schema: "test" },
    catalogue: { providerCount: 1 },
    concurrency: { requested: 1 },
    localAgentDispositions: [],
    units: [{
      unit: started.binding.unit.unitIri,
      sourceAssertionDigest,
      requiredCapabilities: [...started.binding.unit.modelCapabilities],
      candidatesConsidered: 1,
      attempts: [{ reasonCode: "PROVIDER_RATE_LIMITED" }],
      eligible: true,
      status: "refused",
      reasonCode: "PROVIDER_RATE_LIMITED",
      selectedCandidateId: null,
      transport: null,
      actualModel: null,
      invocationIdentity: null,
      usage: null,
      transportReportedCostUsd: null,
      resultDigest: null,
      resultText: null,
    }],
    nonClaims: [],
    deferredRouteCount: 0,
  };
  const evidenceDigest = canonicalDigest(evidence) as GraphExecutionEvidenceDigest;
  const evidenceRoot = resolve(selector.repositoryRoot, ".usf/graph-executions");
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await writeFile(resolve(evidenceRoot, `${evidenceDigest.slice(7)}.json`), `${canonicalJson(evidence, { rejectAbsolutePaths: true })}\n`, { mode: 0o600 });

  const retried = await beforeHermesDispatch(selector);
  assert.equal(retried.status, "STARTED");
  assert.equal((await observeLinearBinding(selector)).status, "STARTED");
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


test("native no-change binding keeps complete scope but does not build provider source context", async () => {
  const selector = await addBinding(await fixtureRoot());
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8")).replace('"20000"', '"100000"')
    + nq(selector.bindingIri, "realisationDisposition", "no-change") + "\n");
  const prepared = await prepareLinearBinding(selector);
  assert.equal(prepared.status, "PREPARED");
  assert.equal(prepared.binding.authority.realisationDisposition, "no-change");
  assert.equal(prepared.binding.unit.packet.writeSet.includes("src/commands/linear-binding.ts"), true);
  assert.equal("writeSetContext" in JSON.parse(prepared.binding.unit.prompt), false);
  await assert.rejects(beforeHermesDispatch(selector), reason("LINEAR_BINDING_NATIVE_NO_CHANGE_ONLY"));
  assert.equal((await observeLinearBinding(selector)).status, "PREPARED");
});

test("native no-change disposition rejects malformed declarations", async () => {
  const selector = await addBinding(await fixtureRoot());
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8"))
    + nq(selector.bindingIri, "realisationDisposition", "skip-proof") + "\n");
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_REALISATION_DISPOSITION_INVALID"));
});

test("native no-change disposition is part of immutable binding intent", async () => {
  const selector = await addBinding(await fixtureRoot());
  await prepareLinearBinding(selector);
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8"))
    + nq(selector.bindingIri, "realisationDisposition", "no-change") + "\n");
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_SUPERSESSION_REQUIRED"));
});

test("native no-change metadata still obeys the conservative UTF-8 byte bound", async () => {
  const selector = await addBinding(await fixtureRoot());
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8")).replace('"20000"', '"100000"')
    .replace('"Use only graph-derived semantic work."', JSON.stringify("\u00e9".repeat(60000)))
    + nq(selector.bindingIri, "realisationDisposition", "no-change") + "\n");
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_PROMPT_POLICY_INVALID"));
});

test("native no-change provider hand-dispatch never enters STARTED", async () => {
  const selector = await addBinding(await fixtureRoot());
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8"))
    + nq(selector.bindingIri, "realisationDisposition", "no-change") + "\n");
  await prepareLinearBinding(selector);
  await assert.rejects(beforeHermesDispatch(selector), reason("LINEAR_BINDING_NATIVE_NO_CHANGE_ONLY"));
  assert.equal((await observeLinearBinding(selector)).status, "PREPARED");
});

test("native no-change settlement requires genuine terminal proof and serializes competing effects", async () => {
  const selector = await addBinding(await fixtureRoot());
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8"))
    + nq(selector.bindingIri, "realisationDisposition", "no-change") + "\n");
  const prepared = await prepareLinearBinding(selector);
  let active = 0;
  let peak = 0;
  let calls = 0;
  const effect = async () => {
    calls += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    return { claimedComplete: true };
  };
  const outcomes = await Promise.allSettled([
    withNativeLinearCompletion(selector, prepared.binding.unit.attemptKey, effect),
    withNativeLinearCompletion(selector, prepared.binding.unit.attemptKey, effect),
  ]);
  assert.equal(peak, 1);
  assert.ok(calls >= 1);
  assert.equal(outcomes.every(value => value.status === "rejected"), true);
  assert.equal((await observeLinearBinding(selector)).status, "PREPARED");
});


test("candidate lock initialization tolerates concurrent issuers without relaxing directory safety", async (context) => {
  const { withCandidateLock } = await import("../../../src/realisation/index.ts");
  const { chmod, stat } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "usf-binding-lock-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let entered = 0;
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, issuer) =>
    withCandidateLock(root, canonicalDigest({ issuer }), async () => { entered += 1; })));
  assert.equal(results.every(result => result.status === "fulfilled"), true,
    results.filter(result => result.status === "rejected").map(result => String(result.reason)).join("\n"));
  assert.equal(entered, 4);
  const directory = resolve(root, ".usf/locks/candidates");
  await chmod(directory, 0o755);
  await assert.rejects(
    withCandidateLock(root, canonicalDigest({ issuer: "unsafe" }), async () => { entered += 1; }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === "CANDIDATE_LOCK_UNAVAILABLE",
  );
  assert.equal((await stat(directory)).mode & 0o777, 0o755);
  assert.equal(entered, 4);
});

test("legacy prepared binding intent remains immutable without a current intent index", async () => {
  const selector = await addBinding(await fixtureRoot());
  await prepareLinearBinding(selector);
  // Test-only removal models a record produced before the intent index existed.
  const key = canonicalDigest({ bindingIri: selector.bindingIri });
  await rm(resolve(selector.repositoryRoot, ".usf/work/linear/bindings", key.slice(7) + ".json"), { force: true });
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  await writeFile(path, (await readFile(path, "utf8"))
    + nq(selector.bindingIri, "realisationDisposition", "no-change") + "\n");
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_SUPERSESSION_REQUIRED"));
  await assert.rejects(observeLinearBinding(selector), reason("LINEAR_BINDING_SUPERSESSION_REQUIRED"));
});

async function settledProviderPredecessor(selector: LinearBindingSelector, state: "SETTLED" | "REFUSED" = "SETTLED") {
  const started = await beforeHermesDispatch(selector);
  assert.equal(started.status, "STARTED");
  const sourceGraph = "urn:usf:graph:hermes-input:" + started.binding.unit.attemptKey;
  const graphText = await readFile(resolve(selector.repositoryRoot, started.binding.unitPath), "utf8");
  const sourceAssertionDigest = canonicalQuadDigest(parseStrictNQuads(graphText, sourceGraph));
  const successful = state === "SETTLED";
  const resultText = "synthetic predecessor fixture, not provider contact";
  const evidence = {
    schema: "urn:usf:graph-execution-evidence:1", version: 1, status: successful ? "ok" : "refused",
    observedAt: "2026-09-16T00:00:00.000Z", sourceGraph, sourceGraphDigest: sourceAssertionDigest,
    economicsClosureDigest: canonicalDigest("fixture economics"), resultGraph: "urn:test:predecessor-result",
    resultGraphDigest: canonicalDigest("fixture result graph"), workUnitCount: 1, declaredUnitCount: 1,
    dependencyEdgeCount: 0, dependencyAcyclic: true, selectedUnits: [started.binding.unit.unitIri],
    externallySatisfiedDependencies: [], succeededCount: successful ? 1 : 0, authoritySnapshot: {},
    catalogue: {}, concurrency: {}, localAgentDispositions: [], nonClaims: ["synthetic fixture only"],
    deferredRouteCount: 0,
    units: [{ unit: started.binding.unit.unitIri, sourceAssertionDigest, requiredCapabilities: [...started.binding.unit.modelCapabilities],
      candidatesConsidered: 1, attempts: [], status: successful ? "ok" : "refused",
      selectedCandidateId: successful ? "fixture" : null, transport: successful ? "fixture" : null,
      actualModel: null, invocationIdentity: null, usage: null, transportReportedCostUsd: null,
      resultDigest: successful ? canonicalDigest(resultText) : null, resultText: successful ? resultText : null }],
  };
  const evidenceDigest = canonicalDigest(evidence) as GraphExecutionEvidenceDigest;
  const evidencePath = resolve(selector.repositoryRoot, ".usf/graph-executions/" + evidenceDigest.slice(7) + ".json");
  await mkdir(resolve(selector.repositoryRoot, ".usf/graph-executions"), { recursive: true, mode: 0o700 });
  await writeFile(evidencePath, canonicalJson(evidence) + "\n", { mode: 0o600 });
  const terminal = successful ? await afterHermesResult(selector, evidenceDigest) : await afterHermesRefusal(selector, evidenceDigest);
  assert.equal(terminal.status, state);
  const issuePath = resolve(selector.repositoryRoot, ".usf/work/linear/issues/" + canonicalDigest({ locator: terminal.binding.authority.locator }).slice(7) + ".json");
  return { terminal, issuePath, evidencePath, graphPath: resolve(selector.repositoryRoot, terminal.binding.unitPath),
    attemptPath: resolve(selector.repositoryRoot, terminal.binding.attemptPath) };
}
async function addNativeSuccessor(selector: LinearBindingSelector): Promise<LinearBindingSelector> {
  const path = resolve(selector.repositoryRoot, bindingGraphPath);
  const before = await readFile(path, "utf8");
  const bindingIri = selector.bindingIri + ":native";
  await writeFile(path, before + before.replaceAll("<" + selector.bindingIri + ">", "<" + bindingIri + ">")
    + nq(bindingIri, "supersedesBinding", selector.bindingIri, true) + "\n"
    + nq(bindingIri, "realisationDisposition", "no-change") + "\n");
  return { ...selector, bindingIri };
}

test("native successor admits terminal provider history without borrowing completion or repeating effects", async () => {
  for (const state of ["SETTLED", "REFUSED"] as const) {
    const previous = await addBinding(await fixtureRoot());
    const retained = await settledProviderPredecessor(previous, state);
    const history = await Promise.all([retained.issuePath, retained.attemptPath, retained.evidencePath, retained.graphPath]
      .map(async path => [path, await readFile(path)] as const));
    const selector = await addNativeSuccessor(previous);
    const prepared = await prepareLinearBinding(selector);
    assert.equal(prepared.status, "PREPARED");
    assert.deepEqual(await readFile(retained.issuePath), history[0]![1], "prepare must not reserve or overwrite the predecessor");
    let effects = 0;
    const results = await Promise.allSettled([1, 2].map(() =>
      withNativeLinearCompletion(selector, prepared.binding.unit.attemptKey, async () => {
        effects += 1;
        return { claimedComplete: true };
      })));
    assert.equal(effects, 1, "one successor reservation must exclude every competing effect");
    assert.equal(results.every(result => result.status === "rejected"), true);
    assert.equal((await observeLinearBinding(selector)).status, "PREPARED", "old provider settlement is not new native completion");
    const archive = resolve(selector.repositoryRoot, ".usf/work/linear/" + prepared.binding.unit.intentKey.slice(7) + "/predecessor-issue.json");
    assert.deepEqual(await readFile(archive), history[0]![1]);
    for (const [path, bytes] of history.slice(1)) assert.deepEqual(await readFile(path), bytes);
    const reserved = JSON.parse(await readFile(retained.issuePath, "utf8"));
    assert.equal(reserved.bindingIri, selector.bindingIri);
    assert.equal(reserved.state, "PREPARED");
    assert.equal(reserved.realisationDisposition, "no-change");
    await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_NATIVE_COMPLETION_UNPROVEN"));
    assert.equal(effects, 1);
  }
});

test("native successor rejects unresolved mismatched and unauthenticated predecessor history without mutation", async () => {
  const previous = await addBinding(await fixtureRoot());
  const retained = await settledProviderPredecessor(previous);
  const selector = await addNativeSuccessor(previous);
  const declarationPath = resolve(selector.repositoryRoot, bindingGraphPath);
  const paths = [retained.issuePath, retained.attemptPath, retained.evidencePath, retained.graphPath, declarationPath];
  const original = new Map(await Promise.all(paths.map(async path => [path, await readFile(path, "utf8")] as const)));
  const issue = JSON.parse(original.get(retained.issuePath)!);
  const attempt = JSON.parse(original.get(retained.attemptPath)!);
  const cases: Array<readonly [string, () => Promise<unknown>]> = [
    ["started", () => writeFile(retained.issuePath, canonicalJson({ ...issue, state: "STARTED" }) + "\n")],
    ["unknown", () => writeFile(retained.issuePath, canonicalJson({ ...issue, state: "UNKNOWN" }) + "\n")],
    ["wrong locator", () => writeFile(retained.issuePath, canonicalJson({ ...issue, locator: "workspace-main:123e4567-e89b-42d3-a456-426614174001" }) + "\n")],
    ["wrong intent", () => writeFile(retained.issuePath, canonicalJson({ ...issue, intentKey: canonicalDigest("foreign") }) + "\n")],
    ["unsettled attempt", () => writeFile(retained.attemptPath, canonicalJson({ ...attempt, state: "STARTED", executionResultIri: null, executionResultDigest: null }) + "\n")],
    ["missing attempt", () => rm(retained.attemptPath)],
    ["missing evidence", () => rm(retained.evidencePath)],
    ["changed result", () => writeFile(retained.attemptPath, canonicalJson({ ...attempt, executionResultDigest: canonicalDigest("wrong result") }) + "\n")],
    ["changed evidence", () => writeFile(retained.evidencePath, original.get(retained.evidencePath)!.replace("synthetic predecessor fixture", "altered predecessor fixture"))],
    ["changed assertion", () => writeFile(retained.graphPath, original.get(retained.graphPath)!.replace("Use only graph-derived semantic work.", "Altered historical prompt."))],
    ["missing supersession", () => writeFile(declarationPath, original.get(declarationPath)!.replace(nq(selector.bindingIri, "supersedesBinding", previous.bindingIri, true) + "\n", ""))],
    ["changed predecessor intent", () => writeFile(declarationPath, original.get(declarationPath)!.replace(
      nq(previous.bindingIri, "fixedPrompt", "Use only graph-derived semantic work."), nq(previous.bindingIri, "fixedPrompt", "Changed predecessor.")))],
  ];
  for (const [name, mutate] of cases) {
    for (const [path, bytes] of original) await writeFile(path, bytes, { mode: 0o600 });
    await mutate();
    const before = await Promise.all(paths.map(path => readFile(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    })));
    await assert.rejects(prepareLinearBinding(selector), error => error instanceof LinearBindingError, name);
    assert.deepEqual(await Promise.all(paths.map(path => readFile(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }))), before, name + " must not rewrite history");
  }
  for (const [path, bytes] of original) await writeFile(path, bytes, { mode: 0o600 });
  assert.equal((await prepareLinearBinding(selector)).status, "PREPARED", "the fully restored authenticated control must be admitted");
});

test("output token policy reaches the bound unit and immutable execution assertion", async () => {
  const selector = await addBinding(await fixtureRoot());
  const declarationPath = resolve(selector.repositoryRoot, bindingGraphPath);
  const original = await readFile(declarationPath, "utf8");
  const legacy = await observeLinearBinding(selector);
  await writeFile(declarationPath, original + nq(selector.bindingIri, "maximumOutputTokens", "8192") + "\n");
  const explicit = await prepareLinearBinding(selector);
  assert.equal(explicit.binding.authority.maximumOutputTokens, 8192);
  assert.equal(explicit.binding.unit.maximumOutputTokens, 8192);
  assert.notEqual(explicit.binding.unit.intentKey, legacy.binding.unit.intentKey);
  assert.notEqual(explicit.binding.unit.attemptKey, legacy.binding.unit.attemptKey);
  assert.equal(explicit.binding.unit.prompt, legacy.binding.unit.prompt, "output allowance cannot expand source context");
  assert.deepEqual(explicit.binding.unit.packet.writeSet, legacy.binding.unit.packet.writeSet);
  const text = await readFile(resolve(selector.repositoryRoot, explicit.binding.unitPath), "utf8");
  const quads = parseStrictNQuads(text, "urn:usf:graph:hermes-input:" + explicit.binding.unit.attemptKey);
  const output = quads.filter(q => q.predicate === "urn:usf:predicate:maximumOutputTokens");
  assert.equal(output.length, 1);
  assert.equal(output[0]!.objectKind, "literal");
  assert.equal(output[0]!.object, "8192");
  assert.equal(output[0]!.subject, explicit.binding.unit.unitIri);
  assert.equal((await prepareLinearBinding(selector)).binding.unit.attemptKey, explicit.binding.unit.attemptKey);
  for (const value of [undefined, "4096"]) {
    await writeFile(declarationPath, original + (value === undefined ? "" : nq(selector.bindingIri, "maximumOutputTokens", value) + "\n"));
    await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_SUPERSESSION_REQUIRED"));
  }
});

test("output token policy cannot bypass an unresolved attempt by changing its bound", async () => {
  const selector = await addBinding(await fixtureRoot());
  const declarationPath = resolve(selector.repositoryRoot, bindingGraphPath);
  const original = await readFile(declarationPath, "utf8");
  await writeFile(declarationPath, original + nq(selector.bindingIri, "maximumOutputTokens", "8192") + "\n");
  const started = await beforeHermesDispatch(selector);
  assert.equal(started.status, "STARTED");
  assert.equal(started.binding.unit.maximumOutputTokens, 8192);
  await writeFile(declarationPath, original + nq(selector.bindingIri, "maximumOutputTokens", "4096") + "\n");
  await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_OUTCOME_UNKNOWN"));
  assert.equal(JSON.parse(await readFile(resolve(selector.repositoryRoot, started.binding.attemptPath), "utf8")).state, "STARTED");
});

test("output token policy is authenticated in retained provider history before native succession", async () => {
  for (const state of ["SETTLED", "REFUSED"] as const) {
    const previous = await addBinding(await fixtureRoot());
    const declarationPath = resolve(previous.repositoryRoot, bindingGraphPath);
    const original = await readFile(declarationPath, "utf8");
    await writeFile(declarationPath, original + nq(previous.bindingIri, "maximumOutputTokens", "8192") + "\n");
    const retained = await settledProviderPredecessor(previous, state);
    assert.equal(retained.terminal.binding.unit.maximumOutputTokens, 8192);
    const historyPaths = [retained.issuePath, retained.attemptPath, retained.evidencePath, retained.graphPath];
    const history = new Map<string, Buffer>();
    for (const path of historyPaths) history.set(path, await readFile(path));
    const selector = await addNativeSuccessor(previous);
    const successorSource = await readFile(declarationPath, "utf8");
    const nativeOutput = nq(selector.bindingIri, "maximumOutputTokens", "8192") + "\n";
    assert.equal(successorSource.split(nativeOutput).length, 2);
    await writeFile(declarationPath, successorSource.replace(nativeOutput, ""));
    assert.equal((await prepareLinearBinding(selector)).status, "PREPARED");
    for (const path of historyPaths) assert.deepEqual(await readFile(path), history.get(path), state);
    const graphText = history.get(retained.graphPath)!.toString("utf8");
    const limit = "<urn:usf:predicate:maximumOutputTokens> \"8192\"";
    assert.equal(graphText.split(limit).length, 2);
    await writeFile(retained.graphPath, graphText.replace(limit, "<urn:usf:predicate:maximumOutputTokens> \"4096\""));
    await assert.rejects(prepareLinearBinding(selector), reason("LINEAR_BINDING_RESULT_CORRELATION_MISMATCH"));
    await writeFile(retained.graphPath, history.get(retained.graphPath)!);
    assert.equal((await prepareLinearBinding(selector)).status, "PREPARED");
    for (const path of historyPaths) assert.deepEqual(await readFile(path), history.get(path), state + " history remains immutable");
  }
});
