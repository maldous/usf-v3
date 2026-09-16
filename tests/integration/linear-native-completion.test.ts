import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { loadSemanticGraph, objectsFor, validationRuntimeClosure } from "../../src/graph/index.ts";
import { deriveWork } from "../../src/graph/work.ts";
import { deriveConstructionAuthority } from "../../src/realisation/construction-authority.ts";
import { evidenceCommandHandler, proveCommandHandler, constructionAwarePublishCommandHandler } from "../../src/commands/construction-authority.ts";
import { prepareLinearBinding, observeLinearBinding, withNativeLinearCompletion, beforeHermesDispatch, afterHermesResult, afterHermesRefusal, type GraphExecutionEvidenceDigest, type LinearBindingSelector } from "../../src/commands/linear-binding.ts";
import { canonicalDigest, canonicalJson } from "../../src/core/canonical.ts";
import { canonicalQuadDigest, parseStrictNQuads } from "../../src/graph/nquads.ts";
import { executeLinearDelivery } from "../../src/commands/linear-delivery.ts";

const sourceRoot = resolve(import.meta.dirname, "../..");
const work = "urn:usf:work:linear-work-binding";
const profile = "urn:usf:profile:linear-work-binding:1";
const manifestPath = "graph/manifests/linear-work-binding.json";
const bindingManifestPath = "graph/manifests/linear-issue-bindings.json";
const bindingGraphPath = "graph/linear-issue-bindings.nq";
const bindingIri = "urn:usf:linear-binding:native-completion-integration:1";
const predecessorIri = "urn:usf:linear-binding:native-completion-integration:0";
const execFileAsync = promisify(execFile);

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function fixtureBinding(native: boolean): string {
  const graph = "urn:usf:graph:linear-issue-bindings";
  const fields: ReadonlyArray<readonly [string, string, boolean]> = [
    ["type", "urn:usf:type:LinearIssueWorkBinding", true],
    ["canonicalIssueLocator", "maldous:4cb48b98-2c3b-45c0-b805-612ee7fd1875", false],
    ["issueWorkspace", "maldous", false],
    ["issueUuid", "4cb48b98-2c3b-45c0-b805-612ee7fd1875", false],
    ["owningModel", "USF", false],
    ["workIri", work, true],
    ["selectedProfile", profile, true],
    ["targetManifest", manifestPath, false],
    ["maximumPromptTokens", "32000", false],
    ["fixedPrompt", "Authenticate the repaired binding work through every declared native completion obligation. Do not dispatch a provider or infer completion from a callback result.", false],
    ...(native ? [
      ["realisationDisposition", "no-change", false],
      ["supersedesBinding", predecessorIri, true],
    ] as const : []),
  ];
  return fields.map(([name, value, iri]) => `<${native ? bindingIri : predecessorIri}> <urn:usf:predicate:${name}> ${iri ? `<${value}>` : JSON.stringify(value)} <${graph}> .`).join("\n") + "\n";
}

async function isolatedBindingRepository(root: string): Promise<void> {
  const graph = loadSemanticGraph(sourceRoot, manifestPath);
  const checkAuthorityManifest = "graph/manifests/integration.json";
  const checkAuthorityGraph = loadSemanticGraph(sourceRoot, checkAuthorityManifest);
  const checkIntentSchema = objectsFor(checkAuthorityGraph,
    "urn:usf:schema:checked-candidate-execution-intent:1", "urn:usf:predicate:repositoryPath");
  assert.equal(checkIntentSchema.length, 1);
  assert.equal(checkIntentSchema[0]!.objectKind, "literal");
  const selected = deriveWork(graph, { selector: work, profile, maxItems: 1 }).items?.[0];
  assert.ok(selected?.realisationBasis);
  const basis = selected.realisationBasis;
  const completionPolicies = graph.quads.filter(quad =>
    quad.predicate === "urn:usf:predicate:eligibleWork" && quad.objectKind === "iri" && quad.object === work
    && objectsFor(graph, quad.subject, "urn:usf:predicate:type").some(type =>
      type.objectKind === "iri" && type.object === "urn:usf:type:NoChangeWorkCompletionPublicationPolicy"));
  assert.equal(completionPolicies.length, 1, "the fixture must use the selected work's unique completion policy");
  // Construction and validation inputs do not include every completion input.
  // Copy the graph-declared completion closure before publishing fixture authority.
  const completionPaths = ["schemaPath", "toolPath"].flatMap(name =>
    objectsFor(graph, completionPolicies[0]!.subject, `urn:usf:predicate:${name}`).map(quad => {
      assert.equal(quad.objectKind, "literal");
      return quad.object;
    }));
  const paths = new Set([
    manifestPath, bindingManifestPath,
    // The check engine loads this authority independently. Copy its closure;
    // do not import it into the selected work's semantic manifest.
    checkAuthorityManifest, checkIntentSchema[0]!.object,
    ...completionPaths,
    ...validationRuntimeClosure(graph, "urn:usf:validation:linear-work-binding").repositoryReadFiles,
    ...selected.readSet, ...basis.scope.readSet, ...Object.keys(basis.scope.preimages),
    ...basis.inputs.schemaDigests.map(({ id }) => id), ...basis.inputs.toolDigests.map(({ id }) => id),
  ]);
  const optional = new Set([...selected.writeSet, ...basis.scope.writeSet]);
  for (const path of paths) optional.delete(path);
  const files = new Map<string, Buffer>();
  const pending = [...paths];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (files.has(path)) continue;
    const bytes = await readFile(resolve(sourceRoot, path));
    files.set(path, bytes);
    if (path.endsWith(".json")) {
      const value = JSON.parse(bytes.toString("utf8")) as { imports?: string[]; sources?: Array<{ path: string }> };
      for (const dependency of [...(value.imports ?? []), ...(value.sources ?? []).map(source => source.path)]) {
        if (!files.has(dependency)) pending.push(dependency);
      }
    }
  }
  for (const path of optional) {
    try { files.set(path, await readFile(resolve(sourceRoot, path))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const [path, bytes] of files) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), bytes, { mode: (await stat(resolve(sourceRoot, path))).mode & 0o777 });
  }
  // This disposable fixture has no imported publication receipts. Reconstruct
  // its authority with the real handlers, never seed a grant without its receipt.
  const authority = deriveConstructionAuthority(graph, work, manifestPath);
  const marker = "urn:usf:record:linear-work-binding-grants-empty";
  await writeFile(resolve(root, authority.sourcePath), [
    `<${marker}> <urn:usf:predicate:forContract> <urn:usf:contract:linear-work-binding:1> <${authority.targetGraphIri}> .`,
    `<${marker}> <urn:usf:predicate:text> "No construction or completion authority is published in this source." <${authority.targetGraphIri}> .`,
    `<${marker}> <urn:usf:predicate:type> <urn:usf:type:SemanticRecordType> <${authority.targetGraphIri}> .`,
  ].join("\n") + "\n");
  await writeFile(resolve(root, bindingGraphPath), fixtureBinding(false) + fixtureBinding(true));
  const evidencePath = ".usf/candidates/construction-authority/native-binding.evidence.json";
  const proofPath = ".usf/candidates/construction-authority/native-binding.proof.json";
  await mkdir(resolve(root, ".usf/candidates/construction-authority"), { recursive: true, mode: 0o700 });
  const evidence = await evidenceCommandHandler({ command: "evidence", repositoryRoot: root,
    args: ["construction", "--work", work, "--profile", profile, "--manifest", manifestPath, "--output", evidencePath] });
  assert.equal(evidence.exitCode ?? 0, 0);
  const proof = await proveCommandHandler({ command: "prove", repositoryRoot: root,
    args: ["construction", "--obligation", "urn:usf:proof:linear-work-binding:construction-authority", "--evidence", evidencePath,
      "--profile", profile, "--manifest", manifestPath, "--output", proofPath] });
  assert.equal(proof.exitCode ?? 0, 0);
  assert.equal(object(object(proof.output).proof).outcome, "pass");
  for (const mode of ["--verify", "--apply"]) {
    const publication = await constructionAwarePublishCommandHandler({ command: "publish", repositoryRoot: root,
      args: ["construction-authority", "--bundle", proofPath, "--profile", profile, "--manifest", manifestPath, mode] });
    assert.equal(publication.exitCode ?? 0, 0);
  }
}


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

async function durableLedgerBytes(root: string): Promise<Array<readonly [string, string]>> {
  const records: Array<readonly [string, string]> = [];
  async function visit(path: string): Promise<void> {
    for (const entry of (await readdir(resolve(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else {
        assert.ok(entry.isFile(), "the isolated ledger must contain only regular files and directories");
        records.push([child, (await readFile(resolve(root, child))).toString("base64")]);
      }
    }
  }
  await visit(".usf/work/linear");
  assert.ok(records.length > 0);
  return records;
}

async function freshObservation(selector: LinearBindingSelector): Promise<{ status: string; attemptKey: string }> {
  const moduleUrl = pathToFileURL(resolve(sourceRoot, "src/commands/linear-binding.ts")).href;
  const script = `import { observeLinearBinding } from ${JSON.stringify(moduleUrl)}; const r = await observeLinearBinding(${JSON.stringify(selector)}); process.stdout.write(JSON.stringify({status:r.status,attemptKey:r.binding.unit.attemptKey}));`;
  const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script],
    { cwd: selector.repositoryRoot, env: {}, timeout: 30_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout) as { status: string; attemptKey: string };
}

// Deliberately outside linear-work-binding's own validation command: including
// this orchestration there would recursively launch the same native check.
test("native delivery supersedes retained provider history, publishes genuine proof, and replays without effects", { timeout: 420_000 }, async context => {
  const temporary = resolve(sourceRoot, ".usf/tmp");
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(resolve(temporary, "linear-native-completion-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await isolatedBindingRepository(root);
  const selector: LinearBindingSelector = { repositoryRoot: root, manifestPath: bindingManifestPath, bindingIri };
  // Provider history is deliberately synthetic test input. Native completion,
  // its checks and publication below are real, with no provider credentials.
  const predecessor = await settledProviderPredecessor({ ...selector, bindingIri: predecessorIri });
  const history = await Promise.all([predecessor.issuePath, predecessor.attemptPath, predecessor.evidencePath, predecessor.graphPath]
    .map(async path => [path, await readFile(path)] as const));
  const prepared = await prepareLinearBinding(selector);
  assert.equal(prepared.status, "PREPARED");
  assert.deepEqual(await readFile(predecessor.issuePath), history[0]![1]);
  const attemptKey = prepared.binding.unit.attemptKey;
  const delivered = await executeLinearDelivery(root, selector, ".usf/credentials/providers.env");
  assert.equal(delivered.status, "completed", JSON.stringify(delivered));
  assert.equal(delivered.evidence.settledStatus, "COMPLETED");
  const completion = object(delivered.evidence.completion);
  const receiptPath = object(completion.publication).publicationReceiptPath;
  assert.equal(typeof receiptPath, "string");
  const receiptBytes = await readFile(resolve(root, receiptPath as string));
  assert.ok(receiptBytes.length > 0);
  assert.equal((await observeLinearBinding(selector)).status, "COMPLETED");
  assert.deepEqual(await freshObservation(selector), { status: "COMPLETED", attemptKey });
  const issue = JSON.parse(await readFile(predecessor.issuePath, "utf8"));
  assert.equal(issue.bindingIri, bindingIri);
  assert.equal(issue.state, "SETTLED");
  assert.equal(issue.realisationDisposition, "no-change");
  assert.match(issue.nativeCompletionDigest, /^sha256:[0-9a-f]{64}$/u);
  const archive = resolve(root, ".usf/work/linear/" + prepared.binding.unit.intentKey.slice(7) + "/predecessor-issue.json");
  assert.deepEqual(await readFile(archive), history[0]![1]);
  for (const [path, bytes] of history.slice(1)) assert.deepEqual(await readFile(path), bytes);
  const beforeReplay = await durableLedgerBytes(root);
  const replay = await withNativeLinearCompletion(selector, attemptKey, async () => {
    assert.fail("durable completion replay must not repeat publication or dispatch a provider");
  });
  assert.equal(replay.result, null);
  assert.equal(replay.binding.status, "COMPLETED");
  assert.equal((await executeLinearDelivery(root, selector, ".usf/credentials/providers.env")).status, "completed");
  assert.deepEqual(await durableLedgerBytes(root), beforeReplay);
  assert.deepEqual(await readFile(resolve(root, receiptPath as string)), receiptBytes);
});
